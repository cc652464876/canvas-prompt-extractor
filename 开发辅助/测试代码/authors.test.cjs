'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { profileAddress, readProfile } = require('../../src/platforms/liblib/profile.cjs');
const { namespaceResult, mergeResults, AuthorStore } = require('../../src/author-library.cjs');
const { createAuthorService } = require('../../src/services/author.cjs');
const { validateProjectRecord } = require('../../src/core/project-schema.cjs');
const { DownloadQueue } = require('../../src/download-queue.cjs');
const { SessionWorkCache } = require('../../src/session-work-cache.cjs');
const uuid = 'a'.repeat(32),
  profileUrl = 'https://liblib.tv/profile?uuid=' + uuid;
const work = (n, title = '作品 ' + n) => ({
  id: n.toString(16).padStart(32, '0'),
  title,
  url: 'https://www.liblib.tv/detail/' + n.toString(16).padStart(32, '0'),
  state: 'idle',
  error: ''
});
function result(w) {
  return {
    schemaVersion: 2,
    metadata: {
      platform: 'liblib',
      inputUrl: w.url,
      canvasUrl: 'https://www.liblib.tv/canvas/shared',
      title: w.title,
      author: '测试作者'
    },
    entries: [
      {
        nodeId: 'same-node',
        name: '生成节点',
        kind: 'image_text',
        group: '',
        position: { y: 0 },
        prompt: 'literal same-node',
        references: [{ nodeId: 'ref-node', assetIds: ['same-asset'] }],
        referenceTexts: [
          { nodeId: 'ref-node', text: '原文', textKey: 'key', targetNodeId: 'same-node' }
        ],
        outputAssetIds: ['same-asset']
      }
    ],
    assets: [
      {
        id: 'same-asset',
        name: '素材',
        kind: 'image',
        fileName: '素材.png',
        url: 'https://fixture.invalid/pixel.png',
        previewUrl: '',
        source: 'generated',
        nodeIds: ['same-node'],
        state: 'pending',
        associatedTexts: [{ nodeId: 'ref-node', targetNodeId: 'same-node', text: '原文' }]
      }
    ],
    edges: [{ id: 'edge', source: 'ref-node', target: 'same-node' }],
    nodeSummaries: [{ nodeId: 'same-node' }, { nodeId: 'ref-node' }],
    diagnostics: { warnings: [], nodeCount: 2, edgeCount: 1, counts: { image_text: 1 } }
  };
}
function profile(works) {
  return { platform: 'liblib', uuid, author: '测试作者', url: profileUrl, works };
}
test('Author address validates exact hosts, HTTPS, path and a complete UUID', () => {
  assert.equal(profileAddress(profileUrl).uuid, uuid);
  for (const url of [
    'http://liblib.tv/profile?uuid=' + uuid,
    'https://liblib.tv.evil.test/profile?uuid=' + uuid,
    'https://x:y@liblib.tv/profile?uuid=' + uuid,
    'https://liblib.tv/profile?uuid=a',
    'https://liblib.tv/detail/' + uuid
  ])
    assert.equal(profileAddress(url), null);
});
test('Author listing paginates, deduplicates and never collects another author', async () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({
    templateUuid: work(i + 1).id,
    name: '作品 ' + i,
    ownerUuid: uuid,
    nickname: '测试作者'
  }));
  const pages = [];
  const value = await readProfile(
    profileUrl,
    async (url, options) => {
      if (url.includes('/getPersonInfo/'))
        return Response.json({ code: 0, data: { userDetail: { nickname: '测试作者' } } });
      const body = JSON.parse(options.body);
      pages.push(body.page);
      return Response.json({
        code: 0,
        data: { list: rows.slice((body.page - 1) * 20, body.page * 20), total: 23 }
      });
    },
    new AbortController().signal
  );
  assert.equal(value.works.length, 23);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(value.author, '测试作者');
  await assert.rejects(
    () =>
      readProfile(
        profileUrl,
        async () => Response.json({ code: 0, data: { list: rows.slice(0, 20), total: 23 } }),
        new AbortController().signal
      ),
    /分页没有推进/
  );
});
test('Cross-work identities isolate all relationships without rewriting literal prompts', () => {
  const a = work(1),
    b = work(2),
    ra = namespaceResult(result(a), a),
    rb = namespaceResult(result(b), b);
  assert.notEqual(ra.assets[0].id, rb.assets[0].id);
  assert.match(ra.assets[0].id, /^[a-f0-9]{24}$/);
  assert.equal(ra.entries[0].outputAssetIds[0], ra.assets[0].id);
  assert.equal(ra.entries[0].references[0].assetIds[0], ra.assets[0].id);
  assert.equal(ra.assets[0].nodeIds[0], ra.entries[0].nodeId);
  assert.equal(ra.edges[0].target, ra.entries[0].nodeId);
  assert.equal(ra.assets[0].associatedTexts[0].targetNodeId, ra.entries[0].nodeId);
  assert.equal(ra.entries[0].prompt, 'literal same-node');
  const merged = mergeResults(
    profile([a, b]),
    new Map([
      [a.id, ra],
      [b.id, rb]
    ]),
    [a.id, b.id]
  );
  assert.equal(merged.assets.length, 2);
  assert.equal(merged.diagnostics.nodeCount, 4);
  assert.equal(merged.diagnostics.counts.image_text, 2);
  assert.equal(
    mergeResults(
      profile([a, b]),
      new Map([
        [a.id, ra],
        [b.id, rb]
      ]),
      []
    ).assets.length,
    0
  );
});
test('Batch saving and downloading preserve per-work folders, duplicate assets and selection snapshots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'authors-v13-'));
  const a = work(1, '同名作品'),
    b = work(2, '同名作品'),
    p = profile([a, b]);
  const records = [a, b].map((w) => ({
    work: w,
    result: namespaceResult(result(w), w),
    store: null
  }));
  const merged = mergeResults(p, new Map(records.map((r) => [r.work.id, r.result])), [a.id, b.id]);
  const store = new AuthorStore(root, p, merged, records);
  store.options = { kinds: ['image'], split: true, mode: 'full' };
  await store.prepare();
  assert.equal(path.basename(store.directory), 'liblib_测试作者');
  assert.equal(path.basename(records[0].store.directory), '同名作品');
  assert.match(path.basename(records[1].store.directory), /^同名作品_/);
  const saved = await store.save(false, { cancelled: false });
  assert.equal(saved.savedDocuments.length, 2);
  let requests = 0;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64'
  );
  const queue = new DownloadQueue({
    fetcher: async () => {
      requests++;
      return new Response(png, {
        headers: { 'content-type': 'image/png', 'content-length': String(png.length) }
      });
    },
    filePath: (asset) => store.assetPath(asset),
    onProgress: () => {},
    onSettled: () => store.checkpoint(),
    concurrency: 2,
    interval: 0
  });
  const download = queue.start([...merged.assets], ['image']);
  const preview = mergeResults(p, new Map(records.map((r) => [r.work.id, r.result])), [b.id]);
  await download;
  assert.equal(requests, 2);
  assert.equal(preview.assets.length, 1);
  assert.equal(queue.summary().total, 2);
  for (const r of records) {
    assert.equal((await fs.stat(r.store.assetPath(r.result.assets[0]))).size, png.length);
    const manifest = JSON.parse(
      await fs.readFile(path.join(r.store.directory, '.画布项目.json'), 'utf8')
    );
    validateProjectRecord(manifest);
  }
  const again = new AuthorStore(root, p, merged, records);
  again.options = store.options;
  await again.prepare();
  assert.equal(again.directory, store.directory);
});
test('Rapid selection changes ignore cancelled-work data and reuse completed reads', async () => {
  const a = work(1),
    b = work(2);
  let resolveA,
    last,
    calls = 0;
  const service = createAuthorService({
    fetcher: async () =>
      Response.json({
        code: 0,
        data: {
          list: [a, b].map((w) => ({
            templateUuid: w.id,
            name: w.title,
            nickname: '测试作者',
            ownerUuid: uuid
          })),
          total: 2
        }
      }),
    readWork: async (url) => {
      calls++;
      if (url === a.url) return new Promise((resolve) => (resolveA = () => resolve(result(a))));
      return result(b);
    },
    cancelRead: () => {},
    publish: (r) => (last = r),
    send: () => {},
    getRoot: () => os.tmpdir(),
    getOptions: () => ({})
  });
  await service.open(profileUrl);
  assert.equal(calls, 0);
  service.select([a.id]);
  service.start();
  service.select([b.id]);
  resolveA();
  for (let i = 0; i < 20 && service.reading; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(last.authorProfile.selectedIds, [b.id]);
  assert.equal(calls, 1);
  assert.equal(last.assets.length, 0);
  service.start();
  for (let i = 0; i < 20 && service.reading; i++) await new Promise((r) => setImmediate(r));
  assert.equal(last.assets.length, 1);
  assert.equal(last.assets[0].workId, b.id);
  service.select([]);
  assert.equal(last.assets.length, 0);
  service.select([a.id, b.id]);
  assert.equal(last.assets.length, 2);
  assert.equal(calls, 2);
  assert.equal(service.reading, false);
});
test('Stopping a collection stops pending works too, and explicit retry resumes one work', async () => {
  const a = work(1),
    b = work(2);
  let rejectRead,
    calls = 0,
    last;
  const service = createAuthorService({
    fetcher: async () =>
      Response.json({
        code: 0,
        data: {
          list: [a, b].map((w) => ({
            templateUuid: w.id,
            name: w.title,
            nickname: '测试作者',
            ownerUuid: uuid
          })),
          total: 2
        }
      }),
    readWork: async (url) => {
      calls++;
      if (calls === 1) return new Promise((_resolve, reject) => (rejectRead = reject));
      return result(url === a.url ? a : b);
    },
    cancelRead: () => rejectRead(Object.assign(new Error('stopped'), { code: 'READ_CANCELLED' })),
    publish: (r) => (last = r),
    send: () => {},
    getRoot: () => os.tmpdir(),
    getOptions: () => ({})
  });
  await service.open(profileUrl);
  service.select([a.id, b.id]);
  service.start();
  service.stop();
  for (let i = 0; i < 20 && service.reading; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.equal(last.authorProfile.pending, 0);
  assert.ok(service.snapshot().works.every((w) => w.state === 'error'));
  service.retry(b.id);
  for (let i = 0; i < 20 && service.reading; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.deepEqual(last.authorProfile.loadedIds, [b.id]);
});

test('Author defaults to all works and reuses completed data after deselecting and reopening the profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'author-cache-'));
  const cache = new SessionWorkCache(() => root);
  const works = [work(1), work(2), work(3)];
  let calls = 0,
    last;
  const selections = [];
  const service = createAuthorService({
    fetcher: async () =>
      Response.json({
        code: 0,
        data: {
          list: works.map((w) => ({
            templateUuid: w.id,
            name: w.title,
            nickname: '测试作者',
            ownerUuid: uuid
          })),
          total: works.length
        }
      }),
    readWork: async (url) => {
      calls++;
      return result(works.find((w) => w.url === url));
    },
    cancelRead: () => {},
    publish: (r) => {
      last = r;
    },
    send: () => {},
    getRoot: () => root,
    getOptions: () => ({ mode: 'full' }),
    cache,
    onSelection: (chosen) => selections.push(chosen?.map((w) => w.id) || [])
  });
  const settle = async () => {
    const deadline = Date.now() + 3000;
    while (service.reading) {
      assert.ok(Date.now() < deadline);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  await service.open(profileUrl);
  assert.equal(calls, 0);
  assert.equal(service.reading, false);
  assert.deepEqual(
    service.snapshot().selectedIds,
    works.map((w) => w.id)
  );
  service.start();
  await settle();
  assert.equal(calls, 3);
  assert.equal(last.assets.length, 3);
  service.select([works[0].id]);
  service.select([works[0].id, works[2].id]);
  assert.equal(calls, 3);
  assert.equal(last.assets.length, 2);
  await service.open(profileUrl);
  service.start();
  await settle();
  assert.equal(calls, 3);
  assert.equal(last.assets.length, 3);
  assert.deepEqual(
    selections.at(-1),
    works.map((w) => w.id)
  );
  await cache.close();
});

test('Batch project metadata includes refreshed author social profiles even when work data comes from cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'author-social-batch-'));
  const works = [work(1), work(2)];
  let project,
    last,
    calls = 0;
  const cache = new SessionWorkCache(() => root);
  const service = createAuthorService({
    fetcher: async (url) =>
      url.includes('/getPersonInfo/')
        ? Response.json({
            code: 0,
            data: {
              userDetail: {
                nickname: '测试作者',
                personalSpaceInformation: {
                  xiaohongshuLink:
                    'https://www.xiaohongshu.com/user/profile/611a3eb6000000000101dc1f'
                }
              },
              counter: { followerCount: 0 }
            }
          })
        : Response.json({
            code: 0,
            data: {
              list: works.map((w) => ({
                templateUuid: w.id,
                name: w.title,
                nickname: '测试作者',
                ownerUuid: uuid
              })),
              total: 2
            }
          }),
    enrichAuthor: async (profile) => ({
      ...profile,
      authorInfo: {
        ...profile.authorInfo,
        socialLinks: profile.authorInfo.socialLinks.map((link) => ({
          ...link,
          displayName: '小红书昵称',
          status: 'partial',
          note: '部分资料未读取'
        }))
      }
    }),
    readWork: async (url) => {
      calls++;
      return result(works.find((w) => w.url === url));
    },
    cancelRead: () => {},
    publish: (r, s) => {
      last = r;
      project = s;
    },
    send: () => {},
    getRoot: () => root,
    getOptions: () => ({ mode: 'full', kinds: ['image'] }),
    cache
  });
  const settle = async () => {
    const deadline = Date.now() + 3000;
    while (service.reading) {
      assert.ok(Date.now() < deadline);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  await service.open(profileUrl);
  service.start();
  await settle();
  await service.open(profileUrl);
  service.start();
  await settle();
  assert.equal(calls, 2);
  assert.equal(last.metadata.authorProfiles[1].displayName, '小红书昵称');
  await project.prepare();
  for (const record of project.records) {
    const file = path.join(record.store.directory, '作品信息.md');
    const markdown = await fs.readFile(file, 'utf8');
    assert.match(markdown, /小红书昵称/);
    assert.match(markdown, /### LibTV/);
    assert.match(markdown, /部分资料未读取/);
    assert.equal(record.result.metadata.workIdentity, 'liblib-template:' + record.work.id);
  }
  await cache.close();
});
