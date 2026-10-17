'use strict';
function sameWorkUrl(a, b) {
  try {
    const first = new URL(a),
      second = new URL(b);
    return (
      first.origin === second.origin &&
      first.pathname.replace(/\/$/, '') === second.pathname.replace(/\/$/, '') &&
      first.search === second.search
    );
  } catch {
    return false;
  }
}
function reuseWorkPage({
  requestedUrl,
  platform,
  attempt,
  windowUrl,
  windowPlatform,
  windowAvailable
}) {
  return Boolean(
    windowAvailable &&
    attempt?.platform === platform &&
    windowPlatform === platform &&
    sameWorkUrl(attempt.inputUrl, requestedUrl) &&
    (sameWorkUrl(windowUrl, requestedUrl) ||
      (attempt.resolvedUrl && sameWorkUrl(windowUrl, attempt.resolvedUrl)))
  );
}
// Serialize into the current document. A committed URL can belong to a blank,
// aborted or browser error page; it is not evidence that the work loaded.
function reusableDocument() {
  if (
    location.protocol !== 'https:' ||
    !document.body ||
    !['interactive', 'complete'].includes(document.readyState)
  )
    return false;
  const text = document.body.innerText.trim();
  if (/^upstream connect error or disconnect\/reset before headers/i.test(text)) return false;
  return Boolean(text || document.querySelector('.react-flow, iframe[src*="/ai-canvas/"]'));
}
module.exports = { reuseWorkPage, sameWorkUrl, reusableDocument };
