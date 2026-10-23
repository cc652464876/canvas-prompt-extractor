import { createAuthorControls } from './author-controls.js';
import { profileAddress as jimengProfileAddress } from '../platforms/jimeng/profile-address.cjs';
import { createAccountControls } from './account-controls.js';
import { createThemeManager } from './theme-manager.js';
import { createTypographyManager } from './typography-manager.js';
import {
  TYPES,
  MEDIA,
  SOURCE,
  promptKind,
  contentSummary,
  boardAssets,
  downloadMetrics,
  filtered,
  imageBrandQuery,
  countKinds,
  downloadState,
  pageSize,
  READ_LAYOUTS,
  readingLayout,
  textColumns,
  normalizeDensity,
  snapHeight
} from './view-model.js';
import {
  attachThumbnail,
  resetThumbnailJobs,
  prepareVideoThumbnails,
  clearVideoThumbnails,
  bindVideoPoster
} from './thumbnails.js';
import {
  bindSmallPreview,
  bindMagnifier,
  conditionalTitle,
  initMediaDialog,
  bindScrollArrow,
  openMediaPreview,
  closeMediaPreview,
  hideHoverPreview
} from './interactions.js';
import { readerTarget, referencingEntries } from './reader-targets.js';
import { promptReferenceLabel, promptReferenceTokens } from './prompt-display.js';
import { createImageInfoDialog, createReaderImageInfo } from './image-info.js';
import { createPromptDialog, promptWindowButton } from './prompt-dialog.js';
import { createMarkdownText } from './markdown-text.js';
const $ = (id) => document.getElementById(id);
const imageInfoDialog = createImageInfoDialog();
const promptDialog = createPromptDialog({ getTypography: () => promptTypography.get() });
window.addEventListener('image-info-updated', (event) => {
  for (const record of readers) record.imageInfo?.update(event.detail);
});
let result = null,
  busy = false,
  visible = false,
  scope = 'prompts',
  page = 0,
  columns = 5,
  downloads = null,
  project = null,
  assetMap = new Map(),
  saveTimer,
  renderTimer;
let author = null,
  authorLoading = false;
const authorControls = createAuthorControls({
  getColumns: () => columns,
  getReadLocked: () => busy || downloads?.active,
  getLocked: () => saving || authorLoading || downloadStarting || browserResetting || localOpening,
  onRead: async (reading) => {
    try {
      const response = reading ? await window.lab.cancel() : await window.lab.readWorks(options());
      if (!response.ok) status(response.error, 'error');
    } catch (error) {
      status(error.message, 'error');
    }
  },
  onError: (message) => status(message, 'error')
});
function syncAuthorViews() {
  const enabled = Boolean(author);
  document.body.classList.toggle('author-mode', enabled);
  $('works-toggle').hidden = !enabled;
  if (enabled) {
    $('board-toggle').textContent = '展开看板';
    pressed($('board-toggle'), !$('board-body').hidden);
    pressed($('works-toggle'), !$('author-works').hidden);
    $('works-toggle').setAttribute('aria-expanded', String(!$('author-works').hidden));
    $('board-toggle').setAttribute('aria-expanded', String(!$('board-body').hidden));
  } else {
    $('board-toggle').textContent = $('board-body').hidden ? '展开看板' : '收起看板';
    $('board-toggle').classList.remove('active');
    $('board-toggle').removeAttribute('aria-pressed');
  }
  $('folder').textContent = enabled ? '打开作者文件夹' : '打开项目文件夹';
  $('author-selection-status').hidden = !enabled;
  if (enabled) {
    const failed = author.works.filter((w) => author.selectedIds.includes(w.id) && w.error).length;
    const pending = result?.authorProfile?.pending || 0;
    $('author-selection-status').textContent =
      pending && author.readingCanvases
        ? `正在读取 ${pending} 部所选作品，统计随读取完成更新。`
        : pending
          ? `已选择 ${author.selectedIds.length} 部作品，其中 ${pending} 部尚未读取画布；点击“开始读取画布”继续。`
          : failed
            ? `${failed} 部作品读取失败，请重试或取消选择失败作品。`
            : author.selectedIds.length
              ? `已选择 ${author.selectedIds.length} 部作品；提示词与素材按作品分别保存。`
              : '尚未选择作品，请在下方选集中选择。';
  }
}
const loginBusy = new Set();
let allWebsitesOpening = false;
const accountControls = createAccountControls($('platform-shortcuts'), async (p) => {
  if (loginBusy.has(p)) return;
  loginBusy.add(p);
  updateButtons();
  try {
    const r = await window.lab.login(p);
    $('browser-access-status').textContent = r.ok
      ? '已打开独立访问窗口，可直接登录或浏览。'
      : r.error;
  } finally {
    loginBusy.delete(p);
    updateButtons();
  }
});
let activeTaskId = 0;
let saving = false,
  downloadStarting = false,
  browserResetting = false,
  localOpening = false;
let preferredLayout = 'side',
  effectiveLayout = 'side',
  readers = [],
  focusedReader = null,
  resizeTimer;
const filters = { prompts: new Set(Object.keys(TYPES)), assets: new Set(Object.keys(MEDIA)) };
const heights = new Map(),
  readerElements = new Map();
function el(tag, text = '', className = '') {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}
function action(text, fn, opts = {}) {
  const b = el('button', text, opts.quiet ? 'quiet' : '');
  b.type = 'button';
  if (opts.icon) b.prepend(icon(opts.icon));
  b.addEventListener('click', fn);
  return b;
}
function pressed(button, active) {
  button.classList.toggle('active', Boolean(active));
  button.setAttribute('aria-pressed', String(Boolean(active)));
}
function icon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon', 'icon-' + type);
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute(
    'd',
    {
      image: 'M3 4h18v16H3z M4 17l5-6 4 4 3-3 5 6 M16 8h.01',
      video: 'M3 6h13v12H3z M16 10l5-3v10l-5-3',
      audio: 'M4 10h4l5-5v14l-5-5H4z M16 8q6 4 0 8 M18 5q10 7 0 14',
      text: 'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6',
      folder: 'M3 6h7l2 2h9v12H3z',
      left: 'M15 5l-7 7 7 7',
      right: 'M9 5l7 7-7 7',
      close: 'M6 6l12 12 M18 6L6 18'
    }[type] || 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5'
  );
  svg.append(shape);
  return svg;
}
function onlinePreview() {
  return mode() === 'full' && !result?.localProject;
}
function mode() {
  return $('mode').value === 'full' ? 'full' : 'simple';
}
function selected() {
  return [...$('export-types').querySelectorAll('input')]
    .filter((c) => c.checked)
    .map((c) => c.dataset.kind);
}
function mediaSelected() {
  return [...$('download-types').querySelectorAll('input')]
    .filter((c) => c.checked)
    .map((c) => c.dataset.kind);
}
function options() {
  return { kinds: selected(), split: $('split').checked, mode: mode() };
}
function status(message, phase = 'running') {
  $('status').textContent = message;
  $('status').dataset.phase = phase;
  if (
    ['error', 'cancelled'].includes(phase) &&
    !result &&
    $('entries').querySelector('.loading-canvas')
  ) {
    $('entries').replaceChildren(el('div', message, 'empty-state'));
    $('project-name').textContent = phase === 'cancelled' ? '读取已停止' : '读取未完成';
  }
}
function syncProfileNote() {
  $('jimeng-profile-note').hidden = !jimengProfileAddress($('url').value);
}
$('url').addEventListener('input', syncProfileNote);
function checkbox(root, key, label, onChange) {
  const wrapper = el('label'),
    input = el('input');
  input.type = 'checkbox';
  input.dataset.kind = key;
  input.checked = true;
  const count = el('span', '0', 'mini-count');
  count.id = (root === 'export-types' ? 'export-count-' : 'media-count-') + key;
  wrapper.append(input, document.createTextNode(label), count);
  $(root).append(wrapper);
  input.addEventListener('change', onChange);
  return wrapper;
}
for (const [k, label] of Object.entries(TYPES))
  checkbox('export-types', k, label, () => updateButtons());
for (const k of ['video', 'image', 'audio']) {
  const row = el('div', '', 'download-row');
  row.dataset.kind = k;
  const label = checkbox('download-types', k, MEDIA[k], () => {
    refreshDownload();
    updateButtons();
  });
  row.append(label);
  const track = el('div', '', 'progress-track');
  track.id = 'progress-' + k;
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', MEDIA[k] + '下载进度');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', '0');
  track.append(el('span', '', 'progress-fill'));
  const metrics = el('div', '', 'download-metrics');
  metrics.append(el('span', '0 / 0', 'download-count'), el('span', '0 KB/s', 'download-speed'));
  row.append(track, metrics);
  $('download-types').append(row);
}
function safeName(s, fallback) {
  return (
    String(s || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '') || fallback
  ).slice(0, 70);
}
function filename() {
  if (author) return [author.platform, safeName(author.author, '未知作者')].join('_');
  return [
    result?.metadata.platform || '平台',
    safeName(result?.metadata.author, '未知作者'),
    safeName(String(result?.metadata.title || '').replace(/^《(.*)》$/, '$1'), '未命名作品')
  ].join('_');
}
async function saveNow() {
  if (saving) {
    const r = await window.lab.stopSave();
    if (!r.ok) status(r.error, 'error');
    return false;
  }
  if (busy || downloads?.active || downloadStarting || !result) return false;
  if (!selected().length) {
    $('saved').textContent = '请至少勾选一种提示词类别。';
    return false;
  }
  saving = true;
  updateButtons();
  $('saved').dataset.phase = 'running';
  $('saved').textContent = '正在保存提示词…';
  try {
    const r = await window.lab.save(options());
    if (!r.ok) throw new Error(r.error);
    $('saved').textContent =
      (r.value.cancelled ? '已停止保存；已完成文件保留：' : '已保存：') +
      (r.value.savedDocuments.join('；') || '本次没有完成文件');
    $('saved').dataset.phase = 'done';
    return true;
  } catch (e) {
    $('saved').textContent = '保存失败：' + e.message;
    $('saved').dataset.phase = 'error';
    return false;
  } finally {
    saving = false;
    updateButtons();
  }
}
function syncMode() {
  $('mode-label').textContent = mode() === 'full' ? '全能模式' : '轻量模式';
  $('mode-toggle').textContent = mode() === 'full' ? '轻量模式' : '全能模式';
  $('download-strip').hidden = mode() !== 'full';
  $('mode-hint').textContent =
    mode() === 'full' ? '全能模式支持在线预览和素材下载。' : '轻量模式仅显示已有本地预览。';
}
function updateButtons() {
  const authorFailed = Boolean(
    author?.works.some((w) => author.selectedIds.includes(w.id) && w.error)
  );
  const active = downloads?.active,
    locked =
      busy ||
      authorLoading ||
      saving ||
      active ||
      downloadStarting ||
      browserResetting ||
      localOpening;
  $('start').disabled =
    saving ||
    active ||
    downloadStarting ||
    browserResetting ||
    localOpening ||
    Boolean(author?.readingCanvases);
  $('start').textContent =
    (busy && !author?.readingCanvases) || authorLoading ? '停止读取' : '开始读取网页';
  for (const id of ['directory', 'mode-toggle']) $(id).disabled = locked;
  $('directory').disabled = locked || Boolean(project?.directory);
  $('directory').title = project?.directory
    ? '当前项目已建立；下一个项目首次保存前可更换位置。'
    : '';
  $('visibility').disabled = browserResetting || localOpening;
  accountControls.setLocked(browserResetting || localOpening || allWebsitesOpening, loginBusy);
  $('browser-login-all').disabled =
    browserResetting || localOpening || allWebsitesOpening || loginBusy.size > 0;
  $('browser-login-all').setAttribute('aria-busy', String(allWebsitesOpening));
  $('browser-search').disabled = browserResetting || localOpening;
  for (const button of document.querySelectorAll('[data-social-login],[data-browser-login]'))
    button.disabled = browserResetting || localOpening || allWebsitesOpening;
  for (const c of $('export-types').querySelectorAll('input')) c.disabled = locked;
  $('split').disabled = locked;
  for (const c of $('download-types').querySelectorAll('input')) c.disabled = locked;
  $('url').disabled = busy || authorLoading;
  $('save-prompts').disabled =
    busy ||
    authorLoading ||
    active ||
    downloadStarting ||
    browserResetting ||
    localOpening ||
    !result ||
    !selected().length ||
    authorFailed ||
    Boolean(result?.authorProfile?.pending) ||
    !result?.entries.length;
  const workCount = author ? author.selectedIds.length : result ? 1 : 0;
  $('save-prompts').textContent = saving ? '停止保存' : `保存提示词（${workCount}）`;
  $('download').disabled =
    busy ||
    authorLoading ||
    saving ||
    downloadStarting ||
    browserResetting ||
    localOpening ||
    !result ||
    !mediaSelected().length ||
    (!active &&
      (authorFailed ||
        Boolean(result?.authorProfile?.pending) ||
        !result?.assets.some((a) => a.url || a.state === 'done')));
  $('retry').disabled =
    locked || !result?.assets.some((a) => a.state === 'failed' && mediaSelected().includes(a.kind));
  $('resume-download').hidden = !active || !downloads?.paused;
  $('open-local-project').disabled = locked;
  $('open-canvas').disabled =
    localOpening ||
    authorLoading ||
    (author
      ? !author.works.some(
          (w) => author.selectedIds.includes(w.id) && w.canvasAccess !== 'not-public'
        )
      : !result || result.metadata.canvasAccess === 'not-public');
  $('open-local-project').textContent = localOpening ? '正在打开…' : '打开本地项目';
  $('open-local-project').setAttribute('aria-busy', String(localOpening));
  $('local-project-path').disabled = locked;
  const reset = $('browser-reset');
  reset.disabled = locked || loginBusy.size > 0 || allWebsitesOpening;
  reset.textContent = browserResetting ? '正在重置…' : '清理缓存，恢复浏览器初始状态';
  reset.setAttribute('aria-busy', String(browserResetting));
  reset.title = reset.disabled && !browserResetting ? '请先结束当前任务，再重置浏览器。' : '';
  syncMode();
  syncAuthorViews();
  authorControls.render();
  for (const node of readerElements.values()) {
    const a = assetMap.get(node.dataset.currentAsset),
      b = node.querySelector('.download-one'),
      record = readers.find((record) => record.key === node.dataset.key),
      text = itemFor(record || {}),
      isText = record?.scope === 'prompts' && text?.kind === 'text';
    record?.imageInfo?.setAsset(a);
    const locate = node.querySelector('.reader-locate'),
      hasLocation = isText ? Boolean(record.textFileSaved) : a?.state === 'done';
    if (locate) locate.hidden = !hasLocation;
    node.querySelector('.detail-actions')?.classList.toggle('has-file-location', hasLocation);
    if (b) {
      if (isText) {
        b.disabled = locked || !text.prompt?.trim() || hasLocation;
        b.textContent = hasLocation ? '已下载' : '下载文本';
        continue;
      }
      b.disabled = locked || !a || a.state === 'done' || mode() !== 'full';
      b.textContent =
        a?.state === 'done' ? '已下载' : a?.state === 'downloading' ? '下载中' : '下载素材';
    }
  }
  for (const player of document.querySelectorAll('video[data-asset-id],audio[data-asset-id]'))
    preparePlayer(player, assetMap.get(player.dataset.assetId));
}

function sourceUrl(a) {
  return `labmedia://${a.state === 'done' ? 'local' : 'stream'}/${a.id}`;
}
function preparePlayer(player, asset) {
  if (!asset || player.getAttribute('src') || (!onlinePreview() && asset.state !== 'done')) return;
  player.preload = 'metadata';
  player.src = sourceUrl(asset);
}
function mediaState(a) {
  if (result?.localProject && a?.error === '本地文件缺失或不完整') return '本地文件缺失或不完整';
  if (result?.localProject && a?.state !== 'done') return '未下载';
  return (
    {
      done: '已保存到本地',
      pending: '未保存到本地',
      downloading: '下载中',
      failed: '下载失败',
      unavailable: '地址不可用'
    }[a?.state] || '待下载'
  );
}
function bytes(n) {
  return n >= 1048576
    ? (n / 1048576).toFixed(1) + ' MB'
    : n >= 1024
      ? (n / 1024).toFixed(0) + ' KB'
      : (n || 0) + ' B';
}
async function reveal(a) {
  if (!a) return;
  const r =
    a.kind === 'text' ? await window.lab.textFile(a.nodeId, true) : await window.lab.reveal(a.id);
  if (!r.ok) {
    if (a.kind === 'text') {
      for (const record of readers) if (record.nodeId === a.nodeId) record.textFileSaved = false;
      updateButtons();
    }
    status(r.error, 'attention');
  }
}
function bindHover(container, image, a, context, options) {
  bindSmallPreview(container, image, a, context, options);
}
function thumbnailCover(a, item) {
  const cover = el('div', '', 'cover');
  if (!a) {
    cover.append(
      el(
        'div',
        item.prompt?.slice(0, 400) || item.referenceTexts?.[0]?.text?.slice(0, 400) || '文本节点',
        'text-snippet'
      )
    );
    if (item.kind === 'text') {
      const preview = action('预览', () => openMediaPreview(item, { scope: 'prompts', item }));
      preview.className = 'preview-media';
      preview.setAttribute('aria-label', '预览 ' + item.name);
      cover.append(preview);
    }
    return cover;
  }
  const fallback = el('div', '', 'placeholder');
  fallback.append(
    icon(a.kind),
    el('span', a.kind === 'video' ? '视频预览' : a.kind === 'audio' ? '音频素材' : '图片预览')
  );
  cover.append(fallback);
  const image = attachThumbnail(cover, a, { full: onlinePreview() });
  bindHover(cover, image, a, { scope, item });
  const badge = el('span', a.role === 'full-video' ? '完整视频' : MEDIA[a.kind], 'asset-kind');
  badge.prepend(icon(a.kind));
  cover.append(badge);
  if (a.kind === 'video') cover.append(el('span', '▶', 'play-mark'));
  if (item.outputAssetIds?.length > 1)
    cover.append(el('span', item.outputAssetIds.length + ' 个结果', 'output-count'));
  return cover;
}
function keyOf(s, item, nodeId) {
  return readerTarget(result, s, item, nodeId).key;
}
function itemFor(record) {
  return (record.scope === 'assets' ? result?.assets : result?.entries)?.find(
    (i) => (record.scope === 'assets' ? i.id : i.nodeId) === record.id
  );
}
function card(item) {
  const isAsset = scope === 'assets',
    a = isAsset ? item : item.outputAssetIds?.map((id) => assetMap.get(id)).find(Boolean),
    readerKey = keyOf(scope, item),
    key = scope + ':' + (isAsset ? item.id : item.nodeId),
    c = el('article', '', 'content-card');
  if (isAsset && item.role === 'full-video') c.classList.add('full-video');
  c.dataset.key = key;
  c.dataset.readerKey = readerKey;
  c.dataset.kind = item.kind;
  if (item.kind === 'text') bindTextPreview(c, item);
  c.setAttribute('aria-label', item.name + '，打开到阅读区');
  c.setAttribute('aria-controls', 'reading-board');
  pressed(
    c,
    readers.some((r) => r.key === readerKey)
  );
  if (columns > 0) c.append(thumbnailCover(a, item));
  const body = el('div', '', 'card-body');
  const name = action(item.name, () => openReader(scope, item), { quiet: true });
  name.className = 'card-heading';
  conditionalTitle(name);
  body.append(
    name,
    el(
      'span',
      isAsset
        ? SOURCE[item.source] + ' · ' + MEDIA[item.kind]
        : TYPES[promptKind(item.kind)] + ' · ' + (item.model || '模型未读取'),
      'card-subheading'
    )
  );
  c.append(body);
  if (columns > 0) {
    const foot = el('div', '', 'card-footer');
    const size = a?.state === 'done' ? a.bytes : a?.total;
    const chars = isAsset
      ? result.entries.filter(
          (e) =>
            e.outputAssetIds?.includes(a.id) || e.references.some((r) => r.assetIds?.includes(a.id))
        ).length + ' 条关联'
      : Array.from(item.prompt || '').filter((ch) => ch !== '\n' && ch !== '\r').length + ' 字符';
    foot.append(
      el('span', size ? bytes(size) : a ? '大小未知' : '无媒体', 'file-size'),
      el('span', chars, 'prompt-count')
    );
    c.append(foot);
  }
  if (columns === 0)
    c.addEventListener('click', (e) => {
      if (!e.target.closest('button')) openReader(scope, item);
    });
  return c;
}
function refreshBoardSelection() {
  for (const c of $('entries').querySelectorAll('.content-card'))
    pressed(
      c,
      readers.some((r) => r.key === c.dataset.readerKey)
    );
}
function focusRecord(record) {
  focusedReader = record.key;
  for (const [key, element] of readerElements)
    element.classList.toggle('focused', key === record.key);
  const d = readerElements.get(record.key);
  requestAnimationFrame(() => {
    d?.focus({ preventScroll: true });
    if (d) d.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}
function openReader(s, item, nodeId, assetId) {
  if (s === 'assets' && !assetId) assetId = item.id;
  const target = readerTarget(result, s, item, nodeId);
  s = target.scope;
  item = target.item;
  const key = target.key;
  let record = readers.find((r) => r.key === key);
  if (!record) {
    const left = readers.filter((r) => r.column !== 1).length,
      right = readers.filter((r) => r.column === 1).length;
    const output = Math.max(0, item.outputAssetIds?.indexOf(assetId) ?? 0);
    record = {
      key,
      id: s === 'assets' ? item.id : item.nodeId,
      nodeId: target.nodeId,
      scope: s,
      collapsed: false,
      output,
      column: left <= right ? 0 : 1
    };
    readers.push(record);
    readerElements.set(key, detail(item, record));
    placeReaders();
  } else if (record.collapsed) {
    record.collapsed = false;
    updateCollapsed(record);
  }
  record.selectAsset?.(assetId);
  refreshBoardSelection();
  focusRecord(record);
}
function enterPreviewReader(asset, context) {
  promptDialog.close();
  if (asset.kind === 'text') {
    openReader('prompts', asset);
    return;
  }
  if (context?.scope === 'prompts')
    openReader('prompts', context.item, context.item.nodeId, asset.id);
  else openReader('assets', asset, context?.nodeId, asset.id);
}
function disposeReader(record) {
  promptDialog.closeFor(record.key);
  record.dispose?.();
  record.dispose = null;
  record.showOutput = null;
  record.selectAsset = null;
  record.imageInfo?.dispose();
  record.imageInfo = null;
}
function removeReader(record) {
  disposeReader(record);
  const node = readerElements.get(record.key);
  if (node) {
    stopIn(node);
    node.remove();
  }
  readerElements.delete(record.key);
  heights.delete(record.key);
  readers = readers.filter((r) => r !== record);
  if (focusedReader === record.key) focusedReader = null;
  placeReaders();
  refreshBoardSelection();
}
async function downloadOne(record) {
  const entry = itemFor(record);
  if (record.scope === 'prompts' && entry?.kind === 'text') {
    if (busy || saving || downloads?.active || downloadStarting || browserResetting || localOpening)
      return;
    saving = true;
    updateButtons();
    try {
      const response = await window.lab.saveText(entry.nodeId);
      if (response.ok) record.textFileSaved = true;
      status(
        response.ok ? '已保存文本：' + response.value.savedText : response.error,
        response.ok ? 'done' : 'error'
      );
    } catch (error) {
      status(error.message, 'error');
    } finally {
      saving = false;
      updateButtons();
    }
    return;
  }
  const a = assetMap.get(readerElements.get(record.key)?.dataset.currentAsset);
  if (!a) return;
  if (mode() !== 'full') {
    status('请切换全能模式后保存素材到本地。', 'attention');
    return;
  }
  if (downloads?.active) {
    status('请等待当前下载完成。', 'attention');
    return;
  }
  await requestDownload({ kinds: [a.kind], ids: [a.id] });
}
function stopIn(node, unload = true) {
  for (const p of node.querySelectorAll('video,audio')) {
    p.pause();
    if (unload) {
      p.removeAttribute('src');
      p.load();
    }
  }
}
function clearReaders() {
  for (const r of readers) disposeReader(r);
  for (const node of readerElements.values()) stopIn(node);
  readers = [];
  focusedReader = null;
  readerElements.clear();
  heights.clear();
  $('reader-left').replaceChildren();
  $('reader-right').replaceChildren();
  placeReaders();
  refreshBoardSelection();
}
function updateCollapsed(record) {
  const d = readerElements.get(record.key);
  if (!d) return;
  d.classList.toggle('is-collapsed', record.collapsed);
  const button = d.querySelector('.collapse-reader');
  button.textContent = record.collapsed ? '展开' : '收起';
  button.setAttribute('aria-expanded', String(!record.collapsed));
  if (record.collapsed) {
    stopIn(d, false);
    for (const b of d.querySelectorAll('.magnify.active')) b.click();
  }
  $('collapse-readers').disabled = !readers.some((r) => !r.collapsed);
}
function placeReaders() {
  const left = $('reader-left'),
    right = $('reader-right');
  readers.forEach((r) => {
    const node = readerElements.get(r.key),
      target = effectiveLayout === 'dual' && r.column === 1 ? right : left;
    if (node && node.parentElement !== target) target.append(node);
  });
  // Preserve chosen order when changing between one and two independent columns.
  for (const col of [left, right]) {
    const expected = readers.filter((r) =>
      col === left
        ? effectiveLayout !== 'dual' || r.column !== 1
        : effectiveLayout === 'dual' && r.column === 1
    );
    expected.forEach((r, i) => {
      const node = readerElements.get(r.key);
      if (node && col.children[i] !== node) col.insertBefore(node, col.children[i] || null);
    });
  }
  $('reader-empty').hidden = readers.length > 0;
  left.hidden = !readers.length;
  right.hidden = !readers.length;
  $('reader-count').textContent = readers.length
    ? `已打开 ${readers.length} 个节点`
    : '从上方看板打开节点';
  $('clear-readers').disabled = !readers.length;
  $('collapse-readers').disabled = !readers.some((r) => !r.collapsed);
}
function updateReaderLayout() {
  const width = $('reading-board').clientWidth,
    next = readingLayout(preferredLayout, width);
  effectiveLayout = next;
  $('reading-board').dataset.layout = next;
  for (const b of $('read-layouts').querySelectorAll('button')) {
    pressed(b, b.dataset.layout === next);
    const minimum = b.dataset.layout === 'side' ? 1020 : b.dataset.layout === 'dual' ? 1120 : 0;
    b.disabled = width < minimum;
    b.title = b.disabled ? '窗口变宽后可使用此布局' : '';
  }
  $('layout-note').hidden = next === preferredLayout;
  $('layout-note').textContent = '当前窗口较窄，暂用一列上下；窗口变宽后恢复你的选择。';
  placeReaders();
}
function refThumb(a, index, nodeId) {
  const b = el('button', '', 'ref-thumb');
  b.type = 'button';
  b.title = a.name + ' · ' + mediaState(a) + '；左键预览，右键定位文件';
  b.setAttribute('aria-label', a.name + '；左键预览，右键定位文件');
  const pic = el('span', '', 'ref-picture');
  pic.append(icon(a.kind));
  const image = attachThumbnail(pic, a, { full: onlinePreview() });
  bindHover(b, image, a, { nodeId }, { contextMenu: false });
  b.append(pic);
  if (index != null) b.append(el('span', String(index), 'ref-number'));
  b.addEventListener('click', () => {
    hideHoverPreview();
    openMediaPreview(a, { nodeId });
  });
  b.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideHoverPreview();
    void reveal(a);
  });
  return b;
}
function referenceStrip(item) {
  const refs = el('div', '', 'references');
  refs.setAttribute('aria-label', '参考素材，支持横向滚动');
  for (const r of item.references) {
    const a = r.assetIds?.map((id) => assetMap.get(id)).find(Boolean);
    if (a) refs.append(refThumb(a, r.index, r.nodeId));
    else refs.append(el('span', `${r.index}. ${r.name}`, 'text-ref'));
  }
  if (!refs.childNodes.length) {
    const empty = el('div', '未提取到关联参考素材', 'ref-strip empty-references');
    empty.setAttribute('aria-label', '参考素材');
    return empty;
  }
  const strip = el('div', '', 'ref-strip'),
    prev = action('‹', () => refs.scrollBy({ left: -240, behavior: 'smooth' })),
    next = action('›', () => refs.scrollBy({ left: 240, behavior: 'smooth' }));
  prev.className = next.className = 'ref-arrow';
  prev.setAttribute('aria-label', '向左查看参考素材');
  next.setAttribute('aria-label', '向右查看参考素材');
  strip.append(prev, refs, next);
  function arrows() {
    prev.disabled = refs.scrollLeft <= 1;
    next.disabled = refs.scrollLeft + refs.clientWidth >= refs.scrollWidth - 1;
  }
  refs.addEventListener('scroll', arrows);
  refs.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && refs.scrollWidth > refs.clientWidth) {
        e.preventDefault();
        refs.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );
  new ResizeObserver(arrows).observe(refs);
  requestAnimationFrame(arrows);
  return strip;
}
function richPrompt(entry) {
  const pre = el('div');
  let end = 0;
  for (const token of promptReferenceTokens(entry, result?.metadata?.platform)) {
    pre.append(document.createTextNode(entry.prompt.slice(end, token.start)));
    const ref = token.reference,
      a = ref?.assetIds?.map((id) => assetMap.get(id)).find(Boolean);
    if (ref) {
      const chip = el('button', '', 'inline-ref');
      chip.append(el('span', promptReferenceLabel(ref.name), 'ref-chip-label'));
      chip.title = ref.name + ' · ' + (ref.marker || '节点参考');
      chip.setAttribute('aria-label', ref.name);
      if (a) {
        chip.addEventListener('click', () => reveal(a));
        const image = attachThumbnail(chip, a, { full: onlinePreview() });
        if (image) {
          chip.prepend(image);
          image.alt = '';
          bindHover(chip, image, a, { nodeId: ref.nodeId });
        }
      } else chip.disabled = true;
      pre.append(chip);
    } else pre.append(document.createTextNode(token.text));
    end = token.end;
  }
  pre.append(document.createTextNode(entry.prompt.slice(end)));
  return pre;
}
function mediaOutput(a, context) {
  const box = el('div', '', 'media-output'),
    stage = el('div', '', 'media-stage');
  box.append(stage);
  if (a.kind === 'image') {
    box.classList.add('image-output');
    if (a.state !== 'done' && !onlinePreview())
      stage.append(
        el(
          'div',
          result?.localProject
            ? '此素材未下载或本地文件缺失。'
            : '轻量模式不加载在线图片，请切换全能模式查看。',
          'media-placeholder'
        )
      );
    else {
      const image = el('img');
      image.alt = a.name;
      stage.dataset.previewState = 'loading';
      image.src = sourceUrl(a);
      image.onload = () => {
        image.dataset.loaded = 'true';
        stage.dataset.previewState = 'ready';
      };
      image.onerror = () => {
        stage.dataset.previewState = 'failed';
        image.remove();
        stage.append(el('div', '预览暂不可用，下载后可查看。', 'media-placeholder'));
      };
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', '查看图片信息：' + a.name);
      image.setAttribute('aria-haspopup', 'dialog');
      image.setAttribute('aria-controls', 'image-info-dialog');
      image.addEventListener('click', () => imageInfoDialog.show(a));
      image.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          imageInfoDialog.show(a);
        }
      });
      stage.append(image);
      bindMagnifier(stage, image, a, context);
    }
  } else {
    stage.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMediaPreview(a, context);
    });
    if (a.kind === 'audio') {
      stage.classList.add('audio-stage');
    }
    const player = el(a.kind === 'video' ? 'video' : 'audio');
    player.controls = true;
    player.preload = 'none';
    stage.dataset.previewState = 'idle';
    player.dataset.assetId = a.id;
    if (a.kind === 'video') bindVideoPoster(player, a, { full: onlinePreview() });
    player.addEventListener('play', () => {
      for (const other of document.querySelectorAll('video,audio'))
        if (other !== player) other.pause();
    });
    for (const event of ['waiting', 'loadstart'])
      player.addEventListener(event, () => {
        stage.dataset.previewState = 'loading';
      });
    for (const event of ['loadedmetadata', 'canplay', 'playing', 'loadeddata'])
      player.addEventListener(event, () => {
        stage.dataset.previewState = 'ready';
      });
    player.addEventListener('error', () => {
      stage.dataset.previewState = 'failed';
      status('播放失败，可下载后查看，或检查登录和素材地址有效期。', 'attention');
    });
    stage.append(player);
    preparePlayer(player, a);
  }
  return box;
}
function resizeHandle(card, shell, record) {
  const handle = el('button', '', 'resize-handle');
  handle.type = 'button';
  handle.title = '拖动调整正文高度；接近一格或两格时，松开后吸附。方向键每次调整 20 像素。';
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', '正文区域高度');
  handle.setAttribute('aria-valuemin', '140');
  handle.setAttribute('aria-valuemax', '1200');
  handle.setAttribute(
    'aria-valuenow',
    String(Math.round(shell.getBoundingClientRect().height) || 480)
  );
  const enabled = () => effectiveLayout !== 'side' && !record.collapsed;
  function apply(height) {
    heights.set(record.key, height);
    card.style.setProperty('--prompt-height', height + 'px');
    handle.setAttribute('aria-valuenow', String(height));
  }
  let drag;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !enabled()) return;
    e.preventDefault();
    drag = { y: e.clientY, height: shell.getBoundingClientRect().height };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!enabled()) {
      drag = null;
      return;
    }
    apply(Math.round(Math.max(140, Math.min(1200, drag.height + e.clientY - drag.y))));
  });
  function end() {
    if (!drag) return;
    const unit = card.querySelector('.media-stage')?.getBoundingClientRect().height + 48;
    apply(snapHeight(shell.getBoundingClientRect().height, unit));
    drag = null;
  }
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', () => {
    drag = null;
  });
  handle.addEventListener('lostpointercapture', () => {
    drag = null;
  });
  handle.addEventListener('keydown', (e) => {
    if (enabled() && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const current = shell.getBoundingClientRect().height,
        next =
          e.key === 'Home'
            ? 140
            : e.key === 'End'
              ? 1200
              : current + (e.key === 'ArrowUp' ? -20 : 20);
      apply(Math.round(Math.max(140, Math.min(1200, next))));
    }
  });
  return handle;
}

function citingStrip(item, record) {
  const entries = referencingEntries(
    result,
    record.nodeId,
    record.scope === 'assets' ? [item.id] : item.outputAssetIds || []
  );
  const targets = entries.map((entry) => ({ entry, nodeId: entry.nodeId, name: entry.name }));
  if (item.kind === 'text')
    for (const id of item.linkedNodeIds || []) {
      if (targets.some((target) => target.nodeId === id)) continue;
      const asset = result.assets.find((a) => a.nodeIds?.includes(id));
      if (asset)
        targets.push({
          asset,
          nodeId: id,
          name: result.nodeSummaries?.find((n) => n.nodeId === id)?.name || asset.name
        });
    }
  if (!targets.length) return null;
  const strip = el('div', '', 'citing-strip'),
    links = el('div', '', 'citing-links');
  links.setAttribute('aria-label', '引用此素材的节点');
  for (const target of targets) {
    const link = action(target.name, () =>
      target.entry
        ? openReader('prompts', target.entry)
        : openReader('assets', target.asset, target.nodeId)
    );
    link.dataset.nodeId = target.nodeId;
    link.title = target.name + ' · 节点 ' + target.nodeId;
    links.append(link);
  }
  const prev = el('button', '‹', 'citing-arrow'),
    next = el('button', '›', 'citing-arrow');
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', '向左查看引用节点');
  next.setAttribute('aria-label', '向右查看引用节点');
  if (item.kind === 'text') links.setAttribute('aria-label', '关联此文本的节点');
  strip.append(
    el('span', item.kind === 'text' ? '关联节点' : '引用此素材', 'citing-label'),
    prev,
    links,
    next
  );
  const releases = [bindScrollArrow(prev, links, -1), bindScrollArrow(next, links, 1)];
  function update() {
    const available = strip.clientWidth - strip.querySelector('.citing-label').offsetWidth - 6;
    const overflow = links.scrollWidth > available + 1;
    prev.hidden = next.hidden = !overflow;
    prev.disabled = links.scrollLeft <= 1;
    next.disabled = links.scrollLeft + links.clientWidth >= links.scrollWidth - 1;
  }
  links.addEventListener('scroll', update);
  const observer = new ResizeObserver(update);
  observer.observe(strip);
  observer.observe(links);
  requestAnimationFrame(update);
  record.dispose = () => {
    observer.disconnect();
    releases.forEach((release) => release());
  };
  return strip;
}
function linkedTextBlock(ref, expanded, renderText) {
  const block = el('details', '', 'linked-text');
  block.open = expanded;
  block.dataset.nodeId = ref.nodeId;
  block.dataset.evidence = (ref.evidence || []).join(' ');
  block.append(
    el('summary', '关联文本：' + ref.name + ' · ' + (ref.relation || '当前画布引用／连线'))
  );
  const body = el('div', '', 'linked-text-body');
  if (ref.textMismatch)
    body.append(el('p', '参数中的文本副本与当前节点正文不同；此处保留参数副本。', 'hint'));
  if (ref.text?.trim()) body.append(renderText(ref.text));
  else
    body.append(
      el(
        'p',
        ref.textState === 'empty'
          ? '关联文本节点正文为空。'
          : '关联文本正文读取失败，节点和关联关系已保留。',
        'hint'
      )
    );
  if (ref.textState === 'partial')
    body.append(el('p', '部分文本片段未解析，请核对平台原文。', 'hint'));
  const controls = el('div', '', 'linked-text-actions');
  const copy = action(
    '复制关联文本',
    async () => {
      const response = await window.lab.copyText(ref.text);
      status(response.ok ? '关联文本已复制。' : response.error, response.ok ? 'done' : 'error');
    },
    { quiet: true }
  );
  copy.disabled = !ref.text?.trim();
  controls.append(copy);
  const source = result.entries.find(
    (entry) => entry.nodeId === ref.nodeId && entry.kind === 'text'
  );
  if (source)
    controls.append(action('打开文本节点', () => openReader('prompts', source), { quiet: true }));
  body.append(controls);
  block.append(body);
  return block;
}
function detail(item, record) {
  const markdownViews = [];
  const renderText = (source, entry = null) => {
    const view = createMarkdownText(
      source,
      entry ? (text) => richPrompt({ ...entry, prompt: text }) : null
    );
    markdownViews.push(view);
    view.setMode(record.markdownMode || 'preview');
    return view.element;
  };
  const isAsset = record.scope === 'assets',
    isText = !isAsset && item.kind === 'text',
    d = el('article', '', 'reading-card');
  if (isAsset && item.role === 'full-video') d.classList.add('full-video');
  d.dataset.key = record.key;
  d.dataset.scope = record.scope;
  d.tabIndex = -1;
  d.id = 'read-' + (record.nodeId || item.id || item.nodeId);
  d.setAttribute('aria-label', item.name + '的详情');
  if (isText) d.classList.add('is-text');
  if (heights.has(record.key))
    d.style.setProperty('--prompt-height', heights.get(record.key) + 'px');
  const content = el('div', '', 'reading-content'),
    visual = el('div', '', 'visual-col'),
    text = el('div', '', 'text-col');
  content.append(visual, text);
  d.append(content);
  const workTitle = item.workTitle || result?.metadata.title,
    promptHeading = el('div', '', 'prompt-heading');
  const markdownModes = el('div', '', 'markdown-modes');
  markdownModes.setAttribute('role', 'tablist');
  markdownModes.setAttribute('aria-label', '正文显示方式');
  for (const [value, label] of [
    ['preview', 'Preview'],
    ['markdown', 'Markdown']
  ]) {
    const button = action(label, () => {
      record.markdownMode = value;
      for (const view of markdownViews) view.setMode(value);
      for (const tab of markdownModes.children) {
        const selected = tab.dataset.mode === value;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
    });
    button.dataset.mode = value;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String((record.markdownMode || 'preview') === value));
    button.tabIndex = (record.markdownMode || 'preview') === value ? 0 : -1;
    button.classList.toggle('active', (record.markdownMode || 'preview') === value);
    markdownModes.append(button);
  }
  markdownModes.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...markdownModes.children];
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 1
          : (tabs.indexOf(document.activeElement) + 1) % tabs.length;
    tabs[index].click();
    tabs[index].focus();
  });
  promptHeading.append(markdownModes);
  if (workTitle) promptHeading.append(el('p', '所属作品：' + workTitle, 'work-source'));
  text.prepend(promptHeading);
  const head = el('div', '', 'detail-heading'),
    title = el('div', '', 'detail-title');
  title.append(
    el('h3', item.name),
    el(
      'span',
      isAsset
        ? MEDIA[item.kind]
        : [TYPES[promptKind(item.kind)], item.group, item.model].filter(Boolean).join(' · '),
      'detail-sub'
    )
  );
  const controls = el('div', '', 'detail-actions');
  const toggle = () => {
    record.collapsed = !record.collapsed;
    updateCollapsed(record);
  };
  const copy = action(
      '复制正文',
      async () => {
        const value = isAsset ? '' : item.prompt;
        const r = await window.lab.copyText(value);
        status(r.ok ? '正文已复制。' : r.error, r.ok ? 'done' : 'error');
      },
      { quiet: true }
    ),
    collapse = action(record.collapsed ? '展开' : '收起', toggle, { quiet: true });
  collapse.classList.add('collapse-reader');
  collapse.setAttribute('aria-expanded', String(!record.collapsed));
  const remove = action('移出阅读区', () => removeReader(record), { quiet: true });
  remove.className = 'quiet remove-reader';
  const download = action('下载素材', () => downloadOne(record), { quiet: true });
  download.className = 'quiet download-one';
  const locate = action(
    '定位文件',
    () => reveal(isText ? item : assetMap.get(d.dataset.currentAsset)),
    {
      quiet: true
    }
  );
  locate.classList.add('locate-file', 'reader-locate');
  locate.hidden = true;
  copy.disabled = isAsset || !item.prompt?.trim();
  controls.append(download, locate, remove, copy, collapse);
  head.append(title, controls);
  head.addEventListener('click', (e) => {
    if (!e.target.closest('button')) toggle();
  });
  title.tabIndex = 0;
  title.setAttribute('role', 'button');
  title.setAttribute('aria-label', '展开或收起 ' + item.name);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  conditionalTitle(title);
  d.prepend(head);
  const outputs = isAsset
      ? record.nodeId
        ? result.assets.filter((a) => a.nodeIds?.includes(record.nodeId))
        : [item]
      : (item.outputAssetIds || []).map((id) => assetMap.get(id)).filter(Boolean),
    host = el('div', '', 'media-host');
  visual.append(host);
  let counter;
  if (
    !outputs.length &&
    !isAsset &&
    !item.references.some((ref) => ref.assetIds?.some((id) => assetMap.has(id)))
  )
    d.classList.add('no-media');
  function showOutput() {
    stopIn(host);
    if (outputs.length) {
      record.output = Math.min(record.output, outputs.length - 1);
      host.replaceChildren(
        mediaOutput(outputs[record.output], { scope: record.scope, item, nodeId: record.nodeId })
      );
    } else
      host.replaceChildren(
        el('div', '没有当前生成结果，明确关联的参考素材和文本仍保留。', 'media-placeholder')
      );
    const current = outputs[record.output];
    const hasLocation = isText ? Boolean(record.textFileSaved) : current?.state === 'done';
    locate.hidden = !hasLocation;
    controls.classList.toggle('has-file-location', hasLocation);
    d.dataset.currentAsset = current?.id || '';
    const button = d.querySelector('.download-one');
    button.disabled = isText
      ? !item.prompt?.trim() || busy || saving || downloads?.active || hasLocation
      : !current || current.state === 'done' || busy || downloads?.active;
    button.textContent = isText
      ? hasLocation
        ? '已下载'
        : '下载文本'
      : current?.state === 'done'
        ? '已下载'
        : current?.state === 'downloading'
          ? '下载中'
          : '下载素材';
    if (counter) counter.textContent = `${record.output + 1} / ${outputs.length} 个结果`;
    record.imageInfo?.setAsset(current);
  }
  if (outputs.length > 1) {
    const nav = el('div', '', 'carousel-nav');
    counter = el('span');
    nav.append(
      action('上一个', () => {
        record.output = (record.output - 1 + outputs.length) % outputs.length;
        showOutput();
      }),
      counter,
      action('下一个', () => {
        record.output = (record.output + 1) % outputs.length;
        showOutput();
      })
    );
    visual.append(nav);
  }
  record.showOutput = showOutput;
  record.selectAsset = (id) => {
    const next = outputs.findIndex((a) => a.id === id);
    if (next >= 0 && record.output !== next) {
      record.output = next;
      showOutput();
    }
  };
  showOutput();
  if (isText) {
    void window.lab
      .textFile(item.nodeId)
      .then((response) => {
        if (!d.isConnected || !response.ok) return;
        record.textFileSaved = response.value.saved;
        updateButtons();
      })
      .catch(() => {});
  }
  if (!isAsset) {
    const refs = referenceStrip(item);
    if (refs) visual.append(refs);
  }
  const shell = el('div', '', 'prompt-shell'),
    scroll = el('div', '', isAsset ? 'asset-info-wrap' : 'prompt-text'),
    inner = el('div', '', 'prompt-inner');
  scroll.append(inner);
  if (isText) bindTextPreview(scroll, item);
  shell.append(scroll);
  text.append(shell);
  if (isAsset) {
    const owners = result.entries.filter((e) => item.nodeIds?.includes(e.nodeId));
    if (owners.length > 1) {
      const choices = el('div', '', 'asset-prompt-choices');
      inner.append(el('p', '此素材对应多个节点，选择节点查看其自身提示词。', 'hint'));
      for (const owner of owners) {
        const link = action(owner.name, () => openReader('prompts', owner, owner.nodeId, item.id));
        link.title = owner.name + ' · 节点 ' + owner.nodeId;
        choices.append(link);
      }
      inner.append(choices);
    } else
      inner.append(
        el(
          'p',
          (item.associatedTexts || []).length
            ? '该素材未读到直接提示词，下方保留关联文本。'
            : '该素材暂无自身提示词。',
          'hint reader-prompt-placeholder'
        )
      );
    for (const ref of item.associatedTexts || [])
      if (!record.nodeId || ref.targetNodeId === record.nodeId)
        inner.append(linkedTextBlock(ref, true, renderText));
  } else {
    if (isText) {
      const count = (
        item.linkedNodeIds || referencingEntries(result, item.nodeId).map((e) => e.nodeId)
      ).length;
      const role = el('div', '', 'text-role');
      role.append(
        el(
          'span',
          count > 1
            ? '共享文本 · ' + count + ' 个关联节点'
            : count
              ? '关联文本 · 1 个关联节点'
              : '未关联文本',
          'text-role-label'
        ),
        el(
          'span',
          item.textUsage === 'generation-input' ? '当前生成配置引用' : '用途未确认',
          'text-provenance'
        )
      );
      inner.append(role);
    } else if (item.prompt.trim() && item.referenceTexts.length)
      inner.append(el('p', '直接提示词', 'text-provenance'));
    inner.append(
      item.prompt.trim()
        ? renderText(item.prompt, item)
        : el(
            'p',
            isText
              ? '文本正文读取失败，节点与关联关系已保留。'
              : '当前节点无直接文本，下方保留关联文本。',
            'hint reader-prompt-placeholder'
          )
    );
    if (item.textState === 'partial')
      inner.append(el('p', '部分文本格式未解析，请核对平台原文。', 'hint'));
    for (const ref of item.referenceTexts)
      inner.append(linkedTextBlock(ref, !item.prompt.trim(), renderText));
  }
  if (outputs.some((asset) => asset.kind === 'image')) {
    record.imageInfo = createReaderImageInfo((visible) => {
      const placeholder = inner.querySelector('.reader-prompt-placeholder');
      if (placeholder) placeholder.hidden = visible;
    });
    if (!isAsset && (item.prompt?.trim() || item.referenceTexts?.length))
      record.imageInfo.element.classList.add('has-canvas-prompt');
    inner.append(record.imageInfo.element);
    record.imageInfo.setAsset(outputs[record.output]);
  }
  const citations = citingStrip(item, record);
  if (citations) text.append(citations);
  const restoreScroll = record.scroll || 0;
  scroll.addEventListener('scroll', () => {
    record.scroll = scroll.scrollTop;
  });
  requestAnimationFrame(() => {
    if (scroll.isConnected) scroll.scrollTop = restoreScroll;
  });
  d.append(resizeHandle(d, shell, record));
  const expandPrompt = promptWindowButton();
  expandPrompt.classList.add('prompt-expand');
  expandPrompt.setAttribute('aria-haspopup', 'dialog');
  expandPrompt.setAttribute('aria-controls', 'prompt-dialog');
  expandPrompt.addEventListener('click', () =>
    promptDialog.show({
      owner: record.key,
      anchor: expandPrompt,
      inner,
      scroll,
      strip: visual.querySelector('.ref-strip'),
      modeControls: markdownModes,
      name: item.name
    })
  );
  promptHeading.append(expandPrompt);
  if (record.collapsed) d.classList.add('is-collapsed');
  d.addEventListener('pointerdown', () => {
    focusedReader = record.key;
    for (const [key, element] of readerElements)
      element.classList.toggle('focused', key === record.key);
  });
  return d;
}
function rebuildReaders() {
  for (const r of readers) disposeReader(r);
  for (const node of readerElements.values()) stopIn(node);
  $('reader-left').replaceChildren();
  $('reader-right').replaceChildren();
  readerElements.clear();
  readers = readers.filter((r) => itemFor(r));
  for (const r of readers) readerElements.set(r.key, detail(itemFor(r), r));
  updateReaderLayout();
}
function renderFilters() {
  const items = scope === 'assets' ? boardAssets(result) : result?.entries || [],
    labels =
      scope === 'assets' ? MEDIA : { video: '视频', image: '图片', audio: '音频', text: '文本' },
    counts = countKinds(items, Object.keys(labels)),
    root = $('category-filters');
  root.replaceChildren();
  root.style.setProperty('--category-count', String(Object.keys(labels).length));
  for (const [key, label] of Object.entries(labels)) {
    const b = action(label, () => {
      const chosen = filters[scope];
      chosen.has(key) ? chosen.delete(key) : chosen.add(key);
      page = 0;
      renderBoard();
    });
    b.dataset.filter = key;
    pressed(b, filters[scope].has(key));
    b.prepend(icon(key));
    b.append(el('span', String(counts[key]), 'counter'));
    root.append(b);
  }
}
function renderBoard() {
  clearTimeout(renderTimer);
  prepareVideoThumbnails(result?.assets || [], { full: onlinePreview() });
  filename();
  updateButtons();
  hideHoverPreview();
  renderFilters();
  pressed($('tab-prompts'), scope === 'prompts');
  pressed($('tab-assets'), scope === 'assets');
  $('prompt-total').textContent = result?.entries.length || 0;
  $('asset-total').textContent = boardAssets(result).length;
  const grid = $('entries');
  grid.dataset.dense = String(columns >= 7);
  grid.dataset.text = String(columns === 0);
  $('columns').setAttribute(
    'aria-valuetext',
    columns === 0 ? '文字索引' : '每行 ' + columns + ' 个'
  );
  $('columns').title = columns === 0 ? '文字索引' : '每行 ' + columns + ' 个';
  $('content-summary').hidden = !result;
  if (result) $('content-summary').textContent = contentSummary(result);
  if (!result) return;
  assetMap = new Map(result.assets.map((a) => [a.id, a]));
  const items = filtered(result, scope, filters[scope], $('search').value),
    size = pageSize(columns);
  page = Math.max(0, Math.min(page, Math.ceil(items.length / size) - 1));
  const shown = items.slice(page * size, (page + 1) * size);
  grid.style.setProperty(
    '--columns',
    String(columns === 0 ? textColumns(shown, grid.clientWidth) : columns)
  );
  grid.replaceChildren();
  if (!items.length) {
    const empty = el('div', '', 'empty-state');
    empty.append(
      el(
        'h2',
        author &&
          result.authorProfile?.unpublishedIds?.length === author.selectedIds.length &&
          author.selectedIds.length
          ? '所选作品未公开画布'
          : author && !author.selectedIds.length
            ? '选择作品后显示内容'
            : filters[scope].size
              ? '当前分类没有匹配内容'
              : '请选择要查看的类别'
      ),
      el(
        'p',
        author &&
          result.authorProfile?.unpublishedIds?.length === author.selectedIds.length &&
          author.selectedIds.length
          ? '作品保留在上方作品集中；可在下载区下载作品视频。'
          : author && !author.selectedIds.length
            ? '点击上方作品卡片，可同时选择多部。'
            : '分类按钮支持多选；浏览筛选不改变保存或下载范围。'
      )
    );
    grid.append(empty);
  }
  shown.forEach((item) => grid.append(card(item)));
  resetThumbnailJobs();
  const nav = $('pagination');
  nav.replaceChildren();
  if (items.length > size) {
    const prev = action('上一页', () => {
        page--;
        renderBoard();
        document.querySelector('.workspace').scrollIntoView({ block: 'start' });
      }),
      next = action('下一页', () => {
        page++;
        renderBoard();
        document.querySelector('.workspace').scrollIntoView({ block: 'start' });
      });
    prev.disabled = page === 0;
    next.disabled = (page + 1) * size >= items.length;
    nav.append(prev, el('span', `${page + 1} / ${Math.ceil(items.length / size)} 页`), next);
  }
}
function refreshDownload() {
  const metricAssets =
    downloads?.active && downloads.authorWorkIds ? downloads.files : result?.assets || [];
  const state = downloadState(metricAssets, mediaSelected(), downloads);
  const jobCount =
    downloads?.active && downloads.authorWorkIds
      ? downloads.authorWorkIds.length
      : author?.selectedIds.length;
  $('download').textContent = downloads?.active
    ? author
      ? `停止下载（${jobCount}）`
      : '停止下载'
    : author
      ? `下载所选作品（${jobCount}）`
      : '开始下载';
  $('download-context').hidden = !downloads?.active || !downloads.authorWorkIds;
  $('download-context').textContent = downloads?.authorWorkIds
    ? `本次任务：${downloads.authorWorkIds.length} 部作品；切换选集不改变本次下载范围。`
    : '';
  for (const row of $('download-types').querySelectorAll('.download-row')) {
    const k = row.dataset.kind,
      m = downloadMetrics(metricAssets, k, downloads),
      track = row.querySelector('.progress-track');
    track.querySelector('.progress-fill').style.width = m.percent + '%';
    track.setAttribute('aria-valuenow', String(Math.round(m.percent)));
    track.setAttribute('aria-valuetext', m.done + ' / ' + m.total + '，失败或不可用 ' + m.failed);
    row.querySelector('.download-count').textContent = m.done + ' / ' + m.total;
    row.querySelector('.download-speed').textContent =
      m.speed >= 1048576
        ? (m.speed / 1048576).toFixed(1) + ' MB/s'
        : (m.speed / 1024).toFixed(0) + ' KB/s';
    row.classList.toggle('is-unselected', !mediaSelected().includes(k));
    row.dataset.complete = String(m.total > 0 && m.done === m.total);
    row.setAttribute(
      'aria-busy',
      String(
        Boolean(
          downloads?.active &&
          downloads.files.some((a) => a.kind === k && a.state === 'downloading')
        )
      )
    );
  }
  return state;
}
function showDownloads(d) {
  downloads = d;
  imageInfoDialog.syncDownloads(d);
  refreshDownload();
  updateButtons();
  const message = d.paused
    ? '下载已暂停，请检查账号或素材权限。'
    : d.cooldownSeconds
      ? '限速等待 ' + d.cooldownSeconds + ' 秒'
      : '';
  $('download-attention').hidden = !message;
  $('download-status').textContent = message;
  $('failed-files').replaceChildren(
    ...d.files
      .filter((a) => ['failed', 'unavailable'].includes(a.state))
      .map((a) => el('p', a.name + '：' + a.error))
  );
  $('failures').hidden = !d.failed;
  $('retry').hidden = !d.files.some((a) => a.state === 'failed');
}
function applyProject(payload) {
  project = payload;
  const opts = payload.options || options(),
    oldMode = mode();
  $('split').checked = Boolean(opts.split);
  $('mode').value = opts.mode || 'simple';
  for (const c of $('export-types').querySelectorAll('input'))
    c.checked = opts.kinds.includes(c.dataset.kind);
  if (payload.manifestPath) {
    $('local-project-path').value = payload.manifestPath;
    $('local-project-path').title = payload.manifestPath;
  }
  if (payload.directory || payload.root)
    $('output-dir').textContent = payload.directory || payload.authorDirectory || payload.root;
  $('output-dir').title = $('output-dir').textContent;
  if (!saving)
    $('saved').textContent = payload.documents?.length
      ? '已保存：' + payload.documents.join('；')
      : '尚未保存提示词';
  $('project-name').textContent = result ? filename() : '等待读取项目';
  $('project-name').title = $('project-name').textContent;
  refreshDownload();
  if (!downloads?.active) renderBoard();
  else updateButtons();
  if (oldMode !== mode()) rebuildReaders();
}

window.lab.onEvent(({ type, payload, taskId }) => {
  if (type === 'reset' && taskId) activeTaskId = Math.max(activeTaskId, taskId);
  if (taskId && taskId < activeTaskId) return;
  if (type === 'status') status(payload.message, payload.phase);
  if (type === 'author') {
    const entering = !author && payload;
    author = payload;
    authorControls.set(payload);
    if (entering) {
      $('author-works').hidden = false;
      $('board-body').hidden = false;
    }
    syncAuthorViews();
    updateButtons();
  }
  if (type === 'author-loading') {
    authorLoading = payload;
    updateButtons();
  }
  if (type === 'platform-visible') {
    visible = payload;
    $('show-first').checked = visible;
    $('visibility').setAttribute('aria-pressed', String(visible));
    $('visibility').textContent = visible ? '隐藏平台' : '显示平台';
    updateButtons();
  }
  if (type === 'browser-resetting') {
    setBrowserResetting(payload);
  }
  if (type === 'platform-reset') {
    visible = typeof payload?.visible === 'boolean' ? payload.visible : false;
    $('show-first').checked = visible;
    $('visibility').textContent = visible ? '隐藏平台' : '显示平台';
    $('visibility').setAttribute('aria-pressed', String(visible));
    updateButtons();
  }
  if (type === 'reset') {
    imageInfoDialog.close();
    clearVideoThumbnails();
    $('retry').hidden = true;
    closeMediaPreview();
    clearReaders();
    result = null;
    project = null;
    downloads = null;
    page = 0;
    assetMap.clear();
    clearTimeout(saveTimer);
    for (const k of Object.keys(TYPES)) $('export-count-' + k).textContent = '0';
    for (const k of Object.keys(MEDIA)) $('media-count-' + k).textContent = '0';
    $('prompt-total').textContent = '0';
    $('asset-total').textContent = '0';
    renderFilters();
    $('entries').replaceChildren(el('div', '正在读取画布…', 'empty-state loading-canvas'));
    $('warnings').hidden = true;
    $('saved').textContent = '尚未保存提示词';
    $('project-name').textContent = '正在读取项目…';
    refreshDownload();
    $('pagination').replaceChildren();
  }
  if (type === 'result') {
    imageInfoDialog.close();
    const preservedDownloads = payload.authorProfile && downloads?.authorWorkIds ? downloads : null;
    if (payload.localProject) {
      $('search').value = '';
      scope = 'prompts';
      filters.prompts = new Set(Object.keys(TYPES));
      filters.assets = new Set(Object.keys(MEDIA));
    }
    clearVideoThumbnails();
    if (!preservedDownloads) {
      $('failures').hidden = true;
      $('download-attention').hidden = true;
      $('failed-files').replaceChildren();
      $('retry').hidden = true;
    }
    closeMediaPreview();
    clearReaders();
    result = payload;
    downloads = preservedDownloads;
    page = 0;
    assetMap = new Map(result.assets.map((a) => [a.id, a]));
    $('url').value = result.metadata.inputUrl;
    syncProfileNote();
    $('project-name').textContent = filename();
    $('project-name').title = filename();
    $('saved').textContent = '尚未保存提示词';
    const d = result.diagnostics;
    $('warning-body').replaceChildren(...d.warnings.map((w) => el('p', w)));
    $('warning-summary').textContent = `提取说明 · ${d.warnings.length} 项`;
    $('warnings').hidden = !d.warnings.length;
    const categoryCounts = countKinds(result.entries, Object.keys(TYPES));
    for (const k of Object.keys(TYPES)) $('export-count-' + k).textContent = categoryCounts[k];
    for (const k of Object.keys(MEDIA))
      $('media-count-' + k).textContent = result.assets.filter((a) => a.kind === k).length;
    renderBoard();
    refreshDownload();
  }
  if (type === 'project') applyProject(payload);
  if (type === 'downloads') showDownloads(payload);
  if (type === 'image-brands' && result) {
    for (const { assetId, brand } of payload) {
      const asset = assetMap.get(assetId);
      if (asset) asset.imageBrand = brand;
    }
    if (scope === 'assets' && imageBrandQuery($('search').value)) renderBoard();
  }
  if (type === 'assets' && result) {
    // Keep the objects used by open readers and media callbacks alive.
    result.assets = payload.map((asset) => Object.assign(assetMap.get(asset.id) || {}, asset));
    assetMap = new Map(result.assets.map((a) => [a.id, a]));
    prepareVideoThumbnails(result.assets, { full: onlinePreview() });
    imageInfoDialog.syncAssets(result.assets);
    refreshDownload();
    updateButtons();
    if (!downloads?.active) {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        renderBoard();
      }, 120);
    }
  }
});
async function extract() {
  syncProfileNote();
  const input = $('url').value.trim();
  if (!input) {
    status('请先粘贴作品链接或作者主页地址。', 'error');
    return;
  }
  clearTimeout(saveTimer);
  busy = true;
  updateButtons();
  try {
    const r = await window.lab.extract(input, {
      ...options(),
      visible: $('show-first').checked,
      theme: appearance.get()
    });
    if (!r.ok) status(r.error, 'error');
  } catch (e) {
    status(e.message, 'error');
  } finally {
    busy = false;
    updateButtons();
  }
}
async function openLocalProject() {
  if (localOpening || busy || saving || downloads?.active || downloadStarting || browserResetting)
    return;
  localOpening = true;
  updateButtons();
  try {
    const r = await window.lab.openLocalProject($('local-project-path').value);
    if (!r.ok) throw new Error(r.error);
  } catch (error) {
    status(error.message, 'error');
  } finally {
    localOpening = false;
    updateButtons();
  }
}
$('open-local-project').addEventListener('click', openLocalProject);
$('open-canvas').addEventListener('click', async () => {
  const response = await window.lab.openCanvas();
  if (!response.ok) status(response.error, 'error');
});
$('local-project-path').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    openLocalProject();
  }
});
$('start').addEventListener('click', () => {
  if (busy || authorLoading || author?.works.some((w) => w.state === 'loading'))
    window.lab.cancel();
  else extract();
});
$('visibility').addEventListener('click', async () => {
  const r = await window.lab.visible(!visible);
  if (!r.ok) status(r.error, 'error');
});
$('save-prompts').addEventListener('click', () => saveNow());
$('social-profiles-enabled').addEventListener('change', async (event) => {
  const checkbox = event.target,
    enabled = checkbox.checked;
  checkbox.disabled = true;
  try {
    const response = await window.lab.socialProfilePreference(enabled);
    if (!response.ok) throw new Error(response.error);
    checkbox.checked = response.value;
    $('social-profile-status').textContent = response.value
      ? '已开启：下次读取作者时，访问分享链接补充公开资料；无需登录即可读取的资料也会记录。'
      : '已关闭：后续仅读取 LibTV 资料和分享链接。已读取内容保留，重新读取作者主页可更新。';
  } catch (error) {
    checkbox.checked = !enabled;
    $('social-profile-status').textContent = error.message;
  } finally {
    checkbox.disabled = false;
  }
});
$('browser-login-all').addEventListener('click', async () => {
  if (browserResetting || localOpening || allWebsitesOpening || loginBusy.size) return;
  allWebsitesOpening = true;
  updateButtons();
  const notice = $('browser-access-status');
  notice.textContent = '正在打开全部预设网站…';
  try {
    const response = await window.lab.loginAll();
    if (!response.ok) throw new Error(response.error);
    notice.textContent = '已在一个窗口中打开 ' + response.value.count + ' 个网站标签，可逐个登录。';
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    allWebsitesOpening = false;
    updateButtons();
  }
});
for (const button of document.querySelectorAll('[data-social-login],[data-browser-login]')) {
  button.addEventListener('click', async () => {
    const browserLogin = button.dataset.browserLogin,
      notice = $(browserLogin ? 'browser-access-status' : 'social-profile-status');
    try {
      const response = browserLogin
        ? await window.lab.openBrowser(browserLogin)
        : await window.lab.socialLogin(button.dataset.socialLogin);
      if (!response.ok) throw new Error(response.error);
      notice.textContent = browserLogin
        ? '已打开 Midjourney，可在内置浏览器中登录。'
        : '请在打开的平台页面登录；完成后重新点击“开始读取网页”更新公开用户资料。';
    } catch (error) {
      notice.textContent = error.message;
    }
  });
}
$('browser-search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('browser-search').value.trim();
  if (!input || browserResetting || localOpening) return;
  const notice = $('browser-access-status');
  try {
    const response = await window.lab.openBrowser(input);
    if (!response.ok) throw new Error(response.error);
    notice.textContent = '已打开独立访问窗口，可直接登录或浏览。';
  } catch (error) {
    notice.textContent = error.message;
  }
});
$('mode-toggle').addEventListener('click', async () => {
  const old = mode();
  $('mode').value = old === 'full' ? 'simple' : 'full';
  const r = await window.lab.update(options());
  if (!r.ok) {
    $('mode').value = old;
    status(r.error, 'error');
  }
  renderBoard();
  rebuildReaders();
  refreshDownload();
});
$('mode').addEventListener('change', async () => {
  const r = await window.lab.update(options());
  if (!r.ok) status(r.error, 'error');
  renderBoard();
  rebuildReaders();
  refreshDownload();
});
$('split').addEventListener('change', () => updateButtons());

$('search').addEventListener('input', () => {
  page = 0;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderBoard, 140);
});
$('columns').addEventListener('input', () => {
  const next =
    Number($('columns').value) === 11 ? 0 : Math.max(1, normalizeDensity($('columns').value));
  if (next === columns) return;
  columns = next;
  page = 0;
  try {
    localStorage.setItem('columns', String(columns));
  } catch {}
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderBoard, 70);
});
for (const s of ['prompts', 'assets'])
  $('tab-' + s).addEventListener('click', () => {
    scope = s;
    page = 0;
    renderBoard();
  });
$('board-toggle').addEventListener('click', () => {
  $('board-body').hidden = !$('board-body').hidden;
  $('board-toggle').textContent = author
    ? '展开看板'
    : $('board-body').hidden
      ? '展开看板'
      : '收起看板';
  if (author) pressed($('board-toggle'), !$('board-body').hidden);
  $('board-toggle').setAttribute('aria-expanded', String(!$('board-body').hidden));
});
$('works-toggle').addEventListener('click', () => {
  $('author-works').hidden = !$('author-works').hidden;
  pressed($('works-toggle'), !$('author-works').hidden);
  $('works-toggle').setAttribute('aria-expanded', String(!$('author-works').hidden));
});
for (const b of $('read-layouts').querySelectorAll('button'))
  b.addEventListener('click', () => {
    preferredLayout = b.dataset.layout;
    try {
      localStorage.setItem('read-layout', preferredLayout);
    } catch {}
    updateReaderLayout();
  });
$('collapse-readers').addEventListener('click', () => {
  for (const r of readers) {
    r.collapsed = true;
    updateCollapsed(r);
  }
});
$('clear-readers').addEventListener('click', clearReaders);
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateReaderLayout();
    if (columns === 0 && result) renderBoard();
  }, 80);
}).observe($('reader-section'));
$('directory').addEventListener('click', async () => {
  const r = await window.lab.directory();
  if (r.ok) {
    $('output-dir').textContent = r.value;
    $('output-dir').title = r.value;
  } else status(r.error, 'error');
});
$('folder').addEventListener('click', async () => {
  const r = await window.lab.openFolder();
  if (!r.ok) status(r.error, 'error');
});

async function requestDownload(args) {
  if (downloadStarting || busy || saving || downloads?.active) return;
  downloadStarting = true;
  updateButtons();
  try {
    const updated = await window.lab.update(options());
    if (!updated.ok) throw new Error(updated.error);
    const r = await window.lab.download(args);
    if (!r.ok) throw new Error(r.error);
  } catch (e) {
    status(e.message, 'error');
  } finally {
    downloadStarting = false;
    updateButtons();
  }
}
async function startDownload(retryOnly = false, force = false) {
  return requestDownload({ kinds: mediaSelected(), retryOnly, force });
}
$('download').addEventListener('click', async () => {
  if (downloads?.active) {
    const r = await window.lab.downloadControl('cancel');
    if (!r.ok) status(r.error, 'error');
    return;
  }
  const state = refreshDownload();
  if (state.complete) {
    $('redownload-count').textContent = '将重新下载 ' + state.total + ' 个素材。';
    $('redownload-dialog').showModal();
  } else startDownload();
});
$('redownload-cancel').addEventListener('click', () => {
  $('redownload-dialog').close();
});
$('redownload-confirm').addEventListener('click', () => {
  $('redownload-dialog').close();
  startDownload(false, true);
});
$('retry').addEventListener('click', () => startDownload(true));
$('resume-download').addEventListener('click', async () => {
  const r = await window.lab.downloadControl('resume');
  if (!r.ok) status(r.error, 'error');
});

let appearanceStorage;
try {
  appearanceStorage = window.localStorage;
} catch {}
const appearance = createThemeManager({
  storage: appearanceStorage,
  sync: (value) => window.lab.theme(value),
  onError: (error) => status(error.message, 'error')
});
const promptTypography = createTypographyManager({
  storage: appearanceStorage,
  onError: (error) => status(error.message, 'error')
});
function setBrowserResetting(value) {
  browserResetting = Boolean(value);
  for (const control of $('appearance-dialog').querySelectorAll('button,input'))
    if (control.id !== 'appearance-close') control.disabled = browserResetting;
  if (browserResetting) {
    promptDialog.close();
    clearVideoThumbnails();
    closeMediaPreview();
    stopIn($('reading-board'));
  }
  updateButtons();
}
$('browser-reset').addEventListener('click', async () => {
  if (
    browserResetting ||
    busy ||
    saving ||
    downloads?.active ||
    downloadStarting ||
    loginBusy.size ||
    allWebsitesOpening
  )
    return;
  const settings = {};
  for (const key of ['appearance-v1', 'theme', 'prompt-typography-v1', 'columns', 'read-layout']) {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) settings[key] = value;
    } catch {}
  }
  const notice = $('browser-reset-status');
  notice.hidden = false;
  notice.dataset.phase = 'running';
  notice.textContent = '正在清除浏览数据…';
  setBrowserResetting(true);
  try {
    const response = await window.lab.resetBrowser(settings);
    if (!response.ok) throw new Error(response.error);
    notice.dataset.phase = 'done';
    notice.textContent = '浏览器已重置，重新访问平台时需登录。';
  } catch (error) {
    notice.dataset.phase = 'error';
    notice.textContent = '重置未完成：' + error.message;
  } finally {
    setBrowserResetting(false);
  }
});
$('appearance-reset').addEventListener('click', () => {
  document.dispatchEvent(new Event('appearance-reset'));
  appearance.set(window.CanvasThemes.DEFAULT_PREFERENCE);
  promptTypography.set(window.PromptTypography.DEFAULT_TYPOGRAPHY);
});
try {
  const saved = localStorage.getItem('columns');
  if (saved !== null) {
    columns = normalizeDensity(saved);
    $('columns').value = columns === 0 ? 11 : columns;
  }
  const pref = localStorage.getItem('read-layout');
  if (READ_LAYOUTS.includes(pref)) preferredLayout = pref;
} catch {}
document.addEventListener('keydown', (e) => {
  if (
    e.key === 'Escape' &&
    focusedReader &&
    !$('redownload-dialog').open &&
    !$('media-dialog').open
  ) {
    const r = readers.find((x) => x.key === focusedReader);
    if (r && !r.collapsed) {
      r.collapsed = true;
      updateCollapsed(r);
    }
  }
});
window.lab
  .info()
  .then((r) => {
    if (r.ok) {
      accountControls.mount(r.value.platforms || []);
      $('output-dir').textContent = r.value.outputDirectory;
      $('mode').value = r.value.options.mode;
      $('social-profiles-enabled').checked = r.value.socialProfilesEnabled === true;
      if (typeof r.value.platformVisible === 'boolean') {
        visible = r.value.platformVisible;
        $('show-first').checked = visible;
        $('visibility').textContent = visible ? '隐藏平台' : '显示平台';
        $('visibility').setAttribute('aria-pressed', String(visible));
      }
      updateButtons();
    }
  })
  .catch((e) => status(e.message, 'error'));
function bindTextPreview(node, item) {
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMediaPreview(item, { scope: 'prompts', item });
  });
}
function previewOutput(item, context) {
  if (item.kind !== 'text') return mediaOutput(item, context);
  const body = el('div', '', 'text-preview prompt-text');
  body.append(el('pre', item.prompt || '文本正文读取失败，节点与关联关系已保留。'));
  return body;
}
initMediaDialog(previewOutput, stopIn, enterPreviewReader, reveal);
renderBoard();
updateReaderLayout();
