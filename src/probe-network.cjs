'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async function({root,session,net}){
  const sample=JSON.parse(await fs.readFile(path.join(root,'validation','liblib-snapshot.json'),'utf8')).assets.find(a=>a.kind==='image');const ses=session.fromPartition('persist:liblib');
  const cases=[['actual-referer',{redirect:'manual',credentials:'include',headers:{Referer:'https://www.liblib.tv/detail/dd52623a77ed4713955009228c621446'}}],['manual+credentials+referer',{redirect:'manual',credentials:'include',headers:{Referer:'https://www.liblib.tv/'}}],['credentials+referer',{credentials:'include',headers:{Referer:'https://www.liblib.tv/'}}],['manual',{redirect:'manual'}],['default',{}]];
  const report=[];
  ses.setPermissionRequestHandler((_wc,permission,cb,details)=>{report.push({permission,requestingUrl:details.requestingUrl});cb(false);});
  for(const [name,options]of cases){try{const r=await ses.fetch(sample.url,{...options,signal:AbortSignal.timeout(15000)});report.push({name,status:r.status,mime:r.headers.get('content-type')});await r.body?.cancel();}catch(e){report.push({name,error:e.message});}await new Promise(r=>setTimeout(r,1000));}
  await fs.writeFile(path.join(root,'validation','network-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
};
