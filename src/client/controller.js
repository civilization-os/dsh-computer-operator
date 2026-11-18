export class OperatorController {
  state = {
    configured: {
      display: 'primary',
      dpiMode: 'auto',
      scaleDown: 'none',
      visionProvider: 'default',
      visionBaseUrl: '',
      visionApiKey: '',
      visionModel: '',
      visualGrid: false,
      visualHighlight: true,
      actionDelayMs: 300,
      mouseMoveMode: 'smooth',
      textInputMode: 'clipboard',
      emergencyStop: true,
      blockedApps: ['cmd.exe', 'powershell.exe', 'regedit.exe'],
    },
    screen: { width: 1920, height: 1080, primary: true },
    checks: {
      driver: 'checking',
      resolution: '检测中…',
      os: 'Windows',
    },
    loading: true,
    saving: false,
    testing: false,
    previewSnap: '',
    error: '',
  }

  listeners = new Set()
  lifetime = new AbortController()
  requestId = 0

  constructor(call) {
    this.call = call
  }

  getSnapshot = () => this.state

  subscribe = listener => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(patch) {
    if (this.lifetime.signal.aborted) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  async request(endpoint, args = {}) {
    if (endpoint === 'status' && this.state.saving) return false
    const requestId = ++this.requestId
    const saving = endpoint === 'save'
    const testing = endpoint.startsWith('test_')

    this.publish({
      loading: !saving && !testing && endpoint !== 'status',
      saving,
      testing,
      error: '',
    })

    try {
      const result = await this.call(endpoint, args, this.lifetime.signal)
      if (requestId !== this.requestId) return false
      if (!result.ok) {
        this.publish({ loading: false, saving: false, testing: false, error: result.error || '操作失败' })
        return false
      }

      if (endpoint === 'test_screenshot') {
        this.publish({ previewSnap: result.value.base64, loading: false, saving: false, testing: false })
      } else {
        this.publish({ ...result.value, loading: false, saving: false, testing: false })
      }
      return true
    } catch (err) {
      if (requestId === this.requestId) {
        this.publish({ loading: false, saving: false, testing: false, error: err.message || '网络或接口异常' })
      }
      return false
    }
  }

  dispose() {
    this.lifetime.abort()
    this.listeners.clear()
  }
}
