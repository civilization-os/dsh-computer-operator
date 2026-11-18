/**
 * Chrome DevTools Protocol (CDP) 纯后台静默驱动引擎
 * 基于 Node.js 原生 WebSocket 与 fetch 构建，零第三方依赖。
 *
 * 核心特性：
 * 1. 100% 纯后台静默：物理光标 0 移位、0 抢夺前台激活焦点；
 * 2. 免疫前台遮挡与最小化：直接与 Chromium 渲染内核通信；
 * 3. 极速无损：毫秒级响应，支持内核级原图截屏与全 Unicode 文本秒级注入。
 */

export class CDPEngine {
  constructor(port = 9222) {
    this.port = port
    this.connections = new Map() // wsUrl -> { ws, pendingRequests, reqId }
    this.dprMap = new Map()      // wsUrl -> devicePixelRatio
  }

  /**
   * 获取页面的 devicePixelRatio（DPR 缩放比）
   */
  async getDpr(wsUrl) {
    if (this.dprMap.has(wsUrl)) return this.dprMap.get(wsUrl)
    try {
      const dpr = await this.evaluate(wsUrl, 'window.devicePixelRatio || 1')
      const val = Number(dpr) || 1
      this.dprMap.set(wsUrl, val)
      return val
    } catch {
      return 1
    }
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`
  }

  /**
   * 检测本机 Chrome/Edge 远程调试端口是否可用
   */
  async isAvailable() {
    try {
      const res = await fetch(`${this.baseUrl}/json/version`, {
        signal: AbortSignal.timeout(600),
      })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * 枚举所有打开的标签页与目标
   */
  async listPages() {
    try {
      const res = await fetch(`${this.baseUrl}/json/list`, {
        signal: AbortSignal.timeout(1000),
      })
      if (!res.ok) return []
      const list = await res.json()
      return list.filter(item => item.type === 'page' || item.type === 'app')
    } catch (err) {
      console.warn('[CDPEngine] listPages error:', err.message)
      return []
    }
  }

  /**
   * 根据标题或关键字查找匹配的页面目标
   */
  async findPage(targetTitle = '') {
    const pages = await this.listPages()
    if (!pages || pages.length === 0) return null

    if (!targetTitle) return pages[0]

    const kw = targetTitle.toLowerCase().trim()
    const matched = pages.find(p =>
      (p.title && p.title.toLowerCase().includes(kw)) ||
      (p.url && p.url.toLowerCase().includes(kw))
    )
    return matched || pages[0]
  }

  /**
   * 获取或复用与指定页面的 WebSocket 会话
   */
  async getConnection(wsUrl) {
    if (this.connections.has(wsUrl)) {
      const conn = this.connections.get(wsUrl)
      if (conn.ws.readyState === WebSocket.OPEN) return conn
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      const conn = {
        ws,
        reqId: 0,
        pending: new Map(),
      }

      const timeout = setTimeout(() => {
        try { ws.close() } catch {}
        reject(new Error(`[CDPEngine] Connection timeout to ${wsUrl}`))
      }, 3000)

      ws.onopen = () => {
        clearTimeout(timeout)
        this.connections.set(wsUrl, conn)
        resolve(conn)
      }

      ws.onerror = (err) => {
        clearTimeout(timeout)
        reject(err)
      }

      ws.onclose = () => {
        this.connections.delete(wsUrl)
        for (const [, req] of conn.pending) {
          req.reject(new Error('[CDPEngine] WebSocket closed'))
        }
        conn.pending.clear()
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.id && conn.pending.has(msg.id)) {
            const req = conn.pending.get(msg.id)
            conn.pending.delete(msg.id)
            if (msg.error) {
              req.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
            } else {
              req.resolve(msg.result)
            }
          }
        } catch (err) {
          console.warn('[CDPEngine] parse message error:', err)
        }
      }
    })
  }

  /**
   * 向 Chromium 发送 JSON-RPC 指令
   */
  async send(wsUrl, method, params = {}) {
    const conn = await this.getConnection(wsUrl)
    const id = ++conn.reqId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (conn.pending.has(id)) {
          conn.pending.delete(id)
          reject(new Error(`[CDPEngine] RPC call timeout: ${method}`))
        }
      }, 5000)

      conn.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val) },
        reject: (err) => { clearTimeout(timer); reject(err) },
      })

      conn.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * 内核级点击：投递合成鼠标点击消息，不移动系统物理光标
   * 自动支持 DPR 坐标换算：大模型直接传入截图读出的物理像素坐标，底层自动除以 devicePixelRatio 映射到 CSS 视口
   */
  async click(wsUrl, x, y, options = {}) {
    const button = options.button || 'left'
    const clickCount = options.clickCount || 1
    const buttonsMap = { left: 1, right: 2, middle: 4 }
    const buttonsMask = buttonsMap[button] || 1

    const dpr = await this.getDpr(wsUrl)
    const isCssCoord = options.coordinateType === 'cdp_css' || options.skipDpr
    const targetX = isCssCoord ? x : (dpr > 0 ? (x / dpr) : x)
    const targetY = isCssCoord ? y : (dpr > 0 ? (y / dpr) : y)

    // 尝试轻量发送 mouseMoved (增加竞速短超时，防止 Chromium 后台渲染帧空闲时挂起)
    try {
      await Promise.race([
        this.send(wsUrl, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(targetX),
          y: Math.round(targetY),
          buttons: 0,
        }),
        new Promise(r => setTimeout(r, 100)),
      ])
    } catch {}

    for (let i = 0; i < clickCount; i++) {
      await this.send(wsUrl, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: Math.round(targetX),
        y: Math.round(targetY),
        button,
        buttons: buttonsMask,
        clickCount: i + 1,
      })
      await new Promise(r => setTimeout(r, 30))
      await this.send(wsUrl, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: Math.round(targetX),
        y: Math.round(targetY),
        button,
        buttons: 0,
        clickCount: i + 1,
      })
      if (i < clickCount - 1) await new Promise(r => setTimeout(r, 60))
    }

    return { ok: true, mode: 'cdp_silent', x, y, cssX: Math.round(targetX), cssY: Math.round(targetY), dpr }
  }

  /**
   * 内核级文本键入：直接向当前聚焦 DOM 元素输入文本（支持中文、换行与特殊字符）
   */
  async insertText(wsUrl, text) {
    await this.send(wsUrl, 'Input.insertText', { text })
    return { ok: true, mode: 'cdp_silent', length: text.length }
  }

  /**
   * 触发组合键与功能键
   */
  async dispatchKey(wsUrl, key, options = {}) {
    const isEnter = key.toLowerCase() === 'enter'
    const isBackspace = key.toLowerCase() === 'backspace'
    const isTab = key.toLowerCase() === 'tab'

    let windowsVirtualKeyCode = 0
    let keyStr = key

    if (isEnter) {
      windowsVirtualKeyCode = 13
      keyStr = 'Enter'
    } else if (isBackspace) {
      windowsVirtualKeyCode = 8
      keyStr = 'Backspace'
    } else if (isTab) {
      windowsVirtualKeyCode = 9
      keyStr = 'Tab'
    }

    await this.send(wsUrl, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: keyStr,
      windowsVirtualKeyCode,
    })
    await new Promise(r => setTimeout(r, 20))
    await this.send(wsUrl, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyStr,
      windowsVirtualKeyCode,
    })
    return { ok: true, mode: 'cdp_silent', key }
  }

  /**
   * 内核级全页面无损无感截图
   */
  async screenshot(wsUrl, options = {}) {
    try {
      await this.send(wsUrl, 'Page.enable')
    } catch {}

    const params = { format: options.format || 'png' }
    if (params.format === 'jpeg' && options.quality) {
      params.quality = options.quality
    }
    const res = await this.send(wsUrl, 'Page.captureScreenshot', params)

    let metrics = null
    try {
      metrics = await this.evaluate(wsUrl, `({
        dpr: window.devicePixelRatio || 1,
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight
      })`)
      if (metrics?.dpr) {
        this.dprMap.set(wsUrl, Number(metrics.dpr))
      }
    } catch {}

    const dpr = metrics?.dpr || (await this.getDpr(wsUrl))

    return {
      ok: true,
      captureMode: 'cdp',
      coordinateSpace: 'cdp_viewport',
      dpr,
      cssWidth: metrics?.cssWidth,
      cssHeight: metrics?.cssHeight,
      base64: res.data,
    }
  }

  /**
   * 在当前页面上下文中执行任意 JavaScript 脚本
   */
  async evaluate(wsUrl, expression) {
    const res = await this.send(wsUrl, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return res.result?.value
  }
}
