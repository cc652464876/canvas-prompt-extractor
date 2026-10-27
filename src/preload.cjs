'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('lab', {
  extract: (input, options) => call('lab:extract', input, options),
  cancel: () => call('lab:cancel'),
  author: (input, options) => call('lab:author', input, options),
  socialLogin: (platform) => call('lab:social-login', platform),
  socialProfilePreference: (enabled) => call('lab:social-profile-preference', enabled),
  selectWorks: (ids) => call('lab:author-select', ids),
  readWorks: (options) => call('lab:author-read', options),
  retryWork: (id) => call('lab:author-retry', id),
  visible: (value) => call('lab:visible', value),
  theme: (value) => call('lab:theme', value),
  update: (options) => call('lab:update', options),
  copy: (options) => call('lab:copy', options),
  directory: () => call('lab:directory'),
  save: (options) => call('lab:save', options),
  saveText: (nodeId) => call('lab:save-text', nodeId),
  textFile: (nodeId, reveal = false) => call('lab:text-file', nodeId, reveal),
  stopSave: () => call('lab:save-cancel'),
  openFolder: () => call('lab:open-folder'),
  info: () => call('lab:info'),
  openLocalProject: (input) => call('lab:open-local-project', input),
  checkUpdates: (options) => call('lab:check-updates', options),
  setColorTag: (value) => call('lab:color-tag', value),
  openCanvas: () => call('lab:open-canvas'),
  reveal: (id) => call('lab:reveal', id),
  download: (options) => call('lab:download', options),
  downloadConcurrency: (value) => call('lab:download-concurrency', value),
  downloadControl: (action) => call('lab:download-control', action),
  login: (platform) => call('lab:login', platform),
  loginAll: () => call('lab:browser-login-all'),
  openBrowser: (input) => call('lab:browser-open', input),
  resetBrowser: (settings) => call('lab:reset-browser', settings),
  copyText: (text) => call('lab:copy-text', text),
  cacheThumbnail: (id, data) => call('lab:cache-thumbnail', id, data),
  thumbnailInfo: (id) => call('lab:thumbnail-info', id),
  imageInfo: (id, options) => call('lab:image-info', id, options),
  imageInfoDetails: (id) => call('lab:image-info-details', id),
  onEvent: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('lab:event', listener);
    return () => ipcRenderer.removeListener('lab:event', listener);
  }
});
