'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {ProjectStore,MANIFEST}=require('./project-store.cjs');

function absoluteProjectPath(input){
  if(typeof input!=='string')throw new Error('本地项目路径无效。');
  let target=input.trim();
  if(target.startsWith('"')&&target.endsWith('"'))target=target.slice(1,-1).trim();
  if(!target||!path.isAbsolute(target))throw new Error('请填写本地项目文件夹或项目记录文件的完整路径。');
  return path.resolve(target);
}
function isCurrentProjectPath(input,directory){
  if(!directory)return false;
  try{
    const canonical=value=>{const resolved=path.resolve(value);return process.platform==='win32'?resolved.toLowerCase():resolved;};
    const target=canonical(absoluteProjectPath(input));
    return target===canonical(directory)||target===canonical(path.join(directory,MANIFEST));
  }catch{return false;}
}
async function loadLocalProject(input){
  const target=absoluteProjectPath(input);
  let stat;
  try{stat=await fs.stat(target);}catch(error){if(error.code==='ENOENT')throw new Error('本地项目路径不存在，请检查路径。');throw error;}
  const directory=stat.isDirectory()?target:path.dirname(target);
  if(!stat.isDirectory()&&(!stat.isFile()||path.basename(target)!==MANIFEST))throw new Error('请选择 .画布项目.json 文件或它所在的项目文件夹。');
  const manifestPath=path.join(directory,MANIFEST),store=new ProjectStore(path.dirname(directory));
  let result;
  try{result=await store.load(directory);}catch(error){
    if(error.code==='ENOENT')throw new Error('项目文件夹中未找到 .画布项目.json。');
    if(error instanceof SyntaxError)throw new Error('项目记录文件损坏，无法打开。');
    throw error;
  }
  return {store,result,manifestPath};
}
module.exports={loadLocalProject,isCurrentProjectPath};
