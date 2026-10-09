$ErrorActionPreference = 'Stop'
$taskBackend = Join-Path $PSScriptRoot 'backend'
$taskPython = Join-Path $taskBackend 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Missing backend virtual environment.' }
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Port 8000 is already listening. Check http://localhost:8000/docs'
    exit 0
}
Write-Host 'Keep this terminal open while testing attendance. Closing it stops the API.'
Write-Host 'API: http://localhost:8000/docs ; Android Emulator: http://10.0.2.2:8000'
Push-Location $taskBackend
try { & $taskPython -m uvicorn app.main:app --host 0.0.0.0 --port 8000 }
finally { Pop-Location }
