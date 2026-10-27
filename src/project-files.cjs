'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const MANIFEST = '.画布项目.json';
const INDEX = '.项目索引.json';
function safeFolder(value, fallback = '未命名', limit = 85) {
  let name =
    String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit)
      .replace(/[. ]+$/, '') || fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
function authorBase(metadata) {
  return [
    safeFolder(metadata.platform, 'platform', 32),
    safeFolder(metadata.author, '未知作者', 60)
  ].join('_');
}
function authorFolderName(profile) {
  const platform = profile.platform,
    id = profile.uuid;
  if (
    typeof platform !== 'string' ||
    !/^[a-z][a-z0-9-]*$/.test(platform) ||
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(id)
  )
    throw new Error('缺少有效的平台或完整作者 ID，无法确定作品集文件夹。');
  const limit = Math.min(60, 240 - platform.length - id.length - 2);
  if (limit < 1) throw new Error('作者 ID 过长，无法在文件夹名称中完整保留。');
  // Underscores separate platform/name/ID. Keep the ID unchanged, including
  // underscores in Jimeng IDs, so another ID's suffix cannot match this author.
  const author =
    safeFolder(String(profile.author || '').replace(/_/g, ' '), '未知作者', limit)
      .replace(/_/g, ' ')
      .trim() || '未知作者';
  return platform + '_' + author + '_' + id;
}
function isAuthorFolder(name, profile) {
  authorFolderName(profile);
  const prefix = profile.platform + '_';
  if (!name.startsWith(prefix)) return false;
  const separator = name.indexOf('_', prefix.length);
  return separator > prefix.length && name.slice(separator + 1) === profile.uuid;
}
async function resolveAuthorDirectory(root, profile, { createRoot = true } = {}) {
  const preferred = authorFolderName(profile),
    absolute = path.resolve(root);
  if (isAuthorFolder(path.basename(absolute), profile)) return absolute;
  if (createRoot) await fs.mkdir(absolute, { recursive: true });
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') entries = [];
    else throw error;
  }
  const matches = entries
    .filter((entry) => entry.isDirectory() && isAuthorFolder(entry.name, profile))
    .map((entry) => entry.name);
  if (matches.length > 1)
    throw new Error(
      '存在多个相同平台和作者 ID 的作品集文件夹，请直接选择要使用的文件夹作为保存位置。'
    );
  // Only immediate directory names identify the author. Metadata and legacy
  // indexes may be missing, edited or stale and never influence this choice.
  return path.join(absolute, matches[0] || preferred);
}
function projectFolderName(metadata) {
  return authorBase(metadata) + '_' + safeFolder(metadata.title, '未命名作品');
}
function manifestName(metadata) {
  return '打开画布_' + projectFolderName(metadata) + '.json';
}
function collectionName(metadata) {
  return '打开作品集_' + authorBase(metadata) + '.json';
}
function isProjectFile(name, kind = 'canvas') {
  return kind === 'collection'
    ? name.toLowerCase() === INDEX || /^打开作品集_.+\.json$/i.test(name)
    : name.toLowerCase() === MANIFEST || /^打开画布_.+\.json$/i.test(name);
}
async function findProjectFile(directory, kind = 'canvas', optional = false) {
  const files = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isProjectFile(entry.name, kind))
    .map((entry) => entry.name);
  const named = files.filter((name) => !name.startsWith('.'));
  if (named.length > 1) throw new Error('文件夹中有多个打开入口，请直接选择要打开的 JSON 文件。');
  const name = named[0] || files[0];
  if (!name && !optional)
    throw Object.assign(new Error('未找到本地项目入口文件。'), { code: 'ENOENT' });
  return name || null;
}
module.exports = {
  MANIFEST,
  INDEX,
  safeFolder,
  authorFolderName,
  isAuthorFolder,
  resolveAuthorDirectory,
  projectFolderName,
  manifestName,
  collectionName,
  isProjectFile,
  findProjectFile
};
