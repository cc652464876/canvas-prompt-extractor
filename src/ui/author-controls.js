export function createAuthorControls({
  getColumns,
  getLocked,
  getReadLocked = () => false,
  onRead,
  onError
}) {
  const $ = (id) => document.getElementById(id);
  let profile = null,
    selected = new Set(),
    pending = 0,
    sortByCanvas = false,
    hideUnpublished = false;
  const visibleWorks = () =>
    (profile?.works || []).filter((work) => !hideUnpublished || work.canvasAccess !== 'not-public');
  const accessText = (work) =>
    work.canvasAccess === 'public'
      ? '画布已公开'
      : work.canvasAccess === 'not-public'
        ? '画布未公开'
        : '画布待确认';
  const element = (tag, text = '', cls = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = cls;
    return node;
  };
  async function select(ids) {
    const before = new Set(selected);
    selected = new Set(ids);
    pending++;
    render();
    try {
      const response = await window.lab.selectWorks([...selected]);
      if (!response.ok) {
        selected = before;
        hideUnpublished = false;
        onError(response.error);
      } else if (pending === 1) {
        profile = response.value;
        selected = new Set(profile.selectedIds);
      }
    } catch (error) {
      selected = before;
      hideUnpublished = false;
      onError(error.message);
    } finally {
      pending--;
      render();
    }
  }
  function render() {
    const section = $('author-section');
    section.hidden = !profile;
    if (!profile) return;
    const visible = visibleWorks(),
      visibleIds = new Set(visible.map((work) => work.id)),
      allowedSelection = [...selected].filter((id) => visibleIds.has(id));
    // A pending canvas read may discover a private canvas after filtering was
    // enabled. Keep the service selection in sync, including after UI unlocks.
    if (hideUnpublished && !pending && !getLocked() && allowedSelection.length !== selected.size) {
      void select(allowedSelection);
      return;
    }
    const columns = getColumns(),
      locked = getLocked() || Boolean(pending),
      grid = $('author-works');
    $('author-count').textContent =
      `共 ${profile.works.length} 部${hideUnpublished ? ' · 显示 ' + visible.length + ' 部' : ''} · 已选择 ${selected.size} 部`;
    $('author-select-all').disabled = locked || visible.every((work) => selected.has(work.id));
    $('author-clear').disabled = locked || !selected.size;
    $('author-canvas-sort').disabled = locked || !profile.works.length;
    $('author-canvas-sort').setAttribute('aria-pressed', String(sortByCanvas));
    $('author-canvas-sort').title = sortByCanvas
      ? '点击恢复作品原有顺序'
      : '公开画布在前，未公开画布另起一行';
    $('author-canvas-filter').disabled = locked || !profile.works.length;
    $('author-canvas-filter').textContent = hideUnpublished ? '显示未公开画布' : '隐藏未公开画布';
    $('author-canvas-filter').setAttribute('aria-pressed', String(hideUnpublished));
    $('author-read').textContent = profile.readingCanvases
      ? '停止读取画布'
      : '开始读取画布（' + selected.size + '）';
    $('author-read').hidden = Boolean(profile.localProject);
    $('author-read').disabled =
      getLocked() ||
      Boolean(pending) ||
      (!profile.readingCanvases && getReadLocked()) ||
      (!selected.size && !profile.readingCanvases);
    grid.style.setProperty('--columns', String(columns || 3));
    grid.dataset.dense = String(columns >= 7);
    grid.dataset.text = String(columns === 0);
    grid.replaceChildren();
    if (!visible.length)
      grid.append(
        element(
          'div',
          profile.works.length
            ? '未公开画布的作品已隐藏，点击“显示未公开画布”查看。'
            : '该作者暂无可读取的公开作品。',
          'empty-state'
        )
      );
    const rank = (work) =>
      work.canvasAccess === 'public' ? 0 : work.canvasAccess === 'not-public' ? 2 : 1;
    const ordered = sortByCanvas ? [...visible].sort((a, b) => rank(a) - rank(b)) : visible;
    let previousGroup;
    for (const work of ordered) {
      const wrapper = element('div', '', 'work-wrapper');
      if (sortByCanvas && previousGroup !== undefined && previousGroup !== rank(work))
        wrapper.classList.add('work-group-start');
      previousGroup = rank(work);
      const button = element('button', '', 'content-card work-card');
      button.type = 'button';
      button.dataset.workId = work.id;
      button.classList.toggle('is-selected', selected.has(work.id));
      button.setAttribute('aria-pressed', String(selected.has(work.id)));
      button.setAttribute(
        'aria-label',
        work.title + '，' + accessText(work) + '，' + (selected.has(work.id) ? '已选择' : '未选择')
      );
      button.disabled = locked;
      button.title = [work.title, work.note || accessText(work)].filter(Boolean).join('\n');
      if (columns) {
        const cover = element('span', '', 'cover');
        if (work.cover) {
          const image = element('img');
          image.src = work.cover;
          image.alt = '';
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          cover.append(image);
        }
        cover.append(element('span', '选集', 'asset-kind'));
        button.append(cover);
      }
      const body = element('span', '', 'card-body');
      body.append(
        element('span', work.title, 'card-heading'),
        element(
          'span',
          work.note ||
            (work.canvasAccess === 'not-public'
              ? '画布未公开，仅可下载作品视频'
              : work.canvasAccess === 'public'
                ? '画布已公开'
                : '画布状态待确认'),
          'card-subheading'
        )
      );
      const footer = element('span', '', 'card-footer');
      footer.append(
        element('span', accessText(work), 'work-canvas-access'),
        element('span', selected.has(work.id) ? '已选择' : '未选择', 'work-selection')
      );
      button.append(body, footer);
      button.addEventListener('click', () => {
        const ids = new Set(selected);
        ids.has(work.id) ? ids.delete(work.id) : ids.add(work.id);
        void select([...ids]);
      });
      wrapper.append(button);
      if (selected.has(work.id) && ['loading', 'error'].includes(work.state)) {
        const state = element(
          'div',
          work.state === 'loading' ? '正在读取…' : work.error,
          'work-state'
        );
        state.setAttribute('role', 'status');
        if (work.state === 'error' && !profile.localProject) {
          const retry = element('button', '重试', 'quiet');
          retry.type = 'button';
          retry.disabled = getLocked();
          retry.onclick = async () => {
            const response = await window.lab.retryWork(work.id);
            if (!response.ok) onError(response.error);
          };
          state.append(retry);
        }
        wrapper.append(state);
      }
      grid.append(wrapper);
    }
  }
  $('author-read').onclick = () => onRead(Boolean(profile?.readingCanvases));
  $('author-select-all').onclick = () => select(visibleWorks().map((w) => w.id));
  $('author-clear').onclick = () => select([]);
  $('author-canvas-sort').onclick = () => {
    sortByCanvas = !sortByCanvas;
    render();
  };
  $('author-canvas-filter').onclick = () => {
    hideUnpublished = !hideUnpublished;
    render();
  };
  return {
    set(value) {
      const identity = (item) => item && [item.platform, item.url, item.directory].join('|');
      if (identity(value) !== identity(profile)) {
        sortByCanvas = false;
        hideUnpublished = false;
      }
      profile = value;
      if (!pending) selected = new Set(value?.selectedIds || []);
      render();
    },
    render
  };
}
