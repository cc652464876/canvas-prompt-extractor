'use strict';
const path=require('node:path');
const EXECUTABLE='自由画布提取.exe';
const SOURCE_FILES=['package.json','README.md','使用说明.md'];
const RUNTIME_FILES=['chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','LICENSE','LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','version','vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll'];
function shippingSource(relative){
  const file=relative.replaceAll('\\','/');
  return file.startsWith('src/')&&!/^src\/(?:verify-[^/]+\.cjs|probe-network\.cjs)$/.test(file)&&!file.split('/').some(part=>['.runtime','validation','.backups','node_modules','exports'].includes(part));
}
function runtimeCandidates(root){return [path.join(root,'node_modules/electron/dist'),path.join(root,'../node_modules/electron/dist')];}
module.exports={EXECUTABLE,SOURCE_FILES,RUNTIME_FILES,shippingSource,runtimeCandidates};
