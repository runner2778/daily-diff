@echo off
chcp 65001 >nul
cd /d %~dp0
if exist .env (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
)
echo 正在启动「每日信息差」...
python serve.py
pause
