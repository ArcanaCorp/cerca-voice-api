'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceTurn } = require('../src/voice-engine.cjs');
const { requestJSON, extractJSON } = require('../src/openrouter.cjs');
const { validatePersonality } = require('../src/companion.cjs');

const input = () => ({
  audio: Buffer.alloc(300,1),
  user: { name: 'Ana', language:'es', interests:['música'] },
  companion: { name:'Nico', gender:'male', humor:'sarcástico suave', communicationStyle:'directo', interests:['cine'], personality:{} },
  memories: ['Le gusta el té verde'],
  history: [{ role:'assistant', content:'Hola' }]
});
const env = { OPENROUTER_API_KEY: 'test-only', GROQ_API_KEY:'test-only' };
function fakeFetch(transcript) {
  const calls=[];
  const fetchFn=async(url,opts)=>{
    calls.push({url,opts});
    if(url.includes('groq.com')) {
      assert.equal(opts.body.get('model'), 'whisper-large-v3-turbo');
      return {ok:true,json:async()=>({text:transcript})};
    }
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
      reply:'¡Qué bien, cuéntame más!', memory:'Le gusta el té verde'
    })}}]})};
  };
  return {calls,fetchFn};
}
test('Groq transcribe y OpenRouter responde con el contrato CERCA',async()=>{
  const {calls,fetchFn}=fakeFetch('Recuerda que me gusta el té verde');
  const result=await voiceTurn(input(),{env,fetchFn});
  assert.deepEqual(result,{transcript:'Recuerda que me gusta el té verde',reply:'¡Qué bien, cuéntame más!',memory:'Le gusta el té verde'});
  assert.equal(calls.length,2);
  assert.ok(calls[0].url.includes('groq.com'));
  assert.ok(calls[1].url.includes('openrouter.ai'));
  const request=JSON.parse(calls[1].opts.body);
  assert.equal(request.model,'openrouter/free');
  assert.ok(request.messages[0].content.includes('Nico'));
  assert.equal(request.messages.at(-1).content,'Recuerda que me gusta el té verde');
});
test('No memoriza si no se pidió recordar',async()=>{
  const {fetchFn}=fakeFetch('Hola, ¿qué tal?');
  const result=await voiceTurn(input(),{env,fetchFn});
  assert.equal(result.memory,'');
});
test('Error del proveedor no expone datos externos',async()=>{
  const fetchFn=async()=>({ok:false,status:500,json:async()=>({secret:'never leak'})});
  await assert.rejects(()=>voiceTurn(input(),{env,fetchFn}),error=>{
    assert.equal(error.status,502);
    assert.ok(!error.message.includes('never leak'));
    return true;
  });
});
test('Parseo seguro de respuesta JSON entre bloques',()=>{
  assert.deepEqual(extractJSON('Texto previo: {"reply":"hola","memory":""}'),{reply:'hola',memory:''});
  assert.deepEqual(extractJSON('JSON: {"reply":"hola","memory":""} final'),{reply:'hola',memory:''});
});
test('OpenRouter no fuerza JSON mode en free-tier',async()=>{
  const fetchFn=async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(body.response_format,undefined);
    return {ok:true,json:async()=>({choices:[{message:{content:'{"reply":"hola","memory":""}'}}]})};
  };
  const result=await requestJSON({system:'Prueba',messages:[{role:'user',content:'hola'}]},{env,fetchFn});
  assert.equal(result.reply,'hola');
});
test('Identidad de compañero rechaza género opuesto',()=>{
  const object={name:'Nico',gender:'male',personality:{
    openness:60,conscientiousness:55,extraversion:45,agreeableness:72,neuroticism:22
  },interests:['cine','música','arte'],humor:'juguetón',communicationStyle:'relajado'};
  assert.equal(validatePersonality(object,'male').name,'Nico');
  assert.throws(()=>validatePersonality(object,'female'),e=>e.status===502);
});

test('acepta texto natural del modelo gratuito solo en modo conversación', async () => {
  const events = [];
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      model: 'free-test-model',
      choices: [{
        finish_reason: 'stop',
        message: { content: 'Uy, qué buena historia. ¿Y qué pasó después?' }
      }]
    })
  });
  const options = {
    env,
    fetchFn,
    trace: {
      log: (event, data) => events.push({ event, data }),
      warn: (event, data) => events.push({ event, data })
    }
  };
  const result = await requestJSON({
    system: 'Eres Nico',
    messages: [{ role: 'user', content: 'Hola' }],
    allowPlainText: true
  }, options);

  assert.deepEqual(result, {
    reply: 'Uy, qué buena historia. ¿Y qué pasó después?',
    memory: ''
  });
  assert.ok(events.some(({ event }) => event === 'openrouter_plain_text_fallback'));
  assert.equal(events.find(({ event }) => event === 'openrouter_completion').data.contentChars > 0, true);

  await assert.rejects(() => requestJSON({
    system: 'Crea una identidad',
    messages: [{ role: 'user', content: 'Amiga' }]
  }, options), error => error.code === 'bad_model_output');
});

test('normaliza partes de texto del proveedor', async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: [
            { type: 'text', text: '{"reply":"¡Hola, aquí estoy!","memory":""}' }
          ]
        }
      }]
    })
  });
  const result = await requestJSON({
    system: 'CERCA',
    messages: [],
    allowPlainText: true
  }, { env, fetchFn });
  assert.equal(result.reply, '¡Hola, aquí estoy!');
});

test('rechaza JSON truncado en lugar de leer una estructura rota', async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        finish_reason: 'length',
        message: { content: '{"reply":"hola","memory":' }
      }]
    })
  });
  await assert.rejects(() => requestJSON({
    system: 'CERCA',
    messages: [],
    allowPlainText: true
  }, { env, fetchFn }), error => error.code === 'bad_model_output');
});

test('identifica salida vacía de un modelo razonador sin revelar su contenido', async () => {
  const events = [];
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      model: 'reasoner-free',
      choices: [{
        finish_reason: 'length',
        message: { content: null, reasoning: 'texto interno no debe registrarse' }
      }]
    })
  });
  await assert.rejects(() => requestJSON({
    system: 'CERCA',
    messages: [],
    allowPlainText: true
  }, {
    env,
    fetchFn,
    trace: { log: (event, data) => events.push([event, data]), warn: (event, data) => events.push([event, data]) }
  }), error => error.code === 'empty_model_output');

  const debug = JSON.stringify(events);
  assert.ok(debug.includes('hasReasoning'));
  assert.equal(debug.includes('texto interno'), false);
});

test('puede responder en formato JSON aunque el modo texto natural esté habilitado', async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        finish_reason: 'stop',
        message: { content: '{"reply":"Claro, cuéntame.","memory":"Le gusta el té"}' }
      }]
    })
  });
  const result = await requestJSON({
    system: 'CERCA',
    messages: [],
    allowPlainText: true
  }, { env, fetchFn });
  assert.equal(result.reply, 'Claro, cuéntame.');
  assert.equal(result.memory, 'Le gusta el té');
});

test('rechaza etiquetas de seguridad del router gratis', async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      choices: [{message:{content:'User Safety: safe\\nResponse Safety: safe'}}]
    })
  });
  await assert.rejects(
    () => requestJSON({system:'CERCA',messages:[],allowPlainText:true},{env,fetchFn}),
    e => e.code === 'non_conversational_model'
  );
});
