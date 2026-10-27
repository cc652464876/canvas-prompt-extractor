'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { ProjectStore, atomic } = require('./project-store.cjs');
const { APPLICATION_VERSION } = require('./core/model.cjs');
const { createColorTagIndex } = require('./color-tags.cjs');
const {
  safeFolder,
  authorFolderName,
  isAuthorFolder,
  resolveAuthorDirectory,
  projectFolderName,
  collectionName
} = require('./project-files.cjs');
function namespaceResult(original, work) {
  const nodes = new Set((original.nodeSummaries || []).map((n) => n.nodeId));
  for (const e of original.entries) nodes.add(e.nodeId);
  for (const a of original.assets) for (const id of a.nodeIds || []) nodes.add(id);
  const map = new Map([...nodes].map((id) => [id, work.id + '::' + id]));
  for (const edge of original.edges || []) if (edge.id) map.set(edge.id, work.id + '::' + edge.id);
  for (const a of original.assets)
    map.set(
      a.id,
      createHash('sha256')
        .update(work.id + '\0' + a.id)
        .digest('hex')
        .slice(0, 24)
    );
  // Only relationship identifiers are rewritten; prompt strings and URLs are literal content.
  const scalar = new Set([
    'id',
    'nodeId',
    'source',
    'target',
    'sourceInstanceId',
    'targetNodeId',
    'textKey'
  ]);
  const arrays = new Set(['nodeIds', 'assetIds', 'outputAssetIds', 'linkedNodeIds']);
  function copy(value, key = '') {
    if (Array.isArray(value))
      return value.map((v) =>
        arrays.has(key) && typeof v === 'string' ? map.get(v) || v : copy(v)
      );
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v, k)]));
    if (typeof value === 'string' && scalar.has(key))
      return map.get(value) || (key === 'textKey' ? work.id + '::' + value : value);
    return value;
  }
  const result = copy(original);
  result.metadata.workIdentity =
    (original.metadata.platform === 'liblib' ? 'liblib-template:' : 'work:') + work.id;
  result.metadata.workId = work.id;
  if (work.canvasId) result.metadata.canvasId = work.canvasId;
  for (const item of [...result.assets, ...result.entries, ...(result.nodeSummaries || [])]) {
    item.workId = work.id;
    item.workTitle = work.title;
  }
  return result;
}
function mergeResults(profile, results, selectedIds) {
  const chosen = selectedIds.map((id) => results.get(id)).filter(Boolean);
  const aggregate = {
    schemaVersion: 2,
    metadata: {
      platform: profile.platform,
      inputUrl: profile.url,
      resolvedUrl: profile.url,
      title: '作者选集',
      author: profile.author,
      ...(profile.authorInfo
        ? {
            authorProfiles: [profile.authorInfo.profile, ...(profile.authorInfo.socialLinks || [])]
          }
        : {}),
      applicationVersion: APPLICATION_VERSION,
      authorProfile: true,
      extractedAt: new Date().toISOString()
    },
    authorProfile: {
      uuid: profile.uuid,
      url: profile.url,
      author: profile.author,
      total: profile.works.length,
      selectedIds: [...selectedIds],
      loadedIds: selectedIds.filter((id) => results.has(id)),
      unpublishedIds: selectedIds.filter(
        (id) => results.get(id)?.metadata.canvasAccess === 'not-public'
      ),
      pending: selectedIds.filter(
        (id) => !results.has(id) && !profile.works.find((w) => w.id === id)?.error
      ).length
    },
    entries: [],
    assets: [],
    edges: [],
    nodeSummaries: [],
    diagnostics: {
      source: 'author-selection',
      warnings: [],
      counts: {},
      nodeCount: 0,
      edgeCount: 0
    }
  };
  for (const r of chosen) {
    for (const key of ['entries', 'assets', 'edges', 'nodeSummaries'])
      aggregate[key].push(...(r[key] || []));
    for (const [key, value] of Object.entries(r.diagnostics)) {
      if (typeof value === 'number' && Number.isFinite(value))
        aggregate.diagnostics[key] = (aggregate.diagnostics[key] || 0) + value;
    }
    for (const [kind, n] of Object.entries(r.diagnostics.counts || {}))
      aggregate.diagnostics.counts[kind] = (aggregate.diagnostics.counts[kind] || 0) + n;
    aggregate.diagnostics.warnings.push(
      ...r.diagnostics.warnings.map((w) => r.metadata.title + '：' + w)
    );
  }
  for (const work of profile.works)
    if (selectedIds.includes(work.id) && work.error)
      aggregate.diagnostics.warnings.push(work.title + '：' + work.error);
  aggregate.entries.sort(
    (a, b) =>
      String(a.group || '').localeCompare(String(b.group || ''), 'zh') ||
      (a.position?.y || 0) - (b.position?.y || 0) ||
      (a.position?.x || 0) - (b.position?.x || 0)
  );
  return aggregate;
}
class AuthorStore {
  constructor(root, profile, result, records) {
    this.root = root;
    this.profile = profile;
    this.result = result;
    this.records = records;
    this.directory = null;
    this.options = {};
    this.documents = [];
    this.authorDirectory = profile.localProject
      ? profile.directory
      : isAuthorFolder(path.basename(path.resolve(root)), profile)
        ? path.resolve(root)
        : path.join(root, authorFolderName(profile));
  }
  async prepare() {
    if (this.profile.localProject) {
      this.directory = this.authorDirectory = this.profile.directory;
      for (const record of this.records) record.store.options = this.options;
      return this;
    }
    this.directory = this.authorDirectory = await resolveAuthorDirectory(this.root, this.profile);
    await fs.mkdir(this.directory, { recursive: true });
    await atomic(
      path.join(this.directory, '.作者选集.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          platform: this.profile.platform,
          author: this.profile.author,
          uuid: this.profile.uuid,
          url: this.profile.url,
          works: this.profile.works.map(({ id, title, url, canvasAccess, note }) => ({
            id,
            title,
            url,
            canvasAccess,
            note
          }))
        },
        null,
        2
      )
    );
    for (const record of this.records) {
      record.result.metadata.authorWorkCount = {
        url: this.profile.url,
        total: this.profile.works.length,
        checkedAt: new Date().toISOString()
      };
      if (!record.store || record.store.root !== this.directory) {
        const project = new ProjectStore(this.directory, {
          folderName: projectFolderName({
            ...record.result.metadata,
            platform: this.profile.platform,
            author: this.profile.author,
            title: record.work.title
          }),
          indexName: collectionName(this.profile)
        });
        await project.create(record.result, this.options, false);
        record.store = project;
      }
      record.store.options = this.options;
    }
    return this;
  }
  summary() {
    return {
      root: this.root,
      directory: this.directory,
      authorDirectory: this.authorDirectory,
      documents: this.records.flatMap((r) =>
        (r.store?.documents || []).map((name) => r.work.title + ' / ' + name)
      ),
      options: this.options,
      authorProfile: true
    };
  }
  assetPath(asset) {
    const record = this.records.find((r) => r.work.id === asset.workId);
    if (!record?.store) throw new Error('此作品尚未建立本地目录。');
    return record.store.assetPath(asset);
  }
  async checkpoint() {
    for (const r of this.records) await r.store?.checkpoint();
    return this.summary();
  }
  async setColorTag(key, color) {
    const record = this.records.find((record) => createColorTagIndex(record.result).byKey.has(key));
    if (!record) throw new Error('未找到标签对应的作品。');
    if (!record.store) await this.prepare();
    return record.store.setColorTag(key, color);
  }
  async prepareRedownload(ids) {
    for (const r of this.records) await r.store.prepareRedownload(ids);
  }
  async save(archive, token) {
    const saved = [];
    for (const r of this.records) {
      if (token.cancelled) break;
      r.store.options = this.options;
      const response = await r.store.save(archive, token);
      saved.push(...(response.savedDocuments || []).map((name) => r.work.title + ' / ' + name));
    }
    return { ...this.summary(), savedDocuments: saved, cancelled: token.cancelled };
  }
  async saveText(nodeId) {
    const record = this.records.find((r) => r.result.entries.some((e) => e.nodeId === nodeId));
    if (!record) throw new Error('未找到该文本所属作品。');
    const saved = await record.store.saveText(nodeId);
    return { ...this.summary(), savedText: record.work.title + ' / ' + saved.savedText };
  }
  async textFileInfo(nodeId) {
    const record = this.records.find((r) => r.result.entries.some((e) => e.nodeId === nodeId));
    return record?.store ? record.store.textFileInfo(nodeId) : { saved: false };
  }
}
module.exports = { safeFolder, namespaceResult, mergeResults, AuthorStore };
