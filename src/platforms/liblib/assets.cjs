'use strict';
function libtvPreview(url, kind) {
  if (!url || !['image', 'video'].includes(kind)) return '';
  const u = new URL(url);
  // Use the exact CDN processing route observed in LibTV's canvas and asset list.
  if (u.hostname !== 'libtv-res.liblib.art') return '';
  u.searchParams.set(
    'x-oss-process',
    kind === 'video'
      ? 'video/snapshot,t_0,f_jpg,w_400,m_fast,ar_auto'
      : 'image/resize,w_400,m_lfit/format,webp/ignore-error,1'
  );
  return u.href;
}
function collectAssets(snapshot, { add, safeUrl, previewUrls, assetKey, LABELS }, platform) {
  const byId = new Map((snapshot.nodes || []).map((n) => [n.id, n]));
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  for (const node of snapshot.nodes || []) {
    if (!LABELS[node.type]) continue;
    const d = node.data || {},
      resource = (snapshot.mediaResources || {})[d.resourceId];
    if (resource) {
      const urls = resource.urls || {},
        variants = node.type === 'image' ? urls.resolution_source : urls.cover_resolution_source;
      const covers = previewUrls(variants, urls.cover_url, d.poster);
      add(node, {
        url: urls.download_url || urls.url,
        previewUrl: covers[0],
        previewUrls: covers,
        resourceId: d.resourceId,
        width: resource.width,
        height: resource.height,
        duration: resource.duration
      });
    } else {
      const urls = list(d.url);
      if (urls.length)
        urls.forEach((url, i) => {
          const covers = previewUrls(null, null, list(d.poster)[i] || list(d.poster)[0]);
          add(
            node,
            {
              url: typeof url === 'string' ? url : url?.url,
              previewUrl: covers[0],
              previewUrls: covers
            },
            i
          );
        });
    }
  }
  // LibTV reference lists can contain resources not represented by a current canvas node.
  for (const node of snapshot.nodes || [])
    for (const kind of ['image', 'video', 'audio']) {
      for (const item of list(node.data?.params?.[kind + 'List'])) {
        if (!safeUrl(item.url)) continue;
        const refNode = byId.get(item.nodeId) || {
          id: item.nodeId || 'ref:' + assetKey(platform, '', item.url),
          type: kind,
          data: { name: item.label || item.name }
        };
        add(refNode, { kind, url: item.url, name: item.label || item.name }, 0, 'reference');
      }
    }
}
function describeAsset(node) {
  const d = node.data || {};
  return {
    name: d.name || d.title,
    source:
      d.source === 'uploaded' || d.uploaded === true
        ? 'uploaded'
        : d.source === 'model_generated' || /_generate$/.test(d.action || '')
          ? 'generated'
          : 'unknown',
    width: d.width || d.resourceMeta?.width,
    height: d.height || d.resourceMeta?.height,
    duration: d.resourceMeta?.duration,
    ratio: d.ratio || d.params?.settings?.ratio || d.params?.ratio || ''
  };
}
module.exports = { collectAssets, describeAsset, preview: libtvPreview };
