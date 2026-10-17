'use strict';
const { parameterReferences, list } = require('./references.cjs');
function describeAsset(node) {
  const d = node.data || {},
    m = d.__metadata || {};
  return {
    name: d.name || d.title,
    source:
      d.type === 'upload'
        ? 'uploaded'
        : d.type === 'generate' || d.type === 'upscale'
          ? 'generated'
          : 'unknown',
    ratio: d.params?.aspectRatio || '',
    width: m.width,
    height: m.height,
    duration: m.duration
  };
}
function collectAssets(snapshot, { add, safeUrl }) {
  const nodes = snapshot.nodes || [],
    byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (!['image', 'video', 'audio'].includes(node.type)) continue;
    const d = node.data || {};
    // src and options are the current node's outputs; historical queues and
    // parameter inputs must never be relabeled as outputs of this node.
    if (['failed', 'error', 'cancelled'].includes(d.taskInfo?.status) && d.type !== 'upload')
      continue;
    const seen = new Set();
    for (const [i, raw] of [d.src, ...list(d.options)].entries()) {
      const url = safeUrl(typeof raw === 'string' ? raw : raw?.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const m = d.__metadata?.url === url ? d.__metadata : {};
      add(node, { url, width: m.width, height: m.height, duration: m.duration }, i);
    }
  }
  for (const node of nodes) {
    if (!['generate', 'edit', 'upscale'].includes(node.data?.type)) continue;
    for (const ref of parameterReferences(node, byId)) {
      if (!ref.url || !['image', 'video', 'audio'].includes(ref.type)) continue;
      const source = byId.get(ref.nodeId) || {
        id: ref.nodeId,
        type: ref.type,
        data: { name: ref.name }
      };
      add(source, { kind: ref.type, url: ref.url }, 0, 'reference');
    }
  }
}
module.exports = { collectAssets, describeAsset, preview: () => '' };
