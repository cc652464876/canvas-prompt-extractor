'use strict';
// Exercise the actual main-process IPC, account manager and shipped renderer.
// main.cjs selects a temporary profile; all platform responses are local fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({ui,accounts,getWindow,session,root})=>{
  const checks=[],requests={liblib:0,jimeng:0},errors=[];
  const out=path.join(root,'validation/account-startup');await fs.mkdir(out,{recursive:true});
  ui.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  const fixture={
    liblib:'<div aria-haspopup="dialog" aria-expanded="false" style="position:fixed;right:20px;top:20px;width:32px;height:32px"><img alt="avatar" src="https://www.liblib.tv/avatar.svg" style="width:24px;height:24px"></div>',
    jimeng:'<div id="js-side-menu-entry-avatar-container"><img class="dreamina-component-avatar" src="https://jimeng.jianying.com/avatar.svg" style="width:28px;height:28px"><div style="visibility:hidden"><button class="user-row-fixture"><span class="user-name-fixture">测试用户</span>个人主页</button><div data-side-menu-settings-list><button>退出</button></div></div></div>'
  };
  // Account avatars render in the UI's session, rather than the platform session.
  ui.webContents.session.protocol.handle('https',()=>new Response('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="14" fill="#5b8d91"/></svg>',{headers:{'content-type':'image/svg+xml'}}));
  for(const platform of ['liblib','jimeng'])session.fromPartition('persist:'+platform).protocol.handle('https',async request=>{
    if(request.url.endsWith('avatar.svg'))return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#5b8d91"/></svg>',{headers:{'content-type':'image/svg+xml'}});
    requests[platform]++;await wait(1800);
    return new Response('<!doctype html><meta charset="utf-8">'+fixture[platform],{headers:{'content-type':'text/html; charset=utf-8'}});
  });
  const run=code=>ui.webContents.executeJavaScript(code);
  const until=async predicate=>{const deadline=Date.now()+8000;while(Date.now()<deadline){if(await predicate())return;await wait(30);}throw new Error('Timed out waiting for account UI');};
  const check=message=>{checks.push(message);console.log('PASS '+message);};
  const shot=async name=>{
    // Offscreen capture requires a compositor frame; the hidden-window IPC
    // assertions remain mandatory even when rendering starts a little later.
    for(let attempt=0;attempt<3;attempt++){
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      try{await fs.writeFile(path.join(out,name),(await ui.webContents.capturePage()).toPNG());return;}
      catch(error){if(error.message!=='UnknownVizError'||attempt===2)throw error;await wait(100);}
    }
  };
  accounts.start();
  assert.equal(getWindow(),undefined);assert.ok(accounts.snapshots().every(info=>info.checking));
  assert.ok(['liblib','jimeng'].every(p=>!accounts.existing(p).isVisible()));
  await until(()=>run(`['liblib','jimeng'].every(p=>document.getElementById('login-'+p).getAttribute('aria-busy')==='true')`));
  assert.equal(await run(`['liblib','jimeng'].some(p=>document.getElementById('login-'+p).disabled)`),false);
  assert.equal(await run(`document.getElementById('visibility').disabled`),true);
  check('Startup checks both saved sessions in hidden windows; checking buttons remain clickable');
  await wait(150);await shot('checking.png');
  const lib=accounts.existing('liblib'),dream=accounts.existing('jimeng');
  // Offscreen verification has no native visible windows. Observe real calls to
  // show/hide instead of treating its always-false isVisible() as a UI failure.
  const shows={liblib:0,jimeng:0},hides={liblib:0,jimeng:0};
  for(const [platform,win] of [['liblib',lib],['jimeng',dream]]){
    const show=win.show.bind(win),hide=win.hide.bind(win);
    win.show=()=>{shows[platform]++;return show();};win.hide=()=>{hides[platform]++;return hide();};
  }
  const opened=await run(`(async()=>{const start=performance.now();const r=await window.lab.login('liblib');return{r,elapsed:performance.now()-start};})()`);
  assert.ok(opened.r.ok);assert.ok(opened.elapsed<1000,JSON.stringify(opened));assert.equal(getWindow(),lib);
  assert.equal(shows.liblib,1);assert.equal(await run(`document.getElementById('login-jimeng').disabled`),false);
  check('Opening an account returns immediately while its delayed homepage is still loading');
  await until(()=>run(`['liblib','jimeng'].every(p=>document.getElementById('login-'+p).dataset.state==='logged-in')`));
  check('DOM account evidence restores both logged-in indicators without a login click');
  await run(`document.getElementById('login-jimeng').click()`);await until(()=>getWindow()===dream);
  assert.equal(hides.liblib,1);assert.equal(lib.isDestroyed(),false);assert.equal(shows.jimeng,1);
  await run(`document.getElementById('login-liblib').click()`);await until(()=>getWindow()===lib);
  assert.deepEqual(requests,{liblib:1,jimeng:1});assert.equal(dream.isDestroyed(),false);
  check('Switching accounts retains each window and never reloads its homepage');
  await dream.webContents.executeJavaScript(`document.body.innerHTML='<button>登录</button>'`);
  await accounts.refresh('jimeng');await until(()=>run(`document.getElementById('login-jimeng').dataset.state==='logged-out'`));
  assert.equal(await run(`document.getElementById('login-liblib').dataset.state`),'logged-in');
  await dream.webContents.executeJavaScript('document.body.innerHTML='+JSON.stringify(fixture.jimeng));
  await accounts.refresh('jimeng');await until(()=>run(`document.getElementById('login-jimeng').dataset.state==='logged-in'`));
  check('Login and logout update the correct account even in a hidden window');
  for(const width of [1440,680]){
    ui.setSize(width,960);await wait(150);
    const overflow=await run(`(()=>{const b=document.getElementById('login-jimeng'),r=b.getBoundingClientRect();return{page:document.documentElement.scrollWidth>innerWidth+1,button:r.width,tooltip:b.title,busy:b.getAttribute('aria-busy')};})()`);
    assert.equal(overflow.page,false);assert.equal(overflow.busy,'false');assert.match(overflow.tooltip,/已登录/);
    await shot('logged-in-'+width+'.png');
  }
  check('Account indicators fit both 1440px and 680px layouts');
  lib.hide();dream.hide();assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,checks,homepageRequests:requests,openMilliseconds:opened.elapsed,rendererErrors:errors},null,2));
};
