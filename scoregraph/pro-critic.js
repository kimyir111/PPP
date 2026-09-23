/* ============================================================================
   PPP ScoreGraph — G3's critic: what a notation pass may not change
   (docs/GOALS/G03 §15, §16)

   fingerprint(g) cuts a graph into components. Each G3 pass declares which
   components it may change (pass.may); check(before, after, may) compares
   the rest and names every difference, with the measures it is in when it
   has one. The critic never trusts a pass: it looks at the graphs.

     sound      [(part, onset ScorePos, MIDI, tie-merged notated length)] per
                sounding note — I1, I2, I8, I10
     onsets     the same without the length — I1, I2, I10 (never declared)
     place      each sounding note's staff and voice
     rests      per voice, the union of its rest time — I9
     pieces     per voice-measure, its events (kind, at, dur, display)
     tuplets    tuplet spanners as member lists and ratios
     beams      beam spanners as member lists and breaks
     spelling   each sounding note's written name;  acc  its printed accidental
     keys       key signatures — I11;  clefs, ottava
     timeline   measures, lengths, metres, tempos, endings, jumps, bar lines — I3
     play       the play order (time.unroll) — I4
     perf       the performance layer, byte for byte — I5
     marks      slurs, dynamics, wedges, articulations, ornaments, fermatas,
                fingering, lyrics, arpeggios: (kind, onset) — I6
     pedal      pedal marks
     errors     the validator's ERROR codes — I7
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./pitch.js'), require('./time.js'), require('./validate.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proCritic = factory(M.rational, M.pitch, M.time, M.validate); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P, T, V) {
  'use strict';

  const COMPONENTS = ['sound', 'onsets', 'place', 'rests', 'pieces', 'tuplets', 'beams', 'spelling', 'acc', 'keys', 'clefs',
    'ottava', 'timeline', 'play', 'perf', 'marks', 'pedal', 'errors'];
  /* components no pass may ever declare */
  const FIXED = ['onsets', 'timeline', 'play', 'perf', 'marks', 'errors'];

  const F = r => R.format(r);
  const END_ARTS = ['tenuto', 'breath-mark', 'caesura'];

  /* The sounding notes of a part: every head that no tie enters starts one, its length runs through the ties. */
  function soundOf(g, part, starts) {
    const evOfHead = new Map(), tieOut = new Map(), tieIn = new Set();
    part.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e)));
    part.spanners.forEach(s => { if (s.type === 'tie' && s.from !== undefined && s.to !== undefined) { tieOut.set(s.from, s.to); tieIn.add(s.to); } });
    const out = [];
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace) return;
      e.heads.forEach(h => {
        if (tieIn.has(h.id)) return;
        let len = R.parse(e.dur), cur = h.id, guard = 0;
        while (tieOut.has(cur) && guard++ < 10000) { cur = tieOut.get(cur); const x = evOfHead.get(cur); if (!x) break; len = R.add(len, R.parse(x.dur)); }
        out.push({ e: e, h: h, on: R.add(starts.get(e.m), R.parse(e.at)), len: len, midi: P.midi(h.pitch) });
      });
    });
    return out;
  }

  /* Every note event -> the span of the tied note it is a piece of (its first head's tie chain): {s, en} in W. */
  function chains(part, starts) {
    const evOfHead = new Map(), tieOut = new Map(), tieIn = new Map();
    part.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e)));
    part.spanners.forEach(s => { if (s.type === 'tie' && s.from !== undefined && s.to !== undefined) { tieOut.set(s.from, s.to); tieIn.set(s.to, s.from); } });
    const out = new Map();
    const w = e => R.add(starts.get(e.m), R.parse(e.at));
    part.events.forEach(e => {
      if (e.kind !== 'note' || !e.heads || !e.heads.length || e.grace) return;
      let h = e.heads[0].id, first = e, last = e, k = 0;
      while (tieIn.has(h) && k++ < 10000) { h = tieIn.get(h); first = evOfHead.get(h) || first; }
      h = e.heads[0].id; k = 0;
      while (tieOut.has(h) && k++ < 10000) { h = tieOut.get(h); last = evOfHead.get(h) || last; }
      out.set(e.id, { s: w(first), en: R.add(w(last), R.parse(last.dur)) });
    });
    return out;
  }

  /* A fingerprint: component -> {key -> value} where key names what the value belongs to (a measure when it can). */
  function fingerprint(g) {
    const starts = new Map();
    let acc = R.ZERO;
    g.timeline.measures.forEach(m => { starts.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
    const fp = {};
    COMPONENTS.forEach(c => { fp[c] = new Map(); });
    const put = (c, key, val) => { const m = fp[c]; m.set(key, (m.has(key) ? m.get(key) + '\n' : '') + val); };
    g.parts.forEach(part => {
      soundOf(g, part, starts).forEach(n => {
        const k = n.e.m;
        put('sound', k, [part.id, F(n.on), n.midi, F(n.len)].join('|'));
        put('onsets', k, [part.id, F(n.on), n.midi].join('|'));
        put('place', k, [F(n.on), n.midi, n.e.staff, n.e.voice].join('|'));
        put('spelling', k, [F(n.on), n.midi, n.h.pitch.step, n.h.pitch.alter || 0, n.h.pitch.oct].join('|'));
      });
      /* rests per voice as merged intervals */
      const byVoice = new Map();
      part.events.forEach(e => {
        if (e.kind !== 'rest' || e.grace) return;
        const s = R.add(starts.get(e.m), R.parse(e.at));
        if (!byVoice.has(e.voice)) byVoice.set(e.voice, []);
        byVoice.get(e.voice).push([s, R.add(s, R.parse(e.dur)), e.m]);
      });
      byVoice.forEach((list, v) => {
        list.sort((a, b) => R.cmp(a[0], b[0]));
        const merged = [];
        list.forEach(x => { const last = merged[merged.length - 1]; if (last && R.eq(last[1], x[0])) last[1] = x[1]; else merged.push([x[0], x[1], x[2]]); });
        merged.forEach(x => put('rests', x[2], v + '|' + F(x[0]) + '-' + F(x[1])));
      });
      part.events.forEach(e => {
        const k = e.m;
        put('pieces', k, [e.voice, e.kind, e.at, e.dur, JSON.stringify(e.display || {}), e.grace ? 'g' : ''].join('|'));
        (e.heads || []).forEach(h => {
          if (h.acc) put('acc', k, [e.at, h.pitch ? P.midi(h.pitch) : h.inst, JSON.stringify(h.acc)].join('|'));
          (h.fingering || []).forEach(fg => put('marks', k, ['fingering', e.at, h.pitch ? P.midi(h.pitch) : '', JSON.stringify(fg)].join('|')));
        });
        /* an onset mark sits where its note starts; a mark about the note's length or end (tenuto, breath mark,
           caesura, fermata) where it ends, so splitting a note and moving the mark to the last piece keeps it (§12.2) */
        const onW = F(R.add(starts.get(e.m), R.parse(e.at))), endW = F(R.add(R.add(starts.get(e.m), R.parse(e.at)), R.parse(e.dur)));
        (e.arts || []).forEach(a => put('marks', k, ['art', a, END_ARTS.indexOf(a) >= 0 ? 'end ' + endW : onW].join('|')));
        (e.orn || []).forEach(o => put('marks', k, ['orn', JSON.stringify(o), onW].join('|')));
        if (e.fermata) put('marks', k, ['fermata', 'end ' + endW, JSON.stringify(e.fermata)].join('|'));
        (e.lyrics || []).forEach(l => put('marks', k, ['lyric', JSON.stringify(l), F(R.add(starts.get(e.m), R.parse(e.at)))].join('|')));
      });
      const evById = new Map(part.events.map(e => [e.id, e]));
      const evW = id => { const e = evById.get(id); return e ? F(R.add(starts.get(e.m), R.parse(e.at))) : '?'; };
      /* a slur's ends are the sounding notes it joins: where the tied note it starts on begins, where the tied note it
         ends on stops (G03 §12.2: splitting or merging the pieces of a tied note does not move a slur) */
      const chainOf = chains(part, starts);
      const noteStartW = id => { const c = chainOf.get(id); return c ? F(c.s) : evW(id); };
      const noteEndW = id => { const c = chainOf.get(id); return c ? F(c.en) : '?'; };
      const posW = p => (p ? F(R.add(starts.get(p.m), R.parse(p.at))) : '-');
      const mOfEv = id => { const e = evById.get(id); return e ? e.m : 'global'; };
      part.spanners.forEach(s => {
        if (s.type === 'tuplet') put('tuplets', mOfEv(s.events[0]), [s.events.map(evW).join(','), s.events.map(id => (evById.get(id) || {}).voice).join(','), s.actual, s.normal, JSON.stringify(s.unit || null), s.printed === false ? 'hidden' : ''].join('|'));
        else if (s.type === 'beam') put('beams', mOfEv(s.events[0]), [s.events.map(evW).join(','), JSON.stringify((s.breaks || []).map(b => [evW(b.after), b.level]))].join('|'));
        else if (s.type === 'slur') put('marks', 'global', ['slur', s.from !== undefined ? noteStartW(s.from) : '-', s.to !== undefined ? noteEndW(s.to) : '-', s.placement || '', s.line || ''].join('|'));
        else if (s.type === 'wedge') put('marks', s.from.m, ['wedge', s.kind, posW(s.from), posW(s.to)].join('|'));
        else if (s.type === 'pedal') put('pedal', s.from.m, [s.pedal, posW(s.from), posW(s.to), (s.changes || []).map(posW).join(','), JSON.stringify(s.mark || null)].join('|'));
        else if (s.type === 'ottava') put('ottava', s.from.m, [s.staff, s.shift, posW(s.from), posW(s.to)].join('|'));
        else if (s.type === 'arpeggio') put('marks', 'global', ['arpeggio', s.heads.length, s.dir || ''].join('|'));
        else if (s.type === 'gliss') put('marks', 'global', ['gliss', s.slide ? 'slide' : ''].join('|'));
      });
      part.directions.forEach(d => put('marks', d.m, ['dir', d.kind, posW(d), d.value || d.text || d.chordKind || '', d.staff || ''].join('|')));
      part.clefs.forEach(c => put('clefs', c.m, [c.staff, c.at, c.sign, c.line || '', c.octave || 0].join('|')));
    });
    (g.timeline.keys || []).forEach(k => put('keys', k.m, [k.at, k.fifths, k.mode || '', JSON.stringify(k.scope || null)].join('|')));
    const tl = g.timeline;
    put('timeline', 'global', JSON.stringify([tl.measures.map(m => [m.id, m.dur, m.implicit || false, m.barline || null, m.number]), tl.meters, tl.tempos || [], tl.endings || [], tl.jumps || []]));
    let play;
    try { play = JSON.stringify(T.unroll(g).map(v => v.m + '|' + v.k)); } catch (e) { play = 'E:' + (e.code || e.message); }
    put('play', 'global', play);
    /* a graph is canonical (sorted, schema key order), so its JSON is its bytes */
    put('perf', 'global', JSON.stringify(g.performances || []));
    return fp;
  }

  /* The components that differ, each with the keys (measures, or 'global') where they do. */
  function diff(a, b, comps) {
    const out = [];
    (comps || COMPONENTS).forEach(c => {
      if (c === 'errors') return;
      const keys = new Set(Array.from(a[c].keys()).concat(Array.from(b[c].keys())));
      const where = [];
      keys.forEach(k => {
        const x = a[c].get(k), y = b[c].get(k);
        if (x === y) return;
        if (x !== undefined && y !== undefined && x.split('\n').sort().join('\n') === y.split('\n').sort().join('\n')) return;
        where.push(k);
      });
      if (where.length) out.push({ component: c, where: where.sort() });
    });
    return out;
  }

  /* What a pass changed that it may not: [{component, where}] (empty when the pass kept its promise).
     may: the components the pass declares; a length change inside the R-reg budget is checked by the pass itself. */
  function check(before, after, may) {
    const allowed = new Set(may || []);
    FIXED.forEach(c => allowed.delete(c));
    const comps = COMPONENTS.filter(c => !allowed.has(c));
    return diff(before, after, comps);
  }

  /* The notation warnings G3 must never leave behind (§15.3.2). */
  const G3_WARNINGS = ['W-TUPLET-INCOMPLETE', 'W-DISPLAY-DURATION', 'W-BEAM-SHAPE', 'W-TUPLET-DISPLAY'];
  const issueKey = i => i.code + '|' + (i.ids || []).slice().sort().join(',');
  /* ERROR codes of a graph, and the G3 warnings it has that its input did not (by code and IDs): a warning G3 found
     and could not fix stays the input's; one G3 made is a violation. */
  function validation(g, input) {
    const res = V.validate(g);
    const errors = res.issues.filter(i => i.severity === 'ERROR');
    const before = new Set((input ? V.validate(input).issues : []).map(issueKey));
    const bad = res.issues.filter(i => G3_WARNINGS.indexOf(i.code) >= 0 && !before.has(issueKey(i)));
    return { errors: errors, g3warnings: bad, issues: res.issues };
  }

  return Object.freeze({ COMPONENTS, FIXED, G3_WARNINGS, fingerprint, diff, check, validation, soundOf });
});
