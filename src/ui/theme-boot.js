// Set colors before the stylesheets render; the controller takes over after DOM load.
(() => {
  let storage;
  try { storage=window.localStorage; } catch {}
  const preference=window.CanvasThemes.readPreference(storage);
  window.CanvasThemes.applyTheme(document.documentElement,preference,window.matchMedia('(prefers-color-scheme: dark)').matches);
  window.PromptTypography.applyTypography(document.documentElement,window.PromptTypography.readTypography(storage));
})();
