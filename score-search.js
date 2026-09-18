/* ============================================================================
   PPP — public-domain score catalog

   A YouTube title or a file name is often the name of a piece that already
   exists as MusicXML. Searching that catalog and aligning the recording to
   the page is better than inventing a rhythm from a performance.

   Only CC0 / public-domain entries live here. A miss falls through to
   transcription. Browser (window.PPPScoreSearch) and Node (require).
   ========================================================================== */
(function (global) {
  'use strict';

  function fold(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(the|a|an|no|nr|n|op|in|for|piano)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(s) { return fold(s).split(' ').filter(Boolean); }

  function scoreName(query, name) {
    const q = fold(query), n = fold(name);
    if (!q || !n) return 0;
    if (q === n) return 1;
    if (q.indexOf(n) !== -1 || n.indexOf(q) !== -1) return 0.9;
    const qt = tokens(query), nt = tokens(name);
    if (!qt.length || !nt.length) return 0;
    let hit = 0;
    nt.forEach(t => { if (qt.indexOf(t) !== -1) hit++; });
    const cover = hit / nt.length;
    const extra = hit / qt.length;
    return cover * 0.7 + extra * 0.3;
  }

  function search(query, catalog) {
    const entries = (catalog && catalog.scores) || catalog || [];
    if (!query || !entries.length) return null;
    let best = null, bestScore = 0;
    entries.forEach(entry => {
      const names = [entry.title].concat(entry.titles || []);
      let s = 0;
      names.forEach(n => { s = Math.max(s, scoreName(query, n)); });
      if (entry.composer) {
        const c = scoreName(query, entry.composer);
        if (c > 0.5) s = Math.min(1, s + 0.08);
      }
      if (s > bestScore) { bestScore = s; best = entry; }
    });
    if (!best || bestScore < 0.72) return null;
    return { entry: best, score: bestScore, retrieved: true };
  }

  function xmlFacts(xml) {
    const text = String(xml || '');
    const measures = (text.match(/<measure\b/g) || []).length;
    const beats = +(/<beats>(\d+)<\/beats>/.exec(text) || [])[1] || 4;
    const beatType = +(/<beat-type>(\d+)<\/beat-type>/.exec(text) || [])[1] || 4;
    const tempo = +(/<per-minute>\s*([\d.]+)\s*<\/per-minute>/.exec(text) ||
      /tempo="([\d.]+)"/.exec(text) || [])[1] || 72;
    const title = (/<work-title>([^<]+)<\/work-title>/.exec(text) ||
      /<movement-title>([^<]+)<\/movement-title>/.exec(text) || [])[1] || '';
    const composer = (/<creator[^>]*type="composer"[^>]*>([^<]+)<\/creator>/.exec(text) || [])[1] || '';
    return { measures: measures, beats: beats, beatType: beatType, tempo: tempo, title: title, composer: composer };
  }

  /* Map each bar to a time in the recording. Downbeats win; otherwise the
     printed tempo is stretched to the recording's duration. */
  function align(xml, opts) {
    opts = opts || {};
    const facts = xmlFacts(xml);
    const bars = Math.max(1, facts.measures);
    const barQ = facts.beats * (4 / facts.beatType);
    const printed = bars * barQ * 60 / (facts.tempo || 72);
    const duration = opts.duration > 0 ? +opts.duration : printed;
    const downbeats = (opts.downbeats || []).filter(t => isFinite(t)).sort((a, b) => a - b);
    const barStarts = [];
    if (downbeats.length >= bars) {
      for (let i = 0; i < bars; i++) barStarts.push(Math.round(downbeats[i] * 1000) / 1000);
      const last = downbeats[bars] != null ? downbeats[bars]
        : downbeats[bars - 1] + (downbeats[bars - 1] - (downbeats[bars - 2] || 0));
      barStarts.push(Math.round(last * 1000) / 1000);
    } else {
      const scale = printed > 0 ? duration / printed : 1;
      const barSec = barQ * 60 / (facts.tempo || 72) * scale;
      const t0 = opts.start != null ? +opts.start : 0;
      for (let i = 0; i <= bars; i++) barStarts.push(Math.round((t0 + i * barSec) * 1000) / 1000);
    }
    if (barStarts[barStarts.length - 1] < duration) barStarts[barStarts.length - 1] = Math.round(duration * 1000) / 1000;
    return {
      barStarts: barStarts,
      duration: duration,
      measures: bars,
      tempo: facts.tempo,
      beats: facts.beats,
      beatType: facts.beatType,
      title: facts.title,
      composer: facts.composer
    };
  }

  function loadCatalogSync(fs, path, dir) {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    (index.scores || []).forEach(s => {
      if (s.file && !s.xml) {
        try { s.xml = fs.readFileSync(path.join(dir, s.file), 'utf8'); } catch (e) { s.xml = null; }
      }
    });
    return index;
  }

  const api = { fold: fold, search: search, align: align, xmlFacts: xmlFacts, loadCatalogSync: loadCatalogSync };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.PPPScoreSearch = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
