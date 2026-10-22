'use strict';
// Browser-safe presentation modules; never load Node readers into the UI bundle.
module.exports = {
  rhtv: require('./rhtv/presentation.cjs'),
  tapnow: require('./tapnow/presentation.cjs')
};
