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
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./pitch.js'), require('./time.js'));
  else {
    const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {};
    M.legacyScore = factory(M.rational, M.schema, M.pitch, M.time);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, P, T) {
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
          notes.push(Object.assign({}, common, { p: null, midi: null, staff: globalStaff(pi, e.staff),
            rest: true, chord: false, tieStop: false, tieStart: false,
            slurStart: slurOut.has(e.id), slurStop: slurIn.has(e.id),
            acc: null, hand: 'r', finger: undefined }));
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
  function compare(a, b) {
    const out = [];
    const say = (field, detail) => out.push({ field: field, detail: detail });
    ['title', 'composer', 'tempo', 'staves'].forEach(k => {
      if (String(a[k]) !== String(b[k])) say(k, JSON.stringify(a[k]) + ' vs ' + JSON.stringify(b[k]));
    });
    cmpList(say, 'measures', a.measures, b.measures, m => m.number,
      ['number', 'lenQ', 'w'], ['time', 'key', 'clefs', 'clefChanges', 'bar']);
    cmpList(say, 'notes', a.notes, b.notes,
      n => n.m + '@' + (Math.round(n.b * 1e6) / 1e6) + ':' + n.staff + ':' + n.voice + ':' + (n.p || 'rest'),
      ['m', 'b', 'dur', 'p', 'midi', 'staff', 'voice', 'rest', 'chord', 'tieStop', 'tieStart',
        'slurStart', 'slurStop', 'type', 'dots', 'acc', 'hand', 'finger', 'stem', 'dx', 'arp',
        'accent', 'marcato', 'tupletStart', 'tupletStop', 'dyn'], ['tm']);
    ['chords', 'pedals', 'ottavas', 'marks', 'tempos', 'dynamics', 'wedges'].forEach(k => {
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

  return Object.freeze({ toScore, compare, describe, inferredNotation });
});
