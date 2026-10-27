'use strict';
const { app, shell } = require('electron');
const path = require('node:path');
const { syncTaskbarShortcuts } = require('../src/windows-taskbar.cjs');
app
  .whenReady()
  .then(() => {
    const updated = syncTaskbarShortcuts({
      shell,
      programsDirectory: path.join(
        app.getPath('appData'),
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs'
      )
    });
    for (const link of updated) console.log('Updated: ' + link);
    app.quit();
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
