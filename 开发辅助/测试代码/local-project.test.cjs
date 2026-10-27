'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { normalize } = require('../../src/normalize.cjs');
const { ProjectStore, MANIFEST } = require('../../src/project-store.cjs');
const { loadLocalProject, isCurrentProjectPath } = require('../../src/local-project.cjs');
const { AuthorStore, namespaceResult, mergeResults } = require('../../src/author-library.cjs');
const { manifestName, collectionName, projectFolderName } = require('../../src/project-files.cjs');
async function fixture(t) {
  const root = path.resolve(__dirname, '../验收记录');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'local-test-'));
  t.after(async () => {
    if (path.dirname(dir) !== root || !path.basename(dir).startsWith('local-test-'))
      throw new Error('Unsafe cleanup');
    await fs.rm(dir, { recursive: true, force: true });
  });
  const result = normalize(
    {
      nodes: [
        {
          id: 'image',
          type: 'image',
          data: {
            action: 'image_generate',
            name: '图片',
            params: { prompt: '本地提示词' },
            url: ['https://cdn.example.com/local.png']
          }
        }
      ],
      edges: [],
      frameUrl: 'https://www.liblib.tv/detail/local',
      source: 'fixture'
    },
    {
      platform: 'liblib',
      author: '测试',
      title: '中文 空格',
      inputUrl: 'https://www.liblib.tv/detail/local'
    }
  );
  const store = new ProjectStore(dir);
  await store.create(result, { mode: 'full' });
  const a = result.assets[0];
  await fs.writeFile(store.assetPath(a), 'test-image');
  a.state = 'done';
  a.bytes = 10;
  await store.checkpoint();
  return { dir, store, manifest: store.summary().manifestPath };
}
test('Directory, manifest and Windows Copy-as-path quotes load the same project without writes', async (t) => {
  const { store, manifest } = await fixture(t),
    before = await fs.readFile(manifest, 'utf8');
  for (const input of [
    store.directory,
    manifest,
    ' "' + store.directory + '" ',
    '"' + manifest + '"'
  ]) {
    const loaded = await loadLocalProject(input);
    assert.equal(loaded.manifestPath, manifest);
    assert.equal(loaded.result.entries[0].prompt, '本地提示词');
    assert.equal(loaded.result.assets[0].state, 'done');
    assert.equal(
      await fs.readFile(loaded.store.assetPath(loaded.result.assets[0]), 'utf8'),
      'test-image'
    );
  }
  assert.equal(await fs.readFile(manifest, 'utf8'), before);
});
test('Current project recognition accepts directory, manifest, quotes and equivalent Windows paths', () => {
  const directory = path.resolve('中文 空格 项目'),
    manifest = path.join(directory, MANIFEST);
  for (const input of [
    directory,
    manifest,
    ' "' + manifest + '" ',
    directory + path.sep,
    path.join(directory, '.', MANIFEST),
    path.join(directory, '打开画布_liblib_作者_作品.json'),
    path.join(directory, '打开作品集_neowow_草帽小蔡.json')
  ])
    assert.equal(isCurrentProjectPath(input, directory), true);
  if (process.platform === 'win32') {
    assert.equal(isCurrentProjectPath(manifest.toUpperCase(), directory), true);
    assert.equal(isCurrentProjectPath(manifest.replaceAll('\\', '/'), directory), true);
  }
  for (const input of [
    '',
    null,
    'relative',
    path.join(directory, 'other.json'),
    directory + '-other'
  ])
    assert.equal(isCurrentProjectPath(input, directory), false);
  assert.equal(isCurrentProjectPath(manifest, null), false);
});
test('A relocated project still loads by relative filenames; missing files are marked without deleting other content', async (t) => {
  const { dir, store } = await fixture(t),
    moved = path.join(dir, '移动后 中文 项目');
  await fs.rename(store.directory, moved);
  assert.equal((await loadLocalProject(moved)).result.assets[0].state, 'done');
  await fs.unlink(path.join(moved, store.result.assets[0].fileName));
  const loaded = await loadLocalProject(moved);
  assert.equal(loaded.result.entries[0].prompt, '本地提示词');
  assert.equal(loaded.result.assets[0].error, '本地文件缺失或不完整');
  assert.equal(loaded.result.assets[0].state, 'pending');
});
test('Invalid paths, missing manifests, damaged JSON, unsupported schema and malformed records fail clearly', async (t) => {
  const { dir, manifest } = await fixture(t);
  await assert.rejects(loadLocalProject('relative'), /完整路径/);
  await assert.rejects(loadLocalProject(path.join(dir, '不存在')), /不存在/);
  assert.equal((await loadLocalProject(dir)).collection, true);
  const empty = path.join(dir, '空目录');
  await fs.mkdir(empty);
  await assert.rejects(loadLocalProject(empty), /未找到/);
  await fs.writeFile(path.join(dir, 'other.json'), '{}');
  await assert.rejects(loadLocalProject(path.join(dir, 'other.json')), /请选择/);
  const original = JSON.parse(await fs.readFile(manifest, 'utf8'));
  await fs.writeFile(manifest, '{broken');
  await assert.rejects(loadLocalProject(manifest), /损坏/);
  for (const alter of [
    (r) => (r.schemaVersion = 99),
    (r) => (r.result.entries[0].references = null),
    (r) => (r.result.assets[0].fileName = '../escape.png'),
    (r) => (r.result.assets[0].fileName = 'bad.exe')
  ]) {
    const data = structuredClone(original);
    alter(data);
    await fs.writeFile(manifest, JSON.stringify(data));
    await assert.rejects(loadLocalProject(manifest));
  }
});

test('Named entry files and folders preserve titles, sanitize Windows names and provide author fallbacks', () => {
  const metadata = { platform: 'liblib', author: '淞希', title: '《异种纪元》第五集' };
  assert.equal(manifestName(metadata), '打开画布_liblib_淞希_《异种纪元》第五集.json');
  assert.equal(projectFolderName(metadata), 'liblib_淞希_《异种纪元》第五集');
  assert.equal(
    collectionName({ platform: 'neowow', author: '草帽小蔡' }),
    '打开作品集_neowow_草帽小蔡.json'
  );
  assert.equal(
    manifestName({ platform: 'liblib', author: '', title: 'CON' }),
    '打开画布_liblib_未知作者__CON.json'
  );
  assert.equal(
    projectFolderName({ platform: 'neowow', author: '作者/甲', title: '影片:测试?. ' }),
    'neowow_作者 甲_影片 测试'
  );
  assert.ok(
    manifestName({ platform: 'liblib', author: '作'.repeat(300), title: '影'.repeat(300) }).length <
      255
  );
});

test('New projects write named manifests, read legacy records without changes, and reuse their assets on saving', async (t) => {
  const { dir, store, manifest } = await fixture(t);
  assert.equal(path.basename(manifest), '打开画布_liblib_测试_中文 空格.json');
  const legacy = path.join(store.directory, MANIFEST);
  await fs.rename(manifest, legacy);
  const before = await fs.readFile(legacy, 'utf8');
  for (const input of [legacy, store.directory]) {
    const loaded = await loadLocalProject(input);
    assert.equal(loaded.manifestPath, legacy);
    assert.equal(loaded.result.assets[0].state, 'done');
  }
  assert.equal(await fs.readFile(legacy, 'utf8'), before);
  const reopened = new ProjectStore(dir);
  await reopened.create(structuredClone(store.result));
  assert.equal(reopened.directory, store.directory);
  assert.equal(reopened.result.assets[0].state, 'done');
  assert.equal(
    await fs.readFile(reopened.assetPath(reopened.result.assets[0]), 'utf8'),
    'test-image'
  );
  assert.equal((await fs.readdir(store.directory)).includes(MANIFEST), false);
  assert.equal((await loadLocalProject(manifest)).manifestPath, manifest);
});

test('An explicit named JSON selects its own record; ambiguous folders require a file selection', async (t) => {
  const { store, manifest } = await fixture(t);
  const second = path.join(store.directory, '打开画布_liblib_另一个作者_另一个作品.json');
  const data = JSON.parse(await fs.readFile(manifest, 'utf8'));
  data.result.metadata.title = '另一个作品';
  await fs.writeFile(second, JSON.stringify(data));
  await assert.rejects(loadLocalProject(store.directory), /多个打开入口/);
  assert.equal((await loadLocalProject(manifest)).result.metadata.title, '中文 空格');
  assert.equal((await loadLocalProject(second)).result.metadata.title, '另一个作品');
});

test('Named author collections reopen after relocation, keep duplicate titles isolated, and accept legacy mixed records', async (t) => {
  const { dir, store } = await fixture(t);
  const works = ['1', '2'].map((id) => ({
    id,
    title: '《浮光》第八集',
    url: 'https://neowow.cn/work/' + id
  }));
  const profile = {
    platform: 'neowow',
    author: '草帽小蔡',
    uuid: 'author',
    url: 'https://neowow.cn/creator?userId=author',
    works
  };
  const records = works.map((work) => {
    const original = structuredClone(store.result);
    Object.assign(original.metadata, {
      platform: profile.platform,
      author: profile.author,
      title: work.title,
      inputUrl: work.url
    });
    original.assets[0].state = 'pending';
    return { work, result: namespaceResult(original, work) };
  });
  const aggregate = mergeResults(profile, new Map(records.map((r) => [r.work.id, r.result])), [
    '1',
    '2'
  ]);
  const author = new AuthorStore(path.join(dir, 'library'), profile, aggregate, records);
  await author.prepare();
  const entry = collectionName(profile);
  const index = JSON.parse(await fs.readFile(path.join(author.directory, entry), 'utf8'));
  assert.equal((await fs.readdir(author.directory)).includes('.项目索引.json'), false);
  assert.equal(path.basename(records[0].store.directory), 'neowow_草帽小蔡_《浮光》第八集');
  assert.match(
    path.basename(records[1].store.directory),
    /^neowow_草帽小蔡_《浮光》第八集_[a-f0-9]{8}$/
  );
  assert.deepEqual(
    Object.values(index),
    records.map((r) => path.basename(r.store.directory))
  );
  for (const record of records) {
    await fs.writeFile(record.store.assetPath(record.result.assets[0]), 'test-image');
    record.result.assets[0].state = 'done';
    await record.store.checkpoint();
  }
  const moved = path.join(dir, '移动后的作品集');
  await fs.rename(author.directory, moved);
  for (const input of [moved, path.join(moved, entry), '"' + path.join(moved, entry) + '"']) {
    const loaded = await loadLocalProject(input);
    assert.equal(loaded.manifestPath, path.join(moved, entry));
    assert.equal(loaded.records.size, 2);
    assert.deepEqual(
      loaded.profile.works.map((w) => w.id),
      ['1', '2']
    );
    for (const record of loaded.records.values()) {
      assert.equal(record.result.assets[0].state, 'done');
      assert.equal(
        await fs.readFile(record.store.assetPath(record.result.assets[0]), 'utf8'),
        'test-image'
      );
    }
  }
  const folder = path.join(moved, path.basename(records[0].store.directory));
  await fs.rename(path.join(folder, records[0].store.manifestName), path.join(folder, MANIFEST));
  await fs.rename(path.join(moved, entry), path.join(moved, '.项目索引.json'));
  const legacy = await loadLocalProject(moved);
  assert.equal(legacy.records.size, 2);
  assert.equal(legacy.manifestPath, path.join(moved, '.项目索引.json'));
});
