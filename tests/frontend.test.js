const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');

function createHarness() {
  const elements = new Map();
  const defaults = new Set(['prettyCheck', 'normalizeCheck', 'verifyCheck', 'rejectForgedCheck']);
  const createElement = id => ({
    id,
    value: '',
    checked: defaults.has(id),
    textContent: '',
    innerHTML: '',
    hidden: false,
    style: {},
    dataset: {},
    listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    click() { return this.listeners.click?.({ target: this }); },
    scrollIntoView() {},
    setAttribute() {},
    select() {},
    remove() {}
  });
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };
  const document = {
    body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
    createElement: () => createElement('created'),
    getElementById: getElement,
    querySelector: () => createElement('query'),
    querySelectorAll: () => []
  };
  const storage = new Map();
  const context = {
    console,
    document,
    location: { protocol: 'http:', origin: 'http://localhost:1455' },
    navigator: {},
    window: { open: () => ({}) },
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    crypto: crypto.webcrypto,
    Blob,
    Response,
    DecompressionStream,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    clearInterval,
    setInterval
  };
  context.globalThis = context;
  const vmContext = vm.createContext(context);
  const html = fs.readFileSync('index.html', 'utf8');
  const scriptFiles = Array.from(html.matchAll(/<script src="([^"]+)"/g), match => match[1]);
  scriptFiles.forEach(file => vm.runInContext(fs.readFileSync(file, 'utf8'), vmContext, { filename: file }));
  return { context: vmContext, core: vmContext.SessionForgeCore, getElement };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

async function signedRs256Token(key, kid, payload) {
  const header = base64url({ alg: 'RS256', kid, typ: 'JWT' });
  const body = base64url(payload);
  const input = `${header}.${body}`;
  const signature = await crypto.webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

test('scripts initialize and complete a passthrough conversion', async () => {
  const harness = createHarness();
  harness.getElement('inputText').value = '{"access_token":"opaque-access","refresh_token":"opaque-refresh"}';
  harness.getElement('normalizeCheck').checked = false;
  await harness.context.runConversion();

  assert.equal(harness.getElement('statusText').textContent, 'DONE');
  assert.match(harness.getElement('outputBox').textContent, /opaque-access/);
});

test('strict input parsing rejects damaged structured data but permits a bare token', () => {
  const { core } = createHarness();
  assert.throws(() => core.parseInput('{"access_token":'), /JSON 格式错误/);
  assert.throws(() => core.parseInput('{"token":"one"}\nnot-json'), /JSONL 格式错误/);
  assert.throws(() => core.parseInput('token with spaces'), /无法识别输入格式/);
  assert.deepEqual(plain(core.parseInput('opaque-token')), { token: 'opaque-token' });
  assert.deepEqual(plain(core.parseInput('access_token=one;refresh_token=two')), { access_token: 'one', refresh_token: 'two' });
});

test('normalization keeps scalar email and xAI provider through an AxonHub round trip', () => {
  const { core } = createHarness();
  const canonical = core.canonicalize({
    account: { email: 'xai@example.com' },
    token: 'opaque-xai-token',
    base_url: 'https://api.x.ai/v1'
  }, 'axonhub');
  assert.equal(canonical.provider, 'xai');
  assert.equal(canonical.email, 'xai@example.com');

  const output = core.renderTarget(canonical, 'axonhub');
  assert.equal(output.provider, 'xai');
  assert.equal(core.canonicalize(output, 'axonhub').provider, 'xai');
});

test('target changes and failed conversions invalidate every cached result', async () => {
  const harness = createHarness();
  harness.core.storeResultStateV2('{"old":true}', [{ old: true }], [{ access_token: 'old' }]);
  harness.getElement('targetFormat').listeners.change({ target: { value: 'sub2api' } });
  assert.equal(harness.core.getState().result, null);
  assert.equal(harness.core.getState().batchOutputs.length, 0);

  harness.core.storeResultStateV2('{"old":true}', [{ old: true }], [{ access_token: 'old' }]);
  harness.getElement('inputText').value = '{"broken":';
  await harness.context.runConversion();
  assert.equal(harness.getElement('statusText').textContent, 'ERROR');
  assert.equal(harness.core.getState().result, null);
});

test('OAuth success replaces stale batch output used by JSONL and ZIP downloads', async () => {
  const harness = createHarness();
  harness.core.storeResultStateV2('{"old":true}', [{ old: true }], [{ access_token: 'old' }]);
  vm.runInContext("oauthState.verifier = 'V'.repeat(96); oauthState.nonce = '';", harness.context);
  harness.getElement('oauthCode').value = 'demo-code';
  harness.context.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh' })
  });
  await harness.getElement('oauthExchangeBtn').listeners.click();

  const state = harness.core.getState();
  assert.equal(state.batchOutputs.length, 1);
  assert.equal(state.batchOutputs[0].access_token, 'new-access');
  assert.equal(state.batchAccounts[0].access_token, 'new-access');
});

test('JWT verification accepts a valid signature and blocks expired or unknown-key JWTs', async () => {
  const harness = createHarness();
  const keyPair = await crypto.webcrypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const publicJwk = await crypto.webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
  Object.assign(publicJwk, { kid: 'test-key', alg: 'RS256', use: 'sig' });
  harness.context.testJwks = { keys: [publicJwk] };
  vm.runInContext('tokenContractsV2.openai.jwks = testJwks', harness.context);

  const baseClaims = { iss: 'https://auth.openai.com', aud: 'https://api.openai.com/v1', exp: Math.floor(Date.now() / 1000) + 300 };
  const valid = await harness.core.verifyCanonicalV2({ provider: 'openai', access_token: await signedRs256Token(keyPair.privateKey, 'test-key', baseClaims) }, true);
  assert.equal(valid.status, 'verified');

  const expired = await harness.core.verifyCanonicalV2({ provider: 'openai', access_token: await signedRs256Token(keyPair.privateKey, 'test-key', { ...baseClaims, exp: Math.floor(Date.now() / 1000) - 300 }) }, true);
  assert.equal(expired.status, 'expired');
  assert.equal(harness.core.verificationBlocksExportV2(expired), true);

  const unknown = await harness.core.verifyCanonicalV2({ provider: 'openai', access_token: await signedRs256Token(keyPair.privateKey, 'unknown-key', baseClaims) }, true);
  assert.equal(unknown.reason, 'unknown_kid');
  assert.equal(harness.core.verificationBlocksExportV2(unknown), true);
});

test('supported target renderers retain credentials for both providers', () => {
  const { core } = createHarness();
  const accounts = {
    openai: { provider: 'openai', access_token: 'openai-access', refresh_token: 'openai-refresh', email: 'openai@example.com', account_id: 'acct' },
    xai: { provider: 'xai', access_token: 'xai-access', refresh_token: 'xai-refresh', email: 'xai@example.com', user_id: 'user', issuer: 'https://auth.x.ai', base_url: 'https://api.x.ai/v1' }
  };
  const targets = {
    openai: ['cpa', 'sub2api', 'codexmanager', 'codex', 'codex2api', 'axonhub', 'router9', 'cockpit'],
    xai: ['cpa', 'sub2api', 'grok', 'grok2api', 'axonhub', 'router9', 'cockpit']
  };
  for (const [provider, providerTargets] of Object.entries(targets)) {
    for (const target of providerTargets) {
      assert.match(JSON.stringify(core.renderTarget(accounts[provider], target)), new RegExp(`${provider}-access`), `${provider} -> ${target}`);
    }
  }
});

test('ZIP store round trips and raw inflate aborts once actual output exceeds its limit', async () => {
  const { core } = createHarness();
  const archive = core.zipStoreV2([{ name: 'account.json', text: '{"access_token":"one"}' }]);
  const entries = await core.unzipEntriesV2(archive);
  assert.equal(entries.length, 1);
  assert.equal(new TextDecoder().decode(entries[0].data), '{"access_token":"one"}');

  const compressed = zlib.deflateRawSync(Buffer.alloc(4096, 65));
  await assert.rejects(() => core.inflateRawV2(compressed, 128), /实际解压大小超过限制/);
});
