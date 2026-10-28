'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkQuota, ApiError } = require('../src/guard.cjs');
const { createTrace } = require('../src/diagnostics.cjs');

const request = { headers: { 'x-forwarded-for': '192.0.2.2' } };
const env = {
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'secret-not-logged',
  RATE_LIMIT_SALT: 'another-secret',
  VERCEL_ENV: 'production'
};
function collector() {
  const events = [];
  return { events, trace: {
    log(event, details) { events.push({ event, ...details }); },
    warn(event, details) { events.push({ event, ...details }); }
  } };
}

test('traza éxito de Upstash y solo expone contadores', async () => {
  const { events, trace } = collector();
  await checkQuota(request, env, async (url, opts) => {
    assert.match(url, /\/pipeline$/);
    assert.match(opts.headers.Authorization, /^Bearer /);
    return {
      ok: true,
      status: 200,
      json: async () => [{ result: 1 }, { result: 1 }, { result: 2 }, { result: 1 }],
    };
  }, trace);
  assert.ok(events.some(x => x.event === 'quota_upstash_ok' && x.daily === 2));
  assert.ok(!JSON.stringify(events).includes(env.UPSTASH_REDIS_REST_TOKEN));
  assert.ok(!JSON.stringify(events).includes(env.RATE_LIMIT_SALT));
});

test('distingue HTTP 401 de Upstash sin mostrar token', async () => {
  const { events, trace } = collector();
  await assert.rejects(
    () => checkQuota(request, env, async () => ({ ok: false, status: 401 }), trace),
    err => err instanceof ApiError && err.code === 'rate_limit_unavailable'
  );
  assert.ok(events.some(x => x.event === 'quota_upstash_http_failure' && x.httpStatus === 401));
});

test('registra si Upstash devuelve un formato inesperado', async () => {
  const { events, trace } = collector();
  await assert.rejects(
    () => checkQuota(request, env, async () => ({ ok: true, json: async () => ({ result: 'PONG' }) }), trace),
    err => err.code === 'rate_limit_unavailable'
  );
  assert.ok(events.some(x => x.event === 'quota_upstash_invalid_result' && x.resultIsArray === false));
});

test('distingue fallo de red de la protección', async () => {
  const { events, trace } = collector();
  await assert.rejects(
    () => checkQuota(request, env, async () => { throw new TypeError('Network failed'); }, trace),
    err => err.code === 'rate_limit_unavailable'
  );
  assert.ok(events.some(x => x.event === 'quota_network_failure' && x.kind === 'network'));
});

test('devuelve identificador trazable sin filtrar datos sensibles', () => {
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  const trace = createTrace('voice', request, res, { CERCA_DEBUG_LOGS: 'false' });
  assert.equal(headers['X-CERCA-Request-ID'], trace.id);
  assert.match(trace.id, /^[a-f0-9-]{12}$/);
  assert.ok(!JSON.stringify(trace).includes(env.UPSTASH_REDIS_REST_TOKEN));
});
