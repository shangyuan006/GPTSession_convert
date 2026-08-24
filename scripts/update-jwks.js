'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_FILE = path.join(ROOT, 'static', 'jwks.js');
const MAX_KEYS = 32;
const SOURCES = {
  openai: {
    url: 'https://auth.openai.com/.well-known/jwks.json',
    algorithm: 'RS256',
    required: ['kty', 'kid', 'alg', 'n', 'e'],
    validateKey(key) {
      return key.kty === 'RSA' && key.alg === 'RS256' && key.n && key.e;
    }
  },
  xai: {
    url: 'https://auth.x.ai/.well-known/jwks.json',
    algorithm: 'ES256',
    required: ['kty', 'kid', 'alg', 'crv', 'x', 'y'],
    validateKey(key) {
      return key.kty === 'EC' && key.crv === 'P-256' && key.alg === 'ES256' && key.x && key.y;
    }
  }
};

function parseDateArgument(value = process.env.JWKS_DATE || new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid snapshot date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid snapshot date: ${value}`);
  }
  return value;
}

function validateJwks(name, document) {
  const source = SOURCES[name];
  if (!source) throw new Error(`Unsupported JWKS source: ${name}`);
  if (!document || !Array.isArray(document.keys) || document.keys.length === 0 || document.keys.length > MAX_KEYS) {
    throw new Error(`${name} JWKS must contain between 1 and ${MAX_KEYS} keys`);
  }
  const kids = new Set();
  for (const [index, key] of document.keys.entries()) {
    if (!key || typeof key !== 'object' || source.required.some(field => typeof key[field] !== 'string' || !key[field])) {
      throw new Error(`${name} JWKS key ${index} is missing required fields`);
    }
    if (!source.validateKey(key) || (key.use && key.use !== 'sig')) {
      throw new Error(`${name} JWKS key ${index} does not match ${source.algorithm}`);
    }
    if (!/^[A-Za-z0-9._~-]{1,256}$/.test(key.kid)) throw new Error(`${name} JWKS key ${index} has an invalid kid`);
    const encodedFields = key.kty === 'RSA' ? ['n', 'e'] : ['x', 'y'];
    if (encodedFields.some(field => !/^[A-Za-z0-9_-]+$/.test(key[field]))) {
      throw new Error(`${name} JWKS key ${index} has invalid base64url fields`);
    }
    if (kids.has(key.kid)) throw new Error(`${name} JWKS contains duplicate kid ${key.kid}`);
    kids.add(key.kid);
  }
  return { keys: document.keys };
}

async function fetchJwks(name, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Node.js 22 or newer is required');
  const source = SOURCES[name];
  if (!source) throw new Error(`Unsupported JWKS source: ${name}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(source.url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${name} JWKS request failed with HTTP ${response.status}`);
    let document;
    try {
      document = await response.json();
    } catch (error) {
      throw new Error(`${name} JWKS response was not valid JSON`, { cause: error });
    }
    return validateJwks(name, document);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${name} JWKS request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function serializeSnapshot(snapshot) {
  const validated = {
    date: parseDateArgument(snapshot.date),
    openai: validateJwks('openai', snapshot.openai),
    xai: validateJwks('xai', snapshot.xai)
  };
  const json = JSON.stringify(validated).replace(/</g, '\\u003c');
  return `'use strict';\n\nglobalThis.SESSION_FORGE_JWKS = ${json};\n`;
}

function parseSnapshot(source) {
  const match = String(source).match(/globalThis\.SESSION_FORGE_JWKS\s*=\s*(\{[\s\S]*\});\s*$/);
  if (!match) throw new Error('Could not parse static/jwks.js');
  const snapshot = JSON.parse(match[1]);
  return {
    date: parseDateArgument(snapshot.date),
    openai: validateJwks('openai', snapshot.openai),
    xai: validateJwks('xai', snapshot.xai)
  };
}

function comparableJwks(jwks) {
  return JSON.stringify(jwks.keys
    .map(key => Object.fromEntries(Object.entries(key).sort(([left], [right]) => left.localeCompare(right))))
    .sort((left, right) => left.kid.localeCompare(right.kid)));
}

function snapshotsMatch(left, right) {
  return comparableJwks(left.openai) === comparableJwks(right.openai) && comparableJwks(left.xai) === comparableJwks(right.xai);
}

function atomicWrite(filename, content) {
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function getCurrentSnapshot({ fetchImpl, date = parseDateArgument(), timeoutMs } = {}) {
  const [openai, xai] = await Promise.all([
    fetchJwks('openai', { fetchImpl, timeoutMs }),
    fetchJwks('xai', { fetchImpl, timeoutMs })
  ]);
  return { date, openai, xai };
}

async function updateJwks(options = {}) {
  const snapshotFile = options.snapshotFile || SNAPSHOT_FILE;
  const snapshot = await getCurrentSnapshot(options);
  atomicWrite(snapshotFile, serializeSnapshot(snapshot));
  return { date: snapshot.date, openaiKeys: snapshot.openai.keys.length, xaiKeys: snapshot.xai.keys.length };
}

async function checkJwks(options = {}) {
  const snapshotFile = options.snapshotFile || SNAPSHOT_FILE;
  const embedded = parseSnapshot(fs.readFileSync(snapshotFile, 'utf8'));
  const current = await getCurrentSnapshot(options);
  if (!snapshotsMatch(embedded, current)) throw new Error('Embedded JWKS snapshot is stale; run npm run update:jwks');
  return { date: embedded.date, openaiKeys: embedded.openai.keys.length, xaiKeys: embedded.xai.keys.length };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const result = checkOnly ? await checkJwks() : await updateJwks();
  console.log(`${checkOnly ? 'Verified' : 'Updated'} JWKS snapshot (${result.date}): OpenAI ${result.openaiKeys} keys, xAI ${result.xaiKeys} keys`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  atomicWrite,
  checkJwks,
  fetchJwks,
  parseDateArgument,
  parseSnapshot,
  serializeSnapshot,
  snapshotsMatch,
  updateJwks,
  validateJwks
};
