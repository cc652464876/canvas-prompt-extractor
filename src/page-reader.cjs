'use strict';

// This function is serialized into the page's main world. No Node APIs are exposed.
function readCanvas() {
  const candidates = [];
  const seen = new Set();
  let controller = null;
  const keep = (nodes, edges, source) => {
    if (!Array.isArray(nodes) || !nodes.length || !nodes.every(n => n && typeof n.id === 'string' && n.data)) return;
    if (seen.has(nodes)) return;
    seen.add(nodes); candidates.push({ nodes, edges: Array.isArray(edges) ? edges : [], source });
  };
  const roots = Array.from(document.querySelectorAll('.react-flow, .react-flow__renderer, .react-flow__nodes')).slice(0, 12);
  for (const el of roots) {
    let fiber = el[Object.keys(el).find(k => k.startsWith('__reactFiber'))];
    for (let i = 0; i < 110 && fiber; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps || {};
      keep(p.nodes, p.edges, 'react-flow-props');
      const value = p.value;
      if (value?.draft?.getDocument && value?.projectSnapshot && value?.canvasStore) controller = value;
      let hook = fiber.memoizedState;
      for (let j = 0; j < 30 && hook; j++, hook = hook.next) {
        const s = hook.memoizedState;
        if (s && typeof s === 'object') keep(s.nodes, s.edges, 'react-hook');
      }
    }
  }
  if (controller) {
    try {
      const doc = controller.draft.getDocument();
      keep(doc.nodes, doc.edges, 'jimeng-draft-document');
    } catch {}
  }
  const canonical = candidates.find(c => c.source === 'jimeng-draft-document');
  candidates.sort((a, b) => b.nodes.length - a.nodes.length);
  const candidate = canonical || candidates[0];
  const bodyText = document.body?.innerText || '';
  const status = bodyText.match(/(\d+) nodes, (\d+) edges/i);
  if (!candidate) return { found: false, frameUrl: location.href, title: document.title, visibleNodes: document.querySelectorAll('.react-flow__node').length,
    flowRoots: roots.length, loading: /项目加载中|画布加载中/.test(bodyText), login: /欢迎登录|请输入手机号/.test(bodyText),
    hint: bodyText.includes('只读模式') ? 'readonly' : bodyText.includes('查看制作过程') || bodyText.includes('查看创作过程') ? 'detail' : 'other' };
  const dataKeys = ['name', 'title', 'action', 'params', 'content', 'text', 'storageText', 'generationDraft', 'source', 'resourceId', 'resourceBatches', 'tags', 'url', 'poster', 'uploaded', 'generatorType', 'resourceMeta', 'width', 'height', 'ratio'];
  const clone = v => JSON.parse(JSON.stringify(v, (key, val) => typeof val === 'function' ? undefined : val));
  const nodes = candidate.nodes.map(n => {
    const data = {};
    for (const key of dataKeys) if (n.data[key] !== undefined) { try { data[key] = clone(n.data[key]); } catch {} }
    return { id: n.id, type: n.type, parentId: n.parentId, position: clone(n.position || n.layout || {}), data };
  });
  const mediaResources = {};
  if (controller) {
    const state = controller.resourceStateStore?.stateStore?.getState?.();
    const server = state?.serverResourceById;
    for (const node of nodes) {
      const id = node.data.resourceId;
      const resource = typeof server?.get === 'function' ? server.get(id) : server?.[id];
      if (resource) mediaResources[id] = clone({ id, urls: resource.urls, width: resource.image?.width || resource.video?.width,
        height: resource.image?.height || resource.video?.height, duration: resource.video?.duration || resource.audio?.duration });
    }
  }
  return {
    found: true, source: candidate.source, frameUrl: location.href,
    canvasTitle: controller?.projectSnapshot?.name || document.title.replace(/\s*-\s*(LibTV|即梦AI).*$/i, ''),
    expectedNodes: status ? Number(status[1]) : null,
    expectedEdges: status ? Number(status[2]) : null,
    visibleNodes: document.querySelectorAll('.react-flow__node').length,
    candidateCounts: candidates.map(c => ({ source: c.source, count: c.nodes.length })),
    nodes, mediaResources, edges: candidate.edges.map(e => ({ id: e.id, source: e.source, target: e.target, type: e.type }))
  };
}

function inspectWork(platform) {
  const visible = el => Boolean(el && el.getClientRects().length);
  const body = document.body?.innerText || '';
  const headings = Array.from(document.querySelectorAll(platform === 'liblib' ? 'h1' : 'h2')).filter(visible);
  const heading = headings.find(h => !/欢迎登录|体验升级|即梦AI/.test(h.textContent));
  const title = heading?.textContent.trim() || '';
  let author = '';
  if (platform === 'liblib') {
    const region = document.querySelector('[aria-label="作者信息"]');
    const text = region?.querySelector('button')?.innerText.trim() || '';
    author = text.split(/\n/).find(Boolean) || '';
  } else if (heading) {
    let parent = heading.parentElement;
    for (let i = 0; i < 4 && parent && !author; i++, parent = parent.parentElement) {
      const buttons = Array.from(parent.querySelectorAll('button')).filter(visible);
      const button = buttons.find(b => b.querySelector('img') && b.innerText.trim() && !/登录|查看|复制|关注|返回/.test(b.innerText));
      if (button) author = button.innerText.trim().split('\n')[0];
    }
  }
  const button = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => visible(b) && /^查看(制作|创作)过程$/.test((b.innerText || b.textContent).trim()));
  return { title, author, resolvedUrl: location.href, canOpenCanvas: Boolean(button), loginVisible: /欢迎登录|请输入手机号/.test(body), readonly: /只读模式|Read-only/.test(body) };
}

function openCanvas(allowClick = true, allowDismiss = true) {
  const visible = el => Boolean(el.getClientRects().length);
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  // Use the site's normal close action, never remove a login barrier from the DOM.
  const close = buttons.find(b => visible(b) && /关闭登录弹窗/.test(b.getAttribute('aria-label') || b.innerText || ''));
  if (close&&allowDismiss) { close.click(); return { closedLoginHint: true }; }
  const popupClose=buttons.find(b=>visible(b)&&/^(关闭广告|关闭活动弹窗|关闭推荐弹窗)$/.test(b.getAttribute('aria-label')||''));
  if(popupClose&&allowDismiss){popupClose.click();return {closedPopup:true};}
  if ([...document.querySelectorAll('.react-flow, iframe[src*="/ai-canvas/"]')].some(visible)) return { alreadyOpen: true };
  const button = buttons.find(b => visible(b) && /^查看(制作|创作)过程$/.test((b.innerText || b.textContent).trim()));
  if(button){
    if(allowClick)button.scrollIntoView({block:'center',behavior:'instant'});
    const rect=button.getBoundingClientRect(),top=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
    if(button.disabled||!top||!(top===button||button.contains(top)))return {blocked:true};
    if(allowClick){button.click();return {clicked:true};}
  }
  return { clicked: false };
}

module.exports = { readCanvas, inspectWork, openCanvas };
