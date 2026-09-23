/* ============================================================================
   PPP ScoreGraph — MusicXML export (docs/GOALS/G01 Appendix A, §14.3)

   exportMusicXml(graph, opts) -> {ok: true, xml} or {ok: false, code, message}
     opts: {software}

   Writes only what the graph holds: no <type> for an event without display,
   no accidental a head does not print, no beam the graph has no Beam for
   (§14.3). Pitches are written (concert -> written through the part's
   transposition); an ottava moves only the display. Element order follows the
   MusicXML schema; divisions are the smallest that express every duration and
   position of the part.

   Placement (deterministic): per part and measure — print, left bar line,
   measure-start attributes, the voices in part order (a <backup> to the
   measure start between them, <forward> across gaps), right bar line.
   Directions, mid-measure clefs and keys and bare sounds go into the first
   voice of their staff at their own position: before the event that starts
   there, or before the event they fall inside with an <offset> (attributes and
   bare sounds, which cannot take an offset, step back with <backup> and
   <forward>).

   Percussion (G02 §17): a perc head writes <unpitched> at the kit item's staff
   position and an <instrument> pointing at the <score-instrument> the part list
   wrote for that kit piece.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./pitch.js'), require('./time.js'),
      require('./xml.js'), require('./validate.js'));
  else {
    const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {};
    M.musicxmlExport = factory(M.rational, M.schema, M.pitch, M.time, M.xml, M.validate);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, P, T, X, V) {
  'use strict';

  const CODES = Object.freeze(['EXPORT-INVALID']);
  const ART_TAG = { staccato: 'staccato', staccatissimo: 'staccatissimo', tenuto: 'tenuto', accent: 'accent',
    marcato: 'strong-accent', spiccato: 'spiccato', stress: 'stress', unstress: 'unstress',
    'detached-legato': 'detached-legato', 'breath-mark': 'breath-mark', caesura: 'caesura' };
  const ORN_TAG = { trill: 'trill-mark', mordent: 'mordent', 'inverted-mordent': 'inverted-mordent', turn: 'turn',
    'inverted-turn': 'inverted-turn', tremolo: 'tremolo', shake: 'shake', schleifer: 'schleifer' };
  const BEAM_LEVELS = { 'eighth': 1, '16th': 2, '32nd': 3, '64th': 4, '128th': 5, '256th': 6, '512th': 7, '1024th': 8 };
  const OTTAVA_SIZE = { 1: 8, 2: 15, 3: 22 };
  const esc = X.esc, attr = X.attr;
  const lcm = (a, b) => a / R.gcd(a, b) * b;
  /* <fermata>: on a note's notations, or on a bar line (G02 §18 S4) */
  const fermataXml = f => '<fermata type="' + (f.inverted ? 'inverted' : 'upright') + '">' + (f.shape || '') + '</fermata>';
  /* MusicXML pairs a glissando by number; one at a time needs only number 1 */
  function add(map, id, xml) { if (!map.has(id)) map.set(id, []); map.get(id).push(xml); }
  function nextGlissNumber(map, s) {
    for (let n = 1; n <= 6; n++) {
      const used = (map.get(s.from) || []).concat(map.get(s.to) || []).some(x => x.indexOf('number="' + n + '"') >= 0);
      if (!used) return n;
    }
    return 1;
  }

  function exportMusicXml(g, opts) {
    opts = opts || {};
    const check = V.validate(g);
    if (!check.ok) return { ok: false, code: 'EXPORT-INVALID', message: 'the graph has errors: ' + check.issues.filter(i => i.severity === 'ERROR').slice(0, 3).map(i => i.code + ' ' + i.message).join('; ') };
    return { ok: true, xml: write(g, opts) };
  }

  function write(g, opts) {
    const out = [];
    const tl = g.timeline;
    const measures = tl.measures;
    const mIndex = new Map(measures.map((m, i) => [m.id, i]));
    const Q = x => R.parse(x);
    const meta = g.meta || {};

    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<score-partwise version="4.0">');
    if (meta.title !== undefined || meta.workNumber !== undefined) {
      out.push('<work>' + (meta.workNumber !== undefined ? '<work-number>' + esc(meta.workNumber) + '</work-number>' : '') +
        (meta.title !== undefined ? '<work-title>' + esc(meta.title) + '</work-title>' : '') + '</work>');
    }
    if (meta.movementNumber !== undefined) out.push('<movement-number>' + esc(meta.movementNumber) + '</movement-number>');
    if (meta.movementTitle !== undefined) out.push('<movement-title>' + esc(meta.movementTitle) + '</movement-title>');
    const ident = [];
    ['composer', 'lyricist', 'arranger'].forEach(t => { if (meta[t] !== undefined) ident.push('<creator type="' + t + '">' + esc(meta[t]) + '</creator>'); });
    if (meta.copyright !== undefined) ident.push('<rights>' + esc(meta.copyright) + '</rights>');
    if (opts.software) ident.push('<encoding><software>' + esc(opts.software) + '</software></encoding>');
    if (ident.length) out.push('<identification>' + ident.join('') + '</identification>');
    out.push('<part-list>');
    g.parts.forEach((p, pi) => {
      const pid = 'P' + (pi + 1);
      let x = '<score-part id="' + pid + '"><part-name>' + esc(p.name || '') + '</part-name>';
      if (p.abbr !== undefined) x += '<part-abbreviation>' + esc(p.abbr) + '</part-abbreviation>';
      const inst = p.instrument;
      const kit = inst.kit && inst.kit.items ? inst.kit.items : null;
      if (kit) {
        /* one <score-instrument> per kit piece, in kit order, so a percussion note can name what it hits */
        kit.forEach((it, i) => {
          x += '<score-instrument id="' + pid + '-I' + (i + 1) + '"><instrument-name>' +
            esc(it.name !== undefined ? it.name : it.key) + '</instrument-name></score-instrument>';
        });
        kit.forEach((it, i) => {
          const ch = inst.midi && inst.midi.channel !== undefined ? inst.midi.channel : 10;
          x += '<midi-instrument id="' + pid + '-I' + (i + 1) + '"><midi-channel>' + ch + '</midi-channel>' +
            (it.gm !== undefined ? '<midi-unpitched>' + it.gm + '</midi-unpitched>' : '') + '</midi-instrument>';
        });
      } else {
        if (inst.name !== undefined) x += '<score-instrument id="' + pid + '-I1"><instrument-name>' + esc(inst.name) + '</instrument-name></score-instrument>';
        if (inst.midi && (inst.midi.channel !== undefined || inst.midi.program !== undefined)) {
          x += '<midi-instrument id="' + pid + '-I1">' + (inst.midi.channel !== undefined ? '<midi-channel>' + inst.midi.channel + '</midi-channel>' : '') +
            (inst.midi.program !== undefined ? '<midi-program>' + inst.midi.program + '</midi-program>' : '') + '</midi-instrument>';
        }
      }
      out.push(x + '</score-part>');
    });
    out.push('</part-list>');

    /* timeline lookups shared by every part */
    const metersAt = new Map(tl.meters.map(mt => [mt.m, mt]));
    const endingsFrom = new Map(), endingsTo = new Map();
    (tl.endings || []).forEach(en => {
      if (!endingsFrom.has(en.from)) endingsFrom.set(en.from, []);
      endingsFrom.get(en.from).push(en);
      if (!endingsTo.has(en.to)) endingsTo.set(en.to, []);
      endingsTo.get(en.to).push(en);
    });

    g.parts.forEach((part, pi) => writePart(part, pi));
    out.push('</score-partwise>');
    return out.join('\n') + '\n';

    function writePart(part, pi) {
      const tr = part.instrument.transpose;
      /* which <score-instrument> each kit piece became, in the order the part list wrote them */
      const kitItems = (part.instrument.kit && part.instrument.kit.items) || [];
      const kitIndex = new Map(kitItems.map((it, i) => [it.key, i]));
      const staffNo = new Map(part.staves.map((s, i) => [s.id, i + 1]));
      const multiStaff = part.staves.length > 1;
      const voiceLabel = new Map(part.voices.map((v, i) => [v.id, v.label !== undefined ? v.label : String(i + 1)]));
      const voiceHome = new Map(part.voices.map(v => [v.id, v.staff]));
      const voiceOrder = new Map(part.voices.map((v, i) => [v.id, i]));

      /* divisions: the smallest number of divisions per quarter that makes every value an integer */
      let div = 1;
      const need = w => { const q = R.mul(w, R.make(4)); div = lcm(div, q.d); };
      measures.forEach(m => need(Q(m.dur)));
      part.events.forEach(e => { need(Q(e.at)); need(Q(e.dur)); });
      part.directions.forEach(d => need(Q(d.at)));
      part.clefs.forEach(c => need(Q(c.at)));
      (tl.keys || []).forEach(k => need(Q(k.at)));
      (tl.tempos || []).forEach(t => need(Q(t.at)));
      (tl.jumps || []).forEach(j => need(Q(j.at)));
      part.spanners.forEach(s => {
        ['from', 'to'].forEach(k => { if (s[k] && typeof s[k] === 'object') need(Q(s[k].at)); });
        (s.changes || []).forEach(c => need(Q(c.at)));
      });
      const D = w => { const q = R.mul(R.mul(w, R.make(4)), R.make(div)); return String(q.n / q.d); };

      /* per-head and per-event lookups */
      const headOut = new Map(), headIn = new Map();
      const tuplets = part.spanners.filter(s => s.type === 'tuplet');
      const tupById = new Map(tuplets.map(t => [t.id, t]));
      const tupletsOf = new Map();
      const beamOf = new Map();
      const arpOf = new Map();
      const slurStarts = new Map(), slurStops = new Map();
      part.spanners.forEach(s => {
        if (s.type === 'tie') { if (s.from) headOut.set(s.from, s); if (s.to) headIn.set(s.to, s); }
        if (s.type === 'tuplet') s.events.forEach(id => { if (!tupletsOf.has(id)) tupletsOf.set(id, []); tupletsOf.get(id).push(s); });
        if (s.type === 'beam') s.events.forEach((id, i) => beamOf.set(id, { s: s, i: i }));
        if (s.type === 'arpeggio') s.heads.forEach(h => arpOf.set(h, s));
      });
      /* slurs, wedges and octave shifts are numbered after the part is written (numberMarks) */
      const evById = new Map(part.events.map(e => [e.id, e]));
      /* glissando and slide: both ends are heads, and the start carries how it is drawn (G02 §18 S5) */
      const glissOn = new Map();
      part.spanners.filter(s => s.type === 'gliss').forEach(s => {
        const tag = s.slide ? 'slide' : 'glissando';
        const num = nextGlissNumber(glissOn, s);
        add(glissOn, s.from, '<' + tag + ' type="start" number="' + num + '"' +
          (s.line ? ' line-type="' + s.line + '"' : '') + (s.placement ? ' placement="' + s.placement + '"' : '') + '>' +
          (s.text !== undefined ? esc(s.text) : '') + '</' + tag + '>');
        add(glissOn, s.to, '<' + tag + ' type="stop" number="' + num + '"/>');
      });
      part.spanners.filter(s => s.type === 'slur').forEach(s => {
        if (s.from) { if (!slurStarts.has(s.from)) slurStarts.set(s.from, []); slurStarts.get(s.from).push(s); }
        if (s.to) { if (!slurStops.has(s.to)) slurStops.set(s.to, []); slurStops.get(s.to).push(s); }
      });
      /* tuplet bracket numbers: nesting depth */
      const depth = t => { let d = 1, p = t.parent ? tupById.get(t.parent) : null; while (p) { d++; p = p.parent ? tupById.get(p.parent) : null; } return d; };
      const innermost = list => list.find(t => !list.some(u => u !== t && u.parent === t.id)) || list[0];
      const chain = e => {
        const list = tupletsOf.get(e.id);
        if (!list) return null;
        let t = innermost(list), a = 1, n = 1;
        const inner = t;
        while (t) { a *= t.actual; n *= t.normal; t = t.parent ? tupById.get(t.parent) : null; }
        return { actual: a, normal: n, inner: inner };
      };
      const notationDynamics = new Map();
      part.directions.forEach(d => { if (d.event) { if (!notationDynamics.has(d.event)) notationDynamics.set(d.event, []); notationDynamics.get(d.event).push(d); } });

      /* position-anchored marks per measure: directions, tempos, jumps, clef/key changes, spanner ends */
      const marks = new Map();
      const addMark = (m, at, cat, order, staff, voice, xml, kind) => {
        if (!marks.has(m)) marks.set(m, []);
        marks.get(m).push({ at: Q(at), cat: cat, order: order, staff: staff, voice: voice, xml: xml, kind: kind || 'direction' });
      };
      part.clefs.forEach(c => {
        if (Q(c.at).n === 0) return;
        addMark(c.m, c.at, 0, S.idNumber(c.id), c.staff, null, '<attributes>' + clefXml(c) + '</attributes>', 'attributes');
      });
      (tl.keys || []).forEach(k => {
        if (Q(k.at).n === 0) return;
        if (k.scope && k.scope.part !== part.id) return;
        addMark(k.m, k.at, 0, S.idNumber(k.id), k.scope && k.scope.staff ? k.scope.staff : null, null, '<attributes>' + keyXml(k) + '</attributes>', 'attributes');
      });
      /* spanner ends before starts at one position (a pedal released and pressed again reads stop, start) */
      const lastStaff = part.staves[part.staves.length - 1].id;
      part.spanners.forEach(s => {
        if (s.type === 'wedge') {
          const pl = s.placement ? ' placement="' + s.placement + '"' : '';
          addMark(s.from.m, s.from.at, 6, S.idNumber(s.id), s.staff || null, null, dirXml(pl, '<wedge type="' + s.kind + '" number="' + num('wedge', s, 'start') + '"' + (s.niente ? ' niente="yes"' : '') + '/>'));
          addMark(s.to.m, s.to.at, 1, S.idNumber(s.id), s.staff || null, null, dirXml(pl, '<wedge type="stop" number="' + num('wedge', s, 'stop') + '"/>'));
        } else if (s.type === 'pedal') {
          const line = s.mark && s.mark.line !== undefined ? ' line="' + (s.mark.line ? 'yes' : 'no') + '"' : '';
          const sign = s.mark && s.mark.sign === false ? ' sign="no"' : '';
          const ped = t => (s.soundOnly
            ? '<sound damper-pedal="' + (t === 'stop' ? 'no' : 'yes') + '"/>'
            : dirXml(' placement="below"', '<pedal type="' + t + '"' + line + sign + '/>'));
          const kind = s.soundOnly ? 'sound' : 'direction';
          addMark(s.from.m, s.from.at, 6, S.idNumber(s.id), lastStaff, null, ped('start'), kind);
          (s.changes || []).forEach(c => addMark(c.m, c.at, 2, S.idNumber(s.id), lastStaff, null, ped('change'), kind));
          if (s.to) addMark(s.to.m, s.to.at, 1, S.idNumber(s.id), lastStaff, null, ped('stop'), kind);
        } else if (s.type === 'ottava') {
          const size = OTTAVA_SIZE[Math.abs(s.shift)];
          const pl = s.shift > 0 ? ' placement="above"' : ' placement="below"';
          /* a shift the file wrote without a staff is written back without one */
          const oStaff = s.ext && s.ext['musicxml.ottava'] && s.ext['musicxml.ottava'].staff === 'assumed' ? null : s.staff;
          addMark(s.from.m, s.from.at, 6, S.idNumber(s.id), oStaff, null, dirXml(pl, '<octave-shift type="' + (s.shift > 0 ? 'down' : 'up') + '" size="' + size + '" number="' + num('octave', s, 'start') + '"/>'));
          addMark(s.to.m, s.to.at, 1, S.idNumber(s.id), oStaff, null, dirXml(pl, '<octave-shift type="stop" size="' + size + '" number="' + num('octave', s, 'stop') + '"/>'));
        }
      });
      (tl.tempos || []).forEach(t => {
        const display = t.display || [{ part: g.parts[0].id }];
        display.filter(d => d.part === part.id).forEach(d => {
          const qpm = t.qpm !== undefined ? ' tempo="' + decimal(Q(t.qpm)) + '"' : '';
          const types = [];
          if (t.mark && t.mark.text !== undefined) types.push('<words>' + esc(t.mark.text) + '</words>');
          if (t.mark && t.mark.unit !== undefined && t.mark.perMinute !== undefined) {
            types.push('<metronome' + (t.mark.parens ? ' parentheses="yes"' : '') + '><beat-unit>' + t.mark.unit + '</beat-unit>' +
              '<beat-unit-dot/>'.repeat(t.mark.dots || 0) + '<per-minute>' + decimal(Q(t.mark.perMinute)) + '</per-minute></metronome>');
          }
          if (!types.length) { if (qpm) addMark(t.m, t.at, 3, S.idNumber(t.id), d.staff || null, null, '<sound' + qpm + '/>', 'sound'); return; }
          const pl = d.placement ? ' placement="' + d.placement + '"' : '';
          addMark(t.m, t.at, 3, S.idNumber(t.id), d.staff || null, null,
            { pl: pl, types: types, sound: qpm ? '<sound' + qpm + '/>' : '' }, 'direction');
        });
      });
      (tl.jumps || []).forEach(j => {
        const display = j.display || [{ part: g.parts[0].id }];
        display.filter(d => d.part === part.id).forEach(d => {
          const pl = d.placement ? ' placement="' + d.placement + '"' : '';
          if (j.kind === 'segno' || j.kind === 'coda') { addMark(j.m, j.at, 4, S.idNumber(j.id), d.staff || null, null, { pl: pl, types: ['<' + j.kind + '/>'], sound: '' }); return; }
          const value = j.kind === 'dalsegno' ? 'segno' : j.kind === 'tocoda' ? 'coda' : 'yes';
          const snd = '<sound ' + j.kind + '="' + value + '"/>';
          if (j.text === undefined) { addMark(j.m, j.at, 4, S.idNumber(j.id), d.staff || null, null, snd, 'sound'); return; }
          addMark(j.m, j.at, 4, S.idNumber(j.id), d.staff || null, null, { pl: pl, types: ['<words>' + esc(j.text) + '</words>'], sound: snd });
        });
      });
      /* the <sound> attributes the graph does not model, back where the file had them (G02 §6.2) */
      if (pi === 0) measures.forEach(m => {
        const list = m.ext && m.ext['musicxml.sound'];
        if (!list) return;
        list.forEach((one, i) => {
          const attrs = Object.keys(one.attrs).sort().map(k => ' ' + k + '="' + esc(String(one.attrs[k])) + '"').join('');
          addMark(m.id, one.at, 3, 900000 + i, null, null, '<sound' + attrs + '/>', 'sound');
        });
      });
      part.directions.forEach(d => {
        if (d.event) return;
        const pl = d.placement ? ' placement="' + d.placement + '"' : '';
        if (d.kind === 'chord') { addMark(d.m, d.at, 5, S.idNumber(d.id), d.staff || null, d.voice || null, harmonyXml(d, pl), 'harmony'); return; }
        let type;
        if (d.kind === 'dynamic') type = '<dynamics>' + dynXml(d) + '</dynamics>';
        else if (d.kind === 'words') type = '<words>' + esc(d.text) + '</words>';
        else type = '<rehearsal>' + esc(d.text) + '</rehearsal>';
        addMark(d.m, d.at, 5, S.idNumber(d.id), d.staff || null, d.voice || null, { pl: pl, types: [type], sound: '' });
      });

      /* Group by measure once. Scanning every event, clef and key for each measure made writing a part
         O(measures x events): invisible at the corpus maximum of 1,776 heads, eight seconds at 72,000
         (G02 §15.2, A30). The order within each group is the graph's, so the bytes do not move. */
      const evsByMeasure = new Map();
      part.events.forEach(e => {
        let list = evsByMeasure.get(e.m);
        if (!list) { list = []; evsByMeasure.set(e.m, list); }
        list.push(e);
      });
      const clefsByMeasure = new Map();
      part.clefs.forEach(c => {
        if (Q(c.at).n !== 0) return;                    /* a clef inside the measure is a mark, not an attribute */
        let list = clefsByMeasure.get(c.m);
        if (!list) { list = []; clefsByMeasure.set(c.m, list); }
        list.push(c);
      });
      clefsByMeasure.forEach(list => list.sort((x, y) => S.idNumber(x.id) - S.idNumber(y.id)));
      const keysByMeasure = new Map();
      (tl.keys || []).forEach(k => {
        if (Q(k.at).n !== 0) return;
        if (k.scope && k.scope.part !== part.id) return;
        let list = keysByMeasure.get(k.m);
        if (!list) { list = []; keysByMeasure.set(k.m, list); }
        list.push(k);
      });

      const partStart = out.length;
      out.push('<part id="P' + (pi + 1) + '">');
      measures.forEach((m, mi) => {
        const mdur = Q(m.dur);
        const head = '<measure number="' + attr(m.number) + '"' + (m.implicit ? ' implicit="yes"' : '') +
          (m.layout && m.layout.width !== undefined ? ' width="' + m.layout.width + '"' : '') + '>';
        out.push(head);
        if (m.layout && (m.layout.newSystem || m.layout.newPage))
          out.push('<print' + (m.layout.newSystem ? ' new-system="yes"' : '') + (m.layout.newPage ? ' new-page="yes"' : '') + '/>');
        /* left bar line */
        const bl = m.barline || {};
        const startEndings = endingsFrom.get(m.id) || [];
        if (bl.left || startEndings.length) {
          const l = bl.left || {};
          out.push('<barline location="left">' + (l.style ? '<bar-style>' + l.style + '</bar-style>' : '') +
            startEndings.map(en => '<ending number="' + en.numbers.join(', ') + '" type="start">' + (en.text !== undefined ? esc(en.text) : '') + '</ending>').join('') +
            (l.repeat ? '<repeat direction="' + l.repeat + '"/>' : '') + (l.fermata ? fermataXml(l.fermata) : '') + '</barline>');
        }
        /* measure-start attributes */
        const at0 = [];
        if (mi === 0) at0.push('<divisions>' + div + '</divisions>');
        (keysByMeasure.get(m.id) || []).forEach(k => at0.push(keyXml(k)));
        const mt = metersAt.get(m.id);
        /* The graph has no way to say "no metre", so the import kept the fact on the measure. Writing it
           back is what makes the round trip a fixed point, and keeps the file's own meaning (G02 §6.3). */
        const noMetre = m.ext && m.ext['musicxml.no-metre'] ? m.ext['musicxml.no-metre'].reason : null;
        if (mt && noMetre === 'senza-misura') at0.push('<time><senza-misura/></time>');
        else if (mt && noMetre === 'absent') void 0;
        else if (mt) at0.push('<time' + (mt.symbol ? ' symbol="' + mt.symbol + '"' : '') + (mt.hidden ? ' print-object="no"' : '') + '>' +
          '<beats>' + mt.beats.join('+') + '</beats><beat-type>' + mt.beatType + '</beat-type></time>');
        if (mi === 0 && multiStaff) at0.push('<staves>' + part.staves.length + '</staves>');
        if (pi === 0 && m.multiRest !== undefined) at0.push('<measure-style><multiple-rest>' + m.multiRest + '</multiple-rest></measure-style>');
        /* in ID order (import gives clefs at one position their document order; the app lists clefs in document order) */
        (clefsByMeasure.get(m.id) || []).forEach(c => at0.push(clefXml(c)));
        if (mi === 0 && tr) at0.push('<transpose>' + (tr.diatonic ? '<diatonic>' + tr.diatonic + '</diatonic>' : '<diatonic>0</diatonic>') +
          '<chromatic>' + tr.chromatic + '</chromatic>' + (tr.octave ? '<octave-change>' + tr.octave + '</octave-change>' : '') + '</transpose>');
        if (at0.length) out.push('<attributes>' + at0.join('') + '</attributes>');

        /* the voices of this measure, in part order */
        const evs = evsByMeasure.get(m.id) || [];
        const byVoice = new Map();
        evs.forEach(e => { if (!byVoice.has(e.voice)) byVoice.set(e.voice, []); byVoice.get(e.voice).push(e); });
        const streams = Array.from(byVoice.keys()).sort((a, b) => voiceOrder.get(a) - voiceOrder.get(b))
          .map(v => ({ voice: v, events: byVoice.get(v), items: [] }));
        /* each mark goes to the first stream of its voice or staff, else the first stream */
        const here = (marks.get(m.id) || []).slice().sort((a, b) => R.cmp(a.at, b.at) || a.cat - b.cat || a.order - b.order);
        if (here.length && !streams.length) streams.push({ voice: null, events: [], items: [] });
        const firstStaff = part.staves[0].id;
        here.forEach(mk => {
          let st = mk.voice ? streams.find(s => s.voice === mk.voice) : null;
          if (!st) st = streams.find(s => s.voice && voiceHome.get(s.voice) === (mk.staff || firstStaff));
          if (!st) st = streams.find(s => s.events.some(e => e.staff === (mk.staff || firstStaff)));
          if (!st) st = streams[0];
          st.items.push(mk);
        });
        let cursor = R.ZERO, reach = R.ZERO;
        streams.forEach((st, si) => {
          if (si > 0 && R.sign(cursor) > 0) { out.push('<backup><duration>' + D(cursor) + '</duration></backup>'); cursor = R.ZERO; }
          const vlabel = st.voice ? voiceLabel.get(st.voice) : null;
          const fwdTail = (staffId) => (vlabel !== null ? '<voice>' + esc(vlabel) + '</voice>' : '') + (multiStaff && staffId ? '<staff>' + staffNo.get(staffId) + '</staff>' : '');
          const homeStaff = st.voice ? voiceHome.get(st.voice) : firstStaff;
          const forward = to => { if (R.gt(to, cursor)) { out.push('<forward><duration>' + D(R.sub(to, cursor)) + '</duration>' + fwdTail(homeStaff) + '</forward>'); cursor = to; } };
          let ii = 0;
          const items = st.items;
          /* marks at or before `pos` that belong before an event starting at `pos` */
          const flushUpTo = (pos, inside) => {
            while (ii < items.length && (R.lt(items[ii].at, pos) || (R.eq(items[ii].at, pos) && !inside))) {
              const mk = items[ii++];
              emitMark(mk);
            }
          };
          const emitMark = (mk) => {
            if (mk.kind === 'attributes' || mk.kind === 'sound') {
              if (R.lt(mk.at, cursor)) {
                const back = R.sub(cursor, mk.at);
                out.push('<backup><duration>' + D(back) + '</duration></backup>');
                out.push(mk.xml);
                out.push('<forward><duration>' + D(back) + '</duration>' + fwdTail(homeStaff) + '</forward>');
              } else { forward(mk.at); out.push(mk.xml); }
              return;
            }
            const off = R.sub(mk.at, cursor);
            const offXml = R.isZero(off) ? '' : '<offset>' + D(off) + '</offset>';
            const staffXml = mk.staff ? '<staff>' + staffNo.get(mk.staff) + '</staff>' : '';
            if (mk.kind === 'harmony') { out.push(mk.xml.replace('</harmony>', offXml + staffXml + '</harmony>')); return; }
            if (typeof mk.xml === 'string') { out.push(mk.xml.replace('</direction>', offXml + staffXml + '</direction>')); return; }
            out.push('<direction' + mk.xml.pl + '>' + mk.xml.types.map(t => '<direction-type>' + t + '</direction-type>').join('') +
              offXml + staffXml + mk.xml.sound + '</direction>');
          };
          st.events.forEach(e => {
            const a = Q(e.at);
            if (R.gt(a, cursor)) { flushUpTo(a, false); forward(a); }
            else flushUpTo(a, false);
            /* marks inside this event (between its start and end) are written before it with an offset */
            const end = R.add(a, Q(e.dur));
            while (ii < items.length && R.lt(items[ii].at, end) && R.gt(items[ii].at, a) && items[ii].kind !== 'attributes' && items[ii].kind !== 'sound') emitMark(items[ii++]);
            writeEvent(e, vlabel);
            if (R.sign(Q(e.dur)) > 0) cursor = end;
            /* attributes and bare sounds inside it come after it, stepping back */
            while (ii < items.length && R.lt(items[ii].at, cursor) && (items[ii].kind === 'attributes' || items[ii].kind === 'sound')) emitMark(items[ii++]);
          });
          while (ii < items.length) emitMark(items[ii++]);
          if (R.gt(cursor, reach)) reach = cursor;
          if (si === streams.length - 1 && R.lt(reach, mdur)) { forward(mdur); reach = mdur; }
        });
        if (!streams.length && R.sign(mdur) > 0) out.push('<forward><duration>' + D(mdur) + '</duration></forward>');
        /* right bar line */
        const endEndings = endingsTo.get(m.id) || [];
        if (bl.right || endEndings.length) {
          const r = bl.right || {};
          out.push('<barline location="right">' + (r.style ? '<bar-style>' + r.style + '</bar-style>' : '') +
            endEndings.map(en => '<ending number="' + en.numbers.join(', ') + '" type="' + (en.open ? 'discontinue' : 'stop') + '"/>').join('') +
            (r.repeat ? '<repeat direction="' + r.repeat + '"' + (r.repeat === 'backward' && r.times !== undefined ? ' times="' + r.times + '"' : '') + '/>' : '') +
            (r.fermata ? fermataXml(r.fermata) : '') + '</barline>');
        }
        out.push('</measure>');
      });
      out.push('</part>');
      numberMarks(out, partStart);

      function writeEvent(e, vlabel) {
        const tm = chain(e);
        const dsp = e.display || {};
        const noteAttrs = (e.hidden ? ' print-object="no"' : '') + (dsp.x !== undefined ? ' default-x="' + dsp.x + '"' : '');
        const common = (staffId) => {
          let x = '';
          if (vlabel !== null && vlabel !== undefined) x += '<voice>' + esc(vlabel) + '</voice>';
          if (dsp.type) x += '<type' + (dsp.size ? ' size="' + dsp.size + '"' : '') + '>' + dsp.type + '</type>';
          x += '<dot/>'.repeat(dsp.dots || 0);
          return { pre: x, staff: multiStaff ? '<staff>' + staffNo.get(staffId) + '</staff>' : '' };
        };
        const tmXml = tm ? '<time-modification><actual-notes>' + tm.actual + '</actual-notes><normal-notes>' + tm.normal + '</normal-notes>' +
          (tm.inner.unit ? '<normal-type>' + tm.inner.unit.type + '</normal-type>' + '<normal-dot/>'.repeat(tm.inner.unit.dots || 0) : '') + '</time-modification>' : '';
        const stemXml = dsp.stem ? '<stem>' + dsp.stem + '</stem>' : '';
        const beamXml = beamsOf(e);
        const eventNotations = eventNotationXml(e);
        const lyricXml = (e.lyrics || []).map(l => '<lyric' + (l.verse !== undefined ? ' number="' + l.verse + '"' : '') + '>' +
          (l.syllabic ? '<syllabic>' + l.syllabic + '</syllabic>' : '') + '<text>' + esc(l.text) + '</text>' + (l.extend ? '<extend/>' : '') + '</lyric>').join('');
        const graceXml = e.grace ? '<grace' + (e.grace.slash ? ' slash="yes"' : '') + '/>' : '';
        const durXml = e.grace ? '' : '<duration>' + D(Q(e.dur)) + '</duration>';
        if (e.kind === 'rest') {
          const c = common(e.staff);
          let rest = '<rest' + (dsp.measureRest ? ' measure="yes"' : '');
          rest += dsp.pos ? '><display-step>' + dsp.pos.step + '</display-step><display-octave>' + dsp.pos.oct + '</display-octave></rest>' : '/>';
          out.push('<note' + noteAttrs + '>' + graceXml + rest + durXml + c.pre + tmXml + stemXml + c.staff + beamXml +
            (eventNotations ? '<notations>' + eventNotations + '</notations>' : '') + lyricXml + '</note>');
          return;
        }
        /* the first <note> of a chord carries the event's staff (a reader takes the event's staff from it), so heads
           written on another staff come after the event's own, each group in canonical order */
        const heads = e.heads.filter(h => !h.staff || h.staff === e.staff).concat(e.heads.filter(h => h.staff && h.staff !== e.staff));
        heads.forEach((h, hi) => {
          const staffId = h.staff || e.staff;
          const c = common(staffId);
          let pitch;
          let instXml = '';
          if (h.inst !== undefined) {
            /* percussion: which kit piece it is, and where it sits. A head may leave the position to the
               kit (§5.7), so the kit item is what says where it goes on the staff (G02 §17). */
            const ki = kitIndex.get(h.inst);
            const pos = h.pos || (ki !== undefined ? kitItems[ki].pos : null);
            if (!pos) return;                           /* E-PERC-KIT would have caught this already */
            pitch = '<unpitched><display-step>' + pos.step + '</display-step><display-octave>' + pos.oct + '</display-octave></unpitched>';
            if (ki !== undefined) instXml = '<instrument id="P' + (pi + 1) + '-I' + (ki + 1) + '"/>';
          } else {
            const w = P.written(h.pitch, tr);
            /* the graph rounded a quarter tone to a semitone and kept what the file said; give it back */
            const micro = h.ext && h.ext['musicxml.microtone'] ? String(h.ext['musicxml.microtone'].alter) : undefined;
            const alter = micro !== undefined && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(micro) ? micro : w.alter;
            pitch = '<pitch><step>' + w.step + '</step>' + (alter ? '<alter>' + alter + '</alter>' : '') + '<octave>' + w.oct + '</octave></pitch>';
          }
          const tIn = headIn.get(h.id), tOut = headOut.get(h.id);
          const ties = e.cue ? '' : (tIn ? '<tie type="stop"/>' : '') + (tOut ? '<tie type="start"/>' : '');
          const acc = h.acc ? '<accidental' + (h.acc.cautionary ? ' cautionary="yes"' : '') + (h.acc.editorial ? ' editorial="yes"' : '') +
            (h.acc.paren ? ' parentheses="yes"' : '') + (h.acc.bracket ? ' bracket="yes"' : '') + '>' + h.acc.type + '</accidental>' : '';
          const nh = h.notehead ? '<notehead' + (h.notehead.filled !== undefined ? ' filled="' + (h.notehead.filled ? 'yes' : 'no') + '"' : '') +
            (h.notehead.paren ? ' parentheses="yes"' : '') + '>' + (h.notehead.shape || 'normal') + '</notehead>' : '';
          const nots = [];
          if (tIn) nots.push('<tied type="stop"/>');
          if (tOut) nots.push('<tied type="start"/>');
          if (hi === 0 && eventNotations) nots.push(eventNotations);
          const tech = [];
          (h.fingering || []).forEach(f => tech.push('<fingering' + (f.subst ? ' substitution="yes"' : '') + (f.alt ? ' alternate="yes"' : '') +
            (f.placement ? ' placement="' + f.placement + '"' : '') + '>' + esc(f.f) + '</fingering>'));
          if (h.tech && h.tech.string !== undefined) tech.push('<string>' + h.tech.string + '</string>');
          if (h.tech && h.tech.fret !== undefined) tech.push('<fret>' + h.tech.fret + '</fret>');
          if (tech.length) nots.push('<technical>' + tech.join('') + '</technical>');
          (glissOn.get(h.id) || []).forEach(x => nots.push(x));
          const arp = arpOf.get(h.id);
          if (arp) nots.push(arp.non ? '<non-arpeggiate type="' + (h.id === arp.heads[0] ? 'bottom' : 'top') + '"/>' : '<arpeggiate' + (arp.dir ? ' direction="' + arp.dir + '"' : '') + '/>');
          out.push('<note' + noteAttrs + '>' + graceXml + (e.cue ? '<cue/>' : '') + (hi > 0 ? '<chord/>' : '') + pitch + durXml + ties + instXml + c.pre + acc + tmXml + stemXml + nh + c.staff +
            (hi === 0 ? beamXml : '') + (nots.length ? '<notations>' + nots.join('') + '</notations>' : '') + (hi === 0 ? lyricXml : '') + '</note>');
        });
      }
      /* the event's own notations (first head): slurs, tuplet brackets, ornaments, articulations, dynamics, fermata */
      function eventNotationXml(e) {
        const x = [];
        (slurStops.get(e.id) || []).forEach(s => x.push('<slur type="stop" number="' + num('slur', s, 'stop') + '"/>'));
        (slurStarts.get(e.id) || []).forEach(s => x.push('<slur type="start" number="' + num('slur', s, 'start') + '"' +
          (s.placement ? ' placement="' + s.placement + '"' : '') + (s.line ? ' line-type="' + s.line + '"' : '') + '/>'));
        (tupletsOf.get(e.id) || []).filter(t => t.printed !== false).sort((a, b) => depth(a) - depth(b)).forEach(t => {
          const first = t.events[0] === e.id, last = t.events[t.events.length - 1] === e.id;
          const show = t.show || {};
          const attrs = ' number="' + depth(t) + '"';
          if (first) x.push('<tuplet type="start" bracket="' + (show.bracket === false ? 'no' : 'yes') + '"' +
            (show.number ? ' show-number="' + show.number + '"' : '') + (show.placement ? ' placement="' + show.placement + '"' : '') + attrs + '/>');
          if (last) x.push('<tuplet type="stop"' + attrs + '/>');
        });
        if (e.orn && e.orn.length) x.push('<ornaments>' + e.orn.map(o => '<' + ORN_TAG[o.type] + (o.type === 'tremolo' && o.marks !== undefined ? '>' + o.marks + '</tremolo>' : '/>') +
          (o.acc !== undefined ? '<accidental-mark>' + esc(o.acc) + '</accidental-mark>' : '')).join('') + '</ornaments>');
        if (e.arts && e.arts.length) x.push('<articulations>' + e.arts.map(a => '<' + ART_TAG[a] + '/>').join('') + '</articulations>');
        (notationDynamics.get(e.id) || []).forEach(d => x.push('<dynamics' + (d.placement ? ' placement="' + d.placement + '"' : '') + '>' + dynXml(d) + '</dynamics>'));
        if (e.fermata) x.push(fermataXml(e.fermata));
        return x.join('');
      }
      /* beams: level 1 from the Beam's members; deeper levels from each note's value, broken where the Beam says,
         with a hook where a level has no partner: backward at the group's end, forward elsewhere (what every hook
         inside a group of the committed corpus does) */
      function beamsOf(e) {
        const at = beamOf.get(e.id);
        if (!at) return '';
        const s = at.s, i = at.i, n = s.events.length;
        const evs = s.events.map(id => evById.get(id));
        const levels = x => BEAM_LEVELS[(x.display || {}).type] || 1;
        const broken = (j, L) => (s.breaks || []).some(b => b.after === s.events[j] && b.level <= L);
        const x = ['<beam number="1">' + (i === 0 ? 'begin' : i === n - 1 ? 'end' : 'continue') + '</beam>'];
        const most = s.ext && s.ext['musicxml.beam'] && s.ext['musicxml.beam'].levels ? s.ext['musicxml.beam'].levels : Infinity;
        for (let L = 2; L <= Math.min(levels(e), most); L++) {
          const prev = i > 0 && levels(evs[i - 1]) >= L && !broken(i - 1, L);
          const next = i < n - 1 && levels(evs[i + 1]) >= L && !broken(i, L);
          let v;
          if (prev && next) v = 'continue';
          else if (prev) v = 'end';
          else if (next) v = 'begin';
          else if (i === 0) v = 'forward hook';
          else if (i === n - 1) v = 'backward hook';
          else v = 'forward hook';
          x.push('<beam number="' + L + '">' + v + '</beam>');
        }
        return x.join('');
      }
      function clefXml(c) {
        return '<clef' + (multiStaff ? ' number="' + staffNo.get(c.staff) + '"' : '') + '><sign>' + c.sign + '</sign>' +
          (c.line !== undefined ? '<line>' + c.line + '</line>' : (c.sign === 'G' ? '<line>2</line>' : c.sign === 'F' ? '<line>4</line>' : c.sign === 'C' ? '<line>3</line>' : '')) +
          (c.octave ? '<clef-octave-change>' + c.octave + '</clef-octave-change>' : '') + '</clef>';
      }
      function keyXml(k) {
        const staff = k.scope && k.scope.staff ? ' number="' + staffNo.get(k.scope.staff) + '"' : '';
        return '<key' + staff + (k.hidden ? ' print-object="no"' : '') + '><fifths>' + P.writtenFifths(k.fifths, tr) + '</fifths>' +
          (k.mode !== undefined ? '<mode>' + k.mode + '</mode>' : '') + '</key>';
      }
    }

    function dirXml(pl, type) { return '<direction' + pl + '><direction-type>' + type + '</direction-type></direction>'; }
    function dynGlyph(m) { return m.value === 'other' ? '<other-dynamics>' + esc(m.text || '') + '</other-dynamics>' : '<' + m.value + '/>'; }
    /* one <dynamics> element, with every glyph it printed (G02 §14.3) */
    function dynXml(d) {
      const more = d.ext && d.ext['musicxml.dynamics'] ? d.ext['musicxml.dynamics'].more || [] : [];
      return [dynGlyph(d)].concat(more.map(dynGlyph)).join('');
    }
    function harmonyXml(d, pl) {
      return '<harmony' + pl + '><root><root-step>' + d.root.step + '</root-step>' + (d.root.alter ? '<root-alter>' + d.root.alter + '</root-alter>' : '') + '</root>' +
        '<kind' + (d.text !== undefined ? ' text="' + attr(d.text) + '"' : '') + '>' + esc(d.chordKind) + '</kind>' +
        (d.bass ? '<bass><bass-step>' + d.bass.step + '</bass-step>' + (d.bass.alter ? '<bass-alter>' + d.bass.alter + '</bass-alter>' : '') + '</bass>' : '') +
        (d.degrees || []).map(x => '<degree><degree-value>' + x.value + '</degree-value><degree-alter>' + x.alter + '</degree-alter><degree-type>' + x.type + '</degree-type></degree>').join('') +
        '</harmony>';
    }
  }

  /* A placeholder for the number of a slur, wedge or octave shift: numberMarks replaces it. */
  function num(kind, s, role) { return '\u0001' + kind + ':' + s.id + ':' + role + '\u0001'; }
  /* Number the part's slurs, wedges and octave shifts in document order, the order a reader pairs them in:
     each start takes the smallest number of its kind not open at that point, its stop frees it. */
  function numberMarks(lines, from) {
    const open = {}, given = {};
    for (let i = from; i < lines.length; i++) {
      if (lines[i].indexOf('\u0001') < 0) continue;
      lines[i] = lines[i].replace(/\u0001([a-z]+):([a-z0-9]+):(start|stop)\u0001/g, (_, kind, id, role) => {
        const busy = open[kind] = open[kind] || new Set();
        const map = given[kind] = given[kind] || new Map();
        let n = map.get(id);
        if (n === undefined) { n = 1; while (busy.has(n)) n++; }
        if (role === 'start') { busy.add(n); map.set(id, n); }
        else { busy.delete(n); map.delete(id); }
        return String(n);
      });
    }
  }
  /* A rational as a plain decimal (tempo values come from decimals; others get ten places). */
  function decimal(r) {
    let d = r.d, twos = 0, fives = 0;
    while (d % 2 === 0) { d /= 2; twos++; }
    while (d % 5 === 0) { d /= 5; fives++; }
    const places = Math.max(twos, fives);
    if (d !== 1 || places > 12) return (r.n / r.d).toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    if (!places) return String(r.n / r.d);
    const scaled = r.n * Math.pow(10, places) / r.d;
    const s = String(Math.abs(scaled)).padStart(places + 1, '0');
    return (scaled < 0 ? '-' : '') + s.slice(0, -places) + '.' + s.slice(-places);
  }

  return Object.freeze({ exportMusicXml, CODES, decimal });
});
