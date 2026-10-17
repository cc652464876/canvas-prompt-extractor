'use strict';
const metadata = require('./metadata.cjs');
const workPath = /^\/(?:canvas\/[^/]+|home\/taptv\/[^/]+\/[^/]+)\/?$/;
module.exports = {
  ...metadata,
  page: require('./reader.cjs'),
  inspectAccount: require('./account.cjs').inspectAccount,
  ...require('./parser.cjs'),
  ...require('./assets.cjs'),
  cleanText: (value) => value.replace(/\r\n/g, '\n'),
  textFields: ['content', 'text', 'prompt'],
  isResource: (node) =>
    ['image', 'video', 'audio'].includes(node.type) && node.data?.type === 'upload',
  isCanvasUrl: (url) =>
    metadata.workHosts.includes(url.hostname) && /^\/canvas\/[^/]+\/?$/.test(url.pathname),
  validateWorkUrl: (value) => {
    if (!workPath.test(new URL(value).pathname))
      throw Object.assign(
        new Error(
          '请粘贴 TapTV 的具体作品详情链接或 TapNow /canvas/ 画布链接；列表页不能作为单个画布读取。'
        ),
        { code: 'INVALID_WORK_URL' }
      );
  },
  leftWork: (url, requested) =>
    metadata.workHosts.includes(url.hostname) &&
    workPath.test(requested.pathname) &&
    url.pathname.replace(/\/$/, '') !== requested.pathname.replace(/\/$/, '')
};
