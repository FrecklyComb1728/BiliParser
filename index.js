const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REFERER = 'https://www.bilibili.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_LEVELS = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;

const log = (level, message, data = {}) => {
    if ((LOG_LEVELS[level] ?? LOG_LEVELS.info) > CURRENT_LOG_LEVEL) return;
    const payload = { time: new Date().toISOString(), level, message, ...data };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
};

const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
];

const getMixinKey = (orig) => mixinKeyEncTab.map(n => orig[n]).join('').slice(0, 32);

const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');

async function httpsRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, resolve);
        req.on('error', reject);
        req.end();
    });
}

async function getFinalUrl(startUrl, maxRedirects = 10) {
    let currentUrl = startUrl;
    for (let i = 0; i < maxRedirects; i++) {
        const parsed = new URL(currentUrl);
        const options = {
            method: 'HEAD',
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search + parsed.hash,
            headers: { 'User-Agent': UA }
        };
        const response = await httpsRequest(options);
        if (![301, 302, 303, 307, 308].includes(response.statusCode) || !response.headers.location) {
            response.destroy();
            return currentUrl;
        }
        currentUrl = new URL(response.headers.location, currentUrl).toString();
        response.destroy();
    }
    throw new Error('Too many redirects');
}

async function httpGetJson(urlStr, extraHeaders = {}) {
    const parsed = new URL(urlStr);
    const options = {
        method: 'GET',
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': UA, ...extraHeaders }
    };
    return new Promise((resolve, reject) => {
        https.get(options, (resp) => {
            let body = '';
            resp.on('data', chunk => body += chunk);
            resp.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('JSON parse error: ' + body));
                }
            });
        }).on('error', reject);
    });
}

async function signWbi(params) {
    const json = await httpGetJson('https://api.bilibili.com/x/web-interface/nav');
    const { img_url, sub_url } = json.data.wbi_img;
    const img_key = img_url.split('/').pop().split('.')[0];
    const sub_key = sub_url.split('/').pop().split('.')[0];
    const mixin_key = getMixinKey(img_key + sub_key);
    const wts = Math.floor(Date.now() / 1000);
    const currParams = { ...params, wts };
    const sortedKeys = Object.keys(currParams).sort();
    const query = sortedKeys.map(k => `${k}=${encodeURIComponent(currParams[k])}`).join('&');
    const w_rid = md5(query + mixin_key);
    return `${query}&w_rid=${w_rid}`;
}

async function extractBvid(text) {
    text = text.trim();
    let match = text.match(/(BV[a-zA-Z0-9]{10})/i);
    if (match) return match[1];

    const b23Match = text.match(/b23\.tv\/([a-zA-Z0-9]+)/i);
    if (b23Match) {
        const shortUrl = `https://b23.tv/${b23Match[1]}`;
        const finalUrl = await getFinalUrl(shortUrl);
        match = finalUrl.match(/(BV[a-zA-Z0-9]{10})/i);
        if (match) return match[1];
    }

    // 支持完整 bilibili 链接
    match = text.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/i);
    if (match) return match[1];

    throw new Error('未能识别有效的 BV 号或链接');
}

async function resolveBili(bvid, qn, host) {
    qn = qn || 80;
    const vData = await httpGetJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    if (vData.code !== 0) throw new Error(vData.message || '视频信息获取失败');

    const { cid, title, pic } = vData.data;
    const signedQuery = await signWbi({ bvid, cid, qn, fnval: 1 });
    const pData = await httpGetJson(`https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`, { 'Referer': REFERER });
    if (pData.code !== 0) throw new Error(pData.message || '视频地址解析失败');

    const rawUrl = pData.data.durl?.[0]?.url;
    if (!rawUrl) throw new Error('未找到可用视频流（可能为 DASH 分段）');

    const playableUrl = `${host}/video?url=${encodeURIComponent(rawUrl)}`;
    return { title, pic: pic.replace(/^http:/, 'https:'), bvid, cid, rawUrl, playableUrl };
}

const server = http.createServer((req, res) => {
    const requestId = crypto.randomBytes(8).toString('hex');
    const startTime = process.hrtime.bigint();
    const remoteAddress = req.socket?.remoteAddress;

    const setResponseTime = () => {
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
        if (!res.headersSent) {
            res.setHeader('X-Response-Time', `${durationMs.toFixed(1)}ms`);
        }
        return durationMs;
    };

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
        log('info', 'request completed', {
            requestId,
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            durationMs: Number(durationMs.toFixed(1)),
            ip: remoteAddress
        });
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        setResponseTime();
        res.end();
        return;
    }

    const base = `http://${req.headers.host}`;
    const urlObj = new URL(req.url, base);
    const host = urlObj.origin;
    const urlPath = urlObj.pathname;
    const params = urlObj.searchParams;

    if (urlPath === '/video') {
        const target = params.get('url');
        if (!target) {
            res.statusCode = 400;
            setResponseTime();
            res.end('Missing url');
            return;
        }
        try {
            https.get(target, { headers: { 'Referer': REFERER, 'User-Agent': UA } }, (upstream) => {
                setResponseTime();
                res.writeHead(upstream.statusCode, upstream.headers);
                upstream.pipe(res);
            }).on('error', () => {
                if (!res.headersSent) {
                    res.statusCode = 502;
                    setResponseTime();
                    res.end('Proxy error');
                }
                log('error', 'proxy error', { requestId, target });
            });
        } catch {
            res.statusCode = 400;
            setResponseTime();
            res.end('Invalid URL');
        }
        return;
    }

    if (urlPath === '/' || urlPath === '') {
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, content) => {
            if (err) {
                res.statusCode = 500;
                setResponseTime();
                res.end('Server Error: public/index.html not found');
                return;
            }
            setResponseTime();
            res.end(content);
        });
        return;
    }

    const handler = async () => {
        try {
            if (urlPath === '/api/any') {
                const text = params.get('text');
                const qn = params.get('qn') || '80';
                if (!text) throw new Error('Missing text');
                const bvid = await extractBvid(text);
                const info = await resolveBili(bvid, qn, host);
                res.setHeader('Content-Type', 'application/json; charset=UTF-8');
                res.setHeader('Access-Control-Allow-Origin', '*');
                setResponseTime();
                res.end(JSON.stringify({ status: 'success', ...info }));
            } else {
                const directMatch = urlPath.match(/^\/(BV[a-zA-Z0-9]{10})$/);
                const jsonMatch = urlPath.match(/^\/json\/(BV[a-zA-Z0-9]{10})$/);
                if (directMatch || jsonMatch) {
                    const bvid = directMatch ? directMatch[1] : jsonMatch[1];
                    const qn = params.get('qn') || '80';
                    const info = await resolveBili(bvid, qn, host);
                    if (directMatch) {
                        setResponseTime();
                        res.writeHead(302, { Location: info.playableUrl });
                        res.end();
                    } else {
                        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
                        setResponseTime();
                        res.end(JSON.stringify(info));
                    }
                } else {
                    throw new Error('Not Found');
                }
            }
        } catch (e) {
            const status = e.message === 'Not Found' ? 404 : 500;
            if (!res.headersSent) {
                res.statusCode = status;
                res.setHeader('Content-Type', 'application/json; charset=UTF-8');
                setResponseTime();
                res.end(JSON.stringify({ status: 'error', message: e.message || 'Unknown error' }));
            }
            log('error', 'request failed', { requestId, message: e.message });
        }
    };

    handler();
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Bilibili Resolver 本地版运行中：http://localhost:${PORT}`);
});
