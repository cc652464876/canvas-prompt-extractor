'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {DownloadQueue}=require('../src/download-queue.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const png=Buffer.alloc(64);png.set([137,80,78,71,13,10,26,10]);
function asset(id){return{id,kind:'image',name:id,url:'https://cdn.example.com/'+id+'.png',fileName:id+'.png',state:'pending',bytes:0,total:0};}
async function directory(t){const root=path.resolve(__dirname,'../validation');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'test-scheduler-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function image(delay=0){return new Response(new ReadableStream({async start(c){await sleep(delay);c.enqueue(png);c.close();}}),{headers:{'content-type':'image/png','content-length':String(png.length)}});}

test('Backoff frees the worker; due retries join the FIFO tail without changing original order',async t=>{
  const dir=await directory(t),items=['A','B','C','D'].map(asset),calls=[];let failed=false;
  const q=new DownloadQueue({concurrency:1,interval:0,retryDelays:[15],filePath:a=>path.join(dir,a.fileName),fetcher:async url=>{
    const id=path.basename(new URL(url).pathname,'.png');calls.push(id);
    if(id==='A'&&!failed){failed=true;throw new Error('Temporary transport failure');}
    return image(id==='B'?40:0);
  }});
  const result=await q.start(items,['image']);
  assert.deepEqual(calls,['A','B','C','D','A']);assert.equal(result.done,4);assert.equal(result.active,false);
});

test('Two failures do not occupy the pool during backoff or create a third download position',async t=>{
  const dir=await directory(t),items=['A','B','C','D'].map(asset),calls=[],counts=new Map();let peak=0;
  const q=new DownloadQueue({interval:0,retryDelays:[120],filePath:a=>path.join(dir,a.fileName),onProgress:s=>{peak=Math.max(peak,s.running);},fetcher:async url=>{
    const id=path.basename(new URL(url).pathname,'.png'),attempt=(counts.get(id)||0)+1;counts.set(id,attempt);calls.push(id);
    if(['A','B'].includes(id)&&attempt===1)throw new Error('Temporary transport failure');
    return image(45);
  }});
  await q.start(items,['image']);
  assert.deepEqual(calls.slice(0,4),['A','B','C','D']);assert.equal(peak,2);assert.ok(items.every(a=>a.state==='done'));
});

test('Delayed retries keep the task active, obey both backoffs and stop after the third failure',async t=>{
  const dir=await directory(t),item=asset('A'),attempts=[];let sawIdleActive=false;
  const q=new DownloadQueue({interval:0,retryDelays:[30,60],filePath:a=>path.join(dir,a.fileName),onProgress:s=>{if(s.active&&s.running===0&&s.files.some(a=>a.error?.startsWith('等待重试')))sawIdleActive=true;},fetcher:async()=>{attempts.push(Date.now());throw new Error('Transport failure');}});
  const result=await q.start([item],['image']);
  assert.equal(attempts.length,3);assert.ok(attempts[1]-attempts[0]>=30);assert.ok(attempts[2]-attempts[1]>=60);assert.ok(sawIdleActive);
  assert.equal(result.active,false);assert.equal(result.failed,1);assert.equal(result.running,0);assert.deepEqual(await fs.readdir(dir),[]);
});

test('Cancel during backoff discards scheduled retries and returns without waiting for the delay',async t=>{
  const dir=await directory(t),item=asset('A');let calls=0;
  const q=new DownloadQueue({interval:0,retryDelays:[1000],filePath:a=>path.join(dir,a.fileName),fetcher:async()=>{calls++;throw new Error('Transport failure');},onProgress:s=>{if(s.active&&s.running===0&&s.files.some(a=>a.error?.startsWith('等待重试')))q.cancel();}});
  const started=Date.now();await q.start([item],['image']);
  assert.ok(Date.now()-started<500);assert.equal(calls,1);assert.equal(item.state,'pending');assert.equal(q.active,false);
  await sleep(40);assert.equal(calls,1);
});

test('Pause prevents a due retry; resume preserves the attempt budget and processes it',async t=>{
  const dir=await directory(t),item=asset('A');let calls=0,paused=false;
  const q=new DownloadQueue({interval:0,retryDelays:[20],filePath:a=>path.join(dir,a.fileName),fetcher:async()=>{calls++;if(calls===1)throw new Error('Transport failure');return image();},onProgress:s=>{
    if(!paused&&s.active&&s.running===0&&s.files.some(a=>a.error?.startsWith('等待重试'))){paused=true;q.pause();}
  }});
  t.after(()=>q.cancel());
  const task=q.start([item],['image']);await sleep(70);assert.equal(calls,1);assert.equal(q.active,true);
  q.resume();await task;assert.equal(calls,2);assert.equal(item.state,'done');
});

test('HTTP 429 still blocks all new requests for Retry-After, including fresh FIFO items',async t=>{
  const dir=await directory(t),calls=[],items=['A','B'].map(asset);
  const q=new DownloadQueue({concurrency:1,interval:0,retryDelays:[1],filePath:a=>path.join(dir,a.fileName),fetcher:async url=>{
    const id=path.basename(new URL(url).pathname,'.png');calls.push({id,time:Date.now()});
    if(calls.length===1)return new Response('',{status:429,headers:{'Retry-After':'0.05'}});
    return image();
  }});
  await q.start(items,['image']);assert.deepEqual(calls.map(c=>c.id),['A','B','A']);assert.ok(calls[1].time-calls[0].time>=50);
});

test('Partial failed data is removed; retry requests the whole file and saves only complete bytes',async t=>{
  const dir=await directory(t),item=asset('A');let calls=0;
  const q=new DownloadQueue({interval:0,retryDelays:[10],filePath:a=>path.join(dir,a.fileName),fetcher:async(_url,options)=>{
    assert.equal(options.headers?.Range,undefined);calls++;
    if(calls===1){let sent=false;return new Response(new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(png);}else c.error(new Error('Interrupted body'));}}),{headers:{'content-type':'image/png','content-length':'128'}});}
    assert.deepEqual(await fs.readdir(dir),[]);return image();
  }});
  await q.start([item],['image']);assert.equal(calls,2);assert.equal(item.state,'done');assert.deepEqual(await fs.readFile(path.join(dir,item.fileName)),png);assert.deepEqual(await fs.readdir(dir),['A.png']);
});

test('Permission failure with no remaining work ends the pool rather than hanging on its pause',{timeout:2000},async t=>{
  const dir=await directory(t),item=asset('A');let calls=0;
  const q=new DownloadQueue({interval:0,filePath:a=>path.join(dir,a.fileName),fetcher:async()=>{calls++;return new Response('',{status:403});}});
  t.after(()=>q.cancel());
  await q.start([item],['image']);assert.equal(calls,1);assert.equal(item.state,'failed');assert.equal(q.active,false);
});
