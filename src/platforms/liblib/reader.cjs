'use strict';
function readCanvas() {
  const candidates = [];
  const seen = new Set();
  const keep = (nodes, edges, source) => {
    if (
      !Array.isArray(nodes) ||
      !nodes.length ||
      !nodes.every((n) => n && typeof n.id === 'string' && n.data)
    )
      return;
    if (seen.has(nodes)) return;
    seen.add(nodes);
    candidates.push({ nodes, edges: Array.isArray(edges) ? edges : [], source });
  };
  const roots = Array.from(
    document.querySelectorAll('.react-flow, .react-flow__renderer, .react-flow__nodes')
  ).slice(0, 12);
  for (const el of roots) {
    let fiber = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))];
    for (let i = 0; i < 110 && fiber; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps || {};
      keep(p.nodes, p.edges, 'react-flow-props');
      let hook = fiber.memoizedState;
      for (let j = 0; j < 30 && hook; j++, hook = hook.next) {
        const s = hook.memoizedState;
        if (s && typeof s === 'object') keep(s.nodes, s.edges, 'react-hook');
      }
    }
  }
  candidates.sort((a, b) => b.nodes.length - a.nodes.length);
  const candidate = candidates[0];
  const bodyText = document.body?.innerText || '';
  const status = bodyText.match(/(\d+) nodes?, (\d+) edges?/i);
  if (!candidate)
    return {
      found: false,
      frameUrl: location.href,
      title: document.title,
      visibleNodes: document.querySelectorAll('.react-flow__node').length,
      flowRoots: roots.length,
      loading: /项目加载中|画布加载中/.test(bodyText),
      login: /欢迎登录|请输入手机号/.test(bodyText),
      hint: bodyText.includes('只读模式')
        ? 'readonly'
        : bodyText.includes('查看制作过程') || bodyText.includes('查看创作过程')
          ? 'detail'
          : 'other'
    };
  const dataKeys = [
    'name',
    'title',
    'action',
    'params',
    'content',
    'text',
    'storageText',
    'generationDraft',
    'source',
    'resourceId',
    'resourceBatches',
    'tags',
    'url',
    'poster',
    'uploaded',
    'generatorType',
    'resourceMeta',
    'width',
    'height',
    'ratio'
  ];
  const clone = (v) =>
    JSON.parse(JSON.stringify(v, (key, val) => (typeof val === 'function' ? undefined : val)));
  const nodes = candidate.nodes.map((n) => {
    const data = {};
    for (const key of dataKeys)
      if (n.data[key] !== undefined) {
        try {
          data[key] = clone(n.data[key]);
        } catch {}
      }
    return {
      id: n.id,
      type: n.type,
      parentId: n.parentId,
      position: clone(n.position || n.layout || {}),
      data
    };
  });
  const mediaResources = {};
  return {
    found: true,
    source: candidate.source,
    frameUrl: location.href,
    canvasTitle: document.title.replace(/\s*-\s*LibTV.*$/i, ''),
    expectedNodes: status ? Number(status[1]) : null,
    expectedEdges: status ? Number(status[2]) : null,
    visibleNodes: document.querySelectorAll('.react-flow__node').length,
    candidateCounts: candidates.map((c) => ({ source: c.source, count: c.nodes.length })),
    nodes,
    mediaResources,
    edges: candidate.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle
    }))
  };
}

function inspectWork() {
  if (location.protocol === 'chrome-error:') return { pageError: true, resolvedUrl: location.href };
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const body = document.body?.innerText || '';
  if (/^upstream connect error or disconnect\/reset before headers/i.test(body.trim()))
    return { pageError: true, resolvedUrl: location.href };
  const headings = Array.from(document.querySelectorAll('h1')).filter(visible);
  const heading = headings.find((h) => !/欢迎登录|体验升级|即梦AI/.test(h.textContent));
  let title = heading?.textContent.trim() || '';
  let author = '';
  const authorRegion = document.querySelector('[aria-label="作者信息"]');
  const workInfo = {};
  const count = (text) => {
    const match = String(text || '')
      .replace(/,/g, '')
      .match(/^\s*(\d+(?:\.\d+)?)\s*([万亿kKmM]?)/);
    if (!match) return undefined;
    const units = { 万: 10000, 亿: 100000000, k: 1000, m: 1000000 };
    return Math.round(Number(match[1]) * (units[match[2].toLowerCase()] || 1));
  };
  {
    const region = authorRegion;
    const text = region?.querySelector('button')?.innerText.trim() || '';
    author = text.split(/\n/).find(Boolean) || '';
    if (region && visible(region)) {
      const followers = text.match(/([\d,.]+\s*[万亿kKmM]?)\s*粉丝数?/);
      const following = text.match(/([\d,.]+\s*[万亿kKmM]?)\s*关注/);
      if (followers) workInfo.followerCount = count(followers[1]);
      if (following) workInfo.followingCount = count(following[1]);
      const followButton = Array.from(region.querySelectorAll('button')).find((el) =>
        /^(?:\+\s*)?(?:关注|已关注|互相关注|取消关注)$/.test(
          (el.innerText || el.textContent || '').trim()
        )
      );
      if (followButton)
        workInfo.isFollowing = /已关注|互相关注|取消关注/.test(
          followButton.innerText || followButton.textContent
        );
      const bio = Array.from(region.children || [])
        .slice(1)
        .map((el) => el.innerText?.trim())
        .filter(Boolean)
        .join('\n');
      if (bio) workInfo.authorBio = bio;
      const link = region.querySelector('a[href]');
      if (link?.href) workInfo.authorUrl = link.href;
    }
  }
  const button = Array.from(document.querySelectorAll('button, [role="button"]')).find(
    (b) => visible(b) && /^查看(制作|创作)过程$/.test((b.innerText || b.textContent).trim())
  );
  // The detail player uses a blob/HLS URL. Its project prop holds the original
  // downloadable finalOutput; never collect recommended works from the page.
  let fullVideo;
  const workId = location.pathname?.match(/\/detail\/([^/]+)/)?.[1];
  if (workId) {
    const video = Array.from(document.querySelectorAll('video')).find(visible);
    const stage =
      document.querySelector('[data-project-detail-stage]') || video || authorRegion || heading;
    let fiber = stage?.[Object.keys(stage).find((k) => k.startsWith('__reactFiber'))];
    for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps || {};
      const project = [props.project, props.initialItem, props.initialDetail].find(
        (p) => p && (p.templateUuid || p.id) === workId
      );
      if (!project) continue;
      title = project.title || project.name || title;
      author = project.nickname || author;
      const ownerUuid = project.ownerUuid || project.userUuid;
      if (typeof ownerUuid === 'string' && /^[a-f0-9]{32}$/i.test(ownerUuid))
        workInfo.authorUrl = 'https://www.liblib.tv/profile?uuid=' + ownerUuid;
      for (const [target, source] of Object.entries({
        description: 'description',
        likeCount: 'likeCount',
        isLiked: 'isLike',
        createdAt: 'createAt',
        updatedAt: 'updateAt',
        publishedAt: 'publishAt',
        playCount: 'playCount',
        viewCreationProcessCount: 'viewCreationProcessCount',
        copyCanvasCount: 'copyCanvasCount',
        shareCount: 'shareCount'
      })) {
        const value = project[source];
        if (['string', 'number', 'boolean'].includes(typeof value)) workInfo[target] = value;
      }
      if (Array.isArray(project.tags))
        workInfo.tags = project.tags
          .map((tag) => tag.tagLabel)
          .filter((tag) => typeof tag === 'string');
      let original;
      try {
        original = new URL(project.finalOutput, location.href);
      } catch {
        continue;
      }
      if (original.protocol !== 'https:' || !/\.(mp4|webm|mov|m4v)$/i.test(original.pathname))
        continue;
      const quality = props.qualityLevels?.find((q) => q.name === 'original');
      fullVideo ||= {
        workId,
        url: original.href,
        name: project.title || project.name || title,
        previewUrl: project.coverUrl || '',
        width: quality?.width || video?.videoWidth,
        height: quality?.height || video?.videoHeight,
        duration: Number.isFinite(video?.duration) ? video.duration : undefined
      };
      title = project.title || project.name || title;
      author = project.nickname || author;
    }
  }
  if (workId) {
    const detailText = body.split('精选推荐')[0];
    if (workInfo.description === undefined) {
      const description = detailText.match(
        /(?:^|\n)作品描述\s*\n([\s\S]*?)(?=\n\s*更新时间\s*[:：]|\n\s*含\s*AI\s*生成内容|$)/
      );
      if (description) workInfo.description = description[1].trim();
    }
    const updated = detailText.match(/更新时间\s*[:：]\s*([^\n]+)/);
    if (updated) workInfo.updatedAt = updated[1].trim();
    if (/含\s*AI\s*生成内容/.test(detailText)) workInfo.containsAI = true;
    const likeButton = heading?.parentElement?.parentElement?.querySelector(
      'button[aria-label="点赞"], button[aria-label="取消点赞"]'
    );
    if (likeButton && visible(likeButton)) {
      const likes = count(likeButton.innerText);
      if (likes !== undefined) workInfo.likeCount = likes;
      const pressed = likeButton.getAttribute('aria-pressed');
      if (pressed === 'true' || pressed === 'false') workInfo.isLiked = pressed === 'true';
    }
    if (Object.keys(workInfo).length) {
      workInfo.capturedAt = new Date().toISOString();
      workInfo.accountState = /注册\/登录|登录\/注册/.test(detailText)
        ? '未登录页面'
        : '当前平台页面';
    }
  }
  return {
    title,
    author,
    ...(workId && Object.keys(workInfo).length ? { workInfo } : {}),
    ...(fullVideo ? { fullVideo } : {}),
    resolvedUrl: location.href,
    canOpenCanvas: Boolean(button),
    loginVisible: /欢迎登录|请输入手机号/.test(body),
    readonly: /只读模式|Read-only/.test(body)
  };
}

function openCanvas(allowClick = true, allowDismiss = true) {
  const visible = (el) => Boolean(el.getClientRects().length);
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  // Use the site's normal close action, never remove a login barrier from the DOM.
  const close = buttons.find(
    (b) => visible(b) && /关闭登录弹窗/.test(b.getAttribute('aria-label') || b.innerText || '')
  );
  if (close && allowDismiss) {
    close.click();
    return { closedLoginHint: true };
  }
  const popupClose = buttons.find(
    (b) =>
      visible(b) &&
      /^(关闭广告|关闭活动弹窗|关闭推荐弹窗)$/.test(b.getAttribute('aria-label') || '')
  );
  if (popupClose && allowDismiss) {
    popupClose.click();
    return { closedPopup: true };
  }
  if ([...document.querySelectorAll('.react-flow, iframe[src*="/ai-canvas/"]')].some(visible))
    return { alreadyOpen: true };
  const button = buttons.find(
    (b) => visible(b) && /^查看(制作|创作)过程$/.test((b.innerText || b.textContent).trim())
  );
  if (button) {
    if (allowClick) button.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = button.getBoundingClientRect(),
      top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (button.disabled || !top || !(top === button || button.contains(top)))
      return { blocked: true };
    if (allowClick) {
      button.click();
      return { clicked: true };
    }
  }
  return { clicked: false };
}

module.exports = { readCanvas, inspectWork, openCanvas };
