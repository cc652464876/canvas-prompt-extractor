'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'validation/v1-release');fs.mkdirSync(out,{recursive:true});
const {runtimeCandidates}=require('../src/portable-layout.cjs');const runtime=runtimeCandidates(root).find(p=>fs.existsSync(path.join(p,'electron.exe'))),electron=path.join(runtime,'electron.exe');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const only=process.argv[2],results=only&&fs.existsSync(path.join(out,'results.json'))?JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8')):[];
function run(name,exe,args,report){if(only&&name!==only)return Promise.resolve();return new Promise(resolve=>{
  const reportPath=report&&path.join(root,'validation',report);if(reportPath&&fs.existsSync(reportPath))fs.unlinkSync(reportPath);
  const logFile=path.join(out,name+'.log');if(only&&fs.existsSync(logFile))fs.copyFileSync(logFile,logFile+'.previous');const fd=fs.openSync(logFile,'w'),start=Date.now(),child=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);let timedOut=false,error;
  const timer=setTimeout(()=>{timedOut=true;child.kill();},90000);child.on('error',e=>{error=e.message;});child.on('close',code=>{
    clearTimeout(timer);const log=fs.readFileSync(logFile,'utf8');let evidence;
    if(reportPath&&fs.existsSync(reportPath)){evidence=JSON.parse(fs.readFileSync(reportPath,'utf8'));fs.copyFileSync(reportPath,path.join(out,name+'-report.json'));}
    const r={name,code,timedOut,error,elapsedMs:Date.now()-start,unexpectedError:/No handler registered|AssertionError|UnhandledPromiseRejection/.test(log),report:report?!!evidence:undefined};r.passed=code===0&&!timedOut&&!error&&!r.unexpectedError&&(!report||evidence?.passed===true);const previous=results.findIndex(x=>x.name===name);if(previous>=0)results[previous]=r;else results.push(r);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(r));resolve(r);
  });
});}
async function main(){
  await run('unit-tests',process.execPath,['--test','tests/*.test.cjs']);
  await run('read-deadlines',electron,[root,'--verify-read-deadline'],'read-deadline-report.json');
  for(let i=1;i<=5;i++)await run('themes-'+i,electron,[root,'--verify-themes'],'v10-theme-report.json');
  for(const [name,args,report] of [
    ['readers',['scripts/verify-reader-navigation.cjs'],'reader-navigation-report.json'],
    ['workflow',[root,'--verify-v08'],'v08-workflow-report.json'],
    ['cleanup',['scripts/verify-extraction-cleanup.cjs'],'extraction-cleanup-report.json'],
    ['feedback',['scripts/verify-extraction-feedback.cjs'],'extraction-feedback-report.json'],
    ['video-covers',['scripts/verify-video-covers.cjs'],'video-cover-report.json'],
    ['alignment',['scripts/verify-alignment.cjs'],'ui-alignment-report.json'],
    ['account-startup',[root,'--verify-account-startup'],'account-startup/report.json'],
    ['browser-reset',[root,'--verify-browser-reset'],'browser-reset/report.json'],
    ['local-project',[root,'--verify-local-project'],'local-project/report.json']
  ])await run(name,electron,args.map(a=>a.startsWith('scripts/')?path.join(root,a):a),report);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:results.every(r=>r.passed),version:'1.0.0',results},null,2));if(!results.every(r=>r.passed))process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
