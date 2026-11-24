@echo off
:: Hapus service & firewall rule (data tidak dihapus)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
