'use strict';
const address = document.getElementById('address');
const message = document.getElementById('message');
let current = 'about:blank',
  dirty = false;
function render(state) {
  current = state.url || 'about:blank';
  if (!dirty) address.value = current;
  address.readOnly = Boolean(state.blocked);
  address.title = state.blocked || current;
  document.getElementById('back').disabled = Boolean(state.blocked) || !state.canGoBack;
  document.getElementById('forward').disabled = Boolean(state.blocked) || !state.canGoForward;
  document.getElementById('reload').disabled = Boolean(state.blocked);
  document.getElementById('home').disabled = Boolean(state.blocked);
  message.textContent = state.error || '';
  message.hidden = !state.error;
}
async function act(action, value) {
  try {
    const result = await window.browserToolbar.action(action, value);
    if (!result.ok) throw new Error(result.error);
    if (result.state) render(result.state);
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
}
for (const name of ['back', 'forward', 'reload', 'home'])
  document.getElementById(name).addEventListener('click', () => act(name));
document.getElementById('location').addEventListener('submit', (event) => {
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
    address.value = current;
    dirty = false;
    address.select();
  }
});
address.addEventListener('blur', () => {
  if (dirty) {
    dirty = false;
    address.value = current;
  }
});
window.browserToolbar.onState(render);
window.browserToolbar.onFocus(() => {
  address.focus();
  address.select();
});
void act('state');
