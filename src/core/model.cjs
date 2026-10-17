'use strict';
const TYPES = {
  video: '视频生成',
  image_text: '文生图',
  image_reference: '图生图／图片编辑',
  image_unknown: '图片生成（模式未确认）',
  audio: '音频生成',
  text: '独立文本'
};
const SCHEMA_VERSION = 2;
const APPLICATION_VERSION = require('../../package.json').version;
function validPlatformId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}
module.exports = { TYPES, SCHEMA_VERSION, APPLICATION_VERSION, validPlatformId };
