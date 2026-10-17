'use strict';
const { createHash } = require('node:crypto');
const { buildAssets, linkEntries } = require('./assets.cjs');
const { readText, readNodeText, cleanRichText } = require('./text-content.cjs');
const { TYPES, SCHEMA_VERSION, APPLICATION_VERSION } = require('./core/model.cjs');
const platformRegistry = require('./platforms/registry.cjs');
const { classifyImage } = require('./core/content-types.cjs');
const { completeness } = require('./core/completeness.cjs');
const EVIDENCE = {
  'parameter-reference': '当前生成配置引用',
  'canvas-edge': '仅连线关联，用途待确认'
};
function textOf(value) {
  return readText(value).text;
}
function groupOf(node, byId) {
  const parts = [],
    seen = new Set([node.id]);
  let parent = node.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const item = byId.get(parent);
    if (!item) break;
    parts.unshift(textOf(item.data?.name || item.data?.title) || '未命名分组');
    parent = item.parentId;
  }
  return parts.join(' / ') || '未分组';
}
function textAnchor(nodeId, text) {
  return (
    'text-' +
    createHash('sha256')
      .update(String(nodeId) + '\0' + text)
      .digest('hex')
      .slice(0, 20)
  );
}
function normalize(snapshot, metadata, registry = platformRegistry) {
  const platform = metadata.platform,
    nodes = snapshot.nodes || [],
    edges = snapshot.edges || [],
    byId = new Map(nodes.map((n) => [n.id, n]));
  const adapter = registry.getAdapter(platform);
  const incoming = new Map();
  for (const edge of edges) {
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge);
  }
  const entries = [],
    skipped = [],
    warnings = [],
    relations = new Map(),
    nodeSummaries = [],
    unsupportedNodes = [];
  let parserWarningCount = 0;
  const nodeTexts = new Map(
    nodes.filter((n) => n.type === 'text').map((n) => [n.id, readNodeText(n, platform, adapter)])
  );
  const nameOf = (id) =>
    textOf(byId.get(id)?.data?.name || byId.get(id)?.data?.title) || '未命名参考';
  const common = (node) => ({
    nodeId: node.id,
    name: textOf(node.data?.name || node.data?.title) || '未命名',
    group: node.data?.groupName ? textOf(node.data.groupName) : groupOf(node, byId),
    position: node.position || {},
    references: [],
    referenceTexts: []
  });

  // Consumer parameter copies may differ from current resource text. Keep both.
  function relatedTexts(node, explicit) {
    const refs = new Map();
    function add(ref, evidence) {
      const id = ref.nodeId || ref.sourceInstanceId,
        source = id ? nodeTexts.get(id) : null;
      const snapshotValue = ref.content ?? ref.text,
        parameter =
          snapshotValue == null
            ? null
            : readText(snapshotValue, platform, 'parameter-content', adapter);
      const preferred = parameter?.text.trim()
        ? parameter
        : source || parameter || { text: '', rawText: '', textSource: '', textState: 'unreadable' };
      const key = id || 'inline-text:' + node.id + ':' + refs.size;
      let item = refs.get(key);
      if (!item) {
        item = {
          nodeId: key,
          name: id && byId.has(id) ? nameOf(id) : textOf(ref.label || ref.name) || '参数中的文本',
          ...preferred,
          evidence: [],
          parameterText: parameter?.rawText,
          textVersion: parameter?.text.trim() ? 'parameter-content' : 'current-node',
          textMismatch: Boolean(
            parameter?.text.trim() && source?.text.trim() && parameter.text !== source.text
          )
        };
        if (item.textMismatch) item.currentNodeText = source.text;
        refs.set(key, item);
      }
      if (!item.evidence.includes(evidence)) item.evidence.push(evidence);
    }
    for (const ref of explicit) add(ref, 'parameter-reference');
    for (const edge of incoming.get(node.id) || [])
      if (byId.get(edge.source)?.type === 'text') add({ nodeId: edge.source }, 'canvas-edge');
    for (const item of refs.values()) {
      item.relation =
        EVIDENCE[
          item.evidence.includes('parameter-reference') ? 'parameter-reference' : 'canvas-edge'
        ];
      item.textKey = textAnchor(item.nodeId, item.text);
      if (item.textMismatch)
        warnings.push(
          `${nameOf(node.id)}：参数中的文本「${item.name}」与当前文本节点不同，已分别保留。`
        );
      if (['partial', 'unreadable'].includes(item.textState))
        warnings.push(
          `${nameOf(node.id)}：关联文本「${item.name}」${item.textState === 'partial' ? '存在未解析片段' : '正文读取失败'}，关联关系仍保留。`
        );
    }
    return [...refs.values()];
  }
  for (const node of nodes) {
    const c = common(node);
    nodeSummaries.push({
      nodeId: node.id,
      name: c.name,
      type: node.type,
      textState: nodeTexts.get(node.id)?.textState
    });
    if (node.type === 'text') {
      const text = nodeTexts.get(node.id);
      if (text.text.trim() || text.textState === 'unreadable')
        entries.push({
          ...c,
          kind: 'text',
          prompt: text.text,
          promptSource: 'text-node',
          settings: {},
          ...text,
          textUsage: 'unconfirmed'
        });
      else skipped.push({ nodeId: node.id, name: c.name, reason: '文本节点正文为空' });
      if (['partial', 'unreadable'].includes(text.textState))
        warnings.push(
          `${c.name}：${text.textState === 'partial' ? '部分文本格式未解析' : '文本内容不可读'}，已保留节点。`
        );
      continue;
    }
    const {
      kind,
      prompt,
      references,
      settings,
      model,
      promptSource,
      extra,
      explicit,
      warnings: platformWarnings
    } = adapter.parseGeneration(node, { byId, nameOf });
    warnings.push(...platformWarnings);
    parserWarningCount += platformWarnings.length;
    if (
      !kind &&
      !adapter.isResource(node) &&
      !['group', 'image', 'video', 'audio'].includes(node.type)
    )
      unsupportedNodes.push({ nodeId: node.id, type: node.type || 'unknown' });
    const texts = relatedTexts(node, explicit);
    relations.set(node.id, texts);
    for (const edge of incoming.get(node.id) || [])
      if (byId.has(edge.source)) {
        const existing = references.find((ref) => ref.nodeId === edge.source);
        if (existing) {
          if (!existing.evidence.includes('canvas-edge')) existing.evidence.push('canvas-edge');
        } else
          references.push({
            nodeId: edge.source,
            type: byId.get(edge.source).type,
            name: nameOf(edge.source),
            index: references.length + 1,
            evidence: ['canvas-edge']
          });
      }
    if (kind && (prompt.trim() || texts.length))
      entries.push({
        ...c,
        kind,
        prompt,
        promptSource: prompt.trim() ? promptSource : 'reference-text-only',
        settings,
        model,
        references,
        referenceTexts: texts,
        ...extra
      });
    else
      skipped.push({
        nodeId: node.id,
        name: c.name,
        reason: kind
          ? '生成节点当前提示词为空'
          : adapter.isResource(node)
            ? '素材节点，无当前生成提示词'
            : '上传素材、分组或尚未适配的操作'
      });
  }
  const consumers = new Map(),
    generationIds = new Set(entries.filter((e) => e.kind !== 'text').map((e) => e.nodeId));
  for (const node of nodes)
    for (const ref of relations.get(node.id) || []) {
      if (!consumers.has(ref.nodeId)) consumers.set(ref.nodeId, []);
      consumers.get(ref.nodeId).push({ nodeId: node.id, evidence: ref.evidence });
    }
  for (const entry of entries.filter((e) => e.kind === 'text')) {
    const linked = consumers.get(entry.nodeId) || [];
    entry.linkedNodeIds = linked.map((n) => n.nodeId);
    entry.connectionStatus = linked.length > 1 ? 'shared' : linked.length ? 'linked' : 'unlinked';
    entry.textUsage = linked.some(
      (n) => generationIds.has(n.nodeId) && n.evidence.includes('parameter-reference')
    )
      ? 'generation-input'
      : 'unconfirmed';
  }
  entries.sort(
    (a, b) =>
      a.group.localeCompare(b.group, 'zh') ||
      (a.position.y || 0) - (b.position.y || 0) ||
      (a.position.x || 0) - (b.position.x || 0)
  );
  if (snapshot.expectedNodes != null && nodes.length !== snapshot.expectedNodes)
    warnings.push(
      `页面声明 ${snapshot.expectedNodes} 个节点，实际读取 ${nodes.length} 个，完整性未通过。`
    );
  if (snapshot.expectedEdges != null && edges.length !== snapshot.expectedEdges)
    warnings.push('连线数与页面声明不一致。');
  if (!metadata.author) warnings.push('未自动读到作者，请手动填写后导出。');
  if (!metadata.title) warnings.push('未自动读到作品名，请手动填写后导出。');
  if (entries.some((e) => e.kind === 'image_unknown'))
    warnings.push('部分图片生成模式未确认，仍归入图片提示词；保留读取到的原始参数。');
  const emptyGeneration = skipped.filter((e) => e.reason === '生成节点当前提示词为空');
  if (emptyGeneration.length)
    warnings.push(`${emptyGeneration.length} 个生成节点没有可读的当前提示词，未计入导出条数。`);
  warnings.push(
    '读取的是当前节点参数与关联文本；仅连线不代表生成用途，尚未核验历史资产生成时的完整提示词。'
  );
  if (unsupportedNodes.length)
    warnings.push(
      `${unsupportedNodes.length} 个节点类型尚未适配，已保留节点概要，请检查提取完整性。`
    );
  const quality = completeness(snapshot, {
    unsupportedNodes,
    parserWarningCount,
    unreadableTextCount: [...nodeTexts.values()].filter((t) => t.textState === 'unreadable').length,
    partialTextCount: [...nodeTexts.values()].filter((t) => t.textState === 'partial').length
  });
  const result = linkEntries({
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      ...metadata,
      applicationVersion: APPLICATION_VERSION,
      adapterVersion: adapter.version,
      canvasTitle: snapshot.canvasTitle,
      canvasUrl: snapshot.frameUrl,
      ...(snapshot.workIdentity ? { workIdentity: snapshot.workIdentity } : {}),
      extractedAt: new Date().toISOString()
    },
    diagnostics: {
      ...quality,
      source: snapshot.source,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      expectedNodes: snapshot.expectedNodes,
      directEntryCount: entries.filter((e) => e.prompt.trim()).length,
      directGenerationCount: entries.filter((e) => e.kind !== 'text' && e.prompt.trim()).length,
      readableTextCount: entries.filter((e) => e.kind === 'text' && e.prompt.trim()).length,
      unreadableTextCount: entries.filter((e) => e.kind === 'text' && e.textState === 'unreadable')
        .length,
      linkedGenerationCount: entries.filter((e) => e.kind !== 'text' && e.referenceTexts.length)
        .length,
      referenceOnlyCount: entries.filter((e) => e.promptSource === 'reference-text-only').length,
      counts: Object.fromEntries(
        Object.keys(TYPES).map((t) => [t, entries.filter((e) => e.kind === t).length])
      ),
      skipped,
      warnings: [...new Set(warnings)]
    },
    entries,
    edges,
    nodeSummaries,
    assets: buildAssets(snapshot, platform, adapter)
  });
  for (const asset of result.assets)
    asset.associatedTexts = asset.nodeIds.flatMap((id) =>
      (relations.get(id) || []).map((ref) => ({ ...ref, targetNodeId: id }))
    );
  return result;
}
const { filename, markdown, filterResult } = require('./export/markdown.cjs');
module.exports = {
  TYPES,
  normalize,
  filename,
  markdown,
  filterResult,
  cleanRichText,
  classifyImage
};
