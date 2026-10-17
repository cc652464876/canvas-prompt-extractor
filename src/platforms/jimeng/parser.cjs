'use strict';
const { readText } = require('../../text-content.cjs');
const { classifyImage } = require('../../core/content-types.cjs');
const textOf = (value) => readText(value).text;
function parseGeneration(node, { byId, nameOf }) {
  const d = node.data || {},
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
  }
  return { kind, prompt, references, settings, model, promptSource, extra, explicit, warnings };
}
module.exports = { parseGeneration };
