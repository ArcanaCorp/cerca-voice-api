'use strict';
const { ApiError, text } = require('./guard.cjs');

async function transcribe(audio, { env = process.env, fetchFn = fetch } = {}) {
  if (!env.GROQ_API_KEY) throw new ApiError(503, 'missing_groq_key', 'Configura GROQ_API_KEY en el servidor.');
  const form = new FormData();
  form.append('model', env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
  form.append('file', new Blob([audio], { type: 'audio/mp4' }), 'voice.m4a');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetchFn('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY },
      body: form,
      signal: controller.signal
    });
    if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 502,
      'groq_error', response.status === 429 ? 'Límite temporal de Groq alcanzado.' : 'Groq no pudo transcribir la voz.');
    const result = await response.json();
    const transcript = text(result.text, 3000);
    if (!transcript) throw new ApiError(422, 'empty_transcript', 'No te escuché bien. Intenta de nuevo.');
    return transcript;
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError(504, 'groq_timeout', 'La transcripción tardó demasiado.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { transcribe };
