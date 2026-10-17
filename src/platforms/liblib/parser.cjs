'use strict';
const { readText } = require('../../text-content.cjs');
const { classifyImage } = require('../../core/content-types.cjs');
const textOf = (value) => readText(value).text;
function parseGeneration(node, { byId, nameOf }) {
  const d = node.data || {},
    params = d.params || {},
    draft = d.generationDraft,
    nodeName = textOf(d.name || d.title) || '未命名';
  let kind = null,
    prompt = '',
    references = [],
    settings = {},
    model = '',
    promptSource = '',
    extra = {},
    explicit = [];
  const warnings = [];
  if (draft) {
    // Jimeng uses canonical draft parts and slot/sourceInstanceId references.
    references = (draft.references || []).map((r, i) => {
      const id = r.nodeId || r.sourceInstanceId,
        target = byId.get(id);
      return {
        index: i + 1,
        slotId: r.slotId,
        nodeId: id,
        type: target?.type || r.type,
        name: target ? nameOf(id) : textOf(r.name) || '未命名参考',
        role: r.role,
        evidence: ['parameter-reference']
      };
    });
    explicit = (draft.references || []).filter((r, i) => references[i].type === 'text');
    const partWarnings = [];
    prompt = (draft.parts || [])
      .map((part) => {
        if (part.type === 'text') return textOf(part.text);
        if (part.type === 'extension') {
          const ref = references.find(
            (r) => r.slotId === part.object_id || r.nodeId === part.object_id
          );
          if (!ref) partWarnings.push(`无法匹配参考标记 ${part.object_id}`);
          return ref
            ? `【参考：${ref.name}；节点 ${ref.nodeId}】`
            : `【未解析参考：${part.object_id || part.type}】`;
        }
        partWarnings.push(`不支持的富文本片段：${part.type}`);
        return `【未解析片段：${part.type}】`;
      })
      .join('');
    settings = { ...(draft.contentSettings || {}), outputCount: draft.outputCount };
    kind =
      draft.kind === 'image'
        ? classifyImage(settings.mode)
        : ['video', 'audio'].includes(draft.kind)
          ? draft.kind
          : null;
    model = settings.modelName || '';
    promptSource = 'generation-draft';
    extra = { rawParts: draft.parts || [], warnings: partWarnings, resourceId: d.resourceId };
    warnings.push(...partWarnings.map((w) => `${nodeName}：${w}`));
  } else {
    const actions = {
      video_generate: 'video',
      image_generate: classifyImage(params.modeType),
      audio_generate: 'audio'
    };
    kind = Object.hasOwn(actions, d.action) ? actions[d.action] : null;
    prompt = textOf(params.prompt);
    promptSource = 'node-params';
    model = textOf(params.model);
    const s = params.settings || {};
    settings = {
      mode: params.modeType,
      ratio: s.ratio ?? params.ratio,
      resolution: s.resolution ?? s.quality ?? params.resolution,
      duration: s.duration ?? params.duration,
      count: params.count,
      enableSound: s.enableSound ?? params.enableSound
    };
    if (Array.isArray(params.mixedList) && params.mixedList.length) {
      const order = params.mixedListOrder || [],
        rank = (id) => {
          const n = order.indexOf(id);
          return n < 0 ? Number.MAX_SAFE_INTEGER : n;
        };
      references = [...params.mixedList]
        .sort((a, b) => rank(a.nodeId) - rank(b.nodeId))
        .map((r, i) => ({
          type: r.mediaType || byId.get(r.nodeId)?.type || 'image',
          index: i + 1,
          marker: `Mixed ${i + 1}`,
          name: textOf(r.label || r.name) || (byId.has(r.nodeId) ? nameOf(r.nodeId) : '未命名参考'),
          nodeId: r.nodeId,
          evidence: ['parameter-reference']
        }));
    } else
      for (const type of ['image', 'video', 'audio'])
        for (const [i, r] of (Array.isArray(params[type + 'List'])
          ? params[type + 'List']
          : []
        ).entries())
          references.push({
            type,
            index: i + 1,
            marker: `${type[0].toUpperCase() + type.slice(1)} ${i + 1}`,
            name:
              textOf(r?.label || r?.name) ||
              (byId.has(r?.nodeId) ? nameOf(r.nodeId) : '未命名参考'),
            nodeId: r?.nodeId,
            evidence: ['parameter-reference']
          });
    // Text references coexist with mixed media and an empty direct prompt.
    explicit = Array.isArray(params.textList) ? params.textList : [];
    for (const [i, r] of explicit.entries())
      if (!references.some((ref) => ref.nodeId && ref.nodeId === r.nodeId && ref.type === 'text'))
        references.push({
          type: 'text',
          index: i + 1,
          marker: `Text ${i + 1}`,
          name: byId.has(r.nodeId) ? nameOf(r.nodeId) : textOf(r.label || r.name) || '参数中的文本',
          nodeId: r.nodeId,
          evidence: ['parameter-reference']
        });
  }
  return { kind, prompt, references, settings, model, promptSource, extra, explicit, warnings };
}
module.exports = { parseGeneration };
