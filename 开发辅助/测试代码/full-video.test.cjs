'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { inspectWork } = require('../../src/platforms/liblib/reader.cjs');
const { normalize } = require('../../src/normalize.cjs');
const { DownloadQueue } = require('../../src/download-queue.cjs');
const { ProjectStore } = require('../../src/project-store.cjs');
const { loadLocalProject } = require('../../src/local-project.cjs');
const inputUrl = 'https://www.liblib.tv/detail/current';
const url = 'https://libtv-res.liblib.art/current.mp4';
function inspect(project, pathname = '/detail/current') {
  const video = { duration: 69.6, videoWidth: 1920, videoHeight: 1080, getClientRects: () => [{}] };
  const stage = {
    __reactFiber_fixture: {
      memoizedProps: {
        project,
        items: [{ id: 'other', finalOutput: 'https://cdn.example.com/other.mp4' }]
      },
      return: null
    }
  };
  return vm.runInNewContext('(' + inspectWork.toString() + ')()', {
    URL,
    location: { href: inputUrl, pathname, protocol: 'https:' },
    document: {
      body: { innerText: '' },
      querySelectorAll: (selector) => (selector === 'video' ? [video] : []),
      querySelector: (selector) => (selector === '[data-project-detail-stage]' ? stage : null)
    }
  });
}
const project = { id: 'current', title: '作品:测试', nickname: '作者', finalOutput: url };
const makeResult = () =>
  normalize(
    {
      nodes: [{ id: 'clip', type: 'video', data: { name: '片段', url: [url] } }],
      edges: [],
      fullVideo: inspect(project).fullVideo
    },
    { platform: 'liblib', inputUrl, title: '作品:测试' }
  );
test('Detail reader keeps the original MP4 and rejects other works, playlists and invalid sources', () => {
  const work = inspect(project);
  assert.equal(work.fullVideo.url, url);
  assert.equal(work.fullVideo.duration, 69.6);
  assert.equal(work.title, project.title);
  assert.equal(work.author, project.nickname);
  for (const p of [
    { ...project, id: 'other' },
    { ...project, finalOutput: 'blob:' + url },
    { ...project, finalOutput: 'https://cdn.example.com/master.m3u8' },
    { ...project, finalOutput: 'https://[' }
  ])
    assert.equal(inspect(p).fullVideo, undefined);
  assert.equal(inspect(project, '/canvas').fullVideo, undefined);
});
test('Complete video leads the video queue, keeps a separate identity and survives offline reopening', async (t) => {
  const result = makeResult();
  const [full, clip] = result.assets;
  assert.equal(full.role, 'full-video');
  assert.equal(full.name, '_完整视频_作品 测试');
  assert.equal(full.fileName, full.name + '.mp4');
  assert.equal(clip.fileName, '视频_0001_片段.mp4');
  assert.notEqual(full.id, clip.id);
  assert.deepEqual(full.associatedTexts, []);
  const root = path.resolve(__dirname, '../验收记录');
  const dir = await fs.mkdtemp(path.join(root, 'test-full-video-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), root);
    assert.ok(path.basename(dir).startsWith('test-full-video-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = new ProjectStore(dir);
  await store.create(result, { mode: 'full' }, false);
  const mp4 = Buffer.alloc(32);
  mp4.writeUInt32BE(32, 0);
  mp4.write('ftypisom', 4);
  const calls = [];
  const queue = new DownloadQueue({
    interval: 0,
    concurrency: 1,
    filePath: (a) => {
      calls.push(a.role);
      return store.assetPath(a);
    },
    fetcher: async () =>
      new Response(mp4, {
        headers: { 'content-type': 'video/mp4', 'content-length': String(mp4.length) }
      })
  });
  const progress = await queue.start(result.assets, ['video']);
  assert.equal(progress.done, 2);
  assert.equal(calls[0], 'full-video');
  await store.checkpoint();
  const local = await loadLocalProject(store.directory);
  assert.equal(local.result.assets[0].role, 'full-video');
  assert.equal(local.result.assets[0].state, 'done');
  assert.equal(local.result.assets[0].fileName, full.fileName);
  await store.create(makeResult(), { mode: 'full' }, false);
  assert.equal(store.result.assets[0].state, 'done');
});
test('Asset filters pin complete video first without changing the stored list or including it in other categories', async () => {
  const { filtered } = await import('../../src/ui/view-model.js');
  const r = makeResult();
  r.assets.reverse();
  const order = r.assets.map((a) => a.id);
  assert.equal(filtered(r, 'assets', 'video')[0].role, 'full-video');
  assert.equal(filtered(r, 'assets', 'image').length, 0);
  assert.equal(filtered(r, 'assets', 'video', '完整视频').length, 1);
  assert.deepEqual(
    r.assets.map((a) => a.id),
    order
  );
});
