'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  { EventEmitter } = require('node:events');
const { loadWork, watchPageFailures } = require('../../src/page-navigation.cjs');
const url = 'https://www.liblib.tv/detail/test';
function fixture(load) {
  const wc = Object.assign(new EventEmitter(), { mainFrame: { url } });
  return { webContents: wc, loadURL: () => load(wc) };
}
test('Pinned navigation and cancellation do not follow the active tab', async () => {
  const { TaskScope } = require('../../src/services/task-scope.cjs');
  const active = fixture(() => {
    throw new Error('Must not load the active page');
  });
  let loaded = '',
    stops = 0;
  const wc = new EventEmitter();
  Object.assign(wc, {
    mainFrame: { url },
    loadURL: async (value) => {
      loaded = value;
    },
    stop: () => {
      stops++;
    }
  });
  await loadWork(active, url, undefined, { webContents: wc });
  assert.equal(loaded, url);
  const scope = new TaskScope(),
    token = scope.begin('liblib', url);
  token.window = active;
  token.contents = wc;
  active.webContents.stop = () => {
    throw new Error('Must not stop the active page');
  };
  scope.cancel();
  assert.equal(stops, 1);
  assert.equal(token.controller.signal.aborted, true);
});
test('Main network failure wins over an error document DOM-ready and a late loadURL rejection', async () => {
  let rejectLoad;
  const win = fixture((wc) => {
    const pending = new Promise((_, reject) => {
      rejectLoad = reject;
    });
    queueMicrotask(() => {
      wc.emit('did-fail-load', {}, -100, 'ERR_CONNECTION_CLOSED', url, true);
      wc.mainFrame.url = 'chrome-error://chromewebdata/';
      wc.emit('dom-ready');
    });
    return pending;
  });
  await assert.rejects(loadWork(win, url), {
    code: 'PAGE_LOAD_FAILED',
    errorCode: -100,
    errorDescription: 'ERR_CONNECTION_CLOSED'
  });
  rejectLoad(Object.assign(new Error('late load rejection'), { code: 'ERR_CONNECTION_CLOSED' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(win.webContents.listenerCount('dom-ready'), 0);
  assert.equal(win.webContents.listenerCount('did-fail-load'), 0);
});
test('An error document is rejected even when no network error event was captured', async () => {
  const win = fixture((wc) => {
    queueMicrotask(() => {
      wc.mainFrame.url = 'chrome-error://chromewebdata/';
      wc.emit('dom-ready');
    });
    return new Promise(() => {});
  });
  await assert.rejects(loadWork(win, url), { code: 'PAGE_LOAD_FAILED' });
});
test('HTTP gateway error responses cannot be mistaken for usable DOM-ready pages', async () => {
  const win = fixture((wc) => {
    queueMicrotask(() => {
      wc.emit('did-navigate', {}, url, 503, 'Service Unavailable');
      wc.emit('dom-ready');
    });
    return new Promise(() => {});
  });
  await assert.rejects(loadWork(win, url), { code: 'PAGE_LOAD_FAILED', errorCode: 503 });
  assert.equal(win.webContents.listenerCount('did-navigate'), 0);
});
test('DOM-ready still releases a usable page with permanently pending media or failed subframes', async () => {
  const win = fixture((wc) => {
    queueMicrotask(() => {
      wc.emit('did-fail-load', {}, -100, 'ERR_CONNECTION_CLOSED', url, false);
      wc.emit('dom-ready');
    });
    return new Promise(() => {});
  });
  await loadWork(win, url, { aborted: false, addEventListener() {}, removeEventListener() {} });
});
test('Cancellation and timeout release navigation listeners', async () => {
  const win = fixture(() => new Promise(() => {})),
    controller = new AbortController();
  const pending = loadWork(win, url, controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { code: 'READ_CANCELLED' });
  assert.equal(win.webContents.listenerCount('did-fail-load'), 0);
  await assert.rejects(loadWork(win, url, undefined, { timeoutMs: 20 }), {
    code: 'READ_OPERATION_TIMEOUT'
  });
  assert.equal(win.webContents.listenerCount('dom-ready'), 0);
});
test('Failures after DOM readiness remain visible to extraction; old aborts and iframe failures do not', () => {
  const wc = new EventEmitter(),
    records = [],
    state = watchPageFailures(wc, (record) => records.push(record));
  wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', url, true);
  assert.equal(state.error, null);
  wc.emit('did-fail-load', {}, -100, 'ERR_CONNECTION_CLOSED', url, false);
  assert.equal(state.error, null);
  wc.emit('did-fail-load', {}, -100, 'ERR_CONNECTION_CLOSED', url, true);
  assert.equal(state.error.errorCode, -100);
  assert.equal(records.length, 1);
  wc.emit('did-start-navigation', {}, url, true, true);
  assert.ok(state.error);
  wc.emit('did-start-navigation', {}, url, false, true);
  assert.equal(state.error, null);
  state.dispose();
  assert.equal(wc.listenerCount('did-fail-load'), 0);
  assert.equal(wc.listenerCount('did-start-navigation'), 0);
});
