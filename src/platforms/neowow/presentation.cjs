'use strict';
function fileLabels(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  let name = value.trim();
  try {
    if (/^https?:\/\//i.test(name)) name = new URL(name).pathname.split('/').at(-1);
    name = decodeURIComponent(name);
  } catch {
    return [];
  }
  return [
    name,
    name.replace(
      /\.(?:png|jpe?g|webp|gif|avif|bmp|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac|opus)$/i,
      ''
    )
  ];
}
module.exports = {
  pattern: '@\\[([^\\]\\r\\n]+)\\]',
  resolve(match, refs) {
    const label = match[4].trim();
    // NeoWow serializes a media filename stem, not its reference-list position.
    // Match only this entry's established references; never search other nodes
    // or infer a source from a similar name or a prompt mention alone.
    const exact = refs.filter((ref) =>
      [ref.nodeId, ...fileLabels(ref.url), ...fileLabels(ref.name)].includes(label)
    );
    if (exact.length) return exact;
    const numbered = /^(图|图片|图像|视频|音频|文本)\s*(\d+)$/.exec(label);
    if (!numbered) return [];
    const type = {
      图: 'image',
      图片: 'image',
      图像: 'image',
      视频: 'video',
      音频: 'audio',
      文本: 'text'
    }[numbered[1]];
    return refs.filter(
      (ref) => ref.type === type && ref.marker?.toLowerCase() === type + ' ' + Number(numbered[2])
    );
  }
};
