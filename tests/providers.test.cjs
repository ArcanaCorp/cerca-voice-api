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
