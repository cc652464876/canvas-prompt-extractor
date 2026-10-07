'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel,...args) => ipcRenderer.invoke(channel,...args);
contextBridge.exposeInMainWorld('lab', {
  extract:(input,options) => call('lab:extract',input,options), cancel:() => call('lab:cancel'), visible:value => call('lab:visible',value),
  theme:value=>call('lab:theme',value),
  update:options => call('lab:update',options), copy:options => call('lab:copy',options), directory:() => call('lab:directory'),
  save:options=>call('lab:save',options),stopSave:()=>call('lab:save-cancel'),
  openFolder:() => call('lab:open-folder'), info:() => call('lab:info'),
  openLocalProject:input=>call('lab:open-local-project',input),
  reveal:id=>call('lab:reveal',id),download:options=>call('lab:download',options),downloadControl:action=>call('lab:download-control',action),
  login:platform=>call('lab:login',platform),loginState:()=>call('lab:login-state'),
  resetBrowser:settings=>call('lab:reset-browser',settings),
  copyText:text=>call('lab:copy-text',text),cacheThumbnail:(id,data)=>call('lab:cache-thumbnail',id,data),thumbnailInfo:id=>call('lab:thumbnail-info',id),
  onEvent:callback => { ipcRenderer.on('lab:event',(_event,message) => callback(message)); }
});
