'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  makeInstructions,
  makeRealtimeInstructions,
  makePersonaInstructions,
  requestedRemember,
} = require('../src/prompt.cjs');

const context = {
  user: { name: 'Ana', language: 'es', interests: ['cine'] },
  companion: {
    name: 'Lucas', gender: 'male',
    personality: { openness: 72, extraversion: 44 },
    interests: ['astronomía'], humor: 'irónico y amable',
    communicationStyle: 'tranquilo y observador'
  },
  memories: ['Le gusta el té verde']
};

test('mantiene la identidad, el idioma y los recuerdos sin inventar', () => {
  const instructions = makePersonaInstructions(context);
  assert.match(instructions, /Lucas/);
  assert.match(instructions, /español latinoamericano natural/);
  assert.match(instructions, /té verde/);
  assert.match(instructions, /Nunca afirmes tener un cuerpo/);
});

test('suena como conversación sin repetición mecánica', () => {
  const prompt = makeInstructions(context);
  assert.match(prompt, /No termines todas las respuestas con una pregunta/);
  assert.match(prompt, /No saludes ni repitas el nombre/);
  assert.match(prompt, /Puedes disentir amablemente/);
  assert.match(prompt, /no hagas avisos tecnológicos innecesarios/i);
});

test('no se hace pasar por una persona real y responde con honestidad', () => {
  const prompt = makePersonaInstructions(context);
  assert.match(prompt, /si te preguntan quién eres, si eres humano/);
  assert.match(prompt, /responde con sinceridad/i);
});

test('prompt por turnos conserva contrato JSON', () => {
  const prompt = makeInstructions(context);
  assert.match(prompt, /JSON válido con "reply" y "memory"/);
  assert.equal(requestedRemember('Recuerda que me gusta el té verde'), true);
});

test('prompt de voz en vivo no exige JSON y prioriza interrupciones', () => {
  const prompt = makeRealtimeInstructions(context);
  assert.doesNotMatch(prompt, /Devuelve solamente un JSON válido/);
  assert.match(prompt, /Si la persona comienza a hablar mientras respondes, detente/);
  assert.match(prompt, /pausas para pensar/);
});

test('no rompe si faltan datos opcionales del perfil', () => {
  assert.doesNotThrow(() => makePersonaInstructions({
    user: {}, companion: { name: 'Luna' }, memories: []
  }));
});
