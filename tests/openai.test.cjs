'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceTurn } = require('../src/openai.cjs');

const input = () => ({
  audio: Buffer.alloc(300, 1),
  user: { name: 'Ana', language: 'es', interests: ['música'] },
  companion: { name: 'Lucas', interests: ['viajes'], personality: {} },
  memories: ['Le gusta el té verde'],
  history: [{ role: 'assistant', content: 'Hola Ana' }]
});

test('transcribe, consulta IA y devuelve respuesta con recuerdo explícito', async () => {
  const requests = [];
  const fetchFn = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/audio/transcriptions')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('model'), 'gpt-transcribe');
      return { ok: true, json: async () => ({ text: 'Recuerda que me gusta el té verde' }) };
    }
    return {
      ok: true,
      json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ reply: '¡Me lo guardo!', memory: 'Le gusta el té verde' }) }] }] })
    };
  };
  const result = await voiceTurn(input(), { env: { OPENAI_API_KEY: 'test-only' }, fetchFn });
  assert.deepEqual(result, { transcript: 'Recuerda que me gusta el té verde', reply: '¡Me lo guardo!', memory: 'Le gusta el té verde' });
  assert.equal(requests.length, 2);
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.store, false);
  assert.equal(body.model, 'gpt-4.1-mini');
  assert.equal(body.input.at(-1).role, 'user');
  assert.ok(body.instructions.includes('Lucas'));
});

test('omite memoria cuando no se solicita', async () => {
  const fetchFn = async (url) => url.endsWith('/audio/transcriptions')
    ? { ok: true, json: async () => ({ text: 'Hola Lucas' }) }
    : { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ reply: '¡Hola Ana!', memory: 'No solicitado' }) }] }] }) };
  const result = await voiceTurn(input(), { env: { OPENAI_API_KEY: 'test-only' }, fetchFn });
  assert.equal(result.memory, '');
});

test('no filtra errores brutos del proveedor', async () => {
  const fetchFn = async () => ({ ok: false, status: 500, json: async () => ({ error: 'internal secret' }) });
  await assert.rejects(() => voiceTurn(input(), { env: { OPENAI_API_KEY: 'test-only' }, fetchFn }), error => {
    assert.equal(error.status, 502);
    assert.ok(!error.message.includes('internal secret'));
    return true;
  });
});
