@echo off
cd /d "G:\Test\copilot-history-viewer"
echo 正在迁移文档...
node quick-migrate.js
echo.
echo 迁移完成！
pause
