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
    pending = 0;
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
        onError(response.error);
      } else if (pending === 1) {
        profile = response.value;
        selected = new Set(profile.selectedIds);
      }
    } catch (error) {
      selected = before;
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
    const columns = getColumns(),
      grid = $('author-works');
    $('author-count').textContent = `共 ${profile.works.length} 部 · 已选择 ${selected.size} 部`;
    $('author-select-all').disabled = getLocked() || selected.size === profile.works.length;
    $('author-clear').disabled = getLocked() || !selected.size;
    $('author-read').textContent = profile.readingCanvases
      ? '停止读取画布'
      : '开始读取画布（' + selected.size + '）';
    $('author-read').disabled =
      getLocked() ||
      Boolean(pending) ||
      (!profile.readingCanvases && getReadLocked()) ||
      (!selected.size && !profile.readingCanvases);
    grid.style.setProperty('--columns', String(columns || 3));
    grid.dataset.dense = String(columns >= 7);
    grid.dataset.text = String(columns === 0);
    grid.replaceChildren();
    if (!profile.works.length)
      grid.append(element('div', '该作者暂无可读取的公开作品。', 'empty-state'));
    for (const work of profile.works) {
      const wrapper = element('div', '', 'work-wrapper');
      const button = element('button', '', 'content-card work-card');
      button.type = 'button';
      button.dataset.workId = work.id;
      button.classList.toggle('is-selected', selected.has(work.id));
      button.setAttribute('aria-pressed', String(selected.has(work.id)));
      button.setAttribute(
        'aria-label',
        work.title + '，' + (selected.has(work.id) ? '已选择' : '未选择')
      );
      button.disabled = getLocked();
      button.title = work.title;
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
        element('span', '\u00a0', 'card-subheading')
      );
      const footer = element('span', '', 'card-footer');
      footer.append(element('span', selected.has(work.id) ? '已选择' : '未选择', 'work-selection'));
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
        if (work.state === 'error') {
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
  $('author-select-all').onclick = () => select(profile.works.map((w) => w.id));
  $('author-clear').onclick = () => select([]);
  return {
    set(value) {
      profile = value;
      if (!pending) selected = new Set(value?.selectedIds || []);
      render();
    },
    render
  };
}
