#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, 'docs');

// 确保 docs 目录存在
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
  console.log('✅ Created docs directory');
}

// 源文档和目标路径映射
const documentMap = {
  '00-README.md': { source: 'README.md from session' },
  '01-plan.md': { source: 'plan.md from session' },
  '02-COMPLETION_REPORT.md': { source: 'COMPLETION_REPORT.md from session' },
  '03-IMPLEMENTATION_SUMMARY.md': { source: 'IMPLEMENTATION_SUMMARY.md from session' },
  '04-TESTING_GUIDE.md': { source: 'TESTING_GUIDE.md from session' },
  '05-CODE_REVIEW.md': { source: 'CODE_REVIEW.md from session' },
  '06-ARCHITECTURE.md': { source: 'ARCHITECTURE.md from session' },
  '07-QUICK_REFERENCE.md': { source: 'QUICK_REFERENCE.md from session' },
  '08-INDEX.md': { source: 'INDEX.md from session' },
  '09-HANDOFF_CHECKLIST.md': { source: 'HANDOFF_CHECKLIST.md from session' }
};

console.log('\n📋 Documents to migrate:');
Object.keys(documentMap).forEach(doc => {
  console.log(`   ${doc}`);
});

console.log('\n✅ Ready for file migration via VSCode tools');
