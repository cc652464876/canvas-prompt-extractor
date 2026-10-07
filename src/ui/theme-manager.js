import {createAppearanceDropdown} from './appearance-dropdown.js';
export function createThemeManager({root=document.documentElement,storage,media=window.matchMedia('(prefers-color-scheme: dark)'),sync,onError=()=>{}}) {
  const api=window.CanvasThemes;
  let preference=api.readPreference(storage),tail=Promise.resolve(),dropdown;
  const dialog=document.getElementById('appearance-dialog');
  function render() {
    const theme=api.applyTheme(root,preference,media.matches);
    const label={light:'浅色',dark:'深色',system:'跟随系统'}[preference.mode];
    document.getElementById('theme-toggle').title=api.PALETTES[preference.palette].name+' · '+label;
    for(const button of dialog.querySelectorAll('[data-appearance-mode]')) {
      const active=button.dataset.appearanceMode===preference.mode;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    }
    dropdown?.set(preference.palette);
    dropdown?.setBadgeColors(Object.fromEntries(Object.keys(api.PALETTES).map(id=>[id,api.resolveTheme({palette:id,mode:theme.resolvedMode}).tokens['primary-bg']])));
    for(const [id,token] of [['appearance-accent','primary-bg'],['appearance-background','bg'],['appearance-foreground','text']]) {
      const output=document.getElementById(id);output.querySelector('.color-value').textContent=theme.tokens[token].toUpperCase();output.querySelector('.color-dot').style.backgroundColor=theme.tokens[token];
    }
    document.getElementById('appearance-current').textContent=api.PALETTES[theme.palette].name+' · '+(theme.resolvedMode==='dark'?'深色':'浅色')+(preference.mode==='system'?'（跟随系统）':'');
    return theme;
  }
  function publish(theme) {
    if(!sync)return;
    const selection={palette:theme.palette,mode:theme.mode};
    tail=tail.catch(()=>{}).then(()=>sync(selection)).then(response=>{
      if(response?.ok===false)throw new Error(response.error||'主题同步失败');
    }).catch(onError);
  }
  function set(value) {
    preference=api.normalizePreference(value);
    try {storage?.setItem(api.STORAGE_KEY,JSON.stringify(preference));} catch {onError(new Error('外观已切换，但本地偏好保存失败。'));}
    const theme=render();publish(theme);return theme;
  }
  dropdown=createAppearanceDropdown({trigger:document.getElementById('appearance-palette-trigger'),list:document.getElementById('appearance-palette-menu'),options:Object.entries(api.PALETTES).map(([value,palette])=>({value,label:palette.name,badge:'Aa'})),onChange:palette=>set({...preference,palette})});
  for(const button of dialog.querySelectorAll('[data-appearance-mode]'))button.addEventListener('click',()=>set({...preference,mode:button.dataset.appearanceMode}));
  const trigger=document.getElementById('theme-toggle');
  trigger.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();});
  document.getElementById('appearance-close').addEventListener('click',()=>{
    document.dispatchEvent(new CustomEvent('appearance-dropdown-close'));
    dialog.close();trigger.focus();
  });
  // A queued native close event may arrive after the dialog has reopened.
  dialog.addEventListener('close',()=>{if(!dialog.open)trigger.focus();});
  function systemChanged(){if(preference.mode==='system')publish(render());}
  media.addEventListener('change',systemChanged);
  set(preference);
  return {get:()=>({...preference}),set,resolved:()=>api.resolveTheme(preference,media.matches),ready:()=>tail,destroy:()=>media.removeEventListener('change',systemChanged)};
}
