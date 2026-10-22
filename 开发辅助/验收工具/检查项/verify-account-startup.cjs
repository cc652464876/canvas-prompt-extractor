'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { verificationPath } = require('../../../src/app-paths.cjs');
const { listPlatforms } = require('../../../src/platforms/registry.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({ ui, accounts, independentBrowser, getWindow, session, root }) => {
  const out = verificationPath(root, 'independent-browser'),
    checks = [],
    run = (code) => ui.webContents.executeJavaScript(code);
  await fs.mkdir(out, { recursive: true });
  const until = async (predicate) => {
    for (let i = 0; i < 180; i++) {
      if (await predicate()) return;
      await wait(25);
    }
    throw new Error('Independent browser verification timed out');
  };
  const check = (name) => {
    checks.push(name);
    console.log('PASS ' + name);
  };
  await run(
    "window.__accountEvents=0;window.lab.onEvent(event=>{if(event.type==='account')window.__accountEvents++;});void 0"
  );
  const partitions = [
    'liblib',
    'jimeng',
    'rhtv',
    'tapnow',
    'social-xiaohongshu',
    'social-douyin',
    'social-bilibili',
    'browser'
  ];
  for (const id of partitions)
    session
      .fromPartition('persist:' + id)
      .protocol.handle(
        'https',
        () =>
          new Response(
            '<!doctype html><title>浏览测试</title><body>公开页面 · 登录资料保存在当前会话</body>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } }
          )
      );
  try {
    await until(() => run("document.querySelectorAll('#platform-shortcuts button').length===4"));
    assert.equal(accounts.entries.size, 0);
    assert.equal(independentBrowser.windows.size, 0);
    assert.equal(await run("document.querySelectorAll('header [id^=login-]').length"), 0);
    await run("document.getElementById('theme-toggle').click()");
    assert.equal(
      await run(
        "(()=>{const p=document.getElementById('platform-shortcuts'),s=document.querySelector('.social-login-actions'),f=document.getElementById('browser-search-form');return Boolean(p.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(s.compareDocumentPosition(f)&Node.DOCUMENT_POSITION_FOLLOWING)&&!f.querySelector('button');})()"
      ),
      true
    );
    check('Platform shortcuts moved into settings above social logins and Enter-only search');
    const shortcutSizes = await run(
      `Array.from(document.querySelectorAll('#platform-shortcuts button,.social-login-actions button')).map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,width:r.width,height:r.height}})`
    );
    assert.equal(shortcutSizes.length, 8);
    assert.deepEqual(
      shortcutSizes.slice(4).map((b) => b.text),
      ['Midjourney登录', '小红书登录', '抖音登录', 'B站登录']
    );
    for (const button of shortcutSizes) {
      assert.ok(Math.abs(button.width - shortcutSizes[0].width) < 1);
      assert.equal(button.height, shortcutSizes[0].height);
    }
    ui.show();
    ui.focus();
    await wait(200);
    await fs.writeFile(
      path.join(out, 'eight-shortcuts.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    await run(`document.querySelector('[data-browser-login]').click()`);
    await until(() =>
      [...independentBrowser.windows.keys()].some(
        (w) => w.webContents.getURL() === 'https://www.midjourney.com/'
      )
    );
    const mjWindow = [...independentBrowser.windows.keys()].find(
      (w) => w.webContents.getURL() === 'https://www.midjourney.com/'
    );
    assert.equal(mjWindow.webContents.session, session.fromPartition('persist:browser'));
    mjWindow.destroy();
    ui.show();
    ui.focus();
    check(
      'Eight equal-size shortcuts include Midjourney login before Xiaohongshu, sharing the built-in job browser session'
    );
    await run(
      "document.getElementById('browser-search').value='example.org';document.getElementById('browser-search').dispatchEvent(new Event('input',{bubbles:true}))"
    );
    await wait(100);
    assert.equal(independentBrowser.windows.size, 0);
    await run("document.getElementById('browser-search').focus()");
    ui.webContents.focus();
    for (const event of [
      { type: 'keyDown', keyCode: 'Return' },
      { type: 'char', keyCode: '\r' },
      { type: 'keyUp', keyCode: 'Return' }
    ])
      ui.webContents.sendInputEvent(event);
    await until(() => independentBrowser.windows.size === 1);
    const generic = [...independentBrowser.windows.keys()][0];
    await until(() => generic.webContents.getURL() === 'https://example.org/');
    assert.equal(generic.webContents.session, session.fromPartition('persist:browser'));
    check(
      'Typing alone does not navigate; actual Enter opens arbitrary URL in independent browser'
    );
    const search = await run("window.lab.openBrowser('自由画布 搜索')");
    assert.equal(search.ok, true);
    await until(() =>
      [...independentBrowser.windows.keys()].some((w) =>
        w.webContents.getURL().includes('google.com/search?q=')
      )
    );
    check('Keywords open Google search with existing navigation toolbar');
    await session.fromPartition('persist:liblib').cookies.set({
      url: 'https://www.liblib.tv',
      name: 'login-fixture',
      value: 'session-retained'
    });
    for (const { id } of listPlatforms())
      assert.equal((await run('window.lab.login(' + JSON.stringify(id) + ')')).ok, true);
    for (const id of ['xiaohongshu', 'douyin', 'bilibili'])
      assert.equal((await run('window.lab.socialLogin(' + JSON.stringify(id) + ')')).ok, true);
    await until(() => independentBrowser.windows.size === 9);
    for (const id of partitions)
      assert.ok(
        [...independentBrowser.windows.values()].some((v) => v.partition === 'persist:' + id)
      );
    const lib = [...independentBrowser.windows].find(
      ([, v]) => v.partition === 'persist:liblib'
    )[0];
    await until(() => lib.webContents.getURL().includes('liblib.tv'));
    assert.equal((await lib.webContents.session.cookies.get({ name: 'login-fixture' })).length, 1);
    lib.destroy();
    assert.equal((await run("window.lab.login('liblib')")).ok, true);
    assert.equal(
      (await session.fromPartition('persist:liblib').cookies.get({ name: 'login-fixture' })).length,
      1
    );
    assert.equal(accounts.entries.size, 0);
    assert.ok(!getWindow());
    check(
      'Seven site shortcuts reuse existing persistent sessions and preserve login after closing'
    );
    for (const visible of [false, true, false]) {
      assert.equal((await run('window.lab.visible(' + visible + ')')).ok, true);
      for (const win of independentBrowser.windows.keys()) {
        assert.equal(win.isVisible(), true);
        assert.equal(win.getOpacity(), 1);
      }
    }
    check('Show/hide platform never hides or makes independent browsing windows transparent');
    const genericPage = generic.webContents;
    await genericPage.executeJavaScript(
      "window.open('https://oauth.example.test/login');void 0",
      true
    );
    await until(() => generic.browserToolbar.tabs.size === 2);
    assert.equal(independentBrowser.windows.size, 9);
    let popup;
    await until(() => {
      popup = generic.webContents;
      return popup.getURL().includes('oauth.example.test') && !popup.isLoading();
    });
    assert.equal(popup.session, genericPage.session);
    assert.equal(await popup.executeJavaScript('Boolean(window.opener)'), true);
    assert.ok(generic.browserToolbar);
    await genericPage.executeJavaScript(
      "location.href='https://www.douyin.com/user/browser-fixture';void 0"
    );
    await until(() =>
      [...independentBrowser.windows.keys()].some((w) =>
        w.webContents.getURL().includes('/user/browser-fixture')
      )
    );
    const target = [...independentBrowser.windows.keys()].find((w) =>
      w.webContents.getURL().includes('/user/browser-fixture')
    );
    assert.equal(target.webContents.session, session.fromPartition('persist:social-douyin'));
    assert.equal(genericPage.getURL(), 'https://example.org/');
    check(
      'OAuth popups retain opener and toolbar; platform links reuse the matching login session'
    );
    generic.focus();
    generic.webContents.reload();
    await run("document.dispatchEvent(new Event('visibilitychange'))");
    await wait(2300);
    assert.equal(await run('window.__accountEvents'), 0);
    assert.doesNotMatch(
      await fs.readFile(path.join(root, 'src/main.cjs'), 'utf8'),
      /inspectAccount|lab:login-state/
    );
    assert.equal(await run('typeof window.lab.loginState'), 'undefined');
    assert.equal(
      await run("document.querySelectorAll('.account-status,.account-avatar').length"),
      0
    );
    check('No periodic, load, focus or visibility-triggered login-state monitoring remains');
    ui.show();
    ui.focus();
    ui.setSize(1000, 1100);
    await run("document.getElementById('browser-search').scrollIntoView({block:'center'})");
    await wait(200);
    await fs.writeFile(
      path.join(out, 'settings.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    ui.setSize(680, 700);
    await wait(100);
    assert.equal(
      await run(
        "document.getElementById('appearance-dialog').scrollWidth>document.getElementById('appearance-dialog').clientWidth+1"
      ),
      false
    );
    check('Settings layout fits narrow windows without horizontal overflow');
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify({ passed: true, checks }, null, 2)
    );
  } catch (error) {
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify({ passed: false, checks, error: error.stack }, null, 2)
    );
    throw error;
  } finally {
    independentBrowser.dispose();
  }
};
