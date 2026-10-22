'use strict';
const { LABELS } = require('../author-profiles.cjs');
function markdownValue(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*\[\]]/g, '\\$&')
    .replace(/\r?\n/g, '\n  ');
}
function workInfoText(metadata) {
  const info = metadata.workInfo || {};
  const value = (v) => (v === undefined || v === null || v === '' ? '未读取' : String(v));
  const yesNo = (v) => (typeof v === 'boolean' ? (v ? '是' : '否') : '未读取');
  const rows = [
    ['作品网址', metadata.inputUrl],
    ['解析后网址', metadata.resolvedUrl],
    ['画布网址', metadata.canvasUrl],
    [
      '画布状态',
      metadata.canvasNote || (metadata.canvasAccess === 'public' ? '已公开' : undefined)
    ],
    ['视频原始网址', metadata.fullVideo?.url],
    ['平台', metadata.platform],
    ['作品名称', metadata.title],
    ['作者', metadata.author],
    ['作者主页', info.authorUrl],
    ['作者简介', info.authorBio],
    ['粉丝数', info.followerCount],
    ['作者关注数', info.followingCount],
    ['是否关注作者', yesNo(info.isFollowing)],
    ['点赞数量', info.likeCount],
    ['是否已点赞', yesNo(info.isLiked)],
    ['关注及点赞状态来源', info.accountState],
    ['播放数量', info.playCount],
    ['查看制作过程数量', info.viewCreationProcessCount],
    ['复制画布数量', info.copyCanvasCount],
    ['分享数量', info.shareCount],
    ['作品描述', info.description],
    ['作品标签', info.tags?.join('、')],
    ['创建时间', info.createdAt],
    ['发布时间', info.publishedAt],
    ['更新时间', info.updatedAt],
    ['含 AI 生成内容', yesNo(info.containsAI)],
    ['作品信息采集时间', info.capturedAt],
    ['画布提取时间', metadata.extractedAt]
  ];
  const lines = [
    '# 作品信息',
    '',
    '## 作品详情',
    '',
    ...rows.map(([label, v]) => '- ' + label + '：' + markdownValue(value(v))),
    '',
    '## 作者公开资料与社交账号',
    ''
  ];
  const profiles = metadata.authorProfiles || [];
  const provided = profiles.some(
    (profile) => profile.platform === (metadata.platform || 'liblib') && profile.status === 'read'
  );
  const statuses = {
    read: '已读取',
    partial: '部分读取',
    unavailable: '未读取',
    unread: '未读取',
    invalid: '链接无法读取',
    'link-only': '已记录链接'
  };
  for (const platform of [
    metadata.platform || 'liblib',
    'xiaohongshu',
    'douyin',
    'bilibili',
    'other'
  ]) {
    const matches = profiles.filter((profile) => profile.platform === platform);
    if (platform === 'other' && !matches.length) continue;
    lines.push('### ' + LABELS[platform], '');
    if (!matches.length) {
      lines.push(
        '- 资料状态：' +
          (provided && platform !== (metadata.platform || 'liblib') ? '作者未填写' : '未读取'),
        ''
      );
      continue;
    }
    for (const [index, profile] of matches.entries()) {
      if (matches.length > 1) lines.push('#### 账号 ' + (index + 1), '');
      const fields = [
        ['资料状态', statuses[profile.status] || '未读取'],
        ['用户主页', profile.profileUrl],
        ['用户标识', profile.userId],
        ['昵称', profile.displayName],
        ['平台账号', profile.accountId],
        ['简介', profile.bio],
        ['头像网址', profile.avatarUrl],
        ['公开属地', profile.location],
        ['粉丝数', profile.metrics?.followers],
        ['关注数', profile.metrics?.following],
        ['获赞或互动数', profile.metrics?.likes],
        ['采集时间', profile.capturedAt]
      ];
      if (profile.originalUrl && profile.originalUrl !== profile.profileUrl)
        fields.splice(2, 0, ['作者填写原文', profile.originalUrl]);
      if (profile.note) fields.push(['读取说明', profile.note]);
      lines.push(...fields.map(([label, v]) => '- ' + label + '：' + markdownValue(value(v))), '');
    }
  }
  lines.push(
    '说明：数量和关注、点赞状态为采集时的公开资料；“未读取”表示页面、登录状态或旧项目未提供该信息。作者填写的跨平台链接不代表各平台昵称相同。',
    ''
  );
  return lines.join('\r\n');
}
module.exports = { workInfoText, workInfoMarkdown: workInfoText };
