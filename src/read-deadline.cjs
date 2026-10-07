'use strict';
function readError(code,message){return Object.assign(new Error(message),{code});}
// Always consume late completion/rejection, and release timers and listeners.
// The operation's result cannot continue an extraction after cancellation.
function boundedRead(operation,{timeoutMs=10000,deadline=Infinity,signal,message='页面读取超时。'}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(readError('READ_CANCELLED','任务已取消。'));return;}
    const remaining=deadline-Date.now();
    if(remaining<=0){reject(readError('READ_DEADLINE','读取画布超过等待期限，请显示平台页面检查后重试。'));return;}
    let settled=false,timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
    const cancel=()=>finish(readError('READ_CANCELLED','任务已取消。'));
    signal?.addEventListener('abort',cancel,{once:true});
    const overall=remaining<=timeoutMs;
    timer=setTimeout(()=>finish(readError(overall?'READ_DEADLINE':'READ_OPERATION_TIMEOUT',overall?'读取画布超过等待期限，请显示平台页面检查后重试。':message)),Math.max(1,Math.min(timeoutMs,remaining)));
    Promise.resolve().then(()=>{if(signal?.aborted)throw readError('READ_CANCELLED','任务已取消。');return operation();}).then(value=>finish(null,value),error=>finish(error));
  });
}
module.exports={boundedRead};
