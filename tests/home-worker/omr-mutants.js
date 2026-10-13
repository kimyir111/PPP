/* G12-5: the mutants of the home-PC queue's kind 'omr' (docs/GOALS/G12_OMR.md section 24). Each breaks ONE rule in a copy of the modules and names the test that must go red
   (tests/home-worker/mutants.js runs them with the rest: `node tests/home-worker/mutants.js O1 P7 ...`). Format: [id, file, what it breaks, [from, to] | [[from, to], ...], test].
   A rule with two guards (the pre-check before the body is read and the one in the atomic section) breaks BOTH, as the earlier mutants do. */
'use strict';
const PAGE = 'Piano Coach App.dc.html';
const J = 'home-jobs.js', O = 'home-omr.js', S = 'home-jobs-store.js', W = 'tools/home-worker/worker.js', E = 'omr/engine.js';
const T = 'omr-jobs.test.js', LIM = 'omr-limits.test.js', FLOW = 'omr-flow.test.js', WK = 'omr-worker.test.js', PG = 'omr-jobs-pg.test.js', PG_PAGE = 'omr-page.test.js';

module.exports = [
  /* ---- the queue (home-jobs.js) ---- */
  ['O1', J, 'a score is accepted although the kind is switched off (PPP_OMR_JOBS=0)', ["if (!C.omrJobs) throw httpError(503, 'Reading scores on your PC is switched off on this site.', 'omr-off');", "if (false) throw httpError(503, 'Reading scores on your PC is switched off on this site.', 'omr-off');"], FLOW],
  ['O2', J, 'a score is accepted for a PC that has never connected', ["if (!w.everSeen) throw httpError(409,", "if (false) throw httpError(409,"], T],
  ['O3', J, 'a score is accepted for a PC whose worker said it cannot read scores', ["if (w.omrMode === false) throw httpError(409,", "if (false) throw httpError(409,"], T],
  ['O4', J, 'a body that announces 40 MB is read (the announced size is not checked)', ["if (Number.isFinite(declared) && declared > L.OMR_BODY + 4 * 1048576) throw", "if (false) throw"], LIM],
  ['O5', J, 'scores asked for are not limited per link an hour', ["if (!limiters.omr.take(link.id)) throw", "if (false) throw"], LIM],
  ['O6', J, 'scores asked for are not limited per address an hour', ["if (!limiters.omrIp.take(ip)) {", "if (false) {"], LIM],
  ['O7', J, 'any number of uploads are read at the same moment', ["if (omrUploads >= L.OMR_UPLOADS_AT_ONCE) {", "if (false) {"], LIM],
  ['O8', J, 'any number of scores may wait for a link (both guards: before the body and in the atomic section)', [
    ["if (omrPendingOf(link.id) >= L.OMR_PENDING_PER_LINK || mine0.filter(pending).length >= PENDING_CAP) {", "if (false) {"],
    ["if (omrPendingOf(link.id) >= L.OMR_PENDING_PER_LINK || mine.filter(pending).length >= PENDING_CAP) {", "if (false) {"]], LIM],
  ['O9', J, 'the images a link holds are not bounded', ["if (omrImageBytes(j => j.ownerId === link.id) + checked.bytes > C.omrImageBytesPerLink) {", "if (false) {"], LIM],
  ['O10', J, 'the images the links of one address hold are not bounded', ["if (link.ipTag && omrImageBytes(addressOf(link.ipTag)) + checked.bytes > C.omrImageBytesPerAddress) {", "if (false) {"], LIM],
  ['O11', J, 'the images the site holds are not bounded (both guards)', [
    ["if (omrImageBytes(() => true) >= C.omrImageBytesTotal) throw", "if (false) throw"],
    ["if (omrImageBytes(() => true) + checked.bytes > C.omrImageBytesTotal) {", "if (false) {"]], LIM],
  ['O12', J, 'the same pages asked for twice while they wait are two jobs', ["const dup = mine.find(j => j.kind === 'omr' && pending(j) && j.url === fp);", "const dup = null;"], LIM],
  ['O13', J, 'a worker that does not say omr: true is handed a score', ["(canOmr || j.kind !== 'omr') && ", ""], FLOW],
  ['O14', J, 'any truthy omr in a claim is taken for omr: true', ["rec.omr = body.omr === true;", "rec.omr = !!body.omr;"], FLOW],
  ['O15', J, 'the pages and the result of a score go to a token that does not hold its claim (both guards)', [
    ["if (job.kind === 'omr' && job.workerId && job.workerId !== rec.id) throw httpError(409, 'That job was taken by another worker.', 'not-yours', { status: job.status });", ""],
    ["if (job.workerId !== rec.id) throw httpError(409, 'That job was taken by another worker.', 'not-yours', { status: job.status });", ""]], FLOW],
  ['O16', J, 'one page may be fetched any number of times in a claim', ["if (job.pageReads[idx] > L.OMR_PAGE_READS_PER_PAGE) throw", "if (false) throw"], FLOW],
  ['O17', J, 'a token may fetch any number of pages an hour', ["if (!limiters.pageReads.take(rec.id)) throw", "if (false) throw"], FLOW],
  ['O18', J, 'the result of every job is checked as notes (the kind of the job is ignored)', ["const v = omr ? H.validateOmrResult(body, { pages: job.pages }) : R.validateResult(body);", "const v = R.validateResult(body);"], FLOW],
  ['O19', J, 'the images are kept after the result', ["await dropPages(job);          /* G12-5: the images have done their work */", ""], FLOW],
  ['O20', J, 'the images are kept after a failure for good', ["await dropPages(job);          /* G12-5: a job that failed for good holds no images */", ""], FLOW],
  ['O21', J, 'the images are kept after a cancel', ["await dropPages(job);          /* G12-5: a score that is cancelled holds no images (the PC that is reading it hears \"cancelled\" at its next heartbeat) */", ""], FLOW],
  ['O22', J, 'a score nobody took waits three days, not one', ["(j.kind === 'omr' ? L.OMR_QUEUED_TTL_MS : L.QUEUED_TTL_MS)", "L.QUEUED_TTL_MS"], FLOW],
  ['O23', J, 'a finished score is kept three days, not one', ["(j.status === 'done' && j.finishedAt < (j.kind === 'omr' ? omrBefore : doneBefore))", "(j.status === 'done' && j.finishedAt < doneBefore)"], FLOW],
  ['O24', J, 'the list of conversions shows the scores', ["ownJobs(link.id).filter(j => j.kind !== 'omr').sort(", "ownJobs(link.id).sort("], T],
  ['O25', J, 'the digest a score is told apart by is shown as its url', ["url: omr ? '' : j.url,", "url: j.url,"], T],
  ['O26', J, 'images a delete failed on are not retried at the purge', ["if (pageGarbage.size) {", "if (false) {"], FLOW],
  ['O27', J, 'a finished job that still holds images is not found by the boot read', ["jobs.forEach(j => { if (j.kind === 'omr' && j.pages > 0 && !pending(j)) pageGarbage.add(j.id); });", ""], FLOW],
  ['O28', J, 'a heartbeat does not say which page the PC is on', ["if (job.kind === 'omr' && Number.isInteger(body.page) && body.page >= 0 && body.page <= job.pages) job.progress.page = body.page;", ""], FLOW],
  ['O29', J, 'a claim of a score says neither its page count nor hides its url', ["if (job.kind === 'omr') { given.url = ''; given.pages = job.pages; }", ""], T],
  ['O30', J, 'the title of a score is not cleaned', ["title = R.cleanText(body.title, H.LIMITS.TITLE_MAX);", "title = String(body.title || '');"], T],
  ['O31', J, 'a result body of a score may be any size', ["const body = await readJson(req, omr ? L.OMR_RESULT_BODY : L.RESULT_BODY, L.RESULT_DRAIN);", "const body = await readJson(req, 100 * 1024 * 1024, 200 * 1024 * 1024);"], FLOW],
  ['O32', J, 'a score is queued without asking for the link (the first link is used)', ["let link = await requireLink(req);\n    if (!C.omrJobs) throw", "let link = Array.from(links.values())[0];\n    if (!C.omrJobs) throw"], T],
  ['O33', J, 'a score nobody can read (no images) is left waiting for ever', ["} else if (j.kind === 'omr' && j.status === 'queued' && !j.writing && !(j.pages > 0)) {", "} else if (false) {"], FLOW],

  /* ---- what goes up and comes back (home-omr.js) ---- */
  ['P1', O, 'a PNG may have a bit depth or colour type that does not exist', ["if ([1, 2, 4, 8, 16].indexOf(depth) < 0 || [0, 2, 3, 4, 6].indexOf(colour) < 0 || buf[26] !== 0 || buf[27] !== 0 || buf[28] > 1) return null;", ""], T],
  ['P2', O, 'the number of pixels of a picture is not bounded (a side is)', ["|| info.width * info.height > LIMITS.PIXELS_MAX", ""], T],
  ['P3', O, 'the sides of a picture are not bounded (its pixels are)', ["|| info.width > LIMITS.SIDE_MAX || info.height > LIMITS.SIDE_MAX", ""], T],
  ['P4', O, 'a page may be any size', ["if (buf.length > LIMITS.PAGE_BYTES) return bad(at + ' is larger than '", "if (false) return bad(at + ' is larger than '"], T],
  ['P5', O, 'a job may be any size', ["if (bytes > LIMITS.JOB_BYTES) return bad(", "if (false) return bad("], T],
  ['P6', O, 'a DOCTYPE that is not the standard one is skipped, not refused', ["if (!m) return no('doctype', 'A document type declaration other than the standard MusicXML one is not accepted.');", "if (!m) { i = s.indexOf('>', i) + 1; continue; }"], T],
  ['P7', O, 'entity declarations and CDATA are accepted', ["if (text.indexOf('<!ENTITY') >= 0 || text.indexOf('<![CDATA[') >= 0) return no('entity');", ""], T],
  ['P8', O, 'nesting of any depth is accepted', ["if (stack.length > o.maxDepth) return no('too-deep'", "if (false) return no('too-deep'"], T],
  ['P9', O, 'any number of tags is accepted', ["if (++tags > o.maxTags) return no(", "if (false) return no("], T],
  ['P10', O, 'control characters and lone surrogates are accepted', ["if (BAD_CHARS.test(text)) return no('bad-chars');", ""], T],
  ['P11', O, 'a document whose root is not MusicXML is accepted', ["if (name !== 'score-partwise' && name !== 'score-timewise') return no('not-musicxml', 'The document is not MusicXML.');", ""], T],
  ['P12', O, 'a document of any size is accepted', ["if (text.length > o.maxChars) return no('too-large');", ""], T],
  ['P13', O, 'an entity that nothing defines is accepted', ["if (BAD_ENTITY.test(text)) return no('entity');", ""], T],
  ['P14', O, 'a result with another number of pages than the job has is accepted', ["if (want !== null && body.pages.length !== want) return bad(", "if (false) return bad("], T],
  ['P15', O, 'a result in which no page was read is accepted as done', ["if (!read) return bad('No page was read.', 'nothing-read');", ""], T],
  ['P16', O, 'whatever else a result carries is stored', ["const result = { v: 1, kind: 'omr', engine: engine, engineVersion: engineVersion, ms: ms, pages: pages };", "const result = Object.assign({}, body, { v: 1, kind: 'omr', engine: engine, engineVersion: engineVersion, ms: ms, pages: pages });"], T],
  ['P17', O, 'a result of any size is accepted', ["if (bytes > LIMITS.RESULT_MAX_BYTES) return bad(", "if (false) return bad("], T],
  ['P18', O, 'the line a page failed with is stored as it came', ["error: R.cleanText(p.error, LIMITS.ERROR_MAX) || 'This page could not be read.'", "error: String(p.error || 'This page could not be read.')"], T],
  ['P19', O, 'pages of a result may come out of order', ["if (p.index != null && p.index !== i) return bad(", "if (false) return bad("], T],
  ['P20', O, 'the standard DOCTYPE is kept in the result', ["return { ok: true, xml: cut ? s.slice(0, cut[0]) + s.slice(cut[1]) : s };", "return { ok: true, xml: s };"], T],

  /* ---- the worker ---- */
  ['V1', W, 'a claim says omr: true whether or not this PC can read a score', ["song: true, omr: omrAble() }", "song: true, omr: true }"], WK],
  ['V2', W, 'the pages the site hands over are not checked again', ["const info = Omr.checkImage(r.raw, i + 1);\n    if (!info.ok) throw new JobError('The site sent a page that is not a usable image: ' + info.error, false);", "const info = { ok: true, type: 'png' };"], WK],
  ['V3', W, 'the engine is not asked to run at a lower priority', ["lowPriority: true, onChild: c => { ctl.child = c; }", "lowPriority: false, onChild: c => { ctl.child = c; }"], WK],
  ['V4', W, 'the worker itself does not go to below-normal priority while it reads a score', ["const restorePriority = deps.noPriority ? () => {} : lowerPriority();", "const restorePriority = () => {};"], WK],
  ['V5', W, 'the engine is not given the step time-out', ["extraArgs: Engine ? Engine.STEP_TIMEOUT_ARGS.slice() : []", "extraArgs: []"], WK],
  ['V6', W, 'the page file is named from the title the site sent', ["const img = path.join(dir, 'page-' + (i + 1) + (got.type === 'png' ? '.png' : '.jpg'));", "const img = path.join(dir, String(job.title || 'x').replace(/[^A-Za-z0-9]/g, '') + (i + 1) + (got.type === 'png' ? '.png' : '.jpg'));"], WK],
  ['V7', W, 'the id of a job the site hands over is not checked before it is used in an address', ["const idOk = typeof job.id === 'string' && JOB_ID_RE.test(job.id);", "const idOk = typeof job.id === 'string';"], WK],
  ['V8', W, 'the page count of a job the site hands over is not checked', ["if (!idOk || !Number.isInteger(n) || n < 1 || n > Omr.LIMITS.PAGES_MAX_LARGE) {", "if (!idOk) {"], WK],
  ['V9', W, 'what the engine wrote is sent without the site\'s own rules being run here first', ["const v = Omr.validateOmrResult(body, { pages: n });\n      if (!v.ok) throw new JobError(", "const v = { ok: true, result: body, bytes: 1 };\n      if (!v.ok) throw new JobError("], WK],
  ['V10', W, 'a cancel on the site does not stop the engine\'s process', ["lowPriority: true, onChild: c => { ctl.child = c; }", "lowPriority: true, onChild: c => { }"], WK],
  ['V11', W, 'the scratch folder of a score is left behind', ["if (cfg.keepScratch !== true) {", "if (false) {"], WK],
  ['V12', W, 'a PC without Audiveris runs a score it is handed', ["if (!omrAble()) {\n      log.warn('A score is waiting but this PC cannot read scores", "if (false) {\n      log.warn('A score is waiting but this PC cannot read scores"], WK],
  ['V13', W, 'a token the site rejects is not fatal when a page is fetched', ["if (r.status === 401) throw Object.assign(new Error('token'), { fatalToken: true });\n    if (r.status === 404 || r.status === 409 || r.status === 410) throw new Cancelled(", "if (r.status === 404 || r.status === 409 || r.status === 410) throw new Cancelled("], WK],
  ['V14', E, 'a .mxl that inflates to any size is expanded into memory', ["zlib.inflateRawSync(raw, { maxOutputLength: 64 * 1024 * 1024 })", "zlib.inflateRawSync(raw)"], WK],

  /* ---- the store on Postgres ---- */
  ['Q1', S, 'Postgres: a page is read for any owner', ["AND j.owner_id = $3 AND j.status = 'claimed'\",\n        [id, idx | 0, ownerId]", "AND $3::text IS NOT NULL AND j.status = 'claimed'\",\n        [id, idx | 0, ownerId]"], PG],
  ['Q2', S, 'Postgres: a page of a job that is only waiting is read', ["AND j.owner_id = $3 AND j.status = 'claimed'\",", "AND j.owner_id = $3\","], PG],
  ['Q3', S, 'Postgres: the images of a job that is waiting or being read can be deleted', ["AND j.owner_id = $2 AND j.status NOT IN ('queued', 'claimed')\",\n        [id, ownerId]);", "AND j.owner_id = $2\",\n        [id, ownerId]);"], PG],
  ['Q4', S, 'Postgres: the images of another owner\'s job can be deleted', ["AND j.owner_id = $2 AND j.status NOT IN ('queued', 'claimed')\",\n        [id, ownerId]);", "AND $2::text IS NOT NULL AND j.status NOT IN ('queued', 'claimed')\",\n        [id, ownerId]);"], PG],
  ['Q5', S, 'Postgres: the foreign key of the images does not cascade', ["job_id TEXT NOT NULL REFERENCES ppp_transcribe_jobs (id) ON DELETE CASCADE,", "job_id TEXT NOT NULL REFERENCES ppp_transcribe_jobs (id),"], PG],
  ['Q6', S, 'Postgres: a finished score is purged on the conversions\' keeping time', ["(CASE WHEN kind = 'omr' THEN $3::timestamptz ELSE $1::timestamptz END)", "$1::timestamptz"], PG],
  ['Q7', S, 'Postgres: the boot read does not say how many images a job holds', [", (SELECT count(*)::int FROM ppp_omr_pages p WHERE p.job_id = j.id) AS pages FROM ppp_transcribe_jobs j;'", ", 0 AS pages FROM ppp_transcribe_jobs j;'"], PG],

  /* ---- the page ---- */
  ['G1', PAGE, 'the PC path runs under "legacy" (both of its gates)', [
    ["    if (OMR_MODE !== 'v2' || !PcLink.get()) return { ok: false, why: null };", "    if (!PcLink.get()) return { ok: false, why: null };"],
    ["if (!xml && !(health.ok && health.audiveris) && OMR_MODE === 'v2' && PcLink.get()) {", "if (!xml && !(health.ok && health.audiveris) && PcLink.get()) {"]], PG_PAGE],
  ['G2', PAGE, 'a score is queued for a PC that has never connected', ["if (!w || !w.hasToken || !w.everSeen) return { ok: false, why: tx('Your PC has not connected yet.') };", ""], PG_PAGE],
  ['G3', PAGE, 'a score is queued for a PC whose worker cannot read scores', ["if (w.omrMode === false) return { ok: false, why: tx('The PPP worker on your PC cannot read scores yet: update it.') };", ""], PG_PAGE],
  ['G15', PAGE, 'a score is queued although the site has the kind switched off', ["if (w.omrMode === 'off') return { ok: false, why: tx('Reading scores on your PC is switched off on this site.') };", ""], PG_PAGE],
  ['G4', PAGE, '"Use the draft instead" leaves the job on the site', ["if (ctl.pcDraft) { await cancelJob(); throw fail(tx('You chose the draft.')); }", "if (ctl.pcDraft) { throw fail(tx('You chose the draft.')); }"], PG_PAGE],
  ['G5', PAGE, 'Cancel leaves the job on the site', ["if (ctl.cancelled) { await cancelJob(); return null; }", "if (ctl.cancelled) { return null; }"], PG_PAGE],
  ['G6', PAGE, 'the score is kept on the site after the page has taken it', ["pcOmrApi('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => null);", ""], PG_PAGE],
  ['G7', PAGE, 'the draft does not say that the PC was asked first', ["if (pcTried) report.issues.unshift({ measure: null, kind: 'pc-omr-fallback'", "if (false) report.issues.unshift({ measure: null, kind: 'pc-omr-fallback'"], PG_PAGE],
  ['G8', PAGE, 'more than 12 pages are sent without asking for "large"', ["n > 12 ? { large: true } : {}", "{}"], PG_PAGE],
  ['G9', PAGE, 'a big photo is sent as it is (no re-encoding to fit)', ["if (p.dataUrl && bytesOf(p.dataUrl) <= maxBytes && edge <= PC_OMR.maxSide && w * h <= 20e6 && Math.min(w, h) >= 200) return p.dataUrl.split(',')[1];", "if (p.dataUrl) return p.dataUrl.split(',')[1];"], PG_PAGE],
  ['G10', PAGE, 'the longest side of a re-encoded page is not cut to 3500 px', ["let scale = Math.min(1, PC_OMR.maxSide / Math.max(iw, ih, 1));", "let scale = 1;"], PG_PAGE],
  ['G11', PAGE, 'the "your PC is not on" hint never appears', ["if (!hinted && (!alive || waited >= PC_OMR.hintAfterMs)) hinted = true;", ""], PG_PAGE],
  ['G12', PAGE, 'the page the PC is reading is not shown', ["if (onStage && key !== lastKey) onStage('pcread',", "if (false) onStage('pcread',"], PG_PAGE],
  ['G13', PAGE, 'the "Use the draft instead" button is never shown', ["showPcDraft: running && (S.pcOmr === 'wait' || S.pcOmr === 'read'),", "showPcDraft: false,"], PG_PAGE],
  ['G14', PAGE, 'the line a PC failed with is not shown', ["if (cur.status === 'failed') throw fail(tx('Your PC could not read this score: {{why}}', { why: String(cur.error || '').slice(0, 160) }));", "if (cur.status === 'failed') throw fail(tx('Your PC could not read this score.'));"], PG_PAGE]
];
