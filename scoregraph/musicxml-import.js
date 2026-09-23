/* ============================================================================
   PPP ScoreGraph — MusicXML import (docs/GOALS/G01 Appendix A)

   importMusicXml(text, opts) -> {ok: true, graph, report} or
                                 {ok: false, code, message, report}
     opts: {scoreId, sourceName, sourceSha256, container: 'musicxml'|'mxl'}
     report: {issues: [W-IMPORT-* ...], dropped: {name: count}, validation}

   The MusicXML standard reading (not the app's): <pitch> is the written
   pitch and the graph stores concert pitch; an octave-shift moves only the
   display; a tie start pairs with a stop of the same pitch that begins where
   the tied note ends. Faithful (DP6): a defect that can be represented (an
   open tie, a note printed as another value, a short bar) is kept and left to
   the validator's warnings. Every element the importer does not map is
   counted in report.dropped (A35). IDs are assigned in the §12.2 order, so the
   same file gives the same bytes (A30).

   G1 limits: <unpitched> is refused (IMPORT-UNSUPPORTED-UNPITCHED), and so is
   score-timewise (IMPORT-TIMEWISE). Node reads .mxl through the caller: the
   input is the XML text.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./pitch.js'), require('./xml.js'),
      require('./build.js'));
  else {
    const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {};
    M.musicxmlImport = factory(M.rational, M.schema, M.pitch, M.xml, M.build);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, P, X, B) {
  'use strict';

  const CODES = Object.freeze(['IMPORT-BAD-XML', 'IMPORT-TIMEWISE', 'IMPORT-UNSUPPORTED-UNPITCHED', 'IMPORT-NO-PARTS',
    'IMPORT-UNSUPPORTED', 'IMPORT-INVALID']);
  /* Report-only codes: the importer had to change the source to represent it (§13.2 W-IMPORT-*). */
  const REPORT_CODES = Object.freeze(['W-IMPORT-CHORD-SPLIT', 'W-IMPORT-BACKUP-CLAMP', 'W-IMPORT-METER-MIDMEASURE',
    'W-IMPORT-REPEAT-MOVED', 'W-IMPORT-VOICE-SPLIT', 'W-IMPORT-UNPAIRED',
    /* G02: what used to refuse the whole file, and what the graph rounds (§6.3) */
    'W-IMPORT-METER-ASSUMED', 'W-IMPORT-MICROTONE', 'W-IMPORT-PERC-KIT']);

  class ImportError extends Error {
    constructor(code, message) { super(code + ': ' + message); this.code = code; }
  }

  const FLOAT_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;
  /* parseFloat as an exact rational (null when there is no leading number). */
  function jsFloatRat(text) {
    if (text == null) return null;
    const m = FLOAT_RE.exec(text);
    if (!m) return null;
    const d = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(m[1]);
    if (!d) return null;
    const neg = d[1] === '-', ip = d[2] || '0', fp = d[3] || '';
    let e = d[4] ? Number(d[4]) : 0;
    let n = Number(ip + fp), den = Math.pow(10, fp.length);
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(den)) throw new ImportError('IMPORT-UNSUPPORTED', 'the number ' + text + ' is too long to read exactly');
    if (e > 0) n *= Math.pow(10, e); else if (e < 0) den *= Math.pow(10, -e);
    return R.make(neg ? -n : n, den);
  }
  function jsInt(text) {
    if (text == null) return null;
    const m = /^\s*([+-]?\d+)/.exec(text);
    return m ? Number(m[1]) : null;
  }
  const yes = v => v === 'yes';
  /* A kit key out of an instrument name: KIT_KEY_RE is /^[a-z][a-z0-9-]*$/ (G02 §17). */
  function kitKey(name) {
    const k = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return /^[a-z]/.test(k) ? k : '';
  }
  /* <fermata> wherever it sits: on a note's notations, or on a bar line (v2, G02 §18 S4). */
  function readFermata(f) {
    const out = {};
    const shape = f.text.trim();
    if (shape && ['normal', 'angled', 'square'].indexOf(shape) >= 0) out.shape = shape;
    if (f.attrs.type === 'inverted') out.inverted = true;
    return out;
  }
  const ARTICULATION_OF = { 'staccato': 'staccato', 'staccatissimo': 'staccatissimo', 'tenuto': 'tenuto', 'accent': 'accent',
    'strong-accent': 'marcato', 'spiccato': 'spiccato', 'stress': 'stress', 'unstress': 'unstress',
    'detached-legato': 'detached-legato', 'breath-mark': 'breath-mark', 'caesura': 'caesura' };
  const ORNAMENT_OF = { 'trill-mark': 'trill', 'mordent': 'mordent', 'inverted-mordent': 'inverted-mordent', 'turn': 'turn',
    'inverted-turn': 'inverted-turn', 'tremolo': 'tremolo', 'shake': 'shake', 'schleifer': 'schleifer' };
  const DYNAMIC_SET = new Set(S.DYNAMICS);
  const JUMP_SOUND = { dacapo: 'dacapo', dalsegno: 'dalsegno', fine: 'fine', tocoda: 'tocoda', segno: 'segno', coda: 'coda' };
  const SOUND_MAPPED = new Set(['tempo', 'damper-pedal', 'soft-pedal', 'sostenuto-pedal', 'dacapo', 'dalsegno', 'fine', 'tocoda', 'segno', 'coda']);
  const BEAM_LEVELS = { 'eighth': 1, '16th': 2, '32nd': 3, '64th': 4, '128th': 5, '256th': 6, '512th': 7, '1024th': 8 };
  const SPANNER_SUBORDER = { tuplet: 0, beam: 1, slur: 2, tie: 3, arpeggio: 4, wedge: 5, pedal: 6, ottava: 7, gliss: 8 };

  function importMusicXml(text, opts) {
    opts = opts || {};
    const report = { issues: [], dropped: {} };
    const fail = (code, message) => ({ ok: false, code: code, message: message, report: report });
    let tree;
    try { tree = X.parse(text); } catch (e) { return fail('IMPORT-BAD-XML', e.message); }
    const root = X.localNames(tree.root);
    if (root.name === 'score-timewise') return fail('IMPORT-TIMEWISE', 'score-timewise is not read (convert it to score-partwise)');
    if (root.name !== 'score-partwise') return fail('IMPORT-BAD-XML', 'the root element is <' + root.name + '>');
    try {
      const graph = readScore(root, opts, report);
      return { ok: true, graph: graph, report: report };
    } catch (e) {
      if (e instanceof ImportError) return fail(e.code, e.message);
      if (e && e.code === 'E-BUILD') {
        report.validation = e.issues;
        return fail('IMPORT-INVALID', e.message);
      }
      throw e;
    }
  }

  function readScore(root, opts, report) {
    const used = new Set([root]);
    const use = el => { if (el) used.add(el); return el; };
    const kid = (el, name) => use(el.kids.find(k => k.name === name));
    const kidsN = (el, name) => el.kids.filter(k => k.name === name).map(use);
    const txt = (el, name) => { const k = kid(el, name); return k ? k.text.trim() : undefined; };
    const issue = (code, message) => report.issues.push({ code: code, severity: 'WARNING', message: message });
    const drop = name => { report.dropped[name] = (report.dropped[name] || 0) + 1; };
    let docIndex = 0;

    /* -------------------------------------------------------------- header */
    const meta = {};
    let software;
    const work = kid(root, 'work');
    if (work) {
      const wt = kid(work, 'work-title'); if (wt) meta.title = wt.text.trim();
      const wn = kid(work, 'work-number'); if (wn) meta.workNumber = wn.text.trim();
    }
    const mt = kid(root, 'movement-title'); if (mt) meta.movementTitle = mt.text.trim();
    const mn = kid(root, 'movement-number'); if (mn) meta.movementNumber = mn.text.trim();
    const ident = kid(root, 'identification');
    if (ident) {
      ident.kids.filter(k => k.name === 'creator').forEach(cr => {
        const t = cr.attrs.type, f = t === 'composer' ? 'composer' : t === 'lyricist' || t === 'poet' ? 'lyricist' : t === 'arranger' ? 'arranger' : null;
        if (f && meta[f] === undefined) { use(cr); meta[f] = cr.text.trim(); }
      });
      const rights = ident.kids.find(k => k.name === 'rights');
      if (rights) { use(rights); meta.copyright = rights.text.trim(); }
      const enc = kid(ident, 'encoding');
      if (enc) { const sw = enc.kids.find(k => k.name === 'software'); if (sw) { use(sw); software = sw.text.trim(); } }
    }
    Object.keys(meta).forEach(k => { if (meta[k] === '') delete meta[k]; });

    const partInfo = new Map();
    const pl = kid(root, 'part-list');
    if (pl) pl.kids.filter(k => k.name === 'score-part').forEach(sp => {
      use(sp);
      const info = {};
      const pn = kid(sp, 'part-name'); if (pn && pn.text.trim()) info.name = pn.text.trim();
      const pa = kid(sp, 'part-abbreviation'); if (pa && pa.text.trim()) info.abbr = pa.text.trim();
      /* every <score-instrument>, not only the first: a drum part names one per kit piece (G02 §17) */
      info.instruments = new Map();
      sp.kids.filter(k => k.name === 'score-instrument').forEach(si => {
        use(si);
        const iname = kid(si, 'instrument-name');
        const rec2 = { id: si.attrs.id, name: iname && iname.text.trim() ? iname.text.trim() : undefined };
        info.instruments.set(si.attrs.id, rec2);
        if (info.instrumentName === undefined && rec2.name) info.instrumentName = rec2.name;
      });
      sp.kids.filter(k => k.name === 'midi-instrument').forEach(mi => {
        use(mi);
        const ch = jsInt(txt(mi, 'midi-channel')), pr = jsInt(txt(mi, 'midi-program'));
        const un = jsInt(txt(mi, 'midi-unpitched'));
        const rec2 = info.instruments.get(mi.attrs.id);
        if (rec2 && un != null) rec2.gm = un;          /* 1-based note number of the kit piece */
        if (!info.midi) info.midi = {};
        if (pr >= 1 && pr <= 128 && info.midi.program === undefined) info.midi.program = pr;
        if (ch >= 1 && ch <= 16 && info.midi.channel === undefined) info.midi.channel = ch;
      });
      if (info.midi && !Object.keys(info.midi).length) delete info.midi;
      info.used = true;
      partInfo.set(sp.attrs.id, info);
    });
    const partEls = root.kids.filter(k => k.name === 'part').map(use);
    if (!partEls.length) throw new ImportError('IMPORT-NO-PARTS', 'the score has no <part>');

    /* ------------------------------------------------------ reading state */
    const timeline = [];       /* per measure index: {number, implicit, width, newSystem, newPage, barline, content} */
    const meterAt = [];        /* per measure index: {beats, beatType, symbol, hidden} from part 0 */
    const keyDrafts = [];      /* {pi, staffNo, mi, at, fifths, mode, hidden, doc} */
    const tempoDrafts = [];    /* {pi, mi, at, qpm, mark, staffNo, placement, doc} */
    const endingDrafts = [];   /* {numbers, text, fromMi, toMi, open, doc} */
    const jumpDrafts = [];     /* {kind, mi, at, text, pi, staffNo, placement, doc} */
    const parts = [];          /* per part: see below */

    function measureRecord(mi, mEl, pi) {
      if (!timeline[mi]) {
        timeline[mi] = { number: mEl.attrs.number != null ? mEl.attrs.number : String(mi + 1), implicit: yes(mEl.attrs.implicit),
          content: R.ZERO, barline: {}, owner: pi };
        const w = jsFloatRat(mEl.attrs.width);
        if (w && R.sign(w) >= 0) timeline[mi].width = Math.round(R.toNumber(w) * 1000) / 1000;
      }
      return timeline[mi];
    }

    partEls.forEach((partEl, pi) => {
      const info = partInfo.get(partEl.attrs.id) || {};
      const part = { pi: pi, info: info, staves: 1, maxStaff: 1, transpose: null, voices: [], voiceByKey: new Map(),
        clefs: [], events: [], directions: [], ties: [], slurs: [], gliss: [], tuplets: [], beams: [], wedges: [], pedals: [],
        ottavas: [], arps: [] };
      parts.push(part);
      let divisions = R.ONE;
      const toW = durText => { const d = jsFloatRat(durText); return d ? R.div(d, R.mul(divisions, R.make(4))) : R.ZERO; };
      const openSlurs = new Map(), openWedges = new Map(), openPedals = [], openOttavas = new Map();
      const openGliss = new Map();
      const openBrackets = new Map();          /* voice key -> [bracket] (innermost last) */
      const openBeams = new Map();             /* voice key -> beam draft */
      let pendingMeter = null;
      partEl.kids.filter(k => k.name === 'measure').forEach((mEl, mi) => {
        use(mEl);
        const rec = measureRecord(mi, mEl, pi);
        let cursor = R.ZERO, maxCursor = R.ZERO, lastEvent = null, seenNote = false;
        const graceCount = new Map();
        if (pendingMeter && pi === 0 && !meterAt[mi]) { meterAt[mi] = pendingMeter; }
        pendingMeter = null;
        const bump = () => { if (R.gt(cursor, maxCursor)) maxCursor = cursor; };
        const offsetOf = el => { const o = kid(el, 'offset'); return o ? toW(o.text) : R.ZERO; };

        mEl.kids.forEach(el => {
          switch (el.name) {
            case 'attributes': use(el); readAttributes(el); break;
            case 'note': use(el); readNote(el); seenNote = true; break;
            case 'backup': {
              use(el);
              cursor = R.sub(cursor, toW(txt(el, 'duration')));
              if (R.sign(cursor) < 0) { cursor = R.ZERO; issue('W-IMPORT-BACKUP-CLAMP', 'a <backup> in measure ' + rec.number + ' went before the measure start'); }
              break;
            }
            case 'forward': {
              use(el);
              kid(el, 'voice'); kid(el, 'staff');
              cursor = R.add(cursor, toW(txt(el, 'duration')));
              bump();
              break;
            }
            case 'direction': use(el); readDirection(el); break;
            case 'harmony': use(el); readHarmony(el); break;
            case 'sound': use(el); readSound(el, cursor, null, null, null); break;
            case 'barline': use(el); readBarline(el); break;
            case 'print': {
              const ns = yes(el.attrs['new-system']), np = yes(el.attrs['new-page']);
              if (ns || np) { use(el); if (pi === 0) { if (ns) rec.newSystem = true; if (np) rec.newPage = true; } }
              break;
            }
            default: break;
          }
        });
        if (R.gt(maxCursor, rec.content)) rec.content = maxCursor;

        /* ---------------------------------------------------- attributes */
        function readAttributes(a) {
          const dv = kid(a, 'divisions');
          if (dv) { const d = jsFloatRat(dv.text); if (d && R.sign(d) > 0) divisions = d; }
          kidsN(a, 'key').forEach(k => {
            const f = jsInt(txt(k, 'fifths'));
            if (f == null) { used.delete(k); return; }
            const staffNo = k.attrs.number != null ? jsInt(k.attrs.number) : null;
            const mode = txt(k, 'mode');
            keyDrafts.push({ pi: pi, staffNo: staffNo, mi: mi, at: cursor, written: f, mode: mode,
              hidden: k.attrs['print-object'] === 'no', doc: docIndex++ });
          });
          kidsN(a, 'time').forEach(t => {
            const bs = t.kids.filter(k => k.name === 'beats').map(use), bts = t.kids.filter(k => k.name === 'beat-type').map(use);
            let beats = [], beatType = null, okT = bs.length > 0 && bs.length === bts.length;
            bs.forEach((b, i) => {
              const parts2 = b.text.trim().split('+').map(x => (/^\d+$/.test(x.trim()) ? Number(x.trim()) : NaN));
              const bt = jsInt(bts[i].text);
              if (parts2.some(x => !(x >= 1)) || !(bt >= 1) || (beatType != null && bt !== beatType)) okT = false;
              beatType = bt;
              beats = beats.concat(parts2);
            });
            /* <senza-misura> is a <time> with no beats: music without a metre. The graph has no way to
               say so, and MusicXML keeps the measures, so the measure holds whatever is written in it
               and the fact is kept on the meter (G02 6.3). Anything else without beats is unreadable. */
            const senza = kid(t, 'senza-misura');
            if (!okT && !senza) { used.delete(t); bs.concat(bts).forEach(x => used.delete(x)); return; }
            const meter = !okT && senza ? { beats: [4], beatType: 4, hidden: true, senza: true }
              : { beats: beats, beatType: beatType };
            if (t.attrs.symbol) meter.symbol = t.attrs.symbol;
            if (t.attrs['print-object'] === 'no') meter.hidden = true;
            if (pi !== 0) {
              let mine = null;
              for (let i = mi; i >= 0 && !mine; i--) mine = meterAt[i] || null;
              if (mine && JSON.stringify(mine.beats) === JSON.stringify(beats) && mine.beatType === beatType) return;
              /* a part after the first states a metre the score does not have yet: better than none at
                 all (a vocal line above the piano often carries it). Otherwise it is the first part's. */
              if (!mine && !meterAt[mi]) { meterAt[mi] = meter; return; }
              drop('time (another part\'s)');
              return;
            }
            if (seenNote || !R.isZero(cursor)) {
              issue('W-IMPORT-METER-MIDMEASURE', 'a time signature in the middle of measure ' + rec.number + ' applies from the next measure');
              pendingMeter = meter;
            } else meterAt[mi] = meter;
          });
          const st = kid(a, 'staves');
          if (st) { const n = jsInt(st.text); if (n >= 1) part.staves = Math.max(part.staves, n); }
          /* <measure-style><multiple-rest>: the measures are all still here, this is how they print (v2) */
          kidsN(a, 'measure-style').forEach(ms => {
            const mr = kid(ms, 'multiple-rest');
            if (!mr) { used.delete(ms); return; }
            const n = jsInt(mr.text);
            if (!(n >= 2)) { used.delete(ms); used.delete(mr); return; }
            if (pi === 0) rec.multiRest = n; else drop('measure-style (another part\'s)');
          });
          kidsN(a, 'clef').forEach(c => {
            const sign = txt(c, 'sign');
            if (['G', 'F', 'C', 'percussion', 'TAB', 'none'].indexOf(sign) < 0) { used.delete(c); return; }
            const clef = { staffNo: jsInt(c.attrs.number) || 1, mi: mi, at: cursor, sign: sign, doc: docIndex++ };
            const line = jsInt(txt(c, 'line'));
            if (line != null) clef.line = line;
            const oc = jsInt(txt(c, 'clef-octave-change'));
            if (oc) clef.octave = oc;
            part.maxStaff = Math.max(part.maxStaff, clef.staffNo);
            part.clefs.push(clef);
          });
          const tr = kid(a, 'transpose');
          if (tr) {
            const t = { chromatic: jsInt(txt(tr, 'chromatic')) || 0, diatonic: jsInt(txt(tr, 'diatonic')) || 0 };
            const oc = jsInt(txt(tr, 'octave-change'));
            if (oc) t.octave = oc;
            if (!part.transpose) part.transpose = t;
            else if (JSON.stringify(part.transpose) !== JSON.stringify(t)) drop('transpose (a change)');
          }
        }

        /* ---------------------------------------------------------- voices */
        /* The graph voice for a MusicXML voice number: the first voice of that number the event fits in
           without overlapping; a new one (same number) when none does, or when `avoid` (a chord split) is the
           only one. */
        function voiceFor(label, staffNo, at, dur, grace, avoid) {
          const key = label === undefined ? '' : label;
          let list = part.voiceByKey.get(key);
          if (!list) { list = []; part.voiceByKey.set(key, list); }
          const fits = v => v !== avoid && (grace || !v.spans.some(s => s.mi === mi && R.lt(s.a, R.add(at, dur)) && R.lt(at, s.b)));
          let v = list.find(fits);
          if (!v) {
            v = { label: label, homeStaff: staffNo, spans: [], doc: docIndex++, events: [] };
            if (list.length && !avoid) issue('W-IMPORT-VOICE-SPLIT', 'voice ' + key + ' overlaps itself in measure ' + rec.number + ': its later notes go to another voice with the same number');
            list.push(v);
            part.voices.push(v);
          }
          return v;
        }

        /* ----------------------------------------------------------- notes */
        function readNote(n) {
          const graceEl = kid(n, 'grace'), chordEl = kid(n, 'chord'), cueEl = kid(n, 'cue');
          const restEl = kid(n, 'rest'), pitchEl = kid(n, 'pitch');
          const durEl = kid(n, 'duration');
          const dur = graceEl ? R.ZERO : (durEl ? toW(durEl.text) : R.ZERO);
          const voiceEl = kid(n, 'voice');
          const label = voiceEl ? voiceEl.text.trim() : undefined;
          const staffNo = jsInt(txt(n, 'staff')) || 1;
          part.maxStaff = Math.max(part.maxStaff, staffNo);
          const doc = docIndex++;
          /* the head (a pitched note) */
          let head = null;
          const unpitchedEl = kid(n, 'unpitched');
          if (!restEl && !pitchEl && unpitchedEl) {
            /* a percussion note: what it is comes from <instrument>, where it sits from <unpitched> */
            const step = txt(unpitchedEl, 'display-step'), oct = jsInt(txt(unpitchedEl, 'display-octave'));
            if (S.STEPS.indexOf(step) < 0 || oct == null) throw new ImportError('IMPORT-UNSUPPORTED', 'an <unpitched> without a valid display step or octave');
            const instEl = kid(n, 'instrument');
            const pos = { step: step, oct: oct };
            head = { perc: true, instId: instEl ? instEl.attrs.id : null, pos: pos, staffNo: staffNo, doc: doc };
            part.hasPerc = true;
            const nh = kid(n, 'notehead');
            if (nh) {
              const shape = nh.text.trim(), o = {};
              if (S.NOTEHEADS.indexOf(shape) >= 0) o.shape = shape;
              else if (shape) drop('notehead ' + shape);
              if (nh.attrs.filled !== undefined) o.filled = yes(nh.attrs.filled);
              if (yes(nh.attrs.parentheses)) o.paren = true;
              if (Object.keys(o).length) head.notehead = o;
            }
          } else if (!restEl && pitchEl) {
            const step = txt(pitchEl, 'step'), alterT = txt(pitchEl, 'alter'), oct = jsInt(txt(pitchEl, 'octave'));
            const exact = alterT == null ? 0 : Number(alterT);
            if (!isFinite(exact)) throw new ImportError('IMPORT-UNSUPPORTED', 'an <alter> that is not a number: ' + alterT);
            /* The graph stores whole semitones (G01 §18 keeps microtones out of scope). A quarter tone is
               not a reason to refuse the file: round to the nearest semitone, say so, and keep what the
               file said on the head so nothing is lost silently (G02 §6.3). */
            let alter = exact;
            let microtone = null;
            if (!Number.isInteger(exact)) {
              alter = Math.round(exact);
              /* round half away from zero, so +0.5 is a sharp and -0.5 a flat rather than both a natural */
              if (Math.abs(exact - Math.trunc(exact)) === 0.5) alter = Math.trunc(exact) + Math.sign(exact);
              microtone = exact;
            }
            if (S.STEPS.indexOf(step) < 0 || oct == null) throw new ImportError('IMPORT-UNSUPPORTED', 'a pitch without a valid step or octave');
            if (alter < -3 || alter > 3) throw new ImportError('IMPORT-UNSUPPORTED', 'an <alter> of ' + alterT + ' is beyond three semitones');
            const written = { step: step, oct: oct };
            if (alter) written.alter = alter;
            head = { pitch: P.concert(written, part.transpose), staffNo: staffNo, doc: doc };
            if (microtone !== null) {
              issue('W-IMPORT-MICROTONE', 'a microtonal <alter> ' + alterT + ' in measure ' + rec.number +
                ' is written as ' + alter + '; the file\'s value is kept in ext');
              head.ext = { 'musicxml.microtone': { alter: microtone } };
            }
            const accEl = kid(n, 'accidental');
            if (accEl) {
              const type = accEl.text.trim();
              if (S.ACCIDENTALS.indexOf(type) >= 0) {
                head.acc = { type: type };
                if (yes(accEl.attrs.cautionary)) head.acc.cautionary = true;
                if (yes(accEl.attrs.editorial)) head.acc.editorial = true;
                if (yes(accEl.attrs.parentheses)) head.acc.paren = true;
                if (yes(accEl.attrs.bracket)) head.acc.bracket = true;
              } else used.delete(accEl);
            }
            const nh = kid(n, 'notehead');
            if (nh) {
              const shape = nh.text.trim();
              const o = {};
              if (shape && S.NOTEHEADS.indexOf(shape) >= 0) o.shape = shape;
              if (nh.attrs.filled === 'yes') o.filled = true;
              if (nh.attrs.filled === 'no') o.filled = false;
              if (yes(nh.attrs.parentheses)) o.paren = true;
              if (shape && S.NOTEHEADS.indexOf(shape) < 0) drop('notehead ' + shape);
              if (Object.keys(o).length) head.notehead = o;
            }
            n.kids.filter(k => k.name === 'tie').forEach(t => { use(t); if (t.attrs.type === 'start') head.tieStart = true; if (t.attrs.type === 'stop') head.tieStop = true; });
          } else if (!restEl) {
            throw new ImportError('IMPORT-UNSUPPORTED', 'a <note> with neither <pitch> nor <rest>');
          }
          const notations = n.kids.filter(k => k.name === 'notations').map(use);
          const nk = name => [].concat.apply([], notations.map(x => x.kids.filter(k => k.name === name).map(use)));
          if (head) {
            /* a Tie is a sounding tie (<tie>); <tied> is its notation. A <tied> with no <tie> of its type is a printed tie
               that does not sound (the app strikes twice): the graph cannot keep it and reports it (G0 fixture C02). */
            nk('tied').forEach(t => {
              const ty = t.attrs.type;
              if ((ty === 'start' && !head.tieStart) || (ty === 'stop' && !head.tieStop)) drop('tied (a notated tie that does not sound)');
            });
            const techs = nk('technical');
            const fing = [];
            techs.forEach(tc => tc.kids.forEach(k => {
              if (k.name === 'fingering') {
                use(k);
                const fo = { f: k.text.trim() };
                if (yes(k.attrs.substitution)) fo.subst = true;
                if (yes(k.attrs.alternate)) fo.alt = true;
                if (k.attrs.placement === 'above' || k.attrs.placement === 'below') fo.placement = k.attrs.placement;
                fing.push(fo);
              } else if (k.name === 'string' || k.name === 'fret') {
                const v = jsInt(k.text);
                if (v != null && ((k.name === 'string' && v >= 1) || (k.name === 'fret' && v >= 0))) {
                  use(k);
                  head.tech = head.tech || {};
                  head.tech[k.name] = v;
                }
              }
            }));
            if (fing.length) head.fingering = fing;
            nk('arpeggiate').forEach(a => part.arps.push({ head: head, number: a.attrs.number, dir: a.attrs.direction, non: false, doc: doc }));
            nk('non-arpeggiate').forEach(a => part.arps.push({ head: head, number: a.attrs.number, non: true, doc: doc }));
          }
          /* the event: a chord note joins the previous note's event */
          const grace = !!graceEl;
          const onset = chordEl && lastEvent ? lastEvent.at : cursor;
          let ev = null;
          const samePitch = h => (head.perc
            ? h.perc && h.instId === head.instId && h.pos.step === head.pos.step && h.pos.oct === head.pos.oct
            : !h.perc && h.pitch.step === head.pitch.step && (h.pitch.alter || 0) === (head.pitch.alter || 0) && h.pitch.oct === head.pitch.oct);
          if (chordEl && lastEvent && (lastEvent.kind === 'note' || lastEvent.kind === 'perc') && head && lastEvent.grace === grace) {
            if (R.eq(lastEvent.dur, dur) && !lastEvent.heads.some(samePitch)) ev = lastEvent;
            else if (R.eq(lastEvent.dur, dur)) {
              issue('W-IMPORT-CHORD-SPLIT', 'a chord in measure ' + rec.number + ' has the same pitch twice: the second goes to its own voice');
              ev = newEvent(lastEvent.voice);
            } else {
              issue('W-IMPORT-CHORD-SPLIT', 'a chord note in measure ' + rec.number + ' lasts ' + R.format(dur) + ' W, its chord ' + R.format(lastEvent.dur) + ': it goes to its own voice');
              ev = newEvent(lastEvent.voice);
            }
          } else ev = newEvent(null);
          function newEvent(avoid) {
            const at = onset;
            const voice = voiceFor(label, staffNo, at, dur, grace, avoid);
            const e = { kind: head ? (head.perc ? 'perc' : 'note') : 'rest', mi: mi, at: at, dur: dur, voice: voice, staffNo: staffNo, heads: [],
              grace: grace, doc: doc, part: pi, arts: [], orn: [], lyrics: [], pi: pi };
            if (!grace) voice.spans.push({ mi: mi, a: at, b: R.add(at, dur) });
            if (!voice.events.length) voice.homeStaff = staffNo;
            voice.events.push(e);
            if (grace) {
              const gk = voice.doc + '|' + R.format(at);
              const order = (graceCount.get(gk) || 0) + 1;
              graceCount.set(gk, order);
              e.graceInfo = { order: order };
              if (yes(graceEl.attrs.slash)) e.graceInfo.slash = true;
            }
            /* display */
            const disp = {};
            const typeEl = kid(n, 'type');
            if (typeEl) {
              const t = typeEl.text.trim();
              if (S.NOTE_TYPES.indexOf(t) >= 0) disp.type = t; else used.delete(typeEl);
              if (['cue', 'grace', 'large'].indexOf(typeEl.attrs.size) >= 0) disp.size = typeEl.attrs.size;
            }
            const dots = kidsN(n, 'dot').length;
            if (dots) disp.dots = dots;
            const stem = txt(n, 'stem');
            if (stem && ['up', 'down', 'none', 'double'].indexOf(stem) >= 0) disp.stem = stem;
            else if (stem) drop('stem ' + stem);
            const dx = jsFloatRat(n.attrs['default-x']);
            if (dx) disp.x = Math.round(R.toNumber(dx) * 1000) / 1000;
            if (restEl) {
              if (yes(restEl.attrs.measure)) disp.measureRest = true;
              const ds = txt(restEl, 'display-step'), dO = jsInt(txt(restEl, 'display-octave'));
              if (ds && S.STEPS.indexOf(ds) >= 0 && dO != null) disp.pos = { step: ds, oct: dO };
            }
            e.display = disp;
            if (n.attrs['print-object'] === 'no') e.hidden = true;
            if (cueEl && head) e.cue = true;
            else if (cueEl) used.delete(cueEl);
            part.events.push(e);
            return e;
          }
          if (head) { ev.heads.push(head); head.event = ev; }
          if (ev !== lastEvent || !chordEl) { /* the event's own note: display read in newEvent */ }
          else {
            /* a chord note repeats the event's printed value; one that says otherwise cannot be kept */
            const typeEl = kid(n, 'type'), stemT = txt(n, 'stem'), dots = kidsN(n, 'dot').length;
            if ((typeEl ? typeEl.text.trim() : undefined) !== ev.display.type || (dots || undefined) !== ev.display.dots ||
                (stemT !== undefined && stemT !== ev.display.stem)) drop('type/dot/stem (a chord note that differs from its chord)');
          }
          lastEvent = ev;
          if (!chordEl && !grace) { cursor = R.add(cursor, dur); bump(); }

          /* event-level marks (every note of a chord may carry them; they are the event's) */
          const tm = kid(n, 'time-modification');
          if (tm) {
            const a = jsInt(txt(tm, 'actual-notes')), nn = jsInt(txt(tm, 'normal-notes'));
            const nt = txt(tm, 'normal-type');
            const nd = kidsN(tm, 'normal-dot').length;
            if (a >= 1 && nn >= 1) ev.tm = { actual: a, normal: nn, normalType: S.NOTE_TYPES.indexOf(nt) >= 0 ? nt : undefined, normalDots: nd || undefined };
          }
          n.kids.filter(k => k.name === 'beam').forEach(b => {
            use(b);
            ev.beams = ev.beams || [];
            ev.beams.push({ number: jsInt(b.attrs.number) || 1, value: b.text.trim() });
          });
          nk('articulations').forEach(ar => ar.kids.forEach(k => {
            if (ARTICULATION_OF[k.name]) { use(k); if (ev.arts.indexOf(ARTICULATION_OF[k.name]) < 0) ev.arts.push(ARTICULATION_OF[k.name]); }
          }));
          nk('ornaments').forEach(or => {
            let last = null;
            or.kids.forEach(k => {
              if (ORNAMENT_OF[k.name]) {
                use(k);
                last = { type: ORNAMENT_OF[k.name] };
                if (k.name === 'tremolo') { const mm = jsInt(k.text); if (mm >= 1) last.marks = mm; }
                ev.orn.push(last);
              } else if (k.name === 'accidental-mark' && last) { use(k); last.acc = k.text.trim(); }
            });
          });
          nk('fermata').forEach((f, i) => {
            if (i > 0 || ev.fermata) { used.delete(f); return; }
            ev.fermata = readFermata(f);
          });
          nk('dynamics').forEach(d => {
            d.kids.forEach(k => {
              const value = k.name === 'other-dynamics' ? 'other' : k.name;
              if (!DYNAMIC_SET.has(value)) return;
              use(k);
              const dir = { kind: 'dynamic', mi: mi, at: ev.at, staffNo: staffNo, value: value, event: ev, doc: docIndex++ };
              if (value === 'other') dir.text = k.text;
              if (d.attrs.placement === 'above' || d.attrs.placement === 'below') dir.placement = d.attrs.placement;
              part.directions.push(dir);
            });
          });
          nk('slur').forEach(s => {
            const num = s.attrs.number || '1';
            if (s.attrs.type === 'start') {
              if (openSlurs.has(num)) part.slurs.push(openSlurs.get(num));
              const sl = { from: ev, doc: doc };
              if (s.attrs.placement === 'above' || s.attrs.placement === 'below') sl.placement = s.attrs.placement;
              if (['solid', 'dashed', 'dotted'].indexOf(s.attrs['line-type']) >= 0) sl.line = s.attrs['line-type'];
              openSlurs.set(num, sl);
            } else if (s.attrs.type === 'stop') {
              if (openSlurs.has(num)) { const sl = openSlurs.get(num); sl.to = ev; part.slurs.push(sl); openSlurs.delete(num); }
              else part.slurs.push({ to: ev, doc: doc });
            }
          });
          /* glissando and slide: a line from one head to another (v2, G02 §18 S5). A slide is drawn
             continuous and a glissando steps through the scale; MusicXML writes them as two elements.
             Both ends are required, so an unpaired mark is reported and dropped, as a wedge is. */
          ['glissando', 'slide'].forEach(tag => nk(tag).forEach(gl => {
            if (!head) { used.delete(gl); return; }
            const num = tag + '|' + (gl.attrs.number || '1');
            if (gl.attrs.type === 'start') {
              if (openGliss.has(num)) {
                issue('W-IMPORT-UNPAIRED', 'a ' + tag + ' in measure ' + rec.number + ' starts before the previous one stops; the earlier one is dropped');
                drop(tag + ' (unclosed)');
              }
              const g = { from: head, doc: doc, slide: tag === 'slide' };
              const said = gl.text.trim();
              if (said) g.text = said;
              if (['solid', 'dashed', 'dotted', 'wavy'].indexOf(gl.attrs['line-type']) >= 0) g.line = gl.attrs['line-type'];
              if (gl.attrs.placement === 'above' || gl.attrs.placement === 'below') g.placement = gl.attrs.placement;
              openGliss.set(num, g);
            } else if (gl.attrs.type === 'stop') {
              if (openGliss.has(num)) { const g = openGliss.get(num); g.to = head; part.gliss.push(g); openGliss.delete(num); }
              else { issue('W-IMPORT-UNPAIRED', 'a ' + tag + ' stop in measure ' + rec.number + ' has no start; dropped'); drop(tag + ' (stop without start)'); }
            } else used.delete(gl);
          }));
          const vkey = ev.voice.doc;
          nk('tuplet').forEach(t => {
            const num = t.attrs.number || '1';
            if (t.attrs.type === 'start') {
              const stack = openBrackets.get(vkey) || [];
              const br = { events: [], num: num, doc: doc, parent: stack.length ? stack[stack.length - 1] : null, voice: ev.voice };
              if (t.attrs.bracket === 'no') br.bracket = false;
              if (['actual', 'both', 'none'].indexOf(t.attrs['show-number']) >= 0) br.showNumber = t.attrs['show-number'];
              if (t.attrs.placement === 'above' || t.attrs.placement === 'below') br.placement = t.attrs.placement;
              const ta = kid(t, 'tuplet-actual'), tn = kid(t, 'tuplet-normal');
              if (ta && tn) {
                const an = jsInt(txt(ta, 'tuplet-number')), nn = jsInt(txt(tn, 'tuplet-number'));
                if (an >= 1 && nn >= 1) { br.actual = an; br.normal = nn; }
                const tt = txt(tn, 'tuplet-type');
                if (tt && S.NOTE_TYPES.indexOf(tt) >= 0) br.unit = { type: tt };
                const nd = kidsN(tn, 'tuplet-dot').length;
                if (br.unit && nd) br.unit.dots = nd;
                /* the actual side's type and dots describe the same notes (read, not kept) */
                kid(ta, 'tuplet-type'); kidsN(ta, 'tuplet-dot');
              }
              stack.push(br);
              openBrackets.set(vkey, stack);
              part.tuplets.push(br);
            }
          });
          if (!grace && !chordOf(ev, n)) (openBrackets.get(vkey) || []).forEach(br => { if (br.events.indexOf(ev) < 0) br.events.push(ev); });
          nk('tuplet').forEach(t => {
            if (t.attrs.type !== 'stop') return;
            const num = t.attrs.number || '1';
            const stack = openBrackets.get(vkey) || [];
            for (let i = stack.length - 1; i >= 0; i--) {
              if (stack[i].num === num) {
                if (!grace && stack[i].events.indexOf(ev) < 0) stack[i].events.push(ev);
                stack[i].closed = true;
                stack.splice(i, 1);
                break;
              }
            }
          });
          /* beams: primary groups per voice */
          if (ev.beams && !chordOf(ev, n)) {
            const b1 = ev.beams.find(b => b.number === 1);
            if (b1) {
              const cur = openBeams.get(vkey);
              if (b1.value === 'begin') { if (cur) part.beams.push(cur); openBeams.set(vkey, { events: [ev], doc: doc }); }
              else if (b1.value === 'continue') { if (cur) cur.events.push(ev); else openBeams.set(vkey, { events: [ev], doc: doc, orphan: true }); }
              else if (b1.value === 'end') { if (cur) { cur.events.push(ev); part.beams.push(cur); openBeams.delete(vkey); } else part.beams.push({ events: [ev], doc: doc }); }
              else part.beams.push({ events: [ev], doc: doc, hook: b1.value });
            }
          }
          n.kids.filter(k => k.name === 'lyric').forEach(ly => {
            const t = ly.kids.find(k => k.name === 'text');
            if (!t) return;
            use(ly); use(t);
            const l = { text: t.text };
            const verse = jsInt(ly.attrs.number);
            if (verse >= 1) l.verse = verse;
            const syl = txt(ly, 'syllabic');
            if (['single', 'begin', 'middle', 'end'].indexOf(syl) >= 0) l.syllabic = syl;
            if (kid(ly, 'extend')) l.extend = true;
            ev.lyrics.push(l);
          });
        }
        /* a note element that only adds a head to an event the voice already has */
        function chordOf(ev, n) { return !!n.kids.find(k => k.name === 'chord') && ev.heads.length > 1; }

        /* ------------------------------------------------------ directions */
        function readDirection(d) {
          const placement = d.attrs.placement === 'above' || d.attrs.placement === 'below' ? d.attrs.placement : undefined;
          const staffT = txt(d, 'staff');
          const staffNo = staffT != null ? (jsInt(staffT) || 1) : null;
          if (staffNo) part.maxStaff = Math.max(part.maxStaff, staffNo);
          const voiceEl = kid(d, 'voice');
          const at = R.add(cursor, offsetOf(d));
          const doc = docIndex++;
          const types = [];
          d.kids.filter(k => k.name === 'direction-type').forEach(dt => { use(dt); dt.kids.forEach(k => types.push(k)); });
          const snd = kid(d, 'sound');
          const words = types.filter(k => k.name === 'words');
          const metro = types.find(k => k.name === 'metronome');
          let tempo = null;
          const sndTempo = snd ? jsFloatRat(snd.attrs.tempo) : null;
          const base = { mi: mi, at: at, staffNo: staffNo, placement: placement, doc: doc };
          if (voiceEl) base.voiceLabel = voiceEl.text.trim();
          if (metro || (sndTempo && R.sign(sndTempo) > 0)) {
            tempo = Object.assign({ pi: pi }, base);
            if (sndTempo && R.sign(sndTempo) > 0) tempo.qpm = sndTempo;
            if (metro) {
              const units = metro.kids.filter(k => k.name === 'beat-unit');
              const pm = metro.kids.find(k => k.name === 'per-minute');
              if (units.length === 1 && pm && S.NOTE_TYPES.indexOf(units[0].text.trim()) >= 0) {
                use(metro); use(units[0]); use(pm);
                const mark = { unit: units[0].text.trim() };
                const dots = kidsN(metro, 'beat-unit-dot').length;
                if (dots) mark.dots = dots;
                const v = /^\s*\d+(\.\d+)?\s*$/.test(pm.text) ? jsFloatRat(pm.text) : null;
                if (v && R.sign(v) > 0) mark.perMinute = v; else { used.delete(pm); used.delete(metro); }
                if (yes(metro.attrs.parentheses)) mark.parens = true;
                if (used.has(metro)) tempo.mark = mark;
              }
            }
            /* one printed word before the mark (or alone) is the tempo text ("Allegro"); other words stay words */
            if (words.length === 1 && (!metro || types.indexOf(words[0]) < types.indexOf(metro))) {
              use(words[0]);
              tempo.mark = Object.assign(tempo.mark || {}, { text: words[0].text });
              words.length = 0;
            }
            if (tempo.qpm === undefined && tempo.mark === undefined) tempo = null;
            if (tempo) { tempo.doc = docIndex++; tempoDrafts.push(tempo); }
          }
          /* jumps: segno and coda signs, and <sound dacapo|dalsegno|fine|tocoda> */
          types.filter(k => k.name === 'segno' || k.name === 'coda').forEach(k => {
            use(k);
            jumpDrafts.push(Object.assign({ kind: k.name, pi: pi, sign: true }, base, { doc: docIndex++ }));
          });
          if (snd) {
            const jumpKinds = Object.keys(JUMP_SOUND).filter(a => a !== 'segno' && a !== 'coda' && snd.attrs[a] !== undefined && snd.attrs[a] !== 'no');
            jumpKinds.forEach(kind => {
              const j = Object.assign({ kind: kind, pi: pi, value: snd.attrs[kind] }, base, { doc: docIndex++ });
              if (words.length === 1) { use(words[0]); j.text = words[0].text; words.length = 0; }
              jumpDrafts.push(j);
            });
            readSound(snd, at, staffNo, placement, types.some(k => k.name === 'pedal'));
          }
          types.forEach(k => {
            switch (k.name) {
              case 'words':
                if (words.indexOf(k) < 0) return;
                use(k);
                part.directions.push(Object.assign({ kind: 'words', text: k.text }, base, { doc: docIndex++ }));
                break;
              case 'rehearsal':
                use(k);
                part.directions.push(Object.assign({ kind: 'rehearsal', text: k.text }, base, { doc: docIndex++ }));
                break;
              case 'dynamics':
                k.kids.forEach(x => {
                  const value = x.name === 'other-dynamics' ? 'other' : x.name;
                  if (!DYNAMIC_SET.has(value)) return;
                  use(k); use(x);
                  const dd = Object.assign({ kind: 'dynamic', value: value }, base, { doc: docIndex++ });
                  if (value === 'other') dd.text = x.text;
                  part.directions.push(dd);
                });
                break;
              case 'wedge': {
                const num = k.attrs.number || '1';
                if (k.attrs.type === 'crescendo' || k.attrs.type === 'diminuendo') {
                  use(k);
                  if (openWedges.has(num)) { issue('W-IMPORT-UNPAIRED', 'a wedge in measure ' + rec.number + ' starts before the previous one stops; the earlier one is dropped'); drop('wedge (unclosed)'); }
                  const w = { kind: k.attrs.type, from: { mi: mi, at: at }, staffNo: staffNo, placement: placement, doc: doc };
                  if (yes(k.attrs.niente)) w.niente = true;
                  openWedges.set(num, w);
                } else if (k.attrs.type === 'stop') {
                  use(k);
                  const w = openWedges.get(num);
                  if (w) { w.to = { mi: mi, at: at }; part.wedges.push(w); openWedges.delete(num); }
                  else { issue('W-IMPORT-UNPAIRED', 'a wedge stop in measure ' + rec.number + ' has no start; dropped'); drop('wedge (stop without start)'); }
                } else if (k.attrs.type === 'continue') use(k);
                break;
              }
              case 'pedal': {
                const t = k.attrs.type;
                const mark = {};
                if (k.attrs.line === 'yes') mark.line = true;
                if (k.attrs.line === 'no') mark.line = false;
                if (k.attrs.sign === 'no') mark.sign = false;
                const cur = openPedals[openPedals.length - 1];
                if (t === 'start') {
                  use(k);
                  if (cur) part.pedals.push(openPedals.pop());
                  openPedals.push({ pedal: 'damper', from: { mi: mi, at: at }, mark: mark, changes: [], doc: doc });
                } else if (t === 'change') {
                  use(k);
                  if (cur) cur.changes.push({ mi: mi, at: at });
                  else openPedals.push({ pedal: 'damper', from: { mi: mi, at: at }, mark: mark, changes: [], doc: doc, startedByChange: true });
                } else if (t === 'stop') {
                  use(k);
                  if (cur) { cur.to = { mi: mi, at: at }; part.pedals.push(openPedals.pop()); }
                  else { issue('W-IMPORT-UNPAIRED', 'a pedal release in measure ' + rec.number + ' has no press; dropped'); drop('pedal (stop without start)'); }
                } else if (t === 'continue') use(k);
                break;
              }
              case 'octave-shift': {
                const t = k.attrs.type, num = k.attrs.number || '1';
                const size = jsInt(k.attrs.size) || 8;
                const key = num + '|' + (staffNo || 1);
                if (t === 'up' || t === 'down') {
                  use(k);
                  const oct = size >= 22 ? 3 : size >= 15 ? 2 : 1;
                  if (openOttavas.has(key)) { issue('W-IMPORT-UNPAIRED', 'an octave shift in measure ' + rec.number + ' starts before the previous one stops; the earlier one is dropped'); drop('octave-shift (unclosed)'); }
                  openOttavas.set(key, { shift: t === 'down' ? oct : -oct, size: size, from: { mi: mi, at: at }, staffNo: staffNo || 1, doc: doc });
                } else if (t === 'stop') {
                  use(k);
                  const o = openOttavas.get(key);
                  if (o) { o.to = { mi: mi, at: at }; part.ottavas.push(o); openOttavas.delete(key); }
                  else { issue('W-IMPORT-UNPAIRED', 'an octave-shift stop in measure ' + rec.number + ' has no start; dropped'); drop('octave-shift (stop without start)'); }
                } else if (t === 'continue') use(k);
                break;
              }
              default: break;
            }
          });
        }
        function readHarmony(h) {
          const rootEl = kid(h, 'root'), kindEl = kid(h, 'kind');
          const step = rootEl ? txt(rootEl, 'root-step') : undefined;
          if (!rootEl || S.STEPS.indexOf(step) < 0 || !kindEl) { used.delete(h); return; }
          const at = R.add(cursor, offsetOf(h));
          const dir = { kind: 'chord', mi: mi, at: at, root: { step: step }, chordKind: kindEl.text.trim(), doc: docIndex++ };
          const ra = jsInt(txt(rootEl, 'root-alter'));
          if (ra) dir.root.alter = ra;
          if (kindEl.attrs.text !== undefined) dir.text = kindEl.attrs.text;
          const bassEl = kid(h, 'bass');
          if (bassEl) {
            const bs = txt(bassEl, 'bass-step');
            if (S.STEPS.indexOf(bs) >= 0) {
              dir.bass = { step: bs };
              const ba = jsInt(txt(bassEl, 'bass-alter'));
              if (ba) dir.bass.alter = ba;
            }
          }
          const degrees = kidsN(h, 'degree').map(dg => ({ value: jsInt(txt(dg, 'degree-value')), alter: jsInt(txt(dg, 'degree-alter')) || 0,
            type: txt(dg, 'degree-type') })).filter(x => x.value >= 1 && ['add', 'alter', 'subtract'].indexOf(x.type) >= 0);
          if (degrees.length) dir.degrees = degrees;
          const st = txt(h, 'staff');
          dir.staffNo = st != null ? (jsInt(st) || 1) : null;
          if (h.attrs.placement === 'above' || h.attrs.placement === 'below') dir.placement = h.attrs.placement;
          part.directions.push(dir);
        }
        /* <sound>: tempo (measure-level only; a direction's tempo is read with its mark), pedals, and the
           attributes the graph does not keep (reported) */
        function readSound(s, at, staffNo, placement, printedPedal) {
          Object.keys(s.attrs).forEach(a => { if (!SOUND_MAPPED.has(a)) drop('sound@' + a); });
          if (staffNo === null && placement === null && s.attrs.tempo !== undefined) {
            const q = jsFloatRat(s.attrs.tempo);
            if (q && R.sign(q) > 0) tempoDrafts.push({ pi: pi, mi: mi, at: at, qpm: q, doc: docIndex++ });
          }
          if (staffNo === null && placement === null) {
            Object.keys(JUMP_SOUND).forEach(k => {
              if (k === 'segno' || k === 'coda' || s.attrs[k] === undefined || s.attrs[k] === 'no') return;
              jumpDrafts.push({ kind: k, pi: pi, mi: mi, at: at, value: s.attrs[k], bare: true, doc: docIndex++ });
            });
          }
          if (!printedPedal) {
            ['damper-pedal', 'soft-pedal', 'sostenuto-pedal'].forEach(a => {
              if (s.attrs[a] === undefined) return;
              const kind = a === 'damper-pedal' ? 'damper' : a === 'soft-pedal' ? 'soft' : 'sostenuto';
              const on = s.attrs[a] !== 'no' && s.attrs[a] !== '0';
              const cur = openPedals.find(p => p.pedal === kind && p.soundOnly);
              if (on) {
                if (cur) { part.pedals.push(cur); openPedals.splice(openPedals.indexOf(cur), 1); }
                const p = { pedal: kind, from: { mi: mi, at: at }, soundOnly: true, changes: [], doc: docIndex++ };
                const v = jsInt(s.attrs[a]);
                if (v >= 1 && v <= 127 && s.attrs[a] !== 'yes') p.depth = v;
                openPedals.push(p);
              } else if (cur) { cur.to = { mi: mi, at: at }; part.pedals.push(cur); openPedals.splice(openPedals.indexOf(cur), 1); }
            });
          }
        }

        /* ---------------------------------------------------------- barlines */
        function readBarline(b) {
          const loc = b.attrs.location || 'right';
          if (loc !== 'left' && loc !== 'right') { used.delete(b); return; }
          const out = {};
          const style = txt(b, 'bar-style');
          if (style && S.BAR_STYLES.indexOf(style) >= 0) out.style = style;
          const rep = kid(b, 'repeat');
          if (rep) {
            out.repeat = rep.attrs.direction === 'forward' ? 'forward' : 'backward';
            if (out.repeat === 'backward' && rep.attrs.times !== undefined) { const t = jsInt(rep.attrs.times); if (t >= 2) out.times = t; }
          }
          /* a pause written over the bar line itself: the first one, the way an event keeps its first (v2) */
          const bf = kid(b, 'fermata');
          if (bf) out.fermata = readFermata(bf);
          const end = kid(b, 'ending');
          if (pi !== 0) return;       /* the timeline's bar lines come from the first part */
          let target = loc;
          if (out.repeat === 'forward' && loc === 'right') {
            issue('W-IMPORT-REPEAT-MOVED', 'a forward repeat on the right of measure ' + rec.number + ' moves to the left of the next measure');
            rec.moveForward = true;
            delete out.repeat;
          }
          rec.barline[target] = Object.assign(rec.barline[target] || {}, out);
          if (end) {
            const said = end.text.trim();
            const nums = parseEndingNumbers(end.attrs.number, said);
            /* the same bracket stated twice in one measure (duplicated bar lines) is one bracket */
            const same = x => JSON.stringify(x.numbers) === JSON.stringify(nums.length ? nums : [1]);
            if (end.attrs.type === 'start' && endingDrafts.some(x => x.fromMi === mi && same(x))) return;
            if ((end.attrs.type === 'stop' || end.attrs.type === 'discontinue') && !endingDrafts.some(x => x.toMi === undefined) &&
                endingDrafts.some(x => x.toMi === mi && same(x))) return;
            if (end.attrs.type === 'start') {
              const open = endingDrafts.find(x => x.toMi === undefined);
              if (open) open.toMi = mi - 1 >= open.fromMi ? mi - 1 : open.fromMi;
              const en = { numbers: nums.length ? nums : [1], fromMi: mi, doc: docIndex++ };
              if (said) en.text = said;
              endingDrafts.push(en);
            } else if (end.attrs.type === 'stop' || end.attrs.type === 'discontinue') {
              const open = endingDrafts.filter(x => x.toMi === undefined).pop();
              if (open) { open.toMi = mi; if (end.attrs.type === 'discontinue') open.open = true; }
              else { issue('W-IMPORT-UNPAIRED', 'an ending stop in measure ' + rec.number + ' has no start; dropped'); drop('ending (stop without start)'); }
            }
          }
        }
      });
      /* close what the part left open */
      openSlurs.forEach(sl => part.slurs.push(sl));
      openWedges.forEach(() => { issue('W-IMPORT-UNPAIRED', 'a wedge never stops; dropped'); drop('wedge (unclosed)'); });
      openGliss.forEach((g, k) => { issue('W-IMPORT-UNPAIRED', 'a ' + k.split('|')[0] + ' never stops; dropped'); drop(k.split('|')[0] + ' (unclosed)'); });
      openPedals.forEach(p => part.pedals.push(p));
      openOttavas.forEach(() => { issue('W-IMPORT-UNPAIRED', 'an octave shift never stops; dropped'); drop('octave-shift (unclosed)'); });
      openBeams.forEach(b => part.beams.push(b));
    });
    endingDrafts.forEach(en => { if (en.toMi === undefined) en.toMi = timeline.length - 1; });
    timeline.forEach((rec, mi) => {
      if (rec.moveForward && timeline[mi + 1]) {
        const next = timeline[mi + 1];
        next.barline.left = Object.assign(next.barline.left || {}, { repeat: 'forward' });
      }
    });

    /* ------------------------------------------------------ measure lengths */
    /* A file with no time signature anywhere is still a score (a cadenza, chant, a fragment). Assume
       what every notation program assumes, say so, and print nothing (G02 6.3, A8). */
    if (!meterAt[0]) {
      issue('W-IMPORT-METER-ASSUMED', 'the score states no time signature; 4/4 is assumed and not printed');
      meterAt[0] = { beats: [4], beatType: 4, hidden: true, assumed: true };
    }
    let meter = null;
    const durs = timeline.map((rec, mi) => {
      if (meterAt[mi]) meter = meterAt[mi];
      const nom = R.make(meter.beats.reduce((s, x) => s + x, 0), meter.beatType);
      if (rec.implicit && R.sign(rec.content) > 0) return rec.content;
      return R.max(nom, rec.content);
    });

    /* ------------------------------------------------------ build the graph */
    const b = B.builder({ id: opts.scoreId || 'sg-import', meta: meta });
    const srcDraft = { kind: opts.container === 'mxl' ? 'mxl' : 'musicxml' };
    if (software) srcDraft.tool = software;
    if (opts.sourceName || opts.sourceSha256) {
      srcDraft.input = {};
      if (opts.sourceName) srcDraft.input.name = opts.sourceName;
      if (opts.sourceSha256) srcDraft.input.sha256 = opts.sourceSha256;
    }
    const src = b.source(srcDraft);
    b.setDefault({ src: src.id, op: 'imported' });

    /* parts */
    const sgParts = parts.map(part => {
      const info = part.info;
      const nStaves = Math.max(part.staves, part.maxStaff);
      const name = (info.name || '') + ' ' + (info.instrumentName || '');
      const piano = !part.hasPerc && (/piano|pno|klavier|keyboard/i.test(name) || nStaves >= 2);
      const drums = part.hasPerc && /drum|kit|set/i.test(name + ' ' + (info.instrumentName || ''));
      const instrument = part.hasPerc
        ? { kind: drums ? 'drumset' : 'percussion', family: 'percussion' }
        : { kind: piano ? 'piano' : 'unknown', family: piano ? 'keyboard' : 'other' };
      if (part.hasPerc) instrument.kit = { items: buildKit(part, info) };
      if (info.instrumentName) instrument.name = info.instrumentName;
      if (info.midi && Object.keys(info.midi).length) instrument.midi = info.midi;
      if (part.transpose) instrument.transpose = part.transpose;
      const p = b.part({ instrument: instrument });
      if (info.name) p.name = info.name;
      if (info.abbr) p.abbr = info.abbr;
      part.sg = p;
      part.nStaves = nStaves;
      return p;
    });
    /* staves, then voices (§12.2) */
    parts.forEach(part => {
      part.staffIds = [];
      for (let s = 1; s <= part.nStaves; s++) {
        const st = { };
        if (part.sg.instrument.family === 'percussion') st.kind = 'percussion';
        if (part.sg.instrument.kind === 'piano' && part.nStaves === 2) st.limb = s === 1 ? 'RH' : 'LH';
        part.staffIds.push(b.staff(part.sg, st).id);
      }
    });
    parts.forEach(part => {
      part.voices.forEach(v => {
        const x = { staff: part.staffIds[(v.homeStaff || 1) - 1] };
        if (v.label !== undefined) x.label = v.label;
        v.id = b.voice(part.sg, x).id;
      });
    });
    /* The kit a percussion part plays (G02 §17). One item per thing struck, named by the file's
       <score-instrument> where a note points at one and by where it sits on the staff where it does
       not. Each perc head is stamped with its key here, so nothing is inferred later. */
    function buildKit(part, info) {
      const byKey = new Map();
      const keyOfInst = new Map();
      const heads = [];
      part.events.forEach(e => e.heads.forEach(h => { if (h.perc) heads.push(h); }));
      const unique = base => {
        let k = base || 'item', n = 2;
        while (byKey.has(k) && byKey.get(k).from !== base) { k = base + '-' + n; n++; }
        return k;
      };
      heads.forEach(h => {
        const named = h.instId != null && info.instruments && info.instruments.get(h.instId);
        let key = keyOfInst.get(h.instId);
        if (key === undefined) {
          const base = named ? kitKey(named.name) || kitKey(h.instId) : '';
          key = unique(base || 'pos-' + h.pos.step.toLowerCase() + h.pos.oct);
          if (h.instId != null) keyOfInst.set(h.instId, key);
        }
        h.kitKey = key;
        if (!byKey.has(key)) {
          const item = { key: key, pos: h.pos, from: named ? kitKey(named.name) : '' };
          if (named && named.name) item.name = named.name;
          if (named && named.gm >= 27 && named.gm <= 87) item.gm = named.gm;
          if (h.notehead && h.notehead.shape) item.notehead = h.notehead.shape;
          byKey.set(key, item);
        }
      });
      if (!byKey.size) {
        issue('W-IMPORT-PERC-KIT', 'a percussion part with no struck note keeps an empty kit placeholder');
        byKey.set('unknown', { key: 'unknown', pos: { step: 'C', oct: 5 }, from: '' });
      }
      return Array.from(byKey.values()).map(it => { const o = Object.assign({}, it); delete o.from; return o; });
    }

    const staffId = (part, no) => part.staffIds[(no || 1) - 1];
    const mid = [];
    const at = x => R.format(x);
    timeline.forEach((rec, mi) => {
      const m = { number: rec.number, dur: R.format(durs[mi]) };
      if (rec.implicit) m.implicit = true;
      if (rec.multiRest >= 2) m.multiRest = rec.multiRest;
      /* the metre the graph cannot state: music written without one, and the 4/4 we put there instead */
      if (meterAt[mi] && (meterAt[mi].senza || meterAt[mi].assumed))
        m.ext = Object.assign({}, m.ext, { 'musicxml.no-metre': { reason: meterAt[mi].senza ? 'senza-misura' : 'absent' } });
      const bl = {};
      ['left', 'right'].forEach(side => { if (rec.barline[side] && Object.keys(rec.barline[side]).length) bl[side] = rec.barline[side]; });
      if (Object.keys(bl).length) m.barline = bl;
      const layout = {};
      if (rec.newSystem) layout.newSystem = true;
      if (rec.newPage) layout.newPage = true;
      if (rec.width !== undefined) layout.width = rec.width;
      if (Object.keys(layout).length) m.layout = layout;
      mid.push(b.measure(m).id);
    });
    /* meters, keys, tempos, endings, jumps */
    meterAt.forEach((mt, mi) => {
      if (!mt) return;
      const x = { m: mid[mi], beats: mt.beats, beatType: mt.beatType };
      if (mt.symbol && ['common', 'cut', 'single-number', 'normal'].indexOf(mt.symbol) >= 0) x.symbol = mt.symbol;
      if (mt.hidden) x.hidden = true;
      b.meter(x);
    });
    /* keys: one per (position, content) that every part states; part- or staff-scoped otherwise */
    const keyGroups = new Map();
    keyDrafts.forEach(k => {
      const part = parts[k.pi];
      k.fifths = P.concertFifths(k.written, part.transpose);
      if (k.fifths < -7 || k.fifths > 7) return;
      const gk = [k.mi, R.format(k.at), k.staffNo == null ? '' : k.staffNo, k.fifths, k.mode || '', k.hidden ? 1 : 0].join('|');
      if (!keyGroups.has(gk)) keyGroups.set(gk, []);
      keyGroups.get(gk).push(k);
    });
    Array.from(keyGroups.values()).sort((x, y) => x[0].mi - y[0].mi || R.cmp(x[0].at, y[0].at) || x[0].doc - y[0].doc).forEach(list => {
      const k0 = list[0];
      const partsHaving = new Set(list.map(k => k.pi));
      const base = { m: mid[k0.mi], at: at(k0.at), fifths: k0.fifths };
      if (k0.mode && S.MODES.indexOf(k0.mode) >= 0) base.mode = k0.mode;
      if (k0.hidden) base.hidden = true;
      if (k0.staffNo == null && partsHaving.size === parts.length) { b.key(base); return; }
      Array.from(partsHaving).sort((a, c) => a - c).forEach(pi => {
        const part = parts[pi];
        const x = Object.assign({}, base, { scope: { part: part.sg.id } });
        if (k0.staffNo != null) x.scope.staff = staffId(part, k0.staffNo);
        b.key(x);
      });
    });
    /* tempos: one per position and content; the parts that print it are its display */
    const tempoGroups = new Map();
    tempoDrafts.forEach(t => {
      const gk = [t.mi, R.format(t.at), t.qpm ? R.format(t.qpm) : '', JSON.stringify(t.mark ? Object.assign({}, t.mark, { perMinute: t.mark.perMinute ? R.format(t.mark.perMinute) : undefined }) : null)].join('|');
      if (!tempoGroups.has(gk)) tempoGroups.set(gk, []);
      tempoGroups.get(gk).push(t);
    });
    Array.from(tempoGroups.values()).sort((x, y) => x[0].mi - y[0].mi || R.cmp(x[0].at, y[0].at) || x[0].doc - y[0].doc).forEach(list => {
      const t0 = list[0];
      const x = { m: mid[t0.mi], at: at(t0.at) };
      if (t0.qpm) x.qpm = R.format(t0.qpm);
      if (t0.mark) {
        x.mark = {};
        ['unit', 'dots'].forEach(k => { if (t0.mark[k] !== undefined) x.mark[k] = t0.mark[k]; });
        if (t0.mark.perMinute) x.mark.perMinute = R.format(t0.mark.perMinute);
        if (t0.mark.text !== undefined) x.mark.text = t0.mark.text;
        if (t0.mark.parens) x.mark.parens = true;
      }
      x.display = list.map(t => {
        const part = parts[t.pi];
        const d = { part: part.sg.id };
        if (t.staffNo) d.staff = staffId(part, t.staffNo);
        if (t.placement) d.placement = t.placement;
        return d;
      });
      b.tempo(x);
    });
    endingDrafts.slice().sort((x, y) => x.fromMi - y.fromMi || x.doc - y.doc).forEach(en => {
      const x = { numbers: en.numbers, from: mid[en.fromMi], to: mid[en.toMi] };
      if (en.text !== undefined) x.text = en.text;
      if (en.open) x.open = true;
      b.ending(x);
    });
    jumpDrafts.slice().sort((x, y) => x.mi - y.mi || R.cmp(x.at, y.at) || x.doc - y.doc).forEach(j => {
      const x = { kind: j.kind, m: mid[j.mi], at: at(j.at) };
      if (j.text !== undefined) x.text = j.text;
      const part = parts[j.pi];
      const d = { part: part.sg.id };
      if (j.staffNo) d.staff = staffId(part, j.staffNo);
      if (j.placement) d.placement = j.placement;
      x.display = [d];
      b.jump(x);
    });
    /* clefs */
    /* IDs follow each category's musical order (document order breaks ties), which an export keeps: the same
       graph comes back from its own MusicXML with the same IDs (L2) */
    const byKey = (...keys) => (a, c) => { for (const k of keys) { const x = k(a), y = k(c); const r = typeof x === 'object' ? R.cmp(x, y) : x - y; if (r) return r; } return a.doc - c.doc; };
    /* clefs at one position keep their document order: the app lists clefs in document order */
    parts.forEach(part => part.clefs.slice().sort(byKey(c => c.mi, c => c.at)).forEach(c => {
      const x = { staff: staffId(part, c.staffNo), m: mid[c.mi], at: at(c.at), sign: c.sign };
      if (c.line !== undefined) x.line = c.line;
      if (c.octave) x.octave = c.octave;
      b.clef(part.sg, x);
    }));
    /* events and heads, in document order */
    const STEP_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
    parts.forEach(part => {
      const vIndex = new Map(part.voices.map((v, i) => [v, i]));
      /* a chord's heads read low to high; a percussion head has no pitch, so it sorts by where it sits */
      const low = h => (h.perc ? h.pos.oct * 7 + STEP_ORDER[h.pos.step] : P.midi(h.pitch));
      const step = h => STEP_ORDER[(h.perc ? h.pos : h.pitch).step];
      part.events.forEach(e => e.heads.sort((a, c) => low(a) - low(c) || step(a) - step(c) || a.doc - c.doc));
      part.events.sort(byKey(e => e.mi, e => vIndex.get(e.voice), e => e.at, e => (e.grace ? 0 : 1), e => (e.graceInfo ? e.graceInfo.order : 0)));
    });
    parts.forEach(part => part.events.forEach(e => {
      const x = { kind: e.kind, m: mid[e.mi], at: at(e.at), dur: R.format(e.dur), voice: e.voice.id, staff: staffId(part, e.staffNo) };
      if (e.hidden) x.hidden = true;
      if (e.grace) x.grace = e.graceInfo;
      if (e.cue) x.cue = true;
      if (Object.keys(e.display).length) x.display = e.display;
      if (e.kind === 'note' || e.kind === 'perc') {
        x.heads = e.heads.map(h => {
          if (h.perc) {
            const hp = { inst: h.kitKey, pos: h.pos };
            if (h.notehead) hp.notehead = h.notehead;
            return hp;
          }
          const hx = { pitch: h.pitch };
          if (h.staffNo !== e.staffNo) hx.staff = staffId(part, h.staffNo);
          if (h.acc) hx.acc = h.acc;
          if (h.notehead) hx.notehead = h.notehead;
          if (h.fingering) hx.fingering = h.fingering;
          if (h.tech) hx.tech = h.tech;
          if (h.ext) hx.ext = h.ext;
          return hx;
        });
      }
      if (e.arts.length) x.arts = e.arts;
      if (e.orn.length) x.orn = e.orn;
      if (e.fermata) x.fermata = e.fermata;
      if (e.lyrics.length) x.lyrics = e.lyrics;
      const sg = b.event(part.sg, x);
      e.id = sg.id;
      e.heads.forEach((h, i) => { h.id = sg.heads[i].id; });
    }));
    /* directions */
    parts.forEach(part => part.directions.slice().sort(byKey(d => d.mi, d => d.at, d => d.staffNo || 0, d => (d.event ? 1 : 0))).forEach(d => {
      const x = { kind: d.kind, m: mid[d.mi], at: at(d.at) };
      if (d.staffNo) x.staff = staffId(part, d.staffNo);
      if (d.voiceLabel !== undefined) {
        const v = part.voices.find(vv => vv.label === d.voiceLabel);
        if (v) x.voice = v.id;
      }
      if (d.event) x.event = d.event.id;
      if (d.placement) x.placement = d.placement;
      if (d.kind === 'dynamic') { x.value = d.value; if (d.text !== undefined) x.text = d.text; }
      if (d.kind === 'words' || d.kind === 'rehearsal') x.text = d.text;
      if (d.kind === 'chord') {
        x.root = d.root; x.chordKind = d.chordKind;
        if (d.bass) x.bass = d.bass;
        if (d.degrees) x.degrees = d.degrees;
        if (d.text !== undefined) x.text = d.text;
      }
      b.direction(part.sg, x);
    }));

    /* spanners: ties, tuplets, beams, slurs, arpeggios, wedges, pedals, ottavas — in start order */
    const posOf = (mi, a) => R.add(starts[mi], a);
    const starts = [];
    durs.reduce((acc, d, i) => { starts[i] = acc; return R.add(acc, d); }, R.ZERO);
    const midi = h => P.midi(h.pitch);
    parts.forEach(part => {
      const drafts = [];
      /* ties: a start pairs with a stop of the same pitch whose event begins where the start's event ends */
      const heads = [];
      part.events.forEach(e => e.heads.forEach(h => heads.push(h)));
      const stops = heads.filter(h => h.tieStop);
      const taken = new Set();
      heads.filter(h => h.tieStart).forEach(h => {
        const e = h.event;
        const end = R.add(posOf(e.mi, e.at), e.dur);
        const cands = stops.filter(s => !taken.has(s) && s.event !== e && midi(s) === midi(h) &&
          R.eq(posOf(s.event.mi, s.event.at), end));
        const pick = cands.find(s => s.event.voice === e.voice) || cands.find(s => s.staffNo === h.staffNo) || cands[0];
        const d = { type: 'tie', doc: h.doc, pos: posOf(e.mi, e.at), anchor: S.idNumber(h.id), x: { type: 'tie', from: h.id } };
        if (pick) { taken.add(pick); d.x.to = pick.id; }
        drafts.push(d);
      });
      stops.filter(s => !taken.has(s)).forEach(s => drafts.push({ type: 'tie', doc: s.doc, pos: posOf(s.event.mi, s.event.at), anchor: S.idNumber(s.id), x: { type: 'tie', to: s.id } }));
      const evPos = e => posOf(e.mi, e.at);
      /* tuplets: printed brackets, then unbracketed time-modification runs */
      const bracketed = new Set();
      part.tuplets.forEach(br => {
        br.events = br.events.filter(e => !e.grace);
        br.events.forEach(e => bracketed.add(e));
      });
      part.tuplets.forEach(br => {
        if (!br.events.length) { drop('tuplet (no notes)'); br.dead = true; return; }
        const tm = br.events[0].tm;
        let actual = br.actual, normal = br.normal;
        if (!actual) {
          if (!tm) { actual = 1; normal = 1; }
          else if (br.parent && !br.parent.dead) {
            const pa = br.parent.actual || (br.parent.events[0].tm || {}).actual, pn = br.parent.normal || (br.parent.events[0].tm || {}).normal;
            if (pa && pn && tm.actual % pa === 0 && tm.normal % pn === 0) { actual = tm.actual / pa; normal = tm.normal / pn; }
            else { actual = tm.actual; normal = tm.normal; }
          } else { actual = tm.actual; normal = tm.normal; }
        }
        br.actual = actual; br.normal = normal;
        if (!br.unit && tm && tm.normalType) { br.unit = { type: tm.normalType }; if (tm.normalDots) br.unit.dots = tm.normalDots; }
      });
      const runs = [];
      const byVoice = new Map();
      part.events.forEach(e => {
        if (e.grace || bracketed.has(e)) return;
        if (!byVoice.has(e.voice)) byVoice.set(e.voice, []);
        byVoice.get(e.voice).push(e);
      });
      byVoice.forEach(list => {
        let run = null;
        const close = () => { if (run) runs.push(run); run = null; };
        list.forEach(e => {
          if (!e.tm || e.tm.actual === e.tm.normal) { close(); return; }
          if (run && (run.actual !== e.tm.actual || run.normal !== e.tm.normal || !R.eq(run.end, posOf(e.mi, e.at)))) close();
          if (!run) {
            run = { events: [], actual: e.tm.actual, normal: e.tm.normal, printed: false, sum: R.ZERO, doc: e.doc };
            if (e.tm.normalType) { run.unit = { type: e.tm.normalType }; if (e.tm.normalDots) run.unit.dots = e.tm.normalDots; }
            const unitV = run.unit ? S.noteValue(run.unit.type, run.unit.dots) : (e.display.type ? S.noteValue(e.display.type, e.display.dots) : null);
            run.full = unitV ? R.mul(R.make(run.normal), unitV) : null;
          }
          run.events.push(e);
          run.sum = R.add(run.sum, e.dur);
          run.end = R.add(posOf(e.mi, e.at), e.dur);
          if (run.full && R.ge(run.sum, run.full)) close();
        });
        close();
      });
      part.tuplets.filter(br => !br.dead).forEach(br => {
        const x = { type: 'tuplet', events: br.events.map(e => e.id), actual: br.actual, normal: br.normal };
        if (br.unit) x.unit = br.unit;
        const show = {};
        if (br.showNumber) show.number = br.showNumber;
        if (br.bracket === false) show.bracket = false;
        if (br.placement) show.placement = br.placement;
        if (Object.keys(show).length) x.show = show;
        br.draft = { type: 'tuplet', doc: br.doc, depth: depthOf(br), pos: evPos(br.events[0]), anchor: S.idNumber(br.events[0].id), x: x, br: br };
        drafts.push(br.draft);
      });
      function depthOf(br) { let d = 0, p = br.parent; while (p) { d++; p = p.parent; } return d; }
      runs.forEach(run => {
        const x = { type: 'tuplet', events: run.events.map(e => e.id), actual: run.actual, normal: run.normal, printed: false };
        if (run.unit) x.unit = run.unit;
        drafts.push({ type: 'tuplet', doc: run.doc, depth: 0, pos: evPos(run.events[0]), anchor: S.idNumber(run.events[0].id), x: x });
      });
      /* beams: primary groups; breaks where a secondary level is not continued */
      part.beams.forEach(bm => {
        if (bm.events.length < 2) { drop('beam (' + (bm.hook || 'one note') + ')'); return; }
        const x = { type: 'beam', events: bm.events.map(e => e.id) };
        const breaks = [];
        for (let i = 0; i + 1 < bm.events.length; i++) {
          const a = bm.events[i], c = bm.events[i + 1];
          const top = Math.min(BEAM_LEVELS[a.display.type] || 1, BEAM_LEVELS[c.display.type] || 1);
          for (let L = 2; L <= top; L++) {
            const va = ((a.beams || []).find(y => y.number === L) || {}).value;
            const vc = ((c.beams || []).find(y => y.number === L) || {}).value;
            const joined = (va === 'begin' || va === 'continue') && (vc === 'continue' || vc === 'end');
            if (!joined) { breaks.push({ after: a.id, level: L }); break; }
          }
        }
        if (breaks.length) x.breaks = breaks;
        /* a source that writes fewer beam levels than the note values imply (only the primary beam, say) keeps them
           that way: registered ext namespace musicxml.beam (scoregraph/README.md) */
        const written = Math.max.apply(null, bm.events.map(e => Math.max.apply(null, (e.beams || []).map(y => y.number).concat([1]))));
        const implied = Math.max.apply(null, bm.events.map(e => BEAM_LEVELS[e.display.type] || 1));
        if (written < implied) x.ext = { 'musicxml.beam': { levels: written } };
        drafts.push({ type: 'beam', doc: bm.doc, pos: evPos(bm.events[0]), anchor: S.idNumber(bm.events[0].id), x: x });
      });
      /* slurs */
      part.slurs.forEach(sl => {
        const x = { type: 'slur' };
        if (sl.from) x.from = sl.from.id;
        if (sl.to) x.to = sl.to.id;
        if (sl.placement) x.placement = sl.placement;
        if (sl.line) x.line = sl.line;
        const e0 = sl.from || sl.to;
        drafts.push({ type: 'slur', doc: sl.doc, pos: evPos(e0), anchor: S.idNumber(e0.id), x: x });
      });
      /* glissandi and slides: both ends are heads */
      part.gliss.forEach(g => {
        const x = { type: 'gliss', from: g.from.id, to: g.to.id };
        if (g.slide) x.slide = true;
        if (g.line) x.line = g.line;
        if (g.text) x.text = g.text;
        if (g.placement) x.placement = g.placement;
        drafts.push({ type: 'gliss', doc: g.doc, pos: evPos(g.from.event), anchor: S.idNumber(g.from.id), x: x });
      });
      /* arpeggios: the marked heads at one onset (and number) */
      const arpGroups = new Map();
      part.arps.forEach(a => {
        const e = a.head.event;
        const key = R.format(posOf(e.mi, e.at)) + '|' + (a.number || '') + '|' + (a.non ? 'non' : 'arp');
        if (!arpGroups.has(key)) arpGroups.set(key, []);
        arpGroups.get(key).push(a);
      });
      arpGroups.forEach(list => {
        if (list.length < 2) { drop(list[0].non ? 'non-arpeggiate (one note)' : 'arpeggiate (one note)'); return; }
        const x = { type: 'arpeggio', heads: list.map(a => a.head.id) };
        const dir = list.find(a => a.dir === 'up' || a.dir === 'down');
        if (dir) x.dir = dir.dir;
        if (list[0].non) x.non = true;
        drafts.push({ type: 'arpeggio', doc: list[0].doc, pos: evPos(list[0].head.event), anchor: S.idNumber(list[0].head.id), x: x });
      });
      const pos = p => ({ m: mid[p.mi], at: at(p.at) });
      part.wedges.forEach(w => {
        const x = { type: 'wedge', kind: w.kind, from: pos(w.from), to: pos(w.to) };
        if (w.staffNo) x.staff = staffId(part, w.staffNo);
        if (w.placement) x.placement = w.placement;
        if (w.niente) x.niente = true;
        drafts.push({ type: 'wedge', doc: w.doc, pos: posOf(w.from.mi, w.from.at), anchor: w.staffNo || 0, x: x });
      });
      part.pedals.forEach(p => {
        const x = { type: 'pedal', pedal: p.pedal, from: pos(p.from) };
        if (p.to) x.to = pos(p.to);
        if (p.changes.length) x.changes = p.changes.map(pos);
        if (p.mark && Object.keys(p.mark).length) x.mark = p.mark;
        if (p.soundOnly) x.soundOnly = true;
        if (p.depth) x.depth = p.depth;
        drafts.push({ type: 'pedal', doc: p.doc, pos: posOf(p.from.mi, p.from.at), anchor: 0, x: x });
      });
      part.ottavas.forEach(o => {
        drafts.push({ type: 'ottava', doc: o.doc, pos: posOf(o.from.mi, o.from.at), anchor: o.staffNo, x: { type: 'ottava', staff: staffId(part, o.staffNo), shift: o.shift, from: pos(o.from), to: pos(o.to) } });
      });
      drafts.sort((p, q) => R.cmp(p.pos, q.pos) || SPANNER_SUBORDER[p.type] - SPANNER_SUBORDER[q.type] || p.anchor - q.anchor ||
        (p.depth || 0) - (q.depth || 0) || p.doc - q.doc);
      /* IDs first (a nested tuplet names its parent), then the parent links */
      drafts.forEach(d => { d.x.id = b.id('s'); if (d.br) d.br.sid = d.x.id; });
      drafts.forEach(d => { if (d.br && d.br.parent && d.br.parent.sid) d.x.parent = d.br.parent.sid; b.spanner(part.sg, d.x); });
    });

    /* what nothing read */
    (function count(el) {
      el.kids.forEach(k => { if (used.has(k)) count(k); else drop(k.name); });
    })(root);

    return b.finish().graph;
  }

  function parseEndingNumbers(attr, text) {
    const nums = s => (s || '').split(/[^0-9]+/).filter(x => x && Number(x) > 0).map(Number);
    return nums(attr).length ? nums(attr) : nums(text);
  }

  return Object.freeze({ importMusicXml, CODES, REPORT_CODES, jsFloatRat });
});
