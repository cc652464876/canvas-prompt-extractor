'use strict';
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const build=require('./build.cjs');
const {EXECUTABLE,RUNTIME_FILES,shippingSource,runtimeCandidates}=require('../src/portable-layout.cjs');
const root=path.resolve(__dirname,'..');
async function files(directory){const result=[];for(const e of await fs.readdir(directory,{withFileTypes:true})){const p=path.join(directory,e.name);if(e.isSymbolicLink())throw new Error('Release source contains a symbolic link: '+p);if(e.isDirectory())result.push(...await files(p));else if(e.isFile())result.push(p);}return result.sort();}
async function packagePortable({runtime,archive=true}={}){
  if(process.platform!=='win32')throw new Error('Build the Windows portable package on Windows.');
  await build();const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  runtime=runtime?path.resolve(runtime):runtimeCandidates(root).find(p=>sync.existsSync(path.join(p,'electron.exe')));
  if(!runtime)throw new Error('Electron runtime missing. Install the pinned development dependency or provide --runtime <dist directory>.');
  const runtimeVersion=(await fs.readFile(path.join(runtime,'version'),'utf8')).trim();
  if(runtimeVersion!==pkg.devDependencies.electron)throw new Error('Runtime version mismatch: '+runtimeVersion+'; expected '+pkg.devDependencies.electron);
  const binary=await fs.open(path.join(runtime,'electron.exe'),'r');let machine;
  try{const head=Buffer.alloc(64);await binary.read(head,0,64,0);const pe=Buffer.alloc(6);await binary.read(pe,0,6,head.readUInt32LE(60));if(pe.toString('ascii',0,4)!=='PE\0\0')throw new Error('Invalid Electron PE binary');machine=pe.readUInt16LE(4);}finally{await binary.close();}
  if(machine!==0x8664)throw new Error('The portable release requires the Windows x64 runtime.');
  const dist=path.join(root,'dist'),name='自由画布提取-v'+pkg.version+'-Windows-x64-便携版',folder=path.join(dist,name),zip=path.join(dist,name+'.zip');
  await fs.mkdir(dist,{recursive:true});
  if(sync.existsSync(folder)||sync.existsSync(zip))throw new Error('Release already exists. Use a new version or preserve the existing release before rebuilding.');
  const staging=await fs.mkdtemp(path.join(dist,'.staging-'));
  for(const file of RUNTIME_FILES)await fs.copyFile(path.join(runtime,file),path.join(staging,file));
  await fs.copyFile(path.join(runtime,'electron.exe'),path.join(staging,EXECUTABLE));
  await fs.mkdir(path.join(staging,'locales'));
  for(const file of (await fs.readdir(path.join(runtime,'locales'))).filter(f=>/^[\w-]+\.pak$/.test(f)))await fs.copyFile(path.join(runtime,'locales',file),path.join(staging,'locales',file));
  const appRoot=path.join(staging,'resources/app');await fs.mkdir(appRoot,{recursive:true});
  const packageJson={name:pkg.name,productName:pkg.productName,version:pkg.version,description:pkg.description,type:pkg.type,main:pkg.main,private:true};
  await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify(packageJson,null,2)+'\n');
  for(const file of await files(path.join(root,'src'))){const relative=path.relative(root,file);if(!shippingSource(relative))continue;const target=path.join(appRoot,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(file,target);}
  for(const name of ['使用说明.md','版本说明.md'])await fs.copyFile(path.join(root,name),path.join(staging,name));
  // Native cmd launcher forwards optional arguments and relies only on this folder.
  await fs.writeFile(path.join(staging,'启动自由画布提取.cmd'),'@echo off\r\nchcp 65001 >nul\r\nset ELECTRON_RUN_AS_NODE=\r\nstart "" /D "%~dp0" "%~dp0'+EXECUTABLE+'" %*\r\n','utf8');
  const manifest=[];
  for(const file of await files(staging)){const relative=path.relative(staging,file).replaceAll('\\','/');if(relative.split('/').some(p=>['.runtime','validation','.backups','node_modules','exports','tests','scripts'].includes(p)))throw new Error('Private or development data entered release: '+relative);const bytes=await fs.readFile(file);manifest.push({file:relative,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile(path.join(staging,'release-manifest.json'),JSON.stringify({product:pkg.productName,version:pkg.version,platform:'win32',arch:'x64',runtime:{electron:runtimeVersion,executable:EXECUTABLE},files:manifest},null,2));
  await fs.rename(staging,folder);
  if(archive){await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/archive-portable.ps1'),'-InputDirectory',folder,'-OutputFile',zip],{windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('ZIP creation failed: '+code)));});
    const bytes=await fs.readFile(zip),hash=crypto.createHash('sha256').update(bytes).digest('hex');await fs.writeFile(zip+'.sha256',hash+'  '+path.basename(zip)+'\n');
  }
  console.log(JSON.stringify({folder,zip:archive?zip:null,version:pkg.version,electron:runtimeVersion,files:manifest.length}));return {folder,zip:archive?zip:null};
}
module.exports=packagePortable;
if(require.main===module){const index=process.argv.indexOf('--runtime');packagePortable({runtime:index>=0?process.argv[index+1]:undefined,archive:!process.argv.includes('--no-archive')}).catch(error=>{console.error(error.stack);process.exitCode=1;});}
