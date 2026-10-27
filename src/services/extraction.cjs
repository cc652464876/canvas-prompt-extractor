'use strict';
const { verificationPath } = require('../app-paths.cjs');
const fs = require('node:fs/promises'),
  path = require('node:path');
const { normalize } = require('../normalize.cjs');
const { publishedWork } = require('../published-work.cjs');
const { inspectPublished } = require('../platforms/published-page.cjs');
const { ProjectStore } = require('../project-store.cjs');
const { boundedRead } = require('../read-deadline.cjs');
const { loadWork, watchPageFailures, pageLoadError } = require('../page-navigation.cjs');
const { reuseWorkPage, reusableDocument } = require('../read-policy.cjs');
const { leftRequestedWork } = require('../extraction-policy.cjs');
const { ExtractionFeedback } = require('../extraction-feedback.cjs');
const { holdPageAudio } = require('../page-audio.cjs');
const { getAdapter, resolvePlatform, matchesFrame } = require('../platforms/registry.cjs');
const { snapshotSignature } = require('./snapshot-stability.cjs');
const { beginTransparentRead, endTransparentRead } = require('../platform-presentation.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function createExtractionService({
  root: ROOT,
  app,
  scope,
  getState,
  updateState,
  getPlatformWindow,
  send,
  status,
  finishExtraction,
  getTheme,
  hiddenRendering = false,
  transparentRendering = false,
  presentWindow = null,
  enrichResult = null,
  live = false
}) {
  function ensureTask(token) {
    scope.ensure(token);
  }
  async function evaluateFrame(frame, code, token) {
    return boundedRead(() => frame.executeJavaScript(code), {
      timeoutMs: 10000,
      deadline: token?.deadline,
      signal: token?.controller.signal
    });
  }
  async function scanFrames(window, token) {
    const frames = token.contents.mainFrame.framesInSubtree;
    const adapter = getAdapter(token.platform);
    const allowed = frames.filter((frame) => matchesFrame(token.platform, frame.url));
    const values = await Promise.allSettled(
      allowed.map((frame) =>
        evaluateFrame(frame, '(' + adapter.page.readCanvas.toString() + ')()', token)
      )
    );
    if (token) {
      ensureTask(token);
      if (Date.now() >= token.deadline)
        throw Object.assign(new Error('读取画布超过等待期限，请显示平台页面检查后重试。'), {
          code: 'READ_DEADLINE'
        });
    }
    if (live && !values.some((r) => r.status === 'fulfilled' && r.value?.found)) {
      await fs.writeFile(
        verificationPath(ROOT, token.platform + '-frame-check.json'),
        JSON.stringify(
          values.map((r, i) => ({
            url: allowed[i].url,
            result: r.status === 'fulfilled' ? r.value : r.reason.message
          })),
          null,
          2
        )
      );
    }
    const snapshots = values
      .filter((r) => r.status === 'fulfilled' && r.value?.found)
      .map((r) => r.value);
    snapshots.sort((a, b) => b.nodes.length - a.nodes.length);
    return snapshots[0];
  }
  async function runExtraction(input, options = {}) {
    let {
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
    } = getState();
    let currentResult = null;
    if (task) throw new Error('已有任务运行中，请先取消或等待完成。');
    if (queue?.active || saveTask || downloadSetup)
      throw new Error('请先停止下载或保存任务，再读取新项目。');
    const { platform, url } = resolvePlatform(input);
    const adapter = getAdapter(platform);
    adapter.validateWorkUrl?.(url);
    let reuseCurrent =
      !options.forceRead &&
      reuseWorkPage({
        requestedUrl: url,
        platform,
        attempt: lastAttemptWork,
        windowUrl:
          platformWindow && !platformWindow.isDestroyed()
            ? platformWindow.webContents.getURL()
            : '',
        windowPlatform: currentPlatform,
        windowAvailable: Boolean(platformWindow && !platformWindow.isDestroyed())
      });
    const reuseMetadata =
      reuseCurrent && lastWorkMetadata?.inputUrl === url ? lastWorkMetadata : null;
    const token = scope.begin(platform, url);
    task = token;
    const store = new ProjectStore(outputDirectory);
    store.options = exportOptions;
    updateState({ task: token, currentResult: null, currentLocalProject: false, store });
    send('reset', null);
    let window;
    const transparentRead = transparentRendering && !options.visible;
    // Keep the normal Chromium window rendering without automatically showing it.
    // Legacy visible initialization remains available for a controlled fallback.
    let needsVisibleLoad = !hiddenRendering && adapter.requiresVisibleLoad && !reuseCurrent;
    const metadata = {
      platform,
      inputUrl: url,
      resolvedUrl: url,
      title: reuseMetadata?.title || '',
      author: reuseMetadata?.author || '',
      ...(reuseMetadata?.workInfo ? { workInfo: { ...reuseMetadata.workInfo } } : {}),
      ...(reuseMetadata?.fullVideo ? { fullVideo: reuseMetadata.fullVideo } : {})
    };
    if (options.workHint?.url === url) {
      const work = options.workHint;
      metadata.workId = work.id;
      metadata.title = work.title || metadata.title;
      if (work.fullVideo) metadata.fullVideo = work.fullVideo;
      if (work.canvasId) metadata.canvasId = work.canvasId;
    }
    try {
      await extractionFeedback?.dispose();
      window = getPlatformWindow(platform, Boolean(options.visible) || needsVisibleLoad, true, url);
      token.window = window;
      // Pin and mute before presentation, navigation or asynchronous setup.
      // The window getter follows the active tab; the task must keep its page.
      token.contents = window.webContents;
      token.releaseAudio = holdPageAudio(token.contents);
      window.browserToolbar?.syncAudio?.();
      if (presentWindow) presentWindow(window);
      else {
        if (!options.visible && !needsVisibleLoad) window.hide();
        if (transparentRead) beginTransparentRead(window);
      }
      reuseCurrent =
        reuseCurrent &&
        reuseWorkPage({
          requestedUrl: url,
          platform,
          attempt: lastAttemptWork,
          windowUrl: token.contents.getURL(),
          windowPlatform: platform,
          windowAvailable: true
        });
      token.navigation = watchPageFailures(token.contents, (record) => {
        try {
          const parsed = new URL(record.url);
          record.url = parsed.origin + parsed.pathname;
        } catch {
          record.url = '';
        }
        void fs
          .appendFile(
            path.join(app.getPath('userData'), 'extraction-cleanup.jsonl'),
            JSON.stringify({
              time: new Date().toISOString(),
              platform,
              operation: 'page-load-failed',
              ...record
            }) + '\n'
          )
          .catch(() => {});
      });
      if (reuseCurrent) {
        try {
          reuseCurrent = await boundedRead(
            () =>
              token.contents.mainFrame.executeJavaScript('(' + reusableDocument.toString() + ')()'),
            { timeoutMs: 1500, signal: token.controller.signal }
          );
        } catch {
          ensureTask(token);
          reuseCurrent = false;
        }
        needsVisibleLoad = !hiddenRendering && adapter.requiresVisibleLoad && !reuseCurrent;
      }
      if (!token.contents.getURL()) await token.contents.loadURL('about:blank');
      extractionFeedback = new ExtractionFeedback(window, {
        webContents: token.contents,
        theme: options.theme || getTheme(),
        onDiagnostic: (record) => {
          // Local diagnostics omit query strings and credentials; logging must not
          // hold up extraction or depend on a launcher's stdout/stderr pipe.
          void fs
            .appendFile(
              path.join(app.getPath('userData'), 'extraction-cleanup.jsonl'),
              JSON.stringify({ time: new Date().toISOString(), platform, ...record }) + '\n'
            )
            .catch(() => {});
        }
      });
      updateState({ extractionFeedback });
      await extractionFeedback.initialize();
      ensureTask(token);
      if (presentWindow) {
        presentWindow(window);
        extractionFeedback.syncVisibility();
      } else if (transparentRead) {
        extractionFeedback.syncVisibility();
      } else if (Boolean(options.visible) || needsVisibleLoad) {
        window.show();
        if (!window.isVisible()) window.show();
        extractionFeedback.syncVisibility();
      } else window.hide();
      status(
        transparentRead
          ? '正在后台读取作品页面…'
          : options.visible || needsVisibleLoad
            ? '正在打开作品页面…'
            : '正在后台渲染作品页面…'
      );
      if (needsVisibleLoad && !options.visible && !transparentRead && !presentWindow)
        status(`${adapter.name} 需要先显示窗口加载画布；提取完成后将自动隐藏。`);
      if (!reuseCurrent || !token.contents.getURL()) {
        lastAttemptWork = { platform, inputUrl: url, resolvedUrl: '' };
        updateState({ lastAttemptWork });
        await loadWork(window, url, token.controller.signal, { webContents: token.contents });
        lastAttemptWork.resolvedUrl = token.contents.getURL();
      }
      ensureTask(token);
      let previousSignature = '',
        stable = 0,
        latest = null;
      const deadline = Date.now() + (options.timeout || 65000);
      token.deadline = deadline;
      let loggedHint = false,
        opened = false,
        dismissedHints = 0,
        openAttempts = 0,
        lastOpenAt = 0,
        unpublishedSince = 0,
        unpublished = false;
      while (Date.now() < deadline) {
        ensureTask(token);
        try {
          const work = await evaluateFrame(
            token.contents.mainFrame,
            '(' +
              adapter.page.inspectWork.toString() +
              ')(' +
              JSON.stringify(platform) +
              ',' +
              inspectPublished.toString() +
              ')',
            token
          );
          if (work.pageError) throw pageLoadError(undefined, '浏览器错误页面');
          if (work.accessError)
            throw Object.assign(new Error(work.accessError), { code: 'PLATFORM_ACCESS_REQUIRED' });
          if (leftRequestedWork(work.resolvedUrl, url))
            throw Object.assign(
              new Error('平台页面已切换到其他作品。请重新点击“开始读取网页”打开原链接。'),
              { workChanged: true }
            );
          if (work.title && !metadata.title) metadata.title = work.title;
          if (work.author && !metadata.author) metadata.author = work.author;
          if (work.fullVideo) metadata.fullVideo = work.fullVideo;
          if (work.workInfo) metadata.workInfo = { ...metadata.workInfo, ...work.workInfo };
          metadata.resolvedUrl = work.resolvedUrl;
          if (lastAttemptWork?.inputUrl === url) lastAttemptWork.resolvedUrl = work.resolvedUrl;
          latest = await scanFrames(window, token);
          if (
            !latest &&
            work.detailReady &&
            !work.canOpenCanvas &&
            !work.loginVisible &&
            !work.readonly &&
            !work.loading
          ) {
            unpublishedSince ||= Date.now();
            if (Date.now() - unpublishedSince >= 3500) {
              unpublished = true;
              break;
            }
          } else unpublishedSince = 0;
          if (latest) {
            if (!metadata.title && latest.canvasTitle) metadata.title = latest.canvasTitle;
            void extractionFeedback.set(
              '已进入画布，正在读取并确认数据…',
              'running',
              '正在提取画布'
            );
            const signature = snapshotSignature(latest);
            stable = signature === previousSignature ? stable + 1 : 0;
            previousSignature = signature;
            status(`已读到 ${latest.nodes.length} 个节点，正在确认数据加载稳定…`);
            if (stable >= 2) {
              const missing = latest.nodes.filter(
                (n) => n.data.resourceId && !latest.mediaResources?.[n.data.resourceId]
              );
              if (options.mode === 'full' && missing.length && Date.now() < deadline - 45000)
                status(`提示词已读取，正在等待 ${missing.length} 个素材地址…`);
              else break;
            }
          } else {
            stable = 0;
            previousSignature = '';
            // A login hint can appear after the process button is clicked.
            // Close only its normal dismiss action, at most twice; enforced login remains manual.
            const allowClick = openAttempts < 3 && (!opened || Date.now() - lastOpenAt >= 8000);
            const outcome = await evaluateFrame(
              token.contents.mainFrame,
              '(' +
                adapter.page.openCanvas.toString() +
                ')(' +
                JSON.stringify(allowClick) +
                ',' +
                JSON.stringify(dismissedHints < 2) +
                ')',
              token
            );
            if (outcome.accessError)
              throw Object.assign(new Error(outcome.accessError), {
                code: 'PLATFORM_ACCESS_REQUIRED'
              });
            if (outcome.closedLoginHint || outcome.closedPopup) {
              dismissedHints++;
              opened = false;
              status('已关闭普通提示弹窗，正在继续打开画布…');
            } else opened = opened || Boolean(outcome.clicked || outcome.alreadyOpen);
            if (outcome.clicked) {
              openAttempts++;
              lastOpenAt = Date.now();
            }
            if (outcome.clicked || outcome.alreadyOpen) {
              void extractionFeedback.set('正在加载只读画布，请稍候…', 'running', '画布跳转中');
              status('正在加载只读画布，包含 iframe 的节点也会检查…');
            } else if (outcome.blocked)
              status(
                '页面弹窗遮挡制作过程入口，请关闭普通广告或完成登录；程序会继续尝试。',
                'attention'
              );
            else if (work.loginVisible && !loggedHint) {
              loggedHint = true;
              status('检测到登录引导，正在尝试公开预览；如受限，请显示平台页面登录。', 'attention');
            }
          }
        } catch (error) {
          if (
            token.cancelled ||
            error.workChanged ||
            error.code === 'READ_DEADLINE' ||
            error.code === 'READ_CANCELLED' ||
            error.code === 'PLATFORM_ACCESS_REQUIRED' ||
            error.code === 'PAGE_LOAD_FAILED'
          )
            throw error;
          // Navigation may dispose a frame; reacquire it on the next iteration.
          if (!window || window.isDestroyed()) throw new Error('平台窗口已经关闭。');
        }
        await boundedRead(() => wait(Math.min(900, Math.max(1, deadline - Date.now()))), {
          timeoutMs: 1000,
          signal: token.controller.signal
        });
      }
      ensureTask(token);
      if (!unpublished && (!latest || stable < 2)) {
        if (live) {
          try {
            const detail = await boundedRead(
              () =>
                token.contents.mainFrame.executeJavaScript(
                  '({url:location.href,text:document.body.innerText.slice(0,6000),buttons:[...document.querySelectorAll("button,[role=button]")].filter(b=>b.getClientRects().length).map(b=>({text:b.innerText,aria:b.getAttribute("aria-label")}))})'
                ),
              { timeoutMs: 1000, signal: token.controller.signal }
            );
            await fs.writeFile(
              verificationPath(ROOT, platform + '-failure.json'),
              JSON.stringify(detail, null, 2)
            );
          } catch {}
          try {
            const capture = await boundedRead(() => token.contents.capturePage(), {
              timeoutMs: 1000,
              signal: token.controller.signal
            });
            await fs.writeFile(verificationPath(ROOT, platform + '-failed.png'), capture.toPNG());
          } catch {}
        }
        throw new Error(
          latest
            ? '画布数据持续变化，尚未确认完整加载。请稍后点击“开始读取网页”。'
            : '尚未读到画布。请点击“显示平台”检查页面，关闭普通弹窗或完成登录，再点击“开始读取网页”。'
        );
      }
      let extracted = unpublished
        ? publishedWork(metadata)
        : normalize(
            metadata.fullVideo ? { ...latest, fullVideo: metadata.fullVideo } : latest,
            metadata
          );
      if (!unpublished) extracted.metadata.canvasAccess = 'public';
      if (enrichResult) extracted = await enrichResult(extracted, token.controller.signal);
      if (needsVisibleLoad && !options.visible && !transparentRead && !presentWindow) window.hide();
      ensureTask(token);
      currentResult = await finishExtraction(extracted, options);
      return currentResult;
    } catch (error) {
      if (token.cancelled)
        error = Object.assign(new Error('任务已取消。'), { code: 'READ_CANCELLED' });
      // Stop pending navigations before releasing the task. Late loads must not
      // hold frame execution or compete with the next read.
      if (token.contents && !token.contents.isDestroyed()) token.contents.stop();
      status(error.message, token.cancelled ? 'cancelled' : 'error');
      throw error;
    } finally {
      try {
        if (token.window && extractionFeedback?.active)
          await extractionFeedback.finish(
            token.outcome?.message || '读取已结束。',
            token.cancelled ? 'cancelled' : token.outcome?.phase === 'done' ? 'done' : 'error',
            token.outcome?.phase === 'done'
              ? {
                  nodes: currentResult.diagnostics.nodeCount,
                  prompts: currentResult.entries.length,
                  assets: currentResult.assets.length
                }
              : null
          );
      } finally {
        token.navigation?.dispose();
        scope.finish(token);
        if (getState().task === token) updateState({ task: null });
        token.releaseAudio?.();
        for (const child of token.childAudio) child.release();
        if (presentWindow && window) presentWindow(window);
        else if (transparentRead && window) endTransparentRead(window);
        if (!presentWindow)
          for (const child of token.transparentChildren || []) endTransparentRead(child);
        window?.browserToolbar?.syncAudio?.();
      }
    }
  }

  return { runExtraction };
}
module.exports = { createExtractionService };
