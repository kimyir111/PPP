# G1 — ScoreGraph: PPP의 정본(canonical) 악보 표현

| 항목 | 값 |
| --- | --- |
| 상태 | 설계 완료 (2026-09-22) · **구현 COMPLETE (2026-09-23): §24** · **독립 리뷰 READY_TO_PR (2026-09-23): §25** (BLOCKER 0, MAJOR 0, MINOR 5, OPTIONAL 3). |
| 작업 위치 | `D:/PPP-g1`, 브랜치 `g1-scoregraph`. `D:/PPP`는 건드리지 않는다. |
| 기준 커밋 | `aff7080` (G0: Quality Foundation, `origin/main` `e0d8b23` 위). `audio-score.js` content sha256(CRLF를 LF로 읽음) `78bd76e5…` |
| 기준 측정 | 이 세션이 `aff7080`에서 직접 실행했다. `run --suite core`: 553 cases, 0 errors. `check --suite core`: **PASS** (SQI 76.86). `golden`: **17/17 identical**. |
| 읽는 사람 | 이 문서만 읽고 G1을 구현할 다음 세션, 그리고 리뷰하는 사용자 |
| 한 줄 목표 | PPP의 모든 음악 기능이 올라설 **정본 악보 표현 ScoreGraph**를 만든다. 첫 production 경계는 녹음→악보 writer이며, 그 결과를 G0 benchmark가 음악적 차이 0으로 검증한다. |
| 비목표 | **악보 품질을 바꾸지 않는다.** 정리 알고리즘, voice 분리, 손 배정, 운지, 페달, engraving, 편곡, 전사, OMR은 모두 손대지 않는다 (§18). 발견한 결함은 기록만 한다 (§23). |

---

## 목차

- [0. 요약](#0-요약) · [0.1 용어](#01-용어)
- [1. Goal](#1-goal)
- [2. Current State](#2-current-state)
- [3. Problems](#3-problems)
- [4. Design Principles](#4-design-principles)
- [5. Schema](#5-schema)
- [6. Timing Model](#6-timing-model)
- [7. Event Model](#7-event-model)
- [8. Piano Model](#8-piano-model)
- [9. Instrument Extensibility](#9-instrument-extensibility)
- [10. SongGraph Boundary](#10-songgraph-boundary)
- [11. Provenance](#11-provenance)
- [12. IDs / Editing](#12-ids--editing)
- [13. Validation](#13-validation)
- [14. Serialization](#14-serialization)
- [15. Migration Strategy](#15-migration-strategy)
- [16. Test Strategy](#16-test-strategy)
- [17. Acceptance Criteria](#17-acceptance-criteria)
- [18. Out of Scope](#18-out-of-scope)
- [19. Risks](#19-risks)
- [20. Implementation Plan](#20-implementation-plan)
- [21. Architecture Decisions (tradeoff)](#21-architecture-decisions-tradeoff)
- [22. 사용자 결정이 필요한 사항](#22-사용자-결정이-필요한-사항)
- [23. 조사 중 발견한 이슈 (고치지 않음)](#23-조사-중-발견한-이슈-고치지-않음)
- [24. 구현 기록](#24-구현-기록-g1-implementer-2026-09-23)
- [25. 독립 리뷰](#25-독립-리뷰-independent-review-2026-09-23)
- [부록 A. MusicXML ↔ ScoreGraph 대응표](#부록-a-musicxml--scoregraph-대응표)
- [부록 B. Legacy Score adapter 계약 (G2 준비)](#부록-b-legacy-score-adapter-계약-g2-준비)
- [부록 C. 예시 (피아노, 드럼)](#부록-c-예시-피아노-드럼)

---

## 0. 요약

지금 PPP에는 정본 표현이 없다. 악보는 세 가지 모습으로 떠돈다.

1. 들은 음: 초 단위 `{on, off, midi, vel}`
2. MusicXML 문자열: 단계 사이의 인계물
3. 앱의 legacy `Score` JSON: quarter float 단위. 저장·공유되는 사실상의 진실인데 버전도 note ID도 없다.

연주 정보(onset, 세기)는 악보를 쓰는 순간 버려진다. 음을 가리키는 방법은 `(m, b, staff)`, 마디 번호, JS 객체 참조뿐이다 (§2).

**ScoreGraph**는 버전이 있는 plain JSON 데이터이며, 이를 다루는 의존성 없는 순수 함수 라이브러리(`scoregraph/`)와 함께 온다. 브라우저와 Node에서 같은 코드가 돈다.

핵심 결정:

1. **시간 세 층을 분리한다.**
   - 기보 시간: 마디 ID + 마디 안 위치, 온음표(whole note) 단위 **유리수** 문자열 (`"1/12"`)
   - 연주 시간: 정수 **µs**. 별도의 Performance 층에 있다.
   - 재생 시간: 반복을 펼친 순서. 저장하지 않고 **파생**한다.

   한 필드에 두 시간을 담지 않는다 (§6).
2. **정규화된 ID 테이블 위에 얇은 소유 계층을 둔다.** 마디 격자(timeline)는 모든 part가 공유한다. Part는 staves, voices, clefs, events, directions, spanners를 소유한다. 관계는 ID로 참조한다 (§5, §21 D1).
3. **Event/Head 2단 구조에 tagged union을 쓴다.**
   - Event는 한 voice 안의 리듬 슬롯이다: `note` | `perc` | `rest`.
   - Head는 소리 나는 단위다: 음높이 있는 음, 또는 타악기 타격.
   - 화음은 head가 여럿인 event다. 음높이가 없는 타악기도 처음부터 1급 시민이다 (§7, §9).
4. **음높이는 concert(실음) 철자로 저장한다.** 이조 악기의 written pitch, 옥타브 기호로 옮겨 그린 위치, MIDI 번호는 모두 파생한다 (§7.2).
5. **피아노의 손은 part가 아니라 `limb`(RH/LH/RF/LF)다.** 값은 head → voice → staff 순으로 상속한다. 한 Piano part 안에 staff, voice, 손 배정이 여럿 있을 수 있다 (§8).
6. **Provenance는 희소하게 둔다.** 출처(source) 테이블 하나에 상속되는 기본값을 두고, 다른 곳만 표시한다. confidence는 측면(aspect)별로, 불확실 구간은 span flag로 적는다 (§11).
7. **ID는 그래프 단위 단조 카운터에 종류 prefix를 붙인다** (`e12`, `h13`). 결정론적이고 재사용하지 않는다. 편집 op마다 보존·교체 규칙을 정했다 (§12).
8. **검증기는 손으로 쓴다.** 등급은 ERROR/WARNING/INFO이고 코드 목록이 고정되어 있다. production 경계에서 ERROR면 그래프를 내보내지 않는다 (§13).
9. **직렬화는 결정론적 canonical JSON이다.** 키는 schema 순서로 쓰고, 엔티티 하나를 한 줄에 쓴다. 유리수는 문자열로, 시간은 정수로 쓰며 float를 쓰지 않는다. `scoregraph_version`과 migration chain을 둔다 (§14).
10. **첫 production 경계는 `audio-score.js`의 `buildXml` 자리다.**
    - `toMusicXml()`이 ScoreGraph를 만들고, 그것을 MusicXML로 써서 돌려준다.
    - 녹음의 초 단위 음은 Performance 층에 남는다.
    - G0 benchmark는 그 MusicXML을 지금처럼 평가한다. G1은 **음악적 차이 0**을 증명해야 한다: golden semantic 동일, core·robust·smoke·replay 전 케이스 metric과 semantic digest 동일 (§15, §17).
11. **MusicXML import/export는 G1에 포함한다** (Node 전용 경로).
    - 저장소의 모든 MusicXML 369개로 `MusicXML → ScoreGraph → MusicXML` round-trip을 돌린다.
    - 판정은 G0의 앱-parity reader와 semantic projection으로 한다 (§16).
    - 앱의 import 경계(`parseMusicXML`) 교체는 G2다.

**산출물**

- `scoregraph/` 라이브러리
- `tests/scoregraph/`: JS 단위 테스트, fixture, golden
- bench에 추가: `sg-roundtrip` 명령, 다중 파일 SUT 식별
- `audio-score.js` writer 교체
- 앱 HTML의 script 태그 몇 줄
- CI 단계
- 문서

**완료 판정: §17의 A1–A46을 모두 통과해야 한다.**

### 0.1 용어

| 용어 | 뜻 |
| --- | --- |
| ScoreGraph (SG) | 이 문서가 정의하는 정본 악보 표현. 실제로 연주하고 기보할 수 있는 악보다. |
| SongGraph | 곡을 **이해**하기 위한 추상 분석(섹션 기능, 화성 분석, 모티프, 에너지, 역할). G7 이후. ScoreGraph를 ID로 참조만 한다 (§10). |
| W | 기보 시간 단위. **온음표 = 1**. 4분음표 `1/4`, 점4분 `3/8`, 셋잇단 8분 `1/12`. quarter 단위로 바꾸려면 ×4 한다. |
| Rat | 정규화된 유리수 문자열 `"n/d"` 또는 `"n"` (§6.1). |
| Pos | 기보 위치 `{m: MeasureId, at: Rat}`. `at`은 마디 시작부터의 W 거리다. |
| ScorePos | 첫 마디 시작부터 **적힌 순서로** 잰 W 거리. 반복은 펼치지 않는다. 파생 값이다. |
| Visit | 재생 순서에서 마디 하나를 한 번 지나가는 것. `(m, k)`로 식별한다: 마디 `m`을 `k`번째 연주하는 것. |
| PlaybackPos | `{m, k, at}`. 반복을 펼친 재생 위치. |
| µs | 연주 시간 단위. 정수 마이크로초. |
| Event | 한 voice 안에서 시간을 차지하는 리듬 단위. `note`, `perc`, `rest`. |
| Head | Event 안의 소리 단위. 음높이 있는 음(pitched head) 또는 타악기 타격(perc head). 건반 하나를 누르는 단위다. |
| Spanner | 둘 이상의 event·head를 잇거나 구간을 덮는 기호: tie, slur, tuplet, beam, wedge, pedal, ottava, arpeggio. |
| Direction | 한 위치에 붙는 기호: 셈여림, 문자, rehearsal mark, 코드 기호. |
| limb | 연주하는 사지: `RH`, `LH`, `RF`, `LF`. 피아노의 손, 드럼의 스틱·페달. |
| Legacy Score | 앱의 현재 `Score` 객체 (`measures[]`, `notes[]`, quarter float). |
| SUT | System under test. G1부터는 `audio-score.js`에 `scoregraph/*.js`를 더한 것이다. |
| Parity | 새 경로가 기존 경로와 **음악적으로 같은** 출력을 내는 것. G0 semantic projection과 모든 metric이 같다. |

---

## 1. Goal

**G1은 PPP의 정본 악보 표현 ScoreGraph를 설계대로 구현하고, 가장 작은 vertical slice로 production에 연결한다.** 이후의 품질 기능은 이 위에 올라간다: engraving(G4), playability(G5), 편곡 planner(G7), 드럼 편곡, AI 부분 재편곡, critic, repair.

G1이 끝나면 참이어야 하는 것:

1. ScoreGraph schema v1이 코드(shape table과 validator)로 존재하고, 이 문서의 §5–§14와 일치한다.
2. 기보 시간과 연주 시간이 다른 필드, 다른 단위, 다른 층에 있다. 셋잇단과 중첩 잇단음도 정확한 유리수로 표현된다.
3. 저장소의 MusicXML 369개가 `MusicXML → SG → MusicXML` 왕복에서 앱이 보는 음악(G0 semantic projection)과 G1 기보 목록(inventory)을 잃지 않는다.
4. 녹음→악보 경로(`toMusicXml`)가 ScoreGraph를 거쳐 MusicXML을 쓴다. 그 출력은 G1 이전과 음악적으로 같다. 들은 음의 초·세기는 그래프의 Performance 층에 남는다.
5. 드럼 part가 들어 있는 그래프를 schema가 검증·직렬화할 수 있다. 드럼 기능 자체는 만들지 않는다.
6. 이후 Goal이 쓸 편집 원자 연산(부분 교체, head 수정, event 삭제)이 ID 보존 규칙대로 동작한다.

---

## 2. Current State

이 절의 행 번호는 `aff7080` 기준이다. `Piano Coach App.dc.html`(이하 App)은 다른 세션이 편집하므로 **함수 이름으로 찾고 구현 전에 다시 읽는다.**

### 2.1 악보 데이터 흐름 (현재)

```
녹음 ─ transcribe.py / 브라우저 AMT ─► heard {notes[{on,off,midi,vel,confidence…}], pedals, beats, downbeats}  (초)
                                          │  Import.finishHeard (App 7090) · 리뷰 재작성 (App 14570, 14637, 14835)
                                          ▼
                     PPPAudioScore.toMusicXml()  (audio-score.js L1306)
                       clean → cluster → beats → quantize(24 tick/quarter) → metre/key/spelling → hands
                       → staffEvents(L979) → buildXml(L1023)  ─►  {xml, stats}
                                          │  (여기서 velocity·정확한 onset·confidence가 버려진다)
PDF/사진 ─ Audiveris/PDFtoMusic ─► MusicXML ─┤
MusicXML/MXL 업로드, 카탈로그, 교재 ─────────┤
                                          ▼
                     parseMusicXML()  (App 3888–4315, 브라우저 전용: DOMParser)
                                          ▼
                     Score.finalize()  (App 3524–3572, 제자리 변경)
                                          ▼
          legacy Score JSON  ── packScore → localStorage 'ppp.song.v1.<id>' / 공유 /api/shares (JSONB)
             │                   (MusicXML 원문은 저장하지 않는다. 이후의 진실은 Score JSON이다)
             ├─ PianoScore.build (App 2584–2856): 반복 전개, 템포 맵, 페달, 셈여림 → strikes(quarter)
             ├─ 스케줄러/MidiOut, 연습 엔진, follow, falling notes, 운지, 손 가이드, 코치, 학습
             ├─ VexFlow 렌더러 (App 10334–11600)
             └─ ScoreArranger / wireScore → /arrange-score → arrange_score.py
```

- **MIDI**: Standard MIDI File 코드는 서버 쪽 `midi_notes.py`뿐이다. 초 단위로 읽고 쓰며, `transcribe.py`와 `pm2s_quant.py`가 쓴다.
  - 앱은 `.mid` import를 거부한다 (App 4402–4404, 6062–6072).
  - MIDI export는 없다.
  - Web MIDI 입출력은 있다 (App 4425–4768).
  - 따라서 MIDI 파일은 들은 음 → `toMusicXml` → `parseMusicXML`을 거쳐, 결국 MusicXML을 지나간다.
- **MusicXML을 쓰는 곳**
  - `audio-score.js` `buildXml`
  - `PdfLayer.notate` (App 9813–9980, 브라우저 PDF 초안)
  - `Import.mergeMusicXml` / `mergeMeasuresWhereBetter` (App 6296, 6333, OMR 페이지 병합)
  - 빌드 시점 도구 `catalog/hymns/abc-to-musicxml.js`
  - 앱에서 MusicXML을 export하거나 다운로드하는 기능은 없다.

### 2.2 Legacy Score 모델 (코드가 실제로 설정하는 필드)

README "The music model"과 App 3353–3371의 주석은 실제보다 적은 필드만 적는다.

| 객체 | 필드 (단위) |
| --- | --- |
| Score | `id, title, composer, source, tempo`(정수, 기본 84), `staves`(전역 staff 수), `measures[], notes[]`, `chords{m,b,text}`, `pedals{m,b,type,kind,value}`, `ottavas{m,b,endM,endB,size,dir,semitones,staff}`, `marks{m,kind,text}`, `tempos{m,b,bpm}`, `dynamics{m,b,mark,vel}`, `wedges{m,b,type}`, `sections[{id,from,to,score,reason,hard}]`, finalize가 붙이는 `lengthQ, _byNumber` |
| Measure | `number`(parseInt, 아니면 순번), `lenQ`, `time{beats,beatType}`, `key{fifths,mode}`, `clefs{localStaff:kind}`, `clefChanges`, `w`, `bar{repeatStart,repeatEnd,style,endingNos,endingType,ending,endingEnd}`, finalize의 `index, startQ` |
| Note | `m`(인쇄 번호), `b`, `dur`(quarter), `p`('F#4'), `midi`, `staff`(전역), `voice`(part 안 번호), `rest, chord, tieStart/Stop, slurStart/Stop, type, dots, acc, hand('r'\|'l'\|'x'), finger`(첫 번째만), `tm{a,n}, tupletStart/Stop, stem, dx, arp, accent, marcato, dyn`, finalize의 `abs, writtenP, writtenMidi, ottavaShift, soundingMidi`. **`id`는 없다.** |

`parseMusicXML`이 버리거나 잘못 읽는 것:

- **버림**: grace(App 4171), 가사, beam, notehead, staccato/tenuto/fermata/장식음, `<print>`, credit, part-list 악기 정보, `<transpose>`
- **잘못 읽음**
  - `<cue/>`를 감지하지 않는다.
  - `alter`를 `parseInt`한다 (미분음 절삭).
  - `<tied>`를 읽지 않는다.
  - `<time>` "3+2"를 3으로 읽는다.
  - clef line을 무시한다.
  - `<key number>`를 무시한다.
  - octave-shift를 표준과 반대로 적용한다 (CURRENT_STATE 이슈 3).
- **마디 격자**: part 0만 마디 격자를 정한다 (App 4259–4263).
- **손 배정**: 파서에서 staff 번호로 한 번 정한다 (App 4287–4298).

### 2.3 `audio-score.js` 안의 표현

| 단계 | 표현 | 단위 |
| --- | --- | --- |
| `clean` (L42–52) | `{on, off, midi, vel}`. **`confidence, support, models`를 여기서 버린다** | 초 |
| `quantize` (L596–637), `quantizeCompound` (L653) | `{tick, endTick, err, tuplet, …}`. **연주 시간이 기보 시간이 되는 유일한 지점**이다. `Math.round(pos*24)` | tick (24/quarter) |
| `staffEvents` (L979–1021) | `{start, end, notes[], tuplet}`. staff마다 단선율 리듬 흐름 하나. 화음은 값 하나(낮은 쪽 중앙값) | tick |
| `buildXml` (L1023–1144) | 문자열 | divisions 24 |

- **`buildXml`이 쓰는 것**
  - `work-title`, part `P1` "Piano", 마디 1..N (implicit 없음)
  - 1마디 attributes: divisions 24, key (fifths, mode), time, staves 2, G2/F4 clef
  - 1마디 metronome + `<sound tempo>` (겹박자에서는 점4분 BPM을 그대로 씀, 이슈 1)
  - 음·쉼표 (`<rest measure="yes">` 포함), `<chord/>`, `<tie>`+`<tied>`
  - voice 1 (staff 1), voice 5 (staff 2), `<backup>`
  - `<time-modification>` 3:2와 `<tuplet>` 괄호
  - 마디·staff·음이름 단위로 추적한 `<accidental>`
  - staff 2의 `<pedal>` direction (`<offset>` 포함)
- **`buildXml`이 쓰지 않는 것**: beam, stem, 셈여림, 옥타브 기호, barline, 반복, 못갖춘마디, 두 번째 이후의 박자표·조표·템포, slur, 아티큘레이션, 운지, 꾸밈음.
- **형식 문제**: `<time-modification>`을 `<accidental>`보다 **앞에** 쓴다 (L1110). MusicXML XSD 순서에 어긋난다. 그래서 G1의 parity는 바이트가 아니라 **의미** 동일성으로 정의한다 (§15.3).
- **tick 격자의 한계**: 24 tick/quarter라서 64분음표(1.5 tick)를 표현하지 못한다. 셋잇단 외의 잇단음(5, 7)은 만들지 않는다 (`tupletOf`, L904–909).
- **`stats`**: `barStarts`와 `beats`(ms로 반올림), `tempo`, `key`, `beatsPerBar`, `beatType`, `perBar`, `gridError` 등.
- **남지 않는 것**: velocity, 정확한 onset·release, 음별 confidence는 XML에도 stats에도 남지 않는다.

### 2.4 소비자와 음 식별 방식

**음에 ID가 없다.** 모든 소비자가 위치나 객체로 음을 가리킨다.

| 소비자 | 읽는 것 | 음 식별 |
| --- | --- | --- |
| `PianoScore.build` (App 2584–2856) | `abs, dur, midi/soundingMidi, rest, tie*, hand, m, accent, marcato, dyn`; pedals, tempos, dynamics, wedges | note 객체 참조. tie는 `midi@abs.toFixed(3)` 문자열로 잇는다 |
| 스케줄러 / MidiOut (App 13566–13825) | `plan.strikes`, `plan.ccs`, `plan.beats` | strike index |
| 연습 엔진 (App 4809–5033) | strikes, `n.arp, m, b, staff`, sections | 필터된 목록의 index. 매칭은 midi와 시각으로 |
| Follow (App 13200–13410) | `abs, dur, rest, midi, hand, tieStop, m` | gate index (`abs.toFixed(5)`) |
| Falling notes (App 2981–3037) | strikes | `m:b:staff:voice:midi@q:i` |
| 암기 숨김 / 렌더러 sync (App 5594, 11419) | `m, b, staff, hand, chord` | `m\|b.toFixed(3)\|staff` |
| 운지 (App 8377–8590) | `rest, hand, midi, tieStop, abs, dur, finger` | note 객체를 키로 쓰는 `Map` |
| 학습·코치 (App 5081+, 7617+) | 마디 번호, sections, tempo, 첫 마디 key/time | 마디 번호 |
| 루프 범위 (App 13515) | `loopFrom/loopTo` | 마디 번호 |
| 녹음·비디오 동기 (App 14532, 16119) | `source.barStarts[measure.index]` | 마디 index |
| 렌더러 (App 10334–11600) | type, dots, tm, tie, slur, voice, staff, stem, acc, clef, key, time, bar/volta, chords, pedals, ottavas, marks | onsetKey. beam, 쉼표 위치, tuplet 끝은 그릴 때 스스로 정한다 |
| ScoreArranger (App 8793–9029) | `wireScore`: `{title, tempo, staves, measures, notes, sections}` | `m:b` 묶음 |

- **캐시**: `PianoScore`, 운지, falling notes가 **score 객체 identity로 캐시**한다 (App 2566, 16323, 16530). 객체를 제자리에서 바꾸면 캐시가 무효화되지 않는다 (§23 F8).
- **편집 UI**: 음, 손, 운지를 편집하는 UI가 없다.
- **제자리 변경**: 점수를 제자리에서 바꾸는 곳은 `PdfLayer.apply` (App 9986–10284)와 `Score.finalize`다.

### 2.5 저장과 버전

- **곡 데이터**: `localStorage['ppp.song.v1.'+id]`에 `packScore(score)`를 저장한다 (App 3480–3507).
- **공유**: `/api/shares`가 Score JSON 전체를 받는다 (`server.js` 506–537). `validScore`는 배열인지만 본다.
- **스키마 버전이 없다.** 있는 것은 키 접미사(`v1`, `v2`)와 `source.transcriptionVersion = 7` 정도다.
- **MusicXML 원문은 저장되지 않는다** (`Import.load`가 돌려주는 `musicxml`을 아무도 읽지 않는다).

### 2.6 G0 benchmark 계약 (G1이 지켜야 하는 것)

- **입력 경로**: `tests/bench/node/notate.js`가 `require(audio-score.js).toMusicXml(input, opts)`를 부르고 `{xml, stats}`만 쓴다.
- **reader**: `tests/bench/pppbench/musicxml.py`가 XML을 **앱 parity 규칙**(R1–R22, reader/4)으로 canonical score로 읽는다.
- **semantic projection** (`semantic.py`, `ppp.bench-semantic/3`)
  - structure: 마디, 번호, 반복, 재생 순서, staves, 손, clef, voice 배치
  - music: 박자표·조표, 템포, 음, 쉼표, 페달
- **golden** (17건)
  - 라벨은 `STRUCTURAL_CHANGE` / `SEMANTIC_CHANGE` / `SERIALIZATION_ONLY` / `ok`다.
  - G0 문서는 이미 "writer를 다시 쓸 때(G1)는 SERIALIZATION_ONLY만 형식 변화로 bless할 수 있다"고 정해 두었다.
- **ab**: `run.py ab --suite core --a git:<rev> --b worktree`는 케이스별 metric과 semantic digest 변화를 보고한다.
- **SUT 해석**: `runner.resolve_sut`는 `git:<rev>`에서 **`audio-score.js` 한 파일만** 꺼낸다 (`runner.py` 203–217). mutation-check도 그 한 파일만 복사한다. **G1에서 SUT가 여러 파일이 되면 이 부분을 반드시 고쳐야 한다** (§15.4, R2).

### 2.7 코퍼스 기능 조사 (커밋된 MusicXML 369개, 이 세션이 셈)

| 기능 | 파일 수 | 기능 | 파일 수 |
| --- | --- | --- | --- |
| `<backup>` | 354 | `<wedge>` | 49 |
| `<staves>2` | 354 | `<octave-shift>` | 32 |
| `<sound tempo>` | 328 | `<time>` 2번 이상 | 23 |
| `<metronome>` | 304 | `<time-modification>` | 20 |
| voice 번호 ≥3 | 232 | `<grace>` | 18 |
| `<accidental>` | 179 | `<ending>` | 17 |
| `<repeat>` | 169 | `<fermata>` | 17 |
| `<chord/>` | 162 | `<ornaments>` | 12 |
| `<words>` | 142 | tie start/stop 개수 불일치 | **11** |
| `<beam>` | 133 | `<harmony>` | 10 |
| `<print>` | 114 | `<pedal>` | 5 |
| `implicit="yes"` | 111 | `<arpeggiate>` | 2 |
| `<clef>` 3개 이상 (중간 clef 변경 가능성) | 96 | 여러 part | 1 (`samples/vocal-piano`) |
| `<stem>` | 94 | `<lyric>` | 1 |
| `<dynamics>` | 88 | `<transpose>`, `<unpitched>`, 교차 staff, segno/coda | **0** |
| `<articulations>` | 87 | `<type>` 없는 음이 있는 파일 | **59** (134음) |
| `<fingering>` | 83 | 화음 안 길이 불일치 | 0 |
| `<slur>` | 70 | 중복·비숫자 마디 번호 | 0 |

결론:

- G1 importer와 exporter는 반복, volta, 셈여림, 운지, slur, 셈여림 선, 옥타브 기호, grace를 **실제 코퍼스로** 왕복해야 한다.
- **합성 fixture가 필요한 것**: 교차 staff, 이조 악기, 조표 변경, 중첩 잇단음, 타악기. 코퍼스에 없다.
- **G0 reader 규칙이 걸리는 곳**
  - `<type>`이 없는 음이 59개 파일에 있다. G0 reader는 이것을 `None`으로 읽는다. 그래서 **exporter는 그래프에 없는 표시(type)를 지어내면 안 된다** (§14.3, §15.3).
  - tie 불일치 11개 파일 때문에 **한쪽 끝만 있는 tie**를 표현할 수 있어야 한다 (§5.10).

### 2.8 문서 상태

- 과제가 읽으라고 한 `CLAUDE.md`, `docs/PRODUCT_VISION.md`, `docs/ARCHITECTURE.md`, `docs/QUALITY_GATES.md`, `docs/DECISIONS.md`는 **이 브랜치에도, 다른 브랜치와 worktree(`D:/PPP`, `D:/PPP-g0`, `D:/PPP-g0-clean`)에도 없다** (`git log --all`로 확인).
- 이 세션은 `docs/ARCHITECTURE.md`와 `docs/DECISIONS.md`를 새로 만들었다. 둘 다 설계 내용만 담는다.

---

## 3. Problems

| # | 문제 | 근거 |
| --- | --- | --- |
| P1 | **정본 표현이 없다.** 단계 사이의 인계물은 MusicXML 문자열이고, 저장되는 진실은 버전 없는 legacy Score JSON이다. 같은 곡이 경로마다 다른 모습이 된다. | §2.1, §2.5 |
| P2 | **연주와 기보가 섞이거나 사라진다.** `toMusicXml`은 velocity, 정확한 onset, release, confidence를 버린다. Score에는 연주 층이 없다. 녹음과 악보의 동기는 `stats.barStarts` 하나(ms 반올림)에 기댄다. | audio-score.js L42–52, L1229–1249 |
| P3 | **시간이 float다.** quarter float, `toFixed(3)`·`toFixed(5)` 문자열 키, 1e-6·1e-9 epsilon이 곳곳에 있다. tick 격자는 64분음표와 5·7 잇단음을 표현하지 못한다. floor 불일치로 음이 한 박 밀리는 잠재 결함도 있다 (§23 F2). | audio-score.js L601 vs L503/L536; App 2616, 13200 |
| P4 | **음에 정체성이 없다.** 편집, critic 지적, 부분 재편곡, 연습 기록의 음 단위 추적이 불가능하다. | §2.4 |
| P5 | **음높이 의미가 뒤섞인다.** finalize가 `midi`와 `p`를 실음으로 **덮어쓴다**. octave-shift를 표준과 반대로 적용한다 (이슈 3, 30곡 2,229음). 편곡기에서 옥타브가 두 번 옮겨질 위험이 있다 (§23 F3). 이조 악기 개념이 없다. | App 3557–3564, 4054–4061 |
| P6 | **피아노에 구조적으로 묶여 있다.** 손을 staff 번호로 정한다. 2-staff part가 아니면 `x`(보이기만 하고 연주하지 않음)가 된다. `<unpitched>`는 `p:null`이 되어 버려진다. part가 여럿인 것은 사실상 지원하지 않는다 (이슈 11: OMR 결과의 오른손 소실). | App 4287–4298 |
| P7 | **인쇄된 것과 재생되는 것의 모순을 표현하지도 탐지하지도 못한다.** 6/8 `<sound tempo>` 단위(이슈 1), 템포 표기 모순(이슈 15), 길이와 모양이 다른 음표(이슈 19)가 그렇다. | CURRENT_STATE |
| P8 | **출처와 신뢰도가 없다.** 전사 confidence는 `clean()`에서 버려진다. `suspectMeasures`는 늘 비어 있다. | audio-score.js L47; App 7264–7326 |
| P9 | **구조 정보가 약하다.** sections는 8마디 단위로 잘라 위치로 만든 ID다. 반복은 part 0의 barline에서만 읽는다. D.S./D.C.는 따르지 않는다. | App 3623–3666, 3677–3722 |
| P10 | **저장 형식에 버전이 없다.** schema가 바뀌면 옮길(migration) 근거가 없다. | §2.5 |
| P11 | **편집은 제자리 변경뿐이다.** 객체 identity 캐시와 결합해 오래된 결과를 낼 위험이 있다. | App 2566, 9986–10284 |
| P12 | **여러 세션이 앱 파일과 `audio-score.js`를 동시에 편집한다.** 큰 교체는 충돌한다. | 사용자 메모리, CURRENT_STATE |

---

## 4. Design Principles

1. **DP1 — ScoreGraph가 진실이다.** MusicXML, legacy Score, 재생 계획, 렌더 모델은 모두 **projection**이다. projection에서 정본으로 돌아가는 길(import)은 명시적인 변환이며, 무엇을 버리는지 보고한다.
2. **DP2 — 연주 ≠ 기보.** 기보 시간(W 유리수)과 연주 시간(µs 정수)은 다른 필드, 다른 층에 있고 **링크**로만 연결된다. 재생 시간은 저장하지 않고 파생한다.
3. **DP3 — 정확한 산술.** 기보 쪽 계산에 float를 쓰지 않는다. 반올림은 µs로 바꿀 때 **한 곳, 한 규칙**(반올림 half-up)으로만 한다.
4. **DP4 — 악기 일반성.** 피아노를 먼저 설계하되 구조가 피아노에 종속되지 않는다. 음높이 없는 사건, 다른 limb, 이조, 다른 staff 종류가 schema에서 막히지 않는다.
5. **DP5 — 한 사실은 한 곳에.** 파생할 수 있는 값(MIDI 번호, written pitch, ScorePos, 재생 순서, 손 기본값)은 저장하지 않는다. 표시(display)처럼 파생할 수 없는 **사람의 선택**만 저장한다.
6. **DP6 — 충실함(faithfulness).** importer와 exporter는 음악적 결정을 하지 않는다. 결함 있는 입력(한쪽만 있는 tie, 모양과 길이가 다른 음표)도 표현할 수 있으면 **그대로 담고 WARNING으로 표시**한다. 고치는 일은 이후 Goal의 명시적 연산이다.
7. **DP7 — 결정론.** 같은 입력이면 같은 ID와 같은 바이트가 나온다. 시계, 난수, 해시 순서, 객체 키 삽입 순서에 기대지 않는다.
8. **DP8 — 불변 데이터와 순수 함수.** 그래프는 plain JSON 객체이며 생성 후 동결한다. 변경은 새 그래프를 돌려주는 연산으로만 한다.
9. **DP9 — 의존성 없음, 빌드 없음.** `audio-score.js`처럼 UMD JS 파일로, 브라우저와 Node에서 그대로 돈다. 새 npm·pip 의존성은 없다.
10. **DP10 — 경계에서 검증한다.** production 경계(builder, import, op)는 validator를 통과한 그래프만 내보낸다. ERROR면 거부하고, WARNING은 함께 돌려준다.
11. **DP11 — Strangler.** 기존 경로를 한 번에 바꾸지 않는다. 경계 하나씩, 이전 출력과 **음악적으로 같음을 측정으로 증명한 뒤** 바꾼다.
12. **DP12 — 분석과 표현을 섞지 않는다.** "곡이 무엇인가"(SongGraph)와 "무엇을 연주·기보하는가"(ScoreGraph)는 다른 문서다. ScoreGraph는 SongGraph를 모른다.

---

## 5. Schema

이 절은 schema v1의 **규범**이다. 구현은 `scoregraph/schema.js`의 shape table로 옮기고, validator(§13)가 그 table로 검사한다. 표기는 TypeScript 비슷한 문서용 표기다. 구현은 JS와 JSDoc이다 (§21 D5).

### 5.1 전체 구조와 소유 관계

```
ScoreGraph                                    (루트, 소유자)
├ scoregraph_version, id, rev, nextId
├ meta            Metadata
├ timeline        Timeline  ─ 모든 part가 공유하는 마디 격자
│  ├ measures[]   Measure (barline, 반복 기호, layout hint 포함)
│  ├ meters[]     MeterEvent        (마디 시작에만)
│  ├ keys[]       KeyEvent          (concert 조, 범위 지정 가능)
│  ├ tempos[]     TempoEvent        (재생 템포 qpm + 인쇄 표기)
│  ├ endings[]    Ending (volta)
│  └ jumps[]      Jump (segno/coda/D.C./D.S./Fine, G1은 전개하지 않음)
├ parts[]         Part  ─ 악기 단위 (피아노 한 대 = part 하나)
│  ├ instrument   Instrument (+ 이조, + 타악기 kit)
│  ├ staves[]     Staff (limb 기본값)
│  ├ voices[]     Voice (home staff, limb 기본값)
│  ├ clefs[]      Clef
│  ├ events[]     Event = NoteEvent | PercEvent | RestEvent
│  │                └ heads[]  PitchedHead | PercHead   (Event가 소유)
│  ├ directions[] Direction (dynamic, words, rehearsal, chord symbol)
│  └ spanners[]   Tie | Slur | Tuplet | Beam | Wedge | Pedal | Ottava | Arpeggio
├ structure       Structure (선택)
│  ├ sections[]   Section  (마디 범위)
│  └ phrases[]    Phrase   (Pos 범위, 편집 단위)
├ performances[]  Performance (선택) ─ 연주 시간 층
│  ├ notes[]      PerfNote (µs, vel, → head 링크)
│  ├ pedals[]     PerfPedal
│  └ anchors[]    Anchor (PlaybackPos ↔ µs)
├ provenance      Provenance
│  ├ sources[]    Source
│  ├ default      ProvRef
│  └ flags[]      Flag (불확실 구간)
└ ext             Ext (실험용 namespace)
```

- **소유 규칙.** 모든 엔티티는 정확히 하나의 컨테이너 배열에 들어 있다. Head는 Event 안에, 나머지는 위 트리의 배열에 있다.
- **참조 규칙.** 참조는 ID 문자열로만 한다. 객체를 중첩해 공유하지 않는다.
- **part 경계.** part 경계를 넘는 참조는 timeline 엔티티(`m`), `provenance`, `performances`의 `link`, SongGraph 쪽에서만 허용한다.

### 5.2 공통 타입

| 타입 | 형식 | 불변식 |
| --- | --- | --- |
| `Id<P>` | `^[a-z]{1,2}[1-9][0-9]*$`. 앞 글자는 종류 prefix (§12.1) | 그래프 전체에서 **숫자 부분이 유일**하고 `< nextId`다. prefix는 엔티티 종류와 맞아야 한다. |
| `Rat` | `^(0\|-?[1-9][0-9]*)(/[1-9][0-9]*)?$` | 기약분수이고, 분모 ≥ 2일 때만 `/`를 쓴다. \|분자\|와 분모는 2^31 − 1 이하. 단위는 문맥으로 정해진다 (기보 W, 템포 qpm). |
| `Pos` | `{m: Id<'m'>, at: Rat}` | `0 ≤ at < measure.dur`. 단 span의 끝(`to`)과 anchor는 `at ≤ measure.dur`까지 허용한다. |
| `Span` | `{from: Pos, to: Pos}` | ScorePos(from) < ScorePos(to). `to`는 포함하지 않는다(exclusive). |
| `Us` | 정수 ≥ 0 | 연주 시간(µs). |
| `Conf` | 수, 0–1, 소수 셋째 자리까지 | `Math.round(c*1000)/1000 === c` |
| `NoteType` | `maxima, long, breve, whole, half, quarter, eighth, 16th, 32nd, 64th, 128th, 256th, 512th, 1024th` | MusicXML `<type>` 어휘 |
| `Limb` | `RH, LH, RF, LF` | |
| `Step` | `A`–`G` | |
| `Ext` | `{[namespace]: JSON}` | namespace는 `^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$`. 값의 수는 정수이거나 소수 셋째 자리까지. |

**생략과 기본값**

- 선택 필드는 기본값과 같으면 **쓰지 않는다** (§14.2).
- `null`은 쓰지 않는다. 없음은 "필드 없음"으로 나타낸다.
- boolean도 기본값과 다를 때만 쓴다. 대부분 기본값이 `false`라서 `true`일 때만 나타난다. 기본값이 `true`인 것(`Tuplet.printed`, `show.bracket`, `Pedal.mark.sign`)은 `false`일 때만 쓴다.
- **위치(`m`, `at`)는 늘 필수이며 기본값이 없다.** event, direction, clef, key, tempo, jump 모두 같다.

### 5.3 ScoreGraph (루트)

| 필드 | 타입 | 필수 | 설명 / 불변식 |
| --- | --- | --- | --- |
| `scoregraph_version` | 정수 | ✓ | 현재 `1`. 모르는 값이면 E-VERSION. |
| `id` | 문자열 `^[A-Za-z0-9._:-]{1,64}$` | ✓ | score ID. 만드는 쪽이 준다 (라이브러리 곡 id 등). 내용과 무관하다. `toMusicXml`은 `opts.scoreId`, 없으면 `"sg-audio"`를 쓴다. |
| `rev` | 정수 ≥ 0 | ✓ | 편집 op마다 +1. build/import는 0. |
| `nextId` | 정수 ≥ 1 | ✓ | 다음에 할당할 ID 번호. |
| `meta` | Metadata | ✓ | 빈 객체도 된다. |
| `timeline` | Timeline | ✓ | |
| `parts` | Part[] (≥1) | ✓ | 배열 순서가 총보 순서다. |
| `structure` | Structure | | |
| `performances` | Performance[] | | |
| `provenance` | Provenance | ✓ | |
| `ext` | Ext | | |

**Metadata** (모두 선택, 문자열): `title, subtitle, composer, arranger, lyricist, copyright, workNumber, movementNumber, movementTitle`.

### 5.4 Timeline

| 필드 | 타입 | 필수 | 불변식 |
| --- | --- | --- | --- |
| `measures` | Measure[] (≥1) | ✓ | 배열 순서가 적힌 순서다. index는 파생한다. |
| `meters` | MeterEvent[] (≥1) | ✓ | 첫 마디에 하나가 반드시 있다. 한 마디에 하나까지. |
| `keys` | KeyEvent[] | | 비어 있으면 조표가 없다 (open key). |
| `tempos` | TempoEvent[] | | 비어 있으면 재생 템포는 소비자 기본값을 쓴다 (I-NO-TEMPO). |
| `endings` | Ending[] | | |
| `jumps` | Jump[] | | G1은 형태만 검증한다. 전개(unroll)는 무시하고 I-JUMP-IGNORED를 낸다. |

**Measure** — prefix `m`. 소유자는 timeline이다. 참조하는 쪽: Pos, Ending, Section, Anchor, MeterEvent.

| 필드 | 타입 | 필수 | 기본 | 설명 / 불변식 |
| --- | --- | --- | --- | --- |
| `id` | `Id<'m'>` | ✓ | | |
| `number` | 문자열 | ✓ | | **인쇄되는** 마디 번호 라벨 ("0", "12", "12a"). 식별자가 아니다. |
| `dur` | Rat > 0 | ✓ | | **실제 길이**(W). 박자표의 명목 길이(nominal)와 다를 수 있다 (못갖춘마디, 불규칙 마디). |
| `implicit` | bool | | false | MusicXML `implicit="yes"`: 번호를 세지 않는다 (못갖춘마디, 반으로 나뉜 마디). |
| `barline` | `{left?: Barline, right?: Barline}` | | | |
| `layout` | `{newSystem?: true, newPage?: true, width?: number}` | | | layout hint. 의미를 갖지 않는다. |
| `prov`, `ext` | | | | |

**Barline**: `{style?: 'regular'|'dotted'|'dashed'|'heavy'|'light-light'|'light-heavy'|'heavy-light'|'heavy-heavy'|'tick'|'short'|'none', repeat?: 'forward'|'backward', times?: int≥2}`.

- `forward`는 `left`에만, `backward`는 `right`에만 쓴다.
- `times`는 `backward`에만 쓰고 기본값은 2다.

**MeterEvent** — prefix `mt`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `m` | `Id<'m'>` | ✓ | 박자표는 **마디 시작에서만** 바뀐다. |
| `beats` | int[] (≥1, 각 ≥1) | ✓ | 분자. 가법 박자면 여러 개다: `3+2/8` → `[3,2]`. |
| `beatType` | int (1, 2, 4, …, 128) | ✓ | 2의 거듭제곱 |
| `symbol` | `'common'\|'cut'\|'single-number'\|'normal'` | | 표시 방식 |
| `groups` | Rat[] | | 명시한 박 묶음. 합은 nominal과 같아야 한다. 없으면 §6.4 규칙으로 파생한다. |
| `hidden` | bool | | 인쇄하지 않는 박자표 |

`nominal(meter) = sum(beats) / beatType` (W). 3/4 → `3/4`, 6/8 → `3/4`, 5/8 → `5/8`.

**KeyEvent** — prefix `ky`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `m`, `at` | Pos | ✓ | 마디 중간 변경도 허용한다. |
| `fifths` | int −7…7 | ✓ | **concert 조**. |
| `mode` | `'major'\|'minor'\|'ionian'\|'dorian'\|'phrygian'\|'lydian'\|'mixolydian'\|'aeolian'\|'locrian'\|'none'` | | **없으면 "명시되지 않음"**이다. `major`로 채우지 않는다 (fixture C06). |
| `scope` | `{part: Id<'p'>, staff?: Id<'st'>}` | | 없으면 모든 part에 적용한다. 있으면 그 part나 staff에만 적용한다. |
| `hidden` | bool | | |

이조 part에 인쇄되는 조는 concert 조에서 파생한다 (§7.2). 타악기 staff에는 조표를 적용하지 않는다.

**TempoEvent** — prefix `tp`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `m`, `at` | Pos | ✓ | |
| `qpm` | Rat > 0 | | **재생 템포**: 분당 4분음표 수. 박자와 무관하다. MusicXML `<sound tempo>`와 같은 의미다. |
| `mark` | `{unit?: NoteType, dots?: int, perMinute?: Rat, text?: string, parens?: true}` | | **인쇄 표기**. `unit`과 `perMinute`는 metronome 기호, `text`는 "Allegro"다. |
| `display` | `[{part: Id<'p'>, staff?: Id<'st'>, placement?: 'above'\|'below'}]` | | 어느 part와 staff에 인쇄하는가. 기본값은 `[{part: parts[0]}]`. import가 원문의 part별 중복을 그대로 기록한다 (§부록 A). |

- `qpm`과 `mark` 중 적어도 하나는 있어야 한다.
- 둘 다 있고 `mark`가 숫자 metronome이면 `qpm == perMinute × 4 × value(unit, dots)`여야 한다. 아니면 **W-TEMPO-MARK-MISMATCH**다 (CURRENT_STATE 이슈 1, 15를 자동 탐지한다).

**Ending (volta)** — prefix `en`: `{id, numbers: int[] (≥1, 오름차순, 중복 없음), text?: string, from: Id<'m'>, to: Id<'m'> (포함), open?: true}`. `open`은 끝 갈고리가 없다는 뜻이다 (MusicXML `discontinue`).

**Jump** — prefix `j`. G1은 schema, import, export만 한다: `{id, kind: 'segno'|'coda'|'fine'|'dacapo'|'dalsegno'|'tocoda', m, at, target?: Id<'j'>, text?: string, display?: [...]}`.

### 5.5 Part, Instrument, Staff, Voice, Clef

**Part** — prefix `p`. 소유자는 루트다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `id` | `Id<'p'>` | ✓ | |
| `name`, `abbr` | 문자열 | | 표시 이름 ("Piano", "Pno.") |
| `instrument` | Instrument | ✓ | |
| `staves` | Staff[] (≥1) | ✓ | 배열 순서가 staff 번호(1부터)다. |
| `voices` | Voice[] | ✓ | 배열 순서가 voice 순서다 (정렬과 export에 쓴다). |
| `clefs` | Clef[] | ✓ | 비어도 된다. 빠진 staff는 W-CLEF-MISSING이다. |
| `events` | Event[] | ✓ | |
| `directions` | Direction[] | ✓ | |
| `spanners` | Spanner[] | ✓ | |
| `prov`, `ext` | | | |

**Part는 악기 한 대다.** 오른손 part와 왼손 part로 나누지 않는다 (§8). 드럼 세트 전체도 part 하나다 (§9).

**Instrument** (Part에 포함, ID 없음)

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `kind` | 문자열 (등록된 어휘) | ✓ | `piano, drumset, electric-bass, acoustic-bass, acoustic-guitar, electric-guitar, voice, unknown, …`. 어휘와 `family`의 대응은 `schema.js`의 `INSTRUMENT_KINDS`에 둔다. 어휘를 넓히는 것은 버전을 올리는 변경이다. |
| `family` | `'keyboard'\|'percussion'\|'plucked'\|'bowed'\|'wind'\|'brass'\|'voice'\|'other'` | ✓ | |
| `name` | 문자열 | | |
| `midi` | `{program?: 1–128, channel?: 1–16, bank?: int}` | | 재생 힌트 |
| `transpose` | `{chromatic: int, diatonic: int, octave?: int}` | | written → sounding. MusicXML `<transpose>`와 같은 의미다. 없으면 C 악기다. |
| `range` | `{low: 0–127, high: 0–127}` | | 실음 MIDI 번호. playability 검사용이다 (G5). |
| `kit` | PercKit | 조건부 | `family == 'percussion'`이고 perc event가 있으면 필수다. |

**PercKit**: `{items: [{key: /^[a-z][a-z0-9-]*$/, name?: string, gm?: 27–87, pos: {step, oct}, notehead?: Notehead.shape, stem?: 'up'|'down'}]}`. `key`는 kit 안에서 유일하다.

**Staff** — prefix `st`: `{id, kind?: 'standard'|'percussion'|'tab' (기본 standard), lines?: int (기본 5), limb?: Limb}`. `limb`는 이 staff에 적힌 head의 **기본 limb**다 (피아노: 위 staff RH, 아래 staff LH).

**Voice** — prefix `v`: `{id, staff: Id<'st'> (home staff), label?: string (원문 voice 번호, export가 쓴다), limb?: Limb}`.

- voice는 **part 전체에 걸친** 선율 흐름이다. 마디마다 새로 만들지 않는다.
- voice에 역할(선율, 베이스)을 붙이지 않는다. 그것은 SongGraph의 분석이다 (§10).

**Clef** — prefix `c`: `{id, staff, m, at, sign: 'G'|'F'|'C'|'percussion'|'TAB'|'none', line?: int, octave?: int}`.

- `line` 기본값: G→2, F→4, C→3, TAB→5.
- `octave`는 `clef-octave-change`다. 예: 기타의 treble 8vb는 −1.

### 5.6 Event (tagged union)

모든 event의 공통 필드 — prefix `e`. 소유자는 Part다.

| 필드 | 타입 | 필수 | 설명 / 불변식 |
| --- | --- | --- | --- |
| `id` | `Id<'e'>` | ✓ | |
| `kind` | `'note'\|'perc'\|'rest'` | ✓ | union 구분자 |
| `m`, `at` | Pos | ✓ | 기보 onset. grace event는 주음과 같은 `at`을 쓴다. |
| `dur` | Rat ≥ 0 | ✓ | **기보 길이**(W). 잇단음 비율이 이미 곱해진 실제 길이다. 0은 grace에서만 허용한다. `at + dur ≤ measure.dur`: event는 barline을 넘지 않는다. 넘는 음은 tie로 이어진 조각이다. |
| `voice` | `Id<'v'>` | ✓ | 같은 part의 voice |
| `staff` | `Id<'st'>` | ✓ | 이 event가 적힌 staff. `voice.staff`와 다르면 교차 staff다. |
| `hidden` | bool | | 인쇄하지 않는 음·쉼표 (`print-object="no"`) |
| `display` | EventDisplay | | 인쇄된 음가 모양. **없으면 "지정 안 됨"**이다. exporter가 지어내지 않는다. |
| `grace` | `{order: int≥1, slash?: true}` | | 꾸밈음. `dur`는 `"0"`이다. `order`는 같은 주음 앞 꾸밈음의 순서다. |
| `fermata` | `{shape?: 'normal'\|'angled'\|'square', inverted?: true}` | | |
| `prov`, `ext` | | | |

**EventDisplay**: `{type?: NoteType, dots?: 1–4, stem?: 'up'|'down'|'none'|'double', size?: 'cue'|'grace'|'large', x?: number, measureRest?: true, pos?: {step, oct}}`.

- `x`는 `default-x` layout hint다.
- `measureRest`와 `pos`는 RestEvent에만 쓴다. 다른 kind에 있으면 E-SHAPE다.
- 불변식은 "`value(type, dots) × Π(tuplet normal/actual) == dur`"이다. 어기면 **WARNING** W-DISPLAY-DURATION이다 (이슈 19를 탐지한다). ERROR가 아닌 이유는 §13.3에 있다.

**NoteEvent** (`kind: 'note'`)

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `heads` | PitchedHead[] (≥1) | ✓ | 2개 이상이면 화음이다. 같은 철자의 음이 두 번 있으면 ERROR다. |
| `cue` | bool | | cue 음 (MusicXML `<cue/>`). 이 part가 연주하지 않는 작은 음이다. |
| `arts` | Articulation[] | | `staccato, staccatissimo, tenuto, accent, marcato, spiccato, stress, unstress, detached-legato, breath-mark, caesura`. 정렬하고 중복 없이 쓴다. |
| `orn` | `[{type: 'trill'\|'mordent'\|'inverted-mordent'\|'turn'\|'inverted-turn'\|'tremolo'\|'shake'\|'schleifer', marks?: int, acc?: string}]` | | 장식음 |
| `lyrics` | `[{verse?: int≥1 (기본 1), text: string, syllabic?: 'single'\|'begin'\|'middle'\|'end', extend?: true}]` | | |

**PercEvent** (`kind: 'perc'`): `heads: PercHead[] (≥1)`, `arts?`, `orn?` (tremolo, roll).

**RestEvent** (`kind: 'rest'`): heads가 없다. `display.measureRest?: true`(온마디 쉼표)를 쓸 수 있다. `display.pos?: {step, oct}`는 세로 위치다.

- **voice 규칙**: 같은 voice의 grace가 아닌 event들은 ScorePos 구간 `[at, at+dur)`가 **겹치지 않는다** (E-VOICE-OVERLAP).
- **빈 구간**: 비어 있는 시간(`<forward>`)은 event로 두지 않는다 (I-VOICE-GAP).

### 5.7 Head

**PitchedHead** — prefix `h`. 소유자는 NoteEvent다.

| 필드 | 타입 | 필수 | 기본 | 설명 |
| --- | --- | --- | --- | --- |
| `id` | `Id<'h'>` | ✓ | | |
| `pitch` | `{step: Step, alter?: int −3…3, oct: int 0…9}` | ✓ | alter 0 | **concert(실음) 철자 음높이** (§7.2) |
| `staff` | `Id<'st'>` | | event.staff | 교차 staff 화음에서 다른 staff에 적힌 음 |
| `acc` | `{type: 'sharp'\|'flat'\|'natural'\|'double-sharp'\|'flat-flat'\|'sharp-sharp'\|'natural-sharp'\|'natural-flat'\|'quarter-sharp'\|'quarter-flat', cautionary?: true, editorial?: true, paren?: true, bracket?: true}` | | 없음 | **인쇄된 임시표**. 없으면 인쇄하지 않는다 (앱도 `n.acc`만 그린다). 자동 계산은 G4의 연산이다. |
| `notehead` | `{shape?: 'normal'\|'x'\|'circle-x'\|'diamond'\|'triangle'\|'slash'\|'square'\|'cross', filled?: bool, paren?: true}` | | | |
| `fingering` | `[{f: string, subst?: true, alt?: true, placement?: 'above'\|'below'}]` | | | 인쇄된 운지. 순서대로 쓴다. 피아노에서 `f`는 "1"–"5"다. |
| `limb` | Limb | | 상속 | 명시적 손 배정 (§8.2) |
| `lead` | bool | | | voicing: 화음 안에서 드러낼 음 (§8.6) |
| `tech` | `{string?: int≥1, fret?: int≥0}` | | | 발현악기용 (G1은 schema만) |
| `prov`, `ext` | | | | |

**PercHead** — prefix `h`: `{id, inst: kit key (필수), pos?: {step, oct} (kit 기본값을 덮어씀), notehead?: …, limb?: Limb, stroke?: 'normal'|'rim'|'cross-stick'|'flam'|'drag'|'buzz'|'choke'|'ghost', prov?, ext?}`.

### 5.8 Direction

prefix `d`. 소유자는 Part다. 한 위치에 붙는 기호다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `id`, `kind` | `'dynamic'\|'words'\|'rehearsal'\|'chord'` | ✓ | |
| `m`, `at` | Pos | ✓ | |
| `staff` | `Id<'st'>` | | |
| `voice` | `Id<'v'>` | | |
| `event` | `Id<'e'>` | | 음의 `<notations>` 안에 붙은 기호 (예: 음에 붙은 `<dynamics>`). 위치는 그 event의 위치다. |
| `placement` | `'above'\|'below'` | | |
| dynamic | `value: 'pppppp'…'ffffff'\|'mp'\|'mf'\|'sf'\|'sfz'\|'sffz'\|'sfp'\|'sfpp'\|'fp'\|'fz'\|'rf'\|'rfz'\|'pf'\|'n'\|'other'`, `text?` (other일 때) | ✓ | |
| words | `text` | ✓ | "rit.", "dolce" |
| rehearsal | `text` | ✓ | "A" |
| chord | `root: {step, alter?}`, `kind: string` (MusicXML kind 어휘), `bass?: {step, alter?}`, `degrees?: [{value: int, alter: int, type: 'add'\|'alter'\|'subtract'}]`, `text?: string` | ✓ | **인쇄된 코드 기호**다. 화성 분석은 SongGraph의 일이다. |

### 5.9 Structure

| 엔티티 | prefix | 필드 | 불변식 |
| --- | --- | --- | --- |
| Section | `sc` | `{id, label?: string, from: Id<'m'>, to: Id<'m'> (포함), parent?: Id<'sc'>, prov?}` | from ≤ to (적힌 순서). 형제 section끼리 겹치지 않는다. |
| Phrase | `ph` | `{id, part?: Id<'p'>, voices?: Id<'v'>[], from: Pos, to: Pos, section?: Id<'sc'>, prov?}` | from < to |

ScoreGraph의 section과 phrase는 **이름 붙은 구간(where)**일 뿐이다. 의미(what: 기능, 에너지, 종지)는 SongGraph가 이 ID를 참조해 붙인다 (§10). 앱의 연습용 section(8마디 난이도 묶음)은 곡 기록(app state)에 두고 여기 넣지 않는다.

### 5.10 Spanner

prefix `s`. 소유자는 Part이며 `type`으로 구분한다.

| type | 필드 | 불변식 |
| --- | --- | --- |
| `tie` | `from?: Id<'h'>, to?: Id<'h'>` | 적어도 한쪽은 있다. 둘 다 있으면 **완전한 tie**다: 실음 MIDI 번호가 같고(E-TIE-PITCH), `to` event의 시작 ScorePos가 `from` event의 끝과 같다(E-TIE-TIME). head마다 나가는 tie와 들어오는 tie는 하나씩까지. 한쪽만 있으면 W-TIE-OPEN이다 (결함 입력을 충실히 담는다: 코퍼스 11개 파일, fixture C02·C13). |
| `slur` | `from?: Id<'e'>, to?: Id<'e'>, placement?, line?: 'solid'\|'dashed'\|'dotted'` | 한쪽만 있으면 W-SLUR-OPEN |
| `tuplet` | `events: Id<'e'>[] (≥1), actual: int≥1, normal: int≥1, unit?: {type: NoteType, dots?: int}, parent?: Id<'s'>, show?: {number?: 'actual'\|'both'\|'none', bracket?: bool, placement?}, printed?: bool (기본 true)` | 멤버는 같은 voice에서 시간 순서대로 **연속**한다 (grace 제외). parent 안에 연속된 부분으로 들어가고, 순환이 없다. 멤버 길이 합이 `normal × unit`과 다르면 W-TUPLET-INCOMPLETE. `printed: false`는 `<time-modification>`만 있고 `<tuplet>` 괄호 표기는 없다는 뜻이다. |
| `beam` | `events: Id<'e'>[] (≥2), breaks?: [{after: Id<'e'>, level: int≥1}]` | 같은 voice, 시간 순서. **engraving hint**다. |
| `wedge` | `kind: 'crescendo'\|'diminuendo', from: Pos, to: Pos, staff?, placement?, niente?: true` | Span 규칙 |
| `pedal` | `pedal: 'damper'\|'sostenuto'\|'soft', from: Pos, to?: Pos, changes?: Pos[], mark?: {line?: bool, sign?: bool}, text?: string, soundOnly?: true, depth?: 1–127` | `changes`는 (from, to) 안에서 오름차순. `to`가 없으면 W-PEDAL-OPEN. `soundOnly`는 인쇄 표시 없이 `<sound damper-pedal>`만 있다는 뜻이다. |
| `ottava` | `staff: Id<'st'>, shift: −3\|−2\|−1\|1\|2\|3, from: Pos, to: Pos` | **표시만** 옮긴다: 표시 옥타브 = written oct − shift. 8va는 shift +1, 8vb는 −1, 15ma는 +2. 같은 staff에서 겹치면 W-OTTAVA-OVERLAP (나중에 시작한 것이 이긴다). |
| `arpeggio` | `heads: Id<'h'>[] (≥2), dir?: 'up'\|'down', non?: true` | 모두 같은 onset(ScorePos). 여러 staff에 걸쳐도 된다. |

### 5.11 Performance (연주 층)

prefix `pf`. 소유자는 루트다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `id` | `Id<'pf'>` | ✓ | |
| `kind` | `'source'\|'take'\|'render'` | ✓ | source는 악보를 만든 원 녹음, take는 학생 연주, render는 합성 재생이다. |
| `src` | `Id<'sr'>` | | provenance source |
| `label` | 문자열 | | |
| `notes` | PerfNote[] | ✓ | |
| `pedals` | PerfPedal[] | | |
| `anchors` | Anchor[] | | 재생 위치 ↔ µs 대응점 |

- **PerfNote** — prefix `pn`: `{id, on: Us, off: Us (> on), vel: 1–127, midi?: 0–127, inst?: kit key, part?: Id<'p'>, link?: Id<'h'>, conf?: Conf}`.
  - 음높이 있는 음이면 `midi`, 타악기면 `inst`와 `part`가 필수다.
  - `link`가 가리키는 head는 이 연주 음이 **악보의 어느 음이 되었는가**를 뜻한다. 한 head를 여러 연주 음이 가리킬 수 있다 (중복 타건이 한 음으로 합쳐진 경우).
- **PerfPedal** — prefix `pp`: `{id, pedal: 'damper'|'sostenuto'|'soft', on: Us, off: Us, depth?: 1–127}`.
- **Anchor** (ID 없음): `{m: Id<'m'>, k: int≥1, at: Rat, us: Us, kind?: 'bar'|'beat'}`.
  - 뜻: "마디 `m`의 `k`번째 연주에서 위치 `at`이 µs `us`에 울렸다."
  - `(m, k)` 식별은 반복 구조가 조금 바뀌어도 index보다 덜 흔들린다.
  - 재생 순서 기준으로 `(visit, at)`과 `us`가 모두 순증가해야 한다 (E-PERF-ANCHOR).

**표현 안 하는 것**:

- 음별 expressive offset은 저장하지 않는다. `on − nominal(link)`로 파생한다 (§6.9).
- 악보 재생 velocity도 저장하지 않는다. 셈여림에서 파생한다.

### 5.12 Provenance

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `sources` | Source[] (≥1) | ✓ | |
| `default` | ProvRef (`src` 필수) | ✓ | 모든 엔티티의 최종 기본값 |
| `flags` | Flag[] | | 불확실하거나 의심스러운 구간 |

- **Source** — prefix `sr`: `{id, kind: 'musicxml'|'mxl'|'omr'|'amt'|'audio-score'|'midi-file'|'midi-input'|'user'|'generator'|'repair'|'legacy-score', tool?: string, version?: string, input?: {name?: string, sha256?: string}, params?: JSON, time?: string (ISO 8601), note?: string}`.
- **ProvRef** (엔티티의 `prov`, ID 없음): `{src?: Id<'sr'>, op?: 'imported'|'inferred'|'generated'|'repaired'|'edited', conf?: Conf, asp?: {[aspect]: {src?, op?, conf?}}}`.
  - aspect 목록: `exists, pitch, spelling, rhythm, voice, staff, limb, fingering, display`.
- **Flag** — prefix `fl`: `{id, kind: 'uncertain'|'suspect'|'review'|'conflict', span?: {part?: Id<'p'>, from: Pos, to: Pos}, ids?: Id[], conf?: Conf, src?: Id<'sr'>, code?: string, note?: string}`.

상속과 해석 규칙은 §11에 있다.

### 5.13 Ext

- `ext`는 루트, part, event, head, measure, spanner, direction에 둘 수 있다.
- **이 목록 밖의 필드는 어디서나 E-SHAPE다.** 실험 필드는 반드시 `ext.<namespace>`에 둔다.
- validator는 `ext` 안을 JSON 형식과 수 규칙으로만 검사한다.
- namespace는 이 문서나 `scoregraph/README.md`에 등록한다.

### 5.14 엔티티 요약

| 엔티티 | prefix | 소유자 | 참조하는 쪽 |
| --- | --- | --- | --- |
| Measure | `m` | timeline.measures | Pos, Ending, Section, Anchor, MeterEvent |
| MeterEvent | `mt` | timeline.meters | – |
| KeyEvent | `ky` | timeline.keys | – |
| TempoEvent | `tp` | timeline.tempos | – |
| Ending | `en` | timeline.endings | – |
| Jump | `j` | timeline.jumps | Jump.target |
| Part | `p` | parts | KeyEvent.scope, TempoEvent.display, Phrase, Flag, PerfNote |
| Staff | `st` | part.staves | Event, Head, Voice, Clef, Direction, Wedge, Ottava, KeyEvent.scope |
| Voice | `v` | part.voices | Event, Direction, Phrase |
| Clef | `c` | part.clefs | – |
| Event | `e` | part.events | Slur, Tuplet, Beam, Direction.event |
| Head | `h` | event.heads | Tie, Arpeggio, PerfNote.link |
| Direction | `d` | part.directions | – |
| Spanner | `s` | part.spanners | Tuplet.parent |
| Section | `sc` | structure.sections | Section.parent, Phrase.section |
| Phrase | `ph` | structure.phrases | – |
| Performance | `pf` | performances | – |
| PerfNote | `pn` | performance.notes | – |
| PerfPedal | `pp` | performance.pedals | – |
| Source | `sr` | provenance.sources | ProvRef, Performance.src, Flag.src |
| Flag | `fl` | provenance.flags | – |

`schema.js`는 이 표와 같은 `ENTITY_KINDS`를 내보낸다 (A4).

전체 예시는 [부록 C](#부록-c-예시-피아노-드럼)에 있다.

---

## 6. Timing Model

### 6.1 단위와 유리수

- **기보 시간 단위는 W(온음표 = 1)다.** 음가가 분수 그대로 읽히고(`1/4`, `3/8`, `1/12`), 3/4 마디의 길이가 `3/4`다.
  - quarter 단위(앱, G0 `Fraction`)와는 경계에서 ×4, ÷4로 바꾼다.
  - quarter를 택하지 않은 이유는 §21 D2에 있다.
- **Rat 구현**
  - 메모리에서는 `{n, d}` 쌍(JS Number, 정수)을 쓰고 연산마다 gcd로 정규화한다.
  - 중간값이 `Number.MAX_SAFE_INTEGER`를 넘으면 `RationalOverflow`를 던진다.
  - 저장 범위는 \|n\|, d ≤ 2^31 − 1이다. 실제 악보의 분모는 2^k·3·5·7의 작은 곱이므로 걸리지 않는다.
  - µs 변환만 BigInt로 한다 (§6.10).
- **문자열 형식**
  - `"3/8"`, `"0"`, `"5"`, `"-1/4"`. 음수는 차이값에만 쓴다.
  - Python `fractions.Fraction("3/8")`이 그대로 읽는다 (A14).
- **템포**: `qpm`은 Rat(분당 4분음표)다. `"181/2"`는 90.5다. 그래서 기보에서 초로 가는 변환이 **정확한 유리수**다.

### 6.2 좌표계

| 좌표 | 형식 | 저장 | 뜻 |
| --- | --- | --- | --- |
| **A. 기보 위치 (Notated)** | `Pos {m, at}` | ✓ (event, direction, clef, …) | 적힌 마디 안의 위치. 마디 ID에 상대적이라서 앞에 마디를 넣거나 빼도 이 마디의 값은 바뀌지 않는다. |
| 기보 절대 위치 (ScorePos) | Rat (W) | 파생 | 적힌 순서로 잰 거리. `measureStart(m) + at`. |
| 박 위치 (Metric) | `{beat: int, offset: Rat}` | 파생 | 박자표의 박 묶음(§6.4)으로 본 위치. |
| **B. 연주 시간 (Performance)** | Us | ✓ (performance 층) | 실제로 연주된 시각. onset은 `on`, release는 `off`, 세기는 `vel`. |
| **C. 재생 위치 (Playback)** | `PlaybackPos {m, k, at}` / PlaybackW (Rat) | 파생 | 반복과 volta를 펼친 순서의 위치. |
| 재생 초 (Playback seconds) | Rat 초 → Us | 파생 | 템포 맵으로 C를 초로 바꾼 값. 연주가 아니라 **악보대로 재생한** 시각이다. |

**금지.** 한 필드가 두 좌표계의 값을 가질 수 없다. 예:

- event의 `at`은 기보 위치다. 초가 아니다.
- PerfNote의 `on`은 µs다. 악보 위치가 아니다.
- 연주 1.037 s → 1.482 s가 "2마디 1박 8분음표"로 기보되면 이렇게 나뉜다.
  - event: `{m: "m2", at: "0", dur: "1/8"}`
  - PerfNote: `{on: 1037000, off: 1482000, link: <head>}`

### 6.3 마디 길이, 못갖춘마디, 불규칙 마디

- `measure.dur`가 실제 길이다. `nominal(meterAt(m))`과 같은 것이 정상이다.
- `dur ≠ nominal`은 아래 경우에만 WARNING 없이 허용한다. 그 밖에는 W-MEASURE-LENGTH다.
  1. `implicit: true`인 마디 (못갖춘마디, 번호를 세지 않는 분할 마디)
  2. 첫 마디가 짧을 때, 마지막 마디와 더해 nominal이 되는 경우 (못갖춘마디의 보충)
  3. 반복 barline이나 ending 경계에서 이웃 마디와 더해 nominal이 되는 경우 (반으로 나뉜 마디)
- **import 규칙** (앱 R8과 같은 결과)
  - implicit이고 내용이 있으면 `dur = 내용 길이`
  - 그 밖에는 `dur = max(nominal, 내용 길이)`
  - 넘치는 마디는 늘어나고 W-MEASURE-LENGTH를 받는다 (카탈로그 이슈 14).
  - 모자란 마디는 nominal로 두고 뒤를 빈 구간(I-VOICE-GAP)으로 둔다.
  - "내용 길이"는 모든 part의 커서 최대값이다 (`<forward>` 포함).

### 6.4 박자와 박

`groups(meter)`는 박 하나하나의 W 길이 목록이다. `meter.groups`가 있으면 그것을 쓰고, 없으면 다음 규칙으로 파생한다.

| 조건 | 박 묶음 | 예 |
| --- | --- | --- |
| `beats`가 여러 개 (가법 박자) | 각 원소 / beatType | 3+2/8 → [3/8, 2/8] |
| 분자 n이 3의 배수이고 n > 3 (겹박자) | n/3개의 `3/beatType` | 6/8 → [3/8, 3/8] · 9/8 → 3×3/8 · 12/8 → 4×3/8 · 6/4 → [3/4, 3/4] |
| 그 밖 (홑박자) | n개의 `1/beatType` | 3/4 → 3×1/4 · 2/2 → 2×1/2 · 3/8 → 3×1/8 |

- **metric 위치**: `metric(pos)`는 마디 안 위치를 박 묶음에 대어 `{beat, offset}`을 준다.
  - 첫 마디가 `dur < nominal`이면(못갖춘마디) **마디선에서 거꾸로** 센다: `metricAt = at + (nominal − dur)`. 앱의 `PianoScore.beats`(App 2659)와 같은 규칙이다.
  - nominal보다 긴 마디는 마지막 묶음 크기로 박을 이어 붙인다.
- **앱과 다른 점**: 앱은 `beatType ≥ 8 && beats % 3 === 0`만 겹박자로 본다. 그래서 6/4는 홑박자 6박이다.
  - SG 기본 규칙은 표준대로 6/4를 겹2박으로 본다.
  - G1에서는 박 위치를 쓰는 production 소비자가 없으므로 영향이 없다.
  - 소비자를 옮기는 Goal(G2 이후)이 parity를 원하면 `groups`를 명시해 맞춘다 (§22 U3).

### 6.5 잇단음

- **값**: event의 `dur`는 잇단음 비율이 이미 곱해진 **실제 길이**다.
  - 셋잇단 8분 = 1/8 × 2/3 = `1/12`
  - 5:4 16분 = 1/16 × 4/5 = `1/20`
  - 5:4 안에 들어간 3:2 32분 = 1/32 × 2/3 × 4/5 = `1/60`
- **구조**: Tuplet spanner가 멤버, 비율, 중첩(`parent`)을 가진다.
  - 표시 비율 사슬은 event에서 가장 안쪽 tuplet부터 `parent`를 따라 올라가며 얻는다.
  - `Π(normal/actual)`이 그 곱이다.
- **완결성**: 멤버 길이의 합 = `normal × value(unit)`, 곱해진 비율 기준이다. `unit`이 없으면 첫 멤버의 표시 음가를 쓴다.
  - 셋잇단 8분 세 개는 1/12 × 3 = 1/4 = 2 × 1/8이다.
  - 모자라면 W-TUPLET-INCOMPLETE다. `buildXml`은 음 하나에 괄호를 하나씩 쓰므로 이 경고가 정상적으로 난다.
- **MusicXML**: import는 `<time-modification>`의 멤버십과 `<tuplet>` 괄호를 모두 보존한다. export는 비율 사슬로 `<time-modification>`을 쓴다 (부록 A).

### 6.6 템포

- `TempoEvent.qpm`은 적힌 위치 **이후** 재생 템포다. 다음 TempoEvent(qpm 있는 것)까지 유지된다.
- 마디 중간 변경도 허용한다.
- 점진적 변화(accel./rit.)는 G1에서 words direction으로만 남는다. `ramp` 필드는 예약 항목이다 (`ext`로 실험).
- 첫 TempoEvent 전의 템포와 TempoEvent가 없을 때의 템포는 **호출자가 준다** (`defaultQpm`, 필수 인자). 숨은 기본값은 없다. 앱은 84를 쓰고, 각 소비자가 정한다.
- 반복을 지나 돌아갈 때는 **재생 순서에서 마지막으로 지나간** 템포가 유지된다. 돌아간 마디에 TempoEvent가 있으면 그것이 다시 적용된다.

### 6.7 재생 순서 (unroll)

`time.unroll(graph) → Visit[]`, `Visit = {m, k, pass, start: Rat (PlaybackW)}`.

- **G1 규칙**은 앱 `Score.form`(App 3679–3722)과 **같은 규칙**이다. 즉 G0이 파이썬으로 옮긴 `canonical.app_play_order`다.
  - `repeat forward`를 스택에 쌓는다.
  - `repeat backward`는 `times`(기본 2)만큼 가장 최근의 열린 forward로 돌아간다. 그런 것이 없으면 첫 마디로 돌아간다.
  - 안쪽 반복은 다시 시작한다.
  - ending은 현재 pass 번호가 `numbers`에 없으면 건너뛴다. `to`까지 건너뛴다.
- **한 가지 차이.** SG는 마디를 **ID**로 식별한다. 앱은 번호로 식별해서 번호가 같은 마디를 겹친다. 저장소에는 중복 번호 파일이 0개라서 결과가 같다 (A17).
- `Jump`(D.C./D.S./Fine/Coda)는 G1에서 전개하지 않는다 (I-JUMP-IGNORED). 앱과 같다.
- **tie와 반복.** tie는 적힌 순서로 정의된다. 재생 중 다음 visit이 tie의 목적 마디가 아니면(두 번째 ending으로 건너뜀), 음은 적힌 끝에서 놓는다. 두 번째 ending 쪽으로 잇는 tie가 필요하면 그 음에 따로 적는다 (MusicXML 관행).
- **가드**: 전개 길이는 마디 수 × 64를 넘으면 멈추고 E-UNROLL-RUNAWAY를 낸다 (앱의 8000 step guard에 해당).

### 6.8 변환 함수

모든 함수는 `scoregraph/time.js`에 있는 순수 함수다.

| 함수 | 입력 → 출력 | 비고 |
| --- | --- | --- |
| `measureStart(g, m)` | → Rat (ScorePos) | 누적합. 한 번 계산해 index에 캐시한다. |
| `scorePos(g, pos)` / `posAt(g, w)` | Pos ↔ Rat | 마디 경계는 다음 마디 0으로 간다. 마지막 마디의 끝은 `{m: last, at: dur}`다. |
| `meterAt(g, m)`, `keyAt(g, pos, part, staff)`, `clefAt(g, part, staff, pos)` | 효력 중인 값 | 범위 규칙: staff 지정 > part 지정 > 전체 |
| `metric(g, pos)` | → `{beat, offset}` | §6.4 |
| `unroll(g)` | → Visit[] | §6.7 |
| `playback(g, pos)` | → PlaybackPos[] | 적힌 위치 하나가 여러 번 연주된다. |
| `tempoMap(g, {defaultQpm})` | → `[{start: Rat(PlaybackW), qpm: Rat}]` | |
| `seconds(g, playbackW, {defaultQpm})` | → Rat (초) | `Σ Δw × 4 × 60 / qpm` (정확한 값) |
| `micros(rat초)` | → Us | §6.10 |
| `perfTimeMap(g, performanceId)` | → `{toUs(PlaybackPos), fromUs(Us) → PlaybackPos}` | §6.9 |
| `resolveSpan(g, span)` / `spanOf(g, ids)` | 구간 ↔ event 목록 | §10 |

**예 (A15 fixture의 일부).**

- 4/4, qpm 60으로 시작하고, 2마디 `at = 1/2`(셋째 박)에서 qpm 90이 된다.
- 2마디 `at = 3/4`의 재생 초:
  - 1마디 4 quarter @60 = 4 s
  - 2마디 앞 2 quarter @60 = 2 s
  - 다음 1 quarter @90 = 2/3 s
  - 합계 = **20/3 s**. µs로는 6666666.67을 반올림한 **6,666,667**이다.

### 6.9 연주 시간 (Performance)

- **연주 음은 µs 정수로 저장한다.** 입력의 초는 경계에서 한 번 바꾼다: `on_us = roundHalfUp(sec × 1e6)`.
  - JS float 초 → 10진 문자열 → 유리수로 바꾼 뒤 반올림한다. 부동소수 곱셈 오차를 피하기 위해서다.
- **anchor 시간 맵** (`perfTimeMap`)
  - anchor를 재생 순서로 정렬하고, PlaybackW와 µs 사이를 **구간 선형 보간**한다.
  - 첫 anchor 앞과 마지막 anchor 뒤는 인접 구간의 기울기로 외삽한다.
  - anchor가 하나뿐이면 템포 맵의 기울기를 쓴다.
  - anchor가 없으면 템포 맵만으로 계산하고, 시작 µs는 0이다.
- **expressive offset** = `perfNote.on − perfTimeMap.toUs(link된 head의 첫 PlaybackPos)`. 파생값이며 저장하지 않는다.
- **녹음 동기 (앱 `source.barStarts`)**: 녹음과 악보의 동기는 `source` performance의 `bar` anchor가 맡는다. G2 이후 앱이 이것으로 `barStarts`를 대신할 수 있다.

### 6.10 반올림 규칙

반올림은 기보 → 초 → µs 변환의 마지막 한 곳에서만 한다.

```
roundHalfUp(n/d) = floor((2n + d) / (2d))     # n ≥ 0, BigInt 산술
```

- 음수 시간은 없다.
- 이 밖의 어떤 기보 계산도 반올림하지 않는다.
- 비교는 모두 유리수의 정확한 비교다. epsilon을 쓰지 않는다.

---

## 7. Event Model

### 7.1 왜 Event와 Head 두 단인가

- **Event**는 리듬(한 voice의 한 시간 칸)을 담는다.
  - 길이, 표시 음가, 잇단음 멤버십, 빔, 슬러, 아티큘레이션, 꾸밈음 여부, 가사
- **Head**는 소리(건반 하나, 북 하나)를 담는다.
  - 음높이, 철자, 임시표, tie, 운지, 손, 연주 음 링크
- 한 Note에 모든 것을 넣지 않는다. 화음 음마다 음가·잇단음·슬러를 **중복해서** 적는 MusicXML 방식(`<chord/>`)은 불변식("화음 음은 길이가 같다")을 검사해야 하는 부담을 만든다.
- 반대로 head를 두지 않으면 tie, 운지, 연주 링크를 붙일 곳이 없다.
- **판단**: tie와 운지는 head에, 슬러와 잇단음은 event에 둔다.

### 7.2 음높이 모델

| 층 | 저장 | 계산 |
| --- | --- | --- |
| **concert 철자 음높이** (실음, 철자 포함) | `head.pitch {step, alter, oct}` | – |
| 실음 MIDI | 파생 | `12 × (oct + 1) + pc(step) + alter`. pc: C0 D2 E4 F5 G7 A9 B11 |
| written 철자 음높이 (이조 악기 악보) | 파생 | concert를 `instrument.transpose`만큼 **거꾸로** 음정 이조한다: diatonic `−(diatonic + 7·octave)`, chromatic `−(chromatic + 12·octave)` |
| 표시 옥타브 (8va 구간) | 파생 | written.oct − ottava.shift (그 staff, `[from, to)` 구간) |
| 인쇄 임시표 | `head.acc` | – |
| MusicXML `<pitch>` | = written 철자 | import는 written → concert, export는 concert → written으로 바꾼다. octave-shift는 `<pitch>`를 바꾸지 않는다 (표준, fixture C10·C11). |
| 이조 part의 인쇄 조표 | 파생 | written fifths = concert fifths − (7·c − 12·d) (c, d는 transpose의 chromatic과 diatonic, octave 포함). 결과가 −7…7 밖이면 ±12 해서 이명동음 조를 쓴다 |

- **철자.** `C#`과 `Db`는 step과 alter가 다르고 MIDI가 같다. 철자는 저장된 사실이다. 추론(G3)의 결과가 여기에 들어간다.
- **미분음.** 예약 항목이다. `alter`는 정수만 허용한다. 필요하면 `ext.microtone`에 cents를 두고, schema v2에서 승격한다.
- **legacy와의 관계.** 앱의 `p`, `midi`, `writtenP`, `writtenMidi`, `soundingMidi`는 모두 이 표에서 파생된다. 앱의 octave-shift 해석(이슈 3)은 legacy adapter(G2)가 재현할지 고칠지 정할 문제다 (부록 B).

### 7.3 기보 길이와 연주 길이

| 개념 | 위치 | 단위 |
| --- | --- | --- |
| 기보 onset | `event.m`, `event.at` | Pos (W) |
| 기보 길이 (NotatedDuration) | `event.dur` + `event.display` + Tuplet | Rat (W) + 모양 |
| 연주 onset | `perfNote.on` | µs |
| 연주 길이 (PerformedDuration) | `perfNote.off − perfNote.on` | µs |
| 세기 (velocity) | `perfNote.vel`. 악보 재생 세기는 셈여림에서 파생한다 | 1–127 |
| expressive offset | 파생 (§6.9) | µs |

### 7.4 속성이 사는 곳 (과제 §5 목록)

| 속성 | 위치 | 비고 |
| --- | --- | --- |
| Pitch | `head.pitch` | concert 철자 |
| NotatedDuration | `event.dur` (+ `display`, Tuplet) | |
| PerformedDuration | `perfNote.on/off` | Performance 층 |
| Onset | 기보: `event.m/at`. 연주: `perfNote.on` | |
| Voice | `event.voice` | part 전체에 걸친 voice |
| Staff | `event.staff`, `head.staff`(교차 staff 화음) | |
| Hand | `limbOf(head)` = `head.limb ?? voice.limb ?? staff.limb` | 파생. 명시값이 우선한다 |
| Tie | Tie spanner (head→head) | |
| Slur | Slur spanner (event→event) | |
| Beam | Beam spanner (hint) | |
| Tuplet | Tuplet spanner | 중첩 가능 |
| Articulation | `event.arts` | |
| Dynamic | Direction `dynamic` | 위치 기반. 음에 붙은 것은 `event`로 참조한다 |
| Fingering | `head.fingering` | 인쇄된 운지 |
| Accidental spelling | `head.pitch.step/alter` + `head.acc` | 철자와 인쇄 임시표를 분리한다 |
| Velocity | `perfNote.vel` | |
| Confidence | `prov.conf`, `prov.asp.*.conf`, `perfNote.conf`, Flag | §11 |
| Provenance | `prov` (희소, 상속) | §11 |

### 7.5 꾸밈음, cue, 숨은 음

- **grace**: `dur: "0"`, `at`은 주음과 같다. `order`로 순서를 매긴다. 정렬 키에서 같은 `at`의 주음보다 앞선다.
  - 뒤에 주음이 없으면 W-GRACE-ORPHAN이다 (마디 끝 꾸밈음 등).
  - 앱은 grace를 버린다(이슈 16). SG는 담는다. legacy adapter는 parity를 위해 버린다.
- **cue**: 이 part가 연주하지 않는 작은 음이다. `cue: true`. 앱은 cue를 구분하지 않고 친다. G2 adapter가 parity 여부를 정한다.
- **hidden**: 인쇄하지 않는 음과 쉼표. 시간은 차지한다.

### 7.6 화음 규칙

- 화음은 **한 event의 여러 head**다. 모든 head가 event의 `dur`를 공유한다.
- 길이가 다른 동시 음은 다른 voice(다른 event)에 둔다.
- **import 정책**: MusicXML `<chord/>` 음의 `<duration>`이 첫 음과 다르면, 그 음을 새 voice의 event로 떼어 내고 W-IMPORT-CHORD-SPLIT을 낸다. 코퍼스에서는 0건이다.

---

## 8. Piano Model

### 8.1 한 part, 여러 staff, 여러 voice

- 피아노는 **Part 하나**다. `instrument {kind: 'piano', family: 'keyboard'}`.
- `staves`는 보통 2개(grand staff)이고, 3개도 된다 (예: 리스트).
- **금지**: `Part == RightHand`, `Part == LeftHand` 구조. OMR이 피아노를 한 staff짜리 part 둘로 내보내는 경우(이슈 11)는 **import가 합칠지** 정할 문제다 (G2). schema는 그 결과를 한 part로 표현할 수 있다.
- voice는 part 안에서 원하는 만큼 둔다. 예: 위 staff v1(선율), v2(안성부), 아래 staff v5(베이스), v6.

### 8.2 손 배정 (RH/LH)

`limbOf(head) = head.limb ?? voice.limb ?? staff.limb ?? undefined`

| 상황 | 표현 |
| --- | --- |
| 보통의 grand staff | `st1.limb = RH`, `st2.limb = LH`. head에는 적지 않는다. |
| 왼손이 위 staff 음을 친다 | 그 head에 `limb: LH` |
| 한 voice 전체를 다른 손이 맡는다 | `voice.limb` |
| 한 화음을 두 손이 나눠 친다 | head마다 `limb` |
| 손을 알 수 없다 (AMT 직후) | 비워 둔다. 소비자 규칙으로 정하거나 G5가 추론해 채운다 (`prov.asp.limb`에 op `inferred`, conf) |

- 앱의 `hand` 값 `r`/`l`/`x`는 legacy adapter가 만든다. `x`(보이기만 하고 연주하지 않음)는 part 선택 규칙(App 4287–4298)의 결과다. **SG의 속성이 아니라 연습 설정**이다.
- G1은 손 배정을 개선하지 않는다.

### 8.3 교차 staff (cross-staff)

- **event 단위**: voice의 home staff가 st1인데 한 event가 st2에 적힌다. `event.staff = st2`.
- **head 단위**: 한 화음의 일부 음이 다른 staff에 적힌다. 그 head에 `staff: st2`를 둔다. 줄기는 event.staff에 있다.
- **불변식**: 모든 staff 참조는 같은 part의 staff다 (E-VOICE-STAFF).
- **교차 staff 셈여림·페달**: 위치 기반 direction이나 spanner에 `staff`를 적는다.

### 8.4 페달

| | 기보 (악보에 적힌 것) | 연주 (실제로 밟은 것) |
| --- | --- | --- |
| 위치 | Pedal spanner: `from`, `to`, `changes[]` (Pos) | PerfPedal: `on`, `off` (µs), `depth` |
| 종류 | damper / sostenuto / soft (una corda: `text`) | 같음 |
| 표시 | `mark {line, sign}`, `soundOnly` | – |

- AMT가 들은 페달은 Performance 층의 PerfPedal이다.
- 그것을 악보에 **적을지**는 기보 결정이다. 지금 `toMusicXml`은 그대로 적고, 이것이 이슈 17(가짜 페달)이다.
- G1 vertical slice는 현재 동작을 **바꾸지 않는다**. 들은 페달은 PerfPedal에, 쓴 페달은 Pedal spanner에 **둘 다** 남긴다. 그래서 G5가 이 결정을 고칠 수 있다.

### 8.5 운지와 아르페지오

- **운지**: `head.fingering[]`에 순서대로 둔다. 치환(3-1)은 `subst`, 대안은 `alt`로 표시한다.
  - 인쇄된 운지만 저장한다.
  - 앱의 `Fingering.plan`(자동 운지)은 파생 결과다. 저장하려면 G5가 `prov.asp.fingering {op: 'inferred'}`로 넣는다.
- **아르페지오**: Arpeggio spanner(`heads[]`, `dir`)로 둔다. 양손에 걸친 아르페지오는 두 staff의 head를 한 spanner에 담는다.
  - 앱의 `n.arp`(event 단위 불리언)는 adapter에서 파생한다.

### 8.6 Voicing

- 화음 안에서 드러낼 음은 `head.lead: true`로 둔다. 연주·연습 힌트이며 인쇄에는 영향이 없다.
- 인쇄 표시가 필요하면 아티큘레이션(`accent`, `tenuto`)이나 별도 voice(줄기 방향)로 적는다. 이것은 engraving(G4)의 몫이다.

### 8.7 피아노 예

[부록 C.1](#c1-피아노-3박자-못갖춘마디-반복과-volta-셋잇단-tie-페달-연주-층)에 있다: grand staff, 못갖춘마디, 셋잇단, tie, 페달(change 포함), 반복과 volta, 셈여림, 학생 연주 take 층.

---

## 9. Instrument Extensibility

### 9.1 막히지 않아야 하는 것

| 요구 | schema가 주는 것 |
| --- | --- |
| 음높이 없는 사건 | `PercEvent` + `PercHead {inst}`. Pitch를 전제하지 않는다. |
| 드럼 kit 악기 (kick, snare, closed/open/pedal hi-hat, crash, ride, tom) | `instrument.kit.items[]`: `key`, GM 번호, 보표 위치, notehead, 줄기 |
| 드럼 표기 (staff 위치, notehead, 줄기, 아티큘레이션) | kit 기본값 + head의 `pos`/`notehead` 덮어쓰기 + `display.stem` + `arts` |
| 드럼 연주 (onset, velocity) | PerfNote `{inst, part, on, off, vel}` |
| 사지 (RH, LH, RF, LF) | `head.limb`, `voice.limb` (손 voice와 발 voice) |
| 타법 (flam, rim, cross-stick, choke, ghost) | `PercHead.stroke` |
| 베이스·기타 이조 (옥타브 아래로 소리 남) | `instrument.transpose {chromatic: 0, diatonic: 0, octave: -1}` (MusicXML `<octave-change>-1`), 표기는 treble 8vb clef (`octave: -1`) 또는 보통 clef |
| 기타 TAB | `staff.kind: 'tab'` + `head.tech {string, fret}` (G1은 schema만. tuning은 `ext`) |
| 여러 악기가 같은 마디 격자를 공유 | `timeline` 공유, part별 events |

### 9.2 G1에서 하지 않는 것

- 드럼 import와 export를 하지 않는다. `<unpitched>`가 있는 MusicXML은 import가 `IMPORT-UNSUPPORTED-UNPITCHED`로 거절한다. perc event가 있는 그래프는 export가 `EXPORT-UNSUPPORTED-PERC`로 거절한다 (A26).
- 드럼 편곡, 드럼 렌더링, 드럼 재생을 하지 않는다.
- **G1이 증명하는 것**은 schema가 막히지 않았다는 사실뿐이다. 피아노와 드럼 part가 한 그래프에 있는 fixture가 검증, canonical 직렬화, JSON 왕복을 통과한다 (A25).

### 9.3 피아노 → 곡 구조 분석 → 드럼 편곡 → 드럼 악보 흐름

```
Piano ScoreGraph ──(G7 분석)──► SongGraph
   │                              sections(기능·에너지), 박자/템포(ScoreGraph timeline 참조),
   │                              악센트·화성 리듬(ScoreGraph event 참조)
   │                                        │
   │                          Arrangement Planner (G7+)
   │                                        │  드럼 part 초안 (events, kit, limbs, prov: generated)
   ▼                                        ▼
ops.addPart(graph, drumPart)  ── 같은 timeline을 공유하는 새 Part ── validate
   ▼
export: MusicXML (<unpitched>, <instrument>, percussion clef)   ← 이후 Goal
```

각 단계가 쓰는 것은 모두 schema v1에 있다: Part, Instrument.kit, PercEvent, limb, Performance render, provenance `generated`. 새 버전이 필요한 것은 `ramp`, 미분음, tuning 같은 **추가** 항목뿐이다.

드럼 예는 [부록 C.2](#c2-드럼-part-같은-그래프에-추가된-part)에 있다.

---

## 10. SongGraph Boundary

### 10.1 정의

| | ScoreGraph | SongGraph |
| --- | --- | --- |
| 질문 | 무엇을 연주하고 무엇을 기보하는가 | 이 곡은 무엇인가 |
| 내용 | 마디, 음, 표시, 연주, 출처 | 섹션 기능(intro/verse/chorus), 화성 분석(로마 숫자, 조성 영역), 모티프와 그 변형, 에너지 곡선, 역할(선율/베이스/반주), 프레이즈 기능(전악절/후악절, 종지) |
| 생산자 | import, 전사, 편곡 결과, 사용자 편집 | 분석기 (G7+), 사용자 주석 |
| 버전 | `scoregraph_version` | 자체 버전 (`songgraph_version`) |
| 의존 | **SongGraph를 모른다** | ScoreGraph를 ID로 참조한다 |

### 10.2 어디에 무엇을 두는가

| 개념 | ScoreGraph | SongGraph |
| --- | --- | --- |
| Section | `structure.sections`: 이름 붙은 **마디 구간**. 인쇄된 rehearsal mark, 반복 구간, 사용자나 편곡이 쓰는 편집 단위 | 섹션의 **기능**과 에너지. SG section ID를 참조하거나 자체 span을 쓴다 |
| Phrase | `structure.phrases`: **편집 단위 구간** (repair가 교체하는 단위) | 프레이즈 기능, 종지, 대응 관계 |
| Harmony | 인쇄된 **코드 기호** (Direction `chord`) | 화성 **분석** |
| Motif / reference | 없음 | occurrence 목록 (각각 ScoreSpan) + 변형 |
| Energy | 없음 | 위치별 값 |
| Role | 없음 (voice에 역할을 두지 않는다) | part·voice·구간별 역할 |

### 10.3 인터페이스 타입

`scoregraph/time.js`가 제공하고 SongGraph가 쓴다.

```ts
ScoreRef     = { scoreId: string, rev: number, fp: string }   // fp = fingerprint(graph), §14.5
ScoreSpan    = { part?: Id<'p'>, voices?: Id<'v'>[], from: Pos, to: Pos }
PlaybackSpan = { from: PlaybackPos, to: PlaybackPos }         // "후렴 두 번째" 같은 재생 기준 구간
EventSet     = Id<'e'>[] | Id<'h'>[]
```

- **해석 함수**: `resolveSpan(g, span) → Event[]`. 구간 안에서 시작하는 event를 결정론적 순서로 준다. `spanOf(g, ids) → ScoreSpan`.
- **신선도**: SongGraph는 `scoreRef.fp`로 자기가 분석한 그래프가 지금 그래프와 같은지 확인한다. 다르면 편집 op의 `idMap`(§12.3)으로 참조를 옮기거나 다시 분석한다.
- **승격**: SongGraph의 분석 구간을 **편집 단위**로 쓰고 싶으면 `ops.addPhrase`/`addSection`으로 ScoreGraph에 넣는다 (`prov {op: 'inferred', src: 분석기}`). 방향은 늘 SongGraph → ScoreGraph다.
- **금지**
  - ScoreGraph에 SongGraph ID나 분석값(에너지, 기능 라벨)을 넣지 않는다. `ext`에도 넣지 않는다.
  - SongGraph에 음을 복사하지 않는다. 참조만 한다.

---

## 11. Provenance

### 11.1 구조

- **출처 테이블**: `provenance.sources[]`에 출처를 한 번만 적는다. 도구, 버전, 입력 해시, 파라미터가 들어간다.
- **기본값**: `provenance.default`가 그래프 전체의 기본값이다. 예: MusicXML import면 `{src: 'sr1', op: 'imported'}`.
- **엔티티의 `prov`**: 기본값과 **다를 때만** 적는다.
- **측면(aspect) 단위**: 한 음의 존재는 전사에서 왔는데 철자는 추론이고 손은 사용자가 고쳤다면, `asp`에 측면별로 다르게 적는다.

### 11.2 해석 규칙

`provOf(g, id, aspect?)`는 필드별로 가장 구체적인 값을 쓴다.

```
entity.prov.asp[aspect]  ⊕  entity.prov  ⊕  container.prov  ⊕  provenance.default
  (head → event → part / 그 밖의 엔티티 → part → 루트)
```

`src`, `op`, `conf`는 각자 따로 위에서부터 채운다. `conf`가 어디에도 없으면 "알 수 없음"이다. 1로 간주하지 않는다.

### 11.3 op 의미

| op | 뜻 | 예 |
| --- | --- | --- |
| `imported` | 외부 표현을 옮겼다 (의미 변경 없음) | MusicXML, OMR 결과 파일 |
| `inferred` | 신호나 규칙에서 추정했다 | AMT 음, 박자, 조, 철자, 손 배정 |
| `generated` | 새로 만들었다 | 편곡, 드럼 part, 연습용 단순화 |
| `repaired` | 결함을 고치는 연산이 바꿨다 | repair engine, critic 수정 |
| `edited` | 사용자가 바꿨다 | 음 수정 UI |

### 11.4 flag (구간 단위 불확실성)

- 앙상블이 불일치한 구간, OMR이 의심한 마디, beat 신뢰도가 낮은 구간처럼 **음 하나가 아니라 구간**에 붙는 정보다.
- 형식: `Flag {kind, span | ids, conf?, src, code, note}`.
- 앱의 `suspectMeasures`(지금은 늘 비어 있음, §2.4)는 G2 이후 이 flag로 옮길 수 있다.

### 11.5 G1 slice의 provenance

- `toMusicXml`의 그래프에 들어가는 출처
  - `audio-score` source: `tool: 'audio-score.js'`, `params`에 `beatSource, quantizer, tempoAlias, arrangement`.
  - 기본값: `{op: 'inferred'}`.
- **G1은 음별 confidence를 새로 만들지 않는다.** `clean()`이 이미 버리고 있고, 그것을 되살리는 것은 전사 품질 Goal의 일이다.
- 대신 **자리를 마련해 둔다**: `perfNote.conf`, `prov.asp.exists.conf`.

### 11.6 하지 않는 것

- 모든 노드에 `{source, confidence, timestamp}`를 복사하지 않는다. 기본값과 같은 prov는 serializer가 지우지 않는다. **builder가 애초에 쓰지 않는다.** 대신 validator가 I-PROV-REDUNDANT를 낸다.
- 편집 이력(undo stack)은 그래프에 두지 않는다. 앱 상태다.

---

## 12. IDs / Editing

### 12.1 ID 형식

- 형식은 `prefix + 번호`다: `m7`, `e18`, `h19`.
- prefix: `p st v m mt ky tp en j c e h d s sc ph pf pn pp sr fl` (§5.14).
- **번호는 그래프 전체에서 유일하다.** 카운터 하나(`nextId`)를 모든 종류가 공유한다. 그래서 `e12`와 `h12`는 함께 존재할 수 없다. 번호만으로 엔티티를 찾을 수 있다.
- **번호는 의미가 없다.** 마디 번호, 위치, 음높이를 담지 않는다. 그래서 편집해도 바뀌지 않는다.
- **scoreId**(`graph.id`)는 그래프 밖에서 온다 (라이브러리 곡 id). 두 그래프를 구분할 때 쓴다.

### 12.2 할당 규칙

- **builder**는 만드는 순서대로 `nextId`를 올린다.
- **import**는 **문서 순서**대로 할당한다. 그래서 같은 입력에서는 같은 ID가 나온다 (A30).
  - 순서: source → part → staff → voice → 마디 → 박자/조/템포/ending → clef → event와 head(문서 순서) → direction → spanner (시작 순서) → performance.
- **op**는 `graph.nextId`부터 할당한다. 번호는 **재사용하지 않는다**. 삭제된 번호는 다시 쓰이지 않는다.
- 두 그래프를 합칠 때(조각 삽입)는 조각의 ID를 **모두 새로 할당**한다. 보존할 기존 엔티티만 원래 ID를 쓴다 (§12.4).

### 12.3 편집 시 보존·교체 규칙

모든 op는 `{graph, idMap, issues}`를 돌려준다.

- `idMap`은 `{retiredId: replacementId | null}` 형식이다.
- `rev`는 1 오른다.
- 입력 그래프는 바꾸지 않는다.

| 연산 | 유지되는 ID | 새 ID | 은퇴 ID (idMap) |
| --- | --- | --- | --- |
| head 음높이·철자·운지·limb 수정 | head, event | – | – |
| event 길이·위치 변경 (같은 voice) | event, heads | – | – |
| event의 voice·staff 변경 | event, heads | – | – |
| 화음에 음 추가 | 기존 전부 | 새 head | – |
| 화음에서 음 삭제 (1개 이상 남음) | event, 나머지 head | – | 그 head → null. 그 head에 닿은 tie는 반대쪽만 남는 열린 tie가 된다 |
| event 삭제 | – | – | event, heads → null. tie는 열린 쪽만 남기거나 없앤다. slur, tuplet, beam은 멤버를 줄이고, 비면 없앤다 |
| event 분할 (마디선 등) | 앞 조각이 event와 heads를 유지 | 뒤 조각의 event와 heads, 사이 tie | – |
| tie로 이어진 두 event 병합 | 앞 event | – | 뒤 event → 앞 event, 뒤 head → 앞 head |
| 구간 교체 (AI 부분 재편곡, repair) | 마디, voice, staff, 구간 밖 모든 것, 조각이 명시한 기존 event | 조각의 나머지 | 교체된 event → null |
| 마디 삽입·삭제 | 다른 마디와 그 event | 새 마디 | 삭제된 마디와 그 안의 event |
| 재import, 재전사 | 보장하지 않는다 | 전부 | – (새 그래프) |
| 직렬화, 역직렬화, migration | 전부 | – | – |

### 12.4 구간 교체 프로토콜 (`ops.replaceRegion`)

```
replaceRegion(graph, region, fragment) → {graph, idMap, issues}
  region   = { part: Id<'p'>, from: Pos, to: Pos, voices?: Id<'v'>[] }
  fragment = { events: Event[], spanners?: Spanner[], directions?: Direction[] }
             // 조각의 ID는 지역 이름("x1", "x2"…)이나 유지할 기존 ID
```

1. **구간 경계**: 선택된 voice의 event가 구간 경계에 걸치면 E-REGION-BOUNDARY로 거절한다.
   - 마디 단위 구간은 늘 안전하다.
   - Pos 단위 구간(phrase)은 경계가 event 경계와 맞아야 한다.
2. **삭제**: 구간 안에서 **시작하는** 선택 voice의 event를 삭제한다. 명시적으로 유지하는 것은 빼고, §12.3 삭제 규칙을 적용한다.
3. **ID 할당**: 조각의 지역 ID를 새 ID로 바꾼다.
4. **경계 tie**
   - 구간 밖 head에서 구간 안으로 들어오던 tie가 교체된 head를 가리키면 **열린 tie**가 된다 (W-TIE-OPEN).
   - 조각이 새 head로 다시 이으면 완전한 tie가 된다.
   - 나가는 tie도 같다.
5. **spanner 정리**: 구간 밖에서 시작해 구간 안에서 끝나던 slur와 wedge는 같은 규칙으로 열리거나 다시 이어진다.
6. **검증**: `validate`에 ERROR가 있으면 전체를 거절한다. 원래 그래프가 그대로 남는다.

G1은 이 op와 `ops.updateHead`, `ops.removeEvents`만 구현한다 (A31). 나머지 op는 필요한 Goal이 이 표를 따라 만든다.

### 12.5 legacy 참조와의 관계

- 지금 앱은 음을 `(m, b, staff)`, 마디 번호, 객체 참조로 가리킨다 (§2.4).
- G2 이후 legacy adapter는 각 legacy note에 `sgHead`(head ID)를 달아 줄 수 있다. 그러면 falling notes의 `sourceNoteId`(App 3003)가 **실제 안정 ID**가 된다.
- G1은 legacy 쪽을 바꾸지 않는다.

---

## 13. Validation

### 13.1 등급과 결과 형식

| 등급 | 뜻 | 경계에서의 처리 |
| --- | --- | --- |
| **ERROR** | 그래프가 스스로 모순이다. 참조가 끊겼거나 시간 모델이 깨져 사용할 수 없다. | builder, import, op가 **거절(throw)**한다. production으로 나가지 않는다. |
| **WARNING** | 표현은 되지만 음악적으로 의심스럽다. 결함 입력을 충실히 담은 경우다. | 그래프와 함께 돌려준다. 호출자가 표시하거나 기록한다. |
| **INFO** | 알아 둘 만한 사실 | 돌려준다. |

```ts
validate(graph) → { ok: boolean /* ERROR 0개 */, issues: Issue[] }
Issue = { code: string, severity: 'ERROR'|'WARNING'|'INFO', message: string,
          ids?: Id[], at?: { part?: Id<'p'>, m?: Id<'m'>, at?: Rat } }
```

- 정렬: (severity: ERROR → WARNING → INFO, code, 첫 ID 번호, message). 결정론적이다 (A8).
- 메시지는 영어로 쓰고, 값만 끼워 넣는다.
- 모드는 하나뿐이다. 규칙을 끄는 옵션은 없다.
- **비용**: O(n log n)이다. 2,000마디 40,000 head 그래프를 5초 안에 검사해야 한다 (A9).

### 13.2 규칙 목록

**ERROR**

| 코드 | 조건 |
| --- | --- |
| E-VERSION | `scoregraph_version`이 없거나, 정수가 아니거나, 이 코드가 아는 것보다 새 버전이다 |
| E-SHAPE | 필수 필드 없음, 타입 불일치, 모르는 enum 값, `ext` 밖의 모르는 필드, `null` |
| E-ID-FORMAT | ID 형식이나 prefix가 엔티티 종류와 맞지 않는다 |
| E-ID-DUPLICATE | ID 번호가 그래프 안에서 두 번 쓰였다 |
| E-ID-COUNTER | ID 번호 ≥ `nextId` |
| E-REF-MISSING | 참조한 ID가 없거나 다른 종류다 |
| E-REF-SCOPE | 허용되지 않은 part 경계 참조 (다른 part의 voice, staff, head) |
| E-RATIONAL | 형식 오류, 기약분수가 아님, 분모 0, 범위 초과 |
| E-DURATION | event `dur` < 0, grace가 아닌 event의 `dur == 0`, grace의 `dur ≠ 0`, 마디 `dur ≤ 0` |
| E-POSITION | `at < 0`, `at ≥ measure.dur` (span 끝과 anchor는 `>`) |
| E-SPAN-ORDER | span의 from ≥ to |
| E-MEASURE-OVERFLOW | event의 끝(`at + dur`)이 `measure.dur`을 넘는다 |
| E-VOICE-OVERLAP | 같은 voice의 grace가 아닌 두 event가 시간상 겹친다 |
| E-VOICE-STAFF | event, head, voice, clef, direction의 staff가 그 part의 staff가 아니다 |
| E-HEADS | note나 perc event에 head가 없다. 같은 철자의 head가 한 event에 두 번 있다 |
| E-TIE-PITCH | 완전한 tie의 양 끝 실음 MIDI가 다르다 |
| E-TIE-TIME | 완전한 tie에서 `to`의 시작 ≠ `from`의 끝 (ScorePos), 또는 같은 event 안이다 |
| E-TIE-CHAIN | head에서 나가거나 들어오는 tie가 둘 이상이다. tie 순환이 있다 |
| E-TUPLET | 비율 < 1. 멤버가 같은 voice가 아니거나, 시간 순서가 아니거나, 연속하지 않는다. parent 포함 관계 위반. 순환 |
| E-METER | 첫 마디에 박자표가 없다. 한 마디에 박자표가 둘이다. beatType이 2의 거듭제곱이 아니다. groups 합 ≠ nominal |
| E-KEY | fifths가 범위 밖이다. 같은 범위, 같은 위치에 조표가 둘이다 |
| E-TEMPO | qpm ≤ 0. qpm과 mark가 둘 다 없다 |
| E-ENDING | from > to. 같은 번호를 가진 ending이 겹친다. numbers가 비었거나 중복된다 |
| E-REPEAT | forward가 right에 있다. backward가 left에 있다. `times` < 2 |
| E-UNROLL-RUNAWAY | 전개 길이가 한계를 넘는다 (§6.7) |
| E-ARPEGGIO | 멤버 head의 onset이 다르다 |
| E-PERC-KIT | perc head의 `inst`가 part kit에 없다. kit 없는 part에 perc event가 있다 |
| E-PITCH-RANGE | 파생한 실음 MIDI가 0–127 밖이다 |
| E-STRUCTURE | section이나 phrase 구간 오류, 형제 section 겹침, parent 순환 |
| E-PERF | PerfNote의 `off ≤ on`, 음수 µs, vel이 1–127 밖, midi와 inst가 모두 없다. anchor가 순증가하지 않는다. anchor의 `(m, k)`가 전개에 없다 |
| E-PROV | 없는 source를 참조한다. `default`가 없다. conf가 범위나 자릿수를 어긴다 |
| E-REGION-BOUNDARY | 교체 구간 경계가 event를 가른다. **op 전용**이라 `validate.CODES`에는 없고, `ops.CODES`에 있다. A31이 검사한다 |

**WARNING**

| 코드 | 조건 | 관련 |
| --- | --- | --- |
| W-MEASURE-LENGTH | `dur ≠ nominal`이고 §6.3의 예외가 아니다 | 이슈 14 |
| W-DISPLAY-DURATION | 표시 음가 × 잇단음 사슬 ≠ `dur` | 이슈 19 |
| W-TUPLET-INCOMPLETE | 잇단음 멤버 합이 명목 길이와 다르다 | |
| W-TIE-OPEN | 한쪽만 있는 tie | 이슈 10 |
| W-SLUR-OPEN | 한쪽만 있는 slur | |
| W-PEDAL-OPEN | `to` 없는 페달 | |
| W-TEMPO-MARK-MISMATCH | qpm과 인쇄된 metronome 값이 모순된다 | 이슈 1, 15 |
| W-CLEF-MISSING | 첫 마디에 clef가 없는 staff | |
| W-OTTAVA-OVERLAP | 같은 staff에서 ottava가 겹친다 | |
| W-HEAD-UNISON | 한 event에 이명동음 같은 음(C#과 Db)이 있다 | |
| W-GRACE-ORPHAN | 뒤에 주음이 없는 꾸밈음 | |
| W-REPEAT-DANGLING | 뒤에 소비하는 backward가 없는 forward repeat | G0 PF-M1 |
| W-ENDING-NO-REPEAT | ending 묶음 앞에 돌아갈 backward repeat가 없다 | |
| W-PERF-LINK-PITCH | 링크된 PerfNote의 midi가 head의 실음과 다르다 | |
| W-IMPORT-* | import가 원문을 바꿔야 했다. 목록은 부록 A에 있다: `CHORD-SPLIT`, `BACKUP-CLAMP`, `METER-MIDMEASURE`, `REPEAT-MOVED`. **importer 보고서(`report.issues`) 전용**이라 `validate.CODES`에는 없다. 부록 A의 fixture로 검사한다 | |

**INFO**

| 코드 | 조건 |
| --- | --- |
| I-VOICE-GAP | voice 안에 event가 덮지 않는 시간이 있다 (`<forward>`) |
| I-NO-TEMPO / I-NO-KEY | 템포나 조표가 없다 |
| I-JUMP-IGNORED | 전개가 Jump를 따르지 않았다 (G1) |
| I-LIMB-UNSET | limb를 정할 수 없는 head가 있다 (개수) |
| I-PROV-REDUNDANT | 상속값과 같은 prov가 명시되어 있다 |
| I-EXT | `ext` namespace가 있다 (목록) |

### 13.3 ERROR와 WARNING을 가른 기준

- **ERROR**: 시간 모델(길이, 위치, 겹침, 넘침), 참조, ID, 형식, 그리고 **재생 의미를 정할 수 없는** 상태(tie 양 끝의 음이 다름).
- **WARNING**: 인쇄 표시의 모순(W-DISPLAY-DURATION), 열린 tie와 slur, 불규칙 마디, 모순된 템포 표기. 모두 **실제 파일과 현재 writer가 만드는 상태**다.
  - DP6(충실함)에 따라 그대로 담아야 G0 parity와 round-trip이 가능하다.
  - 경고로 드러나야 이후 Goal이 고치고 측정할 수 있다.
  - 예: G4가 이슈 19를 고치면 W-DISPLAY-DURATION 개수가 0으로 내려가는 것을 G1 golden의 `.issues.json`이 보여 준다.

---

## 14. Serialization

### 14.1 형식

- UTF-8 JSON, BOM 없음, LF 줄바꿈, 마지막 줄바꿈 하나.
- 파일 확장자는 `.sg.json`이다.
- 수: 정수만 쓴다. 예외는 `conf`(Conf 규칙), layout과 `ext`의 수(소수 셋째 자리까지)다. 지수 표기와 `-0`은 쓰지 않는다.
- 유리수는 Rat 문자열, 연주 시간은 µs 정수다. **기보 쪽에는 float가 없다.**

### 14.2 canonical 규칙

1. **키 순서**: 엔티티마다 `schema.js` shape table의 필드 순서를 따른다. 알파벳순이 아니다. 첫 줄을 보면 무엇인지 알 수 있게 하기 위해서다. `ext` 안은 키를 알파벳순으로 쓴다. 기준 순서:
   - event: `id, kind, m, at, dur, voice, staff, hidden, grace, cue, display, heads, arts, orn, fermata, lyrics, prov, ext`
   - head: `id, pitch | inst, staff, pos, acc, notehead, fingering, limb, stroke, lead, tech, prov, ext`
   - spanner: `id, type`, 그다음 §5.10 표의 필드 순서, `prov, ext`
   - 그 밖의 엔티티: §5의 표에 적힌 순서
2. **생략**: 기본값과 같은 선택 필드, `false`, 빈 선택 배열, 파생 가능한 중복값을 쓰지 않는다. 예: head.staff == event.staff이면 쓰지 않는다. 필수 배열은 비어도 쓴다.
3. **배열 순서**

| 배열 | 순서 |
| --- | --- |
| `measures`, `parts`, `staves`, `voices`, `sources`, `numbers` | 의미 순서 (그대로) |
| `meters`, `keys`, `tempos`, `jumps` | (마디 index, at, ID 번호) |
| `endings` | (from 마디 index, ID 번호) |
| `clefs` | (마디 index, at, staff index, ID 번호) |
| `events` | (마디 index, voice index, at, grace 우선·order, ID 번호). 한 마디 한 voice의 흐름이 연속한 줄이 된다 |
| `heads` | (실음 MIDI, step, ID 번호) |
| `directions` | (마디 index, at, staff index, kind, ID 번호) |
| `spanners` | (첫 기준점의 ScorePos, type, ID 번호). 기준점은 from, events[0], heads[0]의 event |
| `sections` | (from index, ID 번호) · `phrases`: (from ScorePos, ID 번호) |
| `performance.notes` | (on, midi 또는 inst, ID 번호) · `pedals`: (on, ID 번호) · `anchors`: (재생 순서) |
| `flags` | (from ScorePos 또는 첫 ID 번호, ID 번호) |
| `arts`, `beats`, `degrees`, `lyrics` | 정의된 순서 (arts는 enum 순서, lyrics는 verse 순) |

4. **배치**
   - **컨테이너**(루트, `timeline`, 각 part, `structure`, 각 performance, `provenance`)는 멤버마다 한 줄에 `"key": value`로 쓰고, 2칸씩 들여쓴다.
   - **엔티티 배열**(위 표의 배열 중 엔티티를 담은 것)은 **원소 하나를 한 줄에** compact JSON(공백 없음)으로 쓴다.
   - 그 밖의 값(`meta`, `instrument`, `default` 등)은 한 줄 compact JSON이다.
   - 편집 하나가 diff 한두 줄이 된다.
5. **문자열**: JS `JSON.stringify`의 escape 규칙을 쓴다. 비ASCII는 그대로 쓴다.
6. **멱등성**
   - canonical 문자열 `s`는 `serialize(parse(s)) === s`를 만족한다.
   - 모든 그래프 `g`는 `parse(serialize(g))`가 `g`와 deep-equal이다 (A10).
   - canonical이 아닌 입력(키 순서, 기본값 명시)은 parse할 수 있고, 다시 쓰면 canonical이 된다.

예시는 부록 C에 있다.

### 14.3 exporter와 "표시 없음"

`display`, `acc`, `beam`, `stem`이 없으면 MusicXML exporter는 그 요소를 **쓰지 않는다** (`<type>` 없는 `<note>`).

- 이유: 코퍼스 59개 파일에 `<type>` 없는 음이 있다. G0 reader는 이것을 `None`으로 읽으므로, 지어내면 semantic projection이 바뀐다.
- 새로 만든 그래프에 표시를 채우는 일은 명시적인 파생 연산(`derive.display`, G4)이다. G1 exporter는 음악 결정을 하지 않는다.

### 14.4 버전과 migration

- `scoregraph_version`은 정수이며 schema v1에서 **1**이다.
- **올리는 조건**: 유효한 문서의 **내용이나 의미**를 바꾸는 모든 변경이다. 필드 추가, 제거, enum 값 추가, 의미 변경이 모두 해당한다.
  - validator가 모르는 필드를 E-SHAPE로 거절하기 때문이다. 이전 코드가 새 필드를 **조용히 버리는 일**이 생기지 않는다.
- **읽을 때**
  - 자기보다 새 버전은 E-VERSION으로 거절한다. 앱은 "앱을 업데이트하세요"를 보여 준다.
  - 이전 버전은 `migrate()`가 체인으로 올린다: `MIGRATIONS[v]: (doc_v) → doc_{v+1}`. JSON을 받아 JSON을 돌려주는 순수 함수다.
- **migration은 ID를 보존한다.** 각 migration은 `tests/scoregraph/migrations/v{n}.sg.json → v{n+1}.sg.json` fixture 테스트를 가진다.
- 하위 변환(downgrade)은 지원하지 않는다.
- **실험 필드**는 `ext.<namespace>`에 둔다. 버전을 올리지 않는다. core로 승격할 때 버전을 올리고, migration이 `ext`에서 옮긴다.
- 제거한 필드 이름을 다른 의미로 다시 쓰지 않는다.
- 저장 형식에서는 문서 자체가 버전을 가진다. 앱의 곡 기록에 담을 때(G2) 별도 봉투를 두지 않는다.

### 14.5 지문(fingerprint)과 해시

- `fingerprint(g)`는 canonical 직렬화의 FNV-1a 64비트 값(16자리 hex)이다.
  - 동기 함수이고, 의존성이 없다 (BigInt). 브라우저와 Node에서 같다.
  - 쓰임: SongGraph의 `scoreRef.fp`, 캐시 키.
- 보안용이 아니다. 무결성이 필요한 저장·공유(G2)는 서버에서 sha256을 쓴다.

### 14.6 다른 언어에서 읽기

- 형식이 JSON이고, Rat은 `Fraction("n/d")`이며, 시간은 정수다. 그래서 Python stdlib만으로 읽고 정확히 계산할 수 있다 (A14).
- G1은 Python ScoreGraph 라이브러리를 만들지 않는다. `arrange_score.py`가 그래프를 직접 읽게 되는 Goal에서 필요한 만큼 만든다.

---

## 15. Migration Strategy

### 15.1 원칙

기존 경로를 한 번에 바꾸지 않는다 (Strangler). 경계마다 다음 순서를 밟는다.

1. 새 경로를 옆에 만든다.
2. 기존 출력과 **음악적으로 같음을 측정한다** (shadow).
3. 바꾼다.
4. 이전 코드를 지운다.

### 15.2 단계 (G1 이후 포함)

| 단계 | Goal | 경계 | 내용 | 증명 방법 |
| --- | --- | --- | --- | --- |
| S0 | **G1** | 없음 (라이브러리) | `scoregraph/`: schema, validator, serializer, time, ops, MusicXML I/O | JS 단위 테스트, fixture |
| S1 | **G1** | 없음 (테스트) | 코퍼스 369개 round-trip | `run.py sg-roundtrip` (G0 semantic + G1 inventory) |
| **S2** | **G1** | **`toMusicXml`의 writer** | `staffEvents` → **ScoreGraph** → MusicXML. `graph` 반환, 연주 층 포함 | G0 golden, core·robust·smoke·replay ab 동일, mutation |
| S3 | G2 | 앱 import | MusicXML, 카탈로그, OMR → ScoreGraph → **legacy adapter** → Score. 곡 기록에 `graph` 저장 (버전 있음) | T1-C conformance: adapter 출력 == `parseMusicXML` 출력 (부록 B의 parity 규칙) |
| S4 | G2–G3 | 리뷰 재작성 | `toMusicXml`의 `graph`를 직접 채택. XML 재파싱 제거 | 리뷰 화면 테스트, golden |
| S5 | G4–G5 | 렌더, 재생, 연습 | 렌더러, `PianoScore.build`가 SG의 time 모듈과 안정 ID를 쓴다 | 소비자별 parity 테스트 |
| S6 | G5–G7 | 편곡 | wireScore → SG JSON 부분집합. `arrange_score.py`가 SG를 읽는다 | arranger 테스트 |
| S7 | G7+ | SongGraph, planner, 드럼 | §9.3, §10 | |
| S8 | 마지막 | 제거 | `parseMusicXML`, `buildXml`, `packScore` 제거 | |

### 15.3 첫 production 경계를 `toMusicXml` writer로 정한 이유

| 후보 | 장점 | 단점 | 판정 |
| --- | --- | --- | --- |
| **A. `audio-score.js` `buildXml` 자리 (writer)** | 순수 JS라 Node에서 결정론적으로 돈다. **G0 benchmark가 이미 정확히 이 출력을 잰다** (golden 17, core 553, robust, replay). 모든 녹음 경로가 모이는 곳이다 (App 7090, 14570, 14637, 14835). 연주(초)와 기보(tick)가 함께 있는 유일한 지점이라서 Performance 층을 처음으로 채울 수 있다. 앱 파일은 script 태그 몇 줄만 바뀐다. | `audio-score.js`를 다른 세션도 편집한다. SUT가 여러 파일이 되어 bench를 고쳐야 한다. writer의 결함(이슈 1, 19)을 **그대로** 담아야 한다. | **채택** |
| B. 앱 `parseMusicXML` 자리 (import) | 모든 경로의 수렴점이다 | 브라우저 전용이다 (T1, 네트워크, puppeteer). 19k줄 파일의 핵심을 여러 세션이 편집한다. legacy adapter가 먼저 필요하다. 소비자 캐시가 객체 identity에 묶여 있다. | G2 |
| C. 저장 형식 (`packScore`) | 진실의 자리다 | adapter와 migration이 모두 필요하다. 사용자 데이터 위험이 있다. | G2 이후 |
| D. shadow만 (그래프를 만들기만 하고 쓰지 않음) | 위험 0 | production 사용이 없어 죽은 코드가 되고, 경계 검증이 없다 | A의 1단계로 포함 |

**G1 vertical slice** (A, 두 단계):

1. **shadow**
   - `toMusicXml` 안에서 기존 `buildXml`은 그대로 둔다.
   - 새 `buildGraph(model)` → `SG.musicxml.export(graph)`를 **함께** 계산한다.
   - 테스트에서 둘의 G0 semantic projection을 모든 bench 입력으로 비교한다.
2. **flip**
   - 차이가 0이면 반환 XML을 SG exporter 출력으로 바꾼다.
   - `buildXml`은 `opts.legacyWriter` 뒤에 한 릴리스 동안 남긴 뒤 G2에서 지운다.
   - 반환값은 `{xml, stats, graph, graphIssues}`다. `stats`와 golden의 stats 키는 바뀌지 않는다.

`buildGraph`가 할 일은 `buildXml`의 **음악 결정을 그대로 옮기는 것**이다: 마디 분할(`perBar`), 조각 분할(`notePieces`, `pieces`), 쉼표 조각, `tupletOf`, 임시표 상태, 페달 위치.

- 임시표는 `head.acc`로 명시한다.
- 겹박자 템포는 `qpm = bpm`, `mark = 점4분 = bpm`으로 둔다. 이슈 1을 **그대로** 담으므로 W-TEMPO-MARK-MISMATCH가 난다.
- 삼연음 안의 쉼표는 `display.type`만 둔다. 이슈 19를 그대로 담으므로 W-DISPLAY-DURATION이 난다.
- 들은 음, 들은 페달, `barStarts`는 `source` Performance 층에 넣는다 (A41).

**parity를 바이트가 아니라 의미로 정한 이유**

- `buildXml`은 XSD 순서를 어긴다 (§2.3). 정상적인 exporter는 같은 바이트를 낼 수 없다.
- divisions도 달라질 수 있다 (exporter는 필요한 최소값을 쓴다).
- G0 golden은 이 경우를 위해 `SERIALIZATION_ONLY` 라벨과 bless 절차를 이미 갖고 있다.
- 대신 **bench의 모든 케이스에서 metric과 semantic digest가 같아야 한다**는 더 넓은 조건을 건다 (A36).

### 15.4 SUT가 여러 파일이 되는 문제 (반드시 먼저)

`audio-score.js`가 `scoregraph/`를 require하면, 지금의 bench는 두 가지를 잘못 잰다.

1. `ab --a git:<rev>`는 `audio-score.js` 한 파일만 꺼낸다. 형제 모듈이 없어서 실패하거나, 전역에 미리 올린 **작업 트리의** scoregraph를 양쪽이 함께 쓴다 (A/B가 조용히 틀린다).
2. mutation-check는 `audio-score.js`만 임시 경로에 복사한다.

G1 Step 7의 **첫 커밋**은 bench를 먼저 고친다.

- SUT를 **디렉터리 스냅샷**으로 본다: `audio-score.js` + `scoregraph/**`.
- `resolve_sut('git:<rev>')`는 두 경로를 `.cache/ab/<name>/`에 같은 상대 배치로 꺼낸다. G1 이전 rev에서는 `scoregraph/`가 없어도 된다.
- `notate.js`는 `<sutdir>/audio-score.js`를 require한다. `audio-score.js`는 자기 옆의 `./scoregraph/index.js`를 require한다.
- `run.json`에 `sut_sha256`(정렬된 경로 + 내용 해시)을 더한다. `audio_score_sha256`은 그대로 둔다 (G0 호환).
- mutation-check는 SUT 디렉터리를 통째로 복사하고, mutant는 `scoregraph/` 파일도 겨냥할 수 있다 (A38, A39).

### 15.5 브라우저 연결

- 앱 HTML의 `<script src="./audio-score.js?v=8">`(App 9행) **앞에** `scoregraph/`의 파일들을 같은 방식(`?v=` 캐시 버스터)으로 넣는다. 앱 파일 변경은 이 몇 줄뿐이다.
- `audio-score.js`의 모듈 머리는 `typeof module === 'object' ? require('./scoregraph/index.js') : root.PPPScoreGraph`로 둔다.
- `server.js`의 `BLOCKED`에 `scoregraph`가 없으므로 정적으로 서빙된다. Docker의 `COPY . .`도 포함한다 (`.dockerignore`에 규칙 없음). A44가 이를 확인한다.

### 15.6 legacy adapter (G2 준비)

- G1은 adapter를 만들지 않는다. 그러나 G2가 바로 시작할 수 있도록 **필드 대응과 parity 규칙**을 부록 B에 정해 둔다.
- 핵심: G2의 adapter는 `parseMusicXML`과 같은 legacy Score를 내야 한다 (T1-C conformance). 그래야 모든 소비자가 바뀌지 않는다.

---

## 16. Test Strategy

### 16.1 층

| 층 | 무엇 | 도구 | 위치 |
| --- | --- | --- | --- |
| 단위 | Rat, ID, shape, 각 validator 규칙, serializer, time, ops, XML parser | `node --test` (Node 24 내장, 의존성 없음) | `tests/scoregraph/*.test.js` |
| fixture (유효) | 주제별 작은 그래프와 MusicXML, 기대값 sidecar | 위와 같음 | `tests/scoregraph/fixtures/valid/`, `fixtures/xml/` |
| fixture (무효) | ERROR 코드마다 하나 이상, sidecar에 기대 코드 | 위와 같음 | `tests/scoregraph/fixtures/invalid/` |
| 결정론 | 두 프로세스, 키 삽입 순서 섞기, 배열 섞기 | 위와 같음 + `child_process` | `determinism.test.js` |
| 브라우저 적재 | `vm` 컨텍스트에서 `require`와 `module` 없이 script로 적재 | Node `vm` | `browser-load.test.js` |
| Python 호환 | fixture를 `json`과 `Fraction`으로 읽어 마디 길이를 검사 | `unittest` | `tests/bench/unit/test_scoregraph_interop.py` |
| 코퍼스 round-trip | 369개 파일 MusicXML → SG → MusicXML (→ SG) | **bench 새 명령** `run.py sg-roundtrip` + `node/sg-roundtrip.js` | `tests/bench/pppbench/sg_roundtrip.py`, `notation_inventory.py` |
| SG golden | G0 golden 입력 17개로 만든 `graph`의 canonical 직렬화와 경고 목록 | `node --test` (bless: `UPDATE_SG_GOLDEN=1`) | `tests/scoregraph/golden/G01..G17.{sg.json,issues.json}` |
| G0 회귀 | golden, core, robust, smoke, replay-public, full, mutation-check | 기존 bench | 변경 없음 (SUT 식별만 §15.4) |
| 앱 | 기존 `npm test` 26개 suite | puppeteer (T1) | 변경 없음 |

`package.json`에 추가할 script (의존성은 추가하지 않는다):

```
"test:scoregraph": "node --test \"tests/scoregraph/**/*.test.js\""
```

### 16.2 round-trip 판정 (`run.py sg-roundtrip`)

- **대상**: 커밋된 모든 `.musicxml`/`.mxl`(`catalog`, `samples`, `tests/bench/corpus`, `tests/fixtures`). 개수는 실행 때 보고한다 (이 문서 작성 시 369개).
- `.mxl`의 압축은 Python이 푼다. node adapter는 XML 문자열만 받는다.
- **L1 (G0 의미)**: `semantic.classify(projection(read(원문)), projection(read(왕복)))`이 `None`이어야 한다. reader는 앱 parity(reader/4)다.
- **L1+ (G1 기보 목록)**: `notation_inventory(원문) == notation_inventory(왕복)`.
  - 항목: slur, dynamics, wedge, articulation, ornament, fermata, fingering, arpeggiate, harmony, lyric, words, rehearsal, grace, beam, stem, octave-shift, pedal, tuplet 괄호, barline style, repeat, ending, part name, title, composer, transpose.
  - 행 형식: `(part index, 마디 index, 종류, 위치 q(Fraction), staff, 속성 정규화)`의 multiset.
- **L2 (그래프 고정점)**: `serialize(import(원문))`과 `serialize(import(export(import(원문))))`이 같아야 한다. 단 `provenance.sources[].input`은 비교에서 뺀다.
- **알려진 손실**(허용, 부록 A): `<print>`의 system/page 나눔 외 layout, `<defaults>`, `<credit>`, 글꼴, 색, default-x/y(음의 `x` 외), 부록 A의 "버림" 목록. 이 요소들은 inventory에 넣지 않는다. import 보고서가 개수를 적는다.
- **allowlist**: `tests/scoregraph/roundtrip-allowlist.json`. G1 완료 시 **최대 3개 파일**이고, 각 항목에 `reason` 코드와 그 현상을 재현하는 최소 fixture 경로가 있어야 한다.

### 16.3 과제 §14의 테스트 주제 → fixture

| 주제 | fixture (새로 만듦) | 재사용 | AC |
| --- | --- | --- | --- |
| schema | `valid/*`, `invalid/shape-*` | – | A4, A5 |
| invariant | `invalid/*` (ERROR 코드마다), `valid/warn-*` (WARNING 코드마다) | – | A5, A6, A7 |
| 결정론적 직렬화 | 모든 `valid/*` | – | A10–A12 |
| round-trip | `xml/*` 전부 | 코퍼스 369개 | A32–A34 |
| 유리수 시간 | `xml/tuplets-nested`, `xml/tempo-meter-key-changes` | M04, M05, M06 | A2, A3, A15 |
| pickup | `xml/pickup-3-4`, `valid/pickup-graph` | C08, M07, M08 | A16 |
| tuplets | `xml/tuplets-nested` (3:2, 5:4, 6:4, 5:4 안의 3:2), `valid/warn-tuplet-incomplete` | M04 | A3 |
| 여러 voice | `xml/voices-4` | C12 | A21 |
| 두 staff | `xml/grand-staff` | 대부분 | A21 |
| 교차 staff | `xml/cross-staff` (event 단위, head 단위, 교차 arpeggio) | 코퍼스에 없음 | A21, A24 |
| ties/slurs | `xml/ties-slurs` (마디 넘는 것, 화음, 중첩 slur 번호), `valid/warn-tie-open` | C01, C02, C13, 불일치 11개 파일 | A22 |
| 템포 변경 | `xml/tempo-meter-key-changes` | C09, M22 | A15 |
| 박자 변경 | 위와 같음 (4/4 → 6/8 → 3+2/8) | 23개 파일 | A15 |
| 조 변경 | 위와 같음 (G → E♭, 마디 중간 포함) + `xml/transposing` (B♭ 클라리넷, 베이스 8vb) | 2개 파일 | A15, A19 |
| repeats/volta | `xml/repeats-*` (단순, times 3, 1·2 ending, 중첩, forward 없는 backward, [1,2]+[3]) | 169개 파일 | A17 |
| malformed graph 거절 | `invalid/*` | – | A5 |
| 드럼 | `valid/drums-with-piano`, `invalid/perc-unknown-inst`, `xml/unpitched` | – | A25, A26 |
| 편집·ID | `ops.test.js` (fixture 위에서 op 적용) | – | A31 |

### 16.4 fixture 작성 규칙

- 손으로 쓰는 MusicXML은 **명세에서 기대값을 끌어낸다** (G0 correctness fixture와 같은 방식). 구현을 돌려 기대값을 만들지 않는다.
- sidecar(`*.expect.json`)에 `{about, spec, expect: {...}}`를 적는다.
- 무효 fixture는 규칙 하나만 어긴다.

---

## 17. Acceptance Criteria

모든 항목은 명령이나 테스트로 PASS/FAIL을 판정한다. "기준 커밋"은 G1 구현의 시작 커밋(Step 0에서 기록)이다. 표 밖의 해석은 하지 않는다.

**라이브러리와 schema**

- **A1.** `scoregraph/*.js`가 Node 24에서 `require`로 적재된다. `vm` 컨텍스트(`require`, `module` 정의 없음)에서 script로 적재하면 전역 `PPPScoreGraph`가 생긴다. `package.json`의 `dependencies`와 `devDependencies`는 기준 커밋과 바이트 단위로 같다.
- **A2.** Rat 단위 테스트가 정규화, 사칙연산, 비교, 파싱과 형식화, overflow 예외를 다룬다. 결정론적 LCG로 만든 10,000개 쌍에서 `(a+b)−b == a`와 `format(parse(s)) == s`가 모두 성립한다.
- **A3.** `xml/tuplets-nested` import 결과의 모든 event `dur`가 sidecar의 유리수와 같다. 각 tuplet 멤버 합이 명목 길이와 정확히 같다. 직렬화 출력에 `conf`와 layout 필드 밖의 소수점 수가 없다 (정규식 검사).
- **A4.** `schema.js`의 `ENTITY_KINDS`가 §5.14 표의 21개 엔티티와 prefix에 정확히 일치한다 (테스트 안의 기대 목록과 비교).

**검증**

- **A5.** `validate.CODES`의 **모든 ERROR 코드**마다 `fixtures/invalid/`에 하나 이상의 fixture가 있다. 각 fixture는 `ok:false`이고, sidecar에 적힌 코드 집합과 정확히 같은 ERROR를 낸다.
- **A6.** **모든 WARNING 코드**마다 `ok:true`이면서 그 코드를 내는 fixture가 하나 이상 있다.
- **A7.** `fixtures/valid/`의 모든 그래프(§16.3의 주제 fixture 전부, 16개 이상)가 ERROR 0개이고, sidecar에 적힌 WARNING 집합과 정확히 같다.
- **A8.** 같은 그래프를 세 번 검증하거나, 엔티티 배열을 섞은 입력을 parse해 검증해도, issue 목록이 deep-equal이다 (순서 포함).
- **A9.** 합성 그래프(2,000마디, 40,000 head, 2 staff, tie와 slur 포함)의 `validate`가 CI 러너(Node 24)에서 5초 안에 끝난다.

**직렬화**

- **A10.** 커밋된 모든 `.sg.json`에서 `serialize(parse(s)) === s`다. 테스트 중에 만들어진 모든 그래프에서 `parse(serialize(g))`가 `g`와 deep-equal이다.
- **A11.** 같은 입력으로 만든 그래프를 두 개의 Node 프로세스에서, 그리고 객체 키 삽입 순서를 섞어서 직렬화해도 바이트가 같다. LF만 쓰고, 마지막 줄바꿈이 하나이며, BOM이 없다.
- **A12.** canonical 형식 lint가 통과한다. 첫 키가 `scoregraph_version`이다. `null`이 없다. 빈 선택 배열이 없다. 엔티티 배열의 원소마다 한 줄이다. 허용 필드 밖에 비정수 수가 없다.
- **A13.** `scoregraph_version`이 없거나 2인 문서의 parse는 E-VERSION으로 거절된다. 테스트 전용 migration(v0→v1)을 등록하면 `migrate`가 체인으로 적용하고 ID를 보존한다.
- **A14.** Python `unittest`가 모든 `fixtures/valid/*.sg.json`을 `json.load`와 `Fraction`만으로 읽는다. 각 (마디, voice)의 event 끝이 `measure.dur` 이하라는 것과, sidecar의 마디별 내용 길이가 JS 계산과 같다는 것을 확인한다.

**시간**

- **A15.** `xml/tempo-meter-key-changes`에서 sidecar의 12개 위치에 대해 `seconds`가 기대 유리수와 같고 `micros`가 기대 정수와 같다 (§6.8의 20/3 s → 6,666,667 µs 포함). `meterAt`과 `keyAt`이 기대값과 같다.
- **A16.** `xml/pickup-3-4`: 마디 `dur`가 `1/4, 3/4, …, 1/2`이다. 못갖춘마디 음의 `metric().beat`가 3박(index 2)이다. W-MEASURE-LENGTH가 없다. `implicit` 없이 짧은 첫 마디를 가진 그래프는 W-MEASURE-LENGTH를 낸다.
- **A17.** 반복 fixture 6개의 `unroll`이 sidecar의 visit 목록과 같다. 커밋된 코퍼스 **전체 파일**에서 import한 그래프의 `unroll`(마디 index 목록)이 G0 `canonical.app_play_order()`와 같다. 불일치는 0이다.
- **A18.** anchor 3개 이상인 fixture에서 PlaybackPos 100개에 대해 `fromUs(toUs(p))`가 `p`와 1µs 이내로 돌아온다. 순증가하지 않는 anchor는 E-PERF를 낸다.

**Event, 음높이, 피아노**

- **A19.** C03, C04, `xml/transposing`에서 head의 concert 철자, 파생 written 철자, 실음 MIDI가 sidecar와 같다. export한 `<pitch>`와 `<transpose>`가 원문과 같다 (inventory).
- **A20.** C10, C11: head의 concert 음높이가 원문 `<pitch>`와 같다 (옮기지 않음). Ottava spanner의 `shift`는 ±1이다. 파생 표시 옥타브는 `oct − shift`다. export한 `<octave-shift>`가 inventory에서 같다.
- **A21.** C12, `xml/voices-4`, `xml/grand-staff`, `xml/cross-staff`가 L1, L1+, L2를 통과한다. E-VOICE-OVERLAP과 E-VOICE-STAFF가 없다. 교차 staff event와 head의 `staff`가 sidecar와 같다.
- **A22.** C01·C02·C13·`xml/ties-slurs`: 완전한 tie는 양 끝이 있는 Tie spanner다. 한쪽만 있는 tie 수는 sidecar와 같다. 코퍼스의 tie 불일치 11개 파일은 W-TIE-OPEN 개수가 원문의 짝 없는 `<tie>` 수와 같다. 모든 `<tie>`와 `<slur>`의 start/stop이 inventory에서 보존된다.
- **A23.** C07: grace event가 `dur "0"`, `order`, `slash`로 import된다. L2 고정점이 성립한다. G0 projection이 바뀌지 않는다.
- **A24.** 피아노 fixture에서 `limbOf`가 staff 1 head는 RH, staff 2 head는 LH를 준다. voice.limb와 head.limb가 이 순서로 우선한다. damper 페달(start, change, stop), 운지(단일, subst), 양 staff에 걸친 arpeggio가 L1+와 L2를 통과한다.

**확장성과 경계**

- **A25.** `valid/drums-with-piano.sg.json`이 ERROR 0개로 검증되고 A10을 만족한다. 이 fixture는 피아노 part와 drumset part가 timeline을 공유하는 그래프이며 다음을 포함한다.
  - kit 8종: kick, snare, hh-closed, hh-open, hh-pedal, crash, ride, tom-hi
  - voice 2개, limb 4종
  - head 2개짜리 타격, flam stroke
  - render performance
- **A26.** `<unpitched>`가 있는 `xml/unpitched`는 import가 `{ok:false, code:'IMPORT-UNSUPPORTED-UNPITCHED'}`를 돌려준다 (예외가 새어 나가지 않는다). A25의 그래프를 export하면 `EXPORT-UNSUPPORTED-PERC`를 돌려준다.
- **A27.** `resolveSpan`과 `spanOf` 테스트가 다음을 다룬다: 마디를 넘는 span, voice 제한, part 제한, 없는 마디를 가리키는 span(E-REF-MISSING). 같은 입력에서 결과 순서가 같다. `scoregraph/` 코드와 schema에 SongGraph를 참조하는 필드가 없다 (`songgraph` 문자열 grep 결과가 주석 밖에서 0건).

**Provenance와 ID, 편집**

- **A28.** `provOf`가 §11.2 순서로 해석한다 (fixture 6가지 조합). MusicXML import 그래프는 source 1개, 엔티티별 `prov` 0개다. `toMusicXml` 그래프는 `audio-score` source와 기본값 `op: inferred`를 갖는다.
- **A29.** 기본값과 같은 `prov`를 명시한 fixture가 I-PROV-REDUNDANT를 낸다.
- **A30.** 같은 MusicXML을 두 번(두 프로세스에서) import하면 직렬화 바이트가 같다 (ID 포함).
- **A31.** `ops.updateHead`는 ID를 유지하고 `rev`를 1 올린다. `ops.removeEvents`는 §12.3대로 tie를 열거나 없애고, slur와 tuplet을 줄이며, `idMap`을 돌려준다. `ops.replaceRegion`(fixture의 3–4마디)은 다음을 모두 만족한다.
  - 구간 밖 모든 엔티티의 ID 집합이 전후로 같다.
  - 새 ID는 모두 이전 `nextId` 이상이다.
  - 경계 tie가 §12.4대로 처리된다.
  - 결과 그래프가 ERROR 0개다.
  - 경계를 가르는 구간은 E-REGION-BOUNDARY로 거절되고, 입력 그래프는 바뀌지 않는다.

**코퍼스 round-trip**

- **A32.** `python tests/bench/run.py sg-roundtrip`이 exit 0이다. 커밋된 모든 코퍼스 파일(개수 출력)에서 allowlist 밖 파일은 L1(`semantic.classify` = None)을 통과한다.
- **A33.** 같은 명령에서 allowlist 밖 파일은 L1+(inventory 동일)와 L2(그래프 고정점)를 통과한다.
- **A34.** `roundtrip-allowlist.json`은 3개 이하이며, 각 항목에 `reason`과 재현 fixture 경로가 있고, 그 fixture가 테스트에서 같은 차이를 재현한다.
- **A35.** import 보고서는 매핑하지 않은 모든 원소 이름과 개수를 `dropped`에 적는다. `<figured-bass>`, `<print>`, `<credit>`이 든 fixture에서 세 이름이 모두 나온다.

**G0 연속성 (vertical slice)**

- **A36.** 기준 커밋과 G1 최종 커밋 사이에서 다음이 모두 성립한다.
  - `ab --a git:<기준> --b worktree`를 suite core, robust, smoke, replay-public에서 돌려 모두 verdict PASS이고, `semantic changes` 줄이 없다.
  - `tests/scoregraph/tools/ab_identical.py`가 ab-a와 ab-b의 `results.json`에서 **모든 케이스**의 `metrics`와 `predicted.semantic`이 같음을 확인한다 (exit 0).
  - `bench:full`이 case error 0으로 끝난다.
- **A37.** `run.py golden`에서 17개 모두가 `ok` 또는 `SERIALIZATION_ONLY`다. SERIALIZATION_ONLY가 있으면 `BLESS_LOG.md`에 "G1: MusicXML written by the ScoreGraph exporter" 사유의 bless가 있다. SEMANTIC_CHANGE와 STRUCTURAL_CHANGE는 0이다.
- **A38.** `npm run test:bench`가 통과한다. `mutation-check`가 PASS이며, `scoregraph/`의 builder나 exporter에 넣은 새 mutant 3종 이상(`<dot/>` 누락, `<time-modification>` 누락, clef 교체)이 각각 REGRESSION이나 golden STRUCTURAL/SEMANTIC으로 잡힌다.
- **A39.** `run.json`에 `sut_sha256`이 있고, 그 값이 `audio-score.js`와 `scoregraph/*.js` 모두에 의존한다. `resolve_sut('git:HEAD')`가 만든 디렉터리의 `scoregraph/` 파일이 HEAD의 내용과 같다. 이 두 가지를 unit test가 확인한다. mutation-check의 복사본에도 `scoregraph/`가 있다.
- **A40.** golden 입력 17개와 core 553개 케이스에서 `toMusicXml`의 `graph`는 ERROR가 0개다. 확인에는 `notate.js`의 새 옵션 `--emit-graph`(기본 꺼짐. 켜도 `results.json`은 바뀌지 않음) 또는 같은 입력을 쓰는 node 테스트를 쓴다. golden 17개는 `graph`의 canonical 직렬화가 `tests/scoregraph/golden/<key>.sg.json`과 바이트 단위로 같고, WARNING 코드와 개수가 `<key>.issues.json`과 같다.
- **A41.** golden 입력 중 들은 음이 있는 모든 케이스에서 다음이 성립한다.
  - (a) clean 이후 입력 음마다 PerfNote가 정확히 하나 있다. `on`과 `off`는 초를 §6.9 규칙으로 µs로 바꾼 값이고, `vel`은 clean 후의 값이다.
  - (b) tie의 `to`가 아닌 모든 head가 PerfNote 하나 이상에 링크된다.
  - (c) 링크된 PerfNote의 midi가 head의 실음과 같다.
  - (d) `bar` anchor 수는 마디 수 + 1이고, µs는 `tickToSec` 값과 같다.
- **A42.** golden 17개 케이스에서 다음 두 가지가 성립한다.
  - W-TEMPO-MARK-MISMATCH는 박자가 겹박자인 케이스에만, 그리고 그런 케이스 모두에 있다.
  - W-DISPLAY-DURATION 개수는 그 케이스 XML에서 `<duration>` ≠ `<type>`·`<dot>`·`<time-modification>` 값인 `<note>` 수와 같다. 이 수는 Python 검사기가 XML에서 따로 센다.

**앱, 배포, CI, 범위**

- **A43.** 같은 환경에서 G1 최종 커밋의 `npm test` 통과 suite 집합이 기준 커밋의 통과 집합을 포함한다. 두 결과는 실행 로그로 기록한다. 앱 HTML의 diff는 `<script>` 태그 추가 줄뿐이다.
- **A44.** `server.js`의 `BLOCKED`에 `scoregraph`가 없다. `.dockerignore`에 `scoregraph`를 제외하는 규칙이 없다. 서버를 띄운 테스트에서 `GET /scoregraph/index.js`가 200이다.
- **A45.** `.github/workflows/bench.yml`의 gate job이 `npm run test:scoregraph`와 `python tests/bench/run.py sg-roundtrip`을 실행한다. 둘 다 새 의존성 없이(Python stdlib, Node 내장) 오프라인으로 돈다.
- **A46.** `git diff --stat <기준>..HEAD`의 production 경로가 `audio-score.js`, `Piano Coach App.dc.html`(script 태그), `scoregraph/**`, `package.json`(scripts만)뿐이다. `server.js`, `omr-service.js`, Python 파이프라인(`transcribe.py`, `beat_track.py`, `arrange_score.py`, …)은 변경 0이다. `npm run test:scoregraph`는 60초, `sg-roundtrip`은 120초 안에 끝나고, `npm run bench`(core)는 G0 예산인 90초 안에 끝난다 (개발 PC).

---

## 18. Out of Scope

G1에서 **하지 않는다**. 각각 이후 Goal의 일이다.

- 악보 자동 정리 알고리즘, voice 분리 AI, 손 배정 개선, 운지 AI, 페달 AI, engraving 품질 개선 (이슈 19 수정, 자동 임시표, beam 계산 포함)
- 편곡 모델, 전사 개선, OMR 개선
- CURRENT_STATE 이슈 1–19 수정. SG는 이 이슈들을 **표현하고 경고로 드러낼 뿐**이다.
- 드럼 import, export, 렌더링, 재생, 편곡. schema 검증만 한다.
- SongGraph 구현, Arrangement Planner
- 앱 import 경계 교체 (`parseMusicXML`), legacy adapter, 저장 형식 전환, 소비자(렌더러, `PianoScore`, 연습) 전환: G2 이후
- D.C./D.S./Coda 전개, 점진 템포(ramp), 미분음, 기타 TAB 입출력, figured bass, layout과 engraving 정보
- MIDI 파일 import와 export, Python ScoreGraph 라이브러리
- 연주 take와 악보의 자동 정렬 (링크는 schema에만 있다)
- 음별 confidence 복원 (`clean()`이 버리는 것을 되살리는 일)
- UI

---

## 19. Risks

| # | 위험 | 영향 | 완화 |
| --- | --- | --- | --- |
| R1 | `audio-score.js`와 앱 HTML을 다른 세션도 편집한다 | 충돌, 서로의 테스트 깨짐 | 변경은 `buildXml` 호출부의 교체와 새 `buildGraph` 함수뿐이다. 앱은 script 태그 몇 줄이다. 커밋 전에 rebase하고 A36을 다시 확인한다. 자기 파일만 stage한다. |
| R2 | SUT가 여러 파일이 되어 ab와 mutation이 조용히 틀린다 | 품질 판정 오염 | §15.4를 Step 7의 **첫 커밋**으로 한다 (A39). |
| R3 | exporter가 미묘하게 의미를 바꾼다 (divisions, 위치, 방향 배치) | 사용자 가시 회귀 | shadow 비교, ab 전 케이스 동일(A36), 코퍼스 round-trip(A32), mutation(A38) |
| R4 | 구현 중 "이왕이면 고치자"는 범위 확장 (이슈 19, 1) | G1 판정이 흐려진다 | DP6과 §18. 고치고 싶으면 이슈만 기록하고 다음 Goal로 넘긴다. |
| R5 | 모든 `toMusicXml` 호출마다 검증하는 비용 | 느려짐 | O(n log n) 검증, A9·A46 예산 |
| R6 | schema v1이 너무 크거나 틀렸다 | 잦은 migration | 필요한 것만 core에 넣고, 나머지는 예약 항목과 `ext`로 둔다. migration 체인(A13). v1은 G2에서 저장에 쓰기 전까지 굳지 않았다 (§22 U2). |
| R7 | 유리수 overflow (큰 divisions × 특이 템포) | 예외 | 범위 검사, µs 변환은 BigInt, E-RATIONAL |
| R8 | 손으로 쓴 XML parser의 견고성과 보안 | 잘못 읽음, 외부 엔티티 | DOCTYPE과 외부 엔티티를 해석하지 않는다. 미리 정의된 엔티티와 숫자 참조만 받는다. 코퍼스 369개와 malformed fixture로 검사한다. |
| R9 | ID 카운터 충돌 (그래프 합치기) | 중복 ID | 조각 ID 재할당 (§12.4), E-ID-DUPLICATE |
| R10 | 브라우저 캐시 때문에 새 `audio-score.js`와 옛 scoregraph가 섞인다 | 런타임 오류 | 같은 `?v=` 값을 함께 올린다. `audio-score.js`가 `PPPScoreGraph.version`을 확인하고 불일치면 throw한다. |
| R11 | G0 baseline이 다른 SUT 해시로 기록되어 있다 (`559a1f40…` ≠ 이 브랜치 `78bd76e5…`) | 기준 혼동 | 이 세션에서 core PASS와 golden 17/17을 확인했다. Step 0에서 다시 확인하고 기록한다. |
| R12 | 일반화(드럼)가 피아노 경로를 복잡하게 한다 | 느린 구현 | tagged union으로 경로를 분리했다. G1의 perc는 검증만 한다. |
| R13 | 앱의 반복 규칙과 SG unroll이 갈라진다 | 재생 순서 차이 | 앱 규칙을 그대로 옮기고, 코퍼스 전체로 비교한다 (A17). |
| R14 | concert 저장과 MusicXML written `<pitch>` 사이의 변환 오류 | 음높이 오류 | 정확한 음정 이조와 이조 fixture (A19) |
| R15 | `graph`를 반환값에 더하면서 메모리가 늘어난다 (큰 곡, 리뷰 반복) | 브라우저 메모리 | 그래프는 동결된 plain 객체다. 앱은 G1에서 저장하지 않는다. 필요하면 `opts.graph: false`로 끈다. |

---

## 20. Implementation Plan

각 Step은 체크포인트(실행 가능한 확인)로 끝나고, Step 단위로 커밋한다. 자기 파일만 stage한다 (`git add scoregraph/ tests/scoregraph/ …`).

### Step 0 — 시작 점검

1. **사용자 결정 확인**: G0 merge와 로컬 `main`(`d82bb71`) 처리가 끝났는지, G1 구현을 시작해도 되는지 (§22 U1).
2. `pwd`, `git rev-parse --show-toplevel` == `D:/PPP-g1`, 브랜치 `g1-scoregraph`, 작업 트리가 깨끗한지 확인하고 **기준 커밋**을 기록한다.
3. `PPP_BENCH_NODE_MODULES=D:/PPP/node_modules`로 다음을 실행하고 결과를 이 문서 §24(구현 기록)에 적는다.
   - `npm run bench` → PASS
   - `run.py golden` → 17/17
   - `npm run test:bench`
   - `run --suite robust` + `check`, `run --suite replay-public` + `check`
4. `audio-score.js`와 앱 HTML을 다시 읽는다 (행 번호가 바뀌었을 수 있다).

### Step 1 — 라이브러리 뼈대 (A1, A2, A4)

- 파일
  - `scoregraph/index.js`: UMD. Node에서는 형제 파일을 require한다. 브라우저에서는 전역 `PPPScoreGraph`를 조립한다. `version` 상수를 둔다.
  - `scoregraph/rational.js`
  - `scoregraph/schema.js`: shape table, enum, `ENTITY_KINDS`, 기본값, 필드 순서
  - `scoregraph/build.js`: `builder()`. 할당, 불변 동결, `finish()`에서 validate.
- 테스트: `rational.test.js`, `schema.test.js`, `browser-load.test.js`
- 체크포인트: `npm run test:scoregraph` 통과.

### Step 2 — Validator (A5–A9)

- `scoregraph/validate.js`: §13.2의 모든 코드와 `CODES` 목록.
- `tests/scoregraph/fixtures/{valid,invalid}/` + sidecar. 코드마다 fixture를 만든다.
- 체크포인트: 코드 목록과 fixture가 1:1로 대응하는지 테스트가 확인한다.

### Step 3 — 직렬화 (A10–A14)

- `scoregraph/serialize.js`: `serialize`, `parse`, `migrate`, `fingerprint`.
- `determinism.test.js`, `tests/bench/unit/test_scoregraph_interop.py`.

### Step 4 — 시간, 구간, provenance, op (A15–A18, A27–A31)

- `scoregraph/time.js`: 위치, 박, unroll, 템포 맵, 초와 µs, 연주 시간 맵, `resolveSpan`, `spanOf`
- `scoregraph/prov.js`
- `scoregraph/ops.js`: `updateHead`, `removeEvents`, `replaceRegion`
- 반복 fixture와 op 테스트

### Step 5 — MusicXML import (A19–A24 일부, A26, A30, A35)

- `scoregraph/xml.js`: 의존성 없는 최소 XML parser (§R8)
- `scoregraph/musicxml-import.js`: 부록 A의 import 열. 결과는 `{ok, graph, report: {issues, dropped}}`.
- `tests/scoregraph/fixtures/xml/*` (sidecar 포함)

### Step 6 — MusicXML export와 코퍼스 round-trip (A19–A25 완결, A32–A34)

- `scoregraph/musicxml-export.js`: 부록 A의 export 열, XSD 순서, 최소 divisions, "표시 없음은 쓰지 않음".
- bench 쪽 추가
  - `tests/bench/node/sg-roundtrip.js`
  - `tests/bench/pppbench/sg_roundtrip.py`
  - `tests/bench/pppbench/notation_inventory.py`
  - `run.py`의 `sg-roundtrip` 하위 명령과 단위 테스트
- 체크포인트: 코퍼스 전체 L1, L1+, L2. allowlist는 3개 이하다.

### Step 7 — Vertical slice (A36–A44)

1. **bench SUT 식별** (§15.4): 먼저, 별도 커밋으로 한다. A39.
2. `audio-score.js`에 `buildGraph(model, heard)`를 추가한다 (shadow). 모든 golden, core, robust, smoke, replay 입력에서 `export(buildGraph(...))`와 `buildXml(...)`의 G0 semantic projection을 비교하는 도구를 만든다: `tests/scoregraph/tools/shadow_compare.py` 또는 node 스크립트. 차이는 0이어야 한다.
3. Performance 층과 anchor를 채운다 (A41).
4. **flip**: 반환 XML을 SG exporter로 바꾼다. `{xml, stats, graph, graphIssues}`를 반환한다. `opts.legacyWriter`는 한 릴리스 동안 남긴다.
5. SG golden(`tests/scoregraph/golden/`)을 bless한다. A40, A42.
6. 앱 HTML에 script 태그를 넣는다. A43, A44.
7. G0 전체 확인: golden, ab ×4, full, mutation-check(새 mutant 포함). A36–A38.
- 커밋 메시지에 "core usable Δ 0, semantic changes 0"을 적는다.

### Step 8 — CI, 문서, 최종 감사 (A45, A46)

- `bench.yml`에 두 단계를 추가한다.
- 문서
  - `scoregraph/README.md`: API 요약, namespace 등록부
  - `tests/scoregraph/README.md`: 명령
  - CURRENT_STATE 갱신
  - 이 문서 §24 구현 기록
  - ARCHITECTURE와 DECISIONS 상태 갱신 (Proposed → Accepted)
- 범위 감사: A46.

**단계 수: Step 0(점검) + 구현 8단계.** Step 1–4는 production에 닿지 않는다. Step 5–6은 bench에 명령을 더할 뿐이다. production 동작이 바뀔 수 있는 곳은 Step 7 하나다.

---

## 21. Architecture Decisions (tradeoff)

`docs/DECISIONS.md`에 같은 번호로 요약되어 있다.

### D1. 정규화 그래프 vs 계층 트리

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| 계층 트리 (Score → Part → Measure → Staff → Voice → Note, MusicXML과 music21 방식) | 읽기 쉽다. MusicXML과 모양이 같다 | 마디를 넘는 관계(tie, slur, 페달, 잇단음)를 표현하기 어렵다. 마디를 넣고 빼면 경로가 바뀐다. 부분 교체와 참조가 경로에 묶인다 |
| 완전 정규화 (모든 엔티티를 평평한 ID 테이블에) | 참조가 일관되고 찾기가 O(1)이다 | 소유 관계가 흐리다. diff가 읽기 어렵다 |
| **혼합: 얇은 소유 계층 + ID 참조** | 소유는 트리(timeline 공유, part가 자기 것을 가짐), 관계는 ID다. 마디 상대 위치로 편집이 국소적이다. diff가 읽기 쉽다 (마디와 voice별 정렬) | 참조 무결성을 validator가 지켜야 한다 |

**권고: 혼합.** 이유: 편집, 참조, 부분 교체라는 미래 요구가 ID 참조를 요구한다. 사람이 읽고 diff하기 쉬운 것은 소유 계층이다. 둘을 동시에 얻는다.

### D2. 시간 표현

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| quarter float (현재 앱) | 단순하다 | 셋잇단 오차, epsilon, `toFixed` 키 (P3) |
| 고정 tick (예: 960/quarter, 또는 2^6·3^2·5·7) | 정수 산술이다 | 11, 13 잇단음과 중첩이 막힌다. 격자 선택이 schema를 묶는다. 이미 24 tick의 한계를 겪었다 |
| **유리수 (W 단위 문자열)** | 모든 잇단음이 정확하다. Python `Fraction`과 호환된다. 읽기 쉽다 (`"1/12"`) | 연산마다 gcd가 든다 (규모상 무시할 만하다). 범위 검사가 필요하다 |
| 유리수 (quarter 단위) | 앱, G0과 단위가 같다 | 음가가 분수로 바로 읽히지 않는다 (8분 = 1/2). 마디 길이가 박자표와 다르게 보인다 |

**권고: W 단위 유리수 문자열, 메모리에서는 `{n, d}`.** 이유: 정확성, 가독성, 언어 간 호환성이다. 경계에서 ×4 하는 비용은 함수 하나다. 연주 시간은 정수 µs(유리수가 필요 없음), 템포는 유리수 qpm이다.

### D3. Event 상속 vs tagged union

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| 클래스 상속 (`Event ← Note ← PitchedNote`) | OO 다형성 | JSON 직렬화에 클래스 복원이 필요하다. 언어 간 공유가 어렵다. 깊은 계층은 드럼과 기타를 넣을 때 흔들린다 |
| **tagged union (`kind` + 종류별 필드)** | plain JSON이다. 검사가 `kind`로 분기된다. 새 종류 추가가 국소적이다. Python에서도 같다 | 종류별 필드 규칙을 table로 관리해야 한다 |

**권고: tagged union.** Event(`note`/`perc`/`rest`)와 Head(pitched/perc) 두 단이다. Spanner와 Direction도 `type`과 `kind`로 구분한다.

### D4. 가변 클래스 vs 불변 plain data

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| 가변 클래스 (메서드 포함) | 익숙하다 | 제자리 변경과 identity 캐시 문제가 그대로 이어진다 (P11). 직렬화 비용이 든다 |
| **불변 plain data + 순수 함수** | 직렬화가 공짜다. 공유가 안전하다 (렌더러, 연습, 비교). undo와 비교가 쉽다. 결정론적이다 | 변경할 때 복사 비용이 든다 (구조 공유로 줄인다). builder가 필요하다 |

**권고: 불변 plain data.** 생성 후 `Object.freeze`로 깊게 동결한다. 개발과 테스트에서는 항상 동결하고, production에서도 동결한다 (비용이 작다). 변경은 `ops.*`로만 한다.

### D5. TypeScript vs JavaScript

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| TypeScript 소스 + 빌드 | 정적 타입 | 이 저장소에는 빌드 단계가 없다 (단일 HTML, unpkg, 순수 UMD). 의존성과 배포 단계가 는다 |
| JS + JSDoc + `tsc --checkJs` (CI) | 타입 검사가 된다 | `typescript` devDependency가 는다 |
| **JS + JSDoc typedef, 런타임 validator가 강제** | 빌드도 의존성도 없다. 브라우저와 Node에서 같은 파일이다. 저장소 관례(`audio-score.js`)를 따른다 | 정적 타입 검사가 없다 |

**권고: JS + JSDoc.** 불변식 대부분(참조, 시간, 겹침)은 정적 타입이 잡지 못하므로 런타임 validator가 진짜 안전장치다. `tsc --checkJs`는 의존성 정책이 허락하면 나중에 CI에만 더할 수 있다.

### D6. Schema validator 방식

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| JSON Schema + ajv | 표준이다 | 의존성이 는다. 그래프 불변식(참조, 시간, tie 음높이)을 표현하지 못한다 |
| zod (`omr-service.js`가 이미 씀) | 선언적이다 | 브라우저에서 번들이 필요하다. 그래프 불변식에는 refine 코드가 결국 필요하다 |
| **손으로 쓴 validator: 선언적 shape table + 이름 붙은 규칙** | 의존성이 없다. 형태 검사와 의미 검사를 한 번에 한다. 결정론적 issue 목록과 고정 코드를 낸다 | 직접 유지해야 한다 |

**권고: 손으로 쓴 validator.** shape table은 데이터라서 필요하면 나중에 JSON Schema를 **생성**할 수 있다.

### D7. ID 생성

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| UUID / 난수 | 합치기 충돌이 없다 | 비결정적이다 (golden과 테스트가 흔들린다). 길다 |
| 내용 해시 | 결정론적이다 | 편집하면 ID가 바뀐다 (정체성 상실) |
| 경로 ID (`p1/m12/v1/e3`) | 읽기 쉽다 | 마디를 넣고 빼면 바뀐다 |
| **그래프 단조 카운터 + 종류 prefix** | 결정론적이다 (import는 문서 순서). 짧다. 의미가 없어 편집에 안정적이다. 재사용하지 않는다 | 그래프를 합칠 때 재할당이 필요하다 (§12.4) |

**권고: 단조 카운터.**

### D8. 확장 방식

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| 자유 필드 허용 (모르는 필드 무시) | 유연하다 | 오타와 조용한 데이터 손실. 이전 코드가 새 데이터를 버린다 |
| **엄격 schema + `ext.<namespace>` + 버전 올림** | 모르는 필드는 오류다. 실험은 격리된다. 승격 경로가 명확하다 (migration) | 새 core 필드마다 버전을 올려야 한다 |
| 종류별 플러그인 레지스트리 | 강력하다 | G1 규모에 비해 과하다 |

**권고: 엄격 schema + ext.** 악기 어휘(`INSTRUMENT_KINDS`)도 core다. 넓히면 버전을 올린다.

### D9. 직렬화 형식

| 선택안 | 장점 | 단점 |
| --- | --- | --- |
| **JSON (canonical 규칙)** | 어디서나 읽힌다. diff가 된다. 앱, 서버(JSONB), Python과 호환된다 | 크기가 크다 (gzip으로 해결) |
| MessagePack, CBOR | 작다 | diff가 안 된다. 의존성이 는다 |
| MusicXML을 저장 형식으로 | 표준이다 | 연주 층, ID, provenance가 없다. 해석이 흔들린다 (이슈 3). DP1 위반 |
| MEI | 풍부하다 | 연주 층과 PPP 요구(ID 규칙, 검증)에 맞추는 비용이 크다 |

**권고: canonical JSON.** 엔티티 한 줄, schema 순서 키, 유리수 문자열, 정수 시간.

### D10. 추가 결정

| # | 결정 | 이유 | 버린 대안 |
| --- | --- | --- | --- |
| D10a | 음높이는 **concert 철자**로 저장한다 | 분석, 편곡, 악기 간 이동이 한 좌표에서 된다. 이조를 바꿔도 음악 내용이 변하지 않는다 | MusicXML처럼 written으로 저장 |
| D10b | 연주는 **별도 Performance 층 + head 링크**로 둔다 | take를 여러 개 둘 수 있다. 원 녹음과 학생 연주를 같은 구조로 다룬다. 악보 필드가 오염되지 않는다 | head 안에 `performed {on, off, vel}` |
| D10c | 첫 경계는 **`toMusicXml` writer**다 | §15.3 | 앱 import, 저장 형식 |
| D10d | parity는 **의미 동일성**(G0 projection, 전 케이스 metric)으로 정한다 | writer가 XSD 순서를 어긴다. G0 golden의 SERIALIZATION_ONLY 정책 | 바이트 동일성 |
| D10e | 반복 전개 규칙은 **앱 규칙**(G0 `app_play_order`)을 따른다 | 재생 순서가 바뀌면 사용자 가시 회귀다. 코퍼스 전체로 비교할 수 있다 | 교과서 규칙 |
| D10f | 결함 입력을 **충실히 담고 WARNING**을 낸다 | round-trip과 parity, 이후 Goal의 측정 | import에서 고치기 |

---

## 22. 사용자 결정이 필요한 사항

- **U1. G1 구현 시작 시점.**
  - CURRENT_STATE "Next"는 "G0 merge와 로컬 `main` `d82bb71` 처리 전에는 G1을 시작하지 말라"고 한다.
  - 이 브랜치(`g1-scoregraph`)는 이미 G0 커밋(`aff7080`)을 포함하며, core PASS와 golden 17/17을 확인했다.
  - 구현 세션을 지금 시작할지, G0이 `main`에 merge된 뒤 그 위로 rebase해 시작할지 사용자가 정한다.
  - 설계는 어느 쪽이든 같다. **이것이 유일한 차단 결정이다.**
- **U2 (비차단, 권고로 확정).** schema v1은 G2가 사용자 데이터를 저장하기 전까지는 버전을 올리지 않고도 고칠 수 있다. 첫 저장부터는 migration 규칙(§14.4)이 강제된다.
- **U3 (비차단, G2 이후).** 6/4 같은 박 묶음 기본값(§6.4)이 앱과 다르다. 소비자를 SG로 옮기는 Goal에서 parity를 택할지 표준을 택할지 정한다.

---

## 23. 조사 중 발견한 이슈 (고치지 않음)

이 세션은 코드를 바꾸지 않았다. 아래는 조사 중 읽은 코드에서 확인한 것이다. F2, F3은 실행으로 재현하지 않았다.

| # | 내용 | 근거 | 해당 Goal |
| --- | --- | --- | --- |
| F1 | G00 §1.2는 audio beat를 "beatConfidence ≥ 0.42"로 거른다고 적는다. 그러나 `audio-score.js`는 `beatConfidence`를 전혀 읽지 않고, 앱도 넘기지 않는다. | audio-score.js 전체 (검색 0건), App 7090–7094 | 문서 정정 (G0 문서) |
| F2 | `quantize`는 `k = floor(pos + 1e-9)`를 쓰는데 `snapStraight`/`snapTriplet`은 `floor(pos)`를 쓴다. `pos`가 정수보다 1e-9 이내로 작으면 음이 한 박 늦게 적힐 수 있다. | audio-score.js L601 vs L503, L536 | 리듬 Goal |
| F3 | `ScoreArranger.fromEngine`은 원곡의 `ottavas`를 유지한다. 그런데 Python이 만든 음은 `soundingMidi`가 없어서 `Score.finalize`가 8va를 다시 적용할 수 있다 (옥타브 이중 이동). | App 8988–9008, 3557–3564 | 편곡 Goal / G2 |
| F4 | README 489–490행은 "한 staff짜리 part 둘이면 오른손·왼손"이라고 한다. 코드는 마지막 part를 `r`, 첫 part를 `x`로 둔다 (bench parity test가 이를 확인한다). | App 4287–4298, `test_parity_rules.py` 118–126 | 문서 정정, 이슈 11 |
| F5 | 편곡 수준별 음 수 상한이 브라우저 `LEVEL_CAP`과 `arrange_score.py`에서 다르다. | App 8794, arrange_score.py 738 | 편곡 Goal |
| F6 | Follow 모드의 쉼표 gate는 템포 맵을 무시하고 고정 `S.tempo`를 쓴다. | App 13269, 13289 | 연습 Goal |
| F7 | G0 baseline 파일의 `audio_score_sha256`(`559a1f40…`, `718bdf3`의 파일)이 이 브랜치의 `audio-score.js`(`78bd76e5…`)와 다르다. `718bdf3`은 이 브랜치의 조상이 아니다. 결과는 재현된다 (이 세션: core PASS, golden 17/17). | `baselines/core.json`, `git merge-base` | G1 Step 0 기록 |
| F8 | `PianoScore.of`는 score 객체 identity로 캐시한다. `PdfLayer.apply` 같은 제자리 변경은 캐시를 무효화하지 않는다. | App 2566–2579, 9986–10284 | G2 (불변 그래프가 해결) |
| F9 | `parseMusicXML`은 셈여림, 템포, `sound`를 **모든 part**에서 읽는다. 그래서 여러 part 파일에서 같은 표기가 중복된다. | App 4076–4120 | G2 |

---

## 24. 구현 기록 (G1 Implementer, 2026-09-23)

### 24.1 판정

**COMPLETE** — 브랜치 `g1-scoregraph`(최종 커밋은 이 기록을 담은 커밋), 기준 커밋 `aff7080`. production switch(Step 7 flip)를 했다. 전환 조건 여섯 가지가 모두 성립했다: G0 core PASS, golden semantics PASS(17 SERIALIZATION_ONLY, 의미 변화 0), A/B 의미 차이 0(core·robust·smoke·replay-public 케이스별 동일), validator PASS(golden 17, core 553, full 4,976 그래프 ERROR 0), 결정론(두 프로세스 바이트 동일), 되돌리기 경로(`opts.legacyWriter`).

| 커밋 | 내용 |
| --- | --- |
| `cce3366` | 설계 문서 (G01, ARCHITECTURE, DECISIONS) |
| `0fda0fe` | bench SUT = `audio-score.js` + `scoregraph/**` 스냅샷 (A39, Step 7.1을 먼저) |
| `d71343b` | `scoregraph/` 라이브러리, validator, canonical JSON, MusicXML import/export, node 테스트와 fixture |
| `db21e88` | `sg-roundtrip` (코퍼스 369개 파일) |
| `bf02544` | shadow: `buildGraph`를 `buildXml` 옆에 (production 불변, golden 17/17 identical) |
| `a2e8907` | **flip**: MusicXML을 ScoreGraph exporter가 쓴다. golden bless, mutation 재고정과 새 mutant 3종, SG golden, vertical-slice·server 테스트, 앱 script 태그 |
| `ecf6e3d` | `ab`가 fixture suite를 돌린다. `ab_identical.py` |
| `6833c31` | CI gate에 `test:scoregraph`, `sg-roundtrip` |
| `63dbb3f` | script 태그 `?v=8` (앱 HTML diff = script 태그 추가 13줄) |
| `8bc0cb8` | 리뷰 대조군 SR-PRINTED-TEMPO-MIDWAY를 G0 edit처럼 템포 event 둘로 (§24.3) |
| `647be56` | `tests/transcription.test.js`: MusicXML 바이트에 기대던 검사 하나를 파일의 divisions로 읽는다 |
| `1c891f6` | bench 단위 테스트 셋: SUT 파일을 텍스트로 고치던 곳을 파일의 divisions로 |
| (이 기록) | 이 기록, CURRENT_STATE, ARCHITECTURE, DECISIONS, README |

### 24.2 Acceptance (A1–A46)

PASS는 아래 테스트나 명령이 실제로 통과했다는 뜻이다. 모든 node 테스트는 `npm run test:scoregraph`, Python 테스트는 `npm run test:bench`의 unittest에 들어 있다.

| # | 결과 | 근거 (테스트 / 명령) |
| --- | --- | --- |
| A1 | PASS | `browser-load.test.js`: require 적재, bare `vm` 컨텍스트에서 `PPPScoreGraph`, `package.json` 의존성이 `aff7080`과 바이트 동일 |
| A2 | PASS | `rational.test.js`: 정규화·사칙·비교·파싱·overflow, LCG 10,000쌍 |
| A3 | PASS | `musicxml.test.js`(tuplets-nested dur·멤버 합), `serialize.test.js`(소수점 정규식) |
| A4 | PASS | `schema.test.js`: `ENTITY_KINDS` 21개와 prefix |
| A5 | PASS | `validate.test.js`: ERROR 31종 모두 `fixtures/invalid/`(40개)에, 각각 sidecar와 같은 ERROR 집합 |
| A6 | PASS | `validate.test.js`: WARNING 14종 모두 `warn-*` fixture |
| A7 | PASS | `validate.test.js`: `fixtures/valid/` 34개, ERROR 0, sidecar와 같은 WARNING 집합 |
| A8 | PASS | `validate.test.js`: 세 번 검증, 배열을 섞어 parse해도 issue 목록 동일 |
| A9 | PASS | `validate.test.js`: 2,000마디·40,000 head·tie·slur, 5초 이내 (로컬 0.73 s) |
| A10 | PASS | `serialize.test.js`: 커밋된 모든 `.sg.json`(SG golden 17개 포함) `serialize(parse(s)) === s`, 테스트 중 그래프 왕복 |
| A11 | PASS | `determinism.test.js`, `vertical-slice.test.js`(두 프로세스, 키 순서 섞기, LF·끝 줄바꿈 하나·BOM 없음) |
| A12 | PASS | `serialize.test.js`: canonical lint |
| A13 | PASS | `serialize.test.js`: 버전 없음·2는 E-VERSION, 테스트 migration v0→v1 체인과 ID 보존 |
| A14 | PASS | `unit/test_scoregraph_interop.py`: `json`과 `Fraction`만으로 읽기, 마디 길이·마디별 내용 |
| A15 | PASS | `time.test.js`: 12개 위치의 `seconds`·`micros`(20/3 s → 6,666,667 µs), `meterAt`, `keyAt` |
| A16 | PASS | `time.test.js`: pickup-3-4 (`1/4, 3/4, …, 1/2`, 3박째, W-MEASURE-LENGTH 유무) |
| A17 | PASS | `time.test.js`(반복 fixture 6개) + `sg-roundtrip` 재생 순서 369/369 |
| A18 | PASS | `time.test.js`: `fromUs(toUs(p))` 100점 1µs 이내, 순증가 아닌 anchor E-PERF |
| A19 | PASS | `musicxml.test.js`: C03, C04, transposing |
| A20 | PASS | `musicxml.test.js`: C10, C11 (concert 그대로, shift ±1, 표시 옥타브) |
| A21 | PASS | `musicxml.test.js` + `unit/test_scoregraph_roundtrip.py` (C12, voices-4, grand-staff, cross-staff) |
| A22 | PASS | `musicxml.test.js` + `unit/test_scoregraph_roundtrip.py`: 코퍼스 **369개 전체**에서 W-TIE-OPEN = 원문의 짝 없는 `<tie>` 수 (설계는 11개 파일) |
| A23 | PASS | `musicxml.test.js`: C07 grace (`dur "0"`, order, slash), L2, projection 불변 |
| A24 | PASS | `musicxml.test.js`: piano-marks (limbOf, 상속 순서, 페달·운지·arpeggio) |
| A25 | PASS | `musicxml.test.js`: `valid/drums-with-piano.sg.json` |
| A26 | PASS | `musicxml.test.js`: IMPORT-UNSUPPORTED-UNPITCHED, EXPORT-UNSUPPORTED-PERC |
| A27 | PASS | `time.test.js`: `resolveSpan`/`spanOf`, 주석 밖 `songgraph` 0건 |
| A28 | PASS | `prov.test.js`(6조합, import source 1개) + `vertical-slice.test.js`(`toMusicXml` 그래프: `audio-score` source, 기본 `op: inferred`, 엔티티별 prov 0) |
| A29 | PASS | `prov.test.js`: I-PROV-REDUNDANT |
| A30 | PASS | `determinism.test.js`: 두 프로세스 import 바이트 동일 |
| A31 | PASS | `ops.test.js`: updateHead, removeEvents, replaceRegion(3–4마디), E-REGION-BOUNDARY |
| A32 | PASS | `sg-roundtrip`: 369개 파일, allowlist 밖 367개 L1 통과, exit 0 (18.7 s) |
| A33 | PASS | 같은 명령: 367개 L1+·L2 통과 |
| A34 | PASS | allowlist 2개(burgmuller25/016 ENDING-STOP-WITHOUT-START, sonatina/014 WEDGE-UNPAIRED), 각 재현 fixture가 같은 차이를 낸다 |
| A35 | PASS | `musicxml.test.js`: `dropped`에 figured-bass, print, credit |
| A36 | PASS | `ab --a git:aff7080 --b worktree`: core 553, robust 282, smoke 44, replay-public 6 모두 PASS, `semantic changes` 줄 없음. `ab_identical.py` 네 suite 케이스별 동일 (exit 0). `bench:full` 4,976 cases, case error 0. `ab --suite full`(4,976)도 PASS, 케이스별 동일. |
| A37 | PASS | `run.py golden`: 17개 SERIALIZATION_ONLY, `BLESS_LOG.md`에 "G1: MusicXML written by the ScoreGraph exporter". SEMANTIC·STRUCTURAL 0. bless 뒤 17/17 identical |
| A38 | PASS | `npm run test:bench` 통과. `mutation-check` PASS: 해로운 mutant 40개 모두 자기 metric의 REGRESSION, no-op 동일. 새 exporter mutant 3종(SG-EXPORT-NO-DOT, SG-EXPORT-NO-TIME-MODIFICATION, SG-EXPORT-CLEF-SWAP) 포함 |
| A39 | PASS | `unit/test_sut_snapshot.py` (sut_sha256, `git:HEAD` 스냅샷, mutant 사본의 `scoregraph/`) |
| A40 | PASS | `vertical-slice.test.js`: golden 17개 ERROR 0, canonical 바이트 = `tests/scoregraph/golden/<key>.sg.json`, WARNING·INFO 개수 = `<key>.issues.json`. core 553: `graph_check.py --suite core`(`notate.js --emit-graph`, results 불변) ERROR 0 |
| A41 | PASS (d는 §24.3 편차) | `vertical-slice.test.js`: 들은 음이 있는 16개 케이스(G14는 grid 입력). (a) clean 후 음마다 PerfNote 하나, µs는 §6.10을 테스트 안에서 따로 계산 (b) tie `to`가 아닌 head 모두 링크 (c) 링크 midi = head 실음 (d) 녹음 안의 마디선마다 anchor, `stats.barStarts`와 0.5 ms 이내 |
| A42 | PASS | (a) `vertical-slice.test.js`: W-TEMPO-MARK-MISMATCH는 겹박자 4개 케이스에만 하나씩 (b) `unit/test_scoregraph_vertical.py`: golden MusicXML에서 따로 센 수 = W-DISPLAY-DURATION (합 1, G03) |
| A43 | PASS | `npm test` 26개 suite를 하나씩: 기준 `aff7080` 25/26, G1 25/26, 같은 집합 (같은 PC, 같은 `node_modules`, 서버 8777). 둘 다 실패하는 `transcription.test.js`는 양쪽 모두 `tools/` venv의 console script 검사 하나로만 실패한다(환경). `PPP_TRANSCRIBE_PYTHON`으로 venv를 주면 녹음 → 악보 UI 경로가 양쪽에서 같게 통과한다 (G1 3회, 기준 2회). G1 첫 실행에서 "rich style" 검사가 한 번 실패했으나(900 ms `sleep` 뒤의 상태 확인) 다시 나지 않았고, 같은 경로를 페이지에서 직접 돌리면 두 writer 모두 같은 결과다. MusicXML 바이트에 기대던 검사 하나는 고쳤다(`647be56`). 앱 HTML diff = `scoregraph/` script 태그 추가 13줄뿐(`vertical-slice.test.js`가 `aff7080`과 비교). 브라우저 경로는 `vertical-slice.test.js`가 `vm`에서 앱의 script 순서대로 적재해 Node와 같은 XML을 확인 |
| A44 | PASS | `server.test.js`: `BLOCKED`에 scoregraph 없음, `.dockerignore` 규칙 없음, `COPY . .`, 띄운 서버에서 `GET /scoregraph/<13개>.js` 200과 같은 내용 |
| A45 | PASS (설정) | `bench.yml` gate job에 두 단계, `fetch-depth: 0`(A1의 `aff7080` 비교). GitHub에서는 아직 돌지 않았다 (PR이 없다) |
| A46 | PASS | production 경로 diff: `audio-score.js`, `Piano Coach App.dc.html`(script 13줄), `scoregraph/**`, `package.json`(`test:scoregraph` 한 줄). 그 밖에 `.gitignore`(`tests/scoregraph/tools/` 추적). `server.js`, `omr-service.js`, Python 파이프라인 변경 0. 시간: `test:scoregraph` 2.8 s (≤60), `sg-roundtrip` 18.7 s (≤120), `npm run bench` 24.3 s (≤90) |

### 24.3 설계와 다르게 하거나 설계가 열어 둔 것을 정한 점

- **자동 fallback 없음 (G1-D13).** ScoreGraph 경로의 오류(빌드 ERROR, export 거절, 버전 불일치)는 `toMusicXml`에서 throw한다. 앱의 호출부는 모두 try/catch로 오류를 보여 준다. 몰래 `buildXml`로 되돌아가면 mutant와 회귀가 bench에서 숨는다. bench 입력 5,878개에서 throw 0건.
- **`buildXml`의 결함을 그대로 옮겼다 (G1-D14).** 이슈 1 → W-TEMPO-MARK-MISMATCH, 이슈 19 → W-DISPLAY-DURATION. 추가로 발견: `buildXml`은 셋잇단 **조각마다** 괄호를 따로 연다(한 음짜리 괄호). 그래프는 조각마다 Tuplet 하나로 이것을 담고 W-TUPLET-INCOMPLETE를 낸다 (golden G03 47개, core 8,144개). 고치는 것은 G3.
- **A41 (d) anchor (G1-D15).** 설계는 "anchor 수 = 마디 수 + 1"이다. 그러나 µs는 0 이상이다(§6.10, E-PERF). 녹음 시작 전에 놓인 마디선(`tickToSec` < 0: golden G03, G06, G09에서 첫 마디선 하나씩, core 553개 중 33개)에는 anchor를 두지 않는다. 테스트는 녹음 안의 마디선마다 anchor가 있고 앞의 것에는 없음을 확인한다. 같은 이유로 grid 입력의 잘못된 시각(NaN, 음수, `off ≤ on`)은 PerfNote가 되지 않는다.
- **mutation 재고정 (G1-D16).** flip 뒤 `buildXml`은 기본 경로가 아니므로, 그것을 겨냥한 G0 mutant는 아무것도 바꾸지 못한다. 같은 결함을 `buildGraph`에 만들도록 다시 고정했다 (`pppbench/mutation.py`의 `SG_*`; 템포·박자·조표·점·음표 종류·마디 번호·음자리표·쉼표·임시표·반복 기호·implicit·가짜 분할). `<staves>` 누락은 exporter에 둔다. 가짜 분할(SR-FAKE-SPLIT-BAR, PF-FORWARD-REPEAT-ONLY-EXCUSE)은 export 직전 그래프 변환으로 같은 파일을 만든다. 리뷰 스크립트(`adversarial.py`, `final_review.py`, `short_review.py`)도 같은 edit를 쓴다. 기대 결과와 metric은 하나도 바꾸지 않았다.
- **`ab`와 fixture suite (G1-D18).** G0의 `ab`는 합성 suite만 돌렸다. A36이 replay-public을 요구하므로 fixture suite는 그 suite의 runner로 양쪽을 돌리게 했다.
- **A42 (b) 세는 단위.** W-DISPLAY-DURATION은 event마다 하나다. XML 검사기는 `<chord/>` 음을 다시 세지 않는다 (화음 = event 하나). grace는 duration이 없다.
- **script 태그 `?v=8`.** R10은 "같은 `?v=` 값을 함께 올린다"고 한다. `server.js`는 `.js`를 `Cache-Control: no-store`로 보내므로 브라우저에 옛 `audio-score.js`가 남지 않고, 버전 확인이 불일치를 막는다. 그래서 `audio-score.js` 태그는 그대로 두고 새 태그에 같은 `?v=8`을 붙였다 (A43: diff는 추가 줄뿐).
- **MusicXML 바이트에 기대던 테스트.** G0 단위 테스트 셋(`test_degradation`, `test_golden_mutation`, `test_review_fixes`)과 앱 테스트 하나(`transcription.test.js`)는 `toMusicXml` 출력을 divisions 24를 가정한 텍스트로 고치거나 찾았다. exporter는 가장 작은 divisions를 쓰므로 하나는 실패했고 둘은 뜻이 약해진 채 통과했다. 모두 파일의 `<divisions>`를 읽도록 고쳤다 (검사하는 뜻은 같다). flip 직후 단위 테스트 전체를 돌리지 않아 늦게 찾았다.
- **`opts.legacyWriter`의 반환값**은 `{xml, stats}`다 (graph 없음). 라이브러리를 적재하지 않는다 (테스트가 `require.cache`로 확인). 라이브러리에 문제가 생겨도 되돌릴 수 있게 하기 위해서다.
- 라이브러리 구현 중 정한 점(chord symbol `chordKind`, grace만 `at == dur` 허용 밖, 빈 객체 유지, Tie = `<tie>`, import ID 순서, `ext.musicxml.beam`, `W-IMPORT-*` 보고 코드, inventory 정규화)은 `scoregraph/README.md`와 `tests/bench/pppbench/notation_inventory.py` docstring에 있다 (G1-D17).

### 24.4 측정

| | 값 |
| --- | --- |
| shadow 비교 (`shadow_compare.py`: legacy 파일과 SG 파일을 G0 reader로 읽은 canonical score 전체) | golden 17, smoke 44, robust 282, replay-public 6, core 553, full 4,976: **5,878/5,878 동일** |
| 앱의 실제 `parseMusicXML` (브라우저 페이지, puppeteer) | golden 17개 입력에서 두 writer 파일이 만드는 legacy `Score` 객체가 **17/17 동일** (`id`의 시각 제외). 편곡 경로(`lock` + `arrangeWithService`, jazz)도 두 writer에서 같은 결과 |
| `test:scoregraph` · `test:bench` | 71/71 · 단위 221 OK, golden 17/17, correctness 13/13 |
| 그래프 WARNING (core 553) | W-DISPLAY-DURATION 2,647, W-TEMPO-MARK-MISMATCH 189, W-TUPLET-INCOMPLETE 8,144 (모두 writer의 기존 결함, §24.3) |
| `notate` 시간 (core 553) | `aff7080` 2.4 s → G1 7.8 s (케이스당 약 10 ms 늘어남: 빌드, 검증, export) |
| `check --suite full` (저장된 baseline 대비) | REGRESSION 12, 개선 20. **G1 이전부터다**: baseline은 `559a1f40…`(G0 브랜치)의 `audio-score.js`로 기록됐고, `aff7080`에는 `e0d8b23`·`72549cb`가 바꾼 `audio-score.js`(`78bd76e5…`)가 있다 (§23 F7). `ab --suite full`의 양쪽(`aff7080`, G1) 결과를 저장된 baseline과 비교하면 **둘 다** REGRESSION이다. G1과 무관함을 확인했다. |

### 24.5 리뷰어가 볼 위험

- **예외 경로가 새로 생겼다.** 전에는 `buildXml`이 무엇이든 문자열을 냈다. 이제 그래프 ERROR는 throw한다. bench 입력 5,878개에서 0건이지만 실제 녹음의 드문 입력은 모른다. 되돌리기는 `opts.legacyWriter`(앱 호출부 한 줄) 또는 revert다.
- **출력 바이트가 바뀌었다.** MusicXML 4.0, 최소 divisions, XSD 순서다. G0 reader로는 bench 입력 5,878개 모두 같은 음악이고, 앱의 실제 `parseMusicXML`로는 golden 17개(같은 `Score`)와 `npm test`(A43)를 확인했다. conformance 티어(T1)는 이번에 돌리지 않았다. 외부 도구로 내보내는 경로가 있다면 한 번 열어 볼 것.
- **mutation과 리뷰 스크립트를 다시 고정했다.** 뜻은 같게 했지만(같은 결함, 같은 기대), G0 리뷰어가 쓴 edit 문자열 자체는 바뀌었다. mutation-check는 PASS다. 리뷰 스크립트 결과: `adversarial.py` 모든 항목 OK, `final_review.py` 10/10, `final_oracle.py` OK, `short_review.py` 11/11. 단, SR-PRINTED-TEMPO-MIDWAY(대조군)는 처음 재고정에서 메트로놈 표시와 `<sound>`를 한 `<direction>`으로 합쳐 뜻이 달라졌다(앱 플레이어가 반 속도로 재생). 원래처럼 템포 event 둘로 고쳤다(`8bc0cb8`). FINAL-TOP-REGISTER-OCTAVE-DOWN은 이제 일부 케이스에서 오류(case:error)도 낸다: 한 옥타브 내린 음이 같은 화음의 음과 같은 음높이가 되면(예: B5와 B6 → B5 둘) validator가 E-HEADS로 그래프를 거절하기 때문이다 (core 7케이스). 목표 metric은 여전히 잡힌다.
- **녹음 UI 테스트의 고정 `sleep`.** `transcription.test.js`의 "rich style" 검사는 편곡 서비스 호출 뒤 900 ms만 기다린다. G1 첫 실행에서 한 번 실패했고 다시 나지 않았다. `toMusicXml`이 케이스당 약 10 ms 느려진 만큼 여유가 준다.
- **full baseline 불일치(F7)** 는 G1과 무관하지만, nightly의 `check --suite full`은 G1 이전부터 실패한다. rebaseline은 사용자 결정이다.
- **`buildXml`은 한 릴리스 뒤 G2에서 지운다** (§15.3). 그때 legacy 경로 테스트와 shadow 도구도 정리한다.

---

## 25. 독립 리뷰 (Independent Review, 2026-09-23)

| 항목 | 값 |
| --- | --- |
| 판정 | **READY_TO_PR** — BLOCKER 0, MAJOR 0, MINOR 5, OPTIONAL 3 |
| 대상 | 브랜치 `g1-scoregraph`, 커밋 `d65d81f` (기준 `aff7080` = `origin/main`) |
| 방법 | 구현 기록(§24)의 수치를 믿지 않고 리뷰어가 자기 도구로 다시 측정했다. 코드는 고치지 않았다 (이 절만 추가). |

### 25.1 리뷰가 쓴 도구 (구현자의 도구와 겹치지 않는다)

G0 reader, ScoreGraph 라이브러리, 구현자의 `shadow_compare.py`를 **쓰지 않는다**. reader와 writer가 같은 결함을 공유하면 차이가 숨기 때문이다.

- **음악 모델 비교**: MusicXML을 `xml.etree`로 직접 읽어 음높이·시작 위치·길이·성부·보표·박자·조표·템포·마디 번호·implicit·반복·volta·임시표·페달(offset 반영)·tie·잇단음 괄호·clef·staves를 뽑아 두 writer의 파일을 비교한다. divisions, `<offset>`, 요소 순서, MusicXML 버전, `<identification>`만 정규화한다.
- **도구의 민감도 자체 검증**: 한 번에 하나씩 24종을 일부러 틀리게 만들어(음높이, 옥타브, 길이, 시작 위치, 음표 종류, 점, time-modification, 성부, 보표, staves, clef, 박자, 조표, 템포, 메트로놈, tie, tied, 마디 번호, implicit, 마디 삭제, 반복, volta, 페달 삭제/이동, 화음 해체, 음표/쉼표 삭제) 전부 감지되는 것을 확인한 뒤에 썼다.
- **경계 입력**: 손으로 만든 36개(빈 입력, 중복 온셋, 음역 밖, vel 0/200/null, 10음 클러스터, 30초 음, 32분음 연속, 한 손 전부, 삼연음, 잘못된 페달, 뒤섞인 beats, 못갖춘 시작, lock 5/4·7/8·6/8·12/8·bpm 30/240, 편곡, 600음, grid 6종)과 시드 fuzz 400개.
- **SUT 폐쇄성**: 리뷰어가 직접 만든 ScoreGraph exporter 결함 3종(`<alter>` 부호 반전, 마디 번호 +1, 보표 1↔2 교체)을 스냅샷 사본에 심어 벤치가 잡는지 본다.
- **mutation 재고정**: 재고정된 23종을 각각 심어 파일이 실제로 어떻게 달라지는지 본다.
- **F7**: full suite를 기준 커밋의 SUT와 작업 트리 SUT로 각각 돌려 저장된 baseline과 비교한다.

### 25.2 항목별 결과

| # | 리뷰 항목 | 결과 | 근거 |
| --- | --- | --- | --- |
| §2 | production flip의 음악적 동일성 | **VERIFIED** (잇단음 괄호 1건 제외, F1) | 리뷰 도구로 golden 17 · smoke 44 · replay-public 6 · core 553 · robust 282 · full 4,976 = **5,878 케이스**를 비교했다. 음높이·시작·길이·박자·템포·조표·보표·손·성부·마디 구조·반복/volta·임시표·페달·tie: **전부 동일**. `stats`도 전 케이스 동일. 잇단음 괄호만 358 케이스에서 다르다 (F1) |
| §3 | ERROR → throw 경로 | **VERIFIED** (F2 제외) | 5,878 + 436(경계·fuzz) 케이스에서 그래프 ERROR 0, 한쪽만 실패 1건(F2). ERROR는 `finish()`에서 throw하므로 "throw 0건 = ERROR 0건"이다. 정상 입력에서 false-positive 없음. `legacyWriter`는 모든 비교에서 옛 파일을 냈고 라이브러리를 적재하지 않는다 |
| §4 | 표현 검증 | **VERIFIED** | 동작으로 확인: 템포를 2배로 해도 기보 위치·길이 불변, 울리는 시각만 절반 · anchor를 1초 옮겨도 기보 불변, 연주 시간 맵만 이동 · 재생 순서는 저장되지 않고 `unroll`이 만든다 · 화음 = head 여럿인 event 하나 · head는 철자만 저장하고 MIDI는 파생 · 손은 staff→voice→head 상속 · `updateHead`가 ID 유지·`rev`+1·원본 불변 · 8va는 ottava spanner이고 표시 옥타브는 파생 · 커밋된 `.sg.json` 52개 전부 `serialize(parse(s)) === s` · `scoregraph_version: 2`는 E-VERSION. 기보(유리수)와 연주(µs)가 만나는 곳은 `time.js`, `validate.js`, `audio-score.js`의 변환 지점뿐이다 |
| §5 | piano/drum 확장성 | **VERIFIED** | 피아노는 **part 하나 + staff 둘(limb RH/LH)** 이다 (손별 part 아님). `drums-with-piano` fixture는 피아노와 drumset이 timeline을 공유하고 limb 4종(RH/LH/RF/LF)을 쓰며 ERROR 0으로 검증된다. instrument kind에 keyboard/percussion/plucked(기타·베이스)가 있다. G1은 percussion을 export에서 명시적으로 거절한다(설계대로) |
| §6 | 코퍼스 round-trip 369 | **VERIFIED** (F3 제외) | 369개 중 367개가 L1·L1+·L2·재생 순서를 통과, 2개는 allowlist. allowlist 2건을 원본 파일까지 열어 확인했다 (아래) |
| §7 | benchmark SUT 확장 | **VERIFIED** | SUT 스냅샷 = 14개 파일(`audio-score.js` + scoregraph 13). 리뷰어가 심은 exporter 결함 3종이 **전부** 잡혔다: golden이 SEMANTIC/STRUCTURAL(12·18·18건), smoke gate가 REGRESSION. scoregraph가 SUT 밖이었다면 사본이 작업 트리 라이브러리를 계속 써서 통과했을 것이다 |
| §8 | mutation 재고정 | **VERIFIED** | 재고정·신규 23종을 심어 파일 차이를 직접 봤다: 전부 이름 그대로의 음악 결함을 만든다(템포 제거, 박자 2배, 조표/박자 꼬리 변경, 점 제거, 음표 종류 단축, 마디 번호 restart/skip/swap, 저음보 높은음자리표, 꼬리 쉼표 단축, 쉼표 종류 연장, 임시표 전부/제거, 반복 기호, implicit, `<staves>` 제거, 가짜 분할(마디 16→17), alto clef, 마지막 두 마디 조표, exporter 3종). `SR-PRINTED-TEMPO-MIDWAY`(대조군)은 고쳐진 형태가 맞다: **소리 없는** 메트로놈 표시(48)와 **원래 템포(95)를 가진 별도 `<sound>`** 두 지시로 나온다 |
| §9 | A/B 결과 | **VERIFIED** | 리뷰어가 `ab --a git:aff7080 --b worktree`를 다시 돌렸다. side a는 파일 1개(scoregraph 0), side b는 14개 — 각자 자기 라이브러리를 쓴다(작업 트리 공유 아님). `ab_identical` 44/44 동일. 다만 A/B는 양쪽을 같은 reader로 읽으므로 reader가 안 읽는 것은 못 본다 — F1이 그 경로로 빠져나갔다. 리뷰의 독립 비교가 그 구멍을 메운다 |
| §10 | full baseline F7 | **pre-existing (A)** | full suite를 **기준 커밋 SUT**와 **작업 트리 SUT**로 각각 돌렸다: usable 0.2013 / sqi 79.671로 **완전히 같고**, baseline 대비 실패하는 gate 줄도 **32개로 동일**(한쪽에만 있는 줄 0). G1이 악화시킨 것이 아니다. rebaseline은 하지 않았다 |
| §11 | 잇단음 warning | **기존 결함 + 새 변화 1건** | W-TUPLET-INCOMPLETE(core 8,144)는 `buildXml`이 원래 조각마다 괄호를 여는 것을 정직하게 보고한 것이다. 다만 **쪼개진 잇단음에서 괄호 묶음이 바뀐다**(F1) |
| §12 | 성능 | **VERIFIED, 문제 없음** | 같은 입력에서 legacy 대 ScoreGraph: 100음 7.3→19.4 ms, 400음 19→43 ms, 1,600음 72→256 ms, 3,200음(1,007마디) 142→634 ms. golden 17개 평균 +2.4 ms/케이스. 전사 1회당 한 번 드는 비용이고 AMT 자체가 수 초다 |
| §13–14 | 테스트 | **모두 통과** | §25.4 |
| §15 | scope | **VERIFIED** | `origin/main..HEAD` 305 파일: tests 282, scoregraph 14, docs 4, 앱 HTML 1(script 13줄), `package.json` 1(script 한 줄), `audio-score.js` 1, `.gitignore` 1, CI 1. `tmp/`·`__pycache__`·catalog·OMR·transcription·`server.js`·Python 파이프라인 변경 **0** |

**allowlist 2건 (§6)**

- `catalog/method/burgmuller25/016.mxl` — 원본을 열어 보면 ending 괄호가 마디마다 **두 번씩** 적혀 있고(8·17·18마디는 start/stop이 각각 두 벌), 9마디만 두 번째 stop이 없으며 16마디에 짝 없는 stop이 하나 떠 있다. 즉 **원본 결함**이다. import는 그 떠 있는 stop을 `dropped`에 보고하고 버린다. 재생 순서는 그대로다(`sg-roundtrip`의 play_order 369/369). **정당하다.**
- `catalog/method/sonatina/014.mxl` — 60마디에 crescendo와 그 stop이 있고, 76마디에 **시작 없는 stop**, 77마디에 **끝나지 않는 diminuendo**가 있다. 원본 결함이 맞고, ScoreGraph의 Wedge가 양 끝을 요구하는 것은 설계(§5.10)이며 import가 보고한다. **정당하다.** 다만 이 항목의 설명 문장은 틀렸다 (F3)

### 25.3 발견

**BLOCKER 0 · MAJOR 0**

| # | 등급 | 발견 |
| --- | --- | --- |
| F1 | MINOR | **쪼개진 잇단음의 괄호 묶음이 바뀐다.** `buildXml`은 한 event가 여러 조각으로 쪼개지면 첫 조각에 `<tuplet type="start">`, 마지막 조각에 `stop`을 찍어 **괄호 하나**로 묶었다. buildGraph는 조각마다 Tuplet을 따로 만들어 **조각마다 start+stop**을 찍는다. 영향: core 37/553(6.7 %), robust 17/282(6.0 %), full 304/4,976(6.1 %), golden·smoke·replay 0. 앱은 `<tuplet>` start/stop을 읽고(App 4245) 묶음이 **2개 이상일 때만** 괄호를 그리므로(App 11472), 묶여 있던 괄호가 사라진다 — `method/czerny849/020`에서 앱이 그리던 괄호 29개 → 0개. 소리·길이·time-modification은 그대로다. G0 gate는 `<tuplet>` start/stop을 읽지 않아(reader는 time-modification 비율만 읽는다) 이 변화를 **볼 수 없다**. 사라지는 괄호 자체가 원래 틀린 표기(셋잇단 3음이 아니라 tie로 묶인 2조각 위의 "3")여서 merge blocker로 보지 않는다. §24.3의 "`buildXml`은 조각마다 괄호를 따로 연다 … 그래프가 그대로 담는다"는 **쪼개진 경우에 한해 사실과 다르다** |
| F2 | MINOR | **시간이 숫자가 아닌 페달이 들어오면 새 writer가 죽는다.** `{on: 1}`(off 없음, 녹음이 끝날 때까지 밟고 있던 페달), `{on: NaN}`, `{off: NaN}`, `{on: 없음}` 중 하나라도 있으면 `toMusicXml`이 `rational parts must be integers`로 throw한다. `buildXml`은 같은 입력에서 그 페달만 조용히 버리고 악보를 냈다 (`finish()`의 페달 필터는 NaN 비교가 전부 false라 통과시키고, `buildXml`의 `pedalsHere` 필터가 다시 NaN을 걸렀다). 현재 출하되는 생산자로는 재현되지 않는다: Python helper는 `midi_notes.py`에서 걸린 페달을 녹음 끝 시각으로 닫고, 브라우저 fallback(`basic-pitch`)은 페달을 내지 않는다. 그러나 앱은 helper JSON의 `pedals`를 검사 없이 그대로 넘긴다. 고치려면 `buildGraph`의 페달 위치 계산에 연주 층에 이미 있는 것과 같은 `isFinite` 가드 한 줄이면 된다 |
| F3 | MINOR | **allowlist 설명이 틀렸다.** `sonatina/014` 항목은 "앱은 wedge를 읽지 않으므로 보이고 들리는 것은 같다"고 적었다. 앱은 `parseMusicXML`에서 `<wedge>`를 읽고(App 4098) 재생 세기를 그것으로 만든다(App 2705–2731). 특히 **끝나지 않은 diminuendo는 곡 끝까지 적용된다**(App 2715). G1 production은 import 경로를 쓰지 않으므로 지금 영향은 없지만, G2에서 import가 그래프로 옮겨가면 실제로 들리는 차이가 된다. 근거 문장을 고쳐야 한다 |
| F4 | MINOR | **exporter의 거절을 확인하지 않는다.** `result.xml = scoreGraph().musicxml.export(...).xml` 은 `{ok:false}`를 검사하지 않는다. 거절되면 `xml`이 `undefined`가 되어 앱이 나중에 엉뚱한 곳에서 실패한다. 지금은 도달 불가다(피아노 그래프는 perc가 없고, 잘못된 그래프는 `finish()`가 먼저 throw). throw로 바꾸는 편이 낫다 |
| F5 | MINOR | **쓰기 비용이 2.3–4.5배다.** 100음 7.3→19.4 ms, 3,200음 142→634 ms로 규모가 커질수록 배수도 커진다. 지금은 문제가 아니지만(전사당 1회), 아주 긴 녹음에서 더 벌어질 수 있다 |
| F6 | OPTIONAL | round-trip allowlist는 **파일 단위**다. allowlist에 오른 파일이 나중에 **다른** 차이를 얻어도 통과한다(재현 fixture는 원래 차이만 확인한다). 사유 단위로 막는 편이 안전하다 |
| F7 | OPTIONAL | `ab_identical.py`는 `predicted.semantic`만 비교하고 `predicted`의 나머지(bars, key, tempo, pedal_marks)는 보지 않는다. 또 양쪽 케이스가 0개여도 "all the same"으로 통과한다(최소 케이스 수 확인이 없다) |
| F8 | OPTIONAL | `transcription.test.js`의 "rich style" 검사는 편곡 서비스 호출 뒤 **900 ms 고정 대기**다. 서비스 왕복이 약 600 ms여서 여유가 얇다(구현 세션에서 1회 실패, 재현 3회 없음). 조건 대기로 바꾸는 편이 안전하다 — 다만 UI 대수술은 하지 말 것 |

### 25.4 리뷰어가 직접 돌린 결과 (커밋 `d65d81f`)

| 명령 | 결과 |
| --- | --- |
| `npm run test:scoregraph` | 71/71, 2.8 s |
| `npm run test:bench` | 단위 221 OK · golden **17/17 identical** · correctness 13/13 |
| `npm run bench` (core) | **PASS**, 21 s |
| `run --suite robust` + `check` | **PASS** |
| `run --suite replay-public` + `check` | **PASS** |
| `ab --suite smoke --a git:aff7080 --b worktree` + `ab_identical` | **PASS**, 44/44 케이스 동일 |
| `mutation-check` | **PASS** — 해로운 40종 전부 잡히고 no-op은 바이트 동일 |
| `sg-roundtrip` | 369개 중 367개 전 레벨 통과, 2개 allowlist, play_order 369/369, 14.1 s |
| `run --suite full` (기준 SUT와 작업 트리 SUT) | 각각 4,976 케이스 0 error, 수치 동일, baseline 대비 같은 32줄 실패 (§10) |
| `npm test` (26 suite 개별 실행) | HEAD 23/26 · 기준 커밋 `aff7080`도 **23/26, 실패 내용까지 동일**(FPS 10, layout 2건, transkun venv 검사) → 환경 문제이고 G1과 무관. 통과 집합은 기준과 같다 |
| 리뷰 자체 비교 | 5,878 케이스 음악 동일(F1 제외) · 경계·fuzz 436개 중 한쪽만 실패 1건(F2) |

### 25.5 merge 조건 대조

| 조건 | 판정 |
| --- | --- |
| BLOCKER 0 / MAJOR 0 | ✅ |
| production flip 의미 동일 | ✅ (5,878 케이스; 잇단음 괄호 F1은 인쇄 표기, 소리·구조 불변) |
| ERROR/throw 경로 허용 가능 | ✅ (정상 입력 false-positive 0; F2는 출하 생산자로 도달 불가) |
| allowlist 2건 정당 | ✅ (둘 다 원본 결함, 설명 문장만 F3) |
| SUT multi-file coverage | ✅ (리뷰어가 심은 결함 3종 모두 탐지) |
| A/B 정상 | ✅ (각 side가 자기 라이브러리, 케이스별 동일) |
| full baseline 실패가 pre-existing | ✅ (기준 커밋에서도 같은 32줄) |
| G0 regression 없음 | ✅ |

**결론: READY_TO_PR.** F1–F3은 PR 뒤 별도 커밋이나 G2/G3에서 다루면 된다. F1은 G3(잇단음 표기), F2는 한 줄 가드, F3은 문서 수정이다.

---

## 부록 A. MusicXML ↔ ScoreGraph 대응표

import는 MusicXML 표준 해석을 따른다 (앱 parity가 아니다). 앱이 무엇을 볼지는 G0 reader가 export 결과를 읽어 판정한다. export는 그래프에 있는 것만 쓴다.

| MusicXML | ScoreGraph | import | export |
| --- | --- | --- | --- |
| `score-partwise` | 루트 | `score-timewise`는 `IMPORT-TIMEWISE`로 거절 | `version="4.0"`, DOCTYPE 없음 |
| `work-title`, `movement-title`, `creator[type]`, `rights` | `meta.*` | | |
| `encoding/software` | `provenance.sources[0].tool` | | 옵션 `software` |
| `score-part`, `part-name`, `part-abbreviation` | Part `name`, `abbr` | | id `P1`, `P2`… (순서) |
| `score-instrument`, `midi-instrument` | `instrument.name`, `midi.program`, `channel` | kind는 이름 규칙과 `<staves>`로 추정 (피아노 이외는 `unknown`) | |
| `<unpitched>` | – | **G1: `IMPORT-UNSUPPORTED-UNPITCHED`** | perc event: **`EXPORT-UNSUPPORTED-PERC`** |
| `measure@number`, `@implicit`, `@width` | Measure `number`, `implicit`, `layout.width` | 마디 길이 규칙 §6.3 | 마지막 event 뒤를 `<forward>`로 `dur`까지 채워 reader의 내용 길이가 `dur`와 같게 한다 |
| `print@new-system/new-page` | `layout.newSystem/newPage` | 그 밖의 `<print>`는 버리고 보고한다 | |
| `divisions` | – (유리수로 흡수) | 마디 중간 변경도 정확히 반영 | part마다 최소 공배수 |
| `key` (+`@number`) | KeyEvent (`scope.staff`) | written → concert (transpose) | concert → written |
| `time` (`beats` "3+2", `@symbol`, `print-object`) | MeterEvent | 마디 중간이면 다음 마디에 적용하고 W-IMPORT-METER-MIDMEASURE | |
| `staves` | `part.staves` 개수 | | 2개 이상이면 쓴다 |
| `clef` (`sign`, `line`, `clef-octave-change`, `@number`) | Clef | | |
| `transpose` | `instrument.transpose` | | |
| `note/pitch` | `head.pitch` (concert) | written → concert | concert → written |
| `rest` (`@measure`, `display-step/octave`) | RestEvent `display.measureRest`, `display.pos` | | |
| `chord` | 같은 event의 head | 길이가 다르면 W-IMPORT-CHORD-SPLIT | 둘째 head부터 `<chord/>` |
| `duration` | `event.dur` | `duration / (divisions × 4)` | |
| `voice` | Voice (`label`) | 번호별로 part voice를 하나씩. home staff는 첫 event의 staff | `label`, 없으면 순번 |
| `staff` | `event.staff` / `head.staff` | 한 화음 안에서 staff가 다르면 head.staff | |
| `backup`, `forward` | – (위치) | 0 아래로 가면 clamp하고 W-IMPORT-BACKUP-CLAMP | voice 흐름 사이에 사용 |
| `type`, `dot`, `stem`, `notehead`, `@print-object`, `@default-x`, `cue`, `@size` | `display.*`, `head.notehead`, `hidden`, `cue` | 없으면 없는 대로 둔다 | 있는 것만 쓴다 (§14.3) |
| `grace` (`@slash`) | `grace {order, slash}` | 주음의 `at`, 문서 순서로 order | |
| `accidental` (+ 속성) | `head.acc` | | |
| `tie@type` / `notations/tied` | Tie spanner | start는 같은 part·staff·실음에서 **그 음이 끝나는 곳에서 시작하는** stop과 짝짓는다. 짝이 없으면 열린 tie로 두고 W-TIE-OPEN | `<tie>`와 `<tied>`를 둘 다 쓴다 |
| `time-modification`, `notations/tuplet` | Tuplet spanner (`printed`, `show`, `parent`) | 괄호 start/stop이 멤버를 정한다. 괄호 없는 time-mod는 같은 비율의 연속 구간을 `printed:false` 하나로 묶는다 | 비율 사슬로 time-mod를 쓴다. `printed`면 `<tuplet>`도 쓴다 |
| `beam` | Beam spanner | | |
| `notations/slur@number` | Slur spanner | 번호로 짝짓는다. 짝이 없으면 W-SLUR-OPEN | 번호를 새로 매긴다 (겹침 기준) |
| `articulations/*`, `fermata`, `ornaments/*`, `technical/fingering`, `string`, `fret` | `arts`, `fermata`, `orn`, `head.fingering`, `head.tech` | | |
| `arpeggiate`, `non-arpeggiate` | Arpeggio spanner | 같은 `@number` 또는 같은 onset의 인접 staff로 묶는다 | |
| `lyric` | `lyrics` | | |
| `direction/dynamics`, `notations/dynamics` | Direction `dynamic` (`event`) | | |
| `direction/wedge` | Wedge spanner | | |
| `direction/pedal`, `sound@damper-pedal` / `soft-pedal` / `sostenuto-pedal` | Pedal spanner (`mark`, `soundOnly`, `depth`) | | |
| `direction/octave-shift` | Ottava spanner (`shift`: 8va = +1) | `<pitch>`를 옮기지 않는다 | |
| `direction/metronome`, `words`(템포 방향 안), `sound@tempo`, 마디 직속 `sound@tempo` | TempoEvent (`qpm`, `mark`, `display`) | 같은 위치의 part별 중복은 하나로 합치고 `display[]`에 part를 기록한다 | `display`의 part마다 쓴다. qpm만 있으면 맨 `<sound tempo>` |
| `direction/words`, `rehearsal` | Direction `words`, `rehearsal` | | |
| `harmony` | Direction `chord` | | |
| `segno`, `coda`, `sound@dacapo/dalsegno/fine/tocoda` | Jump | | |
| `barline` (`bar-style`, `repeat`, `ending`) | `measure.barline`, Ending | right 쪽 forward repeat는 다음 마디 left로 옮기고 W-IMPORT-REPEAT-MOVED | |
| `defaults`, `credit`, `figured-bass`, `listening`, `bookmark`, `link`, `footnote`, `level`, 그 밖 | – | **버리고 `report.dropped`에 개수를 적는다** | |

**export 배치 규칙** (결정론적):

1. part마다, 마디마다 순서대로 쓴다.
   - `<print>`
   - 왼쪽 barline
   - 마디 시작 attributes (divisions 변경 시, key, time, staves, clef, transpose)
   - voice별 흐름 (part `voices` 순서)
   - 오른쪽 barline
2. voice 사이는 마디 시작으로 `<backup>`한다. 빈 구간은 `<forward>`로 채운다.
3. direction, 마디 중간 attributes(clef, key), 맨 `sound`는 해당 staff의 첫 voice 흐름에서 **자기 위치에** 넣는다.
   - 커서가 그 위치에 오는 곳이 있으면 그곳에 넣는다.
   - 위치가 음의 가운데이면 그 음 앞에 `<offset>`과 함께 넣는다.
4. note 원소의 자식은 **XSD 순서**로 쓴다: `grace, chord, pitch/rest, duration, tie, voice, type, dot, accidental, time-modification, stem, notehead, staff, beam, notations, lyric`.

---

## 부록 B. Legacy Score adapter 계약 (G2 준비)

G2의 `toLegacyScore(graph)`가 지켜야 할 대응이다. **목표는 T1-C conformance에서 `parseMusicXML(export(graph))` 결과와 같은 것**이다. 그래야 소비자를 바꾸지 않고 import 경계를 옮길 수 있다.

| legacy | ScoreGraph에서 | parity 메모 |
| --- | --- | --- |
| `measures[i].number` | `parseInt(measure.number)`, 아니면 순번 | 중복 번호 겹침 규칙은 앱과 같다 |
| `lenQ` | `measure.dur × 4` | |
| `time`, `key` | `meterAt`, `keyAt` (part 0, 첫 key) | `mode`가 없으면 `'major'` (앱 R11) |
| `clefs`, `clefChanges` | Clef (part 0의 지역 staff 번호) | 앱은 line을 무시한다 |
| `bar.*` | barline과 Ending (part 0) | |
| `notes[].m, b, dur` | 마디 번호, `at × 4`, `dur × 4` | grace는 버린다 (앱 R2) |
| `p`, `midi`, `writtenP`, `writtenMidi`, `soundingMidi` | 음높이 층 (§7.2) | **결정 필요 (G2)**: 앱의 octave-shift 해석(이슈 3)을 재현할지, `soundingMidi`를 채워 고칠지 |
| `staff`, `voice` | 전역 staff 번호 (part 순서 누적), `voice.label` 정수 | |
| `chord` | 둘째 head부터 true | |
| `tieStart/Stop`, `slurStart/Stop` | Tie, Slur의 끝 | 앱은 `<tie>`만 본다 |
| `type`, `dots`, `acc` | `display`, `head.acc` | type이 없으면 앱은 `typeFromQ(dur)`를 쓴다 |
| `hand` | part 선택 규칙(App 4287–4298)을 그대로 적용한다. 규칙을 바꾸는 것은 이슈 11을 다루는 Goal의 일이다 | SG의 `limb`는 G2에서 쓰지 않는다 (parity) |
| `finger` | 첫 fingering의 정수 | |
| `tm`, `tupletStart/Stop` | Tuplet 사슬, 인쇄 괄호의 끝 | |
| `stem`, `dx`, `arp`, `accent`, `marcato`, `dyn` | `display.stem`, `display.x`, Arpeggio, `arts`, 음에 붙은 dynamic | |
| `chords`, `pedals`, `ottavas`, `marks`, `tempos`, `dynamics`, `wedges` | Direction `chord`(part 0), Pedal, Ottava, Jump, TempoEvent, dynamic, Wedge | 앱은 셈여림과 템포를 모든 part에서 읽는다 (F9) |
| `tempo` | 첫 TempoEvent의 qpm (sound 우선), 없으면 84 | |
| (새) `sgHead` | head ID | falling notes, 운지, 암기 기능의 안정 ID |

---

## 부록 C. 예시 (피아노, 드럼)

이 예시는 설명용이다. 구현 시 커밋되는 fixture(`tests/scoregraph/fixtures/valid/`)가 규범이다.

### C.1 피아노: 3박자, 못갖춘마디, 반복과 volta, 셋잇단, tie, 페달, 연주 층

악보는 다음과 같다.

- 3/4, G장조, 4분음표 = 96
- 못갖춘마디(4분 1개) → 1마디(forward repeat) → 2마디(1번 ending, backward repeat) → 3마디(2번 ending, 2/4 길이의 보충 마디)
- 오른손은 1마디에 셋잇단 B4-C5-D5와 G5 2분음표를 친다. G5는 2마디로 tie된다.
- 왼손은 화음이다. damper 페달은 1마디 시작에 밟고, 2마디 시작에서 바꾸고, 3마디 끝에서 뗀다.
- 학생 연주 take의 첫 두 음과 마디 anchor를 포함한다.

```json
{
  "scoregraph_version": 1,
  "id": "sg-example-waltz",
  "rev": 0,
  "nextId": 54,
  "meta": {"title":"Example Waltz","composer":"PPP"},
  "timeline": {
    "measures": [
      {"id":"m7","number":"0","dur":"1/4","implicit":true},
      {"id":"m8","number":"1","dur":"3/4","barline":{"left":{"style":"heavy-light","repeat":"forward"}}},
      {"id":"m9","number":"2","dur":"3/4","barline":{"right":{"style":"light-heavy","repeat":"backward"}}},
      {"id":"m10","number":"3","dur":"1/2","barline":{"right":{"style":"light-heavy"}}}
    ],
    "meters": [
      {"id":"mt11","m":"m7","beats":[3],"beatType":4}
    ],
    "keys": [
      {"id":"ky12","m":"m7","at":"0","fifths":1,"mode":"major"}
    ],
    "tempos": [
      {"id":"tp13","m":"m7","at":"0","qpm":"96","mark":{"unit":"quarter","perMinute":"96"}}
    ],
    "endings": [
      {"id":"en14","numbers":[1],"from":"m9","to":"m9"},
      {"id":"en15","numbers":[2],"from":"m10","to":"m10","open":true}
    ]
  },
  "parts": [
    {
      "id": "p2",
      "name": "Piano",
      "instrument": {"kind":"piano","family":"keyboard","midi":{"program":1}},
      "staves": [
        {"id":"st3","limb":"RH"},
        {"id":"st4","limb":"LH"}
      ],
      "voices": [
        {"id":"v5","staff":"st3","label":"1"},
        {"id":"v6","staff":"st4","label":"5"}
      ],
      "clefs": [
        {"id":"c16","staff":"st3","m":"m7","at":"0","sign":"G"},
        {"id":"c17","staff":"st4","m":"m7","at":"0","sign":"F"}
      ],
      "events": [
        {"id":"e18","kind":"note","m":"m7","at":"0","dur":"1/4","voice":"v5","staff":"st3","display":{"type":"quarter"},"heads":[{"id":"h19","pitch":{"step":"D","oct":5}}]},
        {"id":"e20","kind":"rest","m":"m7","at":"0","dur":"1/4","voice":"v6","staff":"st4","display":{"type":"quarter"}},
        {"id":"e21","kind":"note","m":"m8","at":"0","dur":"1/12","voice":"v5","staff":"st3","display":{"type":"eighth"},"heads":[{"id":"h22","pitch":{"step":"B","oct":4}}]},
        {"id":"e23","kind":"note","m":"m8","at":"1/12","dur":"1/12","voice":"v5","staff":"st3","display":{"type":"eighth"},"heads":[{"id":"h24","pitch":{"step":"C","oct":5}}]},
        {"id":"e25","kind":"note","m":"m8","at":"1/6","dur":"1/12","voice":"v5","staff":"st3","display":{"type":"eighth"},"heads":[{"id":"h26","pitch":{"step":"D","oct":5}}]},
        {"id":"e27","kind":"note","m":"m8","at":"1/4","dur":"1/2","voice":"v5","staff":"st3","display":{"type":"half"},"heads":[{"id":"h28","pitch":{"step":"G","oct":5}}]},
        {"id":"e29","kind":"note","m":"m8","at":"0","dur":"3/4","voice":"v6","staff":"st4","display":{"type":"half","dots":1},"heads":[{"id":"h30","pitch":{"step":"G","oct":2}},{"id":"h31","pitch":{"step":"D","oct":3}}]},
        {"id":"e32","kind":"note","m":"m9","at":"0","dur":"1/4","voice":"v5","staff":"st3","display":{"type":"quarter"},"heads":[{"id":"h33","pitch":{"step":"G","oct":5}}]},
        {"id":"e34","kind":"note","m":"m9","at":"1/4","dur":"1/4","voice":"v5","staff":"st3","display":{"type":"quarter"},"heads":[{"id":"h35","pitch":{"step":"F","alter":1,"oct":5}}]},
        {"id":"e36","kind":"note","m":"m9","at":"1/2","dur":"1/4","voice":"v5","staff":"st3","display":{"type":"quarter"},"heads":[{"id":"h37","pitch":{"step":"E","oct":5}}]},
        {"id":"e38","kind":"note","m":"m9","at":"0","dur":"3/4","voice":"v6","staff":"st4","display":{"type":"half","dots":1},"heads":[{"id":"h39","pitch":{"step":"C","oct":3}},{"id":"h40","pitch":{"step":"G","oct":3}}]},
        {"id":"e41","kind":"note","m":"m10","at":"0","dur":"1/2","voice":"v5","staff":"st3","display":{"type":"half"},"heads":[{"id":"h42","pitch":{"step":"G","oct":5}}]},
        {"id":"e43","kind":"note","m":"m10","at":"0","dur":"1/2","voice":"v6","staff":"st4","display":{"type":"half"},"heads":[{"id":"h44","pitch":{"step":"G","oct":2}}]}
      ],
      "directions": [
        {"id":"d45","kind":"dynamic","m":"m8","at":"0","staff":"st3","placement":"below","value":"p"}
      ],
      "spanners": [
        {"id":"s49","type":"pedal","pedal":"damper","from":{"m":"m8","at":"0"},"to":{"m":"m10","at":"1/2"},"changes":[{"m":"m9","at":"0"}]},
        {"id":"s48","type":"slur","from":"e21","to":"e32"},
        {"id":"s46","type":"tuplet","events":["e21","e23","e25"],"actual":3,"normal":2,"unit":{"type":"eighth"}},
        {"id":"s47","type":"tie","from":"h28","to":"h33"}
      ]
    }
  ],
  "performances": [
    {
      "id": "pf51",
      "kind": "take",
      "src": "sr50",
      "notes": [
        {"id":"pn52","on":1000000,"off":1580000,"vel":58,"midi":74,"link":"h19"},
        {"id":"pn53","on":1631000,"off":1830000,"vel":62,"midi":71,"link":"h22"}
      ],
      "anchors": [
        {"m":"m7","k":1,"at":"0","us":1000000,"kind":"bar"},
        {"m":"m8","k":1,"at":"0","us":1625000,"kind":"bar"},
        {"m":"m9","k":1,"at":"0","us":3500000,"kind":"bar"}
      ]
    }
  ],
  "provenance": {
    "sources": [
      {"id":"sr1","kind":"musicxml","input":{"name":"example-waltz.musicxml"}},
      {"id":"sr50","kind":"midi-input","note":"student take"}
    ],
    "default": {"src":"sr1","op":"imported"}
  }
}
```

**이 예에서 확인할 것**

- **셋잇단**: `1/12`이 세 번 더해져 `1/4`가 된다. 그래서 G5는 `at: "1/4"`에서 시작한다.
- **못갖춘마디**: `m7`은 `implicit`이고 `dur "1/4"`다. 보충 마디 `m10`은 `"1/2"`이다. 둘을 더하면 3/4이므로 경고가 없다. `metric({m7, 0}).beat`는 2(셋째 박)다.
- **연주 층**
  - `pn53`은 `h22`(B4)에 링크된다.
  - 악보 재생 시각: 1마디 시작 = 1 s + 1/4 W × 4 × 60/96 = 1.625 s.
  - expressive offset = 1,631,000 − 1,625,000 = **+6,000 µs**. 파생값이다.
- **재생 순서**: `unroll` → `m7(k1), m8(k1), m9(k1), m8(k2), m10(k1)`. 두 번째 pass에서 1번 ending(`m9`)을 건너뛴다.
  - `m8`의 tie(h28→h33)는 두 번째 pass에서 목적지(`m9`)가 연주되지 않는다. 그래서 G5는 `m8` 끝에서 놓인다 (§6.7).
- **정렬**
  - spanner는 첫 기준점의 위치, 그다음 type 순이다: pedal, slur, tuplet(모두 m8@0), 그리고 tie(m8@1/4).
  - event는 마디 → voice → 위치 순이다.
- **provenance**: 엔티티마다 `prov`가 없다. 모두 기본값(`sr1`, imported)을 상속한다. performance는 `src: sr50`이다.

### C.2 드럼 part: 같은 그래프에 추가된 part

C.1 그래프에 Arrangement Planner(미래)가 드럼 part를 더한 모습이다. part 하나만 보이고 ID는 `nextId`부터 이어진다. 루트에서는 `nextId`와 `provenance.sources`가 함께 바뀐다 (`sr70`: `{"id":"sr70","kind":"generator","tool":"arrangement-planner"}`). **G1은 이 그래프의 검증과 직렬화만 한다** (A25).

```json
    {
      "id": "p54",
      "name": "Drum Set",
      "instrument": {"kind":"drumset","family":"percussion","midi":{"channel":10},"kit":{"items":[{"key":"kick","name":"Bass Drum","gm":36,"pos":{"step":"F","oct":4}},{"key":"snare","name":"Snare","gm":38,"pos":{"step":"C","oct":5}},{"key":"hh-closed","gm":42,"pos":{"step":"G","oct":5},"notehead":"x"},{"key":"hh-open","gm":46,"pos":{"step":"G","oct":5},"notehead":"circle-x"},{"key":"hh-pedal","gm":44,"pos":{"step":"D","oct":4},"notehead":"x"},{"key":"crash","gm":49,"pos":{"step":"A","oct":5},"notehead":"x"},{"key":"ride","gm":51,"pos":{"step":"F","oct":5},"notehead":"x"},{"key":"tom-hi","gm":50,"pos":{"step":"E","oct":5}}]}},
      "staves": [
        {"id":"st55","kind":"percussion"}
      ],
      "voices": [
        {"id":"v56","staff":"st55","label":"1"},
        {"id":"v57","staff":"st55","label":"2","limb":"RF"}
      ],
      "clefs": [
        {"id":"c58","staff":"st55","m":"m7","at":"0","sign":"percussion"}
      ],
      "events": [
        {"id":"e59","kind":"perc","m":"m8","at":"0","dur":"1/4","voice":"v56","staff":"st55","display":{"type":"quarter","stem":"up"},"heads":[{"id":"h60","inst":"crash","limb":"RH"}]},
        {"id":"e61","kind":"perc","m":"m8","at":"1/4","dur":"1/4","voice":"v56","staff":"st55","display":{"type":"quarter","stem":"up"},"heads":[{"id":"h62","inst":"snare","limb":"LH"},{"id":"h63","inst":"hh-closed","limb":"RH"}]},
        {"id":"e64","kind":"perc","m":"m8","at":"1/2","dur":"1/4","voice":"v56","staff":"st55","display":{"type":"quarter","stem":"up"},"heads":[{"id":"h65","inst":"snare","limb":"LH","stroke":"flam"},{"id":"h66","inst":"hh-closed","limb":"RH"}]},
        {"id":"e67","kind":"perc","m":"m8","at":"0","dur":"1/4","voice":"v57","staff":"st55","display":{"type":"quarter","stem":"down"},"heads":[{"id":"h68","inst":"kick"}]},
        {"id":"e69","kind":"rest","m":"m8","at":"1/4","dur":"1/2","voice":"v57","staff":"st55","display":{"type":"half"}}
      ],
      "directions": [],
      "spanners": [],
      "prov": {"src":"sr70","op":"generated"}
    }
```

- **악기 식별**: 음높이 대신 `inst`(kit key)를 쓴다. 보표 위치와 notehead는 kit이 주고, head가 덮어쓸 수 있다.
- **limb**: `v57`(발)은 voice 단위로 `RF`다. 손은 head 단위다.
- **동시 타격**: snare와 hi-hat을 함께 치는 것은 **head가 둘인 event 하나**다 (피아노 화음과 같은 규칙).
- **연주**: 드럼의 재생은 `performances[]`에 `kind: "render"`로 둘 수 있다. PerfNote는 `{inst, part: "p54", on, off, vel}`이다.
- **표시하지 않은 것**: part 수준 `prov`가 이 part의 모든 엔티티에 `generated`를 준다 (§11.2).
