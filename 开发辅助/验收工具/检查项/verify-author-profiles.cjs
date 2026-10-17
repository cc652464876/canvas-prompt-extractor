'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { readLiblibProfile, attachAuthorProfiles } = require('../../../src/author-profiles.cjs');
const { ProjectStore, WORK_INFO } = require('../../../src/project-store.cjs');
module.exports = async ({ root, ui, authorProfiles }) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3/author-profiles');
  await fs.mkdir(out, { recursive: true });
  const ids = [
    'ef78b3807d1a48b7ab94eef5852bc286',
    '2af01e2cf4c141d5a25cef40a9030dd6',
    '30adc6dff51248ae9b49c567281f736e',
    '95b94ab9925d4690a738c3f8abf70957'
  ];
  const report = { passed: false, authors: [] };
  try {
    // Live diagnostic explicitly opts in; ordinary app startup remains off.
    authorProfiles.setEnabled(true);
    for (const uuid of ids) {
      const address = { uuid, url: 'https://www.liblib.tv/profile?uuid=' + uuid };
      console.log('Reading public author profile:', uuid);
      const bundle = await authorProfiles.bundle(
        await readLiblibProfile(address, authorProfiles.fetcher, new AbortController().signal),
        new AbortController().signal,
        { force: true }
      );
      assert.equal(bundle.profile.status, 'read');
      assert.ok(bundle.socialLinks.length > 0);
      const result = attachAuthorProfiles(
        {
          schemaVersion: 2,
          metadata: {
            platform: 'liblib',
            title: '作者资料导出示例',
            author: bundle.profile.displayName,
            inputUrl: address.url,
            workIdentity: 'author-profile-example:' + uuid
          },
          entries: [],
          assets: [],
          edges: [],
          nodeSummaries: [],
          diagnostics: {
            source: 'public-profile-verification',
            warnings: [],
            counts: {},
            nodeCount: 0
          }
        },
        bundle
      );
      const store = new ProjectStore(path.join(out, 'examples'));
      await store.create(result, {}, false);
      const markdown = await fs.readFile(path.join(store.directory, WORK_INFO), 'utf8');
      assert.equal(WORK_INFO, '作品信息.md');
      for (const link of bundle.socialLinks)
        assert.ok(
          markdown.includes(link.profileUrl.replace(/&/g, '&amp;')) ||
            markdown.includes(link.originalUrl.replace(/&/g, '&amp;'))
        );
      assert.doesNotMatch(JSON.stringify(result.metadata), /"mobile"/);
      const loaded = new ProjectStore(path.join(out, 'examples'));
      await loaded.load(store.directory);
      assert.deepEqual(loaded.result.metadata.authorProfiles, result.metadata.authorProfiles);
      report.authors.push({
        url: address.url,
        name: bundle.profile.displayName,
        libtv: bundle.profile,
        accounts: bundle.socialLinks,
        markdownFile: path.join(store.directory, WORK_INFO)
      });
      console.log(
        'PASS Saved author links and public profile status:',
        bundle.profile.displayName,
        JSON.stringify(
          bundle.socialLinks.map((link) => ({
            platform: link.platform,
            name: link.displayName,
            status: link.status,
            userId: link.userId
          }))
        )
      );
    }
    assert.equal(authorProfiles.windows.size, 0);
    assert.equal(
      await ui.webContents.executeJavaScript(
        'document.querySelectorAll("[data-social-login]").length'
      ),
      3
    );
    await ui.webContents.executeJavaScript('document.getElementById("theme-toggle").click()');
    assert.equal(
      await ui.webContents.executeJavaScript('document.getElementById("appearance-dialog").open'),
      true
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fs.writeFile(
      path.join(out, 'settings.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    throw error;
  } finally {
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
};
