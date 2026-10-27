'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');
const {
  DOWNLOAD_CONCURRENCY_OPTIONS,
  readDownloadConcurrency,
  saveDownloadConcurrency
} = require('../../src/download-preference.cjs');
async function preferenceFile(t) {
  const root = path.resolve(__dirname, '../验收记录');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'test-download-preference-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'download-preference.json');
}
test('Download concurrency defaults to two and recovers missing, corrupt or unsupported preferences', async (t) => {
  const file = await preferenceFile(t);
  assert.equal(readDownloadConcurrency(file), 2);
  for (const content of ['{broken', 'null', '{}', '{"concurrency":9}', '{"concurrency":"4"}']) {
    await fs.writeFile(file, content);
    assert.equal(readDownloadConcurrency(file), 2);
  }
});
test('Every offered concurrency persists; a fresh process restores four and reset persists two', async (t) => {
  const file = await preferenceFile(t);
  assert.deepEqual(DOWNLOAD_CONCURRENCY_OPTIONS, [1, 2, 3, 4, 5, 6, 7, 8, 16]);
  for (const value of DOWNLOAD_CONCURRENCY_OPTIONS) {
    assert.equal(await saveDownloadConcurrency(file, value), value);
    assert.equal(readDownloadConcurrency(file), value);
  }
  await saveDownloadConcurrency(file, 4);
  const restored = execFileSync(
    process.execPath,
    [
      '-e',
      'process.stdout.write(String(require(process.argv[1]).readDownloadConcurrency(process.argv[2])))',
      require.resolve('../../src/download-preference.cjs'),
      file
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  assert.equal(restored, '4');
  await saveDownloadConcurrency(file, 2);
  assert.equal(readDownloadConcurrency(file), 2);
});
test('Unsupported values and failed writes do not replace a saved download preference', async (t) => {
  const file = await preferenceFile(t);
  await saveDownloadConcurrency(file, 4);
  for (const value of [0, -1, 9, 15, 17, 1.5, '4', null, NaN, Infinity])
    await assert.rejects(saveDownloadConcurrency(file, value), /下载并发数/);
  assert.equal(readDownloadConcurrency(file), 4);
  await assert.rejects(saveDownloadConcurrency(path.join(file, 'invalid.json'), 8));
  assert.equal(readDownloadConcurrency(file), 4);
});
