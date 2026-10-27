'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { atomic } = require('../atomic-file.cjs');
const { createColorTagIndex, validColorTag } = require('../color-tags.cjs');
const TAG_FILE = 'color-tags.json';
class ColorTagStore {
  constructor(file, { strict = false } = {}) {
    this.file = file;
    this.tags = new Map();
    this.tail = Promise.resolve();
    this.exists = false;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        saved.schemaVersion === 1 &&
        saved.tags &&
        typeof saved.tags === 'object' &&
        !Array.isArray(saved.tags)
      ) {
        this.tags = new Map(
          Object.entries(saved.tags).filter(
            ([key, color]) => key.length <= 8192 && validColorTag(color)
          )
        );
        this.exists = true;
      } else throw new Error('颜色标签记录格式无效。');
    } catch (error) {
      if (strict && error.code !== 'ENOENT') throw error;
      if (error.code !== 'ENOENT') console.error('颜色标签记录读取失败：', error.message);
    }
  }
  apply(result, { authoritative = false } = {}) {
    if (!result) return;
    const index = createColorTagIndex(result);
    for (const [key, items] of index.byKey) {
      const color =
        this.tags.get(key) ||
        (authoritative ? 'none' : items.find((item) => validColorTag(item.colorTag))?.colorTag);
      if (color) index.set(key, color);
    }
  }
  set(key, color) {
    if (typeof key !== 'string' || key.length > 8192 || !validColorTag(color))
      return Promise.reject(new Error('标签记录无效。'));
    const write = this.tail
      .catch(() => {})
      .then(async () => {
        const next = new Map(this.tags);
        next.set(key, color);
        await atomic(
          this.file,
          JSON.stringify({ schemaVersion: 1, tags: Object.fromEntries(next) })
        );
        this.tags = next;
        this.exists = true;
      });
    this.tail = write;
    return write;
  }
}
function resultTags(result) {
  const tags = {};
  for (const [key, items] of createColorTagIndex(result).byKey) {
    const color = items.find((item) => validColorTag(item.colorTag))?.colorTag;
    if (color && color !== 'none') tags[key] = color;
  }
  return tags;
}
async function saveProjectColorTags(directory, result) {
  await atomic(
    path.join(directory, TAG_FILE),
    JSON.stringify({ schemaVersion: 1, tags: resultTags(result) }, null, 2)
  );
}
async function loadProjectColorTags(directory, result) {
  const local = new ColorTagStore(path.join(directory, TAG_FILE), { strict: true });
  if (local.exists) local.apply(result, { authoritative: true });
}
module.exports = {
  ColorTagStore,
  TAG_FILE,
  loadProjectColorTags,
  saveProjectColorTags
};
