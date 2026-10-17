'use strict';
const { safeUrl } = require('../../assets.cjs');
const { createHash } = require('node:crypto');
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const identity = (value) => {
  const url = safeUrl(value);
  return url ? new URL(url).origin + new URL(url).pathname : '';
};
function parameterReferences(node, byId) {
  const p = node.data?.params || {},
    result = [];
  for (const type of ['image', 'video', 'audio', 'text']) {
    for (const [i, raw] of list(p[type + 's']).entries()) {
      const url = safeUrl(typeof raw === 'string' ? raw : raw?.url || raw?.src);
      const supplied = typeof raw === 'object' ? raw?.nodeId : byId.has(raw) ? raw : '';
      const matches = url
        ? [...byId.values()].filter(
            (n) =>
              n.id !== node.id &&
              n.type === type &&
              [n.data?.src, ...list(n.data?.options)].some(
                (v) => identity(typeof v === 'string' ? v : v?.url) === identity(url)
              )
          )
        : [];
      const id = byId.has(supplied)
        ? supplied
        : matches.length === 1
          ? matches[0].id
          : url
            ? 'ref:' +
              createHash('sha256')
                .update('tapnow|' + identity(url))
                .digest('hex')
                .slice(0, 24)
            : '';
      if (!id && !url && type !== 'text') continue;
      result.push({
        nodeId: id || undefined,
        url: url || undefined,
        type,
        index: i + 1,
        marker: `${type} ${i + 1}`,
        name: byId.get(id)?.data?.name || byId.get(id)?.data?.title || '参数中的参考素材',
        evidence: ['parameter-reference'],
        referenceSource: 'tapnow-params-' + type + 's',
        ...(type === 'text' && raw && typeof raw === 'object'
          ? { content: raw.content ?? raw.text }
          : {})
      });
    }
  }
  return result;
}
module.exports = { parameterReferences, list };
