/* ============================================================================
   PPP SongGraph — melody/bass identification and voice roles (docs/GOALS/G07 §5)

   melodyBassOf(g, opts) -> {parts: [{part, voices: [{voice, melody, bass, avgMidi, onsets, meanStep}],
   melodyVoice, melodyConf, bassVoice, bassConf}]}

   Per voice, at every onset instant of ANY voice in its part, "is this voice sounding the highest (or
   lowest) pitch among the part's simultaneously-sounding voices right now" — melody = the fraction of
   its own sounding instants where it is the top voice, bass = the fraction where it is the bottom
   voice. This is the textbook definition a chorale/keyboard texture is written to (the part called
   "soprano" is, almost by the convention's own definition, the voice on top): it is a real feature,
   not a guess, and G07 §5 asks it be reported with a confidence, not a bare boolean — here, the margin
   between the winning voice's score and the runner-up's.

   voiceRolesOf(g, opts) builds on this: melody/bass (as above), everything else is 'inner' when the
   part has 3+ voices (there is room for a real middle voice), else 'accompaniment' (a 2-voice part's
   non-melody voice, e.g. a keyboard LH, both harmonizes and functions as the bass — G07 §5's "voice
   roles" item, "building on the melody/bass work above").

   Ground truth (§4, §6): hymn soprano (voice label '1') and bass (voice label '6'). No usable
   ground truth was found for the non-hymn corpus (no <lyric> outside catalog/hymns and
   tests/engrave/fixtures's two unrelated fixtures, no other melody-tagging convention in the
   committed corpus) — reported as such in the design doc's §12, not guessed.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('./util.js'));
  } else {
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    M.voices = factory(root.PPPScoreGraphModules.rational, M.util);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, U) {
  'use strict';

  const round3 = x => Math.round(x * 1000) / 1000;
  const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

  /* {voiceId -> {total, top, bottom, sumMidi, onsetCount, meanStep}} for one part. */
  function perPartVoiceStats(g, part) {
    const notes = U.noteWindows(g, { part: part.id });
    const seen = new Map();
    notes.forEach(n => { const k = R.format(n.w0); if (!seen.has(k)) seen.set(k, n.w0); });
    const onsets = Array.from(seen.values()).sort((a, b) => R.cmp(a, b));
    const stats = {};
    part.voices.forEach(v => { stats[v.id] = { total: 0, top: 0, bottom: 0, sumMidi: 0, onsetCount: 0, meanStep: 0 }; });
    onsets.forEach(w => {
      const here = U.soundingAt(notes, w);
      if (!here.length) return;
      const byVoice = {};
      here.forEach(n => { if (byVoice[n.voiceId] === undefined || n.midi > byVoice[n.voiceId]) byVoice[n.voiceId] = n.midi; });
      const vals = Object.keys(byVoice).map(v => byVoice[v]);
      const hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
      Object.keys(byVoice).forEach(v => {
        const s = stats[v];
        if (!s) return;
        const midi = byVoice[v];
        s.total++;
        if (midi === hi) s.top++;
        if (midi === lo) s.bottom++;
        s.sumMidi += midi;
      });
    });
    part.voices.forEach(v => {
      const seq = notes.filter(n => n.voiceId === v.id).sort((a, b) => R.cmp(a.w0, b.w0));
      let stepSum = 0, stepCount = 0;
      for (let i = 1; i < seq.length; i++) { stepSum += Math.abs(seq[i].midi - seq[i - 1].midi); stepCount++; }
      stats[v.id].onsetCount = seq.length;
      stats[v.id].meanStep = stepCount ? stepSum / stepCount : 0;
    });
    return stats;
  }

  function melodyBassOf(g, opts) {
    opts = opts || {};
    const parts = (opts.part ? g.parts.filter(p => p.id === opts.part) : g.parts).map(part => {
      const stats = perPartVoiceStats(g, part);
      const voices = part.voices.map(v => {
        const s = stats[v.id];
        return {
          voice: v.id,
          melody: s.total ? round3(s.top / s.total) : 0,
          bass: s.total ? round3(s.bottom / s.total) : 0,
          avgMidi: s.total ? round3(s.sumMidi / s.total) : null,
          onsets: s.onsetCount,
          meanStep: round3(s.meanStep)
        };
      });
      const byMelody = voices.slice().sort((a, b) => b.melody - a.melody);
      const byBass = voices.slice().sort((a, b) => b.bass - a.bass);
      const melodyConf = byMelody.length ? round3(clamp01(byMelody[0].melody - (byMelody[1] ? byMelody[1].melody : 0))) : 0;
      const bassConf = byBass.length ? round3(clamp01(byBass[0].bass - (byBass[1] ? byBass[1].bass : 0))) : 0;
      return {
        part: part.id, voices: voices,
        melodyVoice: byMelody.length ? byMelody[0].voice : null, melodyConf: melodyConf,
        bassVoice: byBass.length ? byBass[0].voice : null, bassConf: bassConf
      };
    });
    return { parts: parts };
  }

  function voiceRolesOf(g, opts) {
    const mb = melodyBassOf(g, opts);
    return {
      parts: mb.parts.map(p => ({
        part: p.part,
        roles: p.voices.map(v => {
          if (v.voice === p.melodyVoice) return { voice: v.voice, role: 'melody', conf: p.melodyConf };
          if (v.voice === p.bassVoice && p.voices.length > 1) return { voice: v.voice, role: 'bass', conf: p.bassConf };
          return { voice: v.voice, role: p.voices.length >= 3 ? 'inner' : 'accompaniment', conf: round3(1 - Math.max(p.melodyConf, p.bassConf)) };
        })
      }))
    };
  }

  return Object.freeze({ perPartVoiceStats, melodyBassOf, voiceRolesOf });
});
