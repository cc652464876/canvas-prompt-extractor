'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { aiReadingMarkdown } = require('../../src/export/ai-reading.cjs');
const { markdown, filename } = require('../../src/export/markdown.cjs');
const { ProjectStore } = require('../../src/project-store.cjs');
const { AuthorStore, namespaceResult } = require('../../src/author-library.cjs');
const { normalize } = require('../../src/normalize.cjs');
const fixtures = require('./fixtures/text-platforms.cjs');

function text(nodeId, prompt, name = '文本生成') {
  return {
    nodeId,
    kind: 'text',
    name,
    prompt,
    references: [],
    referenceTexts: [],
    outputAssetIds: []
  };
}
function video(nodeId, prompt = '', referenceTexts = []) {
  return {
    ...text(nodeId, prompt, '视频生成'),
    kind: 'video',
    model: 'Seedance 2.0',
    settings: { duration: 12, ratio: '21:9', generate_audio: false },
    referenceTexts
  };
}
function sample(entries) {
  return {
    schemaVersion: 2,
    metadata: {
      platform: 'neowow',
      author: '作者',
      title: '测试作品',
      inputUrl: 'https://neowow.cn/video-works-view?id=885'
    },
    entries,
    assets: [],
    edges: [],
    diagnostics: { warnings: [] }
  };
}
function bodies(doc) {
  const values = [];
  let marker,
    lines = [];
  for (const line of doc.split('\n')) {
    if (!marker) {
      const match = /^(`{3,})text$/.exec(line);
      if (match) {
        marker = match[1];
        lines = [];
      }
    } else if (line === marker) {
      values.push(lines.join('\n'));
      marker = null;
    } else lines.push(line);
  }
  assert.equal(marker, null, 'Every literal body must have a closing fence');
  return values;
}
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-reading-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('Content is shared across independent nodes, direct prompts and differently named parameter/edge copies', () => {
  const shared = '完整风格原文\n\n  保留缩进、标点！！',
    original = sample([
      text('a', shared),
      text('b', shared, '元启录2风格锁词'),
      video('v1', shared, [
        { nodeId: 'inline', name: '输入文本 1', text: shared, evidence: ['parameter-reference'] },
        { nodeId: 'a', name: '文本生成', text: shared, evidence: ['canvas-edge'] }
      ]),
      video('v2', '', [
        { nodeId: 'b', name: '风格', text: shared, evidence: ['parameter-reference'] }
      ])
    ]),
    before = structuredClone(original),
    doc = aiReadingMarkdown(original);
  assert.deepEqual(bodies(doc), [shared]);
  assert.match(doc, /### T001\n\n名称：元启录2风格锁词/);
  assert.match(doc, /独立文本来源 2 处；涉及视频 2 条：V001–V002/);
  assert.match(doc, /当前配置引用（输入文本 1）；仅连线关联，用途未确认（文本生成）/);
  assert.match(doc, /### V001\n/);
  assert.match(doc, /### V002\n/);
  assert.match(doc, /generate_audio=false/);
  assert.deepEqual(original, before);
  assert.equal(doc.includes('<a id='), false);
  for (const match of doc.matchAll(/\]\(#(t\d+)\)/g))
    assert.ok(doc.includes(`### ${match[1].toUpperCase()}\n`));
});

test('Line endings merge; wording, whitespace, punctuation, embedded fences and versions remain lossless', () => {
  const values = [
    '原文\n下一行',
    '原文\n下一行！',
    '原文\n 下一行',
    '原文\n下一行 ',
    '```text\n内嵌代码块\n```\n````'
  ];
  const r = sample([
    ...values.map((value, i) => text('t' + i, value)),
    text('windows', '原文\r\n下一行'),
    video('v', '', [
      {
        name: '参数副本',
        text: '旧版正文',
        textMismatch: true,
        currentNodeText: '新版正文',
        evidence: ['parameter-reference']
      }
    ])
  ]);
  const doc = aiReadingMarkdown(r);
  assert.deepEqual(bodies(doc), [...values, '旧版正文', '新版正文']);
  assert.match(doc, /参数副本，与当前文本节点不同；当前节点版本：\[T007\]/);
});

test('The reading export omits media bookkeeping but preserves literal author references and separate video cases', () => {
  const literal = '共用正文：图1锁定人物，参考视频1的动作。',
    a = video('v1', literal),
    b = video('v2', literal);
  a.name = 'd4ea66b41b2646f5bd7d800a3ac664b5.mp4';
  a.outputAssetIds = ['a'];
  a.references = [{ name: '甲角色', type: 'image', marker: 'image 1', assetIds: ['a'] }];
  b.references = [
    { name: '乙角色', type: 'image', marker: 'image 1', assetIds: ['b'] },
    { name: '连线视频', type: 'video', index: 2, assetIds: ['absent'] }
  ];
  const r = sample([a, b]);
  r.assets = [
    { id: 'a', name: '甲', fileName: '甲 (1).png', state: 'done' },
    { id: 'b', name: '乙', fileName: '乙.png', state: 'pending' }
  ];
  const doc = aiReadingMarkdown(r),
    cases = doc.split('## 正文库')[0];
  assert.deepEqual(bodies(doc), [literal]);
  assert.match(cases, /### V001\n/);
  assert.match(cases, /### V002\n/);
  for (const unwanted of [
    '甲角色',
    '乙角色',
    '甲 (1).png',
    '%E4%B9%99.png',
    '.mp4',
    '生成／节点素材',
    '素材记录缺失'
  ])
    assert.equal(doc.includes(unwanted), false, unwanted);
  assert.match(doc, /无需附带图片、视频或音频/);
});

test('Missing and partial text is visible and empty bodies are never pooled as equal content', () => {
  const r = sample([
    text('bad', '', '未读到的文本'),
    { ...text('partial', '部分原文'), textState: 'partial' },
    video('v', '', [{ name: '缺失引用', text: '', evidence: ['parameter-reference'] }])
  ]);
  const doc = aiReadingMarkdown(r);
  assert.match(doc, /独立文本第 1 条「未读到的文本」：正文为空或读取失败/);
  assert.match(doc, /缺失引用.*正文为空或读取失败/);
  assert.match(doc, /部分来源含有未解析片段/);
  assert.deepEqual(bodies(doc), ['部分原文']);
  assert.equal(aiReadingMarkdown(sample([{ ...text('i', '图片正文'), kind: 'image_text' }])), null);
});

test('Save automatically adds one combined AI document independently of category selection; repeated saves update in place', async (t) => {
  const fixture = fixtures.liblib(),
    r = normalize(fixture.snapshot, fixture.metadata),
    store = new ProjectStore(await temporary(t));
  await store.create(r, { kinds: ['image'], split: true }, false);
  assert.deepEqual(store.documents, []);
  const saved = await store.save();
  const aiName = filename(r.metadata).slice(0, -3) + '__AI阅读精简版.md',
    regular = store.documents.find((name) => name.endsWith('__图片提示词.md'));
  assert.ok(saved.savedDocuments.includes(aiName));
  assert.equal(store.documents.length, 2);
  const compact = await fs.readFile(path.join(store.directory, aiName), 'utf8');
  assert.match(compact, /V001/);
  assert.ok(bodies(compact).includes(r.entries.find((e) => e.kind === 'text').prompt));
  assert.equal(
    await fs.readFile(path.join(store.directory, regular), 'utf8'),
    markdown(require('../../src/export/markdown.cjs').filterResult(r, ['image']))
  );
  const before = await fs.stat(path.join(store.directory, aiName));
  await store.save();
  assert.equal((await fs.stat(path.join(store.directory, aiName))).mtimeMs, before.mtimeMs);
  r.entries.find((e) => e.kind === 'text').prompt = '更新后的独立文本';
  store.options = { ...store.options, kinds: ['video'], split: false };
  await store.save();
  assert.ok(
    (await fs.readFile(path.join(store.directory, aiName), 'utf8')).includes('更新后的独立文本')
  );
  assert.equal(
    (await fs.readdir(store.directory)).filter((name) => name.endsWith('__AI阅读精简版.md')).length,
    1
  );
  assert.equal(
    (await fs.readdir(store.directory)).some((name) => name.startsWith('历史_')),
    false
  );
  const loaded = new ProjectStore(store.root);
  await loaded.load(store.directory);
  assert.ok(loaded.documents.includes(aiName));
});

test('Cancel after the regular file leaves an existing AI document untouched', async (t) => {
  const store = new ProjectStore(await temporary(t));
  await store.create(sample([text('t', '独立原文'), video('v', '视频原文')]), { split: false });
  const [regular, aiName] = store.documents;
  const oldAi = await fs.readFile(path.join(store.directory, aiName), 'utf8');
  store.result.entries[1].prompt = '更新视频原文';
  const token = {
    get cancelled() {
      return require('node:fs')
        .readFileSync(path.join(store.directory, regular), 'utf8')
        .includes('更新视频原文');
    }
  };
  const saved = await store.save(true, token);
  assert.equal(saved.cancelled, true);
  assert.deepEqual(saved.savedDocuments, [regular]);
  assert.equal(await fs.readFile(path.join(store.directory, aiName), 'utf8'), oldAi);
  assert.ok(store.documents.includes(aiName));
});

test('Author collections automatically save a separate combined file within each work directory', async (t) => {
  const works = ['1', '2'].map((id) => ({
      id,
      title: '作品' + id,
      url: 'https://neowow.cn/video-works-view?id=' + id
    })),
    profile = {
      platform: 'neowow',
      author: '作者',
      uuid: '123',
      url: 'https://neowow.cn/creator?userId=123',
      works
    },
    records = works.map((work) => ({
      work,
      result: namespaceResult(
        {
          ...sample([text('t', '共享原文'), video('v', '视频' + work.id)]),
          metadata: { ...sample([]).metadata, title: work.title, inputUrl: work.url }
        },
        work
      ),
      store: null
    })),
    store = new AuthorStore(await temporary(t), profile, {}, records);
  store.options = { kinds: ['text'], split: true };
  await store.prepare();
  const saved = await store.save(false, { cancelled: false });
  assert.equal(saved.savedDocuments.filter((name) => name.endsWith('__AI阅读精简版.md')).length, 2);
  for (const record of records) {
    const name = record.store.documents.find((name) => name.endsWith('__AI阅读精简版.md'));
    const doc = await fs.readFile(path.join(record.store.directory, name), 'utf8');
    assert.ok(bodies(doc).includes('视频' + record.work.id));
    assert.equal(bodies(doc).includes('视频' + (record.work.id === '1' ? '2' : '1')), false);
  }
});
