'use strict';
const { mediaUrls } = require('./media.cjs');
const { parameterReferences } = require('./references.cjs');
function describeAsset(node) {
  const d = node.data || {};
  return {
    name: d.name || d.label || d.fileName,
    source:
      d.type === 'upload' || d.mediaSource === 'upload'
        ? 'uploaded'
        : d.type === 'generation' || d.type === 'generated' || d.sourceNodeId
          ? 'generated'
          : 'unknown',
    width: d.width,
    height: d.height,
    duration: d.result?.duration || d.duration,
    ratio: d.aspectRatio || ''
  };
}
function collectAssets(snapshot, { add }) {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  for (const node of snapshot.nodes)
    for (const [i, url] of mediaUrls(node).entries()) add(node, { url }, i);
  for (const node of snapshot.nodes) {
    if (!['generation', 'composition'].includes(node.data?.type)) continue;
    for (const ref of parameterReferences(node, byId)) {
      if (!ref.url || !['image', 'video', 'audio'].includes(ref.type)) continue;
      const source = byId.get(ref.nodeId);
      // Existing node assets already have their canonical URL and identity.
      if (source) continue;
      add(
        { id: ref.nodeId, type: ref.type, data: { name: ref.name } },
        { kind: ref.type, url: ref.url },
        0,
        'reference'
      );
    }
  }
}
module.exports = { collectAssets, describeAsset, preview: () => '' };
