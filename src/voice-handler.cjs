'use strict';
const { ApiError, parseBody, authorize, checkQuota } = require('./guard.cjs');
const { voiceTurn } = require('./voice-engine.cjs');
const { createTrace } = require('./diagnostics.cjs');

function applyCors(req, res, env) {
  const origin = req.headers?.origin;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
}
function makeHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchFn = dependencies.fetchFn || fetch;
  const produce = dependencies.voiceTurn || voiceTurn;
  const rate = dependencies.checkQuota || checkQuota;

  return async function handler(req, res) {
    const trace = createTrace('voice-turn', req, res, env);
    applyCors(req, res, env);
    trace.log('request_received', { method: req.method });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Método no permitido.', code: 'method_not_allowed' });
    }
    try {
      if (!env.OPENROUTER_API_KEY || !env.GROQ_API_KEY) throw new ApiError(503, 'not_configured', 'Faltan credenciales de OpenRouter o Groq.');
      const input = parseBody(req.body);
      trace.log('input_validated', { audioBytes: input.audio.length, historyCount: input.history.length, memoryCount: input.memories.length });
      authorize(req, env);
      trace.log('authorized');
      await rate(req, env, fetchFn, trace);
      trace.log('quota_passed');
      const result = await produce(input, { env, fetchFn, trace });
      trace.log('response_ready', { transcriptChars: result.transcript?.length || 0, replyChars: result.reply?.length || 0 });
      return res.status(200).json(result);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 502;
      trace.warn('request_failed', { status, code: error instanceof ApiError ? error.code : 'internal_error' });
      if (!(error instanceof ApiError)) console.error('[CERCA-API] Unexpected voice failure', { requestId: trace.id, errorName: error?.name });
      return res.status(status).json({
        error: error instanceof ApiError ? error.message : 'No pudimos procesar esta conversación.',
        code: error instanceof ApiError ? error.code : 'internal_error',
        requestId: trace.id
      });
    }
  };
}
module.exports = { makeHandler };
