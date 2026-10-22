'use strict';
function readCanvas() {
  if (!/^\/(?:canvas\/[^/]+|home\/taptv\/[^/]+\/[^/]+)\/?$/.test(location.pathname))
    return { found: false, frameUrl: location.href };
  const candidates = [],
    seen = new Set();
  for (const el of [
    ...document.querySelectorAll('.react-flow, .react-flow__renderer, .react-flow__nodes')
  ].slice(0, 12)) {
    let fiber = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))];
    for (let i = 0; i < 110 && fiber; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps || {};
      if (
        !Array.isArray(p.nodes) ||
        !Array.isArray(p.edges) ||
        seen.has(p.nodes) ||
        !p.nodes.every((n) => n && typeof n.id === 'string' && n.data)
      )
        continue;
      seen.add(p.nodes);
      candidates.push({ nodes: p.nodes, edges: p.edges });
    }
  }
  candidates.sort((a, b) => b.nodes.length - a.nodes.length);
  const candidate = candidates[0];
  if (!candidate)
    return {
      found: false,
      frameUrl: location.href,
      visibleNodes: document.querySelectorAll('.react-flow__node').length
    };
  const clone = (value) =>
    JSON.parse(
      JSON.stringify(value, (key, val) =>
        typeof val === 'function' ||
        /^(?:apiKey|api_key|apiKeyMode|accessToken|refreshToken|authorization|password|cookie|created_by|email)$/i.test(
          key
        )
          ? undefined
          : val
      )
    );
  // Read current canvas content only, excluding account state, callbacks and
  // historical prompt drafts whose relationship to active media is unverified.
  const fields = [
    'title',
    'name',
    'type',
    'prompt',
    'text',
    'content',
    'params',
    'src',
    'options',
    '__metadata',
    'taskInfo',
    'editSubType',
    'historySourceNodeId'
  ];
  const nodes = candidate.nodes.map((n) => {
    const data = {};
    for (const key of fields)
      if (n.data[key] !== undefined) {
        try {
          data[key] = clone(n.data[key]);
        } catch {}
      }
    data.name = data.title || data.name;
    data.tapnowType = n.type;
    if (n.type === 'comment')
      data.content = (Array.isArray(n.data.comments) ? n.data.comments : []).map(
        (c) => c?.content ?? c?.text ?? c?.body ?? { type: 'unsupported-comment' }
      );
    return {
      id: n.id,
      type: n.type === 'comment' ? 'text' : n.type,
      parentId: n.parentId || n.parentNode || n.parent_id || undefined,
      position: clone(n.position || {}),
      data
    };
  });
  return {
    found: true,
    source: 'tapnow-react-flow-props',
    frameUrl: location.href,
    canvasTitle: document.title.replace(/\s*\|\s*(?:TapTV\s*\|\s*)?TapNow.*$/i, ''),
    expectedNodes: null,
    expectedEdges: null,
    visibleNodes: document.querySelectorAll('.react-flow__node').length,
    nodes,
    edges: candidate.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      sourceHandle: e.sourceHandle || e.source_handle,
      targetHandle: e.targetHandle || e.target_handle,
      ...(Number.isFinite(e.data?.order) ? { order: e.data.order } : {})
    })),
    mediaResources: {}
  };
}
function inspectWork(_platform, readPublished = null) {
  if (location.protocol === 'chrome-error:') return { pageError: true, resolvedUrl: location.href };
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const heading = [...document.querySelectorAll('h1')].find(visible);
  const button = [
    ...document.querySelectorAll('[data-testid="community-taptv-video-remix-btn"]')
  ].find(visible);
  const title = /^\/canvas\//.test(location.pathname)
    ? document.title.replace(/\s*\|\s*TapNow.*$/i, '')
    : heading?.textContent.trim() || '';
  const author =
    heading?.parentElement?.querySelector('.flex.flex-col.gap-1 > span')?.textContent.trim() ||
    heading?.parentElement?.querySelector('img[alt]')?.getAttribute('alt') ||
    '';
  const workId = location.pathname.match(/^\/home\/taptv\/[^/]+\/([^/]+)\/?$/)?.[1];
  let fullVideo;
  let fiber = heading?.[Object.keys(heading).find((key) => key.startsWith('__reactFiber'))];
  for (let i = 0; fiber && i < 45; i++, fiber = fiber.return) {
    const props = fiber.memoizedProps || {};
    const item = [props.video, props.item, props.data, props.detail].find(
      (value) => value && String(value.id) === workId && typeof value.video_url === 'string'
    );
    if (item && /^https:\/\//.test(item.video_url))
      fullVideo = {
        workId,
        name: item.title || title,
        url: item.video_url,
        previewUrl: item.cover_image_url || '',
        duration: item.duration
      };
  }
  return {
    title,
    author,
    ...(readPublished
      ? readPublished({
          workId: location.pathname.match(/^\/home\/taptv\/[^/]+\/([^/]+)\/?$/)?.[1],
          title,
          heading,
          detail: /^\/home\/taptv\/[^/]+\/[^/]+\/?$/.test(location.pathname),
          process: Boolean(button),
          login: /扫码登录|验证码登录|登录后查看|Sign in to/i.test(document.body?.innerText || '')
        })
      : {}),
    ...(fullVideo ? { fullVideo } : {}),
    resolvedUrl: location.href,
    canOpenCanvas: Boolean(button),
    loginVisible: /扫码登录|验证码登录|登录后查看|Sign in to/i.test(document.body?.innerText || ''),
    readonly: /只读预览/.test(document.body?.innerText || '')
  };
}
function openCanvas(allowClick = true) {
  // Never click the many process buttons on a listing or recommendation card.
  if (!/^\/home\/taptv\/[^/]+\/[^/]+\/?$/.test(location.pathname)) return { clicked: false };
  const visible = (el) => Boolean(el && el.getClientRects().length);
  if ([...document.querySelectorAll('.react-flow')].some(visible)) return { alreadyOpen: true };
  const button = [
    ...document.querySelectorAll('[data-testid="community-taptv-video-remix-btn"]')
  ].find(visible);
  if (!button) return { clicked: false };
  if (button.disabled) return { blocked: true };
  if (allowClick) button.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = button.getBoundingClientRect(),
    top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!top || !(top === button || button.contains(top))) return { blocked: true };
  if (allowClick) {
    button.click();
    return { clicked: true };
  }
  return { clicked: false };
}
module.exports = { readCanvas, inspectWork, openCanvas };
