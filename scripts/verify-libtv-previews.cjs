'use strict';
// Explicit network diagnostic using public CDN addresses observed on the sample
// canvas. Uses its own Electron profile; never opens or downloads original media.
const {app,BrowserWindow,ipcMain,protocol,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {buildAssets}=require('../src/assets.cjs');
const {fetchMedia,prepareMedia}=require('../src/download-queue.cjs');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(os.tmpdir(),'canvas-libtv-previews-'+process.pid));
protocol.registerSchemesAsPrivileged([{scheme:'labmedia',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const user='50231887474e4f56b7916aae67cd47e0';
const inputs=[
  ['video',`upload-images/${user}/6f3bd310b44ceb1a8ae52a922630090a0de6e8c7.MP4`],
  ['video',`sd-gen-save-img/genius_playground/video/${user}/6a1521c98691eababf7c5e28b3c43649eb4771fc596ba56377efdeeb265c4724.mp4`],
  ['video',`sd-gen-save-img/genius_playground/video/${user}/c90c9e1599c77e36d5348f1452d87e5183083a6cb41a02ca6c79828124371130.mp4`],
  ['video',`sd-gen-save-img/genius_playground/video/${user}/983c2ccbd65f1f19932637efb7e46b9459e60794fc7f7356f238ca37b91d827c.mp4`],
  ['image',`upload-images/${user}/7d1319f57f3cce3be1bd67f8df4f95ff41070011.png`],
  ['image',`upload-images/${user}/4bf217e53033d4a8d3f8e0a047e30228d2a7e303.png`],
  ['image',`upload-images/${user}/193784f94838c1be17f21009ee5bebbcbb87b9ff.png`],
  ['image',`upload-images/${user}/d6dc1bf77c79c519386762e6b140650f9c7e2882.png`]
];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  const assets=buildAssets({nodes:inputs.map(([kind,p],i)=>({id:'node'+i,type:kind,data:{name:kind+' '+i,url:['https://libtv-res.liblib.art/'+p],poster:''}}))},'liblib');
  const cached=new Map(),requests=[];let active=0,peak=0,frames=0;
  protocol.handle('labmedia',async request=>{
    const u=new URL(request.url),asset=assets.find(a=>a.id===u.pathname.slice(1)),cors={'Access-Control-Allow-Origin':'*'};
    if(!asset)return new Response('',{status:404});
    if(u.hostname==='thumbnail')return new Response(cached.get(asset.id)||'',{status:cached.has(asset.id)?200:404,headers:{...cors,'content-type':'image/png'}});
    if(u.hostname==='frame'){frames++;return new Response('',{status:404});}
    if(u.hostname!=='preview')return new Response('',{status:404});
    const index=Number(u.searchParams.get('index')||0),url=asset.previewUrls[index];
    assert.ok(new URL(url).searchParams.get('x-oss-process'),'Original media must never be fetched in this diagnostic');
    peak=Math.max(peak,++active);const started=Date.now(),entry={kind:asset.kind};requests.push(entry);
    try{
      const response=await fetchMedia((target,options)=>session.defaultSession.fetch(target,{...options,headers:{...options.headers,Referer:'https://www.liblib.tv/'}}),url,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(18000)])});
      entry.status=response.status;if(!response.ok){await response.body?.cancel();return new Response('',{status:502});}
      const media=await prepareMedia(response,{...asset,kind:'image'});
      const bytes=await new Response(media.stream).arrayBuffer();entry.bytes=bytes.byteLength;entry.mime=media.contentType;
      assert.ok(entry.bytes<1024*1024,'Preview stays below 1 MiB');assert.match(entry.mime,/^image\//);
      return new Response(bytes,{headers:{...cors,'content-type':media.contentType}});
    }catch(error){entry.error=error.message;return new Response('',{status:502});}
    finally{active--;entry.ms=Date.now()-started;}
  });
  ipcMain.handle('lab:info',()=>({ok:true,value:{options:{mode:'full'}}}));
  ipcMain.handle('lab:thumbnail-info',(_e,id)=>({ok:true,value:cached.has(id)}));
  ipcMain.handle('lab:cache-thumbnail',(_e,id,data)=>{cached.set(id,Buffer.from(data.split(',')[1],'base64'));return {ok:true,value:true};});
  const ui=new BrowserWindow({width:1440,height:1100,show:false,webPreferences:{preload:path.join(root,'src/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
  await ui.loadFile(path.join(root,'src/ui/index.html'));
  const result={schemaVersion:2,metadata:{platform:'liblib',title:'LibTV 网站缩略图验证',inputUrl:'https://www.liblib.tv/canvas?projectId=bba158d0881c4a0f8a2fd5c015d694b2'},assets,entries:[],edges:[],diagnostics:{warnings:[],nodeCount:8,counts:{video:4,image:4,audio:0,text:0}}};
  ui.webContents.send('lab:event',{type:'result',payload:result});ui.webContents.send('lab:event',{type:'project',payload:{root:'诊断',documents:[],options:{mode:'full',split:false,kinds:['video','image']}}});
  await ui.webContents.executeJavaScript("document.getElementById('tab-assets').click();document.querySelector('.workspace').scrollIntoView()");
  let states=[];
  for(let i=0;i<300;i++){
    await wait(150);states=await ui.webContents.executeJavaScript("[...document.querySelectorAll('.content-card .cover')].map(e=>({state:e.dataset.previewState,width:e.querySelector('img')?.naturalWidth,height:e.querySelector('img')?.naturalHeight}))");
    if(states.length===8&&states.every(e=>['ready','unavailable'].includes(e.state)))break;
  }
  const passed=states.length===8&&states.every(e=>e.state==='ready')&&frames===0&&requests.length===8;
  await fs.writeFile(path.join(root,'validation/libtv-preview-report.json'),JSON.stringify({passed,canvas:result.metadata.inputUrl,states,requests,peakImageRequests:peak,frameRequests:frames,originalMediaRequests:0},null,2));
  assert.ok(passed,'Real CDN preview report: '+JSON.stringify({states,requests,frames}));
  assert.ok(peak<=4,'Shared four image slots');
  await fs.writeFile(path.join(root,'validation/UI-LibTV-网站缩略图.png'),(await ui.webContents.capturePage()).toPNG());
  console.log('PASS real LibTV previews: 4 videos + 4 images, image responses, no video sampling or original media requests');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
