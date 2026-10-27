'use strict';
const fs = require('node:fs');
const { atomic } = require('./project-store.cjs');
const DOWNLOAD_CONCURRENCY_OPTIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 16]);
const DEFAULT_DOWNLOAD_CONCURRENCY = 2;
function readDownloadConcurrency(file) {
  try {
    const { concurrency } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (DOWNLOAD_CONCURRENCY_OPTIONS.includes(concurrency)) return concurrency;
  } catch {}
  return DEFAULT_DOWNLOAD_CONCURRENCY;
}
async function saveDownloadConcurrency(file, concurrency) {
  if (!DOWNLOAD_CONCURRENCY_OPTIONS.includes(concurrency))
    throw new Error('下载并发数必须为 1、2、3、4、5、6、7、8 或 16。');
  await atomic(file, JSON.stringify({ concurrency }, null, 2));
  return concurrency;
}
module.exports = {
  DOWNLOAD_CONCURRENCY_OPTIONS,
  DEFAULT_DOWNLOAD_CONCURRENCY,
  readDownloadConcurrency,
  saveDownloadConcurrency
};
