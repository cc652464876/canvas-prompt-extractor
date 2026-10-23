'use strict';
const { createHash } = require('node:crypto');
const { safeUrl } = require('../../assets.cjs');
const { readText } = require('../../text-content.cjs');
const { list, mediaUrls, identity } = require('./media.cjs');
const indexes = new WeakMap();
function mediaIndex(byId) {
  if (!indexes.has(byId)) {
    const index = new Map();
    for (const node of byId.values())
      for (const url of mediaUrls(node)) {
        const key = node.type + '|' + identity(url);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(node.id);
      }
    indexes.set(byId, index);
  }
  return indexes.get(byId);
}
function parameterReferences(node, byId) {
  const d = node.data || {},
    refs = [],
    index = mediaIndex(byId);
  for (const type of ['image', 'video', 'audio']) {
    const inputs = new Map();
    for (const raw of [
      ...list(d['connected' + type[0].toUpperCase() + type.slice(1) + 'Urls']),
      ...list(d.manualReferences).filter((r) => r?.type === type),
      ...list(d[type + 'Inputs'])
    ]) {
      const url = safeUrl(typeof raw === 'string' ? raw : raw?.url);
      if (url && !inputs.has(identity(url))) inputs.set(identity(url), { url, raw });
    }
    const order = list(d.referenceDisplayOrder?.[type]).map(identity);
    const keys = [...new Set([...order.filter((key) => inputs.has(key)), ...inputs.keys()])];
    for (const [i, key] of keys.entries()) {
      const { url, raw } = inputs.get(key);
      const mapEntry = Object.entries(d.connectedSourceMap || {}).find(
        ([u]) => identity(u) === key
      );
      const supplied = raw?.nodeId || raw?.sourceNodeId || mapEntry?.[1];
      const matches = (index.get(type + '|' + key) || []).filter((id) => id !== node.id);
      // A recorded source ID with a changed URL must not connect this input to
      // a different current output. Preserve the parameter URL as its own asset.
      const id =
        byId.has(supplied) && matches.includes(supplied)
          ? supplied
          : matches.length === 1
            ? matches[0]
            : 'ref:' +
              createHash('sha256')
                .update('neowow|' + type + '|' + key)
                .digest('hex')
                .slice(0, 24);
      refs.push({
        nodeId: id,
        url,
        type,
        index: i + 1,
        marker: `${type} ${i + 1}`,
        name:
          byId.get(id)?.data?.name || raw?.name || d.connectedNameMap?.[url] || '参数中的参考素材',
        evidence: ['parameter-reference'],
        referenceSource: 'neowow-current-references'
      });
    }
  }
  for (const [i, raw] of list(d.inputTexts).entries()) {
    const content = typeof raw === 'object' && raw ? (raw.content ?? raw.text) : raw;
    if (!readText(content).text.trim()) continue;
    const supplied = raw?.nodeId || raw?.sourceNodeId;
    // String snapshots carry no source ID. Do not invent a text-node match.
    refs.push({
      type: 'text',
      nodeId: byId.has(supplied) ? supplied : undefined,
      index: i + 1,
      content,
      name: raw?.name || `输入文本 ${i + 1}`,
      evidence: ['parameter-reference'],
      referenceSource: 'neowow-input-texts'
    });
  }
  return refs;
}
module.exports = { parameterReferences };
