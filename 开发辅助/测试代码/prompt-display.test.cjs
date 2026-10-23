'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const model = () => import('../../src/ui/prompt-display.js');
test('TapNow plain and bracketed references resolve only explicit markers without changing text', async () => {
  const { promptReferenceTokens } = await model();
  const entry = {
    prompt: 'Image1 进入森林，{{Audio 1}} 说话，Image9 未确认',
    references: [
      { nodeId: 'image', type: 'image', marker: 'image 1' },
      { nodeId: 'voice', type: 'audio', marker: 'audio 1' }
    ]
  };
  assert.deepEqual(
    promptReferenceTokens(entry, 'tapnow').map((t) => t.reference?.nodeId),
    ['image', 'voice', undefined]
  );
  assert.equal(entry.prompt, 'Image1 进入森林，{{Audio 1}} 说话，Image9 未确认');
  assert.equal(promptReferenceTokens(entry, 'liblib').length, 1);
});
test('RHTV Chinese mentions resolve parameter markers and per-media edge order, preserving prompt text', async () => {
  const { promptReferenceTokens } = await model();
  const entry = {
    prompt: '晓晓2@图片2：确定面容。沈宁@音频1。未知@图片9。',
    references: [
      { nodeId: 'scene', type: 'image', name: '海边' },
      { nodeId: 'girl', type: 'image', name: '晓晓2' },
      { nodeId: 'mother', type: 'image', name: '沈宁' },
      { nodeId: 'voice', type: 'audio', name: '沈宁.mp3', index: 4 },
      { nodeId: 'voice2', type: 'audio', name: '晓晓.mp3', index: 5 }
    ]
  };
  const original = JSON.stringify(entry),
    tokens = promptReferenceTokens(entry, 'rhtv');
  assert.equal(tokens[0].reference.nodeId, 'girl');
  assert.equal(tokens[1].reference.nodeId, 'voice');
  assert.equal(tokens[2].reference, undefined);
  assert.equal(entry.prompt.slice(tokens[0].start, tokens[0].end), '@图片2');
  assert.equal(JSON.stringify(entry), original);
  entry.references = [
    { nodeId: 'third', type: 'image', marker: 'image 3' },
    { nodeId: 'second', type: 'image', marker: 'image 2' }
  ];
  assert.equal(promptReferenceTokens(entry, 'rhtv')[0].reference.nodeId, 'second');
});
test('Inline resolution preserves LibTV syntax and leaves unbound or ambiguous RHTV mentions as text', async () => {
  const { promptReferenceTokens } = await model();
  const entry = {
    prompt: '{{Mixed 1}}【参考：角色；节点 b】 @图片2',
    references: [
      { nodeId: 'a', marker: 'Mixed 1' },
      { nodeId: 'b', type: 'image' },
      { nodeId: 'c', type: 'image' }
    ]
  };
  assert.deepEqual(
    promptReferenceTokens(entry, 'liblib').map((t) => t.reference.nodeId),
    ['a', 'b']
  );
  const ambiguous = {
    prompt: '@图片2',
    references: [
      { nodeId: 'a', type: 'image', marker: 'image 2' },
      { nodeId: 'b', type: 'image', marker: 'image 2' }
    ]
  };
  assert.equal(promptReferenceTokens(ambiguous, 'rhtv')[0].reference, undefined);
});

test('NeoWow filename and node mentions resolve existing references independently of reference order', async () => {
  const { promptReferenceTokens } = await model();
  const entry = {
    prompt:
      '@[IMG_GEN_20260715153947_e0346d29_1]为沈明，@[9d3d89e26910f4d8e411c254ec2b9c46]为上一段最后画面。@[source-node]和@[角色参考.png]再次出现。@[IMG_GEN_20260715153947_e0346d29_1]。@[未知]。',
    references: [
      {
        nodeId: 'frame',
        name: '截帧',
        type: 'image',
        marker: 'image 1',
        url: 'https://cdn.example.com/9d3d89e26910f4d8e411c254ec2b9c46.jpg?signature=fixture',
        assetIds: ['frame-asset']
      },
      {
        nodeId: 'source-node',
        name: '角色参考.png',
        type: 'image',
        marker: 'image 2',
        url: 'https://cdn.example.com/IMG_GEN_20260715153947_e0346d29_1.png',
        assetIds: ['character-asset']
      }
    ]
  };
  const original = JSON.stringify(entry),
    tokens = promptReferenceTokens(entry, 'neowow');
  assert.deepEqual(
    tokens.map((t) => t.reference?.nodeId),
    ['source-node', 'frame', 'source-node', 'source-node', 'source-node', undefined]
  );
  assert.deepEqual(tokens[0].reference.assetIds, ['character-asset']);
  assert.equal(
    entry.prompt.slice(tokens[0].start, tokens[0].end),
    '@[IMG_GEN_20260715153947_e0346d29_1]'
  );
  assert.equal(JSON.stringify(entry), original);
  assert.equal(promptReferenceTokens(entry, 'liblib').length, 0);
});

test('NeoWow preserves unknown, ambiguous and similar filename mentions without guessing', async () => {
  const { promptReferenceTokens } = await model();
  const entry = {
    prompt: '@[角色] @[角色2] @[角色.png] @[Frame_01]',
    references: [
      { nodeId: 'a', name: '角色', url: 'https://cdn.example.com/a.png' },
      { nodeId: 'b', name: '角色', url: 'https://cdn.example.com/b.png' },
      { nodeId: 'frame', name: '帧', url: 'https://cdn.example.com/Frame_01.webp?x=1' }
    ]
  };
  const tokens = promptReferenceTokens(entry, 'neowow');
  assert.deepEqual(
    tokens.map((t) => t.reference?.nodeId),
    [undefined, undefined, undefined, 'frame']
  );
});

test('NeoWow numbered mentions use explicit per-media markers, not arbitrary edge order', async () => {
  const { promptReferenceTokens } = await model();
  const entry = {
    prompt: '@[图片1] @[图像2] @[音频1] @[图片3]',
    references: [
      { nodeId: 'two', type: 'image', marker: 'image 2' },
      { nodeId: 'edge-only', type: 'image' },
      { nodeId: 'one', type: 'image', marker: 'image 1' },
      { nodeId: 'sound', type: 'audio', marker: 'audio 1' }
    ]
  };
  assert.deepEqual(
    promptReferenceTokens(entry, 'neowow').map((t) => t.reference?.nodeId),
    ['one', 'two', 'sound', undefined]
  );
});
