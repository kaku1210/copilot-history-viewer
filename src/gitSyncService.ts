import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { GitSyncConfig, ChatSession } from './types';

/**
 * GitHub 同步服务
 * 使用 GitHub REST API（不依赖 git 命令行）
 * 同步内容：
 *   1. metadata.json（备注/归档/置顶等附加数据）
 *   2. exports/sessions.md（全量 Markdown 可读版本）
 *   3. raw/*.jsonl 的索引（原始文件列表，不上传原文）
 */
export class GitSyncService {
    private configPath: string;
    private config: GitSyncConfig | null = null;

    constructor(private globalStoragePath: string) {
        this.configPath = path.join(globalStoragePath, 'git-sync-config.json');
        this.loadConfig();
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

    getConfig(): GitSyncConfig | null {
        return this.config;
    }

    isConfigured(): boolean {
        return !!(this.config?.repoUrl && this.config?.token);
    }

    // ===== 生成 Markdown =====

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
            md += `- **创建时间**：${createdAt}\n`;
            md += `- **更新时间**：${updatedAt}\n`;
            md += `- **提问数量**：${session.turns.length}\n`;
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

    // ===== GitHub API 调用 =====

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
                },
            };
            const req = https.request(apiUrl, options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = data ? JSON.parse(data) : {};
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`GitHub API ${res.statusCode}: ${json.message || data}`));
                        } else {
                            resolve(json);
                        }
                    } catch { reject(new Error(`解析响应失败: ${data}`)); }
                });
            });
            req.on('error', reject);
            if (bodyStr) { req.write(bodyStr); }
            req.end();
        });
    }

    /** 获取文件的 SHA（用于更新已有文件） */
    private async getFileSha(filePath: string): Promise<string | null> {
        try {
            const res = await this.apiRequest('GET', `/contents/${filePath}?ref=${this.config!.branch}`);
            return res.sha || null;
        } catch { return null; }
    }

    /** 上传或更新单个文件 */
    async uploadFile(filePath: string, content: string, commitMsg: string): Promise<void> {
        const sha = await this.getFileSha(filePath);
        const body: any = {
            message: commitMsg,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch: this.config!.branch,
        };
        if (sha) { body.sha = sha; }
        await this.apiRequest('PUT', `/contents/${filePath}`, body);
    }

    /** 下载单个文件内容 */
    async downloadFile(filePath: string): Promise<string | null> {
        try {
            const res = await this.apiRequest('GET', `/contents/${filePath}?ref=${this.config!.branch}`);
            if (res.content) {
                return Buffer.from(res.content, 'base64').toString('utf-8');
            }
            return null;
        } catch { return null; }
    }

    // ===== Push / Pull =====

    /**
     * 列出 GitHub 仓库某目录下的所有文件名
     */
    private async listRemoteFiles(dirPath: string): Promise<string[]> {
        try {
            const res = await this.apiRequest('GET', `/contents/${dirPath}?ref=${this.config!.branch}`);
            if (Array.isArray(res)) {
                return res.filter((f: any) => f.type === 'file').map((f: any) => f.name as string);
            }
        } catch { }
        return [];
    }

    /**
     * 推送：上传 metadata.json + sessions.md + 所有本地 .jsonl
     */
    async push(
        metadataContent: string,
        sessions: ChatSession[],
        onProgress?: (msg: string) => void,
        jsonlFiles?: Array<{ filename: string; content: string }>
    ): Promise<void> {
        if (!this.isConfigured()) { throw new Error('请先配置 GitHub 私有仓库'); }

        const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
        const commitMsg = `同步聊天记录 ${now}`;

        onProgress?.('正在上传 metadata.json...');
        await this.uploadFile('metadata.json', metadataContent, commitMsg);

        onProgress?.('正在生成并上传 Markdown...');
        const md = this.generateMarkdown(sessions);
        await this.uploadFile('sessions.md', md, commitMsg);

        // 上传 .jsonl 原始文件
        if (jsonlFiles && jsonlFiles.length > 0) {
            onProgress?.(`正在上传 ${jsonlFiles.length} 个聊天记录文件...`);
            let uploaded = 0;
            for (const file of jsonlFiles) {
                try {
                    await this.uploadFile(`jsonl/${file.filename}`, file.content, commitMsg);
                    uploaded++;
                    if (uploaded % 5 === 0 || uploaded === jsonlFiles.length) {
                        onProgress?.(`已上传 ${uploaded}/${jsonlFiles.length} 个文件...`);
                    }
                } catch (e: any) {
                    console.error(`上传 ${file.filename} 失败:`, e.message);
                }
            }
        }

        onProgress?.('推送完成');
    }

    /**
     * 拉取：下载 metadata.json + 所有远端 .jsonl
     * 返回 metadata 内容；.jsonl 通过回调写入本地
     */
    async pull(
        onProgress?: (msg: string) => void,
        onJsonl?: (filename: string, content: string) => void
    ): Promise<string | null> {
        if (!this.isConfigured()) { throw new Error('请先配置 GitHub 私有仓库'); }

        onProgress?.('正在拉取 metadata.json...');
        const metaContent = await this.downloadFile('metadata.json');

        // 拉取远端 .jsonl 文件列表
        onProgress?.('正在获取聊天记录文件列表...');
        const remoteFiles = await this.listRemoteFiles('jsonl');

        if (remoteFiles.length > 0) {
            onProgress?.(`正在拉取 ${remoteFiles.length} 个聊天记录文件...`);
            let downloaded = 0;
            for (const filename of remoteFiles) {
                try {
                    const content = await this.downloadFile(`jsonl/${filename}`);
                    if (content && onJsonl) {
                        onJsonl(filename, content);
                        downloaded++;
                        if (downloaded % 5 === 0 || downloaded === remoteFiles.length) {
                            onProgress?.(`已拉取 ${downloaded}/${remoteFiles.length} 个文件...`);
                        }
                    }
                } catch (e: any) {
                    console.error(`拉取 ${filename} 失败:`, e.message);
                }
            }
        }

        if (metaContent || remoteFiles.length > 0) {
            onProgress?.('拉取完成');
        } else {
            onProgress?.('远端暂无数据');
        }
        return metaContent;
    }

    /** 验证 token 和仓库是否可访问 */
    async testConnection(): Promise<{ ok: boolean; message: string }> {
        try {
            const urlObj = new URL(this.config!.repoUrl);
            const repoPath = urlObj.pathname.replace(/\.git$/, '').replace(/^\//, '');
            const res = await this.apiRequest('GET', '');
            return { ok: true, message: `连接成功：${res.full_name || repoPath}` };
        } catch (e: any) {
            return { ok: false, message: e.message || '连接失败' };
        }
    }
}
