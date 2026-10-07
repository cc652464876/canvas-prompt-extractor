(()=>{
'use strict';
// view-model.js
const TYPES={video:'视频提示词',image:'图片提示词',audio:'音频提示词',text:'独立文本'};
function promptKind(kind){return kind==='image'||String(kind).startsWith('image_')?'image':kind;}
const MEDIA={image:'图片',video:'视频',audio:'音频'};
const SOURCE={uploaded:'上传参考',generated:'生成结果',unknown:'来源未确认'};
function aspect(asset){const w=Number(asset?.width),h=Number(asset?.height);if(w>0&&h>0&&w<=32768&&h<=32768)return w/h;const m=String(asset?.ratio||'').match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);return m&&Number(m[1])>0&&Number(m[2])>0?Number(m[1])/Number(m[2]):16/9;}
function filtered(result,scope,kind,query=''){if(!result)return[];const q=query.trim().toLowerCase();return(scope==='assets'?result.assets:result.entries).filter(item=>{const category=scope==='assets'?item.kind:promptKind(item.kind);return(kind instanceof Set?kind.has(category)||kind.has(item.kind):Array.isArray(kind)?kind.includes(category)||kind.includes(item.kind):kind==='all'||category===kind||item.kind===kind)&&[item.name,item.group,item.prompt,MEDIA[category],TYPES[category],...(item.referenceTexts||[]).map(r=>r.text)].filter(Boolean).join(' ').toLowerCase().includes(q);});}
function countKinds(items,keys){return Object.fromEntries(keys.map(k=>[k,items.filter(i=>promptKind(i.kind)===k).length]));}
function downloadMetrics(assets,kind,progress){const fresh=new Map((progress?.files||[]).map(a=>[a.id,a]));const files=assets.filter(a=>a.kind===kind).map(a=>({...a,...fresh.get(a.id)}));const done=files.filter(a=>a.state==='done').length,total=files.length,failed=files.filter(a=>['failed','unavailable'].includes(a.state)).length;return{done,total,failed,percent:total?done/total*100:0,speed:progress?.active&&!progress.paused?progress.speeds?.[kind]||0:0};}
function downloadState(assets,kinds,progress){const selected=assets.filter(a=>kinds.includes(a.kind)),done=selected.filter(a=>a.state==='done').length,failed=selected.filter(a=>['failed','unavailable'].includes(a.state)).length;
  if(progress?.active)return{label:progress.paused?'下载已暂停':'正在下载',button:'停止下载',done,total:selected.length,failed,complete:false};
  const complete=selected.length>0&&done===selected.length;return{label:complete?'下载完毕':!selected.length?'未选择素材':done?'部分素材已保存':'等待下载',button:complete?'重新下载':'开始下载',done,total:selected.length,failed,complete};}
function pageSize(columns){return columns===0?36:Math.max(24,columns*6);}
const READ_LAYOUTS=['side','stack','dual'];
function readingLayout(preferred,width){if(!READ_LAYOUTS.includes(preferred))preferred='dual';return preferred==='dual'&&width>=1120?'dual':preferred==='side'&&width>=1020?'side':'stack';}
function textColumns(items,width){const maxLength=Math.max(0,...items.map(i=>String(i.name||'').length+String(i.model||'').length));const minimum=Math.min(460,Math.max(340,maxLength*7+85));return Math.max(1,Math.min(4,Math.floor(width/minimum)));}
function normalizeDensity(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(10,Math.round(n))):5;}
function snapHeight(height,unit){const bounded=Math.max(140,Math.min(1200,height));if(!unit||unit<100)return Math.round(bounded);const target=Math.round(bounded/unit)*unit;return target>=140&&target<=1200&&Math.abs(target-bounded)<=24?Math.round(target):Math.round(bounded);}

// reader-targets.js
// Keep the clicked node identity even when assets share the same file.
function readerTarget(result,scope,item,nodeId){
  if(scope==='prompts')return{scope,item,nodeId:item.nodeId,key:'prompts:'+item.nodeId};
  const ids=item.nodeIds||[];
  const targetId=nodeId||(ids.length===1?ids[0]:null);
  const entry=targetId?result?.entries.find(e=>e.nodeId===targetId):null;
  if(entry)return readerTarget(result,'prompts',entry);
  return{scope:'assets',item,nodeId:targetId,key:targetId?'asset-node:'+targetId:'assets:'+item.id};
}

function referencingEntries(result,nodeId,assetIds=[]){
  const seen=new Set();
  return(result?.entries||[]).filter(entry=>{
    if(entry.nodeId===nodeId||seen.has(entry.nodeId))return false;
    const referenced=(entry.references||[]).some(ref=>nodeId?ref.nodeId===nodeId:(ref.assetIds||[]).some(id=>assetIds.includes(id)));
    if(referenced)seen.add(entry.nodeId);
    return referenced;
  });
}

// prompt-display.js
// Dreamina's inline media labels keep the start and end of a long name.
function promptReferenceLabel(name){
  const chars=Array.from(String(name||'未命名参考'));
  return chars.length>12?chars.slice(0,5).join('')+'…'+chars.slice(-5).join(''):chars.join('');
}

// video-sample.js
// MP4 metadata can live at the end of a file. Build a bounded, temporary
// first-frame sample, moving that metadata before the available media bytes.
function mp4FrameSample(head,tail,total){
  const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength),type=(b,p)=>String.fromCharCode(...b.subarray(p+4,p+8));let p=0,mdat=-1,moov;
  while(p+8<=head.length){const n=view(head).getUint32(p);if(n<8)break;const t=type(head,p);if(t==='moov'&&p+n<=head.length)moov=head.slice(p,p+n);if(t==='mdat'){mdat=p;break;}p+=n;}
  if(mdat<0)throw new Error('当前视频格式不支持轻量封面');
  if(moov){const out=head.slice();view(out).setUint32(mdat,out.length-mdat);return out;}
  for(let i=0;i+8<=tail.length;i++){if(type(tail,i)!=='moov')continue;const size=view(tail).getUint32(i),absolute=total-tail.length+i;if(size>=8&&i+size<=tail.length&&absolute>=mdat){moov=tail.slice(i,i+size);break;}}
  if(!moov)throw new Error('视频元信息超出封面读取范围');
  const containers=new Set(['moov','trak','mdia','minf','stbl']);
  function relocate(start,end){for(let at=start;at+8<=end;){const n=view(moov).getUint32(at);if(n<8||at+n>end)throw new Error('无效的视频元信息');const t=type(moov,at);if(containers.has(t))relocate(at+8,at+n);else if(t==='stco'||t==='co64'){const v=view(moov),count=v.getUint32(at+12),stride=t==='stco'?4:8;if(at+16+count*stride>at+n)throw new Error('无效的视频偏移表');for(let i=0;i<count;i++){const off=at+16+i*stride;if(stride===4){const shifted=v.getUint32(off)+moov.length;if(shifted>0xffffffff)throw new Error('视频过大');v.setUint32(off,shifted);}else v.setBigUint64(off,v.getBigUint64(off)+BigInt(moov.length));}}at+=n;}}
  relocate(0,moov.length);const media=head.slice(mdat);view(media).setUint32(0,media.length);const out=new Uint8Array(head.length+moov.length);out.set(head.subarray(0,mdat));out.set(moov,mdat);out.set(media,mdat+moov.length);return out;
}
function remoteFrameSource(asset,signal){return (async()=>{const parts=[];let total=0;
  for(let i=0;i<4;i++){const response=await fetch(`labmedia://frame/${asset.id}`,{signal,headers:{Range:`bytes=${i*1048576}-${(i+1)*1048576-1}`}});if(!response.ok)throw new Error('无法按需读取视频');const range=response.headers.get('content-range'),match=range?.match(/\/(\d+)$/);total=match?Number(match[1]):Number(response.headers.get('content-length'));const bytes=new Uint8Array(await response.arrayBuffer());parts.push(bytes);if(response.status!==206||!total||(i+1)*1048576>=total)break;}
  const length=parts.reduce((n,p)=>n+p.length,0),head=new Uint8Array(length);let offset=0;for(const part of parts){head.set(part,offset);offset+=part.length;}
  if(total<=head.length)return URL.createObjectURL(new Blob([head],{type:'video/mp4'}));
  const response=await fetch(`labmedia://frame/${asset.id}`,{signal,headers:{Range:`bytes=${Math.max(0,total-262144)}-${total-1}`}});if(!response.ok)throw new Error('视频元信息暂不可用');const tail=new Uint8Array(await response.arrayBuffer());return URL.createObjectURL(new Blob([mp4FrameSample(head,tail,total)],{type:'video/mp4'}));
})();}

// preview-pool.js
// Shared by image thumbnails and video poster images, including their bodies.
class PreviewPool {
  constructor(limit=4){this.limit=limit;this.active=0;this.pending=[];}
  run(task,signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new DOMException('已取消','AbortError'));return;}
      const job={task,signal,resolve,reject,abort:()=>{
        const index=this.pending.indexOf(job);if(index<0)return;
        this.pending.splice(index,1);signal.removeEventListener('abort',job.abort);reject(new DOMException('已取消','AbortError'));
      }};
      signal?.addEventListener('abort',job.abort,{once:true});this.pending.push(job);this.pump();
    });
  }
  pump(){
    while(this.active<this.limit&&this.pending.length){
      const job=this.pending.shift();job.signal?.removeEventListener('abort',job.abort);this.active++;
      Promise.resolve().then(()=>{if(job.signal?.aborted)throw new DOMException('已取消','AbortError');return job.task();})
        .then(job.resolve,job.reject).finally(()=>{this.active--;this.pump();});
    }
  }
}

// video-cover-queue.js
// Website images and video decoding have independent concurrency limits.
class VideoCoverQueue {
  constructor(load,onChange=()=>{},{concurrency=4,fallback=null}={}){
    this.load=load;this.onChange=onChange;this.concurrency=concurrency;this.fallback=fallback;
    this.jobs=new Map();this.active=0;this.frames=0;this.scheduled=false;this.full=false;this.idleWaiters=[];
  }
  eligible(job){return this.full||job.asset.state==='done';}
  emit(job){this.onChange(job);}
  setAssets(assets,full){
    this.full=full;const keep=new Set();
    for(const asset of assets.filter(a=>a.kind==='video')){
      keep.add(asset.id);const source=JSON.stringify([asset.url,asset.previewUrl,asset.previewUrls]);let job=this.jobs.get(asset.id);
      const becameLocal=job&&job.asset.state!=='done'&&asset.state==='done';
      if(job&&job.source!==source){job.controller?.abort();this.jobs.delete(asset.id);job=null;}
      if(!job){job={asset,source,state:'idle',data:'',error:'',priority:0};this.jobs.set(asset.id,job);}else job.asset=asset;
      if(!this.eligible(job)){job.controller?.abort();if(['queued','fallback-queued'].includes(job.state))job.state='idle';}
      if(this.eligible(job)&&(job.state==='idle'||becameLocal&&job.state==='unavailable')){job.error='';job.state='queued';}
      this.emit(job);
    }
    for(const[id,job]of this.jobs)if(!keep.has(id)){job.controller?.abort();this.jobs.delete(id);}
    this.schedule();
  }
  request(id,{priority=false,retry=false}={}){
    const job=this.jobs.get(id);if(!job)return;
    if(priority)job.priority=1;
    if(retry&&job.state==='unavailable'&&this.eligible(job)){job.error='';job.state='queued';this.emit(job);}
    this.schedule();
  }
  schedule(){if(!this.scheduled){this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.pump();});}}
  pick(state){const jobs=[...this.jobs.values()].filter(j=>j.state===state&&this.eligible(j));return jobs.find(j=>j.priority)||jobs[0];}
  pump(){
    let job;
    while(this.active<this.concurrency&&(job=this.pick('queued')))this.start(job,false);
    if(!this.frames&&(job=this.pick('fallback-queued')))this.start(job,true);
    if(!this.active&&!this.frames&&!this.scheduled)for(const resolve of this.idleWaiters.splice(0))resolve();
  }
  async start(job,isFrame){
    const controller=new AbortController();job.controller=controller;job.state=isFrame?'generating':'loading';
    if(isFrame)this.frames++;else this.active++;this.emit(job);
    try{
      const data=await (isFrame?this.fallback:this.load)(job.asset,controller.signal);
      if(!data)throw new Error('未取得可用画面');
      if(!controller.signal.aborted){job.data=data;job.error='';job.state='ready';}
    }catch(error){
      job.error=error.message;
      job.state=controller.signal.aborted?'idle':!isFrame&&this.fallback?'fallback-queued':'unavailable';
    }finally{
      job.controller=null;if(isFrame)this.frames--;else this.active--;
      if(this.jobs.get(job.asset.id)===job){
        if(controller.signal.aborted)job.state=this.eligible(job)?'queued':'idle';
        this.emit(job);
      }
      this.schedule();
    }
  }
  whenIdle(){if(!this.scheduled&&!this.active&&!this.frames)return Promise.resolve();return new Promise(resolve=>this.idleWaiters.push(resolve));}
}

// thumbnails.js



const imageCache=new Map(),videoBindings=new Set();
const previewLoads=new PreviewPool(4);
let work=[],running=0;
const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);entry.target._startThumbnail?.();}},{rootMargin:'180px'});
function put(key,value){imageCache.set(key,value);if(imageCache.size>200)imageCache.delete(imageCache.keys().next().value);}
function queue(node,task){work.push({node,task});pump();}
function pump(){while(running<4&&work.length){const job=work.shift();if(!job.node.isConnected)continue;running++;Promise.resolve().then(job.task).catch(()=>{}).finally(()=>{running--;pump();});}}
function loadImage(image,url){return previewLoads.run(()=>new Promise(resolve=>{
  const finish=ok=>{clearTimeout(timer);image.onload=image.onerror=null;if(ok)image.hidden=false;else image.removeAttribute('src');resolve(ok);};
  const timer=setTimeout(()=>finish(false),20000);image.onload=()=>finish(true);image.onerror=()=>finish(false);image.src=url;
}));}
function coverPng(source,width,height){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const c=canvas.getContext('2d');c.fillStyle='#151515';c.fillRect(0,0,640,360);
  const ratio=width/height,w=Math.min(640,360*ratio),h=w/ratio;
  c.drawImage(source,(640-w)/2,(360-h)/2,w,h);return canvas.toDataURL('image/png');
}
function coverImage(url,signal){return previewLoads.run(()=>new Promise((resolve,reject)=>{
  const image=new Image();image.crossOrigin='anonymous';let finished=false;
  const finish=(error,data)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);image.onload=image.onerror=null;if(error){image.removeAttribute('src');reject(error);}else resolve(data);};
  const abort=()=>finish(new DOMException('封面任务已取消','AbortError'));
  const timer=setTimeout(()=>finish(new Error('网站封面加载超时')),20000);
  image.onload=()=>{try{finish(null,coverPng(image,image.naturalWidth,image.naturalHeight));}catch(error){finish(error);}};
  image.onerror=()=>finish(new Error('网站封面加载失败'));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else image.src=url;
}),signal);}
async function frame(asset,signal){
  if(asset.state!=='done'&&!asset.url)throw new Error('素材地址不可用');
  const video=document.createElement('video'),controller=new AbortController();video.muted=true;video.preload='metadata';video.crossOrigin='anonymous';let blobUrl,abort;
  try{return await new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(error,data)=>{if(finished)return;finished=true;clearTimeout(timer);if(error)reject(error);else resolve(data);};
    const timer=setTimeout(()=>finish(new Error('视频封面生成超时')),30000);
    abort=()=>finish(new DOMException('封面任务已取消','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
    const capture=()=>{if(video.readyState<2||!video.videoWidth||!video.videoHeight)return;try{finish(null,coverPng(video,video.videoWidth,video.videoHeight));}catch(error){finish(error);}};
    video.onerror=()=>finish(new Error('视频无法解码或读取'));
    video.onloadedmetadata=()=>{video.currentTime=Math.min(.1,(video.duration||1)/2);};
    video.onseeked=capture;video.onloadeddata=()=>{if(!video.seeking)capture();};
    if(asset.state==='done'){video.src=`labmedia://local/${asset.id}`;video.load();}
    else remoteFrameSource(asset,controller.signal).then(url=>{if(finished){URL.revokeObjectURL(url);return;}blobUrl=url;video.src=url;video.load();},error=>finish(error));
  });}finally{if(abort)signal.removeEventListener('abort',abort);controller.abort();video.pause();video.removeAttribute('src');video.load();if(blobUrl)URL.revokeObjectURL(blobUrl);}
}
async function saveCover(asset,data,signal){
  if(signal.aborted)throw new DOMException('已取消','AbortError');
  await window.lab.cacheThumbnail(asset.id,data).catch(()=>{});return data;
}
async function prepareCover(asset,signal){
  const cached=await window.lab.thumbnailInfo(asset.id);if(signal.aborted)throw new DOMException('已取消','AbortError');
  if(cached.ok&&cached.value){try{return await coverImage(`labmedia://thumbnail/${asset.id}`,signal);}catch(error){if(signal.aborted)throw error;}}
  let data;
  const candidates=asset.previewUrls?.length?asset.previewUrls:(asset.previewUrl?[asset.previewUrl]:[]);
  if(asset.state!=='done')for(let index=0;index<Math.min(3,candidates.length);index++){
    try{data=await coverImage(`labmedia://preview/${asset.id}${asset.previewUrls?.length?'?index='+index:''}`,signal);break;}catch(error){if(signal.aborted)throw error;}
  }
  return data?saveCover(asset,data,signal):null;
}
const videoCovers=new VideoCoverQueue(prepareCover,job=>{
  for(const binding of [...videoBindings]){if(!binding.node.isConnected){videoBindings.delete(binding);continue;}if(binding.id===job.asset.id)binding.update(job);}
},{concurrency:4,fallback:async(asset,signal)=>saveCover(asset,await frame(asset,signal),signal)});
function prepareVideoThumbnails(assets,{full=false}={}){videoCovers.setAssets(assets,full);}
function clearVideoThumbnails(){videoCovers.setAssets([],false);imageCache.clear();resetThumbnailJobs();}
function ensureVideo(asset,full){if(!videoCovers.jobs.has(asset.id))videoCovers.setAssets([...videoCovers.jobs.values()].map(j=>j.asset).concat(asset),full);}
function bindVideoPoster(player,asset,{full=false}={}){
  ensureVideo(asset,full);
  const binding={node:player,id:asset.id,update:job=>{if(job.data)player.poster=job.data;}};
  videoBindings.add(binding);binding.update(videoCovers.jobs.get(asset.id));videoCovers.request(asset.id,{priority:true});
  if(!full&&asset.state!=='done')window.lab.thumbnailInfo(asset.id).then(r=>{if(player.isConnected&&r.ok&&r.value)player.poster=`labmedia://thumbnail/${asset.id}`;}).catch(()=>{});
}
function attachThumbnail(container,asset,{full=false,immediate=false}={}){
  if(!asset||asset.kind==='audio')return null;
  const image=document.createElement('img');image.alt=asset.name;image.decoding='async';image.hidden=true;container.append(image);
  if(asset.kind==='video'){
    ensureVideo(asset,full);let simpleChecked=false;
    const caption=container.classList.contains('cover')?document.createElement('span'):null;
    const retry=caption?document.createElement('button'):null;
    if(caption){caption.className='video-cover-state';container.append(caption);retry.type='button';retry.className='cover-retry';retry.textContent='重试封面';retry.hidden=true;retry.addEventListener('click',e=>{e.stopPropagation();videoCovers.request(asset.id,{priority:true,retry:true});});container.append(retry);}
    const binding={node:container,id:asset.id,update:job=>{
      const ready=Boolean(job.data)||Boolean(image.naturalWidth);container.dataset.previewState=ready?'ready':job.state;
      if(job.data&&image.src!==job.data){image.src=job.data;image.hidden=false;}
      if(caption){caption.hidden=ready;caption.textContent=job.state==='unavailable'?'封面暂不可用':job.state==='loading'?'正在加载封面':job.state==='generating'?'正在生成封面':job.state==='fallback-queued'?'等待生成封面':job.state==='idle'?'本地封面不可用':'等待加载封面';retry.hidden=job.state!=='unavailable'||ready;retry.title=job.error||'';}
      if(job.state==='idle'&&!simpleChecked){simpleChecked=true;window.lab.thumbnailInfo(asset.id).then(async r=>{if(container.isConnected&&r.ok&&r.value&&await loadImage(image,`labmedia://thumbnail/${asset.id}`)){container.dataset.previewState='ready';if(caption)caption.hidden=true;}}).catch(()=>{});}
    }};
    videoBindings.add(binding);binding.update(videoCovers.jobs.get(asset.id));
    container._startThumbnail=()=>videoCovers.request(asset.id,{priority:true});
    if(immediate)container._startThumbnail();else observer.observe(container);
    return image;
  }
  const key=asset.id+'|'+asset.bytes;let starting=false;
  const state=value=>{container.dataset.previewState=value;const label=container.querySelector('.placeholder span');if(label)label.textContent=value==='loading'?'正在读取预览':value==='unavailable'?'预览暂不可用':'图片预览';};
  const start=()=>{if(starting)return;starting=true;queue(image,async()=>{
    if(imageCache.has(key)){state('loading');const ok=await loadImage(image,imageCache.get(key));state(ok?'ready':'unavailable');return;}
    const urls=asset.state==='done'?[`labmedia://local/${asset.id}`]:full&&asset.previewUrl?(asset.previewUrls?.length?asset.previewUrls.slice(0,3).map((_,i)=>`labmedia://preview/${asset.id}?index=${i}`):[`labmedia://preview/${asset.id}`]):[];
    for(const url of urls){state('loading');if(await loadImage(image,url)){put(key,url);state('ready');return;}}
    state('unavailable');
  });};
  container._startThumbnail=start;if(immediate)requestAnimationFrame(start);else observer.observe(container);return image;
}
function resetThumbnailJobs(){work=work.filter(job=>job.node.isConnected);for(const b of [...videoBindings])if(!b.node.isConnected)videoBindings.delete(b);}

// interactions.js
let openMediaPreview=()=>{},closeMediaPreview=()=>{},activePreviewAnchor=null;
function imageRect(image){const r=image.getBoundingClientRect(),ratio=image.naturalWidth/image.naturalHeight;if(!ratio)return r;const w=Math.min(r.width,r.height*ratio),h=w/ratio;return{left:r.left+(r.width-w)/2,top:r.top+(r.height-h)/2,width:w,height:h,right:r.left+(r.width+w)/2,bottom:r.top+(r.height+h)/2};}
function conditionalTitle(node){const update=()=>{if(!node.isConnected)return;const clipped=node.scrollWidth>node.clientWidth+1||[...node.children].some(c=>c.scrollWidth>c.clientWidth+1);if(clipped)node.title=node.textContent;else node.removeAttribute('title');};node.addEventListener('mouseenter',update);node.addEventListener('focus',update);}
function bindSmallPreview(container,image,asset,context){
  const preview=document.getElementById('hover-preview');let timer,inside=false;
  const show=()=>{if(!inside||!image?.naturalWidth)return;const shown=imageRect(image),w=Math.min(460,innerWidth-32),h=Math.min(300,innerHeight-80),ratio=image.naturalWidth/image.naturalHeight,pw=Math.min(w-16,h*ratio),ph=pw/ratio;if(pw<=shown.width*1.12||ph<=shown.height*1.12){preview.hidden=true;return;}const anchor=container.getBoundingClientRect(),width=pw+16,height=ph+43,gap=12;let x=anchor.right+gap;if(x+width>innerWidth-12)x=anchor.left-width-gap;if(x<12)x=Math.max(12,Math.min(innerWidth-width-12,anchor.left));const y=Math.max(12,Math.min(innerHeight-height-12,anchor.top));preview.style.width=width+'px';preview.querySelector('img').style.height=ph+'px';preview.querySelector('img').src=image.currentSrc||image.src;preview.querySelector('div').textContent=asset.name;preview.style.left=x+'px';preview.style.top=y+'px';preview.hidden=false;activePreviewAnchor=container;};
  container.addEventListener('mouseenter',()=>{inside=true;clearTimeout(timer);timer=setTimeout(async()=>{if(!inside)return;if(!image?.naturalWidth)await image?.requestFrame?.();show();},280);});image?.addEventListener('load',show);container.addEventListener('mouseleave',()=>{inside=false;clearTimeout(timer);if(activePreviewAnchor===container)preview.hidden=true;});container.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();preview.hidden=true;openMediaPreview(asset,context);});
  if(container.classList.contains('cover')){const button=document.createElement('button');button.type='button';button.className='preview-media';button.textContent='预览';button.setAttribute('aria-label','预览 '+asset.name);button.addEventListener('click',e=>{e.stopPropagation();preview.hidden=true;openMediaPreview(asset,context);});container.append(button);}
}
function bindMagnifier(stage,image,asset,context){
  const toggle=document.createElement('button');toggle.type='button';toggle.textContent='放大镜';toggle.className='magnify';toggle.setAttribute('aria-pressed','false');const lens=document.createElement('div');lens.className='magnifier-lens';lens.hidden=true;stage.append(toggle,lens);let enabled=false;
  toggle.addEventListener('click',e=>{e.stopPropagation();enabled=!enabled;toggle.classList.toggle('active',enabled);toggle.setAttribute('aria-pressed',String(enabled));lens.hidden=true;stage.classList.toggle('magnifying',enabled);toggle.title=enabled?'移动鼠标查看局部；当前清晰度取决于已加载图片':'开启局部放大';});
  stage.addEventListener('pointermove',e=>{if(!enabled||!image.naturalWidth||e.target.closest('button')){lens.hidden=true;return;}const r=imageRect(image),p=stage.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;if(x<0||y<0||x>r.width||y>r.height){lens.hidden=true;return;}const size=Math.min(190,p.width*.42,p.height*.7),zoom=2;lens.style.width=lens.style.height=size+'px';lens.style.left=Math.max(0,Math.min(p.width-size,e.clientX-p.left-size/2))+'px';lens.style.top=Math.max(0,Math.min(p.height-size,e.clientY-p.top-size/2))+'px';lens.style.backgroundImage=`url("${image.currentSrc||image.src}")`;lens.style.backgroundSize=`${r.width*zoom}px ${r.height*zoom}px`;lens.style.backgroundPosition=`${size/2-x*zoom}px ${size/2-y*zoom}px`;lens.hidden=false;});stage.addEventListener('pointerleave',()=>{lens.hidden=true;});stage.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();openMediaPreview(asset,context);});image.addEventListener('click',e=>{if(enabled)e.stopImmediatePropagation();},true);
}
function initMediaDialog(createMedia,stop,enterReader){
  const dialog=document.getElementById('media-dialog'),body=document.getElementById('media-dialog-body');let current=null;
  closeMediaPreview=()=>{current=null;if(dialog.open)dialog.close();else{stop(body);body.replaceChildren();}};
  openMediaPreview=(asset,context)=>{current={asset,context};document.getElementById('hover-preview').hidden=true;for(const p of document.querySelectorAll('video,audio'))p.pause();stop(body);body.replaceChildren(createMedia(asset,context));document.getElementById('media-dialog-title').textContent=asset.name;dialog.showModal();if(asset.kind!=='image')body.querySelector('.load-media')?.click();};
  document.getElementById('media-dialog-reader').addEventListener('click',()=>{if(!current)return;const{asset,context}=current;closeMediaPreview();enterReader(asset,context);});
  dialog.addEventListener('close',()=>{current=null;stop(body);body.replaceChildren();});document.getElementById('media-dialog-close').addEventListener('click',closeMediaPreview);dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeMediaPreview();}});for(const event of ['scroll','resize'])window.addEventListener(event,()=>{document.getElementById('hover-preview').hidden=true;},true);
}

// Click scrolls one step; a held primary pointer scrolls continuously until released.
function bindScrollArrow(button,viewport,direction){
  let delay,frame,last=0,held=false,pointerDown=false;
  const stop=()=>{clearTimeout(delay);cancelAnimationFrame(frame);last=0;window.removeEventListener('blur',release);};
  const tick=now=>{if(!button.isConnected||button.disabled||!pointerDown){stop();return;}if(last)viewport.scrollLeft+=direction*Math.min(40,now-last)*1.2;last=now;frame=requestAnimationFrame(tick);};
  button.addEventListener('pointerdown',e=>{if(e.button!==0||button.disabled)return;stop();held=false;pointerDown=true;window.addEventListener('blur',release);button.setPointerCapture(e.pointerId);delay=setTimeout(()=>{held=true;frame=requestAnimationFrame(tick);},300);});
  const release=()=>{pointerDown=false;stop();};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',()=>{held=true;release();});button.addEventListener('lostpointercapture',release);
  button.addEventListener('click',()=>{if(!held)viewport.scrollBy({left:direction*Math.max(160,viewport.clientWidth*.65),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});held=false;});
  return release;
}

// appearance-dropdown.js
// One-level selector shared by palettes and prompt fonts.
function createAppearanceDropdown({trigger,list,options,onChange}) {
  let selected=options[0]?.value,search='',searchTimer;
  const buttons=[];
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',list.id);list.setAttribute('role','listbox');
  function close(focus=false){list.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
  function open(index=options.findIndex(option=>option.value===selected)){
    document.dispatchEvent(new CustomEvent('appearance-dropdown-open',{detail:trigger.id}));list.hidden=false;trigger.setAttribute('aria-expanded','true');
    list.classList.remove('opens-up');list.style.maxHeight='220px';
    const rect=trigger.getBoundingClientRect(),bounds=trigger.closest('dialog').getBoundingClientRect();
    const below=Math.min(innerHeight-16,bounds.bottom-8)-rect.bottom-6,above=rect.top-Math.max(16,bounds.top+8)-6;
    const upward=below<list.scrollHeight&&above>below;list.classList.toggle('opens-up',upward);
    list.style.maxHeight=Math.max(40,Math.min(220,upward?above:below))+'px';
    const button=buttons[Math.max(0,index)];button?.focus();button?.scrollIntoView({block:'nearest'});
  }
  function choose(index){selected=options[index].value;onChange(selected);close(true);}
  options.forEach((option,index)=>{
    const button=document.createElement('button');button.type='button';button.className='appearance-option';button.tabIndex=-1;button.dataset.value=option.value;button.setAttribute('role','option');
    if(option.badge){const badge=document.createElement('span');badge.className='dropdown-badge';badge.textContent=option.badge;badge.setAttribute('aria-hidden','true');button.append(badge);}
    const text=document.createElement('span');text.className='option-label';text.textContent=option.label;
    const check=document.createElement('span');check.className='option-check';check.textContent='✓';check.setAttribute('aria-hidden','true');button.append(text,check);
    button.addEventListener('click',()=>choose(index));list.append(button);buttons.push(button);
  });
  function set(value){
    selected=options.some(option=>option.value===value)?value:options[0]?.value;const option=options.find(option=>option.value===selected);
    trigger.querySelector('.dropdown-label').textContent=option?.label||'';const badge=trigger.querySelector('.dropdown-badge');if(badge)badge.textContent=option?.badge||'';
    for(let i=0;i<buttons.length;i++)buttons[i].setAttribute('aria-selected',String(options[i].value===selected));
  }
  trigger.addEventListener('click',()=>list.hidden?open():close(true));
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(event.key==='ArrowUp'?options.length-1:undefined);}});
  list.addEventListener('keydown',event=>{
    const current=Math.max(0,buttons.indexOf(document.activeElement));let index;
    if(event.key==='ArrowDown')index=(current+1)%buttons.length;if(event.key==='ArrowUp')index=(current-1+buttons.length)%buttons.length;
    if(event.key==='Home')index=0;if(event.key==='End')index=buttons.length-1;
    if(index!==undefined){event.preventDefault();buttons[index].focus();buttons[index].scrollIntoView({block:'nearest'});}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(current);}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
    else if(event.key==='Tab'){close(true);}
    else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey){clearTimeout(searchTimer);search+=event.key.toLowerCase();searchTimer=setTimeout(()=>{search='';},700);const match=options.findIndex(option=>option.label.toLowerCase().startsWith(search));if(match>=0)buttons[match].focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!trigger.parentElement.contains(event.target))close();});
  document.addEventListener('appearance-dropdown-open',event=>{if(event.detail!==trigger.id)close();});
  document.addEventListener('appearance-reset',()=>close());
  document.addEventListener('appearance-dropdown-close',()=>close());
  const dialog=trigger.closest('dialog');dialog.addEventListener('close',()=>{if(!dialog.open)close();});dialog.addEventListener('cancel',event=>{if(!list.hidden){event.preventDefault();close(true);}});
  function setBadgeColors(colors){
    for(let i=0;i<buttons.length;i++){const badge=buttons[i].querySelector('.dropdown-badge');if(badge)badge.style.color=colors[options[i].value]||'';}
    const badge=trigger.querySelector('.dropdown-badge');if(badge)badge.style.color=colors[selected]||'';
  }
  set(selected);return {set,close,open,setBadgeColors};
}

// theme-manager.js

function createThemeManager({root=document.documentElement,storage,media=window.matchMedia('(prefers-color-scheme: dark)'),sync,onError=()=>{}}) {
  const api=window.CanvasThemes;
  let preference=api.readPreference(storage),tail=Promise.resolve(),dropdown;
  const dialog=document.getElementById('appearance-dialog');
  function render() {
    const theme=api.applyTheme(root,preference,media.matches);
    const label={light:'浅色',dark:'深色',system:'跟随系统'}[preference.mode];
    document.getElementById('theme-toggle').title=api.PALETTES[preference.palette].name+' · '+label;
    for(const button of dialog.querySelectorAll('[data-appearance-mode]')) {
      const active=button.dataset.appearanceMode===preference.mode;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    }
    dropdown?.set(preference.palette);
    dropdown?.setBadgeColors(Object.fromEntries(Object.keys(api.PALETTES).map(id=>[id,api.resolveTheme({palette:id,mode:theme.resolvedMode}).tokens['primary-bg']])));
    for(const [id,token] of [['appearance-accent','primary-bg'],['appearance-background','bg'],['appearance-foreground','text']]) {
      const output=document.getElementById(id);output.querySelector('.color-value').textContent=theme.tokens[token].toUpperCase();output.querySelector('.color-dot').style.backgroundColor=theme.tokens[token];
    }
    document.getElementById('appearance-current').textContent=api.PALETTES[theme.palette].name+' · '+(theme.resolvedMode==='dark'?'深色':'浅色')+(preference.mode==='system'?'（跟随系统）':'');
    return theme;
  }
  function publish(theme) {
    if(!sync)return;
    const selection={palette:theme.palette,mode:theme.mode};
    tail=tail.catch(()=>{}).then(()=>sync(selection)).then(response=>{
      if(response?.ok===false)throw new Error(response.error||'主题同步失败');
    }).catch(onError);
  }
  function set(value) {
    preference=api.normalizePreference(value);
    try {storage?.setItem(api.STORAGE_KEY,JSON.stringify(preference));} catch {onError(new Error('外观已切换，但本地偏好保存失败。'));}
    const theme=render();publish(theme);return theme;
  }
  dropdown=createAppearanceDropdown({trigger:document.getElementById('appearance-palette-trigger'),list:document.getElementById('appearance-palette-menu'),options:Object.entries(api.PALETTES).map(([value,palette])=>({value,label:palette.name,badge:'Aa'})),onChange:palette=>set({...preference,palette})});
  for(const button of dialog.querySelectorAll('[data-appearance-mode]'))button.addEventListener('click',()=>set({...preference,mode:button.dataset.appearanceMode}));
  const trigger=document.getElementById('theme-toggle');
  trigger.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();});
  document.getElementById('appearance-close').addEventListener('click',()=>{
    document.dispatchEvent(new CustomEvent('appearance-dropdown-close'));
    dialog.close();trigger.focus();
  });
  // A queued native close event may arrive after the dialog has reopened.
  dialog.addEventListener('close',()=>{if(!dialog.open)trigger.focus();});
  function systemChanged(){if(preference.mode==='system')publish(render());}
  media.addEventListener('change',systemChanged);
  set(preference);
  return {get:()=>({...preference}),set,resolved:()=>api.resolveTheme(preference,media.matches),ready:()=>tail,destroy:()=>media.removeEventListener('change',systemChanged)};
}

// typography-manager.js

function createTypographyManager({storage,root=document.documentElement,onError=()=>{}}){
  const api=window.PromptTypography;let preference=api.readTypography(storage),dropdown;
  const size=document.getElementById('prompt-font-size');
  function render(){
    api.applyTypography(root,preference);dropdown?.set(preference.font);size.value=String(preference.size);
    if(api.FONTS[preference.font].face)document.fonts.load(preference.size+'px "'+api.FONTS[preference.font].face+'"').catch(()=>{if(preference.font!=='default')onError(new Error('字体加载失败，提示词将使用默认字体显示。'));});
  }
  function set(value){preference=api.normalizeTypography(value);render();try{storage?.setItem(api.TYPOGRAPHY_KEY,JSON.stringify(preference));}catch{onError(new Error('排版已更新，但本地偏好保存失败。'));}return {...preference};}
  dropdown=createAppearanceDropdown({trigger:document.getElementById('prompt-font-trigger'),list:document.getElementById('prompt-font-menu'),options:Object.entries(api.FONTS).map(([value,font])=>({value,label:font.name})),onChange:font=>set({...preference,font})});
  size.min=String(api.FONT_SIZE_MIN);size.max=String(api.FONT_SIZE_MAX);
  size.addEventListener('input',()=>{if(size.value!==''&&size.validity.valid)set({...preference,size:Number(size.value)});});
  size.addEventListener('change',()=>set({...preference,size:size.value===''?preference.size:Number(size.value)}));
  size.addEventListener('blur',()=>set({...preference,size:size.value===''?preference.size:Number(size.value)}));
  render();return {get:()=>({...preference}),set};
}

// renderer.js







const $=id=>document.getElementById(id);
let result=null,busy=false,opened=false,visible=false,scope='prompts',kind='all',page=0,columns=5,downloads=null,project=null,assetMap=new Map(),saveTimer,renderTimer;
const loginBusy=new Set();
let saving=false,downloadStarting=false,browserResetting=false,localOpening=false;
let preferredLayout='side',effectiveLayout='side',readers=[],focusedReader=null,resizeTimer;
const filters={prompts:new Set(Object.keys(TYPES)),assets:new Set(Object.keys(MEDIA))};
const heights=new Map(),readerElements=new Map();
function el(tag,text='',className=''){const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;}
function action(text,fn,opts={}){const b=el('button',text,opts.quiet?'quiet':'');b.type='button';if(opts.icon)b.prepend(icon(opts.icon));b.addEventListener('click',fn);return b;}
function pressed(button,active){button.classList.toggle('active',Boolean(active));button.setAttribute('aria-pressed',String(Boolean(active)));}
function icon(type){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('icon','icon-'+type);const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',{image:'M3 4h18v16H3z M4 17l5-6 4 4 3-3 5 6 M16 8h.01',video:'M3 6h13v12H3z M16 10l5-3v10l-5-3',audio:'M4 10h4l5-5v14l-5-5H4z M16 8q6 4 0 8 M18 5q10 7 0 14',text:'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6',folder:'M3 6h7l2 2h9v12H3z',left:'M15 5l-7 7 7 7',right:'M9 5l7 7-7 7',close:'M6 6l12 12 M18 6L6 18'}[type]||'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5');svg.append(shape);return svg;}
function onlinePreview(){return mode()==='full'&&!result?.localProject;}
function mode(){return $('mode').value==='full'?'full':'simple';}
function selected(){return [...$('export-types').querySelectorAll('input')].filter(c=>c.checked).map(c=>c.dataset.kind);}
function mediaSelected(){return [...$('download-types').querySelectorAll('input')].filter(c=>c.checked).map(c=>c.dataset.kind);}
function options(){return{kinds:selected(),split:$('split').checked,mode:mode()};}
function status(message,phase='running'){$('status').textContent=message;$('status').dataset.phase=phase;}
function checkbox(root,key,label,onChange){const wrapper=el('label'),input=el('input');input.type='checkbox';input.dataset.kind=key;input.checked=true;const count=el('span','0','mini-count');count.id=(root==='export-types'?'export-count-':'media-count-')+key;wrapper.append(input,document.createTextNode(label),count);$(root).append(wrapper);input.addEventListener('change',onChange);return wrapper;}
for(const[k,label]of Object.entries(TYPES))checkbox('export-types',k,label,()=>updateButtons());
for(const k of ['video','image','audio']){const row=el('div','','download-row');row.dataset.kind=k;const label=checkbox('download-types',k,MEDIA[k],()=>{refreshDownload();updateButtons();});row.append(label);const track=el('div','','progress-track');track.id='progress-'+k;track.setAttribute('role','progressbar');track.setAttribute('aria-label',MEDIA[k]+'下载进度');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow','0');track.append(el('span','','progress-fill'));const metrics=el('div','','download-metrics');metrics.append(el('span','0 / 0','download-count'),el('span','0 KB/s','download-speed'));row.append(track,metrics);$('download-types').append(row);}
function safeName(s,fallback){return(String(s||'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'')||fallback).slice(0,70);}
function filename(){return[result?.metadata.platform||'平台',safeName(result?.metadata.author,'未知作者'),safeName(String(result?.metadata.title||'').replace(/^《(.*)》$/,'$1'),'未命名作品')].join('_');}
async function saveNow(){if(saving){const r=await window.lab.stopSave();if(!r.ok)status(r.error,'error');return false;}if(busy||downloads?.active||downloadStarting||!result)return false;if(!selected().length){$('saved').textContent='请至少勾选一种提示词类别。';return false;}saving=true;updateButtons();$('saved').dataset.phase='running';$('saved').textContent='正在保存提示词…';try{const r=await window.lab.save(options());if(!r.ok)throw new Error(r.error);$('saved').textContent=(r.value.cancelled?'已停止保存；已完成文件保留：':'已保存：')+(r.value.savedDocuments.join('；')||'本次没有完成文件');$('saved').dataset.phase='done';return true;}catch(e){$('saved').textContent='保存失败：'+e.message;$('saved').dataset.phase='error';return false;}finally{saving=false;updateButtons();}}
function syncMode(){$('mode-label').textContent=mode()==='full'?'全能模式':'轻量模式';$('mode-toggle').textContent=mode()==='full'?'轻量模式':'全能模式';$('download-strip').hidden=mode()!=='full';$('mode-hint').textContent=mode()==='full'?'全能模式支持在线预览和素材下载。':'轻量模式仅显示已有本地预览。';}
function updateButtons(){const active=downloads?.active,locked=busy||saving||active||downloadStarting||browserResetting||localOpening;$('start').disabled=saving||active||downloadStarting||browserResetting||localOpening;$('start').textContent=busy?'停止读取':'开始读取画布';for(const id of ['directory','mode-toggle'])$(id).disabled=locked;$('directory').disabled=locked||Boolean(project?.directory);$('directory').title=project?.directory?'当前项目已建立；下一个项目首次保存前可更换位置。':'';$('visibility').disabled=!opened||browserResetting||localOpening;for(const p of ['liblib','jimeng'])$('login-'+p).disabled=locked||loginBusy.has(p);for(const c of $('export-types').querySelectorAll('input'))c.disabled=locked;$('split').disabled=locked;for(const c of $('download-types').querySelectorAll('input'))c.disabled=locked;$('save-prompts').disabled=busy||active||downloadStarting||browserResetting||localOpening||!result||!selected().length;$('save-prompts').textContent=saving?'停止保存':'保存提示词';$('download').disabled=busy||saving||downloadStarting||browserResetting||localOpening||!result||!mediaSelected().length;$('retry').disabled=locked||!result?.assets.some(a=>a.state==='failed'&&mediaSelected().includes(a.kind));$('resume-download').hidden=!active||!downloads?.paused;$('open-local-project').disabled=locked;$('open-local-project').textContent=localOpening?'正在打开…':'打开本地项目';$('open-local-project').setAttribute('aria-busy',String(localOpening));$('local-project-path').disabled=locked;const reset=$('browser-reset');reset.disabled=locked||loginBusy.size>0;reset.textContent=browserResetting?'正在重置…':'清理缓存，恢复浏览器初始状态';reset.setAttribute('aria-busy',String(browserResetting));reset.title=reset.disabled&&!browserResetting?'请先结束当前任务，再重置浏览器。':'';syncMode();for(const node of readerElements.values()){const a=assetMap.get(node.dataset.currentAsset),b=node.querySelector('.download-one');if(b){b.disabled=locked||!a||a.state==='done'||mode()!=='full';b.textContent=a?.state==='done'?'已下载':a?.state==='downloading'?'下载中':'下载素材';}}}

function sourceUrl(a){return`labmedia://${a.state==='done'?'local':'stream'}/${a.id}`;}
function mediaState(a){if(result?.localProject&&a?.error==='本地文件缺失或不完整')return '本地文件缺失或不完整';if(result?.localProject&&a?.state!=='done')return '未下载';return{done:'已保存到本地',pending:'未保存到本地',downloading:'下载中',failed:'下载失败',unavailable:'地址不可用'}[a?.state]||'待下载';}
function bytes(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(0)+' KB':(n||0)+' B';}
async function reveal(a){if(!a)return;const r=await window.lab.reveal(a.id);if(!r.ok)status(r.error,'attention');}
function bindHover(container,image,a,context){bindSmallPreview(container,image,a,context);}
function thumbnailCover(a,item){const cover=el('div','','cover');if(!a){cover.append(el('div',item.prompt?.slice(0,400)||item.referenceTexts?.[0]?.text?.slice(0,400)||'文本节点','text-snippet'));return cover;}
  const fallback=el('div','','placeholder');fallback.append(icon(a.kind),el('span',a.kind==='video'?'视频预览':a.kind==='audio'?'音频素材':'图片预览'));cover.append(fallback);const image=attachThumbnail(cover,a,{full:onlinePreview()});bindHover(cover,image,a,{scope,item});const badge=el('span',MEDIA[a.kind],'asset-kind');badge.prepend(icon(a.kind));cover.append(badge);if(a.kind==='video')cover.append(el('span','▶','play-mark'));if(item.outputAssetIds?.length>1)cover.append(el('span',item.outputAssetIds.length+' 个结果','output-count'));return cover;}
function keyOf(s,item,nodeId){return readerTarget(result,s,item,nodeId).key;}
function itemFor(record){return(record.scope==='assets'?result?.assets:result?.entries)?.find(i=>(record.scope==='assets'?i.id:i.nodeId)===record.id);}
function card(item){const isAsset=scope==='assets',a=isAsset?item:item.outputAssetIds?.map(id=>assetMap.get(id)).find(Boolean),readerKey=keyOf(scope,item),key=scope+':'+(isAsset?item.id:item.nodeId),c=el('article','','content-card');c.dataset.key=key;c.dataset.readerKey=readerKey;c.dataset.kind=item.kind;c.setAttribute('aria-label',item.name+'，打开到阅读区');c.setAttribute('aria-controls','reading-board');pressed(c,readers.some(r=>r.key===readerKey));
  if(columns>0)c.append(thumbnailCover(a,item));const body=el('div','','card-body');const name=action(item.name,()=>openReader(scope,item),{quiet:true});name.className='card-heading';conditionalTitle(name);body.append(name,el('span',isAsset?SOURCE[item.source]+' · '+MEDIA[item.kind]:TYPES[promptKind(item.kind)]+' · '+(item.model||'模型未读取'),'card-subheading'));c.append(body);
  if(columns>0){const foot=el('div','','card-footer');const size=a?.state==='done'?a.bytes:a?.total;const chars=isAsset?result.entries.filter(e=>e.outputAssetIds?.includes(a.id)||e.references.some(r=>r.assetIds?.includes(a.id))).length+' 条关联':Array.from(item.prompt||'').filter(ch=>ch!=='\n'&&ch!=='\r').length+' 字符';foot.append(el('span',size?bytes(size):a?'大小未知':'无媒体','file-size'),el('span',chars,'prompt-count'));c.append(foot);}if(columns===0)c.addEventListener('click',e=>{if(!e.target.closest('button'))openReader(scope,item);});return c;
}
function refreshBoardSelection(){for(const c of $('entries').querySelectorAll('.content-card'))pressed(c,readers.some(r=>r.key===c.dataset.readerKey));}
function focusRecord(record){focusedReader=record.key;for(const[key,element]of readerElements)element.classList.toggle('focused',key===record.key);const d=readerElements.get(record.key);requestAnimationFrame(()=>{d?.focus({preventScroll:true});if(d)d.scrollIntoView({block:'start',behavior:'auto'});});}
function openReader(s,item,nodeId,assetId){
  if(s==='assets'&&!assetId)assetId=item.id;
  const target=readerTarget(result,s,item,nodeId);s=target.scope;item=target.item;
  const key=target.key;let record=readers.find(r=>r.key===key);
  if(!record){
    const left=readers.filter(r=>r.column!==1).length,right=readers.filter(r=>r.column===1).length;
    const output=Math.max(0,item.outputAssetIds?.indexOf(assetId)??0);
    record={key,id:s==='assets'?item.id:item.nodeId,nodeId:target.nodeId,scope:s,collapsed:false,output,column:left<=right?0:1};
    readers.push(record);readerElements.set(key,detail(item,record));placeReaders();
  }else if(record.collapsed){record.collapsed=false;updateCollapsed(record);}
  record.selectAsset?.(assetId);refreshBoardSelection();focusRecord(record);
}
function enterPreviewReader(asset,context){if(context?.scope==='prompts')openReader('prompts',context.item,context.item.nodeId,asset.id);else openReader('assets',asset,context?.nodeId,asset.id);}
function disposeReader(record){record.dispose?.();record.dispose=null;record.showOutput=null;record.selectAsset=null;}
function removeReader(record){disposeReader(record);const node=readerElements.get(record.key);if(node){stopIn(node);node.remove();}readerElements.delete(record.key);heights.delete(record.key);readers=readers.filter(r=>r!==record);if(focusedReader===record.key)focusedReader=null;placeReaders();refreshBoardSelection();}
async function downloadOne(record){const a=assetMap.get(readerElements.get(record.key)?.dataset.currentAsset);if(!a)return;if(mode()!=='full'){status('请切换全能模式后保存素材到本地。','attention');return;}if(downloads?.active){status('请等待当前下载完成。','attention');return;}await requestDownload({kinds:[a.kind],ids:[a.id]});}
function stopIn(node,unload=true){for(const p of node.querySelectorAll('video,audio')){p.pause();if(unload){p.removeAttribute('src');p.load();}}}
function clearReaders(){for(const r of readers)disposeReader(r);for(const node of readerElements.values())stopIn(node);readers=[];focusedReader=null;readerElements.clear();heights.clear();$('reader-left').replaceChildren();$('reader-right').replaceChildren();placeReaders();refreshBoardSelection();}
function updateCollapsed(record){const d=readerElements.get(record.key);if(!d)return;d.classList.toggle('is-collapsed',record.collapsed);const button=d.querySelector('.collapse-reader');button.textContent=record.collapsed?'展开':'收起';button.setAttribute('aria-expanded',String(!record.collapsed));if(record.collapsed){stopIn(d,false);for(const b of d.querySelectorAll('.magnify.active'))b.click();} $('collapse-readers').disabled=!readers.some(r=>!r.collapsed);}
function placeReaders(){const left=$('reader-left'),right=$('reader-right');readers.forEach(r=>{const node=readerElements.get(r.key),target=effectiveLayout==='dual'&&r.column===1?right:left;if(node&&node.parentElement!==target)target.append(node);});
  // Preserve chosen order when changing between one and two independent columns.
  for(const col of [left,right]){const expected=readers.filter(r=>col===left?(effectiveLayout!=='dual'||r.column!==1):effectiveLayout==='dual'&&r.column===1);expected.forEach((r,i)=>{const node=readerElements.get(r.key);if(node&&col.children[i]!==node)col.insertBefore(node,col.children[i]||null);});}
  $('reader-empty').hidden=readers.length>0;left.hidden=!readers.length;right.hidden=!readers.length;$('reader-count').textContent=readers.length?`已打开 ${readers.length} 个节点`:'从上方看板打开节点';$('clear-readers').disabled=!readers.length;$('collapse-readers').disabled=!readers.some(r=>!r.collapsed);
}
function updateReaderLayout(){const width=$('reading-board').clientWidth,next=readingLayout(preferredLayout,width);effectiveLayout=next;$('reading-board').dataset.layout=next;
  for(const b of $('read-layouts').querySelectorAll('button')){pressed(b,b.dataset.layout===next);const minimum=b.dataset.layout==='side'?1020:b.dataset.layout==='dual'?1120:0;b.disabled=width<minimum;b.title=b.disabled?'窗口变宽后可使用此布局':'';}
  $('layout-note').hidden=next===preferredLayout;$('layout-note').textContent='当前窗口较窄，暂用一列上下；窗口变宽后恢复你的选择。';placeReaders();
}
function refThumb(a,index,nodeId){const b=el('button','','ref-thumb');b.type='button';b.title=a.name+' · '+mediaState(a)+'；点击已保存素材可定位文件';const pic=el('span','','ref-picture');pic.append(icon(a.kind));const image=attachThumbnail(pic,a,{full:onlinePreview()});bindHover(b,image,a,{nodeId});b.append(pic,el('span',a.name,'ref-name'));if(index!=null)b.append(el('span',String(index),'ref-number'));b.addEventListener('click',()=>reveal(a));return b;}
function referenceStrip(item){const refs=el('div','','references');refs.setAttribute('aria-label','参考素材，支持横向滚动');for(const r of item.references){const a=r.assetIds?.map(id=>assetMap.get(id)).find(Boolean);if(a)refs.append(refThumb(a,r.index,r.nodeId));else refs.append(el('span',`${r.index}. ${r.name}`,'text-ref'));}if(!refs.childNodes.length){const empty=el('div','未提取到关联参考素材','ref-strip empty-references');empty.setAttribute('aria-label','参考素材');return empty;}const strip=el('div','','ref-strip'),prev=action('‹',()=>refs.scrollBy({left:-240,behavior:'smooth'})),next=action('›',()=>refs.scrollBy({left:240,behavior:'smooth'}));prev.className=next.className='ref-arrow';prev.setAttribute('aria-label','向左查看参考素材');next.setAttribute('aria-label','向右查看参考素材');strip.append(prev,refs,next);function arrows(){prev.disabled=refs.scrollLeft<=1;next.disabled=refs.scrollLeft+refs.clientWidth>=refs.scrollWidth-1;}refs.addEventListener('scroll',arrows);refs.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&refs.scrollWidth>refs.clientWidth){e.preventDefault();refs.scrollLeft+=e.deltaY;}},{passive:false});new ResizeObserver(arrows).observe(refs);requestAnimationFrame(arrows);return strip;}
function richPrompt(entry){const pre=el('div'),regex=/\{\{\s*([A-Za-z]+)\s+(\d+)\s*\}\}|【参考：[^】]*；节点 ([^】]+)】/g;let end=0,m;while((m=regex.exec(entry.prompt))){pre.append(document.createTextNode(entry.prompt.slice(end,m.index)));const ref=entry.references.find(r=>m[3]?r.nodeId===m[3]:r.marker?.toLowerCase()===(m[1]+' '+m[2]).toLowerCase()),a=ref?.assetIds?.map(id=>assetMap.get(id)).find(Boolean);
    if(ref){const chip=el('button','','inline-ref');chip.append(el('span',promptReferenceLabel(ref.name),'ref-chip-label'));chip.title=ref.name+' · '+(ref.marker||'节点参考');chip.setAttribute('aria-label',ref.name);if(a){chip.addEventListener('click',()=>reveal(a));const image=attachThumbnail(chip,a,{full:onlinePreview()});if(image){chip.prepend(image);image.alt='';bindHover(chip,image,a,{nodeId:ref.nodeId});}}else chip.disabled=true;pre.append(chip);}else pre.append(document.createTextNode(m[0]));end=regex.lastIndex;}pre.append(document.createTextNode(entry.prompt.slice(end)));return pre;}
function mediaOutput(a,context){const box=el('div','','media-output'),stage=el('div','','media-stage');box.append(stage);if(a.kind==='image'){
    if(a.state!=='done'&&!onlinePreview())stage.append(el('div',result?.localProject?'此素材未下载或本地文件缺失。':'轻量模式不加载在线图片，请切换全能模式查看。','media-placeholder'));
    else{const image=el('img');image.alt=a.name;stage.dataset.previewState='loading';image.src=sourceUrl(a);image.onload=()=>{image.dataset.loaded='true';stage.dataset.previewState='ready';};image.onerror=()=>{stage.dataset.previewState='failed';image.remove();stage.append(el('div','预览暂不可用，下载后可查看。','media-placeholder'));};image.addEventListener('click',()=>reveal(a));stage.append(image);bindMagnifier(stage,image,a,context);}
  }else{stage.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();openMediaPreview(a,context);});if(a.kind==='audio'){stage.classList.add('audio-stage');stage.append(icon('audio'));}const player=el(a.kind==='video'?'video':'audio');player.controls=true;player.preload='none';stage.dataset.previewState='idle';player.dataset.assetId=a.id;if(a.kind==='video')bindVideoPoster(player,a,{full:onlinePreview()});
    const play=action(a.kind==='video'?'播放视频':'播放音频',()=>{if(!onlinePreview()&&a.state!=='done'){status(result?.localProject?'此素材未下载或本地文件缺失。':'请切换全能模式加载在线媒体。','attention');return;}stage.dataset.previewState='loading';player.src=sourceUrl(a);player.preload='metadata';player.load();play.remove();player.play().catch(()=>{});});play.className='load-media';
    player.addEventListener('play',()=>{for(const other of document.querySelectorAll('video,audio'))if(other!==player)other.pause();});for(const event of ['waiting','loadstart'])player.addEventListener(event,()=>{stage.dataset.previewState='loading';});for(const event of ['canplay','playing','loadeddata'])player.addEventListener(event,()=>{stage.dataset.previewState='ready';});player.addEventListener('error',()=>{stage.dataset.previewState='failed';status('播放失败，可下载后查看，或检查登录和素材地址有效期。','attention');});stage.append(player,play);
  }const tools=el('div','','media-tools');tools.append(el('span',mediaState(a),'state-tag'));if(a.state==='done')tools.append(action('定位文件',()=>reveal(a)));stage.append(tools);return box;}
function resizeHandle(card,shell,record){const handle=el('button','','resize-handle');handle.type='button';handle.title='拖动调整正文高度；接近一格或两格时，松开后吸附。方向键每次调整 20 像素。';handle.setAttribute('role','slider');handle.setAttribute('aria-label','正文区域高度');handle.setAttribute('aria-valuemin','140');handle.setAttribute('aria-valuemax','1200');handle.setAttribute('aria-valuenow',String(Math.round(shell.getBoundingClientRect().height)||480));
  const enabled=()=>effectiveLayout!=='side'&&!record.collapsed;
  function apply(height){heights.set(record.key,height);card.style.setProperty('--prompt-height',height+'px');handle.setAttribute('aria-valuenow',String(height));}let drag;
  handle.addEventListener('pointerdown',e=>{if(e.button!==0||!enabled())return;e.preventDefault();drag={y:e.clientY,height:shell.getBoundingClientRect().height};handle.setPointerCapture(e.pointerId);});
  handle.addEventListener('pointermove',e=>{if(!drag)return;if(!enabled()){drag=null;return;}apply(Math.round(Math.max(140,Math.min(1200,drag.height+e.clientY-drag.y))));});
  function end(){if(!drag)return;const unit=card.querySelector('.media-stage')?.getBoundingClientRect().height+48;apply(snapHeight(shell.getBoundingClientRect().height,unit));drag=null;}
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',()=>{drag=null;});handle.addEventListener('lostpointercapture',()=>{drag=null;});handle.addEventListener('keydown',e=>{if(enabled()&&['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const current=shell.getBoundingClientRect().height,next=e.key==='Home'?140:e.key==='End'?1200:current+(e.key==='ArrowUp'?-20:20);apply(Math.round(Math.max(140,Math.min(1200,next))));}});return handle;}

function citingStrip(item,record){
  const entries=referencingEntries(result,record.nodeId,record.scope==='assets'?[item.id]:item.outputAssetIds||[]);
  if(!entries.length)return null;
  const strip=el('div','','citing-strip'),links=el('div','','citing-links');links.setAttribute('aria-label','引用此素材的节点');
  for(const entry of entries){const link=action(entry.name,()=>openReader('prompts',entry));link.dataset.nodeId=entry.nodeId;link.title=entry.name+' · 节点 '+entry.nodeId;links.append(link);}
  const prev=el('button','‹','citing-arrow'),next=el('button','›','citing-arrow');prev.type=next.type='button';prev.setAttribute('aria-label','向左查看引用节点');next.setAttribute('aria-label','向右查看引用节点');
  strip.append(el('span','引用此素材','citing-label'),prev,links,next);
  const releases=[bindScrollArrow(prev,links,-1),bindScrollArrow(next,links,1)];
  function update(){const available=strip.clientWidth-strip.querySelector('.citing-label').offsetWidth-6;const overflow=links.scrollWidth>available+1;prev.hidden=next.hidden=!overflow;prev.disabled=links.scrollLeft<=1;next.disabled=links.scrollLeft+links.clientWidth>=links.scrollWidth-1;}
  links.addEventListener('scroll',update);const observer=new ResizeObserver(update);observer.observe(strip);observer.observe(links);requestAnimationFrame(update);
  record.dispose=()=>{observer.disconnect();releases.forEach(release=>release());};return strip;
}
function detail(item,record){const isAsset=record.scope==='assets',d=el('article','','reading-card');d.dataset.key=record.key;d.dataset.scope=record.scope;d.tabIndex=-1;d.id='read-'+(record.nodeId||item.id||item.nodeId);d.setAttribute('aria-label',item.name+'的详情');if(!isAsset&&item.kind==='text')d.classList.add('is-text');if(heights.has(record.key))d.style.setProperty('--prompt-height',heights.get(record.key)+'px');
  const content=el('div','','reading-content'),visual=el('div','','visual-col'),text=el('div','','text-col');content.append(visual,text);d.append(content);
  const head=el('div','','detail-heading'),title=el('div','','detail-title');title.append(el('h3',item.name),el('span',isAsset?MEDIA[item.kind]:[TYPES[promptKind(item.kind)],item.group,item.model].filter(Boolean).join(' · '),'detail-sub'));const controls=el('div','','detail-actions');
  const toggle=()=>{record.collapsed=!record.collapsed;updateCollapsed(record);};
  const copy=action('复制正文',async()=>{const value=isAsset?'':item.prompt;const r=await window.lab.copyText(value);status(r.ok?'正文已复制。':r.error,r.ok?'done':'error');},{quiet:true}),collapse=action(record.collapsed?'展开':'收起',toggle,{quiet:true});collapse.classList.add('collapse-reader');collapse.setAttribute('aria-expanded',String(!record.collapsed));const remove=action('移出阅读区',()=>removeReader(record),{quiet:true});remove.className='quiet remove-reader';const download=action('下载素材',()=>downloadOne(record),{quiet:true});download.className='quiet download-one';copy.disabled=isAsset||!item.prompt?.trim();controls.append(download,remove,copy,collapse);head.append(title,controls);head.addEventListener('click',e=>{if(!e.target.closest('button'))toggle();});title.tabIndex=0;title.setAttribute('role','button');title.setAttribute('aria-label','展开或收起 '+item.name);title.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});conditionalTitle(title);d.prepend(head);
  const outputs=isAsset?(record.nodeId?result.assets.filter(a=>a.nodeIds?.includes(record.nodeId)):[item]):(item.outputAssetIds||[]).map(id=>assetMap.get(id)).filter(Boolean),host=el('div','','media-host');visual.append(host);let counter;
  function showOutput(){stopIn(host);if(outputs.length){record.output=Math.min(record.output,outputs.length-1);host.replaceChildren(mediaOutput(outputs[record.output],{scope:record.scope,item,nodeId:record.nodeId}));}else host.replaceChildren(el('div','没有当前生成结果，明确关联的参考素材和文本仍保留。','media-placeholder'));const current=outputs[record.output];d.dataset.currentAsset=current?.id||'';const button=d.querySelector('.download-one');button.disabled=!current||current.state==='done'||busy||downloads?.active;button.textContent=current?.state==='done'?'已下载':current?.state==='downloading'?'下载中':'下载素材';if(counter)counter.textContent=`${record.output+1} / ${outputs.length} 个结果`;}
  if(outputs.length>1){const nav=el('div','','carousel-nav');counter=el('span');nav.append(action('上一个',()=>{record.output=(record.output-1+outputs.length)%outputs.length;showOutput();}),counter,action('下一个',()=>{record.output=(record.output+1)%outputs.length;showOutput();}));visual.append(nav);}record.showOutput=showOutput;record.selectAsset=id=>{const next=outputs.findIndex(a=>a.id===id);if(next>=0&&record.output!==next){record.output=next;showOutput();}};showOutput();if(!isAsset){const refs=referenceStrip(item);if(refs)visual.append(refs);}
  const shell=el('div','','prompt-shell'),scroll=el('div','',isAsset?'asset-info-wrap':'prompt-text'),inner=el('div','','prompt-inner');scroll.append(inner);shell.append(scroll);text.append(shell);
  if(isAsset){
    const owners=result.entries.filter(e=>item.nodeIds?.includes(e.nodeId));
    if(owners.length>1){const choices=el('div','','asset-prompt-choices');inner.append(el('p','此素材对应多个节点，选择节点查看其自身提示词。','hint'));for(const owner of owners){const link=action(owner.name,()=>openReader('prompts',owner,owner.nodeId,item.id));link.title=owner.name+' · 节点 '+owner.nodeId;choices.append(link);}inner.append(choices);}
    else inner.append(el('p','该素材暂无自身提示词。','hint'));
  }
  else{inner.append(item.prompt.trim()?richPrompt(item):el('p','当前节点无直接文本，下方保留明确关联的文本。','hint'));for(const r of item.referenceTexts){const t=el('details','','linked-text');t.append(el('summary','关联文本：'+r.name),el('pre',r.text));inner.append(t);}}
  const citations=citingStrip(item,record);if(citations)text.append(citations);
  const restoreScroll=record.scroll||0;scroll.addEventListener('scroll',()=>{record.scroll=scroll.scrollTop;});requestAnimationFrame(()=>{if(scroll.isConnected)scroll.scrollTop=restoreScroll;});
  d.append(resizeHandle(d,shell,record));if(record.collapsed)d.classList.add('is-collapsed');d.addEventListener('pointerdown',()=>{focusedReader=record.key;for(const[key,element]of readerElements)element.classList.toggle('focused',key===record.key);});return d;
}
function rebuildReaders(){for(const r of readers)disposeReader(r);for(const node of readerElements.values())stopIn(node);$('reader-left').replaceChildren();$('reader-right').replaceChildren();readerElements.clear();readers=readers.filter(r=>itemFor(r));for(const r of readers)readerElements.set(r.key,detail(itemFor(r),r));updateReaderLayout();}
function renderFilters(){const items=scope==='assets'?result?.assets||[]:result?.entries||[],labels=scope==='assets'?MEDIA:{video:'视频',image:'图片',audio:'音频',text:'文本'},counts=countKinds(items,Object.keys(labels)),root=$('category-filters');root.replaceChildren();root.style.setProperty('--category-count',String(Object.keys(labels).length));for(const[key,label]of Object.entries(labels)){const b=action(label,()=>{const chosen=filters[scope];chosen.has(key)?chosen.delete(key):chosen.add(key);page=0;renderBoard();});b.dataset.filter=key;pressed(b,filters[scope].has(key));b.prepend(icon(key));b.append(el('span',String(counts[key]),'counter'));root.append(b);}}
function renderBoard(){clearTimeout(renderTimer);prepareVideoThumbnails(result?.assets||[],{full:onlinePreview()});filename();updateButtons();$('hover-preview').hidden=true;renderFilters();pressed($('tab-prompts'),scope==='prompts');pressed($('tab-assets'),scope==='assets');$('prompt-total').textContent=result?.entries.length||0;$('asset-total').textContent=result?.assets.length||0;const grid=$('entries');grid.dataset.dense=String(columns>=7);grid.dataset.text=String(columns===0);$('columns').setAttribute('aria-valuetext',columns===0?'文字索引':'每行 '+columns+' 个');$('columns').title=columns===0?'文字索引':'每行 '+columns+' 个';
  if(!result)return;assetMap=new Map(result.assets.map(a=>[a.id,a]));const items=filtered(result,scope,filters[scope],$('search').value),size=pageSize(columns);page=Math.max(0,Math.min(page,Math.ceil(items.length/size)-1));const shown=items.slice(page*size,(page+1)*size);grid.style.setProperty('--columns',String(columns===0?textColumns(shown,grid.clientWidth):columns));grid.replaceChildren();
  if(!items.length){const empty=el('div','','empty-state');empty.append(el('h2',filters[scope].size?'当前分类没有匹配内容':'请选择要查看的类别'),el('p','分类按钮支持多选；浏览筛选不改变保存或下载范围。'));grid.append(empty);}shown.forEach(item=>grid.append(card(item)));resetThumbnailJobs();const nav=$('pagination');nav.replaceChildren();if(items.length>size){const prev=action('上一页',()=>{page--;renderBoard();document.querySelector('.workspace').scrollIntoView({block:'start'});}),next=action('下一页',()=>{page++;renderBoard();document.querySelector('.workspace').scrollIntoView({block:'start'});});prev.disabled=page===0;next.disabled=(page+1)*size>=items.length;nav.append(prev,el('span',`${page+1} / ${Math.ceil(items.length/size)} 页`),next);}
}
function refreshDownload(){const state=downloadState(result?.assets||[],mediaSelected(),downloads);$('download').textContent=downloads?.active?'停止下载':'开始下载';for(const row of $('download-types').querySelectorAll('.download-row')){const k=row.dataset.kind,m=downloadMetrics(result?.assets||[],k,downloads),track=row.querySelector('.progress-track');track.querySelector('.progress-fill').style.width=m.percent+'%';track.setAttribute('aria-valuenow',String(Math.round(m.percent)));track.setAttribute('aria-valuetext',m.done+' / '+m.total+'，失败或不可用 '+m.failed);row.querySelector('.download-count').textContent=m.done+' / '+m.total;row.querySelector('.download-speed').textContent=m.speed>=1048576?(m.speed/1048576).toFixed(1)+' MB/s':(m.speed/1024).toFixed(0)+' KB/s';row.classList.toggle('is-unselected',!mediaSelected().includes(k));row.dataset.complete=String(m.total>0&&m.done===m.total);row.setAttribute('aria-busy',String(Boolean(downloads?.active&&downloads.files.some(a=>a.kind===k&&a.state==='downloading'))));}return state;}
function showDownloads(d){downloads=d;refreshDownload();updateButtons();const message=d.paused?'下载已暂停，请检查账号或素材权限。':d.cooldownSeconds?'限速等待 '+d.cooldownSeconds+' 秒':'';$('download-attention').hidden=!message;$('download-status').textContent=message;$('failed-files').replaceChildren(...d.files.filter(a=>['failed','unavailable'].includes(a.state)).map(a=>el('p',a.name+'：'+a.error)));$('failures').hidden=!d.failed;$('retry').hidden=!d.failed;}
function applyAccount(info){
  if(!['liblib','jimeng'].includes(info?.platform))return;
  const b=$('login-'+info.platform),name=info.platform==='liblib'?'LibTV':'即梦AI';
  b.dataset.state=info.state||'unknown';b.setAttribute('aria-busy',String(Boolean(info.checking)));
  const label=info.label||(info.state==='logged-in'?'已登录，点击打开平台':info.state==='logged-out'?'未登录，点击打开平台登录':'登录状态未确认，点击打开平台核对');
  b.title=name+' · '+label+(info.username?' · '+info.username:'');b.setAttribute('aria-label',b.title);
  b.querySelector('.account-name').textContent=name+(info.state==='logged-in'&&info.username?' '+info.username:'');
  const badge=b.querySelector('.account-status');badge.textContent=info.checking?'检查中':'';badge.hidden=!info.checking;
  const avatar=b.querySelector('.account-avatar');
  if(info.state==='logged-in'&&info.avatar){if(avatar.getAttribute('src')!==info.avatar){avatar.onerror=()=>{avatar.hidden=true;};avatar.src=info.avatar;avatar.hidden=false;}}
  else{avatar.hidden=true;avatar.removeAttribute('src');}
}
function applyProject(payload){project=payload;const opts=payload.options||options(),oldMode=mode();$('split').checked=Boolean(opts.split);$('mode').value=opts.mode||'simple';for(const c of $('export-types').querySelectorAll('input'))c.checked=opts.kinds.includes(c.dataset.kind);if(payload.manifestPath){$('local-project-path').value=payload.manifestPath;$('local-project-path').title=payload.manifestPath;}if(payload.directory||payload.root)$('output-dir').textContent=payload.directory||payload.root;$('output-dir').title=$('output-dir').textContent;if(!saving)$('saved').textContent=payload.documents?.length?'已保存：'+payload.documents.join('；'):'尚未保存提示词';$('project-name').textContent=result?filename():'等待读取项目';$('project-name').title=$('project-name').textContent;refreshDownload();if(!downloads?.active)renderBoard();else updateButtons();if(oldMode!==mode())rebuildReaders();}

window.lab.onEvent(({type,payload})=>{
  if(type==='status')status(payload.message,payload.phase);if(type==='account')applyAccount(payload);if(type==='platform-visible'){opened=true;visible=payload;$('visibility').textContent=visible?'隐藏平台':'显示平台';updateButtons();}
  if(type==='browser-resetting'){setBrowserResetting(payload);}
  if(type==='platform-reset'){opened=false;visible=false;$('visibility').textContent='显示平台';updateButtons();}
  if(type==='reset'){clearVideoThumbnails();$('retry').hidden=true;closeMediaPreview();clearReaders();result=null;project=null;downloads=null;page=0;clearTimeout(saveTimer);$('entries').replaceChildren(el('div','正在读取画布…','empty-state loading-canvas'));$('warnings').hidden=true;$('saved').textContent='尚未保存提示词';$('project-name').textContent='正在读取项目…';refreshDownload();$('pagination').replaceChildren();}
  if(type==='result'){if(payload.localProject){$('search').value='';scope='prompts';filters.prompts=new Set(Object.keys(TYPES));filters.assets=new Set(Object.keys(MEDIA));}clearVideoThumbnails();$('failures').hidden=true;$('download-attention').hidden=true;$('failed-files').replaceChildren();$('retry').hidden=true;closeMediaPreview();clearReaders();result=payload;downloads=null;page=0;assetMap=new Map(result.assets.map(a=>[a.id,a]));$('url').value=result.metadata.inputUrl;$('project-name').textContent=filename();$('project-name').title=filename();$('saved').textContent='尚未保存提示词';const d=result.diagnostics;$('warning-body').replaceChildren(...d.warnings.map(w=>el('p',w)));$('warning-summary').textContent=`提取说明 · ${d.warnings.length} 项`;$('warnings').hidden=!d.warnings.length;const categoryCounts=countKinds(result.entries,Object.keys(TYPES));for(const k of Object.keys(TYPES))$('export-count-'+k).textContent=categoryCounts[k];for(const k of Object.keys(MEDIA))$('media-count-'+k).textContent=result.assets.filter(a=>a.kind===k).length;renderBoard();refreshDownload();}
  if(type==='project')applyProject(payload);if(type==='downloads')showDownloads(payload);if(type==='assets'&&result){result.assets=payload;assetMap=new Map(payload.map(a=>[a.id,a]));prepareVideoThumbnails(payload,{full:onlinePreview()});refreshDownload();if(!downloads?.active){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{renderBoard();rebuildReaders();},120);}}
});
async function extract(){const input=$('url').value.trim();if(!input){status('请先粘贴作品链接。','error');return;}clearTimeout(saveTimer);busy=true;opened=true;updateButtons();try{const r=await window.lab.extract(input,{...options(),visible:$('show-first').checked,theme:appearance.get()});if(!r.ok)status(r.error,'error');}catch(e){status(e.message,'error');}finally{busy=false;updateButtons();}}
async function openLocalProject(){if(localOpening||busy||saving||downloads?.active||downloadStarting||browserResetting)return;localOpening=true;updateButtons();try{const r=await window.lab.openLocalProject($('local-project-path').value);if(!r.ok)throw new Error(r.error);}catch(error){status(error.message,'error');}finally{localOpening=false;updateButtons();}}
$('open-local-project').addEventListener('click',openLocalProject);$('local-project-path').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();openLocalProject();}});
$('start').addEventListener('click',()=>{if(busy)window.lab.cancel();else extract();});$('visibility').addEventListener('click',async()=>{const r=await window.lab.visible(!visible);if(!r.ok)status(r.error,'error');});$('save-prompts').addEventListener('click',()=>saveNow());
$('mode-toggle').addEventListener('click',async()=>{const old=mode();$('mode').value=old==='full'?'simple':'full';const r=await window.lab.update(options());if(!r.ok){$('mode').value=old;status(r.error,'error');}renderBoard();rebuildReaders();refreshDownload();});
$('mode').addEventListener('change',async()=>{const r=await window.lab.update(options());if(!r.ok)status(r.error,'error');renderBoard();rebuildReaders();refreshDownload();});$('split').addEventListener('change',()=>updateButtons());

$('search').addEventListener('input',()=>{page=0;clearTimeout(renderTimer);renderTimer=setTimeout(renderBoard,140);});$('columns').addEventListener('input',()=>{const next=Number($('columns').value)===11?0:Math.max(1,normalizeDensity($('columns').value));if(next===columns)return;columns=next;page=0;try{localStorage.setItem('columns',String(columns));}catch{}clearTimeout(renderTimer);renderTimer=setTimeout(renderBoard,70);});
for(const s of ['prompts','assets'])$('tab-'+s).addEventListener('click',()=>{scope=s;page=0;renderBoard();});
$('board-toggle').addEventListener('click',()=>{$('board-body').hidden=!$('board-body').hidden;$('board-toggle').textContent=$('board-body').hidden?'展开看板':'收起看板';$('board-toggle').setAttribute('aria-expanded',String(!$('board-body').hidden));});
for(const b of $('read-layouts').querySelectorAll('button'))b.addEventListener('click',()=>{preferredLayout=b.dataset.layout;try{localStorage.setItem('read-layout',preferredLayout);}catch{}updateReaderLayout();});$('collapse-readers').addEventListener('click',()=>{for(const r of readers){r.collapsed=true;updateCollapsed(r);}});$('clear-readers').addEventListener('click',clearReaders);
new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{updateReaderLayout();if(columns===0&&result)renderBoard();},80);}).observe($('reader-section'));
$('directory').addEventListener('click',async()=>{const r=await window.lab.directory();if(r.ok){$('output-dir').textContent=r.value;$('output-dir').title=r.value;}else status(r.error,'error');});$('folder').addEventListener('click',async()=>{const r=await window.lab.openFolder();if(!r.ok)status(r.error,'error');});
for(const p of ['liblib','jimeng'])$('login-'+p).addEventListener('click',async()=>{if(loginBusy.has(p))return;loginBusy.add(p);updateButtons();try{const r=await window.lab.login(p);if(r.ok){opened=true;applyAccount(r.value);}else status(r.error,'error');}finally{loginBusy.delete(p);updateButtons();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&opened)window.lab.loginState().then(r=>{if(r.ok)applyAccount(r.value);}).catch(()=>{});});
async function requestDownload(args){if(downloadStarting||busy||saving||downloads?.active)return;downloadStarting=true;updateButtons();try{const updated=await window.lab.update(options());if(!updated.ok)throw new Error(updated.error);const r=await window.lab.download(args);if(!r.ok)throw new Error(r.error);}catch(e){status(e.message,'error');}finally{downloadStarting=false;updateButtons();}}
async function startDownload(retryOnly=false,force=false){return requestDownload({kinds:mediaSelected(),retryOnly,force});}
$('download').addEventListener('click',async()=>{if(downloads?.active){const r=await window.lab.downloadControl('cancel');if(!r.ok)status(r.error,'error');return;}const state=refreshDownload();if(state.complete){$('redownload-count').textContent='将重新下载 '+state.total+' 个素材。';$('redownload-dialog').showModal();}else startDownload();});$('redownload-cancel').addEventListener('click',()=>{$('redownload-dialog').close();});$('redownload-confirm').addEventListener('click',()=>{$('redownload-dialog').close();startDownload(false,true);});$('retry').addEventListener('click',()=>startDownload(true));$('resume-download').addEventListener('click',async()=>{const r=await window.lab.downloadControl('resume');if(!r.ok)status(r.error,'error');});

let appearanceStorage;try{appearanceStorage=window.localStorage;}catch{}
const appearance=createThemeManager({storage:appearanceStorage,sync:value=>window.lab.theme(value),onError:error=>status(error.message,'error')});
const promptTypography=createTypographyManager({storage:appearanceStorage,onError:error=>status(error.message,'error')});
function setBrowserResetting(value){
  browserResetting=Boolean(value);
  for(const control of $('appearance-dialog').querySelectorAll('button,input'))if(control.id!=='appearance-close')control.disabled=browserResetting;
  if(browserResetting){clearVideoThumbnails();closeMediaPreview();stopIn($('reading-board'));for(const p of ['liblib','jimeng'])applyAccount({platform:p,state:'unknown',label:'浏览器正在重置'});}
  updateButtons();
}
$('browser-reset').addEventListener('click',async()=>{
  if(browserResetting||busy||saving||downloads?.active||downloadStarting||loginBusy.size)return;
  const settings={};for(const key of ['appearance-v1','theme','prompt-typography-v1','columns','read-layout']){try{const value=localStorage.getItem(key);if(value!==null)settings[key]=value;}catch{}}
  const notice=$('browser-reset-status');notice.hidden=false;notice.dataset.phase='running';notice.textContent='正在清除浏览数据…';
  setBrowserResetting(true);
  try{const response=await window.lab.resetBrowser(settings);if(!response.ok)throw new Error(response.error);notice.dataset.phase='done';notice.textContent='浏览器已重置，重新访问平台时需登录。';}
  catch(error){notice.dataset.phase='error';notice.textContent='重置未完成：'+error.message;}
  finally{setBrowserResetting(false);}
});
$('appearance-reset').addEventListener('click',()=>{document.dispatchEvent(new Event('appearance-reset'));appearance.set(window.CanvasThemes.DEFAULT_PREFERENCE);promptTypography.set(window.PromptTypography.DEFAULT_TYPOGRAPHY);});
try{const saved=localStorage.getItem('columns');if(saved!==null){columns=normalizeDensity(saved);$('columns').value=columns===0?11:columns;}const pref=localStorage.getItem('read-layout');if(READ_LAYOUTS.includes(pref))preferredLayout=pref;}catch{}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&focusedReader&&!$('redownload-dialog').open&&!$('media-dialog').open){const r=readers.find(x=>x.key===focusedReader);if(r&&!r.collapsed){r.collapsed=true;updateCollapsed(r);}}});
window.lab.info().then(r=>{if(r.ok){$('output-dir').textContent=r.value.outputDirectory;$('mode').value=r.value.options.mode;for(const info of r.value.accounts||[])applyAccount(info);updateButtons();}}).catch(e=>status(e.message,'error'));initMediaDialog(mediaOutput,stopIn,enterPreviewReader);renderBoard();updateReaderLayout();

})();
