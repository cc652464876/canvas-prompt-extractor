'use strict';
const { safeUrl } = require('../../assets.cjs');
const { readLiblibProfile, liblibProfile } = require('../../author-profiles.cjs');
function profileAddress(input) {
  try {
    const url = new URL(String(input).trim());
    const uuid = url.searchParams.get('uuid');
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['liblib.tv', 'www.liblib.tv'].includes(url.hostname) &&
      /^\/profile\/?$/.test(url.pathname) &&
      /^[a-f0-9]{32}$/i.test(uuid || '')
    )
      return { uuid, url: 'https://www.liblib.tv/profile?uuid=' + uuid };
  } catch {}
  return null;
}
async function readProfile(input, fetcher, signal, onProgress = () => {}) {
  const address = profileAddress(input);
  if (!address) throw new Error('请输入有效的 LibTV 作者主页地址。');
  async function post(url, body) {
    const response = await fetcher(url, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Referer: 'https://www.liblib.tv/' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)])
    });
    if (!response.ok) throw new Error('作者主页读取失败（HTTP ' + response.status + '）。');
    const value = await response.json();
    if (value.code !== 0)
      throw new Error(value.msg || '作者作品列表读取失败，请检查登录或稍后重试。');
    return value.data;
  }
  const works = [],
    ids = new Set();
  let author = '',
    avatar = '',
    declaredTotal = null,
    complete = false;
  for (let page = 1; page <= 500; page++) {
    const data = await post('https://api.liblib.tv/api/canvas/project/template/list', {
      page,
      pageSize: 20,
      uuid: address.uuid,
      status: null,
      type: 0
    });
    if (!Array.isArray(data?.list)) throw new Error('作者作品列表格式发生变化，请稍后重试。');
    declaredTotal =
      data.total != null && Number.isFinite(Number(data.total)) && Number(data.total) >= 0
        ? Number(data.total)
        : null;
    let added = 0;
    for (const item of data.list) {
      const id = item.templateUuid;
      if (!/^[a-f0-9]{32}$/i.test(id || '') || ids.has(id)) continue;
      if (item.ownerUuid && item.ownerUuid !== address.uuid) continue;
      ids.add(id);
      added++;
      author ||= typeof item.nickname === 'string' ? item.nickname : '';
      avatar ||= safeUrl(item.avatar);
      works.push({
        id,
        title: String(item.name || '未命名作品'),
        cover: safeUrl(item.coverUrl),
        url: 'https://www.liblib.tv/detail/' + id,
        canvasId: typeof item.projectUuid === 'string' ? item.projectUuid : '',
        canvasAccess:
          item.snapshotId === undefined ? 'unknown' : item.snapshotId ? 'public' : 'not-public',
        fullVideo: {
          workId: id,
          name: String(item.name || '未命名作品'),
          url: safeUrl(item.finalOutput),
          previewUrl: safeUrl(item.coverUrl)
        },
        ...(item.snapshotId !== undefined && !item.snapshotId
          ? { note: '画布未公开，仅可下载作品视频' }
          : {}),
        state: 'idle',
        error: ''
      });
    }
    onProgress(works.length);
    if (
      !data.list.length ||
      (declaredTotal !== null && works.length >= declaredTotal) ||
      (declaredTotal === null && data.list.length < 20)
    ) {
      complete = true;
      break;
    }
    if (!added) throw new Error('作品列表分页没有推进，已停止读取以避免漏读或重复。');
  }
  if (!complete) throw new Error('作者作品数量超过当前读取上限，请使用单作品链接。');
  let authorInfo;
  try {
    authorInfo = await readLiblibProfile(address, fetcher, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    authorInfo = liblibProfile({}, address);
    authorInfo.profile.note = '作者公开资料暂未读到，已保留主页链接';
  }
  author = authorInfo.profile.displayName || author;
  avatar = authorInfo.profile.avatarUrl || avatar;
  if (!authorInfo.profile.displayName) authorInfo.profile.displayName = author;
  if (!author) throw new Error('未读到作者信息，请检查主页地址。');
  return { platform: 'liblib', ...address, author, avatar, authorInfo, works, selectedIds: [] };
}
module.exports = { profileAddress, readProfile };
