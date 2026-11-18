param (
    [string]$Action,
    [int]$X = 0,
    [int]$Y = 0,
    [int]$StartX = 0,
    [int]$StartY = 0,
    [int]$EndX = 0,
    [int]$EndY = 0,
    [string]$Button = "left",
    [int]$ClickCount = 1,
    [int]$DeltaX = 0,
    [int]$DeltaY = 0,
    [string]$Text = "",
    [string]$Keys = "",
    [string]$Key = "",
    [string]$State = "press",
    [string]$Mode = "clipboard",
    [string]$ScaleDown = "",
    [string]$TargetTitle = "",
    [int64]$TargetHwnd = 0,
    [string]$OutputPath = "",
    [string]$BlockedApps = "",
    [string]$CoordinateType = "",
    [switch]$EmergencyStop,
    [switch]$Grid,
    [switch]$Smooth,
    [int]$HighlightX = -1,
    [int]$HighlightY = -1
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$typeDef = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential)]
public struct POINT {
    public int X;
    public int Y;
}

[StructLayout(LayoutKind.Sequential)]
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
    public int Width { get { return Right - Left; } }
    public int Height { get { return Bottom - Top; } }
}

public class NativeInput {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    // 静默模式核心 API (零抢占焦点与物理光标)
    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT Point);

    [DllImport("user32.dll")]
    public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBmp, uint nFlags);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    // 智能穿透窗口查找：在用户活跃桌面(default)线程中进行模糊匹配，即便被全屏应用遮挡也能精准定位
    public static IntPtr FindWindowByTitle(string keyword) {
        IntPtr found = IntPtr.Zero;
        string kw = keyword.ToLower().Replace(".exe", "").Trim();
        System.Threading.Thread t = new System.Threading.Thread(() => {
            IntPtr hDefault = OpenDesktop("default", 0, false, 0x01FF);
            if (hDefault != IntPtr.Zero) SetThreadDesktop(hDefault);

            EnumWindows((hWnd, lParam) => {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString().ToLower();
                if (!string.IsNullOrEmpty(title) && title.Contains(kw)) {
                    found = hWnd;
                    return false;
                }
                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                if (pid != 0) {
                    try {
                        System.Diagnostics.Process p = System.Diagnostics.Process.GetProcessById((int)pid);
                        if (p.ProcessName.ToLower().Contains(kw)) {
                            found = hWnd;
                            return false;
                        }
                    } catch {}
                }
                return true;
            }, IntPtr.Zero);

            if (hDefault != IntPtr.Zero) CloseDesktop(hDefault);
        });
        t.SetApartmentState(System.Threading.ApartmentState.STA);
        t.Start();
        t.Join();
        return found;
    }

    // 穿透捕获指定窗口真实画面 (即便被其他最大化/全屏窗口遮盖也能 1:1 抓取)
    public static bool CaptureWindowDirect(IntPtr hWnd, string savePath, out int outW, out int outH, out int rLeft, out int rTop, out int rRight, out int rBottom) {
        int w = 0, h = 0;
        int l = 0, top = 0, r = 0, b = 0;
        bool success = false;
        System.Threading.Thread t = new System.Threading.Thread(() => {
            IntPtr hDefault = OpenDesktop("default", 0, false, 0x01FF);
            if (hDefault != IntPtr.Zero) SetThreadDesktop(hDefault);

            if (IsIconic(hWnd)) {
                // SW_SHOWNOACTIVATE = 4 (恢复窗口尺寸与后台渲染，但绝不抢夺前台激活焦点)
                ShowWindow(hWnd, 4);
                System.Threading.Thread.Sleep(200);
            }

            RECT rect;
            GetWindowRect(hWnd, out rect);
            w = rect.Width;
            h = rect.Height;
            l = rect.Left;
            top = rect.Top;
            r = rect.Right;
            b = rect.Bottom;
            if (w <= 0 || h <= 0) return;

            IntPtr hdcScreen = GetDC(IntPtr.Zero);
            IntPtr hdcMem = CreateCompatibleDC(hdcScreen);
            IntPtr hBmp = CreateCompatibleBitmap(hdcScreen, w, h);
            IntPtr hOld = SelectObject(hdcMem, hBmp);

            // PW_RENDERFULLCONTENT = 0x00000002 (穿透遮挡，捕获完整真实画面)
            success = PrintWindow(hWnd, hdcMem, 0x00000002);

            using (System.Drawing.Bitmap bmp = System.Drawing.Image.FromHbitmap(hBmp)) {
                bmp.Save(savePath, System.Drawing.Imaging.ImageFormat.Png);
            }

            SelectObject(hdcMem, hOld);
            DeleteObject(hBmp);
            DeleteDC(hdcMem);
            ReleaseDC(IntPtr.Zero, hdcScreen);
            if (hDefault != IntPtr.Zero) CloseDesktop(hDefault);
        });
        t.SetApartmentState(System.Threading.ApartmentState.STA);
        t.Start();
        t.Join();
        outW = w;
        outH = h;
        rLeft = l;
        rTop = top;
        rRight = r;
        rBottom = b;
        return success;
    }

    // 获取可能存在的内部文本编辑子控件句柄 (适配常见 Edit / RichEdit 控件)
    public static IntPtr GetEditControl(IntPtr parentHwnd) {
        if (parentHwnd == IntPtr.Zero) return IntPtr.Zero;
        IntPtr child = FindWindowEx(parentHwnd, IntPtr.Zero, "Edit", null);
        if (child != IntPtr.Zero) return child;
        child = FindWindowEx(parentHwnd, IntPtr.Zero, "RichEditD2DPT", null);
        if (child != IntPtr.Zero) return child;
        return parentHwnd;
    }

    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public const uint MOUSEEVENTF_WHEEL      = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL     = 0x1000;

    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP       = 0x0002;

    public const uint WM_MOUSEMOVE   = 0x0200;
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP   = 0x0202;
    public const uint WM_RBUTTONDOWN = 0x0204;
    public const uint WM_RBUTTONUP   = 0x0205;
    public const uint WM_MBUTTONDOWN = 0x0207;
    public const uint WM_MBUTTONUP   = 0x0208;
    public const uint WM_KEYDOWN     = 0x0100;
    public const uint WM_KEYUP       = 0x0101;
    public const uint WM_CHAR        = 0x0102;

    // 常用标准剪贴板与控制消息
    public const uint WM_CUT         = 0x0300;
    public const uint WM_COPY        = 0x0301;
    public const uint WM_PASTE       = 0x0302;
    public const uint WM_CLEAR       = 0x0303;
    public const uint WM_UNDO        = 0x0304;

    public const int MK_LBUTTON      = 0x0001;
    public const int MK_RBUTTON      = 0x0002;
    public const int MK_MBUTTON      = 0x0010;

    public static IntPtr MakeLParam(int x, int y) {
        return (IntPtr)(((short)y << 16) | ((short)x & 0xFFFF));
    }

    public static byte GetVk(string keyName) {
        switch (keyName.ToLower().Trim()) {
            case "ctrl":
            case "control": return 0x11;
            case "alt": return 0x12;
            case "shift": return 0x10;
            case "win":
            case "windows": return 0x5B;
            case "enter":
            case "return": return 0x0D;
            case "esc":
            case "escape": return 0x1B;
            case "tab": return 0x09;
            case "backspace": return 0x08;
            case "space": return 0x20;
            case "delete":
            case "del": return 0x2E;
            case "insert": return 0x2D;
            case "home": return 0x24;
            case "end": return 0x23;
            case "pageup": return 0x21;
            case "pagedown": return 0x22;
            case "up": return 0x26;
            case "down": return 0x28;
            case "left": return 0x25;
            case "right": return 0x27;
            case "f1": return 0x70;
            case "f2": return 0x71;
            case "f3": return 0x72;
            case "f4": return 0x73;
            case "f5": return 0x74;
            case "f6": return 0x75;
            case "f7": return 0x76;
            case "f8": return 0x77;
            case "f9": return 0x78;
            case "f10": return 0x79;
            case "f11": return 0x7A;
            case "f12": return 0x7B;
            default:
                if (keyName.Length == 1) {
                    char c = keyName.ToUpper()[0];
                    if (c >= 'A' && c <= 'Z') return (byte)c;
                    if (c >= '0' && c <= '9') return (byte)c;
                    short vk = VkKeyScan(keyName[0]);
                    if (vk != -1) return (byte)(vk & 0xFF);
                }
                return 0;
        }
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'NativeInput').Type) {
    Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition $typeDef
}

[NativeInput]::SetProcessDPIAware() | Out-Null

function Get-CurrentCursor() {
    $pt = New-Object POINT
    [NativeInput]::GetCursorPos([ref]$pt) | Out-Null
    return $pt
}

function Move-Smooth([int]$targetX, [int]$targetY, [int]$steps = 10) {
    $cur = Get-CurrentCursor
    $startX = $cur.X
    $startY = $cur.Y
    for ($i = 1; $i -le $steps; $i++) {
        $nx = [int]($startX + ($targetX - $startX) * ($i / $steps))
        $ny = [int]($startY + ($targetY - $startY) * ($i / $steps))
        [NativeInput]::SetCursorPos($nx, $ny) | Out-Null
        Start-Sleep -Milliseconds 5
    }
    [NativeInput]::SetCursorPos($targetX, $targetY) | Out-Null
}

function Get-ProcessNameFromHwnd([IntPtr]$hWnd) {
    if ($hWnd -eq [IntPtr]::Zero) { return "" }
    $pidOut = 0
    [NativeInput]::GetWindowThreadProcessId($hWnd, [ref]$pidOut) | Out-Null
    if ($pidOut -ne 0) {
        try {
            $p = [System.Diagnostics.Process]::GetProcessById($pidOut)
            return $p.ProcessName
        } catch {}
    }
    return ""
}

function Assert-NotBlocked([IntPtr]$hWnd, [string]$blockedListStr) {
    if ([string]::IsNullOrWhiteSpace($blockedListStr) -or $hWnd -eq [IntPtr]::Zero) { return }
    $procName = Get-ProcessNameFromHwnd $hWnd
    if (-not [string]::IsNullOrWhiteSpace($procName)) {
        $blockedList = $blockedListStr.Split(",", [System.StringSplitOptions]::RemoveEmptyEntries)
        foreach ($b in $blockedList) {
            $trimmed = $b.Trim().ToLower().Replace(".exe", "")
            if ($procName.ToLower() -eq $trimmed) {
                throw "SecurityBlocked: Target window belongs to blocked application ($procName.exe)."
            }
        }
    }
}

function Check-EmergencyStop() {
    if ($EmergencyStop) {
        $cur = Get-CurrentCursor
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $w = $screen.Width
        $h = $screen.Height
        $isCorner = ($cur.X -le 10 -and $cur.Y -le 10) -or `
                    ($cur.X -ge ($w - 10) -and $cur.Y -le 10) -or `
                    ($cur.X -le 10 -and $cur.Y -ge ($h - 10)) -or `
                    ($cur.X -ge ($w - 10) -and $cur.Y -ge ($h - 10))
        if ($isCorner) {
            throw "EmergencyStop: Cursor detected in screen corner failsafe region. Operation aborted."
        }
    }
}

function Resolve-TargetHwnd([string]$title, [int64]$hwndVal, [int]$screenX, [int]$screenY, [string]$blockedListStr) {
    if ($hwndVal -ne 0) {
        $res = [IntPtr]$hwndVal
        Assert-NotBlocked $res $blockedListStr
        return $res
    }
    if (-not [string]::IsNullOrWhiteSpace($title)) {
        $found = [NativeInput]::FindWindowByTitle($title)
        if ($found -ne [IntPtr]::Zero) {
            Assert-NotBlocked $found $blockedListStr
            return $found
        }
    }
    if ($screenX -ne 0 -or $screenY -ne 0) {
        $pt = New-Object POINT
        $pt.X = $screenX
        $pt.Y = $screenY
        $found = [NativeInput]::WindowFromPoint($pt)
        if ($found -ne [IntPtr]::Zero) {
            Assert-NotBlocked $found $blockedListStr
            return $found
        }
    }
    $fg = [NativeInput]::GetForegroundWindow()
    Assert-NotBlocked $fg $blockedListStr
    return $fg
}

switch ($Action.ToLower()) {
    "info" {
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $cur = Get-CurrentCursor
        $res = @{
            width = $screen.Bounds.Width
            height = $screen.Bounds.Height
            primary = $true
            cursorX = $cur.X
            cursorY = $cur.Y
        }
        $res | ConvertTo-Json -Compress
    }

    "screenshot" {
        $targetWinHwnd = [IntPtr]::Zero
        if ($TargetHwnd -ne 0) {
            $targetWinHwnd = [IntPtr]$TargetHwnd
        } elseif (-not [string]::IsNullOrWhiteSpace($TargetTitle)) {
            $targetWinHwnd = [NativeInput]::FindWindowByTitle($TargetTitle)
        }

        if ($targetWinHwnd -ne [IntPtr]::Zero) {
            # ==================== 对应窗口精准穿透捕获模式 ====================
            $w = 0; $h = 0
            $rLeft = 0; $rTop = 0; $rRight = 0; $rBottom = 0
            $tempPath = if ($OutputPath) { $OutputPath } else { [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "dsh_win_" + [System.Guid]::NewGuid().ToString() + ".png") }

            $ok = [NativeInput]::CaptureWindowDirect($targetWinHwnd, $tempPath, [ref]$w, [ref]$h, [ref]$rLeft, [ref]$rTop, [ref]$rRight, [ref]$rBottom)
            if (-not $ok -or $w -le 0 -or $h -le 0) {
                @{ ok = $false; error = "WindowCaptureFailed: Unable to capture window handle $($targetWinHwnd.ToInt64()) with title '$TargetTitle'." } | ConvertTo-Json -Compress
                return
            }

            $img = [System.Drawing.Image]::FromFile($tempPath)
            $bmp = New-Object System.Drawing.Bitmap $img
            $img.Dispose()
            if (-not $OutputPath) { [System.IO.File]::Delete($tempPath) }

            $finalWidth = $bmp.Width
            $finalHeight = $bmp.Height

            if ($Grid -or ($HighlightX -ge 0 -and $HighlightY -ge 0)) {
                $gfx = [System.Drawing.Graphics]::FromImage($bmp)
                if ($Grid) {
                    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(65, 59, 130, 246)), 1
                    $font = New-Object System.Drawing.Font "Arial", 8
                    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 59, 130, 246))
                    for ($x = 0; $x -lt $finalWidth; $x += 100) {
                        $gfx.DrawLine($pen, $x, 0, $x, $finalHeight)
                        $gfx.DrawString("$x", $font, $brush, $x + 2, 2)
                    }
                    for ($y = 0; $y -lt $finalHeight; $y += 100) {
                        $gfx.DrawLine($pen, 0, $y, $finalWidth, $y)
                        $gfx.DrawString("$y", $font, $brush, 2, $y + 2)
                    }
                    $pen.Dispose(); $brush.Dispose(); $font.Dispose()
                }
                if ($HighlightX -ge 0 -and $HighlightY -ge 0) {
                    $redPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 239, 68, 68)), 3
                    $fillBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, 239, 68, 68))
                    $gfx.FillEllipse($fillBrush, $HighlightX - 12, $HighlightY - 12, 24, 24)
                    $gfx.DrawEllipse($redPen, $HighlightX - 12, $HighlightY - 12, 24, 24)
                    $redPen.Dispose(); $fillBrush.Dispose()
                }
                $gfx.Dispose()
            }

            # 窗口截图默认 1:1 原生清晰度，完全不强制降采样！只有在显式指定 1080p 且尺寸超大时压缩
            if ($ScaleDown -eq "1080p" -and $finalWidth -gt 1920) {
                $tWidth = 1920
                $tHeight = [int]($finalHeight * (1920.0 / $finalWidth))
                $sBmp = New-Object System.Drawing.Bitmap $tWidth, $tHeight
                $sGfx = [System.Drawing.Graphics]::FromImage($sBmp)
                $sGfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $sGfx.DrawImage($bmp, 0, 0, $tWidth, $tHeight)
                $sGfx.Dispose()
                $bmp.Dispose()
                $bmp = $sBmp
                $finalWidth = $tWidth
                $finalHeight = $tHeight
            }

            $sbTitle = New-Object System.Text.StringBuilder 256
            [NativeInput]::GetWindowText($targetWinHwnd, $sbTitle, 256) | Out-Null

            $winRect = @{
                left = $rLeft
                top = $rTop
                right = $rRight
                bottom = $rBottom
                width = $w
                height = $h
            }

            if ($OutputPath) {
                $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()
                @{
                    ok = $true
                    captureMode = "window"
                    targetTitle = $sbTitle.ToString()
                    hwnd = $targetWinHwnd.ToInt64()
                    windowRect = $winRect
                    width = $finalWidth
                    height = $finalHeight
                    path = $OutputPath
                    coordinateSpace = "window_client"
                } | ConvertTo-Json -Compress
            } else {
                $ms = New-Object System.IO.MemoryStream
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
                $b64 = [Convert]::ToBase64String($ms.ToArray())
                $ms.Dispose()
                $bmp.Dispose()
                @{
                    ok = $true
                    captureMode = "window"
                    targetTitle = $sbTitle.ToString()
                    hwnd = $targetWinHwnd.ToInt64()
                    windowRect = $winRect
                    width = $finalWidth
                    height = $finalHeight
                    base64 = $b64
                    coordinateSpace = "window_client"
                } | ConvertTo-Json -Compress
            }
            return
        }

        # ==================== 全桌面屏幕捕获模式 ====================
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $rawWidth = $bounds.Width
        $rawHeight = $bounds.Height
        $rawBmp = New-Object System.Drawing.Bitmap $rawWidth, $rawHeight
        $rawGfx = [System.Drawing.Graphics]::FromImage($rawBmp)
        try {
            $rawGfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        } catch [System.ComponentModel.Win32Exception] {
            $rawGfx.Dispose()
            $rawBmp.Dispose()
            @{
                ok = $false
                error = "DesktopUnavailable: The screen device context is currently unavailable (error: $($_.Exception.Message)). This typically occurs when a game is running in Exclusive Fullscreen mode, the screen is turned off, or Windows is locked. Please switch the game to 'Borderless Windowed' (无边框窗口化) mode to allow desktop capture."
            } | ConvertTo-Json -Compress
            return
        }

        $finalBmp = $rawBmp
        $finalWidth = $rawWidth
        $finalHeight = $rawHeight

        # 1080P 高质等比压缩 (若指定 none 则保持 4K 原图输出)
        if ($ScaleDown -ne "none" -and $rawWidth -gt 1920) {
            $finalWidth = 1920
            $finalHeight = [int]($rawHeight * (1920.0 / $rawWidth))
            $scaledBmp = New-Object System.Drawing.Bitmap $finalWidth, $finalHeight
            $scaledGfx = [System.Drawing.Graphics]::FromImage($scaledBmp)
            $scaledGfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $scaledGfx.DrawImage($rawBmp, 0, 0, $finalWidth, $finalHeight)
            $scaledGfx.Dispose()
            $rawGfx.Dispose()
            $rawBmp.Dispose()
            $finalBmp = $scaledBmp
        }

        # 在最终图像上叠加定位网格与红圈高亮，确保网格刻度数字与视觉模型获取的图像像素绝对 1:1 对齐
        $finalGfx = [System.Drawing.Graphics]::FromImage($finalBmp)

        if ($Grid) {
            $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(65, 59, 130, 246)), 1
            $font = New-Object System.Drawing.Font "Arial", 8
            $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 59, 130, 246))
            for ($x = 0; $x -lt $finalWidth; $x += 100) {
                $finalGfx.DrawLine($pen, $x, 0, $x, $finalHeight)
                $finalGfx.DrawString("$x", $font, $brush, $x + 2, 2)
            }
            for ($y = 0; $y -lt $finalHeight; $y += 100) {
                $finalGfx.DrawLine($pen, 0, $y, $finalWidth, $y)
                $finalGfx.DrawString("$y", $font, $brush, 2, $y + 2)
            }
            $pen.Dispose(); $brush.Dispose(); $font.Dispose()
        }

        if ($HighlightX -ge 0 -and $HighlightY -ge 0) {
            $redPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 239, 68, 68)), 3
            $fillBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, 239, 68, 68))
            $finalGfx.FillEllipse($fillBrush, $HighlightX - 12, $HighlightY - 12, 24, 24)
            $finalGfx.DrawEllipse($redPen, $HighlightX - 12, $HighlightY - 12, 24, 24)
            $redPen.Dispose(); $fillBrush.Dispose()
        }

        $finalGfx.Dispose()

        $coordSpace = if ($ScaleDown -eq "none") { "raw_screen" } else { "scaled_1080p" }

        if ($OutputPath) {
            $finalBmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
            @{ ok = $true; captureMode = "screen"; coordinateSpace = $coordSpace; path = $OutputPath; width = $finalWidth; height = $finalHeight; rawWidth = $rawWidth; rawHeight = $rawHeight } | ConvertTo-Json -Compress
        } else {
            $ms = New-Object System.IO.MemoryStream
            $finalBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
            $b64 = [Convert]::ToBase64String($ms.ToArray())
            $ms.Dispose()
            @{ ok = $true; captureMode = "screen"; coordinateSpace = $coordSpace; base64 = $b64; width = $finalWidth; height = $finalHeight; rawWidth = $rawWidth; rawHeight = $rawHeight } | ConvertTo-Json -Compress
        }

        $finalBmp.Dispose()
    }

    # ==================== 静默无感模式 (零抢鼠标、零抢焦点) ====================
    "silent_click" {
        $hwnd = Resolve-TargetHwnd $TargetTitle $TargetHwnd $X $Y $BlockedApps

        if ($hwnd -eq [IntPtr]::Zero) {
            # 回退处理
            Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
            Check-EmergencyStop
            [NativeInput]::SetCursorPos($X, $Y) | Out-Null
            [NativeInput]::mouse_event([NativeInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 30
            [NativeInput]::mouse_event([NativeInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            @{ ok = $true; mode = "fallback_hardware"; x = $X; y = $Y } | ConvertTo-Json -Compress
            return
        }

        $clientPt = New-Object POINT
        if ($CoordinateType -eq "window_client" -or (-not [string]::IsNullOrWhiteSpace($TargetTitle) -and $CoordinateType -ne "screen")) {
            # 窗口客户区相对坐标（来自窗口截图，直接使用）
            $clientPt.X = $X
            $clientPt.Y = $Y
        } else {
            # 屏幕坐标：转为客户区坐标
            $clientPt.X = $X
            $clientPt.Y = $Y
            [NativeInput]::ScreenToClient($hwnd, [ref]$clientPt) | Out-Null
        }

        $lParam = [NativeInput]::MakeLParam($clientPt.X, $clientPt.Y)
        $downMsg = [NativeInput]::WM_LBUTTONDOWN
        $upMsg = [NativeInput]::WM_LBUTTONUP
        $btnState = [IntPtr][NativeInput]::MK_LBUTTON
        $upMsg = [NativeInput]::WM_LBUTTONUP
        $btnState = [IntPtr][NativeInput]::MK_LBUTTON

        if ($Button -eq "right") {
            $downMsg = [NativeInput]::WM_RBUTTONDOWN
            $upMsg = [NativeInput]::WM_RBUTTONUP
            $btnState = [IntPtr][NativeInput]::MK_RBUTTON
        } elseif ($Button -eq "middle") {
            $downMsg = [NativeInput]::WM_MBUTTONDOWN
            $upMsg = [NativeInput]::WM_MBUTTONUP
            $btnState = [IntPtr][NativeInput]::MK_MBUTTON
        }

        [NativeInput]::PostMessage($hwnd, [NativeInput]::WM_MOUSEMOVE, [IntPtr]::Zero, $lParam) | Out-Null
        Start-Sleep -Milliseconds 15

        for ($i = 0; $i -lt $ClickCount; $i++) {
            [NativeInput]::PostMessage($hwnd, $downMsg, $btnState, $lParam) | Out-Null
            Start-Sleep -Milliseconds 30
            [NativeInput]::PostMessage($hwnd, $upMsg, [IntPtr]::Zero, $lParam) | Out-Null
            if ($i -lt ($ClickCount - 1)) { Start-Sleep -Milliseconds 80 }
        }

        @{ ok = $true; mode = "silent"; hwnd = $hwnd.ToInt64(); x = $X; y = $Y; clientX = $clientPt.X; clientY = $clientPt.Y } | ConvertTo-Json -Compress
    }

    "silent_type" {
        $parentHwnd = Resolve-TargetHwnd $TargetTitle $TargetHwnd $X $Y $BlockedApps
        $targetEditHwnd = [NativeInput]::GetEditControl($parentHwnd)

        # 逐字符直接投递 WM_CHAR 到指定窗口消息队列，前台焦点完全不被抢
        foreach ($ch in $Text.ToCharArray()) {
            $code = [int][char]$ch
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_CHAR, [IntPtr]$code, [IntPtr]1) | Out-Null
            Start-Sleep -Milliseconds 10
        }
        @{ ok = $true; mode = "silent"; length = $Text.Length; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
    }

    "silent_hotkey" {
        $parentHwnd = Resolve-TargetHwnd $TargetTitle $TargetHwnd $X $Y $BlockedApps
        $targetEditHwnd = [NativeInput]::GetEditControl($parentHwnd)

        $normalized = $Keys.ToLower().Trim()
        # 针对常用快捷键直接投递标准 Windows 命令，绝不打扰前台
        if ($normalized -eq "ctrl+a") {
            [NativeInput]::SendMessage($targetEditHwnd, 0x00B1, [IntPtr]0, [IntPtr]-1) | Out-Null
            @{ ok = $true; mode = "silent_em_setsel"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }
        if ($normalized -eq "ctrl+c") {
            [NativeInput]::SendMessage($targetEditHwnd, [NativeInput]::WM_COPY, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            @{ ok = $true; mode = "silent_wm_copy"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }
        if ($normalized -eq "ctrl+v") {
            [NativeInput]::SendMessage($targetEditHwnd, [NativeInput]::WM_PASTE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            @{ ok = $true; mode = "silent_wm_paste"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }
        if ($normalized -eq "ctrl+x") {
            [NativeInput]::SendMessage($targetEditHwnd, [NativeInput]::WM_CUT, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            @{ ok = $true; mode = "silent_wm_cut"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }
        if ($normalized -eq "ctrl+z") {
            [NativeInput]::SendMessage($targetEditHwnd, [NativeInput]::WM_UNDO, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            @{ ok = $true; mode = "silent_wm_undo"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }
        if ($normalized -eq "enter" -or $normalized -eq "return") {
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYDOWN, [IntPtr]0x0D, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_CHAR, [IntPtr]0x0D, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYUP, [IntPtr]0x0D, [IntPtr]1) | Out-Null
            @{ ok = $true; mode = "silent_enter"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }
        if ($normalized -eq "tab") {
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYDOWN, [IntPtr]0x09, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_CHAR, [IntPtr]0x09, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYUP, [IntPtr]0x09, [IntPtr]1) | Out-Null
            @{ ok = $true; mode = "silent_tab"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }
        if ($normalized -eq "backspace") {
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYDOWN, [IntPtr]0x08, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_CHAR, [IntPtr]0x08, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYUP, [IntPtr]0x08, [IntPtr]1) | Out-Null
            @{ ok = $true; mode = "silent_backspace"; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }

        # 普通按键静默 PostMessage 投递
        $parts = $Keys.Split("+", [System.StringSplitOptions]::RemoveEmptyEntries)
        foreach ($part in $parts) {
            $vk = [NativeInput]::GetVk($part)
            if ($vk -ne 0) {
                [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]1) | Out-Null
                Start-Sleep -Milliseconds 15
            }
        }
        foreach ($part in $parts) {
            $vk = [NativeInput]::GetVk($part)
            if ($vk -ne 0) {
                [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYUP, [IntPtr]$vk, [IntPtr]1) | Out-Null
            }
        }
        @{ ok = $true; mode = "silent_hotkey"; hotkey = $Keys; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
    }

    "silent_press" {
        $parentHwnd = Resolve-TargetHwnd $TargetTitle $TargetHwnd $X $Y $BlockedApps
        $targetEditHwnd = [NativeInput]::GetEditControl($parentHwnd)
        $vk = [NativeInput]::GetVk($Key)
        if ($vk -eq 0) { throw "Unknown key: $Key" }

        if ($Key.ToLower() -in @("enter", "return", "tab", "backspace") -and $State -eq "press") {
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_CHAR, [IntPtr]$vk, [IntPtr]1) | Out-Null
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYUP, [IntPtr]$vk, [IntPtr]1) | Out-Null
            @{ ok = $true; mode = "silent_press_char"; key = $Key; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
            return
        }

        if ($State -eq "down") {
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]1) | Out-Null
        } elseif ($State -eq "up") {
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYUP, [IntPtr]$vk, [IntPtr]1) | Out-Null
        } else {
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]1) | Out-Null
            Start-Sleep -Milliseconds 25
            [NativeInput]::PostMessage($targetEditHwnd, [NativeInput]::WM_KEYUP, [IntPtr]$vk, [IntPtr]1) | Out-Null
        }
        @{ ok = $true; mode = "silent_press"; key = $Key; hwnd = $targetEditHwnd.ToInt64() } | ConvertTo-Json -Compress
    }

    # ==================== 物理全局模式 (真实光标移动) ====================
    "mouse_move" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        if ($Smooth) {
            Move-Smooth $X $Y 15
        } else {
            [NativeInput]::SetCursorPos($X, $Y) | Out-Null
        }
        @{ ok = $true; x = $X; y = $Y } | ConvertTo-Json -Compress
    }

    "mouse_click" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        if ($Smooth) { Move-Smooth $X $Y 10 } else { [NativeInput]::SetCursorPos($X, $Y) | Out-Null }
        Start-Sleep -Milliseconds 20

        $down = [NativeInput]::MOUSEEVENTF_LEFTDOWN
        $up = [NativeInput]::MOUSEEVENTF_LEFTUP

        if ($Button -eq "right") {
            $down = [NativeInput]::MOUSEEVENTF_RIGHTDOWN
            $up = [NativeInput]::MOUSEEVENTF_RIGHTUP
        } elseif ($Button -eq "middle") {
            $down = [NativeInput]::MOUSEEVENTF_MIDDLEDOWN
            $up = [NativeInput]::MOUSEEVENTF_MIDDLEUP
        }

        for ($i = 0; $i -lt $ClickCount; $i++) {
            [NativeInput]::mouse_event($down, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 30
            [NativeInput]::mouse_event($up, 0, 0, 0, 0)
            if ($i -lt ($ClickCount - 1)) { Start-Sleep -Milliseconds 120 }
        }
        @{ ok = $true; x = $X; y = $Y; button = $Button; clicks = $ClickCount } | ConvertTo-Json -Compress
    }

    "mouse_drag" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        [NativeInput]::SetCursorPos($StartX, $StartY) | Out-Null
        Start-Sleep -Milliseconds 30
        $down = [NativeInput]::MOUSEEVENTF_LEFTDOWN
        $up = [NativeInput]::MOUSEEVENTF_LEFTUP
        if ($Button -eq "right") {
            $down = [NativeInput]::MOUSEEVENTF_RIGHTDOWN
            $up = [NativeInput]::MOUSEEVENTF_RIGHTUP
        }
        [NativeInput]::mouse_event($down, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 50
        Move-Smooth $EndX $EndY 20
        Start-Sleep -Milliseconds 50
        [NativeInput]::mouse_event($up, 0, 0, 0, 0)
        @{ ok = $true; start = @{ x = $StartX; y = $StartY }; end = @{ x = $EndX; y = $EndY } } | ConvertTo-Json -Compress
    }

    "mouse_scroll" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        if ($X -ne 0 -or $Y -ne 0) { [NativeInput]::SetCursorPos($X, $Y) | Out-Null }
        if ($DeltaY -ne 0) {
            $amount = [uint32]$DeltaY
            [NativeInput]::mouse_event([NativeInput]::MOUSEEVENTF_WHEEL, 0, 0, $amount, 0)
        }
        if ($DeltaX -ne 0) {
            $amount = [uint32]$DeltaX
            [NativeInput]::mouse_event([NativeInput]::MOUSEEVENTF_HWHEEL, 0, 0, $amount, 0)
        }
        @{ ok = $true; deltaX = $DeltaX; deltaY = $DeltaY } | ConvertTo-Json -Compress
    }

    "mouse_state" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        $down = [NativeInput]::MOUSEEVENTF_LEFTDOWN
        $up = [NativeInput]::MOUSEEVENTF_LEFTUP
        if ($Button -eq "right") {
            $down = [NativeInput]::MOUSEEVENTF_RIGHTDOWN
            $up = [NativeInput]::MOUSEEVENTF_RIGHTUP
        } elseif ($Button -eq "middle") {
            $down = [NativeInput]::MOUSEEVENTF_MIDDLEDOWN
            $up = [NativeInput]::MOUSEEVENTF_MIDDLEUP
        }

        if ($State -eq "down") {
            [NativeInput]::mouse_event($down, 0, 0, 0, 0)
        } else {
            [NativeInput]::mouse_event($up, 0, 0, 0, 0)
        }
        @{ ok = $true; button = $Button; state = $State } | ConvertTo-Json -Compress
    }

    "keyboard_type" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        if ($Mode -eq "clipboard") {
            [System.Windows.Forms.Clipboard]::SetText($Text)
            Start-Sleep -Milliseconds 30
            $ctrl = [NativeInput]::GetVk("ctrl")
            $v = [NativeInput]::GetVk("V")
            [NativeInput]::keybd_event($ctrl, 0, 0, 0)
            [NativeInput]::keybd_event($v, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [NativeInput]::keybd_event($v, 0, [NativeInput]::KEYEVENTF_KEYUP, 0)
            [NativeInput]::keybd_event($ctrl, 0, [NativeInput]::KEYEVENTF_KEYUP, 0)
        } else {
            [System.Windows.Forms.SendKeys]::SendWait($Text)
        }
        @{ ok = $true; length = $Text.Length; mode = $Mode } | ConvertTo-Json -Compress
    }

    "keyboard_hotkey" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        $parts = $Keys.Split("+", [System.StringSplitOptions]::RemoveEmptyEntries)
        $vkList = @()
        foreach ($part in $parts) {
            $vk = [NativeInput]::GetVk($part)
            if ($vk -ne 0) {
                $vkList += $vk
                [NativeInput]::keybd_event($vk, 0, 0, 0)
                Start-Sleep -Milliseconds 20
            }
        }
        Start-Sleep -Milliseconds 50
        [array]::Reverse($vkList)
        foreach ($vk in $vkList) {
            [NativeInput]::keybd_event($vk, 0, [NativeInput]::KEYEVENTF_KEYUP, 0)
            Start-Sleep -Milliseconds 10
        }
        @{ ok = $true; hotkey = $Keys } | ConvertTo-Json -Compress
    }

    "keyboard_press" {
        Check-EmergencyStop
        Assert-NotBlocked ([NativeInput]::GetForegroundWindow()) $BlockedApps
        $vk = [NativeInput]::GetVk($Key)
        if ($vk -eq 0) { throw "Unknown key: $Key" }
        if ($State -eq "down") {
            [NativeInput]::keybd_event($vk, 0, 0, 0)
        } elseif ($State -eq "up") {
            [NativeInput]::keybd_event($vk, 0, [NativeInput]::KEYEVENTF_KEYUP, 0)
        } else {
            [NativeInput]::keybd_event($vk, 0, 0, 0)
            Start-Sleep -Milliseconds 30
            [NativeInput]::keybd_event($vk, 0, [NativeInput]::KEYEVENTF_KEYUP, 0)
        }
        @{ ok = $true; key = $Key; state = $State } | ConvertTo-Json -Compress
    }

    default {
        throw "Unsupported action: $Action"
    }
}
