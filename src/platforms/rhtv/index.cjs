'use strict';
const metadata = require('./metadata.cjs');
module.exports = {
  ...metadata,
  page: require('./reader.cjs'),
  isWorkUrl: (url) =>
    metadata.workHosts.includes(url.hostname) &&
    /^\/(?:project\/canvas|projects\/canvas\/camp)\/[^/]+\/?$/.test(url.pathname),
  validateWorkUrl: (value) => {
    if (!/^\/(?:project\/canvas|projects\/canvas\/camp)\/[^/]+\/?$/.test(new URL(value).pathname))
      throw new Error('请粘贴 RHTV 的具体作品详情或画布链接。');
  },
  inspectAccount: require('./account.cjs').inspectAccount,
  ...require('./parser.cjs'),
  ...require('./assets.cjs'),
  cleanText: (value) => value.replace(/\r\n/g, '\n'),
  textFields: ['content', 'text'],
  isResource: (node) =>
    ['image', 'video', 'audio'].includes(node.type) && !node.data?.modelCode && !node.data?.params,
  isCanvasUrl: (url) =>
    metadata.workHosts.includes(url.hostname) && /^\/project\/canvas\/[^/]+\/?$/.test(url.pathname),
  leftWork: (url, requested) => {
    if (!metadata.workHosts.includes(url.hostname)) return false;
    const workPath = /^\/(?:project\/canvas|projects\/canvas\/camp)\/[^/]+\/?$/;
    if (!workPath.test(requested.pathname)) return false;
    // The community preview stays on the same URL. A different work/canvas or
    // a return to a project listing must never be committed as the original.
    return url.pathname.replace(/\/$/, '') !== requested.pathname.replace(/\/$/, '');
  }
};
