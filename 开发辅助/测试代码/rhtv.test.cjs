'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm');
const registry = require('../../src/platforms/registry.cjs');
const { normalize, markdown } = require('../../src/normalize.cjs');
const fixture = require('./fixtures/rhtv.cjs');
function read(raw = fixture().snapshot, body = '') {
  const root = { __reactFiber_fixture: { memoizedProps: raw } };
  return vm.runInNewContext('(' + registry.getAdapter('rhtv').page.readCanvas.toString() + ')()', {
    document: {
      title: 'RHTV 合成验收丨RHTV',
      body: { innerText: body },
      querySelectorAll: (s) => (s.startsWith('.react-flow,') ? [root] : [])
    },
    location: { href: fixture().metadata.inputUrl }
  });
}
test('RHTV routes community and direct canvas links without accepting lookalike domains', () => {
  assert.equal(
    registry.resolvePlatform('https://rhtv.runninghub.cn/project/canvas/123').platform,
    'rhtv'
  );
  assert.equal(registry.resolvePlatform(fixture().metadata.inputUrl).platform, 'rhtv');
  assert.throws(() =>
    registry.resolvePlatform('https://rhtv.runninghub.cn.evil.example/project/canvas/123')
  );
  assert.equal(registry.matchesFrame('liblib', fixture().metadata.inputUrl), false);
  const adapter = registry.getAdapter('rhtv');
  assert.equal(adapter.isCanvasUrl(new URL('https://rhtv.runninghub.cn/project/canvas/123')), true);
  assert.equal(adapter.isCanvasUrl(new URL('https://rhtv.runninghub.cn/projects/canvas')), false);
  assert.equal(
    adapter.leftWork(
      new URL('https://rhtv.runninghub.cn/project/canvas/other'),
      new URL('https://rhtv.runninghub.cn/project/canvas/123')
    ),
    true
  );
  assert.equal(
    adapter.leftWork(new URL(fixture().metadata.inputUrl), new URL(fixture().metadata.inputUrl)),
    false
  );
});
test('RHTV reader maps native types, keeps text and strips credentials without inventing counts', () => {
  const f = fixture();
  f.snapshot.nodes[2].data.apiKey = 'secret';
  f.snapshot.nodes[2].data.params.accessToken = 'secret';
  const s = read(f.snapshot);
  assert.equal(s.nodes.length, 10);
  assert.equal(s.edges.length, 5);
  assert.equal(s.nodes[0].type, 'image');
  assert.equal(s.nodes[1].type, 'text');
  assert.equal(s.nodes[0].data.name, '角色.png');
  assert.equal(s.nodes[2].data.rhtvType, 'rh-image');
  assert.equal(s.nodes[2].data.apiKey, undefined);
  assert.equal(s.nodes[2].data.params.accessToken, undefined);
  assert.equal(s.expectedNodes, null);
  assert.equal(s.expectedEdges, null);
  const r = normalize(s, f.metadata);
  assert.equal(r.diagnostics.completeness, 'unverified');
  assert.equal(r.entries.find((e) => e.nodeId === 'image').prompt, '角色身处森林');
  assert.equal(r.entries.find((e) => e.nodeId === 'image').settings.count, 2);
  assert.equal(r.entries.find((e) => e.nodeId === 'image').kind, 'image_reference');
  assert.equal(r.entries.find((e) => e.nodeId === 'video').settings.duration, '15');
  assert.equal(
    r.entries.find((e) => e.nodeId === 'video').referenceTexts[0].text,
    '画布中的文本正文'
  );
  assert.deepEqual(r.diagnostics.unsupportedNodes, []);
});
test('RHTV media distinguishes output from tool input, deduplicates uploads and binds references', () => {
  const f = fixture(),
    r = normalize(read(), f.metadata);
  assert.equal(r.assets.filter((a) => a.url === 'https://cdn.example.com/music.mp3').length, 1);
  assert.ok(r.assets.some((a) => a.url.endsWith('enhanced.mov')));
  assert.ok(r.assets.some((a) => a.url.endsWith('vocal.flac')));
  assert.ok(r.assets.some((a) => a.url.endsWith('reshoot.mp4')));
  assert.ok(r.assets.every((a) => !a.nodeIds.includes('failed')));
  assert.ok(r.assets.every((a) => !a.url.includes('origin.example.com')));
  assert.equal(r.assets.find((a) => a.nodeIds.includes('crop')).source, 'unknown');
  assert.equal(r.assets.find((a) => a.nodeIds.includes('uploaded')).width, undefined);
  const image = r.entries.find((e) => e.nodeId === 'image');
  assert.ok(
    image.references.find((ref) => ref.nodeId === 'uploaded').evidence.includes('canvas-edge')
  );
  assert.ok(image.references.find((ref) => ref.nodeId === 'uploaded').assetIds.length);
  assert.match(markdown(r), /角色身处森林/);
});
test('Empty RHTV canvas succeeds and unknown platform nodes remain diagnostic', () => {
  assert.equal(read({ nodes: [], edges: [] }).found, true);
  const f = fixture();
  f.snapshot.nodes.push({ id: 'unknown', type: 'rh-director', data: { label: '3D导演' } });
  const r = normalize(read(f.snapshot, '11 nodes, 5 edges'), f.metadata);
  assert.equal(r.diagnostics.completeness, 'partial');
  assert.ok(r.diagnostics.completenessIssues.includes('UNSUPPORTED_NODES'));
});
test('RHTV inline parameter text and missing external media retain evidence without invalid URLs', () => {
  const f = fixture();
  f.snapshot.nodes.find((n) => n.id === 'video').data.params.textList = [
    { content: '参数中的独立正文' }
  ];
  f.snapshot.nodes.find((n) => n.id === 'image').data.params.refImage1 =
    'https://cdn.example.com/external.png';
  f.snapshot.nodes.find((n) => n.id === 'image').data.params.refImage2 = 'https://';
  const r = normalize(read(f.snapshot), f.metadata);
  const text = r.entries
    .find((e) => e.nodeId === 'video')
    .referenceTexts.find((ref) => ref.text === '参数中的独立正文');
  assert.ok(text.evidence.includes('parameter-reference'));
  const ref = r.entries
    .find((e) => e.nodeId === 'image')
    .references.find((ref) => ref.url?.endsWith('external.png'));
  assert.ok(ref.assetIds.length);
  assert.ok(r.assets.every((a) => a.url !== 'https://'));
});
