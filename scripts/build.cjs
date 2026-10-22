'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  esbuild = require('esbuild');
async function build() {
  const root = path.resolve(__dirname, '..'),
    out = path.join(root, 'build');
  await fs.mkdir(out, { recursive: true });
  // The canvas now uses the shared browser toolbar; remove its obsolete UI bundle.
  for (const file of ['canvas-browser.js', 'canvas-browser.js.map'])
    await fs.rm(path.join(out, file), { force: true });
  const theme = require('../src/theme.cjs'),
    typography = require('../src/typography.cjs');
  for (const font of Object.values(typography.FONTS).filter((font) => font.file)) {
    const original = path.join(root, 'src', font.file),
      bytes = await fs.readFile(original);
    if (font.format === 'woff2' && bytes.subarray(0, 4).toString() !== 'wOF2')
      throw new Error('Invalid bundled font: ' + font.file);
    if (!font.license) throw new Error('Bundled font license missing: ' + font.file);
    await fs.access(path.join(root, 'src', font.license));
    const target = path.join(out, font.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(original, target);
  }
  const common = {
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    logLevel: 'warning',
    absWorkingDir: root
  };
  await esbuild
    .build({
      ...common,
      entryPoints: ['src/ui/renderer.js'],
      outfile: path.join(out, 'app.js'),
      sourcemap: true,
      metafile: true
    })
    .then(async (result) => {
      await fs.writeFile(
        path.join(out, 'build-info.json'),
        JSON.stringify(
          {
            version: require('../package.json').version,
            ui: 'native',
            inputs: Object.keys(result.metafile.inputs)
          },
          null,
          2
        )
      );
    });
  await esbuild.build({
    ...common,
    stdin: { contents: "window.CanvasThemes=require('./src/theme.cjs');", resolveDir: root },
    outfile: path.join(out, 'theme-catalog.js')
  });
  await esbuild.build({
    ...common,
    stdin: {
      contents: "window.PromptTypography=require('./src/typography.cjs');",
      resolveDir: root
    },
    outfile: path.join(out, 'typography-catalog.js')
  });
  await fs.writeFile(path.join(out, 'themes.css'), theme.themeCss());
  await fs.writeFile(path.join(out, 'typography-assets.css'), typography.fontCss());
  for (const file of [
    'src/ui/index.html',
    'src/feedback/index.html',
    'src/browser-toolbar/index.html'
  ]) {
    const html = await fs.readFile(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const value = match[1];
      if (value.startsWith('#') || /^[a-z]+:/i.test(value)) continue;
      const asset = path.resolve(root, path.dirname(file), value.split('?')[0]);
      if (!asset.startsWith(root + path.sep)) throw new Error('UI asset outside project: ' + value);
      await fs.access(asset).catch(() => {
        throw new Error('Missing UI asset in ' + file + ': ' + value);
      });
    }
  }
  console.log(
    'Built v' +
      require('../package.json').version +
      ' with explicit module dependencies into build/.'
  );
}
module.exports = build;
if (require.main === module)
  build().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
