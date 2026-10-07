import {VideoCoverQueue} from './video-cover-queue.js';
import {remoteFrameSource} from './video-sample.js';
import {PreviewPool} from './preview-pool.js';
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
export function prepareVideoThumbnails(assets,{full=false}={}){videoCovers.setAssets(assets,full);}
export function clearVideoThumbnails(){videoCovers.setAssets([],false);imageCache.clear();resetThumbnailJobs();}
function ensureVideo(asset,full){if(!videoCovers.jobs.has(asset.id))videoCovers.setAssets([...videoCovers.jobs.values()].map(j=>j.asset).concat(asset),full);}
export function bindVideoPoster(player,asset,{full=false}={}){
  ensureVideo(asset,full);
  const binding={node:player,id:asset.id,update:job=>{if(job.data)player.poster=job.data;}};
  videoBindings.add(binding);binding.update(videoCovers.jobs.get(asset.id));videoCovers.request(asset.id,{priority:true});
  if(!full&&asset.state!=='done')window.lab.thumbnailInfo(asset.id).then(r=>{if(player.isConnected&&r.ok&&r.value)player.poster=`labmedia://thumbnail/${asset.id}`;}).catch(()=>{});
}
export function attachThumbnail(container,asset,{full=false,immediate=false}={}){
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
export function resetThumbnailJobs(){work=work.filter(job=>job.node.isConnected);for(const b of [...videoBindings])if(!b.node.isConnected)videoBindings.delete(b);}
