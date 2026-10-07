'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {getEventListeners}=require('node:events');
const {boundedRead}=require('../src/read-deadline.cjs');
test('A nonresponding operation cannot exceed the whole-read deadline',async()=>{
  const start=Date.now();await assert.rejects(boundedRead(()=>new Promise(()=>{}),{timeoutMs:1000,deadline:Date.now()+40}),{code:'READ_DEADLINE'});assert.ok(Date.now()-start<500);
});
test('Cancellation releases a hung read and listeners; a late failure is consumed',async()=>{
  const controller=new AbortController();let fail;
  const reading=boundedRead(()=>new Promise((_resolve,reject)=>{fail=reject;}),{signal:controller.signal,timeoutMs:1000});
  await Promise.resolve();controller.abort();await assert.rejects(reading,{code:'READ_CANCELLED'});assert.equal(getEventListeners(controller.signal,'abort').length,0);fail(new Error('late navigation failure'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await boundedRead(()=>Promise.resolve('next read')),'next read');
});
test('An expired or cancelled request never executes its page operation',async()=>{
  let calls=0;const operation=()=>{calls++;};const controller=new AbortController();controller.abort();
  await assert.rejects(boundedRead(operation,{signal:controller.signal}),{code:'READ_CANCELLED'});await assert.rejects(boundedRead(operation,{deadline:Date.now()-1}),{code:'READ_DEADLINE'});assert.equal(calls,0);
});
