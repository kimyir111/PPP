/* A stand-in for beat_track.py (Beat This) in the worker's tests (run by Node as the "python"). The same arguments (--wav --out) and the same
   JSON: { engine: 'beat-this', beats, downbeats }. FAKE_BEATS_MODE: ok (default: a beat every 0.5 s for 120 s, a downbeat every 4) | fail (exit 1)
   | garbage (not JSON) */
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1];
const mode = process.env.FAKE_BEATS_MODE || 'ok';
if (mode === 'fail') { process.stderr.write('beat-this is not installed (fake)\n'); process.exit(1); }
if (mode === 'garbage') { fs.writeFileSync(out, '{not json'); process.exit(0); }
const beats = [];
for (let k = 0; k < 240; k++) beats.push(Math.round((0.5 + k * 0.5) * 10000) / 10000);
fs.writeFileSync(out, JSON.stringify({ engine: 'beat-this', beats: beats, downbeats: beats.filter((t, i) => i % 4 === 0) }));
process.stdout.write('PROGRESS 1\nDONE\n');
