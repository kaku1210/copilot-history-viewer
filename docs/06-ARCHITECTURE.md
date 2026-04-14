# 三层存储架构 - 系统架构图和数据流

## 🏗️ 系统架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      VSCode Extension Context                    │
│  (vscode.ExtensionContext, vscode.workspace, vscode.window)     │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    extension.ts (main entry)
                    ├─ activate()
                    └─ deactivate()
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │   Layer 1    │ │   Layer 2    │ │   Layer 3    │
        │   (Existing) │ │   (New)      │ │   (New)      │
        ├──────────────┤ ├──────────────┤ ├──────────────┤
        │ DataStorage  │ │ ProjectStorage│ │ChangeTracking│
        │ Service      │ │ Service      │ │ Service      │
        │              │ │              │ │              │
        │ - Load from  │ │ - Sync global│ │ - Monitor    │
        │   Copilot    │ │   to project │ │   file edits │
        │   .jsonl     │ │ - Create     │ │ - Associate  │
        │ - Parse      │ │   .copilot-  │ │   with session│
        │   sessions   │ │   log/       │ │ - Record     │
        │ - Merge      │ │ - Manage tags│ │   line ranges│
        │   cloud data │ │              │ │ - Mark manual│
        │              │ │              │ │   edits      │
        └──────────────┘ └──────────────┘ └──────────────┘
                │             │              │
                └─────────────┼──────────────┘
                              │
                    HistoryWebviewProvider
                    (Phase 3: UI Layer)
```

---

## 📊 数据流拓扑

### 初始化流程

```
Extension Activate
│
├─[1] Create DataStorageService
│     └─> Load global Copilot sessions
│
├─[2] Create ProjectStorageService
│     ├─> Create .copilot-log/ directory
│     ├─> Create .copilot-log/.gitignore
│     └─> Load existing metadata.json
│
├─[3] Create ChangeTrackingService
│     ├─> Inject ProjectStorageService
│     └─> Load existing session change logs
│
├─[4] Create HistoryWebviewProvider
│     ├─> Inject DataStorageService
│     ├─> Inject ProjectStorageService
│     └─> Inject ChangeTrackingService
│
├─[5] Register WebView
├─[6] Register FileSystemWatcher
└─[7] Register 3 new commands
```

---

### 实时事件流 (启用追踪时)

```
┌─────────────────────────────────────────────────────────┐
│        VSCode Editor Events                              │
│                                                          │
│  onDidChangeTextDocument ─────────────────────┐        │
│  onDidSaveTextDocument ──────────────────┐    │        │
│  onDidChangeActiveTextEditor ───────┐    │    │        │
└─────────────────────────────────────────────────────────┘
                                        │    │    │
                                        ▼    ▼    ▼
                        ┌───────────────────────────────┐
                        │  ChangeTrackingService        │
                        │                               │
                        │  onTextChanged()              │
                        │  ├─ Compute line range        │
                        │  └─ recordChange()            │
                        │                               │
                        │  onFileSaved()                │
                        │  └─ recordChange()            │
                        └───────────────────────────────┘
                                        │
                        ┌───────────────┴───────────┐
                        │                           │
                        ▼                           ▼
                ┌──────────────────┐      ┌──────────────────┐
                │  sessionChanges   │      │  sessionChanges   │
                │  Map (in-memory)  │      │  Map (in-memory)  │
                │                  │      │                  │
                │  session-abc:    │      │  session-def:    │
                │  {               │      │  {               │
                │    changes: [...] │      │    changes: [...] │
                │    fileIndex:{}   │      │    fileIndex:{}   │
                │  }               │      │  }               │
                └──────────────────┘      └──────────────────┘
                        │                          │
            Session切换/关闭 ─────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────┐
        │  saveCurrentSession()               │
        │  Write to disk:                     │
        │  .copilot-log/changes/<date>/      │
        │                    <sessionId>.json │
        └────────────────────────────────────┘
```

---

### 会话同步流程

```
┌──────────────────────────────────────────┐
│  DataStorageService                      │
│  loadCopilotSessions()                   │
│  Returns: ChatSession[]                  │
└──────────────────────────────────────────┘
            │
            │ (onFileChange event or manual)
            │
            ▼
┌──────────────────────────────────────────┐
│  FileSystemWatcher detects .jsonl change │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│  provider.refreshIncremental()           │
│  (existing behavior, unchanged)          │
└──────────────────────────────────────────┘
            │
            │ (NEW)
            ▼
┌──────────────────────────────────────────┐
│  if (projectStorage.isEnabled())         │
│  {                                       │
│    dataService.loadCopilotSessions()     │
│    projectStorage.syncSessionsFromGlobal()
│  }                                       │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│  ProjectStorageService.syncSession...()  │
│                                          │
│  Transform: ChatSession -> SessionMeta   │
│  Update: metadata.json                   │
│  Result: {                               │
│    sessionId,                            │
│    title,                                │
│    createdAt/updatedAt,                  │
│    tags,                                 │
│    projectTags                           │
│  }                                       │
└──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│  .copilot-log/metadata.json (updated)    │
└──────────────────────────────────────────┘
```

---

## 🔄 状态转移图

### ProjectStorageService 状态

```
┌──────────────┐
│   Initial    │
│  (disabled)  │
└──────┬───────┘
       │ enableProjectSync = true
       ▼
┌──────────────────────┐
│   Directories        │ ──┐
│   Created            │   │ 
│   (enabled, empty)   │   │ loadState()
└──────┬───────────────┘   │
       │                   ▼
       │ syncSessionsFromGlobal()
       │                   ┌──────────────────────┐
       │                   │ metadata.json loaded │
       └──────────────────>│ (enabled, with data) │
                           └──────────────────────┘
                                    ▲
                                    │
                    (periodic sync or manual refresh)
                                    │
                           updateSessionTags()
```

### ChangeTrackingService 状态

```
┌──────────────┐
│   Inactive   │ enableChangeTracking = false
│  (no tracking)
└──────┬───────┘
       │ enableChangeTracking = true
       ▼
┌──────────────────────────┐
│   startTracking()        │
│   Listeners registered   │ ──┐
└──────┬───────────────────┘   │
       │                       │ setCurrentSession()
       │                       ▼
       │           ┌────────────────────────┐
       │           │ Tracking Active        │
       │           │ Recording changes to:  │
       │           │ sessionChanges[sessionId]
       │           └────┬───────────────────┘
       │                │
       │ (session switch)
       │                │
       │                ▼
       │           ┌────────────────────────┐
       │           │ saveCurrentSession()   │
       │           │ Write to disk:         │
       │           │ .copilot-log/changes/  │
       │           └────────────────────────┘
       │
       │ enableChangeTracking = false
       ▼
┌──────────────────────────┐
│   stopTracking()         │
│   saveCurrentSession()   │
│   Listeners removed      │
└──────────────────────────┘
```

---

## 📦 依赖关系图

```
extension.ts (Bootstrap)
│
├──> DataStorageService
│    ├─> fs, path (Node)
│    ├─> vscode API
│    └─> types.ts
│
├──> ProjectStorageService ◄───┐
│    ├─> fs, path (Node)       │
│    ├─> vscode API             │
│    ├─> types.ts              │
│    └─> No external deps       │
│
├──> ChangeTrackingService
│    ├─> fs, path (Node)
│    ├─> vscode API
│    ├─> ProjectStorageService ←┐ (injected)
│    └─> types.ts               │
│                               │
├──> HistoryWebviewProvider    │
│    ├─> DataStorageService ───┘
│    ├─> ProjectStorageService (injected)
│    ├─> ChangeTrackingService (injected)
│    ├─> GitSyncService
│    └─> types.ts
│
├──> GitSyncService
│    ├─> fs, path (Node)
│    ├─> https (Node)
│    ├─> crypto (Node)
│    └─ types.ts
│
├──> Types.ts
│    ├─> No internal deps
│    └─> Only interface definitions
│
└──> package.json
     └─> Configuration schema
```

**注**：✅ 所有依赖都是单向的，无循环依赖。

---

## 🌳 目录树和数据关系

```
Workspace Root
│
├─── .git/                          ← Version control
│
├─── .copilot-log/                  ← NEW (created by ProjectStorageService)
│    │
│    ├─── .gitignore
│    │    ├─ changes/               (ignored)
│    │    ├─ sync-state.json        (ignored)
│    │    └─ !metadata.json         (optional: track)
│    │
│    ├─── metadata.json
│    │    └─ sessions: [
│    │         { sessionId, title, createdAt, updatedAt, tags, projectTags }
│    │       ]
│    │
│    ├─── sessions.json (optional)
│    │    └─ lightweight session index
│    │
│    ├─── sync-state.json
│    │    └─ version, lastSyncTime
│    │
│    └─── changes/                  ← Created by ChangeTrackingService
│        │
│        └─── 2026-04-14/           ← DateFolder
│            │
│            ├─── session-abc123.json
│            │    └─ {
│            │         sessionId,
│            │         startTime,
│            │         endTime,
│            │         changes: [
│            │           {
│            │             timestamp,
│            │             file,
│            │             lines: { start, end },
│            │             modifiedBy,
│            │             lastModifiedAt
│            │           }
│            │         ],
│            │         fileIndex: {
│            │           "src/Game.cs": [...]
│            │         }
│            │       }
│            │
│            └─── session-def456.json
│                 └─ (similar structure)
│
├─── src/
│    ├─── Game.cs                   ← Source files being tracked
│    └─── ...
│
└─── other files/dirs
```

---

## 🔀 关键接口和协议

### WebView 消息协议（为 Phase 3 预留）

```typescript
// Frontend → Extension
type WebviewMessage =
  | { type: 'toggleProjectSync'; enabled: boolean }
  | { type: 'toggleChangeTracking'; enabled: boolean }
  | { type: 'queryProjectStatus' }
  | { type: 'manualEditMark'; filePath, startLine, endLine }
  | ... (existing types)

// Extension → Frontend
type ExtensionMessage =
  | { type: 'projectStorageStatus'; ... }
  | { type: 'changeTrackingStatus'; ... }
  | ... (existing types)
```

### 配置变更事件流

```
User toggles setting in VSCode UI
            │
            ▼
vscode.workspace.onDidChangeConfiguration
            │
            ├──> extension.ts handles the change
            │    ├─ if enableProjectSync changed
            │    │  └─> toggle command execution
            │    │
            │    └─ if enableChangeTracking changed
            │       └─> toggle command execution
            │
            └──> Services respond to configuration
                 └─> startTracking() / stopTracking()
```

---

## ⚡ 性能特征

### 时间复杂度

| 操作 | 复杂度 | 说明 |
|------|--------|------|
| `setCurrentSession()` | O(1) | Map 查找 |
| `recordChange()` | O(1) | Map 追加 |
| `markManualEdit()` | O(n) | n = 该文件的变更数 |
| `getFileChanges()` | O(n) | n = 总变更数 |
| `syncSessionsFromGlobal()` | O(m) | m = 全局会话数 |

### 空间复杂度

| 数据结构 | 空间 | 说明 |
|---------|------|------|
| sessionChanges Map | O(n*m) | n = 会话数, m = 每会话的变更数 |
| metadata.json | O(s) | s = 会话数，每条记录 ~500B |
| changes/*.json | O(n*m) | 磁盘存储，可归档 |

**估算**（典型场景）：
- 100 个会话 × 50 个变更/会话 = 5000 条变更
- 内存占用: ~2-5 MB
- 磁盘占用: ~5-10 MB (未压缩)

---

## 🧪 测试覆盖重点

### 单元测试点
- ProjectStorageService 目录创建和元数据保存
- ChangeTrackingService 行号范围计算
- 坐标转换逻辑（0-indexed ↔ 1-indexed）

### 集成测试点
- 全局会话到项目存储的同步
- 文件编辑事件关联到会话
- 会话切换时的自动保存
- Git 忽略规则的有效性

### 端到端测试场景
- 新项目初始化 → 启用两个开关 → 编辑代码 → 验证数据
- 多会话切换 → 验证独立存储
- 人工编辑标记 → 验证 modifiedBy 更新

---

## 💡 扩展点（为未来优化）

### 可扩展的地方
1. **缓存策略** - 可优化频繁读取的 metadata.json
2. **压缩** - 可对 changes/*.json 实施 gzip 压缩
3. **数据库** - 可用 SQLite 替代 JSON 存储（性能提升）
4. **导出** - 可实现变更数据的多格式导出（CSV, Parquet）
5. **分析** - 可集成数据分析（代码生产率，修改热点）

### 不应修改的地方
1. 三层架构的分离原则
2. 数据隐私政策（不存代码）
3. 向后兼容性承诺
4. 全局存储的独立性

