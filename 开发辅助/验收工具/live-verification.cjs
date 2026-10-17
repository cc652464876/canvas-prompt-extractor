'use strict';
const { verificationPath } = require('../../src/app-paths.cjs');
const fs = require('node:fs/promises');
const { resolvePlatform } = require('../../src/platforms/registry.cjs');
const { filename, markdown } = require('../../src/export/markdown.cjs');
module.exports = async ({ root, argv, runExtraction, ensureProject, createQueue }) => {
  const inputs = argv
    .filter((a) => a.startsWith('--verify-input='))
    .map((a) => a.slice('--verify-input='.length));
  if (!inputs.length)
    throw new Error(
      '实际平台验证需要 --verify-input=<HTTPS作品链接>，不使用私人历史作品作为默认样本。'
    );
  await fs.mkdir(verificationPath(root), { recursive: true });
  const report = [];
  for (const input of inputs) {
    const { platform } = resolvePlatform(input);
    try {
      const result = await runExtraction(input, {
        visible: argv.includes('--verify-visible'),
        mode: 'full'
      });
      await fs.writeFile(
        verificationPath(root, platform + '-snapshot.json'),
        JSON.stringify(result, null, 2)
      );
      await fs.writeFile(verificationPath(root, filename(result.metadata)), markdown(result));
      const record = {
        platform,
        passed: true,
        metadata: result.metadata,
        diagnostics: result.diagnostics
      };
      report.push(record);
      if (argv.includes('--verify-downloads')) {
        await ensureProject();
        const selected = ['image', 'video', 'audio']
          .map((k) => result.assets.find((a) => a.kind === k && a.url))
          .filter(Boolean);
        record.downloads = await createQueue().start(selected, ['image', 'video', 'audio']);
        record.passed = record.downloads.failed === 0 && record.downloads.done === selected.length;
      }
    } catch (error) {
      report.push({ platform, passed: false, error: error.message, code: error.code });
    }
  }
  await fs.writeFile(verificationPath(root, 'live-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  return report.every((r) => r.passed);
};
