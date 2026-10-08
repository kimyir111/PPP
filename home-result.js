/* G10b-1: what a home-PC worker may send back for a job, and the checks on it.

   One file, two users: server.js (home-jobs.js) validates every result a worker posts with it, and the worker itself
   (tools/home-worker/worker.js) cuts what it sends down to the same bounds, so a result the worker builds is one the server
   accepts. The result is the helper's ACCEPTED notes in the heard-notes format of the app's own browser transcription
   ({ on, off, midi, vel }); everything else the helper writes (pedals, beats, single-model notes, per-note confidence) is
   not part of it and is stripped here, never stored.

   G10d song mode (a job of kind 'youtube-song': the PC separates the song first): every note also says its layer, `track`
   1 the melody (the voice), 2 the bass, 3 the accompaniment (SONG_TRACKS), and the result says mode 'song' with a short
   summary (song: how many notes each layer has, the separation model). A piano result has neither.

   Pure: no I/O, no clock. */
'use strict';

const LIMITS = {
  /* the app's own limit for a recording (IMPORT_LIMITS.maxAudioMinutes); the worker cuts the audio there */
  MAX_SECONDS: 15 * 60,
  /* what the clock of a result may overshoot that, in seconds (rounding in the decoder) */
  SECONDS_SLACK: 5,
  MIN_NOTES: 4,
  MAX_NOTES: 20000,
  /* a song-mode result holds three layers (melody, bass, accompaniment): 30,000 notes with their layer are about 1.9 MB, under RESULT_MAX_BYTES */
  SONG_MAX_NOTES: 30000,
  /* the body of a result, and what is stored of it (the stripped, rounded JSON) */
  RESULT_MAX_BYTES: 2 * 1024 * 1024,
  MODELS_MAX: 6
};
/* the layers of a song-mode result (transcribe.py SONG_TRACK) */
const SONG_TRACKS = Object.freeze({ melody: 1, bass: 2, accomp: 3 });
const TRACK_OK = new Set([1, 2, 3]);
/* where a song's melody layer came from: the voice, or (an instrumental) the stem whose line the PC followed */
const MELODY_FROM = new Set(['vocals', 'other', 'guitar', 'piano']);

const NAME_RE = /^[a-z0-9][a-z0-9._+-]{0,39}$/;
const DEVICE_RE = /^[a-z0-9][a-z0-9:._-]{0,15}$/;
const SEPARATION_RE = /^[a-z0-9][a-z0-9_.+-]{0,39}$/;   /* a separation model's name (htdemucs_6s) */
const r4 = v => Math.round(v * 10000) / 10000;
const isInt = v => typeof v === 'number' && Number.isInteger(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

function bad(error, code) { return { ok: false, error: error, code: code }; }

/* a short line of text for the review screen and the status list: one line, no control characters, no markup brackets, and none of the
   characters that reorder or split text (bidi marks and overrides U+202A-202E, U+2066-2069, U+200E/F, U+061C; line and paragraph separators) */
function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f<>\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* body (parsed JSON) -> { ok: true, result, bytes } | { ok: false, error, code }.
   result = { v, notes: [{ on, off, midi, vel, track? }] sorted by on, midi, off; duration; engine; model; device; ensemble; mode?; song? }. */
function validateResult(body, limits) {
  const L = Object.assign({}, LIMITS, limits || {});
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('The result is not an object.', 'bad-result');
  const list = body.notes;
  if (!Array.isArray(list)) return bad('The result has no notes list.', 'bad-result');
  if (list.length < L.MIN_NOTES) return bad('Fewer than ' + L.MIN_NOTES + ' notes.', 'too-few-notes');
  const maxNotes = body.mode === 'song' ? Math.max(L.MAX_NOTES, L.SONG_MAX_NOTES) : L.MAX_NOTES;
  if (list.length > maxNotes) return bad('More than ' + maxNotes + ' notes.', 'too-many-notes');
  const ceiling = L.MAX_SECONDS + L.SECONDS_SLACK;
  const song = body.mode === 'song';
  if (body.mode != null && body.mode !== 'song' && body.mode !== 'piano') return bad('The mode is not usable.', 'bad-meta');
  const notes = new Array(list.length);
  let last = 0;
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (!n || typeof n !== 'object' || Array.isArray(n)) return bad('Note ' + i + ' is not an object.', 'bad-note');
    if (!isNum(n.on) || !isNum(n.off)) return bad('Note ' + i + ' has no usable times.', 'bad-note');
    if (n.on < 0 || n.off <= n.on) return bad('Note ' + i + ' ends before it starts.', 'bad-note');
    if (n.off > ceiling) return bad('Note ' + i + ' is past ' + Math.round(L.MAX_SECONDS / 60) + ' minutes.', 'too-long');
    if (!isInt(n.midi) || n.midi < 21 || n.midi > 108) return bad('Note ' + i + ' is not a piano key.', 'bad-note');
    if (!isNum(n.vel)) return bad('Note ' + i + ' has no velocity.', 'bad-note');
    const vel = Math.max(1, Math.min(127, Math.round(n.vel)));
    const on = r4(n.on), off = r4(n.off);
    if (!(off > on)) return bad('Note ' + i + ' is too short.', 'bad-note');
    notes[i] = { on: on, off: off, midi: n.midi, vel: vel };
    if (song) {
      if (!TRACK_OK.has(n.track)) return bad('Note ' + i + ' has no usable layer.', 'bad-note');
      notes[i].track = n.track;
    }
    if (off > last) last = off;
  }
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi || a.off - b.off || (a.track || 0) - (b.track || 0));
  let duration = last;
  if (body.duration != null) {
    if (!isNum(body.duration) || body.duration <= 0 || body.duration > ceiling) return bad('The duration is not usable.', 'bad-duration');
    duration = Math.max(r4(body.duration), last);
  }
  if (duration > ceiling) return bad('The recording is longer than ' + Math.round(L.MAX_SECONDS / 60) + ' minutes.', 'too-long');

  let engine = 'ensemble';
  if (body.engine != null) {
    if (typeof body.engine !== 'string' || !NAME_RE.test(body.engine)) return bad('The engine name is not usable.', 'bad-meta');
    engine = body.engine;
  }
  let device = null;
  if (body.device != null) {
    if (typeof body.device !== 'string' || !DEVICE_RE.test(body.device)) return bad('The device name is not usable.', 'bad-meta');
    device = body.device;
  }
  const model = body.model == null ? null : cleanText(body.model, 120) || null;

  let ensemble = null;
  if (body.ensemble != null) {
    const e = body.ensemble;
    if (typeof e !== 'object' || Array.isArray(e)) return bad('The ensemble summary is not usable.', 'bad-meta');
    const models = [];
    if (e.models != null) {
      if (!Array.isArray(e.models) || e.models.length > L.MODELS_MAX) return bad('The ensemble summary is not usable.', 'bad-meta');
      for (const m of e.models) {
        if (typeof m !== 'string' || !NAME_RE.test(m)) return bad('The ensemble summary is not usable.', 'bad-meta');
        models.push(m);
      }
    }
    let primary = null;
    if (e.primary != null) {
      if (typeof e.primary !== 'string' || !NAME_RE.test(e.primary)) return bad('The ensemble summary is not usable.', 'bad-meta');
      primary = e.primary;
    }
    let agreement = null;
    if (e.agreement != null) {
      if (!isNum(e.agreement) || e.agreement < 0 || e.agreement > 1) return bad('The ensemble summary is not usable.', 'bad-meta');
      agreement = r4(e.agreement);
    }
    const count = v => (v == null ? null : (isInt(v) && v >= 0 && v <= 1e7 ? v : NaN));
    const accepted = count(e.accepted), uncertain = count(e.uncertain);
    if (Number.isNaN(accepted) || Number.isNaN(uncertain)) return bad('The ensemble summary is not usable.', 'bad-meta');
    ensemble = { models: models, primary: primary, agreement: agreement, accepted: accepted == null ? notes.length : accepted, uncertain: uncertain == null ? 0 : uncertain };
  }

  const result = { v: 1, notes: notes, duration: duration, engine: engine, model: model, device: device, ensemble: ensemble };
  if (song) {
    /* the layer counts are the notes' own (what the worker says is not trusted for them); the separation model is a name */
    const count = k => notes.reduce((c, n) => c + (n.track === SONG_TRACKS[k] ? 1 : 0), 0);
    const s = body.song && typeof body.song === 'object' && !Array.isArray(body.song) ? body.song : {};
    if (s.separation != null && (typeof s.separation !== 'string' || !SEPARATION_RE.test(s.separation))) return bad('The song summary is not usable.', 'bad-meta');
    result.mode = 'song';
    if (s.melodyFrom != null && !MELODY_FROM.has(s.melodyFrom)) return bad('The song summary is not usable.', 'bad-meta');
    result.song = { separation: s.separation || null, melodyFrom: s.melodyFrom || null, melody: count('melody'), bass: count('bass'), accomp: count('accomp') };
  }
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > L.RESULT_MAX_BYTES) return bad('The result is larger than ' + Math.round(L.RESULT_MAX_BYTES / 1048576) + ' MB.', 'too-large');
  return { ok: true, result: result, bytes: bytes };
}

module.exports = { LIMITS, SONG_TRACKS, validateResult, cleanText };
