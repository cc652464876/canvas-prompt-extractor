'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browserAddress, isBrowserAddress } = require('../../src/browser-address.cjs');
test('Address bar accepts complete URLs, bare hosts, ports and blank pages', () => {
  assert.equal(
    browserAddress(' https://www.liblib.tv/profile?uuid=abc '),
    'https://www.liblib.tv/profile?uuid=abc'
  );
  assert.equal(browserAddress('google.com'), 'https://google.com/');
  assert.equal(browserAddress('example.com:8080/path'), 'https://example.com:8080/path');
  assert.equal(browserAddress('http://127.0.0.1:8842/test'), 'http://127.0.0.1:8842/test');
  assert.equal(browserAddress('about:blank'), 'about:blank');
  assert.equal(browserAddress(''), 'about:blank');
});
test('Search queries use Google with correct escaping', () => {
  const query = '诡界游记 第五集 & 图片';
  assert.equal(new URL(browserAddress(query)).searchParams.get('q'), query);
  assert.equal(new URL(browserAddress('LibTV')).hostname, 'www.google.com');
});
test('Address bar rejects executable URLs and embedded credentials', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///C:/private',
    'ftp://example.com/',
    'https://name:password@example.com'
  ])
    assert.throws(() => browserAddress(value));
  for (const value of [
    'javascript:alert(1)',
    'file:///C:/private',
    'https://name:password@example.com',
    'not a URL'
  ])
    assert.equal(isBrowserAddress(value), false);
  assert.equal(isBrowserAddress('https://example.com/path'), true);
});
