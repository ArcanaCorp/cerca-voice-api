'use strict';
const { ApiError } = require('./guard.cjs');

function extractJSON(value) {
  if (typeof value !== 'string') {
    throw new ApiError(502, 'bad_model_output', 'La IA no entregó una respuesta válida.');
  }

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

// Impide que un clasificador de seguridad se haga pasar por el compañero.
function isClassificationOutput(value) {
  if (typeof value !== 'string') return false;
  return /^(?:user\s+safety|response\s+safety)\s*:/i.test(value.trim());
}
function assertConversationalOutput(value) {
  if (isClassificationOutput(value)) {
    throw new ApiError(
      502, 'non_conversational_model',
      'OpenRouter devolvió una clasificación en lugar de conversación. Selecciona un modelo de chat mediante OPENROUTER_MODEL.'
    );
  }
}

// Algunos modelos gratuitos responden con texto natural incluso al solicitar JSON.
// El fallback aplica exclusivamente a conversaciones, nunca a la identidad del compañero.
function extractSpokenText(value) {
  if (typeof value !== 'string') return null;

  let spoken = value.trim();
  if (/^```(?:text|plaintext)?\s*\n/i.test(spoken) && /\n```\s*$/.test(spoken)) {
    spoken = spoken.replace(/^```(?:text|plaintext)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
  }

  if (!spoken || spoken.length > 900) return null;
  assertConversationalOutput(spoken);

  // Nunca verbalizar JSON roto, estructuras de datos ni instrucciones internas.
  if (/^[\[{]/.test(spoken) || /`{3}/.test(spoken)) return null;
  if (/(?:^|[\s,{])["']?(?:reply|memory)["']?\s*:/i.test(spoken)) return null;
  if (/\b(?:system prompt|internal instructions|cadena de pensamiento)\s*:/i.test(spoken)) return null;

  return spoken.replace(/^(?:respuesta|reply)\s*:\s*/i, '').trim() || null;
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content.filter(part => part && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('\n');
  }

  return '';
}

function parseOutput(value, allowPlainText = false) {
  try {
    const structured = extractJSON(value);
    if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
      if (typeof structured.reply === 'string') assertConversationalOutput(structured.reply);
      return { output: structured, usedFallback: false };
    }

    if (allowPlainText && typeof structured === 'string') {
      const spoken = extractSpokenText(structured);
      if (spoken) return { output: { reply: spoken, memory: '' }, usedFallback: true };
    }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (allowPlainText) {
      const spoken = extractSpokenText(value);
      if (spoken) return { output: { reply: spoken, memory: '' }, usedFallback: true };
    }
    throw error;
  }

  throw new ApiError(502, 'bad_model_output', 'La respuesta generada no tiene el formato esperado.');
}

async function requestJSON(
  { system, messages, temperature = 0.8, maxTokens = 800, allowPlainText = false },
  { env = process.env, fetchFn = fetch, trace } = {}
) {
  if (!env.OPENROUTER_API_KEY) {
    throw new ApiError(503, 'missing_openrouter_key', 'Configura OPENROUTER_API_KEY.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);

  try {
    const payload = {
      model: env.OPENROUTER_MODEL || 'openrouter/free',
      messages: [{ role: 'system', content: system }, ...messages],
      temperature,
      max_tokens: maxTokens
    };

    // La identidad conserva el formato estructurado. Para modelos gratis, habilitar JSON mode
    // únicamente después de confirmar que el modelo admite response_format.
    if (env.OPENROUTER_JSON_MODE === 'true') {
      payload.response_format = { type: 'json_object' };
    }

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
      throw new ApiError(
        response.status === 429 ? 429 : 502,
        'openrouter_error',
        response.status === 429
          ? 'Se agotó temporalmente la cuota de OpenRouter.'
          : 'OpenRouter no pudo responder.'
      );
    }

    const result = await response.json();
    const choice = result.choices?.[0];
    const message = choice?.message;
    const content = normalizeMessageContent(message?.content);
    const model = typeof result.model === 'string' ? result.model : '';
    if (/(?:content[-_ ]?safety|moderation|rerank|guardrail)/i.test(model)) {
      trace?.warn?.('non_conversational_model_selected', { model: model.slice(0, 100) });
      throw new ApiError(502, 'non_conversational_model',
        'OpenRouter seleccionó un modelo de clasificación. Configura OPENROUTER_MODEL con un modelo gratuito de chat.');
    }
    assertConversationalOutput(content);
    const metadata = {
      model: typeof result.model === 'string' ? result.model.slice(0, 100) : 'unknown',
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'unknown',
      contentChars: content.length,
      hasReasoning: Boolean(message?.reasoning || message?.reasoning_details),
    };

    // Estos diagnósticos no revelan audio, transcripción, recuerdos ni respuesta.
    trace?.log?.('openrouter_completion', metadata);

    if (!content.trim()) {
      trace?.warn?.('openrouter_empty_content', metadata);
      throw new ApiError(
        502, 'empty_model_output',
        'El modelo no devolvió texto. Prueba de nuevo o cambia el modelo gratuito.'
      );
    }

    try {
      const parsed = parseOutput(content, allowPlainText);
      if (parsed.usedFallback) {
        trace?.log?.('openrouter_plain_text_fallback', {
          model: metadata.model,
          finishReason: metadata.finishReason,
          contentChars: metadata.contentChars,
        });
      }
      return parsed.output;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'bad_model_output') {
        trace?.warn?.('openrouter_invalid_format', metadata);
      }
      throw error;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(504, 'openrouter_timeout', 'OpenRouter tardó demasiado. Intenta nuevamente.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestJSON, extractJSON, extractSpokenText, parseOutput, isClassificationOutput };
