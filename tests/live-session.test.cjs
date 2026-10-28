'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeLiveSessionHandler, mintLiveToken } = require('../src/live-session-handler.cjs');

function response() {
  let statusCode = 200, body;
  return {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
    get output() { return { statusCode, body }; }
  };
}
test('Gemini receives restricted single-use token request', async () => {
  let captured;
  const fetchFn = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ name: 'ephemeral-test-token' }) };
  };
  const result = await mintLiveToken({ GEMINI_API_KEY: 'server-secret', GEMINI_LIVE_MODEL: 'gemini-3.8-live' }, fetchFn);
  assert.equal(result.token, 'ephemeral-test-token');
  assert.equal(result.model, 'gemini-3.8-live');
  assert.ok(result.websocketUrl.startsWith('wss://'));
  assert.equal(captured.opts.headers['x-goog-api-key'], 'server-secret');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.uses, 1);
  assert.equal(body.liveConnectConstraints.model, 'models/gemini-3.8-live');
  assert.deepEqual(body.liveConnectConstraints.config.responseModalities, ['AUDIO']);
  assert.ok(new Date(body.expireTime) - new Date(body.newSessionExpireTime) > 0);
});
test('Refuses to issue token when rate limit fails', async () => {
  let called = false;
  const handler = makeLiveSessionHandler({
    env: { GEMINI_API_KEY: 'testing', VERCEL_ENV: 'production' },
    mintLiveToken: async () => { called = true; return {}; }
  });
  const res = response();
  await handler({ method: 'POST', headers: {} }, res);
  assert.equal(res.output.statusCode, 503);
  assert.equal(res.output.body.code, 'quota_not_configured');
  assert.equal(called, false);
});
test('Success with authorized and metered request', async () => {
  const handler = makeLiveSessionHandler({
    env: { GEMINI_API_KEY: 'testing', VERCEL_ENV: 'development' },
    checkQuota: async () => {},
    mintLiveToken: async () => ({
      token: 'short-lived', model: 'gemini-3.8-live', websocketUrl: 'wss://example.com', expiresAt: 'tomorrow'
    })
  });
  const res = response();
  await handler({ method: 'POST', headers: {} }, res);
  assert.equal(res.output.statusCode, 200);
  assert.equal(res.output.body.token, 'short-lived');
});
test('Missing Gemini key fails safely', async () => {
  await assert.rejects(() => mintLiveToken({}, async () => { throw Error('must not fetch'); }), error => error.status === 503);
});
test('HTTP GET rejected', async () => {
  const handler = makeLiveSessionHandler();
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.output.statusCode, 405);
});
test('Upstream rejects token without leaking credentials', async () => {
  await assert.rejects(() => mintLiveToken({ GEMINI_API_KEY: 'secret' }, async () => ({
    ok: false, status: 400, json: async () => ({ error: 'private information' })
  })), error => error.status === 503 && !error.message.includes('private information'));
});
