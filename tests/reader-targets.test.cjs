const test=require('node:test'),assert=require('node:assert/strict');
const model=()=>import('../src/ui/reader-targets.js');
test('Asset and prompt entry resolve to the same reader; reference consumers never supply its prompt',async()=>{
  const{readerTarget}=await model();const own={nodeId:'66',prompt:'图片自身提示词'},consumer={nodeId:'67',prompt:'视频提示词',references:[{nodeId:'66'}]};
  const asset={id:'image',nodeIds:['66']},result={entries:[consumer,own]};
  assert.equal(readerTarget(result,'assets',asset).key,readerTarget(result,'prompts',own).key);
  assert.equal(readerTarget(result,'assets',asset).item,own);
  const uploaded={id:'upload',nodeIds:['u']};assert.equal(readerTarget(result,'assets',uploaded).item,uploaded);
});
test('Explicit reference IDs distinguish nodes sharing one file; ambiguous assets do not choose a producer',async()=>{
  const{readerTarget}=await model();const a={nodeId:'a',name:'同名',prompt:'A'},b={nodeId:'b',name:'同名',prompt:'B'},asset={id:'shared',nodeIds:['a','b']},result={entries:[a,b]};
  assert.equal(readerTarget(result,'assets',asset,'b').item,b);
  assert.equal(readerTarget(result,'assets',asset).scope,'assets');
  const uploaded={id:'upload',nodeIds:['u1','u2']};assert.notEqual(readerTarget(result,'assets',uploaded,'u1').key,readerTarget(result,'assets',uploaded,'u2').key);
});
test('Referrer list includes all consumers once, excludes self, preserves identical names and exact node relationships',async()=>{
  const{referencingEntries}=await model();const refs=Array.from({length:40},(_,i)=>({nodeId:'r'+i,name:'同名',references:[{nodeId:'66',assetIds:['shared']},{nodeId:'66',assetIds:['shared']}]}));
  const other={nodeId:'other',references:[{nodeId:'88',assetIds:['shared']}]};const result={entries:[{nodeId:'66',references:[{nodeId:'66'}]},...refs,refs[0],other]};
  const exact=referencingEntries(result,'66',['shared']);assert.equal(exact.length,40);assert.ok(!exact.includes(other));
  assert.equal(referencingEntries(result,null,['shared']).length,41);
});
