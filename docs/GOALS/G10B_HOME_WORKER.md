# G10b-1 — the home-PC transcription worker

| | |
| --- | --- |
| Status | **Built and tested; not deployed.** PR "G10b-1: home-PC transcription worker (queue, worker, page)" from `g10b-1-home-worker` (from `main` `26417f4`). The Lead deploys and migrates after an independent review. |
| Roadmap line | **G10b-1 (user decision 2026-10-06): scores written from the helper ensemble's notes (TransKun + Kong) passed the teacher 7 of 7 against 4 of 7 for the in-browser model's notes, so the site gets a pull-based "home PC worker": the page queues a YouTube link, a script on the user's own GPU PC polls the site with a token, converts it with `transcribe.py` and posts the accepted notes back, and the page writes the score from them in the browser (v2 or classic). $0: Render free + Neon free, one instance, idle polls answered from memory, the PC asked to wait an hour when idle (26% of the Render hours with the worker on 24/7); two new tables, additive. The independent security review found no blocker; its fixes are in (section 11b). Real end-to-end on the teacher's link: 2,374 accepted notes (the analyst's number), 89 bars at 162 BPM in 4/4, 105 rests, 80 octave lines, 95 s on an RTX 5070 Ti.** |
| Writer | implementer on Sonnet (not an AI-modeling phase) |
| Rollback | revert the PR. The migration is additive (`CREATE TABLE IF NOT EXISTS` of two tables nothing else reads); `DROP TABLE ppp_worker_tokens, ppp_transcribe_jobs;` removes the data. A worker that keeps polling after a revert gets 404 and waits. |

## 1. Why, and what the user decided

The blind teacher review (2026-10-06): scores written from the **helper ensemble's** notes passed **7 of 7**, scores from the **in-browser model's** notes **4 of 7** (the browser model misses about 30% of the notes the helper hears; G10 doc section 30). The helper runs `transcribe.py` (TransKun + Kong, on a GPU) and cannot run on the free server. The user wants it on the site, runs it on their own PC, and said slow is fine. Cost stays $0, so nothing may run 24/7 against Render (free web service) or Neon (free Postgres).

## 2. Architecture (pull: no inbound connection to the PC)

```
 page (signed in)                      ppp-web (Render free, ONE instance)            the user's PC
 ---------------                       --------------------------------------        ----------------------
 "High-quality (my PC)"  POST /api/jobs ->  in-memory queue  --(durable copy)--> Postgres (Neon free)
 "My conversions" list   GET  /api/jobs <-  (home-jobs.js)                         
                                         <- POST /api/worker/claim  <-------------- worker.js polls (token)
                                            nextPollSeconds: 15 s busy / 3600 s idle
                                         <- GET  /api/youtube-audio ---------------  the same call the page makes
                                         <- POST .../heartbeat   (progress, cancel)  ffmpeg -> transcribe.py (GPU)
                                         <- POST .../result      (accepted notes)    helper-heard.js conversion
 "Open" -> GET /api/jobs/:id (notes)
        -> Import.fromRecording(what.heard) -> finishHeard -> v2 or classic -> review screen (as for the browser model)
```

- **Page** (`Piano Coach App.dc.html`, small local hunks): a second button beside "Make sheet music" for a signed-in account whose PC has connected; a "My conversions" list; "Open"; Settings > "Connect my PC" (make / list / remove tokens). 4 languages.
- **Server** (`home-jobs.js`, `home-jobs-store.js`, `home-result.js`, 24 lines in `server.js`): the routes, the in-memory queue, the durable copy.
- **Worker** (`tools/home-worker/worker.js` + README, config example, `.cmd` and `.ps1` helpers).

## 3. The free-tier design, with numbers

### 3.1 Render: 750 free instance hours a month, shared with the duckscope services; every request wakes ppp-web for 15 minutes

A worker that polled every minute would keep ppp-web awake all month (730 h of a 750 h quota that other services share). So **the server tells the worker how long to wait**, in every claim answer (`nextPollSeconds`):

| State of the account | `nextPollSeconds` |
| --- | --- |
| a job queued or claimed, or one finished (done/failed) in the last 5 minutes | **15 s** (`PPP_WORKER_ACTIVE_POLL_S`) |
| otherwise | **3600 s = 1 hour** (`PPP_WORKER_IDLE_POLL_S`, 900..86400: a smaller value is raised to 900 and the server logs a warning, and a value under 1800 logs how much of the month it keeps ppp-web awake) |

The worker can lengthen the idle wait (`idlePollSeconds`), never shorten it; `--once` polls once, does everything waiting and exits (a desktop shortcut, `run-once.cmd`); a long-poll (25 s) is used only while something is in sight, so an idle poll returns at once.

**What the idle interval costs** (month = 730 h; a poll keeps the instance up about 15.8 min: 15 min of idle timeout plus about 45 s of cold start; when the interval is shorter than that the instance never sleeps):

| idle interval | Render hours/month (share of 750) | cold boots/month | Neon active h (0.25 CU) | CU-h |
| --- | --- | --- | --- | --- |
| <= 15 min | 730 (97%) - never | 0 | ~0 | ~0 |
| 20 min (the first ask; no longer the default) | 577 (77%) | 2,190 | 201 | 50 |
| 30 min | 384 (51%) | 1,460 | 134 | 34 |
| **60 min (the default)** | **192 (26%)** | 730 | 67 | 17 |
| 3 h | 64 (9%) | 243 | 22 | 5.6 |
| 6 h | 32 (4%) | 122 | 11 | 2.8 |
| `--once` by hand (a conversion ~ 25-30 min of instance time: the enqueue, the claim, the 5-minute tail) | 0.5 h per conversion | per conversion | ~0.1 | ~0.02 |

The Neon columns assume each cold boot keeps the database active about 5.5 minutes (the 5-minute autosuspend plus the boot's own statements) at the smallest size, 0.25 CU. The free allowance is published as roughly 100 CU-hours a month (400 active hours at 0.25 CU); **I could not check the Neon console from here, so confirm the allowance and the size of the `ppp` project before relying on the Neon figures.** The Render figures are plain arithmetic on the numbers given for the free plan (750 shared hours, 15 minutes idle).

**Conclusion:** the first ask was a 20-minute idle wait; with the PC on 24/7 that uses about **77% of the 750 Render hours by itself**, leaving the duckscope services 23%. After the security review the **default is an hour (26%)**: the server dictates it (`configFrom`, `PPP_WORKER_IDLE_POLL_S`), the worker can only lengthen it, and the page says "about once an hour" from the value the site reports. The floor is 900 s, which is NOT a protection by itself (a poll keeps the instance up 15.8 minutes, so 900 s keeps it up all month): it only refuses nonsense, and anything under 1800 s is logged with its percentage. The recommended mode for a person who converts a few songs a week is the desktop shortcut (`--once`): 0 idle cost. Raising the wait further (`10800` = 9%) needs no code change.

The page's own polling also keeps the instance awake while its tab is open and something is waiting (every 20 s while converting, every 90 s while waiting, only while the tab is visible, and never when nothing is pending): a 20-minute wait with the tab open costs about 35 minutes of instance time; close the tab and it costs nothing.

### 3.2 Neon: compute hours, autosuspend after 5 minutes idle

- **A poll that finds nothing runs no SQL.** The queue lives in memory; the database is written only on enqueue, claim, finish, fail, cancel, purge and token create/revoke, and read **once after a boot** (`loadAll`: both tables in one round trip) by the first request that needs the queue. Counted, not argued: `tests/home-worker/jobs.test.js` (counting store: **60 idle polls = 0 store calls**, also status polls, pings, token lists), `jobs-pg.test.js` (counting `pg` query function against the real schema: **100 idle polls + 30 pings + 60 status reads = 0 statements**; and with `log_statement=all` the database's own log shows **0 statements on the feature's tables over 30 polls of a live server**).
- **A cold first poll costs 2 statements** (the read, and one UPDATE of the token's last-seen, so the page can tell "your PC is connected" after a restart). They happen inside a Neon wake that the boot has already caused: `store.ready()` runs `CREATE TABLE IF NOT EXISTS ...`, the seed library and the guest-link sweep at **every** ppp-web start, so every Render cold start already wakes Neon whatever this feature does. The table above therefore counts Neon wakes as "cold boots": they are caused by Render's spin-down meeting the poll interval, not by this feature's SQL.
- Rows older than their keeping time are purged by one DELETE, run only when memory says there is something to delete (at the boot read and when a job is queued).
- The account lookup of a browser request (`/api/auth/me` and friends read the user row on every call) is cached 10 minutes **inside the queue routes** only, so the page's status polls do not touch Neon either.

### 3.3 Postgres storage

A result is the accepted notes only: **2,374 notes = 106 KB of JSON (36 KB in the row, TOASTed)** (measured on the teacher's piece, 139 s of music); 20,000 notes (the cap) = 909 KB; hard cap **2 MB** per result. Kept: finished jobs 3 days, failed/cancelled/expired 1 day, at most 30 rows and 5 waiting jobs per account, 5 tokens per account. Accounts are free to make, so on top of the per-account caps there is one cap on everything kept: **64 MB of notes in total** (`TOTAL_RESULT_BYTES`): past it, new jobs and new results are refused with "busy" until the keeping time frees room. Typical use (5 conversions a week) holds well under 1 MB.

## 4. Data model (additive migration at boot, `home-jobs-store.js` `SCHEMA_SQL`)

`ppp_transcribe_jobs`: `id, owner_id (-> ppp_users, ON DELETE CASCADE), kind 'youtube', url, title, status queued|claimed|done|failed|cancelled|expired (CHECK), attempts, worker_id, created_at, claimed_at, finished_at, error (short), result JSONB, bytes`.
`ppp_worker_tokens`: `id, owner_id (-> ppp_users, CASCADE), token_hash, label, created_at, last_seen_at, poll_s, revoked_at`. (`poll_s` is the wait the worker announced, for "is the PC alive": last seen within twice that.)

Only `CREATE TABLE/INDEX IF NOT EXISTS`; the test asserts the SQL has no DROP, ALTER, DELETE, TRUNCATE or UPDATE, runs it twice on production-shaped tables with rows (no row of theirs changes), boots the server on it twice, and checks a hostile title (`x'); DROP TABLE ...`) is stored as text. A deleted account deletes its jobs and tokens.

## 5. Routes

Browser (the account's session cookie; **signed in only**, a guest key is not an account; a POST/DELETE with an `Origin` that is not this site is 403):

| | |
| --- | --- |
| `POST /api/jobs {url, title?}` | the URL must be one YouTube video (`parseYoutubeWatch`, the same rule as `/api/youtube-audio`; the canonical `watch?v=` URL is stored); 5 waiting at most, 30 enqueues/hour/account, the same link while it waits is the same job |
| `GET /api/jobs` | own jobs (no notes) and the worker summary `{hasToken, everSeen, alive, lastSeenAt, idlePollSeconds}` |
| `GET /api/jobs/:id` | the job, and the notes when done (somebody else's job is 404) |
| `POST /api/jobs/:id/cancel` | queued/claimed -> cancelled (a claimed one: the worker hears it in its next heartbeat) |
| `GET /api/worker/status` | `{worker: {...}}` |
| `GET/POST /api/worker/tokens`, `DELETE /api/worker/tokens/:id` | list (never the secret), make (shown ONCE, 5 per account, 10/hour), revoke (dead at once) |

Worker (`Authorization: Bearer ppw_<id>_<secret>`; a token reaches only its own account's jobs):

| | |
| --- | --- |
| `GET /api/worker/ping` | token check, marks the PC seen |
| `POST /api/worker/claim {once?, waitSeconds?}` | `{job: {id, url, title, attempt, maxAttempts} \| null, nextPollSeconds}`; long-poll up to 25 s only while something is in sight; `once` never waits |
| `POST /api/worker/jobs/:id/heartbeat {stage, pct}` | extends the lease, shows progress, answers `cancelled: true` |
| `POST /api/worker/jobs/:id/result` | the notes, validated (section 6) |
| `POST /api/worker/jobs/:id/fail {error, retry?}` | one short line; `retry` puts it back (held 2 min x attempts) while attempts < 3 |

A claimed job nobody has heard of for **30 minutes** returns to the queue (attempts <= 3, then failed); a queued job nobody claimed in 3 days expires. A late result for a job that went back to the queue is still taken (first result wins).

## 6. Security model

| Threat | Measure | Tested by |
| --- | --- | --- |
| a guest or another account uses the queue | cookie session -> an account row; ownership checked in memory **and** in every SQL WHERE (`owner_id = $n` plus the expected state) | `jobs.test.js` "ownership", `jobs-pg.test.js` "the same guards", mutants A1-A3, C1-C3 |
| a stolen database dump | only `sha256(token)` is stored; the token (32 random bytes) is shown once and never logged; the worker redacts it from every line | "stored as a hash" (the file store is searched for the secret), `worker.test.js`, mutants A14, W1 |
| token guessing, timing | the id picks the record, the hash is compared with `timingSafeEqual` (a dummy hash for unknown ids); 20 wrong tokens an hour per address, then 429 | mutants A4, A9 |
| cross-site requests | `SameSite=Lax` cookie plus a same-origin check on every state-changing browser route; worker routes ignore cookies; CORS closed (no `Access-Control-*`, preflight fails) | "who may ask", mutants A8, A17 |
| a hostile worker (the person's own token, or a stolen one) posts junk | result schema: notes `{on, off, midi 21..108, vel}`, finite and ordered, 4..20,000 notes, nothing past 15 minutes, 2 MB, everything else (pedals, beats, unknown keys) **stripped**; body limits on every route (4 KB, results 3 MB); NUL/lone surrogates/nesting refused | `home-result.js` unit tests, mutants A7, A21, B1-B7 |
| filling the free database with accounts | per-account caps, rate limits, one cap on all stored notes | cap test |
| SQL injection | every statement parameterized (`$n`); `ANY($1::text[])` for lists | hostile-title test |
| internals in errors | generic messages; a store failure is 503 "try again" plus one logged line; no stack, path or SQL in an answer | "a store that fails" |
| a worker that never stops asking | the server's wait, 600 claims/hour/token, the worker stops on 401 | `worker.test.js` |
| two instances | not supported (section 9); the SQL guards keep data right, the long-poll and "alive" would not be | stated |

The worker runs the user's own `transcribe.py` on audio the site downloaded from a link the user chose; the audio is read only by ffmpeg and the models, the scratch folder is removed in every case, and the worker needs no inbound port.

## 7. The worker (`tools/home-worker/`)

`worker.js` (Node, no dependencies beyond the repo): settings file (site, token, Python of the venv, `transcribe.py`, Kong checkpoint, scratch folder, optional `idlePollSeconds`/`activePollSeconds`/`ytdlpPath`/`audioBase`) or `PPP_WORKER_TOKEN`; `--once`, `--check` (site, token, ffmpeg, torch/transkun, checkpoint: what to fix), a loop. Per job: heartbeat every 60 s (progress, cancel), the site's `/api/youtube-audio` (3 tries; or yt-dlp on the PC when named), ffmpeg as `omr-service.js` does (44.1 kHz stereo master cut at 900 s, 16 kHz mono for Kong), `transcribe.py --wav --kong-wav --out --engine auto --checkpoint`, `convertHelperNotes` of `review/h10/helper-heard.js` (**accepted notes only, no pedal, no Beat This beats**: the helper's beats made v2 write bars 2-4x too short as wired), the same bounds as the server, the POST (retried on 5xx/429/network), clean-up. Failures end in one short line on the site (retry or not); a cancel on the site kills the models (the process tree, by the PID the worker started); a rejected token stops the loop (exit 2); a network that is down never ends it (backoff 30 s..15 min). `transcribe.py`, `midi_notes.py` and `review/h10/helper-heard.js` are on `main`; the weights and the venv are not (and are not copied): the settings name them.

Windows helpers, **not installed by anything**: `run-once.cmd`, `run-forever.cmd`, `create-desktop-shortcut.ps1` (one desktop shortcut, run by hand), `schedule-task-example.ps1` (a scheduled task, read first, run by hand). README in Korean with an English summary.

## 8. The page

- **Button**: shown to a signed-in account whose PC **has connected at least once** (`everSeen`), and not for the "Full song" recording type (the helper makes faithful transcriptions). It stays when the PC is not currently connected; the note then adds "Your PC has not checked in lately, so the conversion will wait until it does." (A strict reading of "connected = alive right now" would hide the button exactly when it is most useful: a person queues a conversion, then switches the PC on.) The note says how often the PC checks from the site's setting ("about once an hour", "about every 30 minutes", "about every 3 hours"), that the PC must be on, that a song takes a few minutes once it starts, and to run the desktop shortcut to start now.
- **List**: waiting / converting (with the percentage while the models run) / ready (Open) / failed (the PC's reason) / cancelled / expired, Cancel for the first two. The server is the truth: it survives a reload and a second device. A toast says when one finishes while the person is elsewhere.
- **Open** feeds the SAME path as the browser model: `Import.loadYoutube(.., pre)` -> `fromRecording` (after the catalog lookup, as ever) -> `finishHeard`. The heard object is `{notes, duration, engine: 'ensemble', qualityTier: 'local-piano-ensemble', homePc: true, ensemble: {models, primary, agreement, accepted, uncertain}, device}` with no pedals and no beats. So v2 or the classic conversion (whichever is selected), the flags, "Write the notation again", Undo, "Play as recorded", Accept and saving all work as for a browser import (checked). The recording is asked for with the browser path's own request (best effort, up to 150 s); without it the review says "the recording could not be kept for playback, so this check is by eye only".
- **Review wording** (checked against what the screen does with the tier): `qualityTier` is read only for `'browser-fallback'` (the "less precise fallback" warning, confidence capped at 0.62); `'local-piano-ensemble'` is the tier name that warning refers to as `fallbackFrom`, so it gets none of that. It shows "Model agreement N%" (from `ensemble.agreement`, as for the local helper), the line "N possible notes were rejected because the piano models did not agree" when the models disagreed on many notes, and the Engine row says **"Piano ensemble on your PC"**.
- **Settings > Connect my PC**: make a token (shown once, with a Copy button and the 3-line instructions), the list of tokens with "Last seen", Remove.
- **Untouched for everyone else**: no request about jobs from a guest; the Add-sheet-music card of a guest is identical, tag for tag, to the card of `26417f4` (test); the classic and browser-model paths have no new code in them (`loadYoutube` and `fromRecording` take an optional argument that nothing else passes).

## 9. Limits (said plainly)

The PC must be on and the worker running; latency is up to the poll interval (an hour by default) unless the person opens the shortcut; only the owner's own PC and jobs; **YouTube links only** (uploaded audio files are out of scope); the helper's beats and pedal are not used; at most 15 minutes of a recording (as in the app); results are kept 3 days (a conversion is a request, not an archive: the page keeps the score in My Songs once opened); **one server instance** (the queue is in memory; Render's free plan runs one; scaling out would mean moving the queue into the database); the first poll after a cold start waits for the boot (30-60 s); a conversion that fails 3 times is failed for good.

## 10. Operations

- **Deploy** (Lead): nothing to configure; the two tables are created at boot (`CREATE ... IF NOT EXISTS`, after `ppp_users`). Optional env: `PPP_WORKER_IDLE_POLL_S` (default 3600, floor 900 - section 3.1), `PPP_WORKER_ACTIVE_POLL_S` (15), `PPP_WORKER_TOTAL_RESULT_MB` (64). Verify beyond `/health`: `GET /api/jobs` without a session is 401 `{"error":"Sign in to use this."}`; `GET /api/worker/ping` without a token is 401; Settings shows "Connect my PC" for a signed-in account and not for a guest.
- **First use**: the user signs in, Settings > Make a token, copies `worker.config.example.json` to `worker.config.json`, `node tools/home-worker/worker.js --check`, `--once`; the button appears after the worker's first contact.
- **Watching the cost**: Render dashboard instance hours (compare with the table); Neon console compute hours. If either climbs, raise `PPP_WORKER_IDLE_POLL_S` or use `--once`.
- **Rollback**: revert the PR; optionally `DROP TABLE ppp_worker_tokens, ppp_transcribe_jobs;`.
- **A stuck job**: it returns to the queue after 30 minutes without a heartbeat; the owner can cancel it any time; a revoked token loses its claim at the lease end.

## 11. Verification

`npm run test:home-worker` (also in `npm test`; the `gate` job runs it in shard-e, where the Postgres and real-tools parts skip) and `npm run test:home-worker-page`:

| Test | What |
| --- | --- |
| `tests/home-worker/jobs.test.js` (191 checks) | result bounds (home-result.js); auth, origin, ownership, tokens (hash on disk), caps, rates, lease, attempts, retry delay, purge, `nextPollSeconds`, long-poll and hang-up, **idle polls run zero store calls**, a failing store (503, state restored), a restart keeps the queue, the stored-bytes cap |
| `tests/home-worker/server.test.js` (28) | `server.js` itself: real sign-up cookies, the routes behind them, a restart, `/tools` not served, nothing else changed |
| `tests/home-worker/worker.test.js` (87) | settings; waits; conversion = `helper-heard.js`; a whole job with the real worker and a stand-in `transcribe.py` run by Node (arguments, ffmpeg calls, scratch removed, token never in a log); every failure path; cancel kills the models; retries; token rejected; loop never dies of the network; `--check` |
| `tests/home-worker/jobs-pg.test.js` (47; needs a throwaway Postgres, skipped without `PPP_TEST_PG_URL`) | the migration on production-shaped tables, twice, FK/CHECK, the store's SQL guards (12 claims at once: one wins), JSONB round trip, cascade, hostile title, **zero statements for idle polls** (counting query function; and the database's log) |
| `tests/home-worker/worker-real.test.js` (5; skipped without the venv) | the REAL ffmpeg and venv (TransKun + Kong, GPU) on 8 s of synthetic piano-like audio: 14 of 16 notes heard, the job done, the scratch folder gone |
| `tests/home-worker/page.test.js` (75; puppeteer, not in the gate) | button visibility, the note, what it POSTs, the list and reload, claimed 40%, ready/Open, the review (heard object, v2 pipeline, "Piano ensemble on your PC", model agreement, no fallback issue), classic conversion, Write again/Undo, Accept, failed/cancel, a second account, token removal, ko/ja/zh, and the card of a guest identical to `26417f4` |
| `tests/home-worker/mutants.js` | one rule broken per mutant, the tests must fail: see below |

### Mutation checks

`node tests/home-worker/mutants.js` copies the modules, breaks ONE rule in the copy and runs the test that should notice: **64 of 64 mutants killed** (the unmutated copy passes first; the 41 of the first version plus 23 for the review round: N1-N15 and the reviewer's R7, R11, R12, R14, R17-R20). Two mutants survived the first run because the rule has a second guard behind it (a result for a done job is stopped by the state list, by the re-check after the body AND by the store's WHERE; a note past 15 minutes by the note check AND the duration check): the mutants now break every guard of the rule. The three Postgres mutants run only with `PPP_TEST_PG_URL`.

| Rule broken | Killed by |
| --- | --- |
| ownership: browser routes, worker routes, a claim that picks another account's job (A1-A3) | "cannot read, cancel or find it", "u2's token cannot post a result...", "another account's activity does not change this one's wait" |
| the token compare ignores the secret (A4); the token itself is stored (A14); revoke leaves the token alive (A19) | "the secret half of another token with this id is not enough", "the store holds the sha256 ... never the token", "revoking kills it at once" |
| **an idle poll hits the DB** (A5: last-seen written on every poll; A6: the queue re-read on every request) | "60 idle polls ... ran ZERO store calls" (`{"touchSeen":60}`) |
| result validation removed (A7); pitch, 15 minutes, count, size, stripping removed (B1-B7); body size (A21) | "a midi of 200 is 422", "a midi below 21 - accepted", "a note past 15 minutes - accepted", "more than 20000 notes - accepted", "pedals, beats ... are stripped", "a result of 3 MB is 413" |
| the cross-site check (A8), CORS opened (A17), wrong tokens unlimited (A9), enqueue unlimited (A22), the cap of 5 waiting (A10), duplicate links (A18) | "a cross-site POST is refused", "CORS is closed", "20 wrong tokens ..., then 429", "30 enqueues an hour", "5 waiting at most", "the same video asked for again ... is the same job" |
| the waits: always idle (A11), long-poll when idle (A12), no lease (A13), no retry delay (A15), no keeping time (A16), a PC alive for ever (A23) | "with a job claimed, a poll is told 15 s", "none of them waited", "31 minutes without a sign: back in the queue", "a job given back is not handed out again at once", "the limits are the ones the design states", "gone when it has not been heard of" |
| a result accepted for a finished or cancelled job (A20) | "a second result for a done job is 409 and changes nothing" |
| Postgres: a claim or finish ignoring owner or state, the notes readable by another account (C1-C3) | "another account cannot claim, finish, cancel or requeue it", "a finished job cannot be finished ... again", "only to their owner" |
| the review round (section 11b): the loop's waits (N1, N2), the idle floor and default (N3, N4), same-origin redirects (N5), a valid token never refused (N6), slots given back (N7), per-address enqueue (N8), per-account byte caps (N9, N10), scratch sweep (N11), 11-character ids (N12), ffmpeg protocols (N13), the log (N14), the migration lock (N15, killed by twelve real migrations at the same moment), sorted notes (R7), the account cache (R11), no timer (R12), heartbeat writes nothing (R14), hostile links (R17), audio size (R18), no token to the audio endpoint (R19), `--` before the yt-dlp link (R20) | each has its assertion in `jobs.test.js`, `worker.test.js`, `jobs-pg.test.js` |
| worker: the token in the log (W1), a rejected token not fatal (W2), notes past 15 minutes sent (W3), a cancel that does not stop the models (W4), the scratch left behind (W5), the token over plain http (W6), a setting that shortens the wait (W7), any link run (W8) | each has its assertion in `worker.test.js` |

### The real end-to-end run

Run on this PC (RTX 5070 Ti, the venv of `D:/PPP/tools/transcribe-venv`, ffmpeg) on **the teacher's link** `https://www.youtube.com/watch?v=vgnliVjJUOo` ("Looping the Rooms feat. Hatsune Miku - rusino (Piano)"). A local server of this tree (`NODE_ENV=production`, a free port) on a **throwaway local Postgres 17** (docker, `log_statement=all`); the page driven by puppeteer as a person drives it; the worker run as a real process. The local server has no yt-dlp, so the audio was fetched from the production `/api/youtube-audio` with a read-only GET, as `review/h10/collect.js` does (the page's own audio request on Open the same way); nothing else touched production.

| Step | Result |
| --- | --- |
| sign up through the page, Settings > Connect my PC > Make a token | token shown once |
| `node tools/home-worker/worker.js --check` | ffmpeg ok, Kong checkpoint ok, Python has torch, soundfile and transkun and runs on CUDA, the site accepts the token (idle wait 20 min at the time of this run; the default is now an hour): exit 0, 1.6 s |
| `--once` with nothing queued | "Nothing is waiting." Then the page shows the **High-quality (my PC)** button and the note ("about every 20 minutes" at the time of this run, now "about once an hour" ... must be switched on ... shortcut) |
| click the button | the job is listed "Waiting for your PC", its title fetched by the page |
| `--once` (real) | claimed 17:54:55; audio from production 5.4 MB, ready 17:56:00 (**65 s**: Render's wake and its download); 139 s of audio decoded; TransKun then Kong **17:56:01-17:56:33 = 32 s** (about 14 s per audio minute, model load included); **2,374 accepted notes (746 more kept apart)**, 112 KB posted; done. **Worker total 97.5 s**, exit 0. The page's list went "Converting on your PC" then "Ready to open" and showed the toast |
| Open | the review screen about 5 s after the recording arrived (the recording took another 48 s from production; the page waits for it, up to 150 s) |
| what the review holds (v2 selected) | heard notes **2,374 = the analyst's helper count for this piece**; **89 bars, 162 BPM, 4/4** (the analyst's table, row p1, helper: 89 bars, 162, 4/4); **105 rests** (the table: 105); 2,392 written notes (ties split); **80 octave lines** in the Score (**3 drawn** on the first review page, **91 `g.ppp-ottava`** on the practice screen, 2,392 note heads); pipeline v2, version 8; Engine "Piano ensemble on your PC"; Model agreement 100%; level fair, confidence 0.78; 15 measures flagged; issues "746 possible notes were rejected because the piano models did not agree" and "17 notes per second" (both true statements about the helper's output); **no "less precise fallback" issue** |
| page health | 0 page errors, 0 console errors, 15 `/api/jobs` requests, 1 audio request, **0 requests for the browser model** |

Re-run after the review fixes (an hour as the idle wait, `-protocol_whitelist file,pipe` on both ffmpeg calls, same-origin downloads, the new log cleaning), same link, same method: `--check` 1.7 s ("its idle wait is 1 h"), the page's note "about once an hour ... run the desktop shortcut"; the worker took **94.7 s** (65 s of audio download from production, models 17:58:54-17:59:24 = 30 s); **2,374 accepted notes (746 kept apart)** again, and the same review: 89 bars, 162 BPM, 4/4, 105 rests, 80 octave lines (3 drawn on the first review page, 91 on the practice screen, 2,392 heads), v2, "Piano ensemble on your PC", 0 page errors; the recording arrived in the page this time (36 s) so the review could be listened to. The real ffmpeg decoded the real downloaded m4a with the protocol whitelist.

### What could not be tested

- **Production**: nothing was deployed or contacted except the one read-only audio GET. Render's real spin-down and cold-start behaviour, Neon's autosuspend and both quotas are argued from the numbers given, not measured. The migration ran on a Postgres 17 container, not on Neon; the DDL is plain `CREATE TABLE/INDEX IF NOT EXISTS`.
- **A second instance** of the server (not supported).
- **A long-poll through Render's proxy** (25 s is well inside its limits, but it was not tried there).
- **The Windows shortcut and scheduled-task scripts**: written and read, not run (by instruction nothing is installed).
- **A recording longer than 15 minutes, or CPU-only transcription time** on the real helper (the 15-minute cut and the long timeouts are tested with stand-ins).
- `tests/transcription.test.js` fails one check in this worktree ("the fallback is the venv transkun console script"): it compares `transcribe.py`'s answer with the Python it is given, and this worktree has no `tools/transcribe-venv`. Nothing in this change touches it. Every other suite of the regression run passed (i18n-and-auth, import, library, share, guest-share, build-stamp, hymns-share, import-and-persistence, single-note-app, recording-v2-app, recording-v2-ottava).

## 11b. The independent security review of PR #178 and what changed (no blocker; "merge after fixes")

| Finding | Fix | Test that fails without it |
| --- | --- | --- |
| **M1** (worker): after a 404/405/502/503/429 the loop waited a fixed 30 or 60 s for ever (a site rolled back, a down site, a lockout) | one counter of consecutive failures for every answer that is not a 200: 30 s (60 s for an answer) doubling to the idle wait (at least 15 minutes, an hour by default); 404/405/410 ("the queue is gone") wait at least an hour, from the first answer; a 200 resets it | `worker.test.js` "the loop" (waits for 502, 503, network, 404/405/410, 429, the reset, the cap, 40 failures), mutants N1, N2 |
| default idle wait | 3600 s default in `configFrom`; floor 900 s with a logged warning (and a warning under 1800 s with the % of the month); the page says "about once an hour" | `jobs.test.js` (configFrom, warnings handed to the server), `server.test.js` (env 60 -> 900, none -> 3600, 7200), `page.test.js`, mutants N3, N4 |
| minor 1: redirects of the audio download | only same-origin redirects, at most 4; the whole hop is inside try/catch (a bad `Location` - ftp:, file:, `http://[` - fails that job cleanly instead of ending the process); the announced length is checked before the download; old `job-XXXXXX` scratch folders (older than 2 hours) are removed at start | `worker.test.js` "the audio download" (same-origin followed, a chain of 5, ftp, file, garbage, another origin never asked, no token on any request, size caps) and "scratch folders left by a crash", mutants N5, N11, R18, R19 |
| minor 2: a valid worker could be 429'd by other people's wrong tokens | the token is verified first; only failures are counted (past 20 an hour the answer to a failure is 429); a valid token is never refused for it | `jobs.test.js` "a VALID token from that same address still works", mutant N6 |
| minor 3: a refused body kept its hourly slot; the 200/hour enqueue bucket was global; stored notes and rows could starve the queue | slots are given back when the body, the link or the queue refuses the request; the enqueue limit is per account (30) and **per address (60)** (the global bucket is gone), token making per account (10) and per address (20); stored notes: **8 MB per account** ("quota") besides the 64 MB total ("busy"); rows 30 per account | `jobs.test.js` "a request that makes nothing is free", per address, "one account cannot use up the room" (two scenarios, the teacher unaffected), mutants N7-N10 |
| minor 4: video ids | exactly 11 characters of [A-Za-z0-9_-] in `parseYoutubeWatch` (so also for /api/youtube-audio and /api/youtube-title) and in the worker's link check; `-protocol_whitelist file,pipe` before every ffmpeg `-i` (the real run still works: see the end-to-end run) | `jobs.test.js` (ids), `server.test.js`, `worker.test.js` (20 hostile links never reach a tool; ffmpeg arguments), `worker-real.test.js`, mutants N12, N13, R17 |
| minor 6/7: the token in a project folder; text tricks | README: keep the settings file in your own user folder (`~/.ppp-home-worker/worker.config.json` is searched after the folder of `worker.js`) or use `PPP_WORKER_TOKEN`; `cleanText` also strips bidi marks and overrides and line/paragraph separators; the worker's log strips ESC sequences, control and bidi characters | `jobs.test.js` (cleanText), `worker.test.js` "what the log may show", mutants B4, N14 |
| minor 8: two instances booting together | the two CREATE TABLE statements run in one transaction under `pg_advisory_xact_lock(727002)` | `jobs-pg.test.js` (12 migrations at the same moment, twice), mutant N15 |
| minor 5: the page polled every 90 s for as long as a tab was open | back off 90 s -> 5 min -> 15 min while a job waits, 20 s while one is converted, stop after 30 minutes with a "Check again" control; a hidden tab keeps stopping; a status change or a user action starts a new watch | `page.test.js` "looking again" |
| gaps the reviewer's mutants found | notes stored sorted (R7), the account lookup remembered (R11), no timer in the new modules (R12, a static check), a heartbeat writes nothing (R14), hostile links (R17), audio size cap (R18), no token to the audio endpoint (R19), `--` before the yt-dlp link (R20) | `jobs.test.js`, `worker.test.js`, mutants R7, R11, R12, R14, R17-R20 |

**Reported, not changed:** `POST /api/auth/signup` has no rate limit (login has one: 40 per 15 minutes per address). Accounts are free to make, so the per-account caps alone do not bound what many accounts can store; what bounds it now is the per-address limits above, the per-account and total byte caps (`PPP_WORKER_TOTAL_RESULT_MB`), and the 3-day keeping time. A signup limiter (the same `tooMany(ip)` as login, three lines in the auth code) is the natural next step; it was left out of this change because it changes the behaviour of the whole site's sign-up.

## 12. Decisions the Lead may want to change

1. **Idle default**: an hour (26% of the Render hours with the PC on 24/7), set by `PPP_WORKER_IDLE_POLL_S`; the shortcut (`--once`) costs nothing while idle. The first ask was 20 minutes (77%).
2. The button shows once the PC has connected once (not only while alive): see section 8.
3. The page asks the site for the recording on Open (best effort, 150 s), as the browser path does, so the person can listen while checking; the site downloads that audio twice (once for the worker, once for the page). Skipping it would make Open instant and the review "by eye".
4. A job given back for a retry is held back 2 min x attempts (so a failing download is not tried three times in a minute).
5. `.gitignore`: `tools/` was ignored as a whole (vendored helpers); it is now `/tools/*` with `!/tools/home-worker/` (and the worker's settings file, which holds a token, ignored). A `tools/` folder deeper in the tree is ignored as before.
