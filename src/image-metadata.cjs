'use strict';
const fs = require('node:fs/promises');
const zlib = require('node:zlib');
const MAX_TEXT = 2 * 1024 * 1024;
const VERSION = 10;
const tagName = (key) => key.split(':').at(-1).replace(/_/g, '').toLowerCase();

// Some generators put UTF-8 in Latin-1 tEXt/zTXt. Recover from original
// bytes, not a guessed reverse conversion of already decoded text.
async function pngTexts(file) {
  const handle = await fs.open(file, 'r'),
    result = [];
  try {
    const signature = Buffer.alloc(8);
    await handle.read(signature, 0, 8, 0);
    if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return result;
    const size = (await handle.stat()).size;
    let pos = 8,
      total = 0;
    for (let count = 0; pos + 12 <= size && count < 100000; count++) {
      const header = Buffer.alloc(8);
      if ((await handle.read(header, 0, 8, pos)).bytesRead !== 8) break;
      const length = header.readUInt32BE(0),
        type = header.toString('ascii', 4, 8);
      if (pos + length + 12 > size) break;
      if (['tEXt', 'zTXt', 'iTXt'].includes(type) && length <= MAX_TEXT && total < 8 * MAX_TEXT) {
        const data = Buffer.alloc(length);
        await handle.read(data, 0, length, pos + 8);
        const split = data.indexOf(0);
        if (split > 0) {
          let body = data.subarray(split + 1),
            utf8Only = false;
          try {
            if (type === 'zTXt') {
              if (body[0] !== 0) throw new Error('Unsupported compression');
              body = zlib.inflateSync(body.subarray(1), { maxOutputLength: MAX_TEXT });
            }
            if (type === 'iTXt') {
              const compressed = body[0],
                method = body[1];
              const langEnd = body.indexOf(0, 2),
                translatedEnd = body.indexOf(0, langEnd + 1);
              if (langEnd < 2 || translatedEnd < 0 || compressed > 1 || method !== 0)
                throw new Error('Invalid iTXt');
              body = body.subarray(translatedEnd + 1);
              if (compressed) body = zlib.inflateSync(body, { maxOutputLength: MAX_TEXT });
              utf8Only = true;
            }
            if (body.length > MAX_TEXT) throw new Error('Text too large');
            let value,
              encoding = 'UTF-8';
            try {
              value = new TextDecoder('utf-8', { fatal: true }).decode(body);
            } catch {
              if (utf8Only) throw new Error('Invalid UTF-8');
              value = body.toString('latin1');
              encoding = 'Latin-1';
            }
            total += body.length;
            result.push({ key: data.toString('latin1', 0, split), value, encoding, chunk: type });
          } catch {
            /* ExifTool still preserves unsupported text and warnings. */
          }
        }
      }
      pos += length + 12;
      if (type === 'IEND') break;
    }
    return result;
  } finally {
    await handle.close();
  }
}

function normalizeMetadata(raw, recovered = []) {
  const fields = Object.entries(raw).filter(([key]) => key !== 'SourceFile');
  const values = (name) =>
    fields
      .filter(([key]) => tagName(key) === name.toLowerCase().replace(/_/g, ''))
      .map(([, value]) => value);
  const first = (...names) => names.flatMap(values).find((v) => v !== '' && v != null);
  const info = {
    model: '',
    brand: '',
    modelEvidence: '',
    brandEvidence: '',
    software: [],
    prompt: '',
    negativePrompt: '',
    parameters: '',
    promptSource: '',
    promptCandidates: [],
    width: Number(first('ImageWidth', 'ExifImageWidth')) || 0,
    height: Number(first('ImageHeight', 'ExifImageHeight')) || 0,
    format: String(first('FileType') || ''),
    c2pa: fields.some(([key, value]) => /^JUMBF:/.test(key) && String(value).includes('c2pa')),
    processing: [],
    processingSoftware: [],
    descriptions: [],
    raw: Object.fromEntries(fields.filter(([key]) => !/^System:/.test(key))),
    recovered
  };
  const addPrompt = (text, source, negative = '', parameters = '', fullText = '') => {
    if (typeof text !== 'string' || !text.trim()) return;
    if (!info.promptCandidates.some((p) => p.text === text))
      info.promptCandidates.push({
        text,
        source,
        negative,
        parameters,
        fullText:
          fullText ||
          [text, negative && 'Negative prompt: ' + negative, parameters].filter(Boolean).join('\n')
      });
  };
  const setModel = (model, source) => {
    if (!info.model && typeof model === 'string' && model.trim()) {
      info.model = model;
      info.modelEvidence = source;
    }
  };
  const setBrand = (value, source) => {
    if (!info.brand && typeof value === 'string' && value.trim()) {
      info.brand = /^gpt-image$/i.test(value.trim()) ? 'GPT Image' : value;
      info.brandEvidence = source;
    }
  };
  const parameters = (value, source) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const split = value.match(/\r?\nSteps:\s*\d+/),
      body = split ? value.slice(0, split.index) : value,
      params = split ? value.slice(split.index).trim() : '',
      negative = body.match(/(?:^|\r?\n)Negative prompt:\s*/);
    addPrompt(
      negative ? body.slice(0, negative.index).trim() : body.trim(),
      source,
      negative ? body.slice(negative.index + negative[0].length).trim() : '',
      params,
      value
    );
    const model = params.match(/(?:^|,\s*)Model:\s*([^,\r\n]+)/);
    if (model) setModel(model[1], source + ' / Model');
  };
  // Recovered bytes have priority over ExifTool's standards-compliant Latin-1 interpretation.
  const textual = [
    ...recovered.map((v) => ['PNG:' + v.chunk + ':' + v.key, v.value]),
    ...fields.filter(
      ([key]) =>
        !/^(CBOR|JUMBF):/.test(key) &&
        !(/^PNG:/.test(key) && recovered.some((r) => tagName(r.key) === tagName(key)))
    )
  ];
  let comfySource = '',
    comfyModel = null;
  for (const [key, value] of textual) {
    const name = tagName(key);
    if (['parameters', 'generationparameters'].includes(name)) parameters(value, key);
    if (
      ['model', 'modelname', 'generativemodel', 'generativeaimodel'].includes(name) &&
      !/^(IFD\d|ExifIFD|XMP-exif|XMP-tiff|MakerNotes):/i.test(key)
    )
      setModel(value, key);
    if (['aibrand', 'generatorbrand'].includes(name)) setBrand(value, key);
    if (['software', 'creatortool'].includes(name) && typeof value === 'string')
      info.software.push(value);
    if (
      ['prompt', 'positiveprompt', 'description', 'imagedescription', 'usercomment'].includes(
        name
      ) &&
      typeof value === 'string'
    ) {
      let workflow;
      try {
        workflow = JSON.parse(value);
      } catch {}
      const nodes =
        workflow && typeof workflow === 'object' && !Array.isArray(workflow)
          ? Object.values(workflow).filter(
              (node) =>
                node &&
                typeof node.class_type === 'string' &&
                node.class_type.trim() &&
                node.inputs &&
                typeof node.inputs === 'object' &&
                !Array.isArray(node.inputs)
            )
          : [];
      if (
        name === 'prompt' &&
        nodes.length >= 2 &&
        nodes.some((node) =>
          Object.values(node.inputs).some(
            (link) =>
              Array.isArray(link) &&
              link.length === 2 &&
              ['string', 'number'].includes(typeof link[0]) &&
              Number.isInteger(link[1]) &&
              link[1] >= 0 &&
              nodes.includes(workflow[link[0]])
          )
        )
      ) {
        comfySource ||= key + ' / class_type、inputs 与节点连线';
        for (const node of nodes) {
          if (node.class_type !== 'SeedVR2VideoUpscaler' || !Array.isArray(node.inputs.dit))
            continue;
          const loader = workflow[node.inputs.dit[0]];
          if (
            loader?.class_type === 'SeedVR2LoadDiTModel' &&
            typeof loader.inputs?.model === 'string' &&
            loader.inputs.model.trim()
          ) {
            comfyModel ||= {
              name: 'SeedVR2',
              source: key + ' / SeedVR2VideoUpscaler / dit / ' + loader.inputs.model
            };
          }
        }
        // Resolve conditioning from sampler inputs so unrelated workflow text
        // (including negative prompts) isn't presented as the positive prompt.
        const linkedText = (id, seen = new Set()) => {
          id = String(id);
          if (seen.has(id) || seen.size > 100) return [];
          seen.add(id);
          const node = workflow[id];
          if (!node?.inputs) return [];
          if (/TextEncode/i.test(node.class_type || '') && typeof node.inputs.text === 'string')
            return [node.inputs.text];
          return Object.values(node.inputs).flatMap((v) =>
            Array.isArray(v) && v.length === 2 ? linkedText(v[0], seen) : []
          );
        };
        for (const node of nodes) {
          if (!node?.inputs || !Array.isArray(node.inputs.positive)) continue;
          const positive = linkedText(node.inputs.positive[0]).join('\n'),
            negative = Array.isArray(node.inputs.negative)
              ? linkedText(node.inputs.negative[0]).join('\n')
              : '';
          addPrompt(positive, key + ' / ComfyUI', negative);
          const visitModel = (id, seen = new Set()) => {
            id = String(id);
            if (seen.has(id) || seen.size > 100) return;
            seen.add(id);
            const n = workflow[id];
            if (!n?.inputs) return;
            if (/CheckpointLoader|UNETLoader|DiffusionModelLoader/i.test(n.class_type || ''))
              setModel(
                n.inputs.ckpt_name || n.inputs.unet_name || n.inputs.model_name,
                key + ' / ' + n.class_type
              );
            for (const v of Object.values(n.inputs))
              if (Array.isArray(v) && v.length === 2) visitModel(v[0], seen);
          };
          if (Array.isArray(node.inputs.model)) visitModel(node.inputs.model[0]);
        }
        info.software.push('ComfyUI');
      } else if (!workflow && !/^\s*[\[{]/.test(value)) {
        const mj = value.match(/\s--(?:ar|v|version|raw|profile|stylize)\b/i),
          mjVersion = value.match(/(?:^|\s)--(?:v|version)\s+(\d+(?:\.\d+)*)(?=\s|$)/i);
        if (mj && (mjVersion || /--profile\s/.test(value))) {
          addPrompt(value.slice(0, mj.index).trim(), key, '', value.slice(mj.index).trim(), value);
          setBrand('Midjourney（参数特征推测）', key + ' / --v、--profile 等参数');
          if (mjVersion) setModel('V' + mjVersion[1], key + ' / ' + mjVersion[0].trim());
        } else if (name === 'parameters') parameters(value, key);
        else if (
          ['prompt', 'positiveprompt', 'usercomment'].includes(name) &&
          !/^\s*<\?xml/.test(value)
        ) {
          if (/\r?\nSteps:\s*\d+/.test(value)) parameters(value, key);
          else addPrompt(value, key);
        } else if (/^(PNG|XMP-dc):/i.test(key)) addPrompt(value, key + '（图片描述）');
        if (['description', 'imagedescription'].includes(name))
          info.descriptions.push({ text: value, source: key });
      }
    }
  }
  for (const [key, value] of textual) {
    if (tagName(key) !== 'aigc') continue;
    let aigc = value;
    if (typeof value === 'string') {
      try {
        aigc = JSON.parse(value);
      } catch {
        // Some PNG writers serialize the AIGC dictionary with single quotes.
        aigc = {
          ContentProducer: value.match(/['"]ContentProducer['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]
        };
      }
    }
    const producer = aigc?.AIGC?.ContentProducer ?? aigc?.ContentProducer;
    // Attribute the platform from its company identity, never from a model/app suffix.
    if (
      typeof producer === 'string' &&
      /^(?:9144030008867405X2|00119144030008867405X2[0-9A-Z]{5})$/.test(producer.trim())
    )
      setBrand('即梦', key + ' / ContentProducer / 9144030008867405X2');
    else if (typeof producer === 'string' && producer.trim().toLowerCase() === 'doubao')
      setBrand('豆包', key + ' / ContentProducer / doubao');
    else if (
      typeof producer === 'string' &&
      /^(?:91110105MACJ6K1C8A|001191110105MACJ6K1C8A[0-9A-Z]{5})$/.test(producer.trim())
    )
      setBrand('LiblibAI／LibTV', key + ' / ContentProducer / 91110105MACJ6K1C8A');
  }
  for (const [key, value] of fields) {
    if (tagName(key) === 'claimgeneratorinfo') {
      for (const generator of Array.isArray(value) ? value : [value])
        if (generator?.name)
          info.processing.push({
            action: '凭证生成工具',
            software: generator.name,
            version: generator.version || '',
            source: key
          });
    }
    if (tagName(key) === 'actions' && value && typeof value === 'object') {
      for (const a of Array.isArray(value) ? value : [value]) {
        if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
        const agent = a.softwareAgent || a.software_agent,
          software = typeof agent === 'string' ? agent : agent?.name || '',
          description = a.description || '',
          action = a.action || '';
        info.processing.push({ action, description, software, source: key });
        const describedSoftware = description.match(
          /^(?:Opened|Resized|Edited|Created|Generated) by (.+?)\.?$/i
        )?.[1];
        if (software || describedSoftware)
          info.processingSoftware.push(software || describedSoftware);
        // Only an explicit creation action can supply generation attribution.
        if (action === 'c2pa.created') {
          if (
            /^Created by Google Generative AI\.?$/i.test(description.trim()) &&
            /trainedAlgorithmicMedia/.test(a.digitalSourceType || '')
          )
            setBrand('Google AI', key + ' / c2pa.created / ' + description);
          if (
            software &&
            !/C2PA.*Library/i.test(software) &&
            (/trainedAlgorithmicMedia/.test(a.digitalSourceType || '') ||
              /Midjourney|Firefly|DALL.E|Stable Diffusion|FLUX|Imagen|Gemini/i.test(software))
          )
            setBrand(software, key + ' / c2pa.created');
          const model = a.parameters?.model || a.parameters?.modelName;
          setModel(model, key + ' / c2pa.created');
        }
      }
    }
  }
  if (comfySource) setBrand('ComfyUI', comfySource);
  if (comfyModel) setModel(comfyModel.name, comfyModel.source);
  info.software = [...new Set(info.software)];
  info.processingSoftware = [...new Set(info.processingSoftware)];
  info.promptCandidates.sort(
    (a, b) => Number(a.source.includes('（图片描述）')) - Number(b.source.includes('（图片描述）'))
  );
  if (info.promptCandidates.length) {
    const p = info.promptCandidates[0];
    const negative = p.negative || first('NegativePrompt') || '';
    Object.assign(info, {
      prompt: p.text,
      negativePrompt: negative,
      parameters: p.parameters,
      promptSource: p.source,
      fullText: p.fullText + (!p.negative && negative ? '\nNegative prompt: ' + negative : '')
    });
  }
  info.fullText ||= '';
  return info;
}
module.exports = { VERSION, MAX_TEXT, tagName, pngTexts, normalizeMetadata };
