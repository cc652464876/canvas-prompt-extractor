'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm');
const {
  createRegistry,
  getAdapter,
  listPlatforms,
  resolvePlatform,
  matchesFrame,
  permittedUrl
} = require('../../src/platforms/registry.cjs');
const { normalize } = require('../../src/normalize.cjs');
const { TaskScope } = require('../../src/services/task-scope.cjs');
const { snapshotSignature } = require('../../src/services/snapshot-stability.cjs');
const fixtures = require('./fixtures/text-platforms.cjs');
function registration(id, load) {
  return {
    metadata: {
      id,
      name: id,
      version: 'test',
      homeUrl: 'https://' + id + '.example.com/',
      workHosts: [id + '.example.com'],
      frameHosts: [id + '.example.com'],
      navigationDomains: [id + '.example.com'],
      capabilities: { text: true }
    },
    load
  };
}
test('A third brand plugs into URL routing, text, parsing and assets without changing public services', () => {
  const adapter = {
    ...getAdapter('liblib'),
    cleanText: (value) => value.replace(/^brand-prefix:/, ''),
    textFields: ['brandText'],
    parseGeneration: () => ({
      kind: null,
      prompt: '',
      references: [],
      settings: {},
      model: '',
      promptSource: '',
      extra: {},
      explicit: [],
      warnings: []
    }),
    collectAssets: () => {}
  };
  const registry = createRegistry([registration('third', () => adapter)]);
  assert.equal(registry.resolvePlatform('https://third.example.com/canvas/1').platform, 'third');
  const r = normalize(
    {
      nodes: [
        { id: 'text', type: 'text', data: { name: '第三品牌文本', brandText: 'brand-prefix:正文' } }
      ],
      edges: [],
      frameUrl: 'https://third.example.com/canvas/1',
      expectedNodes: 1,
      expectedEdges: 0
    },
    {
      platform: 'third',
      inputUrl: 'https://third.example.com/canvas/1',
      title: '项目',
      author: '测试'
    },
    registry
  );
  assert.equal(r.entries[0].prompt, '正文');
  assert.equal(r.metadata.adapterVersion, 'test');
  assert.equal(r.diagnostics.completeness, 'complete');
  assert.deepEqual(r.assets, []);
});
test('A failing brand stays lazy and cannot prevent another brand from loading', () => {
  let failures = 0;
  const healthy = getAdapter('jimeng');
  const registry = createRegistry([
    registration('broken', () => {
      failures++;
      throw new Error('Changed page module');
    }),
    registration('healthy', () => healthy)
  ]);
  assert.equal(failures, 0);
  assert.equal(registry.listPlatforms().length, 2);
  assert.throws(
    () => registry.getAdapter('broken'),
    (e) => e.code === 'ADAPTER_UNAVAILABLE' && e.platform === 'broken'
  );
  assert.equal(registry.getAdapter('healthy').id, 'healthy');
  assert.equal(failures, 1);
});
test('URL/frame policies reject lookalike hosts, credentials, query-string host tricks and other brands', () => {
  assert.deepEqual(
    listPlatforms().map((p) => p.id),
    ['liblib', 'jimeng', 'rhtv', 'tapnow']
  );
  assert.equal(resolvePlatform('https://www.liblib.tv/detail/1').platform, 'liblib');
  assert.equal(resolvePlatform('https://jimeng.jianying.com/s/a').platform, 'jimeng');
  assert.equal(resolvePlatform('https://rhtv.runninghub.cn/project/canvas/1').platform, 'rhtv');
  for (const value of [
    'https://liblib.tv.evil.example/canvas',
    'https://evil.example/?site=liblib.tv',
    'https://user:pass@liblib.tv/detail/1',
    'http://liblib.tv/detail/1'
  ])
    assert.throws(() => resolvePlatform(value));
  for (const value of [
    'https://www.xiaoyunque.com/home?work_id=1',
    'https://xiaoyunque.com/canvas?canvasId=1',
    'https://www.xiaoyunque.com/canvas-inspect?canvasId=1',
    'https://www.xiaoyunque.com/canvas-share?share_id=1'
  ])
    assert.throws(
      () => resolvePlatform(value),
      (e) => e.code === 'UNSUPPORTED_PLATFORM'
    );
  assert.throws(
    () => getAdapter('xiaoyunque'),
    (e) => e.code === 'UNSUPPORTED_PLATFORM'
  );
  assert.equal(matchesFrame('xiaoyunque', 'https://www.xiaoyunque.com/canvas?canvasId=1'), false);
  assert.equal(permittedUrl('xiaoyunque', 'https://www.xiaoyunque.com/'), false);
  assert.equal(matchesFrame('liblib', 'https://evil.example/liblib.tv'), false);
  assert.equal(matchesFrame('liblib', 'https://jimeng.jianying.com/ai-canvas/1'), false);
  assert.equal(permittedUrl('liblib', 'https://jimeng.jianying.com/'), false);
  assert.equal(permittedUrl('jimeng', 'https://www.liblib.tv/'), false);
  assert.equal(permittedUrl('liblib', 'about:blank'), true);
});
test('Each injected reader works in a bare page context without Node imports or application closures', () => {
  for (const platform of ['liblib', 'jimeng']) {
    const f = fixtures[platform](),
      snapshot = f.snapshot,
      root = {
        __reactFiber_fixture: {
          memoizedProps: { nodes: snapshot.nodes, edges: snapshot.edges },
          memoizedState: null
        }
      };
    if (platform === 'jimeng')
      root.__reactFiber_fixture.memoizedProps.value = {
        draft: { getDocument: () => snapshot },
        projectSnapshot: { name: '规范草稿' },
        canvasStore: {}
      };
    const document = {
      title: '画布',
      body: { innerText: `${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges` },
      querySelectorAll: (selector) => (selector.startsWith('.react-flow,') ? [root] : [])
    };
    const result = vm.runInNewContext(
      '(' + getAdapter(platform).page.readCanvas.toString() + ')()',
      { document, location: { href: f.metadata.inputUrl } }
    );
    assert.equal(result.nodes.length, snapshot.nodes.length);
    assert.equal(result.expectedNodes, snapshot.nodes.length);
    assert.equal(
      result.source,
      platform === 'jimeng' ? 'jimeng-draft-document' : 'react-flow-props'
    );
  }
});
test('Cancellation and superseded tokens cannot commit into a later extraction', () => {
  const scope = new TaskScope(),
    first = scope.begin('liblib', 'url');
  assert.throws(
    () => scope.begin('jimeng', 'url'),
    (e) => e.code === 'TASK_BUSY'
  );
  scope.cancel();
  assert.equal(first.controller.signal.aborted, true);
  assert.throws(
    () => scope.ensure(first),
    (e) => e.code === 'READ_CANCELLED'
  );
  scope.finish(first);
  const next = scope.begin('jimeng', 'next');
  assert.ok(next.id > first.id);
  scope.finish(first);
  assert.equal(scope.current, next);
  assert.throws(() => scope.ensure(first));
  scope.ensure(next);
});
test('Resource readiness and completeness declarations affect stability even when nodes do not change', () => {
  const base = { nodes: [], edges: [], mediaResources: {}, expectedNodes: 0, expectedEdges: 0 };
  assert.notEqual(
    snapshotSignature(base),
    snapshotSignature({
      ...base,
      mediaResources: { image: { urls: { download_url: 'https://cdn.example.com/a.png' } } }
    })
  );
  assert.notEqual(snapshotSignature(base), snapshotSignature({ ...base, expectedNodes: 1 }));
  assert.equal(snapshotSignature(base), snapshotSignature(structuredClone(base)));
});
test('Unknown nodes, unreadable text, missing counts and unresolved parts report distinct completeness states', () => {
  const meta = {
      platform: 'jimeng',
      inputUrl: 'https://jimeng.jianying.com/canvas',
      title: '测试',
      author: '测试'
    },
    snapshot = { nodes: [], edges: [], expectedNodes: 0, expectedEdges: 0 };
  assert.equal(normalize(snapshot, meta).diagnostics.completeness, 'complete');
  assert.equal(normalize({ nodes: [], edges: [] }, meta).diagnostics.completeness, 'unverified');
  const r = normalize(
    { ...snapshot, nodes: [{ id: 'new', type: 'future-node', data: {} }], expectedNodes: 1 },
    meta
  );
  assert.equal(r.diagnostics.completeness, 'partial');
  assert.deepEqual(r.diagnostics.unsupportedNodes, [{ nodeId: 'new', type: 'future-node' }]);
  const broken = normalize(
    {
      ...snapshot,
      nodes: [
        {
          id: 'v',
          type: 'video',
          data: { generationDraft: { kind: 'video', parts: [{ type: 'unknown-part' }] } }
        }
      ],
      expectedNodes: 1
    },
    meta
  );
  assert.equal(broken.diagnostics.completeness, 'partial');
  assert.match(broken.entries[0].prompt, /未解析片段/);
});
