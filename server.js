const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 1455);
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const callbacks = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleRequest(req, res, url) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const file = path.join(__dirname, 'index.html');
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      if (!res.headersSent) sendJson(res, 500, { error: 'index_unavailable' });
      else res.end();
    });
    stream.once('open', () => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      stream.pipe(res);
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    const error = url.searchParams.get('error') || '';
    if (state) callbacks.set(state, { code, error, savedAt: Date.now() });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>OAuth 回调</title><style>body{font:16px system-ui;background:#f7f9fc;color:#12233b;display:grid;place-items:center;min-height:100vh;margin:0}.box{background:#fff;border:1px solid #e4eaf2;border-radius:8px;padding:28px;max-width:520px}h1{font-size:22px}code{word-break:break-all;color:#2c67f2}</style><div class="box"><h1>${error ? '授权失败' : '授权回调已收到'}</h1><p>${error ? `错误：<code>${escapeHtml(error)}</code>` : '可以关闭此页面并返回 Session Forge。回调 code 会自动填入。'}</p></div>`);
  }

  if (req.method === 'GET' && url.pathname === '/oauth-status') {
    const state = url.searchParams.get('state') || '';
    return sendJson(res, 200, callbacks.get(state) || { code: '', error: '' });
  }

  if (req.method === 'POST' && url.pathname === '/exchange') {
    const input = JSON.parse(await readBody(req));
    if (!input.code || !input.code_verifier) return sendJson(res, 400, { error: 'missing_code_or_verifier' });
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: input.code,
      code_verifier: input.code_verifier,
      redirect_uri: input.redirect_uri || REDIRECT_URI
    });
    const provider = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body
    });
    const text = await provider.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { error: text || `HTTP ${provider.status}` }; }
    return sendJson(res, provider.status, data);
  }

  return sendJson(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  } catch (_) {
    return sendJson(res, 400, { error: 'bad_request' });
  }
  try {
    await handleRequest(req, res, url);
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: error.message || 'server_error' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Session Forge running at http://localhost:${PORT}/`);
});
