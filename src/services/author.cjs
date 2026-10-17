'use strict';
const { readProfile } = require('../platforms/liblib/profile.cjs');
const { namespaceResult, mergeResults, AuthorStore } = require('../author-library.cjs');
const { attachAuthorProfiles } = require('../author-profiles.cjs');
function createAuthorService({
  fetcher,
  readWork,
  cancelRead,
  publish,
  send,
  getRoot,
  getOptions,
  cache = null,
  enrichAuthor = async (profile) => profile,
  onSelection = () => {},
  defaultSelectAll = true
}) {
  let profile = null,
    records = new Map(),
    selectedIds = [],
    worker = null,
    requestedIds = null;
  let loading = false,
    controller = null,
    options = {},
    activeId = null,
    selectionCancellation = null;
  function snapshot() {
    return (
      profile && {
        ...profile,
        works: profile.works.map((w) => ({ ...w })),
        readingCanvases: Boolean(requestedIds),
        selectedIds: [...selectedIds]
      }
    );
  }
  function refresh() {
    if (!profile) return;
    const result = mergeResults(
      profile,
      new Map([...records].map(([id, r]) => [id, r.result])),
      selectedIds
    );
    const chosen = selectedIds.map((id) => records.get(id)).filter(Boolean);
    const store = new AuthorStore(getRoot(), profile, result, chosen);
    store.options = getOptions();
    if (chosen.some((r) => r.store))
      store.directory = store.authorDirectory = chosen.find((r) => r.store).store.root;
    send('author', snapshot());
    publish(result, store);
    const failed = profile.works.filter((w) => selectedIds.includes(w.id) && w.error).length;
    send('status', {
      message:
        result.authorProfile.pending && requestedIds
          ? `正在读取所选作品，尚有 ${result.authorProfile.pending} 部等待完成。`
          : failed
            ? `${failed} 部作品读取失败，请重试或取消选择失败作品。`
            : result.authorProfile.pending
              ? `已取得 ${profile.works.length} 部作品，已选择 ${selectedIds.length} 部，请点击“开始读取画布”。`
              : selectedIds.length
                ? `已读取 ${selectedIds.length} 部作品：${result.entries.length} 条提示词与文本，${result.assets.length} 个项目资产。`
                : `已读取 ${profile.author} 的 ${profile.works.length} 部作品，请选择要查看和下载的作品。`,
      phase:
        result.authorProfile.pending && requestedIds ? 'running' : failed ? 'attention' : 'done'
    });
  }
  async function drain() {
    try {
      while (profile && requestedIds) {
        const work = profile.works.find(
          (w) =>
            requestedIds.has(w.id) && selectedIds.includes(w.id) && !records.has(w.id) && !w.error
        );
        if (!work) break;
        activeId = work.id;
        work.state = 'loading';
        send('author', snapshot());
        try {
          const settings = { ...options, ...getOptions(), visible: false };
          const key = cache?.key(work, settings);
          let value = key ? await cache.get(key) : null;
          if (!value) {
            // A selection may change while reading the disk cache.
            if (!requestedIds?.has(work.id) || !selectedIds.includes(work.id)) {
              work.state = 'idle';
              continue;
            }
            value = await readWork(work.url, settings);
          }
          value = attachAuthorProfiles(value, profile.authorInfo);
          if (key) await cache.set(key, value).catch(() => {});
          const result = namespaceResult(value, work);
          records.set(work.id, { work, result, store: null });
          work.state = 'ready';
          work.error = '';
        } catch (error) {
          const changedSelection =
            error.code === 'READ_CANCELLED' && selectionCancellation === work.id;
          work.state = changedSelection ? 'idle' : 'error';
          work.error = changedSelection
            ? ''
            : error.code === 'READ_CANCELLED'
              ? '读取已停止，可点击重试。'
              : error.message;
        } finally {
          selectionCancellation = null;
          activeId = null;
          refresh();
        }
      }
    } finally {
      worker = null;
      requestedIds = null;
      refresh();
    }
  }
  function kick() {
    if (
      !worker &&
      profile?.works.some(
        (w) =>
          requestedIds?.has(w.id) && selectedIds.includes(w.id) && !records.has(w.id) && !w.error
      )
    )
      worker = drain();
  }
  async function open(input, settings = {}) {
    if (loading || worker) throw new Error('正在读取选集，请等待完成或先停止读取。');
    loading = true;
    controller = new AbortController();
    send('author-loading', true);
    try {
      let next = await readProfile(input, fetcher, controller.signal, (count) =>
        send('status', {
          message: '正在读取作者作品列表… 已取得 ' + count + ' 部',
          phase: 'running'
        })
      );
      next = await enrichAuthor(next, controller.signal);
      profile = next;
      records = new Map();
      selectedIds = defaultSelectAll ? next.works.map((work) => work.id) : [];
      options = settings;
      onSelection(next.works.filter((work) => selectedIds.includes(work.id)));
      refresh();
      return snapshot();
    } finally {
      loading = false;
      controller = null;
      send('author-loading', false);
    }
  }
  function select(ids) {
    if (loading) throw new Error('正在读取作者列表，请稍候。');
    if (
      !profile ||
      !Array.isArray(ids) ||
      ids.some((id) => !profile.works.some((w) => w.id === id))
    )
      throw new Error('选集选择无效，请重新读取作者主页。');
    selectedIds = [...new Set(ids)];
    if (requestedIds)
      for (const id of requestedIds) if (!selectedIds.includes(id)) requestedIds.delete(id);
    onSelection(profile.works.filter((work) => selectedIds.includes(work.id)));
    if (activeId && !selectedIds.includes(activeId)) {
      selectionCancellation = activeId;
      cancelRead();
    }
    refresh();
    return snapshot();
  }
  function start(settings = {}) {
    if (loading || worker) throw new Error('正在读取，请等待完成或先停止读取。');
    if (!profile || !selectedIds.length) throw new Error('请先选择要读取画布的作品。');
    options = { ...options, ...settings };
    requestedIds = new Set(selectedIds);
    for (const work of profile.works) {
      if (requestedIds.has(work.id) && !records.has(work.id)) {
        work.error = '';
        work.state = 'idle';
      }
    }
    kick();
    if (!worker) requestedIds = null;
    refresh();
    return snapshot();
  }
  function retry(id) {
    if (loading) throw new Error('正在读取作者列表，请稍候。');
    const work = profile?.works.find((w) => w.id === id);
    if (!work || !selectedIds.includes(id)) throw new Error('请先选中要重试的作品。');
    work.error = '';
    work.state = 'idle';
    requestedIds ||= new Set();
    requestedIds.add(id);
    refresh();
    kick();
    return true;
  }
  function stop() {
    requestedIds = null;
    selectionCancellation = null;
    controller?.abort();
    for (const work of profile?.works || []) {
      if (selectedIds.includes(work.id) && !records.has(work.id)) {
        work.state = 'error';
        work.error = '读取已停止，可点击重试。';
      }
    }
    if (activeId) cancelRead();
    refresh();
  }
  function clear() {
    if (worker || loading) throw new Error('请先停止读取选集。');
    profile = null;
    records = new Map();
    selectedIds = [];
    requestedIds = null;
    onSelection(null);
    send('author', null);
  }
  return {
    open,
    select,
    start,
    retry,
    stop,
    clear,
    refresh,
    snapshot,
    get active() {
      return Boolean(profile);
    },
    get reading() {
      return Boolean(worker || loading);
    },
    get listing() {
      return loading;
    }
  };
}
module.exports = { createAuthorService };
