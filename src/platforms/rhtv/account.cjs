'use strict';
function inspectAccount() {
  if (location.hostname !== 'rhtv.runninghub.cn')
    return { state: 'unknown', username: '', avatar: '' };
  const visible = (e) =>
    Boolean(e && e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
  const controls = [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
  const signedOut =
    controls.some((e) =>
      /^(登录|注册\s*[/／]\s*登录|登录\s*[/／]\s*注册)$/.test(
        (e.innerText || e.textContent || '').trim()
      )
    ) ||
    [...document.querySelectorAll('[role="dialog"]')].some(
      (e) =>
        visible(e) &&
        /扫码登录|验证码登录|请输入手机号|欢迎登录/.test(e.innerText || e.textContent || '')
    );
  const account = [...document.querySelectorAll('.userInfoBox[role="button"]')].find(visible);
  // Personal is the workspace label, not the viewer's username. An author
  // avatar, credits balance or accessible canvas is not login evidence.
  const head = account?.querySelector('.headIcon');
  const background = head ? getComputedStyle(head).backgroundImage : '';
  const avatar = background.match(/^url\(["']?(https:\/\/[^"')]+)["']?\)$/)?.[1] || '';
  return {
    state: signedOut ? 'logged-out' : account ? 'logged-in' : 'unknown',
    username: '',
    avatar
  };
}
module.exports = { inspectAccount };
