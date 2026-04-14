@echo off
REM Git 冲突解决脚本
REM 自动执行: pull -> push

echo.
echo ==========================================
echo Git 冲突解决
echo ==========================================
echo.

cd /d "G:\Test\copilot-history-viewer"

echo 步骤 1: 检查当前状态...
git status
echo.

echo 步骤 2: 从远程获取最新代码...
git pull origin main
if errorlevel 1 (
    echo.
    echo 警告: Pull 可能遇到冲突
    echo 请在编辑器中手动解决冲突，然后运行:
    echo   git add .
    echo   git commit -m "Merge remote changes"
    echo   git push origin main
    pause
    exit /b 1
)

echo.
echo 步骤 3: 推送本地更改...
git push origin main
if errorlevel 1 (
    echo.
    echo 错误: 推送失败
    pause
    exit /b 1
)

echo.
echo ==========================================
echo 成功! 所有更改已推送
echo ==========================================
echo.
pause
