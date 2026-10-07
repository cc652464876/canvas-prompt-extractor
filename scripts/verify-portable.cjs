'use strict';
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {EXECUTABLE}=require('../src/portable-layout.cjs');
const root=path.resolve(__dirname,'..');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
async function run(exe,args,cwd,log,timeout=20000){
  return new Promise(resolve=>{const fd=sync.openSync(log,'w'),start=Date.now(),child=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore',fd,fd]});sync.closeSync(fd);let timedOut=false,error;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);child.on('error',e=>{error=e.message;});child.on('close',code=>{clearTimeout(timer);resolve({code,timedOut,error,elapsedMs:Date.now()-start});});});
}
async function walk(dir){const result=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())result.push(...await walk(f));else result.push(f);}return result;}
async function main(){
  const archive=path.resolve(process.argv[2]||path.join(root,'dist/自由画布提取-v1.0.0-Windows-x64-便携版.zip'));
  const validation=path.join(root,'validation/portable-tests');await fs.mkdir(validation,{recursive:true});
  const out=await fs.mkdtemp(path.join(validation,'release-')),unpacked=path.join(out,'解压 中文 空格');await fs.mkdir(unpacked);
  const hash=crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex'),expected=(await fs.readFile(archive+'.sha256','utf8')).split(/\s/)[0];assert.equal(hash,expected);
  const extract=await run('tar.exe',['-xf',archive,'-C',unpacked],out,path.join(out,'extract.log'),60000);assert.equal(extract.code,0,JSON.stringify(extract));
  const folder=path.join(unpacked,path.basename(archive,'.zip')),manifest=JSON.parse(await fs.readFile(path.join(folder,'release-manifest.json'),'utf8'));
  const listed=new Set(manifest.files.map(f=>f.file));
  const actual=(await walk(folder)).map(f=>path.relative(folder,f).replaceAll('\\','/'));assert.equal(actual.length,manifest.files.length+1);assert.ok(actual.every(f=>f==='release-manifest.json'||listed.has(f)));
  for(const file of manifest.files){const bytes=await fs.readFile(path.join(folder,file.file));assert.equal(bytes.length,file.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  assert.ok(!actual.some(f=>f.split('/').some(p=>['.runtime','validation','.backups','node_modules','tests','scripts','exports'].includes(p))));
  assert.equal(manifest.version,'1.0.0');assert.equal(manifest.runtime.electron,'44.5.1');
  const checks=[{name:'ZIP hash and every extracted file match the release manifest',files:manifest.files.length,sha256:hash},{name:'Clean release contains no profiles, test fixtures, backups or exports'}];
  async function smoke(directory,name,viaCmd=false){
    const reportPath=path.join(out,name+'.json');const args=['--portable-smoke='+reportPath];
    let execution;
    if(viaCmd){
      // PowerShell starts the shipped CMD with its argument as a distinct token;
      // there is no shell string interpolation of the executable or paths.
      execution=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/launch-smoke.ps1'),'-Launcher',path.join(directory,'启动自由画布提取.cmd'),'-ReportPath',reportPath],out,path.join(out,name+'.log'));
      for(let i=0;i<200&&!sync.existsSync(reportPath);i++)await new Promise(resolve=>setTimeout(resolve,50));
    }else execution=await run(path.join(directory,EXECUTABLE),args,out,path.join(out,name+'.log'));
    assert.equal(execution.code,0,JSON.stringify(execution));assert.equal(execution.timedOut,false);
    const report=JSON.parse(await fs.readFile(reportPath,'utf8'));assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.version,'1.0.0');assert.equal(report.profile,path.join(directory,'.runtime/profile'));assert.equal(report.dataRoot,directory);assert.equal(report.isPackaged,true);assert.equal(sync.existsSync(path.join(directory,'resources/app/.runtime')),false);
    checks.push({name,execution,report});return report;
  }
  await smoke(folder,'first-exe-start');await smoke(folder,'restart-preferences');
  const moved=path.join(out,'搬迁 后 中文 空格');
  // Verify both resolved paths are inside this run before moving recursively.
  for(const target of [folder,moved]){const relative=path.relative(out,path.resolve(target));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));}
  for(let attempt=0;;attempt++){
    try{await fs.rename(folder,moved);break;}
    catch(error){if(!['EPERM','EBUSY'].includes(error.code)||attempt>=12)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
  }
  await smoke(moved,'relocated-preferences');await smoke(moved,'shipped-cmd-start',true);
  // Wait for the CMD-launched app to release its directory before collecting evidence.
  await new Promise(resolve=>setTimeout(resolve,750));
  const report={passed:true,version:'1.0.0',archive,bytes:(await fs.stat(archive)).size,sha256:hash,checks,extractedTestDirectory:moved,network:'Smoke mode makes no platform requests; no Node or parent runtime is invoked by the packaged executable.'};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'validation/portable-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:checks.map(c=>c.name),bytes:report.bytes,sha256:hash}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
