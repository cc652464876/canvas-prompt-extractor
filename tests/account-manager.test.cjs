'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {AccountManager}=require('../src/account-manager.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t,options={}) {
  const windows=[],events=[];
  const manager=new AccountManager({pollInterval:100000,loadingTimeout:40,checkTimeout:15,
    createWindow:platform=>{
      const win=new EventEmitter();win.platform=platform;win.destroyed=false;win.isDestroyed=()=>win.destroyed;
      win.webContents=new EventEmitter();win.url='';win.loads=0;win.webContents.getURL=()=>win.url;
      win.loadURL=url=>{win.url=url;win.loads++;win.webContents.emit('did-start-navigation',{},url,false,true);return new Promise(()=>{});};
      windows.push(win);return win;
    },inspect:async win=>win.account||{state:'unknown'},onChange:info=>events.push(info),...options});
  t.after(()=>manager.dispose());return {manager,windows,events};
}
test('Both sessions restore independently without waiting for page load completion',async t=>{
  const {manager,windows}=fixture(t);manager.start();assert.equal(windows.length,2);
  assert.ok(manager.snapshots().every(info=>info.checking));
  windows[0].account={state:'logged-in',username:'saved session'};windows[1].account={state:'logged-out'};
  for(const win of windows)win.webContents.emit('dom-ready');
  await manager.refresh('liblib');await manager.refresh('jimeng');
  assert.equal(manager.snapshot('liblib').state,'logged-in');assert.equal(manager.snapshot('jimeng').state,'logged-out');
  assert.equal(manager.snapshot('liblib').checking,false);
});
test('Opening and switching accounts reuses pages, including an in-progress home load and an existing work',t=>{
  const {manager,windows}=fixture(t);manager.start();
  // Chromium reports an empty URL until the first pending navigation commits.
  windows[0].url='';windows[1].url='about:blank';
  manager.open('liblib');manager.open('jimeng');manager.open('liblib');
  assert.equal(windows[0].loads,1);assert.equal(windows[1].loads,1);
  windows[0].url='https://www.liblib.tv/detail/work';manager.open('liblib');
  assert.equal(windows[0].loads,1);assert.equal(manager.existing('liblib'),windows[0]);
});
test('A slow or failed page stops checking and permits a retry without blocking the other account',async t=>{
  const {manager,windows}=fixture(t);manager.start();await wait(60);
  assert.ok(manager.snapshots().every(info=>!info.checking&&info.state==='unknown'));
  manager.open('liblib');assert.equal(windows[0].loads,2);assert.equal(windows[1].loads,1);
  windows[0].webContents.emit('did-fail-load',{},-105,'offline','',true);
  assert.equal(manager.snapshot('liblib').checking,false);assert.match(manager.snapshot('liblib').label,/失败/);
  manager.open('liblib');assert.equal(windows[0].loads,3);
});
test('A hung inspection is bounded and a late result cannot override a new navigation',async t=>{
  let resolveOld;
  const {manager,windows}=fixture(t,{inspect:()=>new Promise(resolve=>{resolveOld=resolve;})});manager.start();
  windows[0].webContents.emit('dom-ready');await manager.refresh('liblib');
  assert.equal(manager.entries.get('liblib').pending,null);
  resolveOld({state:'logged-in'});await wait(0);assert.equal(manager.snapshot('liblib').state,'unknown');
  manager.inspect=()=>new Promise(resolve=>{resolveOld=resolve;});const pending=manager.refresh('liblib');await wait(0);
  windows[0].webContents.emit('did-start-navigation',{},'new',false,true);
  resolveOld({state:'logged-in'});await pending;assert.equal(manager.snapshot('liblib').state,'unknown');
});
test('Login/logout without navigation updates both accounts, while extraction pauses only its own page',async t=>{
  const {manager,windows}=fixture(t);manager.start();
  for(const win of windows){win.account={state:'logged-in'};win.webContents.emit('dom-ready');}
  await manager.refresh('liblib');await manager.refresh('jimeng');
  manager.blocked=win=>win===windows[0];for(const win of windows)win.account={state:'logged-out'};
  await manager.refresh('liblib');await manager.refresh('jimeng');
  assert.equal(manager.snapshot('liblib').state,'logged-in');assert.equal(manager.snapshot('jimeng').state,'logged-out');
  manager.blocked=()=>false;await manager.refresh('liblib');assert.equal(manager.snapshot('liblib').state,'logged-out');
});
test('Disposing cancels timers and listeners and ignores an outstanding result',async t=>{
  let finish;
  const {manager,windows,events}=fixture(t,{inspect:()=>new Promise(resolve=>{finish=resolve;})});manager.start();
  windows[0].webContents.emit('dom-ready');const pending=manager.refresh('liblib');await wait(0);
  manager.dispose();const count=events.length;finish({state:'logged-in'});await pending;await wait(60);
  assert.equal(events.length,count);assert.equal(windows[0].webContents.listenerCount('dom-ready'),0);
});
test('An extraction spanning the check deadline cannot leave an unknown account checking forever',async t=>{
  const {manager,windows}=fixture(t,{blocked:()=>true});manager.start();
  windows[0].webContents.emit('dom-ready');await wait(60);
  manager.blocked=()=>false;await manager.refresh('liblib');
  assert.equal(manager.snapshot('liblib').state,'unknown');assert.equal(manager.snapshot('liblib').checking,false);
});
test('Reset destroys all cached pages, cancels checks and allows a fresh window without a late login result',async t=>{
  let finish;
  const {manager,windows,events}=fixture(t,{inspect:()=>new Promise(resolve=>{finish=resolve;})});
  for(const platform of ['liblib','jimeng']){const win=manager.getWindow(platform);win.destroy=()=>{win.destroyed=true;win.emit('closed');};}
  manager.start();windows[0].webContents.emit('dom-ready');const pending=manager.refresh('liblib');await wait(0);
  manager.reset();assert.ok(windows.every(win=>win.destroyed));assert.equal(manager.entries.size,0);
  finish({state:'logged-in'});await pending;assert.ok(events.slice(-2).every(info=>info.state==='unknown'));
  manager.open('liblib');assert.notEqual(manager.existing('liblib'),windows[0]);assert.equal(windows.length,3);
});
