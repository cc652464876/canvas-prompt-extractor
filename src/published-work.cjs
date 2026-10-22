'use strict';
const { normalize } = require('./normalize.cjs');
function publishedWork(metadata) {
  const result = normalize(
    {
      nodes: [],
      edges: [],
      mediaResources: {},
      source: 'published-work',
      fullVideo: metadata.fullVideo || {
        workId: metadata.workId || metadata.inputUrl,
        name: metadata.title,
        url: ''
      }
    },
    metadata
  );
  result.metadata.canvasAccess = 'not-public';
  result.metadata.canvasUrl = '';
  result.metadata.canvasNote = result.assets.some((a) => a.url)
    ? '画布未公开，仅可下载作品视频'
    : '画布未公开，作品视频暂不可下载';
  result.diagnostics.completeness = 'unverified';
  result.diagnostics.warnings = [result.metadata.canvasNote];
  return result;
}
module.exports = { publishedWork };
