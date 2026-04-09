import * as https from 'https';

const REPO = 'kaku1210/copilot-history-viewer';
const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** VSIX 下载 URL：通过 GitHub Contents API 获取 download_url，绕过 CDN 缓存 */
async function getVsixDownloadUrl(token?: string): Promise<string> {
    try {
        const apiUrl = `https://api.github.com/repos/${REPO}/contents/copilot-history-viewer.vsix?t=${Date.now()}`;
        const resp = await fetchJson(apiUrl, token);
        if (resp.download_url) {
            return resp.download_url;
        }
    } catch { }
    // fallback: raw URL + 时间戳破缓存
    return `https://github.com/${REPO}/raw/main/copilot-history-viewer.vsix?t=${Date.now()}`;
}

/** 获取带缓存破坏参数的 package.json URL，通过 GitHub API 读取（不经过 CDN 缓存） */
function getPackageUrl(): string {
    // 使用 GitHub Contents API + 时间戳，彻底绕过任何缓存
    return `https://api.github.com/repos/${REPO}/contents/package.json?t=${Date.now()}`;
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

function fetchJson(url: string, token?: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            'User-Agent': 'copilot-history-viewer-updater',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        };
        if (token) { headers['Authorization'] = `token ${token}`; }
        const req = https.get(url, { headers }, (res) => {
            // 处理重定向
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchJson(res.headers.location, token).then(resolve).catch(reject);
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

export async function checkForUpdate(currentVersion: string, token?: string): Promise<UpdateInfo> {
    // 先获取动态 VSIX 下载链接（带真实 SHA，绕过 CDN 缓存）
    const vsixUrl = await getVsixDownloadUrl(token);
    const base: UpdateInfo = {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        releasesUrl: RELEASES_URL,
        vsixUrl,
    };
    try {
        const apiResp = await fetchJson(getPackageUrl(), token);
        if (!apiResp.content) {
            throw new Error(apiResp.message || 'GitHub API 返回异常');
        }
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
