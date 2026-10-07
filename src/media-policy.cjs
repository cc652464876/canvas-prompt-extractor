'use strict';
function selectDownloadAssets(assets,ids){if(ids===undefined)return assets;if(!Array.isArray(ids)||ids.length!==1||typeof ids[0]!=='string')throw new Error('单素材下载必须指定一个有效素材。');const selected=assets.filter(a=>ids.includes(a.id));if(selected.length!==1)throw new Error('素材已不属于当前项目，请重新打开。');return selected;}
function createFrameLimiter({limit=8*1024*1024,maxRequests=6,ttl=30000,now=Date.now}={}){
  const budgets=new Map();
  async function frameRange(id,range){for(const[key,b]of budgets)if(now()-b.time>ttl)budgets.delete(key);let b=budgets.get(id);if(!b){b={time:now(),bytes:0,requests:0};budgets.set(id,b);}if(++b.requests>maxRequests||b.bytes>=limit)throw new Error('封面读取预算已用尽');const match=String(range||'bytes=0-').match(/^bytes=(\d+)-(\d*)$/);if(!match)throw new Error('不支持的封面范围');const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):start+1024*1024-1,start+1024*1024-1);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start)throw new Error('无效的封面范围');return `bytes=${start}-${end}`;}
  async function boundedFrame(id,response,stream){const b=budgets.get(id);if(!b){await stream.cancel();throw new Error('封面读取已过期');}if(response.status!==206&&Number(response.headers.get('content-length'))>limit-b.bytes){await stream.cancel();throw new Error('服务器不支持小范围读取');}const reader=stream.getReader();return new ReadableStream({async pull(controller){try{const next=await reader.read();if(next.done){controller.close();return;}b.bytes+=next.value.length;if(b.bytes>limit){await reader.cancel();controller.error(new Error('封面读取量已达上限'));return;}controller.enqueue(next.value);}catch(e){controller.error(e);}},cancel:reason=>reader.cancel(reason)});}
  return{frameRange,boundedFrame};
}
module.exports={selectDownloadAssets,createFrameLimiter};
