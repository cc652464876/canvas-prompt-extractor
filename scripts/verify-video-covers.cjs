'use strict';
const {app,BrowserWindow,ipcMain,protocol}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(os.tmpdir(),'canvas-video-covers-'+process.pid),cacheDir=path.join(profile,'covers');
app.setPath('userData',profile);
protocol.registerSchemesAsPrivileged([{scheme:'labmedia',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  await fs.mkdir(cacheDir,{recursive:true});
  const video=await fs.readFile(path.resolve(root,'../升级版_v0.5/validation/projects/liblib_蓝喵_胡来万事屋/视频_0001_视频节点 2.mp4'));
  const cached=new Map(),requests=[];let poster,fullImage,broken=true,activePosters=0,peakPosters=0;
  const assets=Array.from({length:34},(_,i)=>({id:(i+1).toString(16).padStart(24,'0'),kind:'video',name:i===0?'网站封面':i===1?'无封面自动取帧':i===2?'封面失效自动取帧':i===33?'失败与重试验证':'后台视频 '+(i+1),nodeIds:['node'+i],url:'https://cdn.example.com/video.mp4',previewUrl:i===1||i===33?'':'https://cdn.example.com/poster.png',fileName:'视频_'+i+'.mp4',state:'pending',bytes:0,total:0,source:'generated'}));
  protocol.handle('labmedia',async request=>{
    const u=new URL(request.url),id=u.pathname.slice(1);requests.push({id,type:u.hostname});
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'content-range,content-length'};
    if(u.hostname==='thumbnail'){const bytes=cached.get(id);return new Response(bytes||'',{status:bytes?200:404,headers:{...headers,'content-type':'image/png'}});}
    if(u.hostname==='preview'){peakPosters=Math.max(peakPosters,++activePosters);await wait(40);activePosters--;if(id===assets[2].id)return new Response('',{status:404,headers});return new Response(poster,{headers:{...headers,'content-type':'image/png'}});}
    if(u.hostname==='stream')return new Response(fullImage,{headers:{...headers,'content-type':'image/png'}});
    if(u.hostname==='frame'){
      if(id===assets[33].id&&broken)return new Response(Buffer.alloc(64),{headers:{...headers,'content-type':'video/mp4','content-length':'64'}});
      const match=request.headers.get('range').match(/^bytes=(\d+)-(\d+)$/),start=Number(match[1]),end=Math.min(Number(match[2]),video.length-1),bytes=video.subarray(start,end+1);
      return new Response(bytes,{status:206,headers:{...headers,'content-type':'video/mp4','content-length':String(bytes.length),'content-range':`bytes ${start}-${end}/${video.length}`}});
    }
    return new Response('',{status:404,headers});
  });
  ipcMain.handle('lab:info',()=>({ok:true,value:{outputDirectory:'封面验证目录',options:{mode:'full'}}}));
  ipcMain.handle('lab:theme',(_event,value)=>({ok:true,value}));
  ipcMain.handle('lab:thumbnail-info',(_e,id)=>({ok:true,value:cached.has(id)}));
  ipcMain.handle('lab:cache-thumbnail',async(_e,id,data)=>{const bytes=Buffer.from(data.split(',')[1],'base64');assert.equal(bytes.readUInt32BE(16),640);assert.equal(bytes.readUInt32BE(20),360);await fs.writeFile(path.join(cacheDir,id+'.png'),bytes);cached.set(id,bytes);return {ok:true,value:true};});
  const ui=new BrowserWindow({width:1440,height:1100,show:false,webPreferences:{preload:path.join(root,'src/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
  ui.webContents.on('console-message',e=>console.log('Renderer:',e.level,e.message));
  const run=code=>ui.webContents.executeJavaScript(code);
  await ui.loadFile(path.join(root,'src/ui/index.html'));
  poster=Buffer.from(await run("(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#2563c7';x.fillRect(0,0,320,180);x.fillStyle='white';x.font='28px sans-serif';x.fillText('Website cover',55,100);return c.toDataURL('image/png').split(',')[1];})()"),'base64');
  const result={schemaVersion:2,metadata:{platform:'liblib',author:'本地验证',title:'自动视频封面',inputUrl:'https://www.liblib.tv/detail/cover-test'},assets,entries:assets.map((a,i)=>({nodeId:'node'+i,kind:'video',name:a.name,prompt:'封面测试',model:'',references:[],referenceTexts:[],outputAssetIds:[a.id]})),edges:[],diagnostics:{warnings:[],nodeCount:34,counts:{video:34,image:0,audio:0,text:0}}};
  const sendResult=()=>{ui.webContents.send('lab:event',{type:'result',payload:result});ui.webContents.send('lab:event',{type:'project',payload:{root:'封面验证目录',documents:[],options:{mode:'full',split:false,kinds:['video','image','audio','text']}}});};
  sendResult();
  for(let i=0;i<220&&cached.size<33;i++)await wait(150);
  const state=await run("[...document.querySelectorAll('.content-card')].map(c=>({name:c.querySelector('.card-heading').textContent,state:c.querySelector('.cover')?.dataset.previewState,error:c.querySelector('.cover-retry')?.title}))");
  assert.equal(cached.size,33,'Auto cover count: '+JSON.stringify(state));
  assert.equal(peakPosters,4,'Website posters actually load concurrently in Electron');
  assert.equal(requests.some(r=>r.id===assets[0].id&&r.type==='frame'),false,'Website cover avoids video requests');
  assert.ok(requests.some(r=>r.id===assets[1].id&&r.type==='frame'));
  assert.ok(requests.some(r=>r.id===assets[2].id&&r.type==='frame'));
  assert.ok(cached.has(assets[32].id),'Off-page cover prepared without navigation');
  const before=requests.filter(r=>r.type==='frame').length;
  await run("document.getElementById('tab-assets').click();document.querySelector('#pagination button:last-child').click()");await wait(180);
  assert.equal(await run("document.querySelector('.content-card:last-child .cover').dataset.previewState"),'unavailable');
  broken=false;await run("document.querySelector('.content-card:last-child .cover-retry').click()");
  for(let i=0;i<220&&!cached.has(assets[33].id);i++)await wait(150);
  assert.equal(cached.size,34,'Manual retry recovers cover');
  assert.equal(await run("[...document.querySelectorAll('.content-card .cover')].every(e=>e.dataset.previewState==='ready')"),true);
  // Reading player uses the same prepared poster without starting playback.
  await run("document.querySelector('.card-heading').click()");await wait(100);
  assert.equal(await run("document.querySelector('#reading-board video').poster.startsWith('data:image/png')"),true);
  assert.equal(await run("document.querySelector('#reading-board video').getAttribute('src')"),null);
  await run("document.getElementById('clear-readers').click();document.querySelector('#pagination button:first-child').click();scrollTo(0,document.querySelector('.workspace').offsetTop)");await wait(180);
  assert.equal(await run("[...document.querySelectorAll('.cover')].every(e=>e.dataset.previewState==='ready')"),true);
  await fs.writeFile(path.join(root,'validation','UI-自动视频封面.png'),(await ui.webContents.capturePage()).toPNG());
  const frames=requests.filter(r=>r.type==='frame').length;
  await ui.reload();await wait(120);result.assets=result.assets.map(a=>({...a,bytes:12345}));sendResult();await wait(700);
  assert.equal(requests.filter(r=>r.type==='frame').length,frames,'Reload/progress reuse persisted covers');
  assert.equal(requests.filter(r=>r.type==='preview').length,32,'Reload does not request website covers again');
  // Board thumbnails must not replace the original image in reading/dialog views.
  fullImage=Buffer.from(await run("(()=>{const c=document.createElement('canvas');c.width=960;c.height=540;c.getContext('2d').fillRect(0,0,960,540);return c.toDataURL('image/png').split(',')[1];})()"),'base64');
  const imageAsset={id:'f'.repeat(24),kind:'image',name:'Original image verification',nodeIds:['image-node'],url:'https://cdn.example.com/original.png',previewUrl:'https://cdn.example.com/small.webp',fileName:'image.png',state:'pending',source:'uploaded'};
  result.assets.push(imageAsset);sendResult();await wait(120);
  await run("document.getElementById('tab-assets').click();document.querySelector('#pagination button:last-child').click();document.querySelector('.content-card:last-child .card-heading').click()");
  for(let i=0;i<40&&await run("document.querySelector('#reading-board .media-stage img')?.naturalWidth!==960");i++)await wait(50);
  assert.equal(await run("document.querySelector('#reading-board .media-stage img').src"),`labmedia://stream/${imageAsset.id}`);
  assert.equal(await run("document.querySelector('#reading-board .media-stage img').naturalWidth"),960);
  await run("document.querySelector('.content-card:last-child .preview-media').click()");
  for(let i=0;i<40&&await run("document.querySelector('#media-dialog img')?.naturalWidth!==960");i++)await wait(50);
  assert.equal(await run("document.querySelector('#media-dialog img').naturalWidth"),960);
  const checks=['All 34 videos prepared automatically, including off-page assets','Four website posters load concurrently in Electron','Website poster preferred; missing/failed poster falls back to real MP4 decoding','Generated PNGs are 640x360','Failed cover stops spinning and supports explicit retry','Reading player uses the shared poster without playing','Persisted covers reused after reload and byte-count change','Image reading and dialog views use original dimensions rather than board thumbnails'];
  await fs.writeFile(path.join(root,'validation/video-cover-report.json'),JSON.stringify({passed:true,checks,peakPosters,requests:requests.length,frameRequests:frames,initialFrameRequests:before,transport:'Existing local MP4 and generated test poster; no platform CDN requests'},null,2));
  console.log('PASS automatic video covers: real MP4 decoding, all pages, fallback, retry, cache reuse');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
