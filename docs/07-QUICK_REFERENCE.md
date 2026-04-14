# 快速参考卡片

## 📁 文件位置清单

```
G:\Test\copilot-history-viewer\
├── src/
│   ├── extension.ts                    ← 已修改（新增3个命令）
│   ├── webviewProvider.ts              ← 已修改（导入扩展）
│   ├── types.ts                        ← 已修改（新增类型）
│   ├── dataStorage.ts                  ← 保持不变
│   ├── gitSyncService.ts               ← 保持不变
│   ├── projectStorageService.ts        ← ⭐ 新增（5.4 KB）
│   └── changeTrackingService.ts        ← ⭐ 新增（9.1 KB）
├── package.json                        ← 已修改（新增2个配置项）
├── tsconfig.json
├── .gitignore
└── ... (其他文件不变)
```

---

## 🔧 核心 API 速查

### ProjectStorageService

```typescript
import { ProjectStorageService } from './projectStorageService';

const service = new ProjectStorageService(workspaceUri);

// 核心方法
service.syncSessionsFromGlobal(sessions);        // 同步全局会话
service.getProjectSessions();                    // 获取项目会话
service.updateSessionTags(sessionId, tags);      // 更新标签
service.getProjectLogDir();                      // 获取目录路径
service.getChangesDir();                         // 获取变更目录
service.isEnabled();                             // 检查启用状态
service.isChangeTrackingEnabled();               // 检查追踪启用
```

**配置项**：
- `copilotHistoryViewer.enableProjectSync` (boolean, default: false)

---

### ChangeTrackingService

```typescript
import { ChangeTrackingService } from './changeTrackingService';

const service = new ChangeTrackingService(projectStorage);

// 会话管理
service.setCurrentSession(sessionId);            // 设置活跃会话
service.getCurrentSession();                     // 获取当前会话

// 追踪控制
service.startTracking();                         // 开始监听
service.stopTracking();                          // 停止并保存

// 变更操作
service.recordChange(change);                    // 记录变更
service.markManualEdit(file, startLine, endLine);// 标记人工编辑
service.getFileChanges(filePath);                // 查询文件变更

// 自动调用（内部）
service.saveCurrentSession();                    // 保存当前会话
```

**配置项**：
- `copilotHistoryViewer.enableChangeTracking` (boolean, default: false)

---

## 📊 数据结构速查

### LineChange
```typescript
interface LineChange {
  timestamp: string;                      // ISO 8601 时间戳
  file: string;                          // 相对路径
  lines: { start: number; end: number }; // 1-indexed 行号
  modifiedBy: 'copilot' | 'manual' | 'other';
  lastModifiedAt: string;                // ISO 8601 时间戳
}
```

### SessionChangeLog
```typescript
interface SessionChangeLog {
  sessionId: string;
  startTime: string;
  endTime?: string;
  changes: LineChange[];
  fileIndex: {
    [filePath: string]: Array<{
      lines: { start: number; end: number };
      modifiedBy: 'copilot' | 'manual' | 'other';
      lastModifiedAt: string;
    }>;
  };
}
```

---

## 🎯 命令速查

### VSCode 命令面板调用

```bash
# 切换项目级存储
> Copilot History: Toggle Project Sync
Command: copilotHistory.toggleProjectSync

# 切换代码变更追踪
> Copilot History: Toggle Change Tracking
Command: copilotHistory.toggleChangeTracking

# 标记人工编辑
Command: copilotHistory.markManualEdit
参数: (filePath: string, startLine: number, endLine: number)
```

### 程序化调用

```typescript
// 切换项目同步
await vscode.commands.executeCommand('copilotHistory.toggleProjectSync');

// 切换变更追踪
await vscode.commands.executeCommand('copilotHistory.toggleChangeTracking');

// 标记人工编辑
await vscode.commands.executeCommand(
  'copilotHistory.markManualEdit',
  'src/Game.cs',
  42,
  45
);
```

---

## 📍 存储位置速查

### 全局存储（既有，不变）
```
%APPDATA%\Code\User\globalStorage\local-dev.copilot-history-viewer\
├── metadata.json
├── cache/
├── git-sync-config.json
└── git-sync-state.json
```

### 项目存储（新增）
```
<workspace>/.copilot-log/
├── .gitignore
├── metadata.json          ← 会话列表
├── sessions.json          ← 可选
├── sync-state.json        ← 同步状态（被忽略）
└── changes/               ← 变更日志
    └── 2026-04-14/
        ├── session-abc123.json
        └── session-def456.json
```

---

## ✅ 配置项速查

### 在 VSCode 设置中

```json
{
  "copilotHistoryViewer.customStoragePath": "",
  "copilotHistoryViewer.enableProjectSync": false,
  "copilotHistoryViewer.enableChangeTracking": false
}
```

### 程序化设置

```typescript
const config = vscode.workspace.getConfiguration('copilotHistoryViewer');

// 读取配置
const enabled = config.get<boolean>('enableProjectSync', false);

// 修改配置
await config.update(
  'enableProjectSync',
  true,
  vscode.ConfigurationTarget.Workspace
);
```

---

## 🔄 事件流速查

### 启动流程
```
Extension Activate
├─> DataStorageService init
├─> ProjectStorageService init (创建目录结构)
├─> ChangeTrackingService init (加载已存存储)
├─> HistoryWebviewProvider init
├─> 注册 3 个新命令
├─> 注册文件监听器
└─> 如果 changeTracking 启用 → startTracking()
```

### 文件变更流程
```
onDidChangeTextDocument / onDidSaveTextDocument
└─> ChangeTrackingService.onTextChanged()
    ├─> 检查当前会话 ID
    ├─> 计算受影响行号范围
    └─> recordChange() → 添加到内存 Map
```

### 会话切换流程
```
setCurrentSession(newSessionId)
├─> 保存当前会话: saveCurrentSession()
│   └─> 写入 changes/<date>/<oldSessionId>.json
└─> 切换到新会话
    └─> 开始记录新的变更
```

### 关闭流程
```
Extension Deactivate
└─> changeTrackingService.stopTracking()
    └─> saveCurrentSession() (保存最后一个会话)
```

---

## 🧪 测试检查列表

### 最小化验证（5分钟）
- [ ] 编译无错误: `npm run compile`
- [ ] 启用项目同步
- [ ] 检查 `.copilot-log/` 创建
- [ ] 检查 `metadata.json` 生成

### 完整验证（15分钟）
- [ ] 启用变更追踪
- [ ] 编辑代码并保存
- [ ] 检查 `changes/` 目录和 JSON 文件生成
- [ ] 验证行号范围记录
- [ ] 检查 modifiedBy 字段

### 高级验证（30分钟）
- [ ] 多会话切换测试
- [ ] 标记人工编辑测试
- [ ] Git 忽略规则验证
- [ ] 内存使用监控
- [ ] 性能基准测试

---

## 🐛 调试技巧

### 启用详细日志
```typescript
// 在 extension.ts 中
console.log('[ProjectStorage] Synced N sessions');
console.log('[ChangeTracking] Switched to session: xxx');
console.log('[ChangeTracking] Recorded change: file lines X-Y');
```

### 检查配置状态
```javascript
const config = vscode.workspace.getConfiguration('copilotHistoryViewer');
console.log('Project Sync:', config.get('enableProjectSync'));
console.log('Change Tracking:', config.get('enableChangeTracking'));
```

### 检查文件系统状态
```bash
# 查看目录结构
tree .copilot-log

# 查看 JSON 内容
cat .copilot-log/metadata.json | jq '.'
cat .copilot-log/changes/2026-04-14/*.json | jq '.'

# 查看 Git 状态
git status .copilot-log
```

---

## 📞 快速问题排查

| 问题 | 原因 | 解决 |
|------|------|------|
| `.copilot-log/` 未创建 | 项目存储未启用 | 勾选 enableProjectSync |
| 变更未被记录 | 变更追踪未启用 | 勾选 enableChangeTracking |
| JSON 格式错误 | 文件损坏或解析错误 | 检查文件编码和语法 |
| 性能下降 | 监听器过多 | 确认只有一个实例在运行 |
| Git 冲突 | 多人修改 metadata.json | 使用 Git 合并策略 |

---

## 💾 版本信息

- **插件版本**: 1.0.32+
- **TypeScript**: 5.3.0+
- **VSCode**: 1.85.0+
- **Node**: 16.0.0+
- **架构**: 三层存储 (Global + Project + Changes)

---

## 📚 相关文档

- `plan.md` - 详细规划
- `IMPLEMENTATION_SUMMARY.md` - 实现详情
- `TESTING_GUIDE.md` - 测试指南
- `CODE_REVIEW.md` - 代码审查
- `COMPLETION_REPORT.md` - 完成报告

---

**快速链接**：
- 项目主目录: `G:\Test\copilot-history-viewer`
- 源代码目录: `G:\Test\copilot-history-viewer\src`
- 配置文件: `G:\Test\copilot-history-viewer\package.json`

