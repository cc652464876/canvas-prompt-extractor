'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { atomic } = require('./project-store.cjs');
// Each running application owns only its UUID subdirectory, including after
// changing the output root. Never remove user projects or another process's cache.
class SessionWorkCache {
  constructor(getRoot) {
    this.getRoot = getRoot;
    this.id = randomUUID();
    this.directories = new Set();
    this.files = new Map();
    this.pending = new Set();
    this.closed = false;
  }
  key(work, options) {
    return work.url + '|' + (options.mode || 'full');
  }
  async get(key) {
    if (this.closed || !this.files.has(key)) return null;
    try {
      const data = JSON.parse(await fs.readFile(this.files.get(key), 'utf8'));
      return data.key === key && data.version === 1 ? data.result : null;
    } catch {
      return null;
    }
  }
  async set(key, result) {
    if (this.closed) return;
    const directory = path.resolve(this.getRoot(), '.自由画布缓存', this.id);
    this.directories.add(directory);
    const file = path.join(directory, createHash('sha256').update(key).digest('hex') + '.json');
    const write = (async () => {
      await fs.mkdir(directory, { recursive: true });
      await atomic(file, JSON.stringify({ version: 1, key, result }));
    })();
    this.pending.add(write);
    try {
      await write;
      this.files.set(key, file);
    } finally {
      this.pending.delete(write);
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
    for (const directory of this.directories) {
      if (
        path.basename(directory) !== this.id ||
        path.basename(path.dirname(directory)) !== '.自由画布缓存'
      )
        throw new Error('缓存清理目录无效。');
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      // Remove the common container only when it is empty.
      await fs.rmdir(path.dirname(directory)).catch((error) => {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
      });
    }
    this.files.clear();
  }
}
module.exports = { SessionWorkCache };
