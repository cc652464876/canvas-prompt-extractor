'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { ProjectStore, WORK_INFO } = require('../../src/project-store.cjs');
const { inspectWork } = require('../../src/platforms/liblib/reader.cjs');
const { normalize } = require('../../src/normalize.cjs');
const { workInfoText } = require('../../src/export/work-info.cjs');
const metadata = {
  platform: 'liblib',
  inputUrl: 'https://www.liblib.tv/detail/current',
  title: '作品',
  author: '作者',
  workInfo: {
    followerCount: 0,
    followingCount: 2,
    isFollowing: false,
    likeCount: 0,
    isLiked: false,
    description: '作品描述\n第二行'
  }
};
function result() {
  return normalize(
    {
      nodes: [
        {
          id: 'text/1',
          type: 'text',
          data: { name: '../文本:*', content: '正文\n  原样缩进 <script>不是代码</script>' }
        },
        { id: 'text2', type: 'text', data: { name: '../文本:*', content: '另一段正文' } }
      ],
      edges: []
    },
    structuredClone(metadata)
  );
}
async function storeFor(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'work-info-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('work-info-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return new ProjectStore(root);
}
test('Download-first and prompt-first folders contain one info Markdown, with zero and false retained', async (t) => {
  for (const documents of [false, true]) {
    const store = await storeFor(t);
    await store.create(result(), { kinds: ['text'] }, documents);
    let info = await fs.readFile(path.join(store.directory, WORK_INFO), 'utf8');
    assert.match(info, /作品网址：https:\/\/www.liblib.tv\/detail\/current/);
    assert.match(info, /粉丝数：0/);
    assert.match(info, /是否关注作者：否/);
    assert.match(info, /点赞数量：0/);
    assert.match(info, /作品描述：作品描述\n  第二行/);
    await store.save();
    await store.checkpoint();
    assert.equal(
      (await fs.readdir(store.directory)).filter((name) => name === WORK_INFO).length,
      1
    );
    store.result.metadata.workInfo.likeCount = 3;
    await store.checkpoint();
    info = await fs.readFile(path.join(store.directory, WORK_INFO), 'utf8');
    assert.match(info, /点赞数量：3/);
  }
});
test('Individual text export preserves exact body, distinct safe filenames and existing prompt documents', async (t) => {
  const store = await storeFor(t);
  await store.create(result(), { kinds: ['text'], split: true }, false);
  const first = await store.saveText('text/1');
  assert.equal(path.basename(first.savedText), first.savedText);
  assert.equal(
    await fs.readFile(path.join(store.directory, first.savedText), 'utf8'),
    store.result.entries[0].prompt
  );
  assert.equal(
    (await fs.readdir(store.directory)).filter((name) => name.endsWith('.md') && name !== WORK_INFO)
      .length,
    0
  );
  const second = await store.saveText('text2');
  assert.notEqual(first.savedText, second.savedText);
  await store.save();
  assert.equal(store.documents.length, 2);
  assert.equal(
    await fs.readFile(path.join(store.directory, first.savedText), 'utf8'),
    store.result.entries[0].prompt
  );
  await assert.rejects(store.saveText('missing'), /没有可保存/);
  const loaded = new ProjectStore(store.root);
  await loaded.load(store.directory);
  await fs.unlink(path.join(store.directory, WORK_INFO));
  await loaded.checkpoint();
  assert.match(await fs.readFile(path.join(store.directory, WORK_INFO), 'utf8'), /作品名称：作品/);
});
test('Legacy missing info stays unknown, never fabricated as zero or false', () => {
  const text = workInfoText({ platform: 'liblib', title: '旧作品', inputUrl: metadata.inputUrl });
  assert.match(text, /粉丝数：未读取/);
  assert.match(text, /是否关注作者：未读取/);
  assert.match(text, /点赞数量：未读取/);
});
test('Detail metadata is scoped to this work, independent of downloadable final video', () => {
  const visible = (extra) => ({ getClientRects: () => [{}], ...extra });
  const buttons = [
    visible({ innerText: '作者\n1.2万\n粉丝数\n0\n关注' }),
    visible({ innerText: '已关注' })
  ];
  const region = visible({
    children: [{}, { innerText: '抖音原创作者' }],
    querySelector: (selector) => (selector === 'button' ? buttons[0] : null),
    querySelectorAll: () => buttons
  });
  const stage = {
    __reactFiber_test: {
      memoizedProps: {
        project: {
          templateUuid: 'current',
          name: '本作品',
          nickname: '作者',
          ownerUuid: 'a'.repeat(32),
          finalOutput: 'blob:invalid',
          description: '本作品描述',
          likeCount: 0,
          isLike: false,
          updateAt: '原始更新时间',
          tags: [{ tagLabel: '短片' }]
        },
        items: [{ templateUuid: 'other', likeCount: 99999 }]
      },
      return: null
    }
  };
  const run = () =>
    vm.runInNewContext('(' + inspectWork.toString() + ')()', {
      URL,
      location: { href: metadata.inputUrl, pathname: '/detail/current', protocol: 'https:' },
      document: {
        body: {
          innerText: '注册/登录\n更新时间: 2026年09月10日 13:16\n含 AI 生成内容\n精选推荐\n其他作品'
        },
        querySelectorAll: () => [],
        querySelector: (selector) =>
          selector === '[aria-label="作者信息"]'
            ? region
            : selector === '[data-project-detail-stage]'
              ? stage
              : null
      }
    });
  const work = run();
  assert.equal(work.fullVideo, undefined);
  assert.equal(work.workInfo.authorUrl, 'https://www.liblib.tv/profile?uuid=' + 'a'.repeat(32));
  assert.equal(work.workInfo.followerCount, 12000);
  assert.equal(work.workInfo.followingCount, 0);
  assert.equal(work.workInfo.isFollowing, true);
  assert.equal(work.workInfo.likeCount, 0);
  assert.equal(work.workInfo.description, '本作品描述');
  assert.equal(work.workInfo.updatedAt, '2026年09月10日 13:16');
  assert.equal(work.workInfo.authorBio, '抖音原创作者');
  assert.equal(work.workInfo.containsAI, true);
  assert.equal(work.workInfo.accountState, '未登录页面');
  assert.ok(work.workInfo.capturedAt);
  stage.__reactFiber_test.memoizedProps.project.templateUuid = 'other';
  assert.equal(run().workInfo.description, undefined);
  assert.equal(run().workInfo.authorUrl, undefined);
});
