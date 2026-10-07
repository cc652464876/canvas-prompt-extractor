'use strict';
const HOME_URLS={liblib:'https://www.liblib.tv/',jimeng:'https://jimeng.jianying.com/ai-tool/home'};

// Keep authentication checks independent of the active extraction window.
// Only live page evidence is retained in memory; credentials stay in Electron's
// existing persistent sessions, and an unconfirmed session is never called signed in.
class AccountManager {
  constructor({createWindow,inspect,onChange=()=>{},blocked=()=>false,checkTimeout=2000,loadingTimeout=15000,pollInterval=2000}) {
    Object.assign(this,{createWindow,inspect,onChange,blocked,checkTimeout,loadingTimeout,pollInterval});
    this.entries=new Map();this.disposed=false;
  }
  snapshot(platform) {return {...(this.entries.get(platform)?.info||{platform,state:'unknown',checking:false,label:'点击打开平台登录'})};}
  snapshots() {return Object.keys(HOME_URLS).map(platform=>this.snapshot(platform));}
  existing(platform) {const win=this.entries.get(platform)?.win;return win&&!win.isDestroyed()?win:null;}
  publish(entry,info) {
    if(this.disposed||this.entries.get(entry.platform)!==entry||entry.win.isDestroyed())return;
    const next={platform:entry.platform,...info};
    if(JSON.stringify(next)!==JSON.stringify(entry.info)){entry.info=next;this.onChange({...next});}
  }
  getWindow(platform) {
    if(!HOME_URLS[platform])throw new Error('不支持的平台。');
    const existing=this.existing(platform);if(existing)return existing;
    const win=this.createWindow(platform),entry={platform,win,ready:false,revision:0,pending:null,retry:false,listeners:[]};
    this.entries.set(platform,entry);
    const listen=(target,event,handler)=>{target.on(event,handler);entry.listeners.push([target,event,handler]);};
    listen(win.webContents,'did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace)this.begin(entry);});
    listen(win.webContents,'dom-ready',()=>{entry.ready=true;void this.refresh(platform);});
    for(const event of ['did-finish-load','did-navigate-in-page'])listen(win.webContents,event,()=>{if(entry.ready)void this.refresh(platform);});
    listen(win.webContents,'did-fail-load',(_event,code,_description,_url,main)=>{
      if(main&&code!==-3&&!this.blocked(win))this.fail(entry,'页面加载失败，点击重试');
    });
    listen(win,'focus',()=>{void this.refresh(platform);});
    listen(win,'closed',()=>{this.clear(entry);if(this.entries.get(platform)===entry)this.entries.delete(platform);});
    entry.poll=setInterval(()=>{void this.refresh(platform);},this.pollInterval);
    this.publish(entry,{state:'unknown',checking:false,label:'点击打开平台登录'});
    return win;
  }
  begin(entry) {
    clearTimeout(entry.deadline);entry.revision++;entry.pending=null;entry.ready=false;entry.retry=false;entry.expired=false;
    this.publish(entry,{state:'unknown',checking:true,label:'正在检查登录，点击可打开平台'});
    entry.deadline=setTimeout(()=>{
      entry.expired=true;
      if(this.blocked(entry.win))return;
      entry.retry=!entry.ready;
      this.publish(entry,{...entry.info,state:'unknown',checking:false,label:'暂未确认登录，点击打开平台核对'});
    },this.loadingTimeout);
  }
  fail(entry,label) {
    clearTimeout(entry.deadline);entry.revision++;entry.pending=null;entry.ready=false;entry.retry=true;
    this.publish(entry,{state:'unknown',checking:false,label});
  }
  loadHome(platform) {
    const win=this.getWindow(platform),entry=this.entries.get(platform);
    this.begin(entry);
    // loadURL can remain pending on media-heavy pages. DOM readiness and bounded
    // inspection drive the UI instead, so opening an account never awaits it.
    const loading=win.loadURL(HOME_URLS[platform]),revision=entry.revision;
    loading.catch(error=>{
      if(entry.revision===revision&&!win.isDestroyed()&&!this.blocked(win)&&error.code!=='ERR_ABORTED')this.fail(entry,'页面加载失败，点击重试');
    });
    return win;
  }
  start() {for(const platform of Object.keys(HOME_URLS))this.loadHome(platform);}
  open(platform) {
    const win=this.getWindow(platform),entry=this.entries.get(platform),url=win.webContents.getURL();
    if(entry.retry||((!url||url==='about:blank')&&!entry.info.checking))this.loadHome(platform);
    else void this.refresh(platform);
    return this.snapshot(platform);
  }
  async refresh(platform) {
    const entry=this.entries.get(platform);
    if(this.disposed||!entry||entry.win.isDestroyed()||!entry.ready||this.blocked(entry.win))return this.snapshot(platform);
    if(entry.pending)return entry.pending;
    const revision=entry.revision;
    const pending=(async()=>{
      let timer;
      try {
        const info=await Promise.race([
          Promise.resolve().then(()=>this.inspect(entry.win)),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Account check timed out')),this.checkTimeout);})
        ]);
        if(this.disposed||entry.win.isDestroyed()||revision!==entry.revision||this.blocked(entry.win))return this.snapshot(platform);
        if(info.state==='logged-in'||info.state==='logged-out') {
          clearTimeout(entry.deadline);entry.retry=false;
          this.publish(entry,{...info,checking:false,label:info.state==='logged-in'?'已登录，点击打开平台':'未登录，点击打开平台登录'});
        } else if(!entry.info.checking||entry.expired) {
          this.publish(entry,{...info,checking:false,label:'暂未确认登录，点击打开平台核对'});
        }
      } catch {
        if(revision===entry.revision&&!this.blocked(entry.win)&&(!entry.info.checking||entry.expired))this.publish(entry,{state:'unknown',checking:false,label:'暂未确认登录，点击打开平台核对'});
      } finally {clearTimeout(timer);}
      return this.snapshot(platform);
    })();
    entry.pending=pending;
    try{return await pending;}finally{if(entry.pending===pending)entry.pending=null;}
  }
  clear(entry) {clearInterval(entry.poll);clearTimeout(entry.deadline);entry.revision++;for(const [target,event,handler] of entry.listeners)target.removeListener(event,handler);}
  reset() {
    for(const entry of this.entries.values()){this.clear(entry);if(!entry.win.isDestroyed())entry.win.destroy();}
    this.entries.clear();
    for(const platform of Object.keys(HOME_URLS))this.onChange({platform,state:'unknown',checking:false,label:'平台页面已关闭，登录状态待确认'});
  }
  dispose() {this.disposed=true;for(const entry of this.entries.values())this.clear(entry);}
}
module.exports={AccountManager,HOME_URLS};
