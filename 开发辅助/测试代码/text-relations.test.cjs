'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { normalize, markdown, filterResult } = require('../../src/normalize.cjs');
const { readText, readNodeText } = require('../../src/text-content.cjs');
const meta = (platform) => ({
  platform,
  author: '测试',
  title: '文本验证',
  inputUrl:
    platform === 'jimeng'
      ? 'https://jimeng.jianying.com/ai-tool/ai-canvas/test'
      : 'https://www.liblib.tv/detail/test'
});
const snapshot = (nodes, edges = []) => ({
  nodes,
  edges,
  source: 'fixture',
  frameUrl: 'https://www.liblib.tv/detail/test'
});
const text = (id, content) => ({ id, type: 'text', data: { name: id, content } });
const lib = (id, textList = [], extra = {}) => ({
  id,
  type: 'image',
  data: {
    name: id,
    action: 'image_generate',
    params: {
      prompt: '',
      modeType: 'image2image',
      model: 'nebula-ultra',
      settings: { quality: '2K', ratio: '16:9' },
      textList,
      ...extra
    }
  }
});
const dream = (id, refs = [], parts = []) => ({
  id,
  type: 'image',
  data: {
    title: id,
    source: 'model_generated',
    generationDraft: {
      kind: 'image',
      parts,
      references: refs,
      contentSettings: { modelName: 'seedream_5.0_lite', aspectRatio: '1:1', resolution: '2K' },
      outputCount: 1
    }
  }
});
test('LibTV string-array content and whole-resource code fences retain raw text and paragraph breaks', () => {
  const r = normalize(snapshot([text('t', ['```\n第一段\n\n第二段\n```'])]), meta('liblib'));
  assert.equal(r.entries[0].prompt, '第一段\n\n第二段');
  assert.match(r.entries[0].rawText, /^```/);
  assert.equal(r.entries[0].connectionStatus, 'unlinked');
  assert.equal(r.entries[0].textUsage, 'unconfirmed');
  assert.equal(readText(['甲', '乙'], 'liblib').text, '甲\n乙');
  assert.equal(readText('甲\\\n乙', 'liblib').text, '甲\n乙');
});
test('Jimeng rich markdown prefixes are cleaned without applying LibTV fence stripping', () => {
  const raw = '\u0000rt-md:v1\n第一段\n\n第二段';
  const r = normalize(
    snapshot([
      { id: 't', type: 'text', data: { title: '文本', text: raw, content: ['错误副本'] } }
    ]),
    meta('jimeng')
  );
  assert.equal(r.entries[0].prompt, '第一段\n\n第二段');
  assert.equal(r.entries[0].rawText, raw);
  assert.equal(readText('```\n正文\n```', 'jimeng').text, '```\n正文\n```');
});
test('Empty preferred fields fall back to readable text while unknown editor metadata is not invented as prose', () => {
  assert.equal(readNodeText({ data: { text: '', storageText: '正文' } }, 'jimeng').text, '正文');
  assert.equal(readText({ version: 1, attrs: { secret: '不是正文' } }).textState, 'unreadable');
  assert.equal(
    readText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '甲' },
            { type: 'hardBreak' },
            { type: 'text', text: '乙' }
          ]
        },
        { type: 'paragraph', content: [{ type: 'text', text: '丙' }] }
      ]
    }).text,
    '甲\n乙\n丙'
  );
});
test('LibTV textList-only consumers retain model, settings and media references even with mixedList', () => {
  const r = normalize(
    snapshot([
      text('t', ['共享风格']),
      {
        id: 'ref',
        type: 'image',
        data: { action: 'image_resource', url: ['https://cdn.example.com/ref.png'] }
      },
      lib('i', [{ nodeId: 't', content: ['共享风格'] }], {
        mixedList: [{ nodeId: 'ref', mediaType: 'image' }],
        mixedListOrder: ['ref']
      })
    ]),
    meta('liblib')
  );
  const entry = r.entries.find((e) => e.nodeId === 'i');
  assert.equal(entry.prompt, '');
  assert.equal(entry.promptSource, 'reference-text-only');
  assert.equal(entry.model, 'nebula-ultra');
  assert.equal(entry.settings.resolution, '2K');
  assert.equal(entry.kind, 'image_reference');
  assert.equal(entry.references.length, 2);
  assert.equal(entry.references[0].assetIds.length, 1);
  assert.deepEqual(entry.referenceTexts[0].evidence, ['parameter-reference']);
  assert.equal(r.diagnostics.directGenerationCount, 0);
  assert.equal(r.diagnostics.readableTextCount, 1);
  assert.equal(r.diagnostics.linkedGenerationCount, 1);
});
test('Jimeng sourceInstanceId references resolve shared text independently of rich prompt parts', () => {
  const r = normalize(
    snapshot([
      { id: 't', type: 'text', data: { title: '风格', text: '\u0000rt-md:v1\n柔和侧光' } },
      dream('i', [{ sourceInstanceId: 't', slotId: 'a', type: 'extension' }]),
      dream(
        'j',
        [{ sourceInstanceId: 't', slotId: 'b', type: 'extension' }],
        [
          { type: 'text', text: '直接输入 ' },
          { type: 'extension', object_id: 'b' }
        ]
      )
    ]),
    meta('jimeng')
  );
  const a = r.entries.find((e) => e.nodeId === 'i'),
    b = r.entries.find((e) => e.nodeId === 'j'),
    t = r.entries.find((e) => e.nodeId === 't');
  assert.equal(a.referenceTexts[0].text, '柔和侧光');
  assert.equal(a.model, 'seedream_5.0_lite');
  assert.match(b.prompt, /【参考：风格；节点 t】/);
  assert.equal(t.connectionStatus, 'shared');
  assert.equal(t.textUsage, 'generation-input');
  assert.equal(r.diagnostics.directGenerationCount, 1);
});
test('Direct edges are weak evidence, proximity and transitive paths do not inherit text as a video prompt', () => {
  const r = normalize(
    snapshot(
      [
        text('t', ['风格']),
        lib('i'),
        { id: 'v', type: 'video', data: { action: 'video_generate', params: { prompt: '镜头' } } },
        text('near', ['靠近的作者备注'])
      ],
      [
        { source: 't', target: 'i' },
        { source: 'i', target: 'v' }
      ]
    ),
    meta('liblib')
  );
  assert.deepEqual(r.entries.find((e) => e.nodeId === 'i').referenceTexts[0].evidence, [
    'canvas-edge'
  ]);
  assert.equal(r.entries.find((e) => e.nodeId === 'v').referenceTexts.length, 0);
  assert.equal(r.entries.find((e) => e.nodeId === 'near').connectionStatus, 'unlinked');
  assert.equal(r.entries.find((e) => e.nodeId === 't').textUsage, 'unconfirmed');
});
test('An uploaded asset with a connected note is not relabeled as a generation prompt', () => {
  const r = normalize(
    snapshot(
      [
        text('note', ['备注']),
        {
          id: 'upload',
          type: 'image',
          data: { action: 'image_resource', url: ['https://cdn.example.com/u.png'] }
        }
      ],
      [{ source: 'note', target: 'upload' }]
    ),
    meta('liblib')
  );
  assert.equal(r.entries.filter((e) => e.kind !== 'text').length, 0);
  assert.equal(r.assets[0].associatedTexts[0].text, '备注');
});
test('Unreadable text keeps its identity and provenance while an actual empty node remains empty', () => {
  const r = normalize(
    snapshot(
      [text('bad', { unrecognized: 'data' }), text('empty', []), lib('i', [{ nodeId: 'bad' }])],
      [{ source: 'bad', target: 'i' }]
    ),
    meta('liblib')
  );
  assert.equal(r.entries.find((e) => e.nodeId === 'bad').textState, 'unreadable');
  assert.equal(r.entries.find((e) => e.nodeId === 'i').referenceTexts[0].textState, 'unreadable');
  assert.equal(
    r.entries.some((e) => e.nodeId === 'empty'),
    false
  );
  assert.equal(r.diagnostics.unreadableTextCount, 1);
  assert.match(markdown(r), /正文读取失败/);
});
test('A parameter copy can rescue a missing or unreadable source without claiming historical generation provenance', () => {
  const r = normalize(
    snapshot([lib('i', [{ nodeId: 'missing', content: ['参数正文'] }])]),
    meta('liblib')
  );
  assert.equal(r.entries[0].referenceTexts[0].text, '参数正文');
  assert.equal(r.entries[0].referenceTexts[0].textVersion, 'parameter-content');
  assert.ok(r.diagnostics.warnings.some((w) => w.includes('尚未核验历史')));
});
test('Distinct parameter copies and the current source get distinct reachable Markdown anchors', () => {
  const r = normalize(
    snapshot([
      text('t', ['新版正文']),
      lib('i', [{ nodeId: 't', content: ['旧版甲'] }]),
      lib('j', [{ nodeId: 't', content: ['旧版乙'] }]),
      lib('k', [{ nodeId: 't', content: ['旧版甲'] }])
    ]),
    meta('liblib')
  );
  const doc = markdown(r);
  for (const value of ['新版正文', '旧版甲', '旧版乙'])
    assert.equal(doc.split(value).length - 1, 1);
  for (const match of doc.matchAll(/\]\(#(text-[a-f\d]+)\)/g))
    assert.ok(doc.includes('<a id="' + match[1] + '"></a>'));
  assert.ok(r.entries.find((e) => e.nodeId === 'i').referenceTexts[0].textMismatch);
  const images = markdown(filterResult(r, ['image']));
  assert.equal(images.includes('新版正文'), false);
  assert.equal(images.split('旧版甲').length - 1, 1);
});
test('Text linked to one category does not leak through media deduplication into another selected category', () => {
  const s = snapshot([
    text('t', ['只属于图片的正文']),
    {
      ...lib('i', [{ nodeId: 't', content: ['只属于图片的正文'] }]),
      data: {
        ...lib('i', [{ nodeId: 't', content: ['只属于图片的正文'] }]).data,
        url: ['https://cdn.example.com/shared.png']
      }
    },
    {
      id: 'v',
      type: 'video',
      data: {
        action: 'video_generate',
        params: {
          prompt: '视频',
          imageList: [{ nodeId: 'i', url: 'https://cdn.example.com/shared.png' }]
        }
      }
    }
  ]);
  const selected = filterResult(normalize(s, meta('liblib')), ['video']);
  assert.ok(!JSON.stringify(selected).includes('只属于图片的正文'));
});
test('Reader summary counts text once and separates associated consumers from direct prompt strings', async () => {
  const { contentSummary } = await import('../../src/ui/view-model.js');
  const r = normalize(
    snapshot([text('t', ['共享']), lib('i', [{ nodeId: 't' }]), lib('j', [{ nodeId: 't' }])]),
    meta('liblib')
  );
  assert.equal(contentSummary(r), '文本节点 1 个 · 直接提示词 0 条 · 有关联文本的生成节点 2 个');
});
