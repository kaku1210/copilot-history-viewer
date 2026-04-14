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
    note?: string;             // 提问级别的备注
    modelId?: string;          // 使用的模型，如 "gpt-5-mini"
    agentId?: string;          // agent ID
    agentName?: string;        // 交互模式：agent / ask / edit
    permissionLevel?: string;  // 权限级别：autopilot / default
    attachedFiles?: string[];  // 附件文件名列表
    codeCitations?: { url: string; license?: string }[]; // 代码引用
    responseTimestamp?: string; // 响应完成时间（用于算耗时）
    waitStartTime?: number;    // timeSpentWaiting（ms 时间戳）
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
    source?: 'local' | 'cloud'; // 数据来源：本地 or 云端同步
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
    | { type: 'gitPullForce' }
    | { type: 'saveGitConfig'; config: GitSyncConfig }
    | { type: 'getGitConfig' }
    | { type: 'openSettings' }
    | { type: 'checkUpdate' }
    | { type: 'autoInstall'; vsixUrl: string }
    | { type: 'openUrl'; url: string };

export type ExtensionMessage =
    | { type: 'sessionsData'; sessions: ChatSession[] }
    | { type: 'turnsData'; sessionId: string; turns: ChatTurn[] }
    | { type: 'updateSuccess'; message: string }
    | { type: 'error'; message: string }
    | { type: 'gitConfigData'; config: GitSyncConfig | null }
    | { type: 'gitSyncStatus'; status: 'syncing' | 'success' | 'error'; message: string }
    | { type: 'updateInfo'; hasUpdate: boolean; currentVersion: string; latestVersion: string; releasesUrl: string; vsixUrl: string };

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
    /** 排序方向：desc=降序新→旧（默认）| asc=升序旧→新 */
    sortDir?: 'desc' | 'asc';
}

/**
 * 项目级存储配置消息
 */
export type ProjectStorageMessage = 
    | { type: 'toggleProjectSync'; enabled: boolean }
    | { type: 'toggleChangeTracking'; enabled: boolean }
    | { type: 'queryProjectStatus' }
    | { type: 'manualEditMark'; filePath: string; startLine: number; endLine: number };

/**
 * 项目存储状态响应
 */
export interface ProjectStorageStatus {
    projectSyncEnabled: boolean;
    changeTrackingEnabled: boolean;
    projectLogPath: string;
    currentSessionId: string | null;
}
