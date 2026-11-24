@echo off
:: Jalankan server di jendela ini (untuk tes / melihat error). Tutup jendela = server berhenti.
cd /d "%~dp0"
node server.js
pause
