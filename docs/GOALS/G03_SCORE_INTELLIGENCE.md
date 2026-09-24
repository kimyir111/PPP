# G03 — Professional Score Intelligence

음악적으로 같은 ScoreGraph를 **사람이 읽기 쉽고, 연주하기 쉽고, 전문 악보에 가까운 notation semantics**로 정리하는 Goal이다.

| | |
| --- | --- |
| 상태 | **독립 리뷰 NEEDS_FIX (G3 Reviewer, 2026-09-24, §28)** — BLOCKER 1 (G3a on이면 앱이 페달을 떼지 않음), MAJOR 6, MINOR 5, OPTIONAL 5. 음악 보존은 독립 검증으로 통과. 구현 PARTIAL (§27): G3a 구현, flip 안 함, G3b·자동 8va default OFF. human review(A36) 사용자 대기 — 세트 블라인드화 먼저 (M4). 설계 승인: Architect closeout 2026-09-24, D1–D8 Accepted (§22.1) |
| 기준 커밋 | `origin/main` = `cc509e2` (G2 closeout + Windows mutation fix) |
| 브랜치 / worktree | `g3-score-intelligence` / `D:/PPP-g3` |
| 선행 | G0 Quality Foundation, G1 ScoreGraph, G2 Score Import — 모두 CLOSED |
| 시작 검증 | `npm run test:scoregraph` → **132/132 pass** (Windows clean checkout, `cc509e2`, 이 세션) |
| 전환 단계 | `docs/ARCHITECTURE.md` §2의 S2 경계(`toMusicXml`) 뒤에 **graph → graph pass 층**을 하나 더 넣는다. S4–S5(렌더러·재생)는 건드리지 않는다 |
| 이 문서가 정하지 않는 것 | engraving 좌표·간격·충돌·줄바꿈·beam/stem/slur 기하 (G4), 편곡·반주 생성 (G7/G8), 박·템포·박자 추론 (§3.3), OMR/AMT 품질 |

---

## 목차

- [0. 요약](#0-요약)
- [1. Goal](#1-goal)
- [2. Current State — 측정한 사실](#2-current-state--측정한-사실)
- [3. 경계](#3-경계)
- [4. Design Principles](#4-design-principles)
- [5. Architecture — Pass Pipeline](#5-architecture--pass-pipeline)
- [6. Rhythm Normalizer](#6-rhythm-normalizer)
- [7. Tuplet — G1 F1의 canonical semantics](#7-tuplet--g1-f1의-canonical-semantics)
- [8. Voice Separation](#8-voice-separation)
- [9. Staff / Hand Assignment와 Playability](#9-staff--hand-assignment와-playability)
- [10. Key, Spelling, Accidentals](#10-key-spelling-accidentals)
- [11. Beams](#11-beams)
- [12. Phrase / Slur / Articulation](#12-phrase--slur--articulation)
- [13. Dynamics / Pedal / Ottava / Fingering](#13-dynamics--pedal--ottava--fingering)
- [14. Imported vs Inferred — 무엇을 건드리는가](#14-imported-vs-inferred--무엇을-건드리는가)
- [15. Preservation Budget과 Critic](#15-preservation-budget과-critic)
- [16. Idempotence와 결정론](#16-idempotence와-결정론)
- [17. Provenance](#17-provenance)
- [18. Schema Review](#18-schema-review)
- [19. Before / After — 실제 코퍼스 예](#19-before--after--실제-코퍼스-예)
- [20. Benchmark Extension](#20-benchmark-extension)
- [21. Human-quality Evaluation](#21-human-quality-evaluation)
- [22. 사용자 결정이 필요한 사항](#22-사용자-결정이-필요한-사항)
- [23. Acceptance Criteria](#23-acceptance-criteria)
- [24. 구현 단계](#24-구현-단계)
- [25. Out of Scope](#25-out-of-scope)
- [26. 위험](#26-위험)
- [부록 A. 이 세션의 측정 기록](#부록-a-이-세션의-측정-기록)

---

## 0. 요약

**G3의 문제는 schema가 아니라 producer다.** G1/G2의 schema v2는 G3가 필요로 하는 거의 모든 것을 이미 표현한다: 중첩 가능한 tuplet 그룹(`parent`), 단계별 beam break, courtesy/editorial 임시표, `display.stem`, 박 그룹(`MeterEvent.groups`), aspect별 provenance, 무손실 performance 층과 head 링크. 코퍼스에서 들여온 판각 악보(Burgmüller 021: beam 114, tuplet 114, slur 67, wedge 6, dynamic 8, ottava 1)는 그래프 안에서 온전하다. **부족한 것은 PPP가 스스로 쓰는 악보**다 — `audio-score.js`가 기보 결정을 한 번에 내리고, 그 뒤에서 아무도 정리하지 않는다.

**측정한 것** (core 553 예측 vs reference 141, §2, 부록 A):

| | reference | PPP | |
| --- | --- | --- | --- |
| 마디당 쉼표 | 0.57 | **3.40** | 6× |
| 32분음표 이하 비율 | 0.028 | **0.192** | 7× |
| 한 박 안에서 끝나는 (불필요한) tie / tie | 0.00 | **0.40** | |
| 1-음 tuplet 괄호 / 괄호 | 0.00 | **1.00** | G1 F1, 이슈 20 |
| time-modification 없는 셋잇단 길이 event | 0 | **2,647** (그중 쉼표 2,550) | 이슈 19 |
| 2성부 이상인 staff-마디 | 25.7 % | **0 %** | |
| beam / slur / dynamics / articulation | 있음 | **0** | |
| hand accuracy (human\|oracle) | – | 0.888, 141곡 중 27곡 < 0.8 | 이슈 6 |

**핵심 설계 판단 다섯 가지**

1. **G3는 graph → graph pass들의 순수 함수 pipeline이다** (`professionalize(graph) → {graph, report}`). `buildGraph`와 exporter 사이에 들어가고, 각 pass는 독립적으로 테스트되며 idempotent다 (§5, §16).
2. **Rhythm은 두 층으로 나눈다** (§6).
   - **R-repr (표현)**: 음의 onset과 tie로 합친 기보 길이를 **정확히 보존**하면서 음가 분할·tie·쉼표·tuplet·beat 경계만 다시 쓴다. 가독성 비용 함수 + DP.
   - **R-reg (정규화)**: 기보 길이 자체를 바꾼다 (32분음표 + 32분쉼표 → 16분음표). **이것은 "key release를 음가로 바꾸는 방법"의 변경이며 CURRENT_STATE의 M11 규칙에 걸린다.**
3. **그래서 G3를 G3a와 G3b로 나눈다.** G3a(표현·tuplet·hand·spelling·accidental·beam)는 지금 시작할 수 있다. G3b(R-reg, performance 기반 성부 분리, staccato 추론)는 실제 연주 3곡이 기록되고 baseline된 뒤에만 flip한다 (사용자 결정 **D1**). 가장 눈에 띄는 결함(쪼개진 리듬, 사라진 2성부)은 G3b 쪽이다 — 이것을 숨기지 않는다.
4. **G1 F1은 schema 변경 없이 고친다.** Tuplet spanner 하나가 논리적 셋잇단 하나이고, tie로 쪼개진 조각과 쉼표도 그 멤버다. start/stop은 exporter가 첫·마지막 멤버에서 파생하고 continue는 멤버십이다 (§7).
5. **들여온 악보는 기본적으로 건드리지 않는다.** `op:'imported'` entity는 보존하고, G3는 `op:'inferred'` notation(녹음·MIDI)만 다시 쓴다. imported에는 비어 있는 semantics만 채우는 `fill` 모드가 선택이다 (§14).

**Schema 변경: 필요 없다** (§18). `scoregraph_version`은 2 그대로. 필요한 것은 **ops 추가**(split·merge·retime·revoice·restaff), `ext['ppp.g3']` 네임스페이스 하나, validator WARNING 두 개다.

**Acceptance Criteria 40개** (§23), **구현 단계 16개** (§24), **사용자 결정 8개** 중 구현 전에 필요한 것은 D1–D3 (§22).

---

## 1. Goal

### 1.1 정의

> Input: raw / inferred / imported ScoreGraph
> Output: Professional ScoreGraph — **같은 음악**, 더 나은 notation semantics

"같은 음악"의 정의는 §15의 Preservation Budget이다. "더 나은"의 정의는 §20의 측정 가능한 proxy와 §21의 human review protocol이다.

### 1.2 G3가 하지 않는 것

- 원곡을 새로 편곡하지 않는다. 멜로디·코드·반주 패턴을 만들지 않는다.
- 음을 더하거나 빼지 않는다 (예외 없음. 겹친 같은 음 합치기도 G3 밖, §8.4).
- performance 층(`graph.performances`)을 한 바이트도 바꾸지 않는다.
- 박·템포·박자를 다시 추론하지 않는다 (§3.3).
- 좌표 기반 engraving을 하지 않는다 (§3.2).

### 1.3 성공의 모양

- 녹음/MIDI에서 나온 악보가 **G0 gate를 하나도 잃지 않으면서** 알려진 표기 결함(이슈 19, 20, F1, 불필요한 tie, 1-음 괄호, 박을 숨기는 음가)이 0이 된다.
- 들여온 판각 악보가 G3를 지나도 **semantic projection이 바뀌지 않는다**.
- `professionalize(professionalize(g))`가 `professionalize(g)`와 canonical JSON 바이트로 같다.
- 작은 human-reviewed golden set에서 G3 출력이 raw 출력보다 낫다는 판정이 규정된 비율 이상이다.

---

## 2. Current State — 측정한 사실

### 2.1 시작 검증 (이 세션)

```
pwd                         → /d/PPP-g3
git rev-parse --show-toplevel → D:/PPP-g3
git branch --show-current   → g3-score-intelligence
git status --short          → (clean)
HEAD == origin/main         → cc509e2 (cc509e2가 HEAD의 조상: OK)
npm run test:scoregraph     → tests 132, pass 132, fail 0
```

`D:/PPP` worktree와 local `main`의 `d82bb71`은 읽지도 쓰지도 않았다.

### 2.2 기보 결정은 지금 어디서 내려지는가

모든 기보 결정은 `audio-score.js`에서 **한 번** 내려지고, 그래프가 만들어지기 전이다. `buildGraph`는 그것을 결함까지 옮긴다 (G1-D14). 앱은 그 뒤에서 몇 가지를 **렌더러가 스스로** 다시 정한다.

| 결정 | 지금 위치 | 성격 |
| --- | --- | --- |
| 박·템포·박자·위상 | `trackBeats`, `tryFastTempo`, `meterAndPhase` `:707`, `compoundVsThree` `:731`, `compoundTactus` `:1601` | 연주 추론 (M11) |
| onset snap | `snapStraight` `:504` (오차×초/박 + 가독성 벌점 `LEVEL_COST_16`), `snapTriplet` `:538`, `tripletBeats` `:573` | 연주 추론 (M11) |
| release → 음가 | `snapEnd` `:556`, `staffEvents` `:982` (화음은 아래쪽 중앙값 release 하나, 간격 ≤20 %만 닫음 `:1001-1008`), `readableEnd` `:924` (simple time만) | **연주 추론 (M11)** — 이슈 18 |
| 음가 분할·tie | `pieces` `:940` (쉼표), `notePieces` `:971`, `TYPES` `:902`, `perBar` `:1197` | 표현 — **G3** |
| 셋잇단 표기 | `tupletOf` `:907` (길이 8·16·4 tick만), 조각마다 spanner `:1265`, 쉼표는 time-mod 없음 `:1224` | 표현 — **G3** (이슈 19, 20, F1) |
| 성부 | staff 1 = voice "1", staff 2 = voice "5" 고정 `:1181`; 같은 tick 같은 음은 중복 제거 `:989` | 표현 + 연주 (§8) |
| 손·staff | `assignHands` `:863` DP, `splitCost` `:840`, `centreSplit` `:853` — onset 묶음마다 음높이만 | 표현 — **G3** (이슈 6) |
| 조·철자 | `estimateKey` `:770` (곡 전체에 하나, 이슈 5), `spellingTable` `:821` (조별 정적 표) | 표현 — **G3** |
| 임시표 표시 | `buildGraph` `:1239-1245` (마디·staff·step+oct 상태, tie 이음 억제, courtesy 없음) | 표현 — **G3** |
| 페달 | `finish` `:1375-1397` (AMT 구간을 tick으로, 16분 미만 버림, 이어진 것은 change) | 존재 여부는 AMT(이슈 17); 표기 정리는 G3 |
| beam, slur, dynamics, articulation, ottava, fingering | **쓰지 않는다** | |

앱 쪽 (`Piano Coach App.dc.html`):

- `Score.finalize` `:3541`은 기보를 정규화하지 않는다 (배치, `abs`, ottava 소리 이동(이슈 3), 정렬).
- 렌더러 `buildVoice` `:11458`이 스스로 정하는 것: beam(그래프·파일의 beam 무시, `:11560-11580`), tuplet 괄호 재묶음(`:11583-11611`, F1의 조각 괄호를 합쳐 그린다), stem(성부 평균 음높이), 쉼표 위치, 빈 곳은 `GhostNote`, inferred audio의 마디 안 tie 생략(`:11066`).
- `legacy-score.js` `toScore`는 beam을 **읽지 않는다** (0회). 그래프의 beam은 MusicXML exporter에만 닿는다.
- 운지는 앱 런타임 모델(`:8279`, Parncutt/Jacobs DP)이고 그래프에 저장되지 않는다.

### 2.3 코퍼스 측정 (core 553, reference 141, 파일 단위 통계)

전문은 부록 A. 요약:

| metric | REF | pred 전체 | deadpan\|none | human\|oracle | pedal\|oracle |
| --- | --- | --- | --- | --- | --- |
| 마디당 쉼표 | 0.567 | **3.401** | 2.620 | 3.161 | 4.052 |
| 32분 이하 비율 | 0.028 | **0.192** | 0.191 | 0.185 | 0.250 |
| tie / 음 | 0.003 | 0.030 | 0.029 | 0.017 | 0.026 |
| 한 박 안 tie / tie | 0.000 | **0.398** | 0.434 | 0.449 | 0.395 |
| 3조각 이상 tie 사슬 / tie | 0.023 | 0.095 | 0.041 | 0.014 | 0.028 |
| 괄호 시작 / tuplet 음 (이상 ≈ 0.33) | 0.322 | **0.789** | 0.871 | 0.800 | 0.762 |
| 1-음 괄호 / 괄호 | 0.000 | **1.000** | 1.000 | 1.000 | 1.000 |
| time-mod 없는 셋잇단 길이 event | 0 | **2,647** | 210 | 367 | 202 |
| staff-마디당 성부 | 1.257 | **1.000** | 1.000 | 1.000 | 1.000 |
| 2성부 이상 staff-마디 | 0.257 | **0.000** | 0 | 0 | 0 |
| 조와 무관한 E♯/B♯/C♭/F♭ / 1000음 | 0.31 | 0.17 | 0.18 | 0.18 | 0.09 |
| ♯·♭ 섞인 staff-마디 | 0.002 | 0.005 | 0.006 | 0.005 | 0.009 |
| 인쇄 임시표 / 음 | 0.027 | 0.035 | 0.035 | 0.034 | 0.040 |
| 덧줄 4개 이상 / 1000음 | 8.3 | 12.6 | 11.2 | 11.6 | 28.5 |
| 옥타브 기호 / 파일 | 0.13 | **0** | 0 | 0 | 0 |
| 페달 시작 / 파일 | 0.11 | 1.5 | 0 | 0 | 27.6 |
| dynamics / wedge / slur / articulation / 파일 | 3.0 / 1.6 / 10.7 / 18.3 | **0** | 0 | 0 | 0 |
| beam된 음 비율 | 0.468 | **0** | 0 | 0 | 0 |

**박자별** (human\|oracle vs REF): simple 마디당 쉼표 2.88 vs 0.53, 32분 비율 0.198 vs 0.020, 한 박 안 tie 0.56; compound 4.05 vs 0.68, 0.147 vs 0.051, 0.19 (deadpan 0.45).

**핵심 관찰 — 쪼개진 리듬은 release 정책이다.** `deadpan` 연주자는 박·onset이 완벽하고 release만 **40 ms 이르다** (`tests/bench/pppbench/perform.py:17`, `gap: (0.040, 0.040)`). 그것만으로 마디당 쉼표가 0.57 → 2.62가 된다. 즉 "32분 + 32분쉼표"는 박 추론의 실패가 아니라 **release를 음가로 바꾸는 규칙**의 결과이고, 그 규칙을 바꾸는 것은 M11 규칙의 대상이다 (§6.4, D1).

**ScoreGraph validator가 이미 본다.** 553개 예측 전부를 `validate`에 넣으면 `W-DISPLAY-DURATION` 2,647 (107 파일, 위 표의 time-mod 누락과 같은 수), `W-TUPLET-INCOMPLETE` 8,144 (114 파일), `W-TEMPO-MARK-MISMATCH` 189. **어느 gate도 이 경고를 읽지 않는다.**

### 2.4 들여온 악보 쪽

- `known-defects`: `note_shape_mismatch` 4 파일 8건 (Für Elise 2·4마디 dotted eighth = 4분 길이 등), `tie_without_stop` 16 파일 121건 (hymn 변환기 버그, 이슈 10).
- ScoreGraph import는 이것을 `report.issues`에 올리지 않는다. 별도 `validate()`만 `W-DISPLAY-DURATION`·`W-TIE-OPEN`으로 낸다.
- hymn은 4성부 코랄 배치, spanner 없음. OMR fixture는 4분음표 48개(단순). 실제 OMR 출력은 커밋돼 있지 않다.

### 2.5 G0가 지금 보지 못하는 것

1. 성부 수와 배치 (metric 없음; golden만 voice 변화를 STRUCTURAL로 표시).
2. tuplet **묶음** — `tuplets.f1`은 존재 여부만 본다. 1-음 괄호 100 %가 보이지 않는다.
3. 셋잇단 안 쉼표 모양 — `note_shape.consistency` 0.991 평균으로만 보이고, gate는 현재 수를 얼린다.
4. beam, stem (G4로 미뤄져 있었음).
5. **필요 없는** tie — `ties.extra_per_100`은 ref에 없는 tie를 센다. 한 음가로 쓸 수 있는 tie인지는 모른다.
6. 리듬 파편화 — `read.short_notes_rate`, `read.rests_per_measure`는 진단용이고 gate가 없다.
7. compound 박 묶음 (6/8에서 점4분 박이 보이는가).
8. dynamics, slur, articulation, fingering — metric 없음.
9. ottava — 덧줄 metric도 없다.
10. 문맥 속 철자 (조와 무관한 E♯, 마디 안 ♯/♭ 혼용). hymn 78곡은 key·spelling metric을 건너뛴다.
11. 손이 왜 틀렸나 (음높이 분할, 멜로디 음이 왼손 화음으로, 양손 옥타브 병행이 한 staff로).
12. import 시점의 기보 오류 (validate만 본다).

**G1 F1이 바로 이런 경우였다**: G0 reader는 `<time-modification>` 비율만 읽고 `<tuplet>` start/stop을 읽지 않아서, 앱이 그리는 괄호가 29개 → 0개가 되는 변화를 볼 수 없었다 (G01 §25.3).

---

## 3. 경계

### 3.1 G3가 결정하는 것 (notation semantics)

note/rest 기보 길이의 **표현**, 양자화된 리듬의 표현, voices, staff / hand(limb), ties, rests, beams(**그룹 멤버십과 break 단계**), tuplets(**논리 그룹·비율·중첩**), enharmonic spelling, 인쇄 임시표(필요·courtesy), clef change, ottava **구간**(단, §13.3의 제약), phrase/slur semantics(보존), articulation semantics(보존), dynamics/pedal semantics(보존과 표기 정리), notation simplification, playability-aware 결정.

### 3.2 G4가 결정하는 것 (engraving)

spacing, collision avoidance, system/page break, margin, staff 거리, **beam 기하**(기울기·높이), **stem 기하**(방향 포함 — G3는 `display.stem`을 쓰지 않는다), slur 곡선, 쉼표 세로 위치, tuplet 괄호를 **보일지**(beam과 일치하면 숫자만 등), 임시표 배치, fingering 배치, 최종 PDF/PNG. 렌더러가 그래프의 G3 결정(beam, tuplet 그룹)을 **읽게 되는 것**(S5)도 G4다.

G3는 좌표를 만들지 않는다. G3가 쓰는 필드는 전부 시간·멤버십·철자·열거값이다.

### 3.3 연주 추론과의 경계 (G0 M11)

`docs/CURRENT_STATE.md` "What the benchmark leaves out": **onset·박·템포·박자를 추론하는 방법이나 key release를 음가로 바꾸는 방법을 바꾸는 첫 Goal 전에** 라이선스가 깨끗한 실제 연주 3곡(simple duple, simple triple, compound)을 녹음하고 baseline해야 한다. "writer, ScoreGraph, engraving만 바꾸는 Goal은 필요 없다."

| G3 부분 | M11 대상? | 이유 |
| --- | --- | --- |
| R-repr (§6.2), tuplet 묶음 (§7), 손·staff (§9), 철자·임시표 (§10), beam (§11), 표기 보존 (§12–§13) | **아니다** | 입력 그래프의 onset과 기보 길이를 그대로 두고 표현만 바꾼다. writer/ScoreGraph 변경이다 |
| R-reg (§6.4), performance 기반 성부 분리 (§8.3), 간격 → staccato (§12.3) | **그렇다** | release를 음가로 바꾸는 규칙을 바꾼다 |
| onset re-quantization, 박자 재추론, tempo | G3 밖 | `audio-score.js` quantizer에 남는다 (이슈 1, 2는 별도 Goal) |

그래서 **G3a**(M11 무관)와 **G3b**(M11 대상)로 나눈다. G3b의 코드는 G3 안에서 만들고 측정하되, 기본값 flip은 M11 baseline 뒤다 (D1).

### 3.4 G7/G8과의 경계

G3는 "무엇을 연주하나"를 바꾸지 않는다. 음 추가·삭제·음높이 변경·반주 패턴·재화성은 전부 G7/G8. G3의 모든 변경은 §15 budget을 통과해야 하고, budget은 **울리는 음 다중집합과 onset**을 고정한다.

### 3.5 문서 간 모순 정리

schema 감사에서 선행 문서 사이의 모순 두 개가 나왔다. 이 문서가 정리를 **제안**한다 (D3).

| 항목 | G01 | G02 | G3 제안 |
| --- | --- | --- | --- |
| 자동 임시표, `derive.display`, 이슈 19 | G4 (§5.7, §14.3, §13.3) | G3 (§3E, §21) | **semantics(어떤 head에 acc가 있나, courtesy인가, event의 type/dots)는 G3, 배치는 G4** |
| 손 추론 | G5 (§8.2) | G3 (§7.5–7.6) | **limb 배정은 G3**. 운지는 G3 밖 (§13.4) |

---

## 4. Design Principles

| # | 원칙 | 결과 |
| --- | --- | --- |
| P1 | **음악은 고정, 표현만 움직인다** | 모든 pass는 §15 fingerprint를 보존하거나, 자기 tier가 허용하는 차이만 선언한다 |
| P2 | **작은 pass, 한 가지 책임** | giant mutation 없음. pass마다 단위 테스트·idempotence 테스트·sidecar fixture |
| P3 | **기존 것을 쓴다** | schema v2, ops, validator, provenance, G0 bench. 새 schema를 만들지 않는다 |
| P4 | **imported는 보존, inferred는 다시 쓴다** | `provOf(entity, aspect).op`가 pass의 권한을 정한다 (§14) |
| P5 | **규칙 먼저, 최적화는 좁게, 학습은 나중** | 결정론적 규칙 표 + 작은 DP. 모델 학습은 하지 않는다 |
| P6 | **정직한 실패** | 표현 불가능한 리듬, budget을 넘는 변경은 **바꾸지 않고** report에 남긴다 |
| P7 | **측정으로 flip** | shadow → A/B → flip (G1 `legacyWriter`, G2 `legacyImport`와 같은 모양). 되돌리기는 스위치다 |
| P8 | **M11을 우회하지 않는다** | release→음가 변경은 G3b, 기본값 off |

---

## 5. Architecture — Pass Pipeline

### 5.1 위치

```
heard notes ─► audio-score quantizer ─► buildGraph ─► ScoreGraph(raw, op:inferred)
                                                           │
.mid ─► fromMidi ─► (same) ────────────────────────────────┤
                                                           ▼
                                        professionalize(graph, opts) ─► {graph, report}
                                                           │
                                                           ▼
                                        musicxml.export ─► MusicXML ─► (앱, G0)
.musicxml/.mxl ─► importScore ─► ScoreGraph(op:imported) ─► [fill 모드일 때만 professionalize] ─► toScore
```

- 진입점: `toMusicXml` 안, `buildGraph` 다음·export 전. MIDI는 `fromMidi` → `toMusicXml`이라 자동으로 덮인다.
- 스위치: `opts.professional` — `'off'` (기본, Step 0–12), `'shadow'` (둘 다 만들고 raw를 돌려준다, report만), `'on'` (flip 후 기본). 되돌리기: `opts.professional = 'off'`.
- 반환값에 `proReport`를 더한다. `graph`는 professional 그래프다.

### 5.2 모듈 (전부 `scoregraph/` 안: SUT 폐쇄성과 브라우저 로드가 자동으로 따라온다)

```
scoregraph/
  meter-grid.js      박 계층 (MeterEvent.groups 또는 기본 표), 위치의 metric level, 허용 음가 표
  pro.js             professionalize(): pass 순서, 모드, report, critic 호출
  pro-staff.js       P2 손·staff 배정, clef change
  pro-voice.js       P3 성부 (G3a: 재번호·정리, G3b: performance 기반 분리)
  pro-rhythm.js      P4 R-repr (분할·tie·쉼표·beat 경계), P4b R-reg (G3b)
  pro-tuplet.js      P5 논리 tuplet 묶음 (F1)
  pro-spell.js       P6 조(구간별), 철자, 임시표
  pro-beam.js        P7 beam 그룹과 break
  pro-marks.js       P8 페달 표기 정리, 표기 보존 확인
  pro-critic.js      fingerprint, budget, readability proxy
  ops.js (확장)       splitEvent, mergeTied, retimeVoiceMeasure, setVoice, setStaff, setTuplets, setBeams, setAcc
```

앱은 `scoregraph/*.js`를 `audio-score.js` 앞에 순서대로 로드한다 (G1 A43). 새 파일은 그 목록과 `browser-load.test.js`에 들어간다.

### 5.3 Pass 순서와 그 이유 (의존성 조사)

| # | Pass | 읽는 것 | 쓰는 것 | 앞에 와야 하는 이유 |
| --- | --- | --- | --- | --- |
| P0 | **Snapshot** | 전체 | – | fingerprint (§15)와 입력 report |
| P1 | **Structure check** | 마디, meter, key, 반복 | – (읽기 전용) | 박자·마디는 G3가 바꾸지 않는다. 박 계층(`meter-grid`)을 이후 pass에 준다 |
| P2 | **Staff / limb** | onset 묶음, 음높이, 길이 | `event.staff`, `voice.staff`, 이동한 음의 event 분리, clef | 성부는 staff 안에서 정의된다. 리듬 표현은 성부 안에서 정의된다 |
| P3 | **Voice** | staff 안 event 흐름 | `event.voice`, Voice entity | 리듬 분할·쉼표 채움·tuplet·beam은 전부 성부 단위다 |
| P4 | **Rhythm (R-repr)** | 성부-마디의 (onset, 길이) 목록 | event 분할·병합, tie, 쉼표, `display` | tuplet 묶음은 최종 조각이 정해진 뒤에 한다 |
| P4b | *(G3b)* **Rhythm (R-reg)** | performance 링크 | 기보 길이 | R-repr 앞에서 실행되고 R-repr가 뒤따른다 (§6.4) |
| P5 | **Tuplet** | 성부의 time-mod 조각 | Tuplet spanner (멤버·unit·parent) | beam은 tuplet 경계를 존중한다 |
| P6 | **Key / spelling / accidentals** | head 음높이, 마디, staff, tie | KeyEvent(구간별), `head.pitch` 철자, `head.acc` | 임시표 상태는 staff·마디·tie 이음에 의존한다 (P2, P4 뒤). 철자는 리듬과 독립이지만 임시표와 한 pass에 둔다 |
| P7 | **Beam** | 성부, `display.type`, tuplet, 박 계층 | Beam spanner | 음가(P4)와 tuplet(P5) 뒤 |
| P8 | **Marks** | pedal, dynamics, slur, arts | 페달 표기 정리만 | 이동·분할된 event에 붙은 기호의 anchor 재확인 (idMap) |
| P9 | **Critic** | P0 snapshot, 결과 | report, (위반 시) 마디 단위 rollback | 마지막 |

철자(P6)를 앞으로 옮기지 않는 이유: 철자는 staff와 무관하지만 **임시표 상태**가 staff·마디·tie에 걸려 있고, 둘을 나누면 같은 head에 두 번 손대는 pass가 둘이 된다. 철자 결정만 따로 테스트할 수 있게 `pro-spell.js` 안에서 `spell()`과 `accidentals()`는 분리된 함수다.

### 5.4 Pass 계약

```js
/** @returns {{graph, idMap, changes: Change[], issues: Issue[]}} */
pass(graph, ctx)   // ctx = {mode, grid, opts, report}
```

- 입력 그래프를 바꾸지 않는다 (G1-D4). 바꿀 것이 없으면 **같은 객체**를 돌려준다 (`===`) — idempotence의 구현 조건 (§16).
- `changes[]`는 `{pass, kind, ids, m, before, after}`. report와 critic이 쓴다.
- 모든 변경은 `ops.*`를 통한다. pass가 그래프 JSON을 직접 조립하지 않는다 (ID 규칙 G01 §12.3이 한 곳에 있게).
- pass 하나를 끌 수 있다: `opts.passes = {beam: false, ...}`. 테스트와 bisect용.

### 5.5 새 ops (G01 §12.3 표의 구현)

| op | ID 규칙 (G01 §12.3) |
| --- | --- |
| `splitEvent(g, e, at)` | 앞 조각이 event·head 유지, 뒤 조각·사이 tie는 새 ID |
| `mergeTied(g, e1, e2)` | 앞 event 유지, `idMap`: 뒤 → 앞 |
| `retimeVoiceMeasure(g, v, m, plan)` | `replaceRegion`의 좁은 판. plan의 조각은 기존 ID를 **앞에서부터 재사용**하고 모자라면 새 ID. slur/dynamic anchor는 idMap으로 옮긴다 |
| `setVoice`, `setStaff` | event·head 유지 |
| `setTuplets(g, v, m, groups)` | 기존 tuplet spanner를 **멤버 집합이 같으면 유지**, 다르면 은퇴·새 ID |
| `setBeams(g, v, m, groups)` | 같은 규칙 |
| `setAcc(g, h, acc)`, `setSpelling(g, h, pitch)` | head 유지, `rev` +1 |

`replaceRegion`이 구간 안의 direction·wedge·pedal을 지우지 않는다는 점(감사에서 확인)은 `retimeVoiceMeasure`에서 **anchor 보존 테스트**로 고정한다 (A30).

---

## 6. Rhythm Normalizer

### 6.1 입력은 이미 유리수다

녹음 경로의 그래프는 `buildGraph`가 24 tick/quarter 격자에서 만든 **정확한 유리수**다. MIDI도 같은 quantizer를 지난다. MusicXML import는 원래 유리수다. 따라서 "연속 시간 → 유리수"의 **추론**은 G3 입력 전에 끝나 있고, 그것은 `audio-score.js` quantizer의 몫이다 (§3.3).

G3의 Rhythm Normalizer가 하는 것은 두 가지다.

| 층 | 입력 → 출력 | 보존 | M11 |
| --- | --- | --- | --- |
| **R-repr** | 성부-마디의 sounding 구간 목록 → 음가·tie·쉼표·tuplet 표현 | onset, tie-merged 기보 길이, 쉼표 구간 **정확히** | 무관 |
| **R-reg** | 기보 구간 목록 + performance 링크 → 더 단순한 기보 구간 | onset 정확히, release는 budget 안에서 이동 | **대상** |

performance 층(µs)은 두 층 모두 읽기만 한다.

### 6.2 R-repr: 표현 문제의 정의

한 성부-마디의 입력은 겹치지 않는 구간 목록 `[(start, end, kind∈{note,rest}, heads)]`이다 (인접한 쉼표는 하나로 합친 뒤). 출력은 각 구간을 덮는 **기호열**이다: 기호 = (음가 type, dots, tuplet 사슬), 같은 구간의 기호끼리는 tie(음) 또는 연속(쉼표).

**가능한 분할 지점**: 구간 안의 점 중 박 계층(`meter-grid`)의 격자점. 격자는 마디 → 박 그룹 → 박 → 반박 → … → 입력에 나타난 가장 작은 분모까지.

**하드 제약** (위반하는 표현은 후보가 아니다)

| # | 제약 |
| --- | --- |
| H1 | 기호 길이의 합 == 구간 길이 (유리수 정확) |
| H2 | 기호는 마디선을 넘지 않는다 (schema가 이미 강제, E-MEASURE-OVERFLOW) |
| H3 | 쉼표는 박을 넘지 않는다. 예외: 온마디 쉼표(`measureRest`), 4/4의 1–2박·3–4박 2분쉼표, compound의 박 그룹 단위 점음표 쉼표 |
| H4 | compound meter(분자 6·9·12, 분모 8·16)에서 점4분 박 경계를 **가리는** 기호 금지. 허용 예외: 박에서 시작해 박 그룹 끝까지 가는 기호 (6/8의 점2분 등) |
| H5 | simple meter에서 **가운데 박**(4/4의 3박, 2/2의 2박)을 가리는 기호는 그 박이 기호 안에서 시작하지 않을 때만 금지 — 즉 박에서 시작한 기호는 허용 목록(§6.3 S표)에 있을 때만 가운데를 넘는다 |
| H6 | 셋잇단 기호는 자기 tuplet 그룹 구간(§7.3) 밖으로 나가지 않는다 |
| H7 | 점은 최대 2개. 겹점 기호는 해당 음가가 박 계층에 정확히 맞을 때만 |
| H8 | 입력 음가 표현이 불가능하면(분모가 격자에 없음 — 7연음 조각, 1/7 등) **바꾸지 않는다**: 원래 기호를 두고 `N-RHYTHM-UNREPRESENTABLE` |

**가독성 비용** (최소화; 동점은 §16.2 결정론 규칙)

```
cost = Σ_symbol [ 1.00                        # 기호 수 (파편화)
                + 0.60 · tie_in               # 이 기호로 들어오는 tie
                + 0.25 · dots + 0.40 · [dots==2]
                + 0.50 · hides(level)         # 기호가 가리는 metric level (level이 높을수록 크게: 박 그룹 1.0, 박 0.5, 반박 0.25)
                + 0.30 · [dur < 1/16 W] ]     # 32분 이하
     + 0.80 · Σ rests_split_off_beat          # 박에서 시작하지 않는 쉼표를 둘 이상으로 쪼갬
```

- 가중치는 **초기값**이고, Step 5에서 R-fixture(§6.3)가 전부 맞는 가장 단순한 값으로 고정한 뒤 `meter-grid.js`에 상수로 커밋한다. 이후 바꾸면 golden이 알린다.
- 풀이: 구간마다 격자점 위의 DP (상태 = 위치, 전이 = 허용 기호 하나). 구간 수 × 격자점² 이하이고, 한 마디 격자점은 수십 개다. 2,000마디 성부에서 선형.
- **syncopation**은 비용으로 다룬다: 박을 가리는 기호가 tie로 박을 드러내는 표현보다 비싸지만, 표준 허용 패턴(S표)은 `hides` 벌점을 면제받는다.

### 6.3 규칙 표와 R-fixture

**S표 — 박을 가려도 되는 표준 패턴** (면제 목록, 박 계층으로 정의)

| 박자 | 허용 |
| --- | --- |
| 2/4 | 8 4 8 (반박 syncopation), 점4분 + 8 |
| 3/4 | 4 2, 2 4, 점2분. `8 4 4 8`은 **불허** (반박에서 시작한 4분이 박을 가린다) → `8 8~8 8~8 8` |
| 4/4 | 4 2 4 (가운데 2분), 점2분 + 4, 8 4 8 한 박 그룹 안, 2 + 2 |
| 2/2 | 4 2 4 |
| 6/8 | 4 8 (박 안), 점4분, 점2분; 8 4 박 안 |
| 9/8, 12/8 | 박(점4분)별 6/8 규칙, 점2분은 그룹 경계에 맞을 때 |
| 3/8 | 점4분, 4 8, 8 4 |
| 5/8, 7/8 | `MeterEvent.groups`가 있으면 그 그룹이 박 그룹, 없으면 2+3 / 2+2+3 (기본) |

S표는 일반 판각 관례를 이 저장소의 박 계층으로 옮긴 것이고, 경계 사례는 R-fixture가 최종 판정한다 (R07: 3/4의 `8 4 4 8`).

**R-fixture** (`tests/scoregraph/fixtures/g3/rhythm/R01–R24.json` + sidecar: 입력 구간 → 기대 기호열)

| # | 내용 |
| --- | --- |
| R01–R04 | 4/4 기본: 박 안 tie 합치기 (`8~8` 한 박 안 → `4`), 가운데 박 tie, 점음표, 겹점 |
| R05–R07 | 3/4, 2/4 syncopation 허용·불허 |
| R08–R11 | 6/8: `8.~16` → `4` (박 안), 점4분 박 드러내기, hemiola(3/4처럼 들리는 6/8 마디는 **tie로 박을 드러낸다** — 박자는 G3가 바꾸지 않는다), 12/8 |
| R12 | 3/8, 9/8 |
| R13 | 5/8 groups 2+3, 7/8 |
| R14 | pickup (implicit 첫 마디) — 오른쪽 정렬 격자 |
| R15 | 마디를 넘는 tie (분할만 확인, 합치지 않는다) |
| R16 | 쉼표: 박 경계, 온마디 쉼표, 2분쉼표 허용 위치 |
| R17 | 1-tick(64분) 잔여 쉼표 — **R-repr는 그대로 둔다**, R-reg fixture와 짝 |
| R18 | 셋잇단 안 쉼표 (이슈 19) |
| R19 | 셋잇단 + tie 조각 |
| R20 | 5:4, 중첩 3:2 in 5:4 (import 경로) — 보존 |
| R21 | grace note — 건드리지 않음 (`dur 0`, 주음 앞 순서 유지) |
| R22 | 표현 불가 (7연음 조각) → 변화 없음 + `N-RHYTHM-UNREPRESENTABLE` |
| R23 | 이미 깨끗한 입력 → **같은 객체** (idempotence) |
| R24 | imported 마디 → 변화 없음 (권한, §14) |

### 6.4 R-reg (G3b): 기보 길이의 정규화

이것이 이슈 18(쪼개진 리듬)의 실제 해결이다. **M11 대상이며 기본값 off**다 (D1).

**문제**: 성부-마디의 기보 구간과, 각 음에 링크된 PerfNote(`on`, `off` µs)와 마디 anchor가 주어질 때, onset은 고정하고 **release만** 움직여 R-repr 비용 + 변형 비용이 최소인 구간 목록을 고른다.

```
cost_reg = cost_repr(표현) + λ · Σ_note |notated_end' − notated_end| / IOI_note
제약:
  C1  onset 불변
  C2  notated_end' ≤ 다음 onset (같은 성부)   — 겹침 금지
  C3  |notated_end' − notated_end| ≤ max(1/32 W, 0.35 · IOI)   — budget (§15)
  C4  notated_end'가 음 앞 release보다 짧아지는 방향으로는 움직이지 않는다 (들린 것보다 짧게 쓰지 않는다)
  C5  release가 IOI의 50 % 이하에서 끝났으면 (분명한 끊음) 쉼표를 유지한다 — 선택: staccato 표기 (§12.3)
```

- `λ`는 R-reg fixture와 **M11 실제 연주 3곡**으로 정한다. 합성 연주만으로 정하지 않는다 — 그것이 M11 규칙의 이유다.
- 기대 효과 (합성 기준, 참고치): 마디당 쉼표 3.40 → ≤ 1.0, 32분 비율 0.192 → ≤ 0.06. 이 수치는 **gate가 아니다**. gate는 A19이고 M11 뒤에만 판정한다.
- R-reg가 켜지면 G0 `notation.duration.accuracy`가 바뀐다 (그것이 목적). 그래서 R-reg의 flip은 G0 절차("Changing the SUT")대로 core·robust·hold-out usable Δ를 보고한다.

### 6.5 compound meter, pickup, grace

- **compound**: 박 계층이 점4분이다 (`meter-grid`). R-repr의 H4와 S표로 충분하다. 단 **잘못 추론된 박자**(3/4 곡이 6/8로 적힘, 이슈 2)는 G3가 고치지 않는다. G3는 적힌 박자 안에서 가장 읽기 좋게 쓸 뿐이다 (§19 예 E8).
- **pickup**: 녹음 경로는 pickup을 앞 쉼표가 있는 꽉 찬 마디로 쓴다 (G0 §8.4). G3는 그 마디를 implicit으로 바꾸지 않는다 — 마디 구조는 budget 밖이다.
- **grace**: 보존만. 꾸밈음 검출(짧은 음 → grace)은 연주 추론이라 G3 밖.

---

## 7. Tuplet — G1 F1의 canonical semantics

### 7.1 F1 재진술

`buildXml`은 한 event가 조각으로 쪼개지면 첫 조각에 `<tuplet start>`, 마지막 조각에 `stop`을 찍어 괄호 하나로 묶었다. `buildGraph`는 조각마다 Tuplet spanner를 만든다 (`audio-score.js:1265`, `unit` 없음). 앱은 멤버 2개 이상일 때만 괄호를 그려서 `method/czerny849/020`에서 29 → 0. G0는 `<tuplet>`을 읽지 않아 보지 못했다. **그리고 원래의 묶음 자체도 틀린 표기였다** (tie로 묶인 두 조각 위의 "3").

올바른 답은 "조각 괄호를 합친다"도 "UI에서 숨긴다"도 아니다. **논리적 셋잇단 그룹을 정의하고 그 그룹 하나를 spanner 하나로** 쓰는 것이다.

### 7.2 Canonical semantics

| 개념 | 정의 | 저장 (schema v2 그대로) |
| --- | --- | --- |
| **logical tuplet** | 한 성부 안에서, 길이 `normal × unit`인 **tuplet 구간**을 정확히 덮는 연속 event들 (음·쉼표·tie 조각 포함, grace 제외) | `Spanner{type:'tuplet', events, actual, normal, unit}` 하나 |
| **notation ratio** | `actual : normal` + `unit {type, dots}` (항상 명시) | `actual`, `normal`, `unit` |
| **start / continue / stop** | start = `events[0]`, stop = `events[last]`, continue = 나머지 멤버. **저장하지 않고 파생**한다 | exporter가 `<tuplet type="start|stop">`을 쓴다 (MusicXML에는 continue가 없다) |
| **nested** | 안쪽 그룹이 바깥 그룹 멤버의 연속 부분열 | 안쪽 spanner의 `parent` |
| **incomplete** | 구간을 다 덮지 못한 그룹 | 허용하지 않는다 (§7.4). imported에서 오면 보존 + `W-TUPLET-INCOMPLETE` |
| **괄호 표시 여부** | G4 결정 (beam과 일치하면 숫자만 등) | G3는 `show`를 쓰지 않는다. `printed`는 imported 값 보존, G3 생성은 `true` |

한 event의 표시 길이 불변식 `value(type, dots) × Π(normal/actual) == dur`는 모든 멤버(쉼표 포함)에 성립해야 한다. 이것이 이슈 19의 해소 조건이다.

### 7.3 그룹 찾기 (P5)

1. 성부-마디에서 tuplet 사슬이 같은 조각들을 모은다 (R-repr 후, 쉼표도 셋잇단 길이면 사슬을 가진다).
2. **tuplet 구간 격자**: 비율 3:2, unit 8분이면 구간 = 4분, 박 격자에 정렬. unit 16분이면 8분 구간. 박 계층에서 구간이 시작할 수 있는 점만 쓴다.
3. 구간마다 그 안의 조각 전부가 한 그룹. 구간을 넘는 조각이 있으면 (셋잇단 4분이 두 구간에 걸침) 더 큰 unit으로 올린다 (3:2 unit 4분 = 2분 구간). 그래도 안 되면 R-repr에 **그 지점 분할을 요청**하지 않고 원래 표현을 유지 + `N-TUPLET-UNGROUPABLE`.
4. 기존 spanner와 멤버 집합이 같으면 유지 (idempotence).

### 7.4 T-fixture (`fixtures/g3/tuplet/T01–T10`)

| # | 입력 | 기대 |
| --- | --- | --- |
| T01 | 셋잇단 8분 3개, 조각마다 spanner (현재 출력) | spanner 1개, 멤버 3, `unit: eighth` |
| T02 | 셋잇단 4분(조각 2개로 tie) + 셋잇단 8분 | 한 그룹, 멤버 3 (tie 조각 둘 포함) — **F1** |
| T03 | 셋잇단 안 8분쉼표 (time-mod 없음, 이슈 19) | 쉼표가 멤버, `W-DISPLAY-DURATION` 0 |
| T04 | 2박 연속 셋잇단 | 그룹 2개 |
| T05 | 셋잇단 4분 3개 (2분 구간) | 한 그룹 unit quarter |
| T06 | 5:4 안의 3:2 (import) | 보존, `parent` 유지 |
| T07 | 6:4 vs 두 개의 3:2 (import) | 보존 — imported는 재해석하지 않는다 |
| T08 | 박을 넘는 셋잇단 조각 (묶을 수 없음) | 변화 없음 + `N-TUPLET-UNGROUPABLE` |
| T09 | export → import round-trip | spanner 멤버·비율·parent 동일 |
| T10 | 앱 렌더러가 그리는 괄호 수 (`czerny849/020`) | 논리 그룹 수와 같다 (A10) |

---

## 8. Voice Separation

### 8.1 현재

녹음·MIDI 경로는 staff마다 성부 하나다. 화음 하나는 길이 하나(아래쪽 중앙값 release). 같은 tick 같은 음은 제거된다. reference의 25.7 % staff-마디가 2성부 이상인데 PPP는 0 %다. 예 E1: 16분 음형 아래 4분 베이스가 사라지고 32분 + 쉼표가 된다.

### 8.2 G3a — 그래프만 보고 할 수 있는 것

그래프의 화음 event는 head들이 한 길이를 공유하므로, **그래프만으로는** 서로 다른 길이의 성부를 만들 수 없다. G3a의 voice pass는 다음만 한다.

- 성부 번호 정리: staff 1 → voice 1(,2), staff 2 → voice 5(,6) 관례를 유지하고 staff를 옮긴 event의 voice를 맞춘다 (P2의 결과).
- imported 성부는 보존. imported 그래프에서 **한 성부에 겹침이 없는데 두 성부로 쪼개져 있는 것**을 합치지 않는다 (편집 의도).
- 성부가 마디를 다 채우지 않을 때 (I-VOICE-GAP): **2번째 이후 성부**의 빈 곳은 hidden rest가 아니라 보이는 쉼표로 채운다 — 판각 관례. 1번 성부의 빈 곳은 원래 없다 (writer가 쉼표로 채움).

### 8.3 G3b — performance 기반 분리 (M11)

성부 분리가 실제로 필요로 하는 정보는 **각 음이 얼마나 눌려 있었나**이고, 그것은 PerfNote `off`에 있다 (head ↔ PerfNote 링크, `audio-score.js:1314`). 이것은 release 해석이므로 M11 대상이다.

설계 (구현은 G3b):

1. staff마다 링크된 PerfNote로 **들린 구간**을 복원한다 (onset은 그래프, 끝은 perf off를 박 격자에 R-reg 규칙으로 맞춤).
2. 동시에 울리는 구간 그래프에서 **최소 성부 수 경로 분할** (interval graph coloring, 음높이 연속성 비용: 성부 안 도약 반음 수 + 성부 교차 벌점 + 성부 수 벌점). staff당 최대 2성부 (피아노 판각 관례; 3 이상은 imported에서만).
3. 2성부가 되는 조건: 긴 음이 짧은 음 둘 이상과 겹칠 때, 그리고 그 긴 음의 들린 길이가 R-reg budget 안에서 한 음가로 쓰일 때. 아니면 1성부 유지.
4. 결과는 `voice` 재배정 + 긴 음의 기보 길이 변경 (R-reg 층). 음 추가·삭제 없음.

### 8.4 하지 않는 것

같은 음 중복 제거(`:989`)를 되돌리는 것, 성부 간 unison 공유 head를 만드는 것은 음 수가 바뀌므로 G3 밖. 3성부 이상 생성 안 함.

---

## 9. Staff / Hand Assignment와 Playability

### 9.1 현재와 문제

`assignHands`는 onset 묶음마다 분할 음높이(36–84)를 DP로 고르고, 비용은 폭 > 12 × 1.5, 음 수 > 5, 두 손 붙음, 분할점 이동 0.08/반음이다. **선율 연속성이 없다.** 결과: 멜로디 음이 왼손 화음으로 (E7), 양손 옥타브 병행이 오른손 옥타브 화음으로 (E6, Beyer 032 hand 0.50), 셋잇단 아르페지오 일부가 반대 손으로 (E2, E3).

### 9.2 G3 설계 (G3a, M11 무관 — onset과 음높이만 쓴다)

**limb 배정을 먼저, staff는 limb에서.** G1-D12대로 limb는 head → voice → staff 순으로 상속한다. G3는 피아노 part에서 기본적으로 **staff = limb**(RH ↔ staff 1)로 두고, cross-staff(limb ≠ staff)는 만들지 않는다 (판각 결정이 필요한 드문 경우라 G4 이후).

비용 (onset 묶음 k에서 손 배정 a_k, DP over k with state = 각 손의 마지막 음높이 요약):

```
cost = Σ_k [ span_pen(RH) + span_pen(LH)          # 한 손 폭 > 12 반음: 1.5/반음, > 14: 불가
           + count_pen                               # 한 손 > 5음 불가
           + cross_pen                               # RH 최저 < LH 최고: 2.0
           + 0.15 · |Δ중심(RH)| + 0.15 · |Δ중심(LH)|  # 손 이동 (선율 연속성)
           + 0.6 · [선율 끊김]                         # 직전 묶음의 최고음 선율이 반대 손으로 넘어감
           + 0.4 · [같은 pitch class 옥타브가 한 손]    # 양손 옥타브 병행 선호 (E6)
           + ledger_pen ]                             # staff 밖 덧줄 4개 이상: 0.3/개
```

- **tuplet·beam 단위 응집**: P2는 P4 전에 돌지만, 입력 그래프의 셋잇단 조각 묶음(같은 박의 time-mod 음)이 두 손으로 갈라지면 벌점 0.8. 아르페지오가 박 중간에서 손을 바꾸는 것을 막는다 (E2, E3).
- 화음 한 event의 head가 두 손으로 갈리면 event를 **나눈다** (`splitEvent`가 아니라 head를 새 event로 옮김: 원 event는 남은 head와 ID 유지, 옮긴 head는 **head ID 유지**, 새 event ID). 시간·음높이 불변.
- 가중치는 H-fixture와 core `hand.accuracy`로 정한다. 목표 (A20): core 평균 0.888 → ≥ 0.90, 케이스별 hands gate 퇴행 0.

### 9.3 Clef change와 range

- staff마다 덧줄 ≥ 4개인 음이 **한 마디 이상 연속**하면 그 구간에 clef change (treble ↔ bass). 짧은 구간(1마디 미만)은 두지 않는다.
- clef change는 `Clef` entity 추가다. imported clef는 보존.
- 옥타브 기호는 §13.3.

### 9.4 H-fixture (`fixtures/g3/hands/H01–H08`)

양손 옥타브 병행(Beyer 032형), 멜로디가 왼손 화음 위(Czerny 849/006형), 셋잇단 아르페지오 손 교대(Burgmüller 021형), 넓은 화음(폭 > 12), 손 교차 금지, clef change, 오른손이 가운데 C 아래로 잠깐 (옮기지 않음), 들여온 악보 보존.

---

## 10. Key, Spelling, Accidentals

### 10.1 현재

`estimateKey`는 곡 전체에 조 하나 (Burgmüller 15의 C → E♭ 전조 못 봄, 이슈 5). `spellingTable`은 조별 정적 표이고 선율 방향을 보지 않는다. 예: Sonatina 018에서 G장조로 잘못 잡아 E♭을 D♯으로 (E5), Sonatina 017에서 A장조로 잡아 F를 E♯으로 (E9), Burgmüller 019에서 B♭을 A♯으로.

### 10.2 설계 (G3a)

**조 (구간별)**

1. 마디 창(8마디, 4마디 hop)마다 Krumhansl–Kessler 상관 + 온음계 적합(기존 `estimateKey`와 같은 가중치 — 한 줄도 새로 발명하지 않는다: 같은 함수를 창에 적용).
2. 창 결과 위의 HMM/Viterbi: 상태 = 24조, 전이 비용 = 5도권 거리 × 0.5 + 조 변경 1.5, 최소 4마디 유지.
3. 조 변경은 **마디선에서만**, KeyEvent 추가. imported KeyEvent는 보존.
4. G0 key gate("첫 마디 + 19/20 음")를 떨어뜨리지 않는 것이 A24.

**철자** (line of fifths)

음마다 후보 철자 2–3개 (예: MIDI 63 → D♯/E♭). 비용:

```
cost = 1.0 · 5도권 거리(철자, 지역 조 중심)
     + 0.8 · [선율 음정이 증·감음정]           # 같은 성부 앞뒤 음과
     + 0.3 · [반음계 경과음: 올라가는데 ♭ / 내려가는데 ♯]
     + 0.5 · [화음 안 증·감음정 (단 감7·증6 화음 형태는 면제)]
     + 2.0 · [겹올림·겹내림] (조가 요구하지 않을 때)
     + 0.4 · [같은 마디·staff에 같은 step이 다른 alter로 번갈아]
```

성부 안 DP (상태 = 직전 음 철자). 화음은 head 조합을 한 상태로. 결정론적 동점 규칙: 조 방향(♯조면 ♯).

**D7 계약 (G2-D15)을 깨지 않는다**: 그래프는 concert 철자를 담는다. 철자 pass는 **concert 음에서** 최적화한다. 이조 part는 written = concert + 이조 음정(철자 보존 이동)이므로, concert 철자의 5도권 위치가 결정되면 written 철자는 일정한 이동으로 결정된다. 비용의 "지역 조"는 concert 조를 쓴다 (written 조로 계산해도 이동이 일정해 같은 답이 나온다 — 이것을 X8·X9 fixture로 확인한다, A26). 피아노는 no-op.

**imported 철자는 절대 바꾸지 않는다** (`provOf(head,'spelling').op === 'imported'`).

### 10.3 인쇄 임시표 (`head.acc`)

- **필수**: 마디·staff·(step, oct) 상태 기준 (MusicXML 관례 = 현재 writer와 같음), tie로 이어진 음은 억제, **마디를 넘는 tie의 뒤 음은 억제**, 다음 마디 첫 새 음에서 상태 초기화.
- **courtesy** (`cautionary: true`): (a) 앞 마디에서 변화된 같은 step(같은 옥타브)이 다음 마디에 처음 나올 때, (b) 조 변경 직후 첫 마디에서 바뀐 step, (c) 마디를 넘는 tie 뒤 같은 마디에서 같은 step이 다시 나올 때. 괄호는 G4.
- 다른 옥타브의 같은 step: 필수 아님, courtesy도 기본 off (관례 차이, `opts.courtesyOctaves`).
- imported `acc`는 보존. imported에 `acc`가 **빠진 필수 임시표**는 fill 모드에서만 채운다 (§14).
- G0 `critical.accidentals`("필요한 임시표가 모두 인쇄") 100 % 유지가 A27.

### 10.4 S-fixture (`fixtures/g3/spell/S01–S10`)

반음계 상행(♯)·하행(♭), 화성단음계 이끔음(F♯단조의 E♯ — 정당), 감7화음, 나폴리 6 (D♭ in C), 전조(C → E♭, Burgmüller 15형), 마디를 넘는 tie 뒤 임시표, courtesy (a)(b)(c), 이조 part(clarinet X8형) concert/written, imported 보존.

---

## 11. Beams

### 11.1 현재

PPP는 beam을 쓰지 않는다 (0 vs reference 46.8 %). 앱 렌더러는 그래프·파일 beam을 무시하고 스스로 박 단위로 묶는다. exporter는 Beam spanner가 있으면 `<beam>` level 1–n을 `display.type`에서 파생해 쓴다 (`musicxml-export.js:532-557`).

### 11.2 설계 (G3a) — 멤버십과 break만

- 성부-마디 안에서 8분 이하 음(쉼표 제외)을 **beam 그룹 경계**로 묶는다. 경계 = `MeterEvent.groups`가 있으면 그것, 없으면 기본 표:

| 박자 | 1차 그룹 (8분) | 16분 이하 secondary break |
| --- | --- | --- |
| 2/4 | 박 (4분) | 8분 |
| 3/4 | 박 | 8분 |
| 4/4 | 박 (8분만 있는 1–2·3–4 반마디 묶음은 **opts**, 기본 박) | 8분 |
| 2/2 | 박 (2분) → 4분 | 8분 |
| 3/8 | 마디 | – |
| 6/8, 9/8, 12/8 | 점4분 | 8분 |
| 5/8, 7/8 | groups | – |

- **쉼표는 beam을 끊는다** (기본). tuplet 그룹 경계와 beam 경계가 어긋나면 tuplet을 따른다.
- 성부가 다르면 다른 beam. cross-staff beam은 만들지 않는다.
- 결과는 `Beam{events, breaks[{after, level}]}`. 기하·기울기·stem 방향은 G4.
- imported beam은 보존 (`provOf(spanner,'exists').op`).
- 이 beam은 **G4(S5)까지 앱 화면에 나오지 않는다** — 렌더러가 스스로 묶는다. MusicXML 출력(내보내기, G0)에는 나온다 (D4).
- validator는 beam에 "멤버 ≥ 2"만 본다. G3가 **`W-BEAM-SHAPE`** (멤버가 한 성부·시간 순서·연속이 아님, 4분 이상 음 포함)를 더한다 (§18).

### 11.3 B-fixture

박자 표의 각 행 + 쉼표로 끊김 + 셋잇단 그룹 + 16분 secondary break + imported 보존: `fixtures/g3/beam/B01–B09`.

---

## 12. Phrase / Slur / Articulation

### 12.1 수준 구분

| 수준 | 내용 | G3에서 |
| --- | --- | --- |
| 보존 | imported slur·phrase·articulation을 이동·분할된 event에 따라 옮긴다 | **G3a** (필수) |
| heuristic | 연주 legato(겹침)·끊음 비율에서 slur/staccato | **G3b** (M11, 기본 off) |
| optimization | 프레이즈 경계 최적화 (마디·케이던스 기반) | **하지 않는다** — SongGraph(G7+)의 phrase 분석과 겹친다 |
| learned | 학습 모델 | **하지 않는다** — 데이터(human-edited notation)가 저장소에 없다 |

### 12.2 보존 규칙 (G3a)

- slur `from/to`가 가리키는 event가 분할되면: `from`은 앞 조각(ID 유지), `to`는 **뒤 조각** (idMap의 새 ID). 병합되면 살아남은 event.
- articulation(`event.arts`)은 분할 시 **앞 조각**에만 (staccato·accent는 onset 기호), tenuto·fermata는 **마지막 조각**. 이 표를 `pro-marks.js`에 두고 fixture로 고정한다.
- `Structure.phrases`는 Pos 구간이라 분할에 영향받지 않는다. 확인만.

### 12.3 G3b heuristic (설계만)

- PerfNote 겹침(앞 음 off > 다음 음 on)이 성부 안 3음 이상 이어지면 slur 후보, provenance `op:'inferred'`, `conf`는 겹침 비율.
- release가 IOI의 ≤ 50 %이고 R-reg가 쉼표를 유지할 때(C5) staccato로 대체할지는 **opts** (`restOrStaccato`), 기본은 쉼표. staccato는 음 길이를 바꾸지 않는다 — 그러면 R-reg budget을 넘으므로, 이 규칙은 "8분 + 8분쉼표 → staccato 4분"처럼 **기보 길이를 늘리는** 선택이고 반드시 R-reg budget(C3) 안이어야 한다.

---

## 13. Dynamics / Pedal / Ottava / Fingering

### 13.1 Dynamics — 보존만, 추론하지 않는다

원본의 dynamic·wedge는 보존한다. 녹음·MIDI에 dynamics를 새로 추론하는 것(velocity → p/f)은 **G3에서 하지 않는다**. 이유: (a) velocity는 AMT 추정값이고 기기·마이크마다 척도가 다르다, (b) 교재 악보의 dynamics는 연주가 아니라 해석 지시이고 편곡·스타일의 영역이다, (c) G0에 dynamics metric이 없어 이득을 잴 수 없다. → 미래 arrangement/style Goal (D6).

### 13.2 Pedal — 보존 + 표기 정리

- imported pedal은 보존.
- inferred pedal (녹음·MIDI): **있느냐 없느냐는 G3가 정하지 않는다** (이슈 17은 AMT의 가짜 페달이다; 그것을 걸러내는 것은 전사 품질의 일). G3는 표기만 정리한다:
  - 1박 미만 간격의 release–press 쌍 → `changes`로 합침 (이미 writer가 일부 함). **G3-U7 (§29): 기본 OFF** — 앱은 `change`를 떼지 않는 페달로 재생한다(B1). `opts.pedalJoin`으로만 켜는 실험 기능이고, G3 off/on(기본)에서 앱이 재생하는 페달·sustain은 같아야 한다 (`g3-marks.test.js`).
  - `changes`의 위치를 가장 가까운 음 onset **뒤**(legato pedal 관례)로 — 단 같은 박 안에서만, 없으면 그대로.
  - 16분 미만 pedal 구간은 writer가 이미 버린다; G3는 새로 버리지 않는다.
- G0 `critical.pedal`("사용된 곳에 페달이 적혀 있다") 퇴행 0 (A32).

### 13.3 Ottava — 설계하되 기본 off

reference는 파일당 0.13개, PPP는 0. 덧줄 4개 이상 음이 1.5×(pedal 프로파일 3.4×).

**그러나 앱은 8va 구간을 한 옥타브 틀리게 연주한다** (이슈 3: MusicXML `<pitch>`는 울리는 음인데 앱이 다시 옮긴다; 30개 악보 2,229음). G3가 녹음 악보에 ottava를 쓰는 순간 **그 악보가 틀리게 연주된다**. 따라서:

- `pro-staff.js`에 ottava 구간 결정(덧줄 ≥ 4개 음이 1마디 이상, 같은 staff에서 겹치지 않음)을 구현하고 fixture로 고정한다.
- 기본값은 **off** (`opts.ottava = false`). 이슈 3이 고쳐지기 전에는 켜지 않는다 (D2).

### 13.4 Fingering — G3에서 쓰지 않는다

운지는 앱의 런타임 모델(`:8279`)이 연습 화면에서 계산하고, 인쇄 운지(`head.fingering`)가 있으면 존중한다 (`fingering.test.js :308`). G3가 운지를 그래프에 쓰면 (a) 인쇄 운지로 오인되어 런타임 모델이 그것을 "고정"으로 받아들이고, (b) 교재 악보의 편집 운지와 섞인다. G01 §8.2도 G5에 둔다. **G3는 운지를 쓰지 않고, imported 운지를 이동·분할된 head에 따라 보존만 한다** (head ID 유지 규칙으로 자동). G3의 손 배정(§9)은 운지 모델의 입력(hand)을 좋게 만든다 — 그것이 G3의 운지 기여다.

---

## 14. Imported vs Inferred — 무엇을 건드리는가

### 14.1 권한 규칙

pass는 entity를 바꾸기 전에 `provOf(entity, aspect).op`를 본다.

| op | 기본 모드 (`rewrite`) | `fill` 모드 | `force` 모드 (테스트·실험) |
| --- | --- | --- | --- |
| `inferred` (녹음, MIDI skeleton, audio-score) | 다시 쓴다 | 다시 쓴다 | 다시 쓴다 |
| `generated` (편곡) | 건드리지 않는다 (G7/G8 소관) | 빈 것만 채운다 | 다시 쓴다 |
| `imported` (MusicXML, OMR) | 건드리지 않는다 | **빈 semantics만 채운다**: 없는 beam, 빠진 필수 임시표, 없는 `unit` | 다시 쓴다 |
| `repaired`, `edited` (사용자) | **절대** 건드리지 않는다 | 건드리지 않는다 | 건드리지 않는다 |

- `edited`는 force에서도 보호한다. 사용자가 고친 것을 G3가 되돌리는 일은 없어야 한다.
- OMR은 `imported`다. OMR 결과의 오류(이슈 11: 오른손 소실)는 G3가 고치지 않는다 — OMR 품질 Goal이다.

### 14.2 경로별 기본값

| 경로 | G3 적용 | 모드 |
| --- | --- | --- |
| 녹음 (`toMusicXml`) | flip 후 항상 | rewrite |
| `.mid` (`fromMidi`) | flip 후 항상 | rewrite |
| MusicXML/MXL import | **기본 적용 안 함** | (선택) fill — D5 |
| OMR | 적용 안 함 | – |
| 편곡 출력 | 적용 안 함 (G7/G8에서 결정) | – |

---

## 15. Preservation Budget과 Critic

### 15.1 Fingerprint (P0이 만든다)

```
FP(g) = {
  sound:   정렬된 [(part, 절대 ScorePos onset, concert MIDI, tie-merged 기보 길이)]   # 음 하나당 1행
  rests:   성부별 쉼표 구간의 합집합 (시간 집합)
  timeline: 마디 수, 각 마디 길이, MeterEvent 목록, TempoEvent 목록, 반복·ending·jump
  play:    Score.form 재생 순서 (G1-D10e)
  perf:    canonical JSON of graph.performances (바이트)
  marks:   imported slur/dynamic/wedge/pedal/articulation/fingering의 (종류, 음 onset 앵커) 다중집합
  graphIn: 입력 validate의 ERROR 수 (0이어야 한다)
}
```

### 15.2 불변식 (절대 보존)

| # | 불변식 | 모든 tier | 비고 |
| --- | --- | --- | --- |
| I1 | 울리는 음높이 다중집합 (concert MIDI) — 전체와 **onset별** | ✓ | 철자는 바뀌어도 MIDI는 같다 |
| I2 | 각 음의 onset (ScorePos 절대) | ✓ | |
| I3 | 마디 수, 마디 길이, meter, tempo | ✓ | |
| I4 | 재생 순서, 반복·ending·jump | ✓ | |
| I5 | performance 층 바이트 | ✓ | |
| I6 | imported·edited 표기(marks)의 다중집합과 앵커 onset | ✓ | |
| I7 | ERROR 0 (입력이 ERROR 0이면) | ✓ | |
| I8 | tie-merged 기보 길이 | **R-repr: 정확히** / R-reg: C3 budget | |
| I9 | 쉼표 구간 합집합 | R-repr: 정확히 / R-reg: I8의 결과로만 줄어든다 | |
| I10 | 음 → part 배정 | ✓ | staff·voice·limb는 바뀔 수 있다 (선언된 pass만) |
| I11 | 조표 | P6만 바꾼다 (구간별 조). 다른 pass는 불변 | |

**선언된 변경**: 각 pass는 자기가 바꿀 수 있는 필드를 정적으로 선언한다 (`pass.may = ['staff','voice']`). critic은 선언 밖의 필드 변화를 위반으로 본다.

### 15.3 Critic (P9) 동작

1. `FP(out)`과 `FP(in)` 비교 → I1–I11.
2. `validate(out)`: ERROR 0, 그리고 G3가 만든 entity에 `W-TUPLET-INCOMPLETE`·`W-DISPLAY-DURATION`·`W-BEAM-SHAPE` 0.
3. 위반이 있으면: 위반을 일으킨 pass의 **해당 마디 변경만** 되돌린다 (pass 순서로 다시 적용하되 그 마디는 그 pass를 건너뜀). 그래도 위반이면 전체 입력을 돌려준다 (`report.fallback = true`). 조용히 넘어가지 않는다: report와 `graphIssues`에 `N-G3-ROLLBACK`.
4. readability proxy(§20)를 계산해 report에 넣는다.

G1-D13("ScoreGraph 경로의 오류는 throw")과의 관계: critic 위반은 **G3의 결함**이지 입력의 결함이 아니다. 테스트에서는 `opts.strict = true`로 throw하게 하고 (A6, A7), production은 rollback + report다. rollback 수는 core에서 0이어야 한다 (A6).

---

## 16. Idempotence와 결정론

### 16.1 요구

- **R1 (pipeline)**: `canon(P(P(g))) === canon(P(g))` (canonical JSON 바이트, `nextId`·`rev` 포함).
- **R2 (pass)**: 모든 pass p에 대해 `p(p(x)) === p(x)` (**같은 객체**). 두 번째 실행은 op를 하나도 부르지 않는다 → 새 ID가 생기지 않고 `rev`가 오르지 않는다.
- **R3 (결정론)**: 같은 입력 → 같은 바이트. 다른 프로세스, 다른 CWD, Windows/Linux.
- **R4 (안정 참조)**: G3가 유지할 수 있는 ID는 유지한다 (§5.5). slur·dynamic·perf link는 idMap으로 따라간다. `PerfNote.link`는 performance 층 안이라 **바꿀 수 없다** — 그래서 head를 **새로 만들지 않고 옮긴다** (§9.2), 분할의 앞 조각이 head ID를 유지한다 (G01 §12.3).

### 16.2 구현 조건

- 모든 pass는 **고정점 형태로 정의**한다: "입력이 규칙을 이미 만족하면 아무것도 하지 않는다". R-repr는 현재 표현의 비용이 최소 비용과 같으면 (동점 포함) 바꾸지 않는다 — "동점이면 기존 유지"가 첫 동점 규칙이다.
- 동점 규칙 (순서대로): 기존 유지 → 기호 수 적은 것 → tie 적은 것 → 긴 기호가 앞 → 사전식(type 순서표).
- 반복 정렬은 ID 번호가 아니라 (시간, staff, voice, midi) 키로. ID는 동점의 마지막 수단.
- 부동소수점 금지: 비용은 정수(×1000 고정소수)로 계산한다 (G0-D8과 같은 이유).
- **pass 간 수렴**: P2가 staff를 바꾸면 P4가 다시 쓴다. 두 번째 pipeline에서 P2가 같은 답을 내야 한다 → P2의 입력 특징(onset, 음높이, 길이)은 P4–P7이 바꾸지 않는 것만 쓴다 (P4는 tie-merged 길이를 보존하므로 성립). 이것이 pass 순서의 두 번째 이유다.

### 16.3 테스트

`tests/scoregraph/g3-idempotence.test.js`: core 553 예측 그래프 + golden 17 + 코퍼스 369 import(force 모드) + 모든 g3 fixture에서 R1, R2(pass별), R3(두 번 + 자식 프로세스).

---

## 17. Provenance

- G3는 `Source{kind:'generator', tool:'ppp.g3', version:'<G3 version>'}` 하나를 등록한다 (`SOURCE_KINDS`는 닫힌 enum이지만 `generator`가 이미 있다 — v3 불필요).
- 바꾼 aspect에 `prov.asp[aspect] = {src: <g3>, op}`:
  - 입력이 `inferred`면 `op:'inferred'` (여전히 추론이다; src만 G3)
  - fill 모드에서 imported에 채운 것은 `op:'generated'`
  - aspect: rhythm (P4), voice (P3), staff·limb (P2), spelling (P6), display (P4의 type/dots, P6의 acc). tuplet·beam spanner는 spanner 자체의 `prov`.
- aspect enum에 `tuplet`·`beam`이 없지만 spanner가 자기 `prov`를 가지므로 필요 없다.
- `I-PROV-REDUNDANT`를 피하려고 상속값과 같으면 쓰지 않는다.
- report는 `graph`가 아니라 반환값(`proReport`)에 둔다 (G2-D6과 같은 이유: 크기).
- G2-D12의 "추론 표시 세 곳"은 그대로 유지된다: 그래프 default op, Score `sgFrom.inferred`, import report. G3는 네 번째로 "G3가 정리함"을 report에 더한다.

---

## 18. Schema Review

### 18.1 결론: `scoregraph_version` 2 유지. schema 변경 없음.

| G3 필요 | v2에 있나 | 위치 |
| --- | --- | --- |
| 논리 tuplet, 비율, unit, 중첩 | ✓ | `tuplet{events, actual, normal, unit, parent}` |
| start/continue/stop | 파생 | exporter `musicxml-export.js:517-524` |
| beam 그룹, break level | ✓ | `beam{events, breaks}` |
| 박 그룹 | ✓ | `MeterEvent.groups` |
| courtesy / editorial 임시표 | ✓ | `head.acc{cautionary, editorial, paren, bracket}` |
| 표시 음가 | ✓ | `event.display{type, dots}` |
| 성부·staff·limb | ✓ | Voice, Staff, `limbOf` |
| clef change, ottava | ✓ | Clef, ottava spanner |
| aspect별 provenance | ✓ | `prov.asp` |
| performance 링크 | ✓ | `PerfNote.link` |
| slur 역할 (phrase vs articulation) | ✗ | 필요 없다 — G3는 slur를 만들지 않는다. G3b에서 필요하면 `ext['ppp.g3'].slurRole` |
| R-reg의 원래 기보 길이 (감사용) | ✗ | `ext['ppp.g3'].was` (event) — 선택, 기본 off |

### 18.2 하는 것

1. **ops 추가** (§5.5) — 코드, schema 아님.
2. **`ext['ppp.g3']` 네임스페이스 등록** (`scoregraph/README.md`). ID를 담지 않는다 (ext 안 ID는 검사되지 않는다, G02 §18 S5).
3. **validator WARNING 2개**: `W-BEAM-SHAPE` (§11.2), `W-TUPLET-DISPLAY` (tuplet 멤버의 `display`가 `unit`과 모순). 기존 A5/A6 규칙대로 각각 valid fixture를 둔다. 새 WARNING은 기존 코퍼스 369에서 **0건**이어야 한다 (아니면 imported 악보에 새 경고가 생긴다) — Step 1에서 먼저 잰다.
4. **note-level `N-*` 코드는 validator가 아니라 G3 report 코드**다 (`N-RHYTHM-UNREPRESENTABLE`, `N-TUPLET-UNGROUPABLE`, `N-G3-ROLLBACK`).

### 18.3 v3가 필요해지는 경우 (G3에서는 피한다)

Voice·Clef·MeterEvent에 `prov` (추론된 성부의 신뢰도), ASPECTS에 `beam`, printed-only tie. 모두 G3에 필수가 아니다.

---

## 19. Before / After — 실제 코퍼스 예

전부 라이선스가 깨끗한 trusted 파일 (`tests/bench/corpus/provenance.json`). 케이스 key는 core suite, 마디는 인쇄 번호. `t` = 셋잇단 음가, `[x]` = 1-음 괄호, `~` = tie. "G3a"/"G3b"는 어느 층이 고치는지.

| # | 범주 | 케이스 / 마디 | Before (PPP) | Reference | After (기대) | 층 |
| --- | --- | --- | --- | --- | --- | --- |
| **E1** | 쪼개진 리듬 | `method/czerny849/007\|human\|oracle\|s1` m3 LH (deadpan도 같음) | `B3:16 G4:32 r32 D4:16 G4:32 r32 …` | v5 `B3 G4 D4 G4 …` 16분 + v6 `B3:4 C4:4 …` | G3a: 변화 없음 (길이 보존). G3b: `G4:16`으로 정규화, LH 2성부(`B3:4` 복원) | **G3b** |
| **E2** | 나쁜 쉼표 + 깨진 tuplet + 손 | `method/czerny849/001\|human\|oracle\|s1` m17 | RH `r16 r32 D5:32 r32 C5:16 r32 r16 r32 …`, `[C5:8t] [D5:8t]`; LH에 RH 셋잇단 G4·B4, `r4`(2/3박) | RH 셋잇단 8분 4그룹 + v2 G4 온음표; LH `G3 D4 F4 D4` | G3a: 셋잇단 그룹 4개(괄호 4), 셋잇단 안 쉼표에 time-mod, G4·B4 RH로 (응집 벌점); G3b: 쉼표 흡수, v2 온음표 | a+b |
| **E3** | 셋잇단 쉼표 모양 + 손 | `method/burgmuller25/021\|deadpan\|none\|s1` m3 | RH `r4`(2/3박을 4분쉼표로) `[E4:8t] [E5:8t] [C5:8t] [G4:8t]`; LH `[G3:8t] [C4:8t] r8` | RH `r4 \| [E5 C5 G4]`, LH `[G3 C4 E4] r4` | E4 → LH (셋잇단 응집), RH `r4` 정상 / 셋잇단 그룹 1개씩, 모든 쉼표가 표시 길이 = dur | **G3a** |
| **E4** | 1-음 괄호, 성부 붕괴 | `method/czerny849/001\|human\|oracle\|s1` m11 | 괄호 12개 `[G5:8t] [D5:8t] …`; LH `[B3:4t] r8 [D4+G4:4t] r8 …` | 그룹 4 + v2 2분 G5; LH v2 온음표 B3 | 괄호 4개 (F1). LH `4t + 8t쉼표` → 같은 길이 표현 중 최소 (`[B3:4t r8t]` 한 그룹); G3b: 4분으로 정규화 | a+b |
| **E5** | 모든 것 + 철자 | `method/sonatina/018\|human\|oracle\|s1` m14 | `r8 r32 C5:16 r32 D#5:16 r64 r64 [C5:8t] r8 D#5:16 …`, G장조로 잘못 추정 | `[r G4 C5][Eb5 C5 G4]×3` + LH 온음표 화음 | 조 재추정(구간 HMM) → E♭; `r64 r64` → `r32`(R-repr 합침); 셋잇단 그룹; G3b: 쉼표 흡수 | a+b |
| **E6** | 틀린 손 (옥타브 병행) | `method/beyer/032\|human\|oracle\|s1` m1–2 | RH `D5+D6, C5+C6, B4+B5 \| A4+A5`, LH 온마디 쉼표 | RH `D6 C6 B5 \| A5`, LH `D5 C5 B4 \| A4` | 옥타브 병행 선호 비용 → 양손 분리. hand.accuracy 0.50 → ≥ 0.9 (이 케이스) | **G3a** |
| **E7** | 틀린 staff | `method/czerny849/006\|human\|oracle\|s1` m9 | RH D5(2박 8분)가 LH 화음 `F#4+A4+C5+D5`로, RH `r4` | RH D5 8분 | 선율 끊김 벌점 → D5 RH | **G3a** |
| **E8** | 불필요한 tie + compound | `method/burgmuller25/023\|human\|oracle\|s1` m37 (6/8) | `Eb4:8. r16 \| Bb3+G4:8~16~32 r32 \| Eb4:8.~16` | 4분 셋 (hemiola) | G3a: `8~16~32` → `8.~32`류 최소 표현, 박 드러냄 유지; 박자는 바꾸지 않는다 (이슈 2 밖). G3b: 쉼표 흡수 → `4.` 단위 | a+b |
| **E8'** | compound에서 박을 가리는 4분 | `catalog/gymnopedie-1\|deadpan\|none\|s1` m5 | `E5:8.~16` (6/8로 잘못 추정된 3/4) | `E5:4` | 6/8 안에서는 `8.~16`이 **H4상 올바르다** — G3는 바꾸지 않는다. 진짜 원인은 박자(이슈 2). 기대 "변화 없음"을 fixture로 고정 | (G3 밖) |
| **E9** | 조와 무관한 철자 | `method/sonatina/017\|human\|oracle\|s1` m34 | `E#2:16. r32` (A장조로 추정) | F 8분 | 조 재추정 → F; G3b: `8` | a+b |
| **E10** | compound 쉼표·tie | `method/burgmuller25/003\|human\|oracle\|s1` m28 (6/8) | LH `G3+B3+D4+G4:4~32 r16.`, RH `G5:16. r32 B5:16 r16` | LH `4 r8`, RH `G5:8 B5:8` | G3a: `r16.` 박 안 표현 확인; G3b: `4 r8`, `8 8` | a+b |

**정직한 요약**: 열 개 중 **G3a만으로** 눈에 띄게 좋아지는 것은 E3, E6, E7과 E2·E4·E5의 괄호·손·철자 부분이다. E1·E8·E10의 핵심(파편화)과 성부 복원은 **G3b**다. 이것이 D1이 중요한 이유다.

이 예 10개는 `tests/scoregraph/fixtures/g3/corpus/` 아래 **마디 발췌 입력**(예측 그래프의 해당 마디)과 **기대 sidecar**(After 열의 G3a 기대)로 Step 2에 커밋한다. 발췌는 PPP가 쓴 출력이고 reference 원문은 넣지 않는다 (reference는 이미 저장소에 있는 파일을 경로로 참조).

---

## 20. Benchmark Extension

### 20.1 원칙

G0를 다시 만들지 않는다. G0의 reader/metric/gate/golden 구조에 **최소한**만 더한다: reader가 읽는 요소 2개, metric 그룹 1개, 진단 gate 몇 개, mutation 몇 개.

### 20.2 Reader 확장 (`reader/5`)

G0 reader는 `<tuplet>` start/stop과 `<beam>`을 읽지 않는다 (F1이 안 보였던 이유). reader/5는 **읽기만 더한다**: tuplet 괄호 멤버십(start–stop 사이 event), beam 멤버십. 앱 parity 규칙(G0-D2)은 그대로 — 앱도 `<tuplet>`을 읽는다 (App 4245). 기존 metric 값은 하나도 바뀌지 않아야 한다 (A33).

### 20.3 새 metric 그룹 `nq.*` (notation quality)

예측만으로 계산하고, reference에도 같은 값을 계산해 `delta`를 기록한다 (G0 `read.*`와 같은 모양).

| ID | 정의 | 방향 | 현재 (core) |
| --- | --- | --- | --- |
| `nq.tuplet.group_complete` | 인쇄 tuplet 괄호 중 멤버 길이 합 == `normal × unit`인 비율 | ↑ | ≈ 0 (1-음 괄호 100 %) |
| `nq.tuplet.one_note_rate` | 멤버 1개인 괄호 / 괄호 | ↓ | 1.00 |
| `nq.shape.tm_missing` | 셋잇단 길이인데 time-mod가 없는 event 수 | ↓ | 2,647 (합) |
| `nq.tie.mergeable_rate` | 한 박 그룹 안에서 시작·끝나고 **한 기호로 쓸 수 있는** tie / tie | ↓ | 0.40 |
| `nq.rhythm.hidden_beat_rate` | 박을 가리는 기호 중 S표 밖인 것 / event | ↓ | 측정 (Step 1) |
| `nq.rest.per_measure_delta` | 마디당 쉼표 − ref | ↓ | +2.83 |
| `nq.rhythm.short_rate_delta` | 32분 이하 비율 − ref | ↓ | +0.16 |
| `nq.voice.poly_recall` | ref가 2성부인 staff-마디 중 pred도 2성부 | ↑ | 0 |
| `nq.beam.coverage` | beam 가능 음(8분 이하, 박 그룹 안 2개 이상) 중 beam된 비율 | ↑ | 0 |
| `nq.beam.boundary_ok` | beam 그룹이 박 그룹 경계를 넘지 않는 비율 | ↑ | – |
| `nq.acc.redundant_rate` | 조표·마디 상태상 필요 없고 courtesy 규칙에도 없는 인쇄 임시표 / 음 | ↓ | 측정 |
| `nq.spell.context_odd` | 지역 조와 무관한 E♯/B♯/C♭/F♭·겹임시표 / 1000음 | ↓ | 0.17 (ref 0.31, 이끔음 포함) |
| `nq.spell.mixed_bar_rate` | ♯·♭ 반음계가 섞인 staff-마디 | ↓ | 0.005 (ref 0.002) |
| `nq.range.ledger4_rate` | 덧줄 ≥ 4 음 / 1000 | ↓ | 12.6 (ref 8.3) |
| `nq.ned` | **notation edit distance**: 성부별 기호열(type·dots·tie·rest·tuplet 멤버십)의 편집 거리 / ref 기호 수, 마디 정렬(G0 bar_offset) 위에서 | ↓ | 측정 |

`nq.ned`는 reference가 사람이 판각한 악보라는 점을 이용하는 **자동 proxy**이고, §21의 human review와 짝을 이룬다. 한계: reference와 다른데 똑같이 좋은 표기(4/4의 반마디 beam 등)를 틀렸다고 본다 — 그래서 gate가 아니라 정보 + 방향 확인용이다.

### 20.4 Gate 정책

- **새 critical gate는 만들지 않는다.** usable-score 정의(G0)를 G3 중간에 바꾸면 G0 baseline 전체의 의미가 흔들린다.
- G3 flip의 판정은 `run.py ab` + 다음 **G3 gate** (A34, `run.py check --suite core --g3`):
  - G0 critical gate: 케이스별 퇴행 0 (R-repr는 duration·onset을 보존하므로 note-values·beat gate 값이 **정확히** 같아야 한다).
  - ~~`nq.tuplet.one_note_rate == 0`, `nq.shape.tm_missing == 0`, `nq.tie.mergeable_rate == 0` (G3a가 만든 출력에서).~~ **G3-U5·U6 (§29.5)부터 이유별**: 출력 MusicXML에서 residual마다 이유를 매긴다(`pppbench/notation_reasons.py`). `tm_missing`과 1-음 tuplet(괄호가 인쇄되지 않은 것 포함)은 R17이 아닌 것 0; mergeable tie는 `MERGEABLE_DEFECT` 0이고 H6·H7·박 분할·부분 화음·성부 사이·R17은 따로 세어 보고; R17 수는 케이스별 baseline(`tests/bench/baselines/g3-r17.<suite>.json`, `run.py g3-r17`)을 넘으면 FAIL.
  - `hand.accuracy` 평균 ≥ 0.90, 케이스별 hands gate 퇴행 0.
  - `spelling.accuracy`, key gate: 케이스별 퇴행 ≤ 허용 목록.
- flip 뒤 `nq.*`는 baseline에 들어가고 regression 검사를 받는다 (G0 절차).

### 20.5 Mutation 추가 (`mutation-check`)

G3가 스스로를 잴 수 있음을 증명: (1) tuplet 조각 괄호 복원 (F1 되살리기) → `nq.tuplet.one_note_rate` 퇴행, (2) 셋잇단 쉼표 time-mod 제거, (3) 박 안 tie 되살리기, (4) beam을 박 경계 넘어 확장, (5) 철자 표를 정적 표로 되돌림, (6) 손 DP의 선율 벌점 0, (7) critic이 onset 1-tick 이동을 놓치게 (critic mutation → A7이 잡아야 함), (8) imported slur 앵커 버리기. 각각 REGRESSION이어야 한다.

§29 (M3, M6): (5)는 녹음 corpus에서 아무것도 바꾸지 않아(구간 조가 발동하지 않음) 살아 있는 임시표 경로 `G3-ACC-BAR-STATE`(마디 안 임시표 상태를 잊음 → `critical.accidentals`)로 바꿨다. (2)는 `nq.shape.tm_missing.unexpected`, (3)은 `nq.tie.mergeable.defect`로 잡혀야 하고, R17 증가 증명으로 `G3-R17-GROW`(셋잇단 앞의 1-tick release 틈을 닫지 않음 → `nq.shape.tm_missing.r17`)를 더했다.

### 20.6 Golden

G0 golden 17개는 G3 flip에서 다시 bless한다. 라벨: tuplet 괄호·쉼표 모양·tie 합침·beam·임시표 = `SEMANTIC_CHANGE` (G0 규칙상 dot·type·rest·staff는 formatting이 아니다). 음·onset·길이·마디는 **바뀌면 안 된다** — bless 도구가 G3a 범주 밖의 차이를 거절하도록 `BLESS_LOG.md`에 허용 범주를 적는다 (A35).

---

## 21. Human-quality Evaluation

### 21.1 왜 필요한가

"사람이 만든 악보 같다"는 구조 테스트(§15)와 proxy(§20)로 완전히 잡히지 않는다. 다른데 똑같이 좋은 표기가 있고, proxy가 모두 좋아도 읽기 나쁜 악보가 있다. 필요한 것은 **human-edited notation reference**다 — M11(실제 연주)과는 다른 문제다.

### 21.2 Reference 자원 (라이선스)

- 코퍼스의 trusted 파일 중 **PPP가 전사하지 않은** 판각본: 206개 (`provenance.json`: PianoXML typeset, Mutopia, CC0 카탈로그, 공개 도메인 교재 typesetter). PPP가 직접 전사한 130개는 reference 후보에서 뺀다 (편향).
- 상용 악보는 fixture에 넣지 않는다. 격리된 15개(P1)도 쓰지 않는다.

### 21.3 Golden set `HG` (20 발췌)

- 20개 × 8마디. 층화: simple duple 4, simple triple 4, compound 4, 셋잇단 포함 3, 2성부 texture 3, 반음계·전조 2. 교재 6종에 고르게.
- 입력: 각 reference의 `human|oracle|s1` core 케이스 (합성 연주 → PPP).
- 각 발췌에 세 판본: **A** = raw (G3 off), **B** = G3a, **C** = reference 원본. (G3b가 생기면 **D**.)
- 파일: `tests/bench/human/g3/HG01–HG20/{A,B,C}.musicxml` + `meta.json` (케이스 key, 마디 범위, sha256). 전부 저장소 안 파일에서 결정론적으로 생성 (`run.py human-set --build`).
- **§29 M4부터 블라인드**: 평가자는 `tests/bench/human/g3/E01-X.musicxml … E20-Z.musicxml`만 본다. 발췌 번호는 섞인 순서로, 판본은 발췌마다 X·Y·Z로 섞인다(seed 20260924). 모든 파일은 같게 정규화된다(제목·작곡가·표지·소프트웨어·레이아웃·방향 지시·slur·운지·가사 제거, 마디 1–8). 어느 글자가 A·B·C인지, 케이스·참조·출처·라이선스·sha256은 `tests/bench/human/g3-key/key.json`에만 있다.

### 21.4 Protocol

1. **렌더러 고정**: 판본을 같은 렌더러로 PNG로 만든다. 앱 렌더러는 beam·tuplet을 스스로 정해서 G3 차이를 가리므로 **쓰지 않는다**. MusicXML을 읽는 외부 판각기(MuseScore 4, 사용자 로컬)를 쓰고, 버전을 `meta.json`에 기록한다 (D7).
2. **블라인드 쌍 비교**: 발췌마다 (A,B) 쌍을 무작위 좌우로. 판정: "왼쪽이 낫다 / 같다 / 오른쪽이 낫다" × 4 축 (리듬 읽기, 성부·손, 철자·임시표, 전체) + 자유 메모. **§29 M4부터**: 발췌마다 세 판본 X·Y·Z를 축마다 순위(1이 가장 좋음, 같으면 같은 순위)로 매긴다 — 어느 것이 A·B인지 모르므로 쌍 대신 셋의 순위. 점수 도구가 열쇠로 A·B 선호를 되찾는다.
3. **절대 평가**: B와 C를 섞어 무작위로, "피아노 교사가 이 악보를 학생에게 줄 수 있나?" (예/고치면/아니오) + 1–5 전체 점수. **§29 M4부터** 60개 파일 전부를 한 목록에 섞어 각각 평가한다.
4. 결과 파일: `tests/bench/human/g3/review-<date>-<reviewer>.json` (평가자 역할, 날짜, 커밋, 렌더러 버전, 판정). 평가자 이름·이메일은 적지 않는다 — 역할만.
5. **평가자**: 사용자(피아노를 아는 사람) 1명 최소, 가능하면 2명. 1명이면 결과에 그 한계를 적는다.
6. 도구: `run.py human-set --pairs`가 무작위(고정 seed) 쌍 목록과 빈 판정 JSON을 만든다. `run.py human-set --score`가 집계한다.

### 21.5 판정 기준 (A36)

- 쌍 비교 "전체" 축에서 B ≥ A (나음 또는 같음)가 **20개 중 18개 이상**.
- "리듬 읽기" 축에서 B가 A보다 **나쁜 것이 0개**.
- 절대 평가에서 B의 "예 + 고치면"이 A보다 많다 (A는 별도 1회 평가로 기준값).
- `nq.ned`(§20.3)가 A → B에서 평균 감소 — human 판정과 방향이 같은지 보고 (Kendall τ, 정보).

G3b가 들어오면 같은 set에 D를 더해 같은 기준을 D ≥ B로 반복한다.

---

## 22. 사용자 결정

| # | 결정 | 선택지 | Architect 권고 | 막는 것 |
| --- | --- | --- | --- | --- |
| **D1** | **M11과 G3b** — release→음가 정규화(R-reg), performance 기반 성부 분리, staccato 추론 | (a) G3a 먼저 구현·flip, G3b는 코드·fixture까지 만들고 기본 off, **실제 연주 3곡 녹음·baseline 후 flip** (b) M11을 기다리지 않고 G3b도 flip (규칙 예외) (c) G3b를 G3에서 빼고 다음 Goal로 | **(a)**. 녹음은 사용자만 할 수 있다 (simple duple·triple·compound 각 1곡, 라이선스 깨끗, 마디 시작을 귀로 확인; 절차는 `tests/bench/README.md`). 이것 없이 λ(§6.4)를 합성 연주에 맞추면 M11 규칙이 막으려던 바로 그 과적합이 된다 | G3b flip (Step 14) |
| **D2** | **ottava와 이슈 3** | (a) ottava pass 구현, 기본 off, 이슈 3 수정 뒤 켠다 (b) G3에서 이슈 3(앱의 ottava 이중 이동)도 고친다 (c) ottava를 G3에서 뺀다 | **(a)**. 이슈 3 수정은 앱 재생 동작 변경이라 G3 범위(표기)를 넘는다. G2-D4도 같은 이유로 parity를 택했다 | Step 9의 ottava 부분 |
| **D3** | **소유권 모순 정리** (§3.5) | (a) 임시표·display semantics·limb는 G3, 배치는 G4, 운지는 G5 (b) G01 문서대로 G4 | **(a)** 그리고 G01 §5.7·§13.3·§14.3과 §8.2에 "G3로 이동" 주석 | Step 1 전 (문서) |
| **D4** | G3 beam이 앱 화면에 안 보인다 (렌더러가 무시, S5는 G4) | (a) 수용: G3는 그래프·MusicXML에 쓰고, 화면 반영은 G4 (b) G3가 렌더러를 그래프 beam을 읽게 바꾼다 | **(a)**. 렌더러 변경은 G4. G3 human review는 외부 판각기로 한다 (§21.4) | 없음 (기대치) |
| **D5** | 들여온 MusicXML에 G3 적용 | (a) 기본 적용 안 함, `fill`은 opts로만 (b) 앱 import에서 기본 `fill` | **(a)**. 판각 악보는 이미 좋고, G2의 flip(A33 shadow 차이 0)을 흔들지 않는다 | 없음 |
| **D6** | 녹음·MIDI에 dynamics/slur 추론 | (a) G3에서 하지 않는다 (보존만), 미래 style Goal (b) velocity → dynamics를 G3b에 | **(a)** (§13.1) | 없음 |
| **D7** | human review 렌더러와 평가자 | (a) MuseScore 4(사용자 로컬) + 사용자 1명 (b) 앱 렌더러 (c) 외부 평가자 모집 | **(a)**. (b)는 G3 차이를 가린다. 평가에 약 1시간 | A36 (Step 15) |
| **D8** | G0 golden bless와 baseline | (a) G3a flip에서 golden 17 bless (`SEMANTIC_CHANGE`, 허용 범주 명시) + `nq.*` baseline 추가 (b) golden을 G3 전용으로 새로 | **(a)**. 단 full suite의 오래된 baseline(G01 F7)은 여전히 별개 결정 | Step 13 |

**구현 시작 전에 필요한 답: D1, D3.** D2는 Step 9 전, D7은 Step 15 전, D8은 Step 13 전. D4–D6은 권고대로 가도 되는 기본값이다.

### 22.1 결정 기록 (사용자, 2026-09-24) — 전부 Accepted

| # | 상태 | 결정 |
| --- | --- | --- |
| **D1** | **Accepted** | G3a는 지금 구현한다. G3b도 구현할 수 있지만 **default OFF**. release→note-value normalization(R-reg)과 real second-voice recovery는 **duple / triple / compound 실제 human recording 3곡을 baseline한 뒤에만** production에서 켠다 (A19, Step 14) |
| **D2** | **Accepted** | automatic 8va pass는 구현할 수 있지만 **default OFF**. 알려진 ottava 재생 문제(이슈 3)가 해결되기 전에는 production에서 ottava를 생성하지 않는다 |
| **D3** | **Accepted** | 소유권: **G3** = note shape·리듬 표기, 임시표·철자, staff·hand 배정. **G4** = engraving·layout·geometry. **G5** = fingering과 더 깊은 물리적 playability. G01 §5.7·§13.3·§14.3(임시표·display → G4)과 §8.2(손 → G5)는 이 결정으로 대체된다 |
| **D4** | **Accepted** (권고 기본값) | G3 beam은 그래프·MusicXML에 쓰고 앱 화면 반영은 G4 |
| **D5** | **Accepted** (권고 기본값) | 들여온 MusicXML에는 기본 적용하지 않는다. `fill`은 opts로만 |
| **D6** | **Accepted** (권고 기본값) | dynamics·slur는 G3에서 추론하지 않는다 (보존만) |
| **D7** | **Accepted** (권고 기본값) | human review는 MuseScore 4(사용자 로컬) + 사용자 평가자 |
| **D8** | **Accepted** (권고 기본값) | G3a flip에서 G0 golden 17을 허용 범주로 bless하고 `nq.*` baseline을 더한다 |

D4–D8은 **구현 증거가 반대를 보여 주지 않는 한** 권고대로 간다. 증거가 반대를 보이면 Implementer는 바꾸기 전에 그 증거를 §24 이후 구현 기록에 적고 사용자에게 올린다.

---

## 23. Acceptance Criteria

각 항목은 **테스트 / 명령 / fixture·코퍼스 / 기대 결과**를 갖는다. "더 읽기 좋다"는 §20의 proxy와 §21의 protocol로만 판정한다.

### 23.1 기반과 보존 (A1–A9)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A1 | 기존 단위 테스트 | `npm run test:scoregraph` | 전체 | 기존 132 + 새 테스트 전부 pass |
| A2 | 코퍼스 왕복 불변 | `python tests/bench/run.py sg-roundtrip` | 코퍼스 369 | L1 368, L1+ 367, L2 369, play order 369 — G3 전후 동일 (G3는 import 경로 기본 off) |
| A3 | performance 층 불변 | `npm run test:scoregraph` (`g3-preserve.test.js`) | core 553 예측 그래프 + MIDI M1–M25 | `canon(graph.performances)` 바이트 동일 |
| A4 | 결정론 | `g3-idempotence.test.js` | 위 + golden 17 | 두 번 실행·자식 프로세스·다른 CWD에서 바이트 동일 |
| A5 | **idempotence** | `g3-idempotence.test.js` | core 553 + golden 17 + 코퍼스 369(force) + g3 fixture 전부 | `canon(P(P(g))) === canon(P(g))`; pass별 `p(p(x)) === p(x)` (같은 객체); 두 번째 실행에서 `nextId`·`rev` 불변 |
| A6 | 불변식 I1–I11 | `g3-preserve.test.js` (`opts.strict`) | core 553 + robust 282 + golden 17 | critic 위반 0, rollback 0, ERROR 0 |
| A7 | critic이 위반을 잡는다 | `g3-critic.test.js` | 심은 위반 12종 (onset 1 tick, MIDI ±1, 음 삭제, 마디 길이, tempo, 반복, perf 바이트, imported slur 앵커, 선언 밖 필드, tie-merged 길이, part 이동, 조표) | 12종 전부 탐지·보고, strict에서 throw |
| A8 | imported 보존 | `npm run test:scoregraph` (`g3-imported.test.js`) | 코퍼스 369 (import 후 `professionalize` rewrite 모드로 강제 적용) | semantic projection 동일, 변경 0 (op imported는 권한 없음) |
| A9 | 알려진 경고 소거 | `node tests/scoregraph/tools/validate-preds.js --g3` | core 553 | G3 출력에서 `W-TUPLET-INCOMPLETE` 0 (지금 8,144), `W-DISPLAY-DURATION` 0 (지금 2,647), 새 `W-BEAM-SHAPE`·`W-TUPLET-DISPLAY` 0 |

### 23.2 Tuplet — G1 F1 (A10–A13)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A10 | F1 해소 | `g3-tuplet.test.js` + `npm test` (engraving) | `method/czerny849/020` core 케이스 | 논리 그룹 수 == 멤버 합이 구간을 채우는 그룹 수; 1-음 괄호 0; 앱이 그리는 괄호 수 == 논리 그룹 수 |
| A11 | tuplet semantics | `g3-tuplet.test.js` | T01–T10 | sidecar와 정확히 같다 (멤버·actual·normal·unit·parent) |
| A12 | 셋잇단 쉼표 모양 | `run.py run --suite core` + `nq.shape.tm_missing` | core 553 | 0 (지금 2,647) |
| A13 | tuplet 왕복 | `g3-tuplet.test.js` | T01–T06 + core 표본 50 | `import(export(g))`의 tuplet spanner가 g와 같다 (ID 제외) |

### 23.3 Rhythm (A14–A19)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A14 | R-repr 길이 보존 | `python tests/bench/run.py ab --suite core --a git:<base> --b worktree` | core 553 | 케이스별 `notation.duration.accuracy`, `notation.onset_pos.accuracy`, `notation.ioi.accuracy`, `notes.*` **정확히 같다** |
| A15 | 불필요한 tie | `nq.tie.mergeable_rate` | core 553 | 0 (지금 0.40) |
| A16 | 규칙 fixture | `g3-rhythm.test.js` | R01–R24 | 전부 sidecar와 같다 |
| A17 | 박을 가리는 기호 | `nq.rhythm.hidden_beat_rate` | core 553 | S표 밖 0 |
| A18 | 표현 불가능은 그대로 | `g3-rhythm.test.js` | R22 | 입력 === 출력, `N-RHYTHM-UNREPRESENTABLE` 1건 |
| A19 | **R-reg (G3b, D1 뒤)** | `run.py ab --suite core` + `--suite recorded` | core 553 + M11 실제 연주 3곡 | 기본 off에서 A14 성립; on에서: 실제 연주 3곡의 note-value·beat gate 퇴행 0, core `nq.rest.per_measure_delta` ≤ 0.8, `nq.rhythm.short_rate_delta` ≤ 0.04, core·robust·hold-out usable Δ ≥ 0 |

### 23.4 손·staff·성부 (A20–A23)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A20 | 손 정확도 | `run.py ab --suite core` | core 553 | `notation.hand.accuracy` 평균 ≥ 0.90 (지금 0.888), 케이스별 hands gate 퇴행 0, `method/beyer/032` ≥ 0.9 |
| A21 | 연주 가능성 | `read.over_span_rate`, `read.max_chord_size` | core 553 | 한 손 폭 > 14반음 0, 한 손 > 5음 0, `over_span_rate` ≤ ref + 0.01 |
| A22 | 손 fixture | `g3-hands.test.js` | H01–H08 | sidecar와 같다 (head ID 유지 포함) |
| A23 | 성부 무결성 | `g3-voice.test.js` | core 553 + V-fixture 6 | `E-VOICE-OVERLAP` 0, staff당 성부 ≤ 2 (생성분), imported 성부 불변 |

### 23.5 조·철자·임시표 (A24–A27)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A24 | 철자·조 퇴행 없음 | `run.py ab --suite core` | core 553 | `notation.spelling.accuracy` 평균 ≥ base, 케이스별 key gate·spelling 퇴행 0 (허용 목록 없이) |
| A25 | 철자 fixture | `g3-spell.test.js` | S01–S10 | sidecar와 같다 |
| A26 | **D7 계약** | `npm run test:scoregraph` (`pitch-layers.test.js` + `g3-spell.test.js`) | X8, X9 (이조 part) | concert MIDI 다중집합 불변, written 철자 = concert + 이조 음정, 기존 pitch-layers 테스트 전부 pass |
| A27 | 임시표 | `run.py check --suite core` + `g3-spell.test.js` | core 553 + S07–S09 | G0 `critical.accidentals` 100 % 유지, `nq.acc.redundant_rate` ≤ ref + 0.005, courtesy fixture 일치 |

### 23.6 Beam·표기 보존 (A28–A32)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A28 | beam 규칙 | `g3-beam.test.js` | B01–B09 | sidecar와 같다; core `nq.beam.boundary_ok` = 1.0, `nq.beam.coverage` ≥ 0.95 |
| A29 | imported beam 보존 | `g3-imported.test.js` | 코퍼스 369 | beam spanner 멤버 불변 |
| A30 | 기호 앵커 보존 | `g3-marks.test.js` | M-fixture 6 (분할·병합·staff 이동 위의 slur·arts·dynamic·fingering) | 분할 규칙 표(§12.2)대로, 다중집합 불변 |
| A31 | 새 기호를 만들지 않는다 | `g3-marks.test.js` | core 553 | G3가 만든 dynamic·wedge·slur·articulation·fingering 0 |
| A32 | 페달 | `run.py ab --suite core` | core 553 (pedal 프로파일 포함) | `critical.pedal` 케이스별 퇴행 0, 페달 구간 수는 합침으로만 줄어든다 |

### 23.7 Benchmark·human (A33–A37)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A33 | reader/5와 `nq.*` | `npm run test:bench` | 단위 테스트 + G0 golden | 새 metric 단위 테스트 pass, **기존 metric 값은 전 케이스 불변** (reader/5가 읽기만 더함) |
| A34 | G3 flip gate | `npm run bench` + `run.py check --suite core --g3` + robust, smoke, replay-public | core 553 등 | G0 gate PASS, usable Δ ≥ 0 (core·robust·hold-out 보고), §20.4 G3 gate PASS |
| A35 | golden bless 범주 | `npm run test:bench` (golden) | golden 17 | 차이가 허용 범주(tuplet·쉼표 모양·tie 합침·beam·임시표·staff·철자)뿐; 음·onset·길이·마디 차이 0; `BLESS_LOG.md` 항목 |
| A36 | **human review** | `run.py human-set --score` | HG01–HG20 | §21.5: 전체 축 B ≥ A가 18/20 이상, 리듬 축 B < A 0개, 결과 JSON 커밋 |
| A37 | mutation | `run.py mutation-check` | §20.5 8종 + 기존 40 | 전부 REGRESSION, no-op 바이트 동일 |

### 23.8 앱·성능·MIDI (A38–A40)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A38 | 앱 로드와 A/B | `npm run test:scoregraph` (`browser-load`) + `npm test` | 26 suite | 새 파일이 순서대로 로드; pass 집합이 base와 같다 |
| A39 | 성능 | `g3-perf.test.js` | 합성 2,000마디 40,000 head | `professionalize` < 2 s; core suite 실행 시간 +30 % 이하 |
| A40 | MIDI 경로 | `npm run test:scoregraph` (`midi.test.js` + g3) | M13, M14, M10 | G3 적용, 추론 표시 세 곳 유지 + report에 G3, performance 층 불변 |

**총 40개.** G3a flip의 조건: A1–A18, A20–A40 (A19 제외). G3b flip의 조건: A19 + 전체 재확인.

---

## 24. 구현 단계

| Step | 하는 일 | 끝나는 조건 |
| --- | --- | --- |
| **0** | baseline 고정: 이 세션의 코퍼스 측정 스크립트(부록 A)를 `tests/bench/tools/notation_audit.py`로 커밋, 수치 재현 | 부록 A 표가 재현된다, A1·A2 base에서 pass |
| **1** | `meter-grid.js` (박 계층, S표) + validator `W-BEAM-SHAPE`·`W-TUPLET-DISPLAY` (코퍼스 369에서 0건 확인) + `ext['ppp.g3']` 등록 | 단위 테스트, A1, A2 |
| **2** | **ops 확장** (§5.5) + G01 §12.3 ID 규칙 테스트; 코퍼스 예 E1–E10 발췌 fixture | ops 테스트, R4 ID 안정성 |
| **3** | `pro.js` 골격: pass 계약, P0 snapshot, P9 critic (fingerprint, budget, rollback, strict) — pass 없이 | A3, A4, A5, A6(빈 pipeline), A7 |
| **4** | **P5 tuplet (F1)** — R-repr보다 먼저 하는 이유: 가장 작은 독립 변경이고 G1 F1이 가장 오래 열려 있다. 입력 조각 그대로 묶기만 | A10, A11, A13, A9 (tuplet 부분) |
| **5** | **P4 R-repr** + R-fixture, 가중치 고정; 셋잇단 쉼표(이슈 19)는 여기서 time-mod를 얻고 P5가 묶는다 | A12, A14, A15, A16, A17, A18, A9 |
| **6** | `opts.professional='shadow'` 배선 in `toMusicXml`; `run.py ab` 첫 측정 | A14 (전 케이스), A39 |
| **7** | **P2 staff/limb** + clef change + H-fixture | A20, A21, A22 |
| **8** | **P3 voice (G3a 부분)** | A23 |
| **9** | **P6 조·철자·임시표** + S-fixture; ottava 결정 코드(기본 off, D2) | A24, A25, A26, A27 |
| **10** | **P7 beam** + B-fixture | A28, A29 |
| **11** | **P8 marks** (앵커 보존, 페달 표기) | A30, A31, A32 |
| **12** | **reader/5 + `nq.*` + G3 gate + mutation 8종** | A33, A37 |
| **13** | **G3a flip**: `opts.professional='on'` 기본, golden bless (D8), baseline에 `nq.*`, 앱 A/B | A34, A35, A38, A40, 전체 |
| **14** | **G3b** (D1이 (a)면): R-reg, performance 기반 성부 분리, staccato opt — 코드·fixture·합성 측정은 flip 전에 해도 되고, **flip은 M11 실제 연주 3곡 baseline 뒤** | A19 |
| **15** | human review set 생성 + 사용자 평가 (D7) | A36 |

**왜 이 순서인가**

- critic(3)이 어떤 pass보다 먼저다 — 첫 pass부터 보존 위반을 잡아야 한다.
- tuplet(4)이 rhythm(5)보다 먼저다 — F1은 조각을 바꾸지 않고 묶기만 해서 가장 안전하고, rhythm 이후에도 같은 코드가 다시 돈다 (idempotence가 이 순서 의존을 흡수한다).
- shadow 배선(6)을 rhythm 직후에 한다 — 코퍼스 전체에서 A14(길이 보존)를 가장 일찍 확인한다.
- staff(7) → voice(8) → spell(9) → beam(10): §5.3의 의존 순서.
- 벤치 확장(12)은 flip(13) 직전 — 그 전에는 `ab`와 validator 경고 수로 충분하다.
- G3b(14)는 D1에 따라 병행 가능하지만 flip은 마지막.

---

## 25. Out of Scope

G3에서 **하지 않는다**.

- 좌표 기반 engraving, 간격, 충돌, 줄·페이지 나눔, beam·stem·slur 기하, stem 방향 → G4
- 렌더러가 그래프의 G3 결정을 읽게 하는 것 (S5) → G4
- 편곡, 멜로디·코드·반주 생성, 재화성 → G7/G8
- 박·템포·박자·onset 재추론, 이슈 1·2·13 → 별도 Goal (M11)
- AMT 페달 존재 판단 (이슈 17), OMR 품질 (이슈 11·12)
- 앱의 ottava 이중 이동 수정 (이슈 3) → D2
- hymn 변환기 버그 (이슈 10), 카탈로그 마디 결함 (이슈 14)
- dynamics·slur·phrase **추론** (D6), 학습 모델
- 운지 생성 (§13.4) → G5
- 꾸밈음 검출, 트릴·장식음 추론
- 음 추가·삭제, 겹친 음 합치기
- 3성부 이상 생성, cross-staff 표기
- 들여온 판각 악보의 재해석 (기본값)
- schema v3

---

## 26. 위험

| # | 위험 | 대응 |
| --- | --- | --- |
| K1 | G3a만으로는 가장 눈에 띄는 파편화가 남는다 → "G3가 별로 안 바꿨다"는 인상 | §19에서 미리 정직하게 나눴다. D1(a)로 G3b를 병행 구현, flip만 M11 뒤 |
| K2 | 가독성 가중치를 코퍼스에 과적합 | 가중치는 규칙 fixture(R/T/H/S/B)로 정하고, 코퍼스 metric은 검증에만 쓴다. hold-out(832) 보고 |
| K3 | 손 배정 변경이 앱의 연습·코치·운지에 파급 | hands gate 퇴행 0, `npm test` A/B (A38), coach는 staff:voice를 읽음 — 성부 번호 관례 유지 |
| K4 | 조 재추정이 G0 key gate를 흔든다 | 케이스별 퇴행 0 기준 (A24). 구간 HMM은 최소 4마디, 조 변경 벌점 |
| K5 | pass 간 상호작용으로 idempotence 붕괴 | pass 입력 특징을 후속 pass가 바꾸지 않는 것만 쓴다 (§16.2), A5를 매 Step에 돌린다 |
| K6 | ID 재사용 규칙이 slur·perf link를 끊는다 | head는 옮기고 새로 만들지 않는다, A3·A30 |
| K7 | 여러 세션이 `D:/PPP`를 공유 | G3는 `D:/PPP-g3`에서만. `D:/PPP`와 `d82bb71`은 건드리지 않는다 |
| K8 | 앱 렌더러가 G3 beam·tuplet을 다시 결정해 사용자는 차이를 일부만 본다 | D4. human review는 외부 판각기. 렌더러 전환은 G4 |
| K9 | human review 표본이 작다 (1명·20개) | 결과에 명시, `nq.ned`와의 일치도 보고, G3b에서 반복 |

---

## 27. 구현 기록 (G3 Implementer, 2026-09-24)

브랜치 `g3-score-intelligence` (worktree `D:/PPP-g3`), 설계 `209f166` 위 20 commit, 전부 push. PR·merge 없음. `PROFESSIONAL_DEFAULT`는 **`'off'`** 그대로다 — flip하지 않았다 (§27.4).

### 27.1 상태

| | 상태 | 요약 |
| --- | --- | --- |
| **G3 전체** | **PARTIAL** | G3a 구현 완료, flip은 설계 내부 충돌로 BLOCKED (§27.4). G3b 구현, 기본 off. human review는 사용자 대기 |
| **G3a** | 구현 완료 · flip BLOCKED | P2 staff/hand·clef, P3 voice, P4 R-repr, P5 tuplet(F1), P6 조·철자·임시표, P7 beam, P8 marks, critic. `toMusicXml` `opts.professional` off/shadow/on. G3 gate 8줄 중 6줄 PASS, `tm_missing`·`mergeable` 2줄 FAIL (§27.4) |
| **G3b** | 구현 · 기본 OFF | `regularize`(R-reg, §6.4) + `perf-voices`(§8.3), `opts.g3b`로만. λ = 1은 자리표시(M11이 정한다). 합성 fixture만, baseline 승인 없음 |
| 자동 8va | 구현 · 기본 OFF (D2) | `opts.ottava` |

### 27.2 Commit

| Step | commit | |
| --- | --- | --- |
| 1 | `460aa0c` | meter-grid, `W-BEAM-SHAPE`·`W-TUPLET-DISPLAY`, `ext['ppp.g3']` |
| 0 | `8023610` | `tests/bench/tools/notation_audit.py` + 단위 테스트; `evaluate.ref_readability` id() 캐시 버그 수정 (base에서도 순서 의존 실패) |
| 2 | `9164f64` | ops (Draft 트랜잭션), E1–E10 fixture |
| 3 | `bec0280` | `professionalize`, critic (fingerprint·rollback·strict) |
| §20 | `421feb1` | reader/5, `nq.*`, `check --g3` |
| 4 | `c628768` | P5 논리 tuplet (F1) |
| 5 | `049d71e` | P4 R-repr |
| 6 | `a936381` | toMusicXml off/shadow/on, 첫 core A/B |
| 7 | `bec55ba` | P2 손·staff·clef, 자동 8va(off) |
| 8 | `221070e` | P3 성부 |
| 9 | `260bc3a` | P6 조(구간)·철자·임시표 |
| 10 | `1b87451` | P7 beam |
| 11 | `bb2827b` | P8 marks |
| perf | `9dea44c` | A39: 2,000마디 40k head 40 s → 1.6 s, 출력 동일 |
| — | `5fefa67` | compound 박 안 셋잇단, lone bass ≠ 선율 |
| 12 | `a104a36` | G3 mutation 6+no-op, A7b, `validate-preds.js --g3` |
| — | `8322599` | robust·full A/B에서 나온 수정 (clef·조·손) |
| 13 | `2ee0699` | `golden --g3` (A35), MIDI 경로 (A40) — **flip 없음** |
| 14 | `62042ed` | G3b, 기본 off |
| 15 | `0bacc0c` | human review set |

### 27.3 A1–A40

| # | 결과 | 근거 |
| --- | --- | --- |
| A1 | PASS | `test:scoregraph` 199/199 (132 + G3 67) |
| A2 | PASS | sg-roundtrip L1 368, L1+ 367, L2 369, play order 369 |
| A3 | PASS | `g3-preserve` (core·golden strict, performance 바이트 동일); MIDI는 A40 |
| A4 | PASS | 두 번·자식 프로세스·다른 CWD 바이트 동일 |
| A5 | PASS | core·golden, 코퍼스 369 force, fixture 전부 |
| A6 | PASS | strict 전 케이스 critic 위반·ERROR 0 |
| A7 | PASS | 심은 위반 12종 + **A7b** (§27.5 d) |
| A8 | PASS | 코퍼스 369 rewrite 모드 변경 0 |
| A9 | PARTIAL | `W-TUPLET-INCOMPLETE` 8,144 → 139, `W-DISPLAY-DURATION` 2,647 → 279, 새 경고 0, `W-BEAM-SHAPE`·`W-TUPLET-DISPLAY` 0. 남은 것은 26 케이스의 R17 1-tick 계열 (§27.4) |
| A10 | PARTIAL | F1 해소: 1-음 괄호 0, 논리 그룹 전부 그려짐 (전 0개). 앱은 32분 셋잇단 그룹을 둘로 나눠 그림 (79 그룹 → 84 괄호) — 렌더러는 G4 (D4) |
| A11 | PASS | T01–T10 |
| A12 | PARTIAL | `tm_missing` 2,647 → 279 (26 케이스, R17 계열) |
| A13 | PASS | T09 + core 표본 왕복 |
| A14 | PASS | core 553 케이스별 duration·onset_pos·ioi·notes.*·note_values·beat_placement 정확히 동일 (최신 코드) |
| A15 | PARTIAL | `mergeable_rate` 0.426 → 0.014 (17 케이스; H7 겹점·partial chord·R17·셋잇단 위치를 metric이 이진 길이로만 봄) |
| A16 | PASS | R01–R28 |
| A17 | PARTIAL | `hidden_beat_rate` 0.0174 → 0.0176: 작가가 고른 한 음가는 쪼개지 않는다 (§27.5 a) |
| A18 | PASS | R22 |
| A19 | PARTIAL (설계대로) | 기본 off에서 A14 성립; on 판정은 M11 뒤. 합성: core 553 throw·fallback·rollback 0, 마디당 쉼표 3.03 → 2.20, 32분 이하 9.2 % → 6.3 % (참고치, gate 아님) |
| A20 | PASS | `hand.accuracy` 0.888 → 0.921, hands gate +50 / −0, Beyer 032 0.50 → 1.0 |
| A21 | PASS | `over_span_rate` 0.00236 → 0.00234, G3가 만든 폭 > 14·> 5음 0 (DP 불가 비용) |
| A22 | PASS | H01–H11 |
| A23 | PASS | V01–V06 + core: 겹침 0, staff당 ≤ 2성부 |
| A24 | PASS (core·full) | core: 철자·key gate 케이스별 퇴행 0. full: 3 케이스 key gate 퇴행이 있었고 수정 (§27.5 c) |
| A25 | PASS | S01–S13 |
| A26 | PASS | 이조 part 철자·소리 불변 |
| A27 | PASS | `critical.accidentals` 100 %, `acc.redundant_rate` 0, courtesy_per_100 0 → 0.25 (gate +0.5) |
| A28 | PASS | B01–B12, core `boundary_ok` 1.0, `coverage` 0.985 |
| A29 | PASS | imported beam 불변 |
| A30 | PASS | M01–M06 |
| A31 | PASS | G3가 만든 dynamic·wedge·slur·art·fingering 0 |
| A32 | PASS | `critical.pedal` 퇴행 0 |
| A33 | PASS | `test:bench` 265 unit, golden 17/17 (G3 off), 기존 metric 불변 (reader/5 READS_AS) |
| A34 | **BLOCKED** | G0 gate: smoke·core·robust·replay-public PASS, full REGRESSION (amt micro 4건, §27.4). usable Δ: core +1.27 pt, robust +1.42, full +3.67, hold-out +0.96. G3 gate FAIL 2줄 |
| A35 | PASS (dry run) | `golden --g3`: 17 중 14 변경, 전부 허용 범주. bless는 flip 때 |
| A36 | PENDING | 세트·도구 완성 (`human-set --build/--pairs/--score`). 렌더링·판정은 사용자 (D7) |
| A37 | PASS | mutation-check 48/48 (G0 40 + G3 6 REGRESSION, no-op 둘 바이트 동일) + `g3-mutation.test.js` (§20.5 (7)(8)) |
| A38 | PASS | 26 suite: G3 off·on 모두 25/26, 같은 집합 (transcription은 venv 환경 실패, 양쪽 동일) |
| A39 | PASS | 단독 1.6 s (`npm run test:scoregraph:perf`), core suite 시간 +20 % |
| A40 | PASS | m27·m18·m19로 확인; A40이 지목한 M13·M14·M10은 4음 미만이라 열리지 않는다 (G2 R4, G3 on·off 동일) |

### 27.4 flip이 막힌 이유 — 설계 안의 충돌 (사용자 결정 필요)

§20.4 G3 gate는 `nq.shape.tm_missing == 0`과 `nq.tie.mergeable_rate == 0`을 요구한다. 설계의 다른 규칙이 이것을 불가능하게 한다:

1. **tm_missing 279 (26 케이스)**: 389/424개 event가 한 구간에 이진·셋잇단 격자점이 섞인 frozen region에 있다 (예: 40, 42 U — 1/96 W 간격). **R17**("1-tick 잔여 쉼표 — R-repr는 그대로 둔다, R-reg와 짝")이 바로 이것을 G3b에 넘긴다. 나머지 35개는 frozen 이웃에 잘린 셋잇단 조각. onset·길이 불변(G3a)으로는 중첩 tuplet 없이 쓸 수 없다.
2. **mergeable 17 케이스**: (a) H7 — 박에서 시작하지도 박을 채우지도 않는 겹점 (6/8의 `16.~8`); (b) partial chord tie; (c) R17 frozen; (d) 셋잇단 위치의 조각을 metric이 이진 길이로만 판정. G3가 합칠 수 있는데 안 한 것은 없다.

**full의 amt micro 4건** (micro는 하락 0 허용): M04·M15×2 `hand.accuracy` (오른손 4음 화음 안의 옥타브, 잡음 음), M20 `note_shape` 0.9266 → 0.9259 — 불일치 수는 8 → 8 그대로, G3가 조각을 합쳐 분모가 줄었다. 옥타브 항을 바꾼 두 변형(bare octave만; 한 손이 묶음 전체를 칠 때 면제)은 core hymns·M14에서 더 잃어 되돌렸다.

**선택지** (사용자): (A) gate를 "G3a가 쓴 구간에서" 0으로 해석하고 R17 계열을 허용 목록으로 (설계 문구 "(G3a가 만든 출력에서)"와 R17을 합치는 해석); (B) G3b(M11 뒤)까지 flip 보류; (C) micro 4건은 amt 프로파일의 micro no-drop 규칙 예외로 기록. 이 결정 없이 flip·golden bless·nq baseline을 하지 않았다. flip은 `audio-score.js` 한 줄 + `golden --bless --g3` + `update-baseline`이다.

### 27.5 설계와 다르게 한 것 (증거와 함께)

a. **작가가 고른 한 음가는 쪼개지 않는다** (R-repr `rewrite`): 규칙대로면 core `ties.extra_per_100` 4.24 → 5.19 (gate +0.5 초과). 규칙 위반만인 값은 조각 수가 늘지 않을 때만 다시 쓴다 → 4.24 → 2.66. R07b, A17 PARTIAL의 원인.
b. **compound 박 안 셋잇단** (§7.3의 구간 격자 그대로): 설계 초판 구현은 compound 박 전체를 frozen으로 두었다. 8분 단위 16분 셋잇단 + 같은 박 두 8분 위의 3:2 8분, P5는 점4분 박을 넘지 않는다. tm_missing 657 → 415 (그래프 기준), 셋잇단 tie 356 → 75. R25–R28.
c. **한 5도 조 전환은 조표를 바꾸지 않는다** (§10.2 보완): 소나티네 딸림조 구간에 조표를 주자 full key gate 3 케이스 퇴행 (A24). 판각 관례대로 임시표로 쓴다. C → E♭(S06)은 유지. S13.
d. **A7b**: 1-tick onset 이동은 항상 인쇄 불가능한 길이를 남겨 validator가 잡는다 — critic fingerprint를 시험하지 못한다. 16분 늦은 인쇄 가능한 이동을 추가; mutation (7)은 박 단위로만 위치를 읽는 critic.
e. **clef 규칙 보강** (§9.3): "덧줄 ≥ 4 한 마디 이상"만으로는 오른손 아래 옥타브를 치는 왼손(B4 G4 D5, reference는 treble)이 bass clef에 남아 robust `heavy_rate`가 gate 초과. 한 음이라도 ≥ 4이고 다른 clef가 모든 음을 < 4로 받으면 바꾸고, 양쪽 다 읽히는 마디는 구간을 끊지 않는다. H09.
f. **손 DP**: 가중치는 §9.2가 허용한 대로 core로 정함 (0.888 → 0.921). 추가: 선율 항은 앞 묶음의 왼손에 더 가까운 lone bass(M16, H10)나 오른손이 아직 누르는 음 아래의 화음(Gymnopédie, H11)에는 적용하지 않는다 — DP 상태(a, sa)만 읽어 정확·idempotent.
g. **철자 line speller는 기본 off** (`opts.spelling`): 켜면 core 철자 몇 케이스 퇴행. 조 구간 + 표 철자 + 화음 수직 규칙이 기본.
h. **A35 허용 범주에 페달 한 형태 추가**: P8(§12)이 release와 1박 안의 다음 press를 change 하나로 쓴다 (G15). 그 외 페달 차이는 거절.
i. **human set의 "교재 6종"**: 적격(신뢰·PPP 비전사·비생성) reference는 40개, 교재 4종 + catalog. hymns·micro는 PPP 생성. 출처 6곳이 아니라 가능한 5곳에 고르게.
j. **E8'** (Gymnopédie 6/8 m5): 기대 "변화 없음" — 작가 값 규칙으로 반마디는 유지, `8.~16`은 `4`로 (조각이 줄어듦).
k. **perf 테스트**: `node --test`는 파일을 병렬로 돌려 시간이 약 2배 (CPU 시간도). 2 s 판정은 단독 실행 `npm run test:scoregraph:perf`에서, suite 안에서는 기록만.

### 27.6 Reviewer가 먼저 볼 것

1. §27.4의 gate 충돌 판단이 맞는가 — 특히 R17 계열 분류 (`residual2.js` 방식: 구간 격자 혼합).
2. 성능 변경의 구조적 공유 (`ops.edit(validate:false)`가 바뀌지 않은 event를 입력의 frozen 객체로 돌려줌, critic의 event 단위 memo). core 553 + fixture 253에서 출력 동일(ID 번호 제외)을 확인했지만 불변성 가정이 깨지면 조용히 틀린다.
3. 손 DP의 비대칭 규칙들 (§27.5 f)과 full amt micro 퇴행.
4. `golden --g3`와 mutation G3 그룹의 base edit(`G3_ON`) — flip 뒤에는 `G3_ON = []`로 바꿔야 한다.
5. G3b λ = 1과 perf-voices의 보수적 조건 — M11 전에는 아무 수치도 승인하지 않았다.
6. `mk(spec.heard)` 기본 release가 "첫 조각 길이"에서 "tie 전체 길이"로 바뀌었다 (테스트 도우미만).

---

## 28. 독립 리뷰 (G3 Reviewer, 2026-09-24)

`D:/PPP-g3`, `g3-score-intelligence` @ `bc1f7b4` (clean, `origin/g3-score-intelligence`와 같음). 기준 `origin/main` = `cc509e2`. 코드는 한 줄도 고치지 않았다 — 이 절과 `CURRENT_STATE.md`만 쓴다. `D:/PPP`, `main`, G4는 건드리지 않았다.

### 28.1 판정

**NEEDS_FIX** — BLOCKER 1, MAJOR 6, MINOR 5, OPTIONAL 5.

G3a의 음악 보존은 독립 검증으로 확인됐다 (§28.3). 그러나 flip하면 **앱이 페달이 있는 모든 녹음 악보를 페달을 한 번도 떼지 않고 재생한다** (B1). 손 DP는 흔한 피아노 짜임에서 병적인 배정을 한다 (M1). A6·A37은 HEAD에서 FAIL이다 (M2, M3). human review 세트는 블라인드가 아니다 (M4). 승인된 "R17만 분리" 방향은 `tm_missing`에는 맞지만 `mergeable`에는 모자란다 (M6). A36 사람 평가 전 flip 금지, G3b는 M11 전 OFF, 자동 8va OFF — 셋 다 지금 코드에서 지켜지고 있다.

### 28.2 방법 — 구현자 결과를 쓰지 않고 다시 잰 것

- **SUT 세 개** (scratchpad, 저장소 밖): base = `git:cc509e2`, off = `git:bc1f7b4`, on = off에서 `PROFESSIONAL_DEFAULT = 'on'` 한 줄만 바꾼 것. smoke·core·robust·replay-public·full을 셋 다 `run --out`으로 돌리고, 판정은 `compare.compare`에 base를 pseudo-baseline으로 넣어 냈다 (`ab`와 같은 방식, 저장된 오래된 baseline을 쓰지 않음).
- **독립 도구** (저장소 코드를 쓰지 않음, scratchpad): MusicXML을 명세에서 직접 읽는 파서(울리는 음 = (part, onset, 실제 MIDI, tie로 합친 길이), onset별 음, 마디·박자·템포·반복·표기·꾸밈음·페달·조표); 그래프 투영(critic과 별개로 tie를 따라 울리는 음 계산, performance 바이트, 입력 불변·deep freeze·공유 객체 변경 시도, P(P(g)), 두 번 실행); residual 분류기(아래 §28.4); 음표별 손 비교(G0 정렬로 짝지은 참조 음의 손, off vs on); 앱 `Playback.pedal/pedalUp/strikes` 규칙을 그대로 재현한 페달 재생 모델.

### 28.3 음악 보존 (G3a) — 통과

| 무엇 | 어디서 | 결과 |
| --- | --- | --- |
| 울리는 음 (tie 합친 길이·onset·실제 MIDI), onset별 음 다중집합, 마디 수·길이, 박자, 템포(`<sound tempo>`·metronome), 반복·volta, 꾸밈음, slur·dynamics·wedge·articulation·fermata·fingering·lyric·octave-shift | MusicXML, 독립 파서, off vs on — smoke 44 + core 553 + robust 282 + full 4,976 (full만 울리는 음 1,280,721개) | **전부 동일** |
| performance 층 바이트, timeline(마디·박자·템포·ending·jump), 조표, 입력 그래프 불변·deep freeze | 그래프, core 553 + robust 282 + full 4,976 | 전부 동일 / 조표 변경 **0건** |
| 재생 순서 | 반복이 있는 입력은 import 경로(기본 G3 미적용)뿐. corpus 369 force 모드는 `g3-preserve`·`sg-roundtrip` | 동일 |
| 이조 part | `transposing.musicxml` rewrite·fill·force | 불변 |
| 미분음 | `microtone-quarter-sharp.musicxml` rewrite·fill | 불변 (force는 m3) |
| **페달 (앱 재생)** | 앱 규칙 재현 | **B1 — 바뀐다** |

보존 검사에서 나온 유일한 이상은 cross-voice tie (m1): 음 하나의 tie 조각이 서로 다른 성부로 간다. 앱 **재생**은 tie를 MIDI+위치로 이어서 소리는 같다 (App 2643–2658). 그러나 렌더러는 (staff, voice) 사슬 안에서만 tie를 그려 (App 10866) 화면에는 다시 치는 음으로 보인다.

### 28.4 R17 gate 충돌 — 판정

**충돌은 실제다. 그러나 승인된 "R17만 분리"로는 gate가 정직하게 통과하지 않는다.**

분류기 (독립, 저장소 코드 미사용): residual마다 그 성부-마디를 경계점(음 시작, tie로 합친 음 끝, 쉼표 구간 끝)으로 자르고, U = 192/온음표에서 창(단순 박자: 박, 그 외: 8분)이 이진 격자(3의 배수)와 셋잇단 32분 격자(4의 배수) 중 하나로만 설명되지 않으면 MIXED. 한 격자를 골랐을 때 어긋난 점이 **전부 release**(onset이 아닌 음 끝·쉼표 시작)이고 격자에서 1 tick(2 U) 이내면 **R17** — release를 옮기는 것(R-reg, G3b)으로만 고칠 수 있다. onset이 어긋나면 ONSET(G3 밖). 자기 창은 깨끗하지만 같은 셋잇단 창을 공유하는 이웃 조각이 R17 창에 걸려 묶일 수 없는 경우 **R17_NEIGHBOUR**. tie는 추가로 H7(겹점이 박에서 시작도 박을 채우지도 않음), H6(합친 값이 한 셋잇단 괄호 안의 한 기호가 아님 — 괄호 경계를 넘거나 셋잇단 한 값이 없음), PARTIAL(화음 일부만 tie), XVOICE로 나눴다.

| suite | `tm_missing` | 숨긴 1-음 tuplet (M5) | "mergeable" tie |
| --- | --- | --- | --- |
| core | 279 = R17 264 + NEIGHBOUR 15 | 139 = R17 137 + NEIGHBOUR 2 | 98 = **H7 58, H6 30**, R17 5, PARTIAL 4, XVOICE 1 |
| robust | 133 = R17 121 + NEIGHBOUR 11 + CLEAN 1 (rollback 마디) | 48 = R17 48 | 45 = H6 21, R17 13, H7 5, PARTIAL 5, XVOICE 1 |
| full | 2,943 = R17 2,683 + NEIGHBOUR 255 + CLEAN 5 (rollback 마디) | 1,226 = R17 1,212 + NEIGHBOUR 14 | 923 = **H7 497, H6 266**, R17 91, PARTIAL 49, XVOICE 4, P2가 만든 PARTIAL로 R-repr가 건너뛴 마디 16 |

- core에서 ONSET 0 — "R-reg만이 고친다"(§27.4)는 `tm_missing`에 대해 맞다. §20.4 문구 "(G3a가 만든 출력에서)"와 R17(§6.3)이 이것을 G3b에 넘기므로, `tm_missing`을 R17로 나누는 것은 **완화가 아니라 goal 소유권**이다.
- **`mergeable`에서 R17은 core 5 %, full 10 %뿐이다.** 대부분은 metric 정의("한 기호로 쓸 수 있는 tie", §20.3)가 설계 자신의 하드 규칙 H6·H7과 G3a 단일 성부(§8.2)를 모르는 탓이다. 그 tie는 설계상 합칠 수 없다. 이것을 metric에 반영하는 것은 R17 승인 범위 밖이므로 **사용자 결정**이다 (§28.9 U-1).
- XVOICE·P2-PARTIAL(m1)과 rollback 마디의 CLEAN(M2)은 **G3 결함**이다 — 분리하면 안 되고 고쳐야 한다.
- **R17 bucket은 공짜 면제가 아니다.** mutation `G3-TRIPLET-REST-NO-TM`(셋잇단 쉼표에 time-mod 없음)에 분류기를 돌리면 CLEAN `tm_missing` 1,213 + 숨긴 tuplet CLEAN 704가 나와 gate는 여전히 FAIL이지만, R17 bucket도 264 → 1,221로 커진다 (원래 R17 창 안에서 tuplet pass가 묶던 raw 쉼표들). 그러므로 R17 residual 수는 **케이스별 baseline(증가 금지)**이어야 한다. `G3-TIES-IN-BEAT`는 UNEXPLAINED mergeable 1,834로 잡힌다.
- core `tm_missing` 중 8개(R17 1 + NEIGHBOUR 7)는 raw 그대로가 아니라 **G3a가 다시 쓴** 조각이다 (M2의 결함). "writer가 쓴 그대로 남긴 것"만 R17로 인정해야 한다.

### 28.5 Findings

**BLOCKER**

- **B1 — G3a on이면 앱이 페달을 떼지 않는다.** P8(§13.2, G3-I7)은 release와 1박 미만 뒤의 press를 `changes` 하나로 합친다. 앱은 `change`를 떼지 않는 half-pedal로 재생한다: `Playback.pedal`(App 2660–2676)은 이미 내려가 있으면 `change`를 무시하고, `pedalEvents`(App 2828)는 CC64 = 64를 낸다. 그래서 legato 페달(마디선에서 떼고 1/48 W 뒤 다시 밟음, `pedal|oracle` 연주자가 하는 것)이 **곡 전체에 걸친 damper 하나**가 된다. 예: `sonatina/021|pedal|oracle|s1` raw 페달 62개 → G3 페달 1개 + change 61개. `strikes`(App 2864–2869)가 음 끝을 damper가 떼질 때까지 늘리므로, core pedal 30 케이스에서 음 10,439 / 10,932개가, full에서 146,242 / 159,412개가 더 길게 울린다 (평균 58 q / 44 q — 이어 붙은 damper 구간의 끝까지, 위 예에서는 곡 끝). 두 경로 모두 닿는다 (`legacy-score.js:352`, exporter `ped('change')`). 페달 표기가 바뀐 케이스: core 30, full 622 (join core 796, full 13,150). G0 페달 metric은 한 자리도 안 움직이고(0.9777 → 0.9777), MuseScore는 `change`를 올바르게 읽으므로 human review로도 보이지 않는다. golden `--g3` 허용 범주가 바로 이 변경을 허용한다(§27.5 h). **고칠 방향**: flip 전에 P8 페달 합치기를 기본 OFF (D2와 같은 논리: 앱이 틀리게 재생하는 표기는 쓰지 않는다), 또는 앱 재생을 고친다(G3 범위 밖, 사용자 결정 U-3).

**MAJOR**

- **M1 — 손 DP의 병적 배정.** 평균은 좋아진다(core 0.8876 → 0.9221, hands gate +50/−0; full 0.856 → 0.906, +726/−0). 그러나 깨끗한 입력의 흔한 짜임에서 틀린다.
  - octave 항(1500 > keep 900)이 한 손 안의 옥타브를 무조건 벌점: 왼손 옥타브 베이스 `C2+C3 G2+G3 C2+C3` → G3·C3을 **오른손 2성부로** 옮김; 오른손 `C4+E4+G4+C5` 화음 → C4를 왼손 2성부로; 선율 `E4 D4 B3 C4` 아래 왼손 `G2+G3` → G3을 오른손으로.
  - melody 항이 손을 번갈아 치는 음형(한 음씩 교대)을 한 손으로 접음: `method/czerny849/027|human|oracle|s11` (**깨끗한 입력**; human·pedal·lowconf × s11·s12 6 변형 모두 약 0.90 → 0.83) — 참조와 raw가 오른손에 둔 Eb4 43개를 포함해 44음이 틀려지고 6음이 나아짐.
  - full에서 hand accuracy가 떨어지는 케이스 403개. amt micro M15 s2(깨끗한 `G4+B4+D5+G5`, `G4+G5` 화음이 쪼개짐)도 같은 원인.
  - **고칠 방향**: octave 항은 "선율이 옥타브로 겹쳐 병행하는 경우"(E6)에만, 한 손 화음의 외성 옥타브와 왼손 옥타브 베이스는 면제; melody 항은 단음 교대 음형에 적용하지 않음(앞뒤 문맥이 선율일 때만). 위 짜임을 H-fixture로 추가.
- **M2 — R-repr가 묶일 수 없는 셋잇단 창에 조각을 쓴다. A6은 명세대로 FAIL.** 같은 셋잇단 창을 공유하는 이웃 segment가 R17 창 때문에 그대로 남으면(stuck) 그 창은 tuplet으로 완성될 수 없는데, R-repr는 창 안의 다른 segment를 셋잇단 값으로 다시 쓴다 → time-mod 없는 셋잇단 조각.
  - 조각이 **새 ID**면 critic이 새 `W-DISPLAY-DURATION`을 보고 그 마디를 raw로 되돌린다: robust 1 (`sonatina/012|human-alt` m44), full 9. 되돌린 마디에 raw 1-음 괄호가 남아 `one_note_rate`가 robust·full에서 FAIL. strict에서는 throw: `PPP_G3_SUITES=robust node --test tests/scoregraph/g3-preserve.test.js` → `CriticError: … W-DISPLAY-DURATION e1669`. A6 fixture는 "core + robust + golden"인데 테스트 기본값은 `core,golden`이라 CI는 못 본다.
  - 조각이 경고가 있던 **옛 ID를 재사용**하면 critic의 (code, IDs) 비교가 "입력의 경고"로 넘긴다: core에서 G3a가 다시 쓴 time-mod 없는 셋잇단 조각 8개 (예: `hanon/007|human|none` m1–m4, 6/8의 E 음이 `32nd~` + 셋잇단 32분으로).
  - **고칠 방향**: stuck segment가 걸친 셋잇단 창의 모든 segment를 그대로 둔다(동결 전파); critic은 G3가 내용을 바꾼 event의 경고를 G3의 것으로 본다; g3-preserve 기본 suite에 robust.
- **M3 — mutation-check가 HEAD에서 FAIL (47/48). A37은 FAIL.** `G3-SPELL-STATIC`(구간 조 끄기) 결과가 원본과 **바이트 동일**. 구간 조 pass는 core·robust·full 5,811 케이스에서 조표를 **한 번도** 바꾸지 않는다 (core: 441 케이스는 창 결과가 적힌 조와 같고 112 케이스는 12마디 미만). `8322599`의 "한 5도 전환은 조표를 바꾸지 않음"(G3-I3) 이후 이 기능은 benchmark에서 비활성이고, §27.3의 "48/48"은 그 전 측정이다. main에 merge되면 nightly의 `mutation-check`가 실패한다. §19 E5·E9(조 재추정)도 실제 케이스에서는 일어나지 않는다. **고칠 방향**: 살아 있는 철자·임시표 경로를 겨누는 mutation으로 바꾸거나, 구간 조가 실제로 움직이는 케이스를 mutation suite에 두고 그 효과를 보이기; 기능이 비활성이면 그렇다고 기록.
- **M4 — human review 세트가 블라인드가 아니다.** 파일 이름이 `A/B/C.musicxml`이고, 같은 폴더의 `meta.json`이 "B = recording path, G3a on"이라고 쓰며, 템플릿이 쌍의 좌우를 `"left": "A", "right": "B"`로, 절대 평가 항목을 `"version": "C"`로 보여 준다 (§21.4 "블라인드 쌍 비교" 위반). **고칠 방향**: 평가자용 폴더에 불투명 이름(예: 발췌마다 무작위 두 글자)만 두고, 열쇠(`key.json`)는 분리해 `--score`만 읽는다. C는 제목·작곡가·셈여림이 있어 본질적으로 알아볼 수 있다 — 한계로 기록.
- **M5 — 묶이지 않는 1-음 tuplet을 숨긴다 (`printed:false`).** 설계 T08은 "변화 없음 + `N-TUPLET-UNGROUPABLE`"이고 §7.2는 괄호 표시를 G4 결정·G3 생성은 `printed: true`로 정했는데, 구현은 T08 fixture를 "unprinted: 3"으로 바꿨고 §27.5에 적지 않았다. exporter는 `printed:false`에 `<tuplet>`을 쓰지 않으므로(`musicxml-export.js:517`) reader/5의 `one_note_rate`가 이 조각들(core 139, full 1,226)을 보지 못하고, time-mod가 있어 `tm_missing`에도 안 잡힌다 → core의 "`one_note_rate == 0` PASS"는 부분적으로 숨김의 결과다. 앱 렌더러는 이 음에 괄호도 숫자도 그리지 않는다. **고칠 방향**: T08대로 되돌리고(인쇄 유지) R17 분류로 설명하거나, nq가 괄호 없는 time-mod 단독 음을 1-음 tuplet으로 센다.
- **M6 — gate 재정의가 R17만으로는 부족하다** (§28.4). `mergeable`의 core 94 %·full 88 %가 H6·H7·PARTIAL, 즉 metric 정의 문제이고, R17 bucket은 baseline 없이 면제하면 퇴행을 숨긴다. **고칠 방향**: §28.9.

**MINOR**

- **m1 — P2가 tie 조각을 서로 다른 성부로 보낸다.** 조각마다 따로 옮겨서, 한 조각은 다른 staff 화음에 합쳐지고(`joinHeads`) 다른 조각은 2성부로 간다: cross-voice tie core 1(`burgmuller25/013|deadpan` m1), robust 1, full 33 (29 케이스). 또 tie가 있는 음에 머리를 합쳐 부분 화음 tie를 만들고, R-repr가 그 성부-마디 전체를 건너뛰어 옆의 평범한 `8.~16`이 안 합쳐진다 (full 16, 예: `sonatina/015` m16). 재생은 같고 화면은 다시 치는 음. **고칠 방향**: tie 사슬 전체를 한 성부 단위로 옮기고, tie가 있는 event에는 합치지 않는다; G3가 만든 cross-voice tie는 critic 위반.
- **m2 — idempotence 1건 실패 (full 1 / 4,976).** `hymns/hyfrydol-alleluia|amt|oracle-noisy|s2`: 두 번째 실행에서 clef가 생긴다 (`nextId` 930 → 932). clef 규칙(G3-I4)이 덧줄 합을 **tie 조각마다** 세는데 뒤의 R-repr가 조각을 합쳐 합이 9 vs 7 → 6 vs 7로 뒤집힌다. §16.2(P2 입력 특징은 P4–P7이 바꾸지 않는 것만) 위반. 명세의 A5 집합(core·golden·corpus 369·fixture)에서는 통과, production은 한 번만 돌려 영향 없음. **고칠 방향**: 울리는 음(tie 사슬) 단위로 센다.
- **m3 — force 모드가 미분음 임시표를 바꾼다.** `quarter-sharp` → `sharp`, `quarter-flat` → `flat` (소리는 ext로 보존). force는 테스트 전용. **고칠 방향**: `musicxml.microtone` ext가 있는 head의 `acc`는 건드리지 않는다.
- **m4 — amt micro M20은 metric 산물.** `note_shape` 불일치 8 → 8, 분모 109 → 108 (G3가 tie 조각 하나를 합침) → 0.9266 → 0.9259. **disposition**: micro no-drop을 비율이 아니라 불일치 수로 판정 (이유 키, 파일 이름 아님).
- **m5 — 테스트 범위가 명세보다 좁다.** A6 테스트 기본 suite에 robust가 없고(M2가 CI에 안 잡힘), A37 증거는 오래됐다(M3). §27.3의 A6·A37 PASS는 재현되지 않는다.

**OPTIONAL**

- o1 — A10: 논리 그룹은 올바르다 (czerny849/020 core: 528 그룹 전부 완전, 멤버 연속, start/stop 첫·끝). 앱 렌더러가 32분 셋잇단이 섞인 그룹 4개를 괄호 2개로 나눈다 (App 11609–11621, "normal × 가장 짧은 값"). **G3 PASS, G4 렌더러 후속.**
- o2 — H3이 3/4의 1–2박 2분쉼표를 금지해 core에서 61곳이 `q q`가 된다. 설계의 보수적 선택. 흔한 현대 관례는 허용 — 원하면 S표에 추가.
- o3 — human set의 C 파일 18개는 원본 참조가 `<score-part>`/`<part>`에 `id`가 없다 (원본 그대로 복사). MuseScore 4에서 열리는지 평가 전에 확인.
- o4 — human set의 `nq.ned`(참조와의 표기 거리)가 A → B 평균 1.016 → 1.047로 **늘었다** (B가 가까움 8, 멀어짐 9, 같음 3; HG11 2.36 → 2.87). §21.5는 감소를 기대한다 — A36 18/20 기준이 위험하다는 신호(정보).
- o5 — `ops.Draft`의 재사용은 입력 루트의 `Object.isFrozen(g)`만 본다. production 입력은 전부 deep-frozen·canonical이라 안전하지만(§28.7), 루트만 freeze된 입력이면 가변 event를 공유·제자리 정렬할 수 있다. 방어적으로 event마다 `Object.isFrozen(e)` 확인.

### 28.6 amt micro 4건 (full G0 REGRESSION)

| 케이스 | 변화 | 실제 음 | 판정 |
| --- | --- | --- | --- |
| M04-triplets-4-4 amt none s1 | hand 0.94 → 0.90 | pred m6: raw가 오른손에 맞게 둔 D5·G5가 왼손으로 — AMT 입력이 왼손에 B4, 오른손에 F#6을 둔 마디에서 왼손 B4 쪽으로 끌려감 (나아진 음 0) | **A** (AMT 경로의 현실적 입력에서 M1의 이동·선율 비용이 맞는 음을 옮김) |
| M15-wide-chords amt none s1 | 0.894 → 0.879 | m8: 오른손 B4·D5가 왼손으로 — AMT가 더한 B5가 오른손 B4와 옥타브 → octave 항 | **A** (M1) |
| M15-wide-chords amt none s2 | 0.893 → 0.879 | m9: 잡음 없는 `G4+B4+D5+G5`, `G4+G5`에서 G4가 왼손 2성부로 | **A** (M1, 깨끗한 입력) |
| M20-compound-12-8 amt oracle-noisy s1 | note_shape 0.9266 → 0.9259 | 불일치 8 → 8, 분모 109 → 108 | **B** (m4) |

A 셋은 예외 처리가 아니라 M1을 고쳐서 없앤다.

### 28.7 손 DP · 성부 · 리듬 · 철자 · 구조 공유

- **손 DP**: 재현 — core 0.8876 → 0.9221, hands gate +50/−0, Beyer 032 1.0; full +726/−0. 병적 배정은 M1. crossing은 만들지 않는다(설계대로, 왼손이 잠깐 위로 가는 C6은 오른손으로). 극단 음역(C8/A0), 13도 화음, 셋잇단 아르페지오, 트레블로 올라가는 왼손(clef)은 probe에서 바뀌지 않았다.
- **성부**: `E-VOICE-OVERLAP` 0, staff당 ≤ 2 (core·robust·full), 2성부가 생긴 케이스 core 146 / full 1,340 — 전부 P2 이동의 결과이고 그중 일부는 M1의 틀린 이동. 2성부 쉼표 core 894 (전체 쉼표의 2 %). G3b `perf-voices`는 `opts.g3b`로만.
- **리듬·쉼표·tie**: rests/bar(`read.rests_per_measure`) core 2.88 → 3.08. 그래프 쉼표 41,774 → 44,110: R-repr 단독 +1,748 (같은 구간의 쉼표 2,265개를 규칙대로 더 나누고 539개를 합침), P2 약 +1,015 (2성부 쉼표 894 포함). 나누는 패턴은 박을 드러내는 표준 규칙이다 — 4/4·6/8 "e"에서 시작한 `8.` → `16 8` 1,069, 4/4 가운데를 가리는 `h.` → `q h`/`h q` 235, 3/4 2–3박 `h` → `q q` 82 등. 불필요한 과분할 버그는 찾지 못했다 (선택지는 o2뿐). `ties.extra_per_100` 4.24 → 2.66. `tm_missing` 2,647 → 279는 §28.4. **R17만이 release 변경을 필요로 한다**는 `tm_missing`에 대해 확인했다 (ONSET 0).
- **철자·임시표**: `critical.accidentals` 1.0, `required_recall` 1.0, `nq.acc.redundant_rate` 0, 케이스별 철자·key 퇴행 0 (core·robust·full) — 단 구간 조는 한 번도 발동하지 않아(M3) A24는 사실상 무변화로 통과한다. 이조 part 불변, 미분음은 m3.
- **구조 공유·불변성**: 공유된 event 객체 core 138,185 / full 1,114,506개 전부 deep-frozen, 변경 시도는 전부 throw, 입력 그래프는 G3 전후 바이트 동일·deep-frozen, 출력은 deep-frozen이고 **메모리 상태로도 canonical** (core 553: `canonicalize(JSON)`과 동일). 재사용 조건은 JSON 동일성이고, event의 canonical 형태는 자기 필드에만 의존한다(`eventStaff`). critic memo는 (frozen event, 마디 시작)의 순수 함수. **안전하다** (o5만).
- **idempotence**: core 553 P(P(g)) 바이트 동일·같은 객체·`nextId`/`rev` 불변, 두 번 실행 동일; valid·xml fixture 195 실행(rewrite·fill·force) 전부 idempotent; `g3-idempotence.test.js`(golden·corpus 369 force·G3 fixture) 통과. 예외는 full 1건 (m2).
- **G3b·8va 격리**: 기본 pass 목록 `staff, voice, rhythm, tuplet, spell, beam, marks`. `perf-voices`·`regularize`는 `opts.g3b`, `ottava`는 `opts.ottava`에서만; production(`toMusicXml`)은 `professionalOptions || {}`를 넘기고 아무도 설정하지 않는다. λ = 1(`REG.LAMBDA`)은 자리표시, baseline·lock 변경 없음. on 출력에 `<octave-shift>` 0. **G3b는 M11 전 production ready가 아니다.**

### 28.8 A1–A40 재판정

| # | 구현자 | 리뷰 | 근거 |
| --- | --- | --- | --- |
| A1 | PASS | PASS | `test:scoregraph` 199/199 |
| A2 | PASS | PASS | sg-roundtrip 369: L1 368, L1+ 367, L2 369, 순서 369 (허용 2) |
| A3 | PASS | PASS | performance 바이트 5,811 케이스 동일 |
| A4 | PASS | PASS | 두 번 실행·테스트(자식 프로세스·다른 CWD) |
| A5 | PASS | PASS (명세 집합) | full 1건 실패 (m2) |
| A6 | PASS | **FAIL** | robust strict throw, full rollback 9 (M2) |
| A7 | PASS | PASS | 심은 위반 12종 + A7b; (code, IDs) 비교의 틈은 M2 |
| A8 | PASS | PASS | corpus 369 rewrite 무변경 |
| **A9** | PARTIAL | PARTIAL | `W-DISPLAY-DURATION` 2,647 → 279, `W-TUPLET-INCOMPLETE` 8,144 → 139; 나머지는 R17 계열(§28.4), 새 경고 0 (core) |
| **A10** | PARTIAL | PARTIAL (G3 의미 PASS) | 1-음 괄호 0, 그룹 완전; 앱이 32분 셋잇단 그룹을 나눔 → G4 (o1) |
| A11 | PASS | PASS | T01–T10 — 단 T08은 설계와 다름 (M5) |
| **A12** | PARTIAL | PARTIAL | 279 전부 R17 계열, 그중 8개는 G3a가 다시 쓴 조각 (M2) |
| A13 | PASS | PASS | |
| A14 | PASS | PASS | duration·onset_pos·ioi·notes.*·note_values·beat_placement 케이스별 동일 (core); `page_accuracy`만 3 케이스 이동 — 표시가 실제 길이와 일치하게 된 결과 |
| **A15** | PARTIAL | PARTIAL/FAIL | 98 = H7 58, H6 30, R17 5, PARTIAL 4, **XVOICE 1 (G3 결함)** |
| A16 | PASS | PASS | R01–R28 |
| **A17** | PARTIAL | PARTIAL | 0.0174 → 0.0176 (G3-I1, 기록된 이탈) |
| A18 | PASS | PASS | |
| **A19** | PARTIAL | **DEFERRED (M11)** | 기본 off에서 A14 성립; on 판정은 실제 녹음 3곡 뒤. 합성 수치는 gate가 아니다 |
| A20 | PASS | PASS (수치) | 0.922, +50/−0, Beyer 032 1.0 — 병적 배정은 M1 |
| A21 | PASS | PASS | `over_span_rate` 0.00236 → 0.00234 (full 0.00235 → 0.00237) |
| A22 | PASS | PASS | H01–H11 (M1 짜임은 없음) |
| A23 | PASS | PASS | |
| A24 | PASS | PASS (공허) | 퇴행 0 — 구간 조가 발동하지 않음 (M3) |
| A25–A27 | PASS | PASS | |
| A28–A31 | PASS | PASS | boundary_ok 1.0, coverage 0.985; 표기 불변 |
| A32 | PASS | PASS (문구) | `critical.pedal` 퇴행 0 — 그러나 앱 재생은 B1 |
| A33 | PASS | PASS | unit 265, golden 17/17, base ≡ off (모든 metric·MusicXML 동일, full 포함) |
| **A34** | BLOCKED | **FAIL** | G0: smoke·core·robust·replay-public PASS, full REGRESSION (micro 4, §28.6). G3 gate: core 2줄, robust 3줄, full 3줄 FAIL. usable Δ core +1.27, robust +1.42, full +3.67, hold-out +0.96 (재현) |
| **A35** | PASS (dry) | PASS (dry) | 17 중 14 변경, 전부 허용 범주 — 페달 범주가 B1을 허용함 |
| **A36** | PENDING | **PENDING** | 세트 존재·재현(60/60 바이트 동일)·라이선스 기록, 블라인드 아님 (M4) |
| A37 | PASS | **FAIL** | mutation-check 47/48 (M3) |
| A38 | PASS | PASS | 26 suite를 하나씩: G3 off 25/26, G3 on(HEAD를 export해 기본값만 `'on'`) 25/26, 같은 집합 — `transcription`은 venv 경로 검사(`transcribe.py`·그 테스트는 G3가 안 건드림, G1·G2와 같은 환경 실패). 어느 suite도 녹음 악보의 페달 재생을 보지 않아 B1을 못 잡는다 |
| A39 | PASS | PASS | 단독 2,000마디 40k head 1.68 s; 500/1000/2000/4000마디 0.38/0.79/1.68/3.61 s (선형); core suite +22 % |
| A40 | PASS | PASS | `g3-midi.test.js` 통과 (M13·M14·M10은 G2 R4로 열리지 않음) |

### 28.9 merge 전에 필요한 정확한 작업

**사용자 결정** (Fixer가 정할 수 없는 것)

- **U-1 (M6)**: `nq.tie.mergeable_rate`의 "한 기호로 쓸 수 있는"을 설계 규칙 H6·H7과 단일 성부에 맞춘다 (그 tie는 설계상 합칠 수 없음) — 승인된 R17 범위 밖의 metric 정의 변경. 또는 H6/H7을 바꾼다.
- **U-2**: PARTIAL(부분 화음 tie)을 G3a 범위 밖(성부 분리는 G3b)으로 둘지.
- **U-3 (B1)**: P8 페달 합치기를 기본 OFF로 둘지(권고, D2와 같은 논리), 앱의 `change` 재생을 고칠지(앱 재생 변경, G3 밖).

**Fixer**

1. B1: P8 페달 join 기본 OFF (U-3 전까지), golden `--g3` 허용 범주에서 페달 형태 제거, 앱 재생 모델로 페달 음 끝을 비교하는 테스트 추가.
2. M1: octave·melody 항 수정(§28.5 M1), 위 probe 짜임 5개를 H-fixture로; core·full hand 재측정 — micro M04·M15 회복 확인.
3. M2: 동결 전파 + critic의 내용 기반 경고 판정 + `g3-preserve` 기본 suite에 robust; robust·full rollback 0 확인.
4. m1: tie 사슬 단위 이동, tie가 있는 event에 head 합치기 금지, cross-voice tie를 critic 위반으로.
5. M5: T08 설계대로(인쇄 유지) 또는 nq가 괄호 없는 단독 time-mod를 센다.
6. M6: gate 구현 — `check --g3`의 zero 줄을 "unexpected == 0"으로: (a) 분류는 G3 내부가 아니라 출력(MusicXML/그래프)의 격자 분석(§28.4 규칙), (b) R17은 writer가 쓴 그대로 남은 residual만, (c) R17 수는 케이스별 baseline·증가 금지, (d) XVOICE·rollback·CLEAN은 항상 FAIL, (e) 분류기 mutation 증명(`G3-TRIPLET-REST-NO-TM`, `G3-TIES-IN-BEAT`가 unexpected로 잡힘). 파일 allowlist 금지.
7. M3: `G3-SPELL-STATIC`를 살아 있는 경로로 교체(또는 구간 조가 움직이는 케이스로 증명) — mutation-check 48/48.
8. M4: 블라인드 세트 재생성 (`--pairs`가 불투명 라벨 + 분리된 열쇠).
9. m2, m3, m4 (M20 불일치 수 판정).
10. 다시: `test:scoregraph`(+ `PPP_G3_SUITES=core,robust,golden`), `test:scoregraph:perf`, `test:bench`, `golden --g3`, `mutation-check`, smoke·core·robust·replay-public·full `ab` vs `cc509e2`, `check --g3`, `npm test` off·on, 앱 페달 재생 비교.

그 뒤에 A36 (사용자, MuseScore 4). flip은 A36 통과 뒤. G3b는 M11 전 OFF, 자동 8va OFF.

### 28.10 human review 방법 (A36, 사용자용)

세트: `tests/bench/human/g3/HG01–HG20/{A,B,C}.musicxml`, 층화 6종·출처 5곳, 참조는 신뢰·PPP 비전사 파일(provenance는 `meta.json`의 `reference`). 재생성: `python tests/bench/run.py human-set --build` (결정론적, 60 파일 바이트 동일 확인), `--pairs` (seed 20260924). **M4를 고친 뒤** 평가:

1. MuseScore 4에서 각 파일을 열어 같은 설정으로 본다 (앱 렌더러는 beam·괄호를 스스로 다시 정해 쓰지 않는다, D7).
2. 쌍 비교(블라인드 라벨): 발췌마다 두 판본을 리듬 읽기·성부/손·철자/임시표·전체 4축에서 left/same/right.
3. 절대 평가: B와 C를 섞은 목록에서 "피아노 교사가 이 악보를 학생에게 줄 수 있나"(yes/fix/no)와 1–5점, A는 별도 목록.
4. 역할만 적고(이름 없이) `tests/bench/human/g3/review-<date>-<role>.json`으로 저장, `python tests/bench/run.py human-set --score <파일>` — 기준 §21.5 (전체 축 B ≥ A 18/20, 리듬 축 B < A 0, 절대 평가 B > A). 빈 템플릿은 `A36: FAIL`(미완)로 나온다 — 확인함.

리뷰어는 판정을 쓰지 않았다.

### 28.11 회귀 (이 세션, `bc1f7b4`)

| 명령 | 결과 |
| --- | --- |
| `npm run test:scoregraph` | 199/199 |
| `PPP_G3_SUITES=robust … g3-preserve.test.js` | **FAIL** (M2) |
| `npm run test:scoregraph:perf` | PASS ×3 (단독) |
| `npm run test:bench` | unit 265 OK, golden 17/17, correctness 13/13 |
| `run.py sg-roundtrip` | 367 + 허용 2 (base와 같음) |
| `run.py golden --g3` (on SUT) | 0 outside, 14 허용 변경 |
| `run.py mutation-check` | **FAIL 47/48** (`G3-SPELL-STATIC`) |
| `validate-preds.js --g3` | 2,647 → 279, 8,144 → 139, 새 경고 0 |
| smoke·core·robust·replay-public `run` + `check` (HEAD, G3 off, 저장 baseline) | 전부 PASS |
| base vs off (smoke·core·robust·full, 5,855 케이스) | metric·MusicXML **완전히 동일** |
| on vs base | 위 §28.8 A34 |
| `npm test` 26 suite, G3 off / G3 on | 25/26 / 25/26 (둘 다 `transcription` 환경만) |

## 29. Fixer 기록 (G3 Fixer, 2026-09-24)

`D:/PPP-g3`, `g3-score-intelligence`, 리뷰 commit `1c030f2`에서 시작. G3를 다시 설계하지 않았다: 리뷰가 찾은 결함을 고치고, 사용자가 승인한 U-1–U-3을 영구 결정으로 넣었다. G3a flip·G3b·자동 8va·G4는 건드리지 않았다 (`PROFESSIONAL_DEFAULT = 'off'`, `g3b`·`ottava`·`pedalJoin` 기본 false).

### 29.1 판정

**READY_FOR_HUMAN_REVIEW** — 남은 BLOCKER 0, MAJOR 0. 블라인드 세트는 최종 코드에서 다시 만들었다 (§29.8). A36(사람 평가)은 PENDING이고, **G3a flip은 A36 뒤**다.

### 29.2 사용자 결정 (영구, DECISIONS G3-U5–U7)

- **U-1 → G3-U5**: mergeable tie는 한 기호로 합치는 것이 H6·H7 아래 합법이고 G3a 가독성 정책이 허용할 때만 결함. 이유 등급 `MERGEABLE_DEFECT`, `REQUIRED_H6`, `REQUIRED_H7`, `REQUIRED_BEAT_SPLIT`, `PARTIAL_CHORD_REQUIRED`, `R17_DEFER_G3B`, 그 밖의 명시적 이유(`CROSS_VOICE`). 파일 allowlist·전역 threshold 완화·이름으로 숨기기 없음. R17은 케이스별 baseline, 늘면 FAIL.
- **U-2 → G3-U6**: 부분 화음 tie는 결함에서 빼되 `PARTIAL_CHORD_REQUIRED`로 따로 세어 보고. G3a는 울리는 것을 바꾸지 않는다.
- **U-3 → G3-U7**: P8 페달 합치기 기본 OFF (professionalize 기본값, shadow 포함), `opts.pedalJoin` 실험 옵션만. 앱 재생 수정은 G3 밖. G3-I7(golden 허용 범주)을 대체.

### 29.3 Finding별 처리

| Finding | 처리 | 증거 |
| --- | --- | --- |
| **B1** 페달 | P8 join 기본 OFF (`pro-marks.js`는 `opts.pedalJoin` 없으면 아무것도 안 함; `pro.js` 최종 검사에서 `pedal` 구성요소 FIXED). golden `--g3` 허용 범주에서 페달 제거 (`golden.py`, `BLESS_LOG.md`) | `g3-marks.test.js` B1: 녹음 그래프 852 (core·robust·golden) 중 페달 있는 31개에서 앱 재생 모델(`Playback.pedal`·`pedalEvents`·`strikes` 재현)의 damper 구간, CC64 1,677개, 친 음 10,780개의 끝이 G3 off와 **동일** — G3 때문에 더 울리는 음 0. 실험 옵션은 별도 테스트 |
| **M1** 손 DP | §29.4 | M04·M15×2 = base, Czerny 849/027 human Eb4 43 → 3 |
| **M2** 동결 전파 | R-repr: 쓰지 못한 segment가 걸친 셋잇단 region의 모든 segment를 그대로 둔다 (반복 전파). critic: G3 경고는 입력에 같은 (code, IDs)가 있고 그것이 가리키는 것의 **시간과 인쇄 모양**(kind, 마디, 성부, at, dur, display, grace)이 같을 때만 입력의 것 | core·robust·full rollback **0** (리뷰: robust 1, full 9); strict `g3-preserve`가 core·robust·golden에서 통과 |
| **M3** 죽은 mutation | `G3-SPELL-STATIC` → `G3-ACC-BAR-STATE` (임시표 계획이 마디 상태를 잊음). 구간 조 추론 조사 (§29.6). 재측정에서 죽은 것으로 드러난 `G3-HANDS-NO-MELODY` → `G3-HANDS-NO-KEEP` | §29.9 |
| **M4** 블라인드 아님 | 불투명 라벨·무작위 판본·정규화·분리된 열쇠 (§29.8) | 재생성 바이트 동일, 평가자 파일에 출처 문자열 0 |
| **M5** 1-음 tuplet 숨김 | loose piece의 옛 tuplet을 **그대로** 둔다 (`printed` 건드리지 않음; T08 = 설계대로 "변화 없음 + `N-TUPLET-UNGROUPABLE`"). writer 자신이 숨긴 조각(`buildGraph`가 쪼갠 셋잇단의 가운데 조각)은 G3가 바꾸지 않고, nq가 **괄호 없는 time-modification 음**을 1-음 tuplet으로 센다 | 녹음 그래프에서 G3가 만들거나 바꾼 1-음 tuplet 0; 남긴 206개 전부 writer 것 + `N-TUPLET-UNGROUPABLE` (그중 writer가 숨긴 3); core 1-음 150 = R17 150 |
| **M6** gate | §29.5 | 증명 4개 |
| m1 cross-voice tie | P2가 tie 사슬을 한 단위로 한 성부에 옮긴다; tie 있는 음에는 머리를 합치지 않는다; critic 구성요소 `xties`(성부·staff가 다른 두 음의 tie) FIXED | core·robust·full `CROSS_VOICE` 0, `PARTIAL_CHORD_REQUIRED` 0 (리뷰: full 49 + P2가 만든 16) |
| m2 idempotence | clef 규칙이 같은 마디 안에서 tie로 들어온 조각을 다시 세지 않는다; 재현 fixture `idem/I01-clef-tie-pieces.sg.json` | P(P(g)) core 553·robust 282·full 4,976 전부 바이트 동일 |
| m3 미분음 | `musicxml.microtone` ext가 있는 head의 임시표·철자는 어느 모드(force 포함)에서도 안 건드린다 | `g3-spell.test.js` m3 |
| m4 (M20) | micro no-drop에서 기호 수가 분모인 `note_shape.consistency`는 **불일치 수**(`notation.note_shape.mismatches`)로 판정 (`MICRO_BY_COUNT`); baseline 행이 그 수를 보관 | M20: 8 → 8 → 통과; 불일치가 늘면 FAIL (`test_compare.py`) |
| m5 테스트 범위 | `g3-corpus-data.js` 기본 suite = core, robust, golden | `test:scoregraph` 205/205 |
| o1 | 변경 없음 (G4 렌더러) | |
| o2 | 변경 없음 — 설계의 보수적 선택 (3/4 1–2박 2분쉼표) | |
| o3 | 정규화가 part id를 P1, P2 …로 준다 | 60 파일 모두 id 있음 |
| o4 | 정보로 다시 잼: 세트의 `nq.ned` 평균 G3 off 1.0225 → G3a 1.0383 (가까움 7, 멀어짐 10, 같음 3) | 여전히 §21.5의 감소 기대와 반대 — 사람 평가가 판단 |
| o5 | `ops.Draft`는 자기 자신이 frozen인 event만 돌려준다 | `g3-ops.test.js` |

### 29.4 손 DP (M1)

리뷰의 원인 두 가지(모든 옥타브에 벌점, 교대 음형에 선율 벌점)를 고쳤고, 그 과정에서 드러난 DP 자체의 결함 둘(탐욕, 두 번째 실행)을 고쳤다. 상수 하나를 바꾸지 않았다 — 비용을 항별로 분해하는 도구(작가 경로 대 DP 경로)로 매 변경을 확인하고, core·robust·full을 매번 다시 쟀다.

- **octave**: "겹친 선"에만 — 맨 옥타브(두 음, 12 반음, 다른 음이 울리지 않음)가 3번 이상 연속 (E6, Beyer 032, Hanon은 E2/E3 옥타브까지). 한 손 화음 안의 옥타브, 왼손 옥타브 베이스는 한 손의 것. 겹친 선이 한 onset에서만 나뉘는 것에도 1500 (일관성).
- **move**: 손의 자리 = 마지막 자리와 "머물러 온 자리"(느린 평균, 1/4씩) 중 가까운 쪽 — 잡음 음 하나가 손을 옮기지 않는다 (M04).
- **melody**: 한 음씩 번갈아 치는 음형(다른 손의 두 단음 사이의 단음)에는 적용하지 않는다 (Czerny 849/027). 다른 면제는 그대로 (앞 onset에 두 손이 다 있을 때만) — 경로를 따라 든 손 자리로 넓히면 오른손 음형의 안쪽 음을 베이스로 보아 Czerny Eb4가 3 → 24로 되돌아간다 (재어 보고 버림).
- **작가를 둔다 (keepWhereNotBetter)**: 손 자리를 경로를 따라 들고 가는 DP는 탐욕적이라 자기 비용으로도 작가보다 비싼 구간을 다시 배정했다 (Czerny: 작가 17,905 대 DP 20,430). 두 경로가 만나는 onset 사이 구간마다 둘 다 정확히 계산하고, 작가가 비싸지 않으면 작가 것.
- **고정점**: 모델이 작가의 staff를 읽으므로(keep, 교대 증거, 작가 경로) 두 번째 실행이 다른 최적을 찾을 수 있었다 (Burgmüller 013·021, core 3 케이스). 선택을 작가 것으로 다시 읽어 같아질 때까지(최대 4회) 반복한 뒤에만 옮긴다.
- **이동 단위**: tie로 이어진 조각들은 한 단위로 한 성부에 (m1).
- fixture: H12–H17 (합성: 왼손 옥타브 베이스, 오른손 옥타브 화음, 선율 아래 왼손 옥타브, 교대 음형 등), H04 기대값 수정 (옥타브 화음이 찢기지 않음), H18–H21 (리뷰의 corpus 조각: M04, M15 ×2, Czerny 849/027 m11–m15), V06 (겹친 선으로 바꿔 원래 목적 유지).

| 측정 (G3 on vs base `cc509e2`) | 리뷰 시점 | Fixer |
| --- | --- | --- |
| core hand accuracy | 0.8876 → 0.9221 | 0.8876 → **0.9168** |
| core hands gate | +50 / −0 | **+42 / −0** |
| robust | 0.8878 → 0.9226, +26 / −0 | 0.8878 → 0.9172, +22 / −0 (떨어지는 케이스 17 → 4) |
| full | 0.8564 → 0.9060, +726 / −0 | 0.8564 → 0.8971, +551 / **−2** |
| full 떨어지는 케이스 (0.02 넘게) | 403 (58) | 284 (31) |
| micro M04 amt s1 | 0.94 → 0.90 | 0.94 (= base) |
| micro M15 amt s1 / s2 | 0.894 → 0.879 / 0.893 → 0.879 | = base |
| Czerny 849/027 human·oracle s11 / s12 | 0.9005 → 0.833 / 0.9023 → 0.835 | 0.8952 / 0.8970 (Eb4 43 → 3, 남은 셋은 도약 지점) |

full의 −2는 둘 다 **hold-out** 케이스로, 잡음 AMT 입력(`amt|none`)이고 G3 off에서 이미 0.80 경계 바로 위에 있다 (케이스 이름과 값은 G0 hold-out 규칙에 따라 적지 않는다). 둘 다 오른손이 일찍 뗀 잡음 입력에서 선율 항이 손을 옮기는 것이다. 이 둘을 고치는 변형(경로를 따라 든 손 자리로 면제를 넓힘; 작가가 그 손에 둔 음 뒤에만 머문 자리)은 Czerny의 교대 음형을 다시 무너뜨리거나 다른 hold-out 케이스 13개를 경계 밖으로 밀어 채택하지 않았다. G0 full gate의 flip 허용(2) 안이고, G3 gate(A34, core)의 hands 줄은 −0. **기록된 한계 (MINOR)**. full의 hand 평균 0.8971은 G3 gate의 0.90 선(core에 정의)보다 낮다 — 리뷰 시점의 0.906은 병적 배정을 포함한 값이었다.

**hold-out 오염 (알림)**: Czerny 849/027은 hold-out 참조다. 리뷰(§28)가 그 케이스별 값을 기록했고 brief가 회귀 fixture로 지정해 H21(5마디 조각)로 넣었으며, 교대 음형 규칙과 변형 선택(위의 −2, 13)에 hold-out 케이스 결과가 쓰였다. 따라서 full의 hold-out 집계는 **손 모델에 대해서는 더 이상 독립 검증이 아니다** (다른 pass에는 영향 없음). 케이스별 R17 baseline은 hold-out을 한 묶음으로만 둔다 (§29.5).

### 29.5 Reason-aware gate (M6)

- 분류는 **출력 MusicXML**(reader/5 층)에서 한다 — G3 내부 판단을 믿지 않는다 (`tests/bench/pppbench/notation_reasons.py`, 규칙은 §28.4의 독립 분류기). 성부-마디를 경계점(음 시작, 마디 안 tie로 합친 끝, 쉼표 구간 끝)으로 자르고, U = 192/온음표에서 창(단순 박자: 4분, 그 외: 8분)이 이진(3의 배수)·셋잇단(4의 배수) 어느 한 격자로도 설명되지 않으면 섞인 창. 한 격자를 골랐을 때 어긋난 점이 전부 release이고 1 tick 이내면 **R17** (넘으면 R17_WIDE, 역시 release만이라 R-reg 몫); onset이 어긋나면 `MIXED_ONSETS`(예상 밖). 자기 창이 깨끗해도 같은 창을 공유하는 segment가 R17이면 R17 (R-repr의 동결 전파).
- metric (예측 값, 개수): `nq.shape.tm_missing.r17/.unexpected`, `nq.tuplet.one_note.r17/.unexpected` (괄호가 인쇄되지 않은 time-mod 음 포함), `nq.tie.mergeable.defect/.required_h6/.required_h7/.required_beat_split/.partial_chord/.cross_voice/.r17`. 기존 `nq.*` 정의는 바꾸지 않았다 — `tm_missing`·mergeable 수는 분류 합과 정확히 같다 (core 291, 93).
- `check --g3` 줄: 예상 밖 `tm_missing` 0, 예상 밖 1-음 0, `MERGEABLE_DEFECT` 0 (나머지 이유는 수와 함께 보고), R17 세 종류(tm·1-음·tie) 모두 케이스별 baseline 이하, 이유 분리가 없는 결과는 FAIL. baseline: `tests/bench/baselines/g3-r17.{core,robust,full}.json`, `run.py g3-r17 --suite S --reason "…"`로 기록 — 예상 밖 residual이나 결함이 있는 실행(G3 off 실행 포함)은 기록을 거부한다. hold-out 케이스는 한 묶음(종류별 합, 늘면 FAIL)으로만 두고 gate 출력에서도 "(hold-out case)"로만 부른다 — 케이스별 hold-out 값은 커밋·출력하지 않는다 (G00 §17 m10). core 26 케이스, robust 11, full 191 + hold-out 묶음.
- **증명**. 단위 (`test_notation_reasons.py`, 손으로 쓴 MusicXML): (1) 박 안 16~16 → `MERGEABLE_DEFECT` → gate FAIL, (2) 깨끗한 셋잇단 박의 time-mod 없는 쉼표 → 예상 밖 → FAIL, (3) R17이 baseline보다 많으면 FAIL, (4) H6(괄호 밖으로 나가는 tie)·H7(박에서 시작도 박을 채우지도 않는 겹점)·박 분할(못갖춘마디 offset)·부분 화음은 결함 아님 → PASS. 실제 SUT mutation: `G3-TIES-IN-BEAT` → `nq.tie.mergeable.defect` 0 → 3.51, `G3-TRIPLET-REST-NO-TM` → `nq.shape.tm_missing.unexpected` 0 → 1.44, 새 `G3-R17-GROW` (셋잇단 앞 1-tick release 틈을 닫지 않음: G3a가 쓸 수 있는 것은 늘지 않고 R17만 는다) → `nq.shape.tm_missing.r17` 0.053 → 0.252. H6 30·H7 58이 있는 실제 core 출력이 PASS하는 것이 (4)의 실데이터 증거.

| suite | `tm_missing` | 1-음 tuplet | mergeable tie |
| --- | --- | --- | --- |
| core | 291 = R17 291 | 150 = R17 150 | 93 = H7 58, H6 30, R17 5; 결함·부분 화음·성부 사이 0 |
| robust | 134 = R17 134 | 56 = R17 56 | 39 = H6 21, H7 5, R17 13; 결함 0 |
| full | 3,006 = R17 3,006 | 1,384 = R17 1,384 | 857 = H7 499, H6 275, R17 83; 결함·부분 화음·성부 사이 0 |

### 29.6 구간 조 추론 (§10.2) — 죽은 코드가 아니다, 발동하지 않을 뿐

`regionKeys`를 계측해 이유를 셌다. core 553: 12마디 미만 112, 분석 441 중 Viterbi가 조 변경을 제안한 것 **2** (둘 다 한 5도 → G3-I3가 임시표로 둠). full 4,976: 짧음 811, 분석 4,165 중 제안 14, 전부 한 5도. 변경 비용(1.5 + 5도당 0.5)을 넘을 만큼 창 점수가 갈리는 전조가 녹음 corpus에 없다. S06 fixture(C → E♭)가 실제로 조표를 쓰는 것을 증명한다. 억지로 조 변경을 만들지 않았다. A24("퇴행 0")가 사실상 무변화로 통과한다는 리뷰 판정은 그대로 맞다 (G3-F4).

### 29.7 측정 (최종 코드; G3 on SUT = 작업 트리에서 기본값만 `'on'`)

G0 판정 (base `cc509e2` 실행을 pseudo-baseline으로, `ab`와 같은 방식):

| suite | G0 | G3 gate (`check --g3`) | usable Δ |
| --- | --- | --- | --- |
| smoke | PASS | — | |
| core | PASS (경고 2: `courtesy_per_100` 0 → 0.26, `tuplets.false_per_100` 3.38 → 3.67) | **PASS 9/9** | +0.72 pt |
| robust | PASS | **PASS 9/9** | +0.71 pt |
| replay-public | PASS (`note_shape` 0.9945 → 1.0) | — | |
| full | PASS (경고: hands flip 2, 허용 2) | 8/9 — hand 평균 0.8971 < 0.90 (§29.4) | +1.89 pt |

- 저장된 core·robust·smoke·replay-public baseline(G3 off)에 대한 `check`도 PASS. full의 저장 baseline(`full.aggregates.json`)은 G1·G2 이전 것이라 G3와 무관한 subgroup 차이로 REGRESSION이 난다 — 리뷰처럼 base 실행으로 판정했다.
- A14 계열 (duration·onset_pos·ioi·notes.*·note_values·beat_placement·pitch·meter·structure·tempo): 케이스별 **동일**; `page_accuracy`만 core 3·full 31 케이스에서 오른다 (표시가 실제 길이와 일치하게 됨).
- 철자·key: 케이스별 퇴행 0 (core·robust·full).
- `validate-preds --g3` (core): `W-DISPLAY-DURATION` 2,647 → 291, `W-TUPLET-INCOMPLETE` 8,144 → 150 — 정확히 R17 residual 수; G3가 더한 경고 0.
- P(P(g)): core·robust·full 전부 바이트 동일, rollback 0.

### 29.8 사람 평가 세트 (M4, A36)

- 평가자용: `tests/bench/human/g3/E01-X.musicxml … E20-Z.musicxml` (60), `manifest.json` (파일·sha256·정규화 목록·라이선스 문장), `review-form.json` (빈 판정 양식). 발췌 번호는 섞인 순서, 판본은 발췌마다 X·Y·Z로 섞임 (seed 20260924). 정규화: 제목·작곡가·표지·소프트웨어·레이아웃·악기, 방향 지시(셈여림·템포·페달·8va·글), slur·아티큘레이션·운지·꾸밈·가사 제거; part id P1…; 마디 1–8; 제목은 라벨. G3a가 쓰는 것(음·쉼표·tie·tuplet·beam·stem·성부·staff·clef·조표·박자·임시표·세로줄)만 남는다.
- 열쇠: `tests/bench/human/g3-key/key.json` — 글자별 판본, 케이스, 참조 파일, 출처·라이선스 (전부 public domain 또는 CC0), 마디 범위, sha256, `nq.ned`. 평가를 제출하기 전에는 열지 않는다.
- 재생성 `python tests/bench/run.py human-set --build` — 두 번 만들어 63 파일 바이트 동일, 평가자 파일에 출처를 드러내는 문자열 0 (확인).
- 한계: C(참조)는 사람 판각이라 표기 자체로 알아볼 수 있다 (정규화는 머리·마크만 지운다). 블라인드 아닌 옛 세트(HG01–HG20)는 이 브랜치의 역사(`8dcc719` 이전)에 남아 있고 내용으로 새 파일과 짝지을 수 있다 — 열쇠와 마찬가지로 평가 전에는 `tests/bench/human`의 git 역사·diff를 보지 않는다 (옛 세트를 지우는 commit과 새 세트를 더하는 commit을 나눠 git이 이름 바꿈으로 짝짓지 않게 했다).

**사용자가 할 일 (A36)**

1. MuseScore 4에서 `tests/bench/human/g3/`의 60 파일을 같은 설정으로 연다 (앱 렌더러는 쓰지 않는다: beam·괄호를 스스로 다시 정한다).
2. `review-form.json`을 복사해 채운다: `excerpts` — 발췌마다 세 판본 X·Y·Z를 리듬 읽기·성부/손·철자/임시표·전체 4축에서 순위 (1이 가장 좋음, 같으면 같은 순위); `absolute` — 60 파일 각각 `give` (yes/fix/no: 피아노 교사가 학생에게 줄 수 있나, 그대로 / 조금 고치면)와 `score` 1–5; `reviewer_role` (이름 없이), `date`, `renderer` (MuseScore 버전).
3. `tests/bench/human/g3/review-<date>-<role>.json`으로 저장하고 `python tests/bench/run.py human-set --score tests/bench/human/g3/review-<date>-<role>.json`. 기준 §21.5: 전체 축에서 G3a ≥ G3 off가 20개 중 18 이상, 리듬 축에서 G3a가 나쁜 것 0, 절대 평가에서 G3a의 yes+fix가 G3 off보다 많음. 빈 양식은 `A36: FAIL`(미완)로 나온다.

Fixer는 판정을 쓰지 않았다.

### 29.9 A1–A40 재판정 (Fixer)

| # | 리뷰 | Fixer | 근거 |
| --- | --- | --- | --- |
| A1 | PASS | PASS | `test:scoregraph` 205/205 (core·robust·golden 기본) |
| A2 | PASS | PASS | sg-roundtrip 369: L1 368, L1+ 367, L2 369, 순서 369 (허용 2, base와 같음) |
| A3 | PASS | PASS | performance 바이트: strict `g3-preserve` (core·robust·golden 852 그래프) |
| A4 | PASS | PASS | |
| A5 | PASS (명세 집합) | **PASS** | P(P(g)) core 553·robust 282·full 4,976 바이트 동일 (리뷰의 full 1건 = I01 fixture) |
| A6 | FAIL | **PASS** | strict core·robust·golden (CI 기본), rollback core·robust·full 0 |
| A7 | PASS | PASS | 심은 위반 + A7b; critic 경고 판정은 내용(시간·모양) 기반 |
| A8 | PASS | PASS | |
| A9 | PARTIAL | PARTIAL | `W-DISPLAY-DURATION` 2,647 → 291, `W-TUPLET-INCOMPLETE` 8,144 → 150 = R17 residual 수, 새 경고 0 |
| A10 | PARTIAL | PARTIAL (G3 의미 PASS) | 앱 렌더러가 32분 셋잇단 그룹을 나눔 → G4 (o1) |
| A11 | PASS (T08 다름) | **PASS** | T08 = 설계대로 |
| A12 | PARTIAL | **PASS (G3-U5)** | `tm_missing` 291 전부 R17 (writer가 쓴 그대로), 케이스별 baseline |
| A13 | PASS | PASS | |
| A14 | PASS | PASS | 케이스별 동일; `page_accuracy`만 오른다 (core 3, full 31) |
| A15 | PARTIAL/FAIL | **PASS (G3-U5/U6)** | `MERGEABLE_DEFECT` 0 (core·robust·full); H7·H6·R17 따로 보고, 부분 화음·성부 사이 0 |
| A16 | PASS | PASS | |
| A17 | PARTIAL | PARTIAL | G3-I1 (기록된 이탈), 변화 없음 |
| A18 | PASS | PASS | |
| A19 | DEFERRED (M11) | DEFERRED (M11) | G3b는 실제 녹음 3곡 뒤 |
| A20 | PASS (M1) | **PASS** | 0.9168, +42/−0; 병적 배정 수정 (§29.4) |
| A21 | PASS | PASS | |
| A22 | PASS | PASS | H01–H21 |
| A23 | PASS | PASS | V01–V06 (V06 겹친 선) |
| A24 | PASS (공허) | PASS (공허) | 퇴행 0; 구간 조는 녹음 corpus에서 발동하지 않음 (§29.6) |
| A25–A27 | PASS | PASS | m3 미분음 포함 |
| A28–A31 | PASS | PASS | |
| A32 | PASS (문구; B1) | **PASS** | `critical.pedal` 퇴행 0 **그리고** 앱 재생 동일 (B1 테스트) |
| A33 | PASS | PASS | bench unit 283, golden 17/17, correctness 13/13 |
| A34 | FAIL | **PASS** | G0: smoke·core·robust·replay-public·full PASS (base pseudo-baseline); `check --suite core --g3` PASS 9/9 (robust도 9/9) |
| A35 | PASS (dry; B1 허용) | **PASS** | `golden --g3`: 17 중 0 범주 밖, 페달은 범주 밖 |
| A36 | PENDING (블라인드 아님) | **PENDING** | 블라인드 세트 완성·최종 코드로 재생성 (§29.8) |
| A37 | FAIL 47/48 | **PASS 49/49** | mutation-check (§29.10): 47 harmful 모두 REGRESSION, no-op 2개 바이트 동일 |
| A38 | PASS | PASS | `npm test` 26 suite: G3 off 25/26, G3 on 25/26, 같은 집합 — `transcription`만 (venv transkun 경로 검사, 리뷰와 같은 환경 실패; G3가 안 건드림) |
| A39 | PASS | PASS (여유 작음) | 2,000마디 40k head 1,897 ms < 2 s (리뷰 1.68 s) |
| A40 | PASS | PASS | `g3-midi.test.js` |

### 29.10 회귀 (최종 코드)

| 명령 | 결과 |
| --- | --- |
| `npm run test:scoregraph` | 205/205 (기본 suite core·robust·golden) |
| `npm run test:scoregraph:perf` | PASS — `professionalize` 1,897 ms (staff 522, voice 27, rhythm 367, tuplet 201, spell 228, beam 213) < 2 s. 리뷰의 1.68 s보다 느리다: 손 DP의 고정점·keepWhereNotBetter 몫이고 여유가 작다 |
| `npm run test:bench` | unit 283 OK, golden 17/17, correctness 13/13 |
| notation audit (`tools/notation_audit.py`, core) | 실행됨 (표 생성) |
| `validate-preds.js --suite core --g3` | 2,647 → 291, 8,144 → 150, G3가 더한 경고 0 |
| strict (`g3-preserve`, core·robust·golden) | PASS |
| idempotence (core·robust·full sweep + fixture I01) | 0 실패, rollback 0 |
| hands·rhythm·tuplets·beams·spelling·voice·marks 테스트 | `test:scoregraph`에 포함, 전부 PASS |
| `run.py human-set --build` (두 번) | 63 파일 바이트 동일 |
| `run.py sg-roundtrip` | 367 + 허용 2 |
| `run.py golden` / `golden --g3` | 17/17 / 0 범주 밖 |
| `run.py correctness` | 13/13 |
| smoke·core·robust·replay-public·full `run` (G3 on) + 판정 | §29.7 |
| `run.py mutation-check` | **PASS 49/49** — harmful 47 전부 REGRESSION(기대한 metric 포함), no-op 2 바이트 동일. G3 묶음: F1 괄호, 셋잇단 쉼표 time-mod(`tm_missing.unexpected`), 박 안 tie(`mergeable.defect`), beam, `G3-ACC-BAR-STATE`(`critical.accidentals`), `G3-R17-GROW`(`tm_missing.r17`), `G3-HANDS-NO-KEEP`(`hand.accuracy`, micro, flip). 첫 재측정에서 `G3-HANDS-NO-MELODY`가 죽어 있었다 (0.9187 → 0.9159, 허용 안) → 교체 후 전체 다시 실행 |
| `npm test` (26 suite) G3 off / G3 on | 25/26 / 25/26 (둘 다 `transcription` 환경만; G3 on은 `git archive HEAD`에서 기본값만 `'on'`, `node_modules`는 임시 junction 후 제거) |

### 29.11 Commit (origin/g3-score-intelligence, PR 없음, main merge 없음)

| commit | 무엇 |
| --- | --- |
| `9f86cb1` | B1: 페달 join 기본 OFF, 앱 재생 동일 테스트 |
| `392f6e7` | M1·m1·m2: 손 DP, tie 단위 이동, clef 셈, critic (xties, 내용 기반 경고) |
| `1d23c5d` | M2·M5·m3·o5·A6: 동결 전파, writer의 1-음 tuplet 보존, 미분음, frozen event만 재사용, strict robust |
| `8186a1f` | M6·M3·M20: 이유별 gate, R17 baseline(hold-out 묶음), 살아 있는 mutation, micro 불일치 수 |
| `8dcc719` | M4: 블라인드 아닌 옛 세트 제거 |
| `6eea6d7` | M4: 블라인드 세트 (최종 코드로 생성), 열쇠 분리 |
| (이 절) | docs: G03 §29, spec 주석(§13.2·§20.4·§20.5·§21), DECISIONS G3-U5–U7·G3-F1–F5, CURRENT_STATE |

---

## 부록 A. 이 세션의 측정 기록

### A-1. 실행한 것 (cwd `D:/PPP-g3`, `cc509e2`)

```
npm run test:scoregraph                                  → 132/132
python tests/bench/run.py run --suite core               → 553 cases, 0 errors, 28 s (출력: tests/bench/out/, gitignored)
python tests/bench/run.py run --suite replay-public      → 6 cases
python tests/bench/run.py known-defects
python <scratch>/notation_audit.py                       → 553 pred vs 141 ref, 파일 단위 통계 (note 매칭 없음)
python <scratch>/dump_bar.py <case> <bar-idx>            → §19 예의 마디 덤프
node <scratch>/sg_validate_preds.js                      → 553 예측의 ScoreGraph validate
node <scratch>/sg_import.js                              → 카탈로그·fixture import + validate
```

스크립트는 이 세션의 scratchpad에 있고, Step 0에서 `tests/bench/tools/notation_audit.py`로 커밋한다. 저장소에는 아무것도 쓰지 않았다 (`git status` clean; bench 출력은 gitignored `tests/bench/out/`).

### A-2. 전체 표 (파일 단위, core 프로파일별)

| metric | REF (141) | ALL (553) | human\|oracle | deadpan\|none | human\|none | amt\|oracle-noisy | rubato\|oracle | pedal\|oracle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 파일 | 141 | 553 | 141 | 141 | 141 | 60 | 40 | 30 |
| event(화음 1) / 마디 | 10.99 | 12.94 | 12.61 | 12.55 | 13.30 | 12.15 | 13.32 | 14.78 |
| 쉼표 / 마디 | 0.567 | 3.401 | 3.161 | 2.620 | 3.411 | 4.256 | 4.290 | 4.052 |
| 32분 이하 비율 | 0.028 | 0.192 | 0.185 | 0.191 | 0.188 | 0.195 | 0.184 | 0.250 |
| tie / 음 | 0.003 | 0.030 | 0.017 | 0.029 | 0.034 | 0.051 | 0.041 | 0.026 |
| 한 박 안 tie / tie | 0.000 | 0.398 | 0.449 | 0.434 | 0.380 | 0.415 | 0.308 | 0.395 |
| 3조각 이상 사슬 / tie | 0.023 | 0.095 | 0.014 | 0.041 | 0.076 | 0.214 | 0.197 | 0.028 |
| 짝 없는 tie 시작 | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| time-mod event / event | 0.074 | 0.051 | 0.041 | 0.036 | 0.063 | 0.030 | 0.075 | 0.084 |
| 괄호 시작 / time-mod event | 0.322 | 0.789 | 0.800 | 0.871 | 0.741 | 0.718 | 0.824 | 0.762 |
| 1-음 괄호 / 괄호 | 0.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| time-mod 없는 비2진 길이 event | 0 | 2,647 | 367 | 210 | 785 | 313 | 770 | 202 |
| 그중 쉼표 | 0 | 2,550 | 367 | 205 | 734 | 280 | 764 | 200 |
| staff-마디당 성부 | 1.257 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| 2성부 이상 staff-마디 | 0.257 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 박 밖에서 시작해 다음 박을 넘는 음 / event | 0.003 | 0.008 | 0.003 | 0.003 | 0.006 | 0.017 | 0.024 | 0.004 |
| 겹임시표 / 1000음 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 조와 무관한 E♯/B♯/C♭/F♭ / 1000음 | 0.309 | 0.169 | 0.181 | 0.179 | 0.229 | 0 | 0.174 | 0.091 |
| ♯·♭ 반음계 섞인 staff-마디 | 0.002 | 0.005 | 0.005 | 0.006 | 0.006 | 0.003 | 0.005 | 0.009 |
| 인쇄 임시표 / 음 | 0.027 | 0.035 | 0.034 | 0.035 | 0.034 | 0.026 | 0.042 | 0.040 |
| 덧줄 ≥ 4 / 1000 | 8.28 | 12.63 | 11.64 | 11.16 | 11.59 | 11.64 | 11.30 | 28.54 |
| 덧줄 ≥ 5 / 1000 | 3.73 | 4.30 | 3.85 | 3.78 | 3.86 | 5.07 | 3.88 | 8.97 |
| RH staff F3 미만 / 1000 | 3.14 | 1.24 | 1.58 | 1.61 | 1.55 | 0.14 | 0.58 | 0.18 |
| LH staff G4 초과 / 1000 | 17.08 | 8.67 | 7.63 | 7.28 | 7.88 | 11.43 | 6.84 | 19.39 |
| 옥타브 기호 / 파일 | 0.128 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 페달 시작 / 파일 | 0.113 | 1.495 | 0 | 0 | 0 | 0 | 0 | 27.567 |
| dynamics / 파일 | 2.965 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| wedge / 파일 | 1.589 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| slur / 파일 | 10.702 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| articulation / 파일 | 18.284 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| beam된 음 비율 | 0.468 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| stem 요소 비율 | 0.541 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 모자란 성부-마디 (안쪽) | 0.006 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 넘치는 성부-마디 (안쪽) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**주의**: 파일 단위 통계이고 음 단위 매칭이 아니다. 쉼표·tie 수치는 합성 연주자의 release 모델에 의존한다 (M11). 예는 bar placement ≥ 0.95인 케이스에서 골랐다 (예외: E2·E4의 케이스 전체 0.75, 해당 마디는 정렬됨). "조와 무관한 철자" 규칙은 정당한 이끔음(F♯단조의 E♯)도 센다 — ref의 0.31이 그것을 포함한다.

### A-3. ScoreGraph validate (core 553 예측)

`W-DISPLAY-DURATION` 2,647 (107 파일), `W-TUPLET-INCOMPLETE` 8,144 (114 파일), `W-TEMPO-MARK-MISMATCH` 189. golden `tests/scoregraph/golden/G03.issues.json`: `W-TUPLET-INCOMPLETE` 47, `W-DISPLAY-DURATION` 1.

### A-4. 들여온 악보

- `known-defects`: `note_shape_mismatch` 4 파일 8건, `tie_without_stop` 16 파일 121건 (amazing-grace 8, be-still-my-soul 24, Burgmüller 021 양끝 8).
- ScoreGraph import의 `report.issues`는 이것을 올리지 않는다. `validate()`가 `W-DISPLAY-DURATION` (Für Elise 2, the-lords-my-shepherd 4), `W-TIE-OPEN` (amazing-grace 8).
- Burgmüller 021 import: beam 114, tuplet(3) 114, slur 67, wedge 6, dynamic 8, ottava 1. Czerny 849/001 비슷함. hymn: 4성부, spanner 없음(깨진 tie 제외). OMR fixture: 4분음표 48개, 2성부.

### A-5. 코드 감사 요점 (파일:줄)

- `audio-score.js`: `snapStraight` 504, `snapEnd` 556, `tripletBeats` 573, `quantize` 599, `quantizeCompound` 656, `meterAndPhase` 707, `compoundVsThree` 731, `estimateKey` 770, `spellingTable` 821, `splitCost` 840, `assignHands` 863, `TYPES` 902, `tupletOf` 907, `readableEnd` 924, `pieces` 940, `notePieces` 971, `staffEvents` 982, `buildGraph` 성부 1181, 임시표 1239–1245, tuplet 1265–1281, `finish` 페달 1375–1397, `toMusicXml` 1547, 4음 하한 1556, `fromMidi` 1786.
- `scoregraph/musicxml-export.js`: tuplet 사슬 192–199, time-mod 448–449, `<tuplet>` 517–524, beam 532–557.
- `scoregraph/ops.js`: `updateHead`, `removeEvents`, `replaceRegion`만 구현 (split·merge·revoice·restaff 없음).
- 앱: `Score.finalize` 3541, 손 규칙 4308–4319, 운지 8279, `makeScoreView` 10463, `buildVoice` 11458, 렌더러 beam 11560–11580, tuplet 11583–11611, inferred 마디 안 tie 생략 11066.
- `tests/bench/pppbench/perform.py:17`: deadpan `gap: (0.040, 0.040)`.
