'use strict';
const { app, session, BrowserWindow, BaseWindow } = require('electron');
const fs = require('node:fs/promises'),
  fsSync = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const { createBrowserWindow } = require('../../src/browser-window.cjs');
const { installDevToolsMenu } = require('../../src/devtools-shortcut.cjs');
const { beginTransparentRead, endTransparentRead } = require('../../src/platform-presentation.cjs');
app.setPath('userData', fsSync.mkdtempSync(path.join(os.tmpdir(), 'canvas-toolbar-check-')));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
setTimeout(() => {
  console.error('Native verification exceeded deadline');
  app.exit(1);
}, 20000).unref();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await wait(50);
  }
  throw new Error('Verification timed out');
}
app
  .whenReady()
  .then(async () => {
    installDevToolsMenu();
    const counts = {},
      checks = [];
    const record = (...items) => {
      checks.push(...items);
      console.log('PASS', ...items);
    };
    const server = http.createServer((request, response) => {
      counts[request.url] = (counts[request.url] || 0) + 1;
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/two' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
      response.end(
        '<!doctype html><title>浏览器验收</title><h1>' +
          request.url +
          '</h1><a href="/two">下一页</a>'
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const ses = session.fromPartition('toolbar-native-test');
    ses.protocol.handle(
      'https',
      (request) =>
        new Response(
          '<title>搜索验收</title><h1>' + new URL(request.url).searchParams.get('q') + '</h1>',
          { headers: { 'content-type': 'text/html;charset=utf-8' } }
        )
    );
    let locked = '';
    const win = createBrowserWindow(
      {
        show: false,
        width: 1100,
        height: 760,
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false
        }
      },
      { homeUrl: origin + '/home', blocked: () => locked }
    );
    beginTransparentRead(win);
    const page = win.webContents,
      toolbar = win.browserToolbar.webContents;
    const evaluate = (code) => toolbar.executeJavaScript(code);
    async function enter(text) {
      await evaluate(
        'document.getElementById("address").focus();document.getElementById("address").value=' +
          JSON.stringify(text) +
          ';document.getElementById("address").dispatchEvent(new Event("input",{bubbles:true}))'
      );
      toolbar.focus();
      toolbar.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      toolbar.sendInputEvent({ type: 'char', keyCode: '\r' });
      toolbar.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    try {
      await win.loadURL(origin + '/one');
      await until(
        async () =>
          (await evaluate(
            '!!window.browserToolbar && document.getElementById("address").value'
          )) ===
          origin + '/one'
      );
      assert.equal(BrowserWindow.fromWebContents(page), win);
      assert.equal(page.session, ses);
      assert.equal(await page.executeJavaScript('typeof window.browserToolbar'), 'undefined');
      assert.equal(await evaluate('document.querySelectorAll("button").length'), 4);
      record(
        'Original session and page ownership preserved; four navigation buttons with no submit button'
      );
      await enter(origin + '/redirect');
      await until(() => page.getURL() === origin + '/two');
      await until(
        async () => (await evaluate('document.getElementById("address").value')) === origin + '/two'
      );
      record('Enter navigates; redirects update the current address');
      await evaluate('document.getElementById("back").click()');
      await until(() => page.getURL() === origin + '/one');
      await until(async () => !(await evaluate('document.getElementById("forward").disabled')));
      await evaluate('document.getElementById("forward").click()');
      await until(() => page.getURL() === origin + '/two');
      const previous = counts['/two'];
      await evaluate('document.getElementById("reload").click()');
      await until(() => counts['/two'] > previous);
      await evaluate('document.getElementById("home").click()');
      await until(() => page.getURL() === origin + '/home');
      record('Back, forward, reload and platform home work');
      await page.executeJavaScript('history.pushState({},"","/spa")');
      await until(
        async () => (await evaluate('document.getElementById("address").value')) === origin + '/spa'
      );
      await enter('画布测试 & 图片');
      await until(() => page.getURL().startsWith('https://www.google.com/search?'));
      assert.equal(new URL(page.getURL()).searchParams.get('q'), '画布测试 & 图片');
      record('Same-document navigation updates address; keywords submit to Google');
      locked = '正在读取画布';
      await until(async () => await evaluate('document.getElementById("address").readOnly'));
      const held = page.getURL();
      assert.equal(
        (await evaluate('window.browserToolbar.action("navigate","' + origin + '/one")')).ok,
        false
      );
      assert.equal(page.getURL(), held);
      locked = '';
      await until(async () => !(await evaluate('document.getElementById("address").readOnly')));
      assert.equal(win.browserToolbar.state().error, '');
      record('Extraction locks controls and backend navigation, then restores them');
      await win.loadURL(origin + '/home');
      toolbar.sendInputEvent({ type: 'keyDown', keyCode: 'F12' });
      toolbar.sendInputEvent({ type: 'keyUp', keyCode: 'F12' });
      await until(() => page.isDevToolsOpened());
      assert.equal(toolbar.isDevToolsOpened(), false);
      await until(() => page.devToolsWebContents && !page.devToolsWebContents.isLoading());
      win.setFocusable(true);
      win.focus();
      page.devToolsWebContents.focus();
      page.devToolsWebContents.sendInputEvent({ type: 'keyDown', keyCode: 'F12' });
      await until(() => !page.isDevToolsOpened());
      record('F12 from address bar opens website developer tools and closes from inspector focus');
      let child;
      page.setWindowOpenHandler(() => ({
        action: 'allow',
        createWindow: (options) => {
          child = createBrowserWindow({ ...options, show: false }, { homeUrl: origin + '/home' });
          return child.webContents;
        }
      }));
      await page.mainFrame.executeJavaScript(
        'window.open(' + JSON.stringify(origin + '/popup') + ');void 0',
        true
      );
      await until(() => child?.webContents.getURL() === origin + '/popup');
      assert.equal(child.webContents.session, ses);
      assert.ok(child.browserToolbar);
      child.destroy();
      record('Website-created popup keeps navigation toolbar and parent session');
      win.setContentSize(900, 600);
      await wait(100);
      const bounds = win.contentView.children.map((view) => view.getBounds());
      assert.equal(bounds[0].y, 48);
      assert.equal(bounds[0].height, 552);
      assert.equal(bounds[1].height, 48);
      endTransparentRead(win);
      beginTransparentRead(win);
      assert.equal(win.getOpacity(), 0);
      record('Resize and transparent display retain toolbar and website layout');
      win.destroy();
      await until(() => page.isDestroyed() && toolbar.isDestroyed());
      assert.equal(page.isDestroyed(), true);
      assert.equal(toolbar.isDestroyed(), true);
      assert.equal(BaseWindow.getAllWindows().includes(win), false);
      record('Closing window releases both renderers');
      console.log('PASS browser toolbar:', checks.join('; '));
      const out = path.resolve(__dirname, '../验收记录/v1.3/browser-toolbar');
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(
        path.join(out, 'report.json'),
        JSON.stringify({ passed: true, checks }, null, 2)
      );
    } finally {
      if (!win.isDestroyed()) win.destroy();
      ses.protocol.unhandle('https');
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error.stack);
    app.exit(1);
  });
