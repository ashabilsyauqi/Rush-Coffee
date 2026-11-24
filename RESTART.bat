@echo off
:: Restart server setelah update file
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart.ps1"
