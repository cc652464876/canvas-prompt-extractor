'use strict';
const { readText } = require('../../text-content.cjs');
const { parameterReferences } = require('./references.cjs');
function parseGeneration(node, { byId }) {
  const d = node.data || {},
    generated = d.type === 'generation';
  const references = generated || d.type === 'composition' ? parameterReferences(node, byId) : [];
  const decoded = readText(
    generated ? (node.type === 'audio' ? d.seedAudioPrompt || d.prompt : d.prompt) : ''
  );
  const kind = !generated
    ? null
    : node.type === 'image'
      ? references.some((r) => r.type === 'image')
        ? 'image_reference'
        : /^TEXT_TO_IMAGE$/i.test(d.generationType || '')
          ? 'image_text'
          : 'image_unknown'
      : ['video', 'audio'].includes(node.type)
        ? node.type
        : null;
  const universal = node.type === 'video' && Boolean(d.universalModel);
  const warnings = ['partial', 'unreadable'].includes(decoded.textState)
    ? [`${d.name || '节点'}：提示词包含未解析格式。`]
    : [];
  return {
    kind,
    prompt: decoded.text,
    references,
    explicit: references.filter((r) => r.type === 'text'),
    warnings,
    model: readText(
      d.modelDisplayName || d.modelName || d.universalModel || d.voiceModel || d.model
    ).text,
    promptSource:
      node.type === 'audio' && d.seedAudioPrompt
        ? 'neowow-seed-audio-prompt'
        : 'neowow-node-prompt',
    settings: {
      mode: d.generationType || d.type,
      ratio: universal ? d.universalAspectRatio || d.aspectRatio : d.aspectRatio,
      resolution: universal ? d.universalResolution || d.resolution : d.resolution,
      duration: universal ? d.universalDuration || d.duration : d.duration,
      count: d.batchSize,
      seed: d.seed,
      negativePrompt: d.negativePrompt,
      enableSound: universal ? (d.universalEnableAudio ?? d.enableAudio) : d.enableAudio
    },
    extra: { operation: d.type, ...(d.seedAudioConfig ? { audioSettings: d.seedAudioConfig } : {}) }
  };
}
module.exports = { parseGeneration };
