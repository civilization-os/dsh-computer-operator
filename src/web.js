export function createWebHandler(settingsStore, engine) {
  const getStatus = async (probe = false) => {
    const configured = await settingsStore.read()
    let screenInfo = null
    let error = null
    try {
      screenInfo = await engine.getInfo()
    } catch (e) {
      error = e.message || String(e)
    }

    return {
      configured,
      screen: screenInfo || { width: 3840, height: 2160, primary: true },
      checks: {
        driver: screenInfo ? 'available' : 'failed',
        resolution: screenInfo ? `${screenInfo.width} × ${screenInfo.height}` : '未知',
        os: 'Windows (Native DPI Aware)',
        mode: configured.driverMode === 'silent' ? '静默无感模式（三不抢）' : '物理硬件模式',
      },
      error,
    }
  }

  return async (endpoint, payload, signal) => {
    try {
      signal?.throwIfAborted()
      if (endpoint === 'status') {
        const value = await getStatus(false)
        return { ok: true, value }
      }

      if (endpoint === 'probe') {
        const value = await getStatus(true)
        return { ok: true, value }
      }

      if (endpoint === 'save') {
        await settingsStore.write(payload)
        const value = await getStatus(false)
        return { ok: true, value }
      }

      if (endpoint === 'test_mouse') {
        const info = await engine.getInfo()
        const cx = Math.round(info.width / 2)
        const cy = Math.round(info.height / 2)
        await engine.mouseMove(cx - 50, cy - 50, { smooth: true })
        await engine.mouseMove(cx + 50, cy - 50, { smooth: true })
        await engine.mouseMove(cx + 50, cy + 50, { smooth: true })
        await engine.mouseMove(cx, cy, { smooth: true })
        return { ok: true, value: { success: true } }
      }

      if (endpoint === 'test_silent_click') {
        const info = await engine.getInfo()
        const cx = Math.round(info.width / 2)
        const cy = Math.round(info.height / 2)
        const res = await engine.mouseClick(cx, cy, { mode: 'silent' })
        return { ok: true, value: res }
      }

      if (endpoint === 'test_screenshot') {
        const res = await engine.screenshot({ grid: true })
        return { ok: true, value: { base64: res.base64, width: res.width, height: res.height } }
      }

      return { ok: false, error: `Unknown endpoint: ${endpoint}` }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  }
}

/**
 * HTTP 路由处理器：满足 DSH WebServer 与 RPC 信封协议
 */
export function createWebHttpHandler(settingsStore, engine) {
  const handler = createWebHandler(settingsStore, engine)
  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, *',
      })
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: { message: 'Method Not Allowed' } }))
      return
    }

    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const endpoint = pathname.startsWith('/computer-operator/')
      ? pathname.slice('/computer-operator/'.length)
      : pathname === '/computer-operator'
        ? 'status'
        : undefined

    if (!endpoint) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: { message: 'Not Found' } }))
      return
    }

    let raw = ''
    try {
      for await (const chunk of req) raw += chunk.toString('utf8')
    } catch {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: { message: 'Failed to read request body.' } }))
      return
    }

    let body = {}
    if (raw.trim()) {
      try {
        body = JSON.parse(raw)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: { message: 'Invalid JSON body.' } }))
        return
      }
    }

    const isRpcEnvelope = body && body.type === 'client-request' && typeof body.rpcId === 'string'
    const actualEndpoint = isRpcEnvelope ? (body.method || endpoint) : endpoint
    const payload = isRpcEnvelope ? (body.payload ?? {}) : body

    const result = await handler(actualEndpoint, payload, req.signal)

    const responseBody = isRpcEnvelope
      ? { type: 'server-response', rpcId: body.rpcId, result }
      : result

    const data = JSON.stringify(responseBody)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(data),
    })
    res.end(data)
  }
}
