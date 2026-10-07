/* G10a-5: the page's OWN code, read out of Piano Coach App.dc.html (never written to) and run in Node, so the H-10 review shows what the
   app makes and plays instead of a copy of it:

     appOptions()            the options the page's recording call site (Import.finishHeard) passes to toMusicXml, for the classic arm and for v2,
                             evaluated from the page's own source (tests/recording-v2-callsites.js branchOptions) - so `exactBars`, `closeGaps`
                             and whatever else the page adds are never retyped here
     plausible(built, heard) the page's check that a v2 result is believable (rec/app.js), exactly as finishHeard applies it
     scoreOf(graph)          the Score the app holds for a graph: Score.finalize(legacy.toScore(graph)) (the app's own finalize)
     playPlan(score)         the app's PianoScore plan for that Score (written ties joined, pedal, velocities, the tempo map)
     arranger({reference})   the Song Arranger's own function: arrangeSingleNoteWithLeadsheet(graph, plan, title) with the page's glue (G10c-1b: a recording is arranged from its lead sheet
                             when the plan says recordingArrange 'leadsheet', the reduction when it says 'reduce' or nothing; a lead sheet that refuses falls back to the reduction), and the
                             reduction is arrangeSingleNoteWithHandsFallback (arrangeSingleNote + the hands retry for a v2 graph the one-note arranger refused), as the page defines them

   Everything is extracted by name from the app file with the technique tests/engrave/helpers.js appFinalize, tests/scoregraph/app-playback.test.js
   and tests/realize/app-single-extract.js already use. If the app changes the name or shape of one of these, the extraction throws (it never
   silently falls back to a copy). */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const CALLSITES = require(path.join(REPO, 'tests', 'recording-v2-callsites.js'));
const SINGLE = require(path.join(REPO, 'tests', 'realize', 'app-single-extract.js'));
const AS = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const RA = require(path.join(REPO, 'rec', 'app.js'));

const html = () => fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');

/* ---- the page's options for the recording conversion ---- */
let optionsCache = null;
/* `source` (the page's text) is for tests that plant a defect in a copy of the page; without it the page of this tree is read once */
function appOptions(source) {
  if (!source && optionsCache) return optionsCache;
  const calls = CALLSITES.toMusicXmlCalls(source || html()).filter(c => /heard\.grid/.test(c) && /easy:/.test(c) && /closeGaps/.test(c));
  if (calls.length !== 1) throw new Error('appcode: expected exactly one toMusicXml call on heard.grid in the page (Import.finishHeard), found ' + calls.length);
  const o = CALLSITES.branchOptions(calls[0]);
  /* what the call does with the title is the page's: here the title is the caller's */
  ['classic', 'v2'].forEach(k => {
    if (!o[k].closeGaps || !o[k].exactBars) throw new Error('appcode: the page\'s ' + k + ' recording options lost closeGaps/exactBars: ' + JSON.stringify(o[k]));
  });
  if (o.classic.recording) throw new Error('appcode: the page\'s classic options ask for a recording method: ' + JSON.stringify(o.classic));
  if (o.v2.recording !== 'v2') throw new Error('appcode: the page\'s v2 options do not ask for v2: ' + JSON.stringify(o.v2));
  const got = { classic: o.classic, v2: o.v2 };
  if (!source) optionsCache = got;
  return got;
}

/* the page's conversion of heard notes: finishHeard's `convert(v2)` and the plausibility step that follows it. Returns { built, v2, rejected }:
   built is toMusicXml's result, v2 says whether the staged conversion wrote it, rejected whether the page threw a v2 result away
   ("an unlikely tempo or length": the classic conversion then wrote the score). `plausibleCheck` is for tests (a check that says no); the page's own is the default. */
function convertHeard(heard, title, wantV2, plausibleCheck) {
  const opts = appOptions();
  const input = { notes: heard.notes, pedals: heard.pedals, beats: heard.beats, downbeats: heard.downbeats, grid: heard.grid, title: title };
  const convert = v2 => AS.toMusicXml(input, Object.assign({}, v2 ? opts.v2 : opts.classic, { title: title }));
  let built = convert(!!wantV2), rejected = false;
  const v2 = !!(built && built.recReport);
  if (wantV2 && v2 && !(plausibleCheck || RA.plausible)(built, heard).ok) { built = convert(false); rejected = true; }
  return { built: built, v2: !!(built && built.recReport), rejected: rejected };
}

/* ---- the app's Score and its player ---- */
let appFns = null;
function appCode() {
  if (appFns) return appFns;
  const src = html();
  const decl = name => {
    const i = src.indexOf('\nconst ' + name + ' = ');
    if (i < 0) throw new Error('appcode: const ' + name + ' is not in the app');
    const line = src.slice(i + 1, src.indexOf('\n', i + 1));
    if (/;\s*$/.test(line)) return line + '\n';
    const z = src.indexOf('\n};\n', i);
    return src.slice(i + 1, z + 4);
  };
  const fn = name => {
    const i = src.indexOf('\nfunction ' + name + '(');
    if (i < 0) throw new Error('appcode: function ' + name + ' is not in the app');
    return src.slice(i + 1, src.indexOf('\n}\n', i) + 3);
  };
  const body = decl('PIANO') + decl('DYN_VEL') + decl('PEDAL_CC') + fn('firstAtOrAfter') + decl('STEP_SEMI') + decl('PITCH_RE') +
    fn('pitchToMidi') + fn('shiftPitchOctave') + fn('ottavaSemitones') + decl('PianoScore') + decl('Score') +
    'return { Score: Score, PianoScore: PianoScore };';
  appFns = new Function(body)();
  return appFns;
}
const scoreOf = (graph, name) => appCode().Score.finalize(SG.legacy.toScore(graph, { name: name || 'review', id: 'review:' + (name || 'x') }));
const playPlan = score => appCode().PianoScore.of(score);

/* ---- the Song Arranger ---- */
function fnSource(name, isAsync) {
  const src = html();
  const marker = '\n' + (isAsync ? 'async function ' : 'function ') + name + '(';
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('appcode: function ' + name + ' is not in the app');
  if (src.slice(i + 1).split('\n', 1)[0].endsWith('}')) return src.slice(i + 1, src.indexOf('\n', i + 1) + 1);
  const end = src.indexOf('\n}\n', i);
  if (end < 0) throw new Error('appcode: ' + name + ' has no clean end');
  return src.slice(i + 1, end + 2);
}
const constLine = name => { const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(html()); if (!m) throw new Error('appcode: const ' + name + ' is not in the app'); return m[0] + '\n'; };

/* arranger({ reference? }) -> { arrange(graph, level, title, options?) -> { ...arrangeSingleNote's result, handsFallback?, recordingArrange?, leadsheetRefusal? }, app }. One closure (and so one arrangement cache) per call.
   options.recordingArrange (G10c-1b): 'leadsheet' | 'reduce', the plan's own statement of how a recording is arranged (the page's PPP.recordingArrange for a request that states none). Absent, the tool's
   own default stands: 'reduce', what it always did, so no packet built before this option changes. The result of a recording's request says which path made the copy (recordingArrange) and, when the lead
   sheet refused and the reduction was made instead, why (leadsheetRefusal); a request the lead sheet was not asked for carries neither. */
function arranger(opts) {
  opts = opts || {};
  const ref = opts.reference || SINGLE.reference();
  const app = SINGLE.make({ window: SINGLE.nodeWindow(), loadArrangerReference: () => Promise.resolve(ref) });
  const SRC = constLine('SINGLE_HANDS_FALLBACK_CODE') + fnSource('recordingArrangeChoice') + fnSource('leadsheetWanted') + fnSource('graphFromV2Recording') + fnSource('writtenByV2') +
    fnSource('arrangeSingleNoteWithHandsFallback', true) + fnSource('arrangeSingleNoteWithLeadsheet', true) +
    'return { arrangeSingleNoteWithLeadsheet, arrangeSingleNoteWithHandsFallback };';
  /* the page's recording modules are Node requires here (audio-score.js, rec/app.js and rec/leadsheet.js find rec/ themselves), so "loading" them is a given; the page's mode is the tool's: 'reduce' */
  const win = { PPPRecApp: RA, PPPAudioScore: AS };
  const glue = new Function('arrangeSingleNote', 'loadRecordingModules', 'loadLeadsheetModule', 'RECORDING_ARRANGE_MODE', 'window', SRC)(app.arrangeSingleNote, () => Promise.resolve(true), () => Promise.resolve(true), 'reduce', win);
  return {
    arrange: (graph, level, title, options) => glue.arrangeSingleNoteWithLeadsheet(graph, Object.assign({ level: level || 'intermediate' }, options && options.recordingArrange ? { recordingArrange: options.recordingArrange } : {}), title),
    app: app
  };
}

module.exports = { appOptions, convertHeard, scoreOf, playPlan, appCode, arranger, html, REPO };
