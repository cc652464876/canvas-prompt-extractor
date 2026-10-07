'use strict';

// Single source for the desktop window, main UI and extraction feedback.
// The build emits CSS and a browser version from this module; do not edit those outputs.
const COMMON = {
  'primary-text':'#fff', 'media-bg':'#15181d', 'media-inner-bg':'#111',
  'media-text':'#e1e8f0', 'media-muted':'#b5bfcc', 'media-icon':'#8b99aa',
  'media-cover-muted':'#aab3c0', 'media-snippet':'#d5dce5',
  'media-label-bg':'#1119', 'media-label-text':'#e8eef6',
  'media-play-bg':'#1118', 'media-play-border':'#ffffff80',
  'media-control-bg':'#fffe', 'media-control-text':'#24364d', 'media-control-border':'#fff8',
  'media-load-bg':'#fff', 'media-load-text':'#263244', 'media-load-border':'#ddd',
  'media-ref-bg':'#171b21', 'media-ref-muted':'#8f9bac', 'media-number-bg':'#000a',
  'media-loading-bg':'#111a', 'media-pulse-bg':'#283443',
  'lens-border':'#fff', 'lens-shadow':'0 2px 12px #0008',
};
const LIGHT = {
  bg:'#f4f6fa', surface:'#fff', text:'#202b3c', muted:'#647185', line:'#e0e6ef',
  accent:'#2563c7', soft:'#edf4ff', success:'#216849', bad:'#9d2626', ref:'#f0f3f6',
  shadow:'0 4px 20px #21375306', 'primary-bg':'#205bc0', 'primary-hover':'#184ea9',
  'selection-bg':'#e7f1ff', 'selection-border':'#9bbfee', 'selection-text':'#174e9f', 'selection-hover':'#dbeaff',
  'warning-bg':'#fff8eb', 'warning-text':'#805715', 'warning-border':'#e7d2a7', attention:'#946013',
  'progress-track':'#e7edf6', 'progress-start':'#347ce4', 'progress-end':'#2360c2',
  'progress-success-start':'#35ac83', 'progress-success-end':'#25916e', 'progress-glow':'#a9caff50',
  'progress-track-shadow':'inset 0 1px 2px #314b7412', 'progress-fill-shadow':'0 1px 4px #2563c724',
  'loading-track':'#a4b9d466', 'loading-accent':'#9bc2ff',
  'prompt-text-color':'#202938', 'prompt-reference-color':'#808080', 'prompt-reference-hover':'#000',
  'popup-shadow':'0 8px 30px #0003', backdrop:'#182332a0',
};
const DARK = {
  ...LIGHT, bg:'#161c26', surface:'#202835', text:'#e7edf6', muted:'#a0aec1', line:'#354255',
  accent:'#93bbff', soft:'#283b56', success:'#9ad3b6', bad:'#ffadab', ref:'#333b46', shadow:'none',
  'selection-bg':'#2b4465', 'selection-border':'#648dc3', 'selection-text':'#d7e8ff', 'selection-hover':'#355176',
  'warning-bg':'#3a3225', 'warning-text':'#efd5a8', 'warning-border':'#66543a', attention:'#efd5a8',
  'progress-track':'#35445a', 'progress-start':'#5091f0', 'progress-end':'#3975d0',
  'prompt-text-color':'#fff', 'prompt-reference-hover':'#fff',
};
// Neutral default dark chrome; named reference palettes keep their own colors.
const DEFAULT_DARK = {
  ...COMMON,...DARK,
  bg:'#2d2d2b',surface:'#333331',text:'#f0f0ee',muted:'#adada8',line:'#494947',
  accent:'#9dbcf0',soft:'#3b3b38',ref:'#383836',
  'selection-bg':'#41413e','selection-border':'#666662','selection-text':'#f3f3f0','selection-hover':'#494946',
  'progress-track':'#484846','progress-track-shadow':'none','progress-fill-shadow':'none','progress-glow':'#ffffff20',
  'loading-track':'#b0b0aa55',backdrop:'#00000080',
  'media-bg':'#202020','media-inner-bg':'#181818','media-ref-bg':'#242424',
  'media-text':'#e4e4e2','media-muted':'#b5b5b0','media-cover-muted':'#ababa6',
  'media-snippet':'#d8d8d4','media-ref-muted':'#969690','media-pulse-bg':'#30302e',
};
const PALETTES = {
  default: {name:'默认', description:'浅色清爽，深色采用中性深灰与少量蓝色强调', light:{...COMMON,...LIGHT}, dark:DEFAULT_DARK},
  sand: {name:'暖砂', description:'米白与暖灰，搭配棕色强调色',
    light:{...COMMON,...LIGHT, bg:'#f5f1e8',surface:'#fffcf5',text:'#352f28',muted:'#71685d',line:'#ded5c6',
      accent:'#866036',soft:'#f2e8d8',ref:'#eee7da','primary-bg':'#886036','primary-hover':'#6e4927',
      'selection-bg':'#f1e4cf','selection-border':'#bc9761','selection-text':'#65451f','selection-hover':'#e9d8bb',
      'prompt-text-color':'#352f28','prompt-reference-color':'#776b5c','prompt-reference-hover':'#352f28',
      'progress-track':'#e5dccd','progress-start':'#ad824b','progress-end':'#886036',
      'loading-accent':'#ad824b','loading-track':'#bc976166'},
    dark:{...COMMON,...DARK, bg:'#242320',surface:'#2f2d29',text:'#ebdfc4',muted:'#b3a68e',line:'#4e493f',
      accent:'#e0b779',soft:'#40372a',ref:'#39352e','primary-bg':'#b48a52','primary-hover':'#c59a60','primary-text':'#211b13',
      'selection-bg':'#473b29','selection-border':'#9b7a48','selection-text':'#f0d7ad','selection-hover':'#55452e',
      'prompt-text-color':'#ebdfc4','prompt-reference-color':'#b3a68e','prompt-reference-hover':'#f0d7ad',
      'progress-track':'#4e493f','progress-start':'#d2aa6c','progress-end':'#b48a52',
      'loading-accent':'#e0b779','loading-track':'#9b7a4866'},
  },
};
const THEME_LIBRARY=require('./theme-library.json');
function mix(a,b,amount){
  const expand=value=>value.length===4?'#'+[...value.slice(1)].map(c=>c+c).join(''):value;
  a=expand(a);b=expand(b);
  return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-amount)+parseInt(b.slice(i,i+2),16)*amount).toString(16).padStart(2,'0')).join('');
}
function luminance(hex){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function readable(ink,bg){
  if(contrast(ink,bg)>=4.5)return ink;
  const target=contrast('#ffffff',bg)>contrast('#151515',bg)?'#ffffff':'#151515';
  for(let amount=.05;amount<=1.001;amount+=.05){const color=mix(ink,target,Math.min(1,amount));if(contrast(color,bg)>=4.5)return color;}
  return target;
}
function adaptReference(reference,mode){
  const dark=mode==='dark',base=dark?DARK:LIGHT,bg=reference.background,ink=readable(reference.foreground,bg),accent=reference.accent;
  let surface=reference.surface||mix(bg,dark?'#ffffff':'#ffffff',dark?.035:.5);
  for(let step=0;step<10&&contrast(ink,surface)<4.5;step++)surface=mix(surface,bg,.35);
  if(contrast(ink,surface)<4.5)surface=bg;
  const muted=readable(mix(ink,surface,.30),surface),line=mix(surface,ink,dark?.22:.16);
  const selection=mix(surface,accent,dark?.23:.14),selectionText=readable(ink,selection),warning=mix(surface,'#dba948',.14);
  const primaryText=contrast('#ffffff',accent)>contrast('#151515',accent)?'#ffffff':'#151515';
  const success=readable(reference.semanticColors?.diffAdded||base.success,surface),bad=readable(reference.semanticColors?.diffRemoved||base.bad,surface);
  return {...COMMON,...base,bg,surface,text:ink,muted,line,accent:readable(accent,surface),soft:selection,ref:mix(surface,ink,.05),success,bad,
    'primary-bg':accent,'primary-hover':mix(accent,primaryText==='#ffffff'?'#151515':'#ffffff',.10),'primary-text':primaryText,
    'selection-bg':selection,'selection-border':mix(surface,accent,.55),'selection-text':selectionText,'selection-hover':mix(selection,accent,.12),
    'warning-bg':warning,'warning-text':readable(dark?'#efd5a8':'#805715',warning),'warning-border':mix(surface,'#dba948',.45),attention:readable(dark?'#efd5a8':'#805715',surface),
    'progress-track':line,'progress-start':accent,'progress-end':mix(accent,bg,.12),'progress-success-start':success,'progress-success-end':mix(success,bg,.08),'progress-glow':accent+'50',
    'progress-track-shadow':'none','progress-fill-shadow':'none','loading-track':accent+'66','loading-accent':accent,
    'prompt-text-color':ink,'prompt-reference-color':muted,'prompt-reference-hover':ink,
    shadow:dark?'none':'0 4px 20px '+ink+'08',backdrop:bg+'b0'};
}
for(const [id,reference] of Object.entries(THEME_LIBRARY))PALETTES[id]={name:reference.name,originalName:reference.originalName,description:reference.description,references:reference.references,light:adaptReference(reference.light,'light'),dark:adaptReference(reference.dark,'dark')};
const MODES = ['light','dark','system'];
const DEFAULT_PREFERENCE = Object.freeze({palette:'default',mode:'light'});
const STORAGE_KEY = 'appearance-v1';
function normalizePreference(value) {
  if(typeof value==='string')return {palette:'default',mode:MODES.includes(value)?value:'light'};
  return {palette:Object.hasOwn(PALETTES,value?.palette)?value.palette:'default', mode:MODES.includes(value?.mode)?value.mode:'light'};
}
function resolveTheme(value, systemDark=false) {
  const preference=normalizePreference(value);
  const resolvedMode=preference.mode==='system'?(systemDark?'dark':'light'):preference.mode;
  return {...preference,resolvedMode,tokens:PALETTES[preference.palette][resolvedMode]};
}
function readPreference(storage) {
  try {
    const value=storage.getItem(STORAGE_KEY);
    if(value!==null){try{return normalizePreference(JSON.parse(value));}catch{}}
    return normalizePreference(storage.getItem('theme'));
  } catch {return {...DEFAULT_PREFERENCE};}
}
function applyTheme(root,value,systemDark=false) {
  const theme=resolveTheme(value,systemDark);
  root.dataset.palette=theme.palette;root.dataset.theme=theme.resolvedMode;root.dataset.themeMode=theme.mode;
  return theme;
}
function themeCss() {
  const rules=['/* Generated from src/theme.cjs. Run node scripts/build.cjs after changing palettes. */'];
  for(const [id,palette] of Object.entries(PALETTES))for(const mode of ['light','dark']) {
    const selector=(id==='default'&&mode==='light'?':root,\n':'')+`:root[data-palette="${id}"][data-theme="${mode}"]`;
    const tokens={...palette[mode],selected:'var(--primary-bg)'};
    rules.push(selector+' {\n  color-scheme: '+mode+';\n'+Object.entries(tokens).map(([key,value])=>`  --${key}: ${value};`).join('\n')+'\n}');
  }
  return rules.join('\n\n')+'\n';
}
module.exports={PALETTES,THEME_LIBRARY,MODES,DEFAULT_PREFERENCE,STORAGE_KEY,normalizePreference,resolveTheme,readPreference,applyTheme,themeCss};
