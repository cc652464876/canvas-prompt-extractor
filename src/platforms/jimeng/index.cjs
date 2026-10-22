'use strict';
const metadata = require('./metadata.cjs');
module.exports = {
  ...metadata,
  page: require('./reader.cjs'),
  profile: require('./profile.cjs'),
  isWorkUrl: (url) =>
    metadata.workHosts.includes(url.hostname) &&
    /^\/(?:ai-tool\/)?(?:work-detail|ai-canvas)\/[^/]+\/?$/.test(url.pathname),
  inspectAccount: require('./account.cjs').inspectAccount,
  ...require('./parser.cjs'),
  ...require('./assets.cjs'),
  cleanText: (value) => value.replace(/^\u0000rt-md:v\d+\r?\n/, ''),
  textFields: ['text', 'storageText', 'content'],
  isResource: (node) =>
    node.data?.source === 'uploaded' || /_resource$/.test(node.data?.action || ''),
  isCanvasUrl: (url) =>
    metadata.workHosts.includes(url.hostname) &&
    /^\/(?:ai-tool\/)?ai-canvas(?:\/|$)/.test(url.pathname),
  leftWork: (url, requested) =>
    metadata.workHosts.includes(url.hostname) &&
    /\/ai-canvas\//.test(requested.pathname) &&
    /\/ai-canvas\//.test(url.pathname) &&
    url.pathname.replace(/\/$/, '') !== requested.pathname.replace(/\/$/, '')
};
