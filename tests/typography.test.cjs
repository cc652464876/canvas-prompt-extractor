'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../src/typography.cjs');
test('Prompt typography restores independent preferences, limits size and recovers invalid fonts',()=>{
  assert.deepEqual(api.normalizeTypography({font:'geist',size:18}),{font:'geist',size:18});
  assert.deepEqual(api.normalizeTypography({font:'unknown',size:'invalid'}),{font:'default',size:14});
  assert.equal(api.normalizeTypography({size:100}).size,28);assert.equal(api.normalizeTypography({size:2}).size,12);
  assert.deepEqual(api.readTypography({getItem(){throw Error();}}),{font:'default',size:14});
  assert.deepEqual(api.readTypography({getItem:()=>'{broken'}),{font:'default',size:14});
});
test('Font size synchronizes prompt lines and square reference images without modifying content',()=>{
  const original={font:'geist',size:18},metrics=api.typographyMetrics(original);
  assert.equal(metrics.line,31);assert.equal(metrics.image,21);assert.ok(metrics.image<metrics.line);
  assert.deepEqual(original,{font:'geist',size:18});
  const defaults=api.typographyMetrics(null);assert.equal(defaults.line,24);assert.equal(defaults.image,16);
  for(let size=12;size<=28;size++)assert.ok(api.typographyMetrics({size}).line>api.typographyMetrics({size}).image);
});
test('Bundled Geist, license, font-face output and browser catalog are present and consistent',()=>{
  const src=path.resolve(__dirname,'../src');
  for(const font of Object.values(api.FONTS).filter(font=>font.file)){
    const bytes=fs.readFileSync(path.join(src,font.file));assert.equal(bytes.subarray(0,4).toString(),'wOF2');
    assert.ok(fs.readFileSync(path.join(src,font.license),'utf8').includes('SIL OPEN FONT LICENSE'));
  }
  assert.equal(fs.readFileSync(path.join(src,'typography-assets.css'),'utf8'),api.fontCss());
  const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(src,'typography-catalog.js'),'utf8'),context);
  assert.equal(JSON.stringify(context.window.PromptTypography.FONTS),JSON.stringify(api.FONTS));
});
