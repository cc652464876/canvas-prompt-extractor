'use strict';
const {
  HOSTS,
  socialAddress,
  publicUrl,
  readLiblibProfile,
  attachAuthorProfiles
} = require('../author-profiles.cjs');
const { profileAddress } = require('../platforms/liblib/profile.cjs');
const { readSocialProfile } = require('../social-profile-page.cjs');
const { boundedRead } = require('../read-deadline.cjs');
const { beginTransparentRead } = require('../platform-presentation.cjs');
const HOMES = {
  xiaohongshu: 'https://www.xiaohongshu.com',
  douyin: 'https://www.douyin.com',
  bilibili: 'https://www.bilibili.com'
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class AuthorProfiles {
  constructor({ fetcher, createWindow, resolveFetcher = fetcher, enabled = false }) {
    this.fetcher = fetcher;
    this.createWindow = createWindow;
    this.resolveFetcher = resolveFetcher;
    this.cache = new Map();
    this.windows = new Set();
    this.controller = new AbortController();
    this.enabled = enabled === true;
  }
  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled === true;
    this.controller.abort();
    this.controller = new AbortController();
    this.cache.clear();
  }
  linksOnly(bundle) {
    return {
      ...bundle,
      socialLinks: (bundle.socialLinks || []).map((link) => ({
        ...(socialAddress(link.originalUrl || link.profileUrl, link.platform) || {
          platform: link.platform,
          originalUrl: link.originalUrl,
          status: 'invalid'
        }),
        ...(link.status === 'invalid'
          ? {}
          : {
              status: 'link-only',
              note: '未开启社交主页资料读取，仅记录作者填写的分享链接'
            })
      }))
    };
  }
  async resolve(link, signal) {
    let current = link;
    for (let index = 0; index < 4 && !current.userId; index++) {
      const response = await this.resolveFetcher(current.profileUrl, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(4000)])
      });
      const location = response.headers.get('location');
      void response.body?.cancel().catch(() => {});
      if (!location) break;
      const next = socialAddress(new URL(location, current.profileUrl).href, current.platform);
      if (!next || next.platform !== current.platform) break;
      current = { ...next, originalUrl: link.originalUrl };
    }
    return current;
  }
  async page(link, signal) {
    const window = this.createWindow(link.platform);
    this.windows.add(window);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guardNavigation = (event, url) => {
      try {
        if (!HOSTS[link.platform].includes(new URL(url).hostname)) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    };
    window.webContents.on('will-navigate', guardNavigation);
    window.webContents.on('will-redirect', guardNavigation);
    beginTransparentRead(window);
    let loadError = '',
      latest = null,
      seen = 0;
    void window.loadURL(link.profileUrl).catch((error) => {
      loadError = error.code || error.message;
    });
    try {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await boundedRead(() => wait(650), { signal, timeoutMs: 800 });
        if (!/^https?:/.test(window.webContents.getURL())) continue;
        let request = link;
        const resolved = socialAddress(window.webContents.getURL(), link.platform);
        if (resolved?.userId) request = { ...resolved, originalUrl: link.originalUrl };
        try {
          const value = await boundedRead(
            () =>
              window.webContents.mainFrame.executeJavaScript(
                '(' + readSocialProfile.toString() + ')(' + JSON.stringify(request) + ')'
              ),
            { signal, timeoutMs: 1500 }
          );
          latest = { ...request, ...value };
          if (value.displayName) {
            seen++;
          }
          if (
            value.accessBlocked ||
            value.note ||
            (seen >= 3 && link.platform !== 'douyin') ||
            (value.displayName && Object.keys(value.metrics || {}).length >= 3)
          )
            return { ...request, ...value };
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }
      return (
        latest || {
          ...link,
          note: loadError
            ? '公开页面加载失败，链接已保留'
            : '公开页面未提供可读取的用户资料；可登录后重试'
        }
      );
    } finally {
      this.windows.delete(window);
      if (!window.isDestroyed()) window.destroy();
    }
  }
  async link(original, signal) {
    const capturedAt = new Date().toISOString();
    if (['link-only', 'invalid'].includes(original.status)) return { ...original, capturedAt };
    let link = original;
    try {
      if (!link.userId) link = await this.resolve(link, signal);
      const value = await this.page(link, signal);
      const metrics = Object.fromEntries(
        Object.entries(value.metrics || {}).filter(([, v]) =>
          ['number', 'string'].includes(typeof v)
        )
      );
      const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
      return {
        ...link,
        profileUrl: value.profileUrl || link.profileUrl,
        userId: value.userId || link.userId,
        displayName,
        bio: typeof value.bio === 'string' ? value.bio : '',
        accountId: value.accountId || '',
        avatarUrl: publicUrl(value.avatarUrl),
        location: value.location || '',
        metrics,
        capturedAt,
        status: displayName ? (!Object.keys(metrics).length ? 'partial' : 'read') : 'unavailable',
        note:
          value.note ||
          (value.loginRequired && !displayName
            ? '页面显示登录提示，尚未读到作者公开资料；链接已保留'
            : value.loginOverlayPresent && displayName
              ? '页面有登录弹窗，已读取弹窗后方加载的公开作者资料'
              : !displayName
                ? '公开页面未提供可读取的用户资料'
                : '')
      };
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        ...link,
        capturedAt,
        status: 'unavailable',
        note: '用户资料暂未读到，作者填写的链接已保留；可登录后重新读取'
      };
    }
  }
  async bundle(bundle, signal, { force = false } = {}) {
    if (!bundle) return bundle;
    if (!this.enabled) return this.linksOnly(bundle);
    const combined = AbortSignal.any([
      signal || new AbortController().signal,
      this.controller.signal
    ]);
    const socialLinks = [];
    if (force)
      for (const link of bundle.socialLinks || [])
        this.cache.delete(link.profileUrl || link.originalUrl);
    // Bound the number of simultaneous real browser windows.
    try {
      for (let index = 0; index < (bundle.socialLinks || []).length; index += 2) {
        socialLinks.push(
          ...(await Promise.all(
            bundle.socialLinks.slice(index, index + 2).map(async (link) => {
              const key = link.profileUrl || link.originalUrl;
              if (!this.cache.has(key))
                this.cache.set(
                  key,
                  this.link(link, combined).catch((error) => {
                    this.cache.delete(key);
                    throw error;
                  })
                );
              const value = await this.cache.get(key);
              return { ...value, originalUrl: link.originalUrl };
            })
          ))
        );
      }
    } catch (error) {
      if (!this.enabled && !signal?.aborted) return this.linksOnly(bundle);
      throw error;
    }
    if (!this.enabled) return this.linksOnly(bundle);
    return { ...bundle, socialLinks };
  }
  async enrichResult(result, signal) {
    if (result.metadata.platform !== 'liblib') return result;
    const address = profileAddress(result.metadata.workInfo?.authorUrl);
    if (!address) return result;
    const key = 'liblib|' + address.uuid;
    try {
      if (!this.cache.has(key))
        this.cache.set(
          key,
          readLiblibProfile(address, this.fetcher, signal).catch((error) => {
            this.cache.delete(key);
            throw error;
          })
        );
      const raw = await this.cache.get(key);
      return attachAuthorProfiles(result, await this.bundle(raw, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      return result;
    }
  }
  dispose() {
    this.controller.abort();
    for (const window of this.windows) if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
    this.cache.clear();
  }
}
module.exports = { AuthorProfiles, HOMES };
