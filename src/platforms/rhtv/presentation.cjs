'use strict';
const types = { 图片: 'image', 图像: 'image', 视频: 'video', 音频: 'audio', 文本: 'text' };
module.exports = {
  pattern: '@(图片|图像|视频|音频|文本)\\s*(\\d+)',
  type: (text) => types[text],
  fallback(refs, type, index) {
    // Blank URL parameters use connected media, numbered within each media type.
    const typed = refs
      .filter((r) => r.type === type)
      .filter(
        (r, i, all) =>
          !all
            .slice(0, i)
            .some(
              (previous) =>
                r.nodeId &&
                previous.nodeId === r.nodeId &&
                (!r.url || !previous.url || r.url === previous.url)
            )
      );
    const ref = typed[index - 1];
    return ref && !ref.marker ? [ref] : [];
  }
};
