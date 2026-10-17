'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm');
const { getAdapter } = require('../../src/platforms/registry.cjs');
const readerFor = (platform) => getAdapter(platform).page;
function read(props, body, platform = 'liblib') {
  const root = {
      __reactFiber_fixture: { memoizedProps: props, memoizedState: null, return: null }
    },
    document = {
      title: '画布 - LibTV',
      body: { innerText: body },
      querySelectorAll: (selector) => (selector.startsWith('.react-flow,') ? [root] : [{}, {}])
    };
  return JSON.parse(
    JSON.stringify(
      vm.runInNewContext('(' + readerFor(platform).readCanvas.toString() + ')()', {
        document,
        location: { href: 'https://fixture.example.com/canvas' }
      })
    )
  );
}
test('LibTV page capture keeps array bodies and source/target handles', () => {
  const result = read(
    {
      nodes: [{ id: 't', type: 'text', data: { content: ['第一段', '第二段'] } }],
      edges: [{ id: 'e', source: 't', target: 'i', sourceHandle: 'source', targetHandle: 'target' }]
    },
    '1 node, 1 edge'
  );
  assert.deepEqual(result.nodes[0].data.content, ['第一段', '第二段']);
  assert.equal(result.edges[0].sourceHandle, 'source');
  assert.equal(result.edges[0].targetHandle, 'target');
  assert.equal(result.expectedNodes, 1);
  assert.equal(result.expectedEdges, 1);
});
test('Jimeng page capture uses canonical drafts and text prefixes instead of larger renderer state', () => {
  const canonical = {
    nodes: [
      { id: 't', type: 'text', layout: { x: 7, y: 9 }, data: { text: '\u0000rt-md:v1\n正文' } },
      {
        id: 'i',
        type: 'image',
        data: {
          generationDraft: {
            kind: 'image',
            references: [{ sourceInstanceId: 't', slotId: 'slot' }],
            parts: []
          }
        }
      }
    ],
    edges: [{ source: 't', target: 'i', type: 'reference' }]
  };
  const result = read(
    {
      nodes: Array.from({ length: 3 }, (_, i) => ({ id: 'stale' + i, data: { text: '过期正文' } })),
      edges: [],
      value: {
        draft: { getDocument: () => canonical },
        projectSnapshot: { name: '即梦真实画布' },
        canvasStore: {}
      }
    },
    '2 nodes, 1 edge, 0 selected.',
    'jimeng'
  );
  assert.equal(result.source, 'jimeng-draft-document');
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0].data.text, '\u0000rt-md:v1\n正文');
  assert.deepEqual(result.nodes[0].position, { x: 7, y: 9 });
  assert.equal(result.nodes[1].data.generationDraft.references[0].sourceInstanceId, 't');
  assert.equal(result.expectedEdges, 1);
});
