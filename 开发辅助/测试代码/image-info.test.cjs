'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { png } = require('./fixtures/image-info.cjs');
const { pngTexts, normalizeMetadata } = require('../../src/image-metadata.cjs');
const { ImageInfoService, CACHE } = require('../../src/services/image-info.cjs');
const { ExifToolReader, EXECUTABLE } = require('../../src/services/exiftool.cjs');

test('Chinese PNG text after IDAT, compressed text and international text preserve exact original', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-info-text-'));
  try {
    const original =
      '一间现代中国住宅的客厅，自然光 --ar 16:9 --profile demo --v 8.2 Job ID: sample';
    for (const type of ['tEXt', 'zTXt', 'iTXt']) {
      const file = path.join(root, type + '.png');
      await fs.writeFile(file, png(original, { type }));
      const recovered = await pngTexts(file),
        info = normalizeMetadata({ 'PNG:Description': 'ä¸€é—´' }, recovered);
      assert.equal(info.prompt, '一间现代中国住宅的客厅，自然光');
      assert.equal(info.fullText, original);
      assert.match(info.brand, /推测/);
      assert.equal(info.model, 'V8.2');
    }
    await fs.writeFile(path.join(root, 'truncated.png'), png(original).subarray(0, 30));
    assert.deepEqual(await pngTexts(path.join(root, 'truncated.png')), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Prompt parameters, camera model and C2PA processing attribution stay distinct', () => {
  const parameters =
    '日出，古城\nNegative prompt: 水印\nSteps: 25, Sampler: Euler, Seed: 123, Model: exampleXL';
  const sd = normalizeMetadata({ 'PNG:Parameters': parameters });
  assert.equal(sd.prompt, '日出，古城');
  assert.equal(sd.negativePrompt, '水印');
  assert.equal(sd.model, 'exampleXL');
  assert.equal(sd.fullText, parameters);
  const c2pa = normalizeMetadata({
    'IFD0:Model': 'Camera 123',
    'CBOR:Doc1:Description': 'Opened ingredient',
    'JUMBF:Doc1:JUMDLabel': 'c2pa',
    'CBOR:Doc1:Claim_generator_info': { name: 'Google C2PA Core Generator Library' },
    'CBOR:Doc1:Actions': [
      { action: 'c2pa.opened', description: 'Opened by Google Generative AI.' },
      { action: 'c2pa.resized', description: 'Resized by Google Generative AI.' }
    ]
  });
  assert.equal(c2pa.prompt, '');
  assert.equal(c2pa.model, '');
  assert.equal(c2pa.brand, '');
  assert.equal(c2pa.c2pa, true);
  assert.deepEqual(c2pa.processingSoftware, ['Google Generative AI']);
});

test('AIGC provider identities identify platforms without inventing a model from service codes', () => {
  for (const [producer, brand] of [
    ['001191110105MACJ6K1C8A10001', 'LiblibAI／LibTV'],
    ['001191110105MACJ6K1C8A10002', 'LiblibAI／LibTV'],
    ['91110105MACJ6K1C8A', 'LiblibAI／LibTV'],
    ['00119144030008867405X210001', '即梦'],
    ['doubao', '豆包']
  ]) {
    for (const aigc of [
      { ContentProducer: producer },
      JSON.stringify({ AIGC: { ContentProducer: producer } }),
      "{'Label': '1', 'ContentProducer': '" + producer + "', 'ProduceID': '336982655822282752'}"
    ]) {
      const info = normalizeMetadata({ 'PNG:AIGC': aigc });
      assert.equal(info.brand, brand);
      assert.equal(info.model, '');
      assert.equal(info.prompt, '');
    }
  }
  assert.equal(
    normalizeMetadata({ 'PNG:AIGC': '{"ContentPropagator":"001191110105MACJ6K1C8A10001"}' }).brand,
    ''
  );
  assert.equal(normalizeMetadata({ 'PNG:AIGC': '{"ContentProducer":"unknown10001"}' }).brand, '');
});

test('Google AI requires an explicit AI creation record, not a library, filename or watermark alone', () => {
  const created = {
    action: 'c2pa.created',
    description: 'Created by Google Generative AI.',
    digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
  };
  const info = normalizeMetadata({ 'CBOR:Doc1:Actions': [created] });
  assert.equal(info.brand, 'Google AI');
  assert.equal(info.model, '');
  assert.match(info.brandEvidence, /Created by Google Generative AI/);
  for (const raw of [
    { 'System:FileName': 'Gemini_Generated_Image.jpg' },
    { 'CBOR:Doc1:Claim_generator_info': { name: 'Google C2PA Core Generator Library' } },
    { 'CBOR:Doc1:Actions': [{ ...created, action: 'c2pa.edited' }] },
    { 'CBOR:Doc1:Actions': [{ ...created, digitalSourceType: '' }] },
    {
      'CBOR:Doc1:Actions': [
        { action: 'c2pa.edited', description: 'Applied imperceptible SynthID watermark.' }
      ]
    }
  ])
    assert.equal(normalizeMetadata(raw).brand, '');
});

test('Singleton and array C2PA creation actions identify Grok Imagine consistently', () => {
  const action = {
    action: 'c2pa.created',
    softwareAgent: 'Grok Imagine',
    digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
  };
  for (const actions of [action, [action]]) {
    const info = normalizeMetadata({
      'CBOR:Doc1:Claim_generator_info': { name: 'Grok Imagine', version: '0.0.0' },
      'CBOR:Doc1:Actions': actions
    });
    assert.equal(info.brand, 'Grok Imagine');
    assert.equal(info.model, '');
    assert.equal(info.prompt, '');
    assert.match(info.brandEvidence, /c2pa.created/);
  }
  for (const actions of [
    { ...action, action: 'c2pa.opened' },
    { ...action, action: 'c2pa.edited' },
    [null, 'Grok Imagine', []]
  ])
    assert.equal(normalizeMetadata({ 'CBOR:Doc1:Actions': actions }).brand, '');
});

test('ComfyUI follows sampler conditioning and model links, excluding unrelated text', () => {
  const graph = {
    1: { class_type: 'CLIPTextEncode', inputs: { text: '正向描述' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: '负向描述' } },
    3: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'local-model.safetensors' } },
    4: {
      class_type: 'KSampler',
      inputs: { positive: ['1', 0], negative: ['2', 0], model: ['3', 0] }
    },
    5: { class_type: 'CLIPTextEncode', inputs: { text: '无关分支' } }
  };
  const info = normalizeMetadata({ 'PNG:Prompt': JSON.stringify(graph) });
  assert.equal(info.brand, 'ComfyUI');
  assert.equal(info.prompt, '正向描述');
  assert.equal(info.negativePrompt, '负向描述');
  assert.equal(info.model, 'local-model.safetensors');
  assert.doesNotMatch(info.fullText, /无关分支/);
});

test('ComfyUI workflows identify the main model separately from VAE and input filenames', () => {
  const graph = {
    10: {
      class_type: 'SeedVR2VideoUpscaler',
      inputs: { image: ['17', 0], dit: ['14', 0], vae: ['13', 0], resolution: 4096 }
    },
    13: { class_type: 'SeedVR2LoadVAEModel', inputs: { model: 'ema_vae_fp16.safetensors' } },
    14: {
      class_type: 'SeedVR2LoadDiTModel',
      inputs: { model: 'seedvr2_ema_3b_fp8_e4m3fn.safetensors' }
    },
    15: { class_type: 'SaveImage', inputs: { images: ['10', 0] } },
    16: { class_type: 'LoadImage', inputs: { image: 'ChatGPT Image.png' } },
    17: { class_type: 'JoinImageWithAlpha', inputs: { image: ['16', 0], alpha: ['16', 1] } }
  };
  const raw = { 'PNG:Prompt': JSON.stringify(graph) },
    info = normalizeMetadata(raw);
  assert.equal(info.brand, 'ComfyUI');
  assert.equal(info.model, 'SeedVR2');
  assert.equal(info.prompt, '');
  assert.ok(info.modelEvidence.includes(graph[14].inputs.model));
  assert.deepEqual(info.processing, []);
  assert.equal(
    normalizeMetadata({ ...raw, 'PNG:Model': 'explicit-model' }).model,
    'explicit-model'
  );
  const vaeOnly = structuredClone(graph);
  delete vaeOnly[10].inputs.dit;
  assert.equal(normalizeMetadata({ 'PNG:Prompt': JSON.stringify(vaeOnly) }).model, '');
  assert.equal(
    normalizeMetadata({ ...raw, 'XMP-TC260:AIGC': '{"ContentProducer":"doubao"}' }).brand,
    '豆包'
  );
  for (const value of [
    {},
    { model: 'ComfyUI', inputs: {} },
    { 1: { class_type: 'SaveImage', inputs: { images: ['missing', 0] } } },
    {
      1: { class_type: 'LoadImage', inputs: { image: 'source.png' } },
      2: { class_type: 'SaveImage', inputs: { images: ['missing', 0] } }
    }
  ]) {
    const other = normalizeMetadata({ 'PNG:Prompt': JSON.stringify(value) });
    assert.equal(other.brand, '');
    assert.equal(other.software.includes('ComfyUI'), false);
  }
});

test('Batch queue deduplicates requests, invalidates changed files and transfers relative cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-info-cache-'));
  let calls = 0;
  const reader = {
    async read(files) {
      calls++;
      return files.map((file) => ({ SourceFile: file, 'File:FileType': 'PNG' }));
    },
    async close() {}
  };
  let service = new ImageInfoService({ reader });
  const asset = { id: 'one' },
    file = path.join(root, '图片.png');
  try {
    await fs.writeFile(file, png('第一版 --profile test --v 8.2'));
    const results = await Promise.all([service.read(asset, file), service.read(asset, file)]);
    assert.equal(calls, 1);
    assert.equal(results[0].prompt, '第一版');
    assert.equal((await service.read(asset, file)).cached, true);
    await fs.writeFile(file, png('第二版内容 --profile test --v 8.2'));
    assert.equal((await service.read(asset, file)).prompt, '第二版内容');
    assert.equal(calls, 2);
    await service.close();
    const relocated = path.join(root, '移动后的作品');
    await fs.mkdir(relocated);
    // Rename retains file timestamps, exactly as moving a project directory does.
    await fs.rename(file, path.join(relocated, '图片.png'));
    await fs.rename(path.join(root, CACHE), path.join(relocated, CACHE));
    service = new ImageInfoService({ reader });
    const moved = await service.read({ id: 'new-session-id' }, path.join(relocated, '图片.png'));
    assert.equal(moved.cached, true);
    assert.equal(moved.assetId, 'new-session-id');
    assert.equal(calls, 2);
    await service.read(asset, path.join(relocated, '图片.png'), { force: true });
    assert.equal(calls, 3);
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test(
  'Bundled Windows ExifTool runs from a copied Chinese path with no host tool in PATH',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), '图片信息 复制验证-'));
    let reader;
    try {
      await fs.cp(path.dirname(EXECUTABLE), path.join(root, '内置工具'), { recursive: true });
      reader = new ExifToolReader({
        executable: path.join(root, '内置工具', 'exiftool.exe'),
        env: { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') }
      });
      const file = path.join(root, '中文图片.png');
      await fs.writeFile(file, png('中文原文 --profile test --v 8.2'));
      const first = await reader.read([file]),
        child = reader.child;
      assert.equal(first.length, 1);
      const direct = await reader.readText([file]);
      assert.match(direct, /ExifTool Version Number\s*:/);
      assert.match(direct, /File Name\s*:\s*中文图片.png/);
      assert.doesNotMatch(direct, /"SourceFile"\s*:/);
      const second = await reader.read([file]);
      assert.equal(reader.child, child);
      assert.equal(second.length, 1);
      assert.equal(normalizeMetadata(first[0], await pngTexts(file)).prompt, '中文原文');
      await assert.rejects(reader.read([path.join(root, '不存在.png')]), /不存在|File not found/);
      assert.equal((await reader.read([file])).length, 1);
    } finally {
      await reader?.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  }
);
