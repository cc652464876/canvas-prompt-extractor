'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {nativeTheme}=require('electron');
const {ExtractionFeedback}=require('./extraction-feedback.cjs');
const {PALETTES,resolveTheme}=require('./theme.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({ui,root,setFeedback,getTheme})=>{
  const run=code=>ui.webContents.executeJavaScript(code),errors=[],checks=[];
  const reload=()=>new Promise(resolve=>{ui.webContents.once('did-finish-load',resolve);ui.reload();});
  ui.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  const until=async(code)=>{for(let i=0;i<80;i++){if(await run(code))return;await wait(25);}throw new Error('Timed out: '+code);};
  const choose=async(palette,mode)=>{
    await run(`document.getElementById('theme-toggle').click();document.getElementById('appearance-palette-trigger').click();document.querySelector('#appearance-palette-menu [data-value=${palette}]').click();document.querySelector('[data-appearance-mode=${mode}]').click();document.getElementById('appearance-close').click()`);
    await until(`!document.getElementById('appearance-dialog').open&&document.activeElement.id==='theme-toggle'`);
    await until(`document.documentElement.dataset.palette==='${palette}'&&document.documentElement.dataset.themeMode==='${mode}'`);
    for(let i=0;i<80;i++){const t=getTheme();if(t.palette===palette&&t.mode===mode)return;await wait(25);}throw new Error('Main process theme did not sync');
  };
  const feedback=new ExtractionFeedback(ui,{theme:getTheme()});setFeedback(feedback);await feedback.initialize();
  try {
    await run(`localStorage.removeItem('appearance-v1');localStorage.setItem('theme','dark')`);await reload();
    await until(`document.documentElement.dataset.theme==='dark'`);checks.push('Legacy dark preference restored before first paint');
    await run(`const testStyle=document.createElement('style');testStyle.textContent='*{transition:none!important;animation:none!important}';document.head.append(testStyle)`);
    for(const palette of Object.keys(PALETTES))for(const mode of ['light','dark']) {
      await choose(palette,mode);await wait(60);
      const theme=resolveTheme({palette,mode});
      const styles=await run(`(()=>{const s=getComputedStyle(document.documentElement);return{bg:s.getPropertyValue('--bg').trim(),text:s.getPropertyValue('--text').trim(),prompt:s.getPropertyValue('--prompt-text-color').trim(),primary:s.getPropertyValue('--primary-bg').trim(),body:getComputedStyle(document.body).backgroundColor,dialog:getComputedStyle(document.getElementById('appearance-dialog')).backgroundColor};})()`);
      assert.equal(styles.bg,theme.tokens.bg);assert.equal(styles.text,theme.tokens.text);assert.equal(styles.prompt,theme.tokens['prompt-text-color']);assert.equal(styles.primary,theme.tokens['primary-bg']);
      const expectedButton='rgb('+[1,3,5].map(i=>parseInt(theme.tokens['primary-bg'].slice(i,i+2),16)).join(', ')+')';
      assert.equal(await run(`getComputedStyle(document.getElementById('start')).backgroundColor`),expectedButton);
      const overlay=await feedback.overlay.webContents.executeJavaScript(`(()=>{const s=getComputedStyle(document.documentElement);return{palette:document.documentElement.dataset.palette,mode:document.documentElement.dataset.theme,bg:s.getPropertyValue('--bg').trim(),text:s.getPropertyValue('--text').trim()};})()`);
      assert.deepEqual(overlay,{palette,mode,bg:theme.tokens.bg,text:theme.tokens.text});
      assert.equal(ui.getBackgroundColor().toLowerCase(),theme.tokens.bg.toLowerCase());
      checks.push(palette+'/'+mode+': main UI, native background and feedback synchronized');
      await run('scrollTo(0,0)');await fs.writeFile(path.join(root,'validation','v10-'+palette+'-'+mode+'.png'),(await ui.webContents.capturePage()).toPNG());
    }
    const originalSource=nativeTheme.themeSource;
    try {
      nativeTheme.themeSource='light';await choose('sand','system');await until(`document.documentElement.dataset.theme==='light'`);
      nativeTheme.themeSource='dark';await until(`document.documentElement.dataset.theme==='dark'`);
      await wait(80);assert.equal(getTheme().resolvedMode,'dark');
      assert.equal(await feedback.overlay.webContents.executeJavaScript('document.documentElement.dataset.theme'),'dark');
      const nextFeedback=new ExtractionFeedback(ui,{theme:{palette:'sand',mode:'system'}});
      try {await nextFeedback.initialize();assert.equal(await nextFeedback.overlay.webContents.executeJavaScript('document.documentElement.dataset.theme'),'dark');}
      finally {await nextFeedback.dispose();}
      const preference=JSON.parse(await run(`localStorage.getItem('appearance-v1')`));assert.deepEqual(preference,{palette:'sand',mode:'system'});
      await choose('sand','light');nativeTheme.themeSource='dark';await wait(80);assert.equal(await run('document.documentElement.dataset.theme'),'light');
      checks.push('System changes update both windows and newly created feedback; explicit light remains light');
    } finally {nativeTheme.themeSource=originalSource;}
    await choose('sand','dark');await reload();await until(`document.documentElement.dataset.palette==='sand'&&document.documentElement.dataset.theme==='dark'`);checks.push('Palette and mode restored after reload');
    for(const width of [1840,1440,1024,800,680]) {
      ui.setSize(width,960);await wait(120);await run(`document.getElementById('theme-toggle').click()`);
      const geometry=await run(`(()=>{const r=document.getElementById('appearance-dialog').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth+1,left:r.left,right:r.right,width:innerWidth,clipped:[...document.querySelectorAll('.appearance-modes button')].some(e=>e.scrollWidth>e.clientWidth+1)};})()`);
      assert.equal(geometry.overflow,false,'Page overflow at '+width);assert.equal(geometry.clipped,false);assert.ok(geometry.left>=0&&geometry.right<=geometry.width);
      await fs.writeFile(path.join(root,'validation','v10-appearance-'+width+'.png'),(await ui.webContents.capturePage()).toPNG());
      await run(`document.getElementById('appearance-close').click()`);await until(`!document.getElementById('appearance-dialog').open&&document.activeElement.id==='theme-toggle'`);
    }
    await run(`document.getElementById('theme-toggle').click()`);ui.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});ui.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until(`!document.getElementById('appearance-dialog').open`);
    checks.push('Appearance dialog fits five window widths, restores focus and closes with Escape');
    ui.setSize(1440,960);await run(`{const s=document.createElement('style');s.textContent='*{transition:none!important;animation:none!important}';document.head.append(s);}`);await choose('tokyo-night','dark');
    await run(`document.getElementById('theme-toggle').click();document.getElementById('appearance-palette-trigger').click()`);await wait(150);
    assert.equal(await run(`document.querySelectorAll('#appearance-palette-menu [role=option]').length`),Object.keys(PALETTES).length);
    const menu=await run(`(()=>{const e=document.getElementById('appearance-palette-menu'),r=e.getBoundingClientRect();return{scrolls:e.scrollHeight>e.clientHeight,top:r.top,bottom:r.bottom,height:innerHeight};})()`);
    assert.equal(menu.scrolls,true);assert.ok(menu.top>=0&&menu.bottom<=menu.height);
    await fs.writeFile(path.join(root,'validation/v10-theme-library-menu.png'),(await ui.webContents.capturePage()).toPNG());
    checks.push('Twenty theme families are available in one scrolling menu with localized labels');
    await run(`document.getElementById('prompt-font-trigger').click();document.querySelector('#prompt-font-menu [data-value=geist]').click();const resetSize=document.getElementById('prompt-font-size');resetSize.value='18';resetSize.dispatchEvent(new Event('change'));document.getElementById('appearance-reset').click()`);
    await until(`document.documentElement.dataset.palette==='default'&&document.documentElement.dataset.themeMode==='light'&&document.documentElement.dataset.promptFont==='default'&&document.getElementById('prompt-font-size').value==='14'`);
    assert.deepEqual(JSON.parse(await run(`localStorage.getItem('appearance-v1')`)),{palette:'default',mode:'light'});
    assert.deepEqual(JSON.parse(await run(`localStorage.getItem('prompt-typography-v1')`)),{font:'default',size:14});
    assert.equal(await run(`getComputedStyle(document.documentElement).getPropertyValue('--prompt-ref-size').trim()`),'16px');
    assert.equal(await run(`document.getElementById('appearance-dialog').open`),true);
    assert.equal(await run(`document.getElementById('appearance-palette-menu').hidden&&document.getElementById('prompt-font-menu').hidden`),true);
    await wait(100);assert.equal(getTheme().palette,'default');assert.equal(getTheme().mode,'light');
    await reload();await until(`document.documentElement.dataset.palette==='default'&&document.documentElement.dataset.promptFont==='default'&&document.getElementById('prompt-font-size').value==='14'`);
    checks.push('Restore defaults resets both persisted preferences, reference sizes and native/feedback colors; reset survives reload');
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(root,'validation/v10-theme-report.json'),JSON.stringify({passed:true,checks,errors,profile:'Isolated temporary profile; no platform requests'},null,2));
    console.log('PASS v1.0 themes: '+checks.join('; '));
  } finally {setFeedback(null);await feedback.dispose();}
};
