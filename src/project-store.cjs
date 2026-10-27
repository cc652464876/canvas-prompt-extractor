'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { filename, filterResult, markdown } = require('./export/markdown.cjs');
const { aiReadingMarkdown } = require('./export/ai-reading.cjs');
const { validateProjectRecord } = require('./core/project-schema.cjs');
const { EXTENSIONS, safeUrl } = require('./assets.cjs');
const { PROMPT_TYPES, promptKinds } = require('./prompt-types.cjs');
const { workInfoMarkdown } = require('./export/work-info.cjs');
const { projectKey, assetIdentity } = require('./project-identity.cjs');
const { inheritColorTags, createColorTagIndex } = require('./color-tags.cjs');
const { atomic } = require('./atomic-file.cjs');
const { loadProjectColorTags, saveProjectColorTags } = require('./services/color-tags.cjs');
const {
  MANIFEST,
  INDEX,
  projectFolderName,
  manifestName,
  isProjectFile,
  findProjectFile
} = require('./project-files.cjs');
const WORK_INFO = '作品信息.md';
const SUFFIXES = PROMPT_TYPES;
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
class ProjectStore {
  constructor(root, { folderName = '', indexName = '' } = {}) {
    this.root = root;
    this.folderName = folderName;
    this.indexName = indexName;
    this.manifestName = '';
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
    const previousIndex = await findProjectFile(this.root, 'collection', true);
    const indexPath = inside(this.root, this.indexName || previousIndex || INDEX);
    let index = {};
    try {
      index = JSON.parse(
        await fs.readFile(inside(this.root, previousIndex || this.indexName || INDEX), 'utf8')
      );
    } catch {}
    const matching = async (directory) => {
      try {
        const name = await findProjectFile(directory);
        const file = inside(directory, name);
        if ((await fs.stat(file)).size > 40 * 1024 * 1024) return false;
        const old = JSON.parse(await fs.readFile(file, 'utf8'));
        return projectKey(old.result.metadata) === key;
      } catch {
        return false;
      }
    };
    const direct = await matching(this.root);
    let folder;
    if (!direct) {
      const base = this.folderName || projectFolderName(result.metadata);
      // Only inspect the index and exact candidate names, never walk downloads.
      for (const name of [...new Set([index[key], ...Object.values(index), base])]) {
        if (typeof name !== 'string') continue;
        let candidate;
        try {
          candidate = inside(this.root, name);
        } catch {
          continue;
        }
        if (await matching(candidate)) {
          folder = name;
          break;
        }
      }
      if (!folder) {
        folder = base;
        for (let attempt = 0; await exists(inside(this.root, folder)); attempt++) {
          if (await matching(inside(this.root, folder))) break;
          folder = base + '_' + hash + (attempt ? '_' + attempt : '');
        }
      }
      index[key] = folder;
      for (const oldKey of Object.keys(index))
        if (oldKey !== key && index[oldKey] === folder) delete index[oldKey];
      await atomic(indexPath, JSON.stringify(index, null, 2));
      if (previousIndex && previousIndex !== path.basename(indexPath))
        await fs.unlink(inside(this.root, previousIndex));
    }
    this.directory = direct ? path.resolve(this.root) : inside(this.root, folder);
    await fs.mkdir(this.directory, { recursive: true });
    let previous, previousName;
    try {
      const name = await findProjectFile(this.directory);
      previous = JSON.parse(await fs.readFile(inside(this.directory, name), 'utf8'));
      if (projectKey(previous.result.metadata) === key) previousName = name;
      else previous = null;
    } catch {}
    inheritColorTags(result, previous?.result);
    await loadProjectColorTags(this.directory, result);
    this.documents = Array.isArray(previous?.documents)
      ? previous.documents.filter(
          (n) => n === path.basename(n) && n.endsWith('.md') && n !== WORK_INFO
        )
      : [];
    const older = new Map((previous?.result?.assets || []).map((a) => [a.id, a]));
    const byMedia = new Map((previous?.result?.assets || []).map((a) => [assetIdentity(a), a]));
    const names = new Map(
      (previous?.result?.assets || []).map((a) => [String(a.fileName).toLowerCase(), a.id])
    );
    for (const a of result.assets) {
      const old = older.get(a.id) || (a.url && byMedia.get(assetIdentity(a)));
      // A cached result can carry another directory's download state. Only a
      // verified file in this destination may be considered complete.
      Object.assign(a, {
        state: a.url ? 'pending' : 'unavailable',
        bytes: 0,
        total: 0,
        savedBytes: 0,
        error: a.url ? '' : a.error || '平台尚未提供可下载地址'
      });
      if (old?.fileName) {
        try {
          inside(this.directory, old.fileName);
          a.fileName = old.fileName;
        } catch {}
      }
      const owner = names.get(a.fileName.toLowerCase());
      if (owner && owner !== a.id && owner !== old?.id) {
        const ext = path.extname(a.fileName);
        a.fileName = a.fileName.slice(0, -ext.length) + '_' + a.id.slice(0, 6) + ext;
      }
      names.set(a.fileName.toLowerCase(), a.id);
      if (old?.state === 'done' && assetIdentity(old) === assetIdentity(a)) {
        try {
          const p = inside(this.directory, old.fileName);
          const stat = await exists(p);
          if (stat?.size > 0 && (!old.bytes || stat.size === old.bytes))
            Object.assign(a, {
              fileName: old.fileName,
              state: 'done',
              bytes: stat.size,
              total: stat.size,
              savedBytes: stat.size,
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
    this.manifestName = manifestName(result.metadata);
    if (writeDocuments) await this.save(true);
    else await this.checkpoint();
    if (previousName && previousName !== this.manifestName)
      await fs.unlink(inside(this.directory, previousName));
    return this.summary();
  }
  summary() {
    return {
      directory: this.directory,
      manifestPath: this.directory && path.join(this.directory, this.manifestName),
      documents: this.documents,
      options: this.options
    };
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
  async writeManifest({ tags = true } = {}) {
    if (tags) await saveProjectColorTags(this.directory, this.result);
    await this.writeWorkInfo();
    await atomic(
      inside(this.directory, this.manifestName),
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
  save(_archive = false, token = { cancelled: false }) {
    return this.serial(async () => {
      if (!this.result || !this.directory) return;
      const kinds = promptKinds(this.options.kinds);
      const names = [],
        base = filename(this.result.metadata).slice(0, -3);
      const groups = this.options.split ? kinds.map((k) => [k]) : [kinds];
      const writeDocument = async (name, text) => {
        const file = inside(this.directory, name);
        let old;
        try {
          old = await fs.readFile(file, 'utf8');
        } catch {}
        if (old !== text) await atomic(file, text);
        names.push(name);
        // Yield between documents so a stop request preserves completed files.
        await new Promise((resolve) => setImmediate(resolve));
      };
      for (const selection of groups) {
        if (token.cancelled) break;
        const filtered = filterResult(this.result, selection);
        if (!filtered.entries.length) continue;
        const name = base + (this.options.split ? '__' + SUFFIXES[selection[0]] : '') + '.md';
        await writeDocument(name, markdown(filtered));
      }
      if (!token.cancelled) {
        // Always combine the work's video + text content, independently of the
        // original category checkboxes and split setting. No extra UI action.
        const text = aiReadingMarkdown(this.result);
        if (text) await writeDocument(base + '__AI阅读精简版.md', text);
      }
      if (!token.cancelled) {
        this.documents = names;
      } else this.documents = [...new Set([...this.documents, ...names])];
      await this.writeManifest();
      return { ...this.summary(), cancelled: token.cancelled, savedDocuments: names };
    });
  }
  async load(directory, selectedName = '') {
    const name = selectedName || (await findProjectFile(directory));
    if (!isProjectFile(name)) throw new Error('请选择画布项目入口文件。');
    const file = inside(directory, name);
    const stat = await fs.stat(file);
    if (stat.size > 40 * 1024 * 1024) throw new Error('项目记录过大。');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    const r = validateProjectRecord(data);
    try {
      projectKey(r.metadata);
    } catch {
      throw new Error('项目原始链接无效。');
    }
    this.directory = path.resolve(directory);
    this.manifestName = name;
    this.documents = (data.documents || []).filter(
      (n) => n === path.basename(n) && n.endsWith('.md') && n !== WORK_INFO
    );
    this.options = {
      ...this.options,
      ...data.options,
      kinds: promptKinds(data.options?.kinds || this.options.kinds)
    };
    this.result = data.result;
    await loadProjectColorTags(this.directory, this.result);
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
  async restoreColorTags(result) {
    const key = projectKey(result.metadata);
    const matching = async (directory) => {
      try {
        const name = await findProjectFile(directory);
        const file = inside(directory, name);
        if ((await fs.stat(file)).size > 40 * 1024 * 1024) return null;
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        return projectKey(data.result.metadata) === key ? data.result : null;
      } catch {
        return null;
      }
    };
    let directory = path.resolve(this.root),
      previous = await matching(directory);
    if (!previous) {
      let saved = {};
      try {
        const name = await findProjectFile(this.root, 'collection');
        saved = JSON.parse(await fs.readFile(inside(this.root, name), 'utf8'));
      } catch {}
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
      const base = this.folderName || projectFolderName(result.metadata);
      for (const name of [...new Set([saved[key], ...Object.values(saved), base])]) {
        if (typeof name !== 'string') continue;
        try {
          directory = inside(this.root, name);
          previous = await matching(directory);
          if (previous) break;
        } catch {}
      }
    }
    if (previous) {
      inheritColorTags(result, previous);
      await loadProjectColorTags(directory, result);
    }
  }
  setColorTag(key, color) {
    return this.serial(async () => {
      if (!this.directory || !this.result) throw new Error('请先建立画布文件夹。');
      const index = createColorTagIndex(this.result);
      if (!index.byKey.has(key)) throw new Error('当前画布中没有此标签对应的素材。');
      const before = index.byKey.get(key).map((item) => [item, item.colorTag]);
      index.set(key, color);
      try {
        await saveProjectColorTags(this.directory, this.result);
      } catch (error) {
        for (const [item, tag] of before) {
          if (tag === undefined) delete item.colorTag;
          else item.colorTag = tag;
        }
        throw error;
      }
      let warning = '';
      try {
        await this.writeManifest({ tags: false });
      } catch (error) {
        warning = '标签已保存到画布文件夹，但项目记录更新失败：' + error.message;
      }
      return { key, color, warning };
    });
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
