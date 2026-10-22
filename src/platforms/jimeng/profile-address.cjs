'use strict';
// Shared by the page reader and the input hint; no Electron or Node dependencies.
function profileAddress(input) {
  try {
    const url = new URL(String(input).trim());
    if (
      url.protocol !== 'https:' ||
      url.host !== 'jimeng.jianying.com' ||
      url.username ||
      url.password
    )
      return null;
    const uuid = url.pathname.match(/^\/ai-tool\/personal\/([A-Za-z0-9_-]{16,256})\/?$/)?.[1];
    if (uuid) return { uuid, url: 'https://jimeng.jianying.com/ai-tool/personal/' + uuid };
    const share = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{6,64})\/?$/)?.[1];
    if (share) return { shared: true, url: 'https://jimeng.jianying.com/s/' + share + '/' };
  } catch {}
  return null;
}
module.exports = { profileAddress };
