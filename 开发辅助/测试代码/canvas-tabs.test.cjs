'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CanvasTabs } = require('../../src/canvas-tabs.cjs');
test('关闭浏览标签不改变选择，选择变动和主动打开有不同的恢复行为', () => {
  const model = new CanvasTabs();
  const works = ['A', 'B', 'C'].map((id) => ({ id }));
  model.sync('author', works.slice(0, 2));
  model.close('A');
  assert.deepEqual([...model.selected], ['A', 'B']);
  model.sync('author', works);
  assert.deepEqual(
    model.tabs.map((w) => w.id),
    ['B', 'C']
  );
  model.sync('author', works, true);
  assert.deepEqual(new Set(model.tabs.map((w) => w.id)), new Set(['A', 'B', 'C']));
  model.close('A');
  model.sync('author', works.slice(1));
  model.sync('author', works);
  assert.ok(model.tabs.some((w) => w.id === 'A'));
});
test('活动标签关闭后选相邻标签，跨选集不串用关闭状态，排序校验完整性', () => {
  const model = new CanvasTabs();
  const works = ['A', 'B', 'C'].map((id) => ({ id }));
  model.sync('one', works);
  model.activate('B');
  model.close('B');
  assert.equal(model.activeId, 'C');
  model.reorder(['C', 'A']);
  assert.equal(model.tabs[0].id, 'C');
  model.reorder(['A', 'A']);
  assert.equal(model.tabs[0].id, 'C');
  model.sync('two', works);
  assert.equal(model.tabs.length, 3);
  model.sync('two', []);
  assert.equal(model.activeId, null);
});
