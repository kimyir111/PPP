#!/usr/bin/env node
/* G10b-0: the helper's notes -> the heard-notes format of review/h10/collect.js, for `build.js --mode h10 --compare engine --heard-b <dir>`.

     node review/h10/helper-heard.js --from <root> --heard <browser-heard-dir> --out <helper-heard-dir> [--file notes-cuda.json]

   The helper (transcribe.py, TransKun + Kong, run on a PC with a GPU or without) writes, per recording, { engine, model, device, duration, ms, notes: [{ on, off, midi, vel,
   confidence, support, models }], pedals, uncertainNotes, ensemble, modelFailures }. The heard-notes format of the app's browser transcription (the shape of PPP.app._heard) is
   { notes: [{ on, off, midi, vel }], duration, engine, ... }. This keeps the helper's ACCEPTED notes only (the ones the ensemble stands behind), in that shape:

     - on, off, midi, vel of each note (the helper's confidence / support / models are dropped: a score is written from the notes alone, as in the browser path)
     - NO pedal: the browser path has none either, and the comparison is about the notes
     - NO beats: the helper's own beat tracking (Beat This) is not used - measured on six pieces it made the page's v2 write bars two to four times too short as wired, so both
       readings here come from the notes alone
     - `uncertainNotes` (the single-model notes the ensemble kept apart) are not notes: only their number is kept, in `helper.uncertain`

   `<root>` holds one folder per piece, named like the pieces of `<browser-heard-dir>/items.json`: `<root>/<id>/<file>` (default file notes-cuda.json; `<root>/<id>.json` also works).
   Writes `<out>/<id>.json` per piece and `<out>/items.json` (a copy of the browser folder's list), so <out> is a heard folder like the collector's. Nothing else is touched; a piece
   with no helper file is said and left out (the builder then reports it as skipped). The files are the teacher's pieces' notes: keep them out of the repository like the packets. */
'use strict';
const fs = require('fs');
const path = require('path');

const MIN_NOTES = 4;
const r4 = v => Math.round(v * 10000) / 10000;

/* raw: the helper's JSON (already parsed) -> { heard, report }. Throws a sentence when it is not helper notes. */
function convertHelperNotes(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.notes)) throw new Error('not a helper notes file (no notes list' + (raw && raw.error ? '; the helper says: ' + String(raw.error).slice(0, 200) : '') + ')');
  let dropped = 0;
  const notes = [];
  /* G10d song mode (transcribe.py --mode song): every note says its layer, 1 the melody, 2 the bass, 3 the accompaniment; a note of a song without one is not used */
  const song = raw.mode === 'song';
  raw.notes.forEach(n => {
    if (!n || !isFinite(n.on) || !isFinite(n.off) || !isFinite(n.midi) || n.on < 0 || n.off <= n.on || n.midi < 21 || n.midi > 108) { dropped++; return; }
    const vel = isFinite(n.vel) ? Math.max(1, Math.min(127, Math.round(n.vel))) : 64;
    const x = { on: r4(n.on), off: r4(n.off), midi: Math.round(n.midi), vel: vel };
    if (song) { if (n.track !== 1 && n.track !== 2 && n.track !== 3) { dropped++; return; } x.track = n.track; }
    notes.push(x);
  });
  if (notes.length < MIN_NOTES) throw new Error('the helper file has ' + notes.length + ' usable notes (needs at least ' + MIN_NOTES + ')');
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi || a.off - b.off);
  const last = notes.reduce((m, n) => Math.max(m, n.off), 0);
  const duration = isFinite(raw.duration) && raw.duration > 0 ? raw.duration : last;
  const ens = raw.ensemble && typeof raw.ensemble === 'object' ? raw.ensemble : null;
  const heard = {
    notes: notes, duration: duration, engine: typeof raw.engine === 'string' && raw.engine ? raw.engine : 'ensemble', truncated: false,
    helper: {
      model: raw.model || null, device: raw.device || null, models: ens && ens.models || null, primary: ens && ens.primary || null, agreement: ens && ens.agreement != null ? ens.agreement : null,
      accepted: notes.length, uncertain: Array.isArray(raw.uncertainNotes) ? raw.uncertainNotes.length : null, pedalSpansDropped: Array.isArray(raw.pedals) ? raw.pedals.length : 0,
      modelFailures: raw.modelFailures && raw.modelFailures.length ? raw.modelFailures : null, invalidNotesDropped: dropped
    }
  };
  if (song) {
    const rs = raw.song && typeof raw.song === 'object' ? raw.song : {};
    const str = k => (typeof rs[k] === 'string' ? rs[k] : null);
    /* which method found the tune and played the accompaniment, and the key and bars a lead-sheet transcriber stated (home-result.js checks them) */
    heard.song = { separation: str('separation'), melodyFrom: str('melodyFrom'), melodyTracker: str('melodyTracker'), accompFrom: str('accompFrom'), beatsFrom: str('beatsFrom'),
      key: rs.key && typeof rs.key === 'object' && Number.isInteger(rs.key.tonic) && typeof rs.key.mode === 'string' ? { tonic: rs.key.tonic, mode: rs.key.mode } : null };
  }
  return { heard: heard, report: { notes: notes.length, dropped: dropped, uncertain: heard.helper.uncertain, pedalsDropped: heard.helper.pedalSpansDropped, duration: duration } };
}

/* the helper file of one piece under `root`: <root>/<id>/<file>, else <root>/<id>.json; null when there is none */
function helperFileOf(root, id, file) {
  for (const f of [path.join(root, id, file), path.join(root, id + '.json')]) if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  return null;
}

/* every piece of `heardDir/items.json` -> `outDir`; returns { written: [{ id, ...report }], missing: [{ id, reason }] } */
function convertFolder(o) {
  const items = JSON.parse(fs.readFileSync(path.join(o.heardDir, 'items.json'), 'utf8'));
  if (!Array.isArray(items) || !items.length) throw new Error(path.join(o.heardDir, 'items.json') + ' is not a non-empty list');
  fs.mkdirSync(o.outDir, { recursive: true });
  const written = [], missing = [];
  items.forEach(it => {
    const id = String(it && it.id);
    const f = helperFileOf(o.root, id, o.file || 'notes-cuda.json');
    if (!f) { missing.push({ id: id, reason: 'no ' + (o.file || 'notes-cuda.json') + ' under ' + path.join(o.root, id) }); return; }
    try {
      const c = convertHelperNotes(JSON.parse(fs.readFileSync(f, 'utf8')));
      fs.writeFileSync(path.join(o.outDir, id + '.json'), JSON.stringify(c.heard));
      written.push(Object.assign({ id: id, from: f }, c.report));
    } catch (e) { missing.push({ id: id, reason: f + ': ' + String(e && e.message || e) }); }
  });
  fs.writeFileSync(path.join(o.outDir, 'items.json'), JSON.stringify(items, null, 1) + '\n');
  return { written: written, missing: missing };
}

function main() {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--help') || !opt('--from') || !opt('--heard') || !opt('--out')) {
    console.log('usage: node review/h10/helper-heard.js --from <root> --heard <browser-heard-dir> --out <helper-heard-dir> [--file notes-cuda.json]');
    process.exit(args.includes('--help') ? 0 : 2);
  }
  const r = convertFolder({ root: path.resolve(opt('--from')), heardDir: path.resolve(opt('--heard')), outDir: path.resolve(opt('--out')), file: opt('--file') });
  r.written.forEach(w => console.log(w.id + ': ' + w.notes + ' helper notes (' + w.uncertain + ' uncertain kept apart, ' + w.pedalsDropped + ' pedal spans dropped, ' + w.dropped + ' invalid dropped), ' + w.duration.toFixed(1) + ' s'));
  r.missing.forEach(m => console.log('MISSING ' + m.id + ': ' + m.reason));
  console.log(r.written.length + ' converted, ' + r.missing.length + ' missing -> ' + path.resolve(opt('--out')));
  if (!r.written.length) process.exit(1);
}

module.exports = { convertHelperNotes, convertFolder, helperFileOf };
if (require.main === module) { try { main(); } catch (e) { console.error(e.message || e); process.exit(1); } }
