# Rush Coffee HPP Counter - uninstall (data di folder data\ TIDAK dihapus)
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""; exit
}
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Stop-ScheduledTask -TaskName 'RushCoffee-HPP' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'RushCoffee-HPP' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$AppDir*server.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-NetFirewallRule -DisplayName 'Rush Coffee HPP (LAN + Tailscale)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host "  Service & firewall rule dihapus. Data tetap aman di folder data\" -ForegroundColor Green
Read-Host "  Tekan Enter untuk menutup"
