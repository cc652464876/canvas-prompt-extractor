// Shared by image thumbnails and video poster images, including their bodies.
export class PreviewPool {
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
