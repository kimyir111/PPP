/* A stand-in for transcribe.py in the worker's tests (run by Node: the test names process.execPath as the "python"). It takes the same
   arguments (--wav --kong-wav --out --checkpoint --aria-checkpoint --engine), prints PROGRESS / ENGINE / DONE lines like the real one and
   writes the same kind of JSON: accepted notes with confidence, support and models, pedals, uncertain notes, the ensemble summary.
   FAKE_MODE: ok (default) | fail (exit 1) | empty (two notes only) | slow (waits 30 s) | long (notes past 15 minutes) | garbage (not JSON)
   FAKE_NOTES: how many accepted notes (default 120). FAKE_ARGV_FILE: where to write the arguments it was given.
   G10d: with --mode song it writes a song result (mode 'song', every note with its layer: track 1 melody, 2 bass, 3 accompaniment); FAKE_MODE nosep
   says, as transcribe.py does on a PC without demucs, SONG_SEPARATION_MISSING and exits 1. */
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mode = process.env.FAKE_MODE || 'ok';
if (process.env.FAKE_ARGV_FILE) fs.writeFileSync(process.env.FAKE_ARGV_FILE, JSON.stringify({ argv: args, cwd: process.cwd(), wavExists: fs.existsSync(opt('--wav') || ''), kongExists: fs.existsSync(opt('--kong-wav') || '') }));
const say = l => process.stdout.write(l + '\n');
(async () => {
  say('ENGINE transkun'); say('PROGRESS 0.020');
  if (mode === 'slow') { await new Promise(r => setTimeout(r, 30000)); }
  if (mode === 'fail') { process.stderr.write('RuntimeError: CUDA out of memory (fake)\n'); process.exit(1); }
  const song = opt('--mode') === 'song';
  if (song && mode === 'nosep') { process.stderr.write('SystemExit: SONG_SEPARATION_MISSING: the source separation (demucs) is not installed on this PC\n'); process.exit(1); }
  say('ENGINE piano-transcription'); say('PROGRESS 0.500'); say('PROGRESS 0.970');
  const n = mode === 'empty' ? 2 : +process.env.FAKE_NOTES || 120;
  const notes = [], uncertain = [];
  const spread = mode === 'long' ? 1000 : 120;
  for (let i = 0; i < n; i++) {
    const on = Math.round(i * spread / n * 10000) / 10000;
    notes.push({ on: on, off: Math.round((on + 0.35) * 10000) / 10000, midi: 40 + (i * 5) % 50, vel: 30 + (i * 7) % 90, confidence: i % 3 ? 1 : 0.5, support: i % 3 ? 2 : 1, models: i % 3 ? ['transkun', 'piano-transcription'] : ['transkun'] });
  }
  for (let i = 0; i < 17; i++) uncertain.push({ on: i + 0.5, off: i + 0.9, midi: 60, vel: 40, confidence: 0.5, support: 1, models: ['piano-transcription'] });
  if (mode === 'garbage') { fs.writeFileSync(opt('--out'), '{not json'); process.exit(0); }
  if (song) {
    notes.forEach((x, i) => { x.track = 1 + (i % 3); });
    fs.writeFileSync(opt('--out'), JSON.stringify({ engine: 'song', mode: 'song', model: 'Demucs htdemucs_6s + pYIN melody and bass', device: 'cuda', duration: 125.3, ms: 4321, notes: notes, pedals: [],
      uncertainNotes: [], ensemble: { models: ['transkun', 'piano-transcription'], primary: 'transkun', agreement: 1, accepted: n, uncertain: 0 },
      song: { separation: 'htdemucs_6s', melody: 40, bass: 40, accomp: 40 }, modelFailures: [] }));
    say('PROGRESS 1'); say('DONE');
    return;
  }
  fs.writeFileSync(opt('--out'), JSON.stringify({
    engine: 'ensemble', model: 'TransKun V2 + Kong et al. high-resolution piano transcription', device: 'cuda', duration: mode === 'long' ? 1000 : 125.3, ms: 4321,
    notes: notes, pedals: [{ on: 1, off: 5 }, { on: 6, off: 9 }], uncertainNotes: uncertain,
    ensemble: { models: ['transkun', 'piano-transcription'], primary: 'transkun', agreement: 0.812, accepted: n, uncertain: uncertain.length, fastRecovered: 0, pedalSource: 'transkun' }, modelFailures: []
  }));
  say('PROGRESS 1'); say('DONE');
})();
