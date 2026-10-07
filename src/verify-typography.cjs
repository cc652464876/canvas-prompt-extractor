'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {typographyMetrics}=require('./typography.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({ui,root,fixture})=>{
  const run=code=>ui.webContents.executeJavaScript(code),checks=[],requests=[];
  const until=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await wait(25);}throw new Error('Timed out: '+code);};
  ui.webContents.session.webRequest.onBeforeRequest({urls:['file://*/*Geist*']},(details,callback)=>{requests.push(details.url);callback({});});
  const read=`(()=>{const p=document.querySelector('.reading-card.focused .prompt-text'),chip=p.querySelector('.inline-ref'),img=chip.querySelector('img'),s=getComputedStyle(p),c=getComputedStyle(chip);return{font:s.fontFamily,size:parseFloat(s.fontSize),line:parseFloat(s.lineHeight),chipHeight:chip.getBoundingClientRect().height,chipLine:parseFloat(c.lineHeight),chipFont:parseFloat(c.fontSize),imageWidth:img.getBoundingClientRect().width,imageHeight:img.getBoundingClientRect().height,text:p.textContent,imageSrc:img.src,other:[...document.querySelectorAll('.brand h1,.detail-title h3,#start,#save-prompts,.card-heading,.ref-thumb')].map(e=>({font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize}))};})()`;
  await run(`document.querySelector('[data-key="prompts:styleDemo"] .card-heading').click()`);
  await until(`document.querySelector('.reading-card.focused .inline-ref img')?.naturalWidth>0`);
  const original=await run(read);
  await run(`document.getElementById('theme-toggle').click();document.getElementById('prompt-font-trigger').click()`);
  assert.equal(await run(`document.querySelectorAll('#prompt-font-menu [role=option]').length`),2);
  await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(`document.documentElement.dataset.promptFont==='geist'`);
  const loaded=await run(`document.fonts.load('18px "Prompt Geist"').then(faces=>faces.map(f=>({family:f.family,status:f.status})))`);
  assert.ok(loaded.some(face=>face.family==='Prompt Geist'&&face.status==='loaded'));
  assert.ok(requests.length>0&&requests.every(url=>url.startsWith('file:')));checks.push('Bundled Geist loads from disk; font selector supports keyboard selection');
  await run(`document.getElementById('appearance-close').click()`);
  for(const size of [12,14,18,28]){
    await run(`{document.getElementById('theme-toggle').click();const input=document.getElementById('prompt-font-size');input.value='${size}';input.dispatchEvent(new Event('input'));document.getElementById('appearance-close').click();}`);
    const measured=await run(read),expected=typographyMetrics({font:'geist',size});
    assert.equal(measured.size,size);assert.equal(measured.line,expected.line);assert.equal(measured.chipHeight,expected.line);assert.equal(measured.chipLine,expected.line);assert.equal(measured.chipFont,size);assert.equal(measured.imageWidth,expected.image);assert.equal(measured.imageHeight,expected.image);
    assert.equal(measured.text,original.text);assert.equal(measured.imageSrc,original.imageSrc);assert.deepEqual(measured.other,original.other);
    checks.push(size+'px: prompt, label and square thumbnail scale together; other UI and prompt text unchanged');
    if(size===18){await run(`document.querySelector('.reading-card.focused').scrollIntoView({block:'start'})`);await wait(150);await fs.writeFile(path.join(root,'validation/prompt-geist-18px.png'),(await ui.webContents.capturePage()).toPNG());}
  }
  await run(`document.getElementById('theme-toggle').click();document.getElementById('prompt-font-trigger').click()`);
  await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
  await until(`document.getElementById('prompt-font-menu').hidden`);assert.equal(await run(`document.getElementById('appearance-dialog').open`),true);
  await run(`document.getElementById('appearance-palette-trigger').click();document.getElementById('appearance-title').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  assert.equal(await run(`document.getElementById('appearance-palette-menu').hidden`),true);checks.push('Escape closes the dropdown first; clicking outside closes it');
  await run(`{const input=document.getElementById('prompt-font-size');input.value='18';input.dispatchEvent(new Event('change'));document.getElementById('appearance-close').click();}`);
  const reload=()=>new Promise(resolve=>{ui.webContents.once('did-finish-load',resolve);ui.reload();});await reload();
  assert.equal(await run(`document.documentElement.dataset.promptFont`),'geist');assert.equal(await run(`getComputedStyle(document.documentElement).getPropertyValue('--prompt-font-size').trim()`),'18px');
  ui.webContents.send('lab:event',{type:'result',payload:fixture});await until(`Boolean(document.querySelector('[data-key="prompts:styleDemo"] .card-heading'))`);
  await run(`document.querySelector('[data-key="prompts:styleDemo"] .card-heading').click()`);await until(`document.querySelector('.reading-card.focused .inline-ref img')?.naturalWidth>0`);checks.push('Font and size survive reload and apply to newly created readers');
  for(const [width,height] of [[1440,960],[680,620]]){
    ui.setSize(width,height);await wait(120);await run(`document.getElementById('theme-toggle').click();document.getElementById('prompt-font-trigger').click()`);
    const bounds=await run(`(()=>{const r=document.getElementById('prompt-font-menu').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
    assert.equal(bounds.overflow,false);assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height);
    await wait(150);await fs.writeFile(path.join(root,'validation','appearance-font-menu-'+width+'.png'),(await ui.webContents.capturePage()).toPNG());
    await run(`document.getElementById('prompt-font-menu').querySelector('[data-value=geist]').click();document.getElementById('appearance-close').click()`);
  }
  ui.setSize(1440,960);await run(`{document.getElementById('theme-toggle').click();document.getElementById('prompt-font-trigger').click();document.querySelector('#prompt-font-menu [data-value=default]').click();const input=document.getElementById('prompt-font-size');input.value='14';input.dispatchEvent(new Event('change'));document.getElementById('appearance-close').click();}`);
  checks.push('Font menu fits normal and minimum window sizes; default typography is restored');
  ui.webContents.session.webRequest.onBeforeRequest(null);
  await fs.writeFile(path.join(root,'validation/prompt-font-settings-report.json'),JSON.stringify({passed:true,checks,loaded,requests,source:'Synthetic prompt and local font; original prompt data unchanged'},null,2));
  for(const check of checks)console.log('PASS '+check);
};
