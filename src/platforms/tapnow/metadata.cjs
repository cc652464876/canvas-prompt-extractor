'use strict';
module.exports = Object.freeze({
  id: 'tapnow',
  name: 'TapNow',
  version: '1.3.0',
  homeUrl: 'https://app.tapnow.plus/home/taptv',
  workHosts: ['app.tapnow.plus'],
  frameHosts: ['app.tapnow.plus'],
  navigationDomains: ['tapnow.plus', 'tapnow.media'],
  capabilities: { text: true, image: true, video: true, audio: true, authorProfile: true },
  requiresVisibleLoad: true
});
