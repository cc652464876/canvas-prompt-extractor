'use strict';
const { readProfile } = require('../platforms/profiles.cjs');
const { namespaceResult, mergeResults, AuthorStore } = require('../author-library.cjs');
const { attachAuthorProfiles } = require('../author-profiles.cjs');
const { publishedWork } = require('../published-work.cjs');
const { ProjectStore } = require('../project-store.cjs');
const { contentFingerprint } = require('../project-identity.cjs');
const { resolveAuthorDirectory } = require('../project-files.cjs');
const path = require('node:path');
function createAuthorService({
  fetcher,
  readProfilePage,
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
  async function restoreColorTags(result, author = profile) {
    const directory = await resolveAuthorDirectory(getRoot(), author, { createRoot: false });
    await new ProjectStore(directory).restoreColorTags(result);
  }
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
  function refresh({ assetsOnly = false } = {}) {
    if (!profile) return;
    const result = mergeResults(
      profile,
      new Map([...records].map(([id, r]) => [id, r.result])),
      selectedIds
    );
    const chosen = selectedIds.map((id) => records.get(id)).filter(Boolean);
    const store = new AuthorStore(getRoot(), profile, result, chosen);
    if (profile.localProject) {
      result.localProject = true;
      store.directory = store.authorDirectory = profile.directory;
    }
    store.options = getOptions();
    if (chosen.some((r) => r.store))
      store.directory = store.authorDirectory = chosen.find((r) => r.store).store.root;
    if (assetsOnly) {
      send('assets', result.assets);
      send('project', store.summary());
      return;
    }
    send('author', snapshot());
    publish(result, store);
    const failed = profile.works.filter((w) => selectedIds.includes(w.id) && w.error).length;
    send('status', {
      message: profile.localProject
        ? `本地作者选集已打开：共 ${profile.works.length} 部，已选择 ${selectedIds.length} 部${failed ? '，其中 ' + failed + ' 部本地记录不可用' : ''}。`
        : result.authorProfile.pending && requestedIds
          ? `正在读取所选作品，尚有 ${result.authorProfile.pending} 部等待完成。`
          : failed
            ? `${failed} 部作品读取失败，请重试或取消选择失败作品。`
            : result.authorProfile.pending
              ? `已取得 ${profile.works.length} 部作品，已选择 ${selectedIds.length} 部，请点击“开始读取画布”。`
              : selectedIds.length
                ? `已读取 ${selectedIds.length} 部作品：${result.entries.length} 条提示词与文本，${result.assets.length} 个项目资产。`
                : !profile.works.length && profile.platform === 'jimeng'
                  ? '即梦“AI短片”栏目当前返回 0 部作品。结果以平台实际返回内容为准，登录状态可能影响列表。'
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
          const settings = { ...options, ...getOptions(), visible: false, workHint: work };
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
          value = {
            ...value,
            metadata: {
              ...value.metadata,
              title: work.title,
              author: value.metadata.author || profile.author,
              workInfo: {
                ...value.metadata.workInfo,
                authorUrl: value.metadata.workInfo?.authorUrl || profile.url
              }
            }
          };
          if (key) await cache.set(key, value).catch(() => {});
          const result = namespaceResult(value, work);
          await restoreColorTags(result);
          work.canvasAccess = result.metadata.canvasAccess || 'public';
          work.note = result.metadata.canvasNote || '';
          work.videoAvailable = result.assets.some(
            (asset) => asset.role === 'full-video' && asset.url
          );
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
      let next = await readProfile(
        input,
        fetcher,
        controller.signal,
        (count, message) =>
          send('status', {
            message: message || '正在读取作者作品列表… 已取得 ' + count + ' 部',
            phase: 'running'
          }),
        (address, read) => readProfilePage(address, read, controller.signal)
      );
      next = await enrichAuthor(next, controller.signal);
      controller.signal.throwIfAborted();
      profile = next;
      records = new Map();
      for (const work of next.works) {
        if (work.canvasAccess !== 'not-public') continue;
        const value = attachAuthorProfiles(
          publishedWork({
            platform: next.platform,
            inputUrl: work.url,
            resolvedUrl: work.url,
            title: work.title,
            author: next.author,
            workId: work.id,
            fullVideo: work.fullVideo,
            workInfo: { authorUrl: next.url }
          }),
          next.authorInfo
        );
        const result = namespaceResult(value, work);
        await restoreColorTags(result, next);
        records.set(work.id, { work, result, store: null });
        work.state = 'ready';
        work.note = value.metadata.canvasNote;
        work.videoAvailable = value.assets.some(
          (asset) => asset.role === 'full-video' && asset.url
        );
      }
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
    onSelection(
      profile.localProject ? [] : profile.works.filter((work) => selectedIds.includes(work.id))
    );
    if (activeId && !selectedIds.includes(activeId)) {
      selectionCancellation = activeId;
      cancelRead();
    }
    refresh();
    return snapshot();
  }
  function start(settings = {}) {
    if (profile?.localProject)
      throw new Error('本地选集仅查看已保存数据，请通过作者主页读取在线作品。');
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
  function checkUpdates(settings = {}) {
    if (!profile?.localProject) throw new Error('请先打开本地作品集。');
    if (loading || worker) throw new Error('正在读取，请先等待或停止。');
    if (!selectedIds.length) throw new Error('请先选择要检测的作品。');
    requestedIds = new Set(selectedIds);
    const checkedIds = [...requestedIds];
    worker = (async () => {
      let changed = 0,
        failed = 0,
        checked = 0;
      try {
        for (const id of checkedIds) {
          if (!requestedIds?.has(id)) continue;
          const old = records.get(id);
          const work = profile.works.find((w) => w.id === id);
          if (!work?.url || !old?.store) {
            failed++;
            continue;
          }
          activeId = id;
          work.state = 'loading';
          work.error = '';
          send('author', snapshot());
          try {
            const value = await readWork(work.url, {
              ...options,
              ...getOptions(),
              ...settings,
              visible: false,
              forceRead: true,
              workHint: work
            });
            if (!requestedIds?.has(id)) break;
            if (
              value.metadata.canvasAccess === 'not-public' &&
              old.result.metadata.canvasAccess !== 'not-public'
            )
              throw new Error('线上画布已不可访问');
            const result = namespaceResult(attachAuthorProfiles(value, profile.authorInfo), work);
            result.metadata.authorWorkCount = old.result.metadata.authorWorkCount;
            const different = contentFingerprint(old.result) !== contentFingerprint(result);
            const project = new ProjectStore(path.dirname(old.store.directory), {
              folderName: path.basename(old.store.directory)
            });
            await project.create(result, old.store.options, false);
            records.set(id, { work, result, store: project });
            work.canvasAccess = result.metadata.canvasAccess || 'public';
            work.note = different
              ? '检测到画布更新，可保存提示词并下载新增或变化素材'
              : '画布内容无变化';
            work.updateState = different ? 'changed' : 'unchanged';
            work.state = 'ready';
            checked++;
            if (different) changed++;
          } catch (error) {
            if (!requestedIds) break;
            work.state = 'error';
            work.error = '检查失败，已保留本地内容：' + error.message;
            failed++;
          } finally {
            if (work.state === 'loading') work.state = 'ready';
            activeId = null;
            refresh();
          }
        }
      } finally {
        const cancelled = !requestedIds;
        worker = null;
        requestedIds = null;
        refresh();
        send('status', {
          message: `画布更新检测${cancelled ? '已停止' : '完成'}：已检查 ${checked} 部，${changed} 部有更新${failed ? '，' + failed + ' 部检查失败，已保留本地内容' : ''}。`,
          phase: failed ? 'attention' : 'done'
        });
      }
    })();
    return snapshot();
  }
  function retry(id) {
    if (profile?.localProject) throw new Error('请补齐本地作品文件后重新打开作者索引。');
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
    openLocal(loaded) {
      if (worker || loading) throw new Error('请先停止读取选集。');
      profile = loaded.profile;
      records = loaded.records;
      selectedIds = [...profile.selectedIds];
      requestedIds = null;
      onSelection([]);
      refresh();
      return snapshot();
    },
    select,
    start,
    checkUpdates,
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
