'use strict';
const { ApiError, authorize, checkQuota } = require('./guard.cjs');

const DEFAULT_MODEL = 'gemini-3.8-live';
const LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

function configuredModel(env) {
  const model = env.GEMINI_LIVE_MODEL || DEFAULT_MODEL;
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(model)) {
    throw new ApiError(503, 'model_invalid', 'Modelo Live inválido.');
  }
  return model;
}

async function mintLiveToken(env, fetchFn) {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, 'gemini_not_configured', 'Gemini Live no está configurado.');
  }
  const model = configuredModel(env);
  const now = Date.now();

  // Tokens de un solo uso; 60 s para conectar, 10 min máximo de sesión.
  const payload = {
    uses: 1,
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
    expireTime: new Date(now + 10 * 60_000).toISOString(),
    liveConnectConstraints: {
      model: 'models/' + model,
      config: { responseModalities: ['AUDIO'] }
    }
  };

  let response;
  try {
    response = await fetchFn('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new ApiError(503, 'gemini_unavailable', 'No se pudo abrir Gemini Live.');
  }

  if (!response.ok) {
    throw new ApiError(response.status === 429 ? 429 : 503, 'gemini_unavailable',
      response.status === 429 ? 'Cuota de Gemini Live agotada.' : 'Gemini Live no está disponible.');
  }

  const data = await response.json().catch(() => ({}));
  if (!data?.name || typeof data.name !== 'string') {
    throw new ApiError(502, 'invalid_token', 'Gemini no devolvió una sesión válida.');
  }
  return {
    token: data.name,
    model,
    websocketUrl: LIVE_ENDPOINT,
    expiresAt: payload.expireTime
  };
}

function makeLiveSessionHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchFn = dependencies.fetchFn || fetch;
  const rate = dependencies.checkQuota || checkQuota;
  const mint = dependencies.mintLiveToken || mintLiveToken;

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Método no permitido.', code: 'method_not_allowed' });
    }
    try {
      authorize(req, env);
      // El token no debe emitirse antes de verificar cuota.
      await rate(req, env, fetchFn);
      const result = await mint(env, fetchFn);
      return res.status(200).json(result);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Gemini Live token request failed:', error?.name);
      return res.status(error instanceof ApiError ? error.status : 503).json({
        error: error instanceof ApiError ? error.message : 'No se pudo iniciar Gemini Live.',
        code: error instanceof ApiError ? error.code : 'internal_error'
      });
    }
  };
}
module.exports = { makeLiveSessionHandler, mintLiveToken, configuredModel };
