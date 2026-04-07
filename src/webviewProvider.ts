import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DataStorageService } from './dataStorage';
import { GitSyncService } from './gitSyncService';
import { WebviewMessage, SessionFilter } from './types';

export class HistoryWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'copilotHistoryView';
    private _view?: vscode.WebviewView;
    private _lastFilter?: SessionFilter;
    private _gitSync: GitSyncService;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly dataService: DataStorageService,
    ) {
        this._gitSync = new GitSyncService(dataService.getGlobalStoragePath());
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // 处理来自 WebView 的消息
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            switch (message.type) {
                case 'ready':
                case 'refresh':
                    await this.sendSessionsToWebview();
                    break;

                case 'requestSessions':
                    await this.sendSessionsToWebview(message.filter);
                    break;

                case 'requestTurns':
                    await this.sendTurnsToWebview(message.sessionId);
                    break;

                case 'updateNote':
                    if (message.turnId) {
                        this.dataService.updateTurnNote(message.sessionId, message.turnId, message.note);
                    } else {
                        this.dataService.updateSessionNote(message.sessionId, message.note);
                    }
                    this.postMessage({ type: 'updateSuccess', message: '备注已保存' });
                    break;

                case 'archiveSession':
                    this.dataService.archiveSession(message.sessionId);
                    await this.sendSessionsToWebview();
                    this.postMessage({ type: 'updateSuccess', message: '已归档' });
                    break;

                case 'unarchiveSession':
                    this.dataService.unarchiveSession(message.sessionId);
                    await this.sendSessionsToWebview();
                    this.postMessage({ type: 'updateSuccess', message: '已取消归档' });
                    break;

                case 'deleteSession':
                    this.dataService.deleteSession(message.sessionId);
                    await this.sendSessionsToWebview();
                    this.postMessage({ type: 'updateSuccess', message: '已删除' });
                    break;

                case 'editTurnContent':
                    this.dataService.editTurnContent(message.sessionId, message.turnId, message.content);
                    this.postMessage({ type: 'updateSuccess', message: '内容已修改' });
                    break;

                case 'pinSession':
                    this.dataService.pinSession(message.sessionId, message.pinType);
                    await this.sendSessionsToWebview(this._lastFilter);
                    this.postMessage({ type: 'updateSuccess', message: message.pinType === 'global' ? '已完全置顶' : '已置顶到当前列表' });
                    break;

                case 'unpinSession':
                    this.dataService.unpinSession(message.sessionId);
                    await this.sendSessionsToWebview(this._lastFilter);
                    this.postMessage({ type: 'updateSuccess', message: '已取消置顶' });
                    break;

                case 'getGitConfig':
                    this.postMessage({ type: 'gitConfigData', config: this._gitSync.getConfig() });
                    break;

                case 'saveGitConfig':
                    this._gitSync.saveConfig(message.config);
                    // 验证连接
                    const testResult = await this._gitSync.testConnection();
                    this.postMessage({ type: 'gitSyncStatus', status: testResult.ok ? 'success' : 'error', message: testResult.message });
                    break;

                case 'gitPush': {
                    if (!this._gitSync.isConfigured()) {
                        this.postMessage({ type: 'gitSyncStatus', status: 'error', message: '请先配置 GitHub 私有仓库' });
                        break;
                    }
                    this.postMessage({ type: 'gitSyncStatus', status: 'syncing', message: '正在推送...' });
                    try {
                        const metaContent = this.dataService.getRawMetadata();
                        const sessions = await this.dataService.getSessions({ archiveMode: 'all' });
                        await this._gitSync.push(metaContent, sessions, (msg) => {
                            this.postMessage({ type: 'gitSyncStatus', status: 'syncing', message: msg });
                        });
                        this.postMessage({ type: 'gitSyncStatus', status: 'success', message: '✅ 推送成功' });
                    } catch (e: any) {
                        this.postMessage({ type: 'gitSyncStatus', status: 'error', message: '❌ ' + (e.message || '推送失败') });
                    }
                    break;
                }

                case 'gitPull': {
                    if (!this._gitSync.isConfigured()) {
                        this.postMessage({ type: 'gitSyncStatus', status: 'error', message: '请先配置 GitHub 私有仓库' });
                        break;
                    }
                    this.postMessage({ type: 'gitSyncStatus', status: 'syncing', message: '正在拉取...' });
                    try {
                        const content = await this._gitSync.pull((msg) => {
                            this.postMessage({ type: 'gitSyncStatus', status: 'syncing', message: msg });
                        });
                        if (content) {
                            this.dataService.applyRawMetadata(content);
                            await this.sendSessionsToWebview(this._lastFilter);
                            this.postMessage({ type: 'gitSyncStatus', status: 'success', message: '✅ 拉取成功，数据已更新' });
                        } else {
                            this.postMessage({ type: 'gitSyncStatus', status: 'success', message: '远端暂无数据' });
                        }
                    } catch (e: any) {
                        this.postMessage({ type: 'gitSyncStatus', status: 'error', message: '❌ ' + (e.message || '拉取失败') });
                    }
                    break;
                }
            }
        });

        // 自动拉取
        const cfg = this._gitSync.getConfig();
        if (cfg?.autoSync && this._gitSync.isConfigured()) {
            this._gitSync.pull().then(content => {
                if (content) {
                    this.dataService.applyRawMetadata(content);
                }
            }).catch(() => {});
        }
    }

    public async refresh() {
        if (this._view) {
            await this.sendSessionsToWebview();
        }
    }

    private async sendSessionsToWebview(filter?: SessionFilter) {
        if (filter !== undefined) { this._lastFilter = filter; }
        const sessions = await this.dataService.getSessions(this._lastFilter);
        this.postMessage({ type: 'sessionsData', sessions });
    }

    private async sendTurnsToWebview(sessionId: string) {
        const sessions = await this.dataService.getSessions();
        const session = sessions.find(s => s.sessionId === sessionId);
        if (session) {
            this.postMessage({ type: 'turnsData', sessionId, turns: session.turns });
        }
    }

    private postMessage(message: any) {
        this._view?.webview.postMessage(message);
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const htmlPath = path.join(this.extensionUri.fsPath, 'media', 'webview.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');
        html = html.replace(/NONCE_PLACEHOLDER/g, nonce);
        return html;
    }

    private _getHtmlContent_OLD(webview: vscode.Webview): string {
        return /*html*/ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --border: var(--vscode-panel-border, #333);
            --hover: var(--vscode-list-hoverBackground);
            --active: var(--vscode-list-activeSelectionBackground);
            --active-fg: var(--vscode-list-activeSelectionForeground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border, #444);
            --btn-bg: var(--vscode-button-background);
            --btn-fg: var(--vscode-button-foreground);
            --badge-bg: var(--vscode-badge-background);
            --badge-fg: var(--vscode-badge-foreground);
            --accent: var(--vscode-focusBorder, #007acc);
            --note-bg: #2d2a1e;
            --archive-bg: #1e2a2d;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--fg);
            background: var(--bg);
            overflow-x: hidden;
        }

        /* ========== 顶部工具栏 ========== */
        .toolbar {
            position: sticky;
            top: 0;
            z-index: 100;
            background: var(--bg);
            padding: 8px;
            border-bottom: 1px solid var(--border);
        }

        .search-row {
            display: flex;
            gap: 4px;
            margin-bottom: 6px;
        }

        .search-input {
            flex: 1;
            padding: 4px 8px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 3px;
            outline: none;
            font-size: 12px;
        }

        .search-input:focus {
            border-color: var(--accent);
        }

        .icon-btn {
            background: transparent;
            border: none;
            color: var(--fg);
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 3px;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .icon-btn:hover {
            background: var(--hover);
        }

        .filter-row {
            display: flex;
            gap: 4px;
            align-items: center;
            flex-wrap: wrap;
        }

        .date-input {
            padding: 2px 6px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 3px;
            font-size: 11px;
            width: 120px;
        }

        .date-input:focus {
            border-color: var(--accent);
            outline: none;
        }

        .filter-label {
            font-size: 11px;
            opacity: 0.7;
        }

        .toggle-btn {
            font-size: 11px;
            padding: 2px 8px;
            background: var(--input-bg);
            color: var(--fg);
            border: 1px solid var(--input-border);
            border-radius: 3px;
            cursor: pointer;
        }

        .toggle-btn.active {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border-color: var(--btn-bg);
        }

        /* ========== 日历面板 ========== */
        .calendar-panel {
            display: none;
            padding: 8px;
            border-bottom: 1px solid var(--border);
            background: var(--bg);
        }

        .calendar-panel.visible {
            display: block;
        }

        .calendar-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .calendar-header span {
            font-size: 13px;
            font-weight: bold;
        }

        .calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
            text-align: center;
        }

        .calendar-grid .day-header {
            font-size: 10px;
            opacity: 0.5;
            padding: 4px 0;
        }

        .calendar-grid .day {
            font-size: 11px;
            padding: 4px 2px;
            border-radius: 3px;
            cursor: pointer;
            position: relative;
        }

        .calendar-grid .day:hover {
            background: var(--hover);
        }

        .calendar-grid .day.has-data {
            font-weight: bold;
            color: var(--accent);
        }

        .calendar-grid .day.has-data::after {
            content: '';
            position: absolute;
            bottom: 1px;
            left: 50%;
            transform: translateX(-50%);
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: var(--accent);
        }

        .calendar-grid .day.selected {
            background: var(--btn-bg);
            color: var(--btn-fg);
        }

        .calendar-grid .day.other-month {
            opacity: 0.3;
        }

        .calendar-grid .day.today {
            border: 1px solid var(--accent);
        }

        /* ========== 统计信息 ========== */
        .stats {
            padding: 4px 8px;
            font-size: 11px;
            opacity: 0.6;
            border-bottom: 1px solid var(--border);
        }

        /* ========== 第一层：会话列表 ========== */
        .session-list {
            list-style: none;
        }

        .session-item {
            border-bottom: 1px solid var(--border);
        }

        .session-header {
            display: flex;
            align-items: center;
            padding: 8px;
            cursor: pointer;
            gap: 6px;
            transition: background 0.15s;
        }

        .session-header:hover {
            background: var(--hover);
        }

        .session-header.expanded {
            background: var(--hover);
        }

        .arrow {
            font-size: 10px;
            transition: transform 0.2s;
            flex-shrink: 0;
            width: 16px;
            text-align: center;
        }

        .arrow.expanded {
            transform: rotate(90deg);
        }

        .session-info {
            flex: 1;
            min-width: 0;
        }

        .session-title {
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .session-meta {
            font-size: 11px;
            opacity: 0.6;
            display: flex;
            gap: 8px;
            margin-top: 2px;
        }

        .session-badge {
            font-size: 10px;
            padding: 1px 6px;
            border-radius: 8px;
            background: var(--badge-bg);
            color: var(--badge-fg);
        }

        .session-note {
            font-size: 11px;
            color: #e8a838;
            margin-top: 2px;
            font-style: italic;
        }

        .session-actions {
            display: none;
            gap: 2px;
            flex-shrink: 0;
        }

        .session-header:hover .session-actions {
            display: flex;
        }

        .action-btn {
            background: transparent;
            border: none;
            color: var(--fg);
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 12px;
            opacity: 0.6;
        }

        .action-btn:hover {
            opacity: 1;
            background: var(--hover);
        }

        /* ========== 第二层：提问列表 ========== */
        .turns-container {
            display: none;
            padding-left: 16px;
            border-left: 2px solid var(--accent);
            margin-left: 12px;
        }

        .turns-container.visible {
            display: block;
        }

        .turn-item {
            border-bottom: 1px solid var(--border);
        }

        .turn-header {
            display: flex;
            align-items: flex-start;
            padding: 6px 8px;
            cursor: pointer;
            gap: 6px;
            transition: background 0.15s;
        }

        .turn-header:hover {
            background: var(--hover);
        }

        .turn-question {
            flex: 1;
            min-width: 0;
        }

        .turn-question-text {
            font-size: 12px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .turn-meta {
            font-size: 10px;
            opacity: 0.5;
            margin-top: 2px;
        }

        .turn-note {
            font-size: 10px;
            color: #e8a838;
            font-style: italic;
            margin-top: 2px;
        }

        .turn-actions {
            display: none;
            gap: 2px;
            flex-shrink: 0;
        }

        .turn-header:hover .turn-actions {
            display: flex;
        }

        /* ========== 第三层：回复内容 ========== */
        .turn-content {
            display: none;
            padding: 8px 8px 8px 28px;
            background: rgba(255,255,255,0.02);
        }

        .turn-content.visible {
            display: block;
        }

        .response-item {
            margin-bottom: 12px;
            padding: 8px;
            border-radius: 4px;
            background: rgba(255,255,255,0.03);
            border-left: 3px solid var(--accent);
        }

        .response-role {
            font-size: 10px;
            text-transform: uppercase;
            opacity: 0.5;
            margin-bottom: 4px;
            font-weight: bold;
        }

        .response-text {
            font-size: 12px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* ========== 备注编辑 ========== */
        .note-editor {
            display: none;
            padding: 6px 8px;
            gap: 4px;
        }

        .note-editor.visible {
            display: flex;
        }

        .note-editor input {
            flex: 1;
            padding: 3px 6px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--accent);
            border-radius: 3px;
            font-size: 11px;
            outline: none;
        }

        .note-editor button {
            padding: 3px 8px;
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }

        /* ========== 空状态 ========== */
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            opacity: 0.5;
        }

        .empty-state .icon {
            font-size: 48px;
            margin-bottom: 12px;
        }

        .empty-state p {
            font-size: 13px;
        }

        /* ========== 加载状态 ========== */
        .loading {
            text-align: center;
            padding: 20px;
        }

        .loading::after {
            content: '';
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid var(--border);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* ========== Toast 通知 ========== */
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 8px 16px;
            background: var(--btn-bg);
            color: var(--btn-fg);
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s;
        }

        .toast.visible {
            opacity: 1;
            transform: translateY(0);
        }

        /* 代码块 */
        .response-text code {
            background: rgba(255,255,255,0.1);
            padding: 1px 4px;
            border-radius: 2px;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        .response-text pre {
            background: rgba(0,0,0,0.3);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }
    </style>
</head>
<body>
    <!-- 工具栏 -->
    <div class="toolbar">
        <div class="search-row">
            <input class="search-input" id="searchInput" type="text" placeholder="搜索对话内容..." />
            <button class="icon-btn" id="calendarBtn" title="日历">📅</button>
            <button class="icon-btn" id="refreshBtn" title="刷新">🔄</button>
        </div>
        <div class="filter-row">
            <span class="filter-label">从</span>
            <input class="date-input" id="dateFrom" type="date" />
            <span class="filter-label">到</span>
            <input class="date-input" id="dateTo" type="date" />
            <button class="toggle-btn" id="archiveToggle">显示归档</button>
        </div>
    </div>

    <!-- 日历面板 -->
    <div class="calendar-panel" id="calendarPanel">
        <div class="calendar-header">
            <button class="icon-btn" id="prevMonth">◀</button>
            <span id="calendarTitle">2025年1月</span>
            <button class="icon-btn" id="nextMonth">▶</button>
        </div>
        <div class="calendar-grid" id="calendarGrid"></div>
    </div>

    <!-- 统计信息 -->
    <div class="stats" id="stats">加载中...</div>

    <!-- 会话列表 -->
    <ul class="session-list" id="sessionList"></ul>

    <!-- 空状态 -->
    <div class="empty-state" id="emptyState" style="display:none;">
        <div class="icon">💬</div>
        <p>暂无聊天记录</p>
        <p style="font-size:11px;margin-top:8px;">使用 Copilot Chat 后，历史记录会显示在这里</p>
    </div>

    <!-- 加载状态 -->
    <div class="loading" id="loading" style="display:none;">
        <p style="margin-top:8px;font-size:12px;">正在加载聊天记录...</p>
    </div>
    <!-- 初始提示 -->
    <div id="initHint" style="text-align:center;padding:30px 16px;font-size:12px;opacity:0.6;">
        <div style="font-size:32px;margin-bottom:8px;">💬</div>
        <p>正在连接插件...</p>
    </div>

    <!-- Toast 通知 -->
    <div class="toast" id="toast"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let allSessions = [];
        let sessionDates = new Set();
        let calendarDate = new Date();
        let showArchived = false;

        // ========== 消息接收（最先注册，确保不丢消息）==========
        window.addEventListener('message', function(event) {
            const msg = event.data;
            if (msg.type === 'sessionsData') {
                allSessions = msg.sessions || [];
                sessionDates = new Set();
                allSessions.forEach(function(s) {
                    const d = new Date(s.createdAt);
                    if (!isNaN(d.getTime())) {
                        sessionDates.add(d.toISOString().split('T')[0]);
                    }
                });
                document.getElementById('loading').style.display = 'none';
                document.getElementById('initHint').style.display = 'none';
                renderSessions(allSessions);
            } else if (msg.type === 'turnsData') {
                renderFullTurns(msg.sessionId, msg.turns);
            } else if (msg.type === 'updateSuccess') {
                showToast(msg.message);
            } else if (msg.type === 'error') {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('initHint').textContent = 'Error: ' + msg.message;
                document.getElementById('initHint').style.display = 'block';
            }
        });

        // 注册完监听器后，立即发送 ready
        document.getElementById('initHint').style.display = 'none';
        document.getElementById('loading').style.display = 'block';
        vscode.postMessage({ type: 'ready' });

        // ========== 事件监听 ==========
        document.getElementById('searchInput').addEventListener('input', debounce(function() {
            applyFilters();
        }, 300));

        document.getElementById('dateFrom').addEventListener('change', applyFilters);
        document.getElementById('dateTo').addEventListener('change', applyFilters);

        document.getElementById('refreshBtn').addEventListener('click', () => {
            document.getElementById('loading').style.display = 'block';
            vscode.postMessage({ type: 'refresh' });
        });

        document.getElementById('calendarBtn').addEventListener('click', () => {
            const panel = document.getElementById('calendarPanel');
            panel.classList.toggle('visible');
            if (panel.classList.contains('visible')) {
                renderCalendar();
            }
        });

        document.getElementById('archiveToggle').addEventListener('click', () => {
            showArchived = !showArchived;
            const btn = document.getElementById('archiveToggle');
            btn.classList.toggle('active', showArchived);
            btn.textContent = showArchived ? '隐藏归档' : '显示归档';
            applyFilters();
        });

        document.getElementById('prevMonth').addEventListener('click', () => {
            calendarDate.setMonth(calendarDate.getMonth() - 1);
            renderCalendar();
        });

        document.getElementById('nextMonth').addEventListener('click', () => {
            calendarDate.setMonth(calendarDate.getMonth() + 1);
            renderCalendar();
        });

        // ========== 过滤器 ==========
        function applyFilters() {
            const keyword = document.getElementById('searchInput').value.trim();
            const dateFrom = document.getElementById('dateFrom').value;
            const dateTo = document.getElementById('dateTo').value;
            vscode.postMessage({
                type: 'requestSessions',
                filter: {
                    keyword: keyword || undefined,
                    dateFrom: dateFrom || undefined,
                    dateTo: dateTo || undefined,
                    showArchived: showArchived,
                },
            });
        }

        // ========== 渲染会话列表 ==========
        function renderSessions(sessions) {
            const list = document.getElementById('sessionList');
            const empty = document.getElementById('emptyState');
            const stats = document.getElementById('stats');

            if (sessions.length === 0) {
                list.innerHTML = '';
                empty.style.display = 'block';
                stats.textContent = '没有找到匹配的记录';
                return;
            }

            empty.style.display = 'none';
            stats.textContent = '共 ' + sessions.length + ' 个对话，' +
                sessions.reduce((sum, s) => sum + s.turns.length, 0) + ' 条提问';

            list.innerHTML = sessions.map(session => {
                const date = formatDate(session.createdAt);
                const turnCount = session.turns.length;
                const archivedTag = session.archived ? '<span class="session-badge" style="background:#555;">已归档</span>' : '';

                return '<li class="session-item" data-session-id="' + escapeAttr(session.sessionId) + '">' +
                    '<div class="session-header" onclick="toggleSession(this, \'' + escapeAttr(session.sessionId) + '\')">' +
                        '<span class="arrow">▶</span>' +
                        '<div class="session-info">' +
                            '<div class="session-title">' + escapeHtml(session.title) + '</div>' +
                            '<div class="session-meta">' +
                                '<span>' + date + '</span>' +
                                '<span>' + turnCount + ' 条提问</span>' +
                                archivedTag +
                            '</div>' +
                            (session.note ? '<div class="session-note">📝 ' + escapeHtml(session.note) + '</div>' : '') +
                        '</div>' +
                        '<div class="session-actions">' +
                            '<button class="action-btn" onclick="event.stopPropagation();editNote(\'' + escapeAttr(session.sessionId) + '\')" title="备注">📝</button>' +
                            '<button class="action-btn" onclick="event.stopPropagation();archiveSession(\'' + escapeAttr(session.sessionId) + '\', ' + !session.archived + ')" title="' + (session.archived ? '取消归档' : '归档') + '">' + (session.archived ? '📤' : '📦') + '</button>' +
                            '<button class="action-btn" onclick="event.stopPropagation();deleteSession(\'' + escapeAttr(session.sessionId) + '\')" title="删除">🗑️</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="note-editor" id="note-' + escapeAttr(session.sessionId) + '">' +
                        '<input type="text" value="' + escapeAttr(session.note || '') + '" placeholder="输入备注..." />' +
                        '<button onclick="saveNote(\'' + escapeAttr(session.sessionId) + '\')">保存</button>' +
                    '</div>' +
                    '<div class="turns-container" id="turns-' + escapeAttr(session.sessionId) + '">' +
                        renderTurns(session) +
                    '</div>' +
                '</li>';
            }).join('');
        }

        // ========== 渲染提问列表 ==========
        function renderTurns(session) {
            return session.turns.map((turn, idx) => {
                const time = formatTime(turn.timestamp);
                const preview = turn.responses.length > 0
                    ? turn.responses[0].content.substring(0, 100)
                    : '(无回复)';

                return '<div class="turn-item" data-turn-id="' + escapeAttr(turn.id) + '">' +
                    '<div class="turn-header" onclick="toggleTurn(this, \'' + escapeAttr(session.sessionId) + '\', \'' + escapeAttr(turn.id) + '\')">' +
                        '<span class="arrow">▶</span>' +
                        '<div class="turn-question">' +
                            '<div class="turn-question-text">💬 ' + escapeHtml(turn.userMessage) + '</div>' +
                            '<div class="turn-meta">' + time + ' · ' + turn.responses.length + ' 条回复</div>' +
                            (turn.note ? '<div class="turn-note">📝 ' + escapeHtml(turn.note) + '</div>' : '') +
                        '</div>' +
                        '<div class="turn-actions">' +
                            '<button class="action-btn" onclick="event.stopPropagation();editTurnNote(\'' + escapeAttr(session.sessionId) + '\', \'' + escapeAttr(turn.id) + '\')" title="备注">📝</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="note-editor" id="tnote-' + escapeAttr(session.sessionId) + '-' + escapeAttr(turn.id) + '">' +
                        '<input type="text" value="' + escapeAttr(turn.note || '') + '" placeholder="输入提问备注..." />' +
                        '<button onclick="saveTurnNote(\'' + escapeAttr(session.sessionId) + '\', \'' + escapeAttr(turn.id) + '\')">保存</button>' +
                    '</div>' +
                    '<div class="turn-content" id="content-' + escapeAttr(session.sessionId) + '-' + escapeAttr(turn.id) + '">' +
                        '<div class="response-item" style="border-left-color:#e8a838;">' +
                            '<div class="response-role">🧑 提问</div>' +
                            '<div class="response-text">' + formatContent(turn.userMessage) + '</div>' +
                        '</div>' +
                        turn.responses.map(r => (
                            '<div class="response-item">' +
                                '<div class="response-role">🤖 回复</div>' +
                                '<div class="response-text">' + formatContent(r.content) + '</div>' +
                            '</div>'
                        )).join('') +
                    '</div>' +
                '</div>';
            }).join('');
        }

        // ========== 展开/收起会话 ==========
        function toggleSession(header, sessionId) {
            const arrow = header.querySelector('.arrow');
            const container = document.getElementById('turns-' + sessionId);

            const isExpanded = container.classList.contains('visible');

            if (isExpanded) {
                container.classList.remove('visible');
                arrow.classList.remove('expanded');
                header.classList.remove('expanded');
            } else {
                container.classList.add('visible');
                arrow.classList.add('expanded');
                header.classList.add('expanded');
                // 请求完整数据
                vscode.postMessage({ type: 'requestTurns', sessionId: sessionId });
            }
        }

        // ========== 展开/收起提问 ==========
        function toggleTurn(header, sessionId, turnId) {
            const arrow = header.querySelector('.arrow');
            const content = document.getElementById('content-' + sessionId + '-' + turnId);

            if (content.classList.contains('visible')) {
                content.classList.remove('visible');
                arrow.classList.remove('expanded');
            } else {
                content.classList.add('visible');
                arrow.classList.add('expanded');
            }
        }

        // ========== 用完整数据更新 turns ==========
        function renderFullTurns(sessionId, turns) {
            const container = document.getElementById('turns-' + sessionId);
            if (!container) return;

            // 找到对应的 session，更新 turns
            const session = allSessions.find(s => s.sessionId === sessionId);
            if (session) {
                session.turns = turns;
                container.innerHTML = renderTurns(session);
            }
        }

        // ========== 备注操作 ==========
        function editNote(sessionId) {
            const editor = document.getElementById('note-' + sessionId);
            editor.classList.toggle('visible');
            if (editor.classList.contains('visible')) {
                editor.querySelector('input').focus();
            }
        }

        function saveNote(sessionId) {
            const editor = document.getElementById('note-' + sessionId);
            const note = editor.querySelector('input').value;
            vscode.postMessage({ type: 'updateNote', sessionId: sessionId, note: note });
            editor.classList.remove('visible');
            // 更新显示
            const session = allSessions.find(s => s.sessionId === sessionId);
            if (session) session.note = note;
            renderSessions(allSessions);
        }

        function editTurnNote(sessionId, turnId) {
            const editor = document.getElementById('tnote-' + sessionId + '-' + turnId);
            editor.classList.toggle('visible');
            if (editor.classList.contains('visible')) {
                editor.querySelector('input').focus();
            }
        }

        function saveTurnNote(sessionId, turnId) {
            const editor = document.getElementById('tnote-' + sessionId + '-' + turnId);
            const note = editor.querySelector('input').value;
            vscode.postMessage({ type: 'updateNote', sessionId: sessionId, turnId: turnId, note: note });
            editor.classList.remove('visible');
        }

        // ========== 归档/删除 ==========
        function archiveSession(sessionId, archive) {
            vscode.postMessage({
                type: archive ? 'archiveSession' : 'unarchiveSession',
                sessionId: sessionId,
            });
        }

        function deleteSession(sessionId) {
            if (confirm('确定要删除这个对话吗？（可以恢复）')) {
                vscode.postMessage({ type: 'deleteSession', sessionId: sessionId });
            }
        }

        // ========== 日历渲染 ==========
        function renderCalendar() {
            const year = calendarDate.getFullYear();
            const month = calendarDate.getMonth();
            const title = document.getElementById('calendarTitle');
            title.textContent = year + '年' + (month + 1) + '月';

            const grid = document.getElementById('calendarGrid');
            const dayHeaders = ['日', '一', '二', '三', '四', '五', '六'];

            let html = dayHeaders.map(d => '<div class="day-header">' + d + '</div>').join('');

            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            // 上月填充
            const prevDays = new Date(year, month, 0).getDate();
            for (let i = firstDay - 1; i >= 0; i--) {
                html += '<div class="day other-month">' + (prevDays - i) + '</div>';
            }

            // 当月
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                const hasData = sessionDates.has(dateStr);
                const isToday = dateStr === todayStr;
                let classes = 'day';
                if (hasData) classes += ' has-data';
                if (isToday) classes += ' today';
                html += '<div class="' + classes + '" onclick="selectDate(\'' + dateStr + '\')">' + d + '</div>';
            }

            // 下月填充
            const totalCells = firstDay + daysInMonth;
            const remaining = (7 - (totalCells % 7)) % 7;
            for (let i = 1; i <= remaining; i++) {
                html += '<div class="day other-month">' + i + '</div>';
            }

            grid.innerHTML = html;
        }

        function selectDate(dateStr) {
            document.getElementById('dateFrom').value = dateStr;
            document.getElementById('dateTo').value = dateStr;
            document.getElementById('calendarPanel').classList.remove('visible');
            applyFilters();
        }

        // ========== 工具函数 ==========
        function formatDate(iso) {
            try {
                const d = new Date(iso);
                if (isNaN(d.getTime())) return iso;
                return d.getFullYear() + '/' +
                    String(d.getMonth() + 1).padStart(2, '0') + '/' +
                    String(d.getDate()).padStart(2, '0');
            } catch { return iso; }
        }

        function formatTime(iso) {
            try {
                const d = new Date(iso);
                if (isNaN(d.getTime())) return '';
                return String(d.getHours()).padStart(2, '0') + ':' +
                    String(d.getMinutes()).padStart(2, '0');
            } catch { return ''; }
        }

        function formatContent(text) {
            if (!text) return '';
            let html = escapeHtml(text);
            // 换行转 <br>
            html = html.replace(/\n/g, '<br>');
            return html;
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function escapeAttr(str) {
            if (!str) return '';
            return str.replace(/'/g, "&#39;").replace(/"/g, '&quot;');
        }

        function debounce(fn, ms) {
            let timer;
            return function() {
                clearTimeout(timer);
                timer = setTimeout(fn, ms);
            };
        }

        function showLoading(show) {
            document.getElementById('loading').style.display = show ? 'block' : 'none';
        }

        function showToast(msg) {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 2000);
        }
    </script>
</body>
</html>`;
    }
    // END OF OLD METHOD
}
