@echo off
REM 文档迁移脚本
setlocal enabledelayedexpansion

set SOURCE_DIR=C:\Users\wb.guohao06\.copilot\session-state\cd8311eb-3782-4f68-890f-ede629412422\
set TARGET_DIR=G:\Test\copilot-history-viewer\docs\

if not exist "!TARGET_DIR!" (
    mkdir "!TARGET_DIR!"
    echo ✓ Created target directory: !TARGET_DIR!
)

echo Starting file migration...

REM 复制文件并重命名
copy "!SOURCE_DIR!README.md" "!TARGET_DIR!00-README.md" && echo ✓ README.md
copy "!SOURCE_DIR!plan.md" "!TARGET_DIR!01-plan.md" && echo ✓ plan.md
copy "!SOURCE_DIR!COMPLETION_REPORT.md" "!TARGET_DIR!02-COMPLETION_REPORT.md" && echo ✓ COMPLETION_REPORT.md
copy "!SOURCE_DIR!IMPLEMENTATION_SUMMARY.md" "!TARGET_DIR!03-IMPLEMENTATION_SUMMARY.md" && echo ✓ IMPLEMENTATION_SUMMARY.md
copy "!SOURCE_DIR!TESTING_GUIDE.md" "!TARGET_DIR!04-TESTING_GUIDE.md" && echo ✓ TESTING_GUIDE.md
copy "!SOURCE_DIR!CODE_REVIEW.md" "!TARGET_DIR!05-CODE_REVIEW.md" && echo ✓ CODE_REVIEW.md
copy "!SOURCE_DIR!ARCHITECTURE.md" "!TARGET_DIR!06-ARCHITECTURE.md" && echo ✓ ARCHITECTURE.md
copy "!SOURCE_DIR!QUICK_REFERENCE.md" "!TARGET_DIR!07-QUICK_REFERENCE.md" && echo ✓ QUICK_REFERENCE.md
copy "!SOURCE_DIR!INDEX.md" "!TARGET_DIR!08-INDEX.md" && echo ✓ INDEX.md
copy "!SOURCE_DIR!HANDOFF_CHECKLIST.md" "!TARGET_DIR!09-HANDOFF_CHECKLIST.md" && echo ✓ HANDOFF_CHECKLIST.md

echo.
echo Migration complete!
dir "!TARGET_DIR!"
