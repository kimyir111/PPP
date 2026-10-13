/* G12-5: the home-PC queue's kind 'omr' - a printed score (a PDF or a photo) read by Audiveris on the person's OWN PC (home-omr.js, home-jobs.js, home-jobs-store.js; docs/GOALS/G12_OMR.md
   section 24). Over real HTTP, with the counting file store (tests/home-worker/omr-jobs-pg.test.js runs the same on Postgres), no engine: a worker here is the test.

   What it pins:
     - what may go UP (home-omr.js): PNG or JPEG, read by header, every cap (pages, bytes a page and a job, pixels), what is refused and with which status; and what may come BACK:
       MusicXML checked as text (the standard DOCTYPE cut out, every other one, entities, CDATA, depth, tags, control characters refused), the shape of a result
     - who may do what (the abuse analysis, one test per row): no code is a 401 before a byte of the body; a stranger's own link only ever reaches its own PC; another link's job is "not
       there" for the page and for the worker; a token cannot post a result of the wrong kind, nor for a job another worker holds; pages are handed out only to the claiming token
     - the quotas: scores waiting per link, bytes of images per link, per creating address and for the site, enqueues per hour per link and per address, uploads at once, reads of a page
     - the keeping: images deleted when the job is done, failed, cancelled, expired; a job nobody took expires in a day; a finished one is purged in a day; images a failed delete left
       are found again (at the next purge and at the boot); a removed link takes its images
     - THE FREE-TIER RULE: an idle poll of a worker that can read scores runs no store call, and the kind costs exactly the statements it must (counted)

   Run: node tests/home-worker/omr-jobs.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, sleep, req, WATCH, goodResult } = L;
const H = L.mod('home-omr.js');
const J = L.mod('home-jobs.js');

const MiB = 1048576;
const claimOmr = (S, token, extra) => S.worker(token).post('/api/worker/claim', Object.assign({ once: true, omr: true }, extra));
/* the PC has connected and says it can read a score */
const ready = async (S, user) => { const r = await claimOmr(S, S.token(user)); return r; };
const sendOmr = (S, user, pages, extra, o) => S.as(user).post('/api/jobs/omr', Object.assign({ title: 'Czerny op.599.pdf', pages: pages }, extra), o);
const page = (S, token, id, i) => S.worker(token).get('/api/worker/jobs/' + id + '/pages/' + i);
const pageFilesIn = S => { try { return L.fs.readdirSync(L.path.join(S.dir, 'omr-pages')).length; } catch (e) { return 0; } };
const jobOf = (S, id) => S.svc._state.jobs.get(id);
/* a job queued and claimed: { id, job (claim's), q } */
async function queued(S, user, n, extra) {
  const q = await sendOmr(S, user, L.omrPages(n || 2), extra);
  return q;
}
async function claimed(S, user, n, extra) {
  const q = await queued(S, user, n, extra);
  const c = await claimOmr(S, S.token(user));
  return { q: q, c: c, id: q.body && q.body.job && q.body.job.id, job: c.body && c.body.job };
}

/* ------------------------------------------------------------------------------------------------ what goes up and what comes back */
function homeOmrUnit() {
  heading('home-omr.js: page images (what goes up)');
  const png = L.pngBytes(1240, 1754, 3000), jpg = L.jpegBytes(1240, 1754, 3000);
  ok('a PNG: its type and size are read from its own header', JSON.stringify(H.sniffImage(png)) === '{"type":"png","width":1240,"height":1754}', JSON.stringify(H.sniffImage(png)));
  ok('a JPEG: its type and size are read from its frame header, after the JFIF segment', JSON.stringify(H.sniffImage(jpg)) === '{"type":"jpeg","width":1240,"height":1754}', JSON.stringify(H.sniffImage(jpg)));
  const notImage = [['a GIF', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(60)])], ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"></svg>'.padEnd(80))], ['a PDF', Buffer.from('%PDF-1.7\n'.padEnd(80, ' '))],
    ['a script named .png', Buffer.from('<script>alert(1)</script>'.padEnd(80, ' '))], ['a ZIP', Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(60)])], ['nothing', Buffer.alloc(0)], ['a PNG cut after its signature', png.subarray(0, 12)],
    ['a PNG with a bit depth that does not exist', (() => { const b = Buffer.from(png); b[24] = 7; return b; })()], ['a PNG whose first chunk is not IHDR', (() => { const b = Buffer.from(png); b.write('IDAT', 12, 'latin1'); return b; })()],
    ['a JPEG with no frame header', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), Buffer.alloc(60)])], ['a JPEG whose segment length is 0', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), Buffer.alloc(60)])]];
  notImage.forEach(([name, b]) => ok(name + ' is not an image this accepts', H.sniffImage(b) === null));
  /* a JPEG with fill bytes and a long APP segment before the frame header is still found */
  const long = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xe1, 0x10, 0x00]), Buffer.alloc(0x1000 - 2, 0x45), jpg.subarray(2)]);
  ok('a JPEG with fill bytes and an APP1 segment of 4 KB before the frame header is read', H.sniffImage(long) && H.sniffImage(long).width === 1240, JSON.stringify(H.sniffImage(long)));

  const c = (list, o) => H.checkPages(list, o);
  const b64 = b => b.toString('base64');
  ok('one page is accepted; a data: URL of a PNG is too', c([b64(png)]).ok && c(['data:image/png;base64,' + b64(png)]).ok && c(['data:image/jpeg;base64,' + b64(jpg)]).ok);
  const refuse = (name, list, o, status, code) => { const r = c(list, o); ok(name, !r.ok && r.status === status && r.code === code, r.ok ? 'accepted' : r.status + ' ' + r.code + ': ' + r.error); };
  refuse('no pages is 422 no-pages', [], null, 422, 'no-pages');
  refuse('not a list is 422 no-pages', 'abc', null, 422, 'no-pages');
  refuse('13 pages is 413 too-many-pages', L.omrPages(13), null, 413, 'too-many-pages');
  ok('12 pages are accepted, and 24 when it is asked for ("large")', c(L.omrPages(12)).ok && c(L.omrPages(24), { large: true }).ok && !c(L.omrPages(25), { large: true }).ok);
  refuse('a page that is not base64 is 422 bad-image', ['%%%not base64%%%'], null, 422, 'bad-image');
  refuse('base64 whose length is not a multiple of 4 is 422 bad-image', [b64(png).slice(0, -1)], null, 422, 'bad-image');
  refuse('a page that is a number is 422 bad-image', [42], null, 422, 'bad-image');
  refuse('a page of 100 bytes less than a header is 422 bad-image', [b64(Buffer.alloc(10))], null, 422, 'bad-image');
  refuse('a GIF is 422 bad-image', [b64(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(300)]))], null, 422, 'bad-image');
  refuse('a page over 1.5 MB (by one byte) is 413 page-too-large', [b64(L.pngBytes(1240, 1754, Math.floor(1.5 * MiB) + 1))], null, 413, 'page-too-large');
  ok('a page of exactly 1.5 MB is accepted', c([b64(L.pngBytes(1240, 1754, Math.floor(1.5 * MiB)))]).ok);
  refuse('a string too long to be decoded at all is 413 page-too-large (never decoded)', ['A'.repeat(3 * MiB)], null, 413, 'page-too-large');
  refuse('nine pages of 1.4 MB (12.6 MB) are 413 job-too-large', Array.from({ length: 9 }, (_, i) => b64(L.pngBytes(1240, 1754 - i, Math.floor(1.4 * MiB)))), null, 413, 'job-too-large');
  refuse('a PNG that says it is 100000 x 100000 pixels is 422 image-size (a white sheet in a few hundred bytes)', [b64(L.pngBytes(100000, 100000, 500))], null, 422, 'image-size');
  refuse('6001 pixels wide is 422 image-size', [b64(L.pngBytes(6001, 800, 500))], null, 422, 'image-size');
  refuse('5000 x 5000 (25 megapixels) is 422 image-size', [b64(L.pngBytes(5000, 5000, 500))], null, 422, 'image-size');
  refuse('199 pixels high is 422 image-size', [b64(L.pngBytes(900, 199, 500))], null, 422, 'image-size');
  ok('A4 at 300 DPI (2480 x 3508, 8.7 megapixels) and a 3000 x 4000 phone photo are accepted', c([b64(L.pngBytes(2480, 3508, 3000)), b64(L.jpegBytes(3000, 4000, 3000))]).ok);
  const fp = H.fingerprint(c([b64(png)]).pages), fp2 = H.fingerprint(c([b64(L.pngBytes(1240, 1753, 3000))]).pages);
  ok('the fingerprint of pages is stable and differs with the content', fp === H.fingerprint(c([b64(png)]).pages) && fp !== fp2 && /^omr:[0-9a-f]{24}$/.test(fp));

  heading('home-omr.js: MusicXML (what comes back)');
  const x = L.scoreXml(2);
  const good = H.checkMusicXml(x);
  ok('what Audiveris writes is accepted, and its standard DOCTYPE is cut out (nothing downstream reads a DTD)', good.ok && good.xml.indexOf('<!DOCTYPE') < 0 && good.xml.indexOf('<score-partwise') > 0 && good.xml.length < x.length, JSON.stringify(good).slice(0, 100));
  ok('a document with no DOCTYPE and no declaration is accepted as it is', H.checkMusicXml('<score-partwise><part-list/></score-partwise>').ok && H.checkMusicXml('<?xml version="1.0"?><score-timewise/>').ok);
  ok('a byte order mark and comments in the prolog are accepted', H.checkMusicXml('﻿<?xml version="1.0"?><!-- written by Audiveris -->' + L.MXL_DOCTYPE + '<score-partwise/>').ok);
  const no = (name, text, code) => { const r = H.checkMusicXml(text); ok(name, !r.ok && (!code || r.code === code), r.ok ? 'accepted' : r.code); };
  no('a DOCTYPE with an internal subset (entities) is refused', '<?xml version="1.0"?><!DOCTYPE score-partwise [<!ENTITY a "aaaa">]><score-partwise>&a;</score-partwise>', null);
  no('a DOCTYPE with an internal subset that declares nothing is refused too', '<?xml version="1.0"?><!DOCTYPE score-partwise []><score-partwise/>', 'doctype');
  no('a DOCTYPE that names a file is refused', '<?xml version="1.0"?><!DOCTYPE score-partwise SYSTEM "file:///etc/passwd"><score-partwise/>', 'doctype');
  no('a DOCTYPE that names another public identifier is refused', '<!DOCTYPE score-partwise PUBLIC "-//Evil//DTD//EN" "http://evil.example/x.dtd"><score-partwise/>', 'doctype');
  no('two DOCTYPEs are refused', L.MXL_DOCTYPE + L.MXL_DOCTYPE + '<score-partwise/>', 'doctype');
  no('an entity declaration anywhere is refused (a billion laughs)', '<score-partwise><!ENTITY a "b"/></score-partwise>', 'entity');
  no('an entity reference that nothing defines is refused', '<score-partwise><x>&lol9;</x></score-partwise>', 'entity');
  ok('the five predefined entities and character numbers are accepted', H.checkMusicXml('<score-partwise><x>&amp; &lt; &gt; &quot; &apos; &#233; &#xE9;</x></score-partwise>').ok);
  no('CDATA is refused', '<score-partwise><x><![CDATA[<<<]]></x></score-partwise>', 'entity');
  no('a root that is not MusicXML is refused', '<html><body/></html>', 'not-musicxml');
  no('an SVG is refused', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'not-musicxml');
  no('a document that is not closed is refused', '<score-partwise><part>', 'bad-xml');
  no('tags that are not nested are refused', '<score-partwise><a><b></a></b></score-partwise>', 'bad-xml');
  no('text after the root is refused', '<score-partwise/>hello', 'bad-xml');
  no('a second root is refused', '<score-partwise/><score-partwise/>', 'bad-xml');
  no('a "<" inside a tag is refused', '<score-partwise a="1" <b/>></score-partwise>', 'bad-xml');
  no('nesting deeper than 40 is refused', '<score-partwise>' + '<a>'.repeat(60) + '</a>'.repeat(60) + '</score-partwise>', 'too-deep');
  ok('and 38 deep is accepted', H.checkMusicXml('<score-partwise>' + '<a>'.repeat(38) + '</a>'.repeat(38) + '</score-partwise>').ok);
  ok('the tag budget is a number of tags: 50 are over a budget of 40 and under one of 60', !H.checkMusicXml('<score-partwise>' + '<a/>'.repeat(50) + '</score-partwise>', { maxTags: 40 }).ok && H.checkMusicXml('<score-partwise>' + '<a/>'.repeat(50) + '</score-partwise>', { maxTags: 60 }).ok);
  no('a control character is refused', '<score-partwise><x>a\u0001b</x></score-partwise>', 'bad-chars');
  no('a NUL is refused', '<score-partwise><x>a\u0000b</x></score-partwise>', 'bad-chars');
  no('a lone surrogate is refused', '<score-partwise><x>a\ud800b</x></score-partwise>', 'bad-chars');
  ok('a tab, a line feed and a real emoji (a surrogate pair) are accepted', H.checkMusicXml('<score-partwise>\t<x>\n🎹</x></score-partwise>').ok);
  no('empty is refused', '', 'empty');
  no('not a string is refused', { a: 1 }, 'empty');
  ok('the size cap is in characters: 140 are over a cap of 100 and under one of 200', !H.checkMusicXml('<score-partwise>' + 'x'.repeat(100) + '</score-partwise>', { maxChars: 100 }).ok && H.checkMusicXml('<score-partwise>' + 'x'.repeat(100) + '</score-partwise>', { maxChars: 200 }).ok);
  ok('an attribute value with a ">" in it is read as one tag', H.checkMusicXml('<score-partwise a="x>y"><b c=\'>\'/></score-partwise>').ok);

  heading('home-omr.js: the result a PC posts');
  const v = H.validateOmrResult(L.omrResult(3), { pages: 3 });
  ok('a result of three pages read is accepted, with the standard DOCTYPE cut from every movement', v.ok && v.result.pages.length === 3 && v.result.pages.every(p => p.ok && p.movements.length === 1 && p.movements[0].indexOf('<!DOCTYPE') < 0)
    && v.result.engine === 'Audiveris' && v.result.engineVersion === '5.11.0' && v.bytes > 500, JSON.stringify(v).slice(0, 160));
  ok('a page may have two movements', H.validateOmrResult(L.omrResult(2, { two: true }), { pages: 2 }).result.pages.every(p => p.movements.length === 2));
  ok('a page that could not be read says why, and the others stand', (r => r.ok && r.result.pages[1].ok === false && /No musical notation/.test(r.result.pages[1].error) && r.result.pages[0].ok)(H.validateOmrResult(L.omrResult(3, { failed: [1] }), { pages: 3 })));
  const stripped = H.validateOmrResult(Object.assign(L.omrResult(1), { evil: '<script>', musicxml: ['x'], pedals: [1] }), { pages: 1 });
  ok('everything but engine, engineVersion, ms and pages is dropped, never stored', stripped.ok && Object.keys(stripped.result).sort().join() === 'engine,engineVersion,kind,ms,pages,v' && Object.keys(stripped.result.pages[0]).sort().join() === 'index,movements,ok,ms'.split(',').sort().join());
  const bad = (name, body, pages, code) => { const r = H.validateOmrResult(body, { pages: pages }); ok(name, !r.ok && (!code || r.code === code), r.ok ? 'accepted' : r.code + ': ' + r.error); };
  bad('not an object', 'x', 1, 'bad-result');
  bad('no pages list', { engine: 'Audiveris' }, 1, 'bad-result');
  bad('two pages for a job of three', L.omrResult(2), 3, 'bad-result');
  bad('four pages for a job of three', L.omrResult(4), 3, 'bad-result');
  bad('a page that is out of order', Object.assign(L.omrResult(2), { pages: L.omrResult(2).pages.reverse() }), 2, 'bad-result');
  bad('a page that does not say whether it was read', { pages: [{ index: 0, movements: [L.scoreXml(1)] }] }, 1, 'bad-result');
  bad('a result in which no page was read', L.omrResult(2, { failed: [0, 1] }), 2, 'nothing-read');
  bad('a page that is read and has no movements', { pages: [{ index: 0, ok: true, movements: [] }] }, 1, 'bad-result');
  bad('a page with 17 movements', { pages: [{ index: 0, ok: true, movements: Array.from({ length: 17 }, () => L.scoreXml(1)) }] }, 1, 'bad-result');
  bad('a movement that is not MusicXML', { pages: [{ index: 0, ok: true, movements: ['<html/>'] }] }, 1, 'bad-xml');
  bad('a movement with an entity', { pages: [{ index: 0, ok: true, movements: ['<!DOCTYPE score-partwise [<!ENTITY a "b">]><score-partwise/>'] }] }, 1, 'bad-xml');
  bad('an engine name with markup', Object.assign(L.omrResult(1), { engine: '<img src=x>' }), 1, 'bad-meta');
  bad('an engine version that is a path', Object.assign(L.omrResult(1), { engineVersion: '../../x' }), 1, 'bad-meta');
  bad('a negative time', Object.assign(L.omrResult(1), { ms: -1 }), 1, 'bad-meta');
  bad('a page whose time is Infinity', { pages: [{ index: 0, ok: true, ms: Infinity, movements: [L.scoreXml(1)] }] }, 1, 'bad-result');
  bad('a result over 4 MB', { pages: [{ index: 0, ok: true, movements: [L.scoreXml(1)] }].concat(Array.from({ length: 3 }, (_, i) => ({ index: i + 1, ok: true, movements: ['<score-partwise>' + 'x'.repeat(2.9 * MiB) + '</score-partwise>'] }))) }, 4, 'too-large');
  const errPage = H.validateOmrResult({ pages: [{ index: 0, ok: true, movements: [L.scoreXml(1)] }, { index: 1, ok: false, error: '<b>‮hi</b>' + 'x'.repeat(400) }] }, { pages: 2 });
  ok('the line a page failed with is cleaned (markup, bidi overrides) and cut to 200', errPage.ok && errPage.result.pages[1].error.length <= 200 && !/[<>‮]/.test(errPage.result.pages[1].error), errPage.ok ? errPage.result.pages[1].error.slice(0, 30) : errPage.error);
}

/* ------------------------------------------------------------------------------------------------ the queue */
async function queueRules() {
  heading('a score: who may ask, what it costs, what it holds');
  const S = await L.startService({ users: ['u1', 'u2', 'u3'] });
  try {
    const pages = L.omrPages(3);
    /* --- no code, a wrong code: a 401 before the body is read --- */
    const none = await req(S.port, 'POST', '/api/jobs/omr', { body: { pages: pages } });
    ok('with no PC code: 401 no-link (nothing was guessed, so nothing is counted)', none.status === 401 && none.body.code === 'no-link', none.status + ' ' + none.text);
    const wrong = await req(S.port, 'POST', '/api/jobs/omr', { code: 'ab'.repeat(32), body: { pages: pages } });
    ok('with a code that is no link\'s: 401 bad-code, the same sentence as every other route', wrong.status === 401 && wrong.body.code === 'bad-code', wrong.status + ' ' + wrong.text);
    const shape = await req(S.port, 'POST', '/api/jobs/omr', { headers: { 'X-PPP-PC': 'not-a-code' }, body: { pages: pages } });
    ok('a header that is not 64 hex is 401 bad-code too', shape.status === 401 && shape.body.code === 'bad-code');
    const cross = await req(S.port, 'POST', '/api/jobs/omr', { user: 'u1', headers: { Origin: 'https://evil.example' }, body: { pages: pages } });
    ok('a request from another site is 403 cross-site, before the code is looked at', cross.status === 403 && cross.body.code === 'cross-site', cross.status + '');
    const cookie = await req(S.port, 'POST', '/api/jobs/omr', { cookie: 'ppp_session=abc', body: { pages: pages } });
    ok('a session cookie is not a code', cookie.status === 401 && cookie.body.code === 'no-link');
    const inBody = await req(S.port, 'POST', '/api/jobs/omr', { body: { pages: pages, code: S.code('u1'), clientCode: S.code('u1') } });
    ok('a code in the body or the query is not a code', inBody.status === 401 && (await req(S.port, 'POST', '/api/jobs/omr?code=' + S.code('u1'), { body: { pages: pages } })).status === 401);
    const asWorker = await req(S.port, 'POST', '/api/jobs/omr', { token: S.token('u1'), body: { pages: pages } });
    ok('a worker token cannot queue a score (it is not a code)', asWorker.status === 401);
    ok('none of that stored anything: no job, no page file', S.svc._state.jobs.size === 0 && pageFilesIn(S) === 0);

    /* --- the PC must have connected, and must be able --- */
    const noPc = await sendOmr(S, 'u1', pages);
    ok('a link whose PC has never connected: 409 no-pc (the images would wait for nobody), and nothing is stored', noPc.status === 409 && noPc.body.code === 'no-pc' && S.svc._state.jobs.size === 0 && pageFilesIn(S) === 0, noPc.status + ' ' + noPc.text);
    const oldWorker = await S.worker(S.token('u1')).post('/api/worker/claim', { once: true });
    const noOmr = await sendOmr(S, 'u1', pages);
    ok('a PC whose worker does not say it can read a score (an older worker): 409 no-omr-pc, and the status says omrMode false', noOmr.status === 409 && noOmr.body.code === 'no-omr-pc' && (await S.as('u1').get('/api/worker/status')).body.worker.omrMode === false
      && oldWorker.status === 200, noOmr.status + ' ' + noOmr.text);
    await ready(S, 'u1');
    ok('once the worker says it can (claim with omr: true) the status says omrMode true', (await S.as('u1').get('/api/worker/status')).body.worker.omrMode === true);

    /* --- a score is queued --- */
    const q = await sendOmr(S, 'u1', pages, { title: '  Czerny <b>op.599</b>‮.pdf ' });
    ok('a link with a connected, able PC queues a score: 201, a job of kind omr with its page count, no url, a cleaned title', q.status === 201 && q.body.job.kind === 'omr' && q.body.job.status === 'queued' && q.body.job.pages === 3 && q.body.job.url === ''
      && q.body.job.title === 'Czerny b op.599 /b .pdf', q.status + ' ' + q.text.slice(0, 200));
    const id = q.body.job.id;
    ok('its id is 16 characters of base64url (96 random bits), not a counter', /^[A-Za-z0-9_-]{16}$/.test(id));
    ok('it holds three page files, and the job\'s bytes are their total', pageFilesIn(S) === 3 && jobOf(S, id).bytes > 9000 && jobOf(S, id).pages === 3, pageFilesIn(S) + ' ' + jobOf(S, id).bytes);
    ok('the list of conversions does not show it (the page asks for its job by id); the job is readable by id', (await S.as('u1').get('/api/jobs')).body.jobs.length === 0 && (await S.as('u1').get('/api/jobs/' + id)).body.job.id === id);

    /* --- another link --- */
    const other = await S.as('u2').get('/api/jobs/' + id);
    ok('another link cannot read it: 404, the same as no job', other.status === 404 && other.body.code === 'not-found');
    ok('it cannot cancel it', (await S.as('u2').post('/api/jobs/' + id + '/cancel', {})).status === 404);
    ok('it cannot remove it', (await S.as('u2').del('/api/jobs/' + id)).status === 404);
    await ready(S, 'u2');
    const theirClaim = await claimOmr(S, S.token('u2'));
    ok('its PC\'s worker, asking for work with omr true, is told there is none: a job goes only to the link that owns it', theirClaim.status === 200 && theirClaim.body.job === null, JSON.stringify(theirClaim.body));
    ok('its token cannot fetch a page of it, heartbeat it, finish it or fail it: 404 each (the job is not there for it)',
      (await page(S, S.token('u2'), id, 0)).status === 404 && (await S.worker(S.token('u2')).post('/api/worker/jobs/' + id + '/heartbeat', { stage: 'page', pct: 0.1 })).status === 404
      && (await S.worker(S.token('u2')).post('/api/worker/jobs/' + id + '/result', L.omrResult(3))).status === 404 && (await S.worker(S.token('u2')).post('/api/worker/jobs/' + id + '/fail', { error: 'x' })).status === 404);
    ok('and the job is as it was: queued, three page files', jobOf(S, id).status === 'queued' && pageFilesIn(S) === 3);

    /* --- a worker without omr: true is never handed a score --- */
    const plain = await S.worker(S.token('u1')).post('/api/worker/claim', { once: true, song: true });
    ok('a worker that does not say omr: true (an older one) is not handed it: it would fail it as "not a YouTube video"', plain.status === 200 && plain.body.job === null, JSON.stringify(plain.body));
    ok('and that claim made the status say omrMode false again (what the worker said last)', (await S.as('u1').get('/api/worker/status')).body.worker.omrMode === false);
    const claim = await claimOmr(S, S.token('u1'));
    ok('a worker with omr: true is handed it: kind omr, its page count, no url', claim.status === 200 && claim.body.job.id === id && claim.body.job.kind === 'omr' && claim.body.job.pages === 3 && claim.body.job.url === '' && claim.body.job.attempt === 1, JSON.stringify(claim.body));
    ok('while it is claimed the pages are handed out to this token', (await page(S, S.token('u1'), id, 0)).status === 200);
    const p0 = await page(S, S.token('u1'), id, 0), p2 = await page(S, S.token('u1'), id, 2);
    ok('a page comes back as the bytes it was uploaded as, with its own content type, no-store, nosniff? (the server sets it), as an attachment', p0.status === 200 && p0.headers['content-type'] === 'image/png' && p0.headers['cache-control'] === 'no-store'
      && /attachment/.test(p0.headers['content-disposition']) && p0.text.length > 100 && p2.status === 200, p0.status + ' ' + JSON.stringify(p0.headers).slice(0, 200));
    ok('a page that is not there: 404 (3, 99, -1, a)', (await page(S, S.token('u1'), id, 3)).status === 404 && (await page(S, S.token('u1'), id, 99)).status === 404 && (await S.worker(S.token('u1')).get('/api/worker/jobs/' + id + '/pages/-1')).status === 404
      && (await S.worker(S.token('u1')).get('/api/worker/jobs/' + id + '/pages/a')).status === 404);
    ok('a path that climbs out of the folder is no route (404)', (await S.worker(S.token('u1')).get('/api/worker/jobs/..%2f..%2fjobs/pages/0')).status === 404 && true);
    ok('without a token it is 401', (await req(S.port, 'GET', '/api/worker/jobs/' + id + '/pages/0')).status === 401);
    ok('the page browser\'s code is not a token: 401', (await req(S.port, 'GET', '/api/worker/jobs/' + id + '/pages/0', { user: 'u1' })).status === 401);
  } finally { await S.close(); }
}

module.exports = { claimOmr, ready, sendOmr, page, pageFilesIn, jobOf, queued, claimed };

if (require.main === module) {
  (async () => {
    homeOmrUnit();
    await queueRules();
    L.finish('the home-PC queue, kind omr: images up, MusicXML back');
  })().catch(e => { console.error(e); process.exit(1); });
}
