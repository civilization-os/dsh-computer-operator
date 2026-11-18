import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { CDPEngine } from './cdp.js'

const execFileAsync = promisify(execFile)
const psScriptPath = join(dirname(fileURLToPath(import.meta.url)), 'win_operator.ps1')

export class DesktopEngine {
  constructor(settingsStore) {
    this.settingsStore = settingsStore
    this.physicalScreen = { width: 3840, height: 2160 }
    this.initialized = false
    this.cdp = new CDPEngine(9222)
  }

  /**
   * 尝试探测并获取匹配的 CDP (Chrome DevTools Protocol) 目标页面
   */
  async tryGetCDPPage(targetTitle, settings) {
    if (!settings?.cdpAutoRoute && settings?.driverMode !== 'cdp') return null
    const port = settings?.cdpPort || 9222
    if (this.cdp.port !== port) {
      this.cdp = new CDPEngine(port)
    }
    const available = await this.cdp.isAvailable()
    if (!available) return null
    return await this.cdp.findPage(targetTitle)
  }

  async ensureScreenInfo() {
    if (!this.initialized) {
      try {
        const info = await this.getInfo()
        if (info.width && info.height) {
          this.physicalScreen = { width: info.width, height: info.height }
          this.initialized = true
        }
      } catch (err) {
        console.warn('[DesktopEngine] Error detecting screen info:', err)
      }
    }
    return this.physicalScreen
  }

  async runAction(action, params = {}) {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath, '-Action', action]
    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null || val === '') continue
      if (typeof val === 'boolean') {
        if (val) args.push(`-${key}`)
      } else {
        const flagKey = key.charAt(0).toUpperCase() + key.slice(1)
        args.push(`-${flagKey}`, String(val))
      }
    }

    const { stdout, stderr } = await execFileAsync('powershell', args, {
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
    })

    if (stderr && stderr.trim()) {
      console.warn('[DesktopEngine] PowerShell warning:', stderr)
    }

    try {
      return JSON.parse(stdout.trim())
    } catch {
      return { ok: true, raw: stdout.trim() }
    }
  }

  async getInfo() {
    const info = await this.runAction('info')
    if (info.width && info.height) {
      this.physicalScreen = { width: info.width, height: info.height }
      this.initialized = true
    }
    return info
  }

  /**
   * 确定性坐标换算：消除截图隐式状态，无论是否已截图均按确定性契约计算
   */
  async toPhysical(x, y, coordinateType, settings) {
    if (coordinateType === 'window_client' || coordinateType === 'cdp_viewport') {
      return { x: Math.round(x), y: Math.round(y) }
    }

    await this.ensureScreenInfo()
    const rawW = this.physicalScreen.width
    const rawH = this.physicalScreen.height

    if (coordinateType === 'normalized_1000') {
      return {
        x: Math.round((x / 1000) * rawW),
        y: Math.round((y / 1000) * rawH),
      }
    }

    if (coordinateType === 'raw_pixel') {
      return { x: Math.round(x), y: Math.round(y) }
    }

    // 默认或 1080p 模式：当开启 1080p 采样且屏幕大于 1920 时，按 1920x1080 等比放大回物理屏幕
    const scaleMode = settings?.scaleDown || '1080p'
    if ((coordinateType === '1080p' || !coordinateType || coordinateType === 'auto') && scaleMode === '1080p' && rawW > 1920) {
      const scaleX = rawW / 1920.0
      const scaleY = rawH / 1080.0
      return {
        x: Math.round(x * scaleX),
        y: Math.round(y * scaleY),
      }
    }

    return { x: Math.round(x), y: Math.round(y) }
  }

  /**
   * 计算在截图图像中的坐标（用于高亮红圈叠加）
   */
  async toScreenshotCoords(x, y, coordinateType, settings) {
    if (coordinateType === 'window_client' || coordinateType === 'cdp_viewport') {
      return { x: Math.round(x), y: Math.round(y) }
    }

    await this.ensureScreenInfo()
    const rawW = this.physicalScreen.width
    const rawH = this.physicalScreen.height
    const scaleMode = settings?.scaleDown || '1080p'

    if (scaleMode === '1080p' && rawW > 1920) {
      if (coordinateType === '1080p' || !coordinateType || coordinateType === 'auto') {
        return { x: Math.round(x), y: Math.round(y) }
      }
      if (coordinateType === 'raw_pixel') {
        return {
          x: Math.round(x * (1920.0 / rawW)),
          y: Math.round(y * (1080.0 / rawH)),
        }
      }
      if (coordinateType === 'normalized_1000') {
        return {
          x: Math.round((x / 1000) * 1920),
          y: Math.round((y / 1000) * 1080),
        }
      }
    }

    return await this.toPhysical(x, y, coordinateType, settings)
  }

  async screenshot(options = {}) {
    const settings = await this.settingsStore.read()
    const grid = options.grid !== undefined ? options.grid : settings.visualGrid
    const highlight = settings.visualHighlight
    // 如果指定了具体窗口，默认使用 1:1 真实原图分辨率，不强制降采样
    const scaleDown = options.scaleDown || (options.targetTitle || options.targetHwnd ? 'none' : (settings.scaleDown || '1080p'))

    let hlX = -1
    let hlY = -1
    if (highlight && options.highlightX !== undefined && options.highlightY !== undefined) {
      const pt = await this.toScreenshotCoords(options.highlightX, options.highlightY, options.coordinateType, settings)
      hlX = pt.x
      hlY = pt.y
    }

    const params = {
      TargetTitle: options.targetTitle || '',
      TargetHwnd: options.targetHwnd || 0,
      Grid: Boolean(grid),
      ScaleDown: scaleDown,
      OutputPath: options.outputPath || '',
      HighlightX: hlX,
      HighlightY: hlY,
    }

    // 智能 CDP 内核截屏路由：当指定目标页面且 CDP 可用时，直接获取 100% 清晰内核画面
    if (options.targetTitle) {
      const cdpPage = await this.tryGetCDPPage(options.targetTitle, settings)
      if (cdpPage) {
        const shot = await this.cdp.screenshot(cdpPage.webSocketDebuggerUrl, options)
        if (options.outputPath && shot.base64) {
          await writeFile(options.outputPath, Buffer.from(shot.base64, 'base64'))
          return { ok: true, captureMode: 'cdp', coordinateSpace: 'cdp_viewport', path: options.outputPath, targetTitle: cdpPage.title }
        }
        return { ok: true, captureMode: 'cdp', coordinateSpace: 'cdp_viewport', base64: shot.base64, targetTitle: cdpPage.title }
      }
    }

    return await this.runAction('screenshot', params)
  }

  async mouseClick(x, y, options = {}) {
    const settings = await this.settingsStore.read()
    const mode = options.mode || settings.driverMode || 'silent'
    const button = options.button || 'left'
    const clickCount = options.clickCount || 1
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)

    // 如果指定了具体目标窗口且未显式指定坐标系，则默认为窗口内部相对坐标 (window_client)
    const coordType = options.coordinateType || (options.targetTitle || options.targetHwnd ? 'window_client' : 'auto')
    const pt = await this.toPhysical(x, y, coordType, settings)

    let res
    if (mode === 'silent') {
      // 智能 CDP 纯静默内核点击：若目标为 CDP 浏览器目标，100% 避免移动物理鼠标或抢焦点
      const cdpPage = await this.tryGetCDPPage(options.targetTitle, settings)
      if (cdpPage) {
        res = await this.cdp.click(cdpPage.webSocketDebuggerUrl, x, y, { button, clickCount })
      } else {
        // 静默模式：支持传入 targetTitle 穿透任何遮挡窗口（如全屏游戏/最大化浏览器）
        res = await this.runAction('silent_click', {
          X: pt.x,
          Y: pt.y,
          Button: button,
          ClickCount: clickCount,
          TargetTitle: options.targetTitle || '',
          TargetHwnd: options.targetHwnd || 0,
          CoordinateType: coordType,
          BlockedApps: blockedApps,
          EmergencyStop: emergencyStop,
        })
      }
    } else {
      // 物理硬件模式：移动物理光标
      const smooth = options.smooth !== undefined ? options.smooth : (settings.mouseMoveMode === 'smooth')
      res = await this.runAction('mouse_click', {
        X: pt.x,
        Y: pt.y,
        Button: button,
        ClickCount: clickCount,
        Smooth: Boolean(smooth),
        BlockedApps: blockedApps,
        EmergencyStop: emergencyStop,
      })
    }

    if (settings.actionDelayMs > 0) {
      await new Promise(r => setTimeout(r, settings.actionDelayMs))
    }
    return res
  }

  async mouseMove(x, y, options = {}) {
    const settings = await this.settingsStore.read()
    const pt = await this.toPhysical(x, y, options.coordinateType, settings)
    const smooth = options.smooth !== undefined ? options.smooth : (settings.mouseMoveMode === 'smooth')
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)
    return await this.runAction('mouse_move', {
      X: pt.x,
      Y: pt.y,
      Smooth: Boolean(smooth),
      BlockedApps: blockedApps,
      EmergencyStop: emergencyStop,
    })
  }

  async mouseDrag(startX, startY, endX, endY, options = {}) {
    const settings = await this.settingsStore.read()
    const pt1 = await this.toPhysical(startX, startY, options.coordinateType, settings)
    const pt2 = await this.toPhysical(endX, endY, options.coordinateType, settings)
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)
    const res = await this.runAction('mouse_drag', {
      StartX: pt1.x,
      StartY: pt1.y,
      EndX: pt2.x,
      EndY: pt2.y,
      Button: options.button || 'left',
      BlockedApps: blockedApps,
      EmergencyStop: emergencyStop,
    })
    if (settings.actionDelayMs > 0) {
      await new Promise(r => setTimeout(r, settings.actionDelayMs))
    }
    return res
  }

  async mouseScroll(deltaY, deltaX = 0, x = 0, y = 0, options = {}) {
    const settings = await this.settingsStore.read()
    let pt = { x: 0, y: 0 }
    if (x || y) {
      pt = await this.toPhysical(x, y, options.coordinateType, settings)
    }
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)
    const res = await this.runAction('mouse_scroll', {
      DeltaY: deltaY,
      DeltaX: deltaX,
      X: pt.x,
      Y: pt.y,
      BlockedApps: blockedApps,
      EmergencyStop: emergencyStop,
    })
    if (settings.actionDelayMs > 0) {
      await new Promise(r => setTimeout(r, settings.actionDelayMs))
    }
    return res
  }

  async mouseState(button, state) {
    const settings = await this.settingsStore.read()
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)
    return await this.runAction('mouse_state', {
      Button: button || 'left',
      State: state || 'down',
      BlockedApps: blockedApps,
      EmergencyStop: emergencyStop,
    })
  }

  async keyboardType(text, options = {}) {
    const settings = await this.settingsStore.read()
    const mode = options.mode || settings.driverMode || 'silent'
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)

    let res
    if (mode === 'silent') {
      // 智能 CDP 纯静默文本注入：直接注入目标 DOM 输入框，100% 避免物理按键干扰
      const cdpPage = await this.tryGetCDPPage(options.targetTitle, settings)
      if (cdpPage) {
        res = await this.cdp.insertText(cdpPage.webSocketDebuggerUrl, text)
      } else {
        // 静默输入：直接通过 WM_CHAR 定向推送到窗口句柄，支持 targetTitle 穿透
        let pt = { x: 0, y: 0 }
        if (options.x || options.y) {
          pt = await this.toPhysical(options.x || 0, options.y || 0, options.coordinateType, settings)
        }
        res = await this.runAction('silent_type', {
          Text: text,
          X: pt.x,
          Y: pt.y,
          TargetTitle: options.targetTitle || '',
          TargetHwnd: options.targetHwnd || 0,
          BlockedApps: blockedApps,
          EmergencyStop: emergencyStop,
        })
      }
    } else {
      const typeMode = options.typeMode || settings.textInputMode || 'clipboard'
      res = await this.runAction('keyboard_type', {
        Text: text,
        Mode: typeMode,
        BlockedApps: blockedApps,
        EmergencyStop: emergencyStop,
      })
    }

    if (settings.actionDelayMs > 0) {
      await new Promise(r => setTimeout(r, settings.actionDelayMs))
    }
    return res
  }

  async keyboardHotkey(keys, options = {}) {
    const settings = await this.settingsStore.read()
    const mode = options.mode || settings.driverMode || 'silent'
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)

    let res
    if (mode === 'silent') {
      const cdpPage = await this.tryGetCDPPage(options.targetTitle, settings)
      if (cdpPage) {
        res = await this.cdp.dispatchKey(cdpPage.webSocketDebuggerUrl, keys, options)
      } else {
        // 静默组合键：完全停用全局 keybd_event，使用 WM_COPY/WM_PASTE 或 WM_KEYDOWN/UP，绝不误触前台
        let pt = { x: 0, y: 0 }
        if (options.x || options.y) {
          pt = await this.toPhysical(options.x || 0, options.y || 0, options.coordinateType, settings)
        }
        res = await this.runAction('silent_hotkey', {
          Keys: keys,
          X: pt.x,
          Y: pt.y,
          TargetTitle: options.targetTitle || '',
          TargetHwnd: options.targetHwnd || 0,
          BlockedApps: blockedApps,
          EmergencyStop: emergencyStop,
        })
      }
    } else {
      res = await this.runAction('keyboard_hotkey', {
        Keys: keys,
        BlockedApps: blockedApps,
        EmergencyStop: emergencyStop,
      })
    }

    if (settings.actionDelayMs > 0) {
      await new Promise(r => setTimeout(r, settings.actionDelayMs))
    }
    return res
  }

  async keyboardPress(key, state = 'press', options = {}) {
    const settings = await this.settingsStore.read()
    const mode = options.mode || settings.driverMode || 'silent'
    const blockedApps = (settings.blockedApps || []).join(',')
    const emergencyStop = Boolean(settings.emergencyStop)

    let res
    if (mode === 'silent') {
      let pt = { x: 0, y: 0 }
      if (options.x || options.y) {
        pt = await this.toPhysical(options.x || 0, options.y || 0, options.coordinateType, settings)
      }
      res = await this.runAction('silent_press', {
        Key: key,
        State: state,
        X: pt.x,
        Y: pt.y,
        TargetTitle: options.targetTitle || '',
        TargetHwnd: options.targetHwnd || 0,
        BlockedApps: blockedApps,
        EmergencyStop: emergencyStop,
      })
    } else {
      res = await this.runAction('keyboard_press', {
        Key: key,
        State: state,
        BlockedApps: blockedApps,
        EmergencyStop: emergencyStop,
      })
    }

    if (settings.actionDelayMs > 0) {
      await new Promise(r => setTimeout(r, settings.actionDelayMs))
    }
    return res
  }
}
