'use strict';
const COLOR_TAGS = [
  { id: 'excluded', name: '已排除', color: '#000000' },
  { id: 'none', name: '无标签', color: 'var(--tag-none)' },
  { id: 'red', name: '红色', color: '#fd6460' },
  { id: 'yellow', name: '黄色', color: '#f2d051' },
  { id: 'green', name: '绿色', color: '#6fc958' },
  { id: 'blue', name: '蓝色', color: '#52b7f4' },
  { id: 'purple', name: '紫色', color: '#d08ce0' }
];
const validColorTag = (value) => COLOR_TAGS.some((tag) => tag.id === value);
function matchesColorTags(color, selected, excludedOnly = false) {
  if (excludedOnly) return color === 'excluded';
  return color !== 'excluded' && (!selected.size || selected.has(color));
}
function workKey(metadata, item) {
  let url;
  try {
    url = new URL(metadata.inputUrl || metadata.resolvedUrl || metadata.canvasUrl);
  } catch {}
  const id =
    item.workId ||
    metadata.workId ||
    (metadata.platform === 'liblib' && url?.pathname.match(/^\/detail\/([^/]+)/)?.[1]) ||
    (metadata.platform === 'neowow' && url?.searchParams.get('id')) ||
    metadata.workIdentity?.replace(/^(?:work|liblib-template):/, '');
  return [
    metadata.platform,
    id || (url ? url.origin + url.pathname + url.search : metadata.inputUrl)
  ];
}
function mediaKey(asset) {
  let address = asset.url || asset.previewUrl;
  try {
    const url = new URL(address);
    for (const key of [...url.searchParams.keys()])
      if (/^(x-oss-.+|x-amz-.+|signature|expires|ossaccesskeyid|token)$/i.test(key))
        url.searchParams.delete(key);
    url.searchParams.sort();
    address = url.href;
  } catch {}
  return [asset.kind, asset.role || 'node', address || asset.fileName || asset.id];
}
function createColorTagIndex(result) {
  const entries = result?.entries || [],
    assets = result?.assets || [];
  const owners = new Map(),
    keys = new WeakMap(),
    byKey = new Map();
  const parents = new Map(entries.map((entry) => [entry, entry]));
  function root(entry) {
    let owner = entry;
    while (parents.get(owner) !== owner) owner = parents.get(owner);
    while (parents.get(entry) !== owner) {
      const next = parents.get(entry);
      parents.set(entry, owner);
      entry = next;
    }
    return owner;
  }
  // Shared generated outputs form one tag group; input references stay independent.
  for (const entry of entries)
    for (const id of entry.outputAssetIds || []) {
      if (!owners.has(id)) owners.set(id, entry);
      else {
        const a = root(owners.get(id)),
          b = root(entry);
        if (a !== b) parents.set(a.nodeId < b.nodeId ? b : a, a.nodeId < b.nodeId ? a : b);
      }
    }
  for (const [id, owner] of owners) owners.set(id, root(owner));
  const entriesById = new Map(entries.map((entry) => [entry.nodeId, entry]));
  for (const item of [...entries, ...assets]) {
    const isEntry = entriesById.get(item.nodeId) === item;
    const owner = isEntry
      ? root(item)
      : owners.get(item.id) ||
        (item.nodeIds?.length === 1 && entriesById.has(item.nodeIds[0])
          ? root(entriesById.get(item.nodeIds[0]))
          : null);
    const node = owner?.nodeId || (item.nodeIds?.length === 1 ? item.nodeIds[0] : '');
    const subject = owner || item;
    const prefix = workKey(result.metadata, subject);
    const rawNode =
      node && subject.workId && node.startsWith(subject.workId + '::')
        ? node.slice(subject.workId.length + 2)
        : node;
    const key = JSON.stringify([
      ...prefix,
      node ? 'node' : 'asset',
      node ? rawNode : mediaKey(item)
    ]);
    keys.set(item, key);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  return {
    result,
    entries,
    assets,
    byKey,
    key: (item) => keys.get(item),
    color: (item) => (validColorTag(item?.colorTag) ? item.colorTag : 'none'),
    set(key, color) {
      if (!validColorTag(color)) throw new Error('标签颜色无效。');
      for (const item of byKey.get(key) || []) item.colorTag = color;
    }
  };
}
function inheritColorTags(result, previous) {
  if (!previous) return;
  const old = createColorTagIndex(previous),
    next = createColorTagIndex(result);
  for (const [key, items] of next.byKey) {
    const current = items.find((item) => validColorTag(item.colorTag));
    const saved = old.byKey.get(key)?.find((item) => validColorTag(item.colorTag));
    if (current || saved) next.set(key, (current || saved).colorTag);
  }
}
module.exports = {
  COLOR_TAGS,
  validColorTag,
  matchesColorTags,
  createColorTagIndex,
  inheritColorTags
};
