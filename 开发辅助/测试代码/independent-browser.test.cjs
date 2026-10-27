'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  IndependentBrowser,
  siteForUrl,
  browserUserAgent,
  isGoogleLogin
} = require('../../src/services/independent-browser.cjs');
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
test('Google login stays in the shared browser session and hides the Electron user agent', () => {
  assert.equal(siteForUrl('https://accounts.google.com/'), null);
  assert.equal(isGoogleLogin('https://accounts.google.com/ServiceLogin'), true);
  assert.equal(isGoogleLogin('https://accounts.google.com.evil.test/'), false);
  const original =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Electron/44.5.1 Safari/537.36';
  assert.equal(browserUserAgent(original).includes('Electron'), false);
  let agent = original,
    headerHook;
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
          return win.webContents.loadURL(url);
        }
      });
      win.webContents = new EventEmitter();
      Object.assign(win.webContents, {
        getURL: () => win.url,
        getUserAgent: () => agent,
        setUserAgent(value) {
          agent = value;
        },
        session: {
          setPermissionRequestHandler() {},
          webRequest: {
            onBeforeSendHeaders(_filter, hook) {
              headerHook = hook;
            }
          }
        },
        setWindowOpenHandler() {},
        loadURL(url) {
          win.url = url;
          return Promise.resolve();
        }
      });
      return win;
    }
  });
  const google = service.open('https://accounts.google.com/');
  assert.equal(google.options.webPreferences.partition, 'persist:browser');
  assert.equal(google.controls.beforeNavigate('https://myaccount.google.com/'), true);
  assert.equal(service.windows.size, 1);
  assert.equal(agent.includes('Electron'), false);
  const headers = {
    'User-Agent': original,
    'sec-ch-ua': '"Chromium";v="138", "Electron";v="44"'
  };
  headerHook({ requestHeaders: headers }, (value) => {
    headers.sent = value.requestHeaders;
  });
  assert.equal(headers.sent['User-Agent'].includes('Electron'), false);
  assert.equal(headers.sent['sec-ch-ua'], '"Chromium";v="138"');
  service.dispose();
});
