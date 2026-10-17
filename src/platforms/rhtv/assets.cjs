'use strict';
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
function describeAsset(node) {
  const d = node.data || {};
  return {
    name: d.name || d.label || d.title,
    source:
      d.modelCode || d.params
        ? 'generated'
        : d.sourceNodeId
          ? 'unknown'
          : list(d.sourceObjects).length
            ? 'uploaded'
            : 'unknown',
    ratio: d.params?.aspectRatio || d.aspectRatio || '',
    // width/height on RHTV nodes describe their screen boxes, not the media.
    duration: undefined
  };
}
function collectAssets(snapshot, { add, safeUrl, assetKey }, platform) {
  const nodes = snapshot.nodes || [],
    byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (!['image', 'video', 'audio'].includes(node.type)) continue;
    const d = node.data || {},
      output = list(d.output).filter((o) => o && o.success !== false && (o.url || o.originalUrl));
    const covers = list(d.thumbnail)
      .map((v) => safeUrl(typeof v === 'string' ? v : v?.url))
      .filter(Boolean);
    const urls =
      d.modelCode || d.params
        ? output.map((o) => ({ ...o, url: o.url || o.originalUrl }))
        : [...list(d.sourceObjects), ...list(d[node.type + 'Url'])].map((v) =>
            typeof v === 'string' ? { url: v } : v
          );
    const seen = new Set();
    for (const [i, item] of urls.entries()) {
      const url = safeUrl(item?.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      add(node, { url, name: item.name || d.name, previewUrls: covers, previewUrl: covers[0] }, i);
    }
    // toolsSourceUrl/sourceVideo/videoUrl on tools are inputs. Never label
    // those as generated outputs when the operation failed or has no result.
  }
  for (const node of nodes) {
    const d = node.data || {},
      p = d.params || {};
    for (const kind of ['image', 'video', 'audio']) {
      const stem = kind[0].toUpperCase() + kind.slice(1);
      const refs = [
        ...list(d[kind + 'Order']),
        ...list(p[kind + 'Urls']),
        ...list(p[kind + 'Url']),
        ...Object.entries(p)
          .filter(([k]) => new RegExp(`^ref${stem}\\d+$`).test(k))
          .map(([, v]) => v)
      ];
      for (const raw of refs) {
        const value = typeof raw === 'string' ? raw : raw?.url || '',
          split = value.indexOf('::');
        const id = typeof raw === 'object' ? raw.nodeId : split >= 0 ? value.slice(0, split) : '';
        const url = safeUrl(split >= 0 ? value.slice(split + 2) : value);
        if (!url) continue;
        const source = byId.get(id) || {
          id: id || 'ref:' + assetKey(platform, '', url),
          type: kind,
          data: { name: '参数中的参考素材' }
        };
        add(source, { kind, url }, 0, 'reference');
      }
    }
  }
}
module.exports = { collectAssets, describeAsset, preview: () => '' };
