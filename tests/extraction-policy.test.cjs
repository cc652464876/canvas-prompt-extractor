'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {popupAction,leftRequestedWork}=require('../src/extraction-policy.cjs');
const work='https://www.liblib.tv/detail/requested';
test('Extraction keeps canvas popups controlled and lets recognizable authentication use its own window',()=>{
  assert.equal(popupAction('https://www.liblib.tv/canvas?projectId=123',work),'canvas');
  assert.equal(popupAction('https://www.liblib.tv/ai-canvas/123',work),'canvas');
  assert.equal(popupAction('https://passport.bytedance.com/oauth/authorize',work),'auth');
  for(const url of ['https://www.liblib.tv/detail/ad','https://www.liblib.tv/activity/sale','https://other.example/canvas','javascript:alert(1)','about:blank'])assert.equal(popupAction(url,work),'deny');
});
test('A different LibTV work/homepage is detected without rejecting same-work hashes or canvas navigation',()=>{
  for(const url of ['https://www.liblib.tv/','https://www.liblib.tv/home','https://www.liblib.tv/detail/other'])assert.equal(leftRequestedWork(url,work),true);
  for(const url of [work,work+'#preview',work+'?source=share','https://liblib.tv/detail/requested','https://www.liblib.tv/canvas?projectId=123','https://www.liblib.tv/login'])assert.equal(leftRequestedWork(url,work),false);
  assert.equal(leftRequestedWork('https://jimeng.jianying.com/ai-tool/home','https://jimeng.jianying.com/s/shared'),false);
});
