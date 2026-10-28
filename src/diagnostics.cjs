'use strict';
const crypto = require('node:crypto');

// Los logs nunca incluyen claves, tokens, IP, audio, transcripciones ni recuerdos.
function createTrace(area, req, res, env = process.env) {
  const id = crypto.randomUUID().slice(0, 12);
  const enabled = String(env.CERCA_DEBUG_LOGS || '').toLowerCase() === 'true';
  res.setHeader('X-CERCA-Request-ID', id);

  const output = (level, event, details = {}) => {
    const entry = { id, area, event, ...details };
    if (level === 'warn') console.warn('[CERCA-API]', JSON.stringify(entry));
    else if (enabled) console.info('[CERCA-API]', JSON.stringify(entry));
  };
  return {
    id,
    log: (event, details) => output('info', event, details),
    warn: (event, details) => output('warn', event, details),
  };
}
module.exports = { createTrace };
