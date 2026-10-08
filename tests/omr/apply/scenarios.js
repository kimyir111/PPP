/* The scenarios of omr/apply.js (G12-2), each a function of the module under test: it builds a graph, lets the stand-in for PdfLayer.apply change a scratch
   Score, asks the module for the findings (diff) and applies them (apply), and says whether the Score made again from the edited graph is the Score the
   stand-in made (lib.view: place, pitch, printed accidental, arpeggio, hand, chord names, marks, the notes under each 8va bracket, heading) - the property that
   matters, written without a line of omr/apply.js. mutation.test.js runs the same scenarios against copies of the module with one line broken. */
'use strict';
const L = require('./lib.js');
const { SG, clone, graphOf, scoreOf, PDF, runDouble, view, noteAt, notesAt } = L;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FOUR_F = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1">' +
  '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
  '<note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>'.repeat(4) + '</measure></part></score-partwise>';
const rich = () => SG.musicxml.import(L.SC.truthDocRich(0, 3), { scoreId: 'apply-rich', sourceName: 'page.pdf' }).graph;

/* the whole chain on one script: ok when Score(apply(graph, diff(before, after))) shows what `after` shows */
function roundTrip(A, graph, script, extra) {
  const { before, after } = runDouble(graph, script);
  const f = A.diff(before, after);
  const r = A.apply(graph, f);
  const got = scoreOf(r.graph);
  const a = view(got), b = view(after);
  const detail = same(a, b) ? null : { got: a, want: b, skipped: r.skipped, findings: A.count(f) };
  const out = { ok: !detail && !r.skipped.length, detail: detail || (r.skipped.length ? { skipped: r.skipped } : null), r: r, f: f, graph: r.graph };
  if (extra) Object.assign(out, extra(out, { before, after }));
  return out;
}

const S = {};

S.noChange = {
  why: 'a page that tells nothing new gives no findings and the same graph',
  run: A => {
    const g = graphOf();
    const { before, after } = runDouble(g, () => {});
    const f = A.diff(before, after), r = A.apply(g, f);
    return { ok: A.count(f).total === 0 && r.graph === g && r.changed === false && r.appliedTotal === 0, detail: A.count(f) };
  }
};

S.accidental = {
  why: 'an accidental the engine missed: the note gets its pitch and printed accidental, and the later notes of the bar with the same letter follow',
  run: A => {
    /* bar 2: D5 E5 F5 G5 - a sharp on F5; and in bar 1 (C5 D5 E5 F5) a natural-less repeat: F5 in bar 1 stays */
    const g = graphOf();
    const r = roundTrip(A, g, (s, P) => P.accidental(s, noteAt(s, 2, 1, 2), 'sharp'));
    const n = noteAt(scoreOf(r.graph), 2, 1, 2);
    r.ok = r.ok && n.p === 'F#5' && n.acc === 'sharp' && A.count(r.f).pitches === 1;
    return r;
  }
};
S.accidentalCarry = {
  why: 'an accidental holds for the rest of the bar: a later note of the same letter and octave is changed too, without a mark of its own',
  run: A => {
    const g2 = SG.musicxml.import(FOUR_F, { scoreId: 'c' }).graph;
    const r = roundTrip(A, g2, (s, P) => P.accidental(s, noteAt(s, 1, 1, 0), 'sharp'));
    const ps = scoreOf(r.graph).notes.filter(n => !n.rest && (n.staff || 1) === 1).map(n => n.p).join();
    r.ok = r.ok && ps === 'F#5,F#5,F#5,F#5' && A.count(r.f).pitches === 4;
    return r;
  }
};
S.accidentalCourtesy = {
  why: 'a natural sign on a note that is already natural changes no pitch but prints the accidental: the head keeps the printed accidental',
  run: A => {
    const g = graphOf();
    const r = roundTrip(A, g, (s, P) => P.accidental(s, noteAt(s, 2, 1, 2), 'natural'));
    const n = noteAt(scoreOf(r.graph), 2, 1, 2);
    r.ok = r.ok && n.p === 'F5' && n.acc === 'natural' && A.count(r.f).pitches === 1;
    return r;
  }
};
S.phantom = {
  why: 'a note the page has only an arpeggio line for goes, and the notes after it in that voice move back to close the gap',
  run: A => {
    const g = graphOf();
    const r = roundTrip(A, g, (s, P) => P.phantom(s, notesAt(s, 1, 1, 1)));
    const sc = scoreOf(r.graph);
    r.ok = r.ok && sc.notes.filter(n => !n.rest && n.m === 1 && (n.staff || 1) === 1).map(n => n.b + ':' + n.p).join() === '0:C5,1:E5,2:F5'
      && A.count(r.f).drops === 1 && A.count(r.f).moves === 2;
    return r;
  }
};
S.realign = {
  why: 'a voice the engine started late moves back to meet the note it sounds with',
  run: A => {
    /* the rich bar: a second voice that starts with a <forward> of a quarter and holds a half note from 1 to 3; it belongs with the first note of the bar */
    const g = rich();
    const r = roundTrip(A, g, (s, P) => P.realign(s, s.notes.filter(n => !n.rest && n.m === 2 && (n.staff || 1) === 1 && n.voice === 2), 1));
    r.ok = r.ok && A.count(r.f).moves === 1 && A.count(r.f).drops === 0 && scoreOf(r.graph).notes.some(n => !n.rest && n.m === 2 && n.voice === 2 && n.b === 0);
    return r;
  }
};
S.arpSingle = {
  why: 'an arpeggio line over one note is not an arpeggio the graph can hold: named and skipped',
  run: A => {
    const g = graphOf();
    const sc = scoreOf(g);
    const f = A.emptyFindings();
    f.arps.push({ heads: [noteAt(sc, 1, 2, 0).sgHead] });
    const r = A.apply(g, f);
    return { ok: r.graph === g && r.skipped.length === 1 && /two notes/.test(r.skipped[0].why), detail: r.skipped };
  }
};
S.arpeggio = {
  why: 'an arpeggio line before a chord: the chord\'s heads get an arpeggio spanner',
  run: A => {
    const g = rich();
    const r = roundTrip(A, g, (s, P) => P.arpeggio(s, notesAt(s, 1, 1, 0)));
    r.ok = r.ok && g.parts[0].spanners.filter(s => s.type === 'arpeggio').length === 0 && r.graph.parts[0].spanners.filter(s => s.type === 'arpeggio').length === 1;
    return r;
  }
};
S.ottava = {
  why: 'an 8va bracket: the notes under it sound an octave higher and the graph has the bracket, ending where its last note ends',
  run: A => {
    const g = graphOf();
    const r = roundTrip(A, g, (s, P) => P.ottava(s, { m: 2, b: 0, endM: 2, endB: 3.001, size: 8, dir: 1, staff: 1 }, s.notes.filter(n => !n.rest && n.m === 2 && (n.staff || 1) === 1)));
    const sp = r.graph.parts[0].spanners.filter(s => s.type === 'ottava');
    r.ok = r.ok && sp.length === 1 && sp[0].shift === 1 && sp[0].to.at === '1' && scoreOf(r.graph).notes.filter(n => !n.rest && n.m === 2 && (n.staff || 1) === 1).map(n => n.p).join() === 'D6,E6,F6,G6';
    return r;
  }
};
S.ottavaDown = {
  why: 'an 8vb bracket over the left hand across two bars',
  run: A => {
    const g = graphOf();
    const r = roundTrip(A, g, (s, P) => P.ottava(s, { m: 2, b: 2, endM: 3, endB: 2.001, size: 8, dir: -1, staff: 2 },
      s.notes.filter(n => !n.rest && (n.staff || 1) === 2 && ((n.m === 2 && n.b >= 2 - 1e-6) || (n.m === 3 && n.b < 2 + 1e-6)))));
    const sp = r.graph.parts[0].spanners.filter(s => s.type === 'ottava');
    r.ok = r.ok && sp.length === 1 && sp[0].shift === -1;
    return r;
  }
};
S.chords = {
  why: 'the chord names the page printed replace what the engine made of them in the bars the page covers',
  run: A => {
    const g0 = graphOf();
    /* the engine had read an F over bar 1 */
    const g = A.apply(g0, Object.assign(A.emptyFindings(), { chordsIn: [{ m: 1, b: 0, text: 'F' }] })).graph;
    const r = roundTrip(A, g, (s, P) => P.chords(s, [1, 2], [{ m: 1, b: 0, text: 'C' }, { m: 2, b: 2, text: 'G7' }, { m: 2, b: 0, text: 'Am/E' }]));
    const ch = scoreOf(r.graph).chords.map(c => c.m + ':' + c.b + ':' + c.text).sort().join();
    r.ok = r.ok && ch === '1:0:C,2:0:Am/E,2:2:G7';
    return r;
  }
};
S.marks = {
  why: 'segno, coda and jump words: the page\'s replace the bars they cover',
  run: A => {
    const g0 = graphOf();
    const g = A.apply(g0, Object.assign(A.emptyFindings(), { marksIn: [{ m: 3, kind: 'coda', text: null }] })).graph;
    const r = roundTrip(A, g, (s, P) => P.marks(s, [3, 4], [{ m: 2, kind: 'segno', text: null }, { m: 4, kind: 'ds', text: 'D.S. al Coda' }]));
    r.ok = r.ok && g.timeline.jumps.length === 1 && r.graph.timeline.jumps.map(j => j.kind).sort().join() === 'dalsegno,segno';
    return r;
  }
};
S.heading = {
  why: 'the title, composer and tempo the page printed, where the engine had the file name',
  run: A => {
    const g = graphOf();
    const r = roundTrip(A, g, (s, P) => P.heading(s, { title: 'Silent Night', composer: 'F. Gruber', tempo: 72 }));
    const sc = scoreOf(r.graph);
    r.ok = r.ok && sc.title === 'Silent Night' && sc.composer === 'F. Gruber' && sc.tempo === 72 && r.graph.meta.title === 'Silent Night';
    return r;
  }
};
S.everything = {
  why: 'all of it at once on a piece with chords, grace notes and ties: the Score made again from the edited graph is the Score the page\'s lines make',
  run: A => {
    const g = rich();
    const r = roundTrip(A, g, (s, P) => {
      P.accidental(s, noteAt(s, 2, 1, 3), 'flat');   /* (not b=2: that note is tied to the one before, and a tie between two pitches is invalid; apply names such an edit and skips it) */
      P.ottava(s, { m: 3, b: 0, endM: 3, endB: 3.001, size: 8, dir: 1, staff: 1 }, s.notes.filter(n => !n.rest && n.m === 3 && (n.staff || 1) === 1));
      P.chords(s, [1], [{ m: 1, b: 1, text: 'Dm' }]);
      P.marks(s, [2], [{ m: 2, kind: 'fine', text: null }]);
      P.heading(s, { title: 'Everything', tempo: 100 });
    });
    return r;
  }
};

/* idempotence: the same findings applied again change nothing and return the very same graph */
S.idempotent = {
  why: 'applying findings that are already true changes nothing: the same graph comes back and every finding is counted as already made',
  run: A => {
    const g = graphOf();
    const { before, after } = runDouble(g, (s, P) => {
      P.accidental(s, noteAt(s, 2, 1, 2), 'sharp');
      P.phantom(s, notesAt(s, 1, 1, 1));
      P.chords(s, [1], [{ m: 1, b: 0, text: 'C' }]);
      P.marks(s, [2], [{ m: 2, kind: 'segno', text: null }]);
      P.heading(s, { title: 'T', tempo: 90 });
      P.ottava(s, { m: 3, b: 0, endM: 3, endB: 3.001, size: 8, dir: 1, staff: 1 }, s.notes.filter(n => !n.rest && n.m === 3 && (n.staff || 1) === 1));
    });
    const f = A.diff(before, after);
    const one = A.apply(g, f), two = A.apply(one.graph, f);
    const n = A.count(f).total;
    return { ok: one.changed && one.appliedTotal === n && !one.skipped.length && two.graph === one.graph && !two.changed && two.appliedTotal === 0 && two.already === n,
      detail: { n: n, one: [one.appliedTotal, one.already, one.skipped.length], two: [two.appliedTotal, two.already, two.changed] } };
  }
};

/* provenance and immutability */
S.provenance = {
  why: 'every edit carries its source (omr / pdflayer) and op "inferred"; the input graph is not changed; the result is frozen, one revision on',
  run: A => {
    const g = graphOf();
    const fp = SG.fingerprint(g);
    const { before, after } = runDouble(g, (s, P) => {
      P.accidental(s, noteAt(s, 2, 1, 2), 'sharp');
      P.phantom(s, notesAt(s, 1, 1, 1));
    });
    const f = A.diff(before, after);
    const r = A.apply(g, f);
    const src = r.graph.provenance.sources.find(x => x.kind === 'omr' && x.tool === 'pdflayer');
    const head = f.pitches[0].head;
    const p = SG.prov.provOf(r.graph, head, 'pitch');
    const moved = f.moves[0].event;
    const pm = SG.prov.provOf(r.graph, moved, 'rhythm');
    return { ok: SG.fingerprint(g) === fp && Object.isFrozen(r.graph) && r.graph.rev === g.rev + 1 && !!src && p.src === src.id && p.op === 'inferred' && pm.src === src.id && pm.op === 'inferred'
      && g.provenance.sources.every(x => !(x.kind === 'omr' && x.tool === 'pdflayer')),
      detail: { src: src, p: p, pm: pm, rev: [g.rev, r.graph.rev] } };
  }
};

/* an edit the graph would refuse costs only itself */
S.isolation = {
  why: 'an edit that would make the graph invalid is named and skipped, the others are made (the halves of the list are tried)',
  run: A => {
    const g = graphOf();
    const sc = scoreOf(g);
    const target = noteAt(sc, 1, 1, 0), other = noteAt(sc, 1, 1, 1);
    const f = A.emptyFindings();
    f.pitches.push({ head: noteAt(sc, 2, 1, 2).sgHead, event: noteAt(sc, 2, 1, 2).sgEvent, pitch: { step: 'F', alter: 1, oct: 5 }, acc: 'sharp' });
    f.moves.push({ event: target.sgEvent, m: 1, b: 1 });                     /* onto the quarter that is already there: two events at one place in a voice */
    f.pitches.push({ head: noteAt(sc, 3, 1, 1).sgHead, event: noteAt(sc, 3, 1, 1).sgEvent, pitch: { step: 'B', alter: -1, oct: 5 }, acc: 'flat' });
    f.moves.push({ event: other.sgEvent, m: 1, b: 9 });                      /* outside the bar */
    const r = A.apply(g, f);
    const sc2 = scoreOf(r.graph);
    return { ok: r.appliedTotal === 2 && r.skipped.length === 2 && r.skipped.every(s => s.group === 'moves' && s.why) && noteAt(sc2, 2, 1, 2).p === 'F#5' && noteAt(sc2, 3, 1, 1).p === 'Bb5'
      && noteAt(sc2, 1, 1, 0) !== undefined && noteAt(sc2, 1, 1, 1) !== undefined, detail: { applied: r.appliedTotal, skipped: r.skipped } };
  }
};
S.partialChord = {
  why: 'only some heads of a chord are phantoms: the chord stays and the finding is named, never half a chord removed',
  run: A => {
    const g = rich();
    const sc = scoreOf(g);
    const two = notesAt(sc, 1, 1, 0);
    const f = A.emptyFindings();
    f.drops.push({ event: two[0].sgEvent, heads: [two[0].sgHead], of: 2 });
    const r = A.apply(g, f);
    return { ok: r.graph === g && r.skipped.length === 1 && /some heads|changed/.test(r.skipped[0].why), detail: r.skipped };
  }
};
S.staleDrop = {
  why: 'a finding made for an event with two heads is not applied to an event that has one now',
  run: A => {
    const g = graphOf();
    const sc = scoreOf(g);
    const n = noteAt(sc, 1, 1, 1);
    const f = A.emptyFindings();
    f.drops.push({ event: n.sgEvent, heads: [n.sgHead], of: 2 });
    const r = A.apply(g, f);
    return { ok: r.graph === g && r.skipped.length === 1 && /changed/.test(r.skipped[0].why), detail: r.skipped };
  }
};
S.idempotentRich = {
  why: 'applying an arpeggio again adds no second spanner, applying a bracket again adds no second bracket',
  run: A => {
    const g = rich();
    const { before, after } = runDouble(g, (s, P) => {
      P.arpeggio(s, notesAt(s, 1, 1, 0));
      P.ottava(s, { m: 2, b: 0, endM: 2, endB: 3.001, size: 15, dir: 1, staff: 1 }, s.notes.filter(n => !n.rest && n.m === 2 && (n.staff || 1) === 1));
    });
    const f = A.diff(before, after);
    const one = A.apply(g, f), two = A.apply(one.graph, f);
    const sp = x => x.parts[0].spanners.filter(s => s.type === 'arpeggio' || s.type === 'ottava').length;
    return { ok: !one.skipped.length && sp(one.graph) === 2 && two.graph === one.graph && sp(two.graph) === 2 && two.appliedTotal === 0,
      detail: { one: [one.appliedTotal, one.skipped], two: [two.appliedTotal, two.already], f: A.count(f) } };
  }
};

S.missingTargets = {
  why: 'a phantom that is already gone is already done; a note that is not there at all is named',
  run: A => {
    const g = graphOf();
    const f = A.emptyFindings();
    f.drops.push({ event: 'e9999', heads: ['h9999'], of: 1 });
    f.pitches.push({ head: 'h9999', event: 'e9999', pitch: { step: 'C', oct: 4 }, acc: null });
    const r = A.apply(g, f);
    return { ok: r.graph === g && r.already === 1 && r.skipped.length === 1 && r.skipped[0].group === 'pitches', detail: [r.already, r.skipped] };
  }
};

/* beams and tuplets over events only some of which move */
const BEAMED = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1">' +
  '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
  [['C', 'begin'], ['D', 'end'], ['E', 'begin'], ['F', 'end']].map(([s, b]) => '<note><pitch><step>' + s + '</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><beam number="1">' + b + '</beam></note>').join('') +
  '<note><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>' +
  '<note><pitch><step>A</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note></measure></part></score-partwise>';
S.beamsKept = {
  why: 'events that move together keep their beam; a beam over events only some of which move is retired',
  run: A => {
    const g = SG.musicxml.import(BEAMED, { scoreId: 'b' }).graph;
    const beams = x => x.parts[0].spanners.filter(s => s.type === 'beam').length;
    if (beams(g) !== 2) return { ok: false, detail: 'fixture: ' + beams(g) + ' beams' };
    const sc = scoreOf(g);
    const ev = b => noteAt(sc, 1, 1, b).sgEvent, hd = b => noteAt(sc, 1, 1, b).sgHead;
    /* C D | E F | G | A: the G goes (a phantom), the second pair moves up to where it was */
    const drop = { event: ev(2), heads: [hd(2)], of: 1 };
    const both = A.emptyFindings();
    both.drops.push(drop);
    both.moves.push({ event: ev(1), m: 1, b: 2 }, { event: ev(1.5), m: 1, b: 2.5 });
    const a = A.apply(g, both);
    /* only the first of the pair moves: the pair no longer stands together, its beam goes (the first pair's stays) */
    const one = A.emptyFindings();
    one.drops.push(drop);
    one.moves.push({ event: ev(1), m: 1, b: 2 });
    const b = A.apply(g, one);
    return { ok: a.appliedTotal === 3 && !a.skipped.length && beams(a.graph) === 2 && b.appliedTotal === 2 && !b.skipped.length && beams(b.graph) === 1,
      detail: { both: [a.appliedTotal, a.skipped, beams(a.graph)], one: [b.appliedTotal, b.skipped, beams(b.graph)] } };
  }
};

/* a dynamic that belongs to a note moves with it */
const DYN = BEAMED.replace('<note><pitch><step>E</step>', '<note><pitch><step>E</step>').replace(/(<note><pitch><step>E<\/step>.*?<type>eighth<\/type>)/, '$1<notations><dynamics><f/></dynamics></notations>');
S.movedDynamic = {
  why: 'a dynamic mark that belongs to a note moves with it',
  run: A => {
    const g = SG.musicxml.import(DYN, { scoreId: 'd' }).graph;
    const dyn = x => x.parts[0].directions.filter(d => d.kind === 'dynamic');
    if (dyn(g).length !== 1 || !dyn(g)[0].event) return { ok: false, detail: 'fixture: ' + JSON.stringify(dyn(g)) };
    const sc = scoreOf(g);
    const f = A.emptyFindings();
    f.drops.push({ event: noteAt(sc, 1, 1, 2).sgEvent, heads: [noteAt(sc, 1, 1, 2).sgHead], of: 1 });
    f.moves.push({ event: noteAt(sc, 1, 1, 1).sgEvent, m: 1, b: 2 });
    const r = A.apply(g, f);
    const e = r.graph.parts[0].events.find(x => x.id === dyn(g)[0].event);
    return { ok: !r.skipped.length && e.at === '1/2' && dyn(r.graph)[0].at === '1/2' && dyn(g)[0].at === '1/4', detail: { event: e && e.at, dyn: dyn(r.graph)[0] } };
  }
};

/* a finding with a NaN, an Infinity, a null or a missing field is one refused edit: the others are made (the page's lines are never all lost for one bad item) */
S.badItems = {
  why: 'a finding with a NaN, an Infinity, a null or a missing field is one refused edit, named; the good findings beside it are made',
  run: A => {
    const g = graphOf();
    const sc = scoreOf(g);
    const n1 = noteAt(sc, 2, 1, 2), n2 = noteAt(sc, 3, 1, 1);
    const f = A.emptyFindings();
    f.pitches.push({ head: n1.sgHead, event: n1.sgEvent, pitch: { step: 'F', alter: 1, oct: 5 }, acc: 'sharp' });                       /* good */
    f.pitches.push(null, { head: n2.sgHead, pitch: { step: 'B', alter: NaN, oct: 5 } }, { head: n2.sgHead, pitch: { step: 'B', oct: Infinity } }, { head: undefined });
    f.moves.push({ event: noteAt(sc, 1, 1, 0).sgEvent, b: NaN }, { event: noteAt(sc, 1, 1, 1).sgEvent, b: Infinity }, { event: noteAt(sc, 1, 1, 2).sgEvent, b: null }, null);
    f.chordsIn.push({ m: 1, b: 0, text: 'C' }, { m: 1, b: NaN, text: 'D' }, { m: 1, b: Infinity, text: 'E' }, { m: NaN, b: 0, text: 'F' }, { m: 1, b: 0, text: null }, null);   /* the first is good */
    f.ottavas.push({ staff: 1, m: 2, b: NaN, endM: 2, endB: 3.001, dir: 1, size: 8 }, { staff: 1, m: 2, b: 0, endM: 2, endB: Infinity, dir: 1, size: 8 }, null, {});
    f.arps.push(null, { heads: null }, { heads: [1, 2] });
    f.drops.push(null);
    f.marksIn.push(null, { m: 3, kind: 'segno', text: null });                                                                         /* the second is good */
    f.heading = { title: 'X', tempo: NaN };                                                                                           /* the title is good, the NaN tempo is no tempo */
    let r;
    try { r = A.apply(g, f); } catch (e) { return { ok: false, detail: 'apply threw: ' + e.message }; }
    const sc2 = scoreOf(r.graph);
    return { ok: r.appliedTotal === 4 && r.work.validations === 1 && r.skipped.length >= 15 && r.skipped.every(s => typeof s.why === 'string' && s.why.length) && SG.validate(r.graph).ok
      && noteAt(sc2, 2, 1, 2).p === 'F#5' && sc2.chords.map(c => c.text).join() === 'C' && sc2.marks.length === 1 && sc2.title === 'X',
      detail: { applied: r.appliedTotal, skipped: r.skipped.map(s => s.group + ': ' + s.why.slice(0, 60)) } };
  }
};

/* the cost of a refusal: the first try is the whole list, a refusal takes out the entries the validator names and tries them one by one, and a budget bounds it */
const bigGraph = () => graphOf(0, 24);
function bigFindings(A, g, badMoves) {
  const sc = scoreOf(g);
  const f = A.emptyFindings();
  const rh = sc.notes.filter(n => !n.rest && (n.staff || 1) === 1 && n.voice === 1);
  rh.slice(0, 100).forEach((n, i) => { if (i % 2 === 0) f.pitches.push({ head: n.sgHead, event: n.sgEvent, pitch: { step: n.p[0], alter: 1, oct: +n.p.slice(-1) }, acc: 'sharp' }); });
  /* 100 findings in all: 50 pitches (made), then moves of the left hand: the second half note of a bar onto the first one's place is the refused kind (two events at one place in a voice), the others move to where they are (already) */
  const lh = sc.notes.filter(n => !n.rest && (n.staff || 1) === 2);
  lh.forEach((n, i) => {
    if (f.pitches.length + f.moves.length >= 100) return;
    if (i % 2 === 1 && badMoves > 0) { badMoves--; f.moves.push({ event: n.sgEvent, m: n.m, b: n.b - 2 }); }                       /* onto the first half note of the bar */
    else f.moves.push({ event: n.sgEvent, m: n.m, b: n.b });                                                                          /* where it is */
  });
  return f;
}
S.refusalCost = {
  why: 'five refused edits among a hundred cost a handful of validations, not log2 of the list for each',
  run: A => {
    const g = bigGraph();
    const f = bigFindings(A, g, 5);
    const r = A.apply(g, f);
    const total = A.count(f).total;
    return { ok: r.skipped.length === 5 && r.skipped.every(s => s.group === 'moves') && r.appliedTotal + r.already + r.skipped.length === total && r.work.validations <= 14 && SG.validate(r.graph).ok && !r.work.budgetSpent,
      detail: { total: total, applied: r.appliedTotal, already: r.already, skipped: r.skipped.length, work: r.work } };
  }
};
S.budget = {
  why: 'when the budget is spent what is unresolved is refused, named budget, and never applied unchecked',
  run: A => {
    const g = bigGraph();
    const f = bigFindings(A, g, 10);
    const none = A.apply(g, f, { maxValidations: 0 });
    const free = A.apply(g, bigFindings(A, g, 0), { maxValidations: 0 });                                                              /* nothing refused: the first try is free, the budget is not touched */
    const some = A.apply(g, f, { maxValidations: 4 });
    const total = A.count(f).total;
    const budgetOnly = x => x.skipped.filter(s => /^budget/.test(s.why)).length;
    return { ok: free.appliedTotal > 0 && !free.skipped.length && !free.work.budgetSpent && none.graph === g && none.skipped.length === total && none.skipped.every(s => /^budget/.test(s.why)) && none.work.budgetSpent
      && some.work.budgetSpent && budgetOnly(some) > 0 && some.appliedTotal + some.already + some.skipped.length === total && SG.validate(some.graph).ok && some.work.validations <= 6,
      detail: { total: total, none: [none.appliedTotal, none.skipped.length], some: [some.appliedTotal, some.already, some.skipped.length, budgetOnly(some), some.work] } };
  }
};
S.removed = {
  why: 'what the edits took away is listed: a phantom chord (its pitches and bar), a chord name, a mark',
  run: A => {
    const g0 = rich();
    const g1 = A.apply(g0, Object.assign(A.emptyFindings(), { chordsIn: [{ m: 1, b: 0, text: 'F' }], marksIn: [{ m: 2, kind: 'coda', text: null }] })).graph;
    const { before, after } = runDouble(g1, (s, P) => {
      P.phantom(s, notesAt(s, 1, 1, 0));
      P.chords(s, [1], []);
      P.marks(s, [2], []);
    });
    const f = A.diff(before, after);
    f.moves.push({ event: noteAt(scoreOf(g1), 3, 1, 1).sgEvent, m: 3, b: 0 });                                                        /* one edit the validator refuses (two events at one place) beside them: the tries that fail must leave nothing in the list */
    const r = A.apply(g1, f);
    const t = r.removed;
    return { ok: r.skipped.length === 1 && r.skipped[0].group === 'moves' && t.events === 1 && t.heads === 2 && t.chords === 1 && t.marks === 1 && t.list.length === 3
      && t.list.filter(x => x.kind === 'event')[0].pitches.length === 2 && t.list.filter(x => x.kind === 'event')[0].bar === '1' && t.list.filter(x => x.kind === 'chord')[0].text === 'F',
      detail: { removed: t, skipped: r.skipped } };
  }
};

/* the hand rule for an OMR page */
const twoParts = () => {
  const SCN = L.SC;
  const xml = require('../normalize/lib.js').doc([require('../normalize/lib.js').part('P1', SCN.series(0, 3, SCN.rhBar, SCN.first({ clefs: ['G'] })), { div: 2 }), require('../normalize/lib.js').part('P2', SCN.series(0, 3, SCN.lhBar, SCN.first({ clefs: ['F'] })), { div: 2 })]);
  return SG.musicxml.import(xml, { scoreId: 'two' }).graph;
};
S.handRule = {
  why: 'a graph that says it came from an OMR page never has a silent staff; any other graph is read as before',
  run: A => {
    const g = twoParts();
    const handsOf = x => { const h = {}; scoreOf(x).notes.forEach(n => { if (!n.rest) h[n.staff + n.hand] = (h[n.staff + n.hand] || 0) + 1; }); return Object.keys(h).sort().join(); };
    const plain = handsOf(g);                                  /* the app's rule: the last part plays, the other is silent */
    const m = A.markOmr(g);
    const marked = handsOf(m.graph);
    const again = A.markOmr(m.graph);
    const grand = graphOf();
    const grandMarked = A.markOmr(grand).graph;
    return { ok: plain === '1x,2r' && marked === '1r,2l' && m.changed && !again.changed && again.graph === m.graph && handsOf(grand) === handsOf(grandMarked)
      && SG.legacy.agree(scoreOf(m.graph), m.graph).ok && m.graph.ext['ppp.omr'].hands === 'by-staff',
      detail: { plain: plain, marked: marked, again: again.changed } };
  }
};

module.exports = { S, roundTrip, rich, twoParts, BEAMED };
