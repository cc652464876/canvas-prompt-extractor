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
