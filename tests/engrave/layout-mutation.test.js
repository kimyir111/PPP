/* G4b-G4d-1a: the layout's metrics and checks are not dead (docs/GOALS/G04 §23; the G4b review R2).

   Each mutation edits the SOURCE of engrave/ - a copy in a temporary directory, one anchored edit in one file (the
   layout, or the plan's beam and tuplet rules for the mutations §23 words as plan defects) - the way a real regression
   would, lays out fixed probe graphs with the mutated code at both screen configs, and computes the L2 metrics (l2.js,
   given the graph, so a plan that drops what the graph states is caught against the graph), the determinism check
   (A27) and the static check (A29, a29.js) on what comes out. A mutation must
     1. find each of its anchors exactly once after CRLF is normalised to LF (the copy is written with CRLF line ends,
        as a Windows checkout has them, so this holds on every OS - the G2 MD-TEMPO-LAST-ONLY lesson),
     2. change the output for the probes (else it is dead and proves nothing - the G3 M3 lesson): the EngravedScores
        byte for byte, or for a static mutation (M18: a DOM call has nothing to measure in Node) the A29 findings, and
     3. be caught by the NAMED metric or check it plants a defect for, which is clean on the same probes without it -
        never by the committed layout hash alone.
   The no-op controls N1 (a comment reworded) and N2 (two independent statements swapped) must give byte-identical
   output and a clean check. A mutation may name the probes it is about (`probes`): it is laid out, and must be live and
   caught, on those; the others run every probe. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, SG, graphOf, goldenGraphs } = require('./helpers.js');
const { l2 } = require('./l2.js');
const A29 = require('./a29.js');

const REST_PUSH = "        objs.push(o);\n        restY.set(e.id, y);\n";
const TIE_TOP = '      if (!fh && !th) return;\n      const fe = t.from ? K.headEvent.get(t.from) : null, te = t.to ? K.headEvent.get(t.to) : null;';
const ONE_REST = "        if (e === plan.events.find(x => x.kind === 'rest' && !x.hidden)) objs.push(Object.assign({}, o, ";
const LAYOUT_TOP = '    counters.layout++;\n    const cfg = normalizeConfig(config);';
const MUTATIONS = [
  /* G4b (§33.16.3) */
  { id: 'M6', expect: ['eg.overlap.acc'], what: 'an accidental 0.8 sp into its head',
    edits: [['let x = right - a.w;', 'let x = right - a.w + 0.8;']] },
  { id: 'M7a', expect: ['eg.spacing.monotonic_violations'], what: 'u -> 0 in the placement only: every spring at its rod, the reported u kept',
    edits: [['x += Math.max(u * g.spring.g, g.spring.rod);', 'x += Math.max(0 * g.spring.g, g.spring.rod);']] },
  { id: 'M7b', expect: ['eg.system.fill_err'], what: 'u -> 0 everywhere (the §23 wording: rods only, the reported u 0 too)',
    edits: [['u = sol.u;', 'u = 0;'], ['{ u = uRef; ragged = true; }', '{ u = 0; ragged = true; }']] },
  { id: 'M9', expect: ['eg.system.scaled_avoidable'], what: 'a line break removed: the first two systems laid out as one',
    edits: [['const br = { systems: br0.systems.map(([i, j]) => [lo + i, lo + j]), cost: br0.cost };',
      'const br0s = br0.systems.map(([i, j]) => [lo + i, lo + j]);\n' +
      '    const br = { systems: br0s.length > 1 ? [[br0s[0][0], br0s[1][1]]].concat(br0s.slice(2)) : br0s, cost: br0.cost };']] },
  { id: 'M10', expect: ['eg.clip.count'], what: 'the last system pushed off the page',
    edits: [['const x0 = MARGIN.left + braceSpace;', 'const x0 = MARGIN.left + braceSpace + (last ? 150 : 0);']] },
  { id: 'M11a', expect: ['eg.layout.multiset_diff'], what: 'one rest (the piece\'s first) drawn twice under its own id',
    edits: [[REST_PUSH, REST_PUSH + ONE_REST + '{ box: o.box.slice() }));\n']] },
  { id: 'M11b', expect: ['eg.layout.multiset_diff'], what: 'one rest (the piece\'s first) drawn twice, the copy under a new id',
    edits: [[REST_PUSH, REST_PUSH + ONE_REST + '{ id: e.id + \'#copy\', box: o.box.slice() }));\n']] },
  { id: 'M17', expect: ['eg.layout.nondeterministic'], what: 'insertion order leaks: every third layout reversed, then sorted without the id tie-break',
    edits: [['objects.sort((a, b) => a.system - b.system || (a.box[0] - b.box[0]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));',
      'if (counters.layout % 3 === 0) objects.reverse();\n    objects.sort((a, b) => a.system - b.system || (a.box[0] - b.box[0]));']] },
  { id: 'M18a', static: true, expect: ['dom-measure'], what: 'the layout measures text with getComputedTextLength',
    edits: [[LAYOUT_TOP, LAYOUT_TOP + '\n    const textWidth = el => (el && el.getComputedTextLength ? el.getComputedTextLength() : 0);\n    textWidth(null);']] },
  { id: 'M18b', static: true, expect: ['dom-global', 'global-object'], what: 'the layout reads globalThis.document',
    edits: [[LAYOUT_TOP, LAYOUT_TOP + '\n    const doc = globalThis.document;\n    if (doc && doc.fonts) cfg.fontsLoaded = doc.fonts.status === \'loaded\';']] },
  { id: 'M18c', static: true, expect: ['dom-measure'], what: 'the layout measures a box with getBBox',
    edits: [[LAYOUT_TOP, LAYOUT_TOP + '\n    const bbox = el => (el && el.getBBox ? el.getBBox() : null);\n    bbox(null);']] },
  { id: 'M21', expect: ['eg.layout.head_staff_wrong'], what: 'the layout picks the staff by pitch (octave 4 and up on the upper staff of a two-staff part)',
    edits: [
      ['const heads = e.heads.filter(h => (h.staff || e.staff) === staffId && (h.written || h.pos));',
        'const heads = e.heads.filter(h => {\n' +
        '          const own = staffById.get(h.staff || e.staff), ps = own ? staves.filter(t => t.part === own.part) : [], p = h.written || h.pos;\n' +
        '          return p && (ps.length === 2 ? ps[p.oct >= 4 ? 0 : 1].id : (h.staff || e.staff)) === staffId;\n' +
        '        });'],
      ['const here = evs.filter(e => R.eq(R.parse(e.at), R.parse(col.at)) && (e.staff === s.id || e.heads.some(h => h.staff === s.id)));',
        'const here = evs.filter(e => R.eq(R.parse(e.at), R.parse(col.at)) && (e.staff === s.id ||\n' +
        '            e.heads.some(h => { const o = staffById.get(h.staff || e.staff); return o && o.part === s.part; })));']] },
  /* G4c (§23 M1-M5, M16, M24) */
  { id: 'M1', file: 'plan-beams.js', expect: ['eg.beam.graph_missing'], what: 'the graph\'s beams ignored: none carried, every part derived by the rule',
    edits: [['        out.push(b);\n', '        void b;\n'], ["      if (part.spanners.some(s => s.type === 'beam')) return;\n", '']] },
  { id: 'M2', expect: ['eg.beam.derived_missing'], what: 'derived beams off: the layout draws the graph\'s beams only',
    edits: [['const beams = plan.beams.filter(b => !graceBeam(b)).map(', "const beams = plan.beams.filter(b => !graceBeam(b) && b.source !== 'derived').map("]] },
  { id: 'M3', expect: ['eg.voice.stem_policy_violations'], what: 'the stems of two voices flipped (the up voice down, the down voice up)',
    edits: [["const roled = e => (e.stemFrom === 'voice' && (e.stem === 'up' || e.stem === 'down') ? e.stem : null);",
      "const roled = e => (e.stemFrom === 'voice' && (e.stem === 'up' || e.stem === 'down') ? (e.stem === 'up' ? 'down' : 'up') : null);"]] },
  { id: 'M4', file: 'marks.js', expect: ['eg.tuplet.missing'], what: 'no tuplet number or bracket drawn (G4d-1a: tuplets are placed with the marks)',
    edits: [['      if (!digits.length && !t.bracket) return;\n', '      return;\n']] },
  { id: 'M5', file: 'plan-tuplets.js', expect: ['eg.tuplet.show_errors', 'eg.tuplet.suppressed_rendered'], what: 'show.number \'none\' ignored: every tuplet shows its number',
    edits: [["const number = show.number || 'actual';", "const number = 'actual';"]] },
  { id: 'M16', expect: ['eg.grace.misplaced', 'eg.layout.multiset_diff'], what: 'grace notes laid out as ordinary notes, on the time columns',
    edits: [['const evs = evByM.get(m.id).filter(e => !e.grace);', 'const evs = evByM.get(m.id).filter(e => !e.grace || e.grace.after);'],
      ['      if (!e.grace || e.grace.after || e.hidden || deferred.has(e.id)) return;\n', '      return;\n']] },
  { id: 'M24', file: 'marks.js', expect: ['eg.tuplet.extent_err'], what: 'a tuplet bracket ends at its last note, leaving out a rest that ends the group',
    edits: [['const firstEv = present[0], lastEv = present[present.length - 1];',
      "const firstEv = present[0], lastEv = present.filter(id => mem.some(o => o.event === id && o.kind === 'notehead')).pop() || present[present.length - 1];"]] },
  /* the G4c review (G04 §34.18): its mutations RF, RI, RY, RX, RB, RK that only the layout hash caught, RB2, and the
     fixer's own for R1 (F1, F2) and the merge check (F3) - each caught by a named metric */
  { id: 'RF', expect: ['eg.voice.merge_illegal'], what: 'a unison shares its head across different dot counts (a dotted quarter and a quarter)',
    edits: [['A.dir === B.dir || A.e.voice === B.e.voice || A.e.dots !== B.e.dots ||', 'A.dir === B.dir || A.e.voice === B.e.voice ||']] },
  { id: 'RI', expect: ['eg.stem.middle_line'], what: 'unbeamed up stems of ledger-line notes in one voice stop short of the middle line',
    edits: [["          if (!poly && L.dir === 'up' && end > mid) end = mid;\n", '\n']] },
  { id: 'RY', file: 'notation.js', expect: ['eg.rest.position_err'], what: 'a rest steps half a space (a line rest lands on a space)',
    edits: [['const REST = Object.freeze({ step: 1,', 'const REST = Object.freeze({ step: 0.5,']] },
  { id: 'RX', file: 'notation.js', expect: ['eg.tuplet.hook_dir_err'], what: 'tuplet bracket hooks point away from the notes',
    edits: [['  const TUPLET = Object.freeze({ hook: 0.75,', '  const TUPLET = Object.freeze({ hook: -0.75,']] },
  { id: 'RB', file: 'notation.js', expect: ['eg.beam.hook_side_err'], what: 'beam hooks the other way (the first note\'s left, an inner one right inside its beat)',
    edits: [["      if (i === 0) return 'right';",
      "      if (i === 0) return 'left';\n      if (i > 0) return (members[i - 1].beat === members[i].beat && !members[i - 1].dots) ? 'right' : 'left';"]] },
  { id: 'RB2', file: 'notation.js', expect: ['eg.beam.hook_side_err'], what: 'an inner hook\'s beat rule reversed (right inside the beat of the note before, left outside it)',
    edits: [["      return prev.beat === members[i].beat ? 'left' : 'right';", "      return prev.beat === members[i].beat ? 'right' : 'left';"]] },
  { id: 'RK', expect: ['eg.voice.merge_illegal'], what: 'rests of different lengths merged (a quarter rest and a half rest at one place)',
    edits: [['rests.every(e => !e.restPos && e.dur === rests[0].dur && e.type === rests[0].type &&', 'rests.every(e => !e.restPos &&']] },
  { id: 'F1', expect: ['eg.voice.unison_unshared'], what: 'R1 back: the flag test ignores the shared head, so a unison of flagged notes is not shared',
    edits: [['if (a.flag && b.heads.some((h, j) => j !== sb && overlap(a.flag, h))) return true;', 'if (a.flag && b.heads.some(h => overlap(a.flag, h))) return true;'],
      ['if (b.flag && a.heads.some((h, i) => i !== sa && overlap(b.flag, h))) return true;', 'if (b.flag && a.heads.some(h => overlap(b.flag, h))) return true;']] },
  { id: 'F2', expect: ['eg.voice.offset_err'], what: 'R1 back: a voice beside a flagged note always moves past the flag (a second 1.1 sp apart)',
    edits: [['return s.flag && own.some(h => s.flag[1] < h[3] - SK.EPS && h[1] < s.flag[3] - SK.EPS) ? Math.max(s.right, s.flag[2]) : s.right;',
      'return s.flag ? Math.max(s.right, s.flag[2]) : s.right;']] },
  { id: 'F3', expect: ['eg.voice.merge_illegal'], what: 'a unison whose voice moved for a third voice keeps naming its partner (heads apart, still "merged")',
    edits: [['        if (P && P.dx !== L.dx) { partnerHead.delete(hid); partnerHead.delete(pid); }\n', '        void P;\n']] },
  /* the G4c Lead's re-check: the alteration condition of the unison rule dropped - E12's augmented unison (F against F sharp,
     the F without an accidental) is then one head, and the merge check names it */
  { id: 'RA', expect: ['eg.voice.merge_illegal'], probes: ['E12'], what: 'the unison rule ignores the alteration: F and F sharp share one head',
    edits: [['(!wa || !wb || wa.alter === wb.alter) &&', '']] },
  /* G4d-1a: §23 M8, M12, M14, M15, M23 */
  { id: 'M8', file: 'skyline.js', expect: ['eg.overlap.mark_mark', 'eg.overlap.text'], probes: ['E15', 'E23', 'czerny849_005', 'burg015'],
    what: 'place() ignores the skyline: every mark where it would stand alone (its note\'s edge, the staff\'s)',
    edits: [['    const t = above ? this.top(it.x0, it.x1) : this.bottom(it.x0, it.x1);', '    const t = null;']] },
  { id: 'M12', file: 'marks.js', expect: ['eg.tie.missing'], probes: ['G16'], what: 'a tie PPP inferred inside a bar hidden again (the legacy O4 rule back)',
    edits: [[TIE_TOP, TIE_TOP + '\n      if (t.inferred && fh && th && fh.measure === th.measure) return;']] },
  { id: 'M14', file: 'marks.js', expect: ['eg.tie.missing'], probes: ['E09'], what: 'a tie across a system break dropped (its halves not drawn)',
    edits: [[TIE_TOP, TIE_TOP + '\n      if ((fh && !th && te) || (th && !fh && fe)) return;']] },
  { id: 'M15', file: 'marks.js', expect: ['eg.slur.pair_errors'], probes: ['E10', 'burg015'], what: 'slurs re-paired: each start to the next slur stop on its staff',
    edits: [['    K.slurs.forEach((s, order) => {\n',
      '    const at_ = id => { const e = K.events.get(id); if (!e) return null; const q = String(e.at).split(\'/\'); return K.mIndex.get(e.m) * 1e4 + q[0] / (q[1] || 1); };\n' +
      '    K.slurs.forEach((s0, order) => {\n' +
      '      const f0 = at_(s0.from), e0 = K.events.get(s0.from);\n' +
      '      const next = f0 === null ? null : K.slurs.map(x => x.to).filter(id => at_(id) !== null && at_(id) > f0 && K.events.get(id).staff === e0.staff).sort((a, b) => at_(a) - at_(b))[0];\n' +
      '      const s = Object.assign({}, s0, { to: next || s0.to });\n']] },
  { id: 'M23', file: 'marks.js', expect: ['eg.ledger.drawn_missing', 'eg.mark.missing.articulation'], probes: ['E15', 'burg015'],
    what: 'an articulation (every staccato) skipped with nothing in the ledger saying so',
    edits: [['        if (HORIZONTAL[a]) return;\n', '        if (HORIZONTAL[a]) return;\n        if (a === \'staccato\') return;\n']] },
  /* G4d-1a: one live mutation for each rule it adds */
  { id: 'MT', file: 'marks.js', expect: ['eg.tie.dir_err'], probes: ['E09', 'G16'], what: 'a single note\'s tie on its stem\'s side (§13.1: away from it)',
    edits: [["      const away = P.dirOf.get(evId) === 'up' ? 'below' : 'above';", "      const away = P.dirOf.get(evId) === 'up' ? 'above' : 'below';"]] },
  { id: 'MS', file: 'marks.js', expect: ['eg.slur.endpoint_err'], probes: ['E10', 'E15'], what: 'a slur\'s ends inside what stands at its notes (the pad the wrong way)',
    edits: [['      return [x, above ? y - CV.SLUR.pad : y + CV.SLUR.pad];', '      return [x, above ? y + CV.SLUR.pad : y - CV.SLUR.pad];']] },
  { id: 'MC', file: 'curves.js', expect: ['eg.curve.hits_undiagnosed'], probes: ['burg015', 'czerny849_005', 'E10'], what: 'a slur no longer raised over the notes under it',
    edits: [['          if (n > 1e-9) cons.push([3 * u * u * t, 3 * u * t * t, n]);', '          void n;']] },
  { id: 'MA', file: 'marks.js', expect: ['eg.mark.order_err'], probes: ['E15'], what: 'marks stacked outside in (the fermata, accent, marcato nearest the note)',
    edits: [['.sort((a, b) => a.rank - b.rank || a.i - b.i ||', '.sort((a, b) => b.rank - a.rank || a.i - b.i ||']] },
  { id: 'MO', file: 'marks.js', expect: ['eg.mark.side_err'], probes: ['E15'], what: 'articulations on the stem\'s side of a single voice',
    edits: [["      if (!I.heads.length) return 'above';\n      return I.dir === 'up' ? 'below' : 'above';", "      if (!I.heads.length) return 'above';\n      return I.dir === 'up' ? 'above' : 'below';"]] },
  { id: 'MI', file: 'marks.js', expect: ['eg.mark.on_line'], probes: ['E15'], what: 'a staccato or tenuto inside the staff left on a line (no space)',
    edits: [['snap: inner ? spaceSnap(side, lastLine(I.staffKey)) : null', 'snap: null']] },
  { id: 'MF', file: 'marks.js', expect: ['eg.fingering.side_err'], probes: ['E23', 'czerny849_005'], what: 'fingering below the upper staff and above the lower one',
    edits: [["K.staffRank.get(ho.staffKey) === 1 ? 'below' : 'above';", "K.staffRank.get(ho.staffKey) === 1 ? 'above' : 'below';"]] },
  { id: 'MW', file: 'marks.js', expect: ['eg.text.width_err'], probes: ['E23'], what: 'fingering as wide as something other than the text-metrics table says',
    edits: [['x0: cx - m.w / 2, x1: cx + m.w / 2, h: m.bottom - m.top,', 'x0: cx - m.w / 2, x1: cx + m.w / 2 + 0.3, h: m.bottom - m.top,']] },
  { id: 'MN', file: 'notation.js', expect: ['eg.tuplet.number_far'], probes: ['czerny849_020'], what: 'a tuplet number without a bracket kept outside the staff, away from its beam',
    edits: [['pad: TUPLET.pad * s, limit: null, floor: where.floor });', 'pad: TUPLET.pad * s, limit: where.limit, floor: where.floor });']] },
  { id: 'MR', expect: ['eg.rest.ledger_missing'], probes: ['E13'], what: 'a half rest pushed off the staff left floating, with no ledger line',
    edits: [['        if (Math.abs(ly - Math.round(ly)) > 0.01 || (ly > -0.01 && ly < last + 0.01)) return;', '        return;']] },
  { id: 'MP', expect: ['eg.voice.stem_policy_violations'], probes: ['E27'], what: 'percussion notes stemmed by the rule for pitches, not up (§14.6)',
    edits: [["(percussive(e) ? 'up' : NT.autoDir(homeYs(e), 0))", 'NT.autoDir(homeYs(e), 0)']] },
  { id: 'MK', expect: ['eg.notehead.shape_err'], probes: ['E27'], what: 'the percussion kit\'s notehead ignored (a snare drawn with a round head)',
    edits: [['const shape = (h.notehead && h.notehead.shape) || (h.kit && h.kit.notehead) || null;', 'const shape = (h.notehead && h.notehead.shape) || null;']] },
  { id: 'MH', expect: ['eg.notehead.shape_err'], probes: ['E31'], what: 'a head in parentheses drawn without them',
    edits: [['          if (x.h.notehead && x.h.notehead.paren) {', '          if (false) {']] },
  { id: 'MB', expect: ['eg.accidental.enclosure_err'], probes: ['E32'], what: 'an editorial accidental in parentheses, not brackets',
    edits: [["if (x.h.acc.bracket) { parts.unshift('accidentalBracketLeft'); parts.push('accidentalBracketRight'); }",
      "if (x.h.acc.bracket) { parts.unshift('accidentalParensLeft'); parts.push('accidentalParensRight'); }"]] },
  { id: 'MG', file: 'marks.js', expect: ['eg.gliss.errors'], probes: ['E40'], what: 'a wavy glissando drawn straight',
    edits: [["const wavy = l.line === 'wavy';", 'const wavy = false;']] },
  { id: 'MQ', expect: ['eg.arpeggio.errors'], probes: ['E40'], what: 'an arpeggio\'s arrow at the wrong end',
    edits: [["const top = a.dir === 'up' && staves[0] === staffId, bottom = a.dir === 'down' && staves[staves.length - 1] === staffId;",
      "const top = a.dir === 'down' && staves[0] === staffId, bottom = a.dir === 'up' && staves[staves.length - 1] === staffId;"]] },
  /* the G4d-1a fixer (G04 §35.18): G4-L4 and G4-L5, and each rule the review found held by the layout hash alone (R3) - every
     one caught by the metric that names it */
  { id: 'TH', file: 'marks.js', expect: ['eg.tie.dir_err'], probes: ['E08', 'burg015'], what: 'G4-L4\'s chord halves flipped: the upper half of a chord ties down, the lower half up',
    edits: [["      return k < n / 2 ? 'above' : 'below';", "      return k < n / 2 ? 'below' : 'above';"]] },
  { id: 'TD', file: 'marks.js', expect: ['eg.tie.endpoint_err'], probes: ['E08'], what: 'a displaced head\'s tie meets its neighbour: the end is taken wherever it first falls, nearer the other head of the second',
    edits: [['      const fits = p => { const d = gapTo(p, own); return d <= CV.TIE.reach && others.every(o => gapTo(p, o.box) > d + CV.TIE.lead); };',
      '      const fits = p => !!p;']] },
  { id: 'RV26', file: 'marks.js', expect: ['eg.tie.crossings'], probes: ['E08'], what: 'a tie starts through its own augmentation dot (dots ignored at the start)',
    edits: [["      const dotted = start && I.os.some(o => o.kind === 'dot' && o.staffKey === h.staffKey);", '      const dotted = false;'],
      ["      const kinds = start ? ['notehead', 'dot', 'stem', 'flag'] : ['notehead', 'stem', 'accidental'];", "      const kinds = start ? ['notehead', 'stem', 'flag'] : ['notehead', 'stem', 'accidental'];"]] },
  { id: 'RV25', file: 'marks.js', expect: ['eg.tie.crossings'], probes: ['E08'], what: 'a tie into a chord ends through the chord\'s accidental (accidentals ignored at the end)',
    edits: [["      const kinds = start ? ['notehead', 'dot', 'stem', 'flag'] : ['notehead', 'stem', 'accidental'];", "      const kinds = start ? ['notehead', 'dot', 'stem', 'flag'] : ['notehead', 'stem'];"]] },
  { id: 'RV23', file: 'marks.js', expect: ['eg.slur.missing'], probes: ['E11'], what: 'a slur over three systems or more drawn without its middle parts',
    edits: [["      else if (fs !== undefined && ts !== undefined && fs < si && si < ts) part = 'mid';", '      else void 0;']] },
  { id: 'RV8b', file: 'marks.js', expect: ['eg.gliss.errors'], probes: ['E40'], what: 'a glissando ending at its first note\'s height (the wrong pitch)',
    edits: [['p3 = th ? [leftOf(th) - CV.GLISS.gap, cy(th)] : null;', 'p3 = th ? [leftOf(th) - CV.GLISS.gap, fh ? cy(fh) : cy(th)] : null;']] },
  { id: 'RV9', expect: ['eg.fingering.far'], probes: ['E23'], what: 'fingering\'s width left out of the spacing (a finger wider than its head does not widen its column)',
    edits: [['if (t.trim()) fw = Math.max(fw, TX.measure(t, MK.FINGER.font, MK.FINGER.size).w);', 'if (t.trim()) fw = Math.max(fw, 0);']] },
  { id: 'RV20', file: 'marks.js', expect: ['eg.slur.side_err'], probes: ['E10'], what: 'a slur over stems that all point up drawn above them (§13.2: below)',
    edits: [["      if (dirs.length && dirs.every(d => d === 'up')) return 'below';", "      if (dirs.length && dirs.every(d => d === 'up')) return 'above';"]] },
  { id: 'RV20c', file: 'marks.js', expect: ['eg.slur.side_err'], probes: ['E10'], what: 'a slur\'s side from the voice role inverted (the upper voice\'s slur below)',
    edits: [["      if (role === 'up') return 'above';\n      if (role === 'down') return 'below';\n      const fe = K.events.get(s.from)",
      "      if (role === 'up') return 'below';\n      if (role === 'down') return 'above';\n      const fe = K.events.get(s.from)"]] },
  { id: 'RV19', file: 'marks.js', expect: ['eg.mark.glyph_err'], probes: ['E15'], what: 'a fermata\'s shape ignored (an angled or square one drawn as the normal one)',
    edits: [["it.kind === 'fermata' ? [MT.fermata(it.what.shape, above)]", "it.kind === 'fermata' ? [MT.fermata('normal', above)]"]] },
  { id: 'FS', file: 'marks.js', expect: ['eg.fingering.far'], probes: ['E23', 'czerny849_005'], what: 'G4-L5 undone: fingering placed after the slurs (outside them, away from its notes)',
    edits: [['    here.forEach(id => {\n      const I = infoOf(id), e = I.e;\n      if (!e || !e.heads.some(h => (h.fingering || []).length)) return;',
      '    const fingering = () => here.forEach(id => {\n      const I = infoOf(id), e = I.e;\n      if (!e || !e.heads.some(h => (h.fingering || []).length)) return;'],
      ['  }\n\n  return Object.freeze({ PAD,', '    fingering();\n  }\n\n  return Object.freeze({ PAD,']] },
  { id: 'FP', file: 'skyline.js', expect: ['eg.layout.far_undiagnosed'], probes: ['E23'], what: 'FAR_PLACEMENT suppressed: an item set more than 8 sp from its staff says nothing (§10.5)',
    edits: [['      if (d > far + EPS) o.diag({', '      if (false) o.diag({']] }
];
const CONTROLS = [
  { id: 'N1', what: 'a comment reworded',
    edits: [['/* horizontal gaps, sp (G04 §9.3, §15.4) */', '/* horizontal gaps in staff spaces (G04 §9.3, §15.4) */']] },
  { id: 'N2', what: 'two independent statements swapped (the grace-beam test and the tie starts)',
    edits: [['    const graceBeam = b => b.events.every(id => evById.get(id) && evById.get(id).grace);\n' +
      '    const tieFrom = new Set();\n    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });\n',
      '    const tieFrom = new Set();\n    plan.ties.forEach(t => { if (t.from) tieFrom.add(t.from); });\n' +
      '    const graceBeam = b => b.events.every(id => evById.get(id) && evById.get(id).grace);\n']] }
];
/* a triplet whose last member is a rest, bracketed (no beam holds it): the §23 M24 case */
function tripletEndingInARest() {
  const R = SG.rational;
  const b = SG.builder({ id: 'm24', meta: { title: 'M24' } });
  b.setDefault({ src: b.source({ kind: 'user' }).id });
  const m = b.measure({ number: '1', dur: '1' });
  b.meter({ m: m.id, beats: [4], beatType: 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(part, {});
  const v = b.voice(part, { staff: st.id, label: '1' });
  b.clef(part, { staff: st.id, m: m.id, at: '0', sign: 'G' });
  const ev = [];
  [['C', 5], ['D', 5], null].forEach((p, k) => ev.push(b.event(part, Object.assign({ kind: p ? 'note' : 'rest', m: m.id, at: R.format(R.make(k, 12)), dur: '1/12',
    voice: v.id, staff: st.id, display: { type: 'eighth' } }, p ? { heads: [{ pitch: { step: p[0], alter: 0, oct: p[1] } }] } : {}))));
  b.spanner(part, { type: 'tuplet', events: ev.map(e => e.id), actual: 3, normal: 2 });
  b.event(part, { kind: 'note', m: m.id, at: '1/4', dur: '3/4', voice: v.id, staff: st.id, display: { type: 'half', dots: 1 }, heads: [{ pitch: { step: 'E', alter: 0, oct: 5 } }] });
  return b.finish().graph;
}
/* beam hooks on every side §11.2 gives (RB, RB2): bar 1 beams an eighth, a 16th inside the eighth's beat (left), an
   eighth, a 16th in the next beat (right), an eighth; bar 2 a 16th that starts its beam (right) before a dotted eighth,
   and a 16th that ends its beam after a dotted eighth (left) */
function beamHooks() {
  const R = SG.rational;
  const b = SG.builder({ id: 'hooks', meta: { title: 'Hooks' } });
  b.setDefault({ src: b.source({ kind: 'user' }).id });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(part, {});
  const v = b.voice(part, { staff: st.id, label: '1' });
  const bars = [
    [['1/8', 'eighth', 'C5'], ['1/16', '16th', 'D5'], ['1/8', 'eighth', 'E5'], ['1/16', '16th', 'F5'], ['1/8', 'eighth', 'G5'], ['1/2', 'half', 'A5']],
    [['1/16', '16th', 'C5'], ['3/16', 'eighth', 'D5', 1], ['3/16', 'eighth', 'E5', 1], ['1/16', '16th', 'F5'], ['1/2', 'half', 'G5']]];
  const beams = [[[0, 1, 2, 3, 4]], [[0, 1], [2, 3]]];
  bars.forEach((notes, i) => {
    const m = b.measure({ number: String(i + 1), dur: '1' });
    if (!i) { b.meter({ m: m.id, beats: [4], beatType: 4 }); b.clef(part, { staff: st.id, m: m.id, at: '0', sign: 'G' }); }
    let at = R.ZERO;
    const ev = notes.map(([dur, type, p, dots]) => {
      const e = b.event(part, { kind: 'note', m: m.id, at: R.format(at), dur: dur, voice: v.id, staff: st.id, display: Object.assign({ type: type }, dots ? { dots: dots } : {}),
        heads: [{ pitch: { step: p[0], alter: 0, oct: +p[1] } }] });
      at = R.add(at, R.parse(dur));
      return e;
    });
    beams[i].forEach(idx => b.spanner(part, { type: 'beam', events: idx.map(k => ev[k].id) }));
  });
  return b.finish().graph;
}
/* three voices on a bass staff (F3): an up-stem D4 and a down-stem D4-G3 share the D4, but a third voice's up stem from G2
   runs through the G3, so the down-stem voice moves right - and its D4 is no longer the up voice's */
function sharedThenMoved() {
  const b = SG.builder({ id: 'three', meta: { title: 'Three voices' } });
  b.setDefault({ src: b.source({ kind: 'user' }).id });
  const m = b.measure({ number: '1', dur: '1' });
  b.meter({ m: m.id, beats: [4], beatType: 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(part, {});
  b.clef(part, { staff: st.id, m: m.id, at: '0', sign: 'F' });
  const P = (s, o) => ({ pitch: { step: s, alter: 0, oct: o } });
  [['1', 'up', [P('D', 4)]], ['2', 'down', [P('D', 4), P('G', 3)]], ['3', 'up', [P('G', 2)]]].forEach(([label, stem, heads]) => {
    const v = b.voice(part, { staff: st.id, label: label });
    ['0', '1/2'].forEach(at => b.event(part, { kind: 'note', m: m.id, at: at, dur: '1/2', voice: v.id, staff: st.id, display: { type: 'half', stem: stem },
      heads: heads.map(h => JSON.parse(JSON.stringify(h))) }));
  });
  return b.finish().graph;
}
/* the probes: two voices with rests, an accidental chord, a long grand-staff piece (several systems), two piano pieces
   whose hands cross middle C - Czerny 849/005 dense (its phone systems already at a smaller staff size), Burgmuller
   015 - and for G4c beams with secondary breaks and hooks (E02), tuplets shown as the file says (E04), two voices'
   seconds and unisons (E12), grace notes (E14), the recording shape with derived beams (E38), and the M24 triplet; for
   the G4c fixer ledger-line stems in one voice (E34), beam hooks on every side (beamHooks) and a unison a third voice
   pulls apart (sharedThenMoved) - E12 and E13 hold the unisons of different dots, the flagged unison and second, and the
   rests of different lengths. Every catch below is carried by probes that contain what it plants a defect in. */
const PROBES = {
  E02: 'tests/engrave/fixtures/e/E02-beams-compound-secondary.musicxml',
  E04: 'tests/engrave/fixtures/e/E04-tuplet-show.musicxml',
  E12: 'tests/engrave/fixtures/e/E12-two-voices-heads.musicxml',
  E13: 'tests/engrave/fixtures/e/E13-two-voices-rests.musicxml',
  E14: 'tests/engrave/fixtures/e/E14-grace.musicxml',
  E33: 'tests/engrave/fixtures/e/E33-accidental-chord.musicxml',
  E34: 'tests/engrave/fixtures/e/E34-ledger-lines.musicxml',
  E37: 'tests/engrave/fixtures/e/E37-long.musicxml',
  E38: 'tests/engrave/fixtures/e/E38-recording-shape.musicxml',
  /* G4d-1a: ties over bar lines and system breaks, overlapping slurs, stacked marks, fingering, percussion, noteheads,
     enclosed accidentals, arpeggios and glissandi; PPP's own transcription with ties inside a bar (inferred, G4-U2 A) */
  E09: 'tests/engrave/fixtures/e/E09-tie-barline-system.musicxml',
  E10: 'tests/engrave/fixtures/e/E10-slurs-overlap.musicxml',
  E15: 'tests/engrave/fixtures/e/E15-articulations.musicxml',
  E23: 'tests/engrave/fixtures/e/E23-fingering.musicxml',
  E27: 'tests/engrave/fixtures/e/E27-percussion.musicxml',
  E31: 'tests/engrave/fixtures/e/E31-noteheads.musicxml',
  E32: 'tests/engrave/fixtures/e/E32-accidentals-cautionary.musicxml',
  E40: 'tests/engrave/fixtures/e/E40-arpeggio-gliss.musicxml',
  /* the G4d-1a fixer: chords tied whole (G4-L4: four heads, a second, dotted, into a chord's sharp); a phrase slur over three
     systems or more */
  E08: 'tests/engrave/fixtures/e/E08-tie-partial-chord.musicxml',
  E11: 'tests/engrave/fixtures/e/E11-slur-rest-system.musicxml',
  G16: () => goldenGraphs().find(([k]) => k === 'golden/G16.sg.json')[1],
  czerny849_005: 'catalog/method/czerny849/005.mxl',
  /* G4d-1a: triplets whose beams stand inside the staff - G4c put 12 of their numbers more than 1.5 sp from the beam */
  czerny849_020: 'catalog/method/czerny849/020.mxl',
  burg015: 'catalog/method/burgmuller25/015.mxl',
  m24: tripletEndingInARest,
  hooks: beamHooks,
  three: sharedThenMoved
};
const CONFIGS = [{ breakpoint: 'desktop' }, { breakpoint: 'phone' }];
const FILE = 'layout.js';

let tmp = null;
const load = () => {
  Object.keys(require.cache).forEach(k => { if (k.startsWith(tmp)) delete require.cache[k]; });
  return require(path.join(tmp, 'engrave', 'index.js'));
};
function withEdits(m, fn) {
  const file = path.join(tmp, 'engrave', m.file || FILE);
  const orig = fs.readFileSync(file, 'utf8');
  let text = orig.replace(/\r\n/g, '\n');
  m.edits.forEach(([from, to]) => {
    assert.equal(text.split(from).length - 1, 1, m.id + ': the anchor is found exactly once - ' + from.slice(0, 70));
    text = text.replace(from, () => to);
  });
  fs.writeFileSync(file, text);
  try { return fn(load()); } finally { fs.writeFileSync(file, orig); }
}

/* everything the probes give with one engrave/: the EngravedScores (the output), the L2 metrics summed over probes and
   configs, whether three more layouts of each probe hash the same (A27), and the A29 findings */
/* probes only a mutation that names them lays out (a long piece: the default set stays quick) */
const OPT_IN = new Set(['czerny849_020']);
function run(E, graphs, only) {
  const out = [];
  const m = {};
  let nondet = 0;
  Object.keys(graphs).filter(k => (only ? only.indexOf(k) >= 0 : !OPT_IN.has(k))).forEach(k => {
    const p = E.plan(graphs[k]);
    const P = E.layout.prepare(p);
    const lays = CONFIGS.map(c => E.layout.layout(P, c));
    lays.forEach(eng => {
      out.push(JSON.stringify(eng));
      const x = l2(eng, p, { prepared: P, layout: E.layout, graph: graphs[k] });
      Object.keys(x).forEach(key => { m[key] = (m[key] || 0) + x[key]; });
    });
    /* A27: the same graph three more times - prepared once, afresh, through the engraver's cache */
    const again = [E.layout.layout(P, CONFIGS[0]), E.engrave(E.plan(graphs[k]), CONFIGS[0]), E.layout.createEngraver(E.plan(graphs[k])).layout(CONFIGS[0])];
    again.forEach(eng => out.push(JSON.stringify(eng)));
    if (new Set([lays[0]].concat(again).map(eng => E.layoutHash(eng))).size !== 1) nondet++;
  });
  m['eg.layout.nondeterministic'] = nondet;
  const findings = A29.scanDir(path.join(tmp, 'engrave')).findings;
  return { output: out.join('\n'), metrics: m, findings: findings };
}
const caught = (r, name, file) => (name.indexOf('eg.') === 0 ? r.metrics[name] > 0 : r.findings.some(f => f.rule === name && f.file === (file || FILE)));

test.before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-layout-mut-'));
  ['engrave', 'scoregraph'].forEach(d => fs.cpSync(path.join(REPO, d), path.join(tmp, d), { recursive: true }));
  /* the engrave/ copy as a Windows checkout holds it: CRLF line ends, whatever this checkout has */
  const dir = path.join(tmp, 'engrave');
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
  });
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

test('every layout mutation (G04 §23: M1-M12, M14-M18, M21, M23, M24; the G4c review\'s RB, RB2, RF, RI, RK, RX, RY, the fixer\'s F1-F3 and the Lead\'s RA; G4d-1a\'s own; the G4d-1a fixer\'s TH, TD, FS, FP and the review\'s RV8b, RV9, RV19, RV20, RV20c, RV23, RV25, RV26) is live and caught by the metric or check it names; N1 and N2 change nothing', async (t) => {
  const graphs = {};
  for (const k of Object.keys(PROBES)) {
    graphs[k] = typeof PROBES[k] === 'function' ? PROBES[k]() : await graphOf(PROBES[k]);
    assert.ok(graphs[k], k + ' opens');
  }
  assert.match(fs.readFileSync(path.join(tmp, 'engrave', FILE), 'utf8'), /\r\n/, 'the copy has CRLF line ends');
  const base = run(load(), graphs);
  /* the base of a mutation that names its probes: those probes alone */
  const bases = new Map();
  const baseOf = m => { if (!m.probes) return base; const k = m.probes.join(); if (!bases.has(k)) bases.set(k, run(load(), graphs, m.probes)); return bases.get(k); };
  /* every name a mutation expects is clean without it, on the same probes */
  MUTATIONS.forEach(m => m.expect.forEach(name => assert.ok(!caught(baseOf(m), name, m.file), m.id + ': ' + name + ' is clean on the real code')));
  assert.deepEqual(base.findings, []);
  const report = [];
  MUTATIONS.forEach(m => withEdits(m, E => {
    const r = run(E, graphs, m.probes);
    const base = baseOf(m);
    if (m.static) assert.notDeepEqual(r.findings, base.findings, m.id + ' (' + m.what + '): the A29 findings changed - the mutation is live');
    else assert.notEqual(r.output, base.output, m.id + ' (' + m.what + '): the EngravedScores changed - the mutation is live');
    m.expect.forEach(name => assert.ok(caught(r, name, m.file), m.id + ' (' + m.what + '): caught by ' + name + ' - ' +
      JSON.stringify(m.static ? r.findings : Object.fromEntries(Object.entries(r.metrics).filter(([k, v]) => v !== base.metrics[k])))));
    const also = Object.keys(r.metrics).filter(k => r.metrics[k] !== base.metrics[k] && m.expect.indexOf(k) < 0).sort();
    report.push(m.id + ' ' + m.expect.map(name => name + (name.indexOf('eg.') === 0 ? '=' + r.metrics[name] : '')).join(',') + (also.length ? ' (also ' + also.join(',') + ')' : ''));
  }));
  CONTROLS.forEach(c => withEdits(c, E => {
    const r = run(E, graphs);
    assert.equal(r.output, base.output, c.id + ' (' + c.what + '): byte-identical output');
    assert.deepEqual(r.metrics, base.metrics, c.id + ': the same metrics');
    assert.deepEqual(r.findings, [], c.id + ': a clean static check');
    report.push(c.id + ' byte-identical');
  }));
  assert.equal(report.length, MUTATIONS.length + CONTROLS.length);
  t.diagnostic(report.join('; '));
  /* an anchor that is not there, or not only once, fails its mutation: none dies silently */
  assert.throws(() => withEdits({ id: 'X1', edits: [['this anchor is nowhere in the layout', '']] }, () => null), /X1: the anchor is found exactly once/);
  assert.throws(() => withEdits({ id: 'X2', edits: [['const ', 'let ']] }, () => null), /X2: the anchor is found exactly once/);
  /* the copy is back to what it was */
  assert.deepEqual(run(load(), graphs).output, base.output);
});

