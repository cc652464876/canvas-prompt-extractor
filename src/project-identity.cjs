'use strict';
const { createHash } = require('node:crypto');
function projectKey(metadata) {
  const url = new URL(metadata.inputUrl || metadata.resolvedUrl || metadata.canvasUrl);
  const detail = metadata.platform === 'liblib' && url.pathname.match(/^\/detail\/([^/]+)/);
  const id =
    metadata.workId ||
    detail?.[1] ||
    (metadata.platform === 'neowow' && url.searchParams.get('id'));
  const identity = id
    ? (metadata.platform === 'liblib' ? 'liblib-template:' : 'work:') + id
    : metadata.workIdentity || url.pathname + url.search;
  return metadata.platform + '|' + identity;
}
function assetIdentity(asset) {
  let url = asset.url || '';
  try {
    const parsed = new URL(url);
    // Signed links can expire without the underlying media changing. Keep
    // transformation parameters: they can select different actual content.
    for (const key of [...parsed.searchParams.keys()])
      if (
        /^(x-oss-(signature|credential|date|expires|security-token|algorithm)|signature|expires|ossaccesskeyid|token|x-amz-.+)$/i.test(
          key
        )
      )
        parsed.searchParams.delete(key);
    parsed.searchParams.sort();
    url = parsed.href;
  } catch {}
  return [asset.kind, asset.role || 'node', url].join('|');
}
function contentFingerprint(result) {
  const sorted = (items) =>
    items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const value = {
    access: result.metadata.canvasAccess || 'public',
    entries: sorted(
      (result.entries || []).map((e) => ({
        nodeId: e.nodeId,
        kind: e.kind,
        name: e.name,
        prompt: e.prompt,
        settings: e.settings,
        model: e.model,
        references: e.references,
        referenceTexts: e.referenceTexts
      }))
    ),
    nodes: sorted(
      (result.nodeSummaries || []).map((n) => ({ nodeId: n.nodeId, type: n.type, name: n.name }))
    ),
    edges: sorted((result.edges || []).map((e) => ({ source: e.source, target: e.target }))),
    assets: sorted((result.assets || []).map((a) => [assetIdentity(a), a.nodeIds]))
  };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
module.exports = { projectKey, assetIdentity, contentFingerprint };
