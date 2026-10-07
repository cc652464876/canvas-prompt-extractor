'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function({root,runExtraction,getWindow,getFeedback,ui}){
  const url='https://www.liblib.tv/detail/444785af178546a3af691a59da588019';
  const samples=[],stages=new Set();let sampling=false,closeChecked=false,popupChecked=false,openingCaptured=false,canvasCaptured=false;
  const sample=async()=>{
    const win=getWindow(),feedback=getFeedback();if(!win||win.isDestroyed()||!feedback?.ready||feedback.overlay.isDestroyed()||sampling)return;
    sampling=true;
    try{
      const state=await win.webContents.executeJavaScript("({url:location.href,media:[...document.querySelectorAll('video,audio')].map(e=>({volume:e.volume,muted:e.muted})),canvas:Boolean(document.querySelector('.react-flow')),video:Boolean(document.querySelector('video')),websiteOverlay:Boolean(document.getElementById('canvas-extraction-feedback'))})");
      const panel=await feedback.overlay.webContents.executeJavaScript("({heading:document.getElementById('heading').textContent,theme:document.documentElement.dataset.theme})");
      const p=win.getContentBounds(),o=feedback.overlay.getBounds();
      Object.assign(state,panel,{audioMuted:win.webContents.isAudioMuted(),overlayVisible:feedback.overlay.isVisible(),overlayIndependent:feedback.overlay.getParentWindow()===win,centerOffset:[(o.x+o.width/2)-(p.x+p.width/2),(o.y+o.height/2)-(p.y+p.height/2)]});
      samples.push(state);if(state.heading)stages.add(state.heading);
      assert.equal(state.websiteOverlay,false);assert.equal(state.overlayIndependent,true);assert.ok(state.centerOffset.every(n=>Math.abs(n)<=1));
      if(feedback.active)assert.equal(state.audioMuted,true);
      if(state.video&&!openingCaptured&&state.overlayVisible){openingCaptured=true;await wait(100);await fs.writeFile(path.join(root,'validation/独立浮层-LibTV页面打开.png'),(await feedback.overlay.webContents.capturePage()).toPNG());}
      if(state.canvas&&!canvasCaptured&&state.overlayVisible){canvasCaptured=true;await fs.writeFile(path.join(root,'validation/独立浮层-LibTV画布提取.png'),(await feedback.overlay.webContents.capturePage()).toPNG());}
      if(state.video&&!closeChecked&&feedback.active){closeChecked=true;win.close();assert.equal(win.isDestroyed(),false);assert.equal(win.isVisible(),true);}
      if(state.video&&!popupChecked&&feedback.active){
        popupChecked=true;const before=win.webContents.getURL();let created=false;
        const onCreated=()=>{created=true;};win.webContents.on('did-create-window',onCreated);
        try{await win.webContents.executeJavaScript("window.open('https://www.liblib.tv/activity/test-extraction-popup')");await wait(100);assert.equal(created,false);assert.equal(win.webContents.getURL(),before);}
        finally{win.webContents.removeListener('did-create-window',onCreated);}
      }
    }catch(error){if(error.code==='ERR_ASSERTION')samples.push({assertion:error.message});}
    finally{sampling=false;}
  };
  const timer=setInterval(()=>void sample(),180);let result,error,themeSynced=false,retryAfterDismiss=false,closeContinues=false;
  try{
    result=await runExtraction(url,{visible:true,mode:'full'});while(sampling)await wait(30);await sample();
    const first=getFeedback();await wait(120);
    await fs.writeFile(path.join(root,'validation/独立浮层-LibTV浅色完成.png'),(await first.overlay.webContents.capturePage()).toPNG());
    await ui.webContents.executeJavaScript("document.querySelector('[data-appearance-mode=dark]').click()");await wait(200);
    const uiTheme=await ui.webContents.executeJavaScript('document.documentElement.dataset.theme');
    themeSynced=(await first.overlay.webContents.executeJavaScript('document.documentElement.dataset.theme'))===uiTheme&&uiTheme==='dark';assert.equal(themeSynced,true);
    await fs.writeFile(path.join(root,'validation/独立浮层-LibTV深色完成.png'),(await first.overlay.webContents.capturePage()).toPNG());
    // Repeat the real read with the same page, dismiss the new panel while its
    // task is still active, and check it remains dismissed through completion.
    const repeated=runExtraction(url,{visible:true,mode:'full'});
    for(let i=0;i<100;i++){if(getFeedback()!==first&&getFeedback()?.ready)break;await wait(25);}
    const second=getFeedback();assert.notEqual(second,first);assert.equal(second.active,true);assert.equal(second.closed,false);retryAfterDismiss=second.overlay.isVisible();
    await second.overlay.webContents.executeJavaScript("document.getElementById('close').click()");await wait(70);
    assert.equal(second.closed,true);assert.equal(second.active,true);assert.equal(second.overlay.isVisible(),false);
    const again=await repeated;closeContinues=again.diagnostics.nodeCount===result.diagnostics.nodeCount&&again.entries.length===result.entries.length&&second.closed&&!second.overlay.isVisible();assert.equal(closeContinues,true);
  }catch(e){error=e.message;}
  finally{clearInterval(timer);while(sampling)await wait(30);}
  const win=getWindow();
  const report={passed:Boolean(result)&&!error&&!samples.some(s=>s.assertion),url,error,stages:[...stages],closeChecked,popupChecked,openingCaptured,canvasCaptured,themeSynced,retryAfterDismiss,closeContinues,counts:result?{nodes:result.diagnostics.nodeCount,prompts:result.entries.length,assets:result.assets.length}:null,audioRestored:win&&!win.isDestroyed()&&!win.webContents.isAudioMuted(),samples};
  await fs.writeFile(path.join(root,'validation/extraction-live-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,samples:report.samples.length}));assert.ok(report.passed,'Real extraction failed: '+error);assert.ok(report.audioRestored,'Audio mute must be restored');
  // Quit with a visible local child, exercising the real UI-close/app.quit path.
  const last=getFeedback();last.closed=false;last.syncVisibility();assert.equal(last.overlay.isVisible(),true);
};
