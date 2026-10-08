/* ============================================================================
   PPP practice — the PlaybackPlan, made from a ScoreGraph (docs/GOALS/G11 §6.1, G11-D1)

   build(graph, opts) -> Plan
   of(graph, opts)    -> the same Plan, cached on a frozen graph by its options (PianoScore.of's role)
   followGates(plan, hands, opts) -> the onsets follow mode asks, in the order it asks them

   The app plays, judges and lights a piece from one object, the plan PianoScore.build makes from the legacy
   Score: visits (the sounding order of the measures), strikes (every note that is struck, with its sounding
   time and release), ccs (the pedals), beats, the tempo map. The scheduler, the matcher, the falling notes and
   the simulator all read that shape. This module makes the same shape from the graph, and puts the graph's ids
   on it (every strike names its event and head, every visit its measure), so that nothing downstream has to
   change when the player is moved onto the graph (G11-D1: an adapter, not a new player).

   THE CONTRACT IS PARITY. With legacyCompat (the default) the plan is the one PianoScore.build makes for the
   Score the app holds for the same graph (Score.finalize(legacy.toScore(graph))): the same visits, the same
   strikes with the same times, releases and velocities, the same controller events, beats and tempo map, to
   the last bit of the float. Where the old player is wrong (D.C./D.S./Fine, grace notes, follow mode skipping
   repeats and dangling ties) the repair is an option of its own, off by default (G11-D3):
       jumps  'once'   the D.C. / D.S. / Fine / To Coda signs are followed, once, as an engraver reads them
       graces 'play'   a grace note sounds before (acciaccatura) or on (appoggiatura) the beat
       followGates(plan, hands, {repeats, ties})   FOLLOW_REPEAT, FOLLOW_TIE
   and the old player's quirks that are arguably right are kept in both modes (E4): a backward repeat with no
   forward repeat inside the range goes back to the start of the range, a pedal is copied into every visit,
   a tie that leads nowhere strikes. legacyCompat:false reads four things from the graph more exactly than the
   Score stated them, and nothing else: a repeat sign on either bar line, a tie by the head its spanner names
   (the old match was by pitch and place, which two voices in unison confuse), the beats by the meter's own
   groups (6/4 in two, 3+2/8 in two), the release of a half pedal (0, where the Score gave it the depth). It
   never turns a repair on.

   Everything is a pure function of the graph and the options: no DOM, no clock, no globals read. Notated time
   is read in the graph's exact rationals and turned into the app's float quarters by the one formula the
   projection uses (legacy-score.js Q), so a position here is bit for bit the Score's.

   THE PLAN (same fields as PianoScore.build, plus ids)
     visits   [{index, id, number, pass, leg, startQ, lenQ, soundQ}]   written quarters in, sounding quarters out
     strikes  [{midi, vel, q, upQ, hand, m, abs, ev, head, visit, note, b, staff, arp, grace?}]
              sorted by (q, midi) like the old plan. `note` is the item of `written` the strike comes from (it
              has the fields the matcher reads of a Score note: m, b, staff, hand, arp, abs, dur). A strike with
              `grace` is a grace note: the matcher must not expect it (G11 §6.1: not judged until a later
              decision), the scheduler plays it like any other.
     ccs      [{q, kind, cc, value, type}]  sounding time; ccsWritten the same in written quarters
     beats    [{q, accent, m}]              sounding time; beatsWritten in written quarters
     tempoMap [{q, bpm}]                    sounding time (PianoScore.msAt/qAt/soundAtWritten read it unchanged)
     pedal    [[down, up], ...]             the damper's spans in written quarters
     hold     Map head id -> quarters       a tied chain's length, at its first note
     cont     Set of head ids               the notes a tie carries into: not struck
     dyn      {marks, wedges, velAt}        written dynamics
     soundLengthQ, written (the notes and rests of the range in Score order, for the gates), span, range,
     jumps    [{kind, from, to}]            the signs that were followed (empty unless opts.jumps)
   ============================================================================ */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/pitch.js'));
  else {
    const M = root.PPPScoreGraphModules || {};
    (root.PPPPractice = root.PPPPractice || {}).plan = factory(M.rational, M.pitch);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P) {
  'use strict';
  if (!R || !P) throw new Error('practice/plan.js needs scoregraph/rational.js and scoregraph/pitch.js loaded before it');

  /* What the app's player uses where the score says nothing (App PIANO.velocity, PianoScore's tables). */
  const FALLBACK_QPM = 84;
  const FALLBACK_VELOCITY = 80;
  const DYN_VEL = {
    pppp: 8, ppp: 16, pp: 32, p: 48, mp: 64, mf: 80, f: 96, ff: 112, fff: 124, ffff: 127,
    sf: 108, sfz: 112, sffz: 124, fz: 108, rf: 104, rfz: 104, fp: 96, pf: 80, sfp: 108, sfpp: 96, n: 80
  };
  const PEDAL_CC = { damper: 64, sostenuto: 66, soft: 67 };
  const NOTE_UNIT = { breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
  /* The play-order walk stops here, as the app's does (Score.form: guard 8000). */
  const VISIT_LIMIT = 8000;
  /* Grace notes (opts.graces): the length of one slashed grace, at most, and the share of the main note an unslashed
     group may take. A 32nd note is 125 ms at 120 and 62 ms at 60 a minute: short enough to read as a crush. */
  const ACCIACCATURA_Q = 0.125;
  const APPOGGIATURA_SHARE = 0.5;

  function fail(code, message) {
    const e = new Error(code + ': ' + message);
    e.code = code;
    return e;
  }

  /* --------------------------------------------------------------- numbers */
  /* W -> quarters, the formula legacy-score.js uses (Q): the same float, bit for bit. A score repeats a few values. */
  const FOUR = R.make(4);
  const QMEMO = new Map();
  function Q(w) {
    let v = QMEMO.get(w);
    if (v === undefined) {
      if (QMEMO.size > 20000) QMEMO.clear();
      v = R.toNumber(R.mul(R.parse(w), FOUR));
      QMEMO.set(w, v);
    }
    return v;
  }
  const round6 = x => Math.round(x * 1e6) / 1e6;
  const intOf = x => parseInt(x, 10);

  /* ------------------------------------------------------------- the layout */
  /* The measures laid end to end on the quarter line, as Score.finalize lays them: a measure's length is its
     duration rounded to 6 decimals, one that has none is the time signature's, and a start is the running float sum.
     The number is the app's: <measure number> as an integer, else the measure's place (1-based). */
  function layoutOf(g) {
    const tl = g.timeline, ms = tl.measures, n = ms.length;
    const idx = new Map();
    ms.forEach((m, i) => { if (!idx.has(m.id)) idx.set(m.id, i); });
    const metersBy = new Map((tl.meters || []).map(x => [x.m, x]));
    const meterAt = [];
    let mt = null;
    ms.forEach(m => { if (metersBy.has(m.id)) mt = metersBy.get(m.id); meterAt.push(mt); });
    const number = [], lenQ = [], startQ = [];
    let q = 0;
    ms.forEach((m, i) => {
      const k = intOf(m.number);
      number.push(isFinite(k) ? k : i + 1);
      let len = round6(Q(m.dur));
      if (!(len > 0)) { const t = meterAt[i]; len = ((t ? t.beats[0] : 4) * 4) / (t ? t.beatType : 4); }
      startQ.push(q);
      lenQ.push(len);
      q += len;
    });
    return { g: g, n: n, idx: idx, meterAt: meterAt, number: number, lenQ: lenQ, startQ: startQ, endQ: q };
  }
  /* The measure that contains a written quarter (Score.at): the last one that starts at or before it. */
  function measureAt(L, q) {
    if (!L.n) return 1;
    if (q < L.startQ[0]) return L.number[0];
    let lo = 0, hi = L.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (L.startQ[mid] <= q) lo = mid; else hi = mid - 1;
    }
    return L.number[lo];
  }

  function rangeOf(L, range) {
    const at = (x, dflt) => {
      if (x === undefined || x === null) return dflt;
      if (typeof x === 'number') {
        if (!Number.isInteger(x) || x < 0 || x >= L.n) throw fail('E-RANGE', 'measure index ' + x + ' is not in 0..' + (L.n - 1));
        return x;
      }
      const i = L.idx.get(x);
      if (i === undefined) throw fail('E-RANGE', 'no measure ' + JSON.stringify(x));
      return i;
    };
    return { i0: at(range && range.from, 0), i1: at(range && range.to, L.n - 1) };
  }

  /* ------------------------------------------------------------ bar marks */
  /* What the play order reads of each measure. legacyCompat reads the bar lines as legacy.toScore writes them on the
     Score (a forward repeat on the left line, a backward one on the right); the graph rule (time.js barMarks) takes
     either line. An ending opens on the measure it starts, closes on the one it ends. */
  function barMarks(g, L, compat) {
    const marks = g.timeline.measures.map(m => {
      const bl = m.barline || {};
      const out = {};
      if (compat) {
        if (bl.left && bl.left.repeat === 'forward') out.repeatStart = true;
        if (bl.right && bl.right.repeat === 'backward') out.repeatEnd = bl.right.times !== undefined ? bl.right.times : 2;
      } else {
        if ((bl.left && bl.left.repeat === 'forward') || (bl.right && bl.right.repeat === 'forward')) out.repeatStart = true;
        const back = (bl.right && bl.right.repeat === 'backward') ? bl.right : (bl.left && bl.left.repeat === 'backward') ? bl.left : null;
        if (back) out.repeatEnd = Number.isInteger(back.times) && back.times > 0 ? back.times : 2;
      }
      return out;
    });
    const started = new Set();
    (g.timeline.endings || []).forEach(en => {
      const fi = L.idx.get(en.from), ti = L.idx.get(en.to);
      if (fi === undefined || ti === undefined) return;
      if (!started.has(fi) && en.numbers && en.numbers.length) { marks[fi].endingNos = en.numbers; started.add(fi); }
      marks[ti].endingEnd = true;
    });
    return marks;
  }

  /* The signs that jump (G11-D3 JUMP): {kind, mi, to}, `to` the measure index it turns to (null: nowhere). A D.S. goes to
     the segno before it (the nearest one; else the first), a To Coda to the coda after it (the nearest; else none), a D.C.
     to the start of the range (`to` null: the walk supplies it). A jump that names its target (Jump.target) goes there.
     A sign acts at the end of the measure that holds it: the importer states where in the measure a direction was
     written, not where the music turns, and a D.C. above the last bar is as often written at the bar's start as at its end. */
  function jumpsOf(g, L) {
    const list = [];
    ((g.timeline && g.timeline.jumps) || []).forEach(j => {
      const mi = L.idx.get(j.m);
      if (mi !== undefined) list.push({ id: j.id, kind: j.kind, mi: mi, target: j.target });
    });
    const byId = new Map(list.map(j => [j.id, j]));
    const signs = kind => list.filter(j => j.kind === kind);
    const segnos = signs('segno'), codas = signs('coda');
    list.forEach(j => {
      let t = null;
      if (j.target && byId.has(j.target)) t = byId.get(j.target).mi;
      else if (j.kind === 'dalsegno') {
        const before = segnos.filter(s => s.mi <= j.mi);
        t = before.length ? before[before.length - 1].mi : segnos.length ? segnos[0].mi : null;
      } else if (j.kind === 'tocoda') {
        const after = codas.filter(c => c.mi > j.mi);
        t = after.length ? after[0].mi : null;
      }
      j.to = t;
    });
    return list;
  }

  /* ----------------------------------------------------------- play order */
  /* Score.form (App 4124), over measure indexes: the repeats, voltas and the loop-start target as the app reads them,
     for the range i0..i1. With `jumps` it also follows D.C. / D.S. / To Coda / Fine, once:
       - a D.C. or D.S. in a measure that is played (not skipped by a volta) turns back after that measure, to the start
         of the range or to the segno; only when the target lies inside the range, and only the first one;
       - on the way back the repeat signs are not taken (an engraver's reading) and a volta plays the last ending the
         piece has (`backPass`), so a repeated section is played once, through its last ending;
       - on the way back a To Coda turns to its coda, and a Fine ends the piece.
     A visit is {index, pass, leg}: leg 0 is the first time through, 1 the way back. */
  function walk(L, marks, i0, i1, jumps, endings) {
    const ms = L.n;
    const visits = [], log = [], startStack = [], taken = {}, passAt = {};
    const at = {};
    (jumps || []).forEach(j => { (at[j.mi] = at[j.mi] || []).push(j); });
    let backPass = 1;
    (endings || []).forEach(en => (en.numbers || []).forEach(x => { if (x > backPass) backPass = x; }));
    let openEnding = null, i = i0, guard = 0, leg = 0, turned = false;
    const passNow = () => {
      const s = startStack.length ? startStack[startStack.length - 1] : i0;
      return passAt[s] || 1;
    };
    while (ms && i >= i0 && i <= i1 && guard++ < VISIT_LIMIT) {
      const bar = marks[i];
      if (!leg && bar.repeatStart) startStack.push(i);
      if (bar.endingNos && bar.endingNos.length) openEnding = bar.endingNos;
      const pass = leg ? backPass : passNow();
      const skip = !!(openEnding && openEnding.length && openEnding.indexOf(pass) < 0);
      if (!skip) visits.push({ index: i, pass: pass, leg: leg });
      if (bar.endingEnd) openEnding = null;
      if (!skip && !leg && bar.repeatEnd) {
        const times = bar.repeatEnd > 0 ? bar.repeatEnd : 2;
        taken[i] = (taken[i] || 0) + 1;
        if (taken[i] < times) {
          const start = startStack.length ? startStack[startStack.length - 1] : i0;
          /* nested repeats start over inside this one, not the end just counted */
          Object.keys(taken).forEach(k => { if (+k > start && +k < i) delete taken[k]; });
          Object.keys(passAt).forEach(k => { if (+k > start) delete passAt[k]; });
          passAt[start] = (passAt[start] || 1) + 1;
          i = start;
          continue;
        } else if (startStack.length) startStack.pop();
      }
      if (!skip && at[i]) {
        const here = at[i];
        if (leg) {
          if (here.some(j => j.kind === 'fine')) break;
          const toCoda = here.find(j => j.kind === 'tocoda' && j.to !== null && j.to >= i0 && j.to <= i1);
          if (toCoda) { i = toCoda.to; log.push({ kind: 'tocoda', from: visits.length - 1, to: i }); continue; }
        } else if (!turned) {
          const goal = j => (j.kind === 'dacapo' && j.to === null ? i0 : j.to);
          const back = here.find(j => (j.kind === 'dacapo' || j.kind === 'dalsegno') && goal(j) !== null && goal(j) >= i0 && goal(j) <= i1);
          if (back) {
            turned = true; leg = 1; openEnding = null;
            i = goal(back);
            log.push({ kind: back.kind, from: visits.length - 1, to: i });
            continue;
          }
        }
      }
      i++;
    }
    return { visits: visits, jumps: log };
  }

  /* ----------------------------------------------------------------- items */
  /* The notes and rests of the graph as the Score holds them (legacy.toScore): one item per head (a rest has one for
     the event), the part the app plays chosen as it chooses it, hands from the staves, the first head of an event
     carrying its accent, marcato and printed dynamic. Grace events are not in `items` (the Score drops them): with
     opts.graces they are the second list. */
  function itemsOf(g, L, wantGraces) {
    const partBase = [];
    let base = 0;
    g.parts.forEach(p => { partBase.push(base); base += Math.max(1, p.staves.length); });
    const globalStaff = (pi, staffId) => {
      const local = g.parts[pi].staves.findIndex(s => s.id === staffId);
      return partBase[pi] + (local < 0 ? 0 : local) + 1;
    };
    let pianoGuess = g.parts.findIndex(p => p.staves.length >= 2);
    if (pianoGuess < 0) pianoGuess = g.parts.length - 1;

    const tieIn = new Set(), tieOut = new Set(), arpHeads = new Set();
    g.parts.forEach(part => part.spanners.forEach(s => {
      if (s.type === 'tie') { if (s.from) tieOut.add(s.from); if (s.to) tieIn.add(s.to); }
      else if (s.type === 'arpeggio') (s.heads || []).forEach(h => arpHeads.add(h));
    }));
    const dynOnEvent = new Map();
    g.parts.forEach(part => part.directions.forEach(d => {
      if (d.kind === 'dynamic' && d.event !== undefined) dynOnEvent.set(d.event, d.value);
    }));

    const items = [], graces = [];
    g.parts.forEach((part, pi) => {
      part.events.forEach(e => {
        const mi = L.idx.get(e.m);
        if (mi === undefined) return;
        if (e.grace && !wantGraces) return;                 /* the Score drops grace notes (legacy.toScore R2) */
        const b = Q(e.at), dur = Q(e.dur);
        const common = { ev: e.id, m: L.number[mi], mi: mi, b: b, dur: dur, abs: L.startQ[mi] + b, part: pi, voice: e.voice, hand: 'r' };
        if (e.grace) common.grace = { order: e.grace.order, slash: !!e.grace.slash, type: e.display && e.display.type };
        const out = e.grace ? graces : items;
        if (e.kind === 'rest') {
          out.push(Object.assign({}, common, { head: null, rest: true, midi: null, staff: globalStaff(pi, e.staff),
            tieStart: false, tieStop: false, chord: false }));
          return;
        }
        const accent = !!(e.arts && e.arts.indexOf('accent') >= 0);
        const marcato = !!(e.arts && e.arts.indexOf('marcato') >= 0);
        const dyn = dynOnEvent.get(e.id);
        (e.heads || []).forEach((h, hi) => {
          const n = Object.assign({}, common, {
            head: h.id, rest: false, midi: h.pitch ? P.midi(h.pitch) : null,
            staff: globalStaff(pi, h.staff || e.staff),
            tieStart: tieOut.has(h.id), tieStop: tieIn.has(h.id), chord: hi > 0
          });
          if (arpHeads.has(h.id)) n.arp = true;
          if (hi === 0 && accent) n.accent = true;
          if (hi === 0 && marcato) n.marcato = true;
          if (hi === 0 && dyn !== undefined) n.dyn = dyn;
          out.push(n);
        });
      });
    });
    /* hands (legacy.toScore, App 4303): the piano is the first part with two staves, else the last */
    const span = g.parts.map((p, i) => ({ base: partBase[i], count: Math.max(1, p.staves.length) }));
    let pianoPart = span.findIndex(sp => sp && sp.count >= 2);
    if (pianoPart < 0) pianoPart = span.length - 1;
    const piano = span[pianoPart] || { base: 0, count: 2 };
    const handOf = n => {
      const staff = n.staff || 1;
      const lh = piano.base + piano.count;
      const rh = piano.count >= 2 ? lh - 1 : lh;
      if (piano.count >= 2) return staff === rh ? 'r' : staff === lh ? 'l' : 'x';
      return staff === (piano.base + 1) ? 'r' : 'x';
    };
    items.forEach(n => { n.hand = handOf(n); });
    graces.forEach(n => { n.hand = handOf(n); });
    if (!items.some(n => n.hand !== 'x')) {
      items.forEach(n => { n.hand = n.staff <= 1 ? 'r' : 'l'; });
      graces.forEach(n => { n.hand = n.staff <= 1 ? 'r' : 'l'; });
    }
    items.sort((a, b) => a.abs - b.abs || (a.staff || 1) - (b.staff || 1));
    return { items: items, graces: graces, pianoGuess: pianoGuess };
  }

  /* ------------------------------------------------------------------ ties */
  /* A note is struck unless a tie really carries the one before it into it. legacyCompat matches a tie's end by
     pitch and position, as PianoScore.ties does (the note that sounds the same pitch exactly where this one ends,
     to 3 decimals); the graph rule follows the tie spanner from head to head. Either way a tie that leads nowhere
     strikes its note, and `hold` is the chain's length at its first note. */
  function ties(g, items, compat) {
    const hold = new Map(), cont = new Set();
    if (compat) {
      const at = new Map();
      items.forEach(n => { if (!n.rest && n.tieStop) at.set(n.midi + '@' + n.abs.toFixed(3), n); });
      items.forEach(n => {
        if (n.rest || !n.tieStart || cont.has(n.head)) return;
        let q = n.dur, cur = n;
        for (let i = 0; i < 32 && cur.tieStart; i++) {
          const nx = at.get(n.midi + '@' + (cur.abs + cur.dur).toFixed(3));
          if (!nx || nx === cur) break;
          q += nx.dur; cur = nx;
          cont.add(nx.head);
        }
        hold.set(n.head, q);
      });
      return { hold: hold, cont: cont };
    }
    const next = new Map();
    g.parts.forEach(part => part.spanners.forEach(s => {
      if (s.type === 'tie' && s.from && s.to && !next.has(s.from)) next.set(s.from, s.to);
    }));
    const byHead = new Map();
    items.forEach(n => { if (!n.rest) byHead.set(n.head, n); });
    next.forEach((to, from) => { if (byHead.has(from) && byHead.has(to) && from !== to) cont.add(to); });
    items.forEach(n => {
      if (n.rest || !n.tieStart || cont.has(n.head)) return;
      let q = n.dur, cur = n;
      for (let i = 0; i < 64; i++) {
        const nx = byHead.get(next.get(cur.head));
        if (!nx || nx === cur || !cont.has(nx.head)) break;
        q += nx.dur; cur = nx;
      }
      hold.set(n.head, q);
    });
    return { hold: hold, cont: cont };
  }
  function struck(plan, n) { return !n.rest && !(n.tieStop && plan.cont.has(n.head)); }
  function holdOf(plan, n) { const h = plan.hold.get(n.head); return Math.max(0.05, h != null ? h : n.dur || 0); }

  /* ----------------------------------------------------------------- pedal */
  /* The pedal as the Score states it: one entry per start, change and stop of the part the app plays, a doubled end
     (a printed <pedal> and a <sound *-pedal> for one action) as two entries, plain then valued (legacy.toScore). */
  function pedalMarks(g, L, pianoGuess, compat) {
    const out = [];
    const part = g.parts[pianoGuess];
    if (!part) return out;
    part.spanners.forEach(s => {
      if (s.type !== 'pedal') return;
      const at = pos => {
        const i = L.idx.get(pos.m);
        return i === undefined ? null : { q: L.startQ[i] + Q(pos.at) };
      };
      const dbl = s.ext && s.ext['musicxml.pedal'];
      const one = (pos, type, doubled, val) => {
        const a = at(pos);
        if (!a) return;
        if (doubled) out.push({ q: a.q, type: type, kind: s.pedal });
        const x = { q: a.q, type: type, kind: s.pedal };
        /* a sound-only pedal says how deep it goes (a half pedal); the old Score gave its release that depth as well, so the
           pedal never came up (CC 64 stayed at 64). The graph rule lets the release be 0. */
        if (s.soundOnly || doubled) x.value = val !== undefined ? val : (s.depth !== undefined && (compat || type !== 'stop') ? s.depth : (type === 'stop' ? 0 : 127));
        out.push(x);
      };
      one(s.from, 'start', dbl && dbl.from);
      (s.changes || []).forEach((c, i) => {
        const cv = dbl && dbl.changes && dbl.changes[i];
        one(c, 'change', cv !== null && cv !== undefined, cv);
      });
      if (s.to) one(s.to, 'stop', dbl && dbl.to);
    });
    return out;
  }
  /* a printed pedal change (<pedal type="change"/>), as opposed to a depth the file gives as a number (MX-1) */
  const lifts = p => !!p && p.type === 'change' && p.value == null && (!p.kind || p.kind === 'damper');

  /* [down, up) spans in written quarters for the damper. A printed "change" lets the damper down and presses it again at
     once (MX-1): what only the pedal held stops there, and a key still down carries on into the next span. */
  function damperSpans(marks, lengthQ) {
    const ev = marks.filter(p => !p.kind || p.kind === 'damper')
      .map(p => ({ q: p.q, type: p.type, lift: lifts(p) }))
      .sort((a, b) => a.q - b.q);
    const spans = [];
    let down = null;
    ev.forEach(e => {
      if (e.type === 'start') { if (down == null) down = e.q; }
      else if (e.type === 'stop') { if (down != null) spans.push([down, e.q]); down = null; }
      else if (e.type === 'change') {
        if (e.lift && down != null && e.q > down + 1e-6) { spans.push([down, e.q]); down = e.q; }
        else if (down == null) down = e.q;
      }
    });
    if (down != null) spans.push([down, lengthQ]);
    return spans;
  }
  /* every controller action in written quarters, with a change's lift before its re-press (PianoScore.pedalEvents) */
  function pedalEvents(marks) {
    const ev = [];
    marks.forEach(p => {
      const kind = p.kind || 'damper';
      let value = p.value;
      if (lifts(p)) ev.push({ q: p.q, kind: kind, type: p.type, value: 0, lift: true });
      if (value == null) value = p.type === 'stop' ? 0 : 127;
      ev.push({ q: p.q, kind: kind, type: p.type, value: Math.max(0, Math.min(127, value | 0)) });
    });
    ev.sort((a, b) => a.q - b.q || a.kind.localeCompare(b.kind));
    const out = [];
    ev.forEach(e => {
      const last = out[out.length - 1];
      /* one pedal at one point: the last word wins, except that a change's lift keeps its re-press */
      if (last && last.kind === e.kind && Math.abs(last.q - e.q) < 1e-6 && !last.lift) out[out.length - 1] = e;
      else out.push(e);
    });
    return out;
  }
  function pedalCCs(written, visits) {
    const out = [];
    visits.forEach(v => {
      written.forEach(e => {
        if (e.q >= v.startQ - 1e-9 && e.q < v.startQ + v.lenQ - 1e-9)
          out.push({ q: v.soundQ + (e.q - v.startQ), kind: e.kind, cc: PEDAL_CC[e.kind] || 64, value: e.value, type: e.type });
      });
    });
    return out.sort((a, b) => a.q - b.q);
  }
  function sostenutoSpans(written) {
    const spans = [];
    let down = null;
    written.forEach(e => {
      if (e.kind !== 'sostenuto') return;
      if (e.value > 0 && down == null) down = e.q;
      else if (!(e.value > 0) && down != null) { spans.push([down, e.q]); down = null; }
    });
    return spans;
  }

  /* -------------------------------------------------------------- dynamics */
  /* App 3872: what a <sound dynamics> percentage is worth as a velocity */
  function soundDynToVel(v) {
    if (!(v > 0)) return 1;
    if (v <= 1) return Math.max(1, Math.round(v * 90));
    if (v <= 100) return Math.max(1, Math.min(127, Math.round(v * 0.9)));
    return Math.max(1, Math.min(127, Math.round(v)));
  }
  /* The printed dynamics of every part and the <sound dynamics> of the measures, in the one line the Score keeps
     (a printed mark, then its sound, at one position), then dynPlan: marks, wedges, and velAt. */
  function dynamicsOf(g, L) {
    const list = [];
    g.parts.forEach(part => part.directions.forEach(d => {
      const mi = L.idx.get(d.m);
      if (mi === undefined || d.kind !== 'dynamic' || d.event !== undefined) return;
      list.push({ m: L.number[mi], mi: mi, b: Q(d.at), mark: d.value === 'other' ? 'other-dynamics' : d.value });
    }));
    g.timeline.measures.forEach((m, mi) => {
      const sounds = m.ext && m.ext['musicxml.sound'];
      if (!sounds) return;
      sounds.forEach(one => {
        const dv = parseFloat(one.attrs.dynamics);
        if (isFinite(dv)) list.push({ m: L.number[mi], mi: mi, b: Q(one.at), mark: 'sound', vel: soundDynToVel(dv) });
      });
    });
    const at = new Map();
    const key = d => d.m + '|' + Math.round(d.b * 1e6);
    list.forEach(d => {
      if (!at.has(key(d))) at.set(key(d), { printed: [], sound: [] });
      at.get(key(d))[d.mark === 'sound' ? 'sound' : 'printed'].push(d);
    });
    const zipped = [];
    at.forEach(g2 => {
      const n = Math.max(g2.printed.length, g2.sound.length);
      for (let i = 0; i < n; i++) {
        if (g2.printed[i]) zipped.push(g2.printed[i]);
        if (g2.sound[i]) zipped.push(g2.sound[i]);
      }
    });
    zipped.sort((x, y) => x.m - y.m || x.b - y.b);
    const marks = [];
    zipped.forEach(d => {
      let vel = d.vel;
      if (vel == null) vel = DYN_VEL[String(d.mark || '').toLowerCase()];
      if (vel == null) return;
      marks.push({ q: L.startQ[d.mi] + (d.b || 0), mark: d.mark || 'mf', vel: vel });
    });
    marks.sort((a, b) => a.q - b.q);
    /* hairpins: every part's wedge spanners, a start and its stop, in the order the Score lists them */
    const events = [];
    g.parts.forEach(part => part.spanners.forEach(s => {
      if (s.type !== 'wedge') return;
      const from = L.idx.get(s.from.m), to = s.to ? L.idx.get(s.to.m) : undefined;
      if (from !== undefined) events.push({ q: L.startQ[from] + Q(s.from.at), type: s.kind });
      if (to !== undefined) events.push({ q: L.startQ[to] + Q(s.to.at), type: 'stop' });
    }));
    const wedges = [];
    let open = null;
    events.forEach(w => {
      if (w.type === 'crescendo' || w.type === 'diminuendo') open = { q0: w.q, type: w.type };
      else if (w.type === 'stop' && open) { wedges.push({ q0: open.q0, q1: w.q, type: open.type }); open = null; }
    });
    if (open) wedges.push({ q0: open.q0, q1: L.endQ, type: open.type });
    /* the last mark at or before q (marks are in order, so the latest of equal ones wins) */
    const velAt = q => {
      let lo = 0, hi = marks.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (marks[mid].q <= q + 1e-9) lo = mid + 1; else hi = mid; }
      return lo ? marks[lo - 1].vel : FALLBACK_VELOCITY;
    };
    wedges.forEach(s => {
      s.v0 = velAt(s.q0);
      let v1 = null;
      for (let i = 0; i < marks.length; i++) if (marks[i].q >= s.q1 - 1e-6) { v1 = marks[i].vel; break; }
      s.v1 = v1 != null ? v1 : (s.type === 'crescendo' ? Math.min(127, s.v0 + 24) : Math.max(1, s.v0 - 24));
    });
    return { marks: marks, wedges: wedges, velAt: velAt };
  }
  /* The velocity of a note at a written quarter: the dynamic in force, a hairpin over it, accent or marcato, the
     note's own mark, the soft pedal (PianoScore.velocity). `soft` is the written soft-pedal events in order. */
  function velocityOf(dyn, soft, n, writtenQ) {
    let base = dyn.velAt(writtenQ);
    for (let i = 0; i < dyn.wedges.length; i++) {
      const w = dyn.wedges[i];
      if (writtenQ < w.q0 - 1e-9 || writtenQ > w.q1 + 1e-9) continue;
      const t = w.q1 - w.q0 < 1e-6 ? 1 : (writtenQ - w.q0) / (w.q1 - w.q0);
      base = Math.round(w.v0 + (w.v1 - w.v0) * Math.max(0, Math.min(1, t)));
    }
    let vel = base;
    if (n.marcato) vel += 22;
    else if (n.accent) vel += 14;
    if (n.dyn) {
      const k = String(n.dyn).toLowerCase();
      const dv = DYN_VEL[k];
      if (dv != null) vel = /^sf|^fz|^rf/.test(k) ? Math.max(vel, dv) : dv;
    }
    if (softAt(soft, writtenQ)) vel = Math.max(1, Math.round(vel * 0.72));
    return Math.max(1, Math.min(127, vel | 0));
  }
  function softAt(soft, q) {
    let lo = 0, hi = soft.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (soft[mid].q <= q + 1e-9) lo = mid + 1; else hi = mid; }
    return lo ? soft[lo - 1].value > 0 : false;
  }

  /* ----------------------------------------------------------------- tempo */
  /* The tempo events as the Score lists them: a <sound tempo> and a printed metronome mark are two statements, in
     that order, each in beats of a quarter. */
  function tempoEvents(g, L) {
    const out = [];
    (g.timeline.tempos || []).forEach(t => {
      const mi = L.idx.get(t.m);
      if (mi === undefined) return;
      const q = L.startQ[mi] + Q(t.at);
      if (t.qpm !== undefined) out.push({ q: q, bpm: R.toNumber(R.parse(t.qpm)) });
      if (t.mark && t.mark.perMinute !== undefined) {
        const unit = NOTE_UNIT[t.mark.unit] || 1;
        out.push({ q: q, bpm: R.toNumber(R.parse(t.mark.perMinute)) * unit * (2 - Math.pow(0.5, t.mark.dots || 0)) });
      }
    });
    return out;
  }
  /* what plays from each sounding quarter on, one entry per visit and per tempo change inside it (PianoScore.tempoMap) */
  function tempoMapOf(events, fallback, visits) {
    const written = events.filter(t => t.bpm > 0).sort((a, b) => a.q - b.q);
    if (!written.length || written[0].q > 1e-9) written.unshift({ q: 0, bpm: fallback });
    const lastAt = q => {
      let bpm = fallback;
      for (let i = 0; i < written.length; i++) if (written[i].q <= q + 1e-9) bpm = written[i].bpm;
      return bpm;
    };
    const out = [];
    visits.forEach(v => {
      out.push({ q: v.soundQ, bpm: lastAt(v.startQ) });
      written.forEach(t => {
        if (t.q >= v.startQ - 1e-9 && t.q < v.startQ + v.lenQ - 1e-9) out.push({ q: v.soundQ + (t.q - v.startQ), bpm: t.bpm });
      });
    });
    out.sort((a, b) => a.q - b.q);
    const dedup = [];
    out.forEach(p => {
      const last = dedup[dedup.length - 1];
      if (last && Math.abs(last.q - p.q) < 1e-9) dedup[dedup.length - 1] = p;
      else dedup.push(p);
    });
    return dedup.length ? dedup : [{ q: 0, bpm: fallback }];
  }

  /* ----------------------------------------------------------------- beats */
  /* The beats of every measure as the piece is counted. legacyCompat counts as the metronome does (PianoScore.beats):
     the first number of the time signature, compound when the beat is an eighth or less and the number is a multiple
     of three above three (6/8 in two, 6/4 in six), a pickup counted back from its bar line. The graph rule counts by
     the meter's own groups (additive meters by summand, 6/4 compound as 6/8 is, explicit groups as written). */
  function beatsWritten(g, L, compat) {
    const out = [];
    for (let i = 0; i < L.n; i++) {
      const mt = L.meterAt[i];
      const lenQ = L.lenQ[i];
      let sizes, nominal;
      if (compat) {
        const beats = mt ? mt.beats[0] : 4, beatType = mt ? mt.beatType : 4;
        let unit = 4 / beatType, count = beats;
        if (beatType >= 8 && beats % 3 === 0 && beats > 3) { unit *= 3; count = beats / 3; }
        sizes = [unit];
        nominal = unit * count;
      } else {
        const beatsList = mt ? mt.beats : [4], beatType = mt ? mt.beatType : 4;
        if (mt && mt.groups && mt.groups.length) sizes = mt.groups.map(Q);
        else if (beatsList.length > 1) sizes = beatsList.map(b => 4 * b / beatType);
        else {
          const n = beatsList[0];
          sizes = n % 3 === 0 && n > 3 ? Array.from({ length: n / 3 }, () => 12 / beatType) : Array.from({ length: n }, () => 4 / beatType);
        }
        nominal = beatsList.reduce((s, b) => s + b, 0) * 4 / beatType;
      }
      /* a short first measure is a pickup: its beats are counted back from its bar line */
      const lead = i === 0 && lenQ < nominal - 1e-6 ? nominal - lenQ : 0;
      let line = 0;
      for (let j = 0; j < 64; j++) {
        const q = (compat ? j * sizes[0] : line) - lead;
        line += sizes[Math.min(j, sizes.length - 1)];
        if (q < -1e-6) continue;
        if (q >= lenQ - 1e-6) break;
        out.push({ q: L.startQ[i] + q, accent: j === 0 && lead === 0 });
      }
    }
    return out;
  }
  function soundBeats(written, visits) {
    const out = [];
    visits.forEach(v => {
      written.forEach(k => {
        if (k.q >= v.startQ - 1e-9 && k.q < v.startQ + v.lenQ - 1e-9) out.push({ q: v.soundQ + (k.q - v.startQ), accent: k.accent, m: v.number });
      });
    });
    return out.sort((a, b) => a.q - b.q);
  }

  /* ------------------------------------------------------------ grace notes */
  /* Grace events grouped by measure: one group is the graces of one voice at one position, in `order`. */
  function graceGroups(graces) {
    const by = new Map();
    graces.forEach(n => {
      const key = n.mi + '|' + n.part + '|' + n.voice + '|' + n.b;
      let grp = by.get(key);
      if (!grp) { grp = { mi: n.mi, part: n.part, voice: n.voice, b: n.b, abs: n.abs, notes: [] }; by.set(key, grp); }
      grp.notes.push(n);
    });
    const out = new Map();
    by.forEach(grp => {
      grp.notes.sort((a, c) => a.grace.order - c.grace.order);
      const orders = [];
      grp.notes.forEach(n => { if (orders.indexOf(n.grace.order) < 0) orders.push(n.grace.order); });
      grp.orders = orders;
      grp.slash = grp.notes[0].grace.slash;
      if (!out.has(grp.mi)) out.set(grp.mi, []);
      out.get(grp.mi).push(grp);
    });
    return out;
  }
  const TYPE_Q = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
    '128th': 0.03125, '256th': 0.015625, '512th': 0.0078125, '1024th': 0.00390625 };

  /* ---------------------------------------------------------------- the plan */
  function normalize(o) {
    o = o || {};
    if (o.jumps !== undefined && o.jumps !== false && o.jumps !== 'once') throw fail('E-OPTION', 'jumps must be false or \'once\', not ' + JSON.stringify(o.jumps));
    if (o.graces !== undefined && o.graces !== false && o.graces !== 'play') throw fail('E-OPTION', 'graces must be false or \'play\', not ' + JSON.stringify(o.graces));
    if (o.defaultQpm !== undefined && o.defaultQpm !== null && !(o.defaultQpm > 0 && isFinite(o.defaultQpm)))
      throw fail('E-OPTION', 'defaultQpm must be a positive number, not ' + JSON.stringify(o.defaultQpm));
    return { legacyCompat: o.legacyCompat !== false, jumps: o.jumps === 'once' ? 'once' : false, graces: o.graces === 'play' ? 'play' : false,
      range: o.range || null, defaultQpm: o.defaultQpm == null ? null : o.defaultQpm };
  }

  function build(g, options) {
    const opts = normalize(options);
    const compat = opts.legacyCompat;
    const L = layoutOf(g);
    const { i0, i1 } = rangeOf(L, opts.range);
    const marks = barMarks(g, L, compat);
    const order = walk(L, marks, i0, i1, opts.jumps ? jumpsOf(g, L) : null, g.timeline.endings);

    const visits = order.visits.map(v => ({ index: v.index, id: g.timeline.measures[v.index].id, number: L.number[v.index], pass: v.pass, leg: v.leg,
      startQ: L.startQ[v.index], lenQ: L.lenQ[v.index], soundQ: 0 }));
    let soundLengthQ = 0;
    visits.forEach(v => { v.soundQ = soundLengthQ; soundLengthQ += v.lenQ; });

    const { items, graces, pianoGuess } = itemsOf(g, L, opts.graces === 'play');
    const tie = ties(g, items, compat);
    const pedalMark = pedalMarks(g, L, pianoGuess, compat);
    const pedal = damperSpans(pedalMark, L.endQ);
    const ccsWritten = pedalEvents(pedalMark);
    const dyn = dynamicsOf(g, L);
    const tempoEv = tempoEvents(g, L);
    const fallback = opts.defaultQpm != null ? opts.defaultQpm : (Math.round(tempoEv.length ? tempoEv[0].bpm : FALLBACK_QPM) || FALLBACK_QPM);
    const beatsW = beatsWritten(g, L, compat);

    const plan = {
      graph: { id: g.id, rev: g.rev }, opts: opts,
      range: { from: g.timeline.measures[i0] ? g.timeline.measures[i0].id : null, to: g.timeline.measures[i1] ? g.timeline.measures[i1].id : null, i0: i0, i1: i1 },
      span: { a: L.n ? L.startQ[i0] : 0, b: L.n ? L.startQ[i1] + L.lenQ[i1] : 0 },
      hold: tie.hold, cont: tie.cont, pedal: pedal, beatsWritten: beatsW, visits: visits, soundLengthQ: soundLengthQ,
      dyn: dyn, ccsWritten: ccsWritten, jumps: order.jumps, layout: L
    };
    plan.tempoMap = tempoMapOf(tempoEv, fallback, visits);
    plan.ccs = pedalCCs(ccsWritten, visits);
    plan.beats = soundBeats(beatsW, visits);
    /* the notes and rests of the range in Score order, for the follow gates (Score.allIn) */
    plan.written = L.n ? items.filter(n => n.abs >= plan.span.a - 1e-9 && n.abs < plan.span.b - 1e-9) : [];
    plan.strikes = strikesOf(plan, items, graces, ccsWritten);
    return plan;
  }

  /* One strike per struck note of every visit, with its sounding time, release and velocity (PianoScore.strikes). A
     note is held for its written length, through its tie chain; if the damper is down where it comes up the string
     goes on sounding until the pedal lifts; a sostenuto that catches it holds it to the sostenuto's end. */
  function strikesOf(plan, items, graces, ccsWritten) {
    const out = [];
    const sost = sostenutoSpans(ccsWritten);
    const soft = ccsWritten.filter(e => e.kind === 'soft');
    const dyn = plan.dyn;
    const L = plan.layout;
    const playable = items.filter(n => !n.rest);
    /* a rolled chord: every note of its position on that staff (the matcher's `arp`) */
    const rolled = new Set();
    playable.forEach(n => { if (n.arp && n.abs >= plan.span.a - 1e-9 && n.abs < plan.span.b - 1e-9) rolled.add(n.mi + '|' + n.b + '|' + (n.staff || 1)); });
    const wantGraces = plan.opts.graces === 'play' && graces.length > 0;
    const groups = wantGraces ? graceGroups(graces) : null;
    const extended = new Set();                        /* strikes whose release a pedal or sostenuto moved */
    let previous = [];
    plan.visits.forEach(v => {
      const from = v.startQ - 1e-9, to = v.startQ + v.lenQ - 1e-9;
      let lo = 0, hi = playable.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (playable[mid].abs < from) lo = mid + 1; else hi = mid; }
      const here = [];
      for (let k = lo; k < playable.length && playable[k].abs < to; k++) {
        const n = playable[k];
        if (!struck(plan, n)) continue;
        const q = v.soundQ + (n.abs - v.startQ);
        const h = holdOf(plan, n);
        let upWritten = n.abs + h;
        let moved = false;
        for (let i = 0; i < plan.pedal.length; i++) {
          const s = plan.pedal[i];
          if (upWritten > s[0] + 1e-6 && upWritten < s[1] - 1e-6) { upWritten = s[1]; moved = true; break; }
        }
        sost.forEach(s => {
          if (n.abs <= s[0] + 1e-9 && n.abs + h > s[0] + 1e-9 && s[1] > upWritten) { upWritten = s[1]; moved = true; }
        });
        const st = {
          midi: n.midi, vel: velocityOf(dyn, soft, n, n.abs), q: q, upQ: q + (upWritten - n.abs),
          hand: n.hand, m: n.m, abs: n.abs, ev: n.ev, head: n.head, visit: v, note: n, b: n.b, staff: n.staff,
          arp: rolled.has(n.mi + '|' + n.b + '|' + (n.staff || 1))
        };
        if (moved) extended.add(st);
        here.push(st);
      }
      if (wantGraces && groups.has(v.index)) graceStrikes(plan, v, groups.get(v.index), here, previous, extended, soft, out);
      here.forEach(s => out.push(s));
      previous = here;
    });
    return out.sort((a, b) => a.q - b.q || a.midi - b.midi);
  }

  /* The graces of one visit (opts.graces 'play'). A group is the graces of one voice at one position; its notes sound in
     `order`, a chord of graces together. The group belongs to the struck notes of its own voice at that position (the
     main notes). A slashed group (an acciaccatura) is crushed in just before the beat and takes the time from the
     note before it: that note's release is cut to the first grace if it was to sound up to the beat. An unslashed group
     (an appoggiatura) sounds on the beat and the main notes sound after it, taking the time from themselves, up to half
     of their written length. A group with no struck main note (a grace after the last note of the bar, before a rest,
     before a tied note) and an acciaccatura that would start before the first sound of the plan are played before
     their position; a group whose main note is there and would start before 0 plays as an appoggiatura. */
  function graceStrikes(plan, v, groups, here, previous, extended, soft, out) {
    const dyn = plan.dyn;
    groups.forEach(grp => {
      const mains = here.filter(s => s.note.part === grp.part && s.note.voice === grp.voice && s.note.mi === grp.mi && s.note.b === grp.b);
      const base = mains.length ? mains[0].q : v.soundQ + (grp.abs - v.startQ);
      const lenOf = n => TYPE_Q[(n.grace && n.grace.type) || 'eighth'] || 0.5;
      const slots = grp.orders.map(o => Math.max.apply(null, grp.notes.filter(n => n.grace.order === o).map(lenOf)));
      const sum = xs => xs.reduce((t, x) => t + x, 0);
      /* the time the main notes can give: half of the shortest of them */
      const room = mains.length ? Math.min.apply(null, mains.map(s => s.note.dur)) * APPOGGIATURA_SHARE : 0;
      const fit = xs => (sum(xs) > room && sum(xs) > 0 ? xs.map(x => x * room / sum(xs)) : xs);
      const crushed = slots.map(x => Math.min(x, ACCIACCATURA_Q));
      let appoggiatura = grp.slash === false && mains.length > 0;
      let slot = appoggiatura ? fit(slots) : crushed;
      /* nothing sounds before the plan starts: a crushed group at the very start takes its time from the main notes */
      if (!appoggiatura && mains.length && base - sum(crushed) < 0) { appoggiatura = true; slot = fit(crushed); }
      const spent = slot.reduce((s, x) => s + x, 0);
      const first = appoggiatura ? base : Math.max(0, base - spent);
      let off = 0;
      const starts = [];
      slot.forEach(x => { starts.push(first + off); off += x; });
      grp.notes.forEach(n => {
        const k = grp.orders.indexOf(n.grace.order);
        const q = starts[k];
        let upQ = q + slot[k];
        /* the damper holds a grace as it holds any note */
        const writtenUp = n.abs + (upQ - base);
        for (let i = 0; i < plan.pedal.length; i++) {
          const s = plan.pedal[i];
          if (writtenUp > s[0] + 1e-6 && writtenUp < s[1] - 1e-6) { upQ = Math.max(upQ, base + (s[1] - n.abs)); break; }
        }
        out.push({
          midi: n.midi, vel: velocityOf(dyn, soft, n, n.abs), q: q, upQ: upQ, hand: n.hand, m: n.m, abs: n.abs, ev: n.ev, head: n.head,
          visit: v, note: n, b: n.b, staff: n.staff, arp: false,
          grace: { order: n.grace.order, slash: n.grace.slash, of: mains.length ? mains[0].ev : null }
        });
      });
      if (appoggiatura) {
        mains.forEach(s => { s.q = base + spent; if (s.upQ < s.q + 0.05) s.upQ = s.q + 0.05; });
      } else {
        const cut = first;
        previous.concat(here).forEach(s => {
          if (s.note.part === grp.part && s.note.voice === grp.voice && !extended.has(s) && s.q < cut - 1e-9 && s.upQ > cut + 1e-9 && s.upQ <= base + 1e-6)
            s.upQ = cut;
        });
      }
    });
  }

  /* ------------------------------------------------------------ follow gates */
  /* Every onset of the range, hand-filtered, in the order follow mode asks it: sounding notes, written rests (also in
     one hand while the other holds), and silent gaps with no rest glyph (App followGates). `hands` is 'both', 'right' or
     'left'. opts:
       ties     false  a tied-to note is never asked (the app's rule: every tieStop), as the legacy gates do
                true   exactly the notes the clock strikes: a tie that leads nowhere is asked (FOLLOW_TIE)
       repeats  false  the written range once, in written order
                true   as often as the clock plays it: each stretch of the play order is gated in turn, so a repeated
                       passage is asked each time (FOLLOW_REPEAT); a gate then also names its `visit` and sounding `q` */
  function handOk(n, hands) {
    if (n.hand === 'x') return false;                 /* a cue staff is read, not played */
    return !hands || hands === 'both' || (hands === 'right' ? n.hand === 'r' : n.hand === 'l');
  }
  function followGates(plan, hands, options) {
    const o = options || {};
    const L = plan.layout;
    const runs = [];
    if (o.repeats) {
      plan.visits.forEach((v, k) => {
        const last = runs[runs.length - 1];
        if (last && Math.abs(last.b - v.startQ) < 1e-9 && v.leg === last.leg) { last.b = v.startQ + v.lenQ; last.to = k; }
        else runs.push({ a: v.startQ, b: v.startQ + v.lenQ, from: k, to: k, leg: v.leg });
      });
    } else runs.push({ a: plan.span.a, b: plan.span.b });
    const gates = [];
    runs.forEach(run => {
      gatesOfRun(plan, L, hands, run, !!o.ties).forEach(gate => {
        if (o.repeats) {
          let k = run.from;
          while (k < run.to && !(gate.b < plan.visits[k].startQ + plan.visits[k].lenQ - 1e-9)) k++;
          gate.visit = k;
          gate.q = plan.visits[k].soundQ + (gate.b - plan.visits[k].startQ);
        }
        gates.push(gate);
      });
    });
    return gates;
  }
  function gatesOfRun(plan, L, hands, run, strikeTies) {
    const playAt = {}, restAt = {}, spans = [];
    const tok = t => t.toFixed(5);
    plan.written.forEach(n => {
      if (n.abs < run.a - 1e-9 || n.abs >= run.b - 1e-9) return;
      if (!handOk(n, hands)) return;
      const t0 = n.abs, t1 = n.abs + Math.max(n.dur || 0, 0), k = tok(t0);
      if (n.rest) {
        if (t1 - t0 < 1e-4) return;
        const r = restAt[k] || (restAt[k] = { b: t0, m: n.m, dur: 0 });
        r.dur = Math.max(r.dur, t1 - t0);
        return;
      }
      if (n.midi == null) return;
      spans.push([t0, t1]);
      if (strikeTies ? !struck(plan, n) : n.tieStop) return;
      const p = playAt[k] || (playAt[k] = { b: t0, m: n.m, notes: [], rest: false });
      p.notes.push({ midi: n.midi, hand: n.hand === 'l' ? 'l' : 'r', ev: n.ev, head: n.head });
    });
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    spans.forEach(s => {
      const last = merged[merged.length - 1];
      if (!last || s[0] > last[1] + 1e-6) merged.push([s[0], s[1]]);
      else last[1] = Math.max(last[1], s[1]);
    });
    const addGap = (a, b) => {
      if (b - a < 1e-4) return;
      const k = tok(a);
      if (playAt[k] || restAt[k]) return;
      restAt[k] = { b: a, m: measureAt(L, a), dur: b - a };
    };
    let cover = run.a;
    merged.forEach(s => {
      const a = Math.max(s[0], run.a), b = Math.min(s[1], run.b);
      if (a > cover + 1e-4) addGap(cover, a);
      cover = Math.max(cover, b);
    });
    if (run.b > cover + 1e-4) addGap(cover, run.b);
    const events = [];
    Object.keys(playAt).forEach(k => events.push({ t: playAt[k].b, play: playAt[k] }));
    Object.keys(restAt).forEach(k => {
      if (playAt[k]) return;
      events.push({ t: restAt[k].b, rest: restAt[k] });
    });
    events.sort((a, b) => a.t - b.t);
    return events.map((e, i) => {
      if (e.play) return e.play;
      const nextT = i + 1 < events.length ? events[i + 1].t : run.b;
      const span = nextT - e.rest.b;
      return { b: e.rest.b, m: e.rest.m, notes: [], rest: true, dur: span > 1e-4 ? span : e.rest.dur };
    });
  }

  /* ------------------------------------------------------------------ cache */
  /* One plan per (graph, options), as PianoScore._cache keeps one per (score, range). Only a frozen graph is cached:
     it cannot change under the plan. */
  const CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
  function of(g, options) {
    const o = normalize(options);
    if (!CACHE || !Object.isFrozen(g)) return build(g, options);
    const key = JSON.stringify([o.legacyCompat, o.jumps, o.graces, o.defaultQpm, o.range && [o.range.from, o.range.to]]);
    let bag = CACHE.get(g);
    if (!bag) { bag = new Map(); CACHE.set(g, bag); }
    if (!bag.has(key)) bag.set(key, build(g, options));
    return bag.get(key);
  }

  return Object.freeze({ build: build, of: of, followGates: followGates, struck: struck, holdOf: holdOf, handOk: handOk });
});
