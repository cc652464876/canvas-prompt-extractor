'use strict';
const { verificationPath } = require('../../../src/app-paths.cjs');
const fs = require('node:fs/promises'),
  assert = require('node:assert/strict');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({ root, ui, runExtraction, getWindow, getFeedback, session }) => {
  const checks = [];
  let canvas = false,
    pending = 0,
    failNetworkOnce = true,
    failGatewayOnce = true;
  const nodes = [{ id: 'text1', type: 'text', data: { name: '期限回归', text: '本地画布提示词' } }];
  session.fromPartition('persist:liblib').protocol.handle('https', (request) => {
    if (request.url.endsWith('/network-failure') && failNetworkOnce) {
      failNetworkOnce = false;
      throw new Error('Intentional network failure for regression');
    }
    if (request.url.endsWith('/gateway-failure') && failGatewayOnce) {
      failGatewayOnce = false;
      return new Response(
        'upstream connect error or disconnect/reset before headers. reset reason: connection termination',
        { status: 503, statusText: 'Service Unavailable' }
      );
    }
    if (request.url.includes('/pending')) {
      pending++;
      return new Promise(() => {});
    }
    const script = canvas
      ? '<div class="react-flow" id="flow"></div><script>flow.__reactFiber$fixture={memoizedProps:' +
        JSON.stringify({ nodes, edges: [] }) +
        '};</script>'
      : '';
    return new Response(
      '<!doctype html><meta charset="utf-8"><h1>Read deadline fixture</h1>' +
        script +
        '<iframe src="https://www.liblib.tv/pending"></iframe>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  });
  const read = async (label, options) => {
    const start = Date.now();
    try {
      const result = await runExtraction('https://www.liblib.tv/detail/' + label, {
        mode: 'full',
        ...options
      });
      return { result, elapsedMs: Date.now() - start };
    } catch (e) {
      return { error: e.message, elapsedMs: Date.now() - start };
    }
  };
  const timeout = await read('timeout', { timeout: 500 });
  assert.ok(timeout.error);
  assert.ok(timeout.elapsedMs < 4500, JSON.stringify(timeout));
  assert.equal(getWindow().webContents.isAudioMuted(), false);
  checks.push({
    name: 'Pending iframe cannot hold automatic read timeout or audio restoration',
    ...timeout
  });
  canvas = true;
  const success = await read('success', { timeout: 3500 });
  assert.ok(success.result, JSON.stringify(success));
  assert.equal(success.result.entries.length, 1);
  assert.equal(getWindow().webContents.isAudioMuted(), true, 'Completed hidden pages stay muted');
  assert.ok(success.elapsedMs < 7000);
  checks.push({
    name: 'DOM-ready canvas extracts successfully while an iframe is still loading',
    elapsedMs: success.elapsedMs,
    entries: success.result.entries.length
  });
  canvas = false;
  let settled = false;
  const reading = read('cancel', { timeout: 15000 }).then((r) => {
    settled = true;
    return r;
  });
  for (let i = 0; i < 100; i++) {
    if (getFeedback()?.active && getWindow().webContents.getURL().includes('cancel')) break;
    await wait(20);
  }
  assert.equal(settled, false);
  assert.equal(getWindow().webContents.isAudioMuted(), true, 'Visible reads stay muted');
  const response = await ui.webContents.executeJavaScript('window.lab.cancel()');
  assert.equal(response.ok, true);
  const cancelled = await reading;
  assert.match(cancelled.error, /取消/);
  assert.ok(cancelled.elapsedMs < 4500);
  assert.equal(getWindow().webContents.isAudioMuted(), false);
  checks.push({
    name: 'Actual cancel IPC aborts page waiting and releases the read task',
    ...cancelled
  });
  canvas = true;
  const again = await read('after-cancel', { timeout: 3500 });
  assert.ok(again.result);
  checks.push({
    name: 'A fresh extraction succeeds after timeout and cancellation',
    entries: again.result.entries.length
  });
  const failed = await read('network-failure', { timeout: 3500 });
  assert.match(failed.error, /作品页面加载失败.*ERR_UNEXPECTED/);
  assert.ok(failed.elapsedMs < 4500);
  const uiFailure = await ui.webContents.executeJavaScript(
    '({loading:Boolean(document.querySelector(".loading-canvas")),title:document.getElementById("project-name").textContent,prompts:document.getElementById("prompt-total").textContent,assets:document.getElementById("asset-total").textContent})'
  );
  assert.equal(uiFailure.loading, false);
  assert.equal(uiFailure.title, '读取未完成');
  assert.equal(uiFailure.prompts, '0');
  assert.equal(uiFailure.assets, '0');
  checks.push({
    name: 'A real Chromium error document reports the network error and clears the loading UI',
    ...failed,
    ui: uiFailure
  });
  const recovered = await read('network-failure', { timeout: 3500 });
  assert.ok(recovered.result);
  checks.push({
    name: 'Retrying the exact failed URL reloads the page and succeeds',
    entries: recovered.result.entries.length
  });
  const gateway = await read('gateway-failure', { timeout: 3500 });
  assert.match(gateway.error, /HTTP_503/);
  assert.ok(gateway.elapsedMs < 4500);
  checks.push({
    name: 'An upstream HTTP 503 response fails immediately instead of waiting for a canvas',
    ...gateway
  });
  const gatewayRecovered = await read('gateway-failure', { timeout: 3500 });
  assert.ok(gatewayRecovered.result);
  checks.push({
    name: 'The same URL recovers after an upstream gateway failure',
    entries: gatewayRecovered.result.entries.length
  });
  assert.ok(pending >= 4);
  await getFeedback().dispose();
  assert.equal(getFeedback().overlay.isDestroyed(), true);
  await fs.mkdir(verificationPath(root), { recursive: true });
  await fs.writeFile(
    verificationPath(root, 'read-deadline-report.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        pendingIframeRequests: pending,
        transport:
          'Isolated profile; local HTTPS interception; iframe responses intentionally never finish'
      },
      null,
      2
    )
  );
  console.log('PASS read deadlines: ' + JSON.stringify(checks));
};
