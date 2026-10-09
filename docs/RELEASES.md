# Releases

One row per deploy of ppp-web (Render service `srv-dalt5s6k1f9s739cuetg`), newest first. Written in G13-0; the procedure that produces a
row is `docs/RELEASE_CHECKLIST.md`. `node tools/release/release.js <sha> --confirm` (G13-7a) adds the row at the top of the table after it has deployed and run the smoke check; commit it. By hand otherwise.

**A row.**
- **Date**: UTC, the time Render created the deploy.
- **Commit**: the 7-character sha; a deploy takes the full 40-character one.
- **Deploy**: the Render deploy id.
- **What changed**: the pull request.
- **Rollback to**: the commit that was live before. Rolling back is `render deploys create srv-dalt5s6k1f9s739cuetg --commit <40-char sha> --confirm`.
- **Smoke / verified**: the `tests/live/smoke.js --sha <sha> --logs` result, or what else was checked on the live site.
- **Phone cold**: `tests/live/perf.js phone` (first contentful paint / app ready / KB transferred at ready, median of two runs), filled
  for a change that touches what loads (checklist step 7); `-` where it was not measured.

| Date (UTC) | Commit | Deploy | What changed | Rollback to | Smoke / verified | Phone cold (FCP / ready / KB) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-09 07:11 | `7a3e2e4` | `dep-db4977jbc2fs73b2fidg` | Recover missing ScoreGraph modules before recording imports (#247) | `d324c44` | `smoke.js --sha 7a3e2e4 --logs`: 16 checks passed (release.js, 2026-10-09) | - |
| 2026-10-08 05:55 | `b727ada` | `dep-db3j0g8m7kps73et2v60` | Score view: My Songs opens a song on its whole score (#219) | `3567e27` | `smoke.js --sha b727ada`: 15 checks passed (G13-0, 2026-10-08) | 8.6 s / 9.0 s / 1,407 KB |
| 2026-10-07 18:02 | `3567e27` | `dep-db38ijrncjis73eqj9ng` | G10b-5: the PC button is always findable; a link is never forgotten on one 401 (#218) | `7ec61cb` | - | - |
| 2026-10-07 14:57 | `7ec61cb` | `dep-db35rh4s728c73bem5tg` | G10b-4: start at once from the PC browser; confirm before pairing (#189) | `e943c93` | - | - |
| 2026-10-07 11:46 | `e943c93` | `dep-db33227avr4c739k9sj0` | First practice on a new piece opens at the score tempo (#185) | `c715eaa` | - | - |
| 2026-10-07 10:51 | `c715eaa` | `dep-db328gajnfac738f9ivg` | G10b-3: one-tap PC pairing (link + shortcut) (#184) | `94350c5` | - | - |
| 2026-10-07 04:07 | `94350c5` | `dep-db2sb649v7es73a3hdbg` | G10b-2: the home-PC link needs no account (#181) | `b7f9fb5` | - | - |
| 2026-10-06 15:03 | `b7f9fb5` | `dep-db2grd3ncjis73elv1gg` | G10a-5b: the recording conversion v2 is the default (#177) | `7611c4e` | the real site with the teacher's YouTube link: v2 default, 89 bars, 4/4 (roadmap) | - |
| 2026-10-04 10:57 | `7611c4e` | `dep-db131vad0e5s73ds70mg` | G10a-4 (3/3): docs, section 25 G10a-4 result (#163) | `415a4c4` | the real site with the teacher's YouTube link, chip off and on (roadmap) | - |
| 2026-10-02 09:58 | `415a4c4` | `dep-davo0hvavr4c73cpehgg` | Recording notation: durations from onsets (root cause of wedged rests) + notation checker (#134) | `3869403` | - | - |
| 2026-10-02 08:26 | `3869403` | `dep-davmlau7bikc73elimj0` | Right-hand run rests: one rule for both hands, delete a lone 16th rest and lengthen the note before it to a plain value (#133) | `2eac172` | - | - |
| 2026-10-02 06:36 | `2eac172` | `dep-davl1oid0e5s738div4g` | Recording notation: tuplets and exact bars (what is drawn adds up) (#132) | `c6e357b` | - | - |
| 2026-10-02 06:20 | `2eac172` | `dep-davkqae7bikc73ef46b0` | Recording notation: tuplets and exact bars (what is drawn adds up) (#132) - **update_failed** after 15 min, never live; deployed again below | n/a | - | - |
| 2026-10-01 19:19 | `c6e357b` | `dep-davb4lmk1f9s739kg4k0` | Stamp the build on Song Arranger copies and put it in the page (#131) | `07e4a3d` | - | - |
| 2026-10-01 19:02 | `07e4a3d` | `dep-davasbrbc2fs73c5nbtg` | Left-hand run rests: delete a lone 16th rest in a 16th run and lengthen the note before it (#130) | `79dc80a` | - | - |
| 2026-10-01 17:56 | `79dc80a` | `dep-dav9tlbncjis73cedcqg` | Rests of a recording: merge consecutive rests and retile on the beat grid (#129) | `646e12a` | - | - |
| 2026-10-01 15:20 | `646e12a` | `dep-dav7kb59fdbs73bmjvb0` | Share a song as a link without logging in (guest link sharing, with limits) (#127) | `1d0a060` | - | - |
| 2026-10-01 13:13 | `1d0a060` | `dep-dav5ot0473hc73dnech0` | Transcription rests at the source: close sub-16th gaps when a recording becomes a score (#125) - slow build (16 min) | `a33074d` | - | - |
| 2026-10-01 09:33 | `a33074d` | `dep-dav2hj0jo6nc73f79g1g` | G9f: final-review fixes - no 32nd/64th rests in transcriptions, exact source guard (Hanon), review page rests (#123) | `9c66496` | - | - |
| 2026-10-01 07:08 | `9c66496` | `dep-dav0dtu0tbcc73d1dsvg` | G9e: a stray accompaniment note in a transcription's melody no longer refuses the whole piece (#121) | `ebca5ef` | - | - |
| 2026-10-01 04:12 | `ebca5ef` | `dep-dautrgd9fdbs73ac796g` | G9e: a long imported title no longer makes every candidate fail to build (graph id + '-g8a' > 64) (#119) | `cd9d803` | - | - |
| 2026-09-30 ~ | `cd9d803` | `dep-dauln3npn0mc7386a9dg` | G9e refusals: one-note mode now makes 95% of method pieces (was 46%) (#117) | `38efc15` | - | - |
| 2026-09-30 ~ | `38efc15` | `dep-dauipmvlot8c73ba9o70` | G9e default-on: one note per hand is the app's default arranger (#115) | `88900fe` | - | - |
| 2026-09-30 ~ | `88900fe` | `dep-dauh8ou0tbcc73feapa0` | G9e-lite: opt-in "one note per hand" arrangement, `PPP.arranger = 'single'` (#113) | `26e26f3` | - | - |
| 2026-09-29 ~ | `26e26f3` | (not in the roadmap) | docs: G9a merged, TD14 and TD15 fixed (#95); the build that was live before 88900fe | - | - | - |
| 2026-09-28 | `4866b66` | `dep-dat761nlk1mc73ehv95g` | G8b: `PPP.arranger` switch (default `legacy`), S4/TD2 fix, G8a wired into the review screen (#87) | - | `PPP.arranger` defaults to `legacy`; realize / arrangement modules load (roadmap) | - |
| 2026-09-28 | `6c63338` | `dep-dasuhch7lnhs73atgh80` | G6b: `PPP.difficulty` switch wiring the ranker into the Analysis screen and Coach (#72) | - | `PPP.difficulty` defaults to `legacy`; `g6` gives a level (roadmap) | - |
| 2026-09-27 | `ba8ee49` | `dep-dasm7onpn0mc7391j9kg` | G5c: generated fingering behind `PPP.fingering` (#66) | - | `PPP.fingering` defaults to `legacy`; `inferred` fingers 18/22 notes (roadmap) | - |
| 2026-09-27 | `ca70a03` | `dep-dasjdlt9fdbs73dnhgo0` | MX-2: hymn catalog key signature, tie-stop and bar-accidental bugs (#57) | - | F#3 reads midi 54 (was F natural) (roadmap) | - |
| 2026-09-27 | `256aa9a` | `dep-dasi7ah7lnhs739a2ia0` | G4 closed: the legacy renderer removed (#54), roadmap condensed (#55) | - | - | - |
| 2026-09-27 | `16f4311` | `dep-das1chvlk1mc73duo510` | G4 polish: the missing time signature in windowed practice views (#41) | - | a windowed practice view shows 6/8 (roadmap) | - |
| 2026-09-26 | `9dc6942` | `dep-daru9259fdbs73b3j7eg` | G4f-2: the engraver becomes the default renderer, "the flip" (#32) | - | a fresh puppeteer check, not only /health (roadmap) | - |
| 2026-09-26 | `0ef0950` | (not in the roadmap) | docs: close out G4d-1b (#20); production moved here at the user's request | `72549cb` | verified in the live page (roadmap) | - |
| before 2026-09-26 | `72549cb` | (not in the roadmap) | Improve high-speed rhythm and ottava engraving | - | - | - |

## Where these rows come from

- **The first 20 rows** are the Render deploy list (`render deploys list srv-dalt5s6k1f9s739cuetg -o json --confirm`, read-only; it
  returned the 20 most recent deploys on 2026-10-08), with the date, commit, id and status as Render recorded them. The rollback of a row is the commit of the
  row below it. The two slow builds (about 16 minutes each) and the one `update_failed` are as Render reports them.
- **The older rows** are from `docs/PPP_MASTER_ROADMAP.md` (deploy ids, dates and what was checked after each deploy); every commit was checked
  in `git log`. Their date is the day the roadmap gives (the user's local day, so it can be a day later than UTC); a date marked `~` is the day of the commit, because the roadmap names the deploy but not the day. Deploys that the roadmap
  does not name are not listed, so the older part is not complete, and its rollback column is `-` where the roadmap does not give one.
- **Phone cold for the live row** is this tool's first run (G13-0): FCP 8.6 s, ready 9.0 s, 1,407 KB at the moment the app is ready, against
  8.78 s / 9.29 s / 2,987 KB in the G13 design (`docs/GOALS/G13_PRODUCTIZATION.md` section 1; its 2,987 KB is the total of the first 17 s,
  the 1,407 KB is the bytes at the ready instant: `perf.js` reports both).
