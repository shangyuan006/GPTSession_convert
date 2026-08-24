const samples = {
  session: '{\n  "type": "codex",\n  "access_token": "demo-openai-access",\n  "refresh_token": "demo-openai-refresh",\n  "id_token": "demo-openai-id",\n  "email": "demo@example.com",\n  "account_id": "acct_demo"\n}',
  cpa: '{\n  "api_key": "sk-demo-session-key",\n  "model": "gpt-4o-mini",\n  "base_url": "https://api.openai.com/v1",\n  "note": "demo account"\n}',
  sub2cpa: '{\n  "exported_at": "2026-07-18T08:00:00.000Z",\n  "proxies": [],\n  "accounts": [{\n    "name": "demo-account",\n    "platform": "codex",\n    "type": "oauth",\n    "concurrency": 10,\n    "priority": 1,\n    "credentials": {\n      "access_token": "eyJhbGciOi...demo-access",\n      "id_token": "eyJhbGciOi...demo-id",\n      "refresh_token": "demo-refresh-token",\n      "email": "demo@example.com"\n    },\n    "extra": { "email": "demo@example.com" }\n  }]\n}',
  codex: '{\n  "id": "codex-demo",\n  "access_token": "sk-codex-demo",\n  "email": "demo@example.com",\n  "base_url": "https://api.openai.com/v1"\n}',
  axonhub: '{\n  "name": "axon-demo",\n  "token": "sk-axon-demo",\n  "endpoint": "https://api.openai.com/v1",\n  "model": "gpt-4o"\n}',
  router9: '{\n  "key": "sk-router-demo",\n  "url": "https://9router.com/v1",\n  "model": "gpt-4o-mini"\n}',
  cockpit: '{\n  "provider": "openai",\n  "apiKey": "sk-cockpit-demo",\n  "baseURL": "https://api.openai.com/v1",\n  "defaultModel": "gpt-4o"\n}',
};
const state = { mode: 'session', result: null, history: [], batchOutputs: [], batchAccounts: [], verifications: [] };
const MAX_INPUT_FILE_BYTES_V2 = 50 * 1024 * 1024;
const MAX_SELECTED_BYTES_V2 = 100 * 1024 * 1024;
const MAX_INPUT_FILES_V2 = 100;
const MAX_IMPORTED_RECORDS_V2 = 10000;
const MAX_ZIP_ENTRY_BYTES_V2 = 20 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES_V2 = 50 * 1024 * 1024;
const $ = id => document.getElementById(id);
function showToast(message) { const t = $('toast'); t.textContent = message; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove('show'), 2200); }
async function copyText(value) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try { await navigator.clipboard.writeText(value); return; } catch (_) {}
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(input);
  input.select();
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('clipboard_unavailable');
}
async function copyWithToast(value, successMessage) {
  try { await copyText(value); showToast(successMessage); }
  catch (_) { showToast('复制失败，请手动选择文本复制'); }
}
function clean(obj) { if (Array.isArray(obj)) return obj.map(clean); if (!obj || typeof obj !== 'object') return obj; const out = {}; Object.entries(obj).forEach(([k,v]) => { const nv = clean(v); if (!$('stripCheck').checked || (nv !== null && nv !== '')) out[k] = nv; }); return out; }
function first(obj, keys, fallback = '') { for (const key of keys) { const parts = key.split('.'); let value = obj; for (const part of parts) value = value && value[part]; if (value !== undefined && value !== null && value !== '') return value; } return fallback; }
function scalar(value, fallback = '') { return ['string', 'number', 'boolean'].includes(typeof value) ? value : fallback; }
const formatNames = { session: 'OpenAI / Grok OAuth', cpa: 'CPA', sub2api: 'Sub2API', codexmanager: 'Codex-Manager', codex: 'Codex CLI', codex2api: 'Codex2API', grok: 'Grok CLI', grok2api: 'Grok2API', axonhub: 'AxonHub', router9: '9router', cockpit: 'Cockpit' };
const formatProviders = { cpa: ['openai','xai'], sub2api: ['openai','xai'], codexmanager: ['openai'], codex: ['openai'], codex2api: ['openai'], grok: ['xai'], grok2api: ['xai'], axonhub: ['openai','xai'], router9: ['openai','xai'], cockpit: ['openai','xai'] };
function invalidateResultV2({ status = 'IDLE', resetVerification = true } = {}) {
  state.result = null;
  state.batchOutputs = [];
  state.batchAccounts = [];
  state.verifications = [];
  $('outputBox').innerHTML = '<div class="output-empty"><strong>等待转换</strong>结果会显示在这里</div>';
  $('lineCount').textContent = '—';
  $('byteCount').textContent = '—';
  $('statusText').textContent = status;
  if (resetVerification && typeof resetVerificationV2 === 'function') resetVerificationV2();
}
function storeResultStateV2(result, outputs = [], accounts = []) {
  state.result = result;
  state.batchOutputs = outputs;
  state.batchAccounts = accounts;
  state.verifications = [];
}
function setRoute(source, target) {
  $('inputText').value = '';
  const nextTarget = refreshTargetOptions(source, target);
  state.source = source;
  state.target = nextTarget;
  state.mode = source === 'sub2api' ? 'sub2cpa' : source;
  $('sourceFormat').value = source;
  $('inputTitle').textContent = source === 'session' ? '粘贴 OpenAI / Grok OAuth JSON / JSONL' : '粘贴 ' + formatNames[source] + ' 内容';
  $('inputMeta').textContent = source === 'session' ? 'INPUT / OAUTH JSON' : 'INPUT / ' + source.toUpperCase();
  $('outputTitle').textContent = formatNames[nextTarget] + ' 配置';
  invalidateResultV2();
}
function setMode(mode) { const presets = { session: ['session','cpa'], cpa: ['cpa','sub2api'], sub2cpa: ['sub2api','cpa'], codexmanager: ['codexmanager','cpa'], codex: ['codex','cpa'], codex2api: ['codex2api','cpa'], grok: ['grok','grok2api'], grok2api: ['grok2api','grok'], axonhub: ['axonhub','cpa'], router9: ['router9','cpa'], cockpit: ['cockpit','cpa'] }; const pair = presets[mode] || ['session','cpa']; document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode)); setRoute(pair[0], pair[1]); }
function addHistory(text) { state.history.unshift({ source: state.source, target: state.target, bytes: new Blob([text]).size, time: new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) }); state.history = state.history.slice(0,4); $('historyList').innerHTML = state.history.map((h,i) => `<div class="history-row"><div class="history-main"><div class="file-icon">JS</div><div><div class="history-name">转换结果 ${String(state.history.length-i).padStart(2,'0')}.json</div><div class="history-detail">${h.bytes} bytes · 本地生成</div></div></div><div class="history-mode">${formatNames[h.source]} → ${formatNames[h.target]}</div><div class="history-time">今天 ${h.time}</div><div class="status">DONE</div></div>`).join(''); }
function jwtPayload(token) { try { const part = String(token || '').split('.')[1]; if (!part) return {}; const padded = part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'='); return JSON.parse(atob(padded)); } catch (_) { return {}; } }
function parseInput(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('请输入内容后再转换');
  try { return JSON.parse(text); } catch (_) {}

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    try { return lines.map(line => JSON.parse(line)); }
    catch (_) {
      if (lines.some(line => /^[\[{]/.test(line))) throw new Error('JSONL 格式错误，请检查失败行');
    }
  }
  if (/^[\[{]/.test(text)) throw new Error('JSON 格式错误，请检查括号、引号和逗号');

  if (text.includes('=')) {
    const pairs = text.split(/[\n,;]+/).map(pair => pair.trim()).filter(Boolean);
    if (pairs.some(pair => pair.indexOf('=') <= 0)) throw new Error('键值格式错误，应使用 key=value');
    const out = {};
    for (const pair of pairs) {
      const index = pair.indexOf('=');
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!key || !value) throw new Error('键值格式错误，不允许空键或空值');
      out[key] = value;
    }
    return out;
  }
  if (/\s/.test(text)) throw new Error('无法识别输入格式；裸 token 不能包含空白字符');
  return { token: text };
}
function renderTarget(c, target) {
  const xai = c.provider === 'xai';
  if (target === 'cpa') return clean(xai ? { type:'xai', access_token:c.access_token, refresh_token:c.refresh_token, id_token:c.id_token, token_type:c.token_type, expires_in:c.expires_in, expired:c.expired, last_refresh:c.last_refresh, email:c.email, sub:c.user_id || c.principal_id, base_url:c.base_url, token_endpoint:c.token_endpoint, redirect_uri:c.redirect_uri } : { type:'codex', email:c.email, account_id:c.account_id || '', plan_type:c.plan_type || '', id_token:c.id_token || '', access_token:c.access_token || '', refresh_token:c.refresh_token || '', session_token:c.session_token, expired:c.expired || '', last_refresh:c.last_refresh || new Date().toISOString(), disabled:false });
  if (target === 'sub2api') return { type:'sub2api-data', version:1, exported_at:new Date().toISOString(), proxies:[], accounts:[{ name:c.name || c.email || c.account_id || c.user_id || 'authconv-account', platform:xai?'grok':'openai', type:'oauth', credentials:clean({access_token:c.access_token,refresh_token:c.refresh_token,session_token:xai?undefined:c.session_token,id_token:c.id_token,expires_at:c.expired,email:c.email,chatgpt_account_id:xai?undefined:c.account_id,chatgpt_user_id:xai?undefined:c.user_id,plan_type:xai?undefined:c.plan_type,user_id:xai?c.user_id:undefined,client_id:xai?c.client_id:undefined,base_url:xai?c.base_url:undefined}), extra:{import_source:'authconv'}, priority:50, concurrency:3, auto_pause_on_expired:true}] };
  if (target === 'codexmanager') return clean({tokens:{access_token:c.access_token,refresh_token:c.refresh_token,id_token:c.id_token,account_id:c.account_id,chatgpt_account_id:c.account_id},meta:{label:c.name || c.email || c.account_id,issuer:c.issuer || 'https://auth.openai.com',workspace_id:c.workspace_id,chatgpt_account_id:c.account_id,tags:['authconv']}});
  if (target === 'codex2api') return [clean({name:c.name || c.email || c.account_id,email:c.email,refresh_token:c.refresh_token,session_token:c.session_token,access_token:c.access_token,id_token:c.id_token,account_id:c.account_id,chatgpt_account_id:c.account_id,plan_type:c.plan_type,expires_at:c.expired})];
  if (target === 'codex') return {auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{id_token:c.id_token || '',access_token:c.access_token || '',refresh_token:c.refresh_token || '',account_id:c.account_id || ''},last_refresh:c.last_refresh || new Date().toISOString()};
  if (target === 'grok' || target === 'grok2api') {
    const key = `${c.issuer || 'https://auth.x.ai'}::${c.user_id || c.principal_id || c.client_id || 'authconv-account'}`;
    return {[key]:clean({key:c.access_token,auth_mode:'oidc',create_time:c.last_refresh,user_id:c.user_id || c.principal_id,email:c.email,principal_type:c.principal_type || 'User',principal_id:c.principal_id || c.user_id,refresh_token:c.refresh_token,expires_at:c.expired,oidc_issuer:c.issuer || 'https://auth.x.ai',oidc_client_id:c.client_id || 'b1a00492-073a-47ea-816f-4c329264a828'})};
  }
  if (target === 'axonhub') return clean({provider:xai?'xai':'openai',name:c.name || c.email || 'converted-account',email:c.email,access_token:c.access_token,refresh_token:c.refresh_token,base_url:c.base_url,model:c.model || (xai ? undefined : 'gpt-4o')});
  if (target === 'router9') return clean({accessToken:c.access_token,refreshToken:c.refresh_token,expiresAt:c.expired,testStatus:'active',providerSpecificData:{chatgptAccountId:c.account_id,chatgptPlanType:c.plan_type},id:c.account_id || c.user_id,provider:xai?'grok':'codex',authType:'oauth',name:c.name || c.email,email:c.email,priority:9,isActive:true,createdAt:c.last_refresh,updatedAt:c.last_refresh});
  if (target === 'cockpit') return clean({type:xai?'xai':'codex',email:c.email,name:c.name || c.email,account_id:c.account_id,plan_type:c.plan_type,id_token:c.id_token,access_token:c.access_token,refresh_token:c.refresh_token,session_token:c.session_token,last_refresh:c.last_refresh,expired:c.expired});
  return clean(c);
}
Object.assign(samples, { codexmanager:'{"tokens":{"access_token":"demo-access","refresh_token":"demo-refresh","id_token":"demo-id","account_id":"acct_demo"},"meta":{"label":"demo@example.com","issuer":"https://auth.openai.com","tags":["authconv"]}}', codex:'{"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{"id_token":"demo-id","access_token":"demo-access","refresh_token":"demo-refresh","account_id":"acct_demo"},"last_refresh":"2026-07-19T00:00:00.000Z"}', codex2api:'[{"name":"demo@example.com","email":"demo@example.com","access_token":"demo-access","refresh_token":"demo-refresh","id_token":"demo-id","account_id":"acct_demo"}]', grok:'{"https://auth.x.ai::demo-user":{"key":"demo-xai-access","auth_mode":"oidc","user_id":"demo-user","email":"demo@example.com","principal_type":"User","principal_id":"demo-user","refresh_token":"demo-xai-refresh","oidc_issuer":"https://auth.x.ai","oidc_client_id":"b1a00492-073a-47ea-816f-4c329264a828"}}', grok2api:'{"https://auth.x.ai::demo-user":{"key":"demo-xai-access","auth_mode":"oidc","user_id":"demo-user","email":"demo@example.com","principal_type":"User","principal_id":"demo-user","refresh_token":"demo-xai-refresh","oidc_issuer":"https://auth.x.ai","oidc_client_id":"b1a00492-073a-47ea-816f-4c329264a828"}}' });
// Conversion and download handlers are attached by the phase-two pipeline below.
$('sampleBtn').addEventListener('click', () => { $('inputText').value = samples[state.mode]; invalidateResultV2(); refreshTargetFromInputV2(); showToast('已载入示例数据'); });
$('clearBtn').addEventListener('click', () => { $('inputText').value = ''; invalidateResultV2(); refreshTargetFromInputV2(); showToast('输入已清空'); });
$('copyBtn').addEventListener('click', () => { if (!state.result) return showToast('暂无可复制的结果'); copyWithToast(state.result, '已复制到剪贴板'); });
$('clearHistoryBtn').addEventListener('click', () => { state.history = []; $('historyList').innerHTML = '<div class="history-row"><div class="history-main"><div class="file-icon">JS</div><div><div class="history-name">等待第一次转换</div><div class="history-detail">本地记录会出现在这里</div></div></div><div class="history-mode">—</div><div class="history-time">—</div><div class="status">READY</div></div>'; showToast('记录已清除'); });
document.querySelectorAll('.mode-tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
document.querySelectorAll('[data-nav]').forEach(n => n.addEventListener('click', () => { document.querySelectorAll('[data-nav]').forEach(x => x.classList.remove('active')); n.classList.add('active'); const nav = n.dataset.nav; showView(nav === 'oauth' ? 'oauth' : 'convert'); if (nav === 'history') $('historyList').scrollIntoView({behavior:'smooth'}); else if (nav === 'validate') showToast('校验功能已集成在转换流程中'); }));
$('themeBtn').addEventListener('click', () => { document.body.classList.toggle('dark'); showToast('显示模式已切换'); });
function showView(view) { $('convertView').hidden = false; $('oauthView').hidden = false; document.querySelector('.mode-tabs').hidden = false; (view === 'oauth' ? $('oauthView') : $('convertView')).scrollIntoView({behavior:'smooth', block:'start'}); }
const oauthServer = location.protocol === 'file:' ? 'http://localhost:1455' : location.origin;
const oauthConfig = { clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', redirectUri: 'http://localhost:1455/auth/callback', scope: 'openid profile email offline_access', authorizationUrl: 'https://auth.openai.com/oauth/authorize', stateTtlMs: 600000 };
const oauthState = { verifier: '', challenge: '', state: '', nonce: '', link: '', pollTimer: null, pollGeneration: 0 };
const oauthConfigReady = (async () => {
  try {
    const response = await fetch(`${oauthServer}/oauth-config`);
    if (!response.ok) return oauthConfig;
    const config = await response.json();
    if (config && typeof config === 'object') Object.assign(oauthConfig, config);
  } catch (_) {}
  return oauthConfig;
})();
function randomString(length = 64) {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || typeof webCrypto.getRandomValues !== 'function') throw new Error('浏览器不支持安全随机数');
  const bytes = new Uint8Array(length);
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[byte % 66]).join('');
}
async function sha256Base64Url(input) {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || !webCrypto.subtle) throw new Error('浏览器不支持 WebCrypto');
  const data = new TextEncoder().encode(input);
  const digest = await webCrypto.subtle.digest('SHA-256', data);
  let binary = '';
  new Uint8Array(digest).forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function extractOauthCode(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return text;
  const url = new URL(text);
  const returnedState = url.searchParams.get('state') || '';
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error') || '';
  if (oauthError) throw new Error(oauthError);
  if (returnedState && oauthState.state && returnedState !== oauthState.state) throw new Error('OAuth state 不匹配');
  return url.searchParams.get('code') || '';
}
function persistOauth() {
  try {
    sessionStorage.setItem('session-forge.oauth', JSON.stringify({ verifier: oauthState.verifier, challenge: oauthState.challenge, state: oauthState.state, nonce: oauthState.nonce, link: oauthState.link }));
  } catch (_) {}
}
function clearPersistedOauth() {
  try { sessionStorage.removeItem('session-forge.oauth'); } catch (_) {}
}
function stopCallbackPolling() {
  clearTimeout(oauthState.pollTimer);
  oauthState.pollTimer = null;
  oauthState.pollGeneration += 1;
}
async function registerOauthState() {
  const response = await fetch(`${oauthServer}/oauth-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: oauthState.state })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
}
function startCallbackPolling() {
  stopCallbackPolling();
  const generation = oauthState.pollGeneration;
  const deadline = Date.now() + Number(oauthConfig.stateTtlMs || 600000);
  const poll = async () => {
    if (!oauthState.state || generation !== oauthState.pollGeneration) return;
    if (Date.now() >= deadline) {
      stopCallbackPolling();
      clearPersistedOauth();
      $('oauthOutput').textContent = 'OAuth 登录已超时，请重新生成登录链接。';
      return showToast('OAuth 登录已超时');
    }
    try {
      const response = await fetch(`${oauthServer}/oauth-status?state=${encodeURIComponent(oauthState.state)}`);
      const data = await response.json().catch(() => ({}));
      if (response.status === 404 || response.status === 410) {
        stopCallbackPolling();
        clearPersistedOauth();
        $('oauthOutput').textContent = 'OAuth 状态已过期，请重新生成登录链接。';
        return showToast('OAuth 状态已过期');
      }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (data.error) {
        stopCallbackPolling();
        clearPersistedOauth();
        $('oauthOutput').textContent = JSON.stringify({ error: data.error }, null, 2);
        return showToast('OAuth 授权失败');
      }
      if (data.code) {
        $('oauthCode').value = data.code;
        stopCallbackPolling();
        showToast('已自动收到 OAuth 回调');
        $('oauthOutput').textContent = '回调已收到，点击“生成（含 refresh_token）”继续。';
        return;
      }
    } catch (_) {}
    if (generation === oauthState.pollGeneration) oauthState.pollTimer = setTimeout(poll, 1200);
  };
  poll();
}
$('oauthUrlBtn').addEventListener('click', async () => {
  const button = $('oauthUrlBtn');
  button.disabled = true;
  try {
    await oauthConfigReady;
    oauthState.verifier = randomString(96);
    oauthState.challenge = await sha256Base64Url(oauthState.verifier);
    oauthState.state = randomString(48);
    oauthState.nonce = randomString(48);
    const url = new URL(oauthConfig.authorizationUrl);
    url.search = new URLSearchParams({ client_id: oauthConfig.clientId, redirect_uri: oauthConfig.redirectUri, response_type: 'code', scope: oauthConfig.scope, code_challenge: oauthState.challenge, code_challenge_method: 'S256', state: oauthState.state, nonce: oauthState.nonce }).toString();
    oauthState.link = url.toString();
    await registerOauthState();
    $('oauthLink').value = oauthState.link;
    persistOauth();
    startCallbackPolling();
    showToast('OAuth 登录链接已生成');
  } catch (error) {
    oauthState.link = '';
    $('oauthLink').value = '';
    $('oauthOutput').textContent = JSON.stringify({ error: error.message, hint: `请确认 ${oauthServer} 正在运行` }, null, 2);
    showToast('OAuth 登录链接生成失败');
  } finally {
    button.disabled = false;
  }
});
$('oauthOpenBtn').addEventListener('click', () => { if (!oauthState.link) return showToast('请先生成 OAuth 登录链接'); const popup = window.open(oauthState.link, '_blank', 'noopener,noreferrer'); if (!popup) showToast('登录页被浏览器拦截，请复制链接打开'); else showToast('登录页已打开'); });
$('oauthExchangeBtn').addEventListener('click', async () => {
  const button = $('oauthExchangeBtn');
  button.disabled = true;
  try {
    const code = extractOauthCode($('oauthCode').value);
    if (!code) throw new Error('请先完成登录或粘贴回调 URL');
    if (!oauthState.verifier) throw new Error('请先生成本次 OAuth 登录链接');
    $('oauthOutput').textContent = '正在兑换 token…';
    const response = await fetch(`${oauthServer}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: oauthState.verifier })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.error || data.message || `HTTP ${response.status}`);
    if (data.id_token && oauthState.nonce && jwtPayload(data.id_token).nonce !== oauthState.nonce) throw new Error('OAuth nonce 校验失败');
    const account = canonicalize(data, 'session');
    if (!hasCredentialV2(account)) throw new Error('OAuth 响应缺少可用凭据字段');
    const formatted = renderTarget(account, state.target);
    const result = JSON.stringify(formatted, null, 2);
    $('oauthOutput').textContent = result;
    storeResultStateV2(result, [formatted], [account]);
    clearPersistedOauth();
    stopCallbackPolling();
    oauthState.verifier = '';
    oauthState.challenge = '';
    oauthState.state = '';
    oauthState.nonce = '';
    showToast(data.refresh_token ? `已生成含 refresh_token 的 ${formatNames[state.target]} 配置` : '兑换成功，但结果不含 refresh_token');
  } catch (error) {
    $('oauthOutput').textContent = JSON.stringify({ error: error.message, hint: `请确认 ${oauthServer} 正在运行并重试` }, null, 2);
    showToast('OAuth 兑换失败');
  } finally {
    button.disabled = false;
  }
});
$('oauthCopyBtn').addEventListener('click', () => { const value = $('oauthOutput').textContent.trim(); if (!value) return showToast('暂无可复制结果'); copyWithToast(value, 'OAuth 结果已复制'); });
$('fileBtn').addEventListener('click', () => $('fileInput').click());
$('folderBtn').addEventListener('click', () => $('folderInput').click());
$('fileInput').addEventListener('change', e => loadJsonFiles(e.target.files));
$('folderInput').addEventListener('change', e => loadJsonFiles(e.target.files));
const dz = $('dropZone'); dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); }); dz.addEventListener('dragleave', () => dz.classList.remove('drag')); dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); loadJsonFiles(e.dataTransfer.files); });
try { const saved = JSON.parse(sessionStorage.getItem('session-forge.oauth') || 'null'); if (saved) { Object.assign(oauthState, saved); $('oauthLink').value = oauthState.link || ''; if (oauthState.state) startCallbackPolling(); } } catch (_) {}

const jwksSnapshotV2 = globalThis.SESSION_FORGE_JWKS;
if (!jwksSnapshotV2) throw new Error('JWKS snapshot failed to load');
const jwksSnapshotsV2 = { openai: jwksSnapshotV2.openai, xai: jwksSnapshotV2.xai };
const JWKS_SNAPSHOT_DATE_V2 = jwksSnapshotV2.date;
const tokenContractsV2 = {
  openai: { issuer: 'https://auth.openai.com', algorithm: 'RS256', audience: 'https://api.openai.com/v1', jwks: jwksSnapshotsV2.openai },
  xai: { issuer: 'https://auth.x.ai', algorithm: 'ES256', tokenType: 'at+jwt', jwks: jwksSnapshotsV2.xai }
};
const credentialFieldsV2 = ['access_token', 'refresh_token', 'session_token', 'id_token'];
const verificationLabelsV2 = {
  signature_valid: '签名有效',
  malformed_jwt: 'JWT 结构错误',
  algorithm_rejected: '算法不允许',
  signature_failed: '签名无效',
  issuer_mismatch: '发行方不匹配',
  audience_mismatch: '受众不匹配',
  token_type_mismatch: 'Token 类型不匹配',
  missing_access_token: '缺少 access_token',
  opaque_access_token: '非 JWT Token',
  unknown_kid: '快照中无匹配密钥',
  unknown_provider: '未知 Token 提供方',
  token_expired: 'Token 已过期',
  token_not_active: 'Token 尚未生效',
  user_disabled: '验签已关闭',
  webcrypto_unavailable: '浏览器不支持 WebCrypto'
};
let crcTableV2;

function base64urlBytesV2(value) {
  if (value.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid base64url');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function parseSignedJwtV2(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const header = JSON.parse(decoder.decode(base64urlBytesV2(parts[0])));
    const payload = JSON.parse(decoder.decode(base64urlBytesV2(parts[1])));
    if (!header || typeof header !== 'object' || Array.isArray(header) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return { header, payload, signingInput: parts[0] + '.' + parts[1], signature: base64urlBytesV2(parts[2]) };
  } catch (_) {
    return null;
  }
}

function verificationResultV2(status, reason, details) {
  return Object.assign({ status, reason, tokenField: 'access_token' }, details || {});
}

function verificationBlocksExportV2(verification) {
  if (['forged', 'expired', 'not_yet_valid'].includes(verification.status)) return true;
  return ['unknown_kid', 'unknown_provider', 'webcrypto_unavailable'].includes(verification.reason);
}

async function verifyCanonicalV2(account, enabled) {
  if (!enabled) return verificationResultV2('unchecked', 'user_disabled');
  const provider = account.provider;
  const token = account.access_token;
  if (!token) return verificationResultV2('unverifiable', 'missing_access_token');
  if (String(token).split('.').length !== 3) return verificationResultV2('unverifiable', 'opaque_access_token');
  const parsed = parseSignedJwtV2(token);
  if (!parsed) return verificationResultV2('forged', 'malformed_jwt');
  const contract = tokenContractsV2[provider];
  if (!contract) return verificationResultV2('unverifiable', 'unknown_provider');
  const algorithm = typeof parsed.header.alg === 'string' ? parsed.header.alg : '';
  const kid = typeof parsed.header.kid === 'string' ? parsed.header.kid : '';
  if (algorithm !== contract.algorithm) return verificationResultV2('forged', 'algorithm_rejected', { algorithm, kid });
  if (contract.tokenType && parsed.header.typ !== contract.tokenType) return verificationResultV2('forged', 'token_type_mismatch', { algorithm, kid });
  const jwk = contract.jwks.keys.find(key => key.kid === kid && key.alg === algorithm && (!key.use || key.use === 'sig'));
  if (!kid || !jwk) return verificationResultV2('unverifiable', 'unknown_kid', { algorithm, kid });
  const webCrypto = globalThis.crypto;
  if (!webCrypto || !webCrypto.subtle || !webCrypto.subtle.importKey || !webCrypto.subtle.verify) return verificationResultV2('unverifiable', 'webcrypto_unavailable', { algorithm, kid });
  try {
    const importAlgorithm = algorithm === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };
    const verifyAlgorithm = algorithm === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : { name: 'ECDSA', hash: 'SHA-256' };
    const key = await webCrypto.subtle.importKey('jwk', jwk, importAlgorithm, false, ['verify']);
    const valid = await webCrypto.subtle.verify(verifyAlgorithm, key, parsed.signature, new TextEncoder().encode(parsed.signingInput));
    if (!valid) return verificationResultV2('forged', 'signature_failed', { algorithm, kid });
  } catch (_) {
    return verificationResultV2('unverifiable', 'webcrypto_unavailable', { algorithm, kid });
  }
  if (parsed.payload.iss !== contract.issuer) return verificationResultV2('forged', 'issuer_mismatch', { algorithm, kid });
  const audience = parsed.payload.aud;
  if (contract.audience && audience !== contract.audience && !(Array.isArray(audience) && audience.includes(contract.audience))) {
    return verificationResultV2('forged', 'audience_mismatch', { algorithm, kid });
  }
  const nowSeconds = Date.now() / 1000;
  const clockSkewSeconds = 60;
  const expiresAt = Number(parsed.payload.exp);
  if (Number.isFinite(expiresAt) && expiresAt < nowSeconds - clockSkewSeconds) {
    return verificationResultV2('expired', 'token_expired', { algorithm, kid, expiresAt });
  }
  const notBefore = Number(parsed.payload.nbf);
  if (Number.isFinite(notBefore) && notBefore > nowSeconds + clockSkewSeconds) {
    return verificationResultV2('not_yet_valid', 'token_not_active', { algorithm, kid, notBefore });
  }
  return verificationResultV2('verified', 'signature_valid', { algorithm, kid, expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined });
}

function hasCredentialV2(value) {
  return credentialFieldsV2.some(field => Boolean(value && value[field]));
}

function accountsCompatibleV2(left, right) {
  if (left.provider !== right.provider) return false;
  let shared = false;
  for (const field of credentialFieldsV2) {
    const a = left[field];
    const b = right[field];
    if (!a || !b) continue;
    if (a !== b) return false;
    shared = true;
  }
  return shared;
}

function mergeMissingV2(target, source) {
  Object.entries(source).forEach(([key, value]) => {
    if ((target[key] === undefined || target[key] === null || target[key] === '') && value !== undefined && value !== null && value !== '') target[key] = value;
  });
  return target;
}

function dedupeCanonicalV2(accounts) {
  const unique = [];
  let merged = 0;
  for (const account of accounts) {
    const match = hasCredentialV2(account) ? unique.find(existing => accountsCompatibleV2(existing, account)) : null;
    if (match) {
      mergeMissingV2(match, account);
      merged += 1;
    } else {
      unique.push(Object.assign({}, account));
    }
  }
  return { accounts: unique, merged };
}

function hasDirectCredentialV2(value) {
  return Boolean(first(value || {}, ['access_token','accessToken','token','api_key','apiKey','key','refresh_token','refreshToken','session_token','sessionToken','id_token','idToken']));
}

function looksLikeGrokMapV2(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).some(entry => {
    if (!entry || typeof entry !== 'object') return false;
    const issuer = String(first(entry, ['oidc_issuer','issuer','token_endpoint']));
    return first(entry, ['key','access_token','accessToken']) && (
      first(entry, ['auth_mode','principal_id','user_id']) ||
      issuer.includes('auth.x.ai')
    );
  });
}

function expandRecordsV2(value, source) {
  const items = Array.isArray(value) ? value : [value];
  const records = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      records.push(item);
      continue;
    }
    if (source === 'sub2api' && Array.isArray(item.accounts)) {
      records.push(...item.accounts);
      continue;
    }
    if ((source === 'grok' || source === 'grok2api' || looksLikeGrokMapV2(item)) && !hasDirectCredentialV2(item)) {
      const entries = Object.values(item).filter(entry => entry && typeof entry === 'object');
      if (entries.length) {
        records.push(...entries);
        continue;
      }
    }
    records.push(item);
  }
  return records;
}

function canonicalize(value, source) {
  let p = value && typeof value === 'object' ? value : { token: String(value || '') };
  if (source === 'sub2api') {
    const c = p.credentials || {};
    const e = p.extra || {};
    p = Object.assign({}, p, c, { email: e.email || c.email || p.email, type: p.platform || p.type || 'codex', last_refresh: e.last_refresh || p.last_refresh });
  } else if (source === 'codexmanager') {
    p = Object.assign({}, p, p.meta || {}, p.tokens || {});
  } else if (source === 'codex') {
    p = Object.assign({}, p, p.tokens || {});
  } else if (source === 'router9') {
    p = Object.assign({}, p, p.providerSpecificData || {});
  } else if ((source === 'grok' || source === 'grok2api' || looksLikeGrokMapV2(p)) && !hasDirectCredentialV2(p)) {
    const entry = Object.values(p).find(item => item && typeof item === 'object');
    if (entry) p = entry;
  }
  const access = first(p, ['access_token','accessToken','token','api_key','apiKey','key']);
  const claims = jwtPayload(access);
  const auth = claims['https://api.openai.com/auth'] || {};
  const profile = claims['https://api.openai.com/profile'] || {};
  const declared = String(first(p, ['type','platform','provider'], '')).toLowerCase();
  const issuer = first(p, ['issuer','oidc_issuer','iss']) || claims.iss;
  const providerLocation = [issuer, first(p, ['token_endpoint','tokenEndpoint']), first(p, ['base_url','baseURL','endpoint'])]
    .map(value => String(value || '').toLowerCase())
    .join(' ');
  const xai = source === 'grok' || source === 'grok2api' || declared === 'xai' || declared === 'grok' || providerLocation.includes('x.ai');
  const directEmail = first(p, ['email','account.email']);
  const email = scalar(directEmail, typeof p.account === 'string' ? p.account : '') || profile.email || claims.email;
  return {
    provider: xai ? 'xai' : 'openai',
    access_token: access,
    refresh_token: first(p, ['refresh_token','refreshToken']),
    id_token: first(p, ['id_token','idToken']),
    session_token: first(p, ['session_token','sessionToken']),
    user_id: first(p, ['user_id','userId','sub','chatgpt_user_id','chatgptUserId']) || auth.chatgpt_user_id || claims.sub,
    account_id: first(p, ['account_id','accountId','chatgpt_account_id','chatgptAccountId']) || auth.chatgpt_account_id,
    email: scalar(email),
    name: first(p, ['name','label']) || profile.name,
    plan_type: first(p, ['plan_type','planType','chatgpt_plan_type','chatgptPlanType']) || auth.chatgpt_plan_type,
    workspace_id: first(p, ['workspace_id','workspaceId']),
    issuer,
    client_id: first(p, ['client_id','clientId','oidc_client_id']),
    scopes: first(p, ['scope','scopes']),
    base_url: first(p, ['base_url','baseURL','endpoint','url'], xai ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1'),
    model: first(p, ['model','defaultModel','default_model']),
    token_endpoint: first(p, ['token_endpoint','tokenEndpoint']),
    redirect_uri: first(p, ['redirect_uri','redirectUri']),
    token_type: first(p, ['token_type','tokenType']),
    expires_in: first(p, ['expires_in','expiresIn']),
    principal_id: first(p, ['principal_id','principalId']) || first(p, ['user_id','userId','sub']) || claims.sub,
    principal_type: first(p, ['principal_type','principalType'], 'User'),
    expired: first(p, ['expired','expires_at','expiresAt','expiry']) || (claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : ''),
    last_refresh: first(p, ['last_refresh','lastRefresh']) || (claims.iat ? new Date(Number(claims.iat) * 1000).toISOString() : '')
  };
}

function detectProvidersFromInputV2(source) {
  if (source === 'grok' || source === 'grok2api') return ['xai'];
  if (['codexmanager','codex','codex2api'].includes(source)) return ['openai'];
  const raw = String($('inputText').value || '').trim();
  if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) return ['openai','xai'];
  try {
    const parsed = parseInput(raw);
    const providers = new Set(expandRecordsV2(parsed, source).map(item => canonicalize(item, source).provider));
    return providers.size ? Array.from(providers) : ['openai','xai'];
  } catch (_) {
    return ['openai','xai'];
  }
}

function refreshTargetOptions(source, preferred) {
  const target = $('targetFormat');
  const providers = detectProvidersFromInputV2(source);
  const options = Object.entries(formatNames).filter(([key]) =>
    key !== 'session' &&
    key !== source &&
    (!formatProviders[key] || formatProviders[key].some(provider => providers.includes(provider)))
  );
  target.innerHTML = options.map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join('');
  const next = options.some(([key]) => key === preferred) ? preferred : (options[0] && options[0][0]);
  if (next) target.value = next;
  return next || '';
}

function mergeOutputsV2(outputs, target) {
  if (outputs.length === 1) return outputs[0];
  if (target === 'sub2api') return Object.assign({}, outputs[0], { accounts: outputs.flatMap(item => item.accounts || []) });
  if (target === 'codex2api') return outputs.flatMap(item => Array.isArray(item) ? item : [item]);
  if (target === 'grok' || target === 'grok2api') return Object.assign({}, ...outputs);
  return outputs;
}

function escapeHtmlV2(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderVerificationV2(counts, meta) {
  const badges = ['verified','forged','expired','not_yet_valid','unverifiable','unchecked']
    .filter(status => counts[status])
    .map(status => '<span class="verification-badge ' + status + '">' + status.toUpperCase() + ' ' + counts[status] + '</span>')
    .join('');
  const detail = meta.total + ' 条输入 · 合并重复 ' + meta.merged + ' · 拦截 ' + meta.blocked;
  const rows = (meta.accounts || []).map(entry => {
    const account = entry.account || {};
    const verification = entry.verification || { status: 'unchecked', reason: 'user_disabled' };
    const status = ['verified','forged','expired','not_yet_valid','unverifiable','unchecked'].includes(verification.status) ? verification.status : 'unchecked';
    const email = account.email || account.name || '未提供 Email';
    const identityId = account.account_id || account.user_id || account.principal_id || '未提供 ID';
    const platform = account.provider === 'xai' ? 'xAI / Grok' : 'OpenAI';
    const plan = account.plan_type || '未提供套餐';
    const expiry = account.expired || '未提供过期时间';
    const reason = verificationLabelsV2[verification.reason] || verification.reason || '';
    return '<div class="verification-row">' +
      '<div class="verification-cell"><div class="verification-identity" title="' + escapeHtmlV2(email) + '">' + escapeHtmlV2(email) + '</div><div class="verification-id" title="' + escapeHtmlV2(identityId) + '">' + escapeHtmlV2(identityId) + '</div></div>' +
      '<div class="verification-cell"><div class="verification-platform">' + platform + '</div><div class="verification-plan">' + escapeHtmlV2(plan) + '</div></div>' +
      '<div class="verification-cell verification-expiry" title="' + escapeHtmlV2(expiry) + '">' + escapeHtmlV2(expiry) + '</div>' +
      '<div class="verification-cell verification-status"><span class="verification-badge ' + status + '">' + status.toUpperCase() + '</span><span class="verification-reason" title="' + escapeHtmlV2(reason) + '">' + escapeHtmlV2(reason) + '</span></div>' +
    '</div>';
  }).join('');
  const accountTable = rows
    ? '<div class="verification-accounts"><div class="verification-row header"><span>Email / ID</span><span>平台 / 套餐</span><span>过期时间</span><span>验签状态</span></div>' + rows + '</div>'
    : '<div class="verification-accounts"><div class="verification-empty">转换后将在这里显示账号身份与验签状态</div></div>';
  $('verificationBar').innerHTML = '<div class="verification-head"><div class="verification-summary"><strong>离线验签</strong>' + (badges || '<span class="verification-badge">无记录</span>') + '<span>' + detail + '</span></div><div class="verification-source">JWKS SNAPSHOT<br>' + escapeHtmlV2(JWKS_SNAPSHOT_DATE_V2) + '</div></div>' + accountTable;
}

function renderResultV2(result) {
  const pretty = $('prettyCheck').checked;
  const value = result === undefined ? null : result;
  const output = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  $('outputBox').textContent = output;
  $('lineCount').textContent = output.split('\n').length;
  $('byteCount').textContent = new Blob([output]).size;
  $('statusText').textContent = 'DONE';
  state.result = output;
  addHistory(output);
}

async function runConversion() {
  const button = $('convertBtn');
  button.disabled = true;
  invalidateResultV2({ status: 'VERIFY' });
  try {
    const parsed = parseInput($('inputText').value);
    if (!$('normalizeCheck').checked) {
      state.batchOutputs = [parsed];
      state.batchAccounts = [];
      renderResultV2(parsed);
      renderVerificationV2({ unchecked: 1 }, { total: 1, merged: 0, blocked: 0 });
      showToast('转换完成，结果已生成');
      return;
    }
    const records = expandRecordsV2(parsed, state.source);
    if (!records.length) throw new Error('没有找到可转换的账号记录');
    const canonical = records.map(item => canonicalize(item, state.source));
    const missingCredential = canonical.findIndex(account => !hasCredentialV2(account));
    if (missingCredential >= 0) throw new Error('第 ' + (missingCredential + 1) + ' 条记录缺少可用凭据字段');
    const deduped = dedupeCanonicalV2(canonical);
    const enabled = $('verifyCheck').checked;
    const verifications = await Promise.all(deduped.accounts.map(account => verifyCanonicalV2(account, enabled)));
    const counts = { verified: 0, forged: 0, expired: 0, not_yet_valid: 0, unverifiable: 0, unchecked: 0 };
    verifications.forEach(item => { counts[item.status] = (counts[item.status] || 0) + 1; });
    const rejectInvalid = enabled && $('rejectForgedCheck').checked;
    const accepted = deduped.accounts.filter((account, index) => !rejectInvalid || !verificationBlocksExportV2(verifications[index]));
    const blocked = deduped.accounts.length - accepted.length;
    if (!accepted.length) {
      const staleSnapshot = verifications.some(item => item.reason === 'unknown_kid');
      throw new Error(staleSnapshot ? 'JWKS 快照缺少 Token 使用的密钥，请先更新快照' : '所有账号均未通过离线验签，已停止导出');
    }
    if (['grok','grok2api'].includes(state.target) && accepted.some(account => account.provider !== 'xai')) {
      throw new Error('Grok CLI / Grok2API 目标只接受 xAI / Grok OAuth 账号');
    }
    if (['codexmanager','codex','codex2api'].includes(state.target) && accepted.some(account => account.provider !== 'openai')) {
      throw new Error('当前目标格式只接受 OpenAI / ChatGPT 账号');
    }
    const outputs = accepted.map(account => renderTarget(account, state.target));
    state.batchAccounts = accepted;
    state.batchOutputs = outputs;
    state.verifications = verifications;
    renderResultV2(mergeOutputsV2(outputs, state.target));
    renderVerificationV2(counts, {
      total: records.length,
      merged: deduped.merged,
      blocked,
      accounts: deduped.accounts.map((account, index) => ({
        account,
        verification: verifications[index],
        blocked: rejectInvalid && verificationBlocksExportV2(verifications[index])
      }))
    });
    showToast('转换完成：' + accepted.length + ' 个账号，合并 ' + deduped.merged + ' 个重复项' + (blocked ? '，拦截 ' + blocked + ' 个' : ''));
  } catch (error) {
    invalidateResultV2({ status: 'ERROR', resetVerification: false });
    showToast(error.message || String(error));
  } finally {
    button.disabled = false;
  }
}

function crc32V2(bytes) {
  if (!crcTableV2) {
    crcTableV2 = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTableV2[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTableV2[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRawV2(bytes, maxOutputBytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 Deflate ZIP 解压');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOutputBytes) {
        await reader.cancel('decompressed_size_limit');
        throw new Error('ZIP 条目实际解压大小超过限制');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytesV2(chunks);
}

async function unzipEntriesV2(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 22) throw new Error('ZIP 文件不完整');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('未找到 ZIP 中央目录');
  const count = view.getUint16(eocd + 10, true);
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskCount = view.getUint16(eocd + 8, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskCount !== count) throw new Error('暂不支持多卷 ZIP 文件');
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('暂不支持 ZIP64 文件');
  if (count > 1000 || centralOffset + centralSize > bytes.length) throw new Error('ZIP 条目过多或目录已损坏');
  const centralEnd = centralOffset + centralSize;
  const decoder = new TextDecoder('utf-8');
  const entries = [];
  let totalSize = 0;
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP 中央目录条目损坏');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd + extraLength + commentLength > centralEnd) throw new Error('ZIP 文件名或扩展字段已损坏');
    const name = decoder.decode(bytes.subarray(offset + 46, nameEnd)).replace(/\\/g, '/');
    offset = nameEnd + extraLength + commentLength;
    if (!name || name.endsWith('/') || name.split('/').includes('..') || name.startsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (flags & 1) throw new Error(name + ' 是加密 ZIP 条目，无法读取');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error(name + ' 使用 ZIP64，暂不支持');
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES_V2 || totalSize + uncompressedSize > MAX_ZIP_TOTAL_BYTES_V2) throw new Error('ZIP 解压后内容超过 50 MB 限制');
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(name + ' 的本地头损坏');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) throw new Error(name + ' 的数据已截断');
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateRawV2(compressed, Math.min(uncompressedSize, MAX_ZIP_TOTAL_BYTES_V2 - totalSize));
    else throw new Error(name + ' 使用不支持的 ZIP 压缩方法 ' + method);
    if (data.length !== uncompressedSize || crc32V2(data) !== expectedCrc) throw new Error(name + ' 未通过 ZIP 完整性校验');
    totalSize += data.length;
    entries.push({ name, data });
  }
  return entries;
}

function write16V2(view, offset, value) { view.setUint16(offset, value, true); }
function write32V2(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function concatBytesV2(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => { output.set(part, offset); offset += part.length; });
  return output;
}

function zipStoreV2(files) {
  if (files.length > 65535) throw new Error('ZIP 文件数量超过限制');
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.text === 'string' ? encoder.encode(file.text) : file.data;
    const crc = crc32V2(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    write32V2(localView, 0, 0x04034b50);
    write16V2(localView, 4, 20);
    write16V2(localView, 6, 0x0800);
    write16V2(localView, 8, 0);
    write16V2(localView, 10, dosTime);
    write16V2(localView, 12, dosDate);
    write32V2(localView, 14, crc);
    write32V2(localView, 18, data.length);
    write32V2(localView, 22, data.length);
    write16V2(localView, 26, name.length);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32V2(centralView, 0, 0x02014b50);
    write16V2(centralView, 4, 20);
    write16V2(centralView, 6, 20);
    write16V2(centralView, 8, 0x0800);
    write16V2(centralView, 10, 0);
    write16V2(centralView, 12, dosTime);
    write16V2(centralView, 14, dosDate);
    write32V2(centralView, 16, crc);
    write32V2(centralView, 20, data.length);
    write32V2(centralView, 24, data.length);
    write16V2(centralView, 28, name.length);
    write32V2(centralView, 42, localOffset);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32V2(endView, 0, 0x06054b50);
  write16V2(endView, 8, files.length);
  write16V2(endView, 10, files.length);
  write32V2(endView, 12, centralSize);
  write32V2(endView, 16, localOffset);
  return concatBytesV2(locals.concat(centrals, [end]));
}

function safeFilePartV2(value, fallback) {
  const safe = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return safe || fallback;
}

function batchNameV2(account, index) {
  return String(index + 1).padStart(3, '0') + '-' + safeFilePartV2(account && (account.email || account.account_id || account.user_id || account.name), 'account') + '-' + state.target + '.json';
}

function outputLineV2(output) {
  return Array.isArray(output) && output.length === 1 ? output[0] : output;
}

function triggerDownloadV2(blob, name) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function downloadCurrent() {
  if (!state.result) return showToast('暂无可下载的结果');
  const mode = $('exportMode').value;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (mode === 'json') {
    triggerDownloadV2(new Blob([state.result], { type: 'application/json' }), 'session-' + state.source + '-to-' + state.target + '-' + stamp + '.json');
  } else if (mode === 'jsonl') {
    const outputs = state.batchOutputs && state.batchOutputs.length ? state.batchOutputs : [JSON.parse(state.result)];
    const text = outputs.map(item => JSON.stringify(outputLineV2(item))).join('\n') + '\n';
    triggerDownloadV2(new Blob([text], { type: 'application/x-ndjson' }), 'session-' + state.source + '-to-' + state.target + '-' + stamp + '.jsonl');
  } else {
    const outputs = state.batchOutputs && state.batchOutputs.length ? state.batchOutputs : [JSON.parse(state.result)];
    const accounts = state.batchAccounts || [];
    const files = outputs.map((item, index) => ({
      name: batchNameV2(accounts[index], index),
      text: JSON.stringify(outputLineV2(item), null, 2)
    }));
    triggerDownloadV2(new Blob([zipStoreV2(files)], { type: 'application/zip' }), 'session-' + state.source + '-to-' + state.target + '-' + stamp + '.zip');
  }
  showToast(mode.toUpperCase() + ' 文件已开始下载');
}

function parseCredentialTextV2(raw) {
  return parseInput(raw);
}

async function loadJsonFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return showToast('没有选择文件');
  if (files.length > MAX_INPUT_FILES_V2) return showToast('一次最多选择 ' + MAX_INPUT_FILES_V2 + ' 个文件');
  const selectedBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (selectedBytes > MAX_SELECTED_BYTES_V2) return showToast('所选文件总大小不能超过 100 MB');
  const records = [];
  const errors = [];
  let archiveEntries = 0;
  for (const file of files) {
    try {
      if (file.size > MAX_INPUT_FILE_BYTES_V2) throw new Error('文件超过 50 MB');
      const buffer = new Uint8Array(await file.arrayBuffer());
      const isZip = /\.zip$/i.test(file.name) || (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04);
      if (isZip) {
        const entries = await unzipEntriesV2(buffer);
        archiveEntries += entries.length;
        for (const entry of entries) {
          try {
            const parsed = parseCredentialTextV2(new TextDecoder().decode(entry.data));
            const nextRecords = Array.isArray(parsed) ? parsed : [parsed];
            if (records.length + nextRecords.length > MAX_IMPORTED_RECORDS_V2) throw new Error('导入记录超过 ' + MAX_IMPORTED_RECORDS_V2 + ' 条限制');
            records.push(...nextRecords);
          } catch (_) {
            errors.push(file.name + '::' + entry.name);
          }
        }
      } else {
        const parsed = parseCredentialTextV2(new TextDecoder().decode(buffer));
        const nextRecords = Array.isArray(parsed) ? parsed : [parsed];
        if (records.length + nextRecords.length > MAX_IMPORTED_RECORDS_V2) throw new Error('导入记录超过 ' + MAX_IMPORTED_RECORDS_V2 + ' 条限制');
        records.push(...nextRecords);
      }
    } catch (_) {
      errors.push(file.name);
    }
  }
  if (records.length) {
    $('inputText').value = JSON.stringify(records.length === 1 ? records[0] : records, null, 2);
    invalidateResultV2();
    refreshTargetFromInputV2();
  }
  const archiveText = archiveEntries ? '（ZIP 内 ' + archiveEntries + ' 个文件）' : '';
  showToast('已载入 ' + records.length + ' 条记录' + archiveText + (errors.length ? '，' + errors.length + ' 个条目失败' : ''));
  $('fileInput').value = '';
  $('folderInput').value = '';
}

$('convertBtn').addEventListener('click', runConversion);
$('downloadBtn').addEventListener('click', downloadCurrent);
const sessionFetchButton = $('sessionFetchBtn');
if (sessionFetchButton) sessionFetchButton.addEventListener('click', () => {
  const popup = window.open('https://chatgpt.com/api/auth/session', '_blank', 'noopener,noreferrer');
  if (!popup) showToast('Session 页面被浏览器拦截，请允许弹窗后重试');
  else showToast('ChatGPT Session 页面已打开');
});
let targetRefreshTimerV2;
function refreshTargetFromInputV2() {
  const preferred = $('targetFormat').value;
  const next = refreshTargetOptions(state.source, preferred);
  state.target = next;
  if (next) $('outputTitle').textContent = formatNames[next] + ' 配置';
}
$('inputText').addEventListener('input', () => {
  invalidateResultV2();
  clearTimeout(targetRefreshTimerV2);
  targetRefreshTimerV2 = setTimeout(refreshTargetFromInputV2, 180);
});
setRoute('session', 'cpa');
function resetVerificationV2() {
  $('verificationBar').innerHTML = '<div class="verification-head"><div class="verification-summary"><strong>离线验签</strong><span class="verification-badge">等待转换</span><span>转换后显示账号身份与验签状态</span></div><div class="verification-source">JWKS SNAPSHOT<br>' + escapeHtmlV2(JWKS_SNAPSHOT_DATE_V2) + '</div></div><div class="verification-accounts"><div class="verification-empty">转换后将在这里显示 Email / ID、平台 / 套餐和过期时间</div></div>';
}
resetVerificationV2();
$('targetFormat').addEventListener('change', e => {
  state.target = e.target.value;
  $('outputTitle').textContent = formatNames[state.target] + ' 配置';
  invalidateResultV2();
});

globalThis.SessionForgeCore = Object.freeze({
  canonicalize,
  hasCredentialV2,
  inflateRawV2,
  invalidateResultV2,
  parseInput,
  parseSignedJwtV2,
  renderTarget,
  storeResultStateV2,
  unzipEntriesV2,
  verificationBlocksExportV2,
  verifyCanonicalV2,
  zipStoreV2,
  getState: () => state
});
