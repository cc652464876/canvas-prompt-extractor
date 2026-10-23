'use strict';
function readCanvas() {
  if (!['neowow.cn', 'www.neowow.cn'].includes(location.hostname))
    return { found: false, frameUrl: location.href };
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const preview = [...document.querySelectorAll('.canvas-preview-dialog')].find(visible);
  const direct =
    ['/workflow', '/ai-workflow'].includes(location.pathname) &&
    new URL(location.href).searchParams.has('sessionId');
  const shared =
    location.pathname === '/workflows' && new URL(location.href).searchParams.has('shareCode');
  if (!preview && !direct && !shared) return { found: false, frameUrl: location.href };
  // Production Vue builds omit __vueParentComponent. Walk the mounted vnode
  // tree and read VueFlow's full model, including nodes outside the viewport.
  // Never traverse account stores, call page APIs, or serialize vnode internals.
  const app = document.querySelector('#app');
  const stack = [app?._vnode, app?.__vue_app__?._instance?.subTree];
  const seen = new Set(),
    candidates = [];
  let canvasId = '',
    title = '';
  while (stack.length && seen.size < 150000) {
    const vnode = stack.pop();
    if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) continue;
    seen.add(vnode);
    const component = vnode.component;
    if (component) {
      const name = component.type?.__name || component.type?.name;
      const props = component.props || {};
      if (name === 'CanvasPreviewDialog' && props.visible) {
        canvasId = props.templateCode || '';
        title = props.title || '';
      }
      if (name === 'VueFlow' && Array.isArray(props.nodes) && Array.isArray(props.edges)) {
        const el = vnode.el || component.subTree?.el;
        if ((!preview || (el && preview.contains(el))) && (!el || visible(el)))
          candidates.push({ nodes: props.nodes, edges: props.edges });
      }
      stack.push(component.subTree);
    }
    if (Array.isArray(vnode.children)) stack.push(...vnode.children);
    if (vnode.suspense) stack.push(vnode.suspense.activeBranch);
  }
  candidates.sort((a, b) => b.nodes.length - a.nodes.length);
  const candidate = candidates[0];
  const scope = preview || document;
  const loading = [
    ...scope.querySelectorAll(
      '.loading-overlay, .loading-container, .canvas-loading, [aria-busy="true"]'
    )
  ].some(visible);
  const login = [...document.querySelectorAll('h2')].some(
    (el) => visible(el) && /欢迎登录/.test(el.textContent)
  );
  // Login failures leave a mounted but empty VueFlow. Never report that as a
  // successfully extracted empty project while the login or loading UI is open.
  if (!candidate || loading || login)
    return { found: false, frameUrl: location.href, loading, loginVisible: login };
  const fields = [
    'label',
    'name',
    'title',
    'type',
    'content',
    'text',
    'prompt',
    'result',
    'systemPrompt',
    'negativePrompt',
    'model',
    'modelName',
    'modelDisplayName',
    'modelId',
    'generationType',
    'status',
    'source',
    'sourceNodeId',
    'mediaSource',
    'mediaType',
    'mediaUrl',
    'imageUrl',
    'videoUrl',
    'audioUrl',
    'inputImageUrl',
    'inputVideoUrl',
    'inputAudioUrl',
    'inputImageUrls',
    'inputVideoUrls',
    'inputAudioUrls',
    'connectedImageUrls',
    'connectedVideoUrls',
    'connectedAudioUrls',
    'inputTexts',
    'manualReferences',
    'referenceDisplayOrder',
    'connectedNameMap',
    'connectedSourceMap',
    'width',
    'height',
    'duration',
    'aspectRatio',
    'resolution',
    'batchSize',
    'seed',
    'style',
    'fileName',
    'universalModel',
    'universalDuration',
    'universalResolution',
    'universalAspectRatio',
    'universalEnableAudio',
    'enableAudio',
    'voiceModel',
    'seedAudioPrompt',
    'seedAudioConfig',
    'rate',
    'pitch',
    'tone',
    'volume',
    'emotion',
    'videoInputs',
    'audioInputs',
    'comments'
  ];
  const clone = (value) =>
    JSON.parse(
      JSON.stringify(value, (key, val) =>
        typeof val === 'function' ||
        /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|cookie|email|phone)$/i.test(
          key
        )
          ? undefined
          : val
      )
    );
  const nodes = candidate.nodes.map((node) => {
    const data = {};
    for (const key of fields)
      if (node.data?.[key] !== undefined) {
        try {
          data[key] = clone(node.data[key]);
        } catch {
          /* Keep other readable fields. */
        }
      }
    data.name = data.label || data.name || data.title;
    data.neowowType = node.type;
    let type = node.type;
    if (type === 'mediaInput' || type === 'imageInput')
      type = data.mediaType || (type === 'imageInput' ? 'image' : type);
    if (type === 'videoComposition') {
      type = 'video';
      data.type = 'composition';
    }
    if (type === 'comment') {
      type = 'text';
      data.content =
        data.content ??
        data.text ??
        data.comments?.map((c) => c.content ?? c.text ?? { type: 'unsupported-comment' });
    }
    if (type === 'text') data.content = data.content ?? data.text ?? data.result ?? data.prompt;
    return {
      id: node.id,
      type,
      parentId: node.parentNode || node.parentId,
      position: clone(node.position || {}),
      data
    };
  });
  const query = new URL(location.href).searchParams;
  canvasId ||= query.get('sessionId') || query.get('shareCode') || '';
  return {
    found: true,
    source: 'neowow-vue-flow-props',
    frameUrl: location.href,
    canvasTitle:
      title ||
      scope.querySelector('.preview-title')?.textContent.trim() ||
      document.title.replace(/\s*·\s*NeoWOW.*$/i, ''),
    ...(location.pathname === '/video-works-view' && query.get('id')
      ? { workIdentity: 'neowow:work:' + query.get('id') }
      : canvasId
        ? { workIdentity: 'neowow:canvas:' + canvasId }
        : {}),
    expectedNodes: null,
    expectedEdges: null,
    visibleNodes: scope.querySelectorAll('.vue-flow__node').length,
    nodes,
    edges: candidate.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle
    })),
    mediaResources: {}
  };
}
function inspectWork() {
  if (location.protocol === 'chrome-error:') return { pageError: true, resolvedUrl: location.href };
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const preview = [...document.querySelectorAll('.canvas-preview-dialog')].find(visible);
  const scope = document.querySelector('.video-works-page') || document;
  const heading = [...scope.querySelectorAll('.topbar-title')].find(visible);
  const title =
    preview?.querySelector('.preview-title')?.textContent.trim() ||
    heading?.textContent.trim() ||
    '';
  const buttons = [...scope.querySelectorAll('button')].filter(visible);
  const process = buttons.find((el) =>
    /^(查看制作过程|查看创作过程|赞赏查看创作过程)$/.test(el.textContent.trim())
  );
  const loginVisible = [...document.querySelectorAll('h2')].some(
    (el) => visible(el) && /欢迎登录/.test(el.textContent)
  );
  const reward = [...document.querySelectorAll('.rwd-dialog')].some(visible);
  const detail = location.pathname === '/video-works-view';
  const workId =
    new URL(location.href).searchParams.get('id') ||
    new URL(location.href).searchParams.get('sessionId');
  const video = [...scope.querySelectorAll('.detail-cover video')].find(visible);
  const videoUrl = video?.currentSrc || video?.getAttribute('src') || '';
  const accessError = loginVisible
    ? 'NeoWow 需要登录。请在“程序设置 → 网站访问 → NeoWow”完成程序内登录，再重新读取。Chrome 登录不会自动共享给程序。'
    : reward
      ? '此 NeoWow 作品需要赞赏授权。请先在网站确认访问权限，再重新读取；程序不会自动赞赏或付费。'
      : '';
  return {
    title,
    author: [...scope.querySelectorAll('.topbar-author')].find(visible)?.textContent.trim() || '',
    resolvedUrl: location.href,
    loginVisible,
    ...(accessError ? { accessError } : {}),
    readonly: Boolean(preview),
    canOpenCanvas: Boolean(process),
    // An explicit not-public notice is required; an unmounted/loading process
    // button must not silently downgrade a public or restricted work.
    detailReady: Boolean(
      detail &&
      heading &&
      /(?:画布|创作过程|制作过程)(?:暂未|尚未|未)公开/.test(scope.innerText || '') &&
      !reward
    ),
    loading: [
      ...scope.querySelectorAll('.loading-overlay, .loading-container, [aria-busy="true"]')
    ].some(visible),
    ...(videoUrl.startsWith('https://')
      ? {
          fullVideo: {
            workId,
            name: title,
            url: videoUrl,
            previewUrl: video.poster || '',
            duration: Number.isFinite(video.duration) ? video.duration : undefined
          }
        }
      : {})
  };
}
async function openCanvas(allowClick = true, allowDismiss = true) {
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const giftClose = [...document.querySelectorAll('.agift-overlay .agift-close')].find(visible);
  if (giftClose && allowDismiss) {
    giftClose.click();
    return { closedPopup: true };
  }
  if ([...document.querySelectorAll('.canvas-preview-dialog, .workflow-container')].some(visible))
    return { alreadyOpen: true };
  if (location.pathname !== '/video-works-view') return { clicked: false };
  const scope = document.querySelector('.video-works-page');
  if (!scope) return { clicked: false };
  // NeoWow's detail viewer requires originalSessionId even for canvas works,
  // while its square opens their published sessionId directly. When that
  // viewer shows the not-ready dialog, resolve the same work through the
  // website's read-only query and call its public preview entry point.
  if (allowClick && /创作过程正在收录中/.test(document.body?.innerText || '')) {
    const token = localStorage.getItem('token');
    if (!token)
      return {
        accessError: 'NeoWow 需要登录。请在“程序设置 → 网站访问 → NeoWow”完成程序内登录后重试。'
      };
    const id = new URL(location.href).searchParams.get('id');
    if (!id || typeof window.openCanvasPreview !== 'function')
      return {
        accessError: 'NeoWow 未返回可查看的画布，请使用作品广场中可正常打开的画布链接重试。'
      };
    const query = async (url, body) => {
      const headers = {
        'Content-Type': 'application/json',
        accessToken: token,
        timestamp: String(Date.now())
      };
      const channel = localStorage.getItem('channelCode');
      if (channel) headers.channelCode = channel;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3500)
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    };
    try {
      const response = await query('/ucenter/video-showcase/queryByLogin', {
        id,
        pageNum: 1,
        pageSize: 10,
        platformType: 1,
        status: 1,
        keyword: ''
      });
      const work =
        response.success && Array.isArray(response.data)
          ? response.data.find((w) => String(w.id) === id)
          : null;
      if (
        !work ||
        work.isPublic !== 1 ||
        work.dataType !== 2 ||
        typeof work.sessionId !== 'string' ||
        !/^SSN_[\w-]+$/.test(work.sessionId)
      )
        return {
          accessError:
            '此 NeoWow 作品未返回可访问的公开画布。请确认已登录且作品已公开，或直接粘贴可正常打开的画布链接。'
        };
      if (work.isReward === 1) {
        const access = await query('/ucenter/video-showcase/reward/has-rewarded', {
          originalSessionId: work.originalSessionId || work.sessionId
        });
        if (!access.success || access.data !== true)
          return { accessError: '此 NeoWow 作品需要赞赏授权，请先在网站自行处理后重试。' };
      }
      const close = [...document.querySelectorAll('button')].find(
        (el) => visible(el) && el.textContent.trim() === '稍后再看'
      );
      close?.click();
      window.openCanvasPreview({
        title: work.title || '',
        templateCode: work.sessionId,
        isNeoTv: true
      });
      return { clicked: true };
    } catch {
      return { accessError: '读取 NeoWow 公开画布信息失败，请检查网络或重新登录后重试。' };
    }
  }
  const button = [...scope.querySelectorAll('button')].find(
    (el) =>
      visible(el) && /^(查看制作过程|查看创作过程|赞赏查看创作过程)$/.test(el.textContent.trim())
  );
  // The process gate only checks existing access. Payment, clone, create and
  // generation controls are never activated; inspectWork stops on .rwd-dialog.
  if (!button) return { clicked: false };
  if (button.disabled) return { blocked: true };
  if (!allowClick) return { clicked: false };
  button.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = button.getBoundingClientRect();
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!top || !(top === button || button.contains(top))) return { blocked: true };
  button.click();
  return { clicked: true };
}
module.exports = { readCanvas, inspectWork, openCanvas };
