#!/usr/bin/env node
/* The real-AMT runner (G10a-0 step 5, docs/GOALS/G10 section 7.4): the production model on rendered audio.

     node tests/bench/tools/of_replay.js [--n 20] [--max-seconds 45] [--refs id,id] [--profile cover-pedal] [--seed 1]
                                         [--work DIR] [--python PATH] [--venv-python PATH] [--no-room] [--replay-dir tests/bench/replay-of]

   1. of_prepare.py renders each reference's humanized performance (cover-pedal: the calibrated cover family with the damper
      pedal) to a WAV with the Salamander samples, a pedal sustain and a short synthetic room (render_piano.py; needs numpy and ffmpeg: --venv-python or PPP_TRANSCRIBE_PYTHON, the
      transcribe venv's python).
   2. This tree's server runs on a free port with NODE_ENV=production (tests/serve-free.js: nothing is spawned on 8788 and no other
      session's server is touched; never 8777) and the page transcribes each WAV the way a user's upload is transcribed:
      PPP.Import.pianoAmtNotes, the browser's Onsets & Frames (tfjs 2.8.6, 30-s windows, the app's isolated-transient filter), headless.
      The page needs the network once (tfjs from jsdelivr, the checkpoint from storage.googleapis.com; the weights are cached by the browser).
   3. of_prepare.py assemble writes one replay fixture per piece (engine onsets-and-frames, heard NOTES only: the audio never leaves
      the work directory) into tests/bench/replay-of/, which the `replay-of` suite replays in seconds with Node alone.

   A manual refresh (when the AMT model, the renderer or the humanizer changes), not CI. Time: about the length of the audio again
   in a software-GL headless Chrome (measured and recorded in each fixture's provenance.seconds). Resumable: a piece with a
   <key>.result.json in --work is not transcribed again. puppeteer is found in node_modules or in PPP_BENCH_NODE_MODULES. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, dflt) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; }
const flag = name => process.argv.indexOf(name) >= 0;
const ROOT = path.resolve(__dirname, '..', '..', '..');
const BENCH = path.resolve(__dirname, '..');
const work = path.resolve(arg('--work', path.join(os.tmpdir(), 'ppp-of-replay')));
const python = arg('--python', process.env.PPP_PYTHON || 'python');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function py(args) {
  const r = spawnSync(python, [path.join(BENCH, 'tools', 'of_prepare.py')].concat(args), { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) { process.stderr.write(r.stderr || ''); throw new Error('of_prepare.py ' + args[0] + ' failed'); }
}

function puppeteerLib() {
  const dirs = [process.env.PPP_BENCH_NODE_MODULES, path.join(ROOT, 'node_modules')].filter(Boolean);
  for (const d of dirs) { try { return require(path.join(d, 'puppeteer')); } catch (e) { /* next */ } }
  return require('puppeteer');
}

(async () => {
  fs.mkdirSync(work, { recursive: true });
  const render = ['render', '--out', work, '--n', arg('--n', '20'), '--max-seconds', arg('--max-seconds', '45'), '--profile', arg('--profile', 'cover-pedal'),
    '--seed', arg('--seed', '1')];
  if (arg('--refs')) render.push('--refs', arg('--refs'));
  if (flag('--no-room')) render.push('--no-room');
  if (arg('--venv-python')) render.push('--venv-python', arg('--venv-python'));
  if (!fs.existsSync(path.join(work, 'manifest.json')) || flag('--rerender')) py(render);
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'));
  const todo = manifest.pieces.filter(p => !fs.existsSync(path.join(work, p.key + '.result.json')));
  log(manifest.pieces.length + ' pieces, ' + todo.length + ' to transcribe, work dir ' + work);

  if (todo.length) {
    const puppeteer = puppeteerLib();
    const { startServer } = require(path.join(ROOT, 'tests', 'serve-free.js'));
    const { preparePage } = require(path.join(ROOT, 'tests', 'boot.js'));
    const srv = await startServer({ root: ROOT });
    log('server', srv.url);
    const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 3600000,
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
      for (const p of todo) {
        const page = await browser.newPage();              // a fresh page per piece: the model is disposed after each transcription
        await preparePage(page);
        page.on('pageerror', e => log('[pageerror]', String(e.message).slice(0, 200)));
        await page.setRequestInterception(true);
        page.on('request', r => { const u = r.url(); if (u.indexOf(':8788/') >= 0 || u.indexOf('/helper') >= 0) r.abort(); else r.continue(); });
        await page.goto(srv.url, { waitUntil: 'networkidle2', timeout: 120000 });
        await page.waitForFunction(() => !!(window.PPP && window.PPP.Import && window.PPP.Import.pianoAmtNotes), { timeout: 60000 });
        const b64 = fs.readFileSync(p.wav).toString('base64');
        const t0 = Date.now();
        log(p.reference, 'transcribing', Math.round(fs.statSync(p.wav).size / 1e5) / 10, 'MB of audio');
        const result = await page.evaluate(async data => {
          const bin = atob(data), buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          const r = await window.PPP.Import.pianoAmtNotes(buf.buffer);
          return JSON.parse(JSON.stringify(r));
        }, b64);
        const seconds = Math.round((Date.now() - t0) / 100) / 10;
        fs.writeFileSync(path.join(work, p.key + '.result.json'),
          JSON.stringify({ helper_result: result, seconds: seconds, model: 'magenta onsets_frames_uni (tfjs 2.8.6, @magenta/music 1.23.1)' }));
        log(p.reference, result.notes.length, 'notes in', seconds, 's (engine', result.engine + ')');
        await page.close();
      }
    } finally {
      await browser.close();
      await srv.close();
    }
  }
  py(['assemble', '--dir', work, '--replay-dir', arg('--replay-dir', path.join(BENCH, 'replay-of'))]);
})().catch(e => { console.error(e); process.exit(1); });
