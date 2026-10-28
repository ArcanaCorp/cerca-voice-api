'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeHandler } = require('../src/voice-handler.cjs');
const { parseBody, authorize, checkQuota, ApiError } = require('../src/guard.cjs');
const { requestedRemember, redactMemoryCandidate } = require('../src/prompt.cjs');

const goodPayload = () => ({
  audio: Buffer.alloc(500, 5).toString('base64'),
  mimeType: 'audio/mp4',
  user: { name: 'Ana', language: 'es', interests: ['música'] },
  companion: { name: 'Lucas', humor: 'juguetón', interests: ['astronomía'] },
  history: [{ role: 'assistant', content: 'Hola' }],
  memories: ['Le gusta la música']
});
function response() {
  let code = 200;
  const headers = {};
  let body;
  return {
    setHeader(k, v) { headers[k] = v; return this; },
    status(n) { code = n; return this; },
    json(value) { body = value; return this; },
    end() { return this; },
    get result() { return { code, body, headers }; }
  };
}
function request(body, method = 'POST') {
  return { method, headers: { 'x-forwarded-for': '192.0.2.1' }, body };
}

test('valida entrada y limita contexto', () => {
  const data = goodPayload();
  data.history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'x'.repeat(1000) }));
  data.memories = Array(80).fill('un dato');
  const parsed = parseBody(data);
  assert.equal(parsed.history.length, 12);
  assert.equal(parsed.memories.length, 25);
  assert.equal(parsed.history[0].content.length, 700);
  assert.equal(parsed.companion.name, 'Lucas');
  assert.equal(parsed.audio.byteLength, 500);
});

test('rechaza audio inválido y formatos no permitidos', () => {
  assert.throws(() => parseBody({ ...goodPayload(), audio: 'invalid$' }), e => e instanceof ApiError && e.status === 400);
  assert.throws(() => parseBody({ ...goodPayload(), mimeType: 'audio/wav' }), e => e.status === 415);
  assert.throws(() => parseBody({ ...goodPayload(), audio: Buffer.alloc(2_500_100).toString('base64') }), e => e.status === 413);
});

test('permite solicitudes de app conforme al contrato original', async () => {
  let seen;
  const handler = makeHandler({
    env: { OPENAI_API_KEY: 'fake-key', VERCEL_ENV: 'development' },
    checkQuota: async () => {},
    voiceTurn: async (input) => {
      seen = input;
      return { transcript: 'Hola Lucas', reply: '¡Qué tal!', memory: '' };
    }
  });
  const res = response();
  await handler(request(goodPayload()), res);
  assert.equal(res.result.code, 200);
  assert.deepEqual(res.result.body, { transcript: 'Hola Lucas', reply: '¡Qué tal!', memory: '' });
  assert.equal(seen.user.name, 'Ana');
});

test('falla cerrado en producción sin protección de consumo', async () => {
  const handler = makeHandler({
    env: { OPENAI_API_KEY: 'fake-key', VERCEL_ENV: 'production' },
    voiceTurn: async () => { throw Error('no debería alcanzar proveedor'); }
  });
  const res = response();
  await handler(request(goodPayload()), res);
  assert.equal(res.result.code, 503);
  assert.equal(res.result.body.code, 'quota_not_configured');
});

test('protege con token cuando se configura', () => {
  const env = { API_ACCESS_TOKEN: 'secret-only-on-server' };
  assert.throws(() => authorize({ headers: { authorization: 'Bearer otra-clave' } }, env), e => e.status === 401);
  assert.doesNotThrow(() => authorize({ headers: { authorization: 'Bearer secret-only-on-server' } }, env));
});

test('solo recuerda cuando hay petición y bloquea información secreta', () => {
  assert.equal(requestedRemember('Recuerda que me gusta el té verde'), true);
  assert.equal(requestedRemember('Hola, ¿qué tal?'), false);
  assert.equal(redactMemoryCandidate('Mi contraseña de banco es 1234'), '');
  assert.equal(redactMemoryCandidate('Le gusta el té verde'), 'Le gusta el té verde');
});

test('limita por IP y día utilizando contadores externos', async () => {
  const env = { UPSTASH_REDIS_REST_URL: 'https://db.example', UPSTASH_REDIS_REST_TOKEN: 'token', REQUESTS_PER_MINUTE: '5', DAILY_REQUESTS_LIMIT: '200', RATE_LIMIT_SALT: 'salt' };
  const fetchFn = async (_url, opts) => {
    const commands = JSON.parse(opts.body);
    assert.equal(commands[0][0], 'INCR');
    assert.equal(commands[2][0], 'INCR');
    assert.ok(!commands[0][1].includes('192.0.2.1'));
    return { ok: true, json: async () => [{ result: 6 }, { result: 1 }, { result: 10 }, { result: 1 }] };
  };
  await assert.rejects(() => checkQuota(request(goodPayload()), env, fetchFn), e => e.status === 429);
});
