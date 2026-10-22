'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { ExifToolReader } = require('./exiftool.cjs');
const { VERSION, pngTexts, normalizeMetadata, tagName } = require('../image-metadata.cjs');
const { atomic } = require('../project-store.cjs');
const CACHE = '.图片信息.json';
class ImageInfoService {
  constructor({ reader = new ExifToolReader(), batchSize = 32, onError = () => {} } = {}) {
    Object.assign(this, { reader, batchSize, onError });
    this.caches = new Map();
    this.pending = new Map();
    this.jobs = [];
    this.closed = false;
  }
  async cache(directory) {
    if (!this.caches.has(directory)) {
      this.caches.set(
        directory,
        (async () => {
          let entries = {};
          try {
            const file = path.join(directory, CACHE);
            if ((await fs.stat(file)).size <= 32 * 1024 * 1024) {
              const data = JSON.parse(await fs.readFile(file, 'utf8'));
              if (
                data.schemaVersion === 1 &&
                data.version === VERSION &&
                data.entries &&
                typeof data.entries === 'object' &&
                !Array.isArray(data.entries)
              )
                entries = data.entries;
            }
          } catch {
            /* Missing/obsolete/corrupt cache can be rebuilt from originals. */
          }
          return { entries, tail: Promise.resolve() };
        })()
      );
    }
    return this.caches.get(directory);
  }
  async read(asset, file, { force = false, priority = false } = {}) {
    if (this.closed) throw new Error('图片信息读取已停止。');
    const directory = path.dirname(file),
      fileName = path.basename(file),
      stat = await fs.stat(file);
    if (!stat.isFile() || !stat.size) throw new Error('本地图片不存在或为空。');
    const cache = await this.cache(directory),
      key = fileName.toLowerCase(),
      fingerprint = stat.size + ':' + stat.mtimeMs,
      old = cache.entries[key];
    if (this.closed) throw new Error('图片信息读取已停止。');
    if (!force && old?.fingerprint === fingerprint && old?.info?.status === 'done')
      return { ...old.info, assetId: asset.id, cached: true };
    const pendingKey = file + '|' + fingerprint;
    if (this.pending.has(pendingKey)) {
      const job = this.pending.get(pendingKey);
      if (priority) {
        const index = this.jobs.indexOf(job);
        if (index >= 0) this.jobs.unshift(...this.jobs.splice(index, 1));
      }
      return job.promise.then((info) => ({ ...info, assetId: asset.id }));
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const job = {
      asset,
      file,
      fileName,
      directory,
      key,
      cache,
      fingerprint,
      bytes: stat.size,
      pendingKey,
      resolve,
      reject,
      promise
    };
    this.pending.set(pendingKey, job);
    if (priority) this.jobs.unshift(job);
    else this.jobs.push(job);
    if (!this.running && !this.timer)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.drain();
      }, 30);
    return promise;
  }
  async persist(cache, directory) {
    const next = cache.tail
      .catch(() => {})
      .then(() =>
        atomic(
          path.join(directory, CACHE),
          JSON.stringify({ schemaVersion: 1, version: VERSION, entries: cache.entries })
        )
      );
    cache.tail = next;
    return next;
  }
  async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.jobs.length && !this.closed) {
        const batch = this.jobs.splice(0, this.batchSize),
          dirty = new Map(),
          completed = [],
          warnings = new Map();
        try {
          const rows = await this.reader.read(batch.map((j) => j.file));
          const byFile = new Map(
            rows.map((r) => [path.resolve(r.SourceFile || '').toLowerCase(), r])
          );
          for (const job of batch) {
            try {
              const raw = byFile.get(path.resolve(job.file).toLowerCase());
              if (!raw) throw new Error('未返回此图片的信息。');
              const error = Object.entries(raw).find(([key]) => tagName(key) === 'error');
              if (error) throw new Error(String(error[1]));
              const recovered = await pngTexts(job.file);
              const info = {
                ...normalizeMetadata(raw, recovered),
                status: 'done',
                assetId: job.asset.id,
                fileName: job.fileName,
                bytes: job.bytes,
                readAt: new Date().toISOString()
              };
              // A file replaced while reading must never be recorded with the old fingerprint.
              const after = await fs.stat(job.file);
              if (after.size + ':' + after.mtimeMs !== job.fingerprint)
                throw new Error('图片在读取期间发生变化，请重试。');
              const saved = { ...info };
              delete saved.assetId;
              job.cache.entries[job.key] = { fingerprint: job.fingerprint, info: saved };
              dirty.set(job.directory, job.cache);
              completed.push({ job, info });
            } catch (error) {
              this.pending.delete(job.pendingKey);
              job.reject(error);
            }
          }
          await Promise.all(
            [...dirty].map(([directory, cache]) =>
              this.persist(cache, directory).catch((error) => {
                warnings.set(directory, '信息已读取，但缓存保存失败：' + error.message);
                this.onError(error);
              })
            )
          );
          for (const { job, info } of completed) {
            this.pending.delete(job.pendingKey);
            job.resolve({
              ...info,
              ...(warnings.has(job.directory) ? { cacheWarning: warnings.get(job.directory) } : {})
            });
          }
        } catch (error) {
          for (const job of batch) {
            this.pending.delete(job.pendingKey);
            job.reject(error);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
  async scan(assets, project) {
    return Promise.allSettled(
      assets
        .filter((a) => a.kind === 'image' && a.state === 'done')
        .map(async (a) => this.read(a, project.assetPath(a)))
    );
  }
  async details(asset, file) {
    const info = await this.read(asset, file, { priority: true });
    let text = await this.reader.readText([file]);
    // Keep ExifTool's human-readable fields, with the same PNG text repair
    // used in the prompt view. No JSON or reconstructed summary is inserted.
    for (const recovered of info.recovered || []) {
      for (const [key, value] of Object.entries(info.raw || {})) {
        if (
          /^PNG:/.test(key) &&
          tagName(key) === tagName(recovered.key) &&
          typeof value === 'string' &&
          value &&
          value !== recovered.value
        )
          text = text.replaceAll(value, recovered.value);
      }
    }
    return text;
  }
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    for (const job of this.jobs.splice(0)) {
      this.pending.delete(job.pendingKey);
      job.reject(new Error('程序已关闭。'));
    }
    await this.reader.close();
    // drain owns all cache writes; wait for the active batch to settle first.
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
    const caches = await Promise.all(this.caches.values());
    await Promise.allSettled(caches.map((c) => c.tail));
  }
}
module.exports = { ImageInfoService, CACHE };
