'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { ProjectStore, MANIFEST } = require('../../src/project-store.cjs');
const { normalize } = require('../../src/normalize.cjs'),
  { markdown } = require('../../src/export/markdown.cjs');
const fixtures = require('./fixtures/text-platforms.cjs');
test('Old schema-2 records without adapter metadata remain readable and exportable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-v12-compat-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sample = fixtures.liblib(),
    result = normalize(sample.snapshot, sample.metadata);
  delete result.metadata.applicationVersion;
  delete result.metadata.adapterVersion;
  const store = new ProjectStore(root);
  await store.create(result, { kinds: ['text'], split: false });
  const loaded = await new ProjectStore(root).load(store.directory);
  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.metadata.adapterVersion, undefined);
  assert.match(markdown(loaded), /提取说明/);
});
test('Saved projects from an uninstalled brand open offline, with strict schema and path checks intact', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-v12-offline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sample = fixtures.liblib(),
    result = normalize(sample.snapshot, sample.metadata);
  result.metadata.platform = 'archived-brand';
  result.metadata.inputUrl = result.metadata.canvasUrl = 'https://archived.example.com/canvas/1';
  const store = new ProjectStore(root);
  await store.create(result, { kinds: ['text'], split: false });
  const loaded = await new ProjectStore(root).load(store.directory);
  assert.equal(loaded.metadata.platform, 'archived-brand');
  assert.ok(loaded.entries.length);
  const manifest = path.join(store.directory, MANIFEST),
    record = JSON.parse(await fs.readFile(manifest, 'utf8'));
  record.result.metadata.platform = '../escape';
  await fs.writeFile(manifest, JSON.stringify(record));
  await assert.rejects(new ProjectStore(root).load(store.directory), /格式无效/);
});
test('LibTV and Jimeng preserve the v1.1 extraction/export golden results on representative text and references', () => {
  const golden = require('./fixtures/v11-golden.json');
  for (const brand of ['liblib', 'jimeng']) {
    const sample = fixtures[brand](),
      actual = normalize(sample.snapshot, sample.metadata);
    delete actual.metadata.applicationVersion;
    delete actual.metadata.adapterVersion;
    actual.metadata.extractedAt = golden[brand].metadata.extractedAt;
    delete actual.diagnostics.completeness;
    delete actual.diagnostics.completenessIssues;
    delete actual.diagnostics.unsupportedNodes;
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), golden[brand]);
    assert.equal(markdown(actual), markdown(golden[brand]));
  }
});
