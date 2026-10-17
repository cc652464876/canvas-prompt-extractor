'use strict';
const { pathToFileURL } = require('node:url');
const { safeUrl } = require('../assets.cjs');
const { fetchMedia, prepareMedia } = require('../download-queue.cjs');
const { createFrameLimiter } = require('../media-policy.cjs');
const { createMediaFetcher } = require('./media-fetcher.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function createMediaProtocol({
  protocol,
  net,
  session,
  getContext,
  cachedThumbnailPath,
  diagnostic = false
}) {
  const { frameRange, boundedFrame } = createFrameLimiter();
  let previewTail = Promise.resolve(),
    previewNext = 0;
  function installMediaProtocol() {
    protocol.handle('labmedia', async (request) => {
      try {
        if (getContext().browserResetting)
          return new Response('Browser resetting', { status: 503 });
        const context = getContext(),
          generation = context.browserGeneration;
        const { currentResult, store, currentLocalProject } = context;
        const previewSignal = AbortSignal.any([request.signal, context.browserPreviewAbort.signal]);
        const u = new URL(request.url),
          id = u.pathname.slice(1),
          asset = currentResult?.assets.find((a) => a.id === id);
        if (!asset) return new Response('Not found', { status: 404 });
        if (u.hostname === 'thumbnail') {
          if (asset.kind !== 'video') return new Response('No thumbnail', { status: 404 });
          try {
            return net.fetch(pathToFileURL(await cachedThumbnailPath(asset)).href, {
              signal: previewSignal
            });
          } catch {
            return new Response('No thumbnail', { status: 404 });
          }
        }
        if (u.hostname === 'local') {
          if (asset.state !== 'done') return new Response('Not downloaded', { status: 404 });
          const headers = {};
          if (request.headers.has('range')) headers.Range = request.headers.get('range');
          const local = await net.fetch(pathToFileURL(store.assetPath(asset)).href, {
            headers,
            signal: previewSignal
          });
          const forwarded = new Headers(local.headers);
          forwarded.set('Access-Control-Allow-Origin', '*');
          return new Response(local.body, { status: local.status, headers: forwarded });
        }
        if (currentLocalProject)
          return new Response('Local project has no online previews', { status: 403 });
        if (getContext().mode !== 'full') return new Response('Preview disabled', { status: 403 });
        const mediaFetcher = createMediaFetcher({ session, metadata: currentResult.metadata });
        const isPreview = u.hostname === 'preview';
        if (!isPreview && u.hostname !== 'stream' && u.hostname !== 'frame')
          return new Response('Not found', { status: 404 });
        const candidateIndex = u.searchParams.has('index')
          ? Number(u.searchParams.get('index'))
          : null;
        if (
          candidateIndex !== null &&
          (!Number.isInteger(candidateIndex) ||
            candidateIndex < 0 ||
            candidateIndex >= Math.min(3, asset.previewUrls?.length || 0))
        )
          return new Response('Not found', { status: 404 });
        const url = safeUrl(
          isPreview
            ? candidateIndex === null
              ? asset.previewUrl
              : asset.previewUrls[candidateIndex]
            : asset.url
        );
        if (!url) return new Response('Unavailable', { status: 404 });
        if (u.hostname === 'frame') {
          // Only video sampling is spaced; image previews share four renderer slots.
          const next = previewTail
            .catch(() => {})
            .then(async () => {
              const delay = Math.max(0, previewNext - Date.now());
              if (delay) await wait(delay);
              previewNext = Date.now() + 1000;
            });
          previewTail = next;
          await next;
          if (getContext().mode !== 'full')
            return new Response('Preview disabled', { status: 403 });
        }
        const headers = {};
        let range = request.headers.get('range');
        if (u.hostname === 'frame') {
          range = await frameRange(asset.id, range);
        }
        if (range) headers.Range = range;
        if (getContext().browserResetting || generation !== getContext().browserGeneration)
          return new Response('Browser resetting', { status: 503 });
        const r = await fetchMedia(mediaFetcher, url, {
          credentials: 'include',
          headers,
          signal: AbortSignal.any([
            previewSignal,
            AbortSignal.timeout(u.hostname === 'frame' ? 12000 : 45000)
          ])
        });
        if (!r.ok) {
          await r.body?.cancel();
          return new Response('Media unavailable', { status: 502 });
        }
        const partialRange =
          r.status === 206 && !/^bytes 0-/.test(r.headers.get('content-range') || '');
        const input =
          u.hostname === 'frame'
            ? new Response(await boundedFrame(asset.id, r, r.body), {
                status: r.status,
                headers: r.headers
              })
            : r;
        const media = await prepareMedia(input, isPreview ? { ...asset, kind: 'image' } : asset, {
          partialRange
        });
        const stream = media.stream;
        const forwarded = new Headers();
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges'])
          if (r.headers.has(name)) forwarded.set(name, r.headers.get(name));
        forwarded.set('Access-Control-Allow-Origin', '*');
        forwarded.set('Access-Control-Expose-Headers', 'content-range,content-length');
        forwarded.set('content-type', media.contentType);
        forwarded.set('Cache-Control', 'private, max-age=300');
        return new Response(stream, { status: r.status, headers: forwarded });
      } catch (e) {
        if (diagnostic && request.url.includes('://frame/'))
          console.log('Frame request failed:', e.message);
        return new Response('Media unavailable', { status: 502 });
      }
    });
  }
  return { install: installMediaProtocol };
}
module.exports = { createMediaProtocol };
