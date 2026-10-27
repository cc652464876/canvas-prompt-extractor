'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalize } = require('../../src/normalize.cjs');
const { ProjectStore } = require('../../src/project-store.cjs');
const { projectKey, contentFingerprint } = require('../../src/project-identity.cjs');
const { AuthorStore, namespaceResult } = require('../../src/author-library.cjs');
const { createAuthorService } = require('../../src/services/author.cjs');
const { readProfileCount } = require('../../src/platforms/profiles.cjs');
const { collectionName } = require('../../src/project-files.cjs');
const { loadLocalProject } = require('../../src/local-project.cjs');
const id = '9'.repeat(32),
  uuid = '3'.repeat(32);
const work = { id, title: '作品', url: 'https://www.liblib.tv/detail/' + id };
function result(prompt = '原始提示词') {
  return normalize(
    {
      nodes: [
        {
          id: 'image',
          type: 'image',
          data: {
            name: '图片',
            action: 'image_generate',
            params: { prompt },
            url: ['https://cdn.example.com/image.png']
          }
        }
      ],
      edges: [],
      source: 'fixture',
      frameUrl: work.url
    },
    { platform: 'liblib', author: '作者', title: work.title, inputUrl: work.url }
  );
}
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-updates-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('canvas-updates-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
async function downloaded(store) {
  const asset = store.result.assets[0];
  await fs.writeFile(store.assetPath(asset), 'downloaded');
  Object.assign(asset, { state: 'done', bytes: 10, total: 10, savedBytes: 10 });
  await store.checkpoint();
}
test('Legacy single-work records reuse completed media after author namespacing and a missing index', async (t) => {
  const root = await temp(t),
    old = new ProjectStore(root);
  await old.create(result());
  await downloaded(old);
  const data = JSON.parse(await fs.readFile(old.summary().manifestPath, 'utf8'));
  data.projectKey = 'liblib|/detail/' + id;
  await fs.writeFile(old.summary().manifestPath, JSON.stringify(data));
  await fs.unlink(path.join(root, '.项目索引.json'));
  const next = new ProjectStore(root);
  await next.create(namespaceResult(result(), work));
  assert.equal(next.directory, old.directory);
  assert.equal(next.result.assets[0].state, 'done');
  assert.equal(next.result.assets[0].fileName, old.result.assets[0].fileName);
  assert.equal(await fs.readFile(next.assetPath(next.result.assets[0]), 'utf8'), 'downloaded');
  assert.equal(
    (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).length,
    1
  );
  const direct = new ProjectStore(old.directory);
  await direct.create(result());
  assert.equal(direct.directory, old.directory);
  assert.equal(direct.result.assets[0].state, 'done');
});
test('A changed media URL cannot inherit done status from an unchanged resource ID', async (t) => {
  const root = await temp(t),
    old = new ProjectStore(root);
  await old.create(result());
  await downloaded(old);
  const fresh = result();
  fresh.assets[0].url = 'https://cdn.example.com/replacement.png';
  const next = new ProjectStore(root);
  await next.create(fresh);
  assert.equal(next.directory, old.directory);
  assert.equal(fresh.assets[0].state, 'pending');
  assert.equal(await fs.readFile(old.assetPath(old.result.assets[0]), 'utf8'), 'downloaded');
});
test('Repeated prompt changes update one document and do not create historical files', async (t) => {
  const store = new ProjectStore(await temp(t));
  await store.create(result(), { kinds: ['image'], split: true });
  const name = store.documents[0];
  for (const prompt of ['新提示词一', '新提示词二']) {
    store.result.entries[0].prompt = prompt;
    await store.save(true);
    assert.ok((await fs.readFile(path.join(store.directory, name), 'utf8')).includes(prompt));
  }
  assert.equal((await fs.readdir(store.directory)).filter((n) => n.startsWith('历史_')).length, 0);
  assert.deepEqual(store.documents, [name]);
});
test('NeoWow work query IDs remain distinct, even when their titles match', () => {
  const first = { platform: 'neowow', inputUrl: 'https://neowow.cn/video-works-view?id=147' };
  assert.notEqual(
    projectKey(first),
    projectKey({ ...first, inputUrl: 'https://neowow.cn/video-works-view?id=148' })
  );
});
test('An existing author directory is reused after its metadata is removed and its parent index is changed', async (t) => {
  const root = await temp(t);
  const profile = {
    platform: 'liblib',
    uuid,
    author: '作者',
    url: 'https://www.liblib.tv/profile?uuid=' + uuid,
    works: [work]
  };
  const first = new AuthorStore(root, profile, {}, []);
  await first.prepare();
  await fs.unlink(path.join(first.directory, '.作者选集.json'));
  await fs.writeFile(path.join(root, '.作者索引.json'), '{"stale":"unrelated-folder"}');
  const next = new AuthorStore(root, profile, {}, []);
  await next.prepare();
  assert.equal(next.directory, first.directory);
  const direct = new AuthorStore(first.directory, profile, {}, []);
  await direct.prepare();
  assert.equal(direct.directory, first.directory);
});
test('Cached done flags are not trusted when the destination has no downloaded file', async (t) => {
  const value = result();
  Object.assign(value.assets[0], { state: 'done', bytes: 10, total: 10 });
  const store = new ProjectStore(await temp(t));
  await store.create(value);
  assert.equal(value.assets[0].state, 'pending');
});
test('Author ID naming preserves unrelated legacy name and hash directories', async (t) => {
  const root = await temp(t);
  const profile = {
    platform: 'liblib',
    uuid,
    author: '作者',
    url: 'https://www.liblib.tv/profile?uuid=' + uuid,
    works: []
  };
  const hash = require('node:crypto')
    .createHash('sha256')
    .update('liblib|' + uuid)
    .digest('hex')
    .slice(0, 8);
  for (const name of ['liblib_作者', 'liblib_作者_' + hash]) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, 'keep.txt'), 'existing user content');
  }
  const store = new AuthorStore(root, profile, {}, []);
  await store.prepare();
  assert.equal(path.basename(store.directory), 'liblib_作者_' + uuid);
  for (const name of ['liblib_作者', 'liblib_作者_' + hash])
    assert.deepEqual(await fs.readdir(path.join(root, name)), ['keep.txt']);
});
test('LibTV count checks make one request and use the server total instead of page length', async () => {
  let requests = 0;
  const total = await readProfileCount(
    'https://www.liblib.tv/profile?uuid=' + uuid,
    async (_url, options, platform) => {
      requests++;
      assert.equal(platform, 'liblib');
      assert.equal(JSON.parse(options.body).pageSize, 1);
      return Response.json({ code: 0, data: { total: 37, list: [{}] } });
    },
    new AbortController().signal
  );
  assert.equal(requests, 1);
  assert.equal(total, 37);
  await assert.rejects(
    readProfileCount(
      'https://www.liblib.tv/profile?uuid=' + uuid,
      async () => Response.json({ code: 0, data: { list: [] } }),
      new AbortController().signal
    ),
    /可靠/
  );
});
test('Local collection checks bypass cached results, reuse saved files and preserve originals on failure', async (t) => {
  const root = await temp(t);
  const profile = {
    platform: 'liblib',
    uuid,
    author: '作者',
    url: 'https://www.liblib.tv/profile?uuid=' + uuid,
    works: [{ ...work }]
  };
  const namespaced = namespaceResult(result(), work);
  const library = new AuthorStore(root, profile, {}, [
    { work: profile.works[0], result: namespaced, store: null }
  ]);
  library.options = { kinds: ['image'], split: true, mode: 'full' };
  await library.prepare();
  await downloaded(library.records[0].store);
  let value = result(),
    failure = false,
    freshReads = 0;
  const events = [];
  const service = createAuthorService({
    fetcher: async () => {},
    readWork: async (_url, options) => {
      freshReads++;
      assert.equal(options.forceRead, true);
      if (failure) throw new Error('offline');
      return structuredClone(value);
    },
    cache: {
      get: () => {
        throw new Error('must bypass cache');
      }
    },
    cancelRead: () => {},
    publish: () => {},
    send: (type, payload) => events.push({ type, payload }),
    getRoot: () => root,
    getOptions: () => library.options
  });
  const reopen = async () =>
    service.openLocal(
      await loadLocalProject(path.join(library.directory, collectionName(profile)))
    );
  const wait = async () => {
    while (service.reading) await new Promise((resolve) => setTimeout(resolve, 5));
  };
  await reopen();
  service.checkUpdates();
  await wait();
  assert.equal(service.snapshot().works[0].updateState, 'unchanged');
  value = result('更新后的提示词');
  service.checkUpdates();
  await wait();
  assert.equal(service.snapshot().works[0].updateState, 'changed');
  const manifest = library.records[0].store.summary().manifestPath;
  const updated = JSON.parse(await fs.readFile(manifest, 'utf8'));
  assert.equal(updated.result.assets[0].state, 'done');
  assert.ok(updated.result.entries.some((e) => e.prompt === '更新后的提示词'));
  failure = true;
  const before = await fs.readFile(manifest, 'utf8');
  service.checkUpdates();
  await wait();
  assert.equal(await fs.readFile(manifest, 'utf8'), before);
  assert.match(service.snapshot().works[0].error, /保留本地/);
  assert.equal(freshReads, 3);
  assert.ok(events.some((e) => e.type === 'status' && /检查失败/.test(e.payload.message)));
});
test('Fingerprints ignore download state and metadata counts but detect prompt-only changes', () => {
  const first = result(),
    next = structuredClone(first);
  next.metadata.workInfo = { likeCount: 100 };
  next.assets[0].state = 'done';
  assert.equal(contentFingerprint(first), contentFingerprint(next));
  next.entries[0].prompt = '仅文字发生变化';
  assert.notEqual(contentFingerprint(first), contentFingerprint(next));
});
