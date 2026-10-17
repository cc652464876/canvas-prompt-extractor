'use strict';
const { validPlatformId, SCHEMA_VERSION } = require('./model.cjs');
function validateProjectRecord(data) {
  if (
    data?.schemaVersion !== SCHEMA_VERSION ||
    data.result?.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(data.result?.entries) ||
    !Array.isArray(data.result?.assets) ||
    !data.result.metadata ||
    data.result.entries.length > 20000 ||
    data.result.assets.length > 20000
  )
    throw new Error('此目录不是支持格式的本地项目。');
  const r = data.result,
    strings = (items) => Array.isArray(items) && items.every((value) => typeof value === 'string');
  if (
    !validPlatformId(r.metadata.platform) ||
    typeof r.metadata.inputUrl !== 'string' ||
    !Array.isArray(r.edges) ||
    !strings(r.diagnostics?.warnings) ||
    (data.documents && !strings(data.documents)) ||
    (data.options && (typeof data.options !== 'object' || Array.isArray(data.options)))
  )
    throw new Error('项目记录格式无效，无法打开。');
  const ids = new Set();
  for (const a of r.assets) {
    if (
      !a ||
      typeof a.id !== 'string' ||
      !a.id ||
      ids.has(a.id) ||
      typeof a.name !== 'string' ||
      typeof a.fileName !== 'string' ||
      !Array.isArray(a.nodeIds)
    )
      throw new Error('项目素材记录无效。');
    ids.add(a.id);
  }
  for (const e of r.entries) {
    if (
      !e ||
      typeof e.nodeId !== 'string' ||
      typeof e.name !== 'string' ||
      typeof e.prompt !== 'string' ||
      typeof e.kind !== 'string' ||
      !Array.isArray(e.references) ||
      !Array.isArray(e.referenceTexts) ||
      !strings(e.outputAssetIds) ||
      e.references.some(
        (ref) => !ref || typeof ref !== 'object' || (ref.assetIds && !strings(ref.assetIds))
      ) ||
      e.referenceTexts.some((ref) => !ref || typeof ref.text !== 'string')
    )
      throw new Error('项目提示词记录无效。');
  }
  return r;
}
module.exports = { validateProjectRecord };
