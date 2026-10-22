'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { profileAddress } = require('../../src/platforms/profiles.cjs');
const tap = require('../../src/platforms/tapnow/profile.cjs');
const jimeng = require('../../src/platforms/jimeng/profile.cjs');
const { namespaceResult, AuthorStore, mergeResults } = require('../../src/author-library.cjs');
const { publishedWork } = require('../../src/published-work.cjs');
const { loadLocalCollection } = require('../../src/local-collection.cjs');
const { createAuthorService } = require('../../src/services/author.cjs');
const { resolvePlatform } = require('../../src/platforms/registry.cjs');
const { listingWork } = require('../../src/platforms/jimeng/profile-data.cjs');
const uuid = '4a0f459d-6428-4170-acc6-5eeebdcae09b';
const profileUrl = 'https://app.tapnow.plus/creator/profile/' + uuid;
const rows = [1, 2].map((id) => ({
  id: String(id),
  title: '同名作品',
  user_id: uuid,
  user_name: '作者',
  channels: [{ id: 3 }],
  canva_id: 'shared',
  video_url: 'https://cdn.example.com/' + id + '.mp4'
}));
const fetcher = async (url) => {
  const page = Number(new URL(url).searchParams.get('page'));
  return Response.json({
    code: 0,
    data: { list: page === 1 ? [rows[0]] : [rows[1]], pagination: { total: 2 } }
  });
};
test('Jimeng homepage DomainModels preserve work identity and distinguish public, private and unknown canvas state', () => {
  const item = {
    id: '1234567890123456789',
    effectType: 210,
    commonAttr: { title: '作品', coverUrl: 'https://cdn.example.com/cover.png' },
    author: { name: '真实作者' },
    video: { originVideo: { videoUrl: 'https://cdn.example.com/1.mp4' } },
    canvasInfo: { projectId: 'shared', reviewStatus: 1 }
  };
  assert.equal(listingWork(item).canvasAccess, 'public');
  assert.equal(listingWork(item).author, '真实作者');
  assert.equal(listingWork({ ...item, canvasInfo: undefined }).canvasAccess, 'not-public');
  assert.equal(
    listingWork({ ...item, canvasInfo: { projectId: 'shared', reviewStatus: 0 } }).canvasAccess,
    'not-public'
  );
  const { canvasInfo, ...partial } = item;
  assert.equal(listingWork(partial).canvasAccess, 'unknown');
  assert.equal(listingWork({ ...item, effectType: 1 }), null);
  assert.equal(
    listingWork({ ...item, video: { originVideo: { videoUrl: 'javascript:alert(1)' } } }).fullVideo
      .url,
    ''
  );
  assert.equal(
    listingWork({
      key: item.id,
      type: 'short-video',
      title: '作品',
      videoUrl: 'https://cdn.example.com/1.mp4'
    }).canvasAccess,
    'unknown'
  );
});
test('Known private LibTV works are ready for video download when listing completes and never enter canvas extraction', async () => {
  let reads = 0,
    result;
  const works = [1, 2].map((n) => ({
    templateUuid: String(n).repeat(32),
    ownerUuid: uuid.replaceAll('-', '').slice(0, 32),
    nickname: '作者',
    name: '同名作品',
    snapshotId: n === 1 ? null : 123,
    projectUuid: 'shared',
    finalOutput: 'https://cdn.example.com/' + n + '.mp4'
  }));
  const author = works[0].ownerUuid;
  const service = createAuthorService({
    fetcher: async () => Response.json({ code: 0, data: { list: works, total: 2 } }),
    readWork: async () => {
      reads++;
      return publishedWork({
        platform: 'liblib',
        inputUrl: 'https://www.liblib.tv/detail/' + works[1].templateUuid,
        title: '同名作品'
      });
    },
    cancelRead: () => {},
    publish: (r) => {
      result = r;
    },
    send: () => {},
    getRoot: () => '.',
    getOptions: () => ({})
  });
  await service.open('https://www.liblib.tv/profile?uuid=' + author);
  assert.equal(reads, 0);
  assert.equal(service.snapshot().works[0].state, 'ready');
  assert.equal(service.snapshot().works[1].canvasAccess, 'public');
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].url, 'https://cdn.example.com/1.mp4');
  assert.equal(result.authorProfile.pending, 1);
  service.start();
  for (let i = 0; service.reading && i < 100; i++) await new Promise((r) => setTimeout(r, 1));
  assert.equal(reads, 1);
});
test('Author routing supports three platforms, rejects credentials/lookalikes and leaves RHTV unsupported', () => {
  assert.equal(profileAddress('https://jimeng.jianying.com/s/hBHP6B5pXik/').platform, 'jimeng');
  for (const invalid of [
    'https://jimeng.jianying.com.evil/s/hBHP6B5pXik/',
    'https://user@jimeng.jianying.com/s/hBHP6B5pXik/'
  ])
    assert.equal(profileAddress(invalid), null);
  assert.equal(profileAddress(profileUrl).platform, 'tapnow');
  assert.equal(
    profileAddress(
      'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAAD3z98Zd1pFYZ1P2OzjmDuuLHzNt5JRNfYlDep8kTH8ESmYzarv3lgNNsqkSVLMGw'
    ).platform,
    'jimeng'
  );
  for (const u of [
    profileUrl.replace('https:', 'http:'),
    profileUrl.replace('app.tapnow.plus', 'app.tapnow.plus.evil.test'),
    profileUrl.replace('https://', 'https://user:password@'),
    'https://www.runninghub.cn/creator/profile/' + uuid
  ])
    assert.equal(profileAddress(u), null);
  assert.equal(
    resolvePlatform('https://www.runninghub.cn/projects/canvas/camp/1').platform,
    'rhtv'
  );
});
test('Jimeng waits for AI short films and never opens inspiration cards or accepts their empty view', async () => {
  let selected = false,
    snapshots = 0;
  const url = 'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAATESTAUTHOR';
  const r = await jimeng.readProfile(
    'https://jimeng.jianying.com/s/hBHP6B5pXik/',
    null,
    new AbortController().signal,
    () => {},
    async (address, read) => {
      assert.equal(address.shared, true);
      return read(
        async (action) => {
          if (action === 'select') {
            selected = true;
            return true;
          }
          if (action === 'open') throw new Error('Inspiration must not be opened');
          snapshots++;
          return {
            url: url + '?scene=persona',
            active: selected,
            indices: selected ? [] : [99],
            complete: true,
            login: true
          };
        },
        async (ms) => new Promise((r) => setTimeout(r, ms))
      );
    }
  );
  assert.equal(r.uuid, 'MS4wLjABAAAATESTAUTHOR');
  assert.equal(r.url, url);
  assert.deepEqual(r.works, []);
  assert.ok(snapshots >= 3);
});
test('TapNow paginates by work ID, retains shared canvases, and rejects stalled or incomplete lists', async () => {
  const value = await tap.readProfile(profileUrl, fetcher, new AbortController().signal);
  assert.equal(value.works.length, 2);
  assert.equal(value.works[0].canvasId, value.works[1].canvasId);
  assert.notEqual(value.works[0].url, value.works[1].url);
  await assert.rejects(
    tap.readProfile(
      profileUrl,
      async () => Response.json({ code: 0, data: { list: [rows[0]], pagination: { total: 3 } } }),
      new AbortController().signal
    ),
    /分页没有推进/
  );
});
test('All four platforms preserve video-only results and explicit unavailable video states', () => {
  for (const platform of ['liblib', 'jimeng', 'rhtv', 'tapnow']) {
    const r = publishedWork({
      platform,
      inputUrl: 'https://example.com/work/1',
      title: '作品',
      fullVideo: { workId: '1', name: '作品', url: 'https://cdn.example.com/1.mp4' }
    });
    assert.equal(r.entries.length, 0);
    assert.equal(r.assets.length, 1);
    assert.equal(r.assets[0].role, 'full-video');
    assert.equal(r.metadata.canvasAccess, 'not-public');
    assert.equal(r.metadata.canvasUrl, '');
    const unavailable = publishedWork({
      platform,
      inputUrl: 'https://example.com/work/2',
      title: '无视频'
    });
    assert.equal(unavailable.assets[0].state, 'unavailable');
    assert.match(unavailable.metadata.canvasNote, /视频暂不可下载/);
  }
});
test('Two works sharing a canvas are extracted separately and retain distinct video-only offline folders', async () => {
  const profile = await tap.readProfile(profileUrl, fetcher, new AbortController().signal);
  let reads = 0,
    result;
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'author-platforms-'));
  try {
    const service = createAuthorService({
      fetcher,
      readWork: async (url, options) => {
        reads++;
        assert.equal(options.workHint.url, url);
        return publishedWork({
          platform: 'tapnow',
          inputUrl: url,
          title: options.workHint.title,
          author: '作者',
          fullVideo: options.workHint.fullVideo
        });
      },
      getRoot: () => root,
      getOptions: () => ({}),
      cancelRead: () => {},
      send: () => {},
      publish: (r) => {
        result = r;
      }
    });
    await service.open(profileUrl);
    service.start();
    for (let i = 0; service.reading && i < 100; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(reads, 2);
    assert.equal(result.assets.length, 2);
    assert.equal(new Set(result.assets.map((a) => a.id)).size, 2);
    assert.deepEqual(result.authorProfile.unpublishedIds, ['1', '2']);
    const records = profile.works.map((work) => ({
      work,
      result: namespaceResult(
        publishedWork({
          platform: 'tapnow',
          inputUrl: work.url,
          title: work.title,
          author: '作者',
          fullVideo: work.fullVideo
        }),
        work
      )
    }));
    const store = new AuthorStore(
      root,
      profile,
      mergeResults(profile, new Map(records.map((r) => [r.work.id, r.result])), ['1', '2']),
      records
    );
    await store.prepare();
    assert.notEqual(records[0].store.directory, records[1].store.directory);
    const offline = await loadLocalCollection(store.directory);
    assert.deepEqual(
      offline.profile.works.map((w) => w.id),
      ['1', '2']
    );
    assert.ok(offline.profile.works.every((w) => w.canvasAccess === 'not-public'));
  } finally {
    assert.ok(path.basename(root).startsWith('author-platforms-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('Jimeng pagination uses actual detail IDs, keeps duplicate titles and propagates partial-list failures', async () => {
  const url = 'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAATESTAUTHOR';
  let current = null,
    page = 0;
  const readPage = async (address, read) =>
    read(
      async (action, index) => {
        if (action === 'select') return true;
        if (action === 'snapshot')
          return {
            url: current ? 'https://jimeng.jianying.com/ai-tool/work-detail/' + current : url,
            indices: page ? [0, 1] : [0],
            active: true,
            complete: !!page
          };
        if (action === 'open') {
          current = String(index + 100);
          return true;
        }
        if (action === 'back') {
          current = null;
          return true;
        }
        if (action === 'scroll') {
          page = 1;
          return true;
        }
        if (action === 'detail')
          return {
            id: current,
            title: '同名作品',
            author: '作者',
            url: 'https://jimeng.jianying.com/ai-tool/work-detail/' + current,
            canvasAccess: 'not-public',
            fullVideo: { url: 'https://cdn.example.com/' + current + '.mp4' }
          };
      },
      async () => {}
    );
  const r = await jimeng.readProfile(url, null, new AbortController().signal, () => {}, readPage);
  assert.deepEqual(
    r.works.map((w) => w.id),
    ['100', '101']
  );
  assert.equal(r.works[0].title, r.works[1].title);
  await assert.rejects(
    jimeng.readProfile(
      url,
      null,
      new AbortController().signal,
      () => {},
      async (address, read) =>
        read(
          async (action) =>
            action === 'select' ? true : { url, active: true, indices: [], complete: false },
          async () => {}
        )
    ),
    /未完成加载/
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    jimeng.readProfile(url, null, controller.signal, () => {}, readPage),
    { name: 'AbortError' }
  );
});
test('Video-only works remain downloadable without appearing in the canvas asset board', async () => {
  const { boardAssets, filtered, contentSummary } = await import('../../src/ui/view-model.js');
  const result = {
    metadata: {},
    entries: [],
    authorProfile: { unpublishedIds: ['private'] },
    assets: [
      { id: 'a', workId: 'private', kind: 'video', name: '成片', role: 'full-video' },
      { id: 'b', workId: 'public', kind: 'image', name: '画布图片' }
    ]
  };
  assert.deepEqual(
    boardAssets(result).map((a) => a.id),
    ['b']
  );
  assert.deepEqual(
    filtered(result, 'assets', 'all').map((a) => a.id),
    ['b']
  );
  assert.equal(result.assets.length, 2);
  assert.match(contentSummary(result), /1 部作品未公开画布/);
});
