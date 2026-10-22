'use strict';
const { setTimeout: pause } = require('node:timers/promises');
const { loadWork } = require('../page-navigation.cjs');
const { boundedRead } = require('../read-deadline.cjs');
// Completed resource timing cannot see a script that is still downloading.
// Count those requests in this session until the read finishes.
function watchDocumentActivity(wc) {
  const pending = new Set();
  const types = new Set(['script', 'xhr', 'fetch']);
  const relevant = (details) => details.webContentsId === wc.id && types.has(details.resourceType);
  const before = (details, callback) => {
    try {
      if (relevant(details)) pending.add(details.id);
    } finally {
      callback({ cancel: false });
    }
  };
  const finish = (details) => {
    if (relevant(details)) pending.delete(details.id);
  };
  let installed = false;
  try {
    const filter = { urls: ['<all_urls>'] };
    wc.session.webRequest.onBeforeRequest(filter, before);
    wc.session.webRequest.onCompleted(filter, finish);
    wc.session.webRequest.onErrorOccurred(filter, finish);
    installed = true;
  } catch {
    installed = false;
  }
  return {
    get pending() {
      return pending.size;
    },
    stop() {
      if (!installed) return;
      installed = false;
      try {
        const request = wc.session.webRequest;
        request.onBeforeRequest(null);
        request.onCompleted(null);
        request.onErrorOccurred(null);
      } catch {}
    }
  };
}
function createProfilePageReader(getWindow) {
  return async (address, read, signal) => {
    const window = getWindow(address.platform);
    const wc = window.webContents;
    const activity = watchDocumentActivity(wc);
    const abort = () => {
      if (!wc.isDestroyed()) wc.stop();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await loadWork(window, address.url, signal, { webContents: wc });
      const steps = {
        snapshot: '检查作品列表',
        select: '切换作品栏目',
        open: '打开作品详情',
        detail: '读取作品详情',
        back: '返回作者主页',
        scroll: '加载更多作品'
      };
      const run = async (action, index) => {
        // Recovery reuses this window and session. Reloading the trusted input
        // also warms the same route chunks, without a second user request.
        if (action === 'reload') return loadWork(window, address.url, signal, { webContents: wc });
        const value = await boundedRead(
          () =>
            // WebContents.executeJavaScript waits for the whole page load to
            // finish, even after DOM-ready. Video/image requests can keep that
            // load pending indefinitely. Execute in the current document now.
            wc.mainFrame.executeJavaScript(
              '(' +
                address.page.toString() +
                ')(' +
                JSON.stringify(action) +
                ',' +
                JSON.stringify(index ?? null) +
                ',' +
                (address.parseWork?.toString() || 'null') +
                ')'
            ),
          {
            timeoutMs: 6000,
            signal,
            message:
              '读取作者主页超时（' +
              (steps[action] || '读取页面') +
              '），请显示平台页面检查后重试。'
          }
        );
        if (action === 'snapshot' && value && typeof value === 'object')
          value.boot = { ...value.boot, pending: activity.pending };
        return value;
      };
      return await read(run, (ms) => pause(ms, undefined, { signal }));
    } finally {
      activity.stop();
      signal.removeEventListener('abort', abort);
    }
  };
}
module.exports = { createProfilePageReader };
