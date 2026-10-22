'use strict';
const $ = (id) => document.getElementById(id);
const address = $('address'),
  message = $('message'),
  tabsElement = $('tabs');
let current = 'about:blank',
  dirty = false,
  state = { tabs: [], activeId: null },
  signature = '',
  syncing = false,
  settling = false,
  settleTimer;

async function act(action, value) {
  try {
    const result = await window.browserToolbar.action(action, value);
    if (!result.ok) {
      // Restore the authoritative state if the backend rejected a tab operation.
      const latest = await window.browserToolbar.action('state');
      if (latest.ok && latest.state) render(latest.state);
      throw new Error(result.error);
    }
    if (result.state) render(result.state);
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
}

function placeNewTabButton(tabs) {
  const last = tabs.tabEls.at(-1);
  const end = last
    ? tabsElement.offsetLeft +
      tabs.tabContentEl.offsetLeft +
      tabs.tabPositions.at(-1) +
      parseFloat(last.style.width)
    : tabsElement.offsetLeft;
  $('new-tab').style.left = Math.min(end, document.querySelector('.window-drag').offsetLeft) + 'px';
}

// Keep upstream rendering/geometry/dragging intact. Only bridge mutations to
// Electron, so website contents and the work selection remain authoritative.
class BrowserChromeTabs extends window.ChromeTabs {
  addTab(properties, options) {
    if (syncing) return super.addTab(properties, options);
    void act('new-tab');
  }
  removeTab(tab) {
    if (syncing) return super.removeTab(tab);
    void act('close-tab', tab.dataset.tabId);
  }
  layoutTabs() {
    super.layoutTabs();
    placeNewTabButton(this);
  }
  setupDraggabilly() {
    super.setupDraggabilly();
    // Upstream retains references to destroyed instances after rebuilding.
    this.draggabillies = this.tabEls.length ? this.draggabillies.slice(-this.tabEls.length) : [];
    for (const draggable of this.draggabillies) {
      if (state.blocked) draggable.disable();
      draggable.on('dragEnd', () => {
        settling = true;
        void act(
          'reorder',
          this.tabEls.map((tab) => tab.dataset.tabId)
        );
        clearTimeout(settleTimer);
        // Let upstream finish its 120 ms drop animation before reconciling DOM.
        settleTimer = setTimeout(() => {
          settling = false;
          renderTabs();
        }, 160);
      });
    }
  }
}
const chromeTabs = new BrowserChromeTabs();
chromeTabs.init(tabsElement);
tabsElement.addEventListener('activeTabChange', (event) => {
  if (syncing || state.blocked) return;
  dirty = false;
  void act('activate', { id: event.detail.tabEl.dataset.tabId, focus: false });
});

function decorateTab(tab) {
  const id = tab.dataset.tabId;
  tab.setAttribute('role', 'tab');
  tab.addEventListener('auxclick', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      void act('close-tab', id);
    }
  });
  tab.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    void act('tab-menu', id);
  });
  tab.addEventListener('keydown', (event) => {
    if (state.blocked || event.target !== tab) return;
    const count = state.tabs.length,
      index = state.tabs.findIndex((item) => item.id === id);
    let target;
    if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = count - 1;
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key))
      target = (index + (event.key === 'ArrowLeft' ? -1 : 1) + count) % count;
    else if (['Enter', ' '].includes(event.key)) target = index;
    if (target === undefined || !state.tabs[target]) return;
    event.preventDefault();
    void act('activate', { id: state.tabs[target].id, focus: false }).then(() => {
      chromeTabs.tabEls.find((element) => element.dataset.tabId === state.activeId)?.focus();
    });
  });
  const close = tab.querySelector('.chrome-tab-close');
  close.setAttribute('role', 'button');
  close.setAttribute('title', '关闭标签页');
  close.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!state.blocked) void act('close-tab', id);
  });
}

function renderTabs() {
  // Changing title/favicon must not rebuild Draggabilly while the user drags.
  if (chromeTabs.isDragging || settling) return;
  const nextSignature = JSON.stringify([state.tabs, state.activeId, state.blocked]);
  if (signature === nextSignature) return;
  syncing = true;
  try {
    const ids = state.tabs.map((item) => item.id),
      chosen = new Set(ids);
    for (const tab of chromeTabs.tabEls)
      if (!chosen.has(tab.dataset.tabId)) chromeTabs.removeTab(tab);
    for (const item of state.tabs) {
      let tab = chromeTabs.tabEls.find((element) => element.dataset.tabId === item.id);
      const properties = {
        id: item.id,
        title: item.title,
        favicon: item.loading ? 'icons/refresh.svg' : item.favicon || 'icons/chrome.svg'
      };
      if (!tab) {
        chromeTabs.addTab(properties, { background: true, animate: false });
        tab = chromeTabs.tabEls.at(-1);
        decorateTab(tab);
      } else chromeTabs.updateTab(tab, properties);
      tab.classList.toggle('loading', Boolean(item.loading));
      tab.title = item.title + (item.url === 'about:blank' ? '' : '\n' + item.url);
      tab.setAttribute('aria-label', item.title);
      tab.setAttribute('aria-selected', String(item.id === state.activeId));
      tab.tabIndex = item.id === state.activeId ? 0 : -1;
      const close = tab.querySelector('.chrome-tab-close');
      close.tabIndex = state.blocked ? -1 : 0;
      close.setAttribute('aria-label', '关闭 ' + item.title);
      close.setAttribute('aria-disabled', String(Boolean(state.blocked)));
    }
    if (chromeTabs.tabEls.some((tab, index) => tab.dataset.tabId !== ids[index])) {
      const elements = new Map(chromeTabs.tabEls.map((tab) => [tab.dataset.tabId, tab]));
      for (const id of ids) chromeTabs.tabContentEl.append(elements.get(id));
      chromeTabs.layoutTabs();
      chromeTabs.setupDraggabilly();
    }
    const active = chromeTabs.tabEls.find((tab) => tab.dataset.tabId === state.activeId);
    if (active) chromeTabs.setCurrentTab(active);
    tabsElement.setAttribute('aria-disabled', String(Boolean(state.blocked)));
    for (const draggable of chromeTabs.draggabillies)
      state.blocked ? draggable.disable() : draggable.enable();
    signature = nextSignature;
  } finally {
    syncing = false;
  }
  placeNewTabButton(chromeTabs);
}
function render(next) {
  if (state.activeId !== next.activeId) dirty = false;
  state = next;
  current = state.url || 'about:blank';
  if (!dirty) address.value = current === 'about:blank' ? '' : current;
  address.readOnly = Boolean(state.blocked);
  address.title = state.blocked || current;
  $('back').disabled = Boolean(state.blocked) || !state.canGoBack;
  $('forward').disabled = Boolean(state.blocked) || !state.canGoForward;
  for (const id of ['reload', 'home', 'new-tab', 'tab-search'])
    $(id).disabled = Boolean(state.blocked);
  $('reload').querySelector('img').src = state.loading ? 'icons/close.svg' : 'icons/refresh.svg';
  $('reload').title = state.loading ? '停止加载（Esc）' : '重新加载（Ctrl+R）';
  $('reload').setAttribute('aria-label', state.loading ? '停止加载' : '重新加载');
  message.textContent = state.error || '';
  message.hidden = !state.error;
  renderTabs();
}
for (const name of ['back', 'forward', 'home', 'new-tab', 'tab-search'])
  $(name).addEventListener('click', () => act(name));
$('reload').onclick = () => act(state.loading ? 'stop' : 'reload');
$('location').addEventListener('submit', (event) => {
  event.preventDefault();
  if (address.readOnly) return;
  const value = address.value;
  dirty = false;
  void act('navigate', value);
});
address.addEventListener('input', () => {
  dirty = true;
});
address.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    address.value = current === 'about:blank' ? '' : current;
    dirty = false;
    address.select();
  }
});
address.addEventListener('blur', () => {
  if (dirty) {
    dirty = false;
    address.value = current === 'about:blank' ? '' : current;
  }
});
window.browserToolbar.onState(render);
window.browserToolbar.onFocus(() => {
  address.focus();
  address.select();
});
window.addEventListener('unload', () => {
  clearTimeout(settleTimer);
  for (const draggable of chromeTabs.draggabillies) draggable.destroy();
});
void act('state');
