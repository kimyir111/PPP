# G13 — Productization: make PPP something people can rely on across devices

## 0. Status

Architect 2026-10-08 (on Opus), worktree `D:/PPP-g13d`, branch `g13-design` from `origin/main` `3567e27`
(= production, verified: the live `/` carries `window.PPP_BUILD="3567e27"`). **Design only:** no code, no
baseline, no app or server change in this commit. Roadmap card: `docs/PPP_MASTER_ROADMAP.md` §5.11 (G13), with
TD3, TD13 and TD26 (§13), S8 (§2), the final-completion items 6.1-6.6 (§17) and D-0/D-5/D-6 (§18).

**Why now, although the roadmap puts G13 last.** Most of G13 does not depend on G10-G12. Measured today
(section 1): when unpkg.com is unreachable the app is a **blank page**; a cold load on a mid phone takes
**8.8 s to first paint** and a returning visitor downloads about **2 MB again** because every script is
`no-store`; songs live only in one browser (**a second device loses the song**); the piano samples need a
CC BY attribution that the app does not show; and the built-in demo is labelled with a living film composer's
name. These are fixable now, in small phases that each ship alone, without the user. The parts that need the
user (sync semantics, keeping times, the YouTube posture, the business items) are separated into section 14.

**The user's constraints that shape this design.** Cost stays $0 (Render free, shared 750 hours with the
duckscope services; Neon Free). Nothing on the site may force a login (G10b-2, 2026-10-07): sync works with
**capability codes** like the PC link, not with accounts. Replies and review pages for the user are Korean.

---

## 1. What was measured before designing (evidence)

All live measurements are read-only GETs against `https://ppp-web-2o99.onrender.com` (`3567e27`) from a
throwaway headless Chrome profile (puppeteer 25) on 2026-10-08; scripts in the Architect's scratchpad
(Appendix A). "Phone" = the Lighthouse mobile simulation: 150 ms RTT, 1.6 Mbps down / 750 kbps up, CPU 4x,
412x823 at DPR 2.625. Not a real device (unknown U-K7).

### E1. Third-party runtime dependencies (TD13)

| Dependency | Where | When | Wire size | If unreachable |
| --- | --- | --- | --- | --- |
| React 18.3.1 + ReactDOM 18.3.1 UMD (unpkg, SRI-pinned) | `support.js:1143-1148` (`loadReactUmd`, `support.js:1838`) | every load | 4.3 + 42.9 KB (br) | **the page stays blank**: `[dc] failed to load React or boot`, 0 UI (measured: E3) |
| Google Fonts CSS (Figtree, Instrument Serif, JetBrains Mono, Noto Music, Noto Sans KR/JP/SC) | App 118-120, render-blocking `<link>` | every load | **331 KB CSS** + 15 woff2 = 252 KB (ko locale) | system fonts (harmless, measured) |
| Babel standalone 7.29.0 (unpkg) | `support.js:1147` | only for `x-import` JSX; the app has none | 654 KB if ever loaded | **never requested** in any measured load |
| pdf.js 3.11.174 + worker (jsDelivr) | App 7190-7191 | PDF/photo import | 107 + 305 KB | PDF import fails |
| tfjs 2.8.6 + @magenta/music 1.23.1 `transcription.js` (jsDelivr) + Onsets & Frames checkpoint (storage.googleapis.com) | App 7982-7989 | in-browser recording transcription | 282 + 55 KB code; **checkpoint 15 shards x 4 MB = ~60 MB** (weights 62.5 MB; `max-age=3600`) | browser transcription fails (the home-PC worker still works) |
| tfjs 3.21.0 + @spotify/basic-pitch 1.0.1 (esm.sh, jsDelivr fallback) + model (jsDelivr) | App 8101-8112 | the other browser AMT path | ~315 KB + bundle; model 8.6 KB + 742 KB weights | that path fails |
| YouTube oEmbed / nocookie embed | server.js 1056; App 17559 | YouTube songs | – | title/video missing |

Vendored already: VexFlow 4.2.3 + SMuFL font data (`vendor/`, licences present; the app no longer loads
VexFlow at run time - only tests/tools and `engrave/outlines.js`' 66 Bravura outlines use it). The piano
samples (`audio/piano/*.mp3`, 31 files, 1.3 MB) are served by ppp-web.

### E2. Cold and repeat load (live)

| | Desktop (unthrottled) | Phone profile | Phone, repeat visit (warm cache) |
| --- | --- | --- | --- |
| Requests | 139 (121 own) | 139 | 139, **only 33 from cache** |
| Transferred | 3,322 KB (own 2,692) | 2,987 KB (own 2,363) | **~2,000-2,300 KB again** |
| First contentful paint | 1.53 s | **8.78 s** | – |
| App ready (nav rendered) | 1.61 s | **9.29 s** | 7.0 s |
| Long tasks | 3, max 150 ms | sum 1,970 ms, **max 1,124 ms**, TBT ~421 ms | – |
| JS heap at Home | 21-54 MB | 42 MB | – |

Why so heavy:
- **The app file is fetched twice**: 329 KB brotli (1.22 MB raw, 20,529 lines) as the document, then again by
  the dc-runtime (`support.js:159`: `fetch(location.href)` to re-read the raw template whenever
  `window.__resources` is unset).
- **73 own responses are `no-store`** (every `.html`, `.js`, `.json`; `server.js:1012`), so a returning visitor
  re-downloads all 87 scripts. Only the engraver's `?h=` URLs (G4d-2) are immutable.
- **All four i18n catalogs** (ko 62, ja 63, zh 62 KB br) are fetched `no-store` on every load
  (`i18n.js` `ready`), whatever the locale; English needs none.
- The 31 piano samples (~1.3 MB, cached 30 days) start at boot.
- Google's CSS for three CJK families is 331 KB and render-blocking.

### E3. Offline / CDN-down (live, every non-site host blocked)

72 own requests succeed. `react.production.min.js`, `react-dom.production.min.js` and the Google CSS fail.
Then a page error ("failed to load https://unpkg.com/react@18.3.1/..."), **no FCP, empty body**. Core
practice, playback (the samples are ours) and MusicXML import would all work if React came from ppp-web.
**React is the only hard single point of failure, and it is 47 KB.** The published SRI hashes in `support.js`
match the files on unpkg today (sha384 checked), so vendoring can prove byte identity.

### E4. Per-screen cost on the phone profile (live, guest, ko)

| Screen | Longest task on open | Heap | DOM nodes |
| --- | --- | --- | --- |
| Home | 135 ms | 49 MB | 450 |
| My Songs | 413 ms | 64 MB | 381 |
| Practice (demo) | **616 ms** | 55 MB | 3,153 |
| Practice, playing 10 s | 82 ms | 90 MB | 3,153 |
| Shared Scores | 0 | **89 MB** | **14,636** (110 previews drawn at once; `GET /api/shares` = 681 KB) |

### E5. Server data model and sizes (production, from the read-only backup of 2026-10-01; no SQL was run)

| Table | Rows | Notes |
| --- | --- | --- |
| `ppp_users` | **5** | email + scrypt hash (server.js 749-755) |
| `ppp_progress` | **0** | one JSON blob per account (`PUT /api/progress`, 4 MB cap) - **nobody uses it** |
| `ppp_shares` | 110 (100 hymns, 7 seed library, 3 by one user), **0 guest rows** | the packed-out legacy Score as JSONB: total 7.1 MB, median 51 KB, p90 72 KB, max 729 KB |
| `ppp_pc_links`, `ppp_transcribe_jobs`, `ppp_worker_tokens` | 0 in production at G10b-2 (its doc 12.2) | caps: 500 links, 5,000 rows, 64 MB of notes |

Existing server-side caps: account shares 4 MB each, 200 per account; guest links 1 MB, 20 per browser,
30/h per address, 200/h site, **1,000 rows / 50 MB in all**, 30-day expiry (`share-guest.js`); PC-link queue
as in G10B §12. Estimated Neon storage in use: about 10-15 MB (7.1 MB of score JSON before TOAST compression,
plus indexes) - an estimate, not a measurement (U-K1).

**How songs are stored today (TD3).** Everything is per browser:
- `localStorage`:
  - `ppp.library.v1`: the cards.
  - `ppp.song.v1.<id>`, one key per song: the **packed legacy Score** plus that song's progress (history,
    memory, loop, tempo). Written whole every time; quota errors give a toast.
  - `ppp.state.v2`: the open song's progress, xp, streak, settings.
- IndexedDB `ppp-engrave` v2: the ScoreGraph per song id, gzip; a cache, never the record of truth;
  200 records / 64 MB.
- IndexedDB `ppp-media`: uploaded videos.
- Song ids are random (`'song-' + time + 4 random`), not content hashes.
- An account's progress sync sends `ppp.state.v2` only: the current song's progress, no library, no scores.
  On sign-in it is "server wins" with no merge, so **a second device falls back to the demo**
  (App 12990-13010, 17614-17648).
- There is no export, no backup file, and no "delete my data on this device".

**Graph vs Score size (measured on the 325 catalogue files).**
- ScoreGraph canonical JSON: median 41-47 KB raw, **3.5-4.3 KB gzip**, max 31.6 KB gzip (1,916 notes):
  **15-18 KB gzip per 1,000 notes**.
- Legacy Score JSON: about 245 KB raw per 1,000 notes, gzip about half the graph's.
- A 2,400-note transcription is therefore about 40 KB of gzip graph and about 600 KB of raw Score JSON.
- Storing gzip bytes, not JSONB, is what makes server sync cheap.

### E6. i18n (TD-none; §17 item 6)

The model: the English text is the key. `tx()` is called 1,130 times, with 811 distinct literal strings, and
`PPP_I18N.apply` walks the DOM text nodes. Catalogs: ko 2,118, ja 2,116, zh 2,116 entries.
- **Static scan** (template text and attributes + every `tx('literal')`): **54 strings missing in all three
  locales**: 48 `tx` literals (MIDI import errors, the reference-score flow, difficulty sentences, arranger
  errors) and 6 template labels (Visual settings, Look ahead, Keyboard, Hit effects, Note labels, Learning view).
- **Parity:** 2 keys in ko are missing in ja and zh.
- **Possibly dead:** up to 220 ko keys whose text is not found verbatim in the sources (stale, or built
  dynamically).
- **Live walk** over 11 screens per locale: ko 11, ja 14, zh 20 visible Latin strings. The real gaps among
  them: the Sheet / Falling Notes / Split view tabs (all three locales); the sight-reading coach quote; the
  MIDI settings labels (ja, zh); and coach hints assembled by concatenation ("Left hand at 75% tempo",
  "Left hand accuracy: 56%" in zh). Concatenated strings are invisible to a static key check.

### E7. Monitoring, deploy, security hygiene

- **Fallback counters exist but stay in the tab.** `PPP.engraveStats` (App 11687-11697,
  `engrave/page.js:88`) counts fallbacks by code and song. Nothing reports page errors, fallbacks or load
  times anywhere; there is no `window.onerror` reporting and no uptime monitor.
- **Deploys are manual.** `render deploys create srv-dalt5s6k1f9s739cuetg --commit <40-char sha> --confirm`
  (memory: pushing does not deploy). Verification is `tests/live/smoke.js` (about 1 minute, read-only,
  `--sha`, `--logs`). There is no release checklist file. CI (`bench.yml`) is a 16-shard gate (about 4.5 min)
  plus a 40 s `light` job for docs; nightly suites. None of it touches the live site.
- **Source files are public.** The static server's blocklist is `node_modules, tools, .git, data, tests`
  (server.js:43), so `/server.js`, `/render.yaml`, `/package.json`, `/arrange_score.py` and
  **`/docs/PPP_MASTER_ROADMAP.md`** (deploy ids, review history) are served with HTTP 200 (TD26). `/.env` is 404.
- **Headers.** The origin sends no HSTS, CSP, frame-ancestors or Referrer-Policy (`x-content-type-options`
  comes from Render).
- **No signup limiter** (TD26), with 5 accounts.
- **A login card is the first thing a new visitor sees.** It is not forced ("일단 둘러보기" dismisses it), but it
  is the opposite of the user's no-login direction.

### E8. Licences and notices (facts, not legal advice)

- **No credits, licence, privacy or terms screen exists.** The only notice is the Course screen's per-book
  edition/licence line (App 2050, 17330).
- **Piano samples:** Salamander Grand Piano V3 (Alexander Holm), the Tone.js MP3 cut, **CC BY 3.0, which
  requires attribution** (`audio/piano/README.md`). Shown nowhere in the UI.
- **Code and fonts:**
  - React, ReactDOM, Babel: MIT.
  - pdf.js, tfjs, @magenta/music, basic-pitch: Apache-2.0. Apache §4 asks for the licence and any NOTICE
    when redistributing, which vendoring would be.
  - VexFlow: MIT. Bravura, Petaluma, Leland: OFL-1.1 (files present in `vendor/`).
  - Google Fonts families: OFL-1.1.
  - `support.js` (the generated dc-runtime) has no licence header, and its source (`dc-runtime/`) is not in
    the repo.
  - The terms of the Magenta Onsets & Frames checkpoint are not stated in the repo.
- **Catalogue:**
  - Hymns: Open Hymnal, public domain.
  - Beyer and Czerny 599: transcribed for PPP from 1893-1895 editions, PD/CC0.
  - Hanon, Burgmüller, sonatinas, Czerny 299 and 849: PDMX/MuseScore typesets marked CC0.
  - **15 files are "licence-quarantined" in the benchmark but still ship in the catalogue:** all 10 Czerny
    299 and Burgmüller 1, 2, 4, 7 and 18 (`docs/CURRENT_STATE.md:193`, `tests/bench/corpus/provenance.json`:
    contradictory `<rights>` tags, e.g. Mutopia stamps).
  - The seed library: PD/CC0 pieces plus 3 written for PPP.
- **The demo song** (`buildDemoScore`, App 4140-4197) is a generated pattern, not Zimmer's melody, but it is
  titled **"Interstellar Theme - Hans Zimmer - arr. solo piano"** and is the first song every visitor sees.
- **YouTube:**
  - `/api/youtube-audio` downloads audio with yt-dlp (fetched from GitHub "latest" at every build,
    `render.yaml`), falling back to the third-party `loader.to` (server.js 204-234, 348).
  - The audio is streamed to the browser and its temp folder is deleted (server.js 156-157, 1083); nothing
    is kept on the server.
  - A score made from it can be posted to the public Shared Scores by an account (guest links are always
    unlisted), and nothing checks where a posted score came from.
  - No rights notice exists. YouTube's published Terms of Service restrict downloading content except
    through features YouTube provides or with permission. That is a fact to weigh (U9), not a legal
    conclusion.
- **Helper tools:**
  - Audiveris (AGPL-3.0) is local only.
  - TransKun, Aria-AMT, Beat This, PM2S: licences not stated in the repo.
  - Kong: Apache-2.0 (omr-service.js:776).

### E9. The legacy score path (S8 inventory)

Line numbers are App unless a file is named.

| Item | Where, size | Callers | Gate | Removal needs |
| --- | --- | --- | --- | --- |
| `buildXml` + `opts.legacyWriter` | `audio-score.js` 1193-1315 (~123 lines) | the app never passes it; 4 tests | – | nothing (**dead in production**) |
| `PPP.legacyImport` (`LEGACY_IMPORT`) | 4827, 10356-10357 | 3 branches (5549, 5573, 8669) | default off | nothing (G4f done) |
| `parseMusicXML` + 7 private helpers | 4212-4733 (~521 lines; `navWord` is shared with `PdfLayer` and stays) | **9 ungated call sites**: the catalogue match 8251, the recording import 8304 (re-parses `built.xml` although `built.graph` exists), OMR 8753/8788/8797, rewrite 15660/15755/16089, the arranger base 15864; and `catalog/build-shared-seeds.js:229` | 3 behind `LEGACY_IMPORT` | S4 per producer (recording, catalogue, arranger here; OMR in G12) |
| legacy `Score` object | 3930-4139 (210 lines, 17 methods) | 156 `Score.*` calls (109 in the UI component; `PianoScore`, `PerformanceEngine`, `Learning`, `Memory`, `Coach`, `Fingering`, `ScoreArranger`); `Score.finalize` 17 calls | – | **G11a (S5-play)** and stored data |
| `packScore` / `unpackScore` | 3892-3919 | 10 calls; **every saved song slot and every share is in this shape** | – | a reader kept for old data, forever or until a migration |
| `scoregraph/legacy-score.js` `toScore` / `fromScore` / `compare` | 1,421 lines | `toScore` 4 app calls + review/realize tools; `fromScore` in `engrave/source.js:143` (the projected fallback) | – | `fromScore` stays as the reader of old data; `toScore` goes with the Score |
| `PdfLayer.apply` | 11288-11586 (~300 lines) | OMR | – | G12 |
| `ScoreArranger` + `arrange_score.py` (833 lines, live on the Render helper) | 10108-10345 | the "standard arrangement" path (16626/16631) whenever one-note mode is not used, including after a refusal; its style vocabulary feeds the plan UI regardless of engine | `PPP.arranger` (default `single`) | a user decision that the standard arrangement can go (G8b/G9e precedent) |

Total legacy model code in the app file: about 759 lines (3.7%). The legacy renderer (VexFlow) is already gone
(G4, #54).

---

## 2. Goal and non-goals

**Goal.** A person can rely on PPP:
- it loads fast and works when a CDN is down;
- their songs and progress follow them from a phone to a PC **without an account**;
- it says honestly whose work it uses;
- it is in their language;
- a broken release is seen and rolled back quickly;
- the legacy Score stops being a second model of the music.

All of this at $0 on the existing free tiers.

**Non-goals (not in G13).**
- Payments, pricing or paid tiers (D-6 stays a user decision; recommendation: none now).
- Native apps.
- A multi-instance server: the PC queue's in-memory design assumes one instance (G10B §9).
- Collaborative editing.
- Server-side engraving (§5.12).
- Moving playback and practice onto the graph: that is G11a. G13 removes the Score only after it.
- OMR on the graph (G12).
- Syncing the SongGraph: it is recomputed from the ScoreGraph.
- An installable PWA / service-worker offline mode. A candidate after G13-4, not designed here (section 16).

---

## 3. What already exists - reuse, do not rebuild

| Need | Existing piece |
| --- | --- |
| A login-free secret with hash-only storage, header auth, same-origin and CORS-closed checks, a failures-only limiter, IPv6 /48 keys, keyed address tags, lazy purge, and 0 SQL on idle | the PC link (`home-jobs.js`, `home-jobs-store.js`, G10B §12) and the guest key (`share-guest.js`) |
| One-tap pairing by URL fragment, taken off the address bar before any request | `PPP_PAIR` (App 7-35, G10B §14) |
| Content-hash immutable caching with gzip | the engraver's `?h=` URLs (server.js 44-49, 1020-1027; G4d-2) |
| An additive boot migration under an advisory lock, tested old/new/rollback on a throwaway Postgres | `homeJobsStore.migrate` + `jobs-pg.test.js` (G10B §12.6) |
| A graph per song, gzip, with fingerprint and `scoreHash` | `engrave/store.js`, `engrave/source.js:67` |
| Validating a graph in Node | `scoregraph/` is UMD, so the server can `require` it |
| A read-only deploy check | `tests/live/smoke.js` |
| Mutation-tested limits | `tests/home-worker/mutants.js` (174 mutants) |

---

## 4. Decisions (the Lead's; the user's are in section 14)

| ID | Decision | Rejected alternatives | Evidence |
| --- | --- | --- | --- |
| **G13-D1** | **"Core" = open the app, practise, play, view and print, import MusicXML/MXL/MIDI, save, share.** The core has no runtime third-party dependency. Optional features (PDF/photo reading, in-browser audio transcription) **vendor their code**; their model weights may stay remote (U8) and say so in the UI. | Vendoring the 60 MB O&F checkpoint into the repo and serving it from Render (repo bloat; 100 GB/month egress ≈ 1,600 first uses) | E1, E3 |
| **G13-D2** | **Vendoring = byte-identical published files in `vendor/<pkg>-<version>/` with their LICENSE (and NOTICE for Apache), loaded by plain `<script>` tags; no build step.** A test proves identity: React against the SRI constants already in `support.js`, the others against the npm tarball's sha512 recorded in `vendor/README.md`. React is loaded before `support.js`, so `loadReactUmd` (`support.js:1838`) returns early: **`support.js` is not edited** (it is generated, "do not edit"). | Setting `window.__resources` (it also turns off the template re-fetch, a separate behaviour change: G13-4c); a bundler | E3; `support.js:1149-1153, 1838-1846` |
| **G13-D3** | **One release with a way back:** `PPP.cdn` (`?cdn=1`, or localStorage `ppp.cdn = '1'`) restores the CDN URLs; removed one release later (strangler, roadmap principle 4). | No switch (a broken vendor file could only be fixed by a redeploy) | principle 4 |
| **G13-D4** | **Every own script becomes cacheable by content hash.** At boot the server hashes the files the page names (12 hex of sha256, CRLF as LF, the G4d-2 rule) and rewrites `?v=N` to `?h=<hash>` in the served HTML. A matching `?h=` is answered `immutable` and gzip; anything else stays `no-store`. The i18n catalogs get the same treatment. | A service worker (an offline-install product decision, section 16); long max-age without hashes (stale scripts: G01 R10) | E2 (73 `no-store`, a returning visitor re-downloads 2 MB) |
| **G13-D5** | **Sync = a "library" behind a capability code, the PC-link security model reused** (section 7). The server makes the code (256 random bits, 64 hex) and stores only `sha256('ppp-lib-v1:' + code)`. The code travels in the header `X-PPP-Lib` with `credentials: 'omit'` and a same-origin check; CORS stays closed; wrong codes are limited (failures only); the code is never in a URL that reaches a server (pairing uses the `#lib=` fragment). | Accounts (the user rejected forced login); a client-made code (the server must guarantee randomness and the domain prefix) | G10B §12.1-12.2 |
| **G13-D6** | **The sync unit is the song.** An item holds the card, the packed Score, that song's progress and, when the device has it, the gzip graph. One `state` item holds the cross-song progress. **Bodies are stored as gzip bytes (`bytea`)**, compressed in the browser (`CompressionStream`); the server checks the bounded decompressed size and the JSON shape. **An idle poll runs 0 SQL**: an in-memory `libId → maxRev` cache, filled by the first request after a boot. | One blob per library (every change rewrites everything; conflicts are all-or-nothing); JSONB (3-10x the bytes, and Neon egress counts them) | E5 sizes; G10B §3.2 |
| **G13-D7** | **Merging is deterministic and field-wise; score edits never overwrite each other.** Details in section 7.5. **Settings stay per device** (theme, MIDI device ids, visual options). | Last writer wins on the whole song (loses practice on one device); a full CRDT library (no build step, weight) | today's "server wins" loses the song (E5) |
| **G13-D8** | **Synced content is never evicted to make room.** At a cap the server refuses (503 `busy` or `quota`) and says so. Data goes only by the keeping-time rules shown in the UI (U2), and a library with no song uploaded is "abandoned" after 14 days. | PC-link-style LRU eviction (fine for empty links, wrong for a person's songs) | G10B §12.8 #9 |
| **G13-D9** | **The graph travels next to the Score until S8.** A reader uses the graph only when its `scoreHash` matches the Score it came with; otherwise it projects (`fromScore`), as `engrave/source.js` does now. Shares gain the same optional `graph`. Old clients ignore it. | Graph only (old clients and old shares break); Score only (TD3 stays open) | G4-U1, G2-D14, E5 |
| **G13-D10** | **S8 means removing the legacy Score as a runtime model, while keeping a reader for old data forever.** `unpackScore`, plus a `Score`→graph adapter built on `fromScore`, reads old slots, old shares and old `payload.score`. Removal follows the safe order of section 9. | Migrating every user's localStorage on load (no way back); dropping old shares | E9 |
| **G13-D11** | **Monitoring with no third-party service:** in-memory server counters plus one summary log line an hour. A daily GitHub Actions smoke check (read-only) wakes ppp-web about 16 min a day, about 8 h/month (~1% of 750). Browser counters (U5) are counts only, with no identifiers. | Sentry and the like (cost, privacy, another dependency); an uptime pinger every 5 min (keeps Render awake: about 730 h) | E7; G10B §3.1 |
| **G13-D12** | **Deploy automation is a release script, not push-to-deploy.** `tools/release/release.js <sha>` (local, the Render CLI the Lead already uses): (1) refuse unless the `gate` of that commit passed; (2) print the rollback command with the current live sha; (3) `render deploys create ... --commit <40-char sha> --confirm`; (4) wait for live; (5) `tests/live/smoke.js --sha <sha> --logs`; (6) append to `docs/RELEASES.md`. A Render deploy hook in GitHub is rejected for now: it adds a secret, one person deploys, and the manual act is the user's control. | Render autoDeploy on push (a merge would deploy; today's rule is that it does not) | memory: deploy is manual |
| **G13-D13** | **Performance budgets with numbers (section 11), checked by a committed live tool before each release**, not in CI (it needs the network and the live site). CI keeps deterministic proxies: the byte counts of the page's own files and the number of `no-store` script URLs in the served HTML. | Lighthouse CI against production on every PR (wakes Render; flaky) | E2, E4 |
| **G13-D14** | **i18n has a static checker in the light gate.** Every `tx('literal')` and every literal template text or attribute must exist in ko, ja and zh, with an allowlist (PPP, MIDI, MusicXML, BPM, composer names). Strings built by concatenation are rewritten as one `tx('... {{n}} ...')` sentence. The live walk (section 11) checks what a static check cannot. | Translating as complaints come in | E6 |
| **G13-D15** | **Notices live in two places:** a generated `THIRD_PARTY_NOTICES.md` (served) and Settings > About & licences, in four languages. They cover every item of E8, including the CC BY attribution of the samples. The demo gets an honest name (U6). | Notices in the repo only | E8 |
| **G13-D16** | **The static server serves an allowlist**: the page and `index.html`, the script and data directories the page loads (`scoregraph/ engrave/ playability/ difficulty/ songgraph/ arrangement/ realize/ rec/ candidates/ critics/ repair/ i18n/ audio/ catalog/ vendor/`, the named root `.js` files), `THIRD_PARTY_NOTICES.md`. Docs and server sources are not served. Basic headers are added: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, and HSTS only if Render/Cloudflare do not already set it. Signup gets the login limiter. | The blocklist (it leaked `/docs`, `/server.js`) | E7, TD26 |
| **G13-D17** | **All G13 phases run on Sonnet** (no model phase). The independent review is full for anything served (app, server.js, vendor files) and light for docs/tools (memory: review depth by risk). The sync server phase also gets a separate security review, as G10b-2 did. | – | memory: model assignment, review depth |

**G13-D11 and G13-D12 as built (G13-7a).**
- *Counters:* `server-stats.js`, three hook lines in `server.js`. Per route class (`static`, `api-auth`, `api-shares`, `api-jobs` = the home-PC queue, `health`, `other`): requests,
  answers with a 5xx status, and store errors (every call of `logStoreError`, which itself logs at most 5 lines a minute). One log line `stats: {...}` after an hour of the process
  being awake and one more (`"final":true`) when it is told to stop (SIGTERM): Render spins the free instance down after 15 idle minutes, so most processes live less than an hour and an
  hourly line alone would almost never print. Only numbers; no address, id, path or header; nothing over HTTP; the timer is `unref`'d; booting prints nothing new.
  Read it with `render logs -r srv-dalt5s6k1f9s739cuetg --limit 500 -o text --confirm | grep stats:`.
- *Daily smoke:* `.github/workflows/live-smoke.yml`, 06:05 KST (21:05 UTC) and by hand, read-only, `issues: write` only; a failure opens the issue "Live smoke failed" or comments on the open one
  (`tools/release/smoke-issue.js`). It wakes the site once a day (about 16 min awake, about 8 h of the 750 a month) and is not part of the `gate`.
- *Release script:* `tools/release/release.js <sha> [--confirm]`, local, never called by a workflow; the steps are in `docs/RELEASE_CHECKLIST.md` section 2. The gate it reads is the
  check run named `gate` of the commit through `gh api` (a missing one is pending, a red one refuses; the newest run of that name decides).
  Tests: `npm run test:monitoring` (in the gate, shard-g).

---

## 5. Architecture after G13

```
 browser (any device, no account)                               ppp-web (Render free, ONE instance)              Neon Free
 ------------------------------                                 -----------------------------------              ---------
 page + vendor/react, fonts, i18n (one locale)  <- GET ?h=hash immutable, gzip  (G13-D4)
 localStorage: library, song slots, state  -----.
 IndexedDB: ppp-engrave (graphs)                 | sync engine (G13-S1)
                                                 |  open/focus: GET /api/sync/changes?since=rev  -> in-memory maxRev   (0 SQL when unchanged)
                                                 |  change:     PUT /api/sync/items/:key (gzip, If-Match rev) -> 1 statement  -> ppp_sync_items
                                                 '- hidden:     one batched push (keepalive)                                       ppp_sync_libs
 pairing: #lib=<code> fragment (like #pc=)          code hash only, X-PPP-Lib header, same-origin, failures-only limiter
 shares: + optional graph (G13-S2)          -> /api/shares (unchanged limits)                                          ppp_shares
 counters (U5): POST /api/telemetry (counts) -> in-memory, one log line/hour, 0 SQL
 release: tools/release/release.js -> render deploys create -> tests/live/smoke.js --sha (G13-D12)
```

Unchanged: the PC worker queue, guest links, accounts (U4), the helper proxy.

---

## 6. Track A: no-regret work that can start now

Each phase is one PR, ships alone, and is safe to deploy. The order is by value per risk. Effort is in
Sonnet sessions, review not included.

| # | Phase | What | Touches | Effort | Acceptance (numbers) | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **G13-0 Release tooling** | Commit the measurement scripts as tools: `tests/live/perf.js` (cold/repeat/offline-3p/phone-profile, budgets of section 11, JSON report), `tests/live/i18n-walk.js`, `tests/i18n/gaps.js` (the static checker, with a committed baseline of today's 54 gaps so only NEW gaps fail), `tests/live/smoke.js` unchanged. Add `docs/RELEASE_CHECKLIST.md` (section 12) and `docs/RELEASES.md` (one row per deploy; back-filled from the roadmap). The i18n checker joins the `light` job. | docs + tests only | 1 | the checker fails on a planted new untranslated `tx()` (mutation) and passes on main; `perf.js` reproduces E2/E3 within ±15% on two runs | revert |
| 2 | **G13-1 Vendor React** | `vendor/react-18.3.1/` (React + ReactDOM UMD, MIT LICENSE); two `<script>` tags before `support.js`; the `PPP.cdn` switch (G13-D3). A test checks that the sha384 of the files equals `REACT_SRI` / `REACT_DOM_SRI` in `support.js`. | app head (8 lines), vendor | 1 | **offline-3p: Home renders, the demo opens and plays, 0 page errors, 0 requests to unpkg** (today: blank); the DOM of Home, Practice and Settings is identical with `?cdn=1` and without; all browser suites green on the worktree's port; phone FCP not worse | `?cdn=1`; revert |
| 3 | **G13-2 i18n completeness** | Translate the 54 static gaps plus the live-walk gaps (view tabs, coach quote, MIDI labels, concatenated coach hints rewritten as whole sentences) in ko/ja/zh; fix the 2 parity gaps; set the checker's baseline to 0. The user glances at the Korean in H-13. | app strings, i18n JSON | 1 | static gaps 54 → **0** in all three; parity 2 → 0; live walk: proper nouns only on the 11 screens | revert |
| 4 | **G13-3 Notices** | `THIRD_PARTY_NOTICES.md` (generated by a small script from `vendor/README.md`, `audio/piano/README.md`, `catalog/*/README`, and the CDN list until vendored); Settings > "About & licences" (4 languages) with the CC BY line for Salamander, the OFL fonts, MIT/Apache code, catalogue sources; the YouTube rights notice text decided in U9; the demo renamed as decided in U6 (its id stays `demo`, so saved sessions line up). | app (a Settings section), docs | 1 | every row of E8 appears; the CC BY attribution is reachable in ≤ 2 taps; a test fails if a `vendor/` folder has no row | revert |
| 5 | **G13-4 Load performance** | (a) fetch only the active locale's catalog (others on switch); (b) Latin fonts self-hosted (Figtree, Instrument Serif, JetBrains Mono, Noto Music: OFL woff2 of the used weights) and CJK per U7 (non-blocking); (c) content-hash caching of every script and catalog (G13-D4), plus a measured spike on the template re-fetch (`support.js:159`): if the DOM-parsed template draws identically on every screen and suite, set `window.__resources = {}` to drop the second 329 KB; otherwise keep it and record why; (d) piano samples start after first paint (the synth stand-in already covers a note before they arrive). Each sub-item is its own commit in one PR, or split if review asks. | server.js (static), app head, i18n.js | 2 | phone cold: **FCP ≤ 4.0 s** (8.8), **ready ≤ 5.0 s** (9.3), **transferred before ready ≤ 1.2 MB** (2.99 MB); repeat visit **≤ 450 KB** (~2,000-2,300) and **ready ≤ 3.0 s** (7.0); desktop not worse; byte-identical DOM on Home/Practice/Settings | each sub-switch; revert |
| 6 | **G13-5 Server hygiene + Shared Scores** | Served-path allowlist and headers (G13-D16); signup limiter; `GET /api/shares` paginated (`limit`/`cursor`, 24 per page) and the Shared screen drawing previews as they scroll into view. | server.js, app | 1-2 | `/server.js`, `/docs/*`, `/render.yaml`, `/package.json` → 404; **the 121 own requests of a cold load all still 200** (from `perf.js`'s list) and every browser suite green; Shared screen **DOM ≤ 3,000 nodes** (14,636), **heap ≤ 60 MB** (89) on the phone profile | revert |
| 7 | **G13-6 Backup and delete** | Settings > "Back up my songs" (one `.ppp-library.json.gz`: library, slots, state; graphs optional) and "Restore from a backup" (merge rules of section 7.5, never deletes); "Delete everything on this device" (library, slots, state, ppp-engrave, ppp-media, guest key, PC link; asks twice). | app | 1 | round trip: 30 songs out and in on a fresh profile, identical slots byte for byte; a restore never removes a local song; the deletion leaves 0 `ppp*` keys and 0 PPP IndexedDB databases | revert |
| 8 | **G13-7a Monitoring and release** | `.github/workflows/live-smoke.yml` (daily 06:00 KST + manual; read-only `smoke.js`; opens an issue on failure); `tools/release/release.js` (G13-D12); server in-memory counters (requests, 5xx, store errors, by route class) in one hourly log line. | CI, tools, server.js (counters only) | 1 | a planted 5xx shows in the hourly line; the release script refuses a commit whose gate is not green (tested against the GitHub API with a red commit) | revert; disable the workflow |
| 9 | **MX-3a / MX-3b** | Delete `buildXml` + `legacyWriter` (Node + 4 tests); delete `LEGACY_IMPORT` and its 3 branches. | audio-score.js; app | 0.5 + 0.5 | `ab` identical on every suite; browser suites green | revert |
| 10 | **G13-8 Vendor the optional libraries** | pdf.js + worker; tfjs 2.8.6 + `transcription.js`; tfjs 3.21.0 `dist/tf.min.js` + basic-pitch (spike first: a single-file ESM or UMD build is needed; if basic-pitch has none without a bundler, keep that one path on jsDelivr and say so: U-K4). Model weights per U8. | app, vendor | 1-2 | PDF import and browser transcription work with jsDelivr/esm.sh blocked (weights excepted per U8); identical notes on the G10 browser-model fixtures | `?cdn=1` |

**The first no-regret items, startable today without the user:** G13-0, G13-1, G13-2, G13-4 (a, c, d; b only for
the Latin fonts), G13-5, G13-6, G13-7a and MX-3a/3b. G13-3 can start with everything except the demo name (U6)
and the YouTube sentence (U9), which slot in when decided.

---

## 7. Track B: songs and progress across devices without an account

### 7.1 What a person does

1. Settings > **"Use my songs on other devices"** > **"Turn on"**. No sign-in. The device uploads its songs
   (7.4) and shows:
   - a **sync link** `https://<site>/#lib=<64 hex>`, as a QR code and a Copy button;
   - the code in groups of 8;
   - one sentence: *anyone with this code can see and change your songs; keep it like a password; PPP cannot
     recover it*.
2. On the phone: scan or open the link. The fragment is taken off the address bar before any request (the
   `PPP_PAIR` pattern). One confirmation follows: "Join this song library? Your 12 songs on this phone will be
   added to it". The library is never replaced silently.
3. From then on, songs and progress follow automatically. Each device shows "Synced 2 minutes ago", the
   "kept until <date>" line (U2), **Show my code**, **Change code** (rotate), **Stop syncing on this device**
   (local data stays) and **Delete the library from the server** (asks twice).

### 7.2 Data model (additive migration at boot, in `homeJobsStore.migrate`'s transaction, as G10b-2)

```
ppp_sync_libs  (id TEXT PK  -- 'lib_' + 22 hex of sha256('ppp-lib-v1:' + code)
                client_hash TEXT NOT NULL, created_at, last_used_at, created_ip_tag TEXT,  -- keyed /48 or IPv4 tag (G10B 12.8 #4)
                revoked_at, rotated_from TEXT NULL, bytes BIGINT NOT NULL DEFAULT 0, items INT NOT NULL DEFAULT 0, max_rev BIGINT NOT NULL DEFAULT 0)
ppp_sync_items (lib_id TEXT, key TEXT,            -- 'song:<songId>' | 'state'
                rev BIGINT NOT NULL,              -- = the library's max_rev at write time (one counter per library)
                deleted_at TIMESTAMPTZ NULL,      -- a tombstone; kept 30 days ("recently deleted")
                content_hash TEXT, device TEXT,   -- 16 hex random per device, for "changed on <device>"
                bytes INT NOT NULL, body BYTEA,   -- gzip JSON; NULL for a tombstone
                updated_at TIMESTAMPTZ, PRIMARY KEY (lib_id, key))
INDEX ppp_sync_items_rev ON ppp_sync_items (lib_id, rev)
```

No foreign key to `ppp_users`. Only `CREATE ... IF NOT EXISTS` (the G10b-2 test pattern: old/new/rollback
boots on production-shaped data).

### 7.3 Routes (all `X-PPP-Lib: <code>`, `credentials: 'omit'`, an `Origin` that is not this site gets 403 before the code is read)

| Route | Does | Limits |
| --- | --- | --- |
| `POST /api/libs` | makes a library; returns `{id, code, createdAt}` once | 5/h and 20/day per address (/48), 100/h site, **2,000 live libraries** then 503 `busy` (no eviction: G13-D8) |
| `GET /api/sync/changes?since=<rev>` | `{maxRev, items: [{key, rev, deleted, hash, bytes, device, updatedAt}]}` (metadata only) | 0 SQL when `since == maxRev` in memory; otherwise 1 indexed statement |
| `GET /api/sync/items?keys=a,b,c` | gzip bodies (multipart or base64 JSON), at most 25 keys | **reads: 300 items and 64 MB per library per hour, 256 MB per address per hour, 150 MB per day for the site** (Neon egress, 7.6), then 429 with Retry-After |
| `PUT /api/sync/items` | batch of ≤ 25 `{key, baseRev, hash, body}`; a key whose `baseRev` is stale is answered `409` with the server's metadata (the client merges and retries) | body ≤ 1 MB gzip per item, ≤ 8 MB decompressed (bounded inflate), JSON shape check (a song item has a `validScore` score; `graph` passes `scoregraph.validate` after a measured CPU spike, else client-side only: U-K5); **240 writes/h per library; 16 MB stored per library, 48 MB per address, 128 MB for the site** (refuse, never evict) |
| `DELETE /api/sync/items/:key` | a tombstone | as PUT |
| `POST /api/libs/me/rotate` | new code; the old one is dead at once, and devices holding it get 401 `rotated` ("enter the new code") | 5/h per library |
| `DELETE /api/libs/me` | the library and its items deleted | – |

Wrong codes: 401 `bad-code`, counted per address, **failures only**, 20/h then 429 (G10B §12.1). Purge
(lazy, at most every 6 h, as the PC links):
- a library unused for the keeping time (U2, recommended 180 days);
- a library with no item, 14 days after its last use;
- tombstones after 30 days;
- revoked rows after 2 days (so make-and-revoke cannot dodge the per-address limits).

### 7.4 Migration of the songs already on a device

- **Turning sync on uploads the device's library:**
  - first the `state` item and the cards;
  - then the song slots in batches of 25, the open song first;
  - graphs, from `ppp-engrave`, only when present and when `scoreHash` matches;
  - a progress line, resumable after a reload because the client keeps a per-key "sent rev" map;
  - the demo song is not uploaded, only its progress (it is rebuilt from code).
- **Joining from a second device** downloads the metadata, then the cards, then the scores. Its own local
  songs are offered with "Add" or "Keep only on this phone". Duplicates are merged by identity, in this order:
  `courseFrom`/catalogue id, `sharedFrom` share id, `arrangedFrom` + level, then `scoreHash` of the Score.
  The same identity becomes one song with merged progress; anything else is kept as two songs.
- **A device that later goes offline** keeps working locally and pushes when it is back. Nothing local is
  ever deleted except by a tombstone, and only after the bulk check of 7.5.

### 7.5 Conflicts and merging (G13-D7)

| Part | Rule |
| --- | --- |
| Score of a song (notes, title, arrangement) | Changes rarely (rewrite, edit, re-arrange). **Both changed since the common rev**: the newer stays the song, the other becomes a copy "<title> (changed on <device>)". Nothing is lost. |
| Per-song practice history | Union by entry key (the session's start time and duration; an id is added if the entry has none: U-K6). |
| Memory/mastery per measure | Per measure, the higher level with the later timestamp. |
| xp, minutes | A **per-device counter** (G-counter: `{device: total}`); the shown value is the sum. |
| Streak | Recomputed from the union of practice days. |
| Loop, tempo, last position | Last writer wins by timestamp. |
| Settings, MIDI devices, visual options, locale | **Not synced** (device-local). |
| Deletion | A tombstone, with 30 days in "Recently deleted" on every device. A device that receives **more than 3 deletions at once asks** ("17 songs were removed on another device: remove them here too?"). |

### 7.6 Free-tier arithmetic (estimates, stated as such)

**Render (750 h/month shared with duckscope).**
- Sync adds no timer while a tab is hidden.
- It pulls on open, on focus, and at most every 10 minutes while the tab is visible and in use. Those
  requests fall inside a visit that has already woken the instance.
- One batched push happens when the tab is hidden (`fetch` keepalive).
- **Added instance hours ≈ 0** beyond the visits themselves. Each visit already costs its 15-minute idle
  tail today.

**Neon compute (published as about 100 CU-hours a month on Free; confirm: U-K1).**
- The binding cost is how many 5-minute windows see SQL.
- Pushes are event-driven: a song saved or changed, a practice session ended, the tab hidden; never a
  steady timer.
- A session is therefore about two Neon wakes: open plus the final push, about 10-11 minutes at 0.25 CU.
- 20 people x 30 sessions a month x 10.5 min ≈ 105 h ≈ **26 CU-h**. Add the PC worker's 17 CU-h at the
  hourly default (G10B §3.1), about 43 of ~100.
- Sync must not push on every state change. Today's account sync calls `pushProgress` on every
  `writeState`, which would keep Neon awake for whole sessions.

**Neon storage (0.5 GB).**

| Use | Budget |
| --- | --- |
| Shares today | ~10-15 MB |
| Guest-link cap | 50 MB |
| PC-queue notes cap | 64 MB |
| **Sync cap** | **128 MB** |
| Total | ≤ 257 MB, about half, leaving room for indexes, TOAST and WAL |

- An item is about 5-60 KB of gzip: the median catalogue song with its graph is ~8 KB; a 2,400-note
  transcription with its graph is ~70 KB.
- A 30-song library is about 0.5-2 MB, so 128 MB holds roughly 60-250 such libraries. The per-library cap
  of 16 MB is about 250-3,000 songs.
- At 80% of the site cap the server logs a warning line every hour and the user is told (U3).

**Neon egress (published as 5 GB/month on Free; confirm).**
- Deltas only, gzip.
- A full download of a 2 MB library to a new device is 2 MB.
- The site's 150 MB/day read cap holds the month at ≤ 4.5 GB in the worst case; normal use is a few MB a day.

**Render bandwidth (published as 100 GB/month on Free; confirm).**
- Today a cold phone visit is 2.4 MB of our own bytes, and a repeat visit about 2 MB.
- After G13-4 a repeat visit is ≤ 0.45 MB: about 5x more visits for the same bandwidth.

### 7.7 Abuse analysis (what a stranger with no account can do)

| Capability | Bound |
| --- | --- |
| Make libraries | 5/h and 20/day per address (/48), 100/h site, 2,000 live; past it, 503 `busy` (honest visitors are refused, not evicted: a deliberate difference from the PC links, because a library holds a person's songs; the cost is that a sustained attack at 100/h fills the 2,000 places in 20 hours and then blocks new libraries until the 14-day purge of empty ones; existing libraries keep working) |
| Store data | 16 MB per library, **48 MB per address**, 128 MB site; bodies are gzip JSON of the song shape (no arbitrary files); unreadable without the code, so **not a public distribution channel** (unlike listed shares) |
| Read data | only with the code; read limits per library/address/site (7.3) bound egress |
| Guess a code | 256 bits; failures-only limiter 20/h per address; constant-time compare; id derived with a domain prefix (no other secret of the site hashes to a library id) |
| Hold up the server | body limits, bounded gzip inflate (a zip bomb stops at 8 MB), JSON depth/NUL checks (`share-guest.js` `inspect`), 25 items per batch |
| **A leaked code** | full read and write of that library. The remedy is **Change code** on any device. An attacker who rotates first locks the owner out, and there is no recovery channel (no email): that is the price of no account. Mitigations: local copies stay on every device; the backup file (G13-6); bulk deletions ask (7.5); tombstones last 30 days. |
| **A lost code** (all devices cleared) | unrecoverable; the library expires after the keeping time. The UI asks to save the code or a backup when sync is turned on, and once more after the 10th song. |

### 7.8 Phases (Track B)

| Phase | What | Effort | Acceptance | Rollback |
| --- | --- | --- | --- | --- |
| **G13-S0 Server** | `sync-store.js`, `sync.js` (routes), migration, limits, purge, in-memory rev cache; **routes 404 unless `PPP_SYNC=1`** | 2 + full and security review | unit + Postgres tests in the G10b-2 style: **100 idle `changes` polls = 0 statements**; old/new/rollback boots identical; every limit of 7.3/7.7 mutation-tested (target ≥ 60 mutants); a zip bomb refused; cross-library isolation | `PPP_SYNC=0` (default); revert boots on the migrated DB |
| **G13-S1 Page** | Settings section, `#lib=` pairing, upload/migration, pull/push engine, merge rules, conflict copies, recently-deleted, bulk-delete check; behind `PPP.sync` (off), 4 languages | 3 + full review | two puppeteer contexts against a local server: **30 songs migrate**, edits converge after ≤ 2 opens, a concurrent score edit forks with both kept, a 17-song deletion asks, offline edits push later, **SQL statements per session ≤ 4**; with the switch off the page is byte-identical to main | switch off |
| **G13-S2 Graphs travel** | the graph in sync items and (optional field) in shares; the reader prefers it when `scoreHash` matches | 1.5 | an imported song with ties/tuplets/8va opens on the second device with the same `fingerprint` as the first (not projected); old shares open unchanged | ignore the field |
| **G13-S3 On by default** | the Settings section visible for everyone (the H-13 two-device run first) | 0.5 | H-13 sync steps pass | hide again |

Accounts (U4): unchanged in S0-S3. The account progress blob (0 rows) is left as it is; folding accounts into
libraries is not proposed.

---

## 8. Track C: what G13 itself removes from the legacy path (S8)

Ordered so that each step is one small PR with identical outputs. Steps 1-5 are in G13's scope now; 6-9
wait for their owners.

| Step | Removal | Depends on | Effort | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | `buildXml` + `legacyWriter` (MX-3a) | – | 0.5 | `ab` identical, 4 tests rewritten to the graph writer |
| 2 | `LEGACY_IMPORT` + 3 branches (MX-3b) | G4f (done) | 0.5 | browser suites, `app-import-check` |
| 3 | S4 recording/rewrite: 8304, 15660, 15755, 16089 → `toScore(built.graph)` | G10 (the graph exists on those paths) | 1 | the teacher's flow (memory: reproduce the exact flow): identical Score JSON, identical engraving hash |
| 4 | S4 catalogue match 8251 and `catalog/build-shared-seeds.js` → the graph importer | – | 0.5 | the 110 seed and hymn shares byte-identical after a rebuild |
| 5 | S4 arranger base 15864 → graph; `ScoreArranger.styles/norm/recommend/levels` moved to their own module | – | 1 | the arranger fixture hashes (21 legacy hashes) identical |
| 6 | OMR: `PdfLayer.apply` on the graph, then 8753/8788/8797 | **G12** | (G12) | G12's gates |
| 7 | delete `parseMusicXML` (keep `navWord`) | 2-6 | 0.5 | no reference left (static ban test) |
| 8 | the standard arrangement (`ScoreArranger.arrange`, `arrangeWithService`, `arrange_score.py`, `/arrange-score`) | **user decision U10b** that the standard arrangement can go | 1 | no route left; the refusal path offers the lead-sheet arrangement instead |
| 9 | the runtime `Score` and `toScore`; writes stop using `packScore` | **G11a** (S5-play) and G13-S2 | 2-3 | all practice and playback suites on the graph; `unpackScore` + the `fromScore` adapter still read old slots, shares and `payload.score` (G13-D10) |

---

## 9. Ordered phase plan (all tracks)

| Order | Phase | Needs the user? | Model | Effort (sessions) |
| --- | --- | --- | --- | --- |
| 1 | G13-0 release tooling + checklist | no | Sonnet | 1 |
| 2 | G13-1 vendor React | no | Sonnet | 1 (+ review) |
| 3 | G13-2 i18n completeness | no (the user glances at ko in H-13) | Sonnet | 1 |
| 4 | MX-3a + MX-3b | no | Sonnet | 1 |
| 5 | G13-4 load performance (CJK part after U7) | U7 for CJK only | Sonnet | 2 (+ review) |
| 6 | G13-5 server hygiene + Shared Scores | no | Sonnet | 1-2 (+ review) |
| 7 | G13-6 backup / delete on device | no | Sonnet | 1 (+ review) |
| 8 | G13-7a monitoring + release script (7b browser counters after U5) | U5 for 7b | Sonnet | 1 (+0.5) |
| 9 | G13-3 notices + About (demo name U6, YouTube sentence U9) | U6, U9 | Sonnet | 1 |
| 10 | S8 steps 3-5 | no | Sonnet | 2.5 |
| 11 | G13-S0 sync server | U1, U2, U3 (before S1 ships; S0 can merge dark) | Sonnet | 2 (+ full + security review) |
| 12 | G13-S1 sync page | U1, U2 | Sonnet | 3 (+ review) |
| 13 | G13-S2 graphs travel | no | Sonnet | 1.5 |
| 14 | G13-8 vendor optional libraries | U8 | Sonnet | 1-2 |
| 15 | H-13 + G13-S3 | user ~60 min | – | – |
| later | S8 steps 6-9 | G12, G11a, U10b | Sonnet | 4-5 |

About **17-20 sessions** of implementation before H-13. **No phase needs Opus**: nothing in G13 is a
learned-model phase.

---

## 10. Acceptance gates (the release checklist's numbers)

1. **No core CDN.** With every host other than the site blocked: Home renders, a catalogue song and an
   imported MusicXML open, Play sounds the samples, 0 page errors, and 0 requests to third-party hosts before
   the first interaction. CJK fonts are excepted per U7; if Google CJK is kept, it loads non-blocking.
2. **Load budgets** (section 11) met on `perf.js`, two runs each.
3. **i18n:** 0 static gaps, ko/ja/zh parity 0, and the live walk shows proper nouns only.
4. **Notices:** every E8 item listed; the CC BY attribution visible.
5. **Hygiene:** the served-path allowlist returns 404 for sources and docs, and every page request still
   succeeds; the signup limiter is in place.
6. **Sync** (when on): the S0/S1 acceptance above; **0 SQL on idle polls**; ≤ 4 statements per session;
   limits mutation-tested; the keeping time shown on every device.
7. **S8 steps in scope:** identical outputs per step.
8. **Operations:** every deploy goes through `release.js`, with a row in `docs/RELEASES.md` and a green
   `smoke.js --sha`; the daily live smoke has been green for 7 days.
9. **H-13 passed.**

---

## 11. Performance budgets

Measured with `tests/live/perf.js` on the phone profile (E2) unless stated.

| Budget | Today | Target |
| --- | --- | --- |
| Cold FCP | 8.78 s | **≤ 4.0 s** |
| Cold app ready | 9.29 s | **≤ 5.0 s** |
| Bytes before ready (cold) | 2,987 KB | **≤ 1,200 KB** |
| Repeat-visit bytes | ~2,000-2,300 KB | **≤ 450 KB** |
| Repeat-visit ready | 7.0 s | **≤ 3.0 s** |
| TBT at boot | ~421 ms | **≤ 300 ms** |
| Longest boot task | 1,124 ms | **≤ 500 ms** |
| Practice screen open, longest task (CPU 4x) | 616 ms | **≤ 400 ms** |
| Shared Scores DOM / heap | 14,636 / 89 MB | **≤ 3,000 / ≤ 60 MB** |
| Heap after 10 s of practice playback | 90 MB | **≤ 100 MB** (no regression; tablets: U-K7) |
| Desktop cold ready | 1.61 s | not worse |

---

## 12. Release checklist (becomes `docs/RELEASE_CHECKLIST.md` in G13-0)

1. The PR's `gate` passed, read as a separate step (memory: merge only on a green gate).
2. The off-path identity of the phase holds (switch off = main).
3. `node tools/release/release.js <40-char sha>` prints the rollback sha, deploys, waits, runs
   `tests/live/smoke.js --sha <sha> --logs`, and writes a row in `docs/RELEASES.md`.
4. For phases that change what loads: `node tests/live/perf.js phone|offline3p|repeat`, numbers in the PR and
   in `RELEASES.md`.
5. For user-visible text: `node tests/live/i18n-walk.js ko-KR` shows no new gap.
6. For a change of the user's own flow: reproduce the exact flow on production (memory: reproduce the exact flow).
7. Tell the user in Korean what changed, in one or two lines, with the rollback.

---

## 13. H-13 — the end-to-end walkthrough (the user, about 60 minutes, a phone and a PC, Korean script)

A Korean Artifact with the db capability lists the steps. Each step is pass/fail with a comment and an optional
screenshot.

1. Fresh phone browser: the site opens in Korean with no login card (U4), within the budget.
2. Open a course piece, practise 2 minutes, play it.
3. Import a MusicXML file and a MIDI file; open the score; print preview on the PC.
4. A YouTube link with the browser model, then with "my PC" (if connected).
5. Make an easier arrangement; share it as a link; open the link on the other device.
6. Turn on sync on the PC; join from the phone with the QR link; see the songs.
7. Practise on the phone; see the progress on the PC after opening it.
8. Change a song on both devices while one is offline; see the copy with both kept.
9. Delete a song; see "Recently deleted"; restore it.
10. Back up the library to a file; restore it in a private window.
11. Settings > About & licences: read the notices.
12. Switch the language to ja, zh and en for one screen each (spot check).

**Pass:** every step passes, or fails only for a reason the user accepts as out of scope. A failed step is
fixed and **only that step** is re-run (memory: review only when fixed).

---

## 14. Decisions the USER must make (product / UX / cost only)

| ID | Decision | Recommendation | Cost of being wrong |
| --- | --- | --- | --- |
| **U1** | Sync without accounts, by a secret code / QR link that the person keeps (section 7) | **Yes.** It follows the no-login decision and reuses a security model already reviewed twice. | A lost code cannot be recovered (no email). Accounts could be added later as an additive "attach a library to my account". |
| **U2** | How long the server keeps a library nobody syncs | **180 days from the last sync of any device**, shown as "kept until <date>". The device's own copy and the backup file stay. | Too short: someone back after 7 months finds the server copy gone (their device still has it). Forever: the free database slowly fills with abandoned libraries. |
| **U3** | Stay inside the free tiers (sync cap 128 MB of 0.5 GB) and decide on paying only at 80% | **Yes, $0 now.** The server warns at 80% and the Lead reports it. | If growth is sudden, new libraries are refused for a while (existing ones keep working) until the user decides on a paid Neon plan. |
| **U4** | Stop showing the login card to every new visitor; sign-in moves to Settings and is still needed for posting to Shared Scores | **Yes.** 5 accounts and 0 progress rows say the card buys nothing. | Fewer accounts, so fewer listed shares. |
| **U5** | Anonymous counters sent by browsers (errors, engraver fallbacks, load time; no ids, aggregated in memory, one log line an hour), disclosed in About | **Yes.** Without them a broken release is only seen when someone complains. | A privacy complaint, low risk with no identifiers. Without them: blind to field failures. |
| **U6** | Rename the demo "Interstellar Theme - Hans Zimmer" (its notes are a generated pattern) | **Yes**, to an original title, e.g. "PPP Practice Theme". | Keeping it: a film-title / composer-name complaint, and a misattribution in every first impression. Renaming: none. |
| **U7** | Korean/Japanese/Chinese text in the device's own fonts (fast, works offline) or Google's Noto Sans as now (331 KB render-blocking CSS) | **System fonts first; Noto loaded non-blocking** where online, so the look settles to today's. | A slightly different font for a moment, or on Windows (Malgun Gothic). |
| **U8** | The in-browser transcription model (60 MB, Google's storage) | **Keep it at Google**, vendor the code, say "needs internet" on that button. The PC worker is the strong path anyway. | If Google moves the checkpoint, the browser model breaks until we host it (the PC path still works). |
| **U9** | YouTube transcription posture (facts in E8) | **Keep the feature; add a notice** ("use recordings you have the right to use; the score is for your own practice"); **do not allow posting YouTube-derived scores to the public Shared Scores** (links stay); default the PC worker to download on the PC; ask a lawyer before any commercial launch. | Without it: takedown requests, the server's IP blocked by YouTube (today's fallback is a third-party site), a complaint about a posted arrangement. With it: a little friction for posting covers. |
| **U10** | D-6 business: accounts, pricing, payments | **None in G13.** Revisit after H-13 with real usage. | Earlier monetisation forces accounts, payments compliance and support work. |
| **U10b** | (later, S8 step 8) Drop the "standard arrangement" (the old engine with the shapes the teacher disliked) once the lead-sheet arrangement covers refusals | Decide at G10c-1's close. | Some pieces would have no easy version for a while. |
| **U11** | H-13: when | After G13-S1 is on a test build and Track A is live; about 60 minutes. | Running it earlier means a second sitting. |

**The 15 quarantined catalogue files** (E8) are the Lead's work, not a user decision: re-source them from
CC0/PD-only typesets. Hiding them meanwhile changes the course content, so **the user is told before
anything is hidden**.

## 15. Decisions the Lead makes alone

The vendor layout and identity tests; the hashing rule; the served-path allowlist contents; header choices;
merge rules' implementation details; limits within the free-tier budgets above; checker allowlists; the order
inside Track A; review depth per phase (G13-D17); re-sourcing the quarantined files.

---

## 16. Risks

| Risk | Mitigation |
| --- | --- |
| A vendored file differs from the CDN's and breaks boot | Identity test against the SRI / tarball hashes; `PPP.cdn` for one release; DOM identity checks |
| The content-hash rewrite misses a script, which is then stale or broken | `perf.js` lists every own request: all must be `?h=`-immutable or deliberately `no-store`; browser suites; the old `no-store` path stays for unknown URLs |
| Dropping the template re-fetch changes rendering | Done only after a spike shows identical DOM on every screen (G13-4c); otherwise kept |
| The allowlist forgets a file the page needs | The cold-load request list (121 URLs) is the test oracle; lazy files (rec/, candidates/, ottava) are exercised by the browser suites |
| Sync merges lose or duplicate practice | Deterministic merge with unit tests over generated histories (idempotent, commutative, associative); conflicts fork, never overwrite; bulk deletes ask |
| A leaked code or an attacker's rotation | Section 7.7; the backup file; local copies |
| Neon compute creeps up | Event-driven pushes, 0 SQL on idle polls, the statement count per session in tests, the hourly counter line |
| Free-tier caps reached | Refuse with a clear sentence; warn at 80%; U3 |
| Users clear the browser and lose everything | Sync (opt-in) and the backup file; the UI says that local data is local |
| G13 touches the 20k-line app file in many phases | Small hunks per phase; one writer per worktree; the full review for anything served |
| The legal posture of YouTube downloads | U9; facts stated; no legal advice claimed |

---

## 17. Rollback

- **G13-1 and G13-8:** `?cdn=1` / `ppp.cdn`; revert.
- **G13-4:** each sub-item reverts alone. Content-hash URLs are additive: the server still answers the old
  `?v=` URLs `no-store`.
- **G13-5:** revert the allowlist.
- **Sync:** `PPP_SYNC=0` on the server (routes 404) and `PPP.sync` off in the page. The migration is additive,
  so the previous commit boots on the migrated database (tested as in G10b-2). Turning sync off never deletes
  local data.
- **S8 steps:** each is a revert; `unpackScore` and the `fromScore` adapter are never removed (G13-D10).
- **Releases:** `release.js` prints the previous live sha. Rolling back = `render deploys create ... --commit <previous>`.

---

## 18. What is NOT done in G13

- Payments, pricing and paid tiers (U10).
- Native apps.
- An installable PWA / service-worker offline mode: a candidate after G13-4, needs a product decision.
- A multi-instance server.
- Real-time collaboration.
- Syncing settings or the SongGraph.
- S5-play (G11a) and OMR on the graph (G12).
- Removing the standard arrangement before U10b.
- Hosting the 60 MB browser model (U8).
- A lawyer's opinion.

---

## 19. Honest unknowns

| ID | Unknown | How it is resolved |
| --- | --- | --- |
| U-K1 | Neon Free's exact allowance (compute hours, storage, egress) for the `ppp` project, and the storage used today: no SQL was run for this design, so the 10-15 MB estimate comes from the 2026-10-01 backup's JSON sizes | The Lead reads the Neon console (read-only) before G13-S0 merges |
| U-K2 | Render Free bandwidth (published as 100 GB/month) and the duckscope services' current share of the 750 hours | Render dashboard, read-only |
| U-K3 | Whether the dc-runtime's template re-fetch is needed for correct rendering | The G13-4c spike |
| U-K4 | Whether basic-pitch 1.0.1 and tfjs 3.21 can be vendored as single files with no bundler | The G13-8 spike; fallback: keep that one path on jsDelivr |
| U-K5 | The CPU cost of `scoregraph.validate` for a 2,400-note graph on Render's free CPU share | Measured in G13-S0; if over ~100 ms, validation stays client-side and the server checks shape and bounds only |
| U-K6 | Whether practice history entries have a stable key for the union merge | Read in G13-S1; add an id at write time if not |
| U-K7 | Real phones and tablets (iPad Safari memory limits, a low-end Android) | Emulation only so far; H-13 on the user's own devices; one real low-end phone run if available |
| U-K8 | Real library sizes (no telemetry exists) | U5 counters (counts only) or the sync server's own byte totals |
| U-K9 | Whether anyone besides the user and the teacher uses accounts | 5 accounts; U4 makes this moot |
| U-K10 | The licence of the dc-runtime (`support.js`) and of the Magenta O&F checkpoint | Ask the source; record in `THIRD_PARTY_NOTICES.md` as "not stated" until known |

---

## 20. Lead summary (for the roadmap)

**G13 designed (on Opus).** The evidence:
- **React from unpkg is the only hard dependency of the core:** with CDNs blocked the page is blank.
- **Phone cold load: FCP 8.8 s**, 3.0 MB, a 1.1 s boot task.
- **A repeat visit re-downloads ~2 MB**: 73 `no-store` responses; the app file is fetched twice; all four
  catalogs are fetched every time.
- **Songs never leave the browser**; account progress sync has 0 rows and drops the song on a second device.
- **No notices are shown**, and the CC BY attribution of the samples is required.
- The demo is labelled with Hans Zimmer's name.
- 54 untranslated strings in each of ko, ja and zh.
- `/server.js` and `/docs` are served publicly.
- The Shared Scores screen draws 14.6k DOM nodes.

The plan has three tracks:
- **(A) no-regret phases**, startable now without the user: release tooling, vendoring React behind
  `PPP.cdn`, i18n to 0 gaps, load budgets, a served-path allowlist, backup/delete, monitoring and a release
  script, MX-3.
- **(B) sync of songs and progress across devices without accounts**, using capability-code libraries on the
  PC-link security model: gzip items, 0 SQL when idle, field-wise merges, conflicts fork, no eviction of user
  data; about 26 CU-h a month for 20 active users; 128 MB of the 0.5 GB.
- **(C) S8 removals** in a safe order, with a reader for old data kept forever.

About 17-20 Sonnet sessions before H-13. User decisions U1-U11; the Lead recommends yes to sync by code, a
180-day keeping time, $0, no login card, anonymous counters, renaming the demo, system CJK fonts, keeping the
browser model at Google, a YouTube notice with no public posting of YouTube-derived scores, and no business
items in G13.

---

## Appendix A. Measurement scripts (Architect's scratchpad, not in the repo; G13-0 commits them as tools)

`C:\Users\kimyi\AppData\Local\Temp\claude\D--PPP\da967cec-e35e-4af2-a321-f5db3b6be71c\scratchpad\g13-design\`:

| Script | Measures | Results |
| --- | --- | --- |
| `live-load.js desktop\|phone\|offline3p` | cold load: requests, bytes by host, FCP/LCP/ready, long tasks, heap, failures | `live-*.json` |
| `live-repeat.js` | warm-cache revisit on the phone profile | `live-repeat.json` |
| `live-screens.js` | per-screen long tasks, heap and DOM, phone, guest | `live-screens.json` |
| `live-i18n.js <locale>` | visible untranslated text over 11 screens | `live-i18n-<locale>.json` |
| `i18n-gaps.js <worktree>` | the static key check | `i18n-gaps.json` |
| inline Node (`graph-sizes.json`) | ScoreGraph vs legacy Score JSON sizes over the 325 catalogue files | – |

CDN file sizes were read with `curl --compressed`. The React SRI hashes were checked with
`openssl dgst -sha384`. Production row counts and share sizes come from
`D:/PPP-db-backups/2026-10-01/*.json` (read only; counts and sizes only).
