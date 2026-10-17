'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { createMediaFetcher } = require('../../src/services/media-fetcher.cjs');
test('A media request remains bound to its original project session across switching and redirects', async () => {
  const calls = [],
    session = {
      fromPartition: (partition) => ({
        fetch: async (url, options) => {
          calls.push({ partition, url, options });
          return 'response';
        }
      })
    };
  const metadata = { platform: 'liblib', canvasUrl: 'https://www.liblib.tv/canvas/work' };
  const lib = createMediaFetcher({ session, metadata });
  metadata.platform = 'jimeng';
  metadata.canvasUrl = 'https://jimeng.jianying.com/ai-canvas/next';
  const jim = createMediaFetcher({ session, metadata });
  await lib('https://cdn.example.com/initial');
  await jim('https://cdn.example.com/other');
  await lib('https://cdn.example.com/redirected', { headers: { Range: 'bytes=0-32' } });
  assert.deepEqual(
    calls.map((c) => c.partition),
    ['persist:liblib', 'persist:jimeng', 'persist:liblib']
  );
  assert.equal(calls[2].options.headers.Referer, 'https://www.liblib.tv/');
  assert.equal(calls[2].options.headers.Range, 'bytes=0-32');
  assert.equal(calls[1].options.headers.Referer, 'https://jimeng.jianying.com/');
});
