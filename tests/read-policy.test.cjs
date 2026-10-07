'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reuseWorkPage,sameWorkUrl}=require('../src/read-policy.cjs');
const requestedUrl='https://www.liblib.tv/detail/test';
const base={requestedUrl,platform:'liblib',attempt:{platform:'liblib',inputUrl:requestedUrl,resolvedUrl:requestedUrl},windowUrl:requestedUrl+'#canvas',windowPlatform:'liblib',windowAvailable:true};
test('The main read action reuses the same work after manual login/dialog handling',()=>{assert.equal(reuseWorkPage(base),true);assert.equal(sameWorkUrl(requestedUrl,requestedUrl+'/'),true);});
test('A different work, platform, closed window or homepage always opens the requested link',()=>{for(const change of [{requestedUrl:'https://www.liblib.tv/detail/other'},{windowPlatform:'jimeng'},{windowAvailable:false},{windowUrl:'https://www.liblib.tv/'},{windowUrl:'https://www.liblib.tv/detail/other'},{attempt:null}])assert.equal(reuseWorkPage({...base,...change}),false);});
test('Only a recorded redirect target can be reused for a shared link',()=>{const target='https://www.liblib.tv/canvas/test';assert.equal(reuseWorkPage({...base,attempt:{...base.attempt,resolvedUrl:target},windowUrl:target}),true);assert.equal(reuseWorkPage({...base,windowUrl:target}),false);assert.equal(sameWorkUrl(target+'?id=a',target+'?id=b'),false);});
