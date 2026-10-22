function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function midjourneyJobUrl(info) {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    jobPattern = new RegExp('\\bJob\\s*ID\\s*[:：]\\s*(' + uuid + ')(?![a-z0-9-])', 'i');
  const texts = [info.fullText, info.parameters, ...(info.descriptions || []).map((v) => v.text)];
  let id = texts
    .filter((text) => typeof text === 'string')
    .map((text) => text.match(jobPattern)?.[1])
    .find(Boolean);
  if (!id && /midjourney/i.test(info.brand || '')) {
    const field = Object.entries(info.raw || {}).find(
      ([key, value]) =>
        key.split(':').at(-1).replace(/[_\s]/g, '').toLowerCase() === 'digitalimageguid' &&
        typeof value === 'string' &&
        new RegExp('^' + uuid + '$', 'i').test(value.trim())
    );
    id = field?.[1].trim();
  }
  return id ? 'https://www.midjourney.com/jobs/' + id.toLowerCase() : '';
}
let panelId = 0;
function createImageInfoPanel({ inline = false, onVisibilityChange = () => {} } = {}) {
  const dialog = element(
    inline ? 'section' : 'dialog',
    '',
    'image-info-panel ' + (inline ? 'reader-image-info' : 'image-info-dialog')
  );
  if (!inline) dialog.id = 'image-info-dialog';
  const fileId = inline ? 'reader-image-info-file-' + ++panelId : 'image-info-file';
  dialog.setAttribute('aria-labelledby', fileId);
  const heading = element('div', '', 'image-info-heading'),
    file = element('span', '', 'image-info-file'),
    controls = element('div', '', 'image-info-actions'),
    copy = element('button', '复制提示词'),
    copyAll = element('button', '复制全部信息'),
    retry = element('button', '重新读取'),
    close = element('button', '关闭'),
    body = element('div', '', 'image-info-body'),
    state = element('p', '', 'image-info-status');
  file.id = fileId;
  state.hidden = true;
  state.setAttribute('role', 'status');
  for (const [node, action] of [
    [copy, 'copy-prompt'],
    [copyAll, 'copy-all'],
    [retry, 'reload'],
    [close, 'close']
  ]) {
    node.type = 'button';
    node.className = 'quiet';
    node.dataset.action = action;
  }
  controls.append(copy, copyAll, retry);
  if (!inline) controls.append(close);
  heading.append(file, controls);
  dialog.append(heading, body, state);
  if (inline) dialog.hidden = true;
  else document.body.append(dialog);
  let sequence = 0,
    current = null,
    info = null,
    detailText = null,
    detailPending = null,
    backdropPress = false,
    assetKey = '';
  const isOpen = () => (inline ? current !== null : dialog.open);
  const setVisible = (visible) => {
    if (!inline) return;
    dialog.hidden = !visible;
    onVisibilityChange(visible);
  };
  const status = (message = '') => {
    state.textContent = message;
    state.hidden = !message;
  };
  const dismiss = () => {
    sequence++;
    current = null;
    info = null;
    backdropPress = false;
  };
  const dismissDialog = () => {
    dismiss();
    if (inline) setVisible(false);
    else if (dialog.open) dialog.close();
  };
  close.addEventListener('click', dismissDialog);
  const isBackdrop = (event) => {
    if (
      event.target !== dialog ||
      event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight
    )
      return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  dialog.addEventListener('pointerdown', (event) => {
    backdropPress = event.button === 0 && isBackdrop(event);
  });
  dialog.addEventListener('pointercancel', () => {
    backdropPress = false;
  });
  dialog.addEventListener('click', (event) => {
    const dismissBackdrop = event.button === 0 && backdropPress && isBackdrop(event);
    backdropPress = false;
    if (dismissBackdrop) {
      event.preventDefault();
      event.stopPropagation();
      dismissDialog();
    }
  });
  dialog.addEventListener('cancel', dismiss);
  // A previous close event can arrive after the same dialog has reopened.
  dialog.addEventListener('close', () => {
    if (!dialog.open) dismiss();
  });
  const getDetails = (token) => {
    if (detailText != null) return Promise.resolve(detailText);
    if (detailPending) return detailPending;
    const assetId = current.id;
    detailPending = window.lab
      .imageInfoDetails(assetId)
      .then((r) => {
        if (!r.ok) throw new Error(r.error);
        if (token === sequence) detailText = r.value;
        return r.value;
      })
      .finally(() => {
        if (token === sequence) detailPending = null;
      });
    return detailPending;
  };
  const render = (value) => {
    body.replaceChildren();
    if (value.status === 'needs-download') {
      const download = element('button', '下载图片', 'quiet');
      download.type = 'button';
      download.addEventListener('click', async () => {
        const token = sequence;
        try {
          const r = await window.lab.download({ ids: [current.id], kinds: ['image'] });
          if (token === sequence) status(r.ok ? '已加入下载，完成后可重新读取。' : r.error);
        } catch (error) {
          if (token === sequence) status(error.message);
        }
      });
      body.append(element('p', '需先下载原图，才能读取图片内嵌的模型和提示词。'), download);
      return;
    }
    const size =
        value.width && value.height ? value.width + ' × ' + value.height + ' 像素' : '尺寸未知',
      brand = (value.brand || '').replace(/（.*?）/g, '').trim() || '品牌未知',
      specs = [
        size,
        value.bytes ? (value.bytes / 1024 / 1024).toFixed(2) + ' MB' : '',
        value.format
      ]
        .filter(Boolean)
        .join(' · '),
      summary = element(
        'p',
        [brand, value.model, specs].filter(Boolean).join(' · '),
        'image-info-summary'
      );
    summary.title = [value.brand, value.brandEvidence, value.modelEvidence]
      .filter(Boolean)
      .join('；');
    body.append(summary);
    if (value.prompt) {
      const prompt = element('pre', value.prompt, 'image-info-prompt');
      prompt.title = value.promptSource || '';
      body.append(prompt);
      if (value.negativePrompt)
        body.append(element('pre', '负面提示词：' + value.negativePrompt, 'image-info-negative'));
      if (value.parameters) body.append(element('pre', value.parameters, 'image-info-parameters'));
    }
    const more = element('details', '', 'image-info-more'),
      output = element('pre', '', 'image-info-exiftool'),
      moreSummary = element('summary'),
      jobUrl = midjourneyJobUrl(value);
    moreSummary.append(element('span', '更多信息'));
    moreSummary.addEventListener('click', (event) => {
      // Keep keyboard activation, but ignore pointer clicks in the spacing between labels.
      if (event.target === moreSummary && event.detail > 0) event.preventDefault();
    });
    if (jobUrl) {
      const openJob = element('button', '打开官网', 'quiet image-info-open-job');
      openJob.type = 'button';
      openJob.dataset.action = 'open-mj-job';
      openJob.title = jobUrl;
      openJob.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const token = sequence;
        openJob.disabled = true;
        status();
        try {
          const response = await window.lab.openBrowser(jobUrl);
          if (!response.ok) throw new Error(response.error);
        } catch (error) {
          if (token === sequence) status(error.message);
        } finally {
          if (token === sequence) openJob.disabled = false;
        }
      });
      moreSummary.append(openJob);
    }
    more.append(moreSummary, output);
    more.addEventListener('toggle', async () => {
      if (!more.open || output.dataset.loaded === 'true') return;
      const token = sequence;
      output.textContent = '正在读取…';
      try {
        const text = await getDetails(token);
        if (token !== sequence) return;
        output.textContent = text;
        output.dataset.loaded = 'true';
      } catch (error) {
        if (token === sequence) output.textContent = error.message;
      }
    });
    body.append(more);
  };
  const load = async (force = false) => {
    const token = ++sequence,
      asset = current;
    info = null;
    detailText = null;
    detailPending = null;
    body.replaceChildren(element('p', '正在读取图片信息…'));
    status();
    copy.disabled = copyAll.disabled = retry.disabled = true;
    try {
      const r = await window.lab.imageInfo(asset.id, { force });
      if (token !== sequence || !isOpen()) return;
      if (!r.ok) throw new Error(r.error);
      info = r.value;
      setVisible(
        info.status === 'done' &&
          (/midjourney/i.test(info.brand || '') || Boolean(midjourneyJobUrl(info)))
      );
      render(info);
      copy.disabled = !info.fullText;
      copyAll.disabled = info.status !== 'done';
      status(info.cacheWarning);
      if (!inline || force)
        window.dispatchEvent(new CustomEvent('image-info-updated', { detail: info }));
    } catch (error) {
      if (token !== sequence) return;
      body.replaceChildren(element('p', '图片信息读取失败。'));
      status(error.message);
    } finally {
      if (token === sequence) retry.disabled = false;
    }
  };
  const copyText = async (all) => {
    const token = sequence;
    try {
      const text = all ? await getDetails(token) : info.fullText;
      if (token !== sequence) return;
      const r = await window.lab.copyText(text);
      if (token === sequence) status(r.ok ? '已复制。' : r.error);
    } catch (error) {
      if (token === sequence) status(error.message);
    }
  };
  copy.addEventListener('click', () => void copyText(false));
  copyAll.addEventListener('click', () => void copyText(true));
  retry.addEventListener('click', () => void load(true));
  return {
    element: dialog,
    show(asset) {
      current = asset;
      file.textContent = asset.fileName || asset.name;
      file.title = file.textContent;
      if (!inline && !dialog.open) dialog.showModal();
      void load();
    },
    setAsset(asset) {
      const nextKey = asset ? [asset.id, asset.state, asset.bytes].join(':') : '';
      if (nextKey === assetKey) return;
      assetKey = nextKey;
      dismissDialog();
      if (asset?.kind === 'image' && asset.state === 'done') this.show(asset);
    },
    update(value) {
      if (!inline || !current || value.assetId !== current.id) return;
      sequence++;
      info = value;
      detailText = detailPending = null;
      setVisible(
        value.status === 'done' &&
          (/midjourney/i.test(value.brand || '') || Boolean(midjourneyJobUrl(value)))
      );
      render(value);
      copy.disabled = !value.fullText;
      copyAll.disabled = value.status !== 'done';
      retry.disabled = false;
      status(value.cacheWarning);
    },
    close: dismissDialog,
    dispose: dismissDialog
  };
}
export function createImageInfoDialog() {
  return createImageInfoPanel();
}
export function createReaderImageInfo(onVisibilityChange) {
  return createImageInfoPanel({ inline: true, onVisibilityChange });
}
