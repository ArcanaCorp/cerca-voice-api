'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { makeCompanionHandler }=require('../src/companion-handler.cjs');
const { createCompanion }=require('../src/companion.cjs');
function res(){
  let status=200,body;
  return {setHeader(){},status(code){status=code;return this;},json(data){body=data;return this;},get output(){return {status,body}}};
}
const identity={name:'Alma',gender:'female',
  personality:{openness:77,conscientiousness:55,extraversion:49,agreeableness:66,neuroticism:32},
  interests:['astronomía','cocina','senderismo'],humor:'ligero',communicationStyle:'espontánea'};
test('endpoint genera identidad original mediante proveedor',async()=>{
  let called=false;
  const handler=makeCompanionHandler({
    env:{OPENROUTER_API_KEY:'testing',VERCEL_ENV:'development'},
    checkQuota:async()=>{},
    createCompanion:async(input)=>{
      called=true;
      assert.equal(input.preference,'female');
      return identity;
    }
  });
  const response=res();
  await handler({method:'POST',headers:{},body:{preference:'female',user:{name:'Ana',language:'es',interests:['arte']}}},response);
  assert.equal(response.output.status,200);
  assert.equal(response.output.body.name,'Alma');
  assert.equal(called,true);
});
test('endpoint rechaza preferencias inválidas',async()=>{
  const handler=makeCompanionHandler({env:{OPENROUTER_API_KEY:'testing'},checkQuota:async()=>{}});
  const response=res();
  await handler({method:'POST',headers:{},body:{preference:'unsupported'}},response);
  assert.equal(response.output.status,400);
});
test('endpoint no consume crédito sin cuotas en producción',async()=>{
  const handler=makeCompanionHandler({env:{OPENROUTER_API_KEY:'testing',VERCEL_ENV:'production'},
    createCompanion:async()=>{throw Error('should not run');}});
  const response=res();
  await handler({method:'POST',headers:{},body:{preference:'random',user:{}}},response);
  assert.equal(response.output.status,503);
});
test('identidad IA rechaza salida incompleta',async()=>{
  const fetchFn=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"name":"Alma","gender":"female"}'}}]})});
  await assert.rejects(()=>createCompanion({preference:'female',user:{}},{env:{OPENROUTER_API_KEY:'testing'},fetchFn}),e=>e.status===502);
});
test('JSON mal formado devuelve error 400',async()=>{
  const handler=makeCompanionHandler({env:{OPENROUTER_API_KEY:'testing'},checkQuota:async()=>{}});
  const response=res();
  await handler({method:'POST',headers:{},body:'{ JSON inválido'},response);
  assert.equal(response.output.status,400);
});
