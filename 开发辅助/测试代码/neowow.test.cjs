'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm');
const registry = require('../../src/platforms/registry.cjs');
const { normalize, markdown } = require('../../src/normalize.cjs');
const { siteForUrl } = require('../../src/services/independent-browser.cjs');
const fixture = require('./fixtures/neowow.cjs');
const adapter = registry.getAdapter('neowow');
function read(
  snapshot = fixture().snapshot,
  { login = false, loading = false, pathname = '/workflow', search = '?sessionId=fixture' } = {}
) {
  const el = { getClientRects: () => [1] };
  const flow = { component: { type: { __name: 'VueFlow' }, props: snapshot, subTree: { el } }, el };
  // Production builds expose the vnode tree without __vueParentComponent.
  const root = {
    _vnode: {
      component: {
        type: { __name: 'App' },
        subTree: { children: [{ suspense: { activeBranch: flow } }] }
      }
    }
  };
  root._vnode.children = [root._vnode]; // Protect against cyclic structures.
  return vm.runInNewContext('(' + adapter.page.readCanvas.toString() + ')()', {
    URL,
    document: {
      title: '合成公开画布 · NeoWOW',
      querySelector: (s) => (s === '#app' ? root : null),
      querySelectorAll: (s) =>
        s === 'h2' && login
          ? [{ ...el, textContent: '欢迎登录' }]
          : s.includes('.loading-overlay') && loading
            ? [el]
            : []
    },
    location: { hostname: 'neowow.cn', pathname, href: 'https://neowow.cn' + pathname + search }
  });
}
test('NeoWow registers specific work, canvas and share URLs and its own persistent login partition', () => {
  assert.equal(registry.resolvePlatform('https://neowow.cn/neo-tv').platform, 'neowow');
  for (const path of [
    '/workflow?sessionId=x',
    '/ai-workflow?sessionId=x',
    '/workflows?shareCode=x',
    '/video-works-view?id=885',
    '/video-works-view?sessionId=SSN_1'
  ])
    assert.doesNotThrow(() => adapter.validateWorkUrl('https://neowow.cn' + path));
  for (const path of ['/', '/neo-tv', '/workflows', '/workflow', '/video-works-view'])
    assert.throws(() => adapter.validateWorkUrl('https://neowow.cn' + path), {
      code: 'INVALID_WORK_URL'
    });
  assert.throws(() =>
    registry.resolvePlatform('https://neowow.cn.evil.example/workflow?sessionId=x')
  );
  assert.equal(siteForUrl('https://neowow.cn/neo-tv').partition, 'persist:neowow');
  assert.equal(
    adapter.leftWork(
      new URL('https://neowow.cn/workflow?sessionId=y'),
      new URL('https://neowow.cn/workflow?sessionId=x')
    ),
    true
  );
  assert.equal(
    adapter.leftWork(
      new URL('https://neowow.cn/video-works-view?id=885&index=1'),
      new URL('https://neowow.cn/video-works-view?id=885')
    ),
    false
  );
  assert.equal(registry.permittedUrl('neowow', 'https://neowow.cn.evil.example/'), false);
});
test('Production Vue vnode traversal reads all nodes, strips secrets and keeps only edge primitives', () => {
  const f = fixture();
  f.snapshot.nodes[3].data.seedAudioConfig = {
    token: 'secret',
    nested: { apiKey: 'secret', sampleRate: 24000 }
  };
  f.snapshot.nodes[3].data.history = ['unrelated'];
  f.snapshot.edges[0].sourceNode = f.snapshot.nodes[1];
  const result = read(f.snapshot);
  assert.equal(result.nodes.length, 10);
  assert.equal(result.edges.length, 4);
  assert.equal(result.nodes[1].data.content, '当前正文');
  assert.equal(result.nodes[3].parentId, 'group');
  assert.equal(result.nodes[7].type, 'video');
  assert.equal(result.nodes[9].type, 'image');
  assert.equal(result.nodes[3].data.history, undefined);
  assert.equal(result.nodes[3].data.seedAudioConfig.token, undefined);
  assert.equal(result.nodes[3].data.seedAudioConfig.nested.apiKey, undefined);
  assert.equal(result.edges[0].sourceNode, undefined);
  assert.equal(result.workIdentity, 'neowow:canvas:fixture');
  assert.equal(read({ nodes: [], edges: [] }).found, true);
  assert.equal(read(undefined, { login: true }).found, false);
  assert.equal(read(undefined, { loading: true }).found, false);
  assert.equal(read(undefined, { pathname: '/neo-tv', search: '' }).found, false);
});
test('NeoWow preserves current outputs, typed references, audio prompt and universal video parameters', () => {
  const result = normalize(read(), fixture().metadata);
  const image = result.entries.find((e) => e.nodeId === 'image'),
    video = result.entries.find((e) => e.nodeId === 'video');
  assert.equal(image.kind, 'image_reference');
  assert.equal(image.referenceTexts[0].textMismatch, true);
  assert.equal(image.referenceTexts[0].text, '参数中的正文');
  assert.equal(result.entries.find((e) => e.nodeId === 'text').prompt, '当前正文');
  assert.equal(video.settings.duration, '15');
  assert.equal(video.settings.resolution, '1080p');
  assert.equal(video.settings.ratio, '21:9');
  assert.equal(video.model, 'Seedance 2.5');
  assert.equal(video.referenceTexts[0].text, '参数文本快照');
  assert.equal(
    video.references.filter((r) => r.type === 'image')[0].url,
    'https://cdn.example.com/manual.png'
  );
  assert.ok(video.references.find((r) => r.nodeId === 'image').evidence.includes('canvas-edge'));
  assert.ok(video.references.find((r) => r.nodeId === 'audio').assetIds.length);
  assert.equal(result.entries.find((e) => e.nodeId === 'audio').prompt, '实际语音提示词');
  assert.ok(!result.entries.some((e) => ['upload-audio', 'derived'].includes(e.nodeId)));
  assert.ok(!result.assets.some((a) => /stale|removed/.test(a.url)));
  assert.ok(result.assets.some((a) => a.url.endsWith('composed.mp4')));
  assert.ok(result.assets.some((a) => a.url.endsWith('compressed.mp4')));
  assert.equal(result.assets.find((a) => a.nodeIds.includes('upload')).source, 'uploaded');
  assert.equal(result.assets.filter((a) => a.url.endsWith('result.png')).length, 1);
  assert.equal(result.diagnostics.completeness, 'unverified');
  assert.equal(result.diagnostics.unsupportedNodes.length, 0);
  assert.match(markdown(result), /实际语音提示词/);
});
test('Known CDN aliases match source nodes; stale source IDs and unknown nodes retain diagnostics', () => {
  const f = fixture();
  const video = f.snapshot.nodes[4].data;
  video.connectedImageUrls = ['https://wlpaas.oss-accelerate.aliyuncs.com/fixture/result.png'];
  video.referenceDisplayOrder = {};
  const result = normalize(read(f.snapshot), f.metadata);
  assert.ok(
    result.entries
      .find((e) => e.nodeId === 'video')
      .references.some((r) => r.nodeId === 'image' && r.evidence.includes('parameter-reference'))
  );
  f.snapshot.nodes[3].data.connectedSourceMap = { 'https://cdn.example.com/older.png': 'upload' };
  f.snapshot.nodes[3].data.connectedImageUrls = ['https://cdn.example.com/older.png'];
  f.snapshot.nodes.push({ id: 'future', type: 'future-node', data: {} });
  const changed = normalize(read(f.snapshot), f.metadata);
  const ref = changed.entries
    .find((e) => e.nodeId === 'image')
    .references.find((r) => r.url?.endsWith('older.png'));
  assert.notEqual(ref.nodeId, 'upload');
  assert.ok(ref.assetIds.length);
  assert.equal(changed.diagnostics.completeness, 'partial');
  assert.equal(changed.diagnostics.unsupportedNodes[0].nodeId, 'future');
});
test('Reader scales to a large canvas without depending on visible DOM nodes', () => {
  const snapshot = {
    nodes: Array.from({ length: 1619 }, (_, i) => ({
      id: String(i),
      type: 'text',
      data: { result: '正文 ' + i }
    })),
    edges: []
  };
  assert.equal(read(snapshot).nodes.length, 1619);
});

test('NeoWow access failures explain login and reward requirements without mislabeling a work as private', () => {
  for (const [text, process, login, expected] of [
    ['', '赞赏查看创作过程', false, /赞赏授权/],
    ['', '查看制作过程', true, /Chrome 登录不会自动共享/]
  ]) {
    const visible = { getClientRects: () => [1] };
    const doc = {
      body: { innerText: text },
      innerText: text,
      querySelector: () => null,
      querySelectorAll: (s) =>
        s.includes('.rwd-dialog') && process === '赞赏查看创作过程'
          ? [visible]
          : s === 'button'
            ? [{ ...visible, textContent: process }]
            : s === 'h2' && login
              ? [{ ...visible, textContent: '欢迎登录' }]
              : []
    };
    const inspected = vm.runInNewContext('(' + adapter.page.inspectWork.toString() + ')()', {
      URL,
      document: doc,
      location: {
        protocol: 'https:',
        pathname: '/video-works-view',
        href: 'https://neowow.cn/video-works-view?id=1'
      }
    });
    assert.match(inspected.accessError, expected);
    assert.equal(inspected.detailReady, false);
  }
});

test('Detail not-ready fallback opens only the exact public canvas and checks existing reward access', async () => {
  async function open({
    id = '885',
    reward = false,
    authorized = false,
    token = 'fixture-session'
  } = {}) {
    const requests = [],
      previews = [];
    const doc = {
      body: { innerText: '创作过程正在收录中' },
      querySelector: () => doc,
      querySelectorAll: () => []
    };
    const outcome = await vm.runInNewContext(
      '(' + adapter.page.openCanvas.toString() + ')(true,true)',
      {
        URL,
        AbortSignal,
        document: doc,
        window: { openCanvasPreview: (data) => previews.push(data) },
        location: {
          pathname: '/video-works-view',
          href: 'https://neowow.cn/video-works-view?id=885'
        },
        localStorage: { getItem: (key) => (key === 'token' ? token : null) },
        fetch: async (url, options) => {
          requests.push({ url, body: JSON.parse(options.body) });
          return {
            ok: true,
            json: async () =>
              url.endsWith('/has-rewarded')
                ? { success: true, data: authorized }
                : {
                    success: true,
                    data: [
                      {
                        id,
                        title: '公开作品',
                        sessionId: 'SSN_fixture',
                        isPublic: 1,
                        dataType: 2,
                        isReward: reward ? 1 : 0
                      }
                    ]
                  }
          };
        }
      }
    );
    return { outcome, requests, previews };
  }
  const free = await open();
  assert.equal(free.outcome.clicked, true);
  assert.equal(free.previews[0].templateCode, 'SSN_fixture');
  assert.deepEqual(
    free.requests.map((r) => r.url),
    ['/ucenter/video-showcase/queryByLogin']
  );
  const mismatch = await open({ id: 'other' });
  assert.equal(mismatch.previews.length, 0);
  assert.match(mismatch.outcome.accessError, /未返回可访问/);
  const unpaid = await open({ reward: true });
  assert.equal(unpaid.previews.length, 0);
  assert.match(unpaid.outcome.accessError, /赞赏授权/);
  assert.equal((await open({ reward: true, authorized: true })).previews.length, 1);
  const guest = await open({ token: '' });
  assert.equal(guest.requests.length, 0);
  assert.match(guest.outcome.accessError, /登录/);
});
