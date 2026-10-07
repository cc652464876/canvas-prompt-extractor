'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {EXECUTABLE}=require('../src/portable-layout.cjs');
const root=path.resolve(__dirname,'..'),portable=JSON.parse(fs.readFileSync(path.join(root,'validation/portable-report.json'),'utf8')),folder=portable.extractedTestDirectory;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const logFile=path.join(root,'validation/portable-live.log'),fd=fs.openSync(logFile,'w'),start=Date.now();
const child=spawn(path.join(folder,EXECUTABLE),['--verify-live','--liblib-only'],{cwd:folder,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);let timedOut=false,error;
const timer=setTimeout(()=>{timedOut=true;child.kill();},110000);child.on('error',e=>{error=e.message;});
child.on('close',code=>{
  clearTimeout(timer);const file=path.join(folder,'resources/app/validation/live-report.json');let reports;if(fs.existsSync(file))reports=JSON.parse(fs.readFileSync(file,'utf8'));
  const result={passed:code===0&&!timedOut&&!error&&reports?.length===1&&reports[0].passed===true,code,timedOut,error,elapsedMs:Date.now()-start,executable:path.join(folder,EXECUTABLE),reports,scope:'Packaged v1.0 executable, fresh temporary profile; read-only public LibTV sample; no personal accounts or original media downloads'};
  fs.writeFileSync(path.join(root,'validation/portable-live-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,code,timedOut,elapsedMs:result.elapsedMs}));if(!result.passed)process.exitCode=1;
});
