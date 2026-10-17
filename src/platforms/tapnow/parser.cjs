'use strict';
const { readText } = require('../../text-content.cjs');
const { parameterReferences } = require('./references.cjs');
function parseGeneration(node, { byId }) {
  const d = node.data || {},
    p = d.params || {},
    generated = ['generate', 'edit', 'upscale'].includes(d.type),
    warnings = [];
  const references = generated ? parameterReferences(node, byId) : [];
  const kind = generated
    ? node.type === 'image'
      ? p.modelType === 'text_to_image'
        ? 'image_text'
        : p.modelType === 'image_to_image' ||
            references.some((r) => r.type === 'image') ||
            d.type === 'edit'
          ? 'image_reference'
          : 'image_unknown'
      : ['video', 'audio'].includes(node.type)
        ? node.type
        : null
    : null;
  const decoded = readText(generated ? (d.prompt ?? p.prompt) : '');
  if (['partial', 'unreadable'].includes(decoded.textState))
    warnings.push(`${d.name || d.title || '节点'}：提示词包含未解析格式。`);
  return {
    kind,
    prompt: decoded.text,
    references,
    explicit: references.filter((r) => r.type === 'text'),
    warnings,
    model: readText(p.model).text,
    promptSource: d.prompt != null ? 'tapnow-node-prompt' : 'tapnow-node-params',
    settings: {
      mode: p.modelType || p.variant || d.editSubType || d.type,
      ratio: p.aspectRatio,
      resolution: p.resolution,
      duration: p.duration,
      count: p.times,
      enableSound: p.generateAudio
    },
    extra: { rawParams: p, operation: d.type }
  };
}
module.exports = { parseGeneration };
