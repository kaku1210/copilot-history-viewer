/**
 * 单条消息（用户提问 或 AI回复）
 */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
}

/** 置顶类型：local=只在当前列表置顶, global=完全置顶（含归档列表） */
export type PinType = 'local' | 'global';

/**
 * 一次问答交互（一个提问 + 对应的所有回复）
 */
export interface ChatTurn {
    id: string;
    userMessage: string;
    responses: ChatMessage[];
    timestamp: string;
    note?: string;         // 提问级别的备注
}

/**
 * 一个完整的对话会话
 */
export interface ChatSession {
    sessionId: string;
    title: string;
    turns: ChatTurn[];
    createdAt: string;
    updatedAt: string;
    note?: string;         // 会话级别的备注
    archived?: boolean;    // 是否已归档
    deleted?: boolean;     // 是否已删除（软删除）
    pinType?: PinType;     // 置顶类型
    pinOrder?: number;     // 置顶顺序（越小越靠前）
}

/**
 * 插件附加数据（存储在 globalStorage 中）
 */
export interface PluginMetadata {
    version: string;
    /** 全局置顶顺序列表，按置顶先后顺序排列 */
    pinOrder: string[];
    sessions: {
        [sessionId: string]: {
            note?: string;
            archived?: boolean;
            deleted?: boolean;
            pinType?: PinType;
            turns: {
                [turnId: string]: {
                    note?: string;
                    editedContent?: string;
                };
            };
        };
    };
}

/**
 * WebView 消息协议
 */
export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'requestSessions'; filter?: SessionFilter }
    | { type: 'requestTurns'; sessionId: string }
    | { type: 'updateNote'; sessionId: string; turnId?: string; note: string }
    | { type: 'archiveSession'; sessionId: string }
    | { type: 'unarchiveSession'; sessionId: string }
    | { type: 'deleteSession'; sessionId: string }
    | { type: 'editTurnContent'; sessionId: string; turnId: string; content: string }
    | { type: 'pinSession'; sessionId: string; pinType: PinType }
    | { type: 'unpinSession'; sessionId: string }
    | { type: 'refresh' }
    | { type: 'gitPush' }
    | { type: 'gitPull' }
    | { type: 'saveGitConfig'; config: GitSyncConfig }
    | { type: 'getGitConfig' }
    | { type: 'openSettings' };

export type ExtensionMessage =
    | { type: 'sessionsData'; sessions: ChatSession[] }
    | { type: 'turnsData'; sessionId: string; turns: ChatTurn[] }
    | { type: 'updateSuccess'; message: string }
    | { type: 'error'; message: string }
    | { type: 'gitConfigData'; config: GitSyncConfig | null }
    | { type: 'gitSyncStatus'; status: 'syncing' | 'success' | 'error'; message: string };

/**
 * GitHub 同步配置
 */
export interface GitSyncConfig {
    repoUrl: string;       // https://github.com/user/private-repo.git
    token: string;         // Personal Access Token
    branch: string;        // 默认 main
    autoSync: boolean;     // 自动拉取（启动时）
    autoCommit: boolean;   // 自动提交（数据变更时）
}

/**
 * 对话过滤条件
 */
export interface SessionFilter {
    dateFrom?: string;    // ISO date string YYYY-MM-DD
    dateTo?: string;
    /** 日期筛选模式（多选）：anyTurn / hasOneTurn / startInRange / allTurns */
    dateFilterModes?: string[];
    keyword?: string;
    /** 归档模式：normal=未归档（默认）| archived=已归档 | all=全部 */
    archiveMode?: 'normal' | 'archived' | 'all';
    /** 排序方式：updatedAt（默认）| createdAt */
    sortBy?: 'updatedAt' | 'createdAt';
}
