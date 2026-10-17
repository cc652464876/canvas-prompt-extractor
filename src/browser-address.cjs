'use strict';
function browserAddress(input) {
  const value = String(input || '').trim();
  if (!value) return 'about:blank';
  if (value === 'about:blank') return value;
  if (
    /^[a-z][a-z\d+.-]*:/i.test(value) &&
    !/^https?:\/\//i.test(value) &&
    !/^[^/\s:]+:\d+(?:\/|$)/i.test(value)
  )
    throw new Error('请输入网页地址或搜索关键词。');
  let address = value;
  if (!/^https?:\/\//i.test(address)) {
    if (!/\s/.test(address) && /^(?:localhost(?::\d+)?|[^/]+\.[^/]+)(?:\/|$)/i.test(address))
      address = 'https://' + address;
    else return 'https://www.google.com/search?q=' + encodeURIComponent(value);
  }
  const parsed = new URL(address);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('请使用不含账户密码的 HTTP 或 HTTPS 网页地址。');
  return parsed.href;
}
function isBrowserAddress(input) {
  try {
    if (input === 'about:blank') return true;
    const url = new URL(input);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
module.exports = { browserAddress, isBrowserAddress };
