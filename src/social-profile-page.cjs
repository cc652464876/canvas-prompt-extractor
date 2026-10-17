'use strict';
// Runs only in a public profile document. Never inspect the signed-in viewer's
// account store, feed items, comments, contacts or recommended creators.
function readSocialProfile(request) {
  const result = { profileUrl: request.profileUrl, userId: request.userId, metrics: {} };
  const text = (node) => (node?.innerText || node?.textContent || '').trim();
  const find = (root, selectors) =>
    selectors.map((selector) => root?.querySelector(selector)).find(Boolean);
  const meta = (name) =>
    document.querySelector('meta[name="' + name + '"],meta[property="' + name + '"]')?.content ||
    '';
  const body = document.body?.innerText || '';
  result.loginRequired =
    /\/login(?:\/|$)/.test(location.pathname) ||
    /登录后推荐更懂你的笔记|登录后免费畅享高清视频|请完成验证|安全验证|访问验证/.test(body);
  result.accessBlocked =
    /\/login(?:\/|$)/.test(location.pathname) || /请完成验证|安全验证|访问验证/.test(body);
  result.loginOverlayPresent = /登录后推荐更懂你的笔记|登录后免费畅享高清视频/.test(body);
  if (request.platform === 'xiaohongshu') {
    const id = ['www.xiaohongshu.com', 'xiaohongshu.com'].includes(location.hostname)
      ? location.pathname.match(/^\/user\/profile\/([a-f0-9]{24})(?:\/|$)/i)?.[1]
      : '';
    if (!id || !request.userId || id !== request.userId)
      return { ...result, note: '页面要求登录或未停留在该用户主页' };
    const page = window.__INITIAL_STATE__?.user?.userPageData;
    const basic = page?.basicInfo;
    if (basic && (!basic.userId || basic.userId === id)) {
      result.displayName = basic.nickname;
      result.bio = basic.desc;
      result.avatarUrl = basic.images || basic.imageb;
      result.accountId = basic.redId;
      result.location = basic.ipLocation;
      for (const item of page.interactions || []) {
        const key = { fans: 'followers', follows: 'following', interaction: 'likes' }[item.type];
        if (key && ['string', 'number'].includes(typeof item.count))
          result.metrics[key] = item.count;
      }
    }
    const root = document.querySelector('.user-page .user-info, .user-info');
    result.displayName ||= text(find(root, ['.user-name', '.username']));
    result.bio ||= text(find(root, ['.user-desc', '.desc']));
    result.accountId ||= text(find(root, ['.user-redId', '.user-red-id'])).replace(
      /^小红书号[:：]\s*/,
      ''
    );
    for (const node of root?.querySelectorAll(
      '.user-interactions .interaction, .user-interactions .relation-count, .user-interactions .note-count, .data-info .data-item'
    ) || []) {
      const label = text(node),
        count = text(find(node, ['.count', '.value']));
      const key = /粉丝/.test(label)
        ? 'followers'
        : /关注/.test(label)
          ? 'following'
          : /获赞|收藏/.test(label)
            ? 'likes'
            : '';
      if (key && count && result.metrics[key] === undefined) result.metrics[key] = count;
    }
  }
  if (request.platform === 'douyin') {
    const id = ['www.douyin.com', 'douyin.com', 'www.iesdouyin.com', 'iesdouyin.com'].includes(
      location.hostname
    )
      ? location.pathname.match(/^\/(?:share\/)?user\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
      : '';
    if (!id || !request.userId || id !== request.userId)
      return { ...result, note: '未进入该抖音用户主页' };
    const root = document.querySelector('[data-e2e="user-info"]');
    result.displayName = text(find(root, ['[data-e2e="user-title"]', 'h1', 'h2']));
    result.bio = text(find(root, ['[data-e2e="user-signature"]', '[data-e2e="user-description"]']));
    const header = text(root);
    result.accountId = header.match(/抖音号\s*[:：]\s*([^\s]+)/)?.[1];
    result.location = header.match(/IP属地\s*[:：]\s*([^\s]+)/)?.[1];
    // The profile header remains in the DOM under Douyin's login overlay.
    // Avoid hashed CSS classes and exclude navigation, feed and modal headings.
    const stats = {
      followers: '[data-e2e="user-info-fans"]',
      following: '[data-e2e="user-info-follow"]',
      likes: '[data-e2e="user-info-like"]'
    };
    for (const [key, label] of Object.entries({
      followers: '粉丝',
      following: '关注',
      likes: '获赞'
    })) {
      const value =
        text(root?.querySelector(stats[key])).match(/[\d,.]+[万亿]?/)?.[0] ||
        header.match(new RegExp(label + '\\s*([\\d,.]+[万亿]?)'))?.[1] ||
        header.match(new RegExp('([\\d,.]+[万亿]?)\\s*' + label))?.[1];
      if (value) result.metrics[key] = value;
    }
    const avatar = document.querySelector('#user_detail_element [data-e2e="live-avatar"] img');
    result.avatarUrl = avatar?.src || '';
    if (!result.bio && root) {
      const account = [...(root.querySelectorAll?.('p') || [])].find((node) =>
        /抖音号/.test(text(node))
      );
      result.bio = text(account?.nextElementSibling);
    }
    for (const loader of Object.values(window._ROUTER_DATA?.loaderData || {})) {
      const user = loader?.user?.user || loader?.userInfo || loader?.user_info;
      if (!user || user.sec_uid !== id) continue;
      result.displayName = user.nickname || result.displayName;
      result.bio = user.signature || result.bio;
      result.accountId = user.unique_id || user.short_id || result.accountId;
      for (const [key, source] of Object.entries({
        followers: 'follower_count',
        following: 'following_count',
        likes: 'total_favorited'
      }))
        if (typeof user[source] === 'number') result.metrics[key] = user[source];
    }
    if (!result.bio && root) {
      const lines = header
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean);
      result.bio = lines
        .filter(
          (value) =>
            value !== result.displayName &&
            !/抖音号|IP属地|^\d|^(关注|粉丝|获赞|作品|推荐|喜欢|收藏)$|(?:关注|粉丝|获赞)\s*[\d,.]+/.test(
              value
            )
        )
        .slice(0, 4)
        .join('\n');
    }
  }
  if (request.platform === 'bilibili') {
    const id =
      location.hostname === 'space.bilibili.com'
        ? location.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1]
        : '';
    if (!id || !request.userId || id !== request.userId)
      return { ...result, note: '页面未停留在该 B 站用户空间' };
    result.displayName =
      text(find(document, ['#h-name', '.h-name', '.up-info .up-name', '.header .nickname'])) ||
      document.title.match(/^(.+?)的个人空间/)?.[1];
    result.bio = text(find(document, ['#h-sign', '.h-sign', '.up-description']));
    if (!result.bio) {
      const description = meta('description');
      const marker = '第一时间了解UP主动态。';
      if (description.includes(marker))
        result.bio = description.split(marker).slice(1).join(marker).trim();
    }
    const avatar = document.querySelector(
      '#h-avatar img, img#h-avatar, .h-avatar img, .up-avatar img'
    );
    const fallbackAvatar =
      document.querySelector('link[rel="apple-touch-icon"]')?.href || meta('og:image');
    result.avatarUrl = avatar?.src || (/\/bfs\/face\//.test(fallbackAvatar) ? fallbackAvatar : '');
    for (const [key, selector] of Object.entries({ followers: '#n-fs', following: '#n-gz' })) {
      const node = document.querySelector(selector);
      if (node)
        result.metrics[key] =
          node.getAttribute('title') ||
          text(find(node, ['.n-data-v', '.value'])) ||
          text(node)
            .replace(/粉丝数|关注数|粉丝|关注/g, '')
            .trim();
    }
    result.loginRequired ||=
      /登录后你可以|扫描二维码登录/.test(body) && Object.keys(result.metrics).length === 0;
  }
  result.loginRequired ||= /登录后.*查看|请先登录/.test(body);
  return result;
}
module.exports = { readSocialProfile };
