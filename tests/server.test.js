const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REDIRECT_URI,
  callbacks,
  createServer,
  exchangeRateLimits
} = require('../server');

const ALLOWED_ORIGIN = 'http://localhost:1455';

test.beforeEach(() => {
  callbacks.clear();
  exchangeRateLimits.clear();
});

async function withServer(run, options = {}) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test('serves the app with browser security headers', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /connect-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);

    const html = await response.text();
    assert.match(html, /<link rel="stylesheet" href="static\/app\.css">/);
    assert.match(html, /<script src="static\/jwks\.js"><\/script>/);
    assert.match(html, /<script src="static\/app\.js"><\/script>/);
  });
});

test('serves allowlisted static assets and a health endpoint', async () => {
  await withServer(async baseUrl => {
    const assets = [
      ['/static/app.css', 'text/css; charset=utf-8'],
      ['/static/app.js', 'text/javascript; charset=utf-8'],
      ['/static/jwks.js', 'text/javascript; charset=utf-8']
    ];

    for (const [pathname, contentType] of assets) {
      const response = await fetch(`${baseUrl}${pathname}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), contentType);
      assert.ok((await response.text()).length > 0);
    }

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await readJson(health), { status: 'ok' });

    const unlisted = await fetch(`${baseUrl}/static/../server.js`);
    assert.equal(unlisted.status, 404);
  });
});

test('handles the browser favicon request without a 404', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/favicon.ico`);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });
});

test('rejects untrusted API origins and reflects allowed origins', async () => {
  await withServer(async baseUrl => {
    const blocked = await fetch(`${baseUrl}/oauth-config`, {
      headers: { Origin: 'https://example.com' }
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);

    const opaqueOrigin = await fetch(`${baseUrl}/oauth-config`, {
      headers: { Origin: 'null' }
    });
    assert.equal(opaqueOrigin.status, 403);

    const allowed = await fetch(`${baseUrl}/oauth-config`, {
      headers: { Origin: ALLOWED_ORIGIN }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  });
});

test('returns client errors for malformed or oversized JSON bodies', async () => {
  await withServer(async baseUrl => {
    const malformed = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await readJson(malformed), { error: 'invalid_json' });

    const notObject = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null'
    });
    assert.equal(notObject.status, 400);
    assert.deepEqual(await readJson(notObject), { error: 'json_object_required' });

    const oversized = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) })
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await readJson(oversized), { error: 'request_body_too_large' });
  });
});

test('registers, completes, and consumes an OAuth state once', async () => {
  await withServer(async baseUrl => {
    const state = 'A'.repeat(48);
    const registered = await fetch(`${baseUrl}/oauth-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ state })
    });
    assert.equal(registered.status, 201);

    const callback = await fetch(`${baseUrl}/auth/callback?state=${state}&code=demo-code`);
    assert.equal(callback.status, 200);

    const firstRead = await fetch(`${baseUrl}/oauth-status?state=${state}`, {
      headers: { Origin: ALLOWED_ORIGIN }
    });
    assert.equal(firstRead.status, 200);
    assert.deepEqual(await readJson(firstRead), { code: 'demo-code', error: '' });

    const secondRead = await fetch(`${baseUrl}/oauth-status?state=${state}`, {
      headers: { Origin: ALLOWED_ORIGIN }
    });
    assert.equal(secondRead.status, 404);
    assert.deepEqual(await readJson(secondRead), { error: 'unknown_or_expired_state' });
  });
});

test('rejects callbacks for states that were not registered', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/auth/callback?state=${'B'.repeat(48)}&code=demo-code`);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /授权状态已过期/);
  });
});

test('uses the configured redirect URI during token exchange', async () => {
  let providerRequest;
  const fetchImpl = async (url, options) => {
    providerRequest = { url, options };
    return {
      status: 200,
      text: async () => JSON.stringify({ access_token: 'access', refresh_token: 'refresh' })
    };
  };

  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ code: 'demo-code', code_verifier: 'V'.repeat(96) })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { access_token: 'access', refresh_token: 'refresh' });
    assert.equal(providerRequest.url, 'https://auth.openai.com/oauth/token');
    assert.equal(providerRequest.options.body.get('redirect_uri'), REDIRECT_URI);

    const mismatched = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ code: 'demo-code', code_verifier: 'V'.repeat(96), redirect_uri: 'https://example.com/callback' })
    });
    assert.equal(mismatched.status, 400);
    assert.deepEqual(await readJson(mismatched), { error: 'invalid_redirect_uri' });
  }, { fetchImpl });
});

test('times out stalled token exchange requests', async () => {
  const fetchImpl = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'demo-code', code_verifier: 'V'.repeat(96) })
    });
    assert.equal(response.status, 504);
    assert.deepEqual(await readJson(response), { error: 'token_exchange_timeout' });
  }, { fetchImpl, tokenTimeoutMs: 20 });
});

test('rejects oversized token responses without buffering them fully', async () => {
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      controller.close();
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'demo-code', code_verifier: 'V'.repeat(96) })
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await readJson(response), { error: 'token_response_too_large' });
  }, { fetchImpl });
});

test('rejects invalid token exchange timeout configuration', () => {
  assert.throws(() => createServer({ tokenTimeoutMs: 0 }), /positive number/);
  assert.throws(() => createServer({ tokenTimeoutMs: Number.NaN }), /positive number/);
  assert.throws(() => createServer({ tokenTimeoutMs: Number.POSITIVE_INFINITY }), /positive number/);
});
