'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AuthorStore } = require('../../src/author-library.cjs');
const { authorFolderName, resolveAuthorDirectory } = require('../../src/project-files.cjs');
const profile = {
  platform: 'neowow',
  author: '草帽小蔡',
  uuid: '2089693700369928192',
  url: 'https://neowow.cn/creator?userId=2089693700369928192',
  works: []
};
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-author-directories-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('canvas-author-directories-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
test('Collection names preserve the complete author ID and isolate same-name authors and platforms', async (t) => {
  const root = await temp(t);
  assert.equal(authorFolderName(profile), 'neowow_草帽小蔡_2089693700369928192');
  const folders = [];
  for (const value of [
    profile,
    { ...profile, uuid: '2089693700369928193' },
    { ...profile, platform: 'liblib' }
  ]) {
    const store = new AuthorStore(root, value, {}, []);
    await store.prepare();
    folders.push(store.directory);
  }
  assert.equal(new Set(folders).size, 3);
  assert.equal(path.basename(folders[1]), 'neowow_草帽小蔡_2089693700369928193');
});
test('An empty folder is reused solely by name; deleting or editing metadata cannot create hash folders', async (t) => {
  const root = await temp(t),
    folder = path.join(root, authorFolderName(profile));
  await fs.mkdir(folder);
  const sentinel = path.join(folder, '保留素材.mp4');
  await fs.writeFile(sentinel, 'original media');
  const staleIndex = JSON.stringify({ ['neowow|' + profile.uuid]: 'neowow_草帽小蔡_d7f8ea9e' });
  await fs.writeFile(path.join(root, '.作者索引.json'), staleIndex);
  for (const content of [
    null,
    '{invalid json',
    JSON.stringify({ platform: 'other', uuid: 'other' })
  ]) {
    const metadata = path.join(folder, '.作者选集.json');
    await fs.rm(metadata, { force: true });
    if (content !== null) await fs.writeFile(metadata, content);
    const store = new AuthorStore(root, profile, {}, []);
    await store.prepare();
    assert.equal(store.directory, folder);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'original media');
  }
  assert.equal(await fs.readFile(path.join(root, '.作者索引.json'), 'utf8'), staleIndex);
  assert.deepEqual(
    (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
    [authorFolderName(profile)]
  );
});
test('Direct author-folder selection and nickname changes reuse the same ID without nesting folders', async (t) => {
  const root = await temp(t),
    original = new AuthorStore(root, profile, {}, []);
  await original.prepare();
  await fs.unlink(path.join(original.directory, '.作者选集.json'));
  const renamed = { ...profile, author: '新昵称' };
  assert.equal(await resolveAuthorDirectory(root, renamed), original.directory);
  const direct = new AuthorStore(original.directory, renamed, {}, []);
  assert.equal(direct.authorDirectory, original.directory);
  await direct.prepare();
  assert.equal(direct.directory, original.directory);
  assert.deepEqual(await fs.readdir(original.directory), ['.作者选集.json']);
});
test('Legacy folders remain intact and cannot override the complete-ID naming rule through indexes or metadata', async (t) => {
  const root = await temp(t);
  for (const name of ['neowow_草帽小蔡', 'neowow_草帽小蔡_d7f8ea9e']) {
    const directory = path.join(root, name);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, '.作者选集.json'), JSON.stringify(profile));
    await fs.writeFile(path.join(directory, 'keep.txt'), 'legacy');
  }
  const store = new AuthorStore(root, profile, {}, []);
  await store.prepare();
  assert.equal(store.directory, path.join(root, authorFolderName(profile)));
  for (const name of ['neowow_草帽小蔡', 'neowow_草帽小蔡_d7f8ea9e'])
    assert.equal(await fs.readFile(path.join(root, name, 'keep.txt'), 'utf8'), 'legacy');
  await assert.rejects(fs.stat(path.join(root, '.作者索引.json')), { code: 'ENOENT' });
});
test('IDs with underscores stay complete and cannot match another author by suffix', async (t) => {
  const root = await temp(t),
    value = { ...profile, platform: 'jimeng', author: '作者_名字', uuid: 'MS4w_AbCd1234567890' },
    other = { ...value, uuid: 'prefix_' + value.uuid };
  const first = new AuthorStore(root, other, {}, []);
  await first.prepare();
  const second = new AuthorStore(root, value, {}, []);
  await second.prepare();
  assert.equal(path.basename(second.directory), 'jimeng_作者 名字_MS4w_AbCd1234567890');
  assert.notEqual(first.directory, second.directory);
  assert.equal(await resolveAuthorDirectory(root, { ...value, author: '改名' }), second.directory);
  const reserved = { ...profile, author: 'CON', uuid: '123' };
  assert.equal(authorFolderName(reserved), 'neowow_CON_123');
  const directory = path.join(root, authorFolderName(reserved));
  await fs.mkdir(directory);
  assert.equal(await resolveAuthorDirectory(directory, reserved), directory);
});
test('Ambiguous folders and same-name files fail clearly without creating hash-suffix directories', async (t) => {
  const root = await temp(t),
    preferred = authorFolderName(profile);
  await fs.writeFile(path.join(root, preferred), 'existing user file');
  const store = new AuthorStore(root, profile, {}, []);
  await assert.rejects(store.prepare(), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(root, preferred), 'utf8'), 'existing user file');
  await fs.unlink(path.join(root, preferred));
  await fs.mkdir(path.join(root, preferred));
  await fs.mkdir(path.join(root, 'neowow_另一昵称_' + profile.uuid));
  await assert.rejects(resolveAuthorDirectory(root, profile), /多个相同平台和作者 ID/);
  assert.equal(
    await resolveAuthorDirectory(path.join(root, preferred), profile),
    path.join(root, preferred)
  );
});
test('Author folder naming rejects missing, unsafe and overlong IDs instead of truncating identity', () => {
  for (const uuid of [
    '',
    undefined,
    2089693700369928192,
    '../escape',
    'id/escape',
    'a'.repeat(256)
  ])
    assert.throws(() => authorFolderName({ ...profile, uuid }));
  const name = authorFolderName({ ...profile, author: '很长的作者名字'.repeat(40) });
  assert.ok(name.endsWith('_' + profile.uuid));
  assert.ok(name.length <= 240);
});
