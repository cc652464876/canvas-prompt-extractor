'use strict';
const LABELS = {
  liblib: 'LibTV',
  jimeng: '即梦AI',
  rhtv: 'RHTV',
  tapnow: 'TapNow',
  xiaohongshu: '小红书',
  douyin: '抖音',
  bilibili: 'B站',
  other: '其他网站'
};
const HOSTS = {
  xiaohongshu: ['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com'],
  douyin: ['douyin.com', 'www.douyin.com', 'v.douyin.com', 'www.iesdouyin.com', 'iesdouyin.com'],
  bilibili: ['space.bilibili.com', 'b23.tv', 'www.bilibili.com', 'bilibili.com']
};
function publicUrl(raw) {
  const text = String(raw || '').trim();
  const link = text.match(/https?:\/\/[^\s<>"'，。；）)]+/i)?.[0];
  if (!link) return '';
  try {
    const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}
function socialAddress(raw, hint) {
  const link = publicUrl(raw);
  if (!link) return null;
  const url = new URL(link);
  const platform =
    Object.keys(HOSTS).find((platform) => HOSTS[platform].includes(url.hostname)) || 'other';
  if (hint && hint !== 'other' && platform !== hint) return null;
  let userId = '',
    profileUrl = link;
  if (platform === 'xiaohongshu') {
    userId = url.pathname.match(/^\/user\/profile\/([a-f0-9]{24})(?:\/|$)/i)?.[1] || '';
    if (userId) profileUrl = 'https://www.xiaohongshu.com/user/profile/' + userId;
  }
  if (platform === 'douyin') {
    userId = url.pathname.match(/^\/(?:share\/)?user\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || '';
    if (userId) profileUrl = 'https://www.douyin.com/user/' + userId;
  }
  if (platform === 'bilibili') {
    userId =
      url.hostname === 'space.bilibili.com'
        ? url.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1] || ''
        : '';
    if (userId) profileUrl = 'https://space.bilibili.com/' + userId;
  }
  return {
    platform,
    profileUrl,
    userId,
    originalUrl: String(raw),
    status: platform === 'other' ? 'link-only' : 'unread'
  };
}
function liblibProfile(data, address) {
  const user = data?.userDetail || {},
    space = user.personalSpaceInformation || {},
    counter = data?.counter || {};
  const profile = {
    platform: 'liblib',
    profileUrl: address.url,
    userId: address.uuid,
    displayName: typeof user.nickname === 'string' ? user.nickname : '',
    bio: typeof space.briefIntroduction === 'string' ? space.briefIntroduction : '',
    avatarUrl: publicUrl(user.avatar),
    metrics: {},
    capturedAt: new Date().toISOString(),
    status: user.nickname ? (user.personalSpaceInformation ? 'read' : 'partial') : 'unavailable'
  };
  for (const [key, source] of Object.entries({
    followers: 'followerCount',
    following: 'followCount',
    likes: 'likeCount'
  }))
    if (typeof counter[source] === 'number' && Number.isFinite(counter[source]))
      profile.metrics[key] = counter[source];
  const socialLinks = [];
  for (const [key, hint] of Object.entries({
    xiaohongshuLink: 'xiaohongshu',
    tiktokLink: 'douyin',
    bliLink: 'bilibili',
    webLink: 'other',
    otherLink: 'other',
    huggingFaceLink: 'other',
    twitterLink: 'other',
    facebookLink: 'other',
    instagramLink: 'other',
    discordLink: 'other'
  })) {
    const raw = space[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = socialAddress(raw, hint);
    socialLinks.push(
      value || {
        platform: hint,
        originalUrl: raw,
        profileUrl: '',
        status: 'invalid',
        note: '作者填写的内容不是可读取的用户主页链接'
      }
    );
  }
  return {
    profile,
    socialLinks: socialLinks.filter(
      (item, index, items) =>
        items.findIndex(
          (other) => other.profileUrl === item.profileUrl && other.originalUrl === item.originalUrl
        ) === index
    )
  };
}
async function readLiblibProfile(address, fetcher, signal) {
  const response = await fetcher(
    'https://www.liblib.tv/api/www/user/getPersonInfo/' + address.uuid,
    {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Referer: 'https://www.liblib.tv/' },
      body: '{}',
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(12000)])
    }
  );
  if (!response.ok) throw new Error('作者公开资料读取失败（HTTP ' + response.status + '）。');
  const value = await response.json();
  if (value.code !== 0 || !value.data?.userDetail) throw new Error('作者公开资料暂未提供。');
  return liblibProfile(value.data, address);
}
function attachAuthorProfiles(result, bundle) {
  if (!bundle) return result;
  const info = { ...(result.metadata.workInfo || {}) },
    profile = bundle.profile;
  if (profile?.profileUrl) info.authorUrl = profile.profileUrl;
  if (profile?.bio) info.authorBio = profile.bio;
  if (profile?.metrics?.followers !== undefined) info.followerCount = profile.metrics.followers;
  if (profile?.metrics?.following !== undefined) info.followingCount = profile.metrics.following;
  return {
    ...result,
    metadata: {
      ...result.metadata,
      workInfo: info,
      authorProfiles: [profile, ...(bundle.socialLinks || [])].filter(Boolean)
    }
  };
}
module.exports = {
  LABELS,
  HOSTS,
  publicUrl,
  socialAddress,
  liblibProfile,
  readLiblibProfile,
  attachAuthorProfiles
};
