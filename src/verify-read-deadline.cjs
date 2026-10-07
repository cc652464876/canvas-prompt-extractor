'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({root,ui,runExtraction,getWindow,getFeedback,session})=>{
  const checks=[];let canvas=false,pending=0;
  const nodes=[{id:'text1',type:'text',data:{name:'期限回归',text:'本地画布提示词'}}];
  session.fromPartition('persist:liblib').protocol.handle('https',request=>{
    if(request.url.includes('/pending')){pending++;return new Promise(()=>{});}
    const script=canvas?'<div class="react-flow" id="flow"></div><script>flow.__reactFiber$fixture={memoizedProps:'+JSON.stringify({nodes,edges:[]})+'};</script>':'';
    return new Response('<!doctype html><meta charset="utf-8"><h1>Read deadline fixture</h1>'+script+'<iframe src="https://www.liblib.tv/pending"></iframe>',{headers:{'content-type':'text/html; charset=utf-8'}});
  });
  const read=async(label,options)=>{const start=Date.now();try{const result=await runExtraction('https://www.liblib.tv/detail/'+label,{mode:'full',...options});return {result,elapsedMs:Date.now()-start};}catch(e){return {error:e.message,elapsedMs:Date.now()-start};}};
  const timeout=await read('timeout',{timeout:500});assert.ok(timeout.error);assert.ok(timeout.elapsedMs<4500,JSON.stringify(timeout));assert.equal(getWindow().webContents.isAudioMuted(),false);checks.push({name:'Pending iframe cannot hold automatic read timeout or audio restoration',...timeout});
  canvas=true;const success=await read('success',{timeout:3500});assert.ok(success.result,JSON.stringify(success));assert.equal(success.result.entries.length,1);assert.equal(getWindow().webContents.isAudioMuted(),false);assert.ok(success.elapsedMs<7000);checks.push({name:'DOM-ready canvas extracts successfully while an iframe is still loading',elapsedMs:success.elapsedMs,entries:success.result.entries.length});
  canvas=false;let settled=false;const reading=read('cancel',{timeout:15000}).then(r=>{settled=true;return r;});
  for(let i=0;i<100;i++){if(getFeedback()?.active&&getWindow().webContents.getURL().includes('cancel'))break;await wait(20);}
  assert.equal(settled,false);const response=await ui.webContents.executeJavaScript('window.lab.cancel()');assert.equal(response.ok,true);const cancelled=await reading;assert.match(cancelled.error,/取消/);assert.ok(cancelled.elapsedMs<4500);assert.equal(getWindow().webContents.isAudioMuted(),false);checks.push({name:'Actual cancel IPC aborts page waiting and releases the read task',...cancelled});
  canvas=true;const again=await read('after-cancel',{timeout:3500});assert.ok(again.result);checks.push({name:'A fresh extraction succeeds after timeout and cancellation',entries:again.result.entries.length});
  assert.ok(pending>=4);await getFeedback().dispose();assert.equal(getFeedback().overlay.isDestroyed(),true);
  await fs.mkdir(path.join(root,'validation'),{recursive:true});await fs.writeFile(path.join(root,'validation/read-deadline-report.json'),JSON.stringify({passed:true,checks,pendingIframeRequests:pending,transport:'Isolated profile; local HTTPS interception; iframe responses intentionally never finish'},null,2));console.log('PASS read deadlines: '+JSON.stringify(checks));
};
