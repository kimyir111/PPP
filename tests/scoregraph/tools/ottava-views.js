/* MX-1 fixer (R1, R2): drawn = played in every view that draws a score, checked on the page.

   install() runs in the page (page.evaluate(install)) and leaves window.__mx1Views(held, name) -> { kind: { renders,
   notes, bad: [...] } }. `held` is the Score the app holds for a file (the import door's). Each view is drawn by the
   app's own ScoreView (the class PPP.app.sv() renders), with the props the app passes it there, or - for the cards - on
   the Score the app's own shelfThumb / sharedThumb make:

     whole, whole-phone   the whole score, four and two bars a line (lines across system breaks)
     part, tablet, phone  "This part": four bars on one line, four on two lines (a tablet in focus), two (a phone)
     review               the recognition review staff, four bars
     dashboard            the one-bar staff of the loop card
     preview, progress    the import preview (first three bars) and the Progress page's two
     card                 the My Songs card (a song slot, PPP.app.shelfThumb)
     shared-card, link    a Shared Scores card and the card a share link lands on (PPP.app.sharedThumb)
     stored-8981750       a preview stored with a share by MX-1 before this fix: the opening bars, lines dropped
     stored-pre-mx1       a preview stored before MX-1 (72549cb): the same, from a Score in the old reading
     old-whole, old-part, old-card   a song saved before MX-1, opened again (its Score keeps the old reading)
   The windows of the partial views start around every octave line: before it, at it, inside it, at its end.

   The invariant, for every note of the bars a view shows: its heads are drawn at the pitch it sounds (`p`, what the app
   plays for that Score), or an octave (two) away under a visible octave line of the same system whose label says so -
   "8va" / "(8va)" when it sounds an octave above the page, "8vb" below, "15ma" / "15mb" two. A line is visible as its
   label and, when there is room, its dashed stretch; it covers the notes between the label's left edge and the end of
   the dashes. (A part that transposes is drawn at its written pitch, D7; its notes are held to that. None of the octave
   line files transposes.) */
'use strict';

function install() {
  const P = window.PPP, App = P.app;
  const DI = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const RE = /^([A-G])(#{0,3}|b{0,3})(-?\d+)$/;
  const deg = p => { const m = RE.exec(p || ''); return m ? (+m[3]) * 7 + DI[m[1]] : null; };
  const BOTTOM = { treble: 30, bass: 18, alto: 24, tenor: 22, percussion: 30 };      /* bottom line, diatonic (C4 = 28) */
  const NAME = { 12: '8va', '-12': '8vb', 24: '15ma', '-24': '15mb' };
  const clone = x => JSON.parse(JSON.stringify(x, (k, v) => (k === '_byNumber' ? undefined : v)));
  const shiftP = (p, s) => { const m = RE.exec(p || ''); return m ? m[1] + m[2] + (+m[3] + Math.round(s / 12)) : p; };
  const clefAt = (mm, staffNo, b) => {
    let cl = (mm.clefs && mm.clefs[staffNo]) || (staffNo === 1 ? 'treble' : 'bass');
    (mm.clefChanges || []).forEach(ch => { if ((ch.staff || 1) === staffNo && ch.b <= b + 1e-3) cl = ch.clef; });   /* b is read from an onset key, to three places */
    return cl;
  };

  /* a Score as the app held it before MX-1 (App 72549cb..1c92fc4 finalize): the line signed the other way, p and midi
     moved by it, the file's pitch in writtenP (checked against a Score captured from that page in app-playback.test.js) */
  function preMx1(s) {
    const o = clone(s);
    delete o.ottavaRule;
    o.notes.forEach(n => {
      const k = +n.ottavaShift || 0;
      if (!k || n.rest) return;
      n.writtenP = n.p; n.writtenMidi = n.midi;
      n.ottavaShift = -k; n.midi -= k; n.soundingMidi = n.midi; n.p = shiftP(n.p, -k);
    });
    (o.ottavas || []).forEach(ov => { ov.dir = -ov.dir; ov.semitones = -ov.semitones; });
    return o;
  }
  /* the opening bars as a share stored them before this fix (openingBars at 8981750 and before: the lines dropped,
     each note kept as it was) */
  function storedPreview(s, n) {
    const o = clone(s);
    const keep = new Set(o.measures.slice(0, n).map(m => m.number));
    o.measures = o.measures.slice(0, n);
    ['notes', 'chords', 'pedals', 'marks'].forEach(k => { o[k] = (o[k] || []).filter(x => keep.has(x.m)); });
    o.ottavas = [];
    delete o.source; delete o.seeds;
    return o;
  }

  let host = null;
  function draw(score, props) {
    if (!App._SV) App.sv({});
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:0;top:0;width:1400px;z-index:-1;';
      document.body.appendChild(host);
    }
    host.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'ppp-score';
    host.appendChild(el);
    const v = new App._SV(Object.assign({ score: score, theme: App.state.theme, staves: score.staves, paper: true }, props));
    v.el = el;
    v.draw();
    return el.querySelector('svg');
  }

  /* every note of the bars the view shows, against its heads and the octave lines the view draws */
  function audit(svg, score) {
    const bad = [];
    if (!svg || !svg.__ppp) return { notes: 0, bad: ['nothing drawn'] };
    const rowOf = new Map(svg.__ppp.bars.map(b => [String(b.m), b.row]));
    const byNo = {};
    score.measures.forEach(mm => { byNo[mm.number] = mm; });
    const staves = {}, band = {};
    svg.querySelectorAll('g.ppp-stave').forEach(g => {
      const ys = [...g.querySelectorAll('.vf-stave path')].map(q => /M[\d.]+ ([\d.]+)L/.exec(q.getAttribute('d'))).filter(Boolean).map(m => +m[1]);
      if (ys.length < 5) return;
      const top = Math.min.apply(null, ys), bottom = Math.max.apply(null, ys), m = g.getAttribute('data-m');
      staves[m + '|' + g.getAttribute('data-staff')] = { bottom: bottom, gap: (bottom - top) / 4 };
      const r = rowOf.get(m);
      const b = band[r] = band[r] || { top: Infinity, bottom: -Infinity };
      b.top = Math.min(b.top, top); b.bottom = Math.max(b.bottom, bottom);
    });
    /* the octave lines as drawn: a label, and the dashed stretch that starts where the label ends */
    const paths = [...svg.querySelectorAll('path.ppp-ottava')].map(q => {
      const m = /^M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+)/.exec(q.getAttribute('d') || '');
      return m ? { x0: +m[1], y: +m[2], x1: +m[3] } : null;
    }).filter(Boolean);
    /* the system a label belongs to, where the page does not say (a renderer before the fixer): the one it is inside;
       else an 8va / 15ma sits over its system - the first one below it - and an 8vb / 15mb under it, the last one above */
    const rowOf8 = (y, up) => {
      let best = null, bd = Infinity;
      Object.keys(band).forEach(r => {
        const b = band[r];
        const d = y >= b.top && y <= b.bottom ? 0 : up ? (b.top > y ? b.top - y : Infinity) : (b.bottom < y ? y - b.bottom : Infinity);
        if (d < bd) { bd = d; best = +r; }
      });
      return best;
    };
    const lines = [...svg.querySelectorAll('text')].filter(t => /^\(?(8va|8vb|15ma|15mb)\)?$/.test(t.textContent.trim())).map(t => {
      const x = +t.getAttribute('x'), y = +t.getAttribute('y'), bb = t.getBBox();
      const dash = paths.find(q => Math.abs(q.y - (y - 4)) < 0.6 && (Math.abs(q.x0 - x - 24) < 0.6 || Math.abs(q.x0 - x - 34) < 0.6));
      const row = t.getAttribute('data-ppp-row'), name = t.textContent.trim().replace(/[()]/g, '');
      return { name: name, row: row != null ? +row : rowOf8(y, /a$/.test(name)),
        x0: x, x1: Math.max(x + bb.width, dash ? dash.x1 : -Infinity) };
    });
    /* the heads drawn at each onset: the first path of a notehead group is the head (the group also holds its accidental) */
    const heads = new Map();
    svg.querySelectorAll('g.ppp-note[data-onset]').forEach(g => {
      if (g.getAttribute('data-rest') === '1') return;
      const key = g.getAttribute('data-onset');
      const [m, b, st] = key.split('|');
      const line = staves[m + '|' + st];
      if (!line) return;
      const cl = clefAt(byNo[m] || {}, +st, +b);
      if (!heads.has(key)) heads.set(key, []);
      g.querySelectorAll('.vf-notehead').forEach(hd => {
        const q = hd.querySelector('path');
        if (!q) return;
        const bb = q.getBBox();
        heads.get(key).push({ deg: BOTTOM[cl] + Math.round((line.bottom - (bb.y + bb.height / 2)) / (line.gap / 2)), x: bb.x + bb.width / 2 });
      });
    });
    const notes = new Map();
    let count = 0;
    score.notes.forEach(n => {
      if (n.rest || !n.p || !rowOf.has(String(n.m))) return;
      const key = n.m + '|' + (+n.b).toFixed(3) + '|' + (n.staff || 1);
      if (!notes.has(key)) notes.set(key, []);
      notes.get(key).push(n);
      count++;
    });
    /* the pitch the note is heard at, as a staff step (a part that transposes: its written pitch, D7) */
    const heard = n => {
      const s = +n.ottavaShift || 0;
      if (n.writtenP && n.writtenMidi != null && n.soundingMidi != null && n.writtenMidi + s !== n.soundingMidi) return deg(n.writtenP) + 7 * s / 12;
      return deg(n.p);
    };
    const why = (n, hd, row) => {
      const d = heard(n) - hd.deg;
      if (d === 0) return null;
      const name = d % 7 === 0 ? NAME[String(12 * d / 7)] : null;
      if (!name) return 'drawn ' + d + ' steps from where it sounds';
      const ok = lines.some(l => l.name === name && l.row === row && hd.x >= l.x0 - 8 && hd.x <= l.x1 + 8);
      return ok ? null : 'drawn an octave' + (Math.abs(d) > 7 ? ' (two)' : '') + ' from where it sounds with no "' + name + '" over it';
    };
    notes.forEach((ns, key) => {
      const row = rowOf.get(key.split('|')[0]);
      const hs = heads.get(key) || [];
      if (!hs.length) { bad.push(key + ': not drawn'); return; }
      ns.forEach(n => {
        if (hs.some(hd => why(n, hd, row) === null)) return;
        bad.push(key + ' ' + n.p + ' (sounds ' + n.soundingMidi + '): ' + why(n, hs.reduce((a, b) => (Math.abs(heard(n) - b.deg) < Math.abs(heard(n) - a.deg) ? b : a)), row));
      });
      hs.forEach(hd => {
        if (ns.some(n => why(n, hd, row) === null)) return;
        bad.push(key + ': a head at step ' + hd.deg + ' that no note there sounds at, under no line that says so');
      });
    });
    return { notes: count, bad: bad };
  }

  window.__mx1Views = async (held, name) => {
    const out = {};
    const run = (kind, score, props) => {
      const r = audit(draw(score, props), score);
      const o = out[kind] = out[kind] || { renders: 0, notes: 0, bad: [] };
      o.renders++; o.notes += r.notes;
      r.bad.forEach(b => o.bad.push((props.startM != null ? 'bars from ' + props.startM + ': ' : '') + b));
    };
    const grand = s => s.staves > 1;
    const starts = (s, count) => {
      const idx = new Map(s.measures.map((mm, i) => [mm.number, i]));
      const n = s.measures.length, set = new Set();
      (s.ottavas || []).forEach(ov => {
        const ia = idx.get(ov.m), iz = idx.get(ov.endM);
        if (ia == null || iz == null) return;
        [ia - count + 1, ia - 1, ia, ia + 1, (ia + iz) >> 1, iz - count + 1, iz - 1, iz].forEach(i => { if (i >= 0 && i < n) set.add(i); });
      });
      return [...set].sort((a, b) => a - b).map(i => s.measures[i].number);
    };
    const views = (s, prefix, which) => {
      const first = P.Score.first(s), n = P.Score.count(s);
      if (which.whole) {
        run(prefix + 'whole', s, { startM: first, count: n, perRow: 4, fluid: true, heading: true, mW: 236, zoom: 1, grand: grand(s), guidance: false });
        if (prefix === '') run('whole-phone', s, { startM: first, count: n, perRow: 2, fluid: true, heading: true, mW: 180, zoom: 1, grand: grand(s), guidance: false });
      }
      if (which.part) starts(s, 4).forEach(m => run(prefix + 'part', s, { startM: m, count: 4, perRow: 0, mW: 210, zoom: 1, grand: grand(s), guidance: false }));
      if (which.more) {
        starts(s, 4).forEach(m => run('tablet', s, { startM: m, count: 4, perRow: 2, mW: 210, zoom: 1, grand: grand(s), guidance: false }));
        starts(s, 2).forEach(m => run('phone', s, { startM: m, count: 2, perRow: 0, mW: 210, zoom: 1, grand: grand(s), guidance: false }));
        starts(s, 4).forEach(m => run('review', s, { startM: m, count: 4, mW: 200, numbers: true, guidance: false, grand: grand(s), fluid: true }));
        starts(s, 1).forEach(m => run('dashboard', s, { startM: m, count: 1, mW: 120, numbers: false, guidance: false, chords: false, fluid: true, clefs: false, grand: grand(s) }));
        run('preview', s, { startM: first, count: Math.min(3, n), mW: 210, fluid: true, guidance: false, grand: grand(s) });
        run('progress', s, { startM: first, count: 2, mW: 150, numbers: false, guidance: false, fluid: true, grand: grand(s) });
      }
    };
    const cardProps = (th, count, mW) => ({ startM: P.Score.first(th), count: count, mW: mW, numbers: false, guidance: false, fluid: true, grand: th.staves > 1 });
    /* a My Songs card: the song's slot, read by the app's own shelfThumb */
    const card = (kind, full) => {
      const id = 'mx1-check-' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('ppp.song.v1.' + id, JSON.stringify({ score: P.packScore(clone(full)) })); } catch (e) { out[kind] = { renders: 0, notes: 0, bad: ['no slot: ' + e.message] }; return; }
      if (App._thumbs) delete App._thumbs[id];
      const th = App.shelfThumb(id);
      try { localStorage.removeItem('ppp.song.v1.' + id); } catch (e) {}
      if (!th) { out[kind] = { renders: 0, notes: 0, bad: ['no card'] }; return; }
      run(kind, th, cardProps(th, 2, 150));
    };
    const shared = (kind, stored, bars, mW) => {
      const th = App.sharedThumb('mx1-check:' + kind + ':' + name + ':' + Math.random(), clone(stored), bars);
      if (!th) { out[kind] = { renders: 0, notes: 0, bad: ['no card'] }; return; }
      run(kind, th, cardProps(th, bars, mW));
    };

    views(held, '', { whole: true, part: true, more: true });
    card('card', held);
    shared('shared-card', held, 2, 150);           /* publishSong stores openingBars(score, 2); the card reads it again */
    shared('link', held, 4, 170);
    shared('stored-8981750', storedPreview(held, 2), 2, 150);
    const old = preMx1(held);
    shared('stored-pre-mx1', storedPreview(old, 2), 2, 150);
    views(P.Score.finalize(clone(old)), 'old-', { whole: true, part: true });
    card('old-card', old);
    if (host) host.innerHTML = '';
    return out;
  };
  return true;
}

module.exports = { install };
