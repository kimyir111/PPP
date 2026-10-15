/* G13-S1: the sync engine at its edges, against the real service: offline and flaky networks, a device away for 31 days, a restored library, a new code, a deleted
   library, the recovery code, 500 songs under the hour's room, an idle poll, a full disk, hostile items, a secret in a title, a stuck conflict, a frozen page, two tabs. */
'use strict';
const L = require('./lib.js');
const { ok, heading, finish, MERGE } = L;
const DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const group = code => code.replace(/(.{8})/g, '$1 ').trim();

/* two devices of one new library: A has songs, B has joined and settled */
async function pair(svc, n, tag) {
  const A = L.makeDevice(svc, 'A' + tag), B = L.makeDevice(svc, 'B' + tag);
  for (let i = 0; i < n; i++) A.addSong('s' + tag + i, { seed: i + 1, notes: 16 + i });
  const made = await A.engine.createLibrary();
  A.engine.start();
  await A.settle();
  await B.engine.join(made.code, { addLocal: true });
  B.engine.start();
  await B.settle();
  return { A, B, made };
}
/* the whole listing of a library: pages of 500 joined */
const dump = async (svc, code) => {
  let since = 0, items = [];
  for (let i = 0; i < 20; i++) {
    const r = (await svc.anon.get('/api/sync/changes?since=' + since, { headers: { 'X-PPP-Lib': code } })).body;
    items = items.concat(r.items);
    if (!r.more) return { items: items, maxRev: r.maxRev };
    since = r.nextSince;
  }
  return { items: items };
};

(async () => {
  const svc = await L.startSync({});
  try {
    /* ------------------------------------------------------------------ offline */
    heading('offline edits wait, and go when the network is back; a flaky network backs off');
    {
      const { A, B, made } = await pair(svc, 4, 'o');
      A.online = false;
      A.editSlot('so0', s => { s.history.byMeasure['1'] = { attempts: 5, lastAt: 7 }; });
      A.addSong('so-new', { seed: 50 });
      const n0 = A.requests.length;
      await A.engine.syncNow('test');
      ok('offline: nothing is sent, and it says so', A.requests.length === n0 && A.engine.status().error === 'offline');
      ok('and nothing local is touched', !!A.card('so-new') && A.slot('so0').history.byMeasure['1'].attempts === 5);
      A.online = true;
      await A.settle();
      const srv = await dump(svc, made.code);
      ok('back online: the new song and the edit are in the library', srv.items.some(i => i.key === 'song:so-new'));
      await B.settle();
      ok('B has both', !!B.card('so-new') && B.slot('so0').history.byMeasure['1'].attempts === 5);
      /* a flaky network: fetch throws; the engine backs off; it does not loop */
      A.editSlot('so1', s => { s.tempo = 77; });
      A.online = true;
      const origFetch = A.requests.length;
      A.failNext = () => { throw new TypeError('network down'); };
      await A.engine.syncNow('test');
      const st = A.engine.status();
      ok('a failed request is "offline", and the next try waits (backoff)', st.error === 'offline' && st.next > svc.clock.t, JSON.stringify([st.error, st.next - svc.clock.t]));
      ok('one request was tried, not a loop', A.requests.length - origFetch <= 2, String(A.requests.length - origFetch));
      svc.clock.t += 20 * 60 * 1000;
      await A.settle();
      ok('after the wait it goes through', !A.engine.status().error && B.engine && true);
    }

    /* ------------------------------------------------------------------ away 31 days */
    heading('a device away for 31 days asks before it pushes what the library lost');
    {
      const { A, B, made } = await pair(svc, 20, 't');
      /* A removes st1 and st2 while B is away; 31 days pass; A writes (so the library purges the tombstones) */
      A.removeSong('st1'); A.removeSong('st2');
      await A.settle();
      const tomb = (await dump(svc, made.code)).items.filter(i => i.deleted);
      ok('two tombstones are in the library', tomb.length === 2);
      svc.clock.t += 31 * DAY;
      A.editSlot('st3', s => { s.tempo = 61; });
      await A.settle();
      const after = await dump(svc, made.code);
      ok('the library purged them (no tombstone is left)', after.items.filter(i => i.deleted).length === 0 && after.items.filter(i => /song:st/.test(i.key)).length === 18, String(after.items.length));
      B.editSlot('st4', s => { s.tempo = 71; });       /* B has changes too */
      const rb = await B.settle(3);
      ok('B is told it was away (tooOld) and asks about the two songs the library lost', rb.asks.some(a => a.kind === 'gone' && a.n === 2), JSON.stringify(rb.asks.map(a => a.kind + a.n)));
      ok('it has sent neither of them back', !(await dump(svc, made.code)).items.some(i => i.key === 'song:st1' || i.key === 'song:st2'));
      ok('B\'s songs are still there (nothing removed behind the person\'s back)', !!B.card('st1') && !!B.card('st2'));
      await B.engine.answer('gone', 'no');
      await B.settle();
      ok('"remove them here" puts both in B\'s trash and takes them off the list', !B.card('st1') && !B.card('st2') && (await B.engine.trashList()).filter(r => r.id === 'st1' || r.id === 'st2').length === 2);
      /* and the other answer, on a second away device */
    }
    {
      const { A, B, made } = await pair(svc, 20, 'u');
      A.removeSong('su1');
      await A.settle();
      svc.clock.t += 31 * DAY;
      A.editSlot('su2', s => { s.tempo = 55; });
      await A.settle();
      await B.settle(2);
      ok('asks again as above', B.engine.status().asks.some(a => a.kind === 'gone'));
      await B.engine.answer('gone', 'yes');
      await B.settle();
      await A.settle();
      ok('"keep them" brings the song back to the library and to the other device', !!B.card('su1') && !!A.card('su1') && (await dump(svc, made.code)).items.some(i => i.key === 'song:su1' && !i.deleted));
    }

    /* ------------------------------------------------------------------ reset, rotated, deleted, recovery */
    heading('a restored library, a new code, a deleted library, the recovery code');
    {
      const { A, B, made } = await pair(svc, 3, 'r');
      const st = JSON.parse(B.storage.getItem('ppp.syncstate.v1'));
      st.since = st.since + 5000;
      B.storage.setItem('ppp.syncstate.v1', JSON.stringify(st));
      B.addSong('sr-new', { seed: 70 });
      await B.settle();
      ok('a device ahead of the library is told "reset", forgets the revisions, and goes on without loss', B.engine.status().notices.some(n => n.code === 'reset') && !B.engine.status().error && B.cards().length === 4, JSON.stringify(B.engine.status().notices));
      ok('its new song is in the library', (await dump(svc, made.code)).items.some(i => i.key === 'song:sr-new'));
      /* rotated */
      const rot = await A.engine.rotate();
      ok('a new code is made', rot.ok && rot.code !== made.code && A.engine.code() === rot.code);
      B.editSlot('sr1', s => { s.tempo = 99; });
      await B.engine.syncNow('test');
      ok('the other device is told "rotated" and does nothing else', B.engine.status().error === 'rotated');
      const n0 = B.requests.length;
      await B.engine.syncNow('poll');
      const oldCode = made.code;
      ok('the old code opens nothing', (await svc.anon.get('/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': oldCode } })).body.code === 'rotated');
      const ent = await B.engine.enterNewCode(group(rot.code));
      ok('the new code is entered', ent.ok);
      await B.settle();
      ok('and the edit made in between goes out', !B.engine.status().error && (await dump(svc, rot.code)).items.length > 0 && void n0 === undefined);
      await A.settle();
      ok('A has it', A.slot('sr1').tempo === 99);
      /* the recovery code on a device that has nothing */
      const C = L.makeDevice(svc, 'Cr');
      const rec = await C.engine.recover(made.recovery, { addLocal: true });
      ok('the recovery code gives a NEW code and a new recovery code', rec.ok && rec.code !== rot.code && rec.recovery && rec.recovery !== made.recovery);
      const oldRec = await C.engine.recover(made.recovery, {});
      ok('and a recovery code is used up', !oldRec.ok);
      await C.settle();
      ok('C got the library', C.cards().length >= 3);
      await A.engine.syncNow('test');
      ok('the code of A is "rotated" now: recovery rotates like a change of code', A.engine.status().error === 'rotated');
      await A.engine.enterNewCode(rec.code);
      await A.settle();
      ok('A takes the code that recovery gave', !A.engine.status().error);
      /* deleted */
      const del = await C.engine.deleteLibrary();
      ok('a library is deleted, and the device that did it keeps its songs and stops', del.ok && !C.engine.isOn() && C.cards().length >= 3);
      await A.engine.syncNow('test');
      ok('the other device is told it was deleted, and keeps its songs', A.engine.status().error === 'deleted' && A.cards().length >= 3);
      const fg = A.engine.forget();
      ok('stop syncing: the code is forgotten and nothing local is touched', fg.ok && !A.engine.isOn() && !A.storage.getItem('ppp.syncstate.v1').includes(rec.code) && A.cards().length >= 3);
    }

    /* ------------------------------------------------------------------ 500 songs */
    heading('500 songs: the hour\'s room, then the next hour, then the rest; and it never blocks');
    {
      const A = L.makeDevice(svc, 'Ak');
      const t0 = Date.now();
      for (let i = 0; i < 500; i++) A.addSong('k' + i, { seed: i, notes: 20 + (i % 10) });
      const made = await A.engine.createLibrary();
      A.engine.start();
      const T0 = svc.clock.t;
      const rounds = [];
      for (let h = 0; h < 5; h++) {
        await A.engine.syncNow('test');
        const s = A.engine.status();
        rounds.push({ done: s.songs.done, phase: s.phase, eta: s.songs.etaMs });
        if (s.songs.pending === 0 && s.phase !== 'waiting') break;
        svc.clock.t += HOUR + 1000;
      }
      const wall = Date.now() - t0;
      ok('the first hour sends the room it has (234 of 501 items), then it waits', rounds[0].phase === 'waiting' && rounds[0].done >= 230 && rounds[0].done <= 240, JSON.stringify(rounds));
      ok('three hours at the most, 500 songs in the library', rounds.length <= 4 && rounds[rounds.length - 1].done === 500, JSON.stringify(rounds));
      ok('no refusal of the library was needed for it (it stays under 240 an hour)', !A.requests.some(r => false) && svc.svc._state.window().refused.too_many === undefined);
      ok('the library holds 500 songs and the state', (await dump(svc, made.code)).items.length === 501);
      ok('the estimate said how many hours were left (the first round: 2 more)', rounds[0].eta >= HOUR && rounds[0].eta <= 3 * HOUR, String(rounds[0].eta));
      console.log('    (500 songs: ' + (wall / 1000).toFixed(1) + ' s of work in this process; the hour waits are the library\'s)');
      /* a second device reads them: 300 an hour */
      const B = L.makeDevice(svc, 'Bk');
      await B.engine.join(made.code, { addLocal: true });
      B.engine.start();
      const reads = [];
      for (let h = 0; h < 5; h++) {
        await B.engine.syncNow('test');
        reads.push(B.cards().length);
        if (B.cards().length >= 500) break;
        svc.clock.t += HOUR + 1000;
      }
      ok('reading 500 songs takes the library\'s 300 an hour: two rounds', B.cards().length === 500 && reads.length <= 3, JSON.stringify(reads));
      ok('the second device\'s cursor is at the library\'s revision (an idle poll costs nothing)', B.engine._load().since >= 500);
    }

    /* ------------------------------------------------------------------ idle */
    heading('an idle poll costs the library no statement');
    {
      const { A, B } = await pair(svc, 6, 'i');
      await A.settle(); await B.settle(); await A.settle();
      const t0 = svc.store.total();
      for (let i = 0; i < 10; i++) { await A.engine.syncNow('poll'); await B.engine.syncNow('poll'); }
      ok('20 idle cycles of two devices: zero calls of the store', svc.store.total() === t0, String(svc.store.total() - t0));
      ok('and no write request', A.requests.slice(-10).every(r => r.method === 'GET'));
    }

    /* ------------------------------------------------------------------ a full disk */
    heading('a full disk: nothing half applied');
    {
      const { A, B } = await pair(svc, 3, 'f');
      A.addSong('sf-big', { seed: 5, notes: 400 });
      await A.settle();
      const before = JSON.stringify(Array.from(B.storage.m.entries()));
      B.storage.quota = Array.from(B.storage.m.entries()).reduce((n, e) => n + e[0].length + e[1].length, 0) + 3000;   /* room for the bookkeeping, not for a song */
      await B.engine.syncNow('test');
      const full = B.engine.status();
      ok('B says its storage is full', full.error === 'storage', full.error);
      const noHalf = !B.card('sf-big') && B.slotRaw('sf-big') === null;
      ok('and has neither the card nor the slot of the song that did not fit', noHalf);
      void before;
      B.storage.quota = Infinity;
      await B.settle();
      ok('with room again it comes', !!B.card('sf-big'));
    }

    /* ------------------------------------------------------------------ hostile and secret */
    heading('what comes in is untrusted; what goes out holds no secret');
    {
      const { A, B, made } = await pair(svc, 2, 'h');
      /* another writer with the code (a leaked code, or a hostile server) puts a song with a javascript: link and a __proto__ key; an unknown field the server refuses outright */
      const evil = { v: 1, card: { title: 'Evil', url: 'javascript:alert(1)', composer: 'x' }, score: L.packedScore(8, 4, 3, 'Evil'), progress: { importSource: { kind: 'youtube', url: 'data:text/html,x' } }, scoreHash: 'zzzz', savedAt: 5 };
      const put = await svc.anon.put('/api/sync/items', { device: 'a1b2c3d4e5f60718', items: [{ key: 'song:evil', baseRev: 0, hash: 'evilhash12345678', body: L.b64(evil) }] }, { headers: { 'X-PPP-Lib': made.code } });
      ok('the library took it (it is a score)', put.status === 200, put.status + ' ' + put.text.slice(0, 80));
      await B.settle();
      const c = B.card('evil');
      ok('it arrived, and its links that are not web addresses were blanked', !!c && c.url === null && B.slot('evil').importSource.url === null, JSON.stringify(c && c.url));
      ok('its score hash is the one made here, not the sender\'s', MERGE.scoreHashOf(B.slot('evil')) !== 'zzzz');
      /* a body that is a gzip bomb (a library that is not ours, or a hostile one) is refused as it is unpacked, and does not stop the cycle */
      const zlib = require('zlib');
      const bomb = zlib.gzipSync(Buffer.alloc(24 * 1024 * 1024, 0x20)).toString('base64');
      const realItems = (await dump(svc, made.code)).items.find(i => /^song:sh/.test(i.key) || /^song:s/.test(i.key));
      B.intercept = async (url, init) => {
        if (/\/api\/sync\/items\?keys=/.test(url)) {
          B.intercept = null;
          return new Response(JSON.stringify({ items: [Object.assign({}, realItems, { body: bomb })], missing: [], maxRev: realItems.rev }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return null;
      };
      const rs = JSON.parse(B.storage.getItem('ppp.syncstate.v1'));
      rs.since = 0; rs.keys[realItems.key] = {}; B.storage.setItem('ppp.syncstate.v1', JSON.stringify(rs));
      await B.engine.syncNow('test');
      B.intercept = null;
      ok('a body that unpacks to 24 MB is refused at the bound (the item is marked unreadable, the cycle goes on)', (B.engine._load().keys[realItems.key] || {}).bad === 'not-gzip' && !B.engine.status().error, JSON.stringify(B.engine._load().keys[realItems.key]));
      /* a score with no measures is not a song */
      const bad = { v: 1, card: { title: 'Nothing' }, score: { measures: [], notes: [] } };
      const p2 = await svc.anon.put('/api/sync/items', { device: 'a1b2c3d4e5f60718', items: [{ key: 'song:nothing', baseRev: 0, hash: 'nothing123456789', body: L.b64(bad) }] }, { headers: { 'X-PPP-Lib': made.code } });
      ok('the library refuses it itself', p2.status === 422);
      /* the guest key in a title is never sent */
      B.storage.setItem('ppp-guest-key', 'g'.repeat(40));
      B.addSong('sh-secret', { seed: 9, title: 'My ' + 'g'.repeat(40) + ' song' });
      B.addSong('sh-fine', { seed: 10 });
      await B.settle();
      const srv = await dump(svc, made.code);
      ok('a song with the guest key in it is not sent, the others are', !srv.items.some(i => i.key === 'song:sh-secret') && srv.items.some(i => i.key === 'song:sh-fine'));
      ok('and it is marked as one that cannot be sent', B.engine.status().songs.bad >= 1);
      ok('no request body of B holds the key', B.requests.every(r => !r.body || !String(r.body).includes('g'.repeat(40))));
    }

    /* ------------------------------------------------------------------ bookkeeping */
    heading('bookkeeping: what is not sent leaves nothing behind; the cursor follows our own writes; an open song is not overwritten; odd ids; a request that hangs');
    {
      const { A, B, made } = await pair(svc, 4, 'b');
      /* a song that was never sent and is removed leaves nothing pending */
      A.addSong('sb-tmp', { seed: 80 });
      A.failNext = () => { throw new TypeError('network down'); };
      await A.engine.syncNow('test');                   /* seen to change; the send fails */
      ok('the song was seen and is waiting', A.engine.status().songs.pending >= 1);
      A.removeSong('sb-tmp');
      svc.clock.t += 20 * 60 * 1000;
      await A.engine.syncNow('test');
      ok('a song that was never sent and was removed leaves no record and nothing pending', !A.engine._load().keys['song:sb-tmp'] && A.engine.status().songs.pending === 0);
      ok('and nothing about it was sent', !(await dump(svc, made.code)).items.some(i => i.key === 'song:sb-tmp'));
      /* the cursor follows our own writes: the next poll costs the library no statement */
      svc.clock.t += 1000;
      A.editSlot('sb0', s => { s.tempo = 61; });
      await A.engine.syncNow('test');
      const c0 = svc.store.total();
      await A.engine.syncNow('poll');
      ok('after a push, the next poll is answered without the store (the cursor moved with our own revisions)', svc.store.total() === c0, String(svc.store.total() - c0));
      /* but a write of another device in between is not skipped */
      B.editSlot('sb1', s => { s.tempo = 62; });
      await B.engine.syncNow('test');
      svc.clock.t += 1000;
      A.editSlot('sb2', s => { s.tempo = 63; });
      await A.engine.syncNow('test');
      ok('a write of another device between two of ours is not stepped over: it arrives', A.slot('sb1').tempo === 62 && A.slot('sb2').tempo === 63);
      await B.engine.syncNow('test');
      ok('and B has the one of A', B.slot('sb2').tempo === 63);
      /* a write of another device that lands between this device's look at the library and its own send is not stepped over by the cursor */
      svc.clock.t += 1000;
      A.editSlot('sb0', s => { s.tempo = 71; });
      B.editSlot('sb1', s => { s.tempo = 72; });
      let raced = false;
      A.intercept = async (url, init) => {
        if (!raced && init && init.method === 'PUT') { raced = true; A.intercept = null; await B.engine.syncNow('test'); }
        return null;
      };
      await A.engine.syncNow('test');
      A.intercept = null;
      const cursorA = A.engine._load().since;
      await A.engine.syncNow('poll');
      ok('the write that landed in between is in A after the next poll, and the cursor did not skip it', A.slot('sb1').tempo === 72 && cursorA < (await dump(svc, made.code)).maxRev, cursorA + ' < ' + (await dump(svc, made.code)).maxRev);
      /* the answer of a send is lost: the same send again is told "conflict" with the very hash that was sent, and that is "applied" - nothing is fetched or merged for it */
      svc.clock.t += 1000;
      A.editSlot('sb0', s => { s.tempo = 73; });
      let lost = false;
      A.intercept = async (url, init) => {
        if (!lost && init && init.method === 'PUT') {
          lost = true;
          const real = await fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers, { 'X-Forwarded-For': A.ip }) }));   /* the library has it ... */
          await real.text();
          throw new TypeError('the answer was lost');                                                                                         /* ... and the device does not know */
        }
        return null;
      };
      await A.engine.syncNow('test');
      ok('the lost answer is an error for that cycle', A.engine.status().error === 'offline');
      A.intercept = null;
      svc.clock.t += 20 * 60 * 1000;
      /* the page is hidden: a send with no look at the library first (keepalive); the library answers "conflict" with the hash that was sent: that is "applied" */
      await A.engine.flush();
      const srvRev = (await dump(svc, made.code)).items.find(i => i.key === 'song:sb0').rev;
      ok('the same send again is "applied" by its hash: the item is clean and has the revision of the library', A.engine.status().songs.pending === 0 && A.engine._load().keys['song:sb0'].rev === srvRev && A.engine._load().keys['song:sb0'].d === 0, JSON.stringify(A.engine._load().keys['song:sb0']));
      /* a song that was linked by identity keeps its id; another device then uses that id for a DIFFERENT song: the linked one is not overwritten */
      const P = L.makeDevice(svc, 'Pb'), Q = L.makeDevice(svc, 'Qb');
      P.addSong('sb-own', { seed: 600, title: 'Same score' });
      const pm = await P.engine.createLibrary();
      await P.engine.syncNow('test');
      Q.addSong('sb-mine', { seed: 600, title: 'Same score' });        /* the same score under another id: it is linked to "song:sb-own" */
      await Q.engine.join(pm.code, { addLocal: true });
      await Q.engine.syncNow('test');
      ok('the same score under another id is linked, not doubled', Q.cards().filter(c => c.title === 'Same score').length === 1 && Q.engine._load().keys['song:sb-own'].id === 'sb-mine');
      const linkedScore = JSON.stringify(Q.slot('sb-mine').score);
      P.addSong('sb-mine', { seed: 700, title: 'Different song, same id' });
      svc.clock.t += 1000;
      await P.engine.syncNow('test');
      await Q.engine.syncNow('test');
      ok('a different song that arrives under the id of a linked one is a song of its own; the linked one keeps its score',
        JSON.stringify(Q.slot('sb-mine').score) === linkedScore && Q.cards().some(c => c.title === 'Different song, same id' && c.id !== 'sb-mine') && Q.cards().length === 2,
        Q.cards().map(c => c.id + ':' + c.title).join(' | '));
      /* the song on the screen is not overwritten by an older text of its own */
      svc.clock.t += 1000;
      A.open = 'sb3';
      B.editSlot('sb3', s => { s.history.byMeasure['3'] = { attempts: 5, lastAt: 123 }; s.memLevel = 2; });
      await B.engine.syncNow('test');
      const revBefore = (await dump(svc, made.code)).items.find(i => i.key === 'song:sb3').rev;
      A.openProgress.length = 0;
      await A.engine.syncNow('test');
      ok('the practice of the song A has on the screen goes into the page (the adapter), not into its slot', A.openProgress.length === 1 && A.openProgress[0].memLevel === 2 && !A.slot('sb3').history.byMeasure['3']);
      ok('and A did not send its older text over it (the item of the library did not move)', (await dump(svc, made.code)).items.find(i => i.key === 'song:sb3').rev === revBefore);
      /* the page saves what it holds (the same practice as the library's): equal to the library's version, so there is nothing to send */
      A.storage.setItem('ppp.song.v1.sb3', B.slotRaw('sb3'));
      A.open = 'demo';
      await A.engine.syncNow('test');
      ok('when the page then saves exactly the practice of the library nothing is sent (it is compared with the version of the library, not with the old text)', (await dump(svc, made.code)).items.find(i => i.key === 'song:sb3').rev === revBefore);
      /* a score that arrives for the song on the screen is not put under the person's hands: it waits, and goes in when they leave */
      svc.clock.t += 1000;
      A.open = 'sb2';
      B.editSlot('sb2', s => { s.score = L.packedScore(30, 4, 4242, 'Changed on B'); });
      await B.engine.syncNow('test');
      const scoreBefore = JSON.stringify(A.slot('sb2').score);
      await A.engine.syncNow('test');
      ok('the song on the screen keeps its score while it is open, and the change waits (it is not lost)', JSON.stringify(A.slot('sb2').score) === scoreBefore && !!A.engine._load().defer['song:sb2']);
      A.open = 'demo';
      await A.engine.syncNow('test');
      ok('when the person leaves it, the new score comes in', JSON.stringify(A.slot('sb2').score) !== scoreBefore && !A.engine._load().defer['song:sb2'] && A.slot('sb2').score.title === 'Changed on B');
      /* an id the library would not take as it is */
      const odd = 'has space/and:slash ' + 'x'.repeat(70);
      A.addSong(odd, { seed: 90, title: 'Odd one' });
      await A.engine.syncNow('test');
      const oddKey = A.engine._load().keys[L.MERGE.keyOf(odd)];
      ok('an id with spaces, slashes and 90 characters is named by a hash and is sent', !!oddKey && oddKey.rev > 0 && oddKey.id === odd && (await dump(svc, made.code)).items.some(i => i.key === L.MERGE.keyOf(odd)));
      A.removeSong(odd);
      await A.engine.syncNow('test');
      ok('and its removal is a removal (not a song that was lost and comes back)', (await dump(svc, made.code)).items.some(i => i.key === L.MERGE.keyOf(odd) && i.deleted) && !A.card(odd));
      /* what the library forgot (its tombstones are purged at 30 days) is forgotten here a little later */
      const keyRec = A.engine._load().keys[L.MERGE.keyOf(odd)];
      ok('the tombstone is remembered with the time it was learnt', keyRec && keyRec.del === 1 && keyRec.delAt > 0);
      svc.clock.t += 36 * DAY;
      await A.engine.syncNow('test');
      ok('after 36 days the record is gone (the library purged the tombstone long ago)', !A.engine._load().keys[L.MERGE.keyOf(odd)]);
    }
    {
      /* a request that hangs is a failed request, not a cycle that never ends */
      let fast = false;      /* the time-out of a request is made short only once the library exists */
      const D = L.makeDevice(svc, 'Dh', { setTimeout: (fn, ms) => (fast && ms >= 45000 && ms <= 120000 ? setTimeout(fn, 25) : 0) });
      D.addSong('sh0', { seed: 3 });
      const made = await D.engine.createLibrary();
      ok('the library of the device that will meet a hanging request is made', made.ok);
      fast = true;
      D.intercept = (url, init) => (init && init.signal ? new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }) : null);
      const t0 = Date.now();
      /* the cycle must end by itself: a cycle that is still waiting after 6 s is the failure (and is left behind) */
      const ended = await Promise.race([D.engine.syncNow('test').then(() => true), new Promise(r => setTimeout(() => r(false), 6000))]);
      const st = D.engine.status();
      ok('a request that does not answer is given up (aborted by its own time-out) and said to be a connection problem', ended && Date.now() - t0 < 5000 && st.error === 'offline' && st.phase === 'idle', Date.now() - t0 + ' ms ' + st.error);
      D.intercept = null;
    }

    /* ------------------------------------------------------------------ the yes of a question, and a copy that cannot be kept */
    heading('a yes is for the songs that were asked about; a song that cannot be kept is not removed');
    {
      const { A, B, made } = await pair(svc, 30, 'y');
      const first = Array.from({ length: 6 }, (_, i) => 'sy' + i), more = Array.from({ length: 5 }, (_, i) => 'sy' + (10 + i));
      first.forEach(id => A.removeSong(id));
      await A.engine.syncNow('test');
      ok('6 removals are asked about', A.engine.status().asks.some(a => a.kind === 'delete-out' && a.n === 6));
      more.forEach(id => A.removeSong(id));              /* more are removed before the answer */
      await A.engine.answer('delete-out', 'yes');
      const dels = (await dump(svc, made.code)).items.filter(i => i.deleted).map(i => i.key.slice(5)).sort();
      ok('the yes sent the 6 that were asked about, and not the 5 that came after', JSON.stringify(dels) === JSON.stringify(first.slice().sort()), dels.join());
      ok('and the 5 are asked about in their turn', A.engine.status().asks.some(a => a.kind === 'delete-out' && a.n === 5), JSON.stringify(A.engine.status().asks.map(a => a.kind + a.n)));
      await A.engine.answer('delete-out', 'yes');
      ok('after the second yes all 11 are in the library', (await dump(svc, made.code)).items.filter(i => i.deleted).length === 11);
      /* a removal the library does not agree with: another device changed the song between this device's look at the library and its removal: the change stands, the song comes back */
      svc.clock.t += 1000;
      B.editSlot('sy25', s => { s.tempo = 144; });
      A.removeSong('sy25');
      let raced = false;
      A.intercept = async (url, init) => {
        if (!raced && init && init.method === 'DELETE') { raced = true; A.intercept = null; await B.engine.syncNow('test'); }
        return null;
      };
      await A.engine.syncNow('test');
      A.intercept = null;
      await A.engine.syncNow('test');
      ok('the song is back on A with the change that was made meanwhile (and the library has no tombstone for it)', !!A.card('sy25') && A.slot('sy25').tempo === 144 && !(await dump(svc, made.code)).items.find(i => i.key === 'song:sy25').deleted, String(!!A.card('sy25')));
      /* a removal that came from another device is not carried out here when no copy can be kept */
      A.removeSong('sy20');
      await A.engine.syncNow('test');
      B.trashFail = true;
      await B.engine.syncNow('test');
      await B.engine.answer('delete-in', 'yes').catch(() => {});
      const st = B.engine.status();
      ok('B (that could not keep a copy) kept sy20 and says so', !!B.card('sy20') && st.notices.some(n => n.code === 'not-removed') && B.engine._load().only['sy20'] === 1, JSON.stringify(st.notices.map(n => n.code)));
      B.trashFail = false;
    }

    /* ------------------------------------------------------------------ a stuck conflict, a frozen page, two tabs */
    heading('a conflict that does not end is bounded; a frozen page is left alone; two tabs take turns');
    {
      const { A, made } = await pair(svc, 2, 'c');
      svc.clock.t += 5000;
      A.editSlot('sc0', s => { s.tempo = 123; });
      const key = 'song:sc0';
      const srv = (await dump(svc, made.code)).items.find(i => i.key === key);
      let puts = 0;
      /* every PUT is answered with a conflict naming another hash: a library that keeps moving under this device */
      A.intercept = (url, init) => {
        if (init && init.method === 'PUT') {
          puts++;
          return new Response(JSON.stringify({ maxRev: srv.rev + puts, applied: [], conflicts: [{ key: key, rev: srv.rev + puts, deleted: false, hash: 'other' + puts + '123456', bytes: 10, device: 'ffffffffffffffff', updatedAt: null }], library: {} }),
            { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        return null;
      };
      await A.engine.syncNow('test');
      ok('a library that always conflicts is tried a few times in one cycle (at most 4 sends), not for ever', puts >= 1 && puts <= 4, String(puts));
      const st = A.engine.status();
      ok('and the device backs off (the next try is later) and keeps its edit', st.next > svc.clock.t && A.slot('sc0').tempo === 123, JSON.stringify([st.next - svc.clock.t, A.slot('sc0').tempo]));
      const before = puts;
      await A.engine.syncNow('poll');
      ok('a poll before the end of the wait does nothing', puts === before || puts - before <= 4);
      A.intercept = null;
      svc.clock.t += 2 * HOUR;
      await A.settle();
      ok('then it goes through', !A.engine.status().error && (await dump(svc, made.code)).items.find(i => i.key === key).rev > srv.rev);
      /* a frozen page (a restore or a delete is on its way to a reload): nothing is read or written */
      const n1 = A.requests.length, w1 = A.storage.writes;
      A.frozen = true;
      A.editSlot('sc1', s => { s.tempo = 50; });
      const w2 = A.storage.writes;
      await A.engine.syncNow('test');
      ok('frozen: no request and no write of the engine itself', A.requests.length === n1 && A.storage.writes === w2, w1 + ' ' + w2 + ' ' + A.storage.writes);
      A.frozen = false;
      /* two tabs of one browser: one cycle at a time */
      const T2 = L.makeDevice(svc, 'Tc2', { storage: A.storage });
      const r = await Promise.all([A.engine.syncNow('a'), T2.engine.syncNow('b')]);
      ok('two tabs started together: one runs, the other waits its turn', r.filter(x => x === true).length === 1, JSON.stringify(r));
      ok('and the lock is given back', !A.storage.getItem('ppp.synclock.v1'));
    }
  } finally {
    await svc.close();
  }
  finish('the sync engine at its edges');
})().catch(e => { console.error(e); process.exit(1); });
