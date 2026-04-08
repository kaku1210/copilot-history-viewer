import * as https from 'https';

const REPO = 'kaku1210/copilot-history-viewer';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const VSIX_URL = `https://github.com/${REPO}/raw/main/copilot-history-viewer.vsix`;

/** 获取带缓存破坏参数的 package.json URL，通过 GitHub API 读取（不经过 CDN 缓存） */
function getPackageUrl(): string {
    // 使用 GitHub Contents API，绕过 raw.githubusercontent.com 的 CDN 缓存
    return `https://api.github.com/repos/${REPO}/contents/package.json`;
}

export interface UpdateInfo {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    releasesUrl: string;
    vsixUrl: string;
}

/** 从字符串中比较语义化版本号，返回 true 表示 remote > local */
function isNewer(remote: string, local: string): boolean {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const r = parse(remote);
    const l = parse(local);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const rv = r[i] ?? 0;
        const lv = l[i] ?? 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
    }
    return false;
}

function fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'copilot-history-viewer-updater' }
        }, (res) => {
            // 处理重定向
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchJson(res.headers.location).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('解析响应失败')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('请求超时')); });
    });
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo> {
    const base: UpdateInfo = {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        releasesUrl: RELEASES_URL,
        vsixUrl: VSIX_URL,
    };
    try {
        // 使用 GitHub Contents API，返回 base64 编码的文件内容，不受 CDN 缓存影响
        const apiResp = await fetchJson(getPackageUrl());
        // apiResp.content 是 base64，需要解码后再 JSON.parse
        const decoded = Buffer.from(apiResp.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(decoded);
        const latestVersion: string = pkg.version || currentVersion;
        base.latestVersion = latestVersion;
        base.hasUpdate = isNewer(latestVersion, currentVersion);
    } catch (e) {
        // 网络失败静默处理
    }
    return base;
}
