import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectStorageService } from './projectStorageService';

/**
 * 代码变更追踪服务
 * 
 * 监听文件变更，关联到 Copilot 会话 ID
 * 记录行号范围和修改来源（copilot / manual / other）
 * 数据存储在 <workspace>/.copilot-log/changes/<date>/<sessionId>.json
 */

export interface LineChange {
    timestamp: string;
    file: string;
    lines: { start: number; end: number };
    modifiedBy: 'copilot' | 'manual' | 'other';
    lastModifiedAt: string;
}

export interface SessionChangeLog {
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

export class ChangeTrackingService {
    private projectStorage: ProjectStorageService;
    private currentSessionId: string | null = null;
    private sessionStartTime: Date = new Date();
    private sessionChanges: Map<string, SessionChangeLog> = new Map();
    private fileWatcher: vscode.FileSystemWatcher | null = null;

    constructor(projectStorage: ProjectStorageService) {
        this.projectStorage = projectStorage;
        this.loadExistingSessions();
    }

    /**
     * 设置当前活跃的 Copilot 会话 ID
     */
    public setCurrentSession(sessionId: string): void {
        if (this.currentSessionId !== sessionId) {
            this.saveCurrentSession();
            this.currentSessionId = sessionId;
            this.sessionStartTime = new Date();
            
            if (!this.sessionChanges.has(sessionId)) {
                this.sessionChanges.set(sessionId, {
                    sessionId,
                    startTime: this.sessionStartTime.toISOString(),
                    changes: [],
                    fileIndex: {}
                });
            }
            
            console.log(`[ChangeTracking] Switched to session: ${sessionId}`);
        }
    }

    /**
     * 获取当前会话 ID
     */
    public getCurrentSession(): string | null {
        return this.currentSessionId;
    }

    /**
     * 监听文件变更事件
     * 当 enableChangeTracking 启用时调用
     */
    public startTracking(): void {
        if (!this.projectStorage.isChangeTrackingEnabled()) {
            console.log('[ChangeTracking] Change tracking is disabled');
            return;
        }

        // 监听工作区文件变更
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*',
            false,
            false,
            false
        );

        // 监听文件保存事件（推荐方式，更准确）
        const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(
            (document) => this.onFileSaved(document)
        );

        // 监听文本编辑事件
        const onChangeDisposable = vscode.workspace.onDidChangeTextDocument(
            (event) => this.onTextChanged(event)
        );

        console.log('[ChangeTracking] Tracking started');

        // 需要返回 Disposable，由调用方管理清理
        return;
    }

    /**
     * 处理文件保存事件
     */
    private onFileSaved(document: vscode.TextDocument): void {
        if (!this.currentSessionId) {
            console.debug('[ChangeTracking] No active session, skipping save');
            return;
        }

        const filePath = vscode.workspace.asRelativePath(document.uri);
        const lineCount = document.lineCount;

        // 记录整个文件被保存（为简单期间，假设整个文件都可能被修改）
        this.recordChange({
            timestamp: new Date().toISOString(),
            file: filePath,
            lines: { start: 1, end: lineCount },
            modifiedBy: 'copilot', // 默认标记为 copilot，后续可人工修改
            lastModifiedAt: new Date().toISOString()
        });
    }

    /**
     * 处理文本编辑事件
     */
    private onTextChanged(event: vscode.TextDocumentChangeEvent): void {
        if (!this.currentSessionId) {
            return;
        }

        const filePath = vscode.workspace.asRelativePath(event.document.uri);

        // 计算本次编辑影响的行范围
        for (const change of event.contentChanges) {
            const startLine = event.document.positionAt(change.rangeOffset).line;
            const endLine = event.document.positionAt(
                change.rangeOffset + (change.text?.length || 0)
            ).line;

            // 记录变更
            this.recordChange({
                timestamp: new Date().toISOString(),
                file: filePath,
                lines: { start: startLine + 1, end: endLine + 1 }, // VSCode 是 0-indexed，我们转换为 1-indexed
                modifiedBy: 'copilot',
                lastModifiedAt: new Date().toISOString()
            });
        }
    }

    /**
     * 记录单次代码变更
     */
    public recordChange(change: LineChange): void {
        if (!this.currentSessionId) {
            return;
        }

        const log = this.sessionChanges.get(this.currentSessionId);
        if (!log) {
            return;
        }

        // 添加到 changes 数组
        log.changes.push(change);

        // 更新 fileIndex
        if (!log.fileIndex[change.file]) {
            log.fileIndex[change.file] = [];
        }

        log.fileIndex[change.file].push({
            lines: change.lines,
            modifiedBy: change.modifiedBy,
            lastModifiedAt: change.lastModifiedAt
        });

        // 定期持久化（为了性能，不是每次都写入磁盘）
        // 这里可以添加防抖逻辑，但为简单起见，在 save session 时一次性写入
    }

    /**
     * 标记某些行被人工修改
     */
    public markManualEdit(filePath: string, startLine: number, endLine: number): void {
        if (!this.currentSessionId) {
            return;
        }

        const log = this.sessionChanges.get(this.currentSessionId);
        if (!log) {
            return;
        }

        // 查找所有涉及这个范围的变更记录，更新为 manual
        const fileChanges = log.fileIndex[filePath] || [];
        for (const change of fileChanges) {
            // 判断是否有重叠
            if (this.hasLineOverlap(change.lines, { start: startLine, end: endLine })) {
                change.modifiedBy = 'manual';
                change.lastModifiedAt = new Date().toISOString();
            }
        }
    }

    /**
     * 检查两个行范围是否重叠
     */
    private hasLineOverlap(
        range1: { start: number; end: number },
        range2: { start: number; end: number }
    ): boolean {
        return !(range1.end < range2.start || range2.end < range1.start);
    }

    /**
     * 保存当前会话的变更日志
     */
    public saveCurrentSession(): void {
        if (!this.currentSessionId) {
            return;
        }

        const log = this.sessionChanges.get(this.currentSessionId);
        if (!log || log.changes.length === 0) {
            return;
        }

        log.endTime = new Date().toISOString();

        try {
            const changesDir = this.projectStorage.getChangesDir();
            const sessionFile = path.join(changesDir, `${this.currentSessionId}.json`);

            fs.writeFileSync(sessionFile, JSON.stringify(log, null, 2), 'utf-8');
            console.log(`[ChangeTracking] Saved session ${this.currentSessionId} to ${sessionFile}`);
        } catch (e) {
            console.error('[ChangeTracking] Failed to save session:', e);
        }
    }

    /**
     * 从磁盘加载已存在的会话
     */
    private loadExistingSessions(): void {
        const changesDir = this.projectStorage.getChangesDir();
        
        try {
            if (!fs.existsSync(changesDir)) {
                return;
            }

            const files = fs.readdirSync(changesDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(changesDir, file), 'utf-8');
                    const log: SessionChangeLog = JSON.parse(content);
                    this.sessionChanges.set(log.sessionId, log);
                } catch (e) {
                    console.error(`[ChangeTracking] Failed to load session ${file}:`, e);
                }
            }

            console.log(`[ChangeTracking] Loaded ${this.sessionChanges.size} existing sessions`);
        } catch (e) {
            console.error('[ChangeTracking] Failed to load existing sessions:', e);
        }
    }

    /**
     * 获取单个文件的变更历史
     */
    public getFileChanges(filePath: string): LineChange[] {
        if (!this.currentSessionId) {
            return [];
        }

        const log = this.sessionChanges.get(this.currentSessionId);
        if (!log) {
            return [];
        }

        return log.changes.filter(c => c.file === filePath);
    }

    /**
     * 停止追踪，保存当前会话
     */
    public stopTracking(): void {
        this.saveCurrentSession();
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }
        console.log('[ChangeTracking] Tracking stopped');
    }
}
