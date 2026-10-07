'use strict';
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const path=require('node:path');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {safeUrl,EXTENSIONS,extension}=require('./assets.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
class DownloadError extends Error {constructor(message,options={}){super(message);Object.assign(this,options);}}
function retryAfter(value,now=Date.now()){if(!value)return 0;const secs=Number(value);if(Number.isFinite(secs))return Math.max(0,secs*1000);return Math.max(0,Date.parse(value)-now)||0;}
const MIME={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/avif':'.avif','image/bmp':'.bmp','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','audio/mpeg':'.mp3','audio/mp3':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/mp4':'.m4a','audio/aac':'.aac','audio/ogg':'.ogg','audio/flac':'.flac','audio/x-flac':'.flac'};
function sniff(bytes,kind) {
  const b=Buffer.from(bytes),ascii=(start,end)=>b.toString('ascii',start,end);
  if(kind==='image') {
    if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
    if(b[0]===255&&b[1]===216&&b[2]===255)return '.jpg';
    if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return '.webp';
    if(/^GIF8[79]a$/.test(ascii(0,6)))return '.gif';
    if(ascii(4,8)==='ftyp'&&/avif|avis/.test(ascii(8,24)))return '.avif';
    if(ascii(0,2)==='BM')return '.bmp';
  }
  if(kind==='video'){if(ascii(4,8)==='ftyp')return ascii(8,12)==='qt  '?'.mov':'.mp4';if(b.subarray(0,4).equals(Buffer.from([26,69,223,163])))return '.webm';}
  if(kind==='audio') {
    if(ascii(0,3)==='ID3')return '.mp3';if(b[0]===255&&(b[1]&224)===224)return (b[1]&246)===240?'.aac':'.mp3';
    if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE')return '.wav';
    if(ascii(0,4)==='OggS')return '.ogg';if(ascii(0,4)==='fLaC')return '.flac';if(ascii(4,8)==='ftyp')return '.m4a';
  }
  return '';
}
async function prepareMedia(response,asset,{partialRange=false}={}) {
  const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(mime && !mime.startsWith(asset.kind+'/')&&!['application/octet-stream','binary/octet-stream','text/plain'].includes(mime)) {await response.body?.cancel();throw new DownloadError('返回内容不是所选类型的媒体文件（'+mime+'）。',{terminal:true});}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    while(size<32){const next=await reader.read();if(next.done)break;chunks.push(next.value);size+=next.value.length;}
    const ext=partialRange?(MIME[mime]||extension(asset.url,asset.kind)):sniff(Buffer.concat(chunks.map(c=>Buffer.from(c))),asset.kind);
    if(!ext||!EXTENSIONS[asset.kind].includes(ext))throw new DownloadError('文件头校验失败，未保存为素材。',{terminal:true});
    const stream=new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(chunk);},async pull(c){try{const n=await reader.read();if(n.done)c.close();else c.enqueue(n.value);}catch(e){c.error(e);}},cancel(){return reader.cancel();}});
    const contentType=Object.keys(MIME).find(k=>MIME[k]===ext)||asset.kind+'/octet-stream';
    return {ext,stream,contentType};
  }catch(e){await reader.cancel().catch(()=>{});throw e;}
}
async function fetchMedia(fetcher,url,options) {
  for(let i=0;i<6;i++) {
    const valid=safeUrl(url);if(!valid)throw new DownloadError('素材地址不受支持。',{terminal:true});
    const r=await fetcher(valid,{...options,redirect:'manual'});
    if(r.status>=300&&r.status<400){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw new DownloadError('下载跳转地址缺失。',{terminal:true});url=new URL(next,valid).href;continue;}
    return r;
  }
  throw new DownloadError('素材跳转次数过多。',{terminal:true});
}
class DownloadQueue {
  constructor({fetcher,filePath,onProgress=()=>{},onSettled=async()=>{},onPrepare=async()=>{},concurrency=2,interval=1000,retryDelays=[5000,15000],timeout=180000}) {
    Object.assign(this,{fetcher,filePath,onProgress,onSettled,onPrepare,concurrency,interval,retryDelays,timeout});this.active=false;this.paused=false;this.cancelled=false;this.controllers=new Set();this.nextStart=0;this.selection=[];this.cooldownUntil=0;this.running=0;
  }
  summary(){const selected=this.selection,now=Date.now(),elapsed=now-(this.speedAt||now);if(elapsed>=250){this.speeds=Object.fromEntries(['video','image','audio'].map(k=>[k,((this.transferred?.[k]||0)-(this.speedBefore?.[k]||0))*1000/elapsed]));this.speedBefore={...this.transferred};this.speedAt=now;}return{active:this.active,paused:this.paused,cancelled:this.cancelled,total:selected.length,done:selected.filter(a=>a.state==='done').length,failed:selected.filter(a=>['failed','unavailable'].includes(a.state)).length,running:this.running,speeds:this.active&&!this.paused?this.speeds||{}:{},cooldownSeconds:Math.max(0,Math.ceil((this.cooldownUntil-Date.now())/1000)),files:selected.map(a=>({id:a.id,kind:a.kind,name:a.fileName,state:a.state,bytes:a.bytes,total:a.total,error:a.error}))};}
  emit(){this.onProgress(this.summary());}
  pause(){this.paused=true;for(const c of this.controllers)c.abort('paused');this.wake?.();this.emit();}
  resume(){this.paused=false;this.wake?.();this.emit();}
  cancel(){this.cancelled=true;this.paused=false;for(const c of this.controllers)c.abort('cancelled');this.wake?.();this.emit();}
  async gate(){while(!this.cancelled&&(this.paused||Date.now()<this.cooldownUntil)) {this.emit();await wait(250);}if(this.cancelled)throw new DownloadError('下载已取消。',{cancelled:true});}
  slot(){const next=(this.startTail||Promise.resolve()).catch(()=>{}).then(async()=>{await this.gate();while(Date.now()<this.nextStart){await this.gate();await wait(Math.max(0,Math.min(200,this.nextStart-Date.now())));}await this.gate();this.nextStart=Date.now()+this.interval;});this.startTail=next;return next;}
  // One attempt only. Backoff belongs to the scheduler, not a download worker.
  async one(asset,failures=0) {
    await this.slot();const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort('timeout'),this.timeout);
    let temp,preparedStream;
    try {
      asset.state='downloading';asset.bytes=0;asset.total=0;asset.error='';this.running++;this.emit();
      const response=await fetchMedia(this.fetcher,asset.url,{signal:controller.signal,credentials:'include'});
      if(!response.ok) {
        await response.body?.cancel();
        if(response.status===429)throw new DownloadError('服务器要求降低下载频率。',{cooldown:retryAfter(response.headers.get('retry-after'))||30000});
        if([401,403].includes(response.status))throw new DownloadError('登录、素材权限或链接有效期需要检查。重新登录或重新提取后重试。',{terminal:true,attention:true});
        throw new DownloadError('下载返回 HTTP '+response.status,{terminal:response.status>=400&&response.status<500});
      }
      const {ext,stream}=await prepareMedia(response,asset);
      preparedStream=stream;
      asset.fileName=asset.fileName.slice(0,-path.extname(asset.fileName).length)+ext;
      const target=this.filePath(asset),existing=await fs.stat(target).catch(()=>null);
      if(existing) {await stream.cancel();if(asset.savedBytes&&existing.size===asset.savedBytes){asset.state='done';asset.bytes=existing.size;asset.total=existing.size;return;}throw new DownloadError('同名本地文件已存在，请重新提取以核对文件。',{terminal:true});}
      temp=target+'.partial';await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});
      asset.total=Number(response.headers.get('content-length'))||0;
      let last=0;
      const counter=new Transform({transform:(chunk,_enc,callback)=>{asset.bytes+=chunk.length;this.transferred[asset.kind]=(this.transferred[asset.kind]||0)+chunk.length;if(Date.now()-last>150){last=Date.now();this.emit();}callback(null,chunk);}});
      await pipeline(Readable.fromWeb(stream),counter,fsSync.createWriteStream(temp,{flags:'wx'}),{signal:controller.signal});
      if(!asset.bytes ||asset.total&&asset.bytes!==asset.total)throw new DownloadError('文件大小校验失败。');
      // Hard-link is exclusive: never overwrite a file created while downloading.
      await fs.link(temp,target);await fs.unlink(temp);temp=null;
      asset.state='done';asset.total=asset.bytes;asset.savedBytes=asset.bytes;asset.error='';return;
    } catch(error) {
      if(this.cancelled){asset.state='pending';asset.error='下载已取消';return;}
      if(this.paused||controller.signal.reason==='paused'){asset.state='pending';asset.bytes=0;asset.error='已暂停';return {retryAt:Date.now(),consumeRetry:false};}
      if(error.cooldown){this.cooldownUntil=Math.max(this.cooldownUntil,Date.now()+error.cooldown);asset.error=error.message;}
      if(error.attention)this.pause();
      if(error.terminal||failures>=this.retryDelays.length){asset.state='failed';asset.error=controller.signal.reason==='timeout'?'下载超时':error.message;return;}
      asset.state='pending';asset.error='等待重试：'+error.message;
      return {retryAt:Date.now()+this.retryDelays[failures],consumeRetry:true};
    } finally {
      clearTimeout(timer);this.controllers.delete(controller);this.running=Math.max(0,this.running-1);if(preparedStream)await preparedStream.cancel().catch(()=>{});if(temp)await fs.unlink(temp).catch(()=>{});this.emit();
    }
  }
  async start(assets,kinds,retryOnly=false,force=false) {
    if(this.active)throw new Error('下载任务正在进行。');
    this.selection=assets.filter(a=>kinds.includes(a.kind));this.active=true;this.paused=false;this.cancelled=false;this.nextStart=0;this.cooldownUntil=0;this.startTail=Promise.resolve();this.transferred={};this.speedBefore={};this.speeds={};this.speedAt=Date.now();
    const delayed=[],waiters=new Set();let inFlight=0;
    const wake=()=>{for(const done of [...waiters])done();};this.wake=wake;
    const changed=delay=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);waiters.delete(done);resolve();};const timer=setTimeout(done,delay);waiters.add(done);});
    this.emit();
    try {
      if(force)await this.onPrepare(this.selection);
      // Preserve the original asset order. Due retries join the same FIFO tail.
      const ready=this.selection.filter(a=>a.url&&a.state!=='done'&&(!retryOnly||a.state==='failed')).map(asset=>({asset,failures:0}));
      const promote=()=>{const now=Date.now();for(let i=0;i<delayed.length;){if(delayed[i].retryAt<=now)ready.push(delayed.splice(i,1)[0]);else i++;}};
      const take=async()=>{
        while(!this.cancelled){
          promote();
          if(!ready.length&&!delayed.length&&!inFlight)return null;
          // Idle workers must still notice that a permission failure ended all
          // work, even when that failure paused the queue.
          if(this.paused||Date.now()<this.cooldownUntil){await changed(250);if(!this.cancelled)this.emit();continue;}
          if(ready.length){inFlight++;return ready.shift();}
          if(!delayed.length&&!inFlight)return null;
          const due=delayed.length?Math.min(...delayed.map(job=>job.retryAt))-Date.now():250;
          await changed(Math.max(1,Math.min(250,due)));
          if(!this.cancelled)this.emit();
        }
        return null;
      };
      const worker=async()=>{
        for(;;){
          const job=await take();if(!job)return;
          try {
            let outcome;
            try{outcome=await this.one(job.asset,job.failures);}catch(error){if(!this.cancelled){job.asset.state='failed';job.asset.error=error.message;}}
            if(outcome&&!this.cancelled){if(outcome.consumeRetry)job.failures++;job.retryAt=outcome.retryAt;delayed.push(job);}
            await this.onSettled(job.asset);
          }finally{inFlight--;wake();}
        }
      };
      // A callback failure cancels the pool, then waits for every worker cleanup.
      const outcomes=await Promise.allSettled(Array.from({length:this.concurrency},()=>worker().catch(error=>{this.cancel();throw error;})));
      const failure=outcomes.find(outcome=>outcome.status==='rejected');if(failure)throw failure.reason;
    }
    finally{if(this.cancelled)for(const job of delayed){job.asset.state='pending';job.asset.error='下载已取消';}wake();this.wake=null;this.active=false;this.emit();await this.onSettled(null);}
    return this.summary();
  }
}
module.exports={DownloadQueue,DownloadError,retryAfter,fetchMedia,prepareMedia,sniff};
