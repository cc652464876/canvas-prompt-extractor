'use strict';
const fs = require('node:fs');
const { atomic } = require('./project-store.cjs');
function readSocialPreference(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).enabled === true;
  } catch {
    return false;
  }
}
function saveSocialPreference(file, enabled) {
  return atomic(file, JSON.stringify({ enabled: enabled === true }, null, 2));
}
module.exports = { readSocialPreference, saveSocialPreference };
