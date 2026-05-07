@echo off
chcp 65001 >nul
echo ==========================================
echo   Claude Code Haha - Portable Edition
echo ==========================================
echo.

set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
set "SERVER_PORT=3456"

echo [1/3] 正在安装依赖...
call bun install >nul 2>&1

echo [2/3] 正在构建前端...
cd /d "%~dp0desktop"
call bun run build >nul 2>&1
cd /d "%~dp0"

echo [3/3] 正在启动服务端...
echo.
echo 服务端启动中，请稍候...
echo 打开浏览器访问: http://127.0.0.1:3456
echo.
start http://127.0.0.1:3456

bun run src/server/index.ts

pause
