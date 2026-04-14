@echo off
setlocal enabledelayedexpansion

REM 迁移脚本 - 将会话文档复制到项目 docs 目录

set SOURCE_DIR=C:\Users\wb.guohao06\.copilot\session-state\cd8311eb-3782-4f68-890f-ede629412422
set TARGET_DIR=%CD%\docs

echo.
echo =============================================
echo   文档迁移脚本
echo =============================================
echo.
echo 源目录:  %SOURCE_DIR%
echo 目标目录: %TARGET_DIR%
echo.

REM 创建目标目录
if not exist "%TARGET_DIR%" (
    mkdir "%TARGET_DIR%"
    echo ✅ 创建目录: %TARGET_DIR%
)

REM 复制文件 (带编号)
echo.
echo 📄 开始迁移文档:
echo.

copy "%SOURCE_DIR%\README.md" "%TARGET_DIR%\00-README.md" /Y >nul && echo ✅ 00-README.md && goto next1 || echo ❌ 00-README.md 失败
:next1

copy "%SOURCE_DIR%\plan.md" "%TARGET_DIR%\01-plan.md" /Y >nul && echo ✅ 01-plan.md && goto next2 || echo ❌ 01-plan.md 失败
:next2

copy "%SOURCE_DIR%\COMPLETION_REPORT.md" "%TARGET_DIR%\02-COMPLETION_REPORT.md" /Y >nul && echo ✅ 02-COMPLETION_REPORT.md && goto next3 || echo ❌ 02-COMPLETION_REPORT.md 失败
:next3

copy "%SOURCE_DIR%\IMPLEMENTATION_SUMMARY.md" "%TARGET_DIR%\03-IMPLEMENTATION_SUMMARY.md" /Y >nul && echo ✅ 03-IMPLEMENTATION_SUMMARY.md && goto next4 || echo ❌ 03-IMPLEMENTATION_SUMMARY.md 失败
:next4

copy "%SOURCE_DIR%\TESTING_GUIDE.md" "%TARGET_DIR%\04-TESTING_GUIDE.md" /Y >nul && echo ✅ 04-TESTING_GUIDE.md && goto next5 || echo ❌ 04-TESTING_GUIDE.md 失败
:next5

copy "%SOURCE_DIR%\CODE_REVIEW.md" "%TARGET_DIR%\05-CODE_REVIEW.md" /Y >nul && echo ✅ 05-CODE_REVIEW.md && goto next6 || echo ❌ 05-CODE_REVIEW.md 失败
:next6

copy "%SOURCE_DIR%\ARCHITECTURE.md" "%TARGET_DIR%\06-ARCHITECTURE.md" /Y >nul && echo ✅ 06-ARCHITECTURE.md && goto next7 || echo ❌ 06-ARCHITECTURE.md 失败
:next7

copy "%SOURCE_DIR%\QUICK_REFERENCE.md" "%TARGET_DIR%\07-QUICK_REFERENCE.md" /Y >nul && echo ✅ 07-QUICK_REFERENCE.md && goto next8 || echo ❌ 07-QUICK_REFERENCE.md 失败
:next8

copy "%SOURCE_DIR%\INDEX.md" "%TARGET_DIR%\08-INDEX.md" /Y >nul && echo ✅ 08-INDEX.md && goto next9 || echo ❌ 08-INDEX.md 失败
:next9

copy "%SOURCE_DIR%\HANDOFF_CHECKLIST.md" "%TARGET_DIR%\09-HANDOFF_CHECKLIST.md" /Y >nul && echo ✅ 09-HANDOFF_CHECKLIST.md && goto done || echo ❌ 09-HANDOFF_CHECKLIST.md 失败
:done

echo.
echo ✅ 迁移完成!
echo.
echo 📊 验证:
dir "%TARGET_DIR%" /B | find /C "." >nul && (
    for /F %%A in ('dir "%TARGET_DIR%" /B ^| find /C "."') do (
        echo 总共 %%A 个文件
    )
)

echo.
echo 🔄 后续 Git 操作:
echo    git add docs/
echo    git commit -m "docs: Add three-layer architecture documentation"
echo    git push
echo.

pause
