/* From a recording to a score.

   The model's half (which notes were played) is measured elsewhere, by its
   authors. This suite checks PPP's half: given the notes a performance
   contains, does it find the beat, the bar, the metre, the key and the hands,
   and write something the parser, the engraver and the practice system take?

   The performances here are built from scores whose answers are known, played
   with a human's untidiness — onsets early and late, chords spread, a tempo
   that drifts — so each check reads "did PPP recover what was written?".

   With the local helper running and transcription set up, it also sends a
   synthesised recording through the real UI, end to end. */
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const A = require('../audio-score.js');

const URL = (process.env.PPP_TEST_URL || 'http://127.0.0.1:8777').replace(/\/$/, '') + '/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* a repeatable wobble, so a failure can be reproduced */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* Play a list of { beat, len, midi, vel } at a tempo, humanly. */
function perform(events, opts) {
  const r = rng(opts.seed || 7);
  const out = [];
  let t = opts.start || 1.0;
  const beatSec = b => {
    /* integrate a tempo that drifts sinusoidally by opts.drift */
    let s = 0;
    const step = 0.05;
    for (let x = 0; x < b; x += step) {
      const bpm = opts.bpm * (1 + (opts.drift || 0) * Math.sin(x / 7));
      s += Math.min(step, b - x) * 60 / bpm;
    }
    return s;
  };
  events.forEach(e => {
    const jitter = ((r() - 0.5) * 2) * (opts.jitter || 0.015);
    const on = t + beatSec(e.beat) + jitter;
    const off = t + beatSec(e.beat + e.len) - 0.04;
    out.push({ on: on, off: Math.max(on + 0.05, off), midi: e.midi, vel: e.vel || 64 });
  });
  return out.sort((a, b) => a.on - b.on);
}

/* 3/4 in G: bass on one, a chord on two and three, a melody over it. */
function waltz(bars) {
  const ev = [];
  const harm = [[43, [59, 62, 67]], [38, [57, 60, 66]], [40, [59, 64, 67]], [38, [57, 62, 66]]];
  /* kept above the chords, so no key is struck by both hands at once */
  const tune = [71, 74, 79, 78, 76, 74, 72, 71, 72, 74, 76, 74];
  for (let b = 0; b < bars; b++) {
    const [bass, chord] = harm[b % harm.length];
    const t0 = b * 3;
    ev.push({ beat: t0, len: 3, midi: bass, vel: 80 });
    [1, 2].forEach(k => chord.forEach(m => ev.push({ beat: t0 + k, len: 1, midi: m, vel: 48 })));
    for (let k = 0; k < 3; k++) ev.push({ beat: t0 + k, len: 1, midi: tune[(b * 3 + k) % tune.length], vel: 70 });
  }
  return ev;
}

/* 4/4 in C: an Alberti bass in eighths, a melody in quarters and halves. */
function alberti(bars) {
  const ev = [];
  /* C, F, G7, C — a cadence that could only be C major */
  const shapes = [[48, 55, 52, 55], [48, 57, 53, 57], [47, 55, 53, 55], [48, 55, 52, 55]];
  const tune = [[76, 1], [74, 1], [72, 2], [74, 1], [76, 1], [77, 2], [79, 2], [77, 1], [76, 1], [74, 4]];
  for (let b = 0; b < bars; b++) {
    const sh = shapes[b % shapes.length];
    for (let k = 0; k < 8; k++) ev.push({ beat: b * 4 + k * 0.5, len: 0.5, midi: sh[k % 4], vel: k === 0 ? 72 : 50 });
  }
  let t = 0, i = 0;
  while (t < bars * 4) { const [m, l] = tune[i++ % tune.length]; ev.push({ beat: t, len: l, midi: m, vel: 76 }); t += l; }
  return ev;
}

function readXml(xml) {
  const measures = (xml.match(/<measure /g) || []).length;
  const fifths = +(/<fifths>(-?\d+)<\/fifths>/.exec(xml) || [])[1];
  const beats = +(/<beats>(\d+)<\/beats>/.exec(xml) || [])[1];
  return { measures, fifths, beats };
}

/* ---- a WAV the model can hear: struck, decaying, a few partials ---- */
function synthWav(notes, file) {
  const SR = 16000;
  const end = notes.reduce((m, n) => Math.max(m, n.off), 0) + 1.5;
  const buf = new Float32Array(Math.ceil(end * SR));
  notes.forEach(n => {
    const f = 440 * Math.pow(2, (n.midi - 69) / 12);
    const a0 = 0.18 * (n.vel / 127);
    const i0 = Math.floor(n.on * SR), i1 = Math.min(buf.length, Math.floor((n.off + 0.25) * SR));
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SR;
      const rel = i > n.off * SR ? Math.exp(-(i - n.off * SR) / (0.06 * SR)) : 1;
      const env = Math.exp(-t * 2.2) * Math.min(1, t * 400) * rel;
      let s = 0;
      for (let h = 1; h <= 6; h++) if (f * h < SR / 2) s += Math.sin(2 * Math.PI * f * h * t) / (h * h * 0.8 + 0.2);
      buf[i] += a0 * env * s;
    }
  });
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + buf.length * 2, 4); pcm.write('WAVE', 8);
  pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36); pcm.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, pcm);
}

const helperHealth = () => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port: 8788, path: '/health', timeout: 3000 }, r => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => { req.destroy(); resolve(null); });
});

(async () => {
  /* ============ PPP's reading of a performance, without a browser ============ */
  console.log('\n── beat, metre, key and hands from played notes ──');
  const w = A.toMusicXml({ notes: perform(waltz(16), { bpm: 96, start: 1.37, jitter: 0.02 }) }, { title: 'Waltz' });
  ok('a waltz is heard in three', w.stats.beatsPerBar === 3, w.stats.beatsPerBar + '/4');
  ok('its tempo is recovered', Math.abs(w.stats.tempo - 96) <= 3, w.stats.tempo + ' BPM (played at 96)');
  ok('its key is G major', w.stats.key.fifths === 1 && w.stats.key.mode === 'major', w.stats.key.fifths + ' ' + w.stats.key.mode);
  ok('every bar is where the bass is', w.stats.bars === 16, w.stats.bars + ' bars of 16');
  const wb1 = w.xml.split('<measure ')[1];
  ok('bar one opens on the bass note', /<staff>2<\/staff>/.test(wb1.split('<backup>')[1].split('</note>')[0]) &&
    /<step>G<\/step><octave>2<\/octave>/.test(wb1.split('<backup>')[1].split('</note>')[0]), 'first left-hand note of bar 1');
  ok('the chords go to the left hand, the tune to the right',
    w.stats.lh === 16 + 16 * 6 && w.stats.rh === 48, 'left ' + w.stats.lh + ', right ' + w.stats.rh);
  ok('the rhythm sits on the grid', w.stats.gridError < 0.06, 'mean error ' + w.stats.gridError.toFixed(3) + ' beats');

  const al = A.toMusicXml({ notes: perform(alberti(12), { bpm: 112, start: 0.6, jitter: 0.015, seed: 3 }) });
  ok('Alberti bass is heard in four', al.stats.beatsPerBar === 4, al.stats.beatsPerBar + '/4');
  ok('and in C major', al.stats.key.fifths === 0 && al.stats.key.mode === 'major', al.stats.key.fifths + ' ' + al.stats.key.mode);
  ok('its tempo is the quarter, not the eighth', Math.abs(al.stats.tempo - 112) <= 4, al.stats.tempo + ' BPM (played at 112)');
  ok('twelve bars come out as twelve', al.stats.bars === 12, al.stats.bars + ' bars');
  const e8 = (al.xml.split('<measure ')[3].split('<backup>')[1].match(/<type>eighth<\/type>/g) || []).length;
  ok('the left hand is written in eighths', e8 >= 7, e8 + ' eighths in bar 3');

  const rub = A.toMusicXml({ notes: perform(waltz(24), { bpm: 80, drift: 0.12, jitter: 0.025, seed: 11 }) });
  ok('a tempo that breathes still keeps its bars', rub.stats.bars === 24 && rub.stats.beatsPerBar === 3,
    rub.stats.bars + ' bars, ' + rub.stats.beatsPerBar + '/4, tempo variation ' + (rub.stats.tempoVariation * 100).toFixed(0) + '%');

  console.log('\n── rolled chords, 6/8, triplets, lock, audio beats, PM2S grid ──');
  const rolled = [
    { on: 1.10, off: 1.50, midi: 60, vel: 70 },
    { on: 1.13, off: 1.50, midi: 64, vel: 70 },
    { on: 1.16, off: 1.50, midi: 67, vel: 70 },
    { on: 1.50, off: 1.90, midi: 72, vel: 70 },
    { on: 2.00, off: 2.40, midi: 71, vel: 70 },
    { on: 2.50, off: 2.90, midi: 69, vel: 70 }
  ];
  const rc = A.toMusicXml({ notes: rolled });
  const rcBar = rc.xml.split('<measure ')[1] || '';
  const rcChords = (rcBar.match(/<chord\/>/g) || []).length;
  ok('a rolled chord is written as one attack', rcChords >= 2, rcChords + ' chord marks in bar 1');

  const fastAttacks = A._.clusterNotes(Array.from({ length: 8 }, (_, i) => ({
    on: 1 + i * 0.04, off: 1.03 + i * 0.04, midi: 72 + (i % 5), vel: 72
  }))).map(n => n.attack.toFixed(3));
  ok('a 32nd-note run is not collapsed into rolled chords',
    new Set(fastAttacks).size === 8, new Set(fastAttacks).size + ' attacks of 8');

  /* At 120 BPM a 32nd is 62.5 ms apart. It must survive both attack
     clustering and the notation grid instead of becoming paired 16ths. */
  const thirtySeconds = [];
  for (let i = 0; i < 32; i++) thirtySeconds.push({
    on: i * 0.0625, off: i * 0.0625 + 0.045, midi: 72 + (i % 7), vel: 72
  });
  const fast32 = A.toMusicXml({ notes: thirtySeconds }, {
    lock: { beats: 4, beatType: 4, bpm: 120, firstDownbeat: 0 }
  });
  ok('a fast scalar run is engraved with 32nds when the audio supports them',
    fast32.stats.bars === 1 && (fast32.xml.match(/<type>32nd<\/type>/g) || []).length >= 24,
    fast32.stats.bars + ' bars, ' + (fast32.xml.match(/<type>32nd<\/type>/g) || []).length + ' 32nds');

  /* At the 176 BPM used by many anime openings a 32nd is only 42.6 ms apart,
     so it is inside the old 50 ms rolled-chord window. The run detector must
     still keep every attack independent at that speed. */
  const highTempo32 = Array.from({ length: 32 }, (_, i) => ({
    on: i * 60 / 176 / 8, off: i * 60 / 176 / 8 + 0.024, midi: 60 + (i % 9), vel: 72
  }));
  const highFast32 = A.toMusicXml({ notes: highTempo32 }, {
    lock: { beats: 4, beatType: 4, bpm: 176, firstDownbeat: 0 }
  });
  ok('32nds stay separate at a 176 BPM performance tempo',
    highFast32.stats.bars === 1 && (highFast32.xml.match(/<type>32nd<\/type>/g) || []).length >= 24,
    highFast32.stats.bars + ' bars, ' + (highFast32.xml.match(/<type>32nd<\/type>/g) || []).length + ' 32nds');

  const fastChordRun = A._.clusterNotes(Array.from({ length: 4 }, (_, i) => [
    { on: 2 + i * 0.04, off: 2.03 + i * 0.04, midi: 60 + i, vel: 72 },
    { on: 2 + i * 0.04, off: 2.03 + i * 0.04, midi: 67 + i, vel: 72 }
  ]).flat());
  const fastChordAttacks = new Set(fastChordRun.map(n => n.attack.toFixed(3)));
  ok('real chords inside a fast run remain chords',
    fastChordAttacks.size === 4 && fastChordRun.length === 8,
    fastChordAttacks.size + ' attacks holding ' + fastChordRun.length + ' notes');

  const trueBeats = Array.from({ length: 33 }, (_, i) => 0.4 + i * 0.5);
  const brokenBeats = [];
  trueBeats.forEach((t, i) => {
    if (i !== 24) brokenBeats.push(t);
    if (i >= 8 && i < 16) brokenBeats.push(t + 0.25);
  });
  const repairedBeats = A._.stabilizeBeats(brokenBeats);
  const repairedGaps = repairedBeats.slice(1).map((t, i) => t - repairedBeats[i]);
  ok('temporary half/double-beat tracker switches are repaired',
    repairedBeats.length === trueBeats.length && Math.max(...repairedGaps) / Math.min(...repairedGaps) < 1.2 && repairedBeats._repairs >= 9,
    repairedBeats.length + ' beats, repairs ' + repairedBeats._repairs);

  function compound(bars) {
    const ev = [];
    for (let b = 0; b < bars; b++) {
      const t0 = b * 3;
      ev.push({ beat: t0, len: 1.5, midi: 43, vel: 88 });
      ev.push({ beat: t0 + 1.5, len: 1.5, midi: 38, vel: 80 });
      [0, 0.5, 1, 1.5, 2, 2.5].forEach((k, i) => ev.push({ beat: t0 + k, len: 0.5, midi: 67 + (i % 3), vel: 60 }));
    }
    return ev;
  }
  const c68 = A.toMusicXml({ notes: perform(compound(8), { bpm: 90, start: 0.8, jitter: 0.01, seed: 4 }) });
  ok('a 6/8 jig is written in 6/8, not 3/4', c68.stats.beatsPerBar === 6 && c68.stats.beatType === 8,
    c68.stats.beatsPerBar + '/' + c68.stats.beatType + ', ' + c68.stats.bars + ' bars');
  ok('and the page says beat-type 8', /<beat-type>8<\/beat-type>/.test(c68.xml));

  const compound16 = compound(8);
  for (let b = 0; b < 8; b++) {
    const t0 = b * 3;
    [0.25, 0.75, 1.75, 2.25].forEach((k, i) => compound16.push({
      beat: t0 + k, len: 0.25, midi: 76 + (i % 2), vel: 66
    }));
  }
  const c68fast = A.toMusicXml({ notes: perform(compound16, { bpm: 90, start: 0.8, jitter: 0.004, seed: 14 }) });
  ok('fast compound piano keeps written 16ths instead of rounding them to eighths',
    c68fast.stats.beatsPerBar === 6 && c68fast.stats.beatType === 8 &&
    (c68fast.xml.match(/<type>16th<\/type>/g) || []).length >= 8,
    c68fast.stats.beatsPerBar + '/' + c68fast.stats.beatType + ', 16ths ' +
    (c68fast.xml.match(/<type>16th<\/type>/g) || []).length);

  /* A strong half-note pulse must not turn fast common time into slow 6/8.
     This is deliberately dense: the beat tracker first finds ~81 BPM, then
     the notation layer has to recover the written quarter at ~162. */
  const fastSimple = [];
  for (let b = 0; b < 20; b++) {
    const t0 = b * 4;
    for (let k = 0; k < 16; k++) fastSimple.push({
      beat: t0 + k / 4, len: 0.22, midi: 60 + [0, 3, 7, 10][k % 4], vel: k % 8 === 0 ? 78 : 54
    });
    for (let k = 0; k < 2; k++) fastSimple.push({ beat: t0 + k * 2, len: 1.8, midi: 36 + (b % 4) * 2, vel: 92 });
    for (let k = 0; k < 8; k++) fastSimple.push({ beat: t0 + k / 2, len: 0.45, midi: 72 + [0, 2, 3, 7][(b + k) % 4], vel: 70 });
  }
  const fast44 = A.toMusicXml({ notes: perform(fastSimple, { bpm: 162, start: 0.33, jitter: 0.002, seed: 21 }) });
  ok('fast 4/4 is not collapsed into a half-time 6/8 grid',
    fast44.stats.beatsPerBar === 4 && fast44.stats.beatType === 4 &&
    Math.abs(fast44.stats.tempo - 162) <= 3 && fast44.stats.tempoAlias === 'x2',
    fast44.stats.beatsPerBar + '/' + fast44.stats.beatType + ' @ ' + fast44.stats.tempo +
    ', candidate ' + fast44.stats.tempoAlias);

  function trips(bars) {
    const ev = [];
    for (let b = 0; b < bars; b++) {
      ev.push({ beat: b * 4, len: 4, midi: 48, vel: 80 });
      for (let beat = 0; beat < 4; beat++) {
        for (let k = 0; k < 3; k++) ev.push({ beat: b * 4 + beat + k / 3, len: 1 / 3, midi: 72 + k, vel: 70 });
      }
    }
    return ev;
  }
  const trp = A.toMusicXml({ notes: perform(trips(4), { bpm: 100, start: 0.5, jitter: 0.004, seed: 2 }) });
  ok('eighth-note triplets are written as tuplets',
    (trp.xml.match(/<time-modification>/g) || []).length >= 8 && (trp.xml.match(/<tuplet /g) || []).length >= 4,
    'time-mod ' + (trp.xml.match(/<time-modification>/g) || []).length + ', tuplet ' + (trp.xml.match(/<tuplet /g) || []).length);
  ok('not as dotted-eighth plus sixteenth', !(trp.xml.match(/<type>eighth<\/type>\s*<dot\/>/g) || []).length);

  const locked = A.toMusicXml(
    { notes: perform(waltz(8), { bpm: 96, start: 1.2, jitter: 0.02 }) },
    { lock: { beats: 4, beatType: 4, bpm: 80, firstDownbeat: 1.2 } }
  );
  ok('a lock rewrites metre, tempo and downbeat without new notes',
    locked.stats.beatsPerBar === 4 && locked.stats.beatType === 4 && locked.stats.tempo === 80 &&
    locked.stats.beatSource === 'lock' && Math.abs(locked.stats.barStarts[0] - 1.2) < 0.02,
    locked.stats.beatsPerBar + '/' + locked.stats.beatType + ' @ ' + locked.stats.tempo + ', bar0 ' + locked.stats.barStarts[0]);

  const notes4 = perform(alberti(8), { bpm: 100, start: 1.0, jitter: 0.01, seed: 1 });
  const beats = [], downs = [];
  for (let i = 0; i < 50; i++) beats.push(0.4 + i * 0.6);
  for (let i = 0; i < 16; i++) downs.push(0.4 + i * 1.8);
  const inj = A.toMusicXml({ notes: notes4, beats: beats, downbeats: downs });
  ok('injected audio beats win over onset tracking',
    inj.stats.beatsPerBar === 3 && inj.stats.beatSource === 'audio' && Math.abs(inj.stats.barStarts[0] - 0.4) < 0.05,
    inj.stats.beatsPerBar + '/' + inj.stats.beatType + ' source ' + inj.stats.beatSource + ' bar0 ' + inj.stats.barStarts[0]);

  const unstableAudio = A.toMusicXml({ notes: notes4, beats: beats, downbeats: downs, beatConfidence: 0.18 });
  ok('an unstable audio grid falls back to the note-onset grid',
    unstableAudio.stats.beatSource === 'onset' && unstableAudio.stats.beatFallback === 'onset',
    unstableAudio.stats.beatSource + ' fallback ' + unstableAudio.stats.beatFallback);

  /* A downbeat detector may miss the opening bar and report the next one a
     few milliseconds late. That still establishes bar phase only: it must
     not shift the score by one 1/24-quarter tick or invent a pickup bar. */
  const fastSpb = 60 / 176;
  const fastNotes = perform(alberti(8), { bpm: 176, start: 0.4, jitter: 0, seed: 8 });
  const fastBeats = [], lateDownbeats = [];
  for (let i = 0; i < 40; i++) fastBeats.push(0.4 + i * fastSpb);
  for (let i = 1; i < 8; i++) lateDownbeats.push(0.4 + (i * 4 + 0.04) * fastSpb);
  const phased = A.toMusicXml({ notes: fastNotes, beats: fastBeats, downbeats: lateDownbeats });
  const phasedFirst = phased.xml.split('<measure ')[1] || '';
  ok('a slightly late later downbeat stays on the beat and does not add a pickup bar',
    phased.stats.beatsPerBar === 4 && phased.stats.bars === 8 &&
    /<staff>2<\/staff>/.test((phasedFirst.split('<backup>')[1] || '').split('</note>')[0]),
    phased.stats.bars + ' bars, bar0 ' + phased.stats.barStarts[0]);

  const grid = { ticksPerQuarter: 24, beatsPerBar: 6, beatType: 8, bpm: 60, notes: [] };
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * 72;
    grid.notes.push({ midi: 43, tick: o, endTick: o + 36, vel: 80 });
    grid.notes.push({ midi: 47, tick: o + 36, endTick: o + 72, vel: 70 });
    for (let i = 0; i < 6; i++) grid.notes.push({ midi: 67, tick: o + i * 12, endTick: o + i * 12 + 12, vel: 60 });
  }
  const g = A.toMusicXml({ grid: grid }, { title: 'Grid' });
  ok('a PM2S-shaped grid becomes 6/8 MusicXML', g.stats.beatsPerBar === 6 && g.stats.beatType === 8 && g.stats.quantizer === 'pm2s' && /<beat-type>8<\/beat-type>/.test(g.xml),
    g.stats.beatsPerBar + '/' + g.stats.beatType + ' ' + g.stats.quantizer);

  const locked12 = A.toMusicXml(
    { notes: perform(compound(8), { bpm: 90, start: 0.5, jitter: 0.008, seed: 6 }) },
    { lock: { beats: 12, beatType: 8, bpm: 60, firstDownbeat: 0.5 } }
  );
  const thick = [];
  for (let i = 0; i < 8; i++) {
    const t = 0.5 + i * 0.5;
    [48, 52, 55, 60, 64, 67, 72].forEach(m => thick.push({ on: t, off: t + 0.4, midi: m, vel: 70 }));
  }
  const full = A.toMusicXml({ notes: thick });
  const easy = A.toMusicXml({ notes: thick }, { easy: true });
  ok('an easier arrangement keeps fewer notes than the dense accompaniment',
    easy.stats.notes < full.stats.notes && easy.stats.notes <= 8 * 2 + 1,
    'full ' + full.stats.notes + ', easy ' + easy.stats.notes);
  const hiLo = A._.simplifyNotes(thick.filter((_, i) => i < 7));
  ok('simplify keeps the top and the bass of a chord',
    hiLo.some(n => n.midi === 72) && hiLo.some(n => n.midi === 48) && !hiLo.some(n => n.midi === 60),
    hiLo.map(n => n.midi).join(','));

  const arrangedBeginner = A.toMusicXml({ notes: thick }, { arrangement: { level: 'beginner', style: 'balanced' } });
  const arrangedIntermediate = A.toMusicXml({ notes: thick }, { arrangement: { level: 'intermediate', style: 'balanced' } });
  const arrangedAdvanced = A.toMusicXml({ notes: thick }, { arrangement: { level: 'advanced', style: 'balanced' } });
  ok('arrangement levels add detail progressively',
    arrangedBeginner.stats.notes < arrangedIntermediate.stats.notes &&
      arrangedIntermediate.stats.notes < arrangedAdvanced.stats.notes && arrangedAdvanced.stats.notes < full.stats.notes,
    [arrangedBeginner.stats.notes, arrangedIntermediate.stats.notes, arrangedAdvanced.stats.notes, full.stats.notes].join(' < '));
  ok('arranging does not re-detect a different beat or metre',
    arrangedBeginner.stats.tempo === full.stats.tempo &&
      arrangedBeginner.stats.beatsPerBar === full.stats.beatsPerBar &&
      arrangedBeginner.stats.beatType === full.stats.beatType,
    arrangedBeginner.stats.beatsPerBar + '/' + arrangedBeginner.stats.beatType + ' @ ' + arrangedBeginner.stats.tempo);
  const inputPitches = new Set(thick.map(n => n.midi));
  const aiPlan = A.recommendArrangement(thick, 'intermediate');
  const arrangedNotes = A.arrangeNotes(thick, Object.assign({}, aiPlan.plan, { source: 'ai' }));
  ok('AI arrangement parameters cannot invent pitches',
    arrangedNotes.every(n => inputPitches.has(n.midi)) && aiPlan.plan.level === 'intermediate',
    arrangedNotes.length + ' selected notes, ' + aiPlan.plan.style);
  const melodyFocus = A.arrangeNotes(thick, { level: 'advanced', style: 'melody' });
  const accompanimentFocus = A.arrangeNotes(thick, { level: 'intermediate', style: 'accompaniment' });
  ok('texture choices produce different playable reductions',
    melodyFocus.length < arrangedAdvanced.stats.notes &&
      accompanimentFocus.some(n => n.midi === 55) && !arrangedNotes.some(n => n.midi === 55),
    'melody ' + melodyFocus.length + ', accompaniment keeps low harmony');

  ok('a 12/8 lock writes compound twelve',
    locked12.stats.beatsPerBar === 12 && locked12.stats.beatType === 8 && /<beat-type>8<\/beat-type>/.test(locked12.xml) && /<beats>12<\/beats>/.test(locked12.xml),
    locked12.stats.beatsPerBar + '/' + locked12.stats.beatType);

  const cBeats = [], cDown = [];
  for (let i = 0; i < 40; i++) cBeats.push(0.5 + i * 1.0);
  for (let i = 0; i < 10; i++) cDown.push(0.5 + i * 4.0);
  const c12 = A.toMusicXml({
    notes: perform(compound(8), { bpm: 90, start: 0.5, jitter: 0.008, seed: 6 }),
    beats: cBeats, downbeats: cDown
  });
  ok('audio downbeats every four pulses become 12/8',
    c12.stats.beatsPerBar === 12 && c12.stats.beatType === 8,
    c12.stats.beatsPerBar + '/' + c12.stats.beatType + ' source ' + c12.stats.beatSource);

  console.log('\n── spelling ──');
  const dominantHeavyMinor = [];
  [8, 11, 5, 8, 13, 8, 9].forEach((count, i) => {
    const pc = [0, 2, 3, 5, 7, 8, 10][i];
    for (let k = 0; k < count; k++) dominantHeavyMinor.push({ on: k, off: k + 1, midi: 48 + pc, vel: 70 });
  });
  const minorKey = A._.estimateKey(dominantHeavyMinor);
  ok('key signature fit keeps dominant-heavy C minor at three flats',
    minorKey.fifths === -3 && minorKey.mode === 'minor', minorKey.fifths + ' ' + minorKey.mode);
  const nm = s => s.step + (s.alter > 0 ? '#'.repeat(s.alter) : 'b'.repeat(-s.alter));
  const row = (fifths, mode, tonic) => { const t = A._.spellingTable({ fifths, mode, tonic }); return [...Array(12).keys()].map(pc => nm(t[pc])).join(' '); };
  ok('D major writes C natural, not B sharp', row(2, 'major', 2).split(' ')[0] === 'C', row(2, 'major', 2));
  ok('A minor raises its seventh to G sharp', row(0, 'minor', 9).split(' ')[8] === 'G#', row(0, 'minor', 9));
  ok('D minor leads with C sharp', row(-1, 'minor', 2).split(' ')[1] === 'C#', row(-1, 'minor', 2));
  ok('E flat major stays in flats', row(-3, 'major', 3) === 'C Db D Eb E F Gb G Ab A Bb B', row(-3, 'major', 3));
  const sp = A._.spell(61, A._.spellingTable({ fifths: 2, mode: 'major', tonic: 2 }));
  ok('octave follows the letter', sp.step === 'C' && sp.alter === 1 && sp.octave === 4, 'C#4 = ' + sp.step + sp.alter + '/' + sp.octave);

  console.log('\n── note values ──');
  const beatTicks = A._.Q;
  const crosses = (pos, len, bar) => {
    let p = pos;
    return A._.pieces(pos, len, bar).some(v => {
      const bad = (p % beatTicks) && Math.floor(p / beatTicks) !== Math.floor((p + v - 1) / beatTicks);
      p += v; return bad;
    });
  };
  ok('an off-beat note never hides a beat', ![[6, 36], [18, 30], [12, 54], [30, 42]].some(([p, l]) => crosses(p, l, 96)));
  ok('a whole bar is one whole note', A._.pieces(0, 96, 96).join() === '96');
  ok('three beats from the downbeat are a dotted half', A._.pieces(0, 72, 72).join() === '72');

  /* Audio cannot tell a composer's phrase slurs from pedal and room decay.
     Preserve the observed key-up and avoid manufacturing tied fragments for
     a short exact value merely because it crosses a beat. */
  ok('a short exact note value is not split into fake legato ties',
    A._.notePieces(18, 9, 96, 24).join() === '9', A._.notePieces(18, 9, 96, 24).join('+'));
  ok('ordinary values stay one note in 4/4 instead of becoming fake ties',
    A._.notePieces(18, 24, 96, 24).join() === '24' &&
    A._.notePieces(12, 48, 96, 24).join() === '48',
    A._.notePieces(18, 24, 96, 24).join('+') + ', ' + A._.notePieces(12, 48, 96, 24).join('+'));
  ok('compound-time beat crossings remain explicitly readable',
    A._.notePieces(30, 12, 72, 36).length > 1,
    A._.notePieces(30, 12, 72, 36).join('+'));
  const articulationGrid = {
    ticksPerQuarter: 24, beatsPerBar: 4, beatType: 4, bpm: 176,
    notes: [
      { midi: 72, tick: 18, endTick: 27, vel: 70, staff: 1 },
      { midi: 74, tick: 30, endTick: 36, vel: 70, staff: 1 },
      { midi: 76, tick: 42, endTick: 48, vel: 70, staff: 1 },
      { midi: 77, tick: 54, endTick: 60, vel: 70, staff: 1 },
      { midi: 48, tick: 0, endTick: 6, vel: 60, staff: 2 },
      { midi: 50, tick: 12, endTick: 18, vel: 60, staff: 2 },
      { midi: 52, tick: 24, endTick: 30, vel: 60, staff: 2 },
      { midi: 53, tick: 36, endTick: 42, vel: 60, staff: 2 }
    ]
  };
  const articulated = A.toMusicXml({ grid: articulationGrid, pedals: [{ on: 0, off: 1.2 }] });
  const artificialTies = (articulated.xml.match(/<tie type=/g) || []).length;
  const leftStaff = (articulated.xml.split('<backup>')[1] || '');
  ok('pedal and short release gaps do not lengthen written notes',
    artificialTies === 0 && /<duration>6<\/duration><voice>5<\/voice>[\s\S]*?<rest\/><duration>6<\/duration>/.test(leftStaff),
    'ties ' + artificialTies);

  console.log('\n── honest failure ──');
  let nothing = null;
  try { A.toMusicXml({ notes: [{ on: 1, off: 1.2, midi: 60, vel: 60 }] }); } catch (e) { nothing = e; }
  ok('a recording with no piano in it is refused, not padded out', nothing && nothing.code === 'no-notes', nothing && nothing.message);

  console.log('\n── Transkun launch path ──');
  const pyCands = [
    process.env.PPP_TRANSCRIBE_PYTHON,
    path.join(__dirname, '..', 'tools', 'transcribe-venv', 'Scripts', 'python.exe'),
    path.join(__dirname, '..', 'tools', 'transcribe-venv', 'bin', 'python'),
    'python'
  ].filter(Boolean);
  const py = pyCands.find(c => c === 'python' || fs.existsSync(c)) || 'python';
  const launched = spawnSync(py, ['-c', [
    'import json,sys,os',
    'sys.path.insert(0, ' + JSON.stringify(path.join(__dirname, '..')) + ')',
    'import transcribe',
    'print(json.dumps(transcribe.transkun_cmd(' + JSON.stringify(py) + ', "in.wav", "out.mid", "cuda")))'
  ].join('; ')], { encoding: 'utf8', timeout: 20000 });
  let cmds = null;
  try { cmds = JSON.parse((launched.stdout || '').trim().split('\n').pop()); } catch (e) { cmds = null; }
  ok('the shipped worker exposes transkun_cmd', !!(cmds && cmds.module && cmds.script), (launched.stderr || launched.stdout || '').slice(0, 240));
  ok('Transkun is invoked as python -m transkun.transcribe',
    cmds && cmds.module[1] === '-m' && cmds.module[2] === 'transkun.transcribe',
    cmds && cmds.module.join(' '));
  ok('the module command passes wav, midi and device',
    cmds && cmds.module.indexOf('in.wav') > -1 && cmds.module.indexOf('out.mid') > -1 &&
    cmds.module.indexOf('--device') > -1 && cmds.module.indexOf('cuda') > -1);
  ok('the fallback is the venv transkun console script, not transkun.commandline',
    cmds && /transkun(\.exe)?$/i.test(cmds.script[0]) &&
    path.dirname(cmds.script[0]).toLowerCase() === path.dirname(py).toLowerCase() &&
    cmds.script.indexOf('in.wav') > -1,
    cmds && cmds.script[0]);
  const help = spawnSync(py, ['-m', 'transkun.transcribe', '-h'], { encoding: 'utf8', timeout: 20000 });
  if (help.status === 0 && /audioPath|outPath/i.test(help.stdout || help.stderr || '')) {
    ok('installed Transkun answers python -m transkun.transcribe -h', true);
  } else {
    console.log('  · Transkun module: SKIPPED (' + (help.status == null ? 'python missing' : 'not installed') + ')');
  }

  /* ============ the parser, the review and the UI ============ */
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.PPP && window.PPP.Import && window.PPPAudioScore, { timeout: 25000 });

  console.log('\n── the written score reads back ──');
  const back = await page.evaluate((xml, stats) => {
    const sc = PPP.parseMusicXML(xml, 'waltz');
    const m0 = sc.measures[0];
    const full = sc.measures.every(mm => {
      const ns = sc.notes.filter(n => n.m === mm.number);
      const end = [1, 2].map(st => ns.filter(n => (n.staff || 1) === st && !n.chord).reduce((s, n) => s + n.dur, 0));
      return Math.abs(end[0] - 3) < 1e-6 && Math.abs(end[1] - 3) < 1e-6;
    });
    const rep = PPP.Import.validateTranscription(sc, stats, { duration: 40 });
    const ensemble = PPP.Import.validateTranscription(sc, stats, {
      duration: 40, engine: 'ensemble',
      ensemble: { models: ['transkun', 'piano-transcription', 'aria-amt'], agreement: 0.94, accepted: stats.notes, uncertain: 2 }
    });
    const shaky = PPP.Import.validateTranscription(sc, Object.assign({}, stats, { tempoVariation: 0.3, gridError: 0.2 }), { duration: 40 });
    const fallback = PPP.Import.validateTranscription(sc, stats, { duration: 40, engine: 'basic-pitch' });
    const browserPiano = PPP.Import.validateTranscription(sc, stats, { duration: 40, engine: 'onsets-and-frames' });
    const dense = PPP.Import.validateTranscription(sc, Object.assign({}, stats, { notes: 900 }), { duration: 40, engine: 'basic-pitch' });
    const noisyBars = Object.assign({}, stats, {
      beatSource: 'audio', barStarts: [0, 1, 2, 3],
      perBar: [
        { bar: 1, notes: 20, gridError: 0.18, stretch: 1.0 },
        { bar: 2, notes: 20, gridError: 0.27, stretch: 1.0 }
      ]
    });
    const barReview = PPP.Import.validateTranscription(sc, noisyBars, { duration: 40 });
    const lockedReview = PPP.Import.validateTranscription(sc, Object.assign({}, noisyBars, { beatSource: 'lock' }), { duration: 40 });
    const legacyScore = JSON.parse(JSON.stringify(sc));
    legacyScore.source = { kind: 'youtube', status: 'transcribed', amt: 'ensemble', transcriptionVersion: 2 };
    const migrated = PPP.migrateSavedTranscription(legacyScore, legacyScore.source, {
      level: 'fair', confidence: 0.8, suspectMeasures: [1, 2, 5],
      summary: 'old red bars', advice: 'old advice', issues: [{ kind: 'bars' }, { kind: 'dense' }]
    });
    const packedScore = PPP.packScore(sc);
    const unpackedScore = PPP.unpackScore(JSON.parse(JSON.stringify(packedScore)));
    const rawScoreSize = JSON.stringify(Object.assign({}, sc, { _byNumber: undefined })).length;
    const packedScoreSize = JSON.stringify(packedScore).length;
    return {
      measures: sc.measures.length, time: m0.time.beats + '/' + m0.time.beatType, fifths: m0.key.fifths,
      staves: sc.staves, hands: [...new Set(sc.notes.filter(n => !n.rest).map(n => n.hand))].sort().join(''),
      full: full, level: rep.level, conf: rep.confidence, shaky: shaky.level, shakyKinds: shaky.issues.map(i => i.kind).join(','),
      singleKind: rep.confidenceKind, singleKinds: rep.issues.map(i => i.kind).join(','),
      ensembleLevel: ensemble.level, ensembleKind: ensemble.confidenceKind, ensembleAgreement: ensemble.modelAgreement,
      fallbackLevel: fallback.level, fallbackConf: fallback.confidence, fallbackKinds: fallback.issues.map(i => i.kind).join(','),
      browserPianoLevel: browserPiano.level, browserPianoConf: browserPiano.confidence, browserPianoKinds: browserPiano.issues.map(i => i.kind).join(','),
      denseLevel: dense.level, denseKinds: dense.issues.map(i => i.kind).join(','),
      reviewedBars: barReview.suspectMeasures.join(','), lockedBars: lockedReview.suspectMeasures.join(','),
      migratedVersion: migrated.source.transcriptionVersion,
      migratedBars: migrated.report.suspectMeasures.join(','),
      migratedKinds: migrated.report.issues.map(i => i.kind).join(','),
      migratedSummary: migrated.report.summary,
      packedRatio: packedScoreSize / rawScoreSize,
      rawNotes: sc.notes.length,
      unpackedNotes: unpackedScore.notes.length,
      unpackedPitch: unpackedScore.notes.find(n => !n.rest).p
    };
  }, w.xml, w.stats);
  ok('the parser reads it as written', back.measures === 16 && back.time === '3/4' && back.fifths === 1 && back.staves === 2,
    back.measures + ' bars, ' + back.time + ', ' + back.fifths + ' sharp, ' + back.staves + ' staves');
  ok('both hands are playable', back.hands === 'lr', back.hands);
  ok('every bar of every staff adds up', back.full);
  ok('one model is presented as an estimate, not self-certified accuracy',
    back.level !== 'good' && back.singleKind === 'single-model-estimate' && /single-model/.test(back.singleKinds),
    back.level + ' ' + Math.round(back.conf * 100) + '%: ' + back.singleKinds);
  ok('high independent model agreement can support a good result without claiming perfection',
    back.ensembleLevel === 'good' && back.ensembleKind === 'model-agreement' && back.ensembleAgreement === 0.94,
    back.ensembleLevel + ': ' + back.ensembleAgreement);
  ok('a wandering tempo and loose rhythm are said out loud', back.shaky !== 'good' && /tempo/.test(back.shakyKinds) && /rhythm/.test(back.shakyKinds),
    back.shaky + ': ' + back.shakyKinds);
  ok('the general fallback can never masquerade as a high-confidence piano transcription',
    back.fallbackLevel !== 'good' && back.fallbackConf <= 0.62 && /fallback/.test(back.fallbackKinds),
    back.fallbackLevel + ' ' + Math.round(back.fallbackConf * 100) + '%: ' + back.fallbackKinds);
  ok('a browser-only Onsets & Frames draft is also never presented as a trusted local transcription',
    back.browserPianoLevel !== 'good' && back.browserPianoConf <= 0.62 && /fallback/.test(back.browserPianoKinds),
    back.browserPianoLevel + ' ' + Math.round(back.browserPianoConf * 100) + '%: ' + back.browserPianoKinds);
  ok('an implausibly dense fallback is called out instead of reporting zero checks',
    back.denseLevel !== 'good' && /dense/.test(back.denseKinds), back.denseLevel + ': ' + back.denseKinds);
  ok('performance timing alone never paints notation measures red',
    back.reviewedBars === '', back.reviewedBars);
  ok('a rhythm the player explicitly locked is not marked red against the old performance grid',
    back.lockedBars === '', back.lockedBars);
  ok('saved transcriptions discard red bars produced by the retired validator',
    back.migratedVersion === 7 && back.migratedBars === '' && back.migratedKinds === 'dense' && back.migratedSummary == null,
    JSON.stringify({ version: back.migratedVersion, bars: back.migratedBars, kinds: back.migratedKinds }));
  ok('large saved scores use compact note rows and unpack without losing notes',
    back.packedRatio < 0.65 && back.unpackedNotes === back.rawNotes && !!back.unpackedPitch,
    Math.round(back.packedRatio * 100) + '% size, ' + back.unpackedNotes + ' notes');

  const gridBack = await page.evaluate(xml => {
    const sc = PPP.parseMusicXML(xml, 'jig');
    const m0 = sc.measures[0];
    const trips = sc.notes.filter(n => n.tm && n.tm.a === 3).length;
    return { time: m0.time.beats + '/' + m0.time.beatType, measures: sc.measures.length, tuplets: trips };
  }, g.xml);
  ok('the parser keeps 6/8 from the grid', gridBack.time === '6/8' && gridBack.measures === 4, gridBack.time + ', ' + gridBack.measures + ' bars');

  const ottavaBack = await page.evaluate(() => {
    const xml = `<?xml version="1.0"?><score-partwise version="3.1">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
          <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
          <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
        <direction placement="above"><direction-type><octave-shift type="up" size="8"/></direction-type><staff>1</staff></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
        <direction placement="above"><direction-type><octave-shift type="stop" size="8"/></direction-type><staff>1</staff></direction>
      </measure></part></score-partwise>`;
    const score = PPP.parseMusicXML(xml, 'ottava.musicxml');
    const note = score.notes.find(n => !n.rest);
    const plan = PPP.PianoScore.of(score);
    return {
      written: note.writtenP,
      sounding: note.p,
      writtenMidi: note.writtenMidi,
      soundingMidi: note.soundingMidi,
      shift: note.ottavaShift,
      strike: plan.strikes[0] && plan.strikes[0].midi,
      ranges: score.ottavas.length
    };
  });
  ok('8va keeps written and sounding pitches separate',
    ottavaBack.written === 'C4' && ottavaBack.sounding === 'C5' &&
      ottavaBack.writtenMidi === 60 && ottavaBack.soundingMidi === 72 &&
      ottavaBack.shift === 12 && ottavaBack.strike === 72 && ottavaBack.ranges === 1,
    JSON.stringify(ottavaBack));

  const tripBack = await page.evaluate(xml => {
    const sc = PPP.parseMusicXML(xml, 'trips');
    return {
      time: sc.measures[0].time.beats + '/' + sc.measures[0].time.beatType,
      tm: sc.notes.filter(n => n.tm && n.tm.a === 3 && n.tm.n === 2).length,
      tupletMarks: sc.notes.filter(n => n.tupletStart || n.tupletStop).length
    };
  }, trp.xml);
  ok('the parser keeps triplet time-modification', tripBack.tm >= 8, 'tm ' + tripBack.tm + ', marks ' + tripBack.tupletMarks);

  const cat = await page.evaluate(async () => {
    const hit = await PPP.Import.findScore('Satie Gymnopédie No. 1');
    const miss = await PPP.Import.findScore('zzzxq-not-a-piece-999');
    if (!hit || !hit.entry || !hit.entry.xml) return { ok: false };
    const aligned = PPP.Import.alignScore(hit.entry.xml, { duration: 20 });
    return {
      ok: true, title: hit.entry.title, retrieved: !!hit.retrieved, license: hit.entry.license,
      miss: miss, bars: aligned.measures, cover: aligned.barStarts && aligned.barStarts[aligned.barStarts.length - 1] >= 20,
      starts: aligned.barStarts && aligned.barStarts.length
    };
  });
  ok('a catalog title returns the public-domain score', cat.ok && /Gymnop/i.test(cat.title) && cat.retrieved && cat.license === 'CC0', JSON.stringify(cat));
  ok('alignment covers the recording duration', cat.cover && cat.starts > 2, 'starts ' + cat.starts);
  ok('a nonsense title does not match', cat.miss == null, String(cat.miss));
  const grounded = await page.evaluate(xml => {
    const score = PPP.parseMusicXML(xml, 'reference.musicxml');
    const first = score.measures[0];
    const last = score.measures[score.measures.length - 1];
    const quarters = last.startQ + last.lenQ - first.startQ;
    const printed = quarters * 60 / score.tempo;
    const duration = 0.8 + printed * 1.05;
    const a = PPP.Import.alignReference(score, { start: 0.8, duration: duration });
    return {
      bars: a.measures, starts: a.barStarts.length, first: a.barStarts[0],
      last: a.barStarts[a.barStarts.length - 1], duration: duration, stretch: a.stretch
    };
  }, w.xml);
  ok('a reference score keeps its written bars and aligns them to the recording',
    grounded.bars === 16 && grounded.starts === 17 && Math.abs(grounded.first - 0.8) < 0.001 &&
      Math.abs(grounded.last - grounded.duration) < 0.002 && Math.abs(grounded.stretch - 1.05) < 0.002,
    JSON.stringify(grounded));
  const localGrounded = await page.evaluate(xml => {
    const score = PPP.parseMusicXML(xml, 'rubato-reference.musicxml');
    const heard = { notes: [] };
    score.notes.filter(n => !n.rest && !n.tieStop).forEach(n => {
      const q = n.abs - score.measures[0].startQ;
      const on = 0.6 + Math.min(q, 24) * 0.6 + Math.max(0, q - 24) * 0.75;
      heard.notes.push({ on: on, off: on + Math.max(0.08, n.dur * 0.55), midi: n.midi, vel: 70 });
    });
    const a = PPP.Import.alignReference(score, { start: 0.6, duration: 33, heard: heard });
    return { method: a.method, anchors: a.anchors, first: a.barStarts[0], mid: a.barStarts[8], last: a.barStarts[16] };
  }, w.xml);
  ok('a reference score follows local performance tempo instead of one global stretch',
    localGrounded.method === 'note-anchors' && localGrounded.anchors >= 8 &&
      Math.abs(localGrounded.first - 0.6) < 0.08 && Math.abs(localGrounded.mid - 15) < 0.2 &&
      Math.abs(localGrounded.last - 33) < 0.35,
    JSON.stringify(localGrounded));
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'Piano Coach App.dc.html'), 'utf8');
  ok('the recording review offers a reference-score replacement path', /data-reference-score/.test(appSource));
  ok('the recording review offers level, texture and AI arrangement controls',
    /data-arrangement-level/.test(appSource) && /data-arrangement-style/.test(appSource) &&
      /option value="jazz"/.test(appSource) && /data-ai-arrangement/.test(appSource));
  ok('recording imports distinguish faithful transcription from playable arrangement',
    /Solo piano \(faithful transcription\)/.test(appSource) && /Full song \(playable piano arrangement\)/.test(appSource));
  ok('a saved YouTube score can still be replaced after its temporary audio object is gone',
    /showReferenceScore:[^\n]+\['youtube', 'audio', 'video'\]/.test(appSource));
  const coverTitle = await page.evaluate(async () => {
    const hit = await PPP.Import.findScore('Gymnopedie No. 1 piano cover Synthesia');
    return hit && hit.entry && hit.entry.id;
  });
  ok('a padded YouTube title still finds the catalog score', coverTitle === 'gymnopedie-1', String(coverTitle));
  ok('oEmbed title lookup is wired', await page.evaluate(() => typeof PPP.Import.youtubeTitle === 'function'));

  const refusals = await page.evaluate(async () => {
    const out = {};
    try { await PPP.Import.loadYoutube('https://vimeo.com/1', () => {}); } catch (e) { out.notYt = e.message; }
    try { await PPP.Import.load({ name: 'big.mp4', size: 900 * 1024 * 1024 }, () => {}); } catch (e) { out.big = e.message; }
    out.limit = Math.round(PPP.IMPORT_LIMITS.maxAudioBytes / 1048576);
    return out;
  });
  ok('a link that is not YouTube is refused before anything is sent', /not a link to a YouTube video/.test(refusals.notYt || ''), refusals.notYt);
  ok('an oversized video is refused with the limit', /limit is \d+ MB/.test(refusals.big || ''), refusals.big);

  /* ============ end to end, when the helper can listen ============ */
  const health = await helperHealth();
  if (!(health && health.transcriber)) {
    console.log('\n── recording → score through the UI: SKIPPED (' + (health ? 'transcription not set up' : 'local helper not running') + ') ──');
    const said = await page.evaluate(async () => {
      window.__pppTest.upload();
      await new Promise(r => setTimeout(r, 600));
      return (document.querySelector('[data-youtube]') || {}).innerText || '';
    });
    ok('the add page says recordings need the helper, before anyone tries', /local helper/i.test(said), said.split('\n').pop());
  } else {
    console.log('\n── recording → score through the UI ──');
    const wav = path.join(os.tmpdir(), 'ppp-waltz-' + process.pid + '.wav');
    synthWav(perform(waltz(8), { bpm: 92, start: 0.8, jitter: 0.01, seed: 5 }), wav);
    await page.evaluate(() => window.__pppTest.upload());
    await sleep(400);
    const input = await page.$('input[type=file][data-add-file]');
    await input.uploadFile(wav);
    await page.waitForFunction(() => /Listening for piano notes|Taking the sound|Handing the recording/.test(document.body.innerText), { timeout: 20000 })
      .then(() => ok('progress is reported while the helper listens', true))
      .catch(() => ok('progress is reported while the helper listens', false));
    await page.waitForFunction(() => !!document.querySelector('[data-recording]') || /could not|Import failed/i.test(document.body.innerText), { timeout: 240000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const t = (document.querySelector('main') || document.body).innerText;
      const stat = label => { const m = t.match(new RegExp('(?:^|\\n)' + label + '\\s*\\n\\s*([0-9]+)', 'i')); return m ? +m[1] : 0; };
      return {
        review: !!document.querySelector('[data-recording]'), audio: !!document.querySelector('[data-recording] audio'),
        measures: stat('Measures'), notes: stat('Notes'), time: (t.match(/(?:^|\n)Time\s*\n\s*(\d\/\d)/i) || [])[1] || '',
        text: t.slice(0, 200)
      };
    });
    ok('a recording reaches the review screen', r.review, r.review ? r.measures + ' measures, ' + r.notes + ' notes, ' + r.time : r.text);
    ok('the recording can be heard beside the notation', r.audio);
    ok('what was played is roughly what was written', r.measures >= 7 && r.measures <= 9 && r.notes >= 60,
      r.measures + ' measures (8 played), ' + r.notes + ' notes (80 played)');
    ok('and in the right metre', r.time === '3/4', r.time);
    const lockUi = await page.evaluate(() => ({
      lock: !!document.querySelector('[data-rhythm-lock]'),
      rewrite: !!document.querySelector('[data-lock-rewrite]'),
      easier: !!document.querySelector('[data-easier]'),
      metre: (document.querySelector('[data-lock-metre]') || {}).value || '',
      bpm: (document.querySelector('[data-lock-bpm]') || {}).value || ''
    }));
    ok('the review can lock metre, tempo and downbeat', lockUi.lock && lockUi.rewrite && /\d\/\d/.test(lockUi.metre), JSON.stringify(lockUi));
    ok('the review offers an easier arrangement', lockUi.easier);
    await page.click('[data-lock-rewrite]');
    await sleep(800);
    const afterLock = await page.evaluate(() => !!document.querySelector('[data-recording]'));
    ok('rewrite rebuilds notation from the notes already heard', afterLock);
    await page.select('[data-arrangement-level]', 'beginner');
    await page.select('[data-arrangement-style]', 'melody');
    await page.click('[data-apply-arrangement]');
    await sleep(900);
    const beginnerCount = await page.evaluate(() => {
      const t = (document.querySelector('main') || document.body).innerText;
      const m = t.match(/(?:^|\n)Notes\s*\n\s*([0-9]+)/i);
      return m ? +m[1] : 0;
    });
    ok('a beginner arrangement is applied without transcribing again',
      beginnerCount > 0 && beginnerCount < r.notes, beginnerCount + ' notes from ' + r.notes);
    await page.select('[data-arrangement-level]', 'original');
    await page.click('[data-apply-arrangement]');
    await sleep(900);
    const restoredCount = await page.evaluate(() => {
      const t = (document.querySelector('main') || document.body).innerText;
      const m = t.match(/(?:^|\n)Notes\s*\n\s*([0-9]+)/i);
      return m ? +m[1] : 0;
    });
    ok('the original transcription can be restored', restoredCount === r.notes,
      restoredCount + ' notes restored');
    await page.select('[data-arrangement-level]', 'intermediate');
    await page.select('[data-arrangement-style]', 'jazz');
    await page.click('[data-apply-arrangement]');
    await sleep(900);
    const jazzReview = await page.evaluate(() => ({
      style: (((window.PPP.app.state.importSource || {}).arrangement || {}).style || ''),
      notes: window.PPP.app.state.score.notes.filter(n => !n.rest).length,
      measures: window.PPP.Score.count(window.PPP.app.state.score)
    }));
    ok('a rich style can be applied before accepting the transcription',
      jazzReview.style === 'jazz' && jazzReview.notes > 0 && jazzReview.measures === r.measures,
      JSON.stringify(jazzReview));
    await page.select('[data-arrangement-level]', 'original');
    await page.select('[data-arrangement-style]', 'balanced');
    await page.click('[data-apply-arrangement]');
    await sleep(800);
    try {
      await page.screenshot({ path: process.env.PPP_LOCK_SHOT || 'tests/.shots/review-lock.png', fullPage: false });
    } catch (e) {}
    if (health.amt) ok('health names the AMT engine', ['kong', 'transkun', 'ensemble'].includes(health.amt), String(health.amt));
    if (health.beatThis) {
      const beatLine = await page.evaluate(() => /from the recording/i.test(document.body.innerText));
      ok('a helper with Beat This returns audio beats', beatLine, 'review mentions audio beats');
    } else console.log('  · Beat This: SKIPPED (not installed)');
    if (health.pm2s) {
      const used = await page.evaluate(() => /PM2S/.test(document.body.innerText));
      ok('a helper with PM2S quantized the waltz', used);
    } else console.log('  · PM2S: SKIPPED (not installed)');
    if (health.transkun || (health.amtEngines || []).includes('transkun'))
      ok('Transkun participates in the AMT result', true, health.amt);
    else console.log('  · Transkun: SKIPPED (Kong remains)');

    const played = await page.evaluate(async () => {
      const b = [...document.querySelectorAll('[data-recording] button')][0];
      if (b) b.click();
      await new Promise(r => setTimeout(r, 700));
      const a = document.querySelector('[data-recording] audio');
      return a ? { t: a.currentTime, paused: a.paused } : null;
    });
    ok('"Play measures" plays the recording from those measures', played && played.t > 0, played ? played.t.toFixed(2) + 's' : 'no audio');

    const shelf = await page.evaluate(async () => {
      [...document.querySelectorAll('main button')].find(x => /Accept and practise/.test(x.innerText)).click();
      await new Promise(r => setTimeout(r, 500));
      window.__pppTest.nav('My Songs');
      await new Promise(r => setTimeout(r, 500));
      return [...document.querySelectorAll('[data-song]')].map(c => c.innerText.split('\n').join(' · '));
    });
    ok('an accepted transcription joins My Songs', shelf.some(s => /ppp-waltz/.test(s) && /recording/i.test(s)), shelf.join(' | '));
    try { fs.unlinkSync(wav); } catch (e) {}
  }

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('Recordings become scores PPP can practise, and say how sure they are.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
