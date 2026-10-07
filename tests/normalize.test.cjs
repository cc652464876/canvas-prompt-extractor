'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, markdown, filename, filterResult } = require('../src/normalize.cjs');
const metadata = { platform:'liblib',author:'蓝喵',title:'胡来万事屋',inputUrl:'https://www.liblib.tv/detail/test' };
function snapshot(nodes,edges=[]) { return { nodes,edges,source:'fixture',frameUrl:'https://www.liblib.tv/detail/test',canvasTitle:'画布' }; }
test('LibTV preserves false settings, references, groups, and duplicate prompts',()=>{
  const data={action:'video_generate',params:{prompt:'\n相同镜头\n',settings:{enableSound:false},enableSound:true,imageList:[{name:'人物图'}]}};
  const r=normalize(snapshot([{id:'g',type:'group',data:{name:'镜头组'}},{id:'a',parentId:'g',data},{id:'b',parentId:'g',data}]),metadata);
  assert.equal(r.entries.length,2);assert.equal(r.entries[0].settings.enableSound,false);assert.equal(r.entries[0].prompt,'\n相同镜头\n');
  assert.equal(r.entries[0].group,'镜头组');assert.equal(r.entries[0].references[0].name,'人物图');
});
test('Jimeng parts resolve reference slots and retain original rich parts',()=>{
  const parts=[{type:'text',text:'拍摄'},{type:'extension',object_id:'slot'},{type:'text',text:'走路'}];
  const r=normalize(snapshot([{id:'img',type:'image',data:{title:'主角',source:'uploaded'}},{id:'v',type:'video',data:{title:'视频',generationDraft:{kind:'video',parts,references:[{slotId:'slot',nodeId:'img'}],contentSettings:{modelName:'seedance'}}}}]),{...metadata,platform:'jimeng'});
  assert.equal(r.entries[0].prompt,'拍摄【参考：主角；节点 img】走路');assert.deepEqual(r.entries[0].rawParts,parts);
});
test('Reference-only image prompts are separate from direct prompt text',()=>{
  const r=normalize(snapshot([{id:'txt',type:'text',data:{title:'全局正向',text:'\u0000rt-md:v1\n电影质感'}},{id:'img',type:'image',data:{title:'图片',generationDraft:{kind:'image',parts:[],references:[{nodeId:'txt'}],contentSettings:{}}}}]),metadata);
  const entry=r.entries.find(e=>e.nodeId==='img');assert.equal(entry.prompt,'');assert.equal(entry.promptSource,'reference-text-only');assert.equal(entry.referenceTexts[0].text,'电影质感');assert.equal(entry.kind,'image_unknown');
  assert.equal(r.diagnostics.referenceOnlyCount,1);assert.match(markdown(r),/当前节点没有直接输入文本/);
});
test('Category filtering excludes other node data from JSON export',()=>{
  const r=normalize(snapshot([{id:'v',data:{action:'video_generate',params:{prompt:'视频'}}},{id:'t',type:'text',data:{content:'私人文本'}}]),metadata);
  const selected=filterResult(r,['video']);assert.equal(selected.entries.length,1);assert.equal(selected.nodes,undefined);assert.ok(!JSON.stringify(selected).includes('私人文本'));
});
test('Filename is based on work title and stays a safe single component',()=>{
  assert.equal(filename(metadata),'liblib_蓝喵_胡来万事屋.md');assert.equal(filename({...metadata,platform:'jimeng',author:'小易小易',title:'《牧羊犬日常》'}),'jimeng_小易小易_牧羊犬日常.md');
  assert.ok(!filename({...metadata,author:'../作者',title:'A/B:*?'}).includes('/'));
});
test('Completeness mismatch is reported rather than hidden',()=>{
  const r=normalize({...snapshot([{id:'t',type:'text',data:{content:'正文'}}]),expectedNodes:3},metadata);
  assert.ok(r.diagnostics.warnings.some(w=>w.includes('完整性未通过')));
});
