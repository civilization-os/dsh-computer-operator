# @civilization/dsh-computer-operator (计算机桌面操作插件)

基于 Windows 原生底层接口与多模态视觉的 DeepSeek Harness (DSH) 桌面自动化插件。赋予 AI Agent 真正可靠操作 Windows 桌面系统的能力，**深度遵循 DSH 官方设计变量与明暗主题，开箱即用最优实战预设**。

---

## 官方主题与 UI 规范适配

- **全套官方变量对齐**：使用 `--dsw-alias-label-*`、`--dsw-alias-bg-layer-*`、`--dsw-alias-border-l4`、`--dsw-alias-brand-primary`。
- **无缝主题切换**：支持 DSH 明亮（Light）与暗黑（Dark）主题自适应切换，无硬编码突兀色彩。
- **自适应视口与布局**：支持高分屏与响应式收缩，对齐 DSH 全局卡片体系。

---

## 开箱即用的「最优配置矩阵」

| 配置项 | 推荐最优值 | 优化原理解析 |
| :--- | :--- | :--- |
| **驱动模式 (driverMode)** | `silent` (静默无感) | **三不抢**：利用 Windows 后台消息队列直接向目标窗口注入动作，物理鼠标不移位、不抢夺前台打字焦点 |
| **DPI 缩放 (dpiMode)** | `auto` (系统自动) | 自动感知 4K/2K/125%/150% 物理与逻辑缩放比，杜绝点偏 |
| **全屏采样率 (scaleDown)** | `1080p` | 全屏截图等比降采样至 1080P，**节省 75% 视觉 Token 与网络传输延迟**，且文本清晰可读，引擎自动映射回 4K 物理坐标 |
| **视觉网格 (visualGrid)** | `true` (开启) | 叠加半透明坐标网格，刻度数字与图像像素 **1:1 绝对对齐**，大模型绝对坐标预测准确率提升 **30%~50%** |
| **视觉反馈 (visualHighlight)** | `true` (开启) | 点击时标记高亮红圈，便于状态复盘与回放 |
| **动作缓冲延时 (actionDelayMs)** | `250ms` | 人类视觉与窗口渲染的黄金等待时间，避免动画未出重复点击 |
| **物理移动速度 (mouseMoveMode)** | `instant` (瞬移) | 物理模式下毫秒级跳跃，减少光标晃动打扰 |
| **文本输入模式 (textInputMode)** | `clipboard` (剪贴板) | 纯无损 Unicode 注入，完美支持中文、换行、特殊字符与长文本 |
| **紧急制动熔断 (emergencyStop)** | `true` (开启) | 物理模式下甩动鼠标至屏幕四角立即终止误操作 |
| **保护黑名单 (blockedApps)** | `cmd / powershell / regedit / taskmgr` | 默认保护核心系统控制台，防止误敲危险系统命令 |

---

## 核心架构创新与机制保障

### 1. 穿透前台遮挡与指定窗口 1:1 真实渲染 (`targetTitle` / `targetHwnd`)
- **穿透层级遮挡**：传统全屏截屏只能截取当前显示器表面的像素。当用户前台全屏运行游戏（如《英雄联盟》）或最大化全屏浏览（如 Edge）盖在最上层时，底层窗口会被完全遮挡。
- **DirectX/DWM 硬件加速渲染合成**：本插件底层调用 Win32 高阶 API `PrintWindow(hWnd, hdc, PW_RENDERFULLCONTENT)`，由 Windows 桌面窗口管理器 (DWM) 直接重绘该窗口的独立渲染表面。**即使目标 Chrome、记事本或管理界面被 100% 遮盖甚至最小化，也能无损抓取窗口内部完整的文本框、按钮与表单**。
- **Windows 沙箱桌面隔离穿透**：针对 Node.js/PowerShell 处于非交互式后台桌面（`exebox`）导致找不到窗口的问题，底层采用多线程动态挂载到系统交互式桌面 `default`（`OpenDesktop` + `SetThreadDesktop`），保证 100% 精准获取用户真实工作桌面的每一个窗口。
- **后台窗口激活保护**：若目标窗口处于最小化（Iconic）状态，系统采用 `ShowWindow(hWnd, SW_SHOWNOACTIVATE)` 恢复其排版尺寸，**绝不夺取用户当前前台焦点**。

### 2. 双重坐标契约规范（彻底告别混淆）
为了防止大模型在 4K 物理全屏坐标、1080P 缩放逻辑坐标与局部窗口坐标之间混淆算错，系统制定了明确严格的坐标契约：

| 模式 | 捕获方式 | 截图分辨率 | 坐标空间 (`coordinateSpace`) | 点击/键入坐标约定 |
| :--- | :--- | :--- | :--- | :--- |
| **指定窗口捕获 (推荐)** | `desktop_screenshot({ targetTitle: "..." })` | **1:1 原生高清真实尺寸** (绝无任何压缩变形) | `window_client` (窗口客户区相对坐标) | 直接传入图片上看到的坐标 $(x, y)$，左上角即为 $(0,0)$。系统直接发送无损客户区消息，**无需任何倍率换算** |
| **全屏概览捕获** | `desktop_screenshot({ scaleDown: "1080p" })` | 1920 × 1080 (带 1:1 标尺刻度网格) | `screen_1080p` | 大模型直接输入网格标尺上的坐标，引擎根据屏幕原生比率静态放大映射 |
| **全屏原图捕获** | `desktop_screenshot({ scaleDown: "none" })` | 3840 × 2160 (原生无损物理分辨率) | `screen_raw` | 输入物理像素坐标，1:1 精确对应 |

### 3. 双模自适应架构：Chrome/Edge 远程调试 (CDP) 降维打击
- **痛点根治**：现代自绘浏览器（Chromium / Blink）天然阻断 Win32 虚拟合成消息。本插件内置基于 Node.js 原生 WebSocket 的 **CDPEngine (Chrome DevTools Protocol)**。
- **自动智能路由**：当检测到本机 Chrome/Edge 开启了远程调试端口（默认 `9222`）且目标为网页时，系统自动切换为 CDP 内核直通通道。
- **真正的三不打扰**：
  - **物理光标 0 移位**：光标永远稳停在原地；
  - **前台焦点 0 抢夺**：哪怕前台正在全屏玩游戏或敲代码，后台网页自动完成点击、填表和翻页，互不打扰；
  - **输入秒级直达**：利用 `Input.insertText` 直接向 DOM 文本节点注入文本，支持全 Unicode/中文/Emoji，无需复制粘贴；
  - **内核级高清原图**：利用 `Page.captureScreenshot` 输出 100% 真实渲染画面，坐标系为标准 `cdp_viewport`。
- **DPR 智能自动归一化（所见即所点）**：
  - 高分屏（如 4K 175% 缩放，DPR = 1.75）下，截图获取的是设备物理像素（如 1871×1782），而 CDP 事件期望的是网页 CSS 视口坐标（如 1069×1018）；
  - 插件引擎在输入端底层自动通过 `window.devicePixelRatio` 实时归一化（除以 DPR），大模型在看图时读出的像素坐标**直接原样输入即可，无需心算除法**，从根本上解决点击偏移与点空问题；
  - 针对后台休眠时 Chromium 合成器空闲导致 `mouseMoved` 挂起的特性，底层采用无阻塞短竞速分发，并在 `mousePressed`/`mouseReleased` 中严格封装 `buttons` 状态掩码，确保点击响应控制在 50ms 内。
- **双模联动**：操作 Chrome/Edge 时走 CDP；操作记事本、系统设置、日常客户端时自动走 Win32，实现全桌面无死角覆盖。

### 4. 100% 纯静默通道（键盘快捷键与单键）
- 彻底停用全局物理 `keybd_event`，全套键盘指令（`desktop_keyboard_type`、`desktop_keyboard_hotkey`、`desktop_keyboard_press`）在静默模式下纯走 `WM_CHAR` / `WM_KEYDOWN` / `WM_KEYUP` / `WM_COPY` / `WM_PASTE` / `EM_SETSEL`。
- 无论执行 `ctrl+a`、`ctrl+c`、`ctrl+v`、`enter`、`backspace` 还是长文本输入，**绝对不会误触用户正在前台打字的聊天框或游戏操作**。

### 4. 全屏独占模式（DirectX Exclusive Fullscreen）防护
- 当检测到显卡被 DirectX 全屏独占（如全屏游戏锁定时导致 GDI 句柄无效），截图系统会自动捕获并友好返回 `DesktopUnavailable` 提示，建议将游戏切换为「无边框窗口化（Borderless Windowed）」模式，既保障游戏画质，又允许后台 AI 正常观察桌面。

---

## 包含的 Agent 模型工具 (Tools)

| 工具名称 | 功能说明 | 关键参数 |
| :--- | :--- | :--- |
| `desktop_screenshot` | 捕获指定窗口（穿透遮挡且 1:1 高清）或全屏桌面截图 | `targetTitle`, `targetHwnd`, `grid`, `scaleDown`, `highlightX/Y` |
| `desktop_info` | 查询当前屏幕分辨率与光标物理坐标 | - |
| `desktop_mouse_click` | 指定坐标点击（支持窗口相对坐标，静默不抢鼠标/焦点） | `x`, `y`, `targetTitle`, `coordinateType`, `button`, `clickCount` |
| `desktop_mouse_move` | 光标移动（用于悬停触发菜单） | `x`, `y`, `smooth` |
| `desktop_mouse_drag` | 从起点拖拽到终点释放 | `startX`, `startY`, `endX`, `endY` |
| `desktop_mouse_scroll` | 滚轮上下/左右滚动 | `deltaY`, `deltaX`, `x`, `y` |
| `desktop_mouse_state` | 保持按键按下或松开 | `button`, `state` |
| `desktop_keyboard_type` | 键入文本（静默模式下直接注入指定后台窗口） | `text`, `targetTitle`, `x`, `y` |
| `desktop_keyboard_hotkey` | 触发快捷键组合（如 `ctrl+c`, `ctrl+v`, `ctrl+a`, `enter` 等） | `keys`, `targetTitle`, `x`, `y` |
| `desktop_keyboard_press` | 单键按下/释放 | `key`, `state`, `targetTitle`, `x`, `y` |

---

## 自动化闭环验证

在本地测试目录下提供了可复用的端到端无感验证脚本：
```powershell
# 1. Win32 静默穿透遮挡与原生控件验证
node d:\project\dsh-plugins\.visual-test\test_silent_loop.mjs

# 2. Chrome 远程调试 (CDP) 全套表单自动化实测（勾选复选框、切换下拉菜单、表单提交与结果页面校验）
node d:\project\dsh-plugins\.visual-test\run_full_form_test.mjs
```
脚本将全自动验证：
1. 穿透遮挡窗口（如最大化浏览器下方的 Chrome/Web form 窗口）1:1 独立高清渲染与网格绘制；
2. 物理 4K 与 1080P 静态确定性坐标映射；
3. 全屏独占与敏感黑名单（`blockedApps`）安全拦截；
4. 后台进程穿透定位与无焦点争抢静默键鼠输入；
5. CDP 纯静默内核驱动下，DPR 自动换算与复杂交互控件（Checkbox / Select / Submit Button）100% 成功提交。
