'use strict';
const fs = require('node:fs');
const { atomic } = require('./project-store.cjs');
function readVisibility(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')).visible;
    if (typeof value === 'boolean') return value;
  } catch {}
  return true;
}
function saveVisibility(file, visible) {
  return atomic(file, JSON.stringify({ visible: Boolean(visible) }, null, 2));
}
module.exports = { readVisibility, saveVisibility };
