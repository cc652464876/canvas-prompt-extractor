'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..'),
  previous = path.resolve(root, '../自由画布提取_v1.2');
(async () => {
  const rows = JSON.parse(
    await fs.readFile(path.join(root, '开发辅助/验收记录/v1.2-preservation.json'), 'utf8')
  );
  const changed = [];
  for (const row of rows) {
    const file = path.resolve(previous, row.path);
    if (!file.startsWith(previous + path.sep)) throw new Error('Invalid preservation path');
    const bytes = await fs.readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) changed.push(row.path);
  }
  const report = { passed: !changed.length, checkedFiles: rows.length, changed };
  await fs.writeFile(
    path.join(root, '开发辅助/验收记录/v1.2-preservation-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report));
  if (changed.length) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
