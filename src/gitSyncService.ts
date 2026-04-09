import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as crypto from 'crypto';
import { GitSyncConfig, ChatSession } from './types';

/**
 * 同步状态记录：保存每个文件最近一次成功同步的 SHA
 * key: 相对仓库的路径（如 'jsonl/xxx.jsonl'）
 * value: { remoteSha, localHash, syncedAt }
 */
interface FileSyncRecord {
    remoteSha: string;    // GitHub 上的 blob sha
    localHash: string;    // 本地内容的 sha256 前16位（用于快速对比）
    syncedAt: string;     // ISO 时间
}
interface SyncState {
    version: 1;
    files: Record<string, FileSyncRecord>;
}

function sha256short(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
}

export class GitSyncService {
    private configPath: string;
    private syncStatePath: string;
    private config: GitSyncConfig | null = null;
    private syncState: SyncState = { version: 1, files: {} };

    constructor(private globalStoragePath: string) {
        this.configPath = path.join(globalStoragePath, 'git-sync-config.json');
        this.syncStatePath = path.join(globalStoragePath, 'git-sync-state.json');
        this.loadConfig();
        this.loadSyncState();
    }

    // ===== 配置管理 =====

    loadConfig(): GitSyncConfig | null {
        try {
            if (fs.existsSync(this.configPath)) {
                this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
            }
        } catch { this.config = null; }
        return this.config;
    }

    saveConfig(config: GitSyncConfig): void {
        this.config = config;
        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    }

    getConfig(): GitSyncConfig | null { return this.config; }
    isConfigured(): boolean { return !!(this.config?.repoUrl && this.config?.token); }

    // ===== 同步状态管理 =====

    private loadSyncState(): void {
        try {
            if (fs.existsSync(this.syncStatePath)) {
                this.syncState = JSON.parse(fs.readFileSync(this.syncStatePath, 'utf-8'));
            }
        } catch { this.syncState = { version: 1, files: {} }; }
    }

    private saveSyncState(): void {
        try {
            fs.writeFileSync(this.syncStatePath, JSON.stringify(this.syncState, null, 2), 'utf-8');
        } catch { }
    }

    /** 清空本地同步状态，下次 pull 时强制重新下载所有远端文件 */
    public clearSyncState(): void {
        this.syncState = { version: 1, files: {} };
        this.saveSyncState();
    }

    /** 检查本地内容是否与上次同步时一致（即是否有变化需要推送） */
    private hasLocalChanged(filePath: string, content: string): boolean {
        const record = this.syncState.files[filePath];
        if (!record) { return true; }  // 从未同步过，需要上传
        return sha256short(content) !== record.localHash;
    }

    /** 更新同步状态记录 */
    private markSynced(filePath: string, remoteSha: string, content: string): void {
        this.syncState.files[filePath] = {
            remoteSha,
            localHash: sha256short(content),
            syncedAt: new Date().toISOString(),
        };
    }

    // ===== Markdown 生成 =====

    generateMarkdown(sessions: ChatSession[]): string {
        const now = new Date().toLocaleString('zh-CN');
        let md = `# Copilot Chat 历史记录\n\n`;
        md += `> 同步时间：${now}\n> 共 ${sessions.length} 个对话\n\n---\n\n`;
        for (const session of sessions) {
            const createdAt = new Date(session.createdAt).toLocaleString('zh-CN');
            const updatedAt = new Date(session.updatedAt).toLocaleString('zh-CN');
            const archivedTag = session.archived ? ' 🗄️ *已归档*' : '';
            const pinTag = session.pinType ? (session.pinType === 'global' ? ' 📌全局' : ' 📌') : '';
            md += `## ${session.title}${pinTag}${archivedTag}\n\n`;
            md += `- **创建时间**：${createdAt}\n- **更新时间**：${updatedAt}\n- **提问数量**：${session.turns.length}\n`;
            if (session.note) { md += `- **备注**：${session.note}\n`; }
            md += `\n`;
            for (let i = 0; i < session.turns.length; i++) {
                const turn = session.turns[i];
                const turnTime = turn.timestamp ? new Date(turn.timestamp).toLocaleString('zh-CN') : '';
                md += `### Q${i + 1}. ${turn.userMessage.substring(0, 100)}${turn.userMessage.length > 100 ? '...' : ''}\n\n`;
                if (turnTime) { md += `*🕐 ${turnTime}*\n\n`; }
                if (turn.note) { md += `> 📝 备注：${turn.note}\n\n`; }
                md += `**提问：**\n\n${turn.userMessage}\n\n`;
                for (const resp of turn.responses) {
                    const respTime = resp.timestamp ? new Date(resp.timestamp).toLocaleString('zh-CN') : '';
                    md += `**回复：**${respTime ? ` *🕐 ${respTime}*` : ''}\n\n${resp.content}\n\n`;
                }
                md += `---\n\n`;
            }
        }
        return md;
    }

    // ===== GitHub REST API =====

    private async apiRequest(method: string, urlPath: string, body?: any): Promise<any> {
        if (!this.config) { throw new Error('未配置 GitHub 同步'); }
        const urlObj = new URL(this.config.repoUrl);
        const repoPath = urlObj.pathname.replace(/\.git$/, '').replace(/^\//, '');
        const apiUrl = `https://api.github.com/repos/${repoPath}${urlPath}`;

        return new Promise((resolve, reject) => {
            const bodyStr = body ? JSON.stringify(body) : '';
            const options = {
                method,
                headers: {
                    'Authorization': `token ${this.config!.token}`,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'copilot-history-viewer',
                    'Content-Length': Buffer.byteLength(bodyStr),
                } as any,
            };
            const req = https.request(apiUrl, options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = data ? JSON.parse(data) : {};
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`GitHub API ${res.statusCode}: ${json.message || data}`));
                        } else { resolve(json); }
                    } catch { reject(new Error(`解析响应失败: ${data}`)); }
                });
            });
            req.on('error', reject);
            if (bodyStr) { req.write(bodyStr); }
            req.end();
        });
    }

    /**
     * 列出目录下所有文件，返回 { name, sha }[]
     * sha 是 GitHub blob sha，可用于增量对比
     */
    private async listRemoteFilesWithSha(dirPath: string): Promise<Array<{ name: string; sha: string }>> {
        try {
            const res = await this.apiRequest('GET', `/contents/${dirPath}?ref=${this.config!.branch}`);
            if (Array.isArray(res)) {
                return res.filter((f: any) => f.type === 'file').map((f: any) => ({ name: f.name as string, sha: f.sha as string }));
            }
        } catch { }
        return [];
    }

    /** 获取文件的远端 SHA */
    private async getFileSha(filePath: string): Promise<string | null> {
        try {
            const res = await this.apiRequest('GET', `/contents/${filePath}?ref=${this.config!.branch}`);
            return res.sha || null;
        } catch { return null; }
    }

    /**
     * 上传文件（增量：本地内容未变化则跳过）
     * 返回是否实际上传了
     */
    async uploadFile(
        filePath: string,
        content: string,
        commitMsg: string,
        force = false
    ): Promise<boolean> {
        // 增量检查：内容未变化则跳过
        if (!force && !this.hasLocalChanged(filePath, content)) {
            return false;  // 跳过
        }
        // 需要拿远端 SHA 才能 PUT（更新已有文件）
        const remoteSha = await this.getFileSha(filePath);
        const body: any = {
            message: commitMsg,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch: this.config!.branch,
        };
        if (remoteSha) { body.sha = remoteSha; }
        const result = await this.apiRequest('PUT', `/contents/${filePath}`, body);
        // 记录同步状态
        const newSha = result?.content?.sha || remoteSha || '';
        this.markSynced(filePath, newSha, content);
        this.saveSyncState();
        return true;
    }

    /** 下载单个文件内容（支持大文件通过 download_url 下载） */
    async downloadFile(filePath: string): Promise<string | null> {
        try {
            const res = await this.apiRequest('GET', `/contents/${filePath}?ref=${this.config!.branch}`);
            if (res.content) {
                // 小文件：直接 base64 解码
                return Buffer.from(res.content, 'base64').toString('utf-8');
            } else if (res.download_url) {
                // 大文件（>1MB）：GitHub API 不返回 content，需用 download_url 下载原始内容
                return await this.downloadRawUrl(res.download_url);
            }
        } catch { }
        return null;
    }

    /** 通过 raw URL 下载文件内容（用于大文件） */
    private downloadRawUrl(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const doReq = (reqUrl: string) => {
                https.get(reqUrl, {
                    headers: {
                        'User-Agent': 'copilot-history-viewer',
                        'Authorization': `token ${this.config!.token}`,
                    }
                }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        doReq(res.headers.location);
                        return;
                    }
                    const chunks: Buffer[] = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
                    res.on('error', reject);
                }).on('error', reject);
            };
            doReq(url);
        });
    }

    // ===== Push / Pull =====

    /**
     * 增量推送：
     * - metadata.json：内容有变化才上传
     * - sessions.md：内容有变化才上传
     * - jsonl/*.jsonl：只上传本地新增或内容变化的文件
     */
    async push(
        metadataContent: string,
        sessions: ChatSession[],
        onProgress?: (msg: string) => void,
        jsonlFiles?: Array<{ filename: string; content: string }>
    ): Promise<{ uploaded: number; skipped: number }> {
        if (!this.isConfigured()) { throw new Error('请先配置 GitHub 私有仓库'); }

        const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
        const commitMsg = `同步聊天记录 ${now}`;
        let uploaded = 0;
        let skipped = 0;

        // metadata.json
        const metaUploaded = await this.uploadFile('metadata.json', metadataContent, commitMsg);
        metaUploaded ? uploaded++ : skipped++;
        onProgress?.(metaUploaded ? '✓ 已上传 metadata.json' : '— metadata.json 无变化，跳过');

        // sessions.md
        const md = this.generateMarkdown(sessions);
        const mdUploaded = await this.uploadFile('sessions.md', md, commitMsg);
        mdUploaded ? uploaded++ : skipped++;
        onProgress?.(mdUploaded ? '✓ 已上传 sessions.md' : '— sessions.md 无变化，跳过');

        // jsonl 文件（增量）
        if (jsonlFiles && jsonlFiles.length > 0) {
            onProgress?.(`开始检查 ${jsonlFiles.length} 个聊天记录文件...`);
            let fileUploaded = 0;
            let fileSkipped = 0;
            for (const file of jsonlFiles) {
                try {
                    const did = await this.uploadFile(`jsonl/${file.filename}`, file.content, commitMsg);
                    did ? fileUploaded++ : fileSkipped++;
                } catch (e: any) {
                    console.error(`上传 ${file.filename} 失败:`, e.message);
                }
            }
            uploaded += fileUploaded;
            skipped += fileSkipped;
            onProgress?.(`聊天记录：上传 ${fileUploaded} 个，跳过 ${fileSkipped} 个（无变化）`);
        }

        onProgress?.(`推送完成：共上传 ${uploaded} 个文件，跳过 ${skipped} 个`);
        return { uploaded, skipped };
    }

    /**
     * 增量拉取：
     * - metadata.json：远端 SHA 与上次同步记录不同才下载
     * - jsonl/*.jsonl：只下载远端新增或变化的文件
     */
    async pull(
        onProgress?: (msg: string) => void,
        onJsonl?: (filename: string, content: string) => void
    ): Promise<string | null> {
        if (!this.isConfigured()) { throw new Error('请先配置 GitHub 私有仓库'); }

        let metaContent: string | null = null;

        // 检查 metadata.json 是否有变化
        onProgress?.('正在检查 metadata.json...');
        try {
            const metaRes = await this.apiRequest('GET', `/contents/metadata.json?ref=${this.config!.branch}`);
            const remoteMetaSha = metaRes.sha as string;
            const lastRecord = this.syncState.files['metadata.json'];

            if (!lastRecord || lastRecord.remoteSha !== remoteMetaSha) {
                // 远端有更新
                metaContent = Buffer.from(metaRes.content, 'base64').toString('utf-8');
                this.markSynced('metadata.json', remoteMetaSha, metaContent);
                this.saveSyncState();
                onProgress?.('✓ 已拉取 metadata.json（有更新）');
            } else {
                onProgress?.('— metadata.json 无变化，跳过');
            }
        } catch { onProgress?.('metadata.json 不存在，跳过'); }

        // 检查 jsonl 目录
        onProgress?.('正在获取远端文件列表...');
        const remoteFiles = await this.listRemoteFilesWithSha('jsonl');

        if (remoteFiles.length > 0) {
            // 找出需要下载的文件（新增或 SHA 变化）
            const toDownload = remoteFiles.filter(f => {
                const key = `jsonl/${f.name}`;
                const record = this.syncState.files[key];
                return !record || record.remoteSha !== f.sha;
            });
            const skipCount = remoteFiles.length - toDownload.length;

            if (toDownload.length === 0) {
                onProgress?.(`— 所有 ${remoteFiles.length} 个聊天记录文件无变化，跳过`);
            } else {
                onProgress?.(`需下载 ${toDownload.length} 个文件（跳过 ${skipCount} 个无变化文件）...`);
                let downloaded = 0;
                for (const file of toDownload) {
                    try {
                        const content = await this.downloadFile(`jsonl/${file.name}`);
                        if (content) {
                            onJsonl?.(file.name, content);
                            this.markSynced(`jsonl/${file.name}`, file.sha, content);
                            downloaded++;
                            if (downloaded % 5 === 0 || downloaded === toDownload.length) {
                                onProgress?.(`已拉取 ${downloaded}/${toDownload.length} 个文件...`);
                            }
                        }
                    } catch (e: any) {
                        console.error(`拉取 ${file.name} 失败:`, e.message);
                    }
                }
                this.saveSyncState();
                onProgress?.(`✓ 拉取完成：下载 ${downloaded} 个，跳过 ${skipCount} 个`);
            }
        } else {
            onProgress?.('远端暂无聊天记录文件');
        }

        if (!metaContent && remoteFiles.length === 0) {
            onProgress?.('远端暂无数据');
        }
        return metaContent;
    }

    /** 验证 token 和仓库是否可访问 */
    async testConnection(): Promise<{ ok: boolean; message: string }> {
        try {
            const res = await this.apiRequest('GET', '');
            return { ok: true, message: `连接成功：${res.full_name || this.config?.repoUrl}` };
        } catch (e: any) {
            return { ok: false, message: e.message || '连接失败' };
        }
    }
}