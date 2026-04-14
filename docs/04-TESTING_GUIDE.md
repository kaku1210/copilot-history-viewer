# 三层存储架构 - 快速测试指南

## 📦 环境准备

### 前置条件
- VSCode 1.85.0+ 已安装
- Node.js 16+ 已安装
- 项目根目录：`G:\Test\copilot-history-viewer`

### 编译步骤
```bash
cd G:\Test\copilot-history-viewer

# 安装/更新依赖
npm install

# 编译 TypeScript
npm run compile

# 预期输出：无错误，生成 out/ 目录
```

---

## 🧪 测试场景

### 场景 1: 项目级存储初始化

**步骤**：
1. 打开 VSCode
2. 打开任意工作目录（或 ET 项目）
3. 按 `F5` 启动调试（或通过扩展安装）
4. 打开插件侧边栏 (左侧栏最下方的 Chat History 图标)
5. 打开设置: `Ctrl+,`
6. 搜索 `copilotHistoryViewer.enableProjectSync`
7. 勾选启用

**预期结果**：
- ✅ 项目根目录出现 `.copilot-log/` 文件夹
- ✅ 文件夹包含：
  - `.gitignore` (忽略规则)
  - `metadata.json` (会话元数据)
  - `sessions.json` (可选)
  - `changes/` 子目录
- ✅ 侧边栏显示"已启用项目同步"
- ✅ 全局会话已同步到 `metadata.json`

**验证方式**：
```bash
# 检查文件是否创建
ls -la .copilot-log/

# 查看元数据内容
cat .copilot-log/metadata.json | jq '.'
```

---

### 场景 2: 编辑变更追踪

**步骤**：
1. 在同一工作目录中，打开设置
2. 搜索 `copilotHistoryViewer.enableChangeTracking`
3. 勾选启用
4. 在编辑器中打开一个 `.cs` 或 `.js` 文件
5. 编辑几行代码
6. 保存文件 (`Ctrl+S`)
7. 重复编辑不同部分并保存

**预期结果**：
- ✅ `.copilot-log/changes/<date>/` 目录被创建
- ✅ 当前日期的目录中生成 `<sessionId>.json` 文件
- ✅ 文件包含编辑记录：
  ```json
  {
    "sessionId": "active-session-id",
    "startTime": "...",
    "changes": [
      {
        "timestamp": "...",
        "file": "relative/path/to/file.cs",
        "lines": { "start": 5, "end": 10 },
        "modifiedBy": "copilot",
        "lastModifiedAt": "..."
      }
    ]
  }
  ```

**验证方式**：
```bash
# 查看变更日志
ls -la .copilot-log/changes/$(date +%Y-%m-%d)/

# 查看内容
cat .copilot-log/changes/2026-04-14/*.json | jq '.'
```

---

### 场景 3: 会话切换

**步骤**：
1. 保持两个启用开关（项目同步 + 变更追踪）
2. 在一个 Copilot Chat 会话中编辑代码 (Session A)
3. 保存文件
4. 切换到另一个 Copilot Chat 会话或创建新会话 (Session B)
5. 在另一个文件中编辑
6. 保存

**预期结果**：
- ✅ Session A 的变更被保存到 `changes/<date>/sessionA-id.json`
- ✅ Session B 的变更被保存到 `changes/<date>/sessionB-id.json`
- ✅ 两个文件独立存储，不混淆

---

### 场景 4: 人工编辑标记

**步骤**：
1. 启用变更追踪
2. Copilot 生成代码到 src/Game.cs 第 42-45 行
3. 手动编辑同一行代码
4. 在命令面板执行 `copilotHistory.markManualEdit` 或通过脚本调用：
   ```javascript
   vscode.commands.executeCommand(
       'copilotHistory.markManualEdit',
       'src/Game.cs',
       42, 45
   );
   ```

**预期结果**：
- ✅ 变更记录中的 `modifiedBy` 字段更新为 `"manual"`
- ✅ `lastModifiedAt` 时间戳更新为标记时间

**验证方式**：
```json
{
  "file": "src/Game.cs",
  "lines": { "start": 42, "end": 45 },
  "modifiedBy": "manual",  // ← 已更新
  "lastModifiedAt": "2026-04-14T14:30:00Z"
}
```

---

### 场景 5: Git 集成

**步骤**：
1. 在启用了项目级存储的工作目录初始化 Git
2. 编辑并保存一些文件（启用追踪）
3. 查看 Git 状态

**预期结果**：
- ✅ `.copilot-log/.gitignore` 有效生效
- ✅ `changes/` 目录被忽略（不显示为未追踪）
- ✅ `sync-state.json` 被忽略
- ✅ `metadata.json` 可选包含在提交中

**验证方式**：
```bash
git status

# 预期输出：
# .copilot-log/ 下的文件不应显示为 untracked，
# 除非提交了 .gitignore 本身或 metadata.json

git add .copilot-log/metadata.json
git commit -m "Track Copilot session metadata"
```

---

## 🔍 故障排除

### 问题 1: `.copilot-log/` 未创建
**原因**：项目存储未启用或工作目录获取失败  
**解决**：
```javascript
// 检查工作目录
console.log(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);

// 手动启用
vscode.workspace.getConfiguration('copilotHistoryViewer')
    .update('enableProjectSync', true);
```

### 问题 2: 变更未被记录
**原因**：变更追踪未启用或没有激活会话  
**解决**：
1. 确认 `enableChangeTracking` 为 true
2. 查看开发者控制台 (`Ctrl+Shift+J`)
3. 搜索 `[ChangeTracking]` 日志确认服务启动
4. 确保有激活的 Copilot Chat 会话

### 问题 3: 行号范围不准确
**原因**：编辑器坐标系转换错误（0-indexed vs 1-indexed）  
**解决**：
- VSCode 内部使用 0-indexed 行号
- 存储时自动转换为 1-indexed（用户可见）
- 检查 changeTrackingService 中的坐标转换逻辑

### 问题 4: 内存泄漏
**原因**：文件监听器未正确清理  
**解决**：
- 扩展 deactivate() 时调用 `changeTrackingService.stopTracking()`
- 检查事件监听器是否添加到 context.subscriptions

---

## 📊 数据验证清单

### metadata.json 结构检查
```bash
cat .copilot-log/metadata.json | jq '
{
  version: .version,
  sessionCount: (.sessions | length),
  lastSync: .lastSyncTime
}
'
```

### changes JSON 结构检查
```bash
cat .copilot-log/changes/*/session-*.json | jq '
{
  sessionId,
  changeCount: (.changes | length),
  fileCount: (.fileIndex | keys | length),
  timeRange: {
    start: .startTime,
    end: .endTime
  }
}
'
```

### 行号范围验证
```bash
# 检查所有变更的行号范围是否有效 (start <= end)
cat .copilot-log/changes/*/*.json | jq '
.changes[] |
select(.lines.start > .lines.end) |
{file, lines, issue: "invalid range"}
'

# 如果输出为空，说明所有范围都有效 ✅
```

---

## 🎯 端到端测试流程

### 完整工作流测试
1. ✅ 创建新工作目录
2. ✅ 启用项目级存储 → 检查 metadata.json
3. ✅ 启用变更追踪 → 检查 changes 目录创建
4. ✅ 在代码中进行编辑 → 检查变更记录
5. ✅ 切换 Copilot 会话 → 检查新会话文件
6. ✅ 标记人工编辑 → 检查 modifiedBy 更新
7. ✅ 初始化 Git → 检查 .gitignore 生效
8. ✅ 提交 metadata.json → 检查 changes/ 被忽略
9. ✅ 关闭编辑器 → 检查 stopTracking() 调用

**预期总耗时**：10-15 分钟

---

## 📝 日志输出参考

### 期望看到的控制台输出

**启动时**：
```
✨ Copilot History Viewer is now active
[ProjectStorage] Created .copilot-log directory
[ProjectStorage] Synced N sessions
[ChangeTracking] Loaded M existing sessions
[Copilot History] Global storage: C:\Users\...\globalStorage\...
[Copilot History] Project log: <workspace>\.copilot-log
```

**启用变更追踪后**：
```
[ChangeTracking] Tracking started
[ChangeTracking] Switched to session: session-abc123
```

**文件保存时**：
```
[ChangeTracking] Recorded change: src/Game.cs lines 42-45
```

**会话切换时**：
```
[ChangeTracking] Saved session session-abc123 to <path>\changes\2026-04-14\session-abc123.json
[ChangeTracking] Switched to session: session-def456
```

**关闭扩展时**：
```
[ChangeTracking] Tracking stopped
Copilot History Viewer deactivated
```

---

## ✅ 检查清单

完成以下所有项目表示实现成功：

- [ ] Phase 1 编译无错误
- [ ] Phase 2 编译无错误
- [ ] 项目级存储初始化成功
- [ ] 元数据同步正确
- [ ] 变更追踪启动成功
- [ ] 编辑变更被记录
- [ ] 会话切换正确保存
- [ ] 人工编辑标记功能正常
- [ ] Git 忽略规则生效
- [ ] 无内存泄漏（长期运行）
- [ ] 控制台日志符合预期

