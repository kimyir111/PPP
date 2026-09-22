/* ============================================================================
   PPP ScoreGraph — validator (docs/GOALS/G01 §13)

   validate(graph) -> {ok, issues}. ok means no ERROR. Issues are
   {code, severity, message, ids?, at?}, sorted by severity, code, first ID
   number, message: the same graph always gives the same list (A8).

   Four passes. An entity with a structural problem is kept out of the later
   rules, so one defect is reported once, under its own code:
     1. shape    every field against schema.js (E-SHAPE, E-ID-FORMAT,
                 E-RATIONAL, and the codes the spec gives to ranges)
     2. IDs      E-ID-DUPLICATE, E-ID-COUNTER
     3. refs     E-REF-MISSING, E-REF-SCOPE, E-VOICE-STAFF, E-PROV
     4. rules    time, voices, ties, tuplets, timeline, performance, and the
                 WARNING and INFO rules

   The validator never changes the graph and never repairs anything (DP6).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./time.js'), require('./pitch.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.validate = factory(M.rational, M.schema, M.time, M.pitch); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, T, P) {
  'use strict';

  const ERRORS = ['E-VERSION', 'E-SHAPE', 'E-ID-FORMAT', 'E-ID-DUPLICATE', 'E-ID-COUNTER', 'E-REF-MISSING', 'E-REF-SCOPE',
    'E-RATIONAL', 'E-DURATION', 'E-POSITION', 'E-SPAN-ORDER', 'E-MEASURE-OVERFLOW', 'E-VOICE-OVERLAP', 'E-VOICE-STAFF',
    'E-HEADS', 'E-TIE-PITCH', 'E-TIE-TIME', 'E-TIE-CHAIN', 'E-TUPLET', 'E-METER', 'E-KEY', 'E-TEMPO', 'E-ENDING',
    'E-REPEAT', 'E-UNROLL-RUNAWAY', 'E-ARPEGGIO', 'E-PERC-KIT', 'E-PITCH-RANGE', 'E-STRUCTURE', 'E-PERF', 'E-PROV'];
  const WARNINGS = ['W-MEASURE-LENGTH', 'W-DISPLAY-DURATION', 'W-TUPLET-INCOMPLETE', 'W-TIE-OPEN', 'W-SLUR-OPEN',
    'W-PEDAL-OPEN', 'W-TEMPO-MARK-MISMATCH', 'W-CLEF-MISSING', 'W-OTTAVA-OVERLAP', 'W-HEAD-UNISON', 'W-GRACE-ORPHAN',
    'W-REPEAT-DANGLING', 'W-ENDING-NO-REPEAT', 'W-PERF-LINK-PITCH'];
  const INFOS = ['I-VOICE-GAP', 'I-NO-TEMPO', 'I-NO-KEY', 'I-JUMP-IGNORED', 'I-LIMB-UNSET', 'I-PROV-REDUNDANT', 'I-EXT'];
  const CODES = Object.freeze(ERRORS.concat(WARNINGS, INFOS));
  const SEVERITY = {};
  ERRORS.forEach(c => { SEVERITY[c] = 'ERROR'; });
  WARNINGS.forEach(c => { SEVERITY[c] = 'WARNING'; });
  INFOS.forEach(c => { SEVERITY[c] = 'INFO'; });
  const SEV_RANK = { ERROR: 0, WARNING: 1, INFO: 2 };

  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const num3ok = x => typeof x === 'number' && isFinite(x) && Math.round(x * 1000) / 1000 === x && !Object.is(x, -0);
  const ENTITY_SHAPES = new Set(['Measure', 'MeterEvent', 'KeyEvent', 'TempoEvent', 'Ending', 'Jump', 'Part', 'Staff',
    'Voice', 'Clef', 'Event', 'Head', 'Direction', 'Spanner', 'Section', 'Phrase', 'Performance', 'PerfNote', 'PerfPedal',
    'Anchor', 'Source', 'Flag']);
  const PREFIX_OF_SHAPE = { Measure: 'm', MeterEvent: 'mt', KeyEvent: 'ky', TempoEvent: 'tp', Ending: 'en', Jump: 'j',
    Part: 'p', Staff: 'st', Voice: 'v', Clef: 'c', Event: 'e', Head: 'h', Direction: 'd', Spanner: 's', Section: 'sc',
    Phrase: 'ph', Performance: 'pf', PerfNote: 'pn', PerfPedal: 'pp', Source: 'sr', Flag: 'fl' };
  const BEAT_TYPES = [1, 2, 4, 8, 16, 32, 64, 128];

  function validate(g) {
    const issues = [];
    const broken = new Set();
    function add(code, message, ids, at) {
      const it = { code: code, severity: SEVERITY[code], message: message };
      if (ids && ids.length) it.ids = ids.filter(x => typeof x === 'string');
      if (at) it.at = at;
      issues.push(it);
    }
    function finish() {
      issues.forEach(it => { if (it.ids && !it.ids.length) delete it.ids; });
      const firstNum = it => (it.ids && it.ids.length ? (S.idNumber(it.ids[0]) || 0) : -1);
      issues.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
        firstNum(a) - firstNum(b) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
      return { ok: !issues.some(i => i.severity === 'ERROR'), issues: issues };
    }

    if (!isObj(g)) { add('E-SHAPE', 'a ScoreGraph is a JSON object'); return finish(); }
    if (!Number.isInteger(g.scoregraph_version) || g.scoregraph_version !== S.SCOREGRAPH_VERSION) {
      add('E-VERSION', 'scoregraph_version ' + JSON.stringify(g.scoregraph_version) + ' is not ' + S.SCOREGRAPH_VERSION +
        (Number.isInteger(g.scoregraph_version) && g.scoregraph_version < S.SCOREGRAPH_VERSION ? ' (migrate it first)' : ''));
      return finish();
    }

    /* ================================================================ 1. shape */
    const entities = [];            /* {shape, obj, part (index or -1), event (for heads), perf} */
    function shapeErr(code, host, message) {
      add(code, message, host && typeof host.id === 'string' ? [host.id] : undefined);
      if (host) broken.add(host);
    }
    function validJson(v, depth) {
      if (depth > 64) return false;
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
      if (typeof v === 'number') return Number.isInteger(v) ? Number.isSafeInteger(v) : num3ok(v);
      if (Array.isArray(v)) return v.every(x => validJson(x, depth + 1));
      if (isObj(v)) return Object.keys(v).every(k => validJson(v[k], depth + 1));
      return false;
    }
    function checkType(type, val, where, host, ctx) {
      switch (type.t) {
        case 'str':
          if (typeof val !== 'string' || (type.re && !type.re.test(val))) shapeErr('E-SHAPE', host, where + ' must be a string' + (type.re ? ' matching ' + type.re : ''));
          return;
        case 'int':
          if (!Number.isInteger(val) || (type.min != null && val < type.min) || (type.max != null && val > type.max) ||
              (type.values && type.values.indexOf(val) < 0))
            shapeErr('E-SHAPE', host, where + ' must be an integer' + (type.values ? ' in ' + type.values.join(',') :
              (type.min != null ? ' >= ' + type.min : '') + (type.max != null ? ' <= ' + type.max : '')));
          return;
        case 'bool':
          if (typeof val !== 'boolean') shapeErr('E-SHAPE', host, where + ' must be a boolean');
          return;
        case 'num3':
          if (!num3ok(val) || (type.min != null && val < type.min) || (type.max != null && val > type.max))
            shapeErr('E-SHAPE', host, where + ' must be a number with at most three decimals');
          return;
        case 'conf':
          if (!num3ok(val) || val < 0 || val > 1) shapeErr('E-PROV', host, where + ' must be a confidence 0-1 with at most three decimals');
          return;
        case 'rat': {
          const why = R.check(val);
          if (why) shapeErr('E-RATIONAL', host, where + ' ' + JSON.stringify(val) + ' ' + why);
          return;
        }
        case 'enum':
          if (type.values.indexOf(val) < 0) shapeErr('E-SHAPE', host, where + ' ' + JSON.stringify(val) + ' is not one of ' + type.values.join(', '));
          return;
        case 'id':
          if (typeof val !== 'string' || !S.ID_RE.test(val) || S.idPrefix(val) !== type.prefix)
            shapeErr('E-ID-FORMAT', host, where + ' ' + JSON.stringify(val) + ' is not a "' + type.prefix + '" ID');
          return;
        case 'ref':
          if (typeof val !== 'string') shapeErr('E-SHAPE', host, where + ' must be an ID string');
          else if (!S.ID_RE.test(val)) shapeErr('E-ID-FORMAT', host, where + ' ' + JSON.stringify(val) + ' is not an ID');
          return;
        case 'arr':
          if (!Array.isArray(val)) { shapeErr('E-SHAPE', host, where + ' must be an array'); return; }
          if (val.length < type.min) shapeErr('E-SHAPE', host, where + ' needs at least ' + type.min + ' element(s)');
          val.forEach((x, i) => {
            if (x === null) { shapeErr('E-SHAPE', host, where + '[' + i + '] is null'); return; }
            checkType(type.of, x, where + '[' + i + ']', host, ctx);
          });
          return;
        case 'obj':
          walk(type.shape, val, where, host, ctx);
          return;
        case 'json':
          if (!validJson(val, 0)) shapeErr('E-SHAPE', host, where + ' must be JSON with integers or 3-decimal numbers');
          return;
        case 'ext':
          if (!isObj(val)) { shapeErr('E-SHAPE', host, where + ' must be an object'); return; }
          Object.keys(val).forEach(k => {
            if (!S.EXT_NS_RE.test(k)) shapeErr('E-SHAPE', host, where + ' namespace ' + JSON.stringify(k) + ' is not registered-style');
            else if (!validJson(val[k], 0)) shapeErr('E-SHAPE', host, where + '.' + k + ' must be JSON with integers or 3-decimal numbers');
          });
          return;
        case 'asp':
          if (!isObj(val)) { shapeErr('E-SHAPE', host, where + ' must be an object'); return; }
          Object.keys(val).forEach(k => {
            if (S.ASPECTS.indexOf(k) < 0) shapeErr('E-SHAPE', host, where + ' aspect ' + JSON.stringify(k) + ' is unknown');
            else walk('ProvAspect', val[k], where + '.' + k, host, ctx);
          });
          return;
        default:
          return;
      }
    }
    function walk(shapeName, v, where, host, ctx) {
      const isEntity = ENTITY_SHAPES.has(shapeName);
      if (isEntity) host = v;
      if (!isObj(v)) { shapeErr('E-SHAPE', isEntity ? null : host, where + ' must be an object'); return; }
      if (isEntity) entities.push({ shape: shapeName, obj: v, part: ctx.part, event: ctx.event, perf: ctx.perf, where: where });
      const fields = S.fieldsOf(shapeName, v);
      const known = new Set(fields.map(fd => fd.name));
      Object.keys(v).forEach(k => { if (!known.has(k)) shapeErr('E-SHAPE', host, where + ' has no field ' + JSON.stringify(k)); });
      if (shapeName === 'Head') {
        const tag = S.unionTag('Head', v);
        if (v.pitch !== undefined && v.inst !== undefined) shapeErr('E-SHAPE', host, where + ' has both pitch and inst');
        else if (tag === 'pitched' && v.pitch === undefined) shapeErr('E-SHAPE', host, where + ' needs pitch or inst');
        if (ctx.eventKind === 'note' && tag === 'perc') shapeErr('E-SHAPE', host, where + ' is a percussion head in a note event');
        if (ctx.eventKind === 'perc' && tag === 'pitched') shapeErr('E-SHAPE', host, where + ' is a pitched head in a perc event');
      }
      if (shapeName === 'Instrument' && typeof v.kind === 'string' && S.INSTRUMENT_KINDS[v.kind] && v.kind !== 'unknown' &&
          typeof v.family === 'string' && v.family !== S.INSTRUMENT_KINDS[v.kind])
        shapeErr('E-SHAPE', host, where + ' family ' + v.family + ' is not ' + v.kind + "'s (" + S.INSTRUMENT_KINDS[v.kind] + ')');
      fields.forEach(fd => {
        const val = v[fd.name];
        const w = where + '.' + fd.name;
        if (val === undefined) {
          if (shapeName === 'Event' && fd.name === 'heads' && (v.kind === 'note' || v.kind === 'perc')) {
            add('E-HEADS', w + ': a ' + v.kind + ' event needs heads', [v.id]); broken.add(v); return;
          }
          if (shapeName === 'Provenance' && fd.name === 'default') { add('E-PROV', 'provenance.default is missing'); return; }
          if (S.fieldRequired(shapeName, fd, v)) shapeErr('E-SHAPE', host, w + ' is required');
          return;
        }
        if (val === null) { shapeErr('E-SHAPE', host, w + ' is null'); return; }
        const type = S.fieldType(shapeName, fd, v);
        if (!type) return;
        if (shapeName === 'Event' && fd.name === 'heads' && Array.isArray(val)) {
          if (!val.length) { add('E-HEADS', w + ': a ' + v.kind + ' event needs heads', [v.id]); broken.add(v); return; }
          val.forEach((h, i) => walk('Head', h, w + '[' + i + ']', null, Object.assign({}, ctx, { event: v, eventKind: v.kind })));
          return;
        }
        let sub = ctx;
        if (shapeName === 'ScoreGraph' && fd.name === 'parts' && Array.isArray(val)) {
          val.forEach((p, i) => walk('Part', p, w + '[' + i + ']', null, Object.assign({}, ctx, { part: i })));
          if (!val.length) shapeErr('E-SHAPE', null, w + ' needs at least 1 element(s)');
          return;
        }
        if (shapeName === 'ScoreGraph' && fd.name === 'performances' && Array.isArray(val)) {
          val.forEach((p, i) => walk('Performance', p, w + '[' + i + ']', null, Object.assign({}, ctx, { perf: p })));
          return;
        }
        checkType(type, val, w, host, sub);
      });
    }
    walk('ScoreGraph', g, 'graph', null, { part: -1, event: null, perf: null, eventKind: null });

    /* ================================================================ 2. IDs */
    const byId = new Map();        /* id -> entity record */
    const byNum = new Map();
    entities.forEach(en => {
      const id = en.obj.id;
      if (en.shape === 'Anchor' || typeof id !== 'string' || !S.ID_RE.test(id) || S.idPrefix(id) !== PREFIX_OF_SHAPE[en.shape]) return;
      const n = S.idNumber(id);
      if (byNum.has(n)) {
        add('E-ID-DUPLICATE', 'ID number ' + n + ' is used by ' + byNum.get(n).obj.id + ' and ' + id, [byNum.get(n).obj.id, id]);
        broken.add(en.obj); broken.add(byNum.get(n).obj);
        return;
      }
      byNum.set(n, en);
      byId.set(id, en);
      if (Number.isInteger(g.nextId) && n >= g.nextId) add('E-ID-COUNTER', 'ID ' + id + ' is not below nextId ' + g.nextId, [id]);
    });

    /* ================================================================ 3. references */
    const kindOk = (en, kinds) => en && kinds.indexOf(S.idPrefix(en.obj.id)) >= 0;
    function refMissing(host, where, id, kinds) {
      add('E-REF-MISSING', where + ' ' + JSON.stringify(id) + ' is not ' + (kinds.length === 1 ? 'a' : 'an') + ' ' + kinds.join('/') +
        ' in this graph', host && host.id ? [host.id] : undefined);
      if (host) broken.add(host);
    }
    /* A ref that must exist and be of a kind; `part` >= 0 limits voices/heads/events/spanners to one part. */
    function ref(host, where, id, kinds, part, scopeCode) {
      if (id === undefined || typeof id !== 'string' || !S.ID_RE.test(id)) return null;
      const en = byId.get(id);
      if (!en || !kindOk(en, kinds)) { refMissing(host, where, id, kinds); return null; }
      if (part !== undefined && part >= 0 && en.part !== part) {
        add(scopeCode || 'E-REF-SCOPE', where + ' ' + id + ' belongs to another part', host && host.id ? [host.id, id] : [id]);
        if (host) broken.add(host);
        return null;
      }
      return en.obj;
    }
    function srcRef(host, where, id) {
      if (id === undefined || typeof id !== 'string') return;
      const en = byId.get(id);
      if (!en || en.shape !== 'Source') {
        add('E-PROV', where + ' ' + JSON.stringify(id) + ' is not a source', host && host.id ? [host.id] : undefined);
        if (host) broken.add(host);
      }
    }
    function provRefs(host, where, prov) {
      if (!isObj(prov)) return;
      srcRef(host, where + '.src', prov.src);
      if (isObj(prov.asp)) Object.keys(prov.asp).forEach(a => { if (isObj(prov.asp[a])) srcRef(host, where + '.asp.' + a + '.src', prov.asp[a].src); });
    }
    const posRef = (host, where, p) => { if (isObj(p)) ref(host, where + '.m', p.m, ['m']); };
    const displayRefs = (host, where, list) => {
      (Array.isArray(list) ? list : []).forEach((d, i) => {
        if (!isObj(d)) return;
        const part = ref(host, where + '[' + i + '].part', d.part, ['p']);
        if (part && d.staff !== undefined) {
          const pi = g.parts.indexOf(part);
          ref(host, where + '[' + i + '].staff', d.staff, ['st'], pi, 'E-REF-SCOPE');
        }
      });
    };
    entities.forEach(en => {
      const o = en.obj, sh = en.shape, pi = en.part;
      if (broken.has(o) && !byId.has(o.id) && sh !== 'Anchor') return;
      switch (sh) {
        case 'Measure': provRefs(o, 'measure', o.prov); break;
        case 'MeterEvent': ref(o, 'meter.m', o.m, ['m']); break;
        case 'KeyEvent': {
          ref(o, 'key.m', o.m, ['m']);
          if (isObj(o.scope)) {
            const part = ref(o, 'key.scope.part', o.scope.part, ['p']);
            if (part && o.scope.staff !== undefined) ref(o, 'key.scope.staff', o.scope.staff, ['st'], g.parts.indexOf(part), 'E-REF-SCOPE');
          }
          break;
        }
        case 'TempoEvent': ref(o, 'tempo.m', o.m, ['m']); displayRefs(o, 'tempo.display', o.display); break;
        case 'Ending': ref(o, 'ending.from', o.from, ['m']); ref(o, 'ending.to', o.to, ['m']); break;
        case 'Jump': ref(o, 'jump.m', o.m, ['m']); ref(o, 'jump.target', o.target, ['j']); displayRefs(o, 'jump.display', o.display); break;
        case 'Part': provRefs(o, 'part', o.prov); break;
        case 'Voice': ref(o, 'voice.staff', o.staff, ['st'], pi, 'E-VOICE-STAFF'); break;
        case 'Clef': ref(o, 'clef.m', o.m, ['m']); ref(o, 'clef.staff', o.staff, ['st'], pi, 'E-VOICE-STAFF'); break;
        case 'Event':
          ref(o, 'event.m', o.m, ['m']);
          ref(o, 'event.voice', o.voice, ['v'], pi, 'E-REF-SCOPE');
          ref(o, 'event.staff', o.staff, ['st'], pi, 'E-VOICE-STAFF');
          provRefs(o, 'event', o.prov);
          break;
        case 'Head':
          if (o.staff !== undefined) ref(o, 'head.staff', o.staff, ['st'], pi, 'E-VOICE-STAFF');
          provRefs(o, 'head', o.prov);
          break;
        case 'Direction':
          ref(o, 'direction.m', o.m, ['m']);
          if (o.staff !== undefined) ref(o, 'direction.staff', o.staff, ['st'], pi, 'E-VOICE-STAFF');
          if (o.voice !== undefined) ref(o, 'direction.voice', o.voice, ['v'], pi, 'E-REF-SCOPE');
          if (o.event !== undefined) ref(o, 'direction.event', o.event, ['e'], pi, 'E-REF-SCOPE');
          provRefs(o, 'direction', o.prov);
          break;
        case 'Spanner': {
          const t = o.type;
          if (t === 'tie') { ref(o, 'tie.from', o.from, ['h'], pi); ref(o, 'tie.to', o.to, ['h'], pi); }
          if (t === 'slur') { ref(o, 'slur.from', o.from, ['e'], pi); ref(o, 'slur.to', o.to, ['e'], pi); }
          if (t === 'tuplet' || t === 'beam') (Array.isArray(o.events) ? o.events : []).forEach((e, i) => ref(o, t + '.events[' + i + ']', e, ['e'], pi));
          if (t === 'tuplet' && o.parent !== undefined) {
            const p = ref(o, 'tuplet.parent', o.parent, ['s'], pi);
            if (p && p.type !== 'tuplet') refMissing(o, 'tuplet.parent', o.parent, ['tuplet']);
          }
          if (t === 'beam') (Array.isArray(o.breaks) ? o.breaks : []).forEach((b, i) => { if (isObj(b)) ref(o, 'beam.breaks[' + i + '].after', b.after, ['e'], pi); });
          if (t === 'arpeggio') (Array.isArray(o.heads) ? o.heads : []).forEach((h, i) => ref(o, 'arpeggio.heads[' + i + ']', h, ['h'], pi));
          if (t === 'wedge' || t === 'pedal' || t === 'ottava') { posRef(o, t + '.from', o.from); posRef(o, t + '.to', o.to); }
          if (t === 'pedal') (Array.isArray(o.changes) ? o.changes : []).forEach((c, i) => posRef(o, 'pedal.changes[' + i + ']', c));
          if ((t === 'wedge' || t === 'ottava') && o.staff !== undefined) ref(o, t + '.staff', o.staff, ['st'], pi, 'E-VOICE-STAFF');
          provRefs(o, 'spanner', o.prov);
          break;
        }
        case 'Section':
          ref(o, 'section.from', o.from, ['m']); ref(o, 'section.to', o.to, ['m']);
          if (o.parent !== undefined) ref(o, 'section.parent', o.parent, ['sc']);
          provRefs(o, 'section', o.prov);
          break;
        case 'Phrase': {
          const part = o.part !== undefined ? ref(o, 'phrase.part', o.part, ['p']) : null;
          (Array.isArray(o.voices) ? o.voices : []).forEach((v, i) => ref(o, 'phrase.voices[' + i + ']', v, ['v'],
            part ? g.parts.indexOf(part) : undefined, 'E-REF-SCOPE'));
          posRef(o, 'phrase.from', o.from); posRef(o, 'phrase.to', o.to);
          if (o.section !== undefined) ref(o, 'phrase.section', o.section, ['sc']);
          provRefs(o, 'phrase', o.prov);
          break;
        }
        case 'Performance': srcRef(o, 'performance.src', o.src); break;
        case 'PerfNote':
          if (o.part !== undefined) ref(o, 'perfNote.part', o.part, ['p']);
          if (o.link !== undefined) ref(o, 'perfNote.link', o.link, ['h']);
          break;
        case 'Anchor': ref(o, 'anchor.m', o.m, ['m']); break;
        case 'Flag':
          if (isObj(o.span)) {
            if (o.span.part !== undefined) ref(o, 'flag.span.part', o.span.part, ['p']);
            posRef(o, 'flag.span.from', o.span.from); posRef(o, 'flag.span.to', o.span.to);
          }
          (Array.isArray(o.ids) ? o.ids : []).forEach((id, i) => {
            if (typeof id === 'string' && S.ID_RE.test(id) && !byId.has(id)) refMissing(o, 'flag.ids[' + i + ']', id, ['entity']);
          });
          srcRef(o, 'flag.src', o.src);
          break;
        default: break;
      }
    });
    const prov = isObj(g.provenance) ? g.provenance : null;
    if (prov && isObj(prov.default)) {
      if (prov.default.src === undefined) add('E-PROV', 'provenance.default needs a src');
      else srcRef(null, 'provenance.default.src', prov.default.src);
      if (isObj(prov.default.asp)) Object.keys(prov.default.asp).forEach(a => {
        if (isObj(prov.default.asp[a])) srcRef(null, 'provenance.default.asp.' + a + '.src', prov.default.asp[a].src);
      });
    }

    /* ================================================================ 4. rules */
    const ok = o => isObj(o) && !broken.has(o);
    const c = T.ctx(g);
    const measures = c.measures;
    const mIdx = m => { const i = c.index.get(m); return i === undefined ? -1 : i; };
    const measureOk = m => { const i = mIdx(m); return i >= 0 && ok(measures[i]) && R.isValid(measures[i].dur) && R.sign(R.parse(measures[i].dur)) > 0; };
    const durOf = i => c.durs[i];
    /* ScorePos of a Pos-like object, or null when it cannot be computed */
    const W = p => (isObj(p) && measureOk(p.m) && R.isValid(p.at) ? R.add(c.starts[mIdx(p.m)], R.parse(p.at)) : null);
    const atOf = p => R.parse(p.at);
    const loc = (partIdx, p) => {
      const out = {};
      if (partIdx >= 0 && isObj(g.parts[partIdx])) out.part = g.parts[partIdx].id;
      if (isObj(p) && typeof p.m === 'string') out.m = p.m;
      if (isObj(p) && typeof p.at === 'string') out.at = p.at;
      return out;
    };

    /* --- measures: duration */
    measures.forEach(m => {
      if (!ok(m) || !R.isValid(m.dur)) return;
      if (R.sign(R.parse(m.dur)) <= 0) { add('E-DURATION', 'measure ' + m.id + ' has duration ' + m.dur + ' (must be > 0)', [m.id]); broken.add(m); }
    });

    /* --- positions: at within the measure (§5.2; see G01 §24 on at == dur) */
    function checkPos(host, p, where, strict, partIdx) {
      if (!isObj(p) || !measureOk(p.m) || !R.isValid(p.at)) return true;
      const at = atOf(p), dur = durOf(mIdx(p.m));
      if (R.sign(at) < 0 || R.gt(at, dur) || (strict && R.ge(at, dur))) {
        add('E-POSITION', where + ' at ' + p.at + ' is outside measure ' + p.m + ' (duration ' + R.format(dur) + ')', host && host.id ? [host.id] : undefined, loc(partIdx, p));
        if (host) broken.add(host);
        return false;
      }
      return true;
    }
    const tl = isObj(g.timeline) ? g.timeline : {};
    const arr = x => (Array.isArray(x) ? x : []);
    arr(tl.keys).forEach(k => { if (ok(k)) checkPos(k, k, 'key', false, -1); });
    arr(tl.tempos).forEach(t => { if (ok(t)) checkPos(t, t, 'tempo', false, -1); });
    arr(tl.jumps).forEach(j => { if (ok(j)) checkPos(j, j, 'jump', false, -1); });
    const parts = arr(g.parts);
    parts.forEach((part, pi) => {
      if (!isObj(part)) return;
      arr(part.clefs).forEach(cl => { if (ok(cl)) checkPos(cl, cl, 'clef', false, pi); });
      arr(part.directions).forEach(d => { if (ok(d)) checkPos(d, d, 'direction', false, pi); });
      arr(part.events).forEach(e => { if (ok(e)) checkPos(e, e, 'event', !isObj(e.grace), pi); });
      arr(part.spanners).forEach(s => {
        if (!ok(s)) return;
        if (s.type === 'wedge' || s.type === 'pedal' || s.type === 'ottava') {
          checkPos(s, s.from, s.type + '.from', false, pi) && checkPos(s, s.to, s.type + '.to', false, pi);
          if (s.type === 'pedal') arr(s.changes).forEach((ch, i) => checkPos(s, ch, 'pedal.changes[' + i + ']', false, pi));
        }
      });
    });
    const structure = isObj(g.structure) ? g.structure : {};
    arr(structure.phrases).forEach(ph => { if (ok(ph)) { checkPos(ph, ph.from, 'phrase.from', false, -1); checkPos(ph, ph.to, 'phrase.to', false, -1); } });
    const flags = prov ? arr(prov.flags) : [];
    flags.forEach(fl => { if (ok(fl) && isObj(fl.span)) { checkPos(fl, fl.span.from, 'flag.from', false, -1); checkPos(fl, fl.span.to, 'flag.to', false, -1); } });

    /* --- events: durations, overflow, heads */
    const eventById = new Map(), headById = new Map(), eventOfHead = new Map(), partOfEvent = new Map();
    parts.forEach((part, pi) => {
      if (!isObj(part)) return;
      arr(part.events).forEach(e => {
        if (!isObj(e)) return;
        eventById.set(e.id, e); partOfEvent.set(e, pi);
        arr(e.heads).forEach(h => { if (isObj(h)) { headById.set(h.id, h); eventOfHead.set(h, e); } });
      });
    });
    const evStart = e => W(e);
    const evEnd = e => { const s = W(e); return s && R.isValid(e.dur) ? R.add(s, R.parse(e.dur)) : null; };
    parts.forEach((part, pi) => {
      if (!isObj(part)) return;
      const kit = isObj(part.instrument) && isObj(part.instrument.kit) ? arr(part.instrument.kit.items).map(it => it && it.key) : null;
      arr(part.events).forEach(e => {
        if (!ok(e) || !R.isValid(e.dur)) return;
        const d = R.parse(e.dur), grace = isObj(e.grace);
        if (R.sign(d) < 0 || (!grace && R.isZero(d)) || (grace && !R.isZero(d))) {
          add('E-DURATION', 'event ' + e.id + ' has duration ' + e.dur + (grace ? ' (a grace event lasts 0)' : ' (must be > 0)'), [e.id], loc(pi, e));
          broken.add(e); return;
        }
        if (measureOk(e.m) && R.isValid(e.at) && R.gt(R.add(atOf(e), d), durOf(mIdx(e.m)))) {
          add('E-MEASURE-OVERFLOW', 'event ' + e.id + ' ends at ' + R.format(R.add(atOf(e), d)) + ', after measure ' + e.m + ' (' + R.format(durOf(mIdx(e.m))) + ')', [e.id], loc(pi, e));
          broken.add(e);
        }
        if (e.kind === 'note' || e.kind === 'perc') {
          const heads = arr(e.heads).filter(isObj);
          const seen = new Map();
          heads.forEach(h => {
            if (!ok(h)) return;
            const key = e.kind === 'note' && isObj(h.pitch) ? h.pitch.step + (h.pitch.alter || 0) + '/' + h.pitch.oct : 'inst:' + h.inst;
            if (seen.has(key)) add('E-HEADS', 'event ' + e.id + ' has ' + key + ' twice (' + seen.get(key) + ', ' + h.id + ')', [e.id, seen.get(key), h.id], loc(pi, e));
            else seen.set(key, h.id);
            if (e.kind === 'note' && isObj(h.pitch) && P.PC[h.pitch.step] !== undefined) {
              const mm = P.midi(h.pitch);
              if (mm < 0 || mm > 127) { add('E-PITCH-RANGE', 'head ' + h.id + ' sounds MIDI ' + mm, [h.id], loc(pi, e)); broken.add(h); }
            }
          });
          if (e.kind === 'note') {
            const byMidi = new Map();
            heads.forEach(h => {
              if (!ok(h) || !isObj(h.pitch) || P.PC[h.pitch.step] === undefined) return;
              const mm = P.midi(h.pitch);
              const other = byMidi.get(mm);
              if (other && (other.pitch.step !== h.pitch.step || (other.pitch.alter || 0) !== (h.pitch.alter || 0)))
                add('W-HEAD-UNISON', 'event ' + e.id + ' spells MIDI ' + mm + ' twice (' + other.id + ', ' + h.id + ')', [e.id, other.id, h.id], loc(pi, e));
              if (!other) byMidi.set(mm, h);
            });
          }
          if (e.kind === 'perc') {
            if (!kit) add('E-PERC-KIT', 'percussion event ' + e.id + ' is in a part without a kit', [e.id], loc(pi, e));
            else heads.forEach(h => { if (ok(h) && kit.indexOf(h.inst) < 0) add('E-PERC-KIT', 'head ' + h.id + ' names ' + JSON.stringify(h.inst) + ', not in the kit', [h.id], loc(pi, e)); });
          }
        }
      });

      /* --- voices: overlap and gaps */
      const byVoice = new Map();
      arr(part.events).forEach(e => {
        if (!ok(e) || isObj(e.grace)) return;
        const s = evStart(e), en = evEnd(e);
        if (!s || !en) return;
        if (!byVoice.has(e.voice)) byVoice.set(e.voice, []);
        byVoice.get(e.voice).push({ e: e, s: s, en: en });
      });
      byVoice.forEach(list => {
        list.sort((a, b) => R.cmp(a.s, b.s) || S.idNumber(a.e.id) - S.idNumber(b.e.id));
        let reach = null, last = null;
        list.forEach(x => {
          if (reach && R.lt(x.s, reach)) add('E-VOICE-OVERLAP', 'events ' + last.e.id + ' and ' + x.e.id + ' of voice ' + x.e.voice + ' overlap', [last.e.id, x.e.id], loc(pi, x.e));
          if (!reach || R.gt(x.en, reach)) { reach = x.en; last = x; }
        });
        /* I-VOICE-GAP: a measure where the voice writes something but leaves time uncovered */
        const byMeasure = new Map();
        list.forEach(x => { if (!byMeasure.has(x.e.m)) byMeasure.set(x.e.m, []); byMeasure.get(x.e.m).push(x); });
        byMeasure.forEach((xs, m) => {
          const i = mIdx(m);
          let cur = c.starts[i];
          let gap = false;
          xs.forEach(x => { if (R.gt(x.s, cur)) gap = true; if (R.gt(x.en, cur)) cur = x.en; });
          if (R.lt(cur, R.add(c.starts[i], durOf(i)))) gap = true;
          if (gap) add('I-VOICE-GAP', 'voice ' + xs[0].e.voice + ' leaves time uncovered in measure ' + m, [xs[0].e.voice, m], loc(pi, { m: m }));
        });
      });
    });

    /* --- ties */
    const outTie = new Map(), inTie = new Map();
    parts.forEach((part, pi) => {
      if (!isObj(part)) return;
      arr(part.spanners).forEach(s => {
        if (!ok(s) || s.type !== 'tie') return;
        if (s.from === undefined && s.to === undefined) { add('E-SHAPE', 'tie ' + s.id + ' has neither end', [s.id]); broken.add(s); return; }
        if (s.from !== undefined) { if (!outTie.has(s.from)) outTie.set(s.from, []); outTie.get(s.from).push(s); }
        if (s.to !== undefined) { if (!inTie.has(s.to)) inTie.set(s.to, []); inTie.get(s.to).push(s); }
        if (s.from === undefined || s.to === undefined) {
          add('W-TIE-OPEN', 'tie ' + s.id + ' has only its ' + (s.from === undefined ? 'end' : 'start'), [s.id, s.from !== undefined ? s.from : s.to], loc(pi, eventOfHead.get(headById.get(s.from !== undefined ? s.from : s.to))));
          return;
        }
        const hf = headById.get(s.from), ht = headById.get(s.to);
        const ef = eventOfHead.get(hf), et = eventOfHead.get(ht);
        if (!hf || !ht || !ok(ef) || !ok(et)) return;
        if (ef === et) { add('E-TIE-TIME', 'tie ' + s.id + ' joins two heads of one event', [s.id], loc(pi, ef)); return; }
        if (isObj(hf.pitch) && isObj(ht.pitch) && P.PC[hf.pitch.step] !== undefined && P.PC[ht.pitch.step] !== undefined &&
            P.midi(hf.pitch) !== P.midi(ht.pitch))
          add('E-TIE-PITCH', 'tie ' + s.id + ' joins MIDI ' + P.midi(hf.pitch) + ' to ' + P.midi(ht.pitch), [s.id], loc(pi, ef));
        const end = evEnd(ef), start = evStart(et);
        if (end && start && !R.eq(end, start))
          add('E-TIE-TIME', 'tie ' + s.id + ': ' + et.id + ' starts at ScorePos ' + R.format(start) + ', not where ' + ef.id + ' ends (' + R.format(end) + ')', [s.id], loc(pi, ef));
      });
    });
    outTie.forEach((list, h) => { if (list.length > 1) add('E-TIE-CHAIN', 'head ' + h + ' starts ' + list.length + ' ties', [h].concat(list.map(s => s.id))); });
    inTie.forEach((list, h) => { if (list.length > 1) add('E-TIE-CHAIN', 'head ' + h + ' ends ' + list.length + ' ties', [h].concat(list.map(s => s.id))); });
    /* tie cycles: follow from -> to through complete ties */
    outTie.forEach((list, h0) => {
      let h = h0, steps = 0;
      const seen = new Set([h0]);
      while (outTie.has(h) && outTie.get(h).length === 1 && outTie.get(h)[0].to !== undefined && steps++ < headById.size + 1) {
        h = outTie.get(h)[0].to;
        if (h === h0) { add('E-TIE-CHAIN', 'the ties from head ' + h0 + ' form a cycle', [h0]); break; }
        if (seen.has(h)) break;
        seen.add(h);
      }
    });

    /* --- slurs, tuplets, beams, wedges, pedals, ottavas, arpeggios */
    parts.forEach((part, pi) => {
      if (!isObj(part)) return;
      const voiceSeq = new Map();
      arr(part.events).filter(e => ok(e) && !isObj(e.grace) && evStart(e)).forEach(e => {
        if (!voiceSeq.has(e.voice)) voiceSeq.set(e.voice, []);
        voiceSeq.get(e.voice).push(e);
      });
      voiceSeq.forEach(list => list.sort((a, b) => R.cmp(evStart(a), evStart(b)) || S.idNumber(a.id) - S.idNumber(b.id)));
      const seqIndex = new Map();
      voiceSeq.forEach(list => list.forEach((e, i) => seqIndex.set(e, i)));
      const tuplets = arr(part.spanners).filter(s => ok(s) && s.type === 'tuplet');
      const tupById = new Map(tuplets.map(t => [t.id, t]));
      const ottavas = [];
      arr(part.spanners).forEach(s => {
        if (!ok(s)) return;
        if (s.type === 'slur' && (s.from === undefined || s.to === undefined)) {
          if (s.from === undefined && s.to === undefined) { add('E-SHAPE', 'slur ' + s.id + ' has neither end', [s.id]); return; }
          add('W-SLUR-OPEN', 'slur ' + s.id + ' has only its ' + (s.from === undefined ? 'end' : 'start'), [s.id], loc(pi, eventById.get(s.from !== undefined ? s.from : s.to)));
        }
        if (s.type === 'wedge' || s.type === 'ottava' || (s.type === 'pedal' && s.to !== undefined)) {
          const a = W(s.from), b = W(s.to);
          if (a && b && R.ge(a, b)) add('E-SPAN-ORDER', s.type + ' ' + s.id + ' ends at or before its start', [s.id], loc(pi, s.from));
          else if (a && b && s.type === 'ottava' && ok(s)) ottavas.push({ s: s, a: a, b: b });
        }
        if (s.type === 'pedal') {
          if (s.to === undefined) add('W-PEDAL-OPEN', 'pedal ' + s.id + ' is never released', [s.id], loc(pi, s.from));
          const a = W(s.from), b = s.to !== undefined ? W(s.to) : null;
          let prev = a;
          arr(s.changes).forEach(ch => {
            const w = W(ch);
            if (!w || !prev) return;
            if (R.le(w, prev) || (b && R.ge(w, b))) add('E-SPAN-ORDER', 'pedal ' + s.id + ' change at ' + ch.m + '@' + ch.at + ' is not inside (from, to) in order', [s.id], loc(pi, ch));
            prev = w;
          });
        }
        if (s.type === 'arpeggio') {
          const ws = arr(s.heads).map(h => eventOfHead.get(headById.get(h))).filter(Boolean).map(evStart);
          if (ws.length && ws.every(Boolean) && ws.some(w => !R.eq(w, ws[0]))) add('E-ARPEGGIO', 'arpeggio ' + s.id + ' joins heads at different onsets', [s.id]);
        }
        if (s.type === 'beam') {
          const evs = arr(s.events).map(id => eventById.get(id)).filter(Boolean);
          if (evs.length < 2) add('E-SHAPE', 'beam ' + s.id + ' needs at least 2 events', [s.id]);
        }
      });
      /* ottavas on one staff may not overlap */
      ottavas.sort((x, y) => R.cmp(x.a, y.a) || S.idNumber(x.s.id) - S.idNumber(y.s.id));
      const reachByStaff = new Map();
      ottavas.forEach(x => {
        const prev = reachByStaff.get(x.s.staff);
        if (prev && R.lt(x.a, prev.b)) add('W-OTTAVA-OVERLAP', 'ottavas ' + prev.s.id + ' and ' + x.s.id + ' overlap on ' + x.s.staff, [prev.s.id, x.s.id], loc(pi, x.s.from));
        if (!prev || R.gt(x.b, prev.b)) reachByStaff.set(x.s.staff, x);
      });
      /* tuplets */
      const ratio = t => R.make(t.normal, t.actual);
      tuplets.forEach(t => {
        if (!Number.isInteger(t.actual) || !Number.isInteger(t.normal) || t.actual < 1 || t.normal < 1) {
          add('E-TUPLET', 'tuplet ' + t.id + ' has ratio ' + t.actual + ':' + t.normal + ' (both must be >= 1)', [t.id]); broken.add(t); return;
        }
        const members = arr(t.events).map(id => eventById.get(id));
        if (members.some(e => !ok(e))) return;
        if (members.some(e => e.voice !== members[0].voice)) { add('E-TUPLET', 'tuplet ' + t.id + ' spans more than one voice', [t.id]); broken.add(t); return; }
        const real = members.filter(e => !isObj(e.grace));
        const idx = real.map(e => seqIndex.get(e));
        if (idx.some(i => i === undefined)) return;
        for (let i = 1; i < idx.length; i++) {
          if (idx[i] !== idx[i - 1] + 1) {
            add('E-TUPLET', 'tuplet ' + t.id + "'s members are not consecutive events of their voice in time order", [t.id]); broken.add(t); return;
          }
        }
      });
      /* parent chains: containment and cycles */
      tuplets.forEach(t => {
        if (broken.has(t) || t.parent === undefined) return;
        const seen = new Set([t.id]);
        let p = tupById.get(t.parent);
        while (p) {
          if (seen.has(p.id)) { add('E-TUPLET', 'tuplet ' + t.id + "'s parents form a cycle", [t.id]); broken.add(t); return; }
          seen.add(p.id);
          p = p.parent !== undefined ? tupById.get(p.parent) : null;
        }
        const parent = tupById.get(t.parent);
        if (!parent || broken.has(parent)) return;
        const pm = arr(parent.events), cm = arr(t.events);
        const at = pm.indexOf(cm[0]);
        if (at < 0 || cm.some((id, i) => pm[at + i] !== id))
          { add('E-TUPLET', 'tuplet ' + t.id + ' is not a consecutive part of its parent ' + parent.id, [t.id]); broken.add(t); }
      });
      /* the ratio chain of an event: its innermost tuplet and that tuplet's parents */
      const tupletsOf = new Map();
      tuplets.forEach(t => { if (!broken.has(t)) arr(t.events).forEach(id => { if (!tupletsOf.has(id)) tupletsOf.set(id, []); tupletsOf.get(id).push(t); }); });
      const chainRatio = t => {
        let r = R.ONE, x = t, guard = 0;
        while (x && guard++ < 64) { r = R.mul(r, ratio(x)); x = x.parent !== undefined ? tupById.get(x.parent) : null; }
        return r;
      };
      const innermost = list => list.find(t => !list.some(u => u !== t && u.parent === t.id)) || list[0];
      tuplets.forEach(t => {
        if (broken.has(t)) return;
        const members = arr(t.events).map(id => eventById.get(id)).filter(e => ok(e) && !isObj(e.grace));
        if (!members.length || members.some(e => !R.isValid(e.dur))) return;
        let unit = isObj(t.unit) ? S.noteValue(t.unit.type, t.unit.dots) : null;
        if (!unit && isObj(members[0].display) && members[0].display.type) unit = S.noteValue(members[0].display.type, members[0].display.dots);
        if (!unit) return;
        const parentRatio = t.parent !== undefined && tupById.get(t.parent) ? chainRatio(tupById.get(t.parent)) : R.ONE;
        const want = R.mul(R.mul(R.make(t.normal), unit), parentRatio);
        const sum = members.reduce((s, e) => R.add(s, R.parse(e.dur)), R.ZERO);
        if (!R.eq(sum, want)) add('W-TUPLET-INCOMPLETE', 'tuplet ' + t.id + ' holds ' + R.format(sum) + ' of its ' + R.format(want), [t.id], loc(pi, members[0]));
      });
      /* printed shapes against durations (issue 19) */
      arr(part.events).forEach(e => {
        if (!ok(e) || isObj(e.grace) || !isObj(e.display) || !e.display.type || !R.isValid(e.dur)) return;
        const v = S.noteValue(e.display.type, e.display.dots);
        if (!v) return;
        const list = tupletsOf.get(e.id);
        const shown = list ? R.mul(v, chainRatio(innermost(list))) : v;
        if (!R.eq(shown, R.parse(e.dur)))
          add('W-DISPLAY-DURATION', 'event ' + e.id + ' is printed as ' + e.display.type + (e.display.dots ? ' with ' + e.display.dots + ' dot(s)' : '') +
            ' (' + R.format(shown) + ') but lasts ' + e.dur, [e.id], loc(pi, e));
      });
      /* grace notes need a main note after them */
      const mains = new Set();
      arr(part.events).forEach(x => { if (ok(x) && !isObj(x.grace)) mains.add(x.voice + '|' + x.m + '|' + x.at); });
      arr(part.events).forEach(e => {
        if (!ok(e) || !isObj(e.grace)) return;
        if (!mains.has(e.voice + '|' + e.m + '|' + e.at)) add('W-GRACE-ORPHAN', 'grace event ' + e.id + ' has no main note after it', [e.id], loc(pi, e));
      });
    });

    /* --- timeline: meters, keys, tempos, repeats, endings */
    const meters = arr(tl.meters).filter(ok);
    if (measures.length && isObj(measures[0]) && !meters.some(mt => mt.m === measures[0].id))
      add('E-METER', 'the first measure has no time signature', isObj(measures[0]) ? [measures[0].id] : undefined);
    const meterAtM = new Map();
    meters.forEach(mt => {
      if (meterAtM.has(mt.m)) add('E-METER', 'measure ' + mt.m + ' has two time signatures', [meterAtM.get(mt.m).id, mt.id]);
      else meterAtM.set(mt.m, mt);
      if (BEAT_TYPES.indexOf(mt.beatType) < 0) { add('E-METER', 'beatType ' + mt.beatType + ' is not a power of two up to 128', [mt.id]); broken.add(mt); return; }
      if (Array.isArray(mt.groups) && mt.groups.length && mt.groups.every(R.isValid)) {
        const sum = mt.groups.reduce((s, x) => R.add(s, R.parse(x)), R.ZERO);
        if (!R.eq(sum, T.nominal(mt))) add('E-METER', 'the groups of ' + mt.id + ' add up to ' + R.format(sum) + ', not ' + R.format(T.nominal(mt)), [mt.id]);
      }
    });
    const keySeen = new Map();
    arr(tl.keys).forEach(k => {
      if (!ok(k)) return;
      if (!Number.isInteger(k.fifths) || k.fifths < -7 || k.fifths > 7) { add('E-KEY', 'key ' + k.id + ' has fifths ' + k.fifths + ' (−7…7)', [k.id]); return; }
      const w = W(k);
      if (!w) return;
      const key = (isObj(k.scope) ? k.scope.part + '/' + (k.scope.staff || '') : '*') + '@' + R.format(w);
      if (keySeen.has(key)) add('E-KEY', 'keys ' + keySeen.get(key) + ' and ' + k.id + ' share a scope and a position', [keySeen.get(key), k.id]);
      else keySeen.set(key, k.id);
    });
    arr(tl.tempos).forEach(t => {
      if (!ok(t)) return;
      if (t.qpm === undefined && t.mark === undefined) { add('E-TEMPO', 'tempo ' + t.id + ' has neither qpm nor mark', [t.id]); return; }
      if (t.qpm !== undefined && R.sign(R.parse(t.qpm)) <= 0) { add('E-TEMPO', 'tempo ' + t.id + ' has qpm ' + t.qpm + ' (must be > 0)', [t.id]); return; }
      if (isObj(t.mark) && t.mark.perMinute !== undefined && R.sign(R.parse(t.mark.perMinute)) <= 0) { add('E-TEMPO', 'tempo ' + t.id + ' prints ' + t.mark.perMinute + ' per minute (must be > 0)', [t.id]); return; }
      if (t.qpm !== undefined && isObj(t.mark) && t.mark.perMinute !== undefined && t.mark.unit) {
        const printed = R.mul(R.mul(R.parse(t.mark.perMinute), R.make(4)), S.noteValue(t.mark.unit, t.mark.dots));
        if (!R.eq(printed, R.parse(t.qpm)))
          add('W-TEMPO-MARK-MISMATCH', 'tempo ' + t.id + ' plays ' + t.qpm + ' quarters a minute but prints ' + t.mark.perMinute + ' ' + t.mark.unit +
            (t.mark.dots ? ' dotted' : '') + ' (' + R.format(printed) + ' quarters)', [t.id], loc(-1, t));
      }
    });
    let timelineOk = true;
    measures.forEach(m => {
      if (!isObj(m) || !isObj(m.barline)) return;
      const l = m.barline.left, r = m.barline.right;
      const bad = [];
      if (isObj(l) && l.repeat === 'backward') bad.push('a backward repeat on the left');
      if (isObj(r) && r.repeat === 'forward') bad.push('a forward repeat on the right');
      [l, r].forEach(b => {
        if (isObj(b) && b.times !== undefined && (b.repeat !== 'backward' || !Number.isInteger(b.times) || b.times < 2))
          bad.push('times ' + b.times + (b.repeat !== 'backward' ? ' without a backward repeat' : ' (must be >= 2)'));
      });
      if (bad.length) { add('E-REPEAT', 'measure ' + m.id + ' has ' + bad.join(' and '), [m.id]); timelineOk = false; }
    });
    const endings = arr(tl.endings).filter(ok);
    endings.forEach(en => {
      const nums = arr(en.numbers);
      const why = [];
      if (!nums.length) why.push('no numbers');
      else if (nums.some(x => !Number.isInteger(x) || x < 1)) why.push('numbers below 1');
      else if (nums.some((x, i) => i && x <= nums[i - 1])) why.push('numbers not ascending or repeated');
      const fi = mIdx(en.from), ti = mIdx(en.to);
      if (fi >= 0 && ti >= 0 && fi > ti) why.push('from after to');
      if (why.length) { add('E-ENDING', 'ending ' + en.id + ' has ' + why.join(', '), [en.id]); broken.add(en); timelineOk = false; }
    });
    endings.forEach((a, i) => endings.slice(i + 1).forEach(b => {
      if (broken.has(a) || broken.has(b)) return;
      const shared = arr(a.numbers).some(x => arr(b.numbers).indexOf(x) >= 0);
      if (shared && mIdx(a.from) <= mIdx(b.to) && mIdx(b.from) <= mIdx(a.to)) {
        add('E-ENDING', 'endings ' + a.id + ' and ' + b.id + ' overlap and share a number', [a.id, b.id]); timelineOk = false;
      }
    }));
    if (measures.some(m => !ok(m)) || arr(tl.endings).some(en => !ok(en))) timelineOk = false;
    let visits = null;
    if (timelineOk) {
      try { visits = T.unroll(g); } catch (e) {
        if (e.code === 'E-UNROLL-RUNAWAY') add('E-UNROLL-RUNAWAY', e.message.replace(/^E-UNROLL-RUNAWAY: /, ''));
        else throw e;
      }
    }
    /* W-REPEAT-DANGLING: a forward repeat no later backward repeat consumes (G0 PF-M1) */
    const openFwd = [];
    measures.forEach(m => {
      if (!isObj(m) || !isObj(m.barline)) return;
      if (isObj(m.barline.left) && m.barline.left.repeat === 'forward') openFwd.push(m);
      if (isObj(m.barline.right) && m.barline.right.repeat === 'backward' && openFwd.length) openFwd.pop();
    });
    openFwd.forEach(m => add('W-REPEAT-DANGLING', 'the forward repeat at measure ' + m.id + ' is never taken back to', [m.id]));
    /* W-ENDING-NO-REPEAT: an ending followed by another one must end in a backward repeat; so must a lone first ending */
    const endsBackward = en => { const m = measures[mIdx(en.to)]; return isObj(m) && isObj(m.barline) && isObj(m.barline.right) && m.barline.right.repeat === 'backward'; };
    const sortedEndings = endings.filter(en => !broken.has(en)).slice().sort((a, b) => mIdx(a.from) - mIdx(b.from) || S.idNumber(a.id) - S.idNumber(b.id));
    sortedEndings.forEach((en, i) => {
      const next = sortedEndings[i + 1];
      const followed = next && mIdx(next.from) === mIdx(en.to) + 1;
      const prev = sortedEndings[i - 1];
      const followsOne = prev && mIdx(en.from) === mIdx(prev.to) + 1;
      if ((followed || (!followsOne && arr(en.numbers).indexOf(1) >= 0)) && !endsBackward(en))
        add('W-ENDING-NO-REPEAT', 'ending ' + en.id + ' has no backward repeat to go back from', [en.id]);
    });

    /* --- measure lengths (§6.3) */
    const nominalAt = i => (c.meterAtIdx[i] && ok(c.meterAtIdx[i]) && BEAT_TYPES.indexOf(c.meterAtIdx[i].beatType) >= 0 ? T.nominal(c.meterAtIdx[i]) : null);
    const excused = new Set();
    const n = measures.length;
    if (n >= 2 && measureOk(measures[0].id) && measureOk(measures[n - 1].id) && nominalAt(0) &&
        R.lt(durOf(0), nominalAt(0)) && R.eq(R.add(durOf(0), durOf(n - 1)), nominalAt(0))) { excused.add(0); excused.add(n - 1); }
    const endingFrom = new Set(endings.map(en => mIdx(en.from))), endingTo = new Set(endings.map(en => mIdx(en.to)));
    for (let i = 0; i + 1 < n; i++) {
      const a = measures[i], b = measures[i + 1];
      if (!measureOk(a && a.id) || !measureOk(b && b.id) || !nominalAt(i)) continue;
      const repeatHere = (isObj(a.barline) && isObj(a.barline.right) && a.barline.right.repeat) ||
        (isObj(b.barline) && isObj(b.barline.left) && b.barline.left.repeat);
      const endingHere = endingTo.has(i) || endingFrom.has(i + 1);
      if ((repeatHere || endingHere) && R.eq(R.add(durOf(i), durOf(i + 1)), nominalAt(i))) { excused.add(i); excused.add(i + 1); }
    }
    measures.forEach((m, i) => {
      if (!measureOk(m && m.id) || m.implicit === true || excused.has(i)) return;
      const nom = nominalAt(i);
      if (nom && !R.eq(durOf(i), nom)) add('W-MEASURE-LENGTH', 'measure ' + m.id + ' lasts ' + R.format(durOf(i)) + ', its time signature ' + R.format(nom), [m.id]);
    });

    /* --- clefs */
    parts.forEach((part, pi) => {
      if (!isObj(part) || !measures.length || !isObj(measures[0])) return;
      arr(part.staves).forEach(st => {
        if (!ok(st)) return;
        if (!arr(part.clefs).some(cl => isObj(cl) && cl.staff === st.id && cl.m === measures[0].id))
          add('W-CLEF-MISSING', 'staff ' + st.id + ' has no clef in the first measure', [st.id], loc(pi, { m: measures[0].id }));
      });
    });

    /* --- structure */
    const sections = arr(structure.sections).filter(ok);
    const secById = new Map(sections.map(s => [s.id, s]));
    sections.forEach(s => {
      const a = mIdx(s.from), b = mIdx(s.to);
      if (a >= 0 && b >= 0 && a > b) { add('E-STRUCTURE', 'section ' + s.id + ' ends before it starts', [s.id]); broken.add(s); }
      let p = s.parent !== undefined ? secById.get(s.parent) : null;
      const seen = new Set([s.id]);
      while (p) {
        if (seen.has(p.id)) { add('E-STRUCTURE', 'the parents of section ' + s.id + ' form a cycle', [s.id]); broken.add(s); break; }
        seen.add(p.id);
        p = p.parent !== undefined ? secById.get(p.parent) : null;
      }
    });
    sections.forEach((a, i) => sections.slice(i + 1).forEach(b => {
      if (broken.has(a) || broken.has(b) || a.parent !== b.parent) return;
      if (mIdx(a.from) <= mIdx(b.to) && mIdx(b.from) <= mIdx(a.to)) add('E-STRUCTURE', 'sibling sections ' + a.id + ' and ' + b.id + ' overlap', [a.id, b.id]);
    }));
    arr(structure.phrases).forEach(ph => {
      if (!ok(ph)) return;
      const a = W(ph.from), b = W(ph.to);
      if (a && b && R.ge(a, b)) add('E-STRUCTURE', 'phrase ' + ph.id + ' ends at or before its start', [ph.id]);
    });
    flags.forEach(fl => {
      if (!ok(fl) || !isObj(fl.span)) return;
      const a = W(fl.span.from), b = W(fl.span.to);
      if (a && b && R.ge(a, b)) add('E-SPAN-ORDER', 'flag ' + fl.id + ' ends at or before its start', [fl.id]);
    });

    /* --- performances */
    const visitIndex = visits ? new Map(visits.map((v, i) => [v.m + '|' + v.k, i])) : null;
    arr(g.performances).forEach(pf => {
      if (!isObj(pf)) return;
      arr(pf.notes).forEach(pn => {
        if (!ok(pn)) return;
        const why = [];
        if (pn.on < 0) why.push('a negative onset');
        if (pn.off <= pn.on) why.push('off <= on');
        if (pn.vel < 1 || pn.vel > 127) why.push('velocity ' + pn.vel);
        if (pn.midi === undefined && pn.inst === undefined) why.push('neither midi nor inst');
        if (pn.inst !== undefined && pn.part === undefined) why.push('a percussion note without its part');
        if (why.length) { add('E-PERF', 'performance note ' + pn.id + ' has ' + why.join(', '), [pn.id]); return; }
        if (pn.link !== undefined && pn.midi !== undefined) {
          const h = headById.get(pn.link);
          if (h && isObj(h.pitch) && P.PC[h.pitch.step] !== undefined && P.midi(h.pitch) !== pn.midi)
            add('W-PERF-LINK-PITCH', 'performance note ' + pn.id + ' (MIDI ' + pn.midi + ') is linked to ' + h.id + ' (MIDI ' + P.midi(h.pitch) + ')', [pn.id, h.id]);
        }
      });
      arr(pf.pedals).forEach(pp => {
        if (ok(pp) && (pp.on < 0 || pp.off <= pp.on)) add('E-PERF', 'performance pedal ' + pp.id + ' has on ' + pp.on + ', off ' + pp.off, [pp.id]);
      });
      const anchors = arr(pf.anchors).filter(ok);
      let anchorsOk = true;
      anchors.forEach(a => {
        if (a.us < 0) { add('E-PERF', 'an anchor of ' + pf.id + ' is at a negative time', [pf.id]); anchorsOk = false; }
        else if (!checkPos(null, a, 'anchor of ' + pf.id, false, -1)) anchorsOk = false;
        else if (visitIndex && !visitIndex.has(a.m + '|' + a.k)) { add('E-PERF', 'an anchor of ' + pf.id + ' names visit ' + a.k + ' of ' + a.m + ', which the play order has no', [pf.id]); anchorsOk = false; }
      });
      if (anchorsOk && visitIndex && anchors.length > 1) {
        const pts = anchors.map(a => ({ v: visitIndex.get(a.m + '|' + a.k), at: R.parse(a.at), us: a.us }))
          .sort((x, y) => x.v - y.v || R.cmp(x.at, y.at));
        for (let i = 1; i < pts.length; i++) {
          const samePos = pts[i].v === pts[i - 1].v && R.eq(pts[i].at, pts[i - 1].at);
          if (samePos || pts[i].us <= pts[i - 1].us) { add('E-PERF', 'the anchors of ' + pf.id + ' do not increase strictly in play order and time', [pf.id]); break; }
        }
      }
    });

    /* --- INFO */
    if (!arr(tl.tempos).some(t => isObj(t) && t.qpm !== undefined)) add('I-NO-TEMPO', 'no tempo is written: playback uses the caller\'s default');
    if (!arr(tl.keys).length) add('I-NO-KEY', 'no key signature is written');
    if (arr(tl.jumps).length) add('I-JUMP-IGNORED', 'the play order does not follow ' + arr(tl.jumps).length + ' jump(s) (D.C., D.S., Coda) in G1', arr(tl.jumps).map(j => j && j.id));
    let unset = 0;
    parts.forEach(part => {
      if (!isObj(part) || !Array.isArray(part.voices) || !Array.isArray(part.staves)) return;
      arr(part.events).forEach(e => { if (isObj(e)) arr(e.heads).forEach(h => { if (isObj(h) && !P.limbOf(part, e, h)) unset++; }); });
    });
    if (unset) add('I-LIMB-UNSET', unset + ' head(s) have no limb from head, voice or staff');
    /* I-PROV-REDUNDANT: a prov field equal to what the entity inherits anyway (§11.2, §11.6) */
    const dflt = prov && isObj(prov.default) ? prov.default : {};
    const inherit = (chain, f) => { for (const pr of chain) if (isObj(pr) && pr[f] !== undefined) return pr[f]; return undefined; };
    function redundant(o, chain) {
      if (!isObj(o) || !isObj(o.prov)) return;
      const same = ['src', 'op', 'conf'].filter(f => o.prov[f] !== undefined && o.prov[f] === inherit(chain, f));
      if (same.length) add('I-PROV-REDUNDANT', (o.id || 'an entity') + ' repeats its inherited ' + same.join(', '), o.id ? [o.id] : undefined);
    }
    measures.forEach(m => redundant(m, [dflt]));
    parts.forEach(part => {
      if (!isObj(part)) return;
      redundant(part, [dflt]);
      const pc = [part.prov, dflt];
      arr(part.events).forEach(e => {
        redundant(e, pc);
        if (isObj(e)) arr(e.heads).forEach(h => redundant(h, [e.prov].concat(pc)));
      });
      arr(part.spanners).forEach(s => redundant(s, pc));
      arr(part.directions).forEach(d => redundant(d, pc));
    });
    arr(structure.sections).forEach(s => redundant(s, [dflt]));
    arr(structure.phrases).forEach(s => redundant(s, [dflt]));
    const ns = new Set();
    const collectExt = o => { if (isObj(o) && isObj(o.ext)) Object.keys(o.ext).forEach(k => ns.add(k)); };
    collectExt(g);
    measures.forEach(collectExt);
    parts.forEach(part => {
      collectExt(part);
      if (!isObj(part)) return;
      arr(part.events).forEach(e => { collectExt(e); if (isObj(e)) arr(e.heads).forEach(collectExt); });
      arr(part.spanners).forEach(collectExt);
      arr(part.directions).forEach(collectExt);
    });
    if (ns.size) add('I-EXT', 'ext namespaces: ' + Array.from(ns).sort().join(', '));

    return finish();
  }

  return Object.freeze({ validate, CODES, ERRORS, WARNINGS, INFOS, SEVERITY });
});
