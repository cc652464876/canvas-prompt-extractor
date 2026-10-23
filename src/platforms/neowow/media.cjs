'use strict';
const { safeUrl } = require('../../assets.cjs');
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
function mediaUrls(node) {
  if (!['image', 'video', 'audio'].includes(node.type)) return [];
  const d = node.data || {},
    type = node.type;
  // NeoWow stores the node's current output in input<Type>Urls. Generation
  // references are stored separately in connected<Type>Urls/manualReferences.
  const current = list(d['input' + type[0].toUpperCase() + type.slice(1) + 'Urls']).flat();
  const values = current.length
    ? current
    : [
        d.mediaUrl,
        d[type + 'Url'],
        d['input' + type[0].toUpperCase() + type.slice(1) + 'Url'],
        ...list(d.result).flatMap((r) =>
          typeof r === 'string'
            ? r
            : [r?.[type + 'Url'], r?.url, r?.originalUrl, ...list(r?.urls), ...list(r?.images)]
        )
      ];
  return [
    ...new Set(values.map((v) => safeUrl(typeof v === 'string' ? v : v?.url)).filter(Boolean))
  ];
}
function identity(value) {
  const url = safeUrl(value);
  if (!url) return '';
  const u = new URL(url);
  const host = ['neoai-online.neodomain.cn', 'wlpaas.oss-accelerate.aliyuncs.com'].includes(
    u.hostname
  )
    ? 'neowow-media'
    : u.origin;
  return host + u.pathname;
}
module.exports = { list, mediaUrls, identity };
