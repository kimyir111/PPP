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

- **New `PPP.arranger` switch**: `'legacy'` (default) | `'g8'` (a third value, `'single'`, was added later by G9e-lite: see the note at the end of §11; since G9e default-on, 2026-09-30, the default is `'single'`, see docs/GOALS/G09 §12) (or whichever value name reads best,
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

### G8b — PPP.arranger switch, S4 fix, real G8a wiring (2026-09-28)

All investigation below was done directly (Read/Grep/Bash on the real files), with no
sub-agent dispatched at any point — this task's own hard process constraint, following G8a's
own documented multi-writer collision (§14 of `docs/GOALS/G08_ARRANGEMENT_REALIZATION.md`).

**The COACH_URL/OMR_URL finding: REFUTED, with a real, deployed counter-example found.** The
pre-implementation note's hypothesis was that `arrange_score.py` might only ever work with a
local dev helper, never in production. Checked directly:
- `OMR_URL`/`COACH_URL` (App ~6205-6219, ~7867): on a public deploy (`location.protocol` is
  `http/https` and the hostname isn't localhost), `helperUrl()` returns `'/helper'` - a
  same-origin relative path, not a hardcoded `127.0.0.1` URL. The app's own comment already
  says this plainly: "A public deploy answers /helper with 'not here'" - but that answer
  depends on server-side config, not on the URL shape alone.
- `server.js` (~1120-1178): `/helper/*` is proxied to `HELPER_URL` (default
  `127.0.0.1:8788`) whenever `helperEnabled()` is true. `helperEnabled()` reads
  `PPP_HELPER`: `'0'` forces off, `'1'` forces on, otherwise it defaults to
  `NODE_ENV !== 'production'` (off in production by default).
- **`render.yaml` (the actual deployed config) explicitly sets `PPP_HELPER=1`**, and its
  `startCommand` is `sh -c 'node omr-service.js --port 8788 >/tmp/ppp-omr.log 2>&1 & exec node
  server.js'` - the production Render service spawns the local helper as a co-process
  alongside `server.js`, deliberately overriding the production default. Its `buildCommand`
  also creates a Python venv and installs `requirements-arranger.txt` specifically for this,
  and sets `PPP_TRANSCRIBE_PYTHON=.arranger-venv/bin/python`.
- `omr-service.js` (`handleArrangeScore`, ~699-731, `runScoreArranger`, ~650-681): spawns
  `arrange_score.py` as a real Python subprocess via the configured `PYTHON`, and this is
  registered as `POST /arrange-score`, reachable via the proxy above.
- `fromLocalPage`'s own origin check (used by `handleArrangeScore`) is not a blocker: the
  proxy in `server.js` strips the `origin` header before forwarding to the helper, so a
  request that reaches `omr-service.js` via `/helper/*` always looks local to it (`!o` is
  true) regardless of where the original browser request came from.

**Conclusion: `arrange_score.py` is fully deployed and functional in production today** -
this app's own live deploy runs it as a real subprocess, not merely as a local-dev
convenience. This directly changes the S6 calculus (§4 below): retiring it now would be
retiring a genuinely working, currently-primary production pathway, not a dead one.

**Every real call site found** (grep run fresh against the current file; all line numbers in
§3 of this doc had drifted since it was written, confirmed and corrected here):
1. **The review screen** - `applyRichReviewArrangement` (App ~13963, not ~13836 as this doc's
   §3 estimated), called from `rewriteRhythm()` (~13907), `applyArrangement()` (~13920), and
   `aiArrangement()` (~14088 area). This is TD2's fix target: it built `built.graph` (a real
   ScoreGraph from `PPPAudioScore.toMusicXml`), then discarded it by re-parsing `built.xml`
   via `parseMusicXML` (`base = parseMusicXML(built.xml, ...)`), only to throw `base` away
   again for `ScoreArranger.wireScore`'s flat JSON inside `arrangeWithService`.
2. **The Song Arranger library overlay** - `saveSongArrangement` (App ~14631, not
   ~14478-14536 as estimated), called from `createSongArrangement()` and
   `aiSongArrangement()`. Confirmed, as this doc's §3 research suggested: it operates on an
   already-`Score.finalize`d Score directly (`scoreForArrangement`), never parses XML - a
   real, separate code path from TD2's defect, not itself broken. **Deliberately left
   entirely on the legacy path this phase - see the scope note below.**
3. **`ScoreArranger.arrangeWithService`/`.arrange`** (App ~9194-9306): the only two functions
   that call `arrange_score.py`'s HTTP endpoint (`arrangeWithService`, via
   `COACH_URL + '/arrange-score'`) or run the pure-JS legacy fallback (`.arrange`). Both call
   sites above are the only two callers found (`grep -n "ScoreArranger\.arrange"`,
   comprehensive).
4. **`/arrange`** (App ~13917/14560 in this doc's original estimate, confirmed still close):
   a completely different endpoint (`omr-service.js`'s `handleArrange`, an LLM style
   suggestion, not `arrange_score.py`) called from `aiArrangement()`/`aiSongArrangement()`.
   Its output is a `{level, style}` plan that is then handed to `applyRichReviewArrangement`/
   `saveSongArrangement` - already covered by gating those two functions, so `/arrange`
   itself needs no separate switch logic.
No other `arrange_score.py`/`wireScore`/`fromEngine`/`arrangeWithService` reachability exists
anywhere else in the file (comprehensive `grep`, not sampled).

**A real, load-bearing gap found before any app wiring could work at all**: `realize/*.js`
(`index.js`, `theory.js`, `patterns.js`, `notation.js`) used plain top-level `require()` calls
with **no UMD wrapper**, unlike every sibling module this phase needs
(`songgraph/*`, `arrangement/*`, `playability/*`, `difficulty/*` all already have the
`(function(root,factory){ if (module...) ... else { root.PPPXModules... } })(...)` pattern
specifically so the app can load them via `<script>`). This is not a logic bug - G8a's own
header always said "Node-only, not loaded by the app" - but it is a genuine, hard blocker for
this phase's actual job (loading it for the first time), matching this task's own item 9
allowance to fix such a thing directly, disclosed here:
- Added the identical UMD wrapper shape to all four files, moving each file's existing body
  unchanged into the factory function and preserving the exact same `module.exports` shape
  in the Node branch (so `require('./realize/index.js')` behaves byte-for-byte as before -
  confirmed by `npm run test:realize` staying 9/9 both before and after). Browser globals:
  `root.PPPRealize` (the combined namespace, matching `PPPArrangement`/`PPPSongGraph`) and
  `root.PPPRealizeModules.{theory,patterns,notation}` (matching `PPPArrangementModules`/
  `PPPPlayabilityModules`).
- **A second, real gap found while wiring, also fixed directly**: `realize/index.js`'s
  `policyForStage`/`densityBand` called `REF.bandsForStage(stage)` with **no opts at all** -
  unlike `arrangement/plan.js`'s own equivalent call, which already threads
  `opts.reference` through. `arrangement/reference.js`'s `REF.ref()` falls back to Node's
  `require('../difficulty/weights/...')`/`require('../difficulty/tools/dataset/...')` when no
  explicit weights/dataset are given - which does not exist in a browser. `densityBand`'s own
  `try/catch` silently swallowed that `ReferenceError` and returned `null`, which would have
  silently discarded G8a's own real, measured, evidence-based stage-3/4 subdivision rule
  (`docs/GOALS/G08 §14`'s "round 1", a kept improvement) for every browser call, with no way
  for a caller to supply real data instead - every other real dependency `realize()` has is
  already injected via its own UMD closure; this one specific internal call was not. Fixed by
  threading `opts.reference` through `policyForStage(stage, patternName, referenceOpts)` and
  `densityBand(stage, referenceOpts)` to `REF.bandsForStage(stage, referenceOpts)`, at both of
  `realize()`'s own call sites. Every existing Node caller (this module's own tests,
  `realize/tools/harness.js`) never passes `opts.reference`, so this is a pure injection-point
  fix - confirmed unchanged by `npm run test:realize` (9/9 both before and after this specific
  change too).
- Verified with a real, standalone check (not assumed): a Node `vm` context loading every new
  `<script>`-tag file in the app's own real browser load order (no `require`, no `module`)
  produced `root.PPPSongGraph`/`PPPArrangement`/`PPPRealize`, and a full
  `analyze()` -> `plan()` -> `realize()` run on a real corpus file produced **byte-for-byte
  identical** JSON output to the same call via Node's own `require()` - the UMD refactor
  changes nothing observable, in either environment.
- Also verified over real HTTP: every new script/JSON asset (`songgraph/*.js`,
  `arrangement/*.js`, `realize/*.js`, `difficulty/tools/dataset/method-books.json`) returns
  200 from a real `server.js` instance on this machine, confirming none of them fall under
  `server.js`'s `BLOCKED` top-level directory set (`node_modules, tools, .git, data, tests`) -
  a real, checked risk (`difficulty/tools/...` could plausibly have been blocked by a naive
  "tools" rule; it is not, since `BLOCKED` only tests the URL's first path segment).

**What was built**:
- **`PPP.arranger`** (App, `window.PPP`): `get`/`set` accessor pair, default `'legacy'`, any
  other value coerces to `'legacy', matching `PPP.fingering`/`PPP.difficulty`'s exact,
  already-cited convention ("G4-F2-1's convention"). Backing state `let ARRANGER_MODE =
  'legacy';`, placed next to `DIFFICULTY_MODE`/`loadDifficultyWeights()` (same neighbourhood,
  same one-release-rollback shape).
- **`loadArrangerReference()`**: lazily fetches (once, only when `'g8'` is actually used - not
  on every page load) the two real, already-committed files `arrangement/reference.js`'s
  `load()` needs (`difficulty/weights/g6a-v1.json`, reusing the SAME fetch
  `loadDifficultyWeights()` already makes for G6b rather than fetching it twice, and
  `difficulty/tools/dataset/method-books.json`, new), passed explicitly as `opts.reference`
  on every `plan()`/`realize()` call from the app so `arrangement/reference.js`'s own
  Node-`require()` fallback is never reached from the browser.
- **`realizeWithG8(builtGraph, plan)`**: the app-side adapter. `SGG.analyze(builtGraph)` ->
  searches `[baseStage, baseStage+1, baseStage-1, baseStage+2] x ['large','medium','small']`
  for a reachable `ARR.plan(...)` (the SAME search shape and hand-profile order
  `arrangement/tools/corpus-check.js`/`realize/tools/harness.js` already established, reused
  rather than invented) -> `RE.realize(...)`. `baseStage` comes from a declared, approximate
  crosswalk (`ARRANGER_LEVEL_TO_STAGE = {beginner:1, intermediate:2, advanced:3,
  original:4}` - the review screen's four legacy level labels onto G6's four stages in order;
  no exact equivalence exists, the same honest framing G8a's own harness crosswalk used for
  its `STAGE_TO_LEGACY` mapping). Returns `{ok:true, graph, report, degraded}` or
  `{ok:false, reason, message}` - never throws.
- **`graphToReviewScore(g, title)`**: converts a realized `ScoreGraph` back into the app's own
  `Score` via `scoregraph/legacy-score.js`'s `toScore(g, {ids:true})` (already the
  established, reviewed "the object `PPP.Score.finalize()` takes" bridge - first real use of
  it from the app itself, not invented for this phase), then substitutes each note's real
  `hand` from the graph's own `limb` (`scoregraph/pitch.js`'s `limbOf`). **Correction (independent
  review, 2026-09-28)**: `toScore` does not literally always default to `hand:'r'` - it has a
  real staff-position heuristic (top piano staff -> 'r', bottom -> 'l'), present since G2. The
  substitution is still genuinely necessary and load-bearing, though: G8a's `realize()` can place
  both hands' voices on the SAME staff in low-confidence/degraded sections (`realize/index.js`'s
  own comment already discloses this), which defeats the staff-based guess. Measured directly on
  real corpus files: 35-42% of notes (36/104 to 116/474) get a different, corrected hand once the
  limb-based substitution is applied versus raw `toScore` output - a real, substantial fix, not a
  decorative one, even though the original "always defaults to `'r'`" framing (inherited from
  `realize/tools/legacy.js`'s own pre-existing comment) was an oversimplification.
- **`applyRichReviewArrangement` (S4/TD2 fix)**: when `PPP.arranger === 'g8'`,
  `built.graph` goes straight to `realizeWithG8` -> `graphToReviewScore` - no
  `parseMusicXML(built.xml, ...)` re-parse, no `wireScore`/`fromEngine`, no HTTP round trip.
  A refusal (`UNREACHABLE`, missing reference data, a crash) reports a real message via
  `this.say(...)` and returns, exactly the same shape the legacy branch's own `catch` already
  uses - never a silent fallback to the very different legacy engine under a `'g8'` label.
  When `'legacy'` (default), the branch's own logic is unchanged (**correction, independent
  review**: the lines were moved one level deeper into a new `else {}` block, so a literal byte
  diff exists from the reindentation alone - "byte-for-byte" overstated this; the behavior is
  semantically/functionally identical, confirmed by reading the diff directly, which is what
  actually matters here); the one shared line after the branch (`arranged.composer =
  base.composer`) was changed to `arranged.composer = S.score.composer || ''` so it works for
  both branches - functionally identical for the legacy path, since `base.composer` was always
  set from exactly that expression one line earlier.
- **Style pass-through, a deliberate, disclosed limitation**: the review screen's style
  picker (`jazz`/`ballad`/`pop`/`waltz`/`bossa`/`cinematic`) has **no effect** under `'g8'`
  beyond selecting the target level - `arrangement/plan.js`'s own header already says style
  "has NO effect on the search today," and G8a's `realize()` auto-resolves its own pattern
  per section (hand-retention tier, meter) via `resolvePattern`/`policyForStage`, a
  fundamentally different vocabulary from `ScoreArranger`'s named styles. Forcing a
  name-based mapping between the two would manufacture an illusion of style control neither
  G7b nor G8a actually implements; not attempted here.
- **A real, MAJOR-severity scope gap found by independent review, not by this implementation's
  own "every real call site" search, and disclosed here rather than silently left out**: the
  review screen's DEFAULT style, `'balanced'` (`S.arrangementStyle || 'balanced'` - also the
  only style `easierArrangement()` ever requests), never reaches `applyRichReviewArrangement` at
  all. `applyArrangement()`/`rewriteRhythm()`/`aiArrangement()` only route to it for the "rich"
  `ScoreArranger` styles (`jazz`/`ballad`/`pop`/`waltz`/`bossa`/`cinematic`); for `'balanced'`
  they call `rewriteFromHeard()` instead, which uses a THIRD, entirely separate legacy engine
  (`audio-score.js`'s `arrangeNotes`) with no `ARRANGER_MODE` check anywhere in that path. **This
  means `PPP.arranger = 'g8'` has zero effect on the review screen's default/most-common
  arrangement request** - a user who never touches the style picker, or clicks "easier
  arrangement," gets neither `ScoreArranger` nor G8a's realizer; this style path is completely
  unaffected by the switch in either direction. This is pre-existing behavior (the
  style-conditional routing predates this phase) and poses no live risk today (the switch
  defaults to `'legacy'` regardless), but it means §5's acceptance wording ("Switch on ('g8'):
  the review screen's arrangement flow produces a real G8a-realized ScoreGraph") is true only for
  the non-default rich styles, not for the review screen's arrangement flow as a whole. Anyone
  using G8a's coverage or H-8 review-readiness numbers to reason about what real users would see
  under a future default flip must account for this: `'balanced'`-style requests would need
  their own, separate wiring (out of scope here) before a flip could mean what it sounds like it
  means. Flagged for whoever next touches this switch's default, not fixed in this phase.
- **`saveSongArrangement`/`aiSongArrangement`: deliberately NOT wired to `'g8'` this phase.**
  This doc's §3/§4 named `applyRichReviewArrangement` as the S4 fix target because it alone
  has TD2's defect (a `built.graph` already in scope, discarded); `saveSongArrangement`
  has no such defect - its only route to a ScoreGraph would be
  `scoregraph/legacy-score.js`'s `fromScore(score)`, which (confirmed directly, in its
  source, not assumed) never sets `Staff.limb`/`Voice.limb` - the SAME real, already-known gap
  `docs/GOALS/G08_ARRANGEMENT_REALIZATION.md` §14 documents finding and having to work around
  in a harness, not in `fromScore` itself. Using it here would silently starve G7a/G7b of
  real hand information for every Song Arranger call, a correctness risk this phase's actual,
  scoped job (fixing TD2's XML re-parse) does not require taking on. Left on the legacy path
  only; a future phase that wants `'g8'` here needs either a real `fromScore` limb fix or an
  equivalent adapter - not attempted here to avoid an undisclosed, broader `scoregraph/*`
  change beyond this phase's actual scope.

**The S6 retirement decision: NOT retired, deliberately.** Given the confirmed COACH_URL
finding above - `arrange_score.py` is the real, currently-PRIMARY engine for the `'legacy'`
path in production (`arrangeWithService` is tried first; `ScoreArranger.arrange()`'s pure-JS
fallback only runs on a genuine engine error) - and given `'legacy'` stays this phase's
default for every user, deleting `arrange_score.py`/its endpoint/the wire-score round trip now
would silently change what every production user actually gets (forcing everyone onto the
browser-fallback engine always, under the unchanged `'legacy'` label) - a real behavioural
regression that would violate this doc's own §5 acceptance bar ("byte-identical to before this
phase when the switch is off"). This doc's own §3/§4 phrasing ("to be retired (deleted), not
ported") is corrected here: that phrasing was written before this phase's own investigation
found the deployed `render.yaml`/`omr-service.js` wiring, and does not hold. `arrange_score.py`,
`wireScore`/`fromEngine`/`arrangeWithService`, and the `/arrange-score` endpoint are all left
in place, exactly as this doc's own §4 anticipated as the fallback outcome - the same two-step
pattern G4 used for the legacy renderer (flip first, remove dead code only once the fallback
counter is provably at zero). Full retirement is a later, separate decision, gated on the
`PPP.arranger` default actually flipping to `'g8'` and staying stable - not this phase's call
to make.

**Tests**:
- `tests/realize/app-arranger-extract.js` (new): extracts `realizeWithG8`/
  `graphToReviewScore`/`ARRANGER_LEVEL_TO_STAGE`/`ARRANGER_HAND_PROFILES` directly from the
  real app file (the same technique `tests/playability/score-arranger-extract.js` and
  `tests/engrave/helpers.js`'s `appFinalize()` already use), wired to real Node-side
  equivalents of the four names it closes over (`window`, `tx`, `Score`,
  `loadArrangerReference`) - real `songgraph/index.js`/`arrangement/index.js`/
  `realize/index.js` via `require()` (byte-identical to the browser path per the vm check
  above), `tests/engrave/helpers.js`'s own `appFinalize()` for `Score.finalize`, and a
  Node-side `loadArrangerReference` reading the same two real committed files via `require()`
  instead of `fetch()`.
- `tests/realize/app-arranger.test.js` (new, `npm run test:realize`, 7/7 passing alongside
  the existing 9): the level/hand-profile crosswalk constants; a real corpus hymn realizing
  ok via `realizeWithG8` with a real per-section report; **the UNREACHABLE case** (G7b's own
  planted 2-octave-dyad-bass fixture, reused directly from `tests/arrangement/mutation.test.js`
  via the shared `mk()` helper - a real physical impossibility at any level/hand profile)
  failing cleanly with `reason:'UNREACHABLE'`, never a crash; **the degraded case** (the SAME
  real corpus file G7a/G7b/G8a's own suites all use, `for-all-the-saints`,
  `melodyConf=bassConf=0.0`) succeeding with `degraded:true`, never silently confident;
  `graphToReviewScore` producing a Score with **both** `hand:'l'` and `hand:'r'` present (the
  real regression this phase's own fix targets - `toScore`'s un-substituted default would
  make every note `'r'`); and a performance check (below).
- `tests/transcription.test.js` (extended, existing e2e section, gated on a real local
  transcription helper being present - the same gate the surrounding jazz-style block already
  has, so it does not run in every environment, including this one): `PPP.arranger`'s
  default/fallback via `page.evaluate`; a `'g8'` arrangement applied through the real UI
  (`[data-apply-arrangement]`) producing `importSource.arrangement.engine === 'ppp.g8a'` with
  both hands real; and, switching back to `'legacy'`, that the SAME jazz plan applied before
  ever touching `'g8'` produces a byte-identical result afterward (no cross-contamination
  from having visited `'g8'` mode). This extension could not be executed in this environment
  (no transcription helper installed here, confirmed via `node --check` syntax validation
  only) - a real, disclosed limit of what this phase could verify directly, not a claim it
  was run.
- `npm run test:realize` (16/16), `test:arrangement-planner` (17/17), `test:songgraph` (45/45),
  `test:playability` (32/32), `test:difficulty` (34/34): all pass, confirming this doc's own
  §6 promise (those Node module suites "should be unaffected") held, and that the app-file
  extraction techniques other suites depend on (`score-arranger-extract.js`, `appFinalize()`)
  still work against the modified file.
- The full inline app script (the `<script type="text/x-dc">` block spanning the whole file)
  was extracted and run through `node --check`: no syntax errors, over and above the
  per-function tests above.

**Performance** (§7): `realizeWithG8`'s own extracted test measured **17-23ms** end to end
(`analyze()` + the plan search loop + `realize()`, real reference data, a real corpus file) -
comfortably under a 200ms budget, and well inside G8a's own already-measured <1s/piece
realizer cost (`docs/GOALS/G08 §14`). The in-process call is a synchronous, same-tick
computation on data already in memory (no network, no subprocess) - unlike the old
`arrangeWithService` HTTP round trip (naturally async, but also naturally slower: a real
network request plus a Python subprocess spawn on the server). Since `applyRichReviewArrangement`
already runs inside an `async` method behind `this.setState({arrangementBusy:true, ...})` (a
busy-spinner state the UI already shows during the legacy HTTP call), calling `realizeWithG8`
(itself `async`, awaited) from that same spot introduces no new UI-thread-blocking behaviour
beyond what a ~20ms synchronous computation already implies - not large enough to need the
kind of explicit yielding/chunking G6b's `difficultyAssessment()` needed for a slower,
CPU-heavier per-note pass; confirmed by measurement, not assumed.

**What in this doc turned out wrong, corrected here**:
- §3/§4's "to be retired (deleted)" framing for `arrange_score.py`/S6 did not survive contact
  with the real deployed config (`render.yaml`) - corrected above; S6 is deliberately not
  done this phase.
- §3's cited line numbers for `applyRichReviewArrangement` (~13836+) and `saveSongArrangement`
  (~14478-14536) had drifted (now ~13963 and ~14631 respectively, before this phase's own
  edits) - re-verified fresh per this doc's own instruction, not trusted.
- The pre-implementation COACH_URL/OMR_URL hypothesis (this phase's own charter) is refuted,
  not confirmed - stated plainly per the task's own instruction to report either way.
- A real, previously-undocumented gap was found in `realize/*.js` (no UMD wrapper at all) and
  in `realize/index.js`'s `policyForStage`/`densityBand` (no `opts.reference` threading) -
  neither is mentioned anywhere in `docs/GOALS/G08_ARRANGEMENT_REALIZATION.md`, since G8a was
  never previously loaded outside Node. Both are now fixed, disclosed here in full per this
  task's own item 9 allowance.

**Scope discipline**: `realize/*`'s own algorithms (`resolvePattern`, `policyForStage`'s
density/subdivision policy itself, `theory.js`, `patterns.js`, `notation.js`'s actual logic),
`songgraph/*`, `arrangement/*`, `playability/*`, `difficulty/*` internals are otherwise
untouched - only the UMD-wrapper packaging and the one `opts.reference`-threading fix
described above, both disclosed, both confirmed behaviour-preserving for every existing Node
caller by the full existing test suite passing unchanged. No production flip; `PPP.arranger`
stays `'legacy'` by default, unchanged from this doc's own §1/§9.

**Update, G9e-lite (2026-09-30): `PPP.arranger` now has three modes.** `'legacy'` (default), `'g8'` (this phase, unchanged) and `'single'` (docs/GOALS/G09 §12, "G9e-lite: single-note option in the app": one note per hand through G9's candidates, repair and TD16, opt-in from a control on the review screen and the Song Arranger). Any other value is `'legacy'`. `'single'` closes the gap disclosed above for its own path: it is routed before the review screen's `'balanced'` choice, so the default texture takes it; `'g8'` still does not. `arrange_score.py` and the wire-score round trip are still the primary engine of the default and are not retired.
