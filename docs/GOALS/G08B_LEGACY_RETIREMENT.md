# G08b — Legacy Retirement and App Integration

## 0. Status

Architect 2026-09-28 (Lead). Depends on G8a (deterministic realizer, merged; tuning concluded per
`docs/GOALS/G08_ARRANGEMENT_REALIZATION.md` §14 — G8a ties or beats the in-app `ScoreArranger` on 3 of 5
metrics, not 5 of 5; §7's full bar is honestly not met, accepted as the state to build on). This is the
only G8 phase that touches the live app file — full implement-review-fixer cycle, same discipline as
G4/G5c/G6b, and comparable stakes to the G4 legacy-renderer removal (this phase permanently deletes a
working arrangement pathway, same as that removal deleted the legacy renderer).

## 1. Goal

Wire G8a's realizer into the app as a real alternative to the three legacy arrangement paths, behind a
new `PPP.arranger` switch (default `'legacy'`, matching `PPP.fingering`/`PPP.difficulty`'s exact
convention). Retire `arrange_score.py` and the wire-score JSON round trip. Fix the review screen's
XML re-parse (roadmap TD2) to adopt a graph directly instead.

**This phase does not flip the default.** `PPP.arranger` stays `'legacy'` until a separate, later,
explicit decision — the same shape as G4's M-H1/M-H2-gated flip. G8a's own numbers (3/5 metrics, not
5/5) are the reason this default stays conservative; H-8 (still not scheduled — see `docs/GOALS/
G08_ARRANGEMENT_REALIZATION.md` §10) would inform any future flip discussion, not this phase.

## 2. Non-goals

- No production flip.
- No v2/AI-3 work, no D-3 decision (that remains a separate, later question).
- No changes to G8a's own realizer logic (`realize/*`) beyond whatever thin adapter code is needed to
  call it from the app — if a real bug in `realize/*` surfaces while wiring it in, fix it there
  directly (it's already merged, not frozen), but do not redesign it here.

## 3. What already exists — read before writing anything

- **`arrange_score.py`** (833 lines, Python, wire-JSON in/out, no ScoreGraph) — to be **retired**
  (deleted), not ported. Confirmed in `docs/GOALS/G08_ARRANGEMENT_REALIZATION.md` §4/§5: it has no
  playability/difficulty/graph awareness; G8a's realizer replaces it entirely.
- **The wire-score round trip** (`Piano Coach App.dc.html`): `wireScore()` (~9253-9264, a `Score` →
  flat JSON serializer), `fromEngine()` (~9265-9285, flat JSON → merged-back-into-`Score`), and
  `arrangeWithService()` (~9286+, POSTs to `arrange_score.py`'s HTTP endpoint) — this whole path
  becomes obsolete once the app calls G8a's realizer in-process on a ScoreGraph. Confirm the exact
  current call sites (line numbers may have shifted since G08's original research) before removing
  anything — `grep -n` fresh, don't trust this doc's cited lines blindly.
- **The review screen's XML re-parse** (`applyRichReviewArrangement`, ~13836+, called from ~13781 and
  ~13833/~13944) — already logged as roadmap TD2 ("App-made XML is re-parsed with `parseMusicXML`...
  arrangement... G8" — TD2 explicitly names G8 as the fix goal). It builds `built.graph` (a real
  ScoreGraph via `A.toMusicXml(...)`) and then **discards it**, re-parsing `built.xml` via
  `parseMusicXML` instead (`base = parseMusicXML(built.xml, ...)`), only to throw that away again for
  `wireScore`'s flat JSON. Fix: hand `built.graph` straight to G8a's realizer instead of any of this.
- **`PPP.fingering`/`PPP.difficulty`** (`window.PPP`, both already merged): the exact convention to
  copy for `PPP.arranger` — `get`/`set` accessor pair, default `'legacy'`, any unrecognized value
  coerces to `'legacy'` ("G4-F2-1's convention," cited in both existing switches' own code comments).
  Find their real current line numbers fresh and place `PPP.arranger` the same way.
- **G8a's real entry point**: `realize/index.js`'s `realize(g, sg, plan, opts)` (needs a SongGraph from
  `songgraph/index.js` and a plan from `arrangement/index.js`'s `plan()` — both already merged,
  already reviewed; call them, don't re-derive their logic). Confirm the exact current exported
  function signatures fresh (`songgraph/index.js`, `arrangement/index.js`) before wiring — this
  project's history (G5c, G6b, G7b, G8a itself) has repeatedly found that assumed API shapes from a
  design doc don't always match the real, current export exactly.
- **The three legacy arrangement UI entry points**: the review screen (`applyRichReviewArrangement`,
  transcription/recording review), the in-app "Song Arranger" library overlay (`saveSongArrangement`,
  ~14478-14536 per G08's research — already Score-object-only, never touches XML, a separate code path
  from the review screen's TD2 issue), and wherever `arrange_score.py`'s HTTP service is reachable
  outside the review screen, if anywhere (check fresh — G08's research only traced the review-screen
  call site in detail). **Find all real call sites yourself** — do not assume the review screen is the
  only place a legacy arranger is reachable from.

## 4. Scope

- **New `PPP.arranger` switch**: `'legacy'` (default) | `'g8'` (or whichever value name reads best,
  consistent with `'inferred'`/`'g6'`'s naming style — your call, document why).
- **Wire G8a in** at the real arrangement call site(s) found in §3, gated by the switch: when `'g8'`,
  call `realize()` on the graph already in scope (per the review screen's `built.graph`, once TD2 is
  fixed) instead of any legacy path.
- **S4 fix**: `applyRichReviewArrangement` adopts `built.graph` directly — no `parseMusicXML`
  re-parse, no `wireScore`/`fromEngine` round trip, when the switch is `'g8'`. When `'legacy'`, the
  existing legacy behavior (including its XML re-parse) is untouched — TD2 is only fully closed once
  the switch's default eventually flips, but the CODE PATH that would let it be closed must exist and
  be correct now.
- **S6 retirement**: delete `arrange_score.py`, its HTTP endpoint (wherever that's registered —
  `server.js` or similar, confirm fresh), and the wire-score round trip functions
  (`wireScore`/`fromEngine`/`arrangeWithService`) — but only once nothing on the `'legacy'` path still
  needs them. If the legacy path still genuinely needs `arrange_score.py` (since `'legacy'` stays the
  default), **do not delete it yet** — retiring it fully may need to wait for the eventual flip, the
  same way G4 kept the legacy renderer alive until its own flip, then removed it only in a later,
  separate step (§25 step 3, this project's own precedent for exactly this two-step pattern: flip
  first, remove dead code later once the fallback counter is provably at zero). **Investigate this
  explicitly and correct this doc's own phrasing** if "retire now" turns out premature — do not
  silently do a partial job in either direction.

## 5. Acceptance

- Switch defaults to `'legacy'`: every existing arrangement behavior is byte-identical to before this
  phase when the switch is off. Verify this the same rigorous way G5c/G6b did (independently
  re-derive legacy output, not just "it didn't crash").
- Switch on (`'g8'`): the review screen's arrangement flow produces a real G8a-realized ScoreGraph,
  adopted directly (no re-parse, no wire-JSON), with G8a's own already-established correctness
  properties (0 hard violations where G8a itself guarantees them, melody preserved, graceful
  degradation on low-confidence sections).
- If S6's full retirement is judged premature (§4), this doc's acceptance criteria should reflect
  whatever real, correct partial state was reached instead of an unmet "fully retired" claim.

## 6. Regression

Whatever browser/app-level test suites already cover the review screen's arrangement flow (find them —
check `tests/` for existing arrangement/review-screen coverage before assuming none exists). Extend or
add tests for both switch states. `test:realize`, `test:arrangement-planner`, `test:songgraph` should
be unaffected (this phase touches the app file and possibly `server.js`, not those Node modules'
internals).

## 7. Performance

The review screen's arrangement flow should not regress in perceived latency — G8a's own realizer is
already measured fast (well under its 1s/piece budget); confirm the in-process call doesn't introduce a
new bottleneck the old HTTP round trip to `arrange_score.py` didn't have in a different way (e.g. don't
block the main thread on a slow synchronous call where the old HTTP path was naturally async).

## 8. Human review

None scheduled for this phase specifically (H-8 is G8a's own diagnostic review, still not started per
`docs/GOALS/G08_ARRANGEMENT_REALIZATION.md` §10 — that decision is independent of this phase's app
integration, which ships behind a default-off switch regardless).

## 9. Rollback

`PPP.arranger = 'legacy'` (this phase's whole reason for being switch-gated). If S6's retirement
happens in this phase, its rollback is redeploying a prior build (the same shape as G4's own
legacy-renderer removal) — call this out explicitly if you do retire `arrange_score.py` here.

## 10. Notes for the G8b implementer

- This is the highest-stakes G8 phase so far — it touches the live app file and may permanently delete
  a working arrangement pathway. Full review discipline, no shortcuts, matching this project's
  standing "review depth by risk" policy for app/deploy-affecting changes.
- Re-verify every file/line reference in this doc against the current app file before acting on it —
  this doc was written before this phase started; line numbers drift as other work lands.
- If you find the S6 retirement question (§4) genuinely ambiguous or risky to resolve unilaterally,
  say so plainly in your report rather than guessing — this is exactly the kind of decision the Lead
  should weigh with real evidence in hand, the same way G4's actual legacy-renderer removal was a
  separate, explicit, later step after the flip, not bundled into the flip itself.
- If anything in this doc turns out wrong once you've built something real, correct it in a new §11
  "Implementation record" — standard practice in this project by now.

## 11. Implementation record

(Grows here as G8b lands.)
