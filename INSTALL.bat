@echo off
:: Klik dua kali untuk install / update / ganti password (akan minta izin Administrator)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
