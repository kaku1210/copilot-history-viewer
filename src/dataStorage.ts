import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatSession, ChatTurn, ChatMessage, PluginMetadata, SessionFilter, PinType } from './types';

/**
 * 数据存储服务
 * 
 * Copilot Chat 数据位置：
 *   workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl
 *   workspaceStorage/<hash>/state.vscdb → chat.ChatSessionStore.index
 * 
 * 插件附加数据位置（globalStorage）：
 *   globalStorage/local-dev.copilot-history-viewer/
 *   ├── metadata.json
 *   └── cache/
 */
export class DataStorageService {
    private globalStoragePath: string;
    private metadataPath: string;
    private cachePath: string;
    private metadata: PluginMetadata;

    constructor(private context: vscode.ExtensionContext) {
        this.globalStoragePath = context.globalStorageUri.fsPath;
        this.metadataPath = path.join(this.globalStoragePath, 'metadata.json');
        this.cachePath = path.join(this.globalStoragePath, 'cache');
        this.ensureDirectories();
        this.metadata = this.loadMetadata();
    }

    private ensureDirectories(): void {
        const dirs = [this.globalStoragePath, this.cachePath, path.join(this.globalStoragePath, 'exports')];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    private loadMetadata(): PluginMetadata {
        try {
            if (fs.existsSync(this.metadataPath)) {
                return JSON.parse(fs.readFileSync(this.metadataPath, 'utf-8'));
            }
        } catch (e) { console.error('Failed to load metadata:', e); }
        return { version: '1.0.0', pinOrder: [], sessions: {} };
    }

    private saveMetadata(): void {
        try {
            fs.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
        } catch (e) { console.error('Failed to save metadata:', e); }
    }

    /**
     * 获取所有 workspaceStorage 目录
     */
    private getWorkspaceStorageDirs(): string[] {
        const appData = process.env.APPDATA || '';
        const wsBase = path.join(appData, 'Code', 'User', 'workspaceStorage');
        if (!fs.existsSync(wsBase)) return [];
        try {
            return fs.readdirSync(wsBase, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => path.join(wsBase, d.name));
        } catch { return []; }
    }

    /**
     * 主入口：加载所有 Copilot Chat 聊天记录
     */
    async loadCopilotSessions(): Promise<ChatSession[]> {
        const sessions: ChatSession[] = [];
        const wsDirs = this.getWorkspaceStorageDirs();

        for (const wsDir of wsDirs) {
            const chatSessionsDir = path.join(wsDir, 'chatSessions');
            if (!fs.existsSync(chatSessionsDir)) continue;

            try {
                const files = fs.readdirSync(chatSessionsDir).filter(f => f.endsWith('.jsonl'));
                for (const file of files) {
                    try {
                        const filePath = path.join(chatSessionsDir, file);
                        const session = this.parseJsonlFile(filePath);
                        if (session && session.turns.length > 0) {
                            sessions.push(session);
                        }
                    } catch (e) {
                        console.error(`Error parsing ${file}:`, e);
                    }
                }
            } catch (e) {
                console.error(`Error reading ${chatSessionsDir}:`, e);
            }
        }

        // 去重 + 排序 + 合并元数据
        const unique = this.deduplicateSessions(sessions);
        return this.mergeMetadata(unique);
    }

    /**
     * 解析单个 .jsonl 聊天记录文件
     *
     * 实际格式（经过数据分析确认）：
     *   kind=0: 会话骨架，v 包含 sessionId/creationDate/customTitle，初始 requests 可能为空
     *   kind=2, k=['requests']: 追加新的 request 骨架（含 message.text、timestamp、requestId）
     *   kind=2, k=['requests', N, 'response']: 追加第 N 条 request 的 AI 回复内容
     *   kind=1, k=['customTitle']: 更新会话标题
     *   kind=1, k=['requests', N, 'result']: 更新请求结果状态
     */
    private parseJsonlFile(filePath: string): ChatSession | null {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        if (lines.length === 0) return null;

        let sessionData: any = null;
        // requestId -> request 对象
        const requestsMap: Map<string, any> = new Map();
        // requestId -> response parts[]
        const responseMap: Map<string, any[]> = new Map();
        // 维护 request 顺序
        const requestOrder: string[] = [];

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);

                if (entry.kind === 0) {
                    // 初始会话骨架
                    sessionData = entry.v;
                    // 处理 kind=0 中已存在的 requests
                    const initReqs = entry.v?.requests || [];
                    for (const req of initReqs) {
                        if (req.requestId && !requestsMap.has(req.requestId)) {
                            requestsMap.set(req.requestId, req);
                            requestOrder.push(req.requestId);
                        }
                    }
                } else if (entry.kind === 2 && entry.k) {
                    const k = entry.k as any[];

                    if (k[0] === 'requests' && k.length === 1 && Array.isArray(entry.v)) {
                        // k=['requests']: 追加新的 request 骨架
                        for (const req of entry.v) {
                            if (req.requestId && !requestsMap.has(req.requestId)) {
                                requestsMap.set(req.requestId, req);
                                requestOrder.push(req.requestId);
                            }
                        }
                    } else if (k[0] === 'requests' && typeof k[1] === 'number' && k[2] === 'response' && Array.isArray(entry.v)) {
                        // k=['requests', N, 'response']: 追加第 N 条 request 的 AI 回复
                        // N 是顺序索引，对应 requestOrder[N]
                        const reqIdx = k[1] as number;
                        const reqId = requestOrder[reqIdx];
                        if (reqId) {
                            if (!responseMap.has(reqId)) {
                                responseMap.set(reqId, []);
                            }
                            responseMap.get(reqId)!.push(...entry.v);
                        }
                    }
                } else if (entry.kind === 1 && entry.k) {
                    const k = entry.k as any[];
                    if (k[0] === 'customTitle' && sessionData) {
                        sessionData.customTitle = entry.v;
                    }
                }
            } catch { }
        }

        if (!sessionData) return null;

        // 构建 ChatSession
        return this.buildSessionFromMaps(sessionData, requestOrder, requestsMap, responseMap);
    }

    /**
     * 基于 Maps 构建 ChatSession（新版，适配真实数据格式）
     */
    private buildSessionFromMaps(
        sessionData: any,
        requestOrder: string[],
        requestsMap: Map<string, any>,
        responseMap: Map<string, any[]>
    ): ChatSession | null {
        const sessionId = sessionData.sessionId || '';
        if (!sessionId || requestOrder.length === 0) return null;

        const turns: ChatTurn[] = [];

        for (const reqId of requestOrder) {
            const req = requestsMap.get(reqId);
            if (!req) continue;

            const userMessage = req?.message?.text || '';
            if (!userMessage) continue;

            const timestamp = req.timestamp ? new Date(req.timestamp).toISOString() : '';
            const responseParts = responseMap.get(reqId) || [];
            const fullResponseText = this.extractResponseText(responseParts);
            const responses: ChatMessage[] = [];

            if (fullResponseText) {
                responses.push({ role: 'assistant', content: fullResponseText, timestamp });
            }

            turns.push({ id: reqId, userMessage, responses, timestamp });
        }

        if (turns.length === 0) return null;

        const firstMsg = requestsMap.get(requestOrder[0])?.message?.text || '';
        const title = sessionData.customTitle || firstMsg.substring(0, 80) || 'New Chat';
        const createdAt = sessionData.creationDate
            ? new Date(sessionData.creationDate).toISOString()
            : turns[0].timestamp || new Date().toISOString();
        const updatedAt = turns[turns.length - 1].timestamp || createdAt;

        return {
            sessionId,
            title: title.length > 80 ? title.substring(0, 80) + '...' : title,
            turns,
            createdAt,
            updatedAt,
        };
    }

    /**
     * 从 response parts 中提取可读文本
     */
    private extractResponseText(parts: any[]): string {
        let text = '';
        for (const part of parts) {
            if (!part) continue;

            // thinking 类型：只保留非加密的可读内容
            if (part.kind === 'thinking') {
                const v = part.value;
                if (typeof v === 'string' && v.length > 0 && v.length < 800
                    && !v.includes('==') && /^[\s\S]*[\u4e00-\u9fffa-zA-Z]/.test(v)) {
                    text += `> 💭 ${v}\n\n`;
                }
                continue;
            }

            // markdownContent
            if (part.kind === 'markdownContent' && typeof part.value === 'string') {
                text += part.value + '\n';
                continue;
            }

            // 工具调用
            if (part.kind === 'toolInvocationSerialized') {
                const msg = part.pastTenseMessage?.value || part.invocationMessage?.value || '';
                if (msg) text += `> 🔧 ${msg}\n`;
                continue;
            }

            // 文件编辑
            if (part.kind === 'textEditGroup') {
                const uri = part.uri?.fsPath || part.uri?.path || '';
                if (uri) text += `> ✏️ 编辑文件: ${path.basename(uri)}\n`;
                continue;
            }

            // { value: string, supportThemeIcons: bool } 格式
            if (typeof part === 'object' && typeof part.value === 'string'
                && part.supportThemeIcons !== undefined) {
                text += part.value + '\n';
                continue;
            }

            // { value: { value: string } } 嵌套格式
            if (typeof part === 'object' && part.value && typeof part.value === 'object'
                && typeof part.value.value === 'string') {
                text += part.value.value + '\n';
                continue;
            }

            // 直接 value 字符串且无 kind
            if (!part.kind && typeof part.value === 'string') {
                text += part.value + '\n';
            }
        }
        return text.trim();
    }

    /**
     * 去重
     */
    private deduplicateSessions(sessions: ChatSession[]): ChatSession[] {
        const seen = new Map<string, ChatSession>();
        for (const s of sessions) {
            const existing = seen.get(s.sessionId);
            if (!existing || s.turns.length > existing.turns.length) {
                seen.set(s.sessionId, s);
            }
        }
        return Array.from(seen.values()).sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }

    /**
     * 合并附加元数据
     */
    private mergeMetadata(sessions: ChatSession[]): ChatSession[] {
        const pinOrder = this.metadata.pinOrder || [];
        for (const session of sessions) {
            const meta = this.metadata.sessions[session.sessionId];
            if (meta) {
                session.note = meta.note;
                session.archived = meta.archived;
                session.deleted = meta.deleted;
                session.pinType = meta.pinType;
                const idx = pinOrder.indexOf(session.sessionId);
                session.pinOrder = idx >= 0 ? idx : undefined;
                for (const turn of session.turns) {
                    const turnMeta = meta.turns?.[turn.id];
                    if (turnMeta) {
                        turn.note = turnMeta.note;
                    }
                }
            }
        }
        return sessions.filter(s => !s.deleted);
    }

    /**
     * 根据过滤条件获取会话
     */
    async getSessions(filter?: SessionFilter): Promise<ChatSession[]> {
        let sessions = await this.loadCopilotSessions();

        if (filter) {
            // 排序（置顶逻辑在最后统一处理）
            const sortKey = filter.sortBy || 'updatedAt';
            sessions.sort((a, b) =>
                new Date(b[sortKey]).getTime() - new Date(a[sortKey]).getTime()
            );

            if (filter.dateFrom || filter.dateTo) {
                const from = filter.dateFrom ? new Date(filter.dateFrom) : null;
                const to = filter.dateTo ? new Date(filter.dateTo) : null;
                if (to) { to.setHours(23, 59, 59, 999); }
                const modes: string[] = (filter.dateFilterModes && filter.dateFilterModes.length > 0)
                    ? filter.dateFilterModes : ['anyTurn'];

                sessions = sessions.filter(s => {
                    /** 判断一个时间戳是否在 [from, to] 范围内 */
                    const inRange = (ts: string | undefined) => {
                        if (!ts) return false;
                        const d = new Date(ts);
                        if (isNaN(d.getTime())) return false;
                        if (from && d < from) return false;
                        if (to && d > to) return false;
                        return true;
                    };

                    // 满足任一模式即保留
                    return modes.some(mode => {
                        switch (mode) {
                            case 'anyTurn':
                                // 会话本身或任意 turn 在范围内
                                return inRange(s.createdAt) || s.turns.some(t => inRange(t.timestamp));
                            case 'hasOneTurn':
                                // 至少一个 turn 在范围内
                                return s.turns.some(t => inRange(t.timestamp));
                            case 'startInRange':
                                // 第一个 turn 的时间在范围内（取 turns[0] 或 createdAt）
                                return inRange(s.turns[0]?.timestamp ?? s.createdAt);
                            case 'allTurns':
                                // 所有 turn 都在范围内
                                return s.turns.length > 0 && s.turns.every(t => inRange(t.timestamp));
                            default:
                                return inRange(s.createdAt);
                        }
                    });
                });
            }
            if (filter.keyword) {
                const kw = filter.keyword.toLowerCase();
                sessions = sessions.filter(s =>
                    s.title.toLowerCase().includes(kw) ||
                    s.note?.toLowerCase().includes(kw) ||
                    s.turns.some(t =>
                        t.userMessage.toLowerCase().includes(kw) ||
                        t.responses.some(r => r.content.toLowerCase().includes(kw))
                    )
                );
            }
            const mode = filter.archiveMode || 'normal';
            if (mode === 'normal') {
                sessions = sessions.filter(s => !s.archived);
            } else if (mode === 'archived') {
                sessions = sessions.filter(s => !!s.archived);
            }
            // mode === 'all'：不过滤
        } else {
            sessions = sessions.filter(s => !s.archived);
        }

        // 置顶排序：pinOrder 有值的优先，按 pinOrder 升序；全局置顶(global)不受 archiveMode 限制
        const archiveMode = filter?.archiveMode || 'normal';
        const showArchived = archiveMode !== 'normal';
        const pinnedGlobal = sessions.filter(s => s.pinType === 'global' && s.pinOrder !== undefined);
        const pinnedLocal  = sessions.filter(s => s.pinType === 'local'  && s.pinOrder !== undefined);
        const notPinned    = sessions.filter(s => s.pinOrder === undefined);
        // global 置顶在最顶部，local 置顶次之，其余按排序
        const sortByPinOrder = (a: ChatSession, b: ChatSession) => (a.pinOrder ?? 9999) - (b.pinOrder ?? 9999);
        const result = [
            ...pinnedGlobal.sort(sortByPinOrder),
            ...pinnedLocal.sort(sortByPinOrder),
            ...notPinned,
        ];
        // global 置顶：即使归档也显示（已经在 sessions 里了，只要不被 showArchived 过滤掉）
        // 但如果 showArchived=false，global pin 的归档项也应强制显示
        if (!showArchived) {
            const globalPinIds = new Set(pinnedGlobal.map(s => s.sessionId));
            // 从 allSessions 里把 global pin 的归档项也塞进来
            const all = await this.loadCopilotSessions();
            const globalArchivedPins = all.filter(s =>
                s.pinType === 'global' && s.archived && !globalPinIds.has(s.sessionId) && !s.deleted
            );
            if (globalArchivedPins.length > 0) {
                globalArchivedPins.sort(sortByPinOrder);
                return [...globalArchivedPins, ...result.filter(s => !globalPinIds.has(s.sessionId) || !s.archived)];
            }
        }
        return result;
    }

    // ========== 写入操作 ==========

    updateSessionNote(sessionId: string, note: string): void {
        if (!this.metadata.sessions[sessionId]) {
            this.metadata.sessions[sessionId] = { turns: {} };
        }
        this.metadata.sessions[sessionId].note = note;
        this.saveMetadata();
    }

    updateTurnNote(sessionId: string, turnId: string, note: string): void {
        if (!this.metadata.sessions[sessionId]) {
            this.metadata.sessions[sessionId] = { turns: {} };
        }
        if (!this.metadata.sessions[sessionId].turns) {
            this.metadata.sessions[sessionId].turns = {};
        }
        if (!this.metadata.sessions[sessionId].turns[turnId]) {
            this.metadata.sessions[sessionId].turns[turnId] = {};
        }
        this.metadata.sessions[sessionId].turns[turnId].note = note;
        this.saveMetadata();
    }

    archiveSession(sessionId: string): void {
        if (!this.metadata.sessions[sessionId]) {
            this.metadata.sessions[sessionId] = { turns: {} };
        }
        this.metadata.sessions[sessionId].archived = true;
        this.saveMetadata();
    }

    unarchiveSession(sessionId: string): void {
        if (this.metadata.sessions[sessionId]) {
            this.metadata.sessions[sessionId].archived = false;
            this.saveMetadata();
        }
    }

    pinSession(sessionId: string, pinType: PinType): void {
        if (!this.metadata.sessions[sessionId]) {
            this.metadata.sessions[sessionId] = { turns: {} };
        }
        this.metadata.sessions[sessionId].pinType = pinType;
        // 记录置顶顺序（追加到末尾，避免重复）
        if (!this.metadata.pinOrder) { this.metadata.pinOrder = []; }
        const idx = this.metadata.pinOrder.indexOf(sessionId);
        if (idx < 0) { this.metadata.pinOrder.push(sessionId); }
        this.saveMetadata();
    }

    unpinSession(sessionId: string): void {
        if (this.metadata.sessions[sessionId]) {
            delete this.metadata.sessions[sessionId].pinType;
        }
        if (this.metadata.pinOrder) {
            this.metadata.pinOrder = this.metadata.pinOrder.filter(id => id !== sessionId);
        }
        this.saveMetadata();
    }

    deleteSession(sessionId: string): void {
        if (!this.metadata.sessions[sessionId]) {
            this.metadata.sessions[sessionId] = { turns: {} };
        }
        this.metadata.sessions[sessionId].deleted = true;
        this.saveMetadata();
    }

    editTurnContent(sessionId: string, turnId: string, content: string): void {
        if (!this.metadata.sessions[sessionId]) {
            this.metadata.sessions[sessionId] = { turns: {} };
        }
        if (!this.metadata.sessions[sessionId].turns) {
            this.metadata.sessions[sessionId].turns = {};
        }
        if (!this.metadata.sessions[sessionId].turns[turnId]) {
            this.metadata.sessions[sessionId].turns[turnId] = {};
        }
        this.metadata.sessions[sessionId].turns[turnId].editedContent = content;
        this.saveMetadata();
    }
}