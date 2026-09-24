/* ============================================================================
   PPP ScoreGraph — the app's Score, made from a graph (G01 Appendix B, G02 §14)

   toScore(graph, opts) -> the object PPP.Score.finalize() takes
     opts: {name, id, tempo}

   The app's renderer, player, practice and arranger all read one shape: the
   Score that parseMusicXML builds. Moving the import boundary onto the graph
   means building that same shape from the graph instead, so that nothing
   downstream can tell which reader ran (G01 §15.2 S3).

   The contract is parity, not improvement. Where the app reads something in a
   way this library would not - dynamics and tempo taken from every part, the
   piano chosen as the part with two staves or else the last one, an octave
   shift applied to what sounds - the adapter reproduces the app, and the
   difference is left to the Goal that owns it. compare() below is what proves
   it: field by field over every committed file (A32, A33).

   Nothing here is an opinion about the music. It is a projection.

   G4a (docs/GOALS/G04 §8.2) adds the way back and the checks between the two:
     unfinalize(score)      the Score as toScore makes it, before Score.finalize moved it
     comparable(score)      the fields compare() reads, in one canonical note order
     agree(score, graph)    do a Score and a graph state the same music? (compare() on both)
     link(score, graph)     which graph event and head each Score note is
     fromScore(score)       a graph for a Score that has none (a saved, shared or old song)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./pitch.js'), require('./time.js'),
      require('./build.js'));
  else {
    const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {};
    M.legacyScore = factory(M.rational, M.schema, M.pitch, M.time, M.build);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, P, T, Build) {
  'use strict';

  const Q = w => R.toNumber(R.mul(R.parse(w), R.make(4)));      /* W -> quarters, the app's unit */
  const CLEF = { G: 'treble', F: 'bass', C: 'alto', percussion: 'percussion', TAB: 'treble', none: 'treble' };
  const ACC_NAME = { sharp: 'sharp', flat: 'flat', natural: 'natural', 'double-sharp': 'double-sharp',
    'flat-flat': 'flat-flat', 'sharp-sharp': 'sharp-sharp', 'natural-sharp': 'natural-sharp',
    'natural-flat': 'natural-flat', 'quarter-sharp': 'quarter-sharp', 'quarter-flat': 'quarter-flat' };
  const DYN_VEL = { pppppp: 8, ppppp: 12, pppp: 16, ppp: 24, pp: 36, p: 50, mp: 64, mf: 78, f: 92,
    ff: 106, fff: 118, ffff: 124, fffff: 126, ffffff: 127 };

  const pitchName = p => p.step + (p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : '') + p.oct;
  const round6 = x => Math.round(x * 1e6) / 1e6;

  function toScore(g, opts) {
    opts = opts || {};
    const name = opts.name || null;
    const ctx = T.ctx(g);
    const mIndex = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    /* the app numbers a measure by its <measure number>, or by its position when that is not a number */
    const numberOf = g.timeline.measures.map((m, i) => {
      const n = parseInt(m.number, 10);
      return isFinite(n) ? n : i + 1;
    });

    /* ------------------------------------------------- the staff numbering */
    /* the app lays every part's staves end to end, so a second single-staff part becomes staff 2 */
    const partBase = [];
    let base = 0;
    g.parts.forEach(p => { partBase.push(base); base += Math.max(1, p.staves.length); });
    const globalStaff = (pi, staffId) => {
      const local = g.parts[pi].staves.findIndex(s => s.id === staffId);
      return partBase[pi] + (local < 0 ? 0 : local) + 1;
    };

    /* ------------------------------------------------------------ measures */
    const meterAt = [], keyAt = [];
    {
      let mt = null, ky = null;
      const metersBy = new Map(g.timeline.meters.map(x => [x.m, x]));
      const keysBy = new Map();
      (g.timeline.keys || []).forEach(k => {
        /* the app takes the key from the first part that states it, at the measure start */
        if (k.scope && k.scope.part !== g.parts[0].id) return;
        if (!keysBy.has(k.m)) keysBy.set(k.m, k);
      });
      g.timeline.measures.forEach(m => {
        if (metersBy.has(m.id)) mt = metersBy.get(m.id);
        if (keysBy.has(m.id)) ky = keysBy.get(m.id);
        meterAt.push(mt);
        keyAt.push(ky);
      });
    }
    /* the first part's clefs, by that part's own staff numbers, carried forward */
    const clefState = {};
    const clefsAt = [], clefChangesAt = [];
    {
      const byMeasure = new Map();
      (g.parts[0].clefs || []).forEach(c => {
        if (!byMeasure.has(c.m)) byMeasure.set(c.m, []);
        byMeasure.get(c.m).push(c);
      });
      g.timeline.measures.forEach(m => {
        const here = (byMeasure.get(m.id) || []).slice().sort((a, b) =>
          R.cmp(R.parse(a.at), R.parse(b.at)) || S.idNumber(a.id) - S.idNumber(b.id));
        /* The app snapshots the clefs when the first note of the bar arrives: a clef at the bar line
           is in that snapshot, a clef partway through is a change and is not (App 4003-4013). */
        const start = Object.assign({}, clefState);
        const changes = [];
        here.forEach(c => {
          const local = g.parts[0].staves.findIndex(s => s.id === c.staff) + 1;
          const nm = CLEF[c.sign] || 'treble';
          if (Q(c.at) > 1e-6) changes.push({ staff: local, b: Q(c.at), clef: nm });
          else start[local] = nm;
          clefState[local] = nm;
        });
        clefsAt.push(start);
        clefChangesAt.push(changes.length ? changes : null);
      });
    }

    /* endings and repeats, the way the app records them on the bar */
    /* The app fills one object per measure as it walks the bar lines, so the order the keys went in is
       part of what a comparison sees. An ending starts on the left bar line and stops on the right, so
       the start's keys come before the right bar line's repeat and style, and the stop's after. */
    const startEnding = new Map(), stopEnding = new Map();
    (g.timeline.endings || []).forEach(en => {
      const from = mIndex.get(en.from), to = mIndex.get(en.to);
      if (from !== undefined && !startEnding.has(from)) startEnding.set(from, en);
      if (to !== undefined && !stopEnding.has(to)) stopEnding.set(to, en);
    });
    const barAt = g.timeline.measures.map((m, i) => {
      const bar = {};
      const bl = m.barline || {};
      if (bl.left && bl.left.repeat === 'forward') bar.repeatStart = true;
      const st = startEnding.get(i);
      if (st) {
        const nos = st.numbers.slice();
        const said = st.text !== undefined ? st.text : '';
        bar.endingNos = nos;
        bar.endingType = 'start';
        bar.ending = said && /^[\d.,\s]+$/.test(said) ? said : nos.map(x => x + '.').join(' ');
      }
      /* the app keeps the number of times, not a flag; the default is two */
      if (bl.right && bl.right.repeat === 'backward') bar.repeatEnd = bl.right.times !== undefined ? bl.right.times : 2;
      if (bl.right && bl.right.style) bar.style = bl.right.style;
      const sp = stopEnding.get(i);
      if (sp) {
        bar.endingEnd = sp.open ? 'open' : 'stop';
        if (bar.endingType === undefined) bar.endingType = sp.open ? 'discontinue' : 'stop';
        if (bar.endingNos === undefined) bar.endingNos = sp.numbers.slice();
      }
      return bar;
    });

    const measures = g.timeline.measures.map((m, i) => {
      const mt = meterAt[i], ky = keyAt[i];
      const out = {
        number: numberOf[i],
        lenQ: round6(Q(m.dur)),
        /* the app reads <beats> with parseInt, so a compound "3+2" is three to it (App 3995) */
        time: { beats: mt ? mt.beats[0] : 4, beatType: mt ? mt.beatType : 4 },
        /* and it reads <fifths> as written; the graph stores the key that sounds (G01 §7.2) */
        key: { fifths: ky ? P.writtenFifths(ky.fifths, g.parts[0].instrument.transpose) : 0,
          mode: ky && ky.mode !== undefined ? ky.mode : 'major' },
        clefs: clefsAt[i],
        clefChanges: clefChangesAt[i],
        w: m.layout && m.layout.width !== undefined ? m.layout.width : null,
        bar: Object.keys(barAt[i]).length ? barAt[i] : null
      };
      return out;
    });

    /* -------------------------------------------------------------- notes */
    /* a <dynamics> inside a note's <notations> belongs to that note (App 4264-4268), so it is collected
       before the notes are built and left out of the score's line of dynamics below */
    const dynOnEvent = new Map();
    g.parts.forEach(part => part.directions.forEach(d => {
      if (d.kind === 'dynamic' && d.event !== undefined) dynOnEvent.set(d.event, d.value);
    }));
    const notes = [];
    const tieIn = new Set(), tieOut = new Set();
    const slurIn = new Set(), slurOut = new Set();
    const tupletStart = new Set(), tupletStop = new Set();
    const arpHeads = new Set();
    const tupletsOf = new Map();
    const spannerById = new Map();
    g.parts.forEach(part => {
      part.spanners.forEach(s => {
        spannerById.set(s.id, s);
        if (s.type === 'tie') { if (s.from) tieOut.add(s.from); if (s.to) tieIn.add(s.to); }
        else if (s.type === 'slur') { if (s.from) slurOut.add(s.from); if (s.to) slurIn.add(s.to); }
        else if (s.type === 'arpeggio') (s.heads || []).forEach(h => arpHeads.add(h));
        else if (s.type === 'tuplet') {
          (s.events || []).forEach(e => {
            if (!tupletsOf.has(e)) tupletsOf.set(e, []);
            tupletsOf.get(e).push(s);
          });
          if (s.printed !== false && s.events && s.events.length) {
            tupletStart.add(s.events[0]);
            tupletStop.add(s.events[s.events.length - 1]);
          }
        }
      });
    });
    /* an octave shift moves what sounds, the way the app reads it (issue 3; parity, G02 §14.3) */
    /* the part the app plays: the first with two staves, else the last (App 3955-3960) */
    let pianoGuess = g.parts.findIndex(p => p.staves.length >= 2);
    if (pianoGuess < 0) pianoGuess = g.parts.length - 1;

    const ottavas = [];
    g.parts.forEach((part, pi) => {
      if (pi !== pianoGuess) return;
      part.spanners.filter(s => s.type === 'ottava').forEach(s => {
        const from = mIndex.get(s.from.m), to = s.to ? mIndex.get(s.to.m) : undefined;
        if (from === undefined) return;
        const octaves = Math.abs(s.shift);
        /* the graph's shift is +1 for <octave-shift type="down">, which the app signs the other way */
        const dir = s.shift > 0 ? -1 : 1;
        ottavas.push({ m: numberOf[from], b: Q(s.from.at),
          endM: to === undefined ? null : numberOf[to], endB: s.to ? Q(s.to.at) : null,
          size: octaves === 1 ? 8 : octaves === 2 ? 15 : 22,
          dir: dir, semitones: dir * 12 * octaves,
          /* the app leaves the staff open when the file did, and then reads the shift on both */
          staff: (s.ext && s.ext['musicxml.ottava'] && s.ext['musicxml.ottava'].staff === 'assumed') || !s.staff
            ? null : globalStaff(pi, s.staff), number: null });
      });
    });

    g.parts.forEach((part, pi) => {
      const voiceLabel = new Map(part.voices.map((v, i) => {
        const n = parseInt(v.label, 10);
        return [v.id, isFinite(n) ? n : i + 1];
      }));
      /* D7. The graph holds the pitch that sounds; a transposing part is printed somewhere else.
         `p` and `midi` stay concert, because that is what every sound-making consumer reads, and
         the printed pitch goes in `writtenP`/`writtenMidi`, which is where the sheet renderer
         already looks (App 10659) and where the app's own octave-shift handling puts it. A piano
         does not transpose, so nothing below fires for it and its Score is untouched. */
      const tr = part.instrument && part.instrument.transpose;
      const transposes = !!(tr && (tr.chromatic || tr.diatonic || tr.octave));
      part.events.forEach(e => {
        const mi = mIndex.get(e.m);
        if (mi === undefined) return;
        if (e.grace) return;                        /* the app skips grace notes (R2) */
        const b = Q(e.at), dur = Q(e.dur);
        const voice = voiceLabel.get(e.voice) || 1;
        /* the innermost tuplet this event is in: the one no other tuplet of the event names as parent */
        const chain = tupletsOf.get(e.id) || [];
        const tu = chain.find(x => !chain.some(y => y !== x && y.parent === x.id)) || chain[0];
        const common = {
          m: numberOf[mi], b: b, dur: dur,
          voice: voice,
          type: e.display && e.display.type ? e.display.type : typeFromQ(dur),
          dots: e.display && e.display.dots ? e.display.dots : 0
        };
        /* MusicXML writes the product of the nested ratios on the note; the graph keeps them as a
           chain of Tuplets, so the chain is multiplied back out here */
        if (tu) {
          let a = 1, n = 1, t = tu, guard = 0;
          while (t && guard++ < 8) { a *= t.actual; n *= t.normal; t = t.parent ? spannerById.get(t.parent) : null; }
          common.tm = { a: a, n: n };
        }
        if (tupletStart.has(e.id)) common.tupletStart = true;
        if (tupletStop.has(e.id)) common.tupletStop = true;
        if (e.display && e.display.stem && (e.display.stem === 'up' || e.display.stem === 'down')) common.stem = e.display.stem;
        if (e.display && e.display.x !== undefined) common.dx = e.display.x;
        /* the graph keeps articulations on the event, because a chord is one event; the app keeps them
           on the <note> element that carried them, so they land on the first head */
        const accent = !!(e.arts && e.arts.indexOf('accent') >= 0);
        const marcato = !!(e.arts && e.arts.indexOf('marcato') >= 0);
        const dyn = dynOnEvent.get(e.id);

        if (e.kind === 'rest') {
          const r = Object.assign({}, common, { p: null, midi: null, staff: globalStaff(pi, e.staff),
            rest: true, chord: false, tieStop: false, tieStart: false,
            slurStart: slurOut.has(e.id), slurStop: slurIn.has(e.id),
            acc: null, hand: 'r', finger: undefined });
          /* opt-in: link() needs to know which event each note is; the app's own Score does not carry it */
          if (opts.ids) r.sgEvent = e.id;
          notes.push(r);
          return;
        }
        (e.heads || []).forEach((h, hi) => {
          const staffId = h.staff || e.staff;
          const n = Object.assign({}, common, {
            p: h.pitch ? pitchName(h.pitch) : null,
            midi: h.pitch ? P.midi(h.pitch) : null,
            staff: globalStaff(pi, staffId),
            rest: false,
            chord: hi > 0,
            tieStop: tieIn.has(h.id), tieStart: tieOut.has(h.id),
            slurStart: hi === 0 && slurOut.has(e.id), slurStop: hi === 0 && slurIn.has(e.id),
            acc: h.acc ? (ACC_NAME[h.acc.type] || h.acc.type) : null,
            hand: 'r',
            finger: h.fingering && h.fingering.length ? intOr(h.fingering[0].f) : undefined,
            sgHead: h.id
          });
          if (opts.ids) n.sgEvent = e.id;
          if (transposes && h.pitch) {
            const w = P.written(h.pitch, tr);
            n.writtenP = pitchName(w);
            n.writtenMidi = P.midi(w);
          }
          /* the file said a quarter-tone and the Score has no way to say one: the exact value is in
             the graph (head.ext), and the note it projects to is marked as the approximation it is */
          if (h.ext && h.ext['musicxml.microtone']) n.approx = 'microtone';
          if (arpHeads.has(h.id)) n.arp = true;
          if (hi === 0 && accent) n.accent = true;
          if (hi === 0 && marcato) n.marcato = true;
          if (hi === 0 && dyn !== undefined) n.dyn = dyn;
          notes.push(n);
        });
      });
    });

    /* no sort here: the app appends in document order and Score.finalize orders by absolute position,
       so anything this added would change the order of notes that land on the same beat */

    /* ---------------------------------------------------- hands (App 4303) */
    const partSpan = g.parts.map((p, i) => ({ base: partBase[i], count: Math.max(1, p.staves.length) }));
    let pianoPart = partSpan.findIndex(sp => sp && sp.count >= 2);
    if (pianoPart < 0) pianoPart = partSpan.length - 1;
    const piano = partSpan[pianoPart] || { base: 0, count: 2 };
    notes.forEach(n => {
      const staff = n.staff || 1;
      const lh = piano.base + piano.count;
      const rh = piano.count >= 2 ? lh - 1 : lh;
      if (piano.count >= 2) n.hand = staff === rh ? 'r' : staff === lh ? 'l' : 'x';
      else n.hand = staff === (piano.base + 1) ? 'r' : 'x';
    });
    if (!notes.some(n => n.hand !== 'x')) notes.forEach(n => { n.hand = n.staff <= 1 ? 'r' : 'l'; });

    /* -------------------------------------------------------- the marks */
    const chords = [], pedals = [], marks = [], tempos = [], dynamics = [], wedges = [];
    g.parts.forEach((part, pi) => {
      part.directions.forEach(d => {
        const mi = mIndex.get(d.m);
        if (mi === undefined) return;
        const at = Q(d.at);
        /* a chord symbol is read from the first part only, or a piano reduction prints it twice */
        if (d.kind === 'chord') { if (pi === 0) chords.push({ m: numberOf[mi], b: at, text: chordText(d) }); return; }
        /* a <dynamics> inside a note's <notations> belongs to that note, not to the score's line of
           dynamics; the app puts it on the note as `dyn` (App 4264-4268) */
        if (d.kind === 'dynamic' && d.event !== undefined) { dynOnEvent.set(d.event, d.value); return; }
        /* A printed dynamic carries no velocity of its own; the player decides. One <dynamics> element
           is one Direction however many glyphs it printed, so this is one entry, as the app's is. */
        if (d.kind === 'dynamic') {
          dynamics.push({ m: numberOf[mi], b: at, mark: d.value === 'other' ? 'other-dynamics' : d.value });
          return;
        }
      });
      part.spanners.forEach(s => {
        if (s.type === 'pedal') {
          if (pi !== pianoGuess) return;          /* the app takes the pedal from the player's part */
          const at = pos => {
            const i = mIndex.get(pos.m);
            return i === undefined ? null : { m: numberOf[i], b: Q(pos.at) };
          };
          const one = (pos, type) => {
            const a = at(pos);
            if (!a) return;
            const x = { m: a.m, b: a.b, type: type, kind: s.pedal };
            if (s.soundOnly) x.value = s.depth !== undefined ? s.depth : (type === 'stop' ? 0 : 127);
            pedals.push(x);
          };
          one(s.from, s.pedal === 'sostenuto' && !s.soundOnly ? 'start' : 'start');
          (s.changes || []).forEach(c => one(c, 'change'));
          if (s.to) one(s.to, 'stop');
        } else if (s.type === 'wedge') {
          const from = mIndex.get(s.from.m), to = s.to ? mIndex.get(s.to.m) : undefined;
          if (from !== undefined) wedges.push({ m: numberOf[from], b: Q(s.from.at), type: s.kind });
          if (to !== undefined) wedges.push({ m: numberOf[to], b: Q(s.to.at), type: 'stop' });
        }
      });
    });
    /* <sound dynamics> the graph keeps on the measure (G02 §6.2): a velocity, not a printed mark */
    g.timeline.measures.forEach((m, i) => {
      const list = m.ext && m.ext['musicxml.sound'];
      if (!list) return;
      list.forEach(one => {
        const dv = parseFloat(one.attrs.dynamics);
        if (isFinite(dv)) dynamics.push({ m: numberOf[i], b: Q(one.at), mark: 'sound', vel: soundDynToVel(dv) });
      });
    });
    /* The app reads one <direction> at a time and pushes its printed mark and then its <sound dynamics>,
       so two directions at one position read p, sound, p, sound. The graph keeps the printed marks on
       the part and the sounds on the measure, so they are zipped back together here rather than sorted
       into two runs (App 4096, 4114). */
    {
      const at = new Map();
      const key = d => d.m + '|' + Math.round(d.b * 1e6);
      dynamics.forEach(d => {
        if (!at.has(key(d))) at.set(key(d), { printed: [], sound: [] });
        at.get(key(d))[d.mark === 'sound' ? 'sound' : 'printed'].push(d);
      });
      const out = [];
      at.forEach(g2 => {
        const n = Math.max(g2.printed.length, g2.sound.length);
        for (let i = 0; i < n; i++) {
          if (g2.printed[i]) out.push(g2.printed[i]);
          if (g2.sound[i]) out.push(g2.sound[i]);
        }
      });
      out.sort((x, y) => x.m - y.m || x.b - y.b);
      dynamics.length = 0;
      out.forEach(d => dynamics.push(d));
    }
    /* the app keeps one mark of each kind per measure, under its own shorter names (App 3842) */
    const JUMP = { dacapo: 'dc', dalsegno: 'ds', tocoda: 'tocoda', fine: 'fine', segno: 'segno', coda: 'coda' };
    (g.timeline.jumps || []).forEach(j => {
      const mi = mIndex.get(j.m);
      if (mi === undefined) return;
      const kind = JUMP[j.kind] || j.kind;
      if (marks.some(k => k.m === numberOf[mi] && k.kind === kind)) return;
      marks.push({ m: numberOf[mi], kind: kind, text: j.text !== undefined ? j.text : null });
    });
    /* The app records a <sound tempo> and a printed metronome mark as two entries, in that order,
       because they are two statements: what plays and what is drawn. One TempoEvent holds both. */
    const UNIT = { breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
    (g.timeline.tempos || []).forEach(t => {
      const mi = mIndex.get(t.m);
      if (mi === undefined) return;
      const at = Q(t.at);
      if (t.qpm !== undefined) tempos.push({ m: numberOf[mi], b: at, bpm: R.toNumber(R.parse(t.qpm)) });
      if (t.mark && t.mark.perMinute !== undefined) {
        const unit = UNIT[t.mark.unit] || 1;
        const bpm = R.toNumber(R.parse(t.mark.perMinute)) * unit * (2 - Math.pow(0.5, t.mark.dots || 0));
        tempos.push({ m: numberOf[mi], b: at, bpm: bpm });
      }
    });
    const firstTempo = tempos.length ? tempos[0].bpm : null;

    const title = g.meta.title !== undefined ? g.meta.title : (name || 'Untitled');
    return {
      id: opts.id || ('sg:' + (name || title) + ':' + Date.now()),
      title: title,
      composer: g.meta.composer !== undefined ? g.meta.composer : 'Unknown',
      source: name || 'MusicXML',
      tempo: Math.round(opts.tempo || firstTempo || 84),
      staves: Math.max(1, Math.min(base, 4)),
      measures: measures, notes: notes, chords: chords,
      pedals: pedals, ottavas: ottavas.filter(o => o.endM != null), marks: marks,
      tempos: tempos, dynamics: dynamics, wedges: wedges,
      sections: null, seeds: null,
      /* the graph this came from, so a consumer can ask what it is rather than guess (G02 §14.4) */
      sgFrom: { id: g.id, rev: g.rev, source: (g.provenance.sources[0] || {}).kind || null,
        inferred: inferredNotation(g) }
    };
  }

  /* Is the notation in this graph something a file stated, or something PPP worked out? A MIDI import
     has no note values, spelling, voices or staves of its own, so everything printed from it is a guess
     and every consumer has to be able to say so (G02 D3, §14.5). */
  function inferredNotation(g) {
    const src = g.provenance.sources[0] || {};
    const dflt = (g.provenance.default || {}).op;
    if (src.kind === 'midi-file' || src.kind === 'midi-input' || src.kind === 'amt' || src.kind === 'audio-score') return true;
    if (dflt === 'inferred' || dflt === 'generated') return true;
    return false;
  }

  /* App 3872: what a <sound dynamics> percentage is worth as a velocity */
  function soundDynToVel(v) {
    if (!(v > 0)) return 1;
    if (v <= 1) return Math.max(1, Math.round(v * 90));
    if (v <= 100) return Math.max(1, Math.min(127, Math.round(v * 0.9)));
    return Math.max(1, Math.min(127, Math.round(v)));
  }
  function intOr(x) {
    const n = parseInt(x, 10);
    return n >= 1 && n <= 5 ? n : undefined;
  }
  /* App 3813: the symbol a MusicXML <kind> prints as */
  const CHORD_KIND = {
    'major': '', 'minor': 'm', 'augmented': 'aug', 'diminished': 'dim',
    'dominant': '7', 'major-seventh': 'M7', 'minor-seventh': 'm7',
    'diminished-seventh': 'dim7', 'augmented-seventh': 'aug7',
    'half-diminished': 'm7b5', 'major-minor': 'mM7',
    'major-sixth': '6', 'minor-sixth': 'm6',
    'dominant-ninth': '9', 'major-ninth': 'M9', 'minor-ninth': 'm9',
    'dominant-11th': '11', 'major-11th': 'M11', 'minor-11th': 'm11',
    'dominant-13th': '13', 'major-13th': 'M13', 'minor-13th': 'm13',
    'suspended-second': 'sus2', 'suspended-fourth': 'sus4',
    'power': '5', 'none': '', 'other': ''
  };
  const ALTER_SIGN = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };
  function chordText(d) {
    const sign = a => ALTER_SIGN[String(a || 0)] || '';
    /* the printed text the file gave, or the symbol its kind stands for */
    let quality = d.text !== undefined && d.text !== '' ? d.text : (CHORD_KIND[d.chordKind] || '');
    const degs = (d.degrees || []).map(x =>
      (x.type === 'subtract' ? 'omit' + x.value : sign(x.alter) + x.value)).filter(Boolean);
    const extra = (d.text !== undefined && d.text !== '') ? degs.filter(x => d.text.indexOf(x) < 0) : degs;
    if (extra.length) quality += '(' + extra.join(',') + ')';
    return d.root.step + sign(d.root.alter) + quality +
      (d.bass ? '/' + d.bass.step + sign(d.bass.alter) : '');
  }
  /* the app's own fallback when a note has no <type> */
  function typeFromQ(q) {
    const table = [[8, 'breve'], [4, 'whole'], [2, 'half'], [1, 'quarter'], [0.5, 'eighth'],
      [0.25, '16th'], [0.125, '32nd'], [0.0625, '64th']];
    for (const [v, n] of table) if (q >= v - 1e-9) return n;
    return '64th';
  }

  /* ------------------------------------------------------------- comparing */
  /* The shadow's report: every field that differs, with the first difference named. */
  /* The fields compare() reads: what the app's Score says about the music. comparable(), agree() and link()
     below read exactly these, so "the same music" means one thing everywhere. */
  const MEASURE_SCALARS = ['number', 'lenQ', 'w'];
  const MEASURE_OBJECTS = ['time', 'key', 'clefs', 'clefChanges', 'bar'];
  const NOTE_SCALARS = ['m', 'b', 'dur', 'p', 'midi', 'staff', 'voice', 'rest', 'chord', 'tieStop', 'tieStart',
    'slurStart', 'slurStop', 'type', 'dots', 'acc', 'hand', 'finger', 'stem', 'dx', 'arp',
    'accent', 'marcato', 'tupletStart', 'tupletStop', 'dyn'];
  const NOTE_OBJECTS = ['tm'];
  const SCORE_LISTS = ['chords', 'pedals', 'ottavas', 'marks', 'tempos', 'dynamics', 'wedges'];

  function compare(a, b) {
    const out = [];
    const say = (field, detail) => out.push({ field: field, detail: detail });
    ['title', 'composer', 'tempo', 'staves'].forEach(k => {
      if (String(a[k]) !== String(b[k])) say(k, JSON.stringify(a[k]) + ' vs ' + JSON.stringify(b[k]));
    });
    cmpList(say, 'measures', a.measures, b.measures, m => m.number, MEASURE_SCALARS, MEASURE_OBJECTS);
    cmpList(say, 'notes', a.notes, b.notes,
      n => n.m + '@' + (Math.round(n.b * 1e6) / 1e6) + ':' + n.staff + ':' + n.voice + ':' + (n.p || 'rest'),
      NOTE_SCALARS, NOTE_OBJECTS);
    SCORE_LISTS.forEach(k => {
      /* An octave shift's `number` only pairs its two ends while a file is being read; nothing reads it
         afterwards, and the graph pairs the ends structurally instead. The notation inventory leaves
         these numbers out for the same reason (G01 §16.2). */
      const drop = k === 'ottavas' ? x => Object.assign({}, x, { number: null }) : x => x;
      /* The player sorts the dynamics by position before it reads them (App 2708), so where two of them
         sit in the array says nothing - except when they share a position, which the sort below keeps. */
      const order = k === 'dynamics' ? l => l.slice().sort((x, y) => x.m - y.m || x.b - y.b) : l => l;
      cmpJson(say, k, order((a[k] || []).map(drop)), order((b[k] || []).map(drop)));
    });
    return out;
  }
  function cmpList(say, name, A, B, key, scalars, objects) {
    A = A || []; B = B || [];
    if (A.length !== B.length) { say(name + '.length', A.length + ' vs ' + B.length); return; }
    for (let i = 0; i < A.length; i++) {
      const x = A[i], y = B[i];
      if (key(x) !== key(y)) {
        /* Two lists can disagree at an index for two very different reasons: the same things in a
           different order, or different things. Saying `.order` for both would let a reason that
           excuses a reordering quietly excuse a changed note as well (G02 A40), so they are told
           apart here and a changed set is its own finding. */
        const ka = A.map(key).sort(), kb = B.map(key).sort();
        if (ka.join(' ') === kb.join(' ')) {
          say(name + '.order', 'at ' + i + ': ' + key(x) + ' vs ' + key(y));
        } else {
          const onlyA = ka.filter(v => kb.indexOf(v) < 0), onlyB = kb.filter(v => ka.indexOf(v) < 0);
          say(name + '.set', 'only the app has ' + (onlyA.slice(0, 3).join(', ') || 'nothing') +
            '; only the graph has ' + (onlyB.slice(0, 3).join(', ') || 'nothing'));
        }
        return;
      }
      for (const f of scalars) {
        const u = norm(x[f]), v = norm(y[f]);
        if (u !== v) { say(name + '.' + f, 'at ' + i + ' (' + key(x) + '): ' + u + ' vs ' + v); return; }
      }
      for (const f of objects || []) {
        const u = JSON.stringify(soft(x[f] === undefined ? null : x[f])), v = JSON.stringify(soft(y[f] === undefined ? null : y[f]));
        if (u !== v) { say(name + '.' + f, 'at ' + i + ' (' + key(x) + '): ' + u + ' vs ' + v); return; }
      }
    }
  }
  /* A number to six places, because the app's position is a running sum of floats and the graph's is
     exact; and object keys in a fixed order, because the order they were filled in is not information
     about the music - only about which bar line the file happened to write first. */
  function soft(v) {
    if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
    if (Array.isArray(v)) return v.map(soft);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).sort().forEach(k => { o[k] = soft(v[k]); });
      return o;
    }
    return v;
  }
  function cmpJson(say, name, A0, B0) {
    const A = soft(A0), B = soft(B0);
    const u = JSON.stringify(A), v = JSON.stringify(B);
    if (u === v) return;
    if (A.length !== B.length) { say(name + '.length', A.length + ' vs ' + B.length); return; }
    for (let i = 0; i < A.length; i++) {
      const x = JSON.stringify(A[i]), y = JSON.stringify(B[i]);
      if (x !== y) { say(name, 'at ' + i + ': ' + x + ' vs ' + y); return; }
    }
    say(name, 'differ');
  }
  const norm = v => (v === undefined || v === null || v === false ? 'null'
    : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v));

  /* ================================================================= G4a ====
     The Score as a render source (docs/GOALS/G04 §8.2).

     The renderer moves onto the graph; practice, playback and storage stay on the Score. A graph is used
     for a Score only when the two state the same music, and a Score with no graph gets one made from it.
     ========================================================================== */

  /* Score.finalize (App 3555) moves what sounds under an 8va: p and midi are shifted by n.ottavaShift and the
     notes are sorted by position. That is the app's reading (issue 3), not the file's, so it is undone here
     before a Score is compared with a projection: the projection is what finalize starts from. */
  const PITCH_RE = /^([A-G])(#{0,3}|b{0,3})(-?\d+)$/;
  function octaveShift(p, semitones) {
    const m = PITCH_RE.exec(p || '');
    if (!m || !isFinite(semitones) || Math.abs(semitones) < 1e-9) return p;
    return m[1] + m[2] + (+m[3] + Math.round(semitones / 12));
  }
  function beforeFinalize(n) {
    const shift = n && !n.rest && isFinite(+n.ottavaShift) ? +n.ottavaShift : 0;
    if (!shift) return n;
    return Object.assign({}, n, { p: n.p ? octaveShift(n.p, -shift) : n.p, midi: n.midi == null ? n.midi : n.midi - shift });
  }
  function unfinalize(score) {
    return Object.assign({}, score, { notes: (score.notes || []).map(beforeFinalize) });
  }

  const pick = (o, fields) => {
    const out = {};
    fields.forEach(f => { if (o[f] !== undefined) out[f] = o[f]; });
    return out;
  };
  /* one note, as compare() sees it: the key orders notes that share a position */
  const noteKey = n => NOTE_SCALARS.map(f => norm(n[f])).join('|') + '|' + JSON.stringify(soft(n.tm === undefined ? null : n.tm));
  /* Score.finalize sorts by position and the projection is in document order; neither order is music, so both
     sides are put in one order before they are compared (compare() stops at the first .order and reads no
     value after it - sorting first is what lets it read every value). */
  function canonicalOrder(list) {
    return list.map((n, i) => ({ n: n, i: i, k: noteKey(n) })).sort((x, y) =>
      (+x.n.m || 0) - (+y.n.m || 0) || soft(+x.n.b || 0) - soft(+y.n.b || 0) || (+x.n.staff || 1) - (+y.n.staff || 1) ||
      (+x.n.voice || 1) - (+y.n.voice || 1) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0) || x.i - y.i);
  }
  function comparable(score) {
    const s = unfinalize(score || {});
    const out = { title: s.title, composer: s.composer, tempo: s.tempo, staves: s.staves,
      measures: (s.measures || []).map(m => pick(m, MEASURE_SCALARS.concat(MEASURE_OBJECTS))),
      notes: canonicalOrder((s.notes || []).map(n => pick(n, NOTE_SCALARS.concat(NOTE_OBJECTS)))).map(x => x.n) };
    SCORE_LISTS.forEach(k => { out[k] = (s[k] || []).map(x => Object.assign({}, x)); });
    return out;
  }

  /* Do a Score and a graph state the same music? compare() on both, in one note order. Title, composer and the
     score tempo are what the app shows, not what it plays or draws in the staff (a course piece renames itself
     after it is read), so they are reported, never a reason to disagree. */
  function agree(score, graph) {
    const a = comparable(score), b = comparable(toScore(graph));
    const info = [];
    ['title', 'composer', 'tempo'].forEach(k => {
      if (String(a[k]) !== String(b[k])) info.push({ field: k, detail: JSON.stringify(a[k]) + ' vs ' + JSON.stringify(b[k]) });
      b[k] = a[k];
    });
    const diffs = compare(a, b);
    return { ok: diffs.length === 0, diffs: diffs, info: info };
  }

  /* Which graph event and head each Score note is: the projection of the graph, with its IDs, matched note for
     note with the Score in the canonical order. ok only when every note matches in every field compare() reads. */
  function link(score, graph) {
    const proj = toScore(graph, { ids: true });
    const A = canonicalOrder(unfinalize(score).notes.map(n => pick(n, NOTE_SCALARS.concat(NOTE_OBJECTS))));
    const B = canonicalOrder(proj.notes.map(n => Object.assign(pick(n, NOTE_SCALARS.concat(NOTE_OBJECTS)),
      { sgEvent: n.sgEvent, sgHead: n.sgHead })));
    const byNote = new Array(A.length).fill(null);
    const out = { ok: true, byNote: byNote, mismatch: null };
    if (A.length !== B.length) { out.ok = false; out.mismatch = 'notes ' + A.length + ' vs ' + B.length; return out; }
    for (let k = 0; k < A.length; k++) {
      if (A[k].k !== B[k].k) {
        if (out.ok) out.mismatch = 'at ' + k + ': ' + A[k].k + ' vs ' + B[k].k;
        out.ok = false;
        continue;
      }
      byNote[A[k].i] = { event: B[k].n.sgEvent, head: B[k].n.sgHead || null };
    }
    return out;
  }

  /* ------------------------------------------------------------- fromScore */
  /* Quarters (a float the app summed) to an exact W: a grid of 1/3840 quarter holds every value a written
     note can take down to 256th triplets and quintuplets; anything else by continued fraction. */
  function ratQ(q) {
    const G = 3840, x = q * G, r = Math.round(x);
    if (Math.abs(x - r) < 1e-6) return R.make(r, G * 4);
    let h0 = 0, h1 = 1, k0 = 1, k1 = 0, v = q;
    for (let i = 0; i < 32; i++) {
      const a = Math.floor(v);
      const h2 = a * h1 + h0, k2 = a * k1 + k0;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(h1 / k1 - q) < 1e-9 || k1 > 100000) break;
      const f = v - a;
      if (f < 1e-12) break;
      v = 1 / f;
    }
    return R.make(h1, k1 * 4);
  }
  const W = q => R.format(ratQ(+q || 0));
  const ALTER_OF = { '': 0, '#': 1, '##': 2, '###': 3, 'b': -1, 'bb': -2, 'bbb': -3 };
  const CLEF_OF = { treble: { sign: 'G', line: 2 }, bass: { sign: 'F', line: 4 }, alto: { sign: 'C', line: 3 },
    percussion: { sign: 'percussion' } };
  const JUMP_OF = { dc: 'dacapo', ds: 'dalsegno', tocoda: 'tocoda', fine: 'fine', segno: 'segno', coda: 'coda' };
  const OCTAVES_OF_SIZE = { 8: 1, 15: 2, 22: 3 };

  /* The hand rule of toScore above (App 4303), run on a proposed part layout: parts = [[global staff, ...], ...]. */
  function handsFor(parts, staffNotes) {
    const span = [];
    let base = 0;
    parts.forEach(p => { span.push({ base: base, count: p.length }); base += p.length; });
    let pi = span.findIndex(sp => sp.count >= 2);
    if (pi < 0) pi = span.length - 1;
    const piano = span[pi];
    const hand = s => {
      const lh = piano.base + piano.count, rh = piano.count >= 2 ? lh - 1 : lh;
      if (piano.count >= 2) return s === rh ? 'r' : s === lh ? 'l' : 'x';
      return s === piano.base + 1 ? 'r' : 'x';
    };
    const out = {};
    let anyNotX = false;
    Object.keys(staffNotes).forEach(s => { out[s] = hand(+s); if (out[s] !== 'x') anyNotX = true; });
    if (!anyNotX) Object.keys(staffNotes).forEach(s => { out[s] = +s <= 1 ? 'r' : 'l'; });
    return out;
  }
  /* The Score keeps no parts, only staves numbered end to end and a hand on every note. The part layout is the
     first one whose hand rule gives every staff the hand its notes carry: then toScore gives the same hands,
     the same first part (clefs, chord names) and the same piano part (pedal, 8va) back. */
  function partsFromHands(n, notes) {
    const seen = {};
    notes.forEach(x => { const s = x.staff || 1; (seen[s] = seen[s] || new Set()).add(x.hand); });
    const staffNotes = {};
    Object.keys(seen).forEach(s => { staffNotes[s] = true; });
    const want = {};
    let consistent = true;
    Object.keys(seen).forEach(s => { if (seen[s].size !== 1) consistent = false; want[s] = [...seen[s]][0]; });
    const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
    const cands = [];
    if (n <= 2) cands.push([range(1, n)]);
    for (let k = 1; k < n; k++) cands.push(range(1, k - 1).map(s => [s]).concat([[k, k + 1]], range(k + 2, n).map(s => [s])));
    cands.push(range(1, n).map(s => [s]));
    cands.push([range(1, n)]);
    for (const c of cands) {
      const got = handsFor(c, staffNotes);
      if (consistent && Object.keys(want).every(s => got[s] === want[s])) return { parts: c, exact: true };
    }
    return { parts: n <= 2 ? [range(1, n)] : cands[cands.length - 1], exact: false };
  }

  function chordFromText(text) {
    const m = /^([A-G])(bb|b|##|#)?(.*?)(?:\/([A-G])(bb|b|##|#)?)?$/.exec(String(text || ''));
    if (!m) return null;
    const d = { root: { step: m[1], alter: ALTER_OF[m[2] || ''] || 0 }, chordKind: m[3] ? 'other' : 'major' };
    if (m[3]) d.text = m[3];
    if (m[4]) d.bass = { step: m[4], alter: ALTER_OF[m[5] || ''] || 0 };
    return d;
  }

  /* A graph for a Score that has none: a song saved before PPP kept graphs, a shared score, an old
     transcription (G04 §8.2). Compatibility, not an importer: it states what the Score states and nothing it
     does not. What the Score cannot say (beams, grace notes, lyrics, most articulations, a transposition)
     stays out, and what the graph cannot hold is reported by code. The claim, checked over the corpus and
     stored Scores (G04 A48): agree(score, fromScore(score).graph).ok.

     -> { ok, graph, issues, byNote: [{event, head} | null per score.notes index], unsupported: [{code, count, example}],
          removed: [{id, code}] } */
  function fromScore(score, opts) {
    opts = opts || {};
    const unsupported = new Map();
    const note = (code, example) => {
      const u = unsupported.get(code) || { code: code, count: 0, example: example === undefined ? null : example };
      u.count++;
      unsupported.set(code, u);
    };
    const src = unfinalize(score || {});
    const measures0 = src.measures || [];
    if (!measures0.length) return { ok: false, graph: null, issues: [], byNote: [], unsupported: [{ code: 'no-measures', count: 1, example: null }], removed: [] };
    const notes0 = (src.notes || []).map((n, i) => Object.assign({}, n, { _i: i }));

    const idOf = s => ('legacy:' + String(s || 'score').replace(/[^A-Za-z0-9._:-]+/g, '-')).slice(0, 64);
    const meta = {};
    if (score.title !== undefined && score.title !== null) meta.title = String(score.title);
    if (score.composer !== undefined && score.composer !== null) meta.composer = String(score.composer);
    const b = Build.builder({ id: opts.id || idOf(score.id), meta: meta });
    const srcEnt = b.source({ kind: 'legacy-score', tool: 'ppp-legacy-score', note: 'rebuilt from the app Score (G04 8.2)' });
    b.setDefault({ src: srcEnt.id, op: 'imported' });

    /* ---- measures, and where each Score measure number lands */
    const numIndex = new Map();
    const mEnts = measures0.map((mm, i) => {
      const tm = mm.time || { beats: 4, beatType: 4 };
      const x = { number: String(mm.number), dur: W(mm.lenQ > 0 ? mm.lenQ : (tm.beats * 4) / tm.beatType) };
      if (mm.w !== null && mm.w !== undefined && isFinite(+mm.w) && +mm.w >= 0) x.layout = { width: Math.round(+mm.w * 1000) / 1000 };
      if (numIndex.has(mm.number)) note('duplicate-measure-number', mm.number);
      numIndex.set(mm.number, i);            /* the last one, as Score.finalize's byNumber has it */
      return b.measure(x);
    });
    const mDur = mEnts.map(x => R.parse(x.dur));
    const mStart = [];
    { let acc = R.ZERO; mDur.forEach(d => { mStart.push(acc); acc = R.add(acc, d); }); }
    const mOf = no => { const i = numIndex.get(no); return i === undefined ? -1 : i; };

    /* ---- meters and keys, where they change */
    const BEAT_TYPES = [1, 2, 4, 8, 16, 32, 64, 128];
    measures0.forEach((mm, i) => {
      const t = mm.time || { beats: 4, beatType: 4 }, p = i > 0 ? (measures0[i - 1].time || { beats: 4, beatType: 4 }) : null;
      if (i === 0 || !p || p.beats !== t.beats || p.beatType !== t.beatType) {
        if (!(t.beats >= 1) || BEAT_TYPES.indexOf(t.beatType) < 0) { note('meter-invalid', t.beats + '/' + t.beatType); if (i === 0) b.meter({ m: mEnts[i].id, beats: [4], beatType: 4 }); return; }
        b.meter({ m: mEnts[i].id, beats: [Math.round(t.beats)], beatType: t.beatType });
      }
    });
    measures0.forEach((mm, i) => {
      const k = mm.key || { fifths: 0, mode: 'major' }, p = i > 0 ? measures0[i - 1].key : null;
      if (i === 0 || !p || p.fifths !== k.fifths || p.mode !== k.mode) {
        const f = Math.round(+k.fifths || 0);
        if (f < -7 || f > 7) { note('key-invalid', f); return; }
        const x = { m: mEnts[i].id, at: '0', fifths: f };
        if (S.MODES.indexOf(k.mode) >= 0) x.mode = k.mode; else if (k.mode !== undefined) note('key-mode', k.mode);
        b.key(x);
      }
    });

    /* ---- bar lines, endings, jumps */
    let openEnding = null;
    measures0.forEach((mm, i) => {
      const bar = mm.bar || {};
      const line = {};
      if (bar.repeatStart) line.left = { repeat: 'forward' };
      const right = {};
      if (bar.repeatEnd) { right.repeat = 'backward'; right.times = typeof bar.repeatEnd === 'number' ? bar.repeatEnd : 2; }
      if (bar.style) { if (S.BAR_STYLES.indexOf(bar.style) >= 0) right.style = bar.style; else note('bar-style', bar.style); }
      if (Object.keys(right).length) line.right = right;
      if (Object.keys(line).length) mEnts[i].barline = line;
      if (bar.endingType === 'start' || (bar.ending !== undefined && bar.endingType === undefined)) {
        if (openEnding) note('ending-unclosed', measures0[openEnding.from].number);
        const nos = Array.isArray(bar.endingNos) && bar.endingNos.length ? bar.endingNos.slice()
          : String(bar.ending || '1').split(/[^0-9]+/).filter(Boolean).map(Number);
        openEnding = { from: i, numbers: nos.length ? nos : [1], text: bar.ending };
      }
      if (bar.endingEnd) {
        if (!openEnding) { note('ending-stop-without-start', mm.number); return; }
        const x = { numbers: openEnding.numbers, from: mEnts[openEnding.from].id, to: mEnts[i].id };
        if (openEnding.text !== undefined && openEnding.text !== null) x.text = String(openEnding.text);
        if (bar.endingEnd === 'open') x.open = true;
        b.ending(x);
        openEnding = null;
      }
    });
    if (openEnding) note('ending-unclosed', measures0[openEnding.from].number);
    (src.marks || []).forEach(mk => {
      const i = mOf(mk.m), kind = JUMP_OF[mk.kind];
      if (i < 0 || !kind) { note('jump', mk.kind); return; }
      const x = { kind: kind, m: mEnts[i].id, at: '0' };
      if (mk.text !== null && mk.text !== undefined) x.text = String(mk.text);
      b.jump(x);
    });
    (src.tempos || []).forEach(t => {
      const i = mOf(t.m);
      if (i < 0 || !(t.bpm > 0)) { note('tempo', t.bpm); return; }
      b.tempo({ m: mEnts[i].id, at: W(t.b), qpm: R.format(R.mul(ratQ(t.bpm), R.make(4))) });
    });

    /* ---- parts and staves, from the hands */
    const nStaves = Math.max(1, +src.staves || 1, notes0.reduce((a, x) => Math.max(a, +x.staff || 1), 1));
    const layout = partsFromHands(nStaves, notes0);
    if (!layout.exact) note('hands-not-reproduced', nStaves + ' staves');
    let pianoIdx = layout.parts.findIndex(p => p.length >= 2);
    if (pianoIdx < 0) pianoIdx = layout.parts.length - 1;
    const partOfStaff = {}, staffEnt = {}, parts = [];
    layout.parts.forEach((staves, pi) => {
      const part = b.part({ instrument: pi === pianoIdx ? { kind: 'piano', family: 'keyboard' } : { kind: 'unknown', family: 'other' } });
      parts.push(part);
      staves.forEach(s => { partOfStaff[s] = pi; staffEnt[s] = b.staff(part, {}); });
    });

    /* ---- clefs of the first part (the only ones the Score records, by that part's own staff numbers) */
    {
      const first = layout.parts[0];
      const state = {};
      measures0.forEach((mm, i) => {
        const clefs = mm.clefs || {};
        first.forEach((gs, li) => {
          const local = li + 1, nm = clefs[local];
          if (nm === undefined || nm === state[local]) return;
          const c = CLEF_OF[nm];
          if (!c) { note('clef', nm); return; }
          b.clef(parts[0], Object.assign({ staff: staffEnt[gs].id, m: mEnts[i].id, at: '0' }, c));
          state[local] = nm;
        });
        (mm.clefChanges || []).forEach(ch => {
          const gs = first[(ch.staff || 1) - 1], c = CLEF_OF[ch.clef];
          if (gs === undefined || !c) { note('clef-change', ch.clef); return; }
          b.clef(parts[0], Object.assign({ staff: staffEnt[gs].id, m: mEnts[i].id, at: W(ch.b) }, c));
          state[ch.staff || 1] = ch.clef;
        });
      });
    }

    /* ---- events: a chord is the notes of one voice that start together and last as long */
    const round = x => Math.round((+x || 0) * 1e6);
    const groups = [];
    const bySlot = new Map();
    notes0.forEach(x => {
      const slot = x.m + '|' + round(x.b) + '|' + (x.voice || 1) + '|' + round(x.dur);
      if (!x.rest && x.chord && bySlot.has(slot)) { bySlot.get(slot).notes.push(x); return; }
      if (!x.rest && x.chord) note('chord-without-first-note', x.m + ':' + x.b);
      const g = { notes: [x], first: x._i };
      groups.push(g);
      if (!x.rest) bySlot.set(slot, g);
    });
    /* a head the event already has (E-HEADS), or one on another part's staff, becomes its own event */
    const split = [];
    groups.forEach(g => {
      const keep = [], seen = new Set(), pi = partOfStaff[g.notes[0].staff || 1];
      g.notes.forEach(x => {
        const key = x.rest ? 'rest' : String(x.p);
        if (!x.rest && (seen.has(key) || partOfStaff[x.staff || 1] !== pi)) {
          note(seen.has(key) ? 'unison-in-chord' : 'chord-across-parts', x.m + ':' + x.p);
          split.push({ notes: [x], first: x._i });
          return;
        }
        seen.add(key);
        keep.push(x);
      });
      g.notes = keep;
    });
    const all = groups.concat(split).filter(g => g.notes.length);
    all.forEach(g => {
      const x = g.notes[0];
      g.part = partOfStaff[x.staff || 1];
      g.mi = mOf(x.m);
      g.at = ratQ(+x.b || 0);
      g.dur = ratQ(+x.dur || 0);
      g.label = Math.round(+x.voice || 1);
    });
    const ok = all.filter(g => {
      if (g.mi < 0) { note('note-measure-missing', g.notes[0].m); return false; }
      if (R.sign(g.dur) <= 0) { note('note-duration', g.notes[0].dur); return false; }
      if (R.sign(g.at) < 0 || R.ge(g.at, mDur[g.mi])) { note('note-position', g.notes[0].m + ':' + g.notes[0].b); return false; }
      if (R.gt(R.add(g.at, g.dur), mDur[g.mi])) { note('note-overflow', g.notes[0].m + ':' + g.notes[0].b); return false; }
      if (!g.notes[0].rest && g.notes.every(x => !x.p)) { note('percussion-or-unpitched', g.notes[0].m + ':' + g.notes[0].b); return false; }
      return true;
    });
    ok.sort((x, y) => x.part - y.part || x.mi - y.mi || R.cmp(x.at, y.at) || x.label - y.label || x.first - y.first);

    /* ---- voices: one per label; a label whose events overlap in time gets another voice of the same label */
    const voiceEnts = new Map();     /* part|label -> [{ent, reach}] */
    const layerFor = g => {
      const key = g.part + '|' + g.label;
      if (!voiceEnts.has(key)) voiceEnts.set(key, []);
      const layers = voiceEnts.get(key);
      const start = R.add(mStart[g.mi], g.at), end = R.add(start, g.dur);
      let layer = layers.find(l => !R.lt(start, l.reach));
      if (!layer) {
        if (layers.length) note('voice-overlap', g.notes[0].m + ':' + g.notes[0].b);
        layer = { ent: b.voice(parts[g.part], { staff: staffEnt[g.notes[0].staff || 1].id, label: String(g.label) }), reach: R.ZERO };
        layers.push(layer);
      }
      layer.reach = R.gt(end, layer.reach) ? end : layer.reach;
      return layer.ent;
    };
    const byNote = new Array(notes0.length).fill(null);
    const events = [];
    ok.forEach(g => {
      const x0 = g.notes[0];
      const voice = layerFor(g);
      const e = { kind: x0.rest ? 'rest' : 'note', m: mEnts[g.mi].id, at: R.format(g.at), dur: R.format(g.dur),
        voice: voice.id, staff: staffEnt[x0.staff || 1].id };
      const disp = {};
      if (x0.type && S.NOTE_TYPES.indexOf(x0.type) >= 0) disp.type = x0.type; else if (x0.type) note('note-type', x0.type);
      if (x0.dots > 0) disp.dots = Math.min(4, Math.round(x0.dots));
      if (x0.stem === 'up' || x0.stem === 'down') disp.stem = x0.stem;
      if (x0.dx !== undefined && x0.dx !== null && isFinite(+x0.dx)) disp.x = Math.round(+x0.dx * 1000) / 1000;
      if (Object.keys(disp).length) e.display = disp;
      if (!x0.rest) {
        const arts = [];
        if (x0.accent) arts.push('accent');
        if (x0.marcato) arts.push('marcato');
        if (arts.length) e.arts = arts;
        e.heads = g.notes.filter(x => x.p).map(x => {
          const m = PITCH_RE.exec(x.p);
          const h = { pitch: { step: m[1], alter: ALTER_OF[m[2]] || 0, oct: +m[3] } };
          if (x.midi != null && P.midi(h.pitch) !== x.midi) note('pitch-midi-mismatch', x.p + '/' + x.midi);
          if ((x.staff || 1) !== (x0.staff || 1)) h.staff = staffEnt[x.staff || 1].id;
          if (x.acc) { if (S.ACCIDENTALS.indexOf(x.acc) >= 0) h.acc = { type: x.acc }; else note('accidental', x.acc); }
          if (x.finger >= 1 && x.finger <= 5) h.fingering = [{ f: String(x.finger) }];
          if (x.approx === 'microtone') note('microtone', x.p);
          if (x.writtenP && x.writtenP !== x.p) note('transposition', x.writtenP + '/' + x.p);
          return h;
        });
      }
      const ent = b.event(parts[g.part], e);
      g.ent = ent;
      events.push(g);
      if (x0.rest) byNote[x0._i] = { event: ent.id, head: null };
      else g.notes.filter(x => x.p).forEach((x, hi) => { byNote[x._i] = { event: ent.id, head: ent.heads[hi].id }; });
    });
    const partNotesDropped = notes0.length - byNote.filter(Boolean).length;
    if (partNotesDropped) note('notes-not-rebuilt', partNotesDropped);

    /* ---- what hangs on the events: ties, slurs, tuplets, arpeggios, a dynamic on a note */
    const absStart = g => R.add(mStart[g.mi], g.at), absEnd = g => R.add(absStart(g), g.dur);
    {
      /* ties: a head marked tieStart to the next head of the same pitch that starts where it ends and is marked
         tieStop - the same voice first, then the same staff, then any */
      const heads = [];
      events.forEach(g => { if (g.ent.kind === 'note') g.notes.filter(x => x.p).forEach((x, hi) => heads.push({ g: g, x: x, h: g.ent.heads[hi] })); });
      const used = new Set(), from = new Set();
      heads.forEach(a => {
        if (!a.x.tieStart) return;
        const end = absEnd(a.g), midi = P.midi(a.h.pitch);
        const cands = heads.filter(z => z.x.tieStop && !used.has(z.h.id) && z.g !== a.g && R.eq(absStart(z.g), end) && P.midi(z.h.pitch) === midi && z.g.part === a.g.part);
        const pickOne = cands.find(z => z.g.ent.voice === a.g.ent.voice) || cands.find(z => z.g.label === a.g.label) ||
          cands.find(z => (z.x.staff || 1) === (a.x.staff || 1)) || cands[0];
        if (pickOne) { used.add(pickOne.h.id); from.add(a.h.id); b.spanner(parts[a.g.part], { type: 'tie', from: a.h.id, to: pickOne.h.id }); }
        else { from.add(a.h.id); b.spanner(parts[a.g.part], { type: 'tie', from: a.h.id }); note('tie-open-start', a.x.m + ':' + a.x.p); }
      });
      heads.forEach(z => {
        if (z.x.tieStop && !used.has(z.h.id)) { b.spanner(parts[z.g.part], { type: 'tie', to: z.h.id }); note('tie-open-end', z.x.m + ':' + z.x.p); }
      });
    }
    {
      /* slurs: in each (staff, voice) chain a stop closes the earliest open start, then a start opens (the legacy
         renderer's pairing, App 11097: the Score keeps the ends of a slur, not which ends belong together) */
      const chains = new Map();
      events.forEach(g => {
        const k = g.part + '|' + (g.notes[0].staff || 1) + '|' + g.label;
        if (!chains.has(k)) chains.set(k, []);
        chains.get(k).push(g);
      });
      chains.forEach(list => {
        const open = [];
        list.forEach(g => {
          const x0 = g.notes[0];
          if (x0.slurStop) {
            if (open.length) b.spanner(parts[g.part], { type: 'slur', from: open.shift().ent.id, to: g.ent.id });
            else { b.spanner(parts[g.part], { type: 'slur', to: g.ent.id }); note('slur-open-end', x0.m); }
          }
          if (x0.slurStart) open.push(g);
        });
        open.forEach(g => { b.spanner(parts[g.part], { type: 'slur', from: g.ent.id }); note('slur-open-start', g.notes[0].m); });
      });
    }
    {
      /* tuplets: a printed one runs from its tupletStart to its tupletStop; the rest of a run of equal ratio
         is unprinted and closes when it has filled its time, the way the importer reads a run (musicxml-import) */
      const byVoice = new Map();
      events.forEach(g => {
        if (!g.notes[0].tm) return;
        const k = g.ent.voice;
        if (!byVoice.has(k)) byVoice.set(k, []);
        byVoice.get(k).push(g);
      });
      const allByVoice = new Map();
      events.forEach(g => { const k = g.ent.voice; if (!allByVoice.has(k)) allByVoice.set(k, []); allByVoice.get(k).push(g); });
      byVoice.forEach((list, vk) => {
        const seq = allByVoice.get(vk);
        const tmOf = g => g.notes[0].tm;
        /* The printed brackets, as the Score marks them: a tupletStart opens one and a tupletStop closes the
           most recent open one, so nested brackets come back nested. Each bracket's own ratio is what its own
           notes carry divided by the brackets around it (the Score keeps the product, App 4257). */
        const stack = [], spans = [];
        seq.forEach((g, idx) => {
          const x = g.notes[0];
          if (!x.tm) return;
          if (x.tupletStart) stack.push(idx);
          if (x.tupletStop) {
            if (stack.length) spans.push({ from: stack.pop(), to: idx });
            else note('tuplet-stop-without-start', x.m);
          }
        });
        stack.forEach(from => {
          let to = from;
          while (seq[to + 1] && tmOf(seq[to + 1]) && !seq[to + 1].notes[0].tupletStart) to++;
          note('tuplet-unclosed', seq[from].notes[0].m);
          spans.push({ from: from, to: to });
        });
        /* outer brackets first: sorted by start, the longer first, a sweep gives each its innermost parent */
        spans.sort((p, q) => p.from - q.from || q.to - p.to);
        {
          const open = [];
          spans.forEach(sp => {
            while (open.length && open[open.length - 1].to < sp.from) open.pop();
            sp.parent = open.length && open[open.length - 1].to >= sp.to ? open[open.length - 1] : null;
            open.push(sp);
          });
        }
        /* the innermost bracket over each event: a later (inner) span overwrites its parent's claim */
        const deepest = new Map();
        spans.forEach(sp => { for (let i = sp.from; i <= sp.to; i++) deepest.set(i, sp); });
        const inPrinted = new Set();
        spans.forEach(sp => {
          const members = seq.slice(sp.from, sp.to + 1);
          if (members.some(g => !tmOf(g))) { note('tuplet-gap', members[0].notes[0].m); sp.dead = true; return; }
          const outer = { a: 1, n: 1 };
          for (let p = sp.parent; p; p = p.parent) { if (p.dead || !p.ratio) { sp.dead = true; break; } outer.a *= p.ratio.a; outer.n *= p.ratio.n; }
          if (sp.dead) { note('tuplet-nesting', members[0].notes[0].m); return; }
          let direct = members[0];
          for (let i = sp.from; i <= sp.to; i++) if (deepest.get(i) === sp) { direct = seq[i]; break; }
          const t = tmOf(direct);
          if (t.a % outer.a || t.n % outer.n) { note('tuplet-nesting', members[0].notes[0].m); sp.dead = true; return; }
          sp.ratio = { a: Math.max(1, t.a / outer.a), n: Math.max(1, t.n / outer.n) };
          members.forEach(x => inPrinted.add(x));
          const x = { type: 'tuplet', events: members.map(g => g.ent.id), actual: sp.ratio.a, normal: sp.ratio.n };
          if (sp.parent) x.parent = sp.parent.ent.id;
          sp.ent = b.spanner(parts[members[0].part], x);
        });
        let run = null;
        const close = () => { if (run) b.spanner(parts[run.part], { type: 'tuplet', events: run.members.map(x => x.ent.id), actual: run.a, normal: run.n, printed: false }); run = null; };
        list.forEach(g => {
          if (inPrinted.has(g)) { close(); return; }
          const t = tmOf(g);
          if (run && (run.a !== t.a || run.n !== t.n || !R.eq(run.end, absStart(g)))) close();
          if (!run) {
            const unit = S.NOTE_TYPES.indexOf(g.notes[0].type) >= 0 ? S.noteValue(g.notes[0].type, g.notes[0].dots || 0) : null;
            run = { part: g.part, a: Math.max(1, t.a), n: Math.max(1, t.n), members: [], sum: R.ZERO,
              full: unit ? R.mul(R.make(Math.max(1, t.n)), unit) : null };
          }
          run.members.push(g);
          run.sum = R.add(run.sum, g.dur);
          run.end = absEnd(g);
          if (run.full && R.ge(run.sum, run.full)) close();
        });
        close();
      });
    }
    events.forEach(g => {
      if (g.ent.kind !== 'note') return;
      const arp = g.notes.map((x, hi) => x.p && x.arp ? g.ent.heads[hi] : null).filter(Boolean);
      if (arp.length) b.spanner(parts[g.part], { type: 'arpeggio', heads: arp.map(h => h.id) });
      const dyn = g.notes[0].dyn;
      if (dyn !== undefined && dyn !== null) {
        if (S.DYNAMICS.indexOf(dyn) >= 0) b.direction(parts[g.part], { kind: 'dynamic', m: g.ent.m, at: g.ent.at, value: dyn, event: g.ent.id });
        else note('dynamic-on-note', dyn);
      }
    });

    /* ---- the score's lines of marks */
    /* a position the graph refuses (past its measure) is taken out at finish below, and named */
    const posOf = (m, bq) => { const i = mOf(m); return i < 0 ? null : { m: mEnts[i].id, at: W(bq) }; };
    (src.chords || []).forEach(c => {
      const p = posOf(c.m, c.b), d = chordFromText(c.text);
      if (!p || !d) { note('chord-symbol', c.text); return; }
      b.direction(parts[0], Object.assign({ kind: 'chord', m: p.m, at: p.at }, d));
    });
    const sound = new Map();
    (src.dynamics || []).forEach(d => {
      const p = posOf(d.m, d.b);
      if (!p) { note('dynamic', d.mark); return; }
      if (d.mark === 'sound') {
        /* the inverse of soundDynToVel above: a velocity back to the percentage a <sound dynamics> says */
        const v = +d.vel, dv = v <= 90 ? v / 0.9 : v > 100 ? v : v === 100 ? 100.4 : null;
        if (dv === null || soundDynToVel(dv) !== v) { note('sound-dynamics', v); return; }
        const i = mOf(d.m);
        if (!sound.has(i)) sound.set(i, []);
        sound.get(i).push({ at: p.at, attrs: { dynamics: String(dv) } });
        return;
      }
      const value = d.mark === 'other-dynamics' ? 'other' : d.mark;
      if (S.DYNAMICS.indexOf(value) < 0) { note('dynamic', d.mark); return; }
      b.direction(parts[0], { kind: 'dynamic', m: p.m, at: p.at, value: value });
    });
    sound.forEach((list, i) => { mEnts[i].ext = Object.assign({}, mEnts[i].ext || {}, { 'musicxml.sound': list }); });
    {
      let open = null;
      (src.wedges || []).forEach(w => {
        const p = posOf(w.m, w.b);
        if (!p) { note('wedge', w.type); return; }
        if (w.type === 'crescendo' || w.type === 'diminuendo') {
          if (open) { b.spanner(parts[0], { type: 'wedge', kind: open.kind, from: open.from }); note('wedge-unclosed', open.from.m); }
          open = { kind: w.type, from: p };
        } else if (w.type === 'stop') {
          if (!open) { note('wedge-stop-without-start', w.m); return; }
          b.spanner(parts[0], { type: 'wedge', kind: open.kind, from: open.from, to: p });
          open = null;
        } else note('wedge', w.type);
      });
      if (open) b.spanner(parts[0], { type: 'wedge', kind: open.kind, from: open.from });
    }
    {
      const open = {};
      const flush = kind => { const o = open[kind]; if (!o) return; b.spanner(parts[pianoIdx], o.x); open[kind] = null; };
      (src.pedals || []).forEach(pd => {
        const p = posOf(pd.m, pd.b);
        const kind = pd.kind === 'sostenuto' || pd.kind === 'soft' ? pd.kind : 'damper';
        if (!p) { note('pedal', pd.type); return; }
        if (pd.type === 'start') {
          if (open[kind]) { note('pedal-unclosed', pd.m); flush(kind); }
          const x = { type: 'pedal', pedal: kind, from: p };
          if (pd.value !== undefined && pd.value !== null) { x.soundOnly = true; if (pd.value !== 127) x.depth = Math.max(1, Math.min(127, Math.round(pd.value))); }
          open[kind] = { x: x };
        } else if (pd.type === 'change') {
          if (!open[kind]) { note('pedal-change-without-start', pd.m); return; }
          (open[kind].x.changes = open[kind].x.changes || []).push(p);
        } else if (pd.type === 'stop') {
          if (!open[kind]) { note('pedal-stop-without-start', pd.m); return; }
          open[kind].x.to = p;
          flush(kind);
        } else note('pedal', pd.type);
      });
      Object.keys(open).forEach(flush);
    }
    (src.ottavas || []).forEach(ov => {
      const a = posOf(ov.m, ov.b), z = ov.endM != null ? posOf(ov.endM, ov.endB || 0) : null;
      const oct = OCTAVES_OF_SIZE[ov.size] || Math.max(1, Math.round(Math.abs(+ov.semitones || 12) / 12));
      if (!a || !z) { note('ottava', ov.m); return; }
      const x = { type: 'ottava', shift: (ov.dir < 0 ? 1 : -1) * oct, from: a, to: z };
      if (ov.staff !== null && ov.staff !== undefined) {
        if (partOfStaff[ov.staff] !== pianoIdx) { note('ottava-staff', ov.staff); return; }
        x.staff = staffEnt[ov.staff].id;
      } else {
        /* an 8va the Score reads on every staff (the file named none): the graph needs a staff, and says it
           assumed one, the way the importer does (musicxml-import octave-shift) - toScore then reads it as none */
        x.staff = staffEnt[layout.parts[pianoIdx][0]].id;
        x.ext = { 'musicxml.ottava': { staff: 'assumed' } };
      }
      b.spanner(parts[pianoIdx], x);
    });

    /* ---- finish: a Score can say what the graph refuses (overlapping endings, a tie between two notes that do
       not meet ...). Such an object is taken out and named, never the whole graph lost for it. */
    let res = null;
    const removed = [];
    for (let attempt = 0; attempt < 12 && !res; attempt++) {
      try { res = attempt === 0 ? b.finish() : Build.seal(b.doc); }
      catch (err) {
        if (!err || err.code !== 'E-BUILD') throw err;
        const ids = new Set();
        err.issues.filter(i => i.severity === 'ERROR').forEach(i => (i.ids || []).forEach(id => ids.add(id)));
        if (!ids.size) return { ok: false, graph: null, issues: err.issues, byNote: byNote, unsupported: [...unsupported.values()], removed: removed };
        const drop = (list, code) => {
          for (let k = list.length - 1; k >= 0; k--) if (ids.has(list[k].id)) { removed.push({ id: list[k].id, code: code }); list.splice(k, 1); }
        };
        const tl = b.doc.timeline;
        ['keys', 'tempos', 'endings', 'jumps'].forEach(k => drop(tl[k], k));
        b.doc.parts.forEach(p => {
          drop(p.spanners, 'spanner'); drop(p.directions, 'direction'); drop(p.clefs, 'clef');
          for (let k = p.events.length - 1; k >= 0; k--) {
            const ev = p.events[k];
            if (ids.has(ev.id) || (ev.heads || []).some(h => ids.has(h.id))) { removed.push({ id: ev.id, code: 'event' }); p.events.splice(k, 1); }
          }
          /* whatever named an event or head that is gone goes with it */
          const alive = new Set();
          p.events.forEach(ev => { alive.add(ev.id); (ev.heads || []).forEach(h => alive.add(h.id)); });
          const dead = r => typeof r === 'string' && !alive.has(r);
          for (let k = p.spanners.length - 1; k >= 0; k--) {
            const s = p.spanners[k];
            if (dead(s.from) || dead(s.to) || (s.events || []).some(dead) || (s.heads || []).some(dead)) {
              removed.push({ id: s.id, code: 'spanner-of-removed' }); p.spanners.splice(k, 1);
            }
          }
          for (let k = p.directions.length - 1; k >= 0; k--) if (dead(p.directions[k].event)) { removed.push({ id: p.directions[k].id, code: 'direction-of-removed' }); p.directions.splice(k, 1); }
        });
        const alive = new Set();
        b.doc.parts.forEach(p => p.events.forEach(ev => alive.add(ev.id)));
        byNote.forEach((v, i) => { if (v && !alive.has(v.event)) byNote[i] = null; });
      }
    }
    /* what the graph refused is a loss like any other, and is reported with the rest */
    removed.forEach(r => note('refused-by-graph:' + r.code, r.id));
    if (!res) return { ok: false, graph: null, issues: [], byNote: byNote, unsupported: [...unsupported.values()], removed: removed };
    return { ok: true, graph: res.graph, issues: res.issues, byNote: byNote, unsupported: [...unsupported.values()], removed: removed };
  }

  /* what the two Scores look like, for writing the adapter against */
  function describe(a, b) {
    const shape = s => ({
      keys: Object.keys(s).sort(),
      measure0: s.measures && s.measures[0],
      note0: s.notes && s.notes[0],
      note1: s.notes && s.notes[1],
      counts: ['measures', 'notes', 'chords', 'pedals', 'ottavas', 'marks', 'tempos', 'dynamics', 'wedges']
        .reduce((o, k) => { o[k] = (s[k] || []).length; return o; }, {})
    });
    return { app: shape(a), graph: b ? shape(b) : null };
  }

  return Object.freeze({ toScore, compare, describe, inferredNotation, unfinalize, comparable, agree, link, fromScore,
    NOTE_SCALARS, MEASURE_SCALARS, MEASURE_OBJECTS, SCORE_LISTS });
});
