'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {normalize}=require('../src/normalize.cjs');
const {ProjectStore,MANIFEST}=require('../src/project-store.cjs');
const {loadLocalProject,isCurrentProjectPath}=require('../src/local-project.cjs');
async function fixture(t){
  const root=path.resolve(__dirname,'../validation');await fs.mkdir(root,{recursive:true});
  const dir=await fs.mkdtemp(path.join(root,'local-test-'));
  t.after(async()=>{if(path.dirname(dir)!==root||!path.basename(dir).startsWith('local-test-'))throw new Error('Unsafe cleanup');await fs.rm(dir,{recursive:true,force:true});});
  const result=normalize({nodes:[{id:'image',type:'image',data:{action:'image_generate',name:'图片',params:{prompt:'本地提示词'},url:['https://cdn.example.com/local.png']}}],edges:[],frameUrl:'https://www.liblib.tv/detail/local',source:'fixture'}, {platform:'liblib',author:'测试',title:'中文 空格',inputUrl:'https://www.liblib.tv/detail/local'});
  const store=new ProjectStore(dir);await store.create(result,{mode:'full'});
  const a=result.assets[0];await fs.writeFile(store.assetPath(a),'test-image');a.state='done';a.bytes=10;await store.checkpoint();
  return {dir,store,manifest:path.join(store.directory,MANIFEST)};
}
test('Directory, manifest and Windows Copy-as-path quotes load the same project without writes',async t=>{
  const {store,manifest}=await fixture(t),before=await fs.readFile(manifest,'utf8');
  for(const input of [store.directory,manifest,' "'+store.directory+'" ','"'+manifest+'"']){const loaded=await loadLocalProject(input);assert.equal(loaded.manifestPath,manifest);assert.equal(loaded.result.entries[0].prompt,'本地提示词');assert.equal(loaded.result.assets[0].state,'done');assert.equal(await fs.readFile(loaded.store.assetPath(loaded.result.assets[0]),'utf8'),'test-image');}
  assert.equal(await fs.readFile(manifest,'utf8'),before);
});
test('Current project recognition accepts directory, manifest, quotes and equivalent Windows paths',()=>{
  const directory=path.resolve('中文 空格 项目'),manifest=path.join(directory,MANIFEST);
  for(const input of [directory,manifest,' "'+manifest+'" ',directory+path.sep,path.join(directory,'.',MANIFEST)])assert.equal(isCurrentProjectPath(input,directory),true);
  if(process.platform==='win32'){assert.equal(isCurrentProjectPath(manifest.toUpperCase(),directory),true);assert.equal(isCurrentProjectPath(manifest.replaceAll('\\','/'),directory),true);}
  for(const input of ['',null,'relative',path.join(directory,'other.json'),directory+'-other'])assert.equal(isCurrentProjectPath(input,directory),false);
  assert.equal(isCurrentProjectPath(manifest,null),false);
});
test('A relocated project still loads by relative filenames; missing files are marked without deleting other content',async t=>{
  const {dir,store}=await fixture(t),moved=path.join(dir,'移动后 中文 项目');await fs.rename(store.directory,moved);
  assert.equal((await loadLocalProject(moved)).result.assets[0].state,'done');
  await fs.unlink(path.join(moved,store.result.assets[0].fileName));
  const loaded=await loadLocalProject(moved);assert.equal(loaded.result.entries[0].prompt,'本地提示词');assert.equal(loaded.result.assets[0].error,'本地文件缺失或不完整');assert.equal(loaded.result.assets[0].state,'pending');
});
test('Invalid paths, missing manifests, damaged JSON, unsupported schema and malformed records fail clearly',async t=>{
  const {dir,manifest}=await fixture(t);
  await assert.rejects(loadLocalProject('relative'),/完整路径/);await assert.rejects(loadLocalProject(path.join(dir,'不存在')),/不存在/);
  await assert.rejects(loadLocalProject(dir),/未找到/);await fs.writeFile(path.join(dir,'other.json'),'{}');await assert.rejects(loadLocalProject(path.join(dir,'other.json')),/请选择/);
  const original=JSON.parse(await fs.readFile(manifest,'utf8'));
  await fs.writeFile(manifest,'{broken');await assert.rejects(loadLocalProject(manifest),/损坏/);
  for(const alter of [r=>r.schemaVersion=99,r=>r.result.entries[0].references=null,r=>r.result.assets[0].fileName='../escape.png',r=>r.result.assets[0].fileName='bad.exe']){const data=structuredClone(original);alter(data);await fs.writeFile(manifest,JSON.stringify(data));await assert.rejects(loadLocalProject(manifest));}
});
