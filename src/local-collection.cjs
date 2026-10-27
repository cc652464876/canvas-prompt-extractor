'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { namespaceResult } = require('./author-library.cjs');
const { INDEX, findProjectFile, isProjectFile } = require('./project-files.cjs');
const COLLECTION = '.作者选集.json';
async function loadLocalCollection(directory, selectedName = '') {
  const root = await fs.realpath(directory);
  const name = selectedName || (await findProjectFile(root, 'collection'));
  if (name !== path.basename(name) || !isProjectFile(name, 'collection'))
    throw new Error('请选择作品集入口文件。');
  const indexFile = path.join(root, name);
  if ((await fs.stat(indexFile)).size > 2 * 1024 * 1024) throw new Error('作者项目索引过大。');
  const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  if (!index || typeof index !== 'object' || Array.isArray(index))
    throw new Error('作者项目索引格式无效。');
  const items = Object.entries(index);
  if (!items.length || items.length > 2000) throw new Error('作者项目索引为空或作品数量过多。');
  let saved = {};
  try {
    const file = path.join(root, COLLECTION);
    if ((await fs.stat(file)).size < 2 * 1024 * 1024)
      saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (saved?.schemaVersion !== 1) saved = {};
  } catch {}
  const works = [],
    records = new Map(),
    folders = new Set(),
    ids = new Set();
  let platform = '',
    author = '';
  // Lazy import avoids a cycle with the single-project/collection dispatcher.
  const { loadLocalProject } = require('./local-project.cjs');
  for (const [key, folder] of items) {
    if (
      typeof folder !== 'string' ||
      !folder.trim() ||
      folder !== path.basename(folder) ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(folder) ||
      ['.', '..'].includes(folder) ||
      /[. ]$/.test(folder) ||
      folders.has(folder.toLowerCase())
    )
      throw new Error('作者索引包含无效或重复的作品目录。');
    folders.add(folder.toLowerCase());
    const match = key.match(/^([a-z]+)\|(?:liblib-template|work):(.+)$/);
    const id = match?.[2] || createHash('sha256').update(key).digest('hex').slice(0, 32);
    if (ids.has(id)) throw new Error('作者索引包含重复作品。');
    ids.add(id);
    const info = Array.isArray(saved.works) ? saved.works.find((w) => w.id === id) : null;
    const work = {
      id,
      title: folder,
      url: /^https?:\/\//i.test(info?.url) ? info.url : '',
      cover: '',
      state: 'ready',
      error: ''
    };
    const candidate = path.join(root, folder);
    try {
      const resolved = await fs.realpath(candidate);
      if (path.dirname(resolved).toLowerCase() !== root.toLowerCase())
        throw new Error('作品目录指向作者文件夹以外的位置。');
      const loaded = await loadLocalProject(resolved);
      if (loaded.collection) throw new Error('作品目录不能是另一套作者选集。');
      const metadata = loaded.result.metadata;
      if (platform && (metadata.platform !== platform || metadata.author !== author))
        throw new Error('作品所属作者与选集不一致。');
      platform = metadata.platform;
      author = metadata.author || '';
      work.title = metadata.title || info?.title || folder;
      work.url = metadata.inputUrl;
      work.canvasAccess = metadata.canvasAccess || 'public';
      work.note = metadata.canvasNote || '';
      work.videoAvailable = loaded.result.assets.some((a) => a.role === 'full-video' && a.url);
      const result = loaded.result.entries.some((e) => e.workId === id)
        ? loaded.result
        : namespaceResult(loaded.result, work);
      loaded.store.result = result;
      const cover = result.assets.find((a) => a.kind === 'image' && a.state === 'done');
      if (cover) work.cover = 'labmedia://local/' + encodeURIComponent(cover.id);
      records.set(id, { work, result, store: loaded.store });
    } catch (error) {
      work.state = 'error';
      work.error = error.code === 'ENOENT' ? '本地作品目录或项目记录缺失。' : error.message;
    }
    works.push(work);
  }
  if (!records.size) throw new Error('选集中没有可打开的本地画布，请检查作品目录。');
  if (Array.isArray(saved.works)) {
    const order = new Map(saved.works.map((w, i) => [w.id, i]));
    works.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }
  return {
    collection: true,
    directory: root,
    manifestPath: indexFile,
    records,
    profile: {
      platform,
      author,
      uuid: String(saved.uuid || root),
      url:
        (/^https?:\/\//i.test(saved.url) ? saved.url : '') ||
        records.values().next().value.result.metadata.authorProfiles?.[0]?.profileUrl ||
        records.values().next().value.result.metadata.inputUrl,
      localProject: true,
      directory: root,
      manifestPath: indexFile,
      works,
      selectedIds: works.map((w) => w.id)
    }
  };
}
module.exports = { loadLocalCollection, INDEX, COLLECTION };
