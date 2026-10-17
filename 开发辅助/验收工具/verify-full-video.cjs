'use strict';
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { PALETTES } = require('../../src/theme.cjs');
const { normalize } = require('../../src/normalize.cjs');
const { verificationPath } = require('../../src/app-paths.cjs');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(os.tmpdir(), 'canvas-full-video-ui-' + process.pid));
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'labmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('labmedia', () => new Response('', { status: 404 }));
    ipcMain.handle('lab:info', () => ({ ok: true, value: { options: { mode: 'lite' } } }));
    ipcMain.handle('lab:theme', () => ({ ok: true }));
    ipcMain.handle('lab:thumbnail-info', () => ({ ok: true, value: false }));
    const result = normalize(
      {
        nodes: [
          {
            id: 'clip',
            type: 'video',
            data: { name: '视频片段', url: ['https://libtv-res.liblib.art/clip.mp4'] }
          }
        ],
        edges: [],
        fullVideo: {
          workId: 'fixture',
          name: '完整作品测试',
          url: 'https://libtv-res.liblib.art/full.mp4',
          duration: 69.6
        }
      },
      {
        platform: 'liblib',
        title: '完整视频验收',
        inputUrl: 'https://www.liblib.tv/detail/fixture'
      }
    );
    const ui = new BrowserWindow({
      width: 1440,
      height: 1000,
      show: false,
      webPreferences: {
        preload: path.join(root, 'src/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        offscreen: true
      }
    });
    await ui.loadFile(path.join(root, 'src/ui/index.html'));
    console.log('UI loaded');
    ui.webContents.send('lab:event', { type: 'result', payload: result });
    ui.webContents.send('lab:event', {
      type: 'project',
      payload: { root: '验收目录', documents: [], options: { mode: 'lite', kinds: ['video'] } }
    });
    const run = (code) => ui.webContents.executeJavaScript(code);
    await run(
      "document.getElementById('tab-assets').click();document.querySelector('.content-card .card-heading').click()"
    );
    console.log('Asset board and reader opened');
    const checks = [];
    for (const palette of Object.keys(PALETTES)) {
      for (const mode of ['light', 'dark']) {
        const state = await run(`(() => {
        window.CanvasThemes.applyTheme(document.documentElement,${JSON.stringify({ palette, mode })});
        const full=document.querySelector('.content-card'), clip=document.querySelectorAll('.content-card')[1], detail=document.querySelector('.reading-card');
        const tokens=e=>{const s=getComputedStyle(e);return {surface:s.getPropertyValue('--surface').trim(),text:s.getPropertyValue('--text').trim(),scheme:s.colorScheme}};
        return {full:tokens(full),clip:tokens(clip),detail:tokens(detail),name:full.querySelector('.card-heading').textContent,badge:full.querySelector('.asset-kind').textContent,count:document.getElementById('media-count-video').textContent};
      })()`);
        const opposite = mode === 'light' ? 'dark' : 'light';
        assert.deepEqual(state.full, {
          surface: PALETTES[palette][opposite].surface,
          text: PALETTES[palette][opposite].text,
          scheme: opposite
        });
        assert.deepEqual(state.detail, state.full);
        assert.equal(state.clip.surface, PALETTES[palette][mode].surface);
        assert.equal(state.name, result.assets[0].name);
        assert.equal(state.badge, '完整视频');
        assert.equal(state.count, '2');
        console.log('Verified', palette, mode);
        checks.push(palette + '/' + mode);
        if (palette === 'default') {
          await run("document.querySelector('.workspace').scrollIntoView()");
          await new Promise((resolve) => setTimeout(resolve, 200));
          await fs.writeFile(
            verificationPath(root, 'full-video-' + mode + '.png'),
            (await ui.webContents.capturePage()).toPNG()
          );
        }
      }
    }
    // System preferences resolve to the same scoped opposite theme.
    for (const systemDark of [false, true]) {
      const scheme = await run(
        `window.CanvasThemes.applyTheme(document.documentElement,{palette:'default',mode:'system'},${systemDark});getComputedStyle(document.querySelector('.full-video')).colorScheme`
      );
      assert.equal(scheme, systemDark ? 'light' : 'dark');
    }
    const report = { passed: true, checks, system: true, queueCount: 2 };
    await fs.writeFile(
      verificationPath(root, 'full-video-ui-report.json'),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report));
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
