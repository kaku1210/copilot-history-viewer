import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatSession } from './types';

/**
 * 项目级存储服务
 * 
 * 管理 <workspace>/.copilot-log/ 目录，存储轻量级会话元数据
 * 与全局存储同步，支持 Git 版本控制
 */

interface ProjectSessionMetadata {
    sessionId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    tags?: string[];
    projectTags?: string[];
}

interface ProjectStorageState {
    version: string;
    sessions: ProjectSessionMetadata[];
    lastSyncTime?: string;
}

export class ProjectStorageService {
    private projectLogDir: string;
    private metadataPath: string;
    private state: ProjectStorageState;
    private workspaceRoot: string;

    constructor(workspaceUri?: vscode.Uri) {
        const root = workspaceUri?.fsPath || 
                     (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) ||
                     '';
        
        this.workspaceRoot = root;
        this.projectLogDir = path.join(root, '.copilot-log');
        this.metadataPath = path.join(this.projectLogDir, 'metadata.json');
        
        this.ensureDirectories();
        this.state = this.loadState();
    }

    private ensureDirectories(): void {
        const dirs = [
            this.projectLogDir,
            path.join(this.projectLogDir, 'changes'),
            path.join(this.projectLogDir, 'changes', this.getDateFolder())
        ];
        
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        // 创建或更新 .gitignore
        this.ensureGitIgnore();
    }

    private ensureGitIgnore(): void {
        const gitignorePath = path.join(this.projectLogDir, '.gitignore');
        const gitignoreContent = `# Copilot log directory
# 项目级 Copilot 会话和变更记录
# 可选：上传 metadata.json 和 sessions.json 跟踪会话
# 建议：提交 .gitignore，但忽略原始数据

# 忽略原始数据，仅保留元数据
changes/
sync-state.json

# 保留这些文件用于版本控制（可选）
# !metadata.json
# !sessions.json
`;

        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
        }
    }

    private loadState(): ProjectStorageState {
        try {
            if (fs.existsSync(this.metadataPath)) {
                const content = fs.readFileSync(this.metadataPath, 'utf-8');
                return JSON.parse(content);
            }
        } catch (e) {
            console.error('[ProjectStorage] Failed to load state:', e);
        }

        return {
            version: '1.0.0',
            sessions: [],
            lastSyncTime: new Date().toISOString()
        };
    }

    private saveState(): void {
        try {
            this.state.lastSyncTime = new Date().toISOString();
            fs.writeFileSync(
                this.metadataPath,
                JSON.stringify(this.state, null, 2),
                'utf-8'
            );
        } catch (e) {
            console.error('[ProjectStorage] Failed to save state:', e);
        }
    }

    private getDateFolder(): string {
        const now = new Date();
        return now.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    /**
     * 同步全局 ChatSession 到项目存储（仅保存元数据）
     */
    public syncSessionsFromGlobal(globalSessions: ChatSession[]): void {
        const projectMetadata: ProjectSessionMetadata[] = globalSessions.map(session => ({
            sessionId: session.sessionId,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            tags: [],
            projectTags: []
        }));

        this.state.sessions = projectMetadata;
        this.saveState();
        
        console.log(`[ProjectStorage] Synced ${projectMetadata.length} sessions`);
    }

    /**
     * 获取项目存储中的所有会话
     */
    public getProjectSessions(): ProjectSessionMetadata[] {
        return this.state.sessions || [];
    }

    /**
     * 更新单个会话的标签
     */
    public updateSessionTags(
        sessionId: string,
        projectTags: string[]
    ): void {
        const session = this.state.sessions.find(s => s.sessionId === sessionId);
        if (session) {
            session.projectTags = projectTags;
            this.saveState();
        }
    }

    /**
     * 获取项目日志目录路径
     */
    public getProjectLogDir(): string {
        return this.projectLogDir;
    }

    /**
     * 获取当前日期的变更目录
     */
    public getChangesDir(): string {
        const changesDirPath = path.join(
            this.projectLogDir,
            'changes',
            this.getDateFolder()
        );
        
        if (!fs.existsSync(changesDirPath)) {
            fs.mkdirSync(changesDirPath, { recursive: true });
        }
        
        return changesDirPath;
    }

    /**
     * 是否启用了项目级存储
     */
    public isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('copilotHistoryViewer');
        return config.get<boolean>('enableProjectSync', false);
    }

    /**
     * 是否启用了变更追踪
     */
    public isChangeTrackingEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('copilotHistoryViewer');
        return config.get<boolean>('enableChangeTracking', false);
    }
}
