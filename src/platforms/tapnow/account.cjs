'use strict';
function inspectAccount() {
  if (location.hostname !== 'app.tapnow.plus')
    return { state: 'unknown', username: '', avatar: '' };
  const visible = (el) =>
    Boolean(el && el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const signedOut =
    [...document.querySelectorAll('button,[role="button"],a')].some(
      (el) =>
        visible(el) &&
        /^(登录|注册|登录\s*[/／]\s*注册|Log in|Sign in)$/i.test(
          (el.innerText || el.textContent || '').trim()
        )
    ) ||
    [...document.querySelectorAll('[role="dialog"]')].some(
      (el) => visible(el) && /扫码登录|验证码登录|请输入手机号|Sign in to/i.test(el.innerText || '')
    );
  // Only the viewer's navigation menu is login evidence. Work author avatars
  // and accessible public canvases must never be treated as the viewer.
  const menu = [...document.querySelectorAll('[data-testid="common-nav-user-menu"]')].find(visible);
  return {
    state: signedOut ? 'logged-out' : menu ? 'logged-in' : 'unknown',
    username: '',
    avatar: menu?.querySelector('img')?.src || ''
  };
}
module.exports = { inspectAccount };
