'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
const { ProjectStore } = require('./project-store.cjs');
const { isProjectFile, findProjectFile } = require('./project-files.cjs');

function absoluteProjectPath(input) {
  if (typeof input !== 'string') throw new Error('本地项目路径无效。');
  let target = input.trim();
  if (target.startsWith('"') && target.endsWith('"')) target = target.slice(1, -1).trim();
  if (!target || !path.isAbsolute(target))
    throw new Error('请填写本地项目文件夹或项目记录文件的完整路径。');
  return path.resolve(target);
}
function isCurrentProjectPath(input, directory) {
  if (!directory) return false;
  try {
    const canonical = (value) => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const target = canonical(absoluteProjectPath(input));
    return (
      target === canonical(directory) ||
      (path.dirname(target) === canonical(directory) &&
        (isProjectFile(path.basename(target)) ||
          isProjectFile(path.basename(target), 'collection')))
    );
  } catch {
    return false;
  }
}
async function loadLocalProject(input) {
  const target = absoluteProjectPath(input);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('本地项目路径不存在，请检查路径。');
    throw error;
  }
  const directory = stat.isDirectory() ? target : path.dirname(target);
  let name;
  if (stat.isDirectory()) {
    name = await findProjectFile(directory, 'canvas', true);
    if (!name) {
      const collection = await findProjectFile(directory, 'collection', true);
      if (!collection)
        throw new Error(
          '项目文件夹中未找到打开画布或打开作品集的 JSON 入口文件（兼容 .画布项目.json、.项目索引.json）。'
        );
      return require('./local-collection.cjs').loadLocalCollection(directory, collection);
    }
  } else {
    name = path.basename(target);
    if (!stat.isFile() || (!isProjectFile(name) && !isProjectFile(name, 'collection')))
      throw new Error(
        '请选择打开画布_平台_作者_作品名.json、打开作品集_平台_作者.json 或对应文件夹（也支持旧版入口）。'
      );
    if (isProjectFile(name, 'collection'))
      return require('./local-collection.cjs').loadLocalCollection(directory, name);
  }
  const manifestPath = path.join(directory, name),
    store = new ProjectStore(path.dirname(directory));
  let result;
  try {
    result = await store.load(directory, name);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('项目文件夹中未找到画布项目入口文件。');
    if (error instanceof SyntaxError) throw new Error('项目记录文件损坏，无法打开。');
    throw error;
  }
  return { store, result, manifestPath };
}
module.exports = { loadLocalProject, isCurrentProjectPath };
