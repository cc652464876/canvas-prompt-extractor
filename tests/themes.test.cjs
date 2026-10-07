'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PALETTES,normalizePreference,resolveTheme,readPreference,STORAGE_KEY}=require('../src/theme.cjs');
test('Appearance migrates legacy choices, survives damaged storage and validates palette IDs',()=>{
  const storage=values=>({getItem:key=>values[key]??null});
  assert.deepEqual(readPreference(storage({theme:'dark'})),{palette:'default',mode:'dark'});
  assert.deepEqual(readPreference(storage({[STORAGE_KEY]:'broken',theme:'dark'})),{palette:'default',mode:'dark'});
  assert.deepEqual(readPreference(storage({[STORAGE_KEY]:JSON.stringify({palette:'sand',mode:'system'}),theme:'dark'})),{palette:'sand',mode:'system'});
  assert.deepEqual(readPreference({getItem(){throw new Error('blocked');}}),{palette:'default',mode:'light'});
  assert.deepEqual(normalizePreference({palette:'__proto__',mode:'unsupported'}),{palette:'default',mode:'light'});
});
test('System mode resolves without changing the stored palette or explicit mode',()=>{
  for(const palette of Object.keys(PALETTES)) {
    assert.equal(resolveTheme({palette,mode:'system'},true).resolvedMode,'dark');
    assert.equal(resolveTheme({palette,mode:'system'},false).resolvedMode,'light');
    assert.equal(resolveTheme({palette,mode:'light'},true).resolvedMode,'light');
    assert.equal(resolveTheme({palette,mode:'dark'},false).resolvedMode,'dark');
  }
});
test('All palettes provide every consumed token and keep readable text contrast',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../src');
  const css=[...fs.readdirSync(path.join(root,'ui')).filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join(root,'ui',n),'utf8')),fs.readFileSync(path.join(root,'feedback/style.css'),'utf8')].join('\n');
  const layout=new Set(['panel-padding','control-height','action-width','module-gap','module-row-gap','checkbox-size','columns','category-count','prompt-height','prompt-font-family','prompt-font-size','prompt-line-height','prompt-ref-size','prompt-ref-gap','prompt-ref-radius','prompt-chip-radius']);
  const used=[...new Set([...css.matchAll(/var\(--([a-z-]+)/g)].map(m=>m[1]))].filter(key=>!layout.has(key));
  const luminance=hex=>{const expanded=hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex;const c=[1,3,5].map(i=>parseInt(expanded.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  for(const [id,palette] of Object.entries(PALETTES))for(const mode of ['light','dark']) {
    const tokens=palette[mode];for(const key of used)assert.ok(key==='selected'||tokens[key],id+'/'+mode+' missing '+key);
    for(const [text,bg] of [['text','surface'],['muted','surface'],['primary-text','primary-bg'],['selection-text','selection-bg'],['prompt-text-color','surface']])assert.ok(contrast(tokens[text],tokens[bg])>=4.5,id+'/'+mode+' contrast '+text+'/'+bg);
  }
  assert.equal(/#[0-9a-f]{3,8}\b|data-theme=dark/i.test(css),false,'Component CSS must use shared tokens');
});
test('The generated browser catalog and stylesheet match the source used by Electron',()=>{
  const fs=require('node:fs'),path=require('node:path'),api=require('../src/theme.cjs'),context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/theme-catalog.js'),'utf8'),context);
  assert.equal(JSON.stringify(context.window.CanvasThemes.PALETTES),JSON.stringify(api.PALETTES));
  assert.equal(fs.readFileSync(path.resolve(__dirname,'../src/themes.css'),'utf8'),api.themeCss());
});
test('Reference themes preserve source provenance, translations and brand names in both modes',()=>{
  const{THEME_LIBRARY}=require('../src/theme.cjs');
  assert.equal(Object.keys(THEME_LIBRARY).length,18);assert.equal(Object.keys(PALETTES).length,20);
  assert.equal(PALETTES['tokyo-night'].name,'东京之夜');assert.equal(PALETTES.everforest.name,'常青森林');assert.equal(PALETTES.github.name,'GitHub');assert.equal(PALETTES.linear.name,'Linear');
  for(const [id,reference] of Object.entries(THEME_LIBRARY))for(const mode of ['light','dark']){
    assert.match(reference.references[mode].url,/^https:\/\/raw\.githubusercontent\.com\//);
    for(const key of ['accent','background','foreground'])assert.match(reference[mode][key],/^#[0-9a-fA-F]{6}$/);
    assert.equal(PALETTES[id][mode].bg,reference[mode].background);
    assert.equal(PALETTES[id][mode]['primary-bg'],reference[mode].accent);
  }
});
