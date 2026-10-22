'use strict';
// Serialized alongside a platform inspector. The adapter supplies the exact
// work heading and ID; never scan recommendation cards or an author's sidebar.
function inspectPublished({ workId, title, heading, detail, process, login }) {
  if (!detail || !workId || !heading || !title || login) return {};
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const primary = (el) => visible(el) && Boolean(el.compareDocumentPosition(heading) & 4);
  let scope = heading.parentElement;
  while (scope && scope !== document.body && ![...scope.querySelectorAll('video')].some(primary))
    scope = scope.parentElement;
  if (!scope || scope === document.body) return {};
  const video = [...scope.querySelectorAll('video')].find(primary);
  if (!video) return {};
  if (scope.querySelector('[aria-busy="true"], [role="progressbar"]')) return {};
  const src = video.currentSrc || video.getAttribute('src') || '';
  return {
    detailReady: true,
    canvasAccess: process ? 'public' : 'unknown',
    fullVideo:
      /^https:\/\//.test(src) && !/\.m3u8(?:\?|$)/i.test(src)
        ? {
            workId,
            name: title,
            url: src,
            previewUrl: video.poster || '',
            duration: Number.isFinite(video.duration) ? video.duration : undefined,
            width: video.videoWidth,
            height: video.videoHeight
          }
        : undefined
  };
}
module.exports = { inspectPublished };
