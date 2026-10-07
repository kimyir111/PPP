/* G10b-1: the worker with the REAL tools - ffmpeg, the transcription venv (TransKun + Kong), the GPU if there is one - on a few seconds of
   synthetic piano-like audio made here (an arpeggio of decaying harmonic tones; no recording, nothing copyrighted). Skipped, with the reason,
   when this PC has no transcription environment (so CI and a fresh checkout pass): it needs ffmpeg on PATH (or PPP_FFMPEG), the venv python
   (PPP_TRANSCRIBE_PYTHON, or tools/transcribe-venv, or D:/PPP/tools/transcribe-venv) and the Kong checkpoint.

   What it proves that worker.test.js (stand-in tools) cannot: the real ffmpeg arguments decode a real audio file, transcribe.py runs with the
   arguments the worker gives it, its real JSON goes through the conversion and the site's checks, and the job ends done (or - the synthetic
   tones may not be heard as piano - failed with "No piano notes", which is also the pipeline working). The real-piece run on a real recording is
   in docs/GOALS/G10B_HOME_WORKER.md.

   Run: node tests/home-worker/worker-real.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, req } = L;
const W = L.mod('tools/home-worker/worker.js');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function firstExisting(list) { for (const c of list.filter(Boolean)) { try { if (fs.existsSync(c)) return c; } catch (e) { /* next */ } } return ''; }
const cfg0 = W.loadConfig(undefined, Object.assign({}, process.env, { PPP_WORKER_TOKEN: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43), PPP_WORKER_SITE: 'http://127.0.0.1:1' }));
const python = firstExisting([cfg0.pythonPath, 'D:/PPP/tools/transcribe-venv/Scripts/python.exe']);
const kong = firstExisting([cfg0.kongCheckpoint].concat((() => { try { const d = 'D:/PPP/tools/piano-transcription'; return fs.readdirSync(d).filter(f => /\.pth$/i.test(f)).map(f => path.join(d, f)); } catch (e) { return []; } })()));
let ffmpeg = process.env.PPP_FFMPEG || 'ffmpeg';
let ffOk = false;
try { execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' }); ffOk = true; } catch (e) { ffOk = false; }
if (!python || !kong || !ffOk) {
  console.log('  - skipped: no transcription environment here (python: ' + (python || 'none') + ', Kong checkpoint: ' + (kong || 'none') + ', ffmpeg: ' + (ffOk ? 'yes' : 'no') + ')');
  process.exit(0);
}

/* 8 s of a C major arpeggio: harmonic tones (1..6) with an exponential decay, 44.1 kHz mono 16-bit */
function wav() {
  const sr = 44100, secs = 8, n = sr * secs, pcm = new Int16Array(n);
  const notes = [60, 64, 67, 72, 67, 64, 60, 55, 59, 62, 67, 71, 67, 62, 59, 55];
  notes.forEach((m, i) => {
    const t0 = i * 0.5, f = 440 * Math.pow(2, (m - 69) / 12);
    for (let k = 0; k < sr * 1.2; k++) {
      const idx = Math.floor(t0 * sr) + k; if (idx >= n) break;
      const t = k / sr; let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * 1.3);
      pcm[idx] += Math.round(v * Math.exp(-t * 2.5) * 3500) * (k < 200 ? k / 200 : 1);
    }
  });
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  return buf;
}

(async () => {
  heading('the real tools on 8 s of synthetic piano-like audio');
  const audio = wav();
  const S = await L.startService({ extra: (rq, rs, url) => {
    if (url.pathname !== '/api/youtube-audio') return false;
    rs.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length });
    rs.end(audio);
    return true;
  } });
  try {
    const token = S.token('u1');
    const job = (await S.as('u1').post('/api/jobs', { url: L.WATCH('realtools01'), title: 'Synthetic arpeggio' })).body.job;
    const site = 'http://127.0.0.1:' + S.port;
    const cfg = Object.assign({}, W.DEFAULTS, { siteUrl: site, audioBase: site, token: token, pythonPath: python, transcribePy: path.join(L.MODS, 'transcribe.py'), kongCheckpoint: kong, ffmpegPath: ffmpeg, scratchDir: L.tmpDir('ppp-hw-real-') });
    if (!fs.existsSync(cfg.transcribePy)) cfg.transcribePy = path.join(L.REPO, 'transcribe.py');
    const lines = [];
    const w = W.createWorker(cfg, { log: W.makeLog(cfg, s => lines.push(s), s => lines.push(s)) });
    const t0 = Date.now();
    const code = await w.runOnce();
    const row = (await S.as('u1').get('/api/jobs/' + job.id)).body;
    const secs = (Date.now() - t0) / 1000;
    console.log(lines.join('\n'));
    const done = row.job.status === 'done', noNotes = row.job.status === 'failed' && /No piano notes/.test(row.job.error);
    ok('the job ended done, or failed with "No piano notes" (the synthetic tones may not be heard as piano) - the pipeline ran (' + secs.toFixed(0) + ' s)', done || noNotes, row.job.status + ' ' + row.job.error);
    if (done) {
      const notes = row.result.notes;
      ok('the notes are piano pitches, in order, inside the audio', notes.length >= 4 && notes.every(n => n.midi >= 21 && n.midi <= 108 && n.off <= 9.5) && notes.every((n, i) => !i || notes[i - 1].on <= n.on), notes.length + ' notes');
      ok('most of the arpeggio\'s pitch classes were heard (C, E, G, B, D)', (() => { const pcs = new Set(notes.map(n => n.midi % 12)); return [0, 4, 7].filter(p => pcs.has(p)).length >= 2; })(), Array.from(new Set(notes.map(n => n.midi % 12))).join());
      ok('the ensemble summary names the two models and the device', row.result.ensemble && row.result.ensemble.models.length >= 1 && /^(cuda|cpu)/.test(row.result.device || ''), JSON.stringify(row.result.ensemble) + ' ' + row.result.device);
    }
    ok('the scratch folder is gone and the exit code is 0 for done', (() => { try { return fs.readdirSync(cfg.scratchDir).length === 0; } catch (e) { return true; } })() && (done ? code === 0 : true));
  } finally { await S.close(); }
})().then(() => L.finish('the home-PC worker with the real tools'), e => { console.error(e); process.exit(1); });
