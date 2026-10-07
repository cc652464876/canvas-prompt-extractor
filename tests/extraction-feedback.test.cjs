'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),Module=require('node:module');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture({framePending=false,overlayPending=false,muted=false}={}){
 const frame={url:'about:blank',routingId:2,processId:1,executeJavaScript:()=>framePending?new Promise(()=>{}):Promise.resolve()};
 const main={url:'https://fixture.invalid/canvas?token=secret',routingId:1,processId:1,framesInSubtree:[]};main.framesInSubtree=[main,frame];
 const wc=Object.assign(new EventEmitter(),{mainFrame:main,muted,isAudioMuted(){return this.muted;},setAudioMuted(value){this.muted=value;},isDestroyed:()=>false,getURL:()=>main.url,executeJavaScriptInIsolatedWorld:()=>Promise.resolve()});
 const window=Object.assign(new EventEmitter(),{webContents:wc,isDestroyed:()=>false,getContentBounds:()=>({x:0,y:0,width:900,height:700}),isVisible:()=>false,isMinimized:()=>false});
 let destroyed=false;
 class Overlay extends EventEmitter{
   constructor(){super();this.webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler(){},executeJavaScript:()=>overlayPending?new Promise(()=>{}):Promise.resolve({height:300})});}
   isDestroyed(){return destroyed;}destroy(){destroyed=true;}hide(){}setBounds(){}loadFile(){return Promise.resolve();}
 }
 const ipcMain=new EventEmitter(),electron={app:{quitting:false},BrowserWindow:Overlay,ipcMain,nativeTheme:{shouldUseDarkColors:false}};
 const file=path.resolve(__dirname,'../src/extraction-feedback.cjs'),loaded=new Module(file,module),realRequire=Module.createRequire(file);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));loaded.require=name=>name==='electron'?electron:realRequire(name);loaded._compile(fs.readFileSync(file,'utf8'),file);
 return {window,wc,frame,main,ipcMain,...loaded.exports,overlayDestroyed:()=>destroyed};
}
test('A pending frame cannot block finish, dispose, subsequent extraction or listener cleanup',async()=>{
 const f=fixture({framePending:true}),feedback=new f.ExtractionFeedback(f.window,{frameTimeoutMs:30,cleanupTimeoutMs:150});
 await feedback.initialize();for(let i=0;i<40;i++)feedback.updateMedia();
 const start=Date.now(),ending=feedback.finish('done','done');assert.equal(f.wc.isAudioMuted(),false,'Native mute must be restored before awaiting frames');
 await ending;assert.ok(Date.now()-start<500);assert.ok(feedback.diagnostics.some(d=>d.status==='timeout'&&d.isMain===false&&d.url==='about:blank'));
 await feedback.dispose();assert.equal(f.overlayDestroyed(),true);assert.equal(f.ipcMain.listenerCount('lab:feedback-close'),0);assert.equal(f.wc.listenerCount('dom-ready'),0);
 const next=new f.ExtractionFeedback(f.window,{frameTimeoutMs:30,cleanupTimeoutMs:150});await next.finish('stopped','cancelled');await next.dispose();assert.equal(f.wc.isAudioMuted(),false);
});
test('Frozen local overlay and an already stalled media queue still obey the total cleanup deadline',async()=>{
 const f=fixture({overlayPending:true,muted:true}),feedback=new f.ExtractionFeedback(f.window,{frameTimeoutMs:30,cleanupTimeoutMs:80});
 feedback.ready=true;feedback.mediaTail=new Promise(()=>{});
 const start=Date.now();await feedback.finish('network error','error');assert.ok(Date.now()-start<500);assert.equal(f.wc.isAudioMuted(),true,'Preserve pre-existing platform mute');assert.ok(feedback.diagnostics.some(d=>d.operation==='finish'&&d.status==='timeout'));
 await Promise.all([feedback.dispose(),feedback.dispose()]);assert.equal(f.overlayDestroyed(),true);assert.equal(f.ipcMain.listenerCount('lab:feedback-close'),0);await wait(35);
});
test('A request issued to a frame before navigation cannot hold cleanup after that frame is disposed',async()=>{
 const f=fixture({framePending:true}),feedback=new f.ExtractionFeedback(f.window,{frameTimeoutMs:35,cleanupTimeoutMs:150});
 await wait(5);f.main.framesInSubtree=[f.main];
 Object.defineProperty(f.frame,'url',{get(){throw new Error('Render frame was disposed');}});
 const start=Date.now();await feedback.finish('done','done');assert.ok(Date.now()-start<500);assert.equal(f.wc.isAudioMuted(),false);assert.ok(feedback.diagnostics.some(d=>d.operation==='media-mute'&&d.url==='about:blank'&&d.status==='timeout'));
 await feedback.dispose();assert.equal(f.overlayDestroyed(),true);
});
test('Expired or superseded mute scripts cannot re-mute a finished or newer extraction',()=>{
 const {guardMedia}=fixture(),element={volume:.6,muted:false};let observed;
 const context=vm.createContext({Date,HTMLMediaElement:class{},document:{documentElement:{},querySelectorAll:()=>[element],addEventListener(){},removeEventListener(){}},MutationObserver:class{constructor(fn){observed=fn;}observe(){}disconnect(){}}});
 const run=payload=>vm.runInContext('('+guardMedia.toString()+')('+JSON.stringify(payload)+')',context);
 run({id:'old',generation:1,active:true,expiresAt:Date.now()+1000});assert.equal(element.volume,0);
 run({id:'old',generation:1,active:false});assert.equal(element.volume,.6);assert.equal(element.muted,false);
 run({id:'old',generation:1,active:true,expiresAt:Date.now()+1000});assert.equal(element.volume,.6,'Completed generation must stay cancelled');
 run({id:'new',generation:2,active:true,expiresAt:Date.now()+1000});assert.equal(element.volume,0);
 run({id:'old',generation:1,active:false});assert.equal(element.volume,0,'Old cleanup must not restore a newer guard');
 run({id:'new',generation:2,active:false});assert.equal(element.volume,.6);
 run({id:'late',generation:3,active:true,expiresAt:Date.now()-1000});assert.equal(element.volume,.6);assert.equal(typeof observed,'function');
});
