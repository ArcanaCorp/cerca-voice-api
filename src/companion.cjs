'use strict';
const { ApiError, text } = require('./guard.cjs');
const { requestAIJSON } = require('./ai-provider.cjs');

function cleanInput(body) {
  const p = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!['male', 'female', 'random'].includes(p.preference)) {
    throw new ApiError(400, 'invalid_preference', 'Selecciona amigo, amiga o sorpréndeme.');
  }
  const user = p.user && typeof p.user === 'object' ? p.user : {};
  return {
    preference: p.preference,
    user: {
      name: text(user.name, 40) || 'la persona',
      language: user.language === 'en' ? 'en' : 'es',
      interests: Array.isArray(user.interests)
        ? user.interests.slice(0, 12).map(x => text(x, 50)).filter(Boolean)
        : []
    }
  };
}

function validatePersonality(value, choice) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(502, 'invalid_identity', 'La IA no creó una identidad válida.');
  }
  const gender = value.gender;
  if (!['male', 'female'].includes(gender) || (choice !== 'random' && gender !== choice)) {
    throw new ApiError(502, 'invalid_gender', 'La IA no respetó la elección.');
  }
  const name = text(value.name, 40);
  const humor = text(value.humor, 100);
  const communicationStyle = text(value.communicationStyle, 140);
  const interests = Array.isArray(value.interests)
    ? [...new Set(value.interests.map(x => text(x, 55)).filter(Boolean))].slice(0, 5)
    : [];
  if (!name || name.length < 2 || !humor || !communicationStyle || interests.length < 3) {
    throw new ApiError(502, 'incomplete_identity', 'La IA devolvió una identidad incompleta.');
  }
  const traits = ['openness','conscientiousness','extraversion','agreeableness','neuroticism'];
  const personality = {};
  for (const trait of traits) {
    const raw = value.personality?.[trait];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 100) {
      throw new ApiError(502, 'invalid_traits', 'Los rasgos de personalidad no son válidos.');
    }
    personality[trait] = raw;
  }
  return { name, gender, personality, interests, humor, communicationStyle };
}

async function createCompanion(input, options) {
  const chosen = cleanInput(input);
  const language = chosen.user.language === 'en' ? 'English' : 'español latinoamericano';
  const system = [
    'Eres el diseñador narrativo de CERCA, una app de amigos virtuales con IA.',
    'Genera una identidad ORIGINAL y coherente para una amistad por voz; jamás uses nombres ni intereses de listas prefijadas.',
    'Inventa nombre, aficiones, estilo de comunicación, humor y Big Five entre 0 y 100.',
    'Mantén gustos e ideas propias: no copies automáticamente los intereses del usuario.',
    'Evita estereotipos de género, dependencia posesiva, romance forzado y clichés de asistente perfecto.',
    'La identidad es de un compañero de IA, no de una persona humana que vive experiencias físicas reales.',
    'Idioma de los textos: ' + language + '.',
    'Devuelve EXCLUSIVAMENTE JSON con esta forma y claves:',
    JSON.stringify({
      name:'nombre original', gender:'male', personality:{
        openness:65, conscientiousness:55, extraversion:48, agreeableness:60, neuroticism:30
      }, interests:['afición propia 1','afición propia 2','afición propia 3'],
      humor:'descripción concreta', communicationStyle:'descripción concreta'
    }),
    'Los valores mostrados son solo formato. INVÉNTALOS desde cero.',
  ].join('\n');

  const result = await requestAIJSON({
    system,
    messages: [{ role:'user', content: JSON.stringify({
      preference: chosen.preference,
      user: chosen.user,
      genderRule: chosen.preference === 'random'
        ? 'Decide male o female creativamente.'
        : 'gender debe ser ' + chosen.preference
    }) }],
    temperature: 1,
    maxTokens: 650
  }, options);
  return validatePersonality(result, chosen.preference);
}
module.exports = { createCompanion, cleanInput, validatePersonality };
