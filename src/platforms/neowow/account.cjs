'use strict';
function inspectAccount() {
  if (!['neowow.cn', 'www.neowow.cn'].includes(location.hostname))
    return { state: 'unknown', username: '', avatar: '' };
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const signedOut = [...document.querySelectorAll('button')].some(
    (el) => visible(el) && /^(登录|开始你的旅程)$/.test(el.textContent.trim())
  );
  const avatar = [...document.querySelectorAll('img[alt="用户头像"]')].find(visible);
  return {
    state: signedOut ? 'logged-out' : avatar ? 'logged-in' : 'unknown',
    username: '',
    avatar: avatar?.src || ''
  };
}
module.exports = { inspectAccount };
