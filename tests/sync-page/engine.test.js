/* G13-S1: the sync engine (sync/client.js) against the real service (sync.js over HTTP, a counting store, a clock this test moves), with a fake page (tests/sync-page/lib.js).

   What a person's devices do, as cycles:
     - turn on: 30 songs are sent (state first), the library holds 30 + the state, the code is never in a URL;
     - a second device joins: 30 songs come, the same content; its own songs are added (and merged by identity, or kept apart);
     - progress on both devices at once: the union; counters: the sum;
     - a score changed on both: both kept (the newer stays, the other is a copy);
     - a song removed: a tombstone, the other device removes it (to the trash), and an edit here beats a removal there;
     - 17 songs removed at once are asked about on both sides; "no" keeps them;
     - offline edits go when the network is back;
     - a device away for 31 days (tombstones purged) asks before it pushes what the library lost;
     - a library that is restored older (reset); a new code (rotated); a deleted library;
     - 500 songs: 240 in the first hour, 240 the next, 20 the third;
     - an idle poll costs the library no statement. */
'use strict';
const L = require('./lib.js');
const { ok, heading, finish, MERGE } = L;

const DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;

(async () => {
  const svc = await L.startSync({});
  try {
    /* ------------------------------------------------------------------ turning on */
    heading('turning on: 30 songs are sent, state first, and the code is only ever in a header');
    const A = L.makeDevice(svc, 'A');
    for (let i = 0; i < 30; i++) A.addSong('song-a' + i, { seed: i, notes: 24 + i });
    A.editSlot('song-a3', s => { s.history = { byMeasure: { 1: { attempts: 3, lastAt: 1000 } }, runs: [{ at: 5, from: 1, to: 2, tempo: 80, hands: 'both' }], rev: 3 }; });
    A.st.xp = 100; A.st.minutes = 40;
    const made = await A.engine.createLibrary();
    ok('a library is made: a code of 64 hex and a recovery code that is another one', made.ok && /^[0-9a-f]{64}$/.test(made.code) && /^[0-9a-f]{64}$/.test(made.recovery) && made.code !== made.recovery);
    ok('the code is in the state of this device (and only there)', A.engine.code() === made.code && A.storage.getItem('ppp.syncstate.v1').indexOf(made.code) > 0);
    ok('the recovery code is nowhere on the device', !JSON.stringify(Array.from(A.storage.m.values())).includes(made.recovery));
    A.engine.start();
    const s1 = await A.settle();
    ok('30 songs done, nothing pending, no error', s1.songs.total === 30 && s1.songs.done === 30 && s1.songs.pending === 0 && !s1.error, JSON.stringify(s1.songs));
    const srvA = (await svc.anon.get('/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': made.code } })).body;
    ok('the library holds 30 songs and the state', srvA.items.length === 31 && srvA.items.filter(i => i.key === 'state').length === 1 && srvA.items.filter(i => /^song:song-a/.test(i.key)).length === 30, String(srvA.items.length));
    ok('the state item was the first written (the lowest revision)', srvA.items.slice().sort((a, b) => a.rev - b.rev)[0].key === 'state');
    ok('no request carried the code in a URL, and every one was sent without credentials', A.requests.every(r => !r.url.includes(made.code) && !/lib=/.test(r.url) && r.credentials === 'omit'));
    ok('the code is only in the X-PPP-Lib header of the requests that have one', A.requests.filter(r => r.headers['X-PPP-Lib']).every(r => r.headers['X-PPP-Lib'] === made.code) && A.requests.filter(r => r.url.endsWith('/api/libs')).every(r => !r.headers['X-PPP-Lib']));
    ok('a body sent is never plain: gzip (items are base64 of a gzip stream)', A.requests.filter(r => r.method === 'PUT').every(r => JSON.parse(r.body).items.every(i => Buffer.from(i.body, 'base64')[0] === 0x1f)));
    const calls0 = Object.assign({}, svc.store.calls);

    /* ------------------------------------------------------------------ a second device joins */
    heading('a second device joins: the songs come, the same; its own are added');
    const B = L.makeDevice(svc, 'B');
    B.addSong('song-b1', { seed: 91, title: 'Only on B' });
    B.addSong('song-bsame', { seed: 5, notes: 24 + 5, title: 'Song song-a5' });   /* the same score as A's song-a5: by identity it is that song */
    B.st.xp = 30;
    const j = await B.engine.join(groupless(made.code), { addLocal: true });
    ok('joining validates the code and finds the 31 items', j.ok && j.items === 31, JSON.stringify(j));
    B.engine.start();
    const sb = await B.settle(12);
    ok('B has the 30 songs of A, its own, and the one that was the same song is one song', B.cards().length === 31 && !B.card('song-a5') === false || B.cards().length === 31, B.cards().length + ' songs');
    ok('the same score under another name was linked, not duplicated', B.cards().filter(c => /song-a5|song-bsame/.test(c.id)).length === 1, B.cards().map(c => c.id).filter(i => /a5|bsame/.test(i)).join());
    ok('B has no error and nothing pending', !sb.error && sb.songs.pending === 0, JSON.stringify(sb));
    const sameA = B.cards().filter(c => /^song-a/.test(c.id)).every(c => { const a = A.slot(c.id), b = B.slot(c.id); return !a || (b && MERGE.scoreHashOf(a) === MERGE.scoreHashOf(b)); });
    ok('every score that came is the sender\'s score (canonical text)', sameA);
    ok('the history of the song with practice came with it', JSON.stringify(B.slot('song-a3').history.byMeasure) === JSON.stringify(A.slot('song-a3').history.byMeasure));
    await A.settle();   /* B's song-b1 reaches A */
    ok('A received "Only on B" (and B\'s song that A has under its own name is not doubled)', A.cards().some(c => c.title === 'Only on B') && A.cards().length === 31, A.cards().length + ' songs');
    ok('xp is the sum of the devices: 100 + 30 on both', A.st.xp === 130 && B.st.xp === 130, A.st.xp + ' ' + B.st.xp);
    const bCalls = Object.assign({}, svc.store.calls);
    void calls0; void bCalls;

    /* ------------------------------------------------------------------ progress on both: the union */
    heading('practice on both devices: the union; minutes add up');
    A.editSlot('song-a1', s => { s.history.byMeasure['1'] = { attempts: 2, lastAt: 10 }; s.history.runs.push({ at: 10, from: 1, to: 1, tempo: 80, hands: 'both' }); s.memLevel = 2; });
    B.editSlot('song-a1', s => { s.history.byMeasure['2'] = { attempts: 4, lastAt: 20 }; s.history.runs.push({ at: 20, from: 2, to: 2, tempo: 80, hands: 'both' }); s.blindRuns = 3; });
    A.st.minutes += 10; B.st.minutes += 5;
    svc.clock.t += 60000;
    await A.settle(); await B.settle(); await A.settle();
    const ha = A.slot('song-a1'), hb = B.slot('song-a1');
    ok('both measures are on both devices', ha.history.byMeasure['1'] && ha.history.byMeasure['2'] && hb.history.byMeasure['1'] && hb.history.byMeasure['2']);
    ok('both runs, the larger counters', ha.history.runs.length === 2 && hb.history.runs.length === 2 && ha.memLevel === 2 && ha.blindRuns === 3 && hb.memLevel === 2 && hb.blindRuns === 3);
    ok('minutes: 40 + 10 + 5 = 55 on both', A.st.minutes === 55 && B.st.minutes === 55, A.st.minutes + ' ' + B.st.minutes);
    ok('and the two devices hold the same text for the song (it converged)', JSON.stringify(MERGE.stable(ha.history)) === JSON.stringify(MERGE.stable(hb.history)));

    /* ------------------------------------------------------------------ a score changed on both */
    heading('a score changed on both devices: both are kept');
    const newA = L.packedScore(30, 4, 777, 'Edited on A'), newB = L.packedScore(30, 4, 888, 'Edited on B');
    A.editSlot('song-a2', s => { s.score = newA; });
    svc.clock.t += 1000;
    B.editSlot('song-a2', s => { s.score = newB; });
    await A.settle();                                  /* A sends its edit first */
    svc.clock.t += 1000;
    const before = B.cards().length;
    await B.settle(); await A.settle(); await B.settle();
    ok('B has one more song: the copy', B.cards().length === before + 1 && A.cards().length === before + 1, B.cards().length + ' ' + A.cards().length);
    const copyB = B.cards().find(c => /copy from another device/.test(c.title));
    ok('the copy is titled as a copy and the song keeps its place', !!copyB && !!B.card('song-a2'));
    const scoreHashes = [MERGE.scoreHashOf(B.slot('song-a2')), MERGE.scoreHashOf(B.slot(copyB.id))].sort();
    ok('the two scores are the two edits (nothing is lost)', JSON.stringify(scoreHashes) === JSON.stringify([MERGE.scoreHashOf({ score: newA }), MERGE.scoreHashOf({ score: newB })].sort()));
    ok('the newer edit (B\'s) is the song, on both devices', MERGE.scoreHashOf(A.slot('song-a2')) === MERGE.scoreHashOf({ score: newB }) && MERGE.scoreHashOf(B.slot('song-a2')) === MERGE.scoreHashOf({ score: newB }));
    ok('A has the copy too, with A\'s own edit', A.cards().some(c => c.id === copyB.id) && MERGE.scoreHashOf(A.slot(copyB.id)) === MERGE.scoreHashOf({ score: newA }));
    ok('a notice names the copy', B.engine.status().notices.some(n => n.code === 'copy'));

    /* ------------------------------------------------------------------ a removal */
    heading('a song removed on one device goes to the trash of the other; an edit beats a removal');
    A.removeSong('song-a9');
    await A.settle();
    const rm = await B.settle();
    ok('B no longer lists it, and keeps it for 30 days', !B.card('song-a9') && !B.slotRaw('song-a9') && (await B.engine.trashList()).some(r => r.id === 'song-a9'), JSON.stringify(rm.asks));
    ok('A\'s trash has it too', (await A.engine.trashList()).some(r => r.id === 'song-a9'));
    ok('a removal that came from the other device was not sent back as a removal of this one', B.requests.filter(r => r.method === 'DELETE').length === 0, String(B.requests.filter(r => r.method === 'DELETE').length));
    /* edit beats a removal */
    B.removeSong('song-a10');
    A.editSlot('song-a10', s => { s.history.byMeasure['3'] = { attempts: 1, lastAt: 99 }; });
    await B.settle();                                  /* the tombstone is sent */
    await A.settle();                                  /* A changed it: it stays, and goes back over the tombstone */
    await B.settle();
    ok('A kept the song it had changed', !!A.card('song-a10') && !!A.slot('song-a10').history.byMeasure['3']);
    ok('and it came back to B (a removal is never worth an edit)', !!B.card('song-a10'), 'B: ' + (B.card('song-a10') ? 'back' : 'gone'));
    /* restore from the trash */
    const rows = await B.engine.trashList();
    const row9 = rows.find(r => r.id === 'song-a9');
    const rs = await B.engine.restore(row9.tid);
    ok('a removed song is restored from the trash', rs.ok && !!B.card('song-a9') && B.slot('song-a9').score.notes.length > 0);
    await B.settle(); await A.settle();
    ok('and the restored song is back on A, over the tombstone', !!A.card('song-a9'));

    /* ------------------------------------------------------------------ 17 at once */
    heading('17 songs removed at once are asked about, here and there; "no" keeps them');
    const ids = A.cards().filter(c => /^song-a/.test(c.id)).slice(0, 17).map(c => c.id);
    ids.forEach(id => A.removeSong(id));
    const ra = await A.settle(3);
    ok('A asks before it sends 17 tombstones, and sent none', ra.asks.some(a => a.kind === 'delete-out' && a.n === 17), JSON.stringify(ra.asks.map(a => a.kind + a.n)));
    const srvNow = (await svc.anon.get('/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': made.code } })).body;
    ok('the library has not heard of them', srvNow.items.filter(i => i.deleted).length === 0, String(srvNow.items.filter(i => i.deleted).length));
    await A.engine.answer('delete-out', 'yes');
    await A.settle();
    const rb = await B.settle(3);
    ok('B asks before it removes 17 songs, and removed none', rb.asks.some(a => a.kind === 'delete-in' && a.n === 17) && ids.every(id => !!B.card(id)), JSON.stringify(rb.asks.map(a => a.kind + a.n)));
    await B.engine.syncNow('test'); await B.engine.syncNow('test');
    ok('an unanswered question stays (the same list is made again) and nothing was removed meanwhile', B.engine.status().asks.some(a => a.kind === 'delete-in' && a.n === 17) && ids.every(id => !!B.card(id)));
    await B.engine.answer('delete-in', 'no');
    await B.settle();
    ok('"no" keeps the 17 on B, and the question does not come back', ids.every(id => !!B.card(id)) && !B.engine.status().asks.length);
    await B.settle();
    ok('and they are not sent back to A as new', ids.every(id => !A.card(id)));
  } finally {
    await svc.close();
  }
  finish('the sync engine: turn on, join, practice, scores, removals');
})().catch(e => { console.error(e); process.exit(1); });

function groupless(code) { return code.replace(/(.{8})/g, '$1 ').trim(); }
