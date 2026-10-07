// Website images and video decoding have independent concurrency limits.
export class VideoCoverQueue {
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
