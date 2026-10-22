'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const id = '170a5024-1733-44d0-8f4c-bd71515b2316';
const url = 'https://www.midjourney.com/jobs/' + id;

test('Image job link uses the current metadata and accepts valid MJ Job IDs only', async () => {
  const { midjourneyJobUrl } = await import('../../src/ui/image-info.js');
  for (const info of [
    { fullText: '祭台 --ar 7:3 --v 8.2 Job ID: ' + id },
    { parameters: '--raw Job ID: ' + id.toUpperCase() },
    { descriptions: [{ text: 'Job ID：' + id }] },
    { brand: 'Midjourney（参数特征推测）', raw: { 'XMP-iptcExt:DigitalImageGUID': id } }
  ])
    assert.equal(midjourneyJobUrl(info), url);
  for (const info of [
    {},
    { fullText: 'Job ID: 6ac8f48208e635c2f30eb6d6' },
    { fullText: 'Job ID: ' + id + 'abcdef' },
    { fullText: 'Job ID: ' + id + '-extra' },
    { fullText: 'Job ID: https://example.com/' + id },
    { raw: { 'XMP-iptcExt:DigitalImageGUID': id } },
    { brand: 'Midjourney', raw: { 'XMP-iptcExt:DigitalImageGUID': 'invalid' } }
  ])
    assert.equal(midjourneyJobUrl(info), '');
});
