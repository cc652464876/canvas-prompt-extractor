'use strict';
const metadata = require('./metadata.cjs');
function cleanText(value) {
  let text = value.replace(/^\u0000rt-md:v\d+\r?\n/, '').replace(/\\\r?\n/g, '\n');
  const match = text.match(/^\s*(`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)\r?\n\1\s*$/);
  if (match && !match[2].split(/\r?\n/).some((line) => line.trim() === match[1])) text = match[2];
  return text;
}
function leftWork(url, requested) {
  if (
    !metadata.workHosts.includes(requested.hostname) ||
    !requested.pathname.startsWith('/detail/')
  )
    return false;
  const page = url.pathname.replace(/\/$/, '') || '/',
    work = requested.pathname.replace(/\/$/, '');
  return (
    metadata.workHosts.includes(url.hostname) &&
    (page === '/' || page === '/home' || (page.startsWith('/detail/') && page !== work))
  );
}
module.exports = {
  ...metadata,
  page: require('./reader.cjs'),
  inspectAccount: require('./account.cjs').inspectAccount,
  ...require('./parser.cjs'),
  ...require('./assets.cjs'),
  cleanText,
  textFields: ['content', 'text', 'storageText'],
  isResource: (node) =>
    /_resource$/.test(node.data?.action || '') || node.data?.source === 'uploaded',
  isCanvasUrl: (url) =>
    metadata.workHosts.includes(url.hostname) &&
    /^\/(?:canvas|ai-canvas)(?:\/|$)/.test(url.pathname),
  leftWork
};
