'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {normalize,markdown,filterResult}=require('../src/normalize.cjs');
const {ProjectStore,inside}=require('../src/project-store.cjs');
const {DownloadQueue,retryAfter,prepareMedia}=require('../src/download-queue.cjs');
const {safeUrl,buildAssets}=require('../src/assets.cjs');
const meta={platform:'liblib',author:'测试作者',title:'测试项目',inputUrl:'https://www.liblib.tv/detail/test',canvasUrl:'https://www.liblib.tv/detail/test'};
const snap=nodes=>({nodes,edges:[],source:'fixture',frameUrl:meta.canvasUrl,canvasTitle:'测试画布'});
async function temp(t){const root=path.resolve(__dirname,'../validation');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'test-'));t.after(async()=>{if(path.dirname(path.resolve(dir))!==root||!path.basename(dir).startsWith('test-'))throw new Error('Unsafe test cleanup');await fs.rm(dir,{recursive:true,force:true});});return dir;}
test('Mixed ordering resolves original numbered assets instead of grouping by media type',()=>{
  const r=normalize(snap([{id:'i',type:'image',data:{name:'人物',uploaded:true,url:['https://cdn.example.com/a.png']}},{id:'a',type:'audio',data:{name:'对白',uploaded:true,url:['https://cdn.example.com/a.mp3']}},{id:'v',type:'video',data:{action:'video_generate',name:'镜头',url:['https://cdn.example.com/v.mp4'],params:{prompt:'{{Mixed 1}} {{Mixed 2}}',mixedList:[{nodeId:'a',label:'对白',mediaType:'audio'},{nodeId:'i',label:'人物',mediaType:'image'}],mixedListOrder:['i','a'],imageList:[{nodeId:'i',url:'https://cdn.example.com/a.png'}]}}}]),meta);
  const e=r.entries[0];assert.equal(e.references[0].name,'人物');assert.equal(e.references[1].type,'audio');assert.equal(e.references[0].marker,'Mixed 1');assert.equal(e.references[0].assetIds.length,1);assert.equal(r.assets.length,3);
});
test('Canonical Jimeng resource download URL is used; old batches are not downloaded',()=>{
  const s=snap([{id:'image',type:'image',data:{title:'参考图',source:'uploaded',resourceId:'current',resourceBatches:[{resourceIds:['old','current']}]}}]);s.mediaResources={current:{urls:{download_url:'https://cdn.example.com/current.png',resolution_source:{'360:360':{url:'https://cdn.example.com/thumb.webp'}}}},old:{urls:{download_url:'https://cdn.example.com/old.png'}}};
  const a=buildAssets(s,'jimeng');assert.equal(a.length,1);assert.equal(a[0].url,'https://cdn.example.com/current.png');assert.equal(a[0].source,'uploaded');assert.ok(a[0].fileName.startsWith('图片_0001_'));
});
test('Connected texts are preserved without inventing prompts, and shared text is deduplicated in category documents',()=>{
  const s=snap([{id:'global',type:'text',data:{title:'全局正向',text:'独特的全局风格'}},{id:'note',type:'text',data:{title:'作者注释',text:'作者说明'}},{id:'empty',type:'text',data:{text:''}},...['i1','i2'].map(id=>({id,type:'image',data:{title:id,generationDraft:{kind:'image',parts:[{type:'text',text:'节点输入'}],contentSettings:{},references:[]}}}))]);s.edges=[{source:'global',target:'i1'},{source:'global',target:'i2'}];
  const r=normalize(s,meta),doc=markdown(filterResult(r,['image_unknown']));assert.equal(r.diagnostics.counts.text,2);assert.equal(r.entries.find(e=>e.nodeId==='i1').referenceTexts.length,1);assert.equal(doc.split('独特的全局风格').length-1,1);assert.ok(!doc.includes('作者说明'));assert.ok(!doc.includes('!['));
});
test('Auto save, category change, historical copy, local reload, and reuse of completed assets',async t=>{
  const dir=await temp(t),r=normalize(snap([{id:'t',type:'text',data:{content:'作者正文'}},{id:'v',type:'video',data:{name:'视频',action:'video_generate',url:['https://cdn.example.com/a.mp4'],params:{prompt:'视频正文'}}}]),meta);
  const store=new ProjectStore(dir);await store.create(r,{kinds:['video','text'],split:false});const project=store.directory;
  assert.ok((await fs.readFile(path.join(project,store.documents[0]),'utf8')).includes('视频正文'));
  store.options.split=true;await store.save(true);assert.equal(store.documents.length,2);assert.ok((await fs.readdir(project)).some(n=>n.startsWith('历史_')));
  const a=r.assets[0];await fs.writeFile(store.assetPath(a),'real-test-bytes');a.state='done';a.bytes=15;await store.save();
  const loaded=new ProjectStore(dir);const read=await loaded.load(project);assert.equal(read.assets[0].state,'done');
  const newer=normalize(snap([{id:'v',type:'video',data:{action:'video_generate',url:['https://cdn.example.com/a.mp4'],params:{prompt:'更新正文'}}}]),meta);await loaded.create(newer,{kinds:['video'],split:false});assert.equal(loaded.directory,project);assert.equal(newer.assets[0].state,'done');
});
test('Path and URL checks reject traversal, executable assets and local-network literal addresses',async t=>{
  const dir=await temp(t);assert.throws(()=>inside(dir,'../escape.mp4'));assert.throws(()=>inside(dir,'bad:stream'));assert.equal(safeUrl('https://127.0.0.1/secret'),'');assert.equal(safeUrl('file:///C:/secret'),'');
});
function asset(i,kind='image'){return{id:'asset-'+i,name:'a'+i,kind,url:'https://cdn.example.com/'+i+'.'+(kind==='image'?'png':'mp3'),fileName:(kind==='image'?'图片_':'音频_')+i+'.'+(kind==='image'?'png':'mp3'),state:'pending',bytes:0};}
function response(bytes=12,delay=15){let sent=false;return new Response(new ReadableStream({async pull(c){if(sent)return;sent=true;await new Promise(r=>setTimeout(r,delay));try{const b=new Uint8Array(bytes).fill(1);b.set([137,80,78,71,13,10,26,10]);c.enqueue(b);c.close();}catch{}},cancel(){sent=true;}}),{headers:{'content-type':'image/png','content-length':String(bytes)}});}
test('Download concurrency and start spacing are bounded, and completed files are reused',async t=>{
  const dir=await temp(t),assets=Array.from({length:5},(_,i)=>asset(i)),starts=[];let active=0,peak=0;
  const q=new DownloadQueue({fetcher:async()=>{starts.push(Date.now());active++;peak=Math.max(active,peak);return response(12,30);},filePath:a=>inside(dir,a.fileName),interval:20,onSettled:async a=>{if(a)active--;}});
  const result=await q.start(assets,['image']);assert.equal(result.done,5);assert.ok(peak<=2);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=15);
  const count=starts.length;await q.start(assets,['image']);assert.equal(starts.length,count);
});
test('429 honors Retry-After and retries; failed HTML is not saved as an image',async t=>{
  const dir=await temp(t);let attempts=0;
  const q=new DownloadQueue({fetcher:async()=>++attempts===1?new Response('',{status:429,headers:{'Retry-After':'0.02'}}):response(),filePath:a=>inside(dir,a.fileName),interval:0,retryDelays:[1]});
  const a=asset(1);await q.start([a],['image']);assert.equal(a.state,'done');assert.equal(attempts,2);assert.equal(retryAfter('3'),3000);
  const bad=asset(2);const badQueue=new DownloadQueue({fetcher:async()=>new Response('login',{headers:{'content-type':'text/html'}}),filePath:a=>inside(dir,a.fileName),interval:0,retryDelays:[]});await badQueue.start([bad],['image']);assert.equal(bad.state,'failed');assert.equal((await fs.readdir(dir)).some(n=>n.includes('2.png')),false);
});
test('Pause and resume restart unfinished transfers; cancellation preserves completed work',async t=>{
  const dir=await temp(t);let paused=false;const a=asset(1);let q;
  q=new DownloadQueue({fetcher:async()=>response(12,80),filePath:a=>inside(dir,a.fileName),interval:0,onProgress:s=>{if(s.running&&!paused){paused=true;setTimeout(()=>q.pause(),5);setTimeout(()=>q.resume(),60);}}});
  await q.start([a],['image']);assert.equal(a.state,'done');assert.ok(paused);assert.ok(!(await fs.readdir(dir)).some(n=>n.endsWith('.partial')));
  const b=asset(2);const cancelled=new DownloadQueue({fetcher:async()=>response(12,80),filePath:a=>inside(dir,a.fileName),interval:0});const running=cancelled.start([b],['image']);setTimeout(()=>cancelled.cancel(),10);await running;assert.equal(b.state,'pending');assert.equal(a.state,'done');
});
test('A real MP4 served as text/plain is accepted by file header and given a playable MIME type',async()=>{
  const bytes=Buffer.alloc(64);bytes.write('ftyp',4);bytes.write('isom',8);
  const media=await prepareMedia(new Response(bytes,{headers:{'content-type':'text/plain'}}),{kind:'video',url:'https://cdn.example.com/test.mp4'});
  assert.equal(media.ext,'.mp4');assert.equal(media.contentType,'video/mp4');assert.equal((await new Response(media.stream).arrayBuffer()).byteLength,64);
  await assert.rejects(prepareMedia(new Response('<html>login page masquerading as media</html>',{headers:{'content-type':'video/mp4'}}),{kind:'video',url:'https://cdn.example.com/test.mp4'}),/文件头校验失败/);
});
