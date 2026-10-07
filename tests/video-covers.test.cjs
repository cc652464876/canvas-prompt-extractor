const test=require('node:test'),assert=require('node:assert/strict');
const {buildAssets}=require('../src/assets.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const asset=id=>({id,kind:'video',url:'https://cdn.example.com/'+id+'.mp4',previewUrl:'',state:'pending',bytes:0});
test('Every video is prepared without a card, hover or playback, using four website workers',async()=>{
  const {VideoCoverQueue}=await import('../src/ui/video-cover-queue.js');let active=0,peak=0;const calls=[];
  const q=new VideoCoverQueue(async a=>{calls.push(a.id);peak=Math.max(peak,++active);await sleep(2);active--;return 'png:'+a.id;});
  q.setAssets(Array.from({length:30},(_,i)=>asset(String(i))),true);await q.whenIdle();assert.equal(calls.length,30);assert.equal(peak,4);assert.ok([...q.jobs.values()].every(j=>j.state==='ready'));
});
test('Visible-video priority and shared jobs do not duplicate covers on progress updates',async()=>{
  const {VideoCoverQueue}=await import('../src/ui/video-cover-queue.js');const calls=[],items=['A','B','C'].map(asset);
  const q=new VideoCoverQueue(async a=>{calls.push(a.id);await sleep(2);return 'png:'+a.id;});q.setAssets(items,true);q.request('C',{priority:true});q.request('C',{priority:true});await q.whenIdle();assert.deepEqual(calls,['C','A','B']);
  q.setAssets(items.map(a=>({...a,bytes:500,state:'done'})),true);await q.whenIdle();assert.equal(calls.length,3);
});
test('Changing canvas cancels stale cover work before starting the replacement',async()=>{
  const {VideoCoverQueue}=await import('../src/ui/video-cover-queue.js');let active=0,peak=0;const q=new VideoCoverQueue(async(a,signal)=>{peak=Math.max(peak,++active);try{if(a.id==='old')await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));return 'png:'+a.id;}finally{active--;}},()=>{},{concurrency:1});
  q.setAssets([asset('old')],true);await sleep(2);q.setAssets([asset('new')],true);await q.whenIdle();assert.equal(peak,1);assert.equal(q.jobs.has('old'),false);assert.equal(q.jobs.get('new').data,'png:new');
});
test('Lightweight mode cancels remote work, leaves no spinning job, and full mode resumes automatically',async()=>{
  const {VideoCoverQueue}=await import('../src/ui/video-cover-queue.js');let first=true;const q=new VideoCoverQueue(async(a,signal)=>{if(first){first=false;await new Promise((r,j)=>signal.addEventListener('abort',()=>j(new Error('cancelled')),{once:true}));}return 'png';});
  const items=[asset('A'),asset('B')];q.setAssets(items,true);await sleep(2);q.setAssets(items,false);await q.whenIdle();assert.equal(q.jobs.get('A').state,'idle');assert.equal(q.jobs.get('B').state,'ready');
  q.setAssets(items,true);await q.whenIdle();assert.ok([...q.jobs.values()].every(j=>j.state==='ready'));
});

test('Slow frame fallback stays single-worker and does not hold website poster slots',async()=>{
  const {VideoCoverQueue}=await import('../src/ui/video-cover-queue.js');let frames=0,peak=0,release;const gate=new Promise(r=>release=r);
  const q=new VideoCoverQueue(async a=>a.id.startsWith('bad')?null:'png:'+a.id,()=>{},{fallback:async a=>{peak=Math.max(peak,++frames);await gate;await sleep(2);frames--;return 'frame:'+a.id;}});
  q.setAssets(['bad1','bad2','bad3','bad4','good1','good2','good3','good4','good5'].map(asset),true);await sleep(10);
  assert.equal(frames,1);assert.ok([...q.jobs.values()].filter(j=>j.asset.id.startsWith('good')).every(j=>j.state==='ready'));
  assert.equal(q.jobs.get('bad2').state,'fallback-queued');release();await q.whenIdle();assert.equal(peak,1);assert.ok([...q.jobs.values()].every(j=>j.state==='ready'));
});

test('Switching to lightweight mode cancels both active and queued frame fallbacks',async()=>{
  const {VideoCoverQueue}=await import('../src/ui/video-cover-queue.js');let calls=0;
  const q=new VideoCoverQueue(async()=>null,()=>{},{fallback:async(a,signal)=>{calls++;await new Promise((r,j)=>signal.addEventListener('abort',()=>j(new Error('cancelled')),{once:true}));}});
  const items=['A','B','C'].map(asset);q.setAssets(items,true);await sleep(5);assert.equal(calls,1);
  q.setAssets(items,false);await q.whenIdle();assert.ok([...q.jobs.values()].every(j=>j.state==='idle'));assert.equal(calls,1);
});

test('LibTV CDN previews handle blank posters and preserve original download URLs and identities',()=>{
  const image='https://libtv-res.liblib.art/upload-images/user/image.png?token=abc';
  const video='https://libtv-res.liblib.art/upload-images/user/video.MP4?token=abc';
  const nodes=[{id:'i',type:'image',data:{url:[image]}},{id:'v',type:'video',data:{url:[video],poster:''}}];
  const previews=buildAssets({nodes},'liblib');assert.equal(previews[0].url,image);assert.equal(previews[1].url,video);
  for(const a of previews){const u=new URL(a.previewUrl);assert.equal(u.searchParams.get('token'),'abc');assert.equal(u.pathname,new URL(a.url).pathname);}
  assert.equal(new URL(previews[0].previewUrl).searchParams.get('x-oss-process'),'image/resize,w_400,m_lfit/format,webp/ignore-error,1');
  assert.equal(new URL(previews[1].previewUrl).searchParams.get('x-oss-process'),'video/snapshot,t_0,f_jpg,w_400,m_fast,ar_auto');
  assert.equal(previews[0].previewUrls[1],image);assert.equal(previews[1].fileName.endsWith('.mp4'),true);
  const {createHash}=require('node:crypto');for(const a of previews)assert.equal(a.id,createHash('sha256').update('liblib|'+new URL(a.url).origin+new URL(a.url).pathname).digest('hex').slice(0,24));
});

test('Explicit posters remain first; unknown hosts and other platforms receive no CDN processing',()=>{
  const make=(url,poster='')=>({nodes:[{id:'v',type:'video',data:{url:[url],poster}}]});
  const url='https://libtv-res.liblib.art/path/v.mp4',poster='https://cdn.example.com/cover.jpg';
  const a=buildAssets(make(url,poster),'liblib')[0];assert.equal(a.previewUrl,poster);assert.match(a.previewUrls[1],/video%2Fsnapshot/);
  assert.equal(buildAssets(make('https://another.example.com/v.mp4'),'liblib')[0].previewUrl,'');
  assert.equal(buildAssets(make(url),'jimeng')[0].previewUrl,'');
  const refs=buildAssets({nodes:[{id:'text',type:'text',data:{params:{videoList:[{url,nodeId:'missing'}],imageList:[{url:'https://libtv-res.liblib.art/path/i.png'}]}}}]},'liblib');assert.ok(refs.every(a=>a.previewUrl.includes('x-oss-process=')));
});

test('Image and video image requests share four slots; abort removes pending work',async()=>{
  const {PreviewPool}=await import('../src/ui/preview-pool.js');const pool=new PreviewPool(4);let active=0,peak=0,release;const gate=new Promise(r=>release=r),calls=[];
  const load=id=>async()=>{calls.push(id);peak=Math.max(peak,++active);try{await gate;return id;}finally{active--;}};
  const running=Array.from({length:4},(_,i)=>pool.run(load('image'+i)));const c=new AbortController();
  const cancelled=pool.run(load('cancelled'),c.signal);const pending=pool.run(load('poster'));c.abort();await assert.rejects(cancelled,{name:'AbortError'});
  await sleep(2);assert.equal(active,4);assert.equal(pool.pending.length,1);release();await Promise.all([...running,pending]);assert.equal(peak,4);assert.equal(calls.includes('cancelled'),false);
  await assert.rejects(pool.run(()=>{throw new Error('failure');}),/failure/);assert.equal(await pool.run(()=>42),42);
});
test('Failure is explicit; manual retry or a newly downloaded local file can recover it',async()=>{
  const {VideoCoverQueue}=await import('../src/ui/video-cover-queue.js');let fail=true,calls=0;const q=new VideoCoverQueue(async()=>{calls++;if(fail)throw new Error('bad video');return 'png';});
  q.setAssets([asset('A')],true);await q.whenIdle();assert.equal(q.jobs.get('A').state,'unavailable');q.setAssets([asset('A')],true);await q.whenIdle();assert.equal(calls,1);
  fail=false;q.request('A',{retry:true});await q.whenIdle();assert.equal(q.jobs.get('A').state,'ready');
  fail=true;q.setAssets([asset('B')],true);await q.whenIdle();fail=false;q.setAssets([{...asset('B'),state:'done'}],true);await q.whenIdle();assert.equal(q.jobs.get('B').state,'ready');
});
test('Video cover extraction supports alternate resolutions, cover URLs and object posters',()=>{
  const snapshot={nodes:[{id:'v',type:'video',data:{resourceId:'r',poster:{url:'https://cdn.example.com/node.jpg'}}}],mediaResources:{r:{urls:{download_url:'https://cdn.example.com/v.mp4',cover_resolution_source:{'720:720':{url:'https://cdn.example.com/large.jpg'},'480:480':{url:'https://cdn.example.com/small.jpg'}},cover_url:'https://cdn.example.com/default.jpg'}}}};
  const a=buildAssets(snapshot,'jimeng')[0];assert.equal(a.url,'https://cdn.example.com/v.mp4');assert.deepEqual(a.previewUrls,['https://cdn.example.com/small.jpg','https://cdn.example.com/default.jpg','https://cdn.example.com/large.jpg','https://cdn.example.com/node.jpg']);
  assert.equal(buildAssets({nodes:[{id:'v',type:'video',data:{url:['https://cdn.example.com/v.mp4'],poster:{url:'https://cdn.example.com/p.jpg'}}}]},'liblib')[0].previewUrl,'https://cdn.example.com/p.jpg');
});
