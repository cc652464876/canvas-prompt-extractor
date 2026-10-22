'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readProfile } = require('../../src/platforms/jimeng/profile.cjs');
const url = 'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAATESTAUTHOR';
function fixture(
  t,
  {
    readyAfter = Infinity,
    repaired = true,
    selectable = true,
    cancelAfter = Infinity,
    activity = 'idle'
  } = {}
) {
  t.mock.timers.enable({ apis: ['Date'], now: 10000 });
  const start = Date.now(),
    controller = new AbortController();
  const state = { reloads: 0, reloadAt: null, selections: 0, notices: [], selected: false };
  const cards = Array.from({ length: 34 }, (_, i) => ({
    index: i,
    work: {
      id: String(100 + i),
      title: '作品' + i,
      author: '小文',
      canvasAccess: 'not-public',
      fullVideo: { url: 'https://cdn.example.com/' + i + '.mp4' }
    }
  }));
  const promise = readProfile(
    url,
    null,
    controller.signal,
    (_count, message) => {
      if (message) state.notices.push(message);
    },
    async (_address, read) =>
      read(
        async (action) => {
          const ready = Date.now() - start >= readyAfter || (repaired && state.reloads > 0);
          if (action === 'reload') {
            state.reloads++;
            state.reloadAt = Date.now() - start;
            state.selected = false;
            return;
          }
          if (action === 'select') {
            state.selections++;
            if (ready && selectable) state.selected = true;
            return ready;
          }
          if (action === 'open') throw new Error('Loaded homepage data must not open details');
          return {
            url,
            tabPresent: ready,
            active: state.selected,
            indices: [],
            cards: state.selected ? cards : [],
            complete: state.selected,
            boot: {
              shell: true,
              ready: true,
              resources:
                activity === 'traffic' ? String(Math.floor((Date.now() - start) / 400)) : 'cold',
              pending: activity === 'pending' && !ready ? 1 : 0
            }
          };
        },
        async (ms) => {
          t.mock.timers.tick(ms);
          if (Date.now() - start >= cancelAfter) controller.abort();
        }
      )
  );
  return { state, promise, elapsed: () => Date.now() - start };
}
test('A single cold-start read automatically recovers the blank author panel and returns 34 works', async (t) => {
  const run = fixture(t);
  const result = await run.promise;
  assert.equal(result.works.length, 34);
  assert.equal(run.state.reloads, 1);
  assert.ok(run.state.reloadAt <= 2000);
  assert.ok(run.state.notices.some((message) => message.includes('自动')));
});
test('A slowly initialized author panel succeeds on its first read without reloading a healthy page', async (t) => {
  const run = fixture(t, { readyAfter: 5000, activity: 'pending' });
  assert.equal((await run.promise).works.length, 34);
  assert.equal(run.state.reloads, 0);
});
test('Ongoing script and API traffic is not treated as a stuck author panel', async (t) => {
  const run = fixture(t, { readyAfter: 5000, activity: 'traffic' });
  assert.equal((await run.promise).works.length, 34);
  assert.equal(run.state.reloads, 0);
});
test('A permanently blank author panel fails with an initialization diagnosis after one bounded recovery', async (t) => {
  const run = fixture(t, { repaired: false });
  await assert.rejects(run.promise, /初始化/);
  assert.equal(run.state.reloads, 1);
  assert.ok(run.state.reloadAt <= 2000);
  assert.ok(run.elapsed() <= 65000);
});
test('A mounted but unusable tab cannot cause an endless refresh loop', async (t) => {
  const run = fixture(t, { readyAfter: 0, selectable: false });
  await assert.rejects(run.promise, /AI短片/);
  assert.equal(run.state.reloads, 1);
  assert.ok(run.state.reloadAt >= 15000);
  assert.ok(run.elapsed() <= 65000);
});
test('Cancelling during startup stops before automatic recovery', async (t) => {
  const run = fixture(t, { cancelAfter: 1000 });
  await assert.rejects(run.promise, { name: 'AbortError' });
  assert.equal(run.state.reloads, 0);
});
