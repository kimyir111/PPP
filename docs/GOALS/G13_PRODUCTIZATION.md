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

**G13-S0 (the sync server) is built (Implementer, Sonnet, 2026-10-15; section 7.9 is its record).** `sync-store.js` and `sync.js`, behind `PPP_SYNC=1` (unset: its routes
are 404, its modules are not loaded, no table is made - merging it changes nothing live). Decisions taken by the Lead with the user's go-ahead of 2026-10-15: **U1 yes** (sync
by a secret code or QR link the person keeps, no account), **U2** (the server keeps a library 180 days from the last sync of any device, shown as "kept until <date>"; the
device copy and the backup file stay), **U3** (inside the free tiers: a sync cap of 128 MB of Neon's 0.5 GB, a warning at 80 % in the hourly stats line, refuse - never evict -
at the cap). The page (S1) is not part of it. An independent security review of the first version (PR #276) found two major and six smaller problems; all eight are fixed in the same
PR and described in 7.9, "After the security review".

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
| `buildXml` + `opts.legacyWriter` | `audio-score.js` 1193-1315 (~123 lines) | the app never passes it; 4 tests | – | nothing (**dead in production**) - **removed by MX-3a, 2026-10-08** |
| `PPP.legacyImport` (`LEGACY_IMPORT`) | 4827, 10356-10357 | 3 branches (5549, 5573, 8669) | default off | nothing (G4f done) - **removed by MX-3b, 2026-10-08** |
| `parseMusicXML` + 7 private helpers | 4212-4733 (~521 lines; `navWord` is shared with `PdfLayer` and stays) | **9 ungated call sites**: the catalogue match 8251, the recording import 8304 (re-parses `built.xml` although `built.graph` exists), OMR 8753/8788/8797, rewrite 15660/15755/16089, the arranger base 15864; and `catalog/build-shared-seeds.js:229` | the 3 behind `LEGACY_IMPORT` went with MX-3b | S4 per producer (recording, catalogue, arranger here; OMR in G12) |
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
| **G13-D4** | **Every own script becomes cacheable by content hash.** When it serves the page the server names the hash of each file the head loads (12 hex of sha256, CRLF as LF, the G4d-2 rule; a `stat` per file, the file is read again only when its mtime or size moved - not computed once at boot, so an edited file on a dev machine and a deploy are both right) by rewriting `?v=N` to `?h=<hash>` in the head of the served HTML (the source keeps `?v=N`). A request is answered `immutable` and gzip only when `?h=<the file's current hash>` is its WHOLE query (`&retry=...` or any other parameter: `no-store`); anything else stays `no-store`. The i18n catalogs get the same treatment (their hashes travel in `window.PPP_HASHES`). The page itself is `no-store` in this decision; the separate G13-4c3 relaxes it to `no-cache` + an ETag of the bytes sent (the bytes contain every hash, so it cannot be stale). | A service worker (an offline-install product decision, section 16); long max-age without hashes (stale scripts: G01 R10) | E2 (73 `no-store`, a returning visitor re-downloads 2 MB) |
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
  answers with a 4xx status (`tooMany` = the 429s among them, so a limiter that misfires is not lost among scanner 404s), answers with a 5xx status, and store errors (every call of
  `logStoreError` for a request; it itself logs at most 5 lines a minute); apart, `idlePoolErrors` for the pool's own error event (a dropped idle connection). One log line `stats: {...}` after an hour of the process
  being awake and one more (`"final":true`) when it is told to stop (SIGTERM): Render spins the free instance down after 15 idle minutes, so most processes live less than an hour and an
  hourly line alone would almost never print. Only numbers; no address, id, path or header; nothing over HTTP; the timer is `unref`'d; booting prints nothing new.
  Read it with `render logs -r srv-dalt5s6k1f9s739cuetg --limit 500 -o text --confirm | grep stats:`.
- *Daily smoke:* `.github/workflows/live-smoke.yml`, 06:05 KST (21:05 UTC) and by hand, read-only, `issues: write` only; a failure opens the issue "Live smoke failed" or comments on the open one
  (`tools/release/smoke-issue.js`). It wakes the site once a day (about 16 min awake, about 8 h of the 750 a month) and is not part of the `gate`.
- *Release script:* `tools/release/release.js <sha> [--confirm]`, local, never called by a workflow; the steps are in `docs/RELEASE_CHECKLIST.md` section 2. The gate it reads is the
  check run named exactly `gate` of the commit, made by GitHub Actions, through `gh api` (`filter=all`; a missing one is pending, a red one refuses; the highest id decides). A commit that is not in
  the history of `main` refuses unless `--allow-unmerged`; every `gh` call names `kimyir111/PPP`.
  Tests: `npm run test:monitoring` (in the gate, shard-g).

**G13-4 as built (load performance, PR "G13-4").** Each sub-item is its own commit and reverts alone.
- *(a) i18n.js* fetches only the catalog of the language in use (English: none, `ready` is already done); `setLocale`/`setAutomaticLocale` fetch the new one and tell the listeners when it is in
  (only the latest switch). An answer that is not 2xx (a 502/503 while the server restarts for a deploy) is NOT a catalog: English for now, two more asks 2 s and 6 s later, and a catalog that comes then is
  told to the listeners like a switch (a person is not left in English until they reload). `PPP_I18N.load(locale)` fetches without switching. Tests: `tests/load/i18n-lazy.test.js`; the slow-network cases of `tests/i18n-and-auth.test.js` are unchanged and green.
- *(c) content hashes.* `static-assets.js` (new, used by `server.js`): a js/json/css/woff2 file asked for as `?h=<12 hex of sha256, CRLF as LF>` is `immutable` + gzip (a woff2 is not gzipped again),
  with an ETag per encoding, 304 for `If-None-Match`, a whole 200 for `Range` and the headers of GET for HEAD; any other URL - also one with a second parameter beside the right hash, such as the recovery `&retry=<stamp>` - stays `no-store`. The page (at `/` and at its own address) is rewritten per
  request: the head's `<script src>`, `<link href>` and `url()` of served files name their hash instead of `?v=N` (the source keeps `?v=N`), and `window.PPP_HASHES` carries the catalogs' hashes.
  The rewrite costs a page request about 3 ms (median 1.8 -> 5.1 ms on a busy PC: the 1.3 MB file is read, its head rewritten, and sent). Tests: `tests/load/content-hash.test.js`; `static-allow` still decides first.
- *(c) the template re-fetch is switched off* (`window.__resources = {}`, one line in the head; `support.js` untouched). Evidence (`tests/load-app/template-refetch.js`, second fetch held): the two
  compiled templates differ in nothing but the spelling of 8 event attributes (`onClick`... lower-cased by the DOM parser, mapped back by the runtime's EVENT_MAP), the rendered DOM is identical,
  and React is handed identical props by each of the 454 / 3,077 / 462 elements of Home / Practice / Settings. `tests/load-app/template.test.js` keeps that proved.
- *(b) fonts.* Figtree, Instrument Serif, JetBrains Mono (latin + latin-ext) and Noto Music (music) are in `vendor/fonts/` (Google's woff2, byte for byte, OFL licences, README rows) and declared in the
  head with Google's own faces (same weights and unicode-ranges, `swap`); the three Google links of the template's `<helmet>` become two preconnects and a dns-prefetch, so the template keeps its element count and every `data-dc-tpl` stamp of the DOM is where it was (Home/Practice/Settings are byte-identical to origin/main, `tests/load-app/dom-identity.js`). No font is preloaded: the browser's scanner finds a preload in the body at once and it would take 72 KB from the scripts. The 331 KB Google stylesheet leaves the template: Korean/Japanese/Chinese stay on Google's Noto Sans (U7 undecided), asked
  for by a script after load and idle, so the text is in the system font until it arrives. A Noto family the device already has is left out of that request (a web face of the same name shadows the
  installed font while it loads: on a PC with Noto Sans KR installed the page went installed -> the system default -> the same font, CLS 0.14 -> 0.34, and 450 KB for nothing; tests/load-app/cjk-fonts.test.js).
  Tests: `tests/load/fonts.test.js`.
- *(d) piano recordings* start after the window's load, two frames, an idle moment and the CJK stylesheet (or its failure; 7 s cap); a tap or key still starts them at once, and until they are in a note is
  the synthesized stand-in. Tests: `tests/load-app/samples.test.js`.
- *(c3, a separate stacked PR) the page is revalidated:* `Cache-Control: no-cache` + an ETag of the bytes sent (they contain the build stamp, every script's hash and the share's tags, so any change is another tag); a returning visitor
  whose bytes are unchanged gets a 304 and no 306 KB page. The one place where "anything else stays `no-store`" of G13-D4 is relaxed, so it is its own commit and PR. Measured: repeat visit, first visit complete: 310 KB / 2.8 s -> **1 KB / 1.4-1.8 s**;
  with the tool's 6 s settle: ready 3.1-3.6 s -> **1.7-1.9 s** (the 810 KB that remain are samples the first visit had not finished).
- *Mutants:* `npm run test:load-mutants` (54 planted defects, all killed). `npm run test:load` (Node only) is in the gate, shard-h; `npm run test:load-app` (browser, own server) is run by hand.
- *Measured* (this PR's server against a `git archive` of origin/main `13bcb86` in the same session, `tests/live/perf.js` phone profile through a brotli stand-in for the CDN edge, local HTTP/1.1, medians of 3
  interleaved runs, a host at 70-100% CPU from other programs): cold FCP 8,412 -> 5,960 ms, ready 8,825 -> 6,337 ms, KB before ready 1,371 -> 1,048, repeat visit with the first visit complete 1,263 -> 310 KB and
  ready 6.2 -> 2.8 s (with the tool's 6 s settle the second visit still pulls the piano samples the first had not finished: ready 6.2 -> 3.1 s, 1,727 -> 1,168 KB of which 810 are samples), desktop ready
  892 -> 442 ms. Not reached: cold FCP <= 4.0 s and ready <= 5.0 s: before the first paint the phone must receive the 306 KB page and 514 KB of scripts (gzip) at 200 KB/s, 4.5 s of its own; the rest of
  the distance is code that is not needed to draw Home (arranger and recording modules, about 190 KB gzip) and the page itself - a code-splitting job, not one of (a)-(d).
  CLS (cold, desktop viewport, same throttling, HTTP cache on, medians of 3, origin/main -> this PR): ko 0.138 -> 0.005 (phone viewport 0.007 -> 0.006), ja 0.006 -> 0.009, zh 0.005 -> 0.012, en 0.031 -> 0.023.
  TBT is NOT comparable between the two: the branch's first paint is 2.5 s earlier, so work that main does later (the engraver's first drawing, ~0.5 s at 4x) now falls inside the tool's observation window.

**G13-3 as built (notices and the YouTube posture, PR "G13-3" #265; U9 decided by the user on 2026-10-13; reviewed, then amended).**
- *Decision (U9):* keep YouTube transcription; **add a notice** - "use recordings you have the right to use; the score is for your own practice" - where a link is entered and in About; **do not allow posting
  a score made from a YouTube link to the public Shared Scores** (its link may still be sent, as today; private use is unchanged); default the PC worker to download on the PC (below: not a one-line default,
  so recorded, not changed). **U6 is still open:** the demo keeps its title "Interstellar Theme - Hans Zimmer - arr. solo piano". The served notices say (true) that its notes are a generated pattern; the note for
  whoever decides (`TODO(U6)`: rename in `buildDemoScore`, id stays `demo`, then replace that paragraph) is kept in `tools/notices/notices.json` (`demo.todo`) and is **not** written into the served file.
- *`THIRD_PARTY_NOTICES.md`* (root, served at `/THIRD_PARTY_NOTICES.md` as `text/plain` so a link shows it instead of downloading it; lists, not pipe tables, so it reads as plain text) is **generated** by
  `node tools/notices/build.js` (Node only; `--check` is the CI and light-job form; `--root DIR` reads another tree). It gathers, and states no fact the repository does not hold: every `## section` of
  `vendor/README.md` (VexFlow 4.2.3 MIT with its five music fonts - Bravura, Petaluma, Leland OFL-1.1, Gonville unrestricted, Custom MIT -, React and ReactDOM 18.3.1 MIT, the four Latin font families OFL-1.1:
  file, source, sha256, the licence file and its copyright line); the Salamander attribution paragraph of `audio/piano/README.md` **verbatim** (CC BY 3.0: author, licence link, source, the nine-second cut);
  `catalog/hymns` (Open Hymnal: "public domain or under free licences", one statement per file in the index, not checked tune by tune), every book of `catalog/method/index.json` (edition, licence; the 15 pieces
  of Czerny 40 and Burgmüller 25 that the benchmark quarantines are marked "per the dataset listing; the piece-level statement is under review", the composition is public domain, no promise is made),
  `catalog/index.json` and the seed library; the CDN list **read from the served code** (pdf.js, tfjs 2.8.6/3.21.0, Magenta.js, Basic Pitch, Babel standalone, the three Noto Sans families of Google Fonts, the Onsets
  and Frames checkpoint "see its own terms") and the sites the page contacts (the YouTube embed and oEmbed); `support.js` "no licence header, source not in the repo"; the **tools, models and packages**:
  Audiveris AGPL-3.0 (README.md), Kong Apache-2.0 (omr-service.js), Demucs MIT (tools/home-worker/README.md), the **SheetSage2 weights CC BY-NC 4.0, non-commercial use only** (sheetsage2_run.py,
  setup-sheetsage2.cmd) with MERT-v2-FullSong, YourMT3, TransKun, Aria-AMT, Beat This, PM2S, librosa/pYIN, Basic Pitch (Python), music21, PyTorch and the audio packages, huggingface_hub, yt-dlp, FFmpeg and the
  runtime dependencies pg, zod and @anthropic-ai/sdk - each "see the project's own licence" unless this repository states one (then the file that says so is named and read by `--check`); the demo; the YouTube
  paragraph, which says the real fallback: when YouTube refuses the server it asks the third-party site loader.to, which then receives the link.
- *Nothing served or run can go without a row* (`build.js --check`, mutation-tested): every file of `vendor/` named in `vendor/README.md`, every top-level entry with a `## section`, every font file with its family's
  OFL file and licence row, every licence file present; every package the served code names at jsDelivr / unpkg / esm.sh (pinned, or it fails), every `storage.googleapis.com` file, and **every http(s) host any served
  file names** (a host nobody has classified in `notices.json` `hosts`: a cdnjs script, a raw.githubusercontent.com file, a new module's URL fails; a host only in a comment does not), and a row whose package or
  host is no longer named fails too (G13-8 vendors a library: its row moves from `notices.json` to `vendor/README.md`); every pinned requirement of `requirements-*.txt`, every model a `setup-*.cmd` downloads and
  every runtime dependency of `package.json` in a helper row or an explicit omission (puppeteer is a devDependency); a licence a row states is checked against the file it names; the committed file equal to
  the generated one; the attribution paragraph names Alexander Holm, links the CC BY 3.0 licence and says what was changed. `tests/notices/notices.test.js` also fails if the pieces marked under review are
  not the ones `tests/bench/corpus/provenance.json` quarantines, or if the served file holds a TODO, an HTML comment, "not stated", a promise or a pipe table.
- *Settings > About & licences* (ko/ja/zh/en; the last card of Settings, so **one tap** from anywhere): the app and the build the server runs; "Your songs are saved only in this browser. PPP's server receives a
  song only when you share it or ask it to arrange or read it." (the first draft said they stay on the device unless shared: the page sends a whole score to `/arrange-score`, and audio, links and PDFs go to
  the server for transcription and OMR); the YouTube notice and the sharing rule; the CC BY 3.0 attribution of the piano sounds with links to the licence text and the source; the link to the notices file.
- *The notice at the point of use:* one line in the "From a YouTube link" box of the Add screen, above the link field (not a modal). Same text in About.
- *What "made from a YouTube link" means* (the page, `youtubeDerivedOf(songId)`): the notes were **transcribed from that link's audio** - `source.kind === 'youtube'` **and** notation inferred from audio
  (`inferredAudioNotation`: a transcription version, engine or AMT, and not `retrieved` / `referenceScore`; or - for a transcription saved before those stamps - an engine label such as "Basic Pitch" or
  "Piano Onsets & Frames", with the same two exclusions); or an **arrangement** of such a song (the Song Arranger's copy has `kind: 'arrangement'`, `parentSongId` and no YouTube link of its own: followed
  through `arrangedFrom` / `parentSongId`, and stamped `source.youtubeDerived = true` at creation); or a **copy somebody else added from a link** (the mark `source.youtubeDerived` travels in the shared
  score and is kept when it is added; a bare YouTube source does not make one). It is **not** a score whose `source.kind` is merely `'youtube'`: a hymn with a performance to watch, a public-domain score the
  app found by the link's title ("Found a public-domain score for this title"), or a score uploaded beside a video (`referenceScore`), or the person's own recording with a video link attached (kind `audio`)
  are posted as before. (First draft read `source.kind` alone and would have blocked the 100 hymns; `tests/hymns-share.test.js` caught it.)
- *The block:* the share dialog's Post button is **off** (and `aria-describedby` points at its reason) with one line of reason (Korean first); "Send a link" works as before; a share already posted can be taken
  down; `publishSong(id, true)` refuses too. `server.js` (`youtubeDerivedShare`) reads **only** the payload's `youtubeDerived: true` and the mark inside the score's source (what a stored copy carries): a public
  post (`listed: true`, an account) or a later `PATCH {listed: true}` of a stored score that carries it is **403 `{code: 'youtube-not-public'}`**, error text = the reason (a key of the catalogs, so the page
  shows it translated). Guest links are never listed and are untouched; a link send (`listed` left out) is untouched; a PATCH that changes nothing, and any take-down, are untouched; **shares already posted
  are not touched** (their number is not known and was not looked up). A share the page cannot recognise (not on this shelf) shows its Post button, and the server's reason when it is refused. The link of a marked
  share stays link-only: `shareMeta` answers it with `noindex` and no title or description (og:*, twitter:*), as a guest link has `noindex`.
- *Limits, said plainly:* it is a **policy guard, not a security boundary**: the server only knows what the client says, so a modified or older client can leave the marks out (the last test of
  `tests/youtube-share.test.js` asserts exactly that, and that the server does not guess from a YouTube link). Shares posted before this change carry no mark: they stay, and can be taken down and posted
  again. An arrangement made BEFORE this change whose parent song was removed from the library cannot be recognised, and a transcription whose engine label is none of the known ones (and has no stamp)
  is not. A re-send of the link of an already posted share updates its content while it stays posted (as today). A person can post an ordinary song and later send a changed one by link: the server cannot tell.
- *The PC worker's download (U9, "default to download on the PC"):* **not a one-line default, recorded not changed.** The worker's `ytdlpPath` is `''` (tools/home-worker/worker.js, `DEFAULTS`), so it asks the
  site's `/api/youtube-audio`; with a path set it runs yt-dlp on the PC and falls back to the site. A default of `'yt-dlp'` would need the worker to find the binary on the PATH (or in `tools/`), say plainly when
  it is missing instead of logging a failure per job, and every `tests/home-worker` fixture that builds a config to name its tool; `setup-*.cmd` would have to install it. Follow-up phase (small, tooling
  class): "auto-detect yt-dlp, prefer it, keep the site as the fallback".
- *Tests:* `npm run test:notices` (in the gate, shard-h: the generator and its 24 planted defects, `youtube-share.test.js` on this `server.js`), `npm run test:notices-mutants-node` (13 planted defects of
  `server.js` / `static-allow.js`, shard-h), `node tools/notices/build.js --check` (a shard and the light job), `tests/notices-ui.test.js` + the 18 page mutants (job `notices-suite`: Korean, a real account,
  the page's own arranger). `tests/static-allow.test.js` names the notices file as the one served root document; the i18n gaps checker stays at 0.

**G13-4e: code splitting - analysis (what Home needs before its first paint).** G13-4 ended with "the rest of the distance is code that is not needed to draw Home ... a code-splitting job". This is the evidence for that job; "G13-4e as built" below is what was done with it.

*How it was measured.* `git archive` of origin/main `adb9f3f` (= live `f64d06b`) served locally with a small brotli stand-in for the CDN edge in front of `server.js` (it brotli-compresses an identity answer and passes a gzip one through), `tests/live/perf.js phone` (150 ms RTT, 1.6 Mbps, CPU 4x, 412x823), puppeteer's Chrome, HTTP/1.1 on loopback; the host was at 60-100% CPU from other programs, so every number is a median of 3 runs of the two arms interleaved, good for comparing the arms and not an absolute. CPU shares come from a Chrome trace and a CPU profile of the same load.

*What the first paint waits for.* The head names 70 scripts: 1,628 KB raw, **518 KB gzip**. All of it is parser-blocking: `support.js` boots on DOMContentLoaded, after every head script has been fetched and run, and React renders Home after that. With the 306 KB page the phone must receive about 820 KB (4.1 s at 200 KB/s, the 1.6 Mbps of the profile) before DOMContentLoaded (4.8 s in the trace), then runs about 1.1 s of its own work (support.js boot 215 ms, the first React commit 909 ms, of which 561 ms is one layout) before the first paint at 5.9 s. Evaluating the 64 deferred files is NOT the cost: `EvaluateScript` of all of them is about 40 ms at 4x (their module bodies define functions; V8 compiles a function when it first runs). **The cost is their bytes: 443 KB gzip = 2.2 s on this profile.**

*Call graph: script -> first consumer -> needed when* (consumers found twice: by `grep` over the page, `lessons.js`, `course.js` and the scripts' own headers, and dynamically, by putting an accessor on every one of these globals and recording the stack of each read while the page booted, drew Home and opened every screen of the sidebar; `tests/load-app/split-reads.js` keeps that tool).

| Script(s) | gzip KB | First consumer in the page | Before the first paint? | Home? | Needed by |
| --- | --- | --- | --- | --- | --- |
| `i18n.js` | 4.1 | `tx()` at the app's module and class initialisers | **yes** | yes | everything; stays |
| `vendor/react*`, `support.js` | 66.4 | the runtime boot | **yes** | yes | stays |
| `course.js` | 3.6 | `PPP_COURSE.fresh()` in the initial state | **yes** | yes | stays |
| `score-search.js` | 2.1 | `PPP.ScoreSearch: window.PPPScoreSearch` in the page's `window.PPP` literal | **yes** (a read at boot) | no | My Songs search; kept: 2 KB |
| `library-backup.js` | 11.3 | `backupBoot()` (componentDidMount) - which only needs the note a restore leaves in `sessionStorage` - then Settings > My data | no | no | `backupMake`, `backupFileChosen`, `backupApply`, `wipeGo`, `backupVals` (Settings) |
| `scoregraph/*` (29 files; `index.js` builds `PPPScoreGraph` from ALL of them) | 217.8 | `ScoreView.paint` -> `loadEngrave()` (after the commit, async) and every importer: `PPPScoreGraph.importFile`, `.musicxml.import`, `.legacy.toScore` (`importToGraph`, MusicXML text, MIDI, the review screen) | no | the thumbnail's drawing, after the paint | any drawing; Practice, My Songs, Course, imports |
| `engrave/` head files (8: ledger ... index) | 38.1 | `ScoreView.paint` -> `loadEngrave`; `PPPEngrave.app.resolveSync/resolve/remember/forget` (import, practice 'graph' plan, difficulty, print) | no | as above | any drawing |
| `audio-score.js` | 40.9 | `PPPAudioScore.toMusicXml` (a recording), `.fromMidi` (a MIDI file), the review screen's rewrite of rhythm/bars | no | no | Add sheet music (MIDI, recording), the review screen |
| `playability/*` (5), `difficulty/*` (3) | 19.1 + 12.8 | only `PPP.fingering = 'inferred'` / `PPP.difficulty = 'g6'` (both default `'legacy'`), and as load-time dependencies of `realize` and `arrangement` | no | no | the arranger |
| `songgraph/*` (8), `arrangement/*` (4), `realize/*` (4) | 18.0 + 15.2 + 40.1 | `realizeWithG8` ('g8' only), `arrangeSingleNote` (the default: after `loadSingleModules` -> `loadScoreModules()`) | no | no | Song Arranger, the review screen's easier version |
| `lessons.js` | 28.4 | `PPP_LESSONS` in the Learn screens (`learnLessonObj`, `learnInput`, ...) | no | no | Piano Basics |

*Findings that shape the build.*
1. **Nothing in the deferred set is needed before the first paint.** The boot trace shows four reads of the page's lazily-wanted globals before Home is drawn: `PPPScoreSearch`, `PPP_I18N` and `PPP_COURSE` (all kept), and `PPPBackup` in `backupBoot()`, which only needs the note a restore leaves in the session (it now looks for the note first). Home's thumbnail goes through `ScoreView.paint -> loadEngrave()`, which is already asynchronous and already has a loader that waits for the modules (`loadScoreModules`, the recovery of a failed head script); until the drawing is there the view says "Engraving...". So **Home draws without any of the 443 KB**, and the thumbnail is the first consumer.
2. **The score library cannot be split further without changing it.** `scoregraph/index.js` freezes `PPPScoreGraph` from every module (`pro-*`, `gaps`, `meter-grid`, the MusicXML and MIDI readers/writers: 218 KB), and the engraver's own files read `PPPScoreGraph` at load. A thumbnail needs a fraction of it; making `index.js` tolerant of missing modules would be a change to a library with 700 Node tests that the page's behaviour does not need. Left whole: one group.
3. **Consumers are few and already gated.** Every importer and the arranger go through `loadScoreModules()` (App 5473, 5901, 5928, 5995, 9087, 12440), a function that exists to "retry the head's own list" - the awaiting loader needed here is that function, taught the new groups. The reads that are not gated (`PPPEngrave.app.*` in `engraveRemember`/`engraveForget`/`practiceStamp`/print, `window.PPPBackup` in Settings, `window.PPP_LESSONS` in render) run after a person has done something, never at boot.
4. **The head scripts are not all independent**: `songgraph`, `realize`, `arrangement`, `playability` and `difficulty` read `PPPScoreGraphModules` (and each other) when they LOAD; `engrave/` reads `PPPScoreGraph` when it loads; `audio-score.js` reads it only when called. Groups keep the order of the head, and say what must have run first.
5. **Not deferred, and why:** React, `support.js`, `i18n.js`, `course.js` (read at boot); `score-search.js` (a read at boot; 2 KB); the page itself (306 KB: its inline app code is compiled by the runtime from the document, one piece).
6. **Server side nothing has to change but one line in the allowlist.** The lazily loaded groups can stay in the head's own tags (the served page rewrites every `<script src>` of the head to `?h=<hash>`, G13-4c), so they are immutable and gzip like the others. The existing lazy lists (`SINGLE_SCRIPTS`, `RECORDING_SCRIPTS`, ...) are asked for by `?v=N` and are `no-store` today (the edge compresses them); they are 185 KB and 70 KB raw and are used only when arranging or converting a recording: left as they are, said so in the as-built section.

*Expected gain, from the arithmetic of the trace and checked against a first build:* 443 KB of 820 KB leave the path to DOMContentLoaded: about 2.2 s of 5.9 s. A first build moved FCP 5.85 -> 3.57 s (-39%), far over the "stop if < 10%" line of the task, so the build went on.

**G13-4e as built (code splitting).** Each part is its own commit and reverts alone; with `PPP.split = 'off'` (or `?split=off`) the page is the one before G13-4e.
- *`lazy-load.js`* (new, 1 file, ES5, no dependencies; Node tests drive it with a fake window). The head names 64 deferred files in six `<noscript data-ppp-lazy="group" data-after data-globals>` blocks (text, so a browser that runs
  scripts requests nothing for them, preload scanner included; the served page rewrites their `?v=N` to `?h=<hash>` like any head script, G13-4c, so they are immutable and gzip): `backup` (library-backup.js), `score` (scoregraph/, 29 files),
  `arranger` (playability, difficulty, songgraph, arrangement, realize: 24, after `score`), `audio` (audio-score.js, after `score`), `engrave` (the engraver's 8 head files, after `score`), `lessons` (lessons.js); G11a-5 added a seventh, `practice` (practice/plan.js, the default player, after `score`, in the wave of `audio`: `WAVES` is now `[lessons, backup] [score, engrave, engravePage] [practice, audio] [arranger]`). The order of the
  blocks in the head is the order the scripts always had; a one-line `PPP_LAZY.here()` follows each. *on* (the default): the block is registered and its globals become accessors. Nothing is asked for until the page has painted
  something (the first contentful paint, then one task; a background tab: after 1 s; no paint timing: after a frame), then a group is asked for by `PPP_LAZY.ensure(names)` (all its files by `fetch`, run in the
  written order, one file per task so no long task is made of them, dependencies first) or by the idle prefetch (`start()`, called by the app's first mount). The downloads go out in *waves*, whoever asks for them (the prefetch
  or an `ensure`; a small scheduler, at most 32 in flight, the better group first): (0) `lessons` + `backup`, 39 KB, alone - what a tap in the first seconds reads - then (1) `score`, `engrave` and `engravePage` (the fifteen
  drawing files, a group the page makes up at run time with `PPP_LAZY.define`: Home's thumbnail), then (2) `audio`, then (3) `arranger`. A file of a wave is asked for when the files of the wave before it are in (an answer
  that has not begun after 2 s no longer holds the waves behind it), and the groups run in the same order as they arrive, so the thread is never shared between the drawing of the thumbnail and what comes after it. A read that cannot wait
  (the safety net below) is not held behind a wave, and its download holds the waves behind it until it is in. *off*: the block is written back with `document.write` where it stands (parser-inserted, same order). Stand-in: an inline line after the script tag that makes every
  block write itself back if lazy-load.js cannot be fetched. A browser with no fetch gets *off*.
- *The choice* (the PPP.cdn / PPP.recording idiom): `?split=on|off` for this visit, the value remembered in `localStorage['ppp.split.v1']`, then the default (`on`, one constant in lazy-load.js); anything else, a storage that throws
  included, is no choice. `PPP.split` reads what this load did; assigning remembers (any other value forgets). Test switch: `?splitStart=0` / `localStorage['ppp.splitStart']='0'` keeps the idle prefetch from starting.
- *The page's use of it* (all behind `lazyOn()`; with `off` every line is what it was): `scoreModulesReady` reads through `PPP_LAZY.peek` (a readiness check never starts a download); `loadScoreModules` asks for the four groups (a
  failed file is asked once more at once with `&retry=<stamp>`, the rule of the old recovery, so the scoregraph-recovery test is unchanged); `loadEngrave` asks for `score` + `engrave` + `engravePage` only (the fifteen files main asked for at once), so Home's thumbnail is not held behind
  the arranger and audio-score.js; a file import (`importToGraph`) and a method-book piece (`openCoursePiece`) ask for the library and the engraver's source first (`needScoreGraph`; a MIDI file also for audio-score.js), which
  `warmRecordingModules` on the Add screen had only made likely; `backupBoot` looks for the restore's note in the session before it asks for the module; the piano recordings wait for the prefetch (cap 7 s, with the CJK stylesheet) - also the ones a tap or a key wakes (`PianoSamples.loadAfterCode`: thirty downloads of 1.3 MB on the first tap would take the line from the
  read that tap makes; a tap measured 4.4 s before this). The synthesized stand-in sounds until they are in, as it always did.
- *Safety net.* A read of a deferred global that comes before its group is in does not see `undefined`: the accessor loads the group (and what it needs) synchronously, once (`XMLHttpRequest`, its downloads started in parallel
  first so the one-by-one asks are answered from the cache they fill; 0.2-1.0 s on the phone profile for backup .. arranger), and the read is in `PPP_LAZY.status().syncLog`. Where the page needs it: two screens, by design - Piano Basics (lessons.js, 28 KB) and Settings (library-backup.js, 11 KB) open at once, as they always did, and
  the read they make while drawing loads the file when the prefetch has not brought it yet (they are the first wave of the prefetch, alone on the line, so that this is only a tap in the first second after the first paint;
  *measured* below: 0.4-0.9 s, not the "0.2-0.5 s" first written here, which was for a prefetch that had them third and fourth and had not been measured with the line in use) - a gate on the tap
  would have made the screen open later than a test's fixed wait. The synchronous request is deprecated by Chrome (a DeprecationIssue "Synchronous XMLHttpRequest on the main thread" in DevTools' Issues, once, for a visit that taps in
  that first second): it is the net under a caller that did not ask, not a path to build on - the callers that can ask do, and a test that sees one fails (`syncLoads`). Everywhere else the suites see 0 (`syncLoads` is asserted in `tests/load-app/split.test.js`; every suite listed in the PR was also run with the prefetch off). A refused synchronous load answers `undefined` and is not repeated for 5 s.
- *Server*: `lazy-load.js` added to `static-allow.js`. Nothing else: the blocks are rewritten by the existing head rewrite.
- *Not done, and why.* (1) `SINGLE_SCRIPTS` / `RECORDING_SCRIPTS` / `RECORDING_OPTIONAL_SCRIPTS` (rec/, candidates/, critics/, repair/, weights) stay `?v=N`, no-store, edge-compressed: they are used only when a person arranges
  or converts a recording (185 KB raw), never on the path to Home, their loaders and their tests (`single-note-app` asserts their urls and request counts) are exact, and a manifest of ~60 hashes in every page (or a second
  fetch) buys a repeat arranger about 50 KB. A follow-up if it is wanted. (2) `scoregraph/` is one group (see the analysis). (3) The engraver's first drawing (one task of about 425 ms at 4x, 140 ms of it V8 compiling the
  engraver) and the first React commit (about 900 ms at 4x, 540 ms of it one layout) are the page's own work; they are what is left of "longest boot task" and TBT.
- *Tests.* `tests/load/lazy-load.test.js` (41, Node: mode choice, off, registration, ensure order/sharing/failure/retry, safety net, paint gating, prefetch order, the waves and the bound on downloads in flight, non-enumerable globals); `tests/load-app/split.test.js` (20, browser: nothing deferred before
  the first paint and no synchronous load; the page the same; off; PPP.split; Home's thumbnail with the group held; Practice, MusicXML and MIDI import, a method-book piece, the arranger, Piano Basics and Settings right after load with the
  prefetch off or a group held 5 s; a tap that wakes the sound with the arranger held; a group that cannot be fetched is the app's own message and is asked again; the stand-in); `tests/load/content-hash.test.js` (the blocks are hashed); 40 mutants `L1-L13`, `L15-L29`, `S1-S4`, `S6-S8`, `S10-S14`
  (`node tests/load/mutants.js`, all killed). `tests/single-note-app.test.js` counts the requests that are not the arranger's: the files of the lazy groups are not among them (they come when the prefetch or an ask brings them, before the test's marker or after it). `tests/engrave/tools/with-port.js` takes `PPP_SPLIT=on|off` and `PPP_SPLIT_START=0` and reports the synchronous loads of a suite. CI (slower runners than this PC, tests that act the moment the page is ready) found four things, each now a test or a mutant: a gate on the tap for Piano Basics (removed: the screen must open at once), a file import that relied on the Add screen's warm-up having brought audio-score.js (it asks, `needScoreGraph`), a guard that read the engraver before it looked at what the song was (`engravePersist`), and a namespace object that the group's first file makes and the rest fill, which a read between two files handed out half built (a read of any global of a group that is not all in completes it, L21). It also found one thing the split changes for a test, not for the app: `tests/practice/switch-page.js` probes took `app.state` before an `await` and mutated it after, and React replaces the state object on every `setState`, which Home's thumbnail (drawn later now) makes at an arbitrary moment; they take it after the wait.
- *Measured* (this branch against a `git archive` of origin/main `adb9f3f` served in the same session, both behind the brotli stand-in, `tests/live/perf.js phone` through a local HTTP/1.1 server, the two arms interleaved; the host
  was at 60-100% CPU from other programs, which inflates absolute numbers and spreads TBT and the longest task; medians):

  | phone profile, cold | origin/main | this PR | budget (section 11) |
  | --- | --- | --- | --- |
  | first contentful paint, 5 runs (final code, interleaved) | 5,856 ms (5,828-5,872) | **3,548 ms** (3,528-3,584) (-39%) | <= 4,000: **met** (5 of 5) |
  | app ready, same runs | 6,114 ms (6,056-6,143) | **3,763 ms** (3,727-3,796) (-38%) | <= 5,000: **met** (5 of 5) |
  | the same on a busy host (60-100% CPU of other programs), FCP / ready | 6,200 / 6,495 ms | 3,864 (3,704-4,356) / 4,077 (max 4,620) ms | met in 4 of 5 / 5 of 5 |
  | KB before ready | 1,008 | **547** | <= 1,200: met (it was already) |
  | requests before ready | 93 | 18 | |
  | total blocking time (after FCP; 5 runs: 324-358 vs 328-342) | 333 ms | 329 ms | <= 300: **not met**, not changed |
  | longest long task | 784 ms | 774 ms | <= 500: **not met**, not changed |
  | desktop, FCP / ready (3 runs) | 420 / 402 ms | **380 / 290 ms** | not worse: **met** |
  | repeat visit, second visit: ready; KB other than piano samples | 1.8-2.2 s; 1 KB | 1.7-2.5 s; 1 KB | <= 3,000 ms: met; <= 450 KB: met apart from the samples (as in G13-4: the fixed 6 s settle ends a faster first visit earlier, so more samples are left for the second) |

  *Home's engraved thumbnail is not earlier* (5 interleaved runs, phone profile, cold): over an HTTP/2 stand-in 6.93-6.95 s on main, 7.19-7.24 s here (+0.25 s); over HTTP/1.1 with six connections 7.02-7.12 s on main, 7.99-8.07 s here
  (+0.95 s; production is HTTP/2 behind Cloudflare, measured with `http2.connect`, so the first is the one that applies). What moved is everything before it: the page is up 2.3 s earlier and the thumbnail is drawn where it was.
  Why it cannot be earlier: the drawing needs 403 KB after the first paint (the library 214, the engraver's source 38, its fifteen drawing files 151) and a main that asked for everything before the paint has the line idle for
  1.7 s of its own CPU-bound start (3.5 - 5.2 s) in which the thumbnail's files could have been coming; this build asks after the first paint, as it must for the first paint to be early. What was tried and what it gave (each 3-5
  runs): all groups at once with eight in flight (thumbnail +0.35 s, lessons 1.4 s after the paint); sixteen / thirty-two in flight (thumbnail +0.05 / -0.05 s, lessons 2.2 / 2.7 s after the paint: a file waits
  in a share of the line that is one in the number of downloads; sixty-four, with the first wave alone, was no better than thirty-two); the fifteen drawing files in the same wave as the engraver's own (as built: -0.3 s); lessons and backup first, alone (as built: +0.2 s on the thumbnail, lessons in
  at 0.7 s after the paint); lessons and backup in the head as plain scripts (FCP +0.25 s, rejected, the first paint is the number the budget is about); a wave let go when the one before it has begun to answer, with the line
  fair between the streams (thumbnail at parity, lessons 2.5 s after the paint, so a tap in that time waited behind fifty streams - 1.6 s; rejected). Pages (DOM) are identical to origin/main on Home, Practice and Settings
  (`tests/load-app/dom-identity.js`, en-US desktop and ko-KR phone, `?split=on` and `?split=off`).
  *What is left of the two budgets that are not met* is not code that can be deferred: the first React commit is one task of 800-940 ms at 4x of which about 540 ms is the page's first layout (on this Windows PC about half of it is
  the font-fallback lookup of the three Noto families that are not installed: with the font stack replaced by Arial the same layout takes 215 ms - a property of this host and of G13-4b's font stack, not of the code), and the
  engraver's first drawing, 425 ms at 4x (140 ms of it V8 compiling the engraver), which runs after the first paint in both builds, so TBT counts it in both, with the 78 ms idle task of the CJK-font probe (head, G13-4b).
  *The first tap on Piano Basics or Settings* (review of this PR: a tap at "ready" took 1,161 ms / 600 ms against 169 / 140 ms on main, because the screen's render reads `PPP_LESSONS` / `PPPBackup`, which are 28 and 11 KB behind
  the prefetch, as a synchronous request that waits in the line behind what is in flight). Measured with `tap.js` (phone-class line 1.6 Mbit/s, 150 ms, CPU x4, a desktop-size window, the tap N ms after the first contentful paint,
  3 runs, time from the tap to the screen's own content; main: Piano Basics 0.15-0.17 s, Settings 0.28-0.32 s at any time):

  | tap after the first paint | 0 ms | 300 ms | 600 ms | 1,000 ms |
  | --- | --- | --- | --- | --- |
  | Piano Basics, HTTP/2 stand-in | 0.86 s | 0.61-0.65 s | 0.14-0.63 s | 0.13-0.16 s (= main) |
  | Settings, HTTP/2 stand-in | 0.76-0.78 s | 0.58-0.60 s | 0.27-0.30 s (= main) | 0.27-0.29 s (= main) |
  | Piano Basics, HTTP/1.1 | 0.70-0.72 s | 0.39-0.40 s | 0.15-0.18 s (= main) | 0.13-0.15 s (= main) |
  | Settings, HTTP/1.1 | 0.56-0.58 s | 0.27-0.30 s (= main) | = main | = main |

  So: from one second after the first paint a tap costs what it costs on main; before that it waits for one request of the size of the file (a round trip, 0.15 s, and the file) - 0.4-0.9 s on this line, against
  1.2 s measured in the review, and up to 4.4 s with the first build that put the two files first (before the two fixes below). Two causes were behind the long ones and are fixed: (1) the first tap wakes the sound (`PianoPlayer.wake`), which asked for the thirty recordings
  (1.3 MB) at once and put them in the line in front of the read - they now wait for the code, like the idle path's (`loadAfterCode`, mutant S14); (2) the other 52 files of the thumbnail went out the moment the read
  made its group urgent and took 50 shares of the line - an urgent download keeps holding the waves behind it (L23). The floor that is left is the request itself: the 0.3 s target of the review is met for Piano Basics from 0.6 s (HTTP/1.1) /
  1 s (HTTP/2) after the first paint and for Settings from 0.3 s / 0.6 s, not before, unless lessons.js and library-backup.js are in the head (FCP +0.25 s) or fetched before the first paint, which competes with the bytes the first paint is waiting for on a line
  that is shared fairly (as this stand-in's is; a priority-aware edge might not make it cost, and a `<link rel=prefetch>` for the two files is the next thing to measure there - not possible with the local stand-ins).

**G13-4b2 and G13-7b as built (PR "G13-4b2 + G13-7b"; U7 and U5 decided by the user's blanket go-ahead of 2026-10-15, as recommended).** Two parts, each its own commits, each reverts alone.

*G13-4b2: Korean, Japanese and Chinese text in the device's own fonts (U7).*
- *The stack.* `--ppp-cjk` (a custom property of `:root` in the head's style block) is the list the page's font stacks use after Figtree: the body rule, the sign-in and app shells and the three SVG stacks of `lessons.js` are now
  `Figtree, var(--ppp-cjk), system-ui, sans-serif` (the Noto family names are gone from them). It is chosen by `<html lang>` (`:root:lang(ja)`, `:root:lang(zh)`; i18n.js sets it): Korean first for ko and en (Malgun Gothic,
  Apple SD Gothic Neo, Noto Sans CJK KR), Japanese first for ja (Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic UI, Meiryo UI, Meiryo, Noto Sans CJK JP), Chinese first for zh (PingFang SC, Microsoft YaHei UI, Microsoft
  YaHei, Noto Sans CJK SC, Hiragino Sans GB); the two other languages' fonts follow, so a Japanese title in a Korean page is drawn; Noto Sans KR/JP/SC - installed, or the web face - is **last**: it is reached only for a character
  no earlier family has. Family names, not `local()`: the names are looked up lazily, for a character no earlier family has, and a missing one costs one failed lookup, once. A page of a Japanese user used to get Korean
  glyph shapes for the kanji (Noto Sans KR came first for every language); it now gets its own. *Weights:* Malgun Gothic has Regular and Bold only (500 draws as 400, 600 as 700); Noto Sans had four.
  **The Windows Korean look changed:** the same text in Malgun Gothic is 5-11% wider than in Noto Sans KR at the same size (measured with canvas on this PC, five UI strings: 1.048-1.106), so a line wraps a little
  earlier. Review of #274 asked for it to be recorded; it is U7's stated risk ("Malgun Gothic"). With it, `:root:lang(ko) body { word-break: keep-all; overflow-wrap: anywhere; }`: Korean breaks at spaces, so
  the lone syllables a narrow screen left on a line ("반복해 / 요.", "구 / 간을", "도우 / 미") are gone - measured on Home, My Songs, Practice and Settings at 360, 412 and 1440 px: lone-syllable lines 11 -> 0 and no overflow, no
  clipped text (`anywhere`, not `break-word`, because it lowers the min-content width: no flex or grid item grows past the screen). Not done: the "→" that wraps alone on Home at 360 px (not Hangul).
- *What is asked of Google, and when.* The head script (`PPP_CJK_SETTLED` is still there: it resolves at once when nothing is wanted, else shortly after the first stylesheet) decides per script (ko, ja, zh) whether the
  device can draw a sample (`한글가나`, `あア日本`, `汉字简体`): in a canvas at `32px sans-serif` - i.e. whatever the system falls back to, so no list of names has to be right - each character must **measure**
  (width and the box of its ink, `actualBoundingBox*`) otherwise than U+D7FC, a code point no font has, which every browser draws as the same "no glyph" box. *The width alone is not enough:* on this Windows PC the
  box of a missing character is itself 32 px wide at 32 px, exactly a kana's width (found when the first build asked for Japanese and Chinese on a PC that has Yu Gothic and Microsoft YaHei). A script the device cannot
  draw gets its own stylesheet (one family a request, 4 weights, `display=swap`, ~110 KB of CSS instead of 331 KB), after `load` and an idle moment: the page's own language first, alone; the others 1 s after it has
  settled, and not on a data saver (`navigator.connection.saveData`); a language change in Settings (a `MutationObserver` on `<html lang>`) asks for that script then if it was not asked for. No canvas, or any doubt
  (a character that measures as the box), means "has none": the web font is asked for, as it always was. Nothing here shadows an installed font any more (the web face is only added where there is none).
  In a page whose language has no script of its own (English) nothing is waited for: `PPP_CJK_SETTLED` is resolved at once, so the piano recordings (G13-4d) do not wait for a stylesheet that is only for a title in another
  language (`tests/load-app/samples.test.js` drives a Korean page for that reason).
- *No connection hint.* The helmet's two `preconnect` and one `dns-prefetch` to Google Fonts (G13-4b) made every device open two connections to that site at boot. They are now `<meta name="application-name">`,
  `<meta name="referrer">` (the header's own value) and `<link rel="license" href="./THIRD_PARTY_NOTICES.md">`: three elements that fetch nothing and contact no one, so the template keeps its element count and no
  `data-dc-tpl` stamp of the DOM moves (`tests/load/fonts.test.js`). `THIRD_PARTY_NOTICES.md` says the Noto Sans families are fetched "only on a device that has no font of its own for that script".
- *Measured* (this branch against a `git archive` of origin/main `610d97e` = live `fab0ba3` + docs, served in the same session, both behind a brotli stand-in for the edge (quality 5), `tests/live/perf.js`'s phone
  profile - 150 ms RTT, 1.6 Mbps, CPU x4, 412x823 - and a 1440x900 desktop window, real Google Fonts over the real network, the two arms interleaved, medians; this PC was shared and busy, so absolute numbers
  are inflated and the FCP differences below are inside the noise - what is exact are the bytes and the requests; CLS is summed over the load and 9 s after the app is ready, input-free shifts only):

  | phone profile, ko-KR unless said (5 runs each, interleaved) | arm | first contentful paint | app ready | CLS | requests to Google Fonts / KB | KB before ready |
  | --- | --- | --- | --- | --- | --- | --- |
  | **this PC as it is** (Windows 11, Malgun Gothic; Noto Sans KR happens to be installed, so main asks for JP and SC only) | origin/main | 4,148 ms | 4,433 ms | 0.0060 | 2 / 244 | 480 |
  | | this branch | 4,136 ms | 4,514 ms | 0.0064 | **0 / 0** | 484 |
  | the same, ja-JP (3 runs) | origin/main | 3,940 ms | 4,297 ms | 0.0073 | 5 / 296 | 480 |
  | | this branch | 4,080 ms | 4,377 ms | 0.0092 | **0 / 0** | 483 |
  | the same, 1440x900 desktop, no throttling | origin/main | 380 ms | 439 ms | 0.0016 | 2 / 244 | 604 |
  | | this branch | 348 ms | 432 ms | 0.0009 | **0 / 0** | 594 |
  | **no CJK font at all** (emulated: canvas answers that no font draws CJK; the branch's copy has every system family of `--ppp-cjk` renamed to one that is absent, so its text can only use the web face) | origin/main | 4,040 ms | 4,229 ms | 0.0153 | 30 / 511 | 480 |
  | | this branch | 3,976 ms | 4,143 ms | 0.0155 | 32 / 512 | 484 |

  *Reading it.* On every device that has a CJK font - Windows, macOS, iOS, Android, ChromeOS, a Linux with any CJK font - the page makes **no request to Google at all** (2-5 requests and 244-296 KB before, plus the
  connection hints): the text is in the device's font from the first paint, so there is no swap and no stylesheet or font file to wait for. First paint, ready and CLS are the same within the run-to-run spread
  of a busy PC (the 0.0092 / 0.0073 of the ja-JP row is 3 runs; CLS of Home is 0.006 either way). A Windows PC *without* Noto Sans installed is the common case this is for, and it could not be reproduced on
  this PC (shadowing an installed family by a face that cannot load does not hide it: Chrome falls back to the installed font of that name; the harsher try, with `local()` faces, made main 0.9 s slower to first
  paint, which is that emulation's own lookup cost and is not reported as a gain): what is known is that main's probe then says "not installed" and asks for all three families and the slices its text uses -
  30 requests, 511 KB in the runs above (also in two other emulated runs) - and swaps the text from the system's font to them, where the branch asks for nothing.
  *What did not change:* a device with no CJK font at all gets the same Noto Sans as before - the same bytes (511 / 512 KB, the slices dominate), one stylesheet a family (the page's language first, ~110 KB of
  CSS instead of 331 KB, the other two a second later: two requests more, as measured), so there is no saving in bytes - only that the stylesheet of the page's language is a third of the size and comes first.

- *The probe's own cost* (the idle task after load; it replaces the named-family probe of G13-4b, which asked canvas about three families that a device mostly does not have): in an empty page on this PC, three
  scripts, five fresh pages each, 57-59 ms before and 38-43 ms now (most of it the system's one-time font-fallback set-up, which the page has paid at its first Korean text by then: a second probe is 0.7 ms).
- *Tests.* `tests/load/cjk-detect.test.js` (12, Node: the script run in a vm against a model of a device whose box is as wide as a glyph - all three, none, one script, saveData, no canvas, a language change,
  the order of the requests), `tests/load-app/cjk-fonts.test.js` (9, browser: the same decision in the real page on models, and this machine's own fonts: a Windows or macOS PC asks for nothing and the Korean
  text is in Malgun Gothic / Apple SD Gothic Neo), `tests/load/fonts.test.js` (the stack, the shells, no hint to Google, the helmet's element count); mutants `B4 B5 B8-B12` and `F1-F9` (`node tests/load/mutants.js`).

*G13-7b: anonymous counters (U5; G13-D11's "browser counters").*
- *What the page counts* (the inline head script `PPP_COUNTS`, in the head and not in a lazy group: a release that breaks the boot never loads a lazy group, and that is the visit that most needs counting; 6.2 KB raw with its comments, the fonts script 4.3 KB (it was 2.8 KB): +3.1 KB brotli on the 340 KB page, 340,255 -> 343,338 bytes measured through the brotli stand-in): per visit, in the page's memory - uncaught errors by CLASS (`type` TypeError, `reference`, `range`, `syntax`, `load` = a `<script>` or `<link>` of THIS site that did not load, `thirdparty` = one of another site's (Google Fonts blocked, a CDN down, a blocker at work: expected noise, kept apart so `load` means what the
  release checklist says), `other`; never the message, stack
  or address; an error from a browser extension is not the page's), unhandled rejections, the engraver's fallbacks by code (`PPPEngravePage.stats.fallbacks`, read through `PPP_LAZY.peek` so reading never loads a group),
  the practice plan's fallbacks by reason (`PPP.practiceStats.practiceFallback.reasons`), lazy groups with `failed` (`PPP_LAZY.status()`), the first contentful paint and the app's first mount (`PPP_COUNTS.ready()`, one line in
  `componentDidMount`) in buckets `<2 s`, `<4 s`, `<8 s`, `>=8 s`, `none` (not reached when the page was left), the language (ko ja zh en) and mobile or desktop. Each count is capped at 20 a page.
- *What is sent, when.* One `fetch('/api/stats', { method: 'POST', body, keepalive: true, credentials: 'omit', cache: 'no-store' })` (`navigator.sendBeacon` where `keepalive` is missing) when the page is hidden or closed
  (`visibilitychange` to hidden, `pagehide`); again at a later hide only if something new happened (the deltas), **at most 5 a page load**. A visit with nothing to say sends its timing and nothing else. A code
  the server has no name for (an engraver or practice reason added later) is summed into `other` here, so a body never passes 1 KB (a 413) whatever the engraver says.
  **It is never the request that wakes a sleeping server** (review of #274; G13-D11 rejected an uptime ping for exactly this: ppp-web is on Render's free 750-hour pool and a request wakes it for 15 more
  minutes). Practice is client-side, so a quiet 15-minute session leaves the instance asleep and the closing tab would have started it. The page therefore tracks the last time THIS origin answered it over the
  network - `PerformanceObserver` (`resource`, buffered) and the navigation entry, same-origin and `transferSize > 0` (an HTTP-cache hit is not a contact), clocked with `performance.timeOrigin`, so a laptop
  that slept counts the sleep - and sends only when that was less than 10 minutes ago. Otherwise the body (the very bytes it would have sent, nothing else) is kept in `localStorage['ppp.counts.pending.v1']`:
  an array of `{t, b}`, at most 3, none older than 7 days, none from the future, none over 1,000 characters (anything else is ignored when read); and 4 s after the NEXT visit's app is ready - its own load has
  just proved the server awake - they are posted (3 at most, then removed). Turning the counters off removes them at once; a person who turned them off, or Do Not Track, finds them dropped, not sent. No
  timing API, or a page the cache served and the network did not answer, is taken to be cold: kept, never sent. The body, at the worst (every class and code
  at its cap) 474 bytes (tested under 1 KB), is fixed keys: `{"v":1,"b":"<build>","loc":"ko","mob":0,"pv":1,"fcp":1,"rdy":2,"err":{"type":1},"rej":1,"eng":{"PLAN_THREW":1},"prc":{"NOT_READY":3},"lz":1}`. `b` is the build
  stamp the server put in the page (`window.PPP_BUILD`): a page of another build than the server's is counted as `stale` and the string is never kept. No cookie, no header, no identifier, no address, no title.
- *Off.* Settings > About & licences has the sentence (ko/ja/zh/en via `tx()`) and one switch, `data-counts-toggle` (`aria-pressed`; the label is the same in both states, the line under it says what is so):
  `localStorage['ppp.counts.v1'] = '0'` is off, no key is on (the default, U5); `navigator.doNotTrack === '1'` (or `'yes'`), `window.doNotTrack`, `msDoNotTrack` and `navigator.globalPrivacyControl === true` are off too and the
  switch says so; a storage that cannot be written keeps the choice for the visit. When off nothing is sent, however much happened. **"Delete everything on this device" (G13-6) keeps this key** while it is `'0'` (review of #274: the wipe turned the counters
  back on): `library-backup.js` `wipe` leaves it, does not count it as `left`, and reports it as `report.kept`; the delete note says so in four languages; the waiting counts
  (`ppp.counts.pending.v1`) go with everything else. "0 ppp* keys left" of G13-6 is now "0 ppp* keys left but a person's opt-out". Not claimed: what the host (Render, Cloudflare) keeps in its own request logs - the About sentence speaks of the counts.
- *The server* (`client-stats.js`, new; `server-stats.js` + one route in `server.js`). `POST /api/stats` is read after `/health` and before everything else: another site's `Origin` (or the string `null`) is 403; one address
  may send `PPP_STATS_BEACONS` (default **300**: a classroom or a campus behind one address; each beacon only adds capped numbers) in ten minutes, then 429 `Retry-After: 600` (the address is a keyed hash made new at every start, `homeJobs.addrKey`: an IPv6 address is its /48, held ten minutes in a map of at most
  5,000 keys; the machine itself - the socket, loopback, no proxy header - is not limited); the body is read by `body-reader.js` (1 KB, 8 KB drained, its structure bounded as it arrives: 160 tokens, 8 containers, depth 3)
  and refused 400/413; `sanitize` takes only the whitelisted keys of the right kind (an unknown key is dropped, an unknown error class or code is `other`, a count that is not a whole number is dropped, a bigger one is 50,
  `v` must be 1, prototype keys do nothing); the answer is `204`, `Cache-Control: no-store`, no body, **no `Set-Cookie`**. Nothing is stored; no database; GET/PUT of the route stay 404 (no route serves the numbers). The server sees the connection's address while it answers and, for the limit,
  holds a keyed hash of it in memory for ten minutes; nothing else keeps it (the About sentence says "has to see your connection's address for a moment, but it stores nothing").
  **Its own route class** `api-stats` (review of #274: a bad body, another site's Origin or a limit are by design and come from browsers): its 4xx and 429 are in `by["api-stats"]` and NOT in the totals `4xx`
  and `tooMany` that the release checklist reads as alarms; its 5xx (a bug of ours) and store errors still are.
- *The hourly line* (G13-7a's `stats:` line, unchanged in everything it had) gains one key, `client`, only when a beacon arrived in the window - numbers only, fixed keys, ~60 numbers of memory:
  `stats: {"v":1,"windowS":3600,...,"by":{...},"client":{"beacons":41,"visits":38,"stale":0,"mobile":22,"desktop":16,"withErrors":2,"locale":{"ko":30,"ja":1,"zh":0,"en":7},"fcp":{"lt2":25,"lt4":9,"lt8":3,"ge8":1,"none":0},"ready":{"lt2":20,"lt4":13,"lt8":3,"ge8":1,"none":1},"errors":{"type":3,"reference":0,"range":0,"syntax":0,"load":1,"other":2},"rejections":1,"lazyFailed":0,"engrave":{"PLAN_THREW":2},"practice":{"NOT_READY":14}}}`
  (that example is made up; the shape is the code's). Read it with `render logs -r srv-dalt5s6k1f9s739cuetg --limit 500 -o text --confirm | grep stats:`. A window with only beacons prints a line too.
  What to look at after a deploy: `errors` (not `thirdparty`) and `load` against `visits`, `engrave`/`practice` codes other than `NOT_READY`, `lazyFailed`, `ready.none` and `ge8`, `stale` (pages that did not reload after the deploy).
  A visit may be counted by a later page's beacon (the kept ones), up to a week late.
- *Tests.* `tests/load/counters.test.js` (32, Node: the head script in a vm against a fake window and a fake clock - classes, once, at most 5, buckets, opt-out, DNT/GPC, storage that throws, peek, 1 KB for any code,
  nothing throws, and the cost rule: a session quiet for 25 minutes keeps instead of sending, any same-origin network answer in the last 10 minutes lets it send, a cache hit or another site does not, the kept
  counts go with the next visit, expire, are bounded, follow the person's choice); `tests/load-app/counters.test.js` (12, browser: a thrown error counted once with none of its text, a rejection, off in storage,
  Do Not Track and its note, the switch (on, off, on) in English and Korean, no cookie, the server's line end to end, a 20-minute session kept and sent by the next visit, `load` against `thirdparty`, 5 a page,
  the wipe keeps the opt-out and says so); `tests/client-stats.test.js` (in `npm run test:monitoring`: the whitelist, caps and bad bodies on fake data; the real server.js: 204 and no cookie,
  400/413/403/404/429, stale, the line, the route's own class, 300 an address); `tests/backup/library-backup.test.js` P9 (the wipe keeps the opt-out); mutants `K1-K26`, `B14 B15` (`node tests/load/mutants.js`),
  18 new in `node tests/release/mutants.js` and 4 in `tests/backup/mutants.js` (all caught). `client-stats.js` is not served (`static-allow` has no rule for it; `tests/static-allow.test.js` lists it).

---

**G13-8 as built (the optional libraries are PPP's own; PR "G13-8").** Each part reverts alone; `PPP.cdn` (`?cdn=1`, or `localStorage['ppp.cdn'] = '1'`: the switch React already has) puts the CDN addresses back.
- *What is vendored* (`vendor/README.md` has a section for each: where it came from, size, sha256, the npm tarball's integrity, the licence; the Apache-2.0 texts travel with them; none of the five packages has a NOTICE file):
  pdf.js 3.11.174 (`pdf.min.js` 377,116 B, `pdf.worker.min.js` 1,133,660 B, the "legacy" build the page used), TensorFlow.js 2.8.6 (`tf.min.js` 1,167,497 B), Magenta.js 1.23.1 (`transcription.js` 218,041 B), TensorFlow.js
  3.21.0 (`tf.fesm.min.js` 1,069,735 B) and Basic Pitch 1.0.1 (`esm/index.js`, `inference.js`, `toMidi.js`, 18 KB; `model/model.json` 174,537 B and its one weights file 742,392 B). **4.8 MB raw added to the repository** (about 1.5 MB
  on the wire, gzip, and only for the person who uses the feature). Every file is byte for byte the published one: the six that jsDelivr served (the four code files and the two model files) were also compared with what the page loaded
  on 2026-10-15; the licence texts of TensorFlow.js and Magenta.js are not in the tarballs and are the repositories' `LICENSE` files at the version's tag (Magenta's has had one commit, 2018).
- *Identity:* `tests/engrave/vendor-optional.test.js` (in `test:engrave`, so in the gate) checks every file's sha256 and size against the README, that the README names every file and no other, the licence texts, that the
  page's `?h=` values are the files' own and that the CDN address that remains is the same package and version; with `PPP_VENDOR_ONLINE=1` (or `node tools/notices/verify-tarballs.js`) it downloads each tarball from the registry,
  checks its sha512 against the recorded `dist.integrity` and that each file is the one in it.
- *Spike (U-K4): Basic Pitch needs no bundler, so it is vendored too.* Its published `esm/` build is three plain ES modules that import `@tensorflow/tfjs` and `@tonejs/midi` by bare name and each other without ".js". A page-level
  **import map** (added once, by the page, the first time the path is used: it makes no request) maps `@tensorflow/tfjs` to the 3.21.0 flat ES module, and `./inference` and `./toMidi` to the files with their extension. The one part
  that is not a published file: **`@tonejs/midi`** (its npm build is a UMD bundle, not an ES module) is a one-line stand-in that throws if used - Basic Pitch imports it only for `generateFileData`, which PPP never calls. A browser
  without import maps (Safari before 16.4, Chrome before 89, Firefox before 108) or a file that cannot be fetched falls to esm.sh as before (nothing is worse than it was). **tfjs 3.21.0 is the package's `dist/tf.fesm.min.js`,
  not the UMD `tf.min.js` the plan named**: an ES module cannot import a UMD file, and a second UMD `tf` would overwrite the 2.8.6 one in `window.tf`. U-K4 is answered: yes, as files; the model weights of Basic Pitch (742 KB) are
  vendored too, so that fallback needs no network at all.
- *The page* (`PPP_LIBS`, `pppWantsCdn`, in the import module's part of `Piano Coach App.dc.html`; the head is untouched): each library is asked for by its content hash (`?h=`, 10 URLs, immutable, gzip) when its feature is used and
  never at boot; the weights file has its own hash (`weightUrlConverter`, `.bin` is now in `HASHABLE`); a vendored file that cannot be fetched is asked for once at its CDN address. `PPP.cdn` = the CDN addresses only.
- *What stays at another site (U8):* the Onsets and Frames **checkpoint** (about 60 MB, `storage.googleapis.com`) and the Google fonts of Korean, Japanese and Chinese (G13-4b). The page says so where a recording is chosen ("Reading a
  recording in this browser needs an internet connection (the piano model is about 60 MB)", four languages) and, when the download fails, with "The piano model could not be downloaded. Reading a recording in this browser needs an
  internet connection ..." (code `model-offline`) instead of a bare "Failed to fetch"; the import then goes on with Basic Pitch, which works offline, and the review screen says the piano model did not run.
- *A bug found on the way, fixed here:* the two TensorFlow.js versions share two page globals (`window._tfengine`, `window._tfGlobals`) and the tensors find their engine through them at every use, so the second to load reused the first's
  WebGL backend and kernels and failed on its first shader ("Failed to compile fragment shader"). **Basic Pitch never worked after an Onsets and Frames attempt in the same page** (the "fallback" of the code), on the CDN path as
  well (measured on `?cdn=1` with the real CDN). Each library is now loaded with those globals set aside and the one about to run is put in place (`pppOwnTf`, `pppUseTf`); both orders work (tests).
- *After the independent review of the PR (supply chain, concurrency):*
  - **One TensorFlow.js section at a time.** The swap of the two engine globals (`pppOwnTf` / `pppUseTf`) had no mutual exclusion: a load while the other library ran, or two runs at once (reachable: `cancelImport` is
    cooperative, so a cancelled import goes on in the background while a new one starts), swapped the globals under each other and gave silently WRONG notes (Basic Pitch 20 against 10 notes, Onsets and Frames 86
    against 8) with `ok: true`, or died with "reading 'backend'" and stayed wrong. Now every section that touches TensorFlow.js - load, model start, run, dispose - of both libraries runs inside `pppTfLock`
    (a promise-chain mutex, released in `finally`, in the order asked). A request that waits sees its own cancel (100 ms poll) and gives up after 3 minutes (`busy`); a section looks at its cancel flag between
    its steps (before a chunk of Onsets and Frames, between two batches of Basic Pitch; a cancelled Onsets and Frames import does not fall to Basic Pitch), so a cancelled import lets the next one in at its next step.
    The restore of the previous globals after a load was redundant (every use puts its own in place) and is gone. Tests: `tests/load-app/tf-lock.test.js` - the real Basic Pitch and a stand-in for `transcription.js`
    that works with the real TensorFlow.js 2.8.6, sequential runs in both orders as the reference, then both loads together, both runs together, 300 ms and 1.5 s apart in both orders: every result is the reference's, note
    for note; cancel of a holder, of a waiter, of Basic Pitch mid-run; mutants T1-T8 in `tests/load/mutants.js` (no lock, a load outside it, no cancel check, a give-up that releases at once, ...).
  - **`model-offline` is only a failed download.** Any `initialize()` failure was reported as "needs an internet connection". Now the checkpoint's `weights_manifest.json` is asked for after a failure: unreachable or
    not 2xx is `model-offline`; a checkpoint that answers and a model that still does not start is `model-failed` ("The piano model could not be started in this browser. Reload the page and try again."), and
    `fallbackReason` follows.
  - **A PDF reader without its worker is not a reader.** The worker's address is asked for (HEAD) before the library is handed out; a missing vendored worker is taken from the CDN too (counted), a worker that is nowhere
    says "Could not reach the PDF reader" instead of "That PDF could not be opened - it may be corrupt", and a failure is not cached in `_pdfjs`.
  - **SRI on the CDN copies.** The CDN `<script>` of pdf.js, TensorFlow.js 2.8.6 and `transcription.js` has `integrity` (the sha384 of the published file, which is the vendored one) and `crossorigin`; the worker (started by
    pdf.js) and the `import()` of the esm.sh / jsDelivr `+esm` builds cannot have one, and `PPP_LIBS` and the README say so.
  - **`PPP.libFallbacks`** (read-only): `{ pdfjs, 'tfjs-2.8.6', 'magenta-music', 'basic-pitch': n }`, the times PPP's own copy could not be fetched; `{}` on a healthy site and under `PPP.cdn`. The browser suites assert it, and
    `tests/live/smoke.js` reads a PDF with the live site's own pdf.js and checks it is `{}`. It is also one more key of the G13-7b anonymous counters (`lib`: the same four names, `other` for another, capped like
    every count; the hourly `stats:` line carries `client.libFallbacks` when any arrived), so a quietly failing vendored file is seen on the server without waiting for a complaint.
  - **What the files have compiled in.** Besides the five libraries, the vendored files carry: core-js 3.32.2 (both pdf.js files, MIT), core-js 3.6.5 + seedrandom 2.4.3 + regenerator-runtime (TensorFlow.js 2.8.6, MIT),
    seedrandom 3.0.5 (MIT) + long 4.0.0 (Apache-2.0) (TensorFlow.js 3.21.0), and in `transcription.js` protobufjs 6.x (BSD-3-Clause), buffer (MIT), ieee754 (BSD-3-Clause), base64-js, fft.js, ndarray-resample and the
    packages it uses (MIT). Each is a row of an "Embedded" table in `vendor/README.md` (name, version, licence, copyright, where from, how it is known to be there), the texts are in `vendor/LICENSE-embedded.txt`,
    `THIRD_PARTY_NOTICES.md` lists them, and `build.js --check` fails for an embedded package without its text; `tests/engrave/vendor-optional.test.js` lists the notices each file carries and fails when one appears or goes.
    Versions the bundles do not state (protobufjs, buffer, ieee754, base64-js, fft.js, ndarray-resample, regenerator-runtime) are given as the range the package asked for and say so.
- *Measured (2026-10-15, headless Chrome with SwiftShader, a local server, this branch):* with every other host refused a generated vector PDF is read and notated (pdf.js and its worker from `vendor/`, 2 requests, immutable), the
  Onsets and Frames code starts and ends in the clear "needs internet" message (the one request that goes out is for the checkpoint), Basic Pitch hears a four-note recording with no network at all and gives the same four notes,
  and a whole import with the checkpoint refused ends in Basic Pitch with `fallbackReason: 'model-offline'`; 0 requests to jsDelivr, unpkg, esm.sh or cdnjs on every one of those paths.
  **Identical notes:** (1) a generated recording through both paths (`PPP_REAL_CDN=1`, the real CDN and the real Google checkpoint): Basic Pitch 5 notes and Onsets and Frames 4 notes, equal in pitch, onset, offset and velocity;
  (2) two of the G10 browser-model fixtures (`tests/bench/replay-of/`: `catalog/fur-elise` 18 notes, `hymns/take-my-life` 116 notes), re-rendered with `of_prepare.py` and read by the page on the vendored path and on `?cdn=1`: the two
  paths gave **bit-identical** note lists (same sha1 of the JSON) on this machine; against the notes stored in the fixtures on 2026-10-02 the counts, pitches, onsets and offsets are equal and 2 and 11 velocities differ by 1 -
  the CDN path on this machine differs from the stored fixture in exactly the same notes, so that is the machine (software GL), not the vendoring. Not compared: the other 18 fixtures (each is 1-2 minutes of software GL).
- *Notices:* `tools/notices/build.js` reads the five sections (title, "Used for", the copyright as the files carry it); the four CDN rows of `notices.json` became "way back" names, so a vendored library that the page also names at a
  CDN needs no row of its own; `THIRD_PARTY_NOTICES.md` says which libraries come from another site now (Babel standalone, never requested; the Noto Sans of Korean/Japanese/Chinese; the checkpoint). The mutant that planted a
  `pdfjs-3.11.174` folder with no row uses another name now (the folder is real).
- *Smoke and perf:* `tests/live/smoke.js` checks that each vendored file named in the page is served by hash and immutable (the loader falls back to the CDN silently, so a missing file would otherwise go unseen);
  `tests/live/perf.js offline3p` counts requests to every code CDN, not unpkg alone.
- *Tests:* `tests/load-app/vendor-optional.test.js` (browser, own server, in the `test:load-app` job: 9 cases; a tenth with `PPP_REAL_CDN=1` needs the network), `tests/static-allow.test.js` (the one `.bin`, the maps and binaries that are not
  served), `tests/load/mutants.js` C10 follows `HASHABLE`.

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
 counters (U5): POST /api/stats (counts, G13-7b) -> in-memory, one log line/hour, 0 SQL
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
| 4 | **G13-3 Notices** *(built; U9 decided and in, U6 pending: see "G13-3 as built")* | `THIRD_PARTY_NOTICES.md` (generated by a small script from `vendor/README.md`, `audio/piano/README.md`, `catalog/*/README`, and the CDN list until vendored); Settings > "About & licences" (4 languages) with the CC BY line for Salamander, the OFL fonts, MIT/Apache code, catalogue sources; the YouTube rights notice text decided in U9; the demo renamed as decided in U6 (its id stays `demo`, so saved sessions line up). | app (a Settings section), docs | 1 | every row of E8 appears; the CC BY attribution is reachable in ≤ 2 taps; a test fails if a `vendor/` folder has no row | revert |
| 5 | **G13-4 Load performance** | (a) fetch only the active locale's catalog (others on switch); (b) Latin fonts self-hosted (Figtree, Instrument Serif, JetBrains Mono, Noto Music: OFL woff2 of the used weights) and CJK per U7 (non-blocking); (c) content-hash caching of every script and catalog (G13-D4), plus a measured spike on the template re-fetch (`support.js:159`): if the DOM-parsed template draws identically on every screen and suite, set `window.__resources = {}` to drop the second 329 KB; otherwise keep it and record why; (d) piano samples start after first paint (the synth stand-in already covers a note before they arrive). Each sub-item is its own commit in one PR, or split if review asks. | server.js (static), app head, i18n.js | 2 | phone cold: **FCP ≤ 4.0 s** (8.8), **ready ≤ 5.0 s** (9.3), **transferred before ready ≤ 1.2 MB** (2.99 MB); repeat visit **≤ 450 KB** (~2,000-2,300) and **ready ≤ 3.0 s** (7.0); desktop not worse; byte-identical DOM on Home/Practice/Settings | each sub-switch; revert |
| 6 | **G13-5 Server hygiene + Shared Scores** | Served-path allowlist and headers (G13-D16); signup limiter; `GET /api/shares` paginated (`limit`/`cursor`, 24 per page) and the Shared screen drawing previews as they scroll into view. | server.js, app | 1-2 | `/server.js`, `/docs/*`, `/render.yaml`, `/package.json` → 404; **the 121 own requests of a cold load all still 200** (from `perf.js`'s list) and every browser suite green; Shared screen **DOM ≤ 3,000 nodes** (14,636), **heap ≤ 60 MB** (89) on the phone profile | revert |
| 7 | **G13-6 Backup and delete** | Settings > "Back up my songs" (one `.ppp-library.json.gz`: library, slots, state; graphs optional) and "Restore from a backup" (merge rules of section 7.5, never deletes); "Delete everything on this device" (library, slots, state, ppp-engrave, ppp-media, guest key, PC link; asks twice). | app | 1 | round trip: 30 songs out and in on a fresh profile, identical slots byte for byte; a restore never removes a local song; the deletion leaves 0 `ppp*` keys and 0 PPP IndexedDB databases | revert |
| 8 | **G13-7a Monitoring and release** | `.github/workflows/live-smoke.yml` (daily 06:00 KST + manual; read-only `smoke.js`; opens an issue on failure); `tools/release/release.js` (G13-D12); server in-memory counters (requests, 5xx, store errors, by route class) in one hourly log line. | CI, tools, server.js (counters only) | 1 | a planted 5xx shows in the hourly line; the release script refuses a commit whose gate is not green (tested against the GitHub API with a red commit) | revert; disable the workflow |
| 9 | **MX-3a / MX-3b** | Delete `buildXml` + `legacyWriter` (Node + 4 tests); delete `LEGACY_IMPORT` and its 3 branches. | audio-score.js; app | 0.5 + 0.5 | `ab` identical on every suite; browser suites green | revert |
| 10 | **G13-8 Vendor the optional libraries** *(built; U-K4 answered: see "G13-8 as built")* | pdf.js + worker; tfjs 2.8.6 + `transcription.js`; tfjs 3.21.0 `dist/tf.min.js` + basic-pitch (spike first: a single-file ESM or UMD build is needed; if basic-pitch has none without a bundler, keep that one path on jsDelivr and say so: U-K4). Model weights per U8. | app, vendor | 1-2 | PDF import and browser transcription work with jsDelivr/esm.sh blocked (weights excepted per U8); identical notes on the G10 browser-model fixtures | `?cdn=1` |

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

### 7.7 Abuse analysis (what a stranger with no account can do; one test per row - the G12-5 table, with its three review rounds built in from the start)

Everything a stranger can do with no account is "make a library" (free, bounded) and then whatever a library of their own may do. Each row names its bound as built and the test
that holds it (files in `tests/sync/`; `sync.test.js` = unit, `sync-abuse.test.js` = abuse, `server.test.js`, `sync-pg.test.js` = Postgres twin; mutants `S L I Q R B P K M N G C T O` are in
`tests/sync/mutants.js`: each breaks the rule of its row and the test must fail).

| Threat | What stops it (as built) | Tested by |
| --- | --- | --- |
| a request with no code, or a code in a query, a body, a cookie, a bearer header, another site's header | `401 no-lib` before anything else is read: **no body is read** (a PUT that announces 4 GB and sends nothing is answered at once); none of those is a code | unit "who may ask", "long answers"; mutants S1, S13 |
| a page of another site, or a script with a stolen code | `403 cross-site` BEFORE the code is read (an `Origin` that is not this host, `null` too), reads as well as writes; CORS closed: no `Access-Control-*` on any answer, a preflight fails; no cookie is read or set | unit "who may ask"; `server.test.js`; mutants S3-S5, S12, S15 |
| guess a code | 256 random bits made by the server; only `sha256('ppp-lib-v1:' + code)` is stored; the **whole hash** is compared in constant time (a row found by the id alone is refused); a wrong code is `401 bad-code`, counted per address (an IPv6 /48 is one), **20 an hour then 429, failures only**: a valid code is never refused for other people's wrong ones; the code of a library that was rotated or deleted is told so (`401 rotated` / `deleted`) and not counted | unit "who may ask"; mutants S2, S6-S11, S14 |
| read or change another library's items | an item is addressed by (library, key): the library is in every statement; a name only another library has is answered **byte for byte** as a name nobody wrote (read: `missing`; delete: 404); a write to such a name is a plain new item (no conflict that would say it exists) | unit "isolation"; Postgres "the store's own guards"; mutants I6-I10 |
| make libraries (a library is free) | **5 an hour and 20 a day per address (IPv6 as /48), 100 an hour for the site, 2,000 live**; at the cap `503 busy`: nobody is evicted; counted from the rows (a restart does not forget); a deleted library counts two days (making and deleting is no way round); a new code is not a new library; the place is taken before anything is awaited (12 at once: exactly 5) | unit "making libraries", "races"; mutants L1-L7, I14 |
| store data (bodies are gzip JSON of the song shape: not a file store) | **16 MB a library, 48 MB an address, 128 MB the site, 3,000 rows a library, 60,000 the site**; a row costs 256 bytes besides its body; a batch that does not fit is refused whole, `503 quota` (library, address, rows) or `503 busy` (site); **refuse, never evict**: what was kept is read back unchanged; a replacement that is smaller is taken at the cap; a tombstone is a row until it is purged | unit "what a library may hold"; mutants Q1-Q12 |
| write amplification (Neon: every byte is also WAL and history) | **240 items an hour a library, 60 deletions an hour, 120 write requests an hour a library and 480 an address** (counted whatever came of them); bytes accepted: the site 64 MB an hour and 128 MB a day, **a quarter of each for a library and for an address**; conflicts give their places back | unit "rates", "bytes in and out"; mutants R1-R4b, B1-B5, B8 |
| read amplification (Neon egress) | **300 items an hour a library**; bytes sent: the site 64 MB an hour and 150 MB a day, a quarter for a library and an address (**what an answer may weigh at the most is reserved BEFORE the database is asked** and the difference given back after - six at once cannot all pass a look at the budget before any is counted, which served 34.5 MB against a 2 MB share in the review; the one answer that crosses a budget is served, the next is `429 share`, Retry-After); **a page of `changes` is charged by what it weighs** (500 rows are 84 KB) and looked at before the database is asked; 6 answers with bodies at a time, an answer holds at most 6 MB of bodies (the rest `deferred`), a reader that does not take its answer in 120 s is cut and its place freed | unit "bytes in and out", "long answers"; abuse "what the site sends"; unit "the position a device is given, what a page of changes costs ...", "a hung store does not freeze the writer"; mutants R7, B6, B7, B9-B12, N4, N5, P21-P23 |
| **a JSON body that is small in bytes and huge in objects** (G12-5's blocker: 16 MB of `[{},{},...]` is 5.6 million objects, 357 MB of heap) | the structure is counted **as the bytes arrive** (`jsonGuard`: tokens, containers, depth outside strings) on every body - a batch has 25 items, 33 containers - and **again over the unpacked bytes of every item** (a container per 16 bytes at the most, 24 deep); both before anything is parsed. Child process, 200 MB heap: 5.9 MB of `{}` refused in 38 ms, a 6 KB gzip of 2 million `{}` in 54 ms, heap +0 MB, loop gap < 150 ms; an item AT the bound parses in 190 ms and peaks at 68 MB | abuse "the shape of a body" (child); unit "what an item must be"; mutants P1-P3 |
| **a body sent one byte at a time** (G12-5's second review: 1.4 million writes held ~350 bytes each) | the one reader of the site (`body-reader.js`): chunks coalesced as they arrive; 900,000 one-byte writes: heap 7 -> 7 MB in a child capped at 200 MB | abuse "the shape of a body" (child); mutant P25 |
| **a slow sender holds the places** (G12-5's slow-loris: 311 s each) | a body has **60 s in all and 10 s without a byte** (408, the connection closed); places for a body being received: **1 a library, 1 an address, 8 the site**, taken before the first byte and given back whichever way the request ends; the unpacking of items is a separate ceiling of 2 that no sender can hold | abuse "the time of a body and the places for it"; mutants P15-P20 |
| a zip bomb | `gunzip` with `maxOutputLength`: **8 MB an item, 16 MB a request** (413); 1 MB of gzip an item and 4 MB a request; 512 MB of zeros in 510 KB of gzip stops at 8 MB in 0.7 s with the heap flat; only a gzip stream is taken (zlib and raw deflate are 422) | unit "what an item must be"; abuse (child); mutants P4-P7 |
| text that cannot be kept or made to look like something else | a NUL or a lone surrogate (Postgres cannot keep them), nesting past 24; an item is a **song** (`v card score progress graph scoreHash savedAt` and nothing else; the score is a score: measures and notes) or the `state` object (64 fields at most); names are `state` or `song:` + 64 characters of `A-Za-z0-9_.:-` | unit "what an item must be", "items"; mutants P8-P14 |
| two writers, or one writer twice | one writer at a time (a queue of 24, then 503); a write names the revision it saw: **the statement re-checks it** (a revision never goes backwards, no lost update, whatever the caller got wrong); a retried delete is `200 already` | unit "races"; Postgres twin (260 random calls x 6 seeds, both stores, same answers); mutants I1-I5 |
| **a device is handed a position past rows it was never given** (review, major: `changes` read the library's revision after its awaited query, so a write that committed meanwhile was skipped for ever) | the revision an answer is about is read ONCE, before the store is asked; the position handed on (`nextSince`, `maxRev`) is the highest of that revision and the last row listed, never a number read later; a write that commits during a fetch is in the next answer (a store that answers slowly, a write in between) | unit "the position a device is given"; mutants N1 |
| **a device that was away** (tombstones are purged at 30 days; a stale device would push deleted songs back, and a write over a revision of a row that is not there would bring one back unasked) | the library keeps the highest revision it purged (`purged_through`, a column, carried over by a new code, `GREATEST` in the purge statement): `changes` answers `tooOld: true, purgedThrough` to a device whose `since` is below it, and the device must ask before it pushes; a write over a revision (> 0) of a key that is not there is a conflict `gone` (409, nothing written, the others of the batch applied) and says again with base 0 to bring the song back; a retried write whose answer was lost is `409` with the server's metadata and the same hash: that is "applied" | unit "a device that was away"; Postgres "the store's own guards", the twin; mutants N3, G1-G4, K12-K14 |
| **a store call that never comes back** (a hung Neon connection would hold the one writer, and so every write of every library) | every store call has a time-out (15 s) and a query of the real store has its own (10 s, node-pg drops the connection that hung): a call that does not answer is a `503 store`, the memory is read again, the writer goes on to the next write; a read gives back what it reserved | unit "a hung store does not freeze the writer"; Postgres "server.js ..." (a table locked by another session: 503 after 1.5 s, then served); mutants T1-T4, B12 |
| a leaked code | full read and write of that library. Remedy: **change the code** on any device (the old code is dead at once: `401 rotated`); delete the library; **60 deletions an hour**, tombstones kept 30 days, `deletions` in every answer so a device asks before removing more than a few; the backup file and every device's own copy stay. An attacker who changes the code first would lock the owner out of the library: so a library has a **recovery code**, a second 256-bit secret shown once at creation (`POST /api/libs/recover`, header `X-PPP-Recovery`): it can **only** give the library a new code (and a new recovery code, it is used up), never read or write an item; only its hash is stored (its own domain); a wrong one is `401 bad-recovery`, counted with the wrong codes of the address (20 an hour) and a right one shares the 5 an hour of changes of code. It is a second key to the library: whoever has it can take the library over, so it is to be kept as the code is (and an attacker who has only the code cannot lock out the owner who kept it) | unit "changing the code, and deleting the library", "the recovery code"; mutants R8, R9, C1-C8, K15 |
| a lost code (every device cleared) | the recovery code, if it was kept, gives the library a new code; with neither it is unrecoverable and the library expires 180 days after its last use ("kept until" is in every answer); an empty library 14 days after its last use | unit "the keeping times", "the recovery code"; mutants K1-K3 |
| the database filled by what nobody can read any more | tombstones 30 days, deleted libraries two days, libraries 180 days, empty ones 14: ONE statement, at the boot read and at a write (at most every 6 hours, none when memory says nothing is due); item rows no library names are found at the boot read and deleted; the operator sees the libraries by size with `tools/sync-admin/list.js` (read only, refuses a database that is not on this machine without `--allow-remote`, shows no item name and no hash) and removes one with `delete.js --id lib_... --confirm` (one statement) | unit "the keeping times", "the operator's tools"; Postgres "statements", "the operator's tools"; mutants K4-K11, O1, O2 |
| the idle poll keeps the database awake | `changes` with the revision the device already has is answered from memory: **0 statements** (100 polls); a device that says it is AHEAD of the library costs one select of the library's own row per poll and is told `reset` only after it (a restored database or a second process is not read from a stale cache); the first request after a boot is one round trip; a library's use is written at most once a day | unit "an idle poll"; Postgres "statements" (counted, and in the database's own log); mutants R6, R10, R11, N2 |
| the free database made to fail the site | the tables are made only with the flag, in their own transaction under an advisory lock and a savepoint: a failure switches the feature off (503 `store`, `disabled`) and leaves the site and the PC queue as they were; a store that fails mid-write is a 503 and the memory is read again | Postgres "server.js ... the feature is optional"; unit "a restart, and a store that fails"; mutants M1-M5 |

**Residual risks, said plainly.**

1. **Three addresses can fill the site's 128 MB** (48 MB each) and keep it full by using their libraries once in 180 days. Every write of everyone is then `503 busy` until an operator
   deletes those libraries (no eviction: G13-D8) - the owner's songs stay readable. The same shape as the PC queue's 64 MB, with a cap that is kept for months. Choices for the Lead:
   a lower per-address cap (16 MB makes it eight addresses), a larger site cap, a way to delete a library by its id (`tools/sync-admin/delete.js`, 7.9; no route; `list.js` shows them by size and by address tag).
2. **Neon compute.** A route that touches the database can be used to keep it awake, as `/api/shares` already can; the new routes need a code and cost nothing when idle, but a
   stranger's own library may ask for changes 120 times an hour. Not preventable by a rate.
3. **The budgets, the places and the limits are in memory.** A restart (a deploy, or Render's sleep after 15 idle minutes) forgets them: a patient attacker gets the hourly number per
   restart cycle. What a restart does not forget is what is IN the tables (libraries made, bytes and rows held, counted from the rows).
4. **Eight addresses with a library each can hold all eight places for a body for 60 s** at a time (six answers for 120 s): sync writes are then `503 busy` for everyone else in
   those windows; no memory is at risk (a stalled body holds the bytes it has sent).
5. **One instance.** Two instances would keep every row right (the SQL re-checks the revision) but their counters could drift and their limiters would be separate. Not supported, as for the queue.
6. **A device offline for more than 30 days misses deletions** (their tombstones are purged). The server now says so (`tooOld: true`, `purgedThrough`; a write over a revision of a row that
   is gone is a conflict `gone`), but the page (S1) must act on it: ask before it pushes songs the library does not have after such a gap.
7. **Two people behind one address** (a school, a family) share an address's quarter of the budgets and its 48 MB; one abuser there uses it up for the others.
8. **An item at the structure bound** takes ~190 ms of the event loop to parse and peaks at 68 MB of heap; two at once (the ceiling) are 136 MB. Everything at its ceiling at once is
   about 300 MB above the idle 60 MB of an instance with 512 MB: not measured as a whole.
9. **What Neon keeps of a deleted or rewritten body** (history for point-in-time restore) counts toward the plan in a way that was not measured; the ingress budgets are what bound it.
10. **Twenty addresses use up the site's hundred libraries an hour** (5 an hour each): for that hour nobody can make a new library (`429`); libraries that exist are not affected.
11. **A first sync is slow by design.** 500 songs of about 20 KB (9.3 MB, measured) are written at 240 items an hour: 240 at once, 240 an hour later, 20 an hour after that - **the
    device waits 2 hours** (the limiter's windows are an hour; it follows `Retry-After`); the second device reads 300 an hour: 300 at once and 200 an hour later - **1 hour**. Listing
    the 500 items is one answer of 84 KB (charged to the read budgets: a library's quarter of an hour is 16 MB, so it costs 0.5 %). A person with 100 songs is synced in one go.
12. **The recovery code is a second master secret** (it can take the library over by giving it a new code): kept as the code is kept. A person who loses both has lost the library.
13. **A wrong recovery code is counted with the wrong codes of its address** (20 an hour): an attacker on a shared address can use up that address's count and so delay the people on it
    who made a typing mistake - failures only: a right code or a right recovery code is never refused for other people's wrong ones.

### 7.8 Phases (Track B)

| Phase | What | Effort | Acceptance | Rollback |
| --- | --- | --- | --- | --- |
| **G13-S0 Server** *(built: 7.9)* | `sync-store.js`, `sync.js` (routes), migration, limits, purge, in-memory rev cache; **routes 404 unless `PPP_SYNC=1`** | 2 + full and security review | unit + Postgres tests in the G10b-2 style: **100 idle `changes` polls = 0 statements**; old/new/rollback boots identical; every limit of 7.3/7.7 mutation-tested (target >= 60 mutants; 145 built, all killed); a zip bomb refused; cross-library isolation | `PPP_SYNC=0` (default); revert boots on the migrated DB |
| **G13-S1 Page** | Settings section, `#lib=` pairing, upload/migration, pull/push engine, merge rules, conflict copies, recently-deleted, bulk-delete check; behind `PPP.sync` (off), 4 languages | 3 + full review | two puppeteer contexts against a local server: **30 songs migrate**, edits converge after ≤ 2 opens, a concurrent score edit forks with both kept, a 17-song deletion asks, offline edits push later, **SQL statements per session ≤ 4**; with the switch off the page is byte-identical to main | switch off |
| **G13-S2 Graphs travel** | the graph in sync items and (optional field) in shares; the reader prefers it when `scoreHash` matches | 1.5 | an imported song with ties/tuplets/8va opens on the second device with the same `fingerprint` as the first (not projected); old shares open unchanged | ignore the field |
| **G13-S3 On by default** | the Settings section visible for everyone (the H-13 two-device run first) | 0.5 | H-13 sync steps pass | hide again |

Accounts (U4): unchanged in S0-S3. The account progress blob (0 rows) is left as it is; folding accounts into
libraries is not proposed.

### 7.9 G13-S0 as built (Implementer, Sonnet, 2026-10-15)

Worktree `D:/PPP-g13s0`, branch `g13-s0-sync-server` from `origin/main` `610d97e` (= live `fab0ba3` + docs). Server only; the page is S1. **Nothing was deployed or merged.**

**Files.** `sync-store.js` (the two tables, the migration, a Postgres store and a file store with the same methods), `sync.js` (the routes, the limits, the in-memory libraries, the purge, the
gauge), small wiring in `server.js` (the flag, the store, the tables at the boot, one route), `server-stats.js` (`addGauge`: a block of numbers and the class `api-sync`, only when the
feature is on), `home-jobs.js` (one word added to its exports: `byteWindow`). The body reader and `jsonGuard` of G12-5 are used as they are. Tests in `tests/sync/`, run by
`npm run test:sync` (a part of `npm test`) and, in the gate, by a shard of its own (`shard-q` in `.github/workflows/bench.yml`: every other shard is already at 190-217 s). The operator's tools are `tools/sync-admin/{list,delete}.js` (sharing `lib.js`); they are not
loaded by the server.

**The flag.** `PPP_SYNC=1` mounts it. Without it: the routes are 404 like any unknown path (the same body), the modules are not even `require`d, no table is made, the boot says nothing and the
hourly line is what it was (no `sync` block, no `api-sync` class). With it: the boot line "Song sync: on ...", the tables, the routes, the block in the hourly line. Env: `PPP_SYNC_TOTAL_MB`
(128; 4..400), `PPP_SYNC_KEEP_DAYS` (180; 14..730), `PPP_SYNC_INGRESS_MB_HOUR/DAY` (64/128), `PPP_SYNC_EGRESS_MB_HOUR/DAY` (64/150), `PPP_SYNC_QUERY_MS` (10000; 1000 at least: the time-out of
one query of the store).

**The tables** are made by `sync-store.js` `migrate`, in a transaction of their own under advisory lock 727003 and a savepoint, **not inside `homeJobsStore.migrate`'s transaction** as 7.2 said:
that function and the boot SQL that the Postgres tests of the queue extract from `server.js` stay byte for byte what they were, and the two parts are independent (a failure of one does not turn the
other off). `CREATE ... IF NOT EXISTS` only; no foreign key. As built: `ppp_sync_libs (id, client_hash, created_at, last_used_at, created_ip_tag, revoked_at, rotated_from, bytes, items, tombs, max_rev, purged_through, recovery_hash)`
(7.2's, plus `tombs`: `items` counts live items, `tombs` tombstones, `bytes` is the **accounted** size - every row 256 bytes plus its body; `purged_through` the highest revision of a
tombstone that was purged; `recovery_hash` the hash of the recovery code, nullable) and `ppp_sync_items (lib_id, key, rev, deleted_at,
content_hash, device, bytes, body, updated_at)` with the index on `(lib_id, rev)` and a partial one on `deleted_at`. **Boots** (`sync-pg.test.js`, real `server.js` processes on production-shaped
data): main -> PR with the flag unset: schema and every row identical; PR with the flag: the schema differs only by the two tables (22 columns, two primary keys, five indexes); rollback (main
boots on it: health, sign-up, shares, a PC link; the sync routes are 404; no table, column, constraint, index or sync row touched); roll forward (the library made before is whole); the flag
unset again (routes 404, data untouched); a first boot on an empty database and a second (nothing changes); twelve real servers at once; a view in the way of `ppp_sync_items` (the server
starts, says once that sync is off and why, the queue and the site work, the next boot makes the tables).

**Routes** (all JSON, `Cache-Control: no-store`; `X-PPP-Lib: <code>` except the first):

| Route | Answers |
| --- | --- |
| `POST /api/libs` `{}` | `201 {id, code, recovery, tag, createdAt, keptUntil}` - the only time the code and the recovery code are shown. `tag` is the last 6 hex of the id (a non-secret name to recognise a library by) |
| `GET /api/sync/changes?since=<rev>` | `{maxRev, items: [{key, rev, deleted, hash, bytes, device, updatedAt, deletedAt?}], more, nextSince, deletions, library: {tag, bytes, items, tombs, capBytes, maxItems, keptUntil}}`, at most 500 items oldest first; `reset: true` when `since` is ahead of the library (a restored database; the library's own row was read first); `tooOld: true, purgedThrough: <rev>` when `since` is below a revision whose tombstone was purged (the device may have missed deletions). `nextSince` and `maxRev` are never past the last row listed unless the library was at that revision before the rows were fetched. Answered from memory when `since >= maxRev` |
| `GET /api/sync/items?keys=a,b` (at most 25) | `{items: [{...metadata, body: <base64 gzip>}], missing: [...], maxRev}`; a tombstone has no body; an item that does not fit in 6 MB of bodies is `deferred: true` (asked again). A name another library has is `missing` |
| `PUT /api/sync/items` `{device?, items: [{key, baseRev, hash, body}]}` (at most 25) | `200 {maxRev, applied: [{key, rev}], conflicts: [], library}`; **`409`** with the same shape when an item was written over a revision the server has moved past: `conflicts` carries the server's metadata, the others in the batch ARE applied. A write with `baseRev > 0` for a key the library has no row for (its tombstone was purged) is a conflict `{key, gone: true}`: nothing is written, say again with `baseRev: 0` to bring the song back. A retried write whose first answer was lost comes back `409` with the server's own metadata: **a conflict whose `hash` equals the hash that was sent is "applied"**. The whole batch is refused (`422` for a bad item, `503 quota`/`busy`, `429`) when it is malformed or does not fit |
| `DELETE /api/sync/items/:key?baseRev=<n>&device=<16 hex>` | `200 {key, rev, deleted: true, maxRev, library}`; `200 already: true` for a tombstone; `409` as above when the item moved on; `404` for a name that is not there; `baseRev` is required |
| `POST /api/libs/me/rotate` | `201 {id, code, tag, createdAt, keptUntil, maxRev, rotated: true}`; the old code is `401 rotated` from that moment; items, revisions, counters and the recovery code carry over |
| `POST /api/libs/recover` `{}` with `X-PPP-Recovery: <recovery code>` (no `X-PPP-Lib`) | `201 {id, code, recovery, tag, createdAt, keptUntil, maxRev, rotated: true, recovered: true}`: a new code AND a new recovery code (this one is used up); the old code is `401 rotated`. `401 bad-recovery` (counted with the wrong codes), `401 no-recovery`, `403 cross-site`. It opens nothing else |
| `DELETE /api/libs/me` | `200 {ok: true}`; the code is `401 deleted` |

Errors: `401 no-lib | bad-code | rotated | deleted | bad-recovery | no-recovery`, `403 cross-site`, `404 not-found`, `408 slow`, `409` (conflict), `413 too-large | item-too-large | batch-too-large`, `422 bad-body | bad-key |
dup-key | bad-rev | bad-hash | bad-device | bad-item | bad-gzip | no-items | too-many-items | no-keys`, `429 too-many | in-flight | share` (Retry-After), `503 busy | quota | budget | store`.

**What the server decides and what it leaves to the client (7.5).** The server stores. A write names `baseRev`, the revision of the item the device last saw (0 for a new one); the item is written
when the server's revision is `<= baseRev`, else it is a conflict (the client fetches the body, merges by 7.5 and writes again over the server's revision). A tombstone is an item; writing over it
needs its revision. Revisions are one counter per library (consecutive within a batch). **The bulk-delete guard fields** are `deletions` (the number of tombstones in an answer: more than 3 at
once and the client asks, 7.5), every tombstone's `deletedAt` and `device` ("changed on <device>", "recently deleted"), and the server's own bound of 60 deletions an hour.

**Where this differs from 7.3, and why** (the numbers were written before the G12-5 reviews): (1) 7.3 gave **256 MB an hour per address and 64 MB per library**, which are more than the
site's own 150 MB a day: one library could use the whole of the site's day. Every byte budget (written and read) is now held three ways - the site's, and **a quarter of it for each library
and for each creating address** - as G12-5 did after its second review. (2) Added, from the same reviews: places for bodies, a ceiling for unpacking, a ceiling for answers, write requests
counted whatever came of them, a limit on the changes that ask the database, rows capped apart from bytes, a 60-deletion limit. (3) `changes` is not rate limited when it asks nothing.
(4) A library's limits are held under its **key** (the id of the first library of its chain of codes), not its id: changing the code (5 an hour) would otherwise make every budget whole again
(mutant R9). (5) Reads count items per library (300 an hour); the bytes are the budgets.

**Free-tier arithmetic, checked.** A session is the first request after a boot (one round trip), `changes` (0 or 1 statement), one read per 25 items fetched, one write per batch pushed: 3-4
statements, as 7.8's S1 target needs. The 128 MB cap holds about 60-250 libraries as 7.6 estimated (a row costs 256 bytes on top of its 5-60 KB). The stats line shows the cap and the warning.

**Operations.** Turn on: set `PPP_SYNC=1` in Render (a restart; the tables are made at that boot). Verify beyond `/health`: the log has "Song sync: on"; `GET /api/sync/changes?since=0` with no
header is `401 no-lib`; `POST /api/libs` with `{}` is `201` (then remove it: `DELETE /api/libs/me` with its code); the hourly line has `"sync":{...}` and `by["api-sync"]`.
Switch off: unset `PPP_SYNC` and restart: routes 404, tables and data stay (switching it off is not a deletion). Roll back: deploy the previous sha (it boots on the migrated database);
optionally `DROP TABLE ppp_sync_items, ppp_sync_libs;`. What is in the database (read only; a database that is not on this machine needs `--allow-remote`, and the URL is `--url` or `DATABASE_URL`):
`node tools/sync-admin/list.js [--json]` - one row per library (id, MB, items, tombstones, revision, made, last used, the keyed tag of its address, state), the totals, and what each address
holds against its 48 MB. A library by id: `node tools/sync-admin/delete.js --id lib_<22 hex>` says what it would delete and exits 3; with `--confirm` one statement removes its items and its
row; then restart the server (the libraries are read once per boot; until then the owner's next write is refused as not valid). By hand the same is `DELETE FROM ppp_sync_items WHERE lib_id =
'<id>'; DELETE FROM ppp_sync_libs WHERE id = '<id>';`. Watch: the line's `pct` and `refused` (`quota`, `busy`, `budget`, `share`, `store`).

**After the security review (PR #276, 2026-10-15; reproductions were run against the first version and are tests now).** (1) **Major - a device could be handed a position past rows it
was never given:** `changes` read `lib.maxRev` after the awaited query, so a write that committed meanwhile moved `nextSince` past a row the page did not hold (items 1 and 2 listed, a
write of 3, `nextSince` 3). The revision is read once before the store is asked; the position is `max(that revision, last row listed)` (7.7, row "a device is handed a position"). (2)
**Major - the rows of `changes` were not charged:** a library could poll 500 rows as often as 120 an hour for nothing. The page is now looked at against the read budgets before the
database is asked and charged by what it weighs (500 rows: 84 KB, measured). (3) **Concurrent reads passed the look at the budget together:** six answers at once served 34.5 MB against a
2 MB share (they counted after serving). The worst an answer can weigh (`min(6 MB, the library's bytes, keys x 1 MB)`) is reserved before the database is asked and the difference given
back after, also when the call fails; the "at most one answer more than the share" is what is true now. (4) `reset: true` is not answered from a cache: a device that says it is ahead
costs one select of the library's own row (a restored database or a second process raises the cached revision). (5) **A device that was away:** `purged_through`, `tooOld`, `gone`
conflicts (7.7). A write that is retried after its answer was lost is `409` with the same hash: that is "applied" (G13-S1 must read it so). (6) **The recovery code** (7.7 and the routes).
Not built: an idempotency nonce for a lost response to a change of code - the recovery code answers the lock-out it would have prevented, and a nonce would need a place to keep the answer
(which would be a code). (7) **A hung store:** every call has a time-out (15 s), and the Postgres store has a query time-out (10 s) that drops the hung connection, so `exclusive()` writes
are not frozen behind a statement that never answers (a table locked by another session: 503 after 1.5 s with the time-out set to that, the next request served). (8) **Operator tools**
(`list.js`, `delete.js`; Operations above) and the twin's `strip` sorts the keys of the tombstone map (two stores built it in an order of their own: a false mismatch of the reviewer's seed 505).

*Measured, as the review asked.* First sync of 500 songs (2,000 packed rows each, 9.3 MB): upload 2 hours of waiting (240, 240, 20), read on a second device 1 hour (300, 200), the listing
84 KB in one answer (7.7, residual 11; a test: "a first sync of 500 songs"). Mutants: 145 (the review's fixes have mutants N, B10-B12, G, K12-K15, C, T, O).

**Notes for G13-S1 (the page).** Send `baseRev` of the revision seen, 0 for a new item. A `409` whose conflict has the hash that was sent is applied. A conflict `gone: true` is the device's
song that the library has no row for: ask the person, then send it again with `baseRev: 0`. `tooOld: true` in a `changes` answer: ask before pushing songs the library lacks. Show the
recovery code once, with the code and the link, and say it takes the library over. A `reset: true` answer: forget the revision and list again. Wait with the `Retry-After` of a `429`: a
first sync of many songs takes hours by design (7.7, residual 11).

**Verification** (`npm run test:sync`; Node only, the Postgres part skips without `PPP_TEST_PG_URL`): `sync.test.js` 341 checks (who may ask, libraries, items, revisions, deletion, shape and
size, quotas, rates, budgets, idle polls, isolation, new code, keeping times, races, restart, a failing store, the position a device is given, a device that was away, the recovery code,
a hung store, the operator's tools, a first sync of 500 songs, the hourly line), `sync-abuse.test.js` 43 (the amplification, the one-byte flood,
the zip bomb and the slow senders in a child process with a 200 MB heap, the places, the answers), `server.test.js` 19 (the real `server.js` on its file store: the flag, the routes, the stats
line and its warning, the data file, a restart), `sync-pg.test.js` 88 (on a throwaway Postgres 17: the migration, six random sequences of 260 calls each answered the same by both stores and
leaving the same rows, the guards, one script of 25 requests answered the same by both, the statements counted and in the database's own log, the operator's tools, a statement that hangs,
the boots above). **Mutants: 145, all killed**
(`node tests/sync/mutants.js`: three at a time, Postgres ones each on a database of their own; the unmutated copy passes first).

**Choices the Lead may want to change.** (1) The per-address cap of 48 MB (residual risk 1). (2) `song` fields are an allowlist (`v card score progress graph scoreHash savedAt`), so that an item is a
song: S1 adds a field with its test. (3) Tombstones are purged at 30 days, and a device that was away longer is told (`tooOld`, `gone`; residual risk 6). (4) The code is `401 deleted`/`rotated` for its old
holders, not counted as wrong: it tells them what happened, and tells nobody else anything. (5) The library's use is written at most once a day (a day's slack in "kept until"). (6) A body
may be 6 MB; an item 1 MB of gzip. (7) `server-stats.js` gains `addGauge`; the class `api-sync` exists only with the feature.

**What could not be tested.** Production and a real Neon (egress, history, compute hours); Render's proxy with 6 MB bodies; a page (S1: two browsers, QR, the merge); Node 22 (the Dockerfile
says 22; every run here and the gate use 24 - nothing here needs a 24 API); Linux for the Postgres and abuse suites (they ran on Windows 11; the gate runs the Node ones on Linux).

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
| 5 | G13-4 load performance (CJK part: G13-4b2, built after U7) | U7 for CJK only (decided 2026-10-15) | Sonnet | 2 (+ review) |
| 6 | G13-5 server hygiene + Shared Scores | no | Sonnet | 1-2 (+ review) |
| 7 | G13-6 backup / delete on device | no | Sonnet | 1 (+ review) |
| 8 | G13-7a monitoring + release script (7b browser counters: G13-7b, built after U5) | U5 for 7b (decided 2026-10-15) | Sonnet | 1 (+0.5) |
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
| **U5** | **DECIDED 2026-10-15 as recommended** (the user's blanket go-ahead; built in G13-7b, see "G13-4b2 and G13-7b as built"). Anonymous counters sent by browsers (errors, engraver fallbacks, load time; no ids, aggregated in memory, one log line an hour), disclosed in About, with an opt-out switch there (default on) | **Yes.** Without them a broken release is only seen when someone complains. | A privacy complaint, low risk with no identifiers. Without them: blind to field failures. |
| **U6** | Rename the demo "Interstellar Theme - Hans Zimmer" (its notes are a generated pattern) | **Yes**, to an original title, e.g. "PPP Practice Theme". **STILL UNDECIDED (2026-10-13): nothing renames it; `TODO(U6)` is in THIRD_PARTY_NOTICES.md and tools/notices/notices.json.** | Keeping it: a film-title / composer-name complaint, and a misattribution in every first impression. Renaming: none. |
| **U7** | **DECIDED 2026-10-15 as recommended** (built in G13-4b2, see "G13-4b2 and G13-7b as built": Noto Sans is asked for only on a device that has no font of its own for the script). Korean/Japanese/Chinese text in the device's own fonts (fast, works offline) or Google's Noto Sans as now (331 KB render-blocking CSS) | **System fonts first; Noto loaded non-blocking** where online, so the look settles to today's. | A slightly different font for a moment, or on Windows (Malgun Gothic). |
| **U8** | The in-browser transcription model (60 MB, Google's storage) | **Keep it at Google**, vendor the code, say "needs internet" on that button. The PC worker is the strong path anyway. | If Google moves the checkpoint, the browser model breaks until we host it (the PC path still works). |
| **U9** | **DECIDED 2026-10-13 as recommended** (built in G13-3; the PC-worker default is recorded, not changed: see "G13-3 as built"). YouTube transcription posture (facts in E8) | **Keep the feature; add a notice** ("use recordings you have the right to use; the score is for your own practice"); **do not allow posting YouTube-derived scores to the public Shared Scores** (links stay); default the PC worker to download on the PC; ask a lawyer before any commercial launch. | Without it: takedown requests, the server's IP blocked by YouTube (today's fallback is a third-party site), a complaint about a posted arrangement. With it: a little friction for posting covers. |
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
| U-K4 | Whether basic-pitch 1.0.1 and tfjs 3.21 can be vendored as single files with no bundler | **Answered by the G13-8 spike: yes, as files** (an import map and a stand-in for `@tonejs/midi`, which PPP never calls; tfjs 3.21.0 as the flat ES module); nothing stays on jsDelivr by exception. Fallback kept: esm.sh when a browser has no import maps |
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
