export function createAccountControls(root, onLogin) {
  const buttons = new Map();
  return {
    mount(platforms) {
      root.replaceChildren();
      buttons.clear();
      for (const platform of platforms) {
        const button = document.createElement('button');
        button.id = 'login-' + platform.id;
        button.type = 'button';
        button.className = 'site-shortcut';
        button.textContent = platform.name;
        button.title = '直接访问 ' + platform.name;
        button.addEventListener('click', () => onLogin(platform.id));
        root.append(button);
        buttons.set(platform.id, button);
      }
    },
    setLocked(locked, busy) {
      for (const [id, button] of buttons) button.disabled = locked || busy.has(id);
    }
  };
}
