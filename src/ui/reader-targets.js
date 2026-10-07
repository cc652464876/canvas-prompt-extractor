// Keep the clicked node identity even when assets share the same file.
export function readerTarget(result,scope,item,nodeId){
  if(scope==='prompts')return{scope,item,nodeId:item.nodeId,key:'prompts:'+item.nodeId};
  const ids=item.nodeIds||[];
  const targetId=nodeId||(ids.length===1?ids[0]:null);
  const entry=targetId?result?.entries.find(e=>e.nodeId===targetId):null;
  if(entry)return readerTarget(result,'prompts',entry);
  return{scope:'assets',item,nodeId:targetId,key:targetId?'asset-node:'+targetId:'assets:'+item.id};
}

export function referencingEntries(result,nodeId,assetIds=[]){
  const seen=new Set();
  return(result?.entries||[]).filter(entry=>{
    if(entry.nodeId===nodeId||seen.has(entry.nodeId))return false;
    const referenced=(entry.references||[]).some(ref=>nodeId?ref.nodeId===nodeId:(ref.assetIds||[]).some(id=>assetIds.includes(id)));
    if(referenced)seen.add(entry.nodeId);
    return referenced;
  });
}
