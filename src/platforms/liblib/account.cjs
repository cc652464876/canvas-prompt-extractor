'use strict';
// Inspect account controls only. Work titles, creator profiles and canvas access
// provide no evidence about the viewer's authentication state.
function inspectAccount() {
  const visible = (e) => {
      const style = getComputedStyle(e);
      return (
        Boolean(e.getClientRects().length) &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse'
      );
    },
    text = (e) => (e.innerText || e.textContent || '').trim();
  const controls = [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
  const signedOut =
    controls.some((e) => /^(注册\s*[/／]\s*登录|登录|注册)$/.test(text(e))) ||
    Boolean(
      [...document.querySelectorAll('[role="dialog"]')]
        .filter(visible)
        .find((e) => /请输入手机号|欢迎登录/.test(text(e)))
    );
  const logout = controls.some((e) => /^退出登录$/.test(text(e)));
  let username = '',
    avatar = '',
    ownRegion = null;
  for (const e of document.querySelectorAll('span,strong,button,[role="button"]')) {
    if (!visible(e)) continue;
    const value = text(e),
      r = e.getBoundingClientRect();
    if (
      !/^(?:1\d{2}\*{3,8}\d{2,4}|1\d{10})$/.test(value) ||
      r.top < 0 ||
      r.top > 180 ||
      r.left < innerWidth * 0.55
    )
      continue;
    for (let parent = e.parentElement, n = 0; parent && n < 4; parent = parent.parentElement, n++) {
      const p = parent.getBoundingClientRect();
      if (p.width < 500 && /UUID|Access\s*key|退出登录|账户设置|我的账号/i.test(text(parent))) {
        ownRegion = parent;
        username = value;
        break;
      }
    }
    if (ownRegion) break;
  }
  if (ownRegion) {
    const img = [...ownRegion.querySelectorAll('img')].find(visible);
    avatar = img?.currentSrc || img?.src || '';
  }
  // LibTV keeps its account menu collapsed. Match the account popup trigger,
  // not arbitrary creator avatars or the presence of credits/project cards.
  let accountAvatar = null;
  if (/^(www\.)?liblib\.tv$/.test(location.hostname) && !signedOut) {
    accountAvatar = [...document.querySelectorAll('img[alt="avatar"]')].find((img) => {
      if (!visible(img)) return false;
      const trigger = img.closest('[aria-haspopup="dialog"][aria-expanded]');
      if (!trigger || !visible(trigger)) return false;
      const r = trigger.getBoundingClientRect();
      return (
        r.top >= 0 &&
        r.bottom <= 180 &&
        r.left >= innerWidth * 0.55 &&
        r.width <= 180 &&
        r.height <= 80
      );
    });
    if (accountAvatar && !avatar) avatar = accountAvatar.currentSrc || accountAvatar.src || '';
  }
  if (/^1\d{10}$/.test(username)) username = username.slice(0, 3) + '****' + username.slice(-4);
  return {
    state:
      logout || ownRegion || accountAvatar ? 'logged-in' : signedOut ? 'logged-out' : 'unknown',
    username,
    avatar
  };
}
module.exports = { inspectAccount };
