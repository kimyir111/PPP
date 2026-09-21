# G0 — Quality Foundation: 악보 품질 측정·회귀 기반

| 항목 | 값 |
| --- | --- |
| 상태 | **구현 완료 (2026-09-22)** · 브랜치 `g0-quality-foundation` (main 미병합, push 안 함) · 결과와 미완 항목은 [§16](#16-구현-결과-2026-09-22) · 독립 리뷰 판정 **READY_FOR_FIXER** ([§17](#17-independent-review-2026-09-22)) |
| 작성일 | 2026-09-21 |
| 기준 커밋 | `718bdf3` (main). `audio-score.js` sha256 `559a1f40fb73416bc72d671d894251f7c3263110fa10780559047f6f22009288` |
| 읽는 사람 | 이 문서만 읽고 G0을 구현할 다음 Claude 세션, 그리고 리뷰하는 사용자 |
| 한 줄 목표 | PPP가 만드는 악보가 **좋아졌는지 나빠졌는지**를 사람이 악보를 보지 않고도, 재현 가능한 숫자로 판정하는 benchmark·regression 기반을 만든다. |
| 비목표 | **품질을 올리지 않는다.** 측정만 한다. 조사 중 발견한 버그도 고치지 않고 기록만 한다 (§13, §14). |

---

## 목차

- [0. 요약](#0-요약)
- [0.1 용어](#01-용어)
- [1. 현재 상태](#1-현재-상태)
- [2. 문제점](#2-문제점)
- [3. 목표 architecture](#3-목표-architecture)
- [4. 새로 만들 파일/모듈](#4-새로-만들-파일모듈)
- [5. 수정할 기존 파일](#5-수정할-기존-파일)
- [6. Benchmark 악보(코퍼스)와 케이스 구성](#6-benchmark-악보코퍼스와-케이스-구성)
- [7. Golden test 구조](#7-golden-test-구조)
- [8. 평가 metric](#8-평가-metric)
- [9. Regression test 구조](#9-regression-test-구조)
- [10. Implementation 순서](#10-implementation-순서)
- [11. Acceptance criteria](#11-acceptance-criteria)
- [12. 위험 요소](#12-위험-요소)
- [13. 이번 Goal에서 절대 건드리지 않을 범위](#13-이번-goal에서-절대-건드리지-않을-범위)
- [14. 조사 중 발견한 품질 이슈 (고치지 말고 기록만)](#14-조사-중-발견한-품질-이슈-고치지-말고-기록만)
- [15. 부록](#15-부록)
- [16. 구현 결과 (2026-09-22)](#16-구현-결과-2026-09-22)
- [17. Independent Review (2026-09-22)](#17-independent-review-2026-09-22)

---

## 0. 요약

**측정 대상의 중심은 `audio-score.js`의 `toMusicXml()`이다.** 녹음으로 악보를 만드는 모든 경로(로컬 helper 앙상블, 브라우저 fallback 모델, arrange 모드)가 `Import.finishHeard` → `PPPAudioScore.toMusicXml()` 하나로 모인다. 이 함수는 의존성 없는 순수 JS라 Node에서 결정론적으로 돈다. 조사 중 측정으로 391곡에 2.4초가 걸렸다.

**정답은 저장소에 이미 있는 라이선스-클린 MusicXML이다.** 교재(Beyer, Czerny, Hanon, Burgmüller, 소나티네), 찬송가 100곡, catalog 3곡, samples, 그리고 G0에서 새로 만들 micro 악보 24개. 각 정답 악보에서 **결정론적인 합성 연주**(onset 흔들림, rubato, AMT 오류 흉내, 박 정보 유무)를 만들어 `toMusicXml()`에 넣고, 나온 악보를 정답과 비교한다.

핵심 결정:

1. **평가 코어는 Python 표준 라이브러리만** 쓴다 (`xml.etree`, `zipfile`, `fractions`, `json`). Node는 `audio-score.js`를 실행하는 얇은 adapter로만 쓴다. 새 npm/pip 의존성은 없고, 브라우저가 필요 없으므로 CI에서 돈다.
2. **앱 파서와 같은 규칙으로 읽는다.** canonical reader는 `parseMusicXML()`의 규칙(grace 생략, pickup 길이, 손 배정, tempo 우선순위, ottava)을 그대로 따른다. 일치 여부는 브라우저 tier의 conformance 검사로 확인한다.
3. **매칭은 초 단위, 채점은 악보 단위다.** 예측 악보의 음을 예측 박 격자(`stats.barStarts`/`stats.beats`)로 초로 옮겨 정답 음과 짝지은 뒤, 짝지어진 음마다 박자 위치·음가·손·철자를 채점한다. 템포가 2배로 잡히거나 6/8로 잘못 쓰여도 "음을 잃었다"와 "리듬을 잘못 적었다"가 섞이지 않는다.
4. **회귀를 두 겹으로 막는다.**
   - metric baseline + gate: 집계, 그룹(tag), 케이스 단위로 허용치를 둔다.
   - golden snapshot: 고정 입력의 정확한 출력을 diff한다.

   gate가 실제 회귀를 잡는지는 **mutation test**로 증명한다. 조사 중 SUT 사본에 회귀 mutation 5개를 넣어 각각 목표 metric이 움직이는 것을, no-op mutation은 아무 값도 바꾸지 않는 것을 확인했다 (§9.5).
5. **모든 코드는 `tests/bench/` 아래에 둔다.** `server.js`가 `tests/`를 정적 서빙에서 차단하므로 Render 배포에 노출되지 않는다. `Piano Coach App.dc.html`과 `audio-score.js`는 한 줄도 수정하지 않는다. 이 둘은 측정 대상(SUT)이고, 여러 세션이 동시에 편집한다.

산출물은 다섯 가지다.

- `tests/bench/`: 코어 패키지, Node adapter, 코퍼스, suite, baseline, golden, 단위 테스트
- npm scripts 4개
- `tests/bench/README.md`
- (P1) CI workflow, replay·OMR·conformance tier
- 첫 baseline, 그리고 조사에서 드러난 품질 이슈 목록

**완료 판정: §11의 A1–A16을 모두 통과해야 한다.** 환경 의존 항목은 SKIPPED 사유를 기록하는 것까지가 요구사항이다.

### 0.1 용어

| 용어 | 뜻 |
| --- | --- |
| Reference (정답 악보) | 비교 기준 MusicXML. `tests/bench/corpus/references.json`에 등록된 것만 쓴다. |
| Canonical score | reader가 MusicXML을 읽어 만든 정규화 JSON (§8.1). 모든 비교는 canonical끼리 한다. |
| Performance (합성 연주) | reference에서 결정론적으로 만든 `{notes:[{on,off,midi,vel}], beats?, downbeats?, beatConfidence?}`. 로컬 helper가 돌려주는 JSON과 같은 모양. 단위는 초. |
| Profile | 연주를 만드는 방식 (`deadpan`, `human`, `rubato`, `amt`)과 박 정보 방식 (`none`, `oracle`, `oracle-noisy`, `lowconf`). |
| Case | reference × profile × beats × seed × 파이프라인 옵션. ID `"<refId>\|<profile>\|<beats>\|s<seed>"` (옵션이 있으면 `\|opt:<name>`). |
| Suite | case 묶음과 gate 설정 (`smoke`, `core`, `full`, `golden`, …). |
| Tier | 실행 요구 수준. T0 = Python+Node만, T1 = 앱 서버+브라우저+네트워크, T2 = 로컬 helper+모델(GPU)/Audiveris. |
| SUT | System under test. G0에서는 주로 `audio-score.js`. |
| Baseline | suite의 기준 결과(집계 + 케이스별 metric). 커밋한다. |
| Gate | 새 결과를 baseline과 비교해 PASS/REGRESSION/ERROR를 내는 규칙. |
| Golden snapshot | 고정 입력에 대한 SUT의 **정확한** 출력(MusicXML 전체 + stats 일부). |
| Private suite | 저작권 자료(실제 녹음, 공식 PDF)를 쓰는 suite. 매니페스트·결과·baseline이 모두 저장소 밖에 있다. |
| SQI | Score Quality Index, 0–100. 여러 metric의 가중 평균으로 대시보드용 숫자다. **gate는 SQI 하나에 기대지 않는다.** |

---

## 1. 현재 상태

### 1.1 저장소 한눈에 보기

- **앱**: `Piano Coach App.dc.html`, 약 19,000줄 단일 파일.
  - `<x-dc>` 템플릿과 `class Component extends DCLogic`으로 되어 있고, React·ReactDOM·Babel standalone을 **unpkg에서 런타임 로드**한다.
  - 음악 모델, `parseMusicXML`, Import(OMR·녹음·검증), VexFlow 렌더러, 연습 엔진, 코치, 편곡기가 모두 이 파일에 있다.
  - 여러 Claude 세션이 동시에 편집한다 (사용자 메모리: parallel sessions).
- **서버**
  - `server.js` (포트 8777): 정적 서빙, 로그인/진도/공유 API. 정적 서빙에서 `node_modules`, `tools`, `.git`, `data`, `tests`를 차단한다 (`const BLOCKED`).
  - `omr-service.js` (127.0.0.1:8788, "local helper"): `/omr`, `/pdf-vector`, `/transcribe` (+ `/transcribe/<job>`), `/coach`, `/arrange`, `/arrange-score`, `/health`.
- **파이프라인 모듈**
  - `audio-score.js` (1,551줄): notes → beats·metre·key·hands → MusicXML. 브라우저와 Node 양쪽에서 돌고 의존성이 없다.
  - `transcribe.py`: TransKun, Kong, Aria-AMT 앙상블 consensus.
  - `beat_track.py`: Beat This, 신뢰도 계산.
  - `pm2s_quant.py`: 선택, 기본 off.
  - `arrange_score.py`: 반주 편곡, music21은 선택.
  - `score-search.js`: catalog 검색·정렬.
  - `midi_notes.py`, `evaluate_transcription.py`.
- **데이터**
  - `catalog/`: method 교재, 찬송가, catalog 3곡.
  - `samples/`: 4개.
  - `audio/piano/`: Salamander Grand, CC BY 3.0, 단3도마다 30개 MP3.
  - `tests/fixtures/`: VexFlow로 그린 OMR fixture `piano-clean.{pdf,png,jpg}`, `piano-multipage.pdf`, 정답 `truth.json`.
- **문서**: `README.md` (1,045줄로 사실상 유일한 설계 문서), `DEPLOY_RENDER.md`, `tests/README.md`, `tests/golden/README.md`. **`CLAUDE.md`와 `docs/`는 없었다** (이 문서가 `docs/`의 첫 파일).
- **CI 없음**: `.github/`이 없다. 배포는 Render이고, push만으로는 배포되지 않는다 (수동 CLI 배포).
- **개발 환경**
  - Windows 11, Node v24.17.0, Python 3.13.5. 콘솔 코드페이지 **cp949**.
  - `tools/transcribe-venv`: CUDA torch, transkun, beat-this 등.
  - `tools/audiveris`: vendored.
- **히스토리**: 2026-09-17 첫 커밋 이후 83 커밋. 2026-09-19~21 사흘 동안 전사·박자·조성·리듬·OMR·engraving 품질을 바꾸는 커밋이 13개 안팎이다. 예:
  - `1663718 Fix fast piano meter and key inference`
  - `8173d61 Improve score transcription with model consensus`
  - `72549cb Improve high-speed rhythm and ottava engraving`
  - `06854af Reject unstable beat grids before notation`

  모두 손으로 만든 몇 개 예제의 assertion으로만 검증되었다.

### 1.2 악보가 만들어지는 경로

**모든 경로의 끝은 같다.** `parseMusicXML()` → `Score` → VexFlow engraving과 연습 엔진이다. 경로별로 "악보를 **쓰는**" 부분이 다르다.

#### Route R — 녹음 → 악보 (핵심 생성 경로)

```
YouTube URL / mp3·wav·m4a·mp4
 └─ Import.fromRecording (앱)
     1) 제목·파일명으로 catalog 검색 (Import.findScore) ─ hit → catalog MusicXML + 박 정렬 (전사 없음)
     2) helper에 transcriber가 있고 mode≠'arrange' → POST /transcribe  (omr-service.js runJob)
          yt-dlp → ffmpeg(16 kHz mono wav) → catalogHit(title)?
          → transcribe.py --engine auto   (TransKun = recall floor, Kong, 선택적 Aria → consensus)
          → beat_track.py (Beat This: beats, downbeats, confidence, ibiCv)
          → pm2s_quant.py (선택, 기본 꺼짐) → grid
          → result JSON {notes, pedals, beats, downbeats, beatConfidence, grid?, engine, ensemble, uncertainNotes, ...}
     3) 아니면 Import.transcribeHere (브라우저: Onsets&Frames → Basic Pitch; arrange 모드는 Basic Pitch)
 └─ Import.finishHeard
     PPPAudioScore.toMusicXml(
        {notes, pedals, beats, downbeats, beatConfidence, grid, title},
        {title, easy: mode === 'arrange'})
       clean → (arrangement) → clusterNotes(50 ms) →
       beat: lock | audio(beatConfidence ≥ 0.42) | onset tracking(Ellis DP) →
       triplet / compound(6/8) / fast-tempo(×2,×3) 판정 → quantize(Q = 24 tick/quarter) →
       박자·위상 → 조성(Krumhansl–Kessler + diatonic fit) → spelling →
       손 배정(DP split) → staffEvents(음가 정리, 마디선 넘는 음 자르기) → buildXml
     → parseMusicXML → Import.validateTranscription (신뢰도·이슈)
     → 리뷰 화면 (박자·템포·첫 박 lock 후 재작성, 편곡 수준·스타일, 공식 악보로 교체) → Score
```

#### Route O — PDF/사진 → 악보 (`Import.load`)

```
PDF → pdf.js 300 DPI 래스터 + PdfLayer.read(텍스트·선)   |   이미지 → PNG 정규화
 → (helper에 PDFtoMusic Pro 있으면) /pdf-vector → MusicXML
 → 아니면 /omr → Audiveris(페이지별) → .mxl → 페이지별 MusicXML
 → Import.mergeMusicXml (Audiveris <words> 닫는 태그 복구, 마디 재번호)
 → parseMusicXML → PdfLayer.apply (코드명·8va·마디선 개수 비교 → missing) → Import.validate
 → 이슈가 있으면 1.17배 DPI로 재인식 → mergeMeasuresWhereBetter → 이슈가 줄면 채택
 → (helper 없음) PdfLayer.notate 브라우저 초안 (confidence ≤ 0.45, level 'poor')
```

#### Route X — MusicXML/MXL 업로드

`readMxl` → `parseMusicXML`. 파일을 신뢰하며, `validate`는 참고만 한다.

#### Route A — 편곡

- `toMusicXml(..., {arrangement | easy})`의 `arrangeNotes`: attack당 음 수를 제한한다. 음을 만들어내지 않고 들은 음의 부분집합만 남긴다.
- 리뷰/연습 화면의 `ScoreArranger`: 로컬에서 하거나, `/arrange-score` → `arrange_score.py` (stdin "wire score" JSON → stdout notes) → `Score.finalize`로 간다.

#### Route C — 카탈로그

교재, 찬송가, catalog, 공유 악보. 미리 만든 MusicXML을 `parseMusicXML`로 읽는다.

**결론.** "PPP가 쓰는 악보"의 품질은 경로마다 다른 곳에서 결정된다.

- Route R: `toMusicXml()`
- Route O: Audiveris와 앱의 merge·PdfLayer
- Route A: 편곡기

이 중 `toMusicXml()`만이 (a) 모든 녹음 경로의 수렴점이고, (b) 순수 함수라 CI에서 돈다. 그래서 G0의 P0 범위는 `toMusicXml()` 측정이다. OMR과 AMT는 환경 의존 tier(P1)로 측정한다.

### 1.3 음악 모델 (README "The music model")

```
Score   { id, title, composer, tempo, staves, measures[], notes[], sections[] }
Measure { number, index, startQ, lenQ, time{beats,beatType}, key{fifths,mode}, clefs{} }
Note    { m, b, dur, p, midi, hand, staff, voice, rest, chord, tieStop, type, dots, abs }
```

- 단위는 quarter note다.
- `m`은 **인쇄된** 마디 번호이고, `abs = measure.startQ + b`이다.
- `midi`는 ottava를 적용한 **소리 나는** 음이다 (`writtenMidi`는 따로 있다).
- `parseMusicXML()`은 `DOMParser`와 `querySelector`를 쓰므로 브라우저 전용이다. 앱 파일에서 떼어 Node로 옮기는 것은 불가능하다고 본다 (단일 HTML + Babel + 앱 내부 헬퍼 의존).

### 1.4 현재 테스트 구조

| 명령 | 내용 | 필요 환경 | 2026-09-21 확인 결과 |
| --- | --- | --- | --- |
| `npm test` | 26개 suite를 직렬 실행 (`import`, `memory`, …, `course`). 대부분 Puppeteer로 실제 앱을 띄워 DOM assertion | `npm start` (8777), 네트워크 (unpkg의 React/Babel), puppeteer. OMR·녹음 부분은 helper가 없으면 skip | 이번 조사에서는 실행하지 않음 (서버 미기동) |
| `npm run test:transcription-core` | `transcription_ensemble_test.py` (8), `evaluation_test.py` (2), `golden_benchmark_test.py` (3) | Python | **13/13 통과** |
| `npm run test:arranger` | `arranger_test.py` (3) | Python | **3/3 통과** |
| (없음) | `tests/beat_track_test.py` (3) | Python | **아무 스크립트도 실행하지 않는 고아 테스트.** 직접 실행하면 `ModuleNotFoundError: No module named 'beat_track'` (sys.path 누락). `PYTHONPATH=.`이면 3/3 통과 |
| `node tests/coach-live.test.js` | 실제 LLM 호출 1회, 수동 | API key | – |

- `tests/transcription.test.js`의 앞부분은 `audio-score.js`를 Node에서 직접 부르는 순수 검사다. `perform()`으로 waltz, Alberti, 6/8, triplets, 32nd, lock, PM2S grid를 합성한다.
- 그러나 파일 첫 줄에서 `puppeteer`를 require하고 뒤에서 브라우저를 띄우므로, 서버·브라우저 없이는 실행할 수 없다.
- 모든 테스트는 pass/fail assertion(`ok(name, cond, detail)`)이다. 수치 추적과 기준선이 없다.

### 1.5 기존 품질 측정 도구

- **`evaluate_transcription.py`**
  - 지표: note onset F1 (pitch 동일 + onset ±50 ms, greedy), offset F1, mean onset error, pedal IoU.
  - 입력은 MIDI/JSON이고 의존성이 없다.
  - `evaluate(reference, prediction, onset_tolerance, offset_tolerance, offset_ratio)`는 G0에서 **그대로 import해 재사용**한다.
- **`tests/golden_benchmark.py`** (2026-09-21 커밋 3개: `970e75e`, `24de2c2`, `718bdf3`)
  - 저장소 밖 manifest의 case마다 reference와 prediction 파일을 비교한다.
  - 단위: MusicXML끼리는 quarter-beat, JSON/MIDI는 초.
  - 단위가 섞이면 `alignment: tempo | prediction-beats`로 맞춘다.
  - 선택적 임계값: `minF1`, `minOffsetF1`, `maxOnsetErrorMs`, `expectedMeasures`, `expectedTempo`.
- **`tests/golden/README.md`, `manifest.example.json`**: 저작권 자료를 저장소 밖에 두라는 원칙을 담고 있다. 예시 manifest는 samples 파일을 **자기 자신과** 비교한다 (항상 F1 = 1.0).
- **`tmp/`** (untracked): 수동 실험 자료. gurenka·looping-rooms의 오디오, 예측 JSON, OMR 결과, 공식 PDF 등 **저작권 자료가 들어 있다**.
- **`_oh-sheet-compare/`** (untracked): 오픈소스 Oh-Sheet 저장소 clone. 참고한 점:
  - tier별 평가: note-level → structural(key/tempo/beat) → arrangement
  - suite+commit별 baseline 파일 (`eval/baselines/<suite>__<branch>_<sha>.json`)
  - PR CI + nightly

  코드는 가져오지 않는다 (mir_eval·librosa 의존).

### 1.6 사용 가능한 정답 데이터 (저장소 안, 라이선스-클린)

| 출처 | 파일 수 | 2-staff | 박자 분포 | 조표 분포 | 템포 누락 | 라이선스 |
| --- | --- | --- | --- | --- | --- | --- |
| `catalog/method/*/*.mxl` | 284 (작업 트리 기준) | 282 | 4/4 135, 2/4 59, 3/4 46, 6/8 24, 3/8 18, 2/2 2 | −3…+4 (C 184) | 25 | Beyer·Czerny 100은 PPP 전사 CC0, 나머지는 PDMX (PD/CC0) |
| `catalog/hymns/*.musicxml` | 100 | 100 | 4/4 62, 3/4 20, 6/4 6, 2/4 3, 6/8 3, 2/2 2, 3/2 2, 9/8 1 | −5…+4 | 0 | Open Hymnal (PD), 2-staff 축약 |
| `catalog/*.musicxml` | 3 (Gymnopédie 1, Für Elise, Happy Birthday) | 3 | 3/4 2, 3/8 1 | 0, 1, 2 | 0 | CC0 |
| `samples/*.musicxml` | 4 | 2 | 4/4 3, 3/4 1 | 0, 1 | 3 | PPP 자체 |

**주의**

- `catalog/method/` 아래에 **다른 세션이 작업 중인 untracked `.mxl` 약 120개**와 수정된 `index.json`이 있다 (`git status`). G0 suite는 **git에 커밋된 파일만** 쓴다 (lint L1).
- 391개 중 **122개에 pickup(implicit) 마디**, 56개에 붙임줄, 19개에 grace note, **30개에 `octave-shift`**가 있다 (대부분 PDMX의 `type="down"`, §14 I3). 여러 part인 파일은 1개, 중복 마디 번호는 0개다.
- `<mode>`가 없는 파일이 있다. 예: `catalog/fur-elise.musicxml`은 fifths 0으로 major로 읽히지만, 실제로는 A minor다.

### 1.7 조사 중 측정한 예비 수치 (probe — **공식 baseline 아님**)

**설정**

- 임시 reader: tie 병합, grace 생략.
- deadpan 합성 연주: 정확한 onset, 음 길이 −40 ms, 원곡 템포, 시작 1.0 s.
- 이를 `toMusicXml`에 넣어 391개 reference와 비교했다.
- 스크립트는 세션 scratchpad에 있었고 커밋하지 않는다. G0의 정식 구현이 이 수치를 대체한다.

| 지표 | onset 경로 (beats 없음) | oracle beats + downbeats (완벽한 Beat This 가정) |
| --- | --- | --- |
| 박자표 정확 일치 | 186/391 (**47.6%**) | 284/387 (**73.4%**) |
| 조표(fifths) 정확 일치 | 286/391 (73.1%) | 283/387 (73.1%) |
| 템포 — 악보에 **표기된** metronome ±4% | 79.6% | 90.3% |
| 템포 — 앱이 **실제 재생하는** `<sound tempo>` ±4% | **53.2%** | **74.3%** |
| 템포가 metrical 배수(×2, ×½, ×3, ×⅓, ×1.5, ×⅔) ±4% 안 | 97.8% | 100% |

- **주요 박자 혼동**
  - onset 경로: 2/4→6/8 42개, 4/4→6/8 35개, 3/4→6/8 28개, 3/4→4/4 24개
  - oracle 경로: 2/4→6/8 48개
- **개별 사례**
  - Gymnopédie: note F1 1.0인데 3/4를 6/8로 쓰고 붙임줄을 23개 만들었다 (정답에는 0개).
  - Beyer 8·9번 (C major): G major로 읽었다.
  - Beyer 9번: 손 배정 일치율 0.39.
- **속도**: 391개 reference를 읽는 데 3.2 s, `toMusicXml` 391회에 2.4 s (Node 프로세스 1개).

**해석**

1. 깨끗한 입력에서도 오류가 많다. 따라서 benchmark가 개선과 퇴행을 충분히 구별한다.
2. 정확한 onset에서도 틀리므로, 이 오류들은 AMT가 아니라 **notation 단계의 책임**이다.
3. 전체 suite도 1분 안에 돈다.

---

## 2. 문제점

| # | 문제 | 근거 |
| --- | --- | --- |
| P1 | **품질 변경이 측정 없이 머지된다.** 좋아졌는지 나빠졌는지 판정할 방법이 없다. | §1.1의 최근 사흘간 품질 커밋 13개 안팎. 각각 예제 몇 개로만 확인했다. 예비 수치에서 박자표 정확도는 47.6% (§1.7). |
| P2 | **기존 benchmark는 음 단위(note F1)만 본다.** 박자표, 조성, 마디, 음가, 손 배정, 철자, 붙임줄, 가독성 같은 "악보"의 품질을 재지 않는다. | Gymnopédie: F1 1.0인데 박자표가 틀리고 가짜 붙임줄이 23개 (§1.7). |
| P3 | **정답 세트가 저장소 밖(private)에만 있어** 재현·공유·CI가 불가능하다. 저장소 안 예시는 자기 자신과 비교한다. | `tests/golden/manifest.example.json` |
| P4 | **baseline과 회귀 판정 규칙이 없다.** 결과를 저장하지 않고, "이전보다 나빠졌다"를 정의하지 않는다. | `golden_benchmark.py`는 임계값 pass/fail만 있다. |
| P5 | **기존 metric reader가 앱과 다르게 읽는다** (측정 도구 자체가 검증되지 않았다). 표 아래 "P5의 세부 내용" 참조. | 코드 확인, 코퍼스 수치 §1.6 |
| P6 | **단위 표기가 틀렸다.** MusicXML끼리 비교할 때 tolerance 단위는 quarter-beat인데 `onset_tolerance_ms: 50`, `mean_onset_error_ms`로 적는다. 0.05 quarter는 120 BPM에서 25 ms다. | `tests/golden_benchmark.py` `run_case` |
| P7 | **앱이 실제로 쓰는 값과 파일에 보이는 값이 다를 수 있는데 이를 재지 않는다.** | 6/8 출력의 `<sound tempo>` 단위 (§14 I1). `Import.load`는 2차 인식 병합본을 채택해도 1차 `musicxml`을 반환한다 (§14 I4). |
| P8 | **환경 결정론이 깨진다.** Windows cp949 콘솔에서 비ASCII를 `print`하면 Python이 `UnicodeEncodeError`로 죽는다. 테스트 일부가 sys.path에 의존한다. | 조사 중 재현. `golden_benchmark.py`도 `ensure_ascii=False`로 print한다. `beat_track_test.py`가 고아다. |
| P9 | **CI가 없고, 빠른 순수 검사도 브라우저에 묶여 있다.** | `transcription.test.js`가 puppeteer를 require한다. 앱은 unpkg가 필요하다. `.github/` 없음. |
| P10 | **정답 데이터 자체의 불확실성을 관리하지 않는다.** | `<mode>` 누락(Für Elise), 템포 누락 25개, `octave-shift` 해석 논란 30개 파일 (§14 I3) |
| P11 | **과적합(teaching to the test)을 막는 장치가 없다.** 합성 예제만으로 휴리스틱을 조정하면 실제 녹음에서 나빠질 수 있다. | hold-out, 실제 AMT 출력 replay가 없다. |
| P12 | **여러 세션이 한 작업 트리를 동시에 편집한다.** 측정 인프라가 앱 파일이나 공용 파일을 많이 건드리면 충돌하고 서로의 테스트를 깬다. | 사용자 메모리 `parallel-sessions-one-file` |

P5의 세부 내용:

- pickup(implicit) 마디를 전체 마디 길이로 채운다. 그 뒤 모든 음 위치가 밀린다 (391개 중 122개 파일이 해당).
- grace note를 길이 0인 음으로 포함한다 (앱은 생략한다. 19개 파일).
- 붙임줄을 합치지 않아, 이어진 음을 새 타건으로 센다 (56개 파일).
- tempo로 **마지막** `<sound tempo>`를 쓰고 metronome 표기는 무시한다 (앱은 첫 번째 값을 쓰고 metronome도 읽는다).
- 마디 수를 인쇄된 번호의 최댓값으로 센다.
- 불과 몇 시간 전 커밋 `718bdf3`이, divisions/time이 마디마다 초기화되는 버그 때문에 "정상 전사가 완전 실패처럼 보이던" 문제를 고쳤다. **reader를 앱과 대조하는 테스트가 없다는 증거다.**

---

## 3. 목표 architecture

### 3.1 설계 원칙

1. **측정은 제품 코드를 바꾸지 않는다.** SUT는 read-only다. 변이 실험은 SUT 사본으로만 한다 (`--audio-score <path>`).
2. **결정론.** 같은 코드와 같은 입력이면 **바이트 단위로 같은 `results.json`**이 나와야 한다. 시간과 환경은 별도 파일(`run.json`)에 둔다.
3. **표준 라이브러리만 쓴다.** Python stdlib와 Node 내장만 쓰고 새 의존성은 금지한다.
4. **앱과 같은 의미로 읽고(app parity), 그 일치를 검사한다** (§8.2, T1-C).
5. **한 숫자에 기대지 않는다.** gate는 구성 metric별, 그룹(tag)별, 케이스별 catastrophe 규칙을 모두 본다.
6. **정답의 출처·라이선스·기대값을 명시적으로 기록한다.** 파일에서 암묵적으로 추론하지 않는다 (`expect` override).
7. **저작권 자료는 저장소에 들어오지 않는다.** private suite는 경로, 결과, baseline이 모두 저장소 밖이다.
8. **빠르다.** 개발 PC 기준 smoke < 15 s, core < 90 s, full < 10 min.
9. **Windows(cp949)와 Linux 모두에서 같은 결과**를 낸다.

### 3.2 Tier 구조

| Tier | 무엇을 재나 | 입력 | 필요 환경 | 실행 시점 | 우선순위 |
| --- | --- | --- | --- | --- | --- |
| **T0-N** Notation (synthetic) | `toMusicXml` 품질 | reference → 합성 연주 | Python + Node | 매 변경, CI | **P0** |
| **T0-G** Golden snapshot | `toMusicXml` 정확 출력 | 커밋된 고정 입력 | Python + Node | 매 변경, CI | **P0** |
| **T0-L** Legacy / private | 사용자의 private 매니페스트 | 저장소 밖 파일 | Python (+ Node) | 수동 | **P1** |
| **T0-R** Replay | 실제 AMT 출력에 대한 `toMusicXml` | 녹화된 helper JSON (커밋) | Python + Node | CI | **P1** |
| **T1-C** Parse conformance | reader ↔ 앱 `parseMusicXML` 일치 | corpus + notate 출력 | `npm start` + 네트워크 + puppeteer | 수동/주기 | **P1** |
| **T1-O** OMR live | Audiveris + 앱 merge/PdfLayer/validate | PDF/PNG fixture | `npm start` + `npm run omr` (Audiveris) + 네트워크 | 수동/주기 | **P1** |
| **T2-A** AMT live / record | `transcribe.py` + `beat_track.py` (+ notation) | 렌더한 WAV | helper + transcribe venv (+ GPU) | 수동 | **P1** |
| **T0-A** Arrangement invariants | `arrangeNotes`, `arrange_score.py` | reference | Python + Node | CI | **P2** |

- P0 = G0 필수.
- P1 = G0 필수. 단 환경이 없으면 "SKIPPED + 사유"를 기록하는 것까지가 요구사항이다.
- P2 = 여유가 있으면 한다. 안 하면 §11에 미완으로 명시한다.

### 3.3 데이터 흐름 (T0-N)

```
references.json ──► musicxml.read_score ──► canonical(ref) ──────────────────────────────┐
                                              │                                          │
      perform.perform(ref, profile, beats, seed) ──► performance JSON (+ truth)           │
                                              │        └─ sha256 → suites/<s>.lock.json   │
      node/notate.js  (batch JSONL; require audio-score.js 또는 --audio-score 사본)      │
                                              ▼                                          │
                                  {xml, stats}                                           │
                                              │                                          │
      musicxml.read_score(xml) ──► canonical(pred)   stats.barStarts / stats.beats        │
                                              ▼                                          │
      timemap: ref q→sec (합성 time map)  ·  pred q→sec (예측 격자)                         │
      align.align_timed (pitch별 단조 DP, ±300 ms) ◄─────────────────────────────────────┘
                                              ▼
      metrics.structure / notes / notation / readability / composite ──► case metrics
                                              ▼
      aggregate (전체, tag별)  ──► results.json (결정론적) · run.json (환경·시간) · summary.md
                                              ▼
      compare.compare(results, baselines/<s>.json, suite.gate) ──► PASS / REGRESSION / ERROR (exit 0/1/2)
```

### 3.4 핵심 결정과 이유 (ADR)

| ID | 결정 | 이유 | 버린 대안 |
| --- | --- | --- | --- |
| D1 | 평가 코어는 **Python stdlib**이고, Node는 SUT 실행 adapter만 맡는다 | Python에 XML·zip·Fraction이 내장되어 있다. 기존 `evaluate_transcription.py`와 `golden_benchmark.py`를 재사용할 수 있다. Node는 XML 파서가 없어 의존성이 필요하다. 이미 `test:transcription-core`가 Python이다. | 전부 Node (XML 파서 의존성 추가). 전부 브라우저 (느리고, 네트워크/CDN이 필요하고, CI가 불가능). |
| D2 | canonical reader가 **앱 parity 규칙**을 구현하고, T1-C가 일치를 검증한다 | benchmark는 "PPP가 보여주고 재생하는 것"을 재야 한다. | Puppeteer를 유일한 reader로 쓰기 (느리고 CI 불가). MusicXML 표준 해석만 쓰기 (앱과 어긋난다). |
| D3 | 코어 입력은 **reference에서 만든 합성 연주**다 | 결정론적이고 라이선스가 깨끗하며, notation 단계를 격리하고 빠르다. 실제 AMT 잡음은 T0-R/T2-A가, 실제 녹음은 private가 보완한다. | 실제 녹음을 커밋 (저작권, 크기, 비결정). |
| D4 | **초 단위 매칭 + 악보 단위 채점** | 템포가 2배거나 박자표가 틀리면 quarter-beat 매칭 F1이 0.09까지 떨어진다. 초 단위 매칭은 같은 출력에서 0.98이다 (probe, sonatina 1번). 음 보존과 표기 정확성을 분리해야 원인을 알 수 있다. | quarter-beat 위치만으로 매칭. |
| D5 | 위치는 **`tests/bench/`** | `server.js`의 `BLOCKED`가 `tests`를 막으므로 공개 배포에 노출되지 않는다. 기존 `golden_benchmark.py`와 같은 곳이다. | 최상위 `bench/` (공개 서빙되거나 `server.js` 수정 필요). |
| D6 | SUT 파일을 **수정하지 않는다**. 변이는 사본으로 한다 | 여러 세션이 편집 중이고, 측정 인프라가 측정 대상을 바꾸면 안 된다. | `audio-score.js`에 계측 필드 추가. |
| D7 | 생성 입력은 커밋하지 않고 **sha256 lock**을 둔다. 단 golden 입력은 커밋한다 | 전체 입력은 수십 MB다. lock은 생성기나 플랫폼 차이(drift)를 잡는다. golden은 SUT만 시험해야 하므로 입력을 고정한다. | 전부 커밋. |
| D8 | 난수는 **32-bit LCG** (transcription.test.js의 `rng`와 같다)와 **FNV-1a** seed를 쓴다. 생성기는 **libm 초월함수를 쓰지 않는다** | 사칙연산만 쓰면 IEEE-754로 플랫폼 간 비트가 같다. `math.sin`은 OS libm에 따라 마지막 ulp가 다를 수 있다. | `random.Random`, `math.sin` 드리프트. |
| D9 | gate는 **여러 metric + tag별 + 케이스별**로 본다. SQI는 대시보드용이다 | 한 그룹의 개선이 다른 그룹의 퇴행을 가릴 수 있고, 합성 점수는 게이밍될 수 있다. | SQI 하나로 판정. |
| D10 | 논란 있는 정답(`octave-shift`)은 **제외**한다 | 해석이 확정되지 않은 곳에 정답을 세우면 측정 전체가 오염된다. | 표준 해석으로 강행, 또는 앱 해석으로 강행. |

### 3.5 디렉터리 레이아웃

```
tests/bench/
  README.md                     # 사용법 (§10 Step 13)
  run.py                        # CLI 진입점 (§9.4)
  pppbench/
    __init__.py                 # 버전 상수: READER_VERSION="reader/1", METRICS_VERSION="metrics/1",
                                #            SQI_VERSION="sqi/1", GENERATOR_VERSION="perform/1"
    util.py                     # utf-8 stdio, sha256, fnv1a32, Lcg, Fraction 헬퍼, 결정론적 json dump
    canonical.py                # dataclass + to/from JSON (schema "ppp.canonical-score/1")
    musicxml.py                 # reader (.xml/.musicxml/.mxl) → canonical, 앱 parity 규칙
    corpus.py                   # references.json 로드, lint, derived tags
    perform.py                  # 합성 연주, 박 프로파일, time map
    timemap.py                  # ref/pred q→sec
    align.py                    # timed 정렬, symbolic 정렬
    stages.py                   # notate(Node batch), replay, legacy, arrange(P2)
    metrics/
      __init__.py
      structure.py              # 박자표·조성·템포·마디 수·downbeat
      notes.py                  # identity P/R/F1, onset F1@50ms, 타이밍 오차, input fidelity, AMT(evaluate 재사용)
      notation.py               # metrical scale, IOI, 위치, 음가, 손, 철자, 붙임줄, tuplet
      readability.py            # bar integrity, 음당 tie/tuplet/accidental, 손 스팬, 화음 크기
      composite.py              # SQI
      arrangement.py            # (P2)
    suite.py                    # suite schema, case 전개, lock
    runner.py                   # suite 실행 → results
    aggregate.py                # macro/micro, tag별
    compare.py                  # baseline 비교, gate
    report.py                   # summary.md
    golden.py                   # snapshot 비교, bless
    mutation.py                 # gate 민감도 검사
    legacy.py                   # tests/golden_benchmark.py manifest 실행 래퍼
  node/
    notate.js                   # JSONL batch adapter
    project-score.js            # (T1) 페이지 안에서 PPP Score → canonical JSON
    conformance.js              # (T1)
    omr-live.js                 # (T1)
  tools/
    make_micro.py               # micro 코퍼스 MusicXML 생성기 (결과를 커밋)
    make_omr_reference.py       # tests/fixtures/truth.json → reference MusicXML
    record_replay.py            # (T2) helper /transcribe 호출 → replay fixture
    render_piano.py             # (T2) Salamander 샘플로 WAV 렌더 (transcribe venv에서 실행)
  corpus/
    references.json             # 등록된 reference (§6.2)
    excluded.json               # 제외 목록과 사유
    micro/M01-waltz-3-4.musicxml … M24-block-chords.musicxml
    omr/piano-test-score.musicxml
  suites/
    smoke.json  smoke.lock.json
    core.json   core.lock.json
    full.json   full.lock.json
    golden.json
    mutation.json               # 민감도 검사용 (core deadpan 부분집합)
    replay-public.json (P1)  omr-live.json (P1)  amt-live.json (P1)  arrange.json (P2)
  baselines/
    smoke.json  core.json  full.aggregates.json  replay-public.json (P1)  omr-live.json (P1)
  golden/
    inputs/<caseKey>.json       # 고정 입력 (커밋)
    expected/<caseKey>.musicxml
    expected/<caseKey>.stats.json
    BLESS_LOG.md
  replay/                       # (P1) 녹화된 helper JSON fixture
  unit/                         # 코어 단위 테스트 (unittest). 이름을 tests/로 하지 않는다:
                                #   discover가 tests/bench를 sys.path 앞에 넣으면 저장소의 tests/와 이름이 겹친다
    __init__.py                 # discover -t tests/bench 에 필요
    fixtures/*.musicxml         # 손으로 쓴 작은 XML
    test_*.py
  out/                          # 실행 산출물 (gitignore)
  .cache/                       # 생성 입력 캐시 (gitignore)
```

---

## 4. 새로 만들 파일/모듈

모두 `tests/bench/` 아래에 둔다. **P0 = G0 필수 코어**, **P1 = G0 필수(환경 의존, 없으면 SKIPPED 기록)**, **P2 = 선택**.

| 경로 | P | 책임 | 핵심 API / 계약 |
| --- | --- | --- | --- |
| `run.py` | P0 | CLI. 하위 명령을 `pppbench`로 위임. 첫 줄에서 `util.setup_stdio()` | §9.4의 명령 전부 |
| `pppbench/__init__.py` | P0 | 버전 상수 | `READER_VERSION`, `METRICS_VERSION`, `SQI_VERSION`, `GENERATOR_VERSION` |
| `pppbench/util.py` | P0 | 공용 | `setup_stdio()` (stdout/stderr를 utf-8로 `reconfigure`) · `repo_root()` · `sha256_file(p)` · `sha256_bytes(b)` · `fnv1a32(s:str)->int` (UTF-8 바이트, offset 2166136261, prime 16777619, `& 0xFFFFFFFF`) · `class Lcg(seed)` · `.next()->float` (`s=(s*1664525+1013904223)&0xFFFFFFFF; return s/4294967296`) · `.uniform(a,b)` · `round_t(t)` (`math.floor(t*10000+0.5)/10000`) · `F(x)->Fraction` · `dump_json(obj, path)` (sort_keys, `ensure_ascii=False`, indent 1, float은 `round(x,6)`, NaN/Inf 금지 → ValueError, 끝에 `\n`) · `is_tracked(path)` (`git ls-files --error-unmatch`) |
| `pppbench/canonical.py` | P0 | canonical 자료형 | `Measure`, `Note`, `Rest`, `Sounding`, `CanonicalScore` (dataclass) · `to_json()` / `from_json()` · schema `"ppp.canonical-score/1"` (§8.1) |
| `pppbench/musicxml.py` | P0 | MusicXML → canonical | `read_bytes(path)->bytes` (mxl: `META-INF/container.xml`의 rootfile, 없으면 가장 큰 xml) · `read_score(src, *, source_path=None)->CanonicalScore` · `class ReaderError(Exception)` (`.code`: `bad-xml`, `timewise`, `no-parts`, `no-measures`, `no-notes`). 규칙은 §8.2 |
| `pppbench/corpus.py` | P0 | 코퍼스 | `load_corpus()->List[RefEntry]` · `derived_tags(canon)->List[str]` · `lint(entries)->List[LintIssue]` (§6.3) |
| `pppbench/perform.py` | P0 | 합성 연주 | `PROFILES`, `BEAT_PROFILES` (§6.6) · `TimeMap(canon, qpm, start_s, drift, period_q)` (`.sec(q)`, `.bar_starts()`, `.tactus_times()`) · `perform(canon, ref_id, profile, beats, seed, *, expect)->Performance` (`.input` = helper 모양 dict, `.truth` = 음별 `{ref_sounding_id or None, nominal_on, nominal_off}`, `.ref_bar_starts`, `.expected` = {qpm, time, key, measures}) |
| `pppbench/timemap.py` | P0 | q→sec | `RefTime.from_timemap(tm)` · `RefTime.from_bar_starts(canon, bar_starts_s)` · `pred_q_to_sec(pred_canon, stats)->Callable[[Fraction], float]` (§8.3) |
| `pppbench/align.py` | P0 | 정렬 | `align_timed(ref:[(id,midi,t)], pred:[(id,midi,t)], window_s=0.30)->[(rid,pid,dt)]` · `align_symbolic(ref_canon, pred_canon)->SymbolicAlignment` (P1에서 필요, 구현은 P0 권장) |
| `pppbench/stages.py` | P0 | SUT 실행 | `notate_batch(jobs:[{id,input,opts}], *, audio_score=None, node=None)->{id: {ok, xml, stats, error, code, ms}}` (Node는 1회만 띄운다) · `replay(...)` (P1) · `legacy(...)` (P1) · `arrange_audio(...)`, `arrange_score(...)` (P2) |
| `pppbench/metrics/*.py` | P0 | metric | 각 모듈이 `compute(ctx)->Dict[str, Optional[float]]`를 제공. `ctx` = {ref, pred, stats, perf, alignment, expected}. 정의는 §8.4 |
| `pppbench/metrics/composite.py` | P0 | SQI | `sqi(metrics)->Optional[float]`, `sqi_symbolic(metrics)` (§8.5) |
| `pppbench/suite.py` | P0 | suite | `load_suite(name_or_path)` · `expand(suite, corpus)->List[Case]` · `lock(cases)->dict` · `verify_lock(suite, cases)->List[Drift]` |
| `pppbench/runner.py` | P0 | 실행 | `run_suite(suite, *, audio_score=None, out_dir=None, jobs=1, filter=None, reveal_holdout=False)->RunResult`. 결과를 케이스 id로 정렬해서 쓴다 |
| `pppbench/aggregate.py` | P0 | 집계 | `aggregate(cases)->{"all":{...}, "by_tag":{tag:{...}}}` (§8.6) |
| `pppbench/compare.py` | P0 | gate | `compare(results, baseline, gate)->Verdict{status, failures[], warnings[], improvements[]}` · exit code 0/1/2 (§9.3) |
| `pppbench/report.py` | P0 | 보고서 | `write_summary(results, run, verdict, path)` (§9.1) |
| `pppbench/golden.py` | P0 | snapshot | `run_golden(bless=False, reason=None)->int` (§7) |
| `pppbench/mutation.py` | P0 | 민감도 | `MUTATIONS` (§9.5) · `run_mutation_check()->int` |
| `pppbench/legacy.py` | P1 | 레거시 | `tests/golden_benchmark.py`를 import해서 `run_case`를 그대로 호출 → 새 결과 형식으로 변환 |
| `node/notate.js` | P0 | SUT adapter | `node tests/bench/node/notate.js --in jobs.jsonl --out out.jsonl [--audio-score path]` (§4.1) |
| `node/project-score.js` | P1 | 페이지 안 projection | `window.__pppProject(score) -> canonical JSON` (§8.1 schema) |
| `node/conformance.js` | P1 | T1-C | 파일 목록 → 페이지에서 `PPP.parseMusicXML` → projection → JSONL |
| `node/omr-live.js` | P1 | T1-O | fixture → 페이지에서 `PPP.Import.load(File)` → `{canonical, report, engine, pages}` JSONL |
| `tools/make_micro.py` | P0 | micro 생성 | §6.4 표를 코드로 옮긴다. 결과 `corpus/micro/*.musicxml`을 커밋 |
| `tools/make_omr_reference.py` | P1 | OMR 정답 | `tests/fixtures/truth.json` → `corpus/omr/piano-test-score.musicxml` |
| `tools/record_replay.py` | P1 | T2 녹화 | WAV → helper `POST /transcribe` → poll → replay fixture (§6.8) |
| `tools/render_piano.py` | P1 | WAV 렌더 | Salamander MP3(ffmpeg 디코딩) + 음정 이동(±1 반음) + release fade → 44.1 kHz 16-bit WAV |
| `corpus/references.json` | P0 | 코퍼스 목록 | §6.2 |
| `corpus/excluded.json` | P0 | 제외 목록 | `[{"path","reason"}]` |
| `corpus/micro/*.musicxml` | P0 | micro 정답 | §6.4 |
| `suites/*.json`, `*.lock.json` | P0 | suite | §6.5, §9 |
| `baselines/*.json` | P0 | baseline | §9.2 |
| `golden/**` | P0 | snapshot | §7 |
| `unit/__init__.py`, `unit/test_*.py`, `unit/fixtures/` | P0 | 단위 테스트 | §10 각 Step의 테스트 목록 |
| `README.md` | P0 | 사용법 | §10 Step 13 |
| `.github/workflows/bench.yml` | P1 | CI | §9.8. **push 전에 사용자 확인** |

### 4.1 `node/notate.js` 계약

- 입력 JSONL 한 줄: `{"id": str, "input": {...helper 모양...}, "opts": {...}}`
  - `input` 키: `notes:[{on,off,midi,vel}]`, `pedals:[]`, `beats?`, `downbeats?`, `beatConfidence?`, `grid?`, `title`
  - `opts` 키: `title`, `lock?`, `arrangement?`, `easy?`, `beatsPerBar?`
- 동작: `const A = require(audioScorePath)`. 기본 경로는 `path.join(repoRoot, 'audio-score.js')`이고, `--audio-score` 인자나 환경변수 `PPP_BENCH_AUDIO_SCORE`로 바꿀 수 있다. 각 줄마다 `A.toMusicXml(input, opts)`를 부른다.
- 출력 JSONL 한 줄: `{"id", "ok": true, "xml", "stats", "ms"}` 또는 `{"id", "ok": false, "error": e.message, "code": e.code||null, "ms"}`
- 마지막 줄: `{"meta": {"audio_score_path", "audio_score_sha256", "node": process.version}}`
- 입력 순서를 보존한다. `Date`, `Math.random`은 쓰지 않는다 (`ms`는 `process.hrtime.bigint()`로 재고, 결과의 `timing`에만 쓴다).
- 예외 하나가 배치를 멈추게 하지 않는다.

---

## 5. 수정할 기존 파일

**원칙: 새 파일만 추가한다. 아래 표의 파일만 최소한으로 바꾼다.** 여러 세션이 같은 트리를 쓰므로 편집 전에 `git diff <file>`로 남의 미커밋 변경이 있는지 보고, 정확한 문자열 치환으로만 고친다.

| 파일 | 변경 | 이유 |
| --- | --- | --- |
| `package.json` | `scripts`에 네 개 추가: `"bench": "python tests/bench/run.py run --suite core && python tests/bench/run.py check --suite core"`, `"bench:smoke": "python tests/bench/run.py run --suite smoke && python tests/bench/run.py check --suite smoke"`, `"bench:full": "python tests/bench/run.py run --suite full"`, `"test:bench": "python -m unittest discover -s tests/bench/unit -t tests/bench && python tests/bench/run.py golden"`. `test:transcription-core` 끝에 ` && python tests/beat_track_test.py` 추가. **dependencies와 다른 scripts는 건드리지 않는다.** | 진입점, 고아 테스트 편입 |
| `.gitignore` | 줄 추가: `tests/bench/out/`, `tests/bench/.cache/`, `__pycache__/` | 산출물·캐시 |
| `tests/beat_track_test.py` | 첫 import 앞에 2줄: `import os, sys` / `sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))` (다른 Python 테스트와 같은 방식) | 고아 테스트 복구 |
| `tests/README.md` | 끝에 "Quality benchmark (tests/bench)" 절: 명령 4개와 `tests/bench/README.md` 링크 | 발견성 |
| `tests/golden/README.md` | 끝에 한 단락: 새 runner의 `legacy` 명령으로 같은 manifest를 실행하고 baseline을 남기는 법. **기존 내용은 그대로 둔다** | 연결 |
| `README.md` | "Files" 표에 `tests/bench/` 한 줄 추가. "Making a score from a recording"의 `evaluate_transcription.py` 단락 뒤에 한 문장: notation 품질은 `npm run bench`로 잰다 | 발견성 |

**권장하지만 사용자 확인이 필요한 것** (구현 세션이 묻는다):

- `.gitignore`에 `tmp/` 추가. 저작권 오디오와 PDF가 있어 `git add .` 사고를 막는다. 사용자 소유 디렉터리라 확인 후에만 한다.
- `.github/workflows/bench.yml` 추가 후 push. 외부 서비스(GitHub Actions)에서 실행된다.

**수정하지 않는 파일** (§13에 전체 목록): `audio-score.js`, `Piano Coach App.dc.html`, `tests/golden_benchmark.py`, `evaluate_transcription.py`, `omr-service.js`, `transcribe.py`, `beat_track.py`, `arrange_score.py`, `server.js`, `catalog/**`, 기존 테스트의 assertion.

---

## 6. Benchmark 악보(코퍼스)와 케이스 구성

### 6.1 출처와 라이선스

| set | 경로 | 라이선스 근거 | G0 사용 |
| --- | --- | --- | --- |
| `micro` | `tests/bench/corpus/micro/` (신규) | PPP가 직접 작성, CC0 | 전부 |
| `catalog` | `catalog/*.musicxml` | `catalog/index.json` "CC0" | 전부 |
| `samples` | `samples/prelude-fragment.musicxml` | PPP 자체 | core에 1개. 나머지는 parity 단위 테스트용 |
| `hymns` | `catalog/hymns/*.musicxml` | `catalog/hymns/README.md`: Open Hymnal (PD) | 전부 (lint 통과분) |
| `method` | `catalog/method/*/*.mxl` | `catalog/method/index.json` license: Beyer·Czerny 100은 PPP 전사 CC0, 나머지는 PDMX PD/CC0 | 커밋된 파일 중 lint 통과분 |
| `omr` | `tests/fixtures/piano-*` + `truth.json` | PPP가 VexFlow로 생성 | T1-O |

### 6.2 `references.json` schema

```json
{
  "schema": "ppp.bench-corpus/1",
  "references": [
    {
      "id": "method/beyer/008",
      "path": "catalog/method/beyer/008.mxl",
      "sha256": "…파일 sha256…",
      "set": "method",
      "book": "beyer",
      "license": "CC0 — transcribed for PPP from the Peters edition (catalog/method/index.json)",
      "expect": { "tempo_qpm": 100 },
      "holdout": false,
      "note": ""
    },
    {
      "id": "catalog/fur-elise",
      "path": "catalog/fur-elise.musicxml",
      "sha256": "…",
      "set": "catalog",
      "license": "CC0 (catalog/index.json)",
      "expect": { "key": { "fifths": 0, "mode": "minor" } },
      "holdout": false,
      "note": "파일에 <mode>가 없어 major로 읽힘. 실제 A minor."
    }
  ]
}
```

- `id` 규칙: `micro/<Mxx-name>`, `catalog/<name>`, `samples/<name>`, `hymns/<name>`, `method/<book>/<no>`.
- `expect`는 선택이다.
  - `tempo_qpm`: 파일에 템포가 없으면 **필수**.
  - `key`: `{fifths, mode}`. mode 정보가 없거나 틀릴 때 쓴다.
  - `time`: `[beats, beatType]`, 드물게 쓴다.
  - `skip_metrics`: 예 `["notation.hand.accuracy"]`.
- `holdout`: `set`이 `hymns` 또는 `method`이고 `fnv1a32(id) % 5 == 0`이면 `true`로 둔다. micro·catalog·samples는 smoke/golden에 이름으로 쓰이므로 holdout이 될 수 없다. 초기 등록 때 계산해서 적어 두고, 이후에는 **바꾸지 않는다**.
- 태그는 저장하지 않는다. `corpus.derived_tags()`가 canonical에서 실행 시 계산한다 (§6.7). 저장하는 것은 `set`, `book`, `license`, `expect`, `holdout`뿐이다.

### 6.3 Lint 규칙 (`run.py lint-corpus`)

| ID | 규칙 | 실패 시 |
| --- | --- | --- |
| L1 | 파일이 존재하고 **git에 커밋됨** (`git ls-files --error-unmatch`) | error |
| L2 | `sha256`이 일치 | error (정답이 바뀌었다 → 재등록·재baseline이 필요) |
| L3 | `read_score` 성공, sounding 음 ≥ 8 | error |
| L4 | 템포가 있거나 `expect.tempo_qpm`이 있음 | error |
| L5 | `octave-shift`가 없음 | 제외 (`excluded.json`에 사유 `octave-shift semantics unresolved (§14 I3)`) |
| L6 | 중복 마디 번호 없음 | 제외 |
| L7 | part가 1개이거나, 2 staff 이상인 piano part가 있음 | warning |
| L8 | reference 자체의 bar integrity가 100% (implicit 첫/끝 마디 예외) | 제외 |
| L9 | `<mode>`가 명시되어 있거나 `expect.key.mode`가 있음 | warning (없으면 `struct.key.mirex`가 null) |
| L10 | `license`가 비어 있지 않음 | error |
| L11 | 같은 `id` 중복 없음, `set` 값이 허용 목록 안 | error |

### 6.4 Micro 코퍼스 (신규 24곡)

- `tools/make_micro.py`가 아래 표대로 MusicXML을 쓰고, 그 결과를 커밋한다.
- 공통 형식: `divisions=24`, 한 part에 2 staff (staff 1 = G clef, staff 2 = F clef), `<key><fifths/><mode/></key>`를 명시.
- 템포는 `<direction><direction-type><metronome>` + `<sound tempo="qpm">`로 적고, 둘을 **일치**시킨다. compound 박자는 metronome을 점4분(beat-unit-dot)으로, `sound tempo`는 quarter/min으로 쓴다.
- LH에 지속음과 움직이는 화음이 겹치면 voice를 둘로 나눈다 (voice 5/6, `backup` 사용).
- 각 곡은 정답이 명백해야 한다. `expect`는 references.json에 모두 적는다.

| ID | 박자 | 조 | qpm | 마디 | 내용 | 무엇을 시험하나 |
| --- | --- | --- | --- | --- | --- | --- |
| M01-waltz-3-4 | 3/4 | G major (1) | 96 | 16 | LH: 1박 bass 점2분 (G2/D2/E2/D2 순환) + 2·3박 3화음 4분 (voice 6). RH: 4분 선율 `B4 D5 G5 F#5 E5 D5 C5 B4 C5 D5 E5 D5` 반복 | 3박, 손 분리, 조성 |
| M02-alberti-4-4 | 4/4 | C major (0) | 112 | 12 | LH: 알베르티 8분 (C-G-E-G / C-A-F-A / B-G-F-G / C-G-E-G). RH: 4분·2분 선율 | 8분 LH, 4박, 템포 수준 |
| M03-jig-6-8 | 6/8 | G major (1) | 90 (♩.=60) | 8 | LH: 점4분 bass 2개/마디. RH: 8분 6개/마디 | compound 박자 |
| M04-triplets-4-4 | 4/4 | C major (0) | 100 | 4 | LH: 온음표 C3. RH: 모든 박에 8분 셋잇단 | tuplet |
| M05-32nds-120 | 4/4 | C major (0) | 120 | 2 | 1마디 RH: 32분 음계 상행·하행 (32개). LH: 4분 화음 | 빠른 run 보존 |
| M06-32nds-176 | 4/4 | C major (0) | 176 | 2 | M05와 같은 음, 템포만 다름 | 42 ms 간격 run |
| M07-pickup-3-4 | 3/4 | F major (−1) | 108 | 1박 pickup + 8 | 첫 마디 `implicit="yes"` 4분 1개 (C5). 이후 LH 화음, RH 선율 | 못갖춘마디 |
| M08-pickup-4-4 | 4/4 | D major (2) | 96 | 8분 2개 pickup + 8 | 첫 마디 implicit (8분 A4 B4) | pickup 위상 |
| M09-syncopation-ties | 4/4 | C major (0) | 100 | 8 | RH: 8-4-8 당김음, 2·3박 사이 붙임줄, 마디선 넘는 붙임 2분음. LH: 2분 화음 | 붙임줄, 당김 |
| M10-dotted | 4/4 | B♭ major (−2) | 92 | 8 | RH: 점8분+16분 쌍. LH: 4분 bass | 점음표 vs 셋잇단 오판 |
| M11-harmonic-minor | 3/4 | A minor (0, minor) | 84 | 8 | i–iv–V–i, 선율에 G#4/G#5 | 단조 이끎음 철자 |
| M12-flats-db | 4/4 | D♭ major (−5) | 76 | 8 | 화음 반주 + 선율, 모든 음이 조표 안 | 플랫 철자 |
| M13-sharps-chromatic | 4/4 | E major (4) | 100 | 8 | 반음계 경과음 (A#, D natural, B#를 쓰지 않는 C natural) | 샵·반음계 철자 |
| M14-melody-in-bass | 4/4 | C major (0) | 90 | 8 | LH 선율 C3–C4 8분·4분, RH 지속 화음 (E4–C5) | 손 배정 |
| M15-wide-chords | 4/4 | G major (1) | 72 | 8 | LH 10도 (G2+B3 등), RH 4–5음 화음 | 연주 가능성 metric |
| M16-long-notes-rests | 4/4 | F major (−1) | 80 | 8 | 온음표, 2분쉼표, 한 손 마디쉼표 | 긴 음가, 쉼표 |
| M17-march-2-4 | 2/4 | C major (0) | 116 | 16 | LH 움-파 8분, RH 8분·16분 | 2/4 vs 4/4 |
| M18-alla-breve | 2/2 | G major (1) | 144 (𝅗𝅥=72) | 8 | 2분음 박, 4분 선율 | 2/2 템포 수준 |
| M19-fast-3-8 | 3/8 | D minor (−1, minor) | 92 (♪=184) | 16 | 8분 3개/마디, LH 점4분 | 3/8 vs 6/8 |
| M20-compound-12-8 | 12/8 | E♭ major (−3) | 99 (♩.=66) | 4 | LH 점4분 4개, RH 8분 | 12/8 |
| M21-five-four | 5/4 | A minor (0, minor) | 100 | 6 | 3+2 강세 bass | 불규칙 박자 (현재 미지원이 예상됨. 향후 추적용) |
| M22-tempo-change | 4/4 | C major (0) | 120 → 80 (5마디부터 `<sound tempo="80">`) | 8 | 단순 선율+화음 | 템포 변화 (expect.tempo_qpm = 120) |
| M23-repeated-notes | 4/4 | C major (0) | 132 | 4 | RH G5 16분 연타, LH 4분 화음 | 같은 음 연타 (clustering, 정렬) |
| M24-block-chords | 4/4 | G major (1) | 60 | 8 | 온음표 화음만 | 리듬 정보 부족 (`samples/chords-sample`과 같은 성격) |

### 6.5 Suites

**모든 suite는 reference id 목록을 명시적으로 적는다.** 실행 시 계산하지 않는다. catalog에 파일이 추가되어도 suite가 조용히 바뀌지 않게 하려는 것이다. 선택 알고리즘은 `run.py select-core`가 **한 번** 돌려 JSON에 쓰는 도구로만 쓴다.

#### suite 파일 schema

```json
{
  "schema": "ppp.bench-suite/1",
  "name": "core",
  "kind": "synthetic-notation",
  "description": "CI gate: stratified 148 references × 3 main profiles + AMT/rubato subsets",
  "stage": { "name": "notate", "opts": {} },
  "references": ["micro/M01-waltz-3-4", "catalog/gymnopedie-1", "hymns/amazing-grace", "method/beyer/008", "…"],
  "matrix": [
    { "profile": "deadpan", "beats": "none",   "seeds": [1] },
    { "profile": "human",   "beats": "none",   "seeds": [1] },
    { "profile": "human",   "beats": "oracle", "seeds": [1] },
    { "profile": "amt",     "beats": "oracle-noisy", "seeds": [1], "subset": "amt-subset" },
    { "profile": "rubato",  "beats": "oracle", "seeds": [1], "subset": "rubato-subset" }
  ],
  "subsets": {
    "amt-subset":    ["…60 ids…"],
    "rubato-subset": ["…40 ids…"]
  },
  "align": { "window_s": 0.30 },
  "gate": { "…": "§9.3" }
}
```

#### Suite 구성

| suite | reference | matrix | case 수 (대략) | 용도 | 목표 시간 |
| --- | --- | --- | --- | --- | --- |
| `smoke` | 16개 (아래) | deadpan/none, human/oracle | 32 | 커밋 전 빠른 확인 | < 15 s |
| `core` | 148개 (아래 할당) | deadpan/none, human/none, human/oracle (전부) + amt/oracle-noisy (60) + rubato/oracle (40) | ≈ 544 | **CI gate** | < 90 s |
| `full` | lint를 통과한 전부 (holdout 포함) | deadpan/none, human/none, human/oracle, rubato/oracle, amt/oracle-noisy, amt/none, human/lowconf × seeds [1, 2] | ≈ 5,000 | 야간/수동, holdout 보고 | < 10 min |
| `mutation` | core와 같음 | deadpan/none | 148 | §9.5 민감도 검사 | < 30 s/회 |
| `golden` | §7 | 고정 입력 | 14 | snapshot | < 5 s |

**smoke reference** (민감도를 위해 2-staff, 비-C 조, 비-4/4, 음가 다양성을 고루 넣는다):

- micro 10개: M01, M02, M03, M04, M05, M07, M09, M11, M12, M14
- `catalog/gymnopedie-1`, `catalog/happy-birthday`
- hymns 2개: 비-4/4 하나와 flat 3개 이상 조 하나
- method 2개: `czerny599` 2/4 하나, `sonatina` 하나

구현자는 lint 통과분에서 조건에 맞는 id를 `fnv1a32` 오름차순으로 골라 적는다.

**core 할당** (lint 통과, `holdout=false`, 커밋된 파일만):

- micro 24개 전부, catalog 전부 (최대 3개), `samples/prelude-fragment`
- hymns 40개: `metre-class`별 버킷에서 `fnv1a32(id)` 오름차순으로 뽑는다.
  - `simple-quadruple` 20개, `simple-triple` 10개
  - 나머지 박자(duple, compound, 2/2, 3/2, 6/4, 9/8)는 있는 만큼, 최대 10개
- method 80개: 책별 할당 beyer 16, czerny599 16, czerny849 10, hanon 8, burgmuller25 10, sonatina 14, czerny299 최대 6.
  - 책 안에서는 `metre-class` round-robin으로, 각 class는 `fnv1a32` 순서로 뽑는다.
  - 할당보다 적으면 다른 책으로 넘기지 않는다 (개수가 줄어도 된다).
- `amt-subset`: core reference 중 `fnv1a32(id)` 오름차순 60개 (micro 제외).
- `rubato-subset`: 그다음 40개.

**holdout 규칙**

- `holdout=true` reference는 smoke, core, mutation에 **넣지 않는다**. `full`에만 seed [11, 12]로 넣는다.
- 보고서에서 holdout은 **집계만** 보여준다. 케이스별로 보려면 `--reveal-holdout`을 명시해야 한다.
- 이후 goal에서 휴리스틱을 조정할 때는 holdout 케이스를 들여다보지 않는다. PR에는 holdout 집계 변화를 함께 보고한다.

### 6.6 연주 프로파일과 박 프로파일

#### 연주 프로파일 (`perform.PROFILES`)

| profile | onset jitter J (s, 균등 ±J) | 템포 drift A | drift 주기 P (quarter) | release gap (s) | 세기 잡음 V | 굴림 화음 | AMT 오류 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `deadpan` | 0 | 0 | – | 0.040 고정 | 0 | 없음 | 없음 |
| `human` | 0.015 | 0 | – | U(0.02, 0.08) | ±8 | 같은 손 동시 3음 이상 onset 묶음에 p = 0.25, 아래 음부터 12 ms 간격 | 없음 |
| `rubato` | 0.025 | 0.10 | 14 | U(0.02, 0.08) | ±8 | p = 0.25 | 없음 |
| `amt` | 0.020 | 0.04 | 14 | U(0.02, 0.10) | ±12 | p = 0.25 | 아래 표 |

#### `amt` 오류 모델

**실제 AMT 분포를 주장하지 않는다.** 흔한 실패 양상을 흉내 낸 것이고, 실제 분포는 T0-R/T2-A가 다룬다.

| 오류 | 규칙 |
| --- | --- |
| 누락 | 음마다 기본 p = 0.03. 연주 길이 < 0.10 s이면 +0.03, 같은 onset 묶음의 안쪽 음(최저·최고가 아닌 음)이면 +0.02 |
| 유령음 | 음마다 p = 0.02. 음정 +12 (70%) 또는 +19 (30%), 108을 넘으면 생략. 세기 = 원음 × 0.5, onset = 원음 + U(0, 0.02), 길이 U(0.06, 0.15) |
| 연타 병합 | 같은 음 연속 두 음의 간격 < 0.03 s이면 p = 0.5로 앞 음에 합친다 (off = 뒤 음 off) |
| offset 잡음 | off += U(−0.15, +0.15) × (off − on), 최소 길이 0.05 s |

#### 박 프로파일 (`perform.BEAT_PROFILES`)

| beats | `input.beats` | `input.downbeats` | `beatConfidence` | 시험하는 경로 |
| --- | --- | --- | --- | --- |
| `none` | 없음 | 없음 | 없음 | onset tracking (Ellis DP) |
| `oracle` | tactus 시각 전부 (time map) | implicit가 아닌 모든 마디의 시작 | 0.90 | 완벽한 Beat This 가정 (production 경로) |
| `oracle-noisy` | oracle + U(−0.02, 0.02), 각 beat 5% 누락 | 같은 잡음과 누락 | 0.60 | 현실적 tracker |
| `lowconf` | oracle | oracle | 0.30 | `< 0.42` fallback 경로 |

**tactus 규칙**

- beat-type 8이고 beats % 3 == 0 (6/8, 9/8, 12/8, 3/8): 점4분
- beat-type 4: 4분
- beat-type 2: 2분
- 그 밖 (5/8, 7/8 등): 8분

tactus 격자는 **implicit가 아닌 첫 마디의 시작**을 기준으로 앞뒤로 tactus 간격마다 둔다. 그중 [0, 마지막 마디 끝] 구간에 들어가는 q만 `TimeMap.sec(q)`로 초로 바꿔 쓴다. q = 0에서 시작하면 8분 하나짜리 pickup처럼 박 길이의 정수배가 아닌 pickup에서 격자가 마디선과 어긋난다.

#### 연주 생성 알고리즘 (의사코드, `perform.perform`)

```
qpm      = expect.tempo_qpm or canon.tempo.effective_qpm or 100
start_s  = 1.0 + 0.25 * (fnv1a32(ref_id) % 5)                 # 1.0–2.0 s, reference마다 다르게
rng      = Lcg(fnv1a32(case_id_without_seed) ^ ((seed * 0x9E3779B1) & 0xFFFFFFFF))

# time map: 1/96 quarter 격자에서 누적. 사칙연산과 floor/abs만 쓴다.
tri(x)   = 1 - 4*abs((x - floor(x)) - 0.5)                    # 주기 1, 범위 [-1, 1]
m(q)     = 1 + A * tri(q / P)                                  # A = 0이면 1
tempo(q) = 해당 위치의 reference tempo mark (tempo 변화 반영; 없으면 qpm)
spq(q)   = 60 / (tempo(q) * m(q))
sec(q)   = start_s + Σ_{k: q_k < q} spq(q_k + Δ/2) * Δ         # Δ = 1/96, 마지막 조각은 선형 보간

# sounding 음을 (onset_q, staff, midi) 순으로 정렬하고, 난수를 다음 순서대로 뽑는다:
# 1) onset 묶음(같은 onset_q, 같은 hand)마다: roll? (profile에 굴림이 있을 때)
# 2) 음마다: jitter, release gap, velocity 잡음, [amt: drop?, ghost?, ghost 음정, ghost 길이]
# 3) (amt) 연타 병합: 전체를 (on, midi)로 정렬한 뒤 앞에서부터 결정
on   = sec(onset_q) + jitter (+ roll offset)
off  = max(on + 0.05, sec(onset_q + dur_q) - release_gap)
vel  = clamp(64 + 12*(RH 묶음 최고음) + 6*(LH 묶음 최저음) + 6*(human 이상이고 마디 첫 박) + noise, 20, 110)
on, off = round_t(on), round_t(off)                           # floor(x*10000+0.5)/10000

truth: 각 출력 음 → {ref_sounding_id | None(유령음), nominal_on = sec(onset_q), nominal_off = sec(onset_q+dur_q)}
expected: {qpm: 첫 tempo mark 또는 expect, time: expect.time 또는 reference의 주 박자표(마디 길이 가중 최빈값, §8.4),
           key: expect.key 또는 첫 마디 key,
           measures: len(canon.measures), bar_starts: [sec(m.start_q) for m in measures if not m.implicit]}
input: {notes:[{on,off,midi,vel}] (on, midi 순 정렬), pedals: [], title: "bench", + 박 프로파일 필드}
opts:  {title: "bench"}  (+ case 옵션)
```

### 6.7 Case ID, 태그, 결정론

- Case ID: `"<refId>|<profile>|<beats>|s<seed>"`, 옵션이 있으면 뒤에 `"|opt:<name>"`. 산출물 파일명은 `caseKey = sha256(caseId)[:12]`이다.
- **derived tags** (실행 시 계산해 case에 붙인다)
  - reference 파생
    - `set:*`, `book:*`
    - `metre:<b>/<t>`
    - `metre-class:{simple-duple|simple-triple|simple-quadruple|compound-duple|compound-triple|compound-quadruple|irregular}`: beat-type 8이고 beats % 3 == 0이면 compound, 그룹 수 = beats/3. 그 밖에 beats가 2/3/4이면 simple. 나머지는 irregular.
    - `key:<fifths>`, `mode:{major|minor|unknown}`
    - `staves:<n>`, `size:{s|m|l}`: sounding 음 < 100이면 s, < 400이면 m, 그 이상이면 l.
    - `feature:{pickup, tuplets, ties, tempo-change, dense-chords, fast-runs, low-information}`
      - `dense-chords`: onset 묶음당 평균 음 수 ≥ 3
      - `fast-runs`: 최소 IOI ≤ 0.125 s (expected qpm 기준)
      - `low-information`: 서로 다른 onset 수 < 2 × 마디 수
  - case 파생: `profile:*`, `beats:*`, `seed:*`, `holdout`
- **Lock** (`suites/<s>.lock.json`): `{"schema":"ppp.bench-lock/1", "suite_sha256", "generator": GENERATOR_VERSION, "reader": READER_VERSION, "cases": [{"id", "reference_sha256", "input_sha256"}]}`
  - `input_sha256` = `dump_json` 직렬화한 `{input, opts}`의 sha256
  - `run`은 실행 전에 lock을 검증한다. 다르면 **ERROR `INPUT_DRIFT`** (exit 2)를 내고, 어떤 case의 무엇이 바뀌었는지 출력한다.
  - 의도한 변경이면 `run.py relock --suite <s> --reason "…"` 후 baseline을 다시 기록한다.

### 6.8 Replay fixture (P1, T0-R) 형식

```json
{
  "schema": "ppp.replay-case/1",
  "id": "replay/hymns/amazing-grace|salamander-v1|human|s1",
  "reference": "hymns/amazing-grace",
  "reference_sha256": "…",
  "render": { "renderer": "render_piano.py/1 (Salamander V3, CC BY 3.0)", "profile": "human", "seed": 1, "qpm": 100, "start_s": 1.5 },
  "truth": { "bar_starts_s": [ … ], "notes": [ {"midi":67, "on":1.5, "off":2.06, "ref_sounding_id": 0} ] },
  "helper_result": { "…/transcribe job result 그대로: notes, pedals, beats, downbeats, beatConfidence, engine, ensemble, …": "" },
  "provenance": { "recorded_at": "2026-…", "git_sha": "…", "device": "cuda", "engines": {"transkun": "2.0.1", "…": "…"}, "helper": "omr-service.js@<sha>" }
}
```

- 녹화 절차 (`tools/record_replay.py`)
  1. reference에서 perform(profile, seed) 결과를 `render_piano.py`로 WAV 렌더링한다.
  2. helper `POST /transcribe`: 본문은 WAV 바이트, 헤더는 `Content-Type: application/octet-stream`, `X-PPP-Filename: ppp-bench-<caseKey>.wav`, `X-PPP-Mode: solo`. Origin 헤더는 보내지 않는다 (`fromLocalPage` 통과).
  3. `GET /transcribe/<job>`으로 poll한다.
  4. `helper_result`를 저장한다. 이때 `engine == "catalog"`이면 실패로 처리한다 (catalog 오검색).
- WAV는 커밋하지 않는다 (크기, CC BY 표기 문제). JSON만 커밋한다.
- replay suite는 `helper_result`를 `toMusicXml`에 그대로 넣는다. 파이프라인은 T0-N과 같고, ref 시간은 `truth.bar_starts_s`로 옮긴다.
- 결과에는 `amt.*` metric이 추가된다 (§8.4, 정보용으로 gate하지 않음).

---

## 7. Golden test 구조

### 7.1 용어 정리

- **golden snapshot** (이 절): 고정 입력에 대한 SUT의 **정확한** 출력. 목적은 "의도하지 않은 변화"를 잡는 것이다. metric이 그대로여도 출력이 바뀌면 드러난다.
- **reference** (§6): 정답 악보. metric 계산의 기준이다.
- 기존 `tests/golden/` (private golden set): G0 용어로는 **private suite**다. 그대로 두고 `legacy` 명령으로 실행한다 (§9.4).

### 7.2 케이스와 파일

`suites/golden.json`:

```json
{
  "schema": "ppp.bench-golden/1",
  "cases": [
    { "key": "G01", "source": "micro/M01-waltz-3-4|deadpan|none|s1" },
    { "key": "G02", "source": "micro/M03-jig-6-8|deadpan|none|s1" },
    { "key": "G03", "source": "micro/M04-triplets-4-4|deadpan|none|s1" },
    { "key": "G04", "source": "micro/M05-32nds-120|deadpan|none|s1",
      "opts": { "lock": { "beats": 4, "beatType": 4, "bpm": 120, "firstDownbeat": "<start_s>" } } },
    { "key": "G05", "source": "micro/M07-pickup-3-4|human|oracle|s1" },
    { "key": "G06", "source": "micro/M09-syncopation-ties|deadpan|none|s1" },
    { "key": "G07", "source": "micro/M11-harmonic-minor|human|none|s1" },
    { "key": "G08", "source": "micro/M13-sharps-chromatic|deadpan|oracle|s1" },
    { "key": "G09", "source": "micro/M15-wide-chords|deadpan|none|s1" },
    { "key": "G10", "source": "catalog/gymnopedie-1|human|oracle|s1" },
    { "key": "G11", "source": "hymns/<core의 첫 hymn>|deadpan|none|s1" },
    { "key": "G12", "source": "micro/M02-alberti-4-4|deadpan|none|s1",
      "opts": { "arrangement": { "level": "beginner", "style": "balanced" } } },
    { "key": "G13", "source": "micro/M03-jig-6-8|human|none|s1",
      "opts": { "lock": { "beats": 6, "beatType": 8, "bpm": 60, "firstDownbeat": "<start_s>" } } },
    { "key": "G14", "source": "grid:pm2s-6-8",
      "input_literal": "transcription.test.js의 PM2S-shaped grid (4마디 6/8, ticksPerQuarter 24) 그대로" }
  ]
}
```

- `<start_s>`는 `golden --init` 시점에 해당 case의 `start_s` 숫자로 치환해 **입력 파일에 저장**한다.
- G14는 `input.grid` 경로(`fromGrid`)를 덮는다. G04와 G13은 `lock` 경로, G12는 `arrangement` 경로를 덮는다.
- `golden/inputs/<key>.json`: `{input, opts}`. `golden --init`이 한 번 생성해 **커밋**한다. 이후 생성기가 바뀌어도 golden 입력은 변하지 않는다.
- `golden/expected/<key>.musicxml`: `toMusicXml(...).xml` 그대로 (줄바꿈은 `\n`).
- `golden/expected/<key>.stats.json`: stats 중 안정 필드만 담는다: `bars, beatsPerBar, beatType, tempo, key.fifths, key.mode, notes, rh, lh, beatSource, quantizer, tempoAlias, beatFallback, arrangement.level, arrangement.style`.

### 7.3 비교 규칙과 bless 절차

- `run.py golden`
  - 입력별로 notate를 실행한다.
  - XML은 `\r\n`을 `\n`으로 바꾼 뒤 **바이트 일치**를 요구하고, stats 부분집합은 **값 일치**를 요구한다.
  - 불일치하면 case마다 다음을 출력하고 exit 1한다.
    1. 처음 다른 마디 3개의 `<measure number="…">` 블록 diff (unified, 문맥 2줄)
    2. stats 차이
    3. 해당 입력으로 계산한 주요 metric의 전후 값: reference가 있는 case는 identity F1, time_sig, key, hand, duration
- `run.py golden --bless --reason "<이유>"`
  - 모든 expected를 현재 출력으로 다시 쓰고, `golden/BLESS_LOG.md`에 `날짜 · git sha · reason · 바뀐 key 목록`을 추가한다.
  - `--reason`이 없으면 거부한다.
- **규칙: 의도한 SUT 변경이라면 같은 커밋에서 bless하고, 커밋 메시지나 PR에 이유를 적는다.** 의도하지 않은 diff면 버그다.

---

## 8. 평가 metric

### 8.1 Canonical score (`ppp.canonical-score/1`)

```json
{
  "schema": "ppp.canonical-score/1",
  "reader": "reader/1",
  "source": { "path": "catalog/fur-elise.musicxml", "sha256": "…" },
  "title": "Für Elise",
  "tempo": { "effective_qpm": 60.0, "sound_qpm": 60.0, "printed_qpm": null, "app_qpm": 60,
             "marks": [ { "measure": 0, "pos_q": 0.0, "qpm": 60.0, "kind": "sound" } ] },
  "staves": 2,
  "piano_part": 0,
  "measures": [
    { "index": 0, "number": "0", "start_q": 0.0, "len_q": 0.5, "implicit": true,
      "time": [3, 8], "key": { "fifths": 0, "mode": "major", "mode_explicit": false } }
  ],
  "notes": [
    { "id": 0, "measure": 0, "pos_q": 0.0, "onset_q": 0.0, "dur_q": 0.25,
      "midi": 76, "written_midi": 76, "step": "E", "alter": 0, "octave": 5,
      "staff": 1, "hand": "r", "voice": 1, "chord": false,
      "tie_start": false, "tie_stop": false, "tuplet": null, "type": "16th", "dots": 0,
      "accidental": null, "cue": false }
  ],
  "rests": [ { "measure": 0, "pos_q": 0.0, "onset_q": 0.0, "dur_q": 0.5, "staff": 2, "voice": 5, "measure_rest": false } ],
  "sounding": [
    { "id": 0, "notes": [0], "midi": 76, "measure": 0, "pos_q": 0.0, "onset_q": 0.0, "dur_q": 0.25,
      "staff": 1, "hand": "r", "step": "E", "alter": 0, "pieces": 1, "tuplet": false }
  ],
  "diagnostics": { "parts": 1, "grace_skipped": 0, "cue_notes": 0, "octave_shift": false,
                   "duplicate_measure_numbers": false, "backup_clamped": 0,
                   "bar_integrity": { "checked": 4, "ok": 4, "bad": [] } }
}
```

- 내부 계산은 `fractions.Fraction`으로 한다. JSON에는 소수 6자리로 쓴다.
- `notes`는 **적힌** 음표다 (tie 조각 포함, 쉼표 제외).
- `sounding`은 tie를 병합한 **타건** 단위다. 매칭과 채점은 `sounding`으로 한다.
- `hand`: `r`, `l`, `x` (연주하지 않는 staff).

### 8.2 Reader 규칙 — 앱 parity

**기준은 `Piano Coach App.dc.html`의 `parseMusicXML()`과 `Score.finalize`다** (기준 커밋 기준 약 3888–4290행과 3530–3570행. 다른 세션이 편집하므로 **함수 이름으로 찾고 구현 전에 다시 읽는다**). 각 규칙마다 `tests/bench/unit/test_parity_rules.py`에 최소 XML fixture로 된 단위 테스트를 둔다.

| # | 규칙 | 앱 동작 (확인한 코드) | canonical reader |
| --- | --- | --- | --- |
| R1 | root | `score-timewise`는 오류, `score-partwise` 아니면 오류 | `ReaderError('timewise')`, `'bad-xml'` |
| R2 | grace | `<grace>`가 있는 note는 건너뜀 | 건너뛰고 `diagnostics.grace_skipped` 증가 |
| R3 | cue | 별도 처리 없음 (포함) | 포함하고 `cue: true`, `diagnostics.cue_notes` 증가 |
| R4 | backup | `cursor -= dur/div; if (cursor < 0) cursor = 0` | 같음. clamp 횟수를 diagnostics에 |
| R5 | forward | `cursor += dur/div; maxCursor = max(…)` | 같음 |
| R6 | chord | `onset = isChord ? lastOnset : cursor`. 비화음 note 처리 때 `lastOnset = cursor` 후 `cursor += dur`. `lastOnset`은 마디마다 0으로 시작하고 voice와 무관 | 같음 |
| R7 | maxCursor | note마다 (화음 포함) 처리 후 `maxCursor = max(maxCursor, cursor)` | 같음 |
| R8 | 마디 길이 | **part 0만** 마디 격자를 정한다. `content = round(maxCursor, 1e-6)`. `lenQ = implicit && content > 0 ? content : (content > sig + 1e-6 ? content : sig)` | 같음. 다른 part의 음은 **문서 순서 index**로 part 0 마디에 붙인다 |
| R9 | 마디 식별 | 앱은 인쇄 번호(`number`)로 식별 (`measureInfo[number]`) | canonical은 **문서 순서 index**, 인쇄 번호는 문자열로 따로 둔다. 중복 번호 파일은 lint에서 제외 |
| R10 | 속성 상태 | `divisions`, `time`, `key`, `staves`, `clefs`는 part 안에서 유지된다 | 같음 |
| R11 | mode | `txt(k,'mode','major')` | `mode` = 원문 또는 `"major"`, `mode_explicit` = 원문 존재 여부 |
| R12 | pitch | `alter = parseInt(...) \|\| 0` (미분음 절삭), `octave` 기본 4 | 같음 |
| R13 | rest | `rest: isRest && !p` | 같음 (`rests`로) |
| R14 | tie | `<tie type="start/stop">` (notations의 `tied`는 쓰지 않음) | 같음. sounding 병합: tie_stop 음은 같은 (staff, midi)의 열린 chain 중 `end == onset`(±1e-6)인 것에 붙이고, 없으면 같은 midi의 아무 열린 chain, 그래도 없으면 새 타건 |
| R15 | tuplet | `<time-modification>`에서 `actual != normal`이면 `tm = {a, n}` | `tuplet: [a, n]`, sounding은 어느 조각이든 tuplet이면 true |
| R16 | staff | `globalStaff = staffBase + staff`, part마다 `staffBase += max(partStaves, 1)` | 같음 |
| R17 | 손 | piano part = 2 staff 이상인 첫 part, 없으면 마지막 part. `lh = base + count`, `rh = count ≥ 2 ? lh − 1 : lh`. `staff == rh`면 `r`, `staff == lh`면 `l`, 그 밖은 `x`. 모든 음이 `x`면 `staff ≤ 1 ? r : l` | 같음 |
| R18 | tempo | part 순서 → 마디 순서 → 요소 순서로 처음 나온 값. `<direction>` 안에서는 `<sound tempo>`를 먼저 보고 그다음 `<metronome>` (`per-minute × unit × (2 − 0.5^dots)`, unit: breve 8, whole 4, half 2, quarter 1, eighth 0.5, 16th 0.25, 32nd 0.125). 마디 직속 `<sound tempo>`도 인정. `Score.tempo = round(tempo \|\| 84)` | `effective_qpm` = 첫 값 (반올림 전, 없으면 null). `sound_qpm`, `printed_qpm` = 각 종류의 첫 값. `app_qpm` = `round(effective or 84)`. `marks` = 전부 |
| R19 | direction 위치 | `atB = cursor + offset/divisions` | 같음 |
| R20 | ottava | piano part에서만. `type="up"`이면 +12 (size ≥ 15면 +24), `"down"`이면 −12/−24. stop은 가장 최근의 열린 것 중 `number`와 staff가 맞는 것에 붙는다. 적용 구간은 `[start, stop)`, staff 한정, 겹치면 **가장 늦게 시작한 것**. `midi = written + shift` | 같음. **이 해석은 MusicXML 표준과 다를 수 있다** (§14 I3). 그래서 reference에서는 제외하고, 예측(OMR 출력) 읽기와 conformance에만 쓴다 |
| R21 | staves | `max(1, min(maxStaffSeen, 4))` | 같음 |
| R22 | 음이 없음 | sounding이 0이면 오류 | `ReaderError('no-notes')` |

### 8.3 시간 매핑과 정렬

**Reference q→sec**

- 합성 case: `perform.TimeMap.sec(q)`. 기준은 첫 마디 시작 `q = 0`이다 (pickup이면 pickup 마디 시작).
- 실제 녹음 case: `bar_starts_s` (길이 = 마디 수 + 1)을 마디 안에서 `pos_q / len_q`로 선형 보간한다.

**Prediction q→sec** (`timemap.pred_q_to_sec`): `toMusicXml` 출력은 마디 1..N이 모두 꽉 찬 마디이고, pickup은 앞 쉼표로 쓴다.

```
bs = stats.barStarts (len = bars + 1), beats = stats.beats
for 마디 i (pred canonical measures[i]):
    t0 = bs[i];  t1 = bs[i+1] if i+1 < len(bs) else bs[i] + (bs[i] - bs[i-1])
    inner = [b for b in beats if t0 + 0.001 < b < t1 - 0.001]
    pts = [t0] + inner + [t1]
    u = (q - start_q) / len_q * (len(pts) - 1);  k = clamp(floor(u), 0, len(pts) - 2)
    t = pts[k] + (u - k) * (pts[k+1] - pts[k])
```

- `stats.barStarts`의 길이가 `len(measures) + 1`이 아니면 case를 `error: STATS_SHAPE`로 기록한다. 조용히 추정하지 않는다.
- OMR·일반 MusicXML처럼 stats가 없는 예측은 symbolic 정렬을 쓴다.

**Timed identity 정렬** (`align.align_timed`)

- ref 쪽 시각은 `truth.nominal_on`이다 (지터 없는 이상적 시각. notation은 이것을 복원해야 한다).
- pred 쪽 시각은 위 매핑으로 계산한 onset이다.
- pitch마다 따로 정렬한다: `R` = 그 pitch의 ref 음을 시각순으로, `P` = pred 음을 시각순으로.

```
D[i][j] = max( D[i-1][j], D[i][j-1], D[i-1][j-1] + w(i,j) )
w(i,j)  = W - |t_r(i) - t_p(j)|   (|Δ| ≤ W일 때),  그 밖은 -∞      # W = window_s = 0.30
동점 우선순위: 대각선 > 위(i-1) > 왼쪽(j-1)
역추적한 대각선 칸 → (ref_id, pred_id, Δt)
```

band 최적화는 해도 되고 안 해도 된다 (결과가 같아야 한다). pitch별 결과를 합쳐 `(ref_id, pred_id)` 순으로 정렬한다.

**Symbolic 정렬** (`align.align_symbolic`, OMR·예측 파일 case)

1. 마디 유사도 `S(i,j)`: 두 마디 sounding의 `(midi, round(pos_q·48))` multiset Jaccard. 둘 다 비었으면 1.
2. Needleman–Wunsch로 마디를 정렬한다. 점수 = 정렬 쌍의 S 합 − 0.2 × (건너뛴 마디 수). 동점 우선순위는 대각선 > 위 > 왼쪽.
3. `S ≥ 0.2`인 쌍만 "정렬됨"으로 친다.
4. 정렬된 마디 쌍 안에서 음을 `(midi, |Δpos| ≤ 1/48)` 기준으로 가장 가까운 것부터 greedy 매칭한다. 정렬되지 않은 마디의 음은 누락/추가로 센다.

### 8.4 Metric 정의

- **방향**: ↑는 클수록 좋음, ↓는 작을수록 좋음.
- **null**: 계산할 수 없다는 뜻이다. 집계에서 빼고, 개수 `n`을 따로 보고한다.
- **적용 kind**: T = timed(합성, replay), S = symbolic(OMR, 예측 파일).
- 모든 비율은 0–1이다.

#### 구조 (structure)

| ID | 정의 | 방향 | 적용 | null 조건 |
| --- | --- | --- | --- | --- |
| `struct.time_sig.exact` | 예측 주 박자표 == expected (beats, beat-type 모두). **주 박자표** = 마디 길이 가중 최빈값 (예측은 `stats`가 있으면 `beatsPerBar/beatType`) | ↑ | T, S | – |
| `struct.time_sig.score` | exact = 1.0 · **regrouped** (beat 단위와 simple/compound 종류가 같고 마디당 박 수만 다름: 2/4↔4/4, 3/8↔6/8, 6/8↔12/8) = 0.5 · **equivalent-bar** (마디 길이는 같고 박 구조가 다름: 3/4↔6/8, 2/2↔4/4, 6/4↔12/8) = 0.25 · 그 밖 = 0 | ↑ | T, S | – |
| `struct.key.fifths_exact` | 예측 첫 마디 fifths == expected fifths (조표 일치) | ↑ | T, S | – |
| `struct.key.mirex` | expected mode가 명시되었을 때만. 같은 조 1.0 / 같은 mode에서 으뜸음 완전5도 위·아래 0.5 / relative (C major ↔ A minor) 0.3 / parallel (C major ↔ C minor) 0.2 / 그 밖 0. 예측 tonic은 `(fifths, mode)`에서 계산 | ↑ | T, S | expected mode 불명 |
| `struct.tempo.ratio_effective` | 예측 `tempo.effective_qpm` (앱이 재생하는 값, R18) / expected qpm | 1에 가까울수록 좋음 | T | expected 없음 |
| `struct.tempo.ok_effective` | \|ratio_effective − 1\| ≤ 0.04 | ↑ | T | 위와 같음 |
| `struct.tempo.ok_written` | 예측 `printed_qpm` (metronome 환산) 기준 ±4% | ↑ | T | 표기 없음 |
| `struct.tempo.metrical_ok` | printed(없으면 effective) 비율이 {1, 2, ½, 3, ⅓, 3/2, 2/3} 중 하나의 ±4% 안 | ↑ | T | expected 없음, 또는 예측에 printed·effective 모두 없음 |
| `struct.tempo.mark_consistent` | 예측에 `sound_qpm`과 `printed_qpm`이 모두 있으면 둘의 차이 ≤ 1% | ↑ | T, S | 둘 중 하나 없음 |
| `struct.measures.count_exact` | 예측 마디 수 == expected 마디 수 | ↑ | T, S | – |
| `struct.measures.count_ratio` | 예측 / expected | 정보 | T, S | – |
| `struct.downbeat.f1` | 예측 마디 시작(`stats.barStarts[k]`)과 expected `bar_starts` (implicit 제외)의 F1, 허용 ±70 ms, 1:1 greedy (가까운 순). 비교 창은 [첫 음 − 0.1 s, 마지막 음 + 0.1 s]. 창 밖의 예측 시작(pickup을 앞 쉼표로 쓴 마디 등)은 제외 | ↑ | T | – |

#### 음 (notes)

| ID | 정의 | 방향 | 적용 | null 조건 |
| --- | --- | --- | --- | --- |
| `notes.identity.precision/recall/f1` | timed 정렬 쌍 수 / (예측 sounding 수, ref sounding 수). **악보에 음이 보존되었나** | ↑ | T | – |
| `notes.onset.f1_50ms` | 정렬 쌍 중 \|Δt\| ≤ 0.05 s인 것만 매칭으로 쳐서 계산한 P/R/F1의 F1 (MIREX식 엄격 지표) | ↑ | T | – |
| `notes.timing.median_abs_ms` | 정렬 쌍 \|Δt\|의 중앙값 × 1000 | ↓ | T | 쌍 없음 |
| `notes.input_fidelity.f1` | 같은 정렬을 **입력 연주 음**(`input.notes`의 on)과 예측 사이에 적용한 F1. notation 단계가 받은 음 중 무엇을 버리거나 만들었나 (진단용) | ↑ | T | – |
| `notes.symbolic.precision/recall/f1` | symbolic 정렬 기준 | ↑ | S | – |
| `amt.note_f1`, `amt.offset_f1`, `amt.mean_onset_error_ms`, `amt.pedal_iou` | `evaluate_transcription.evaluate(truth notes(초), helper notes(초))` 결과 그대로. **notation 이전** AMT 품질이며 정보용 | ↑↑↓↑ | replay, T2 | – |

#### 표기 (notation) — 정렬 쌍 위에서 계산

| ID | 정의 | 방향 | 적용 | null 조건 |
| --- | --- | --- | --- | --- |
| `notation.metrical_scale` | `s` = 연속 onset 묶음 쌍의 (ref IOI_q / pred IOI_q) 중앙값을 {1, 2, ½, 3, ⅓, 3/2, 2/3} 중 비율 오차 ≤ 8%인 가장 가까운 값으로 맞춘 것. 해당 없으면 1 | 정보 | T | 쌍 < 3 |
| `notation.ioi.accuracy` | ref sounding을 onset_q별로 묶어 정렬한다. 인접 묶음 (g_k, g_k+1)마다 각 묶음에서 매칭된 음 중 **가장 높은 midi**를 대표로 쓴다. ref_ioi = Δonset_q, pred_ioi = 대표 pred 음들의 Δonset_q. \|pred_ioi × s − ref_ioi\| ≤ 1/48이면 정답. 정답 수 / 평가 쌍 수. **리듬이 맞게 적혔나 (메트릭 수준과 무관)** | ↑ | T, S (S에서는 s = 1) | 평가 쌍 0 |
| `notation.ioi.accuracy_strict` | 위와 같되 s = 1로 고정 | ↑ | T | 위와 같음 |
| `notation.onset_pos.accuracy` | bar_offset = 정렬 쌍 (pred 마디 index − ref 마디 index)의 최빈값 (동점이면 \|값\|이 작은 것, 그다음 작은 값). 정답 조건: `pred.measure − bar_offset == ref.measure`이고 \|pred.pos_q − ref.pos′_q\| ≤ 1/96. **ref가 implicit 첫 마디면** `pos′ = pos + (전체 마디 길이 − len_q)`로 오른쪽 정렬한다 (예측은 pickup을 앞 쉼표가 있는 꽉 찬 마디로 쓰므로). 그 밖은 `pos′ = pos` | ↑ | T, S | – |
| `notation.duration.accuracy` | tie 병합 dur: \|pred.dur_q × s − ref.dur_q\| ≤ 1/48인 쌍의 비율 | ↑ | T, S | – |
| `notation.hand.accuracy` | ref와 pred의 hand가 모두 `r`/`l`인 쌍 중 hand가 같은 비율 | ↑ | T, S | ref가 1-staff이거나 `skip_metrics` |
| `notation.spelling.accuracy` | (step, alter)가 같은 쌍의 비율 | ↑ | T, S | – |
| `notation.ties.extra_per_100` | 100 × Σ max(0, pred.pieces − ref.pieces) / 쌍 수. **가짜 붙임줄** | ↓ | T, S | 쌍 0 |
| `notation.tuplets.f1` | 쌍 기준. TP = 둘 다 tuplet, FP = pred만, FN = ref만 | ↑ | T, S | TP + FP + FN = 0 |

#### 가독성 (readability) — 예측만 보고 계산 (reference 불필요)

reference에 대해서도 같은 값을 계산해 `read.*.delta = pred − ref`를 함께 기록한다 (T, S).

| ID | 정의 | 방향 |
| --- | --- | --- |
| `read.bar_integrity` | `Import.validate`의 overfull/underfull/empty 규칙을 따르되, implicit 첫·마지막 마디만 underfull에서 면제한다. 마디의 `end = max(pos_q + dur_q)`(음·쉼표)에 대해 `end > sig + 0.01`이면 overfull, `end < sig·0.5 − 0.01`이면 underfull, 음이 없으면 empty. implicit 첫·마지막 마디는 underfull 면제. 문제없는 마디 / 전체 마디 | ↑ |
| `read.ties_per_note` | tie_start 수 / written 음 수 | ↓ |
| `read.tuplets_per_note` | tuplet 음 수 / written 음 수 | 정보 |
| `read.accidentals_per_note` | `<accidental>`이 있는 음 / written 음 | ↓ |
| `read.short_notes_rate` | written dur ≤ 1/8 quarter (32분 이하) 비율 | 정보 |
| `read.over_span_rate` | 손별 동시 onset 묶음 중 최고−최저 > 12 반음인 비율 | ↓ |
| `read.max_chord_size` | 손별 동시 onset 음 수의 최대값 | ↓ (> 5는 비현실적) |
| `read.rests_per_measure` | 쉼표 수 / 마디 수 | 정보 |

#### OMR 전용 (T1-O)

| ID | 정의 | 방향 |
| --- | --- | --- |
| `omr.measure_alignment_rate` | 정렬된(S ≥ 0.2) ref 마디 / ref 마디 | ↑ |
| `omr.flag.precision` | 앱 `report.suspectMeasures` 중 실제로 틀린 마디(정렬되지 않았거나 S < 1)의 비율 | ↑ |
| `omr.flag.recall` | 실제로 틀린 마디 중 앱이 표시한 비율 | ↑ |
| `omr.confidence`, `omr.level` | 앱이 보고한 값 (정보) | – |

### 8.5 SQI (`sqi/1`)

**Timed (T)**:

| 구성 | 가중치 |
| --- | --- |
| `notes.identity.f1` | 0.20 |
| `notation.ioi.accuracy` | 0.20 |
| `notation.duration.accuracy` | 0.10 |
| `notation.onset_pos.accuracy` | 0.10 |
| `struct.time_sig.score` | 0.10 |
| `struct.key.fifths_exact` | 0.10 |
| `struct.tempo.ok_effective` | 0.05 |
| `notation.hand.accuracy` | 0.10 |
| `notation.spelling.accuracy` | 0.05 |

`SQI = 100 × Σ(w·x) / Σ(w)`이고, **null인 구성은 분자와 분모에서 모두 뺀다.** 구성이 절반(가중치 합 0.5) 미만이면 SQI는 null이다.

근거: 연주 가능성을 가장 크게 좌우하는 순서대로 가중치를 두었다. 음 보존과 리듬 0.40, 구조(박자표·조표·템포) 0.25, 음가·위치 0.20, 손 0.10, 철자 0.05.

**Symbolic (`sqi_s/1`, S)**:

| 구성 | 가중치 |
| --- | --- |
| `notes.symbolic.f1` | 0.35 |
| `notation.duration.accuracy` | 0.15 |
| `notation.onset_pos.accuracy` | 0.15 |
| `notation.hand.accuracy` | 0.10 |
| `notation.spelling.accuracy` | 0.05 |
| `struct.time_sig.score` | 0.10 |
| `struct.key.fifths_exact` | 0.10 |

**가중치나 구성을 바꾸면 `SQI_VERSION`을 올린다.** compare는 버전이 다른 결과를 비교하지 않는다 (ERROR).

### 8.6 집계

- 케이스 metric의 suite 집계는 **macro 평균**이다 (곡마다 같은 비중). 불리언은 비율로 계산한다.
- 추가로 micro 합계를 쓴다.
  - `notes.identity.recall_micro` = Σ쌍 / Σref
  - `notes.identity.precision_micro` = Σ쌍 / Σpred
- 각 metric에 `{"mean": x, "n": k}`를 기록한다. null은 제외한다.
- `errors`: status가 `error`인 케이스 수와 코드별 개수.
- `by_tag`: 모든 derived tag에 대해 같은 방식으로 집계한다. `holdout` 태그 케이스는 `all`에서 **빼고** `by_tag.holdout`에만 넣는다.
- 반올림은 소수 6자리다.

### 8.7 버전 관리

`READER_VERSION`, `METRICS_VERSION`, `SQI_VERSION`, `GENERATOR_VERSION`을 `results.json`과 baseline에 기록한다.

- **Reader나 생성기 변경**: 입력·정답이 바뀐다. relock과 재baseline이 필요하다.
- **Metric 정의 변경**: 같은 입력이라도 숫자가 바뀐다. 재baseline이 필요하다.
- 버전이 다르면 compare는 ERROR(exit 2)로 멈추고 "baseline을 다시 기록하라"고 안내한다.

---

## 9. Regression test 구조

### 9.1 실행 산출물

`tests/bench/out/<suite>/`에 쓴다. 실행할 때마다 덮어쓴다. private suite는 suite 파일 옆 `out/`에 쓴다.

| 파일 | 내용 | 결정론 |
| --- | --- | --- |
| `results.json` | `{schema:"ppp.bench-results/1", suite, suite_sha256, lock_sha256, versions{reader,metrics,sqi,generator}, aggregates{all, by_tag}, cases:[{id, key, tags, status, error_code, metrics{…}, expected{…}, predicted{time, key, tempo_effective, tempo_printed, bars, beatSource}}]}` (cases는 id로 정렬) | **바이트 동일해야 함** |
| `run.json` | `{started_at, finished_at, git_sha, git_dirty, audio_score_path, audio_score_sha256, node, python, platform, timing{total_s, notate_s, metrics_s, per_case_ms{…}}, argv}` | 달라도 됨 |
| `summary.md` | 사람이 읽는 보고서 (아래) | – |
| `cases/<caseKey>.musicxml`, `.stats.json`, `.metrics.json` | 케이스별 산출물. 앱에서 "Add Sheet Music → MusicXML"로 열어 눈으로 확인할 수 있다 | – |
| `index.json` | `{caseKey: caseId}` | – |

**`summary.md` 구성**

1. 제목, 환경 한 줄 (git, dirty 여부, audio-score sha 앞 12자리, node, python, 케이스·오류 수, 실행 시간)
2. **판정** (PASS / REGRESSION / ERROR)과 실패·경고 목록
3. 헤드라인 표: metric | 값 | baseline | Δ | anchor(첫 baseline) 대비 Δ | 상태
4. tag별 표: `set:*`, `metre-class:*`, `profile:*`, `beats:*`의 SQI와 주요 5개 metric
5. SQI가 가장 많이 떨어진 케이스 10개와 가장 많이 오른 케이스 10개 (caseId, ΔSQI, 원인 metric, 산출물 경로)
6. 오류 목록 (코드별)
7. holdout 집계 (케이스 목록 없음)

### 9.2 Baseline 형식 (`baselines/<suite>.json`, 커밋)

```json
{
  "schema": "ppp.bench-baseline/1",
  "suite": "core",
  "suite_sha256": "…", "lock_sha256": "…",
  "versions": { "reader": "reader/1", "metrics": "metrics/1", "sqi": "sqi/1", "generator": "perform/1" },
  "recorded": { "git_sha": "…", "date": "…", "audio_score_sha256": "…", "node": "v24.17.0", "python": "3.13.5", "platform": "win32" },
  "anchor": { "git_sha": "…", "date": "…", "aggregates_all": { "sqi": {"mean": 0, "n": 0} } },
  "aggregates": { "all": {}, "by_tag": {} },
  "cases": { "<caseId>": { "status": "ok", "sqi": 0.0, "metrics": {} } },
  "history": [ { "date": "…", "git_sha": "…", "reason": "G0 initial baseline", "sqi_all": 0.0 } ]
}
```

- `anchor`는 G0 최초 baseline의 집계로, **이후에도 바꾸지 않는다.** 누적 drift를 보여주는 데 쓴다.
- `full`은 크기 때문에 `full.aggregates.json` (aggregates와 history만)을 커밋한다.

### 9.3 비교와 gate 정책 (`compare.py`)

#### 판정 순서

1. **버전, lock, suite sha 확인.** 하나라도 다르면 **ERROR** (exit 2): `VERSION_MISMATCH`, `INPUT_DRIFT`, `SUITE_CHANGED`. baseline이 없으면 `NO_BASELINE` (exit 2).
   - `suite_sha256`은 case를 정하는 필드(`kind`, `stage`, `references`, `matrix`, `subsets`, `align`)만 `dump_json`으로 직렬화해 계산한다. `gate`와 `description`은 넣지 않는다. 허용치만 바꿔도 baseline이 무효가 되지 않게 하려는 것이다. 허용치 변경은 suite 파일 diff로 리뷰한다.
2. **케이스 단위**
   - baseline에서 ok였던 케이스가 error가 되면 FAIL.
   - 케이스 SQI가 `case_fail_drop`(10.0) 이상 떨어지면 FAIL. `case_warn_drop`(2.0) 이상이면 WARN.
3. **집계 단위.** 아래 표의 metric마다 Δ = 새 값 − baseline을 계산한다. ↑ metric은 `Δ < min_delta`면 FAIL, ↓ metric은 `Δ > max_delta`면 FAIL. 허용치의 절반을 넘으면 WARN.
4. **tag 가드.** `set:micro`, `set:hymns`, `set:method`, `set:catalog`, `profile:deadpan`, `profile:human`, `profile:amt`, `beats:none`, `beats:oracle`에 대해 `sqi`의 `min_delta`가 −1.0 (core 기준). 한 그룹의 개선이 다른 그룹의 퇴행을 가리지 못하게 한다.
5. FAIL이 하나라도 있으면 **REGRESSION** (exit 1). 없으면 **PASS** (exit 0).
6. `min_delta`의 절대값을 넘는 개선은 IMPROVED로 표시한다. exit는 0이고, baseline 갱신을 권한다.

#### 기본 허용치 (suite 파일 `gate`에 둔다)

| metric | 방향 | core | smoke |
| --- | --- | --- | --- |
| `sqi` | ↑ | −0.30 | −1.0 |
| `notes.identity.f1` | ↑ | −0.002 | −0.01 |
| `notes.onset.f1_50ms` | ↑ | −0.005 | −0.02 |
| `notation.ioi.accuracy` | ↑ | −0.003 | −0.01 |
| `notation.onset_pos.accuracy` | ↑ | −0.005 | −0.02 |
| `notation.duration.accuracy` | ↑ | −0.003 | −0.01 |
| `notation.hand.accuracy` | ↑ | −0.003 | −0.01 |
| `notation.spelling.accuracy` | ↑ | −0.003 | −0.01 |
| `notation.ties.extra_per_100` | ↓ | +0.5 | +2.0 |
| `struct.time_sig.exact` | ↑ | −0.005 | −0.04 |
| `struct.key.fifths_exact` | ↑ | −0.005 | −0.04 |
| `struct.tempo.ok_effective` | ↑ | −0.005 | −0.04 |
| `struct.downbeat.f1` | ↑ | −0.005 | −0.02 |
| `read.bar_integrity` | ↑ | 0.000 | 0.000 |

- 허용치의 근거: T0 suite는 결정론적이므로 잡음은 0이다. core는 약 540케이스라 불리언 metric에서 케이스 1개가 약 0.002다. 허용치는 "케이스 2–3개 수준의 트레이드오프까지 허용"하는 값이다. 그보다 크면 이유와 함께 baseline을 갱신해야 한다.
- T2-A AMT live는 GPU 비결정성 때문에 모든 허용치를 ±0.01로 둔다. T1-O는 core와 같게 둔다.

### 9.4 CLI와 npm scripts

```
python tests/bench/run.py list                                   # suite, case 수, baseline 유무
python tests/bench/run.py lint-corpus [--write-excluded]
python tests/bench/run.py select-core                            # (한 번) core/smoke reference 선택 → suite JSON에 기록
python tests/bench/run.py run   --suite <name> [--audio-score PATH] [--jobs N] [--filter SUBSTR] [--reveal-holdout]
python tests/bench/run.py run   --suite-file <path>             # private suite (산출물은 저장소 밖)
python tests/bench/run.py check --suite <name>                    # out/<suite>/results.json vs baseline → exit 0/1/2
python tests/bench/run.py update-baseline --suite <name> --reason "..."   # 직전 run 결과로 갱신, history 추가
python tests/bench/run.py relock --suite <name> --reason "..."
python tests/bench/run.py golden [--init | --bless --reason "..."]
python tests/bench/run.py mutation-check                          # §9.5
python tests/bench/run.py ab --suite <name> --a git:HEAD --b worktree     # 두 SUT 버전 직접 비교 (baseline 불필요)
python tests/bench/run.py legacy --manifest <path>                # tests/golden_benchmark.py manifest
python tests/bench/run.py conformance                             # (T1) npm start + 네트워크 필요
python tests/bench/run.py run --suite omr-live                    # (T1) + npm run omr, Audiveris
python tests/bench/run.py record-replay --suite replay-public     # (T2) helper + transcription 설정 필요
```

- 모든 명령은 첫 줄에서 `setup_stdio()`를 부른다 (cp949).
- Node는 `PPP_BENCH_NODE` 또는 PATH의 `node`를 쓴다. Python 3.10 이상이 필요하다.
- 환경이 없는 tier(T1/T2)는 `SKIPPED: <사유>`를 출력하고 exit 0으로 끝낸다. 단 `--require-env`면 exit 2.

npm scripts는 §5에 있다: `bench`, `bench:smoke`, `bench:full`, `test:bench`.

### 9.5 Mutation (gate 민감도) 검사

**gate가 실제 회귀를 잡는다는 증거**이며 acceptance의 핵심이다 (A7).

- `mutation.py`는 `audio-score.js`를 `.cache/mutations/`에 복사한 뒤 **정확한 문자열 치환**을 적용한다.
- `mutation` suite를 원본과 각 사본으로 실행하고, **원본 실행 결과를 임시 baseline으로 삼아** compare한다. 커밋된 baseline과는 무관하다.
- 치환할 문자열이 정확히 1회 나오지 않으면 `MUTATION_ANCHOR_MISSING`으로 실패한다. SUT가 바뀐 것이므로 anchor를 갱신한다.
- 아래 표 표기법: `\|`는 Markdown 표 이스케이프이고 실제 문자는 `|`다. `\n`은 줄바꿈 한 개다. METRE와 PHASE의 각 줄은 공백 6칸으로 들여쓴다. `mutation.py`에는 이스케이프 없는 실제 문자열을 적는다.

| ID | 찾을 문자열 (기준 커밋에서 정확히 1회 확인함) | 바꿀 문자열 | 기대 |
| --- | --- | --- | --- |
| MUT-HANDS | `groups[g].notes.forEach(n => { n.staff = n.midi >= s ? 1 : 2; });` | `groups[g].notes.forEach(n => { n.staff = n.midi >= 60 ? 1 : 2; });` | REGRESSION, `notation.hand.accuracy` FAIL |
| MUT-KEY | `best.margin = best.score - second;` | `best = { fifths: 0, mode: 'major', tonic: 0, r: 0, score: 0, diatonicFit: 0 }; best.margin = 1;` | REGRESSION, `struct.key.fifths_exact` FAIL (spelling도 하락) |
| MUT-DUR | `let end = ends[Math.floor((ends.length - 1) / 2)];` | `let end = t + 6;` | REGRESSION, `notation.duration.accuracy` FAIL |
| MUT-METRE | `      beatsPerBar = pick.beats;\n      beatType = pick.beatType;` | `      beatsPerBar = 2;\n      beatType = 4;` | REGRESSION, `struct.time_sig.exact` FAIL |
| MUT-PHASE | `      if (beatType === 4) origin = (pick.phase \|\| 0) * Q;` | `      if (beatType === 4) origin = ((pick.phase \|\| 0) + 1) * Q;` | REGRESSION, `notation.onset_pos.accuracy` 또는 `struct.downbeat.f1` FAIL |
| MUT-NOOP | `  const api = {` | `  /* noop mutation */\n  const api = {` | PASS, **`results.json` sha256이 원본과 동일** |

조사 중 scratch 환경(찬송가 30 + 소나티네 10 + 부르크뮐러 10 + catalog 3, deadpan, 임시 metric)에서 측정한 효과:

- MUT-HANDS: 손 일치 0.897 → 0.845
- MUT-KEY: 조표 0.698 → 0.321
- MUT-DUR: 음가 0.809 → 0.200
- MUT-METRE: 박자표 0.528 → 0.094
- MUT-PHASE: 박자표는 그대로, 엄격 위치 일치 0.463 → 0.322
- MUT-NOOP: 모든 수치 동일

(처음 시도한 "마지막 분기에서 4/4 강제" 변이는 효과가 상쇄되어 박자표 정확도가 변하지 않았다. 이 표에서 뺐다.)

### 9.6 A/B 모드

- `ab --a git:HEAD --b worktree`는 `git show HEAD:audio-score.js`를 `.cache/ab/a.js`로 꺼낸다. 작업 트리 파일과 각각 실행해 **baseline 없이** 두 결과를 compare한다 (a를 기준으로).
- 출력은 `out/<suite>/ab-summary.md`다.
- 이후 goal의 개발 루프에서 "내 변경이 무엇을 바꿨나"를 즉시 보는 도구다.
- `--a`, `--b`는 `git:<rev>`, `worktree`, 파일 경로를 받는다.

### 9.7 Baseline 갱신 절차

1. `run --suite core` → `check` → 결과(REGRESSION 또는 IMPROVED)와 summary를 검토한다.
2. 의도한 변화면 `update-baseline --suite core --reason "<무엇을 왜>"`를 실행한다. 직전 `run`의 results를 쓰며, run 이후 SUT sha가 바뀌었으면 거부한다.
3. **SUT 변경과 baseline 갱신은 같은 커밋에** 넣는다. 커밋 메시지에 핵심 Δ를 적는다 (예: `core SQI 71.2→73.0; time_sig.exact +0.04; hymns SQI −0.3`).
4. smoke와 core baseline을 함께 갱신한다. full은 야간·수동으로 `full.aggregates.json`을 갱신한다.
5. golden diff가 있으면 같은 커밋에서 `golden --bless --reason`을 실행한다.
6. **금지**: 이유 없는 갱신, 회귀를 덮기 위한 허용치 완화 (허용치 변경은 suite 파일 diff로 리뷰된다).

### 9.8 CI (P1, `.github/workflows/bench.yml`)

```yaml
name: bench
on:
  push: { branches: [main] }
  pull_request:
jobs:
  bench:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }          # baseline을 기록한 Node와 같은 메이저
      - uses: actions/setup-python@v5
        with: { python-version: '3.13' }
      - run: python -m unittest discover -s tests/bench/unit -t tests/bench
      - run: python tests/bench/run.py golden
      - run: python tests/bench/run.py lint-corpus
      - run: python tests/bench/run.py run --suite core
      - run: python tests/bench/run.py check --suite core
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: bench-core, path: tests/bench/out/core }
```

- `npm install`은 하지 않는다. notate.js는 의존성이 없고, puppeteer Chrome 다운로드를 피한다.
- CI를 켰는데 Windows에서 기록한 baseline이 Linux와 다르면 (golden이나 lock 불일치), §12 R5 절차대로 원인을 찾아 해결한다. 해결 전에는 CI의 `check`를 필수로 두지 않는다.
- **push와 활성화는 사용자에게 확인받은 뒤에** 한다.

### 9.9 이후 goal이 G0을 쓰는 방법

1. 시작할 때 `npm run bench`로 PASS를 확인하고, 목표 metric과 tag를 정한다. 예: "`struct.time_sig.exact`, `metre-class:simple-duple`".
2. 개발 중에는 `run.py ab --a git:HEAD --b worktree`로 변화를 확인한다.
3. 끝나면 `run --suite core`, `check`, `run --suite full`(holdout 집계 확인), golden bless, `update-baseline --reason`을 거쳐 커밋한다.
4. PR이나 커밋 설명에 core와 holdout의 헤드라인 Δ를 붙인다.

---

## 10. Implementation 순서

**각 Step은 끝에 실행 가능한 체크포인트가 있다.** Step 단위로 커밋하고, 자기 파일만 stage한다 (`git add tests/bench/...`). 다른 세션의 미커밋 변경을 커밋에 섞지 않는다.

### Step 0 — 시작 점검

작업 전 다음을 확인한다 (30분).

1. 이 문서를 끝까지 읽는다.
2. `git log --oneline 718bdf3..HEAD`, `git diff 718bdf3 -- audio-score.js`로 기준 커밋 이후 변경을 확인한다. 변경이 있으면 다음 셋을 다시 확인한다.
   - §9.5의 anchor 문자열
   - `toMusicXml` 입출력: `stats.barStarts`, `stats.beats`, `stats.beatsPerBar`, `beatType`, `tempo`, `key`, `bars`
   - `parseMusicXML`의 §8.2 규칙
3. `ListAgents`로 같은 트리에서 작업 중인 PPP 세션이 있는지 보고, `package.json`, `.gitignore`, `tests/README.md`, `README.md`를 편집할 예정임을 알린다 (사용자 메모리 `parallel-sessions-one-file`).
4. 브랜치를 만든다: `git switch -c g0-quality-foundation`.
5. 사용자 확인이 필요한 것을 묻는다: (a) `.gitignore`에 `tmp/` 추가, (b) CI workflow push. 답을 기다리는 동안 다른 Step을 진행한다.

### Step 1 — 뼈대 (P0)

- 디렉터리와 `__init__.py`, `util.py`, `run.py`(`list`만), `.gitignore` 추가.
- 테스트 `test_util.py`:
  - `Lcg(7)`의 처음 5개 값이 JS `rng(7)`과 같은지 (기대값을 Node로 계산해 테스트에 박는다)
  - `fnv1a32("abc") == 0x1A47E90B`
  - `round_t`
  - `dump_json`의 NaN 거부
  - cp949 환경에서 한글 출력 (`subprocess`로 `PYTHONIOENCODING` 없이 `run.py list` 실행)
- 체크: `python -m unittest discover -s tests/bench/unit -t tests/bench` 통과.

### Step 2 — Canonical와 reader (P0)

- `canonical.py`와 `musicxml.py`를 §8.1, §8.2대로 만든다.
- 테스트
  - `test_musicxml_reader.py`: `samples/prelude-fragment.musicxml`에서 마디 8, 3/4, fifths 1, tempo 72, 음 수, tie 1개가 병합되는지. `.mxl` 하나(`catalog/method/beyer/008.mxl`).
  - `test_parity_rules.py`: R2–R20마다 작은 XML fixture와 기대값을 둔다.
    - pickup `implicit="yes"` 길이
    - chord onset
    - backup clamp
    - tempo 우선순위: sound 먼저, metronome의 dotted 환산 (6/8의 `♩.=48` → 72)
    - 2-part 손 규칙 (`samples/vocal-piano.musicxml`)
    - ottava `type="up" size="8"`에서 C4 → written 60, midi 72 (`transcription.test.js`의 예와 같음)
- 체크: 커밋된 모든 catalog 파일(untracked 제외)을 오류 없이 읽고, 합계를 출력한다.

### Step 3 — 코퍼스 (P0)

- `make_micro.py`로 M01–M24를 생성해 커밋하고, reader로 다시 읽어 표의 기대값(박자, 조, 템포, 마디 수)과 일치하는지 단위 테스트한다.
- `corpus.py`의 lint와 derived tags를 만든다. `references.json`은 `run.py lint-corpus --init`으로 초안을 만든다: 커밋된 파일만, sha256, license 문구는 각 index.json/README에서 가져온다. 그 뒤 **사람 검토용 `expect`**를 넣는다.
  - 템포 누락 파일
  - Für Elise mode
  - lint L9 경고 목록 중 명백한 것
- 체크: `lint-corpus`에서 error 0. `excluded.json`에 octave-shift 파일이 들어갔는지 확인한다.

### Step 4 — 합성 연주 (P0)

- `perform.py`를 §6.6대로 만든다.
- 테스트 `test_perform.py`
  - deadpan에서 on = time map 값, off = on + 길이 − 0.04
  - 같은 case id → 같은 sha256 (결정론)
  - rubato 평균 템포 ±2%
  - amt 누락률이 대략 3–6%
  - oracle tactus 수가 마디 수 × tactus/마디
  - 생성기 소스에 `math.sin|math.exp|math.log|math.pow|random` 사용이 없음 (소스 grep 테스트)
- 체크: 몇 개 case의 입력 JSON을 `out/`에 덤프한다.

### Step 5 — Notate adapter와 첫 end-to-end (P0)

- `node/notate.js` (§4.1)와 `stages.notate_batch`를 만든다.
- 테스트 `test_notate_adapter.py`: 에러 케이스(음 3개 → `no-notes`)가 배치를 멈추지 않는지, `--audio-score` 경로가 반영되는지, meta 줄에 sha256이 있는지.
- 체크: M01 deadpan/none 한 케이스로 XML 생성 → reader → `struct.*`만 계산해 출력.

### Step 6 — 시간 매핑, 정렬, metric (P0)

- `timemap.py`, `align.py`, `metrics/*`, `composite.py`를 만든다.
- 테스트는 **손으로 계산한 기대값**으로 쓴다.
  - `test_align.py`: pitch별 DP, 동점 규칙, 창 밖 제외, 연타
  - `test_metrics_structure.py`: `time_sig.score`의 네 등급, mirex 표, 템포 3종, downbeat F1
  - `test_metrics_notation.py`: 템포 2배 예측에서 `metrical_scale = ½`이고 ioi.accuracy = 1, pickup 오른쪽 정렬, tie pieces
  - `test_metrics_readability.py`: overfull/underfull
  - `test_composite.py`: null 재정규화
- 체크: smoke 후보 5곡을 수동 실행해 §1.7 예비 수치와 방향이 같은지 확인한다. 예: Gymnopédie deadpan/none에서 박자표가 6/8이면 `time_sig.score` = 0.25, `ties.extra_per_100` > 0.

### Step 7 — Suite, runner, 집계, 보고서 (P0)

- `suite.py`(전개, lock), `runner.py`, `aggregate.py`, `report.py`를 만든다. `select-core`로 smoke/core reference를 확정하고 suite JSON을 커밋한다.
- 테스트 `test_suite_lock.py`: 전개된 case 수, lock 검증, 입력 1바이트 변경 시 `INPUT_DRIFT`.
- 체크: `run --suite smoke` < 15 s, `run --suite core` < 90 s. **두 번 실행한 `results.json`의 sha256이 같아야 한다.**

### Step 8 — Baseline, compare, gate (P0)

- `compare.py`와 `update-baseline`을 만든다.
- 테스트 `test_compare.py`: 합성 results/baseline 쌍으로 다음을 확인한다.
  - 각 FAIL 경로 (집계, tag 가드, 케이스 drop, 새 error, 버전 불일치, INPUT_DRIFT)
  - WARN과 IMPROVED
  - exit code
- smoke와 core의 첫 baseline을 기록한다 (`--reason "G0 initial baseline"`, anchor 설정).
- 체크: `check --suite core`가 exit 0.

### Step 9 — Mutation 검사 (P0)

- `mutation.py`와 `suites/mutation.json`을 만든다.
- 체크: `mutation-check`가 §9.5 기대를 모두 만족한다. 결과 표를 `tests/bench/README.md`에 적는다.

### Step 10 — Golden snapshot (P0)

- `golden.py`, `golden --init`으로 입력과 expected를 커밋한다.
- 체크: `golden` 통과. expected 한 파일을 1바이트 바꾸면 diff가 출력되고 exit 1인지 확인한 뒤 되돌린다.

### Step 11 — Legacy, private, replay (P1)

- `legacy.py`: `tests/golden/manifest.example.json`을 `legacy`로 실행하면 기존 `golden_benchmark.py` 출력과 같은 수치가 새 형식으로 나와야 한다.
- private suite 규칙: 저장소 밖 경로면 out/baseline도 밖에 둔다. 저장소 안 경로로 private 산출물을 쓰려고 하면 거부한다.
- replay: 형식(§6.8), `record_replay.py`, `render_piano.py`, `suites/replay-public.json`.
  - 환경(helper + transcription)이 있으면 core 중 5곡 이상을 녹화하고 baseline을 기록한다.
  - 없으면 suite는 비어 있는 채로 SKIPPED로 기록한다. 절차 문서는 필수다.

### Step 12 — 브라우저 tier (P1)

- `project-score.js`, `conformance.js`, `omr-live.js`, `make_omr_reference.py`, `suites/omr-live.json`을 만든다. 케이스: `piano-clean.pdf`, `.png`, `.jpg`, `piano-multipage.pdf`.
- conformance 대상:
  - core suite reference 전부
  - `samples/*`
  - 직전 core 실행의 예측 XML 중 50개 (케이스 id 정렬 순)
- conformance 기준: 마디(수, start_q, len_q, time, key.fifths)와 sounding multiset `(measure, pos_q, dur_q, midi, hand)`가 **100% 일치**. 불일치는 원인별로 기록하고, **reader를 앱에 맞춰 고친다.** 앱은 고치지 않는다.
- 환경이 없으면 SKIPPED와 사유를 기록한다.

### Step 13 — 문서, npm, CI, 마무리 (P0/P1)

- `tests/bench/README.md`에 다음을 쓴다.
  - 목적
  - 명령
  - 결과 읽는 법
  - reference·suite 추가법
  - baseline 갱신 절차
  - private suite
  - tier별 환경
  - 흔한 오류 (`INPUT_DRIFT`, `VERSION_MISMATCH`, `STATS_SHAPE`, `MUTATION_ANCHOR_MISSING`)
- §5의 기존 파일 수정을 적용한다.
- CI는 사용자 확인 후 반영한다.
- §11 acceptance를 전부 실행하고 결과를 `tests/bench/README.md` 끝 "G0 acceptance record"에 적는다 (날짜, 명령, 결과).

### (선택) Step 14 — Arrangement invariants (P2)

- `metrics/arrangement.py`와 `suites/arrange.json`.
- 대상 1: core reference 20곡 × level {beginner, intermediate, advanced} × style {balanced, melody, accompaniment} (`toMusicXml` `opts.arrangement`)
- 대상 2: `arrange_score.py` 10곡 × 7 스타일 × {beginner, intermediate}. `python -S arrange_score.py`로 music21을 끄고 결정론적 stdlib 경로를 쓴다. 입력은 canonical → wire score (`{tempo, measures:[{number,lenQ,time,key}], notes:[{m,b,dur,midi,staff,hand,voice}], sections}`).
- metric:
  - `arr.invented_pitches` = 0 (불변식)
  - `arr.max_notes_per_attack ≤ cap`
  - `arr.metre_preserved`, `arr.tempo_preserved`
  - `arr.melody_retention`: ref RH onset 묶음 최고음 중 결과에 남은 비율
  - `arr.bass_retention`, `arr.density_ratio`
  - `read.over_span_rate`, `read.max_chord_size`
  - `arr.no_invented_legato`: tie·slur 없음

---

## 11. Acceptance criteria

모두 **개발 PC(Windows, cp949)에서** 확인하고, 결과를 `tests/bench/README.md`의 "G0 acceptance record"에 남긴다.

| # | 기준 | 확인 방법 |
| --- | --- | --- |
| A1 | 단위 테스트 전부 통과. 네트워크·브라우저·GPU 없이, 60초 안 | `npm run test:bench` |
| A2 | `PYTHONIOENCODING`, `PYTHONUTF8` 없이 cp949 콘솔에서 모든 CLI가 한글 제목을 출력해도 죽지 않음 | `python tests/bench/run.py list`, `run --suite smoke` |
| A3 | `lint-corpus` error 0. `references.json` ≥ 150 항목 (micro 24 포함), 전부 커밋된 파일이고 license가 있음. `excluded.json`에 octave-shift 파일과 사유 | `python tests/bench/run.py lint-corpus` |
| A4 | smoke < 15 s, core < 90 s (개발 PC). `run.json`의 timing으로 확인 | `npm run bench:smoke`, `npm run bench` |
| A5 | **결정론**: core를 두 번 실행한 `results.json` sha256이 같음 | `run` ×2 + sha256 비교 |
| A6 | smoke·core baseline 커밋, 변경 없는 트리에서 `check` exit 0 | `npm run bench` |
| A7 | **민감도**: §9.5의 MUT-HANDS, KEY, DUR, METRE, PHASE가 모두 REGRESSION (exit 1)이고 명시된 metric이 실패 목록에 있음. MUT-NOOP은 PASS이고 `results.json` sha256이 같음 | `python tests/bench/run.py mutation-check` |
| A8 | golden 14케이스 통과. expected 변조 시 diff와 exit 1 | `python tests/bench/run.py golden` |
| A9 | lock: 생성 입력 1바이트 변경을 흉내 내면 (테스트에서 monkeypatch) `INPUT_DRIFT` exit 2 | `test_suite_lock.py` |
| A10 | 레거시 호환: `npm run test:transcription-core`(beat_track 포함 16 테스트)와 `npm run test:arranger` 통과. `legacy --manifest tests/golden/manifest.example.json`의 note metric이 `python tests/golden_benchmark.py tests/golden/manifest.example.json`과 같음 | 명령 실행 |
| A11 | summary.md에 판정, 헤드라인 Δ(baseline과 anchor), tag별 표, 상·하위 케이스 10개와 산출물 경로, 오류, holdout 집계가 있음 | 파일 확인 |
| A12 | 범위 준수: `git diff --stat 718bdf3..HEAD` (G0 커밋만)에 §5 목록 밖의 기존 파일이 없음. 특히 `audio-score.js`, `Piano Coach App.dc.html` 변경 0 | `git diff --stat` |
| A13 | 새 npm/pip 의존성 0 (`package.json` dependencies/devDependencies, requirements 파일 무변경) | diff |
| A14 | (P1) T1-C conformance: 환경이 있으면 대상 전부 100% 일치 (또는 불일치 원인 기록 후 reader 수정으로 해소). 없으면 SKIPPED 사유 기록 | `run.py conformance` |
| A15 | (P1) T1-O OMR live 4케이스 metric과 `omr.flag.*` 기록, baseline 커밋. T2 replay: 환경이 있으면 5곡 이상 녹화하고 baseline 기록. 없으면 SKIPPED 사유와 절차 문서 | 명령 실행 |
| A16 | `tests/bench/README.md`만 읽고 새 reference 1개를 추가해 lint, relock, baseline 갱신까지 할 수 있다 (구현 세션이 실제로 해 보고, 끝나면 되돌린다) | 수행 기록 |

P2(Step 14)를 하지 않았다면 acceptance record에 "P2 미실시"라고 적는다. 그래도 G0 완료로 본다.

---

## 12. 위험 요소

| # | 위험 | 영향 | 대응 |
| --- | --- | --- | --- |
| R1 | **reader가 앱과 다르게 읽음** (P5의 재발) | 측정이 사용자가 보는 것과 달라진다 | §8.2 규칙별 단위 테스트, T1-C conformance (A14). 앱 파서가 바뀌면 conformance가 드러낸다 |
| R2 | **정답 자체의 오류** (mode 누락, PDMX 특이점, ottava) | 틀린 기준으로 채점한다 | lint, `expect` override, `excluded.json`. 논란 있는 데이터는 제외한다 (D10) |
| R3 | **합성 연주 과적합** | 이후 goal이 생성기에 맞춰 휴리스틱을 조정해 실제 녹음에서 나빠진다 | holdout (집계만 공개), replay (실제 AMT 잡음), private suite, 여러 프로파일과 seed |
| R4 | **SQI 게이밍** | 한 구성만 올려 헤드라인을 올린다 | gate는 구성 metric별, tag별, 케이스별로 본다 (D9) |
| R5 | **플랫폼 결정론** (Windows ↔ Linux, Node 메이저) | CI에서 golden이나 lock이 깨진다 | 생성기는 사칙연산만 쓴다 (D8). JSON 직렬화 규칙을 고정한다. baseline에 node/python/platform을 기록한다. CI Node 메이저를 baseline과 맞춘다. 그래도 다르면 원인을 조사하고, 최후 수단으로 platform별 golden을 둔다 |
| R6 | **병렬 세션과의 충돌** | 공용 파일 merge 충돌, 남의 미완성 변경이 benchmark를 깨뜨린다 | 새 파일 위주, 공용 파일은 최소 편집. Step 0에서 알린다. 자기 파일만 stage한다. benchmark 실패 시 SUT diff가 자기 것인지 먼저 확인한다 |
| R7 | **`stats` 계약 변화** (`barStarts`, `beats` 의미가 바뀜) | 시간 매핑이 틀어진다 | `STATS_SHAPE` 오류로 드러낸다. adapter 계약 테스트. 필드가 바뀌면 timemap을 고친다 |
| R8 | **실행 시간 증가** | 개발자가 안 돌린다 | 예산(A4)을 두고, 초과 시 suite를 줄인다. full은 야간 |
| R9 | **baseline 잦은 갱신으로 회귀가 묻힘** | 누적 퇴행 | 이유 필수, history, anchor 대비 Δ를 항상 보고한다 |
| R10 | **저작권 자료 유출** | 법적 문제 | 저장소 안에는 license 필드가 있는 reference만 둔다. private suite 산출물의 저장소 내 기록을 거부한다. `tmp/`의 gitignore를 권고한다 |
| R11 | **범위 확장** (발견한 버그를 G0에서 고치고 싶어짐) | G0 지연, 측정과 개선이 섞인다 | §13, §14에 기록만 한다. 수정은 별도 goal로 |
| R12 | **mutation anchor 소실** (이후 SUT 변경) | 민감도 검사가 멈춘다 | `MUTATION_ANCHOR_MISSING`으로 명시적 실패. anchor 갱신 절차를 README에 둔다 |
| R13 | **브라우저 tier의 외부 의존** (unpkg, Chrome, Audiveris) | T1이 자주 SKIPPED가 된다 | T1은 P1이고 SKIPPED를 허용한다. 핵심 gate는 T0만으로 성립한다 |
| R14 | **micro 악보의 편향** (작성자가 쉬운 것만 만듦) | 과대평가 | 실제 교재·찬송가가 core의 80% 이상. micro는 현상 격리용이다 |

---

## 13. 이번 Goal에서 절대 건드리지 않을 범위

**코드**

다음은 수정하지 않는다. 읽기, import, 사본 실행만 허용한다.

- `audio-score.js`의 모든 휴리스틱: 박 추적, 박자, 조성, 철자, 손 배정, 양자화, 음가 정리, buildXml, arrangeNotes.
- `transcribe.py` (모델, consensus), `beat_track.py`, `pm2s_quant.py`, `midi_notes.py`의 동작.
- `omr-service.js`: Audiveris·PDFtoMusic 호출, 제한값, job 처리, catalog 검색.
- `arrange_score.py`, `/arrange`와 `/arrange-score`의 AI 편곡.
- `Piano Coach App.dc.html`의 전부: `parseMusicXML`, `readMxl`, `Import.*` (merge, validate, validateTranscription, PdfLayer), `ScoreArranger`, VexFlow engraving, UI, i18n.
- `server.js`, `score-search.js`, `course.js`, `lessons.js`, `support.js`, `i18n/*`.
- `catalog/**`와 `samples/**` 내용. 정답 문제는 `expect`와 `excluded.json`으로 처리한다.
- 배포 설정 (`render.yaml`, `Dockerfile`, `.dockerignore`), `requirements-*.txt`, `package.json`의 dependencies.
- 기존 테스트의 assertion. 예외: `tests/beat_track_test.py`의 sys.path 2줄.
- `tests/golden_benchmark.py`, `evaluate_transcription.py` (import만 한다).

**행동**

- 품질 개선 금지: Audio transcription, OMR, Arrangement, notation 모두 해당한다. §14의 이슈도 고치지 않는다.
- UI 수정 금지. 앱에 benchmark 화면을 만들지 않는다. 보고서는 Markdown/JSON 파일이다.
- 모델 가중치·오디오·저작권 PDF를 커밋하지 않는다.
- 사용자 확인 없이 push, 배포, CI 활성화를 하지 않는다.
- 다른 세션의 미커밋 변경(예: untracked `catalog/method/*.mxl`, 수정된 `catalog/method/index.json`)을 stage하거나 수정하지 않는다.

---

## 14. 조사 중 발견한 품질 이슈 (고치지 말고 기록만)

G0 benchmark가 완성되면 아래 항목이 metric으로 드러나야 한다. 각 항목의 "드러나는 metric"이 첫 baseline에서 실제로 나쁜 값인지 확인해 acceptance record에 적는다. **수정은 이후 goal의 일이다.**

| # | 이슈 | 근거 | 드러나는 metric |
| --- | --- | --- | --- |
| I1 | **compound 박자 출력의 `<sound tempo>` 단위 오류.** `buildXml`이 6/8에서 `<metronome>♩.=48</metronome>`(= 72 qpm, 맞음)과 함께 `<sound tempo="48"/>`을 쓴다. MusicXML의 `sound/@tempo`는 quarter/min이고, 앱 `parseMusicXML`도 sound를 먼저 quarter/min으로 읽는다 → **6/8 전사 악보가 2/3 속도로 재생·표시**된다 | `samples/prelude-fragment` deadpan 출력 확인. §1.7에서 표기 템포 정확도 79.6% vs 실제 재생 53.2% | `struct.tempo.ok_effective` ≪ `ok_written`, `struct.tempo.mark_consistent` < 1 (compound 출력) |
| I2 | **X → 6/8 편향.** 2/4, 3/4, 4/4, 3/8이 6/8로 쓰이고, 그 결과 가짜 붙임줄이 생긴다 | §1.7: onset 경로 박자표 47.6%, oracle 경로에서도 2/4→6/8 48건 | `struct.time_sig.*` (`metre-class`별), `notation.ties.extra_per_100` |
| I3 | **`octave-shift` 해석 의심.** 앱은 `type="up"` = +12, `"down"` = −12로 `<pitch>`를 **적힌 음**으로 본다. MusicXML 레퍼런스(`<octave-shift>`)의 원문은 *"The octave-shift type indicates if the notes are shifted up or down from their true pitched values because of printing difficulty. Thus a treble clef line noted with 8va will be indicated with an octave-shift down from the pitch data indicated in the notes."*이다. 요지는 `<pitch>`가 실제 음높이이고, 8va는 `down`으로 표시된다는 것이다 (구현 세션이 원문을 다시 확인할 것). PDMX(MuseScore) 교재 30개가 `type="down"`을 쓴다 → 앱에서 해당 구간이 한 옥타브 낮게 재생될 가능성이 있다. **확인되지 않았다.** 청취나 시각 비교로 검증이 필요하다 | `parseMusicXML` octave-shift 처리, 코퍼스 grep | G0에서는 reference에서 제외. 이후 goal에서 conformance와 OMR 비교로 확인 |
| I4 | `Import.load`가 2차 인식 병합본(`scoreM`)을 채택해도 반환값 `musicxml`은 1차 `xml`이다 | `Import.load` 끝의 `return { score, …, musicxml: xml }` | T1-O가 Score에서 직접 projection하도록 설계한 이유. 저장·공유 경로가 `musicxml`을 쓰는지는 이후 확인 |
| I5 | 조성 추정 오류. C major 교재를 G major로 추정 (Beyer 8·9번). 조표 정확도 73% | §1.7 | `struct.key.fifths_exact`, `notation.spelling.accuracy` |
| I6 | 손 배정이 곡에 따라 크게 틀린다 (Beyer 9번 0.39) | §1.7 | `notation.hand.accuracy` (`book:beyer`) |
| I7 | 리듬 정보가 적은 입력(온음표 화음만)에서 적힌 리듬이 불균등하다 (화음 간격 7-6-6-6-6-6-5박) | `samples/chords-sample` probe | `notation.ioi.accuracy` (`feature:low-information`, M24) |
| I8 | 기존 `golden_benchmark.py`: 단위 표기 오류(P6)와 reader 편차(P5) | 코드 | G0 새 runner로 대체. 레거시는 그대로 유지 |
| I9 | `tests/beat_track_test.py` 고아 | 조사 중 재현 | **G0에서 수정** (테스트 인프라, §5) |

---

## 15. 부록

### A. 명령 모음

```sh
# 매일
npm run bench:smoke                 # 빠른 확인
npm run bench                       # core 실행 + gate
python tests/bench/run.py ab --suite core --a git:HEAD --b worktree

# 의도한 변경 후
python tests/bench/run.py golden --bless --reason "..."
python tests/bench/run.py update-baseline --suite smoke --reason "..."
python tests/bench/run.py update-baseline --suite core  --reason "..."

# 가끔
npm run bench:full                  # holdout 포함
python tests/bench/run.py mutation-check
python tests/bench/run.py conformance            # npm start 필요
python tests/bench/run.py run --suite omr-live   # npm start + npm run omr 필요

# private (저작권 자료)
python tests/bench/run.py legacy --manifest C:/private/ppp-golden/manifest.json
python tests/bench/run.py run --suite-file C:/private/ppp-bench/private.json
```

### B. Private suite 예시 (저장소 밖)

```json
{
  "schema": "ppp.bench-suite/1",
  "name": "private-real",
  "kind": "replay",
  "cases": [
    {
      "id": "looping-the-rooms",
      "reference": "looping-the-rooms.musicxml",
      "reference_bar_starts": "looping-the-rooms.bars.json",
      "helper_result": "looping-the-rooms.helper.json",
      "expect": { "tempo_qpm": 162 }
    },
    {
      "id": "lulu-official-omr",
      "kind": "prediction-file",
      "reference": "lulu.musicxml",
      "prediction": "lulu.omr.musicxml"
    }
  ]
}
```

- 경로는 suite 파일 기준 상대 경로다.
- `reference_bar_starts`: 마디 수 + 1개의 초 값 (사람이 확인한 정답).
- case에 `kind`가 있으면 suite의 `kind`보다 우선한다. `replay`는 `helper_result`를 `toMusicXml`에 넣어 timed 정렬로, `prediction-file`은 이미 만들어진 MusicXML을 symbolic 정렬로 채점한다.
- 산출물과 baseline은 suite 파일 옆 `out/`, `baseline.json`에 둔다.

### C. 케이스 결과 한 줄 예시 (`results.json` 안)

```json
{
  "id": "hymns/amazing-grace|human|oracle|s1",
  "key": "3f2a9c1b7e04",
  "tags": ["set:hymns", "metre:3/4", "metre-class:simple-triple", "key:1", "mode:major", "staves:2",
           "size:m", "feature:pickup", "profile:human", "beats:oracle", "seed:1"],
  "status": "ok",
  "error_code": null,
  "expected": { "qpm": 100, "time": [3, 4], "key": { "fifths": 1, "mode": "major" }, "measures": 17 },
  "predicted": { "time": [6, 8], "key": { "fifths": 1, "mode": "major" }, "tempo_effective": 66.0,
                 "tempo_printed": 99.0, "bars": 16, "beatSource": "audio" },
  "metrics": {
    "sqi": 71.25,
    "notes.identity.f1": 0.993,
    "notation.ioi.accuracy": 0.97,
    "struct.time_sig.score": 0.25,
    "struct.tempo.ok_effective": 0,
    "struct.tempo.ok_written": 1,
    "struct.tempo.mark_consistent": 0,
    "notation.ties.extra_per_100": 18.2
  }
}
```

(숫자는 형식을 보이기 위한 예시다.)

### D. 구현 세션 시작 체크리스트

- [ ] 이 문서 전체를 읽었다.
- [ ] `git log 718bdf3..HEAD`와 `audio-score.js` diff를 확인했다. anchor 문자열, stats 필드, 파서 규칙을 재확인했다.
- [ ] `ListAgents`로 병렬 세션에 편집 예정 파일을 알렸다.
- [ ] `g0-quality-foundation` 브랜치를 만들었다.
- [ ] 사용자에게 `tmp/` gitignore와 CI push 여부를 물었다 (답을 기다리는 동안 Step 1–10 진행).
- [ ] Step 1부터 순서대로 진행하고, Step마다 체크포인트 통과 후 커밋한다 (자기 파일만 stage).
- [ ] 끝나면 §11 A1–A16을 실행해 acceptance record를 쓰고, §14 이슈가 첫 baseline에서 어떻게 드러나는지 적었다.

---

## 16. 구현 결과 (2026-09-22)

구현 세션이 채운 절이다. 위 §0–§15는 설계 원문 그대로 두었다. 설계와 다르게 결정한 것은 §16.3에 모았다.

### 16.1 무엇이 만들어졌나

- **브랜치** `g0-quality-foundation`. `main`에서 갈라졌고 **병합과 push는 하지 않았다** (사용자 결정 사항).
  - 여러 세션이 `D:/PPP`를 함께 쓰므로 별도 git worktree(`D:/PPP-g0`)에서 작업했다. 그래서 다른 세션의 미커밋 파일(`catalog/method/index.json`, untracked `.mxl` 약 120개)은 한 번도 stage되지 않았다.
- **새 파일은 모두 `tests/bench/` 아래에 있다** (§3.5 레이아웃).
  - 코어 `pppbench/`: reader, canonical, corpus/lint, perform, timemap, align, metrics 5종, suite/lock, runner, aggregate, compare, report, golden, mutation, legacy, private, tiers, projection
  - `node/`: notate.js, conformance.js, omr-live.js
  - `tools/`: make_micro.py, make_omr_reference.py, render_piano.py, record_replay.py
  - 데이터: 코퍼스(참조 299개, micro 24곡 포함), suite 8개와 lock, baseline 5개, golden 14케이스, replay fixture 6개
  - 단위 테스트 122개, `README.md`
- **기존 파일 수정은 §5 목록 그대로다.**
  - `package.json`: scripts 4개 추가, `test:transcription-core`에 beat_track 편입
  - `.gitignore`
  - `tests/beat_track_test.py`: sys.path 2줄
  - `tests/README.md`, `tests/golden/README.md`, `README.md`
  - 추가로 `.github/workflows/bench.yml`을 만들었다 (§4의 P1 항목, push 안 함).
  - `audio-score.js`, `Piano Coach App.dc.html`, `catalog/**`, 의존성은 변경 0이다.

### 16.2 Acceptance criteria 결과

모두 개발 PC(Windows 11, Node v24.17.0, Python 3.13.5, cp949)에서 확인했다. 자세한 기록은 `tests/bench/README.md` 끝 "G0 acceptance record".

| # | 결과 | 근거 |
| --- | --- | --- |
| A1 | **충족** | `npm run test:bench`: 단위 122개 + golden 14/14, 10.3 s. 네트워크·브라우저·GPU 없음 (T1 SKIPPED 경로만 로컬 포트를 시도한다). |
| A2 | **충족** | `PYTHONIOENCODING`/`PYTHONUTF8` 없이 `sys.stdout.encoding == cp949`인 상태에서 `list`, `run --suite smoke`가 한글·em dash를 출력하고 exit 0. 같은 환경에서 일반 `print('찬송가 — ok')`는 `UnicodeEncodeError`가 난다. 단위 테스트 `test_cli_prints_korean_on_a_cp949_console`. |
| A3 | **충족** | `lint-corpus`: 참조 299개 (micro 24), error 0, warning 56 (L9 mode 누락). 모두 커밋된 파일이고 license가 있다. `excluded.json` 52개: L5 octave-shift 29개, L8 마디 무결성 23개. |
| A4 | **충족** | smoke 0.5 s, core 15.1 s, full 108 s (`run.json` timing). |
| A5 | **충족** | core 2회 실행 `results.json` sha256 동일 (`69a83d55…`). **Linux에서도 바이트 동일**: Docker `node:24-bookworm`(Node 24.21, Python 3.11)의 LF clean checkout에서 core·smoke·replay의 sha256이 Windows와 같다. omr-live도 2회 동일. |
| A6 | **충족** | baseline 5개 커밋 (smoke, core, full.aggregates, omr-live, replay-public). 변경 없는 트리에서 5개 suite `check` 모두 PASS (exit 0). |
| A7 | **충족** | `mutation-check`: HANDS, KEY, DUR, METRE, PHASE 모두 REGRESSION (exit 1), 지정 metric이 실패 목록에 있다. NOOP은 PASS이고 `results.json` sha256 동일. 수치는 `tests/bench/README.md` 표. CLI로도 확인했다: MUT-KEY 사본으로 `run` 후 `check` → exit 1. |
| A8 | **충족** | `golden` 14/14. expected 1바이트 변조 시 마디 단위 diff 출력, exit 1. 복원 후 통과. |
| A9 | **충족** | `test_suite_lock.py`: 생성 입력 1바이트 변경(monkeypatch)이 `INPUT_DRIFT` exit 2를 낸다. |
| 회귀 | **통과** | `npm test` 26개 suite: 변경 전 1,056 check 전부 통과. 변경 후(브랜치) 전부 통과. 단 두 suite는 worktree 환경 차이를 맞춰 다시 돌렸다: `transcription.test.js`는 `PPP_TRANSCRIBE_PYTHON`(venv가 worktree에 없음), `course.test.js`는 브랜치를 서빙하는 서버(D:/PPP의 index.json에 다른 세션의 미커밋 변경이 있음). 코드 원인 실패 0. |
| A10 | **충족** | `test:transcription-core` 16개 통과 (beat_track 3개 포함), `test:arranger` 3개 통과. `legacy --manifest tests/golden/manifest.example.json`의 note metric이 `golden_benchmark.py`와 같다 (단위 테스트로 고정). |
| A11 | **충족** | summary.md: 판정, 헤드라인(baseline Δ, anchor Δ), tag 표, 상·하위 변화 케이스 10개(원인 metric, 산출물 경로), 최저 SQI 10개, 오류, holdout 집계. |
| A12 | **충족** | `git diff --stat 663d463..g0-quality-foundation`에서 `tests/bench/` 밖의 변경은 §5 목록 6개 + `.github/workflows/bench.yml` + `docs/`뿐. `audio-score.js`와 앱 HTML 변경 0. |
| A13 | **충족** | dependencies, devDependencies, requirements 무변경. |
| A14 | **충족** | conformance 224/224 동일: core 참조 141개, samples 4개, octave-shift 제외 파일 29개, core 예측 XML 50개. 비교가 형식적이지 않은지는 음정 1개 변경·다른 파일 교차 대입으로 불일치가 잡히는 것을 확인했다. |
| A15 | **충족** | T1-O omr-live 4케이스 metric과 `omr.flag.*` 기록, baseline 커밋. T2: helper(TransKun+Kong 앙상블, Beat This)로 **6곡을 녹화**해 `replay/`에 커밋하고 `replay-public` baseline을 기록했다. |
| A16 | **충족** | `samples/chords-sample`을 README 절차대로 추가했다: lint → (relock 전 run: INPUT_DRIFT) → relock → check: SUITE_CHANGED → update-baseline → PASS. 끝난 뒤 되돌렸다. |
| P2 | **미실시** | Step 14 (arrangement invariants)는 하지 않았다. G0 완료 조건에는 들지 않는다. |

### 16.3 설계와 다르게 한 것, 구현 중 정한 것

1. **줄바꿈 정규화 해시.** `core.autocrlf=true`라서 텍스트 악보가 Windows에서는 CRLF, Linux에서는 LF로 checkout된다. 그래서 참조 sha256과 SUT sha256을 "CRLF를 LF로 읽은 내용"으로 계산한다 (`util.content_sha256`). `tests/bench/.gitattributes`로 벤치 파일 자체는 LF를 유지한다.
2. **lint L12 (신규).** 조표가 요구하는 `<alter>`를 음표가 따르지 않는 참조가 대상이다. 조표 영향 음 3개 이상 중 20% 미만이면 해당한다.
   - 해당 참조는 key·spelling metric(`struct.key.fifths_exact`, `struct.key.mirex`, `notation.spelling.accuracy`)을 `expect.skip_metrics`로 제외한다. 리듬·박자·손 채점은 유지한다.
   - 찬송가 88곡 중 78곡이 해당한다 (§16.5 I10). 설계 D10("논란 있는 정답은 제외")을 metric 단위로 적용한 것이다. 참조 전체를 빼면 찬송가 metre 커버리지를 잃는다.
3. **core 크기.**
   - reference 141개, 케이스 523개. 설계 추정은 148개, 약 544개였다.
   - §6.5 할당 규칙을 그대로 적용한 결과다. holdout 제외와 책별 할당 상한 때문에 줄었다.
4. **`metre-class:compound-single`.** 3/8은 §6.7 규칙(beat-type 8, beats % 3 == 0, 그룹 수 = 1)대로 compound이지만 목록에 이름이 없어서 이 이름을 붙였다. 5/4 등은 `irregular`.
5. **`struct.time_sig.score`의 "regrouped".** 정의("beat 단위와 종류가 같고 마디당 박 수만 다름") 그대로 3/4↔4/4, 2/4↔3/4도 0.5를 받는다. 예시(2/4↔4/4 등)보다 넓다.
6. **정렬 동점.** §8.3 DP 목적함수 Σ(W−|Δ|)는 "느슨한 두 쌍"보다 "아주 가까운 한 쌍"을 고를 수 있다. 설계대로 두었고, 단위 테스트에 명시했다.
7. **baseline의 케이스 행.** 케이스별 metric은 SQI 구성 metric만 저장한다 (gate가 읽는 것이 SQI와 그 구성뿐이다). core baseline이 1.1 MB에서 0.47 MB로 줄었다.
8. **`omr` set.**
   - `corpus/omr/piano-test-score.musicxml`은 `truth.json`에서 생성한다. references.json에 set `omr`로 등록하지만 `full`에는 넣지 않고 omr-live만 쓴다.
   - OMR 결과는 반환 MusicXML이 아니라 **페이지 안의 Score를 직접 projection**한다 (I4 때문).
9. **conformance 대상 추가.** 설계 대상에 octave-shift 제외 파일 29개를 더했다. 참조에서는 빼도, reader의 ottava 규칙은 앱과 일치해야 하기 때문이다.
10. **.gitignore.**
    - 사용자 지시에 따라 `tmp/`를 추가했다 (저작권 자료 보호).
    - 루트의 `tools/` 규칙이 `tests/bench/tools/`까지 숨겨서, `!tests/bench/tools/` 예외를 넣었다. 첫 커밋에서 이 때문에 `make_micro.py`가 빠졌고, 발견 후 바로 커밋했다.
11. **CI.** `.github/workflows/bench.yml`을 만들었다.
    - gate job (push/PR): unit, golden, lint, smoke, core, 기존 Python 테스트
    - nightly/수동 job: mutation-check, full
    - 무거운 작업은 분리했다. **push하지 않았으므로 아직 동작하지 않는다.** Linux 결정론은 Docker로 미리 확인했다 (A5).
12. **T1/T2 환경 경로.** worktree에는 `node_modules`와 transcribe venv가 없어 환경 변수로 연결했다: `PPP_BENCH_NODE_MODULES`(puppeteer), `PPP_TRANSCRIBE_PYTHON`(render).

### 16.4 §14 이슈가 첫 baseline에서 드러나는 방식

core 기준 (케이스 523개).

| # | 드러난 수치 |
| --- | --- |
| I1 | 6/8·12/8·3/8로 쓴 출력 177개 전부 `struct.tempo.mark_consistent` = 0. 그 177개에서 `ok_effective` 0.04 vs `ok_written` 0.84. 전체로는 `ok_effective` 0.549 vs `ok_written` 0.818. simple 박자 출력은 `mark_consistent` 1.0. |
| I2 | 틀린 박자 222개 중 140개가 "→6/8" (2/4→6/8 76, 3/4→6/8 20, 3/8→6/8 16, 4/4→6/8 10). `time_sig.exact`는 simple-duple 0.07, simple-triple 0.60, simple-quadruple 0.95. 가짜 붙임줄은 박자가 틀린 케이스 7.4/100음, 맞은 케이스 1.9/100음. Gymnopédie onset 경로는 identity F1 1.0인데 6/8, 가짜 붙임줄 67.6/100음. |
| I3 | octave-shift 참조 29개 제외 (L5). conformance로 reader가 앱의 해석을 그대로 재현하는 것은 확인했다. 해석 자체의 옳고 그름은 이후 goal에서 청취·시각 비교로 확인해야 한다. |
| I4 | omr-live는 Score를 직접 projection한다. 반환 `musicxml` 경로는 측정하지 않았다. |
| I5 | `struct.key.fifths_exact` 0.887 (skip 제외 n=382). czerny849 0.52. full에서 Beyer 8·9가 C major → G major (0 → 1). |
| I6 | `notation.hand.accuracy` 0.885. beyer 0.74, hanon 0.72. Beyer 9는 0.391 (설계 probe 0.39와 일치). |
| I7 | M24 (온음표 화음) onset 경로 `notation.ioi.accuracy` 0.00, oracle beats는 1.00. `feature:low-information` 0.78 (전체 0.90). |
| I8 | `legacy` 명령은 기존 metric을 그대로 내고, 단위를 quarter-beats로 바로잡은 이름을 쓴다. 기존 reader는 그대로 두었다. |
| I9 | **수정함** (§5 범위). `test:transcription-core`에 편입. |

### 16.5 구현 중 새로 발견한 품질 이슈 (고치지 않음)

| # | 이슈 | 근거 | 드러나는 metric |
| --- | --- | --- | --- |
| I10 | **찬송가 78곡(C장조 외 전부)의 음이 조표를 따르지 않는다.** `catalog/hymns/abc-to-musicxml.js`가 ABC의 명시적 임시표만 `<alter>`로 쓰고 `K:` 조표를 적용하지 않는다. 그래서 앱이 이 찬송가들을 **틀린 음으로 재생·표시**한다. 예: Amazing Grace(G major)에 F#이 하나도 없고 `<alter>`가 0개다. | pitch class 분포, 원본 파일 grep | lint L12. 해당 참조는 key·spelling metric을 skip한다. 고치면 sha256이 바뀌어 L2 error가 나므로 재등록 시 skip을 뺀다. |
| I11 | **OMR로 읽은 피아노 악보에서 오른손이 연주 대상이 아니다.** Audiveris가 2-staff 피아노를 1-staff part 2개("Voice" + 다른 part)로 내보낸다. 앱의 손 규칙(2-staff part가 없으면 마지막 part가 피아노)이 높은음자리표 staff를 `x`(연주 안 함), 낮은음자리표 staff를 `r`로 둔다. fixture 4개 모두에서 나타났다. | omr-live projection: `1x` 32개, `2r` 16개 | omr-live `notes.symbolic.f1` 0.50 (PNG/JPG/multipage), `notation.hand.accuracy` |
| I12 | PDF fixture(`piano-clean.pdf`)가 8마디가 아니라 16마디로 인식되고, confidence 0.8인데 의심 마디 표시가 0개다. | omr-live | `struct.measures.count_exact` 0, `omr.flag.recall` 0 |
| I13 | 5/4(M21)는 4/4로 쓰인다 (미지원, 설계에서 예상한 것). | core M21 3케이스 모두 4/4 | `metre:5/4` |

### 16.6 남은 일 (G0 범위 안에서 미완)

- **P2 Step 14** (arrangement invariants): 미실시.
- **main 병합과 push**: 사용자 결정. push하면 CI가 켜진다.
- **replay fixture 재녹화 정책**: GPU 추론은 결정론적이지 않다. fixture는 녹화 시점에 고정했다. 모델이나 helper를 바꾸면 의도적으로 다시 녹화하고 `replay-public` baseline을 다시 기록해야 한다 (README Replay 절).
- **worktree에서 `npm test` 실행 시 주의**: `tests/transcription.test.js`의 "venv transkun console script" 검사가 worktree에서는 실패한다. `tools/transcribe-venv`가 git 밖(ignored)이라 worktree에 없기 때문이며, `PPP_TRANSCRIBE_PYTHON`을 지정하면 통과한다. 코드 회귀가 아니다 (§16.2 기존 회귀 테스트 기록 참조).

---

## 17. Independent Review (2026-09-22)

G0 구현에 참여하지 않은 리뷰 세션이 작성했다. §16과 README의 주장은 출발점으로만 썼고, 아래에는 **리뷰어가 직접 실행하거나 코드·데이터로 확인한 사실만** 적는다. 대상: `D:/PPP-g0`, 브랜치 `g0-quality-foundation` @ `254d8ae`. 이 절과 `tests/bench/review/`(리뷰어의 adversarial 스크립트) 외에는 아무것도 바꾸지 않았고, 커밋·merge·push도 하지 않았다.

### 17.0 판정

**`READY_FOR_FIXER`** — 지금 main에 merge하지 말고, 아래 BLOCKER 1건과 MAJOR 11건을 fixer가 처리한 뒤 다시 판정한다.

구현 자체는 성실하다. 주장한 수치는 모두 재현되었다: unit 122, golden 14/14, lint 0 error, 결정론(Windows·Linux byte-identical), mutation-check 5/5, conformance 224/224, omr-live·replay PASS, 범위 준수. 그러나 **벤치마크가 판정해야 할 것을 판정하지 못하는 구조적 결함**이 있다.

- 리뷰어가 새로 설계한 사용자 가시 회귀 7개 중 **metric gate(core)가 잡은 것은 1개**(ADV-GLOBAL-TEMPO)다.
- ADV-NO-TEMPO는 SQI **개선**으로 판정되었다 (B1).
- ADV-XML-METRE와 ADV-NO-PEDAL은 `results.json`이 원본과 byte-identical이었다 (M1, M4). ADV-NO-PEDAL은 golden까지 모든 층을 통과했다.
- gate가 놓친 나머지 5개는 golden에서만 드러났다. golden은 ADV-EXTRA-BAR와 ADV-GLOBAL-TEMPO에서 `KeyError`로 크래시했다 (M7).
- SQI 81.7은 사용자 체감 품질을 크게 과대평가한다 (M2).
- 제외·skip이 알려진 프로덕션 결함과 가장 어려운 곡들을 benchmark 출력에서 보이지 않게 만든다 (M8, M9).

집계: **BLOCKER 1 · MAJOR 11 · MINOR 13 · OPTIONAL 5.**

### 17.1 검증 방법과 환경

| 항목 | 리뷰어가 한 것 |
| --- | --- |
| 기본 실행 | Windows 11, cp949 콘솔, Python 3.13.5, Node v24.17.0에서 unit, golden, lint, smoke, core(2회), full, mutation-check, `ab`, legacy, replay-public |
| 결정론 | ① 다른 cwd ② Windows 경로 표기 ③ `PYTHONHASHSEED` 고정·무작위 ④ listdir·glob·git 목록·references·suite 순서를 모두 뒤집은 실행 ⑤ `core.autocrlf=false` LF clone(다른 절대경로) ⑥ Docker `node:24-bookworm`(Python 3.11.2, Node 24.21.0) + `--network none`으로 CI gate 단계 전부 |
| T1 | g0 worktree에서 `PORT=8799 node server.js`를 띄우고 `PPP_BENCH_NODE_MODULES=D:/PPP/node_modules`로 실행: conformance, omr-live(4 fixture, 로컬 helper의 Audiveris) |
| adversarial | `tests/bench/review/adversarial.py`(신규, 커밋 안 함). SUT mutation 7종, 오라클(정답을 예측으로), lock 우회, 데이터 감사, SQI 감사, conformance 사각지대. `python tests/bench/review/adversarial.py` → **1 OK, 13 GAP**. `--conformance`를 붙이면 3 GAP이 추가된다. 약 2분 |
| 데이터 | 299개 참조 전수 스캔(꾸밈음·반복·장식음·템포 표기·rights), 찬송가 100곡·octave-shift 29곡 원문 분석 |
| 확인 불가 | `CLAUDE.md`는 두 worktree와 git 이력 어디에도 없다. T2 녹화(GPU)는 재수행하지 않았다(재생 결정론만 확인) |

### 17.2 Acceptance A1–A16 재검증

| # | 구현자 주장 | 리뷰어 결과 | 판정 |
| --- | --- | --- | --- |
| A1 | unit 122 + golden 14, 10.3 s | 122 OK 9.6 s, golden 14/14 0.26 s. Docker `--network none`에서도 통과 | 확인 |
| A2 | cp949에서 한글 출력 | stdout=cp949에서 `print('찬송가 — ok')`는 `UnicodeEncodeError`, `run.py list`는 정상 | 확인 |
| A3 | 참조 299, error 0, 제외 52 | 동일. 단 license 근거는 주장보다 약하다 (M10) | 확인 (단서) |
| A4 | smoke 0.5 s · core 15.1 s · full 108 s | smoke 0.53 s, core 12.7 s(Win)/29.6 s(Docker), full 100.4 s | 확인 |
| A5 | core sha `69a83d55…`, Linux 동일 | 동일. 조건 ①–⑥ 모두 byte-identical. smoke `ebf9ca25…`, replay `5aac870a…`도 OS 간 동일. 단 Linux 절차는 저장소에 없다 (m7) | 확인 |
| A6 | 5 suite check PASS | smoke·core·full·replay-public·omr-live(재실행) 모두 PASS | 확인 |
| A7 | mutation 5종 REGRESSION, NOOP 동일 | 재현(27 s). 그러나 5종 모두 치명적 크기이고, 새 mutation 7종 중 gate가 잡은 것은 1종 (B1, M1, M3, M4) | 확인 (일반화 안 됨) |
| A8 | golden 14/14, 변조 시 exit 1 | 재현. 마디 수가 바뀌는 변경에서는 `KeyError`로 크래시 (M7) | 부분 |
| A9 | 1바이트 input 변경 → INPUT_DRIFT | unit test 통과. 그러나 연주를 바꾸지 않는 정답 수정은 못 잡는다 (m1) | 부분 |
| A10 | transcription-core 16, arranger 3, legacy 동등 | 16·3 통과(Docker 포함). legacy 동등성은 자기 자신과 비교하는 manifest뿐이다 (m8) | 확인 (증거 약함) |
| A11 | summary 구성 | 판정·헤드라인(Δ baseline/anchor)·태그표·변화 케이스·최저 케이스·오류·holdout 모두 있음 | 확인 |
| A12 | 범위 준수 | `git diff --stat 663d463..HEAD`: 프로덕션·catalog·의존성 파일 변경 0. bench 밖은 §5 목록, workflow, docs뿐 | 확인 |
| A13 | 의존성 0 | stdlib + Node만(Docker offline 통과). 단 `git` 실행파일이 필요하다 (m6) | 확인 |
| A14 | conformance 224/224 | 재현(8.7 s). 그러나 비교 범위가 좁다. 붙임줄 병합·철자·mode를 망가뜨린 reader도 224/224 (M6) | 확인 (의미 제한) |
| A15 | omr-live 4, replay 6 | omr-live 재실행 47 s, 같은 수치, PASS. replay 재생 PASS·OS 간 동일. 녹화는 미재현 | 확인 |
| A16 | README대로 참조 추가 | LF clone에서 `samples/chords-sample`로 재수행: lint → INPUT_DRIFT → relock → SUITE_CHANGED → update-baseline → PASS, 원복 | 확인 |

### 17.3 BLOCKER

#### B1. null을 "해당 없음"으로 처리해서, 출력에서 정보를 지우는 회귀가 "개선"으로 판정된다

- **문제**: 예측 악보에 템포 표기가 없으면 `struct.tempo.ok_effective`와 `ok_written`이 null이 된다.
  - `compare.compare`는 aggregate가 null로 바뀌면 경고(`now null`)만 낸다.
  - `composite._weighted`는 null 구성요소를 분자·분모에서 빼고 SQI를 재정규화한다.
  - 그 결과 정보를 지우면 SQI가 오른다. metric별 커버리지 `n`의 감소는 gate가 보지 않는다.
- **증거**:
  - `ADV-NO-TEMPO`: `buildXml`에서 `<direction>…<sound tempo>` 한 줄만 삭제했다.
    - core `check` **PASS**. `sqi: 81.742495 -> 83.203820 (+1.461325)`가 **IMPROVED**로 표시된다. `struct.tempo.ok_effective: now null`은 warning뿐이다.
    - smoke PASS, replay-public PASS. golden만 0/14로 실패했다.
  - 앱은 템포 없는 악보를 `Math.round(tempo || 84)`(`Piano Coach App.dc.html:4308`)로 84 qpm에 재생한다. 사용자가 귀로 듣는 회귀다.
- **재현**: `python tests/bench/review/adversarial.py --only mutations` (ADV-NO-TEMPO 줄)
- **관련 파일**:
  - `tests/bench/pppbench/compare.py:106-110`
  - `tests/bench/pppbench/metrics/composite.py:32-42`
  - `tests/bench/pppbench/metrics/structure.py:89-100`
- **현재 영향**:
  - metric gate가 사용자 가시 회귀를 "개선"으로 인증하고, headline SQI는 반대 방향으로 움직인다.
  - golden은 모든 SUT 변경에서 깨지는 층이다. §9.7 절차상 metric이 IMPROVED면 `golden --bless`와 `update-baseline`으로 이어진다. 따라서 golden은 이 판정을 바로잡지 못한다.
- **미래 Goal 영향**:
  - G1 ScoreGraph와 G4 Engraving은 XML writer를 재구성한다. 그때 템포·조표·손 정보 같은 출력 요소가 빠지면 개선으로 기록된다.
  - anchor와 history에 거짓 개선이 누적된다.
- **권장 수정**:
  1. "정답에 없음"과 "예측에 없음"을 구분한다. expected가 있는데 예측에 값이 없으면 0으로 채점한다(`ok_effective`, `ok_written` 등).
  2. gate: baseline에서 값이 있던 metric이 null이 되거나 `n`이 줄면 FAIL.
  3. SQI 재정규화는 정답 쪽 사유(`skip_metrics`, 1-staff 참조)에만 허용한다. `SQI_VERSION`과 `METRICS_VERSION`을 올린다.
  4. unit test: 템포를 지운 XML에서 SQI가 내려가고 gate가 REGRESSION을 내야 한다.

### 17.4 MAJOR

#### M1. 박자표와 시간 격자를 악보(XML)가 아니라 SUT의 자기 보고(`stats`)에서 읽는다

- **문제**:
  - `structure.predicted_time`(`metrics/structure.py:70-74`)와 `evaluate.predicted_summary`(`evaluate.py:27-32`)는 `stats.beatsPerBar/beatType`를 우선 쓴다.
  - `struct.downbeat.f1`은 `stats.barStarts`를 쓴다.
  - 예측 음의 시각은 모두 `stats.barStarts/beats`로 계산한다(`timemap.PredTime`).
  - 사용자가 보는 것은 XML의 `<time>`이다. 구현과 평가기가 같은 자기 보고를 공유한다.
- **증거**:
  - `ADV-XML-METRE`: XML `<time>`만 beats×2, beat-type×2로 바꿨다(3/4→6/8, 4/4→8/8, 마디 길이·stats 불변). core `results.json`이 원본과 **byte-identical**(`69a83d55…`)이었다. smoke·replay PASS, golden만 0/14.
  - 구현자의 `unit/test_degradation.py:53-60`도 XML과 stats를 **함께** 바꿔야 메트릭이 움직이도록 쓰여 있다. 이 가정이 테스트에 고정되어 있다.
- **재현**: `adversarial.py --only mutations` (ADV-XML-METRE)
- **관련 파일**: `pppbench/metrics/structure.py:70-74,101-108`, `pppbench/evaluate.py:27-32`, `pppbench/timemap.py:38-63`
- **현재 영향**: 현 SUT는 XML과 stats를 같은 변수로 쓰므로 지금 수치는 맞다. 그러나 §3.1 원칙 4("앱과 같은 의미로 읽고")가 박자표에서는 성립하지 않는다.
- **미래 Goal 영향**: G1이 writer를 교체하거나 분리하면 stats와 XML이 갈라질 수 있고, 벤치마크는 틀린 쪽을 채점한다. G4의 박자표 표기 변경도 잴 수 없다.
- **권장 수정**:
  - 예측 박자표는 예측 canonical(XML)의 `primary_time()`으로 읽는다.
  - stats는 계약 검사로만 쓴다. 신규 `struct.stats_consistent`에서 stats와 XML의 박자·마디 수가 다르면 case error로 처리한다.
  - `test_degradation`을 XML만 바꾸는 형태로 고친다.

#### M2. SQI 81.7은 사용자 체감 품질을 크게 과대평가한다

- **문제**:
  - 가중치 40%가 거의 포화된 두 지표에 걸려 있다. identity F1(평균 0.980)과 IOI accuracy(0.897)다. IOI는 ×2·×½·×3/2 같은 metrical 배율을 정답으로 인정한다.
  - onset_pos·duration·hand·spelling은 **짝지어진 음에서만** 계산하므로, 음을 잃어도 떨어지지 않는다.
  - 틀린 박자표도 부분점수를 받는다.
- **증거** (core 523 케이스, 리뷰어 분석):
  - 평균 기여도: identity 20.53점 + IOI 18.84점 = **81.7점 중 39.4점**. tempo는 2.90점, onset_pos는 5.40점, time_sig는 6.82점이다.
  - 사용자에게 보이는 4대 실패를 박자표 오답, 재생 템포 ±4% 밖, 조표 오답, 음 50% 이상이 틀린 마디·박으로 정의했다.

    | 4대 실패 개수 | 케이스 | 평균 SQI | 최소–최대 SQI |
    | --- | --- | --- | --- |
    | 0개 | 191 (36.5%) | 95.6 | 74.7–100.0 |
    | 1개 | 83 (15.9%) | 87.2 | 69.0–95.0 |
    | 2개 | 78 (14.9%) | 77.7 | 55.2–87.5 |
    | 3개 | 155 (29.6%) | 66.8 | 39.2–80.6 |
    | 4개 | 16 (3.1%) | 52.5 | 36.5–68.0 |

  - `micro/M19-fast-3-8|deadpan|none|s1`: 3/8을 6/8로 썼고, 재생 템포 61 vs 92(−34%), 위치 50% 미만인데 **SQI 80.6**이다. suite 평균 81.7과 거의 같다.
  - 엄격 기준 "쓸 수 있는 악보" 비율(위 4개 모두 정답, identity ≥ 0.95, onset_pos ≥ 0.90): **169/523 = 32.3%** (deadpan 20.6%, beats:none 22.0%, oracle 51.4%).
  - 틀린 박자 222건 중 88건이 부분점수를 받았다. 3/4→4/4는 0.5를 받는다(17건, §16.3-5의 정의 확장).
  - omr-live에서 오른손 전체가 연주 대상에서 빠진 결과(symbolic F1 0.50)가 SQI 72.5를 받는다.
- **재현**: `adversarial.py --only sqi`. 분포는 `tests/bench/out/review/core-original/results.json`에서 계산한다.
- **관련 파일**: `pppbench/metrics/composite.py`, `pppbench/metrics/notation.py:73-105`, `pppbench/metrics/structure.py:18-28`, `docs/CURRENT_STATE.md`(SQI 81.74 헤드라인), `tests/bench/README.md`
- **현재 영향**: "SQI 81.7"은 "악보가 대체로 좋다"로 읽힌다. 실제로는 2/3가 사용자에게 보이는 치명적 문제를 하나 이상 가지고, 치명 오류가 3개인 악보가 평균 점수를 받는다.
- **미래 Goal 영향**: "SQI 81.7→83.0" 같은 성과 보고가 포화 지표의 미세 변화에 좌우된다. 치명 오류(템포, 박자)를 고친 효과는 작게 보인다.
- **권장 수정**:
  1. release gate와 headline을 **케이스 단위 pass/fail 통과율**과 실패 유형별 비율로 바꾼다. 위 4대 실패와 identity·위치 임계를 쓴다.
  2. SQI는 diagnostic으로 남기되 `sqi/2`로 올린다.
     - 표기 정확도의 분모를 정답 음으로 한다(짝 없는 음 = 오답).
     - 3/4↔4/4 부분점수를 없앤다.
     - 재생 템포와 박자표의 비중을 높이거나 곱셈형으로 결합한다.
  3. CURRENT_STATE와 README의 헤드라인을 교체한다.

#### M3. gate가 음악 범주 하나에 국한된 체계적 오류를 통과시킨다

- **문제**:
  - gate가 보는 것은 aggregate 평균, `set/profile/beats` 태그의 SQI, 케이스 SQI −10점뿐이다.
  - `mode:*`, `metre-class:*`, `feature:*`, `book:*`, `profile:rubato`에는 가드가 없다.
  - micro 곡은 곡마다 한 질문을 격리하도록 설계했는데, 평균에 묻힌다.
  - 템포가 완전히 틀린 케이스도 −5점(가중치 0.05)이라 케이스 기준에 걸리지 않는다.
- **증거**:
  - `ADV-MINOR-LEADING-TONE`: 모든 단조에서 이끎음을 플랫으로 쓰게 했다(A minor의 G#→Ab).
    - 22개 케이스에서 철자가 떨어졌다(`micro/M11-harmonic-minor` 1.000→0.897, `micro/M19-fast-3-8` 1.000→0.906).
    - 그래도 core PASS다. 경고 `spelling 0.997303 -> 0.994546 (-0.002757)`만 나왔고 허용치는 −0.003이다.
    - smoke에 `micro/M11-harmonic-minor`가 들어 있는데도 smoke PASS다. golden만 13/14로 잡았다.
  - `ADV-GLOBAL-TEMPO`(rubato/drift 구간의 양자화 파괴)는 core는 잡았지만 smoke는 PASS였다.
- **재현**: `adversarial.py --only mutations`
- **관련 파일**: `pppbench/suite.py:15-60`(GATE_CORE, GATE_SMOKE), `pppbench/compare.py:79-137`
- **현재 영향**: "모든 단조곡의 이끎음 철자 오류" 같은 체계적 회귀가 CI를 통과한다.
- **미래 Goal 영향**: G3(조성·철자)와 G4 개선의 부작용이 단조, 3/8, 셋잇단, pickup 같은 한 범주에만 생기면 통과한다. 반대로 한 범주의 개선도 평균에 가려진다.
- **권장 수정**:
  1. micro 케이스별 기대값 gate: 곡마다 핵심 metric이 baseline보다 나빠지면 FAIL(unit test처럼).
  2. tag guard를 `mode`, `metre-class`, `feature`, `book`, `profile:rubato`까지 넓힌다. n이 작은 태그는 metric별 절대 허용치를 쓴다.
  3. 케이스 단위 metric 가드: key, time_sig, tempo, spelling이 1→0으로 뒤집힌 케이스 수에 허용치를 둔다.
  4. smoke에 amt·rubato 행을 추가한다 (m3).

#### M4. 사용자에게 보이는 출력 차원 다수가 어떤 층에서도 측정되지 않는다

- **문제**: 페달, 표시 임시표(`<accidental>`), 마디 수, 쉼표, voice, clef는 metric이 없거나 gate 밖이다. golden 입력 14개는 모두 `pedals: []`이고, 합성 입력도 항상 `pedals: []`다(`perform.py:213-214`).
- **증거**:
  - `ADV-NO-PEDAL`
    - core `results.json`이 **byte-identical**이었다. smoke·replay PASS, golden 14/14. **모든 층을 통과했다.**
    - 앱은 `<pedal>`을 파싱해(`App:4034-4040`) 재생 서스테인에 쓴다(`App:2596` `ccsWritten`).
    - replay fixture 6개 중 5개는 페달 없는 합성 렌더인데도 AMT가 페달을 검출했다(beyer/029 10개, M03 6개, prelude 7개, we-gather-together 22개, happy-birthday 3개). SUT가 가짜 페달을 쓰는지 아무 층도 모른다.
  - `ADV-NO-ACCIDENTAL`
    - core PASS. `read.accidentals_per_note`는 0.0288→0.0으로 떨어졌지만 gate 밖이다.
    - 앱은 임시표를 `<accidental>`에서만 그린다(`App:4207, 11432`). 그래서 C major의 C#이 C로 보인다.
  - `ADV-EXTRA-BAR`: `struct.measures.count_exact`가 0.545→0.025로 떨어졌지만 gate 밖이라 PASS다.
- **재현**: `adversarial.py --only mutations`
- **관련 파일**: `pppbench/metrics/readability.py`, `pppbench/suite.py`(GATE_*), `pppbench/perform.py:213-214`, `tests/bench/golden/inputs/*.json`
- **현재 영향**: 페달 소실, 임시표 소실, 빈 마디 추가라는 세 가지 회귀가 metric gate를 통과한다. 페달 소실은 golden까지 통과한다.
- **미래 Goal 영향**: G4 Engraving(임시표·쉼표·빔·clef)과 G5 Playability(페달·운지)의 개선과 회귀를 잴 수 없다.
- **권장 수정**:
  1. 이미 계산하는 `struct.measures.count_exact`와 `read.accidentals_per_note.delta`를 gate에 넣는다.
  2. canonical에 pedal, 표시 임시표, clef, voice를 추가하고 정답 대비 metric을 만든다. 예: 조표와 마디 상태로 필요한 임시표 집합 대비 F1.
  3. 합성 pedal 프로파일을 추가하고 golden에 pedal 입력 케이스를 넣는다.
  4. replay의 가짜 페달 비율을 측정한다.

#### M5. pickup 관례가 현재 toMusicXml 출력에 묶여, 올바른 조판을 벌점 처리한다

- **문제**:
  - `notation.onset_pos`는 정답 첫 마디가 implicit이면 pickup 음을 오른쪽 정렬(`sig − len`)해서 비교한다(`metrics/notation.py:80`). 예측이 pickup을 "앞 쉼표가 있는 꽉 찬 마디"로 쓴다고 가정하는 것이다.
  - `struct.downbeat.f1`은 예측의 implicit 마디 시작을 거짓 다운비트로 센다(`metrics/structure.py:101-106`).
- **증거** — 오라클 검사: 정답 MusicXML 자체와 정답 시간 격자를 예측으로 넣었다.
  - core 141곡 중 pickup이 있는 44곡에서 `downbeat.f1`이 43곡 1 미만(최저 happy-birthday 0.933), `onset_pos`가 20곡 1 미만(0.955), SQI가 20곡 100 미만이었다.
  - identity, IOI, duration, key, tempo, hand, spelling은 전부 만점이다. 편향은 pickup 관례에만 있다.
  - 미래 SUT가 올바른 implicit pickup을 쓰면 core `downbeat.f1`은 **−0.0103**(허용치 −0.005 → REGRESSION), `onset_pos`는 −0.0033(경고)이 된다.
- **재현**: `adversarial.py --only oracle`
- **관련 파일**: `pppbench/metrics/notation.py:73-83`, `pppbench/metrics/structure.py:101-108`
- **현재 영향**: 지금은 SUT와 평가기의 관례가 같아서 수치 영향이 없다.
- **미래 Goal 영향**: G4의 "못갖춘마디를 올바르게 쓰기"가 gate에서 회귀로 막힌다. G1 ScoreGraph의 pickup 표현에도 제약이 된다.
- **권장 수정**:
  - 예측 첫 마디가 implicit이면 오른쪽 정렬하지 않는다.
  - downbeat에서 예측 implicit 마디의 시작을 뺀다.
  - "정답을 예측으로 넣으면 만점"인 오라클 검사를 unit test로 고정한다.

#### M6. conformance 224/224는 채점에 쓰는 reader 계층의 parity를 보장하지 않는다

- **문제**:
  - `tiers.compare_projection`(`tiers.py:77-98`)이 비교하는 것은 마디(수·시작·길이·박자·fifths), **적힌** 음(마디·위치·길이·소리 음높이·손), 반올림 템포, staff 수다.
  - 모든 매칭과 채점의 단위인 `sounding`(붙임줄 병합), 철자(step/alter), mode, tuplet, voice는 비교하지 않는다.
  - reader의 붙임줄 규칙(R14)에는 인접하지 않은 tie-stop도 "같은 midi의 열린 chain"에 붙이는 fallback이 있다(`musicxml.py:427-432`). 앱은 `abs+dur` 위치에 정확히 인접한 경우만 잇는다(`App:2616-2630`). 두 규칙이 다르다.
- **증거**:
  - reader를 일부러 망가뜨린 4가지 변형이 **모두 224/224**였다: 붙임줄 미병합, 샵을 플랫으로 재표기, 모든 조를 minor로, tuplet 제거.
  - 앱과 reader가 같은 해석을 공유하는 곳(octave-shift, M9)은 원리상 잡을 수 없다. parity는 musical correctness가 아니다.
- **재현**: `PPP_BENCH_NODE_MODULES=D:/PPP/node_modules python tests/bench/review/adversarial.py --only lock --conformance http://127.0.0.1:8777` (앱 서버, puppeteer, 네트워크 필요)
- **관련 파일**: `pppbench/tiers.py:77-98`, `node/conformance.js:39-47`, `pppbench/musicxml.py:420-447`
- **현재 영향**: A14의 "reader = 앱"은 비교한 필드에 한해서만 참이다. 채점 핵심 계층의 parity는 검증되지 않았다.
- **미래 Goal 영향**: G2 Import와 G4에서 붙임줄·철자·셋잇단을 다룰 때 reader 편차가 측정 오류로 섞여도 드러나지 않는다.
- **권장 수정**:
  - `conformance.js`가 다음을 내보내게 한다:
    - 앱의 붙임줄 재생 결과(`ties(score)`의 struck·hold)
    - 철자 `p`
    - `key.mode`
    - `tm`
    - voice
  - `compare_projection`이 sounding multiset, 철자, mode, tuplet까지 비교하게 한다.
  - R14 fallback을 앱 규칙에 맞추거나 차이를 문서화한다.
  - 문서에서 parity와 musical correctness를 구분해서 적는다.

#### M7. golden diff 보고기가 마디 수가 바뀌는 변경에서 크래시하고, "이전" metric을 새 stats로 계산한다

- **문제**: `golden.py:171`은 `_metrics(case, expected, row["stats"])`로 **이전** XML을 **현재 실행의** stats와 함께 평가한다. expected에는 barStarts와 beats가 저장되지 않는다(`STATS_KEYS`). 그래서 마디 수가 바뀌면 before 쪽이 `STATS_SHAPE` 오류 dict가 되고, `before[k] != after[k]`에서 `KeyError`가 난다.
- **증거**:
  - `ADV-EXTRA-BAR`와 `ADV-GLOBAL-TEMPO`에서 `run.py golden --audio-score <mutant>`를 돌리면 첫 케이스 diff 뒤에 traceback `KeyError: 'error'`이 나고, 나머지 13케이스는 보고되지 않는다(exit 1).
  - 마디 수가 같아도 시간 격자가 바뀌면 before metric이 조용히 틀린 값이 된다.
- **재현**: `adversarial.py --only mutations` 후 `python tests/bench/run.py golden --audio-score tests/bench/out/review/mutants/ADV-EXTRA-BAR.js`
- **관련 파일**: `pppbench/golden.py:19-20, 102-112, 171-175`
- **현재 영향**: exit 코드가 1이라 CI는 실패하지만 진단이 끊긴다. 리뷰 실험에서 metric gate가 놓친 6개 중 5개는 golden만 잡았고, 그중 ADV-EXTRA-BAR는 크래시로만 드러났다. gate가 잡은 ADV-GLOBAL-TEMPO에서도 golden은 크래시했다.
- **미래 Goal 영향**: 첫 품질 개선인 I2(6/8 편향) 수정은 마디 수를 바꾼다. 리뷰 도구가 바로 그 순간 크래시한다.
- **권장 수정**:
  - expected에 전체 stats(최소 `barStarts`, `beats`)를 저장하고 before는 그것으로 평가한다.
  - `_metrics` 오류를 정상 출력으로 처리한다.
  - 크래시를 재현하는 unit test를 둔다.

#### M8. 알려진 카탈로그 결함이 벤치마크 출력 어디에도 측정되지 않고, 규모도 과소 기록되었다

- **문제**: 찬송가 조표 무시(I10)는 문서에만 있다. L12는 `skip_metrics`만 있으면 **통과**하는 규칙이라, 결함을 승인하고 침묵시킨다. 구현자가 발견하지 못한 결함도 있다.
- **증거**:
  - **조표 무시**: 카탈로그 전체로는 **100곡 중 89곡**이다(등록된 88곡 중 78곡 + L8로 제외된 12곡 중 11곡). §16.5와 CURRENT_STATE는 "78 of 88"로 적어 사용자 영향을 과소 기록했다.
  - **붙임줄**: 찬송가 10곡에 `<tie type="start"/>`가 101개, `stop`은 0개다. `catalog/hymns/abc-to-musicxml.js:337`이 start만 쓴다. 앱은 start와 stop이 인접한 쌍만 이어서 재생하므로(`App:2616-2630`) 붙임줄 101개가 재타건된다. 기록되지 않았다.
  - **마디 내 임시표 지속**: 21개 음이 같은 마디 앞쪽의 임시표를 잃고 natural로 기록되었다(ABC 규칙 위반). 기록되지 않았다.
  - **마디 무결성**: L8로 제외된 23곡(찬송가 12, 교재 11)은 `Import.validate`와 같은 규칙으로 overfull·underfull·빈 마디가 있는 카탈로그 파일이다. 사용자에게 배포되는 결함인데 제외 사유로만 적혀 있다.
  - **skip의 크기**: core 523케이스 중 141(27%)에 key·spelling metric이 없다.
    - skip된 찬송가를 "조표 오답"으로 채점하면 core SQI는 81.74→78.30, "정답"으로 채점하면 소폭 오른다.
    - 진실값 자체가 모호하다(흰건반만 남은 선율). toMusicXml이 쓴 fifths는 −1: 37, 0: 41, +1: 63이다.
    - 그래서 skip은 toMusicXml 측정으로서는 방어할 수 있다. 문제는 결함이 수치로 남지 않는다는 점이다.
- **재현**: `adversarial.py --only data`
- **관련 파일**: `catalog/hymns/abc-to-musicxml.js:100-120, 320-345`, `pppbench/corpus.py:147-166, 214-216`, `tests/bench/corpus/excluded.json`, `docs/CURRENT_STATE.md`(10번)
- **현재 영향**: `npm run bench`와 summary.md에 이 결함들이 전혀 보이지 않는다. 사용자는 89곡을 틀린 음으로, 10곡을 끊긴 붙임줄로 연습하고 있다.
- **미래 Goal 영향**: 찬송가를 고치면 88곡의 sha가 바뀐다. L2와 INPUT_DRIFT로 core의 30%가 한꺼번에 재기준화되어, 데이터 수정과 SUT 성능 변화가 한 커밋에 섞인다. 결함이 줄어드는 것을 추적할 지표도 없다.
- **권장 수정**:
  1. "known broken, measured separately" 방식의 `catalog-integrity` suite(또는 lint 보고서 + baseline)를 만든다.
     - 파일별 결함 수를 센다: 조표 무시, tie start/stop 불균형, 마디 내 임시표 지속 누락, bar integrity, octave-shift 해석 차이, 자체 템포 표기 불일치.
     - baseline보다 늘면 FAIL로 하고, summary.md에 한 줄로 항상 표시한다.
  2. I10 수치를 89/100으로 정정하고, 붙임줄·임시표 결함을 §14와 CURRENT_STATE에 추가한다.
  3. (O4) 벤치마크 쪽에서 조표와 tie stop을 적용한 파생 참조를 만든다.

#### M9. octave-shift 29곡 제외가 가능성 높은 프로덕션 버그를 가리고, 가장 어려운 곡을 빼서 headline을 올린다

- **문제**: D10에 따라 "해석 미확정"으로 제외했다. 그러나 저장소 데이터만으로 해석을 상당히 판정할 수 있고, 제외 대상이 특정 난이도 층에 몰려 있다.
- **증거**:
  - **해석**: octave-shift 77개가 모두 `type="down" size="8"`(MuseScore의 8va)이다. 8va 경계 146곳을 비교했다.

    | 읽는 방식 | 경계에서의 선율 간격 중앙값 | ≥10반음 비율 |
    | --- | --- | --- |
    | `<pitch>`를 소리 음으로 (MusicXML 표준) | 3반음 | 20% |
    | 앱처럼 −12 적용 | 10반음 | 66% |

    즉 `<pitch>`는 소리 음이고, **앱은 이 구간을 한 옥타브 낮게 재생할 가능성이 높다**(I3).
  - **conformance**: 이 29곡도 224개 대상에 들어가 "일치"로 통과한다. reader가 앱의 규칙을 복제했기 때문이다.
  - **제외 분포**: czerny849 16/28, czerny299 9/10, burgmuller25 2, sonatina 2. 결과적으로 czerny299는 1/10만 등록(core 1), czerny849는 12/28만 등록(core 8)되었다.
  - **난이도 편향**: core의 책별 SQI는 czerny849 62.2, czerny299 64.7, hanon 67.4이고, beyer는 84.6, 찬송가는 85.9다. 가장 낮은 층이 대거 빠졌다.
- **재현**: `adversarial.py --only data`(octave-shift 줄). 책별 SQI는 `out/review/core-original/results.json`의 `by_tag.book:*`.
- **관련 파일**: `tests/bench/corpus/excluded.json`, `pppbench/corpus.py:168-171`, `pppbench/musicxml.py:216-238, 360-375`
- **현재 영향**:
  - 빠르고 높은 음역의 8va 패시지가 벤치마크에 거의 없다. Czerny 299와 849의 핵심 재료이고, headline을 위쪽으로 편향시킨다.
  - 앱의 8va 재생 버그 가능성은 G0 산출물에 "미확정"으로만 남아 있다.
- **미래 Goal 영향**: G2(OMR의 8va 처리)와 G4에서 옥타브 처리 품질을 잴 수 없다.
- **권장 수정**:
  1. T0-N 정답을 표준 해석으로 읽는 옵션(`expect.ottava: "standard"`)을 두고 29곡을 복귀시킨다. 합성 연주의 진실은 실제 음악이어야 하고, toMusicXml은 ottava를 쓰지 않으므로 앱 parity가 필요 없다.
  2. 앱 해석과 표준 해석의 차이를 M8의 결함 목록에 넣는다.
  3. I3을 "데이터상 강하게 시사됨, 앱에서 한 번 들어 보거나 보고 확정"으로 갱신한다.

#### M10. "라이선스-클린" 주장이 저장소 증거와 맞지 않는다

- **문제**:
  - registry의 license 문구는 파일 증거가 아니라 책 단위 규칙으로 생성된다(`corpus.py:242-247`).
  - PDMX 파일 단위 출처(PDMX id, MuseScore URL, 개별 license)는 저장소에 없다.
- **증거** — 교재 파일 자체의 `<rights>`를 확인했다.
  - 등록 참조 6개(core 5개)에 PD/CC0 근거가 없다:
    - burgmuller25/001 `著作権情報`(자리표시자)
    - burgmuller25/002, 007 `<rights>` 없음
    - burgmuller25/004 `by Mutopia-2013/01/12-219`, burgmuller25/018 `by Mutopia-2013/01/12-230` — Mutopia는 PD 외에 CC BY·BY-SA 작품도 배포하는데, 이 둘에는 PD 문구가 없다.
    - czerny299/010 `<rights>` 없음
  - PPP가 ABC로 직접 전사한 9곡(`<rights>Public domain. Transcribed for PPP…`)이 registry에서 "PDMX community typeset"으로 잘못 표기되어 있다: burgmuller25/005·016·017·019·023, czerny849/025·026·027·030.
  - 찬송가는 곡별 출처(`sources.js`의 Open Hymnal ABC 파일명)와 곡별 PD 문구(`index.json`)가 있어 근거가 충분하다. catalog 3곡은 `index.json`의 CC0, micro는 파일의 CC0 rights가 근거다.
- **재현**: `adversarial.py --only data`(licence 줄)
- **관련 파일**: `pppbench/corpus.py:227-258`, `tests/bench/corpus/references.json`, `catalog/method/index.json`, `catalog/method/books.json`
- **현재 영향**: 이 파일들은 G0 이전부터 카탈로그로 배포되었으므로 G0이 새 위험을 만든 것은 아니다. 그러나 §3.1 원칙 6("출처·라이선스를 명시적으로 기록")은 성립하지 않는다.
- **미래 Goal 영향**: 벤치마크를 외부에 공개하거나 참조를 늘릴 때, 근거가 부족한 파일을 걸러낼 수 없다.
- **권장 수정**:
  - references.json에 파일별 `provenance`를 둔다: 출처 URL 또는 PDMX·Mutopia id, 원 라이선스, 확인 날짜.
  - 확인될 때까지 6개는 제외하거나 `license_status: unverified`로 표시하고 lint warning을 낸다.
  - 9개의 표기를 정정한다.
  - Mutopia 219와 230의 라이선스를 확인한다.

#### M11. 과적합 방어가 설계 주장만큼 작동하지 않는다: holdout과 replay가 같은 합성 연주기에서 나온다

- **문제**: R3 대응으로 holdout, replay, private suite를 제시했지만 실제 사람 연주 데이터가 하나도 없다.
  - holdout은 같은 생성기를 쓴다(seed만 11, 12).
  - replay fixture 6개는 `render.profile = human` 합성 연주를 Salamander로 렌더한 것이라 같은 벨로시티·강세 모델을 포함한다.
  - private suite에는 데이터도 baseline도 없다.
- **증거**:
  - `replay/*.json`의 `render.profile`이 모두 `human`이다.
  - 생성기의 다운비트 강세(+6 velocity)를 끄고 core를 다시 돌렸다. human/none에서 `time_sig.exact` 0.599→0.589, `onset_pos` 0.559→0.541, `downbeat.f1` 0.737→0.712로 떨어졌고, oracle 경로는 그대로였다. SUT가 생성기 특유의 단서를 쓰고 있다. 크기는 작지만 체계적이다.
- **재현**: `perform.PROFILES[p]["accent"] = False`(p = human, rubato, amt)로 바꾸고 `runner.run_suite(core, check_lock=False)`를 돌린 뒤 `by_tag.profile:*`를 비교한다.
- **관련 파일**: `pppbench/perform.py:16-21, 166-170`, `tests/bench/replay/*.json`, `tools/record_replay.py`
- **현재 영향**: holdout Δ는 "다른 곡에 대한 일반화"만 보여 준다. "실제 연주에 대한 일반화"는 보여 주지 못한다.
- **미래 Goal 영향**: G1–G3에서 onset 경로의 박자·위상 휴리스틱을 조정하면, 합성 강세·지터 모델에 과적합될 위험이 있다.
- **권장 수정**:
  1. "holdout은 생성기 과적합을 막지 못한다"고 문서에 명시한다.
  2. generator-robustness suite를 만든다: 강세를 끄고, 벨로시티·지터·릴리스 분포를 바꾼다.
  3. G1 착수 전에 사용자의 private real-recording suite baseline을 확보한다.
  4. replay를 라이선스가 확인된 실제 연주로 보강한다.

### 17.5 MINOR

| # | 문제 | 증거 | 권장 수정 |
| --- | --- | --- | --- |
| m1 | input lock이 연주를 바꾸지 않는 정답 수정(조표·mode·철자)을 못 잡는다. README의 "catches a change to … a reference"는 부정확하다 | lock의 `reference_sha256`은 파일이 아니라 references.json 값을 복사한다(`runner.py:47`). prelude-fragment의 fifths를 1→0으로 바꾸면 `run`은 exit 0이고, `check`가 SUT 회귀로 보고한다(3케이스 −10 SQI, key FAIL). replay fixture를 고쳐도 drift 없이 회귀로 보고된다. suite의 references 순서만 바꿔도 INPUT_DRIFT가 난다(거짓 양성). CI에서는 lint L2가 잡는다 | `generate()`에서 파일의 `content_sha256`을 계산해 대조한다. replay fixture sha도 lock한다. `suite_sha256`은 references를 정렬해서 계산한다 |
| m2 | `check`가 결과가 현재 SUT에서 나왔는지 확인하지 않는다 | `compare.cli_check`는 `run.json`의 `audio_score_sha256`을 현재 파일과 비교하지 않는다(`update-baseline`만 한다) | 불일치하면 `STALE_RESULTS` ERROR |
| m3 | smoke가 rubato·amt·noisy beats를 포함하지 않고 허용치도 느슨하다 | ADV-GLOBAL-TEMPO와 ADV-MINOR-LEADING-TONE이 모두 smoke PASS(후자는 `micro/M11-harmonic-minor`가 smoke에 있는데도) | smoke에 amt/oracle-noisy·rubato 행 추가, micro 가드(M3) |
| m4 | `struct.time_sig.score`의 regrouped가 3/4↔4/4와 2/4↔3/4에도 0.5를 준다 | `structure.py:18-28`. core에서 3/4→4/4 17건이 0.5를 받는다 | 정수배 regroup(2↔4, 3/8↔6/8, 6/8↔12/8)만 인정, `SQI_VERSION` 상향 |
| m5 | 정답 자체의 검사가 빠져 있다 | 참조 4곡이 자기 `<sound tempo>`와 메트로놈 표기가 다르다(burgmuller25/001 100 vs 152, hanon/001 108 vs 60, czerny299/010 50 vs 60, burgmuller25/018 138 vs 132). 꾸밈음 13곡(core 12)은 연주·채점에서 완전히 빠진다. 반복·엔딩 142곡(core 61)은 전개되지 않는다(합성에서는 일관되지만 private 실제 녹음과는 어긋난다). 장식음·페르마타는 문자 그대로 연주된다 | lint L13(템포 표기 불일치) 추가, 꾸밈음 연주 프로파일 추가, private suite 문서에 "참조는 반복 전개본" 명시 |
| m6 | 숨은 의존성: git checkout이 필요하다 | lint L1이 `git ls-files`를 쓴다(`util.tracked_files`). 소스 zip에서는 lint가 크래시한다. README의 Requirements는 Python과 Node뿐이다 | README에 git 명시, git이 없으면 L1을 SKIPPED로 |
| m7 | Linux 결정론 검증 절차가 저장소에 없다 | 문서에는 "Docker로 확인"이라는 서술만 있다. 리뷰어가 재현했다: `node:24-bookworm`, `--network none`, LF clone에서 core `69a83d55…`, smoke `ebf9ca25…`, replay `5aac870a…` 동일 | `tests/bench/tools/`에 Linux 검증 스크립트나 README 절 커밋 |
| m8 | A10 legacy 동등성 증거가 자명하다 | `tests/golden/manifest.example.json`은 prelude-fragment를 자기 자신과 비교한다(F1 1.0) | pickup·tie·grace가 있는 서로 다른 두 파일로 동등성 테스트 |
| m9 | `run.py list`가 full을 "no baseline"으로 표시한다 | `run.py:51`이 `baselines/full.json`을 찾는다. 실제 파일은 `full.aggregates.json` | `compare.baseline_path_for` 사용 |
| m10 | holdout은 gate하지 않고, "숨김"은 관례뿐이다 | nightly `check --suite full`은 `by_tag.holdout`을 gate하지 않는다. `out/full/results.json`에 holdout 케이스 행이 그대로 있다 | holdout 집계에 느슨한 tag guard, 케이스 행은 별도 파일로 |
| m11 | `PredTime`이 `stats.beats`가 마디를 균등 분할한다고 가정한다 | `timemap.py:47-63`. 박 격자가 마디와 어긋나면(8분 pickup의 6/8, 5/8·7/8의 불균등 박) 매핑이 틀린다. 리뷰어의 첫 오라클 시도에서 midnight-clear identity 0.953으로 재현했다 | 박의 q 위치를 stats로 받거나 XML 박 구조로 보간 |
| m12 | mutation-check가 deadpan/none과 치명적 크기의 회귀만 쓴다 | mutation suite = core refs × deadpan/none. 5개 모두 해당 metric이 크게 움직인다(duration 0.84→0.18 등) | 허용치 경계 근처의 현실적 mutation(M3의 예)과 oracle/amt 경로 mutation 추가 |
| m13 | golden 선택이 편향되었고 byte 비교만 있다 | 14개 중 12개가 micro·grid다(나머지는 Gymnopédie와 찬송가 1곡). 교재 곡, amt·rubato·noisy·lowconf 프로파일, pedal 입력, 가장 많이 틀리는 박자인 2/4(2/4→6/8 76건)가 모두 0이다. XML byte 비교라 serialization만 바뀌어도 14개를 모두 bless해야 한다 | semantic golden(canonical 비교: 마디·음·철자·tie·tuplet·pedal·tempo)과 소수의 byte golden을 분리, 교재·2/4·amt·pedal 케이스 추가 |

### 17.6 OPTIONAL

- **O1.** `CLAUDE.md`가 없다(리뷰 요청의 확인 대상). CURRENT_STATE가 역할을 대신하지만, 읽는 순서·병렬 세션·cp949·bench 루프를 가리키는 짧은 `CLAUDE.md`가 있으면 좋다.
- **O2.** 확장 구조: suite의 `stage` 필드가 dispatch되지 않는다(runner가 항상 `notate_batch`). `evaluate_timed`는 metric 모듈을 하드코딩한다. G2(Import)와 G5·G6용으로 stage와 metric registry를 두면 좋다.
- **O3.** canonical schema에 G4–G6용 필드를 예약한다: beam, stem, clef, voice 역할, slur, articulation, dynamics, pedal, fingering.
- **O4.** 찬송가 파생 참조(조표·tie stop 적용)를 만들어, core의 30%를 흰건반 선율이 아닌 실제 음악으로 되돌린다.
- **O5.** summary의 태그 표(`TAG_PREFIXES`)에 `mode:`, `feature:`, `size:`를 추가한다.

### 17.7 요청된 16개 검토 항목별 결론

| # | 항목 | 결론 | 관련 |
| --- | --- | --- | --- |
| 1 | Benchmark validity | 음 보존·리듬·박자·조표·손 배정은 잰다. 그러나 null 처리, stats 신뢰, 미측정 출력 차원, 합성 전용 데이터 때문에 "미래 품질 향상을 판정"하기에는 구조적 공백이 있다 | B1, M1, M2, M4, M11 |
| 2 | Reference·ground truth | micro 24곡은 `make_micro.py --check`와 일치하고 기대값 테스트도 통과한다. 카탈로그 참조에는 조표·붙임줄·임시표·템포 표기 결함과 license 근거 공백이 있다 | M8, M9, M10, m5 |
| 3 | Excluded cases | 찬송가 skip은 toMusicXml 측정으로는 방어 가능하지만 결함이 수치로 남지 않는다. octave-shift 제외는 버그를 가리고 난이도를 낮춘다 | M8, M9 |
| 4 | SQI 81.7 | 과대평가다. release gate(케이스 통과율)와 diagnostic SQI를 분리해야 한다 | M2, B1, m4 |
| 5 | 고의 회귀 | 구현자의 5종은 독립적이고, 지정 metric이 직접 크게 움직인다(duration이 4/5에서 함께 실패하는 것은 SUT의 실제 결합이다). 신규 7종 중 gate는 1종만 잡았다 | B1, M1, M3, M4, M7, m12 |
| 6 | Golden | 크래시 버그, 선택 편향, byte-only 설계 | M7, m13 |
| 7 | Input lock | 생성 입력 변경은 잡는다. 정답 파일 편집 일부와 replay는 못 잡는다. 순서 변경에는 거짓 양성을 낸다 | m1 |
| 8 | Determinism | cwd, 경로 표기, hash seed, 역순 열거, CRLF/LF, Linux Docker offline, Python 3.11/3.13, Node 24.17/24.21에서 모두 byte-identical. 절차는 커밋되지 않았다 | m7 |
| 9 | Legacy reader | 기존 reader의 결함을 코드로 확인했다: pickup을 전체 마디로 패딩, tie 미병합, grace를 길이 0 음으로 포함, tempo는 마지막 `<sound>`만, ms 표기 오류. 새 evaluator는 이를 반복하지 않는다. 대신 새 관례 편향(pickup)과 R14 fallback이 있다 | M5, M6, m8 |
| 10 | App parser parity | 224/224를 재현했다. 비교 필드가 좁아서 parity ≠ correctness | M6 |
| 11 | CI | fresh Linux·오프라인에서 gate 단계가 전부 통과하고, exit code가 전파되며, 캐시가 없다. 한계: smoke가 약하고, nightly full은 aggregate만 gate한다 | m2, m3, m10 |
| 12 | beat_track_test | sys.path 2줄만 추가했고 assertion은 그대로다. `beat_track`는 stdlib만 import한다. 문제 없음 | – |
| 13 | Dependencies | stdlib + Node 확인. 숨은 의존성은 git | m6 |
| 14 | Performance | unit 9.6 s, golden 0.26 s, smoke 0.53 s, core 12.7 s(Win)/29.6 s(Docker), full 100.4 s, mutation-check 27 s, ab 24.8 s, conformance 8.7 s, omr-live 47 s. 케이스 수에 선형이라 문제 없다 | – |
| 15 | G0 scope | 프로덕션·catalog·앱·의존성 변경 0 | – |
| 16 | Future fitness | 핵심 결합: stats 계약, pickup 관례, `PredTime`의 균등 박 가정, stage·metric 하드코딩, canonical에 engraving 필드 없음 | M1, M5, M6, m11, O2, O3 |

### 17.8 Fixer 작업 순서와 완료 조건

1. **B1** — null을 0으로 처리하고, 커버리지 감소를 gate한다.
2. **M7** — golden 크래시.
3. **M1** — 박자표를 XML에서 읽는다.
4. **M3 + m3** — micro·태그·케이스 가드, smoke 행 추가.
5. **M2** — 케이스 통과율 헤드라인 + `sqi/2`, 문서 교체.
6. **M4** — `count_exact`와 accidental을 gate, pedal 커버리지.
7. **M5** — pickup 관례, 오라클 unit test.
8. **M8, M9** — `catalog-integrity` suite, octave-shift 표준 해석, I3·I10 문서 정정.
9. **M6** — conformance 범위.
10. **M10** — provenance.
11. **M11** — 문서, robustness suite, private suite 계획.
12. MINOR.

완료 조건:

- 버전 상수를 올리고(`METRICS_VERSION`, `SQI_VERSION`, 필요하면 `READER_VERSION`) relock, 재기준화, golden bless를 사유와 함께 한다.
- `python tests/bench/review/adversarial.py`를 다시 돌린다(서버가 있으면 `--conformance`). 각 GAP이 OK가 되거나, 남긴 이유를 §16에 적는다.
- §16과 CURRENT_STATE의 수치를 새 headline(케이스 통과율)으로 갱신한다.

### 17.9 결론 — G0을 main에 merge해도 되는가?

**`READY_FOR_FIXER`**

재현성, 결정론, 범위 준수, 도구 완성도는 merge 수준이다. 그러나 이 benchmark가 G1–G6의 "좋아졌나/나빠졌나"를 판정하는 기준이 되려면 B1과 MAJOR를 먼저 고쳐야 한다. B1은 사용자 가시 회귀를 개선으로 인증한다. M1과 M4는 결과가 byte-identical한 맹점이다. M2는 과대평가된 헤드라인이다. M8과 M9는 결함과 어려운 곡이 보이지 않게 되는 문제다.
