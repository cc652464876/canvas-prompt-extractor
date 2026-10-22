'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { filename, filterResult, markdown } = require('./export/markdown.cjs');
const { validateProjectRecord } = require('./core/project-schema.cjs');
const { EXTENSIONS, safeUrl } = require('./assets.cjs');
const { PROMPT_TYPES, promptKinds } = require('./prompt-types.cjs');
const { workInfoMarkdown } = require('./export/work-info.cjs');
const MANIFEST = '.画布项目.json';
const WORK_INFO = '作品信息.md';
const SUFFIXES = PROMPT_TYPES;
function projectKey(metadata) {
  if (typeof metadata.workIdentity === 'string' && metadata.workIdentity.trim())
    return metadata.platform + '|' + metadata.workIdentity;
  const u = new URL(metadata.canvasUrl || metadata.resolvedUrl || metadata.inputUrl);
  return metadata.platform + '|' + u.pathname;
}
function inside(directory, name) {
  if (
    typeof name !== 'string' ||
    name !== path.basename(name) ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    !name.trim() ||
    name === '.' ||
    name === '..'
  )
    throw new Error('项目文件名无效。');
  const p = path.resolve(directory, name);
  if (path.dirname(p) !== path.resolve(directory)) throw new Error('文件路径不属于当前项目。');
  return p;
}
async function exists(file) {
  try {
    return await fs.stat(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
async function atomic(file, text) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
class ProjectStore {
  constructor(root, { folderName = '' } = {}) {
    this.root = root;
    this.folderName = folderName;
    this.directory = null;
    this.documents = [];
    this.options = { kinds: Object.keys(PROMPT_TYPES), split: true, mode: 'simple' };
    this.tail = Promise.resolve();
  }
  serial(fn) {
    const next = this.tail.catch(() => {}).then(fn);
    this.tail = next;
    return next;
  }
  async create(result, options = {}, writeDocuments = true) {
    await fs.mkdir(this.root, { recursive: true });
    const key = projectKey(result.metadata),
      hash = createHash('sha256').update(key).digest('hex').slice(0, 8);
    const indexPath = path.join(this.root, '.项目索引.json');
    let index = {};
    try {
      index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    } catch {}
    let folder = index[key];
    if (!folder || folder !== path.basename(folder)) {
      folder = this.folderName || filename(result.metadata).slice(0, -3).slice(0, 100);
      let candidate = path.join(this.root, folder);
      if (await exists(candidate)) {
        let old;
        try {
          old = JSON.parse(await fs.readFile(path.join(candidate, MANIFEST), 'utf8'));
        } catch {}
        if (old?.projectKey !== key) folder += '_' + hash;
      }
      index[key] = folder;
      await atomic(indexPath, JSON.stringify(index, null, 2));
    }
    this.directory = inside(this.root, folder);
    await fs.mkdir(this.directory, { recursive: true });
    let previous;
    try {
      previous = JSON.parse(await fs.readFile(path.join(this.directory, MANIFEST), 'utf8'));
    } catch {}
    this.documents = Array.isArray(previous?.documents)
      ? previous.documents.filter(
          (n) => n === path.basename(n) && n.endsWith('.md') && n !== WORK_INFO
        )
      : [];
    const older = new Map((previous?.result?.assets || []).map((a) => [a.id, a]));
    const names = new Map(
      (previous?.result?.assets || []).map((a) => [String(a.fileName).toLowerCase(), a.id])
    );
    for (const a of result.assets) {
      const old = older.get(a.id);
      if (old?.fileName) {
        try {
          inside(this.directory, old.fileName);
          a.fileName = old.fileName;
        } catch {}
      }
      const owner = names.get(a.fileName.toLowerCase());
      if (owner && owner !== a.id) {
        const ext = path.extname(a.fileName);
        a.fileName = a.fileName.slice(0, -ext.length) + '_' + a.id.slice(0, 6) + ext;
      }
      names.set(a.fileName.toLowerCase(), a.id);
      if (old?.state === 'done') {
        try {
          const p = inside(this.directory, old.fileName);
          const stat = await exists(p);
          if (stat?.size > 0 && (!old.bytes || stat.size === old.bytes))
            Object.assign(a, {
              fileName: old.fileName,
              state: 'done',
              bytes: stat.size,
              total: stat.size,
              error: ''
            });
        } catch {}
      }
    }
    this.options = {
      ...this.options,
      ...options,
      kinds: promptKinds(options.kinds || this.options.kinds)
    };
    this.result = result;
    if (writeDocuments) await this.save(true);
    else await this.checkpoint();
    return this.summary();
  }
  summary() {
    return { directory: this.directory, documents: this.documents, options: this.options };
  }
  async archive(name) {
    const file = inside(this.directory, name);
    if (!(await exists(file))) return;
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..*/, '')
      .replace('T', '_');
    await fs.rename(
      file,
      inside(this.directory, '历史_' + stamp + '_' + randomUUID().slice(0, 5) + '__' + name)
    );
  }
  async writeManifest() {
    await this.writeWorkInfo();
    await atomic(
      path.join(this.directory, MANIFEST),
      JSON.stringify(
        {
          schemaVersion: 2,
          projectKey: projectKey(this.result.metadata),
          documents: this.documents,
          options: this.options,
          result: this.result
        },
        null,
        2
      )
    );
  }
  async writeWorkInfo() {
    const file = inside(this.directory, WORK_INFO),
      text = workInfoMarkdown(this.result.metadata);
    let old;
    try {
      old = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (old !== text) {
      if (old && !/^# 作品信息\r?\n/.test(old)) await this.archive(WORK_INFO);
      await atomic(file, text);
    }
  }
  textFile(nodeId) {
    const entry = this.result?.entries.find((e) => e.nodeId === nodeId && e.kind === 'text');
    if (!entry?.prompt?.trim()) throw new Error('此文本节点没有可保存的正文。');
    const index = this.result.entries.filter((e) => e.kind === 'text').indexOf(entry) + 1;
    const hash = createHash('sha256').update(nodeId).digest('hex').slice(0, 8);
    const label =
      entry.name
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .trim()
        .slice(0, 60) || '未命名文本';
    const name = '文本_' + String(index).padStart(4, '0') + '_' + label + '_' + hash + '.txt';
    return { entry, name };
  }
  async textFileInfo(nodeId) {
    if (!this.directory) return { saved: false };
    const { entry, name } = this.textFile(nodeId),
      file = inside(this.directory, name);
    const stat = await exists(file);
    if (!stat?.isFile() || stat.size > 8 * 1024 * 1024) return { saved: false };
    return { saved: (await fs.readFile(file, 'utf8')) === entry.prompt, file, fileName: name };
  }
  saveText(nodeId) {
    return this.serial(async () => {
      const { entry, name } = this.textFile(nodeId);
      const file = inside(this.directory, name);
      let old;
      try {
        old = await fs.readFile(file, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (old !== entry.prompt) {
        if (old !== undefined) await this.archive(name);
        await atomic(file, entry.prompt);
      }
      await this.writeManifest();
      return { ...this.summary(), savedText: name };
    });
  }
  checkpoint() {
    return this.serial(async () => {
      if (this.result && this.directory) {
        await this.writeManifest();
        return this.summary();
      }
    });
  }
  save(archive = false, token = { cancelled: false }) {
    return this.serial(async () => {
      if (!this.result || !this.directory) return;
      const kinds = promptKinds(this.options.kinds);
      const names = [],
        base = filename(this.result.metadata).slice(0, -3);
      const groups = this.options.split ? kinds.map((k) => [k]) : [kinds];
      for (const selection of groups) {
        if (token.cancelled) break;
        const filtered = filterResult(this.result, selection);
        if (!filtered.entries.length) continue;
        const name = base + (this.options.split ? '__' + SUFFIXES[selection[0]] : '') + '.md';
        const text = markdown(filtered),
          file = inside(this.directory, name);
        let old;
        try {
          old = await fs.readFile(file, 'utf8');
        } catch {}
        if (old !== text) {
          if (old && archive) await this.archive(name);
          await atomic(file, text);
        }
        names.push(name);
        // Yield between documents so a stop request can preserve completed files.
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (!token.cancelled) {
        for (const stale of this.documents) if (!names.includes(stale)) await this.archive(stale);
        this.documents = names;
      } else this.documents = [...new Set([...this.documents, ...names])];
      await this.writeManifest();
      return { ...this.summary(), cancelled: token.cancelled, savedDocuments: names };
    });
  }
  async load(directory) {
    const stat = await fs.stat(path.join(directory, MANIFEST));
    if (stat.size > 40 * 1024 * 1024) throw new Error('项目记录过大。');
    const data = JSON.parse(await fs.readFile(path.join(directory, MANIFEST), 'utf8'));
    const r = validateProjectRecord(data);
    try {
      projectKey(r.metadata);
    } catch {
      throw new Error('项目原始链接无效。');
    }
    this.directory = path.resolve(directory);
    this.documents = (data.documents || []).filter(
      (n) => n === path.basename(n) && n.endsWith('.md') && n !== WORK_INFO
    );
    this.options = {
      ...this.options,
      ...data.options,
      kinds: promptKinds(data.options?.kinds || this.options.kinds)
    };
    this.result = data.result;
    for (const a of this.result.assets) {
      if (!EXTENSIONS[a.kind]?.includes(path.extname(a.fileName).toLowerCase()))
        throw new Error('项目包含不支持的素材文件类型。');
      inside(this.directory, a.fileName);
      a.url = safeUrl(a.url);
      a.previewUrl = safeUrl(a.previewUrl);
      if (a.state === 'downloading') a.state = 'pending';
      if (a.state === 'done') {
        const stat = await exists(inside(this.directory, a.fileName));
        if (!stat?.size || (a.bytes && stat.size !== a.bytes)) {
          a.state = a.url ? 'pending' : 'unavailable';
          a.error = '本地文件缺失或不完整';
        }
      }
    }
    return this.result;
  }
  assetPath(asset) {
    if (!this.directory) throw new Error('请先提取或打开本地项目。');
    return inside(this.directory, asset.fileName);
  }
  prepareRedownload(ids) {
    return this.serial(async () => {
      const selected = new Set(ids);
      for (const a of this.result.assets) {
        if (!selected.has(a.id) || a.state !== 'done') continue;
        const file = this.assetPath(a),
          stat = await exists(file);
        if (stat) {
          const stamp = new Date()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..*/, '')
            .replace('T', '_');
          await fs.rename(
            file,
            inside(
              this.directory,
              '历史素材_' + stamp + '_' + randomUUID().slice(0, 5) + '__' + a.fileName
            )
          );
        }
        Object.assign(a, {
          state: a.url ? 'pending' : 'unavailable',
          bytes: 0,
          total: 0,
          savedBytes: 0,
          error: ''
        });
      }
    });
  }
}
module.exports = { ProjectStore, inside, atomic, MANIFEST, WORK_INFO };
