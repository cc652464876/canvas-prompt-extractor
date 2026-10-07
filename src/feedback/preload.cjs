'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('feedback',{close:()=>ipcRenderer.send('lab:feedback-close')});
