'use strict';
// 6px above the 36px tabs. The 2px bottom bar overlaps the tab shape.
// Keep vendor CSS unchanged; see browser-toolbar/CHROMIUM-SOURCES.md.
const TAB_STRIP_HEIGHT = 42;
// 4px above the 34px field and 6px below it. The strip's 2px bar makes the white band above the field 6px.
const TOOLBAR_HEIGHT = 4 + 34 + 6;
const BROWSER_HEIGHT = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT;
module.exports = { TAB_STRIP_HEIGHT, TOOLBAR_HEIGHT, BROWSER_HEIGHT };
