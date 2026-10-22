import { hideHoverPreview } from './interactions.js';

function element(tag, className = '') {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function promptWindowButton(expanded = false) {
  const button = element('button', 'quiet prompt-window-button');
  button.type = 'button';
  button.title = expanded ? '缩小并关闭' : '展开提示词';
  button.setAttribute('aria-label', button.title);
  const glyph = element('span', expanded ? 'prompt-window-icon is-contract' : 'prompt-window-icon');
  glyph.setAttribute('aria-hidden', 'true');
  button.append(glyph);
  return button;
}

export function createPromptDialog({ getTypography }) {
  const dialog = element('dialog', 'prompt-dialog');
  dialog.id = 'prompt-dialog';
  dialog.setAttribute('aria-label', '展开提示词');
  const controls = element('div', 'prompt-dialog-controls'),
    references = element('div', 'prompt-dialog-references'),
    content = element('div', 'prompt-text prompt-dialog-content'),
    closeButton = promptWindowButton(true);
  let current = null,
    mediaSize = 68,
    textSize = null,
    backdropPress = false;
  function slider(labelText, min, max, className, update) {
    const input = element('input', 'prompt-dialog-slider ' + className);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.setAttribute('aria-label', labelText);
    input.addEventListener('input', () => {
      input.setAttribute('aria-valuetext', input.value + ' 像素');
      update(Number(input.value));
    });
    controls.append(input);
    return (value) => {
      input.value = String(value);
      input.setAttribute('aria-valuetext', value + ' 像素');
      update(value);
    };
  }
  const setMediaSize = slider('素材尺寸', 48, 180, 'prompt-media-size', (value) => {
    mediaSize = value;
    dialog.style.setProperty('--reference-size', value + 'px');
  });
  const api = window.PromptTypography;
  const setTextSize = slider(
    '文字大小',
    api.FONT_SIZE_MIN,
    api.FONT_SIZE_MAX,
    'prompt-text-size',
    (value) => {
      textSize = value;
      api.applyTypography(dialog, { ...getTypography(), size: value });
    }
  );
  controls.append(closeButton);
  dialog.append(controls, references, content);
  document.body.append(dialog);
  function restore() {
    const previous = current;
    current = null;
    if (!previous) return;
    for (const { node, marker } of previous.slots) {
      if (marker.parentNode) marker.replaceWith(node);
      else node.remove();
    }
    references.replaceChildren();
    content.replaceChildren();
    if (previous.scroll.isConnected) previous.scroll.scrollTop = previous.scrollTop;
    if (previous.anchor.isConnected) previous.anchor.focus({ preventScroll: true });
  }
  function close() {
    hideHoverPreview();
    restore();
    if (dialog.open) dialog.close();
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('close', () => {
    if (!dialog.open) restore();
  });
  function outside(event) {
    const box = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    );
  }
  dialog.addEventListener('pointerdown', (event) => {
    backdropPress = event.button === 0 && outside(event);
  });
  dialog.addEventListener('click', (event) => {
    if (backdropPress && outside(event)) close();
    backdropPress = false;
  });
  return {
    close,
    closeFor(owner) {
      if (current?.owner === owner) close();
    },
    show({ owner, anchor, inner, scroll, strip, name }) {
      close();
      const slots = [];
      current = { owner, anchor, scroll, scrollTop: scroll.scrollTop, slots };
      const move = (node, target) => {
        const marker = document.createComment('expanded-prompt');
        node.before(marker);
        slots.push({ node, marker });
        target.append(node);
      };
      if (strip && !strip.classList.contains('empty-references')) move(strip, references);
      references.hidden = !references.hasChildNodes();
      move(inner, content);
      dialog.setAttribute('aria-label', name + '的提示词');
      setMediaSize(mediaSize);
      setTextSize(textSize ?? getTypography().size);
      hideHoverPreview();
      dialog.showModal();
      content.scrollTop = current.scrollTop;
    }
  };
}
