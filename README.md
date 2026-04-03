# Copilot History Viewer

在 VS Code 侧边栏中查看、搜索、管理你的 GitHub Copilot Chat 历史记录。

---

## 安装方法（VSIX 离线安装）

### 方法一：命令行安装（推荐）

```bash
code --install-extension copilot-history-viewer-0.0.1.vsix
```

### 方法二：VS Code 界面安装

1. 打开 VS Code
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 点击右上角的 **`···`** 菜单
4. 选择 **「从 VSIX 安装...」**（Install from VSIX...）
5. 找到并选中 `copilot-history-viewer-0.0.1.vsix`
6. 安装完成后按 `Ctrl+Shift+P` → `Reload Window`

### 方法三：拖拽安装

直接将 `.vsix` 文件拖入 VS Code 扩展面板即可。

---

## 使用方法

安装后，点击左侧活动栏的 **💬 聊天气泡图标** 打开 Chat History 面板。

---

## 功能说明

### � 搜索与筛选

| 功能 | 说明 |
|------|------|
| **关键词搜索** | 搜索对话标题、内容、备注 |
| **日期筛选** | 点击「� 日期」按钮，支持单日和范围两种模式 |
| **归档筛选** | 下拉选择：未归档 / 已归档 / 全部显示 |
| **排序** | 按对话更新时间 / 创建时间排序 |

### � 日历筛选

- **单日模式**：点击某天直接筛选当天记录
- **范围模式**：点击开始日期 → 点击结束日期，可多选筛选方式：
  - 任意对话在日期内（默认）
  - 只要有一个提问在日期内
  - 只要提问开始时间在日期内
  - 必须全部在日期内

### � 置顶

- 悬停对话条目 → 点击 📌 按钮
- **置顶到当前列表**：仅在当前筛选视图中置顶
- **完全置顶**：无论归档状态，始终显示在最顶部
- 多个置顶按操作先后顺序排列

### 📝 备注

- 对话级备注：悬停 → 点击 📝 图标
- 提问级备注：展开对话后，悬停提问 → 点击 📝 图标

### 📦 归档 / 🗑️ 删除

- 悬停对话条目，点击 📦（归档）或 🗑️（删除）
- 删除为软删除，记录存于 `globalStorage/metadata.json`

### ⏰ 时间显示

- 对话列表：显示创建时间 + 最后更新时间
- 展开详情：每条提问和每条回复均显示时间戳

### 🔄 刷新

- 点击「� 刷新」按钮重新加载全部记录
- 刷新时清空搜索词，其他筛选条件保持不变

---

## 数据说明

- **读取来源**（只读）：
  `%APPDATA%\Code\User\workspaceStorage\**\chatSessions\*.jsonl`
- **附加数据**（备注、归档、置顶）存储于：
  `%APPDATA%\Code\User\globalStorage\local-dev.copilot-history-viewer\metadata.json`
- 插件不会修改 Copilot 原始数据

---

## 系统要求

- VS Code `1.80.0` 或更高版本
- Windows（路径依赖 `%APPDATA%\Code`）
- 已安装并使用过 GitHub Copilot Chat

---

## 常见问题

**Q：侧边栏没有出现图标？**  
A：执行 `Ctrl+Shift+P` → `Reload Window`，或完全重启 VS Code。

**Q：列表为空，没有记录？**  
A：确认已使用过 Copilot Chat，再点击刷新按钮。

**Q：部分对话内容显示不完整？**  
A：Copilot Chat 使用增量 JSONL 格式存储，插件会尽力重建完整对话，极少数格式异常的记录可能丢失部分内容。