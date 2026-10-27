'use strict';
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
async function atomic(file, text) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
module.exports = { atomic };
