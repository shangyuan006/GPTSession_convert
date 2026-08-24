const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseDateArgument,
  parseSnapshot,
  serializeSnapshot,
  snapshotsMatch,
  validateJwks
} = require('../scripts/update-jwks');

const openai = { keys: [{ kty: 'RSA', kid: 'openai-key', alg: 'RS256', use: 'sig', n: 'modulus', e: 'AQAB' }] };
const xai = { keys: [{ kty: 'EC', kid: 'xai-key', alg: 'ES256', use: 'sig', crv: 'P-256', x: 'eA', y: 'eQ' }] };

test('validates supported JWKS shapes and rejects duplicate or malformed keys', () => {
  assert.deepEqual(validateJwks('openai', openai), openai);
  assert.deepEqual(validateJwks('xai', xai), xai);
  assert.throws(() => validateJwks('openai', { keys: [{ kty: 'RSA', kid: 'bad', alg: 'ES256', n: 'modulus', e: 'AQAB' }] }), /does not match RS256/);
  assert.throws(() => validateJwks('openai', { keys: [openai.keys[0], openai.keys[0]] }), /duplicate kid/);
  assert.throws(() => validateJwks('xai', { keys: [{ ...xai.keys[0], x: '<script>' }] }), /base64url/);
});

test('serializes and parses the standalone snapshot without executable markup', () => {
  const source = serializeSnapshot({ date: '2026-08-24', openai, xai });
  const parsed = parseSnapshot(source);
  assert.equal(parsed.date, '2026-08-24');
  assert.deepEqual(parsed.openai, openai);
  assert.deepEqual(parsed.xai, xai);
  assert.doesNotMatch(source, /<script/i);
});

test('compares snapshots independent of key and property order', () => {
  const reordered = {
    openai: { keys: [{ e: 'AQAB', n: 'modulus', use: 'sig', alg: 'RS256', kid: 'openai-key', kty: 'RSA' }] },
    xai: { keys: [{ y: 'eQ', x: 'eA', crv: 'P-256', use: 'sig', alg: 'ES256', kid: 'xai-key', kty: 'EC' }] }
  };
  assert.equal(snapshotsMatch({ openai, xai }, reordered), true);
  assert.equal(snapshotsMatch({ openai, xai }, { ...reordered, openai: { keys: [{ ...openai.keys[0], kid: 'new-key' }] } }), false);
});

test('rejects invalid snapshot dates', () => {
  assert.equal(parseDateArgument('2026-08-24'), '2026-08-24');
  assert.throws(() => parseDateArgument('2026-02-30'), /Invalid snapshot date/);
  assert.throws(() => parseDateArgument('not-a-date'), /Invalid snapshot date/);
});
