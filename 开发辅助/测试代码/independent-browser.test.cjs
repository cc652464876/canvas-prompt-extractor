'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { IndependentBrowser, siteForUrl } = require('../../src/services/independent-browser.cjs');
function fixture() {
  const service = new IndependentBrowser({
    createWindow: (options, controls) => {
      const win = new EventEmitter();
      Object.assign(win, {
        options,
        controls,
        url: '',
        dead: false,
        isDestroyed: () => win.dead,
        isMinimized: () => false,
        show() {},
        focus() {},
        destroy() {
          win.dead = true;
          win.emit('closed');
        },
        loadURL(url) {
          win.url = url;
          return Promise.resolve();
        }
      });
      win.webContents = new EventEmitter();
      Object.assign(win.webContents, {
        getURL: () => win.url,
        session: { setPermissionRequestHandler() {} },
        setWindowOpenHandler(handler) {
          win.popup = handler;
        }
      });
      return win;
    }
  });
  return service;
}
test('Known sites share existing login sessions; lookalike hosts stay separate', () => {
  assert.equal(siteForUrl('https://www.liblib.tv/profile')?.partition, 'persist:liblib');
  assert.equal(siteForUrl('https://space.bilibili.com/123')?.partition, 'persist:social-bilibili');
  assert.equal(siteForUrl('https://www.douyin.com.evil.test'), null);
});
test('Generic URLs and keywords open independent persistent windows and reject unsafe schemes', () => {
  const service = fixture(),
    first = service.open('test keywords');
  assert.match(first.url, /google.com\/search\?q=test%20keywords/);
  assert.equal(first.options.webPreferences.partition, 'persist:browser');
  assert.equal(service.open('test keywords'), first);
  assert.throws(() => service.open('javascript:alert(1)'));
  assert.throws(() => service.open(''));
  service.dispose();
  assert.equal(service.windows.size, 0);
});
test('Direct and social shortcuts use their corresponding persistent sessions', () => {
  const service = fixture();
  assert.equal(service.openPlatform('jimeng').options.webPreferences.partition, 'persist:jimeng');
  assert.equal(
    service.openSocial('douyin').options.webPreferences.partition,
    'persist:social-douyin'
  );
  assert.throws(() => service.openSocial('unknown'));
  service.dispose();
});
test('Cross-site navigation switches to the matching login session; OAuth popups keep their opener', () => {
  const service = fixture(),
    search = service.open('hello');
  assert.equal(search.controls.beforeNavigate('https://www.douyin.com/user/test'), false);
  assert.equal(service.windows.size, 2);
  let prevented = false;
  search.webContents.emit(
    'will-redirect',
    {
      preventDefault() {
        prevented = true;
      }
    },
    'https://www.liblib.tv/'
  );
  assert.equal(prevented, true);
  const handler = search.popup({ url: 'https://oauth.example.test/' });
  const contents = {};
  const popup = handler.createWindow({ webContents: contents });
  assert.ok(
    [...service.windows.keys()].some(
      (win) => win.webContents === popup && win.options.webContents === contents
    )
  );
  service.dispose();
});
