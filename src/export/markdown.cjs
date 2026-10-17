'use strict';
const { createHash } = require('node:crypto');
const { PROMPT_TYPES, promptKind } = require('../prompt-types.cjs');
const { TYPES } = require('../core/model.cjs');
function textAnchor(nodeId, text) {
  return (
    'text-' +
    createHash('sha256')
      .update(String(nodeId) + '\0' + text)
      .digest('hex')
      .slice(0, 20)
  );
}
function safePart(value, fallback) {
  return (
    String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '') || fallback
  ).slice(0, 70);
}
function filename(metadata, ext = 'md') {
  const title = String(metadata.title || '').replace(/^《(.*)》$/, '$1');
  return (
    [
      safePart(metadata.platform, 'platform'),
      safePart(metadata.author, '未知作者'),
      safePart(title, '未命名作品')
    ].join('_') +
    '.' +
    ext
  );
}
function filterResult(result, kinds) {
  const allowed = new Set(
      Object.keys(TYPES).filter(
        (k) => kinds.includes(k) || (k.startsWith('image_') && kinds.includes('image'))
      )
    ),
    entries = result.entries.filter((e) => allowed.has(e.kind));
  const ids = new Set(
      entries.flatMap((e) => [e.nodeId, ...e.references.map((r) => r.nodeId).filter(Boolean)])
    ),
    assetIds = new Set(
      entries.flatMap((e) => [
        ...(e.outputAssetIds || []),
        ...e.references.flatMap((r) => r.assetIds || [])
      ])
    );
  const { nodes, edges, nodeSummaries, ...rest } = result;
  return {
    ...rest,
    selection: [...allowed],
    entries,
    assets: (result.assets || [])
      .filter((a) => assetIds.has(a.id))
      .map((a) => ({
        ...a,
        associatedTexts: (a.associatedTexts || []).filter((ref) =>
          entries.some((e) => e.nodeId === ref.targetNodeId)
        )
      })),
    ...(nodeSummaries ? { nodeSummaries: nodeSummaries.filter((n) => ids.has(n.nodeId)) } : {}),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  };
}
function fence(value) {
  let marker = '```';
  while (value.includes(marker)) marker += '`';
  return marker + 'text\n' + value + '\n' + marker;
}
function markdown(result) {
  const m = result.metadata,
    texts = new Map(),
    assets = new Map((result.assets || []).map((a) => [a.id, a]));
  const link = (id) => {
    const a = assets.get(id);
    return a
      ? `[${a.name}](${encodeURIComponent(a.fileName)})${a.state === 'done' ? '' : '（未下载）'}`
      : '';
  };
  const anchor = (r) => r.textKey || textAnchor(r.nodeId, r.text),
    independent = new Map(
      result.entries
        .filter((e) => e.kind === 'text')
        .map((e) => [textAnchor(e.nodeId, e.prompt), e])
    );
  const lines = [
    `# ${m.title || '未命名作品'}`,
    '',
    `- 平台：${m.platform}`,
    `- 作者：${m.author || '未知作者'}`,
    `- 作品：${m.resolvedUrl || m.inputUrl}`,
    `- 画布：${m.canvasUrl}`,
    `- 画布名称：${m.canvasTitle}`,
    `- 导出时间：${m.extractedAt}`,
    `- 本次选中 ${result.entries.length} 个节点内容`,
    '',
    '## 提取说明',
    '',
    ...result.diagnostics.warnings.map((w) => '- ' + w),
    ''
  ];
  for (const [kind, label] of Object.entries(PROMPT_TYPES)) {
    const items = result.entries.filter((e) => promptKind(e.kind) === kind);
    if (!items.length) continue;
    lines.push(`## ${label}`, '');
    items.forEach((entry, i) => {
      if (entry.kind === 'text')
        lines.push(`<a id="${textAnchor(entry.nodeId, entry.prompt)}"></a>`);
      lines.push(
        `### ${i + 1}. ${entry.name}`,
        '',
        `- 节点：${entry.nodeId}`,
        `- 分组：${entry.group}`,
        `- 来源：${{ 'text-node': '独立文本', 'node-params': '节点直接输入', 'generation-draft': '节点直接输入', 'reference-text-only': '仅关联文本' }[entry.promptSource] || entry.promptSource}`
      );
      if (entry.kind === 'text')
        lines.push(
          '- 关联范围：' +
            ({ shared: '多个节点共享', linked: '关联一个节点', unlinked: '未关联文本' }[
              entry.connectionStatus
            ] || '未确认'),
          '- 用途：' + (entry.textUsage === 'generation-input' ? '当前生成配置引用' : '用途未确认')
        );
      for (const id of entry.outputAssetIds || [])
        if (link(id)) lines.push('- 生成／节点素材：' + link(id));
      if (entry.model) lines.push(`- 模型：${entry.model}`);
      for (const [key, value] of Object.entries(entry.settings || {}))
        if (value != null && value !== '') lines.push(`- ${key}：${value}`);
      entry.references.forEach((r) =>
        lines.push(
          `- 参考 ${r.marker || r.index}：${r.name}${r.nodeId ? `（${r.nodeId}）` : ''}${r.assetIds?.length ? '；文件：' + r.assetIds.map(link).filter(Boolean).join('、') : ''}`
        )
      );
      lines.push('');
      if (entry.prompt.trim()) lines.push(fence(entry.prompt), '');
      else
        lines.push(
          entry.kind === 'text'
            ? '文本正文读取失败，已保留节点与关联关系。'
            : '当前节点没有直接输入文本；下方为其关联的文本节点。',
          ''
        );
      for (const r of entry.referenceTexts) {
        const key = anchor(r);
        if (!independent.has(key) && !texts.has(key)) texts.set(key, r);
        lines.push(
          `- 关联文本：[${r.name}](#${key})（${r.relation || '当前引用／连线关系'}${r.textMismatch ? '；参数副本与当前节点不同' : ''}）`,
          ''
        );
      }
    });
  }
  if (texts.size) {
    lines.push('## 关联文本（去重收录）', '');
    for (const [key, r] of texts) {
      lines.push(`<a id="${key}"></a>`, `### ${r.name}`, '');
      if (r.textMismatch)
        lines.push('此处保留当前生成参数中的文本副本；当前文本节点正文另行收录。', '');
      lines.push(r.text.trim() ? fence(r.text) : '正文读取失败，关联关系已保留。', '');
    }
  }
  return lines.join('\n');
}
module.exports = { filename, markdown, filterResult };
