'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  createColorTagIndex,
  inheritColorTags,
  COLOR_TAGS,
  matchesColorTags
} = require('../../src/color-tags.cjs');
const { ColorTagStore, TAG_FILE } = require('../../src/services/color-tags.cjs');
const { namespaceResult, mergeResults, AuthorStore } = require('../../src/author-library.cjs');
const { ProjectStore } = require('../../src/project-store.cjs');
const { normalize } = require('../../src/normalize.cjs');
const { contentFingerprint } = require('../../src/project-identity.cjs');

function fixture() {
  return normalize(
    {
      nodes: [
        {
          id: 'image',
          type: 'image',
          data: {
            action: 'image_generate',
            name: '图片生成',
            params: { prompt: '测试图片' },
            url: ['https://cdn.example.com/output.png']
          }
        },
        { id: 'text', type: 'text', data: { text: '没有媒体的文本节点' } },
        {
          id: 'other',
          type: 'image',
          data: {
            action: 'image_generate',
            name: '另一个节点',
            params: { prompt: '另一张图' },
            url: ['https://cdn.example.com/other.png']
          }
        }
      ],
      edges: [],
      source: 'fixture'
    },
    {
      platform: 'liblib',
      inputUrl: 'https://www.liblib.tv/detail/work-one',
      author: '测试',
      title: '标签项目'
    }
  );
}
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'color-tags-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('The five swatches use exact reference RGB values and gray is the no-tag option', () => {
  assert.deepEqual(
    COLOR_TAGS.map((t) => t.color),
    ['#000000', 'var(--tag-none)', '#fd6460', '#f2d051', '#6fc958', '#52b7f4', '#d08ce0']
  );
  assert.equal(COLOR_TAGS[0].id, 'excluded');
  assert.equal(COLOR_TAGS[1].id, 'none');
});
test('Excluded-only mode overrides color unions without changing their selection, and normal browsing hides exclusions', () => {
  const colors = new Set(['red', 'blue']);
  assert.equal(matchesColorTags('excluded', new Set()), false);
  assert.equal(matchesColorTags('excluded', colors), false);
  assert.equal(matchesColorTags('red', colors), true);
  assert.equal(matchesColorTags('green', colors), false);
  for (const color of COLOR_TAGS.map((t) => t.id))
    assert.equal(matchesColorTags(color, colors, true), color === 'excluded');
  assert.deepEqual([...colors], ['red', 'blue']);
  assert.equal(matchesColorTags('red', colors, false), true);
});
test('Exclusions persist through restart and portable inheritance, and a gray tag restores the item', async (t) => {
  const dir = await temporary(t),
    file = path.join(dir, 'tags.json'),
    r = fixture(),
    index = createColorTagIndex(r);
  const item = r.entries[0],
    key = index.key(item),
    store = new ColorTagStore(file);
  await store.set(key, 'excluded');
  new ColorTagStore(file).apply(r);
  assert.equal(item.colorTag, 'excluded');
  const fresh = fixture();
  inheritColorTags(fresh, r);
  assert.equal(fresh.entries[0].colorTag, 'excluded');
  await store.set(key, 'none');
  new ColorTagStore(file).apply(r);
  assert.equal(item.colorTag, 'none');
  assert.equal(matchesColorTags(item.colorTag, new Set()), true);
});
test('A generation node and all its outputs share a tag without tagging unrelated nodes or referenced inputs', () => {
  const r = fixture(),
    index = createColorTagIndex(r),
    e = r.entries.find((e) => e.nodeId === 'image'),
    a = r.assets.find((a) => a.nodeIds.includes('image'));
  e.references.push({
    nodeId: 'other',
    assetIds: [r.assets.find((a) => a.nodeIds.includes('other')).id]
  });
  assert.equal(index.key(e), index.key(a));
  assert.equal(index.color(e), 'none');
  index.set(index.key(a), 'red');
  assert.equal(e.colorTag, 'red');
  assert.equal(index.color(r.entries.find((e) => e.nodeId === 'other')), 'none');
  index.set(index.key(e), 'none');
  assert.equal(a.colorTag, 'none');
  assert.throws(() => index.set(index.key(e), 'orange'), /颜色无效/);
});
test('Tags survive author namespacing and same node IDs in other works remain independent', () => {
  const r = fixture(),
    namespaced = namespaceResult(r, { id: 'work-one', title: '标签项目' });
  const key = createColorTagIndex(r).key(r.entries[0]);
  assert.equal(createColorTagIndex(namespaced).key(namespaced.entries[0]), key);
  const other = namespaceResult(r, { id: 'work-two', title: '标签项目' });
  assert.notEqual(createColorTagIndex(other).key(other.entries[0]), key);
  namespaced.assets.push({
    id: 'standalone',
    name: '成片',
    kind: 'video',
    role: 'full-video',
    nodeIds: [],
    url: 'https://cdn.example.com/full.mp4?token=first'
  });
  const clone = structuredClone(namespaced);
  clone.assets.at(-1).url = 'https://cdn.example.com/full.mp4?token=second';
  assert.equal(
    createColorTagIndex(namespaced).key(namespaced.assets.at(-1)),
    createColorTagIndex(clone).key(clone.assets.at(-1))
  );
});
test('Nodes sharing the same generated output stay synchronized across every entry and asset view', () => {
  const r = fixture();
  const first = r.entries.find((e) => e.nodeId === 'image'),
    other = r.entries.find((e) => e.nodeId === 'other');
  other.outputAssetIds.push(first.outputAssetIds[0]);
  const index = createColorTagIndex(r);
  index.set(index.key(other), 'yellow');
  assert.equal(first.colorTag, 'yellow');
  assert.equal(r.assets.find((a) => a.nodeIds.includes('image')).colorTag, 'yellow');
  assert.equal(r.assets.find((a) => a.nodeIds.includes('other')).colorTag, 'yellow');
});
test('Tag storage serializes rapid edits, survives restart and keeps explicit gray clears', async (t) => {
  const dir = await temporary(t),
    file = path.join(dir, 'tags.json'),
    store = new ColorTagStore(file);
  const r = fixture(),
    index = createColorTagIndex(r),
    key = index.key(r.entries[0]);
  await Promise.all([
    store.set(key, 'red'),
    store.set(key, 'blue'),
    store.set('another-key', 'green')
  ]);
  const reopened = new ColorTagStore(file);
  reopened.apply(r);
  assert.equal(r.entries[0].colorTag, 'blue');
  assert.equal(reopened.tags.get('another-key'), 'green');
  await reopened.set(key, 'none');
  r.entries[0].colorTag = 'purple';
  new ColorTagStore(file).apply(r);
  assert.equal(r.entries[0].colorTag, 'none');
  await assert.rejects(reopened.set(key, 'invalid'), /无效/);
  const unavailable = new ColorTagStore(path.join(dir, 'missing', 'tags.json'));
  await assert.rejects(unavailable.set(key, 'red'));
  assert.equal(unavailable.tags.size, 0);
});
test('Portable tags survive save, relocation, reopen and online content updates without changing fingerprints', async (t) => {
  const dir = await temporary(t),
    r = fixture(),
    before = contentFingerprint(r),
    index = createColorTagIndex(r);
  index.set(index.key(r.entries.find((e) => e.nodeId === 'image')), 'purple');
  assert.equal(contentFingerprint(r), before);
  const store = new ProjectStore(dir);
  await store.create(r, { kinds: ['image', 'text'], mode: 'full' }, false);
  const moved = path.join(dir, 'moved');
  await fs.rename(store.directory, moved);
  const loaded = new ProjectStore(dir);
  await loaded.load(moved);
  assert.equal(loaded.result.entries.find((e) => e.nodeId === 'image').colorTag, 'purple');
  const updated = fixture();
  updated.entries[0].prompt = '线上提示词已更新';
  await new ProjectStore(dir, { folderName: 'moved' }).create(updated, {}, false);
  assert.equal(updated.entries.find((e) => e.nodeId === 'image').colorTag, 'purple');
  const cleared = fixture();
  cleared.entries[0].colorTag = 'none';
  inheritColorTags(cleared, r);
  assert.equal(cleared.entries[0].colorTag, 'none');
});
test('Canvas folders own independent tag files; changing and clearing labels never creates an application-wide file', async (t) => {
  const dir = await temporary(t),
    a = new ProjectStore(path.join(dir, 'one')),
    b = new ProjectStore(path.join(dir, 'two'));
  await a.create(fixture(), {}, false);
  await b.create(fixture(), {}, false);
  const key = createColorTagIndex(a.result).key(a.result.entries[0]);
  await a.setColorTag(key, 'blue');
  await b.setColorTag(key, 'green');
  const savedA = JSON.parse(await fs.readFile(path.join(a.directory, TAG_FILE), 'utf8'));
  const savedB = JSON.parse(await fs.readFile(path.join(b.directory, TAG_FILE), 'utf8'));
  assert.deepEqual(savedA.tags, { [key]: 'blue' });
  assert.deepEqual(savedB.tags, { [key]: 'green' });
  await a.setColorTag(key, 'none');
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(a.directory, TAG_FILE), 'utf8')).tags,
    {}
  );
  const reopenedA = new ProjectStore(dir),
    reopenedB = new ProjectStore(dir);
  await reopenedA.load(a.directory);
  await reopenedB.load(b.directory);
  assert.equal(reopenedA.result.entries[0].colorTag, 'none');
  assert.equal(reopenedB.result.entries[0].colorTag, 'green');
  await assert.rejects(fs.access(path.join(dir, TAG_FILE)), { code: 'ENOENT' });
});
test('Old application-wide tags are ignored on open and reread; only per-canvas labels are saved', async (t) => {
  const dir = await temporary(t),
    profile = path.join(dir, '.runtime', 'profile'),
    legacyFile = path.join(profile, 'color-tags.json');
  const data = fixture(),
    key = createColorTagIndex(data).key(data.entries[0]);
  const old = { schemaVersion: 1, tags: { [key]: 'red', 'unrelated-work': 'purple' } };
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(legacyFile, JSON.stringify(old));
  const store = new ProjectStore(dir);
  await store.create(data, {}, false);
  await fs.unlink(path.join(store.directory, TAG_FILE));
  const reopened = new ProjectStore(dir);
  await reopened.load(store.directory);
  assert.equal(createColorTagIndex(reopened.result).color(reopened.result.entries[0]), 'none');
  await assert.rejects(fs.access(path.join(store.directory, TAG_FILE)), { code: 'ENOENT' });
  const reread = fixture();
  await new ProjectStore(dir).restoreColorTags(reread);
  assert.equal(createColorTagIndex(reread).color(reread.entries[0]), 'none');
  await assert.rejects(fs.access(path.join(store.directory, TAG_FILE)), { code: 'ENOENT' });
  await reopened.setColorTag(key, 'blue');
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(store.directory, TAG_FILE), 'utf8')).tags,
    { [key]: 'blue' }
  );
  await reopened.setColorTag(key, 'none');
  const again = new ProjectStore(dir);
  await again.load(store.directory);
  assert.equal(again.result.entries[0].colorTag, 'none');
  assert.equal(await fs.readFile(legacyFile, 'utf8'), JSON.stringify(old));
});
test('Author collections save each work label in its own canvas folder and restore labels on a new online read', async (t) => {
  const dir = await temporary(t),
    works = ['work-one', 'work-two'].map((id) => ({
      id,
      title: id,
      url: 'https://www.liblib.tv/detail/' + id
    }));
  const profile = {
    platform: 'liblib',
    author: '测试',
    uuid: 'author',
    url: 'https://liblib.tv/profile?uuid=author',
    works
  };
  const records = works.map((work) => {
    const r = fixture();
    r.metadata.inputUrl = work.url;
    return { work, result: namespaceResult(r, work) };
  });
  const aggregate = mergeResults(
    profile,
    new Map(records.map((r) => [r.work.id, r.result])),
    works.map((w) => w.id)
  );
  const collection = new AuthorStore(dir, profile, aggregate, records);
  const key = createColorTagIndex(records[1].result).key(records[1].result.entries[0]);
  await collection.setColorTag(key, 'excluded');
  for (const record of records) {
    const tags = JSON.parse(
      await fs.readFile(path.join(record.store.directory, TAG_FILE), 'utf8')
    ).tags;
    assert.deepEqual(tags, record === records[1] ? { [key]: 'excluded' } : {});
  }
  await assert.rejects(fs.access(path.join(collection.directory, TAG_FILE)), { code: 'ENOENT' });
  const fresh = fixture();
  fresh.metadata.inputUrl = works[1].url;
  const next = namespaceResult(fresh, works[1]);
  await new ProjectStore(collection.directory).restoreColorTags(next);
  assert.equal(next.entries[0].colorTag, 'excluded');
});
