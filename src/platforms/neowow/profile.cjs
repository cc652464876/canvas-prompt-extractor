'use strict';
const { safeUrl } = require('../../assets.cjs');
function profileAddress(input) {
  try {
    const url = new URL(String(input).trim());
    const uuid = url.searchParams.get('userId');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['neowow.cn', 'www.neowow.cn'].includes(url.hostname) ||
      url.pathname !== '/creator' ||
      url.searchParams.getAll('userId').length !== 1 ||
      !/^\d{1,32}$/.test(uuid || '')
    )
      return null;
    // NeoWow IDs exceed JS safe integers. Preserve the original decimal string.
    return { uuid, url: 'https://neowow.cn/creator?userId=' + uuid };
  } catch {
    return null;
  }
}
async function profilePage(action, pageNumber) {
  const url = new URL(location.href),
    userId = url.searchParams.get('userId');
  if (
    !['neowow.cn', 'www.neowow.cn'].includes(url.hostname) ||
    url.pathname !== '/creator' ||
    !/^\d{1,32}$/.test(userId || '')
  )
    return { error: 'NeoWow 作者主页已切换，请重新读取。' };
  if (action === 'snapshot')
    return {
      // The public read APIs do not depend on Vue route chunks finishing.
      // A cold page can keep its app root empty while large scripts download.
      ready: Boolean(document.querySelector('#app')),
      url: location.href
    };
  if (!['info', 'page'].includes(action)) return { error: '不支持的 NeoWow 主页读取操作。' };
  const headers = {
    'Content-Type': 'application/json',
    timestamp: String(Date.now()),
    'Accept-Language': 'zh-CN'
  };
  // Authentication stays inside its own website session. It is never returned
  // to the host, saved with the author, or included in diagnostic payloads.
  const token = localStorage.getItem('token');
  if (token) headers.accessToken = token;
  const channel = localStorage.getItem('channelCode');
  if (channel) headers.channelCode = channel;
  const page = Number(pageNumber);
  if (action === 'page' && (!Number.isInteger(page) || page < 1 || page > 500))
    return { error: 'NeoWow 作品分页无效。' };
  const endpoint =
    action === 'info' ? '/ucenter/creator-homepage/view' : '/ucenter/creator-homepage/view/works';
  const body =
    action === 'info'
      ? { userId }
      : { userId, tab: 'works', sort: 'latest', pageNum: page, pageSize: 20 };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4500)
    });
    if ([401, 403].includes(response.status))
      return {
        error: 'NeoWow 作者主页需要登录或访问权限，请在程序设置中的 NeoWow 入口登录后重试。'
      };
    if (!response.ok) return { error: 'NeoWow 作者作品读取失败（HTTP ' + response.status + '）。' };
    const value = await response.json();
    if (value.success !== true)
      return {
        error: ['2000', '401', '4010'].includes(String(value.errCode))
          ? 'NeoWow 登录已失效，请在程序内重新登录后重试。'
          : 'NeoWow 未返回可访问的作者资料或作品列表，请确认主页权限后重试。'
      };
    if (action === 'info') {
      const data = value.data,
        profile = data?.profile;
      if (!profile || typeof profile.nickname !== 'string')
        return { error: 'NeoWow 作者资料格式发生变化。' };
      return {
        userId,
        author: profile.nickname,
        avatar: typeof profile.avatar === 'string' ? profile.avatar : '',
        signature: typeof data.settings?.signature === 'string' ? data.settings.signature : '',
        workCount: data.stats?.workCount ?? null
      };
    }
    if (!Array.isArray(value.data)) return { error: 'NeoWow 作者作品列表格式发生变化。' };
    const fields = [
      'id',
      'title',
      'authorName',
      'authorUserId',
      'sessionId',
      'originalSessionId',
      'coverImageUrl',
      'videoUrl',
      'previewVideoUrl',
      'playUrl',
      'duration',
      'isPublic',
      'isReward',
      'dataType'
    ];
    return {
      userId,
      list: value.data.map((item) =>
        Object.fromEntries(
          fields.filter((key) => item?.[key] !== undefined).map((key) => [key, item[key]])
        )
      ),
      total: value.totalCount ?? null,
      page: value.pageIndex ?? page
    };
  } catch {
    return { error: '读取 NeoWow 作者主页失败或超时，请检查网络后重试。' };
  }
}
function listingWork(item, author) {
  if (
    !item ||
    !(
      (typeof item.id === 'string' && /^[\w-]+$/.test(item.id)) ||
      (typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id > 0)
    )
  )
    throw new Error('NeoWow 作品缺少可靠的编号，已停止以避免漏读或编号精度损失。');
  const id = String(item.id),
    title = typeof item.title === 'string' && item.title.trim() ? item.title : '未命名作品';
  const canvasId =
    typeof item.sessionId === 'string' && /^SSN_[\w-]+$/.test(item.sessionId) ? item.sessionId : '';
  const access =
    item.isPublic === 0
      ? 'not-public'
      : item.isPublic === 1 && canvasId && item.dataType === 2
        ? 'public'
        : 'unknown';
  return {
    id,
    platform: 'neowow',
    title,
    author: item.authorName || author,
    cover: safeUrl(item.coverImageUrl),
    url: 'https://neowow.cn/video-works-view?id=' + encodeURIComponent(id),
    canvasId,
    canvasAccess: access,
    requiresReward: item.isReward === 1,
    fullVideo: {
      workId: id,
      name: title,
      url: safeUrl(item.videoUrl || item.previewVideoUrl || item.playUrl),
      previewUrl: safeUrl(item.coverImageUrl),
      duration: item.duration
    },
    state: 'idle',
    error: '',
    ...(item.isReward === 1 ? { note: '需赞赏授权；已有权限时可读取' } : {})
  };
}
async function readProfile(input, _fetcher, signal, onProgress = () => {}, readPage) {
  const address = profileAddress(input);
  if (!address || !readPage)
    throw new Error('请输入有效的 NeoWow 作者主页，并通过程序内网页读取。');
  return readPage({ ...address, platform: 'neowow', page: profilePage }, async (run, pause) => {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const state = await run('snapshot');
      if (state?.error) throw new Error(state.error);
      if (state?.ready) break;
      if (attempt >= 149)
        throw new Error('NeoWow 作者主页尚未加载，请显示平台页面检查网络后重试。');
      await pause(200);
    }
    const info = await run('info');
    signal?.throwIfAborted();
    if (info?.error) throw new Error(info.error);
    if (info?.userId !== address.uuid || typeof info.author !== 'string' || !info.author.trim())
      throw new Error('未读到对应的 NeoWow 作者资料，请检查主页地址。');
    const works = [],
      ids = new Set();
    let total = null,
      complete = false;
    for (let page = 1; page <= 500; page++) {
      signal?.throwIfAborted();
      const value = await run('page', page);
      signal?.throwIfAborted();
      if (value?.error) throw new Error(value.error);
      if (
        value?.userId !== address.uuid ||
        !Array.isArray(value.list) ||
        Number(value.page) !== page
      )
        throw new Error('NeoWow 作者作品分页发生变化，请重试以避免漏读。');
      if (value.total != null) {
        const count = Number(value.total);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('NeoWow 作品总数格式无效。');
        total = Math.max(total ?? 0, count);
      }
      let added = 0;
      for (const item of value.list) {
        const work = listingWork(item, info.author);
        if (ids.has(work.id)) continue;
        ids.add(work.id);
        works.push(work);
        added++;
      }
      onProgress(works.length);
      if (!value.list.length && total !== null && ids.size < total)
        throw new Error('NeoWow 作品列表提前结束，请重试以避免漏读。');
      if (
        (total !== null && ids.size >= total) ||
        (total === null && value.list.length < 20) ||
        !value.list.length
      ) {
        complete = true;
        break;
      }
      if (!added) throw new Error('NeoWow 作品列表分页没有推进，请重试。');
    }
    if (!complete) throw new Error('NeoWow 作者作品超过读取上限。');
    return {
      platform: 'neowow',
      ...address,
      author: info.author,
      avatar: safeUrl(info.avatar),
      signature: info.signature || '',
      works,
      selectedIds: []
    };
  });
}
module.exports = { profileAddress, readProfile, profilePage, listingWork };
