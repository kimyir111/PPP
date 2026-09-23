# G02 — Score Import

외부 symbolic score와 performance를 ScoreGraph로 신뢰성 있게 들여오는 Goal이다.

| | |
| --- | --- |
| 상태 | **설계 (Architect, 2026-09-23)**. 구현 전. production 코드 변경 0 |
| 기준 커밋 | `origin/main` = `00081cc` (G1 follow-up PR #3까지 merge됨) |
| 브랜치 / worktree | `g2-import` / `D:/PPP-g2` |
| 선행 | G0 Quality Foundation (CLOSED), G1 ScoreGraph (CLOSED) |
| 전환 단계 | `docs/ARCHITECTURE.md` §2의 **S3** (앱 import가 그래프를 거친다) + MIDI라는 새 producer |
| 이 문서가 정하지 않는 것 | 기보 품질 개선(G3), OMR·전사 개선, 드럼 편곡 |

---

## 목차

- [0. 요약](#0-요약)
- [1. Goal](#1-goal)
- [2. Current State — G1이 남긴 것](#2-current-state--g1이-남긴-것)
- [3. G1과 G2의 경계 (A–E inventory)](#3-g1과-g2의-경계-ae-inventory)
- [4. Design Principles](#4-design-principles)
- [5. Import Architecture](#5-import-architecture)
- [6. MusicXML Import 설계](#6-musicxml-import-설계)
- [7. MIDI Import 설계](#7-midi-import-설계)
- [8. Performance ≠ Notation](#8-performance--notation)
- [9. Round-trip과 Semantic Fidelity](#9-round-trip과-semantic-fidelity)
- [10. Corpus 전략](#10-corpus-전략)
- [11. ImportReport](#11-importreport)
- [12. Provenance](#12-provenance)
- [13. Error Policy](#13-error-policy)
- [14. 앱 import 경계 migration](#14-앱-import-경계-migration)
- [15. 성능](#15-성능)
- [16. G0/G1 품질 인프라 연결](#16-g0g1-품질-인프라-연결)
- [17. Percussion 확장성](#17-percussion-확장성)
- [18. Schema Review](#18-schema-review)
- [19. Acceptance Criteria](#19-acceptance-criteria)
- [20. 구현 단계](#20-구현-단계)
- [21. Out of Scope](#21-out-of-scope)
- [22. 사용자 결정이 필요한 사항](#22-사용자-결정이-필요한-사항)
- [23. 문서 hygiene](#23-문서-hygiene)
- [부록 A. 이 세션의 측정 기록](#부록-a-이-세션의-측정-기록)

---

## 0. 요약

**G2는 "MusicXML importer를 또 만드는 일"이 아니다.** G1이 이미 1,221줄짜리 importer를 냈고, 커밋된 MusicXML 369개가 전부 그것을 통과한다. G2의 일은 세 가지다.

1. **그 importer를 "우리 코퍼스"에서 "남의 파일"로 넓힌다.** 지금 코퍼스는 피아노 교재 한 종류다 — 369개 중 multi-part는 **1개**, `<transpose>`·`<unpitched>`·`<glissando>`·`<figured-bass>`·`<measure-style>`은 **0개**다. 이 세션이 직접 넣어 본 결과, 외부 파일에서 흔한 세 가지(`<unpitched>`, `<senza-misura>`, 미분음 `<alter>0.5`)는 **파일 전체가 거절**된다 (§6.3, 부록 A-3).
2. **MIDI import를 새로 만든다.** 저장소에 SMF reader는 `midi_notes.py` 하나뿐이고, AMT 파이프라인 전용에 손실이 크다 (track·channel·tempo map을 버린다, §7.1). JS 쪽에는 SMF 파서가 아예 없고, 앱은 `.mid`를 받으면 *"MIDI import is not built yet"* 이라고 말한다 (App 4416).
3. **앱의 import 경계를 그래프 위로 옮긴다** (S3). `parseMusicXML` → `Score`를 `MusicXML → ScoreGraph → legacy adapter → Score`로 바꾼다. 계약은 G01 부록 B에 이미 있다.

**핵심 설계 판단 세 가지**

- **Importer는 수리공이 아니다.** 결함은 담고 드러낸다 (G1-D10f 유지). 기보 품질 수리는 G3다.
- **MIDI는 연주지 악보가 아니다.** G2는 MIDI를 **무손실 performance**로 들여오고, 기보는 "최소 결정론적 skeleton"까지만 만든다. 리듬 양자화·성부 분리·손 배정을 G2에서 새로 만들지 않는다 (§7).
- **연주 전용 그래프는 지금 schema로 만들 수 없다.** `parts` 최소 1개, `timeline.measures` 최소 1개가 필수다 (부록 A-4에서 실행으로 확인). MIDI import는 skeleton을 **반드시** 만들어야 하고, 그 skeleton은 `op: 'inferred'`로 표시한다.

**Schema**: 최소 3건이 `ext`로도 해결되지 않아 **`scoregraph_version` 1 → 2**가 필요하다 (§18). PerfNote가 `ext`를 못 받고, PerfPedal이 damper/sostenuto/soft 외의 controller를 못 받는다 — MIDI track·channel·CC를 담을 곳이 없다.

---

## 1. Goal

> 사용자가 가진 MusicXML·MXL·MIDI 파일을 PPP가 **믿고** 읽는다. 무엇이 들어왔고 무엇이 버려졌는지 파일 단위로 말할 수 있다.

성공의 모습:

```
파일 ─► Import Adapter ─► ScoreGraph ─► Validator ─► ImportReport
        (container,        (정본)        (경계 검증)   (무엇이 들어오고
         format 판별)                                   무엇이 남았나)
```

- **정확성**: round-trip에서 의미가 보존된다 (byte 동일성이 아니라, §9).
- **정직성**: 버려진 것은 전부 report에 이름과 수로 남는다. silent loss 0.
- **견고성**: 파일 하나의 결함이 서비스를 죽이지 않는다 (§13).
- **제품**: 앱이 `.mid`를 거절하지 않는다. 앱 import가 그래프를 거친다.

Goal이 **아닌** 것: 악보를 예쁘게 만드는 일, 리듬을 똑똑하게 읽는 일, OMR·AMT 품질.

---

## 2. Current State — G1이 남긴 것

### 2.1 코드

| 자리 | 파일 | G2와의 관계 |
| --- | --- | --- |
| MusicXML import | `scoregraph/musicxml-import.js` (1,221줄) | **넓힌다** (다시 만들지 않는다) |
| MusicXML export | `scoregraph/musicxml-export.js` (520줄) | fidelity 측정에 쓴다. perc 거절과 O(n²) 문제 있음 (§15) |
| 정본·검증·직렬화 | `schema.js` `validate.js` `serialize.js` `build.js` | 그대로 쓴다. 최소 변경 (§18) |
| 시간 | `time.js` (`unroll`, `tempoMap`, `perfTimeMap`) | MIDI 시간 매핑의 기반 |
| 출처 | `prov.js` (계층 상속 + aspect) | §12에서 실제로 쓴다 |
| 녹음 → 그래프 | `audio-score.js` `buildGraph` | MIDI notation 경로가 참고할 유일한 선례 |
| 앱 import | `Piano Coach App.dc.html` `parseMusicXML` (4,317행까지) | **대체 대상** (S3) |
| SMF reader | `midi_notes.py` | AMT 전용, 손실 큼. **재사용하지 않는다** (§7.1) |
| 품질 측정 | `tests/bench/` + `tests/scoregraph/` | G2가 그대로 올라탄다 (§16) |

### 2.2 측정한 사실 (이 세션, `00081cc`)

- 커밋된 MusicXML **369개 전부** import → export → import를 통과한다. import 실패 0, 재import 실패 0.
- importer가 버리는 것(전체): `sound@dynamics` 856, `dashes` 354, `encoder`/`supports`/`encoding-date` 각 130, `source` 48, **`fermata` 10**, `part-group` 6, `wavy-line` 6, `tied`(소리 없는 tie) 2, 짝 없는 ending·wedge 각 1.
  - `fermata` 10건은 전부 **`<barline>` 안의 fermata**다 (직접 세어 확인). 늘임표가 있는 마지막 마디선이 통째로 사라진다.
- import한 그래프의 validator 경고: `I-VOICE-GAP` 502, `W-TIE-OPEN` 146, `W-MEASURE-LENGTH` 66, `I-NO-TEMPO` 41, `W-GRACE-ORPHAN` 22 …
- **성능**: import는 head당 **20–25 µs로 선형**(72,000 head까지 확인). serialize·validate도 선형. **export만 O(n²)** — 16k head 467 ms, 36k head 2,120 ms, 72k head 8,142 ms (§15).
- **크기**: `.sg.json`은 원본 MusicXML의 **0.75–0.85배**, head당 212 B (gzip 19 B). 저장 형식으로 쓰기에 무리가 없다.

### 2.3 코퍼스가 실제로 덮는 범위 (369개)

| | |
| --- | --- |
| part 수 | 1개 part = **368 파일**, 2개 part = **1 파일** (`samples/vocal-piano.musicxml`) |
| `<staves>` | 2 = 354 파일, 1 = 15 파일. **3 이상 0** |
| 구별되는 `<voice>` 라벨 | 2개 = 208, 4개 = 109, 3개 = 36, 1개 = 15, 6개 = 1 |
| 서로 다른 element 이름 | **117개**뿐 |
| **0회 등장** | `unpitched` `transpose` `chromatic` `diatonic` `glissando` `slide` `cue` `figured-bass` `measure-style` `multiple-rest` `senza-misura` `staff-details` `key-octave` `cancel` `defaults` `credit` `page-layout` `system-layout` `midi-instrument` `score-instrument` `mordent` `tremolo` `breath-mark` `caesura` `segno`(element) `coda`(element) `rehearsal` |
| `lyric` | 369개 중 **1개 파일에 1회** |

또 하나: **92개 파일은 `<part>`와 `<score-part>`에 `id` 속성이 아예 없다.** MusicXML로는 잘못된 파일인데 importer가 `undefined` 키로 짝을 맞춰 우연히 통과한다. part가 둘 이상이면서 id가 없으면 두 part 정보가 한 칸에 뭉개진다.

> **결론**: G1 importer는 "PPP 피아노 교재 코퍼스"에서 검증됐다. **외부 파일에서 검증된 적이 없다.** 이것이 G2의 출발점이다.

---

## 3. G1과 G2의 경계 (A–E inventory)

과제 §2가 요구한 분류다. 각 줄의 근거는 코드 위치나 이 세션의 실행 결과다.

### A. G1에서 이미 완성된 것 — G2가 건드리지 않는다

| 항목 | 근거 |
| --- | --- |
| 정본 schema, validator(31 ERROR / 14 WARNING / 7 INFO), canonical JSON, migration 뼈대 | `schema.js` `validate.js` `serialize.js`, 커밋된 `.sg.json` 52개가 `serialize(parse(s)) === s` |
| 기보 유리수 / 연주 µs 분리, `time.unroll`·`tempoMap`·`perfTimeMap` | `time.js`, G01 §6 |
| 음높이 층(concert 철자 저장, written·MIDI 파생), ottava 표시 | `pitch.js`, G01 §7.2 |
| provenance 계층 상속 + aspect | `prov.js`, G01 §11 |
| 기본 MusicXML 읽기: part·staves·voice·chord·rest·pitch·accidental·key·meter·tempo·clef·divisions·backup/forward·tie·slur·tuplet·beam·articulation·ornament·dynamic·wedge·pedal·octave-shift·repeat·ending·pickup·grace·direction·measure 번호 | §6.2 표의 "현재" 열, 369개 round-trip |
| 다중 part 구조 자체 | `readScore`가 `partEls`를 순회한다. **단, 코퍼스 검증 1건뿐** |
| `dropped` 집계 장치 | `musicxml-import.js:1209` — 소비하지 않은 element를 이름별로 센다. **G2 ImportReport의 토대** |

### B. round-trip 목적으로만 만든 최소 기능 — G2가 완성한다

| 항목 | 지금 | G2 |
| --- | --- | --- |
| `.mxl` 컨테이너 | **라이브러리 밖**. Python(bench)과 앱(`readMxl`)이 각자 풀어서 XML 문자열을 준다 | Import Adapter가 한 곳에서 처리 (§5) |
| ImportReport | `{issues, dropped, validation}` — 내부 디버깅용 모양 | 사용자·UI가 읽는 계약 (§11) |
| 다중 part | 코드는 있으나 코퍼스 1건. 이 세션의 2-part 최소 파일이 곧바로 `W-IMPORT-VOICE-SPLIT` | part↔staff↔voice 규칙 고정 + fixture (§6.2) |
| `<part>`/`<score-part>` id 짝 | id 없으면 `undefined` 키로 우연히 동작 | 명시적 규칙 + 경고 |
| instrument | `midi-instrument`의 program·channel만. 코퍼스 등장 0 | `score-instrument`·`instrument-sound`까지, MIDI와 공유 (§7) |
| transpose | 코드 있음, 코퍼스 0건, fixture 0건 | concert 변환 fixture + fidelity 검사 |
| provenance 위치 정보 | `Source.input{name, sha256}`만. 어느 마디의 무엇인지 없음 | 구간 단위 locator (§12) |

### C. 실제 외부 MusicXML에 부족한 것 — G2의 본체

| # | 부족한 것 | 지금 일어나는 일 | 등급 |
| --- | --- | --- | --- |
| C1 | `<unpitched>` (percussion) | **파일 전체 거절** `IMPORT-UNSUPPORTED-UNPITCHED` | 치명 |
| C2 | `<senza-misura>` / 첫 마디에 `<time>` 없음 | **파일 전체 거절** `IMPORT-UNSUPPORTED` (`musicxml-import.js:834`) | 치명 |
| C3 | 미분음 `<alter>0.5` | **파일 전체 거절** `IMPORT-UNSUPPORTED` | 치명 |
| C4 | `<fermata>` in `<barline>` | 조용히 버림 (코퍼스에 10건) | 높음 |
| C5 | `<glissando>` / `<slide>` | 버림 — Spanner type에 없음 | 높음 |
| C6 | `<measure-style>` / `<multiple-rest>` | 버림 — 여러 빈 마디가 한 마디로 | 높음 |
| C7 | `<dashes>` | 버림 (코퍼스 354건) — `rit.` 같은 지시의 연장선 | 중간 |
| C8 | `<wavy-line>` (trill 연장) | 버림 | 중간 |
| C9 | `<part-group>` (대괄호·중괄호) | 버림 | 중간 |
| C10 | `<figured-bass>` | 버림 | 낮음 (G1 §18에서 이미 제외) |
| C11 | `<staff-details>`/`<staff-lines>` | 버림. **schema의 `Staff.lines`에 자리가 있다** (실행 확인) — schema가 아니라 importer만의 구멍 | 중간 |
| C12 | `<key><cancel>`, `key-octave` | 버림. **ext로도 못 담는다** — `KeyEvent`는 ext host가 아니다 | 낮음 |
| C13 | `<sound dynamics>` | 버림 (코퍼스 856건) | 낮음 |
| C14 | `<defaults>` `<credit>` `<print>` layout | 버림. G1 §18에서 명시적 제외 | 낮음 |
| C15 | `<score-timewise>` | 파일 전체 거절 | 낮음 |

C1–C3은 **파일 하나 때문에 import 전체가 실패**하는 부류라 우선순위가 다르다. 외부 파일 ingest에서 "이 파일은 못 읽습니다"는 마지막 수단이어야 한다 (§13).

### D. MIDI import에 필요한 것 — 전부 새로 만든다

| 항목 | 지금 |
| --- | --- |
| JS SMF 파서 | **없다.** `midi_notes.py`만 있고 Python·AMT 전용 |
| track / channel 보존 | 없다. `PerfNote`에 필드도 `ext`도 없다 (§18) |
| tempo map | `midi_notes.py`는 마지막 tempo 하나만 남긴다. format 1 파일에서 틀린다 |
| meter map | 마지막 time signature 하나만 |
| damper 외 controller | CC64만. CC66/67, CC11 등은 담을 곳이 없다 (§18) |
| SMPTE division | `midi_notes.py`가 480으로 대체한다 — 잘못된 값 |
| 앱 경로 | `scoreFromFile`이 `.mid`를 soft error로 거절 (App 4416) |

### E. G3로 넘기는 것 — G2가 손대지 않는다

| 항목 | 이유 |
| --- | --- |
| tuplet bracket grouping (G1 F1) | 기보 결정. G01 §26.3에서 G3로 확정 |
| MIDI 리듬 양자화, 성부 분리, 손 배정 | notation intelligence. §7.6 |
| 자동 임시표·beam 재계산·기보 정리 | G1 §18과 동일 |
| CURRENT_STATE 이슈 1–19 수정 | G1과 동일하게 "표현하고 경고로 드러낼 뿐" |
| OMR·AMT 품질 | 범위 밖 |
| 드럼 편곡 AI | §17은 **표현**까지만 |

---

## 4. Design Principles

G1의 DP를 잇는다. 번호는 G2 고유다.

- **DP1 — 충실성이 편의보다 앞선다.** 원본의 의미와 결함을 담는다. 고치지 않는다 (G1-D10f).
- **DP2 — 조용한 손실 금지.** 그래프에 못 담은 것은 전부 `ImportReport.dropped`에 이름과 수로 남는다. 이미 있는 "소비하지 않은 element 집계"(`musicxml-import.js:1209`)를 계약으로 승격한다.
- **DP3 — 추론과 사실을 섞지 않는다.** 파일에 적힌 것은 `op: 'imported'`, 우리가 만든 것은 `op: 'inferred'`. MIDI skeleton 전체가 후자다.
- **DP4 — 연주 시간과 기보 시간은 끝까지 다른 값이다.** µs 정수 vs 정확한 유리수. MIDI를 16분음표에 붙여 "원본"인 척 저장하지 않는다 (§8).
- **DP5 — 파일 하나의 결함이 서비스를 죽이지 않는다.** import 실패는 값으로 돌아오고, throw는 프로그래밍 오류에만 쓴다 (§13).
- **DP6 — 측정 없이 품질을 주장하지 않는다.** "parse 성공률"은 품질이 아니다 (§9).
- **DP7 — 경계를 한 번에 하나씩 옮긴다.** 앱 import는 shadow → A/B → flip (§14).

---

## 5. Import Architecture

```
                        ┌─────────────────────────────────────────┐
 bytes + filename  ───► │ Import Adapter  (scoregraph/import.js)   │
 (File, Buffer)         │  · container: zip(.mxl) / plain / SMF    │
                        │  · encoding: BOM, UTF-8/16, declaration  │
                        │  · format sniff: MThd / <score-partwise> │
                        │  · size and time budget                  │
                        └───────────┬─────────────────────────────┘
                     ┌──────────────┴───────────────┐
                     ▼                              ▼
        musicxml-import.js  (있음, 넓힘)     midi-import.js  (신규)
                     │                              │
                     │                       RawMidi (무손실 중간 표현)
                     │                              │
                     └──────────────┬───────────────┘
                                    ▼
                            ScoreGraph  (build.js → seal → validate)
                                    │
                                    ▼
                        { ok, graph, report }   ← ImportReport (§11)
```

**새 파일은 세 개뿐이다.**

| 파일 | 역할 |
| --- | --- |
| `scoregraph/import.js` | container·encoding·format 판별, 공통 ImportReport 조립, 단일 진입점 `SG.import(bytes, opts)` |
| `scoregraph/midi-file.js` | SMF → `RawMidi` (무손실, 그래프를 모른다) |
| `scoregraph/midi-import.js` | `RawMidi` → ScoreGraph (performance 층 + skeleton) |

`musicxml-import.js`는 **넓히기만** 한다. 기존 369개 round-trip이 계속 통과해야 하므로 기본 동작 변경은 §6.2 표에 적힌 것만 허용한다.

**왜 `import.js`를 따로 두나.** 지금 `.mxl` 압축 해제가 세 곳에 흩어져 있다 — bench의 Python, 앱의 `readMxl`(App 4395), 그리고 라이브러리 밖의 호출자. 한 곳으로 모아야 "같은 파일을 어디서 열어도 같은 그래프"라는 결정론을 검사할 수 있다 (A9).

---

## 6. MusicXML Import 설계

### 6.1 정책 등급

| 등급 | 뜻 | report에 남는 것 |
| --- | --- | --- |
| **LOSSLESS** | 원본 의미가 그대로 그래프에 있다. export가 되돌린다 | 없음 |
| **NORMALIZED** | 의미는 같고 표현만 정규화된다 (divisions, 겹친 voice 분리 …) | `normalized[]` |
| **EXT** | core schema에 자리가 없어 `ext.<ns>`로 보존한다. export가 되돌린다 | `preserved[]` |
| **WARNING** | 담았지만 원본이 이상하다. 고치지 않고 알린다 | `issues[]` (W-IMPORT-*) + validator |
| **DROPPED** | 담을 곳이 없어 버린다. **파일은 살아서 들어온다** | `dropped{name: count}` |
| **UNSUPPORTED** | 파일 전체를 거절한다 | `code` |

**DP1의 결과**: G2는 DROPPED를 줄이고 UNSUPPORTED를 거의 없앤다. 반대로 WARNING은 늘어난다 — 그것이 정직한 방향이다.

**EXT는 새 발명이 아니다.** G1 importer가 이미 쓰고 있다: `musicxml-import.js:1151`이 "적힌 beam 수가 음표 종류가 요구하는 수보다 적을 때" `ext = {'musicxml.beam': {levels: written}}`를 남긴다. 코퍼스에서 11개 파일, 249건이다 (`I-EXT`가 이것을 보고한다). **namespace 규약 `musicxml.<무엇>`을 그대로 쓴다** — `musicxml.dashes`, `musicxml.wavy-line`, `musicxml.sound-dynamics`, `musicxml.part-group`, `musicxml.microtone`. MIDI 쪽은 `midi.<무엇>`.

**단, ext를 아무 데나 붙일 수는 없다.** `EXT_HOSTS`는 **ScoreGraph · Part · Event · Head · Measure · Spanner · Direction** 일곱뿐이다 (`schema.js`). 실행으로 확인한 결과 (부록 A-5):

| 붙이려는 곳 | 결과 |
| --- | --- |
| `Measure.ext`, `Direction.ext`, `ScoreGraph.ext`, `Event.ext`, `Head.ext` | OK → dashes · sound@dynamics · part-group · wavy-line · microtone은 ext로 간다 |
| `KeyEvent.ext`, `TempoEvent.ext`, `Staff.ext`, `PerfNote.ext` | **`E-SHAPE`로 거절** |

그래서 `<key><cancel>`과 `key-octave`는 **ext로도 담을 수 없다**. 둘 다 조표를 *어떻게 인쇄하는가*이고 앞 조표에서 거의 항상 유도되므로, G2는 **DROPPED로 두되 report에 남긴다**. core 필드를 늘릴 근거(실물 fixture에서 앞 조표와 어긋나는 `<cancel>`)가 나오면 그때 §18에 추가한다.

### 6.2 항목별 정책

"현재"는 `00081cc`의 실제 동작이고 "G2"가 목표다. 바뀌는 줄만 **굵게** 표시했다.

| 항목 | 현재 | G2 | 메모 |
| --- | --- | --- | --- |
| part / multi-part | LOSSLESS (검증 1건) | LOSSLESS | fixture와 fidelity 검사를 붙인다. id 없는 part 규칙 명문화 |
| instrument | 부분 (program·channel) | LOSSLESS | `score-instrument`, `instrument-sound` → `Instrument.kind` 매핑표 |
| staves | LOSSLESS | LOSSLESS | staves ≥ 3 fixture 추가 |
| voices | NORMALIZED (`W-IMPORT-VOICE-SPLIT`) | NORMALIZED | 겹치는 같은 번호를 쪼개는 규칙은 유지. part 간 번호 충돌 규칙 고정 |
| notes / chords / rests | LOSSLESS | LOSSLESS | |
| pitch spelling | LOSSLESS | LOSSLESS | concert 저장 (G1-D10a) |
| accidentals | LOSSLESS | LOSSLESS | `<cancel>`은 DROPPED 유지 (ext host 아님). report에는 남는다 |
| key | LOSSLESS | LOSSLESS | `key-octave`도 DROPPED 유지 (같은 이유) |
| meter | LOSSLESS | LOSSLESS | **`senza-misura` UNSUPPORTED → WARNING** (§6.3) |
| tempo | LOSSLESS | LOSSLESS | `sound@tempo` 우선 규칙 유지 |
| clefs | LOSSLESS | LOSSLESS | |
| divisions | NORMALIZED | NORMALIZED | 유리수로 바꾸므로 divisions 값 자체는 export가 다시 고른다 |
| backup / forward | NORMALIZED (`W-IMPORT-BACKUP-CLAMP`) | NORMALIZED | |
| ties | LOSSLESS | LOSSLESS | `<tied>`만 있는 tie는 DROPPED 유지 (G1-D17). report에 남는다 |
| slurs | LOSSLESS | LOSSLESS | |
| tuplets | LOSSLESS | LOSSLESS | **bracket grouping은 G3. 여기서 바꾸지 않는다** |
| beams | LOSSLESS | LOSSLESS | |
| articulations | LOSSLESS | LOSSLESS | 집합으로 정규화 (중복 제거) |
| ornaments | LOSSLESS | LOSSLESS | **`wavy-line` DROPPED → EXT** |
| dynamics | LOSSLESS | LOSSLESS | **`sound@dynamics` DROPPED → EXT** (856건) |
| wedges | LOSSLESS | LOSSLESS | 양 끝 요구는 설계 (§5.10). 짝 없으면 WARNING |
| pedal | LOSSLESS | LOSSLESS | |
| octave-shift | LOSSLESS | LOSSLESS | |
| transpose | LOSSLESS (미검증) | LOSSLESS | concert 변환 fixture 필수 |
| repeats | LOSSLESS | LOSSLESS | |
| volta / endings | LOSSLESS | LOSSLESS | |
| pickup / implicit | LOSSLESS | LOSSLESS | |
| grace notes | LOSSLESS | LOSSLESS | `W-GRACE-ORPHAN` 유지 |
| directions | 부분 | 부분 | **`dashes` DROPPED → EXT** (354건) |
| measure numbering | LOSSLESS | LOSSLESS | |
| **barline fermata** | **DROPPED (10건)** | **LOSSLESS** | schema 변경 필요 (§18-S4) |
| **unpitched / percussion** | **UNSUPPORTED (전체 거절)** | **LOSSLESS** | schema는 이미 가능 (§17) |
| **glissando / slide** | **DROPPED** | **LOSSLESS** | schema 변경 필요 (§18-S5) |
| **multiple-rest** | **DROPPED (마디 수가 틀어진다)** | **EXT 또는 LOSSLESS** | §18-S6 |
| **microtone `<alter>`** | **UNSUPPORTED (전체 거절)** | **WARNING + 반올림** | §6.3 |
| **part-group** | **DROPPED** | **EXT** | 표시용 괄호. core에 넣을 이유 없음 |
| figured-bass | DROPPED | DROPPED | G1 §18에서 제외. report에는 남는다 |
| defaults / credit / layout | DROPPED | DROPPED | G1 §18에서 제외 |
| score-timewise | UNSUPPORTED | UNSUPPORTED | 변환해서 쓰라고 안내 |

### 6.3 "파일 전체 거절"을 없앤다

이 세션이 실행으로 확인한 세 가지다 (부록 A-3). 외부 파일 ingest에서 가장 나쁜 실패 모드다.

| 거절 | 원인 | G2의 답 |
| --- | --- | --- |
| `IMPORT-UNSUPPORTED-UNPITCHED` | 파일 어디에든 `<unpitched>`가 있으면 사전 스캔이 즉시 거절 (`musicxml-import.js:86`) | perc event로 읽는다 (§17). schema는 이미 `PercKit`·`perc` head를 가진다 |
| `IMPORT-UNSUPPORTED` — 첫 마디에 박자표 없음 | `if (!meterAt[0]) throw` (`:834`). `meterAt`은 **part 0**에서만 채운다 | ① 다른 part에서 찾고 ② 그래도 없으면 `4/4 hidden`을 **추론**해 넣고 `W-IMPORT-METER-ASSUMED`. `senza-misura`도 같은 길 |
| `IMPORT-UNSUPPORTED` — 미분음 `<alter>0.5` | `Pitch.alter`가 `T.int(-3,3)` | 가장 가까운 반음으로 반올림 + `W-IMPORT-MICROTONE` + 원본 값을 `ext`에 보존. **미분음 표현 자체는 G1 §18대로 범위 밖** |

남기는 UNSUPPORTED는 **두 가지뿐**이다: XML로 파싱되지 않는 바이트(`IMPORT-BAD-XML`), `score-timewise`.

### 6.4 Container와 encoding

`SG.import(bytes, {name})`가 판별한다.

1. `MThd`로 시작 → SMF (§7)
2. `PK\x03\x04` → zip. `META-INF/container.xml`의 `rootfile[full-path]`를 따른다. **지금 bench와 앱은 둘 다 container.xml을 읽지 않고 "첫 xml 엔트리"를 고른다** — 여러 rootfile이 있는 .mxl에서 틀린다.
3. 그 밖 → 텍스트. BOM 제거, `<?xml encoding=...>` 존중, UTF-16 지원.
4. 압축 폭탄 방어: 압축 해제 상한(기본 64 MB)과 엔트리 수 상한.

---

## 7. MIDI Import 설계

### 7.1 MIDI에 없는 것부터

MIDI에는 보통 **직접** 존재하지 않는다: 정확한 기보 음가, 철자(C# vs Db), voice, hand, staff, phrase, slur, notation tuplet, engraving intent, 그리고 대개 **마디의 의미**도.

있는 것은 정확히 있다: pitch(정수), on/off 시각, velocity, channel, track, controller, tempo map, meter map, key signature meta, program change.

**`midi_notes.py`를 재사용하지 않는 이유** (전부 코드에서 확인):

- track·channel을 버린다 (note dict에 없다).
- `tempo`가 파일 단위 단일 변수라, **format 1**에서 track 0의 tempo map을 다 읽은 뒤 track 1의 음에 *마지막* tempo를 적용한다. 템포가 바뀌는 곡에서 시각이 틀린다.
- time signature도 마지막 하나만 남는다.
- CC64만 본다. CC66·CC67은 없다.
- SMPTE division(`division & 0x8000`)을 480으로 대체한다 — 틀린 값이다.
- 끝까지 눌린 note-on은 버린다 (pedal만 닫는다).
- program change를 건너뛴다.

AMT 파이프라인에는 충분했지만 "무손실 ingest"의 기준에는 못 미친다. 다만 **삭제하지 않는다** — `transcribe.py`, `pm2s_quant.py`, `evaluate_transcription.py`가 쓰고 있고, 그 경로는 G2의 범위가 아니다.

### 7.2 세 층으로 나눈다

```
bytes ──► RawMidi ──────► Performance 층 ──────► notation skeleton
          무손실          µs 정수, 사실만        추론, op:'inferred'
          (midi-file.js)  (midi-import.js)       (midi-import.js)
                                                      │
                                                      ╎ G2 밖 (선택, §7.6)
                                                      ▼
                                                 notated events
```

### 7.3 RawMidi — 무손실 중간 표현

그래프를 모르는 순수 자료다. SMF의 사실을 **하나도 버리지 않는다**.

```js
RawMidi = {
  format: 0 | 1 | 2,
  division: {kind: 'ppq', ppq} | {kind: 'smpte', fps, subframes},
  tracks: [{
    index, name?,
    events: [{tick, kind, ...}]        // 문서 순서 그대로
  }],
  // 파생 색인 (사실에서 계산, 저장은 하지 않아도 된다)
  tempoMap: [{tick, usPerQuarter}],
  meterMap: [{tick, num, den, clocks, n32}],
  keyMap:   [{tick, sf, mi}],
  notes:    [{track, channel, midi, onTick, offTick, onVel, offVel, offKind}],
  controls: [{track, channel, cc, value, tick}],
}
```

규칙:

- **tick → µs는 tempo map 전체를 구간 적분해서 구한다.** format 1에서 track 0의 tempo map은 모든 track에 적용된다 (SMF 표준). `midi_notes.py`의 버그를 반복하지 않는다.
- note-on velocity 0 = note-off (표준). `offKind`에 어느 쪽이었는지 남긴다.
- 같은 (channel, pitch)가 겹치면 **FIFO**로 짝짓고, 짝을 지은 사실을 report에 남긴다.
- 끝까지 눌린 note-on은 **버리지 않는다**. 트랙 마지막 이벤트 tick에서 닫고 `W-MIDI-NOTE-UNCLOSED`.
- SMPTE division은 제대로 계산한다 (`1 tick = 1 / (fps × subframes)` 초).
- running status, SysEx, meta, 알 수 없는 이벤트를 전부 보존한다 (그래프로 안 가도 report에 센다).
- format 2는 "독립적인 곡 여러 개"다. **첫 sequence만 읽고 나머지는 report에 남긴다** (또는 거절). → 사용자 결정 D5.

### 7.4 Performance 층 매핑

| RawMidi | ScoreGraph | 메모 |
| --- | --- | --- |
| note | `PerfNote {on, off, vel, midi}` | µs 정수, §6.10 반올림 규칙 |
| note의 track·channel | **담을 곳이 없다** | §18-S1 (schema 변경) |
| CC64 / 66 / 67 | `PerfPedal {pedal: damper/sostenuto/soft, on, off, depth}` | 반페달은 `depth` |
| 그 밖의 CC (11, 1, 7 …) | **담을 곳이 없다** | §18-S2 |
| tempo map | `TempoEvent`(기보 층) + `Anchor`(연주 층) | §7.5 |
| meter map | `MeterEvent` | skeleton의 마디를 정한다 |
| key signature meta | `KeyEvent` | `op: 'imported'` |
| program change | `Instrument.midi.program` | track/channel → part 매핑 후 |
| track name / instrument name | `Part.name` | |

### 7.5 notation skeleton — 왜 반드시 필요한가

이 세션이 실행으로 확인했다 (부록 A-4): **`parts` 최소 1개, `timeline.measures` 최소 1개, `timeline.meters`가 필수**라 **연주만 든 그래프는 만들 수 없다**. 게다가 `Anchor`는 재생 순서에 실제로 존재하는 `(measure, visit)`를 가리켜야 하고 엄격히 증가해야 한다 (`validate.js:863,870`).

그래서 MIDI import는 skeleton을 만든다. **결정론적이고, 추론을 최소로 하고, 전부 `op: 'inferred'`로 표시한다.**

1. **Part**: channel·track 조합마다 하나. 이름은 track name → program 이름 → `Track N`. channel 10은 percussion (§17).
2. **Staff**: part마다 1개. 피아노(program 0–7)라도 **손 배정을 하지 않는다** — staff 2개로 쪼개는 것은 추론이고 G3다.
3. **Voice**: part마다 1개.
4. **Meter**: SMF meter map 그대로. 없으면 `4/4` + `W-MIDI-METER-ASSUMED`.
5. **Measure**: meter map과 tempo map을 tick 위에서 접어, **마지막 음이 끝나는 tick을 덮을 만큼** 만든다. 마디 길이는 박자표에서 나온다.
6. **Tempo**: SMF tempo map → `TempoEvent` 열.
7. **Event**: **만들지 않는다.** skeleton은 빈 마디다 (또는 마디 쉼표). 기보 음가는 추론이므로 G2의 기본 경로가 만들지 않는다.
8. **Anchor**: 각 마디 시작 tick의 µs를 `kind: 'bar'` anchor로 둔다. 이것이 연주 시각과 기보 위치를 잇는 유일한 다리다.

결과: **소리와 시간은 완전히 정확하고, 기보는 "빈 격자"다.** 그래프는 유효하고, `PerfNote`는 `link` 없이 존재한다 (schema가 허용한다 — `link`는 optional).

### 7.6 notation으로 갈 때 — G2가 하지 않는 것과 하는 것

**G2가 새로 만들지 않는 것**: 리듬 양자화, 성부 분리, 손 배정, 철자 추론, tuplet 인식, slur·phrase 추론. 전부 G3다.

**G2가 하는 것 (선택 경로)**: 이미 있고 이미 G0로 측정되는 `audio-score.js`의 양자화기에 MIDI 음을 **그대로 태운다**. 새 지능이 아니라 배선이다.

```
RawMidi.notes ──► {on, off, midi, vel} 초 단위
                  └─► audio-score.js  toMusicXml / fromGrid  (이미 있음)
                          └─► buildGraph ──► ScoreGraph (기보 있음)
                                   + MIDI performance 층을 그대로 붙인다
```

이 경로는 `opts.notate: true`일 때만 돈다. 결과 그래프의 기보 쪽 provenance는 전부 `op: 'inferred'`, `src`는 `kind: 'midi-file'`이다. 품질은 **G0 core/robust 수치가 그대로 말해 준다** — 새 주장을 만들지 않는다.

> **D3 (사용자 결정)**: `.mid`를 열었을 때 기본이 "연주만"인가 "기보까지"인가. 기본을 "연주만"으로 하면 앱이 악보를 못 그린다. 기본을 "기보까지"로 하면 사용자는 추론된 악보를 원본으로 오해할 수 있다. Architect 권고: **기본 `notate: true`**, 단 UI가 "리듬은 추정입니다"를 보여 주고 report가 그 근거를 준다.

---

## 8. Performance ≠ Notation

G1의 원칙을 그대로 유지한다. G2가 추가로 못 박는 것:

- **연주 시각은 정수 µs다.** RawMidi의 tick은 tempo map 적분으로 µs가 되고, 그 값은 반올림 규칙(§6.10) 한 번만 거친다. 두 번 반올림하지 않는다.
- **기보 시각은 정확한 유리수다.** MIDI 어디에도 기보 시각은 없다. skeleton의 마디 경계만이 기보 시각이고, 그것은 meter map에서 **정확히** 나온다 (추론이 아니다 — 박자표는 파일에 적혀 있다).
- **snap 금지.** MIDI 음의 on/off를 1/16, 1/32에 붙여 `PerfNote`에 저장하는 일은 없다. 양자화된 값이 필요하면 `Event`(기보 층)로 가고, 원본 µs는 `PerfNote`에 그대로 남는다.
- **두 층은 `link`로만 만난다.** `PerfNote.link → Head.id`. 링크가 없는 `PerfNote`는 정상이다 (연주만 들어온 경우).
- 검증 장치도 이미 있다: `W-PERF-LINK-PITCH`는 링크된 head의 음높이와 `PerfNote.midi`가 다르면 경고한다.

---

## 9. Round-trip과 Semantic Fidelity

"parse 성공률"은 품질이 아니다. 측정은 이미 있는 두 도구 위에 세운다.

### 9.1 MusicXML: MusicXML → ScoreGraph → MusicXML

G1의 `sg-roundtrip`이 이미 4단계를 잰다 (`pppbench/sg_roundtrip.py`):

| 레벨 | 뜻 | 지금 |
| --- | --- | --- |
| L1 | 앱이 보는 음악이 같다 (`semantic.classify`, G0 projection) | 368/369 |
| L1+ | 인쇄되는 표기가 같다 (`notation_inventory`) | 367/369 |
| L2 | 그래프가 고정점이다 (import∘export∘import == import) | 369/369 |
| G01 A17 | 재생 순서가 앱과 같다 (`time.unroll` == `app_play_order`) | 369/369 |

**G2가 더하는 것**:

- **L1++ (신규)**: `notation_inventory`를 §6.2에서 새로 담기로 한 것들로 넓힌다 — barline fermata, glissando, part-group, dashes, wavy-line, `sound@dynamics`, multiple-rest, 미분음 원본값. 넓힌 inventory로 **코퍼스 369 + 새 fixture**가 전부 통과해야 한다.
- **L3 (신규, transpose 전용)**: concert pitch 불변. `<transpose>`가 있는 파일을 import → export → import 했을 때 **울리는 음높이**가 같다. 지금 코퍼스에 0건이라 fixture로만 잰다.
- **allowlist는 파일 단위에서 사유 단위로 바꾼다** (G1 F6). 지금 allowlist에 오른 파일이 *다른* 차이를 얻어도 통과한다.

**측정 기준(§7의 목록) → 어느 도구가 재나**

| 기준 | 도구 |
| --- | --- |
| pitch · onset · duration · voice · staff · meter/key/tempo 열 · 반복 재생 | G0 `semantic.projection` (L1) |
| spelling · ties/slurs/spanners · dynamics · pedal · 표기 재고 | `notation_inventory` (L1+) |
| transposition · octave-shift | L3 + L1 (울리는 음높이) |
| 그래프 안정성 | L2 고정점 |

### 9.2 MIDI: MIDI → ScoreGraph → MIDI

byte 동일성은 목표가 아니다 (SMF는 같은 의미를 여러 바이트로 쓴다). **canonical event projection**을 비교한다.

```
SMF ──► RawMidi ──► ScoreGraph ──► RawMidi' ──► SMF'
         │                            │
         └──── canonical projection ──┘   ← 이 둘이 같아야 한다
```

projection은 정렬된 다중집합이다:

- 음: `(track, channel, midi, onUs, offUs, onVel)`
- controller: `(track, channel, cc, value, us)`
- tempo map: `(us, usPerQuarter)`
- meter map: `(us, num, den)`
- key map: `(us, sf, mi)`

**µs 허용 오차 0.** tick → µs는 한 번만 계산하고, 되돌릴 때 같은 tempo map을 쓰므로 정확히 같아야 한다. 같지 않으면 그것은 설계 결함이지 반올림이 아니다.

> MIDI export(`RawMidi' → SMF'`)는 fidelity 측정을 위해 필요하다. 사용자가 쓰는 기능으로서의 MIDI export는 §21에서 범위 밖으로 둔다 — 측정용 writer면 충분하다.

---

## 10. Corpus 전략

### 10.1 지금 코퍼스로는 부족하다

§2.3이 근거다. 369개는 전부 피아노 교재이고, multi-part 1건, transpose 0건, percussion 0건이다. **코퍼스를 늘리지 않으면 G2의 어떤 주장도 검증되지 않는다.**

### 10.2 MusicXML coverage matrix

`tests/scoregraph/fixtures/xml/`에 **손으로 쓴 최소 파일**로 채운다 (라이선스 문제가 없고, 무엇을 재는지가 분명하다). 각 fixture는 `.expect.json` sidecar를 갖는다 — 지금 `tests/scoregraph/fixtures/` 관례 그대로다.

| # | fixture | 재는 것 |
| --- | --- | --- |
| X1 | simple-piano | 회귀 기준선 |
| X2 | multi-voice-piano (voice 4개, 겹침) | `W-IMPORT-VOICE-SPLIT` 규칙 |
| X3 | three-staves-organ | staves ≥ 3 |
| X4 | pickup-anacrusis | implicit 첫 마디 |
| X5 | compound-meter 6/8, 12/8 | 박 묶음 |
| X6 | tempo-changes (`sound@tempo` + metronome 불일치) | 템포 열, `W-TEMPO-MARK-MISMATCH` |
| X7 | key-changes (중간 전조 + `<cancel>`) | 조표 열 |
| X8 | transpose-clarinet-bb | **L3 concert pitch** |
| X9 | transpose-octave (piccolo, guitar) | `octave-change` |
| X10 | ottava-8va-8vb-15ma | 표시 옥타브 파생 |
| X11 | repeat-volta-1-2-3 | 재생 순서 |
| X12 | dacapo-dalsegno-coda | `I-JUMP-IGNORED` 경계 |
| X13 | grace-acciaccatura-appoggiatura | grace 순서 |
| X14 | tuplets-nested | tuplet 사슬 (**bracket 규칙은 G3, 건드리지 않는다**) |
| X15 | pedal-change-halfpedal | pedal `changes` |
| X16 | dynamics-and-wedges | wedge 양 끝 |
| X17 | multi-part-4 (SATB) | part 4개, part별 지시 (F9) |
| X18 | multi-part-no-id | **id 없는 part 2개** (코퍼스 92개 파일의 병 + 다중 part) |
| X19 | percussion-drumset | `<unpitched>` (§17) |
| X20 | lyrics-verses-melisma | verse 여러 줄, extend |
| X21 | barline-fermata | **C4** |
| X22 | glissando-slide | **C5** |
| X23 | multiple-rest-8 | **C6** |
| X24 | senza-misura | **C2** |
| X25 | microtone-quarter-sharp | **C3** |
| X26 | harmony-chord-symbols | Direction `chord` |
| X27 | dashes-and-wavy-line | C7, C8 |
| X28 | part-group-brace | C9 |
| X29 | malformed-unclosed-tie | 결함 보존 (`W-TIE-OPEN`) |
| X30 | malformed-short-measure | `W-MEASURE-LENGTH` |
| X31 | malformed-bad-encoding (UTF-16 + BOM) | §6.4 |
| X32 | mxl-multi-rootfile | container.xml 준수 |

### 10.3 MIDI micro fixtures

`tests/scoregraph/fixtures/midi/`. **전부 코드로 생성**한다 (바이트를 커밋하되 생성기도 커밋한다 — `tests/fixtures/make-fixtures.js` 관례).

| # | fixture | 재는 것 |
| --- | --- | --- |
| M1 | single-note | 최소 |
| M2 | chord-3 | 동시 on |
| M3 | overlap-same-pitch | FIFO 짝짓기 |
| M4 | note-on-velocity-0 | note-off 동치 |
| M5 | unpaired-note-on | `W-MIDI-NOTE-UNCLOSED` |
| M6 | sustain-pedal-cc64 | PerfPedal |
| M7 | half-pedal-cc64-64 | `depth` |
| M8 | sostenuto-soft-cc66-67 | 세 페달 |
| M9 | other-cc-11-expression | **담을 곳 없음** (§18-S2) |
| M10 | format0-single-track | format 0 |
| M11 | format1-tempo-track | **track 0 tempo map이 track 1에 적용된다** (`midi_notes.py` 버그) |
| M12 | format2-multi-sequence | D5 |
| M13 | tempo-map-ramp | 여러 tempo 변화 |
| M14 | meter-changes | 4/4 → 3/4 → 6/8 |
| M15 | key-signature-meta | KeyEvent |
| M16 | ppq-96 / ppq-480 / ppq-960 | division 변형 |
| M17 | smpte-division | **`midi_notes.py`가 틀리는 곳** |
| M18 | multi-channel-4 | channel → part |
| M19 | channel-10-drums | §17 |
| M20 | program-change | Instrument |
| M21 | running-status | 파서 견고성 |
| M22 | sysex-and-unknown-meta | 보존·집계 |
| M23 | track-name-meta | Part.name |
| M24 | offset-start (첫 음이 tick 0이 아님) | anchor 시작 |
| M25 | truncated-track | FATAL 경계 (§13) |
| M26 | large-20k-notes | 성능 (§15) |

### 10.4 provenance / license

새 fixture는 전부 **PPP가 직접 만든 것**이다 (`generated_internally: true`). 외부 파일을 새로 들여오지 않는다 — G0의 `tools/make_provenance.py --check`가 CI에서 막고, 그 정책을 바꿀 이유가 없다. 기존 코퍼스 369개의 provenance는 그대로다.

---

## 11. ImportReport

지금 `{issues, dropped, validation}`은 내부 디버깅용이다. G2는 이것을 **UI와 사용자가 읽는 계약**으로 만든다.

```js
ImportReport = {
  ok: true | false,
  format: 'musicxml' | 'mxl' | 'midi',
  code?: 'IMPORT-BAD-XML' | ...,            // ok:false일 때만
  message?: string,

  source: {                                  // 파일 자체의 사실
    name, bytes, sha256,
    container?: {kind: 'zip', rootfile},
    encoding?: 'utf-8' | 'utf-16le' | ...,
    software?, encodingDate?,                // <encoding><software>
    midi?: {format, division, tracks}
  },

  counts: {                                  // 들어온 것
    parts, staves, voices, measures, events, heads, rests,
    ties, slurs, tuplets, spanners, directions,
    perfNotes, perfPedals, anchors
  },

  normalized: [{code, count, detail}],       // 의미는 같고 표현만 바꾼 것
  preserved:  [{ns, what, count}],           // ext로 보존한 것
  dropped:    {name: count},                 // 버린 것 (이름 그대로)
  inferred:   [{what, count, why}],          // 우리가 만든 것 (MIDI skeleton 등)
  issues:     [{code, severity, message, ids?, where?}],   // W-IMPORT-*, W-MIDI-*
  validation: [{code, severity, message, ids?}],           // validator의 출력
  timing:     {parseMs, buildMs, validateMs}
}
```

규칙:

- **`dropped`가 비어 있고 `preserved`가 비어 있으면, 파일의 모든 element가 그래프에 있다.** 이것이 "무손실"의 조작적 정의다 (A12).
- `issues[].where`는 `{measure, part, voice}` 수준까지만 (§12).
- `ok: false`여도 report는 온다. 무엇까지 읽다 실패했는지가 보인다.
- report는 **순수 데이터**다. 문자열을 UI가 번역할 수 있게 `code`를 항상 함께 준다.

---

## 12. Provenance

### 12.1 이미 있는 것을 쓴다

`prov.js`의 계층 상속이 "모든 음에 무거운 문자열"을 이미 막는다: `provenance.default`가 `{src, op}`를 주고, **다른 것만** 자기 `prov`를 갖는다. 코퍼스 import 결과에서 `I-PROV-REDUNDANT`가 0건이라는 것은 이 규칙이 지켜지고 있다는 뜻이다.

### 12.2 G2가 정하는 것 — locator는 구간 단위로

과제가 든 예("MusicXML measure 14 voice 2 note 7", "MIDI track 1 event 342")를 **음마다** 저장하면 안 된다. head당 212 B인 그래프가 두 배가 된다.

**결정**: locator는 **ImportReport에만** 둔다. 그래프에는 두지 않는다.

- 그래프: `Source.input{name, sha256}` + `provenance.default{src, op}`. 음마다 반복되는 것은 없다.
- 디버깅 필요 시: `ImportReport.issues[].where = {measure: '14', part: 'P1', voice: '2'}`. 문제가 있는 곳에만 붙으므로 크기가 문제되지 않는다.
- 이유: sha256이 있으므로 원본을 다시 열면 언제든 정확한 위치를 다시 찾을 수 있다. 같은 정보를 그래프에 굳혀 둘 이유가 없다.

### 12.3 op 배정

| 무엇 | op | 비고 |
| --- | --- | --- |
| MusicXML에 적힌 모든 것 | `imported` | `provenance.default` |
| 추론한 박자표 (§6.3) | `inferred` | 해당 `MeterEvent.prov` |
| 미분음 반올림 결과 | `inferred` + `asp: {pitch: ...}` | aspect 단위 |
| MIDI PerfNote / PerfPedal | `imported` | 사실 |
| MIDI skeleton (part·staff·voice·measure·meter) | `inferred` | **전부** |
| MIDI를 양자화한 기보 event (§7.6) | `inferred` | `conf`는 audio-score의 값이 있으면 넣는다 |

`conf`는 **있을 때만** 넣는다 (`prov.js`: "A missing conf stays missing: an unknown confidence is not 1").

---

## 13. Error Policy

### 13.1 세 등급

| 등급 | 뜻 | 결과 |
| --- | --- | --- |
| **FATAL** | 파싱 자체가 불가능하거나 graph invariant를 만들 수 없다 | `{ok: false, code, message, report}` — **값으로 돌아온다** |
| **RECOVERABLE** | 구조가 이상하지만 담을 수 있다 | `{ok: true, ...}` + `issues[]` + validator 경고 |
| **UNSUPPORTED** | core schema가 아직 표현하지 못한다 | 가능하면 `ext`로 보존 + `preserved[]`, 아니면 `dropped{}` — **파일은 들어온다** |

FATAL은 §6.3 뒤로는 사실상 둘뿐이다: XML이 아님, `score-timewise`. MIDI에서는 `MThd`가 아님, 잘린 track(M25).

### 13.2 throw와 값의 경계

G1 production은 **graph ERROR → throw**다 (G1-D13). 그 정책은 `toMusicXml`처럼 **우리가 만든 그래프**에 대해 옳다 — 우리 버그이기 때문이다.

**import path는 다르다.** 남의 파일이 나쁜 것은 우리 버그가 아니다. 그러니:

```
import 경계:  값으로 돌아온다    { ok: false, code, message, report }
              라이브러리 안에서 throw하지 않는다 (프로그래밍 오류 제외)

우리가 만드는 그래프(audio-score buildGraph 등):  throw 유지
```

구체적으로: `importMusicXml`은 이미 `E-BUILD`를 잡아 `IMPORT-INVALID`로 바꾼다. 이 패턴을 MIDI importer와 `SG.import`에도 그대로 쓴다. **앱은 import 실패로 죽지 않고, 그 파일 하나만 실패한다.**

### 13.3 importer가 ERROR를 숨기지 않게

importer가 입력을 고쳐서 validator를 통과시키면 DP1이 무너진다. 막는 방법:

- import가 만든 그래프의 validator 출력은 **전부** `report.validation`에 들어간다. 경고를 삼키지 않는다.
- `normalized[]`에 적히지 않은 변형은 금지다. 새 정규화를 넣으려면 코드와 report와 fixture가 함께 움직여야 한다 (A13이 강제한다).
- mutation 검사(§16)가 "importer가 결함을 조용히 고치는" 변이를 심어 잡는다.

---

## 14. 앱 import 경계 migration

### 14.1 목표 구조

```
지금:   MusicXML ──► parseMusicXML ──► Score ──► 렌더러·재생·연습·편곡
G2:     MusicXML ──► ScoreGraph ──► toLegacyScore ──► Score ──► (그대로)
                        └──► 저장 (버전 있는 .sg.json)
```

계약은 **G01 부록 B에 이미 다 적혀 있다.** G2가 새로 쓰지 않고 그것을 구현한다.

### 14.2 한 번에 바꾸지 않는다 — 3단계

| 단계 | 하는 일 | 게이트 |
| --- | --- | --- |
| **M1 shadow** | `parseMusicXML`은 그대로 쓴다. 뒤에서 `SG.import` → `toLegacyScore`를 돌려 **두 Score를 비교**하고 결과만 기록한다. 사용자에게 보이는 것은 변하지 않는다 | 코퍼스 369 + fixture에서 차이 0 |
| **M2 A/B** | `opts.graphImport` 플래그로 새 경로를 선택할 수 있다. 기본은 옛 경로 | bench A/B가 케이스별 동일 |
| **M3 flip** | 기본을 새 경로로. `parseMusicXML`은 한 릴리스 동안 되돌리기 경로로 남긴다 | A/B 동일 + `npm test` 통과 집합 불변 |

G1의 `opts.legacyWriter`와 같은 모양이다 — 검증된 패턴을 반복한다.

### 14.3 parity에서 미리 정해야 하는 것

| 문제 | 근거 | G2의 답 |
| --- | --- | --- |
| 앱은 dynamics·tempo·`sound`를 **모든 part**에서 읽어 다중 part 파일에서 중복된다 (G01 F9) | App 4076–4120 | **재현한다** (parity 우선). 고치는 것은 별도 Goal. report가 중복을 알린다 |
| 앱의 piano part 선택: staves ≥ 2인 part, 없으면 마지막 part. 그 마지막 두 staff가 RH/LH | App 4287–4298 | **그대로 적용.** SG의 `limb`는 G2에서 쓰지 않는다 (부록 B) |
| octave-shift 해석 차이 (이슈 3) | 부록 B "결정 필요 (G2)" | **사용자 결정 D4** |
| `PianoScore.of`가 score 객체 identity로 캐시한다 (G01 F8) | App 2566–2579 | 불변 그래프가 해결한다. M3에서 자연히 사라진다 |
| `ScoreArranger.fromEngine`의 옥타브 이중 이동 (G01 F3) | App 8988–9008 | M3에서 재확인. 별도 fixture |

### 14.4 저장 형식

지금 저장은 `packScore`(키 사전 + 값 행)이고 **버전이 없다**. G2는 저장에 `graph`(canonical `.sg.json`)를 **함께** 넣는다:

- 새 슬롯: `{scoregraph: <canonical json>, score: packScore(...)}` — 둘 다 쓴다.
- 읽을 때 `scoregraph`가 있으면 그것으로 `toLegacyScore`. 없으면 옛 `unpackScore`.
- 크기 걱정은 측정으로 답한다: `.sg.json`은 원본 MusicXML의 0.75–0.85배, head당 212 B, gzip 19 B (부록 A-2). 지금 `packScore`가 푸는 문제(localStorage 한도)를 악화시키지 않는지 M1에서 잰다. → **A31**

---

## 15. 성능

### 15.1 측정한 것 (부록 A-2)

| head | import | validate | serialize | **export** | `.sg.json` |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 34 ms | 7 ms | 4 ms | 11 ms | 0.12 MB |
| 4,000 | 84 ms | 24 ms | 11 ms | 52 ms | 0.50 MB |
| 16,000 | 344 ms | 79 ms | 45 ms | **467 ms** | 2.01 MB |
| 36,000 | 737 ms | 168 ms | 102 ms | **2,120 ms** | 4.55 MB |
| 72,000 | 1,770 ms | 344 ms | 216 ms | **8,142 ms** | 9.13 MB |

import·validate·serialize는 **선형**이다 (head당 20–25 µs). 실제 피아노 곡의 상한(1만~2만 음)에서 import는 0.2–0.5 s — 문제없다.

### 15.2 export가 O(n²)다 — 원인을 찾았다

`musicxml-export.js:279`:

```js
const evs = part.events.filter(e => e.m === m.id);   // ← 마디 루프 안
```

마디마다 전체 event를 훑는다. 7,200마디 × 72,000 event = 5억 회. 같은 자리에 `part.clefs.filter(...)`와 `(tl.keys||[]).forEach(...)`도 있다.

- **G1 코드이고 G1의 결함이 아니다** — G1 코퍼스의 최대가 1,776 head라 드러나지 않았다.
- **G2에는 영향이 있다**: §9의 fidelity suite가 모든 fixture에서 export를 돌리고, 대형 fixture(M26, 2만 음)를 넣기로 했다.
- **고치는 법은 뻔하다**: event를 `m` 기준으로 한 번 색인(Map)하고 마디 루프가 조회만 한다. 한 함수 안의 지역 변경이고 출력 바이트는 바뀌지 않는다.
- **premature optimization이 아니다**: 8초는 사용자가 기다릴 수 없는 시간이고, 근거가 측정이다. **A30**으로 게이트를 건다.

### 15.3 예산

| 대상 | 예산 | 근거 |
| --- | --- | --- |
| import 1,000 음 | < 100 ms | 지금 34 ms |
| import 10,000 음 | < 600 ms | 지금 ~250 ms |
| import 20,000 음 (M26) | < 1.5 s | 선형 외삽 |
| export 20,000 음 | **< 1.5 s** | 지금 ~700 ms(선형화 후 추정), 현재는 O(n²) |
| `.sg.json` 크기 | 원본 MusicXML의 ≤ 1.2배 | 지금 0.75–0.85배 |
| peak memory (20,000 음) | < 300 MB | Node `--max-old-space-size` 기본에서 여유 |

측정은 `tests/bench/run.py`에 새 명령을 만들지 않고 `tests/scoregraph/`의 node 테스트로 잰다 (G1의 "2,000마디 40,000 head가 5초 안에 validate" 테스트와 같은 자리).

---

## 16. G0/G1 품질 인프라 연결

**G0를 다시 설계하지 않는다.** 올라탄다.

### 16.1 SUT를 넓힌다

지금 SUT 스냅샷은 `audio-score.js` + `scoregraph/*.js` (14개 파일, `pppbench/sut.py`의 `SUT_TREES`). 새 파일(`import.js`, `midi-file.js`, `midi-import.js`)은 `scoregraph/` 안에 두므로 **자동으로 SUT에 포함된다**. `check_closure`가 스냅샷을 벗어난 모듈 적재를 거절하는 장치도 그대로 동작한다. G1이 만든 multi-file SUT 보장을 그대로 유지한다.

### 16.2 새 suite 두 개만 더한다

| 명령 | 재는 것 | CI |
| --- | --- | --- |
| `run.py sg-roundtrip` (기존, 넓힘) | L1 · L1+ · **L1++** · L2 · L3 · play order | gate |
| `run.py midi-roundtrip` (신규) | §9.2 canonical event projection | gate |
| `run.py import-report` (신규) | fixture마다 ImportReport가 sidecar와 정확히 같다 | gate |

`core`/`robust`/`full`/`golden`/`smoke` 같은 **전사 품질 suite는 건드리지 않는다.** G2는 전사 경로를 바꾸지 않으므로 그 수치가 움직이면 그 자체가 회귀다 → **A28**.

### 16.3 Importer mutation

`pppbench/mutation.py`에 importer 변이를 더한다. 각 변이는 "이름 그대로의 음악 결함"을 만들고, 어떤 suite가 잡는지 명시한다.

| mutation | 심는 결함 | 잡는 곳 |
| --- | --- | --- |
| `IM-ACCIDENTAL-DROP` | 임시표를 읽지 않는다 | L1+ (notation inventory) |
| `IM-TIE-LOSS` | tie start를 버린다 | L1 (semantic) + L1+ |
| `IM-VOICE-COLLAPSE` | 모든 음을 voice 1로 | L1 (voice layout) |
| `IM-STAFF-COLLAPSE` | 모든 음을 staff 1로 | L1 (structure) |
| `IM-TEMPO-MAP-LOSS` | 첫 템포만 읽는다 | L1 (tempo 열) |
| `IM-REPEAT-LOSS` | backward repeat를 버린다 | L1 (play order) + G01 A17 |
| `IM-OCTAVE-SHIFT-DROP` | ottava를 버린다 | L1 (울리는 음높이) |
| `IM-TRANSPOSE-IGNORE` | `<transpose>`를 무시한다 | **L3** |
| `IM-REPORT-SILENT` | dropped 집계를 빼먹는다 | `import-report` (A12) |
| `MD-NOTE-OFF-LOSS` | 짝 없는 note-on을 조용히 버린다 | `midi-roundtrip` |
| `MD-PEDAL-LOSS` | CC64를 읽지 않는다 | `midi-roundtrip` |
| `MD-TEMPO-LAST-ONLY` | **`midi_notes.py`의 버그를 재현한다** | `midi-roundtrip` (M11) |
| `MD-CHANNEL-MERGE` | channel을 합친다 | `midi-roundtrip` (M18) |
| `MD-VELOCITY-FLATTEN` | 모든 velocity를 64로 | `midi-roundtrip` |

`mutation-check`는 지금 40개를 심어 전부 잡는다. G2 뒤에는 54개다. **no-op 변이가 바이트 동일**이어야 한다는 규칙도 그대로다.

---

## 17. Percussion 확장성

**schema는 이미 준비돼 있다.** `Instrument.kit`(`PercKit`/`KitItem`), `Head`의 `inst`·`pos`·`notehead`·`stroke`, `Event.kind: 'perc'`, `Staff.kind: 'percussion'`, `INSTRUMENT_KINDS`의 `drumset`/`percussion`. G1이 `drums-with-piano` fixture로 ERROR 0을 확인했다.

막고 있는 것은 **importer와 exporter뿐**이다:

- `musicxml-import.js:86` — `<unpitched>`가 하나라도 있으면 파일 전체 거절.
- `musicxml-export.js:50` — perc event가 있으면 export 거절.

### 17.1 MusicXML `<unpitched>` → perc

```
<unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
  → Head {inst: <kit key>, pos: {step: 'C', oct: 5}, notehead?}
<score-part>의 <midi-unpitched> (GM 번호)
  → KitItem {key, gm, pos, notehead}
```

kit는 **파일에서 만든다** (추론하지 않는다): `<score-instrument>`마다 KitItem 하나, `key`는 instrument name을 kebab-case로. GM 번호가 있으면 `gm`에 넣는다. 없으면 `pos`만으로 구별한다.

### 17.2 MIDI channel 10 → perc

- channel 10(1-based)은 percussion part로 간다.
- 각 note number → KitItem. `gm`은 note number 그대로(27–87 범위 밖이면 `ext`로 보존 + 경고). `pos`는 **GM 표준 배치표**에서 결정론적으로 정한다.
- 배치표는 코드에 고정된 상수다 — 추론이 아니라 규약이다.

### 17.3 하지 않는 것

드럼 편곡 AI, 드럼 렌더링, 드럼 재생, 드럼 기보 품질. **표현과 왕복까지만.**

---

## 18. Schema Review

과제 §19가 요구한 대로, 숨기지 않고 적는다. 각 항목에 실제 fixture와 "왜 `ext`로 부족한가"를 붙인다.

| # | 부족한 것 | fixture | 왜 ext로 부족한가 | 호환성 영향 |
| --- | --- | --- | --- | --- |
| **S1** | `PerfNote`가 track·channel을 못 담는다 | M18, M19 | **`ext`를 쓸 수조차 없다.** `EXT_HOSTS`에 `PerfNote`가 없어 `E-SHAPE`로 거절된다 (실행 확인, 부록 A-4). track/channel은 MIDI 연주의 1차 사실이고, part 매핑·drum kit 해석·재수출이 전부 여기에 달려 있다 | 필드 추가 (optional) |
| **S2** | `PerfPedal.pedal`이 damper/sostenuto/soft 닫힌 enum | M9 | 일반 CC(expression 11, modulation 1)는 "페달"이 아니다. enum을 늘리는 것도 틀린 모델 — **controller 번호와 값 곡선**이 필요하다 | 새 배열 `Performance.controls` |
| **S3** | 연주 전용 그래프가 불가능 (`parts` ≥ 1, `measures` ≥ 1 필수) | M1 | 설계상 옳을 수도 있다 — ScoreGraph는 *Score*Graph다 | **변경하지 않는다.** §7.5의 skeleton으로 푼다 |
| **S4** | `<barline>`의 fermata를 담을 곳이 없다 | X21 (+ 코퍼스 10건) | `Fermata`는 `Event`에만 있다. 마디선 위의 늘임표는 event가 아니다. `Measure.ext`로 담으면 export가 되살릴 수 있지만 **L1+ inventory가 core 필드로 비교**하므로 ext는 비교에서 빠진다 | `Barline`에 optional `fermata` |
| **S5** | glissando / slide Spanner가 없다 | X22 | 두 head를 잇는 1차 표기다. `ext`에 넣으면 `ops.replaceRegion` 같은 편집 연산이 참조 무결성을 지켜 주지 못한다 (ext 안의 ID는 검증되지 않는다) | `Spanner.type`에 `gliss` 추가 |
| **S6** | multiple-rest를 담을 곳이 없다 | X23 | 지금은 마디 수 자체가 틀어진다 — **의미 손실**이지 표시 손실이 아니다 | `Measure`에 optional `multiRest` |
| S7 | 미분음 `alter` | X25 | G1 §18에서 명시적으로 범위 밖 | **변경하지 않는다.** 반올림 + ext 보존 (§6.3) |
| S8 | `part-group` | X28 | 순수 표시 정보. 음악 의미 없음 | **변경하지 않는다.** `ScoreGraph.ext`로 보존 |
| S9 | `dashes`, `wavy-line`, `sound@dynamics`, `part-group` | X27, X28 | 표시/연주 힌트. 참조 무결성이 필요 없고, 붙일 host(Direction·Event·Measure·ScoreGraph)가 있다 | **변경하지 않는다.** `ext`로 보존 |
| S10 | `<key><cancel>`, `key-octave` | X7 | **`KeyEvent`가 ext host가 아니라 ext조차 못 쓴다** (실행 확인). 다만 둘 다 조표 인쇄 방식이고 앞 조표에서 유도된다 | **변경하지 않는다.** DROPPED + report. 어긋나는 실물이 나오면 재검토 |
| S11 | `<staff-details><staff-lines>` | X19 | schema에 `Staff.lines`가 이미 있다 (실행 확인) | **변경하지 않는다.** importer만 고치면 된다 |

### 18.1 결론: `scoregraph_version` 1 → 2가 필요하다

S1·S2·S4·S5·S6 다섯 건이 core 변경이다. 전부 **optional 필드 추가**라 v1 그래프는 v2에서 그대로 유효하지만, 반대는 아니다 — validator가 `scoregraph_version === SCOREGRAPH_VERSION`을 강제하므로 (`validate.js:70`) v2 그래프를 v1 라이브러리가 읽으면 `E-VERSION`으로 **정확히 거절된다**. 이것이 버전 번호가 있는 이유다.

기계는 이미 있다: `serialize.js`의 `MIGRATIONS`는 지금 비어 있고(`v1이 첫 버전`), `tests/scoregraph/migrations/`에 합성 migration 테스트(`v0.json` → `v1.sg.json`)가 있다. **`MIGRATIONS[1] = doc => ({...doc, scoregraph_version: 2})` (항등)** 하나면 된다.

영향 범위:

- 커밋된 `.sg.json` 52개 + golden 17개가 v2로 다시 찍힌다 → **바이트가 바뀐다.** `tests/scoregraph/tools/make-golden.js`로 다시 만들고 diff를 검토한다.
- `audio-score.js`의 `SCOREGRAPH_VERSION = '1.0.0'` 라이브러리 버전 체크는 **schema 버전과 다른 값**이다 (혼동 주의). 라이브러리 버전은 올린다 (`1.1.0`).
- 앱이 저장한 그래프가 아직 없으므로(§14.4는 G2에서 처음 저장) **마이그레이션할 사용자 데이터가 없다.** 버전을 올리기에 지금이 가장 싸다.

> **D1 (사용자 결정)**: 이 5건을 다 넣고 v2로 갈지, S4·S5·S6만 넣고 MIDI(S1·S2)는 다음으로 미룰지. Architect 권고: **다섯 건 한 번에**. 버전을 두 번 올리는 것이 더 비싸다.

---

## 19. Acceptance Criteria

각 항목은 **테스트 이름 / 명령 / fixture / 기대 결과**를 갖는다. 주관적 표현을 쓰지 않는다.

### 19.1 기반 (A1–A6)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A1 | 기존 코퍼스 회귀 | `run.py sg-roundtrip` | 코퍼스 369 | L1 368, L1+ 367, L2 369, play order 369. **G2 전후 동일** |
| A2 | ScoreGraph 단위 테스트 | `npm run test:scoregraph` | 전체 | 전부 통과, 실패 0 |
| A3 | schema v2 migration | `npm run test:scoregraph` | `migrations/v1.sg.json` | v1 문서가 v2로 올라가고 `parse` 후 `validate.ok === true` |
| A4 | golden 재생성이 결정론적 | `node tests/scoregraph/tools/make-golden.js` 2회 | golden 17 | 두 번의 출력이 바이트 동일 |
| A5 | 라이브러리 버전 불일치 거절 | `npm run test:scoregraph` | `browser-load.test.js` | 옛 라이브러리 + 새 `audio-score.js` → throw `reload the page` |
| A6 | SUT 폐쇄성 | `run.py golden` | 새 3개 파일 | `sut_files`가 17개 파일을 포함하고 `check_closure` 통과 |

### 19.2 MusicXML importer 완성도 (A7–A18)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A7 | `<unpitched>` import | `npm run test:scoregraph` | X19 | `ok: true`, perc event 수 == 파일의 `<unpitched>` 수, ERROR 0 |
| A8 | senza-misura / 박자표 없음 | `npm run test:scoregraph` | X24 | `ok: true` + `W-IMPORT-METER-ASSUMED` 1건, 마디 수 == 파일의 `<measure>` 수 |
| A9 | 미분음 | `npm run test:scoregraph` | X25 | `ok: true` + `W-IMPORT-MICROTONE`, `alter`는 정수, 원본 0.5가 `ext`에 있음 |
| A10 | barline fermata | `run.py sg-roundtrip` | X21 + 코퍼스 10건 | `dropped`에 `fermata` **0건**, L1+ 통과 |
| A11 | glissando | `run.py sg-roundtrip` | X22 | `dropped`에 `glissando` 0건, export가 `<glissando>` 두 끝을 되쓴다 |
| A12 | **무손실의 정의** | `run.py import-report` | X1–X32 | 각 fixture의 report가 sidecar와 **정확히 같다**. `dropped`가 비었다고 적힌 fixture는 실제로 모든 element가 소비된다 |
| A13 | 정규화는 선언된 것만 | `run.py import-report` | X1–X32 | `normalized[]`에 없는 변형이 일어나면 실패 |
| A14 | multi-part | `run.py sg-roundtrip` | X17, X18 | part 4개가 각각 유지, L1+ 통과, id 없는 part 2개가 **합쳐지지 않는다** |
| A15 | transpose concert pitch | `run.py sg-roundtrip` | X8, X9 | **L3**: import→export→import 후 울리는 MIDI 음높이 다중집합이 같다 |
| A16 | multiple-rest | `run.py sg-roundtrip` | X23 | 마디 수가 원본과 같다 (지금은 틀어진다) |
| A17 | 결함 보존 | `npm run test:scoregraph` | X29, X30 | 열린 tie와 짧은 마디가 **고쳐지지 않고** `W-TIE-OPEN`·`W-MEASURE-LENGTH`로 나온다 |
| A18 | container / encoding | `npm run test:scoregraph` | X31, X32 | UTF-16+BOM이 읽히고, 여러 rootfile .mxl에서 container.xml이 지정한 것을 연다 |

### 19.3 MIDI (A19–A29)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A19 | SMF 파싱 기본 | `npm run test:scoregraph` | M1–M4 | RawMidi의 note 수·tick·velocity가 생성기 입력과 정확히 같다 |
| A20 | note-on velocity 0 | `npm run test:scoregraph` | M4 | note-off로 해석, `offKind === 'note-on-0'` |
| A21 | 짝 없는 note-on | `npm run test:scoregraph` | M5 | 버리지 않고 track 끝에서 닫음 + `W-MIDI-NOTE-UNCLOSED` 1건 |
| A22 | **format 1 tempo map** | `npm run test:scoregraph` | M11 | track 1의 음 µs가 track 0의 **구간별** tempo로 계산된다 (`midi_notes.py`와 다른 값) |
| A23 | SMPTE division | `npm run test:scoregraph` | M17 | µs가 `fps × subframes`로 계산된다 (480 대체 아님) |
| A24 | 세 페달 | `npm run test:scoregraph` | M6–M8 | CC64/66/67이 각각 damper/sostenuto/soft PerfPedal, 반페달은 `depth` |
| A25 | 그 밖의 CC | `run.py midi-roundtrip` | M9 | `Performance.controls`에 보존, projection이 같다 |
| A26 | **MIDI round-trip** | `run.py midi-roundtrip` | M1–M25 | canonical event projection이 **정확히 같다** (µs 오차 0) |
| A27 | skeleton이 추론임이 보인다 | `npm run test:scoregraph` | M13, M14 | skeleton의 part·staff·voice·measure·meter의 `provOf(...).op === 'inferred'` |
| A28 | **전사 품질 불변** | `npm run bench` + `run.py ab --suite core --a git:<base> --b worktree` | core 553 | 케이스별 동일 (`ab_identical`). G2는 전사 경로를 바꾸지 않는다 |
| A29 | channel 10 | `run.py midi-roundtrip` | M19 | perc part, KitItem이 GM 배치표대로 |

### 19.4 성능 (A30–A31)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A30 | **export 선형화** | `npm run test:scoregraph` | 합성 36,000 head | export < 1.5 s이고, 36k/16k 시간비 < 3.0 (지금 4.5) |
| A31 | 저장 크기 | `npm run test:scoregraph` | X1–X32 + 코퍼스 표본 | `.sg.json` ≤ 원본 MusicXML × 1.2 |

### 19.5 앱 migration (A32–A38)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A32 | legacy adapter parity | `run.py legacy` (또는 신규 T1-C) | 코퍼스 369 | `toLegacyScore(import(f))` == `parseMusicXML(f)` — 부록 B의 모든 필드 |
| A33 | shadow 차이 0 | M1 단계 리포트 | 코퍼스 369 + X1–X32 | 두 Score의 차이 0건 |
| A34 | 앱 A/B | `npm test` | 26 suite | 통과 집합이 base와 **같다** (지금 23/26, 환경 실패 3건은 blocker 아님) |
| A35 | `.mid`가 열린다 | `npm test` (`import.test.js`) | M10, M13 | `scoreFromFile`이 soft error를 던지지 않고 Score를 돌려준다 |
| A36 | 저장 왕복 | `npm test` | X1, M13 | 저장 → 읽기 후 Score가 같다. 그래프에 `scoregraph_version` 2 |
| A37 | import 실패가 앱을 죽이지 않는다 | `npm test` | 잘린 파일, X31 | 파일 하나만 실패하고 앱은 살아 있다. 오류 메시지에 `code`가 있다 |
| A38 | 옥타브 이중 이동 없음 | `npm test` | X10 + 편곡 | G01 F3 재현 fixture에서 울리는 음높이가 한 번만 이동 |

### 19.6 회귀 방지 (A39–A42)

| # | 테스트 | 명령 | fixture | 기대 |
| --- | --- | --- | --- | --- |
| A39 | importer mutation | `run.py mutation-check` | §16.3의 14종 | 전부 잡힌다. no-op은 바이트 동일 |
| A40 | allowlist가 사유 단위 | `run.py sg-roundtrip` | 기존 2건 | 같은 파일이 **다른** 차이를 얻으면 실패한다 (G1 F6) |
| A41 | 결정론 | `run.py sg-roundtrip` 2회 + 다른 CWD | 코퍼스 369 | 출력 바이트 동일 |
| A42 | G1 F1 불변 | `run.py sg-roundtrip` | czerny849/020 | tuplet bracket 묶음이 **G2 전후로 같다** (G3의 일이다) |

**총 42개.**

---

## 20. 구현 단계

과제 §18의 예시를 실제 저장소에 맞춰 고쳤다. 큰 변경은 **Step 1과 2 사이에 schema v2를 넣은 것** — 나중에 올리면 golden을 두 번 다시 찍어야 한다.

| Step | 하는 일 | 끝나는 조건 |
| --- | --- | --- |
| **0** | baseline 고정: 이 문서 부록 A의 측정을 스크립트로 커밋, 코퍼스 element 재고 기록 | A1이 base에서 통과 |
| **1** | `scoregraph/import.js` — container·encoding·format 판별, ImportReport 계약, 기존 importer 배선 | A18, A12(기존 fixture 범위) |
| **2** | **schema v2**: S1·S2·S4·S5·S6 + `MIGRATIONS[1]` + golden 재생성 | A3, A4, A2 |
| **3** | MusicXML 완성도 ①: 파일 전체 거절 3종 제거 (C1·C2·C3) | A7, A8, A9 |
| **4** | MusicXML 완성도 ②: 새로 담는 것 (C4·C5·C6) + ext 보존 (C7–C14) | A10, A11, A16, A12 |
| **5** | fixture X1–X32 + `run.py import-report` + L1++ / L3 | A12, A13, A14, A15, A17, A40 |
| **6** | **export 선형화** (§15.2) | A30 |
| **7** | `scoregraph/midi-file.js` — SMF → RawMidi (무손실) | A19–A23 |
| **8** | `scoregraph/midi-import.js` — performance 층 + skeleton | A24, A25, A27, A29 |
| **9** | MIDI writer(측정용) + `run.py midi-roundtrip` + fixture M1–M26 | A26, A31 |
| **10** | importer mutation 14종 | A39 |
| **11** | `toLegacyScore` + **M1 shadow** | A32, A33 |
| **12** | **M2 A/B** — `opts.graphImport` | A34, A28 |
| **13** | `.mid` 앱 경로 + 저장 형식 | A35, A36, A37, A38 |
| **14** | **M3 flip** — 기본을 새 경로로. `parseMusicXML`은 되돌리기 경로로 남긴다 | A34, A42, 전체 |

**왜 이 순서인가**

- schema를 Step 2에 올린다 — 뒤로 미루면 golden 17개와 `.sg.json` 52개를 두 번 다시 찍는다.
- export 선형화(6)가 MIDI(7–9)보다 앞에 온다 — MIDI fidelity suite가 export를 돌린다.
- 앱 migration(11–14)이 마지막이다 — 그 전에 importer가 코퍼스와 fixture에서 검증돼야 shadow 비교가 의미를 갖는다.
- Step 3–4는 **C 목록 순서가 아니라 피해 순서**다: 파일 전체 거절이 먼저다.

---

## 21. Out of Scope

G2에서 **하지 않는다**.

- tuplet bracket grouping (G1 F1) → **G3**
- 리듬 양자화·성부 분리·손 배정·철자 추론의 **새 알고리즘** → G3. §7.6은 이미 있는 것을 배선할 뿐이다
- 자동 임시표, beam 재계산, 기보 정리 → G3
- CURRENT_STATE 이슈 1–19 수정 → 각 Goal
- OMR·AMT 품질 개선
- 드럼 편곡 AI, 드럼 렌더링·재생 (§17은 표현과 왕복까지)
- 사용자 기능으로서의 **MIDI export** (측정용 writer만 만든다)
- Python ScoreGraph 라이브러리
- 미분음 표현, figured bass, TAB 입출력, layout·engraving 정보 (G1 §18 유지)
- D.C./D.S./Coda 전개, 점진 템포(ramp)
- 연주 take와 악보의 자동 정렬
- 렌더러·재생·연습의 그래프 전환 (S5, G4–G5)
- `buildXml`·`opts.legacyWriter` 제거 — G1 leftover이고 G2의 flip과 섞지 않는다

---

## 22. 사용자 결정이 필요한 사항

| # | 결정 | 선택지 | Architect 권고 |
| --- | --- | --- | --- |
| **D1** | schema v2 범위 | (a) S1·S2·S4·S5·S6 다섯 건 한 번에 (b) 기보 3건만, MIDI 2건은 다음 Goal | **(a)**. 버전을 두 번 올리는 비용이 더 크고, 지금은 마이그레이션할 사용자 데이터가 없다 |
| **D2** | 코퍼스 확장 | (a) 손으로 쓴 최소 fixture만 (§10) (b) 외부 공개 코퍼스(MuseScore/OpenScore 등)를 들여온다 | **(a)**. (b)는 라이선스·provenance 절차가 무겁고 G0 정책과 충돌할 수 있다. 필요하면 별도 세션 |
| **D3** | `.mid`의 기본 동작 | (a) 연주만 (기보 없음 — 악보가 안 보인다) (b) 기보까지 (`audio-score` 양자화기 경유, 추론 표시) | **(b)** + UI가 "리듬은 추정" 표시. 단 (a)도 `opts`로 열어 둔다 |
| **D4** | 앱의 octave-shift 해석 (이슈 3, 부록 B "결정 필요") | (a) 앱 동작을 그대로 재현한다 (parity 우선) (b) adapter에서 고친다 | **(a)**. G2는 경계 이동이지 동작 변경이 아니다. 고치는 것은 별도 Goal |
| **D5** | SMF format 2 | (a) 첫 sequence만 읽고 report에 남긴다 (b) 거절한다 | **(a)**. 실물이 드물고, 거절은 마지막 수단 |
| **D6** | full suite baseline (G1 F7에서 넘어온 것) | (a) `00081cc`에서 rebaseline (b) 그대로 둔다 | 결정 필요. G2의 blocker는 **아니다** — G2는 core/robust/smoke만 게이트로 쓴다 |

D1은 Step 2를 막으므로 **구현 시작 전에 답이 필요하다.** D2–D5는 각각 Step 5, 8, 11, 7 전까지면 된다. D6은 언제든.

---

## 23. 문서 hygiene

과제 §1이 요구한 대로, `docs/CURRENT_STATE.md`에서 **이미 지난 일을 아직 남은 일처럼 적은 문장**을 찾았다. 이 Architect 세션은 이것을 **기록만 하고 고치지 않는다** (무관한 대규모 문서 수정 금지).

| 위치 | 적혀 있는 것 | 사실 |
| --- | --- | --- |
| 3–5행 (머리말) | "at the end of the G1 implementation, on branch `g1-scoregraph` (worktree `D:/PPP-g1`)" | G1은 merge되어 닫혔다 (`00081cc`) |
| "Where things are" / Goals | G0 판정 "**READY_FOR_MERGE_CHECK**" | G0는 PR #1로 merge됐다 (`aff7080`) |
| / G1 | "Branch `g1-scoregraph` on `aff7080` … **PR #2 open, not merged**" | merge됨 (`aa77d2e`) |
| / G0 code | "pushed to `origin/g0-quality-foundation` (no PR yet). **Not merged to `main`.**" | PR #1은 `g0-quality-foundation-clean`에서 나왔고 merge됐다 |
| / `main` | "It is not pushed (`origin/main` is `e0d8b23`)" | `origin/main`은 `00081cc` |
| / ScoreGraph | 행 제목 "ScoreGraph (G1 branch)" | main에 있다 |
| / Tests | "`npm run test:scoregraph` (71 node tests)" | 72개 (G1 §26의 회귀 테스트 추가) |
| / CI | "Not yet run on GitHub." | PR #2·#3에서 gate가 돌았고 둘 다 통과했다 |
| "Next" 3번째 bullet | "The user decides: … merging `g0-quality-foundation` into `main` and opening the PR that turns on CI" | 둘 다 끝났다 |

**처리**: G2 구현의 **Step 0**에서 위 9곳을 한 번에 고친다 (문서 위생은 baseline 작업의 일부다). 지금 고치지 않는 이유는 이 세션이 설계 전용이고, 문서 수정이 설계 리뷰의 diff를 가리기 때문이다.

### 23.1 G1에서 넘어온 나머지 경계

| 항목 | G2에서의 취급 |
| --- | --- |
| **F1 tuplet bracket grouping** | **G3.** G2는 건드리지 않는다. A42가 불변임을 강제한다 |
| `npm test`의 기존 환경 실패 3건 (headless 10 FPS, layout 2건, transkun venv) | **G2 blocker 아니다.** base에서도 같게 실패한다 (G1 §26.4에서 확인). A34는 "통과 집합이 base와 같다"로만 잰다 |
| 재현되지 않은 courtesy-accidental flake (`test_ab_runs_a_fixture_suite_through_its_own_runner`) | **관찰 대상.** G2에서 억지로 고치지 않는다. 다시 나오면 기록한다. 원인 미상, 재현 0/3 |
| F4–F8 (G01 §25.3) | 도달 불가. G2에서 다루지 않는다. 단 **F8(캐시 identity)** 은 M3에서 자연히 사라진다 |
| `buildXml`·`opts.legacyWriter` 제거 | G1 leftover. **G2와 섞지 않는다** (§21) |
| full baseline 재고정 (F7) | D6 |

---

## 부록 A. 이 세션의 측정 기록

전부 `D:/PPP-g2` (`00081cc`)에서 실행했다. production 코드는 건드리지 않았다.

### A-1. 코퍼스 import 재고 (369개)

```
import 실패 0 · export 실패 0 · 재import 실패 0

importer가 버린 것:
   856  sound@dynamics          10  fermata  (전부 <barline> 안)
   354  dashes                   6  part-group
   130  encoder / supports / encoding-date   6  wavy-line
    48  source                   2  tied (소리 없는 tie)
                                 1  ending (stop without start)
                                 1  wedge (stop without start) / 1 wedge (unclosed)

W-IMPORT: UNPAIRED 3 · CHORD-SPLIT 1
validator: I-VOICE-GAP 502 · W-TIE-OPEN 146 · W-MEASURE-LENGTH 66 · I-NO-TEMPO 41
           W-GRACE-ORPHAN 22 · I-LIMB-UNSET 16 · W-DISPLAY-DURATION 15 · I-EXT 11
           I-JUMP-IGNORED 8 · W-SLUR-OPEN 4 · W-REPEAT-DANGLING 3 · …

코퍼스 구성: 서로 다른 element 이름 117개 · part 1개=368 파일, 2개=1 파일
             <staves> 2=354, 1=15 · <part>에 id 없는 파일 92개
0회 등장: unpitched, transpose, glissando, cue, figured-bass, measure-style,
          senza-misura, staff-details, defaults, credit, midi-instrument, …
```

### A-2. 성능과 크기

코퍼스 369개 합계: import 2,072 ms · serialize 444 ms · export 1,247 ms.
xml 25.9 MB → `.sg.json` 20.8 MB (gzip 1.8 MB). head당 212 B (gzip 19 B).
최대 파일 `sonatina/020.mxl` 1,776 head: import 37.8 ms.

합성 확장 (2 staff, 화음):

| head | import | validate | serialize | export | sg.json |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 34 ms | 7 | 4 | 11 | 0.12 MB |
| 4,000 | 84 ms | 24 | 11 | 52 | 0.50 MB |
| 16,000 | 344 ms | 79 | 45 | **467** | 2.01 MB |
| 36,000 | 737 ms | 168 | 102 | **2,120** | 4.55 MB |
| 72,000 | 1,770 ms | 344 | 216 | **8,142** | 9.13 MB |

import 20–25 µs/head로 선형. export만 O(n²) — 원인 `musicxml-export.js:279`.

### A-3. 외부 MusicXML 구조 probe (직접 만든 15개 최소 파일)

```
transposing instrument (Bb)   ok
unpitched percussion          REFUSED  IMPORT-UNSUPPORTED-UNPITCHED   ← 파일 전체
lyrics (syllabic/extend)      ok
glissando                     ok  dropped[glissando×2]
cue note                      ok
multiple-rest                 ok  dropped[measure-style×1]            ← 마디 수 손실
senza-misura                  REFUSED  IMPORT-UNSUPPORTED             ← 파일 전체
fermata on a barline          ok  dropped[fermata×1]
key <cancel>                  ok  dropped[cancel×1]
staff-details (4 lines)       ok  dropped[staff-details×1]
figured-bass                  ok  dropped[figured-bass×1]
arpeggiate (single note)      ok  dropped[arpeggiate (one note)×1]
microtone <alter>0.5          REFUSED  IMPORT-UNSUPPORTED             ← 파일 전체
divisions change mid-measure  ok
two parts                     ok  W-IMPORT-VOICE-SPLIT
```

### A-4. schema 한계 probe (builder 직접 호출)

```
performance only, no parts/measures   FAIL  E-SHAPE parts ≥ 1, timeline.measures ≥ 1
one empty measure + perf notes        OK    W-CLEF-MISSING, I-NO-KEY, I-NO-TEMPO
  + a bar anchor                      OK
PerfNote with ext{track, channel}     FAIL  E-SHAPE  'notes[0] has no field "ext"'
PerfPedal pedal:'expression'          FAIL  E-SHAPE  not one of damper, sostenuto, soft
```

→ S1, S2, S3의 근거.

### A-5. ext host probe

`EXT_HOSTS = ScoreGraph, Part, Event, Head, Measure, Spanner, Direction` (7개).

```
KeyEvent.ext   (key <cancel>)   FAIL  E-SHAPE  timeline.keys[0] has no field "ext"
TempoEvent.ext                  FAIL  E-SHAPE  timeline.tempos[0] has no field "ext"
Staff.ext      (staff-details)  FAIL  E-SHAPE  parts[0].staves[0] has no field "ext"
Staff.lines = 4 (진짜 필드)     OK          ← staff-lines는 schema가 아니라 importer의 구멍
Measure.ext                     OK  I-EXT
Direction.ext  (dashes)         OK  I-EXT
ScoreGraph.ext (part-group)     OK  I-EXT
```

→ S9·S10·S11의 근거. **ext는 만능이 아니다** — 어디에 붙일지가 설계다.

### A-6. ext는 이미 쓰이고 있다

`musicxml-import.js:1151`이 beam 수가 모자랄 때 `ext = {'musicxml.beam': {levels: n}}`를 남긴다.
코퍼스에서 **11개 파일 · 249건**, namespace는 `musicxml.beam` 하나. `I-EXT`가 이것을 보고한다.
G2의 EXT 정책은 이 규약(`musicxml.<무엇>`)을 잇는다.

---

*G2 Architect 세션, 2026-09-23. 이 문서는 설계다. 구현은 시작하지 않았고 production 코드는 한 줄도 바뀌지 않았다.*
