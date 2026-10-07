'use strict';
const PROMPT_TYPES={video:'视频提示词',image:'图片提示词',audio:'音频提示词',text:'独立文本'};
const promptKind=kind=>kind==='image'||String(kind).startsWith('image_')?'image':kind;
const promptKinds=kinds=>Object.keys(PROMPT_TYPES).filter(k=>(kinds||[]).some(raw=>promptKind(raw)===k));
module.exports={PROMPT_TYPES,promptKind,promptKinds};
