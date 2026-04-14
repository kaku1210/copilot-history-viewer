# Copilot History Viewer - 三层存储架构实现总结

## ✅ 已完成的实现

### Phase 1 & 2: 项目级存储 + 编辑追踪

#### 1. 新增文件

**`src/projectStorageService.ts`** (5.4 KB)
- 管理 `<workspace>/.copilot-log/` 目录结构
- 同步全局 ChatSession 到项目级元数据
- 自动创建 `.copilot-log/` 和子目录
- 生成 `.copilot-log/.gitignore` 配置
- 提供项目日志路径和变更目录访问接口

**`src/changeTrackingService.ts`** (9.1 KB)
- 监听文件保存和文本编辑事件
- 关联变更到当前 Copilot 会话 ID
- 记录行号范围 (不存储代码内容)
- 跟踪修改来源 (`copilot` / `manual` / `other`)
- 自动生成 `<date>/<sessionId>.json` 变更日志
- 支持人工编辑标记 (markManualEdit)

**`src/types.ts`** (扩展)
- 新增 `ProjectStorageMessage` 类型
- 新增 `ProjectStorageStatus` 接口

#### 2. 修改的文件

**`package.json`**
- 新增配置项：
  - `copilotHistoryViewer.enableProjectSync` (默认: false)
  - `copilotHistoryViewer.enableChangeTracking` (默认: false)

**`src/extension.ts`** (完整重写)
- 初始化 ProjectStorageService 和 ChangeTrackingService
- 添加 7 个新命令：
  - `copilotHistory.toggleProjectSync` - 切换项目级存储
  - `copilotHistory.toggleChangeTracking` - 切换变更追踪
  - `copilotHistory.markManualEdit` - 标记人工编辑
  - 其他 3 个命令（现有功能）
- 监听全局存储变更，自动同步到项目存储
- Copilot .jsonl 文件变化时自动触发同步
- 启用变更追踪时自动开始监听
- 关闭扩展时自动保存当前会话

**`src/webviewProvider.ts`** (导入扩展)
- 新增 ProjectStorageService 和 ChangeTrackingService 注入
- 为后续 UI 层集成预留接口

---

## 📊 数据存储结构

### 项目级存储 (`.copilot-log/metadata.json`)
```json
{
  "version": "1.0.0",
  "sessions": [
    {
      "sessionId": "uuid-xxx",
      "title": "Conversation Title",
      "createdAt": "2026-04-14T10:00:00Z",
      "updatedAt": "2026-04-14T10:30:00Z",
      "tags": [],
      "projectTags": ["game-design", "implementation"]
    }
  ],
  "lastSyncTime": "2026-04-14T10:35:00Z"
}
```

### 编辑变更日志 (`.copilot-log/changes/2026-04-14/session-xxx.json`)
```json
{
  "sessionId": "session-abc123",
  "startTime": "2026-04-14T10:00:00Z",
  "endTime": "2026-04-14T10:05:00Z",
  "changes": [
    {
      "timestamp": "2026-04-14T10:01:00Z",
      "file": "src/Game.cs",
      "lines": { "start": 42, "end": 45 },
      "modifiedBy": "copilot",
      "lastModifiedAt": "2026-04-14T10:01:00Z"
    },
    {
      "timestamp": "2026-04-14T10:02:00Z",
      "file": "src/Game.cs",
      "lines": { "start": 50, "end": 55 },
      "modifiedBy": "manual",
      "lastModifiedAt": "2026-04-14T10:02:30Z"
    }
  ],
  "fileIndex": {
    "src/Game.cs": [
      {
        "lines": { "start": 42, "end": 45 },
        "modifiedBy": "copilot",
        "lastModifiedAt": "2026-04-14T10:01:00Z"
      }
    ]
  }
}
```

---

## 🔧 使用流程

### 启用项目级存储
1. 打开设置: `Ctrl+,` (或 `Cmd+,`)
2. 搜索 `copilotHistoryViewer.enableProjectSync`
3. 勾选启用
4. 插件自动同步全局会话到 `.copilot-log/metadata.json`
5. 可选：提交 `metadata.json` 到 Git

### 启用代码变更追踪
1. 打开设置: 搜索 `copilotHistoryViewer.enableChangeTracking`
2. 勾选启用
3. 插件自动开始监听文件变更
4. 当前 Copilot 会话的代码编辑被记录到:
   `.copilot-log/changes/<date>/<sessionId>.json`

### 标记人工编辑
```javascript
// 通过命令触发 (编辑器中选中代码后)
vscode.commands.executeCommand(
    'copilotHistory.markManualEdit',
    'src/Game.cs',
    42,  // startLine
    45   // endLine
);
```

---

## 🚀 后续计划 (Phase 3)

### UI 层集成
- [ ] 在侧边栏显示当前激活会话 ID（启用追踪时）
- [ ] 显示项目级存储和变更追踪的开关状态
- [ ] 快速切换按钮
- [ ] 显示当日变更统计

### 编辑器装饰 (类似 GitLens)
- [ ] 在行号旁显示彩色块（表示哪个会话修改）
- [ ] 悬浮提示：会话 ID、修改时间、修改来源
- [ ] 快速命令菜单标记人工编辑

### 日期管理
- [ ] 自动按日期分组存储变更日志
- [ ] 旧记录自动归档或删除策略

---

## ✅ 编译和测试

### 编译检查
```bash
cd G:\Test\copilot-history-viewer
npm install  # 如需更新依赖
npm run compile
```

### 打包
```bash
npm run package
```

生成: `copilot-history-viewer-<version>.vsix`

### 测试清单

- [ ] **启用项目级存储**
  - [ ] 创建 `.copilot-log/` 目录
  - [ ] 生成 `.copilot-log/.gitignore`
  - [ ] 生成 `metadata.json`
  - [ ] 会话列表同步正确

- [ ] **启用变更追踪**
  - [ ] 监听文件保存事件
  - [ ] 生成 `.copilot-log/changes/<date>/` 目录
  - [ ] 记录变更到 `<sessionId>.json`
  - [ ] 行号范围计算正确

- [ ] **会话切换**
  - [ ] 切换 sessionId 时自动保存前一个会话
  - [ ] 新会话创建新的 JSON 文件
  - [ ] 多个会话同时存在

- [ ] **人工编辑标记**
  - [ ] markManualEdit 更新 modifiedBy 字段
  - [ ] 范围检测准确（重叠判断）

- [ ] **Git 集成**
  - [ ] `.copilot-log/.gitignore` 有效
  - [ ] 可选提交 `metadata.json`
  - [ ] 忽略原始数据文件 (`changes/`, `sync-state.json`)

---

## 📝 关键设计决策

1. **不存储代码内容** - 仅记录行号和修改元数据
2. **按会话分组** - 所有编辑与会话 ID 关联
3. **自动目录创建** - 首次启用时自动初始化
4. **防抖存储** - 编辑时内存更新，会话结束时批量写入
5. **灵活的修改来源** - 支持 3 种标记，易于扩展

---

## 🔄 与现有功能的集成

- ✅ 不破坏现有的全局存储 (globalStorage)
- ✅ 不影响现有的 Git 同步功能
- ✅ WebView 侧边栏兼容扩展
- ✅ 配置项独立，不影响现有设置
- ✅ 命令集合扩展，保持向后兼容

