'use strict';
const { validPlatformId } = require('../core/model.cjs');
function httpsUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw Object.assign(new Error('请输入完整的 HTTPS 作品链接。'), { code: 'INVALID_URL' });
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw Object.assign(new Error('只接受不含账户凭据的 HTTPS 平台链接。'), {
      code: 'INVALID_URL'
    });
  return url;
}
function createRegistry(definitions) {
  const entries = new Map(),
    cache = new Map(),
    owners = new Map();
  for (const { metadata, load } of definitions) {
    if (
      !validPlatformId(metadata?.id) ||
      typeof metadata.name !== 'string' ||
      !metadata.name.trim() ||
      typeof metadata.version !== 'string' ||
      !metadata.version ||
      entries.has(metadata.id) ||
      typeof load !== 'function' ||
      !Array.isArray(metadata.workHosts) ||
      !metadata.workHosts.length ||
      !metadata.workHosts.includes(httpsUrl(metadata.homeUrl).hostname)
    )
      throw new Error('平台注册信息无效或重复。');
    for (const host of metadata.workHosts) {
      if (typeof host !== 'string' || owners.has(host))
        throw new Error('作品域名无效或被重复注册。');
      owners.set(host, metadata.id);
    }
    const info = Object.freeze({
      ...metadata,
      workHosts: Object.freeze([...metadata.workHosts]),
      frameHosts: Object.freeze([...(metadata.frameHosts || metadata.workHosts)]),
      navigationDomains: Object.freeze([...(metadata.navigationDomains || metadata.workHosts)]),
      capabilities: Object.freeze({ ...metadata.capabilities })
    });
    entries.set(info.id, { metadata: info, load });
  }
  function getAdapter(id) {
    const entry = entries.get(id);
    if (!entry)
      throw Object.assign(new Error('不支持的平台：' + id), {
        code: 'UNSUPPORTED_PLATFORM',
        platform: id
      });
    if (!cache.has(id)) {
      try {
        const adapter = entry.load();
        for (const method of [
          'parseGeneration',
          'cleanText',
          'collectAssets',
          'describeAsset',
          'preview',
          'inspectAccount',
          'isResource',
          'isCanvasUrl',
          'leftWork'
        ])
          if (typeof adapter[method] !== 'function') throw new Error('缺少适配器方法：' + method);
        for (const method of ['readCanvas', 'inspectWork', 'openCanvas'])
          if (typeof adapter.page?.[method] !== 'function')
            throw new Error('缺少页面读取方法：' + method);
        if (!Array.isArray(adapter.textFields)) throw new Error('缺少文本字段规则');
        cache.set(id, Object.freeze({ ...adapter, ...entry.metadata }));
      } catch (cause) {
        throw Object.assign(
          new Error(entry.metadata.name + ' 适配器加载失败，请检查该平台适配代码。', { cause }),
          { code: 'ADAPTER_UNAVAILABLE', platform: id }
        );
      }
    }
    return cache.get(id);
  }
  function listPlatforms() {
    return [...entries.values()].map(({ metadata }) => ({
      id: metadata.id,
      name: metadata.name,
      version: metadata.version,
      capabilities: { ...metadata.capabilities }
    }));
  }
  function resolvePlatform(input) {
    const url = httpsUrl(input),
      entry = [...entries.values()].find((e) => e.metadata.workHosts.includes(url.hostname));
    if (!entry)
      throw Object.assign(
        new Error(
          '当前支持：' +
            listPlatforms()
              .map((p) => p.name)
              .join('、') +
            '。'
        ),
        { code: 'UNSUPPORTED_PLATFORM' }
      );
    return { platform: entry.metadata.id, url: url.href };
  }
  function matchesFrame(id, value) {
    try {
      const url = httpsUrl(value);
      return Boolean(entries.get(id)?.metadata.frameHosts.includes(url.hostname));
    } catch {
      return false;
    }
  }
  function permittedUrl(id, value) {
    try {
      if (value === 'about:blank') return true;
      const url = httpsUrl(value);
      return Boolean(
        entries
          .get(id)
          ?.metadata.navigationDomains.some(
            (host) => url.hostname === host || url.hostname.endsWith('.' + host)
          )
      );
    } catch {
      return false;
    }
  }
  return Object.freeze({
    getAdapter,
    listPlatforms,
    resolvePlatform,
    matchesFrame,
    permittedUrl,
    has: (id) => entries.has(id),
    homeUrls: () => Object.fromEntries([...entries].map(([id, e]) => [id, e.metadata.homeUrl]))
  });
}
// Only metadata loads eagerly. A broken reader for one brand cannot prevent
// application startup, offline project access, or another brand from loading.
const registry = createRegistry([
  { metadata: require('./liblib/metadata.cjs'), load: () => require('./liblib/index.cjs') },
  { metadata: require('./jimeng/metadata.cjs'), load: () => require('./jimeng/index.cjs') },
  { metadata: require('./rhtv/metadata.cjs'), load: () => require('./rhtv/index.cjs') },
  { metadata: require('./tapnow/metadata.cjs'), load: () => require('./tapnow/index.cjs') },
  { metadata: require('./neowow/metadata.cjs'), load: () => require('./neowow/index.cjs') }
]);
module.exports = { ...registry, createRegistry, httpsUrl };
