/* ============================================================================
   PPP ScoreGraph — the library (docs/GOALS/G01)

   A versioned, plain-JSON canonical score and the pure functions around it.
   No dependencies, no build step: the same files run in Node (require this
   file) and in the browser (a <script> tag per file, this one last, which
   leaves window.PPPScoreGraph).

   Browser order: rational, schema, pitch, time, serialize, validate, build,
   prov, ops, xml, musicxml-import, musicxml-export, midi-file, midi-import,
   legacy-score, import, meter-grid, pro-critic, pro-staff, pro-voice, pro-rhythm,
   pro-tuplet, pro-spell, pro-beam, pro-marks, pro, index.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(name => require('./' + name + '.js'));
  } else {
    const M = root.PPPScoreGraphModules || {};
    root.PPPScoreGraph = factory(name => {
      const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!M[key]) throw new Error('PPPScoreGraph: scoregraph/' + name + '.js is not loaded (load it before index.js)');
      return M[key];
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (get) {
  'use strict';
  const rational = get('rational'), schema = get('schema'), pitch = get('pitch'), time = get('time');
  const serialize = get('serialize'), validate = get('validate'), build = get('build'), prov = get('prov');
  const ops = get('ops'), xml = get('xml'), mxlImport = get('musicxml-import'), mxlExport = get('musicxml-export');
  const midiFile = get('midi-file'), midiImport = get('midi-import'), imp = get('import');
  const legacy = get('legacy-score');
  const meterGrid = get('meter-grid');
  const pro = get('pro');

  /* The library's own version, checked by audio-score.js so a cached old script never runs with a new one
     (G01 §19 R10). It changes with any change to these files' behaviour; SCOREGRAPH_VERSION is the schema's. */
  const version = '1.1.0';

  return Object.freeze({
    version: version,
    SCOREGRAPH_VERSION: schema.SCOREGRAPH_VERSION,
    rational: rational, schema: schema, pitch: pitch, time: time, prov: prov, ops: ops, xml: xml,
    ENTITY_KINDS: schema.ENTITY_KINDS,
    builder: build.builder, seal: build.seal, BuildError: build.BuildError,
    validate: validate.validate, CODES: validate.CODES,
    canonicalize: serialize.canonicalize, serialize: serialize.serialize, parse: serialize.parse,
    migrate: serialize.migrate, MIGRATIONS: serialize.MIGRATIONS,
    fingerprint: serialize.fingerprint, scoreRef: serialize.scoreRef,
    deepEqual: serialize.deepEqual, deepFreeze: serialize.deepFreeze,
    musicxml: Object.freeze({ import: mxlImport.importMusicXml, export: mxlExport.exportMusicXml,
      IMPORT_CODES: mxlImport.CODES, EXPORT_CODES: mxlExport.CODES }),
    importFile: imp.importFile, sniff: imp.sniff,
    legacy: legacy,
    meterGrid: meterGrid,
    /* G3 (docs/GOALS/G03): the notation pipeline */
    pro: pro,
    professionalize: pro.professionalize,
    midi: Object.freeze({ import: midiImport.importMidi, export: midiImport.exportMidi,
      read: midiFile.readMidi, write: midiFile.writeMidi, projection: midiFile.projection,
      IMPORT_CODES: midiImport.CODES, FILE_CODES: midiFile.CODES, GM_DRUM: midiImport.GM_DRUM })
  });
});
