@echo off
REM 创建 docs 目录
mkdir G:\Test\copilot-history-viewer\docs 2>nul

REM 注意：由于文件很大，此脚本作为占位符
REM 实际文件内容将通过 VSCode create 工具一次创建

echo ✅ docs 目录已创建或已存在
echo 📄 准备迁移 10 份文档...

cd /d G:\Test\copilot-history-viewer

REM 显示 git 状态
echo.
echo 📊 当前 Git 状态:
git status

echo.
echo ⏳ 文档迁移完成后，执行以下命令提交：
echo.
echo   git add docs/
echo   git commit -m "docs: Add three-layer architecture documentation for Phase 1 & 2" -m "Co-authored-by: Copilot ^<223556219+Copilot@users.noreply.github.com^>"
echo   git push
echo.
