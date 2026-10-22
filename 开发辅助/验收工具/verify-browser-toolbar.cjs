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
      assert.equal(await evaluate('document.querySelectorAll("nav>button").length'), 4);
      assert.equal(await evaluate('document.querySelectorAll("[role=tab]").length'), 1);
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
      const firstId = win.browserToolbar.activeId;
      await page.executeJavaScript('window.retainedValue="网页状态"');
      toolbar.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
      toolbar.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control'] });
      await until(() => win.browserToolbar.tabs.size === 2);
      const secondId = win.browserToolbar.activeId;
      await until(
        async () =>
          await evaluate(
            'document.activeElement.id === "address" && document.getElementById("address").value === ""'
          )
      );
      await enter(origin + '/tab-two');
      await until(() => win.webContents.getURL() === origin + '/tab-two');
      assert.equal(win.webContents.session, ses);
      await win.webContents.executeJavaScript('window.secondValue=42');
      toolbar.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control', 'shift'] });
      toolbar.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['control', 'shift'] });
      await until(() => win.browserToolbar.activeId === firstId);
      assert.equal(win.webContents, page);
      assert.equal(await page.executeJavaScript('window.retainedValue'), '网页状态');
      await evaluate('window.browserToolbar.action("activate",' + JSON.stringify(secondId) + ')');
      assert.equal(await win.webContents.executeJavaScript('window.secondValue'), 42);
      await evaluate(
        'window.browserToolbar.action("reorder",' + JSON.stringify([secondId, firstId]) + ')'
      );
      assert.deepEqual([...win.browserToolbar.tabs.keys()], [secondId, firstId]);
      await evaluate('window.browserToolbar.action("close-tab",' + JSON.stringify(secondId) + ')');
      assert.equal(win.browserToolbar.tabs.size, 1);
      assert.equal(win.webContents, page);
      await evaluate('window.browserToolbar.action("restore-tab")');
      await until(() => win.webContents.getURL() === origin + '/tab-two');
      assert.equal(win.webContents.session, ses);
      await evaluate('window.browserToolbar.action("close-tab",' + JSON.stringify(secondId) + ')');
      record(
        'Ctrl+T creates and focuses an empty tab; tabs retain independent page state and sessions; switching, ordering, closing and restoring work'
      );
      locked = '正在读取画布';
      await until(async () => await evaluate('document.getElementById("address").readOnly'));
      const held = page.getURL();
      assert.equal(
        (await evaluate('window.browserToolbar.action("navigate","' + origin + '/one")')).ok,
        false
      );
      assert.equal(page.getURL(), held);
      assert.equal((await evaluate('window.browserToolbar.action("new-tab")')).ok, false);
      assert.equal(
        (
          await evaluate(
            'window.browserToolbar.action("close-tab",' + JSON.stringify(firstId) + ')'
          )
        ).ok,
        false
      );
      assert.equal(win.browserToolbar.tabs.size, 1);
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
      endTransparentRead(win, true);
      win.setFocusable(true);
      win.focus();
      await wait(100);
      page.devToolsWebContents.focus();
      await wait(150);
      // sendInputEvent on DevTools does not dispatch native menu accelerators.
      // Exercise that accelerator's actual callback with inspector focus instead.
      assert.equal(
        require('electron').webContents.getFocusedWebContents(),
        page.devToolsWebContents
      );
      require('electron').Menu.getApplicationMenu().getMenuItemById('devtools-f12').click();
      await until(() => !page.isDevToolsOpened());
      record(
        'F12 from address bar opens website developer tools; its native menu action closes the focused inspector'
      );
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
      assert.equal(bounds[0].y, 86);
      assert.equal(bounds[0].height, 514);
      assert.equal(bounds[1].height, 86);
      const metrics = await evaluate(
        '(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return {strip:r(".tabstrip").height,toolbar:r("nav").height,address:r("form").height,tab:r(".chrome-tab").height,overflow:document.documentElement.scrollWidth>innerWidth}})()'
      );
      assert.deepEqual(metrics, { strip: 42, toolbar: 44, address: 34, tab: 36, overflow: false });
      endTransparentRead(win);
      beginTransparentRead(win);
      assert.equal(win.getOpacity(), 0);
      record('Resize and transparent display retain toolbar and website layout');
      win.setContentSize(680, 600);
      for (let i = 0; i < 12; i++) win.browserToolbar.addTab({ url: 'about:blank' });
      await wait(100);
      const narrow = await evaluate(
        '(()=>{const p=document.getElementById("new-tab").getBoundingClientRect(),a=document.querySelector("form").getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,plusVisible:p.left>=0&&p.right<=innerWidth-138,addressVisible:a.left>=0&&a.right<=innerWidth}})()'
      );
      assert.deepEqual(narrow, { overflow: false, plusVisible: true, addressVisible: true });
      const ids = [...win.browserToolbar.tabs.keys()];
      for (const id of ids) if (id !== firstId) win.browserToolbar.closeTab(id);
      await win.browserToolbar.action('activate', firstId);
      win.setFullScreen(true);
      await until(() => win.isFullScreen());
      assert.equal(win.contentView.children[0].getBounds().y, 0);
      win.setFullScreen(false);
      await until(() => !win.isFullScreen());
      win.setContentSize(900, 600);
      record(
        'Narrow window with thirteen tabs keeps new-tab button and address visible; fullscreen uses all content space'
      );
      const out = path.resolve(__dirname, '../验收记录/v1.3/browser-toolbar');
      await fs.mkdir(out, { recursive: true });
      endTransparentRead(win, true);
      await wait(150);
      await fs.writeFile(
        path.join(out, 'unified-toolbar.png'),
        (await toolbar.capturePage()).toPNG()
      );
      win.destroy();
      await until(() => page.isDestroyed() && toolbar.isDestroyed());
      assert.equal(page.isDestroyed(), true);
      assert.equal(toolbar.isDestroyed(), true);
      assert.equal(BaseWindow.getAllWindows().includes(win), false);
      record('Closing window releases both renderers');
      console.log('PASS browser toolbar:', checks.join('; '));
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
