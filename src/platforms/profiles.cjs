'use strict';
const { listPlatforms, getAdapter } = require('./registry.cjs');
function profileAddress(input) {
  for (const { id, capabilities } of listPlatforms()) {
    if (!capabilities.authorProfile) continue;
    const address = getAdapter(id).profile?.profileAddress(input);
    if (address) return { ...address, platform: id };
  }
  return null;
}
async function readProfile(input, fetcher, signal, onProgress, readPage) {
  const address = profileAddress(input);
  if (!address) throw new Error('请输入 LibTV、TapNow、即梦或 NeoWow 的有效作者主页地址。');
  return getAdapter(address.platform).profile.readProfile(
    input,
    (url, options) => fetcher(url, options, address.platform),
    signal,
    onProgress,
    readPage
  );
}
async function readProfileCount(input, fetcher, signal, readPage) {
  const address = profileAddress(input);
  if (!address) throw new Error('本地记录中没有有效的作者主页。');
  const adapter = getAdapter(address.platform).profile;
  if (adapter.readCount)
    return adapter.readCount(
      input,
      (url, options) => fetcher(url, options, address.platform),
      signal
    );
  // Other platforms reuse their complete public listing, without reading canvases.
  const profile = await readProfile(input, fetcher, signal, () => {}, readPage);
  return profile.works.length;
}
module.exports = { profileAddress, readProfile, readProfileCount };
