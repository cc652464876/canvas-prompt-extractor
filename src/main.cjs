'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session, protocol, net, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { readCanvas, inspectWork, openCanvas } = require('./page-reader.cjs');
const { normalize, filename, markdown, filterResult, TYPES } = require('./normalize.cjs');
const { ProjectStore } = require('./project-store.cjs');
const {loadLocalProject,isCurrentProjectPath}=require('./local-project.cjs');
const {PROMPT_TYPES,promptKinds}=require('./prompt-types.cjs');
const {inspectAccount}=require('./account-state.cjs');
const {AccountManager}=require('./account-manager.cjs');
const {resetBrowserData}=require('./browser-reset.cjs');
const {reuseWorkPage}=require('./read-policy.cjs');
const {boundedRead}=require('./read-deadline.cjs');
const {ExtractionFeedback}=require('./extraction-feedback.cjs');
const {popupAction,leftRequestedWork}=require('./extraction-policy.cjs');
const { DownloadQueue,fetchMedia,prepareMedia } = require('./download-queue.cjs');
const { safeUrl } = require('./assets.cjs');
const {selectDownloadAssets,createFrameLimiter}=require('./media-policy.cjs');
const {normalizePreference,resolveTheme}=require('./theme.cjs');
const {frameRange,boundedFrame}=createFrameLimiter();
protocol.registerSchemesAsPrivileged([{scheme:'labmedia',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const ROOT = path.resolve(__dirname, '..');
// A portable install keeps data alongside its executable, outside resources/app.
const DATA_ROOT=app.isPackaged?path.dirname(process.execPath):ROOT;
// Chromium's HTTP User-Agent must stay ASCII; the native title is localized.
app.setName('CanvasPromptExtractor');
const verifyExtraction=process.argv.includes('--verify-extraction');
const verifyThemes=process.argv.includes('--verify-themes');
const verifyAccounts=process.argv.includes('--verify-account-startup');
const verifyBrowserReset=process.argv.includes('--verify-browser-reset');
const verifyLocalProject=process.argv.includes('--verify-local-project');
const verifyDeadline=process.argv.includes('--verify-read-deadline');
const portableSmokeArg=process.argv.find(value=>value.startsWith('--portable-smoke='));
const isolatedVerification=verifyExtraction||verifyThemes||verifyAccounts||verifyBrowserReset||verifyLocalProject||process.argv.some(value=>value.startsWith('--verify-'));
const profilePath=isolatedVerification?fsSync.mkdtempSync(path.join(require('node:os').tmpdir(),'canvas-verification-')):path.join(DATA_ROOT,'.runtime','profile');
fsSync.mkdirSync(profilePath,{recursive:true});
app.setPath('userData',profilePath);
const browserSessions=new Set();
app.on('session-created',ses=>browserSessions.add(ses));
const live = process.argv.includes('--verify-live');
const verifyV08=process.argv.includes('--verify-v08');
const verifyUi = process.argv.includes('--verify-ui') || process.argv.includes('--verify-ui-large')||verifyV08;
let ui, platformWindow, currentResult = null, currentPlatform = '', task = null,saveTask=null,downloadSetup=false,verificationFetcher=null,verificationResult=null;
let outputDirectory = path.join(ROOT, 'exports'), lastStatus = '';
let lastWorkMetadata = null,lastAttemptWork=null;
let store,queue, exportOptions={kinds:Object.keys(PROMPT_TYPES),split:false,mode:'full'};
let previewTail=Promise.resolve(),previewNext=0;
let browserResetting=false;
let localProjectOpening=false,currentLocalProject=false;
let browserGeneration=0,browserPreviewAbort=new AbortController();
const thumbnailWrites=new Set();
const accounts=new AccountManager({createWindow:createPlatformWindow,inspect:async win=>{
  const info=await win.webContents.mainFrame.executeJavaScript('('+inspectAccount.toString()+')()');
  return {...info,avatar:safeUrl(info.avatar)};
},onChange:info=>send('account',info),blocked:win=>task?.window===win});
let extractionFeedback;
const appearancePath=path.join(app.getPath('userData'),'appearance.json');
let appearancePreference=normalizePreference(null),themeWriteTail=Promise.resolve();
try{appearancePreference=normalizePreference(JSON.parse(fsSync.readFileSync(appearancePath,'utf8')));}catch{}
let uiTheme=resolveTheme(appearancePreference,nativeTheme.shouldUseDarkColors);
async function refreshAppearance(){
  uiTheme=resolveTheme(appearancePreference,nativeTheme.shouldUseDarkColors);
  if(ui&&!ui.isDestroyed())ui.setBackgroundColor(uiTheme.tokens.bg);
  await extractionFeedback?.setTheme(uiTheme);
  return {palette:uiTheme.palette,mode:uiTheme.mode,resolvedMode:uiTheme.resolvedMode};
}
const thumbnailRuntime=isolatedVerification?app.getPath('userData'):path.join(DATA_ROOT,'.runtime');
const thumbnailRoot=path.join(thumbnailRuntime,'thumbnails');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const uiUrl = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => { if (ui && !ui.isDestroyed()) { if (ui.isMinimized()) ui.restore(); ui.show(); ui.focus(); } });
function send(type, payload) {
  if (ui && !ui.isDestroyed()) ui.webContents.send('lab:event', { type, payload });
  if (live && type === 'status') console.log(payload.message);
}
function status(message, phase = 'running') { if(task)task.outcome={message,phase};const signature = phase + message; if (signature !== lastStatus) { lastStatus = signature; send('status', { message, phase }); if(extractionFeedback?.active)void extractionFeedback.set(message,phase); } }
function resolvePlatform(input) {
  let url; try { url = new URL(String(input).trim()); } catch { throw new Error('请输入完整的 https 作品链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('只接受不含账户凭据的 HTTPS 平台链接。');
  if (['www.liblib.tv','liblib.tv'].includes(url.hostname)) return { platform: 'liblib', url: url.href };
  if (url.hostname === 'jimeng.jianying.com') return { platform: 'jimeng', url: url.href };
  throw new Error('实验版目前只支持 liblib.tv 和 jimeng.jianying.com。');
}
function permittedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'about:') return url.href === 'about:blank';
    if (url.protocol !== 'https:') return false;
    return ['liblib.tv','liblib.art','jianying.com','bytedance.com','douyin.com','feishu.cn','larkoffice.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}
function secureContents(wc) {
  wc.on('will-navigate', (event,url) => {
    if(task?.window?.webContents===wc&&leftRequestedWork(url,task.url)){event.preventDefault();status('提取期间已阻止离开当前作品，请等待完成或在主界面停止读取。','attention');return;}
    if (!permittedUrl(url)) { event.preventDefault(); status('平台尝试打开不支持的地址，已暂停该跳转。', 'attention'); }
  });
  wc.setWindowOpenHandler(({url}) => {
    if(task?.window?.webContents===wc&&permittedUrl(url)){
      const action=popupAction(url,task.url);
      if(action==='canvas'){
        const token=task;
        if(!token.pendingNavigation){status('画布跳转中，正在当前窗口打开画布…');token.pendingNavigation=token.window.loadURL(url).catch(()=>{}).finally(()=>{token.pendingNavigation=null;});}
        return {action:'deny'};
      }
      if(action==='deny'){status('已拦截与提取无关的新窗口，继续读取当前作品。','attention');return {action:'deny'};}
    }
    return { action: permittedUrl(url) ? 'allow' : 'deny', overrideBrowserWindowOptions: {
    show: !live&&Boolean(BrowserWindow.fromWebContents(wc)?.isVisible()), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, session: wc.session }
  } };});
  wc.on('did-create-window', child => {
    secureContents(child.webContents);
    if(task&&task.window?.webContents.session===wc.session){task.childAudio.push({wc:child.webContents,muted:child.webContents.isAudioMuted()});child.webContents.setAudioMuted(true);}
  });
}
function getPlatformWindow(platform, visible, deferShow=false) {
  if (platformWindow && !platformWindow.isDestroyed() && currentPlatform !== platform) platformWindow.hide();
  currentPlatform = platform;
  platformWindow=accounts.getWindow(platform);
  if (!deferShow) {if (visible) platformWindow.show(); else platformWindow.hide();}
  send('platform-visible',platformWindow.isVisible());
  return platformWindow;
}
function createPlatformWindow(platform) {
  const ses=session.fromPartition('persist:'+platform);
  ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  const win=new BrowserWindow({width:1280,height:860,show:false,backgroundColor:'#141414',title:'平台页面 · 可手动登录与核对',
    autoHideMenuBar:true,webPreferences:{partition:'persist:'+platform,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:verifyAccounts||verifyBrowserReset}});
  secureContents(win.webContents);
  win.on('close',event=>{if(!app.quitting){event.preventDefault();
    if(task?.window===win){status('提取尚未完成，暂时保留平台窗口。请在主界面点击“停止读取”结束任务；说明框可单独关闭。','attention');return;}
    win.hide();
  }});
  win.on('show',()=>{if(platformWindow===win)send('platform-visible',true);});
  win.on('hide',()=>{if(platformWindow===win)send('platform-visible',false);});
  return win;
}
function ensureTask(token) { if (token.cancelled) throw new Error('任务已取消。'); }
async function loadWork(window,url,signal) {
  let ready;
  try {
    await boundedRead(()=>new Promise((resolve,reject) => {
      ready = resolve;
      window.webContents.once('dom-ready',ready);
      // Media-heavy pages can keep did-finish-load pending after their DOM is usable.
      window.loadURL(url).then(resolve,reject);
    }),{timeoutMs:45000,signal,message:'打开页面超过 45 秒，请显示平台页面检查网络后再次读取。'});
  } finally {
    if(ready)window.webContents.removeListener('dom-ready',ready);
  }
}
async function evaluateFrame(frame, code,token) {
  return boundedRead(()=>frame.executeJavaScript(code),{timeoutMs:10000,deadline:token?.deadline,signal:token?.controller.signal});
}
async function scanFrames(window,token) {
  const frames = window.webContents.mainFrame.framesInSubtree;
  const allowed = frames.filter(frame => /liblib\.tv|jimeng\.jianying\.com/.test(frame.url));
  const values = await Promise.allSettled(allowed.map(frame => evaluateFrame(frame, '(' + readCanvas.toString() + ')()',token)));
  if(token){ensureTask(token);if(Date.now()>=token.deadline)throw Object.assign(new Error('读取画布超过等待期限，请显示平台页面检查后重试。'),{code:'READ_DEADLINE'});}
  if (live && !values.some(r => r.status === 'fulfilled' && r.value?.found)) {
    await fs.writeFile(path.join(ROOT,'validation',currentPlatform+'-frame-check.json'), JSON.stringify(values.map((r,i) => ({ url: allowed[i].url, result: r.status === 'fulfilled' ? r.value : r.reason.message })),null,2));
  }
  const snapshots = values.filter(r => r.status === 'fulfilled' && r.value?.found).map(r => r.value);
  snapshots.sort((a,b) => b.nodes.length - a.nodes.length);
  return snapshots[0];
}
async function runExtraction(input, options = {}) {
  if (task) throw new Error('已有任务运行中，请先取消或等待完成。');
  if(queue?.active||saveTask||downloadSetup) throw new Error('请先停止下载或保存任务，再读取新项目。');
  const { platform, url } = resolvePlatform(input);
  const reuseCurrent=reuseWorkPage({requestedUrl:url,platform,attempt:lastAttemptWork,windowUrl:platformWindow&&!platformWindow.isDestroyed()?platformWindow.webContents.getURL():'',windowPlatform:currentPlatform,windowAvailable:Boolean(platformWindow&&!platformWindow.isDestroyed())});
  const reuseMetadata=reuseCurrent&&lastWorkMetadata?.inputUrl===url?lastWorkMetadata:null;
  const token = { cancelled: false,controller:new AbortController(),url,childAudio:[] }; task = token; currentResult = null;currentLocalProject=false;store=new ProjectStore(outputDirectory);store.options=exportOptions;
  send('reset', null);
  let window;
  // LibTV's canvas did not initialize in a completely hidden window in live tests.
  const needsVisibleLoad = platform === 'liblib' && !reuseCurrent;
  const metadata = { platform, inputUrl: url, resolvedUrl: url, title: reuseMetadata?.title || '', author: reuseMetadata?.author || '' };
  try {
    if(verifyV08&&verificationResult){await wait(120);ensureTask(token);return await finishExtraction(structuredClone(verificationResult),options);}
    await extractionFeedback?.dispose();
    window = getPlatformWindow(platform, Boolean(options.visible) || needsVisibleLoad,true);
    token.window=window;
    if(!window.webContents.getURL())await window.loadURL('about:blank');
    extractionFeedback=new ExtractionFeedback(window,{theme:options.theme||uiTheme,onDiagnostic:record=>{
      // Local diagnostics omit query strings and credentials; logging must not
      // hold up extraction or depend on a launcher's stdout/stderr pipe.
      void fs.appendFile(path.join(app.getPath('userData'),'extraction-cleanup.jsonl'),JSON.stringify({time:new Date().toISOString(),platform,...record})+'\n').catch(()=>{});
    }});
    await extractionFeedback.initialize();
    ensureTask(token);
    if(Boolean(options.visible)||needsVisibleLoad){window.show();if(!window.isVisible())window.show();extractionFeedback.syncVisibility();}else window.hide();
    status('正在打开作品页面…');
    if (needsVisibleLoad && !options.visible) status('LibTV 需要先显示窗口加载画布；提取完成后将自动隐藏。');
    if (!reuseCurrent || !window.webContents.getURL()) {
      lastAttemptWork={platform,inputUrl:url,resolvedUrl:''};await loadWork(window,url,token.controller.signal);lastAttemptWork.resolvedUrl=window.webContents.getURL();
    }
    ensureTask(token);
    let previousSignature = '', stable = 0, latest = null;
    const deadline = Date.now() + (options.timeout || 65000);
    token.deadline=deadline;
    let loggedHint = false, opened = false, dismissedHints = 0,openAttempts=0,lastOpenAt=0;
    while (Date.now() < deadline) {
      ensureTask(token);
      try {
        const work = await evaluateFrame(window.webContents.mainFrame,'(' + inspectWork.toString() + ')(' + JSON.stringify(platform) + ')',token);
        if(leftRequestedWork(work.resolvedUrl,url))throw Object.assign(new Error('平台页面已切换到其他作品。请重新点击“开始读取画布”打开原链接。'),{workChanged:true});
        if (work.title && !metadata.title) metadata.title = work.title;
        if (work.author && !metadata.author) metadata.author = work.author;
        metadata.resolvedUrl = work.resolvedUrl;if(lastAttemptWork?.inputUrl===url)lastAttemptWork.resolvedUrl=work.resolvedUrl;
        latest = await scanFrames(window,token);
        if (latest) {
          void extractionFeedback.set('已进入画布，正在读取并确认数据…','running','正在提取画布');
          const signature = JSON.stringify(latest.nodes) + JSON.stringify(latest.edges);
          stable = signature === previousSignature ? stable + 1 : 0;
          previousSignature = signature;
          status(`已读到 ${latest.nodes.length} 个节点，正在确认数据加载稳定…`);
          if (stable >= 2) {
            const missing=latest.nodes.filter(n=>n.data.resourceId&&!latest.mediaResources?.[n.data.resourceId]);
            if(options.mode==='full'&&missing.length&&Date.now()<deadline-45000) status(`提示词已读取，正在等待 ${missing.length} 个素材地址…`);
            else break;
          }
        } else {
          stable=0;previousSignature='';
          // A login hint can appear after the process button is clicked.
          // Close only its normal dismiss action, at most twice; enforced login remains manual.
          const allowClick=openAttempts<3&&(!opened||Date.now()-lastOpenAt>=8000);
          const outcome = await evaluateFrame(window.webContents.mainFrame,'(' + openCanvas.toString() + ')(' + JSON.stringify(allowClick) + ',' + JSON.stringify(dismissedHints<2) + ')',token);
          if(outcome.closedLoginHint||outcome.closedPopup) { dismissedHints++;opened=false;status('已关闭普通提示弹窗，正在继续打开画布…'); }
          else opened = opened || Boolean(outcome.clicked || outcome.alreadyOpen);
          if(outcome.clicked){openAttempts++;lastOpenAt=Date.now();}
          if (outcome.clicked || outcome.alreadyOpen) {void extractionFeedback.set('正在加载只读画布，请稍候…','running','画布跳转中');status('正在加载只读画布，包含 iframe 的节点也会检查…');}
          else if(outcome.blocked)status('页面弹窗遮挡制作过程入口，请关闭普通广告或完成登录；程序会继续尝试。','attention');
          else if (work.loginVisible && !loggedHint) {
            loggedHint = true; status('检测到登录引导，正在尝试公开预览；如受限，请显示平台页面登录。', 'attention');
          }
        }
      } catch (error) {
        if (token.cancelled||error.workChanged||error.code==='READ_DEADLINE'||error.code==='READ_CANCELLED') throw error;
        // Navigation may dispose a frame; reacquire it on the next iteration.
        if (!window || window.isDestroyed()) throw new Error('平台窗口已经关闭。');
      }
      await boundedRead(()=>wait(Math.min(900,Math.max(1,deadline-Date.now()))),{timeoutMs:1000,signal:token.controller.signal});
    }
    ensureTask(token);
    if (!latest || stable < 2) {
      if (live) {
        try {const detail=await boundedRead(()=>window.webContents.mainFrame.executeJavaScript('({url:location.href,text:document.body.innerText.slice(0,6000),buttons:[...document.querySelectorAll("button,[role=button]")].filter(b=>b.getClientRects().length).map(b=>({text:b.innerText,aria:b.getAttribute("aria-label")}))})'),{timeoutMs:1000,signal:token.controller.signal});await fs.writeFile(path.join(ROOT,'validation',platform+'-failure.json'),JSON.stringify(detail,null,2));}catch{}
        try { const capture=await boundedRead(()=>window.webContents.capturePage(),{timeoutMs:1000,signal:token.controller.signal});await fs.writeFile(path.join(ROOT,'validation',platform+'-failed.png'),capture.toPNG()); } catch {}
      }
      throw new Error(latest ? '画布数据持续变化，尚未确认完整加载。请稍后点击“开始读取画布”。' : '尚未读到画布。广告或登录弹窗可能阻挡跳转，请显示平台页面，关闭普通弹窗或完成登录，再点击“开始读取画布”。');
    }
    const extracted=normalize(latest, metadata);
    if (needsVisibleLoad && !options.visible) window.hide();
    return await finishExtraction(extracted,options);
  } catch (error) {
    if(token.cancelled)error=new Error('任务已取消。');
    // Stop pending navigations before releasing the task. Late loads must not
    // hold frame execution or compete with the next read.
    if(window&&!window.isDestroyed())window.webContents.stop();
    status(error.message, token.cancelled ? 'cancelled' : 'error');
    throw error;
  } finally {
    try{
      if(token.window&&extractionFeedback?.active)await extractionFeedback.finish(token.outcome?.message||'读取已结束。',token.cancelled?'cancelled':token.outcome?.phase==='done'?'done':'error',token.outcome?.phase==='done'?{nodes:currentResult.diagnostics.nodeCount,prompts:currentResult.entries.length,assets:currentResult.assets.length}:null);
      for(const child of token.childAudio)if(!child.wc.isDestroyed())child.wc.setAudioMuted(child.muted);
    }finally{if (task === token) task = null;}
  }
}
async function finishExtraction(result,options){currentResult=result;exportOptions={...exportOptions,...sanitizeOptions(options)};send('result',currentResult);store=new ProjectStore(outputDirectory);store.options=exportOptions;send('project',{...store.summary(),root:outputDirectory});lastWorkMetadata=currentResult.metadata;const d=currentResult.diagnostics;status(`读取完成：${d.nodeCount} 个节点，${currentResult.entries.length} 条提示词与文本，${currentResult.assets.length} 个项目资产。`,'done');return currentResult;}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event,...args) => {
    if (event.sender !== ui.webContents || event.senderFrame?.url !== uiUrl) throw new Error('不允许此页面操作实验程序。');
    try { if(browserResetting&&!['lab:reset-browser','lab:info'].includes(channel))throw new Error('浏览器正在重置，请稍候。');if(localProjectOpening&&['lab:open-local-project','lab:extract','lab:save','lab:update','lab:download','lab:directory','lab:login','lab:reset-browser'].includes(channel))throw new Error('正在打开本地项目，请稍候。');return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
async function openLocalProject(input=''){
  if(task||saveTask||queue?.active||downloadSetup)throw new Error('请先结束读取、保存或下载任务，再打开本地项目。');
  if(typeof input!=='string')throw new Error('本地项目路径无效。');
  localProjectOpening=true;
  try{
    let target=input.trim();
    const currentPath=currentLocalProject&&isCurrentProjectPath(target,store.directory);
    if(!target||currentPath){
      const selected=await dialog.showOpenDialog(ui,{title:'打开本地项目：选择 .画布项目.json',defaultPath:currentPath?path.dirname(store.directory):store.directory||outputDirectory,properties:['openFile','showHiddenFiles'],filters:[{name:'画布项目记录',extensions:['json']}]});
      if(selected.canceled||!selected.filePaths.length)return {cancelled:true};
      target=selected.filePaths[0];
    }
    const loaded=await loadLocalProject(target);
    // Commit only after the entire project has been validated. Failed opens preserve the current project.
    browserGeneration++;browserPreviewAbort.abort();browserPreviewAbort=new AbortController();
    store=loaded.store;currentResult=loaded.result;currentLocalProject=true;queue=null;
    exportOptions={...exportOptions,...sanitizeOptions(store.options)};store.options=exportOptions;
    send('result',{...currentResult,localProject:true});
    send('project',{...store.summary(),manifestPath:loaded.manifestPath});
    const missing=currentResult.assets.filter(a=>a.error==='本地文件缺失或不完整').length;
    status(`本地项目已打开：${currentResult.entries.length} 条提示词与文本，${currentResult.assets.filter(a=>a.state==='done').length} 个本地素材。${missing?' '+missing+' 个素材文件缺失或不完整。':''}`,'done');
    return {manifestPath:loaded.manifestPath};
  }finally{localProjectOpening=false;}
}
async function collectBrowserSessions(){
  browserSessions.add(session.defaultSession);
  for(const platform of ['liblib','jimeng'])browserSessions.add(session.fromPartition('persist:'+platform));
  const knownPaths=new Set([...browserSessions].map(ses=>ses.getStoragePath()).filter(Boolean).map(value=>path.resolve(value).toLowerCase()));
  const partitions=path.join(app.getPath('userData'),'Partitions');
  const directories=await fs.readdir(partitions,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  for(const entry of directories.filter(entry=>entry.isDirectory())){
    const directory=path.resolve(partitions,entry.name);
    if(!knownPaths.has(directory.toLowerCase()))browserSessions.add(session.fromPath(directory));
  }
  return [...browserSessions];
}
async function resetBrowser(settings){
  if(browserResetting)throw new Error('浏览器正在重置，请稍候。');
  if(task||saveTask||queue?.active||downloadSetup)throw new Error('请先结束读取、保存或下载任务，再重置浏览器。');
  browserResetting=true;browserGeneration++;browserPreviewAbort.abort();send('browser-resetting',true);
  try{
    const sessions=await collectBrowserSessions();
    const result=await resetBrowserData({sessions,settings,
      closePages:async()=>{
        await extractionFeedback?.dispose();extractionFeedback=null;
        platformWindow=null;currentPlatform='';lastWorkMetadata=null;lastAttemptWork=null;
        accounts.reset();
        for(const win of BrowserWindow.getAllWindows())if(win!==ui&&!win.isDestroyed())win.destroy();
        await Promise.allSettled([...thumbnailWrites]);
        send('platform-reset',null);
      },clearThumbnails:async()=>{
        const target=path.resolve(thumbnailRoot);
        if(path.relative(path.resolve(thumbnailRuntime),target)!=='thumbnails')throw new Error('缩略图缓存目录无效。');
        await fs.rm(target,{recursive:true,force:true});
      },restoreSettings:async retained=>{
        if(!ui||ui.isDestroyed())throw new Error('程序已关闭，浏览器重置未完成。');
        // JSON is inserted into JavaScript directly, never into a shell command.
        await ui.webContents.executeJavaScript('Object.entries('+JSON.stringify(retained)+').forEach(([key,value])=>localStorage.setItem(key,value))');
      }});
    for(const platform of ['liblib','jimeng'])send('account',{platform,state:'logged-out',checking:false,label:'浏览器已重置，点击打开平台登录'});
    return result;
  }finally{browserPreviewAbort=new AbortController();browserResetting=false;send('browser-resetting',false);}
}
function sanitizeOptions(options={}) {
  const kinds=Array.isArray(options.kinds)?promptKinds(options.kinds):exportOptions.kinds;
  return {kinds,split:Boolean(options.split),mode:options.mode==='full'?'full':'simple'};
}
async function updateExport(options={}) {
  if(task||saveTask||queue?.active||downloadSetup)throw new Error('请先结束当前任务。');
  exportOptions={...exportOptions,...sanitizeOptions(options)};
  store.options=exportOptions;
  return {options:exportOptions,project:store.summary()};
}
async function ensureProject(){
  if(!currentResult)throw new Error('请先读取画布。');
  if(store.result!==currentResult||!store.directory){const candidate=new ProjectStore(outputDirectory);await candidate.create(currentResult,exportOptions,false);store=candidate;send('assets',currentResult.assets);}
  return store;
}
async function savePrompts(options){
  if(task||saveTask||queue?.active||downloadSetup)throw new Error('请先结束当前任务。');
  exportOptions={...exportOptions,...sanitizeOptions(options)};store.options=exportOptions;
  if(!exportOptions.kinds.length)throw new Error('请至少勾选一种提示词类型。');
  if(!filterResult(currentResult||{entries:[],assets:[],edges:[]},exportOptions.kinds).entries.length)throw new Error('勾选的类别没有可保存内容。');
  const token={cancelled:false};saveTask=token;
  try{const project=await ensureProject();const saved=await project.save(true,token);send('project',saved);return saved;}
  finally{if(saveTask===token)saveTask=null;}
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
function mediaFetcher(url,options={}) {
  if(verifyUi&&verificationFetcher){const fixture=verificationFetcher(url,options);if(fixture)return fixture;}
  const platform=currentResult?.metadata.platform||'liblib';
  const pageUrl=currentResult?.metadata.canvasUrl|| (platform==='liblib'?'https://www.liblib.tv/':'https://jimeng.jianying.com/');
  // Match the browser's cross-origin referrer policy; a full-path header is rejected by Chromium.
  const referer=new URL(pageUrl).origin+'/';
  return session.fromPartition('persist:'+platform).fetch(url,{...options,headers:{Referer:referer,...options.headers}});
}
function createQueue() {
  const project=store;
  return new DownloadQueue({fetcher:mediaFetcher,filePath:a=>project.assetPath(a),onProgress:progress=>send('downloads',progress),
    onPrepare:async selected=>{try{await project.prepareRedownload(selected.map(a=>a.id));}finally{await project.checkpoint();send('assets',currentResult.assets);send('project',project.summary());}},
    onSettled:async()=>{await project.checkpoint();send('assets',currentResult.assets);send('project',project.summary());}});
}
async function loginState(platform){return accounts.refresh(platform);}
function thumbnailPath(asset){if(!/^[a-f0-9]{24}$/.test(asset.id))throw new Error('素材标识无效。');return path.join(thumbnailRoot,asset.id+'.png');}
async function cachedThumbnailPath(asset){const current=thumbnailPath(asset);try{await fs.access(current);return current;}catch{const legacy=path.join(thumbnailRoot,asset.id+'_'+(Number(asset.bytes)||0)+'.png');await fs.access(legacy);return legacy;}}
function installMediaProtocol() {
  protocol.handle('labmedia',async request=>{
    try {
      if(browserResetting)return new Response('Browser resetting',{status:503});
      const generation=browserGeneration;
      const previewSignal=AbortSignal.any([request.signal,browserPreviewAbort.signal]);
      const u=new URL(request.url),id=u.pathname.slice(1),asset=currentResult?.assets.find(a=>a.id===id);
      if(!asset)return new Response('Not found',{status:404});
      if(u.hostname==='thumbnail') {
        if(asset.kind!=='video')return new Response('No thumbnail',{status:404});
        try{return net.fetch(pathToFileURL(await cachedThumbnailPath(asset)).href,{signal:previewSignal});}catch{return new Response('No thumbnail',{status:404});}
      }
      if(u.hostname==='local') {
        if(asset.state!=='done')return new Response('Not downloaded',{status:404});
        const headers={};if(request.headers.has('range'))headers.Range=request.headers.get('range');
        const local=await net.fetch(pathToFileURL(store.assetPath(asset)).href,{headers,signal:previewSignal});const forwarded=new Headers(local.headers);forwarded.set('Access-Control-Allow-Origin','*');return new Response(local.body,{status:local.status,headers:forwarded});
      }
      if(currentLocalProject)return new Response('Local project has no online previews',{status:403});
      if(exportOptions.mode!=='full')return new Response('Preview disabled',{status:403});
      const isPreview=u.hostname==='preview';if(!isPreview&&u.hostname!=='stream'&&u.hostname!=='frame')return new Response('Not found',{status:404});
      const candidateIndex=u.searchParams.has('index')?Number(u.searchParams.get('index')):null;
      if(candidateIndex!==null&&(!Number.isInteger(candidateIndex)||candidateIndex<0||candidateIndex>=Math.min(3,asset.previewUrls?.length||0)))return new Response('Not found',{status:404});
      const url=safeUrl(isPreview?(candidateIndex===null?asset.previewUrl:asset.previewUrls[candidateIndex]):asset.url);if(!url)return new Response('Unavailable',{status:404});
      if(u.hostname==='frame') {
        // Only video sampling is spaced; image previews share four renderer slots.
        const next=previewTail.catch(()=>{}).then(async()=>{const delay=Math.max(0,previewNext-Date.now());if(delay)await wait(delay);previewNext=Date.now()+1000;});previewTail=next;await next;
        if(exportOptions.mode!=='full')return new Response('Preview disabled',{status:403});
      }
      const headers={};let range=request.headers.get('range');if(u.hostname==='frame'){range=await frameRange(asset.id,range);}if(range)headers.Range=range;
      if(browserResetting||generation!==browserGeneration)return new Response('Browser resetting',{status:503});
      const r=await fetchMedia(mediaFetcher,url,{credentials:'include',headers,signal:AbortSignal.any([previewSignal,AbortSignal.timeout(u.hostname==='frame'?12000:45000)])});
      if(!r.ok){await r.body?.cancel();return new Response('Media unavailable',{status:502});}
      const partialRange=r.status===206&&!/^bytes 0-/.test(r.headers.get('content-range')||'');
      const input=u.hostname==='frame'?new Response(await boundedFrame(asset.id,r,r.body),{status:r.status,headers:r.headers}):r;
      const media=await prepareMedia(input,isPreview?{...asset,kind:'image'}:asset,{partialRange});const stream=media.stream;
      const forwarded=new Headers();for(const name of ['content-type','content-length','content-range','accept-ranges'])if(r.headers.has(name))forwarded.set(name,r.headers.get(name));
      forwarded.set('Access-Control-Allow-Origin','*');forwarded.set('Access-Control-Expose-Headers','content-range,content-length');forwarded.set('content-type',media.contentType);forwarded.set('Cache-Control','private, max-age=300');return new Response(stream,{status:r.status,headers:forwarded});
    }catch(e){if(verifyUi&&request.url.includes('://frame/'))console.log('Frame request failed:',e.message);return new Response('Media unavailable',{status:502});}
  });
}
async function verifyLive() {
  await fs.mkdir(path.join(ROOT,'validation'), { recursive: true });
  const report = [];
  const inputs = process.argv.includes('--verify-large') ? ['https://www.liblib.tv/detail/c6e94bfacd5a4f738813bc9e89afdcd6'] : process.argv.includes('--jimeng-only') ? ['https://jimeng.jianying.com/s/0sIyfgkBwSA/'] : process.argv.includes('--liblib-only') ? ['https://www.liblib.tv/detail/dd52623a77ed4713955009228c621446'] : ['https://www.liblib.tv/detail/dd52623a77ed4713955009228c621446', 'https://jimeng.jianying.com/s/0sIyfgkBwSA/'];
  for (const input of inputs) {
    const platform = resolvePlatform(input).platform;
    try {
      const result = await runExtraction(input, { visible: process.argv.includes('--verify-visible'),mode:'full' });
      await fs.writeFile(path.join(ROOT,'validation',(process.argv.includes('--verify-large')?'liblib-large':platform)+'-snapshot.json'),JSON.stringify(result,null,2));
      await fs.writeFile(path.join(ROOT,'validation',filename(result.metadata)),markdown(result));
      report.push({ platform, passed: true, metadata: result.metadata, diagnostics: result.diagnostics });
      if(process.argv.includes('--verify-downloads')) {
        const chosen=['image','video','audio'].map(k=>result.assets.find(a=>a.kind===k&&a.url)).filter(Boolean);
        const q=createQueue();const done=await q.start(chosen,['image','video','audio']);
        report[report.length-1].downloads=done;report[report.length-1].passed=done.failed===0&&done.done===chosen.length;
      }
    } catch (error) { report.push({ platform, passed: false, error: error.message }); }
    await fs.writeFile(path.join(ROOT,'validation',process.argv.includes('--verify-large')?'large-report.json':'live-report.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report.map(r => ({platform:r.platform,passed:r.passed,counts:r.diagnostics?.counts,error:r.error}))));
  app.exit(report.every(r => r.passed) ? 0 : 1);
}
if (ownsInstance) app.whenReady().then(async () => {
  outputDirectory= live||verifyUi||verifyExtraction?path.join(ROOT,'validation','projects'):path.join(app.getPath('desktop'),'自由画布提取');
  store=new ProjectStore(outputDirectory);
  installMediaProtocol();
  ui = new BrowserWindow({ width: 1440, height: 960, minWidth: 680, minHeight: 620, show: !live&&!verifyExtraction&&!verifyThemes&&!verifyAccounts&&!verifyBrowserReset&&!verifyLocalProject&&!verifyDeadline&&!portableSmokeArg, title: '自由画布提取 · v1.0', backgroundColor:uiTheme.tokens.bg,autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname,'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !verifyThemes&&!verifyAccounts&&!verifyBrowserReset&&!verifyLocalProject&&!verifyDeadline&&!portableSmokeArg, offscreen: verifyThemes||verifyAccounts||verifyBrowserReset||verifyLocalProject||verifyDeadline||Boolean(portableSmokeArg) } });
  ui.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  ui.on('closed', () => { ui = null; app.quit(); });
  ui.webContents.on('will-navigate', (event,url) => { if (url !== uiUrl) event.preventDefault(); });
  handle('lab:extract', (input,options) => runExtraction(input, options || {}));
  handle('lab:theme',async value=>{
    appearancePreference=normalizePreference(value);const preference={...appearancePreference};
    const resolved=await refreshAppearance();
    themeWriteTail=themeWriteTail.catch(()=>{}).then(()=>fs.writeFile(appearancePath,JSON.stringify(preference,null,2),'utf8'));
    await themeWriteTail;return resolved;
  });
  nativeTheme.on('updated',()=>{if(appearancePreference.mode==='system')void refreshAppearance().catch(error=>status(error.message,'error'));});
  handle('lab:cancel', () => { if (task) { task.cancelled = true; task.controller.abort(); task.window?.webContents.stop(); } return true; });
  handle('lab:visible', visible => { if (!platformWindow || platformWindow.isDestroyed()) throw new Error('请先打开一个作品。'); visible ? platformWindow.show() : platformWindow.hide(); return visible; });
  handle('lab:update',options=>updateExport(options));
  handle('lab:save',options=>savePrompts(options));
  handle('lab:save-cancel',()=>{if(saveTask)saveTask.cancelled=true;return true;});
  handle('lab:copy', options => { const result = editedResult(options || {}); clipboard.writeText(markdown(result)); return true; });
  handle('lab:copy-text',text=>{if(typeof text!=='string'||text.length>2000000)throw new Error('复制内容无效。');clipboard.writeText(text);return true;});
  handle('lab:cache-thumbnail',async(id,data)=>{const a=currentResult?.assets.find(a=>a.id===id);if(!a||a.kind!=='video'||typeof data!=='string'||data.length>1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))throw new Error('缩略图数据无效。');const bytes=Buffer.from(data.split(',')[1],'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('缩略图格式无效。');const writing=(async()=>{await fs.mkdir(thumbnailRoot,{recursive:true});await fs.writeFile(thumbnailPath(a),bytes);})();thumbnailWrites.add(writing);try{await writing;return true;}finally{thumbnailWrites.delete(writing);}});
  handle('lab:thumbnail-info',async id=>{const a=currentResult?.assets.find(a=>a.id===id);if(!a||a.kind!=='video')return false;return cachedThumbnailPath(a).then(()=>true,()=>false);});
  handle('lab:directory', async () => { if(task||saveTask||queue?.active)throw new Error('请先结束当前任务再更换保存位置。');if(store.directory)throw new Error('当前项目已建立，请在下一个项目首次保存前选择位置。');const r=await dialog.showOpenDialog(ui,{title:'选择项目保存根目录',properties:['openDirectory','createDirectory']});if(!r.canceled){outputDirectory=r.filePaths[0];store=new ProjectStore(outputDirectory);store.options=exportOptions;send('project',{...store.summary(),root:outputDirectory});}return outputDirectory; });
  handle('lab:open-folder', async () => { const dir=store.directory||outputDirectory;await fs.mkdir(dir,{recursive:true}); const err = await shell.openPath(dir); if (err) throw new Error(err); return true; });
  handle('lab:open-local-project',openLocalProject);
  handle('lab:reveal',async id=>{const a=currentResult?.assets.find(a=>a.id===id);if(!a||a.state!=='done')throw new Error('此素材尚未下载。');const file=store.assetPath(a);await fs.access(file);shell.showItemInFolder(file);return true;});
  handle('lab:download',async options=>{if(task||saveTask)throw new Error('请先结束读取或保存任务。');if(queue?.active||downloadSetup)throw new Error('下载正在进行。');if(exportOptions.mode!=='full')throw new Error('请切换到全能模式。');const kinds=(options?.kinds||[]).filter(k=>['image','video','audio'].includes(k));if(!kinds.length)throw new Error('请至少选择一种素材类型。');if(!currentResult)throw new Error('请先读取画布。');const targets=selectDownloadAssets(currentResult.assets,options?.ids);downloadSetup=true;try{await ensureProject();send('project',store.summary());queue=createQueue();queue.start(targets,kinds,Boolean(options.retryOnly),Boolean(options.force)).catch(e=>status(e.message,'error'));return true;}finally{downloadSetup=false;}});
  handle('lab:download-control',action=>{if(!queue?.active)throw new Error('没有正在运行的下载任务。');if(action==='pause')queue.pause();else if(action==='resume')queue.resume();else if(action==='cancel')queue.cancel();else throw new Error('不支持的下载操作。');return true;});
  handle('lab:login',async platform=>{if(!['liblib','jimeng'].includes(platform))throw new Error('不支持的平台。');if(task||saveTask||queue?.active||downloadSetup)throw new Error('请等待当前任务完成再登录。');const win=getPlatformWindow(platform,true);const info=accounts.open(platform);win.focus();return info;});
  handle('lab:login-state',async()=>{if(!platformWindow)return {platform:null,label:'尚未打开登录页面'};return loginState(currentPlatform);});
  handle('lab:reset-browser',resetBrowser);
  handle('lab:info', () => ({ outputDirectory, types:PROMPT_TYPES,options:exportOptions,accounts:accounts.snapshots() }));
  await ui.loadFile(path.join(__dirname,'ui','index.html'));
  if(verifyUi)ui.webContents.on('console-message',event=>console.log('Renderer:',event.level,event.message));
  // The Windows launcher hides its helper process; show the app again once ready.
  if(!live&&!verifyExtraction&&!verifyThemes&&!verifyAccounts&&!verifyBrowserReset&&!verifyLocalProject&&!verifyDeadline&&!portableSmokeArg){ui.show();ui.focus();}
  if(portableSmokeArg){
    // Minimal release smoke: exercise the packaged renderer and real theme IPC,
    // without platform navigation. Write evidence only to an explicitly given path.
    const reportPath=portableSmokeArg.slice('--portable-smoke='.length);
    if(!path.isAbsolute(reportPath))throw new Error('Smoke report requires an absolute path.');
    await boundedRead(()=>ui.webContents.executeJavaScript(`(async()=>{const size=document.getElementById('prompt-font-size');if(!localStorage.getItem('portable-smoke-saved')){document.querySelector('[data-appearance-mode=dark]').click();size.value='18';size.dispatchEvent(new Event('change'));localStorage.setItem('portable-smoke-saved','true');}await window.lab.theme({palette:document.documentElement.dataset.palette,mode:document.documentElement.dataset.themeMode});return{title:document.title,fontSize:size.value,mode:document.documentElement.dataset.themeMode,stored:localStorage.getItem('prompt-typography-v1'),bodyReady:Boolean(document.getElementById('open-local-project')),localStorageMarker:localStorage.getItem('portable-smoke-saved')};})()`),{timeoutMs:5000});
    const renderer=await ui.webContents.executeJavaScript(`({title:document.title,fontSize:document.getElementById('prompt-font-size').value,mode:document.documentElement.dataset.themeMode,stored:localStorage.getItem('prompt-typography-v1'),bodyReady:Boolean(document.getElementById('open-local-project')),localStorageMarker:localStorage.getItem('portable-smoke-saved')})`);
    await themeWriteTail;await session.defaultSession.flushStorageData();
    await fs.writeFile(reportPath,JSON.stringify({passed:app.isPackaged&&renderer.bodyReady&&renderer.fontSize==='18'&&renderer.mode==='dark',version:app.getVersion(),electron:process.versions.electron,isPackaged:app.isPackaged,executable:process.execPath,dataRoot:DATA_ROOT,profile:app.getPath('userData'),root:ROOT,renderer},null,2));app.quit();return;
  }
  if(verifyDeadline){await require('./verify-read-deadline.cjs')({root:ROOT,ui,runExtraction,getWindow:()=>platformWindow,getFeedback:()=>extractionFeedback,session});app.exit(0);return;}
  if(verifyLocalProject){await require('./verify-local-project.cjs')({ui,root:ROOT,dialog,session,getStore:()=>store,setTasks:values=>{task=values.task||null;saveTask=values.saveTask||null;queue=values.queue||null;downloadSetup=Boolean(values.downloadSetup);}});app.exit(0);return;}
  if(verifyBrowserReset){await require('./verify-browser-reset.cjs')({ui,accounts,session,root:ROOT,thumbnailRoot,getWindow:()=>platformWindow,setResult:value=>{currentResult=value;},setTasks:values=>{task=values.task||null;saveTask=values.saveTask||null;queue=values.queue||null;downloadSetup=Boolean(values.downloadSetup);}});app.exit(0);return;}
  if(verifyAccounts){await require('./verify-account-startup.cjs')({ui,accounts,getWindow:()=>platformWindow,session,root:ROOT});app.exit(0);return;}
  if(!live&&!verifyUi&&!verifyExtraction&&!verifyThemes&&!process.argv.includes('--probe-network'))accounts.start();
  if(verifyThemes){
    await require('./verify-themes.cjs')({ui,root:ROOT,setFeedback:value=>{extractionFeedback=value;},getTheme:()=>uiTheme});
    app.exit(0);return;
  }
  if(verifyExtraction){
    await require('./verify-extraction.cjs')({root:ROOT,runExtraction,getWindow:()=>platformWindow,getFeedback:()=>extractionFeedback,ui});
    app.once('will-quit',()=>fsSync.writeFileSync(path.join(ROOT,'validation','extraction-quit-report.json'),JSON.stringify({passed:true,reason:'主程序关闭后正常进入 will-quit，独立浮层未阻止退出。'},null,2)));
    ui.close();return;
  }
  if(process.argv.includes('--probe-network')) {const win=getPlatformWindow('liblib',true);await loadWork(win,'https://www.liblib.tv/detail/dd52623a77ed4713955009228c621446');await require('./probe-network.cjs')({root:ROOT,session,net});app.exit(0);return;}
  if(verifyV08){await require('./verify-v08.cjs')({ui,send,root:ROOT,setResult:r=>{verificationResult=r;},setFetcher:fn=>{verificationFetcher=fn;},getStore:()=>store});app.exit(0);}
  else if (verifyUi) {
    const large=process.argv.includes('--verify-ui-large');
    currentResult = JSON.parse(await fs.readFile(path.join(ROOT,'validation',large?'liblib-large-snapshot.json':'liblib-snapshot.json'),'utf8'));
    await store.create(currentResult,{...exportOptions,mode:large?'simple':'full'});exportOptions=store.options;
    await require('./verify-refinements.cjs')({ ui, result: currentResult, send,store,root:ROOT,large,setVerificationFetcher:fn=>{verificationFetcher=fn;} });
    app.exit(0);
  } else if (live) await verifyLive();
}).catch(error => { console.error(error.stack||error.message); app.exit(1); });
app.on('before-quit', () => { app.quitting = true;accounts.dispose(); if (task) task.cancelled = true;if(saveTask)saveTask.cancelled=true;if(queue?.active)queue.cancel(); });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (ui && !ui.isDestroyed()) ui.show(); });
process.on('uncaughtException', error => { console.error(error.message); if (live || verifyUi) app.exit(1); });
