/* ============================================================================
   PPP ScoreGraph — schema v1 as data (docs/GOALS/G01 §5, §14.2)

   Every entity and every nested value object is a shape: an ordered list of
   fields. The order is the canonical key order of the serializer (§14.2); the
   types, required flags and defaults are what the validator's E-SHAPE rule
   checks and what the serializer leaves out. Tagged unions (Event by kind,
   Head by pitch/inst, Spanner by type, Direction by kind) list every field of
   every member once, in canonical order, each marked with the members it
   belongs to.

   Nothing here computes; see validate.js, serialize.js and pitch.js.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rational.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.schema = factory(M.rational); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  const SCOREGRAPH_VERSION = 1;

  const NOTE_TYPES = ['maxima', 'long', 'breve', 'whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th',
    '128th', '256th', '512th', '1024th'];
  /* Value of each note type in W (whole = 1). */
  const NOTE_TYPE_VALUE = {};
  NOTE_TYPES.forEach((t, i) => { NOTE_TYPE_VALUE[t] = i <= 3 ? R.make(Math.pow(2, 3 - i)) : R.make(1, Math.pow(2, i - 3)); });

  const STEPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const LIMBS = ['RH', 'LH', 'RF', 'LF'];
  const PLACEMENTS = ['above', 'below'];
  const BAR_STYLES = ['regular', 'dotted', 'dashed', 'heavy', 'light-light', 'light-heavy', 'heavy-light', 'heavy-heavy',
    'tick', 'short', 'none'];
  const MODES = ['major', 'minor', 'ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian', 'none'];
  /* Articulations in their canonical (enum) order: event.arts is sorted by this order. */
  const ARTICULATIONS = ['staccato', 'staccatissimo', 'tenuto', 'accent', 'marcato', 'spiccato', 'stress', 'unstress',
    'detached-legato', 'breath-mark', 'caesura'];
  const ORNAMENTS = ['trill', 'mordent', 'inverted-mordent', 'turn', 'inverted-turn', 'tremolo', 'shake', 'schleifer'];
  const ACCIDENTALS = ['sharp', 'flat', 'natural', 'double-sharp', 'flat-flat', 'sharp-sharp', 'natural-sharp',
    'natural-flat', 'quarter-sharp', 'quarter-flat'];
  const NOTEHEADS = ['normal', 'x', 'circle-x', 'diamond', 'triangle', 'slash', 'square', 'cross'];
  const STROKES = ['normal', 'rim', 'cross-stick', 'flam', 'drag', 'buzz', 'choke', 'ghost'];
  const DYNAMICS = ['pppppp', 'ppppp', 'pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'fffff', 'ffffff',
    'sf', 'sfz', 'sffz', 'sfp', 'sfpp', 'fp', 'fz', 'rf', 'rfz', 'pf', 'n', 'other'];
  const SOURCE_KINDS = ['musicxml', 'mxl', 'omr', 'amt', 'audio-score', 'midi-file', 'midi-input', 'user', 'generator',
    'repair', 'legacy-score'];
  const PROV_OPS = ['imported', 'inferred', 'generated', 'repaired', 'edited'];
  const ASPECTS = ['exists', 'pitch', 'spelling', 'rhythm', 'voice', 'staff', 'limb', 'fingering', 'display'];
  const FAMILIES = ['keyboard', 'percussion', 'plucked', 'bowed', 'wind', 'brass', 'voice', 'other'];
  /* The instrument vocabulary and each kind's family (§5.5). Widening it is a version change. */
  const INSTRUMENT_KINDS = {
    'piano': 'keyboard', 'organ': 'keyboard', 'harpsichord': 'keyboard', 'electric-piano': 'keyboard',
    'synthesizer': 'keyboard',
    'drumset': 'percussion', 'percussion': 'percussion',
    'acoustic-guitar': 'plucked', 'electric-guitar': 'plucked', 'electric-bass': 'plucked', 'acoustic-bass': 'plucked',
    'violin': 'bowed', 'viola': 'bowed', 'cello': 'bowed', 'contrabass': 'bowed',
    'flute': 'wind', 'oboe': 'wind', 'clarinet': 'wind', 'bassoon': 'wind', 'saxophone': 'wind',
    'trumpet': 'brass', 'horn': 'brass', 'trombone': 'brass', 'tuba': 'brass',
    'voice': 'voice',
    'unknown': 'other'
  };

  const ID_RE = /^[a-z]{1,2}[1-9][0-9]*$/;
  const SCORE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
  const EXT_NS_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
  const KIT_KEY_RE = /^[a-z][a-z0-9-]*$/;

  /* ------------------------------------------------------------- types */
  const T = {
    str: re => ({ t: 'str', re: re || null }),
    int: (min, max) => ({ t: 'int', min: min == null ? null : min, max: max == null ? null : max }),
    ints: values => ({ t: 'int', values: values }),
    bool: () => ({ t: 'bool' }),
    num3: (min, max) => ({ t: 'num3', min: min == null ? null : min, max: max == null ? null : max }),
    rat: () => ({ t: 'rat' }),
    en: values => ({ t: 'enum', values: values }),
    id: prefix => ({ t: 'id', prefix: prefix }),
    ref: kinds => ({ t: 'ref', kinds: kinds }),
    arr: (of, min) => ({ t: 'arr', of: of, min: min || 0 }),
    obj: shape => ({ t: 'obj', shape: shape }),
    json: () => ({ t: 'json' }),
    ext: () => ({ t: 'ext' }),
    asp: () => ({ t: 'asp' }),
    conf: () => ({ t: 'conf' })
  };
  /* A field: name, type, and options {req, def, only (union members it belongs to)}. */
  const f = (name, type, o) => Object.assign({ name: name, type: type, req: false, def: undefined, only: null }, o || {});
  const req = { req: true };

  const POS = 'Pos';
  const SHAPES = {
    /* --- common value objects */
    Pos: [f('m', T.ref(['m']), req), f('at', T.rat(), req)],
    StepOct: [f('step', T.en(STEPS), req), f('oct', T.int(0, 9), req)],
    StepAlter: [f('step', T.en(STEPS), req), f('alter', T.int(-3, 3), { def: 0 })],
    ProvAspect: [f('src', T.ref(['sr'])), f('op', T.en(PROV_OPS)), f('conf', T.conf())],
    ProvRef: [f('src', T.ref(['sr'])), f('op', T.en(PROV_OPS)), f('conf', T.conf()), f('asp', T.asp())],
    Display: [f('part', T.ref(['p']), req), f('staff', T.ref(['st'])), f('placement', T.en(PLACEMENTS))],

    /* --- root */
    ScoreGraph: [
      f('scoregraph_version', T.int(0), req), f('id', T.str(SCORE_ID_RE), req), f('rev', T.int(0), req),
      f('nextId', T.int(1), req), f('meta', T.obj('Metadata'), req), f('timeline', T.obj('Timeline'), req),
      f('parts', T.arr(T.obj('Part'), 1), req), f('structure', T.obj('Structure')),
      f('performances', T.arr(T.obj('Performance'))), f('provenance', T.obj('Provenance'), req), f('ext', T.ext())],
    Metadata: ['title', 'subtitle', 'composer', 'arranger', 'lyricist', 'copyright', 'workNumber', 'movementNumber',
      'movementTitle'].map(n => f(n, T.str())),

    /* --- timeline */
    Timeline: [f('measures', T.arr(T.obj('Measure'), 1), req), f('meters', T.arr(T.obj('MeterEvent')), req),
      f('keys', T.arr(T.obj('KeyEvent'))), f('tempos', T.arr(T.obj('TempoEvent'))),
      f('endings', T.arr(T.obj('Ending'))), f('jumps', T.arr(T.obj('Jump')))],
    Measure: [f('id', T.id('m'), req), f('number', T.str(), req), f('dur', T.rat(), req),
      f('implicit', T.bool(), { def: false }), f('barline', T.obj('BarlinePair')), f('layout', T.obj('Layout')),
      f('prov', T.obj('ProvRef')), f('ext', T.ext())],
    BarlinePair: [f('left', T.obj('Barline')), f('right', T.obj('Barline'))],
    /* times: E-REPEAT, not E-SHAPE, below 2 */
    Barline: [f('style', T.en(BAR_STYLES)), f('repeat', T.en(['forward', 'backward'])), f('times', T.int())],
    Layout: [f('newSystem', T.bool(), { def: false }), f('newPage', T.bool(), { def: false }), f('width', T.num3(0))],
    MeterEvent: [f('id', T.id('mt'), req), f('m', T.ref(['m']), req), f('beats', T.arr(T.int(1), 1), req),
      f('beatType', T.int(), req), f('symbol', T.en(['common', 'cut', 'single-number', 'normal'])),
      f('groups', T.arr(T.rat())), f('hidden', T.bool(), { def: false })],
    KeyEvent: [f('id', T.id('ky'), req), f('m', T.ref(['m']), req), f('at', T.rat(), req), f('fifths', T.int(), req),
      f('mode', T.en(MODES)), f('scope', T.obj('KeyScope')), f('hidden', T.bool(), { def: false })],
    KeyScope: [f('part', T.ref(['p']), req), f('staff', T.ref(['st']))],
    TempoEvent: [f('id', T.id('tp'), req), f('m', T.ref(['m']), req), f('at', T.rat(), req), f('qpm', T.rat()),
      f('mark', T.obj('TempoMark')), f('display', T.arr(T.obj('Display')))],
    TempoMark: [f('unit', T.en(NOTE_TYPES)), f('dots', T.int(1, 4)), f('perMinute', T.rat()), f('text', T.str()),
      f('parens', T.bool(), { def: false })],
    Ending: [f('id', T.id('en'), req), f('numbers', T.arr(T.int()), req), f('text', T.str()),
      f('from', T.ref(['m']), req), f('to', T.ref(['m']), req), f('open', T.bool(), { def: false })],
    Jump: [f('id', T.id('j'), req), f('kind', T.en(['segno', 'coda', 'fine', 'dacapo', 'dalsegno', 'tocoda']), req),
      f('m', T.ref(['m']), req), f('at', T.rat(), req), f('target', T.ref(['j'])), f('text', T.str()),
      f('display', T.arr(T.obj('Display')))],

    /* --- parts */
    Part: [f('id', T.id('p'), req), f('name', T.str()), f('abbr', T.str()), f('instrument', T.obj('Instrument'), req),
      f('staves', T.arr(T.obj('Staff'), 1), req), f('voices', T.arr(T.obj('Voice')), req),
      f('clefs', T.arr(T.obj('Clef')), req), f('events', T.arr(T.obj('Event')), req),
      f('directions', T.arr(T.obj('Direction')), req), f('spanners', T.arr(T.obj('Spanner')), req),
      f('prov', T.obj('ProvRef')), f('ext', T.ext())],
    Instrument: [f('kind', T.en(Object.keys(INSTRUMENT_KINDS)), req), f('family', T.en(FAMILIES), req),
      f('name', T.str()), f('midi', T.obj('InstrumentMidi')), f('transpose', T.obj('Transpose')),
      f('range', T.obj('Range')), f('kit', T.obj('PercKit'))],
    InstrumentMidi: [f('program', T.int(1, 128)), f('channel', T.int(1, 16)), f('bank', T.int(0))],
    Transpose: [f('chromatic', T.int(), req), f('diatonic', T.int(), req), f('octave', T.int(), { def: 0 })],
    Range: [f('low', T.int(0, 127), req), f('high', T.int(0, 127), req)],
    PercKit: [f('items', T.arr(T.obj('KitItem'), 1), req)],
    KitItem: [f('key', T.str(KIT_KEY_RE), req), f('name', T.str()), f('gm', T.int(27, 87)),
      f('pos', T.obj('StepOct'), req), f('notehead', T.en(NOTEHEADS)), f('stem', T.en(['up', 'down']))],
    Staff: [f('id', T.id('st'), req), f('kind', T.en(['standard', 'percussion', 'tab']), { def: 'standard' }),
      f('lines', T.int(0, 10), { def: 5 }), f('limb', T.en(LIMBS))],
    Voice: [f('id', T.id('v'), req), f('staff', T.ref(['st']), req), f('label', T.str()), f('limb', T.en(LIMBS))],
    /* line's default depends on sign (serialize.js CLEF_LINE) */
    Clef: [f('id', T.id('c'), req), f('staff', T.ref(['st']), req), f('m', T.ref(['m']), req), f('at', T.rat(), req),
      f('sign', T.en(['G', 'F', 'C', 'percussion', 'TAB', 'none']), req), f('line', T.int(1, 10)),
      f('octave', T.int(-3, 3), { def: 0 })],

    /* --- events (tagged union on kind) */
    Event: [f('id', T.id('e'), req), f('kind', T.en(['note', 'perc', 'rest']), req), f('m', T.ref(['m']), req),
      f('at', T.rat(), req), f('dur', T.rat(), req), f('voice', T.ref(['v']), req), f('staff', T.ref(['st']), req),
      f('hidden', T.bool(), { def: false }), f('grace', T.obj('Grace')),
      f('cue', T.bool(), { def: false, only: ['note'] }), f('display', T.obj('EventDisplay')),
      /* heads: required for note and perc; a missing or empty list is E-HEADS, not E-SHAPE */
      f('heads', T.arr(T.obj('Head')), { only: ['note', 'perc'] }),
      f('arts', T.arr(T.en(ARTICULATIONS)), { only: ['note', 'perc'] }),
      f('orn', T.arr(T.obj('Ornament')), { only: ['note', 'perc'] }), f('fermata', T.obj('Fermata')),
      f('lyrics', T.arr(T.obj('Lyric')), { only: ['note'] }), f('prov', T.obj('ProvRef')), f('ext', T.ext())],
    Grace: [f('order', T.int(1), req), f('slash', T.bool(), { def: false })],
    EventDisplay: [f('type', T.en(NOTE_TYPES)), f('dots', T.int(1, 4)), f('stem', T.en(['up', 'down', 'none', 'double'])),
      f('size', T.en(['cue', 'grace', 'large'])), f('x', T.num3()),
      f('measureRest', T.bool(), { def: false, only: ['rest'] }), f('pos', T.obj('StepOct'), { only: ['rest'] })],
    Ornament: [f('type', T.en(ORNAMENTS), req), f('marks', T.int(1)), f('acc', T.str())],
    Fermata: [f('shape', T.en(['normal', 'angled', 'square'])), f('inverted', T.bool(), { def: false })],
    Lyric: [f('verse', T.int(1), { def: 1 }), f('text', T.str(), req),
      f('syllabic', T.en(['single', 'begin', 'middle', 'end'])), f('extend', T.bool(), { def: false })],

    /* --- heads (tagged union: pitched when pitch is present, perc when inst is) */
    Head: [f('id', T.id('h'), req), f('pitch', T.obj('Pitch'), { only: ['pitched'] }),
      f('inst', T.str(KIT_KEY_RE), { only: ['perc'] }), f('staff', T.ref(['st']), { only: ['pitched'] }),
      f('pos', T.obj('StepOct'), { only: ['perc'] }), f('acc', T.obj('Accidental'), { only: ['pitched'] }),
      f('notehead', T.obj('Notehead')), f('fingering', T.arr(T.obj('Fingering')), { only: ['pitched'] }),
      f('limb', T.en(LIMBS)), f('stroke', T.en(STROKES), { only: ['perc'] }),
      f('lead', T.bool(), { def: false, only: ['pitched'] }), f('tech', T.obj('Tech'), { only: ['pitched'] }),
      f('prov', T.obj('ProvRef')), f('ext', T.ext())],
    Pitch: [f('step', T.en(STEPS), req), f('alter', T.int(-3, 3), { def: 0 }), f('oct', T.int(0, 9), req)],
    Accidental: [f('type', T.en(ACCIDENTALS), req), f('cautionary', T.bool(), { def: false }),
      f('editorial', T.bool(), { def: false }), f('paren', T.bool(), { def: false }), f('bracket', T.bool(), { def: false })],
    /* filled has no default: filled="no" and filled="yes" are both statements */
    Notehead: [f('shape', T.en(NOTEHEADS)), f('filled', T.bool()), f('paren', T.bool(), { def: false })],
    Fingering: [f('f', T.str(), req), f('subst', T.bool(), { def: false }), f('alt', T.bool(), { def: false }),
      f('placement', T.en(PLACEMENTS))],
    Tech: [f('string', T.int(1)), f('fret', T.int(0))],

    /* --- directions (tagged union on kind) */
    Direction: [f('id', T.id('d'), req), f('kind', T.en(['dynamic', 'words', 'rehearsal', 'chord']), req),
      f('m', T.ref(['m']), req), f('at', T.rat(), req), f('staff', T.ref(['st'])), f('voice', T.ref(['v'])),
      f('event', T.ref(['e'])), f('placement', T.en(PLACEMENTS)),
      f('value', T.en(DYNAMICS), { req: true, only: ['dynamic'] }),
      f('root', T.obj('StepAlter'), { req: true, only: ['chord'] }),
      /* §5.8 names this field "kind", which the union's own discriminator already uses; see G01 §24 */
      f('chordKind', T.str(), { req: true, only: ['chord'] }),
      f('bass', T.obj('StepAlter'), { only: ['chord'] }), f('degrees', T.arr(T.obj('Degree')), { only: ['chord'] }),
      f('text', T.str(), { only: ['dynamic', 'words', 'rehearsal', 'chord'] }),
      f('prov', T.obj('ProvRef')), f('ext', T.ext())],
    Degree: [f('value', T.int(1), req), f('alter', T.int(-3, 3), req), f('type', T.en(['add', 'alter', 'subtract']), req)],

    /* --- spanners (tagged union on type) */
    Spanner: [f('id', T.id('s'), req),
      f('type', T.en(['tie', 'slur', 'tuplet', 'beam', 'wedge', 'pedal', 'ottava', 'arpeggio']), req),
      /* tie and slur name their ends by ID; wedge, pedal and ottava by position (validate.js SPANNER_FIELDS) */
      f('kind', T.en(['crescendo', 'diminuendo']), { req: true, only: ['wedge'] }),
      f('pedal', T.en(['damper', 'sostenuto', 'soft']), { req: true, only: ['pedal'] }),
      f('staff', T.ref(['st']), { only: ['wedge', 'ottava'] }),
      f('shift', T.ints([-3, -2, -1, 1, 2, 3]), { req: true, only: ['ottava'] }),
      f('from', null, { only: ['tie', 'slur', 'wedge', 'pedal', 'ottava'] }),
      f('to', null, { only: ['tie', 'slur', 'wedge', 'pedal', 'ottava'] }),
      f('changes', T.arr(T.obj(POS)), { only: ['pedal'] }),
      f('events', T.arr(T.ref(['e'])), { only: ['tuplet', 'beam'] }),
      f('heads', T.arr(T.ref(['h'])), { only: ['arpeggio'] }),
      f('breaks', T.arr(T.obj('BeamBreak')), { only: ['beam'] }),
      f('actual', T.int(), { req: true, only: ['tuplet'] }), f('normal', T.int(), { req: true, only: ['tuplet'] }),
      f('unit', T.obj('TupletUnit'), { only: ['tuplet'] }), f('parent', T.ref(['s']), { only: ['tuplet'] }),
      f('show', T.obj('TupletShow'), { only: ['tuplet'] }), f('printed', T.bool(), { def: true, only: ['tuplet'] }),
      f('placement', T.en(PLACEMENTS), { only: ['slur', 'wedge'] }),
      f('line', T.en(['solid', 'dashed', 'dotted']), { only: ['slur'] }),
      f('niente', T.bool(), { def: false, only: ['wedge'] }),
      f('mark', T.obj('PedalMark'), { only: ['pedal'] }), f('text', T.str(), { only: ['pedal'] }),
      f('soundOnly', T.bool(), { def: false, only: ['pedal'] }), f('depth', T.int(1, 127), { only: ['pedal'] }),
      f('dir', T.en(['up', 'down']), { only: ['arpeggio'] }), f('non', T.bool(), { def: false, only: ['arpeggio'] }),
      f('prov', T.obj('ProvRef')), f('ext', T.ext())],
    BeamBreak: [f('after', T.ref(['e']), req), f('level', T.int(1), req)],
    TupletUnit: [f('type', T.en(NOTE_TYPES), req), f('dots', T.int(1, 4))],
    TupletShow: [f('number', T.en(['actual', 'both', 'none'])), f('bracket', T.bool(), { def: true }),
      f('placement', T.en(PLACEMENTS))],
    /* line has no default (line="yes" and line="no" both occur); a printed sign is the default */
    PedalMark: [f('line', T.bool()), f('sign', T.bool(), { def: true })],

    /* --- structure */
    Structure: [f('sections', T.arr(T.obj('Section'))), f('phrases', T.arr(T.obj('Phrase')))],
    Section: [f('id', T.id('sc'), req), f('label', T.str()), f('from', T.ref(['m']), req), f('to', T.ref(['m']), req),
      f('parent', T.ref(['sc'])), f('prov', T.obj('ProvRef'))],
    Phrase: [f('id', T.id('ph'), req), f('part', T.ref(['p'])), f('voices', T.arr(T.ref(['v']))),
      f('from', T.obj(POS), req), f('to', T.obj(POS), req), f('section', T.ref(['sc'])), f('prov', T.obj('ProvRef'))],

    /* --- performances */
    Performance: [f('id', T.id('pf'), req), f('kind', T.en(['source', 'take', 'render']), req), f('src', T.ref(['sr'])),
      f('label', T.str()), f('notes', T.arr(T.obj('PerfNote')), req), f('pedals', T.arr(T.obj('PerfPedal'))),
      f('anchors', T.arr(T.obj('Anchor')))],
    PerfNote: [f('id', T.id('pn'), req), f('on', T.int(), req), f('off', T.int(), req), f('vel', T.int(), req),
      f('midi', T.int(0, 127)), f('inst', T.str(KIT_KEY_RE)), f('part', T.ref(['p'])), f('link', T.ref(['h'])),
      f('conf', T.conf())],
    PerfPedal: [f('id', T.id('pp'), req), f('pedal', T.en(['damper', 'sostenuto', 'soft']), req), f('on', T.int(), req),
      f('off', T.int(), req), f('depth', T.int(1, 127))],
    Anchor: [f('m', T.ref(['m']), req), f('k', T.int(1), req), f('at', T.rat(), req), f('us', T.int(), req),
      f('kind', T.en(['bar', 'beat']))],

    /* --- provenance */
    Provenance: [f('sources', T.arr(T.obj('Source'), 1), req), f('default', T.obj('ProvRef')),
      f('flags', T.arr(T.obj('Flag')))],
    Source: [f('id', T.id('sr'), req), f('kind', T.en(SOURCE_KINDS), req), f('tool', T.str()), f('version', T.str()),
      f('input', T.obj('SourceInput')), f('params', T.json()), f('time', T.str()), f('note', T.str())],
    SourceInput: [f('name', T.str()), f('sha256', T.str(/^[0-9a-f]{64}$/))],
    Flag: [f('id', T.id('fl'), req), f('kind', T.en(['uncertain', 'suspect', 'review', 'conflict']), req),
      f('span', T.obj('FlagSpan')), f('ids', T.arr(T.ref(null))), f('conf', T.conf()), f('src', T.ref(['sr'])),
      f('code', T.str()), f('note', T.str())],
    FlagSpan: [f('part', T.ref(['p'])), f('from', T.obj(POS), req), f('to', T.obj(POS), req)]
  };

  /* The types of the ends of each spanner type (§5.10). */
  const SPANNER_ENDS = {
    tie: T.ref(['h']), slur: T.ref(['e']), wedge: T.obj(POS), pedal: T.obj(POS), ottava: T.obj(POS)
  };
  /* Canonical field order per spanner type: id, type, the §5.10 table's order, prov, ext. One merged list
     cannot serve all types (a wedge's staff follows its ends, an ottava's precedes its shift). */
  const SPANNER_ORDER = {
    tie: ['from', 'to'],
    slur: ['from', 'to', 'placement', 'line'],
    tuplet: ['events', 'actual', 'normal', 'unit', 'parent', 'show', 'printed'],
    beam: ['events', 'breaks'],
    wedge: ['kind', 'from', 'to', 'staff', 'placement', 'niente'],
    pedal: ['pedal', 'from', 'to', 'changes', 'mark', 'text', 'soundOnly', 'depth'],
    ottava: ['staff', 'shift', 'from', 'to'],
    arpeggio: ['heads', 'dir', 'non']
  };
  /* Required fields per spanner type beyond id and type. */
  const SPANNER_REQUIRED = {
    tuplet: ['events', 'actual', 'normal'], beam: ['events'], wedge: ['kind', 'from', 'to'], pedal: ['pedal', 'from'],
    ottava: ['staff', 'shift', 'from', 'to'], arpeggio: ['heads'], tie: [], slur: []
  };

  /* The 21 entities, their ID prefixes and owners (§5.14, A4). */
  const ENTITY_KINDS = Object.freeze([
    ['Measure', 'm', 'timeline.measures'], ['MeterEvent', 'mt', 'timeline.meters'], ['KeyEvent', 'ky', 'timeline.keys'],
    ['TempoEvent', 'tp', 'timeline.tempos'], ['Ending', 'en', 'timeline.endings'], ['Jump', 'j', 'timeline.jumps'],
    ['Part', 'p', 'parts'], ['Staff', 'st', 'part.staves'], ['Voice', 'v', 'part.voices'], ['Clef', 'c', 'part.clefs'],
    ['Event', 'e', 'part.events'], ['Head', 'h', 'event.heads'], ['Direction', 'd', 'part.directions'],
    ['Spanner', 's', 'part.spanners'], ['Section', 'sc', 'structure.sections'], ['Phrase', 'ph', 'structure.phrases'],
    ['Performance', 'pf', 'performances'], ['PerfNote', 'pn', 'performance.notes'],
    ['PerfPedal', 'pp', 'performance.pedals'], ['Source', 'sr', 'provenance.sources'], ['Flag', 'fl', 'provenance.flags']
  ].map(([name, prefix, owner]) => Object.freeze({ name: name, prefix: prefix, owner: owner })));
  const PREFIX_OF = {};
  const KIND_OF_PREFIX = {};
  ENTITY_KINDS.forEach(k => { PREFIX_OF[k.name] = k.prefix; KIND_OF_PREFIX[k.prefix] = k.name; });

  /* Where ext may appear (§5.13). */
  const EXT_HOSTS = ['ScoreGraph', 'Part', 'Event', 'Head', 'Measure', 'Spanner', 'Direction'];

  /* ------------------------------------------------------------- helpers */
  function idPrefix(id) {
    const m = /^([a-z]{1,2})[1-9][0-9]*$/.exec(id);
    return m ? m[1] : null;
  }
  function idNumber(id) {
    const m = /^[a-z]{1,2}([1-9][0-9]*)$/.exec(id);
    return m ? Number(m[1]) : null;
  }
  function makeId(prefix, n) { return prefix + n; }

  /* The union member a value belongs to. */
  function unionTag(shapeName, value) {
    if (!value || typeof value !== 'object') return null;
    if (shapeName === 'Event' || shapeName === 'Direction') return value.kind;
    if (shapeName === 'Spanner') return value.type;
    if (shapeName === 'Head') return value.inst !== undefined && value.pitch === undefined ? 'perc' : 'pitched';
    return null;
  }
  const SPANNER_BY_NAME = {};
  function fieldsOf(shapeName, value) {
    const all = SHAPES[shapeName];
    const tag = unionTag(shapeName, value);
    if (tag == null) return all;
    if (shapeName === 'Spanner') {
      if (!SPANNER_ORDER[tag]) return all.filter(fd => !fd.only);
      if (!SPANNER_BY_NAME[tag]) {
        const byName = {};
        all.forEach(fd => { byName[fd.name] = fd; });
        SPANNER_BY_NAME[tag] = [byName.id, byName.type].concat(SPANNER_ORDER[tag].map(n => byName[n]), [byName.prov, byName.ext]);
      }
      return SPANNER_BY_NAME[tag];
    }
    return all.filter(fd => !fd.only || fd.only.indexOf(tag) >= 0);
  }
  /* A field's type, resolving the spanner ends that depend on the type. */
  function fieldType(shapeName, fd, value) {
    if (fd.type) return fd.type;
    if (shapeName === 'Spanner') return SPANNER_ENDS[value.type] || null;
    return null;
  }
  function fieldRequired(shapeName, fd, value) {
    if (shapeName === 'Spanner' && fd.name !== 'id' && fd.name !== 'type')
      return (SPANNER_REQUIRED[value.type] || []).indexOf(fd.name) >= 0;
    return fd.req;
  }

  /* Written value of a note type with dots, in W: value × (2 − 1/2^dots). */
  function noteValue(type, dots) {
    const v = NOTE_TYPE_VALUE[type];
    if (!v) return null;
    const k = dots || 0;
    return R.mul(v, R.make(Math.pow(2, k + 1) - 1, Math.pow(2, k)));
  }

  return Object.freeze({
    SCOREGRAPH_VERSION, NOTE_TYPES, NOTE_TYPE_VALUE, STEPS, LIMBS, PLACEMENTS, BAR_STYLES, MODES, ARTICULATIONS,
    ORNAMENTS, ACCIDENTALS, NOTEHEADS, STROKES, DYNAMICS, SOURCE_KINDS, PROV_OPS, ASPECTS, FAMILIES, INSTRUMENT_KINDS,
    ID_RE, SCORE_ID_RE, EXT_NS_RE, KIT_KEY_RE, SHAPES, SPANNER_ENDS, SPANNER_ORDER, SPANNER_REQUIRED, ENTITY_KINDS, PREFIX_OF,
    KIND_OF_PREFIX, EXT_HOSTS, idPrefix, idNumber, makeId, unionTag, fieldsOf, fieldType, fieldRequired, noteValue
  });
});
