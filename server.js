const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 1455);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const AUTHORIZATION_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_SCOPE = 'openid profile email offline_access';
const MAX_BODY_BYTES = 1024 * 1024;
const CALLBACK_TTL_MS = 10 * 60 * 1000;
const MAX_CALLBACKS = 1000;
const TOKEN_TIMEOUT_MS = 15 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const MAX_PROVIDER_BODY_BYTES = 1024 * 1024;
const STATIC_ASSETS = new Map([
  ['/static/app.css', { file: path.join(__dirname, 'static', 'app.css'), type: 'text/css; charset=utf-8' }],
  ['/static/app.js', { file: path.join(__dirname, 'static', 'app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/static/jwks.js', { file: path.join(__dirname, 'static', 'jwks.js'), type: 'text/javascript; charset=utf-8' }]
]);

const defaultOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
];
let parsedRedirectUri;
try {
  parsedRedirectUri = new URL(REDIRECT_URI);
  if (!['http:', 'https:'].includes(parsedRedirectUri.protocol) || parsedRedirectUri.username || parsedRedirectUri.password || parsedRedirectUri.hash) {
    throw new Error('unsupported redirect URI');
  }
} catch (_) {
  throw new Error('REDIRECT_URI must be an absolute URL');
}
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || defaultOrigins.join(','))
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

const callbacks = new Map();
const exchangeRateLimits = new Map();

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function commonHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
}

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

function sendJson(req, res, status, data, headers = {}) {
  res.writeHead(status, {
    ...commonHeaders(),
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    ...commonHeaders(),
    'Content-Type': 'text/html; charset=utf-8'
  });
  res.end(html);
}

function sendFile(req, res, filename, contentType) {
  const stream = fs.createReadStream(filename);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(req, res, 500, { error: 'asset_unavailable' });
    else res.end();
  });
  stream.once('open', () => {
    res.writeHead(200, {
      ...commonHeaders(),
      'Content-Type': contentType
    });
    stream.pipe(res);
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function sendCallbackPage(res, status, title, message, codeStyle = false) {
  const content = codeStyle
    ? `<code>${escapeHtml(message)}</code>`
    : escapeHtml(message);
  sendHtml(res, status, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/static/app.css"></head><body class="callback-page"><main class="callback-box"><h1>${escapeHtml(title)}</h1><p>${content}</p></main></body></html>`);
}

function readBody(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    req.resume();
    return Promise.reject(new HttpError(413, 'request_body_too_large'));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(413, 'request_body_too_large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = error => fail(error);
    const onAborted = () => fail(new HttpError(400, 'request_aborted'));

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

async function readJsonObject(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'content_type_must_be_json');

  const raw = await readBody(req);
  let value;
  try {
    value = JSON.parse(raw);
  } catch (_) {
    throw new HttpError(400, 'invalid_json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'json_object_required');
  }
  return value;
}

function isValidState(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{32,128}$/.test(value);
}

function cleanupCallbacks(now = Date.now()) {
  for (const [state, entry] of callbacks) {
    if (now - entry.savedAt > CALLBACK_TTL_MS) callbacks.delete(state);
  }
}

function checkExchangeRateLimit(req, now = Date.now()) {
  for (const [key, entry] of exchangeRateLimits) {
    if (now - entry.startedAt >= RATE_LIMIT_WINDOW_MS) exchangeRateLimits.delete(key);
  }
  const key = req.socket.remoteAddress || 'unknown';
  const entry = exchangeRateLimits.get(key);
  if (!entry) {
    exchangeRateLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

async function exchangeToken(input, fetchImpl, timeoutMs) {
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const verifier = typeof input.code_verifier === 'string' ? input.code_verifier.trim() : '';
  if (!code || code.length > 8192 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new HttpError(400, 'invalid_code_or_verifier');
  }
  if (input.redirect_uri && input.redirect_uri !== REDIRECT_URI) {
    throw new HttpError(400, 'invalid_redirect_uri');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const provider = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: controller.signal
    });
    const contentLength = Number(provider.headers?.get?.('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_BODY_BYTES) {
      throw new HttpError(502, 'token_response_too_large');
    }
    let text;
    if (provider.body && typeof provider.body.getReader === 'function') {
      const reader = provider.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_PROVIDER_BODY_BYTES) {
            await reader.cancel('response_size_limit');
            throw new HttpError(502, 'token_response_too_large');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      text = Buffer.concat(chunks).toString('utf8');
    } else {
      text = await provider.text();
      if (Buffer.byteLength(text) > MAX_PROVIDER_BODY_BYTES) throw new HttpError(502, 'token_response_too_large');
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { error: text || `HTTP ${provider.status}` };
    }
    return { status: provider.status, data };
  } catch (error) {
    if (error && error.name === 'AbortError') throw new HttpError(504, 'token_exchange_timeout');
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'token_exchange_unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

async function handleRequest(req, res, url, options) {
  const apiPath = ['/oauth-config', '/oauth-state', '/oauth-status', '/exchange'].includes(url.pathname);
  if (apiPath && !isOriginAllowed(req)) {
    return sendJson(req, res, 403, { error: 'origin_not_allowed' });
  }

  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(req)) return sendJson(req, res, 403, { error: 'origin_not_allowed' });
    res.writeHead(204, { ...commonHeaders(), ...corsHeaders(req) });
    return res.end();
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return sendFile(req, res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && STATIC_ASSETS.has(url.pathname)) {
    const asset = STATIC_ASSETS.get(url.pathname);
    return sendFile(req, res, asset.file, asset.type);
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return sendJson(req, res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(204, commonHeaders());
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    cleanupCallbacks();
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error') || '';
    if (!isValidState(state)) {
      return sendCallbackPage(res, 400, '授权状态无效', 'OAuth state 缺失或格式错误。');
    }
    const entry = callbacks.get(state);
    if (!entry || entry.status !== 'pending') {
      return sendCallbackPage(res, 400, '授权状态已过期', '请返回 Session Forge 重新生成登录链接。');
    }
    entry.code = code;
    entry.error = oauthError || (!code ? 'missing_authorization_code' : '');
    entry.status = 'complete';
    entry.savedAt = Date.now();
    if (entry.error) return sendCallbackPage(res, 200, '授权失败', entry.error, true);
    return sendCallbackPage(res, 200, '授权回调已收到', '可以关闭此页面并返回 Session Forge。回调 code 会自动填入。');
  }

  if (req.method === 'GET' && url.pathname === '/oauth-config') {
    return sendJson(req, res, 200, {
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scope: OAUTH_SCOPE,
      authorizationUrl: AUTHORIZATION_URL,
      stateTtlMs: CALLBACK_TTL_MS
    });
  }

  if (req.method === 'POST' && url.pathname === '/oauth-state') {
    cleanupCallbacks();
    const input = await readJsonObject(req);
    if (!isValidState(input.state)) throw new HttpError(400, 'invalid_state');
    if (callbacks.has(input.state)) throw new HttpError(409, 'state_already_registered');
    if (callbacks.size >= MAX_CALLBACKS) throw new HttpError(503, 'oauth_state_store_full');
    callbacks.set(input.state, { status: 'pending', code: '', error: '', savedAt: Date.now() });
    return sendJson(req, res, 201, { ok: true, expiresIn: Math.floor(CALLBACK_TTL_MS / 1000) });
  }

  if (req.method === 'GET' && url.pathname === '/oauth-status') {
    cleanupCallbacks();
    const state = url.searchParams.get('state') || '';
    if (!isValidState(state)) return sendJson(req, res, 400, { error: 'invalid_state' });
    const entry = callbacks.get(state);
    if (!entry) return sendJson(req, res, 404, { error: 'unknown_or_expired_state' });
    if (entry.status === 'pending') return sendJson(req, res, 200, { code: '', error: '' });
    callbacks.delete(state);
    return sendJson(req, res, 200, { code: entry.code, error: entry.error });
  }

  if (req.method === 'POST' && url.pathname === '/exchange') {
    if (!checkExchangeRateLimit(req)) {
      return sendJson(req, res, 429, { error: 'rate_limit_exceeded' }, { 'Retry-After': '60' });
    }
    const input = await readJsonObject(req);
    const result = await exchangeToken(input, options.fetchImpl, options.tokenTimeoutMs);
    return sendJson(req, res, result.status, result.data);
  }

  return sendJson(req, res, 404, { error: 'not_found' });
}

function createServer(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const tokenTimeoutMs = options.tokenTimeoutMs ?? TOKEN_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!Number.isFinite(tokenTimeoutMs) || tokenTimeoutMs <= 0) throw new Error('tokenTimeoutMs must be a positive number');

  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (_) {
      return sendJson(req, res, 400, { error: 'bad_request' });
    }
    try {
      await handleRequest(req, res, url, { fetchImpl, tokenTimeoutMs });
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof HttpError) {
        return sendJson(req, res, error.status, { error: error.code });
      }
      console.error('Unhandled request error:', error);
      return sendJson(req, res, 500, { error: 'server_error' });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`Session Forge running at http://${displayHost}:${PORT}/`);
  });
}

module.exports = {
  CALLBACK_TTL_MS,
  CLIENT_ID,
  REDIRECT_URI,
  callbacks,
  createServer,
  exchangeRateLimits
};
