/* ============================================================================
   Audiveris on ONE page image: the call the local helper (omr-service.js) and the home-PC worker (tools/home-worker/worker.js, G12-5) both make.

   One module so the two cannot drift: the command line (`Audiveris -batch -export -output <dir> -- <image>`), how the answer is read (the newest .mxl as
   `musicxml`, every movement in movement order as `movements`: omr/helper-output.js) and the zip reader are written once, here. The helper calls it with no
   options and gets exactly what it always got; the worker adds a step time-out and a lower priority, nothing else.

   Node only (CommonJS). It starts the engine as a separate process (AGPL-3.0: no PPP code links it) and reads outside no directory it is given.
   ========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

/* G12-1: every movement of a page, not only the newest file. omr/helper-output.js is optional: if it is missing or broken a page's `movements` is its one newest file */
let readMovements = null;
try { readMovements = require('./helper-output.js').readMovements; } catch (e) { readMovements = null; }
function pageMovements(outDir, xml) {
  if (typeof readMovements !== 'function') return [xml];
  try { return readMovements(outDir, readMxlSync, xml); } catch (e) { return [xml]; }
}

/* ---- minimal .mxl reader (a zip of one MusicXML file) ----
   Read through the central directory rather than walking local headers: a
   writer that streams entries leaves the sizes in the local header at zero and
   puts the real ones in a trailing data descriptor. The central directory
   always has them. */
function readMxlSync(file) {
  const buf = fs.readFileSync(file);
  const entries = {};

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    /* the local header repeats the name and extra field, at its own lengths */
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    entries[name] = { method, start: localOff + 30 + lNameLen + lExtraLen, compSize };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = key => {
    const e = entries[key];
    if (!e) return null;
    const raw = buf.subarray(e.start, e.start + e.compSize);
    if (e.method === 0) return raw.toString('utf8');
    /* what Audiveris wrote, not what anybody sent - but a document that inflates past 64 MB is not a score and is not expanded into memory */
    if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
    throw new Error('unsupported compression in .mxl');
  };
  let target = null;
  const container = read('META-INF/container.xml');
  if (container) {
    const m = /full-path\s*=\s*"([^"]+)"/.exec(container);
    if (m) target = m[1];
  }
  if (!target || !entries[target])
    target = Object.keys(entries).find(k => /\.(xml|musicxml)$/i.test(k) && k.indexOf('META-INF') !== 0);
  if (!target) throw new Error('no MusicXML inside the .mxl');
  return read(target);
}

/* ---- locating Audiveris ---- (explicit: a path the person named; root: the repository, whose tools/ folder may hold it) */
function findAudiveris(explicit, root) {
  /* programs first, the .bat of a source build last: Node cannot start a .bat without a shell (see unstartable), so it is a place to say so, never the one chosen over a real program */
  const candidates = [
    explicit,
    root && path.join(root, 'tools', 'audiveris', 'Audiveris', 'Audiveris.exe'),
    'C:\\Program Files\\Audiveris\\Audiveris.exe',
    '/usr/bin/audiveris', '/usr/local/bin/audiveris',
    root && path.join(root, 'tools', 'audiveris', 'Audiveris', 'bin', 'Audiveris.bat')
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) { /* next */ } }
  return null;
}

/* A .bat or .cmd cannot be started by Node without a shell: since Node 18.20 / 20.12 (CVE-2024-27980) execFile and spawn refuse it with EINVAL, and a shell would put a person's path and a
   page's name through cmd.exe. So it is not started: the sentence (what to do) when the program is one, '' when it is not. */
function unstartable(audiveris) {
  if (process.platform !== 'win32' || !/\.(bat|cmd)$/i.test(String(audiveris || ''))) return '';
  return 'Audiveris is set to a .bat file, which Node cannot start safely (EINVAL). Point "audiverisPath" (or PPP_AUDIVERIS) at Audiveris.exe, from the installer or the "app" folder of the build.';
}

/* The environment the engine's Java runtime starts with: its heap is capped (a crafted image must not be able to take the PC's memory: -Xmx), ahead of the person's own
   JAVA_TOOL_OPTIONS, so a cap they set themselves still wins (the last -Xmx is the one used). mb 0 or less: the environment as it is. */
function heapEnv(mb, base) {
  const env = Object.assign({}, base || process.env);
  const n = Math.floor(Number(mb));
  if (Number.isFinite(n) && n > 0) env.JAVA_TOOL_OPTIONS = ('-Xmx' + n + 'm ' + String(env.JAVA_TOOL_OPTIONS || '')).trim();
  return env;
}

/* ---- run Audiveris on one page image ----
   audiveris: the program; imgPath: the page; outDir: where it writes (one directory per page).
   o.timeoutMs      the whole page (the helper: 180 s)
   o.extraArgs      options placed after -export (the worker: the step time-out)
   o.onChild(child) the process, so the caller can stop it (the worker's cancel); called with null when it has ended
   o.lowPriority    below-normal priority for the process (the worker: the PC belongs to its person)
   o.env            the environment of the process (the worker: heapEnv - the Java heap is capped)
   Resolves { ok: true, ms, musicxml, movements } or { ok: false, ms, error, log? }; never rejects. */
function recognisePage(audiveris, imgPath, outDir, o) {
  o = o || {};
  return new Promise(resolve => {
    if (!audiveris) return resolve({ ok: false, error: 'Audiveris is not installed' });
    const t0 = Date.now();
    const bat = unstartable(audiveris);
    if (bat) return resolve({ ok: false, ms: 0, error: bat });
    const args = ['-batch', '-export'].concat(o.extraArgs || [], ['-output', outDir, '--', imgPath]);
    let child = null;
    try {
      child = execFile(audiveris, args,
        { timeout: o.timeoutMs || 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: o.env || process.env },
        (err, stdout, stderr) => {
          if (o.onChild) o.onChild(null);
          const log = String(stdout || '') + String(stderr || '');
          let mxl = null;
          try {
            mxl = fs.readdirSync(outDir).filter(f => /\.mxl$/i.test(f))
              .map(f => path.join(outDir, f))
              .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
          } catch (e) { /* no directory, no file */ }
          if (!mxl) {
            /* Audiveris exits 0 even when it finds nothing worth exporting, so the
               absence of an export is the real signal. */
            const noStaff = /No staff|no system|Could not find|not a supported/i.test(log);
            return resolve({
              ok: false, ms: Date.now() - t0,
              error: noStaff ? 'No musical notation was detected on this page.'
                : (err && err.killed) ? 'Recognition timed out on this page.'
                  : 'Audiveris produced no MusicXML for this page.',
              log: log.slice(-1500)
            });
          }
          try {
            const xml = readMxlSync(mxl);
            /* `musicxml` is what it always was (the newest file); `movements` (G12-1) is every file of the page, in movement order */
            resolve({ ok: true, ms: Date.now() - t0, musicxml: xml, movements: pageMovements(outDir, xml) });
          } catch (e) {
            resolve({ ok: false, ms: Date.now() - t0, error: 'The MusicXML Audiveris produced could not be read: ' + e.message });
          }
        });
    } catch (e) {
      return resolve({ ok: false, ms: Date.now() - t0, error: 'Audiveris could not be started: ' + String(e && (e.code || e.message) || e).slice(0, 120) });
    }
    if (o.onChild) o.onChild(child);
    if (o.lowPriority && child && child.pid) {
      try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* not allowed here: the process runs as it is */ }
    }
  });
}

/* The engine's own version line (`Audiveris -version`: "- Version:      5.11.0"), or null. A few seconds: the Java runtime starts. */
function engineVersion(audiveris, o) {
  o = o || {};
  return new Promise(resolve => {
    if (!audiveris || unstartable(audiveris)) return resolve(null);
    try {
      const child = execFile(audiveris, ['-version'], { timeout: o.timeoutMs || 60000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => {
        const m = /Version:\s*([0-9][0-9A-Za-z._+-]{0,19})/.exec(String(stdout || ''));
        resolve(m ? m[1] : null);
      });
      if (o.lowPriority && child && child.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* as it is */ } }
    } catch (e) { resolve(null); }
  });
}

module.exports = { readMxlSync, findAudiveris, unstartable, heapEnv, recognisePage, engineVersion, pageMovements, STEP_TIMEOUT_ARGS: Object.freeze(['-option', 'org.audiveris.omr.Main.sheetStepTimeOut=1800']) };
