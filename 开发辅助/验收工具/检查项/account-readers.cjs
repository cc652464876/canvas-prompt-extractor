'use strict';
const { getAdapter } = require('../../../src/platforms/registry.cjs');
// Validation compatibility: assemble a self-contained dispatcher from registered
// readers rather than duplicating any brand's DOM rules here.
const { listPlatforms } = require('../../../src/platforms/registry.cjs');
const readers = listPlatforms().map((p) => getAdapter(p.id));
const routes = readers
  .map(
    (a) =>
      'if(' +
      JSON.stringify(a.workHosts) +
      '.includes(location.hostname))return (' +
      a.inspectAccount.toString() +
      ')();'
  )
  .join('\n');
const inspectAccount = new Function(
  'return function inspectAccount(){' +
    routes +
    'return (' +
    readers[0].inspectAccount.toString() +
    ')();}'
)();
module.exports = {
  inspectAccount,
  accountReaderFor: (platform) => getAdapter(platform).inspectAccount
};
