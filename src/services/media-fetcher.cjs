'use strict';
const { getAdapter } = require('../platforms/registry.cjs');
function createMediaFetcher({ session, metadata }) {
  if (!metadata?.platform) throw new Error('请先读取画布。');
  const platform = metadata.platform,
    pageUrl = metadata.canvasUrl || getAdapter(platform).homeUrl;
  const referer = new URL(pageUrl).origin + '/',
    browserSession = session.fromPartition('persist:' + platform);
  // Capture the project session once, so a later project change cannot send a
  // redirected request with another brand's cookies or referrer.
  return (url, options = {}) =>
    browserSession.fetch(url, { ...options, headers: { Referer: referer, ...options.headers } });
}
module.exports = { createMediaFetcher };
