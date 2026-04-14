// 快速验证 TypeScript 文件的导入和基本结构
const fs = require('fs');
const path = require('path');

const files = [
    'src/extension.ts',
    'src/projectStorageService.ts',
    'src/changeTrackingService.ts',
    'src/webviewProvider.ts',
    'src/types.ts'
];

const baseDir = 'G:\\Test\\copilot-history-viewer';

console.log('📋 验证 TypeScript 文件结构...\n');

let errorCount = 0;

for (const file of files) {
    const fullPath = path.join(baseDir, file);
    try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // 检查文件大小
        if (content.length === 0) {
            console.error(`❌ ${file} 文件为空`);
            errorCount++;
            continue;
        }
        
        // 检查导入语句
        const imports = content.match(/^import\s+.+from\s+['"].+['"];/gm) || [];
        
        // 检查关键的导出
        const hasExports = content.includes('export ');
        
        console.log(`✅ ${file}`);
        console.log(`   - 行数: ${content.split('\n').length}`);
        console.log(`   - 导入: ${imports.length}`);
        console.log(`   - 导出: ${hasExports ? '是' : '否'}`);
        console.log();
        
    } catch (error) {
        console.error(`❌ 读取 ${file} 失败: ${error.message}`);
        errorCount++;
    }
}

if (errorCount === 0) {
    console.log('✅ 所有文件结构检查通过！\n');
    console.log('📝 下一步: 运行 npm run compile 进行完整编译');
} else {
    console.log(`\n❌ 发现 ${errorCount} 个问题`);
    process.exit(1);
}
