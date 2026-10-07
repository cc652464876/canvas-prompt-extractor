'use strict';
// These local modules use only named exports and single-line imports.
// Join them into a browser script without a package manager or external UI library.
const fs=require('node:fs/promises'),path=require('node:path');
async function build(){const root=path.resolve(__dirname,'..'),ui=path.join(root,'src/ui');const files=['view-model.js','reader-targets.js','prompt-display.js','video-sample.js','preview-pool.js','video-cover-queue.js','thumbnails.js','interactions.js','appearance-dropdown.js','theme-manager.js','typography-manager.js','renderer.js'];const parts=[];
  const themePath=path.join(root,'src/theme.cjs'),themeSource=await fs.readFile(themePath,'utf8');
  delete require.cache[require.resolve(themePath)];const theme=require(themePath);
  await fs.writeFile(path.join(root,'src/theme-catalog.js'),'/* Generated from theme.cjs and theme-library.json. */\nwindow.CanvasThemes=(()=>{const module={exports:{}};\n'+themeSource.replace("require('./theme-library.json')",JSON.stringify(theme.THEME_LIBRARY))+'\nreturn module.exports;})();\n');
  await fs.writeFile(path.join(root,'src/themes.css'),theme.themeCss());
  const typographyPath=path.join(root,'src/typography.cjs'),typographySource=await fs.readFile(typographyPath,'utf8');
  delete require.cache[require.resolve(typographyPath)];const typography=require(typographyPath);
  for(const font of Object.values(typography.FONTS).filter(font=>font.file)) {
    const bytes=await fs.readFile(path.join(root,'src',font.file));
    if(font.format==='woff2'&&bytes.subarray(0,4).toString()!=='wOF2')throw new Error('Invalid bundled font: '+font.file);
    if(!font.license)throw new Error('Bundled font license missing: '+font.file);
    await fs.access(path.join(root,'src',font.license));
  }
  await fs.writeFile(path.join(root,'src/typography-catalog.js'),'/* Generated from typography.cjs. */\nwindow.PromptTypography=(()=>{const module={exports:{}};\n'+typographySource+'\nreturn module.exports;})();\n');
  await fs.writeFile(path.join(root,'src/typography-assets.css'),typography.fontCss());
  for(const file of files){const source=await fs.readFile(path.join(ui,file),'utf8');parts.push('// '+file+'\n'+source.replace(/^import .+;\s*$/gm,'').replace(/^export (?=(?:const|function|class)\b)/gm,''));}
  await fs.writeFile(path.join(ui,'app.js'),"(()=>{\n'use strict';\n"+parts.join('\n')+'\n})();\n');await fs.writeFile(path.join(ui,'build-info.json'),JSON.stringify({version:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,ui:'native',modules:files},null,2));console.log('Built native UI without external dependencies.');}
module.exports=build;if(require.main===module)build().catch(e=>{console.error(e);process.exitCode=1;});
