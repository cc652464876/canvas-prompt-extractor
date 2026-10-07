'use strict';
const {resolveTheme}=require('./theme.cjs');
const {app,BrowserWindow,ipcMain,nativeTheme}=require('electron');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const WORLD=1008;
const FRAME_TIMEOUT_MS=1000,CLEANUP_TIMEOUT_MS=3000;
let feedbackGeneration=0;
const overlayFile=path.join(__dirname,'feedback','index.html');
const overlayUrl=pathToFileURL(overlayFile).href;

// Only the media guard runs in the website. The status UI is a local child
// window, ready before navigation and independent of document changes.
function guardMedia(payload){
  const key='__canvasExtractionMedia';
  let state=globalThis[key];
  // A script queued for a loading frame can execute after its extraction ends.
  // Do not let it mute a later task or let old cleanup undo a newer guard.
  const generation=payload.generation||0;
  if(!payload.active){
    globalThis.__canvasExtractionMediaFinished=Math.max(globalThis.__canvasExtractionMediaFinished||0,generation);
    if(state?.id===payload.id){state.restore();delete globalThis[key];}
    return;
  }
  if(payload.expiresAt&&Date.now()>payload.expiresAt)return;
  if(generation<=(globalThis.__canvasExtractionMediaFinished??-1)||state&&state.generation>generation)return;
  if(state&&state.id!==payload.id){state.restore();delete globalThis[key];state=null;}
  if(!state){
    if(!payload.active)return;
    state={id:payload.id,generation,media:new Map()};
    state.silence=element=>{
      if(!state.media.has(element))state.media.set(element,{volume:element.volume,muted:element.muted});
      if(element.volume!==0)element.volume=0;
      if(!element.muted)element.muted=true;
    };
    state.scan=()=>document.querySelectorAll('video,audio').forEach(state.silence);
    state.onVolume=event=>{if(event.target instanceof HTMLMediaElement)state.silence(event.target);};
    state.restore=()=>{
      state.observer.disconnect();document.removeEventListener('volumechange',state.onVolume,true);
      for(const [element,value]of state.media){element.volume=value.volume;element.muted=value.muted;}
      state.media.clear();
    };
    state.observer=new MutationObserver(state.scan);
    state.observer.observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('volumechange',state.onVolume,true);globalThis[key]=state;
  }
  if(payload.active)state.scan();else{state.restore();delete globalThis[key];}
}

function within(operation,timeoutMs){
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>finish({status:'timeout'}),timeoutMs);
    Promise.resolve().then(operation).then(value=>finish({status:'fulfilled',value}),error=>finish({status:'rejected',error}));
  });
}
function frameDetails(frame,isMain){
  const info={isMain};
  try{const url=new URL(frame.url);info.url=['http:','https:'].includes(url.protocol)?url.origin+url.pathname:url.protocol==='about:'?url.href:url.protocol;}catch{info.url='';}
  try{info.routingId=frame.routingId;info.processId=frame.processId;}catch{}
  return info;
}

class ExtractionFeedback{
  constructor(window,{theme='light',frameTimeoutMs=FRAME_TIMEOUT_MS,cleanupTimeoutMs=CLEANUP_TIMEOUT_MS,onDiagnostic=()=>{}}={}){
    this.window=window;this.wc=window.webContents;this.id=randomUUID();this.theme=resolveTheme(theme,nativeTheme.shouldUseDarkColors);
    this.previousMuted=this.wc.isAudioMuted();this.active=true;this.closed=false;this.ready=false;this.disposed=false;
    this.generation=++feedbackGeneration;this.frameTimeoutMs=frameTimeoutMs;this.cleanupTimeoutMs=cleanupTimeoutMs;this.onDiagnostic=onDiagnostic;this.diagnostics=[];
    this.heading='页面打开中';this.message='正在打开作品页面，请稍候';this.phase='running';this.counts=null;
    this.height=368;this.mediaTail=Promise.resolve();this.overlayTail=Promise.resolve();this.parentBindings=[];
    this.overlay=new BrowserWindow({parent:window,width:440,height:this.height,show:false,frame:false,transparent:true,
      backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,
      skipTaskbar:true,title:'画布提取进度',autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'feedback','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    this.overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    this.overlay.webContents.on('will-navigate',(event,url)=>{if(url!==overlayUrl)event.preventDefault();});
    this.overlay.on('close',event=>{if(!this.disposed&&!app.quitting){event.preventDefault();this.dismiss();}});
    this.onClose=event=>{if(event.sender===this.overlay.webContents&&event.senderFrame?.url===overlayUrl)this.dismiss();};
    ipcMain.on('lab:feedback-close',this.onClose);
    this.onReady=()=>{void this.updateMedia();};
    this.wc.on('dom-ready',this.onReady);this.wc.on('did-frame-finish-load',this.onReady);
    const bind=(event,listener)=>{window.on(event,listener);this.parentBindings.push([event,listener]);};
    for(const event of ['move','resize','show','restore'])bind(event,()=>{this.syncVisibility();setImmediate(()=>this.syncVisibility());});
    for(const event of ['hide','minimize'])bind(event,()=>{if(!this.overlay.isDestroyed())this.overlay.hide();});
    bind('closed',()=>{void this.dispose();});
    // Normal mouse input for the whole panel; no click-through configuration.
    this.wc.setAudioMuted(true);void this.updateMedia();
  }
  async initialize(){
    await this.overlay.loadFile(overlayFile);
    this.ready=true;await this.updateOverlay();
    await this.bounded('overlay-first-paint',()=>this.overlay.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>resolve()))'));
    this.syncVisibility();return this;
  }
  dismiss(){this.closed=true;if(!this.overlay.isDestroyed())this.overlay.hide();}
  syncBounds(){
    if(this.window.isDestroyed()||this.overlay.isDestroyed())return;
    const bounds=this.window.getContentBounds(),width=Math.max(240,Math.min(440,bounds.width-32)),height=Math.max(120,Math.min(this.height,bounds.height-32));
    this.overlay.setBounds({x:Math.round(bounds.x+(bounds.width-width)/2),y:Math.round(bounds.y+(bounds.height-height)/2),width,height});
  }
  syncVisibility(){
    if(this.disposed||this.overlay.isDestroyed()||this.window.isDestroyed())return;
    this.syncBounds();
    if(this.ready&&!this.closed&&this.window.isVisible()&&!this.window.isMinimized()){
      if(!this.overlay.isVisible())this.overlay.showInactive();
    }else this.overlay.hide();
  }
  setTheme(theme){this.theme=resolveTheme(theme,nativeTheme.shouldUseDarkColors);return this.updateOverlay();}
  set(message,phase='running',heading){this.message=message;this.phase=phase;if(heading)this.heading=heading;return this.updateOverlay();}
  diagnostic(record){
    this.diagnostics.push(record);if(this.diagnostics.length>100)this.diagnostics.shift();
    try{this.onDiagnostic(record);}catch{}
  }
  async bounded(operation,run,details={},timeoutMs=this.frameTimeoutMs){
    const result=await within(run,timeoutMs);
    if(result.status!=='fulfilled')this.diagnostic({operation,...details,status:result.status,timeoutMs,...(result.error?{error:String(result.error.message||result.error).slice(0,300)}:{})});
    return result.value;
  }
  updateOverlay(){
    if(this.disposed||!this.ready)return this.overlayTail;
    if(this.overlayBusy){this.overlayAgain=true;return this.overlayTail;}
    this.overlayBusy=true;
    this.overlayTail=this.overlayTail.catch(()=>{}).then(async()=>{
      do{
        this.overlayAgain=false;if(this.disposed||this.overlay.isDestroyed())return;
        const payload={theme:this.theme,heading:this.heading,message:this.message,phase:this.phase,active:this.active,counts:this.counts};
        const size=await this.bounded('overlay-update',()=>this.overlay.webContents.executeJavaScript('window.renderFeedback('+JSON.stringify(payload)+')'));
        if(size?.height)this.height=size.height;
        this.syncVisibility();
      }while(this.overlayAgain&&!this.disposed);
    }).finally(()=>{this.overlayBusy=false;});
    return this.overlayTail;
  }
  updateMedia(){
    if(this.disposed)return this.mediaTail;
    if(this.active&&this.mediaBusy){this.mediaAgain=true;return this.mediaTail;}
    this.mediaBusy=true;
    this.mediaTail=this.mediaTail.catch(()=>{}).then(async()=>{
      do{
        this.mediaAgain=false;if(this.disposed||this.wc.isDestroyed()||!this.wc.getURL())return;
        const payload={id:this.id,generation:this.generation,active:this.active,expiresAt:Date.now()+this.frameTimeoutMs};
        if(this.active)this.wc.setAudioMuted(true);
        const main=this.wc.mainFrame;
        await Promise.allSettled(main.framesInSubtree.map(frame=>{
          const code='('+guardMedia.toString()+')('+JSON.stringify(payload)+')';
          return this.bounded(payload.active?'media-mute':'media-restore',()=>frame===main?this.wc.executeJavaScriptInIsolatedWorld(WORLD,[{code}]):frame.executeJavaScript(code),frameDetails(frame,frame===main));
        }));
      }while(this.mediaAgain&&this.active&&!this.disposed);
    }).finally(()=>{this.mediaBusy=false;});
    return this.mediaTail;
  }
  update(){return Promise.all([this.updateOverlay(),this.updateMedia()]);}
  detachMedia(){this.wc.removeListener('dom-ready',this.onReady);this.wc.removeListener('did-frame-finish-load',this.onReady);}
  restoreAudio(){if(!this.audioRestored&&!this.wc.isDestroyed()){this.wc.setAudioMuted(this.previousMuted);this.audioRestored=true;}}
  async finish(message,phase,counts=null){
    this.active=false;this.phase=phase;this.message=message;this.counts=counts;
    this.heading=phase==='done'?'提取完毕':phase==='cancelled'?'提取已停止':'需要处理页面';this.detachMedia();
    this.restoreAudio();
    await this.bounded('finish',()=>this.update(),{},this.cleanupTimeoutMs);
  }
  async dispose(){
    if(this.disposed)return;if(this.disposePromise)return this.disposePromise;
    this.active=false;this.closed=true;this.detachMedia();
    ipcMain.removeListener('lab:feedback-close',this.onClose);
    for(const [event,listener]of this.parentBindings)this.window.removeListener(event,listener);
    this.parentBindings=[];
    this.restoreAudio();
    this.disposePromise=this.bounded('dispose',()=>this.updateMedia(),{},this.cleanupTimeoutMs).finally(()=>{
      this.disposed=true;if(!this.overlay.isDestroyed())this.overlay.destroy();
    });
    return this.disposePromise;
  }
}
module.exports={ExtractionFeedback,guardMedia};
