'use strict';
const { ApiError } = require('./guard.cjs');

function extractJSON(value) {
  if (typeof value !== 'string') throw new ApiError(502, 'bad_model_output', 'La IA no entregó una respuesta válida.');
  const raw = value.trim();
  try { return JSON.parse(raw); } catch {}
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  throw new ApiError(502, 'bad_model_output', 'La IA no entregó JSON válido. Puedes reintentar.');
}

async function requestJSON({ system, messages, temperature = 0.8, maxTokens = 800 }, { env = process.env, fetchFn = fetch } = {}) {
  if (!env.OPENROUTER_API_KEY) throw new ApiError(503, 'missing_openrouter_key', 'Configura OPENROUTER_API_KEY.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const payload = {
      model: env.OPENROUTER_MODEL || 'openrouter/free',
      messages: [{ role: 'system', content: system }, ...messages],
      temperature,
      max_tokens: maxTokens
    };
    // Algunos modelos gratuitos no admiten response_format. Activarlo solo si está verificado.
    if (env.OPENROUTER_JSON_MODE === 'true') payload.response_format = { type: 'json_object' };

    const response = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
        'X-Title': 'CERCA AI Friend'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ApiError(response.status === 429 ? 429 : 502, 'openrouter_error',
        response.status === 429 ? 'Se agotó temporalmente la cuota de OpenRouter.' : 'OpenRouter no pudo responder.');
    }
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    return extractJSON(Array.isArray(content)
      ? content.filter(x => x.type === 'text').map(x => x.text).join('')
      : content);
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError(504, 'openrouter_timeout', 'OpenRouter tardó demasiado. Intenta nuevamente.');
    throw error;
  } finally { clearTimeout(timer); }
}
module.exports = { requestJSON, extractJSON };
