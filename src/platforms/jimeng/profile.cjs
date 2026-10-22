'use strict';
const { profileAddress } = require('./profile-address.cjs');
const { listingWork } = require('./profile-data.cjs');
// Runs in the platform page. Use the site's own listing/navigation so its signed
// requests stay in its session. Never collect the sidebar's private canvas list.
function profilePage(action, index, parseWork) {
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const buttons = [...document.querySelectorAll('button')].filter(visible);
  const label = [...document.querySelectorAll('span,div,button,[role="tab"]')].find(
    (el) => visible(el) && el.textContent.trim() === 'AI短片' && el.children.length === 0
  );
  // The click handler and selected class live on the tab container, not its text.
  const tab = label?.closest('[role="tab"],button,[class*="item-"]') || label?.parentElement;
  const active = Boolean(
    tab &&
    (tab.getAttribute('aria-selected') === 'true' ||
      [...tab.classList].some((name) => /^active(?:-|$)/.test(name)))
  );
  if (action === 'select') {
    if (tab && !active) tab.click();
    return Boolean(tab);
  }
  const allRows = [...document.querySelectorAll('.masonry-layout-item[data-index]')].filter(
    visible
  );
  const rows = allRows.filter((el) => el.querySelector('[data-apm-action="short-video-card"]'));
  if (action === 'open') {
    if (!active) return false;
    const row = rows.find((el) => el.getAttribute('data-index') === String(index));
    const card = row?.querySelector('[class*="card-"]');
    if (card) card.click();
    return Boolean(card);
  }
  if (action === 'back') {
    const back = buttons.find(
      (el) => el.getAttribute('aria-label') === 'Back' || el.textContent.trim() === 'Back'
    );
    if (back) back.click();
    else history.back();
    return true;
  }
  if (action === 'scroll') {
    const last = rows[rows.length - 1];
    if (last) last.scrollIntoView({ block: 'end', behavior: 'instant' });
    let parent = last?.parentElement;
    while (parent && parent !== document.body) {
      if (
        parent.scrollHeight > parent.clientHeight + 5 &&
        /auto|scroll/.test(getComputedStyle(parent).overflowY)
      ) {
        parent.scrollTop = Math.min(parent.scrollHeight, parent.scrollTop + parent.clientHeight);
        return true;
      }
      parent = parent.parentElement;
    }
    window.scrollBy(0, innerHeight);
    return true;
  }
  if (action === 'detail') {
    const id = location.pathname.match(/^\/ai-tool\/work-detail\/(\d+)$/)?.[1];
    const heading = [...document.querySelectorAll('h2')].find(
      (el) => visible(el) && !/欢迎登录|即梦AI/.test(el.textContent)
    );
    if (!id || !heading) return null;
    let scope = heading.parentElement;
    while (scope && !scope.querySelector('video')) scope = scope.parentElement;
    if (!scope) return null;
    const video = [...scope.querySelectorAll('video')].find(visible);
    const title = heading.textContent.trim();
    const author =
      scope.querySelector('button[class*="author-"]')?.textContent.trim() ||
      [...scope.querySelectorAll('button')]
        .find(
          (el) =>
            visible(el) &&
            el.querySelector('img') &&
            el.textContent.trim() &&
            !/关注|登录|返回/.test(el.textContent)
        )
        ?.textContent.trim() ||
      '';
    const process = [...scope.querySelectorAll('button')].find(
      (el) =>
        visible(el) &&
        !el.disabled &&
        el.getAttribute('aria-disabled') !== 'true' &&
        /^(查看(制作|创作)过程|查看关联的画布)$/.test(el.textContent.trim())
    );
    const src = video?.currentSrc || video?.getAttribute('src') || '';
    return {
      id,
      title,
      author,
      platform: 'jimeng',
      detailReady: Boolean(video),
      url: location.href,
      cover: video?.poster || '',
      canvasAccess: process ? 'public' : 'not-public',
      fullVideo: {
        workId: id,
        name: title,
        url: /^https:\/\//.test(src) && !/\.m3u8(?:\?|$)/i.test(src) ? src : '',
        previewUrl: video?.poster || '',
        duration: Number.isFinite(video?.duration) ? video.duration : undefined
      },
      state: 'idle',
      error: ''
    };
  }
  const text = document.body?.innerText || '';
  const cards = [];
  const managers = new Set();
  const candidates = [];
  // Only ascend from public short-video rows; do not traverse the sidebar or
  // unrelated React roots. Both old and new official card layouts are supported.
  if (active && parseWork)
    for (const row of rows) {
      const card = row.querySelector('[class*="card-"]');
      let fiber =
        card?.[Object.keys(card).find((k) => k.startsWith('__reactFiber'))] ||
        row[Object.keys(row).find((k) => k.startsWith('__reactFiber'))];
      for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps || {};
        if (props.masonryViewModelManager) managers.add(props.masonryViewModelManager);
        for (const data of [props.domainModel, props.item, props.data, props.renderModel?.data])
          if (data) candidates.push({ data, index: Number(row.getAttribute('data-index')) });
      }
    }
  const keep = (data, index) => {
    const work = parseWork(data);
    if (!work) return;
    const old = cards.find((card) => card.work.id === work.id);
    if (old) {
      if (old.work.canvasAccess === 'unknown' && work.canvasAccess !== 'unknown') old.work = work;
      return;
    }
    cards.push({ work, index });
  };
  if (parseWork) {
    for (const manager of managers)
      for (const [index, entry] of (manager.data?.list || []).entries()) {
        if (entry.data?.type !== 'short-video') continue;
        try {
          keep(manager.find(entry.key, 'DomainModel') || entry.data, index);
        } catch {
          keep(entry.data, index);
        }
      }
    for (const candidate of candidates) {
      let data = candidate.data;
      if (data.type === 'short-video')
        for (const manager of managers) {
          try {
            data = manager.find(data.key, 'DomainModel') || data;
          } catch {}
        }
      keep(data, candidate.index);
      const work = parseWork(data),
        old = work && cards.find((card) => card.work.id === work.id);
      if (old) old.index ??= candidate.index;
    }
  }
  const entries = performance.getEntriesByType?.('resource') || [];
  let count = 0,
    latest = 0;
  for (const entry of entries) {
    const type = entry.initiatorType;
    if (type !== 'script' && type !== 'link' && type !== 'fetch' && type !== 'xmlhttprequest')
      continue;
    count++;
    latest = Math.max(latest, entry.responseEnd || 0);
  }
  return {
    url: location.href,
    indices: rows.map((el) => Number(el.getAttribute('data-index'))),
    active,
    tabPresent: Boolean(tab),
    cards,
    covers: Object.fromEntries(
      rows.map((el) => [
        el.getAttribute('data-index'),
        el.querySelector('img[data-apm-action="short-video-card"]')?.src || ''
      ])
    ),
    complete: /没有更多了|暂无作品|还没有发布/.test(text) && rows.length === allRows.length,
    login: /欢迎登录|请输入手机号/.test(text) && rows.length === 0,
    // Shell landmarks only. The author panel is judged separately by its tab.
    boot: {
      shell: Boolean(
        document.querySelector('nav,aside,header') ||
        (/创作/.test(text) && /探索|资产|画布/.test(text))
      ),
      ready: document.readyState === 'complete',
      resources: count + ':' + Math.round(latest)
    }
  };
}
async function readProfile(input, _fetcher, signal, onProgress = () => {}, readPage) {
  let address = profileAddress(input);
  if (!address || !readPage) throw new Error('即梦作者主页需要通过程序内平台页面读取。');
  return readPage(
    { ...address, platform: 'jimeng', page: profilePage, parseWork: listingWork },
    async (run, pause) => {
      if (address.shared) {
        for (let attempt = 0; attempt < 40; attempt++) {
          signal.throwIfAborted();
          const next = profileAddress((await run('snapshot')).url);
          if (next?.uuid) {
            address = next;
            break;
          }
          if (attempt === 39)
            throw new Error(
              '即梦分享链接未跳转到作者主页，请检查链接或使用浏览器中的完整主页地址。'
            );
          await pause(300);
        }
      }
      const works = [],
        indices = new Set(),
        ids = new Set();
      let idle = 0,
        emptySince = 0,
        waitingSince = null,
        recovered = false,
        waitPhase = '',
        quietSince = null,
        seenResources = null;
      // DOM-ready only promises the application shell. Reload once the shell is
      // painted and script/API traffic has been quiet, so a stuck cold start
      // does not sit through a fixed delay. In-flight requests keep waiting.
      const startupDeadline = Date.now() + 60000;
      const shellIdle = (state) => {
        const boot = state.boot;
        if (!boot?.shell || boot.ready !== true || boot.pending) {
          quietSince = null;
          return false;
        }
        if (boot.resources !== seenResources) {
          seenResources = boot.resources;
          quietSince = Date.now();
          return false;
        }
        quietSince ??= Date.now();
        return Date.now() - quietSince >= 1500;
      };
      for (let step = 0; step < 3000; step++) {
        signal.throwIfAborted();
        const state = await run('snapshot');
        if (!state.active) {
          const phase = state.tabPresent === false ? 'initializing' : 'selecting';
          if (waitPhase !== phase) {
            waitPhase = phase;
            waitingSince = Date.now();
            quietSince = null;
            seenResources = null;
            onProgress(
              works.length,
              phase === 'initializing'
                ? '正在等待即梦作者主页初始化，首次打开可能需要加载页面组件…'
                : '作者栏目已出现，正在切换并确认“AI短片”…'
            );
          }
          if (
            (Date.now() >= startupDeadline && !works.length) ||
            Date.now() - waitingSince >= (recovered ? 45000 : works.length ? 20000 : 60000)
          )
            throw new Error(
              (phase === 'initializing'
                ? '即梦作者主页尚未完成初始化。'
                : '未能进入即梦作者主页的“AI短片”栏目。') +
                (recovered ? '已自动重新加载一次，' : '') +
                '请显示平台页面检查网络后重试。'
            );
          const firstLoadStuck =
            !works.length &&
            !recovered &&
            (phase === 'initializing'
              ? shellIdle(state) || Date.now() - waitingSince >= 15000
              : Date.now() - waitingSince >= 15000);
          if (firstLoadStuck) {
            recovered = true;
            onProgress(0, '即梦作者主页尚未完成首次加载，正在自动重新加载一次并继续读取…');
            await run('reload');
            signal.throwIfAborted();
            waitingSince = Date.now();
            waitPhase = '';
            quietSince = null;
            seenResources = null;
            continue;
          }
          if (state.tabPresent !== false) await run('select');
          await pause(500);
          continue;
        }
        waitingSince = null;
        waitPhase = '';
        for (const card of state.cards || []) {
          const work = card.work;
          if (
            work.canvasAccess === 'unknown' ||
            (work.canvasAccess === 'public' && !work.fullVideo?.url)
          )
            continue;
          if (card.index != null) indices.add(card.index);
          if (!ids.has(work.id)) {
            if (work.canvasAccess === 'not-public')
              work.note = work.fullVideo?.url
                ? '画布未公开，仅可下载作品视频'
                : '画布未公开，作品视频暂不可下载';
            works.push(work);
            ids.add(work.id);
            onProgress(works.length);
          }
        }
        const index = state.indices.find((value) => !indices.has(value));
        if (index !== undefined) {
          emptySince = 0;
          if (!(await run('open', index))) throw new Error('即梦作品列表已变化，请重新读取。');
          let work,
            signature = '',
            stable = 0;
          for (let attempt = 0; attempt < 35; attempt++) {
            await pause(300);
            const next = await run('detail');
            const key =
              next && JSON.stringify([next.id, next.title, next.fullVideo.url, next.canvasAccess]);
            stable = key && key === signature ? stable + 1 : 0;
            signature = key;
            if (
              next &&
              (next.detailReady || next.fullVideo.url || next.canvasAccess === 'public') &&
              stable >= 7
            ) {
              work = next;
              break;
            }
          }
          if (!work) throw new Error('即梦作品详情尚未完整加载，请检查网络或登录后重试。');
          const listed = state.cards?.find((card) => card.work.id === work.id)?.work;
          work.fullVideo.url ||= listed?.fullVideo?.url || '';
          work.cover ||= state.covers?.[index] || '';
          work.fullVideo.previewUrl ||= work.cover;
          if (work.canvasAccess === 'not-public')
            work.note = work.fullVideo.url
              ? '画布未公开，仅可下载作品视频'
              : '画布未公开，作品视频暂不可下载';
          if (!ids.has(work.id)) {
            works.push(work);
            ids.add(work.id);
            onProgress(works.length);
          }
          indices.add(index);
          idle = 0;
          await run('back');
          for (let attempt = 0; attempt < 35; attempt++) {
            await pause(200);
            if ((await run('snapshot')).url.startsWith(address.url)) break;
            if (attempt === 34) throw new Error('无法返回即梦作者主页。');
          }
        } else if (state.complete && !(state.cards || []).some((card) => !ids.has(card.work.id))) {
          // A tab can be marked active before its request replaces an old empty view.
          if (!works.length) {
            emptySince ||= Date.now();
            if (Date.now() - emptySince < 1500) {
              await pause(500);
              continue;
            }
          }
          return {
            platform: 'jimeng',
            ...address,
            author: works[0]?.author || '即梦作者',
            avatar: works[0]?.avatar || '',
            works,
            selectedIds: []
          };
        } else {
          emptySince = 0;
          await run('scroll');
          await pause(500);
          if (++idle > 40) throw new Error('即梦作品列表未完成加载，已停止以避免漏读。');
        }
      }
      throw new Error('即梦作者作品超过读取上限。');
    }
  );
}
module.exports = { profileAddress, profilePage, readProfile };
