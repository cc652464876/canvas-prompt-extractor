'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { inspectWork } = require('../../src/platforms/liblib/reader.cjs');
app.setPath(
  'userData',
  require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'liblib-work-info-'))
);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('https://www.liblib.tv/detail/58c6d9efa062463ebf9c7f6b0c67f020');
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const result = await win.webContents.executeJavaScript(`(()=>{
      const author=document.querySelector('[aria-label="作者信息"]');
      const h=document.querySelector('h1');
      return {work:(${inspectWork.toString()})(),authorHtml:author?.outerHTML,detailHtml:h?.parentElement?.parentElement?.outerHTML?.slice(0,24000),body:document.body.innerText.slice(0,5000)};
    })()`);
    await fs.writeFile(
      path.resolve(__dirname, '../验收记录/liblib-work-info-live.json'),
      JSON.stringify(result, null, 2)
    );
    console.log(JSON.stringify(result.work, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
