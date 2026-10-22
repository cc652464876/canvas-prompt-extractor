'use strict';
module.exports = Object.freeze({
  id: 'rhtv',
  name: 'RHTV',
  version: '1.3.0',
  homeUrl: 'https://rhtv.runninghub.cn/projects',
  workHosts: ['rhtv.runninghub.cn', 'www.runninghub.cn', 'runninghub.cn'],
  frameHosts: ['rhtv.runninghub.cn', 'www.runninghub.cn', 'runninghub.cn'],
  navigationDomains: ['runninghub.cn'],
  capabilities: { text: true, image: true, video: true, audio: true },
  requiresVisibleLoad: true
});
