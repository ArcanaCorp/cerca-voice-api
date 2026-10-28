'use strict';
const { ApiError, authorize, checkQuota } = require('./guard.cjs');
const { cleanInput, createCompanion } = require('./companion.cjs');

function makeCompanionHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchFn = dependencies.fetchFn || fetch;
  const rate = dependencies.checkQuota || checkQuota;
  const produce = dependencies.createCompanion || createCompanion;

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Método no permitido.', code: 'method_not_allowed' });
    }

    try {
      if (!env.OPENROUTER_API_KEY) {
        throw new ApiError(503, 'not_configured', 'API conversacional sin configurar.');
      }

      const raw = req.body;
      if (typeof raw === 'string' && raw.length > 5000) {
        throw new ApiError(413, 'too_large', 'Solicitud demasiado grande.');
      }

      let parsed = raw;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); }
        catch { throw new ApiError(400, 'invalid_json', 'JSON inválido.'); }
      }
      // La comprobación de cuotas es externa a los proveedores y aplica a los dos endpoints.
      const input = cleanInput(parsed);
      authorize(req, env);
      await rate(req, env, fetchFn);
      const result = await produce(input, { env, fetchFn });
      return res.status(200).json(result);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Companion error:', error?.message);
      const status = error instanceof ApiError ? error.status : 502;
      return res.status(status).json({
        error: error instanceof ApiError ? error.message : 'No pudimos crear al compañero.',
        code: error instanceof ApiError ? error.code : 'internal_error'
      });
    }
  };
}
module.exports = { makeCompanionHandler };
