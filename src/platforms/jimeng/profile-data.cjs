'use strict';
// The site's short-video DomainModel/render model, already loaded by its signed
// homepage request. Keep only the current author's work fields, never its draft.
function listingWork(item) {
  const domain = item?.commonAttr && Number(item.effectType ?? item.commonAttr.effectType) === 210;
  if (!domain && item?.type !== 'short-video') return null;
  const id = String(domain ? item.id || item.commonAttr.id || '' : item.key || '');
  if (!/^\d+$/.test(id)) return null;
  const https = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !/\.m3u8(?:\?|$)/i.test(u.href)
        ? u.href
        : '';
    } catch {
      return '';
    }
  };
  const common = domain ? item.commonAttr : item;
  const video = domain ? item.video || {} : {};
  const source =
    [
      video.originVideo,
      video.transcodedVideo?.origin,
      ...Object.values(video.transcodedVideo || {})
    ].find((value) => https(value?.videoUrl)) || {};
  const title = common.title || '未命名作品';
  const cover = https(common.coverUrl || video.coverUrl);
  const publicProcess = item.aigcImageParams?.publishOpt?.publicShortVideoProcessInfo;
  const canvas = item.canvasInfo;
  let canvasAccess = 'unknown';
  if (publicProcess === true) canvasAccess = 'public';
  else if (canvas?.projectId && canvas.reviewStatus === 1) canvasAccess = 'public';
  else if (
    publicProcess === false ||
    (domain && Object.prototype.hasOwnProperty.call(item, 'canvasInfo') && !canvas?.projectId) ||
    (canvas && (canvas.reviewStatus === 0 || canvas.reviewStatus === 2))
  )
    canvasAccess = 'not-public';
  const url = https(source.videoUrl || item.videoUrl);
  return {
    id,
    title,
    platform: 'jimeng',
    cover,
    author: item.author?.name || item.author?.username || '',
    avatar: https(item.author?.avatarUrl || item.author?.avatar),
    url:
      'https://jimeng.jianying.com/ai-tool/work-detail/' +
      id +
      '?workDetailType=ShowcaseVideo&itemType=210',
    canvasId: typeof canvas?.projectId === 'string' ? canvas.projectId : '',
    canvasAccess,
    fullVideo: {
      workId: id,
      name: title,
      url,
      previewUrl: cover,
      width: source.width,
      height: source.height,
      duration: (video.durationMs || video.duration * 1000 || item.duration || 0) / 1000
    },
    state: 'idle',
    error: ''
  };
}
module.exports = { listingWork };
