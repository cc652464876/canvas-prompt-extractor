'use strict';
function collectAssets(snapshot, { add, safeUrl, previewUrls, assetKey, LABELS }, platform) {
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
      else if (d.resourceId) add(node, { resourceId: d.resourceId });
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
module.exports = { collectAssets, describeAsset, preview: () => '' };
