'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestAIJSON } = require('../src/ai-provider.cjs');
const { voiceTurn } = require('../src/voice-engine.cjs');
const { createCompanion } = require('../src/companion.cjs');

const BASE_ENV = {
  OPENROUTER_API_KEY: 'test-only',
  GROQ_API_KEY: 'test-only',
  GROQ_TEXT_FALLBACK_ENABLED: 'true',
};

function modelResponse(data) {
  return {
    ok: true,
    json: async () => ({
      model: 'openai/gpt-oss-20b',
      choices: [{ message: { content: JSON.stringify(data) } }],
    }),
  };
}

test('429 de OpenRouter activa Groq sin reintentos infinitos', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('openrouter.ai')) {
      return {
        ok: false,
        status: 429,
        headers: { get: key => key.toLowerCase() === 'retry-after' ? '60' : '0' },
        json: async () => ({ error: { message: 'secret provider error' } }),
      };
    }
    if (url.includes('groq.com/openai/v1/chat/completions')) {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'openai/gpt-oss-20b');
      assert.equal(body.response_format.type, 'json_object');
      assert.equal(body.reasoning_format, 'hidden');
      return modelResponse({ reply: 'Me encanta hablar de fotografía, ¿tú qué opinas?', memory: '' });
    }
    throw new Error('Unexpected URL');
  };
  const result = await requestAIJSON({
    system: 'Eres Clara',
    messages: [{ role: 'user', content: 'Hola Clara' }],
    allowPlainText: true,
  }, { env: BASE_ENV, fetchFn });
  assert.match(result.reply, /fotografía/);
  assert.equal(calls.length, 2);
});

test('No usa Groq sin autorización explícita de entorno', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { ok: false, status: 429, headers: { get: () => null } };
  };
  await assert.rejects(
    () => requestAIJSON({ system: 'CERCA', messages: [] }, {
      env: { ...BASE_ENV, GROQ_TEXT_FALLBACK_ENABLED: 'false' },
      fetchFn,
    }),
    error => error.code === 'openrouter_rate_limited'
  );
  assert.equal(calls.length, 1);
});

test('Si Groq también alcanza 429, informa límite sin entrar en un bucle', async () => {
  const urls = [];
  const fetchFn = async url => {
    urls.push(url);
    return { ok: false, status: 429, headers: { get: () => null } };
  };
  await assert.rejects(
    () => requestAIJSON({ system: 'CERCA', messages: [] }, { env: BASE_ENV, fetchFn }),
    error => error.code === 'groq_text_rate_limited'
  );
  assert.equal(urls.length, 2);
});

test('Clasificación de seguridad activa un modelo conversacional alternativo', async () => {
  const fetchFn = async url => {
    if (url.includes('openrouter.ai')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'User Safety: safe' } }] }) };
    }
    return modelResponse({ reply: 'No tengo cuenta de Instagram, pero sí podemos conversar de fotografía.', memory: '' });
  };
  const value = await requestAIJSON({ system: 'Eres Clara', messages: [], allowPlainText: true }, { env: BASE_ENV, fetchFn });
  assert.match(value.reply, /Instagram/);
});

test('Responde por voz con un solo fallback después de transcribir', async () => {
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    if (url.includes('/audio/transcriptions')) return { ok: true, json: async () => ({ text: 'Clara, ¿qué piensas del arte?' }) };
    if (url.includes('openrouter.ai')) return { ok: false, status: 429, headers: { get: () => null } };
    return modelResponse({ reply: 'Me atraen las formas y cómo cuentan historias.', memory: '' });
  };
  const result = await voiceTurn({
    audio: Buffer.alloc(40, 1),
    user: { name: 'Ana', language: 'es', interests: ['arte'] },
    companion: { name: 'Clara', personality: {}, interests: ['cine'], humor: 'ligero', communicationStyle: 'natural' },
    history: [],
    memories: [],
  }, { env: BASE_ENV, fetchFn });
  assert.equal(result.transcript, 'Clara, ¿qué piensas del arte?');
  assert.equal(result.memory, '');
  assert.equal(calls.length, 3);
});

test('Genera identidad con modelo alternativo y respeta la preferencia del usuario', async () => {
  const fetchFn = async url => {
    if (url.includes('openrouter.ai')) return { ok: false, status: 429, headers: { get: () => null } };
    return modelResponse({
      name: 'Clara',
      gender: 'female',
      personality: { openness: 60, conscientiousness: 50, extraversion: 50, agreeableness: 70, neuroticism: 30 },
      interests: ['fotografía', 'cocina', 'diseño'],
      humor: 'ligero',
      communicationStyle: 'espontánea',
    });
  };
  const friend = await createCompanion({ preference: 'female', user: { name: 'Ana', language: 'es', interests: ['cine'] } }, { env: BASE_ENV, fetchFn });
  assert.equal(friend.name, 'Clara');
  assert.equal(friend.gender, 'female');
  assert.equal(friend.interests.length, 3);
});
