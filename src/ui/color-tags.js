import { COLOR_TAGS, createColorTagIndex, matchesColorTags } from '../color-tags.cjs';

export function createColorTags({ getResult, onChange, onFilter, onError }) {
  let index, anchor, activeItem, menu;
  const selected = new Set();
  let excludedOnly = false;
  const palette = new Map(COLOR_TAGS.map((tag) => [tag.id, tag]));
  const visibleTags = COLOR_TAGS.filter((tag) => tag.id !== 'none');
  function model() {
    const result = getResult();
    if (
      index?.result !== result ||
      index?.entries !== result?.entries ||
      index?.assets !== result?.assets
    )
      index = createColorTagIndex(result);
    return index;
  }
  function paint(button, color) {
    const tag = palette.get(color) || palette.get('none');
    button.dataset.colorTag = tag.id;
    button.style.setProperty('--tag-color', tag.color);
    button.title = tag.name + '，点击更改颜色标签';
    button.setAttribute('aria-label', button.title);
  }
  function close() {
    if (menu?.matches(':popover-open')) menu.hidePopover();
    anchor?.setAttribute('aria-expanded', 'false');
  }
  function show(button, item) {
    close();
    anchor = button;
    activeItem = item;
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'color-tag-menu';
      menu.className = 'color-tag-menu';
      menu.popover = 'auto';
      menu.setAttribute('role', 'group');
      menu.setAttribute('aria-label', '选择颜色标签');
      for (const tag of visibleTags) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'color-tag-choice';
        choice.dataset.tagChoice = tag.id;
        choice.style.setProperty('--tag-color', tag.color);
        choice.title = tag.name;
        choice.setAttribute('aria-label', tag.name);
        choice.append(document.createElement('span'));
        choice.addEventListener('click', async (event) => {
          event.stopPropagation();
          const chosen = activeItem,
            trigger = anchor,
            current = model();
          close();
          try {
            const color = current.color(chosen) === tag.id ? 'none' : tag.id;
            await onChange(chosen, color, current.key(chosen));
          } catch (error) {
            onError(error.message);
          }
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        });
        menu.append(choice);
      }
      menu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
          anchor?.focus({ preventScroll: true });
          return;
        }
        const choices = [...menu.querySelectorAll('button')];
        const position = choices.indexOf(document.activeElement);
        const step = ['ArrowRight', 'ArrowDown'].includes(event.key)
          ? 1
          : ['ArrowLeft', 'ArrowUp'].includes(event.key)
            ? -1
            : 0;
        if (step || ['Home', 'End'].includes(event.key)) {
          event.preventDefault();
          choices[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices.length - 1
                : (position + step + choices.length) % choices.length
          ].focus({ preventScroll: true });
        }
      });
      menu.addEventListener('toggle', () => {
        anchor?.setAttribute('aria-expanded', String(menu.matches(':popover-open')));
      });
    }
    (button.closest('dialog[open]') || document.body).append(menu);
    const color = model().color(item);
    for (const choice of menu.children) {
      const active = choice.dataset.tagChoice === color;
      choice.setAttribute('aria-pressed', String(active));
      choice.title =
        choice.getAttribute('aria-label') + (active ? '（再次点击取消标签，恢复默认灰色）' : '');
    }
    menu.showPopover();
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect(),
      box = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - box.width - 8)) + 'px';
    menu.style.top =
      (rect.bottom + box.height + 8 <= innerHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - box.height - 6)) + 'px';
    (menu.querySelector('[aria-pressed="true"]') || menu.querySelector('button')).focus({
      preventScroll: true
    });
  }
  function dot(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-tag-dot';
    button.dataset.colorTagKey = model().key(item);
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.append(document.createElement('span'));
    paint(button, model().color(item));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      show(button, item);
    });
    return button;
  }
  function sync() {
    const current = model();
    for (const button of document.querySelectorAll('.color-tag-dot')) {
      const item = current.byKey.get(button.dataset.colorTagKey)?.[0];
      paint(button, current.color(item));
    }
  }
  function mount(root) {
    for (const tag of visibleTags) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-tag-filter';
      button.dataset.tagFilter = tag.id;
      button.title =
        tag.id === 'excluded'
          ? '仅显示已排除素材，再次点击恢复原有颜色筛选'
          : tag.name + '标签（支持多选；取消全部显示未排除的素材）';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', 'false');
      button.style.setProperty('--tag-color', tag.color);
      button.append(document.createElement('span'));
      button.addEventListener('click', () => {
        if (tag.id === 'excluded') {
          excludedOnly = !excludedOnly;
          button.setAttribute('aria-pressed', String(excludedOnly));
        } else {
          selected.has(tag.id) ? selected.delete(tag.id) : selected.add(tag.id);
          button.setAttribute('aria-pressed', String(selected.has(tag.id)));
        }
        onFilter();
      });
      root.append(button);
    }
  }
  for (const event of ['scroll', 'resize']) window.addEventListener(event, close, true);
  document.addEventListener(
    'close',
    (event) => {
      if (menu && event.target.contains(menu)) close();
    },
    true
  );
  return {
    dot,
    sync,
    mount,
    close,
    get excludedOnly() {
      return excludedOnly;
    },
    color: (item) => model().color(item),
    matches: (item) => matchesColorTags(model().color(item), selected, excludedOnly),
    set(key, color) {
      model().set(key, color);
      sync();
    }
  };
}
