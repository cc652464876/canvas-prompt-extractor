'use strict';
const { verificationPath } = require('../../src/app-paths.cjs');
const fs = require('node:fs/promises'),
  sync = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
async function verify() {
  const root = path.resolve(__dirname, '../..'),
    previous = path.resolve(root, '../升级版_v1.1');
  const records = JSON.parse(
    (await fs.readFile(verificationPath(root, 'v1.1-preservation.json'), 'utf8')).replace(
      /^\uFEFF/,
      ''
    )
  );
  const changed = [],
    missing = [];
  for (const record of records) {
    const file = path.resolve(previous, record.path);
    if (!file.startsWith(previous + path.sep)) throw new Error('Invalid preservation path');
    try {
      const hash = createHash('sha256');
      for await (const chunk of sync.createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex').toUpperCase() !== record.sha256) changed.push(record.path);
    } catch (error) {
      if (error.code === 'ENOENT') missing.push(record.path);
      else throw error;
    }
  }
  const report = {
    passed: !changed.length && !missing.length,
    checkedFiles: records.length,
    changed,
    missing
  };
  await fs.writeFile(
    verificationPath(root, 'v1.1-preservation-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
  return report;
}
module.exports = verify;
if (require.main === module)
  verify().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
