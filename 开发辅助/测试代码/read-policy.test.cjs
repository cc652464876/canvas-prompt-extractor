'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { reuseWorkPage, sameWorkUrl, reusableDocument } = require('../../src/read-policy.cjs');
const vm = require('node:vm');
const requestedUrl = 'https://www.liblib.tv/detail/test';
const base = {
  requestedUrl,
  platform: 'liblib',
  attempt: { platform: 'liblib', inputUrl: requestedUrl, resolvedUrl: requestedUrl },
  windowUrl: requestedUrl + '#canvas',
  windowPlatform: 'liblib',
  windowAvailable: true
};
test('The main read action reuses the same work after manual login/dialog handling', () => {
  assert.equal(reuseWorkPage(base), true);
  assert.equal(sameWorkUrl(requestedUrl, requestedUrl + '/'), true);
});
test('A different work, platform, closed window or homepage always opens the requested link', () => {
  for (const change of [
    { requestedUrl: 'https://www.liblib.tv/detail/other' },
    { windowPlatform: 'jimeng' },
    { windowAvailable: false },
    { windowUrl: 'https://www.liblib.tv/' },
    { windowUrl: 'https://www.liblib.tv/detail/other' },
    { attempt: null }
  ])
    assert.equal(reuseWorkPage({ ...base, ...change }), false);
});
test('Only a recorded redirect target can be reused for a shared link', () => {
  const target = 'https://www.liblib.tv/canvas/test';
  assert.equal(
    reuseWorkPage({
      ...base,
      attempt: { ...base.attempt, resolvedUrl: target },
      windowUrl: target
    }),
    true
  );
  assert.equal(reuseWorkPage({ ...base, windowUrl: target }), false);
  assert.equal(sameWorkUrl(target + '?id=a', target + '?id=b'), false);
});
test('Blank, loading and browser error documents cannot be reused; login pages and canvases can', () => {
  const check = ({
    text = '',
    canvas = false,
    readyState = 'complete',
    protocol = 'https:',
    body = true
  } = {}) =>
    vm.runInNewContext('(' + reusableDocument.toString() + ')()', {
      location: { protocol },
      document: {
        readyState,
        body: body ? { innerText: text } : null,
        querySelector: () => (canvas ? {} : null)
      }
    });
  assert.equal(check(), false);
  assert.equal(check({ text: '  \n ' }), false);
  assert.equal(check({ text: '欢迎登录', readyState: 'loading' }), false);
  assert.equal(check({ text: 'ERR_CONNECTION_RESET', protocol: 'chrome-error:' }), false);
  assert.equal(
    check({
      text: 'upstream connect error or disconnect/reset before headers. reset reason: connection termination'
    }),
    false
  );
  assert.equal(check({ body: false }), false);
  assert.equal(check({ text: '欢迎登录，请输入手机号', readyState: 'interactive' }), true);
  assert.equal(check({ canvas: true }), true);
});
