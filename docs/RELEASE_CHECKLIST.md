# Release checklist

How a change gets from a merged pull request to the people using PPP, and how it is undone. Written in G13-0
(`docs/GOALS/G13_PRODUCTIZATION.md`, section 12); the numbers it refers to are the budgets of that document's section 11.
Every deploy gets a row in `docs/RELEASES.md`.

**Facts this checklist rests on.**
- Pushing or merging does **not** deploy ppp-web. A deploy is a deliberate act on the Render service
  `srv-dalt5s6k1f9s739cuetg` (the user decides when; the Lead runs it).
- Everything below is read-only against the live site (GET requests and a throwaway browser profile). Nothing here writes to production.
- `tools/release/release.js` (G13-7a) does steps 3 to 6 and refuses unless the `gate` of the commit is green. It is run by a person; no workflow calls it, and it deploys only
  with `--confirm`.
- ppp-web shares the 750 free Render hours of the month with the duckscope services: never leave a timer or a monitor calling the site all day.

## 1. Before the deploy

1. **The pull request's `gate` passed, read as a separate step.** Open the check named `gate` on the merge commit and read its
   result and its mode line: `gate passed: FULL mode, 16 shards and 2 merges succeeded`, or `LIGHT docs-only / tooling-only`.
   A merge button that is enabled is not a green gate (the repository has no required checks: a failed gate can still be merged).
2. **The off-path identity of the phase holds**: with the phase's switch off the page behaves as on the previous release
   (for example `?cdn=1` for G13-1, `PPP_SYNC=0` for sync).
3. **Note the rollback.** The live build is on the page: `curl -s https://ppp-web-2o99.onrender.com/ | grep -o 'PPP_BUILD="[^"]*"'`.
   The rollback of the deploy you are about to make is a deploy of that commit. It goes in the row of `docs/RELEASES.md`. The script prints it (with the full sha).

## 2. Deploy

4. **Plan** (changes nothing): `node tools/release/release.js <sha>` - any sha of 7 to 40 characters.
   It resolves the full 40-character sha, reads the check run named `gate` of that commit with `gh api` and **refuses unless it concluded `success`**
   (red, cancelled, still running and "no gate yet" all refuse), reads the live `PPP_BUILD`, and prints the plan, the deploy command and the rollback command
   (with the full sha that is live now). A commit that is not in the history of `main` is printed as a WARNING.
5. **Deploy, wait, smoke, row** (after the user said yes): `node tools/release/release.js <sha> --confirm [--pc-code-file <file>]`.
   It runs `render deploys create srv-dalt5s6k1f9s739cuetg --commit <40-char sha> --confirm`, waits until the page shows the new `PPP_BUILD` (polls every 15 s,
   gives up after 20 minutes; a deploy Render marks failed stops it at once; a build takes about 40 s, a slow one up to 16 minutes), then runs
   `node tests/live/smoke.js --sha <sha> --logs` (about a minute, read-only: `/health`, the build, anonymous routes, a fresh profile with no page error and no failed
   request, the defaults of the app switches, and the Render log without an error line since the deploy; a `/health` that answers is not enough, the page has to load).
   Exit 1 = refused, failed, or the smoke check failed - it then prints the rollback command again.
6. **The row.** The script adds it at the top of the table of `docs/RELEASES.md` (date, commit, deploy id, what changed, the rollback commit, the smoke result);
   commit it in a pull request. By hand (the script is not available): `render deploys create srv-dalt5s6k1f9s739cuetg --commit <40-char sha> --confirm`, wait for
   `render deploys list srv-dalt5s6k1f9s739cuetg -o json --confirm` to say `live`, `node tests/live/smoke.js --sha <sha> --logs`, write the row.

## 3. By kind of change

7. **A change to what loads or how fast** (scripts, fonts, caching, the app head, the server's static files):
   run `node tests/live/perf.js phone,offline3p,repeat --runs 2` (about 3 minutes) and put the numbers in the pull request and in the row.
   The budgets (G13 section 11) and the numbers measured before G13:

   | Budget (phone profile unless stated) | Before G13 | Target |
   | --- | --- | --- |
   | Cold first contentful paint | 8.78 s | 4.0 s |
   | Cold app ready | 9.29 s | 5.0 s |
   | Bytes before ready (cold) | 1.4 MB at ready (3.0 MB in the first 17 s) | 1.2 MB |
   | Repeat-visit bytes | about 2 MB | 450 KB |
   | Repeat-visit ready | 7.0 s | 3.0 s |
   | Total blocking time at boot | about 420 ms | 300 ms |
   | Longest boot task | 1,124 ms | 500 ms |
   | Practice screen open, longest task (CPU 4x) | 616 ms | 400 ms |
   | Shared Scores DOM nodes / JS heap | 14,636 / 89 MB | 3,000 / 60 MB |
   | Heap after 10 s of practice playback | 90 MB | 100 MB (no regression) |
   | Desktop cold ready | 1.61 s | not worse |
   | Third parties blocked (offline3p): Home renders, page errors, requests to unpkg.com | blank page, 1, 2 | renders, 0, 0 |

   `node tests/live/perf.js all --check` exits 1 when a measured budget is missed (without `--check` it only reports: today's
   site misses most of them by design). The JSON report also lists every request of the cold load with its status and cache header
   (`results.<mode>[].ownRequestList`), which is the oracle for "every page request still succeeds" after a change to the static server.
   Runs differ by up to about 15% for bytes and times and more for single long tasks: judge a change by the median of two runs.
8. **A change to user-visible text**: `node tests/live/i18n-walk.js ko-KR` (and `ja-JP`, `zh-CN`) must show no `NEW` string;
   the static check `node tests/i18n/gaps.js --check` is already part of the gate and fails on a new string with no translation.
   The coach hints ("Left hand at 75% tempo") are built in code and show in some page loads only: run the walk twice before believing a `NEW`.
9. **A change of the user's own flow** (recording to score, the PC link, import, share): reproduce the user's exact path and data on
   production, not on a fixture. A fix verified only on other data has been declared done before the real cause was found.
   Do it with the live page, as the user does (production runs without the local helper services a local test may have).

## 4. After the deploy

10. **Tell the user, in Korean**, in one or two lines: what changed, that it is live, and the rollback command with the commit
    (for example "방금 올린 것: 악보 보기. 문제가 생기면 `<이전 sha>`로 되돌립니다").

## Watching the live site (G13-7a)

- **Every day at 06:05 KST** the workflow `live-smoke` runs `tests/live/smoke.js` against the live site (read-only; it wakes ppp-web for about 16 minutes: about 8 of the 750 hours a month,
  which is why there is no uptime pinger). A failure opens the issue "Live smoke failed" (or comments on the open one) with the tail of the output; read the issue, then the run.
  It is not part of the `gate`. "Run workflow" starts it by hand.
- **In the server's log**, once an hour of being awake and once when the instance stops, one line of numbers: `render logs -r srv-dalt5s6k1f9s739cuetg --limit 500 -o text --confirm | grep stats:`
  (`requests`, `5xx`, `storeErrors`, each by route class; no address or id). Look at it after a deploy: a `5xx` or `storeErrors` above 0 where the line before had none is the thing to explain.

## Rollback

```
render deploys create srv-dalt5s6k1f9s739cuetg --commit <40-char sha of the previous live commit> --confirm
```

Or `node tools/release/release.js <previous sha> --confirm --what "rollback of <bad sha>"`: it deploys, waits, runs the smoke check and writes the row, but it refuses a commit whose
`gate` is not green or not found (a commit older than the gate has none: use the command above, then the smoke check and the row by hand). A rollback needs no pull request. A release that migrates the database must
be additive (`CREATE ... IF NOT EXISTS` only, the G10b-2 pattern), so that the previous commit still boots on the migrated data.
