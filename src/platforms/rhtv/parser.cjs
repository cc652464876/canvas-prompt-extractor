'use strict';
const { readText } = require('../../text-content.cjs');
const { createHash } = require('node:crypto');
const { safeUrl } = require('../../assets.cjs');
const textOf = (value) => readText(value).text;
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
function parseGeneration(node, { byId, nameOf }) {
  const d = node.data || {},
    p = d.params || {},
    references = [],
    explicit = [],
    warnings = [];
  const hasGeneration = Boolean(d.modelCode || d.params);
  const kind = hasGeneration
    ? node.type === 'image'
      ? d.subType === 'text-image'
        ? 'image_text'
        : d.subType === 'image-image'
          ? 'image_reference'
          : 'image_unknown'
      : ['video', 'audio'].includes(node.type)
        ? node.type
        : null
    : null;
  const promptValue = p.prompt ?? d.prompt ?? d.clipReshootFreeText ?? d.directorPrompt;
  const decoded = readText(promptValue);
  if (decoded.textState === 'partial' || decoded.textState === 'unreadable')
    warnings.push(`${d.name || '节点'}：提示词包含未解析格式。`);
  const addReference = (value, type, index, source) => {
    const raw = typeof value === 'string' ? value : value?.url || '';
    const split = raw.indexOf('::');
    let id =
      typeof value === 'object'
        ? value?.nodeId || value?.sourceNodeId
        : split >= 0
          ? raw.slice(0, split)
          : byId.has(raw)
            ? raw
            : '';
    const url = safeUrl(split >= 0 ? raw.slice(split + 2) : raw);
    if (!id && url) {
      const matches = [...byId.values()].filter(
        (n) =>
          n.id !== node.id &&
          n.type === type &&
          [
            ...list(n.data?.sourceObjects),
            ...list(n.data?.output),
            ...list(n.data?.[type + 'Url'])
          ].some((v) => (typeof v === 'string' ? v : v?.url || v?.originalUrl) === url)
      );
      if (matches.length === 1) id = matches[0].id;
      else {
        const u = new URL(url);
        id =
          'ref:' +
          createHash('sha256')
            .update('rhtv|' + u.origin + u.pathname)
            .digest('hex')
            .slice(0, 24);
      }
    }
    const target = byId.get(id);
    if (!id && !url) {
      if (
        type === 'text' &&
        value &&
        typeof value === 'object' &&
        (value.content != null || value.text != null)
      )
        explicit.push(value);
      return;
    }
    if (references.some((r) => (id ? r.nodeId === id && r.url === url : r.url === url))) return;
    references.push({
      nodeId: id || undefined,
      url: url || undefined,
      type: target?.type || type,
      index,
      marker: `${type} ${index}`,
      name: target ? nameOf(id) : textOf(value?.label || value?.name) || '参数中的参考素材',
      evidence: ['parameter-reference'],
      referenceSource: source
    });
    if (type === 'text')
      explicit.push(typeof value === 'object' ? { ...value, nodeId: id } : { nodeId: id });
  };
  for (const type of ['image', 'video', 'audio', 'text']) {
    for (const [i, value] of list(d[type + 'Order']).entries())
      addReference(value, type, i + 1, 'node-order');
    for (const [i, value] of list(p[type + 'Urls']).entries())
      addReference(value, type, i + 1, 'parameter-url');
    for (const [i, value] of list(p[type + 'List']).entries())
      addReference(value, type, i + 1, 'parameter-list');
    const stem = type[0].toUpperCase() + type.slice(1);
    for (const key of Object.keys(p)
      .filter((k) => new RegExp(`^ref${stem}\\d+$`).test(k))
      .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0])))
      addReference(p[key], type, Number(key.match(/\d+$/)[0]), key);
    if (p[type + 'Url']) addReference(p[type + 'Url'], type, 1, 'parameter-url');
  }
  if (d.sourceNodeId && byId.has(d.sourceNodeId))
    addReference(
      d.sourceNodeId,
      byId.get(d.sourceNodeId).type,
      references.length + 1,
      'source-node'
    );
  return {
    kind,
    prompt: decoded.text,
    references,
    explicit,
    warnings,
    model: textOf(d.modelCode || p.modelCode || p.model),
    promptSource: p.prompt != null ? 'rhtv-node-params' : 'rhtv-node-prompt',
    settings: {
      mode: d.subType || d.toolsType,
      ratio: p.aspectRatio ?? p.ratio ?? d.aspectRatio,
      resolution: p.resolution ?? p.quality,
      duration: p.duration,
      count: d.generateNum,
      enableSound: p.generateAudio,
      audioMode: p.audioMode
    },
    extra: {
      rawParams: p,
      operation: d.toolsType || d.subType,
      clipReshootClips: d.clipReshootClips
    }
  };
}
module.exports = { parseGeneration };
