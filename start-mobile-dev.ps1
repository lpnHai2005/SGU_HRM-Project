# Run from PowerShell: .\start-mobile-dev.ps1
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$logRoot = Join-Path $projectRoot 'tmp'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$backendListener = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue
if (-not $backendListener) {
    Start-Process -FilePath (Join-Path $projectRoot 'backend\venv\Scripts\python.exe') -ArgumentList '-m uvicorn app.main:app --host 0.0.0.0 --port 8000' -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'mobile-backend.log') -RedirectStandardError (Join-Path $logRoot 'mobile-backend-error.log')
}
$backendReady = $false
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8000/' -TimeoutSec 2
        if ($health.project -eq 'TechZone HRM API') { $backendReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if (-not $backendReady) { throw 'Attendance API is not ready. Read tmp/mobile-backend-error.log before opening Expo.' }
$metroListener = Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue
if (-not $metroListener) {
    Start-Process -FilePath (Get-Command node).Source -ArgumentList 'node_modules/expo/bin/cli start --go --lan --clear --port 8081' -WorkingDirectory (Join-Path $projectRoot 'mobile') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'mobile-expo.log') -RedirectStandardError (Join-Path $logRoot 'mobile-expo-error.log')
}
Write-Host 'Backend: port 8000. Expo Go: port 8081. Logs: tmp/mobile-*.log'
Write-Host 'Use the Wi-Fi IPv4 below in mobile/.env.local and exp://<IPv4>:8081. Restart Metro after changing env.'
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object InterfaceAlias, IPAddress
