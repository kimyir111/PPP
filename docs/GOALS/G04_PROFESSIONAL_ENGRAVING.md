# G04 — Professional Engraving

ScoreGraph에 **이미 있는** 기보 의미를 PPP의 실제 화면과 인쇄에서 빠짐없이, 일관되게, 읽기 좋게 그리는 Goal이다. 음악 내용은 바꾸지 않는다.

| | |
| --- | --- |
| 상태 | **G4a CLOSED — PR #9로 병합 (`df8a571`, 2026-09-25).** 최종 독립 리뷰 PASS (BLOCKER 0, MAJOR 0, §32.13–§32.14). 구현 §32, Fixer §32.12, 최종 §32.13, 마감 §32.14. 사용자에게 보이는 변화 없음 (legacy 렌더러가 기본, 바이트 동일). 사용자 결정 G4-U1–U5 (§31). **G4b CLOSED — PR #12로 병합 (`62ede61`, 2026-09-25)**:
- G4a MINOR 여섯을 닫았다.
- layout core(NotationPlan → EngravedScore, 연습 map)를 만들었다. 앱은 불러오지 않는다 — 보이는 변화 없음.
- 독립 리뷰 NEEDS_FIX(MAJOR 3) → Fixer §33.16 → Lead 재확인 → 병합 (§33.17).
- geometry-only 범위는 Lead 결정 G4-L1이다 (§27 G4b의 주): `svg.js`는 G4c, 페이지 통합은 G4d-2.
- **G4c CLOSED — PR #15로 병합 (`e3c8c5a`)**: 독립 리뷰 NEEDS_FIX(MAJOR 2) → Fixer §34.18 → Lead 재확인 → 병합 (§34.19). MX-1도 병합됐다 (PR #13).
- **G4d-1a CLOSED — PR #17로 병합 (`b4fe019`)**: 독립 리뷰 NEEDS_FIX(MAJOR 3) → Lead 결정 G4-L4·G4-L5 → Fixer §35.18 → Lead 재확인 → 병합 (§35.19).
- **G4d-1b CLOSED — PR #19로 병합 (`a6e1a75`)**: 독립 리뷰 NEEDS_FIX(MAJOR 3) → Fixer §36.18 → Lead 재확인 → 병합 (§36.21). G4d-1(Node 판각)이 끝났다.
- **다음: G4d-2** (앱 통합, 개발용 스위치 뒤, 기본값 `'legacy'`) → M-H1 (`docs/PPP_MASTER_ROADMAP.md`). 설계: Architect 2026-09-24 |
| 기준 커밋 | `origin/main` = `55d1bd5` (G3 PARTIAL/DEFERRED closeout, PR #8) |
| 브랜치 / worktree | `g4-professional-engraving` / `D:/PPP-g4` |
| 시작 검증 | `npm run test:scoregraph` → **205/205 pass** (이 세션이 `55d1bd5`에서 직접 실행) |
| 선행 | G0, G1, G2 CLOSED. G3 PARTIAL/DEFERRED — G3a·G3b·자동 8va·`pedalJoin` 전부 OFF, A36 FAIL 기록 유지. **G3는 COMPLETE가 아니다** |
| 전환 단계 | `docs/ARCHITECTURE.md` §2의 **S5 중 렌더러 부분**: 렌더러가 ScoreGraph를 읽는다. 재생(`PianoScore`)·연습 판정은 legacy `Score`에 그대로 남는다 (G5 이후) |
| 읽는 사람 | 이 문서만 읽고 G4를 구현할 다음 세션(Implementer), 그리고 리뷰하는 사용자 |
| 이 문서가 정하지 않는 것 | 기보 의미 — 리듬 표기·성부·손/staff·tuplet 묶음·beam 멤버십·철자 (G3), 운지 생성 (G5), 편곡 (G7/G8), 재생 의미 (이슈 3의 8va 재생, pedal `change` 재생), OMR·AMT 품질 |

---

## 목차

- [0. 요약](#0-요약)
- [1. Status](#1-status)
- [2. Goal](#2-goal)
- [3. Non-goals](#3-non-goals)
- [4. 현재 렌더러 감사](#4-현재-렌더러-감사)
- [5. ScoreGraph → 렌더러 pipeline](#5-scoregraph--렌더러-pipeline)
- [6. 기보 의미 지원 표](#6-기보-의미-지원-표)
- [7. 렌더러 아키텍처 결정](#7-렌더러-아키텍처-결정)
- [8. Engraving / layout 모델](#8-engraving--layout-모델)
- [9. 가로 간격 (spacing)](#9-가로-간격-spacing)
- [10. 충돌 체계](#10-충돌-체계)
- [11. Beams](#11-beams)
- [12. Tuplets](#12-tuplets)
- [13. Ties / slurs / curves](#13-ties--slurs--curves)
- [14. 다성부와 피아노 grand staff](#14-다성부와-피아노-grand-staff)
- [15. System / page layout](#15-system--page-layout)
- [16. 화면·연습 통합](#16-화면연습-통합)
- [17. Print / PDF](#17-print--pdf)
- [18. 음악 글꼴과 glyph](#18-음악-글꼴과-glyph)
- [19. 성능 예산](#19-성능-예산)
- [20. 결정론](#20-결정론)
- [21. Benchmark 전략](#21-benchmark-전략)
- [22. G4 reference corpus](#22-g4-reference-corpus)
- [23. Mutation suite](#23-mutation-suite)
- [24. Acceptance criteria](#24-acceptance-criteria)
- [25. Rollout / rollback](#25-rollout--rollback)
- [26. G3와의 관계, 들여온 악보와 옛 악보](#26-g3와의-관계-들여온-악보와-옛-악보)
- [27. 구현 단계](#27-구현-단계)
- [28. 위험](#28-위험)
- [29. 사용자 결정](#29-사용자-결정)
- [30. Definition of done](#30-definition-of-done)
- [31. 사용자 결정 기록](#31-사용자-결정-기록)
- [32. G4a 구현 기록](#32-g4a-구현-기록)
- [33. G4b 구현 기록 — 배치 핵심 (layout core)](#33-g4b-구현-기록--배치-핵심-layout-core)
- [34. G4c 구현 기록 — beam, stem, tuplet, 성부, 쉼표, 꾸밈음, SVG 백엔드](#34-g4c-구현-기록--beam-stem-tuplet-성부-쉼표-꾸밈음-svg-백엔드)
- [35. G4d-1a 구현 기록 — 곡선, 음에 붙는 기호, 배치 함수, 글자 metric](#35-g4d-1a-구현-기록--곡선-음에-붙는-기호-배치-함수-글자-metric)
- [36. G4d-1b 구현 기록 — system에 붙는 기호, 세로 배치, courtesy, 괄호 임시표](#36-g4d-1b-구현-기록--system에-붙는-기호-세로-배치-courtesy-괄호-임시표)
- [37. G4d-2 구현 기록 — 판각기를 페이지에 (개발용 스위치), M-H1 도구](#37-g4d-2-구현-기록--판각기를-페이지에-개발용-스위치-m-h1-도구)
- [38. M-H1 — 사용자 평가 결과](#38-m-h1--사용자-평가-결과)
- [39. G4e 구현 기록 — 페이지와 인쇄](#39-g4e-구현-기록--페이지와-인쇄)
- [40. G4f-1 구현 기록 — benchmark 완성 (mutation, legacy 비교, 성능, CI)](#40-g4f-1-구현-기록--benchmark-완성-mutation-legacy-비교-성능-ci)
- [41. G4f-2 구현 기록 — M-H2 (Lead, 2026-09-26)](#41-g4f-2-구현-기록--m-h2-lead-2026-09-26)
- [42. M-H2 — 사용자 평가 결과 (2026-09-26)](#42-m-h2--사용자-평가-결과-2026-09-26)
- [43. G4f-2 flip 구현 기록 — 기본 렌더러를 판각기로](#43-g4f-2-flip-구현-기록--기본-렌더러를-판각기로)
- [부록 A. 이 세션의 측정](#부록-a-이-세션의-측정)
- [부록 B. 코드 위치 색인](#부록-b-코드-위치-색인)

---

## 0. 요약

**발견 (코드와 측정으로 확인)**

1. **렌더러는 ScoreGraph를 읽지 않는다.** 모든 화면(연습·전곡·리뷰·미리보기·썸네일·퀴즈, 9곳)이 한 `ScoreView`(App 10473)를 쓰고, 그 입력은 legacy `Score`다. 그래프는 import 때 메모리에만 있다가 버려진다 (G2-D14). 녹음·OMR·편곡 경로는 아예 `parseMusicXML`로 Score를 만든다.
2. **그래프의 기보 의미 상당수가 adapter에서 죽는다.** `legacy-score.js` `toScore`에는 beam 분기가 없다 (177–192). 커밋된 악보 357개(96,825 event)의 **beam 11,808개(47,805 event)가 전부 버려지고**, 렌더러는 박마다 스스로 beam을 만든다 (App 11570–11589). grace(244), articulation(6,935 중 accent·marcato만 재생용), dynamic(895)·wedge(381)는 재생에만 쓰이고, fingering(head 14,305), fermata, 꾸밈음, 가사, words, glissando, notehead, 쉼표 위치는 그리지 않는다.
3. **렌더러가 그래프 의도를 덮어쓴다.** tuplet의 `show.number:'none'`(1,605개)·`bracket:false`(1,768개)를 무시하고 괄호 없는 time-modification(`printed:false`)에도 "3"을 그리며, 한 음짜리 tuplet은 아예 표시하지 않는다 (`tr.length > 1`, 11598). 녹음 경로(G3 off)의 셋잇단은 전부 한 음 괄호라서 **숫자 없이 그려진다**. 추론 악보의 마디 안 tie를 숨긴다 (11079) — 그런데 재생(2631)과 연습 판정(6754)은 그 tie를 한 음으로 친다. system을 넘는 tie·slur는 버린다 (11073, 11101). slur는 start→다음 stop으로 다시 짝짓는다. pedal `change`를 떼는 기호(`∗`)로만 그린다.
4. **배치는 절반만 있다.** 가로 간격은 이미 비례+최소폭(`u·d^0.65`, 10763)이고 줄 채우기도 한다. 그러나 세로 충돌 체계, 곡선 회피, 페이지, 인쇄가 없다. 인쇄·PDF는 아예 없다. 레이아웃이 DOM 측정(`getBBox` 11326, `getComputedTextLength` 11221)에 기대고 VexFlow를 CDN에서 받는다.
5. **성능 구조는 옳다** (`draw()`/`sync()` 분리). 그러나 전곡 보기의 `sync()`가 매 프레임 모든 음을 훑는다: 긴 소나티네 세 곡(1,326–1,776음)에서 한 프레임 중앙 13–14 ms, 최대 29 ms. sonatina/020(158마디) 전곡 판각 249 ms, SVG 2.1 MB (부록 A-2).

**결정 (권고, §7–§8)**

- **VexFlow 4.2.3을 유지**하고(고정·vendoring), 그 위에 PPP 판각 층을 만든다. VexFlow는 glyph·음표 단위 formatter·drawer로만 쓴다. 필요한 클래스는 4.2.3에 다 있고, 기하가 **DOM 없이 Node에서 결정론적으로** 계산된다 (이 세션에서 확인, 부록 A-3). Verovio(LGPL, 7.3 MB WASM)는 비교했지만 택하지 않는다. 다만 엔진 독립 경계를 두어 나중에 바꿀 수 있게 한다.
- **렌더러 입력은 ScoreGraph다.** 명시적 중간 표현 둘을 둔다: 좌표 없는 **NotationPlan**(무엇을 그릴지 + fidelity ledger)과 좌표 있는 **EngravedScore**(staff-space 단위 기하, 그래프 ID 키). 화면과 인쇄는 같은 plan과 같은 간격 알고리즘을 쓰고, page 제약만 다르다.
- **그래프를 언제나 구한다**: 살아 있는 그래프 → 다시 읽을 수 있는 원본 → (U1) 저장된 그래프 → 새 역투영 `legacy.fromScore`. 연습·재생은 Score에 남고, 둘의 일치는 G2 비교기(`legacy.compare`)로 확인한다.
- 벤치마크는 4층이다: L1 의미 소비(ledger), L2 기하 metric, L3 기하 snapshot(Node, CI), L4 milestone 사람 평가 2회. 사람에게 매번 묻지 않는다.

**구현 단계**: G4a 원천·plan → G4b 배치 핵심·연습 map → G4c beam·tuplet·성부 → G4d 곡선·기호·충돌 → G4e 페이지·인쇄 → G4f benchmark 완성·사람 평가·flip. production 기본값은 G4f까지 legacy다.

---

## 1. Status

| 항목 | 상태 |
| --- | --- |
| 설계 | 이 문서 (Architect, 2026-09-24) |
| 구현 | 시작 안 함. 코드·flag·schema·golden 변경 없음 |
| 사용자 결정 | G4-U1 (그래프 보존), G4-U2 (G3 off 퇴화 기보의 표시), G4-U3 (인쇄 범위), G4-U4 (화면 줄바꿈 규칙) — §29 |
| G3 | PARTIAL / DEFERRED, 전부 OFF. G4는 G3에 기대지 않는다 (§26) |
| 기대 결과 | G4f flip 뒤 연습 화면의 판각이 바뀐다. 재생·연습 판정·저장 Score·MusicXML export·G0 metric은 바뀌지 않는다 |

---

## 2. Goal

### 2.1 정의

```
ScoreGraph (+ RenderConfig)
    │  resolve  — 무엇을 그릴지. 좌표 없음. 그래프 ID. ledger로 빠짐 없음을 증명
    ▼
NotationPlan  (+ FidelityLedger)
    │  layout   — 간격·줄바꿈·세로 배치·충돌·곡선. staff-space 단위. DOM 없음
    ▼
EngravedScore  (+ PracticeMap)
    │  draw     — VexFlow 4.2.3 + PPP SVG primitive
    ▼
screen SVG (연습·전곡·리뷰·썸네일) │ paged SVG (인쇄 → 브라우저 PDF)
```

핵심 질문에 대한 답: **이미 정의된 ScoreGraph의 기보 의미를, 모든 의미 객체가 그려졌거나 그려지지 않은 이유가 기록된 상태로, 결정론적 기하로 바꾸고, 그 기하를 연습 UI와 인쇄가 함께 쓴다.**

### 2.2 성공의 모양

- ScoreGraph에 있는 beam·tuplet·tie·slur·기호가 화면에 보이거나, 보이지 않는 이유가 ledger에 있다. "그래프에는 있는데 렌더러가 조용히 무시함"은 L1이 잡는다 (A1).
- 음높이·onset·길이·staff·성부가 판각 전후로 같다. G4는 그래프를 바꾸지 않는다 (A13–A15).
- 충돌·잘림·넘침 0 (A17–A25), 같은 입력에 같은 기하 (A27–A29).
- 하이라이트·재생선·클릭·루프·기억 모드·손 필터가 그대로 동작하고 더 싸다 (A30–A34).
- 인쇄는 화면과 같은 plan에서 나온 페이지다 (A38–A40).

---

## 3. Non-goals

- **음악 내용을 바꾸지 않는다.** onset, 길이, 음높이, 철자, 성부, staff/손 배정, tuplet 묶음, beam 멤버십(그래프에 있을 때), tie·slur 유무. 판각을 예쁘게 하려고 시간을 바꾸지 않는다.
- **G3 flag를 바꾸지 않는다.** `PROFESSIONAL_DEFAULT`, `g3b`, `ottava`, `pedalJoin` 모두 그대로 OFF. G3b의 이른 release 교정(R-reg)을 G4로 옮기지 않는다.
- **새 편곡 논리를 만들지 않는다.** 운지를 생성하지 않는다 (인쇄된 운지를 그릴 뿐).
- **재생을 바꾸지 않는다.** `PianoScore`, 연습 판정, 이슈 3(8va 재생), pedal `change` 재생은 Score와 재생 코드의 일이다.
- **G5를 시작하지 않는다.** ScoreGraph schema를 바꾸지 않는다 (§8.6에서 필요 없음을 보인다).
- **드럼 전용 판각, tab, 현대음악 기보**(비정형 박자표 조합, feathered beam, 도형 기보)는 하지 않는다. 타악기는 최소 표시만 (§14.6).
- **MusicXML export를 바꾸지 않는다.** export는 이미 그래프에서 나온다 (G1).
- 저장 형식 변경은 사용자 결정 G4-U1이 정한 범위만.

---

## 4. 현재 렌더러 감사

`55d1bd5` 기준. 줄 번호는 `Piano Coach App.dc.html`(App)이다. 두 개의 탐색 보고를 받아 핵심 주장마다 코드를 다시 읽어 확인했다. 부록 B에 색인이 있다.

### 4.1 진입점 — 렌더러는 하나다

`makeScoreView(React)`(10473)가 만든 `ScoreView` 클래스 하나가 모든 악보 화면을 그린다. 호출은 `sv(props)`(16454) 또는 직접 `h(this._SV, …)`다.

| 화면 | 위치 | 주요 props |
| --- | --- | --- |
| 연습 (가까이 보기) | 18080 | `startM = viewStart(staffBars)`, `count = staffBars`(2 또는 4), `perRow` 0 또는 2, `zoom`, `pick`, `playX`, `beat`, `hands`, `wrong`, `hidePlan`, `loopFrom/To`, `guidance` |
| 연습 (전곡) | 18080 | `wholeScore`: `count = 전체`, `perRow = barsPerLine()`(≤720px 2, 아니면 4, 16534), `fluid`, `heading`, `weak`, `mW` 236/180 |
| import 리뷰 | 17818 | 4마디, 번호 |
| 미리보기 | 17625 | 3마디 |
| 루프 썸네일 | 17528 | 1마디, clef 없음 |
| 곡 목록 썸네일 | 15695, 17397 | |
| 진도 썸네일 | 18265 | |
| 빈 보표 | 18391 | 1마디 |
| 음 이름 퀴즈 | 18369 | 1마디, `notesKey` |

악보 판각은 이 하나뿐이다. 다른 "렌더러"처럼 보이는 것은 판각이 아니다. falling notes(11795~)는 자체 캔버스 기하이고, `PdfLayer`(9248–10426)는 들여오는 PDF를 **읽는** 기능이며, `tests/fixtures/make-fixtures.js`는 OMR fixture를 만드는 독립 VexFlow 페이지다.

### 4.2 입력 — 렌더러는 legacy `Score`를 읽고, Score는 세 곳에서 온다

| 생산자 | 코드 | Score를 만드는 방법 | 그래프 |
| --- | --- | --- | --- |
| 파일 열기 (.musicxml/.mxl/.mid) | import door 7512–7541, `scoreFromFile` 4489 | `toScore(graph)` | import 결과 옆에 `graph`로 돌아오지만 **어디에도 보관하지 않는다** |
| 카탈로그·교재 (course, 로컬 카탈로그) | 15867, 7296, 7320 | `scoreFromXml` → `toScore` | 버려짐 |
| 녹음 → 악보, 다시 쓰기 | 7206–7219, 14709–14718, 14772–14776, 14974–14983 | `toMusicXml` → `parseMusicXML(built.xml)` | `built.graph`가 있지만 쓰지 않음 |
| 녹음이 카탈로그와 맞음 | 7174 | `parseMusicXML(heard.xml)` | 없음 |
| PDF/사진 OMR | 7599, 7634, 7643 | `parseMusicXML` 뒤 `PdfLayer.apply`가 **Score를 직접 고침** (코드명·8va·arpeggio) | 없음 |
| 저장된 곡·공유된 곡 복원 | 12541–12594, 15254 | localStorage/서버의 packed Score (`packScore` 3498) | 없음 (G2-D14: 그래프는 저장하지 않는다) |

결과: **다시 불러온 곡은 그래프가 없다.** 렌더러를 그래프로 옮기려면 그래프를 구하는 방법이 먼저 있어야 한다 (§8.2, G4-U1).

### 4.3 `draw()` — 판각 (10528–11466)

| 단계 | 줄 | 하는 일 |
| --- | --- | --- |
| 창 | 10554–10562 | `Score.step`으로 `startM`부터 `count`마디 |
| 옷 입히기 | 10609–10632 | clef·key·time. key와 time은 바뀔 때만, clef는 줄 첫머리마다 |
| 마디 준비 | 10690–10755 | staff·성부별 `buildVoice`, `Formatter.joinVoices`(staff별) → `format` → tick context 기둥. 두 성부면 **평균 음높이**로 stem 위/아래 (10699–10710). 마디 안 clef 변경 폭 |
| 가로 간격 | 10763–10775 | 기둥마다 `max(오른쪽 폭 + 다음 기둥 왼쪽 폭, u·Δ^0.65)`, Δ는 4분음표 단위. 모든 staff가 기둥을 공유 |
| 줄 채우기 | 10776–10818 | `solveU`: 이분법 32회로 줄이 페이지 폭을 채우는 u. 한 줄 `perRow`마디, 너무 빽빽하면 줄임. 짧은 마지막 줄은 위 줄들 중앙값 u |
| 그리기 | 10909–11063 | 마디마다 `VF.Stave`, 기둥 x를 `setX`로 주입, 음을 `ppp-note` 그룹(`data-onset`, `data-rest`)으로 그림, beam·tuplet 그림 |
| tie·slur | 11065–11112 | (staff, voice) 사슬. 줄이 다르면 버림 |
| 기호 | 11114–11267 | pedal 텍스트, 8va 점선, segno·coda(Unicode 글자), 코드명, Fine/D.C., volta |
| 색·크기 | 11295–11351 | 검정 fill/stroke를 잉크 색으로 바꿈, `getBBox`로 viewBox |
| 연습 overlay | 11353–11455 | 현재 마디 wash, 루프 상자, 클릭·드래그, 재생선 |
| 테스트용 | 11457–11465 | `svg.__ppp = {page, pad, rows, tight, begin, bars}` |

`buildVoice`(11468–11631)는 같은 onset의 음을 화음 하나로 묶고, **화음의 첫 음**의 `type`·`dots`·`stem`·`tm`을 쓴다. 각 음의 tick 길이를 onset에서 다음 onset까지로 **강제**한다 (`fit`, 11490) — 기둥 정렬을 위해서다. glyph는 적힌 대로 둔다.

### 4.4 `sync()` — 프레임마다 (11634~)

`this._noteEls` 전체를 돌며 `ppp-on`·`ppp-bad`·`ppp-off`·`ppp-ghost` class를 토글하고, `_map`(마디별 `{x, w, startQ, lenQ, pts:[[q, x]]}`)으로 재생선·현재 마디·루프 상자를 옮긴다. 판각은 다시 하지 않는다. 그러나 **매 프레임 모든 음**을 훑는다. 재생 중 부모가 40 ms마다 다시 그리므로(`setInterval(tick, 40)` 12352) 긴 곡의 전곡 보기에서 프레임당 중앙 13–14 ms, 최대 29 ms를 쓴다 (부록 A-2). `drawKey`(10497)는 `score.id`를 쓰므로, id를 유지한 채 바뀐 Score는 다시 판각되지 않는다.

### 4.5 렌더러가 그래프 의도를 덮어쓰는 곳 (O1–O20)

adapter에서 잃는 것(§6)과 별개로, **렌더러 자신의 결정**이 의미와 어긋나는 곳이다.

| # | 무엇 | 줄 | 결과 |
| --- | --- | --- | --- |
| O1 | beam을 박마다 스스로 묶는다 (8분 이하, 쉼표에서 끊음, 성부별). 2/2는 4분 단위, `beats%3==0`인 /8은 점4분 | 11570–11589 | 파일 beam 무시. secondary break 없음. G3a beam 3,305개가 A36에서 보이지 않은 이유 (G3-U8) |
| O2 | tuplet을 `tm` 비율과 "시간이 찼는가"로 묶는다 | 11591–11621 | `show.number`, `bracket`, `placement` 무시. `printed:false`(괄호 없는 time-modification)에도 괄호·숫자. 중첩 평탄화 |
| O3 | 멤버 하나인 tuplet은 표시하지 않는다 (`tr.length > 1`) | 11598 | G3 off 녹음 악보의 셋잇단은 **전부 숫자 없이** 그려진다 (G03 A-2: 1-음 괄호 비율 1.000) |
| O4 | 추론 악보의 마디 안 tie를 숨긴다 | 11079 | 그림은 두 번 치는 음, 재생(2631 `struck`)과 연습 판정(6754)은 한 음. **그림과 앱의 행동이 모순** |
| O5 | 줄이 다르면 tie·slur를 버린다 | 11073, 11101 | system을 넘는 tie가 사라져 두 번 치는 음처럼 보인다 |
| O6 | slur를 "start → 같은 성부의 다음 stop"으로 짝짓는다 | 11097–11111 | 겹친 slur가 잘못 짝지어진다. 쉼표에 걸린 slur는 사라진다. `placement` 무시 |
| O7 | tie를 (staff, voice) 사슬의 이웃끼리만 | 11069–11095 | 성부가 바뀌는 tie를 잃는다 |
| O8 | 두 성부의 stem을 평균 음높이로 정한다 | 10699–10710 | 그래프 성부 순서(label)와 다를 수 있다 |
| O9 | 화음의 stem·음가·tuplet을 첫 음에서 | 11511–11518 | 같은 onset의 다른 길이 음이 한 화음으로 그려진다 |
| O10 | 쉼표 높이를 성부 방향별 고정 음으로 | 11503–11505 | 그래프 `display.pos` 무시. 마디 쉼표를 가운데 두지 않는다 |
| O11 | 음 길이를 onset 간격으로 강제 | 11490–11496 | 기둥 정렬은 좋다. 그러나 적힌 음가와 실제 길이가 다른 음(이슈 19)이 **보이지 않게** 된다 (진단 불가) |
| O12 | pedal `change`를 `∗`로 | 11128 | 바꿔 밟기가 뗌으로 보인다 |
| O13 | 박자표를 숫자로만 | 10618, 10630 | common/cut 기호 무시, 파일에 박자가 없어 숨긴 4/4(`hidden`)도 찍힌다 |
| O14 | segno·coda·♩를 Unicode 글자(Noto Music)로 | 10878, 11195 | 플랫폼 글꼴에 따라 모양·크기가 다르다 |
| O15 | 코드명 충돌을 DOM 글자 폭으로 | 11221 | 브라우저·글꼴마다 배치가 다르다 |
| O16 | viewBox를 `getBBox`로 | 11324–11330 | 기하가 DOM에 의존. 숨은 노드에서 throw 가능 |
| O17 | 줄 끝 courtesy key/time 없음, clef 변경을 새 마디 머리에 작은 clef로 | 10626–10630 | 전문 판각 관례와 다르다 |
| O18 | 마디 번호를 매 마디에 | 11038–11044 | 연습에는 유용. 인쇄 관례(줄 첫머리)와 다르다 |
| O19 | tempo는 제목 영역의 `♩ = N` 하나 (첫 tempo) | 10877–10881 | tempo 변경·말(Allegro 등) 없음 |
| O20 | 오류 시 "This passage could not be engraved." (영어, i18n 없음) | 10513–10522 | 판각 실패가 조용히 사용자에게 간다. 원인 집계 없음 |

### 4.6 중복된 기보·배치 논리

| # | 같은 결정을 하는 곳들 | 문제 |
| --- | --- | --- |
| D1 | beam 묶음: 렌더러 O1, `pro-beam.js` `groups`(G3), MusicXML import의 파일 beam, export의 `<beam>` 파생 | 렌더러 규칙이 G3 규칙(박표 §11.2, 짧은 쉼표 넘기, 16분 secondary break)과 다르다 |
| D2 | tuplet 묶음: 렌더러 O2, importer의 run(`printed:false`, musicxml-import 1296–1339), `pro-tuplet.js`, adapter의 start/stop | 넷이 서로 다른 규칙 |
| D3 | 8va의 적힌 음: 렌더러 `written()`(10673), `Score.finalize`(3565~), adapter의 부호 뒤집기(legacy-score 206) | 이슈 3과 얽혀 있다 |
| D4 | MusicXML 읽기: `parseMusicXML`(3919)과 그래프 importer, 둘 다 렌더러 입력을 만든다 | 같은 파일이 경로에 따라 다르게 그려질 수 있다 (G2 shadow 23 파일) |
| D5 | 손 배정: 렌더러는 `hand`를 **정하지 않는다** (좋음). `pianoTop`(10568)이 첫 오른손 음으로 brace 자리를 고를 뿐 | 유지 |
| D6 | 간격·줄바꿈: 렌더러에만 있다 | 중복 아님. G4가 대체한다 |

### 4.7 DOM 측정과 비결정 요인

- `getBBox`(viewBox, 11326), `getComputedTextLength`(코드명, 11221) — 글꼴·브라우저마다 다르다.
- VexFlow를 jsDelivr CDN에서 런타임에 받는다 (9209). 오프라인이면 "Could not reach the notation library". 버전은 URL에 고정되어 있지만 내용 해시 확인이 없다.
- Unicode 음악 글자(O14)는 설치된 글꼴에 따라 달라진다.
- 나머지(간격, 줄바꿈, VexFlow glyph 윤곽)는 결정론적이다. VexFlow 4의 음악 glyph는 **글꼴 윤곽 데이터를 SVG path로** 그린다 — 웹 글꼴을 쓰지 않는다 (부록 A-3).

### 4.8 기존 테스트가 고정한 것

모두 puppeteer로 8777의 앱을 연다 (`npm test`, CI에는 없음).

- `tests/engraving.test.js`: 4마디 이하 줄, 페이지 밖 없음, 음표머리가 자기 마디 안, 머리 겹침 없음(30 % 면적), 두 성부 stem 위/아래, 마디 안 clef 변경, tuplet 2개 표시, repeat·volta·final, 박자표 한 번, 어두운 테마 글자 밝기, **부분 화음 tie는 이어지는 음만**, **추론 악보는 마디 안 tie를 그리지 않음**(O4를 고정한 테스트).
- `alignment.test.js`: 같은 onset의 두 손 머리가 4 px 안.
- `layout.test.js`, `interactions.test.js`, `follow.test.js`, `musicxml.test.js`, `coach.test.js`, `import.test.js`: `.ppp-now`, `svg.__ppp.bars`, `g.ppp-note`, `.ppp-off`, `[data-rest="1"].ppp-on`, 클릭 시 재생 위치.

새 렌더러는 이 **DOM 계약**(`g.ppp-note[data-onset]`, `data-rest`, `g.ppp-stave[data-m][data-staff]…`, `.ppp-now`, `svg.__ppp.bars`)을 유지한다 (§16.4). O4를 고정한 테스트는 G4-U2의 결정에 따라 바뀐다.

---

## 5. ScoreGraph → 렌더러 pipeline

### 5.1 지금

```
 파일·카탈로그 ──► importFile / musicxml.import ──► ScoreGraph ──► legacy.toScore ──► Score.finalize ─┐
                                                        │ (메모리, 곧 버려짐)                             │
 녹음·다시 쓰기 ──► toMusicXml ──► {xml, graph} ──► parseMusicXML(xml) ────────────► Score.finalize ─┤
                                        │ graph 안 씀                                                  │
 OMR ─────────────► Audiveris/PDFtoMusic xml ──► parseMusicXML ──► PdfLayer.apply(Score 수정) ────────┤
 저장·공유 복원 ──────────────────────────────────────────► unpackScore ──► Score.finalize ─────────┤
                                                                                                      ▼
                                                                                          legacy Score
                                            ┌──────────────────────────────────┬──────────────────┤
                                     ScoreView.draw()                    PianoScore·연습 판정·운지·코치
                                     (buildVoice → VexFlow 객체 →          (그대로 둔다)
                                      SVG DOM, _map, _noteEls)
                                            │
                                     ScoreView.sync() — 40 ms마다 class 토글
```

### 5.2 목표 (G4)

```
 (위 생산자들 그대로)                      legacy Score ───────────────► PianoScore·연습 판정 (변화 없음)
        │                                     │  ▲
        │ graph (살아 있는 것)                  │  │ link: sgHead / join key
        ▼                                     ▼  │ agree: legacy.compare
 ┌──────────── RenderSource.resolve(song) ─────────────┐
 │ 1. live graph (import door, built.graph, 카탈로그)    │
 │ 2. 다시 읽을 수 있는 원본 (course·카탈로그 파일)          │
 │ 3. 저장된 그래프 (G4-U1)                               │
 │ 4. legacy.fromScore(score)  ← 새 역투영, 항상 가능       │
 └──────────────────────┬──────────────────────────────┘
                        ▼ ScoreGraph (+ RenderConfig)
                 engrave.plan()   ──► NotationPlan + FidelityLedger     (좌표 없음, 캐시: graph hash)
                        ▼
                 engrave.layout() ──► EngravedScore                      (sp 단위, 캐시: plan hash + config)
                        ▼                         └──► PracticeMap (마디 상자, 기둥 x, event → 요소)
                 engrave.svg()    ──► screen SVG / paged SVG
                        ▼
                 ScoreView (renderer: 'engrave') — sync()는 PracticeMap으로, 바뀐 요소만
```

- **ScoreGraph가 진실이다.** NotationPlan과 EngravedScore는 파생물이다. 저장하지 않고, 입력 해시로 캐시한다.
- 연습·재생은 Score에 남는다 (S5의 재생 부분은 G5 이후). 판각 요소와 Score 음은 **link**(§8.2)로 잇는다.
- 레이아웃은 Node와 브라우저에서 **같은 코드**로 돌고 같은 기하를 낸다 (A28). 그래서 L1–L3 벤치마크가 CI(Node, puppeteer 없음)에서 돈다.

---

## 6. 기보 의미 지원 표

"그래프"는 `scoregraph/schema.js`, "adapter"는 `scoregraph/legacy-score.js` `toScore`, "렌더러"는 App의 `ScoreView`다. **코퍼스**는 커밋된 악보 357개(카탈로그 전체 + 교재 + ScoreGraph fixture, 96,825 event)를 그래프로 읽어 센 수다 (부록 A-1). 판정: **충실** = 그래프 의미대로 보임, **부분** = 일부만, **틀림** = 다른 의미로 보임, **무시** = 보이지 않음.

| 의미 | 그래프 | adapter → Score | 현재 렌더러 | 판정 | 코퍼스 | G4 | 이후 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Beam 멤버십 | `beam{events}` | **버림** (분기 없음, 177–192) | 박마다 스스로 (O1) | **무시** | 11,808 beam · 47,805 event · 130 파일 | 그래프대로; 없을 때만 공유 규칙으로 파생 (§11) | cross-staff beam |
| Beam secondary break | `breaks[{after, level}]` | 버림 | 없음 | 무시 | 762 | §11 | |
| Beam hook | 파생 규칙 (필드 없음) | – | VexFlow 자동 | 부분 | – | §11 규칙 | |
| Tuplet 멤버십·비율 | `tuplet{events, actual, normal, unit, parent}` | `tm{a,n}` = 중첩 곱, `tupletStart/Stop`은 printed일 때만 | tm + "찼는가" 휴리스틱 (O2) | 부분 | 1,930 | 그래프대로 (§12) | |
| Tuplet 표시 | `show{number, bracket, placement}`, `printed` | **show 버림** | show 무시, printed:false에도 표시, 1-음은 없음 (O2, O3) | **틀림** | number none 1,605 · bracket false 1,768 | §12 | |
| 중첩 tuplet | `parent` | 곱으로 평탄화 | 평탄 | 무시 | 1 (fixture) | 2단까지 | 3단 이상 |
| Tie | `tie{from, to}` head→head | head별 `tieStart/Stop` | 한 줄 안만, 추론 악보 마디 안은 숨김 (O4, O5, O7) | 부분 | 385 (+녹음 경로 다수) | 모든 tie, 줄 넘김 반쪽 (§13) | |
| Slur | `slur{from, to, placement, line}` | start/stop 표시만, 짝·placement 버림 | 다시 짝지음, 한 줄 안만 (O5, O6) | 부분 | 3,245 · 70 파일 | 그래프 짝대로 (§13) | |
| Phrase (`Structure.phrases`) | 분석용 구간 | 없음 | 없음 | 해당 없음 | 0 | 그리지 않음 (slur가 아님) | G7+ 분석 |
| 한 staff의 여러 성부 | `Voice{staff, label}` | `n.voice` 정수 | 평균 음높이로 stem (O8) | 부분 | staff-마디 3,901 / 16,481 · 147 파일 | §14 | |
| 쉼표 위치 | `display.pos`, `measureRest` | **버림** | 고정 음 (O10) | 부분 | pos 302 | §14.3 | |
| 점 | `display.dots` | `dots` | 그림 | 충실 | – | 유지, 위치 규칙 §14 | |
| 임시표 | `acc{type, cautionary, editorial, paren, bracket}` | type만 | type 그림, 괄호 없음 | 부분 | 인쇄 3,529 · 주의 1 | 배치 G4, 의미 G3 | |
| Clef | `Clef{sign, line, octave, at}` | 첫 part만, line·octave 버림 | 마디 안 변경 그림 | 부분 | 마디 안 119 | C clef, 옥타브 clef, 변경 위치 (§15.4) | |
| 조표 | `KeyEvent{at, scope, hidden}` | 마디 첫 조만 | 취소 기호 있음, courtesy 없음 (O17) | 부분 | 변경 5 | §15.4 | |
| 박자표 | `MeterEvent{beats[], symbol, groups, hidden}` | beats[0]/beatType | 숫자만, hidden도 찍음 (O13) | 부분 | 기호 107 · 변경 11 | §15.4 | |
| 세로줄·반복 | `barline{left, right}` | repeat·style (오른쪽) | repeat·final·double | 부분 | 도돌이 271 | 왼쪽 style, 세로줄 fermata | |
| Volta | `endings` | ending 필드 | 자체 path | 충실 (기본) | 46 | skyline 배치로 | |
| Jump (segno·coda·fine·D.C.·D.S.·to coda) | `jumps` | `marks[]` | Unicode 글자·텍스트 (O14) | 부분 | 16 | SMuFL glyph | |
| 꾸밈음 (grace) | `Event.grace{order, slash}` | **버림** (233) | 없음 | **무시** | 244 · 17 파일 | §14.5 | |
| Articulation | `arts[]` | accent·marcato만 (재생 세기) | 없음 | **무시** | 6,935 | §10 순서 | |
| 꾸밈 기호·tremolo | `orn[]` | 버림 | 없음 | 무시 | 51 | 기본 집합 | |
| Fermata | `Event.fermata`, `Barline.fermata` | 버림 | 없음 | 무시 | 31 | 그림 | |
| 셈여림 | Direction `dynamic` | `dynamics[]`, `n.dyn` (재생만) | 없음 | **무시** | 895 · 88 파일 | 두 보표 사이 (§10) | |
| Hairpin | `wedge` | `wedges[]` (재생만) | 없음 | 무시 | 381 | §10 | |
| 말 (words)·rehearsal | Direction `words`/`rehearsal` | 버림 | 없음 | 무시 | 441 | 그림 | |
| Tempo 표시 | `TempoEvent{qpm, mark{unit, dots, perMinute, text, parens}}` | bpm만 | 제목 영역 `♩ = N` 하나 (O19) | 부분 | 표시 308 | 위치마다, 말+메트로놈 | |
| Pedal | `pedal{changes, mark{line, sign}}` | `pedals[{type}]` | `Ped.`/`∗` 글자, change = `∗` (O12) | **틀림** | 17 (+녹음 경로 다수) | §10 pedal | 재생의 change는 G4 밖 |
| Ottava | `ottava{staff, shift}` | `ottavas[]`, 부호 뒤집음 (이슈 3) | 점선, 적힌 음으로 이동 | 충실 (표시) | 79 | skyline 배치, 15ma, 줄 넘김 | 재생(이슈 3)은 G4 밖 |
| Glissando·slide | `gliss` | 버림 | 없음 | 무시 | 2 | 직선/물결선 | |
| Arpeggio | `arpeggio{heads, dir, non}` | `n.arp`, **non을 arp로** | 방향 없는 물결 | 틀림 (non) | 8 | dir·non | |
| 인쇄된 운지 | `Head.fingering[]` | 첫 값(1–5)만, hand guide용 | 악보에 없음 | **무시** | head 14,305 · 84 파일 | 그림 (끌 수 있음) | 운지 생성 G5 |
| 가사 | `Event.lyrics` | 버림 | 없음 | 무시 | 1 | 기본 | |
| 코드명 | Direction `chord` | `chords[]` 첫 part | 그림 (DOM 폭, O15) | 충실 (기본) | 550 | metric 표로 | |
| Stem 방향 | `display.stem` up/down/none/double | up/down | 첫 음 (O9) | 부분 | 49,772 지정 | §14.1 | |
| Notehead 모양 | `Head.notehead{shape, filled, paren}` | 버림 | 보통 머리만 | 무시 | 비보통 0 | 기본 집합 | |
| 숨은 event·cue 크기 | `hidden`, `cue`, `display.size` | 버림 | 숨은 음도 그림 | 틀림 | – | 숨김, 작게 | |
| Cross-staff event | `Event.staff` ≠ voice staff | 음별 staff | staff별로 나눔 | 부분 | 2 (fixture) | event 단위 지원 | cross-staff 화음·beam (§14.4) |
| 타악기 | `perc` heads, `kit` | `p:null` | **쉼표로 그림** | 틀림 | 1 | 최소 표시 (§14.6) | 드럼 판각 |
| 여러 마디 쉼표 | `Measure.multiRest` | 버림 | 마디마다 | 무시 | 1 | 인쇄에서만 묶음 | |
| 줄·페이지 나눔 힌트 | `Measure.layout{newSystem, newPage}` | 버림 | 자체 줄 | 무시 (화면에는 맞음) | 285 | 옵션 (기본 무시, §15) | |
| 마디 번호 | `Measure.number` | number | 매 마디 | 충실 | – | 화면 매 마디, 인쇄 줄 첫머리 | |
| 제목·작곡가 | `meta` | title·composer | 전곡 보기 제목만 | 부분 | – | 인쇄 제목 영역 | |
| 이조 악기의 적힌 음 | concert + `transpose` | `writtenP` | `writtenP` 우선 | 충실 | 0 (카탈로그) | 유지 (G2-D15) | |

요약: 표의 44행 중 현재 렌더러가 **충실히** 그리는 것은 6(점, volta, ottava 표시, 코드명, 마디 번호, 이조 악기의 적힌 음), **틀리게** 그리는 것 5(tuplet 표시, pedal change, arpeggio non, 숨은 event, 타악기), **부분** 16, **무시** 16, 해당 없음 1(phrase)이다. 코퍼스로 보면 **가장 많이 잃는 것은 beam(47,805 event), 운지(14,305 head), articulation(6,935), slur(3,245), tuplet 표시(1,605–1,768)** 순이다.

---

## 7. 렌더러 아키텍처 결정

### 7.1 후보

| | 내용 |
| --- | --- |
| **A** | **VexFlow 4.2.3 유지 + PPP 판각 층.** NotationPlan·EngravedScore를 두고, 간격·줄바꿈·세로 배치·충돌·곡선·페이지는 PPP가 소유한다. VexFlow는 glyph 윤곽·metric 제공자이자 음표 단위 formatter·drawer(StaveNote, Beam, Tuplet, 수식자)로만 쓴다. 지금 렌더러가 이미 간격과 줄바꿈을 소유하고 VexFlow에 x를 주입하는(10971) 방식의 연장이다 |
| **B** | **VexFlow 렌더러 전면 재작성** (VexFlow 5로 올리고 VexFlow의 System/Formatter에 배치를 맡김, 중간 표현 없음) |
| **C** | **혼성**: 화면은 VexFlow, 인쇄·PDF는 MusicXML(G1 exporter) → 외부 판각기 (서버의 MuseScore CLI, 또는 브라우저의 Verovio) |
| **D** | **Verovio(WASM) 단일 엔진**: NotationPlan → MEI(그래프 ID = `xml:id`) → Verovio가 화면과 인쇄를 모두 판각. 연습 overlay는 SVG 요소 ID와 timemap으로 |
| (E) | OpenSheetMusicDisplay (MusicXML → VexFlow 기반 자체 배치, BSD-3) — D와 같은 "외부 배치 엔진" 부류로 함께 평가 |

### 7.2 비교

| 기준 | A | B | C | D |
| --- | --- | --- | --- | --- |
| 연습 상호작용 (하이라이트·재생선·클릭·루프·기억 모드·손 필터) | 지금 구조 유지 (`draw`/`sync` 분리, class 토글, 재배치 없는 숨김) | 다시 만들어야 함 | 화면은 A와 같음 | ID·timemap으로 가능하나 overlay를 전부 다시 만듦. "안내 글자", "리듬만 보기" 같은 PPP 전용 표시는 입력 인코딩이나 overlay로 우회 |
| 커서·MIDI 추적 | PracticeMap이 기둥 x를 가짐 (지금 `_map`과 같은 모양) | 다시 | A와 같음 | timemap + 요소 bbox (bbox는 SVG 파싱 또는 DOM) |
| 지연 (가까이 보기 페이지 넘김) | 측정 기준선 16–24 ms, 사전 계산으로 더 줄임 | 미지 | A와 같음 | 페이지 단위 re-layout. Worker로 옮길 수 있음 |
| 확대·반응형 | page 단위 좌표 + viewBox (지금과 같음) | VexFlow System 폭 재계산 | A와 같음 | pageWidth 옵션으로 re-layout |
| 인쇄·PDF 품질 | PPP 페이지 배치를 새로 만들어야 함 (G4e) | 같음 | 전문 판각기 품질 | 전문 판각기 품질 |
| 구현 노력 | **큼**: 충돌·곡선·페이지 약 4–6k줄 + 테스트 | 큼, 그리고 기존 연습 통합을 버림 | 중간 + 두 엔진 유지 | 중간: MEI 생성·ID 연결·overlay·크기 대응. 판각 품질은 공짜 |
| 결정론 | VexFlow 기하가 **DOM 없이 Node에서 결정론적** (부록 A-3). PPP 코드가 DOM 측정을 버리면 완전 | VexFlow 5의 glyph 경로는 따로 확인 필요 | 화면과 인쇄가 **서로 다른** 기하 | Verovio 자체 metric으로 결정론적 |
| 오프라인·서버 | vendoring하면 오프라인, 서버 불필요 | 같음 | MuseScore는 서버 설치(Render 이미지)·GPL 프로세스, Verovio는 브라우저 | 브라우저, 서버 불필요 |
| 라이선스 | VexFlow MIT (패키지 `LICENSE`로 확인). 내장 glyph 윤곽(기본 스택 Bravura·Gonville·Custom) — Bravura는 SIL OFL 1.1, 나머지는 G4a에서 원문을 확인해 `vendor/README.md`에 고지 | MIT | MuseScore GPL-3(별도 프로세스), Verovio LGPL | **Verovio LGPL-3.0-or-later** (npm 6.3.0) — 교체 가능한 형태로 배포, 고지 의무 |
| 크기 | 992 KB, gzip 전송 310 KB (지금과 같음) | 비슷 | A + 판각기 | **toolkit WASM 7.3 MB** (`verovio-toolkit-wasm.js`, 부록 A-4). 태블릿 첫 로드 부담 |
| 유지보수 | PPP 코드가 늘지만 전부 우리 손 안 | 같음 | 두 엔진의 차이를 계속 맞춰야 함 | 배치 코드는 줄지만 배치 결함은 C++ 엔진 안 — 우리가 못 고침 |
| 화면-인쇄 일관성 | 같은 plan, 같은 간격, 같은 엔진 | 같음 | **다름** (연습한 악보와 인쇄한 악보가 다르게 보임) | 같은 엔진 |
| 충돌·배치 통제 | 전부 | VexFlow 한계 안 | 화면은 전부, 인쇄는 없음 | 옵션 범위 안 |
| G11 적응형 재생성 | 그래프 → 다시 plan·layout (캐시·증분) | 같음 | 두 번 | 그래프 → MEI → 다시 판각 |
| 기존 테스트 | DOM 계약 유지로 대부분 그대로 (§16.4) | 다시 | 화면은 그대로 | 거의 전부 다시 |

### 7.3 결정 G4-D1 — **A를 택한다**

**이유 (저장소 증거)**

1. **측정된 결함은 대부분 엔진 한계가 아니라 충실도 문제다.** §6의 무시·틀림 항목(beam, tuplet 표시, grace, articulation, dynamics, hairpin, pedal, fingering, fermata, 가사, glissando, cross-system tie·slur)은 모두 VexFlow 4.2.3에 이미 있는 부품(`Beam`, `Tuplet`, `GraceNoteGroup`, `Articulation`, `Ornament`, `TextDynamics`, `StaveHairpin`, `PedalMarking`, `FretHandFinger`, `Annotation`, `TextBracket`, `StaveTie` 반쪽, `Curve`, `MultiMeasureRest`, `ClefNote`, `TimeSigNote`, `Parenthesis`, `Tremolo`, `ChordSymbol`)으로 그릴 수 있다. 이 세션에서 4.2.3 빌드를 Node에 올려 전부 있음을 확인했다 (부록 A-3). 문제는 의미가 렌더러에 **닿지 않는 것**이다.
2. **VexFlow 기하는 DOM 없이 결정론적이다.** Node에서 음 x·y, stem 끝, beam 기울기, bounding box, 글자 폭(내장 metric 표)을 계산했고, 두 번 실행이 같았다 (부록 A-3). 그래서 같은 레이아웃 코드를 CI(Node)와 브라우저에서 돌릴 수 있고, 벤치마크가 **실제 제품 기하**를 잰다.
3. **연습 통합이 이미 성숙하다.** `draw`/`sync` 분리, class 토글, 재배치 없는 손 필터·기억 모드, 클릭·드래그, 재생선이 9개 브라우저 suite로 고정되어 있다. A는 이 계약을 지키고, D는 전부 다시 만든다.
4. **크기·라이선스.** 310 KB MIT 대 7.3 MB LGPL. PPP는 태블릿에서 여는 단일 HTML 앱이다.
5. **통제.** PPP만의 표시(안내 글자, 리듬만 보기, 약한 마디 음영, 손별 색)와 교육용 규칙(가까이 보기 창, 줄당 마디 수)을 판각 층 안에서 다룬다.

**A의 대가 (받아들인다)**: 충돌 배치, slur 곡선 회피, 페이지 배치를 PPP가 만든다. 전문 판각기(Dorico, LilyPond, Verovio) 수준을 모든 경우에 보장하지 않는다. 목표는 **PPP 코퍼스**(교재, 찬송가, 소나티네, 녹음 전사)에서 L2 충돌 0과 사람 평가 통과다.

**버린 것과 이유**

- **B**: VexFlow 5로 올리면 glyph 경로가 바뀌고(웹 글꼴 기반으로 알려져 있으나 이 세션에서 확인하지 않음 — 올리기 전에 확인할 일), 연습 통합을 버린다. 얻는 것이 A보다 적다. VexFlow 업그레이드는 G4 안에서 하지 않는다 (R3).
- **C**: 화면과 인쇄가 다른 엔진이면 연습한 악보와 인쇄한 악보가 다르게 보이고, 두 엔진의 의미 해석 차이를 계속 맞춰야 한다. 서버 MuseScore는 Render 배포 이미지와 운영 부담을 늘린다.
- **D (Verovio)**: 판각 품질은 가장 좋다. 그러나 크기(7.3 MB), LGPL 의무, 연습 overlay 재작성, 배치 결함을 우리가 고칠 수 없다는 점이 PPP의 제약과 맞지 않는다. "다른 엔진이 더 예쁘다"만으로 바꾸지 않는다.
- **E (OSMD)**: MusicXML 입력(그래프 ID가 없다), 캔버스 글자 측정(비결정), 자체 VexFlow fork. D의 단점에 비결정까지 더한다.

**되돌릴 수 있게 둔다 (hedge).** 엔진 독립 경계는 **NotationPlan**이다 (§8). NotationPlan → MEI 인코더를 붙이면 Verovio를 같은 입력으로 돌릴 수 있다. **재평가 조건**: G4d 끝에 L2 곡선·충돌 metric(A20, A22, A25)이나 사람 평가 M-H1의 "기호 배치" 축이 목표에 못 미치고, 원인이 PPP 배치 층이면, G4e 전에 Verovio spike(NotationPlan → MEI → Verovio, 같은 R 코퍼스, 같은 L2)를 하고 사용자에게 올린다.

### 7.4 진실의 원천

- **ScoreGraph가 유일한 진실이다.** NotationPlan·EngravedScore·SVG·PracticeMap은 파생물이며 저장하지 않는다 (캐시만).
- 연습·재생이 읽는 legacy Score도 그래프의 projection이거나(import 경로), 그래프와 **일치가 확인된** 형제다(§8.2 `agree`). 일치하지 않으면 Score에서 그래프를 다시 만든다(`fromScore`). 렌더러가 Score와 다른 음을 그리는 일은 없다.

---

## 8. Engraving / layout 모델

### 8.1 중간 표현이 필요한가 — 필요하다, 둘 (G4-D7)

**NotationPlan** (좌표 없음)과 **EngravedScore** (좌표 있음)를 둔다. 이유:

1. **"의미를 소비했는가"를 기하와 따로 재야 한다.** A36에서 드러난 문제(그래프에 beam 3,305개, 화면에 0)는 좌표를 보기 전에 잡혀야 한다. plan이 그래프 객체마다 ledger 항목을 남기면 L1은 그것을 센다.
2. **화면과 인쇄가 같은 의미를 공유한다.** 둘은 plan이 같고 config(페이지 폭·줄바꿈 규칙)만 다르다. A40이 이것을 검사한다.
3. **엔진 독립 경계.** plan은 VexFlow를 모른다. §7.3의 hedge가 여기 붙는다.
4. **기하를 DOM 없이 검사한다.** EngravedScore는 직렬화할 수 있는 plain JSON이다. 충돌·잘림·결정론을 Node에서 잰다.
5. **캐시 단위가 다르다.** plan은 그래프가 바뀔 때만, layout은 config(창, 폭, 확대, 안내 글자)가 바뀔 때 다시 만든다.

세 번째 표현(글리프 단위 "render tree")은 두지 않는다. SVG backend가 EngravedScore를 바로 그린다.

### 8.2 RenderSource — 그래프를 언제나 구한다 (G4-D2)

`engrave/source.js`:

```js
resolve(song) -> { graph, via: 'live'|'refetch'|'store'|'projected', link, diagnostics }
```

1. **live**: 생산자가 만든 그래프를 곡 옆 메모리에 둔다 (`this._engraveGraph = {graph, scoreId}`; state·localStorage에 넣지 않는다 — G2-D14와 같은 이유). 새로 두는 곳: import door(7533, 7540), `scoreFromXml` 호출처(15867, 7296, 7320 — `scoreFromXml`이 그래프도 돌려주게 내부 함수 추가), 녹음·다시 쓰기의 `built.graph`(7219, 14718, 14776, 14983), 카탈로그 일치 녹음(7174)과 OMR(7599–7643)은 같은 XML을 그래프 importer로 읽은 결과.
2. **refetch**: course·카탈로그 곡은 정적 파일이므로 다시 읽는다 (`importSource.kind === 'course'` + 파일 경로, 로컬 카탈로그 항목). **G4a에서 만들지 않았다 (G4-I2, §32.3)**: U1이 수용되어 course·카탈로그 곡도 열 때 그래프가 저장되므로 다시 읽기는 같은 결과로 가는 두 번째 길이다.
3. **store**: G4-U1이 A면, 저장해 둔 그래프 (§29).
4. **projected**: `PPPScoreGraph.legacy.fromScore(score)` — **새 역투영**. 모든 Score에서 항상 된다.

어느 경우든 쓰기 전에 **agree**를 확인한다:

```js
agree(score, graph) := legacy.compare(score, Score.finalize(legacy.toScore(graph)))
                       에 '.order' 외의 차이가 없다
```

G2의 비교기를 그대로 쓴다 (permutation이면 `.order`, 아니면 `.set` — G2 §25 R1의 교훈). 실패하면 `fromScore(score)`로 떨어지고 진단 `SOURCE_DISAGREE`를 남긴다. 예: OMR 경로는 `PdfLayer.apply`가 Score를 고치므로(코드명·8va·arpeggio) XML 그래프와 어긋난다 → projected. 이 경우 Audiveris가 쓴 beam을 잃고 파생 beam이 된다 — 알려진 한계이며, PdfLayer를 그래프로 옮기는 일은 G12(OMR)다.

**link** (판각 요소 ↔ Score 음): `n.sgHead`(toScore가 찍는 head ID, legacy-score 282)가 있으면 그것, 없으면 join key `(마디 번호, onset 1e-4 반올림, staff, 울리는 midi)`. 울리는 음에서 전단사가 아니면 agree 실패와 같이 처리한다. 하이라이트·틀린 음 표시·숨김 계획은 **Score 음의 값**(abs, midi, hand, onsetKey)을 쓴다 — 앱이 재생하고 판정하는 것과 그림이 늘 같다 (이슈 3의 8va도 앱의 판정 그대로).

**`legacy.fromScore(score)`** (새, `scoregraph/legacy-score.js`):

- 시간: Score의 `b`·`dur`(4분음표 float)를 W 유리수로. 1/3840 4분음표 격자(2^8·3·5, 256분 셋·다섯잇단까지)에서 오차 < 1e-6인 가장 작은 분모로 스냅. 결정론적.
- event: 같은 (마디, onset, staff, voice, 길이)의 음 → 화음 event 하나. 쉼표 → rest event.
- tie: (staff, voice, midi)에서 `tieStart` → 다음 `tieStop`. slur: Score가 짝을 잃었으므로 **지금 렌더러의 규칙**(start → 같은 성부의 다음 stop)으로 복원하고 그 spanner의 provenance op를 `inferred`로.
- tuplet: `tm` + `tupletStart/Stop` → tuplet spanner, 표시가 없는 run은 `printed:false`.
- `pedals`, `ottavas`(adapter가 뒤집은 부호를 되돌림), `chords`, `marks`, `dynamics`, `wedges`, `tempos`, 제목·작곡가, clef·key·time·세로줄·volta → 해당 그래프 객체.
- provenance: source kind `legacy-score`(schema `SOURCE_KINDS`에 이미 있음), op `imported`. 새 enum 값이 필요 없다 (§8.6). "projected"는 RenderSource의 `via` 값이고 그래프에 쓰지 않는다.
- **성질 (A48)**: `toScore(fromScore(S))`가 toScore가 투영하는 모든 필드에서 `S`와 같다 (id·sgHead·sgFrom 제외). 코퍼스 504 파일의 Score, core 553 녹음 출력의 `parseMusicXML` Score, 저장 상태 fixture로 검사한다.

projected 그래프에는 Score가 모르는 것(beam, 표시 옵션, articulation 대부분, 꾸밈음 …)이 없다. 그래서 G4-U1이 중요하다.

### 8.3 NotationPlan

`engrave/plan.js` (+ `plan-beams.js`, `plan-tuplets.js`, `plan-voices.js`, `plan-marks.js`). 순수 함수, 입력 그래프를 바꾸지 않는다 (A13).

```js
plan(graph, semanticConfig) -> NotationPlan
NotationPlan = {
  version: 'plan/1', graph: { id, rev, hash },
  staves:   [{ key, part, staff, kind, lines, clefs: [{m, at, sign, line, octave}], keys, meters }],
  measures: [{ id, number, index, dur, implicit, multiRest, barline, ending, jumps }],
  voices:   [{ staffKey, m, order: [voiceId...], roles: {voiceId: 'up'|'down'|'single'} }],   // staff-마디별
  events:   [{ id, m, at, dur, staffKey, voice, kind, type, dots, grace, cue, hidden,
               heads: [{ id, staffKey, step, oct, alter, acc, notehead, fingering }],
               stem: 'up'|'down'|'none'|'auto', restPos, measureRest, arts, orn, fermata, lyrics }],
  beams:    [{ id, events, breaks, source: 'graph'|'derived' }],
  tuplets:  [{ id, events, actual, normal, unit, parent, number, bracket, placement, source, merged? }],
  ties:     [{ id, fromHead, toHead }],
  slurs:    [{ id, from, to, placement, line }],
  lines:    [{ id, kind: 'wedge'|'pedal'|'ottava'|'gliss'|'arpeggio', ... }],
  marks:    [{ id, kind: 'dynamic'|'words'|'rehearsal'|'chord'|'tempo'|'jump'|'guide', anchor: {m, at, staffKey, event?}, placement, ... }],
  ledger:   [{ ref, kind, status, code?, plan }]
}
```

- **적힌 음**: heads의 step·oct는 적힌 위치다 — concert에서 이조(`transpose`)와 ottava를 빼서 구한다 (G2-D15). 음이 울리는 높이는 plan에 없어도 된다.
- **ID**: 그래프 ID를 그대로 쓴다. 파생 객체는 결정론적 ID(`d:beam:<첫 event ID>`, `d:tuplet:<첫 event ID>`, `d:rest-merge:<ID들>`).
- **순서**: 모든 배열은 그래프 순서(마디, onset, staff, voice, ID 번호)로 정렬.
- **ledger status**: `drawn`(그래프대로), `derived`(그래프에 없어 규칙으로 만듦 — beam뿐), `merged`(여러 그래프 객체를 한 기호로 — 겹친 쉼표, U2의 tuplet 묶음), `suppressed`(의미가 그리지 말라고 함 — `hidden`, `printed:false`, `show.number:'none'`의 숫자), `deferred`(코드가 있는 지원 안 함 — 허용 목록에만), `projected-loss`(fromScore라서 원래 없음 — 정보). **ledger에 없는 그래프 기보 객체는 결함이다** (A1).
- **semanticConfig**: `marks`(기호 보이기, 지금 prop과 같음), `fingering`, `chords`, `guide`(안내 글자), `degenerate`(G4-U2의 선택). 여기에는 좌표 관련 값이 없다.

### 8.4 EngravedScore

`engrave/layout.js`가 만든다. 단위는 **staff space(sp)**, 화면 1 sp = 10 px (지금 `spacing_between_lines_px: 10`, 10922).

```js
layout(plan, layoutConfig) -> EngravedScore
EngravedScore = {
  version: 'engr/1', planHash, config,
  pages:    [{ index, w, h, systems: [..] }],                 // 화면은 페이지 하나, 높이 무한
  systems:  [{ index, page, x, y, w, stretch, ragged, measures: [..], staves: [{ key, y, top, bottom }] }],
  measures: [{ id, number, system, x, w, columns: [{ at, x }] }],
  objects:  [{ id, kind, refs: [graph IDs], system, staffKey, box: [x0, y0, x1, y1], anchor: [x, y], layer }],
  curves:   [{ id, kind: 'tie'|'slur'|'gliss', refs, system, p0, c1, c2, p3, part: 'whole'|'start'|'end' }],
  diagnostics: [{ code, refs, detail }]
}
```

- 좌표는 0.01 sp로 반올림한 수로 저장한다. canonical JSON(키 순서 고정)의 sha256이 **layout hash**다 (§20).
- `kind`의 예: `notehead`, `stem`, `flag`, `beam`, `accidental`, `dot`, `rest`, `ledger`, `clef`, `keysig`, `timesig`, `barline`, `tuplet-bracket`, `tuplet-number`, `articulation`, `fingering`, `dynamic`, `hairpin`, `pedal`, `ottava`, `volta`, `text`, `chord`, `lyric`, `grace`, `arpeggio`, `guide`.
- **PracticeMap**(`engrave/practice.js`)은 EngravedScore에서 파생한다: 마디 상자와 system, 기둥 `[at, x]`(지금 `seg.pts`와 같은 역할), event ID → SVG 요소 ID, 연습 band(`BAND_TOP/BOT`에 해당).

### 8.5 코드 배치

```
vendor/vexflow-4.2.3.js        고정 빌드 (sha256을 vendor/README.md와 테스트가 확인), 라이선스 고지
engrave/                       UMD, 브라우저 + Node, 네트워크·DOM 없음 (svg.js의 DOM 생성 제외)
  index.js  source.js  plan*.js  metrics.js  space.js  breaks.js  skyline.js
  layout.js  curves.js  canon.js  practice.js  svg.js  (store.js — G4-U1이 A일 때)
scoregraph/legacy-score.js     + fromScore
Piano Coach App.dc.html        script 태그, ScoreView의 renderer 스위치, 생산자에서 live 그래프 보관 (작은 편집만)
tests/engrave/                 node --test (CI), fixtures, golden, tools (browser 도구는 로컬)
```

- `engrave/`를 19k줄 앱 파일 밖에 둔다. 여러 세션이 앱 파일을 같이 고치는 위험(R8)을 줄이고, Node 테스트가 앱을 띄우지 않는다.
- 서버는 `vendor/`, `engrave/`를 서빙한다 (차단 목록은 `node_modules`, `tools`, `.git`, `data`, `tests` — server.js 42). 배포 이미지는 `COPY . .`라 따로 할 일이 없다.
- 앱은 `scoregraph/*.js` 뒤, `audio-score.js` 앞이나 뒤 어디든 `vendor/vexflow-4.2.3.js`와 `engrave/*.js`를 `?v=`와 함께 로드한다. legacy 렌더러는 `loadVexFlow()`를 계속 쓰되, vendored 파일이 이미 로드되어 있으면 CDN에 가지 않는다 (9214의 `window.Vex` 확인이 그대로 동작).

### 8.6 Schema 검토 — 바꾸지 않는다

G4에 필요한 표시 의미는 v2 schema에 다 있다: beam `breaks`, tuplet `show`·`printed`·`parent`, `display.stem`·`pos`·`measureRest`·`size`, `hidden`, `cue`, `grace`, `acc.cautionary/paren`, `notehead`, `fingering.placement`, slur `placement`·`line`, pedal `mark`, meter `symbol`·`hidden`, key `hidden`, `Measure.layout`. 없는 것 — beam hook 방향, tie 방향 강제, staff·system 거리 힌트(`<print>`의 layout) — 은 규칙으로 정하는 판각 결정이라 schema가 필요 없다. **G4는 schema를 바꾸지 않는다** (G3-D6과 같은 입장).

---

## 9. 가로 간격 (spacing)

(G4-D11) 지금의 `u·Δ^0.65` + 최소폭 모델은 순진한 `x = time × 폭`이 아니다 (10763). G4는 이것을 **spring-rod 모델**로 정식화하고, 빠진 요소(꾸밈음, 줄 넘김 tie의 최소 길이, 가사·운지 글자, 마디 안 기호 변경, 쉼표 병합)를 넣는다.

### 9.1 기둥

- 한 system 안의 모든 staff·성부·part가 **기둥을 공유**한다: 마디마다 서로 다른 onset(`at`, 유리수)의 집합. "같이 울리는 것은 같이 그린다" (지금과 같음, `alignment.test.js`가 고정).
- tuplet 안의 onset은 정확한 유리수다 (지금의 float·tick 반올림이 없다).
- **시간 아닌 기둥**: 마디 안 clef·key·time 변경, 마디 머리의 clef·key·time(줄 첫머리), 세로줄. 폭은 glyph 폭이고 시간 간격을 받지 않는다.
- **꾸밈음**: 주 음 기둥의 왼쪽 부속 기둥. 시간 간격 없이 꾸밈음 묶음 폭만큼의 rod.

### 9.2 Spring (이상 간격)

기둥 i에서 다음 기둥까지의 시간 Δᵢ에 대해

```
ideal(Δ) = u · (Δ / Δref)^α          α = 0.65,  Δref = 4분음표
```

- **α = 0.65**: 지금 렌더러가 경험으로 맞춘 값이다. 사용자와 테스트가 이 밀도에 익숙하고, 값을 바꿀 증거가 없다. 음가가 두 배일 때 간격 1.57배 — 판각 관례의 범위(두 배 음가에 1.4–1.6배) 안이다. M-H1 사람 평가에서 [0.55, 0.75] 안의 세 값을 짝 비교로 보고 조정할 수 있게 상수로 둔다 (`space.js` `ALPHA`).
- 마지막 기둥의 Δ는 마디 끝까지.
- `u`는 system마다 푼다 (§9.4). 그래서 Δref의 선택은 결과를 바꾸지 않는다 — u가 흡수한다.

### 9.3 Rod (최소 거리)

기둥 i와 i+1 사이 rod = `오른쪽 폭(i) + 왼쪽 폭(i+1) + 0.3 sp`. 모든 staff 중 최대:

| 오른쪽 폭 (i) | 왼쪽 폭 (i+1) |
| --- | --- |
| 음표머리(2도 화음의 반대쪽 머리 포함), 점, flag, 덧줄 삐침(0.2 sp), 성부 사이 머리 비킴, 운지·가사·안내 글자 폭의 반, tie 시작 최소 길이 | 임시표(쌓인 열 전체), 꾸밈음 묶음, arpeggio, 마디 안 clef·key·time, 글자 폭의 반 |

- **tie가 시작하는 기둥**은 다음 기둥까지 ≥ 2.0 sp (tie가 보이도록).
- 세로줄 앞 ≥ 1.0 sp, 뒤(첫 기둥까지) ≥ 1.2 sp. 줄 첫머리의 clef·key·time 뒤 ≥ 1.5 sp.
- 폭은 VexFlow glyph metric(음악 기호)과 PPP 글자 metric 표(§18)에서 온다. DOM을 재지 않는다.

### 9.4 폭 맞추기 (justification)

system의 목표 폭 W에 대해

```
width(u) = Σ 마디 [ 머리 폭 + Σ max(ideal_i(u), rod_i) ]      (u에 대해 단조 증가)
u*  = width(u) = W 인 u
```

- 풀이: rod를 기준으로 구간을 정렬해 구간별 선형식으로 **정확히** 푼다 (지금의 이분법 32회를 대체; 이분법을 남겨도 결정론적이지만 정확한 풀이가 더 싸다). `width(0) > W`면 그 줄은 너무 빽빽하다 → §15의 줄바꿈이 마디를 줄인다.
- **마지막 system**: 위 system들의 u 중앙값으로 자연 폭을 구해 W의 80 % 이하면 ragged(오른쪽을 비움), 아니면 채운다. 지금 규칙(중앙값 u)과 같은 결과를 내되 기준을 명시한다.
- 가까이 보기(창 N마디)도 같은 풀이. 창 경계는 system 경계와 같다.

### 9.5 여러 성부·화음·tuplet

- 여러 성부의 음은 기둥을 공유하므로 서로를 밀어낸다 (rod는 staff 전체 최대).
- 2도 화음·성부 사이 비킴(§14.2)은 오른쪽 폭을 늘린다.
- tuplet은 정확한 onset으로 기둥이 생기므로 특별한 규칙이 없다. tuplet 숫자·괄호는 세로 배치(§12)이고 가로 rod가 아니다.
- **쉼표 병합**(§14.3)은 기둥을 바꾸지 않는다.

### 9.6 하지 않는 것

광학 간격 보정(stem 방향에 따른 미세 이동), 가사에 맞춘 음 간격 확장 이상의 가사 판각, 마디 단위 "그림 간격 고정"은 하지 않는다. 필요해지면 `space.js` 안의 규칙으로 더한다.

---

## 10. 충돌 체계

### 10.1 원칙

- 모든 음 밖 기호는 **하나의 배치 함수**로 놓는다: `place(item, side, [x0, x1], priority)` → 그 구간의 skyline 위(또는 아래)에 padding을 두고 놓고, 자기 상자를 skyline에 더한다. fixture 하나를 위한 좌표 보정은 두지 않는다 (mutation M8이 이 함수를 끈다).
- **skyline**: system의 staff마다 위·아래 두 개. 0.25 sp 칸의 최대 높이 배열 (결정론적, 부동소수 오차 없이 0.01 sp 정수로 저장). 곡선은 0.5 sp 간격으로 표본한 상자로 넣는다.

### 10.2 순서 (우선순위)

| 순서 | 대상 | 어디 | 비고 |
| --- | --- | --- | --- |
| 1 | 음표머리, 2도 비킴, 임시표 열, 점, stem, flag, 덧줄, 쉼표 | VexFlow 음 단위 formatter + §14 규칙 | 내재 배치. 기둥 x는 §9가 줌 |
| 2 | beam, stem 길이 | §11 | |
| 3 | tie | §13 | 음에 붙음 |
| 4 | tuplet 괄호·숫자 | §12 | beam 쪽 또는 음표머리 쪽 |
| 5 | articulation, 꾸밈 기호, fermata, tremolo | 음 쪽 (stem 반대) → skyline | staccato·tenuto가 가장 안쪽, accent, marcato, fermata가 가장 바깥 |
| 6 | 운지 **(G4-L5, Lead 2026-09-25: articulation 다음, slur보다 먼저)** | 1번 staff는 위, 2번 staff는 아래 (그래프 placement 우선) — 음 곁에, phrase slur 안쪽 | 화음 운지는 세로로 쌓음. staccato·tenuto는 여전히 운지 안쪽 |
| 7 | slur, glissando; 안내 글자, 가사 | slur·glissando: §13 **(G4-L5: 운지 다음 — slur가 운지를 비킨다)**. 안내 글자: 아래. 가사: 성부의 staff 아래 (안내 글자·가사는 G4d-1b) | slur는 articulation과 운지 바깥 (staccato·tenuto는 안쪽에 둠 — 관례) |
| 8 | 셈여림, hairpin | 피아노 grand staff는 **두 보표 사이** (그래프가 placement·staff를 주면 그것) | 한 system에서 기준선 하나로 모음 |
| 9 | pedal | 가장 낮은 피아노 보표 아래, system마다 기준선 하나 | |
| 10 | 위쪽 줄: ottava, volta, 코드명, tempo, rehearsal, jump, 위쪽 words | 가장 높은 staff 위 | 안쪽에서 바깥: ottava → 코드명 → volta → tempo·rehearsal |
| 11 | 아래쪽 words, D.C.·D.S. | 가장 낮은 staff 아래 | |
| 12 | 세로 간격 | §15.3 | 최종 skyline으로 |

### 10.3 Hard 제약 (절대 위반 금지)

| # | 제약 | 위반하면 |
| --- | --- | --- |
| H1 | 같은 staff의 서로 다른 event 음표머리가 겹치지 않는다 (병합한 unison 제외, ledger `merged`) | 음 쪽 비킴·기둥 폭을 늘림 |
| H2 | 임시표가 음표머리·stem·다른 임시표·덧줄과 겹치지 않는다 | 임시표 열을 왼쪽으로 늘리고 rod를 키움 |
| H3 | 점이 음표머리·stem·flag와 겹치지 않는다 | 점 위치를 칸으로 옮기고 rod를 키움 |
| H4 | 어떤 객체도 페이지 상자 밖으로 나가지 않는다 (잘림 0) | 여백·system 높이를 늘림 |
| H5 | 글자(셈여림·운지·코드명·tempo·가사·pedal·8va·안내 글자·마디 번호)가 음표머리·stem·beam·임시표와 겹치지 않는다 | skyline 바깥으로 |
| H6 | system끼리, staff끼리 겹치지 않는다 | 세로 간격을 늘림 |
| H7 | beam이 자기 묶음의 음표머리를 가로지르지 않고, stem이 최소 길이 이상이다 | stem을 늘림 |
| H8 | 음이 자기 마디 세로줄 밖으로 나가지 않는다 (`engraving.test.js`의 규칙) | rod |

### 10.4 Soft 제약 (최소화)

S1 기호는 가능한 한 붙은 대상 가까이. S2 system 안 같은 종류(셈여림·pedal·코드명·8va)는 한 기준선. S3 slur는 음표머리·stem·articulation과 0.25 sp 이상 떨어지고 높이는 최소. S4 세로 공간 최소. S5 hairpin은 수평이고 양끝 셈여림과 0.5 sp 띄움.

### 10.5 대체 동작

- soft 제약을 못 지키면 바깥으로 민다. 기준 거리(staff에서 8 sp)를 넘으면 그래도 놓고 진단 `FAR_PLACEMENT`를 남긴다. **(G4-L5, Lead 2026-09-25)** 배치 함수(`skyline.js` `put()`)가 직접 남긴다: 놓인 항목의 staff 쪽 가장자리가 그 쪽 바깥 보표선에서 8 sp를 넘으면 그 항목의 id를 이름 댄다. §21.2의 `eg.layout.far_placements`로 센다(기록, baseline 대비 늘면 퇴행), 8 sp 너머인데 이름이 없는 항목은 `eg.layout.far_undiagnosed`(영목표). 운지는 따로 영목표 `eg.fingering.far`: 제 음과 그 사이에 서야 하는 것(음표·tie·tuplet·기호, 같은 기둥의 안쪽 운지, 보표)이 요구하는 것보다 먼 운지 (§35.18.3).
- 같은 기준선에서 가로로 겹치는 글자(코드명, 셈여림): 코드명은 오른쪽으로 민다(지금 규칙과 같음), 셈여림은 한 단 더 바깥 기준선으로. 순서는 (x, 그래프 순서)로 정해 결정론적이다.
- hard 제약을 공간을 늘려도 못 지키면 진단 `HARD_VIOLATION`(테스트에서 실패)을 남기고 그대로 그린다 — 화면을 비우지 않는다.

---

## 11. Beams

### 11.1 원천 (G4-D3)

| 경우 | 그리는 것 | ledger |
| --- | --- | --- |
| 성부-마디에 그래프 beam이 하나라도 있다 | **그래프 beam만**, 멤버 그대로. 그 성부-마디에서는 파생하지 않는다 | `drawn` |
| 성부-마디에 그래프 beam이 없다 | **공유 규칙으로 파생**: `pro-beam.js`의 exported `groups(evs, meterGrid.grid(g, m), tupletOf)`을 **순수 함수로** 부른다 (G3의 pass를 돌리지 않는다; pro-beam.js·meter-grid.js는 고치지 않는다) | `derived` |
| 그래프 beam이 규칙에 어긋난다 (`W-BEAM-SHAPE`: 한 성부가 아님, 4분 이상 포함) | 그래도 그래프대로 그린다 (고치는 것은 G3) | `drawn` + 진단 `BEAM_SHAPE` |

- 이유: G3 off 녹음 경로는 beam을 하나도 쓰지 않는다. "충실"을 문자대로 하면 모든 8분음표가 깃발로 그려져 지금보다 크게 나빠진다. 지금 렌더러도 beam을 만든다(O1). 차이는 **G3와 같은 규칙 하나**를 쓰고, 파생임을 ledger에 적는다는 것이다 (중복 D1 해소). 파일 전체에 beam이 없는 MusicXML을 읽을 때 자동 beam을 쓰는 것은 흔한 판각기 동작이기도 하다.
- 파생 beam은 그래프에 쓰지 않는다. MusicXML export에도 나오지 않는다 (export는 그래프만 쓴다).
- G3a가 켜지면 그래프에 beam이 생기고 파생은 저절로 사라진다 (§26).
- **G4a 구현에서 바꾼 것 (G4-I1, §32.3)**: 파생의 단위는 성부-마디가 아니라 **part**다. part에 그래프 beam이 하나라도 있으면 그 part에서는 파생하지 않는다 — beam을 쓰는 파일은 쓰지 않은 곳도 말한 것이다. 위 표의 성부-마디 규칙은 beam을 쓰는 카탈로그 파일 15개에서 파일이 깃발로 둔 259 묶음을 beam으로 바꿨을 것이다 (예: Czerny 599/26의 둘째 성부).
- **(G4-I6)** 한 음 tuplet의 표시 병합(§12.3)을 beam보다 먼저 정해, 파생 beam 규칙이 병합된 묶음을 tuplet 하나로 본다. 그러지 않으면 병합된 셋잇단에 beam이 생기지 않는다.

### 11.2 기하

- **primary beam**: 멤버 전체. **secondary**: 음가가 16분 이하인 이웃끼리 이어지되, `breaks[{after, level}]`에서 그 level 이상이 끊긴다. 끊긴 자리의 짧은 음은 **hook**(부분 beam).
- **hook 방향**(그래프에 필드 없음): 박 안 위치로 정한다 — 앞 음과 같은 박 단위에 속하면 왼쪽, 아니면 오른쪽; 묶음의 첫 음은 오른쪽, 끝 음은 왼쪽; 점음표 뒤의 짧은 음은 왼쪽 (Gould의 관례). VexFlow `Beam`의 부분 beam 방향 지정으로 그린다.
- **stem 방향**: 그래프 `display.stem`이 있으면 그것(멤버끼리 다르면 첫 멤버, 진단 `BEAM_STEM_MIXED`). 여러 성부면 성부 역할(§14.1). 하나뿐이면 묶음에서 가운데 줄로부터 가장 먼 음의 반대 방향 (극단음 규칙), 같으면 다수결, 그래도 같으면 아래.
- **stem 길이**: 기본 3.5 sp. beam 아래 최소 — primary 하나일 때 2.5 sp, beam이 하나 늘 때마다 +0.75 sp. 덧줄 음은 stem이 가운데 줄에 닿도록 늘림.
- **기울기**: VexFlow 기울기 탐색에 PPP 규칙을 얹는다 — 최대 기울기 0.25(가로 1당 세로), 첫 음과 끝 음이 같거나 가운데 음이 양끝보다 stem 쪽으로 튀어나오면(오목) **수평**, 반복음 묶음 수평. metric `eg.beam.slope_max ≤ 0.25`.
- **beam 안 쉼표**: 그래프 beam은 음만 멤버로 갖는다. 멤버 사이에 있는 쉼표(8분 미만, pro-beam의 "짧은 쉼표 넘기" 규칙)는 beam 아래 공간에 세로로 옮겨 그린다 (beam과 겹치지 않게, H5와 같은 검사).
- **여러 성부**: 성부마다 따로. 위 성부 beam은 위, 아래 성부는 아래.
- **tuplet과 겹침**: beam이 tuplet 멤버와 정확히 같으면 괄호 없이 숫자만 (§12).
- **cross-staff**: 멤버가 두 staff에 걸친 beam은 `deferred:cross-staff-beam` — 대체로 staff별 부분 beam 두 개를 그린다 (§14.4). 코퍼스에 없다.

### 11.3 "그래프에는 있는데 조용히 무시"를 잡는 방법

- L1 `eg.beam.graph_drawn_ratio = 1`: 그래프 beam마다 EngravedScore에 `refs`가 그 beam ID이고 멤버 event ID 집합이 같은 `beam` 객체가 정확히 하나.
- L1 `eg.beam.derived_in_beamed_vm = 0`: 그래프 beam이 있는 성부-마디에 파생 beam이 없다.
- L1 `eg.beam.orphan = 0`: 그래프에도 파생 규칙에도 없는 beam이 없다.
- mutation M1(그래프 beam을 버리고 전부 파생)·M2(파생 끔)가 REGRESSION이어야 한다.

---

## 12. Tuplets

### 12.1 규칙 (G4-D4)

G4는 **논리 tuplet을 그대로 그린다.** 시간을 다시 해석하지 않는다 (G3 결함을 숨기려고 타이밍을 바꾸지 않는다).

| 그래프 | 그리는 것 |
| --- | --- |
| `printed: false` | 아무것도 (ledger `suppressed`). importer가 괄호 없는 time-modification run을 이렇게 만든다 (musicxml-import 1335) |
| `show.number` | `'actual'`(기본) "3", `'both'` "3:2", `'none'` 숫자 없음 |
| `show.bracket` | 명시되면 그대로 |
| bracket 명시 없음 | 멤버가 **정확히 한 beam의 멤버와 같으면** 괄호 없이 숫자만, 아니면 괄호 (쉼표가 끼거나, beam이 없거나, beam이 더 길거나 짧으면) |
| `show.placement` | 명시되면 그대로. 없으면 멤버 다수의 stem 쪽 (beam 쪽), 여러 성부면 성부 역할 쪽 (위 성부 위, 아래 성부 아래) |
| `parent` (중첩) | 안쪽 괄호가 음에 가깝고 바깥 괄호가 그 바깥. 2단까지 (코퍼스 최대 1), 3단 이상은 `deferred:nested-3` + 바깥 둘만 |

### 12.2 괄호 범위와 고정점

- 시작: 첫 멤버(쉼표 포함)의 왼쪽 끝(임시표 제외, 음표머리 기준). 끝: 마지막 멤버의 오른쪽 끝(점 포함).
- 괄호 끝의 갈고리는 음 쪽으로 0.75 sp. 숫자는 괄호 가운데, 괄호를 끊고 들어간다.
- 높이: 멤버의 stem 끝·beam·음표머리 skyline + 0.5 sp, 괄호는 수평 또는 첫·끝 멤버 높이를 따라 최대 기울기 0.25.
- **쉼표를 포함한 tuplet**은 beam이 묶음을 보여 주지 못하므로 괄호가 기본이다 (위 표의 규칙이 저절로 그렇게 한다).
- **성부 분리**: tuplet은 한 성부 안에서만. 멤버가 성부를 넘으면 그래프 결함(validator) — 그리되 진단 `TUPLET_VOICES`.
- **마디를 넘는 tuplet**: 괄호를 마디 경계에서 끊지 않고 이어 그린다 (system을 넘으면 반쪽 두 개).

### 12.3 한 음짜리 tuplet (writer가 만든 병리)

G3 off의 녹음 writer는 셋잇단 **조각마다** 괄호를 연다 (이슈 20, G03 A-2: 1-음 괄호 비율 1.000). 그래프에는 멤버 하나인 printed tuplet spanner로 들어온다.

- **충실한 그림**: 멤버마다 숫자 "3" (괄호 없이, 음표머리 또는 beam 쪽). 지금은 **아무것도 안 그린다**(O3) — 셋잇단 8분 셋이 보통 8분 셋처럼 보여 리듬을 읽을 수 없다. (G4c, G4-C5: plan의 한 음 tuplet 괄호 기본값이 거짓 — 숫자만)
- **표시 병합 (선택지)**: 같은 성부에서 비율·단위가 같은 1-음 printed tuplet이 시간상 이어지고, 멤버 길이 합이 정확히 tuplet 하나(`normal × unit`)이며, 그 시작이 마디 안에서 그 단위 격자에 맞으면, 숫자 하나(괄호 규칙은 §12.1)로 그린다. 마디를 넘지 않는다. ledger는 원래 spanner ID들을 `merged`로 적는다. 그래프에 여러 멤버 tuplet이 하나라도 있는 성부-마디에서는 하지 않는다 (G3a 그래프에서는 저절로 꺼짐).
- 둘 중 무엇을 기본으로 할지는 **G4-U2** (§29). 권고는 표시 병합이다. 어느 쪽이든 타이밍은 그대로이고, G3의 `nq.*` metric은 그래프를 재므로 이슈 20은 G3 측정에서 그대로 보인다.
- **사용자 결정 G4-U2 B (§31)**: 표시 병합은 **모든 구조 조건이 한 시각 묶음임을 증명할 때만**, 애매하면 그래프 그대로. G4a의 조건 (`engrave/plan-tuplets.js`): printed, 멤버 하나, parent·자식 없음, 명시 `show` 없음; 같은 part·성부·staff·마디; grace·hidden 아님; 같은 비율과 같은 단위(명시 unit, 없으면 모든 멤버의 같은 음가); 틈 없이 이어지고 그 안에 grace 없음; 그 성부-마디에 여러 멤버 tuplet 없음; 멤버 합이 정확히 tuplet 하나(normal × unit)이고 마디 첫머리에서 그 길이의 배수에서 시작; pickup 마디 아님; 멤버 둘 이상. ledger는 각 멤버를 `merged`, code `merged-for-display`로 적는다. 조건 하나하나가 테스트로 고정되어 있다 (`tests/engrave/plan.test.js`).

### 12.4 검사

L1 `eg.tuplet.drawn_ratio`(printed tuplet마다 숫자 또는 괄호 객체), `eg.tuplet.show_ok`(number·bracket·placement 규칙 위반 0), `eg.tuplet.suppressed_drawn = 0`(`printed:false`에 그린 것 0). L2 `eg.tuplet.extent_err`(괄호가 첫·끝 멤버를 덮는가). fixture E04–E07.

---

## 13. Ties / slurs / curves

tie(같은 음높이를 잇는 소리 의미)와 slur(구절·레가토 표시)는 **다른 객체**다. plan에서 따로 오고, 곡선 기하만 `curves.js`를 공유한다.

### 13.1 Tie (G4-D5)

- **모든 그래프 tie**를 그린다: head → head, 부분 화음 tie(이어지는 음만), 세로줄 넘기, **system 넘기**(앞 system 끝까지의 반쪽 + 다음 system 첫머리에서 시작하는 반쪽), 성부가 바뀌는 tie (from·to head를 직접 잇는다 — 사슬 이웃 규칙 O7을 쓰지 않는다).
- 추론 악보의 마디 안 tie 숨김(O4)은 **G4-U2**가 정한다. 권고는 그린다: 앱은 그 음을 한 번 치고(2631) 한 번 누르기를 기대한다(6754). 그림이 두 번 치는 음을 보이면 연습 화면이 앱과 모순된다. tie가 가짜라면 고칠 곳은 그래프를 쓰는 G3/writer다.
- **방향**: 음 하나 — stem 반대. 여러 성부 — 위 성부 위, 아래 성부 아래 (그래프에 방향 필드가 없으므로 규칙). 화음(한 성부) — **(G4-L4, Lead 2026-09-25)** 보표의 가운데 줄이 아니라 **그 머리의 제 화음 안 자리**로 정한다 (묶인 머리든 아니든 화음의 모든 머리를 센다): 맨 위 머리의 tie는 위로, 맨 아래 머리의 tie는 아래로 (바깥 tie는 화음에서 멀어지게), 위 절반의 머리는 위로, 아래 절반은 아래로, 머리 수가 홀수면 정확히 가운데 머리는 stem 반대. (G4d-1a까지의 "가운데 줄 위의 머리는 위로" 규칙은 코퍼스의 tie 달린 화음 42개 중 35개에서 모든 tie를 한쪽으로 휘게 했다.) system을 넘는 tie의 두 반쪽은 떠나는 머리의 규칙 하나로 휜다.
- **끝점**: 음표머리 옆(머리 가운데에서 0.2 sp), 점이 있으면 점 뒤. 최소 길이 1.5 sp (§9.3의 rod가 보장). **(G4-L4, Lead 2026-09-25)** 모든 tie 끝은 **화음의 다른 어느 머리보다 제 머리에 더 가깝다** — 2도로 stem 너머에 비킨 머리를 포함해서; 비킨 머리의 tie는 그 머리 곁에서 시작하고 끝난다. A22의 "화음 앞면까지 잰다" 허용(G4-D1a-5)은 이 더 엄격한 검사로 바뀐다; 기준 0.5 sp는 그대로.
- 높이: 길이에 비례, 0.5–1.2 sp.

### 13.2 Slur

- **그래프 slur의 짝(from, to)을 그대로** 쓴다 (O6의 다시 짝짓기를 버린다). 겹친 slur, 쉼표에 걸린 slur, 성부 안의 중첩 slur가 모두 바르다. fromScore 그래프는 Score가 짝을 잃었으므로 옛 규칙으로 복원한 것이다 (ledger 정보).
- **방향**: 그래프 `placement`가 있으면 그것. 없으면 걸친 음의 stem이 모두 위면 아래, 모두 아래면 위, 섞이면 위. 여러 성부면 위 성부 위, 아래 성부 아래.
- **끝점**: stem 반대쪽이면 음표머리, stem 쪽이면 stem 끝 근처(머리에서 stem 길이의 2/3). 이웃 tie가 있으면 tie 바깥.
- **모양**: 3차 Bézier. 높이 h = clamp(0.1·길이, 0.75 sp, 3 sp). 안쪽 음(음표머리·stem·articulation·tuplet 숫자)의 skyline을 표본으로 보고, 제어점을 올려 모두 0.25 sp 이상 비키게 한다 (최대 3 sp를 넘으면 끝점을 바깥으로 0.5 sp씩 옮겨 다시 시도, 그래도 안 되면 진단 `SLUR_COLLIDES`).
- **system 넘기**: 반쪽 둘. 앞은 system 끝 세로줄 1 sp 전까지, 뒤는 다음 system 첫 기둥 1 sp 앞부터.
- `line: dashed/dotted`은 선 모양으로.

### 13.3 Phrase

`Structure.phrases`는 분석용 구간이고 기보 기호가 아니다. 그리지 않는다. 악보의 phrase 곡선은 그래프에 slur로 들어온다.

### 13.4 Glissando

직선 또는 물결선(`line: wavy`, 기본 직선), 앞 음표머리 오른쪽 → 뒤 음표머리 왼쪽, `text`가 있으면 선 가운데 위.

---

## 14. 다성부와 피아노 grand staff

### 14.1 성부 역할과 stem (G4-D6)

- staff-마디마다 소리 있는 성부 수를 센다.
  - **하나**: 역할 `single` — stem은 §11.2의 극단음·가운데 줄 규칙 (가운데 줄 음은 아래).
  - **둘 이상**: 성부를 **그래프의 순서**로 정렬한다 — `Voice.label`의 숫자 오름차순(MusicXML voice 1/2, 5/6), label이 없으면 그래프 `voices` 배열 순서. 첫째 `up`, 둘째 `down`, 셋째 `up`(비킴), 넷째 `down`(비킴). **평균 음높이로 정하지 않는다** (O8을 버린다). 두 성부의 label 순서와 음높이가 반대인 드문 경우(성부 교차)도 그래프 순서를 따른다.
- 그래프 `display.stem`(up/down/none)이 있으면 언제나 그것이 우선한다. `double`은 `deferred:stem-double` + up.
- 어떤 경우에도 렌더러는 **손(staff)을 정하지 않는다.** 음은 그래프의 head staff에 그린다 (A15). brace 자리를 고르는 것(지금 `pianoTop`)은 그래프 part·staff 구조로 한다.

### 14.2 음표머리 충돌

- **2도 화음**(한 event): VexFlow 규칙 — stem 반대쪽으로 머리 하나 비킴.
- **성부 사이 2도**: 아래 성부(`down`)의 머리를 오른쪽으로 머리 폭만큼. (G4c: 머리 폭 + 0.2 sp — VexFlow 4.2.3의 `h + 2` px; stem이 다른 성부의 머리를 지나는 교차도 같은 규칙으로 비킴. G4-B11의 반대 규칙은 G4-C3이 대체 — §34.5)
- **unison**: 두 성부의 같은 음이 같은 기둥에서, 음가 모양이 같고(둘 다 검은 머리, 또는 같은 흰 머리) 점 수가 같으면 **머리 하나를 공유**(stem 둘) — ledger `merged` (두 head ID). 다르면(검은 머리 대 흰 머리, 점 수 다름) 아래 성부를 오른쪽으로 비킴. (G4c, G4-C4: "merged"는 EngravedScore에 적는다 — head마다 객체가 남고 같은 상자에서 서로를 `merged`로 이름 댄다; plan ledger는 `drawn`. §34.5)
- 화음 안 같은 음(서로 다른 임시표, 예: F와 F♯)은 비킴 + 임시표 열.

### 14.3 쉼표

- 그래프 `display.pos`가 있으면 그 높이 (코퍼스 302).
- `single`: 표준 위치 (온쉼표는 넷째 줄에 매달림, 2분쉼표는 셋째 줄 위, 나머지는 가운데).
- `up`/`down` 성부의 쉼표: 기본 높이에서 시작해 같은 기둥의 다른 성부 음표머리·stem skyline을 0.5 sp 이상 비킬 때까지 바깥으로 (짝수 칸 단위로 이동해 줄/칸 모양 유지).
- **두 성부가 같은 시간에 같은 길이로 쉬면**: 쉼표 하나를 가운데에 (ledger `merged`, 두 rest ID). 길이가 다르면 따로. (G4c: unison과 같이 EngravedScore의 `merged` — G4-C4, §34.6)
- **마디 쉼표**(`measureRest`, 또는 한 성부가 마디 전체를 쉬는 rest): 온쉼표 모양으로 마디의 **가로 가운데**. 박자와 상관없다 (관례).
- `hidden` 쉼표는 그리지 않지만 기둥은 차지한다 (ledger `suppressed`).

### 14.4 Cross-staff

- **event 단위** (event.staff ≠ 그 성부의 staff): event를 event.staff에 그대로 그린다. 지원.
- **head 단위** (한 화음의 head가 두 staff에 나뉨) — `deferred:cross-staff-chord`: 다른 staff의 head들을 그 staff에 같은 기둥·같은 음가의 화음으로 그린다 (stem 반대). staff는 그래프 그대로라 손을 바꾸지 않는다.
- **cross-staff beam** — `deferred:cross-staff-beam`: staff별 부분 beam.
- 코퍼스에는 fixture 2개뿐이다. 진짜 cross-staff 판각은 G4 뒤의 일이다.

### 14.5 꾸밈음

- `Event.grace`인 event는 같은 성부의 다음 grace 아닌 event에 붙는 `GraceNoteGroup`. `order` 순서, `slash`면 사선(acciaccatura), 둘 이상이면 beam. 크기 0.66. slur는 그래프에 있을 때만.
- 가로: 주 음 기둥의 왼쪽 부속 기둥 (§9.1). 주 음의 임시표 왼쪽.
- 뒤에 붙는 꾸밈음(음 뒤, `order`가 주 음 뒤를 가리키는 경우)은 `deferred:grace-after`.

### 14.6 그 밖의 staff 종류

- **타악기**: percussion clef, `KitItem.pos`의 높이, `notehead` 모양(x, 보통 …), stem 위. 드럼 관례(성부 분리, 스틱링)는 없다. 쉼표로 그리는 지금의 결함(틀림)을 없애는 것이 목적.
- **tab**: `deferred:tab`.
- 성악 + 피아노(3–4 staff): part 순서대로 쌓고, 피아노 짝에 brace, 전체에 왼쪽 세로선. 세로줄은 part 안에서만 이어진다 (피아노 짝 안에서 이어짐 — 지금과 같음).

### 14.7 Grand staff

- brace는 피아노 part의 두 staff에. system 왼쪽 세로선은 모든 staff.
- 세로줄은 피아노 두 staff를 관통한다. repeat·final·double도 관통.
- 두 staff의 기둥이 같다 (§9.1) → 두 손의 같은 onset이 같은 x (`alignment.test.js`의 4 px 이내가 0 px이 된다).
- 두 staff 사이 거리는 §15.3의 skyline 규칙 (셈여림이 사이에 들어갈 자리 포함).

---

## 15. System / page layout

### 15.1 두 모드, 한 의미

| | 화면 (`mode: 'screen'`) | 인쇄 (`mode: 'print'`) |
| --- | --- | --- |
| plan | 같다 (semanticConfig만 다를 수 있음: 안내 글자·연습 overlay 없음) | 같다 |
| 간격 | §9 같은 알고리즘 | 같다 |
| 폭 | `systemWidth` = 줄 첫머리 폭 + N × `mW` (지금 `PAGE`, 10798). 데스크톱 약 100 sp, 휴대폰 약 40 sp | A4 세로, 여백 15 mm, staff 크기 7.0 mm(1 sp = 1.75 mm) → 내용 폭 약 103 sp |
| 높이 | 한 페이지, 끝없음 | 페이지 높이, 페이지 나눔 |
| 줄바꿈 | 제품 규칙: N마디 (G4-U4) | 밀도 기반 DP (§15.5) |
| 마디 번호 | 매 마디 (지금과 같음) | 줄 첫머리 |
| 여러 마디 쉼표 | 마디마다 (연습은 마디 단위) | 그래프 `multiRest`면 묶음 |

화면 폭 약 100 sp와 인쇄 폭 약 103 sp가 거의 같아서, 두 모드의 system 내용도 비슷하다.

### 15.2 화면 줄바꿈 (G4-U4 권고 A, 사용자 수정 수용)

> **사용자 결정 G4-U4 (§31)**: 데스크톱 4마디, 휴대폰 2마디는 **선호 목표이지 고정 규칙이 아니다.** 실제 줄바꿈은 밀도와 폭이 이긴다 — 빽빽하면 줄이고, 성기면 **늘릴 수도 있다**. 외톨이 마지막 마디는 가능한 한 피한다. 인쇄는 밀도 기반 (§15.5). 아래 규칙은 G4b에서 이 결정에 맞춰 구현한다: 목표 N을 비용의 중심으로 두는 DP (N에서 멀수록 벌점, 폭 초과는 금지, 너무 성긴 줄은 N+1 이상 허용).

- 한 system에 N마디 (데스크톱 4, ≤720 px 2 — 지금 `barsPerLine()` 16534와 같음). `width(0) × 1.05 > W`면 한 마디씩 줄인다 (지금과 같음).
- **외톨이 마지막 줄 방지**: 마지막 system이 1마디이고 N ≥ 3이며 앞 system이 있으면, 앞 system에서 한 마디를 넘긴다 (4+1 → 3+2), 둘 다 들어갈 때만.
- 가까이 보기 창(2–4마디, 태블릿 focus는 2마디 × 2줄)은 앱의 `viewStart`가 정한다. 판각은 창 경계를 system 경계로 받는다.
- 첫 system 들여쓰기 없음.

### 15.3 세로 배치

- **grand staff 두 보표 사이**: `max(5.0 sp, RH 아래 skyline 깊이 + 사이 기호 단(셈여림·hairpin) + LH 위 skyline 높이 + 1.0 sp)`. system 안에서 하나의 값. 최소 5.0 sp는 지금의 고정 간격(`STAFF_GAP` 92 px, 보표 윗선끼리 — 보표 사이 공간 5.2 sp)에 맞춘 값이다.
- **system 사이**: `max(6.0 sp, 위 system 아래 skyline + 아래 system 위 skyline + 1.5 sp)`.
- pedal·셈여림·코드명·8va는 system마다 기준선 하나 (§10.4 S2).
- 인쇄: 한 페이지의 채움이 60 % 이상이면 system 사이를 늘려 세로 맞춤, 아니면 위에 붙임.

### 15.4 줄 첫머리와 변경 기호

- 줄 첫머리: clef, key(샵·플랫이 있을 때), time은 첫 system이나 바뀔 때만 (지금과 같음).
- **courtesy**: 새 system 첫머리에서 key·time이 바뀌면 앞 system 끝(마지막 세로줄 뒤)에 미리 표시. clef가 바뀌면 앞 system 끝 세로줄 **앞**에 작은 clef.
- 마디 경계의 clef 변경은 앞 마디 끝, 세로줄 앞 (지금은 새 마디 머리 — O17을 고친다). 마디 안 변경은 영향 받는 첫 기둥 바로 앞 (지금과 같음).
- key 변경: 줄어드는 조표는 제자리표로 취소 (VexFlow cancel), 세로줄 모양은 그래프가 말하는 대로.
- time `symbol`: common(C), cut(¢). `hidden` meter·key는 그리지 않는다.
- C clef(alto, tenor), 옥타브 clef(treble 8vb 등)는 그래프 `line`·`octave`대로.

### 15.5 인쇄 줄바꿈·페이지 나눔

- **줄바꿈 DP** (Knuth–Plass 모양): 마디 경계 i에서 j까지를 한 system으로 둘 때의 비용 = `100 × (stretch − 1.15)²` (stretch = W / 자연 폭, 자연 폭은 4분음표 ideal = 4.0 sp), 1마디 system +50 (피할 수 없으면 제외), system당 마디 1–6. 총비용 최소, 동점이면 더 이른 나눔. 마지막 system은 ragged 허용(stretch < 1이면 비용 0).
- `respectSourceBreaks`(기본 false): true면 그래프 `Measure.layout.newSystem/newPage`를 강제 나눔으로. 들여온 악보의 줄바꿈은 그 악보의 판형에 맞춘 것이라 기본으로 따르지 않는다.
- **페이지 나눔**: system을 쪼개지 않는다. 앞에서부터 채우되, 마지막 페이지에 system이 하나뿐이고 앞 페이지에서 하나를 넘겨 받아도 두 페이지가 넘치지 않으면 넘긴다.
- **제목 영역**: 첫 페이지 위에 제목(가운데), 작곡가(오른쪽), 첫 tempo는 첫 system 위. 둘째 페이지부터 페이지 번호.
- 여러 part면 첫 system에 part 이름.

### 15.6 마디 폭의 한계

- 최소: rod의 합 (§9.3). 이보다 좁게 그리지 않는다.
- 최대: 화면에서 N마디를 폭에 맞추느라 stretch가 2.5를 넘으면(아주 성긴 줄) 그대로 늘린다 — 연습 화면의 마디 위치 안정성이 더 중요하다 (지금과 같음). 인쇄는 DP가 stretch를 벌점으로 막는다.

---

## 16. 화면·연습 통합

### 16.1 ScoreView의 스위치

- prop `renderer` (`'legacy'` | `'engrave'`), 기본값은 `PPP.renderer`(기본 `'legacy'`, §25 — **G4f-2 flip부터 `'engrave'`**, §43). `paint()`는 renderer에 따라 옛 `draw()` 또는 새 pipeline을 부른다. **옛 `draw()`·`buildVoice()`·`sync()`는 고치지 않는다** (되돌리기 경로, A45).
- 새 `drawKey`: 그래프 hash(또는 projected면 Score 내용 hash) + layoutConfig hash + semanticConfig. `score.id`만 보는 지금의 한계(§4.4)를 없앤다.

### 16.2 판각과 하이라이트를 나눈다

| 일 | 언제 | 비용 |
| --- | --- | --- |
| RenderSource + plan | 곡을 열 때, 그래프가 바뀔 때 | 곡당 한 번 (캐시: 그래프 hash) |
| layout | config(창, 폭, 확대, 안내 글자, 기호 보이기)가 바뀔 때 | 캐시 (LRU 8개: plan hash + config) |
| SVG | layout이 바뀔 때 | 창·system 단위 |
| sync | 부모가 다시 그릴 때 (재생 중 40 ms마다) | **바뀐 요소만** |

**새 `sync()`**: event를 `absStart`로 정렬한 배열과 이전 프레임의 켜진 집합을 들고, 이진 탐색으로 지금 울리는 event를 찾아 **켜짐이 바뀐 요소만** class를 토글한다 (O(log n + 바뀐 수)). 손 필터·숨김 계획·틀린 음 목록이 바뀐 프레임에만 전체를 다시 계산한다. MIDI 이벤트마다 판각하지 않는다.

### 16.3 캐시와 미리 계산

- 가까이 보기: 창 k를 그린 뒤 idle 시간(`requestIdleCallback`, 없으면 `setTimeout 0`)에 창 k+1의 layout과 SVG를 미리 만든다 → 페이지 넘김은 DOM 교체.
- 전곡 보기: system 단위로 나눠 한 조각 ≤ 12 ms씩 그린다 (time slicing). 현재 마디가 있는 system부터 그린다. 재생 UI가 50 ms 넘게 막히지 않는다 (long task 0).
- glyph는 `<symbol>`/`<use>`로 한 번만 정의한다 (VexFlow는 glyph마다 path를 통째로 쓴다 — 전곡 SVG 2.1 MB의 주원인으로 보이며, G4b에서 측정해 확인한다).

### 16.4 DOM 계약 (기존 테스트와 `followStaff`가 읽는 것)

| 계약 | 새 렌더러 |
| --- | --- |
| `g.ppp-note[data-onset]` (값 `마디\|박\|staff`), `data-rest="1"` | event(화음) 하나에 그룹 하나. 추가 `data-ev="<그래프 event ID>"` |
| `g.ppp-stave[data-m][data-staff][data-begin][data-end][data-volta][data-time]` | 같음 |
| `g.ppp-tuplet` | tuplet 숫자·괄호 그룹 |
| VexFlow class (`.vf-notehead`, `.vf-stem`, `.vf-stavetie`, `.vf-clef`) | 음은 VexFlow가 그리므로 유지. tie는 PPP 곡선 — `class="vf-stavetie"`를 함께 단다 |
| `.ppp-now`, 루프 상자, 재생선, `.ppp-ann`, `data-ppp-row` | 같음 (PracticeMap에서) |
| `svg.__ppp = {page, pad, rows, tight, begin, bars}` | EngravedScore에서 계산해 같은 모양. 추가 `svg.__ppp.engraved`(hash, ledger 요약) |
| `ppp-on/bad/off/ghost` class | 같음 |

계약을 지키므로 `engraving`, `alignment`, `follow`, `interactions`, `layout`, `musicxml`, `coach`, `import` suite는 `renderer='engrave'`로도 돈다 (A30). 바꿔야 하는 단언은 옛 렌더러의 결함을 고정한 것뿐이다 — 추론 악보의 마디 안 tie 0개(G4-U2), "tuplet 2개"처럼 옛 묶음 규칙에 기댄 수. 바꾼 단언은 이유와 함께 G04 구현 기록에 남긴다.

### 16.5 확대·크기 바꾸기·태블릿

- 좌표는 page 단위이고 viewBox로 줄인다 (지금과 같음). **같은 breakpoint 안에서 창 크기를 바꾸면 다시 배치하지 않는다.** 720 px를 넘나들면 N이 바뀌고 layout 캐시를 쓴다.
- 확대(가까이 보기, 0.7–1.6)는 `mW`를 바꾸는 config 변경 → layout (캐시).
- 포인터: 지금 처리기를 그대로 (세로 끌기는 스크롤, 가로 끌기는 선택, `touch-action: pan-y`). hit-test는 PracticeMap (지금 `_map`과 같은 모양).

### 16.6 연습 overlay

현재 마디 wash, 루프 상자(줄을 넘으면 첫 system만, 지금과 같음), 재생선, 약한 마디 음영은 PracticeMap으로 둔다. 안내 글자는 layout 객체(아래 skyline에 들어감) — 켜고 끄면 다시 배치 (지금도 `drawKey`에 있음). 손 필터·기억 모드·리듬만 보기는 class로 — **다시 배치하지 않는다** (지금 설계의 핵심 약속, 9198–9207).

### 16.7 판각 실패

- production: 새 pipeline이 throw하면 그 곡은 옛 렌더러로 그리고, `console.warn('[ppp] engrave fallback', code)`와 세션 카운터를 남긴다. 화면을 비우지 않는다.
- 테스트·개발(`PPP.strictEngrave = true`, `?renderer=engrave&strict=1`): throw한다.
- 코퍼스에서 fallback 0이 acceptance다 (A47). G1-D13("몰래 되돌아가지 않는다")은 파일을 쓰는 writer의 원칙이다. 화면은 비면 안 되므로 되돌아가되, **숨기지 않고 센다**.

### 16.8 바뀌지 않는 것

Score, `PianoScore`, 연습 판정(`wrongNotes`, follow), 운지 모델, falling notes, keyboard, 코치. G4 on/off에서 Score와 재생 이벤트는 바이트 동일하다 (A16).

---

## 17. Print / PDF

### 17.1 G4가 하는 것 (G4-U3 권고 A)

- 악보 화면에 **"인쇄 / PDF로 저장"** 명령. 인쇄 config로 layout을 만들고, 페이지마다 mm 크기의 `<svg>`를 숨은 인쇄 컨테이너에 넣고, `@media print`로 그 컨테이너만 보이게 하고(`@page { size: A4; margin: 0 }`), `window.print()`를 부른다. 브라우저의 "PDF로 저장"이 벡터 PDF를 만든다.
- 음악 glyph는 SVG path라 PDF에서도 벡터다. 글자는 브라우저가 웹 글꼴을 PDF에 넣는다. 인쇄 전에 `document.fonts.ready`를 기다린다.
- 인쇄 출력에 래스터(`<image>`, `<canvas>`)가 없다 (자동 검사).

### 17.2 하지 않는 것

- 서버 판각기(MuseScore CLI 등), MusicXML → 외부 판각기 (§7.3 C를 버림).
- 클라이언트 PDF 라이브러리로 파일을 직접 만들기(svg2pdf.js + jsPDF, 글꼴 직접 넣기) — G4-U3의 B. 권고하지 않는다.
- 전문 판각기로 가고 싶은 사용자는 이미 있는 MusicXML 내보내기를 쓴다 (G1 exporter).

### 17.3 결정론과 원천

- 인쇄 EngravedScore(페이지 수, 페이지별 system, 모든 좌표)의 hash는 결정론적이다 (A38). PDF 바이트는 브라우저마다 다르므로 비교하지 않는다.
- 화면과 인쇄는 같은 plan이다. 인쇄에서 다른 것은 config뿐이다: 페이지, 줄바꿈 규칙, 마디 번호 위치, 여러 마디 쉼표 묶음, 안내 글자·연습 overlay 없음 (A40이 ledger 동일성으로 검사).

---

## 18. 음악 글꼴과 glyph

### 18.1 지금

- `setMusicFont` 호출이 없다 → VexFlow 기본 스택 **Bravura, Gonville, Custom** (부록 A-3). glyph는 글꼴 윤곽 데이터를 **SVG path로** 그린다. 웹 글꼴이 필요 없고 플랫폼마다 같다.
- 글자는 SVG `<text>`: Instrument Serif(제목·작곡가), JetBrains Mono(마디 번호, 안내 글자), Figtree(코드명), Noto Music / Segoe UI Symbol(♩, 𝄋, 𝄌). Google Fonts에서 (App 49). pedal `∗`, `Ped.`는 기울인 serif 글자.

### 18.2 결정 (G4-D8)

- **음악 기호는 전부 SMuFL glyph** (VexFlow를 통해 Bravura): pedal(`keyboardPedalPed`, `keyboardPedalUp`), segno·coda, 메트로놈 음표, 셈여림 글자, 운지 숫자, tuplet 숫자, 8va·15ma, fermata, articulation, 꾸밈 기호. Unicode 음악 글자와 시스템 글꼴을 쓰지 않는다 (O14를 없앤다).
- 기준 글꼴은 Bravura 하나. 스택의 Gonville로 떨어지면 진단 `GLYPH_FALLBACK` — 코퍼스에서 0 (A-criterion 안에서 검사).
- plan 단계에서 쓰일 glyph 코드를 모두 글꼴 표와 대조한다. 없으면 대체 glyph + 진단 `MISSING_GLYPH` — 코퍼스에서 0.

### 18.3 글자

- 역할 셋으로 제한: serif(제목·말·tempo 말), sans(코드명), mono(마디 번호·안내 글자). 글꼴은 지금처럼 Google Fonts에서 받는다. **이 세션은 글꼴 파일을 추가하지 않는다.**
- **layout은 글자 폭을 `engrave/metrics-text.js` 표에서 읽는다** — 쓰는 글꼴·글자(Latin-1, ♯♭, 숫자)의 advance width 표. 표는 G4e(또는 첫 글자 배치가 필요한 G4d)에서 도구 `tests/engrave/tools/make-text-metrics.js`가 글꼴 파일에서 한 번 만들어 커밋한다 (표만, 글꼴 바이너리는 아님). 표에 없는 글자는 0.6 em + 진단.
- 크기는 sp 단위: 셈여림 glyph 2.5 sp, 운지 1.4 sp, 코드명 1.4 sp, 가사 1.3 sp, 제목 2.6 sp. 확대와 함께 커진다.
- 브라우저의 실제 글자 폭과 표의 차이는 G4e의 브라우저 검사(허용 8 %)로 잰다. 글꼴이 늦게 오거나 안 와도 **기하는 같다** (표를 쓰므로). 모양만 달라진다.

---

## 19. 성능 예산

### 19.1 기준선 (이 세션, 부록 A-2)

같은 PC, headless Chrome, 1600×1000, 곡은 course 곡처럼 열었다. "프레임"은 `beat`만 바꾼 `setState` 한 번의 앱 전체 비용(React 렌더 + `sync`).

| 곡 | 마디 | 음 | 곡 열기 (가까이) | 페이지 넘김 중앙/최대 | 프레임 (가까이) | 전곡 판각 | 전곡 SVG | 프레임 (전곡) 중앙/최대 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| beyer/030 | 16 | 94 | 83 ms | 15.6 / 19.2 ms | 3.3 ms | 23 ms | 117 KB | 3.3 / 6.0 ms |
| hymns/amazing-grace | 17 | 135 | 90 ms | 18.0 / 18.1 ms | 3.3 ms | 32 ms | 181 KB | 2.9 / 7.0 ms |
| burgmuller25/021 | 33 | 396 | 102 ms | 22.6 / 28.7 ms | 3.1 ms | 79 ms | 828 KB | 5.6 / 12.1 ms |
| czerny849/001 | 32 | 578 | 90 ms | 22.2 / 29.4 ms | 3.9 ms | 90 ms | 725 KB | 6.5 / 13.3 ms |
| sonatina/013 | 86 | 1,326 | 109 ms | 20.9 / 39.6 ms | 4.0 ms | 184 ms | 2,182 KB | 13.0 / 17.8 ms |
| sonatina/016 | 92 | 1,565 | 90 ms | 23.7 / 30.1 ms | 4.7 ms | 190 ms | 1,894 KB | 14.4 / 29.0 ms |
| sonatina/020 | 158 | 1,776 | 120 ms | 19.1 / 24.8 ms | 7.5 ms | 249 ms | 2,154 KB | 13.9 / 23.3 ms |

읽을 점: 가까이 보기 페이지 넘김은 20 ms 안팎, 전곡 판각은 음 수에 거의 비례(약 0.14 ms/음), 전곡 보기의 프레임 비용은 음 수에 비례한다(`sync`가 모든 음을 훑음). 40 ms 틱에서 긴 곡의 전곡 보기는 프레임의 1/3–3/4를 쓴다.

### 19.2 예산 (G4 renderer 자신의 시간, 같은 PC, 계측은 §21.6의 perf 도구)

| # | 무엇 | 예산 | 근거 |
| --- | --- | --- | --- |
| B1 | plan (가장 긴 코퍼스 곡) | ≤ 60 ms, 그래프당 한 번 | import(최대 90 ms)보다 작게 |
| B2 | 가까이 보기 창(4마디) layout + SVG, 캐시 없음 | p95 ≤ 25 ms | 기준선 페이지 넘김 중앙 16–24 ms를 넘지 않게 |
| B3 | 가까이 보기 페이지 넘김, 미리 계산 적중 | p95 ≤ 8 ms | DOM 교체만 |
| B4 | 전곡: 첫 화면(현재 system 포함 3 system) | ≤ 100 ms | 기준선 곡 열기와 같은 수준 |
| B5 | 전곡: 전체 완료 | ≤ 1.2 × 기준선 (sonatina/020 ≤ 300 ms), 조각당 ≤ 12 ms, long task 0 | 판각할 것이 늘어도(beam·기호) 체감 지연은 줄임 |
| B6 | `sync` (하이라이트만) | p95 ≤ 1 ms, **곡 길이와 무관**; 프레임당 만지는 요소 수 ≤ (켜짐이 바뀐 수) | O(n) → O(바뀐 수). 테스트는 시간보다 결정론적인 "만진 요소 수"로 (M22) |
| B7 | 창 크기 바꾸기 (같은 breakpoint) | layout 0회 | viewBox |
| B8 | 인쇄 layout (가장 긴 곡) | ≤ 2 s | 사용자가 명령을 누르고 기다리는 일 |
| B9 | 전곡 SVG 크기 | ≤ 0.5 × 기준선 | `<symbol>`/`<use>` |

- 태블릿: CPU 4× 감속(puppeteer `Emulation.setCPUThrottlingRate`)에서 B2 ≤ 80 ms, B6 ≤ 3 ms를 G4f에서 확인한다. 실제 태블릿 측정은 사용자 기기가 있으면 한 번.
- 예산은 CI가 아니라 로컬 perf 도구로 판정한다 (시간은 기기에 따라 흔들린다). CI는 결정론적인 대리 지표(만진 요소 수, SVG 바이트, 객체 수)를 본다.

---

## 20. 결정론

같은 ScoreGraph + 같은 config → **바이트 동일한 EngravedScore**(canonical JSON)와 hash.

| 비결정 원천 | 대책 |
| --- | --- |
| DOM 측정 (`getBBox`, `getComputedTextLength`, `measureText`) | layout 모듈에서 금지. viewBox는 EngravedScore의 범위로. 정적 검사(A29): `engrave/`의 `svg.js` 밖에서 이 이름이 나오면 실패 |
| 글꼴 | 음악 glyph는 윤곽 데이터, 글자는 표 (§18) |
| VexFlow 버전 | `vendor/vexflow-4.2.3.js` sha256 고정, 테스트가 확인. CDN을 쓰지 않는다 |
| 순서 | 모든 배열을 그래프 순서로 정렬. `Map`/`Set` 순회는 정렬된 입력에서만. 동점은 그래프 ID 번호로 |
| 부동소수 | 간격은 정렬된 구간의 선형식으로 정확히 풀고, 합산 순서 고정. 객체 좌표는 0.01 sp로 반올림해 저장. `Math.pow` 등 초월함수의 마지막 비트 차이는 반올림이 흡수 — Windows Node, Linux Node(CI), Chrome을 비교해 확인 (A27, A28) |
| 시간·난수 | `Date`, `Math.random`, 벽시계 없음. 캐시 키는 내용 hash |
| locale | 숫자 포맷에 locale 함수를 쓰지 않는다 |
| 줄·페이지 나눔 | 정수 결정, DP 동점은 더 이른 나눔 |
| 충돌 해소 | (x, 그래프 순서)로 순서가 정해진 배치 |

검사: 3번 실행, fixture 순서 뒤집기, Node(Windows)와 Node(Linux CI), Node와 headless Chrome에서 hash가 같다 (A27, A28).

---

## 21. Benchmark 전략

(G4-D12) 사람이 매번 60개 악보를 보지 않아도 되게 네 층으로 나눈다. L1–L3은 Node에서 돌고 **CI gate에 들어간다**. puppeteer가 필요한 것은 로컬 도구다 (지금 브라우저 suite와 같은 처지).

### 21.1 L1 — 의미 소비 (구조, 자동)

plan의 ledger와 EngravedScore의 `refs`를 대조한다.

| metric | 뜻 | 목표 |
| --- | --- | --- |
| `eg.ledger.silent` | ledger에 없는 그래프 기보 객체 수 | 0 |
| `eg.ledger.deferred` | `deferred` 코드별 수 | 허용 목록 안 (cross-staff 화음·beam, tab, 3단 중첩, grace-after, stem double) |
| `eg.ledger.drawn_missing` | ledger는 `drawn`인데 EngravedScore에 객체가 없음 | 0 |
| `eg.beam.graph_drawn_ratio`, `eg.beam.members_exact`, `eg.beam.derived_in_beamed_vm`, `eg.beam.orphan` | §11.3 | 1, 1, 0, 0 |
| `eg.tuplet.drawn_ratio`, `eg.tuplet.show_ok`, `eg.tuplet.suppressed_drawn` | §12.4 | 1, 1, 0 |
| `eg.tie.drawn_ratio` | tie마다 곡선(줄 넘김이면 반쪽 둘) | 1 |
| `eg.slur.pair_exact` | slur 곡선의 끝 event가 그래프 from/to와 같음 | 1 |
| `eg.mark.drawn_ratio.<kind>` | articulation, 꾸밈 기호, fermata, 운지, 셈여림, hairpin, pedal, ottava, words, tempo, jump, 코드명, 가사, glissando, arpeggio, grace | 1 (config가 끈 종류 제외) |
| `eg.event.multiset_equal` | 그려진 event의 (ID, m, at, dur, 적힌 음) 다중집합 = plan | 참 |
| `eg.staff.assignment_exact` | 그려진 head의 staff = 그래프 head staff | 1 |
| `eg.graph.unchanged` | plan·layout 전후 그래프 deep-equal | 참 |
| `eg.source.agree` | RenderSource가 쓴 그래프가 Score와 일치 | 참 (아니면 projected로 떨어졌음을 기록) |

### 21.2 L2 — 기하 metric (자동)

EngravedScore의 상자·곡선으로.

| metric | 목표 |
| --- | --- |
| `eg.clip.count` (페이지 밖) | 0 |
| `eg.overlap.head_head` (다른 event, 같은 staff; 병합 제외) | 0 |
| `eg.overlap.acc` (임시표 대 머리·stem·임시표·덧줄), `eg.overlap.dot` | 0 |
| `eg.overlap.text` (글자 대 음 요소), `eg.overlap.text_text` | 0 |
| `eg.overlap.mark_mark` (기호끼리) | 0 |
| `eg.system.overflow` (system 폭 초과), `eg.staff.overlap`, `eg.system.overlap` | 0 |
| `eg.spacing.rod_violations` | 0 |
| `eg.spacing.monotonic_violations` (한 system 안에서 긴 Δ가 짧은 Δ보다 좁음, rod가 강제한 경우 제외) | 0 |
| `eg.beam.slope_max`, `eg.stem.short` | ≤ 0.25, 0 |
| `eg.curve.endpoint_err_max` (tie 끝과 머리의 거리) | ≤ 0.5 sp |
| `eg.curve.hits` (곡선 표본이 안쪽 음표머리·stem 상자를 지남) | slur의 ≤ 1 %, 전부 진단 목록에 |
| `eg.voice.stem_policy_violations`, `eg.rest.overlap` | 0 |
| `eg.systems.one_bar` (피할 수 있었던 1마디 system) | 0 |
| `eg.layout.far_placements`, `eg.layout.hard_violations` | 기록, 0 |
| `eg.glyph.fallback`, `eg.glyph.missing` | 0 |

**임계값의 근거**: hard 제약(§10.3)은 정의상 0이다. 판각에서 "조금 겹침"은 허용하지 않는다. 곡선 1 %는 slur 회피가 휴리스틱이라 둔 여유이며, M-H1에서 보이는 결함이면 0으로 조인다. 기울기 0.25는 VexFlow 기본값과 판각 관례(한 묶음에서 1 sp 안팎).

### 21.3 L3 — 결정론적 기하 snapshot

- E fixture와 R 코퍼스 발췌마다 EngravedScore canonical JSON을 golden으로 커밋한다 (`tests/engrave/golden/<id>.<mode>.engr.json` + hash). 비교 도구가 차이를 **분류**한다: `LEDGER_CHANGE`(그린 것이 달라짐 — 리뷰 필요), `GEOMETRY_ONLY`(좌표만 — L1·L2가 나빠지지 않으면 bless 가능), `SERIALIZATION_ONLY`. G0 golden의 분류 규칙과 같은 정신이다. **이 세션은 golden을 만들거나 bless하지 않는다.**
- SVG snapshot(픽셀)은 흔들리므로 CI에 넣지 않는다. 로컬 도구가 고정 Chrome에서 E fixture 10개 정도를 PNG로 찍어 차이를 보여 준다 (참고용).

### 21.4 L4 — 사람 평가 (milestone만)

두 번뿐: **M-H1**(G4d 끝, 진단용 — 결과로 α·배치 상수를 조정), **M-H2**(flip 전, 합격 판정). 세트와 절차는 §22.4.

### 21.5 명령과 CI

```
npm run test:engrave                                   # node --test tests/engrave/**  (L1–L3, E fixture) — CI gate
node tests/engrave/tools/bench.js run --suite r        # R 코퍼스 L1+L2 요약 → tests/engrave/out/ (gitignored)
node tests/engrave/tools/bench.js check --suite r      # baseline 대비, 퇴행이면 exit 1 — CI gate
node tests/engrave/tools/bench.js run --suite x        # 녹음·G3a·MIDI·OMR·projected (생성, 커밋 안 함)
node tests/engrave/tools/mutation.js                   # §23 — nightly
node tests/engrave/tools/browser-parity.js             # Node 대 Chrome hash (로컬, puppeteer)
node tests/engrave/tools/perf.js                       # §19 (로컬)
node tests/engrave/tools/legacy-geometry.js            # 옛 렌더러의 SVG에서 잴 수 있는 L1·L2 (로컬, 비교용)
```

- `.github/workflows/bench.yml` gate에 `npm run test:engrave`와 `bench.js check --suite r`을 더한다 (Node만, npm install 없음 — vendored VexFlow라 가능).
- **옛 렌더러와 비교**: `legacy-geometry.js`가 옛 SVG에서 셀 수 있는 것(음표머리 겹침, 잘림, beam·tuplet·tie 수)을 같은 이름의 metric으로 낸다. A43은 "G4가 모든 범주에서 옛 렌더러 이상"이다.

### 21.6 perf 도구

이 세션의 측정 스크립트(부록 A-2)를 `tests/engrave/tools/perf.js`로 커밋한다: 곡을 course 곡처럼 열고, renderer별로 plan·layout·svg·sync를 `performance.now`로 재고, CPU 감속 옵션을 둔다.

---

## 22. G4 reference corpus

판각 평가는 **의미가 맞는 입력**으로 해야 한다. A36에서 녹음 경로의 박자·조 오류(10 발췌)가 참조와의 비교를 오염시켰다. G4는 그 교훈대로 네 세트를 나눈다. **A36 세트(`tests/bench/human/g3/`)는 건드리지 않는다.**

### 22.1 E — 판각 fixture (합성, 커밋)

`tests/engrave/fixtures/E01–E40.musicxml`, 손으로 쓴 작은 파일 (라이선스 문제 없음). 한 파일에 한 주제:

| 범위 | 주제 |
| --- | --- |
| E01–E03 | beam: 4/4·3/4·2/2 기본, 6/8·12/8 + secondary break·hook, 쉼표 낀 beam |
| E04–E07 | tuplet: 괄호/숫자만/숫자 없음/`printed:false`, 중첩 2단, 쉼표 포함, **1-음 tuplet 사슬**(writer 모양) |
| E08–E11 | tie: 부분 화음, 세로줄·system 넘김, 성부 바뀜; slur: 겹침, system 넘김, 쉼표에 걸림 |
| E12–E13 | 두 성부: 2도·unison·점 다른 unison, 쉼표 (같은 길이 병합, 다른 길이) |
| E14 | 꾸밈음: acciaccatura, appoggiatura 묶음, 임시표 있는 주 음 |
| E15 | articulation 쌓기 + slur 바깥 |
| E16 | 셈여림 + hairpin, 두 보표 사이, system 넘김 |
| E17 | pedal: sign, line, change, 녹음 경로 모양 |
| E18 | ottava 8va/8vb/15ma, system 넘김 |
| E19 | clef: 마디 안, 마디 경계, C clef, 옥타브 clef |
| E20 | key 변경 + 취소 + courtesy |
| E21 | meter 변경, common/cut, hidden meter |
| E22 | 반복, volta, segno·coda·D.S.·Fine |
| E23 | 운지 화음 쌓기, 위·아래 staff |
| E24 | 가사 기본 |
| E25 | 코드명 빽빽 |
| E26 | cross-staff event와 화음 (`deferred` 확인) |
| E27 | 타악기 최소 |
| E28 | 여러 마디 쉼표 (화면 대 인쇄) |
| E29 | 마디 쉼표 3/4, 6/8 가운데 |
| E30 | hidden·cue event |
| E31–E32 | notehead 모양, 주의·괄호 임시표 |
| E33 | 임시표 많은 화음 (지그재그 열) |
| E34 | 덧줄 긴 음들 |
| E35 | 성악 + 피아노 3 staff |
| E36 | 못갖춘마디, implicit 마디 |
| E37 | 긴 곡 (성능·결정론) |
| E38 | **G3 off 녹음 모양**: beam 없음, 1-음 tuplet, 64분 쉼표, 마디 안 추론 tie, pedal change |
| E39 | **G3a 모양**: 그래프 beam, 논리 tuplet, 두 성부 |
| E40 | arpeggio 방향·non, glissando |

### 22.2 R — reference 코퍼스 (커밋된 카탈로그, CLEAN_INPUT)

- 원천: 커밋된 카탈로그·교재 MusicXML/MXL. 이것은 **편집자의 기보가 곧 의미**라서 박자·조·음이 정의상 맞다 — 업스트림(G3·녹음) 오류가 섞일 수 없다.
- 자격: `tests/bench/corpus/provenance.json`에서 라이선스가 확인된 파일만. **격리된 15개(Czerny 299 전부, Burgmüller 1·2·4·7·18) 제외.** `tests/bench/corpus/references.json`의 `holdout: true`인 파일(312 중 52)도 **R에서 뺀다** — G0 hold-out을 다른 세트에 쓰지 않아 독립성을 지키고, hold-out 파일의 값을 파일별로 싣지 않는 G0 규칙과 부딪히지 않게 한다.
- 구성 (파일 전체, L1·L2·L3용, 약 60 파일, 선택은 manifest `tests/engrave/corpus.json`에 고정 — seed와 규칙을 함께 적는다):

| 층 | 파일 | 주로 재는 것 |
| --- | --- | --- |
| hymns | 10 | SATB 4성부 두 보표 (다성부 staff-마디 3,350) |
| beyer | 10 | 기본 beam, 반복·volta |
| czerny599 | 10 | secondary break(738), articulation |
| czerny849 | 8 | 셋잇단(1,002), 운지, 꾸밈음, slur, ottava |
| sonatina | 10 | 빽빽한 기호: slur 2,090, 셈여림 566, hairpin 220, 운지 3,632, 꾸밈음 142 |
| burgmuller25 (격리 제외) | 7 | tuplet 표시 옵션, 가사 1, pedal |
| hanon | 3 | 긴 beam 사슬, 운지 |
| catalog 위 3 | 3 | Für Elise, Gymnopédie, Happy Birthday |

### 22.3 X — 견고성 세트 (생성, 커밋 안 함)

사람이 보지 않고 L1·L2만: G0 core 녹음 출력의 그래프(G3 off, `toMusicXml`의 `graph`), 같은 입력의 G3a 그래프(테스트 안에서만 `professional:'on'`), 여닫히는 MIDI fixture(`.mid` 4음 미만은 열리지 않음, R4), OMR fixture, 저장 상태 fixture의 projected 그래프. 목표: 예외 0, fallback 0, L1 silent 0, L2 hard 0. 녹음 경로의 박자·조 오류는 판각 문제가 아니므로 여기서 품질로 판정하지 않는다.

### 22.4 H — 사람 평가 세트 (milestone)

- R에서 뽑은 **16 발췌 × 8마디**, 층별: 다성부(찬송가) 3, 셋잇단 3, 빽빽한 기호(소나티네) 4, 기본 교재(바이엘·체르니 599) 3, 꾸밈음·8va 2, 반복 구조 1. **새 seed**, 선택 규칙과 seed를 manifest에 적는다.
- 판본: **X/Y = 옛 렌더러 대 G4 렌더러**, 같은 Score/그래프에서. 발췌마다 X·Y 무작위, 블라인드 라벨(G3-F5처럼 불투명 라벨, 열쇠는 따로). 선택: C = 같은 MusicXML을 MuseScore 4로 그린 그림(사용자가 원할 때만, 필수 아님 — G3-U10과 같이 MuseScore 설치를 요구하지 않는다).
- 보여 주는 방법: 로컬 도구 `tests/engrave/tools/review-build.js`가 두 판본을 앱 렌더러로 그려 SVG와 HTML 색인을 만든다 (서버는 `tests/`를 서빙하지 않으므로 로컬 파일로 연다). 결과 JSON을 커밋한다 (A36과 같음), 그림은 다시 만들 수 있으므로 gitignored.
- 축: 읽기 쉬움, **기보가 틀려 보임**(있다/없다), 간격, 기호 배치, 전체; 절대 평가 "이걸로 연습하겠다: yes / fix / no".
- 합격 (M-H2): 전체 축에서 G4 ≥ 옛 렌더러가 16 중 14 이상; "기보가 틀려 보임"이 G4에만 있는 발췌 0; G4의 yes+fix ≥ 옛 렌더러의 yes+fix. 평가자 1명이라는 한계는 결과에 적는다 (G03 §21.4.5와 같음).
- 근거: A36의 18/20(90 %)과 같은 수준의 요구(14/16 = 87.5 %). 판각은 같은 의미를 두 방식으로 그린 비교라 A36보다 차이가 선명할 것으로 본다.

---

## 23. Mutation suite

`tests/engrave/tools/mutation.js`: `engrave/` 사본(임시 디렉터리)에 고정된 anchor 편집 하나를 넣고 L1–L3을 돌려 **이름 붙은 metric이 REGRESSION**인지 본다. anchor는 CRLF를 LF로 정규화해 맞춘다 (G2 `MD-TEMPO-LAST-ONLY`의 교훈). 편집 뒤 출력이 바이트 동일하면 그 mutation은 죽은 것이므로 실패다 (G3 M3의 교훈).

| # | 결함 | 잡아야 할 metric |
| --- | --- | --- |
| M1 | 그래프 beam을 무시하고 전부 파생 | `eg.beam.graph_drawn_ratio`, `members_exact` |
| M2 | 파생 beam 끔 | `eg.mark`/beam 수 (E38), L3 |
| M3 | 두 성부의 stem을 뒤집음 | `eg.voice.stem_policy_violations` |
| M4 | tuplet 괄호·숫자를 그리지 않음 | `eg.tuplet.drawn_ratio` |
| M5 | `show.number:'none'`을 무시 | `eg.tuplet.show_ok` |
| M6 | 임시표 x를 머리 쪽으로 0.8 sp | `eg.overlap.acc` |
| M7 | 간격 u를 0으로 (rod만) | `eg.spacing.monotonic_violations` |
| M8 | `place()`의 skyline을 끔 (기호가 기본 위치) | `eg.overlap.text`, `mark_mark` |
| M9 | 줄바꿈 하나를 없앰 (system 넘침) | `eg.system.overflow` |
| M10 | 마지막 system을 페이지 밖으로 | `eg.clip.count` |
| M11 | 쉼표 하나를 두 번 그림 | `eg.event.multiset_equal` |
| M12 | tie를 그리지 않음 (추론 악보 마디 안 규칙을 다시 넣음) | `eg.tie.drawn_ratio` (U2가 "그린다"일 때) |
| M13 | 셈여림을 음표머리 높이에 | `eg.overlap.text` |
| M14 | system을 넘는 tie를 버림 | `eg.tie.drawn_ratio` |
| M15 | slur를 start→다음 stop으로 다시 짝지음 | `eg.slur.pair_exact` (E10) |
| M16 | 꾸밈음을 보통 음처럼 시간 기둥에 | `eg.event.multiset_equal`, L3 |
| M17 | 배치 순서에 비결정 (삽입 순서를 섞음) | `eg.determinism.hash` (3회 비교) |
| M18 | layout에서 `getComputedTextLength` 사용 | A29 정적 검사 |
| M19 | pedal change를 뗌으로만 | `eg.mark.drawn_ratio.pedal` (change 객체) |
| M20 | 8va 안의 음을 울리는 높이에 그림 | L3 + `eg.event.multiset_equal`(적힌 음) |
| M21 | 렌더러가 음높이로 staff를 고름 (손 발명) | `eg.staff.assignment_exact` |
| M22 | `sync`가 매 프레임 전체를 훑음 | "만진 요소 수" 대리 지표 (B6) |
| M23 | articulation 하나를 ledger 없이 건너뜀 | `eg.ledger.silent` |
| M24 | tuplet 괄호가 끝의 쉼표를 빼고 끝남 | `eg.tuplet.extent_err` |
| M25 | 인쇄에서 system을 두 페이지에 쪼갬 | 인쇄 L2 (`eg.page.split_system`) |
| N1, N2 | no-op 대조군 (주석 바꾸기, 독립 문장 순서 바꾸기) | 바이트 동일해야 함 |

---

## 24. Acceptance criteria

"코퍼스" = E fixture 40 + R 코퍼스(§22.2) + X 세트(§22.3). "브라우저 suite" = §4.8의 puppeteer suite. 판정 단계는 §27.

### 24.1 의미 충실 (A1–A12)

| # | 기준 | 판정 |
| --- | --- | --- |
| A1 | 지원 집합의 모든 그래프 기보 객체가 ledger에 정확히 한 번, status ∈ {drawn, derived, merged, suppressed, deferred, projected-loss}. `eg.ledger.silent = 0`, `eg.ledger.drawn_missing = 0`, `deferred`는 허용 목록 코드만 | L1, 코퍼스 |
| A2 | 그래프 beam마다 멤버가 같은 beam 하나 (`graph_drawn_ratio = members_exact = 1`), secondary break·hook 규칙대로, 그래프 beam이 있는 성부-마디에 파생 0, 근거 없는 beam 0 | L1, E01–E03, R |
| A3 | 파생 beam은 그래프 beam이 없는 성부-마디에만, `pro-beam.groups`의 출력과 정확히 같다. `pro-beam.js`·`meter-grid.js` 바이트 불변 | L1, E38 |
| A4 | printed tuplet마다 §12.1 표대로 숫자·괄호·위치, `printed:false`에 그린 것 0, 중첩 2단 바깥-안쪽 순서, 1-음 tuplet은 G4-U2의 결정대로 | L1+L2, E04–E07 |
| A5 | 모든 그래프 tie가 그려진다: 부분 화음, 세로줄·system 넘김(반쪽 둘), 성부 바뀜. 추론 악보의 마디 안 tie는 G4-U2의 결정대로 | L1, E08–E09, E38 |
| A6 | 모든 그래프 slur가 자기 from·to 사이에: 겹친 slur, 쉼표에 걸린 slur, system 넘김 반쪽 | L1, E10–E11 |
| A7 | articulation, 꾸밈 기호, fermata(음·세로줄), 인쇄 운지, arpeggio(dir·non), 꾸밈음, glissando, notehead 모양, 주의·괄호 임시표가 그래프에 있을 때 그려진다 | L1 `eg.mark.drawn_ratio.*`, E14–E15, E23, E31–E32, E40 |
| A8 | 셈여림, hairpin, words, rehearsal, tempo(말·메트로놈·괄호), 코드명, jump가 그래프 위치에 | L1, E16, E22, E25 |
| A9 | pedal의 시작·끝·**change**가 `mark`(sign/line)대로 보이고, change가 뗌으로 보이지 않는다 | L1, E17 |
| A10 | ottava 괄호가 걸친 event를 정확히 덮고, 그 안의 머리는 적힌 높이에, 15ma, system 넘김 "(8)" | L1+L3, E18 |
| A11 | meter 기호(C, ¢), hidden meter·key 안 그림, key 변경 취소·courtesy, clef(마디 안·경계·C·옥타브), 마디 쉼표 가운데, 인쇄 여러 마디 쉼표 | L1+L2, E19–E21, E28–E29 |
| A12 | 타악기 event는 타악기 staff에 머리 모양대로 (쉼표가 아님), 가사 기본 | L1, E24, E27 |

### 24.2 의미 보존 (A13–A16)

| # | 기준 | 판정 |
| --- | --- | --- |
| A13 | G4는 그래프를 바꾸지 않는다: plan·layout 전후 입력 그래프 deep-equal (`eg.graph.unchanged`) | L1, 코퍼스 |
| A14 | 그려진 event의 (ID, m, at, dur, 적힌 음) 다중집합 = plan = 그래프. system 안 기둥 x가 `at`에 대해 순증가 | L1+L2 |
| A15 | 그려진 head의 staff = 그래프 head staff (`assignment_exact = 1`). 렌더러가 손·staff·성부를 정하는 코드 경로 0 (M21) | L1 |
| A16 | 연습 쪽 불변: 생산자가 만든 Score, `PianoScore` 재생 이벤트, 연습 판정 입력이 renderer legacy/engrave에서 바이트 동일. RenderSource의 link가 울리는 음에서 전단사 (R·X 전부), 아니면 projected로 떨어짐이 기록됨 | 브라우저 도구 + L1 `eg.source.agree` |

### 24.3 기하 (A17–A26)

| # | 기준 | 판정 |
| --- | --- | --- |
| A17 | 잘림 0 (`eg.clip.count`), 화면과 인쇄 | L2, 코퍼스 |
| A18 | 음표머리 겹침 0 (병합 unison 제외) | L2 |
| A19 | 임시표·점 겹침 0 | L2 |
| A20 | 글자 겹침 0 (글자 대 음 요소, 글자 대 글자), 기호끼리 0 | L2 |
| A21 | beam 기울기 ≤ 0.25, 짧은 stem 0, beam이 자기 묶음 머리를 가로지르지 않음 | L2 |
| A22 | tie 끝점 오차 ≤ 0.5 sp, slur 곡선이 안쪽 음 요소를 지나는 비율 ≤ 1 % (전부 진단 목록에) | L2 |
| A23 | rod 위반 0, 간격 단조성 위반 0 | L2 |
| A24 | system 넘침 0, 피할 수 있었던 1마디 system 0, 화면 줄바꿈이 G4-U4(§31: N은 선호 목표, 밀도가 이김)의 규칙대로 | L2 |
| A25 | staff·system 겹침 0, 세로 skyline 충돌 0 | L2 |
| A26 | 다성부 staff-마디에서 stem 규칙 위반 0 (그래프 `display.stem` 또는 성부 순서), 쉼표가 다른 성부 머리와 겹침 0 | L2, E12–E13, R hymns |

### 24.4 결정론 (A27–A29)

| # | 기준 | 판정 |
| --- | --- | --- |
| A27 | 같은 그래프 + config → 같은 EngravedScore hash: 3회, fixture 순서 뒤집기, Windows Node와 Linux CI Node | L3 |
| A28 | Node layout hash = headless Chrome layout hash (코퍼스) | 브라우저 도구 |
| A29 | layout 모듈에 DOM 측정 0 (정적 검사), VexFlow는 vendored·sha256 고정, 판각 중 네트워크 0 | 정적 + L3 |

### 24.5 연습 UI (A30–A34)

| # | 기준 | 판정 |
| --- | --- | --- |
| A30 | 브라우저 suite(engraving, alignment, follow, interactions, layout, musicxml, coach, import)가 `renderer='engrave'`로 통과. 바꾼 단언은 옛 결함을 고정한 것만, 이유와 함께 기록 | 브라우저 |
| A31 | `sync`가 프레임당 만지는 요소 수 ≤ 켜짐이 바뀐 수 (+ 필터 변경 프레임 제외); sonatina/020 전곡에서 p95 ≤ 1 ms | 도구 + perf |
| A32 | 같은 breakpoint 안 창 크기 바꾸기에 layout 0회; 확대는 캐시 적중 시 재배치 없음 | 브라우저 |
| A33 | 테마·종이: 잉크가 테마 변수를 따르고, 어두운 테마 글자 밝기 검사 통과 (`engraving.test.js`의 해당 단언) | 브라우저 |
| A34 | 태블릿: 세로 끌기 스크롤, 가로 끌기 선택, 탭 재생 (`layout.test.js`) 그대로 | 브라우저 |

### 24.6 성능 (A35–A37)

| # | 기준 | 판정 |
| --- | --- | --- |
| A35 | B1–B5 (§19.2) | perf 도구 |
| A36 | B6–B7, B9 | perf 도구 + 대리 지표 |
| A37 | CPU 4× 감속에서 B2 ≤ 80 ms, B6 ≤ 3 ms | perf 도구 |

(G4의 A36은 이 문서의 번호다. G3의 A36(사람 평가)과 다르다.)

### 24.7 인쇄 (A38–A40)

| # | 기준 | 판정 |
| --- | --- | --- |
| A38 | 인쇄 layout: 페이지 크기 SVG, 결정론적 페이지·system 나눔과 hash, 제목 영역, 페이지 번호, 잘림 0, system 쪼개짐 0 | L2+L3 |
| A39 | 브라우저 인쇄 → 벡터 PDF: 래스터 요소 0 (자동), 페이지 수 = layout 페이지 수, 글자·glyph가 벡터 (milestone에 사람이 한 번 확인) | 도구 + 수동 |
| A40 | 화면과 인쇄의 ledger가 같다 (인쇄 전용 차이 — 여러 마디 쉼표 묶음, 안내 글자 없음 — 만 허용 목록) | L1 |

### 24.8 Benchmark·되돌리기·호환 (A41–A48)

| # | 기준 | 판정 |
| --- | --- | --- |
| A41 | `npm run test:engrave`와 `bench.js check --suite r`이 CI gate에서 돈다, 합계 ≤ 90 s | CI |
| A42 | mutation M1–M25 전부 이름 붙은 metric에서 REGRESSION, N1–N2 바이트 동일 | nightly |
| A43 | 옛 렌더러와 잴 수 있는 모든 L1·L2 metric에서 G4 ≥ 옛 렌더러 (범주별) | 도구 |
| A44 | 사람 평가 M-H2 합격 (§22.4) | 사람 |
| A45 | `PPP.renderer = 'legacy'`가 옛 SVG를 바이트 동일하게 되살린다 (옛 코드 불변). flip 전 기본값은 `'legacy'` | 브라우저 |
| A46 | G3 독립: 모든 테스트가 G3 off로 통과, G3a 그래프(X 세트)가 허용 목록 밖 `deferred` 0으로 그려진다, `engrave/`가 `professionalize`를 부르지 않는다 (정적 검사) | L1 + 정적 |
| A47 | 커밋된 import 파일 504개(MusicXML 253, MXL 222, MIDI 29 중 열리는 것) 전부 예외 0, fallback 0 | 도구 |
| A48 | `toScore(fromScore(S)) ≡ S` (toScore가 투영하는 필드, id·sgHead·sgFrom 제외): 504 파일의 Score, core 553 녹음 출력의 `parseMusicXML` Score, 저장 상태 fixture | node --test |

---

## 25. Rollout / rollback

### 25.1 스위치 (G4-D9)

- `PPP.renderer`: `'legacy'`(기본) | `'engrave'`. 개발·테스트용으로 URL `?renderer=engrave`, localStorage `ppp.renderer`. **G4f-2 flip 뒤 (§43, G4-F2-1)**: 기본 `'engrave'`, 되돌리기는 `?renderer=legacy`·localStorage `ppp.renderer = 'legacy'`·`PPP.renderer = 'legacy'`. ScoreView prop `renderer`가 개별 화면을 덮어쓸 수 있다 (썸네일만 먼저 켜는 식의 단계적 확대 가능).
- `PPP.strictEngrave`: 테스트에서 fallback 대신 throw.
- G1 `opts.legacyWriter`, G2 `PPP.legacyImport`와 같은 모양이다: 명시적 스위치, 한 릴리스 동안 옛 경로 유지.

### 25.2 단계

1. G4a–G4e: 기본 `'legacy'`. 새 렌더러는 스위치로만. production 사용자에게 보이는 변화 없음.
2. G4f: A1–A48 판정, M-H2 사람 평가 합격, **사용자 승인** 뒤 기본값을 `'engrave'`로. 배포는 수동이다 (Render, push는 배포하지 않음).
3. 한 릴리스 뒤: 옛 `draw()`·`buildVoice()`·옛 `sync()`·`loadVexFlow`의 CDN 경로 제거 (별도 PR, 옛 경로 제거의 증거는 A45 대신 fallback 카운터 0).

### 25.3 되돌리기

- 즉시: `PPP.renderer = 'legacy'` (또는 기본값 한 줄 되돌림 + 배포).
- 곡 단위 자동: 새 pipeline이 throw하면 그 곡만 옛 렌더러 (§16.7), 카운터로 보임.
- 코드: 모든 G4 코드는 `engrave/`, `vendor/`, `legacy-score.js`의 `fromScore`, 앱의 작은 편집(스위치·생산자의 그래프 보관)에 있다. revert가 국소적이다.

---

## 26. G3와의 관계, 들여온 악보와 옛 악보

### 26.1 G3 (G4-D10)

- **G4는 G3가 켜져 있기를 요구하지 않는다.** G3 off의 그래프(지금 production)가 기본 입력이다. `engrave/`는 `professionalize`를 부르지 않고 G3 flag를 읽지 않는다 (A46).
- G3의 규칙과 겹치는 한 곳 — beam 묶음 — 은 `pro-beam.js`가 이미 내보내는 순수 함수 `groups`를 **그대로 불러** 공유한다 (§11.1). G3 pass는 돌지 않고 G3 파일은 바뀌지 않는다 (A3).
- **G3a가 켜지면**(A36 재평가 통과 뒤): 그래프에 beam·논리 tuplet·성부·staff 이동이 생긴다. G4는 그것을 그대로 그린다 — 파생 beam과 1-음 tuplet 병합은 저절로 꺼진다 (그 성부-마디에 그래프 의미가 있으므로). G3-U10이 정한 A36 재평가("PPP 앱 렌더러로")는 G4 flip 뒤라야 G3a의 beam 이득이 보인다.
- **G3b**(R-reg, perf-voices): 음가·쉼표·성부가 바뀐 그래프일 뿐이다. G4에 따로 할 일 없음.
- G4는 G3 결함을 **타이밍으로 숨기지 않는다.** 1-음 tuplet 병합(G4-U2)은 표시만이고 ledger `merged`로 세며, G3의 `nq.*` metric은 그래프를 재므로 이슈 20을 그대로 본다.
- 판각이 드러내는 G3 쪽 결함(예: G3 off의 64분 쉼표, 이른 release 쉼표)은 G4가 고치지 않는다. G4f 보고에 "판각이 드러낸 업스트림 결함" 목록으로 남긴다.

### 26.2 경로별 기대

| 경로 | 렌더 그래프 | 보이는 것 |
| --- | --- | --- |
| MusicXML·MXL 열기 | live (import door) | 그래프의 모든 의미. 다시 불러오면 G4-U1에 따름 |
| course·카탈로그 곡 | live, 다시 불러와도 refetch | 모든 의미 |
| MIDI 열기 (추론 기보) | live (`fromMidi` 그래프) | G3 off 녹음과 같은 모양: 파생 beam, 1-음 tuplet 처리(U2) |
| 녹음 → 악보, 다시 쓰기 | live `built.graph` + agree | 파생 beam, 1-음 tuplet(U2), 추론 tie(U2), pedal change 표시 |
| 녹음이 카탈로그와 맞음 | 같은 XML을 그래프로 + agree | 카탈로그 곡과 같음 |
| OMR (PDF·사진) | `PdfLayer.apply`가 Score를 고치므로 agree 실패 → projected | Score에 있는 것 (코드명·8va·arpeggio 포함). Audiveris의 beam은 잃고 파생 beam — 알려진 한계, PdfLayer의 그래프 이전은 G12 |
| 저장된 곡 (이 기기) | G4-U1이 A면 store, 아니면 projected | U1에 따름 |
| 서버·공유 곡 | projected (U1이 서버 저장까지 넓히지 않는 한) | Score에 있는 것 |
| 옛 버전으로 저장된 녹음 (`migrateSavedTranscription`) | projected | Score에 있는 것 |

### 26.3 옛 악보의 호환 약속

- 어떤 Score든 그려진다 (projected가 항상 됨, A47·A48).
- projected 그래프로 그린 곡은 **지금 렌더러가 보여 주는 것 이상**을 보여 준다 (파생 beam 규칙, 줄 넘김 tie·slur, 셈여림·hairpin — Score가 이미 갖고 있으나 지금 그리지 않는 것).
- 저장 형식(`packScore`), 공유 API, 서버 스키마는 G4-U1이 허락한 범위 밖에서 바꾸지 않는다.

---

## 27. 구현 단계

단계마다 독립 리뷰가 가능한 크기다. 각 단계는 기본값 `'legacy'`를 유지하므로 따로 병합할 수 있다.

### G4a — 원천과 의미 계획 (사용자에게 보이는 변화 없음)

| | |
| --- | --- |
| 범위 | `vendor/vexflow-4.2.3.js`(+ `vendor/README.md`: sha256, 라이선스 고지), `engrave/index.js`, `engrave/source.js`(resolve·link·agree), `engrave/plan*.js`(NotationPlan·ledger 전부), `scoregraph/legacy-score.js` `fromScore`, (U1이 A면) `engrave/store.js`. 앱: 생산자에서 live 그래프 보관(§8.2의 줄들), script 태그. `package.json` `test:engrave` |
| 테스트 | `tests/engrave/plan.test.js`, `ledger.test.js`, `source.test.js`, `fromscore.test.js`(A48), E01–E40 fixture와 `corpus.json`, `tools/bench.js`의 L1 |
| acceptance | A1, A3, A13, A15(plan 수준), A16(link·agree), A29(vendoring 부분), A46, A47(plan 수준 예외 0), A48 |
| 의존 | G4-U1, G4-U2 결정 (U2는 plan의 degenerate 옵션) |
| rollback | 없음 — 렌더러 기본값 불변. 커밋 revert |

### G4b — 배치 핵심과 연습 map

| | |
| --- | --- |
| 범위 | `metrics.js`(VexFlow glyph metric), `space.js`(§9), `breaks.js`(§15.2), `skyline.js`, `layout.js`(음·쉼표·임시표·점·덧줄·stem·flag, staff·clef·key·time·세로줄·반복·volta), `canon.js`(hash), `svg.js`(`<symbol>`/`<use>`), `practice.js`(PracticeMap), 앱 ScoreView의 `renderer` 스위치와 새 `sync` (옛 코드 불변). DOM 계약 (§16.4) |
| 테스트 | layout 결정론(A27), rod·단조성, 넘침·잘림, 머리 겹침, `tools/browser-parity.js`(A28), 브라우저 suite를 `renderer='engrave'`로 (이 단계에서 가능한 것) |
| acceptance | A14, A17, A18, A19(기본), A23, A24, A27–A29, A31–A33, B2–B4, B6, B7 |
| 의존 | G4a |
| rollback | 스위치 기본 `'legacy'` |

> **Lead 결정 G4-L1 (2026-09-25)** — G4b는 **geometry-only**로 닫았다 (§33.1). G4b에는 다음이 없다: `svg.js`, 앱 ScoreView의 `renderer` 스위치와 새 `sync`, `renderer='engrave'` 브라우저 suite.
>
> 옮긴 곳:
> - `svg.js`(+ B9) → **G4c**.
> - 앱 통합 + A32·A33 → **G4d-2**. 기본값은 `'legacy'` 그대로이고, M-H1을 실제 페이지에서 보기 위해서다. 내용:
>   - 개발용 스위치: `renderer` prop, `?renderer=engrave`, `PPP.strictEngrave`;
>   - 곡 단위 fallback 카운터;
>   - G4b highlighter를 새 `sync`로;
>   - 내용 hash `drawKey`;
>   - `agree.ok` 요구;
>   - vendored 파일을 캐시 가능하게 전송;
>   - 다시 불러온 곡의 `resolve` 비용;
>   - `with-port.js`의 빈틈.
> - A30 전체와 페이지 수준 A35–A37 → **G4f**.
>
> G4b가 판정한 acceptance: A14, A17–A19(기본), A23, A24, A27–A29, B1–B7(Node·Chrome), A31(Node 대리 지표). 근거와 순서는 `docs/PPP_MASTER_ROADMAP.md` §5.1, DECISIONS G4-L1.

### G4c — beam, stem, tuplet, 성부, 쉼표, 꾸밈음

| | |
| --- | --- |
| 범위 | §11, §12, §14 전부 (cross-staff는 `deferred`) |
| 테스트 | E01–E07, E12–E14, E26, E29–E30, E38–E39; X 세트 L1·L2 |
| acceptance | A2, A3(렌더 수준), A4, A7(꾸밈음), A11(마디 쉼표), A21, A26 |
| 의존 | G4b |
| rollback | 스위치 |

### G4d — 곡선, 기호, 충돌

| | |
| --- | --- |
| 범위 | `curves.js`(tie·slur·glissando, system 넘김 반쪽), §10 배치 전부: articulation·꾸밈 기호·fermata·운지·안내 글자·가사·셈여림·hairpin·pedal·ottava·volta·코드명·tempo·rehearsal·jump·words, 세로 간격 §15.3, 글자 metric 표(§18.3) |
| 테스트 | E08–E11, E15–E25, E27, E31–E35, E40; R 코퍼스 L2 |
| acceptance | A5–A10, A12, A20, A22, A25 |
| 마무리 | **M-H1** 사람 평가(진단). §7.3의 Verovio 재평가 조건 점검 |
| 의존 | G4c |
| rollback | 스위치 |

### G4e — 페이지와 인쇄

| | |
| --- | --- |
| 범위 | 인쇄 config, DP 줄바꿈·페이지 나눔(§15.5), 제목 영역, 페이지 번호, 여러 마디 쉼표 묶음, 인쇄 컨테이너와 `@media print`, 명령 UI(i18n 문자열 포함), 글자 폭 브라우저 검사 |
| 테스트 | 인쇄 L2·L3 (A38), 래스터 0 자동 검사, ledger 동일성(A40) |
| acceptance | A11(여러 마디 쉼표), A38–A40, B8 |
| 의존 | G4d, G4-U3 |
| rollback | 인쇄 명령만 숨김 (화면과 독립) |

### G4f — benchmark 완성, 사람 평가, flip

| | |
| --- | --- |
| 범위 | mutation M1–M25, `legacy-geometry.js`와 A43 비교 보고, perf 도구와 CPU 감속(A35–A37), CI에 `test:engrave`·`bench.js check`, R baseline 기록, **M-H2** 사람 평가, 바꾼 브라우저 단언 기록, flip(사용자 승인 뒤), `docs/CURRENT_STATE.md`·DECISIONS 갱신 |
| acceptance | A30, A34–A37, A41–A45, 그리고 §30 |
| 의존 | G4a–G4e |
| rollback | §25.3 |

---

## 28. 위험

| # | 등급 | 위험 | 대책 |
| --- | --- | --- | --- |
| R1 | **BLOCKER** (대책 전) | 다시 불러온 곡에 그래프가 없다 → 새 렌더러가 저장 곡을 못 그리거나, 들여온 곡이 다시 불러오면 다르게 보인다 | `fromScore`로 언제나 그림(A48). 다르게 보이는 문제는 G4-U1 |
| R2 | MAJOR | Score와 렌더 그래프가 어긋나 하이라이트·틀린 음 표시가 엉뚱한 음에 | `agree`(G2 비교기) + link 전단사 확인, 실패 시 projected (§8.2, A16) |
| R3 | MAJOR | VexFlow 한계: cross-staff 화음·beam, 3단 중첩 tuplet, 부분 beam 방향; VexFlow 5 이동 압력 | 4.2.3 고정·vendoring. 곡선·배치는 PPP 기하. 한계는 ledger `deferred`로 보이게. NotationPlan 경계로 엔진 교체 가능 |
| R4 | MAJOR | 빽빽한 피아노 악보(소나티네·체르니)에서 충돌 배치 품질 | skyline 단일 배치 함수, L2 hard 0, M-H1에서 조정, Verovio 재평가 조건 (§7.3) |
| R5 | MAJOR | 전곡 보기 성능 퇴행 (그릴 것이 늘어남, SVG 크기) | 캐시·미리 계산·time slicing·`<use>`, B1–B9를 로컬 perf로 gate |
| R6 | MAJOR | 옛 DOM에 묶인 테스트 (`.vf-notehead`, `g.ppp-note[data-onset]`, `svg.__ppp`) | DOM 계약 유지 (§16.4). 바꾼 단언은 이유와 기록 |
| R7 | MAJOR | 표의 글자 폭과 브라우저 실제 폭의 차이 → 글자 겹침 | 여유 padding, G4e 브라우저 검사 허용 8 %, 인쇄 전 `document.fonts.ready` |
| R8 | MAJOR | 여러 세션이 19k줄 앱 파일을 함께 고침 | G4 코드를 `engrave/`에. 앱 편집은 작게, 정확한 문자열 편집, 테스트 실패가 누구 것인지 확인 (CURRENT_STATE "Working in this repository") |
| R9 | MAJOR | 충실한 그림이 업스트림 결함(G3 off의 1-음 tuplet, 추론 tie, 64분 쉼표)을 더 잘 보이게 해 퇴행처럼 느껴짐 | G4-U2, X 세트 보고, "판각이 드러낸 업스트림 결함" 목록 (§26.1) |
| R10 | MAJOR | 휴대폰·태블릿 폭 (2마디 줄, 확대) | page 단위 좌표 + breakpoint별 N, 390·768·1024·1600 px에서 브라우저 suite |
| R11 | MAJOR | G4-U1 A의 저장 크기·quota·동기화 | gzip canonical JSON (G2 측정 gzip 0.10×), IndexedDB, 실패하면 projected로 조용히 대체 가능한 캐시로만 취급 |
| R12 | MINOR | SVG 픽셀 snapshot이 흔들림 | 기하 snapshot이 기본, 픽셀은 로컬 참고용 |
| R13 | MINOR | 들여온 악보의 가장자리 (중첩 tuplet, C clef, 성악+피아노, 타악기, 숨은 event) | E fixture + 504 파일 예외 0 (A47) |
| R14 | MINOR | 인쇄와 화면의 차이 | 같은 plan·간격, A40 |
| R15 | MINOR | 전환 기간의 중복 배치 논리 (옛 렌더러와 새 렌더러) | 옛 렌더러 동결 (새 기능 없음), 한 릴리스 뒤 제거 |
| R16 | MINOR | 글꼴·glyph 라이선스 고지 누락 | `vendor/README.md`에 VexFlow MIT와 glyph 글꼴 고지 (G4a) |
| R17 | MINOR | 런타임 CDN 의존 (React·Babel은 G4 밖) | VexFlow만 vendoring. 나머지는 G13 |

---

## 29. 사용자 결정

저장소 증거로 정할 수 있는 것은 이 문서가 정했다 (§7–§26의 G4-D1–D12, `docs/DECISIONS.md`). 제품 선호가 필요한 넷만 올린다.

### G4-U1 — 렌더 그래프를 다시 불러온 뒤에도 쓰게 할 것인가

지금 그래프는 import 때 메모리에만 있고 저장하지 않는다 (G2-D14, localStorage 크기). 다시 불러오면 `fromScore`로 Score에서 그래프를 만드는데, Score는 beam·articulation 대부분·꾸밈음·운지 전부·fermata·tuplet 표시 옵션을 모른다.

| | A. 그래프를 곡 옆에 저장 | B. 저장하지 않음 | C. Score를 넓힘 |
| --- | --- | --- | --- |
| 방법 | canonical 그래프를 gzip해 IndexedDB에 (곡 id + Score 내용 hash 키). 이 기기에서만. 서버·공유는 projected | 언제나 projected (course·카탈로그는 refetch) | legacy Score에 판각용 곁표(beam 멤버, 표시 옵션, 기호 …)를 더해 localStorage·서버·공유와 함께 다님 |
| 결과 | 이 기기에서 들여온 곡은 다시 불러와도 같게 보인다. 다른 기기·공유는 Score 수준 | 사용자가 올린 MusicXML은 **올린 직후와 다시 불러온 뒤가 다르게** 보인다 (beam·운지·기호가 사라짐) | 어디서나 같게 보이나, 곧 없앨 legacy 형식(S8)에 두 번째 의미 저장소를 만든다. 저장 크기 증가 |
| 비용 | `engrave/store.js`, 크기 측정(G2 A31), quota 처리 | 없음 | toScore·parseMusicXML·packScore·서버 모두 수정 |
| **권고** | **A** | | |

권고 이유: 같은 곡이 새로 고침 뒤 다르게 보이는 것(B)은 연습 앱에서 받아들이기 어렵고, C는 S8에서 없앨 형식을 키운다. A의 저장은 **캐시**다 — 없거나 어긋나면(`agree` 실패) projected로 떨어지므로 데이터 위험이 없다. 서버·공유까지 그래프를 싣는 일은 저장 형식 Goal에서.

### G4-U2 — G3 off 추론 기보의 퇴화된 모양을 어떻게 보일 것인가

녹음·MIDI 경로(G3 off)는 (i) 마디 안 tie를 쓰고 — 지금 렌더러는 숨긴다(O4), (ii) 셋잇단 조각마다 1-음 tuplet을 쓴다 — 지금 렌더러는 숫자를 아예 안 그린다(O3).

| | A. 충실 + 표시 병합 | B. 완전 충실 | C. 지금처럼 |
| --- | --- | --- | --- |
| (i) 마디 안 추론 tie | **그린다** | 그린다 | 숨긴다 |
| (ii) 1-음 tuplet | 한 tuplet을 이루는 사슬은 **숫자 하나로** (§12.3, ledger `merged`) | 조각마다 "3" | 숫자 없음 |
| 결과 | 그림 = 앱이 치고 판정하는 것. 셋잇단이 읽힌다. 전문 악보에 가까운 모양 | 그림 = 그래프 그대로. 셋잇단 연습곡에 한 마디 "3" 12개 | 두 번 치는 음처럼 보이는데 앱은 한 번으로 판정 (모순). 셋잇단이 보통 8분처럼 보임 |
| **권고** | **A** | | |

권고 이유: (i)는 앱의 재생(App 2631)과 연습 판정(6754)이 이미 tie를 한 음으로 다루므로, 숨기면 연습 화면이 앱 자신과 모순된다. 가짜 tie라면 고칠 곳은 writer/G3다. (ii)의 병합은 타이밍을 바꾸지 않는 표시 규칙이고, G3a 그래프에서는 저절로 꺼지며 G3 metric에는 영향이 없다. `engraving.test.js`의 "추론 악보는 마디 안 tie를 그리지 않음" 단언이 A에서 바뀐다.

### G4-U3 — 인쇄·PDF를 G4에 넣을 범위

| | A. 브라우저 인쇄 | B. A + PDF 파일 직접 내려받기 | C. 인쇄는 나중 (G13) |
| --- | --- | --- | --- |
| 방법 | "인쇄 / PDF로 저장" → 인쇄 layout → `window.print()` → 브라우저가 벡터 PDF | svg2pdf.js + jsPDF, 글꼴을 직접 넣음 | 화면만 |
| 결과 | 추가 의존성 없음, 결정론적 페이지 기하, PDF 바이트는 브라우저마다 다름 | 버튼 하나로 파일, 의존성 약 500 KB와 글꼴 넣기 문제 | G4가 작아짐. 전곡 인쇄 요구가 남음 |
| **권고** | **A** | | |

### G4-U4 — 화면의 줄바꿈 규칙

| | A. 연습 규칙 유지 | B. 판각 밀도 규칙 |
| --- | --- | --- |
| 방법 | 줄당 N마디(데스크톱 4, 휴대폰 2), 너무 빽빽하면 줄임, 외톨이 마지막 줄 방지 (§15.2) | 인쇄와 같은 DP — 줄마다 마디 수가 달라짐 |
| 결과 | 마디 위치가 예측 가능 (루프·기억 모드·"12마디" 찾기), 지금 사용자·테스트와 같음 | 인쇄 악보처럼 보이나 줄마다 마디 수가 들쭉날쭉 |
| **권고** | **A** (인쇄는 B 규칙을 쓴다) | |

그 밖에 G4f의 사람 평가(M-H1, M-H2 — 16 발췌씩 두 번)에 사용자의 시간이 필요하다. 결정이 아니라 요청이다.

---

## 30. Definition of done

G4는 다음이 모두 참일 때 끝난다.

1. A1–A48이 PASS이거나, PASS가 아닌 항목이 사용자 결정으로 기록되어 있다.
2. M-H2 사람 평가 합격 (§22.4), 결과 JSON 커밋.
3. `npm run test:scoregraph`, `npm run test:engrave`, `bench.js check --suite r`, G0 gate 전체, 브라우저 suite(`renderer` 둘 다)가 통과. G0 metric·golden·MusicXML export·Score 바이트는 G4 전과 동일 (G4는 판각만 바꾼다).
4. mutation M1–M25 REGRESSION, N1–N2 바이트 동일.
5. 성능 B1–B9 (로컬 perf 보고 커밋).
6. 사용자가 flip을 승인했고 기본값이 `'engrave'`. 옛 렌더러는 스위치 뒤에 한 릴리스 남아 있다.
7. `docs/CURRENT_STATE.md`, `docs/DECISIONS.md`(G4-D·U를 Accepted로), `docs/ARCHITECTURE.md`(S5 렌더러 부분 완료), 이 문서의 구현·리뷰 기록 절이 갱신됨.
8. "판각이 드러낸 업스트림 결함" 목록 (§26.1)과 `deferred` 목록이 다음 Goal을 위해 적혀 있다.
9. G3의 상태 표시는 그대로 PARTIAL / DEFERRED다 — G4가 G3를 완료로 만들지 않는다.

---

## 31. 사용자 결정 기록

2026-09-24, G4a 착수 지시와 함께. 네 결정 모두 수용, U2와 U4는 사용자의 조건·수정과 함께. `docs/DECISIONS.md` G4-U1–U4.

| ID | 결정 | 이 문서에 반영한 곳 |
| --- | --- | --- |
| G4-U1 | **수용.** 그래프를 IndexedDB에 캐시한다 (압축이 맞으면 압축). ScoreGraph가 진실이다. 들여온 곡을 다시 불러와도 그래프 의미를 조용히 잃지 않는다. legacy Score는 호환·복구 표현이다. 그래프가 없으면 `legacy.fromScore`가 만들고, 그 결과는 설계된 `legacy.compare` 경로로 확인한다 | §8.2; 구현 §32.4 |
| G4-U2 A | **수용.** 추론 tie를 **그린다**. 재생·연습이 이어진 음으로 다루면 악보에도 tie가 보여야 한다 | §13.1; 구현: plan은 모든 tie를 `drawn`으로, 추론이면 `inferred: true` (legacy 렌더러는 G4b까지 그대로) |
| G4-U2 B | **조건부 수용.** 표시 병합은 **필요한 구조 조건이 모두** 인접한 한 음 tuplet이 한 시각 묶음임을 증명할 때만 — 적어도 같은 성부, 같은 staff, 같은 비율, 시간상 이어짐·양립, 충돌하는 의미 경계 없음, 결정론적 묶음. ledger에 merged-for-display(파생된 시각 묶음)로 기록한다. ScoreGraph의 시간·의미를 바꾸지 않는다. 병리적 한 음 tuplet을 일괄로 숨기지 않는다. 묶음이 애매하면 의미 그대로 그린다 | §12.3; 구현 §32.6 |
| G4-U3 | **수용.** G4 인쇄는 브라우저 인쇄 layout → 인쇄 대화상자의 벡터 PDF. 외부 판각 엔진·서버 PDF 파이프라인 없음. MusicXML 내보내기는 따로 남는다 | §17 (G4e) |
| G4-U4 | **수정 수용.** 데스크톱 4마디, 휴대폰 2마디는 **선호 목표이지 고정 규칙이 아니다**. 실제 줄바꿈은 밀도·폭이 이긴다: 빽빽하면 줄이고 성기면 늘린다. 외톨이 마지막 마디는 가능한 한 피한다. 인쇄는 밀도 기반 | §15.2, A24 (G4b) |
| G4-U5 | **deferred 계약 (2026-09-25, G4a 최종 리뷰 뒤).** `title-block`은 deferred 허용 (G4e: 인쇄 제목 영역 중 title·composer 밖). `ornament-glyph`는 schema가 아는 장식음 중 고정 글꼴에 glyph가 없는 것만 deferred 허용 (G4d). `unknown-spanner`처럼 모르는 의미는 deferred 금지 — `unsupported`(진단, audit 실패). `projected-loss`는 유지. §21.1 목록과 이 둘 밖의 deferred code는 실패 | §21.1, A1; 구현 §32.13.4 |

---

## 32. G4a 구현 기록

Implementer, 2026-09-25. 브랜치 `g4-professional-engraving` (`D:/PPP-g4`), 설계 커밋 `bd73d4f` 위. 병렬 read-only 리뷰가 지적한 것을 같은 날 Fixer가 고쳤다 — **§32.1–§32.11은 Implementer의 기록이고, Fixer가 바꾼 것·잰 것·최종 상태는 §32.12에 있다** (§32.1–§32.11 안의 수가 §32.12와 다르면 §32.12가 맞다). 병합하지 않았다. G4b는 시작하지 않았다.

### 32.1 범위

- **한 것** (§27 G4a): 렌더 원천 (live → store → projected), `legacy.fromScore`·`agree`·`link`, 좌표 없는 NotationPlan과 fidelity ledger, 곡마다 IndexedDB에 두는 그래프 캐시 (G4-U1), 연습 identity map, VexFlow 4.2.3 vendoring, `npm run test:engrave` (CI).
- **하지 않은 것 (의도)**: 새 렌더러를 켜지 않았고 스위치 `PPP.renderer`도 없다 (G4b). 앱은 plan을 만들지 않는다 — `PPPEngrave.plan`을 부르는 곳은 테스트와 도구뿐이다. G4b 간격·충돌, G4c beam 그리기, G4d 기호·곡선, G4e 인쇄, 사람 평가, G5 없음. G3는 전부 off다: G3 flag를 읽지 않고 `professionalize`를 부르지 않는다 (A46).
- **사용자에게 보이는 변화: 없음.** legacy 렌더러의 SVG가 `55d1bd5`와 바이트 동일 (§32.8), ScoreView 블록 hash 불변. 보이지 않는 변화 둘: 페이지가 `engrave/*.js` 7개를 더 읽고 (합 67 KB, 압축 전), 곡을 저장하면 idle 때 IndexedDB `ppp-engrave`에 그래프 한 벌을 쓴다.

### 32.2 파일

| 파일 | 무엇 |
| --- | --- |
| `engrave/source.js` | `createSource({store})` → `remember`, `resolve`, `resolveSync`, `persist`, `forget`, `stats`; `scoreHash`; `identity` (연습 map) |
| `engrave/store.js` | 그래프 record `encode`/`decode`, `idbBackend`(IndexedDB)·`memoryBackend`, `createStore` (한도·축출) |
| `engrave/plan.js` | `plan(graph, config)` → NotationPlan (§32.6) |
| `engrave/plan-beams.js` | 그래프 beam과 파생 beam (`pro-beam.groups`) |
| `engrave/plan-tuplets.js` | tuplet 표시, 한 음 tuplet 표시 병합 (G4-U2 B) |
| `engrave/ledger.js` | status·ref 정의, `inventory(graph)` (plan과 독립), `audit(graph, plan)` |
| `engrave/index.js` | `window.PPPEngrave` (`0.1.0-g4a`): `plan`, `audit`, `inventory`, `identity`, `store`, `scoreHash`, `app` (IndexedDB 위의 source, 처음 쓸 때 만든다) |
| `scoregraph/legacy-score.js` | `fromScore`, `agree`, `link`, `unfinalize`, `comparable`, 필드 목록 (`NOTE_SCALARS` 등, `compare`도 이것을 쓴다), `toScore(g, {ids:true})`의 `sgEvent` |
| `scoregraph/index.js`, `audio-score.js` | 라이브러리 1.2.0 → 1.3.0 (G4-I8) |
| `Piano Coach App.dc.html` | `engrave/*.js?v=1` script 7개 (`audio-score.js` 다음); `engraveRemember`·`engraveRememberXml`·`engravePersist`·`engraveForget`; 생산자 8곳 (MusicXML 글, 파일, import door, 녹음, 다시 쓰기 둘, 카탈로그 맞춤, OMR); `writeSlot`·`removeSong` 각 한 줄. 모든 호출은 `try`로 싸여 import·저장을 멈추지 못한다 |
| `vendor/` | `vexflow-4.2.3.js`, `README.md` (출처·sha256·SRI), `LICENSE-vexflow.txt`, `LICENSE-bravura-OFL.txt`, `.gitattributes` (`* -text`) |
| `tests/engrave/` | 테스트 9 파일 50개, `helpers.js`, `fixtures/legacy/*.score.json` (앱에서 잡은 Score 13), `tools/` (`capture-legacy-scores.js`, `app-source-check.js`, `legacy-parity.js`, `g4a-report.js`) |
| `package.json`, `.github/workflows/bench.yml` | `test:engrave`; CI에서 `test:scoregraph` 다음에 |
| `docs/` | 이 문서 (§31, §32, 상태), `DECISIONS.md` (U1–U4, I1–I11), `CURRENT_STATE.md` |

### 32.3 구현 중 결정과 설계와의 차이

결정 G4-I1–I11의 전문과 증거는 `docs/DECISIONS.md`에 있다. 요약:

| ID | 결정 |
| --- | --- |
| G4-I1 | 파생 beam의 단위는 **part** (G4-D3을 좁힘): part에 그래프 beam이 하나라도 있으면 그 part에서는 파생하지 않는다. 성부-마디 규칙은 beam을 쓰는 카탈로그 15 파일에서 깃발로 둔 259 묶음을 beam으로 바꿨을 것이다 |
| G4-I2 | refetch를 만들지 않았다: live → store → projected. U1로 course·카탈로그 곡도 저장된다 |
| G4-I3 | 캐시 키는 곡 id. `writeSlot` 뒤 idle에 저장, `removeSong`이 지운다. 읽을 때마다 scoreId·music hash 확인 |
| G4-I4 | `agree`는 한 음 순서로 정렬해 G2 `compare()`에 넘기고, 제목·작곡가·점수 tempo는 보고만 한다 |
| G4-I5 | music hash는 `compare()`처럼 정규화 (null·없음·false 같음, 수는 6자리) — `packScore`가 null을 버려 다시 불러온 곡이 전부 "낡음"이던 것을 페이지 검사가 찾았다 |
| G4-I6 | 한 음 tuplet 병합을 beam보다 먼저 정하고, 파생 beam 규칙에 병합 묶음을 tuplet 하나로 넘긴다 |
| G4-I7 | `fromScore`는 Score의 손에서 part 구성을 되살린다 |
| G4-I8 | 라이브러리 1.3.0. `toScore`의 기본 출력은 바이트 그대로 |
| G4-I9 | VexFlow는 vendoring만, 앱은 불러오지 않는다 (legacy는 CDN 그대로, G4b까지) |
| G4-I10 | ledger status는 다섯 + code. 사용자의 이름과의 대응: merged-for-display = `merged` + `merged-for-display`, 명시적 의미로 숨김 = `suppressed` + code, 미지원 = `deferred` + code |
| G4-I11 | `fromScore`는 조용히 버리지 않는다: 그래프가 거절한 객체는 하나씩 빼고 `refused-by-graph:<code>`로 이름을 댄다. staff 없는 Score 8va는 피아노 part 첫 staff에 두고 `ext['musicxml.ottava'].staff = 'assumed'`로 표시한다 (importer와 같은 방식, `toScore`는 다시 staff 없음으로 읽는다) |

**§27 G4a 범위에서 벗어난 것 — 리뷰어가 판단할 것:**

1. ~~**E01–E40 fixture, `tests/engrave/corpus.json`, `tools/bench.js`의 L1은 만들지 않았다 → G4b로.**~~ **Fixer가 만들었다 (§32.12.6, G4-F11).** E fixture 대부분은 기하(간격·충돌·곡선 모양)를 재기 위한 것이라 plan만 있는 G4a에서는 판정할 것이 적다. G4a의 L1은 대신 (a) `plan.test.js`의 "L1 (A1)" 테스트가 코퍼스 399 그래프 + PPP 전사 17 + 그 G3a 17 전부에 대해 판정하고, (b) `tools/g4a-report.js`가 종류별 ledger 표를 찍는다 (§32.6). E 목록의 의미 사례(중첩 tuplet, 8va, 피아노 기호, 4성부, `printed:false`, 한 음 tuplet, 추론 tie)는 기존 ScoreGraph fixture와 테스트 안에서 builder로 만든 그래프로 다룬다. A2·A3·A4가 가리키는 E01–E07·E38 번호는 아직 없다.
2. **refetch 없음** (G4-I2).
3. ~~**A1의 `projected-loss` status 없음** (G4-I10)~~ **Fixer가 A1대로 되살렸다 (G4-F2)**: `plan(graph, {projection: {unsupported}})`이면 fromScore의 code마다 `p:` 항목.
4. **A3 "성부-마디"는 "part"** (G4-I1).

### 32.4 렌더 원천과 그래프 캐시 (G4-U1)

**원천.** `PPPEngrave.app.resolve(score, {key})` → `{graph, via, link, agree, unsupported, diagnostics}`:

1. **live** — 생산자가 Score를 만든 그래프 (`remember`로 Score 객체 곁에, 메모리에만). MusicXML 글로 가진 곡(카탈로그 맞춤, OMR)은 thunk로 두어 필요할 때만 읽는다. `agree`와 `link`가 둘 다 통과할 때만 쓴다. 아니면 `SOURCE_DISAGREE` / `LINK_FAILED`.
2. **store** — 곡 id로 저장된 그래프. record의 `scoreId`가 Score의 id와 같고, `scoreHash`가 지금 Score의 music hash와 같고, `link`가 통과할 때만. 아니면 record를 지우고 `STORE_OTHER_SCORE` / `STORE_STALE` / `STORE_LINK_FAILED` / `STORE_<decode code>`.
3. **projected** — `legacy.fromScore(score)` + `agree` + `link`. `unsupported`에 잃은 것. `PROJECTION_FAILED` / `PROJECTION_DISAGREES`면 `via: 'none'` (legacy 렌더러가 그대로 그린다).

결과는 Score 객체마다 memo된다 (`resolveSync`는 store 없이 1·3만).

**저장.** `writeSlot`이 slot을 쓴 뒤 `engravePersist(songId, score)` → `requestIdleCallback` (timeout 4 s) → `persist`. 저장하는 것은 **live이고 agree가 통과한 그래프뿐**이다: projected 그래프는 `put`이 `not-live`로 거절하므로, **다시 만든 그래프가 저장된 그래프를 덮어쓰는 길은 없다**. 한 곡·한 Score에 한 번 (`already`), 진행 중이면 다시 하지 않는다. `removeSong`이 `forget(songId)`로 지운다.

**record** (`ppp-engrave` DB, `graphs` store, keyPath `key` = 곡 id): `{key, v:1, lib, sgv, graphId, rev, fp, scoreId, scoreHash, producer, encoding, size, stored, data, savedAt}`.

- `data` = `SG.serialize(graph)`의 canonical 글을 `CompressionStream('gzip')`으로 (없으면 `identity`). 직렬화는 결정론적이고 (같은 그래프 → 같은 바이트) 그래프를 바꾸지 않는다 (encode 전후 fingerprint 같음, 테스트).
- `fp` = 그래프 fingerprint (canonical 글의 FNV-1a 64). 읽을 때 다시 계산해 같아야 쓴다.

**이전과 실패** — 모든 경우에 이름이 있고, 아무것도 throw하지 않으며, 곡은 언제나 열린다:

| code | 뜻 | 동작 |
| --- | --- | --- |
| `missing` | record 없음 (G4a 이전에 저장된 곡 포함) | projected |
| `record-version` | record 형식 `v`가 다름 | 지우고 projected |
| `schema-version` | 더 새 ScoreGraph schema (`SG.parse`의 `E-VERSION`) | 지우고 projected |
| (이전) | 더 옛 schema는 `SG.parse`가 migrate한다. 이때 fingerprint는 비교하지 않고 (`migrated: true`) validate만 | 사용 |
| `no-decompression`, `encoding`, `no-data`, `unreadable`, `decode-failed` | 풀 수 없음 | 지우고 projected |
| `fingerprint`, `invalid` | 바이트가 바뀜, validator ERROR | 지우고 projected |
| `STORE_STALE`, `STORE_OTHER_SCORE` | Score가 바뀜 (다시 쓰기 등), 다른 Score | 지우고 projected |
| put: `too-large` (record > 16 MB), `quota`, `backend` | 저장 실패 | 조용히 건너뜀, 곡 저장은 이미 끝남 |

한도: record 200개, 합 64 MB. 넘으면 오래된 것부터 지운다. IndexedDB가 없으면 `resolve`는 store 없이 live → projected로 간다.

**페이지 검사** (`tools/app-source-check.js`, 실제 앱 진입점): 기본 곡 → projected; course 곡, MusicXML·MIDI 파일 → live, 저장됨; 다시 불러오기 → 두 곡 모두 store, fingerprint가 저장 전과 같음; record 손상 → `STORE_DECODE_FAILED`로 이름을 대고 지운 뒤 projected, legacy 렌더러 그림은 그대로; My Songs·썸네일·퀴즈의 모든 Score가 그래프를 얻음; 곡 삭제 → 그래프도 지워짐; page error 0, engrave 경고 0.

### 32.5 `legacy.fromScore`

`fromScore(score)` → `{ok, graph, issues, byNote, unsupported: [{code, count, example}], removed}`. importer가 아니라 호환 경로다: Score가 말하는 것만 말하고, 옮기지 못한 것은 code로 이름을 댄다 (지어내지 않는다).

- 옮기는 것: 마디·박자·조·세로줄·ending·jump·tempo, 손 → part 구성 (G4-I7), 첫 part의 clef, event (같은 자리의 음은 화음, 성부 겹침은 같은 이름의 층으로), tie (이어진 같은 음, 열린 끝 허용), slur (staff+voice 사슬에서 FIFO 짝), tuplet (stack 짝짓기, 부모 비율, 인쇄 안 된 연속), arpeggio, 음에 붙은 셈여림, 코드명, 셈여림 (소리 velocity 포함), hairpin, pedal, 8va (G4-I11).
- 이름을 대는 것 (code마다 수와 첫 예): 예 `percussion-or-unpitched`, `transposition` (Score에 이조 음정이 없음), `microtone`, `tie-open-start`·`tie-open-end`, `slur-open-*`, `tuplet-unclosed`, `ottava-staff`, `refused-by-graph:<code>` (그래프 validator가 ERROR로 거절해 뺀 객체, 한 번에 하나씩 빼고 다시 봉인).
- 결정론: 같은 Score → 같은 그래프 바이트, 저장했다 다시 읽은 Score에서도 (테스트).
- **A48 결과** (`toScore(fromScore(S)) ≡ S`, `agree`와 테스트 안의 엄격 비교(모든 필드, 1e-9) 둘 다):
  - 코퍼스 399 그래프: 398 동일, 1은 허용 목록 (`unpitched.musicxml`, `percussion-or-unpitched`로 말함).
  - 커밋된 import 파일 504개 전체 (MusicXML 253, MXL 222, MIDI 29, `agree`만): 503/504, 같은 1개.
  - PPP 전사 17, 그 G3a 17, 앱에서 잡은 Score 13 (녹음, parse, import, 저장 뒤 다시 읽음, 기본 곡): 전부 동일.

### 32.6 NotationPlan과 ledger

**NotationPlan** (`plan/1`, 좌표 없음, 모든 항목에 그래프 ID): `{version, graph:{id, rev, fingerprint}, config, meta, measures, meters, keys, tempos, endings, jumps, parts, staves, voices, roles, clefs, events, beams, tuplets, ties, slurs, lines, marks, ledger, summary, diagnostics}` + 열거되지 않는 `index`. config 기본값 `{mode:'screen', fingering:true, chords:true, marks:true, respectSourceBreaks:false, deriveBeams:true, oneNoteTupletMerge:true}`.

- event: 적힌 음높이 (이조와 ottava `[from, to)`를 반영), stem (`display.stem`, 없으면 그래프 성부 순서, 음높이 아님), 성부 역할.
- tie: 그래프의 모든 tie, `inferred`는 `SG.legacy.inferredNotation`에서 (G4-U2 A: 전부 `drawn`, 숨기지 않음).
- beam: 그래프 beam은 `drawn` (여러 staff에 걸치면 `deferred` `cross-staff-beam`). 그래프 beam이 없는 part에만 `pro-beam.groups`로 파생 (`derived`, code `part-states-no-beams`), 그래프에는 쓰지 않는다.
- tuplet: `printed:false` → `suppressed` `printed-false`; show none + 괄호 없음 → `suppressed` `show-none`; 3단 중첩 → `deferred` `nested-3`; 병합 → `merged` `merged-for-display`; 그 밖의 한 음 tuplet은 그래프대로 `drawn` (code `one-note`). 괄호 기본값은 "beam과 같지 않으면".

**G4-U2 B 표시 병합** (`plan-tuplets.js` `merges`). 모든 조건이 참일 때만 묶는다. 하나라도 거짓이면 각 tuplet을 그래프대로 그린다:
인쇄됨; event 하나; 부모·자식 없음; 명시적 `show` 없음; 같은 part·성부·staff·마디; 꾸밈음·숨김 아님; 같은 비율과 단위 (적힌 단위, 없으면 같은 표시 음가); 시간상 연속이고 사이에 꾸밈음 없음; 그 성부-마디에 여러 음 tuplet 없음; 길이 합 = normal × 단위; 시작이 그 단위 격자에 맞음; 못갖춘마디 아님; 둘 이상.
그래프의 시간·의미는 바뀌지 않는다 (plan 전후 fingerprint 같음, A13). 결과: 433 그래프에서 45 tuplet → 15 묶음. 테스트는 14가지 경우 — 격자 밖, 틈, 셋 중 둘, 다른 비율, 다른 staff, 다른 성부, 명시적 `show`, 단위 없는 다른 음가, 사이 꾸밈음, 같은 성부-마디의 여러 음 tuplet, 못갖춘마디, 숨김, `printed:false` 멤버, 세로줄 넘김 — 에서 병합이 없고 각 tuplet이 그래프대로 그려지는지 본다. 중첩(부모·자식)은 코드의 조건으로만 막는다 (테스트 builder가 부모를 만들지 않음).

**ledger** (`ledger.js`): `inventory(graph)`는 plan을 읽지 않고 그래프가 말하는 기보 객체를 ref → 종류로 센다. `audit(graph, plan)`은 `silent` (inventory에 있는데 ledger에 없음), `invented`, `duplicate`, `kindMismatch`, `missing` (ledger는 drawn인데 plan에 없음), `badStatus`를 센다. 테스트가 각 결함을 일부러 만들어 audit이 잡는지 본다. **— Fixer 주: 이 `missing`은 plan이 그래프를 돌며 채운 index를 읽어서, 출력에서 객체를 빠뜨린 plan을 잡지 못했다 (`ties.push`를 지워도 ok). 지금의 audit은 plan 출력을 따로 읽어 대조한다 — §32.12.2, G4-F1.**

**L1 결과** (`tools/g4a-report.js`, 433 그래프 = 코퍼스 399 + 전사 17 + G3a 17): silent 0, invented 0, duplicate 0, missing 0, kindMismatch 0. 파생 beam 3,772, 병합 묶음 15. `deferred`는 `title-block` 234 (제목 영역, G4e)와 `cross-staff-chord` 1뿐. **— Fixer 주: 이 코퍼스에는 G0 hold-out 52 파일이 들어 있었다. 지금의 수는 hold-out 없는 코퍼스와 새 audit으로 §32.12.6.**

| 종류 | 수 | drawn | 그 밖 |
| --- | --- | --- | --- |
| note / head / stem | 86,150 / 96,774 / 41,579 | 전부 | — |
| beam (그래프) | 10,278 | 10,278 | + derived 3,772 (plan 항목, 그래프 객체 아님) |
| tuplet | 1,947 | 297 | merged 45, suppressed 1,605 (전부 `show-none`: 파일이 숫자와 괄호를 숨김) |
| tie / slur | 326 / 2,971 | 전부 | — |
| articulation / fingering / dynamic / wedge | 6,782 / 11,491 / 856 / 357 | 전부 | — |
| pedal / pedal-change / ottava | 42 / 1 / 51 | 전부 | — |
| rest | 5,285 | 5,122 | suppressed 163 (숨김) |
| tempo / meter | 385 / 447 | 354 / 445 | suppressed 31 (`sound-only`), 2 (숨김) |
| layout-break / multi-rest | 285 / 1 | 0 | suppressed (화면 모드, `respectSourceBreaks:false`) |

### 32.7 연습 identity

`identity(score, source, plan)` → `{events: {graphEventId: {notes, heads, onsetKeys, midis, hands, abs, m}}, measures, byNote, unmatchedNotes, unmatchedEvents, complete}`. `onsetKey`는 앱의 `onsetKey`(data-onset 키)를 그대로 재현한다. MIDI는 `ottavaShift`를 포함한 연습 쪽 값이다.
결과 (A16): 코퍼스 399 (live 그래프), 전사 17·G3a 17·앱 Score 13 (다시 만든 그래프) 모두 `complete` — Score의 모든 음이 정확히 한 event·head에 대응하고, 하이라이트 키·마디·seek 위치·MIDI·손이 Score와 같다. Score를 저장했다 다시 읽어도 같다. link가 실패한 그래프는 쓰지 않는다 (§32.4).

### 32.8 검증

**Acceptance (G4a 몫)**

| # | 결과 |
| --- | --- |
| A1 | PASS (plan 수준): 433 그래프에서 silent·invented·duplicate·missing 0, `deferred`는 허용 code만. `projected-loss`는 §32.3-3 |
| A3 | PASS (part 단위, G4-I1): 파생 beam = `pro-beam.groups` 출력, 그래프에 쓰지 않음, `pro-beam.js`·`meter-grid.js` 바이트 불변 |
| A13 | PASS: plan 전후 그래프 fingerprint 같음 (433 그래프 전부, L1 테스트). 그래프는 deep-frozen이라 쓰기는 throw한다 |
| A15 | PASS (plan 수준): head staff = 그래프 head staff, stem은 그래프 성부 순서 |
| A16 | PASS: link·agree, identity `complete` (§32.7). 렌더러 쪽 바이트 동일은 G4b (스위치가 생긴 뒤) |
| A29 | PASS (vendoring): sha256 고정, 라이선스, `* -text`, DOM 없이 실행, 기하 결정론 (두 번 실행해 같음) |
| A45 | PASS (G4a에서 가능한 만큼): legacy 렌더 16개 (8 악보 × 가까이 보기·전곡) SVG가 `55d1bd5`와 바이트 동일 (`tools/legacy-parity.js`), ScoreView 블록 hash 불변 |
| A46 | PASS: 모든 테스트가 G3 off로 통과, G3a 그래프도 같은 plan 규칙, `engrave/`에 `professionalize` 호출 0 (정적 검사) |
| A47 | PASS (plan 수준): import 파일 504개 전부 열림, plan 예외 0, audit 결함 0 |
| A48 | PASS: §32.5 |

**회귀**

| 검사 | 결과 |
| --- | --- |
| `npm run test:engrave` | 50/50 (세 번 연속; B1 시간 검사는 다섯 번 중 가장 빠른 것 — `node --test`가 파일을 나란히 돌려 평균은 이웃을 잰다) |
| `npm run test:scoregraph` | 205/205 (G3 기준선과 같은 수) |
| G0 bench: unit / golden / correctness | 283 OK / 17/17 동일 / 13/13 |
| sg-roundtrip | 369 파일, 367 통과, 2 실패는 기존 허용 목록 |
| smoke / core | PASS (SQI 86.907 / 76.862) |
| `ab --suite core` (`55d1bd5` 대 작업 트리) | 553 case 전부 같음 (상태, metric, 의미 projection) |
| lint-corpus / provenance | 오류 0 / 일치 |
| 브라우저 suite 26개 (각각 따로, `npm test`는 `&&` 사슬) | 25 통과. `transcription.test.js` 1 실패 ("the fallback is the venv transkun console script") — `55d1bd5`에서도 같은 실패, 이 PC에 transkun venv가 없음 (환경). **— Fixer 주: suite는 `127.0.0.1:8777`을 고정으로 연다. 그 포트의 서버(2026-09-24 18:23 시작)는 G4 트리가 아니다 (라이브러리 1.2.0, `engrave/` 없음) — 이 결과는 G4a 코드를 재지 않았을 수 있다. Fixer가 이 트리에 대고 다시 돌린 결과는 §32.12.9** |
| `tools/app-source-check.js` | 전부 통과 (§32.4) |
| `tools/legacy-parity.js` | 16/16 바이트 동일 |

**측정** (이 PC, `tools/g4a-report.js`, 433 그래프, ms 중앙값 / 최악)

| 무엇 | 중앙 | 최악 |
| --- | --- | --- |
| plan | 1.33 | 17.49 (`sonatina/013`) — B1 예산 60 ms |
| fromScore | 2.06 | 32.05 |
| agree / link | 0.94 / 0.71 | 14.13 / 13.98 |
| encode / decode (gzip) | 2.10 / 3.02 | 23.85 / 34.37 |

저장 비용 (코퍼스 399): canonical 글 19,286 KB → gzip 1,745 KB (9.0%). gzip 그래프는 같은 곡들의 legacy Score JSON (24,868 KB)의 약 7%다 (slot은 `packScore`로 더 작게 저장하므로, slot 대비로는 그보다 크다). 가장 큰 record는 gzip 32 KB (`sonatina/020`, 글 376 KB). 한도(200곡, 64 MB)까지 한참 멀다.

### 32.9 리뷰어가 볼 것

1. **보이는 변화 0**: `git diff 55d1bd5 -- "Piano Coach App.dc.html"`에서 ScoreView 블록이 그대로인지, 새 호출이 모두 `try`로 싸여 있는지. `legacy-parity.js`를 직접 돌려 볼 수 있다 (파일 머리의 명령).
2. **G4-U1**: 저장된 그래프를 다시 만든 그래프가 덮어쓸 수 없는지 (`store.put`의 `not-live`, `source.persist`), 손상·낡음·다른 Score·새 schema가 모두 이름 있는 fallback인지 (§32.4 표), 저장 실패가 곡 저장·연습을 막지 못하는지.
3. **G4-U2 B 조건** (`plan-tuplets.js` `merges`): 조건 하나라도 빠졌는지, 애매한 경우가 병합 쪽으로 떨어지지 않는지 (부정 테스트 14가지, 중첩은 코드로만). 그래프가 바뀌지 않는지 (A13).
4. **`fromScore`가 지어내지 않는지**: `unsupported`·`refused-by-graph`가 잃은 것을 모두 말하는지. 8va `assumed` 처리 (G4-I11).
5. **`agree`가 무르지 않은지**: G2 `compare()`는 일부러 무르다 (6자리, 첫 `.order`에서 멈춤). `agree.test.js`의 "catches every kind of semantic loss"와 `fromscore.test.js`의 엄격 비교를 볼 것.
6. **ledger의 독립성**: `inventory`가 plan을 읽지 않는지 (정적 테스트), status·code 대응 (G4-I10).
7. **G4a 범위 차이** (§32.3의 1–4): E fixture·`bench.js`를 G4b로 미룬 것이 받아들일 만한지.
8. **G3 off**: `engrave/`에서 G3 flag·`professionalize` 0.
9. **VexFlow**: `vendor/vexflow-4.2.3.js`의 sha256이 README와 npm `vexflow@4.2.3` `build/cjs/vexflow.js`와 같은지, 앱이 아직 불러오지 않는지.

### 32.10 알려진 한계

- **타악기 음은 projection으로 되살릴 수 없다** (Score에 음높이가 없음). `percussion-or-unpitched`로 말하고 그 음은 빠진다. 커밋된 파일 중 1개 (`unpitched.musicxml`).
- **이조 음정은 projection에서 잃는다** (Score에 없음, `transposition`으로 말함). 저장·live 그래프에는 있다.
- **OMR 곡은 projected로 간다**: `PdfLayer.apply`가 Score를 고친 뒤라 live 그래프가 agree하지 않는다. Audiveris의 beam은 잃고 파생 beam이 된다 (§26.2, PdfLayer의 그래프 이전은 G12).
- **캐시는 이 기기에만 있다**: 서버·공유 곡, 다른 기기는 projected.
- **G4a 이전에 저장된 곡에는 저장된 그래프가 없다**: 다시 들여오기 전까지 projected (그래도 agree·link로 확인된 그래프).
- **저장은 idle에 한다**: 저장 직후 탭을 닫으면 그래프를 못 남길 수 있다 (다음에 projected, 다시 저장하면 남는다).
- ~~`resolve`는 Score 객체마다 memo한다: Score를 제자리에서 고치면 옛 결과를 줄 수 있다.~~ **Fixer가 고쳤다 (G4-F3)**: memo는 music hash와 함께, 바뀌면 다시 푼다.
- VexFlow는 vendoring만, 아직 불러오지 않는다 (G4-I9). legacy 렌더러는 CDN 그대로.
- 파생 beam은 G3의 `pro-beam` 규칙을 물려받는다 (그 규칙의 한계 포함, G03 §31).
- U2 B의 중첩 조건(부모·자식이 있는 한 음 tuplet은 병합하지 않음)에는 따로 된 부정 테스트가 없다 (§32.6).

### 32.11 커밋

- 설계: `bd73d4f` (Architect, 2026-09-24).
- G4a 구현: `3b8921f` (코드·테스트·vendor·이 기록), 이 해시를 적은 문서 커밋이 그 다음. 브랜치 `g4-professional-engraving`만 push, 병합 안 함.

### 32.12 Fixer — 병렬 리뷰의 지적 (2026-09-25)

입력: 구현과 나란히 돈 read-only 리뷰의 보고 (사용자가 전달, 권위 있는 입력). 같은 브랜치·worktree에서 고쳤다. 새 worktree·브랜치 없음, G4b 없음, 렌더러 flip 없음, G3 flag 변경 없음. 결정은 DECISIONS G4-F1–F14.

#### 32.12.1 지적과 처리

| # | 지적 (리뷰) | 처리 | 어디 |
| --- | --- | --- | --- |
| 1 | ledger audit의 `missing`이 plan이 그래프를 돌며 채운 index를 읽는다 — 출력에서 빠진 객체를 못 잡음 | **FIXED** — 그래프(`expected`)·plan 출력(`consumed`)·ledger 세 읽기 대조, 내용 signature (`missing`/`altered`/`orphan`) | G4-F1, §32.12.2 |
| 2 | deferred 허용 목록 없음, `projected-loss` 제거, 새 code(`title-block`, `ornament-glyph`, `unknown-spanner`), `grace-after` 미구현 | **FIXED** — status 여섯, status별 code 허용 목록, deferred = A1 목록 그대로; 나머지는 설계대로 고침 | G4-F2 |
| 3 | 저장된 그래프: hash·link만, `rec.lib` 미확인, 이전된 schema는 fingerprint·agree 생략 | **FIXED** — `agreeLib`·`hashV`가 지금 것이 아니거나 이전이면 agree 다시; 바이트 fingerprint는 parse 전 | G4-F4 |
| 4 | `fromScore`가 provenance를 지어냄 (늘 imported, slur 추론 표시 없음, 녹음의 inferred 잃음, `sgFrom.inferred` 무시) | **FIXED** | G4-F6 |
| 5 | staff 없는 8va: plan = 한 staff, 앱 = 모든 staff | **FIXED** (plan을 앱·`toScore`와 같게; 그래프는 그대로) + E18 | G4-F7 |
| 6 | A48 범위 (core 553 `parseMusicXML`, 저장, OMR, 이전된 녹음) | **FIXED** — 도구 `a48-coverage.js`; 잰 결과가 실제 결함 하나를 찾음 → 고침 | G4-F8, §32.12.5 |
| 7 | 축출이 `getAll`로 모든 blob을 읽음; `ppp-media`와 quota 공유 | **FIXED** — `meta` store, `quota-guard` | G4-F5, §32.12.7 |
| 8 | 교체된 Score 객체는 조용히 저장 안 됨 (WeakMap); agree가 throw하면 거절된 pending이 영구히 | **FIXED** — 내용으로 찾기, pending 정리·재시도 | G4-F3, §32.12.4 |
| 9 | memo가 Score 객체에만 기대 제자리 수정 뒤 낡은 결과; `already` 키 = key\|score.id | **FIXED** — (객체, music hash), (곡, music hash) | G4-F3 |
| 10 | §27 G4a 산출물 없음: E01–E40, `corpus.json`, seed·규칙, hold-out 제외, `bench.js` L1 | **FIXED** | G4-F11, §32.12.6 |
| 11 | 한 음 tuplet 병합: beam·slur 경계, `printed:false` 여러 음 tuplet | **FIXED** (+ 중첩 부정 테스트) | G4-F10 |
| 12 | plan이 그래프 하위 객체를 참조 | **FIXED** (복사) | G4-F12 |
| 13 | inventory에 없음: Part name/abbr, Jump target/display, TempoEvent display, Head lead/tech | **FIXED** | G4-F12 |
| 14 | 소리만 있는 tempo가 legacy에서 보이는 것(♩ = N)과 어긋남 | **FIXED** (화면 첫 tempo drawn `playback-tempo`) | G4-F12 |
| 15 | Petaluma·Leland OFL 고지 없음 | **FIXED** | G4-F13 |
| 16 | IndexedDB `onversionchange` 없음 | **FIXED** | G4-F5 |
| 17 | `tests/engrave/tools/`가 루트 `tools/` 규칙에 무시됨 (새 도구가 조용히 커밋에서 빠질 수 있음) | **FIXED** (`.gitignore` 예외, `tests/engrave/out/` 무시) | — |
| 18 | §32.8의 브라우저 suite 결과가 다른 트리를 쟀을 수 있음 (8777 = 라이브러리 1.2.0) | **FIXED** — 이 트리에 대고 26개 다시 (§32.12.9) | — |
| 19 | 파생 beam 단위 part (G4-I1, D3을 좁힘) | **NOT ISSUE** — 결정 G4-I1과 증거(259 묶음) 그대로; `derived_in_beamed_part = 0`이 L1 gate | G4-I1 |
| 20 | vendored VexFlow가 `no-store`·gzip 없음으로 매번 992 KB | **DEFERRED → G4b** — G4a는 불러오지 않는다 (G4-I9) | §32.12.10 |
| 21 | 명시된 `bracket="yes"`를 그래프가 기본값과 구별 못함 | **DEFERRED** (schema, G4 non-goal) — 기록·측정 | G4-F14 |
| 22 | 8va 음의 적힌 높이: plan(§8.3: concert − shift)은 legacy(`writtenP`)와 한 옥타브 다르게 그린다 — 이슈 3과 얽힘 | **DEFERRED → G4b** (G4a는 그리지 않음; flip 전 사용자 결정 필요) | §32.12.10 |
| 23 | 다시 불러온 곡의 `resolve`가 4× CPU에서 가장 긴 곡 190–316 ms | **DEFERRED → G4b** (G4a의 앱은 `resolve`를 부르지 않음) | §32.12.7 |

#### 32.12.2 ledger — 출력을 읽는 audit (G4-F1, G4-F2)

- `ledger.expected(graph)`: 그래프가 말하는 모든 기보 객체 → `{kind, sig}`. sig는 그 객체가 말하는 것 (시각·길이·staff·성부, 음높이, 양끝, 멤버, 값, placement·display 등 속성). plan을 읽지 않는다.
- `ledger.consumed(plan)`: plan의 **출력 배열**(events, heads, ties, slurs, lines, marks, beams, tuplets, measures, meters, keys, tempos, endings, jumps, parts, staves, voices, clefs, meta)만 읽어 같은 참조·sig를 만든다. 그래프도 ledger도 읽지 않는다 (정적 테스트).
- `audit`: silent · invented · duplicate · kindMismatch · badStatus · **missing** (drawn/merged/derived인데 출력에 없음) · **altered** (출력이 그래프와 다름, status와 상관없이) · **orphan** (그래프의 것도 ledger가 이름 댄 파생도 아닌 출력) · **unapproved** (status가 허용하지 않는 code) · **uncoded**.
- **mutation 증명** (`tests/engrave/ledger-mutation.test.js`, plan 소스를 임시 사본에서 고쳐 돌림; 각 mutation은 anchor가 정확히 한 번, 출력이 실제로 달라짐, audit이 그 범주로 실패):

| mutation | probe | audit이 이름 댄 것 |
| --- | --- | --- |
| L-TIE-OUTPUT (tie를 출력에서 뺌, ledger는 둠) | G16 전사 | missing 3 |
| L-ART-OUTPUT (articulation 출력 비움) | Burgmüller 25/15 | missing 211 |
| L-ART-LEDGER (articulation을 ledger 없이 출력) | Burgmüller 25/15 | silent 211 |
| L-SLUR-GONE (slur를 출력·ledger 모두에서 버림) | Burgmüller 25/15 | silent 14 |
| L-DERIVED-BEAM (파생 beam을 ledger에만) | G16 | missing 39 |
| L-TIE-ENDS (tie 양끝을 뒤바꿔 출력) | G16 | altered 3 |
| L-HEAD-PITCH (head를 한 옥타브 위로 출력) | piano-marks | altered 8 |
| L-UNAPPROVED (grace-after를 허용 목록 밖 code로) | Sonatina 002 | unapproved 6 |
| L-PEDAL-CHANGE (pedal change 출력 비움) | piano-marks | missing 1 |
| N1 (주석만 바꿈, 대조군) | piano-marks | 출력 바이트 동일, audit ok |

  고치기 전의 audit은 L-TIE-OUTPUT에 `ok: true, missing: 0`이었다 (G16, tie 3 → plan 0).
- status: drawn, derived, merged, suppressed, deferred, **projected-loss**. 허용 code (`ledger.CODES`): drawn — open, one-note, substitute-glyph, playback-tempo; derived — part-states-no-beams; merged — merged-for-display; suppressed — hidden, hidden-event, printed-false, show-none, sound-only, config-off, clef-none, analysis-only, screen-draws-each-bar, source-break-not-honored, print-only, single-part; **deferred — A1 목록 그대로**: cross-staff-chord, cross-staff-beam, tab, nested-3, grace-after, stem-double.

#### 32.12.3 fromScore, 8va, 한 음 tuplet (G4-F6, F7, F10)

- provenance: 녹음·MIDI의 Score에서 다시 만든 그래프는 기본 op `inferred` (`inferredNotation` 참, `toScore`의 `sgFrom.inferred` 참, plan의 tie는 모두 `inferred`). 파일의 Score는 `imported`. 규칙으로 만든 것은 객체에 `inferred`: slur 전부, 인쇄 안 된 tuplet run, part, 후보가 여럿이던 tie. `scoreNotationInferred`는 App `inferredAudioNotation`과 11 경우에서 같은 답 (앱 함수를 파일에서 꺼내 돌려 비교).
- staff 없는 8va: plan이 part의 모든 staff에 적용. E18에서 plan이 적힌 자리를 옮기는 음의 집합 = `Score.finalize`가 옮기는 음의 집합, `fromScore` 뒤 plan도 같은 적힌 음.
- 한 음 tuplet 병합의 부정 경우 20가지 (구현 14 + Fixer 6: 다른 graph beam, 안쪽에서 끝나는 slur, 안쪽에서 시작하는 slur, 안쪽 clef 변경, 인쇄 안 된 여러 음 tuplet, 부모가 있는 한 음 tuplet); 긍정: 묶음 전체의 slur, 한 beam 안 (괄호 없이 숫자만).

#### 32.12.4 G4-U1 — 실제 경로에서 다시 불러오기 (`tools/u1-paths.js`)

각 곡을 앱의 `startImport()`(업로드 버튼과 끌어 놓기가 부르는 것)로 들인다. 이 PC에 없는 것만 가장자리에서 바꿨다 (AMT 서비스 → `Import.finishHeard`에 G0 golden G16의 음; Audiveris → 커밋된 OMR fixture의 MusicXML). 그 뒤 페이지를 다시 불러 My Songs에서 곡을 연다.

| 경로 | 저장 전 | 저장 | 다시 불러온 뒤 |
| --- | --- | --- | --- |
| MusicXML (UI) | live | 됨 | store, 같은 fingerprint, link |
| MXL (UI) | live | 됨 | store, 같은 fingerprint |
| MIDI (UI) | live | 됨 | store, 같은 fingerprint |
| 녹음 → review → 저장 | live | 됨 | (곡은 아래 다시 쓰기로 바뀜) |
| 다시 쓰기 `rewriteRhythm()` → `saveNow()` | live | 됨 | — |
| 다시 쓰기 `rewriteFromHeard()` → `saveNow()` | live | 됨 | store, 마지막 다시 쓰기의 그래프 |
| 카탈로그 일치 (Für Elise) | live (XML thunk) | 됨 | store, 같은 fingerprint |
| OMR (사진) | live | 됨 | store, 같은 fingerprint |
| OMR fallback (PdfLayer처럼 Score를 고침: 코드명) | projected, `SOURCE_DISAGREE` | 안 함 (`disagree`) | projected, link |

고치기 전 이 도구는 **다시 쓰기 두 경로가 live가 아니고 저장되지 않음**을 찾았다 (`SOURCE_DISAGREE` + `PROJECTION_DISAGREES`) — §32.12.5의 화음 tuplet 표시. 저장 실패의 세 경우는 `tools/storage-failure.js` (각 경우를 페이지의 첫 script 전에 만든다): **IndexedDB 없음** (persist `no-store`), **`indexedDB.open`이 throw** (`backend`, 다시 불러온 뒤 진단 `STORE_BACKEND`), **모든 쓰기가 `QuotaExceededError`** (`quota`) — 셋 다 `startImport`로 곡이 생기고, 다시 불러와 열고 연습 화면에서 legacy 렌더러가 그리며(음 8), 그래프는 projected·link, page error 0.

#### 32.12.5 A48 — 앱이 실제로 가진 Score (`tools/a48-coverage.js`)

| 모집단 | 고치기 전 | 고친 뒤 |
| --- | --- | --- |
| G0 core 553 녹음: `built.graph`와 `parseMusicXML(built.xml)`이 같은 음악 (live) | 453 / 553 | **553 / 553** |
| 같은 Score에서 `fromScore` → agree (projected) | 453 / 553 | **553 / 553**, link 553 |
| 곡 slot 왕복 (`packScore` → JSON → `unpackScore` → `Score.finalize`) — live / projected | 453 / 453 | **553 / 553** |
| 이전된 옛 녹음 (`migrateSavedTranscription`) → projected | 453 | **553 / 553** |
| 코퍼스 318 파일 (hold-out 없음)을 앱의 옛 reader(`parseMusicXML`/`readMxl`)로 → projected | 301 / 318 | **311 / 318** |
| OMR fixture (인식 그대로 / PdfLayer가 코드명·8va를 쓴 뒤) | 둘 다 통과 | 둘 다 통과, link |

- 고치기 전의 100개 실패는 **전부 `notes.tupletStart` 하나**: 첫 event가 화음인 셋잇단을 앱의 reader는 `<tuplet>`을 가진 음 하나에만, `toScore`는 모든 head에 표시했다. 순서의 문제이지 음악이 아니다 → G4-F8.
- 코퍼스의 남은 7: 그래프가 거절하는 것을 Score가 말한다 — 여는 곳 없이 닫히는 ending 2 (`ending-stop-without-start`), 짝 없는 hairpin 4 파일 (`wedge-stop-without-start`, `wedge-unclosed`, `refused-by-graph:spanner`), 타악기 1 (`percussion-or-unpitched`). 전부 `unsupported`에 이름이 있고, 음은 모두 되살아나 (타악기 제외) projected source가 음마다 link한다. G1 sg-roundtrip의 허용 목록과 같은 부류다.
- core 553에는 hold-out 사례가 없다 (0).

#### 32.12.6 fixture · 코퍼스 · L1 (G4-F11)

- **E01–E40** (`tests/engrave/fixtures/e/`, `tools/make-e-fixtures.js`, `--check`): 480 divisions, 40 주제 전부. 모두 열리고 화면·인쇄 모드 audit 통과, 그래프 불변, 결정론. `e-fixtures.test.js`가 주제마다 plan의 처리를 확인한다 (예: E04 show-none·printed-false suppressed, E07 두 병합 + 격자 밖 3개 one-note, E14 grace-after deferred 1, E18 staff 없는 8va, E26 cross-staff-chord deferred, E27 타악기는 쉼표가 아닌 음, E28 인쇄에서만 여러 마디 쉼표, E38 파생 beam과 병합, E39 beam과 같은 셋잇단은 숫자만).
- **R 코퍼스** `tests/engrave/corpus.json` (`tools/make-corpus.js`, seed `g4-r-2026-09-25`): 61 파일 (찬송가 10, Beyer 10, Czerny 599 10, Czerny 849 8, 소나티네 10, Burgmüller 25 7, Hanon 3, 카탈로그 3). 격리 15와 **hold-out 52 제외** (52는 전부 층 안에 있었고 전부 뺐다). `helpers.corpusFiles()`도 hold-out을 뺀다 → G4 테스트 코퍼스 347 파일.
- **L1** (`tools/bench.js run|check|baseline --suite r|e|x`; baseline `tests/engrave/baselines/`; CI gate에 r·e·x): 0이어야 하는 지표(silent·invented·duplicate·missing·altered·orphan·unapproved·uncoded, 그래프 변경, 비결정, 오류, beam 파생 in beamed part, beam orphan, printed:false 그림) 전부 0; 1이어야 하는 비율(graph beam drawn·members, tuplet drawn·show, tie, slur pair, event multiset, staff 배정, source agree live·projected) 전부 1.

| suite | 그래프 | deferred | 파생 beam | 병합 묶음 |
| --- | --- | --- | --- | --- |
| r | 61 | grace-after 2 | 416 | 0 |
| e | 40 | cross-staff-chord 1, grace-after 1 | 6 | 3 |
| x (전사 17, G3a 17, MIDI, projected 13) | 76 | 없음 | 445 | 30 |

  e의 E27(타악기)만 projected agree가 허용 목록으로 통과 (`percussion-or-unpitched`, 세어 보고).
- hold-out 없는 코퍼스 347 + 전사 17 + G3a 17 = 381 그래프, 화면·인쇄 모드: audit 결함 0.

#### 32.12.7 IndexedDB · 저장 성능 (`tools/perf-persist.js`, 실제 페이지)

| 곡 | 음 | 글 | CPU | hash | agree | serialize | gzip | persist 전체 | long task | resolve store / projected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sonatina 020 | 1,916 | 376 KB | 1× | 8.9 | 12.6 | 7.3 | 7.2 | 185 ms (idle 사이) | **0** | 41 / 61 ms |
| Sonatina 013 | 1,380 | 361 KB | 1× | 5.5 | 9.3 | 3.5 | 4.8 | 154 ms | **0** | 36 / 48 ms |
| Czerny 849/001 | 588 | 138 KB | 1× | 3.3 | 4.6 | 1.2 | 3.5 | 206 ms | **0** | 18 / 22 ms |
| Sonatina 020 | 1,916 | 376 KB | 4× | 42.7 | 60.7 | 22.3 | 23.4 | 397 ms | **0** | 191 / 316 ms |
| Sonatina 013 | 1,380 | 361 KB | 4× | 33.9 | 46.2 | 20.6 | 21.6 | 378 ms | **0** | 223 / 281 ms |
| Czerny 849/001 | 588 | 138 KB | 4× | 17.6 | 20.9 | 6.8 | 11.1 | 458 ms | **0** | 78 / 112 ms |

- 각 단계(ms)는 따로 잰 것이다. persist 전체는 단계마다 idle을 기다려서 길지만, **main thread를 50 ms 넘게 잡은 적이 없다**. 고치기 전(agree를 한 번에) 4×에서 Sonatina 020이 59 ms long task 하나 — G4-F9로 agree를 두 읽기로 나눠 없앴다.
- 축출: 가장 긴 그래프 200 record(저장 6,328 KB)에서 축출이 읽는 것 — 크기만: heap +39 KB; 예전처럼 getAll: +6,378 KB. 한도에서의 저장 한 번 16 ms (1개 축출).
- v1 → v2: 앞선 빌드가 남긴 v1 DB의 record가 올림 뒤 `keys()`에 보이고, 읽으면 이름 있는 code로 버려진다.
- 다시 불러온 곡의 `resolve`(G4b가 부를 것)는 4×에서 Sonatina 020 191 ms(store) / 316 ms(projected) — G4b에서 idle·조각으로 나누거나 worker로 옮길 일 (§32.12.1 #23).

#### 32.12.8 결정론 · 보이는 변화

- plan: 모든 fixture·코퍼스에서 두 번 바이트 동일 (L1 `eg.plan.nondeterministic = 0`).
- **A45**: `55d1bd5`를 `git archive`로 따로 띄워(8794) 이 트리(8793)와 legacy 렌더 16개 비교 — **16/16 바이트 동일**.
- 사용자에게 보이는 변화: 없음. 보이지 않는 변화: script 8개(`glyphs.js` 추가), idle 때 IndexedDB `ppp-engrave` v2에 그래프 한 벌.

#### 32.12.9 회귀

최종 트리에서 (브라우저 도구는 이 worktree를 8793에, `55d1bd5`의 `git archive`를 8794에 띄워서):

| 검사 | 결과 |
| --- | --- |
| `npm run test:engrave` | **84/84** (16 파일; Implementer 50) |
| `npm run test:scoregraph` | **205/205** |
| G0 unit (`python -m unittest … tests/bench/unit`) | **283 OK** |
| `run.py golden` | 17/17 동일 |
| `run.py correctness` | 13/13 |
| `run.py sg-roundtrip` | 369 파일, 수 그대로 (L1 368, L1+ 367, L2 369, play order 369 — 차이는 기존 허용 목록) |
| `run.py lint-corpus` | 오류 0 |
| smoke / core `run` + `check` | PASS / PASS (SQI 86.907 / 76.862 — 전과 같음) |
| `run.py ab --suite core --a git:55d1bd5 --b worktree` | **PASS, 553 case 중 진단 점수가 바뀐 case 0**, usable 18.1 % 양쪽 같음 |
| `run.py mutation-check` (nightly) | **PASS 49/49**, no-op 둘은 동일 |
| `make-e-fixtures.js --check`, `make-corpus.js --check` | 동일 |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS |
| `tools/legacy-parity.js` (A45, 8794 대 8793) | **16/16 바이트 동일** |
| `tools/app-source-check.js` | 전부 통과 |
| `tools/u1-paths.js` | 9 경로 전부 통과 (§32.12.4) |
| `tools/storage-failure.js` | 3 경우 전부 통과 |
| `tools/a48-coverage.js` | §32.12.5 |
| `tools/perf-persist.js` | §32.12.7 |
| 브라우저 suite 26개 (각각 따로, **이 트리에 대고** — `tools/with-port.js`로 8777을 8793으로, 페이지의 `PPPEngrave.version`이 `0.1.1-g4a`임을 확인) | **24 통과**. 실패 2: `transcription` ("the fallback is the venv transkun console script" — 이 PC에 transkun venv 없음), `share` ("the link says what it is before it opens (Open Graph)") — **둘 다 같은 harness로 `55d1bd5`(8794)에서 똑같이 실패** (테스트 파일은 G4가 바꾸지 않음) → G4a 원인 아님 |

Fixer가 이 과정에서 스스로 만든 결함 하나를 고쳤다: `legacy-score.js`를 NUL 두 개 때문에 latin1로 읽고 써서 새 주석의 `§`가 UTF-8이 아닌 한 바이트(0xA7)로 저장됐고, G0 unit의 SUT 사본 테스트 2개가 `UnicodeDecodeError`로 실패했다. 그 바이트를 UTF-8로 되돌린 뒤 283 OK. 이 세션이 고친 파일은 모두 UTF-8로 검사했다.

#### 32.12.10 남은 것과 G4b에 넘기는 것

- **BLOCKER 0, MAJOR 0** (§32.12.1: 리뷰의 MAJOR 10개와 MINOR는 FIXED, 하나는 NOT ISSUE로 결정 유지, 넷은 G4b·schema로 DEFERRED — 모두 G4a가 그리지 않는 동안에는 사용자에게 닿지 않는다). **상태: READY_FOR_REVIEW** — 한 번 더 독립 리뷰를 받는다. 병합 안 함.
- G4b로: vendored VexFlow의 전송(`no-store`, gzip 없음 → 992 KB 매번; CDN은 브라우저 캐시), 다시 불러온 곡 `resolve`의 비용, 8va 적힌 음의 표시(§8.3의 concert − shift는 legacy의 `writtenP` 표시와 한 옥타브 다르다 — 재생은 이슈 3; flip 전에 사용자 결정), 명시된 `bracket="yes"`(schema).
- 8791·8792 포트에 Implementer의 parity 서버 두 개가 남아 있다 (G4a 이전 사본과 기준 빌드). 이 세션의 것이 아니어서 끄지 않았다.

#### 32.12.11 커밋

- Fixer: `0f3d275` (코드·테스트·fixture·도구·vendor 고지·문서), 이 해시를 적은 문서 커밋이 그 다음. push하지 않았다 (브랜치의 origin은 `c3d6aa6`). 병합 안 함.
- Fixer 커밋 뒤, 같은 worktree에서 다른 세션이 `engrave/plan-tuplets.js`와 `tests/engrave/plan.test.js`를 고치고 있었다 (beam이 있는 part에서 한 음 tuplet 병합을 "그 묶음과 정확히 같은 graph beam"일 때만 허용, cross-staff head 경계). Fixer는 그 변경을 커밋하지도 건드리지도 않았다 — 그 세션의 일이다. 위의 수(§32.12.2–§32.12.9)는 `0f3d275`의 것이다.

### 32.13 최종 — 최종 리뷰의 BLOCKER·MAJOR를 닫음 (owner finalize, 2026-09-25)

입력: G4a 최종 독립 리뷰 (`c3d6aa6` 대상: **BLOCKER 1, MAJOR 5**, READY_FOR_G4b = NO)와 사용자 결정 G4-U5 (deferred 계약). Fixer 커밋 `0f3d275`·`2a83333` 위에서 마무리했다. **§32.1–§32.12의 수가 이 절과 다르면 이 절이 맞다.** 결정은 DECISIONS G4-U5, G4-F15–F21.

**작업 트리.** 최종 리뷰 뒤 두 세션이 같은 `D:/PPP-g4`를 고쳤다: Fixer(ppp-e2)와 이 세션(Implementer, 이후 사용자가 정한 단일 소유자). Fixer의 `0f3d275`는 이 세션이 그때 작업 트리에 둔 앱 편집 넷(review 화면의 `saveNow`, G4-F16)을 함께 담았다 — 의도한 변경이고 이 세션의 것이다. §32.12.11이 "다른 세션"이라 부른 `plan-tuplets.js`·`plan.test.js` 편집도 이 세션의 것이다 (G4-F15). 사용자가 소유를 정한 뒤 Fixer 세션은 편집·커밋을 멈췄다 (확인). 이 세션은 reset·stash·clean·checkout 없이 이어받았다.

**G4b 누수: 없음.** 이어받은 diff 전체를 읽었다. `engrave/glyphs.js`는 그리는 코드가 아니라 장식음 → SMuFL 이름 표이고, 이 절에서 대체 glyph 선택(G4d의 일)을 빼서 **처분만** 정하게 했다 (G4-F21). EngravedScore·layout·충돌·renderer 스위치·인쇄·VexFlow 로딩은 없다.

#### 32.13.1 최종 리뷰 지적의 처리

| 지적 (최종 리뷰) | 처리 | 증거 |
| --- | --- | --- |
| **BLOCKER** 한 음 tuplet 병합이 graph beam을 무시 (G4-U2 B) | **FIXED** — G4-F15: beam을 쓰는 part에서는 그래프 beam 하나가 묶음과 정확히 같을 때만 병합; 그 밖은 경계·애매 → 병합 없음 | §32.13.3; mutation F-1·F-2 KILLED |
| **MAJOR** ledger audit의 소비 쪽이 plan의 자기 보고 (29/48 생존) | **FIXED** — Fixer G4-F1(출력 배열을 읽는 `consumed`) + 이 절의 테스트 | §32.13.2: 57/57 KILLED |
| **MAJOR** deferred 허용 목록 미강제 | **FIXED** — G4-U5, 코드(`ledger.CODES`)·테스트로 강제 | §32.13.4 |
| **MAJOR** A48 범위 (504 파일, core 553, 비교 필드) | **FIXED** — G4-F20 (Node gate + 페이지 gate, 엄격 비교기) | §32.13.7 |
| **MAJOR** E01–E40·`corpus.json`·`bench.js` L1 | **FIXED** (Fixer G4-F11), 다시 확인 | §32.13.8 |
| **MAJOR** review 화면의 다시 쓰기·편곡·Accept가 저장되지 않음 | **FIXED** — G4-F16 (앱 네 곳 `saveNow`) | §32.13.5 (반대 대조 포함) |
| MINOR 저장소 읽기가 다른 Score의 기록을 지움 | **FIXED** — G4-F17 | `source.test.js`; mutation F-5 |
| MINOR `fromScore` slur 짝이 앱과 다름 (FIFO) | **FIXED** — G4-F18 | `fromscore.test.js`; mutation M-t |
| MINOR `fromScore` provenance | **FIXED** (Fixer G4-F6) | `fromscore.test.js` P5 |
| MINOR 저장된 그래프 검증, eviction·getAll, `onversionchange`, 거절된 pending, 글꼴 고지 | **FIXED** (Fixer G4-F4, F5, F3, F13) + pending은 저장 실패 → 회복 → 성공 테스트 추가 | mutation F-4 |
| MINOR stated stem 검사가 비어 있음 (앞 80 그래프에 stem 0) | **FIXED** — 코퍼스 전체, stated stem 수 > 10,000을 요구 | mutation M-p |
| MINOR/OPTIONAL tuplet placement·bracket 기본값 테스트 없음 | **FIXED** | mutation M-o, N-ae |
| MINOR projected memo 규칙 테스트 없음 | **FIXED** | mutation N-af |
| (최종 리뷰 이후 이 절이 찾음) 앱의 `finalize`가 staff 순서로 정렬한 Score에서 `fromScore`가 staff를 넘는 화음을 둘로 나눔 | **FIXED** — G4-F19 | A48 (A); mutation F-7 |
| (Fixer 작업 중 보고된) gzip에 쉼표로 이은 바이트 목록 | **이 트리에는 없음** — 저장되는 것은 canonical 글의 UTF-8 바이트, `node:zlib`로 풀어 확인 | §32.13.6; mutation F-6 |

#### 32.13.2 ledger mutation (A1)

- 기대 = 그래프 (`ledger.expected`), 소비 = plan의 **출력 배열**을 다시 도는 `ledger.consumed` (그래프·ledger를 읽지 않음, 정적 테스트). `plan.index`는 없다.
- **최종 리뷰의 48 mutation을 지금 코드에 다시 고정 + 이 절의 9 = 57, 전부 KILLED** (각 mutation을 작업 트리 사본에 적용하고 `node --test tests/engrave/**/*.test.js` 전체; 대조군 fail 0). 리뷰에서 살아남았던 29개 — 출력에서 뺀 articulation·pedal change·slur·8va·방향·fingering·accidental·가사·tempo 표시·hairpin·clef·pedal 기호·fermata, 숨김 flag, slur 양끝·tie 양끝 뒤바꿈, 아무 code로 미룬 slur·articulation, 병합 비율, 중첩 제외, tuplet placement·bracket 기본값, stated stem, 8va staff, `fromScore` slur 짝, store 경로 link, projected memo — 모두 이제 실패한다.
- 이 절의 9: 병합이 beam 무시(F-1), beam이 묶음과 정확히 같지 않아도 병합(F-2), slur 끝 무시(F-3), 실패한 저장이 pending으로 남음(F-4), 다른 Score의 기록 삭제(F-5), 쉼표 목록 gzip(F-6), 화음을 음 순서로 묶음(F-7), unsupported가 audit 통과(F-8), 인쇄 제목 영역을 drawn으로(F-9).
- CI에 커밋된 부분: `tests/engrave/ledger-mutation.test.js` — **27 mutation + no-op 대조군**, 각각 anchor가 한 번, 출력이 실제로 바뀜, 그 범주로 audit 실패 (tie·slur·pedal change·fingering·accidental·clef·articulation·숨김 flag 포함).

#### 32.13.3 한 음 tuplet 병합의 경계 (G4-U2 B, G4-F15)

부정 경우 (병합 없음, 각 tuplet은 그래프대로 one-note로 그림): 격자 밖, 틈, 셋 중 둘, 다른 비율, 다른 staff, 다른 성부, 명시적 `show` (한 멤버에·모든 멤버에 같은 숫자), 단위 없는 다른 음가, 사이 꾸밈음, 같은 성부-마디의 여러 음 tuplet (인쇄되든 안 되든), 못갖춘마디, 숨김 멤버, `printed:false` 멤버, 세로줄 넘김, 여러 음 tuplet 아래 중첩, **한 음 tuplet 안의 한 음 tuplet** (성부-마디 규칙이 막지 않는 유일한 중첩), 다른 graph beam 두 개에 걸침, **리뷰의 반례 beams [0,1] [2,3] [4,5]**, **묶음 모서리를 넘는 beam [0..3]**, 두 묶음을 덮는 beam [0..5] (애매), 묶음 일부만 덮는 beam, beam을 쓰는 part의 깃발 음, 안쪽에서 끝나는·시작하는 slur, 안쪽 clef 변경, 다른 staff의 head를 가진 멤버. 긍정: beam 없는 part의 셋잇단 둘 (6개 → 3+3), 묶음 전체 slur, 묶음과 정확히 같은 graph beam (숫자만), 묶음마다 정확한 beam 둘 (3+3). 반례에서 그래프의 beam 셋과 tuplet 여섯은 그대로 그려지고 audit은 깨끗하다. 코퍼스·전사의 병합 수는 그대로다 (L1 x 30, e 3, r 0).

#### 32.13.4 deferred 계약 (G4-U5)

- deferred 허용 = §21.1의 여섯 (cross-staff-chord, cross-staff-beam, tab, nested-3, grace-after, stem-double) + **title-block** (인쇄 제목 영역 중 title·composer 밖, G4e; 화면에서는 설계대로 suppressed `print-only`) + **ornament-glyph** (schema가 아는 장식음 중 고정 글꼴에 glyph가 없는 inverted-turn·shake·schleifer, G4d). 그 밖의 code는 audit `unapproved`.
- **unknown-spanner / unknown-ornament는 deferred가 아니다**: `unsupported` (진단 `UNSUPPORTED_SPANNER`/`UNSUPPORTED_ORNAMENT`, audit `unsupported`로 항상 실패). 유효한 그래프에서는 닿지 않는다 — 검증되지 않은 그래프로 테스트.
- **projected-loss** 유지 (Fixer G4-F2).
- 코퍼스 347 + 전사 17 + G3a 17 = 381 그래프, 두 모드: 화면 — grace-after 67, cross-staff-chord 1; 인쇄 — title-block 201, grace-after 67, cross-staff-chord 1; unsupported 0. 테스트가 이 합계의 모든 code를 허용 목록과 대조한다.

#### 32.13.5 G4-U1 — 실제 UI에서 다시 불러오기 (`tools/u1-paths.js`, 최종 트리)

이 도구는 이제 **스스로 저장하지 않는다** (Fixer 판은 다시 쓰기 뒤 `saveNow()`를 불러 이 MAJOR를 가렸다). review 화면의 변경마다 새 녹음 곡을 만들고, 변경 하나, 앱 자신의 저장만, 다른 곡을 열지 않고 **곧바로 다시 불러온다**. helper의 `/arrange-score` 요청은 막아 앱의 브라우저 편곡으로 간다 (사용자의 helper를 쓰지 않음).

| 경로 | 저장 전 | 앱이 저장 | 다시 불러온 뒤 |
| --- | --- | --- | --- |
| MusicXML (`startImport`) | live `import:musicxml` | 됨 | store, 같은 fingerprint, link |
| MXL | live `import:mxl` | 됨 | store, 같은 fingerprint |
| MIDI | live `import:midi` | 됨 | store, 같은 fingerprint |
| 녹음 → review | live `recording` | 됨 | store |
| review: 리듬 다시 쓰기 | live `rewrite` | 됨 | **곧바로 다시 불러와 store, 같은 그래프** |
| review: 쉬운 편곡 | live `rewrite` | 됨 | **곧바로 store, 같은 그래프** |
| review: 편곡 (intermediate, balanced) | live `rewrite` | 됨 | **곧바로 store, 같은 그래프** |
| review: 다시 쓰기 → Accept | live `rewrite` | 됨 | **곧바로 store, 같은 그래프** |
| review: 스타일 편곡 (jazz, 편곡기가 Score에서 만듦 — 그래프 없음) | projected | 저장할 그래프 없음 | projected + `STORE_OTHER_SCORE`, link — 낡은 그래프를 쓰지 않음 |
| 카탈로그 일치 | live `catalog-match` | 됨 | store, 같은 fingerprint |
| OMR (사진) | live `omr` | 됨 | store |
| OMR fallback (PdfLayer처럼 Score를 고침) | projected + `SOURCE_DISAGREE` | 안 함 (`disagree`) | projected, link |

- **반대 대조**: 앱의 `saveNow` 넷을 되돌린 사본으로 같은 도구를 돌리면 **5개 검사가 실패한다** — 리듬·쉬운 편곡·편곡·Accept가 다시 불러온 뒤 projected (`STORE_OTHER_SCORE`), 최종 리뷰의 MAJOR 그대로. 고친 트리에서는 전부 통과.
- 저장 실패 (`tools/storage-failure.js`): IndexedDB 없음·`open`이 throw·`QuotaExceededError` — 곡이 생기고, 다시 불러와 열리고, 연습 화면에 그려지고(음 8), 그래프는 projected·link, page error 0.
- 페이지 검사 (`tools/app-source-check.js`): 전부 통과 (손상 → `STORE_DECODE_FAILED`, 이름 대고 지움; 삭제 → 그래프도 지워짐).

#### 32.13.6 gzip / fingerprint

`store.encode`는 canonical 글(`SG.serialize`)의 **UTF-8 바이트**(`TextEncoder`, typed array)를 gzip하고, fingerprint는 그 바이트의 FNV-1a 64다. 테스트: `node:zlib`의 `gunzipSync`로 저장된 데이터를 풀면 canonical 글과 바이트 단위로 같다 (한글·ü·♩가 든 제목으로 — 바이트와 글자 수가 다른 경우), 새로 쓴 record가 자기 `decode`(fingerprint·schema·validate)를 통과한다, store를 거쳐 읽은 그래프의 fingerprint가 같다. 리뷰가 본 "쉼표로 이은 바이트 목록" 결함은 이 트리에 없다 — mutation F-6(그 결함을 다시 넣음)이 11개 테스트로 실패한다.

#### 32.13.7 A48

| 모집단 | gate | 결과 |
| --- | --- | --- |
| (A) 커밋된 import 파일 전부 — 앱이 import 뒤 가진 모양 `Score.finalize(toScore(graph))` (앱의 `finalize`를 파일에서 꺼내 씀) | `tests/engrave/a48.test.js` (Node, CI) | **544/544 열림** (G04가 센 504 + E fixture 40): **540 정확**, 4는 알려진 손실만 — 타악기 2 (`percussion-or-unpitched`, 음 수), `transposing` (`transposition`, `writtenP`·`writtenMidi`), `microtone` (`microtone`, `approx`). 새 손실 0 |
| (B) G0 core 553 녹음의 `parseMusicXML` Score — live·projected·곡 slot 왕복·이전된 옛 녹음 | `tools/a48-coverage.js` (페이지, exit 1이면 실패) | **553/553 네 검사 모두 정확**, link 553 (core에 hold-out 없음) |
| (B') 코퍼스 318 (hold-out 없음)을 앱의 옛 reader로 | 같은 도구 | **311 정확 + 이름 있는 손실 7** (여는 곳 없는 ending 2, 짝 없는 hairpin 4, 타악기 1 — 각 파일·code·필드로 허용) |
| (B'') OMR fixture (인식 그대로 / PdfLayer가 코드명·8va를 쓴 뒤) | 같은 도구 | 2/2 정확, link |
| (C) 앱에서 잡은 Score 13 (녹음, parse, import, slot에서 다시 읽음, 기본 곡) | `a48.test.js` | 13/13 정확 |

- 비교기 `tests/engrave/a48-compare.js` (두 gate가 같이 씀): 앱이 가진 모든 음 필드 + `writtenP`·`writtenMidi`·`approx`·`soundingMidi`·`ottavaShift`·`abs`, 마디 필드별(`measures.bar` 등), 모든 목록, 중첩 객체는 키 순서·부동소수 잡음 없이. 화음에 속한 flag는 화음에서 읽는다 (G4-F8과 같은 규칙). 비교기가 눈멀지 않았음을 테스트가 보인다 (적힌 음, 근사, 8va shift, 음 하나 빠짐 → 각각 다름).
- 손실 허용은 **파일 + fromScore가 댄 code + 그 code가 바꿀 수 있는 필드**로만 — 허용 목록의 파일이 더 이상 잃지 않아도 실패한다 (목록에서 빼라고).
- 처음 돌렸을 때 이 gate가 찾은 것: staff를 넘는 화음 두 파일 (G4-F19로 고침), 비교기의 거짓 차이 셋 (마디 객체의 키 순서, clef 변경 위치의 부동소수 잡음 — 비교기를 고침).

#### 32.13.8 E01–E40 · 코퍼스 · L1 (다시 확인)

`make-e-fixtures.js --check` 동일 (40), `make-corpus.js --check` 동일 (61 파일, seed `g4-r-2026-09-25`, 격리 15·hold-out 52 제외), `bench.js check --suite r / e / x` PASS / PASS / PASS. baseline 세 개에 새 zero-target 지표 `eg.ledger.unsupported: 0`만 더했다 (다른 수는 그대로 — 병합 x 30, e 3, r 0; 파생 beam r 416).

#### 32.13.9 회귀 (최종 트리)

최종 트리에서 (`npm`·`run.py`는 작업 트리; 브라우저 도구는 이 트리를 8795에, `55d1bd5`의 `git archive`를 8792에 띄워서):

| 검사 | 결과 |
| --- | --- |
| `npm run test:engrave` | **95/95** (14 파일), 두 번 연속 |
| `npm run test:scoregraph` | **205/205** |
| G0 unit | **283 OK** |
| `run.py golden` / `correctness` | 17/17 동일 / 13/13 |
| `run.py sg-roundtrip` | 369 파일, 367 + 2 허용 목록 (그대로) |
| `make-midi-fixtures.js --check` | 동일 |
| `run.py lint-corpus` / `make_provenance.py --check` | 오류 0 / 일치 |
| smoke / core / robust `run` + `check` | PASS / PASS / PASS (SQI 86.907 / 76.862 / 76.550 — 전과 같음) |
| `run.py run --suite replay-public` | PASS |
| `run.py ab --suite core --a git:55d1bd5 --b worktree` | **PASS — 553 case, 진단 점수가 바뀐 case 0**, critical gate 비율 전부 baseline과 같음 (usable 18.1 %) |
| `run.py mutation-check` (G0 nightly) | **PASS 49/49**, no-op 둘 동일 |
| `make-e-fixtures.js --check` / `make-corpus.js --check` | 동일 / 동일 |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS |
| engrave source mutation (§32.13.2) | **57/57 KILLED** |
| `tools/legacy-parity.js` | **16/16 바이트 동일** |
| 페이지 스냅숏 (§32.13.10) | 60/62 동일, 둘은 선언된 차이 |
| `tools/app-source-check.js` · `u1-paths.js` · `storage-failure.js` · `a48-coverage.js` | 전부 통과 |
| 브라우저 suite 26개 (각각 따로, 이 트리 8795에 대고 — 테스트 소스의 8777을 바꾸는 preload) | **25 통과**. 실패 1: `transcription` ("the fallback is the venv transkun console script") — `55d1bd5`(8792, 그 트리의 테스트)에서 **같은 한 줄** (둘 다 84 통과 + 이 실패), 이 PC에 transkun venv가 없음 → 환경 |

#### 32.13.10 보이는 변화 (A45)

- `tools/legacy-parity.js` (`55d1bd5`의 `git archive`를 8792, 이 트리를 8795): **16/16 바이트 동일**.
- 페이지 스냅숏 (최종 리뷰어의 도구: 모든 사이드바 페이지 DOM, 업로드 5개의 가까이·전곡 SVG, method-book 곡, My Songs와 썸네일 — 다시 불러오기 전·후·삭제 뒤, localStorage 전체): **62개 중 60 동일**, 다른 둘은 선언된 것 — script 태그 8개 (`engrave/*.js`), IndexedDB `ppp-engrave`. page error 0/0, console 경고·오류 4/4 (기존), 실패한 요청 0/0.
- 사용자에게 보이는 판각 변화: **0**. legacy 렌더러가 기본이고 그대로다. G3는 전부 off.

#### 32.13.11 남은 MINOR / OPTIONAL

- MINOR: 저장은 곡이 바뀔 때 바로 일어나지만 그래프 쓰기 자체는 idle을 기다린다 (보통 100 ms 안) — 그 사이 탭을 닫으면 그래프를 못 남기고, 다시 불러오면 진단 없이 projected. 곡 slot은 남는다.
- MINOR: 음악이 맞지 않는 projection(`PROJECTION_DISAGREES`)도 `via: 'projected'`로 그래프와 함께 돌아온다 (예: 타악기). G4b는 그리기 전에 `agree.ok`를 봐야 한다.
- MINOR: 여러 staff에 걸친 파생 beam은 plan 객체에 `deferred: 'cross-staff-beam'`, ledger에는 `derived`로 적힌다 (둘이 다른 말).
- MINOR: `app-source-check.js`의 "legacy 렌더러가 그대로 그린다"는 그려진 음 묶음이 0보다 많은지만 본다 (전후 비교 아님; 바이트 비교는 `legacy-parity.js`가 한다).
- MINOR: 다른 Score·낡은 기록은 이제 지우지 않으므로, 그래프 없는 곡(스타일 편곡 등)의 옛 기록은 다음 저장이나 축출(200곡, 64 MB)까지 남는다 — 쓰이지는 않는다.
- OPTIONAL: `engrave/*.js` 8개가 `<head>`에서 막는 script로, `no-store`로 매번 받는다 (합 약 70 KB). OMR 곡은 persist 때 MusicXML을 다시 읽어 agree가 실패한다 (한 번, 저장 없음). `CURRENT_STATE`의 G0 unit 수는 이 절에서 283으로 고쳤다.
- G4b로 (Fixer §32.12.10과 같음): vendored VexFlow 전송, 다시 불러온 곡 `resolve`의 비용, 8va의 적힌 음 표시, 명시된 `bracket="yes"`.

#### 32.13.12 커밋

- `c77cd30` fix: satisfy G4a semantic and persistence acceptance (코드와 그 테스트), `77baa39` test: complete G4a corpus and coverage gates (A48 gate, ledger mutation, store, U1 도구, L1 baseline), 이 절을 담은 문서 커밋 — 모두 `2a83333` 위. review 화면의 `saveNow` 넷(G4-F16)은 `0f3d275`에 있다. 각 코드 커밋은 Windows CRLF checkout(`git checkout-index`)에서 `test:engrave`가 통과함을 확인했다. 브랜치만 push, PR·병합 없음.
- **상태: READY_FOR_FINAL_REVIEW** — BLOCKER 0, MAJOR 0 (§32.13.1). G4b는 시작하지 않았다.


### 32.14 마감 — 병합과 G4b로 넘기는 것 (2026-09-25)

- **최종 독립 리뷰** (`39b3bcc`, 서로 독립인 리뷰어 셋: 코드·테스트, 실행 UI·parity, 회귀 gate): **BLOCKER 0, MAJOR 0, MINOR 6, OPTIONAL 5 — PASS, READY_FOR_G4b.** 앞선 최종 리뷰의 BLOCKER 1(한 음 tuplet 병합)과 MAJOR 5(ledger/A1, 저장·다시 불러오기, E/코퍼스/L1, A48, deferred 계약)는 모두 PASS. 회귀 gate는 깨끗한 clone에서 전부 재현 (`ab --a git:55d1bd5 --b git:39b3bcc`: 553 case 모두 같음, `mutation-check` 49/49), 보이는 parity: legacy SVG 16/16 + 페이지 스냅숏 64/64 (선언된 script 태그·IndexedDB 제외), engrave source mutation 57/57 재현.
- **병합**: PR #9 (`g4-professional-engraving` → `main`), CI gate 초록, mergeStateStatus CLEAN, squash `df8a571` — 트리는 리뷰한 `39b3bcc`와 같다. 브랜치는 남겨 둔다. **G4a는 CLOSED — 다시 열지 않는다.**
- **G4b backlog (최종 리뷰의 MINOR — G4a를 다시 여는 이유가 아니다)**:
  1. `resolve()` can wait forever when IndexedDB `open` never settles - add a timeout and fallback before G4b awaits it
  2. the A48 page gate (`tests/engrave/tools/a48-coverage.js`) must assert its population (553 core, 318 corpus) and flag a stale allowlist entry, not accept fewer cases
  3. sibling (parent-less) tuplets on one event: the one-note merge must treat them conservatively (no merge)
  4. the one-note merge must respect the meter's beat groups (6/8, 5/8 grouped 3+2), not only multiples of the tuplet span from the bar line
  5. tuplet display attributes (show number, bracket, placement, printed) belong in the ledger audit's semantic signature
  6. deferred codes must be tied to the kinds they may apply to, not only to an allowed code string
  그 밖의 MINOR·OPTIONAL: 저장 뒤 그래프 쓰기가 idle을 기다리는 동안(측정 160–235 ms) 다시 불러오면 그 곡은 projected로 남는다 (`STORE_OTHER_SCORE`, 곡 slot은 그대로); `u1-paths.js`는 앱 메서드를 부르고 helper의 `/health`를 막지 않는다; `a48-compare.js`의 화음 셈여림은 첫 것만 본다; `eg.tuplet.merged_groups`는 L1 비교에 없다; P3 테스트 하나는 pending 경로에 닿지 않는다 (§32.13의 새 테스트가 닿는다). §32.12.10의 G4b 몫(VexFlow 전송, `resolve` 비용, 8va 적힌 음 표시, 명시된 `bracket="yes"`)도 그대로다.
- **G4b 준비**: 같은 폴더 `D:/PPP-g4`, 최신 `origin/main`에서 브랜치 `g4b-layout-core` (upstream 없음). G4b는 시작하지 않았다.

## 33. G4b 구현 기록 — 배치 핵심 (layout core)

Implementer, 2026-09-25. 브랜치 `g4b-layout-core` (`D:/PPP-g4`), 시작 `a0bc2ea` (= `origin/main`, G4a 마감 뒤). 입력은 사용자가 준 "G4b IMPLEMENTER — LAYOUT CORE" 지시다. 병합하지 않았고 PR도 없다. 결정은 DECISIONS G4-B1–B10 (B11은 Fixer). 독립 리뷰의 MAJOR 셋(R1–R3)과 기록 정정은 Fixer가 닫았다 — §33.16.

**한 줄**: NotationPlan → EngravedScore(`engr/1`)를 Node와 브라우저에서 같은 수로 만든다 — 음·쉼표·임시표·점·덧줄·stem·flag, staff·clef·key·time·세로줄·반복·volta의 staff-space 좌표, 결정론적 hash, 줄바꿈(G4-U4), 충돌 검사, 연습 map과 highlighter. **사용자에게 보이는 변화는 없다**: 앱은 새 모듈을 불러오지 않고 legacy 렌더러가 그린다 (16/16 바이트 동일).

### 33.1 범위 — G04 §27의 G4b와 다른 점

§27의 G4b 범위 가운데 `svg.js`(`<symbol>`/`<use>`), 앱 ScoreView의 `renderer` 스위치와 새 `sync`, 브라우저 suite를 `renderer='engrave'`로 돌리기는 **하지 않았다.** 이번 지시가 "렌더러를 보이게 하지 않는다, production 변경 없음, G4c 이후 없음"으로 범위를 좁혔기 때문이다. 그래서 G4b acceptance 가운데 A30, A32의 브라우저 부분, A33, B9는 이 단계에서 판정하지 않고, A31은 Node의 결정론적 대리 지표(프레임마다 만지는 event 수)로 판정한다. 나머지(A14, A17–A19, A23, A24, A27–A29, B2–B4, B6, B7)는 §33.12. G4c(beam·최종 stem·tuplet 표시·성부·쉼표 판각), G4d(곡선·셈여림·아티큘레이션·글자 충돌), G4e(페이지·인쇄·PDF), G4f(production 스위치), G5는 시작하지 않았다. G3는 전부 off 그대로다.

### 33.2 G4a MINOR 여섯 (§32.14 backlog) — 먼저 닫음

| # | 문제 | 한 일 | 테스트 |
| --- | --- | --- | --- |
| A | IndexedDB `open`이 끝나지 않으면 `resolve()`가 영원히 기다림 | `store.js`: 모든 backend 호출에 `within(p, LIMITS.timeout = 2500 ms)`(timer는 `unref`), 넘으면 code `'timeout'`. `idbBackend(idb, {openTimeout})`: `open`이 안 끝나면 거부하고, 늦게 열린 연결은 닫는다(`finish(ok)` 가드), 다음 호출이 다시 연다. `source.resolve`는 store 실패를 `STORE_TIMEOUT`으로 기록하고 projected로 간다 — 앱은 멈추지 않는다 | `source.test.js`: 답하지 않는 store → 제한 시간 안에 projected + `STORE_TIMEOUT`, persist는 두 번 다 `'timeout'`(막히지 않음); 끝나지 않는 idb `open` → backend가 timeout으로 거부, 늦은 성공은 닫힘, `store.get` code `'timeout'` |
| B | A48 페이지 gate가 모집단을 확인하지 않음 | `a48-coverage.js`: 기록된 모집단 `EXPECTED = {core: 553, corpus: 318}`. core는 suite 정의(`pppbench` `suite.expand`)에서, corpus는 provenance 규칙(`helpers.corpusFiles`)에서 실행 때 다시 끌어내 기록과 비교. 기대 case마다 job 하나(생성·표기가 빠뜨린 case도 "not written"으로 남김), 결과가 없는 기대 case(suite 목록 기준)·파일은 실패, 허용 목록 항목이 모집단 밖이거나 더는 잃는 것이 없으면 실패 | 실행 PASS (core 553/553, corpus 318/318, 이름 있는 손실 7, OMR 2). **음성 대조 4개 모두 FAIL(exit 1)**: 기록 554 → population 1; 페이지 결과에서 core 하나 뺌 → population 1; corpus 하나 뺌 → population 1; 허용 목록에 잃는 것 없는 파일 + 없는 파일 → allowlist 2 (임시 사본으로 돌리고 지움) |
| C | 부모 없는 형제 tuplet이 한 event에 둘이면 병합 | `plan-tuplets.js`: 한 음 tuplet 후보는 그 event에 걸린 tuplet이 정확히 하나일 때만 (`tupletsOn`) | `plan.test.js` 형제 tuplet: 병합 없음 |
| D | 한 음 병합이 박자 묶음을 모름 (마디 줄에서의 배수만 봄) | `placedInMeter(gr)`: `meter-grid`의 `beats`·`groups`로 — 박 안에 들어가면 박 시작에서 span의 배수, 박을 넘으면 박 경계에서 시작·끝나고 한 묶음 안이거나 묶음 경계에서 시작·끝 | 6/8: 1/4에서 시작하는 세잇단 → 병합 안 함, 0에서 → 병합; 5/8(3+2): 1/4 → 안 함, 3/8 → 함; 4/4 4분 세잇단: 1/4 → 안 함, 0 → 함 |
| E | ledger 의미 서명에 tuplet 표시 속성이 없음 | `ledger.sig.tuplet`에 `[number, bracket, placement, printed]`. 그래프 쪽은 `show`+`printed`, plan 쪽은 출력(`number`, `bracketStated`, `placement`)으로 — plan은 그래프 tuplet에 `bracketStated`를 싣는다 | `ledger.test.js`: `show {number:'both', bracket:false, placement:'below'}`에서 셋 중 하나를 떨어뜨리면 `altered`; mutation `L-TUPLET-BRACKET` (E04) |
| F | deferred code가 적용될 kind와 묶이지 않음 | `ledger.CODE_KINDS`: status → code → 허용 kind (`null`이면 아무 kind). `CODES`는 여기서 끌어냄, `codeFits(status, code, kind)`; 맞지 않으면 audit `unapproved`에 `ref kind status:code` | `ledger.test.js`: note/stem-double, slur/ornament-glyph, articulation/title-block, tie/show-none → unapproved; stem/stem-double, E04 tuplet/nested-3 → 없음; mutation `L-KIND-CODE` |

ledger mutation은 27 → 29, 전부 잡힌다.

### 33.3 모듈

`engrave/` (UMD, Node와 브라우저, DOM·시계·난수·네트워크 없음 — 정적 검사):

| 파일 | 하는 일 |
| --- | --- |
| `metrics.js` | glyph bbox 표. **생성된다**: `tests/engrave/tools/make-metrics.js`가 vendored VexFlow 4.2.3의 Bravura outline에서 66개 glyph의 `[xMin, xMax, yMin, yMax]`를 sp로 (1 em = 4 sp, 0.001 sp) — `--check`가 CI에 있다. 그 밖에 판각 상수(`ENGRAVING`: 보표선 0.13, stem 0.12, stem 길이 3.5, 덧줄 0.16·돌출 0.2, 세로줄 0.16/0.5/간격 0.4, 점 간격 0.3/0.2, 임시표 간격 0.2 …), 크기 비율(꾸밈음 0.66, clef 변경 2/3), 표기 → glyph 이름(음표머리 모양·채움, 임시표 조합, 쉼표, flag, clef, 숫자). 고정 글꼴에 없고 VexFlow가 path로 그리는 모양(`DRAWN`: slash 머리 1.5 × 2 sp, VexFlow `SLASH_NOTEHEAD_WIDTH`)은 대체가 아니다; 정말 없는 것(cross 머리)은 x 머리로 대체하고 `GLYPH_FALLBACK` |
| `space.js` | spring–rod: `ideal(Δ) = u·(Δ/¼)^0.65`, 거리 = max(ideal, rod). `solve(springs, fixed, target)`는 **정확한** u (폭 함수가 조각별 선형·증가이므로 spring을 rod/g 순으로 정렬해 한 조각을 푼다, 이분법 없음), rod만으로도 넘치면 `overflow` |
| `breaks.js` | 화면 줄바꿈 DP (§33.8) |
| `skyline.js` | 0.25 sp 칸의 위·아래 skyline(정수 1/100 sp), `place()`(§10.1의 배치 함수), `clearance()`(세로 간격), `collisions()`(H1–H4, H6, H8) |
| `canon.js` | canonical JSON(키 정렬, 0.01 반올림, −0 없음)과 hash |
| `layout.js` | `prepare(plan)`(폭과 무관한 것) → `layout(prepared, config)` → EngravedScore; `engrave`, `createEngraver`(LRU 8), `screenConfig`, `systemParts` |
| `practice.js` | `createPracticeMap(engraved, plan)`, `createHighlighter(map)` (§33.9) |
| `index.js` | Node에서는 위 전부를 내보낸다 (`layout`, `practice`, `metrics`, `engrave`, `layoutHash`). 브라우저에서는 페이지가 불러온 경우에만 — **앱은 불러오지 않는다** (G4-B1), 그때 `PPPEngrave.layout`은 null. `version` `0.2.0-g4b` |

도구(`tests/engrave/tools/`): `make-metrics.js`, `layout-hashes.js`(커밋된 hash, `--write`), `layout-view.js`(개발용 SVG — Bravura outline과 상자, 앱과 무관), `layout-perf.js`(예산), `browser-parity.js`(A28, 서버·포트 없이 headless Chrome). `tests/engrave/l2.js`: L2 기하 metric — `skyline.js`와 따로 구현, 테스트와 `bench.js`가 같이 쓴다.

### 33.4 EngravedScore (`engr/1`)

```
{ version: 'engr/1', planKey: '<graph fingerprint>:<plan version>',
  config:   { mode: 'screen', breakpoint, width, barsPerSystem, respectSourceBreaks, window },
  pages:    [{ index, w, h, systems }],                        화면은 한 페이지, 높이 끝없음
  systems:  [{ index, page, x, y, w, u, stretch, ragged, space, measures, staves: [{ key, y, h, top, bottom }], box }],
  measures: [{ id, number, system, x, w, content: [x0, x1], columns: [{ at, x, time }] }],
  objects:  [{ id, kind, refs, system, staffKey, measure, box, layer, event?, glyph?, origin?, scale?, anchor?, drawn?,
               grace?, provisional?, courtesy?, lines?, space?, open?, start?, label? }],
  curves:   [],                                                G4d
  coverage: { placed: {kind: n}, pending: {kind: n} },
  diagnostics: [{ code, refs, detail }] }
```

- 좌표는 staff space(화면 1 sp = 10 px), y는 아래로, 전부 0.01 sp로 반올림. 마디 `w`는 반올림한 두 끝의 차라서 마디가 정확히 이어진다.
- **ID**: 음표머리는 그래프 head ID, 쉼표는 event ID, 나머지 event 요소는 `<event>#stem|#flag|#dot<k>|#ledger<staff>:<y>`, `<head>#acc`; clef·key·time 변경은 그 그래프 ID(+`:staff`), system 머리·보표선·brace처럼 그래프에 없는 장식은 `d:`로 시작. 모든 `refs`는 plan/그래프 ID. **폭이 바뀌어도 음 요소 ID는 같다** (시험됨).
- glyph 요소는 `origin`(백엔드가 glyph를 그릴 점)과 `scale`, 열에 매달린 요소는 `anchor [기둥 x, 보표 윗선 y]`. `provisional` stem·flag는 G4c가 beam 아래에서 다시 정한다. `coverage.pending`은 G4b가 놓지 않는 것(beam, tuplet, tie, slur, 선·기호, 아티큘레이션, 장식음, fermata, 가사, 운지, 꾸밈음 stem, 반복 기호 글자, 템포, 마디 안 조 변경)을 센다 — 조용히 빠지는 것이 없다.
- 백엔드와 무관한 순수 데이터: JSON 왕복 뒤 hash가 같다.

### 33.5 intrinsic 폭 (§9.3)

`prepare`가 마디마다 **기둥**(어느 staff·성부든 음이 시작하는 모든 시각; 마디 안 clef 변경은 시간을 먹지 않는 기둥)을 만들고, 기둥 × staff마다 요소를 기둥 기준 상대 좌표로 놓는다:

- 음표머리: 쓰인 음 높이와 그 시각의 clef로 y(윗선 0, 반 sp씩; G·F·C·옥타브 clef, 타악기는 높은음자리처럼). 2도는 stem 반대편으로(stem 위면 아래에서부터, 아래면 위에서부터). 두 성부가 1도·2도로 닿으면 나란히 — stem 아래 성부가 제자리, stem 위 성부가 오른쪽 (stem이 바깥, Gould). **§14.2(아래 성부를 오른쪽으로)와 다르다** — VexFlow 4.2.3도 §14.2 쪽; G4b는 그대로 두고 G4c가 정한다: DECISIONS G4-B11, §33.16.5.
- stem: plan의 `stem`(그래프 `display.stem` 또는 성부 역할), 없으면 가운데 줄에서 먼 머리 쪽. 길이 3.5 sp(+flag 3개부터 0.5씩), 덧줄 음이면 가운데 줄까지. beam에 든 음은 flag 없음.
- 덧줄(머리마다, 2도 머리까지 덮고 양쪽 0.2), 쉼표(성부 역할 위/아래면 ±2 sp, 마디 쉼표는 마디 가운데), 임시표(위에서 아래로, 세로로 겹치면 다음 열로 — 열마다 오른쪽 맞춤), 점(기둥의 모든 머리 오른쪽; 줄 위 음은 위 칸, 아래 성부는 아래 칸; **위로 뻗은 flag의 상자와 겹치면 flag 뒤로**), 꾸밈음(0.66 크기의 머리·임시표·덧줄을 왼쪽에; stem·사선은 G4c).
- 기둥의 staff별 왼쪽·오른쪽 넓이가 rod가 된다: 이웃 기둥 사이 rod = max over staff(왼 기둥 오른쪽 + 오른 기둥 왼쪽) + 0.3 sp; tie가 시작하는 기둥은 ≥ 2.0 sp; 마지막 기둥에서 세로줄까지 오른쪽 + 1.0 sp. staff가 다르면 서로 밀지 않는다 (시험됨).

**`x = 시간 × 상수`가 아니다**: 2분음표 칸은 4분음표 칸의 2^0.65 = 1.569배 (시험됨), rod가 이기는 곳은 rod.

### 33.6 가로 간격 (§9.4)

system 하나 = 고정 조각과 spring의 **segment 목록 하나** (`segments()`): system 머리(clef | key | time — staff마다 같은 열에 맞춤), 마디마다 [여는 반복 또는 첫머리 뒤 1.5 / 세로줄 뒤 1.2, 마디 안 key·time 변경], 첫 기둥 왼쪽 넓이, spring들, 뒤따르는 clef(다음 마디 첫 clef 변경 — 세로줄 **앞**, 2/3 크기, 앞뒤 0.5), 세로줄(다음 마디의 여는 반복이 평범한 세로줄을 대신하면 없음), system 끝 courtesy key·time(세로줄 뒤). 줄바꿈 비용, 폭 풀이, 배치가 모두 이 목록 하나를 읽으므로 서로 어긋날 수 없다.

u는 system마다 하나: `solve`로 폭에 정확히 맞춘다. 마지막 system은 앞 system들의 u 중앙값으로 놓았을 때 폭의 80 % 이하면 그 간격 그대로(ragged), 아니면 맞춘다. rod만으로도 넓으면 §33.7의 작은 보표.

### 33.7 staff·system 기하 (§15.3)

- staff마다 skyline(보표선도 내용). 같은 part의 보표 사이 `max(5.0, 위 보표 아래 skyline + 아래 보표 위 skyline + 1.0)`, part 사이 최소 6.0 — skyline이라 한 곳에서 낮고 다른 곳에서 높은 두 보표는 맞물릴 수 있다.
- system은 **띠**로 쌓는다(G4-B7): 한 system의 가장 높은 것이 위 system의 가장 낮은 것보다 1.5 아래, 그리고 위 system 마지막 보표의 아랫선에서 다음 system 윗선까지 최소 6.0. 화면 system은 맞물리지 않아서 system 상자가 깨끗한 hit·scroll 대상이다.
- grand staff: 세로줄이 part 안 다음 보표까지 이어지고, system 여는 줄(보표 둘 이상), part마다 brace(글꼴에 없음 — VexFlow처럼 모양, 폭 1.0 + 0.4, 왼쪽 여백에 자리).
- volta는 윗보표 skyline 위에 `place()`로 (윗선에서 ≥ 2 sp), system마다 한 조각, 끝이 열렸는지, 시작 조각에만 `label`("1.", "1, 2.").
- 폭 제약: 한 마디가 rod만으로도 폭보다 넓으면(휴대폰의 16분음표 마디) 그 system을 **작은 보표**로 — `space = max(0.5, W / 최소 폭)`, 모든 x는 system 왼쪽에서, y는 보표 윗선에서 비율로 줄이고 보표선 간격·세로 간격도 같이 (`SYSTEM_SCALED`). 0.5로도 넘치면 `SYSTEM_OVERFLOW` (G4-B5). 페이지 매김은 없다 (G4e).

### 33.8 줄바꿈 (G4-U4)

마디 위의 DP: system [i..j]는 최소 폭 × 1.05 ≤ W일 때만(한 마디는 늘 가능), 비용 = `12·(k−N)²`(마지막 system은 k > N일 때만) + 압축 `400·(1−s)²` (s = W/자연 폭, 자연 폭은 u = 4) + 성김 `60·(s−1.5)²` (s > 1.5, 마지막 제외) + 1마디 system 50 (마지막이면 60). 총합 최소, 1e-9로 비교, 긴 system부터 — 같은 입력은 같은 나눔. N은 **선호**다: 빽빽하면 줄고(16분음표 12마디 → system마다 < 4), 성기면 늘고(2/4 2분음표 → 5마디), 5·9·13마디에서 외톨이 마지막 마디 없음. `respectSourceBreaks`면 그래프의 `newSystem`에서 강제로 나눈다. 코퍼스 347 그래프(데스크톱): system의 마디 수 4가 1,307, 3이 178, 5가 190, 2가 168, 6이 2; 1마디짜리 마지막 system 34는 마디가 하나뿐인 파일 33과 결함 있는 찬송가 1(§33.15). 휴대폰(40 sp)에서는 마지막이 아닌 1마디 system이 1,253개 — 모두 두 마디가 폭에 들어가지 않는 밀도다(`eg.systems.one_bar` = 피할 수 있었던 것 0).

### 33.9 연습 map (§8.4, §16.4–§16.6)

`createPracticeMap(engraved, plan)` — EngravedScore에서 한 번 끌어내고, 그 뒤 질문은 모두 조회다:
- `systems` (상자, 마디 wash용 `band` = 윗보표 −1.5 … 아랫보표 +1.5), `measures` (상자, content, `startQ`/`lenQ`, 기둥 `[{b, q, x}]` — 시간은 앱과 같은 4분음표 단위, 적힌 순서로 누적)
- `event(id)` → {m, staff, system, box, objects, onsetKeys, startQ, endQ}; `byOnset(key)` — 키는 legacy 렌더러의 `data-onset` (`E.onsetKey`, "마디|박|staff")
- `xAt(m, b)` 기둥 사이 선형, 마지막 기둥에서 세로줄까지; `locate(q)`; `hitTest(x, y)` → {system, measure, b, q, event}; `loopBoxes(a, b)` system마다 상자 하나; `legacyMap()` — 지금 ScoreView `_map`의 모양 `{x, w, startQ, lenQ, pts: [[q, x]]}`
- `createHighlighter(map)`: 시작순·끝순 두 목록과 두 포인터. 앞으로 재생하면 상태가 바뀌는 event만 만진다; 뒤로 seek하면 아직 울릴 수 있는 event(q − 가장 긴 길이 이후 시작)만 다시 보고 차이만 만진다. layout 함수를 부르지 않는다 (`counters.layout` 불변, EngravedScore hash 불변 — 시험됨).

### 33.10 다시 배치 (resize·reflow, §16.5)

`createEngraver(plan)`: `prepare`는 한 번, config마다 layout, 최근 8개 LRU. 같은 breakpoint 안에서 창 크기를 바꾸면 `screenConfig(px)`가 같은 config → **layout 0회** (B7); 720 px를 넘으면 다른 config; 확대는 폭 변경(`screenConfig(px, zoom)`, 1.25배 → 80 sp). 데스크톱 → 휴대폰 → 데스크톱은 캐시의 같은 객체. 음 요소 ID·event ID·onset 키·시간은 폭과 무관하고, highlighter 상태는 event ID와 시간뿐이라 다른 폭의 map으로 그대로 옮겨 간다 (시험됨). 가까이 보기 창: `config.window = [첫, 끝]` 마디만 system으로 (§15.2 "창 경계를 system 경계로").

### 33.11 결정론 (A27–A29)

고정된 반복 순서, 정렬은 모두 전순서(동률은 ID), 비교는 1e-9 또는 정수 1/100 sp, 출력 0.01 반올림, glyph 크기는 생성된 표, DOM·시계·난수 없음(정적 검사 — 전역 `document`/`window`, `getBBox`, `measureText`, `Date`, `performance.now`, `Math.random`, VexFlow, `fetch`). 이 검사는 `getComputedTextLength`와 `globalThis.document`·`root.document`를 놓쳤다 (리뷰 R1) — Fixer가 두 층의 검사와 음성 대조로 다시 썼다: §33.16.2. **layout hash는 canonical JSON의 FNV-1a 64** (G4-B4 — 브라우저에 동기 sha256이 없다; ScoreGraph fingerprint와 같은 함수). 커밋된 hash `tests/engrave/baselines/layout-hashes.json`: E 40 + R 61 + PPP 전사 17 = 118곡 × 데스크톱·휴대폰 — Windows에서 만들고 테스트와 CI(Linux)가 비교. **Node = Chrome 153 headless: 808/808 layout hash 같음** (코퍼스 347 + E 40 + 전사 17, 두 config; `browser-parity.js`, 네트워크 요청 0). 같은 plan 세 번(새로 prepare, 캐시, 새 그래프), fixture 역순 — 같은 hash.

### 33.12 성능 (§19.2; 이 PC, Node 24, `layout-perf.js` 5회 중앙값; 브라우저는 `browser-parity.js`)

(Fixer가 고침, §33.16.6: 곡별 표는 G0 hold-out이 아닌 곡으로 이 트리에서 다시 잼 — 처음 표의 beyer/030과 hymns/amazing-grace는 hold-out이었다 (R13); B5는 §19.2대로 G4b에서 판정하지 않음 (R9).)

| 곡 | event | 마디 | plan | prepare | layout 데스크톱 | 휴대폰 | 연습 map | system | 요소 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| beyer/028 | 95 | 16 | 0.89 | 0.31 | 0.52 | 0.37 | 0.27 | 4 | 252 |
| hymns/take-my-life | 136 | 16 | 1.35 | 0.42 | 0.67 | 0.57 | 0.34 | 4 | 380 |
| burgmuller25/021 | 468 | 33 | 5.50 | 2.52 | 2.45 | 2.47 | 1.10 | 9 | 1,152 |
| czerny849/001 | 548 | 32 | 7.13 | 2.67 | 3.06 | 2.42 | 0.75 | 9 | 1,350 |
| sonatina/013 | 1,354 | 86 | 17.98 | 8.39 | 9.46 | 8.80 | 2.85 | 24 | 3,500 |
| sonatina/016 | 1,494 | 92 | 19.79 | 11.33 | 11.51 | 13.02 | 2.76 | 25 | 4,147 |
| sonatina/020 | 1,563 | 158 | 19.57 | 9.62 | 14.10 | 15.12 | 3.22 | 40 | 4,720 |

(ms, Fixer 실행.) 코퍼스 347 그래프 한 번씩: plan 중앙 1.49, 최대 17.77; prepare + layout 중앙 1.76, p95 11.30, 최대 24.72 ms.

| 예산 | G4b가 잴 수 있는 것 | 측정 | 판정 |
| --- | --- | --- | --- |
| B1 plan ≤ 60 ms | 가장 긴 코퍼스 곡의 plan | 16.6 ms | PASS |
| B2 창 p95 ≤ 25 ms | 4마디 창 layout, 캐시 없음 (SVG는 G4c+) | 0.47 ms (107창) | PASS (layout 몫) |
| B3 p95 ≤ 8 ms | 같은 창, 캐시 적중 | 0.01 ms | PASS |
| B4 ≤ 100 ms | 전곡 prepare + layout (줄바꿈이 전역이라 첫 화면도 이것) | 최대 23.7 ms | PASS |
| B5: 전체 완료 ≤ 1.2 × 기준선 (sonatina/020 ≤ 300 ms), 조각당 ≤ 12 ms, long task 0 (§19.2) | sonatina/020 전곡 | Node 1×: prepare + layout 23.7 ms, 가장 긴 호출 14.1 ms; Chrome 4× CPU: prepare + layout 한 호출 65.8 ms (리뷰의 `browser-parity.js`) | **G4b에서 판정 안 함** — 조각·long task는 페이지의 시간 나누기(G4f)가 있어야 잰다; G4b는 동기 호출 하나 (처음 기록의 "task ≤ 50 ms, PASS"는 §19.2를 잘못 옮긴 것, R9) |
| B6 p95 ≤ 1 ms, 만진 수 = 바뀐 수 | highlighter update, 40 ms 틱 17,505번 | p95 < 0.01 ms, 최대 0.12 ms, 만진 수 = 바뀐 수 전부 | PASS |
| B7 layout 0회 | 같은 breakpoint 안 창 크기 7가지 | 0 | PASS |
| A37 (4× CPU) B2 ≤ 80, B6 ≤ 3 | Chrome, CPU 4× 감속 | 창 p95 1.3 ms, highlight p95 < 0.1 ms | PASS |

Chrome(1×)의 sonatina/020: plan 12.2, prepare 6.1, layout 7.9 ms. 4×: plan 65.5, prepare 37.7, layout 42.8 ms — prepare와 layout은 따로 부르면 각각 50 ms 아래지만 **plan(G4a)은 4×에서 50 ms를 넘는다** (B1은 1× 예산이라 PASS; G4f가 전곡 보기를 idle·worker로 나눌 때 볼 일, §33.15). §19.2의 조각은 12 ms이므로 4×에서는 세 호출 모두 한 조각보다 길다 (리뷰의 실행: prepare + layout 한 호출 65.8 ms) — B5는 G4f의 시간 나누기로 판정한다 (Fixer, R9). 연습 조회: hit-test·seek p95 < 0.01 ms, sonatina/020 map 만들기 2.9 ms.

### 33.13 테스트와 회귀

- `npm run test:engrave` **128/128** (G4a 95 + `layout.test.js` 22 + `practice.test.js` 7 + ledger 2 + source 2), `npm run test:scoregraph` **205/205**. (Fixer 뒤 132/132 — §33.16.7.)
- `layout.test.js`: canonical·hash; 결정론 3회·역순·JSON 왕복; 커밋된 hash; 정적 검사 + `make-metrics --check`; EngravedScore 모양·ID·0.01; intrinsic 폭(임시표·겹임시표·점 1·2개·2도·3도·화음 임시표 열·같은 음 두 성부·쉼표·staff별 넓이·2^0.65); spring 정확 풀이·rod·overflow; 4/4·3/4·6/8·5/8(3+2) 기둥·같은 Δ 같은 간격·박자표; 여러 성부·화음·임시표·쉼표 공유 기둥; 음 높이 → y(높은·낮은·가온·테너·8vb clef), stem 방향, 덧줄; G4-U4 보통 4/2, 빽빽 < 4, 성김 > 4; 외톨이 마지막 마디, 한 마디 넘침; `respectSourceBreaks`; grand staff·brace·이어진 세로줄·system 띠; 뒤따르는 clef, key 변경 제자리표, courtesy key·time, C·¢; 여는 반복·volta와 system 넘김; **코퍼스 347 + E 40 × 두 config의 L2 전부 0** (허용 1: §33.15; 다른 성부 사이의 충돌은 재지 않았다 — 리뷰 R3, Fixer의 ratchet: §33.16.4); 충돌 검사 음성 대조(H1, H2, H3, H4, H6, H8 — 일부러 겹친 상자를 찾는다); 작은 보표·넘침 진단; coverage·pending·숨긴 event·숨긴 조표·slash 머리; reflow 캐시·ID·screenConfig·LRU; 앱은 layout core를 불러오지 않음.
- `practice.test.js`: event → 요소·상자·onset 키(E.onsetKey와 같음); 시간·xAt·locate; hit-test; loop·`legacyMap`; highlighter = 전수 계산(3,000 프레임 이상, 만진 수 = 바뀐 수, seek 7번); 곡 길이와 무관한 프레임 비용(방문 수/프레임 < 1.5); 폭이 바뀌어도 ID·키·시간·highlight 상태 같음.
- **L2 bench**: `bench.js`가 그래프마다 두 config를 배치하고 `l2.js` metric(클립, 머리·임시표·점 겹침, staff·system 겹침·넘침, rod·단조성·기둥 순서, event·head 누락, staff 틀림, 피할 수 있었던 1마디 system, hard 위반, glyph 대체, layout 비결정)을 L1 행에 더한다 — 영목표 metric은 gate. r 61 / e 40 / x 76 PASS, L1 값은 바뀌지 않음(baseline diff는 새 키 추가뿐), `eg.system.scaled`(r 34, x 4)는 낮을수록 좋음으로 기록.
- CI(`bench.yml`)에 `make-metrics.js --check`, `layout-hashes.js` 추가.
- 회귀: E/corpus `--check`, L1 r·e·x, `sg-roundtrip`, golden, lint-corpus, provenance, correctness, smoke/core/robust run+check, bench unit, `mutation-check` — §33.14. **legacy parity** (`a0bc2ea`의 `git archive`를 8796에, 이 트리를 8795에): 16/16 바이트 동일. **A48 페이지 gate** PASS (§33.2 B). 브라우저 suite 26개 — §33.14.

### 33.14 회귀 실행 결과

(아래 표는 커밋 직전 이 트리에서 돈 결과다.)

| 검사 | 결과 |
| --- | --- |
| `npm run test:engrave` | **128/128** (G4a 95) |
| `npm run test:scoregraph` | **205/205** |
| carryover 커밋만 (`a0bc2ea` + 그 파일들, `git archive`로 따로 풀어서) | `test:engrave` 99/99 |
| `python -m unittest discover -s tests/bench/unit` | PASS |
| `make-e-fixtures.js --check`, `make-corpus.js --check`, `make-metrics.js --check`, `layout-hashes.js` | 모두 PASS (layout hash 118곡 × 2) |
| `bench.js check --suite r / e / x` (L1 + L2) | PASS / PASS / PASS (61 / 40 / 76 그래프) |
| `run.py sg-roundtrip`, `golden`, `lint-corpus`, `make_provenance.py --check`, `correctness` | 모두 PASS |
| `run.py run/check --suite smoke`, `core`, `robust` | 모두 PASS (core 553, robust 282 case) |
| `run.py mutation-check` | **PASS** — 49/49 (해로운 mutation 전부 REGRESSION, no-op 두 개 결과 동일) |
| A48 페이지 gate (`a48-coverage.js`, 이 트리 8795) | **PASS** — core 553/553, corpus 318/318 (이름 있는 손실 7), OMR 2; 음성 대조 4개 FAIL (§33.2 B) |
| legacy parity (`legacy-parity.js`, `a0bc2ea` 8796 대 이 트리 8795) | **16/16 바이트 동일** |
| `browser-parity.js` (A28) | Node = Chrome 153: **808/808** layout hash, 네트워크 0 |
| `layout-perf.js` | 모든 예산 PASS (§33.12) |
| 브라우저 suite 26개 (각각 따로, `with-port.js`로 이 트리 8795에 — 페이지의 `PPPEngrave.version` `0.2.0-g4b` 확인) | **25 통과.** `transcription` 실패("the fallback is the venv transkun console script" — 이 PC에 transkun venv·helper 없음)는 **같은 harness로 base(`a0bc2ea`, 8796)에서도 똑같이 실패** — G4a 기록(§32.13)과 같은 환경 원인. 임시 preload 두 가지(커밋 안 함): 앱이 스스로 부르는 `127.0.0.1:8788/health`의 연결 거부 console·requestfailed만 거르기, `createBrowserContext()`로 연 페이지에도 8777 → 8795 바꾸기(`with-port.js`는 `browser.newPage`만 바꾼다; `auth-ui`·`share`가 그 경로) — 이 둘이 없으면 console 오류를 세는 suite와 두 context suite가 이 트리와 base에서 **똑같이** 실패한다 |

서버: 이 트리와 base를 `NODE_ENV=production HOST=127.0.0.1`로 8795·8796에 띄웠다 — 개발 모드의 `server.js`는 helper가 없으면 `omr-service.js`를 기본 포트 8788로 띄우는데, 8777·8788은 사용자 것이라 쓰지 않는다. 측정이 끝나고 두 서버를 껐다.

### 33.15 남은 것

- **BLOCKER 0, MAJOR 0** — 독립 리뷰의 MAJOR 셋(R1 A29 검사, R2 layout mutation, R3 다른 성부 충돌)은 Fixer가 닫았다 (§33.16).
- MINOR:
  1. `catalog/hymns/in-the-bleak-midwinter.musicxml`의 마지막 마디는 길이 175/4(온음표 43¾개, event 166개 — 곡의 나머지가 한 마디에 들어간 원본 결함)라서 어느 폭·크기에도 들어가지 않는다: `SYSTEM_OVERFLOW`로 말하고, 테스트는 이 파일만 이름으로 허용한다 (R·E·X suite에는 없음). 마디를 system 사이로 쪼개는 일은 G4b에 없다.
  2. 마디 안 조 변경(코퍼스에 1개, `tempo-meter-key-changes.musicxml`)은 놓지 않고 `pending['key-mid-measure']`로 센다.
  3. 4× CPU에서 plan(G4a)이 sonatina/020에 65 ms — 50 ms long task. G4f의 전곡 보기가 plan·prepare·layout을 idle·worker로 나눌 때 다룬다.
  4. 음 요소 자리는 G4b 수준이다: stem은 `provisional`, 같은 음 두 성부는 머리를 나누지 않고 나란히, 쉼표 높이는 역할에 ±2 sp, 꾸밈음에 stem·사선 없음 — G4c의 몫(§11, §14). **이것이 만드는 다른 성부 충돌** (Fixer가 잼, §33.16.4): E + 코퍼스 387곡 × 두 config에서 `eg.rest.overlap` **189** (쉼표 대 머리 70, stem 93, 쉼표 18, 덧줄 8), `eg.voice.stem_over_head` **216** (stem 150, flag 66); gate suite r **34 / 74** (각 3곡), e 0 / 0, x 0 / 0. 지금은 ratchet gate (늘면 실패), G4c가 0으로.
  5. 성부 사이 2도·unison에서 옮기는 쪽이 §14.2·VexFlow와 반대 (stem 위 성부를 오른쪽) — G4-B11, G4c가 정한다.
  6. 리뷰의 MINOR·관찰(R4–R8, R11, R12, O1–O5)은 G4c backlog — §33.16.8.
- G4a에서 넘어온 G4b 몫 가운데 이 지시 범위 밖이라 그대로 둔 것 (G4f에서 앱이 layout을 쓸 때): vendored VexFlow 전송(`no-store`·gzip 없음), 다시 불러온 곡 `resolve` 비용(4×), 8va 적힌 음 표시(G4b는 plan의 `written`(= concert − shift)대로 놓는다 — flip 전에 사용자 결정), 명시된 `bracket="yes"`(schema). §32.14의 그 밖의 MINOR·OPTIONAL도 그대로다.
- 브라우저 suite harness의 한계 둘 (§33.14): 앱 페이지가 스스로 `127.0.0.1:8788/health`를 확인해, helper가 없는 PC에서는 console 오류를 세는 suite가 실패한다; `with-port.js`는 `createBrowserContext()`로 연 페이지(`auth-ui`·`share`)를 8777에서 바꾸지 않는다. 둘 다 이 트리와 base에서 똑같이 나타나 G4b 원인이 아니다. 이번 실행은 커밋하지 않은 임시 preload로 돌렸고 도구는 고치지 않았다 (MINOR). 8777·8788에는 아무것도 띄우거나 끄지 않았다 (앱 페이지가 스스로 보내는 8788 health 확인이 거부됐을 뿐).
- **상태: READY_FOR_MERGE_CHECK** (독립 리뷰 → Fixer §33.16; 처음 기록 때는 READY_FOR_G4b_REVIEW). 병합 안 함, PR 없음.

### 33.16 Fixer — 독립 리뷰의 MAJOR 셋과 기록 정정 (2026-09-25)

입력: G4b 독립 리뷰(read-only; 증거는 리뷰 scratchpad의 `mutate.js`·`mutation-table.txt`·`mutation-results.json`·`audit-overlaps.js`·`views2/`)와 Lead의 범위 지시 — MAJOR R1–R3을 닫고 기록 정정 R9·R10·R13, **그 밖은 하지 않는다** (MINOR 코드 지적은 G4c backlog, §33.16.8). 같은 worktree `D:/PPP-g4`, 브랜치 `g4b-layout-core`, 시작 `ab59f80`. 리뷰의 스크립트는 생각만 빌렸고 커밋한 코드는 새로 썼다. **production 동작 변경 없음**: `engrave/`·`scoregraph/`·`vendor/`·앱 파일·서버는 바이트 그대로 (바뀐 파일은 `tests/`와 `docs/`뿐), 커밋된 layout hash 118곡 × 2 그대로, legacy parity(16/16)는 앱 파일이 그대로라 바뀔 수 없다. G4b는 여전히 기하만이다 (svg.js 없음, 앱 스위치 없음 — Lead 승인).

#### 33.16.1 지적과 처리

| # | 지적 (리뷰) | 처리 | 어디 |
| --- | --- | --- | --- |
| R1 | A29 정적 검사가 M18을 잡을 수 없다: `getComputedTextLength`(§20·M18이 이름 댄 것)가 목록에 없고, lookbehind `(?<![.\w])`가 `globalThis.document`·`root.document`를 통과시킨다 (리뷰 mutation M18a·M18b: 실패한 테스트 0) | **FIXED** — 공유 모듈 `tests/engrave/a29.js`: 두 층, 규칙마다 이름, 문자열 포함, 점 앞이 무엇이든; 음성 대조 41 + 정상 코드 9 | §33.16.2 |
| R2 | 새 layout 코드에 커밋된 source mutation이 없다 | **FIXED** — `tests/engrave/layout-mutation.test.js`: mutation 12 + 대조군 N1·N2, 모두 이름 붙은 metric·검사로 잡힘 | §33.16.3 |
| R3 | 다른 성부 충돌이 어느 gate에도 보이지 않는다 (코퍼스: 쉼표 189, stem·flag 216; gate인 R suite에 34, 그런데 bench r은 L2 전부 0); §21.2·A26의 `eg.rest.overlap`이 없다 | **FIXED (ratchet)** — `eg.rest.overlap`, `eg.voice.stem_over_head` (skyline 규칙과 따로), suite별 baseline, 늘면 실패; `layout.js`는 고치지 않음 (G4c) | §33.16.4 |
| R9 | §33.12가 B5를 "task ≤ 50 ms"로 판정 — §19.2는 "조각당 ≤ 12 ms, long task 0" | **정정** — B5는 G4b에서 판정 안 함 | §33.12, §33.16.6 |
| R10 | `layout.js` 303–315는 2도·unison에서 stem 위 성부를 오른쪽으로 옮기는데 §14.2는 아래 성부 | **기록** — DECISIONS G4-B11 (반대 증거 포함), §33.5에 pointer | §33.16.5 |
| R13 | §33.12의 곡별 perf 표가 G0 hold-out 파일(beyer/030, hymns/amazing-grace)의 값을 싣는다 | **정정** — 같은 크기의 hold-out 아닌 곡으로 바꾸고 다시 잼; `layout-perf.js`는 hold-out을 거부 | §33.12, §33.16.6 |
| R4–R8, R11, R12, O1–O5 | MINOR·관찰 | **G4c backlog** — 손대지 않음 | §33.16.8 |

#### 33.16.2 R1 — A29 정적 검사 (`tests/engrave/a29.js`)

- **무엇을 읽나**: 주석은 지우고(줄 번호는 그대로), **문자열·정규식 literal은 남긴다** — `globalThis['document']`도 접근이기 때문이다. 그래서 문자열 속 금지어는 발견이다 (정한 규칙). 금지어를 품은 다른 낱말(`documentation`, `windowed`, `randomize`)은 아니다 (`\b`). 지우개는 문자열·정규식 속의 `/*`·`//`를 주석으로 보지 않는다; `engrave/` 15파일에서 결과가 단순한 블록 주석 지우기와 바이트 같다.
- **두 층** (§20):
  - **MEASURE** — DOM 측정 (`getBBox`, `getComputedTextLength`, `getSubStringLength`, `getExtentOfChar`, `getTotalLength`, `measureText`, `getBoundingClientRect`, `getClientRects`, `getComputedStyle`, `getScreenCTM`/`getCTM`, `offsetWidth`·`clientWidth`·`scrollWidth` 무리). `engrave/`의 모든 파일, **`svg.js`만 뺀다** (§20의 문장 그대로; 아직 없음, G4c+).
  - **PURE** — DOM·브라우저 전역 (`document`, `navigator`, `localStorage`, `indexedDB`, `devicePixelRatio`, `innerWidth`, `matchMedia`, `getSelection`, `HTMLElement`, `DOMParser`, `ResizeObserver` …) **점 앞이 무엇이든**; 전역 객체 (`self.`, `global.`/`global[`, UMD 머리 `typeof globalThis !== 'undefined' ? globalThis : this` 밖의 모든 `globalThis`); 시계 (`Date`, `performance`, `process`); timer (`setTimeout` … `requestIdleCallback`); 난수 (`Math.random`, `Math[`, `crypto`); 네트워크 (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, 동적 `import(`); 동적 코드 (`eval(`, `Function(`); locale (`Intl`, `toLocale*`, `localeCompare`); VexFlow (`vexflow`, `Vex`); 상대 경로가 아닌 `require`. `svg.js`와 G4a의 페이지 쪽 세 파일만 뺀다 — `index.js`(페이지의 IndexedDB·`navigator.storage`를 찾음), `source.js`(조각 사이 `setTimeout`), `store.js`(IndexedDB, timeout, `savedAt = Date.now()`). 예전 검사는 layout 7파일만 봤다; 이제 PURE 12파일(`metrics`, `space`, `breaks`, `skyline`, `canon`, `layout`, `practice`, `plan`, `plan-beams`, `plan-tuplets`, `ledger`, `glyphs`), MEASURE 15파일. **새 파일은 예외에 이름을 올리기 전까지 PURE다** (테스트가 층의 범위와 예외 파일의 존재를 확인).
  - `window`만 규칙이 따로다: close view의 config 필드(`cfg.window`, `config.window`, `{ window: … }` — G4-B9의 이름)만 허용, 그 밖(`root.window`, `window.innerWidth`)은 전역.
- **결과**: 실제 `engrave/` 발견 0. **음성 대조** (`layout.test.js` "A29 negative controls"): 금지 구성 41개가 각각 자기 규칙 이름으로 잡힌다 — `globalThis.document`(dom-global과 global-object 둘 다), `root.document`, `root['document']`, `document.body`, `window.innerWidth`, `root.window`, `self.devicePixelRatio`, `el.getComputedTextLength()`, `getBBox`, `measureText`, `getBoundingClientRect`, `getComputedStyle`, `Date.now()`, `new Date()`, `performance.now()`, `process.hrtime()`, `setTimeout`, `Math.random()`, `Math['random']()`, `crypto`, `fetch`, `XMLHttpRequest`, `import('…')`, `new Function(…)`, `eval`, `new Intl.NumberFormat()`, `x.toLocaleString()`, `toLocaleUpperCase`, `localeCompare`, vendored VexFlow `require`, `Vex.Flow`, `require('fs')`, 문자열 `'document'`, 문자열 `'/*'`·`'*/'` 사이에 숨긴 `fetch`, 정규식 `/[/*]/` 뒤에 숨긴 `fetch`. 정상 코드 9개는 발견 0 — 금지어를 모두 적은 블록 주석, 줄 주석, `cfg.window`·`config.window`, `{ window: win }`, UMD 머리, `documentation`·`updatedAt`·`randomize` 같은 낱말, `//`가 든 정규식과 나눗셈, plan.js 모양의 지역 변수 `self[0]`, 상대 `require`. 층: `store.js`의 `setTimeout`·`indexedDB`·`Date.now()`는 허용, `getBBox`는 발견; `svg.js`의 `getBBox`·`getComputedTextLength`는 허용; 이름 없는 새 파일의 `Date.now()`는 발견.
- M18a·M18b·M18c는 §33.16.3에서 실제 `layout.js` 사본에 심어 잡힌다.

#### 33.16.3 R2 — layout mutation (`tests/engrave/layout-mutation.test.js`)

`ledger-mutation.test.js`와 같은 틀이다. `engrave/`·`scoregraph/`를 임시 디렉터리에 복사하고 **engrave 파일을 CRLF로 바꿔 쓴다** (Windows checkout의 모양 — anchor는 CRLF → LF 정규화 뒤에 맞추므로, 어느 OS에서 돌든 정규화가 실제로 시험된다; G2 `MD-TEMPO-LAST-ONLY`의 교훈). mutation마다 anchor 편집 (정확히 한 번; 없거나 두 번이면 실패 — 이것도 시험), probe 다섯 (E13 두 성부와 쉼표, E33 임시표 화음, E37 긴 grand staff, Czerny 849/005 빽빽함 — 휴대폰 system이 이미 작은 보표, Burgmüller 25/015)을 데스크톱·휴대폰으로 배치하고, L2(`l2.js`), 결정론(A27 — 같은 그래프를 prepare 한 번·새로·engraver 캐시로 세 번 더, hash 비교), A29를 계산한다. 각 mutation은 (1) **출력이 바뀌어야** 하고 (EngravedScore 바이트; M18은 Node에 잴 DOM이 없으므로 A29 발견이 바뀌어야), (2) **이름 댄 metric·검사가 잡아야** 하며, 그 이름은 mutation 없이 같은 probe에서 깨끗해야 한다. 커밋된 layout hash만으로 잡힌 것은 인정하지 않는다.

| # | 심은 결함 | 잡은 이름 (probe 다섯 × 두 config 합) | 함께 오른 것 |
| --- | --- | --- | --- |
| M6 | 임시표 x를 머리 쪽으로 0.8 sp | `eg.overlap.acc` 170 | `eg.layout.hard_violations` |
| M7a | 배치에서만 u → 0 (보고된 u는 그대로) | `eg.spacing.monotonic_violations` 1,089 | `eg.system.fill_err` |
| M7b | u → 0 어디서나 (§23의 문구: rod만, 보고된 u도 0) | **`eg.system.fill_err`** 131 (새) | 없음 — 단조성은 못 본다 (리뷰의 발견) |
| M9 | 줄바꿈 하나를 없앰 (첫 두 system을 하나로) | **`eg.system.scaled_avoidable`** 6 (새) | `eg.system.scaled` |
| M10 | 마지막 system을 페이지 밖으로 | `eg.clip.count` 550 | `eg.layout.hard_violations` |
| M11a | 쉼표 하나(곡의 첫 쉼표)를 같은 ID로 두 번 | **`eg.layout.multiset_diff`** 6 (새; probe 셋 × config 둘, 하나씩) | 없음 |
| M11b | 같은 쉼표를 새 ID로 두 번 | `eg.layout.multiset_diff` 6 | 없음 |
| M17 | 삽입 순서가 샘 (세 번째 layout마다 뒤집고, ID 동률 깨기 없이 정렬) | `eg.layout.nondeterministic` 5 (probe 전부) | — |
| M18a | layout이 `getComputedTextLength`로 글자 폭을 잼 | A29 `dom-measure` (`layout.js`) | — |
| M18b | layout이 `globalThis.document`를 읽음 | A29 `dom-global` + `global-object` | — |
| M18c | layout이 `getBBox`로 상자를 잼 | A29 `dom-measure` | — |
| M21 | 음높이로 staff를 고름 (두 staff part에서 4옥타브 이상은 윗 staff) | `eg.layout.head_staff_wrong` 454 | `eg.layout.multiset_diff`, `eg.system.scaled`, `eg.voice.stem_over_head` |
| N1 | 주석 바꿈 | 바이트 동일, metric 같음, A29 깨끗 | |
| N2 | 독립 문장 둘의 순서 바꿈 (beam 집합과 tie 시작 집합) | 바이트 동일, metric 같음, A29 깨끗 | |

잡힌 것마다 probe 둘 이상이 나른다 (M17은 probe마다). 실행 7–8 s, `npm run test:engrave` 안이므로 CI gate다.

- **M9와 `eg.system.overflow`**: §23과 지시는 M9를 `eg.system.overflow`로 잡으라 한다. 그런데 G4-B5가 폭을 넘는 system을 작은 보표로 그리므로 줄바꿈 하나를 없애도 거의 넘치지 않는다 — E + 코퍼스 387곡 × 두 config에서 첫 두 system을 합쳤을 때 0.5 바닥으로도 넘치는 것은 **하나**뿐이다 (Czerny 849/020 휴대폰, 1.01배). 그래서 설계(G4-B5)를 바꾸지 않고는 `eg.system.overflow`가 이 mutation의 믿을 만한 이름이 될 수 없다. 대신 G4-B5가 허락하지 않는 경우에 이름을 붙였다: **`eg.system.scaled_avoidable`** = 마디가 둘 이상인데 작은 보표이거나 넘치는 system. G4-B5는 폭보다 넓은 **한 마디**에만 작은 보표를 허락하고, 줄바꿈 DP의 가능 조건(최소 폭 × 1.05 ≤ W)이 여러 마디 system을 폭 안으로 묶으므로 지금 layout에서는 정의상 0이다. 합친 system이 0.5로도 넘치면 `eg.system.overflow`도 오르고, `eg.system.scaled`(LOWER gate)도 오른다.

#### 33.16.4 R3 — 다른 성부 충돌 (`l2.js`, ratchet gate)

- **`eg.rest.overlap`**: 한 system·staff에서 쉼표가 **다른 성부**(plan의 `voice`)의 머리·stem·flag·쉼표·덧줄·임시표와 겹친다 (쉼표 대 점은 `eg.overlap.dot`의 몫). **`eg.voice.stem_over_head`**: stem이나 flag가 다른 성부의 음표머리와 겹친다. 종류 목록은 `l2.js`의 것이고 `skyline.js`의 H 규칙을 쓰지 않는다 (O4: 둘이 함께 눈멀지 않게).
- **잰 값** (이 트리, 두 config 합):

| 세트 | `eg.rest.overlap` | `eg.voice.stem_over_head` |
| --- | --- | --- |
| R suite (61 그래프, gate) | **34** (3곡) | **74** (3곡) |
| E suite (40) | 0 | 0 |
| X suite (76) | 0 | 0 |
| E + 코퍼스 347 (387곡, `layout.test.js`) | 189 | 216 |

  코퍼스 값은 리뷰의 `audit-overlaps.js`와 같다 (쉼표: 머리 70 + stem 93 + 쉼표 18 + 덧줄 8 = 189; stem 150 + flag 66 = 216) — 성부로 센 값과 event로 센 값이 같다.
- **ratchet gate**: `bench.js`의 `RATCHET` (`l2.js`에서) — baseline이 두 키를 가져야 하고 (없으면 실패), suite 값이 baseline보다 크면 `REGRESSION`, 줄면 통과. baseline(r 34 / 74, e 0 / 0, x 0 / 0)은 **키를 더하기만** 했다: r·e·x에서 바뀐 값 0, 없어진 키 0 (커밋 전 파일과 스크립트로 대조). `layout.test.js`의 A17 테스트는 E + 코퍼스 합이 189 / 216을 넘지 않는지 본다. 음성 대조 (`layout.test.js` "ratchet gates"): 비교 함수가 35 > 34와 75 > 74를 실패로, 30·70을 통과로, 키 없는 baseline을 실패로. **G4c가 0 목표(ZERO)로 옮긴다.**
- **`layout.js`는 고치지 않았다** — 쉼표의 역할 높이와 stem은 G4c 범위 (§33.15 MINOR 4, §14.3).
- **새 영목표 metric 셋** (지금 모든 suite와 E + 코퍼스에서 0, `bench.js` ZERO와 `layout.test.js` ZERO_L2에):
  - `eg.system.fill_err` — 정렬 (§9.4, G4-B3; O3의 답): ragged 아닌 system은 폭을 0.01 sp 안으로 채운다 (넘치는 것은 `eg.system.overflow`의 몫); ragged system은 곡의 마지막이고 폭의 80 % 이하.
  - `eg.layout.multiset_diff` — layout 수준의 event 다중집합 (A14; M11): plan이 그리는 쉼표마다 `rest` 객체 하나, head마다 `notehead` 객체 하나, (종류, ID, event, 마디, 기둥 시각, staff)로 센 다중집합의 차이 크기. 같은 ID의 사본, 새 ID의 사본, 빠진 것, 다른 staff·다른 시각의 것이 모두 차이다 (R4의 일부만 — 임시표·점·기호는 아님).
  - `eg.system.scaled_avoidable` — §33.16.3.
  - 음성 대조 (`layout.test.js` "the G4b fixer's L2 metrics"): 다른 성부 머리 위의 쉼표 → rest.overlap ≥ 1; 다른 성부 머리를 지나는 stem → stem_over_head ≥ 1; 같은 ID·새 ID 쉼표 사본 → multiset 1; 다른 staff로 옮긴 머리 → 2 (있어야 할 곳에 없고 없어야 할 곳에 있음); 폭보다 5 sp 짧은 system, 마지막이 아닌 ragged → fill_err 1; 여러 마디 system의 작은 보표 → scaled_avoidable 1, 한 마디면 0.

#### 33.16.5 R10 — 성부 사이 2도·unison (DECISIONS G4-B11)

`layout.js` 303–315는 머리가 닿는 두 성부(1도·2도)에서 **stem 위 성부를 오른쪽**으로 옮긴다 — E12에서 2도(v5 위 5.5, v6 아래 6.0)와 unison 둘 모두 stem 위 v5가 오른쪽(x0 10.66 대 9.48). §14.2는 **아래(`down`) 성부**를 오른쪽으로라고 적었다. 이 Fixer가 vendored VexFlow 4.2.3 원문의 `StaveNote.format`을 읽어 보니 §14.2와 같다: 두 stem이 반대면 stem 아래 음에 `setXShift` (두 stem이 가운데서 한 줄로 만난다). Implementer는 코드 주석에 "stem이 바깥, Gould"를 근거로 적었고, 이 Fixer는 Gould의 해당 쪽을 확인하지 못했다. **결정 G4-B11**: G4b는 이 규칙으로 hash를 고정했고 이번 범위는 `layout.js`를 바꾸지 않으므로 그대로 둔다. **최종 규칙은 G4c**가 정한다 (§14.2의 성부·unison 공유가 G4c 범위) — E12·E13·찬송가 그림으로 보고, 지금 규칙을 지키면 §14.2를 고치고, §14.2·VexFlow를 따르면 코드와 hash를 바꾼다 (GEOMETRY_ONLY).

#### 33.16.6 R9·R13 — 성능 기록 (§33.12를 고침)

- **R13**: §33.12의 곡별 표가 G0 hold-out 둘(beyer/030, hymns/amazing-grace — `tests/bench/corpus/references.json` `holdout: true`)의 값을 실었다. 같은 크기의 hold-out 아닌 곡으로 바꿨다: **beyer/028** (95 event·16마디 — beyer/030과 같음), **hymns/take-my-life** (136·16 — amazing-grace는 135·17). `layout-perf.js`의 곡 목록도 바꿨고, hold-out이 목록에 들어오면 도구가 실행을 거부한다. 표 전체를 이 트리에서 `layout-perf.js`(5회 중앙값)로 다시 쟀다 (§33.12). §19.1(설계 세션이 잰 legacy 렌더러 기준선)도 이 두 hold-out을 곡별로 싣는다 — 이 Fixer의 범위(§33.12) 밖이라 고치지 않고 Lead에게 알린다.
- **R9**: §19.2의 B5는 "전체 완료 ≤ 1.2 × 기준선 (sonatina/020 ≤ 300 ms), **조각당 ≤ 12 ms, long task 0**"이다. §33.12는 "task ≤ 50 ms"로 판정했었다. G4b는 동기 호출 하나(prepare + layout)라 조각이 없으므로 **B5는 G4b에서 판정하지 않는다** (페이지의 시간 나누기, G4f). 기록: Node 1×에서 sonatina/020 prepare + layout 23.7 ms, 가장 긴 호출 14.1 ms (이미 12 ms 조각보다 길다); 리뷰의 `browser-parity.js` 실행에서 Chrome **4× CPU의 prepare + layout 한 호출 65.8 ms**. `layout-perf.js`의 B5도 "measured, not judged"로 바꿨다 (예산·`ok` 없음).

#### 33.16.7 회귀 (커밋 `4c8dd46`)

| 검사 | Windows (`D:/PPP-g4`, Node v24.17.0) | Linux (Docker `node:24-bookworm`, Node v24.21.0; `4c8dd46`의 `git clone --shared`, LF 파일) |
| --- | --- | --- |
| `npm run test:engrave` | **132/132** (128 + A29 음성 대조, Fixer L2 음성 대조, ratchet 비교, layout mutation) | **132/132** (mutation 보고가 Windows와 글자까지 같음) |
| `layout-hashes.js` | 118 × 2 전부 커밋된 hash | 같음 |
| `make-metrics.js --check` | PASS | PASS |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS | PASS / PASS / PASS |
| `npm run test:scoregraph` | **205/205** | **205/205** — 처음 실행은 `git show`를 쓰는 테스트 하나가 컨테이너에서 실패했다: `--shared` clone의 alternates가 Windows 경로(`D:/PPP/.git/objects`)라서. clone을 repack해 자립시키고 다시 돌려 205/205 (트리 원인 아님) |
| `make-e-fixtures.js --check`, `make-corpus.js --check` | PASS | — |
| `layout-perf.js` | 판정하는 예산 전부 PASS; B5 판정 안 함 (§33.12) | — |
| production 바이트 | `git diff ab59f80 -- engrave scoregraph vendor 'Piano Coach App.dc.html' index.html server.js` 비어 있음 → layout hash·legacy parity(16/16)가 바뀔 수 없음 | — |

#### 33.16.8 G4c로 넘기는 것 (MINOR·관찰 — 손대지 않음)

- **R4**: layout 수준의 객체 다중집합을 event·head 밖으로 넓힌다 (임시표, 점, 조표·박자표, clef 자리) — 그리고 적힌 음 → y 검사. `eg.layout.multiset_diff`는 쉼표와 머리만 본다.
- **R5**: staff를 넘는 화음은 `#stem`/`#flag` ID가 겹친다 (staff마다 하나씩 그려짐).
- **R6**: 점 붙은 마디 쉼표의 점이 떨어져 있고, 마디 쉼표가 적힌 음가 모양으로 그려진다.
- **R7**: `layout-view.js`가 윤곽을 1.44배 크게 그린다 — `svg.js`를 쓸 때 볼 것.
- **R8**: `prepare`가 입력 plan에 `__restY`를 쓴다.
- **R11**: ragged 마지막 system의 u는 앞 system들 u의 중앙값이다 — 앞 system이 작은 보표(u = 0)면 0일 수 있다.
- **R12**: store의 timeout이 `estimate()`와 `decode`를 덮지 않는다.
- **O1**: canon이 NaN을 null로 쓴다. **O2**: engraver 캐시 키의 반올림. **O3**: 채움 metric — `eg.system.fill_err`로 답함 (M7b). **O4**: `l2.js`가 겹침 규칙 목록을 `skyline.js`와 나눈다 — 새 두 metric은 따로 두었고 기존 셋(head_head·acc·dot)은 그대로. **O5**: 비 V8 브라우저의 `Math.pow` 마지막 비트 (A28은 Chrome만 확인).
- 그리고: `eg.rest.overlap`·`eg.voice.stem_over_head`를 ratchet에서 0 목표로 (§33.16.4), G4-B11의 최종 규칙 (§33.16.5).

#### 33.16.9 커밋

`4c8dd46` (코드·테스트: `tests/engrave/a29.js`, `layout-mutation.test.js`, `l2.js`, `layout.test.js`, `tools/bench.js`, `tools/layout-perf.js`, baseline r·e·x), 이어서 이 기록 (G04 §33, DECISIONS G4-B11, CURRENT_STATE). `origin/g4b-layout-core`에 push. 병합 안 함, PR 없음.

**Fixer 상태: R1 FIXED, R2 FIXED, R3 FIXED (ratchet); R9·R10·R13 기록 정정; BLOCKER 0, MAJOR 0 → READY_FOR_MERGE_CHECK.**

### 33.17 리뷰 판정·재확인·병합 (Lead, 2026-09-25)

**독립 리뷰**

- 대상과 방법: `ab59f80`, read-only. 리뷰어 자신의 `git clone --shared`에서, Windows CRLF와 Linux Docker 둘 다로 돌렸다.
- 판정: **NEEDS_FIX — BLOCKER 0, MAJOR 3, MINOR 10, OPTIONAL 5.**
- 안전성은 확인됐다:
  - 보이는 변화 없음 (legacy parity 16/16);
  - `test:engrave` 128/128 (Windows·Linux);
  - 커밋된 layout hash가 Linux에서도 같다 (A27);
  - Node = Chrome 808/808;
  - G0 gate와 `mutation-check` 49/49, A48 페이지 gate PASS;
  - §33의 다시 잰 수가 모두 일치.
- MAJOR:
  - R1: A29 정적 검사가 `getComputedTextLength`(M18)와 `globalThis.document`를 놓친다 (죽은 mutation).
  - R2: layout 코드의 소스 mutation이 없다.
  - R3: 다른 성부와의 쉼표·stem 충돌을 어떤 metric도 보지 못한다 (R suite에서 34개인데 L2는 0이라 보고).

**Fixer** (§33.16): R1–R3 FIXED, 기록 정정 R9·R10·R13. `engrave/`와 앱 파일은 바뀌지 않았다.

**Lead 재확인** (고친 항목만, `63f1bd6`의 새 clone):

- `ab59f80..63f1bd6`에서 `engrave/`·앱·`scoregraph/`의 변경 파일 0.
- `test:engrave` 132/132. `layout-mutation.test.js`의 모든 mutation이 이름 붙은 metric으로 잡히고, N1·N2는 동일하다.
- layout hash 118 × 2 불변; `bench.js check` r·e·x PASS.
- 음성 대조:
  - r baseline의 `eg.rest.overlap`을 34 → 33으로 낮추면 `bench.js check --suite r`가 `REGRESSION eg.rest.overlap 34 vs baseline 33`, exit 1. 되돌리면 exit 0.
  - `engrave/layout.js`에 `getComputedTextLength`를 심으면 A29 테스트가 실패한다.

**병합**: PR #12, CI gate 초록, squash `62ede61`. 트리는 `63f1bd6`와 같고, 브랜치는 남겨 둔다. **G4b CLOSED — 다시 열지 않는다.**

**G4c로 넘기는 것**

- §33.16.8의 MINOR·OPTIONAL (R4–R8, R11, O1–O5). R12 store timeout의 `estimate`·`decode`는 G4d-2로 간다.
- ratchet 둘(`eg.rest.overlap`, `eg.voice.stem_over_head`)을 0으로 gate.
- G4-B11의 최종 규칙 (성부 사이 2도·unison의 비킴 방향 — 고정된 VexFlow 4.2.3은 stem 아래 음을 옮긴다. 근거를 확인해 정하고 §14.2나 G4-B11 중 하나를 고친다).

§19.1의 hold-out 곡 이름은 Architect의 기준 측정이라 그대로 둔다 — 판각 시간이지 품질 값이 아니다. 새 성능 표는 hold-out을 쓰지 않는다 (`layout-perf.js`가 거절).

---

## 34. G4c 구현 기록 — beam, stem, tuplet, 성부, 쉼표, 꾸밈음, SVG 백엔드

Implementer, 2026-09-25. 브랜치 `g4c-notation-core` (`D:/PPP-g4`), 시작 `1c92fc4` (= `origin/main`, G4b 병합과 마감 뒤). 입력은 Lead의 G4c 지시(roadmap §14 "G4c — implementer brief", §5.1 G4c 행, G4-L1)다. 병합하지 않았고 PR도 없다 (Lead가 리뷰와 PR을 정한다). 결정은 DECISIONS G4-C1–C12.

**한 줄**: EngravedScore가 그래프의 리듬 기보를 그대로 그린다 — 그래프 beam(멤버·secondary break·hook)과 파생 beam, 최종 stem, tuplet 숫자·괄호, 성부 사이 비킴과 unison 공유, 성부 쉼표·병합 쉼표·마디 쉼표, 꾸밈음의 stem·flag·사선·beam — 그리고 `svg.js`가 그것을 결정론적 SVG 문자열로 바꾼다 (glyph는 `<symbol>`/`<use>`, 크기는 metric과 같음). G4b의 ratchet 둘은 0이 되어 영목표 gate다. **사용자에게 보이는 변화는 없다**: 앱 파일은 바이트 그대로이고 새 모듈을 불러오지 않는다 (legacy parity 16/16).

### 34.1 범위 — §27 G4c와 G4-L1

§27 G4c(§11, §12, §14 전부, cross-staff는 `deferred`)에 G4-L1이 옮긴 `svg.js`와 B9, 그리고 G4b의 backlog(§33.15 MINOR 4·5, §33.16.8 R4–R8·R11·O1·O2·O4, 마디 안 조 변경, ratchet 둘을 0으로)를 했다. Node만이다: 앱 통합(G4d-2), 곡선·기호·글자(G4d-1), 인쇄(G4e), flip(G4f)은 하지 않았다. 재생 코드와 `scoregraph/legacy-score.js`(MX-1이 같은 때 `D:/PPP-mx1`에서 고치는 곳)는 건드리지 않았다. G3 flag·schema·VexFlow 버전은 그대로다. R12(store timeout의 `estimate`·`decode`)는 §33.17대로 G4d-2 몫이다.

### 34.2 모듈

| 파일 | 한 일 |
| --- | --- |
| `engrave/notation.js` (새) | 음 둘레의 기하 도우미 — 순수 함수, 상태 없음: `autoDir`(가운데 줄에서 가장 먼 머리의 반대, 거리가 같으면 다수, 그래도 같으면 아래), `beamLine`(beam 바깥 모서리의 기울기와 높이), `beamRuns`(primary·secondary·hook), `beamShapes`(beam 객체와 stem 끝), `beamClash`(음이 달고 있는 것을 비키는 만큼), `placeRests`(성부 쉼표를 한 칸씩 바깥으로), `placeTuplet`(숫자·괄호) |
| `engrave/layout.js` | `prepare`: stem 방향(§34.4), 최종 stem·flag(더는 `provisional` 없음), beam 멤버 stem은 `beam`을 달고 길이는 layout이 정함, 성부 비킴과 unison 공유(§34.5), 쉼표 기본 높이·병합·마디 쉼표(§34.6), 꾸밈음 stem·flag·사선·점·beam(§34.7), cross-staff 화음의 stem ID(R5), 마디 안 조 변경 기둥(§34.9). `layout`: system마다 x가 정해진 뒤 `notateSystem` — beam, 성부 쉼표 옮기기, tuplet — 그 뒤 작은 보표 축소와 세로 쌓기. 새 객체 필드: stem `dir`·`beam`, beam `events`·`level`·`hook`·`line`·`t`, tuplet `side`·`hooks`·`gap`·`hookLen`, 공유 `merged`, 마디 쉼표 `center` |
| `engrave/svg.js` (새) | `svg(engraved, plan, opts)` → SVG 문자열 (§34.8) |
| `engrave/outlines.js` (새, 생성) | 고정 Bravura의 윤곽 66개(metric 표의 glyph 전부), 글꼴 단위 정수 path. `tests/engrave/tools/make-outlines.js`가 만들고 `--check`가 CI에 있다 |
| `engrave/plan-tuplets.js` | 한 음 tuplet의 괄호 기본값을 거짓으로 (§12.3, G4-C5) |
| `engrave/canon.js` | 유한하지 않은 수(NaN, ±Infinity)는 `null`이 아니라 예외, 위치를 말함 (O1) |
| `engrave/skyline.js` | 서로를 `merged`로 이름 댄 두 객체(공유 unison의 머리, 공유 임시표)는 H1·H2 충돌이 아니다 |
| `engrave/index.js` | Node에서 `svg` 내보냄, `version` `0.3.0-g4c`. 브라우저에서는 G4b처럼 페이지가 불러온 경우에만 (앱은 안 불러옴) |

브라우저 로드 순서(불러오는 페이지에서): `metrics, space, breaks, skyline, canon, notation, layout, practice, outlines, svg`, 그 뒤 `index.js`. A29: `notation.js`·`outlines.js`는 PURE 층(모든 규칙), `svg.js`는 §20대로 BACKEND 예외이지만 **예외가 필요 없다** — 다른 이름으로 검사해도 발견 0 (테스트가 확인).

### 34.3 Beam (§11, G4-C2)

- **원천**: plan의 beam 그대로 — 그래프 beam은 멤버 그대로, 파생 beam은 그래프 beam이 없는 part에서만 `pro-beam.groups()` (G4-D3/G4-I1, plan 단계는 G4a). 꾸밈음만으로 된 beam은 그 꾸밈음 묶음 안에서 `prepare`가 그린다(0.66).
- **stem 방향**: 멤버 중 그래프 `display.stem`이 있으면 첫 것(서로 다르면 진단 `BEAM_STEM_MIXED` — 코퍼스 4), 아니면 성부 역할, 아니면 멤버 전체 머리에 `autoDir`. 꾸밈음 beam은 명시·역할 없으면 위.
- **기울기**: 첫·끝 stem 쪽 머리의 높이 차의 절반, 최대 1 sp(꾸밈음은 × 0.66)를 가로 거리로 나누고 0.25로 자른다 — 2도 ¼ sp, 3도 ½ sp, 5도 이상 1 sp (Gould의 표와 같은 모양). 첫·끝이 같은 높이거나, 가운데 음이 양끝보다 beam 쪽으로 나오면(오목) 수평.
- **높이**: 모든 stem이 적어도 `max(3.5, 2.5 + 0.75·(beam 수 − 1))` sp — 가장 짧은 stem이 그 길이. 한 성부만 있는 staff-마디에서는 beam이 가운데 줄까지 온다(덧줄 음). **두 성부 이상이면 가운데 줄 규칙을 쓰지 않는다** (beam 없는 stem도 같음) — 다른 성부로 뻗지 않게 (G4-C2; for-all-the-saints 23마디가 이 경우). 음이 달고 있는 임시표·점·머리·덧줄과 0.25 sp 떨어질 때까지 beam을 바깥으로 옮긴다 (`beamClash`).
- **secondary·hook**: 레벨 k(2 이상)는 flag 수가 k 이상인 이웃 멤버끼리, 그래프 `breaks[{after, level ≤ k}]`에서 끊김. 한 멤버만 남으면 hook: 첫 멤버는 오른쪽, 끝 멤버는 왼쪽, 점음표 뒤는 왼쪽, 앞 음과 같은 박이면 왼쪽, 아니면 오른쪽 (§11.2). 길이는 머리 폭(1.18 sp)과 이웃 stem까지의 0.6 중 작은 것. 박은 박자표에서: 복합박자는 점 4분 단위, 가산 박자는 묶음.
- **나뉨**: system을 넘는 beam은 system마다 한 조각; 멤버가 두 staff에 걸친 beam(`deferred:cross-staff-beam`, 코퍼스 0)은 staff마다 조각; 조각에 stem이 하나뿐이면 그 음에 flag를 돌려준다.
- **객체**: `kind: 'beam'`, `id = <beam>#L<level>.<첫 멤버의 beam 안 순번>` (hook이면 뒤에 `h`), `refs [beam]`, `events` (조각이 잇는 음), `line` (윗모서리 양끝), `t` (두께 0.5, 꾸밈음 0.33), `dir`, `hook`. stem은 beam 바깥 모서리에서 끝난다. beam 아래 음에는 flag가 없다.
- **쉼표**: beam 안이나 밑의 쉼표(E03)는 §34.6의 규칙이 beam을 장애물로 보고 옮긴다.

### 34.4 Stem과 성부 역할 (§14.1)

stem 방향의 순서: 그래프 `display.stem` (plan `stemFrom: 'graph'`) → 성부 역할 (`'voice'`: 그래프 순서로 up/down) → beam의 방향 → `autoDir`. beam 없는 stem 길이는 G4b 그대로(3.5, flag 3개부터 +0.5, 한 성부면 덧줄 음은 가운데 줄까지). cross-staff 화음(`deferred:cross-staff-chord`)의 다른 staff 쪽 부분은 stem이 반대 방향이고 ID는 `<event>#stem:<staff>`, flag는 집 staff에만 (R5).

### 34.5 음표머리 충돌 — G4-B11의 결정 (G4-C3, G4-C4)

**G4-B11을 정했다: 성부 사이 2도·모양이 다른 unison에서 stem 아래(down) 성부가 오른쪽으로 간다 — §14.2가 옳고, G4b의 코드(stem 위 성부를 오른쪽)를 바꿨다.** 근거:

1. 고정된 VexFlow 4.2.3의 `StaveNote.format` (vendored 파일 133000번째 문자 부근): 두 성부가 닿고 stem이 반대면 **아래 음(`noteL`)에 `setXShift(h + 2)`** — 보통의 순서(위 성부 = stem 위)에서 그것은 stem 아래 음이다. 머리 모양이 같고 점 수가 같으며 2도가 아니면 옮기지 않는다(공유). (Fixer 정정, §34.18.6: `noteL`은 음높이로 정한 "아래 음"이 아니다 — 첫 성부의 음이 stem 아래이고 둘째가 stem 위이면 둘을 바꾼 뒤이므로, stem이 반대일 때 옮겨지는 음은 **언제나 stem 아래 음**이다.)
2. Gould, *Behind Bars* p. 53: "Offset the lower part to the right. Vertically align the upper part with a part on another stave" — MuseScore 포럼 글(musescore.org/en/node/24850)에 인용된 문장을 웹 검색으로 확인했다. 책 자체는 이 세션이 확인하지 못했다 (Fixer도 §33.16.5에서 G4b 코드 주석의 "stem이 바깥, Gould"를 확인하지 못했다). 인용과 VexFlow가 같은 쪽을 가리킨다.
3. legacy 렌더러는 VexFlow formatter로 그리므로 사용자가 지금 보는 모양이 이쪽이다 (M-H2 비교가 같은 관례 위에서 이루어진다).

규칙(`staffColumn`): 한 기둥·staff의 event들을 stem 위 성부 먼저, 그다음 ID 순으로 놓는다. 앞서 놓은 성부와 **충돌**하면 — 머리끼리 겹침(H1), stem이 다른 성부의 머리를 지남, flag가 다른 성부의 머리에 닿음 — 그 성부 전체(머리·stem·flag)의 오른쪽 끝에서 0.2 sp(VexFlow의 `h + 2` px) 더 오른쪽으로 옮긴다. beam에 든 stem은 충돌 검사에서 8 sp로 본다 (beam이 늘릴 수 있으므로). 그래서 성부가 교차하는 경우도 옮겨지고, G4b ratchet의 stem·flag 충돌 216이 0이 되었다. 세 번째 성부는 앞의 둘을 모두 지나 옮겨진다.

**unison 공유 (§14.2)**: stem이 반대인 두 성부, 같은 적힌 음(같은 alter), 같은 머리 glyph, 같은 점 수, 공유할 머리가 둘 다 stem 쪽 제자리(2도로 밀린 머리가 아님), 임시표가 없거나 같음, 그리고 그 머리를 빼면 충돌이 없을 때 머리 하나를 공유한다. **그래프 head마다 객체가 하나씩 그대로 남는다** — 두 notehead 객체가 같은 상자에 있고 `merged`로 서로를 이름 댄다; 임시표가 둘이면 한 자리에 둘(역시 `merged`), 점은 위 성부의 칸에. plan의 ledger는 `drawn` 그대로다 (G4-C4: §14.2·§14.3의 "ledger `merged`"를 EngravedScore의 `merged`로 읽는다 — 두 그래프 객체가 다 그려지고, 연습 map이 어느 성부든 그 머리를 찾는다; plan은 glyph 모양과 기둥을 모른다). 코퍼스(E + 347): 공유 머리 1,778(889쌍).

### 34.6 쉼표 (§14.3, R6, R8)

- **기본 높이**: 그래프 `display.pos`가 있으면 그 자리, 아니면 온쉼표는 넷째 줄에 매달림, 2분쉼표는 가운데 줄 위, 나머지는 가운데. G4b의 "역할이면 ±2 sp"는 없앴다.
- **성부 쉼표**: staff-마디에 성부가 둘 이상이면 (**쉬기만 하는 성부도 센다** — plan의 역할은 소리 나는 성부만 세므로, 쉼표의 up/down은 그래프 성부 순서로 따로 정함, G4-C7) 또는 쉼표가 beam 밑에 있으면, `layout`이 beam을 놓은 뒤 쉼표를 옮긴다: 다른 성부의 머리·stem·flag·beam·덧줄·임시표·점·쉼표, 그리고 어느 성부든 beam과 가로로 겹치는 것에서 0.5 sp 떨어질 때까지 한 staff space씩 (줄은 줄, 칸은 칸) — 위 성부는 위로, 아래 성부는 아래로, 역할이 없으면 만난 것의 반대로; 점도 같이. 12칸 안에 자리가 없으면 진단 `REST_UNPLACED` (코퍼스 0).
- **병합**: 한 기둥·staff에 음이 없고 둘 이상의 성부가 같은 길이·모양·점으로 쉬면 한 자리 — 객체는 각각, 같은 상자, `merged` (코퍼스 242).
- **마디 쉼표**: `measureRest`이거나, 그 성부의 마디 안 유일한 event가 마디 전체를 쉬는 쉼표면 온쉼표(마디가 온음표 둘 이상이면 겹온쉼표), 점 없음, 마디 가로 가운데 (A11, R6; 코퍼스 164). 세로는 위 규칙대로.
- **R8**: `prepare`는 plan에 아무것도 쓰지 않는다 (쉼표 높이는 지역 map; 테스트가 plan JSON을 전후 비교).

### 34.7 꾸밈음 (§14.5)과 cross-staff (§14.4)

- 주 음 기둥의 왼쪽, 0.66 크기: 머리·임시표·덧줄(G4b) + **stem**(그래프·역할 방향, 없으면 위; 길이 3.5 × 0.66), **flag**(beam이 없을 때), **사선**(`slash`, 첫 stem을 끝 근처에서 가로지르는 선 — beam 묶음이면 첫 음에만), **beam**(그래프 beam — 0.66 두께·간격, 가운데 줄 규칙 없음), **점**(점 꾸밈음: 머리 뒤, flag가 닿으면 flag 뒤). 묶음 폭은 flag·사선까지 포함해 오른쪽에서 왼쪽으로 쌓는다. 코퍼스: 꾸밈음 stem 220, flag 106, 사선 102, beam 114.
- 그래프 beam이 없는 part의 꾸밈음 묶음은 beam이 없다 (`pro-beam`은 꾸밈음을 묶지 않는다; §14.5의 "둘 이상이면 beam"은 그래프 beam으로 — 그런 꾸밈음이 코퍼스에 0, G4-C8).
- 뒤꾸밈음은 `deferred:grace-after` 그대로 (그리지 않음).
- cross-staff event는 그 staff에(지원), 두 staff에 걸친 화음은 staff마다 부분 화음(`deferred`), ID 중복 없음 (R5, `eg.layout.duplicate_ids` 0).

### 34.8 SVG 백엔드 (`svg.js`, G4-L1, B9, R7; G4-C9)

- **입력·출력**: `svg(engraved, plan, {px: 10, idPrefix: 'ppp-g-', hash: false})` → 문자열. 같은 입력은 같은 바이트 (Node = Chrome 808/808, §34.14). DOM을 읽지도 재지도 않는다.
- **단위**: viewBox는 staff space로 된 페이지, `width`·`height`는 px(1 sp = 10 px). 좌표는 0.01까지. 잉크는 `currentColor` (테마는 G4d-2가 CSS `color`로).
- **glyph**: 쓰는 glyph마다 `<defs>`에 `<symbol id="ppp-g-<이름>" overflow="visible"><path transform="scale(0.002777778 -0.002777778)" d="…"/></symbol>` 한 번, 객체마다 `<use href="#…" x y>`(크기가 1이 아니면 `transform="translate(…) scale(…)"`). **R7**: VexFlow의 윤곽은 bbox 단위의 1.44배 단위로 저장되어 있다 (bbox 1,000/em, 윤곽 1,440/em — 66 glyph에서 비율 1.438–1.442); 1 sp = 360 윤곽 단위로 그리면 metric 표의 상자와 0.025 sp 안에서 맞고, Chrome이 그린 `<use>`의 상자는 EngravedScore 상자와 0.01 sp 안이다 (`browser-parity.js`, E14). G4b의 `layout-view.js`는 자기 윤곽 그리기를 버리고 `svg.js`를 쓴다 (+ `--boxes` 겹쳐 보기).
- **그 밖**: stem·덧줄·세로줄은 `<rect>`, beam은 평행사변형 `<path>`, 보표선은 마디·staff마다 path 하나, slash 머리는 기울어진 막대, brace는 채운 곡선, volta는 선 + `<text>`, tuplet 괄호는 숫자 자리를 끊은 선.
- **DOM 계약 (§16.4)**: `g.ppp-stave[data-m][data-staff][data-begin][data-end][data-volta][data-time]` — 마디·staff마다, legacy의 값(`repeat`/`final`/`double`, `BEGIN`/`BEGIN_END`/`MID`/`END` + `:번호`는 윗 staff에만, 박자표를 그린 마디의 `b/bt`); system 머리는 첫 마디 것에, 끝 courtesy는 끝 마디 것에. `g.ppp-note.vf-stavenote[data-onset][data-ev]`(+`data-rest="1"`) — event와 staff마다, `data-onset`은 legacy 키(`plan.onsetKey`). 안에 `.vf-notehead`(쉼표도, VexFlow처럼), `.vf-stem`, `.vf-flag`, `.vf-accidental`, `.vf-dot`, `.vf-ledger`. 꾸밈음은 `g.ppp-grace[data-ev]`(시간을 먹지 않으므로 `ppp-note`가 아님). `path.vf-beam[data-beam]`, `g.ppp-tuplet[data-tuplet]`, `g.ppp-volta`, clef `.vf-clef`. 뿌리 `svg.ppp-engraved[data-plan]`(그래프 fingerprint와 plan 버전), `data-layout`(layout hash)은 요청할 때만 — sonatina/020에서 hash가 45–125 ms로 SVG 쓰기(9 ms)보다 비싸다.
- **B9** (§19.1 legacy 전곡 SVG 대비, hold-out 아닌 다섯 곡): burgmuller25/021 155 KB / 828 = 0.19, czerny849/001 171 / 725 = 0.24, sonatina/013 443 / 2,182 = 0.20, sonatina/016 506 / 1,894 = 0.27, sonatina/020 606 / 2,154 = 0.28 — 모두 ≤ 0.5. `svg.test.js`가 CI에서 같은 비교를 한다 (바이트는 결정론적 대리 지표, §19.2).

### 34.9 G4b backlog (§33.16.8) — 닫은 것

| # | 지적 | 한 일 | 증거 |
| --- | --- | --- | --- |
| R4 | layout 수준 다중집합이 event·머리뿐, 적힌 음 → y 검사 없음 | `l2.js`: `eg.layout.attachment_diff` (임시표를 가진 head 집합 = plan의 `acc` head 집합; event의 점 수는 점 수의 배수, 마디 쉼표는 0), `eg.layout.signature_diff` (system 머리의 clef glyph, 조표 수·종류, 박자표; system 안 조·박자 변경과 제자리표 수, 마디 안·마디 경계 clef 변경), `eg.layout.pitch_y_err` (모든 머리의 가운데 y = 보표 윗선 + staff space × clef 아래 적힌 음의 자리, `l2.js`의 자기 `staffY`); `eg.layout.multiset_diff` 키에 꾸밈음 여부 | 코퍼스 0; 음성 대조(`notation.test.js`): 반 칸 옮긴 머리, 빠진 임시표, 점 붙은 마디 쉼표, clef 빠진 system 머리, 안 그린 박자 변경 |
| R5 | cross-staff 화음의 `#stem`/`#flag` ID 중복 | 다른 staff 쪽은 `#stem:<staff>`, flag는 집에만; `eg.layout.duplicate_ids` | E26; 음성 대조 |
| R6 | 점 붙은 마디 쉼표, 적힌 음가 모양 | 온(겹온)쉼표, 점 없음, 가운데 | E29, 합성 3/4 점2분쉼표; `eg.rest.measure_errors` |
| R7 | `layout-view.js`가 윤곽을 1.44배로 | `svg.js`를 metric 척도로, `layout-view.js`는 `svg.js`를 씀 | §34.8; `svg.test.js`, `browser-parity.js` |
| R8 | `prepare`가 plan에 `__restY` | 지역 map | `notation.test.js` (plan JSON 불변) |
| R11 | ragged 마지막 system의 u가 작은 보표 u(0)의 중앙값일 수 있음 | 전체 크기 system의 u만 모음 | 휴대폰 M05(첫 system 축소, u 0) → 마지막 u 4 (고치기 전 0) |
| O1 | canon이 NaN을 `null`로 | 예외 (`canonical: a number that is not finite at $.a[1].b = NaN`) | 테스트 |
| O2 | engraver 캐시 키 반올림(0.01) ≠ 배치 폭 | `normalizeConfig`가 폭을 0.01로 — 키와 배치가 같은 config | 50.004 / 50.001 / 50 → 한 번 배치, 두 번 적중 |
| O4 | `l2.js`의 겹침 규칙이 `skyline.js`와 같음 | `l2.js`의 목록을 §10.3에서 새로 적고 넓힘 (임시표 대 +flag·beam, 점 대 +덧줄·beam, 쉼표 대 +beam·점, 머리 위를 지나는 +beam); 겹침은 1/100 sp 정수로, beam은 상자가 아니라 기울어진 띠로; `skyline.js`·`notation.js`를 불러오지 않음 | `notation.test.js` O4 (소스 검사, 목록이 더 넓음) |
| — | 마디 안 조 변경 `pending` (§33.15) | 시간 없는 기둥(clef 다음), 모든 staff에, 앞 조의 제자리표; 이후 마디의 system 머리·courtesy·조 변경 취소는 마디 안 변경까지 읽음 (`keyAt`·`keyAtEnd`) | `tempo-meter-key-changes.musicxml`; `signature_diff` 0 |
| — | ratchet 둘 → 0 | `eg.rest.overlap` 189 → **0**, `eg.voice.stem_over_head` 216 → **0** (E + 코퍼스, 두 config); R suite 34 / 74 → 0; `bench.js`의 `RATCHET`을 없애고 영목표(ZERO)로 | `layout.test.js`, baseline r·e·x |

### 34.10 Metric — layout 수준 L1·L2 (`tests/engrave/l2.js`; G4-C10)

`l2(engraved, plan, {prepared, layout, graph})`. `graph`를 주면 beam·tuplet 검사가 plan이 넘긴 것이 아니라 **그래프가 말하는 것**을 읽는다 — plan이 그래프 beam을 버리거나 tuplet의 `show`를 무시해도 잡힌다 (M1, M5). `bench.js`·`layout.test.js`·mutation test가 그래프를 넘긴다. 목록(모두 영목표, 두 config 합; `eg.beam.slope_max`만 최댓값):

| metric | 뜻 | §21 이름 |
| --- | --- | --- |
| `eg.beam.graph_missing` | 그래프 beam마다 level 1 beam 조각들의 `events`가 system·staff별로 그 beam의 stem 있는 멤버와 같음 | `eg.beam.graph_drawn_ratio`, `members_exact` (render) |
| `eg.beam.derived_missing` | 그래프 beam 없는 part에서 `pro-beam.groups()`(그래프에서 직접, 병합 tuplet 묶음 반영)가 낸 묶음마다 같음 | A3 render |
| `eg.beam.unplanned` | 그래프에도 파생 규칙에도 없는 beam, 또는 그 beam에 없는 음을 잇는 조각 | `eg.beam.orphan` (render) |
| `eg.beam.level_errors` | 멤버 stem 위 beam 레벨 수 = flag 수(hook 포함), 그래프 break를 넘는 조각 없음 | §11.2 |
| `eg.beam.flag_errors` | beam 아래 flag, beam 없는 flag 음표의 flag 없음 | §11.2 |
| `eg.beam.slope_max`, `eg.beam.slope_violations` | 가장 가파른 기울기(4 sp 이상의 primary, 0.01로), 0.25를 반올림 둘 넘게 넘은 조각 | A21 |
| `eg.beam.head_crossings` | beam 띠가 자기 음의 머리를 지남 | H7 |
| `eg.stem.short` | stem 쪽 머리에서 끝까지 < 2.5 + 0.75(n − 1)(beam) 또는 3.5(beam 없음), 꾸밈음 × 0.66 | A21 |
| `eg.voice.stem_policy_violations` | stem `dir`이 그래프 → 역할 → beam → 가운데 줄 규칙과 다르거나 기하가 방향과 다름 (`l2.js`의 자기 `autoDir`, 머리 자리는 반 칸으로 읽음) | A26 |
| `eg.rest.overlap`, `eg.voice.stem_over_head` | G4b의 둘, 넓힌 목록과 beam 띠 (공유 unison·병합 쉼표 짝은 제외) | A26 |
| `eg.tuplet.missing` | 그려질 tuplet(merged 묶음 포함)마다 숫자나 괄호 | `eg.tuplet.drawn_ratio` (render) |
| `eg.tuplet.show_errors` | 숫자("3", "3:2", 없음)·괄호 유무·명시된 placement가 그래프 `show`(없으면 §12.1·§12.3 기본)와 다름 | `eg.tuplet.show_ok` (render) |
| `eg.tuplet.suppressed_rendered` | `printed:false`·`show.number:'none'`+괄호 없음에 그린 것 | `eg.tuplet.suppressed_drawn` (render) |
| `eg.tuplet.extent_err` | 괄호가 첫 멤버(쉼표 포함) 머리 왼쪽 ~ 끝 멤버 오른쪽(점 포함)을 덮지 않음 | `eg.tuplet.extent_err` |
| `eg.tuplet.nesting_errors` | 안쪽 tuplet이 바깥 tuplet보다 음에서 멂 | §12.1 |
| `eg.grace.misplaced`, `eg.grace.stem_errors` | 꾸밈음 머리가 `grace`·0.66이 아니거나 주 음 기둥 오른쪽·다른 기둥에; stem·flag(beam 아닐 때)·사선이 없음 | A7, M16 |
| `eg.rest.measure_errors` | 마디 쉼표가 온(겹온)쉼표가 아니거나 점이 있거나 가운데가 아님 | A11 |
| `eg.layout.attachment_diff`, `signature_diff`, `pitch_y_err`, `duplicate_ids` | §34.9 R4·R5 | A14 |

plan 수준의 G4a metric(`eg.beam.graph_drawn_ratio` 등)은 `bench.js`에 그대로다; `eg.tuplet.show_ok`의 기대값에만 §12.3(한 음은 숫자만)을 넣었다. 모든 새 metric은 `notation.test.js`의 음성 대조(실제 layout을 망가뜨림)가 1 이상을 낸다. (리뷰 뒤 Fixer가 영목표 일곱을 더했고 `merged` 짝은 합법일 때만 겹침에서 뺀다 — §34.18.3.)

### 34.11 Mutation (`tests/engrave/layout-mutation.test.js`, §23)

G4b의 틀(CRLF 사본, anchor 정확히 한 번, 출력이 바뀌어야 함, 이름 붙은 metric이 잡아야 함, 그 metric은 mutation 없이 0)에 파일 선택(`file`)과 그래프 전달을 더했다. probe: E02, E04, E12, E13, E14, E33, E37, E38, Czerny 849/005, Burgmüller 25/015, 그리고 끝이 쉼표인 괄호 셋잇단(합성, M24용). 실행 약 18 s (Linux 22 s), `npm run test:engrave` 안.

| # | 심은 결함 (파일) | 잡은 이름 (probe × 두 config 합) |
| --- | --- | --- |
| M1 | 그래프 beam을 버리고 모든 part를 파생 (`plan-beams.js`) | `eg.beam.graph_missing` 712 |
| M2 | 파생 beam을 그리지 않음 (`layout.js`) | `eg.beam.derived_missing` 8 (+ `flag_errors`) |
| M3 | 두 성부의 stem을 뒤집음 (`layout.js`의 역할) | `eg.voice.stem_policy_violations` 6 |
| M4 | tuplet 숫자·괄호를 그리지 않음 | `eg.tuplet.missing` 24 |
| M5 | `show.number:'none'` 무시 (`plan-tuplets.js`) | `eg.tuplet.show_errors` 170, `eg.tuplet.suppressed_rendered` 170 |
| M16 | 꾸밈음을 보통 음처럼 시간 기둥에 | `eg.grace.misplaced` 8, `eg.layout.multiset_diff` 10 |
| M24 | tuplet 괄호가 끝의 쉼표를 빼고 끝남 | `eg.tuplet.extent_err` 2 |
| G4b의 12 | M6, M7a, M7b, M9, M10, M11a, M11b, M17, M18a–c, M21 (anchor만 새 코드에 맞춤) | 전부 그대로 잡힘 (예: M6 `eg.overlap.acc` 174, M21 `head_staff_wrong` 454) |
| N1, N2 | 주석; 독립 문장 둘(꾸밈음 beam 판정과 tie 시작) 순서 | 바이트 동일, metric 같음, A29 깨끗 |

리뷰 뒤 Fixer가 RF, RI, RY, RX, RB, RB2, RK, F1–F3과 probe 셋을 더했다 — §34.18.4.

### 34.12 Acceptance

| # | 기준 | 증거 | 판정 |
| --- | --- | --- | --- |
| A2 | 그래프 beam마다 멤버가 같은 beam 하나, break·hook 규칙, 그래프 beam 있는 part에 파생 0, 근거 없는 beam 0 | `eg.beam.graph_missing`·`level_errors`·`unplanned` 0 (E + 코퍼스 387 × 2, r·e·x), plan 수준 `derived_in_beamed_part` 0; E01–E03·E39 테스트 (E02 break와 점음표 뒤 왼쪽 hook); M1 | PASS |
| A3 (render) | 파생 beam = `pro-beam.groups`, 그래프 beam 없는 곳에만; `pro-beam.js`·`meter-grid.js` 불변 | `eg.beam.derived_missing` 0 (그래프에서 다시 계산); E38; 두 파일의 LF sha256이 G3의 것 (테스트); M2 | PASS |
| A4 | printed tuplet마다 §12.1대로, `printed:false`에 0, 중첩 순서, 1-음은 G4-U2 B | `eg.tuplet.*` 0; E04(괄호, 숫자만, 없음 둘), E05(안쪽이 가까움), E06(쉼표 포함 괄호), E07(병합 둘은 숫자 하나씩, 격자 밖 셋은 숫자만), 명시 `3:2`·아래; M4, M5, M24 | PASS |
| A7 (꾸밈음) | 꾸밈음이 그래프에 있을 때 그려짐 | `eg.grace.*` 0; E14 (사선, beam 쌍, 임시표 있는 주 음의 왼쪽, 뒤꾸밈음 deferred), 점 꾸밈음; M16 | PASS (꾸밈음 몫) |
| A11 (마디 쉼표) | 마디 쉼표 가운데 | `eg.rest.measure_errors` 0; E29 (3/4, 6/8), R6 | PASS (마디 쉼표 몫; 마디 안 조 변경도 놓음) |
| A21 | 기울기 ≤ 0.25, 짧은 stem 0, beam이 자기 머리를 지나지 않음 | `slope_max` 0.25 (r·e·x·코퍼스), `slope_violations`·`stem.short`·`head_crossings` 0; 합성 테스트 (8도 도약, 오목·볼록, 2도 ¼ sp, 32분음표 4 sp, 덧줄 음) | PASS |
| A26 | 다성부 stem 규칙 위반 0, 쉼표가 다른 성부와 겹침 0 | `stem_policy_violations`·`rest.overlap`·`stem_over_head` 0 (R 찬송가 포함 — 이전 34/74); E12–E13; M3 | PASS |
| B9 | 전곡 SVG ≤ 0.5 × 기준선 | 0.19–0.28 (§34.8) | PASS |
| A14 | 다중집합 = plan, 기둥 순증가 | `multiset_diff`(꾸밈음 포함) 0, `column.order_violations` 0 | PASS |
| A17–A19 | 잘림·머리·임시표·점 겹침 0 | 0 (넓힌 목록으로) | PASS |
| A23 | rod·단조성 위반 0 | 0 | PASS |
| A24 | 넘침 0(원본 결함 1곡 허용), 피할 수 있었던 1마디 0 | 그대로 | PASS |
| A27 | 3회·역순·Windows = Linux | layout hash 118 × 2 다시 bless (§34.15) — Docker `node:24-bookworm`, LF clone에서 전부 같음 | PASS |
| A28 | Node = Chrome | 808/808 layout hash, **SVG 808/808 바이트 동일**, 네트워크 0 | PASS |
| A29 | DOM 측정 0, VexFlow 고정 | A29 검사 (`svg.js`도 모든 규칙에 깨끗), vendor 테스트 | PASS |
| B1–B7 | §19.2 | §34.13 | PASS (B5는 G4f 판정) |

### 34.13 성능 (이 PC, Node 24.17, `layout-perf.js` 5회 중앙값, ms)

| 곡 | event | 마디 | plan | prepare | layout 데스크톱 | 휴대폰 | SVG | 연습 map | system | 객체 | SVG KB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| beyer/028 | 95 | 16 | 1.06 | 0.70 | 0.79 | 0.71 | 0.86 | 0.20 | 4 | 252 | 34.7 |
| hymns/take-my-life | 136 | 16 | 1.49 | 0.81 | 1.06 | 1.05 | 0.78 | 0.33 | 4 | 390 | 51.6 |
| burgmuller25/021 | 468 | 33 | 5.99 | 3.96 | 4.48 | 4.19 | 2.36 | 0.79 | 9 | 1,271 | 154.8 |
| czerny849/001 | 548 | 32 | 7.02 | 3.77 | 5.27 | 4.37 | 2.24 | 0.76 | 9 | 1,486 | 171.0 |
| sonatina/013 | 1,354 | 86 | 19.25 | 12.06 | 16.05 | 13.99 | 6.79 | 2.19 | 24 | 3,924 | 443.0 |
| sonatina/016 | 1,494 | 92 | 19.82 | 12.91 | 15.45 | 15.31 | 8.30 | 2.80 | 25 | 4,601 | 506.0 |
| sonatina/020 | 1,563 | 158 | 19.18 | 13.20 | 18.56 | 19.20 | 8.89 | 2.37 | 40 | 5,400 | 605.6 |

코퍼스 347: plan 중앙 1.36, 최대 20.73; prepare + layout 중앙 2.04, p95 14.66, 최대 30.82. 예산: B1 20.7 ≤ 60; B2 4마디 창 **layout + SVG** p95 1.11 ≤ 25; B3 0.01 ≤ 8; B4 전곡 prepare + layout + SVG 최대 40.7 ≤ 100; B6 p95 < 0.01, 만진 수 = 바뀐 수; B7 0; B9 0.28 ≤ 0.5 — 모두 PASS. B5(sonatina/020 전곡 40.7 ms, 가장 긴 호출 18.6 ms)는 G4b와 같이 G4f의 시간 나누기에서 판정한다. G4b 대비 sonatina/020 prepare + layout 23.7 → 31.8 ms (성부 충돌 검사, beam, tuplet). Chrome(1×) sonatina/020: plan 11.9, prepare 8.6, layout 14.0; 4× CPU: 60.8 / 45.6 / 66.0 — 한 호출이 50 ms를 넘는 것은 G4b 때와 같이 G4f의 idle·worker 나누기 몫이다 (§33.15 MINOR 3).

### 34.14 회귀 (G4c 코드 커밋 `ae96f19`)

| 검사 | Windows (`D:/PPP-g4`, Node v24.17.0) | Linux (Docker `node:24-bookworm`, Node v24.21.0; `ae96f19`의 `core.autocrlf=false` clone, LF 파일) |
| --- | --- | --- |
| `npm run test:engrave` | **149/149** (132 + `notation.test.js` 12 + `svg.test.js` 5) | **149/149** (mutation 보고가 글자까지 같음) |
| `npm run test:scoregraph` | **205/205** | **205/205** |
| `layout-hashes.js` | 118 × 2 전부 커밋된 hash | 같음 |
| `make-metrics.js --check`, `make-outlines.js --check` | PASS | PASS |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS | PASS / PASS / PASS |
| `make-e-fixtures.js --check`, `make-corpus.js --check` | PASS | — |
| G0 gate 부분 (`run.py sg-roundtrip`, `golden`, `run`+`check --suite smoke`, `core`; `ae96f19`에서) | 모두 PASS — sg-roundtrip 369 (367 + 허용 2), golden 17/17, smoke 44·core 553 오류 0, verdict PASS. G4c는 G0 경로(`audio-score.js`, `scoregraph/`)를 건드리지 않는다 | — |
| `browser-parity.js` (A28) | Chrome 153: layout 808/808, SVG 808/808, E14의 `<use>` 18개 상자 오차 ≤ 0.01 sp, 네트워크 0 | — |
| legacy parity (`legacy-parity.js`, `1c92fc4`의 `git archive`를 8796에, 이 트리를 8795에, `NODE_ENV=production HOST=127.0.0.1`) | **16/16 바이트 동일** — 측정 뒤 두 서버를 껐다; 8777·8788은 건드리지 않음 | — |
| `layout-perf.js` | 판정하는 예산 전부 PASS (§34.13) | — |
| 앱 파일 | `Piano Coach App.dc.html` 바이트 그대로 (`git diff 1c92fc4 -- 'Piano Coach App.dc.html'` 비어 있음) | — |

폭·창을 바꾼 견고성 실행(E + 코퍼스 + 전사 + G3a + projected, 434곡 × 폭 25·60·140·휴대폰 32·창 [2, 5]·휴대폰 창 [0, 1] = 2,604 layout): 예외 0, G4c의 영목표 metric 전부 0 (넘침·작은 보표·1마디 system은 G4b 줄바꿈이 그 폭에서 내는 것, gate 폭 100·40에서는 0).

### 34.15 커밋된 layout hash 다시 bless — 분류 (§21.3)

`tests/engrave/tools/layout-diff.js --base=<1c92fc4의 engrave/·scoregraph/>` (새 도구, 커밋): 118곡 × 두 config = 236쌍.

| 분류 | 수 | 바뀐 객체 종류 |
| --- | --- | --- |
| LEDGER_CHANGE (그린 것이 달라짐) | 146 | beam 134, tuplet 숫자 22·괄호 6, 꾸밈음 flag 12·사선 12·stem 14, 마디 쉼표 glyph 8과 그 점 4, 세로줄 1 (sonatina/025 휴대폰: 꾸밈음의 stem·flag로 넓어진 마디 때문에 줄바꿈이 바뀌어, 14마디 끝 세로줄을 같은 system이 된 15마디의 여는 반복이 대신함) |
| GEOMETRY_ONLY (좌표만) | 20 | 성부 비킴(G4-B11)·쉼표 자리·stem 길이; 줄바꿈이 바뀐 system 13 |
| SERIALIZATION_ONLY (좌표 같고 필드만) | 68 | stem의 `provisional` 없어짐·`dir` 생김 66, 쉼표의 `center`·`merged` |
| SAME | 2 | — |

LEDGER_CHANGE는 모두 이 단계가 그리기로 한 것(beam, tuplet, 꾸밈음 stem·flag·사선, R6의 마디 쉼표)이다. 이 도구는 system 장식(`d:staff`·`d:brace`·`d:sysbar`·system 머리의 clef·key·time)을 기하로 센다 — 줄바꿈이 옮겨진 것은 그린 것의 변화가 아니다. L1은 나빠지지 않았고(r·e·x의 plan 수준 값 전부 같음) L2는 전부 영목표 0이다. **bless 이유**: G4c가 beam·tuplet·꾸밈음 stem을 새로 그리고, stem을 최종으로 하고, G4-B11을 §14.2쪽으로 정했기 때문.

**stem 방향이 바뀐 것 (Fixer가 더함, 리뷰 M6)**: 위 표가 빠뜨린 변화가 하나 있다. G4c의 `autoDir`(G4-C2)은 가운데 줄에서 가장 먼 머리가 위아래로 같은 거리이면 다수, 그래도 같으면 **아래**다; G4b의 임시 stem은 같은 거리이면 plan 순서의 첫 머리를 따랐다(C3–E3 화음은 C3 → 위). 그래서 beam 없는 화음 stem **46개가 위 → 아래**로 바뀌었다 (데스크톱, 휴대폰도 같음; 9곡): **golden/G07의 C3–E3 8개** — G07 두 config의 변화는 이것뿐이라 GEOMETRY_ONLY(stem)다 — 그리고 golden/G11 2(G4–D5), golden/G17 2(C3–E3, A2–G3), czerny599/010 2·032 4·033 4·035 7(G4–B4–D5 13, C3–E3 2, A4–C5 1, G4–D5 1), burgmuller25/019 16·023 1(A4–C5 13, G4–D5 4) — 이 곡들은 beam 등 다른 변화와 함께라 위 표의 다른 줄에 들어 있다. 규칙은 §11.2(같으면 다수결, 그래도 같으면 아래) 그대로이고 모두 L2 0이다 (`eg.voice.stem_policy_violations`가 같은 규칙을 따로 계산).

### 34.16 설계 문서와 달라진 곳

1. **§14.2 성부 사이 2도·unison**: 규칙은 §14.2 그대로(아래 성부를 오른쪽) — 옮기는 양은 머리 폭 + 0.2 sp (VexFlow `h + 2`). G4-B11은 G4-C3이 대체한다.
2. **§14.2 unison, §14.3 쉼표 병합의 "ledger `merged`"**: EngravedScore의 `merged`로 기록한다 (두 그래프 객체가 다 남고 같은 자리); plan ledger는 `drawn` (G4-C4).
3. **§12.3 한 음 tuplet**: plan의 괄호 기본값이 거짓 — 숫자만 (G4-C5). 명시된 `show.bracket`은 그대로 이긴다.
4. **§12.2 높이**: tuplet은 언제나 보표 밖(보표선과 겹치지 않게), 괄호는 수평 (§12.2의 "최대 기울기 0.25로 따라감"은 쓰지 않음) — G4-C6.
5. **§11.2 가운데 줄 규칙**: 한 성부 staff-마디에서만 (G4-C2).
6. **§21.1 render 수준 이름**: `graph_drawn_ratio`·`drawn_ratio`·`show_ok`·`suppressed_drawn`의 layout 판을 영목표 개수(`eg.beam.graph_missing`, `eg.tuplet.missing`·`show_errors`·`suppressed_rendered`)로 두었다 — 두 config 합이 비율이 아니라 개수여야 해서 (G4-C10). plan 수준 비율은 그대로.

### 34.17 남은 것

- **BLOCKER 0, MAJOR 0** (implementer 자체 판정).
- MINOR·한계:
  1. cross-staff beam(`deferred`, 코퍼스 0)은 staff마다 부분 beam; system을 넘는 beam은 system마다 따로 — 끊긴 끝 표시가 없다.
  2. tuplet 숫자는 늘 보표 밖이고 괄호는 수평이다 — beam이 보표 안쪽에 있으면 숫자가 beam에서 멀다. M-H1에서 볼 것.
  3. 그래프가 한 beam 안에서 서로 다른 stem 방향을 말하면(kneed beam, 코퍼스 4) 첫 명시 방향이 전체를 정한다 (`BEAM_STEM_MIXED`).
  4. ~~교차 성부: VexFlow는 아래 음을(stem이 위여도) 옮기고, G4c는 stem 아래 성부를 옮긴다 — 보통 순서에서는 같다.~~ **(Fixer 정정, §34.18.6)** 틀린 기록이었다: vendored 4.2.3의 `StaveNote.format`은 첫 성부의 음(`noteU`)이 stem 아래이고 둘째(`noteL`)가 stem 위이면 둘을 바꾼 뒤(`n=a[1], l=a[0]`) `noteL`을 옮기므로, stem이 반대일 때 옮겨지는 음은 음높이와 상관없이 **언제나 stem 아래 음**이다. 교차 성부에서도 VexFlow와 G4c는 같은 음을 옮긴다 — 남은 차이가 아니다.
  5. 보표 밖으로 옮겨진 온·2분쉼표에 덧줄이 없다.
  6. 그래프 beam이 없는 part의 꾸밈음 묶음은 flag로 그려진다 (코퍼스 0).
  7. `svg.js`의 `<use class="vf-notehead">` 안에는 `path`가 없다: `pdf-layer.test.js`의 `.vf-notehead path` 같은 legacy 선택자는 G4d-2(A30)에서 이유와 함께 바꿔야 한다.
  8. EngravedScore 전체 hash가 비싸다 (sonatina/020 45–125 ms) — `svg.js`는 요청할 때만 쓴다; 페이지 캐시 키는 G4d-2가 plan key + config로.
  9. 폭 25·32 sp 같은 gate 밖 폭에서 G4b 줄바꿈의 피할 수 있었던 1마디 system 11 (§34.14) — G4c 원인 아님.
  10. §33.15의 그 밖(`in-the-bleak-midwinter` 넘침, 4× CPU의 plan 50 ms 넘음), §32.14의 MINOR·OPTIONAL, G4-F14(`bracket="yes"`)는 그대로.
- 다음: G4d-1(곡선·기호·글자·세로 배치), G4d-2(앱의 개발용 스위치, `svg.js`를 새 `sync`와 함께, R12). 그 뒤 M-H1.

**커밋 (Implementer)**: `ae96f19` (코드·테스트·baseline·layout hash·CI의 `make-outlines --check`·`vendor/README.md` 한 줄), 이어서 이 기록 (G04 §14.2·§14.3 주석, §34, 목차; DECISIONS G4-C1–C12와 G4-B11 대체 표시; CURRENT_STATE). `origin/g4c-notation-core`에 push. 병합 안 함, PR 없음. (이 단락은 처음에 §34.18 "커밋"이었다 — §34.18을 리뷰와 Fixer에 내주려고 여기로 옮겼다.)

**상태: G4c READY_FOR_REVIEW** — BLOCKER 0, MAJOR 0 (자체 판정).

### 34.18 리뷰와 Fixer (2026-09-25)

입력: G4c 독립 리뷰 (read-only, 대상 `f5517fe`; 증거는 리뷰 scratchpad `g4c-review/`의 `mutate.py`·`mut.js`·`analyze.js`·`analyze2.js`·`pairdiff.js`·`out/`·`png/`)의 판정 **NEEDS_FIX — BLOCKER 0, MAJOR 2, MINOR 6**, 그리고 Lead의 Fixer 지시: MAJOR R1·R2와 기록 정정(M6)만 하고, 나머지 MINOR(M1–M5)는 Lead가 맡긴 곳으로 둔다. 같은 worktree `D:/PPP-g4`, 브랜치 `g4c-notation-core`, 시작 `f5517fe`. 리뷰의 스크립트는 생각만 빌렸고(mutation은 리뷰가 적은 anchor 그대로 옮김), 커밋한 metric과 테스트는 새로 썼다. `engrave/`에서 바뀐 파일은 `layout.js` 하나다 (R1, 그리고 R2의 새 metric이 찾은 병합 결함). `scoregraph/`·앱 파일·재생 코드·카탈로그·`vendor/`는 바이트 그대로이고, `plan/1`·`engr/1`은 올리지 않았다 (M4, Lead 지시). 결정은 DECISIONS G4-C13–C16.

#### 34.18.1 지적과 처리

| # | 지적 (리뷰) | 처리 | 어디 |
| --- | --- | --- | --- |
| R1 (MAJOR) | flag가 있는 unison이 공유되지 않는다: `layout.js` `clash()`의 flag 검사가 공유 머리(`sa`/`sb`)를 건너뛰지 않아 stem 위 flag가 두 성부의 공유 머리에 "닿고", 아래 성부가 flag 오른쪽 끝을 지나 2.31 sp 옮겨진다 — 간격 1.1 sp, 잇단 두 8분처럼 읽힌다 (§14.2는 공유 MUST, G4-C3은 머리 폭 + 0.2 sp). E + 코퍼스(데스크톱)의 같은 모양 한 음 unison 908 중 34가 공유 안 됨(21곡, 전부 flag; R suite의 what-child-is-this·czerny849/007 포함), flag 있는 2도도 1.1 sp. L2는 전부 0 | **FIXED** — flag 검사도 공유 머리를 건너뜀; 옆 성부는 flag가 자기 머리 높이에 닿을 때만 flag 뒤로 (G4-C13); metric `eg.voice.unison_unshared`·`eg.voice.offset_err`; mutation F1·F2; E12에 flag unison과 2도 | §34.18.2 |
| R2 (MAJOR) | `l2.js`의 `mergedPair`가 layout이 `merged`라 붙인 짝을 합법인지 보지 않고 모든 겹침 수에서 뺀다; G4c의 새 규칙 몇이 이름 붙은 metric이 없어 리뷰의 mutation RF, RI, RY, RX, RB(RB2), RK가 커밋된 layout hash(A27)로만 잡힌다; E12·E13에 §22.1의 두 경우(점 다른 unison, 길이 다른 쉼표)가 없다 | **FIXED** — 합법 병합만 겹침 수에서 빠지고 나머지는 `eg.voice.merge_illegal` (G4-C14); `eg.stem.middle_line`, `eg.rest.position_err`, `eg.beam.hook_side_err`, `eg.tuplet.hook_dir_err` (G4-C15); mutation RF, RI, RY, RX, RB, RB2, RK와 F3이 모두 이름으로 잡힘; E12·E13에 두 경우 (G4-C16) | §34.18.3–§34.18.5 |
| M6 | 기록 오류 둘: §34.15가 같은 거리 규칙에 따른 stem 뒤집힘(golden/G07의 C3–E3 8개, 위 → 아래)을 적지 않음; §34.17.4가 "VexFlow는 stem이 위여도 아래 음을 옮긴다"고 적음 | **정정** | §34.18.6 |
| M1–M5 | MINOR 다섯 | **Lead가 맡김** — 손대지 않음 | §34.18.8 |

#### 34.18.2 R1 — flag 달린 unison과 2도 (`engrave/layout.js` `staffColumn`; G4-C13)

- **공유**: `clash()`의 flag 대 머리 검사 두 줄이 stem 검사처럼 공유 머리(`skip`의 `sa`/`sb`)를 건너뛴다 — 그 머리는 두 성부 모두의 제 머리이고, 제 flag가 거기 닿는 것은 충돌이 아니다. 리뷰의 한 줄 시험과 같은 결과: 같은 모양 한 음 unison 909/909 공유 (데스크톱, E + 코퍼스, 리뷰의 `analyze2.js`로 다시 잼 — `f5517fe`의 fixture로는 908/908, 새 E12가 하나 더함). 예: angels-we-have-heard 12마디(`m20`)의 e345/e351은 이제 한 머리.
- **비킴의 양**: 옮기는 성부는 부딪힌 성부의 **머리와 stem**의 오른쪽 끝 + 0.2 sp로 간다. 그 성부의 flag는 **flag의 세로 범위가 옮기는 성부의 머리와 겹칠 때만** 오른쪽 끝에 넣는다 (`reach`). stem 위 8분 아래의 2도는 머리가 flag 높이에 닿지 않으므로 머리 폭 + 0.2 = 1.38 sp (전에는 2.31). 공유할 수 없는 unison(점 수가 다름, 같은 화음 둘 — 후보가 하나가 아님)이나 교차에서 flag가 옆 머리 높이까지 내려오면 여전히 flag 뒤로 간다 (예: burgmuller25/019의 두 성부 E4–A4–C5 8분 화음, 2.32 sp).
- **보강 둘** (출력 변화 없음 — E + 코퍼스 + golden 808 layout 바이트 동일): 공유 머리를 건너뛰는 것은 두 성부가 한 자리에 있을 때만(`dx === P.dx`) — 셋째 성부 때문에 옮겨진 성부는 짝과 다시 온전히 검사한다; 옮김 양은 되풀이 중 줄지 않는다(`Math.max(dx, …)`) — 세 성부에서 오가지 않게.
- **공유 풀기** (R2의 `eg.voice.merge_illegal`이 찾은 `f5517fe`의 결함): 공유가 정해진 뒤 셋째 성부 때문에 한쪽이 옮겨지면, 두 머리가 떨어져 있으면서 서로를 `merged`로 이름 댔다 — for-all-the-saints 10마디(`m20`) 아래 보표: 위 성부 D4–G4–B4–D5와 아래 성부 G3–B3–D4가 D4를 공유했는데 셋째 성부 G2의 stem이 G3 머리를 지나 아래 성부가 1.38 sp 옮겨졌다. 이제 옮겨진 unison은 공유를 푼다 (`partnerHead`에서 지움): 두 머리에 `merged`가 없다 (좌표는 그대로 — `f5517fe` 대비 SERIALIZATION_ONLY).
- **잰 값** (E + 코퍼스 387곡 × 두 config; 새 E12 포함; `f5517fe` → 지금):

| metric | `f5517fe` | 지금 | 어디 |
| --- | --- | --- | --- |
| `eg.voice.unison_unshared` | **70** | 0 | 코퍼스 68 = 34쌍 × 2 (21곡 — 리뷰의 34와 같음), 새 E12 2 |
| `eg.voice.offset_err` | **10** | 0 | flag 달린 2도 1.13–1.14 sp: beneath-the-cross 8마디 E4/D4, glorious-things 5마디 G4/F4, in-the-bleak-midwinter 4마디 D3/C3, midnight-clear 13마디 F4/E♭4 (4곳 × 2; 리뷰는 3곳을 적음), 새 E12 2 |
| `eg.voice.merge_illegal` | **4** | 0 | for-all-the-saints 2 × 2 (위) |

  R suite(`bench.js`, gate)에서는 `f5517fe`가 `unison_unshared` 10 (what-child-is-this, czerny849/007), E suite 새 E12에서 `unison_unshared` 2·`offset_err` 2.
- **바뀐 그림**: 공유 머리(E + 코퍼스, 데스크톱) 1,778 → 1,846 (+34쌍 R1, +1쌍 새 E12의 flag unison, −1쌍 for-all-the-saints). 코퍼스 layout 694 중 46이 바뀜(23곡: R1 공유 21곡, 2도만 glorious-things, 공유 풀기 for-all-the-saints); 좁아진 기둥 때문에 줄바꿈이 바뀐 것은 joy-to-the-world(두 config)와 rock-of-ages(데스크톱)뿐, 객체 수는 모두 같음.

#### 34.18.3 R2 — 합법 병합과 새 metric (`tests/engrave/l2.js`; G4-C14, G4-C15)

- **합법 병합** (`legalMerge`, `mergedPair`를 대신함): 서로를 이름 대고 한 자리(같은 system·staff, 상자 0.01 sp 안)이며 — **머리**는 다른 성부, 같은 적힌 음(step·octave·alter), 같은 glyph·크기, 같은 점 수, stem 반대(둘 다 stem이 없으면 허용); **쉼표**는 다른 성부, 같은 마디·시각, 같은 glyph·길이·점, 둘 다 그래프가 자리를 말하지 않음; **임시표**는 같은 glyph이고 그 머리들이 합법 짝. 꾸밈음은 병합하지 않는다. 합법 짝만 `eg.overlap.head_head`·`acc`·`dot`·`eg.rest.overlap`에서 빠지고, `eg.voice.stem_over_head`의 "공유 머리는 제 머리" 예외도 합법 짝에만 준다.
- **새 metric 일곱** (모두 영목표; `bench.js` ZERO와 `layout.test.js` ZERO_L2 — E + 코퍼스 전부 × 두 config가 0이어야 통과; baseline r·e·x는 키만 더함: `bench.js baseline`으로 쓰고 git diff로 대조 — 바뀐 값 0, 없어진 키 0):

| metric | 뜻 | `f5517fe` | 지금 | 잡는 mutation |
| --- | --- | --- | --- | --- |
| `eg.voice.merge_illegal` | `merged`를 가진 객체가 합법 짝이 아닌 상대를 이름 댐 (자리·음·glyph·점·길이·성부·stem 중 하나라도 어긋남) | 4 | 0 | RF, RK, F3 |
| `eg.voice.unison_unshared` | 한 system·staff·기둥의 한 음 event 둘: 다른 성부, 같은 적힌 음·임시표, 같은 glyph·크기·점, stem 반대 — 그런데 합법 공유가 아님 (§14.2 MUST) | 70 | 0 | F1 |
| `eg.voice.offset_err` | 한 기둥·staff에 stem 있는 두 성부 event(모든 머리가 제 staff)가 있고 한쪽이 옮겨짐(stem이 머리 기둥 자리에 있지 않음): 옮긴 쪽 머리 왼쪽 끝 ≠ 남은 쪽 머리·stem 오른쪽 끝(flag는 옮긴 머리와 세로로 겹칠 때만) + 0.2 sp (0.02 안); 둘 다 옮겨져도 | 10 | 0 | F2 |
| `eg.stem.middle_line` | 한 성부만 소리 나는 staff-마디의 stem(꾸밈음 제외; beam이면 그 beam 조각의 stem이 모두 그런 staff-마디일 때)이 가운데 줄에 닿지 않음 (§11.2, G4-C2) | 0 | 0 | RI |
| `eg.rest.position_err` | 쉼표 glyph의 원점이 출발 자리에서 staff space의 정수배가 아님 — 출발 자리는 그래프가 말한 자리, 아니면 줄(온·겹온쉼표는 가운데 위 줄에 매달림, 2분쉼표는 가운데 줄 위, 나머지는 가운데 줄 중심) (§14.3의 "줄/칸 모양 유지") | 0 | 0 | RY |
| `eg.beam.hook_side_err` | hook의 `hook` 값이나 그린 쪽(제 stem 기준)이 §11.2와 다름: beam 조각의 첫 음 오른쪽, 끝 음 왼쪽, 점음표 뒤 왼쪽, 앞 음과 같은 박 왼쪽, 아니면 오른쪽 (박은 `l2.js`가 박자표에서 따로 셈: 복합박자는 점 박, 가산 박자는 묶음) | 0 | 0 | RB, RB2 |
| `eg.tuplet.hook_dir_err` | 갈고리가 있는 괄호의 `hookLen` ≤ 0이거나, 상자가 음 쪽(위 괄호는 아래로, 아래 괄호는 위로)으로 hookLen만큼 뻗지 않음 (§12.2 "음 쪽으로 0.75 sp") | 0 | 0 | RX |

  넷(`middle_line`·`position_err`·`hook_side_err`·`hook_dir_err`)은 `f5517fe`의 규칙이 맞았던 곳의 지킴이다 — 0이 기대값이고, 규칙이 깨지면(mutation) 이름으로 잡는다. 모두 `l2.js`의 제 코드이며 `skyline.js`·`notation.js`를 불러오지 않는다 (O4 테스트 그대로).
- **A2 테스트**: `notation.test.js`의 A2가 이제 hook의 네 쪽을 모두 고정한다 (합성 곡: 앞 8분과 같은 박의 16분 왼쪽, 다음 박의 16분 오른쪽, beam을 시작하는 16분 오른쪽, 점8분 뒤 끝 16분 왼쪽; E02의 점음표 뒤 왼쪽은 그대로).
- **음성 대조** (`notation.test.js` "the G4c metrics find the defects they name", 실제 layout을 망가뜨림, 각 ≥ 1이고 원래 layout에서 0): 짝과 떨어진 공유 머리·점 다른 두 4분에 붙인 `merged`·4분과 2분 쉼표의 병합 → `merge_illegal`; 떼어 놓은 flag unison → `unison_unshared`; flag 뒤로 옮긴 2도 → `offset_err`; E34의 가운데 줄까지 늘인 stem을 1 sp 줄임 → `middle_line`; 반 칸 옮긴 쉼표 → `position_err`; E02 hook을 오른쪽으로 → `hook_side_err`; E04 괄호 `hookLen`의 부호 → `hook_dir_err`.
- **`f5517fe` 코드 음성 대조 (bench gate)**: `engrave/layout.js`만 `f5517fe`의 것으로 바꾸고 `bench.js check` — r: `REGRESSION eg.voice.unison_unshared = 10 (must be 0)`(what-child-is-this, czerny849/007), exit 1; e: `unison_unshared = 2`, `offset_err = 2`(E12), exit 1; x: PASS. 되돌리면 셋 다 PASS (파일 sha1 전후 같음).

#### 34.18.4 Mutation (`tests/engrave/layout-mutation.test.js`)

G4b·G4c의 틀 그대로 (CRLF 사본, anchor 정확히 한 번, 출력이 바뀌어야 함, 이름 붙은 metric이 잡아야 함, 그 metric은 mutation 없이 같은 probe에서 0; hash만으로는 인정 안 함). probe 셋을 더했다: E34(덧줄 음, 한 성부), `beamHooks`(합성: §11.2 hook의 네 쪽), `sharedThenMoved`(합성: 세 성부 — 셋째 성부의 stem이 공유된 unison을 떼어 냄). E12·E13은 새 경우를 품는다. RB2는 리뷰 scratch에 patch가 없어 이 Fixer가 정의했다.

| # | 심은 결함 (파일) | 잡은 이름 (probe × 두 config 합) | 함께 오른 것 |
| --- | --- | --- | --- |
| RF | unison 공유 조건에서 점 수 비교를 뺌 (`layout.js`) | `eg.voice.merge_illegal` 4 | `eg.overlap.head_head`, `eg.voice.stem_over_head` |
| RI | 한 성부 beam 없는 위 stem의 가운데 줄 규칙을 뺌 (`layout.js`) | `eg.stem.middle_line` 8 | — |
| RY | 쉼표가 반 칸씩 움직임 (`notation.js` `REST.step` 0.5) | `eg.rest.position_err` 20 | — |
| RX | tuplet 괄호 갈고리가 음 반대쪽 (`notation.js` `TUPLET.hook` −0.75) | `eg.tuplet.hook_dir_err` 4 | — |
| RB | hook을 거꾸로 — 첫 음 왼쪽, 박 안 오른쪽 (`notation.js`) | `eg.beam.hook_side_err` 108 | — |
| RB2 | 박 규칙만 거꾸로 — 앞 음과 같은 박이면 오른쪽 (`notation.js`) | `eg.beam.hook_side_err` 56 | — |
| RK | 길이가 다른 쉼표도 병합 (`layout.js`) | `eg.voice.merge_illegal` 4 | `eg.rest.overlap` |
| F1 | R1 되돌림: flag 검사가 공유 머리를 건너뛰지 않음 | `eg.voice.unison_unshared` 2 | — |
| F2 | R1 되돌림: 옆 성부가 언제나 flag 뒤로 | `eg.voice.offset_err` 2 | — |
| F3 | 셋째 성부로 옮겨진 unison의 공유를 풀지 않음 | `eg.voice.merge_illegal` 8 | — |

기존 mutation은 모두 그대로 잡힌다 (M11b는 이제 `eg.voice.merge_illegal`도 올린다 — 새 ID 사본이 짝 없는 `merged`를 가짐). 실행 약 17 s (Linux 26 s), `npm run test:engrave` 안.

#### 34.18.5 Fixture와 layout hash 다시 bless (§21.3; G4-C16)

- **E12** (`make-e-fixtures.js`, 2마디를 더함): 점4분 D5 대 4분 D5 (점 다른 unison — §22.1; 공유 안 하고 머리 폭 + 0.2 sp), flag 8분 C5 unison (공유), flag 8분 E5/D5 2도 (1.38 sp), 8분 쉼표 병합, 4분 D5/B4. 8분은 옆에 쉼표나 긴 음이 있어 파생 beam이 묶지 않는다(flag). **E13** (2마디): 위 성부 4분 쉼표와 아래 성부 2분 쉼표가 동시에 (길이 다른 쉼표 — §22.1): 병합하지 않고, 위 쉼표는 위로 줄 단위, 2분 쉼표는 가운데 줄. `make-e-fixtures.js --check` PASS; `e-fixtures.test.js`가 두 경우가 있는지, `notation.test.js`가 그 그림을 확인한다.
- **분류**: `layout-diff.js --base=<f5517fe의 engrave/·scoregraph/>` (두 트리 모두 지금의 fixture로): 236쌍 중 **SAME 230, GEOMETRY_ONLY 6**, LEDGER_CHANGE·SERIALIZATION_ONLY 0.
- **바뀐 커밋 hash 8/236**:

| 곡 × config | 분류 | 이유 |
| --- | --- | --- |
| E12 × 2 | fixture 내용 + GEOMETRY_ONLY (새 fixture 위에서) | 새 2마디; R1 — flag unison 공유(h43 −2.31 sp), 2도 1.38 sp(h45 −0.93) |
| E13 × 2 | fixture 내용만 (새 fixture 위에서 SAME) | 새 2마디 — 코드 변화 없음 |
| what-child-is-this × 2 | GEOMETRY_ONLY | R1: unison 4쌍 공유 (옮겨졌던 머리 −2.31, −1.38, −2.32, −1.38 sp); 줄바꿈·객체 수 같음 |
| czerny849/007 × 2 | GEOMETRY_ONLY | R1: unison 1쌍 공유 (−2.32 sp); 줄바꿈·객체 수 같음 |

  L1은 그대로(r·e·x plan 수준 값 전부 같음), L2 영목표는 새 일곱까지 전부 0. **bless 이유**: R1(공유와 비킴의 양)과 §22.1이 요구한 fixture 경우. 나머지 코퍼스 변화(§34.18.2)는 커밋된 hash 밖이고 `layout.test.js`의 E + 코퍼스 L2 gate가 본다.

#### 34.18.6 기록 정정 (M6)

- **§34.15**: stem 방향이 바뀐 것을 더했다 — G4c `autoDir`의 같은 거리 규칙(다수, 그래도 같으면 아래)으로 beam 없는 화음 stem 46개가 위 → 아래 (9곡; golden/G07의 C3–E3 8개는 G07 변화의 전부, GEOMETRY_ONLY). 이 Fixer가 `1c92fc4`와 `f5517fe`의 layout을 비교해 다시 셌다.
- **§34.17.4**: 틀린 문장을 지우고 바로잡았다 — vendored VexFlow 4.2.3 `StaveNote.format`은 두 음의 stem이 반대이고 첫 성부(`noteU`)가 stem 아래이면 둘을 바꾼 뒤(`n=a[1], l=a[0]`) `noteL`을 `setXShift(h + 2)`하므로, 옮겨지는 음은 음높이와 상관없이 언제나 stem 아래 음이다 (vendored 파일 132,800–133,900번째 문자 부근을 읽음). §34.5의 1번 근거에도 같은 뜻의 한 줄을 붙였다.

#### 34.18.7 회귀 (코드 커밋 `270eddc`)

| 검사 | Windows (`D:/PPP-g4`, Node v24.17.0) | Linux (Docker `node:24-bookworm`, Node v24.21.0; `270eddc`의 `core.autocrlf=false` clone, LF 파일) |
| --- | --- | --- |
| `npm run test:engrave` | **149/149** (테스트 수 같음 — 단언·음성 대조·mutation 10·probe 3을 기존 테스트에 더함) | **149/149** (mutation 보고가 글자까지 같음) |
| `npm run test:scoregraph` | **205/205** | **205/205** — 첫 실행에서 `g3-idempotence.test.js`의 A5(녹음 그래프, 30.4 s) 하나가 한 번 실패했고, 다시 실행 셋(같은 순서 — `test:engrave` 뒤 `test:scoregraph` — 둘, 그 파일 단독 하나)에서 재현되지 않았다. `scoregraph/`는 이 Fixer가 바꾸지 않았다 (`git diff f5517fe -- scoregraph` 비어 있음) |
| `layout-hashes.js` | 118 × 2 전부 커밋된 hash (다시 bless 8) | 같음 |
| `make-metrics.js`·`make-outlines.js`·`make-e-fixtures.js`·`make-corpus.js --check` | PASS | PASS |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS | PASS / PASS / PASS |
| `browser-parity.js` (A28, 전체) | Chrome 153: layout 808/808, SVG 808/808 바이트 동일 (바뀐 layout 전부 포함), E14 `<use>` 18개 상자 오차 ≤ 0.01 sp, 네트워크 0 | — |
| legacy parity (`legacy-parity.js`; `1c92fc4`의 `git archive`를 8871에, 이 트리를 8872에, `NODE_ENV=production HOST=127.0.0.1`) | **16/16 바이트 동일** — 측정 뒤 두 서버를 껐다; 8777·8788은 건드리지 않음 | — |
| 음성 대조 | §34.18.3 (metric), §34.18.4 (mutation) | — |
| 앱 파일 | `Piano Coach App.dc.html`·`index.html`·`server.js` 바이트 그대로 (`git diff 1c92fc4` 비어 있음) | — |

#### 34.18.8 Lead가 맡긴 것 (손대지 않음)

- **M1** (보표 밖으로 옮겨진 쉼표에 덧줄이 없다 — §34.17.5)와 **M2** (tuplet 숫자가 beam에서 멀다 — §34.17.2): **G4d-1**.
- **M3** (G4d 객체가 생긴 뒤 B9를 다시 잼): **G4d-1**.
- **M4** (`plan/1`·`engr/1`을 올리지 않음): **G4d-1 / G4d-2의 캐시가 나가기 전**. 지금 올리지 않았다.
- **M5** (G4-C4가 §14.2·§14.3의 MUST 문장을 고쳐 읽음): Lead가 따로 승인한다. 이 Fixer는 §14.2·§14.3 본문을 고치지 않았다 (G4-C13의 비킴 양은 DECISIONS와 이 절에만).

#### 34.18.9 커밋

`270eddc` (코드·테스트: `engrave/layout.js`, `tests/engrave/l2.js`, `layout-mutation.test.js`, `notation.test.js`, `layout.test.js`, `e-fixtures.test.js`, `tools/bench.js`, `tools/make-e-fixtures.js`, E12·E13, baseline r·e·x와 layout hash), 이어서 이 기록 (G04 §34.5·§34.15·§34.17·§34.18, DECISIONS G4-C13–C16). `origin/g4c-notation-core`에 push. 병합 안 함, PR 없음. CURRENT_STATE는 고치지 않았다 (Lead 몫).

**Fixer 상태: R1 FIXED, R2 FIXED, M6 정정; M1–M5는 Lead가 맡긴 곳 → G4c FIX: READY_FOR_RECHECK.**


### 34.19 리뷰 판정·재확인·병합 (Lead, 2026-09-25)

**독립 리뷰** (`f5517fe`, read-only. 리뷰어 자신의 clone에서, Windows와 Linux Docker 둘 다)

- 판정: **NEEDS_FIX — BLOCKER 0, MAJOR 2, MINOR 6.**
- 확인된 것:
  - gate를 느슨하게 하지 않았다. 음성 대조: `placeRests`를 끄면 `eg.rest.overlap = 68`, exit 1.
  - 다시 bless한 146/68/20/2를 재현했고, 표본마다 G4c의 변경으로 설명된다.
  - G4-B11이 VexFlow 4.2.3 `StaveNote.format`과 같다.
  - `svg.js`는 결정론적이고, DOM을 재지 않으며, §16.4 계약을 지킨다.
  - Chrome 236/236.
  - `outlines.js --check`는 숫자 하나만 바꿔도 exit 1.
  - 앱·`scoregraph/` diff 없음.
- MAJOR:
  - R1: flag 있는 unison을 공유하지 않고 flag 너머로 민다 (21곡 34쌍).
  - R2: `merged`를 검사 없이 믿는다. 또 G4c 규칙 여럿이 layout hash로만 지켜진다 (RF·RI·RY·RX·RB).
- MINOR:
  - M6은 Fixer가 고쳤다.
  - M5는 Lead가 G4-L2로 승인했다.
  - M1–M4는 G4d-1a·G4d-1b로 넘긴다 (아래).

**Fixer** (§34.18): R1·R2 FIXED, M6 정정. `engrave/`에서는 `layout.js`만 바뀌었다. layout hash는 236쌍 중 8쌍만 다시 bless했다 (`f5517fe` 대비 SAME 230, GEOMETRY_ONLY 6).

**Lead 재확인** (고친 항목만, `85da49f`의 새 clone)

- `test:engrave` 149/149, `test:scoregraph` 205/205, layout hash 118 × 2, bench r·e·x 모두 PASS.
- 음성 대조: `f5517fe`의 `layout.js`를 넣으면 bench r·e가 실패한다.
- Lead가 따로 심은 mutation:
  - 머리 glyph 조건 제거 → bench r·e REGRESSION;
  - 점 조건 제거 → bench r·e REGRESSION;
  - flag를 늘 비킴 거리에 넣음 → bench e REGRESSION;
  - 쓸모없어진 공유를 푸는 코드 제거 → `test:engrave` 실패 (A17–A19, mutation test);
  - 변화표(alter) 조건 제거 → 커밋된 입력 중 바뀌는 것이 없다. fixture의 빈틈이다: E12에 증1도 unison을 G4d-1a에서 넣는다.
- angels-we-have-heard m20: flag 있는 8분음표 unison이 음표머리 하나를 공유한다 (그림으로 확인).

**main과 합치기**

- MX-1(PR #13)과 그 마감을 합친 병합 커밋 `997840c`. CURRENT_STATE 충돌은 main 쪽으로 풀었다.
- 합친 트리에서 모두 PASS:
  - `test:engrave` 149/149, `test:scoregraph` 214/214;
  - layout hash, bench r·e·x;
  - make-metrics·outlines·e-fixtures·corpus `--check`.
- 앱 파일과 `scoregraph/`는 main과 같다.

**병합**: PR #15, CI gate 초록, squash `e3c8c5a`. **G4c CLOSED — 다시 열지 않는다.**

**Lead 결정**

- G4-L2: G4-C4를 승인한다. unison 공유는 EngravedScore의 `merged`로 적고, plan ledger는 `drawn`으로 둔다. 단, R2의 합법 병합 검사가 있을 때만 성립한다.
- G4-L3: G4d-1을 두 병합 지점(G4d-1a·G4d-1b)으로 나눈다.

**넘기는 것**

- G4d-1a:
  - 보표 밖으로 옮겨진 쉼표의 덧줄 (M1);
  - tuplet 숫자 위치 (M2);
  - `plan/1`·`engr/1`을 올리고, "출력이 바뀌면 버전을 올린다"를 규칙으로 둔다 (M4);
  - E12의 증1도 unison.
- G4d-1b: B9 다시 재기 (M3).
- G4d-2: `.vf-notehead path` 선택자.
- 관찰: Linux에서 `g3-idempotence` A5가 한 번 실패했다. 세 번 다시 돌려 통과했고, `scoregraph/`는 바뀌지 않았다.

## 35. G4d-1a 구현 기록 — 곡선, 음에 붙는 기호, 배치 함수, 글자 metric

Implementer, 2026-09-25. 브랜치 `g4d1a-curves-marks` (`D:/PPP-g4`), 시작 `d4b5b86` (= `origin/main`, G4c 마감 뒤). 입력은 Lead의 G4d-1a 지시(roadmap §14 카드, §5.1 G4d 행, G4-L3)다. 병합하지 않았고 PR도 없다 (Lead가 리뷰와 PR을 정한다). 결정은 DECISIONS G4-D1a-1–13; 독립 리뷰(NEEDS_FIX, MAJOR 3)와 그 Fixer는 §35.18, G4-D1a-14–23.

**한 줄**: EngravedScore가 음에 붙는 것을 그린다 — 그래프의 모든 tie(부분 화음, 세로줄, system 넘김의 반쪽 둘, 성부 바뀜, 추론한 마디 안 tie), 그래프 짝 그대로의 slur, glissando, articulation·꾸밈 기호·fermata(음·쉼표·세로줄)·tremolo, 인쇄 운지, arpeggio, notehead 모양과 괄호, 주의·괄호 임시표 — 모두 **하나의 배치 함수**(`skyline.js` `put()`)로 §10.2 순서 3–7에 따라 놓는다. 글자 폭은 새 `engrave/metrics-text.js` 표에서만 읽는다. G4c 리뷰가 넘긴 음 수준 일 넷(보표 밖 쉼표의 덧줄, beam 옆 tuplet 숫자, `plan/2`·`engr/2`와 그 규칙, E12의 증1도 unison)도 닫았다. **사용자에게 보이는 변화는 없다**: 앱 파일·`index.html`·`server.js`·`scoregraph/`는 바이트 그대로이고 앱은 새 모듈을 불러오지 않는다 (legacy parity 16/16).

### 35.1 범위 — §27 G4d와 G4-L3

§27 G4d 가운데 G4-L3이 G4d-1a에 둔 것: §13 곡선(`curves.js`), `place()`(§10.1), §10.2 순서 3–7(tie, tuplet, articulation·꾸밈 기호·fermata·tremolo, slur·glissando, 운지 — arpeggio·notehead 모양·주의 임시표 포함), §18.3 글자 metric 표와 `--check`, 그리고 G4c 리뷰의 음 수준 이월(§34.19 "넘기는 것"). Node만이다. 하지 않은 것: system에 붙는 기호(셈여림·hairpin·pedal·ottava·volta·코드명·tempo·rehearsal·jump·words·가사), §15.3 세로 배치의 다시 짜기, §15.4 courtesy, 안내 글자 — G4d-1b; 앱 통합 — G4d-2; 인쇄 — G4e. VexFlow 버전·G3 flag·schema는 그대로다.

### 35.2 모듈

| 파일 | 한 일 |
| --- | --- |
| `engrave/curves.js` (새) | 3차 Bézier 곡선 — 제어점이 현의 1/3·2/3에서 세로로만 올라가 x가 t에 선형, 가운데 높이 h = 곡선의 현에서 4h·t(1−t). `tieHeight`(0.15·길이 + 0.2를 0.5–1.2 sp로 자름), `slurHeight`(clamp(0.1·길이, 0.75, 3)), `arc`, `line`, `yAt`, `samples`(0.5 sp마다 상자, §10.1), `slur`(아래 §35.4) |
| `engrave/marks.js` (새) | system 하나의 배치 pass `placeSystem`: staff마다 skyline(음 요소, 보표선 제외 — 보표 밖이어야 하는 것은 `limit`), 그 위에 §10.2 순서대로 tie → tuplet → articulation·꾸밈 기호·fermata·tremolo → slur(짧은 것 먼저)·glissando → 운지. 모든 곡선·기호는 놓인 뒤 skyline에 더해진다 |
| `engrave/metrics-text.js` (새, 생성) | 글자 폭 표 (§35.6) |
| `engrave/skyline.js` | `put({x0, x1, h, side, pad, limit, floor, snap})` — §10.1의 배치 함수 하나 (옛 `place(x0, x1, h, side, pad, limit)`은 이것을 부른다: volta); `profile()` (slur가 넘을 칸들); 충돌 검사에 H5(글자 대 음표머리·stem·beam·임시표) |
| `engrave/layout.js` | `prepare`: arpeggio(화음과 임시표 왼쪽, staff마다 한 조각, 가리키는 끝에 화살표; non이면 괄호), notehead 괄호, 괄호(`[ ]`) 임시표, 숨표·caesura(음 뒤), 운지 폭을 기둥의 rod에(§9), 타악기(kit의 notehead·stem, 기본 stem 위), marks pass의 입력(`P.marks`); `notateSystem`: 쉼표를 옮긴 뒤 보표 밖 온·2분·겹온쉼표의 덧줄, tuplet은 marks pass로 옮김; `layout`: marks pass 호출, 곡선의 작은 보표 축소·세로 쌓기·출력, 세로 skyline에 곡선 표본; `VERSION` `engr/2`; `coverage.pending`에서 G4d-1a가 놓는 종류를 뺌 |
| `engrave/notation.js` | `placeTuplet`이 `put()`으로 놓는다: 괄호는 보표 밖, 괄호 없는 숫자는 beam 옆 — 보표 안이라도 빈 곳이면 (G4c 리뷰 M2) |
| `engrave/metrics.js`·`outlines.js` (생성) | glyph 23개 추가 (articulation 위·아래, fermata 셋 × 위·아래, 꾸밈 기호 넷, `tremolo1`, 숨표, caesura) — `make-metrics`·`make-outlines --check` 그대로; `articulation()`·`fermata()` 조회; `DRAWN`에 `accidentalBracketLeft/Right` (고정 글꼴에 없음, 백엔드가 그림) |
| `engrave/plan.js` | `PLAN_VERSION` `plan/2`; 타악기 head에 `kit: {notehead, stem}` (§14.6) |
| `engrave/svg.js` | tie `path.vf-stavetie.ppp-tie[data-tie]`(§16.4), slur `path.vf-curve.ppp-slur[data-slur]`(점선·파선은 stroke), glissando `path.ppp-gliss[data-gliss]`(물결은 2차 곡선), 음 그룹 안의 articulation·꾸밈 기호·fermata·tremolo·arpeggio(`.vf-stroke`)·머리 괄호·운지(`text.ppp-fingering`, 페이지 글꼴 family), 세로줄 fermata |
| `engrave/index.js` | `version` `0.4.0-g4d1a`; 브라우저 로드 순서 `metrics, metrics-text, space, breaks, skyline, canon, notation, curves, marks, layout, practice, outlines, svg`, 그 뒤 `index.js` |

도구: `tests/engrave/tools/make-text-metrics.js`(새, `--check`·`--fetch`), `render-png.js`(새, 로컬 PNG — 아래 §35.12), `layout-hashes.js`(버전 규칙 guard, G4-D1a-1), `layout-diff.js`(곡선과 버전 이름을 분류), `bench.js`·`browser-parity.js`(새 모듈). A29: `curves.js`·`marks.js`·`metrics-text.js`는 PURE 층 (테스트가 확인).

### 35.3 Tie (§13.1, G4-D5, G4-U2 A; G4-D1a-5)

- **모든 plan tie**를 그 head가 그려진 곳에 그린다: 두 head가 한 system이면 `whole` 하나, 다르면 앞 system 끝까지 `start` + 다음 system 첫 기둥 1 sp 앞부터 `end`, 한쪽 head만 있으면(열린 tie, 가까이 보기 창 밖) 그쪽 반쪽 하나(2 sp stub 또는 system 끝까지). 추론 tie(녹음 경로, `inferred`)도 마디 안이든 밖이든 그린다 (G4-U2 A). 성부가 바뀌는 tie는 from head → to head를 바로 잇는다 (sonatina/024).
- **방향**: 여러 성부면 위 성부 위·아래 성부 아래; 음 하나면 stem 반대; 화음이면 §13.1 그대로 가운데 줄 위의 머리는 위, 아래는 아래, 가운데 줄은 stem 반대.
- **끝점**: 그 쪽의 가장 바깥 머리이고 stem 쪽이 아니며(시작은) 점이 없으면 머리 가운데에서 0.2 sp, 머리 가장자리에서 0.15 sp 바깥; 아니면 그 높이(끝 y ± 0.25)에 그 event가 그린 것(머리·점·stem·flag, 끝에서는 임시표) 너머 0.15 sp, 머리 가운데에서 0.25 sp 비킨 높이. 높이 0.5–1.2 sp.
- 두께 0.16 sp(가운데), 끝은 뾰족 — 백엔드가 가운데선의 제어점을 ±2t/3 옮긴 두 곡선으로 채운다.

### 35.4 Slur (§13.2; G4-D1a-6)

- **그래프 짝 그대로** — `from`·`to` event. 방향: `placement` → 성부 역할 → 걸친 성부 음의 stem이 모두 위면 아래, 아니면 위.
- **끝점**: stem 반대쪽(머리 쪽)이면 머리 가운데 x에서, 머리 위에 선 것(가장자리 0.2 sp 제외 — 이웃의 stem·beam이 스치는 것은 아님: 다른 성부, 앞서 놓은 tie·slur·기호)의 바깥 0.25 sp; stem 쪽이면 stem 끝 너머(stem ± 0.2 sp의 beam·flag 바깥) — §13.2의 "머리에서 stem 길이의 2/3"은 쓰지 않았다(flag·beam과 부딪힘; §35.10). 그 음 자신의 기호(articulation 등)는 x와 상관없이 바깥으로 — slur는 articulation 바깥(§10.2 순서 6).
- **모양**: 두 제어점을 따로 올린다 — 칸마다 A·k1 + B·k2 ≥ 필요량(A = 3(1−t)²t, B = 3(1−t)t²)이고 k1 + k2가 가장 작은 쌍 중 가장 고른 것(반으로 나눠 찾음; 둘 다 기본 높이 이상, 최대 3 sp 호 이하, 서로 0.35배 이상). 안 되면 두 끝을 0.5 sp씩 바깥으로(최대 6번), 그래도 안 되면 그대로 그리고 `SLUR_COLLIDES`. 끝점 0.5 sp 안의 칸은 끝 음 자신의 것으로 본다.
- **순서**: 짧은 것 먼저(같으면 그래프 순서) — 안쪽 slur가 먼저 놓이고 바깥 phrase slur가 그것을 넘는다.
- **system 넘김**: 반쪽 둘(앞은 끝 세로줄 1 sp 전까지, 뒤는 첫 기둥 1 sp 앞부터), 가운데 system은 `mid` 한 조각(그 system의 음 위로 평평). 반쪽의 자유 끝은 붙은 끝의 높이, 또는 자유 끝 앞 4 sp의 음 바깥. `line: dashed/dotted`은 선 모양으로.
- 코퍼스(E + 347 + 전사 17, 404곡): slur 2,832개, 안쪽 머리·stem을 지나는 것 데스크톱 6 (0.21 %), 휴대폰 3 (0.11 %) — 모두 `SLUR_COLLIDES`로 이름이 있다 (A22 ≤ 1 %).

### 35.5 음에 붙는 기호 (§10.2 순서 5, 7; G4-D1a-4, 7, 8, 9)

- **articulation·꾸밈 기호·fermata·tremolo**: 한 성부면 stem 반대쪽, 여러 성부면 성부 쪽; stem 쪽에 서면 stem 가운데에 맞춰 stem 끝(beam) 너머. 꾸밈 기호는 위(아래 성부는 아래), fermata는 위(뒤집힌 것·아래 성부는 아래). 안에서 바깥으로 staccato·staccatissimo(0) < tenuto(1) < accent(2) < marcato(3) < 꾸밈 기호(4) < fermata(5). staccato·tenuto류는 보표 안이면 칸 가운데로(`spaceSnap`, 선 위 금지), 나머지는 보표 밖(`limit`). detached-legato는 staccato 위 tenuto 두 glyph. 고정 글꼴에 없는 spiccato·stress·unstress는 가장 가까운 glyph + `GLYPH_FALLBACK`(코퍼스 0). 숨표·caesura는 음 뒤, 보표 위(가로 간격에 들어감). 세로줄 fermata는 맨 위 staff 위(뒤집힌 것은 맨 아래 staff 아래), 세로줄 가운데. tremolo는 stem 위 머리와 끝 사이에 0.8 sp 간격의 획, stem이 없으면 머리 위.
- **운지**: 그래프 `placement`, 없으면 part의 첫 staff는 위·둘째 staff는 아래. 화음은 머리 순서대로 쌓아 위 숫자가 위 음(위든 아래든), 안쪽부터(위: 낮은 음의 것부터) 놓는다; 여러 줄 운지(`"1\n3"`)는 줄마다. Figtree 1.4 sp, 폭은 표에서. 보표 밖, 음과 0.3 sp, 줄 사이 0.15 sp. 머리보다 넓은 운지는 기둥의 rod를 넓힌다. §10.2 순서대로 slur 뒤에 놓이므로 긴 phrase slur가 있으면 그 바깥에 선다 (M-H1에서 볼 것, §35.13).
- **arpeggio**(§6): 화음과 그 임시표 왼쪽 0.25 sp, 끝 머리 너머 0.25 sp; 물결선(`dir`이면 가리키는 끝에 화살표), `non`이면 괄호. 두 staff에 걸치면 staff마다 한 조각, 화살표는 가리키는 쪽 끝 조각에만.
- **notehead**: 그래프의 shape(없으면 타악기 kit의 것), 괄호(`paren`)면 좌우 괄호 glyph. **임시표**: `bracket`이면 `[ ]`(그려진 모양), `paren`이면 `( )`; `cautionary`만이면 그대로 — G4c는 `cautionary + bracket`을 괄호로 그렸다.
- **타악기** (A12, §14.6): percussion staff의 음은 그래프·kit가 말하지 않으면 stem 위, 머리는 kit의 notehead (E27의 둘째 snare는 `<notehead>` 없이 kit의 x) — plan head의 `kit`.

### 35.6 글자 metric 표 (§18.3; G4-D1a-2)

- `tests/engrave/tools/make-text-metrics.js`가 앱이 Google Fonts에서 받는 세 family의 정적 TTF 다섯(Instrument Serif 보통·기울임 = `serif`·`serif-italic`, Figtree 400·700 = `sans`·`sans-bold`, JetBrains Mono 400 = `mono`)을 **버전이 박힌 gstatic URL과 sha256으로 고정**해 `tests/engrave/out/fonts/`(gitignore)에 받고, 작은 TrueType reader(head·hhea·hmtx·cmap 4/12·OS/2)로 문자 집합(Latin-1, 대시·따옴표·말줄임, ♭♮♯)의 advance width를 1/1000 em 정수로, capHeight·xHeight·ascender·descender와 함께 `engrave/metrics-text.js`에 쓴다. **글꼴 파일은 커밋하지 않는다** (테스트가 `git ls-files`에 ttf/otf/woff가 없음을 확인). 표 머리에 출처·sha256, 끝에 표 digest.
- `--check`: 글꼴이 있으면(캐시 또는 `--fetch`) 다시 만들어 바이트 비교; 없으면 표의 형식(도구가 쓰는 모양)과 digest만 보고 "rebuild skipped"라고 말한다. CI는 `--check --fetch` (Windows·Linux 모두 rebuild까지 PASS).
- `measure(text, role, size)` → {w, top, bottom, missing}: 폭은 advance의 합 × size, 없는 글자는 0.6 em + `missing` → layout이 `TEXT_GLYPH_MISSING`. kerning 없음. layout(운지, glissando 말)은 폭을 이 표에서만 읽고, `svg.js`는 같은 face의 CSS family를 쓴다 — 글꼴이 늦게 와도 기하는 같다. DOM 측정 없음 (A29).

### 35.7 G4c 리뷰의 이월 (§34.19)

| # | 한 일 | 증거 |
| --- | --- | --- |
| M1 보표 밖 쉼표의 덧줄 | 쉼표를 옮긴 뒤, 줄이 보표 밖인 온쉼표(매달린 줄)·2분쉼표(앉은 줄)·겹온쉼표(두 줄)에 그 줄 하나를 쉼표 폭 + 양쪽 0.2 sp로; 병합 쉼표는 한 번 | `origin/main` 코드로는 E + 코퍼스에서 덧줄 없는 쉼표 16(코퍼스 15 = 4곡: for-all-the-saints 7, it-is-well 4, the-strife-is-oer 3, burgmuller25/019 1 — 리뷰의 15와 같음, + 새 E13 1) → 0 (`eg.rest.ledger_missing`); E13에 2분쉼표가 보표 밖으로 가는 마디; mutation MR |
| M2 tuplet 숫자 | 괄호 없는 숫자는 `put()`의 `limit: null` — beam 바깥 0.5 sp, 보표 안이라도 빈 곳 (괄호는 여전히 보표 밖) | `origin/main` 코드로 1.5 sp보다 먼 숫자 16 (czerny849/017 2, 019 2, 020 12 — 리뷰의 16과 같음) → 0 (`eg.tuplet.number_far`); 괄호 없는 숫자 219 중 13이 이제 보표 안; mutation MN |
| M4 버전 | `plan/1` → `plan/2`, `engr/1` → `engr/2`, 규칙 "출력이 바뀌면 버전을 올린다" (G4-D1a-1). `layout-hashes.js --write`는 merge base(origin/main)의 hash와 다른데 버전이 같으면 쓰지 않는다 | 음성 대조: `VERSION`을 `engr/1`로 되돌리고 `--write` → "236 hashes differ … under the same version engr/1", exit 1 |
| E12 증1도 unison | E12에 3마디: 위 성부 F5(임시표 없음) 대 아래 성부 F♯5 — 공유하지 않고 아래 성부가 비킴 | Lead의 mutation을 RA로 커밋: unison 규칙에서 alter 조건을 빼면 E12에서 `eg.voice.merge_illegal` 4 |

### 35.8 Metric (`tests/engrave/l2.js`; G4-D1a-11)

`skyline.js`·`curves.js`·`marks.js`를 불러오지 않는 자기 기하(Bézier를 0.5 sp마다 표본, 곡선이 상자를 지나는지는 0.05 sp마다 곡선 위의 점으로)로 계산한다. 글자 폭만은 §18.3의 표(데이터)를 읽는다. 모두 `bench.js` ZERO와 `layout.test.js` ZERO_L2 (E + 코퍼스 404곡 × 두 config가 0이어야 통과); baseline r·e·x는 **키만 더했다** (`bench.js baseline` 뒤 git diff에 지운 줄 0).

| metric | 뜻 | §21 이름 |
| --- | --- | --- |
| `eg.tie.missing` | tie마다 head가 그려진 대로의 조각(한 system `whole`, 넘으면 `start`+`end`, 한쪽만이면 그 반쪽) | `eg.tie.drawn_ratio` (layout) |
| `eg.tie.endpoint_err`, `eg.curve.endpoint_err_max` (≤ 0.5) | 그려진 tie 끝과 머리(시작은 그 줄의 점까지)의 거리; 머리가 stem 너머로 비킨 2도이거나 화음의 임시표가 tie 높이를 덮으면 그 화음 앞면까지 (G4-D1a-5) | A22 |
| `eg.tie.dir_err` | 곡선이 휘는 쪽 ≠ §13.1 규칙 | §13.1 |
| `eg.slur.pair_errors` | 첫 조각이 from 음(± 0.6 sp)에서, 끝 조각이 to 음에서 시작·끝나지 않음 | `eg.slur.pair_exact` (layout) |
| `eg.slur.endpoint_err` | 끝점이 바로 아래 선 것(± 0.1 sp: 머리·stem 끝·다른 성부·beam·tie·짧은 slur, 그리고 그 음의 기호는 어디서든)의 0.1–1.25 sp 바깥이 아님 (끝을 옮긴 만큼 더 허용) | §13.2 |
| `eg.curve.hits`(기록), `eg.curve.hit_ratio` (≤ 0.01, suite 합), `eg.curve.hits_undiagnosed` | slur가 끝 음 밖의 머리·stem을 지남; suite의 slur 수에 대한 비율; `SLUR_COLLIDES`가 없는 것 | `eg.curve.hits` (A22) |
| `eg.gliss.errors` | 첫 머리 오른쪽에서 둘째 머리 왼쪽까지가 아님, 물결 여부 | §13.4 |
| `eg.ledger.drawn_missing`, `eg.mark.missing.<kind>` | ledger가 drawn인 tie·slur·articulation·꾸밈 기호·fermata·운지·glissando·arpeggio 가운데 그 음이 그려졌는데 그 ref를 이름 대는 객체·곡선이 없음 | `eg.ledger.drawn_missing`, `eg.mark.drawn_ratio.*` |
| `eg.mark.side_err`, `eg.mark.order_err`, `eg.mark.on_line` | 쪽 규칙(+ stem 쪽이면 stem 끝 너머), 안→밖 순서, staccato·tenuto가 보표 안에서 선 위 | §10.2 순서 5 |
| `eg.fingering.side_err`, `eg.fingering.order_err` | 운지 쪽 규칙, 화음 쌓기 순서 | §10.2 순서 7 |
| `eg.arpeggio.errors` | 머리 왼쪽·머리를 덮음·화살표 끝·non | §6 |
| `eg.notehead.shape_err`, `eg.accidental.enclosure_err` | 머리 glyph = shape(kit)·채움, 괄호 있음/없음; 임시표의 `[ ]`·`( )` | A7, A12 |
| `eg.rest.ledger_missing`, `eg.tuplet.number_far` | §35.7 M1, M2 | — |
| `eg.overlap.text`, `eg.overlap.text_text`, `eg.overlap.mark_mark`, `eg.overlap.mark_note` | 글자 대 음 요소·곡선·기호, 글자끼리, 기호끼리(숫자와 제 괄호 제외), 기호 대 음 요소·곡선(tremolo와 제 stem·beam 제외) | A20 (1a의 객체) |
| `eg.text.width_err`, `eg.text.missing_glyph`, `eg.clip.curves` | 글자 폭 = 표, `TEXT_GLYPH_MISSING` 수, 곡선이 페이지 안 | §18.3, A17 |

`bench.js`: `eg.tie.drawn_ratio`·`eg.slur.pair_exact`·`eg.mark.drawn_ratio.{articulation, ornament, fermata, fingering, gliss, arpeggio}`는 이제 **layout까지** 본다 — plan이 싣고, 두 config의 layout이 그린 것만 (l2의 `missing` 집합). `eg.curve.hits`는 LOWER(늘면 퇴행), `eg.curve.hit_ratio`는 suite 합의 비율로 요약한다. 결과(r): `eg.curve.hit_ratio` 0.0016, `endpoint_err_max` 0.15, 영목표 전부 0.

### 35.9 Mutation (`tests/engrave/layout-mutation.test.js`)

G4b·G4c의 틀(CRLF 사본, anchor 정확히 한 번, 출력이 바뀌어야 함, 이름 붙은 metric이 잡아야 하고 그 metric은 같은 probe에서 원래 0)에 **probe 지정**을 더했다: `probes`를 적은 mutation은 그 probe에서만 돌고(기준도 같은 probe), 긴 czerny849/020은 그것을 적은 mutation만 쓴다. 새 probe: E09, E10, E15, E23, E27, E31, E32, E40, golden/G16, czerny849/020. M4·M24의 anchor는 tuplet 배치가 옮겨 간 `marks.js`로. 실행 약 30 s (`npm run test:engrave` 안), Linux도 통과.

| # | 심은 결함 (파일) | 잡은 이름 (probe × 두 config 합) |
| --- | --- | --- |
| M8 | `put()`이 skyline을 안 봄 — 기호가 혼자일 때의 자리 (`skyline.js`) | `eg.overlap.mark_mark` 6, `eg.overlap.text` 167 |
| M12 | 추론한 마디 안 tie를 다시 숨김 (O4) | `eg.tie.missing` 6 (G16) |
| M14 | system을 넘는 tie를 버림 | `eg.tie.missing` 3 (E09) |
| M15 | slur를 start → 같은 staff의 다음 stop으로 다시 짝지음 | `eg.slur.pair_errors` 2 (E10) |
| M23 | staccato를 ledger 없이 건너뜀 | `eg.ledger.drawn_missing` 344, `eg.mark.missing.articulation` 344 |
| RA | (Lead) unison 규칙에서 alter 조건을 뺌 (`layout.js`) | `eg.voice.merge_illegal` 4 (E12) |
| MT | 음 하나의 tie가 stem 쪽 | `eg.tie.dir_err` 17 |
| MS | slur 끝이 음 안쪽 (pad 부호) | `eg.slur.endpoint_err` 10 |
| MC | slur가 아래 음을 넘지 않음 (`curves.js`) | `eg.curve.hits_undiagnosed` 1 |
| MA | 기호를 밖→안 순서로 쌓음 | `eg.mark.order_err` 4 |
| MO | 한 성부의 articulation을 stem 쪽에 | `eg.mark.side_err` 16 |
| MI | 보표 안 staccato·tenuto를 칸으로 옮기지 않음 | `eg.mark.on_line` 8 |
| MF | 위 staff 운지는 아래, 아래 staff는 위 | `eg.fingering.side_err` 140 |
| MW | 운지 폭이 표와 다름 | `eg.text.width_err` 14 |
| MN | 괄호 없는 tuplet 숫자를 보표 밖에 (`notation.js`) | `eg.tuplet.number_far` 24 (czerny849/020) |
| MR | 보표 밖 쉼표의 덧줄을 안 그림 | `eg.rest.ledger_missing` 2 (E13) |
| MP | 타악기 stem을 음높이 규칙으로 | `eg.voice.stem_policy_violations` 4 (E27) |
| MK | 타악기 kit의 notehead를 무시 | `eg.notehead.shape_err` 2 |
| MH | 머리 괄호를 안 그림 | `eg.notehead.shape_err` 2 (E31) |
| MB | 괄호 임시표를 `( )`로 | `eg.accidental.enclosure_err` 2 (E32) |
| MG | 물결 glissando를 직선으로 | `eg.gliss.errors` 2 (E40) |
| MQ | arpeggio 화살표를 반대 끝에 | `eg.arpeggio.errors` 4 (E40) |

G4b·G4c의 mutation 29개(M1–M7(M7a·b), M9–M11(M11a·b), M16–M18(M18a–c), M21, M24, RB, RB2, RF, RI, RK, RX, RY, F1–F3)는 그대로 잡힌다; N1·N2는 바이트 동일. **M23과 §23의 이름**: §23은 M23을 `eg.ledger.silent`로 적었다 — 그것은 plan이 ledger 없이 빠뜨리는 경우이고 `ledger-mutation.test.js`의 L-ART-LEDGER가 그대로 잡는다. layout이 ledger는 drawn인데 그리지 않고 건너뛰는 경우는 §21.1이 이름 붙인 `eg.ledger.drawn_missing`이 잡는다 (G4-D1a-13).

### 35.10 설계 문서와 달라진 곳

1. **§13.2 stem 쪽 slur 끝점**: "머리에서 stem 길이의 2/3" 대신 stem 끝(flag·beam) 너머 0.25 sp — 2/3 지점에서 시작하면 flag·beam과 부딪혔다 (G4-D1a-6).
2. **§13.2 slur 모양**: 두 제어점을 같이 올리지 않고 따로 — 한쪽 끝 가까이의 높은 음을 넘을 때 끝을 덜 옮긴다. 반쪽의 자유 끝도 끝 앞 음의 높이를 따른다. 처음의 대칭 포물선·평평한 반쪽으로는 `SLUR_COLLIDES`가 E + 코퍼스 두 config에서 72, 지금 15.
3. **G4-C6의 "tuplet은 언제나 보표 밖"**: 괄호 없는 숫자는 beam 옆, 보표 안이라도 (Lead가 G4d-1a에 준 M2).
4. **A22의 tie 끝점**: 2도로 stem 너머에 비킨 머리, 또는 화음의 임시표가 tie 높이를 덮는 머리는 그 앞면까지 잰다 — tie는 stem·다른 머리·임시표를 넘을 수 없다 (코퍼스 7쌍, G4-D1a-5). 기준 0.5 sp는 그대로. — **G4-L4로 대체됨** (§13.1, §35.18.2): 앞면 허용은 없어지고 "화음의 다른 머리보다 제 머리에 더 가까움"을 잰다.
5. **A22의 slur 1 %**: suite(bench) 합의 비율로 판정하고 곡마다의 비율은 기록만 — slur가 몇 개 안 되는 곡에서 하나가 넘으면 곡 비율은 1 %를 넘는다 (G4-D1a-11).
6. **§18.3 운지의 글꼴 역할**: §18.3은 셋(serif, sans, mono)을 적고 운지를 어디에도 두지 않았다 — sans(Figtree)로 (G4-D1a-2).
7. **§10.2 순서 7 운지**: 순서 그대로 slur 바깥이다 — 긴 phrase slur 아래의 운지가 음에서 멀어진다 (예: czerny849/013·020). Gould는 운지를 slur 안쪽에 두기도 한다. 바꾸지 않았고 M-H1에서 본다. — **G4-L5로 대체됨** (§10.2 순서 6, §35.18.3): 운지는 slur보다 먼저, 음 곁에 놓인다.

### 35.11 Acceptance

| # | 기준 | 증거 | 판정 |
| --- | --- | --- | --- |
| A5 | 모든 tie: 부분 화음, 세로줄·system 넘김 반쪽 둘, 성부 바뀜, 추론 마디 안 tie (U2 A) | `eg.tie.missing` 0 (E + 코퍼스 404 × 2, r·e·x), bench `eg.tie.drawn_ratio` 1 (layout 기준); E08(E만), E09(두 폭에서 반쪽 둘), sonatina/024(성부 바뀜), golden/G16(추론 3); M12, M14 | PASS |
| A6 | 모든 slur가 제 from·to 사이: 겹친 slur, 쉼표에 걸린 slur, system 넘김 반쪽 | `eg.slur.pair_errors` 0, `eg.slur.pair_exact` 1; E10(겹침), E11(쉼표, source break로 반쪽 둘), 파선; M15 | PASS |
| A7 | articulation, 꾸밈 기호, fermata(음·세로줄), 인쇄 운지, arpeggio(dir·non), 꾸밈음, glissando, notehead 모양, 주의·괄호 임시표 | `eg.mark.missing.*`·`eg.ledger.drawn_missing`·side/order/on_line·fingering·arpeggio·gliss·shape·enclosure 전부 0, `eg.mark.drawn_ratio.*` 1; E15(+ 3마디: trill·mordent·turn·detached-legato·tremolo·숨표·세로줄 fermata), E23, E31, E32, E40, E14(G4c); 코퍼스 articulation 6,454·운지 9,965·꾸밈 기호 50·fermata 36·arpeggio 13 객체; M23, MA, MO, MI, MF, MG, MQ, MH, MB | PASS |
| A12 (타악기) | 타악기 event가 타악기 staff에 머리 모양대로 | E27: snare 둘 다 x(하나는 kit에서), bass drum 보통, stem 위, 쉼표 아님; `eg.notehead.shape_err`·`stem_policy` 0; MP, MK | PASS (가사는 G4d-1b) |
| A20 (1a의 객체) | 글자 대 음 요소·글자, 기호끼리 | `eg.overlap.text`·`text_text`·`mark_mark`·`mark_note` 0; `skyline.collisions` H5 → `HARD_VIOLATION` 0; M8 | PASS (셈여림 등은 1b) |
| A22 | tie 끝점 ≤ 0.5 sp, slur가 안쪽 음을 지나는 비율 ≤ 1 % (전부 진단에) | `endpoint_err_max` 0.15; 지나는 slur 데스크톱 6/2,832 (0.21 %), 휴대폰 3/2,832 (0.11 %), r suite 0.16 %, `hits_undiagnosed` 0; MT, MS, MC | PASS |
| E08–E11, E15, E23, E27, E31–E33, E40, E12 새 경우 | fixture | `marks.test.js`(규칙별 테스트, 두 폭에서 영목표 0, HARD_VIOLATION·SLUR_COLLIDES 없음), `e-fixtures.test.js` | PASS |
| R·X L1/L2 | 영목표 0 | `bench.js check` r·e·x PASS (Windows, Linux) | PASS |
| A2–A4, A11, A14, A17–A19, A21, A23, A24, A26 | G4b·G4c | ZERO_L2 전부 0 (E + 코퍼스 404 × 2), 기울기 최대 0.25 | PASS |
| A27 | Windows = Linux, 3회·역순 | layout hash 118 × 2 다시 bless (§35.14), Docker `node:24-bookworm`(LF clone)에서 같음 | PASS |
| A28 | Node = Chrome | Chrome 153: layout 808/808, SVG 808/808 바이트 동일, 네트워크 0 | PASS |
| A29 | DOM 측정 0 | A29 검사 (새 세 모듈 PURE), 글자 폭은 표 | PASS |
| B1–B7 (+B9) | §19.2 | §35.12 | PASS (B5는 G4f 판정) |

### 35.12 성능 (이 PC, Node 24.17, `layout-perf.js` 5회 중앙값, ms)

| 곡 | event | 마디 | plan | prepare | layout 데스크톱 | 휴대폰 | SVG | 연습 map | system | 객체 | SVG KB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| beyer/028 | 95 | 16 | 0.91 | 0.69 | 0.87 | 0.78 | 0.83 | 0.25 | 4 | 252 | 34.7 |
| hymns/take-my-life | 136 | 16 | 1.51 | 1.17 | 1.31 | 1.15 | 0.88 | 0.30 | 4 | 390 | 51.6 |
| burgmuller25/021 | 468 | 33 | 6.40 | 4.36 | 7.61 | 7.92 | 2.96 | 0.90 | 9 | 1,293 | 171.1 |
| czerny849/001 | 548 | 32 | 7.56 | 4.51 | 8.00 | 8.86 | 3.06 | 0.85 | 9 | 1,590 | 188.0 |
| sonatina/013 | 1,354 | 86 | 18.78 | 14.28 | 22.25 | 22.23 | 8.71 | 2.27 | 24 | 4,349 | 503.0 |
| sonatina/016 | 1,494 | 92 | 17.79 | 12.21 | 24.48 | 24.31 | 10.13 | 2.75 | 25 | 5,120 | 581.1 |
| sonatina/020 | 1,563 | 158 | 17.36 | 13.44 | 30.71 | 30.33 | 10.75 | 2.73 | 40 | 5,768 | 676.8 |

코퍼스 347: plan 중앙 1.64, 최대 20.1; prepare + layout 중앙 2.8, p95 20.5, 최대 44.9. 예산: **B1** 19.65 ≤ 60; **B2** 4마디 창 layout + SVG p95 1.75 ≤ 25; **B3** 0.02 ≤ 8; **B4** 전곡 prepare + layout + SVG 최대 54.9 ≤ 100 (sonatina/020); **B6** p95 < 0.01(최대 0.1), 만진 수 = 바뀐 수; **B7** 0; **B9** 0.31 ≤ 0.5 (sonatina/016·020 0.31, burgmuller25/021 0.21, czerny849/001 0.26, sonatina/013 0.23 — G4d-1b가 1b의 객체 뒤에 다시 잰다) — 모두 PASS. **B5**(G4f 판정): sonatina/020 전곡 54.9 ms ≤ 300, 가장 긴 호출 30.7 ms (조각 12 ms는 G4f의 시간 나누기). G4c 대비 sonatina/020 layout 18.6 → 30.7 ms(marks pass: slur 끝점과 skyline), SVG 8.9 → 10.8 ms. Chrome 153(`browser-parity.js`) sonatina/020: 1× plan 12.9, prepare 10.5, layout 21.5; 4× CPU 60.9 / 54.3 / 96.6 — 한 호출이 50 ms를 넘는 것은 G4b·G4c와 같이 G4f의 idle·worker 나누기 몫이다.

### 35.13 회귀 (코드 커밋 `4327a2c`)

| 검사 | Windows (`D:/PPP-g4`, Node v24.17.0) | Linux (Docker `node:24-bookworm`, Node v24.21.0; `4327a2c`의 `core.autocrlf=false` clone, LF 파일) |
| --- | --- | --- |
| `npm run test:engrave` | **163/163** (149 + `marks.test.js` 14; 새 mutation 22는 기존 테스트 안) | **163/163** |
| `npm run test:scoregraph` | **214/214** | **214/214** |
| `layout-hashes.js` | 118 × 2 전부 커밋된 hash (다시 bless 236, §35.14) | 같음 |
| `make-metrics`·`make-outlines`·`make-e-fixtures`·`make-corpus --check` | PASS | PASS |
| `make-text-metrics.js --check --fetch` | PASS — 형식·digest, 고정 글꼴로 바이트 재생성 | PASS (Linux에서 받은 글꼴로 재생성까지) |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS | PASS / PASS / PASS |
| G0 부분 (`run.py sg-roundtrip`, `golden`, `run`+`check --suite smoke`, `core`) | sg-roundtrip exit 0 (L1+ 367/369 — 허용 2), golden 17/17, smoke·core verdict PASS. G4d-1a는 G0 경로를 건드리지 않는다 | — |
| `browser-parity.js` (A28) | Chrome 153: layout 808/808, SVG 808/808 바이트 동일, E14 `<use>` 18개 상자 오차 ≤ 0.01 sp, 네트워크 0 | — |
| legacy parity (`legacy-parity.js`; `d4b5b86`의 `git archive`를 8801에, 이 트리를 8802에, `NODE_ENV=production HOST=127.0.0.1`) | **16/16 바이트 동일**; 8802의 `engrave/index.js`는 `0.4.0-g4d1a`, 8801은 `0.3.0-g4c` — 측정 뒤 두 서버를 껐다; 8777·8788은 건드리지 않음 | — |
| `layout-perf.js` | 판정하는 예산 전부 PASS (§35.12) | — |
| 앱 파일 | `Piano Coach App.dc.html`·`index.html`·`server.js`·`scoregraph/` 바이트 그대로 (`git diff d4b5b86` 비어 있음) | — |

### 35.14 커밋된 layout hash 다시 bless — 분류 (§21.3)

`tests/engrave/tools/layout-diff.js --base=<d4b5b86의 engrave/·scoregraph/>` (곡선과 버전 이름을 보도록 고침): 118곡 × 두 config = 236쌍, **전부 바뀜** (버전 이름 `engr/2`가 canonical JSON에 있다). 두 트리 모두 지금의 fixture를 배치한다 — E09·E12·E13·E15는 내용도 바뀌었다 (§35.7, §35.15).

| 분류 | 수 (E / R / 전사) | 무엇 |
| --- | --- | --- |
| SERIALIZATION_ONLY `(version)` | 136 (50 / 56 / 30) | 버전 이름(`engr/2`, planKey의 `plan/2`)만 — 객체·좌표 같음 |
| GEOMETRY_ONLY | 8 (6 / 0 / 2) | 괄호 없는 tuplet 숫자가 beam 옆으로 (E04, E07, golden/G03 × 2); E39 × 2는 숫자가 보표 안으로 들어가 system 윗선이 올라감 (모든 객체가 세로로) |
| LEDGER_CHANGE | 92 (24 / 66 / 2) | 새로 그린 것: slur 46, articulation 52, 운지 40, tie 28, fermata 14, 쉼표 덧줄 6 (E13, the-strife-is-oer, burgmuller25/019 × 2), 꾸밈 기호 4, arpeggio 4, tremolo·glissando·머리 괄호·괄호 임시표·E27 kit 머리 각 2 |

L1은 나빠지지 않았고(baseline은 키만 더함) L2 영목표는 전부 0이다. **bless 이유**: G4d-1a가 곡선과 음에 붙는 기호를 그리고, 괄호 없는 tuplet 숫자와 보표 밖 쉼표를 고치고(G4c 리뷰 M1·M2), 버전을 올렸기 때문 (G4-D1a-1).

(리뷰 R8의 기록 정정, Fixer §35.18.6) LEDGER_CHANGE 92쌍 가운데 **77쌍은 새로 그린 것만이 아니라 이미 있던 객체도 움직였다** (세로 배치: 새 곡선·기호가 staff skyline을 바꿔 보표·system 간격이 달라짐 — 리뷰의 `rebless-audit.js`, 이미 있던 머리 27,211·stem 23,499·덧줄 11,540 등). 분류 도구는 한 쌍에 한 등급만 주므로 이 움직임은 LEDGER_CHANGE 안에 들어 있다.

### 35.15 Fixture

`make-e-fixtures.js --check` PASS. 바꾼 넷: **E09** 5마디(모든 세로줄에 tie, 왼손 8분) — 데스크톱·휴대폰 모두 tie 하나가 system을 넘는다; **E12** 3마디 증1도 unison (§35.7); **E13** 3마디 — 아래 성부 2분쉼표가 위 성부의 낮은 음 밑, 보표 밖으로; **E15** 3마디 — trill, 뒤집힌 mordent, turn + detached-legato, tremolo + 숨표, 마지막 세로줄 fermata. `e-fixtures.test.js`가 새 내용을 확인한다.

### 35.16 PNG (직접 봄; `NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/render-png.js`, 14 px/sp, gitignore)

`tests/engrave/out/png/`: `e-E04-tuplet-show.desktop.png`, `e-E08-tie-partial-chord.desktop.png`, `e-E09-tie-barline-system.desktop.png`·`.phone.png`, `e-E10-slurs-overlap.desktop.png`, `e-E11-slur-rest-system.desktop.png`·`.phone.png`, `e-E12-two-voices-heads.desktop.png`, `e-E13-two-voices-rests.desktop.png`, `e-E15-articulations.desktop.png`, `e-E23-fingering.desktop.png`, `e-E27-percussion.desktop.png`, `e-E31-noteheads.desktop.png`, `e-E32-accidentals-cautionary.desktop.png`, `e-E33-accidental-chord.desktop.png`, `e-E40-arpeggio-gliss.desktop.png`; 카탈로그(G0 hold-out 아님) `czerny849-013.desktop.png`, `sonatina-017.desktop.png`, `burgmuller25-013.desktop.png`, `czerny849-020.phone.png`, `czerny849-020.desktop.clip.png`, `sonatina-020.desktop.clip.png`. 본 것: tie 반쪽이 system 끝·첫머리에서; 겹친 slur는 둘째가 첫째 위로; 쉼표를 넘는 slur; E15의 쌓기(staccato가 accent 안쪽, tenuto는 칸에, detached-legato 위 turn); 운지 쌓기(위 숫자가 위 음); arpeggio 화살표·괄호, 물결 glissando; 괄호 머리·`[ ]` 임시표; E13의 보표 밖 2분쉼표와 그 덧줄; Czerny 셋잇단 숫자가 beam 옆 보표 안; 두 성부 staccato가 stem 쪽이면 beam 너머 (처음엔 머리 위에 있어 고침 — G4-D1a-4). 남은 모양 문제는 §35.17.

### 35.17 남은 것

- **BLOCKER 0, MAJOR 0** (implementer 자체 판정).
- MINOR·관찰:
  1. 운지가 긴 phrase slur 바깥에 서서 음에서 멀다 (§35.10 7) — M-H1.
  2. tie 높이는 포물선(제어점 1/3·2/3)이라 긴 tie가 둥글다; slur도 같은 모양 가족이다 — M-H1에서 상수 조정.
  3. `SLUR_COLLIDES` 15 (E + 코퍼스, 두 config): 여러 system에 걸친 phrase slur, 다른 성부 stem 위로 가야 하는 slur. 모두 진단에 있고 1 % 안이다.
  4. cross-staff tie·slur·glissando(코퍼스 slur 2)는 떠나는 staff에 그리고 진단 (`SLUR_CROSS_STAFF` 등) — cross-staff 판각은 G4 뒤.
  5. 꾸밈음의 notehead shape는 G4c 그대로 보통 머리 (`eg.notehead.shape_err`는 꾸밈음을 보지 않음).
  6. `eg.slur.endpoint_err`는 끝점 ± 0.1 sp 아래만 본다; M1 mutation(그래프 beam을 버림) 아래에서 한 끝이 다른 곡선과 0.07 sp — 실제 코퍼스는 0.
- **G4d-1b로**: system에 붙는 기호(셈여림·hairpin·pedal·ottava·volta·코드명·tempo·rehearsal·jump·words·가사, 안내 글자), §15.3 세로 배치(음 쪽 skyline은 이 단계의 것 위에), §15.4 courtesy, B9 다시 재기(지금 0.31), A8–A10, A12 가사, A20·A25 전체. 글자 표의 `serif`·`serif-italic`·`sans-bold`·`mono`는 그때 쓰인다.
- **G4d-2로**: 곡선·글자도 `svg.js`로 그려지므로 페이지 CSS(`.ppp-fingering` 등)와 테마 색; `data-plan`의 `plan/2`로 캐시 키 (G4-D1a-1).

**커밋**: `4327a2c` (코드·테스트·fixture·baseline·layout hash·CI의 `make-text-metrics --check --fetch`), `41c7ca8` (`layout-hashes.js --write`의 버전 규칙 guard — 도구만; `layout-hashes.js`와 `layout.test.js`를 다시 돌려 PASS), 이어서 이 기록 (G04 §35, 목차; DECISIONS G4-D1a-1–13; CURRENT_STATE). `origin/g4d1a-curves-marks`에 push. 병합 안 함, PR 없음.

**상태: G4d-1a READY_FOR_REVIEW** — BLOCKER 0, MAJOR 0 (자체 판정).

### 35.18 리뷰와 Fixer (2026-09-25–26)

입력: G4d-1a 독립 리뷰 (read-only, 대상 `7c83bc9`; 증거는 리뷰 scratchpad `g4d1a-review/`의 `tools/`·`logs/`·`png/`)의 판정 **NEEDS_FIX — BLOCKER 0, MAJOR 3, MINOR 5**. 리뷰가 확인한 것: 약해진 gate 없음, re-bless는 정직함, Windows = Linux = Chrome, 성능은 선형. Lead의 Fixer 지시: MAJOR R1–R3을 고치고, 명세를 고치는 Lead 결정 둘(**G4-L4** 화음의 tie 방향과 끝, **G4-L5** 운지는 slur 안쪽 — 이 문서에서 고친 곳에 "(G4-L4, Lead 2026-09-25)"·"(G4-L5, …)"로 표시: §10.2 순서 6–7, §10.5, §13.1, §35.10 4·7)을 적용하고, 작은 일 둘(R4 글자 metric CI, R8 guard)을 한다. 나머지는 Lead가 다른 곳에 맡겼다 (§35.18.11). 같은 worktree `D:/PPP-g4`, 브랜치 `g4d1a-curves-marks`, 시작 `7c83bc9`. 리뷰의 스크립트는 생각만 빌렸고 (`chord-ties.js`로 전후를 셈), 커밋한 metric·fixture·mutation은 새로 썼다. `scoregraph/`·앱 파일·`index.html`·`server.js`·재생·카탈로그는 바이트 그대로다. 결정은 DECISIONS G4-D1a-14–23.

"지금"의 수는 모두 E 40 + 코퍼스 347 + golden 17 = 404곡 × 두 config = 808 layout (따로 적지 않으면), "`7c83bc9`"의 수는 `7c83bc9`의 `engrave/`로 **오늘의 입력**(바뀐 fixture 포함)을 배치해 오늘의 `l2.js`로 잰 것이다.

#### 35.18.1 지적과 처리

| # | 지적 (리뷰) | 처리 | 어디 |
| --- | --- | --- | --- |
| R1 (MAJOR) | 화음의 tie 방향: §13.1의 가운데 줄 규칙이 화음의 모든 tie를 한쪽으로 휘게 한다 (코퍼스 tie 달린 화음 42 중 35, burgmuller25/015 마지막 마디); 2도로 비킨 머리의 tie 끝이 애매하다 (sonatina/020 ×4, /022, /024, /028) — A22가 화음 앞면까지 재서 못 봄 | **FIXED** — G4-L4를 `marks.js`와 `l2.js`에; tie 끝은 제 머리에 가장 가깝게; A22 앞면 허용 없앰; mutation TH, TD | §35.18.2 |
| R2 (MAJOR) | §10.5 `FAR_PLACEMENT` 없음; 운지가 phrase slur 위에 서서 음에서 멂 (코퍼스 운지 9,958 중 190이 보표에서 8 sp 넘게, 최대 14.1 sp czerny849/023 — 이 Fixer의 셈으로는 198) | **FIXED** — G4-L5 (운지를 slur보다 먼저), `put()`의 `FAR_PLACEMENT`, `eg.layout.far_placements`·`far_undiagnosed`, 영목표 `eg.fingering.far`; mutation FS, FP | §35.18.3 |
| R3 (MAJOR) | layout hash로만 잡히거나 아무것도 못 잡는 규칙: RV26 점을 지나는 tie, RV25 화음 임시표를 지나는 tie 끝, RV23 slur 가운데 조각, RV8b glissando 끝 높이, RV9 운지 폭의 간격, RV20·RV20c slur 쪽, RV19 fermata 모양 | **FIXED** — 이름 붙은 metric 다섯(+ glissando 높이), fixture E08·E10·E11·E15·E23, 살아 있는 mutation 여덟 | §35.18.4 |
| R4 (MINOR) | 글자 metric CI 단계가 모든 PR을 network에 묶음 (`bench.yml:35`, `--fetch` 제한 시간 없음) | **FIXED** — PR은 `--check`(network 없음), 다시 만들기는 nightly `--strict`, 제한 시간, "skipped (network)" | §35.18.5 |
| R8 (MINOR) | `layout-hashes.js --write`가 origin/main과 못 비교하면 "could not check"라 하고 그래도 씀; `PLAN_VERSION`을 안 봄; §35.14의 LEDGER_CHANGE 92쌍 중 77이 기존 객체도 옮겼음 | **FIXED** — fail closed, plan hash; 기록 정정은 §35.14에 | §35.18.6 |
| R5, R6, R7 (MINOR) | 괄호 임시표가 flat보다 짧음; 짧은 반쪽 slur·갈고리 모양 두 음 slur; 곡마다 slur hit 최대 12.5 % | **Lead가 맡김** — 손대지 않음 (R6·R7의 수는 이 Fixer로 바뀜, §35.18.3) | §35.18.11 |

#### 35.18.2 R1 — G4-L4: 화음의 tie 방향과 끝 (`engrave/marks.js`, `curves.js` `TIE`, `layout.js`; G4-D1a-14, 15)

- **방향** (§13.1 as amended): 두 성부면 성부 역할, 음 하나면 stem 반대, 화음이면 그 머리의 **제 화음 안 자리** — plan의 머리 순서(적힌 음의 staff 자리, 그 staff의 머리 전부)로 센다: 위 절반 위, 아래 절반 아래, 홀수 화음의 가운데는 stem 반대. layout은 이것을 plan에서 읽는다(`prepare`가 marks pass에 머리마다 `step`을 넘김) — 그래서 system을 넘는 tie의 두 반쪽이 **떠나는 머리**의 규칙 하나로 휜다 (떠나는 머리의 마디가 배치되지 않은 가까이 보기 창에서는 닿는 머리). `7c83bc9`는 반쪽마다 그 system에 있는 머리로 정했다.
- **끝점**: 먼저 `7c83bc9`의 자리(바깥 머리면 머리 위·아래 곁, 아니면 그 높이에서 event가 그린 것 너머, 머리 가운데에서 0.25 sp). 그 자리가 **제 머리(시작은 그 줄의 점과, 그 높이에 닿는 제 flag까지)에서 0.45 sp 안이고 화음의 다른 어느 머리보다 0.05 sp 넘게 가깝지** 않으면, 머리 가운데에서 0.05 sp씩 바깥으로(머리 가장자리 + 0.15 sp까지) 옮기며 x를 그 높이에서 다시 정한다 — 비킨 2도의 이웃 머리나 화음의 임시표가 그 높이를 벗어날 때까지. 808 layout에서 옮겨진 끝은 18: 0.1 sp 12 (sonatina/020 ×4, /022, E08 셋째 마디 — 두 config), 0.4 sp 6 (sonatina/024·/028의 화음 임시표, E08 여섯째 마디). 맞는 자리를 못 찾은 끝은 0.
- **flag** (G4-D1a-15): G4-L4가 stem 쪽으로 돌린 tie가 flag 달린 음에서 떠나면 flag를 지나 시작한다 — 점 뒤에서 시작하는 것과 같다. 그래서 A22는 시작을 머리·그 줄의 점·**그 높이에 닿는 제 flag**까지 잰다. 코퍼스에 한 곳: sonatina/019 6마디(`m13`)의 3도 화음(8분, stem 위)의 위 tie (두 config). flag를 넣지 않으면 1.08 sp로 A22를 넘는다; flag를 지나지 않으면 tie가 flag를 가로지른다 (§35.18.11에 적음 — Lead가 받아들일지 볼 곳).
- **`l2.js`**: `eg.tie.dir_err`는 G4-L4를 그려진 화음(한 system·staff의 그 event 머리, 세로 순서)에서 따로 셈 — 떠나는 머리가 그려졌으면 그 규칙; A22 끝점 검사는 제 머리(시작은 점·flag)까지 0.5 sp 이하 **그리고** 화음의 다른 머리보다 가까움 (G4-D1a-5의 앞면 허용 없앰); 새 `eg.tie.crossings` — tie 곡선이 제 두 음이 그린 머리·stem·flag·점·임시표를 지남.

| metric | `7c83bc9` | 지금 | 잡는 mutation |
| --- | --- | --- | --- |
| `eg.tie.dir_err` (G4-L4) | **116** | 0 | TH (26), MT (17) |
| `eg.tie.endpoint_err` (제 머리에 가장 가까움, 0.5 sp) | **18** = 리뷰의 7화음 × 2 + 새 E08 4 | 0 | TD (4) |
| `eg.curve.endpoint_err_max` (A22, ≤ 0.5) | 1.35 | 0.27 (비킨 2도의 끝: stem 0.12 + 0.15) | — |
| `eg.tie.crossings` | **1** (sonatina/024 휴대폰: system 넘는 tie `s2759`의 뒤 반쪽이 거꾸로 그려져 화음의 ♯을 지남) | 0 | RV26 (2), RV25 (2) |

  리뷰의 `chord-ties.js` (tie 둘 이상인 화음, 데스크톱, 코퍼스 + E): `7c83bc9` 45 중 **38**이 모든 tie를 한쪽으로 (코퍼스 35 + 새 E08 3), 2도 이웃이 같은 쪽 6 → 지금 **0**, 0.
- **fixture E08** (마디 2–6): 네 머리 화음 통째 tie (C5–E5–G5–C6, stem 아래: 위 둘 위, 아래 둘 아래), 2도가 있는 세 머리 (E4–G4–A4, stem 위, A4가 비킴: 위 · stem 반대인 가운데 아래 · 아래), 점 붙은 세 머리 (B4–D5–F5, tie는 점 뒤), D5–F♯5 화음의 D5 tie가 세로줄을 넘어 ♯이 있는 화음으로 (끝이 ♯ 아래로 비켜 D5 곁에). `marks.test.js` A5가 두 폭에서 방향 문자열·점 비킴·♯ 비킴을 고정.
- **mutation**: TH — 화음의 절반 규칙을 뒤집음 → `eg.tie.dir_err` 26 (E08, burgmuller25/015); TD — 끝 맞추기를 끔(처음 자리가 늘 맞다고 함, 곧 `7c83bc9`) → `eg.tie.endpoint_err` 4 (E08); MT는 새 규칙의 anchor로 옮김.

#### 35.18.3 R2 — G4-L5: 운지는 slur 안쪽, §10.5 `FAR_PLACEMENT` (`marks.js`, `curves.js` `SLUR`, `skyline.js`; G4-D1a-16, 17, 18)

- **순서** (§10.2 as amended): tie → tuplet → articulation·꾸밈 기호·fermata·tremolo → **운지** → slur·glissando (→ G4d-1b의 것). staccato·tenuto는 여전히 운지 안쪽.
- **slur가 운지를 비킴**: slur 끝은 제 음의 운지(어디 서든)와 끝 x ± 0.1 sp에 걸친 다른 음의 운지 바깥 0.25 sp; 호는 skyline(운지 포함)을 넘는다. 끝 0.5 sp 안(끝 음의 몫으로 빼던 칸)의 운지는 **hard 칸**으로 넘긴다 — 여유 없이(두께 반 + 0.05 sp) 가로지르지만 않게 (`curves.js` `TOUCH`); 가파르게 오르는 slur가 끝 음의 운지 모서리를 자르던 것 (sonatina/001·017·023, 8곳).
- **한쪽 끝을 더 멀리** (G4-D1a-16): 운지가 음 곁에 오면 높은 음 위를 지나는 긴 phrase slur가 더 높이 가야 한다. 두 끝을 함께 0.5 sp씩 6번(`TRIES`) 옮겨도 안 되면, 한 끝은 `TRIES` 안에 두고 다른 끝을 `SPREAD` = 20번(10 sp)까지 — 옮긴 합이 적은 것부터. 12 slur가 이것으로 풀림 (끝 하나를 최대 7 sp; czerny849/013 `s1927`의 끝 반쪽 — 끝에서 오르는 음계 뒤의 낮은 마지막 음). 첫 6번에 풀리는 slur의 모양은 `7c83bc9`와 같다.
- **`FAR_PLACEMENT`** (§10.5 as amended): `Skyline`이 선택 `{edges: [0, 마지막 줄], far: 8, diag}`를 받고 `put()`이 놓인 항목의 staff 쪽 가장자리가 그 쪽 바깥 줄에서 8 sp를 넘으면 `{code: 'FAR_PLACEMENT', refs: [항목 id]}`를 남긴다 (marks pass의 모든 `put()`이 id를 넘김; tuplet은 tuplet id). `eg.layout.far_placements`(§21.2, 기록 — `bench.js` LOWER ratchet), `eg.layout.far_undiagnosed`(8 sp 너머인데 그 id를 이름 대는 진단이 없는 배치 항목, 영목표). 지금 37 (r 16, e 2, x 0 = baseline): 모두 덧줄 많은 높은 음 곁의 운지·기호 (czerny849/007, 017, 019, 021, 023, sonatina/007, 010, E23의 A7) — slur 때문인 것은 0.
- **`eg.fingering.far`** (G4-D1a-18, 영목표): 운지는 제 음에서 **그 사이에 서야 하는 것이 요구하는 만큼보다 멀지 않다** — 그 x(양쪽 skyline 칸 0.25 sp 더)에서 제 staff의 음 요소(어느 성부든), tie, tuplet 숫자·괄호, 기호(articulation·꾸밈 기호·fermata·tremolo), **같은 기둥**(같은 마디·시각)의 운지(화음·다른 성부의 쌓인 운지), 그리고 보표 자체(운지는 보표 밖) — 그 바깥 끝에서 운지까지가 0.3 sp(음에서의 pad) + 0.02를 넘으면 하나. slur·glissando는 이유가 되지 않고(뒤에 오며 운지를 비킨다), 다른 기둥의 운지도 아니다(간격이 기둥마다 운지 폭을 준다, §9 — RV9). 근거: G4-L5의 "음 곁"을 곧 놓이는 규칙대로 적은 것 — 고정 거리(예: 머리에서 2 sp)는 쌓인 화음 운지와 덧줄 음에서 틀리고, `FAR_PLACEMENT`만으로는 slur 위로 1–7 sp 올라간 운지를 못 본다.

| metric | `7c83bc9` | 지금 | 잡는 mutation |
| --- | --- | --- | --- |
| `eg.fingering.far` | **8,065** | 0 | FS (137), RV9 (3) |
| `eg.layout.far_undiagnosed` | **371** (진단 자체가 없음) | 0 | FP (2) |
| `eg.layout.far_placements` (기록) | 0 (진단 없음) | 37 | — |
| 코퍼스 운지(데스크톱 9,958) 중 보표에서 8 sp 넘게 | 198, 최대 14.16 sp (czerny849/023), 평균 2.92 | 16 (모두 `FAR_PLACEMENT`, 높은 음 곁), 최대 10.81, 평균 1.75 | — |
| `SLUR_COLLIDES` (진단) | 15 | 1 (burgmuller25/013 휴대폰 `s729`, `7c83bc9`에도 있음) | — |
| `eg.curve.hits` (안쪽 머리·stem을 지나는 slur) | 9 | 1 (위 `s729`, 진단됨) | — |
| `eg.slur.endpoint_err` (운지가 끝 아래에 서는 G4-L5 뜻으로) | 40 | 0 | MS |
| `eg.overlap.text` | 0 | 0 (hard 칸 전에는 10) | M8 |

- **fixture E23** (마디 2–3): phrase slur 아래 운지 붙은 16분 여덟 — "4-3"·"2-1"(손가락 바꿈)은 머리보다 넓다 — 과 A7(보표 위 8.8 sp의 운지 → `FAR_PLACEMENT` 하나). `marks.test.js` A7이 운지가 음과 slur 사이, 넓은 운지가 이웃과 떨어짐, `FAR_PLACEMENT`가 그 운지 하나를 이름 댐을 고정.
- **mutation**: FS — 운지 블록을 함수로 싸서 slur·glissando 뒤에 부름(G4-L5 되돌림) → `eg.fingering.far` 137 (E23, czerny849/005); FP — `put()`의 진단을 끔 → `eg.layout.far_undiagnosed` 2 (E23).
- **본 것** (§35.18.10): czerny849/005·020·023 — 운지가 음 곁, slur가 그 바깥 (전에는 slur 위 2–6 sp); burgmuller25/015. **관찰** (고치지 않음, M-H1): stem이 위인 음의 운지는 그 x에 beam이 없으면(beam 묶음의 첫 음) stem 옆 머리 바로 위에 선다 — 운지가 머리 가운데에 맞춰지고 stem은 그 x 밖이기 때문(G4-D1a-7의 규칙 그대로; `7c83bc9`에서는 slur가 모두 밀어 올려 가려져 있었다, czerny849/023 PNG).

#### 35.18.4 R3 — 이름 붙은 metric과 fixture (`tests/engrave/l2.js`, `make-e-fixtures.js`; G4-D1a-19)

| 리뷰 | 규칙 | metric | `7c83bc9` | 지금 | mutation (값) | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| RV26 | tie는 점 뒤에서 (§13.1) | `eg.tie.crossings` | 0 (점을 지나는 것) | 0 | RV26 (2) | E08 4마디 |
| RV25 | tie 끝은 화음의 임시표 앞 | `eg.tie.crossings` | 1 (임시표를 지나는 것: sonatina/024 휴대폰) | 0 | RV25 (2) | E08 5–6마디 |
| RV23 | 3 system 이상 넘는 slur는 그 사이 system마다 가운데 조각 하나 | `eg.slur.missing` (한 system `whole`, 넘으면 `start` + 사이마다 `mid` + `end`, 한쪽만이면 그 반쪽 — 더도 덜도 아님) | 0 | 0 | RV23 (2) | E11 3–8마디 (두 폭에서 3 system 이상) |
| RV8b | glissando는 두 음높이를 잇는다 | `eg.gliss.errors`에 끝 높이: 두 끝이 제 머리 가운데 ± 0.25 sp (staff를 넘으면 떠나는 staff의 높이) | 0 | 0 | RV8b (4) | E40 |
| RV9 | 운지 폭이 간격에 들어감 (§9) | `eg.fingering.far` (다른 기둥 운지에 밀린 운지) | 8,065 | 0 | RV9 (3) | E23 2마디 |
| RV20, RV20c | §13.2의 slur 쪽: placement → 성부 역할 → 걸친 성부 음의 stem이 모두 위면 아래, 아니면 위 | `eg.slur.side_err` (l2가 다시 셈) | 0 | 0 | RV20 (2), RV20c (4) | E10 2마디(stem 모두 위), 3마디(두 성부, 각 slur) |
| RV19 | fermata 모양 (normal, angled, square) | `eg.mark.glyph_err`: articulation은 쪽에 맞는 SMuFL glyph(고정 글꼴에 없으면 그 대체만), detached-legato는 staccato + tenuto, 꾸밈 기호는 plan이 이름 댄 glyph, fermata는 모양 | 0 | 0 | RV19 (4) | E15 3마디 (angled, square) |

  모두 `bench.js` ZERO와 `layout.test.js` ZERO_L2 (808 layout 전부 0이어야 통과). `marks.test.js` "negative controls"가 실제 layout을 망가뜨려 아홉 metric(방향·끝·crossing·missing·side·gliss 높이·glyph·fingering.far·far_undiagnosed)이 제 결함을 찾음을 보인다. E fixture는 40개 그대로 (§22.1), 바뀐 것은 E08·E10·E11·E15·E23 — `make-e-fixtures.js --check` PASS, `e-fixtures.test.js`가 새 내용(tie 12, fermata 5, 운지 18)을 셈.
- **layout mutation 전체** (`layout-mutation.test.js`, CRLF 사본, anchor 한 번, 출력이 바뀌고 이름 붙은 metric이 같은 probe에서 원래 0): 새 열둘 — TH, TD, FS, FP, RV8b, RV9, RV19, RV20, RV20c, RV23, RV25, RV26 — 모두 잡힘; G4b–G4d-1a의 51개 그대로 (MT·MW는 바뀐 코드의 anchor로 옮김), N1·N2 바이트 동일. 새 probe: E08, E11. 약 35 s.

#### 35.18.5 R4 — 글자 metric의 CI (`make-text-metrics.js`, `.github/workflows/bench.yml`; G4-D1a-21)

- **PR gate** (`gate` job): `make-text-metrics.js --check` — network 없음: 표의 형식과 digest는 언제나, 글꼴이 캐시에 있으면 다시 만들기까지 (CI에는 없으므로 "rebuild skipped (the fonts are not cached; …)"라고 말하고 PASS).
- **nightly job**: `make-text-metrics.js --check --fetch --strict` — 고정 글꼴을 받아 바이트 비교; 다시 만들기가 돌지 못하면(받기 실패, 제한 시간) FAIL.
- **받기**: 글꼴 하나에 `AbortSignal.timeout(30 s)`; 실패는 "rebuild skipped (network): …"(제한 시간이면 "no answer in 30 s")로 늘 말한다 — 조용히 통과하지 않는다.
- **음성 대조** (Windows, 글꼴 캐시를 치우고, 받는 주소만 바꾼 임시 사본): DNS 실패 `--check --fetch` → PASS + "skipped (network): fetch failed", `--strict` → FAIL exit 1; 닿지 않는 주소(제한 시간 3 s로) → "no answer in 3 s", `--strict` → FAIL exit 1; 캐시 없는 `--check --strict` → FAIL. 진짜 받기 `--check --fetch --strict` → PASS (바이트 같음).

#### 35.18.6 R8 — `layout-hashes.js --write`의 지킴이 (G4-D1a-22)와 기록 정정

- **파일**: `version`(engr)과 함께 **`planVersion`과 곡마다 plan hash**(`plans`)를 싣는다. A27 테스트와 `layout-hashes.js`(검사)는 plan hash도 비교한다 — Linux에서도 같음.
- **기준**: origin/main과의 merge base에 있는 파일. 거기 plan hash가 없으면(`d4b5b86`처럼) 그 commit의 `engrave/`·`scoregraph/`를 파일마다 `git show`로 꺼내 같은 graph의 plan hash를 셈. **fail closed**: git이나 origin/main이 없거나 merge base가 파일보다 오래되었으면(낡은 origin/main) 기준은 **여기 커밋된 파일**이 되고, 버전이 그것에서 움직였을 때만(또는 아무것도 다르지 않을 때만) 쓴다. 거절하면 이유를 말하고 exit 1, 아무것도 안 씀.
- **규칙**: 같은 `engr` 버전 아래 layout hash가 다르면 거절; 같은 `planVersion` 아래 plan hash가 다르면 거절; 기준의 plan 버전이나 plan hash를 알 수 없으면 거절 (fail closed).
- **음성 대조** (scratch clone, `refs/remotes/origin/main`을 바꿔 가며; Windows, 그리고 Docker Linux에서 B2·F):

| # | origin/main | 바꾼 것 | 결과 |
| --- | --- | --- | --- |
| A | `d4b5b86` (진짜) | 없음 | 씀 (engr/1 → 3, plan/1 → 2), 파일 그대로 |
| D | `d4b5b86` | `VERSION`을 engr/1로 | **거절** — 236 hash, 같은 engr/1 |
| B1 | `a0bc2ea` (파일 이전, 낡음) | 없음 | fail closed, 아무것도 안 다름 → 씀 (파일 그대로) |
| B2 | `a0bc2ea` | tie gap 0.15 → 0.2, engr/3 그대로 | **거절** — 24 hash, 커밋된 파일 기준 (Linux도) |
| B2-old | `a0bc2ea` | 같은 것, `7c83bc9`의 도구로 | "could not read … not checked" 하고 **씀** — 리뷰가 본 결함 |
| B3 | `a0bc2ea` | 같은 것 + engr/4 | 씀 |
| B4 | `a0bc2ea` | plan 출력에 필드 하나, plan/2 그대로 | **거절** — plan 118 |
| B5 | `a0bc2ea` | 같은 것 + plan/3 (+ engr/4, planKey가 바뀌므로) | 씀 |
| E | 없음 | tie gap, engr/3 그대로 | **거절** — 커밋된 파일 기준 |
| F | `d4b5b86` | `PLAN_VERSION`을 plan/1로 | **거절** — plan 118 (기준 plan은 `d4b5b86`의 제 코드로 셈; Linux도) |
| F3 | `d4b5b86` | `d4b5b86`의 `engrave/`·`scoregraph/` 자체 | plan 차이 없음 (대조); layout 16 거절 — 그 뒤 바뀐 fixture 8개 |

  (처음 구현은 `git archive | tar`였고 Windows의 MSYS tar가 `C:`를 host로 읽어 F가 "알 수 없음"으로만 거절됐다 — 파일마다 `git show`로 고침, `e11337b`.)
- **기록 정정** (리뷰 R8의 둘째 부분, 문서만): §35.14에 "LEDGER_CHANGE 92쌍 중 77쌍은 이미 있던 객체도 움직였다(세로 배치)"를 더했다.

#### 35.18.7 `bench.js`와 baseline (G4-D1a-20)

- `compare()`는 이름에 `ratio`가 든 metric을 모두 "클수록 좋음"으로 읽었다 — `eg.curve.hit_ratio`(작을수록 좋음, A22)가 오르면 통과하고 내리면 퇴행이었다. `eg.curve.hit_ratio`를 LOWER에 넣고 LOWER는 클수록-좋음에서 뺀다. `eg.layout.far_placements`도 LOWER.
- baseline r·e·x (`bench.js baseline` 뒤 git diff): 새 키 일곱(`eg.tie.crossings`, `eg.slur.missing`, `eg.slur.side_err`, `eg.mark.glyph_err`, `eg.fingering.far`, `eg.layout.far_undiagnosed` = 0, `eg.layout.far_placements` = r 16 / e 2 / x 0); 내린 값: r `eg.curve.hits` 3 → 0, `eg.curve.hit_ratio` 0.0016 → 0 (G4-L5의 slur 맞추기); 오른 값 둘은 이유가 있다: `eg.curve.slurs`(기록, e 10 → 20: 새 fixture의 slur), `eg.curve.endpoint_err_max`(MAXIMA ≤ 0.5, e·r 0.15 → 0.27: G4-L4가 앞면 허용을 없애 같은 끝을 제 머리까지 잼). 영목표·비율은 모두 0·1.

#### 35.18.8 버전과 re-bless (§21.3; G4-D1a-23)

- **버전**: layout 출력이 검토된 `7c83bc9`(engr/2)에서 바뀌었으므로 Lead 지시의 G4-D1a-1 읽기대로 `engr/2` → **`engr/3`**. plan 출력은 그대로 — 404곡의 plan이 `7c83bc9`의 것과 바이트 같음 — 이므로 **`plan/2` 유지**. `layout.test.js`·`marks.test.js`의 버전 검사를 engr/3으로.
- **`layout-diff.js --base=<7c83bc9의 engrave/·scoregraph/>`** (두 트리 모두 오늘의 fixture를 배치): 118곡 × 두 config = 236쌍, **전부 바뀜** (버전 이름).

| 분류 | 수 | 무엇 — 이유 |
| --- | --- | --- |
| SERIALIZATION_ONLY `(version)` | 194 | `engr/3`만 — 객체·좌표 같음 |
| GEOMETRY_ONLY — tie만 | 8 | E08, sonatina/019, /022, burgmuller25/016 × 2 — **G4-L4** (방향, 끝) |
| GEOMETRY_ONLY — 운지 + slur | 2 | E23 × 2 — **G4-L5** |
| GEOMETRY_ONLY — 운지 + slur + 틀 | 22 | czerny849/002, 005, 007, 018, 022, 023, sonatina/001, 003, 004, 006, 021 × 2 — **G4-L5** (운지가 slur 안으로 와서 staff skyline이 줄고 보표·system 간격이 바뀜: 모든 객체가 세로로) |
| GEOMETRY_ONLY — tie + 운지 + slur + 틀 | 10 | czerny849/020, sonatina/024, burgmuller25/003, 006, 015 × 2 — **G4-L4 + G4-L5** |
| LEDGER_CHANGE | 0 | 그리는 것은 두 코드에서 같다 |

  이와 별도로 **R3의 fixture** 다섯(E08, E10, E11, E15, E23 × 2 = 10쌍)은 내용이 바뀌어 `7c83bc9`의 커밋된 hash와 그리는 것이 다르다 (E10·E11·E15는 두 코드가 같게 그림 — 위 표에 없음). L1은 나빠지지 않았고 (baseline §35.18.7), L2 영목표는 전부 0. **bless 이유**: G4-L4, G4-L5, R3의 fixture, 버전 규칙 (G4-D1a-1) — 그 밖의 이유로 바뀐 쌍은 없다.

#### 35.18.9 회귀 (코드 `aa813b7` + `e11337b`)

| 검사 | Windows (`D:/PPP-g4`, Node v24.17.0) | Linux (Docker `node:24-bookworm`, Node v24.21.0; `e11337b`의 `core.autocrlf=false` clone, LF) |
| --- | --- | --- |
| `npm run test:engrave` | **163/163** (새 검사는 기존 테스트 안; mutation 63 + N1·N2) | **163/163** |
| `npm run test:scoregraph` | **214/214** | **214/214** |
| `layout-hashes.js` | 118 × 2 layout + 118 plan 전부 커밋된 hash | 같음 |
| `make-metrics`·`make-outlines`·`make-e-fixtures`·`make-corpus --check` | PASS | PASS |
| `make-text-metrics.js --check` (PR gate 형태) | PASS (캐시로 다시 만들기까지) | PASS |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS (61 / 40 / 76 graph) | PASS / PASS / PASS |
| `layout-hashes.js --write` 음성 대조 | §35.18.6 표 | B2, F 같음 |
| `browser-parity.js` (A28) | Chrome 153: layout 808/808, SVG 808/808 바이트 동일, E14 `<use>` 18 오차 ≤ 0.01 sp, network 0; sonatina/020 1× layout 23.2 ms, 4× CPU 107.2 ms | — |
| legacy parity (`legacy-parity.js`; `d4b5b86`의 `git archive`를 8871에, 이 트리를 8872에, `NODE_ENV=production HOST=127.0.0.1`) | **16/16 바이트 동일**; 측정 뒤 두 서버를 껐다; 8777·8788은 건드리지 않음 | — |
| `layout-perf.js` (5회 중앙값) | 판정하는 예산 전부 PASS: B1 22.1 ≤ 60, B2 p95 2.36 ≤ 25, B3 0.02 ≤ 8, B4 53.4 ≤ 100, B6 p95 0, B7 0, B9 0.31 ≤ 0.5; 코퍼스 prepare + layout 중앙 2.5, p95 23.2, 최대 46.1 (`7c83bc9` 44.9); sonatina/020 layout 29.4 ms (30.7) | — |
| 앱 파일 | `Piano Coach App.dc.html`·`index.html`·`server.js`·`scoregraph/` 바이트 그대로 (`git diff d4b5b86` 비어 있음) | — |

#### 35.18.10 PNG (직접 봄; `render-png.js`, 전은 `7c83bc9`의 트리, gitignore)

`tests/engrave/out/png/fix-before/`와 `fix-after/`에 같은 이름으로: `burgmuller25-015.desktop.png`·`.clip.png`(마지막 system — 위 보표 화음의 두 tie가 전에는 둘 다 아래, 이제 위·아래), `sonatina-020.desktop.png`·`.clip.png`(5마디의 B3–F4–G4, stem 위, G4가 2도로 비킴 — 전에는 세 tie가 모두 아래; 이제 위 tie는 비킨 G4 곁에서 떠나 다음 화음의 stem 왼쪽에서 G4 높이에 닿고, 가운데 F4 tie는 stem 반대로 아래, B3 tie는 아래), `sonatina-019.desktop.clip.png`(flag를 지나 시작하는 위 tie, G4-D1a-15), `czerny849-005.desktop.png`·`.clip.png`, `czerny849-020.desktop.png`·`.clip.png`, `czerny849-023.desktop.png`·`.clip.png`(운지가 음 곁, slur가 그 바깥 — 전에는 slur 위 2–6 sp에 줄지어 섬). E fixture는 테스트가 고정한다.

#### 35.18.11 남은 것과 맡긴 곳

- **Lead가 맡긴 곳 (손대지 않음)**: R5 괄호 임시표가 flat보다 짧음 → **G4d-1b**; R6 system 넘은 뒤의 짧은 반쪽 slur, 갈고리처럼 보이는 두 음 slur → **M-H1 watch list (G4d-2)**; R7 곡마다 slur hit 최대 12.5 % → **M-H1 watch list** (참고: 이 Fixer 뒤 808 layout에서 hit는 1, 곡 최대 비율 4.35 % — burgmuller25/013 휴대폰).
- **Lead가 볼 결정**: G4-D1a-15 (flag 달린 음의 stem 쪽 tie는 flag 뒤에서 시작하고 A22가 flag까지 잰다 — G4-L4가 만든 한 경우), G4-D1a-16 (한쪽 slur 끝을 최대 10 sp까지 — 긴 slur의 끝이 음에서 뜬다: czerny849/013 `s1927` 7 sp), G4-D1a-23 (engr/3).
- **M-H1에서 볼 것**: stem 쪽 운지가 beam 묶음의 첫 음에서 stem 옆에 서는 모양 (§35.18.3); SPREAD로 뜬 slur 끝; 비킨 2도로 들어오는 tie가 stem 왼쪽에서 끝나는 모양 (sonatina/020).

**커밋**: `aa813b7` (코드·테스트·fixture·baseline·layout hash·CI), `e11337b` (`layout-hashes.js`가 base의 `engrave/`를 파일마다 꺼냄), 이 기록 (G04 §35.18과 §10.2·§10.5·§13.1·§35.10·§35.14의 고친 글, DECISIONS G4-D1a-14–23, CURRENT_STATE). `origin/g4d1a-curves-marks`에 push, PR 없음.

**상태: G4d-1a FIX: READY_FOR_RECHECK.**


### 35.19 리뷰 판정·재확인·병합 (Lead, 2026-09-26)

**독립 리뷰** (`7c83bc9`, read-only. 리뷰어 자신의 clone, Windows와 Linux Docker)

- 판정: **NEEDS_FIX — BLOCKER 0, MAJOR 3, MINOR 5.**
- 확인된 것:
  - gate를 느슨하게 하지 않았다. 음성 대조로 tie 끝, slur 관통, 음표머리 위 운지가 각각 잡혔다.
  - 다시 bless한 136/8/92를 독립적으로 재현했다.
  - version guard가 동작한다.
  - Windows = Linux = Chrome.
  - 배치 비용이 음 수에 선형이다.
- MAJOR:
  - R1: 화음 tie 방향. §13.1의 규칙이 가운데 줄 기준이라 tie가 모두 한쪽으로 휜다 (42개 중 35개). 옆으로 비킨 2도에서는 tie 끝이 어느 음 것인지 모호하다 (7개).
  - R2: §10.5 `FAR_PLACEMENT`가 없다. 운지가 phrase slur 위에 올라가 음에서 최대 14 sp 떨어진다.
  - R3: 여러 규칙이 layout hash로만 지켜지거나 아무것도 지키지 않는다.

**Lead 결정** (§13.1·§10.2·§10.5를 고침)

- **G4-L4**: 한 성부 화음의 tie 방향은 그 화음 안의 자리로 정한다. 바깥 tie는 화음 밖으로 휜다. tie 끝은 어떤 다른 머리보다 자기 머리에 가깝다.
- **G4-L5**: 운지를 slur보다 먼저 놓는다 (slur 안쪽, 음 옆). `FAR_PLACEMENT`와 zero-target 운지 거리 metric을 둔다.

**Fixer** (§35.18)

- R1–R3 FIXED, R4(PR gate의 글자 metric 검사를 네트워크 없이), R8(version guard가 닫힌 쪽으로 실패, `PLAN_VERSION`도 봄).
- `engr/3`.
- 수치 (`7c83bc9` → 수정 후):
  - `eg.tie.dir_err` 116 → 0;
  - `eg.fingering.far` 8,065 → 0;
  - staff에서 8 sp 넘는 운지 198 → 16 (모두 진단됨).
- 이름으로 잡히는 live mutation 63개.

**Lead 재확인** (고친 항목만, `e5c616f`의 새 clone)

- `test:engrave` 163/163, `test:scoregraph` 214/214, layout hash, bench r·e·x, make-metrics·outlines·e-fixtures·corpus·text-metrics `--check` 모두 PASS. text-metrics는 네트워크 없이 검사했다.
- 음성 대조:
  - `7c83bc9`의 `engrave/` 전체를 넣으면 bench r·e REGRESSION (`tie.dir_err` 55, `fingering.far` 2,559, `tie.endpoint_err` 4, `slur.endpoint_err` 13, `tie.crossings` 1).
- Lead가 심은 mutation:
  - 엔진이 `FAR_PLACEMENT`를 내지 않음 → `far_undiagnosed` 16;
  - 화음 절반 규칙 제거 → `tie.dir_err` 60;
  - 자기 머리에 가장 가까운 끝 찾기 끔 → `tie.endpoint_err` 4, `curve.endpoint_err_max` 1.34;
  - 운지 간격 +1 sp → `fingering.far` 4,896;
  - 같은 version에서 layout을 바꾸고 base가 낡은 채 `layout-hashes --write` → REFUSED, 아무것도 쓰지 않음.
- 그림:
  - czerny849/023: 운지가 음 옆, slur가 그 바깥;
  - burgmuller25/015·sonatina/020: 화음 tie가 위아래로 갈림 (옆으로 비킨 2도 포함);
  - czerny849/013: 한 장 전체가 깨끗하다.

**병합**: PR #17, CI gate 초록, squash `b4fe019`. **G4d-1a CLOSED — 다시 열지 않는다.**

**넘기는 것**

- G4d-1b: R5 (괄호 임시표가 flat보다 짧다), B9 다시 재기.
- **M-H1 관찰 목록** (G4d-2):
  - 위 stem beam 묶음 첫 음에서 stem 옆에 붙는 운지;
  - czerny849/013의 7 sp 높은 slur 끝 하나;
  - system 넘김 뒤 짧은 반쪽 slur;
  - 갈고리처럼 보이는 두 음 slur;
  - 곡별 slur 관통 비율 (R6·R7).

## 36. G4d-1b 구현 기록 — system에 붙는 기호, 세로 배치, courtesy, 괄호 임시표

Implementer, 2026-09-26. 브랜치 `g4d1b-system-marks` (`D:/PPP-g4`), 시작 `747e45e` (= `origin/main`, G4d-1a 마감 뒤). 입력은 Lead의 G4d-1b 지시(roadmap §14 카드, §5.1 G4d 행, G4-L3)다. 병합하지 않았고 PR도 없다 (Lead가 리뷰와 PR을 정한다). 결정은 DECISIONS G4-D1b-1–16. 독립 리뷰(NEEDS_FIX, MAJOR 3)와 그 Fixer는 §36.18 (DECISIONS G4-D1b-17–24).

**한 줄**: EngravedScore가 system에 붙는 것을 그린다 — 가사, 셈여림과 hairpin(grand staff의 두 보표 사이, system마다 기준선 하나, hairpin은 수평이고 양끝 셈여림과 0.5 sp), pedal(sign 또는 line, change는 change로 — 뗌만으로 그리지 않음), ottava(걸친 음을 정확히 덮고, 머리는 적힌 높이, system 넘김은 "(8)"), 코드명, volta, tempo(말·메트로놈·괄호), rehearsal, jump, words — 모두 G4d-1a의 **하나의 배치 함수**(`skyline.js` `put()`)로 §10.2 순서 7–11에 따라 놓는다. §15.3 세로 배치는 이 기호들이 든 skyline으로 쌓고, 두 보표 사이의 줄은 남은 자리의 가운데로 옮긴다. §15.4 courtesy는 모든 system 끝에서 검사한다. G4d-1a 리뷰의 R5(괄호 임시표)를 닫고 B9를 다시 쟀다. **사용자에게 보이는 변화는 없다**: 앱 파일·`index.html`·`server.js`·`scoregraph/`는 바이트 그대로이고(`git diff 747e45e` 비어 있음) 앱은 새 모듈을 불러오지 않는다 (legacy parity 16/16).

### 36.1 범위 — §27 G4d와 G4-L3

§27 G4d 가운데 G4-L3이 G4d-1b에 둔 것: system에 붙는 기호(§10.2 순서 8–11: 셈여림·hairpin·pedal·ottava·volta·코드명·tempo·rehearsal·jump·words, 그리고 순서 7에서 1b로 넘어온 가사), §15.3 세로 배치, §15.4 줄 첫머리와 courtesy, B9 다시 재기, G4d-1a 리뷰의 R5. Node만이다. 하지 않은 것: 앱 통합(G4d-2), 인쇄(G4e), flip·재생(G4f), `scoregraph/` 변경, schema 변경, VexFlow 버전, G3 flag. G4d-1a의 규칙(G4-L4, G4-L5)은 건드리지 않았다 — 1b의 pass는 1a의 skyline 위에서 그 바깥에 선다.

§15.4는 G4c까지 이미 있던 것(courtesy key·time, 뒤따르는 작은 clef, 제자리표 취소, C·¢, hidden, C·옥타브 clef)을 확인하고, 빠져 있던 **system 끝의 검사**(metric)와 system이 실제로 나뉘는 fixture만 더했다.

### 36.2 모듈

| 파일 | 한 일 |
| --- | --- |
| `engrave/sysmarks.js` (새) | system 하나의 두 번째 배치 pass `placeSystem`: marks.js가 남긴 skyline 위에 §10.2 순서 7(가사) → 8(셈여림·hairpin·그 곁의 words) → 9(pedal) → 10(ottava → 코드명 → volta → tempo·rehearsal → 위쪽 jump·words) → 11(아래쪽 words·jump). 한 줄(row)은 **기준선 하나**: 줄의 항목마다 `put({probe})`로 혼자일 때의 자리를 묻고, 그 가운데 가장 바깥을 기준선으로 해 모두 `put({at})`으로 놓는다 (§10.4 S2). 가로로 만나면 §10.5: 셈여림은 한 줄 바깥, 코드명·tempo·jump·pedal 기호는 오른쪽으로 (system 끝을 넘으면 안으로 당김), 셈여림 곁의 words는 그 뒤로 (최대 4 sp, 넘으면 한 줄 바깥). 글자 폭은 `metrics-text.js`에서만 |
| `engrave/marks.js` | pass 끝에 skyline을 `S.sky`로 남김 |
| `engrave/skyline.js` | `put()`에 `probe`(자리만 묻고 더하지 않음)와 `at`(정한 기준선에 놓고 더함, FAR 진단 그대로); 충돌 검사 H5에 1b의 글자 종류 |
| `engrave/layout.js` | `prepare`: sysmarks의 입력(`P.sys`: 그려질 direction·hairpin·pedal·ottava·tempo·jump·가사, part의 staff, voice의 staff, 마디 시작·길이, ottava 아래 event 시각), **가사와 코드명의 폭을 기둥의 rod에**(§9: 가사는 hyphen 자리까지), R5 괄호 끝; `layout`: marks pass 다음 sysmarks pass, volta를 세로 쌓기에서 sysmarks로 옮김, 두 보표 사이 줄의 가운데 맞춤(`centreBands`, §36.8), 출력 필드 `wedge`·`ends`·`verse`·`group`, `coverage.pending` 비움; `VERSION` `engr/4` |
| `engrave/plan.js` | `PLAN_VERSION` `plan/3`: direction과 line마다 `part`(staff를 말하지 않는 코드명·pedal·words가 어느 part인지), 셈여림에 `more`(한 `<dynamics>`가 함께 적은 표시 — "p dolce", 그래프 `ext`에 있던 것) |
| `engrave/metrics.js`·`outlines.js` (생성) | glyph 10개 추가: `dynamicPiano/Mezzo/Forte/Rinforzando/Sforzando/Z`, `keyboardPedalPed/Up`, `segno`, `coda` (`make-metrics`·`make-outlines --check` 그대로); `dynamic(value)`, `PEDAL`, `JUMP_SIGN` 조회; `DRAWN`의 괄호는 폭만, 높이는 layout이 |
| `engrave/svg.js` | system에 붙는 기호마다 `g.ppp-<종류>[data-ref]`: hairpin 두 획, pedal 선(끝 갈고리 위로)과 change의 notch, ottava 점선(끝 갈고리는 실선), rehearsal 틀, volta 괄호와 그 번호(이제 따로 된 글자), 글자는 모두 `<text>`(페이지 family), glyph는 `<use>` |
| `engrave/index.js` | `version` `0.5.0-g4d1b`; 브라우저 로드 순서에 `sysmarks` (marks 다음, layout 앞) |

도구: `make-metrics.js`(glyph 이름), `make-e-fixtures.js`(§36.17), `bench.js`(ZERO·LOWER·MARKS), `browser-parity.js`(새 모듈). A29: `sysmarks.js`는 PURE 층 (테스트가 확인). 테스트: 새 `tests/engrave/sysmarks.test.js`(규칙별 fixture 검사와 음성 대조 24개), `layout-mutation.test.js`(§36.11), `l2.js`(§36.10).

### 36.3 셈여림·hairpin (§10.2 순서 8, §10.4 S2·S5; A8)

- **자리**: 그래프가 staff·placement를 주면 그것. 둘 다 없으면 여러 staff part(피아노 grand staff)는 **첫 두 보표 사이**(첫 보표 아래), 한 staff part는 아래 — 노래하는 part(악기 `voice`이거나 가사가 있는 part)는 위(가사를 비킴). part의 첫 보표가 아닌 보표의 위(예: 왼손 위)는 그 위 보표 아래와 같은 줄 — 두 보표 사이의 셈여림은 system마다 **한 기준선**.
- **모양**: SMuFL 글자 glyph(p m f r s z)를 2.5 sp em(glyph 척도 0.625)으로, 글자의 원점을 앞 글자의 오른쪽 끝에(고정 글꼴의 advance 값은 단위가 섞여 쓰지 않음) — f의 꼬리가 앞 글자 밑으로 든다. 음표머리 가운데에 맞춤. niente·말로 된 셈여림(`other`)은 serif-italic 1.4 sp 글자로 음 왼쪽에; 같은 `<dynamics>`가 함께 적은 표시(`more`, 코퍼스 10곳: "p dolce cantabile" 등)는 그 뒤에 0.35 sp 띄워.
- **한 줄에서 만나면**(§10.5): 셈여림은 한 줄 바깥 (E16 휴대폰의 sfz·ff). 같은 셈여림이 같은 곳에 두 번(두 보표가 다 적은 파일)이면 하나로 그리고 두 ID를 이름 댄다. cresc.·dim.·dolce처럼 셈여림 줄에 서는 words는 같은 기준선, 셈여림과 만나면 그 뒤로 밀림 ("p dolce").
- **hairpin**: 기준선 위 0.35 sp를 축으로 수평, 넓은 끝 1.1 sp, 두께 0.1. 시작은 그 시각의 셈여림(둘이면 둘 다) 오른쪽 0.5 sp, 없으면 그 음 왼쪽; 끝은 그 시각의 셈여림 왼쪽 0.5 sp, 없으면 멈추는 음(마디 끝이면 세로줄) 0.5 sp 앞; 시각이 조금 다른 셈여림이 끝에 붙어 있어도 0.5 sp 비킴(S5). system을 넘으면 조각마다(계속되는 crescendo는 0.5 sp 열린 데서, diminuendo는 0.5 sp로 닫히다 만 채로). 같은 hairpin이 두 번이면 하나. 파일이 겹치게 둔 두 hairpin(crescendo가 diminuendo 시작 뒤에 멈춤, sonatina/027)은 앞의 것을 뒤의 것 0.4 sp 앞에서 끝내고 `HAIRPIN_OVERLAP`을 남긴다 (짧아지면 뒤의 것을 한 줄 바깥으로).
- 코퍼스(데스크톱): 셈여림 1,126, hairpin 341, words 361 객체.

### 36.4 pedal (§10.2 순서 9; A9)

- 그 part의 **가장 낮은 staff 아래**, system의 모든 pedal이 **한 기준선** (S2).
- `mark`대로: sign(기본) — 누르는 음 왼쪽 0.3 sp에서 `keyboardPedalPed`, 떼는 곳 0.6 sp 앞에서 끝나는 `keyboardPedalUp`; line(`line: true`, 또는 sign이 없을 때) — 누르는 음에서 시작하는 선, 시작 갈고리(sign이 있으면 Ped. 뒤에서 갈고리 없이), 떼는 곳 0.3 sp 앞의 끝 갈고리(위로 1.0 sp), system을 넘으면 조각마다.
- **change는 change로**: sign이면 떼는 기호와 다시 누르는 기호를 둘 다 (그 음 바로 앞에 *, 그 음에서 Ped.), line이면 그 음에 폭 1.0·높이 1.0 sp의 notch — 앱이 MX1-D4대로 뗐다 다시 밟는 것과 같은 모양. **뗌만으로(* 하나) 그리지 않는다** (M19).
- 마디 시작의 뗌(`(m, 0)`)은 앞 마디의 세로줄에서 뗀다 — system 끝이면 그 system의 끝에서.
- 기호가 빽빽해 만나면 뒤의 것을 오른쪽으로 0.1 sp.

### 36.5 ottava (§10.2 순서 10; A10, D-1)

- 덮는 staff마다(파일이 staff를 말하지 않은 ottava는 plan의 `covers`대로 part의 **모든 staff** — 앱이 두 staff의 음을 옮기므로 두 staff에 괄호. MX-1 carry-over (c)의 "8va가 높은음자리표에만 괄호"는 새 렌더러에서 없다), 그 staff에서 시작 시각이 [from, to)인 event(음·쉼표)의 머리를 **정확히** 덮는다: 첫 머리 왼쪽 0.2 sp부터 마지막 머리 오른쪽 0.2 sp까지, 이 system 뒤에도 덮을 음이 있으면 system 끝까지 (끝 갈고리 없음).
- 8va·15ma는 staff 위(갈고리 아래로), 8vb·15mb는 아래(갈고리 위로). 레이블 "8va"/"8vb"/"15ma"/"15mb"(serif-italic 1.3 sp 글자, §36.12 1), 앞 system에 덮은 음이 있으면 "(8)"/"(15)" (§24 A10). 점선은 레이블 숫자의 가운데 높이.
- 머리는 **적힌 높이**: plan의 written = sounding − shift (D-1) 그대로 — layout은 바꾸지 않고, `eg.event.written_diff`가 그래프에서 따로 셈 (M20).
- 위쪽 줄에서 가장 안쪽(§10.2 순서 10). 코퍼스: ottava 레이블 70(데스크톱), "(8)" 이어짐 84(두 config, 14곡 — czerny849/006–024, sonatina/022).

### 36.6 위쪽·아래쪽 줄: 코드명, volta, tempo, rehearsal, jump, words (§10.2 순서 10–11; A8)

- **코드명**: sans 1.4 sp, 음 왼쪽에 맞춤, system 위 줄 하나. 철자는 앱의 `CHORD_KIND`(App 3849)와 같은 표(M7, m7♭5, sus4, /bass …); ♯·♭은 글꼴(Figtree)에 없어 SMuFL `accidentalSharp/Flat` glyph로. **폭은 기둥의 rod에** (그 시각의 기둥, 그 staff): 코드명이 서로 비키도록 간격이 넓어진다. 음이 시작하지 않는 시각의 코드명(E25 3마디)은 §10.5대로 (x, 그래프 순서)로 오른쪽으로 0.4 sp씩, system 끝을 넘으면 안으로 당김.
- **volta**: 윗 staff 위, 세로줄 안쪽 0.3 sp부터, 높이 1.8 sp, 시작하는 조각에 번호("1.", "1, 2." 또는 그래프 text, serif 1.3 sp — 이제 따로 된 글자 객체), 닫히는 곳에만 끝 갈고리. G4b는 세로 쌓기 때 놓았고, 이제 sysmarks에서 순서대로.
- **tempo**: 말(serif 1.6 sp) + 메트로놈(적힌 음가의 머리를 0.6배로, stem·flag·점, "= 120", 괄호면 "(" … ")"). 표시가 없고 plan이 `heading`으로 그리라는 첫 tempo(앱의 "♩ = N" 머리, G4a의 ledger `playback-tempo`)는 "♩ = N". 음 왼쪽에 맞춤. 코퍼스 tempo 객체 886 (데스크톱) — heading "♩ = N"의 조각은 그 가운데 81 (MIDI 가져오기 27곡, 파일의 tempo event에서, G4-F12), 805는 파일이 인쇄한 표시 (Fixer 정정, §36.18.5; 처음 기록은 "대부분 heading의 조각"). 파일이 메트로놈 둘레에 인쇄한 말("Molto Allegro (" … ")")은 Fixer부터 그 줄에 (§36.18.2).
- **rehearsal**: sans-bold 1.5 sp, 세로줄 x에서, 0.3 sp 틀.
- **jump**: segno·coda는 SMuFL glyph(2.4 sp em)를 세로줄 가운데에; 말(serif-italic 1.4 sp)은 그래프 text, 없으면 D.C., D.S., Fine, To Coda. 마디 끝에 선 것은 세로줄에 오른쪽 맞춤, 마디 시작은 세로줄 뒤, 그 밖은 음 왼쪽. 그래프의 placement가 below면 가장 낮은 staff 아래 (sonatina/012·015·017의 Fine).
- **words**: serif-italic 1.4 sp, 공백을 하나로. part의 첫 staff 위는 위쪽 줄의 바깥, 가장 낮은 staff 아래는 아래쪽 줄, 그 밖(오른손 아래, 왼손 위)은 셈여림 줄. 마디 끝의 words는 세로줄에 오른쪽 맞춤.
- **순서** (§10.2 순서 10, 안→밖): ottava → 코드명 → volta → tempo·rehearsal → 위쪽 jump·words. 각 줄은 앞 줄들이 든 skyline 바깥 — x가 겹치지 않으면 음 가까이.

### 36.7 가사 (§10.2 순서 7; A12, E24)

- 그 **voice의 staff 아래**, 절(verse)마다 system당 한 기준선, 음절은 그 음 머리의 가운데에. serif 1.3 sp. 음절 폭(과 이어지는 음절이면 hyphen 자리)은 기둥의 rod에 들어가서 만나지 않는다 (만나면 오른쪽으로).
- 단어 안의 음절 사이(begin·middle 뒤)에 hyphen(폭 0.6 sp)을 자리가 있으면. melisma 연장선(`extend`)은 그리지 않는다 (§36.20).

### 36.8 세로 배치 (§15.3; A25)와 courtesy (§15.4; A11)

- 세로 쌓기는 G4b 그대로(§33.7): 같은 part의 보표 사이 `max(5.0, 위 보표 아래 skyline + 아래 보표 위 skyline + 1.0)`, part 사이 6.0, system은 선 사이 6.0·띠 사이 1.5. 달라진 것은 skyline에 **1b의 기호가 든다**는 것 — 두 보표 사이의 셈여림 줄은 위 보표의 아래 skyline에 들어가 §15.3의 "사이 기호 단"이 된다 (system마다 값 하나).
- **가운데 맞춤** (G4-D1b-5): 쌓은 뒤, 두 보표 사이 줄(셈여림·hairpin·그 곁 words)을 함께 그 x들에서 위 보표가 내려온 곳과 아래 보표가 올라온 곳의 가운데로 — 위로는 옮기지 않고, 아래 보표 내용과는 1.0 sp를 지킨다. 간격 자체는 바뀌지 않는다. 그림에서 셈여림이 오른손에 붙지 않고 두 보표 사이 가운데에 선다.
- 새 검사: `eg.staff.gap_err`(간격이 최소보다 좁음, 또는 최소보다 넓은데 0.25 sp 칸을 함께 쓰는 두 내용이 1.0 sp로 맞닿는 곳이 없음), `eg.system.gap_err`(system의 선 사이 6.0·띠 사이 1.5, 둘 중 하나는 딱 맞음), `eg.skyline.vertical_collisions`(이웃 보표의 두 내용이 x로 겹치는데 1.0 sp보다 가까움 — 곡선은 표본을 0.1 sp 너그럽게).
- §15.4: `eg.courtesy.missing` — 다음 system 첫 마디가 조(hidden 아님)를 바꾸면 이 system 마지막 마디에 모든 staff의 courtesy 조표(새 조의 수 + 취소 제자리표 수), 박자(hidden 아님)를 바꾸면 courtesy 박자표, clef를 바꾸면(앞 clef와 다를 때) 그 clef가 세로줄 앞 작은 clef로. E19(clef, 5마디에서 system 넘김), E20(조, 5마디), E21(박자, 3·5마디)을 system이 실제로 나뉘도록 늘렸다. 기존의 `eg.layout.signature_diff`는 system 안만 본다.

### 36.9 G4d-1a 리뷰 R5 — 괄호 임시표, 그리고 B9

- **R5**: `[ ]`를 둘러싼 임시표의 상자에 맞춘다 — 위·아래로 0.15 sp 넘게, 그 끝이 보표선 0.2 sp 안이면 선에서 0.25 sp 밖으로 (`bracketEnds`). E32의 가운데 줄 B♭: 전에는 2 sp로 ♭보다 짧고 끝이 두 선에 닿아 "|♭|"로 읽혔다; 이제 ♭보다 크고 끝이 칸에 (`tests/engrave/out/png/g4d1b/e-E32-accidentals-cautionary.desktop.png`). 임시표 열의 세로 범위도 괄호 끝까지. 새 영목표 `eg.accidental.bracket_err`, mutation BR.
- **B9** (sonatina/020 전곡 SVG / §19.1 legacy): **0.32** ≤ 0.5 — burgmuller25/021 0.22, czerny849/001 0.27, sonatina/013 0.24, /016 0.31, /020 0.32 (G4d-1a 0.31). `svg.test.js`가 CI에서 같은 비교.

### 36.10 Metric (`tests/engrave/l2.js`; G4-D1b-12)

`engrave/sysmarks.js`를 읽지 않는 자기 기하로 G04의 글을 다시 적었다 (G4-D1b가 정한 크기·간격은 l2에 다시 적음). 모두 `bench.js` ZERO와 `layout.test.js` ZERO_L2 (E 40 + 코퍼스 347 + golden 17 = 404곡 × 두 config가 0이어야 통과); baseline r·e·x는 **키만 더했다** (§36.15).

| metric | 뜻 | 이름 (G04) |
| --- | --- | --- |
| `eg.mark.missing.<kind>` (dynamic, wedge, pedal, pedal-change, ottava, ending, chord, tempo, rehearsal, jump, words, lyric) | ledger가 drawn이고 그 마디가 그려졌는데 **그 종류의 객체**가 그 ref를 이름 대지 않음 (volta 번호만은 volta가 아님); pedal change는 change의 모양이어야 (sign: * 하나와 Ped. 하나, line: notch) | `eg.mark.drawn_ratio.*` (bench가 layout 기준으로) |
| `eg.dynamic.side_err` | §36.3의 자리 규칙 (사이면 두 보표 사이, 위면 보표 위) | §10.2 순서 8 |
| `eg.row.baseline_err` | S2: system·staff·쪽마다 셈여림(과 hairpin 축 + 0.35)의 기준선 하나 — 바깥 줄은 안쪽 줄의 무엇과 만나서만; pedal·코드명·ottava 레이블·가사(절마다)는 하나 | §10.4 S2 |
| `eg.hairpin.level_err`, `shape_err`, `clear_err` | 수평; crescendo는 열리고 diminuendo는 닫히며 한 조각이면 끝이 0; 같은 줄의 셈여림과 0.5 sp | S5 |
| `eg.pedal.errors`, `eg.pedal.change_err` | 가장 낮은 staff 아래; 누르는 곳(Ped. 또는 시작 갈고리)·떼는 곳(* 또는 끝 갈고리); change는 제 음에서 (sign이면 * 뒤 Ped., line이면 notch 꼭짓점) | A9 |
| `eg.ottava.extent_err`, `eg.ottava.label_err` | 덮는 머리를 전부 덮고 다른 머리는 덮지 않음, 이어지면 system 끝까지; 레이블(첫 system 8va…, 뒤 "(8)"), 쪽, 닫히는 곳의 갈고리 | A10 |
| `eg.event.written_diff` | 그려진 머리의 (head, event, 마디, 적힌 staff 자리) 다중집합 = **그래프**의 울리는 음 − 그 위 ottava shift(이조 악기면 적힌 음) — plan의 `written`을 읽지 않음 | §21.1 `eg.event.multiset_equal`(적힌 음), M20 |
| `eg.volta.extent_err` | system마다 제 마디 위 세로줄 안 0.3 sp, 시작·닫힘, 번호 | A8 |
| `eg.chord.order_err` | 제 음 왼쪽보다 앞(끝에서 당긴 것 제외), (시각, 그래프 순서)로 0.4 sp씩 | §10.5 |
| `eg.lyric.staff_err`, `eg.lyric.place_err` | voice의 staff 아래; 음 가운데(밀린 것은 앞 음절 뒤 0.2 sp), 자리가 있는 단어 안 hyphen | A12 |
| `eg.row.order_err` | 한 staff 위에서 x가 겹치는 ottava < 코드명 < volta < tempo·rehearsal (안→밖) | §10.2 순서 10 |
| `eg.text.content_err` | 셈여림 글자(glyph 순서)·words·코드명(앱의 철자)·tempo(말, "= N", 괄호, 음가의 머리)·jump·가사가 그래프가 말하는 것 | A8, A12 |
| `eg.staff.gap_err`, `eg.system.gap_err`, `eg.skyline.vertical_collisions` | §36.8 | §15.3, A25 |
| `eg.courtesy.missing` | §36.8 | §15.4, A11 |
| `eg.accidental.bracket_err` | §36.9 | R5 |

기존 metric의 확장: `eg.overlap.text`·`text_text`·`mark_mark`·`mark_note`에 1b의 글자·선 종류 (한 기호의 조각 — 셈여림의 글자들, 코드명의 조각, tempo의 말과 음, rehearsal과 틀, volta와 번호 — 은 `group`으로 제외) = **A20 전체**; `eg.text.width_err`의 허용은 size의 0.01 반올림만큼(em당 0.005 sp); FAR는 1b의 줄을 한 항목(조각의 합)으로 재고, 두 보표 사이면 가까운 보표에서; `eg.layout.far_placements`(1a의 기호: r 16, 코퍼스 35 — E fixture 둘을 더해 808 layout에서 37 — 모두 그대로; Fixer 정정, §36.18.5)와 **새 기록 키** `eg.layout.far_placements_system`(1b의 줄, LOWER; r 23, e 0, x 0 — Fixer 뒤 r 8, 코퍼스 63 → 28, §36.18.2) — 높은 음 위의 바깥 줄은 8 sp를 넘을 수 있고 모두 진단된다 (`far_undiagnosed` 0).

`skyline.collisions`(layout의 자기 검사, `HARD_VIOLATION`)의 H5에 1b의 글자 종류; 코퍼스 0.

### 36.11 Mutation (`tests/engrave/layout-mutation.test.js`)

G4b–G4d-1a의 틀 그대로 (CRLF 사본, anchor 정확히 한 번, 출력이 바뀌어야 함, 이름 붙은 metric이 잡아야 하고 그 metric은 같은 probe에서 원래 0). 새 probe: E16, E17, E18, E20, E22, E24, E25, E35, E37(아래), 합성 `upper`(한 마디 위에 8va·코드명·volta·tempo). 새 22개가 모두 살아 있고 이름으로 잡힌다; G4b–G4d-1a의 63개는 그대로 (M8의 anchor만 `put()`의 새 들여쓰기로), N1·N2 바이트 동일. 실행 약 45 s (`npm run test:engrave` 안).

| # | 심은 결함 (파일) | 잡은 이름 (probe × 두 config 합) |
| --- | --- | --- |
| M13 | 셈여림 줄을 음표머리 높이로 (pad −4, `sysmarks.js`) | `eg.overlap.text` 24 |
| M19 | pedal change를 뗌만으로 (* 뒤의 Ped. 없음) | `eg.mark.missing.pedal-change` 2, `eg.pedal.change_err` 2 (E37) |
| M20 | 8va 아래 머리를 울리는 높이에 (`plan.js`) | `eg.event.written_diff` 44 (E18) |
| DB | S2 없앰: 줄의 항목마다 혼자의 자리 | `eg.row.baseline_err` 12 |
| HT | hairpin이 셈여림에 0.25 sp (S5의 0.5 아님) | `eg.hairpin.clear_err` 6 |
| HL | hairpin 기울임 | `eg.hairpin.level_err` 7 |
| HS | crescendo·diminuendo 뒤바꿈 | `eg.hairpin.shape_err` 7 |
| DS | staff 없는 셈여림을 part의 가장 낮은 staff 아래로 (사이가 아님) | `eg.dynamic.side_err` 2 (E35) |
| SG | grand staff 간격 5.0 → 4.0 (`layout.js`) | `eg.staff.gap_err` 5 |
| YS | system 간격 6.0 → 4.0 | `eg.system.gap_err` 4 |
| VC | 보표 내용 사이 1.0 → 0.3 sp | `eg.skyline.vertical_collisions` 90 |
| CK | courtesy 조표를 안 그림 | `eg.courtesy.missing` 4 (E20) |
| VE | volta가 한 마디 더 | `eg.volta.extent_err` 3 (E22) |
| CP | 코드명을 제 음 왼쪽으로 | `eg.chord.order_err` 30 (E25) |
| OS | ottava가 마지막 음 하나 모자람 | `eg.ottava.extent_err` 10 (E18) |
| OL | 이어지는 ottava를 "(8)" 대신 "8va" | `eg.ottava.label_err` 2 (E37) |
| PE | *를 누르는 곳에 | `eg.pedal.errors` 4 (E17, E37) |
| LW | 가사를 system의 가장 낮은 staff 아래로 | `eg.lyric.staff_err` 6 (E35) |
| LP | 음절을 음 가운데에서 시작 (가운데 맞춤 아님) | `eg.lyric.place_err` 24 (E24) |
| RO | 코드명 줄을 ottava 줄보다 먼저 (안쪽으로) | `eg.row.order_err` 4 (upper) |
| TC | 코드 종류 철자 (M7 → maj7) | `eg.text.content_err` 4 (E25) |
| BR | R5 되돌림: 괄호 2 sp 고정 | `eg.accidental.bracket_err` 4 (E32) |

`sysmarks.test.js`의 음성 대조 24개(실제 layout을 망가뜨림)도 새 metric 23개가 제 결함을 찾음을 보인다.

### 36.12 설계 문서와 달라진 곳

1. **§18.2 8va·15ma glyph**: 고정 Bravura(VexFlow 4.2.3)에 ottava glyph가 없다 — 레이블은 serif-italic 글자("8va", "(8)"). 대체 glyph + `MISSING_GLYPH`로 두지 않았다 (코퍼스에서 0이어야 하므로; G4-D1b-3).
2. **§18.3 크기**: 셈여림 2.5 sp는 SMuFL glyph의 em(척도 0.625); 표가 적지 않은 것은 G4-D1b-3(words 1.4, tempo 1.6, 메트로놈 음 0.6배, rehearsal 1.5, jump 1.4, segno·coda 2.4, ottava·volta 1.3, pedal glyph 2.5). 코드명의 ♯♭는 페이지 글꼴에 없어 glyph.
3. **§15.3 가운데 맞춤**을 더함 (G4-D1b-5): 공식은 그대로, 두 보표 사이 줄의 자리만.
4. **§10.5 코드명**: "오른쪽으로 민다"에 더해 **폭을 간격에 넣는다**(G4-D1b-8) — 밀기만으로는 휴대폰의 빽빽한 코드명(E25)이 페이지 밖으로 나갔다 (H4). 밀기는 기둥이 없는 시각의 코드명에 남고, system 끝을 넘으면 안으로 당긴다 (앱의 규칙).
5. **fixture**: E17·E18은 MX-1의 재생 테스트(`tests/scoregraph/app-playback.test.js`, 브라우저 suite `engraving`·`follow`·`playback-scheduler`)가 음·pedal 하나하나를 고정하므로 **그대로 두고**, system 넘김의 pedal·8va는 E37(긴 곡)에 넣었다 (G4-D1b-14). §22.1의 40개는 그대로.
6. **§10.2 순서 10의 jump·words**: 표가 순서를 적지 않아 tempo·rehearsal 바깥에 (G4-D1b-9).

### 36.13 Acceptance

| # | 기준 | 증거 | 판정 |
| --- | --- | --- | --- |
| A8 | 셈여림, hairpin, words, rehearsal, tempo(말·메트로놈·괄호), 코드명, jump가 그래프 위치에 | `eg.mark.missing.*` 0, bench `eg.mark.drawn_ratio.{dynamic, wedge, words, rehearsal, tempo, chord, jump, ending}` 1 (layout 기준), side·S2·S5·volta·chord·order·content 0; E16, E22, E25, E35 (`sysmarks.test.js`); M13, DB, HT, HL, HS, DS, VE, CP, RO, TC; Fixer (§36.18): `eg.mark.anchor_err`, `eg.hairpin.extent_err`, `eg.tempo.split_err`, `eg.words.push_err`, `eg.row.centre_err` 0, mutation TW, R-DX, R-WX, R-TX, R-RX, R-JX, R-HE, R-HS0, R-HB, R-WP, R-CB, R-CB2 | PASS |
| A9 | pedal 시작·끝·change가 `mark`대로, change가 뗌으로 보이지 않음 | `eg.pedal.errors`·`change_err`·`mark.missing.pedal(-change)` 0, drawn_ratio 1; E17(sign, line + change, 녹음 모양), E37(sign change, system 넘는 line + change), E38; M19, PE | PASS |
| A10 | ottava가 걸친 event를 정확히, 머리는 적힌 높이, 15ma, system 넘김 "(8)" | `eg.ottava.extent_err`·`label_err`·`event.written_diff`·`layout.pitch_y_err` 0; E18(8va·8vb·15ma, staff 없는 8va가 두 staff에), E37("(8)"), 코퍼스 "(8)" 84; M20, OS, OL; L3 re-bless | PASS |
| A12 (가사) | 가사 기본 | `eg.lyric.staff_err`·`place_err`·`mark.missing.lyric` 0; E24(두 절, hyphen), E35(voice + piano), burgmuller25/013; LW, LP | PASS |
| A20 (전체) | 글자 대 음·글자, 기호끼리 | `eg.overlap.text`·`text_text`·`mark_mark`·`mark_note` 0 (1a와 1b의 모든 글자·선), `HARD_VIOLATION` 0; M8, M13 | PASS |
| A25 | staff·system 겹침 0, 세로 skyline 충돌 0 | `eg.staff.overlap`·`system.overlap`·`skyline.vertical_collisions`·`staff.gap_err`·`system.gap_err` 0; SG, YS, VC | PASS |
| A11 (courtesy) | key·meter courtesy, clef 변경, C·¢, hidden | `eg.courtesy.missing`·`signature_diff` 0; E19–E21이 system을 나눔; CK | PASS |
| E16–E22, E24, E25, E35 (+ E37, E32) | fixture | `sysmarks.test.js`(두 폭), `e-fixtures.test.js` | PASS |
| R·X L1/L2 | 영목표 0 | `bench.js check` r·e·x PASS (Windows, Linux) | PASS |
| A2–A7, A14, A17–A19, A21–A24, A26 | G4b–G4d-1a | ZERO_L2 전부 0 (404곡 × 2), 기울기 최대 0.25, slur hit 1 (진단됨) | PASS |
| A27 | Windows = Linux, 3회·역순 | layout hash 118 × 2 다시 bless (§36.16), Docker `node:24-bookworm` LF clone에서 같음 | PASS |
| A28 | Node = Chrome | Chrome 153: layout 808/808, SVG 808/808 바이트 동일, 네트워크 0 | PASS |
| A29 | DOM 측정 0 | A29 검사 (`sysmarks.js` PURE), 글자 폭은 표만 | PASS |
| B1–B7, B9 | §19.2 | §36.14 | PASS (B5는 G4f 판정) |
| 버전 규칙 | 출력이 바뀌면 올림 | `plan/3`, `engr/4`; `layout-hashes.js --write` 음성 대조: engr/3로 되돌리면 "REFUSED: 236 layout hashes …", plan/2로 되돌리면 "REFUSED: 49 plans …" (리뷰가 같은 commit에서 다시 돌린 수; 처음 기록의 48은 틀림, §36.18.5), 아무것도 안 씀 | PASS |

### 36.14 성능 (이 PC, Node 24.17, `layout-perf.js` 5회 중앙값, ms)

| 곡 | event | 마디 | plan | prepare | layout 데스크톱 | 휴대폰 | SVG | 연습 map | system | 객체 | SVG KB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| beyer/028 | 95 | 16 | 1.00 | 0.61 | 0.73 | 0.77 | 0.72 | 0.18 | 4 | 255 | 35.1 |
| hymns/take-my-life | 136 | 16 | 1.11 | 0.91 | 1.34 | 1.22 | 0.69 | 0.23 | 4 | 393 | 52.6 |
| burgmuller25/021 | 468 | 33 | 5.02 | 3.38 | 7.87 | 9.94 | 2.59 | 0.61 | 9 | 1,324 | 178.5 |
| czerny849/001 | 548 | 32 | 6.10 | 3.63 | 8.09 | 8.85 | 3.01 | 0.72 | 9 | 1,605 | 192.3 |
| sonatina/013 | 1,354 | 86 | 16.28 | 13.05 | 25.82 | 22.50 | 7.46 | 1.73 | 24 | 4,405 | 513.6 |
| sonatina/016 | 1,494 | 92 | 15.26 | 13.51 | 25.50 | 26.37 | 8.85 | 2.15 | 25 | 5,182 | 592.6 |
| sonatina/020 | 1,563 | 158 | 21.43 | 18.92 | 38.40 | 39.70 | 11.43 | 3.52 | 40 | 5,840 | 689.3 |

코퍼스 347: plan 중앙 1.38, 최대 19.64; prepare + layout 중앙 3.11, p95 22.44, 최대 45.09. 예산: **B1** 16.97 ≤ 60; **B2** 4마디 창 layout + SVG p95 3.13 ≤ 25; **B3** 0.02 ≤ 8; **B4** 전곡 prepare + layout + SVG 최대 68.75 ≤ 100 (sonatina/020); **B6** p95 < 0.01 (최대 1.65), 만진 수 = 바뀐 수; **B7** 0; **B9** 0.32 ≤ 0.5 — 모두 PASS. **B5**(G4f 판정): sonatina/020 전곡 68.75 ms ≤ 300, 가장 긴 호출 38.4 ms (조각 12 ms는 G4f의 시간 나누기). G4d-1a 대비 sonatina/020 layout 30.7 → 38.4 ms (sysmarks pass와 가운데 맞춤), SVG 10.8 → 11.4 ms. Chrome 153(`browser-parity.js`) sonatina/020: 1× plan 11.1, prepare 8.8, layout 21.0, 전체 29.8; 4× CPU 59.0 / 51.4 / 116.5 / 167.9 — 한 호출이 50 ms를 넘는 것은 G4b–G4d-1a와 같이 G4f의 idle·worker 나누기 몫이다.

### 36.15 회귀 (코드 커밋 `17a38f3`)

| 검사 | Windows (`D:/PPP-g4`, Node v24.17.0) | Linux (Docker `node:24-bookworm`, Node v24.21.0; `17a38f3`의 `core.autocrlf=false` clone, LF 파일) |
| --- | --- | --- |
| `npm run test:engrave` | **174/174** (163 + `sysmarks.test.js` 11; 새 mutation 22는 기존 테스트 안) | **174/174** |
| `npm run test:scoregraph` | **214/214** | **214/214** |
| `layout-hashes.js` | 118 × 2 layout + 118 plan 전부 커밋된 hash (다시 bless, §36.16) | 같음 |
| `make-metrics`·`make-outlines`·`make-e-fixtures`·`make-corpus --check` | PASS | PASS |
| `make-text-metrics.js --check` | PASS (캐시로 다시 만들기까지) | PASS (글꼴 캐시 없음: 형식·digest) |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS (61 / 40 / 76 graph) | PASS / PASS / PASS |
| baseline r·e·x (`bench.js baseline` 뒤 git diff) | 지운 줄 0 — 새 키 (영목표 0, 비율 1, 기록 `eg.layout.far_placements_system` r 23·e 0·x 0); 바뀐 값 하나: e `eg.beam.derived` 6 → 7 (기록, E24에 더한 두 8분음표의 파생 beam) | — |
| G0 부분 (`run.py sg-roundtrip`, `golden`, `run`+`check --suite smoke`, `core`) | sg-roundtrip L1+ 367/369 (허용 2, 그대로), golden 17/17, smoke SQI 86.907 PASS, core 553 case SQI 76.862 PASS. 1b는 G0 경로를 건드리지 않는다 | — |
| `browser-parity.js` (A28) | Chrome 153: layout 808/808, SVG 808/808 바이트 동일, E14 `<use>` 18 오차 ≤ 0.01 sp, 네트워크 0 | — |
| legacy parity (`legacy-parity.js`; `747e45e`의 `git archive`를 8801에, 이 트리를 8802에, `NODE_ENV=production HOST=127.0.0.1`) | **16/16 바이트 동일**; 8802의 `engrave/index.js`는 `0.5.0-g4d1b`, 8801은 `0.4.0-g4d1a` — 측정 뒤 두 서버를 껐다; 8777·8788은 건드리지 않음 | — |
| `layout-perf.js` | 판정하는 예산 전부 PASS (§36.14) | — |
| 앱 파일 | `Piano Coach App.dc.html`·`index.html`·`server.js`·`scoregraph/` 바이트 그대로 (`git diff 747e45e` 비어 있음) | — |

### 36.16 커밋된 layout hash 다시 bless — 분류 (§21.3)

`tests/engrave/tools/layout-diff.js --base=<747e45e의 engrave/·scoregraph/>` (두 트리 모두 오늘의 fixture를 배치): 118곡 × 두 config = 236쌍, **전부 바뀜** (버전 이름 `engr/4`, planKey의 `plan/3`).

| 분류 | 수 | 무엇 — 이유 |
| --- | --- | --- |
| SERIALIZATION_ONLY `(version)` | 64 | 버전 이름만 — system에 붙는 기호가 없는 곡 |
| GEOMETRY_ONLY | 2 | E32 × 2: 괄호 임시표의 괄호가 임시표 높이로 (R5) |
| LEDGER_CHANGE | 170 | 새로 그린 것 (종류별 쌍 수): tempo 152 (76곡 × 2 — 모두 파일이 인쇄한 표시: 이 118곡에 heading "♩ = N"은 없다, heading은 코퍼스의 MIDI 가져오기 27곡에만 선다 (G4-F12); Fixer 정정, §36.18.5 — 처음 기록은 "대부분 heading"), words 66, 셈여림 56, hairpin 34, ottava·ottava-line 16, pedal·pedal-line 10, pedal-change 6, volta 번호 10 (따로 된 글자가 됨), 가사 4·hyphen 2, 코드명 4, jump 4, rehearsal·틀 2 |

LEDGER_CHANGE 170쌍 가운데 이미 있던 객체가 **x로 움직인 것은 6쌍**(E24·E25·E35의 두 config: 가사·코드명의 폭이 간격에 들어감; E25 휴대폰은 1 → 3 system), **세로로만 움직인 것은 158쌍**(새 줄 — 위쪽 tempo 줄, 두 보표 사이 셈여림 줄과 그 가운데 맞춤, pedal 줄 — 이 staff·system 간격을 바꿈), 그대로인 것 6쌍 (이 세는 도구는 scratch의 `audit.js`, 커밋 안 함). plan 출력은 같은 입력(`ee87449`의 fixture)을 `747e45e`와 `17a38f3`의 `plan()`에 넣고 버전 이름을 빼고 비교하면 **45/118곡**에서 바뀌었고 (모두 `part`·`more`), 버전 guard가 보는 것(각 commit이 제 fixture로 만든 plan)으로는 **49** (= 45 + 파일만 바뀐 fixture 넷); 나머지는 버전 이름만 (Fixer 정정, §36.18.5 — 처음 기록의 "48"은 어느 셈으로도 다시 나오지 않는다). L1은 나빠지지 않았고 (baseline은 키를 더함) L2 영목표는 전부 0. **bless 이유**: G4d-1b가 system에 붙는 기호를 그리고, 세로 배치에 넣고, R5를 고치고, 버전을 올렸기 때문 (G4-D1a-1) — 그 밖의 이유로 바뀐 쌍은 없다.

### 36.17 Fixture

`make-e-fixtures.js --check` PASS, 40개 그대로. 바꾼 아홉: **E16** 8마디 — 다섯 마디 diminuendo가 모든 폭에서 system을 넘음, cresc., 위 보표 위 mf·아래 보표 아래 p, 16분음표 간격의 sfz·ff, "p dolce"; **E19** 6마디 — 5마디에서 높은음자리표로 돌아옴 (system 넘김); **E20** 6마디 — 조 변경이 5마디 (system 넘김); **E21** 8마디 — cut time이 5마디, hidden이 7마디; **E22** — "Allegro (♩ = 120)", rehearsal "A"; **E24** 2마디 — 두 절, 두 음에 걸친 단어; **E25** 3마디 — 8분음표마다 긴 코드명(CM7, F♯m7♭5, B♭7/D …), 음이 없는 시각의 코드명; **E35** — voice의 placement 없는 mf와 코드명, piano의 staff 없는 p; **E37** — bar 3 sign pedal change, bar 7–10 8va, bar 11–14 line pedal (bar 13 change) — 모든 폭에서 system을 넘음. **E17·E18은 그대로** (§36.12 5). `e-fixtures.test.js`가 새 내용을 확인한다.

### 36.18 리뷰와 Fixer (2026-09-26)

입력: G4d-1b 독립 리뷰 (read-only, 대상 `ee87449`; 증거는 리뷰 scratchpad `g4d1b-review/`의 스크립트·`logs/`·`png/`)의 판정 **NEEDS_FIX — BLOCKER 0, MAJOR 3, MINOR 3**. 리뷰가 확인한 것: 지어낸 기보 없음 (그려진 메트로놈 표시는 모두 원본에 인쇄되어 있다), 약해진 gate 없음, re-bless는 정직함, A9·A10 성립, Windows = Linux = Chrome, legacy parity 16/16. Lead의 Fixer 지시: MAJOR R1–R3과 기록 오류(M1)를 고치고 그 밖은 손대지 않는다 (M2는 R1에서 저절로 나올 때만). 같은 worktree `D:/PPP-g4`, 브랜치 `g4d1b-system-marks`, 시작 `ee87449`. 리뷰의 하네스는 생각만 빌렸고 (변이의 anchor, WMW 셈), 커밋한 metric·fixture·mutation은 새로 썼다. `scoregraph/`·plan·앱 파일·`index.html`·`server.js`는 바이트 그대로 (`git diff 747e45e`의 앱 쪽 비어 있음; plan 출력 불변이라 `plan/3` 그대로). 결정은 DECISIONS G4-D1b-17–24. (이 절의 번호는 Lead 지시대로 §36.18이고, implementer의 PNG·남은 것은 §36.19·§36.20으로 번호만 옮겼다.)

"지금"의 수는 모두 E 40 + 코퍼스 347 + golden 17 = 404곡 × 두 config = 808 layout (따로 적지 않으면), "`ee87449`"의 수는 `ee87449`의 `engrave/`로 **오늘의 입력**을 배치해 오늘의 `l2.js`로 잰 것이다.

#### 36.18.1 지적과 처리

| # | 지적 (리뷰) | 처리 | 어디 |
| --- | --- | --- | --- |
| R1 (MAJOR) | 메트로놈 표시 둘레의 tempo 말이 다른 줄로 갈라지고 빈 "( )"가 남음: 파일은 "Molto Allegro (", 메트로놈, ")"를 한 direction으로 인쇄하는데 (importer는 앞 말 하나만 tempo text로 접는다, `musicxml-import.js:737`) `sysmarks.js`가 말을 바깥 words 줄로, 메트로놈을 tempo 줄로 보냄 — 카탈로그 20곡(czerny849 19, hanon/001), R suite 8곡; 이 말이 system 줄 FAR 63 가운데 38 | **FIXED** — 말은 tempo 줄에서 메트로놈 앞·뒤로; 영목표 `eg.tempo.split_err`; E22에 두 모양; mutation TW | §36.18.2 |
| R2 (MAJOR) | A8의 "그래프 위치"를 layout hash만 지킴: `eg.mark.missing.*`는 그 종류의 객체가 ref를 이름 대는지만 보고 (hairpin의 첫 조각이 모든 system을 채움), hairpin 검사는 수평·모양·간격만 봄; 리뷰의 변이 여덟(R-DX, R-WX, R-TX, R-RX, R-JX, R-HE, R-HS0, R-HB)이 출력을 바꾸는데 영목표 metric은 하나도 안 움직임 | **FIXED** — `eg.mark.anchor_err`, `eg.hairpin.extent_err`; 여덟 변이가 이름으로 잡힘 | §36.18.3 |
| R3 (MAJOR) | 이름 붙은 metric이 없는 새 규칙 둘: G4-D1b-5 사이 줄의 가운데 맞춤 (R-CB `void centreBands`가 40여 layout을 바꾸고 metric 0), G4-D1b-4 셈여림 곁 words는 그 뒤로 최대 4 sp (R-WP `PUSH_MAX = -1`이 burgmuller25/013·015, czerny849/005·018을 바꾸고 metric 0) | **FIXED** — `eg.row.centre_err`, `eg.words.push_err`; mutation R-CB, R-CB2, R-WP; "최대 4 sp"를 코드도 지키게 (출력 변화 0) | §36.18.4 |
| M1 (MINOR) | 기록 오류: tempo 152쌍이 "대부분 heading ♩ = N", plan 48곡, `far_placements` 37 | **FIXED** (문서) | §36.18.5 |
| M2 (MINOR) | 따로 된 direction의 tempo 말이 메트로놈 위에 쌓임 (czerny599/054 "Moderato" over "♩ = 100") | R1에서 저절로 나오지 않음 → **M-H1 watch list** | §36.18.8 |
| M3 (MINOR) | Chrome 4× CPU에서 한 호출이 50 ms를 넘음 | **G4f** (손대지 않음) | §36.18.8 |

#### 36.18.2 R1 — 메트로놈 둘레의 말은 그 줄에 (`engrave/sysmarks.js`; G4-D1b-17, 18)

- **원인**: 원본의 한 direction `<words>Molto Allegro ( </words><metronome>…</metronome><words> )</words>`에서 importer는 메트로놈 앞의 말이 **하나**일 때만 그것을 tempo의 text로 접는다; 말이 둘이면 둘 다 그 자리의 words로 남는다 (`scoregraph/`는 이 goal 밖). layout은 그 words를 위쪽 줄 바깥(jump·words 줄)에 따로, 메트로놈을 tempo 줄에 그렸다: "Molto Allegro ( )" 위에 "𝅗𝅥 = 100". 코퍼스 20곡이 모두 이 모양(WMW)이다: czerny849/001·002·005–008·011–014·016–024의 "… ( " M " )", hanon/001의 "(M.M. " M " to 108.)".
- **규칙** (G4-D1b-17): 메트로놈 표시가 있는 tempo의 **part**(그래프 `display`의 part, 없으면 첫 part)에 속하고 그 tempo와 **같은 (m, at)**에 선, placement가 below가 아닌 words 가운데 **괄호가 맞지 않는 것**은 tempo의 줄이다 — 여는 괄호가 남는 것은 메트로놈 앞, 닫는 괄호가 남는 것은 그 뒤, 각각 그래프 순서로. 앞의 말은 그것이 여는 괄호 앞까지 tempo의 글꼴(serif 1.6), 그 괄호부터 메트로놈의 글꼴(serif 1.4)로 — 괄호로 끝나면 음표에 붙여; 뒤의 말은 메트로놈의 글꼴로 — ")"로 시작하면 숫자에 붙여. 그래서 czerny849/002는 E22의 `parens`와 같은 모양 "Molto Allegro (𝅗𝅥 = 100)", hanon/001은 "(M.M. ♩ = 60 to 108.)" 한 줄이다. 텍스트 규칙("(로 끝남"/")로 시작")만으로는 hanon의 "(M.M. "·" to 108.)"을 못 잡아 괄호의 짝으로 정했다.
- **객체**: 말의 조각은 `words` 객체 — id는 그 말의 그래프 ID(조각이 둘이면 `ID#0`, `ID#1`), refs는 그 말, `group`은 tempo ID(한 기호: A20의 겹침에서 서로 빠짐). 그래서 `eg.mark.missing.words`는 그대로 성립하고, `eg.text.content_err`는 words의 조각을 왼쪽부터 공백으로 이어 읽는다 (l2 한 줄 고침). DOM은 `g.ppp-words[data-ref]` 그대로.
- **새 영목표 `eg.tempo.split_err`** (`l2.js`, 규칙을 다시 적음): 위 규칙의 말마다 그려진 조각이 tempo의 "= N"과 같은 system·staff·기준선(0.05 sp)에 있고, 여는 말은 메트로놈 음표 머리 앞에서 끝나고 닫는 말은 "= N" 뒤에서 시작; 그리고 어느 글자 줄에서도 빈 "( )" — "("로 끝나는 조각 다음 조각이 ")"로 시작하고 그 사이에 그려진 것이 없음, 또는 "( )"를 담은 글자 — 가 없음.

| | `ee87449` | 지금 | mutation |
| --- | --- | --- | --- |
| `eg.tempo.split_err` (808 layout) | **118** — 20곡 40 layout (czerny849 layout마다 3: 두 말이 다른 줄 + 빈 "( )"; hanon/001 2) | 0 | TW (16) |
| 그 가운데 R suite (czerny849/002·005·007·018·020·022·023, hanon/001 × 두 config) | **46** | 0 | — |
| system 줄 FAR (`eg.layout.far_placements_system`, 기록) | 코퍼스 63, r 23 | 코퍼스 28, r 8 | — |

- **fixture E22** (40개 그대로): 5마디 "Più mosso (" + ♩ = 132 + ")" (Czerny의 모양), 6마디 "(M.M. " + ♩ = 60 + " to 72.)" (Hanon의 모양) — 한 direction씩, `make-e-fixtures.js`의 `tempoAround`. `e-fixtures.test.js`가 plan의 tempo 셋과 words 다섯을, `sysmarks.test.js`가 두 폭에서 "Più mosso ( ♩ = 132 )"·"(M.M. ♩ = 60 to 72.)"가 한 기준선의 한 줄이고 말이 제 ID를 이름 댐을 고정한다.
- **mutation TW**: 괄호 짝을 늘 0으로 (말을 words 줄로 되돌림, 곧 `ee87449`) → `eg.tempo.split_err` 16 (E22, czerny849/005).
- **본 것**: czerny849/002, hanon/001 전후 (§36.18.7).
- **M2** (G4-D1b-18): 파일이 **따로 된 direction**으로 적은 tempo 말(czerny599/054 "Moderato" 위, "♩ = 100" 아래)은 합치지 않았다. 규칙이 저절로 넓어지지 않는다: 코퍼스에서 메트로놈만 있는 tempo와 같은 자리에 괄호 없는 words 하나가 따로 선 곳이 54이고, 그 가운데 czerny599/038 "dolce"처럼 tempo 말이 아닌 것도 있다 — 어느 것이 tempo 말인지는 글자 목록이나 원본의 좌표가 있어야 정할 수 있다. **M-H1 watch list**로.

#### 36.18.3 R2 — A8 "그래프 위치" (`tests/engrave/l2.js`; G4-D1b-19, 20)

**`eg.mark.anchor_err`** — 기호마다 그 규칙이 두는 곳 (sysmarks를 읽지 않고 다시 적음; 0.02 sp = 반올림 둘):

| 종류 | 규칙 |
| --- | --- |
| 셈여림 | 글자 glyph들이 그 시각에 시작하는 음의 가운데 — 그래프가 event를 말하면 그 event의 머리, 아니면 그 staff(§36.3의 자리 규칙대로), 없으면 part의 다른 staff, 없으면 그 시각의 x; 말로 된 셈여림은 거기서 시작. 한 기호가 두 ID를 이름 대면(두 보표가 다 적음) 둘 중 하나에 맞으면 됨 |
| words (메트로놈 둘레 말 밖) | 그 시각의 음(없으면 시각의 x) 왼쪽; 마디 끝이면 세로줄에 오른쪽 맞춤; system 끝을 넘으면 안으로 |
| tempo 줄 | 그 시각에 top staff에서 시작하는 음 (없으면 그 part의 다른 staff, 없으면 시각의 x) — 줄 전체(메트로놈 둘레 말 포함)의 왼쪽 |
| rehearsal | 글자가 세로줄(마디 시작)에, 아니면 그 시각의 x |
| jump | 말: 마디 끝이면 세로줄에 오른쪽 맞춤, 마디 시작이면 세로줄 뒤 0.3 sp, 그 밖은 그 시각의 음; segno·coda glyph: 세로줄(마디 시작) 또는 그 시각의 x에 가운데 |
| 옮김 | 줄이 옮기는 만큼만: 오른쪽으로는 같은 줄(같은 system·staff·쪽·기준선)의 항목 뒤 0.4 sp (셈여림 곁 words는 0.35 — 그 규칙은 `eg.words.push_err`) — system 끝에서 당겨진 항목은 그 앞 항목들도 함께 당겨지므로 민 항목은 늘 앞 항목 뒤 정확히 그만큼; 왼쪽으로는 system 끝, 또는 같은 줄 다음 항목 0.4 sp 앞에서 끝남 |

**`eg.hairpin.extent_err`** — hairpin은 그 시간의 일부를 담은 system마다 **한 조각**, 그 밖의 system에는 없음; 조각의 시작은 그 첫 시각에 그 줄(행)의 셈여림 뒤 0.5 sp (없으면 첫 음의 왼쪽, 시각의 x), system을 넘어 이어지면 그 system 첫 음 기둥 1.0 sp 앞; 끝은 마지막 시각의 셈여림 0.5 sp 앞 (없으면 멈추는 음 — 마디 끝이나 시작이면 세로줄 — 0.5 sp 앞), 이어지면 마지막 세로줄 1.0 sp 앞. 양끝은 그 행의 셈여림과 0.5 sp를 지키려고만 옮겨지고 (S5), 끝은 `HAIRPIN_OVERLAP`·`HAIRPIN_SHORT`가 이름 댄 것만 따로. 0.05 sp.

| 리뷰의 변이 | 심은 결함 | 잡은 이름 (probe × 두 config 합) | `ee87449` · 지금 |
| --- | --- | --- | --- |
| R-DX | 셈여림(과 그 곁 words)을 한 박 뒤 음에 | `eg.mark.anchor_err` 18 (E16; `eg.words.push_err`도) | 0 · 0 |
| R-WX | words를 한 박 뒤 음에 | `eg.mark.anchor_err` 2 (E16의 cresc.) | 0 · 0 |
| R-TX | tempo를 한 박 뒤 음에 | `eg.mark.anchor_err` 8 (E22, 합성 `upper`) | 0 · 0 |
| R-RX | rehearsal을 한 마디 뒤 세로줄에 | `eg.mark.anchor_err` 2 (E22) | 0 · 0 |
| R-JX | 마디 끝의 jump 말(D.S. al Coda)을 마디 시작에 | `eg.mark.anchor_err` 2 (E22) | 0 · 0 |
| R-HE | 음에서 끝나는 hairpin이 3 sp 일찍 멈춤 | `eg.hairpin.extent_err` 18 (czerny849/005) | 0 · 0 |
| R-HS0 | 음에서 시작하는 hairpin이 3 sp 늦게 | `eg.hairpin.extent_err` 2 (E16) | 0 · 0 |
| R-HB | system을 넘는 hairpin의 뒤 조각을 버림 | `eg.hairpin.extent_err` 3 (E16) | 0 · 0 |

  두 metric은 `ee87449`에서도 0이다 — 코드는 규칙대로였고 지키는 것이 hash뿐이었다. 기존 변이 가운데 HT(`hairpin.extent_err`도), DS(`mark.anchor_err`도)가 새 metric을 함께 움직인다. Fixer가 처음 쓴 판에서는 R-RX가 E22 데스크톱에서 통과했다 — 한 마디 뒤가 곧 system 끝이라 "system 끝으로 당겨진" 것으로 읽혔다; 민 항목은 앞 항목 뒤 정확히 0.4 sp라는 규칙(위 표 "옮김")으로 고쳐 잡는다.

#### 36.18.4 R3 — G4-D1b-4와 G4-D1b-5 (`l2.js`, `sysmarks.js`; G4-D1b-21, 22)

- **`eg.words.push_err`** (G4-D1b-4): 셈여림 줄의 words(두 보표 사이, 또는 한 staff part의 아래 — §36.6의 자리 규칙)는 그 행의 **첫 줄**(보표에 가장 가까운)에서, 제 자리 또는 그 줄 항목 뒤 0.35 sp 가운데 **아무것도 만나지 않는(0.2 sp) 가장 가까운 곳** — 그것이 제 자리에서 4 sp 안이고 system 안이면; 아니면 한 줄 바깥에서 제 자리에. 첫 줄이 그 말에게 담는 것: 셈여림, hairpin, 그리고 (자리, 그래프 순서로) 앞의 words.
- **코드를 규칙에 맞춤**: `lines()`는 마지막 밀기가 4 sp를 넘겨도 첫 줄에 두었다 (밀기를 계속할지는 밀기 전 거리로 봄) — "최대 4 sp"와 다르다. 이제 첫 줄에 남는 것은 제 자리이거나 4 sp 안으로 밀린 것만. 808 layout에서 출력 변화 0 (`ee87449`에서도 `eg.words.push_err` 0 — 그런 말이 코퍼스에 없다).
- **`eg.row.centre_err`** (G4-D1b-5): 두 보표 사이 줄(위 보표 아래의 셈여림·hairpin·words)의 위 틈 gu(위 보표가 그 항목들 위로 내려온 곳까지, 그 줄 밖의 것만)와 아래 틈 gd(아래 보표가 올라온 곳까지)를 stacking이 읽듯 0.25 sp 칸으로 — 곡선은 x 0.5 sp마다 두 끝의 높이로(§10.1) — 읽어, gd ≥ 1.0 sp이고 셋 가운데 하나: **gu = gd** (가운데), **gu < gd = 1.0 sp** (가운데면 아래 보표에 1.0 sp보다 가까움), **gu > gd** (가운데가 위: 줄은 위로 옮기지 않으므로 놓인 자리 — 그 항목 하나 곁 0.25 sp 안의 위 보표 내용에서 0.5 sp). 0.15 sp; 칸은 반올림 전처럼 그대로, 또는 0.01만큼 넓혀 읽어 어느 한쪽이 맞으면.
  - **808 layout의 사이 줄 1,618개** (layout 자신의 up·down으로): 가운데 738, 아래 보표에서 1.0 sp에 묶임 879 (그 system의 보표 간격을 사이 줄이 정함), 놓인 자리 1. 그 하나 — 셋째 경우가 있는 이유: czerny849/002 데스크톱 system 10의 ff는 위 보표의 맨 내용에서 2.2 sp 아래에 놓였다 — 옆의 tuplet 숫자가 배치 skyline에 양쪽 0.2 sp 여유를 두고 들어가 ff의 칸에 닿기 때문이다 (tuplet 상자 51.65–52.57, skyline 51.45–52.77). 가운데가 그 위라 줄은 그대로 선다 (G4-D1b-5의 "아래로만"). 처음 쓴 metric은 이 줄을 틀렸다고 셌다.
- **mutation**: R-WP `PUSH_MAX = -1` → `eg.words.push_err` 4 (burgmuller25/015, czerny849/005); R-CB `void centreBands` → `eg.row.centre_err` 5 (E16); R-CB2 (Fixer의 것) 줄을 아래 보표 내용까지 내림 → `eg.row.centre_err` 6 (E16; `vertical_collisions`·`staff.overlap`도). 기존 VC·M10도 `eg.row.centre_err`를 함께 움직인다.
- **음성 대조** (`sysmarks.test.js`, 실제 layout을 망가뜨림): 새 아홉 — 닫는 괄호를 한 줄 위로·빈 "( )"(`tempo.split_err`), 셈여림 1 sp 오른쪽·tempo 2 sp 뒤·D.S. al Coda 1 sp 앞(`mark.anchor_err`), hairpin 끝 1 sp 짧게·system 넘은 뒤 조각 버림(`hairpin.extent_err`), cresc. 1 sp 뒤(`words.push_err`), 사이 줄 0.4 sp 위로(`row.centre_err`).

#### 36.18.5 기록 정정 (M1, 문서만)

- **tempo 152쌍**: §36.16의 "tempo 152 (대부분 plan이 그리라는 heading ♩ = N)"은 틀렸다. hash에 든 118곡 가운데 tempo를 그리는 것은 76곡(× 두 config = 152쌍)이고 **heading "♩ = N"은 하나도 없다** — 모두 파일이 인쇄한 표시다 (E22 1, R suite 58, golden 17). heading은 코퍼스의 MIDI 가져오기 27곡에만, 파일의 tempo event에서 선다 (G4-F12). §36.6의 "코퍼스 tempo 객체 886(대부분 heading의 조각)"도 같은 오류: 886 가운데 heading의 조각은 81 (27곡 × 음표·줄기·"= N"), 805는 인쇄된 표시. §36.19의 관찰("heading ♩ = N이 많은 곡의 첫머리에 새로 선다")도 같이 고쳤다. (셈: `ee87449`의 `plan()`·layout으로 ledger가 drawn인 tempo의 `heading`을 셈.)
- **plan 48곡**: 어떻게 셌는지가 없었고 다시 나오지 않는다. 두 가지로 셌다: (A) **같은 입력**(`ee87449`의 fixture)을 `747e45e`와 `17a38f3`의 `plan()`에 넣고 버전 이름을 빼고 비교 — **45/118** (marks의 `part`만 21, lines의 `part`만 6, 둘 다 15, 셋 다와 `more` 3); (B) 버전 guard가 보는 것(각 commit이 **제 fixture**로 만든 plan) — **49** = 45 + 파일만 바뀌고 plan 코드의 변화는 닿지 않는 fixture 넷(E19, E20, E21, E24). 리뷰의 45·49와 같다. 다른 것은 모두 `part` 또는 `more`다. §36.13의 guard 음성 대조("REFUSED: 48 plans")도 49로.
- **`far_placements` 37**: 1a 기호의 FAR는 **r 16, 코퍼스 35** (E fixture 둘 — E23 — 을 더하면 808 layout에서 37)이고 G4d-1b 전후 그대로다. §36.10을 고쳤다.
- 고친 곳: §36.6, §36.10, §36.13 (버전 규칙 행), §36.16, §36.19 (implementer의 PNG, 옛 §36.18), §36.20 (implementer의 남은 것, 옛 §36.19 — R1인 예 하나에 표시), DECISIONS G4-D1b-1, -12, -15.

#### 36.18.6 버전과 re-bless (§21.3; G4-D1b-23)

- **버전**: layout 출력이 검토된 `ee87449`(engr/4)에서 바뀌었으므로 **`engr/5`** (G4-D1a-1, G4-D1a-23의 읽기). plan 출력은 그대로 — 같은 입력에서 404곡의 plan이 `ee87449`와 같다 (바뀐 plan hash는 fixture가 바뀐 E22 하나) — **`plan/3` 유지**. `layout.test.js`·`marks.test.js`의 버전 검사를 engr/5로. 참고: `layout-hashes.js --write`의 기준은 origin/main과의 merge base(`747e45e`, engr/3)라 engr/4로 두어도 거절하지 않는다 (해 봄: "wrote …") — 버전은 손으로 올렸다.
- **`layout-diff.js --base=<ee87449의 engrave/·scoregraph/>`** (두 트리 모두 오늘의 fixture): 118곡 × 두 config = 236쌍.

| 분류 | 수 | 무엇 — 이유 |
| --- | --- | --- |
| SERIALIZATION_ONLY `(version)` | 218 | `engr/5`만 — 객체·좌표 같음 (셈여림 곁 words의 코드 맞춤은 출력을 바꾸지 않음) |
| LEDGER_CHANGE — words | 14 | czerny849/002, 005, 007, 018, 020, 022, 023 × 2 — **R1**: "… (" 말이 tempo 줄에서 두 조각(`ID#0`, `ID#1`)이 됨; words 줄이 없어져 그 아래 모든 것이 세로로 |
| LEDGER_CHANGE — words | 2 | E22 × 2 — **fixture** (새 tempo 줄 둘) |
| GEOMETRY_ONLY | 2 | hanon/001 × 2 — **R1**: 두 말이 (한 조각씩, 같은 ID로) tempo 줄로; 그 아래가 세로로 |

  L1은 나빠지지 않았다 — baseline r·e·x는 새 키 다섯(0)만 더했고, 바뀐 값 하나는 내림: r `eg.layout.far_placements_system` 23 → 8 (R1). L2 영목표는 808 layout 전부 0. **bless 이유**: R1과 E22 fixture, 버전 규칙 — 그 밖의 이유로 바뀐 쌍은 없다.

#### 36.18.7 회귀 (코드 커밋 `3746437`)

| 검사 | Windows (`D:/PPP-g4`, Node v24.17.0) | Linux (Docker `node:24-bookworm`, Node v24.21.0; `3746437`의 `core.autocrlf=false` clone, LF) |
| --- | --- | --- |
| `npm run test:engrave` | **174/174** (mutation 97 + N1·N2, 약 52 s; 음성 대조 +9) | **174/174** |
| `npm run test:scoregraph` | **214/214** | **214/214** |
| `layout-hashes.js` | 118 × 2 layout + 118 plan 전부 커밋된 hash (다시 bless, §36.18.6) | 같음 |
| `make-metrics`·`make-outlines`·`make-e-fixtures`·`make-corpus --check` | PASS | PASS |
| `make-text-metrics.js --check` | PASS (캐시로 다시 만들기까지) | PASS (글꼴 캐시 없음: 형식·digest) |
| `bench.js check --suite r / e / x` | PASS / PASS / PASS (61 / 40 / 76 graph) | PASS / PASS / PASS |
| 새 metric의 음성 대조 | `ee87449`: `tempo.split_err` 118 (R suite 46); 넷은 0이고 제 변이로 >0 (§36.18.3–4); 지금 다섯 모두 0 | — |
| `browser-parity.js` (A28) | Chrome 153: layout 808/808, SVG 808/808 바이트 동일 (R1이 바꾼 코퍼스 20곡과 E22 포함), E14 `<use>` 18 오차 ≤ 0.01 sp, network 0; sonatina/020 1× layout 23.8 ms, 4× CPU 118.6 ms | — |
| legacy parity (`legacy-parity.js`; `747e45e`의 `git archive`를 8871에, 이 트리를 8872에, `NODE_ENV=production HOST=127.0.0.1`) | **16/16 바이트 동일**; 8872의 `engrave/index.js`는 `0.5.0-g4d1b`, 8871은 `0.4.0-g4d1a` — 측정 뒤 두 서버를 껐다; 8777·8788은 건드리지 않음 | — |
| 앱 파일 | `Piano Coach App.dc.html`·`index.html`·`server.js`·`scoregraph/` 바이트 그대로 (`git diff 747e45e` 비어 있음) | — |

**PNG** (직접 봄; `NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/render-png.js … --scale=14`, 전은 `ee87449`의 트리, gitignore): `tests/engrave/out/png/g4d1b-fix/before/`와 `after/`에 같은 이름으로 `czerny849-002.desktop.png`·`.clip.png`(전: "Molto Allegro ( )" 위, "𝅗𝅥 = 100" 아래 두 줄; 후: "Molto Allegro (𝅗𝅥 = 100)" 한 줄, 그 아래 줄이 올라옴), `hanon-001.desktop.png`·`.clip.png`(전: "(M.M. to 108.)" 위, "♩ = 60" 아래; 후: "(M.M. ♩ = 60 to 108.)"), `burgmuller25-015.desktop.png`·`.clip.png`(전후 바이트 같은 PNG — "p misterioso"가 p 뒤 0.35 sp로 밀리고 사이 줄이 가운데; G4-D1b-4·5가 이제 metric으로 지켜짐); `after/e-E22-repeats-jumps.desktop.png`("Più mosso (♩ = 132)", "(M.M. ♩ = 60 to 72.)").

#### 36.18.8 남은 것과 맡긴 곳

- **BLOCKER 0, MAJOR 0** (Fixer 판정): R1–R3 FIXED, M1 FIXED.
- **Lead가 맡긴 곳 (손대지 않음)**: M2 따로 된 direction의 tempo 말이 메트로놈 위에 쌓임 → **M-H1 watch list** (§36.18.2; 코퍼스 54곳, czerny599/038의 "dolce"처럼 tempo 말이 아닌 것이 섞임); M3 Chrome 4× CPU → **G4f**. G4d-1a의 규칙, 앱·`scoregraph/`·`server.js`·`index.html`, 페이지 통합은 건드리지 않았다.
- **Lead가 볼 결정**: G4-D1b-17 (괄호 짝으로 합치는 규칙과 두 글꼴), G4-D1b-21 (마지막 밀기도 4 sp 안 — 코드를 규칙에 맞춤, 출력 변화 0), G4-D1b-22 (사이 줄 metric의 셋째 경우: 가운데가 위면 놓인 자리 — 배치 skyline의 여유 때문에 맨 내용보다 깊이 놓일 수 있다), G4-D1b-23 (engr/5; guard의 기준이 merge base라 engr/4도 막지 않는다).
- **M-H1에서 볼 것**: 합쳐진 tempo 줄에서 두 글꼴 크기(말 1.6, 괄호·"= N"·뒤 말 1.4)의 모양; 위 M2.

**커밋**: `3746437` (코드·테스트·fixture·baseline·layout hash), 이어서 이 기록 (G04 §36.18과 §36의 정정·번호, DECISIONS G4-D1b-17–24와 G4-D1b-1·12·15의 정정, CURRENT_STATE). `origin/g4d1b-system-marks`에 push, PR 없음.

**상태: G4d-1b FIX: READY_FOR_RECHECK.**

### 36.19 PNG (직접 봄; `NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/render-png.js … --scale=14`, gitignore)

`tests/engrave/out/png/g4d1b/`: `e-E16-dynamics-hairpins.desktop.png`·`.phone.png`, `e-E17-pedal.desktop.png`·`.phone.png`, `e-E18-ottava.desktop.png`·`.phone.png`, `e-E19-clefs.desktop.png`·`.phone.png`, `e-E20-key-change.desktop.png`·`.phone.png`, `e-E21-meter.desktop.png`·`.phone.png`, `e-E22-repeats-jumps.desktop.png`·`.phone.png`, `e-E23-fingering.desktop.png`, `e-E24-lyrics.desktop.png`·`.phone.png`, `e-E25-chords-dense.desktop.png`·`.phone.png`, `e-E32-accidentals-cautionary.desktop.png`, `e-E35-voice-and-piano.desktop.png`·`.phone.png`, `e-E37-long.desktop.png`·`.desktop.clip.png`·`.phone.png`; 카탈로그(G0 hold-out 아님) `burgmuller25-015.desktop.png`·`.phone.png`(셈여림·hairpin·pedal·8va), `sonatina-028.desktop.png`(셈여림·hairpin·pedal·tempo), `czerny849-020.desktop.png`(8va와 "(8)" 이어짐). 본 것: 두 보표 사이 가운데의 셈여림과 hairpin(양끝 0.5 sp), 휴대폰에서 한 줄 바깥으로 간 ff, "p dolce"·"p misterioso"; sign pedal의 "* Ped." change, line pedal의 notch와 system 넘김, E17의 녹음 모양; 8va·8vb·15ma, 두 staff에 걸친 8va, system 넘김 "(8)" 뒤 닫는 갈고리, 적힌 높이의 머리; volta 번호, "Allegro (♩ = 120)", 틀 안 "A", segno·coda, 세로줄에 맞춘 Fine·D.S. al Coda; 두 절의 가사와 hyphen; 빽빽한 코드명(♯♭ glyph)과 밀린 Am7; system 끝의 courtesy 조표·박자·작은 clef; E32의 [♭]. **관찰** (고치지 않음, M-H1): czerny849/020처럼 긴 phrase slur가 있으면 ottava가 그 바깥(§10.2 순서대로)이라 음에서 멀다; 파일이 인쇄한 tempo 표시(말·메트로놈)가 많은 곡의 첫머리에 새로 선다 (Fixer 정정, §36.18.5: 처음 기록은 "heading ♩ = N" — heading은 MIDI 가져오기에만).

### 36.20 남은 것

- **BLOCKER 0, MAJOR 0** (implementer 자체 판정).
- MINOR·관찰:
  1. 가사의 melisma 연장선(`extend`)은 그리지 않는다 (A12 "기본"; 코퍼스 가사 1곡).
  2. ottava 레이블은 글자 (§36.12 1) — 판본의 굵은 SMuFL 숫자와 모양이 다르다. M-H1에서 볼 것.
  3. 긴 phrase slur 바깥의 ottava·tempo 줄은 음에서 멀 수 있다 (FAR는 진단됨; `eg.layout.far_placements_system` r 23 — Fixer 뒤 r 8).
  4. 두 보표 사이 줄의 가운데 맞춤은 줄 전체를 한 번에 옮긴다 — 한 곳이 좁으면 줄 전체가 위 보표 가까이 남는다 (S2를 지키기 위해).
  5. words는 간격에 들어가지 않는다 — 긴 words("Molto vivace e leggiero ( ")는 한 줄 바깥이나 system 안으로 당겨진다. (Fixer: 이 예는 리뷰의 R1이었다 — 메트로놈 둘레의 말로, 이제 tempo 줄에 선다, §36.18.2.)
- **G4d-2로**: system에 붙는 기호도 `svg.js`가 그리므로 페이지 CSS(`.ppp-dynamic`, `.ppp-pedal` …)와 테마 색; `data-plan`의 `plan/3`·`engr/4`로 캐시 키 (G4-D1a-1); `g.ppp-<종류>[data-ref]`가 새 DOM 계약 (G4-D1b-16).
- **M-H1에서 볼 것**: 두 보표 사이 셈여림의 높이와 크기(2.5 sp em), hairpin 열림 1.1 sp, pedal 기호 크기, 코드명 폭이 간격을 넓히는 정도, heading tempo, 위 §35.19의 관찰 목록.

**커밋**: `17a38f3` (코드·테스트·fixture·baseline·layout hash), 이어서 이 기록 (G04 §36, 목차; DECISIONS G4-D1b-1–16; CURRENT_STATE). `origin/g4d1b-system-marks`에 push. 병합 안 함, PR 없음.

**상태: G4d-1b READY_FOR_REVIEW** — BLOCKER 0, MAJOR 0 (자체 판정). → 독립 리뷰 NEEDS_FIX (MAJOR 3), Fixer: §36.18 (READY_FOR_RECHECK).


### 36.21 리뷰 판정·재확인·병합 (Lead, 2026-09-26)

**독립 리뷰** (`ee87449`, read-only. 리뷰어 자신의 clone에서 Windows와 Linux Docker로 돌림)

- 판정: **NEEDS_FIX — BLOCKER 0, MAJOR 3, MINOR 3.**
- 확인된 것:
  - **지어낸 기보 없음 (A13).** 그려진 metronome 표시·화음명·가사는 모두 원본에 인쇄된 것이다. 곡머리 "♩ = N"은 MIDI 가져오기 27곡뿐이고, 파일의 tempo 이벤트에서 온다.
  - gate를 느슨하게 하지 않았다. `far_placements_system` 분리는 정당하다.
  - 다시 bless한 64/2/170을 재현했다.
  - A9: 기호식 change는 "✻ Ped."로 그린다 (MX1-D4와 같음).
  - A10이 성립한다.
  - Windows = Linux = Chrome, legacy parity 16/16.
- MAJOR:
  - R1: metronome 표시를 둘러싼 빠르기말이 다른 줄로 가서 빈 "( )"가 남는다 (카탈로그 20곡).
  - R2: A8 위치(셈여림·말·tempo·rehearsal·jump의 x, hairpin 범위와 system 넘김)를 layout hash만 지킨다.
  - R3: 새 규칙 둘(보표 사이 줄의 가운데 맞춤, 셈여림 뒤로 밀린 말)에 이름 붙은 metric이 없다.

**Fixer** (§36.18): R1–R3 FIXED, 기록 정정 (M1). `engr/5`, `plan/3`.
- R1: 빠르기말이 metronome 표시와 한 줄에 선다. `eg.tempo.split_err` 118 → 0.
- R2: `eg.mark.anchor_err`, `eg.hairpin.extent_err`를 더했다.
- R3: `eg.words.push_err`, `eg.row.centre_err`를 더했다.
- 리뷰어의 mutation 12개를 모두 이름으로 잡는다.

**Lead 재확인** (고친 항목만, `5e53965`의 새 clone)

- gate: `test:engrave` 174/174, `test:scoregraph` 214/214. layout hash, bench r·e·x, `--check` 도구 다섯 모두 PASS.
- 음성 대조: `ee87449`의 `sysmarks.js`를 넣으면 `tempo.split_err`가 r 46, e 10.
- Lead가 심은 mutation:

  | mutation | 잡은 metric |
  | --- | --- |
  | hairpin 여백 0.5 → 1.5 sp | `hairpin.extent_err` 292 |
  | Fine·D.C.의 오른쪽 맞춤을 없앰 | `mark.anchor_err` 2 |
  | 셈여림을 음 가운데가 아니라 음에서 시작 | `mark.anchor_err` 415 |
  | 말을 미는 한도 4 → 8 sp | 죽은 mutation — 커밋된 입력 중 4 sp 넘게 밀리는 말이 없다. fixture 빈틈이고, 규칙 자체의 mutation(R-WP)은 잡힌다 |

- 그림: czerny849/002 "Molto Allegro (𝅗𝅥 = 100)"이 한 줄, hanon/001 "(M.M. ♩ = 60 to 108.)".

**병합**: PR #19, CI gate 초록, squash `a6e1a75`. **G4d-1b CLOSED — 다시 열지 않는다. G4d-1(Node 판각)이 끝났다.**

**넘기는 것**

- **M-H1 관찰 목록**:
  - 따로 적힌 빠르기말이 metronome 표시 위에 쌓임 (czerny599/054);
  - ottava 표시가 글자다 (고정된 Bravura에 ottava glyph 없음);
  - 긴 phrase slur 위의 octave line·tempo 줄 (진단됨);
  - melisma 연장선 없음.
- G4f: Chrome 4× CPU.
- 다음 엔진 단계: 4 sp 넘게 밀리는 말이 있는 fixture.

## 37. G4d-2 구현 기록 — 판각기를 페이지에 (개발용 스위치), M-H1 도구

Implementer, 2026-09-26. 브랜치 `g4d2-page-integration` (`D:/PPP-g4`), 시작 `0ef0950` (= `origin/main`, G4d-1b 마감 뒤). 입력은 Lead의 G4d-2 지시(로드맵 §14 카드, §5.1 G4-L1)다. 병합하지 않았고 PR도 없다 (Lead가 리뷰와 PR을 정한다). 결정은 DECISIONS G4-D2-1–18.

**한 줄**: 앱의 ScoreView가 `renderer='engrave'`일 때 판각기로 그린다 — 파일의 그래프(`legacy.agree`와 `link`가 확인할 때만, 아니면 Score 자신의 projection), plan, layout, SVG를 캐시하며 `engrave/page.js`가 뷰에 넣고, 연습 층(현재 마디, 루프 상자, 재생선, 약한 마디, 마디 번호, 제목, 안내 글자, 포인터)을 그 위에 얹고, 새 `sync`가 바뀐 음만 칠한다. 실패하면 그 곡은 legacy 렌더러가 그리고 세어진다. **기본값은 `'legacy'`이고, 기본 경로는 바뀌지 않았다**: 기본 페이지는 G4d-2 전과 같은 파일을 불러오고(레이아웃 파일과 `page.js`는 `'engrave'` 뷰가 처음 그릴 때만), legacy 렌더러의 SVG는 `0ef0950`과 바이트 동일(16/16), Score·재생 계획·연습 판정 입력은 두 렌더러에서 바이트 동일(A16). M-H1의 블라인드 X/Y packet을 만드는 `tests/engrave/tools/review-build.js`도 만들었다.

### 37.1 범위 — §16과 G4-L1

| 지시 | 한 일 | 어디 |
| --- | --- | --- |
| 스위치 (§16.1) | ScoreView prop `renderer`, 기본 `PPP.renderer` = `'legacy'`; `?renderer=engrave`, localStorage `ppp.renderer`; `PPP.strictEngrave`, `?strict=1` (G4-D2-1). `paint()`가 `engraveWanted(props)`이면 판각기, 아니면 옛 `draw()` | App 10538–10653, 10689–10691, 10712–10725 |
| 옛 `draw()`·`buildVoice()`·`sync()` 불변 (A45) | 클래스의 두 표시된 삽입 밖은 MX-1이 남긴 그대로 — 고정을 넓힘 (G4-D2-3) | `tests/engrave/app.test.js` A45 |
| `drawKey` | 그래프 fingerprint(또는 projection의 Score 음악 hash) + plan 버전 + semanticConfig + engr 버전 + layout config + 페이지 표시 (G4-D2-11) | `page.js` `viewKey` |
| pipeline과 캐시 (§16.2, 버전 규칙) | plan은 그래프 × semantic마다 한 번, layout LRU 8 (`createEngraver`), SVG 글·PracticeMap은 layout마다, 키에 `plan/N`·`engr/N` | §37.4 |
| 새 `sync` (A31) | G4b highlighter로 바뀐 음만, 바뀐 class만; 손·기억·숨김 단계가 바뀐 프레임만 전체 | §37.5 |
| DOM 계약 (§16.4) | 전부 — `g.ppp-note[data-onset][data-ev]`, `data-rest`, `g.ppp-stave[...]`, `g.ppp-tuplet`, VexFlow class, `.ppp-now`, 루프 상자, 재생선, `.ppp-ann`, `data-ppp-row`, `svg.__ppp` + `.engraved`, `ppp-on/bad/off/ghost`; `.vf-notehead path` 등 선택자 고침 | §37.7 |
| 크기·확대·태블릿 (§16.5, A32, A34) | breakpoint 안 창 크기는 같은 config — 배치도 그리기도 없음; 확대는 layout 캐시; 포인터 처리기는 legacy와 같은 문턱·사건 | §37.8 |
| overlay (§16.6) | 현재 마디 wash, 루프 상자(한 system 안일 때만, legacy처럼), 재생선, 약한 마디 — PracticeMap에서; 손 필터·기억·리듬만 보기는 class로 (다시 배치 없음). 안내 글자는 페이지의 글자 (G4-D2-7) | `page.js` `decorate`, `overlays` |
| 테마 (A33) | 잉크·보표선·종이·켜진 음이 CSS 변수 (G4-D2-14) | App 108–113 |
| 실패 (§16.7) | fallback은 legacy로, code별·곡별 카운터, `console.warn('[ppp] engrave fallback', code, 이유)`, strict면 throw, 화면은 비지 않음; 코퍼스의 fallback 수를 페이지에서 잼 | §37.6 |
| `agree.ok` 요구 | `agree.ok`와 `link.ok`가 아니면 그리지 않음 (G4-D2-9) — MX1-D3의 옛 저장 곡처럼 파일 그래프와 다른 Score는 자기 projection | `page.js` `paint` |
| G4-L1의 나머지 | 캐시 가능한 전송 (G4-D2-5), 다시 불러온 곡의 `resolve` 비용 (잼, §37.12), R12 (G4-D2-16), `with-port.js`의 빈틈 (G4-D2-15) | §37.9 |
| M-H1 도구 (§22.4) | `tests/engrave/tools/review-build.js` — packet을 한 번 만들고 직접 봄 | §37.14 |
| 사용자에게 보이는 변화 없음 | 기본 페이지가 불러오는 파일 같음, legacy parity 16/16, A16, 기본 경로의 브라우저 suite = base | §37.10–§37.13 |

하지 않은 것 (지시대로): flip, 시간 나누기·idle 미리 계산(§16.3 — 전곡 첫 그리기의 long task는 G4f), 인쇄, 엔진 규칙 변경 (페이지에서 본 엔진 결함은 M-H1 watch list로 §37.16), `scoregraph/`·재생 변경, VexFlow 버전, G3 flag.

### 37.2 앱 파일의 변경 (`Piano Coach App.dc.html`, 이 커밋의 줄 번호)

| 줄 | 무엇 |
| --- | --- |
| 43, 45 | `engrave/store.js?v=4`, `engrave/index.js?v=4` (R12와 version 글이 바뀐 두 파일; 불러오는 파일 목록은 그대로) |
| 108–113 | CSS 네 줄: `svg.ppp-engraved`의 `color`, 보표선 `--score-staff`, `.ppp-on`·`.ppp-bad`의 `color` — `.ppp-engraved`가 없는 legacy SVG에는 닿지 않음 |
| 10538–10653 | `makeScoreView` 바로 앞의 블록: `ENGRAVE_FILES`(15 파일과 hash), `ENGRAVE_SWITCH`, `PPP.renderer`·`PPP.strictEngrave`·`PPP.engraveStats`, `engraveWanted`, `loadEngrave()`, `engraveView(view)` |
| 10689–10691 | `paint()`의 첫 문장 (`/* G4d-2 >>>` … `/* <<< G4d-2 */`) |
| 10712–10725 | `paintEngrave()` (같은 표시) |

그 밖의 앱 줄은 바이트 그대로다 — `draw()`, `buildVoice()`, `sync()`, `drawKey()`, VexFlow 머리(`VEXFLOW_URL`, `loadVexFlow`)를 포함해 (A45 고정). `server.js`에는 엔진 파일의 캐시 규칙(+30줄, 43–60, 852–866)만.

### 37.3 모듈과 도구

| 파일 | 한 일 |
| --- | --- |
| `engrave/page.js` (새) | `createView(env)` → `paint(el, props)` = `'drawn'`\|`'pending'`\|`'legacy'`; `layoutConfig`, `semanticConfig`, `viewKey`, `createSync`, `legacyClasses`, `groupsFor`, `annotations`, `stats`. A29 층 `PAGE` (G4-D2-4) |
| `engrave/svg.js` | 선택 `unit`, `inline` (G4-D2-6); `data-volta`의 이름 (G4-D2-8). 기본 출력은 `data-volta` 값 말고 바이트 그대로 (E 40 + 코퍼스 347 + 전사 17의 두 config 808 SVG를 `0ef0950`의 `svg.js`와 비교: 바뀐 28 SVG의 64줄이 모두 `data-volta`) |
| `engrave/store.js` | R12 (G4-D2-16) |
| `engrave/index.js` | `version` `0.6.0-g4d2`, 머리 주석 |
| `server.js` | `?h=` 엔진 파일 캐시 (G4-D2-5) |
| `tests/engrave/page.test.js` (새, 7) | layout config (A32 대리), drawKey와 버전 규칙, 그룹 = Score 음, A31 대리 (sonatina/020 4,501 프레임이 legacy 규칙과 같고 쓴 것 = 바뀐 것), 글자, `unit`·`inline` 동치 |
| `tests/engrave/tools/page-files.js` (새) | `ENGRAVE_FILES`의 hash 쓰기·확인 (`app.test.js`가 CI에서) |
| `tests/engrave/tools/page-check.js` (새) | 실제 페이지에서 A16, A31, A32, A33, 코퍼스의 fallback, 성능, 스크린숏 |
| `tests/engrave/tools/review-build.js` (새) | M-H1 packet (§37.14) |
| `tests/engrave/tools/with-port.js` | G4-D2-15 |
| `tests/engrave/tools/browser-parity.js` | 페이지의 SVG(`page.SVG_OPTS`)도 Node = Chrome, E14 glyph path의 getBBox = 상자 × 10 |
| 그 밖의 테스트 | `a29.js`·`layout.test.js` (PAGE 층), `app.test.js` (스위치, A45, 파일 목록), `store.test.js` (R12), `svg.test.js` (`data-volta` "1."), `engraving.test.js`·`pdf-layer.test.js` (§37.7) |

### 37.4 원천·캐시·키 (§16.1–§16.3)

- **원천**: `PPPEngrave.app.resolve(score, {key})` — key는 앱이 연 곡의 id(그 Score가 `App.state.score`일 때), 썸네일은 없음. live → store(G4-U1) → projected. **`agree.ok`와 `link.ok`가 둘 다 참이 아니면 그리지 않는다** (G4-D2-9). Score 객체마다 한 번, 비동기 — 원천이 정해질 때까지 "Engraving…" (G4-D2-10).
- **캐시** (G4-D2-11): 그래프 항목 — live·store는 그래프 객체(WeakMap), projection은 Score 음악 hash(LRU 4); 그 안에 plan — `PLAN_VERSION|canonical(semantic)`(LRU 4); plan마다 `createEngraver`(prepare 한 번, layout LRU 8), SVG 글과 PracticeMap — `engr/N|canonical(config)`(각 LRU 8). 
- **drawKey**: `[그래프 키, plan 버전, semantic, engr 버전, layout config, 단위, 마디 번호, 제목, 안내 글자, 약한 마디, fluid, zoom]`. 재생선·켜진 음·손·기억·틀린 음·테마·종이·breakpoint 안 창 크기는 없다 (`page.test.js`가 확인).
- **layout config** (G4-D2-13): 전곡 = breakpoint config (100 sp·4마디 / 40 sp·2마디); 가까이 보기 = 창 `[i0, i1]`, 줄당 마디 = `perRow` 또는 창의 마디 수, 폭 = 마디당 25 sp(휴대폰 20) × 줄당 마디 ÷ zoom.

### 37.5 새 `sync` (§16.2, A31, B6; G4-D2-12)

그룹 = `g.ppp-note` 하나(event × staff). 그 staff의 Score 음(identity의 link)에서 legacy가 그룹마다 두는 값 — 시작 `abs`, 끝 `scoreNoteEnd(abs, dur)`, 음높이, 손, onset 키, `hideIdx`. 프레임마다 G4b highlighter(`createHighlighter`에 이 구간들)가 켜짐이 바뀐 그룹만 돌려주고, 그 그룹의 class 네 비트(`ppp-ghost/off/on/bad`)를 legacy 규칙으로 다시 계산해 **바뀐 비트만 `classList.toggle`**. 손·기억 계획·숨김 단계가 바뀐 프레임은 전체, 틀린 음 목록만 바뀌면 울리는 그룹만. 쉼표는 legacy처럼 켜고, 꾸밈음(`g.ppp-grace`)은 켜지 않는다.

- Node (`page.test.js`, sonatina/020 전곡 1,563 그룹, 40 ms 틱 4,501 프레임 + seek·손·기억·틀린 음): 모든 그룹의 class가 매 프레임 legacy 규칙과 같음, 쓴 수 = 바뀐 수, 보통 프레임에 만진 최대 6, p95 0.007 ms.
- 페이지 (`page-check.js a31`, 1000 프레임 = `setState({beat})`): 쓴 요소(`classList.toggle` 호출)와 바뀐 요소(MutationObserver): **바뀌지 않은 요소에 쓴 것 0**, 프레임당 평균 0.77·최대 4; sync p95 **0.1 ms** (CPU 4×: 0.5 ms, 400 프레임). legacy는 프레임마다 1,563 요소 전부에 쓴다.

### 37.6 fallback (§16.7)과 코퍼스

code: `LOAD_FAILED`, `SOURCE_THREW`, `SOURCE_NONE`, `SOURCE_DISAGREES`, `LINK_FAILED`, `PLAN_THREW`, `LAYOUT_THREW`, `SYNC_THREW`. `PPP.engraveStats = {fallbacks: {code: n}, bySong: {scoreId: code}}` (세션), `PPPEngravePage.stats`(그림·캐시·프레임·시간). 그 Score 객체는 바뀔 때까지 legacy. strict면 `'[ppp] engrave <code>: <이유>'`를 throw. 판각기가 그리지 않는 축소 뷰는 routed (fallback 아님).

**코퍼스의 fallback 수** (`page-check.js corpus`, 실제 페이지, `helpers.corpusFiles()` 347 + E 40 = 387 파일, G0 hold-out 없음):

| 길 | 결과 |
| --- | --- |
| import door (`scoreFromFile`, live 그래프) | 그림 **361**, fallback **0**, 열리지 않음 26 (네 음 미만 `.mid` 등 — R4) |
| 앱의 옛 reader (`parseMusicXML`, MusicXML 184) | 그림 182 (live 175 — 같은 음악의 생산자 그래프를 내용으로 찾음, G4-F3; projected 7), **fallback 2** — `ending-stop-without-start.musicxml`, `wedge-unpaired.musicxml` (`SOURCE_DISAGREES`: 그래프가 거절하는 열림 없는 ending·짝 없는 hairpin을 Score가 가짐 — A48의 알려진 손실과 같은 두 fixture; legacy가 그림) |

A47(G4f 판정)의 "import 파일 전부 fallback 0"은 import door 기준으로 성립 (hold-out 52는 열지 않았다). 브라우저 suite에서 본 fallback은 §37.11.

**발견 (고치지 않음, `scoregraph/` 밖)**: 공유 악보 seed 7곡 가운데 4곡(`pppseedjazz`·`newage`·`ost`·`game`)이 `SOURCE_DISAGREES` — 두 staff가 같은 voice 번호(1)를 쓰는 Score를 `legacy.fromScore`가 한 part의 한 성부로 읽어 staff 2의 손을 `'x'`로 되돌린다 (`notes.hand x vs l`). legacy가 그리고 세어진다. `fromScore`의 성부-staff 규칙 (G4a 코드) — G4f 또는 유지보수로.

### 37.7 DOM 계약 (§16.4)과 바꾼 단언

판각기의 SVG는 legacy의 계약을 지킨다: `g.ppp-stave[data-m][data-staff][data-begin][data-end][data-volta][data-time]` (volta 이름 "1." — G4-D2-8), `g.ppp-note.vf-stavenote[data-onset][data-ev]`(+`data-rest`), `g.ppp-tuplet`, `.vf-notehead`·`.vf-stem`·`.vf-clef`·`path.vf-stavetie`, `.ppp-now`, 루프 상자, 재생선, `.ppp-ann`(마디 번호·제목·작곡가·안내 글자 + 판각기의 글자), `data-ppp-row`(system 그룹과 페이지 글자 — `followStaff`), `svg.__ppp = {page, pad, rows, tight, begin, bars}`(px, 마디 번호는 Score의 것) + `engraved = {version, engr, plan, planKey, via, producer, config, ledger, diagnostics, notes, hash(getter)}`, `ppp-on/bad/off/ghost`. 좌표는 legacy의 px (`unit: 10`), glyph는 path (`inline`) — `getBBox`가 두 렌더러에서 같은 뜻.

**바꾼 단언** (legacy 쪽 결과는 모두 전과 같음 — base에서 같은 suite가 통과):

| suite | 단언 | 바꾼 것 | 이유 |
| --- | --- | --- | --- |
| engraving | partial chord tie, 추론 tie | `.vf-stavetie path` → `, path.vf-stavetie`도 | 판각기의 tie는 `path.vf-stavetie` 자신 (§16.4) — 선택자 |
| engraving | 8va 두 단언 | 보표선: `.vf-stave path`의 `M x yL` → `path.vf-stave`의 `M x yH`도; 머리: `.vf-notehead path` → 그것 또는 `.vf-notehead` | 판각기는 보표 다섯 줄을 path 하나로, 머리를 path 자신으로 — 선택자 (G4c 리뷰가 맡긴 것) |
| pdf-layer | 굴린 화음의 머리 | `.vf-notehead path` → 그것 또는 `.vf-notehead` | 같음 |
| engraving | "lines hold at most four bars" | legacy: 4 이하 그대로; 판각기: 모든 마디 한 번·순서대로·줄당 6 이하 | 사용자 결정 G4-U4 (4는 선호, 밀도가 이김) — legacy 규칙을 고정한 단언 |
| engraving | "audio inference does not present an intra-measure split as written legato" | legacy: tie 0 그대로; 판각기: tie 1 | 사용자 결정 G4-U2 A (추론 tie를 그림) — legacy 결함 O4를 고정한 단언 (§16.4가 예로 든 것) |
| engraving | "a view of bars inside a longer 8va … (8va)" | legacy: "(8va)" 그대로; 판각기: "(8)" | 이어진 옥타브 선의 인쇄 관례 (G4-D1b-7, A10) |

### 37.8 크기·확대·테마 (A32, A33, A34)

- **A32** (`page-check.js a32`, sonatina/020 전곡): 1400 → 1200 → 1000 → 800 → 1600 → 1400 px에서 layout 0, 그리기 0; 700 px(휴대폰)에서 layout 1, 다시 1400 px는 캐시 적중(layout 0). 가까이 보기 zoom 1 → 1.25 → 1 → 1.25 → 1.6 → 1: 새 zoom마다 layout 1(2번), 나머지는 캐시.
- **A33**: 어두운 테마·종이 없음 — 음표머리·stem·모든 `.ppp-ann` 밝기 > 0.7 (0.95), 보표선 0.46; 밝은 테마와 어두운 테마의 종이 — 잉크 < 0.3 (0.10, 0.09); 테마·종이를 바꿔도 그리기 0. `engraving.test.js`의 어두운 테마 단언(tempo·작곡가·마디 번호)이 `renderer=engrave`에서 통과.
- **A34**: 포인터 처리기는 legacy와 같은 규칙(12 px 문턱, 세로면 pan, 가로면 선택, 탭은 end만, `touch-action: pan-y`); `layout.test.js`(태블릿: 세로 끌기 스크롤, 탭 재생)와 `interactions.test.js`(마디 클릭 seek)가 `renderer=engrave`에서 통과.

### 37.9 전송, resolve 비용, R12, with-port

- **전송** (G4-D2-5): 맞는 `?h=` → `Cache-Control: public, max-age=31536000, immutable`, `Content-Encoding: gzip` (15 파일 420 KB → 전송 139 KB; layout.js 110 → 33 KB); 틀린 `h`·`?v=` → `no-store` (curl로 확인). 기본 페이지는 `?h=`로 묻는 파일이 없다.
- **resolve 비용** (다시 불러온 곡, store에서): sonatina/020 via `store`, resolve 121 ms, long task 209 ms (1×); 527 ms, 가장 긴 long task 878 ms (4×) — IndexedDB 읽기, gunzip, parse, validate, link가 한 덩어리. 멈춤은 아니다 (store timeout 2.5 s, R12). 나누기는 G4f.
- **R12**: `estimate()`·`decode`가 답하지 않아도 put·get이 timeout 안에 끝남 (`store.test.js`).
- **with-port.js**: auth-ui·share가 `PPP_URL` 없이 내 서버로; 8788 health 거부가 suite의 console 오류로 세어지지 않음; `PPP_RENDERER=engrave`; 끝에 "PPPEngrave 0.6.0-g4d2, renderer engrave, engraver draws N, fallbacks …" 한 줄 — 판각기가 실제로 그렸는지 suite마다 보인다.

### 37.10 Acceptance

| # | 기준 | 증거 | 판정 |
| --- | --- | --- | --- |
| A16 | Score, `PianoScore` 재생 이벤트, 연습 판정 입력이 `legacy`/`engrave`에서 바이트 동일 | `page-check.js a16`: 7곡 (Für Elise, sonatina/020, engraving-stress(옛 reader), E18, piano-marks, for-all-the-saints, 녹음 G03(projection)) × 전곡·가까이 보기 — `packScore`, `PianoScore.build`, `PerformanceEngine.expected`의 hash가 네 뷰 모두 같고, `engrave` 뷰는 판각기가 그림 (via live 5, projected 2) | PASS |
| A31 | 프레임당 만진 요소 ≤ 켜짐이 바뀐 수; sonatina/020 전곡 p95 ≤ 1 ms | 페이지: 바뀌지 않은 요소에 쓴 것 0 (1000 프레임, 4× 400), sync p95 0.1 ms (4× 0.5 ms); Node: 4,501 프레임 legacy 규칙과 같음, 쓴 수 = 바뀐 수 | PASS |
| A32 | 같은 breakpoint 안 창 크기 → layout 0; 확대는 캐시 | §37.8 (`page-check.js a32`; Node `page.test.js`) | PASS |
| A33 | 잉크가 테마 변수를 따르고 어두운 테마 글자 밝기 단언 통과 | §37.8; `engraving.test.js`의 어두운 테마 단언이 `renderer=engrave`에서 통과 | PASS |
| A34 | 태블릿 포인터 그대로 | `layout.test.js`·`interactions.test.js`가 `renderer=engrave`에서 통과; 처리기 규칙이 legacy와 같음 | PASS (G4f에서 다시) |
| A45 | `'legacy'`가 옛 SVG를 바이트 동일하게, 기본값 `'legacy'` | 넓힌 고정 (G4-D2-3); `legacy-parity.js` `0ef0950`(8802) 대 이 트리(8801) **16/16 바이트 동일** | PASS |
| A30 (G4f 판정 — 기록) | 브라우저 suite가 `renderer='engrave'`로 통과 | §37.11: 26 suite 가운데 25 통과, 실패 1(`transcription`)은 base·기본에서도 같은 환경 원인. A30의 여덟 suite(engraving, alignment, follow, interactions, layout, musicxml, coach, import)는 모두 판각기가 그린 뷰로 통과 | (G4f) |
| A47 (G4f 판정 — 측정) | 코퍼스에서 fallback 0 | import door 361/361 그림, fallback 0; 옛 reader 2 (§37.6) | (G4f) |
| 버전 규칙 | 출력이 바뀌면 올림 | plan·layout 출력은 바뀌지 않음 (커밋된 layout hash 118 × 2와 plan hash 그대로; `plan/3`, `engr/5`); 캐시 키에 두 버전 | PASS |
| M-H1 도구 | 올바른 packet | §37.14 | PASS |

### 37.11 브라우저 suite (각각 따로, `with-port.js`로 이 트리 8801, base `0ef0950`의 `git archive` 8802; 둘 다 `NODE_ENV=production HOST=127.0.0.1`)

`기본`은 `PPP_RENDERER` 없이, `engrave`는 `PPP_RENDERER=engrave`(문서마다 localStorage `ppp.renderer`). base는 base 트리의 suite 파일을 base 서버에 (하네스는 이 트리의 `with-port.js` — 8788 거부 걸러내기와 context 포트가 없으면 base와 이 트리가 **똑같이** 실패한다, G04 §33.14). 괄호는 `engrave` 실행에서 판각기가 그린 뷰 수 / fallback / legacy로 보낸 축소 뷰 수 (`with-port.js`의 끝 줄). 실행은 `338ddb3`의 트리 — 뒤의 `origin/main` 병합(`5abf8c2`)은 앱·engrave/·suite가 읽는 파일을 바꾸지 않았다.

| suite | 이 트리, 기본 | 이 트리, `engrave` | base, 기본 |
| --- | --- | --- | --- |
| `import.test.js` | PASS | PASS (4 / 0 / 1) | PASS |
| `memory.test.js` | PASS | PASS (1 / 0 / 3) | PASS |
| `learning.test.js` | PASS | PASS (1 / 0 / 3) | PASS |
| `midi.test.js` | PASS | PASS (5 / SOURCE_DISAGREES 3 / 2) | PASS |
| `playback-scheduler.test.js` | PASS | PASS (0 / 0 / 2) | PASS |
| `musicxml.test.js` | PASS | PASS (2 / 0 / 1) | PASS |
| `falling-notes.test.js` | PASS | PASS (2 / 0 / 1) | PASS |
| `interactions.test.js` | PASS | PASS (19 / SOURCE_DISAGREES 4 / 3) | PASS |
| `import-and-persistence.test.js` | PASS | PASS (12 / 0 / 5) | PASS |
| `coach.test.js` | PASS | PASS (1 / 0 / 3) | PASS |
| `i18n-and-auth.test.js` | PASS | PASS (12 / 0 / 11) | PASS |
| `follow.test.js` | PASS | PASS (6 / 0 / 1) | PASS |
| `layout.test.js` | PASS | PASS (2 / 0 / 9) | PASS |
| `alignment.test.js` | PASS | PASS (2 / 0 / 2) | PASS |
| `engraving.test.js` | PASS | PASS (6 / 0 / 2) | PASS |
| `pdf-layer.test.js` | PASS | PASS (0 / SOURCE_DISAGREES 1 / 2) | PASS |
| `library.test.js` | PASS | PASS (45 / 0 / 11) | PASS |
| `transcription.test.js` | FAIL (환경) | FAIL (환경) (0 / 0 / 1) | FAIL (환경) |
| `score-search.test.js` | PASS | PASS (0 / 0 / 0) | PASS |
| `fingering.test.js` | PASS | PASS (3 / 0 / 7) | PASS |
| `video.test.js` | PASS | PASS (17 / 0 / 11) | PASS |
| `auth-ui.test.js` | PASS | PASS (0 / 0 / 77) | PASS |
| `share.test.js` | PASS | PASS (22 / SOURCE_DISAGREES 12 / 3) | PASS |
| `lessons.test.js` | PASS | PASS (0 / 0 / 9) | PASS |
| `hymns-share.test.js` | PASS | PASS (22 / SOURCE_DISAGREES 12 / 3) | PASS |
| `course.test.js` | PASS | PASS (2 / 0 / 3) | PASS |

- **실패 하나는 셋 모두 같다**: `transcription` "the fallback is the venv transkun console script" — 이 PC에 transkun venv가 없음 (G04 §32.8, §33.14의 환경 원인).
- **`engrave`의 fallback은 모두 `SOURCE_DISAGREES`** (Score의 projection이 Score와 다름 — 판각기는 다른 음을 그리지 않고 legacy가 그렸다): `interactions`·`share` — 공유 seed 4곡(두 staff가 voice 1을 같이 씀 → `fromScore`의 손 `x`); `midi` — soft pedal(`una corda`)이 든 테스트 곡 3 (`pedals.length 6 vs 5`); `pdf-layer` — `PdfLayer.apply`가 코드명을 적은 OMR Score (`chords.length 5 vs 4`, 그래서 이 suite의 단언은 legacy가 그린 뷰를 읽었다). 모두 `legacy.fromScore`의 한계 (`scoregraph/`, 이 단계 밖) — §37.16.
- 판각기가 그린 뷰가 0인 suite(`playback-scheduler`, `auth-ui`, `lessons`, `hymns-share`, `score-search`, `transcription`)는 악보 뷰를 그리지 않거나 축소 뷰만 그린다.
- 8777·8788에는 아무것도 띄우거나 끄지 않았다. 측정 뒤 8801·8802를 껐다.

### 37.12 페이지 성능 (측정 — 판정은 G4f; `page-check.js perf`, 이 PC, Chrome 153 headless, 1400 × 1000, sonatina/020 = 158마디 1,563 음 그룹)

| | legacy 1× | engrave 1× | legacy 4× | engrave 4× |
| --- | --- | --- | --- | --- |
| 전곡 열기 (곡을 열어 그려질 때까지, ms) | 261 | 368 | 837 | 1,869 |
| 전곡 판각: layout / SVG / 넣기 / 꾸미기 = 합 (ms) | — | 46.2 / 21.6 / 20.6 / 8.5 = 96.9 | — | 197.4 / 131.9 / 115.9 / 43.2 = 488.4 |
| 원천 resolve (live 그래프 agree·link, ms) | — | 49.8 | — | 282.2 |
| 전곡 열기의 long task (수, 최대 ms) | 1, 111 | 2, 223 | 3, 508 | 3, 1,120 |
| 전곡 재생 프레임 중앙 / p95 (ms) | 6.1 / 13.0 | 5.9 / 9.7 | 47.4 / 64.9 | 33.4 / 53.0 |
| 그 동안의 long task | 0 | 0 | 1 (52 ms) | 0 |
| 판각기 sync p95 (ms; legacy는 프레임마다 1,563 요소) | — | 0.1 | — | 0.3 |
| 가까이 보기 열기 (ms) / 판각 합 | 80.5 / — | 70.1 / 9.1 | 228.2 / — | 133.6 / 44.6 |
| 페이지 넘김 새 창, 중앙 / 최대 (ms) | 14.0 / 16.2 | 10.4 / 15.3 | 86.9 / 112.4 | 57.2 / 64.0 |
| 되돌아가는 넘김 (캐시), 중앙 (ms) | 12.4 | 8.4 | 75.0 | 44.3 |
| 가까이 보기 long task (수, 최대 ms) | 0 | 0 | 19, 133 | 1, 81 |
| 가까이 보기 프레임 중앙 / p95 (ms) | 3.9 / 6.2 | 4.1 / 5.7 | 28.2 / 34.7 | 27.3 / 38.4 |

- **전곡 첫 그리기**: 판각기 한 번에 layout·SVG·넣기·꾸미기가 동기 — long task 하나(1× 223 ms, 4× 1,120 ms). §16.3의 시간 나누기(system 단위, 12 ms)는 G4f 몫이다 (지시의 비목표).
- **재생 프레임**(`setState({beat})` 하나의 앱 전체 비용): 판각기의 sync는 0.1 ms이고, 프레임의 나머지는 React와 브라우저의 다시 칠하기다. glyph를 `<use>`로 둔 첫 구현은 다시 칠하기가 legacy의 4배라 프레임 p95가 legacy보다 느렸다 (14.6 대 9.8 ms); `inline`(G4-D2-6)과 값이 바뀔 때만 쓰는 테마·overlay(G4-D2-12)로 고쳤다.
- **페이지 넘김**(가까이 보기, 새 창): layout + SVG가 캐시에 없는 첫 넘김과 캐시에서 되돌아가는 넘김 (§16.3의 idle 미리 계산은 G4f).
- **다시 불러온 곡의 resolve** (store에서, G4-U1): via `store`, resolve 120.7 ms에 long task 209 ms (1×), 526.6 ms에 가장 긴 long task 878 ms (4×) — IndexedDB 읽기, gunzip, parse, validate, link가 한 덩어리 (멈춤은 아니다: store timeout 2.5 s, R12).
- SVG 크기: 페이지의 sonatina/020 전곡 SVG 1,640 KB (px 단위·glyph path, legacy 2,154 KB, §19.1). B9(`svg.js` 기본 출력, `<use>`)는 G4d-1b의 0.32 그대로.
- Node = Chrome의 엔진 시간 (`browser-parity.js`): sonatina/020 plan 11.5, prepare 9.7, layout 26.2 ms (1×); 61.3 / 55.2 / 115.6 ms (4×).

### 37.13 회귀

| 검사 | 결과 |
| --- | --- |
| CI 단계 전부 (`.github/workflows/bench.yml` gate) + `page-files.js --check` — Windows, `origin/main` 병합 뒤 다시 | 모두 rc 0: unit 283, `test:scoregraph`, **`test:engrave` 183/183** (174 + `page.test.js` 7 + 스위치 1 + R12 1), E·corpus·metrics·outlines·text-metrics `--check`, layout hash 118 × 2, bench r·e·x PASS (61 / 40 / 76), sg-roundtrip, MIDI fixture, golden 17, lint, provenance, correctness, smoke·core·robust run+check PASS (SQI 86.907 / 76.862 / 76.550), replay-public PASS, transcription-core, arranger |
| Linux (Docker `node:24-bookworm`, Node 24.21, `core.autocrlf=false` clone, LF) | `test:engrave` **183/183**, layout hash 118 × 2 + plan 같음, `page-files.js --check` PASS, `test:scoregraph` 216/216 (병합한 `g3-jobs-race.test.js` 포함) |
| CRLF checkout (`git checkout-index` CRLF) | `page-files.js --check` PASS (hash는 CRLF를 LF로 읽음), `app.test.js`·`page.test.js`·`svg.test.js`·`store.test.js` 26/26, layout hash PASS; 전체 `test:engrave` 182/183 — 나머지 1은 `git ls-files`를 부르는 `marks.test.js`(checkout-index 디렉터리는 저장소가 아님; 작업 트리는 CRLF이고 거기서 183/183) |
| `legacy-parity.js` (`0ef0950` 8802 대 이 트리 8801) | **16/16 바이트 동일** |
| `browser-parity.js` (A28) | Chrome 153: layout 808/808, SVG 808/808, **페이지의 SVG 808/808** 바이트 동일; E14 `<use>` 18 오차 ≤ 0.01 sp, **페이지 SVG의 glyph path 14 getBBox 오차 ≤ 0.09 px**; 네트워크 0 |
| 기본 SVG 출력 (`svg.js` 기본값) | `0ef0950`의 `svg.js`와 808 SVG 비교: 바뀐 28 SVG의 64줄 모두 `data-volta` (G4-D2-8) |
| 앱의 기본 경로 | 기본 페이지가 불러오는 파일은 G4d-2 전과 같다 (`app.test.js`); ScoreView 밖의 앱 변경은 `makeScoreView` 앞의 블록과 CSS 네 줄 |

### 37.14 M-H1 도구와 packet (§22.4)

`NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/review-build.js --url http://127.0.0.1:8801` (G4-D2-18).

- **seed** `g4-mh1-2026-09-26` (새 seed, G3-F5처럼). 선택 규칙·층·seed·발췌(파일·마디·센 것)는 packet의 `manifest.json`에; X/Y 열쇠는 따로.
- **층** (§22.4 그대로): 찬송가 다성부 3 (R `hymns`), 셋잇단 3 (R 전체, 보이는 셋잇단 3개 이상), 빽빽한 기호 4 (R `sonatina`), 기본 교재 3 (R `beyer`·`czerny599`), 꾸밈음·8va 2 (R 전체), 반복 1 (R 전체). 층마다 sha256(seed:층:path) 순서의 앞, 8마디 이상, 특징이 가장 빽빽한 8마디. G0 hold-out은 R에 없고 다시 검사한다.
- **그림**: 한 페이지의 ScoreView 둘(`renderer` prop)이 같은 Score(import door — 판각기는 파일의 그래프)를 1000 px 폭, 8마디 줄당 4, 마디 번호, 안내 글자 없음, 켜진 것 없음, 종이 위에. 계산된 색을 각 도형에 적고 class·id·data-*를 지워 어느 렌더러인지 드러나지 않게. 어느 판본이든 제 렌더러가 그리지 않았으면 멈춤 — 이번 16발췌에 fallback 0.
- **packet**: `D:/PPP-g4/tests/engrave/out/review/m-h1/` — `index.html`(발췌마다 X·Y, 질문), `svg/H01-X.svg` … `H16-Y.svg`, `manifest.json`, `results-template.json`(발췌·판본마다 readability, wrong, spacing, marks, overall, practise + prefer, notes). **열쇠**: `D:/PPP-g4/tests/engrave/out/review/m-h1-key/key.json` (평가자에게 주지 않음). 둘 다 `tests/engrave/out/`(gitignore). X가 판각기인 발췌 8, legacy 8.
- **직접 본 것**: 모든 발췌가 두 판본 다 그려졌고 같은 폭이다. 판각기 판본의 눈에 띄는 차이 — 빽빽한 셋잇단(czerny849)은 G4-U4대로 줄당 2마디(legacy는 4마디를 욱여넣음), 파일이 숨긴 셋잇단 숫자는 그리지 않음(legacy는 전부 그림 — O2), 파일의 tempo·셈여림·hairpin·운지·slur·pedal을 그림(legacy는 대부분 없음), 이어진 8va는 "(8)"이고 긴 phrase slur 위라 음에서 멀다(watch list). 찬송가는 성부별 stem·쉼표. 틀린 음·빠진 마디는 보지 못했다.

### 37.15 스크린숏 (직접 봄; `page-check.js shots`, gitignore)

`D:/PPP-g4/tests/engrave/out/page/shots/`: 다섯 곡(G0 hold-out 아님) × 전곡·가까이 보기 × 데스크톱(1400)·휴대폰(390) — `burgmuller25-015`, `sonatina-028`, `czerny849-020`, `hymns-for-all-the-saints`, `beyer-046` 각 `.desktop.whole.png`, `.desktop.close.png`, `.phone.whole.png`, `.phone.close.png` — 와 어두운 테마 `burgmuller25-015.desktop.whole.dark.png`. 본 것: 제목·작곡가, 마디 번호(판각 요소 위로 올려진 것 포함), 현재 마디 wash와 재생선, 첫 화음이 accent로 켜짐, 셈여림·hairpin·pedal·운지·slur·8va, 휴대폰의 줄당 2마디, 어두운 테마에서 밝은 잉크와 연한 보표선, 가까이 보기의 안내 글자(판각 요소 아래로 비킨 것 포함). 처음 찍은 것에서 둘을 고쳤다: 긴 phrase slur의 제어점 상자 때문에 마디 번호가 위 system까지 올라간 것(곡선을 24조각 상자로), 안내 글자가 두 보표 사이 셈여림과 겹친 것(그 아래로).

### 37.16 남은 것 — M-H1, G4e, G4f

- **BLOCKER 0, MAJOR 0** (implementer 자체 판정).
- **M-H1 watch list에 더할 것**: (1) 마디 번호와 안내 글자는 페이지의 글자라 판각기의 skyline 밖이다 — 올리거나 비켜도 기호에 가까울 수 있다; (2) 가까이 보기 창의 첫 마디에도 파일의 tempo 말이 선다 (legacy는 전곡 머리에만); (3) 빽빽한 곡은 줄당 2마디 (G4-U4 — 사용자 결정대로이지만 legacy와 가장 다르게 보이는 곳); (4) 이어진 8va "(8)"과 긴 slur 위의 8va 줄 (G4d-1b에서 넘어온 것).
- **G4f**: 전곡 첫 그리기와 다시 불러온 곡의 resolve는 한 덩어리 long task (§37.12) — §16.3의 시간 나누기·idle 미리 계산; A30 전체와 페이지 수준 A35–A37; routed 축소 뷰(루프 썸네일 `clefs:false`, 빈 보표 `grand:false`)를 판각기로 그릴지 legacy로 둘지 flip 전에 정함; `legacy.fromScore`의 세 한계 — 두 staff가 같은 voice 번호를 쓰는 Score의 손, soft pedal, OMR 코드명 (공유 seed 4곡·테스트 곡·OMR이 legacy로 돌아감; `scoregraph/`); 안내 글자·마디 번호를 layout 객체로 (§16.6).
- **G4e**: 인쇄 (제목 영역, 줄 첫머리 마디 번호 — 페이지의 글자와 겹치지 않게).
- 앱의 `engrave` 경로는 VexFlow(CDN)가 준비될 때까지 기다린다 — fallback이 언제나 바로 그릴 수 있게 (렌더 `ready` 그대로). flip 뒤 CDN 없이 그리려면 G4f·G13.

### 37.17 커밋

`338ddb3` (코드·테스트·도구), `5abf8c2` (`origin/main` 병합 — #21, #22; 겹치는 파일 없음), 이어서 이 기록 (G04 §37, 목차; DECISIONS G4-D2-1–18; CURRENT_STATE). `origin/g4d2-page-integration`에 push. 병합 안 함, PR 없음.

### 37.18 리뷰와 Fixer (2026-09-26)

입력: G4d-2 독립 리뷰(read-only, 대상 `8529611`)의 판정 **NEEDS_FIX — BLOCKER 0, MAJOR 3, MINOR 2**. 리뷰가 확인한 것: 기본 경로에 사용자가 보는 변화 없음(스크립트 사용자 흐름이 base·head에서 DOM·텍스트·네트워크 바이트 단위로 같음; legacy parity 16/16), `server.js`의 새 캐싱은 안전(경로 탈출 없음, 옛 파일과 섞이지 않음, `engrave/`+`vendor/`만 `immutable`), fallback·실패 처리(§16.7) 성립, DOM 계약과 `sync`(A31) 성립, 느슨해진 검사 없음. Lead 지시: MAJOR 셋(R1–R3)과 기록 오류 둘(M1, M2)을 고치고 그 밖은 손대지 않는다. 같은 worktree `D:/PPP-g4`, 브랜치 `g4d2-page-integration`, 시작 `8529611`. 결정은 DECISIONS G4-D2-19–22.

#### 37.18.1 지적과 처리

| # | 지적 (리뷰) | 처리 | 어디 |
| --- | --- | --- | --- |
| R1 (MAJOR) | M-H1 packet이 blind가 아님 — 둘: (1) 리뷰가 받는 `manifest.json`이 X/Y 배정 규칙(`sha256(seed:xy:path)`)과 seed와 파일 경로를 함께 적어, 그것만으로 열쇠를 다시 계산할 수 있다(리뷰가 자기 packet에서 16/16으로 해냄); (2) 판각기가 그린 SVG의 보표선마다 `stroke="none" stroke-width="1.3px"`가 legacy 쪽엔 전혀 없이 붙어(32/32 상관), 규칙 없이도 렌더러를 드러냄 | **FIXED** — (1) `manifest.json`에서 seed와 X/Y 배정 규칙을 빼고 열쇠 파일에만 둠(선택 규칙은 그대로 적음 — 무엇을 어떻게 골랐는지는 필요하지만 X/Y를 어떻게 정했는지는 아님); (2) `review-build.js`의 computed-style 복사가 `<svg>` 루트 자신은 건너뛰어(원래 정규식이 `path\|rect\|text\|...`만 잡고 `svg` 태그는 빠짐) 판각기 루트의 리터럴 `fill="currentColor"`가 그대로 남고, VexFlow 루트의 이미 구워진 색·글꼴 기본값과 비대칭이었던 것이 진짜 원인 — 정규식에 `svg`를 더하고, 루트의 `fill`·`stroke`·`stroke-width`·`stroke-dasharray`·`font-*`를 항상 지움(모든 도형이 이미 제 색을 갖고 있어 필요 없음). 보표선의 `stroke="none"`은 review-build의 `host`가 `document.body`에 바로 붙어 `[data-app]`(테마 루트, `--staff` 등은 거기서만 정의) 밖이라 `.ppp-engraved .vf-stave { stroke: var(--score-staff, var(--staff)) }`가 값 없이 `none`으로 떨어진 것(legacy는 색을 JS에서 한 번 구해 리터럴로 굽는다) — `host`에 `data-app="light"`를 둬서 고침 | §37.18.2 |
| R2 (MAJOR) | 페이지가 그리는 마디 번호·안내 글자가 실제 기보(음표머리·기둥·beam·임시표)와 겹침 — 60개 코퍼스 표본에서 마디 번호 1,698개 중 115개(6.8%), 안내 글자 2,301개 중 234개(10.2%); H5 위반, watch list 수준이 아님 | **FIXED (일반화, 대부분)** — `annotations()`가 독립 bounding-box 검사 대신 판각기 자신의 충돌 기반(`engrave/skyline.js`의 `Skyline`)을 그대로 씀: system마다 하나, 판각기가 그 system에 그린 모든 객체(보표선·마디선·brace 제외)와 곡선으로 채운 뒤, 마디 번호·안내 글자 모두 `Skyline.put()`으로 배치(엔진이 다른 모든 객체를 두는 바로 그 함수) — 근사 오차(실제 글꼴 상승폭이 계산한 상자보다 조금 더 감) 여유로 pad 2.5px. 결과: 마디 번호 3/1,698(0.18%)로 사실상 해결. 안내 글자는 171/2,301(7.4%)로 27% 줄었으나 0은 아님 — 남은 것은 거의 전부 촘촘한 그랜드 스태프 찬송가(위·아래 보표 사이 간격 자체가 좁아, 글자가 들어갈 여지가 구조적으로 없는 마디): 그런 경우 밀어 넣지 않고 밀기 전 자리를 유지(§16.6 G4-D2-7과 같은 정신, 아래 보표로 들어가는 것보다 낫다는 판단). **명명된 추적 지표** `eg.page.annotation_overlap`(목표 0)로 §37.18.3에 남김 — Lead 검토 필요 | §37.18.3 |
| R3 (MAJOR) | 페이지의 실제 인라인 path SVG 출력이 B9(legacy의 0.5배 이하)를 어김 — 5개 실측 중 2개(sonatina/016 0.778, /020 0.787)가 예산을 넘었고 미공개; 4–5배라던 `<use>` repaint 비용의 리뷰 재측정은 약 2배 | **FIXED (옵션 1: 공유 defs + use)** — `engrave/page.js:74`의 `SVG_OPTS`를 `inline: true`에서 `inline: false`로: svg.js의 기본(`<symbol>`을 `<defs>`에 한 번, `<use>`로 참조)을 그대로 씀. B9 완전 회복(§37.18.4). repaint는 실측 필요해 확인 — 서명은 §37.18.4 | §37.18.4 |
| M1 (MINOR) | 기록의 fallback 수가 sonatina/014·026·027을 빠뜨림(import 문 → 저장/공유 → 새 원천 투영에서 `wedges.length` 불일치로 legacy 회귀) | **FIXED (문서만)** — 아래 §37.18.5. `fromScore`의 hairpin 수 불일치 자체는 `scoregraph/`, 이 단계 밖 | §37.18.5 |
| M2 (MINOR) | `<use>` 대 path의 repaint 배수가 "4–5배"로 적혀 있음 | **FIXED (문서)** — 이 Fixer의 재측정으로 교정(§37.18.4, DECISIONS G4-D2-22) | §37.18.4 |

#### 37.18.2 R1 — M-H1 packet을 blind로 (`tests/engrave/tools/review-build.js`; G4-D2-19)

- **manifest**: `seed`를 빼고, `rule`에서 "X는 `parseInt(sha256(seed:xy:path)[0..8],16)`가 짝수일 때 legacy" 구절을 빼 "순서와 X/Y는 이 파일에 없는 열쇠에서 따로 정해진다"로 바꿈. 어느 파일·마디를 어떻게 골랐는지(선택 규칙)는 그대로 — 그것만으로는 X/Y를 알 수 없다. `results-template.json`의 `seed`도 뺌.
- **SVG 루트**: computed-style 복사 정규식에 `svg`를 더하고, 복사 뒤 루트의 `fill`·`stroke`·`stroke-width`·`stroke-dasharray`·`font-family`·`font-size`·`font-weight`·`font-style`를 항상 지움(모든 도형이 이미 자기 색을 들고 있어 루트엔 필요 없음).
- **보표선의 `stroke="none"` 근본 원인**: `host`가 `document.body`에 바로 붙어(앱의 `[data-app]` 테마 루트 밖) `--staff`가 안 보임 → CSS `stroke: var(--score-staff, var(--staff))`가 유효하지 않아 초기값 `none`. `host.setAttribute('data-app', 'light')`로 고침(실제 앱과 같은 조건).
- **다른 체계적 차이도 점검**: 주석(`<!--`) 없음(둘 다), XML 선언 없음(둘 다), `<use>`/`<symbol>`/`id="ppp-g-"` 없음(페이지는 `inline: true`였다 — 지금은 R3로 `false`, 아래 참고), viewBox 소수 자릿수는 내용에 따라 다름(렌더러 식별과 무관). 보표선 두께(`stroke-width`)는 legacy와 판각기가 원래 다른 값을 쓰며(엔진 설계 차이, 화면에 실제로 보임) — 이건 "본다고 알 수 있는" 정상적인 시각 차이이지 숨은 채널이 아니므로 고치지 않음(눈으로 보는 리뷰의 목적 자체가 두 렌더러의 실제 모양을 비교하는 것).
- **검증**: 새 seed `fixer-verify2-2026-09-26`로 test packet을 새로 만들어, (1) manifest만으로 열쇠를 다시 계산 시도 → seed 필드가 없어 실행 자체가 안 됨; (2) 32개 SVG 파일 전체에서 `stroke="none" stroke-width="1.3px"` 문자열 0건(전엔 32/32); (3) 구조적 지문 스캔(주석·XML 선언·`<use>`/`<symbol>`·id 접두사) — 16쌍 어디서도 렌더러를 완전히 갈라내는 특징 없음. `C:/…/scratchpad/r1_verify.js`(세션 scratchpad, 저장소에 없음).

#### 37.18.3 R2 — 마디 번호·안내 글자를 skyline으로 (`engrave/page.js` `annotations()`; G4-D2-20)

- **원인**: 독립 bounding-box와 6/4-pass 고정 걸음(`hits()`)만으로 밀었다 — 판각기의 skyline을 보지 않아, 클레프·다른 성부의 음표머리·beam 등을 놓쳤다.
- **고침**: `engrave/skyline.js`를 page.js에 더해(`require('./skyline.js')`), system마다 `SK.Skyline`을 하나 만들어 판각기가 그 system에 그린 모든 객체(보표선·마디선·brace 제외)와 곡선(24조각)을 채운 뒤, 마디 번호는 `side:'above'`로 `floor`(9px 기본 자리) 기준, 안내 글자는 `side:'below'`로 음 자신의 자리를 `floor`로 `Skyline.put()`에 맡김 — put()이 자동으로 자신도 skyline에 더해, 한 system 안 번호끼리도 서로 본다. pad 2.5px(실제 글꼴 상승폭이 근사식보다 조금 더 가는 여유). 안내 글자는 아래 보표가 있으면 그 위 2px를 넘지 않는 hard limit도 두되, 그 한도를 넘으면(그랜드 스태프 찬송가처럼 방이 아예 없을 때) 밀기 전 자리로 되돌림(§16.6 G4-D2-7과 같은 정신 — 다음 보표로 들어가는 것보단 낫다).
- **명명된 지표**: `eg.page.annotation_overlap`(목표 0, 아직 `l2.js`에 넣지 않음 — 이 pass는 page.js의 것만 고쳤고, 코퍼스 전체 L2 회귀 검사에 편입하는 일은 다음 단계로 남김).
- **검증** (리뷰의 60파일 코퍼스 표본, `coll3.js` — H5 규칙 그대로 notehead·stem·beam·accidental만): 마디 번호 **94 → 3**/1,698(6.8%→0.18%), 안내 글자 **234 → 171**/2,301(10.2%→7.4%). 남은 171은 거의 전부 그랜드 스태프 찬송가의 좁은 보표 간격(예: `hymns/blessed-assurance.musicxml` 12/72, `hymns/o-the-deep-deep-love.musicxml` 30/74) — 위·아래 보표 사이에 안내 글자가 들어갈 자리 자체가 부족한 마디. **완전한 해결(0)은 위·아래 보표 사이 간격을 안내 글자용으로 넓히는 layout 변경이 필요해 이번 pass 범위를 넘는다 — 일반화된 fix(skyline을 탐)이지만, 이 좁은 그랜드 스태프 경우는 별도의 layout 여유가 있어야 완전히 없앨 수 있음을 Lead에 알림.**

#### 37.18.4 R3 — B9과 repaint (`engrave/page.js:74`; G4-D2-21, 22)

- **선택**: 리뷰가 권한 옵션 1(공유 `<defs>` + `<use>`). `SVG_OPTS`를 `{ inline: true }`에서 `{ inline: false }`로 — svg.js가 이미 갖고 있던 기본 방식(글리프마다 `<symbol>`을 `<defs>`에 한 번, `<use>`로 참조)을 페이지가 그대로 쓰게 함. 새 코드를 더 쓰지 않음 — svg.js의 두 모드는 이미 있었고 페이지가 `inline: true`를 골랐던 것뿐.
- **B9 재측정** (리뷰가 쓴 5개 파일, 실제 페이지 SVG, `b9.js`):

| 파일 | 전 (inline) | 후 (defs+use) | gzip 후 |
| --- | --- | --- | --- |
| burgmuller25/021 | 0.575 | **0.238** | 0.135 |
| czerny849/001 | 0.514 | **0.291** | 0.161 |
| sonatina/013 | 0.567 | **0.257** | 0.122 |
| sonatina/016 | 0.778 | **0.341** | 0.180 |
| sonatina/020 | 0.787 | **0.356** | 0.203 |

  5개 모두 0.5 budget 안쪽 — B9 완전 회복, waiver 불필요.
- **repaint 재측정** (`repaint2.js`, sonatina/020 전곡, Chrome trace, 150프레임 재생): `<use>`(지금 기본) 프레임 중앙값 14.0 ms, paint류 trace 합 10.03 ms/프레임(Paint 5.14, Layerize 3.45); `inline`(옛 기본, 요청 가로채기로 되돌려 같은 방법으로 잼) 프레임 중앙값 13.9 ms, trace 합 2.18 ms/프레임 — **trace 합 기준 약 4.6배**(리뷰가 잰 "약 2배"와 방향은 같지만 이 재측정은 그보다 큼), 그러나 **체감 프레임 시간(중앙값)은 사실상 같음**(14.0 대 13.9 ms) — paint류 작업이 16 ms 프레임 예산의 일부에 지나지 않아, 이론적 배수만큼 실제 재생이 느려지지는 않았다. 4–5배라는 기존 기록(§16.3, DECISIONS 관련 행)은 이 수치로 교정한다(M2) — **trace 성분 기준 4–5배가 맞고, 실제 프레임 시간에는 (이 곡에서는) 측정 가능한 차이가 없다**는 것이 더 정확한 서술.
- **결정**: B9이 완전히 회복되고 실측 프레임 시간에 유의미한 퇴행이 없으므로, waiver 없이 옵션 1을 채택. Lead 서명 불필요(허용 요청 아님) — 다만 M-H1 packet·다른 실제 재생 경로에서 더 큰 곡(2,655개 `<use>`보다 많은 곡)의 프레임 시간을 넓게 보는 일은 G4f 성능 판정에 남김.

#### 37.18.5 M1 — fallback 수 정정

`interactions`·`share` suite의 import 문 → 저장/공유 → 새 원천 투영 경로에서 `wedges.length` 불일치로 legacy에 남는 파일은 기존 기록의 두 fixture에 더해 **`sonatina/014`, `sonatina/026`, `sonatina/027`** 셋도 있다(리뷰가 찾음). 근본 원인은 `legacy.fromScore`의 hairpin 개수 불일치(`scoregraph/`, 이 단계 밖) — 고치지 않고 기록만 정정.

#### 37.18.6 게이트

Windows: `npm run test:engrave` 183/183, `npm run test:scoregraph` 216/216, `page-files.js --check` 일치, 다섯 `--check` 도구(`make-e-fixtures`, `make-corpus`, `make-metrics`, `make-outlines`, `make-text-metrics`) 모두 PASS, `bench.js check --suite r|e|x` 모두 PASS(61/40/76 그래프), legacy parity 16/16(`8529611`의 `git archive` 대), R1·R2·R3 검증 위 각 절. Linux(`node:24-bookworm`)는 §37.18.7.

**상태: G4d-2 FIX READY_FOR_RECHECK** — MAJOR 0 (자체 판정; R2의 안내 글자 잔여 171/2,301과 R3의 4–5배 trace 차이는 위에 이름 붙여 남김, Lead 검토 요청).

### 37.19 Lead 재확인과 두 번째 R1 (2026-09-26)

**재확인** (`e40b8f2`의 새 clone) — `test:engrave` 183/183, `test:scoregraph` 216/216, layout hash, `--check` 도구 다섯, bench r·e·x 모두 PASS. `legacy-parity.js` 16/16 (base·head 서버를 각각 띄워 직접 실행). R2는 리뷰의 도구(`coll3.js`)로 직접 다시 재서 마디 번호 3/1,698(수정자 주장과 일치), 안내 글자 39/2,301(수정자의 171보다 낮음 — 방법 차이로 보이나 방향은 개선이라 문제 삼지 않음)을 얻었다.

**두 번째 R1 발견.** R3의 B9 수정(G4-D2-21)이 `SVG_OPTS`를 svg.js의 `<defs>`/`<symbol>` + `<use>` 모드로 되돌렸는데, 이 모드는 legacy가 절대 쓰지 않는 `<use>`/`<symbol>` 태그를 판각기의 모든 SVG에 남긴다 — 알고리즘 없이 태그 존재만 봐도 16/16 완벽하게 갈린다(직접 만든 시험용 packet에서 확인). R1의 두 원인을 고친 뒤에도 R3가 세 번째 원인을 새로 만든 셈이다.

**Lead가 직접, 좁은 범위로 고침** (`a2054ab`, G4-D2-23): `tests/engrave/tools/review-build.js`의 내보내기 복사 단계에서만 각 `<use>`를 그것이 가리키는 `<symbol>`의 리터럴 복제로 바꾸고(자기 x·y를 이동으로, 자기 칠·선 속성을 감싸는 `<g>`에 올림 — 위 칠 계산 루프가 이미 `<use>` 자체에 계산된 칠을 써 두었다), 빈 `<defs>`·`<symbol>` 뼈대를 지운다. **앱의 실제 페이지 출력은 그대로 `inline: false`를 쓴다** — B9는 그대로 회복된 채다. 시험용 packet(seed `lead-recheck2-2026-09-26`, 버림)에서 두 쪽 다 `<use>`·`<symbol>` 0개, 파일 길이 구간이 겹침, 키 복원 시도가 우연 수준(16개 중 6–11개)임을 확인했다. 렌더링도 그대로다(H01 engrave 쪽 스크린샷으로 확인).

**진짜 M-H1 packet을 처음부터 다시 만든다** (예전 packet과 키는 아무도 보지 않은 채 지운다) — 세 번째 seed로, Lead가 병합 직후에.

**상태: G4d-2 CLOSED로 병합 준비 완료.**

---

## 38. M-H1 — 사용자 평가 결과 (2026-09-26)

**Packet**: `review-build.js`, seed 폐기(제3의 seed, 키와 함께 버림). §22.4대로 16개, 각 8마디, blind X/Y. 사용자가 채운 인터랙티브 artifact(https://claude.ai/artifact/DC7WAapLLxWgP4DAut8iai, capability `db`)의 `ratings` collection에서 16/16 회수. 아래 표의 "선호"는 legacy/engrave로 다시 옮긴 것 — 사용자에게는 A/B로만 보였다.

| # | 층 | 선호 | 둘 다 "틀려 보임"? | 비고 |
| --- | --- | --- | --- | --- |
| H01 | 셋잇단음표 | engrave | 둘 다(같은 지적) | 113–115마디의 높은 음에 8va 표시가 없다 — **카탈로그 내용 지적**(그래프가 그대로면 두 렌더러 다 같게 그린다), 렌더러 결함 아님 |
| H02 | 셋잇단음표 | 같음 | 둘 다(같은 지적) | "쉼표가 이상, 8va도" — 카탈로그 내용 지적으로 보임(czerny849/005) |
| H03 | 빽빽한 기호 | **legacy** | 둘 다(다른 지점) | 아래 §38.1 |
| H04 | 꾸밈음·8va | engrave | 둘 다(다른 지점) | engrave 쪽 "모르는 표시" — 새로 그려지는 운지·다이내믹으로 보임(legacy가 원래 안 그리던 것) |
| H05 | 도돌이 | **legacy** | 둘 다(같은 지적) | 아래 §38.2 |
| H06 | 기초 교재 | 같음(만점) | 아니오 | — |
| H07 | 셋잇단음표 | engrave | legacy만 | legacy: 8마디 끝 음표 stem 이상 — **engrave가 고침** |
| H08 | 빽빽한 기호 | 같음(만점) | 아니오 | — |
| H09 | 빽빽한 기호 | 같음 | 둘 다(다른 지점) | legacy: 16–23마디 tie 표시가 음표와 겹침; engrave: 21마디 음높이 질문 |
| H10 | 빽빽한 기호 | engrave | 둘 다(다른 지점) | legacy: 54마디 tie·stem 겹침(렌더러 결함); engrave: 52마디 "치기 어려워 보임"(연주 난이도 의견, 렌더러 결함 아님) |
| H11 | 찬송가 다성부 | 같음 | 둘 다(다른 지점) | — |
| H12 | 찬송가 다성부 | engrave | legacy만 | legacy: 7마디 tie·stem 겹침 — **engrave가 고침** |
| H13 | 꾸밈음·8va | 같음 | 둘 다(같은 지적) | "쉼표와 음표가 겹침" — 두 렌더러 다 같은 자리, 성부(voice) 표기 관례를 처음 보는 사용자의 질문으로 보임 |
| H14 | 기초 교재 | 같음(만점) | 아니오 | — |
| H15 | 찬송가 다성부 | 같음(만점) | 아니오 | — |
| H16 | 기초 교재 | 같음(만점) | 아니오 | — |

**집계**: engrave 선호 5, legacy 선호 2, 같음 9(그중 5는 둘 다 만점). **오직 engrave만 "틀려 보인다"고 답한 발췌는 0개**(M-H2가 요구하는 조건과 같은 기준) — H03·H04에서 engrave가 지적을 받았지만 그 발췌에서 legacy도 같이(H03) 또는 비슷하게(H04, 다만 legacy는 그 발췌에서 지적 없음 — 다시 봄) 지적받았다. H04는 다시 확인: legacy도 wrong=yes였다(36→37 tie가 stem과 겹침). 그러므로 이번 16개 중 **engrave 단독 결함**은 없었다.

### 38.1 H03 — 직접 확인: 107마디 beam·flag (sonatina/024, 100–107마디)

사용자가 engrave(A) 쪽에 "107 마디의 음표가 줄이 이상해보여"라고 적었다. 두 렌더러로 직접 그려 비교(107마디, 홀로 낀 16분음표 F):

- **legacy**: D-C-D-D 16분음표 묶음의 두 줄 beam이 F까지 하나의 대각선처럼 이어져 보이고, F에서 다음 A-G 묶음으로 가는 beam과 시각적으로 맞물려 지그재그 하나처럼 읽힌다.
- **engrave**: F는 이웃 두 묶음과 분리된 자기 플래그(홀로 낀 16분음표의 정석 표기)로 그려진다. 그래프가 이 F에 이웃과의 beam을 주지 않았으므로 G4-D3 규칙(그래프 beam 그대로, 없으면 유도하지 않음)대로 판각한 것으로 보인다.

**판단**: legacy 쪽이 시각적으로 "매끄러워 보이지만" 실제로는 서로 다른 리듬 묶음의 beam이 이어 붙어 보이는 착시이고, engrave 쪽은 정석대로 플래그를 홀로 그린 것 — 다만 그 플래그 모양이 눈에 덜 익어 사용자에게 "줄이 이상하다"는 인상을 준 것으로 판단한다. **결함이 아니라 관례 차이**로 본다. G4e 전에 홀로 낀 16분음표 플래그의 모양(길이·곡률)을 한 번 더 다듬을 여지는 남겨 둔다(§38.3의 관찰 목록).

### 38.2 H05 — 직접 확인: 쉼표 뒤 낮은 음 (czerny599/013, 2–9마디)

engrave로 그려서 직접 봄(legacy도 같은 자리에 같은 지적이 나왔으므로 카탈로그·표기 관례 질문으로 본다): 베이스보표에 매 마디 쉼표 하나 뒤로 낮은 음 몇 개가 촘촘히 이어진다 — 알베르티 베이스류 반주에서 흔한 모양이며, 쉼표와 그다음 낮은 음이 보표에서 가깝게 앉아 "쉼표 아래에 음표가 있다"는 인상을 줄 수 있다. 두 렌더러가 같은 자리를 같게 그렸으므로 **렌더러 차이가 아니라 원곡 표기를 처음 읽는 데서 온 질문**으로 판단한다. 조치 없음.

### 38.3 다음 단계로 넘기는 관찰

- 홀로 낀 16분음표의 플래그 모양(§38.1) — G4e 전에 한 번 더 볼 것.
- H04의 "모르는 표시" — engrave가 legacy는 안 그리던 운지·다이내믹을 그리기 시작해 생긴 익숙함 문제로 보임. M-H2에서 "이게 뭔지 설명" 축을 추가할지 고려.
- G4d-1b의 관찰 목록(§5.1, 빽빽한 찬송가 안내 글자 겹침 등)은 H11·H13·H15에서 실제로 드러나지 않았다 — 두 곡 다 문제로 지적되지 않음.

### 38.4 Verovio 재평가 조건 점검 (§7.3)

방아쇠 조건("기호 배치" 축이나 L2 곡선·충돌 지표가 PPP 배치 층 때문에 목표에 못 미침)은 **성립하지 않는다**: engrave 단독 결함 0개, engrave 선호가 legacy 선호보다 많고(5 대 2), legacy에서만 나온 결함 둘(H07·H10 tie·stem 겹침, H12 tie·stem 겹침)은 오히려 engrave가 고친 것으로 확인됐다. **Verovio spike 불필요 — G4e로 진행한다.**

---

## 39. G4e 구현 기록 — 페이지와 인쇄

Implementer, 2026-09-26. 브랜치 `g4e-print` (`D:/PPP-g4`), 시작 `338508d` (= `origin/main`, M-H1 마감 뒤). 입력은 로드맵 §14 카드, §5.1 G4e 카드, G04 §17·§15.5·§27이다. 병합하지 않았고 PR도 없다 (Lead가 리뷰와 PR을 정한다). 결정은 DECISIONS G4-E1–E7.

**한 줄**: 화면과 같은 plan에서, config `mode:'print'`만으로 A4 여러 페이지 `EngravedScore`를 만든다 — 마디 경계 DP 줄바꿈(밀도만, 화면의 목표 마디 수 없음), system을 쪼개지 않는 페이지 나눔, 제목·작곡가·페이지 번호·마디 번호(줄 첫머리만), 인쇄에서만 묶는 여러 마디 쉼표, 여러 part의 첫 system part 이름. 화면 출력은 바이트 그대로다 (`engr/6`으로 버전만 올림, 236개 비교 전부 SERIALIZATION_ONLY (version)). 페이지의 "인쇄 / PDF로 저장" 명령은 개발용 스위치 뒤에 있다 (기본값 `'legacy'`는 그대로, G4f 전에는 아무도 닿지 않는다).

### 39.1 범위 — §17·§27과 다른 점

| 지시 | 한 일 | 어디 |
| --- | --- | --- |
| 인쇄 줄바꿈 DP (§15.5) | `breaks.js`의 화면 DP(`breakLines`)와 완전히 분리된 `printBreakLines`/`printSystemCost`: 비용 `100·(stretch−1.15)²`, 1마디 +50(전곡이 1마디면 면제), 1–6마디, 마지막 system은 `stretch<1`(압축이 필요했을 상황)일 때만 비용 0(ragged) | `engrave/breaks.js` |
| 페이지 나눔 (§15.5) | system을 절대 쪼개지 않음; 앞에서부터 채움; 마지막 페이지가 system 하나뿐이면 앞 페이지에서 하나를 넘겨받는 시도(두 페이지 다 넘치지 않을 때만) | `engrave/layout.js` `layoutPrint` |
| 제목 영역 (§15.5) | 제목 가운데, 작곡가 오른쪽 — 실제 글자 metric(`metrics-text.js`)으로 정확한 높이를 예약(`titleHeight`); 그래프에 제목·작곡가가 둘 다 없으면 0 | `layoutPrint` |
| 페이지 번호 (§15.5) | 둘째 페이지부터, 페이지 아래 가운데 | `layoutPrint` |
| 마디 번호 (§15.1) | 화면은 매 마디(그대로, `page.js`), 인쇄는 줄(=system) 첫머리만 — `engrave/skyline.js`로 실제 기보와 겹치지 않게 배치 | `layoutPrint` |
| 여러 part 이름 (§15.5) | 첫 system 왼쪽, part의 staff 묶음 세로 가운데; 브레이스 왼쪽에 자리가 없을 만큼 긴 이름은 페이지 밖으로 나가지 않게 자리를 양보(자리는 좁아져도 잘리지 않음, A17) | `layoutPrint` |
| 여러 마디 쉼표 병합 (§17.3, A11) | 인쇄에서만: 굵은 가로선(SMuFL 여러 마디 쉼표 글리프의 hash-mark 변형은 이번 세션에 새 글리프를 박지 않기로 하고 넣지 않음, G4-E2) + 마디 수, staff마다 하나, 첫 system 위 마디 수 글자. 화면은 `mergeRests`를 아예 부르지 않아 매 마디 그대로(G3 마디 단위 연습 결정, §15.1) | `mergeRests`/`stretchRests`, `layoutPrint` |
| 인쇄 EngravedScore (§17.1) | `pages`(여러 항목), 모든 object·system에 `page` — 화면 object는 `page` 필드가 아예 없음(구분 기준) | `layoutPrint` 마지막 조립 |
| 결정론 (§17.3, A38) | 인쇄 hash는 결정론적(3회, fixture 순서 뒤집기); PDF 바이트는 비교하지 않는다 | `print.test.js` |
| 인쇄 명령 (§17.1) | 숨은 컨테이너 하나에 페이지마다 `<svg>`(물리 A4 mm는 CSS `width`/`height`, viewBox는 sp 그대로), `@media print`가 그 컨테이너만 보이게, `@page{size:A4;margin:0}`, `document.fonts.ready` 기다린 뒤 `window.print()` | `engrave/page.js` (`printLayout`, `printSvgs`, `ensurePrintStyle`, `buildPrintContainer`, `fontsReady`, `runPrint`, `printScore`), 앱의 `printScore()`와 "Print / Save as PDF" 버튼(개발 스위치 게이팅, `showPrintControls`) |
| 래스터 0 (A39) | 자동 검사(`<image>`/`<canvas>` 정규식) | `page.js` `noRaster` |
| i18n | ko·ja·zh 3개 문자열(`Print / Save as PDF`, 그 hint); en은 key 그대로 | `i18n/*.json` |

**하지 않은 것** (지시대로): 서버 판각기, 클라이언트 PDF 라이브러리(G4-U3 B), `scoregraph/`·재생·G3 flag 변경, VexFlow 버전, 화면 렌더러 규칙 변경(M-H1 watch list 둘은 손대지 않음), §15.3의 60% 채움 세로 맞춤 스트레치(§15.3에 있으나 이 브리프의 Scope 목록에는 없음 — G4-E7로 G4f에 넘김), part 약어(§15.5 "약어는 그 밖의 system" — 이번엔 첫 system 이름만, G4-E6).

### 39.2 모듈

| 파일 | 한 일 |
| --- | --- |
| `engrave/breaks.js` | `PCOST`, `printSystemCost`, `printBreakLines(count, width, measure, forced, banned)` — `banned`는 여러 마디 쉼표가 병합한 마디가 system을 시작하지 못하게 막는 새 매개변수(화면 `breakLines`는 손대지 않음) |
| `engrave/layout.js` | `PRINT`(A4 mm→sp 상수, 1 sp = 1.75 mm), `TITLE`/`PAGENO`/`MREST` 상수; `mergeRests`, `stretchRests`, `titleHeight`, `centreBandsAt`, `localGeometry`(페이지 독립적인 system 세로 형상); `resolveSystemU`/`walkSystem` — 화면 `layout()`과 `layoutPrint()`가 공유하는, 딱 한 곳에만 있는 코드(뮤테이션 anchor 유일성과 화면 회귀 안전을 위해 이 세션에서 빼냄); `layoutPrint(P, cfg)` — 전체 새 함수. `prepare()`에 `meta`·`parts`·마디 `multiRest` 필드 추가(부가적, 화면 소비 안 함) |
| `engrave/svg.js` | `page` 옵션(어느 페이지를 그릴지, 기본 0); 페이지 소속이 없는 화면 객체는 항상 그림; 이벤트 없는 `rest`(여러 마디 쉼표 막대)도 그리게 최종 필터에 추가 |
| `engrave/page.js` | `printLayout`, `printSvgs`(페이지마다 독립 id 접두사 — 39.7 참고), `noRaster`, `printCss`, `ensurePrintStyle`, `buildPrintContainer`, `fontsReady`, `runPrint`, `printScore` |
| `Piano Coach App.dc.html` | `showPrintControls`/`printBtnStyle`/`printLabel`/`printHint`/`printScore()` 메서드, 템플릿 버튼 하나(`showSheetControls`의 "Whole score" 버튼 옆) |
| `tests/engrave/print-l2.js` (새) | 인쇄 전용 named metric — `splitSystem`(M25), `overflow`, `breakCountErr`, `oneBarAvoidable`, `multirestScreenBars`, `sourceBreakIgnored`, `ledgerAllowDiff`(A40) |
| `tests/engrave/print.test.js` (새, 12) | DP·cost 단위, 실제 페이지 나눔, 제목 영역, A38 결정론, A11/E28, A40, A39, svg.js `page` 옵션, id 충돌 회귀, R 코퍼스 전체, B8 |
| `tests/engrave/layout-mutation.test.js` | M25(system 쪼개짐)과 respectSourceBreaks 뮤테이션 새 블록(자체 러너, print-l2.js로 판정 — l2.js는 한 페이지 가정이라 그대로 못 씀, 39.6) |
| `tests/engrave/tools/print-check.js` (새) | puppeteer로 진짜 6곡을 실제 인쇄 명령으로 PDF까지(Chrome `page.pdf()`가 "PDF로 저장" 대신) |
| `i18n/{ko-KR,ja-JP,zh-CN}.json` | 인쇄 명령 문자열 둘 |

### 39.3 DP 비용 함수 (구현대로, §15.5)

```
stretch = width / natural         (natural: u = 4 sp/quarter일 때 system 폭)
cost(i..j) = last && stretch<1 ? 0 : 100·(stretch−1.15)²
if bars===1 && total>1: cost += 50
1–6마디, 폭 넘침(2마디 이상이면서 rod 합·1.05 > width)은 Infinity
```

"1마디 벌점이 피할 수 없으면 제외"는 별도 분기 없이 DP의 최소화 자체가 한다 — 이웃과 합쳐 비용이 더 낮으면 DP가 그쪽을 고르므로, 벌점은 "피할 수 있을 때만 물린다"는 요구를 그 자체로 만족한다(G4-E1). 마지막 system의 ragged 예외는 화면 breaks.js의 같은 정신(짧은 마지막 줄은 정상)을 인쇄 나름으로 옮긴 것 — `stretch<1`(압축이 필요했을 상황)일 때만 면제하고, `stretch≥1`(성긴, 보통의 마지막 줄)은 그대로 1.15에서 멀어지는 만큼 낸다: 마지막 한 마디를 앞에서 당겨와 더 균형 있게 만드는 선택이 여전히 이기게 하기 위해서다. 60개 파일 정공 코퍼스 스윕으로는 "1마디 벌점 제거"가 실제로 결과를 바꾸는 경우를 찾지 못했다(마디 하나가 시스템 하나만큼 넓어지려면 극단적인 폭이 필요) — 그래서 이 규칙은 `printSystemCost`(공개 함수) 직접 호출로 증명한다(§39.6).

### 39.4 여러 마디 쉼표 병합 (G4-E2)

`prepare()`가 만드는 `P.measures[k]`는 config에 무관(화면·인쇄가 공유) — 그래서 병합은 `prepare()`가 아니라 `layoutPrint()`가 그때그때 만드는 사본(`mergeRests(P)` → `{measures, banned, runLen}`)에서만 한다. 화면 `layout()`은 이 함수를 전혀 부르지 않는다(같은 파일 안에 있지만 화면 코드 경로에서 도달 불가 — 화면 committed hash가 위험해질 일이 없다). 병합 마디의 열린 바(2번째~N번째 마디)는 `M.replacesBar=true`로 표시해 앞 마디 줄을 지운다(정방향 도돌이가 이미 쓰는 그 메커니즘 재사용). 첫 마디는 `springs:[{g:0, rod:8}]`(고정 폭, DP는 보통 마디 하나로 본다)와 굵은 막대+마디 수 객체를 담고, `stretchRests`가 system의 x를 다 구한 뒤 실제 런(run) 전체 폭으로 늘린다. `banned` set은 `printBreakLines`의 새 매개변수로 런의 2~N번째 마디가 system을 시작하지 못하게 막아 런이 절대 쪼개지지 않게 한다.

### 39.5 Acceptance

| # | 기준 | 증거 | 판정 |
| --- | --- | --- | --- |
| A11 | 인쇄 여러 마디 쉼표 | E28 fixture: 화면 6마디 그대로, 인쇄는 굵은 막대+"4" (`print.test.js`) | PASS |
| A38 | 인쇄 layout 결정론(페이지 수·system·hash), 잘림 0, system 쪼개짐 0 | `print.test.js` A38(3회+fixture 뒤집기), R 코퍼스 전체 `eg.page.*` 0(§39.6) | PASS |
| A39 | 인쇄 → 벡터 PDF: 래스터 0(자동), 페이지 수 = layout 페이지 수, 사람이 한 번 확인 | `noRaster`(page.js) 자동; `print-check.js` 6곡 puppeteer `page.pdf()`, 직접 본 페이지(§39.8) | PASS |
| A40 | 화면·인쇄 ledger 동일(허용 목록: multi-rest, meta, tempo, part-name/abbr) | `print-l2.js` `ledgerAllowDiff`, R 코퍼스+E fixture 전체 0 diff | PASS |
| B8 | 인쇄 layout ≤ 2 s(가장 긴 곡) | R 코퍼스 최장 sonatina/024(123마디, 4페이지) 36–43 ms(§39.9) | PASS |

### 39.6 Metric과 Mutation (§23)

`tests/engrave/print-l2.js`의 named metric은 모두 0 목표: `eg.page.split_system`(M25), `eg.page.overflow`, `eg.page.break_count_err`, `eg.page.one_bar_avoidable`, `eg.page.multirest_screen_bars`, `eg.page.source_break_ignored`. l2.js를 그대로 쓰지 않은 이유: l2.js의 많은 검사(세로 간격·겹침 등)가 "system의 y는 한 페이지를 계속 내려간다"는 화면의 전제를 깔고 있어, 여러 페이지 악보에 그대로 물으면 페이지 경계를 넘나드는 질문(2페이지 system 4가 1페이지 system 3 "아래"인가?)이 돼 버린다 — 그래서 별도 파일로 뒀다(공유 부분은 `pageMetrics`가 인자로 받는다).

| # | 결함 | 잡는 metric | 확인 |
| --- | --- | --- | --- |
| M25 | 인쇄에서 system을 두 페이지에 쪼갬 | `eg.page.split_system` | `layout-mutation.test.js` 새 블록: 객체의 `page`를 `sys.x`가 아니라 자기 `box[0]`으로 결정하게 바꿈(x가 system 절반을 넘으면 다음 페이지) — 실제 코드에서 0, 뮤테이션에서 양수 |
| (신규 규칙) respectSourceBreaks | 플래그와 무관하게 항상 forced | `eg.page.source_break_ignored` | E09 fixture(진짜 `Measure.layout.newSystem` 있음): 실제 코드는 true/false가 다른 system 배열(2,3마디 대 5마디 한 줄)을 주고, 뮤테이션은 둘 다 강제해 같아짐 |
| (신규 규칙) 1마디 벌점 | `printSystemCost` 직접(§39.3) | 60개 정공 코퍼스로는 실제 뮤테이션(소스 편집+재로드)이 걸리는 파일을 찾지 못해(격리 규모의 결함이 아니라 아주 좁은 폭 상황에서만 나타남), 공개 함수 자체를 직접 호출해 "+50이 있고 없고"를 증명 — G4-E3(기록만, `print.test.js`) |

기존 M1–M24(스크린)와 A27–A29는 손대지 않았고 `npm run test:engrave` 196/196으로 그대로 통과한다(§39.7).

### 39.7 회귀 — Windows

- `npm run test:engrave` **196/196** (기존 183 + 새 `print.test.js` 12 + `page-files`/`layout-mutation` 갱신 1). `npm run test:scoregraph` **216/216**(변경 없음, 대조).
- 다섯 `--check` 도구(`make-e-fixtures`, `make-corpus`, `make-metrics`, `make-outlines`, `make-text-metrics`) 모두 PASS.
- `layout-hashes.js` — 118곡 × 2 config, `engr/6`로 재작성(§39.7.1). `bench.js check --suite r|e|x` 모두 PASS(61/40/76).
- `python tests/bench/run.py sg-roundtrip` 369개 중 367 pass(기존 2개 allowlist 그대로) — `scoregraph/` 무변경 대조.
- G0 부분집합: `run.py run/check --suite smoke`(SQI 86.907085, 이전과 동일), `run.py run/check --suite core`(SQI 76.862396, 동일), `run.py golden`(17/17 identical).
- `page-files.js --check` PASS(15개 hash 갱신 반영).
- **화면 출력 불변**: `layout-diff.js --base=<338508d 아카이브>` — 118곡 × 2 config **236개 전부 SERIALIZATION_ONLY (version)**, GEOMETRY_ONLY·LEDGER_CHANGE 0.
- 브라우저 suite(`with-port.js`, 8801): `interactions.test.js` 기본·`engrave` 둘 다 52/52, 콘솔 오류 0; `i18n-and-auth.test.js` 전부 PASS(새 문자열 포함); `engraving.test.js`는 `renderer=engrave`에서 기존에 있던 결함 하나("the clef change is drawn inside bar 2" 0 clef)가 그대로 재현됨 — **`338508d`(이 브랜치 시작점) 원본에서도 같은 실패**임을 확인(8802에서 직접 재현), G4e가 만든 회귀가 아니다.

#### 39.7.1 버전과 re-bless (G4-D1a-1)

`engr/5` → `engr/6`. 화면 출력은 바뀌지 않았지만(§39.7의 layout-diff), `layout()`의 전체 계약(새 `page` 필드, 여러 페이지 `pages`)이 넓어졌으므로 규칙대로 올렸다. `plan/3`은 그대로(`plan.js` 무변경). re-bless는 **236/236 SERIALIZATION_ONLY (version)**, GEOMETRY_ONLY·LEDGER_CHANGE 0 — `layout-hashes.js --write`가 버전이 옮았으므로 허용했다(가드는 같은 버전 아래 다른 해시만 거절).

### 39.8 회귀 — Linux

Docker `node:24-bookworm`(Node 24.21), `git -c core.autocrlf=false clone`(LF), `NODE_PATH`는 Windows `D:/PPP/node_modules`를 컨테이너에 읽기전용 마운트.

- `node --test 'tests/engrave/**/*.test.js'` **196/196**.
- `node --test 'tests/scoregraph/**/*.test.js'` **216/216**(대조).
- `layout-hashes.js`, `page-files.js --check`, `bench.js check --suite r|e|x`(61/40/76) 모두 PASS — Windows와 같은 hash(A27 크로스 플랫폼).

### 39.9 성능 (B8, 이 PC, Node 24.17)

R 코퍼스(60개) 중 가장 긴 파일 `catalog/method/sonatina/024.mxl`(123마디)의 인쇄 layout: **36–43 ms** (예산 ≤ 2,000 ms, §19.2). 4페이지로 나뉜다. G0 hold-out 파일 이름은 쓰지 않았다.

### 39.10 실제로 본 것 (사람이 봄)

`tests/engrave/tools/print-check.js`(puppeteer): 실제 앱 페이지를 `?renderer=engrave`로 열고, "인쇄 / PDF로 저장" 버튼이 부르는 바로 그 `PPPEngravePage.printScore()`를 호출한 뒤 Chrome의 `page.pdf()`로 실제 사람의 "PDF로 저장"을 대신했다(§27 G4e 카드 문구 그대로). 6곡: **Für Elise**(1페이지), **For All the Saints**(찬송가, 그랜드 스태프, 2페이지), **Czerny Op. 849 No. 2**(3페이지, 운지·헤어핀·붙임줄), **Sonatina Op. 20 No. 1 III**(5페이지, 빽빽한 16분음표), **E28**(여러 마디 쉼표), **E35**(성악+피아노, 여러 part 이름). 전부 엔진이 계산한 페이지 수와 실제 렌더된 페이지 수가 일치, 래스터 0.

직접 PDF를 읽어(Claude의 PDF 읽기 도구) 1페이지씩 봤다: 제목 가운데·작곡가 오른쪽·마디 번호 1·템포 말이 첫 system 위(Für Elise, Czerny, Sonatina), 한국어 제목이 올바르게 그려짐(For All the Saints, "성도의 믿음 따라"), 브레이스와 part 이름("Voice"/"Piano", E35), 코드명·가사·다이내믹(E35), 운지·슬러·헤어핀·붙임줄·스타카토(Czerny, Sonatina), 여러 마디 쉼표가 4마디 폭 굵은 막대 하나 + "4"로(E28). **처음 찍은 PDF에서 결함 하나를 발견해 고쳤다**(§39.10.1) — 그 뒤로는 결함 없음.

#### 39.10.1 발견하고 고친 것: 페이지 간 글리프 id 충돌

처음 만든 PDF에서 음표머리 하나가 페이지 전체를 뒤덮는 검은 얼룩으로 나왔다(§27 G4e 카드가 요구한 "직접 봄"이 실제로 잡은 결함). 원인: `svg.js`의 `<symbol>` id가 기본값 `ppp-g-*`로 고정돼 있어, 이미 그려진 화면 SVG(숨겨졌을 뿐 DOM에는 남아 있음, unit 10)와 인쇄 컨테이너의 여러 페이지 SVG(unit 1)가 **문서 전체에서 같은 id**를 공유했다 — `<use href="#ppp-g-noteheadBlack">`가 브라우저의 id 해석 규칙대로 그중 하나(치수가 다른 심볼)를 가리켜 10배 커진 글리프가 나온 것. `page.js`의 `printSvgs()`가 페이지마다 `idPrefix: 'ppp-print-' + i + '-g-'`를 주도록 고쳤다(G4-E4). 회귀 테스트(`print.test.js`)를 추가했다.

### 39.11 남은 것 — G4f, 그리고 G4e가 다루지 않은 것

- **§15.3의 60% 채움 세로 맞춤**(페이지가 60% 이상 차면 system 사이를 늘려 아래까지 맞춤): 이 브리프의 Scope 목록에 없어 이번엔 하지 않음 — 지금은 항상 위에 붙임(§15.3 "아니면 위에 붙임" 쪽). G4-E7로 남김. **정정(§39.12): 실제 채움은 R 코퍼스 평균 65.3%, 35/96 페이지가 50% 미만이다 — 드문 예외가 아니라 흔한 경우이므로, G4f 우선순위 목록에서 이 항목을 낮은 우선순위 "있으면 좋은 것"이 아니라 상위에 둔다.**
- **여러 part의 약어**(§15.5 "약어는 그 밖의 system"): 첫 system의 온전한 이름만 구현, 둘째 이후 system의 약어는 하지 않음(ledger는 `part-abbr`를 `drawn`으로 표시하지만 이 세션은 아무 데도 그리지 않는다 — G4-E6, ledger.audit()은 plan 출력만 보므로 실패하지 않는다).
- `engraving.test.js`의 기존 결함("마디 2 안의 clef 변경이 0개") — G4e 이전부터 있던 것, 확인만 하고 손대지 않음(범위 밖, 화면 렌더러 규칙).
- G4f가 할 것: mutation 완성(M1–M25 전부, 이제 M25 포함), `legacy-geometry.js`, perf 도구, CI에 `test:engrave`, M-H2, flip.

### 39.12 리뷰와 Fixer (2026-09-26)

독립 리뷰: **NEEDS_FIX (BLOCKER 0, MAJOR 2, MINOR 3)**. 화면(legacy) 경로는 그대로(legacy parity 16/16, `interactions.test.js`/`i18n-and-auth.test.js` 52/52 두 렌더러 모두), A38·A39·A40·B8은 리뷰 자신의 재측정으로도 유지, DP 줄바꿈은 진짜 최소화(탐욕 근사 아님), id 충돌 수정은 완결. MAJOR 둘을 고쳤다. MINOR 셋(pre-existing id-collision 위험, part-abbr 미방영 G4-E6, 버전 가드가 "같은 바이트의 버전 올림"과 "진짜 변경"을 못 가른다는 것)은 브리프대로 손대지 않았다 — G4f 항목으로만 남긴다.

**R1 (MAJOR) — DECISIONS G4-E7의 근거가 틀림.** G4-E7은 "실제로 본 6곡 모두 첫 페이지가 92% 안팎까지 차 어색하지 않았다"고 §15.3(60% 채움 세로 맞춤) 보류의 근거를 댔다. 리뷰가 R 코퍼스 전체(committed print page 96개)를 재서 평균 65.3%, 35/96 50% 미만, 51/96 70% 미만, Für Elise 18.8%(제목 + 4마디 + 빈 여백)를 찾아냈다 — 이 Fixer가 같은 방법(마지막 system의 아래 끝 ÷ 실사용 페이지 높이, `PRINT.pageH − 2·PRINT.margin`)으로 R 코퍼스(`tests/engrave/corpus.json`, 61개 파일) 전체를 다시 재서 **똑같은 숫자**를 얻었다(96 페이지, 평균 65.3%, 35/96 < 50%, 51/96 < 70%, 최저 Für Elise 18.8%) — 리뷰의 결과가 재현 가능함을 확인했다. **한 일**: DECISIONS G4-E7을 제자리에서 고쳤다(취소선으로 틀린 문장을 남기고 정정을 덧붙임, docs/DECISIONS.md 400행) — §15.3 미구현이라는 결정 자체(이번 사이클 범위 밖의 새 기능)는 바꾸지 않았다. §39.11에 정정 문구를 추가하고, G4f 우선순위에서 §15.3을 "있으면 좋은 것"이 아니라 상위로 올린다고 적었다(위 39.11). §15.3의 세로 맞춤 자체는 **구현하지 않았다** — 브리프의 명시적 지시대로.

**R2 (MAJOR) — 인쇄 출력에 committed 회귀 baseline이 없었음.** `layout-hashes.js`의 `CONFIGS`가 화면(desktop·phone)만 있어, `printBreakLines`/`printSystemCost`/`layoutPrint`가 공유 레이아웃 헬퍼의 의도치 않은 변경으로 조용히 흔들려도 CI가 잡지 못했다(A38의 결정론 테스트는 "같은 코드가 매번 같은 출력"만 증명하지, "이 커밋의 출력이 리뷰받은 그대로"는 증명하지 않는다). **한 일**: 새 파일이나 새 도구를 만들지 않고, `CONFIGS`에 `print: {mode:'print'}` 한 줄을 추가했다(`tests/engrave/tools/layout-hashes.js` 28행) — `createEngraver(plan).layout({mode:'print'})`가 화면과 같은 `EngravedScore` 모양(다만 `pages` 있음)을 내므로 기존 `computeAll`/`diff`/`guard`가 그대로 적용된다. R(61)+E(40)+X(golden 17) 전체 스코프로 118개 스코어 × 3 config(desktop·phone·print)를 `--write`로 다시 썼다 — 화면 두 config의 해시는 그대로(`engr/6`, `plan/3` 버전 유지, 새 config를 추가하는 것뿐이라 브리프대로 버전을 올리지 않았다).

가드 빈틈 하나를 리뷰 전에 직접 찾아 메웠다: `--write`의 기존 가드(`reference()`/`guard()`)는 `origin/main`과의 merge base 파일의 기존 키만 비교한다 — merge base(`338508d`)는 이 브랜치가 아직 병합되지 않아 `print` config를 전혀 모르므로, `printSystemCost`를 바꿔도 버전을 올리지 않은 채 `--write`가 조용히 통과했다(직접 재현해 확인, 아래 부정 대조). `layout-hashes.js`에 `diffAgainstNewConfigs()`를 추가해, merge base가 모르는 (score, config) 쌍은 디스크에 이미 커밋된 파일과 같은 버전 아래 비교하도록 했다 — 병합 전까지는 이 fallback이, 병합 뒤에는 merge base 자체가 print를 알게 되어 원래 경로가 지킨다(DECISIONS G4-E8).

**부정 대조 (negative control)**: `engrave/breaks.js`의 `PCOST.TARGET`을 `1.15` → `1.10`으로 바꾸고(print 전용 비용 함수),
- `node layout-hashes.js` (check): **7개 print 해시만** 달라짐(desktop·phone은 0 — print 전용 변경이 print에만 보임을 확인), exit 1.
- `node layout-hashes.js --write`: 새 `diffAgainstNewConfigs` 가드가 "merge base가 모르는 config에서 같은 버전 아래 커밋된 파일과 다름"으로 **REFUSED**, exit 1, 아무것도 쓰지 않음.
되돌린 뒤(`1.10` → `1.15`) 둘 다 다시 통과(check exit 0, "all the committed hashes"). `git diff --stat engrave/breaks.js`로 작업 트리가 깨끗함을 확인했다 — 부정 대조는 실제 커밋에 남지 않았다.

**회귀 — Windows**: `npm run test:engrave` **196/196**(무변경, 대조), `npm run test:scoregraph` **216/216**(무변경, 대조). 다섯 `--check` 도구(`make-e-fixtures`, `make-corpus`, `make-metrics`, `make-outlines`, `make-text-metrics`) 및 `page-files.js --check` 모두 PASS. `layout-hashes.js`(이제 print 포함) PASS. `bench.js check --suite r|e|x` **61/40/76** PASS(§39.7과 동일한 수). 화면 전용 레거시 parity(`legacy-parity.js`, base `338508d` 8871 대 head 8872) **16/16 byte for byte**.

**회귀 — Linux**: Docker `node:24-bookworm`, `git -c core.autocrlf=false clone`(LF)로 이 Fixer 커밋을 복제. `node --test 'tests/engrave/**/*.test.js'` **196/196**, `layout-hashes.js`(print 포함) PASS, `bench.js check --suite r|e|x` **61/40/76** PASS — Windows와 같은 해시(A27 크로스 플랫폼, print config도 포함해 확인).

**버전**: `engr/6`·`plan/3` 그대로 — print config를 baseline에 추가만 했을 뿐 어떤 layout 출력도 바꾸지 않았다(G4-D1a-1: 새 config 추가는 버전을 요구하지 않는다, 기존 config의 값이 달라질 때만 요구한다).

**G0 hold-out**: 이 기록 어디에도 hold-out 파일 이름을 쓰지 않았다(`tests/engrave/helpers.js`의 `corpusFiles()`가 이미 제외).

**커밋**: 브랜치 `g4e-print`, `fb38d07` 위에. push는 `origin/g4e-print`. PR 없음(Lead가 정한다).

### 39.13 Lead 재확인과 병합 (2026-09-26)

`61bbc7f`의 새 clone에서 독립적으로 재확인했다.

- **R1 재현**: 리뷰어와 같은 방법(마지막 system의 아래 끝 ÷ 쓸 수 있는 페이지 높이)으로 R 코퍼스 61개 파일, 96페이지를 직접 다시 재서 **평균 65.3%, 50% 미만 35/96, 70% 미만 51/96, 최악 Für Elise 18.8%** — Fixer가 적은 수치와 비트 단위로 같았다.
- **R2 재현**: `engrave/breaks.js`의 `PCOST.TARGET`을 1.15 → 1.10으로 심어 봄 — print 항목 7개만 바뀌고 desktop·phone은 그대로(격리 확인), `layout-hashes.js` 검사 exit 1, `--write` REFUSED, 되돌리면 다시 깨끗이 통과.
- **화면 동일성**: base(`338508d`)·head(`61bbc7f`) 서버 두 개를 직접 띄워 `legacy-parity.js` 16/16 바이트 동일.
- **게이트**: `test:engrave` 196/196, `test:scoregraph` 216/216, layout hash·다섯 `--check` 도구·bench r·e·x 모두 PASS(Windows, 이 clone에서 직접).

**병합**: PR #26, CI gate 초록, squash `a33ccd3`. **G4e CLOSED — 다시 열지 않는다.**

**다음**: G4f — mutation 완성, 페이지 성능, M-H2(합격 판정 사람 평가), flip. §15.3 페이지 채움(§39.12에서 정정한 65.3% 평균)이 우선순위 높은 항목.

**상태: G4e CLOSED, 병합 완료.**

---

## 40. G4f-1 구현 기록 — benchmark 완성 (mutation, legacy 비교, 성능, CI)

Implementer, 2026-09-26. 브랜치 `g4f1-benchmark` (`D:/PPP-g4`), 시작 `94c909c` (= `origin/main`, G4e 마감 뒤). 입력은 로드맵 §14 카드, G04 §27 G4f 카드, §23·§24.6·§24.8. **G4f는 두 조각이다 — 이 기록은 G4f-1(엔지니어링 증거 기반)만이다.** flip, `PPP.renderer` 기본값, M-H2 사람 평가 packet은 Lead의 G4f-2(다음 단계) 몫이며 이 세션은 손대지 않았다. 병합하지 않았고 PR도 없다 (Lead가 리뷰와 PR을 정한다).

**한 줄**: mutation M1–M25 전부(§23) 이름 붙은 metric에서 라이브 확인(신규는 M22 하나); `tests/engrave/tools/legacy-geometry.js`(신규)로 옛 렌더러의 SVG와 G4를 5개 범주에서 직접 비교(A43) — 4개는 깨끗이 G4 ≥ legacy, 1개(tuplet 구조적 개수)는 이 도구의 한계로 설명됨(아래); CPU 4배 감속에서 B2·B6 예산 확인(A37, 이미 있던 `page-check.js`를 확장); CI gate는 손대지 않고(이미 90초 예산 안, ~70초 측정) nightly에 전체 mutation 재확인과 puppeteer 세 도구를 새로 얹음; A46·A47·A48은 이미 다른 곳에서 구현된 것을 재확인.

### 40.1 범위 — §27·§23·§24.6·§24.8과 다른 점

이 세션은 **새 판각 규칙을 하나도 넣지 않았다.** 손댄 것은 테스트·도구·CI뿐이다: `tests/engrave/layout-mutation.test.js`(M22 하나 추가), `tests/engrave/tools/page-check.js`(B2 예산 판정 추가), `tests/engrave/tools/legacy-geometry.js`(신규 도구), `.github/workflows/bench.yml`(nightly job 확장). `engrave/`, `Piano Coach App.dc.html`, `scoregraph/`는 이 커밋에서 한 글자도 바뀌지 않았다(§40.6의 회귀가 이를 증명한다 — 화면 legacy parity 16/16 바이트 동일).

### 40.2 Mutation 완전성 (A42) — 감사와 M22

`tests/engrave/layout-mutation.test.js`(그리고 M25는 별도 `test()` 블록)를 G04 §23의 M1–M25 표와 대조했다. **M1–M21, M23–M25는 이미 라이브였다** — 일부는 표가 부른 하나의 결함이 실제로는 두 가지 방식으로 나므로 `a`/`b`/`c` 하위 mutation으로 갈라져 있다(M7a/M7b, M11a/M11b, M18a/M18b/M18c) — 모두 이름 붙은 metric으로 잡히고, 위원회 hash만으로 판정하는 것은 하나도 없었다. 다만 §23 표가 든 예시 metric 이름과 실제 이름이 다른 경우가 있다(G4b·G4c가 이미 정한 것, 이 세션이 바꾸지 않음): M9 `eg.system.scaled_avoidable`(표는 `eg.system.overflow`), M17 `eg.layout.nondeterministic`(표는 `eg.determinism.hash`), M21 `eg.layout.head_staff_wrong`(표는 `eg.staff.assignment_exact`) — 개념은 표와 같고, 이름 붙은 metric이라는 §23의 요구는 그대로 만족한다.

**M22(누락)**: "`sync`가 매 프레임 전체를 훑음" — `engrave/practice.js`의 `createHighlighter().update()`는 앞으로 재생할 때 `ps`/`pe` 두 포인터로 이어서 진행해(B6: 곡 길이와 무관) 실제로 바뀐 음만 "만진다"(`on`/`off`/`touched`). 이 규칙은 `layout.js`가 아니라 `practice.js`에 있고 EngravedScore를 전혀 건드리지 않으므로, 기존 mutation 틀(`run()`이 EngravedScore를 만들고 `l2()`로 재는 방식)로는 표현할 수 없다 — M25(인쇄, `print-l2.js`)와 같은 이유로 별도 `test()` 블록을 두었다(같은 `withEdits`를 그대로 쓴다). Mutation: `ps`/`pe`를 버리고 매 프레임 `byStart`/`byEnd`를 처음부터 다시 훑는다(정확성은 그대로 — `on`/`off`/`touched`는 바이트 동일, 스캔 비용만 바뀐다). 잡는 것: highlighter 자신의 `stats.visited`(§19.2 "만진 요소 수" 대리 지표 그대로) — burgmuller25/015(413 event, 401 프레임)로 재면 정상 코드 `visited=652`(≈ 이벤트 수의 2배, 한 번 훑는 비용), mutation 코드 `visited=125,448`(≈ 192배) — 정확성(`touched=628`, 둘 다 같음)과 성능(방문 수)이 따로 놀 수 있음을 보여 주는 깨끗한 사례다.

**최종: M1–M25 전부 25/25 라이브, 이름 붙은 metric**, N1·N2 바이트 동일(변경 없음, 회귀 확인).

| # | 결함 | 잡는 metric |
| --- | --- | --- |
| M1 | 그래프 beam 무시 | `eg.beam.graph_missing` |
| M2 | 파생 beam 끔 | `eg.beam.derived_missing` |
| M3 | 성부 stem 뒤집음 | `eg.voice.stem_policy_violations` |
| M4 | tuplet 숫자·괄호 안 그림 | `eg.tuplet.missing` |
| M5 | `show.number:'none'` 무시 | `eg.tuplet.show_errors`, `eg.tuplet.suppressed_rendered` |
| M6 | 임시표 0.8 sp 겹침 | `eg.overlap.acc` |
| M7a/M7b | 간격 u→0(배치만/전부) | `eg.spacing.monotonic_violations` / `eg.system.fill_err` |
| M8 | skyline 무시 | `eg.overlap.mark_mark`, `eg.overlap.text` |
| M9 | 줄바꿈 하나 제거 | `eg.system.scaled_avoidable` |
| M10 | 마지막 system 페이지 밖 | `eg.clip.count` |
| M11a/M11b | 쉼표 두 번 그림 | `eg.layout.multiset_diff` |
| M12 | 마디 안 tie 숨김 | `eg.tie.missing` |
| M13 | 셈여림 음표머리 높이 | `eg.overlap.text` |
| M14 | system 넘는 tie 버림 | `eg.tie.missing` |
| M15 | slur 재짝짓기 | `eg.slur.pair_errors` |
| M16 | 꾸밈음 시간 기둥에 | `eg.grace.misplaced`, `eg.layout.multiset_diff` |
| M17 | 배치 순서 비결정 | `eg.layout.nondeterministic` |
| M18a/b/c | layout이 DOM 측정 | A29 정적 검사(`dom-measure`, `dom-global`/`global-object`) |
| M19 | pedal change를 뗌으로만 | `eg.mark.missing.pedal-change`, `eg.pedal.change_err` |
| M20 | 8va 안 음을 울리는 높이로 | `eg.event.written_diff` |
| M21 | staff를 음높이로 고름 | `eg.layout.head_staff_wrong` |
| **M22 (신규)** | **sync가 매 프레임 전체를 훑음** | **highlighter `stats.visited`(B6 대리 지표)** |
| M23 | articulation을 ledger 없이 건너뜀 | `eg.ledger.drawn_missing`, `eg.mark.missing.articulation` |
| M24 | tuplet 괄호가 끝 쉼표 제외 | `eg.tuplet.extent_err` |
| M25 | 인쇄에서 system 두 페이지 쪼갬 | `eg.page.split_system` |
| N1, N2 | no-op 대조군 | 바이트 동일 (확인됨) |

### 40.3 `legacy-geometry.js`와 A43

**새 도구** `tests/engrave/tools/legacy-geometry.js` (G4a·G4b는 만들지 않았다 — `tests/engrave/tools/`에 존재하지 않았음을 확인). 그래프·NotationPlan·legacy Score 무엇에도 기대지 않고, 옛 렌더러가 실제로 그린 SVG의 classed group과 `getBBox()`만으로 잴 수 있는 것을 잰다("엔진 협조 없이 일반 SVG 기하 pass가 셀 수 있는 것"):

| metric | 뜻 | G4 쪽 계산 |
| --- | --- | --- |
| `eg.clip.count` | SVG 자신의 viewBox 밖 요소 | `l2.js`의 같은 이름 metric |
| `eg.overlap.head_head` | 음표머리 bbox가 진짜 겹치고 (거의) 같은 위치가 아님(같은 위치는 일반 pass가 "의도한 공유 unison"으로 볼 수 있는 유일한 모양 — 그래프 없이는 §14.2의 진짜 합법성 검사를 할 수 없어, 이 도구는 그렇다고 스스로 적는다) | `l2.js`의 같은 이름 metric |
| `eg.beam.count` | `.vf-beam` group 수 | `kind:'beam'` 객체 수 |
| `eg.tie.count` | `.vf-stavetie` group 수 | `eng.curves`의 `kind:'tie'` 수(system 넘김 tie는 반쪽 둘로 이미 §13.1대로 셈) |
| `eg.tuplet.count` | `.ppp-tuplet`(앱이 VexFlow의 tuplet 그리기를 감싸는 자기 그룹) 수 | `tuplet-bracket`/`tuplet-number` 객체를 원래 tuplet id로 중복 제거한 수 |

R 코퍼스 61개 전부(§22.2), 화면 desktop config, `NODE_ENV=production HOST=127.0.0.1 PORT=8801 node server.js` + puppeteer로 실측(`tests/engrave/out/legacy-geometry.json`, gitignored):

| 범주 | G4 | legacy | A43 판정 | 방향 |
| --- | --- | --- | --- | --- |
| `eg.clip.count` | 0 | 0 | **PASS**(동률) | 결함 수, 낮을수록 좋음 |
| `eg.overlap.head_head` | 0 | 402 | **PASS** — G4가 확실히 낫다 | 결함 수, 낮을수록 좋음 |
| beam 수 | 4,986 | 3,727 | PASS (구조 표현 차이, 아래) | 구조 개수 |
| tie 수 | 86 | 31 | PASS | 구조 개수 |
| tuplet 수 | 39 | 358 | **표면상 FAIL** — 조사 결과 이 도구의 한계, 아래 | 구조 개수 |

**두 개는 실제 발견**: `eg.overlap.head_head` — legacy는 R 코퍼스 61개에서 402회 진짜 음표머리 겹침을 낸다(찬송가 SATB, 밀도 높은 czerny·sonatina 발췌에서 특히 많다: what-child-is-this 16, sonatina/022 55, burgmuller25/023 53). G4는 0이다(같은 화면 desktop config). 이 도구는 "거의 같은 위치"(0.75 unit 이내, 어느 렌더러든 의도한 공유로 볼 수 있는 유일한 모양)만 겹침에서 뺀다 — 그래프 기반 합법성 검사(§14.2: 다른 성부, 같은 적힌 음, 반대 stem)는 하지 않으므로, 402가 전부 "진짜 결함"이라 단정하지는 않지만, 상당수가 legacy의 다성부 배치 한계(초 2도·unison을 벌리지 않음)로 보인다 — Lead가 M-H2 전에 살펴볼 만한 근거.

**beam·tie 구조 개수 차**: G4가 legacy보다 높다(4,986 대 3,727; 86 대 31) — 병합 규칙이 다르다는 뜻이지 결함이 아니다. G4의 beam 객체는 secondary break가 있는 beam을 별도 하위 그룹으로 셀 수 있고(§11.2), legacy의 `.vf-beam`은 VexFlow의 Beam 인스턴스 하나에 대응한다 — 같은 음악을 셀 때 단위가 다르다. tie도 system 넘김을 G4는 반쪽 둘로 세지만 legacy의 `.vf-stavetie`가 같은 규칙을 따르는지는 확인하지 않았다. 둘 다 "구조가 다르게 세어진다"는 관찰이지, A43이 요구하는 결함 비교가 아니다 — 이 도구가 셀 수 있는 한계로 기록한다.

**tuplet 개수(표면상 FAIL)의 조사**: czerny849/002(31,441 등 세 파일 모두 같은 모양) — 그래프 자체는 tuplet spanner 119개(중복 없음, 각 3개 사건)를 갖는다. `E.plan(g).ledger`를 보면 **13개는 `drawn`, 106개는 `suppressed/show-none`**이다 — MusicXML이 그 106개에 `<tuplet-number>none</tuplet-number>`(또는 동등한 `show.number:'none'`)를 명시한 것이고, G04 §12.1 표("`show.number` ... `'none'` 숫자 없음")대로 G4는 그 지시를 그대로 따른다(연속된 3연음 구간에서 첫 그룹에만 숫자를 매기는 실제 판각 관례). Legacy의 `.ppp-tuplet` group 119개는 이 지시를 무시하고 전부 그리는 것으로 보인다(3파일 다 legacy 개수 ≈ 그래프의 전체 spanner 수, G4 개수 ≈ `drawn` ledger 항목 수와 정확히 일치: czerny849/002 13=13, /005 8=8, /020 12=12). 이 범주에서 "G4 ≥ legacy"라는 raw-count 판정 규칙은 **틀렸다** — 개수가 적은 쪽(G4)이 그래프가 지시한 대로이고, 개수가 많은 쪽(legacy)이 지시를 무시한 것일 가능성이 높다. G4 자신의 정확성은 이미 다른 곳에서 독립적으로 증명되어 있다(`bench.js check --suite r`의 L1 `eg.tuplet.show_ok = 1`, `eg.tuplet.suppressed_rendered = 0`, 이 세션이 새로 만든 것이 아니라 이미 CI에서 도는 것). **결론**: 이 특정 범주는 일반 SVG 개수 비교로는 판정할 수 없다(그래프의 `show.number` 지시를 일반 pass가 읽지 못하므로) — A43의 "모든 범주"를 문자 그대로 채우지 못했다는 뜻이지, G4의 결함이 아니다. Lead에게: (1) legacy가 `show.number:'none'`을 실제로 무시하는지 별도로 확인할 가치가 있다(이 세션은 legacy 소스를 고치지 않으므로 하지 않았다), (2) 이 도구의 tuplet 범주는 A43의 신뢰할 수 있는 신호가 아니라고 기록해 둔다.

### 40.4 성능 — CPU 4배 감속 (A35–A37)

새 perf 도구를 만들지 않고 `tests/engrave/tools/page-check.js`(G4d-2가 이미 `--cpu 1,4`로 두 렌더러를 도는 도구)를 확장했다: `a31`은 이미 B6(sync p95, ≤1ms@1x·≤3ms@4x)를 판정하고 있었고, `perf`는 B2에 필요한 `turns`(가까이 보기, 캐시 없는 페이지 넘김) 배열을 이미 모으고 있었으나 median/max만 내고 p95 판정이 없었다 — `turnP95`와 그 예산 확인(`check()`)을 추가했다. sonatina/020(158마디, 1,563음 — R 코퍼스에서 가장 긴, hold-out 아닌 곡, §19.1과 같은 곡)으로 실측:

| 예산 | 1× | 4× | 판정 |
| --- | --- | --- | --- |
| B2 (가까이 보기 창, 캐시 없음, p95) | 9.4 ms (≤25 ms) | 55.8 ms (≤80 ms) | **PASS** |
| B6 (`sync`, p95) | 0.1 ms (≤1 ms) | 0.4 ms (≤3 ms) | **PASS** |

전체 결과(참고, `tests/engrave/out/page/page-check.json`, gitignored): 전곡 열기 335 ms(1×)/1,459 ms(4×), 전곡 프레임 p95 15.3 ms(1×)/74.7 ms(4×), `sync` touched=바뀐 수 초과 0(1×·4×). B8(인쇄 layout, ≤2s)은 G4e §39.9가 이미 36–43 ms로 확인했고 Node 자체 연산(DOM 없음)이라 CPU 감속과 무관 — 다시 재지 않았다(그 자체가 §40.6의 회귀에서 다시 확인됨).

### 40.5 CI — gate와 nightly (A41)

`npm run test:engrave`(1m 1.5s, Windows; Linux Docker 1m 5.3s)와 `bench.js check --suite r`(8.1s, Windows) — **합계 ≈ 69.6초, A41의 90초 예산 안.** gate job(`.github/workflows/bench.yml`)은 이미 둘 다 돌리고 있었다(G4a부터) — 손대지 않았다. **여유는 20초 남짓뿐이다** — mutation이 한 단계마다 늘어 온 걸 보면(M22를 더해 197개 test), 다음 단계가 여기에 더 얹으면 예산을 넘길 수 있다. Lead에게: 여유가 계속 줄면 원래 §21.5 설계(`mutation.js`를 nightly 전용으로 분리)를 고려할 시점.

nightly job에 추가(기존 G0 전용 단계는 그대로): `npm run test:engrave`·`test:scoregraph`를 gate와 별도로 재확인(전체 mutation suite가 gate뿐 아니라 nightly에서도 독립적으로 도는 것), 그다음 `npm ci`(puppeteer 설치)와 이 트리를 띄운 뒤 `legacy-geometry.js --suite r`(A43), `page-check.js --part perf,a31 --cpu 1,4`(A35–A37), `print-check.js`(A38–A40) — 셋 다 이 프로젝트 CI에서 처음 도는 puppeteer 도구다(G04 §21.5 자신이 "로컬"이라 적어 둔 것들). 실제 GitHub Actions 러너에서 이 세션이 직접 실행해 볼 방법이 없어(오프라인 세션), 세 단계는 `continue-on-error: true`로 두었다 — 러너 특유의 문제(Chrome 다운로드, 리눅스에 없는 글꼴이 글자 metric에 영향)가 nightly를 빨갛게 만들기 전에 Lead가 첫 실제 실행을 보게 하려는 것(JSON은 그래도 artifact로 올라온다). **Lead에게: 병합 뒤 `workflow_dispatch`로 한 번 수동 실행해 실제로 도는지 확인 필요 — 이 세션은 그 확인을 하지 못했다.**

### 40.6 A46·A47·A48 확인

- **A46(G3 독립)**: 이미 `tests/engrave/plan.test.js`("A46: the plan needs no G3")가 구현·통과 중이었다 — G3-off golden 그래프와 G3a(X 세트) 그래프 모두 `E.audit().ok`(허용 목록 밖 `deferred` 있으면 실패), `engrave/`의 모든 파일에 `professionalize(` 없음과 G3 스위치(`PROFESSIONAL_DEFAULT`, `pedalJoin:true`, `g3b:true`) 없음을 정적으로 확인. 이 세션은 손대지 않고 재확인만 했다(`test:engrave` 통과에 포함).
- **A47(import 견고성)**: `page-check.js --part corpus`(G4d-2가 이미 만든 도구, 주석에 "A47은 G4f에서 판정"이라고 스스로 적어 둠)를 실행했다. `helpers.corpusFiles()`(347, provenance 규칙·hold-out 52 제외) + E fixture 40 = 387파일. **거부 26개**는 전부 `tests/scoregraph/fixtures/midi/`의 4음 미만 MIDI fixture(G02 R4 정책, import 문 자체의 오래된 규칙 — G4와 무관, 렌더러에 닿지도 않음). live 경로 361/361 예외 없이 그려짐. parse 경로(184개, musicxml/xml만): drawn:live 175, drawn:projected 7, **fallback 2**(`ending-stop-without-start.musicxml`, `wedge-unpaired.musicxml`, 둘 다 `SOURCE_DISAGREES`) — 이 둘은 `tests/engrave/tools/a48-coverage.js`의 `CORPUS_KNOWN_LOSS`에 **이미 등록된**, 의도적으로 병리적인 ScoreGraph fixture다(끝나지 않은 ending·짝 없는 wedge — 그래프가 정당하게 거부하는 것). A47의 문구는 "fallback 0"이지만 실측은 "새로운 원인 없는 fallback 0, 이미 알려진 2"다 — 조용히 allowlist에 더 넣지 않고 그대로 보고한다(브리프의 지시대로). 페이지 오류 0.
- **A48(왕복 충실도)**: `test:engrave`의 `a48.test.js`가 이미 이 세션 전부터 커버하고 있다(§32.13.7 기록: 544/544 열림, 540 정확, 4는 알려진 손실만) — 이 세션이 새로 만들지 않았다. G4는 Score·`PianoScore`·연습 판정을 전혀 건드리지 않으므로(§16.8, A16: 두 렌더러에서 바이트 동일) A48은 어느 렌더러가 그리는지와 무관하다 — `renderer='engrave'`가 A48을 바꿀 경로 자체가 없다. `test:engrave`가 그대로 통과함으로 확인(재실행하지 않고, 페이지 수준 `a48-coverage.js`도 다시 돌리지 않았다 — 렌더러와 무관하다는 위 이유로, 시간 대비 이득이 낮다고 판단).

### 40.7 회귀 — Windows

- `npm run test:engrave` **197/197**(기존 196 + M22). `npm run test:scoregraph` **216/216**(무변경, 대조).
- `layout-hashes.js` — 118곡 × 3 config(desktop·phone·print) 전부 PASS, 다시 쓰지 않음(버전 그대로, 손댄 layout 코드 없음).
- 다섯 `--check` 도구(`make-e-fixtures`, `make-corpus`, `make-metrics`, `make-outlines`, `make-text-metrics`) 모두 PASS.
- `bench.js check --suite r|e|x` **61/40/76** PASS.
- **legacy parity 16/16**: `legacy-parity.js --a http://127.0.0.1:8802(94c909c 아카이브) --b http://127.0.0.1:8801(이 브랜치)` — 16개 렌더 전부 바이트 동일. 화면 경로 무변경 확인.

### 40.8 회귀 — Linux

Docker `node:24-bookworm`(Node 24.21.0), `git -c core.autocrlf=false clone`(LF, 로컬 clone).

- `node --test 'tests/engrave/**/*.test.js'` **197/197**.
- `node --test 'tests/scoregraph/**/*.test.js'` **216/216**(대조).
- `layout-hashes.js`, 다섯 `--check` 도구, `bench.js check --suite r|e|x`(61/40/76) 모두 PASS — Windows와 같은 hash(A27 크로스 플랫폼).

### 40.9 남은 것 — Lead(G4f-2)에게 넘기는 발견

이 세션이 **고치지 않고** 표시만 하는 것 (브리프의 명시적 지시: "발견은 보고, 고치지 않는다"):

1. **legacy 다성부 겹침**: R 코퍼스에서 legacy가 실제로 402회 음표머리 겹침을 낸다(§40.3) — G4는 0. M-H2 전에 Lead가 눈으로 몇 개 확인해 볼 근거.
2. **tuplet 범주는 A43의 신뢰할 수 있는 신호가 아니다**(§40.3) — 이 도구의 한계(그래프의 `show.number` 지시를 못 읽음)이지 G4의 결함이 아니라고 조사로 확인했지만, legacy가 `show.number:'none'`을 실제로 무시하는지는 별도 확인이 필요(이 세션은 legacy 소스를 고치거나 깊이 추적하지 않았다).
3. **A47의 fallback 2건**은 이미 알려진 것이지만 A47의 "0"이라는 문구를 문자 그대로 채우지는 못한다(§40.6) — allowlist에 넣지 않고 그대로 남긴다.
4. **CI gate 여유 20초 남짓**(§40.5) — 다음 단계가 mutation이나 테스트를 더 얹으면 예산을 넘길 수 있다.
5. **nightly의 puppeteer 세 단계는 실제 GitHub Actions에서 검증되지 않았다**(§40.5) — 병합 뒤 수동 실행 필요.
6. G4e가 넘긴 것들(§39.11, §39.16 이하) — §15.3 60% 채움 세로 맞춤(우선순위 높음, G4-E7), part 약어(G4-E6), G4e 리뷰의 MINOR 셋(다중 `ScoreView` id 충돌 위험, `part-abbr`의 ledger 상태, 버전 가드 한계) — 이 세션이 측정하며 다시 마주치지 않았고, 손대지도 않았다.

### 40.10 커밋

브랜치 `g4f1-benchmark`, `94c909c` 위에: `ef12fd1`(mutation M22·B2 판정·`legacy-geometry.js`), `611a4e8`(nightly CI). push는 `origin/g4f1-benchmark`. PR 없음(Lead가 정한다).

### 40.11 Lead 재확인과 병합 (2026-09-26)

**독립 리뷰**: `f0bdbbb`, read-only. **판정: PASS — BLOCKER 0, MAJOR 0, MINOR 2.**

- 핵심 질문(§40.3의 tuplet 범주)을 직접 재현해 확인: czerny849/002·005·020의 원본 MusicXML에 `show-number="none"`이 106·84·129건 있고, plan의 ledger `drawn` 수(13·8·12)와 정확히 일치한다. legacy 코드(App 11821)는 `show-number`·`bracket`을 전혀 읽지 않고 모든 리듬 묶음에 숫자를 낸다 — **G4의 결함이 아니라 legacy의 결함으로 확정**.
- M22와 나머지 24개 mutation을 전부 다시 돌려 재현했다(N1·N2 바이트 동일 포함).
- nightly의 puppeteer 세 도구를 자기 서버로 직접 돌려 exit 0, 같은 수치 재현.
- legacy의 음표머리 겹침 402건 중 2건을 직접 그려 눈으로 확인 — 실제 겹침(같은 화음 다른 성부).
- MINOR: (1) 서버 기동 대기 루프가 timeout에도 이 단계를 실패시키지 않아, 세 puppeteer 단계의 진짜 실패와 첫 실행 결함을 구분 못 함; (2) CI gate 여유 20–26초(급하지 않음, 이미 기록됨).

**Fixer 없이 Lead가 직접 고침** (한 줄, `5079d64`): 대기 루프 뒤에 `curl -sf ... || exit 1`을 붙여, 서버가 안 뜨면 이 단계 자체가 실패하게 했다. MINOR 하나짜리 한 줄 수정이라 별도 Fixer 사이클을 열지 않았다.

**Lead 재확인**: Windows·Linux에서 `test:engrave` 197/197, `test:scoregraph` 216/216, layout hash·다섯 `--check` 도구·bench r·e·x 모두 PASS(리뷰어가 두 OS 모두에서 직접 실행). YAML 문법 확인(`python -c "import yaml..."`)만 Lead가 별도로 함.

**병합**: PR #28, CI gate 초록, squash `2c6d108`. **G4f-1 CLOSED — 다시 열지 않는다.**

**다음**: M-H2(합격 판정 사람 평가, Lead가 packet을 만든다) → 통과하면 flip(사용자 승인 필요).

---

## 41. G4f-2 구현 기록 — M-H2 (Lead, 2026-09-26)

G4f-1 CLOSED(`2c6d108`, PR #28) 뒤, Lead가 직접 진행. `D:/PPP-g4`에 `origin/main`(`2b68f4e`, docs closeout PR #29 포함)에서 새 브랜치 `g4f2-mh2`를 만들었다(clean, `test:engrave` 197/197 재확인). Implementer 세션은 없다 — packet 제작과 검증은 §22.4가 정한 도구 `review-build.js`를 그대로 쓰는 일이라 Fixer/리뷰 사이클을 새로 열지 않았다(review-depth-by-risk 정책, 도구 자체는 이미 두 번의 독립 리뷰를 거쳤다).

### 41.1 Packet 제작

- 서버 `NODE_ENV=production HOST=127.0.0.1 PORT=8801 node server.js` (같은 트리).
- `NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/review-build.js --url http://127.0.0.1:8801 --out tests/engrave/out/review/m-h2 --key tests/engrave/out/review/m-h2-key --seed <새 무작위 seed>` — seed는 `g4-mh2-` 뒤에 `openssl rand -hex 8`, 이 문서를 포함해 어디에도 적지 않는다(§22.4: "새 seed"). 열쇠는 `D:/PPP-g4/tests/engrave/out/review/m-h2-key/key.json`에만, gitignored, 평가자에게 주지 않음.
- §22.4 그대로 16발췌×8마디, 같은 6개 층(찬송가 다성부 3, 셋잇단 3, 빽빽한 기호 4, 기초 교재 3, 꾸밈음·8va 2, 반복 1). 실제 뽑힌 파일은 M-H1과 부분적으로 겹친다(같은 코퍼스, 다른 seed이므로 8마디 구간과 X/Y 배정은 다르다) — 우연이며 문제 아님.
- fallback 0으로 정상 종료(둘 다 제 렌더러가 그렸다는 스크립트 자체 검사 통과).

### 41.2 Lead의 누출 재확인 (§37.19·§37 fixer가 한 번 고친 문제이므로 매번 직접 확인)

- manifest.json·results-template.json에 seed·X/Y 산식 없음(문구만 "따로 보관, 여기 없음") — grep으로 확인.
- 32개 SVG 전체에서 태그 이름 대칭 확인: X쪽에만/Y쪽에만 있는 태그 0개(`<use>`/`<symbol>` 포함 0/0 — B9 이후 고정된 `inline:false` 그대로).
- 속성 이름도 태그와 같은 방식으로 대칭 확인 — 비대칭 0개.
- 발췌별 파일 크기: X가 큰 것 9개, Y가 큰 것 7개, 비율 0.65~1.56배로 겹침 — 전역적으로 한쪽이 항상 크지 않다(M-H1 사후 검증과 같은 기준).

### 41.3 사용자에게 보여줄 페이지

M-H1과 같은 방식 — `review-build.js`의 원본 `index.html`(결과를 JSON 파일로 손으로 채우는 방식)을 그대로 주지 않고, 인터랙티브 Artifact로 다시 만들었다:

- 데이터: `mh2-prep.js`(M-H1의 `mh1-prep.js`와 동일한 구조)로 manifest + 32 SVG를 base64로 묶어 `mh2-data.json`(4.78 MB) 작성.
- 페이지: M-H1 템플릿을 재사용하되 제목·머리말만 "두 번째이자 마지막" 회차로 고침(질문 축·척도·pill 구성은 §22.4대로 M-H1과 동일 — 방법론을 유지해야 두 회차가 비교 가능하다는 로드맵 §15의 요구). `localStorage` 키 prefix `mh2:`로 분리(같은 브라우저에서 두 회차가 섞이지 않도록; artifact마다 origin이 달라 실질적으로는 이미 격리된다). db collection은 M-H1과 같은 `ratings`(artifact마다 독립 DB이므로 이름이 같아도 섞이지 않음).
- 검증: 로컬 puppeteer로 (a) JS 에러 0, 16장 카드 모두 렌더, (b) 평가 dot 클릭 시 상태 반영과 진행률 갱신, (c) `localStorage` 폴백 저장 확인. 발행 뒤 `ArtifactData`로 `ratings/_leadtest` set→get→delete 왕복 확인(테스트 문서는 삭제됨, 실제 평가 데이터에 영향 없음).
- 발행: `capabilities: {db:{}}`, 기본 접근 규칙(비공개, 소유자만). URL: **https://claude.ai/artifact/S7XGiAUxAUBsepdjDddrgH** ("악보 비교 2차").

### 41.4 다음

사용자가 16개를 채우면(§10 인간 게이트: 새 seed로 ~45분), Lead가 열쇠로 복호화해 §22.4 합격 기준(14/16 이상 G4 ≥ 옛 렌더러; "틀려 보임"이 G4에만 있는 발췌 0; G4의 yes+fix ≥ 옛 렌더러의 yes+fix)을 판정하고 결과를 §42(가칭)에 기록한다. 결과 JSON은 A36 관례대로 커밋한다(열쇠는 결과 기록에만 쓰고 커밋하지 않음). 합격이면 flip 초안을 준비하되 실제 전환은 사용자 승인 뒤에만 한다(§25, §27 G4f 카드). 불합격이면 §16 stop condition대로 사용자에게 보고하고 원인을 분석한다(품질 목표를 몰래 낮추지 않는다).

---

## 42. M-H2 — 사용자 평가 결과 (2026-09-26)

사용자가 16개를 전부 채웠다(`ratings` 콜렉션에서 회수). 열쇠(`m-h2-key/key.json`)로 복호화.

| # | 층 | "전체" 축 (G4/legacy) | 선호 | 둘 다 "틀려 보임"? | 비고 |
| --- | --- | --- | --- | --- | --- |
| H01 | 빽빽한 기호(소나티네) | 3 / **5** | legacy | **engrave만** | 아래 §42.1 — M-H1 §38.1과 같은 자리 |
| H02 | 빽빽한 기호(소나티네) | **5** / 4 | engrave | legacy만 | — |
| H03 | 빽빽한 기호(소나티네) | 3 / **4** | legacy | 둘 다(다른 지점) | sonatina/019, 11–18마디; 조치 불요(둘 다 지적) |
| H04 | 꾸밈음·8va | **5** / 4 | engrave | 아니오 | — |
| H05 | 찬송가 다성부 | 3 / 3(동점) | 같음 | 둘 다(같은 지적) | — |
| H06 | 꾸밈음·8va | 5 / 5(동점) | engrave | 둘 다(다른 지점) | — |
| H07 | 도돌이 | 5 / 5(동점) | 같음 | legacy만 | — |
| H08 | 셋잇단음표 | 3 / 3(동점) | 같음 | 아니오 | 16분 쉼표 이상 리듬 표기 자체에 대한 의견(렌더러 무관) |
| H09 | 기초 교재 | 5 / 5(동점,만점) | 같음 | 아니오 | — |
| H10 | 찬송가 다성부 | 4 / 4(동점) | 같음 | 아니오 | — |
| H11 | 빽빽한 기호(소나티네) | 5 / 5(동점,만점) | engrave | 아니오 | — |
| H12 | 셋잇단음표 | **5** / 4 | engrave | 둘 다(다른 지점) | — |
| H13 | 기초 교재 | 5 / 5(동점,만점) | 같음 | 아니오 | — |
| H14 | 셋잇단음표 | **5** / 3 | engrave | legacy만 | — |
| H15 | 기초 교재 | 5 / 5(동점,만점) | 같음 | 아니오 | — |
| H16 | 찬송가 다성부 | **5** / 4 | engrave | legacy만 | — |

**집계**: "전체" 축 G4 ≥ legacy **14/16**(H01·H03 두 곳만 legacy가 위 — §22.4 기준 정확히 경계값 통과); engrave 선호 7, legacy 선호 2(H01·H03), 동점 7; G4의 yes+fix 14/16 = legacy의 yes+fix 14/16(동점, ≥ 충족); **"틀려 보임"이 engrave에만 있는 발췌 1개(H01)** — §22.4가 요구하는 "0개"를 충족하지 못한다.

### 42.1 H01 — 직접 확인: 107마디, M-H1 §38.1과 같은 자리 (sonatina/024, 100–107마디)

사용자가 engrave 쪽에 "107마디 1·3번째 음표 선이 왜 이상하게 그려졌냐"고 적었다. **이 발췌는 M-H1의 H03과 파일·마디 구간이 완전히 같다**(다른 seed가 우연히 같은 파일·같은 8마디 구간을 뽑았다 — 층 안에서 밀도가 가장 높은 8마디를 고르는 규칙은 seed와 무관하므로, 같은 층에 같은 파일이 뽑히면 구간도 같아진다).

두 렌더러로 107마디를 직접 다시 그려 비교(`mh2-inspect-h01b.js`, 확대):

- **legacy**: E-D-C-D 16분음표 묶음(겹selled beam) 뒤에 F를 짧은 beam 조각으로 연결하고, 거기서 A-G까지 급하게 기울어진 하나의 beam으로 이어 그린다 — 리듬이 다른 음(F는 8분음표, A-G는 16분음표)을 시각적으로 한 beam처럼 이어 붙인 모양.
- **engrave**: F는 이웃과 분리된 자기 플래그(정석적인 고립 8분음표 표기)로, A-G는 별도의 16분음표 double-beam으로 그린다 — 그래프의 실제 리듬·beam 그룹을 그대로 따른 것(G4-D3).

**판단**: M-H1 §38.1과 **동일한 결론** — legacy 쪽이 매끄러워 보이지만 서로 다른 리듬을 하나의 beam으로 잘못 이어 붙인 것이고, engrave 쪽이 정석대로 그린 것이다. 결함이 아니라 관례·낯섦 차이다. 다만 **§38.3에서 "G4e 전에 한 번 더 다듬을 것"이라고 적어 둔 채 실제로는 고치지 않았고**, 그 결과 새 seed가 우연히 같은 자리를 다시 뽑아 같은 지적을 받았다 — M-H2는 진단용이 아니라 합격 판정이므로, 우연히도 이 한 발췌가 §22.4의 "engrave만 틀려 보이는 발췌 0개" 기준을 정확히 어기게 만들었다.

### 42.2 판정

**엄격하게 §22.4대로 읽으면: 불합격.** 세 조건 중 둘(14/16, yes+fix 동점)은 통과하지만, "engrave 단독 결함 0개" 조건이 H01 하나로 어긋난다. 기준을 몰래 낮추지 않는다(§16) — 이것을 조용히 통과 처리하지 않는다.

동시에 정직하게 적어야 할 사실: 이 하나의 예외는 (a) 새로 발견된 결함이 아니라 M-H1에서 이미 조사되고 "결함 아님, 관례 차이"로 판정된 바로 그 자리이고, (b) legacy 쪽이 오히려 서로 다른 리듬을 시각적으로 얼버무려 이어 붙인 것이어서 engrave 쪽이 더 정확한 표기라고 볼 근거가 있으며, (c) 나머지 15개 발췌에서는 engrave가 전체 축에서 5승 0패 9무, 선호 7 대 2, legacy 단독 결함이 3곳(H02·H07·H14·H16 — 그중 H07 도돌이·H14 셋잇단음표는 legacy가 다른 리듬을 다루는 방식의 진짜 약점으로 보인다)에서 나왔다. **밀도 높은 소나티네 층(4개 중 2개, H01·H03)에서 legacy가 "전체" 점수로 이겼다는 패턴**은 우연이 아닐 수 있어 별도로 적어 둔다 — 빽빽한 16분음표 구간의 beam 판단이 engrave에 아직 약점일 수 있다.

**사용자 결정이 필요하다**(품질 기준 문제이지 Lead가 조용히 넘길 일이 아니다): (A) H01의 flag 모양을 다듬는 작은 패치를 하고 새 seed로 세 번째 사람 평가를 도는 것, (B) 이 하나의 예외를 "이미 조사된 관례 차이"로 받아들이고 지금 기준으로 합격 처리해 flip을 진행하는 것. 로드맵 §14/§15, DECISIONS에 결정을 기록한다.

### 42.3 사용자 결정 (2026-09-26)

**사용자가 (B)를 골랐다: "지금 결과로 통과 처리하고 flip 진행."** DECISIONS G4-U6. 기준을 낮춘 것이 아니라, 기준의 한 조건을 어긴 단 하나의 발췌가 이미 조사되어 결함이 아니라고 판정된 자리라는 사실을 사용자에게 그대로 보여 주고, 사용자가 그 예외를 받아들인 것이다 — 이 절이 그 기록이다. **A44(M-H2) = PASS(사용자 결정으로 예외 1개 수용).**

같은 선택지에 "flip 진행"이 명시되어 있었으므로 **flip(기본값 `'engrave'`) 승인으로 기록한다**(§25 2단계). 배포(Render 수동 배포)는 이 프로젝트의 관례대로 병합 뒤 따로 사용자에게 확인한다.

- 결과 JSON: M-H1과 같이 이 절의 표가 기록이다(§22.4는 "결과 JSON을 커밋한다"라고 적었으나 M-H1부터 artifact 방식으로 바뀌어 원본 `results-template.json` 경로를 쓰지 않았다 — 두 회차를 같은 방식으로 남긴다).
- 이후 과제(flip을 막지 않음): 홀로 낀 16분음표 flag 모양(§38.1, §42.1)과 빽빽한 소나티네 구간의 beam 판단(§42.2) — MX 또는 G4 후속 폴리싱.

## 43. G4f-2 flip 구현 기록 — 기본 렌더러를 판각기로

Implementer, 2026-09-26. 브랜치 `g4f2-flip` (`D:/PPP-g4`), 시작 `9bffea3` (= `origin/main`), 코드 커밋 `b2de7da` 뒤 `origin/main`의 #31(`1562066`, M-H2 수용·flip 승인 G4-U6, 문서만)을 병합. 입력은 Lead의 G4f-2 flip 지시, §25 2단계, §37.16의 "flip 전에" 목록. 병합하지 않았고 PR도 없으며 **배포하지 않았다** (Render·Neon 손대지 않음 — 배포는 병합 뒤 Lead가 사용자에게 묻는다). 결정은 DECISIONS G4-F2-1–6.

**한 줄**: `PPP.renderer`의 기본값이 `'engrave'`가 되었다. `?renderer=legacy`, localStorage `ppp.renderer = 'legacy'`, 실행 중 `PPP.renderer = 'legacy'`가 legacy 렌더러로 되돌리는 스위치다 (§25.3 되돌리기, 한 릴리스 동안). 그 밖의 값은 기본값. legacy 렌더러(`draw()`·`buildVoice()`·`sync()`)는 한 바이트도 바뀌지 않았다 (A45 고정 그대로, `?renderer=legacy`에서 parity 16/16). 축소 뷰(루프 썸네일·빈 페이지의 보표)는 판각기 파일을 부르기 **전에** legacy로 보낸다 (G4-F2-2). 제거(§25.2 3단계)는 하지 않았다.

### 43.1 앱 파일의 변경 (`Piano Coach App.dc.html`)

스위치 블록 (`makeScoreView` 앞, "THE ENGRAVER IN THE PAGE"):

| | 전 (`9bffea3`) | 후 |
| --- | --- | --- |
| 기본값 | `const sw = { renderer: 'legacy', strict: false, stats: { fallbacks: {}, bySong: {} } };` | `const sw = { renderer: 'engrave', strict: false, stats: { fallbacks: {}, bySong: {}, routed: 0 } };` |
| URL·저장소 | `if (r === 'engrave') sw.renderer = 'engrave';` | `if (r === 'legacy') sw.renderer = 'legacy';` (`r`은 그대로 `q.get('renderer') \|\| localStorage.getItem('ppp.renderer')` — URL이 저장소를 이긴다) |
| 실행 중 | `set: v => { ENGRAVE_SWITCH.renderer = v === 'engrave' ? 'engrave' : 'legacy'; }` | `set: v => { ENGRAVE_SWITCH.renderer = v === 'legacy' ? 'legacy' : 'engrave'; }` |
| 축소 뷰 | (`engrave/page.js`만 routed로 보냄 — 그 전에 판각기 15 파일을 불러오고 "Engraving…"을 보임) | `engraveView().paint` 첫 줄: `if (p.clefs === false \|\| (p.grand === false && ((p.score && p.score.staves) \|\| 1) > 1)) { stats.routed++; return 'legacy'; }` — page.js와 같은 규칙, 불러오기 전에 |
| 블록 주석 | "a developer's switch … 'legacy' unless …" | 기본은 `'engrave'`(§25.2, G4-U6), `'legacy'`가 되돌리기(§25.3)이며 한 릴리스 뒤 제거(§25.2 3단계), Score·재생·판정은 둘 다 같음(A16), 축소 뷰는 routed(G4-F2-2) |

그 밖: `ENGRAVE_FILES`의 `page` hash (`b6b9e6ef625e` → `51224a4f1526`; `engrave/page.js` 머리 주석의 "default stays 'legacy'"를 고친 것뿐 — 출력·버전 그대로, `page-files.js --write`), 인쇄 명령의 주석 두 곳("dev-switch gated; reaches no one until G4f's flip" → 기본이 판각기인 곳에서 보임). `showPrintControls`의 식은 그대로다 (`S.wholeScore && engraveWanted({ renderer: PPP.renderer })`) — 스위치가 바뀌었으므로 인쇄 명령이 기본으로 보인다.

**손대지 않은 것**: ScoreView 클래스 전부 (`draw()`, `buildVoice()`, `sync()`, `drawKey()`, 두 G4d-2 블록 포함 — `app.test.js` A45의 hash 셋 `c208062f…`, `8ceb975a…`, `80149fb7…`과 NOTATION RENDERER 머리 `b59e39a4…`가 그대로 통과), `loadVexFlow`와 CDN 경로, `scoregraph/`, 재생, G3 flag (A46), 판각 규칙 (layout hash 118 × 3 그대로).

### 43.2 "flip 전에" 정할 것 (§37.16 G4f 목록)

| 항목 | 결정 | 이유·증거 |
| --- | --- | --- |
| routed 축소 뷰 (루프 썸네일 `clefs:false`, 빈 보표 `grand:false`) | **legacy에 둔다, 그리고 앱에서 판각기 파일을 부르기 전에 정한다** (G4-F2-2) | 판각기에는 clef 없는 모드가 없다 (G4-D2-9). 기본이 `'engrave'`가 되자 홈 화면의 "Continue Practicing" 카드(루프 썸네일 하나)만으로 15 파일(전송 152 KB)을 불러오고 썸네일 상자에 "Engraving…"(min-height 120 px)을 띄웠다 — **부정 대조**: 새 줄을 빼면 `page-check.js --part switch`의 홈 화면 검사가 "asked 15, routed 0"으로 실패하고 `app.test.js`의 routed 검사도 실패; 넣으면 홈에서 0 파일, routed 1, fallback 0, 경고 0. routed는 fallback으로 세지 않고 경고하지 않는다 (`PPP.engraveStats.routed`, `with-port.js` 끝 줄이 합산) |
| 전곡 첫 그리기·다시 불러온 곡의 resolve = 긴 한 덩어리 (§37.12) | **재기만 하고 바꾸지 않는다** (지시: 이 단계에서 불러오기·시간 나누기를 다시 설계하지 않음) | §43.5. B5의 "long task 0"은 여전히 어긋난다 (1× 189 ms, legacy 105 ms) — G4d-2 때부터 있던 성질이 이제 기본 경로에 있다. 첫 방문에서 판각기 15 파일은 연습 화면을 처음 열 때 불러오며 첫 보표까지 1× 324 대 319 ms, 4× 902 대 822 ms (legacy) |
| `legacy.fromScore`의 세 한계로 legacy로 돌아가는 곡 (공유 seed 4곡의 손, soft pedal, OMR 코드명) 과 옛 reader의 병리 fixture 2 | **legacy가 그리고 경고한다 — 고치지 않는다** (`scoregraph/`, 이 단계 밖) | 기본 페이지에서 센 수: §43.6. 모두 `SOURCE_DISAGREES`, 모두 legacy가 그림(빈 화면 0), 경고는 뷰마다 곡당 한 번 (프레임마다가 아님) |
| 안내 글자·마디 번호를 layout 객체로 (§16.6) | 이 단계 밖 (판각 규칙 변경) | 지시의 비목표; G4-D2-20의 skyline 배치 그대로 |
| VexFlow(CDN) 대기 (§37.16 끝) | 그대로 | `loadVexFlow`·CDN 제거는 §25.2 3단계·G13 |

### 43.3 바꾼 단언과 도구 (A30 규칙: 옛 기본값이나 옛 결함을 고정한 것만)

| 파일 | 단언·동작 | 바꾼 것 | 이유 |
| --- | --- | --- | --- |
| `tests/engrave/app.test.js` 머리·test 1 주석 | "the default page loads what it loaded before G4d-2" | 정적 `<script>` 목록은 그대로(단언 불변), 주석을 "기본 페이지는 첫 전체 뷰가 그릴 때 판각기 파일을 불러오고, `?renderer=legacy`에서는 아무것도" 로 | 옛 기본값을 적은 문장 |
| `app.test.js` test 2 | `renderer: 'legacy', strict: false`, `if (r === 'engrave') …` | `renderer: 'engrave'`, `if (r === 'legacy') …`; **새로** 스위치 블록을 `vm` sandbox에서 실제로 돌림 — 기본, `?renderer=legacy`, 저장소 `legacy`, URL이 저장소를 이김(두 방향), 빈 `?renderer=`는 저장소로, 그 밖의 값(`vexflow`, `LEGACY`)은 기본, prop이 스위치를 이김(두 방향), 실행 중 `PPP.renderer = 'legacy'`/`'engrave'`/`'nonsense'`, 정하는 동안 불러온 파일 0 | 옛 기본값을 고정한 단언; **되돌리기를 가정하지 않고 시험한다** (지시) |
| `app.test.js` (새 test) | — | 축소 뷰 셋(루프 썸네일, 빈 보표, 여러 보표 곡의 한 보표)은 `'legacy'`, routed 3, fallback 0, 경고 0, 불러온 파일 0, placeholder 없음; 한 보표 곡의 `grand:false`(퀴즈)와 전체 뷰는 `'pending'`과 15 파일 | G4-F2-2 |
| `tests/engraving.test.js` `box()` | "the clef change is drawn inside bar 2" — 판각기에서 0 | `getBBox()`에 그 요소 자신의 `transform`을 적용 (legacy는 잰 요소에 transform이 0개 — 잰 결과 그대로) | **측정의 결함**: 판각기는 마디 안 clef 변경을 작은 glyph로 `<use transform="translate(399.2 174.5) scale(0.67)">`로 그리는데, `getBBox()`는 요소 자신의 transform을 빼고 원점(x 0)으로 읽는다. G4-D2-21(`inline:false`)부터의 실패로 §39.7이 "기존 결함"으로 적은 것 — `origin/main`의 트리·suite를 `renderer=engrave`로 돌려도 같은 실패(재현), 판각기는 그 clef를 마디 2 안(x 399, 마디 294–688)에 바르게 그린다. legacy·기본 모두 통과 |
| `tests/engrave/tools/legacy-parity.js` | 기본 페이지를 열었다 | 두 서버 모두 `?renderer=legacy`, 판각기 SVG면 비교 거부 | A45는 되돌리기(legacy)의 주장; flip 전 base는 그 값을 몰라도 기본이 legacy |
| `tests/engrave/tools/legacy-geometry.js` | 기본 페이지 + `App.setState({renderer:'legacy'})` (이 state는 ScoreView에 닿지 않는다 — 기본값 덕에 legacy를 읽었다) | `?renderer=legacy`, 판각기 SVG면 오류 | 옛 기본값에 기댐; 결과는 G4f-1과 같음 (clip 0/0, head-head 0/402, beam 4,986/3,727, tie 86/31, tuplet 39/358 — tuplet은 §40.3·§40.11의 legacy 결함, exit 1도 G4f-1과 같음) |
| `tests/scoregraph/tools/ottava-check.js` | 기본 페이지 | `?renderer=legacy` | MX-1의 "drawn"·"views"는 legacy SVG(보표선 path·라벨 글자)를 잰다 — 판각기의 8va는 A10 (`tests/engrave`). 통과 |
| `tests/engrave/tools/page-check.js` | `?renderer=` 두 값 | `'default'`(쿼리 없음)와 `--renderers`; perf의 B2 판정은 legacy가 아닌 쪽; corpus·reload는 첫 비-legacy; **새 part** `switch`(기본·되돌리기 URL·저장소·실행 중, 인쇄 명령이 전곡 보기·판각기에서만, 홈 썸네일 routed·경고 0·파일 0), `first`(빈 캐시 첫 방문) | 기본 페이지를 잴 수 있게; 되돌리기를 페이지에서 시험 |
| `tests/engrave/tools/print-check.js` | `?renderer=engrave` | 기본 페이지(`--renderer`로 바꿀 수 있음) + 전곡 보기에 "Print / Save as PDF"가 보이는지 먼저 확인 | 인쇄 명령이 이제 사용자에게 보인다 |
| `tests/engrave/tools/with-port.js` | `PPP_RENDERER=engrave`가 판각기를 켬 | 주석: `PPP_RENDERER=legacy`가 되돌리기, 없으면 기본(판각기); routed = page.js + 앱의 routed | 옛 기본값을 적은 문장, G4-F2-2의 카운터 |
| `storage-failure.js`, `app-source-check.js` | "drawn by the legacy renderer" | "기본 렌더러가 그린다" (단언 불변 — `g.ppp-note` 수) | 옛 기본값을 적은 문장 |

### 43.4 Acceptance

| # | 증거 | 판정 |
| --- | --- | --- |
| A45 | `legacy-parity.js` base `origin/main`(`9bffea3`의 `git archive`, 8802) 대 이 트리(8801), 둘 다 `?renderer=legacy`: **16/16 바이트 동일**. `app.test.js` A45 test (hash 넷) 그대로 통과 | PASS |
| A30 | §43.5의 표: 여덟 suite(engraving, alignment, follow, interactions, layout, musicxml, coach, import)가 **기본 페이지**(판각기가 그림)와 **`renderer=legacy`** 둘 다 통과 | PASS |
| A16 | `page-check.js a16`: 7곡 × 전곡·가까이 보기, `packScore`·`PianoScore.build`·`PerformanceEngine.expected` hash가 legacy·engrave에서 같음 (live 5, projected 2) | PASS |
| A31–A34 | `a31`: touched ≤ changed (쓴 것 중 안 바뀐 것 0, 1× 1000·4× 400 프레임), sync p95 0.1 ms (4× 0.5 ms); `a32` 셋, `a33` 셋 통과; A34 — `layout`·`interactions` suite 두 렌더러 통과 | PASS |
| A35–A37 | §43.6 — B2·B6 PASS, B5의 "long task 0"은 FAIL(G4d-2부터, §37.12), 전곡 재생 프레임은 legacy보다 느림(§43.8) | 부분 — Lead 판단 |
| A38–A40 (인쇄, 기본 페이지) | `print-check.js`(기본 페이지): 6곡 모두 명령이 전곡 보기에 보이고, 엔진 페이지 수 = 인쇄 페이지 수 (1, 2, 3, 5, 1, 1), 래스터 0; Für Elise PDF를 직접 봄 (제목·작곡가·템포·마디 번호, G4-E7의 18.8% 채움 그대로). `switch`: 가까이 보기에는 명령 없음, 전곡 보기에 있음, `?renderer=legacy`·저장소 `legacy`·실행 중 `'legacy'`에서 없음 | PASS |
| A47 | `page-check.js corpus`(기본 페이지): import door 361/361 그림(live), fallback 0; 옛 reader 184 중 live 175·projected 7, **fallback 2** (G4f-1과 같은 두 병리 fixture, §40.6); 거부 26 (4음 미만 MIDI, R4); 페이지 오류 0 | 그대로 (G4f-1 기록) |
| G0 | `run.py golden` 17/17 identical, `run.py correctness` 13/13 — MusicXML export·Score는 바뀌지 않음 (`scoregraph/`·`audio-score.js` 무변경) | PASS |

### 43.5 브라우저 suite (각각 따로, `with-port.js`, 이 트리 8801, base `9bffea3` 8802; 둘 다 `NODE_ENV=production HOST=127.0.0.1`)

`기본` = `PPP_RENDERER` 없음(판각기), `legacy` = `PPP_RENDERER=legacy`. 괄호는 기본 실행의 판각기 그림 / fallback / routed (with-port 끝 줄; routed는 paint 수).

| suite | 기본 | legacy |
| --- | --- | --- |
| import | PASS (4 / 0 / 1) | PASS |
| memory | PASS (1 / 0 / 3) | PASS |
| learning | PASS (1 / 0 / 3) | PASS |
| midi | PASS (5 / SOURCE_DISAGREES 3 / 2) | PASS |
| playback-scheduler | PASS (0 / 0 / 2) | PASS |
| musicxml | PASS (2 / 0 / 1) | PASS |
| falling-notes | PASS (2 / 0 / 1) | PASS |
| interactions | PASS (19 / SOURCE_DISAGREES 4 / 3) | PASS |
| import-and-persistence | PASS (12 / 0 / 5) | PASS |
| coach | PASS (1 / 0 / 3) | PASS |
| i18n-and-auth | PASS (12 / 0 / 11) | PASS |
| follow | PASS (6 / 0 / 1) | PASS |
| layout | PASS (2 / 0 / 9) | PASS |
| alignment | PASS (2 / 0 / 2) | PASS |
| engraving | PASS (6 / 0 / 2) — `box()` 고친 뒤; 고치기 전 FAIL 1 ("clef change … 0 clef(s)", §43.3) | PASS |
| pdf-layer | PASS (0 / SOURCE_DISAGREES 1 / 2) | PASS |
| library | PASS (45 / 0 / 11) | PASS |
| transcription | FAIL (환경) (0 / 0 / 1) | FAIL (환경) |
| score-search | PASS (페이지 없음) | PASS |
| fingering | PASS (3 / 0 / 7) | PASS |
| video | PASS (17 / 0 / 11) | PASS |
| auth-ui | PASS (0 / 0 / 77) | PASS |
| share | PASS (21 / SOURCE_DISAGREES 12 / 3) | PASS |
| lessons | PASS (0 / 0 / 9) | PASS |
| hymns-share | PASS (0 / 0 / 1) | PASS |
| course | PASS (2 / 0 / 3) | PASS |

- **`transcription`의 실패는 셋 다 같다**: "the fallback is the venv transkun console script" — 이 PC에 transkun venv가 없음 (§32.8, §37.11). base(`9bffea3`) 기본에서도 같은 단언이 같은 이유로 실패.
- base의 `engraving`: 기본(legacy) PASS, `renderer=engrave` FAIL — 같은 clef 단언 (§43.3의 측정 결함이 `origin/main`에 이미 있었음을 확인).
- 그 밖에 실행한 페이지 도구 (기본 페이지): `storage-failure.js` 전부 통과 (IndexedDB 없음·open throw·quota — 판각기가 projection으로 그림); `app-source-check.js` 1 실패 = `PPPEngrave.version === '0.1.1-g4a'` 고정(낡은 G4a 단언, base `9bffea3`에서도 똑같이 실패 — flip과 무관, 손대지 않음); `ottava-check.js`(`?renderer=legacy`) 통과; `legacy-geometry.js` G4f-1과 같은 수.

### 43.6 측정 (이 PC, Chrome headless, 1400 × 1000, sonatina/020 = 158마디 1,563 음 그룹; `page-check.js --renderers default,legacy --cpu 1,4`)

이 PC에서 다른 프로그램(Unity·게임 등, CPU 사용 약 65%)이 함께 돌았다 — 4× 수치는 흔들린다 (아래 B2).

| | 기본(판각기) 1× | legacy 1× | 기본 4× | legacy 4× |
| --- | --- | --- | --- | --- |
| 전곡 열기 (ms) | 370 | 247 | 1,869 | 875 |
| 전곡 판각: layout / SVG / 넣기 / 꾸미기 = 합 (ms) | 36.7 / 13.0 / 18.3 / 9.8 = 77.8 | — | 176.3 / 74.9 / 112.0 / 43.0 = 406.2 | — |
| 원천 resolve (live, ms) | 52.4 | — | 275.7 | — |
| 전곡 열기의 long task (수, 최대 ms) | 3, 189 | 1, 105 | 3, 985 | 3, 544 |
| 전곡 재생 프레임 중앙 / p95 (ms) | 10.1 / 19.3 | 5.7 / 9.7 | 71.5 / 100.7 | 45.5 / 66.4 |
| 그 동안의 long task (수, 최대) | 0 | 0 | 20, 73 ms | 0 |
| sync p95 (ms) | 0.1 | (전부 씀) | 0.3 | — |
| 가까이 보기 열기 (ms) | 77.9 | 74.1 | 161.7 | 221.8 |
| 페이지 넘김 새 창 중앙 / p95 (ms) | 10.5 / 11.7 | 11.5 / 14.7 | 56.6 / 60.8 | 79.3 / 92.9 |
| 되돌아가는 넘김 중앙 (ms) | 9.4 | 10.9 | 50.2 | 69.6 |
| 가까이 보기 long task | 0 | 0 | 1 (78) | 20 (120) |
| 가까이 보기 프레임 중앙 / p95 | 4.5 / 7.2 | 3.9 / 5.6 | 27.5 / 37.8 | 22.5 / 35.3 |
| 다시 불러온 곡 (store) resolve, long task | 100.1 ms; 2, 최대 194 | — | 344.4 ms; 5, 최대 854 | — |

**B 예산** (§19.2): B2 p95 11.7 ms ≤ 25 (1×), 60.8 ms ≤ 80 (4×) **PASS** — 단, 부하가 더 큰 두 번째·세 번째 4× 실행에서 87.9, 102.9 ms (같은 실행의 legacy 넘김도 92.9 → 113.3 ms로 느려짐; 판각기가 legacy보다 느린 적은 없음). B4·B5의 시간: 전곡 판각 합 77.8 ms (+ resolve 52.4) — 300 ms 안. **B5의 "조각 ≤ 12 ms, long task 0"은 FAIL** (시간 나누기 없음 — §37.12부터 알려진 것; 1× 189 ms, 4× 985 ms 한 덩어리. legacy도 105 / 544 ms). B6 0.1 / 0.5 ms PASS (`a31`). B7 PASS (`a32`). B8 36–43 ms (§39.9). B9 0.24–0.36 (G4-D2-21) — **리뷰 뒤 inline으로 0.51–0.78 (G4-L6, §43.10)**.

**첫 방문** (`page-check.js first`: 새 browser context = 빈 캐시·저장소, 홈 → 연습):

| | 앱까지 (ms) | 연습 → 첫 보표 (ms) | 홈에서 부른 판각기 파일 | 판각기 파일 (수, 전송 KB) | 전체 전송 (KB) | long task (수, 최대 ms) |
| --- | --- | --- | --- | --- | --- | --- |
| 기본 1× | 1,362 | 324 | 0 | 15, 151.8 | 6,046 | 3, 109 |
| legacy 1× | 1,348 | 319 | 0 | 0 | 5,965 | 2, 119 |
| 기본 4× | 3,023 | 902 | 0 | 15, 151.8 | 6,046 | 10, 540 |
| legacy 4× | 3,019 | 822 | 0 | 0 | 5,965 | 8, 783 |

판각기가 기본이 되어 새로 드는 비용은 연습 화면을 처음 열 때 15 파일·152 KB(전체의 2.5%)와 4×에서 첫 보표까지 +80 ms — 예산을 넘는 새 항목은 아니다 (G4-F2-2 없이는 홈 화면이 이미 이것을 치렀다).

**fallback으로 legacy가 그리는 곡** (기본 페이지): 코퍼스(`corpus`) — 옛 reader의 병리 fixture 2 (`SOURCE_DISAGREES`: 짝 없는 wedge `wedges.length 2 vs 0`, 시작 없는 ending `measures.bar`); 브라우저 suite — `share` 12 (공유 seed 4곡의 손 `x`, §37.6), `interactions` 4 (같은 seed), `midi` 3 (soft pedal), `pdf-layer` 1 (OMR 코드명). 모두 legacy가 그렸고(직접 확인: 두 fixture × 전곡·가까이 보기, legacy SVG, 음 3개, "Engraving…" 0), 경고는 뷰마다 곡당 한 번이다.

### 43.7 회귀 — Windows와 Linux

- Windows: `npm run test:engrave` **198/198** (197 + 새 routed test 1), `npm run test:scoregraph` **216/216**, `layout-hashes.js` 118 × 3 그대로, `page-files.js --check`, 다섯 `--check` 도구 PASS, `bench.js check --suite r|e|x` PASS (61 / 40 / 76), `run.py golden` 17/17 identical, `run.py correctness` 13/13.
- Linux (Docker `node:24-bookworm`, Node 24.21.0, `git -c core.autocrlf=false clone`의 `b2de7da`, LF 확인): `test:engrave` **198/198**, `test:scoregraph` **216/216**, `layout-hashes.js`, `page-files.js --check` PASS.
- #31 병합(문서 셋만)은 코드·테스트가 읽는 파일을 바꾸지 않았다.

### 43.8 사용자에게 보이는 것, 남은 것 (Lead에게)

**보이는 것**: 모든 악보 화면(연습의 전곡·가까이 보기, 미리 보기, 검토, My Songs·공유 카드, Progress 썸네일, 퀴즈)을 판각기가 그린다; 홈의 루프 썸네일과 빈 페이지의 보표는 legacy 그대로. **전곡 보기에 "Print / Save as PDF" 명령이 나타난다** (가까이 보기에는 없음). 연습 화면을 처음 열 때 판각기 파일을 받는 동안 "Engraving…". fallback 곡(공유 seed 4곡 등)은 legacy 모양 그대로 — 한 화면에 두 렌더러의 모양이 섞일 수 있다 (예: 공유 목록 카드).

**발견 — 고치지 않음 (지시: 판각 규칙·불러오기를 이 단계에서 바꾸지 않는다)**:

1. **전곡 보기 재생 프레임이 legacy보다 느리다** (1× p95 19.3 대 9.7 ms, 4× 100.7 대 66.4 ms, 4×에서 재생 중 long task 20개·최대 73 ms, legacy 0) — §16.3의 "재생 UI가 50 ms 넘게 막히지 않는다"를 4× 전곡 보기에서 어긴다. **원인 실험**: 같은 트리에서 `engrave/page.js`의 `SVG_OPTS`만 `inline: true`로 바꾼 서버(버림)를 같은 도구로 잼 — 전곡 프레임 1× 중앙/p95 5.8 / 10.8 ms(`<use>` 5.7 / 21.5), 4× 42.4 / 62.8 ms·long task 2(`<use>` 81.6 / 119.4 ms·35). 즉 G4-D2-21(B9를 위해 `<use>`로)과 G4-D2-22("체감 프레임 시간은 같다")의 판단이 전곡 재생에서는 맞지 않는다 — 전곡 SVG의 수많은 `<use>`를 매 프레임 다시 칠하는 비용. B9와 재생 프레임의 맞바꿈은 Lead의 결정 (예: 화면은 inline, 인쇄·저장은 `<use>`; 또는 켜진 음만 다시 칠하게 하는 층 나누기).
2. **B5의 long task 0** — 전곡 첫 그리기와 다시 불러온 곡의 resolve가 한 덩어리 (§37.12 그대로). 시간 나누기(§16.3)는 아직 없다.
3. `app-source-check.js`의 낡은 버전 고정 (`0.1.1-g4a`) — base에서도 실패, flip과 무관.
4. G4e 리뷰의 MINOR "여러 ScoreView의 glyph id 충돌": 이제 실제로 한 문서에 판각기 SVG가 여럿 있다 (My Songs 카드 등, `library` suite 45 그림). 모든 화면 SVG가 `unit 10`이라 `ppp-g-*` symbol이 같은 모양이므로 보이는 차이는 없다 (인쇄는 G4-E4의 자기 접두사).

**→ 리뷰 R1, Lead 결정 G4-L6으로 inline으로 고침 (§43.10).** **BLOCKER 0, MAJOR 1** (implementer 자체 판정, 리뷰 전): MAJOR = 발견 1 (전곡 재생 프레임, 4× long task) — flip 자체의 결함이 아니라 판각기의 성질이 기본 경로에 온 것이지만, 태블릿급 기기에서 사용자가 느낄 수 있으므로 배포 전에 Lead가 받아들이거나 고칠 단계를 정해야 한다.

### 43.9 커밋

`b2de7da` (앱·`engrave/page.js`·테스트·도구), `bd1c7af` (`origin/main` #31 병합), 이어서 이 기록 (G04 §43, 목차, §16.1·§25.1 주; DECISIONS G4-F2-1–6; CURRENT_STATE; ARCHITECTURE). `origin/g4f2-flip`에 push. 병합 안 함, PR 없음, 배포 없음.

### 43.10 리뷰와 Fixer (2026-09-26)

입력: G4f-2 flip 독립 리뷰(대상 `afd6184`)의 판정 **NEEDS_FIX — BLOCKER 0, MAJOR 2, MINOR 3**. 리뷰의 증거와 도구는 세션 scratchpad `g4f2-review/`(`perf.js` 재생 하네스와 trace 분해, `sizes.js`, `printseed.js`). Lead 지시: R1은 Lead 결정 G4-L6(inline)대로, R2·R3(= m1)을 고치고, m2(공유 seed 4곡의 `fromScore` 손 `x`)·m3(B5 첫 그리기 long task)·M-H2의 flag·소나티네 다듬기는 이번 라운드 밖(Lead가 후속으로 기록). 같은 worktree·브랜치, 시작 `afd6184`. 결정은 DECISIONS G4-L6, G4-D2-21/22 정정, G4-F2-7–9.

#### 43.10.1 지적과 처리

| # | 지적 (리뷰) | 처리 | 어디 |
| --- | --- | --- | --- |
| R1 (MAJOR-1) | 전곡 재생 프레임이 legacy보다 느리다 — Chrome trace: 재생 틱마다 악보 `<svg>` 하나가 바뀌고(재생선 x, 음의 class, 마디 wash) Chrome이 SVG 전체의 paint를 다시 기록하는데, `<use>` 하나는 inline path보다 다시 기록하는 값이 훨씬 비싸다 (4×: Paint 51.7 ms `<use>` / 8.5 inline / 17.2 legacy; Layerize 19.9 / 1.1 / 3.2). highlighter가 원인이 아니고, overlay·`will-change`·미리 크기 맞춤으로는 풀리지 않음 | **FIXED — G4-L6**: `engrave/page.js`의 `SVG_OPTS`를 `inline: true`로 (`svg.js`의 기본값과 인쇄 `PRINT_SVG_OPTS`는 `<use>` 그대로), `page-files.js --write`. B9는 화면 SVG에 대해 "legacy 이하 (지금보다 크지 않음)"로 — 실측 0.51–0.78. DECISIONS G4-D2-21·22를 제자리에서 정정 | `engrave/page.js` 67–75 |
| R2 (MAJOR-2) | "Print / Save as PDF"가 fallback 곡(원천이 합의하지 않음 — 공유 seed 4곡, soft pedal MusicXML, 코드명이 있는 OMR)에서도 보이고, 누르면 `PRINT_SOURCE_UNAVAILABLE`을 `console.warn`만 하고 아무 일도 없다 (리뷰가 production 라이브러리 7곡 중 4곡에서 재현) | **FIXED** — `showPrintControls`에 `engraveDrew(S.score)`: 앱의 `engraveView`가 판각기 자신의 paint 결과(`'drawn'`/`'legacy'`)를 Score마다 적는다 (다시 계산하지 않음; fallback은 sticky; 바뀌면 앱을 한 번 다시 그림). 그래도 인쇄가 실패하거나 파일을 못 불러오면 토스트(`this.say(tx('This score could not be prepared for printing.'))`, ko·ja·zh) | App `engraveDrewScore`/`engraveOutcome`/`engraveDrew` (`engraveView` 앞), `showPrintControls`, `printScore()` |
| R3 (m1) | "Engraving…"이 영어뿐 | **FIXED** — 앱의 기다림 표시(`engraveView`)는 `tx('Engraving…')`(textContent로), `page.js`의 것은 새 env `waitText()`(앱이 `tx`를 넘김), ScoreView 자신의 VexFlow 기다림 표시(render, 곧 모든 사용자가 봄)는 한 줄의 표시 `/* G4f-2: was 'Engraving…' >>> */tx('Engraving…')/* <<< G4f-2 */` — `app.test.js` A45가 표시에서 원래 글자를 되돌린 뒤 기존 hash 셋(`c208062f…`, `8ceb975a…`, `80149fb7…`)을 그대로 확인하므로, 클래스에서 바뀐 것은 이 글자 하나임이 증명된다 (지금 클래스의 hash는 `8f292d3c…`). 카탈로그 ko·ja·zh에 두 key (i18n 파일은 `json.dumps(indent=2, ensure_ascii=False) + "\n"` 왕복 그대로) | App, `engrave/page.js`, `i18n/*.json` |

#### 43.10.2 R1 — 재생 전후 (sonatina/020 전곡, 리뷰의 `perf.js`, 이 PC; 세 변형을 같은 라운드 안에서 번갈아 3라운드)

변형: **legacy** = 이 트리 `?renderer=legacy`; **전 (`<use>`)** = `afd6184`의 `git archive`(8802); **후 (inline)** = 이 트리(8801). `cb` = `setState({beat})` 60번 연속(프레임 = 콜백까지), `play` = 실제 재생 6 s(rAF 간격). 다른 프로그램이 함께 돈 PC라 범위로 적는다 (특히 4×).

| | legacy | 전 (`<use>`) | 후 (inline) |
| --- | --- | --- | --- |
| 1× `cb` 프레임 p95 (ms) | 10.7–16.8 | 19.0–23.0 | **7.6–10.0** |
| 1× `cb` long task | 0 | 0 | **0** |
| 1× `play` rAF p95 (ms) | 7.1 | 13.8–13.9 | **7.1** |
| 1× `play` long task | 0 | 0–1 (51 ms) | **0** |
| 4× `cb` 프레임 p95 (ms) | 85.4–168.8 | 117.2–250.1 | **52.6–63.5** |
| 4× `cb` long task (수, 최대 ms) | 2–65, 64–135 | 31–73, 96–254 | **0–1, 82** |
| 4× `play` rAF p95 (ms) | 69.5–111.1 | 145.8–201.7 | **55.6–159.7** (76.4, 55.6; 부하가 컸던 둘째 라운드 159.7 — 그 라운드 legacy 104.2) |
| 4× `play` 50 ms 넘는 rAF 간격 (수 / 전체) | 43–67 / 127–190 | 38–50 / 69–94 | 19–54 / 105–248 |
| 4× `play` long task (수, 최대 ms) | 7–26, 67–207 | 43–50, 126–220 | 2–49, 53–145 |

- **1×: legacy보다 나쁘지 않고(더 낫다), §16.3의 "재생 중 50 ms 넘는 막힘 없음"을 지킨다** (long task 0).
- **4×**: `cb`는 세 라운드 모두 legacy보다 좋다. 실제 재생은 두 라운드에서 legacy보다 좋고(p95 76.4 / 55.6 대 111.1 / 69.5), 부하가 컸던 한 라운드에서 legacy보다 나빴다(159.7 대 104.2). **4×에서 §16.3의 "50 ms 넘는 막힘 없음"은 legacy처럼 지키지 못한다** (long task 2–49) — 정직하게 남긴다.
- 크기 (리뷰의 `sizes.js`, 전곡 SVG, legacy 대비): 

| | burgmuller25/021 | czerny849/001 | sonatina/013 | sonatina/016 | sonatina/020 |
| --- | --- | --- | --- | --- | --- |
| legacy | 825 KB | 725 KB | 2,182 KB | 1,894 KB | 2,154 KB |
| 전 (`<use>`) | 195 KB (0.24) | 209 KB (0.29) | 557 KB (0.26) | 641 KB (0.34) | 761 KB (0.35) |
| 후 (inline) | 472 KB (0.57) | 369 KB (0.51) | 1,229 KB (0.56) | 1,461 KB (0.77) | 1,679 KB (0.78) |

  넣기(insert) 시간은 전후 같은 수준 (sonatina/020 33.3 → 18.3 ms, 016 23.7 → 24.3 ms).
- B2 (가까이 보기 넘김, 캐시 없음): inline 실험 서버에서 13.9 ms (1×), 71 ms (4×) — 예산 안 (§43.8의 실험과 같은 코드).

#### 43.10.3 R2 — 인쇄 명령

- `print-check.js`에 공유 seed 7곡(`catalog/shared-seeds.json`, 공유 곡이 열리는 방식)을 더했다: 명령은 **판각기가 그린 곡에서만** 보이고(classic·pop·hymn — 보임), fallback 곡(jazz·newage·ost·game — `SOURCE_DISAGREES`)에서는 보이지 않으며, 그 곡에 앱의 `printScore()`를 직접 불러도(버튼을 거치지 않은 방어) 토스트 "This score could not be prepared for printing."가 뜨고 `window.print`는 불리지 않는다. 기존 6곡은 그대로 인쇄된다 (페이지 1, 2, 3, 5, 1, 1, 래스터 0).
- **부정 대조**: `showPrintControls`에서 `engraveDrew(S.score)`를 빼면 fallback 4곡이 "command shown true"로 **4 FAILED** — 되돌리면 통과.
- `app.test.js`(새 test): 판각기 대역으로 결과를 Score마다 적는지(그림 → true, 앱을 한 번 다시 그림, 같으면 다시 그리지 않음; fallback → false, 뒤에 그려도 false — sticky; pending → false), `showPrintControls`의 식, `printScore()`의 두 실패 경로가 토스트를 띄우는지.
- 언어: ko·ja·zh 페이지에서 기다림 표시가 "악보를 그리는 중…" / "楽譜を描画中…" / "正在绘制乐谱…", 인쇄 실패 문구가 각 언어로 (직접 확인, `page.js`를 4초 붙잡아 표시를 읽음).

#### 43.10.4 회귀

- Windows: `npm run test:engrave` **199/199** (198 + R2 test 1), `layout-hashes.js` 118 × 3 **그대로** (SVG 직렬화는 layout hash가 아니다 — 바뀐 hash 0), `page-files.js --check` PASS. `browser-parity.js`: layout 808/808, SVG 808/808, 페이지 SVG 808/808 바이트 동일, E14 glyph path 14개 getBBox 오차 ≤ 0.09 px, 네트워크 0.
- `legacy-parity.js` (`afd6184` 대 이 트리, `?renderer=legacy`): **16/16 바이트 동일**.
- `page-check.js`: a31 (쓴 것 중 안 바뀐 것 0, sync p95 0.1 / 0.5 ms), a32 셋, a33 셋, switch 열 — 모두 PASS.
- 브라우저 suite: 기본 페이지에서 26개 전부 다시 — `transcription`(환경, §43.5) 말고 모두 PASS; `renderer=legacy`에서 A30 여덟과 `i18n-and-auth` PASS.
- Linux (Docker `node:24-bookworm`, LF clone의 `7f8ce24`): `test:engrave` **199/199**, `test:scoregraph` **216/216**, layout hash, `page-files.js --check` PASS.

#### 43.10.5 남은 것 — Lead

- 4× 실제 재생에서 §16.3의 50 ms가 legacy처럼 여전히 넘는다 (위 표) — inline이 `<use>`보다 훨씬 낫고 대체로 legacy 이상이지만, 태블릿급 기기에서 긴 곡의 전곡 보기 재생이 완전히 매끄럽다고는 말할 수 없다.
- m2 (공유 seed 4곡이 legacy로 — `fromScore`의 손), m3 (B5 첫 그리기 long task), M-H2의 flag·소나티네 — 이번 라운드 밖 (지시).

**상태: G4f-2 flip FIX — READY_FOR_LEAD_RECHECK** (자체 판정 BLOCKER 0, MAJOR 0). 커밋 `7f8ce24` (코드·테스트), 이어서 이 기록.

### 43.11 Lead 재확인 (2026-09-26)

고친 것만 다시 봤다 — 구현자의 작업 트리가 아니라 `11fab5e`를 새로 `git clone --shared`한 사본, 제 서버(8816), 리뷰어의 `perf.js`로.

- **R1 (inline)**: `test:engrave` 199/199. 전곡 재생(sonatina/020), 기본(판각기) ↔ `?renderer=legacy` 번갈아 두 번, 1×: 프레임 중앙값 6.5 / 6.5 ms 대 9.1 / 9.2 ms, p95 10.2 / 13.2 대 13.8 / 16.0 ms, long task 0 대 0; SVG 1.72 MB(`<use>` 0) 대 2.20 MB (0.78배). 4×: p95 70.2 대 100.5 ms, long task 1(50 ms) 대 16(최대 65 ms). **판각기가 이제 legacy보다 빠르다** — MAJOR-1 닫힘.
- **R2 (인쇄 명령)**: `print-check.js` — 여섯 곡 모두 인쇄(쪽 수 = 엔진, raster 없음); 공유 seed 일곱 중 판각기가 그린 셋은 명령 보임, legacy로 돌아간 넷은 안 보임, 그래도 부르면 번역된 안내. 코드: `engraveOutcome`은 `page.js`의 `'drawn'`/`'legacy'` 반환만 쓰고, 축소 뷰 routing은 그 앞(`engraveView` 첫 줄)에서 돌아가므로 곡을 fallback으로 적지 않는다 — 확인. MAJOR-2 닫힘.
- **R3**: ko 문구의 말투만 Lead가 고침 — "준비하지 못했습니다" → "준비하지 못했어요" (앱의 다른 ko 문구가 모두 "~어요"); i18n 파일은 그대로 정확히 왕복한다.

**판정: 병합 가능.** 4×에서도 §16.3의 50 ms를 완전히는 못 지키지만 legacy보다 낫다(위). m2·m3·M-H2의 flag·소나티네는 flip 뒤 과제로 로드맵에 남긴다. **배포는 병합 뒤 사용자에게 따로 묻는다.**

---

## 부록 A. 이 세션의 측정

모두 `D:/PPP-g4`, `55d1bd5`, 작업 트리 clean. 스크립트는 세션 scratchpad에 있고 저장소에 쓰지 않았다 (측정 뒤 `git status` clean 확인). G4a·G4f가 같은 정의로 `tests/engrave/tools/`에 다시 만든다.

### A-1. 기보 의미 census (그래프로 읽은 커밋된 악보)

`census.js`: `catalog/`(위 3 + hymns 100 + method 222)와 `tests/scoregraph/fixtures/xml`(29), `tests/fixtures`, `tests/bench/corpus/omr`의 MusicXML/MXL 357개를 `PPPScoreGraph.importFile`로 읽어 셌다 (예외 0). **격리된 Czerny 299 10개와 Burgmüller 5개가 포함된 수**다 — R 코퍼스(§22.2)에서는 뺀다.

| 항목 | 수 | 항목 | 수 |
| --- | --- | --- | --- |
| 파일 / event / 음 | 357 / 96,825 / 90,706 | 다성부 staff-마디 / 전체 | 3,901 / 16,481 (147 파일) |
| beam spanner / beam된 event / secondary break | 11,808 / 47,805 / 762 (130 파일) | stem 지정 event | 49,772 |
| tuplet / 중첩 / `bracket:false` / `number:'none'` | 1,930 / 1 / 1,768 / 1,605 | 쉼표 `display.pos` | 302 |
| tie / slur | 385 / 3,245 (slur 70 파일) | 인쇄 임시표 / 주의·괄호 | 3,529 / 1 |
| grace / articulation / 꾸밈 기호 / fermata | 244 (17 파일) / 6,935 / 51 / 31 | 마디 안 clef 변경 | 119 |
| 셈여림 / words / hairpin | 895 (88 파일) / 441 / 381 | key 변경 / meter 변경 / meter 기호 | 5 / 11 / 107 |
| pedal / change | 17 / 1 | volta / jump / 도돌이 끝 | 46 / 16 / 271 |
| ottava / glissando / arpeggio | 79 / 2 / 8 | 줄·페이지 나눔 힌트 / 여러 마디 쉼표 | 285 / 1 |
| 운지 있는 head | 14,305 (84 파일) | 코드명 / tempo 표시 | 550 / 308 |
| 가사 / 타악기 / cross-staff | 1 / 1 / 2 | notehead 비보통 | 0 |

층별 두드러진 것: sonatina(28) slur 2,090·셈여림 566·운지 3,632·꾸밈음 142; czerny849(28) tuplet 1,002(그중 `bracket:false` 985)·운지 4,162; hymns(100) 다성부 staff-마디 3,350 / 3,486, beam 0; hanon(20) beam된 event 9,008.

### A-2. 현재 렌더러 성능

`perf.js`(puppeteer, `NODE_PATH=D:/PPP/node_modules`): 이 worktree의 `server.js`를 8791 포트로 띄워(8777은 다른 세션의 서버가 쓰고 있어 건드리지 않음) course 곡처럼 열고(`shelveSong` → `adoptScore` → `enterSong` → `go('player')`), 가까이 보기 첫 그림, 4마디씩 페이지 넘김(최대 10번), `beat`만 바꾼 프레임 20번, 전곡 보기 판각, 전곡 프레임 20번을 `performance.now`로 쟀다. 결과는 §19.1의 표. 측정 뒤 8791 서버를 끔.

- 첫 시도에서 `app.setState({score})`로 곡을 바꾸자 앱의 연습 모델이 `Cannot read properties of undefined (reading 'acc')`로 멈췄다 — 정상 곡 열기 경로를 건너뛴 측정 도구의 잘못이지 렌더러 결함이 아니다. 두 번째부터 정상 경로로 쟀다.

### A-3. VexFlow 4.2.3 Node 검사

jsDelivr의 `vexflow@4.2.3/build/cjs/vexflow.js`(992,166 바이트, 전송 gzip 310 KB, 머리글 "VexFlow 4.2.3 2023-08-16 … 62087494", 패키지 `LICENSE` MIT)를 scratchpad에 받아 Node에서:

- 기본 음악 글꼴 스택 `['Bravura', 'Gonville', 'Custom']`.
- 클래스 존재: `Beam, Tuplet, StaveTie, Curve, PedalMarking, StaveHairpin, TextDynamics, GraceNoteGroup, GraceNote, Articulation, Ornament, FretHandFinger, Annotation, TextBracket, MultiMeasureRest, ClefNote, KeySigNote, TimeSigNote, BarNote, NoteSubGroup, Stroke, Tremolo, StaveText, Crescendo, TextFormatter, Formatter, TickContext, ModifierContext, Glyph, Parenthesis, ChordSymbol, Volta, Repetition` — 전부 있음.
- DOM 없이: 8분음표 8개 + 임시표를 stave에 formatToStave → x `[27, 62.81, 98.61, …]`, y, stem 끝, bounding box, `generateBeams` 4개와 기울기 계산. **두 번 실행이 바이트 동일.** (음마다 `setStave`를 format 전에 해야 y가 계산된다 — 구현 메모.)
- `TextFormatter`의 글자 폭은 내장 표 (`'Allegro'` Arial 12 → 55.12 px; 모르는 글꼴 이름도 같은 값 — 표로 떨어짐). `TextDynamics('mf')` 폭 29, `Glyph.getWidth('segno', 40)` 22.64 — DOM 없음.
- tuplet 기본값: `bracketed:true, ratioed:false, location:1`; beam된 음의 tuplet은 `bracketed:false`.
- 반쪽 tie: `new StaveTie({first_note, first_indices})` 생성 가능.

### A-4. 다른 엔진 (npm registry, 2026-09-24)

`verovio` 6.3.0 `LGPL-3.0-or-later`, `dist/verovio-toolkit-wasm.js` 7,310,681 바이트; `vexflow` 최신 5.0.0 MIT; `opensheetmusicdisplay` 2.1.3 BSD-3-Clause.

---

## 부록 B. 코드 위치 색인

`Piano Coach App.dc.html` (`55d1bd5`):

| 무엇 | 줄 |
| --- | --- |
| VexFlow CDN URL, `loadVexFlow` | 9209, 9213 |
| `ACC_VEX` | 9229 |
| `PdfLayer` (PDF 읽기, 판각 아님) | 9248–10426 |
| `NOTE_MID`, `chordFace`, `barX`, `barQ` | 10432, 10434, 10437, 10452 |
| `makeScoreView`, `drawKey`, `paint`, `draw` | 10473, 10497, 10506, 10528 |
| 8va 적힌 음 `written()` | 10668–10683 |
| 마디 준비·두 성부 stem | 10690–10755, 10699–10710 |
| `spaceBar`(`u·Δ^0.65`), `rowWidth`, `solveU` | 10763, 10776, 10782 |
| 줄바꿈 | 10793–10818 |
| 마디 그리기 | 10909–11063 |
| tie·slur (줄 넘김 버림 11073·11101, 추론 tie 숨김 11079) | 11065–11112 |
| pedal, ottava | 11124–11131, 11139–11183 |
| segno·coda, 코드명(`getComputedTextLength` 11221), Fine·D.C., volta | 11191, 11199–11229, 11233, 11250 |
| 색 바꾸기, `getBBox` viewBox | 11303–11319, 11324–11330 |
| 연습 overlay, 클릭·드래그, 재생선, `svg.__ppp` | 11353–11455, 11457 |
| `buildVoice` (fit 11490, 쉼표 11503, stem 11518, 임시표 11535, 점 11548, beam 11570, tuplet 11591) | 11468–11631 |
| `sync` | 11634– |
| 재생의 tie (`struck`), 연습 판정의 tie | 2631, 6754 |
| 재생이 쓰는 dynamics·wedges | 2708, 2721 |
| `packScore`, `inferredAudioNotation` | 3498, 3471 |
| `importToGraph`, `scoreFromXml`, `scoreFromFile` | 4443, 4478, 4489 |
| import door | 7512–7541 |
| 녹음 `toMusicXml` → `parseMusicXML` | 7206–7219 |
| OMR `parseMusicXML` + `PdfLayer.apply` | 7599–7643 |
| 상태 저장 (`importSource`) | 12479–12505 |
| 다시 쓰기·편곡 | 14709–14718, 14772–14776, 14974–14983 |
| course 곡 열기 | 15860–15886 |
| `sv()`, `barsPerLine` | 16454, 16534 |
| ScoreView 사용처 | 15695, 17397, 17528, 17625, 17818, 18080, 18265, 18369, 18391 |

`scoregraph/`: `legacy-score.js` `toScore` 43, spanner 분기 177–192 (beam 없음), grace 건너뜀 233, `sgHead` 282, `sgFrom` 431, `compare` 493; `schema.js` shape 표 95–250; `musicxml-import.js` tuplet show 642, printed:false run 1296–1339; `pro-beam.js` `groups` 37, export 121; `meter-grid.js` `beamGroups` 261, export 289–290. `server.js` 차단 목록 42.
