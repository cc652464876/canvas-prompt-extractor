import { createAppearanceDropdown } from './appearance-dropdown.js';
export function createTypographyManager({
  storage,
  root = document.documentElement,
  onError = () => {}
}) {
  const api = window.PromptTypography;
  let preference = api.readTypography(storage),
    dropdown,
    sizeDropdown;
  const size = document.getElementById('prompt-font-size');
  function render() {
    api.applyTypography(root, preference);
    dropdown?.set(preference.font);
    sizeDropdown?.set(String(preference.size));
    size.value = String(preference.size);
    if (api.FONTS[preference.font].face)
      document.fonts
        .load(preference.size + 'px "' + api.FONTS[preference.font].face + '"')
        .catch(() => {
          if (preference.font !== 'default')
            onError(new Error('字体加载失败，提示词将使用默认字体显示。'));
        });
  }
  function set(value) {
    preference = api.normalizeTypography(value);
    render();
    try {
      storage?.setItem(api.TYPOGRAPHY_KEY, JSON.stringify(preference));
    } catch {
      onError(new Error('排版已更新，但本地偏好保存失败。'));
    }
    return { ...preference };
  }
  dropdown = createAppearanceDropdown({
    trigger: document.getElementById('prompt-font-trigger'),
    list: document.getElementById('prompt-font-menu'),
    options: Object.entries(api.FONTS).map(([value, font]) => ({ value, label: font.name })),
    onChange: (font) => set({ ...preference, font })
  });
  size.min = String(api.FONT_SIZE_MIN);
  size.max = String(api.FONT_SIZE_MAX);
  sizeDropdown = createAppearanceDropdown({
    trigger: document.getElementById('prompt-font-size-trigger'),
    list: document.getElementById('prompt-font-size-menu'),
    options: [12, 14, 16, 18, 20, 24, 28].map((value) => ({
      value: String(value),
      label: value + ' px'
    })),
    allowCustomValue: true,
    onChange: (value) => set({ ...preference, size: Number(value) })
  });
  function commitSize() {
    if (size.value !== '' && size.validity.valid) set({ ...preference, size: Number(size.value) });
    else render();
  }
  size.addEventListener('input', () => {
    if (size.value !== '' && size.validity.valid) set({ ...preference, size: Number(size.value) });
  });
  size.addEventListener('change', commitSize);
  size.addEventListener('blur', commitSize);
  size.addEventListener('focus', () => sizeDropdown.close());
  size.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSize();
      sizeDropdown.close();
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      commitSize();
      sizeDropdown.open();
    }
  });
  render();
  return { get: () => ({ ...preference }), set };
}
