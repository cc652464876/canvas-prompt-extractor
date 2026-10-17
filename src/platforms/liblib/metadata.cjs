'use strict';
module.exports = Object.freeze({
  id: 'liblib',
  name: 'LibTV',
  version: '1.3.0',
  homeUrl: 'https://www.liblib.tv/',
  workHosts: ['liblib.tv', 'www.liblib.tv'],
  frameHosts: ['liblib.tv', 'www.liblib.tv'],
  navigationDomains: [
    'liblib.tv',
    'liblib.art',
    'bytedance.com',
    'douyin.com',
    'feishu.cn',
    'larkoffice.com'
  ],
  capabilities: { text: true, image: true, video: true, audio: true, authorProfile: true },
  requiresVisibleLoad: true
});
