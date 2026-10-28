'use strict';
const crypto = require('node:crypto');

const MAX_AUDIO_BYTES = 2_500_000;
const MAX_BODY_CHARS = 3_450_000;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function boundedArray(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}
function jsonBody(raw) {
  if (typeof raw === 'string') {
    if (raw.length > MAX_BODY_CHARS) throw new ApiError(413, 'payload_too_large', 'Audio demasiado grande.');
    try { return JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_json', 'JSON inválido.'); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'invalid_json', 'Se esperaba un objeto JSON.');
  return raw;
}
function parseBody(raw) {
  const p = jsonBody(raw);
  if (p.mimeType !== 'audio/mp4') throw new ApiError(415, 'audio_format', 'Solo audio/mp4 (M4A) está habilitado.');
  if (typeof p.audio !== 'string') throw new ApiError(400, 'missing_audio', 'Falta el audio.');
  if (p.audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) throw new ApiError(413, 'audio_too_large', 'Audio demasiado grande.');
  if (p.audio.length < 32 || p.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.audio)) {
    throw new ApiError(400, 'invalid_audio', 'El audio no tiene base64 válido.');
  }
  const audio = Buffer.from(p.audio, 'base64');
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new ApiError(413, 'audio_too_large', 'Audio demasiado grande.');

  const user = p.user && typeof p.user === 'object' ? p.user : {};
  const companion = p.companion && typeof p.companion === 'object' ? p.companion : {};
  const name = text(companion.name, 40);
  if (!name) throw new ApiError(400, 'missing_companion', 'Falta la identidad del compañero.');

  return {
    audio,
    user: {
      name: text(user.name, 40) || 'la persona',
      language: user.language === 'en' ? 'en' : 'es',
      interests: boundedArray(user.interests, 12).map(v => text(v, 50)).filter(Boolean)
    },
    companion: {
      name,
      gender: text(companion.gender, 25),
      personality: {
        openness: clampScore(companion.personality?.openness),
        conscientiousness: clampScore(companion.personality?.conscientiousness),
        extraversion: clampScore(companion.personality?.extraversion),
        agreeableness: clampScore(companion.personality?.agreeableness),
        neuroticism: clampScore(companion.personality?.neuroticism)
      },
      interests: boundedArray(companion.interests, 12).map(v => text(v, 50)).filter(Boolean),
      humor: text(companion.humor, 60),
      communicationStyle: text(companion.communicationStyle, 100)
    },
    history: boundedArray(p.history, 12)
      .filter(x => x && (x.role === 'user' || x.role === 'assistant'))
      .map(x => ({ role: x.role, content: text(x.content, 700) }))
      .filter(x => x.content),
    memories: boundedArray(p.memories, 25).map(v => text(v, 220)).filter(Boolean)
  };
}
function clampScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 50;
}
function clientIp(req) {
  // Vercel/Proxy suministra esta cabecera; no es una identidad autenticada.
  const forwarded = req.headers?.['x-forwarded-for'];
  return text(Array.isArray(forwarded) ? forwarded[0] : forwarded, 100).split(',')[0] || 'unknown';
}
function authorize(req, env = process.env) {
  const token = env.API_ACCESS_TOKEN;
  if (!token) return;
  const header = req.headers?.authorization;
  const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const left = Buffer.from(token);
  const right = Buffer.from(provided);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new ApiError(401, 'unauthorized', 'Acceso no autorizado.');
  }
}
async function checkQuota(req, env = process.env, fetchFn = fetch) {
  const base = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    // No publicar un proxy anónimo con OPENAI_API_KEY sin un limitador persistente.
    if (env.VERCEL_ENV === 'production' && !env.API_ACCESS_TOKEN) {
      throw new ApiError(503, 'quota_not_configured', 'Aún no se configuró la protección contra abuso.');
    }
    return;
  }
  const keyHash = crypto.createHash('sha256').update(`${env.RATE_LIMIT_SALT || ''}:${clientIp(req)}`).digest('hex').slice(0, 28);
  const perMinute = Math.max(1, Math.min(60, Number(env.REQUESTS_PER_MINUTE) || 10));
  const perDay = Math.max(1, Math.min(100000, Number(env.DAILY_REQUESTS_LIMIT) || 1000));
  const day = new Date().toISOString().slice(0, 10);
  const commands = [
    ['INCR', `cerca:minute:${keyHash}`],
    ['EXPIRE', `cerca:minute:${keyHash}`, 60],
    ['INCR', `cerca:day:${day}`],
    ['EXPIRE', `cerca:day:${day}`, 86400]
  ];
  let response;
  try {
    response = await fetchFn(`${base.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(5000)
    });
  } catch { throw new ApiError(503, 'rate_limit_unavailable', 'Protección temporalmente no disponible.'); }
  if (!response.ok) throw new ApiError(503, 'rate_limit_unavailable', 'Protección temporalmente no disponible.');
  const rows = await response.json();
  const minute = Number(rows?.[0]?.result);
  const daily = Number(rows?.[2]?.result);
  if (!Number.isFinite(minute) || !Number.isFinite(daily)) throw new ApiError(503, 'rate_limit_unavailable', 'Protección temporalmente no disponible.');
  if (minute > perMinute || daily > perDay) throw new ApiError(429, 'rate_limited', 'Se alcanzó el límite de uso. Intenta más tarde.');
}
module.exports = { ApiError, parseBody, authorize, checkQuota, text };
