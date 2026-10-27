'use strict';

// This export shares literal bodies, never generation records or reference bindings.
// Only line endings are normalized; punctuation, spacing and variants stay distinct.
function body(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
}
function inline(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*\[\]]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
}
function fence(value) {
  let marker = '```';
  while (value.includes(marker)) marker += '`';
  return `${marker}text\n${value}\n${marker}`;
}
function meaningful(name) {
  return (
    name && !/^(?:文本生成|独立文本|文本节点|输入文本|未命名(?:参考|文本)?)[\s\d]*$/.test(name)
  );
}
function textLink(text) {
  return `[${text.id}](#${text.id.toLowerCase()})`;
}
function videoList(numbers) {
  const label = (n) => 'V' + String(n).padStart(3, '0');
  const sorted = [...numbers].sort((a, b) => a - b),
    ranges = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i];
    ranges.push(start === end ? label(start) : `${label(start)}–${label(end)}`);
  }
  return ranges.join('、');
}
function relation(ref) {
  if (ref.evidence?.includes('parameter-reference') || ref.relation === '当前生成配置引用')
    return '当前配置引用';
  if (ref.evidence?.includes('canvas-edge') || ref.relation?.includes('仅连线'))
    return '仅连线关联，用途未确认';
  return ref.relation || '关联用途未确认';
}
function aiReadingMarkdown(result) {
  const videos = (result.entries || []).filter((e) => e.kind === 'video'),
    independent = (result.entries || []).filter((e) => e.kind === 'text');
  if (!videos.length && !independent.length) return null;
  const texts = new Map(),
    missing = [];
  function addText(value, name, video, state) {
    const text = body(value);
    if (!text.trim()) return null;
    let item = texts.get(text);
    if (!item) {
      item = {
        id: 'T' + String(texts.size + 1).padStart(3, '0'),
        text,
        name: name || '文本',
        videos: new Set(),
        independent: 0,
        partial: false
      };
      texts.set(text, item);
    } else if (!meaningful(item.name) && meaningful(name)) item.name = name;
    if (video) item.videos.add(video);
    if (state === 'partial') item.partial = true;
    return item;
  }
  independent.forEach((entry, index) => {
    const text = addText(entry.prompt, entry.name, null, entry.textState);
    if (text) text.independent++;
    else missing.push(`独立文本第 ${index + 1} 条「${inline(entry.name)}」：正文为空或读取失败。`);
  });
  const cases = videos.map((entry, index) => {
    const number = index + 1,
      direct = addText(entry.prompt, '视频直接文本', number, entry.textState),
      references = new Map(),
      unreadable = [];
    for (const ref of entry.referenceTexts || []) {
      const text = addText(ref.text, ref.name, number, ref.textState),
        evidence = `${relation(ref)}（${inline(ref.name || '文本')}）`;
      if (!text) {
        unreadable.push(`${evidence}：正文为空或读取失败。`);
        continue;
      }
      if (!references.has(text.id))
        references.set(text.id, { text, evidence: new Set(), current: new Set() });
      const binding = references.get(text.id);
      binding.evidence.add(evidence);
      if (ref.textMismatch) {
        const current = addText(ref.currentNodeText, ref.name, number);
        binding.current.add(current ? textLink(current) : '当前节点版本未读取');
      }
    }
    return { entry, number, direct, references, unreadable };
  });
  const m = result.metadata || {},
    lines = [
      `# ${inline(m.title || '未命名作品')}｜AI 阅读精简版`,
      '',
      `- 作者：${inline(m.author || '未知作者')} · 平台：${inline(m.platform || '未知')}`,
      `- 作品来源：${inline(m.resolvedUrl || m.inputUrl || '未读取')}`,
      ...(m.canvasUrl && m.canvasUrl !== (m.resolvedUrl || m.inputUrl)
        ? [`- 画布来源：${inline(m.canvasUrl)}`]
        : []),
      `- 内容：${videos.length} 条视频案例 · ${independent.length} 个独立文本节点 · ${texts.size} 份去重正文`,
      '',
      '正文库完整保留作者原文，仅统一换行格式后对完全相同的正文去重；不同版本分别收录。T 编号指向本文件正文库，V 编号指向视频案例。',
      '本文件用于分析作者提示词的文字结构与写法，无需附带图片、视频或音频。作者原文中的“图1、视频1”等引用措辞原样保留。',
      '文本引用区分当前配置引用与仅连线关联；仅连线不代表参与生成，当前配置也不代表历史成片的完整输入。',
      ''
    ];
  const quality = {
    NODE_COUNT_MISMATCH: '节点数量与页面声明不一致',
    EDGE_COUNT_MISMATCH: '连线数量与页面声明不一致',
    UNSUPPORTED_NODES: '存在尚未适配的节点类型',
    UNREADABLE_TEXT: '存在读取失败或未完整解析的文本',
    UNRESOLVED_GENERATION_PARTS: '存在未解析的生成配置'
  };
  const issues = (result.diagnostics?.completenessIssues || []).map((key) => quality[key] || key);
  if (issues.length) lines.push('读取提示：' + issues.map(inline).join('；') + '。', '');
  if (cases.length) {
    lines.push('## 视频案例', '');
    for (const { entry, number, direct, references, unreadable } of cases) {
      const id = 'V' + String(number).padStart(3, '0');
      lines.push(`### ${id}`, '');
      const settings = Object.entries(entry.settings || {})
        .filter(([, value]) => value != null && value !== '')
        .map(
          ([key, value]) =>
            `${inline(key)}=${inline(typeof value === 'object' ? JSON.stringify(value) : value)}`
        );
      if (entry.model || settings.length)
        lines.push(
          '- 生成条件：' +
            [entry.model && inline(entry.model), ...settings].filter(Boolean).join(' · ')
        );
      lines.push(
        direct ? `- 直接文本：${textLink(direct)}` : '- 直接文本：未读取到；请查看下方引用文本。'
      );
      for (const binding of references.values()) {
        lines.push(`- 引用文本：${textLink(binding.text)} · ${[...binding.evidence].join('；')}`);
        if (binding.current.size)
          lines.push(
            '  - 此处为参数副本，与当前文本节点不同；当前节点版本：' +
              [...binding.current].join('、')
          );
      }
      for (const warning of unreadable) lines.push('- 引用文本：' + warning);
      lines.push('');
    }
  }
  if (texts.size) {
    lines.push('## 正文库（按内容去重）', '');
    for (const text of texts.values()) {
      // A plain ID heading supplies the Markdown fragment without raw HTML,
      // including in readers that display or disallow HTML anchor tags.
      lines.push(`### ${text.id}`, '', `名称：${inline(text.name)}`, '');
      const usage = [];
      if (text.independent) usage.push(`独立文本来源 ${text.independent} 处`);
      if (text.videos.size)
        usage.push(`涉及视频 ${text.videos.size} 条：${videoList(text.videos)}`);
      if (usage.length) lines.push('- ' + usage.join('；'), '');
      if (text.partial) lines.push('读取提示：部分来源含有未解析片段。', '');
      lines.push(fence(text.text), '');
    }
  }
  if (missing.length) lines.push('## 文本读取问题', '', ...missing.map((item) => '- ' + item), '');
  return lines.join('\n');
}

module.exports = { aiReadingMarkdown };
