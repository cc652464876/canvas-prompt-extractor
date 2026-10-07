'use strict';
const path=require('node:path'),root=path.resolve(__dirname,'..');
if(!process.versions.electron){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=require('node:child_process').spawn(path.resolve(root,'../node_modules/electron/dist/electron.exe'),[__filename],{env,windowsHide:true,stdio:'inherit'});
 child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
}else{
 const {app,BrowserWindow,ipcMain}=require('electron');
 const fs=require('node:fs/promises'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
 const {ExtractionFeedback}=require('../src/extraction-feedback.cjs');
 app.setPath('userData',path.join(os.tmpdir(),'canvas-cleanup-'+process.pid));
 app.whenReady().then(async()=>{
   const sockets=new Set(),server=http.createServer((request,response)=>{if(request.url==='/never')return;response.setHeader('content-type','text/html');response.end('<!doctype html><title>Pending iframe cleanup</title><iframe src="/never"></iframe>');});
   server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true}}),checks=[];
   const listeners=ipcMain.listenerCount('lab:feedback-close');
   try{
     const ready=new Promise(resolve=>win.webContents.once('dom-ready',resolve));win.loadURL('http://127.0.0.1:'+server.address().port).catch(()=>{});await ready;
     for(const phase of ['done','cancelled','error']){
       const previousMuted=phase==='error';win.webContents.setAudioMuted(previousMuted);
       const feedback=new ExtractionFeedback(win);await feedback.initialize();
       for(let i=0;i<50;i++)void feedback.updateMedia();
       const start=Date.now(),ending=feedback.finish('读取已结束',phase,phase==='done'?{nodes:1,prompts:1,assets:0}:null);
       assert.equal(win.webContents.isAudioMuted(),previousMuted,'Restore native audio before waiting on frames');
       await ending;const finishMs=Date.now()-start;assert.ok(finishMs<3300,'Finish exceeds total cleanup deadline');
       const disposeStart=Date.now();await Promise.all([feedback.dispose(),feedback.dispose()]);const disposeMs=Date.now()-disposeStart;
       assert.ok(disposeMs<3300);assert.equal(feedback.overlay.isDestroyed(),true);assert.equal(ipcMain.listenerCount('lab:feedback-close'),listeners);assert.equal(win.webContents.listenerCount('dom-ready'),0);
       assert.ok(feedback.diagnostics.some(d=>d.status==='timeout'),'Pending iframe must be recorded');
       checks.push({phase,finishMs,disposeMs,restoredOriginalMute:win.webContents.isAudioMuted()===previousMuted,diagnostics:feedback.diagnostics});
       console.log('PASS '+phase+': pending iframe does not prevent cleanup, audio restore or next extraction');
     }
     await fs.mkdir(path.join(root,'validation'),{recursive:true});await fs.writeFile(path.join(root,'validation/extraction-cleanup-report.json'),JSON.stringify({passed:true,frameTimeoutMs:1000,cleanupTimeoutMs:3000,checks,fixture:'Local HTTP with a never-returning iframe; isolated profile; no platform/account changes'},null,2));
   }finally{win.destroy();for(const socket of sockets)socket.destroy();server.close();}
   app.exit(0);
 }).catch(error=>{console.error(error.stack);app.exit(1);});
}
