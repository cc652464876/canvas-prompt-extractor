'use strict';
const { verificationPath, APP_ICON } = require('./app-paths.cjs');
const {
  app,
  BrowserWindow,
  BaseWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  session,
  protocol,
  net,
  nativeTheme
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { markdown, filterResult } = require('./export/markdown.cjs');
const { ProjectStore } = require('./project-store.cjs');
const { readOutputDirectory, saveOutputDirectory } = require('./output-preference.cjs');
const { loadLocalProject, isCurrentProjectPath } = require('./local-project.cjs');
const { CanvasBrowserWindow } = require('./canvas-browser.cjs');
const { PROMPT_TYPES, promptKinds } = require('./prompt-types.cjs');
const { IndependentBrowser } = require('./services/independent-browser.cjs');
const { AccountManager } = require('./account-manager.cjs');
const { resetBrowserData } = require('./browser-reset.cjs');
const { popupAction, leftRequestedWork } = require('./extraction-policy.cjs');
const { DownloadQueue } = require('./download-queue.cjs');
const { selectDownloadAssets } = require('./media-policy.cjs');
const { normalizePreference, resolveTheme } = require('./theme.cjs');
const {
  listPlatforms,
  permittedUrl: platformPermittedUrl,
  homeUrls
} = require('./platforms/registry.cjs');
const { createExtractionService } = require('./services/extraction.cjs');
const {
  beginTransparentRead,
  endTransparentRead,
  isTransparentRead
} = require('./platform-presentation.cjs');
const { TaskScope } = require('./services/task-scope.cjs');
const { profileAddress } = require('./platforms/profiles.cjs');
const { createProfilePageReader } = require('./services/profile-page.cjs');
const { createAuthorService } = require('./services/author.cjs');
const { WorkWindows, presentWindow } = require('./work-windows.cjs');
const { SessionWorkCache } = require('./session-work-cache.cjs');
const { readVisibility, saveVisibility } = require('./visibility-preference.cjs');
const { readSocialPreference, saveSocialPreference } = require('./social-preference.cjs');
const { AuthorProfiles, HOMES: SOCIAL_HOMES } = require('./services/author-profiles.cjs');
const { createBrowserWindow, isManualBrowserNavigation } = require('./browser-window.cjs');
const { socialAddress } = require('./author-profiles.cjs');
const { bindDevToolsShortcut, installDevToolsMenu } = require('./devtools-shortcut.cjs');
app.on('browser-window-created', (_event, window) => bindDevToolsShortcut(window.webContents));
const { createMediaFetcher } = require('./services/media-fetcher.cjs');
const { createMediaProtocol } = require('./services/media-protocol.cjs');
const { ImageInfoService } = require('./services/image-info.cjs');
const imageInfo = new ImageInfoService({
  onError: (error) => console.error('图片信息缓存：', error.message)
});
function scanImageInfo(result, project, assets = result.assets) {
  void imageInfo
    .scan(assets, project)
    .then((rows) =>
      publishImageBrands(
        result,
        rows.filter((r) => r.status === 'fulfilled').map((r) => r.value)
      )
    )
    .catch((error) => console.error(error.message));
}
function publishImageBrands(result, infos) {
  if (result !== currentResult) return;
  const assets = new Map(result.assets.map((a) => [a.id, a])),
    brands = [];
  for (const info of infos) {
    const asset = assets.get(info.assetId);
    if (!asset || asset.kind !== 'image') continue;
    asset.imageBrand = (info.brand || '').replace(/（.*?）/g, '').trim();
    brands.push({ assetId: asset.id, brand: asset.imageBrand });
  }
  if (brands.length) send('image-brands', brands);
}
const extractionScope = new TaskScope();
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'labmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);
const ROOT = path.resolve(__dirname, '..');
// v1.4 runs from source; each version owns its data directory.
const DATA_ROOT = ROOT;
// Chromium's HTTP User-Agent must stay ASCII; the native title is localized.
app.setName('CanvasPromptExtractor');
if (process.platform === 'win32') app.setAppUserModelId('com.freecanvas.extractor.v1_4');
const verifyExtraction = process.argv.includes('--verify-extraction');
const verifyThemes = process.argv.includes('--verify-themes');
const verifyAccounts = process.argv.includes('--verify-account-startup');
const verifyBrowserReset = process.argv.includes('--verify-browser-reset');
const verifyLocalProject = process.argv.includes('--verify-local-project');
const verifyDeadline = process.argv.includes('--verify-read-deadline');
const verifyV12 = process.argv.includes('--verify-v12');
const transparentRendering =
  process.platform === 'win32' &&
  (process.argv.includes('--transparent-rendering') ||
    process.argv.includes('--verify-transparent-rendering'));
const isolatedVerification =
  verifyExtraction ||
  verifyThemes ||
  verifyAccounts ||
  verifyBrowserReset ||
  verifyLocalProject ||
  process.argv.some((value) => value.startsWith('--verify-'));
const managedPresentation =
  !isolatedVerification ||
  verifyAccounts ||
  process.argv.includes('--verify-selection-flow') ||
  process.argv.includes('--verify-selection-live');
const enableAuthorProfiles =
  !isolatedVerification || process.argv.includes('--verify-author-profiles');
if ((managedPresentation || enableAuthorProfiles) && process.platform === 'win32') {
  // Native opacity zero still uses Chromium's normal headed compositor.
  // Do not stop rendering when Windows reports this window as occluded.
  const disabled = app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean);
  app.commandLine.appendSwitch(
    'disable-features',
    [...new Set([...disabled, 'CalculateNativeWinOcclusion'])].join(',')
  );
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}
const profilePath = isolatedVerification
  ? fsSync.mkdtempSync(path.join(require('node:os').tmpdir(), 'canvas-verification-'))
  : path.join(DATA_ROOT, '.runtime', 'profile');
fsSync.mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
const browserSessions = new Set();
app.on('session-created', (ses) => browserSessions.add(ses));
const live = process.argv.includes('--verify-live');
let ui,
  platformWindow,
  currentResult = null,
  currentPlatform = '',
  task = null,
  saveTask = null,
  downloadSetup = false;
let outputDirectory = path.join(ROOT, 'exports'),
  lastStatus = '';
let lastWorkMetadata = null,
  lastAttemptWork = null;
let store,
  queue,
  exportOptions = { kinds: Object.keys(PROMPT_TYPES), split: true, mode: 'full' };
let browserResetting = false;
let localProjectOpening = false,
  currentLocalProject = false;
let canvasBrowser;
let browserGeneration = 0,
  browserPreviewAbort = new AbortController();
const thumbnailWrites = new Set();
const accounts = new AccountManager({ createWindow: createPlatformWindow });
let extractionFeedback;
const appearancePath = path.join(app.getPath('userData'), 'appearance.json');
const outputPreferencePath = path.join(app.getPath('userData'), 'output-directory.json');
const visibilityPath = path.join(app.getPath('userData'), 'platform-visibility.json');
const socialPreferencePath = path.join(app.getPath('userData'), 'social-profile-preference.json');
let socialPreferenceWriteTail = Promise.resolve();
let platformVisible = readVisibility(visibilityPath),
  visibilityWriteTail = Promise.resolve();
const workCache = new SessionWorkCache(() => outputDirectory);
const platformChildren = new Map();
const authorProfiles = new AuthorProfiles({
  enabled: readSocialPreference(socialPreferencePath),
  resolveFetcher: (url, options) => fetch(url, options),
  fetcher: (url, options) => {
    const platform = socialAddress(url)?.platform;
    return session
      .fromPartition('persist:' + (platform === 'other' ? 'liblib' : 'social-' + platform))
      .fetch(url, options);
  },
  createWindow: (platform) => {
    const window = createBrowserWindow(
      {
        icon: APP_ICON,
        width: 1280,
        height: 860,
        show: false,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          partition: 'persist:social-' + platform,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false
        }
      },
      {
        homeUrl: SOCIAL_HOMES[platform],
        blocked: (window) =>
          authorProfiles.windows.has(window) ? '正在读取作者资料，完成后可自由浏览。' : ''
      }
    );
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false)
    );
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return window;
  }
});
const independentBrowser = new IndependentBrowser({
  createWindow: createBrowserWindow,
  icon: APP_ICON,
  onOpen: () => authorProfiles.cache.clear()
});
const workWindows = new WorkWindows({
  createWindow: createPlatformWindow,
  getHomeUrl: (platform) => homeUrls()[platform],
  getVisible: () => platformVisible && platformWindow === workWindows.window
});
function syncPresentation() {
  if (!managedPresentation) return;
  const keepUiFocus = ui && !ui.isDestroyed() && ui.isFocused();
  workWindows.sync();
  for (const { id } of listPlatforms()) {
    const window = accounts.existing(id);
    if (window) presentWindow(window, window === platformWindow && platformVisible);
  }
  for (const [child, parent] of platformChildren) {
    if (parent && !parent.isDestroyed())
      presentWindow(child, parent.isVisible() && !isTransparentRead(parent));
  }
  extractionFeedback?.syncVisibility();
  send('platform-visible', platformVisible);
  // On Windows, changing focusable/taskbar flags on another shown window can
  // activate a sibling. Preserve focus only when the user was in the main UI.
  if (keepUiFocus && !ui.isDestroyed() && !ui.isFocused()) ui.focus();
}
async function setPlatformVisible(value) {
  platformVisible = Boolean(value);
  if (
    platformVisible &&
    !task &&
    !authorService.listing &&
    authorService.active &&
    (!workWindows.owns(platformWindow) || !workWindows.hasSelectedPages)
  ) {
    const profile = authorService.snapshot();
    if (!profile.localProject) {
      const win = getPlatformWindow(profile.platform, false, true);
      if (!win.webContents.getURL().startsWith(profile.url))
        void win.loadURL(profile.url).catch((error) => status(error.message, 'error'));
    }
  }
  syncPresentation();
  // An explicit reveal must restore a minimized window and raise it above the UI.
  if (
    platformVisible &&
    platformWindow &&
    !platformWindow.isDestroyed() &&
    !isTransparentRead(platformWindow)
  ) {
    if (platformWindow.isMinimized()) platformWindow.restore();
    platformWindow.show();
    platformWindow.focus();
  }
  visibilityWriteTail = visibilityWriteTail
    .catch(() => {})
    .then(() => saveVisibility(visibilityPath, platformVisible));
  await visibilityWriteTail;
  return platformVisible;
}
function getAuthorWindow(platform, _visible, _defer, url) {
  currentPlatform = platform;
  platformWindow = workWindows.get(platform, url);
  send('platform-visible', platformVisible);
  return platformWindow;
}
let appearancePreference = normalizePreference(null),
  themeWriteTail = Promise.resolve();
try {
  appearancePreference = normalizePreference(
    JSON.parse(fsSync.readFileSync(appearancePath, 'utf8'))
  );
} catch {}
let uiTheme = resolveTheme(appearancePreference, nativeTheme.shouldUseDarkColors);
async function refreshAppearance() {
  uiTheme = resolveTheme(appearancePreference, nativeTheme.shouldUseDarkColors);
  if (ui && !ui.isDestroyed()) ui.setBackgroundColor(uiTheme.tokens.bg);
  await extractionFeedback?.setTheme(uiTheme);
  return { palette: uiTheme.palette, mode: uiTheme.mode, resolvedMode: uiTheme.resolvedMode };
}
const thumbnailRuntime = isolatedVerification
  ? app.getPath('userData')
  : path.join(DATA_ROOT, '.runtime');
const thumbnailRoot = path.join(thumbnailRuntime, 'thumbnails');
const uiUrl = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (ui && !ui.isDestroyed()) {
    if (ui.isMinimized()) ui.restore();
    ui.show();
    ui.focus();
  }
});
function send(type, payload) {
  if (['result', 'project', 'assets', 'author'].includes(type)) canvasBrowser?.scheduleRefresh();
  if (ui && !ui.isDestroyed())
    ui.webContents.send('lab:event', {
      type,
      payload,
      ...(task ? { taskId: task.id, platform: task.platform } : {})
    });
  if (live && type === 'status') console.log(payload.message);
}
function status(message, phase = 'running') {
  if (task) task.outcome = { message, phase };
  const signature = phase + message;
  if (signature !== lastStatus) {
    lastStatus = signature;
    send('status', { message, phase });
    if (extractionFeedback?.active) void extractionFeedback.set(message, phase);
  }
}
function secureContents(wc, platform) {
  const permittedUrl = (value) =>
    platformPermittedUrl(platform, value) || isManualBrowserNavigation(wc, value);
  const trackChild = (child) => {
    platformChildren.set(child, BrowserWindow.fromWebContents(wc));
    child.once('closed', () => platformChildren.delete(child));
    if (isTransparentRead(BrowserWindow.fromWebContents(wc))) {
      beginTransparentRead(child);
      if (task) (task.transparentChildren ||= new Set()).add(child);
    }
    if (task && task.contents?.session === wc.session) {
      task.childAudio.push({ wc: child.webContents, muted: child.webContents.isAudioMuted() });
      child.webContents.setAudioMuted(true);
    }
  };
  wc.on('will-navigate', (event, url) => {
    if (task?.contents === wc && leftRequestedWork(url, task.url)) {
      event.preventDefault();
      status('提取期间已阻止离开当前作品，请等待完成或在主界面停止读取。', 'attention');
      return;
    }
    if (!permittedUrl(url)) {
      event.preventDefault();
      status('平台尝试打开不支持的地址，已暂停该跳转。', 'attention');
    }
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (task?.contents === wc && permittedUrl(url)) {
      const action = popupAction(url, task.url);
      if (action === 'canvas') {
        const token = task;
        if (!token.pendingNavigation) {
          status('画布跳转中，正在当前窗口打开画布…');
          token.pendingNavigation = token.contents
            .loadURL(url)
            .catch(() => {})
            .finally(() => {
              token.pendingNavigation = null;
            });
        }
        return { action: 'deny' };
      }
      if (action === 'deny') {
        status('已拦截与提取无关的新窗口，继续读取当前作品。', 'attention');
        return { action: 'deny' };
      }
    }
    return {
      action: permittedUrl(url) ? 'allow' : 'deny',
      createWindow: (options) => {
        const child = createBrowserWindow(options, {
          ...platformBrowserSettings(platform),
          manual: isManualBrowserNavigation(wc, url)
        });
        trackChild(child);
        return child.webContents;
      },
      overrideBrowserWindowOptions: {
        icon: APP_ICON,
        paintWhenInitiallyHidden: true,
        show:
          !live &&
          !isTransparentRead(BrowserWindow.fromWebContents(wc)) &&
          Boolean(BrowserWindow.fromWebContents(wc)?.isVisible()),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
          session: wc.session
        }
      }
    };
  });
}
function platformBrowserSettings(platform) {
  return {
    homeUrl: homeUrls()[platform],
    onTabCreated: (tab) => secureContents(tab.contents, tab.platform || platform),
    blocked: (window) => (task?.window === window ? '正在读取画布，请先停止读取再操作导航。' : '')
  };
}
function getPlatformWindow(platform, visible, deferShow = false) {
  if (platformWindow && !platformWindow.isDestroyed() && currentPlatform !== platform)
    managedPresentation ? presentWindow(platformWindow, false) : platformWindow.hide();
  currentPlatform = platform;
  platformWindow = accounts.getWindow(platform);
  if (!deferShow) {
    if (visible) {
      endTransparentRead(platformWindow, true);
      platformWindow.show();
    } else platformWindow.hide();
  }
  send(
    'platform-visible',
    managedPresentation
      ? platformVisible
      : platformWindow.isVisible() && !isTransparentRead(platformWindow)
  );
  return platformWindow;
}
function createPlatformWindow(platform, controls = {}) {
  const ses = session.fromPartition('persist:' + platform);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  const win = createBrowserWindow(
    {
      icon: APP_ICON,
      width: 1280,
      height: 860,
      show: false,
      paintWhenInitiallyHidden: true,
      backgroundColor: '#141414',
      title: '平台页面 · 可手动登录与核对',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:' + platform,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        offscreen: verifyAccounts || verifyBrowserReset
      }
    },
    { ...platformBrowserSettings(platform), ...controls }
  );
  win.on('close', (event) => {
    if (!app.quitting) {
      event.preventDefault();
      if (managedPresentation && (workWindows.owns(win) || win === platformWindow)) {
        void setPlatformVisible(false).catch((error) => status(error.message, 'error'));
        return;
      }
      if (task?.window === win) {
        status(
          '提取尚未完成，暂时保留平台窗口。请在主界面点击“停止读取”结束任务；说明框可单独关闭。',
          'attention'
        );
        return;
      }
      win.hide();
    }
  });
  win.on('show', () => {
    if (platformWindow === win)
      send('platform-visible', managedPresentation ? platformVisible : !isTransparentRead(win));
  });
  win.on('hide', () => {
    if (platformWindow === win)
      send('platform-visible', managedPresentation ? platformVisible : false);
  });
  return win;
}
const { runExtraction } = createExtractionService({
  root: ROOT,
  app,
  scope: extractionScope,
  hiddenRendering: process.argv.includes('--verify-hidden-rendering'),
  transparentRendering,
  presentWindow: managedPresentation ? () => syncPresentation() : null,
  enrichResult: enableAuthorProfiles
    ? (result, signal) => authorProfiles.enrichResult(result, signal)
    : null,
  getState: () => ({
    task,
    queue,
    saveTask,
    downloadSetup,
    lastWorkMetadata,
    lastAttemptWork,
    platformWindow,
    currentPlatform,
    outputDirectory,
    exportOptions,
    extractionFeedback
  }),
  updateState: (values) => {
    if ('task' in values) task = values.task;
    if ('currentResult' in values) currentResult = values.currentResult;
    if ('currentLocalProject' in values) currentLocalProject = values.currentLocalProject;
    if ('store' in values) store = values.store;
    if ('lastAttemptWork' in values) lastAttemptWork = values.lastAttemptWork;
    if ('extractionFeedback' in values) extractionFeedback = values.extractionFeedback;
  },
  getPlatformWindow,
  send,
  status,
  finishExtraction,
  getTheme: () => uiTheme,
  live
});
let authorService;
const { runExtraction: readAuthorWork } = createExtractionService({
  root: ROOT,
  app,
  scope: extractionScope,
  hiddenRendering: process.argv.includes('--verify-hidden-rendering'),
  transparentRendering,
  presentWindow: managedPresentation ? () => syncPresentation() : null,
  getState: () => ({
    task,
    queue: null,
    saveTask: null,
    downloadSetup: false,
    lastWorkMetadata,
    lastAttemptWork,
    platformWindow,
    currentPlatform,
    outputDirectory,
    exportOptions,
    extractionFeedback
  }),
  updateState: (values) => {
    if ('task' in values) task = values.task;
    if ('lastAttemptWork' in values) lastAttemptWork = values.lastAttemptWork;
    if ('extractionFeedback' in values) extractionFeedback = values.extractionFeedback;
  },
  getPlatformWindow: managedPresentation ? getAuthorWindow : getPlatformWindow,
  send: () => {},
  status: (message, phase = 'running') => {
    if (process.argv.includes('--verify-selection-live')) console.log('Live read:', message);
    if (task) task.outcome = { message, phase };
  },
  finishExtraction: async (result) => {
    lastWorkMetadata = result.metadata;
    return result;
  },
  getTheme: () => uiTheme
});
authorService = createAuthorService({
  fetcher: (url, options, platform) =>
    session.fromPartition('persist:' + platform).fetch(url, options),
  readProfilePage: createProfilePageReader((platform) => getPlatformWindow(platform, false, true)),
  readWork: readAuthorWork,
  cancelRead: () => extractionScope.cancel(),
  getRoot: () => outputDirectory,
  getOptions: () => exportOptions,
  cache: workCache,
  enrichAuthor: enableAuthorProfiles
    ? async (profile, signal) => {
        if (!profile.authorInfo) return profile;
        send('status', {
          message: authorProfiles.enabled
            ? '正在读取作者公开资料与社交主页…'
            : '正在记录 LibTV 作者资料与社交分享链接…',
          phase: 'running'
        });
        return {
          ...profile,
          authorInfo: await authorProfiles.bundle(profile.authorInfo, signal, { force: true })
        };
      }
    : undefined,
  onSelection: (works) => {
    if (!managedPresentation) return;
    const keepUiFocus = ui && !ui.isDestroyed() && ui.isFocused();
    if (works) workWindows.select(works);
    else workWindows.leave();
    syncPresentation();
    if (keepUiFocus && !ui.isDestroyed() && !ui.isFocused()) ui.focus();
  },
  send,
  publish: (result, project) => {
    browserGeneration++;
    browserPreviewAbort.abort();
    browserPreviewAbort = new AbortController();
    currentResult = result;
    currentLocalProject = Boolean(result.localProject);
    store = project;
    send('result', result);
    scanImageInfo(result, project);
    send('project', {
      ...store.summary(),
      root: outputDirectory,
      ...(result.localProject ? { manifestPath: project.profile.manifestPath } : {})
    });
  }
});
async function readPage(input, options = {}) {
  if (profileAddress(input)) return openAuthor(input, options);
  if (authorService.reading) throw new Error('请先停止读取选集。');
  if (task || saveTask || queue?.active || downloadSetup) throw new Error('请先结束当前任务。');
  authorService.clear();
  return runExtraction(input, options);
}
async function openAuthor(input, options = {}) {
  if (task || saveTask || queue?.active || downloadSetup || localProjectOpening)
    throw new Error('请先结束当前任务，再读取作者主页。');
  exportOptions = { ...exportOptions, ...sanitizeOptions(options) };
  return authorService.open(input, options);
}
async function finishExtraction(result, options) {
  browserGeneration++;
  browserPreviewAbort.abort();
  browserPreviewAbort = new AbortController();
  currentResult = result;
  exportOptions = { ...exportOptions, ...sanitizeOptions(options) };
  send('result', currentResult);
  store = new ProjectStore(outputDirectory);
  store.options = exportOptions;
  send('project', { ...store.summary(), root: outputDirectory });
  lastWorkMetadata = currentResult.metadata;
  const d = currentResult.diagnostics;
  if (result.metadata.canvasAccess === 'not-public') {
    status(result.metadata.canvasNote, 'done');
    return currentResult;
  }
  status(
    `读取完成：${d.nodeCount} 个节点，${d.readableTextCount ?? currentResult.entries.filter((e) => e.kind === 'text' && e.prompt.trim()).length} 个可读文本节点，${d.directGenerationCount ?? currentResult.entries.filter((e) => e.kind !== 'text' && e.prompt.trim()).length} 条直接提示词，${d.linkedGenerationCount ?? currentResult.entries.filter((e) => e.kind !== 'text' && e.referenceTexts.length).length} 个生成节点有关联文本，${currentResult.assets.length} 个项目资产。`,
    'done'
  );
  return currentResult;
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== ui.webContents || event.senderFrame?.url !== uiUrl)
      throw new Error('不允许此页面操作实验程序。');
    try {
      if (
        authorService?.listing &&
        [
          'lab:open-local-project',
          'lab:extract',
          'lab:save',
          'lab:save-text',
          'lab:update',
          'lab:download',
          'lab:directory',
          'lab:reset-browser'
        ].includes(channel)
      )
        throw new Error('正在读取作者列表，请稍候或先停止读取。');
      if (browserResetting && !['lab:reset-browser', 'lab:info'].includes(channel))
        throw new Error('浏览器正在重置，请稍候。');
      if (
        localProjectOpening &&
        [
          'lab:open-local-project',
          'lab:extract',
          'lab:save',
          'lab:save-text',
          'lab:update',
          'lab:download',
          'lab:directory',
          'lab:reset-browser'
        ].includes(channel)
      )
        throw new Error('正在打开本地项目，请稍候。');
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        code: error.code || 'OPERATION_FAILED',
        platform: error.platform
      };
    }
  });
}
async function openLocalProject(input = '') {
  if (task || saveTask || queue?.active || downloadSetup)
    throw new Error('请先结束读取、保存或下载任务，再打开本地项目。');
  if (typeof input !== 'string') throw new Error('本地项目路径无效。');
  localProjectOpening = true;
  try {
    let target = input.trim();
    const currentPath = currentLocalProject && isCurrentProjectPath(target, store.directory);
    if (!target || currentPath) {
      const selected = await dialog.showOpenDialog(ui, {
        title: '打开本地项目：选择画布项目或作者项目索引',
        defaultPath: currentPath
          ? path.dirname(store.directory)
          : store.directory || outputDirectory,
        properties: ['openFile', 'showHiddenFiles'],
        filters: [{ name: '画布项目记录', extensions: ['json'] }]
      });
      if (selected.canceled || !selected.filePaths.length) return { cancelled: true };
      target = selected.filePaths[0];
    }
    const loaded = await loadLocalProject(target);
    authorService.clear();
    if (loaded.collection) {
      queue = null;
      exportOptions = {
        ...exportOptions,
        ...sanitizeOptions(loaded.records.values().next().value.store.options)
      };
      authorService.openLocal(loaded);
      return { manifestPath: loaded.manifestPath, collection: true };
    }
    // Commit only after the entire project has been validated. Failed opens preserve the current project.
    browserGeneration++;
    browserPreviewAbort.abort();
    browserPreviewAbort = new AbortController();
    store = loaded.store;
    currentResult = loaded.result;
    currentLocalProject = true;
    queue = null;
    exportOptions = { ...exportOptions, ...sanitizeOptions(store.options) };
    store.options = exportOptions;
    send('result', { ...currentResult, localProject: true });
    send('project', { ...store.summary(), manifestPath: loaded.manifestPath });
    scanImageInfo(currentResult, store);
    const missing = currentResult.assets.filter((a) => a.error === '本地文件缺失或不完整').length;
    status(
      `本地项目已打开：${currentResult.entries.length} 条提示词与文本，${currentResult.assets.filter((a) => a.state === 'done').length} 个本地素材。${missing ? ' ' + missing + ' 个素材文件缺失或不完整。' : ''}`,
      'done'
    );
    return { manifestPath: loaded.manifestPath };
  } finally {
    localProjectOpening = false;
  }
}
function canvasContext() {
  const profile = authorService.snapshot();
  if (profile)
    return {
      key: 'author|' + profile.platform + '|' + profile.uuid,
      works: profile.works
        .filter((w) => profile.selectedIds.includes(w.id) && w.canvasAccess !== 'not-public')
        .map(({ id, title, url }) => ({ id, title, url }))
    };
  if (!currentResult || currentResult.metadata.canvasAccess === 'not-public')
    return { key: 'empty', works: [] };
  const metadata = currentResult.metadata;
  const id = metadata.workIdentity || metadata.canvasUrl || metadata.inputUrl;
  return {
    key: 'work|' + id,
    works: [{ id, title: metadata.title, url: metadata.canvasUrl || metadata.inputUrl }]
  };
}
async function collectBrowserSessions() {
  browserSessions.add(session.defaultSession);
  for (const { id: platform } of listPlatforms())
    browserSessions.add(session.fromPartition('persist:' + platform));
  const knownPaths = new Set(
    [...browserSessions]
      .map((ses) => ses.getStoragePath())
      .filter(Boolean)
      .map((value) => path.resolve(value).toLowerCase())
  );
  const partitions = path.join(app.getPath('userData'), 'Partitions');
  const directories = await fs.readdir(partitions, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of directories.filter((entry) => entry.isDirectory())) {
    const directory = path.resolve(partitions, entry.name);
    if (!knownPaths.has(directory.toLowerCase())) browserSessions.add(session.fromPath(directory));
  }
  return [...browserSessions];
}
async function resetBrowser(settings) {
  if (browserResetting) throw new Error('浏览器正在重置，请稍候。');
  if (task || saveTask || queue?.active || downloadSetup)
    throw new Error('请先结束读取、保存或下载任务，再重置浏览器。');
  browserResetting = true;
  browserGeneration++;
  browserPreviewAbort.abort();
  send('browser-resetting', true);
  try {
    const sessions = await collectBrowserSessions();
    const result = await resetBrowserData({
      sessions,
      settings,
      closePages: async () => {
        await extractionFeedback?.dispose();
        extractionFeedback = null;
        platformWindow = null;
        currentPlatform = '';
        lastWorkMetadata = null;
        lastAttemptWork = null;
        independentBrowser.dispose();
        accounts.reset();
        workWindows.reset();
        authorProfiles.cache.clear();
        for (const win of BaseWindow.getAllWindows())
          if (win !== ui && !win.isDestroyed()) win.destroy();
        await Promise.allSettled([...thumbnailWrites]);
        send('platform-reset', managedPresentation ? { visible: platformVisible } : null);
      },
      clearThumbnails: async () => {
        const target = path.resolve(thumbnailRoot);
        if (path.relative(path.resolve(thumbnailRuntime), target) !== 'thumbnails')
          throw new Error('缩略图缓存目录无效。');
        await fs.rm(target, { recursive: true, force: true });
      },
      restoreSettings: async (retained) => {
        if (!ui || ui.isDestroyed()) throw new Error('程序已关闭，浏览器重置未完成。');
        // JSON is inserted into JavaScript directly, never into a shell command.
        await ui.webContents.executeJavaScript(
          'Object.entries(' +
            JSON.stringify(retained) +
            ').forEach(([key,value])=>localStorage.setItem(key,value))'
        );
      }
    });
    for (const { id: platform } of listPlatforms())
      send('account', {
        platform,
        state: 'logged-out',
        checking: false,
        label: '浏览器已重置，点击打开平台登录'
      });
    return result;
  } finally {
    browserPreviewAbort = new AbortController();
    browserResetting = false;
    send('browser-resetting', false);
  }
}
function savingOperation() {
  return Boolean(saveTask || downloadSetup);
}
function sanitizeOptions(options = {}) {
  const kinds = Array.isArray(options.kinds) ? promptKinds(options.kinds) : exportOptions.kinds;
  return {
    kinds,
    split: Boolean(options.split),
    mode: options.mode === 'full' ? 'full' : 'simple'
  };
}
async function updateExport(options = {}) {
  if (saveTask || queue?.active || downloadSetup || (task && !authorService.active))
    throw new Error('请先结束当前任务。');
  exportOptions = { ...exportOptions, ...sanitizeOptions(options) };
  store.options = exportOptions;
  return { options: exportOptions, project: store.summary() };
}
async function ensureProject() {
  if (!currentResult) throw new Error('请先读取画布。');
  if (authorService.active) {
    if (currentResult.authorProfile.pending) throw new Error('所选作品正在读取，请稍候。');
    if (!currentResult.authorProfile.loadedIds.length) throw new Error('请先选中并成功读取作品。');
    if (
      currentResult.authorProfile.selectedIds.length !==
      currentResult.authorProfile.loadedIds.length
    )
      throw new Error('部分所选作品读取失败，请重试或取消选择失败作品。');
    const candidate = store;
    await candidate.prepare();
    store = candidate;
    send('assets', currentResult.assets);
    return candidate;
  }
  if (store.result !== currentResult || !store.directory) {
    const candidate = new ProjectStore(outputDirectory);
    await candidate.create(currentResult, exportOptions, false);
    store = candidate;
    send('assets', currentResult.assets);
    scanImageInfo(currentResult, candidate);
  } else await store.checkpoint();
  return store;
}
async function savePrompts(options) {
  if (task || saveTask || queue?.active || downloadSetup) throw new Error('请先结束当前任务。');
  exportOptions = { ...exportOptions, ...sanitizeOptions(options) };
  store.options = exportOptions;
  if (!exportOptions.kinds.length) throw new Error('请至少勾选一种提示词类型。');
  if (
    !filterResult(currentResult || { entries: [], assets: [], edges: [] }, exportOptions.kinds)
      .entries.length
  )
    throw new Error('勾选的类别没有可保存内容。');
  const token = { cancelled: false };
  saveTask = token;
  try {
    const project = await ensureProject();
    const saved = await project.save(true, token);
    send('project', saved);
    return saved;
  } finally {
    if (saveTask === token) saveTask = null;
  }
}
function editedResult(options) {
  if (!currentResult) throw new Error('请先提取一份结果。');
  const kinds = Array.isArray(options.kinds) ? promptKinds(options.kinds) : [];
  if (!kinds.length) throw new Error('请至少勾选一种内容。');
  const result = filterResult(currentResult, kinds);
  result.metadata = { ...result.metadata };
  if (!result.entries.length) throw new Error('勾选的类型没有可导出内容。');
  return result;
}
function createQueue() {
  const project = store,
    result = currentResult,
    authorWorkIds = result.authorProfile?.loadedIds;
  const fetcher = createMediaFetcher({ session, metadata: result.metadata });
  return new DownloadQueue({
    catalog: result.assets,
    fetcher,
    filePath: (a) => project.assetPath(a),
    onProgress: (progress) => {
      if (authorWorkIds || currentResult === result)
        send('downloads', { ...progress, authorWorkIds });
    },
    onPrepare: async (selected) => {
      try {
        await project.prepareRedownload(selected.map((a) => a.id));
      } finally {
        await project.checkpoint();
        if (authorWorkIds) authorService.refresh({ assetsOnly: true });
        else if (currentResult === result) {
          send('assets', result.assets);
          send('project', project.summary());
        }
      }
    },
    onSettled: async (asset) => {
      await project.checkpoint();
      if (asset?.kind === 'image' && asset.state === 'done')
        scanImageInfo(result, project, [asset]);
      if (authorWorkIds) authorService.refresh({ assetsOnly: true });
      else if (currentResult === result) {
        send('assets', result.assets);
        send('project', project.summary());
      }
    }
  });
}
function thumbnailPath(asset) {
  if (!/^[a-f0-9]{24}$/.test(asset.id)) throw new Error('素材标识无效。');
  return path.join(thumbnailRoot, asset.id + '.png');
}
async function cachedThumbnailPath(asset) {
  const current = thumbnailPath(asset);
  try {
    await fs.access(current);
    return current;
  } catch {
    const legacy = path.join(thumbnailRoot, asset.id + '_' + (Number(asset.bytes) || 0) + '.png');
    await fs.access(legacy);
    return legacy;
  }
}
const mediaProtocol = createMediaProtocol({
  protocol,
  net,
  session,
  cachedThumbnailPath,
  diagnostic: isolatedVerification,
  getContext: () => ({
    currentResult,
    store,
    currentLocalProject,
    browserGeneration,
    browserPreviewAbort,
    browserResetting,
    mode: exportOptions.mode
  })
});
if (ownsInstance)
  app
    .whenReady()
    .then(async () => {
      installDevToolsMenu();
      outputDirectory = isolatedVerification
        ? verificationPath(
            ROOT,
            process.argv.includes('--verify-authors')
              ? 'v1.4/live-projects-' + Date.now()
              : 'projects'
          )
        : readOutputDirectory(
            outputPreferencePath,
            path.join(app.getPath('desktop'), '自由画布提取')
          );
      store = new ProjectStore(outputDirectory);
      mediaProtocol.install();
      canvasBrowser = new CanvasBrowserWindow({
        icon: APP_ICON,
        getContext: canvasContext,
        onError: (message) => status(message, 'error')
      });
      ui = new BrowserWindow({
        icon: APP_ICON,
        width: 1440,
        height: 960,
        minWidth: 680,
        minHeight: 620,
        show: !isolatedVerification,
        title: transparentRendering ? '自由画布提取 · v1.4 · 透明读取试用' : '自由画布提取 · v1.4',
        backgroundColor: uiTheme.tokens.bg,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: !isolatedVerification,
          offscreen: isolatedVerification && !process.argv.includes('--verify-selection-flow')
        }
      });
      ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      ui.on('closed', () => {
        ui = null;
        app.quit();
      });
      ui.webContents.on('will-navigate', (event, url) => {
        if (url !== uiUrl) event.preventDefault();
      });
      handle('lab:extract', (input, options) => readPage(input, options || {}));
      handle('lab:author', openAuthor);
      handle('lab:social-login', (platform) => {
        independentBrowser.openSocial(platform);
        return true;
      });
      handle('lab:browser-open', (input) => {
        independentBrowser.open(input);
        return true;
      });
      handle('lab:browser-login-all', () => independentBrowser.openAll());
      handle('lab:social-profile-preference', async (enabled) => {
        if (typeof enabled !== 'boolean') throw new Error('无效的社交资料读取设置。');
        socialPreferenceWriteTail = socialPreferenceWriteTail
          .catch(() => {})
          .then(async () => {
            await saveSocialPreference(socialPreferencePath, enabled);
            authorProfiles.setEnabled(enabled);
          });
        await socialPreferenceWriteTail;
        return authorProfiles.enabled;
      });
      handle('lab:author-select', (ids) => {
        if (savingOperation() || browserResetting || localProjectOpening)
          throw new Error('请先结束当前操作。');
        return authorService.select(ids);
      });
      handle('lab:author-read', (options = {}) => {
        if (task || savingOperation() || queue?.active || browserResetting || localProjectOpening)
          throw new Error('请先结束当前操作。');
        exportOptions = { ...exportOptions, ...sanitizeOptions(options) };
        return authorService.start(options);
      });
      handle('lab:author-retry', (id) => {
        if (savingOperation() || browserResetting || localProjectOpening)
          throw new Error('请先结束当前操作。');
        return authorService.retry(id);
      });
      handle('lab:theme', async (value) => {
        appearancePreference = normalizePreference(value);
        const preference = { ...appearancePreference };
        const resolved = await refreshAppearance();
        themeWriteTail = themeWriteTail
          .catch(() => {})
          .then(() => fs.writeFile(appearancePath, JSON.stringify(preference, null, 2), 'utf8'));
        await themeWriteTail;
        return resolved;
      });
      nativeTheme.on('updated', () => {
        if (appearancePreference.mode === 'system')
          void refreshAppearance().catch((error) => status(error.message, 'error'));
      });
      handle('lab:cancel', () => {
        authorService.stop();
        extractionScope.cancel();
        return true;
      });
      handle('lab:visible', (visible) => {
        if (managedPresentation) return setPlatformVisible(visible);
        if (!platformWindow || platformWindow.isDestroyed()) throw new Error('请先打开一个作品。');
        if (!visible && transparentRendering && task?.window === platformWindow) {
          beginTransparentRead(platformWindow);
        } else {
          endTransparentRead(platformWindow, Boolean(visible));
          visible ? platformWindow.show() : platformWindow.hide();
        }
        extractionFeedback?.syncVisibility();
        send('platform-visible', Boolean(visible));
        return visible;
      });
      handle('lab:update', (options) => updateExport(options));
      handle('lab:save', (options) => savePrompts(options));
      handle('lab:save-text', async (nodeId) => {
        if (task || saveTask || queue?.active || downloadSetup)
          throw new Error('请先结束当前任务。');
        const entry = currentResult?.entries.find((e) => e.nodeId === nodeId && e.kind === 'text');
        if (typeof nodeId !== 'string' || !entry?.prompt?.trim())
          throw new Error('此文本节点没有可保存的正文。');
        const token = { cancelled: false };
        saveTask = token;
        try {
          const project = await ensureProject();
          const saved = await project.saveText(nodeId);
          send('project', saved);
          return saved;
        } finally {
          if (saveTask === token) saveTask = null;
        }
      });
      handle('lab:save-cancel', () => {
        if (saveTask) saveTask.cancelled = true;
        return true;
      });
      handle('lab:text-file', async (nodeId, reveal = false) => {
        if (!currentResult?.entries.some((e) => e.nodeId === nodeId && e.kind === 'text'))
          throw new Error('未找到当前文本节点。');
        const info = await store.textFileInfo(nodeId);
        if (reveal === true) {
          if (!info.saved) throw new Error('当前文本尚未保存，或本地正文已变化，请重新下载文本。');
          shell.showItemInFolder(info.file);
        }
        return { saved: info.saved, fileName: info.fileName || '' };
      });
      handle('lab:copy', (options) => {
        const result = editedResult(options || {});
        clipboard.writeText(markdown(result));
        return true;
      });
      handle('lab:copy-text', async (text) => {
        if (typeof text !== 'string' || text.length > 2000000) throw new Error('复制内容无效。');
        await clipboard.writeText(text);
        return true;
      });
      handle('lab:cache-thumbnail', async (id, data) => {
        const a = currentResult?.assets.find((a) => a.id === id);
        if (
          !a ||
          a.kind !== 'video' ||
          typeof data !== 'string' ||
          data.length > 1024 * 1024 ||
          !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)
        )
          throw new Error('缩略图数据无效。');
        const bytes = Buffer.from(data.split(',')[1], 'base64');
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          throw new Error('缩略图格式无效。');
        const writing = (async () => {
          await fs.mkdir(thumbnailRoot, { recursive: true });
          await fs.writeFile(thumbnailPath(a), bytes);
        })();
        thumbnailWrites.add(writing);
        try {
          await writing;
          return true;
        } finally {
          thumbnailWrites.delete(writing);
        }
      });
      handle('lab:thumbnail-info', async (id) => {
        const a = currentResult?.assets.find((a) => a.id === id);
        if (!a || a.kind !== 'video') return false;
        return cachedThumbnailPath(a).then(
          () => true,
          () => false
        );
      });
      handle('lab:image-info', async (id, options) => {
        const result = currentResult,
          asset = result?.assets.find((a) => a.id === id);
        if (!asset || asset.kind !== 'image') throw new Error('未找到当前图片。');
        if (asset.state !== 'done') return { status: 'needs-download', assetId: id };
        const file = store.assetPath(asset);
        const info = await imageInfo.read(asset, file, {
          force: options?.force === true,
          priority: true
        });
        publishImageBrands(result, [info]);
        return info;
      });
      handle('lab:image-info-details', async (id) => {
        const asset = currentResult?.assets.find((a) => a.id === id);
        if (!asset || asset.kind !== 'image' || asset.state !== 'done')
          throw new Error('请先下载当前图片。');
        return imageInfo.details(asset, store.assetPath(asset));
      });
      handle('lab:directory', async () => {
        if (task || saveTask || queue?.active) throw new Error('请先结束当前任务再更换保存位置。');
        if (store.directory) throw new Error('当前项目已建立，请在下一个项目首次保存前选择位置。');
        const r = await dialog.showOpenDialog(ui, {
          title: '选择项目保存根目录',
          defaultPath: outputDirectory,
          properties: ['openDirectory', 'createDirectory']
        });
        if (!r.canceled) {
          outputDirectory = await saveOutputDirectory(outputPreferencePath, r.filePaths[0]);
          if (authorService.active) authorService.refresh();
          else {
            store = new ProjectStore(outputDirectory);
            store.options = exportOptions;
            send('project', { ...store.summary(), root: outputDirectory });
          }
        }
        return outputDirectory;
      });
      handle('lab:open-folder', async () => {
        if (currentResult && !task && !saveTask && !queue?.active && !downloadSetup) {
          if (authorService.active) await store.prepare();
          else await ensureProject();
          send('project', store.summary());
        }
        const dir = store.directory || store.authorDirectory || outputDirectory;
        await fs.mkdir(dir, { recursive: true });
        const err = await shell.openPath(dir);
        if (err) throw new Error(err);
        return true;
      });
      handle('lab:open-local-project', openLocalProject);
      handle('lab:open-canvas', () => {
        return canvasBrowser.open();
      });
      handle('lab:reveal', async (id) => {
        const a = currentResult?.assets.find((a) => a.id === id);
        if (!a || a.state !== 'done') throw new Error('此素材尚未下载。');
        const file = store.assetPath(a);
        await fs.access(file);
        shell.showItemInFolder(file);
        return true;
      });
      handle('lab:download', async (options) => {
        if (task || saveTask) throw new Error('请先结束读取或保存任务。');
        if (downloadSetup) throw new Error('下载正在准备，请稍候。');
        if (exportOptions.mode !== 'full') throw new Error('请切换到全能模式。');
        const kinds = (options?.kinds || []).filter((k) => ['image', 'video', 'audio'].includes(k));
        if (!kinds.length) throw new Error('请至少选择一种素材类型。');
        if (!currentResult) throw new Error('请先读取画布。');
        const targets = selectDownloadAssets(currentResult.assets, options?.ids);
        if (queue?.active) {
          if (!options?.ids || options.force || options.retryOnly)
            throw new Error('下载正在进行。');
          if (!targets.every((a) => kinds.includes(a.kind)))
            throw new Error('所选素材与下载类别不一致。');
          return queue.prioritize(targets[0].id);
        }
        downloadSetup = true;
        try {
          await ensureProject();
          send('project', store.summary());
          queue = createQueue();
          queue
            .start(targets, kinds, Boolean(options.retryOnly), Boolean(options.force))
            .catch((e) => status(e.message, 'error'));
          return true;
        } finally {
          downloadSetup = false;
        }
      });
      handle('lab:download-control', (action) => {
        if (!queue?.active) throw new Error('没有正在运行的下载任务。');
        if (action === 'pause') queue.pause();
        else if (action === 'resume') queue.resume();
        else if (action === 'cancel') queue.cancel();
        else throw new Error('不支持的下载操作。');
        return true;
      });
      handle('lab:login', (platform) => {
        independentBrowser.openPlatform(platform);
        return true;
      });
      handle('lab:reset-browser', resetBrowser);
      handle('lab:info', () => ({
        platforms: listPlatforms(),
        outputDirectory,
        types: PROMPT_TYPES,
        options: exportOptions,
        platformVisible,
        socialProfilesEnabled: authorProfiles.enabled
      }));
      await ui.loadFile(path.join(__dirname, 'ui', 'index.html'));
      if (transparentRendering && !managedPresentation)
        await ui.webContents.executeJavaScript(
          "document.getElementById('show-first').checked=false"
        );
      if (isolatedVerification)
        ui.webContents.on('console-message', (event) =>
          console.log('Renderer:', event.level, event.message)
        );
      // The Windows launcher hides its helper process; show the app again once ready.
      if (!isolatedVerification) {
        ui.show();
        ui.focus();
      }
      if (process.argv.includes('--verify-author-profiles')) {
        await require('../开发辅助/验收工具/检查项/verify-author-profiles.cjs')({
          root: ROOT,
          ui,
          authorProfiles
        });
        app.quit();
        return;
      }
      if (process.argv.includes('--verify-social-options')) {
        await require('../开发辅助/验收工具/检查项/verify-social-options.cjs')({
          root: ROOT,
          ui,
          authorProfiles,
          socialPreferencePath
        });
        app.quit();
        return;
      }
      if (process.argv.includes('--verify-selection-live')) {
        await require('../开发辅助/验收工具/检查项/verify-selection-live.cjs')({
          ui,
          root: ROOT,
          authorService,
          workWindows,
          workCache
        });
        app.quit();
        return;
      }
      if (process.argv.includes('--verify-selection-flow')) {
        await require('../开发辅助/验收工具/检查项/verify-selection-flow.cjs')({
          ui,
          root: ROOT,
          app,
          session,
          authorService,
          workWindows,
          workCache,
          getResult: () => currentResult,
          getVisibleWindow: () => platformWindow,
          visibilityPath
        });
        app.quit();
        return;
      }
      if (process.argv.includes('--verify-authors')) {
        await require('../开发辅助/验收工具/检查项/verify-authors-live.cjs')({
          ui,
          root: ROOT,
          authorService,
          getResult: () => currentResult,
          getStore: () => store,
          savePrompts
        });
        app.exit(0);
        return;
      }
      if (process.argv.includes('--verify-transparent-rendering')) {
        await require('../开发辅助/验收工具/检查项/verify-transparent-rendering.cjs')({
          ui,
          root: ROOT,
          app,
          runExtraction,
          authorService,
          getWindow: () => platformWindow,
          getFeedback: () => extractionFeedback
        });
        app.exit(0);
        return;
      }
      if (process.argv.includes('--verify-hidden-rendering')) {
        await require('../开发辅助/验收工具/检查项/verify-hidden-rendering.cjs')({
          ui,
          root: ROOT,
          app,
          runExtraction,
          authorService,
          getWindow: () => platformWindow,
          getFeedback: () => extractionFeedback
        });
        app.exit(0);
        return;
      }
      if (process.argv.includes('--verify-image-info')) {
        await require('../开发辅助/验收工具/检查项/verify-image-info.cjs')({
          ui,
          root: ROOT,
          independentBrowser
        });
        await require('../开发辅助/验收工具/检查项/verify-reader-media.cjs')({ ui, root: ROOT });
        await imageInfo.close();
        app.exit(0);
        return;
      }
      if (verifyV12) {
        await require('../开发辅助/验收工具/检查项/verify-v12.cjs')({
          ui,
          root: ROOT,
          accounts,
          session,
          runExtraction,
          getStore: () => store
        });
        app.exit(0);
        return;
      }
      if (verifyDeadline) {
        await require('../开发辅助/验收工具/检查项/verify-read-deadline.cjs')({
          root: ROOT,
          ui,
          runExtraction,
          getWindow: () => platformWindow,
          getFeedback: () => extractionFeedback,
          session
        });
        app.exit(0);
        return;
      }
      if (process.argv.includes('--verify-canvas-browser')) {
        await require('../开发辅助/验收工具/检查项/verify-canvas-browser.cjs')({
          ui,
          root: ROOT,
          canvasBrowser,
          authorService,
          session,
          dialog,
          getResult: () => currentResult,
          getLocal: () => currentLocalProject
        });
        app.exit(0);
        return;
      }
      if (verifyLocalProject) {
        await require('../开发辅助/验收工具/检查项/verify-local-project.cjs')({
          ui,
          root: ROOT,
          dialog,
          session,
          getStore: () => store,
          setTasks: (values) => {
            task = values.task || null;
            saveTask = values.saveTask || null;
            queue = values.queue || null;
            downloadSetup = Boolean(values.downloadSetup);
          }
        });
        app.exit(0);
        return;
      }
      if (verifyBrowserReset) {
        await require('../开发辅助/验收工具/检查项/verify-browser-reset.cjs')({
          ui,
          accounts,
          independentBrowser,
          session,
          root: ROOT,
          thumbnailRoot,
          getWindow: () => platformWindow,
          setResult: (value) => {
            currentResult = value;
          },
          setTasks: (values) => {
            task = values.task || null;
            saveTask = values.saveTask || null;
            queue = values.queue || null;
            downloadSetup = Boolean(values.downloadSetup);
          }
        });
        app.exit(0);
        return;
      }
      if (verifyAccounts) {
        await require('../开发辅助/验收工具/检查项/verify-account-startup.cjs')({
          ui,
          accounts,
          independentBrowser,
          getWindow: () => platformWindow,
          session,
          root: ROOT
        });
        app.exit(0);
        return;
      }
      if (verifyThemes) {
        await require('../开发辅助/验收工具/检查项/verify-themes.cjs')({
          ui,
          root: ROOT,
          setFeedback: (value) => {
            extractionFeedback = value;
          },
          getTheme: () => uiTheme
        });
        app.exit(0);
        return;
      }
      if (verifyExtraction) {
        await require('../开发辅助/验收工具/检查项/verify-extraction.cjs')({
          root: ROOT,
          runExtraction,
          getWindow: () => platformWindow,
          getFeedback: () => extractionFeedback,
          ui
        });
        app.once('will-quit', () =>
          fsSync.writeFileSync(
            verificationPath(ROOT, 'extraction-quit-report.json'),
            JSON.stringify(
              { passed: true, reason: '主程序关闭后正常进入 will-quit，独立浮层未阻止退出。' },
              null,
              2
            )
          )
        );
        ui.close();
        return;
      }
      if (live) {
        const passed = await require('../开发辅助/验收工具/live-verification.cjs')({
          root: ROOT,
          argv: process.argv,
          runExtraction,
          ensureProject,
          createQueue
        });
        app.exit(passed ? 0 : 1);
      }
    })
    .catch(async (error) => {
      console.error(error.stack || error.message);
      await imageInfo.close().catch((cleanupError) => console.error(cleanupError.message));
      await workCache.close().catch((cleanupError) => console.error(cleanupError.message));
      app.exit(1);
    });
let shutdownReady = false,
  shutdownPending = null;
app.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownPending) return;
  app.quitting = true;
  canvasBrowser?.dispose();
  independentBrowser.dispose();
  accounts.dispose();
  authorProfiles.dispose();
  authorService?.stop();
  extractionScope.cancel();
  if (saveTask) saveTask.cancelled = true;
  if (queue?.active) queue.cancel();
  shutdownPending = Promise.allSettled([
    imageInfo.close(),
    workCache.close(),
    visibilityWriteTail,
    socialPreferenceWriteTail
  ]).then((results) => {
    for (const result of results)
      if (result.status === 'rejected') console.error(result.reason.message);
    shutdownReady = true;
    app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (ui && !ui.isDestroyed()) ui.show();
});
process.on('uncaughtException', (error) => {
  console.error(error.message);
  if (isolatedVerification) app.exit(1);
});
