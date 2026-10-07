'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {keepUiSettings,resetBrowserData}=require('../src/browser-reset.cjs');
test('Only valid program preferences survive a complete browser reset',()=>{
  assert.deepEqual(keepUiSettings({theme:'dark',columns:'5','read-layout':'dual',token:'account secret',history:'visited sites','appearance-v1':'bad JSON','prompt-typography-v1':JSON.stringify({font:'geist',size:18,token:'secret'})}),{theme:'dark','prompt-typography-v1':JSON.stringify({font:'geist',size:18}),columns:'5','read-layout':'dual'});
  assert.deepEqual(keepUiSettings({columns:'../../exports',theme:'cookie','read-layout':'private'}),{});
});
function fakeSession(initial) {
  const data={...initial};
  return {data,async closeAllConnections(){},async clearData(options){assert.equal(options,undefined);for(const key of Object.keys(data))delete data[key];},async clearCache(){},async clearCodeCaches(){},async clearAuthCache(){},async clearHostResolverCache(){},async clearSharedDictionaryCache(){}};
}
test('Every session and third-party site is cleared after page writers stop, while saved output is untouched',async()=>{
  const primary=fakeSession({platform:'cookie',oauth:'cookie',cdn:'cache'}),other=fakeSession({unknownWebsite:'storage'});
  const savedFiles={prompt:'saved text',video:'saved media'};let closed=false,thumbnail=true,restored;
  const response=await resetBrowserData({sessions:[primary,other,primary],settings:{theme:'dark',token:'secret'},closePages:async()=>{closed=true;},clearThumbnails:async()=>{assert.ok(closed);thumbnail=false;},restoreSettings:async settings=>{restored=settings;}});
  assert.deepEqual(primary.data,{});assert.deepEqual(other.data,{});assert.equal(thumbnail,false);assert.deepEqual(restored,{theme:'dark'});assert.deepEqual(savedFiles,{prompt:'saved text',video:'saved media'});assert.equal(response.reset,true);
});
test('A partial failure is reported, other sessions are cleared and program preferences still survive',async()=>{
  const failing=fakeSession({auth:'cookie'});failing.clearData=async()=>{throw new Error('Storage failure');};
  const healthy=fakeSession({thirdParty:'cookie'});let restored;
  await assert.rejects(resetBrowserData({sessions:[failing,healthy],settings:{columns:'3'},closePages:async()=>{},clearThumbnails:async()=>{},restoreSettings:async value=>{restored=value;}}),/部分浏览数据清理失败/);
  assert.deepEqual(healthy.data,{});assert.deepEqual(restored,{columns:'3'});
});
