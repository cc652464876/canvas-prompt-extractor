'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { atomic } = require('./project-store.cjs');
function validDirectory(value) {
  return typeof value === 'string' && !value.includes('\0') && path.isAbsolute(value);
}
function readOutputDirectory(file, fallback) {
  try {
    const preference = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (validDirectory(preference.outputDirectory))
      return path.normalize(preference.outputDirectory);
  } catch {}
  return fallback;
}
async function saveOutputDirectory(file, directory) {
  if (!validDirectory(directory)) throw new Error('保存位置无效。');
  const selected = path.normalize(directory);
  await atomic(file, JSON.stringify({ outputDirectory: selected }, null, 2));
  return selected;
}
module.exports = { readOutputDirectory, saveOutputDirectory };
