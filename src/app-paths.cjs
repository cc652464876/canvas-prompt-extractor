'use strict';
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const DEVELOPMENT_ROOT = path.join(ROOT, '开发辅助');
const TEST_ROOT = path.join(DEVELOPMENT_ROOT, '测试代码');
const APP_ICON = path.join(ROOT, 'src', 'icons', 'app.ico');
function verificationPath(root, ...parts) {
  return path.join(root, '开发辅助', '验收记录', ...parts);
}
module.exports = { ROOT, DEVELOPMENT_ROOT, TEST_ROOT, APP_ICON, verificationPath };
