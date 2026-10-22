'use strict';
const { safeUrl } = require('../../assets.cjs');
function profileAddress(input) {
  try {
    const url = new URL(String(input).trim());
    const uuid = url.pathname.match(/^\/creator\/profile\/([a-f0-9-]{36})\/?$/i)?.[1];
    if (
      url.protocol === 'https:' &&
      url.hostname === 'app.tapnow.plus' &&
      !url.username &&
      !url.password &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid || '')
    )
      return { uuid, url: 'https://app.tapnow.plus/creator/profile/' + uuid };
  } catch {}
  return null;
}
async function readProfile(input, fetcher, signal, onProgress = () => {}) {
  const address = profileAddress(input);
  if (!address) throw new Error('请输入有效的 TapNow 作者主页地址。');
  const get = async (path) => {
    const response = await fetcher('https://app.tapnow.plus' + path, {
      credentials: 'include',
      redirect: 'error',
      headers: { Referer: address.url },
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(20000)])
    });
    if (!response.ok) throw new Error('TapNow 作者列表读取失败（HTTP ' + response.status + '）。');
    const value = await response.json();
    if (value.code !== 0 || !value.data)
      throw new Error(value.message || 'TapNow 作者列表暂不可用。');
    return value.data;
  };
  const works = [],
    ids = new Set();
  let author = '',
    avatar = '',
    complete = false;
  for (let page = 1; page <= 500; page++) {
    // Match the public portfolio filter. Canvas access is checked independently
    // on each work detail, not inferred from its community category.
    const params = new URLSearchParams({
      user_id: address.uuid,
      has_channel: '1',
      page: String(page),
      page_size: '20',
      order: 'final_score',
      sort: 'desc',
      language: 'zh-CN'
    });
    const data = await get('/api/community/video?' + params);
    if (!Array.isArray(data.list)) throw new Error('TapNow 作品列表格式发生变化。');
    let added = 0;
    for (const item of data.list) {
      if (!item.id || ids.has(String(item.id)) || item.user_id !== address.uuid) continue;
      const channel = item.channels?.find((c) => Number.isInteger(c.id) && c.id > 0)?.id;
      if (!channel) throw new Error('TapNow 作品缺少公开详情入口，无法完整读取作者选集。');
      const id = String(item.id),
        title = String(item.title || '未命名作品');
      ids.add(id);
      added++;
      author ||= item.user_name || '';
      avatar ||= safeUrl(item.avatar_url);
      works.push({
        id,
        title,
        platform: 'tapnow',
        cover: safeUrl(item.cover_image_url),
        url: `https://app.tapnow.plus/home/taptv/${channel}/${encodeURIComponent(id)}`,
        canvasId: typeof item.canva_id === 'string' ? item.canva_id : '',
        fullVideo: {
          workId: id,
          name: title,
          url: safeUrl(item.video_url),
          previewUrl: safeUrl(item.cover_image_url),
          duration: item.duration
        },
        state: 'idle',
        error: ''
      });
    }
    onProgress(works.length);
    const rawTotal = data.pagination?.total;
    const total =
      rawTotal != null && Number.isFinite(Number(rawTotal)) && Number(rawTotal) >= 0
        ? Number(rawTotal)
        : null;
    if (!data.list.length && total !== null && ids.size < total)
      throw new Error('TapNow 作品列表提前结束，请重试以避免漏读。');
    if (
      !data.list.length ||
      (typeof total === 'number' && ids.size >= total) ||
      (total == null && data.list.length < 20)
    ) {
      complete = true;
      break;
    }
    if (!added) throw new Error('TapNow 作品列表分页没有推进，请重试。');
  }
  if (!complete) throw new Error('TapNow 作者作品超过读取上限。');
  if (!author) {
    const info = await get('/api/community/creator/' + address.uuid + '/profile');
    author = info.user_name || info.display_name || info.nickname || '';
    avatar ||= safeUrl(info.avatar_url);
  }
  if (!author) throw new Error('未读到 TapNow 作者资料，请检查主页地址。');
  return { platform: 'tapnow', ...address, author, avatar, works, selectedIds: [] };
}
module.exports = { profileAddress, readProfile };
