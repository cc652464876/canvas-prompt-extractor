'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  http = require('node:http'),
  zlib = require('node:zlib');
const { DownloadQueue } = require('../../src/download-queue.cjs');
const wav = Buffer.alloc(65580);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24);
wav.writeUInt32LE(48000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
async function setup(t, fetcher) {
  const root = path.resolve(__dirname, '../验收记录');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'test-download-length-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const asset = {
    id: 'audio',
    kind: 'audio',
    url: 'https://cdn.example.com/audio.wav',
    fileName: 'audio.wav',
    state: 'pending'
  };
  const queue = new DownloadQueue({
    fetcher,
    filePath: (a) => path.join(dir, a.fileName),
    interval: 0,
    retryDelays: []
  });
  return { asset, queue, dir };
}
for (const [encoding, compress] of [
  ['gzip', zlib.gzipSync],
  ['br', zlib.brotliCompressSync],
  ['deflate', zlib.deflateSync]
]) {
  test(`HTTP ${encoding} saves decoded WAV despite the smaller encoded Content-Length`, async (t) => {
    const encoded = compress(wav);
    assert.ok(encoded.length < wav.length);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': encoding,
        'content-length': encoded.length
      });
      res.end(encoded);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
    const { queue, asset, dir } = await setup(t, async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/audio.wav`);
      assert.equal(Number(response.headers.get('content-length')), encoded.length);
      return response;
    });
    const summary = await queue.start([asset], ['audio']);
    assert.equal(summary.done, 1);
    assert.equal(asset.total, wav.length);
    assert.equal(asset.savedBytes, wav.length);
    assert.deepEqual(await fs.readFile(path.join(dir, asset.fileName)), wav);
    assert.deepEqual(await fs.readdir(dir), ['audio.wav']);
  });
}
for (const encoding of ['', ' IDENTITY ']) {
  test(`Uncompressed response (${encoding || 'no encoding'}) retains size validation`, async (t) => {
    const { queue, asset, dir } = await setup(
      t,
      async () =>
        new Response(wav, {
          headers: {
            'content-type': 'audio/wav',
            'content-encoding': encoding,
            'content-length': String(wav.length)
          }
        })
    );
    await queue.start([asset], ['audio']);
    assert.equal(asset.state, 'done');
    assert.deepEqual(await fs.readFile(path.join(dir, asset.fileName)), wav);
  });
}
for (const expected of [wav.length - 1, wav.length + 1]) {
  test(`Uncompressed length mismatch (${expected}) fails and removes partial data`, async (t) => {
    const { queue, asset, dir } = await setup(
      t,
      async () =>
        new Response(wav, {
          headers: { 'content-type': 'audio/wav', 'content-length': String(expected) }
        })
    );
    await queue.start([asset], ['audio']);
    assert.equal(asset.state, 'failed');
    assert.match(asset.error, /文件大小校验失败/);
    assert.ok(asset.error.includes(String(expected)));
    assert.deepEqual(await fs.readdir(dir), []);
  });
}
test('Interrupted decoded stream fails and removes partial data', async (t) => {
  let sent = false;
  const { queue, asset, dir } = await setup(
    t,
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(wav.subarray(0, 100));
            } else controller.error(new Error('Interrupted compressed response'));
          }
        }),
        {
          headers: {
            'content-type': 'audio/wav',
            'content-encoding': 'gzip',
            'content-length': '50'
          }
        }
      )
  );
  await queue.start([asset], ['audio']);
  assert.equal(asset.state, 'failed');
  assert.deepEqual(await fs.readdir(dir), []);
});
test('Response without Content-Length saves complete bytes', async (t) => {
  const { queue, asset, dir } = await setup(
    t,
    async () => new Response(wav, { headers: { 'content-type': 'audio/wav' } })
  );
  await queue.start([asset], ['audio']);
  assert.equal(asset.state, 'done');
  assert.equal(asset.total, wav.length);
  assert.deepEqual(await fs.readFile(path.join(dir, asset.fileName)), wav);
});
