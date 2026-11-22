$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    Write-Error "Chrome executable not found at $chromePath"
    exit 1
}

$profileDir = Join-Path $PSScriptRoot "..\test-results\chrome-profile"
if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

$url = "http://127.0.0.1:3001/"

Write-Host "Launching Google Chrome on Windows Session: $([System.Diagnostics.Process]::GetCurrentProcess().SessionId)"
Write-Host "URL: $url"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $chromePath
$psi.Arguments = "--remote-debugging-port=9222 --start-maximized --new-window --user-data-dir=`"$profileDir`" $url"
$psi.UseShellExecute = $true

$proc = [System.Diagnostics.Process]::Start($psi)

Start-Sleep -Seconds 3

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Helper {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
}
"@

$chromeProcs = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($p in $chromeProcs) {
    Write-Host "Found Chrome Window: ID=$($p.Id), Title='$($p.MainWindowTitle)', Handle=$($p.MainWindowHandle)"
    # 3 = SW_MAXIMIZE
    [Win32Helper]::ShowWindow($p.MainWindowHandle, 3)
    [Win32Helper]::SetForegroundWindow($p.MainWindowHandle)
    [Win32Helper]::SwitchToThisWindow($p.MainWindowHandle, $true)
}

Write-Host "Chrome launched and foregrounded successfully."
