#!/usr/bin/env node
/**
 * Git 冲突解决脚本
 * 处理 push 被拒绝的问题
 */

const { execSync } = require('child_process');
const path = require('path');

const projectDir = __dirname;

console.log('\n===========================================');
console.log('🔄 Git 冲突解决工具');
console.log('===========================================\n');

console.log(`项目目录: ${projectDir}\n`);

try {
  // 1. 显示当前状态
  console.log('📋 当前 Git 状态:\n');
  const status = execSync('git --no-pager status', { 
    cwd: projectDir, 
    encoding: 'utf-8' 
  });
  console.log(status);

  // 2. 显示最近的提交
  console.log('\n📝 最近的提交:\n');
  const log = execSync('git --no-pager log --oneline -5', { 
    cwd: projectDir, 
    encoding: 'utf-8' 
  });
  console.log(log);

  // 3. 检查是否有未提交的更改
  const diff = execSync('git diff --name-only', { 
    cwd: projectDir, 
    encoding: 'utf-8' 
  });

  if (diff.trim()) {
    console.log('⚠️  检测到未提交的文件:\n');
    console.log(diff);
    console.log('\n✅ 步骤 1: 提交本地更改...\n');
    execSync('git add .', { cwd: projectDir });
    execSync('git commit -m "docs: Prepare for migration"', { cwd: projectDir });
    console.log('   已提交本地更改\n');
  }

  // 4. 执行 git pull
  console.log('✅ 步骤 2: 从远程获取最新代码...\n');
  try {
    const pullOutput = execSync('git pull origin main', { 
      cwd: projectDir, 
      encoding: 'utf-8' 
    });
    console.log(pullOutput);
    console.log('   同步成功\n');
  } catch (err) {
    // 如果有冲突，显示冲突信息
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    
    console.log('\n⚠️  检测到合并冲突！\n');
    console.log('需要手动解决冲突：');
    console.log('1. 在编辑器中打开有冲突的文件');
    console.log('2. 解决冲突标记 (<<<<<<<, =======, >>>>>>>)');
    console.log('3. 运行: git add . && git commit -m "Merge remote changes"');
    console.log('4. 再次运行此脚本\n');
    process.exit(1);
  }

  // 5. 执行 git push
  console.log('✅ 步骤 3: 推送本地提交到远程...\n');
  const pushOutput = execSync('git push origin main', { 
    cwd: projectDir, 
    encoding: 'utf-8' 
  });
  console.log(pushOutput);

  console.log('===========================================');
  console.log('✨ Git 冲突已解决，推送成功！');
  console.log('===========================================\n');

} catch (err) {
  console.error('\n❌ 错误: ' + err.message);
  if (err.stdout) console.error('\n输出:\n' + err.stdout);
  if (err.stderr) console.error('\n错误详情:\n' + err.stderr);
  process.exit(1);
}
