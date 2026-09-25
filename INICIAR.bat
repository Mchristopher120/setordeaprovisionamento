@echo off
cd /d "%~dp0"
echo ============================================
echo   DASHBOARD APROVISIONAMENTO
echo   Abrindo em http://localhost:5000
echo   Pressione Ctrl+C para encerrar
echo ============================================
start "" http://localhost:5000
python app.py
pause