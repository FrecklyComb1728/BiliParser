const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const REFERER = 'https://www.bilibili.com/';
const LIVE_REFERER = 'https://live.bilibili.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_LEVELS = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;

const log = (level, message, data = {}) => {
    if ((LOG_LEVELS[level] ?? LOG_LEVELS.info) > CURRENT_LOG_LEVEL) return;
    const payload = { time: new Date().toISOString(), level, message, ...data };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
};

const RESULT_TEMPLATE_PATH = path.join(__dirname, 'public', 'index.html');
let resultTemplateCache = null;

const ERROR_MAP = {
    '-400': '请求错误', '-403': '访问权限不足', '-404': '视频不存在',
    '-10403': '仅限港澳台地区', '62002': '视频不可见', '62004': '审核中'
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

async function getBuvid() {
    try {
        const json = await httpGetJson('https://api.bilibili.com/x/frontend/finger/spi');
        return json.data?.b_3 || 'FE6D3664-927F-F75B-B7D4-733E5D4B263F69428infoc';
    } catch {
        return 'FE6D3664-927F-F75B-B7D4-733E5D4B263F69428infoc';
    }
}

async function requestStream(urlStr, headers) {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
        const req = client.request({
            method: 'GET',
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers
        }, resolve);
        req.on('error', reject);
        req.end();
    });
}

async function readStreamText(stream) {
    return new Promise((resolve, reject) => {
        let body = '';
        stream.on('data', chunk => body += chunk);
        stream.on('end', () => resolve(body));
        stream.on('error', reject);
    });
}

function isAllowedHost(hostname) {
    return hostname.includes('bilivideo') || hostname.includes('hdslb') || hostname.includes('akamaized');
}

function loadResultTemplate() {
    if (resultTemplateCache !== null) return resultTemplateCache;
    try {
        const html = fs.readFileSync(RESULT_TEMPLATE_PATH, 'utf8');
        const match = html.match(/<template id="result-template">([\s\S]*?)<\/template>/);
        resultTemplateCache = match ? match[1].trim() : '';
    } catch {
        resultTemplateCache = '';
    }
    return resultTemplateCache;
}

function renderTemplate(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

function sendHtml(res, setResponseTime, html) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    setResponseTime();
    res.end(html);
}

function sendJson(res, setResponseTime, payload, extraHeaders = {}) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
    setResponseTime();
    res.end(JSON.stringify(payload));
}

function parseRoomId(text) {
    return text?.match(/(\d+)/)?.[1] || null;
}

function sendApiSuccess(res, setResponseTime, data, cors = false) {
    sendJson(res, setResponseTime, { status: 'success', ...data }, cors ? { 'Access-Control-Allow-Origin': '*' } : {});
}

function sendApiError(res, setResponseTime, message, cors = false) {
    sendJson(res, setResponseTime, { status: 'error', message }, cors ? { 'Access-Control-Allow-Origin': '*' } : {});
}

function buildErrorHtml(message) {
    return `
        <div class="alert alert-danger border-0 shadow-sm d-flex align-items-center gap-3 fade-in" role="alert">
            <i class="ri-error-warning-fill fs-4"></i>
            <div>
                <div class="fw-bold">解析失败</div>
                <div class="small">${message || '未知错误，请检查链接是否正确'}</div>
            </div>
        </div>
    `;
}

function getQn(params) {
    return params.get('qn') || '80';
}

function buildProxyHeaders(urlStr, reqHeaders) {
    const isM3u8 = urlStr.includes('.m3u8');
    const isLive = urlStr.includes('live-bvc') || isM3u8;
    const headers = {
        'Referer': isLive ? LIVE_REFERER : REFERER,
        'User-Agent': isLive ? UA_MOBILE : UA,
        'Origin': isLive ? 'https://live.bilibili.com' : 'https://www.bilibili.com'
    };
    if (reqHeaders.range) headers.Range = reqHeaders.range;
    return { headers, isM3u8 };
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

async function getPlayUrlWithFallback(bvid, cid, targetQn) {
    const qualities = [targetQn, 80, 64, 32].filter((v, i, a) => a.indexOf(v) === i && v <= targetQn);
    let lastError = null;
    for (const qn of qualities) {
        try {
            const signedQuery = await signWbi({ bvid, cid, qn, fnval: 1 });
            const pData = await httpGetJson(`https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`, { 'Referer': REFERER });
            if (pData.code === 0 && pData.data?.durl?.[0]) {
                return { url: pData.data.durl[0].url, quality: pData.data.quality };
            }
            lastError = pData.message || ERROR_MAP[pData.code];
        } catch (e) {
            lastError = e.message;
        }
    }
    throw new Error(lastError || '视频解析失败');
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
    // 支持直播链接
    const liveMatch = text.match(/live\.bilibili\.com\/(\d+)/i);
    
    if (match) return match[1];
    if (liveMatch) return `Live${liveMatch[1]}`;

    throw new Error('未能识别有效的 BV 号或链接');
}

async function resolveBili(bvid, qn, host) {
    const qnValue = parseInt(qn, 10) || 80;
    const vData = await httpGetJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    if (vData.code !== 0) throw new Error(ERROR_MAP[vData.code] || vData.message || '视频信息获取失败');

    const { cid, title, pic, owner } = vData.data;
    const videoStream = await getPlayUrlWithFallback(bvid, cid, qnValue);
    const playableUrl = `${host}/video?url=${encodeURIComponent(videoStream.url)}`;
    const downloadUrl = `${host}/download?url=${encodeURIComponent(videoStream.url)}`;
    return {
        title,
        pic: pic.replace(/^http:/, 'https:'),
        bvid,
        cid,
        rawUrl: videoStream.url,
        playableUrl,
        downloadUrl,
        quality: videoStream.quality,
        author: owner?.name,
        isLive: false
    };
}

async function resolveLive(roomId, host) {
    const infoData = await httpGetJson(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, { 'Referer': LIVE_REFERER });
    if (infoData.code !== 0) throw new Error('直播间不存在');

    const { title, user_cover, keyframe, live_status, room_id: realRoomId, uid } = infoData.data;
    if (live_status !== 1) throw new Error('主播未开播');

    const buvid = await getBuvid();
    const headers = {
        'User-Agent': UA_MOBILE,
        'Referer': `https://live.bilibili.com/${realRoomId}`,
        'Origin': 'https://live.bilibili.com',
        'Cookie': `buvid3=${buvid}`
    };

    const fetchStreamLegacy = async () => {
        try {
            const data = await httpGetJson(`https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${realRoomId}&platform=h5&quality=3`, headers);
            if (data.data?.durl?.[0]?.url) {
                const url = data.data.durl[0].url;
                const isCN = url.includes('cn-');
                return { url, nodeType: isCN ? 'CN' : 'OV' };
            }
        } catch {}
        return null;
    };

    const fetchStreamV2 = async () => {
        try {
            const data = await httpGetJson(`https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${realRoomId}&protocol=0,1&format=0,1,2&codec=0,1&platform=h5&qn=150`, headers);
            const streams = data.data?.playurl_info?.playurl?.stream;
            if (!streams) return null;
            for (const s of streams) {
                if (s.format?.[0]?.codec?.[0]) {
                    const codecInfo = s.format[0].codec[0];
                    const urlInfos = codecInfo.url_info;
                    const cnNode = urlInfos.find(u => u.host.includes('cn-'));
                    if (cnNode) {
                        return { url: cnNode.host + codecInfo.base_url + cnNode.extra, nodeType: 'CN' };
                    }
                    return { url: urlInfos[0].host + codecInfo.base_url + urlInfos[0].extra, nodeType: 'OV' };
                }
            }
        } catch {}
        return null;
    };

    let result = await fetchStreamLegacy();
    if (!result) result = await fetchStreamV2();
    if (!result) throw new Error('获取直播流失败');

    const isHls = result.url.includes('.m3u8');
    const formatStr = `${isHls ? 'HLS' : 'FLV'} (${result.nodeType})`;
    const playableUrl = `${host}/live?url=${encodeURIComponent(result.url)}`;

    return {
        title,
        pic: user_cover || keyframe,
        author: `UID:${uid}`,
        playableUrl,
        downloadUrl: result.url,
        quality: 0,
        isLive: true,
        format: formatStr,
        nodeType: result.nodeType
    };
}

async function proxyToResponse({ req, res, requestId, setResponseTime, target, host, isDownload, downloadName, allowM3u8Rewrite }) {
    if (!target) {
        res.statusCode = 400;
        setResponseTime();
        res.end('Missing url');
        return;
    }

    let targetUrl;
    try {
        targetUrl = new URL(target);
    } catch {
        res.statusCode = 400;
        setResponseTime();
        res.end('Invalid URL');
        return;
    }

    if (!isAllowedHost(targetUrl.hostname)) {
        res.statusCode = 403;
        setResponseTime();
        res.end('Forbidden');
        return;
    }

    const { headers, isM3u8 } = buildProxyHeaders(target, req.headers);

    try {
        const upstream = await requestStream(target, headers);
        if (allowM3u8Rewrite && isM3u8) {
            let m3u8Content = await readStreamText(upstream);
            const baseUrl = target.substring(0, target.lastIndexOf('/') + 1);
            m3u8Content = m3u8Content.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const absoluteUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
                    return `${host}/live?url=${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
            }).join('\n');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            setResponseTime();
            res.end(m3u8Content);
            return;
        }

        const responseHeaders = { ...upstream.headers };
        delete responseHeaders['content-disposition'];
        if (downloadName && isDownload) {
            responseHeaders['content-disposition'] = `attachment; filename="${encodeURIComponent(downloadName)}"`;
        }
        if (allowM3u8Rewrite) responseHeaders['access-control-allow-origin'] = '*';
        setResponseTime();
        res.writeHead(upstream.statusCode || 502, responseHeaders);
        await pipeline(upstream, res);
    } catch (e) {
        if (!res.headersSent) {
            res.statusCode = 502;
            setResponseTime();
            res.end('Proxy error');
        }
        log('error', 'proxy error', { requestId, target });
    }
}

function handleRequest(req, res) {
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
        proxyToResponse({
            req,
            res,
            requestId,
            setResponseTime,
            target,
            host,
            isDownload: false,
            allowM3u8Rewrite: false
        });
        return;
    }

    if (urlPath === '/download') {
        const target = params.get('url');
        let fileName = 'video.mp4';
        if (target) {
            try {
                const targetUrl = new URL(target);
                const pathname = targetUrl.pathname || '';
                const lastSegment = pathname.split('/').filter(Boolean).pop();
                if (lastSegment) {
                    fileName = lastSegment;
                }
            } catch {}
        }
        proxyToResponse({
            req,
            res,
            requestId,
            setResponseTime,
            target,
            host,
            isDownload: true,
            downloadName: fileName,
            allowM3u8Rewrite: false
        });
        return;
    }

    if (urlPath === '/live') {
        const target = params.get('url');
        const name = params.get('name');
        const isDownload = params.get('dl') === '1';
        const downloadName = name ? `${name}.mp4` : undefined;
        proxyToResponse({
            req,
            res,
            requestId,
            setResponseTime,
            target,
            host,
            isDownload,
            downloadName,
            allowM3u8Rewrite: true
        });
        return;
    }

    if (urlPath === '/' || urlPath === '') {
        fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, content) => {
            if (err) {
                res.statusCode = 500;
                setResponseTime();
                res.end('Server Error: public/index.html not found');
                return;
            }
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
            setResponseTime();
            res.end(content);
        });
        return;
    }

    if (urlPath.startsWith('/assets/')) {
        const filePath = path.join(__dirname, 'public', urlPath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.statusCode = 404;
                    res.end('Not Found');
                } else {
                    res.statusCode = 500;
                    res.end('Server Error');
                }
                setResponseTime();
                return;
            }
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            setResponseTime();
            res.end(content);
        });
        return;
    }

    const handler = async () => {
        try {
            const liveMatch = urlPath.match(/^\/live\/(\d+)$/);
            if (liveMatch) {
                try {
                    const liveInfo = await resolveLive(liveMatch[1], host);
                    res.statusCode = 302;
                    res.setHeader('Location', liveInfo.downloadUrl);
                    setResponseTime();
                    res.end();
                } catch (e) {
                    res.statusCode = 500;
                    setResponseTime();
                    res.end(`Error: ${e.message}`);
                }
                return;
            }

            if (urlPath === '/htmx/any') {
                const text = params.get('text');
                const qn = getQn(params);
                try {
                    if (!text) throw new Error('Missing text');
                    const bvid = await extractBvid(text);
                    if (bvid.startsWith('Live')) {
                        throw new Error('请使用直播入口');
                    }
                    const info = await resolveBili(bvid, qn, host);
                    const downloadUrl = info.downloadUrl;
                    const template = loadResultTemplate();
                    if (!template) throw new Error('模板缺失');
                    const html = renderTemplate(template, {
                        pic: info.pic,
                        title: info.title,
                        bvid: info.bvid,
                        playableUrl: info.playableUrl,
                        downloadUrl
                    });
                    sendHtml(res, setResponseTime, html);
                } catch (e) {
                    sendHtml(res, setResponseTime, buildErrorHtml(e.message));
                }
                return;
            }

            if (urlPath === '/api/live') {
                const room = params.get('room');
                if (!room) throw new Error('Missing room');
                const roomId = parseRoomId(room);
                if (!roomId) {
                    sendApiError(res, setResponseTime, '无效的房间号', true);
                    return;
                }
                try {
                    const info = await resolveLive(roomId, host);
                    sendApiSuccess(res, setResponseTime, info, true);
                } catch (e) {
                    sendApiError(res, setResponseTime, e.message, true);
                }
                return;
            }

            if (urlPath === '/api/any') {
                const text = params.get('text');
                const qn = getQn(params);
                if (!text) throw new Error('Missing text');
                const bvid = await extractBvid(text);
                if (bvid.startsWith('Live')) {
                    const roomId = bvid.replace('Live', '');
                    const info = await resolveLive(roomId, host);
                    sendApiSuccess(res, setResponseTime, info, true);
                    return;
                }
                const info = await resolveBili(bvid, qn, host);
                sendApiSuccess(res, setResponseTime, info, true);
            } else {
                const directMatch = urlPath.match(/^\/(BV[a-zA-Z0-9]{10})$/);
                const jsonMatch = urlPath.match(/^\/json\/(BV[a-zA-Z0-9]{10})$/);
                const fullUrlMatch = urlPath.match(/^\/(https?:\/\/.*)$/);
                if (directMatch || jsonMatch) {
                    const bvid = directMatch ? directMatch[1] : jsonMatch[1];
                    const qn = getQn(params);
                    const info = await resolveBili(bvid, qn, host);
                    if (directMatch) {
                        setResponseTime();
                        res.writeHead(302, { Location: info.playableUrl });
                        res.end();
                    } else {
                        sendJson(res, setResponseTime, info);
                    }
                } else if (fullUrlMatch) {
                    const full = decodeURIComponent(fullUrlMatch[1]);
                    const qn = getQn(params);
                    const bvid = await extractBvid(full);
                    const info = await resolveBili(bvid, qn, host);
                    proxyToResponse({
                        req,
                        res,
                        requestId,
                        setResponseTime,
                        target: info.rawUrl,
                        host,
                        isDownload: false,
                        allowM3u8Rewrite: false
                    });
                } else {
                    throw new Error('Not Found');
                }
            }
        } catch (e) {
            const status = e.message === 'Not Found' ? 404 : 500;
            if (!res.headersSent) {
                res.statusCode = status;
                sendJson(res, setResponseTime, { status: 'error', message: e.message || 'Unknown error' });
            }
            log('error', 'request failed', { requestId, message: e.message });
        }
    };

    handler();
}

const server = http.createServer(handleRequest);

if (require.main === module) {
    const PORT = process.env.PORT || 4836;
    server.listen(PORT, () => {
        console.log(`BiliParser 运行中，监听端口：${PORT}`);
        console.log(`====================================`);
    });
}

module.exports = handleRequest;
