'use strict';
// Run the detector in Chromium with an isolated, in-memory session. No account
// cookies, credentials, existing windows or saved projects are read or changed.
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(path.resolve(root,'../node_modules/electron/dist/electron.exe'),[__filename],{env,stdio:'inherit',windowsHide:true});
  child.on('error',error=>{console.error(error);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code||0;});
}else{
  const {app,BrowserWindow,session}=require('electron');
  const {inspectAccount}=require('../src/account-state.cjs');
  app.whenReady().then(async()=>{
    let win;
    try{
      let html='';
      const ses=session.fromPartition('account-state-fixture');
      ses.protocol.handle('https',()=>new Response('<!doctype html><meta charset="utf-8">'+html,{headers:{'content-type':'text/html; charset=utf-8'}}));
      win=new BrowserWindow({show:false,width:1280,height:860,webPreferences:{session:ses,backgroundThrottling:false,offscreen:true}});
      const avatar='<img alt="avatar" src="data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\"/%3E" style="width:24px;height:24px">';
      const trigger=(content=avatar,style='right:20px;top:20px;',attrs='aria-haspopup="dialog" aria-expanded="false"')=>`<div ${attrs} style="position:fixed;width:32px;height:32px;${style}">${content}</div>`;
      const jimengHome=(menuStyle='visibility:hidden',name='测试用户')=>`<div id="js-side-menu-entry-avatar-container" aria-expanded="false"><img class="dreamina-component-avatar" src="data:image/png;base64,AA==" style="width:28px;height:28px"><div style="${menuStyle}"><button class="user-row-fixture"><span class="user-name-fixture">${name}</span><span>个人主页</span></button><div data-side-menu-settings-list="true"><button>退出</button></div></div></div>`;
      const jimengCanvas='<button data-testid="canvas-user-menu-trigger" aria-haspopup="menu" aria-label="用户菜单"><img data-testid="canvas-user-avatar-image" src="data:image/png;base64,AA==" style="width:28px;height:28px"></button>';
      const jimengUrl='https://jimeng.jianying.com/fixture';
      const cases=[
        ['collapsed LibTV account',trigger(),'logged-in'],
        ['expanded LibTV account',trigger(avatar,undefined,'aria-haspopup="dialog" aria-expanded="true"'),'logged-in'],
        ['credits alone','<button>100</button><button>积分超市</button>','unknown'],
        ['creator avatar without account popup',trigger(avatar,undefined,''),'unknown'],
        ['creator avatar in page content',trigger(avatar,'right:20px;top:300px;'),'unknown'],
        ['avatar at left side',trigger(avatar,'left:20px;top:20px;'),'unknown'],
        ['hidden account',`<div style="display:none">${trigger()}</div>`,'unknown'],
        ['login takes precedence over collapsed avatar',trigger()+'<button>登录</button>','logged-out'],
        ['login dialog',trigger()+'<div role="dialog">欢迎登录 请输入手机号</div>','logged-out'],
        ['explicit logged out','<button>注册 / 登录</button>','logged-out'],
        ['explicit logout','<button>退出登录</button>','logged-in'],
        ['account menu','<div style="position:fixed;right:20px;top:20px;width:260px"><strong>176****1770</strong><span>UUID | Access key</span></div>','logged-in'],
        ['public author does not imply login','<main><h1>作品可以访问</h1><span>作者 176****1770</span></main>','unknown'],
        ['other platform avatar',trigger(),'unknown','https://jimeng.jianying.com/fixture'],
        ['Jimeng collapsed home account',jimengHome(),'logged-in',jimengUrl],
        ['Jimeng expanded home account',jimengHome(''),'logged-in',jimengUrl],
        ['Jimeng home account without username',jimengHome('',''),'unknown',jimengUrl],
        ['Jimeng home account without exit',jimengHome().replace('<button>退出</button>',''),'unknown',jimengUrl],
        ['Jimeng hidden account',`<div style="visibility:hidden">${jimengHome()}</div>`,'unknown',jimengUrl],
        ['Jimeng public creator and exit navigation','<img class="dreamina-component-avatar"><span class="user-name-fixture">测试用户</span><button>个人主页</button><button>退出</button>','unknown',jimengUrl],
        ['Jimeng canvas account',jimengCanvas,'logged-in',jimengUrl],
        ['Jimeng empty canvas avatar',jimengCanvas.replace('src="data:image/png;base64,AA=="',''),'unknown',jimengUrl],
        ['Jimeng hidden canvas account',`<div style="display:none">${jimengCanvas}</div>`,'unknown',jimengUrl],
        ['Jimeng login takes precedence',jimengHome()+jimengCanvas+'<button>登录</button>','logged-out',jimengUrl],
        ['Jimeng login dialog takes precedence',jimengHome()+'<div role="dialog">欢迎登录</div>','logged-out',jimengUrl],
        ['Jimeng markup on another platform',jimengHome()+jimengCanvas,'unknown'],
        ['hidden logout is not login evidence','<button style="visibility:hidden">退出登录</button>','unknown',jimengUrl],
      ];
      for(const [name,body,expected,url='https://www.liblib.tv/fixture'] of cases){
        html=body;await win.loadURL(url);
        const result=await win.webContents.executeJavaScript('('+inspectAccount.toString()+')()');
        assert.equal(result.state,expected,name);if(name==='Jimeng collapsed home account')assert.equal(result.username,'测试用户');console.log('PASS '+name);
      }
      // Authentication can change without any navigation event.
      html='<button>登录</button>';await win.loadURL('https://www.liblib.tv/fixture');
      assert.equal((await win.webContents.executeJavaScript('('+inspectAccount.toString()+')()')).state,'logged-out');
      await win.webContents.executeJavaScript('document.body.innerHTML='+JSON.stringify(trigger()));
      assert.equal((await win.webContents.executeJavaScript('('+inspectAccount.toString()+')()')).state,'logged-in');
      await win.webContents.executeJavaScript('document.body.innerHTML="<button>登录</button>"');
      assert.equal((await win.webContents.executeJavaScript('('+inspectAccount.toString()+')()')).state,'logged-out');
      console.log('PASS login and logout without navigation');
      html='<button>登录</button>';await win.loadURL(jimengUrl);
      await win.webContents.executeJavaScript('document.body.innerHTML='+JSON.stringify(jimengHome()));
      assert.equal((await win.webContents.executeJavaScript('('+inspectAccount.toString()+')()')).state,'logged-in');
      await win.webContents.executeJavaScript('document.body.innerHTML="<button>登录</button>"');
      assert.equal((await win.webContents.executeJavaScript('('+inspectAccount.toString()+')()')).state,'logged-out');
      console.log('PASS Jimeng login and logout without navigation');
      win.destroy();app.exit(0);
    }catch(error){console.error(error);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}
  });
}
