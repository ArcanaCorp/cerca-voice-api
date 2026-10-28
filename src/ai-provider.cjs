'use strict';

const { requestJSON } = require('./openrouter.cjs');
const { requestGroqJSON } = require('./groq-chat.cjs');

const FALLBACK_ERRORS = new Set([
  'openrouter_error',
  'openrouter_rate_limited',
  'openrouter_timeout',
  'non_conversational_model',
  'empty_model_output',
  'bad_model_output',
]);

async function requestAIJSON(request, options = {}) {
  try {
    return await requestJSON(request, options);
  } catch (error) {
    const env = options.env || process.env;
    if (
      env.GROQ_TEXT_FALLBACK_ENABLED !== 'true' ||
      !env.GROQ_API_KEY ||
      !FALLBACK_ERRORS.has(error?.code)
    ) {
      throw error;
    }
    // Una sola alternativa. No crear bucles de reintentos que gasten cuotas.
    options.trace?.warn?.('groq_text_fallback_started', { reason: error.code });
    return requestGroqJSON(request, options);
  }
}

module.exports = { requestAIJSON };
