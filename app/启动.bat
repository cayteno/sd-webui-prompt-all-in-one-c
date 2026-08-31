@echo off
chcp 65001 >nul
title sd-webui-prompt-all-in-one 独立版
cd /d "%~dp0"
echo ==================================================
echo    sd-webui-prompt-all-in-one 独立版 启动器
echo    地址: http://localhost:17860/?__theme=dark
echo ==================================================
echo.

netstat -ano | findstr ":17860 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [!] 端口 17860 已被占用，说明服务已经在运行。
    echo     请直接打开 http://localhost:17860/?__theme=dark
    echo     若想用本窗口重启，请先关掉已运行的服务。
    echo.
    pause
    exit /b 0
)

echo [1/2] 正在启动服务（使用 64 位 Python）...
set PYTHONPATH=%cd%

REM 优先使用 SD Forge 的 64 位 Python（依赖齐全）
if exist "I:\AI\sd-forge\python\python.exe" (
    "I:\AI\sd-forge\python\python.exe" app.py
) else (
    echo [!] 未找到 SD Forge 的 Python，尝试当前环境默认 python...
    python app.py
)

echo.
echo 服务已停止。关闭本窗口即可。
pause