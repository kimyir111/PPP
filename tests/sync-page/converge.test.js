/* G13-S1: convergence. Three devices of one library do random things - add a song, practise, edit a score, change the tempo, remove a song, bring one back from the trash,
   count minutes, open the page (a cycle), let time pass - in an order a seed makes; at the end every device runs cycles until nothing is left. The devices must hold the
   same songs, each with the same content (nothing is lost, nothing is doubled, no ping-pong), and the counters must be the sum of what was counted.

   PPP_SYNC_SEEDS=40 PPP_SYNC_OPS=80 node tests/sync-page/converge.test.js   (defaults: 16 seeds of 60 operations) */
'use strict';
const L = require('./lib.js');
const { ok, heading, finish, MERGE } = L;

const SEEDS = Number(process.env.PPP_SYNC_SEEDS) || 16;
const FROM = Number(process.env.PPP_SYNC_FROM) || 1;
const OPS = Number(process.env.PPP_SYNC_OPS) || 60;
function prng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0; return (s >>> 8) / 16777216; };
}
/* a device's songs by the NAME of their item (a song that was already here under another id keeps its id: the name is what is shared) */
const byName = dev => {
  const keys = dev.engine._load().keys, idToKey = {};
  Object.keys(keys).forEach(k => { if (keys[k] && typeof keys[k].id === 'string') idToKey[keys[k].id] = k; });
  const out = {};
  dev.cards().forEach(c => { out[idToKey[c.id] || MERGE.keyOf(c.id)] = itemOf(dev, c.id); });
  return out;
};
const itemOf = (dev, id) => {
  const card = dev.card(id), slot = dev.slot(id);
  return card && slot ? MERGE.contentHash(MERGE.buildSongItem(card, slot, 0)) : null;
};

(async () => {
  const svc = await L.startSync({});
  let totalOps = 0, totalCycles = 0, forks = 0;
  try {
    for (let seed = FROM; seed < FROM + SEEDS; seed++) {
      const rnd = prng(seed);
      const pick = a => a[Math.floor(rnd() * a.length)];
      const D = ['X', 'Y', 'Z'].map(n => L.makeDevice(svc, n + seed));
      let nextSong = 0, nextSeed = 1000 * seed;
      const counted = { xp: 0, minutes: 0 };
      const make = dev => dev.addSong('c' + seed + '-' + (nextSong++), { seed: nextSeed++, notes: 12 + Math.floor(rnd() * 20), title: 'T' + nextSong });
      for (let i = 0; i < 6; i++) make(D[0]);
      D[0].st.xp = 10; counted.xp += 10;
      const created = await D[0].engine.createLibrary();
      D[0].engine.start();
      await D[0].settle();
      for (const d of [D[1], D[2]]) { await d.engine.join(created.code, { addLocal: true }); d.engine.start(); await d.settle(); }

      const answer = async d => {
        for (const a of d.engine.status().asks) await d.engine.answer(a.kind, a.kind === 'gone' ? (rnd() < 0.5 ? 'yes' : 'no') : 'yes');
      };
      for (let op = 0; op < OPS; op++) {
        const d = pick(D);
        const ids = d.cards().map(c => c.id);
        const r = rnd();
        totalOps++;
        if (r < 0.14) make(d);
        else if (r < 0.40 && ids.length) {
          const id = pick(ids);
          const n = 1 + Math.floor(rnd() * 5);
          d.editSlot(id, s => { s.history.byMeasure[String(1 + Math.floor(rnd() * 8))] = { attempts: n + Math.floor(rnd() * 3), lastAt: svc.clock.t + op }; s.history.runs.push({ at: svc.clock.t + op, from: 1, to: 2, tempo: 80, hands: 'both' }); s.history.rev++; });
        } else if (r < 0.50 && ids.length) {
          d.editSlot(pick(ids), s => { s.score = L.packedScore(10 + Math.floor(rnd() * 20), 4, nextSeed++, 'Edit'); });
        } else if (r < 0.58 && ids.length) {
          d.editSlot(pick(ids), s => { s.tempo = 50 + Math.floor(rnd() * 100); s.loopFrom = 1 + Math.floor(rnd() * 3); });
        } else if (r < 0.66 && ids.length > 3) {
          d.removeSong(pick(ids));
        } else if (r < 0.70) {
          const rows = await d.engine.trashList();
          if (rows.length) await d.engine.restore(pick(rows).tid);
        } else if (r < 0.78) {
          const x = 1 + Math.floor(rnd() * 20), m = 1 + Math.floor(rnd() * 5);
          d.st.xp += x; d.st.minutes += m; counted.xp += x; counted.minutes += m;
        } else if (r < 0.92) {
          await d.engine.syncNow('test'); totalCycles++;
          await answer(d);
        } else {
          svc.clock.t += Math.floor(rnd() * 30 * 60 * 1000);
        }
        svc.clock.t += 1000 + Math.floor(rnd() * 5000);
      }
      /* quiet: everyone runs cycles until nothing changes */
      let rounds = 0;
      for (; rounds < 12; rounds++) {
        const before = JSON.stringify(D.map(d => byName(d)));
        for (const d of D) { await d.engine.syncNow('test'); await answer(d); await d.engine.syncNow('test'); totalCycles += 2; }
        const after = JSON.stringify(D.map(d => byName(d)));
        if (before === after && rounds >= 1) break;
        svc.clock.t += 1000;
      }
      const idsOf = d => Object.keys(byName(d)).sort();
      const same = idsOf(D[0]).join() === idsOf(D[1]).join() && idsOf(D[1]).join() === idsOf(D[2]).join();
      ok('seed ' + seed + ': the same songs (by their names in the library) on the three devices (' + idsOf(D[0]).length + ' songs, ' + rounds + ' rounds)', same,
        same ? '' : idsOf(D[0]).length + '/' + idsOf(D[1]).length + '/' + idsOf(D[2]).length);
      if (!same && process.env.PPP_SYNC_DEBUG) {
        D.forEach(d => { console.log('      ' + d.name + ': ' + idsOf(d).filter(i => !/^c/.test(i)).join(' ')); const k = d.engine._load().keys; Object.keys(k).filter(x => /song-q|song-f/.test(x)).forEach(x => console.log('         ' + x + ' ' + JSON.stringify(k[x]))); });
        const lst = (await svc.anon.get('/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': created.code } })).body.items;
        lst.filter(i => /song-q|song-f/.test(i.key)).forEach(i => console.log('      server ' + i.key + ' rev ' + i.rev + (i.deleted ? ' DELETED' : '') + ' dev ' + i.device));
      }
      let diff = [];
      const maps = D.map(d => byName(d));
      Object.keys(maps[0]).forEach(k => { if (new Set(maps.map(m => m[k])).size !== 1) diff.push(k); });
      ok('seed ' + seed + ': every song has the same content everywhere', diff.length === 0, diff.slice(0, 3).join());
      ok('seed ' + seed + ': xp and minutes are the sum of what was counted (' + counted.xp + ', ' + counted.minutes + ')', D.every(d => d.st.xp === counted.xp && d.st.minutes === counted.minutes), D.map(d => d.st.xp + '/' + d.st.minutes).join(' '));
      ok('seed ' + seed + ': no device is in an error, none has a question left', D.every(d => !d.engine.status().error && !d.engine.status().asks.length), JSON.stringify(D.map(d => d.engine.status().error)));
      forks += idsOf(D[0]).filter(k => /^song:song-f/.test(k)).length;
      const idle = svc.store.total();
      for (const d of D) await d.engine.syncNow('poll');
      ok('seed ' + seed + ': and a further cycle of each costs the library nothing (it is quiet)', svc.store.total() === idle, String(svc.store.total() - idle));
    }
    console.log('    (' + SEEDS + ' seeds, ' + totalOps + ' operations, ' + totalCycles + ' cycles, ' + forks + ' copies made by two changed scores)');
  } finally {
    await svc.close();
  }
  finish('convergence of three devices, ' + SEEDS + ' seeds');
})().catch(e => { console.error(e); process.exit(1); });
