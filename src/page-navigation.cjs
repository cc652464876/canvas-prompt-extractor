'use strict';
const { boundedRead } = require('./read-deadline.cjs');
function pageLoadError(errorCode, errorDescription = '页面加载失败') {
  const description = String(errorDescription).slice(0, 100);
  return Object.assign(
    new Error(
      `作品页面加载失败：${description}${errorCode === undefined ? '' : ` (${errorCode})`}。请检查网络后重新读取。`
    ),
    { code: 'PAGE_LOAD_FAILED', errorCode, errorDescription: description }
  );
}
function watchPageFailures(wc, onFailure = () => {}) {
  const state = { error: null };
  const start = (_event, _url, inPlace, main) => {
    if (main && !inPlace) state.error = null;
  };
  const fail = (_event, code, description, url, main) => {
    // Aborting the old document when a new navigation starts is expected.
    if (!main || code === -3) return;
    state.error = pageLoadError(code, description);
    onFailure({ errorCode: code, errorDescription: description, url });
  };
  const http = (_event, url, code, status) => {
    if (code >= 400) fail(_event, code, `HTTP_${code} ${status || ''}`.trim(), url, true);
  };
  wc.on('did-start-navigation', start);
  wc.on('did-fail-load', fail);
  wc.on('did-navigate', http);
  state.dispose = () => {
    wc.removeListener('did-start-navigation', start);
    wc.removeListener('did-fail-load', fail);
    wc.removeListener('did-navigate', http);
  };
  return state;
}
async function loadWork(window, url, signal, { timeoutMs = 45000, webContents } = {}) {
  const wc = webContents || window.webContents;
  let ready, fail, http;
  try {
    await boundedRead(
      () =>
        new Promise((resolve, reject) => {
          fail = (_event, code, description, _url, main) => {
            if (main && code !== -3) reject(pageLoadError(code, description));
          };
          http = (_event, _url, code, status) => {
            if (code >= 400) reject(pageLoadError(code, `HTTP_${code} ${status || ''}`.trim()));
          };
          ready = () => {
            // Chromium error documents also emit dom-ready and did-finish-load.
            // Their readiness must never win the race against loadURL's rejection.
            if (wc.mainFrame.url.startsWith('chrome-error:'))
              reject(pageLoadError(undefined, '浏览器错误页面'));
            else resolve();
          };
          wc.once('dom-ready', ready);
          wc.on('did-fail-load', fail);
          wc.on('did-navigate', http);
          (webContents || window)
            .loadURL(url)
            .then(resolve, (error) =>
              reject(pageLoadError(error.errno, error.code || error.message))
            );
        }),
      { timeoutMs, signal, message: '打开页面超过等待期限，请检查网络后重新读取。' }
    );
  } finally {
    if (ready) wc.removeListener('dom-ready', ready);
    if (fail) wc.removeListener('did-fail-load', fail);
    if (http) wc.removeListener('did-navigate', http);
  }
}
module.exports = { loadWork, watchPageFailures, pageLoadError };
