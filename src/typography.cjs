'use strict';
// Register a bundled font here; build.cjs emits its @font-face and selector.
const DEFAULT_STACK='"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif';
const FONTS={
  default:{name:'默认字体',family:DEFAULT_STACK},
  geist:{name:'Geist',family:'"Prompt Geist", '+DEFAULT_STACK,face:'Prompt Geist',file:'fonts/Geist-Variable.woff2',format:'woff2',weight:'100 900',license:'fonts/OFL-Geist.txt'},
};
const TYPOGRAPHY_KEY='prompt-typography-v1';
const DEFAULT_TYPOGRAPHY=Object.freeze({font:'default',size:14});
const FONT_SIZE_MIN=12,FONT_SIZE_MAX=28;
function normalizeTypography(value){
  const size=Number(value?.size);
  return {font:Object.hasOwn(FONTS,value?.font)?value.font:'default',size:Number.isFinite(size)&&size>0?Math.max(FONT_SIZE_MIN,Math.min(FONT_SIZE_MAX,Math.round(size))):14};
}
function readTypography(storage){try{return normalizeTypography(JSON.parse(storage.getItem(TYPOGRAPHY_KEY)));}catch{return {...DEFAULT_TYPOGRAPHY};}}
function typographyMetrics(value){
  const preference=normalizeTypography(value),ratio=preference.size/14;
  return {...preference,family:FONTS[preference.font].family,line:Math.round(24*ratio),image:Math.round(16*ratio),gap:Number((4*ratio).toFixed(2)),radius:Number((4*ratio).toFixed(2)),chipRadius:Number((8*ratio).toFixed(2))};
}
function applyTypography(root,value){
  const metrics=typographyMetrics(value);root.dataset.promptFont=metrics.font;
  for(const [key,number] of Object.entries({'prompt-font-size':metrics.size,'prompt-line-height':metrics.line,'prompt-ref-size':metrics.image,'prompt-ref-gap':metrics.gap,'prompt-ref-radius':metrics.radius,'prompt-chip-radius':metrics.chipRadius}))root.style.setProperty('--'+key,number+'px');
  root.style.setProperty('--prompt-font-family',metrics.family);return metrics;
}
function fontCss(){return '/* Generated from src/typography.cjs. */\n'+Object.values(FONTS).filter(font=>font.file).map(font=>`@font-face {\n  font-family: "${font.face}";\n  src: url("${font.file}") format("${font.format}");\n  font-style: normal;\n  font-weight: ${font.weight||'400'};\n  font-display: swap;\n}`).join('\n')+'\n';}
module.exports={FONTS,TYPOGRAPHY_KEY,DEFAULT_TYPOGRAPHY,FONT_SIZE_MIN,FONT_SIZE_MAX,normalizeTypography,readTypography,typographyMetrics,applyTypography,fontCss};
