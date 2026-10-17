'use strict';
const { resolvePlatform, getAdapter, httpsUrl, permittedUrl } = require('./platforms/registry.cjs');
function popupAction(value, requestedUrl) {
  try {
    const url = new URL(value);
    const { platform } = resolvePlatform(requestedUrl);
    if (!permittedUrl(platform, value)) return 'deny';
    if (getAdapter(platform).isCanvasUrl(url)) return 'canvas';
    // Authentication may genuinely require a separate window. Other popups are
    // unnecessary for reading and must not steal the controlled page.
    if (
      /(?:^|[./_-])(?:login|signin|oauth|authorize|passport|sso|auth)(?:[./_-]|$)/i.test(
        url.hostname + url.pathname
      )
    )
      return 'auth';
    return 'deny';
  } catch {
    return 'deny';
  }
}
function leftRequestedWork(value, requestedUrl) {
  try {
    const { platform } = resolvePlatform(requestedUrl);
    return getAdapter(platform).leftWork(httpsUrl(value), httpsUrl(requestedUrl));
  } catch {
    return false;
  }
}
module.exports = { popupAction, leftRequestedWork };
