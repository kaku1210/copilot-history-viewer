# Git 推送冲突解决方案

## 问题描述

你遇到了 Git 推送被拒绝的错误：
```
Updates were rejected because the remote contains work that you do not have locally.
```

这意味着远程仓库（GitHub）上有本地没有的提交。

## ✅ 解决方法

### 方法 1: 自动脚本（推荐）

```bash
cd G:\Test\copilot-history-viewer

# 运行冲突解决脚本
node resolve-git-conflict.js
```

脚本会自动执行：
1. 检查本地更改
2. 执行 `git pull` 同步远程
3. 如有冲突，会提示手动处理
4. 执行 `git push` 推送更改

### 方法 2: 手动操作

```bash
# 1. 进入项目目录
cd G:\Test\copilot-history-viewer

# 2. 检查当前状态
git status

# 3. 提交本地更改（如有）
git add .
git commit -m "docs: Add migration scripts and documentation"

# 4. 从远程获取最新代码
git pull origin main

# 5. 如果有冲突，在编辑器中手动解决，然后：
git add .
git commit -m "Merge remote changes"

# 6. 推送到远程
git push origin main
```

## 📊 预期流程

```
┌─────────────────┐
│ 本地代码        │
│ (你的修改)      │
└────────┬────────┘
         │
         ├─ git pull
         │  └─> 获取远程最新代码
         │
┌────────▼────────┐
│ 合并结果        │
│ (本地+远程)     │
└────────┬────────┘
         │
         ├─ git push
         │  └─> 推送到远程
         │
┌────────▼────────┐
│ 远程仓库        │
│ (GitHub)        │
└─────────────────┘
```

## 🔍 如果有合并冲突

如果 `git pull` 显示冲突：

1. **识别冲突文件**
   ```bash
   git status
   # 显示 "both modified" 的文件
   ```

2. **编辑冲突文件**
   - 打开显示冲突的文件
   - 查找冲突标记：
     ```
     <<<<<<< HEAD
     你的代码
     =======
     远程代码
     >>>>>>>
     ```
   - 决定保留哪个版本或合并它们
   - 删除冲突标记

3. **完成合并**
   ```bash
   git add .
   git commit -m "Resolve merge conflicts"
   git push origin main
   ```

## 💡 最佳实践

- 经常执行 `git pull` 保持同步
- 在推送前总是先 pull
- 使用清晰的提交消息
- 遇到冲突不用害怕，这很正常

## 📞 常见情况

### 情况 1: 只有远程有新提交
```bash
git pull origin main
git push origin main
```

### 情况 2: 本地有未提交的更改
```bash
git add .
git commit -m "Your message"
git pull origin main
git push origin main
```

### 情况 3: 有合并冲突
```bash
git pull origin main
# 编辑冲突文件
git add .
git commit -m "Resolve merge conflicts"
git push origin main
```

---

**推荐**: 使用方法 1 的自动脚本，最简单快速！
