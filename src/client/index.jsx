import { useEffect, useRef, useState } from 'react'
import { OperatorController } from './controller.js'
import { zh, en } from './locales.js'
import css from './styles.css'

export const inject = ['slots', 'locale', 'connection']
const namespace = 'settings.computer-operator'

export function apply(ctx) {
  const controller = new OperatorController((endpoint, args, signal) =>
    ctx.connection.rpc.call('/computer-operator', endpoint, args, signal)
  )

  ctx.effect(() => ctx.locale.register(namespace, { zh, en }))
  ctx.effect(() => () => controller.dispose())
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  })

  ctx.on('connection/reset', () => {
    void controller.request('status')
  })

  const t = ctx.locale.bind(namespace)
  const PANEL_ID = 'computer-operator'
  const face = () => ({
    hooks: { operator: controller },
    request: (endpoint, args) => controller.request(endpoint, args),
  })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: namespace,
    inject: face,
  }, OperatorPage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 25,
    locale: namespace,
    label: () => t('panel'),
  }, OperatorIcon))
}

export function OperatorIcon({ size = 16 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="1.5" y="2" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M6 11v2.5h4V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4.5 13.5h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M5 4.5l3 3-1.2.3 1 2-.8.4-1-2-1.1.8V4.5z" fill="currentColor"/>
    </svg>
  )
}

export function OperatorPage(props) {
  return (
    <div className="dsh-co-page">
      <OperatorSettings {...props} />
    </div>
  )
}

function OperatorSettings({ t, useOperator, request }) {
  // [最优推荐预设]：开箱即用的最佳实践参数
  const fallbackState = {
    configured: {
      display: 'primary',
      driverMode: 'silent',             // [最优] 静默无感模式
      dpiMode: 'auto',                  // [最优] 自动识别系统 DPI
      scaleDown: '1080p',               // [最优] 1080P 高质等比缩放
      visionProvider: 'default',        // [最优] 跟随会话模型
      visionBaseUrl: '',
      visionApiKey: '',
      visionModel: '',
      visualGrid: true,                 // [最优] 开启坐标辅助网格
      visualHighlight: true,            // [最优] 开启红圈点击反馈
      actionDelayMs: 250,               // [最优] 250ms 黄金缓冲延时
      mouseMoveMode: 'instant',         // [最优] 瞬移高效点击
      textInputMode: 'clipboard',       // [最优] 剪贴板无损中文注入
      emergencyStop: true,              // [最优] 开启熔断保护
      blockedApps: ['cmd.exe', 'powershell.exe', 'regedit.exe', 'taskmgr.exe'],
    },
    screen: { width: 3840, height: 2160, primary: true },
    checks: {
      driver: 'available',
      resolution: '检测中…',
      mode: '静默无感模式（三不抢）',
      os: 'Windows (Native DPI Aware)',
    },
    loading: false,
    saving: false,
    testing: false,
    previewSnap: '',
    error: '',
  }

  const rawState = useOperator ? useOperator(v => v) : null
  const state = rawState || fallbackState
  const configured = state.configured || fallbackState.configured

  const [draft, setDraft] = useState(configured)
  const dirty = useRef(false)

  const edit = patch => {
    dirty.current = true
    setDraft(v => ({ ...v, ...patch }))
  }

  const save = async () => {
    if (request && (await request('save', draft))) {
      dirty.current = false
    }
  }

  useEffect(() => {
    if (!dirty.current && state.configured) {
      setDraft(state.configured)
    }
  }, [state.configured])

  useEffect(() => {
    if (request) {
      void request('status')
      const timer = setInterval(() => { void request('status') }, 4000)
      return () => clearInterval(timer)
    }
  }, [request])

  return (
    <section className="dsh-co">
      <header>
        <div>
          <h2>{t('title')}</h2>
          <p>{t('intro')}</p>
        </div>
        <button
          type="button"
          disabled={state.loading || state.testing}
          onClick={() => request && request('probe')}
        >
          {t(state.loading ? 'probing' : 'probe')}
        </button>
      </header>

      {state.error && <p className="dsh-co-error" role="alert">{t('failed')}: {state.error}</p>}

      {/* 0. 核心驱动模式卡片 (静默 vs 物理) */}
      <section className="dsh-co-card">
        <header>
          <div>
            <h3>{t('sectionDriver')}</h3>
            <p className="dsh-co-field-desc">{t('driverModeDesc')}</p>
          </div>
        </header>
        <div className="dsh-co-form">
          <label className="dsh-co-wide">
            {t('driverMode')}
            <span className="dsh-co-mode">
              <button
                type="button"
                className={draft.driverMode !== 'hardware' ? 'is-primary' : ''}
                aria-pressed={draft.driverMode !== 'hardware'}
                onClick={() => edit({ driverMode: 'silent' })}
              >
                {t('mode_silent')}
              </button>
              <button
                type="button"
                className={draft.driverMode === 'hardware' ? 'is-primary' : ''}
                aria-pressed={draft.driverMode === 'hardware'}
                onClick={() => edit({ driverMode: 'hardware' })}
              >
                {t('mode_hardware')}
              </button>
            </span>
          </label>
          <div className="dsh-co-actions">
            <button type="button" className="is-primary" disabled={state.saving} onClick={save}>
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      </section>

      {/* 1. 屏幕设置卡片 */}
      <section className="dsh-co-card">
        <header><h3>{t('sectionDisplay')}</h3></header>
        <div className="dsh-co-form">
          <label>
            {t('display')}
            <select value={draft.display || 'primary'} onChange={e => edit({ display: e.target.value })}>
              <option value="primary">{t('display_primary')}</option>
            </select>
          </label>

          <label>
            {t('dpiMode')}
            <select value={draft.dpiMode || 'auto'} onChange={e => edit({ dpiMode: e.target.value })}>
              <option value="auto">{t('dpi_auto')}</option>
              <option value="native">{t('dpi_native')}</option>
            </select>
          </label>

          <label>
            {t('scaleDown')}
            <select value={draft.scaleDown || '1080p'} onChange={e => edit({ scaleDown: e.target.value })}>
              <option value="1080p">{t('scale_1080p')}</option>
              <option value="none">{t('scale_none')}</option>
            </select>
          </label>

          <div className="dsh-co-actions">
            <button type="button" className="is-primary" disabled={state.saving} onClick={save}>
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      </section>

      {/* 2. 视觉配置卡片 */}
      <section className="dsh-co-card">
        <header><h3>{t('sectionVision')}</h3></header>
        <div className="dsh-co-form">
          <label className="dsh-co-wide">
            {t('visionProvider')}
            <span className="dsh-co-mode">
              <button
                type="button"
                aria-pressed={draft.visionProvider !== 'custom'}
                onClick={() => edit({ visionProvider: 'default' })}
              >
                {t('vision_default')}
              </button>
              <button
                type="button"
                aria-pressed={draft.visionProvider === 'custom'}
                onClick={() => edit({ visionProvider: 'custom' })}
              >
                {t('vision_custom')}
              </button>
            </span>
          </label>

          {draft.visionProvider === 'custom' && (
            <>
              <label>
                {t('visionBaseUrl')}
                <input
                  value={draft.visionBaseUrl || ''}
                  placeholder="https://api.openai.com/v1"
                  onChange={e => edit({ visionBaseUrl: e.target.value })}
                />
              </label>
              <label>
                {t('visionApiKey')}
                <input
                  type="password"
                  value={draft.visionApiKey || ''}
                  placeholder="sk-..."
                  onChange={e => edit({ visionApiKey: e.target.value })}
                />
              </label>
              <label className="dsh-co-wide">
                {t('visionModel')}
                <input
                  value={draft.visionModel || ''}
                  placeholder="claude-3-7-sonnet-20250219 或 qwen2.5-vl-72b"
                  onChange={e => edit({ visionModel: e.target.value })}
                />
              </label>
            </>
          )}

          <label className="dsh-co-wide">
            <span><strong>{t('visualGrid')}</strong></span>
            <span className="dsh-co-mode">
              <button
                type="button"
                aria-pressed={!draft.visualGrid}
                onClick={() => edit({ visualGrid: false })}
              >
                {t('disabled')}
              </button>
              <button
                type="button"
                aria-pressed={Boolean(draft.visualGrid)}
                onClick={() => edit({ visualGrid: true })}
              >
                {t('enabled')}
              </button>
            </span>
          </label>

          <label className="dsh-co-wide">
            <span><strong>{t('visualHighlight')}</strong></span>
            <span className="dsh-co-mode">
              <button
                type="button"
                aria-pressed={!draft.visualHighlight}
                onClick={() => edit({ visualHighlight: false })}
              >
                {t('disabled')}
              </button>
              <button
                type="button"
                aria-pressed={Boolean(draft.visualHighlight)}
                onClick={() => edit({ visualHighlight: true })}
              >
                {t('enabled')}
              </button>
            </span>
          </label>

          <div className="dsh-co-actions">
            <button type="button" className="is-primary" disabled={state.saving} onClick={save}>
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      </section>

      {/* 3. 键鼠行为卡片 */}
      <section className="dsh-co-card">
        <header><h3>{t('sectionControl')}</h3></header>
        <div className="dsh-co-form">
          <label>
            <span>{t('actionDelayMs')}<br /><small className="dsh-co-field-desc">{t('actionDelayMsDesc')}</small></span>
            <input
              type="number"
              min="50"
              max="3000"
              value={draft.actionDelayMs || 250}
              onChange={e => edit({ actionDelayMs: Number(e.target.value) })}
            />
          </label>

          <label>
            {t('mouseMoveMode')}
            <select value={draft.mouseMoveMode || 'instant'} onChange={e => edit({ mouseMoveMode: e.target.value })}>
              <option value="instant">{t('mode_instant')}</option>
              <option value="smooth">{t('mode_smooth')}</option>
            </select>
          </label>

          <label className="dsh-co-wide">
            {t('textInputMode')}
            <select value={draft.textInputMode || 'clipboard'} onChange={e => edit({ textInputMode: e.target.value })}>
              <option value="clipboard">{t('input_clipboard')}</option>
              <option value="keystroke">{t('input_keystroke')}</option>
            </select>
          </label>

          <div className="dsh-co-actions">
            <button type="button" className="is-primary" disabled={state.saving} onClick={save}>
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      </section>

      {/* 4. 安全防护卡片 */}
      <section className="dsh-co-card">
        <header><h3>{t('sectionSafety')}</h3></header>
        <div className="dsh-co-form">
          <label className="dsh-co-wide">
            <span><strong>{t('emergencyStop')}</strong></span>
            <span className="dsh-co-mode">
              <button
                type="button"
                aria-pressed={!draft.emergencyStop}
                onClick={() => edit({ emergencyStop: false })}
              >
                {t('disabled')}
              </button>
              <button
                type="button"
                aria-pressed={Boolean(draft.emergencyStop)}
                onClick={() => edit({ emergencyStop: true })}
              >
                {t('enabled')}
              </button>
            </span>
          </label>

          <label className="dsh-co-wide">
            <span><strong>{t('blockedApps')}</strong><br /><small className="dsh-co-field-desc">{t('blockedAppsDesc')}</small></span>
            <textarea
              rows={3}
              value={(draft.blockedApps || []).join('\n')}
              onChange={e => edit({ blockedApps: e.target.value.split('\n') })}
            />
          </label>

          <div className="dsh-co-actions">
            <button type="button" className="is-primary" disabled={state.saving} onClick={save}>
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      </section>

      {/* 5. 诊断检查与测试卡片 */}
      <section className="dsh-co-card">
        <header><h3>{t('sectionChecks')}</h3></header>
        <div className="dsh-co-checks">
          <div className="dsh-co-check">
            <div><span className="dsh-co-dot"></span><strong>{t('driverModeStatus')}</strong></div>
            <span style={{ color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 }}>
              {state.checks?.mode || '静默无感模式（三不抢）'}
            </span>
          </div>
          <div className="dsh-co-check">
            <div><span className="dsh-co-dot"></span><strong>{t('driverStatus')}</strong></div>
            <span>{state.checks?.driver === 'available' ? '正常 (Available)' : (state.checks?.driver || '正常')}</span>
          </div>
          <div className="dsh-co-check">
            <div><span className="dsh-co-dot"></span><strong>{t('screenRes')}</strong></div>
            <span>{state.checks?.resolution || '3840 × 2160'}</span>
          </div>
          <div className="dsh-co-check">
            <div><span className="dsh-co-dot"></span><strong>{t('toolsRegistered')}</strong></div>
            <span>{t('toolsReady')}</span>
          </div>
        </div>
        <div className="dsh-co-actions" style={{ padding: '16px 20px' }}>
          <button
            type="button"
            className="is-primary"
            disabled={state.testing}
            onClick={() => request && request('test_silent_click')}
          >
            {t('testSilentClick')}
          </button>
          <button
            type="button"
            disabled={state.testing}
            onClick={() => request && request('test_mouse')}
          >
            {t('testMouse')}
          </button>
          <button
            type="button"
            disabled={state.testing}
            onClick={() => request && request('test_screenshot')}
          >
            {t('testScreenshot')}
          </button>
        </div>
        {state.previewSnap && (
          <div style={{ padding: '0 20px 20px' }}>
            <div className="dsh-co-preview">
              <img src={`data:image/jpeg;base64,${state.previewSnap}`} alt="Desktop Preview" />
            </div>
            <div style={{ textAlign: 'right', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  if (rawState) rawState.previewSnap = ''
                }}
              >
                {t('closePreview')}
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  )
}
