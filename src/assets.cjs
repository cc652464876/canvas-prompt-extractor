'use strict';
const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const path = require('node:path');
const LABELS = { image: '图片', video: '视频', audio: '音频' };
const SOURCES = {
  uploaded: '上传参考',
  generated: '生成结果',
  published: '完整作品',
  unknown: '来源未确认'
};
const EXTENSIONS = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']
};
function safeUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      isIP(u.hostname.replace(/^\[|\]$/g, '')) ||
      /(^localhost$|\.local$|\.localhost$)/i.test(u.hostname)
    )
      return '';
    return u.href;
  } catch {
    return '';
  }
}
function list(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
function shortName(value) {
  return (
    String(value || '未命名')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 42) || '未命名'
  );
}
function extension(url, kind) {
  let ext = '';
  try {
    ext = path.posix.extname(new URL(url).pathname).toLowerCase();
  } catch {}
  return EXTENSIONS[kind].includes(ext)
    ? ext
    : kind === 'image'
      ? '.png'
      : kind === 'video'
        ? '.mp4'
        : '.mp3';
}
function assetKey(platform, resourceId, url) {
  let identity = url;
  try {
    identity = new URL(url).origin + new URL(url).pathname;
  } catch {}
  return createHash('sha256')
    .update(platform + '|' + (resourceId || identity))
    .digest('hex')
    .slice(0, 24);
}
function previewUrls(variants, cover, poster) {
  const variantEntries = Object.entries(variants || {}).sort(([a], [b]) => {
    const score = (key) =>
      key === '360:360' ? -1 : Math.abs(Math.max(...key.split(':').map(Number)) - 360);
    return score(a) - score(b);
  });
  return [
    ...new Set(
      [variantEntries[0]?.[1], cover, ...variantEntries.slice(1).map(([, v]) => v), ...list(poster)]
        .map((v) => safeUrl(typeof v === 'string' ? v : v?.url))
        .filter(Boolean)
    )
  ];
}
function buildAssets(
  snapshot,
  platform,
  adapter = require('./platforms/registry.cjs').getAdapter(platform)
) {
  const assets = [],
    byKey = new Map(),
    counters = { image: 0, video: 0, audio: 0 };
  function add(node, item, index = 0, role = 'node') {
    const kind = item.kind || node.type;
    if (!LABELS[kind]) return;
    const url = safeUrl(item.url),
      resourceId = item.resourceId || '';
    const id = assetKey(platform, resourceId, url || node.id + ':' + index);
    if (byKey.has(id)) {
      const a = byKey.get(id);
      if (!a.nodeIds.includes(node.id)) a.nodeIds.push(node.id);
      return a;
    }
    const d = adapter.describeAsset(node),
      name = (role === 'full-video' ? '_完整视频_' : '') + shortName(item.name || d.name);
    const covers = [
      ...new Set(
        [
          item.previewUrl,
          ...(item.previewUrls || []),
          adapter.preview(url, kind),
          kind === 'image' ? url : ''
        ]
          .map(safeUrl)
          .filter(Boolean)
      )
    ];
    const source = role === 'full-video' ? 'published' : d.source;
    const dimensions = {
      width: item.width || d.width,
      height: item.height || d.height,
      duration: item.duration || d.duration
    };
    const a = {
      id,
      kind,
      name,
      nodeIds: [node.id],
      url,
      previewUrl: covers[0] || '',
      ...(covers.length ? { previewUrls: covers } : {}),
      resourceId,
      source,
      role,
      ...Object.fromEntries(
        Object.entries(dimensions)
          .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0)
          .map(([k, v]) => [k, Number(v)])
      ),
      ratio: d.ratio || '',
      fileName:
        role === 'full-video'
          ? `${name}${extension(url, kind)}`
          : `${LABELS[kind]}_${String(++counters[kind]).padStart(4, '0')}_${name}${extension(url, kind)}`,
      state: url ? 'pending' : 'unavailable',
      error: url ? '' : '平台尚未提供可下载地址',
      bytes: 0,
      total: 0
    };
    assets.push(a);
    byKey.set(id, a);
    return a;
  }
  const full = snapshot.fullVideo;
  if (full)
    add(
      { id: 'full-video:' + full.workId, type: 'video', data: { name: full.name } },
      { ...full, resourceId: 'full-video:' + full.workId },
      0,
      'full-video'
    );
  adapter.collectAssets(snapshot, { add, safeUrl, previewUrls, assetKey, LABELS }, platform);
  return assets;
}
function linkEntries(result) {
  const byNode = new Map();
  for (const a of result.assets)
    for (const id of a.nodeIds) {
      if (!byNode.has(id)) byNode.set(id, []);
      byNode.get(id).push(a.id);
    }
  for (const e of result.entries) {
    e.outputAssetIds = byNode.get(e.nodeId) || [];
    for (const ref of e.references) ref.assetIds = byNode.get(ref.nodeId) || [];
  }
  return result;
}
module.exports = {
  buildAssets,
  linkEntries,
  safeUrl,
  extension,
  shortName,
  LABELS,
  SOURCES,
  EXTENSIONS
};
