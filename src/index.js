import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SettingsStore } from './settings.js'
import { DesktopEngine } from './engine.js'
import { createWebHandler, createWebHttpHandler } from './web.js'

export const name = 'computer-operator'
export const inject = ['tools', 'skills']
export const Config = Schema.object({ dataDir: Schema.string().default('') })

const text = { type: 'string', required: true }
const optionalText = { type: 'string' }
const optionalNumber = { type: 'number' }
const optionalBoolean = { type: 'boolean' }
const coordinateTypeSchema = {
  type: 'string',
  enum: ['auto', '1080p', 'raw_pixel', 'normalized_1000', 'window_client', 'cdp_viewport'],
}

const output = {
  schema: { type: 'object', additionalProperties: true, properties: {} },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export async function apply(ctx, config) {
  const home = config.dataDir || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'computer-operator')
  const settings = new SettingsStore(join(home, 'settings.json'))
  const engine = new DesktopEngine(settings)
  const webHandler = createWebHandler(settings, engine)
  const httpHandler = createWebHttpHandler(settings, engine)

  // 注册 WebSocket RPC 处理器
  ctx.inject(['connection'], web => {
    web.connection.rpc.handle('/computer-operator', webHandler)
  })

  // 注册 HTTP WebServer 路由（处理浏览器 POST /computer-operator/* 请求）
  ctx.inject(['webServer'], hostCtx => {
    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'prefix',
      path: '/computer-operator',
      handler: httpHandler,
    }), 'computer-operator: /computer-operator route')
  })

  // 注册 Skill
  try {
    const skillPath = new URL('../skills/desktop-operation/SKILL.md', import.meta.url)
    const skillText = readFileSync(skillPath, 'utf8')
    const content = skillText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
    ctx.effect(() => ctx.skills.register({
      name: 'desktop-operation',
      description: 'Control Windows desktop applications via native mouse, keyboard, and vision screenshot with zero focus/mouse hijacking.',
      whenToUse: 'Use when operating Windows OS, desktop apps, clicking buttons, typing text, or automating GUI.',
      source: 'bundled',
      content,
    }))
  } catch (err) {
    console.warn('[computer-operator] Failed to load skill file:', err)
  }

  const register = (name, description, parameters, execute) => {
    ctx.effect(() => ctx.tools.register(defineTool({
      name,
      description,
      parameters,
      output,
      execute: async args => await execute(args),
    })))
  }

  // 1. 屏幕与对应窗口截图
  register(
    'desktop_screenshot',
    'Capture a screenshot of the desktop or a specific application window. When targetTitle is specified, captures that specific window directly (even if occluded or behind other windows) at 1:1 native resolution with window-client coordinate space. When targetTitle is omitted, captures the whole desktop (scaleDown can be "none" for 4K raw or "1080p").',
    {
      targetTitle: optionalText,
      targetHwnd: optionalNumber,
      grid: optionalBoolean,
      scaleDown: { type: 'string', enum: ['none', '1080p'] },
      highlightX: optionalNumber,
      highlightY: optionalNumber,
      coordinateType: coordinateTypeSchema,
      outputPath: optionalText,
    },
    args => engine.screenshot(args),
  )

  // 2. 获取屏幕信息
  register(
    'desktop_info',
    'Get current desktop resolution (width, height) and current cursor coordinates.',
    {},
    () => engine.getInfo(),
  )

  // 3. 鼠标点击
  register(
    'desktop_mouse_click',
    'Click the mouse at specific (x, y) coordinates. In silent mode, does not move physical mouse and does not steal focus. Specify targetTitle to punch through occluding windows (like fullscreen games).',
    {
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      clickCount: optionalNumber,
      smooth: optionalBoolean,
      targetTitle: optionalText,
      coordinateType: coordinateTypeSchema,
    },
    args => engine.mouseClick(args.x, args.y, args),
  )

  // 4. 鼠标移动/悬停
  register(
    'desktop_mouse_move',
    'Move the mouse cursor to (x, y) coordinates without clicking. Useful for triggering hover menus or tooltips.',
    {
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
      smooth: optionalBoolean,
      coordinateType: coordinateTypeSchema,
    },
    args => engine.mouseMove(args.x, args.y, args),
  )

  // 5. 鼠标拖拽
  register(
    'desktop_mouse_drag',
    'Drag from (startX, startY) to (endX, endY) with mouse button held down.',
    {
      startX: { type: 'number', required: true },
      startY: { type: 'number', required: true },
      endX: { type: 'number', required: true },
      endY: { type: 'number', required: true },
      button: { type: 'string', enum: ['left', 'right'] },
      coordinateType: coordinateTypeSchema,
    },
    args => engine.mouseDrag(args.startX, args.startY, args.endX, args.endY, args),
  )

  // 6. 滚轮滚动
  register(
    'desktop_mouse_scroll',
    'Scroll the mouse wheel. deltaY > 0 scrolls up, deltaY < 0 scrolls down. Supports horizontal scrolling deltaX.',
    {
      deltaY: { type: 'number', required: true },
      deltaX: optionalNumber,
      x: optionalNumber,
      y: optionalNumber,
      coordinateType: coordinateTypeSchema,
    },
    args => engine.mouseScroll(args.deltaY, args.deltaX || 0, args.x || 0, args.y || 0, args),
  )

  // 7. 鼠标按下/释放
  register(
    'desktop_mouse_state',
    'Set mouse button state: down (press and hold) or up (release).',
    {
      button: { type: 'string', enum: ['left', 'right', 'middle'], required: true },
      state: { type: 'string', enum: ['down', 'up'], required: true },
    },
    args => engine.mouseState(args.button, args.state),
  )

  // 8. 文本键入
  register(
    'desktop_keyboard_type',
    'Type text into the target window. In silent mode, types directly into the window handle without stealing foreground keyboard focus. Specify targetTitle to punch through occluding windows.',
    {
      text: { type: 'string', required: true },
      targetTitle: optionalText,
      x: optionalNumber,
      y: optionalNumber,
      coordinateType: coordinateTypeSchema,
      mode: { type: 'string', enum: ['clipboard', 'keystroke'] },
    },
    args => engine.keyboardType(args.text, args),
  )

  // 9. 快捷键触发
  register(
    'desktop_keyboard_hotkey',
    'Trigger a combination of keyboard keys. In silent mode, posts WM messages to target window without stealing foreground focus.',
    {
      keys: { type: 'string', required: true },
      targetTitle: optionalText,
      x: optionalNumber,
      y: optionalNumber,
      coordinateType: coordinateTypeSchema,
    },
    args => engine.keyboardHotkey(args.keys, args),
  )

  // 10. 单键按键
  register(
    'desktop_keyboard_press',
    'Press, hold (down), or release (up) a single keyboard key.',
    {
      key: { type: 'string', required: true },
      state: { type: 'string', enum: ['press', 'down', 'up'] },
      targetTitle: optionalText,
      x: optionalNumber,
      y: optionalNumber,
      coordinateType: coordinateTypeSchema,
    },
    args => engine.keyboardPress(args.key, args.state || 'press', args),
  )
}
