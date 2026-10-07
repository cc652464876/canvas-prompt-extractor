'use strict';
const { buildAssets,linkEntries } = require('./assets.cjs');
const {PROMPT_TYPES,promptKind}=require('./prompt-types.cjs');
const TYPES = {
  video: '视频生成', image_text: '文生图', image_reference: '图生图／图片编辑',
  image_unknown: '图片生成（模式未确认）', audio: '音频生成', text: '独立文本'
};
function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string' || value instanceof String) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value.text === 'string') return value.text;
  return '';
}
function cleanRichText(value) {
  return textOf(value).replace(/^\u0000rt-md:v\d+\r?\n/, '');
}
function classifyImage(mode) {
  const value = textOf(mode).toLowerCase().replace(/[-_\s]/g, '');
  if (['texttoimage', 'text2image', 't2i', '文生图'].includes(value)) return 'image_text';
  if (['imagetoimage', 'image2image', 'i2i', 'edit', 'imageedit', '图生图', '图片编辑'].includes(value)) return 'image_reference';
  return 'image_unknown';
}
function groupOf(node, byId) {
  const parts = [], seen = new Set([node.id]);
  let parent = node.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent); const item = byId.get(parent); if (!item) break;
    parts.unshift(textOf(item.data?.name || item.data?.title) || '未命名分组'); parent = item.parentId;
  }
  return parts.join(' / ') || '未分组';
}
function nodeText(node) {
  const d = node.data || {};
  return cleanRichText(d.text ?? d.storageText ?? d.content);
}
function normalize(snapshot, metadata) {
  const nodes = snapshot.nodes || [], byId = new Map(nodes.map(n => [n.id, n]));
  const entries = [], skipped = [], warnings = [];
  for (const node of nodes) {
    const d = node.data || {}, params = d.params || {}, draft = d.generationDraft;
    const name = textOf(d.name || d.title) || '未命名';
    const common = { nodeId: node.id, name, group: groupOf(node, byId), position: node.position || {}, references: [], referenceTexts: [] };
    if (node.type === 'text') {
      const prompt = nodeText(node);
      if (prompt.trim()) entries.push({ ...common, kind: 'text', prompt, promptSource: 'text-node', settings: {} });
      else skipped.push({ nodeId: node.id, name, reason: '文本内容不可读' });
      continue;
    }
    if (draft) {
      const refs = (draft.references || []).map((r, i) => {
        const target = byId.get(r.nodeId || r.sourceInstanceId);
        return { index: i + 1, slotId: r.slotId, nodeId: r.nodeId || r.sourceInstanceId,
          type: target?.type || r.type, name: textOf(target?.data?.title || target?.data?.name) || '未命名参考', role: r.role };
      });
      const partWarnings = [];
      const prompt = (draft.parts || []).map(part => {
        if (part.type === 'text') return textOf(part.text);
        if (part.type === 'extension') {
          const ref = refs.find(r => r.slotId === part.object_id || r.nodeId === part.object_id);
          if (!ref) partWarnings.push(`无法匹配参考标记 ${part.object_id}`);
          return ref ? `【参考：${ref.name}；节点 ${ref.nodeId}】` : `【未解析参考：${part.object_id || part.type}】`;
        }
        partWarnings.push(`不支持的富文本片段：${part.type}`); return `【未解析片段：${part.type}】`;
      }).join('');
      const referenceTexts = refs.filter(r => r.type === 'text').map(r => ({ ...r, text: nodeText(byId.get(r.nodeId) || { data: {} }) }));
      const settings = draft.contentSettings || {};
      const kind = draft.kind === 'video' ? 'video' : draft.kind === 'audio' ? 'audio' : draft.kind === 'image' ? classifyImage(settings.mode) : null;
      if (kind && (prompt.trim() || referenceTexts.some(r => r.text.trim()))) {
        entries.push({ ...common, kind, prompt, promptSource: prompt.trim() ? 'generation-draft' : 'reference-text-only',
          references: refs, referenceTexts, settings: { ...settings, outputCount: draft.outputCount }, model: settings.modelName || '',
          rawParts: draft.parts || [], warnings: partWarnings, resourceId: d.resourceId });
      } else skipped.push({ nodeId: node.id, name, reason: kind ? '生成节点没有可读直接提示词或关联文本' : '生成类型尚未适配' });
      warnings.push(...partWarnings.map(w => `${name}：${w}`));
      continue;
    }
    const actions = { video_generate: 'video', image_generate: classifyImage(params.modeType), audio_generate: 'audio' };
    const kind = Object.hasOwn(actions,d.action) ? actions[d.action] : null, prompt = textOf(params.prompt);
    if (kind && prompt.trim()) {
      const references = [];
      if (Array.isArray(params.mixedList) && params.mixedList.length) {
        const order=params.mixedListOrder||[];
        const items=[...params.mixedList].sort((a,b)=>order.length?order.indexOf(a.nodeId)-order.indexOf(b.nodeId):0);
        items.forEach((r,i)=>references.push({type:r.mediaType||byId.get(r.nodeId)?.type||'image',index:i+1,marker:`Mixed ${i+1}`,name:textOf(r.label||r.name)||'未命名参考',nodeId:r.nodeId}));
      } else for (const [type, items] of [['image', params.imageList], ['video', params.videoList], ['audio', params.audioList], ['text', params.textList]]) {
        (Array.isArray(items) ? items : []).forEach((r, i) => references.push({ type, index: i + 1, marker:`${type[0].toUpperCase()+type.slice(1)} ${i+1}`, name: textOf(r?.label || r?.name) || '未命名参考', nodeId: r?.nodeId }));
      }
      const s = params.settings || {};
      entries.push({ ...common, kind, prompt, promptSource: 'node-params', references, model: textOf(params.model),
        settings: { mode: params.modeType, ratio: s.ratio ?? params.ratio, resolution: s.resolution ?? s.quality ?? params.resolution,
          duration: s.duration ?? params.duration, count: params.count, enableSound: s.enableSound ?? params.enableSound } });
    } else skipped.push({ nodeId: node.id, name, reason: kind ? '生成节点当前提示词为空' : /_resource$/.test(d.action || '') ? '素材节点，无当前生成提示词' : '上传素材、分组或尚未适配的操作' });
  }
  for(const node of nodes) {
    if(!['image','video','audio'].includes(node.type)||entries.some(e=>e.nodeId===node.id))continue;
    const textIds=(snapshot.edges||[]).filter(e=>e.target===node.id&&byId.get(e.source)?.type==='text').map(e=>e.source);
    if(!textIds.some(id=>nodeText(byId.get(id)).trim()))continue;
    entries.push({nodeId:node.id,name:textOf(node.data.name||node.data.title)||'未命名',group:groupOf(node,byId),position:node.position||{},
      kind:node.type==='image'?classifyImage(node.data.params?.modeType):node.type,prompt:'',promptSource:'reference-text-only',settings:{},references:textIds.map((id,i)=>({index:i+1,nodeId:id,type:'text',name:textOf(byId.get(id).data.title||byId.get(id).data.name)||'独立文本'})),referenceTexts:[]});
  }
  for (const entry of entries) {
    if(entry.kind==='text')continue;
    const ids=new Set(entry.references.filter(r=>r.type==='text').map(r=>r.nodeId));
    for(const edge of snapshot.edges||[]) {
      if(edge.target===entry.nodeId && byId.get(edge.source)?.type==='text') ids.add(edge.source);
    }
    entry.referenceTexts=[...ids].map(id=>({nodeId:id,name:textOf(byId.get(id)?.data?.title||byId.get(id)?.data?.name)||'独立文本',text:nodeText(byId.get(id)||{}),relation:'当前画布引用／连线'})).filter(r=>r.text.trim());
  }
  entries.sort((a,b) => a.group.localeCompare(b.group, 'zh') || (a.position.y || 0) - (b.position.y || 0) || (a.position.x || 0) - (b.position.x || 0));
  if (snapshot.expectedNodes != null && nodes.length !== snapshot.expectedNodes) warnings.push(`页面声明 ${snapshot.expectedNodes} 个节点，实际读取 ${nodes.length} 个，完整性未通过。`);
  if (snapshot.expectedEdges != null && snapshot.edges.length !== snapshot.expectedEdges) warnings.push(`连线数与页面声明不一致。`);
  if (!metadata.author) warnings.push('未自动读到作者，请手动填写后导出。');
  if (!metadata.title) warnings.push('未自动读到作品名，请手动填写后导出。');
  if (entries.some(e => e.kind === 'image_unknown')) warnings.push('部分图片生成模式未确认，仍归入图片提示词；保留读取到的原始参数。');
  const includedIds = new Set(entries.map(e => e.nodeId));
  for(let i=skipped.length-1;i>=0;i--)if(includedIds.has(skipped[i].nodeId))skipped.splice(i,1);
  const emptyGeneration = skipped.filter(e => /生成节点当前提示词为空|生成节点没有可读直接提示词或关联文本/.test(e.reason));
  if (emptyGeneration.length) warnings.push(`${emptyGeneration.length} 个生成节点没有可读的当前提示词，未计入导出条数。`);
  warnings.push('本实验版读取当前节点参数与关联文本，尚未验证每次历史生成的提示词。');
  return linkEntries({ schemaVersion: 2, metadata: { ...metadata, canvasTitle: snapshot.canvasTitle, canvasUrl: snapshot.frameUrl, extractedAt: new Date().toISOString() },
    diagnostics: { source: snapshot.source, nodeCount: nodes.length, edgeCount: snapshot.edges.length, expectedNodes: snapshot.expectedNodes,
      directEntryCount: entries.filter(e => e.prompt.trim()).length, referenceOnlyCount: entries.filter(e => e.promptSource === 'reference-text-only').length,
      counts: Object.fromEntries(Object.keys(TYPES).map(t => [t, entries.filter(e => e.kind === t).length])), skipped, warnings },
    entries, edges: snapshot.edges, assets:buildAssets(snapshot,metadata.platform) });
}
function safePart(value, fallback) {
  return (String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '') || fallback).slice(0, 70);
}
function filename(metadata, ext = 'md') {
  const title = String(metadata.title || '').replace(/^《(.*)》$/, '$1');
  return [safePart(metadata.platform, 'platform'), safePart(metadata.author, '未知作者'), safePart(title, '未命名作品')].join('_') + '.' + ext;
}
function filterResult(result, kinds) {
  const allowed = new Set(Object.keys(TYPES).filter(k => kinds.includes(k)||k.startsWith('image_')&&kinds.includes('image')));
  const entries = result.entries.filter(e => allowed.has(e.kind));
  const ids = new Set(entries.flatMap(e => [e.nodeId, ...e.references.map(r => r.nodeId).filter(Boolean)]));
  const { nodes, edges, ...rest } = result;
  const assetIds=new Set(entries.flatMap(e=>[...(e.outputAssetIds||[]),...e.references.flatMap(r=>r.assetIds||[])]));
  return { ...rest, selection: [...allowed], entries, assets:(result.assets||[]).filter(a=>assetIds.has(a.id)), edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
}
function fence(value) { let marker = '```'; while (value.includes(marker)) marker += '`'; return marker + 'text\n' + value + '\n' + marker; }
function markdown(result) {
  const m = result.metadata;
  const texts=new Map();
  const assets=new Map((result.assets||[]).map(a=>[a.id,a]));
  const link=id=>{const a=assets.get(id);return a ? `[${a.name}](${encodeURIComponent(a.fileName)})${a.state==='done'?'':'（未下载）'}` : '';};
  const lines = [`# ${m.title || '未命名作品'}`, '', `- 平台：${m.platform}`, `- 作者：${m.author || '未知作者'}`, `- 作品：${m.resolvedUrl || m.inputUrl}`,
    `- 画布：${m.canvasUrl}`, `- 画布名称：${m.canvasTitle}`, `- 导出时间：${m.extractedAt}`, `- 本次选中 ${result.entries.length} 条内容`, '', '## 提取说明', '',
    ...result.diagnostics.warnings.map(w => '- ' + w), ''];
  for (const [kind,label] of Object.entries(PROMPT_TYPES)) {
    const items = result.entries.filter(e => promptKind(e.kind) === kind); if (!items.length) continue;
    lines.push(`## ${label}`, '');
    items.forEach((entry,i) => {
      lines.push(`### ${i+1}. ${entry.name}`, '', `- 节点：${entry.nodeId}`, `- 分组：${entry.group}`, `- 来源：${({'text-node':'独立文本','node-params':'节点直接输入','generation-draft':'节点直接输入','reference-text-only':'仅关联文本'})[entry.promptSource]||entry.promptSource}`);
      for(const id of entry.outputAssetIds||[])if(link(id))lines.push('- 生成／节点素材：'+link(id));
      if (entry.model) lines.push(`- 模型：${entry.model}`);
      for (const [key,value] of Object.entries(entry.settings || {})) if (value != null && value !== '') lines.push(`- ${key}：${value}`);
      entry.references.forEach(r => lines.push(`- 参考 ${r.marker||r.index}：${r.name}${r.nodeId ? `（${r.nodeId}）` : ''}${r.assetIds?.length?'；文件：'+r.assetIds.map(link).filter(Boolean).join('、'):''}`));
      lines.push('');
      if (entry.prompt.trim()) lines.push(fence(entry.prompt), '');
      else lines.push('当前节点没有直接输入文本；下方为其关联的文本节点。', '');
      entry.referenceTexts.forEach(r => {
        if(!texts.has(r.nodeId))texts.set(r.nodeId,r);
        lines.push(`- 关联文本：[${r.name}](#关联文本-${r.nodeId})（当前引用／连线关系）`,'');
      });
    });
  }
  if(texts.size){lines.push('## 关联文本（去重收录）','');for(const r of texts.values()){
    if(result.entries.some(e=>e.kind==='text'&&e.nodeId===r.nodeId)) {lines.push(`<a id="关联文本-${r.nodeId}"></a>`,`关联文本「${r.name}」见上方独立文本分类。`,'');continue;}
    lines.push(`<a id="关联文本-${r.nodeId}"></a>`,`### ${r.name}`,'',fence(r.text),'');
  }}
  return lines.join('\n');
}
module.exports = { TYPES, normalize, filename, markdown, filterResult, cleanRichText, classifyImage };
