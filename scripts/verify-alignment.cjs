'use strict';
// Isolated UI verification: no access to the running app's profile or exports.
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(os.tmpdir(),'canvas-alignment-'+process.pid));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1,label+': '+a+' vs '+b);
app.whenReady().then(async()=>{
  ipcMain.handle('lab:info',()=>({ok:true,value:{outputDirectory:'桌面 / 自由画布提取',options:{mode:'full'}}}));
  ipcMain.handle('lab:theme',(_event,value)=>({ok:true,value}));
  ipcMain.handle('lab:thumbnail-info',()=>({ok:true,value:null}));
  ipcMain.handle('lab:login-state',()=>({ok:false}));
  const ui=new BrowserWindow({width:1440,height:1100,show:false,webPreferences:{preload:path.join(root,'src/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const errors=[];ui.webContents.on('console-message',e=>{if(e.level==='error'||e.level===3)errors.push(e.message);});
  await ui.loadFile(path.join(root,'src/ui/index.html'));
  const run=code=>ui.webContents.executeJavaScript(code);
  // Hidden Electron windows can pause transition frames. Inspect final states.
  await run("const verificationStyle=document.createElement('style');verificationStyle.textContent='*{transition:none!important;animation:none!important}';document.head.append(verificationStyle)");
  assert.equal(await run("document.getElementById('mode').value"),'full');
  assert.equal(await run("document.getElementById('read-layouts').querySelector('.active').dataset.layout"),'side');
  assert.equal(await run("document.getElementById('retry').hidden"),true);
  const fixture=JSON.parse(await fs.readFile(path.join(root,'validation/liblib-large-snapshot.json'),'utf8'));
  for(const a of fixture.assets){a.previewUrl='';a.previewUrls=[];a.state='pending';if(a.kind==='video')a.url='';}
  ui.webContents.send('lab:event',{type:'result',payload:fixture});
  ui.webContents.send('lab:event',{type:'project',payload:{root:'桌面 / 自由画布提取',documents:[],options:{mode:'full',split:true,kinds:['video','image','text']}}});
  ui.webContents.send('lab:event',{type:'status',payload:{message:'读取完成：'+fixture.entries.length+' 条提示词与文本，'+fixture.assets.length+' 个项目资产。',phase:'done'}});
  await wait(250);
  // UI-only failure fixture; no downloads or retries are triggered.
  const failedAsset=fixture.assets.find(a=>a.kind==='image');failedAsset.state='failed';failedAsset.error='验证用失败状态';
  ui.webContents.send('lab:event',{type:'assets',payload:fixture.assets});
  ui.webContents.send('lab:event',{type:'downloads',payload:{active:false,paused:false,failed:1,files:fixture.assets,speeds:{}}});
  await wait(180);
  await run("document.getElementById('board-toggle').click()");
  const read=`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height};};const q=s=>rect(document.querySelector(s));const style=s=>{const c=getComputedStyle(document.querySelector(s));return{background:c.backgroundColor,border:c.borderColor,color:c.color};};return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,url:q('#url'),title:q('#project-name'),path:q('.destination'),choices:[...document.querySelectorAll('.prompt-choices label')].map(rect),actions:['#start','#folder','#directory','#save-prompts','#download','#board-toggle'].map(q),scope:q('.scope-group'),search:q('#search'),range:q('#columns'),categories:[...document.querySelectorAll('#category-filters button')].map(rect),rows:q('.download-rows'),panels:['.extraction-panel','.project-panel','.board-toolbar'].map(q),board:style('.board-toolbar'),selected:style('#export-types label:has(input:checked)'),unselected:style('#export-types label:has(input:not(:checked))'),tab:style('.scope-group button.active'),category:style('#category-filters button.active'),save:style('#save-prompts'),clipped:[...document.querySelectorAll('.prompt-choices label')].filter(e=>e.scrollWidth>e.clientWidth+1).length};})()`;
  const report={passed:false,widths:[],checks:[]};
  for(const width of [1840,1520,1280,1024,800,680]){
    ui.setSize(width,1100);await wait(180);
    for(const scope of ['prompts','assets']){
      await run("document.getElementById('tab-"+scope+"').click()");await wait(180);
      const d=await run(read);assert.equal(d.overflow,false,'Page overflow at '+width);assert.equal(d.clipped,0,'Clipped choice text at '+width);
      const buttons=await run(`(()=>{const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,right:b.right,y:b.y,bottom:b.bottom,width:b.width,height:b.height};};return{save:r(document.getElementById('save-prompts')),folder:r(document.getElementById('folder')),download:r(document.getElementById('download')),retry:r(document.getElementById('retry')),reader:[...document.querySelectorAll('#read-layouts button,#collapse-readers,#clear-readers')].map(r),retryHidden:document.getElementById('retry').hidden,selected:getComputedStyle(document.querySelector('#read-layouts .active')).backgroundColor};})()`);
      for(const b of [buttons.download,buttons.retry,...buttons.reader]){near(b.width,buttons.save.width,'Memo button width');near(b.height,buttons.save.height,'Memo button height');}
      near(buttons.retry.x,buttons.download.x,'Retry left');near(buttons.retry.width,buttons.folder.width,'Retry/folder width');assert.ok(buttons.retry.y>buttons.download.bottom,'Retry below download');assert.equal(buttons.retryHidden,false);near(buttons.reader[0].right,buttons.reader[1].x,'First divider');near(buttons.reader[1].right,buttons.reader[2].x,'Second divider');assert.equal(buttons.selected,'rgb(231, 241, 255)');
      for(const a of d.actions){near(a.x,d.actions[0].x,'Action left');near(a.right,d.actions[0].right,'Action right');}
      for(const p of d.panels){near(p.x,d.panels[0].x,'Panel left');near(p.right,d.panels[0].right,'Panel right');}
      near(d.url.x,d.path.x,'Path left');near(d.url.right,d.path.right,'Path right');near(d.title.x,d.url.x,'Title left');near(d.choices[0].x,d.url.x,'Choice left');near(d.scope.x,d.url.x,'Scope left');near(d.rows.x,d.url.x,'Download left');near(d.rows.right,d.url.right,'Download right');
      for(const c of d.choices)near(c.height,44,'Choice height');
      near(d.range.x,d.search.x,'Slider left');near(d.range.right,d.actions[0].right,'Slider right');
      for(const c of d.categories){near(c.height,44,'Category height');near(c.width,d.categories[0].width,'Category width');}
      if(d.width>1050){near(d.choices[3].x,d.search.x,'Fourth choice/search guide');near(d.choices.at(-1).right,d.path.right,'Choice right');for(const c of d.choices)near(c.width,d.choices[0].width,'Choice width');}
      assert.equal(d.selected.background,d.tab.background,'Selected tab '+JSON.stringify(d));assert.equal(d.selected.background,d.category.background,'Selected category');assert.notEqual(d.selected.background,d.unselected.background,'Choice state');assert.equal(d.save.background,'rgb(32, 91, 192)','Save color');assert.equal(d.board.background,'rgb(255, 255, 255)','Panel color');
      report.widths.push({windowWidth:width,scope,geometry:d});
    }
    await run("document.getElementById('tab-prompts').click();scrollTo(0,0)");
    await fs.writeFile(path.join(root,'validation','UI-对齐-'+width+'.png'),(await ui.webContents.capturePage()).toPNG());
  }
  ui.setSize(1440,1100);await wait(150);
  await run("document.querySelector('.reader-toolbar').scrollIntoView({block:'center'})");
  for(const layout of ['side','stack','dual']){
    await run("document.querySelector('[data-layout="+layout+"]').click()");
    assert.equal(await run("document.querySelector('#read-layouts .active').dataset.layout"),layout);
    assert.equal(await run("getComputedStyle(document.querySelector('#read-layouts .active')).backgroundColor"),'rgb(231, 241, 255)');
    const bounds=await run("(()=>{const r=document.getElementById('read-layouts').getBoundingClientRect();return{x:Math.floor(r.x)-4,y:Math.floor(r.y)-4,width:Math.ceil(r.width)+8,height:Math.ceil(r.height)+8};})()");
    await fs.writeFile(path.join(root,'validation','UI-阅读布局-'+layout+'.png'),(await ui.webContents.capturePage(bounds)).toPNG());
  }
  await run("document.querySelector('[data-layout=side]').click()");
  await run("document.querySelector('[data-appearance-mode=dark]').click()");await wait(180);
  let d=await run(read);assert.notEqual(d.board.background,'rgb(255, 255, 255)');assert.equal(d.selected.background,d.category.background);
  await fs.writeFile(path.join(root,'validation','UI-对齐-深色.png'),(await ui.webContents.capturePage()).toPNG());
  await run("document.querySelector('[data-appearance-mode=light]').click();document.querySelector('#export-types input').click();document.getElementById('split').click();document.querySelector('#category-filters button').click()");await wait(180);
  assert.equal(await run("document.querySelector('#export-types input').checked"),false);
  assert.equal(await run("document.getElementById('split').checked"),false);
  assert.equal(await run("document.querySelector('#category-filters button').getAttribute('aria-pressed')"),'false');
  assert.equal(await run("getComputedStyle(document.querySelector('#export-types label')).backgroundColor"),'rgb(255, 255, 255)');
  assert.equal(await run("getComputedStyle(document.querySelector('.split-field')).backgroundColor"),'rgb(255, 255, 255)');
  await run("document.querySelector('#export-types input').click();document.getElementById('split').click();document.querySelector('#category-filters button').click()");await wait(180);
  await run("scrollTo(0,0)");
  await fs.writeFile(path.join(root,'validation','UI-对齐-1440.png'),(await ui.webContents.capturePage()).toPNG());
  await run("document.querySelector('.card-heading').click();document.querySelector('.reader-toolbar').scrollIntoView({block:'start'})");await wait(180);
  await fs.writeFile(path.join(root,'validation','UI-阅读按钮-1440.png'),(await ui.webContents.capturePage()).toPNG());
  ui.setSize(680,1100);await wait(180);await run("document.querySelector('.reader-toolbar').scrollIntoView({block:'start'})");
  await fs.writeFile(path.join(root,'validation','UI-阅读按钮-680.png'),(await ui.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);
  report.passed=true;report.checks=['Default full mode and side reading layout','Shared panel bounds and action column at six widths','Five-choice/search guide at wide widths','Download, retry and five reading buttons match save dimensions','Retry below download; three touching reading layout segments','44px controls; no clipped text or horizontal overflow','Light blue selected states and dark blue save action','Checkbox and category deselection; dark theme'];
  await fs.writeFile(path.join(root,'validation/ui-alignment-report.json'),JSON.stringify(report,null,2));
  console.log('PASS UI alignment: six widths, both scopes, selection changes and dark theme');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
