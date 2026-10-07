'use strict';
// The caller selects a temporary profile and temporary thumbnail directory.
// All site data, accounts, downloads and HTTP responses below are test fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {app,BrowserWindow}=require('electron');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({ui,accounts,session,root,thumbnailRoot,getWindow,setTasks,setResult})=>{
  const checks=[],out=path.join(root,'validation/browser-reset');await fs.mkdir(out,{recursive:true});
  const run=code=>ui.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<150;i++){if(await run(code))return;await wait(30);}throw new Error('Timed out: '+code);};
  const check=message=>{checks.push(message);console.log('PASS '+message);};
  const sessions=[session.defaultSession,session.fromPartition('persist:liblib'),session.fromPartition('persist:jimeng'),session.fromPartition('persist:extra-test')];
  const origins=['https://other.example','https://www.liblib.tv','https://jimeng.jianying.com','https://retired.example'];
  const seedCode=`(async()=>{localStorage.setItem('site-token','private-test-token');sessionStorage.setItem('draft','private-test-draft');const cache=await caches.open('site-cache');await cache.put(location.origin+'/resource',new Response('private-test-cache'));await new Promise((resolve,reject)=>{const req=indexedDB.open('site-db',1);req.onupgradeneeded=()=>req.result.createObjectStore('secrets');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('secrets','readwrite');tx.objectStore('secrets').put('private-test-data','token');tx.oncomplete=()=>{db.close();resolve();};};});return true;})()`;
  for(let i=0;i<sessions.length;i++){
    const ses=sessions[i];ses.protocol.handle('https',()=>new Response('<!doctype html><meta charset="utf-8"><button>登录</button>',{headers:{'content-type':'text/html; charset=utf-8'}}));
    await ses.cookies.set({url:origins[i],name:'account-fixture',value:'signed-in',expirationDate:Date.now()/1000+3600});
    await ses.cookies.set({url:'https://login.third-party.example',name:'oauth-fixture',value:'signed-in',expirationDate:Date.now()/1000+3600});
    const win=new BrowserWindow({show:false,width:900,height:650,webPreferences:{session:ses,offscreen:true,backgroundThrottling:false}});
    await win.loadURL(origins[i]+'/fixture');assert.equal(await win.webContents.executeJavaScript(seedCode),true);
  }
  await ui.webContents.executeJavaScript(`localStorage.setItem('foreign-token','private-test-token');localStorage.setItem('columns','3');localStorage.setItem('read-layout','dual');document.getElementById('theme-toggle').click();document.getElementById('appearance-palette-trigger').click();document.querySelector('#appearance-palette-menu [data-value=sand]').click();document.querySelector('[data-appearance-mode=dark]').click();document.getElementById('prompt-font-trigger').click();document.querySelector('#prompt-font-menu [data-value=geist]').click();const size=document.getElementById('prompt-font-size');size.value=18;size.dispatchEvent(new Event('input',{bubbles:true}));`);
  await until(`localStorage.getItem('appearance-v1')?.includes('sand')&&document.documentElement.dataset.theme==='dark'`);await wait(200);
  const preferences=await run(`Object.fromEntries(['appearance-v1','prompt-typography-v1','columns','read-layout'].map(key=>[key,localStorage.getItem(key)]))`);
  assert.equal(await run(`document.getElementById('theme-toggle').textContent`),'程序设置');assert.equal(await run(`document.getElementById('appearance-title').textContent`),'程序设置');
  for(const [width,height] of [[1440,960],[680,700]]){
    ui.setSize(width,height);await wait(200);
    const metrics=await run(`(()=>{const b=document.getElementById('browser-reset'),f=document.getElementById('folder'),g=[...document.querySelectorAll('#appearance-dialog .appearance-group')].at(-1);const pick=e=>{const s=getComputedStyle(e);return{height:e.getBoundingClientRect().height,radius:s.borderRadius,font:s.fontSize,border:s.borderColor,background:s.backgroundColor,color:s.color};};return{button:pick(b),reference:pick(f),bounds:b.getBoundingClientRect().toJSON(),group:g.getBoundingClientRect().toJSON(),overflow:document.getElementById('appearance-dialog').scrollWidth>document.getElementById('appearance-dialog').clientWidth+1};})()`);
    assert.deepEqual(metrics.button,metrics.reference);assert.ok(Math.abs(metrics.bounds.left-metrics.group.left)<1);assert.ok(Math.abs(metrics.bounds.right-metrics.group.right)<1);assert.ok(metrics.bounds.top>=metrics.group.bottom);assert.equal(metrics.overflow,false);
    await run(`document.getElementById('browser-reset').scrollIntoView({block:'nearest'})`);await wait(100);await fs.writeFile(path.join(out,'settings-'+width+'.png'),(await ui.webContents.capturePage()).toPNG());
  }
  check('Program settings uses the requested label and a full-width 44px button matching the project-folder button at two sizes');
  ui.setSize(1440,960);await run(`document.querySelector('[data-appearance-mode=light]').click()`);await wait(180);
  await fs.writeFile(path.join(out,'settings-light.png'),(await ui.webContents.capturePage()).toPNG());
  await run(`document.querySelector('[data-appearance-mode=dark]').click()`);await wait(180);
  for(const values of [{task:{}},{saveTask:{}},{queue:{active:true}},{downloadSetup:true}]){
    setTasks(values);const rejected=await run(`window.lab.resetBrowser({})`);assert.equal(rejected.ok,false);assert.match(rejected.error,/先结束/);
  }
  setTasks({});assert.equal((await sessions[1].cookies.get({name:'account-fixture'})).length,1);check('Reading, saving and downloading reject a reset before touching any account data');
  const savedDirectory=path.join(app.getPath('userData'),'saved-output');await fs.mkdir(savedDirectory,{recursive:true});
  const savedFile=path.join(savedDirectory,'提示词.md');await fs.writeFile(savedFile,'已导出的提示词和素材不属于浏览器缓存');
  await fs.mkdir(thumbnailRoot,{recursive:true});await fs.writeFile(path.join(thumbnailRoot,'fixture.png'),'temporary thumbnail');
  let networkRequests=0;
  const server=http.createServer((_request,response)=>{networkRequests++;response.setHeader('Cache-Control','public, max-age=3600');response.end('cache-fixture-'+networkRequests+'x'.repeat(8192));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const cacheUrl='http://127.0.0.1:'+server.address().port+'/cache';await (await sessions[1].fetch(cacheUrl)).text();
    await wait(100);const cacheBefore=await sessions[1].getCacheSize();assert.ok(cacheBefore>0);
    // Hold one cleaning operation to exercise duplicate submission and race guards.
    const clear=sessions[1].clearData.bind(sessions[1]);let release;
    sessions[1].clearData=async()=>{await new Promise(resolve=>{release=resolve;});return clear();};
    const assetId='b'.repeat(24);setResult({metadata:{platform:'liblib'},assets:[{id:assetId,kind:'video'}]});
    const mkdir=fs.mkdir.bind(fs);let releaseThumbnail;
    fs.mkdir=async(...args)=>{if(path.resolve(args[0])===path.resolve(thumbnailRoot))await new Promise(resolve=>{releaseThumbnail=resolve;});return mkdir(...args);};
    const writing=run(`window.lab.cacheThumbnail('${assetId}','data:image/png;base64,iVBORw0KGgo=')`);
    for(let i=0;i<100&&!releaseThumbnail;i++)await wait(10);assert.ok(releaseThumbnail);
    await run(`document.getElementById('browser-reset').click()`);
    await until(`document.getElementById('browser-reset').textContent==='正在重置…'`);
    assert.equal((await run(`window.lab.resetBrowser({})`)).ok,false);
    fs.mkdir=mkdir;releaseThumbnail();assert.equal((await writing).ok,true);
    for(let i=0;i<100&&!release;i++)await wait(20);assert.ok(release);
    assert.equal(getWindow(),null);assert.equal(BrowserWindow.getAllWindows().length,1);
    assert.equal((await run(`window.lab.resetBrowser({})`)).ok,false);assert.equal((await run(`window.lab.login('liblib')`)).ok,false);
    check('Reset closes all platform/third-party windows and blocks concurrent login and duplicate reset');
    release();sessions[1].clearData=clear;
    await until(`document.getElementById('browser-reset-status').dataset.phase==='done'`);
    assert.equal(await sessions[1].getCacheSize(),0);
    for(const ses of sessions)assert.deepEqual(await ses.cookies.get({}),[]);
    assert.deepEqual(await run(`Object.fromEntries(['appearance-v1','prompt-typography-v1','columns','read-layout'].map(key=>[key,localStorage.getItem(key)]))`),preferences);
    assert.equal(await run(`localStorage.getItem('foreign-token')`),null);
    assert.equal(await fs.readFile(savedFile,'utf8'),'已导出的提示词和素材不属于浏览器缓存');
    await assert.rejects(fs.access(path.join(thumbnailRoot,'fixture.png')));
    await assert.rejects(fs.access(path.join(thumbnailRoot,assetId+'.png')));
    check('An in-flight thumbnail write is drained before deletion and cannot repopulate the cleaned cache');
    check('All cookies and HTTP cache are cleared across default, both platforms, extra sessions and OAuth domains; preferences and saved output survive');
    for(let i=0;i<sessions.length;i++){
      const win=new BrowserWindow({show:false,webPreferences:{session:sessions[i],offscreen:true,backgroundThrottling:false}});await win.loadURL(origins[i]+'/fixture');
      const empty=await win.webContents.executeJavaScript(`(async()=>({local:localStorage.length,session:sessionStorage.length,caches:await caches.keys(),databases:(await indexedDB.databases()).map(db=>db.name)}))()`);
      assert.deepEqual(empty,{local:0,session:0,caches:[],databases:[]});win.destroy();
    }
    check('Fresh pages have no local storage, session storage, Cache Storage or IndexedDB data');
    assert.equal(await run(`['liblib','jimeng'].every(p=>{const b=document.getElementById('login-'+p);return b.dataset.state==='logged-out'&&b.querySelector('img').hidden;})`),true);
    assert.equal(await run(`document.getElementById('visibility').disabled`),true);
    const login=await run(`window.lab.login('liblib')`);assert.equal(login.ok,true);assert.ok(accounts.existing('liblib'));
    await wait(150);await accounts.refresh('liblib');check('Account indicators reset and a fresh platform window can still open for login');
    // A real session failure must not display a successful reset.
    sessions[1].clearData=async()=>{throw new Error('fixture failure');};
    await run(`document.getElementById('browser-reset').click()`);await until(`document.getElementById('browser-reset-status').dataset.phase==='error'`);
    assert.equal(await run(`document.getElementById('browser-reset').disabled`),false);sessions[1].clearData=clear;
    await run(`document.getElementById('browser-reset').click()`);await until(`document.getElementById('browser-reset-status').dataset.phase==='done'`);
    check('Partial failure is visible, preferences survive, and the same button successfully retries');
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,checks,cacheBefore,cacheAfter:await sessions[1].getCacheSize(),sessions:sessions.length},null,2));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
};
