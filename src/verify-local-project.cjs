'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {app}=require('electron');
const {ProjectStore,MANIFEST}=require('./project-store.cjs');
const {normalize}=require('./normalize.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({ui,root,dialog,session,getStore,setTasks})=>{
  const out=path.join(root,'validation/local-project');await fs.mkdir(out,{recursive:true});
  const checks=[],errors=[],run=code=>ui.webContents.executeJavaScript(code);
  ui.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  const until=async code=>{for(let i=0;i<180;i++){if(await run(code))return;await wait(40);}throw new Error('Timed out: '+code);};
  const check=message=>{checks.push(message);console.log('PASS '+message);};
  await until(`document.querySelectorAll('#export-types input').length===4`);
  let requests=0;
  for(const ses of [session.defaultSession,session.fromPartition('persist:liblib'),session.fromPartition('persist:jimeng')])ses.protocol.handle('https',()=>{requests++;return new Response('Network must not be used',{status:500});});
  const result=normalize({nodes:[
    {id:'image',type:'image',data:{action:'image_generate',name:'本地图片',params:{prompt:'本地图片提示词'},url:['https://cdn.example.com/local.png']}},
    {id:'video',type:'video',data:{action:'video_generate',name:'本地视频',params:{prompt:'本地视频提示词'},url:['https://cdn.example.com/local.webm']}},
    {id:'audio',type:'audio',data:{action:'audio_generate',name:'本地音频',params:{prompt:'本地音频提示词'},url:['https://cdn.example.com/local.wav']}},
    {id:'missing',type:'image',data:{action:'image_generate',name:'缺失图片',params:{prompt:'仍能查看缺失素材的提示词'},url:['https://cdn.example.com/missing.png']}},
    {id:'pending',type:'image',data:{action:'image_generate',name:'未下载图片',params:{prompt:'未下载素材提示词'},url:['https://cdn.example.com/pending.png']}}
  ],edges:[],frameUrl:'https://www.liblib.tv/detail/local-project',source:'fixture'}, {platform:'liblib',author:'本地测试',title:'中文 空格 项目',inputUrl:'https://www.liblib.tv/detail/local-project'});
  const project=new ProjectStore(path.join(app.getPath('userData'),'saved-projects'));await project.create(result,{mode:'full',split:false,kinds:['image','video','audio']});
  const png=Buffer.from(await run(`(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#205bc0';x.fillRect(0,0,320,180);x.fillStyle='white';x.font='24px sans-serif';x.fillText('Local project',65,100);return c.toDataURL('image/png').split(',')[1];})()`),'base64');
  const video=Buffer.from(await run(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#205bc0';x.fillRect(0,0,320,180);const stream=c.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();await new Promise(resolve=>setTimeout(resolve,650));recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));})()`));
  const pcm=Buffer.alloc(44+16000);pcm.write('RIFF',0);pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(8000,24);pcm.writeUInt32LE(16000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(16000,40);
  for(const a of result.assets){if(a.nodeIds.includes('pending'))continue;const bytes=a.kind==='image'?png:a.kind==='video'?video:pcm;a.state='done';a.bytes=bytes.length;a.total=bytes.length;if(!a.nodeIds.includes('missing'))await fs.writeFile(project.assetPath(a),bytes);}
  await project.checkpoint();
  const manifest=path.join(project.directory,MANIFEST),before=await fs.readFile(manifest,'utf8');
  for(const tasks of [{task:{}},{saveTask:{}},{queue:{active:true}},{downloadSetup:true}]){setTasks(tasks);const response=await run(`window.lab.openLocalProject(${JSON.stringify(project.directory)})`);assert.equal(response.ok,false);assert.match(response.error,/先结束/);}
  setTasks({});check('Reading, saving and downloading prevent local project switching');
  const open=async input=>{await run(`document.getElementById('local-project-path').value=${JSON.stringify(input)};document.getElementById('open-local-project').click()`);await until(`!document.getElementById('open-local-project').disabled`);};
  await open('"'+project.directory+'"');
  assert.equal(await run(`document.getElementById('local-project-path').value`),manifest);assert.equal(getStore().directory,project.directory);
  assert.equal(await run(`document.getElementById('url').value`),result.metadata.inputUrl);assert.equal(await run(`document.getElementById('prompt-total').textContent`),'5');
  assert.equal(getStore().result.assets.find(a=>a.nodeIds.includes('missing')).error,'本地文件缺失或不完整');
  assert.match(await run(`document.getElementById('status').textContent`),/1 个素材文件缺失/);check('Quoted folder path loads prompts, resolves the manifest and reports missing files');
  await until(`document.querySelector('#entries img[src^="labmedia://local/"]')?.naturalWidth>0`);
  for(const kind of ['video','audio']){
    const a=getStore().result.assets.find(a=>a.kind===kind);
    const playable=await run(`(async()=>{const player=document.createElement(${JSON.stringify(kind)});player.preload='metadata';player.src='labmedia://local/${a.id}';document.body.append(player);try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Media metadata timeout')),5000);player.onloadedmetadata=()=>{clearTimeout(timer);resolve(player.duration>0);};player.onerror=()=>{clearTimeout(timer);reject(new Error('Media error'));};});}finally{player.pause();player.removeAttribute('src');player.load();player.remove();}})()`);assert.equal(playable,true);
  }
  await run(`document.querySelector('#entries .card-heading').click()`);await until(`document.querySelector('.reading-card .prompt-inner')`);assert.match(await run(`document.querySelector('.reading-card .prompt-inner').textContent`),/本地/);
  assert.equal(await fs.readFile(manifest,'utf8'),before);assert.equal(requests,0);check('Local image, video and audio load with prompts without network requests or project writes');
  for(const [width,height] of [[1440,960],[680,760]]){
    ui.setSize(width,height);await wait(200);await run("scrollTo({top:0,behavior:'instant'})");await wait(150);
    const bounds=await run(`(()=>{const r=id=>document.getElementById(id).getBoundingClientRect().toJSON();return{start:r('start'),local:r('open-local-project'),url:r('url'),path:r('local-project-path'),overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
    assert.equal(bounds.local.height,44);assert.equal(bounds.local.width,bounds.start.width);assert.equal(bounds.local.right,bounds.start.right);assert.equal(bounds.path.left,bounds.url.left);assert.equal(bounds.path.right,bounds.url.right);assert.equal(bounds.overflow,false);
    await fs.writeFile(path.join(out,'local-'+width+'.png'),(await ui.webContents.capturePage()).toPNG());
  }check('Two input rows and action buttons align at wide and narrow widths');
  const choose=dialog.showOpenDialog;let options,chooserCalls=0;
  dialog.showOpenDialog=async(_parent,opts)=>{chooserCalls++;options=opts;return {canceled:true,filePaths:[]};};
  const openedStore=getStore();
  for(const input of [manifest,project.directory,'"'+manifest+'"',manifest.toUpperCase()]){const count=chooserCalls;await open(input);assert.equal(chooserCalls,count+1);assert.equal(getStore(),openedStore);assert.equal(options.defaultPath,path.dirname(project.directory));}
  check('Clicking the current manifest or equivalent folder path opens the chooser; cancellation preserves the loaded project');
  const otherDirectory=path.join(path.dirname(project.directory),'另一个本地项目');await fs.cp(project.directory,otherDirectory,{recursive:true});
  const otherManifest=path.join(otherDirectory,MANIFEST);
  dialog.showOpenDialog=async(_parent,opts)=>{chooserCalls++;options=opts;return {canceled:false,filePaths:[otherManifest]};};
  await open(manifest);assert.equal(getStore().directory,otherDirectory);assert.equal(await run(`document.getElementById('local-project-path').value`),otherManifest);assert.equal(await run(`document.querySelectorAll('.reading-card').length`),0);check('Selecting another project from the chooser replaces the project and fills its path');
  const count=chooserCalls;await open(manifest);assert.equal(getStore().directory,project.directory);assert.equal(chooserCalls,count);check('Pasting a different JSON path loads directly without opening the chooser');
  dialog.showOpenDialog=async(_parent,opts)=>{options=opts;return {canceled:false,filePaths:[manifest]};};
  await open('');assert.equal(await run(`document.getElementById('local-project-path').value`),manifest);assert.ok(options.properties.includes('showHiddenFiles'));assert.deepEqual(options.filters[0].extensions,['json']);check('An empty path invokes file selection and fills the chosen manifest path');
  dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});await open('');assert.equal(getStore().directory,project.directory);dialog.showOpenDialog=choose;check('Cancelling file selection retains the open project');
  const original=getStore();
  await open(path.join(app.getPath('userData'),'not-found'));assert.equal(getStore(),original);assert.match(await run(`document.getElementById('status').textContent`),/不存在/);assert.equal(await run(`document.getElementById('prompt-total').textContent`),'5');
  const bad=path.join(app.getPath('userData'),'bad');await fs.mkdir(bad);await fs.writeFile(path.join(bad,MANIFEST),'{bad');await open(bad);assert.equal(getStore(),original);assert.match(await run(`document.getElementById('status').textContent`),/损坏/);check('Failed opens preserve the current project and restore usable controls');
  // Hold the chooser to prove concurrent actions cannot replace a project while opening.
  let release;dialog.showOpenDialog=()=>new Promise(resolve=>{release=resolve;});await run(`document.getElementById('local-project-path').value='';document.getElementById('open-local-project').click()`);await until(`document.getElementById('open-local-project').disabled`);
  for(const code of [`window.lab.openLocalProject(${JSON.stringify(manifest)})`,`window.lab.extract('https://www.liblib.tv/detail/other',{})`,`window.lab.save({})`,`window.lab.resetBrowser({})`,`window.lab.download({kinds:['image']})`]){const response=await run(code);assert.equal(response.ok,false);assert.match(response.error,/正在打开/);}
  assert.equal(await run(`document.getElementById('start').disabled&&document.getElementById('save-prompts').disabled&&document.getElementById('browser-reset').disabled`),true);
  release({canceled:true,filePaths:[]});await until(`!document.getElementById('open-local-project').disabled`);dialog.showOpenDialog=choose;check('Duplicate opens and competing tasks are blocked while the file chooser is active');
  const remote=getStore().result.assets.find(a=>a.nodeIds.includes('pending'));
  assert.equal(await run(`fetch('labmedia://stream/${remote.id}').then(r=>r.status)`),403);assert.equal(requests,0);
  await run(`document.getElementById('save-prompts').click()`);await until(`!document.getElementById('save-prompts').disabled`);
  assert.equal(getStore().directory,project.directory);assert.equal(getStore().documents.length,project.documents.length);check('Saving an opened project continues in its original folder');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,checks},null,2));
};
