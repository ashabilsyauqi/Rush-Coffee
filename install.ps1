# Rush Coffee HPP Counter - Windows installer
# Jalankan lewat INSTALL.bat (otomatis minta akses Administrator)
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""; exit
}
$ErrorActionPreference = 'Stop'
$AppDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = 'RushCoffee-HPP'
$RuleName = 'Rush Coffee HPP (LAN + Tailscale)'

function Info($m){ Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "  [!]  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  RUSH COFFEE - HPP Counter installer" -ForegroundColor Yellow
Write-Host "  ===================================" -ForegroundColor Yellow

# 1. Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Warn "Node.js belum terpasang. Mencoba install via winget..."
  try {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    $node = Get-Command node -ErrorAction SilentlyContinue
  } catch {}
  if (-not $node) {
    Warn "Gagal install otomatis. Download Node.js LTS dari https://nodejs.org lalu jalankan INSTALL.bat lagi."
    Read-Host "Tekan Enter untuk keluar"; exit 1
  }
}
$NodeExe = $node.Source
Ok "Node.js $(& $NodeExe -v) -> $NodeExe"

# 2. Config (port + password)
$cfgPath = Join-Path $AppDir 'config.json'
$cfg = @{ port = 8080; host = '0.0.0.0'; password = 'rushcoffee'; sessionHours = 72 }
if (Test-Path $cfgPath) {
  $old = Get-Content $cfgPath -Raw | ConvertFrom-Json
  foreach ($p in $old.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
}
$portIn = Read-Host "  Port aplikasi [$($cfg.port)]"
if ($portIn) { $cfg.port = [int]$portIn }
$pw = Read-Host "  Password login (kosongkan = tetap '$($cfg.password)')"
if ($pw) { $cfg.password = $pw }
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json))
Ok "config.json disimpan (port $($cfg.port))"

# 3. Firewall: hanya LAN lokal + jaringan Tailscale (100.64.0.0/10), BUKAN internet publik
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort $cfg.port -RemoteAddress @('LocalSubnet','100.64.0.0/10') -Profile Any | Out-Null
Ok "Firewall dibuka untuk port $($cfg.port) (LAN + Tailscale saja)"

# 4. Auto-start service (Scheduled Task, jalan saat Windows boot, restart otomatis jika crash)
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$AppDir*server.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$action    = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$AppDir\server.js`"" -WorkingDirectory $AppDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Rush Coffee HPP Counter web server' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Ok "Service '$TaskName' terpasang & berjalan (auto-start saat boot)"

# 5. Health check
Start-Sleep -Seconds 3
try {
  $h = Invoke-RestMethod "http://localhost:$($cfg.port)/api/health" -TimeoutSec 5
  if ($h.ok) { Ok "Server merespons di port $($cfg.port)" }
} catch { Warn "Server belum merespons. Cek dengan menjalankan START-MANUAL.bat untuk melihat error." }

Write-Host ""
Write-Host "  Buka dari perangkat lain:" -ForegroundColor Yellow
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host ("    http://{0}:{1}   ({2})" -f $_.IPAddress, $cfg.port, $_.InterfaceAlias) }
Write-Host ""
if ($cfg.password -eq 'rushcoffee') { Warn "Password masih default 'rushcoffee' - sebaiknya ganti (jalankan INSTALL.bat lagi)." }
Read-Host "  Selesai. Tekan Enter untuk menutup"
