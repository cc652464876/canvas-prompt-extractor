'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm');
const registry = require('../../src/platforms/registry.cjs');
const { normalize, markdown } = require('../../src/normalize.cjs');
const fixture = require('./fixtures/tapnow.cjs');
const adapter = registry.getAdapter('tapnow');
function read(raw = fixture().snapshot, pathname = '/home/taptv/9/fixture') {
  const root = { __reactFiber_fixture: { memoizedProps: raw } };
  return vm.runInNewContext('(' + adapter.page.readCanvas.toString() + ')()', {
    document: {
      title: '合成画布 | TapNow｜你的智能体创意画布',
      querySelectorAll: (s) => (s.startsWith('.react-flow,') ? [root] : [])
    },
    location: { pathname, href: 'https://app.tapnow.plus' + pathname }
  });
}
test('TapNow URL checks reject lists and lookalike domains; process navigation stays on the work', () => {
  assert.equal(registry.resolvePlatform(fixture().metadata.inputUrl).platform, 'tapnow');
  assert.throws(() => registry.resolvePlatform('https://app.tapnow.plus.evil.example/canvas/x'));
  assert.throws(() => adapter.validateWorkUrl('https://app.tapnow.plus/home/taptv'), {
    code: 'INVALID_WORK_URL'
  });
  assert.doesNotThrow(() => adapter.validateWorkUrl('https://app.tapnow.plus/canvas/x'));
  assert.equal(adapter.isCanvasUrl(new URL('https://app.tapnow.plus/canvas/x')), true);
  assert.equal(
    adapter.leftWork(
      new URL('https://app.tapnow.plus/canvas/y'),
      new URL('https://app.tapnow.plus/canvas/x')
    ),
    true
  );
  assert.equal(
    adapter.leftWork(
      new URL(fixture().metadata.inputUrl + '?order=recommendation_score'),
      new URL(fixture().metadata.inputUrl)
    ),
    false
  );
  assert.equal(read(undefined, '/home/taptv').found, false);
});
test('TapNow self-contained injection keeps content, removes secrets and preserves empty canvas', () => {
  const f = fixture();
  f.snapshot.nodes[3].data.params.accessToken = 'secret';
  f.snapshot.nodes[3].created_by = 'private-account-id';
  f.snapshot.nodes[3].data.elementPromptSnapshots = { old: 'historical prompt' };
  const s = read(f.snapshot);
  assert.equal(s.nodes.length, 9);
  assert.equal(s.edges.length, 3);
  assert.equal(s.canvasTitle, '合成画布');
  assert.equal(s.nodes[3].data.params.accessToken, undefined);
  assert.equal(s.nodes[3].created_by, undefined);
  assert.equal(s.nodes[3].data.elementPromptSnapshots, undefined);
  assert.equal(s.nodes[8].type, 'text');
  assert.equal(s.expectedNodes, null);
  assert.equal(read({ nodes: [], edges: [] }).found, true);
});
test('TapNow normalization distinguishes uploaded audio from generation and links ordered parameter refs', () => {
  const r = normalize(read(), fixture().metadata),
    v = r.entries.find((e) => e.nodeId === 'video');
  assert.equal(v.kind, 'video');
  assert.equal(v.settings.duration, 30);
  assert.equal(v.settings.count, 1);
  assert.equal(v.model, 'seedance-2.5');
  assert.equal(v.references.find((r) => r.marker === 'image 1').nodeId, 'upload');
  assert.ok(v.references.find((r) => r.nodeId === 'upload').evidence.includes('canvas-edge'));
  assert.ok(v.references.find((r) => r.nodeId === 'vocal').assetIds.length);
  assert.equal(v.referenceTexts[0].text, '参数中的文本');
  assert.equal(v.referenceTexts[0].textMismatch, true);
  assert.equal(r.entries.find((e) => e.nodeId === 'image').kind, 'image_text');
  assert.ok(r.entries.every((e) => e.nodeId !== 'vocal'));
  assert.equal(r.assets.filter((a) => a.url === 'https://files.tapnow.media/video').length, 1);
  assert.equal(r.assets.find((a) => a.nodeIds.includes('vocal')).source, 'uploaded');
  assert.equal(r.assets.find((a) => a.nodeIds.includes('upload')).width, 1600);
  assert.equal(r.assets.find((a) => a.nodeIds.includes('video')).duration, 30);
  assert.ok(r.assets.some((a) => a.nodeIds.includes('upscale')));
  assert.ok(r.assets.every((a) => !a.nodeIds.includes('failed')));
  assert.equal(r.diagnostics.completeness, 'unverified');
  assert.deepEqual(r.diagnostics.unsupportedNodes, []);
  assert.match(markdown(r), /Image1 进入森林/);
});
test('External and repeated TapNow reference URLs retain positions without fabricating node matches', () => {
  const f = fixture();
  f.snapshot.nodes[3].data.params.images = [
    'https://files.tapnow.media/external',
    'https://files.tapnow.media/external',
    'https://'
  ];
  const r = normalize(read(f.snapshot), f.metadata),
    refs = r.entries.find((e) => e.nodeId === 'video').references;
  for (const marker of ['image 1', 'image 2'])
    assert.ok(refs.find((r) => r.marker === marker).assetIds.length);
  assert.ok(refs.every((r) => r.url !== 'https://'));
  assert.equal(r.assets.filter((a) => a.url === 'https://files.tapnow.media/external').length, 1);
  assert.ok(refs.find((r) => r.nodeId === 'upload').evidence.every((e) => e === 'canvas-edge'));
});
test('TapNow unknown nodes and comment content stay visible in diagnostics and text', () => {
  const f = fixture();
  f.snapshot.nodes[8].data.comments = [{ content: '制作备注' }];
  f.snapshot.nodes.push({ id: 'unknown', type: 'future-node', data: { title: '未知' } });
  const r = normalize(read(f.snapshot), f.metadata);
  assert.equal(r.entries.find((e) => e.nodeId === 'comment').prompt, '制作备注');
  assert.equal(r.diagnostics.completeness, 'partial');
  assert.equal(r.diagnostics.unsupportedNodes[0].nodeId, 'unknown');
});
