export const TYPES={video:'视频提示词',image:'图片提示词',audio:'音频提示词',text:'独立文本'};
export function promptKind(kind){return kind==='image'||String(kind).startsWith('image_')?'image':kind;}
export const MEDIA={image:'图片',video:'视频',audio:'音频'};
export const SOURCE={uploaded:'上传参考',generated:'生成结果',unknown:'来源未确认'};
export function aspect(asset){const w=Number(asset?.width),h=Number(asset?.height);if(w>0&&h>0&&w<=32768&&h<=32768)return w/h;const m=String(asset?.ratio||'').match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);return m&&Number(m[1])>0&&Number(m[2])>0?Number(m[1])/Number(m[2]):16/9;}
export function filtered(result,scope,kind,query=''){if(!result)return[];const q=query.trim().toLowerCase();return(scope==='assets'?result.assets:result.entries).filter(item=>{const category=scope==='assets'?item.kind:promptKind(item.kind);return(kind instanceof Set?kind.has(category)||kind.has(item.kind):Array.isArray(kind)?kind.includes(category)||kind.includes(item.kind):kind==='all'||category===kind||item.kind===kind)&&[item.name,item.group,item.prompt,MEDIA[category],TYPES[category],...(item.referenceTexts||[]).map(r=>r.text)].filter(Boolean).join(' ').toLowerCase().includes(q);});}
export function countKinds(items,keys){return Object.fromEntries(keys.map(k=>[k,items.filter(i=>promptKind(i.kind)===k).length]));}
export function downloadMetrics(assets,kind,progress){const fresh=new Map((progress?.files||[]).map(a=>[a.id,a]));const files=assets.filter(a=>a.kind===kind).map(a=>({...a,...fresh.get(a.id)}));const done=files.filter(a=>a.state==='done').length,total=files.length,failed=files.filter(a=>['failed','unavailable'].includes(a.state)).length;return{done,total,failed,percent:total?done/total*100:0,speed:progress?.active&&!progress.paused?progress.speeds?.[kind]||0:0};}
export function downloadState(assets,kinds,progress){const selected=assets.filter(a=>kinds.includes(a.kind)),done=selected.filter(a=>a.state==='done').length,failed=selected.filter(a=>['failed','unavailable'].includes(a.state)).length;
  if(progress?.active)return{label:progress.paused?'下载已暂停':'正在下载',button:'停止下载',done,total:selected.length,failed,complete:false};
  const complete=selected.length>0&&done===selected.length;return{label:complete?'下载完毕':!selected.length?'未选择素材':done?'部分素材已保存':'等待下载',button:complete?'重新下载':'开始下载',done,total:selected.length,failed,complete};}
export function pageSize(columns){return columns===0?36:Math.max(24,columns*6);}
export const READ_LAYOUTS=['side','stack','dual'];
export function readingLayout(preferred,width){if(!READ_LAYOUTS.includes(preferred))preferred='dual';return preferred==='dual'&&width>=1120?'dual':preferred==='side'&&width>=1020?'side':'stack';}
export function textColumns(items,width){const maxLength=Math.max(0,...items.map(i=>String(i.name||'').length+String(i.model||'').length));const minimum=Math.min(460,Math.max(340,maxLength*7+85));return Math.max(1,Math.min(4,Math.floor(width/minimum)));}
export function normalizeDensity(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(10,Math.round(n))):5;}
export function snapHeight(height,unit){const bounded=Math.max(140,Math.min(1200,height));if(!unit||unit<100)return Math.round(bounded);const target=Math.round(bounded/unit)*unit;return target>=140&&target<=1200&&Math.abs(target-bounded)<=24?Math.round(target):Math.round(bounded);}
