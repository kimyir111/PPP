/* ============================================================================
   The local helper's reading of what Audiveris wrote for ONE page (G12-1, docs/GOALS/G12_OMR.md E7).

   Audiveris starts a new "movement" at an indented system and exports one file for each: page.mvt1.mxl, page.mvt2.mxl, ... (a page it
   did not split gives page.mxl). The helper used to keep the newest file only (omr-service.js recognisePage, the `musicxml` field, still
   unchanged for old clients), which dropped every other movement: on the benchmark's photos a third of the pages lost half their notes.
   `movements` is every file of the page, in movement order; omr/normalize.js joins them.

   Node only (CommonJS). Nothing here starts a process or reads outside the directory it is given.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

/* page.mvt2.mxl -> 2; a file without the suffix (page.mxl) comes first */
function movementOrder(name) {
  const m = /\.mvt(\d+)\.mxl$/i.exec(String(name || ''));
  return m ? parseInt(m[1], 10) : 0;
}

/* the .mxl names of a directory listing, in movement order (ties by name, so the order never depends on the file system) */
function movementFiles(names) {
  return (names || []).filter(f => /\.mxl$/i.test(f))
    .sort((a, b) => (movementOrder(a) - movementOrder(b)) || (a < b ? -1 : a > b ? 1 : 0));
}

/* every readable movement of the page's output directory; readMxl(path) -> the MusicXML text (it may throw: that movement is left out).
   When nothing can be read, the document the caller already has (fallbackXml) is the one movement. */
function readMovements(outDir, readMxl, fallbackXml) {
  let names = [];
  try { names = fs.readdirSync(outDir); } catch (e) { names = []; }
  const out = [];
  movementFiles(names).forEach(f => {
    try {
      const xml = readMxl(path.join(outDir, f));
      if (typeof xml === 'string' && xml) out.push(xml);
    } catch (e) { /* an unreadable movement is left out */ }
  });
  return out.length ? out : (fallbackXml ? [fallbackXml] : []);
}

module.exports = { movementOrder, movementFiles, readMovements };
