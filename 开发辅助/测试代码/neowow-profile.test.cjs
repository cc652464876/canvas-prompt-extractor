'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm');
const neo = require('../../src/platforms/neowow/profile.cjs');
const { profileAddress } = require('../../src/platforms/profiles.cjs');
const { createAuthorService } = require('../../src/services/author.cjs');
const { publishedWork } = require('../../src/published-work.cjs');
const userId = '1988244264030547968',
  url = 'https://neowow.cn/creator?userId=' + userId;
const item = (id, fields = {}) => ({
  id,
  title: '同名作品',
  sessionId: 'SSN_shared',
  isPublic: 1,
  dataType: 2,
  videoUrl: 'https://cdn.example.com/' + id + '.mp4',
  ...fields
});
function pageReader(pages, { total = 3, signal, onPage = () => {} } = {}) {
  return async (address, read) => {
    assert.equal(address.platform, 'neowow');
    return read(
      async (action, page) => {
        if (action === 'snapshot') return { ready: true };
        if (action === 'info')
          return { userId, author: '合成作者', avatar: 'https://cdn.example.com/avatar.png' };
        onPage(page);
        signal?.throwIfAborted();
        return { userId, list: pages[page - 1] || [], total, page };
      },
      async () => {}
    );
  };
}
test('NeoWow author URLs keep full decimal IDs and reject credentials, duplicates and lookalikes', () => {
  assert.equal(profileAddress(url).uuid, userId);
  assert.equal(profileAddress(url).platform, 'neowow');
  assert.equal(
    neo.profileAddress(url.replace('neowow.cn', 'www.neowow.cn') + '&tab=works').url,
    url
  );
  for (const bad of [
    url.replace('https:', 'http:'),
    url.replace('neowow.cn', 'neowow.cn.evil.test'),
    url.replace('https://', 'https://user:pass@'),
    url + '&userId=1',
    'https://neowow.cn/creator',
    url.replace(userId, '1e19'),
    url.replace('/creator', '/not-creator')
  ])
    assert.equal(profileAddress(bad), null);
});
test('Author pagination deduplicates pinned repeats by work ID while retaining same-name/shared-canvas works', async () => {
  const profile = await neo.readProfile(
    url,
    null,
    new AbortController().signal,
    () => {},
    pageReader([
      [item('1'), item('2')],
      [item('2'), item('3', { isPublic: 0 })]
    ])
  );
  assert.equal(profile.works.length, 3);
  assert.equal(profile.works[0].canvasId, profile.works[1].canvasId);
  assert.notEqual(profile.works[0].url, profile.works[1].url);
  assert.equal(profile.works[2].canvasAccess, 'not-public');
  assert.equal(profile.works[2].fullVideo.url, 'https://cdn.example.com/3.mp4');
});
test('Incomplete or stalled pages fail explicitly, and cancellation never commits a partial author list', async () => {
  await assert.rejects(
    neo.readProfile(
      url,
      null,
      new AbortController().signal,
      () => {},
      pageReader([[item('1')]], { total: 2 })
    ),
    /提前结束/
  );
  await assert.rejects(
    neo.readProfile(
      url,
      null,
      new AbortController().signal,
      () => {},
      pageReader([[item('1')], [item('1')]], { total: 2 })
    ),
    /没有推进/
  );
  const controller = new AbortController();
  await assert.rejects(
    neo.readProfile(
      url,
      null,
      controller.signal,
      () => {},
      pageReader([[item('1')]], { signal: controller.signal, onPage: () => controller.abort() })
    ),
    { name: 'AbortError' }
  );
  const empty = await neo.readProfile(
    url,
    null,
    new AbortController().signal,
    () => {},
    pageReader([[]], { total: 0 })
  );
  assert.equal(empty.works.length, 0);
});
test('Unknown access flags stay unknown, reward gates stay public, and unsafe numeric IDs are rejected', () => {
  assert.equal(neo.listingWork(item('1', { isPublic: undefined })).canvasAccess, 'unknown');
  assert.equal(neo.listingWork(item('1', { isReward: 1 })).canvasAccess, 'public');
  assert.equal(neo.listingWork(item('1', { isReward: 1 })).requiresReward, true);
  assert.throws(() => neo.listingWork(item(Number.MAX_SAFE_INTEGER + 1)), /精度/);
  assert.equal(neo.listingWork(item('1', { videoUrl: 'javascript:alert(1)' })).fullVideo.url, '');
});
test('Injected author reader uses only works/latest queries and returns public fields without credentials', async () => {
  const requests = [];
  const context = {
    URL,
    AbortSignal,
    location: { href: url },
    document: { readyState: 'complete', querySelector: () => ({ children: [1] }) },
    localStorage: { getItem: (key) => (key === 'token' ? 'fixture-secret' : null) },
    fetch: async (endpoint, options) => {
      requests.push({ endpoint, body: JSON.parse(options.body), headers: options.headers });
      return {
        ok: true,
        status: 200,
        json: async () =>
          endpoint.endsWith('/works')
            ? {
                success: true,
                data: [item('1', { accessToken: 'private', history: ['unrelated'] })],
                totalCount: 1,
                pageIndex: 1
              }
            : {
                success: true,
                data: {
                  profile: {
                    nickname: '作者',
                    avatar: 'https://cdn.example.com/a.png',
                    email: 'private@example.com'
                  },
                  settings: { signature: '公开介绍' },
                  stats: { workCount: 1 },
                  accessToken: 'private'
                }
              }
      };
    }
  };
  const invoke = (action) =>
    vm.runInNewContext(
      '(' + neo.profilePage.toString() + ')(' + JSON.stringify(action) + ',1)',
      context
    );
  assert.equal((await invoke('snapshot')).ready, true);
  const info = await invoke('info'),
    page = await invoke('page');
  assert.equal(info.author, '作者');
  assert.equal(page.list[0].id, '1');
  assert.ok(!JSON.stringify([info, page]).includes('private'));
  assert.equal(requests[1].body.userId, userId);
  assert.equal(requests[1].body.tab, 'works');
  assert.equal(requests[1].body.sort, 'latest');
  assert.equal(requests[1].headers.accessToken, 'fixture-secret');
  assert.equal((await invoke('follow')).error, '不支持的 NeoWow 主页读取操作。');
});
test('NeoWow integrates default selection, private video-only records and explicit batch start', async () => {
  let reads = 0,
    result;
  const service = createAuthorService({
    fetcher: () => {
      throw new Error('Must use the logged-in page reader');
    },
    readProfilePage: pageReader([[item('1'), item('2', { isPublic: 0 })]], { total: 2 }),
    readWork: async (workUrl) => {
      reads++;
      return publishedWork({ platform: 'neowow', inputUrl: workUrl, title: '作品' });
    },
    cancelRead() {},
    publish: (r) => {
      result = r;
    },
    send() {},
    getRoot: () => '.',
    getOptions: () => ({ mode: 'simple' })
  });
  await service.open(url);
  assert.deepEqual(service.snapshot().selectedIds, ['1', '2']);
  assert.equal(reads, 0);
  assert.equal(service.snapshot().works[1].state, 'ready');
  assert.ok(result.assets.some((a) => a.role === 'full-video' && a.url.endsWith('2.mp4')));
  service.select(['1']);
  service.start();
  for (let i = 0; service.reading && i < 100; i++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(reads, 1);
  assert.deepEqual(result.authorProfile.loadedIds, ['1']);
});
