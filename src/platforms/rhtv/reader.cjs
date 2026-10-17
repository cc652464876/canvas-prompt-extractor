'use strict';
function readCanvas() {
  const candidates = [],
    seen = new Set();
  const keep = (nodes, edges, source) => {
    if (!Array.isArray(nodes) || !Array.isArray(edges) || seen.has(nodes)) return;
    if (!nodes.every((n) => n && typeof n.id === 'string' && n.data)) return;
    seen.add(nodes);
    candidates.push({ nodes, edges, source });
  };
  const roots = [
    ...document.querySelectorAll('.react-flow, .react-flow__renderer, .react-flow__nodes')
  ].slice(0, 12);
  for (const el of roots) {
    let fiber = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))];
    for (let i = 0; i < 110 && fiber; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps || {};
      keep(p.nodes, p.edges, 'rhtv-react-flow-props');
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
  // Do not serialize node callbacks, API credentials or account state. These
  // fields are the canvas content observed in editable and community previews.
  const fields = [
    'label',
    'title',
    'name',
    'text',
    'content',
    'prompt',
    'params',
    'modelCode',
    'generateNum',
    'subType',
    'output',
    'sourceObjects',
    'imageUrl',
    'videoUrl',
    'audioUrl',
    'thumbnail',
    'sourceNodeId',
    'sourceImageNodeId',
    'toolsType',
    'toolsSourceUrl',
    'sourceVideo',
    'imageOrder',
    'videoOrder',
    'audioOrder',
    'textOrder',
    'aspectRatio',
    'width',
    'height',
    'groupName',
    'groupId',
    'clipReshootFreeText',
    'clipReshootClips',
    'clipReshootDurationSec',
    'directorPrompt'
  ];
  const clone = (value) =>
    JSON.parse(
      JSON.stringify(value, (key, val) =>
        typeof val === 'function' ||
        /^(?:apiKey|api_key|apiKeyMode|accessToken|refreshToken|authorization|password|cookie)$/i.test(
          key
        )
          ? undefined
          : val
      )
    );
  const types = {
    'rh-image': 'image',
    'rh-video': 'video',
    'rh-audio': 'audio',
    'rh-text': 'text',
    'text-input': 'text',
    'image-input': 'image',
    'video-input': 'video',
    'audio-input': 'audio'
  };
  const nodes = candidate.nodes.map((n) => {
    const data = {};
    for (const key of fields)
      if (n.data[key] !== undefined) {
        try {
          data[key] = clone(n.data[key]);
        } catch {}
      }
    data.name = data.label || data.title || data.name;
    data.rhtvType = n.type;
    return {
      id: n.id,
      type: types[n.type] || n.type,
      parentId: n.parentId || n.parentNode || data.groupId,
      position: clone(n.position || {}),
      data
    };
  });
  const status = (document.body?.innerText || '').match(/(\d+) nodes?, (\d+) edges?/i);
  return {
    found: true,
    source: candidate.source,
    frameUrl: location.href,
    canvasTitle: document.title.replace(/\s*[丨|]\s*RHTV.*$/i, ''),
    expectedNodes: status ? Number(status[1]) : null,
    expectedEdges: status ? Number(status[2]) : null,
    visibleNodes: document.querySelectorAll('.react-flow__node').length,
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
  const body = document.body?.innerText || '';
  const canvas = /^\/project\/canvas\/[^/]+\/?$/.test(location.pathname);
  const heading = [...document.querySelectorAll('h1')].find(visible);
  const button = [...document.querySelectorAll('button, [role="button"]')].find(
    (b) =>
      visible(b) &&
      /^(查看创作过程|查看制作过程)$/.test((b.innerText || b.textContent || '').trim())
  );
  return {
    title: canvas
      ? document.title.replace(/\s*[丨|]\s*RHTV.*$/i, '')
      : heading?.textContent.trim() || '',
    author: document.querySelector('.camp-detail__creator strong')?.textContent.trim() || '',
    resolvedUrl: location.href,
    canOpenCanvas: Boolean(button),
    loginVisible: /扫码登录|验证码登录|请输入手机号|登录后查看/.test(body),
    readonly: /只读浏览模式|只读模式/.test(body)
  };
}
function openCanvas(allowClick = true) {
  const visible = (el) => Boolean(el && el.getClientRects().length);
  if ([...document.querySelectorAll('.react-flow')].some(visible)) return { alreadyOpen: true };
  const button = [...document.querySelectorAll('button, [role="button"]')].find(
    (b) =>
      visible(b) &&
      /^(查看创作过程|查看制作过程)$/.test((b.innerText || b.textContent || '').trim())
  );
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
