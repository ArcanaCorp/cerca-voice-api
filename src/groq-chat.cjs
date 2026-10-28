'use strict';

const { ApiError } = require('./guard.cjs');
const { parseOutput } = require('./openrouter.cjs');

// Alternativa de texto usando la misma clave Groq que ya permite Whisper.
// No se activa de forma automática: requiere GROQ_TEXT_FALLBACK_ENABLED=true.
async function requestGroqJSON(
  { system, messages, temperature = 0.75, maxTokens = 900, allowPlainText = false },
  { env = process.env, fetchFn = fetch, trace } = {}
) {
  if (!env.GROQ_API_KEY) {
    throw new ApiError(503, 'missing_groq_key', 'Configura GROQ_API_KEY.');
  }

  const model = env.GROQ_TEXT_MODEL || 'openai/gpt-oss-20b';
  const payload = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: Math.max(0.2, Math.min(1, temperature)),
    max_completion_tokens: Math.max(1000, Math.min(2000, maxTokens)),
    response_format: { type: 'json_object' },
  };

  if (model.startsWith('openai/gpt-oss-')) {
    payload.reasoning_format = 'hidden';
    payload.reasoning_effort = 'low';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetchFn('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GROQ_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      trace?.warn?.('groq_text_provider_failure', { status: response.status, model });
      throw new ApiError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? 'groq_text_rate_limited' : 'groq_text_error',
        response.status === 429
          ? 'También se agotó temporalmente la cuota de texto de Groq. Intenta más tarde.'
          : 'El servicio alternativo de IA no está disponible.'
      );
    }

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    trace?.log?.('groq_text_completion', {
      model: typeof result?.model === 'string' ? result.model.slice(0, 100) : model,
      contentChars: typeof content === 'string' ? content.length : 0,
    });
    return parseOutput(content, allowPlainText).output;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(504, 'groq_text_timeout', 'Groq tardó demasiado en responder.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestGroqJSON };
