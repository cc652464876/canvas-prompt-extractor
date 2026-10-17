'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  vm = require('node:vm');
const {
  liblibProfile,
  socialAddress,
  attachAuthorProfiles
} = require('../../src/author-profiles.cjs');
const { readSocialProfile } = require('../../src/social-profile-page.cjs');
const { AuthorProfiles } = require('../../src/services/author-profiles.cjs');
const { workInfoMarkdown } = require('../../src/export/work-info.cjs');
const { ProjectStore, WORK_INFO } = require('../../src/project-store.cjs');
const uuid = 'a'.repeat(32),
  address = { uuid, url: 'https://www.liblib.tv/profile?uuid=' + uuid };
function data() {
  return {
    userDetail: {
      nickname: 'LibTV 作者',
      mobile: 'private-phone-must-not-export',
      personalSpaceInformation: {
        briefIntroduction: '公开简介',
        xiaohongshuLink: 'https://www.xiaohongshu.com/user/profile/611a3eb6000000000101dc1f',
        tiktokLink: '分享账号 https://v.douyin.com/abcd/ 复制这段文字',
        bliLink: 'https://space.bilibili.com/482998334',
        otherLink: 'https://www.zcool.com.cn/u/19074343'
      }
    },
    counter: { followerCount: 0, followCount: 12, likeCount: 0 }
  };
}
test('Public author metadata preserves all published links and omits private API fields', () => {
  const bundle = liblibProfile(data(), address);
  assert.equal(bundle.profile.metrics.followers, 0);
  assert.deepEqual(
    bundle.socialLinks.map((link) => link.platform),
    ['xiaohongshu', 'douyin', 'bilibili', 'other']
  );
  assert.equal(bundle.socialLinks[1].profileUrl, 'https://v.douyin.com/abcd/');
  assert.equal(
    bundle.socialLinks[1].originalUrl,
    data().userDetail.personalSpaceInformation.tiktokLink
  );
  assert.doesNotMatch(JSON.stringify(bundle), /private-phone|mobile/);
});
test('Social URL validation rejects misleading hosts, credentials and invalid schemes', () => {
  for (const value of [
    'javascript:alert(1)',
    'https://space.bilibili.com.evil.test/123',
    'https://user:pass@space.bilibili.com/123'
  ])
    assert.equal(socialAddress(value, 'bilibili'), null);
  const dy = socialAddress('https://www.iesdouyin.com/share/user/MS4w.test?did=secret', 'douyin');
  assert.equal(dy.userId, '');
  const valid = socialAddress(
    'https://www.iesdouyin.com/share/user/MS4wLjAB_example?did=temporary',
    'douyin'
  );
  assert.equal(valid.profileUrl, 'https://www.douyin.com/user/MS4wLjAB_example');
});
test('Attaching profile data retains work statistics and keeps each platform identity independent', () => {
  const original = {
    metadata: {
      platform: 'liblib',
      author: '作品作者',
      workInfo: { likeCount: 5, isFollowing: false }
    },
    entries: [],
    assets: []
  };
  const bundle = liblibProfile(data(), address);
  bundle.socialLinks[0].displayName = '另一个平台昵称';
  const attached = attachAuthorProfiles(original, bundle);
  assert.equal(attached.metadata.workInfo.likeCount, 5);
  assert.equal(attached.metadata.workInfo.isFollowing, false);
  assert.equal(attached.metadata.workInfo.followerCount, 0);
  assert.equal(attached.metadata.authorProfiles[1].displayName, '另一个平台昵称');
  assert.equal(original.metadata.authorProfiles, undefined);
});
test('Markdown contains platform sections, original share text, zero values and explicit unread states', () => {
  const bundle = liblibProfile(data(), address);
  bundle.socialLinks[0] = { ...bundle.socialLinks[0], status: 'unavailable', note: '页面要求登录' };
  const metadata = attachAuthorProfiles(
    { metadata: { platform: 'liblib', title: '测试作品', workInfo: { isFollowing: false } } },
    bundle
  ).metadata;
  const markdown = workInfoMarkdown(metadata);
  for (const section of ['LibTV', '小红书', '抖音', 'B站', '其他网站'])
    assert.ok(markdown.includes('### ' + section));
  assert.match(markdown, /粉丝数：0/);
  assert.match(markdown, /是否关注作者：否/);
  assert.match(markdown, /作者填写原文：分享账号/);
  assert.match(markdown, /读取说明：页面要求登录/);
  assert.doesNotMatch(markdown, /private-phone/);
  assert.match(workInfoMarkdown({ platform: 'liblib' }), /### 小红书\r\n\r\n- 资料状态：未读取/);
  assert.doesNotMatch(workInfoMarkdown({ title: '<script>alert(1)</script>' }), /<script>/);
});
test('Short link resolution validates every redirect and canonicalizes public user URLs', async () => {
  const service = new AuthorProfiles({
    fetcher: async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://www.iesdouyin.com/share/user/MS4wLjAB_example?did=temporary' }
      })
  });
  const link = socialAddress('https://v.douyin.com/share/', 'douyin');
  const resolved = await service.resolve(link, new AbortController().signal);
  assert.equal(resolved.profileUrl, 'https://www.douyin.com/user/MS4wLjAB_example');
  service.resolveFetcher = async () =>
    new Response(null, { status: 302, headers: { location: 'https://unrelated.test/private' } });
  assert.equal(
    (await service.resolve(link, new AbortController().signal)).profileUrl,
    link.profileUrl
  );
});
test('Shared social URLs use one read and preserve each author supplied original value', async () => {
  const service = new AuthorProfiles({
    enabled: true,
    fetcher: () => {
      throw new Error('unexpected network');
    }
  });
  let reads = 0;
  service.page = async (link) => {
    reads++;
    await new Promise((resolve) => setImmediate(resolve));
    return { ...link, displayName: '账号', metrics: { followers: 0 }, bio: '简介' };
  };
  const link = socialAddress('https://space.bilibili.com/123');
  const enriched = await service.bundle(
    { socialLinks: [link, { ...link, originalUrl: '主页 ' + link.profileUrl }] },
    new AbortController().signal,
    { force: true }
  );
  assert.equal(reads, 1);
  assert.equal(enriched.socialLinks[1].originalUrl, '主页 ' + link.profileUrl);
  assert.equal(enriched.socialLinks[0].metrics.followers, 0);
  await service.bundle({ socialLinks: [link] }, new AbortController().signal);
  assert.equal(reads, 1);
});
test('Social page access defaults off, including short redirects and previously enriched bundles', async () => {
  const service = new AuthorProfiles({
    fetcher: () => {
      throw new Error('External fetch must not happen');
    },
    createWindow: () => {
      throw new Error('External window must not open');
    }
  });
  const source = liblibProfile(data(), address);
  source.socialLinks[0].displayName = 'cached external nickname';
  source.socialLinks[0].metrics = { followers: 123 };
  source.socialLinks[0].status = 'read';
  const value = await service.bundle(source, new AbortController().signal, { force: true });
  assert.equal(value.profile.displayName, 'LibTV 作者');
  assert.equal(value.socialLinks[1].profileUrl, 'https://v.douyin.com/abcd/');
  assert.equal(value.socialLinks[1].originalUrl, source.socialLinks[1].originalUrl);
  assert.equal(value.socialLinks[0].status, 'link-only');
  assert.equal(value.socialLinks[0].displayName, undefined);
  assert.equal(value.socialLinks[0].metrics, undefined);
  assert.match(
    workInfoMarkdown(attachAuthorProfiles({ metadata: {} }, value).metadata),
    /已记录链接/
  );
});
test('Disabling social enrichment cancels an active external read and returns original links', async () => {
  const service = new AuthorProfiles({ enabled: true, fetcher: fetch });
  const link = socialAddress('https://space.bilibili.com/123');
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  service.page = async (_link, signal) => {
    started();
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    );
  };
  const pending = service.bundle({ socialLinks: [link] }, new AbortController().signal);
  await ready;
  service.setEnabled(false);
  const value = await pending;
  assert.equal(value.socialLinks[0].status, 'link-only');
  assert.equal(value.socialLinks[0].profileUrl, link.profileUrl);
});
test('A single work still receives LibTV metadata with external enrichment disabled', async () => {
  const requests = [];
  const service = new AuthorProfiles({
    fetcher: async (url) => {
      requests.push(url);
      assert.match(url, /^https:\/\/www\.liblib\.tv\/api\//);
      return new Response(JSON.stringify({ code: 0, data: data() }), {
        headers: { 'content-type': 'application/json' }
      });
    },
    createWindow: () => {
      throw new Error('Unexpected external page');
    }
  });
  const result = await service.enrichResult(
    { metadata: { platform: 'liblib', workInfo: { authorUrl: address.url } } },
    new AbortController().signal
  );
  assert.equal(requests.length, 1);
  assert.equal(result.metadata.authorProfiles[0].displayName, 'LibTV 作者');
  assert.equal(result.metadata.authorProfiles[2].profileUrl, 'https://v.douyin.com/abcd/');
  assert.equal(result.metadata.authorProfiles[2].status, 'link-only');
});
test('Public owner data behind a login overlay is a successful read', async () => {
  const service = new AuthorProfiles({ enabled: true, fetcher: fetch });
  service.page = async () => ({
    displayName: '抖音作者',
    loginRequired: true,
    loginOverlayPresent: true,
    metrics: { followers: '32', following: '187', likes: '95' }
  });
  const value = await service.link(
    socialAddress('https://www.douyin.com/user/MS4wLjAB_example'),
    new AbortController().signal
  );
  assert.equal(value.status, 'read');
  assert.match(value.note, /已读取弹窗后方/);
});
test('Social enrichment preference defaults off and survives both enabled and disabled saves', async () => {
  const { readSocialPreference, saveSocialPreference } = require('../../src/social-preference.cjs');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'social-preference-'));
  const file = path.join(folder, 'preference.json');
  assert.equal(readSocialPreference(file), false);
  await saveSocialPreference(file, true);
  assert.equal(readSocialPreference(file), true);
  await saveSocialPreference(file, false);
  assert.equal(readSocialPreference(file), false);
  await fs.writeFile(file, '{"enabled":"true"}');
  assert.equal(readSocialPreference(file), false);
  await fs.writeFile(file, 'corrupted');
  assert.equal(readSocialPreference(file), false);
});
function readPage(request, { url, window = {}, title = '', selectors = {}, body = '' } = {}) {
  const context = {
    window,
    location: new URL(url),
    document: {
      title,
      body: { innerText: body },
      querySelector: (selector) => selectors[selector] || null
    }
  };
  return JSON.parse(
    JSON.stringify(
      vm.runInNewContext(
        '(' + readSocialProfile.toString() + ')(' + JSON.stringify(request) + ')',
        context
      )
    )
  );
}
test('Xiaohongshu reads the profile owner rather than the logged-in viewer and respects login redirects', () => {
  const link = socialAddress(data().userDetail.personalSpaceInformation.xiaohongshuLink);
  const owner = {
    basicInfo: { userId: link.userId, nickname: '主页作者', redId: '123', desc: '简介' },
    interactions: [
      { type: 'fans', count: 0 },
      { type: 'follows', count: 73 },
      { type: 'interaction', count: '3.7万' }
    ]
  };
  const value = readPage(link, {
    url: link.profileUrl,
    window: {
      __INITIAL_STATE__: { user: { userInfo: { nickname: '登录者' }, userPageData: owner } }
    }
  });
  assert.equal(value.displayName, '主页作者');
  assert.equal(value.metrics.followers, 0);
  assert.equal(value.metrics.likes, '3.7万');
  const redirected = readPage(link, {
    url: 'https://www.xiaohongshu.com/login',
    window: { __INITIAL_STATE__: { user: { userInfo: { nickname: '登录者' } } } }
  });
  assert.equal(redirected.displayName, undefined);
  assert.equal(redirected.loginRequired, true);
});
test('Douyin and Bilibili profile readers retain account IDs, owner stats and available public metadata', () => {
  const link = socialAddress('https://www.douyin.com/user/MS4wLjAB_example');
  const root = {
    innerText: '抖音作者\n关注 187\n粉丝 32\n获赞 95\n抖音号：97693988107\nIP属地：广东',
    querySelector: (selector) =>
      selector === '[data-e2e="user-title"]' ? { innerText: '抖音作者' } : null
  };
  const dy = readPage(link, {
    url: link.profileUrl,
    selectors: { '[data-e2e="user-info"]': root }
  });
  assert.equal(dy.accountId, '97693988107');
  assert.equal(dy.metrics.followers, '32');
  assert.equal(dy.location, '广东');
  const gated = readPage(link, {
    url: link.profileUrl,
    body: '登录后免费畅享高清视频',
    selectors: { h1: { innerText: '登录后免费畅享高清视频' } }
  });
  assert.equal(gated.displayName, '');
  assert.equal(gated.loginRequired, true);
  const bili = socialAddress('https://space.bilibili.com/123');
  const value = readPage(bili, {
    url: bili.profileUrl,
    title: 'B站作者的个人空间-B站作者个人主页',
    body: '登录后你可以',
    selectors: {
      'meta[name="description"],meta[property="description"]': {
        content: '哔哩哔哩介绍，第一时间了解UP主动态。公开简介'
      }
    }
  });
  assert.equal(value.displayName, 'B站作者');
  assert.equal(value.bio, '公开简介');
  assert.equal(value.loginRequired, true);
  assert.deepEqual(value.metrics, {});
});
test('New projects write Markdown metadata and manifests retain social data; old TXT notes remain intact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-markdown-'));
  const bundle = liblibProfile(data(), address);
  const result = attachAuthorProfiles(
    {
      schemaVersion: 2,
      metadata: {
        platform: 'liblib',
        title: '作品',
        author: '作者',
        inputUrl: 'https://www.liblib.tv/detail/' + uuid
      },
      entries: [],
      assets: [],
      edges: [],
      nodeSummaries: [],
      diagnostics: { warnings: [], counts: {}, nodeCount: 0 }
    },
    bundle
  );
  const store = new ProjectStore(root);
  await store.create(result, {}, false);
  assert.equal(WORK_INFO, '作品信息.md');
  await assert.rejects(fs.stat(path.join(store.directory, '作品信息.txt')), { code: 'ENOENT' });
  const old = path.join(store.directory, '作品信息.txt');
  await fs.writeFile(old, '旧的用户备注');
  await store.checkpoint();
  assert.equal(await fs.readFile(old, 'utf8'), '旧的用户备注');
  await fs.writeFile(path.join(store.directory, WORK_INFO), '用户已有的 Markdown 备注');
  await store.checkpoint();
  const archived = (await fs.readdir(store.directory)).find(
    (name) => name.startsWith('历史_') && name.endsWith('__' + WORK_INFO)
  );
  assert.equal(
    await fs.readFile(path.join(store.directory, archived), 'utf8'),
    '用户已有的 Markdown 备注'
  );
  const loaded = new ProjectStore(root);
  await loaded.load(store.directory);
  assert.deepEqual(loaded.result.metadata.authorProfiles, result.metadata.authorProfiles);
  assert.equal(loaded.documents.includes(WORK_INFO), false);
});
