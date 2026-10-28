'use strict';
const { ApiError, text } = require('./guard.cjs');
const { makeInstructions, requestedRemember, redactMemoryCandidate } = require('./prompt.cjs');

async function callOpenAI(path, opts, { env = process.env, fetchFn = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetchFn(`https://api.openai.com/v1${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        ...(opts.headers || {})
      },
      signal: controller.signal
    });
    if (!response.ok) {
      // Nunca reenviar la respuesta cruda del proveedor al cliente.
      const status = response.status === 429 ? 429 : 502;
      throw new ApiError(status, 'provider_error', status === 429 ? 'El motor de IA está ocupado.' : 'No pudimos conectar con la IA.');
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError(504, 'provider_timeout', 'La IA tardó demasiado en responder.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function outputText(response) {
  return (Array.isArray(response.output) ? response.output : [])
    .flatMap(block => Array.isArray(block.content) ? block.content : [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text || '')
    .join('');
}
async function transcribe(audio, options) {
  const form = new FormData();
  form.append('model', options.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-transcribe');
  form.append('file', new Blob([audio], { type: 'audio/mp4' }), 'voice.m4a');
  const data = await callOpenAI('/audio/transcriptions', { method: 'POST', body: form }, options);
  const result = text(data.text, 3000);
  if (!result) throw new ApiError(422, 'empty_transcript', 'No pude entender tu voz. Intenta nuevamente.');
  return result;
}
async function respond(input, transcript, options) {
  const response = await callOpenAI('/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
      instructions: makeInstructions(input),
      input: [...input.history, { role: 'user', content: transcript }],
      store: false,
      max_output_tokens: 380,
      text: {
        format: {
          type: 'json_schema', name: 'cerca_turn', strict: true,
          schema: {
            type: 'object', additionalProperties: false,
            properties: { reply: { type: 'string' }, memory: { type: 'string' } },
            required: ['reply', 'memory']
          }
        }
      }
    })
  }, options);
  let parsed;
  try { parsed = JSON.parse(outputText(response)); }
  catch { throw new ApiError(502, 'invalid_provider_response', 'La IA no pudo generar una respuesta válida.'); }
  const reply = text(parsed.reply, 900);
  if (!reply) throw new ApiError(502, 'empty_reply', 'La IA no devolvió una respuesta.');
  const memory = requestedRemember(transcript) ? redactMemoryCandidate(parsed.memory) : '';
  return { transcript, reply, memory };
}
async function voiceTurn(input, opts) {
  const transcript = await transcribe(input.audio, opts);
  return respond(input, transcript, opts);
}
module.exports = { voiceTurn, callOpenAI, outputText };
