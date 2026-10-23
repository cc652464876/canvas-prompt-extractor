'use strict';
const metadata = require('./metadata.cjs');
function workKey(url) {
  if (!metadata.workHosts.includes(url.hostname)) return '';
  if (['/workflow', '/ai-workflow'].includes(url.pathname))
    return url.searchParams.get('sessionId') ? 'session:' + url.searchParams.get('sessionId') : '';
  if (url.pathname === '/workflows')
    return url.searchParams.get('shareCode') ? 'share:' + url.searchParams.get('shareCode') : '';
  if (url.pathname === '/video-works-view') {
    const id = url.searchParams.get('id');
    return id
      ? 'work:' + id
      : url.searchParams.get('sessionId')
        ? 'published:' + url.searchParams.get('sessionId')
        : '';
  }
  return '';
}
module.exports = {
  ...metadata,
  page: require('./reader.cjs'),
  profile: require('./profile.cjs'),
  inspectAccount: require('./account.cjs').inspectAccount,
  ...require('./parser.cjs'),
  ...require('./assets.cjs'),
  cleanText: (value) => value.replace(/\r\n/g, '\n'),
  textFields: ['content', 'text', 'result', 'prompt'],
  isResource: (node) =>
    ['image', 'video', 'audio'].includes(node.type) && node.data?.type !== 'generation',
  isWorkUrl: (url) => Boolean(workKey(url)),
  isCanvasUrl: (url) => Boolean(workKey(url)) && url.pathname !== '/video-works-view',
  validateWorkUrl: (value) => {
    if (!workKey(new URL(value)))
      throw Object.assign(
        new Error(
          '请粘贴 NeoWow 具体作品链接（/video-works-view?id=…）、画布链接（/workflow?sessionId=…）或画布分享链接（/workflows?shareCode=…）；首页和列表页不能作为单个画布读取。'
        ),
        { code: 'INVALID_WORK_URL' }
      );
  },
  leftWork: (url, requested) => Boolean(workKey(requested)) && workKey(url) !== workKey(requested)
};
