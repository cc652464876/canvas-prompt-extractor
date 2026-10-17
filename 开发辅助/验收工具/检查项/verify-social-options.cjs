'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, session } = require('electron');
const { AuthorProfiles } = require('../../../src/services/author-profiles.cjs');
const { socialAddress } = require('../../../src/author-profiles.cjs');
const { readSocialPreference } = require('../../../src/social-preference.cjs');
module.exports = async ({ root, ui, authorProfiles, socialPreferencePath }) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3/social-options');
  await fs.mkdir(out, { recursive: true });
  const evaluate = (script) => ui.webContents.executeJavaScript(script);
  const report = { passed: false, checks: [] };
  const isolated = session.fromPartition('social-overlay-verification');
  const link = socialAddress('https://www.douyin.com/user/MS4wLjAB_overlay_fixture');
  let windowsOpened = 0;
  const service = new AuthorProfiles({
    fetcher: () => {
      throw new Error('Unexpected external request');
    },
    createWindow: () => {
      windowsOpened++;
      return new BrowserWindow({
        show: false,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          session: isolated,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      });
    }
  });
  // A public owner header loads after a login overlay, while a resource keeps
  // the page loading. This exercises actual Chromium DOM and mainFrame reads.
  isolated.protocol.handle('https', (request) => {
    if (request.url.endsWith('/pending.png')) return new Promise(() => {});
    return new Response(
      `<!doctype html><meta charset="utf-8">
      <h1>登录后免费畅享高清视频</h1><div id="owner"></div><img src="/pending.png">
      <script>setTimeout(()=>{document.getElementById('owner').innerHTML = '<div id="user_detail_element"><div data-e2e="user-info"><h1>公开作者</h1><div data-e2e="user-info-follow">关注<br>187</div><div data-e2e="user-info-fans">粉丝<br>32</div><div data-e2e="user-info-like">获赞<br>95</div><p>抖音号：97693988107<br>IP属地：广东</p><div>作者公开简介</div></div></div>';},900);</script>`,
      { headers: { 'content-type': 'text/html;charset=utf-8' } }
    );
  });
  try {
    assert.equal(authorProfiles.enabled, false);
    assert.equal(
      await evaluate('document.getElementById("social-profiles-enabled").checked'),
      false
    );
    const onlyLinks = await service.bundle({
      socialLinks: [socialAddress('https://v.douyin.com/example/')]
    });
    assert.equal(windowsOpened, 0);
    assert.equal(onlyLinks.socialLinks[0].status, 'link-only');
    report.checks.push('Default unchecked; no external short-link requests or browser windows');
    await evaluate('document.getElementById("social-profiles-enabled").click()');
    for (let index = 0; index < 40; index++) {
      if (
        authorProfiles.enabled &&
        (await evaluate('!document.getElementById("social-profiles-enabled").disabled'))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(authorProfiles.enabled, true);
    assert.equal(readSocialPreference(socialPreferencePath), true);
    assert.equal((await evaluate('window.lab.info()')).value.socialProfilesEnabled, true);
    report.checks.push('Checkbox enables backend access and persists true');
    service.setEnabled(true);
    const value = await service.link(link, new AbortController().signal);
    assert.equal(value.displayName, '公开作者');
    assert.equal(value.accountId, '97693988107');
    assert.equal(value.bio, '作者公开简介');
    assert.deepEqual(value.metrics, { followers: '32', following: '187', likes: '95' });
    assert.equal(value.status, 'read');
    assert.match(value.note, /登录弹窗/);
    assert.equal(service.windows.size, 0);
    report.overlayProfile = value;
    report.checks.push(
      'Delayed public header is read under login overlay without waiting for full page load'
    );
    await evaluate('document.getElementById("social-profiles-enabled").click()');
    for (let index = 0; index < 40; index++) {
      if (
        !authorProfiles.enabled &&
        (await evaluate('!document.getElementById("social-profiles-enabled").disabled'))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(authorProfiles.enabled, false);
    assert.equal(readSocialPreference(socialPreferencePath), false);
    report.checks.push('Checkbox disables backend access and persists false');
    await evaluate('document.getElementById("theme-toggle").click()');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fs.writeFile(
      path.join(out, 'settings.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    report.passed = true;
    console.log('PASS social options:', report.checks.join('; '));
  } finally {
    service.dispose();
    isolated.protocol.unhandle('https');
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
};
