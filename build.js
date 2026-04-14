#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

process.chdir('G:\\Test\\copilot-history-viewer');

try {
  execSync('npm run compile', { stdio: 'inherit' });
  console.log('\n✅ 编译成功!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ 编译失败');
  process.exit(1);
}
