# G0 — Quality Foundation: 악보 품질 측정·회귀 기반

| 항목 | 값 |
| --- | --- |
| 상태 | **구현 → 독립 리뷰 → fixer → 최종 리뷰 → 최종 fixer → 짧은 최종 리뷰 → last fixer → Final Pass Review (2026-09-22)** · 브랜치 `g0-quality-foundation` (main 미병합) · 구현 결과 [§16](#16-구현-결과-2026-09-22) · 독립 리뷰 판정 READY_FOR_FIXER ([§17](#17-independent-review-2026-09-22)) · fixer 판정 NEEDS_ANOTHER_REVIEW ([§18](#18-fixer-기록-2026-09-22)) · 최종 독립 리뷰 판정 NEEDS_FIX ([§19](#19-final-independent-review-2026-09-22)) · 최종 fixer 판정 READY_FOR_SHORT_REVIEW ([§20](#20-final-fixer-기록-2026-09-22)) · 짧은 최종 리뷰 판정 NEEDS_FIX (MAJOR 2: 반복 기호 미측정, implicit 예외, [§21](#21-short-final-review-2026-09-22)) · last fixer 판정 READY_FOR_FINAL_REVIEW (S-M1·S-M2·S-m1·S-m2 해결, [§21.15](#2115-last-fixer-기록-2026-09-22)) · **Final Pass Review 판정 NEEDS_FIX** (S-M1·S-M2는 VERIFIED_RESOLVED이나 새 공격 2건이 새 MAJOR — PF-M1 매달린 forward repeat, PF-M2 꼬리 자르기로 마지막 마디 위장, [§22](#22-final-pass-review-2026-09-22); merge 전 로컬 main `d82bb71`은 사용자 결정) |
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
- [18. Fixer 기록 (2026-09-22)](#18-fixer-기록-2026-09-22)
- [19. Final Independent Review (2026-09-22)](#19-final-independent-review-2026-09-22)
- [20. Final Fixer 기록 (2026-09-22)](#20-final-fixer-기록-2026-09-22)
- [21. Short Final Review (2026-09-22)](#21-short-final-review-2026-09-22)
- [22. Final Pass Review (2026-09-22)](#22-final-pass-review-2026-09-22)

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

#### B1. null을 "해당 없음"으로 처리해서, 출력에서 정보를 지우는 회귀가 "개선"으로 판정된다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) B1)

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

#### M1. 박자표와 시간 격자를 악보(XML)가 아니라 SUT의 자기 보고(`stats`)에서 읽는다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M1)

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

#### M2. SQI 81.7은 사용자 체감 품질을 크게 과대평가한다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M2)

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

#### M3. gate가 음악 범주 하나에 국한된 체계적 오류를 통과시킨다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M3)

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

#### M4. 사용자에게 보이는 출력 차원 다수가 어떤 층에서도 측정되지 않는다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M4)

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

#### M5. pickup 관례가 현재 toMusicXml 출력에 묶여, 올바른 조판을 벌점 처리한다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M5)

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

#### M6. conformance 224/224는 채점에 쓰는 reader 계층의 parity를 보장하지 않는다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M6)

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

#### M7. golden diff 보고기가 마디 수가 바뀌는 변경에서 크래시하고, "이전" metric을 새 stats로 계산한다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M7)

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

#### M8. 알려진 카탈로그 결함이 벤치마크 출력 어디에도 측정되지 않고, 규모도 과소 기록되었다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M8)

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

#### M9. octave-shift 29곡 제외가 가능성 높은 프로덕션 버그를 가리고, 가장 어려운 곡을 빼서 headline을 올린다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M9)

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

#### M10. "라이선스-클린" 주장이 저장소 증거와 맞지 않는다 — **RESOLVED** ([§18.2](#182-blocker와-major-처리) M10)

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

#### M11. 과적합 방어가 설계 주장만큼 작동하지 않는다: holdout과 replay가 같은 합성 연주기에서 나온다 — **BLOCKED** ([§18.2](#182-blocker와-major-처리) M11)

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

### 17.10 Fixer 처리 상태 (2026-09-22)

fixer가 리뷰 커밋 `b1d817b`에서 리뷰어의 스크립트를 다시 돌려 지적을 먼저 재현했다(**1 OK, 13 GAP**, §17.1과 같은 수치). 그 뒤 처리했다. 근거와 수치는 §18에 있다.

| # | 상태 | 근거 |
| --- | --- | --- |
| B1 | RESOLVED | ADV-NO-TEMPO: core·smoke REGRESSION (core 진단점수 −5.71; mutation suite에서 `critical.playback_tempo` 0.503→0) |
| M1 | RESOLVED | ADV-XML-METRE: REGRESSION (`struct.time_sig.exact`, `critical.meter`, `struct.stats_consistent`). MusicXML은 그대로 두고 마디 시각만 늦춘 FIX-STATS-LATE-BARS도 REGRESSION |
| M2 | RESOLVED | 헤드라인을 usable-score rate(critical gate 9개)로 바꿨다: core 25.9 %. `sqi/2`는 진단 지표다. adversarial `sqi` OK |
| M3 | RESOLVED | micro·subgroup·critical flip 가드 추가. ADV-MINOR-LEADING-TONE: core·smoke REGRESSION |
| M4 | RESOLVED | 마디 수, 빈 마디, 필요한 임시표, 페달 metric과 gate 추가. ADV-NO-PEDAL, ADV-NO-ACCIDENTAL, ADV-EXTRA-BAR, FIX-NO-NATURALS 모두 REGRESSION. replay 페달은 연주 기준으로 채점(`metrics/3`) |
| M5 | RESOLVED | 이상적 예측이 core 141곡(pickup 44곡) 모든 metric에서 만점 |
| M6 | RESOLVED | 독립 correctness fixture 13/13, parser parity 258/258, 망가진 reader 3종 검출 |
| M7 | RESOLVED | golden이 크래시하지 않는다. semantic·byte·timing 스냅숏 분리 |
| M8 | RESOLVED | known-failure 감사가 매 실행 `results.json`과 `summary.md`에 정확한 수치를 기록한다. 찬송가 89/100. 마디 내 임시표는 21→18로 정정(§18.2) |
| M9 | RESOLVED | 정답은 MusicXML 표준으로 읽는다. 19곡 복귀. 앱 해석은 KNOWN_FAILURE(30파일·2,229음). fixture C10/C11 |
| M10 | RESOLVED | `corpus/provenance.json`에 저장소 증거만 기록. 15곡 격리(P1) |
| M11 | **BLOCKED** | 라이선스가 확인된 실제 사람 연주가 저장소에 없다. 완화책: robust suite(CI gate), `input:recorded` 경로 준비 |
| m1 | RESOLVED | 파일 content sha로 lock한다. suite sha는 순서와 무관하다. replay 입력도 lock한다. adversarial `lock` OK |
| m2 | RESOLVED | `check`가 `STALE_RESULTS`를 낸다 |
| m3 | RESOLVED | smoke 44케이스(amt·rubato·pedal 행). ADV·FIX 12종 모두 smoke REGRESSION |
| m4 | RESOLVED | ×2 regroup만 부분점수를 받는다(3/4↔4/4 = 0) |
| m5 | RESOLVED / 꾸밈음 연주 프로파일은 REJECTED | L13과 known failure 4파일. 꾸밈음은 KNOWN_LIMITATION(17파일·244음). private suite의 반복 전개를 문서화. 프로파일을 거절한 사유는 §18.3 |
| m6 | RESOLVED / "git 없으면 SKIPPED"는 REJECTED | git이 없으면 `ERROR NEEDS_GIT`(exit 2)를 낸다. 사유는 §18.3 |
| m7 | RESOLVED | Linux 결정론 절차를 README에 넣었다. 5개 suite sha가 OS 간 동일 |
| m8 | RESOLVED | 서로 다른 파일 4쌍(pickup, tie, 찬송가, 꾸밈음)에서 legacy와 `golden_benchmark.py`가 같은 값을 낸다(F1 0.983/0.25/0.168/0.824) |
| m9 | RESOLVED | `list`가 `baseline_path_for`를 쓴다 |
| m10 | RESOLVED / 케이스 행 분리는 REJECTED | full이 hold-out 집계를 가드한다. 사유는 §18.3 |
| m11 | **BLOCKED** | `PredTime`의 균등 박 가정을 고치려면 SUT가 박의 q 위치를 내보내야 한다. 이는 프로덕션 변경이다(§18.3) |
| m12 | RESOLVED | harmful mutation 17종(허용치 근처 SQI −0.01 포함, pedal 경로). 모두 검출 |
| m13 | RESOLVED | golden 17개(교재 2/4, amt, rubato, pedal). semantic과 byte 분리 |
| O1 | REJECTED | 저장소 전체 세션 지침(`CLAUDE.md`)은 사용자가 정한다. CURRENT_STATE가 그 역할을 한다 |
| O2 | REJECTED (G0) | 두 번째 stage가 생기는 G2에서 설계한다 |
| O3 | RESOLVED (pedal) / 나머지 REJECTED (G0) | canonical에 pedal을 추가했다. beam·clef·voice 등은 G4–G6에서 metric과 함께 넣는다 |
| O4 | REJECTED (G0) | 파생 참조는 core 약 30 %의 정답을 바꾼다. 카탈로그 수정과 함께 하고, 그 전까지 결함은 known failure로 센다 |
| O5 | RESOLVED | summary 태그 표에 `mode:`, `feature:`, `size:`, `input:` 추가 |

## 18. Fixer 기록 (2026-09-22)

§17의 BLOCKER와 MAJOR를 처리한 fixer 세션의 기록이다.
- **대상**: `D:/PPP-g0`, 브랜치 `g0-quality-foundation` @ `b1d817b` + 미커밋 변경.
- **바꾸지 않은 것**:
  - 프로덕션 파일(`audio-score.js`, `Piano Coach App.dc.html`, `server.js`, `omr-service.js`, `catalog/`)은 바꾸지 않았다. `git diff 663d463`에서 `tests/` 밖의 JS·HTML·Python 변경은 0이다.
  - `D:/PPP`는 수정하지 않았다. `node_modules`와 transcribe venv를 읽기만 했다.
  - 커밋, merge, push를 하지 않았다. G1은 시작하지 않았다.

### 18.0 판정

**`NEEDS_ANOTHER_REVIEW`**

1. **M11이 BLOCKED다.** 실제 사람 연주가 없다. "합성 연주기에 과적합" 위험은 robust suite로 줄였지만 측정하지는 못했다.
2. **변경이 크다.**
   - 버전: reader/2, metrics/3, sqi/2, perform/2, gate/2
   - 새 모듈: critical, pedal, semantic, correctness, known_defects, provenance
   - 새 suite: robust
   - adversarial의 판정 기준 일부(`sqi`, `data`, `oracle` 구성)는 fixer가 썼다. 따라서 fixer가 아닌 리뷰어가 그 기준이 리뷰 의도보다 약하지 않은지 확인해야 한다.
3. **fixer 자신의 결함을 6건 찾아 고쳤다**(§18.4). 최종 점검에서 찾은 것이다. 같은 종류가 더 남았는지 독립 리뷰가 봐야 한다.

재현성, 결정론(Windows·Linux 5개 suite byte 동일), 완료 검증 14항목(§18.7)은 모두 통과했다.

### 18.1 방법과 환경

| 항목 | 내용 |
| --- | --- |
| 재현 | 리뷰 커밋 `b1d817b`를 별도 clone에 풀고 리뷰어의 `adversarial.py`를 그대로 돌렸다. **1 OK, 13 GAP**으로 리뷰와 같은 수치가 나왔다: ADV-NO-TEMPO SQI +1.46 PASS, ADV-XML-METRE·ADV-NO-PEDAL `results.json` byte 동일, ADV-EXTRA-BAR에서 golden `KeyError`, 찬송가 89/100·붙임줄 101·임시표 21, 라이선스 근거 없음 6. 각 수정은 이 재현을 출발점으로 했다 |
| Windows | Windows 11(cp949), Python 3.13.5, Node 24.17.0 |
| Linux | Docker `node:24-bookworm`(Python 3.11.2, Node 24.21.0), `--network none`. worktree 스냅숏 커밋을 LF로 clone해서 CI gate 단계와 full을 실행했다. 스냅숏은 worktree 846개 파일과 CRLF=LF 기준으로 동일함을 확인했다 |
| T1 | g0 worktree 서버를 8799에 띄웠다(`PPP_BENCH_NODE_MODULES=D:/PPP/node_modules`). omr-live는 로컬 helper(8788, Audiveris)를 썼다 |
| `npm test` | 8777은 다른 세션의 서버가 쓰고 있었다. 그래서 worktree 서버(8799)를 쓰고, node `-r` preload가 테스트 소스를 불러올 때 `127.0.0.1:8777`을 `8799`로 바꾸게 했다(파일은 바꾸지 않음). `transcription.test.js`는 `PPP_TRANSCRIBE_PYTHON`을 역슬래시 경로로 줘야 통과한다. 이 검사는 경로 문자열을 그대로 비교한다 |

### 18.2 BLOCKER와 MAJOR 처리

#### B1 — RESOLVED

- **수정**
  - 정답에 값이 있는데 예측에 없으면 0으로 채점한다. 대상: 템포 5종(`present`, `ok_effective`, `ok_written`, `mark_consistent`, `metrical_ok`), 표기 metric의 `_ref` 변형, 필요한 임시표.
  - metric을 적용할지는 정답(참조·입력)만으로 정한다. 예측에 따라 null이 되는 metric이 없다. `notation.tuplets.f1`은 정답에 셋잇단이 있을 때만 쓰고, 대신 `notation.tuplets.false_per_100`을 추가했다.
  - gate: 값이 있던 gated metric이 null이 되거나 `n`이 줄면 FAIL이다(aggregate, case, subgroup 모두).
  - 진단점수는 예측 쪽 null로 재정규화하지 않는다.
- **증거**
  - ADV-NO-TEMPO: core REGRESSION(진단점수 −5.71). FAIL 목록: `struct.tempo.present`·`ok_effective`·`ok_written`(값이 0으로 채점되므로 null도, coverage 실패도 아니다), `struct.stats_consistent`, `critical.playback_tempo`, `critical.structure`, `usable`, micro 가드, critical flip. mutation suite에서 `critical.playback_tempo`와 `struct.tempo.ok_effective`가 0.5029→0. smoke REGRESSION, replay exit 1.
  - unit: `MissingOutputIsNeverAnImprovement`, `test_missing_output_is_a_regression_not_na`.

#### M1 — RESOLVED

- **수정**
  - 예측 박자표는 예측 MusicXML의 `primary_time()`에서 읽는다.
  - stats는 계약 검사에만 쓴다. `struct.stats_consistent`(마디 수·박자·템포가 XML과 같은가)이고, 이는 `critical.structure`의 일부다.
  - `test_degradation`은 XML만 바꾼다.
- **리뷰 권고와 다른 점**: 불일치를 case error 대신 critical gate 실패로 처리한다. case error로 빼면 그 케이스의 다른 metric이 모두 사라져 coverage 규칙과 충돌한다. gate 실패는 그 케이스를 unusable로 만든다.
- **증거**
  - ADV-XML-METRE: core REGRESSION(진단점수 −4.83; mutation suite에서 `time_sig.exact` 0.5146→0.0175).
  - FIX-STATS-LATE-BARS(XML 그대로, 마디 시각만 한 박 늦음): core REGRESSION(−40.84). golden에서도 17개 모두 SEMANTIC CHANGE.

#### M2 — RESOLVED

- **수정**
  - release 헤드라인을 usable-score rate로 바꿨다. 적용되는 critical gate를 모두 통과한 케이스의 비율이다. gate는 9개다:
    - meter: 박자표 정답
    - playback_tempo: 앱이 재생하는 템포 ±4 %
    - beat_placement: 음의 90 % 이상이 맞는 마디·박
    - pitch_integrity: identity F1 ≥ 0.95
    - key: 조표
    - hands: 80 % 이상
    - structure
    - accidentals: 필요한 임시표 전부
    - pedal: 연주에 페달이 있으면 F1 ≥ 0.5
  - 임계와 사용자 관점의 사유는 `metrics/critical.py`와 README에 있다.
  - `sqi/2`는 진단 지표다. 가중치는 identity .20, onset_pos_ref .15, ioi .10, duration_ref .10, time_sig .10, 재생 템포 .10, key .10, hand_ref .10, spelling_ref .05이다. `_ref`는 분모가 정답 음이라 짝 없는 음은 오답이다.
  - `summary.md` 순서: 판정 → usable과 gate 표 → "진단점수는 높지만 unusable" 목록 → metric.
- **증거** — adversarial `sqi` OK:
  - 리뷰의 4대 실패 중 하나라도 있는 케이스 가운데 usable은 0이다.
  - usable 케이스 가운데 리뷰의 엄격 규칙을 어기는 것은 0이다. usable 25.9 %는 리뷰 규칙(현재 데이터에서 32.2 %)보다 엄격하다.
  - 4대 실패가 3개 이상인 187케이스의 최고 진단점수는 70.9로, 평균 76.77보다 낮다.
  - 진단점수가 평균 이상인데 unusable인 153케이스를 summary가 보여 준다.

#### M3 — RESOLVED

- **수정**(gate/2)
  - micro 가드: micro 케이스의 가드 metric이 조금이라도 떨어지면 FAIL이다.
  - subgroup: `set: book: profile: beats: metre-class: mode: feature: size:` 태그 중 두 실행 모두 15케이스 이상인 그룹. 허용치는 rate max(0.02, 1/n), 0–1 평균 max(0.01, 0.25/n), 진단점수 1.0이다.
  - critical flip: 한 gate에서 pass→fail 케이스가 core 2개, smoke 1개를 넘으면 FAIL이다.
  - smoke에 amt·rubato·pedal 행을 추가했다.
- **증거**: ADV-MINOR-LEADING-TONE은 진단점수가 −0.01뿐인데도 core REGRESSION이다(`micro:notation.spelling.accuracy`, `tag:mode:minor`, `tag:metre-class:compound-single`). smoke도 REGRESSION이다.

#### M4 — RESOLVED

- **수정**
  - `struct.measures.count_exact`와 `extra_empty_edge`(허용 0, `critical.structure`)를 gate에 넣었다.
  - `notation.accidentals.required_recall`: 표준 조판 규칙으로 페이지에 필요한 임시표가 인쇄되었는지 본다(독자가 믿는 음 모델). `critical.accidentals`와 연결된다.
  - pedal:
    - canonical에 pedal을 추가했다.
    - `pedal` 연주 프로파일: core 30, full 518케이스.
    - `notation.pedal.f1`과 `critical.pedal`을 추가했다.
    - golden G15를 추가했다.
  - **metrics/3**(최종 점검에서 추가): replay의 페달 정답은 연주다. helper의 페달은 AMT의 추측일 뿐이다. rendered fixture는 renderer가 음만 받으므로 페달이 없고, `f0e1a86`의 연주기도 `pedals: []`를 하드코딩했다. 실제 녹음은 누가 적지 않는 한 모른다(채점 안 함). `notation.pedal.false_per_min`(연주에 없는 페달 변경/분)을 gate한다.
- **증거**
  - 다음 mutation이 모두 core·smoke REGRESSION이다:
    - ADV-NO-PEDAL: `pedal.f1` 0.9777→0
    - ADV-NO-ACCIDENTAL: `required_recall` 1.0→0.3977
    - ADV-EXTRA-BAR: `extra_empty_edge` 0→0.9825
    - FIX-NO-NATURALS
  - replay: 6개 fixture의 연주에는 페달이 없다. helper가 5개에서 48번의 페달을 보고했고, `toMusicXml`이 페달 표시 78개를 썼다(27.8/분). metrics/2는 AMT 추측을 정답으로 채점해 `critical.pedal` 0.8을 냈다. 그 상태라면 가짜 페달을 지우는 SUT 개선을 REGRESSION으로 판정했을 것이다.
  - unit: `ReplayPedalIsScoredAgainstThePerformance`.
- **남은 것**: 쉼표·voice·clef에는 metric이 없다(O3, G4).

#### M5 — RESOLVED

- **수정**
  - `onset_pos`의 오른쪽 정렬은 정답 첫 마디가 implicit이고 예측은 아닐 때만 한다.
  - downbeat에서 예측 implicit 마디의 시작을 뺀다.
- **증거**
  - unit `PickupsAreNotPunished`: implicit pickup과 쉼표로 채운 전체 마디가 둘 다 만점이다.
  - adversarial oracle: 이상적 예측이 core 141곡(pickup 44곡)의 모든 metric에서 만점이다.
- **oracle 검사 구성 변경**
  - 참조 파일을 그대로 예측으로 넣으면 16곡이 만점이 아니다. 8곡은 템포가 없어 연주 템포를 알릴 수 없다(B1). 8곡은 octave-shift를 PPP가 한 옥타브 틀리게 읽는다(M9). 둘 다 실제 결함이다.
  - 그래서 검사는 이상적 출력을 만든다(같은 소리 음, octave-shift 없음, 연주 템포 명시). 모든 metric에서 만점을 요구하는 것은 그대로다.
  - 원본 파일이 바로 그 이유로 만점이 아니어야 한다는 검사 2개를 추가했다(8/8, 8/8).

#### M6 — RESOLVED

- **수정**: parity와 correctness를 분리했다.
  - `corpus/correctness/` C01–C13: MusicXML 명세에서 손으로 기대값을 쓴 fixture다. C01–C12는 이 reader와 앱 parser를 보지 않은 작성자가 썼다. C13(인접하지 않은 tie)은 그 세트가 다루지 않은 reader 결함을 위해 fixer가 명세에서 유도해 추가했고, `expected.json`에 그렇게 표시했다. 내용: 붙임줄, 철자, alter vs accidental, mode, 꾸밈음, pickup, 템포 단위, 8va/8vb, voice/backup/forward, 인접하지 않은 tie.
  - `run.py correctness`는 T0이고 CI에서 돈다.
  - T1 conformance는 앱 플레이어가 누르는 건반(`PianoScore.ties`의 struck/hold), 철자(`writtenP`), mode, tuplet까지 비교한다.
  - R14 fallback을 없앴다. 인접한 stop만 잇는다. 앱과 명세가 같은 규칙이다(C13).
  - 이름은 "parser parity"다.
- **증거**
  - correctness 13/13. 앱 읽기는 C10·C11에서 명세와 다르고, known failure로 기록한다.
  - parity 258/258.
  - 붙임줄 미병합, 샵→플랫, 전부 minor로 망가뜨린 reader가 각각 217, 112, 36/258이다(`--conformance` OK ×3). correctness도 같은 3종을 브라우저 없이 잡는다.

#### M7 — RESOLVED

- **수정**
  - golden expected에 byte(`.musicxml`), semantic(음악), stats, timing(barStarts·beats)을 따로 저장한다.
  - "이전" metric은 저장된 timing으로 계산한다.
  - 케이스마다 예외를 격리한다.
  - 라벨: `ok` / `SERIALIZATION-ONLY` / `SEMANTIC CHANGE` / `FAIL`. 케이스는 17개다.
- **최종 점검에서 찾은 공백**: timing을 저장만 하고 비교하지 않았다. 그래서 악보는 같고 마디 시각만 한 박 늦은 출력(FIX-STATS-LATE-BARS)이 17/17 identical이었다. timing 비교를 넣어 0/17 SEMANTIC CHANGE가 되었다. unit `test_bar_times_alone_are_a_semantic_change`.
- **증거**
  - ADV-EXTRA-BAR: 0/17 SEMANTIC CHANGE(크래시 없음).
  - ADV-GLOBAL-TEMPO: 13/17.
  - unit `test_structural_change_is_a_semantic_change_not_a_crash`.

#### M8 — RESOLVED

- **수정**
  - `known_defects.py`가 커밋된 catalog·samples 점수 329개를 매 실행 감사한다.
  - 결과는 `results.json`의 `known_failures`와 `summary.md`의 "Known production failures"에 들어간다.
  - 수가 늘면 gate FAIL이다.
  - L12 skip은 유지한다. 결함은 세어서 보여 준다.

  | 결함 | 파일 | 규모 |
  | --- | --- | --- |
  | 조표 무시 (`key_signature_playback`) | 92 (찬송가 89/100, czerny849 1, samples 2) | 6,119음 |
  | stop 없는 tie (`tie_without_stop`) | 16 (찬송가 10) | 121개 (찬송가 101) |
  | 마디 내 임시표 미지속 (`bar_accidental_not_carried`) | 10 (찬송가) | 18음 |
  | 앱의 octave-shift 해석 (`octave_shift_playback`) | 30 | 2,229음 |
  | 마디 무결성 (`bar_integrity`) | 24 | 88마디 |
  | 자체 템포 표기 불일치 (`tempo_marks_disagree`) | 4 | – |
  | 꾸밈음 누락 (`grace_notes_dropped`, KNOWN_LIMITATION) | 17 | 244음 |
  | 인쇄 임시표 오류 (`wrong_printed_accidental`) | 0 | – |

- **리뷰 수치 정정**: 마디 내 임시표 21 → **18**.
  - 리뷰는 문서 순서로 셌다. 그래서 voice 2 음이 나중에 인쇄된 voice 1 임시표보다 먼저 울리는데도 셌다. i-am-jesus-little-lamb 6·8마디, mighty-fortress 1·3마디의 4음이다.
  - 반대로 what-child-is-this 13마디의 1음은 놓쳤다.
  - 페이지를 읽는 순서(시간 순, 보표별)로 세면 18이다.
  - adversarial 검사를 이 방식의 독립 raw-XML 카운터로 바꿨다. 파일 수와 음 수 모두 정확 일치를 요구한다. 전에는 0이 아니기만 하면 통과했다.
- catalog는 고치지 않았다(범위 밖).

#### M9 — RESOLVED

- **수정**
  - 정답은 MusicXML 표준으로 읽는다(`REFERENCE_OTTAVA = "standard"`). 예측과 parity는 앱 방식으로 읽는다.
  - L5 제외를 폐지해 29곡 중 19곡이 참조로 돌아왔다. 나머지 10곡은 P1 9곡(czerny299), L8 1곡이다.
  - `feature:ottava` 태그: core 34케이스, full 272케이스. subgroup 가드 대상이다.
  - 앱 해석은 KNOWN_FAILURE `octave_shift_playback`(30파일·2,229음)이다.
  - correctness C10(8va)/C11(8vb)에 앱 읽기가 명세와 다르다고 기록했다.
  - summary의 "What the benchmark leaves out"에 czerny299 격리를 표시한다.
- **증거**
  - 독립 검사: 8va 경계 146곳의 선율 간격 중앙값이 표준 읽기 3반음, 앱 읽기 10반음이다.
  - oracle: octave-shift core 참조 8/8이 앱 읽기에서 음 identity를 잃는다.
  - `feature:ottava`의 usable은 14.7 %(core 전체 25.9 %)다. 가장 어려운 층이 다시 측정된다.
- 앱 parser는 고치지 않았다.

#### M10 — RESOLVED

- **수정**
  - `corpus/provenance.json`을 `tools/make_provenance.py`가 만들고, CI가 `--check`로 확인한다. 커밋된 점수마다 저장소 안의 증거만 기록한다: 파일 `<rights>`, catalog `index.json`·`books.json`, 찬송가 `sources`. 추측으로 채운 곳은 없다.
  - lint L14: provenance가 없거나 증거가 없으면 error이고, `excluded.json`의 P1로 격리한다.
  - 라이선스 문구는 provenance에서 생성한다. PPP 전사 9곡의 표기를 정정했다.
- **격리 15곡**: burgmuller25 001·002·004·007·018, czerny299 001–010. Mutopia 219·230은 저장소 안에 PD 근거가 없어 격리했다(오프라인 확인 불가, 추측하지 않음).
- **증거**: adversarial `licence` OK. 증거 없는 등록 참조 0, PDMX로 잘못 표기된 PPP 전사 0이다.

#### M11 — BLOCKED

- **막힌 이유**: 라이선스가 확인된 실제 사람 연주 녹음이 저장소에 없다. 만들려면 연주자가 필요하다. 가짜 데이터로 대신하지 않았다.
- **완화**
  1. `robust` suite(CI gate): 두 번째 생성기 계열 `human-alt`다. 다운비트 강세, 멜로디·베이스 강조, 롤이 없고, 지터는 삼각분포다. core 참조 × onset/oracle = 282케이스이고 usable은 28.4 %다.
  2. replay 케이스에 `input:rendered`와 `input:recorded` 태그를 붙인다. 녹음 tier는 `record_replay.py --recording --reference --bar-starts --performer --license`로 바로 채울 수 있다. WAV는 커밋하지 않고 sha만 남긴다.
  3. README와 summary에 "hold-out은 생성기 과적합을 막지 못한다"고 적었다.
- **해제 조건**: 사용자나 동의한 연주자가 등록 참조를 1곡 이상 녹음하고, 마디 시작 시각을 귀로 확인해 fixture로 추가한다. 그 뒤 `update-baseline --suite replay-public`을 실행한다. G1에서 onset 경로 휴리스틱을 조정하기 전에 하는 것이 좋다.

### 18.3 거절하거나 막힌 MINOR·OPTIONAL의 사유

- **m5 꾸밈음 연주 프로파일 (REJECTED, G0)**: 정답 reader와 앱이 모두 꾸밈음을 버린다(KNOWN_LIMITATION). 그래서 연주에 꾸밈음을 넣으면, SUT가 그 음을 옳게 받아 적어도 "없는 음"으로 채점된다. 꾸밈음 채점 규칙을 정하는 Goal(G4)에서 함께 넣는다.
- **m6 "git이 없으면 L1 SKIPPED" (REJECTED)**: L1은 "커밋된 파일만 정답"을 지키는 규칙이다. git이 없을 때 조용히 건너뛰면 그 보장이 사라진다. 대신 `run`, `lint-corpus`, `known-defects`가 `ERROR NEEDS_GIT`(exit 2)로 멈추고 이유를 말한다(unit `test_without_git_is_an_explicit_error`, README).
- **m10 hold-out 케이스 행 분리 (REJECTED)**:
  - `check`의 케이스 규칙(오류, critical flip, −10점)은 hold-out 케이스에도 적용되어야 한다. 행을 빼면 hold-out 케이스 단위 회귀가 보이지 않는다.
  - `summary.md`는 `--reveal-holdout` 없이는 hold-out 케이스 id를 보이지 않는다. `check` 메시지도 "(hold-out case)"로 가린다.
  - 집계 가드는 추가했다: `full` gate의 `holdout` subgroup, 832케이스, usable 2점.
- **m11 `PredTime`의 균등 박 가정 (BLOCKED)**:
  - 고치려면 SUT가 박의 q 위치를 stats로 내보내야 한다. 이는 `audio-score.js` 변경이라 G0 범위 밖이다.
  - 현재 SUT는 마디 안에서 박을 균등하게 쓴다. oracle 검사가 141곡에서 만점이라 지금 수치에는 영향이 없다.
  - SUT가 불균등 박(5/8, 7/8, 8분 pickup의 6/8)을 쓰기 시작하는 Goal에서 stats 계약과 함께 고친다.
- **O1–O4**: §17.10 표의 사유.

### 18.4 최종 점검에서 찾은 fixer 자신의 결함 (모두 수정, unit test 포함)

1. **golden이 마디 시각 변화를 보지 못했다**(M7 항목). timing 비교를 추가했다.
2. **suite 파일의 gate가 코드와 달랐다.** 실제로 적용되는 gate는 `suites/*.json`에 있다. 그런데 `notation.tuplets.false_per_100`이 코드의 gate에만 있고 suite 파일에는 없었다. `select-core`로 재생성했다. unit `SuiteGatesMatchTheCode`가 7개 suite의 gate를 코드와 대조한다.
3. **replay-public과 omr-live가 gate/1 형식이었다.** usable과 critical gate 집계를 비교하지 않았고, flip 한도는 기본값 2로 6케이스의 1/3이었다. fixture gate로 바꿨다: gate/2, flip 0, smoke 허용치. omr-live는 `notes.symbolic.f1`과 `omr.measure_alignment_rate`를 유지한다. replay-public의 설명("empty until recorded")도 사실대로 고쳤다.
4. **replay 페달을 AMT 추측으로 채점했다**(M4 항목). metrics/3.
5. **adversarial의 찬송가 임시표 검사가 "0이 아님"만 확인했다.** README가 말한 "같은 수치"보다 약했다. 정확 일치로 바꿨다(M8 항목).
6. **oracle 검사가 GAP이었다**(M5 항목). 원인은 B1·M9의 올바른 수정이 드러낸 실제 결함이었다. 검사를 약화하지 않고 이상적 출력을 만들도록 고쳤고, 원본 파일을 잡는 검사 2개를 추가했다.

### 18.5 수치 (baseline, metrics/3, audio-score.js `559a1f40…`)

| suite | 케이스 | usable | 진단점수(sqi/2) | 비고 |
| --- | --- | --- | --- | --- |
| smoke | 44 | 47.7 % | 86.74 | |
| core | 553 | **25.9 %** | 76.77 | 진단점수 평균 이상인데 unusable 153 |
| robust | 282 | 28.4 % | 76.48 | human-alt 생성기 |
| full | 4,144 + hold-out 832 | 25.0 % (hold-out 27.3 %) | 78.51 (hold-out 76.47) | |
| replay-public | 6 | 16.7 % | 85.55 | 가짜 페달 27.8/분 |
| omr-live | 4 | 0 % | 53.32 | 오른손 소실(§14-11), PDF 16마디(§14-12) |

core critical gate 통과율:

| gate | 통과율 | 적용 케이스 | 실패 |
| --- | --- | --- | --- |
| meter | 57.7 % | 553 | 234 |
| playback_tempo | 53.9 % | 553 | 255 |
| beat_placement | 45.2 % | 553 | 303 |
| pitch_integrity | 92.4 % | 553 | 42 |
| key | 89.4 % | 405 | 43 |
| hands | 81.6 % | 553 | 102 |
| structure | 100 % | 553 | 0 |
| accidentals | 100 % | 553 | 0 |
| pedal | 96.7 % | 30 | 1 |

그룹별로 보면 다음과 같다.
- 겹박자 103케이스와 단순 2박자 114케이스는 usable이 0이다. 4/4는 46.5 %다.
- 책별: Hanon 0 %, Czerny 849 8.5 %, Burgmüller 10.3 %, Beyer 13.8 %, 찬송가 43.9 %.
- 틀린 박자 234건 중 146건이 "→ 6/8"이다.

§17의 SQI 81.74(sqi/1, 523케이스)와 지금 수치는 **비교할 수 없다**. 정의(버전), 케이스(553), 참조(격리와 복귀)가 모두 바뀌었다. baseline history에 버전 전환이 기록되어 있다.

제외는 39개다: L8(마디 무결성) 24개, P1(라이선스 증거 없음) 15개. 모두 `summary.md`의 "What the benchmark leaves out"와 known failure에 나온다.

### 18.6 결정론과 성능

- **같은 OS에서 반복**: core 2회 실행의 `results.json`이 byte 동일하다. Windows와 Linux 모두 `b03fe8fb…`다.
- **OS 간(Windows 11 ↔ Docker Linux offline)**: 5개 suite의 `results.json` sha256이 같다.

  | suite | sha256 |
  | --- | --- |
  | smoke | `850fce21…` |
  | core | `b03fe8fb…` |
  | robust | `5bd772e9…` |
  | replay-public | `62a85956…` |
  | full | `d7ffdf9d…` |

  metrics/2 상태에서도 같은 검사로 5개 모두 동일했다.
- **실행 시간**(Windows, 다른 작업이 없을 때):

  | 작업 | 시간 |
  | --- | --- |
  | smoke | 1 s |
  | core | 14 s (동시 작업이 있으면 18 s) |
  | robust | 8 s |
  | full | 137 s (Linux Docker 153–164 s) |
  | unit 153 | 11 s |
  | golden | < 1 s |
  | mutation-check | 103 s (19회 실행, 다른 작업과 동시) |
  | adversarial | 약 4–5분 (offline 전체) |
  | omr-live | 52 s |

### 18.7 완료 검증

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | adversarial | offline **25 OK, 0 GAP**. `--only lock --conformance` **4 OK** |
| 2 | smoke | PASS (Windows·Linux) |
| 3 | core | PASS (Windows·Linux, 2회 동일) |
| 4 | full | PASS (4,976케이스, Windows·Linux 동일) |
| 5 | golden | 17/17 identical. mutant에서 크래시 없음 |
| 6 | parser correctness / conformance | 13/13 / 258/258 |
| 7 | unit | 153 OK (Windows, Linux) |
| 8 | transcription-core | 16 OK (Windows, Linux의 plain Python) |
| 9 | arranger | 3 OK (Windows, Linux) |
| 10 | `npm test` | 26/26 suite 통과 (§18.1의 포트·경로 조건) |
| 11 | `py_compile` | bench `.py` 59개 OK |
| 12 | `node --check` | `node/*.js` 3개 OK |
| 13 | CI 정적 검토 | 아래 참조 |
| 14 | git diff 검토 | 아래 참조 |

**13. CI 정적 검토**
- gate 단계(unit, golden, lint, provenance, correctness, smoke·core·robust run+check, replay-public, transcription-core, arranger)가 `npm install` 없이 plain Python에서 돈다. Docker Linux에서 같은 단계가 통과했다.
- nightly는 mutation-check, full run+check, adversarial이다.
- T1(conformance, omr-live)은 서버·네트워크·helper가 필요해서 CI에 없다. 수동 실행이다.
- 브랜치를 push하기 전에는 CI가 켜지지 않는다.

**14. git diff 검토**
- 변경은 `tests/bench/`, `docs/`, `.github/workflows/bench.yml`, `package.json`(`test:bench`에 correctness 추가)뿐이다. G0 구현 때부터의 `.gitignore`, `README.md`, `tests/README.md`, `tests/golden/README.md`, `tests/beat_track_test.py` 변경도 있다.
- 프로덕션 JS·HTML·Python과 `catalog/`는 0이다.

### 18.8 다음 리뷰에 요청하는 것

1. fixer가 쓴 adversarial 판정 기준(`sqi`, `data`, `oracle`의 이상적 출력 구성)이 리뷰 의도보다 약하지 않은가.
2. critical gate 임계(±4 %, 0.90, 0.95, 0.80, 0.5)와 "하나라도 실패하면 unusable" 규칙이 사용자 관점에서 타당한가.
3. metrics/3의 replay 페달 정답 규칙(rendered = 없음, 녹음 = 모름).
4. gate/2의 허용치(core 0.005, subgroup max(0.02, 1/n), flip 2/1/0)가 개선을 회귀로 부르지 않으면서 회귀를 놓치지 않는가.
5. M11 해제 계획, m11(BLOCKED)의 위험.

### 18.9 결론

**`NEEDS_ANOTHER_REVIEW`**

리뷰가 막으라고 한 것은 모두 막았다. 사용자 가시 회귀 12종(리뷰 7 + fixer 5)은 모두 core·smoke REGRESSION이다. 정보를 지우는 회귀는 개선이 될 수 없다. 헤드라인은 현재의 낮은 품질(usable 25.9 %)을 숨기지 않는다. 알려진 결함과 제외는 매 실행 숫자로 나온다.

그러나 다음 두 가지 때문에 merge 전에 한 번 더 독립 리뷰를 권한다:
- M11이 BLOCKED다.
- fixer가 자기 기준으로 자기 수정을 검증한 부분이 크다.

## 19. Final Independent Review (2026-09-22)

§17(리뷰)·§18(fixer)에 참여하지 않은 최종 리뷰 세션이 썼다. §17·§18·README의 "RESOLVED"는 출발점으로만 썼다. 아래 판정은 모두 이 세션이 직접 실행하거나 코드·데이터로 확인한 것이다.

- **대상**: `D:/PPP-g0`, 브랜치 `g0-quality-foundation` @ `b1d817b` + fixer의 미커밋 변경.
- **이 세션이 바꾼 것**: 이 절, 문서 머리의 상태 줄과 목차, `tests/bench/review/final_review.py`·`final_oracle.py`(새 검사 스크립트), `tests/bench/review/README.md`의 한 절.
- **바꾸지 않은 것**: 프로덕션 코드, benchmark 기준·허용치·baseline·golden, `adversarial.py`의 기대값. 커밋·merge·push는 하지 않았고 G1도 시작하지 않았다.
- **`D:/PPP`**: 읽기만 했다(`node_modules`, Audiveris 실행 파일, merge 시뮬레이션용 clone). 이 세션의 `npm test`가 워크트리의 gitignore된 `data/*.json`(런타임 저장소)을 갱신했다. fixer 때와 같다.

### 19.0 판정

**`NEEDS_FIX`**

1. **새 MAJOR 3건** (F1–F3, §19.18). 앱이 그리거나 재생하는 MusicXML 요소 가운데 benchmark가 읽지 않는 것이 남아 있다.
   - 이 세션이 설계한 사용자 가시 회귀 10종 중 **7종이 core·smoke·robust·replay gate를 모두 통과**했다. 1종은 더 잡혔지만 우연이었고, 목표한 결함 자체는 측정되지 않았다.
   - 그중 3종은 `results.json`이 원본과 byte-identical이었고, golden은 이를 **`SERIALIZATION-ONLY`**("same music, different bytes")로 표시했다.
   - 다음 Goal(G1, writer 재구성)이 바로 이 필드들을 다시 쓴다.
2. **M4는 PARTIALLY_RESOLVED**다. B1·M1–M3·M5–M10은 VERIFIED_RESOLVED이고, M11은 BLOCKED_ACCEPTABLE이다.
3. **merge 선행 조건(BLOCKER-M)**: 로컬 `main`의 `d82bb71`이 지금 merge 대상으로 부적합하다(§19.18). G0 브랜치의 결함은 아니다.

재현성, 결정론(Windows·Linux byte 동일), 범위 준수, provenance, known failure 노출, usable 헤드라인과 진단점수의 분리는 merge 수준이다. 고칠 범위는 작다(§19.19).

### 19.1 방법과 환경

| 항목 | 한 것 |
| --- | --- |
| Windows | Windows 11(cp949), Python 3.13.5, Node 24.17.0. T0 전부, T1(parity·omr-live), `npm test` (§19.16) |
| Linux | 워크트리 상태 그대로(추적 파일 + 무시되지 않은 미추적 파일, 848개)를 scratch 저장소에 커밋했다. Docker `node:24-bookworm`(Python 3.11.2, Node 24.21.0), `--network none`에서 LF clone해 CI gate job 전 단계와 nightly(mutation-check, full, adversarial)를 실행했다 |
| T1 | 워크트리 서버를 8799·8777에 잠시 띄웠다(끝나고 종료). puppeteer는 `D:/PPP/node_modules`, Audiveris는 `PPP_AUDIVERIS=D:\PPP\tools\audiveris\Audiveris\Audiveris.exe`(읽기만) |
| 새 검사 | `final_review.py`(새 mutation 10종), `final_oracle.py`(다르게 조판한 정답). scratchpad 스크립트: critical gate 독립 재계산, usable 표본 추출, provenance 교차검사, PredTime 편향 측정, main merge 시뮬레이션, 역순 열거 결정론 |
| 커밋 구분 | 리뷰어 커밋 `b1d817b`에는 §17, `review/adversarial.py`, `review/README.md`만 있다. **fixer 커밋은 없다**: §18의 변경(수정 59, 신규 68파일)은 모두 미커밋이다. baseline 6개의 `recorded.git_sha`는 `b1d817b`(dirty)다 |
| `CLAUDE.md` | 두 worktree와 git 이력 어디에도 없다(§17 O1과 같음) |

### 19.2 B1·M1–M11 재검증

| # | 판정 | 근거 (이 세션이 확인) |
| --- | --- | --- |
| B1 | **VERIFIED_RESOLVED** | ADV-NO-TEMPO는 core·smoke REGRESSION이다(mutation-check에서 `critical.playback_tempo` 0.5029→0). 코드: 정답에 값이 있으면 예측 누락은 0점(`metrics/structure.py:136-146`), gated metric이 null이 되거나 n이 줄면 FAIL(`compare.py:134-136, 169-175`), 진단점수 재정규화는 정답 쪽 null에만 한다. 새 mutation 10종에서도 null로 이득을 본 경우는 없다 |
| M1 | **VERIFIED_RESOLVED** | 박자표는 예측 XML의 `primary_time()`으로 읽고, stats는 `struct.stats_consistent`로만 쓴다. ADV-XML-METRE, FIX-STATS-LATE-BARS는 REGRESSION이다. 단 "주된 박자 하나"만 본다 → F1 |
| M2 | **VERIFIED_RESOLVED** | 헤드라인은 usable이고 진단점수는 별도다. 독립 재계산과 일치한다(§19.6). summary가 "진단점수는 평균 이상인데 unusable" 153건을 보여 준다. 남은 것: m2(음가) |
| M3 | **VERIFIED_RESOLVED** | ADV-MINOR-LEADING-TONE(진단점수 −0.01)은 REGRESSION이다(micro, tag). 새 FINAL-TOP-REGISTER-OCTAVE-DOWN(A6 이상만, 일부 곡만)도 core·robust REGRESSION이다(flip, tag) |
| M4 | **PARTIALLY_RESOLVED** | 페달, 필요한 임시표, 마디 수, 가장자리 빈 마디는 이제 gate된다. ADV-NO-PEDAL/-NO-ACCIDENTAL/-EXTRA-BAR, FIX-NO-NATURALS, 새 FINAL-PEDAL-HELD-TO-BARLINE이 모두 REGRESSION이다. 그러나 앱이 쓰는 출력 가운데 음표 모양(`<type>`/`<dot>`), 마디 번호, 두 번째 이후의 템포·박자표·조표, clef, 쉼표 길이는 어떤 gate에도 없다(F1, F2, F3) |
| M5 | **VERIFIED_RESOLVED** | adversarial oracle 141곡(pickup 44곡) 만점을 재현했다. 독립 oracle에서 pickup을 "앞에 쉼표가 있는 꽉 찬 첫 마디"로 다시 조판해도 위치·박자·마디·downbeat는 만점이다. 남는 오차는 PredTime 탓이다(m1) |
| M6 | **VERIFIED_RESOLVED** | correctness 13/13, parity 258/258을 이 세션의 서버로 재현했다. parity와 correctness는 문서, CLI 출력, `report.json`(`"kind": "parser parity (not correctness)"`)에서 모두 구분된다. 망가진 reader 3종을 correctness가 브라우저 없이 잡는다. 단 마디 번호 규칙은 비교 대상이 아니다(F2) |
| M7 | **VERIFIED_RESOLVED** | mutant 12개(깨진 XML, 예외 포함)에서 golden이 크래시하지 않았다. 깨진 XML은 17 FAIL, 예외는 16 FAIL로 보고하고 exit 1이다. 단 semantic과 byte를 가르는 기준이 일부 필드에서 틀렸다(F3, §17 m13) |
| M8 | **VERIFIED_RESOLVED** | 매 실행 `results.json`·`summary.md`에 known failure 7종이 나온다. adversarial의 독립 카운터와 정확히 일치한다(찬송가 89/100, tie 10곡 101개, 마디 내 임시표 10곡 18음) |
| M9 | **VERIFIED_RESOLVED** | 정답은 표준 해석으로 읽고, octave-shift 19곡이 돌아왔다. `feature:ottava` 34케이스의 usable은 14.7 %다. 앱의 해석은 KNOWN_FAILURE(30파일·2,229음)이고 C10·C11이 고정한다 |
| M10 | **VERIFIED_RESOLVED** | §19.8 |
| M11 | **BLOCKED_ACCEPTABLE** | §19.12 |

§18.3의 m11(PredTime의 균등 박 가정)은 "BLOCKED, 지금 수치에는 영향이 없다"고 했다. **사실이 아니다.** MINOR m1로 다시 분류한다.

### 19.3 Benchmark 속이기: 새 mutation 10종

`python tests/bench/review/final_review.py` (약 5분). 각 mutation은 `audio-score.js`의 사본에만 적용했다. 적용 후 golden 입력 17개의 출력에 실제로 나타나는지도 확인했다: 점 132→15, 템포 표시 17→34, `<time>` 17→34, `<key>` 17→34, 낮은음자리표 17→0, 서로 다른 마디 번호 161→66, 임시표 27→1,734.

| mutation | 범주 | 사용자가 받는 것 | core | smoke | robust | golden | replay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FINAL-DOTS-DROPPED | 리듬·표기 | 점음표가 모두 점 없이 그려진다(앱은 `<type>`/`<dot>`로 그린다). 재생은 같다 | PASS, results.json **byte-identical** | PASS | PASS | **9 SERIALIZATION-ONLY**, 8 ok | PASS |
| FINAL-TEMPO-HALVED-MIDWAY | 템포 | 가운데 마디부터 절반 속도로 표시·재생된다(앱의 `tempoMap`/`msAt`은 모든 템포 표시를 재생한다) | PASS (Δ 0) | PASS | PASS | 17 SEMANTIC CHANGE | PASS |
| FINAL-METRE-TAIL | 박자·부분 손상 | 마지막 1/3이 틀린 박자표다(3/4→6/8, 4/4→8/8) | PASS (Δ 0) | PASS | PASS | 17 SEMANTIC | PASS |
| FINAL-KEY-TAIL | 조성·부분 손상 | 마지막 1/3이 5도 옆 조표다. 임시표로 음높이는 맞춘다 | PASS (Δ 0) | PASS | PASS | 17 SEMANTIC | PASS |
| FINAL-BASS-STAFF-TREBLE-CLEF | 손·보표 | 왼손 보표가 높은음자리표다(왼손이 덧줄 위에 적힌다) | PASS, **byte-identical** | PASS | PASS | **17 SERIALIZATION-ONLY** | PASS |
| FINAL-BAR-NUMBERS-RESTART | 구조(앱 parity) | 마디 번호가 1 2 3 4 1 2 …로 반복된다. 앱은 번호로 마디를 찾으므로 번호가 같은 마디들을 한 자리에 겹친다. **앱 parser로 확인했다**: G01의 160음은 서로 다른 시작 위치가 48개에서 12개로 줄고, 모두 마지막 네 마디에 쌓인다 | PASS, **byte-identical** | PASS | PASS | **15 SERIALIZATION-ONLY** | PASS |
| FINAL-ACCIDENTAL-ON-EVERY-NOTE | 표기·가독성 | 모든 음에 임시표가 붙는다 | PASS (Δ 0) | PASS | PASS | 17 SEMANTIC | PASS |
| FINAL-TRAILING-RESTS-SHORT | 리듬·구조 | 끝 쉼표가 한 박 짧아져 그 보표의 마디가 맞지 않는다 | REGRESSION이지만 **우연**이다. `rest()`가 페달 표시도 내보내서 pedal 케이스 5개의 페달 위치가 바뀌었다(tag `book:beyer`의 `pedal.f1`). 쉼표 결함 자체는 아무 metric도 보지 않는다 | REGRESSION(같은 이유) | PASS | 7 **SERIALIZATION-ONLY** | PASS |
| FINAL-PEDAL-HELD-TO-BARLINE | 페달(대조군) | 페달을 떼는 위치가 모두 마디 끝이 된다 | REGRESSION (`pedal.f1`, `false_per_min`, micro) | PASS | PASS | 1 SEMANTIC | PASS |
| FINAL-TOP-REGISTER-OCTAVE-DOWN | 음높이·일부 그룹 | A6 이상의 음이 한 옥타브 낮게 적힌다 | REGRESSION (flip `pitch_integrity`, usable −1.3 pt) | PASS | REGRESSION | ok (입력에 그 음역이 없다) | PASS |

해석:

- 잡힌 것은 기존 metric이 이미 재는 차원이다(음높이, 페달 시각). 놓친 7종은 모두 **앱은 쓰는데 benchmark는 읽지 않는 MusicXML 요소**다: `<type>`/`<dot>`, `<measure number>`, 첫 번째 이후의 `<sound tempo>`·metronome·`<time>`·`<key>`, `<clef>`, `<rest>` 길이, 불필요한 `<accidental>`.
- golden은 템포·박자표·조표·임시표 변경을 SEMANTIC CHANGE로 보여 준다. 그러나 G1처럼 출력이 의도적으로 바뀌는 Goal에서는 모든 케이스가 바뀌어 한꺼번에 bless된다. README도 품질 판정은 metric gate의 일이라고 적었다.
- 점·clef·마디 번호·쉼표 변경은 golden이 **"same music, different bytes"**로 표시한다. README 절차("the label tells a musical change from a serialisation one")를 따르면 그대로 bless된다. §17 B1과 같은 종류의 잘못된 보증이다. 다른 점은 회귀를 "개선"이 아니라 "형식만 바뀜"으로 인증한다는 것뿐이다.

### 19.4 Diagnostic score (sqi/2 = 76.77)

- **usable과 분리되어 있다.** summary 순서는 판정 → usable과 gate 표 → "Diagnostic score high but unusable" 목록 → metric이다. 이 목록은 153건이고 상위 10건을 이름으로 보여 준다(예: Beyer 025·027·031, beneath-the-cross는 진단 95–97인데 hands 0.73–0.76). release 판정에 진단점수를 쓰는 코드는 없다. compare는 케이스 −10점 규칙과 aggregate 허용치 0.30에만 쓴다.
- **치명 실패를 가리지 않는다.** 리뷰의 4대 실패 중 3개 이상인 187케이스의 최고 진단점수는 70.9로 평균보다 낮다(adversarial `sqi` 재현).
- **null이 유리하게 작용하지 않는다.** 가중 평균에서 빠지는 것은 정답 쪽 null(`skip_metrics`, 1-staff 참조, 셋잇단 없는 참조)뿐이다.
- **부분 그룹 퇴행을 평균이 숨기지 않는다.** subgroup 가드가 있다(M3). 단 가드는 측정하는 차원에만 작동한다(F1–F3).

### 19.5 Usable score rate (core 25.9 %)

- **계산**: 553/553 케이스에서 `usable == all(적용되는 gate)`다. 각 gate를 원시 metric에 임계로 다시 적용해도 불일치가 0이다.
- **너무 강한가**: 대표 사례를 직접 읽었다.
  - hands만 실패한 35케이스(Beyer 025 0.759 등)는 음의 1/4 가까이가 다른 손 보표에 있다. 손 따로 연습이 깨진다.
  - 박자 실패 234건 중 146건이 →6/8이다. 템포 실패 255건 중 172건이 ×2/3(겹박자 템포 단위 버그, §14 이슈 1)이다.
  - 임계는 둥근 값이고 사용자 관점의 사유가 적혀 있다. 현재 분포 바로 밑에 맞춘 흔적은 없다. structure와 accidentals는 지금 100 %라 가드 역할만 한다.
- **중복**: 가장 흔한 조합은 meter+tempo+beat_placement(111건)다. 원인 하나(6/8 오독)가 gate 셋을 떨어뜨린다. usable은 AND라 이중 계산이 아니다. gate별 통과율 표가 원인별이 아니라 증상별이라는 점만 유의하면 된다.
- **너무 약한 곳: 음가(note value)는 gate가 아니다.** usable 143건 중 43건(30 %)의 `duration.accuracy`가 0.80 미만이다.
  - 표본 `method/czerny599/049`, human, onset 경로: usable이고 진단점수 86.6이다. 음·마디 위치·박자·조·템포는 맞다. 그러나 음가 정확도는 0.19다.
  - 오른손 16분음표가 32분음표 + 32분쉼표로, 왼손 8분 화음이 16분음표 + 쉼표로 적혔다. 마디당 쉼표가 8.9개다(정답 5.25).
  - 연주는 할 수 있지만 "쓸 수 있는 악보"라고 부르기에는 관대하다 → m2. aggregate `notation.duration.accuracy`는 gate되므로 이 차원의 회귀는 여전히 잡힌다.

### 19.6 Critical gate 독립 재계산

pppbench의 reader와 metric을 쓰지 않는 별도 스크립트(ElementTree)로 `out/core/cases/*.musicxml`과 정답 파일을 직접 읽었다.

| gate | 독립 재계산 | 보고값 | 케이스 일치 |
| --- | --- | --- | --- |
| meter | 57.69 % (553) | 57.69 % | 553/553 |
| playback_tempo | 53.89 % (553) | 53.89 % | 553/553 |
| key | 89.38 % (405) | 89.38 % | 405/405 |
| beat_placement | 45.21 % (553) | 45.21 % | 임계 재적용 불일치 0 |

- 정답 쪽 `expected`는 파일 내용과 일치했다. 다른 곳은 템포 표시가 없는 8곡(hanon 7곡, sonatina/026)의 `expect.tempo_qpm`뿐이다. 합성 연주도 그 템포로 하므로 옳다.
- SUT의 `stats`는 critical gate의 값에 쓰이지 않는다. 박자, 템포, 조, 손, 위치는 모두 예측 XML에서 온다. stats는 초 단위 매칭에 필요한 마디 시각과 `stats_consistent`에만 쓰인다. 단 그 시각 계산(PredTime)에 편향이 있다(m1).

### 19.7 Known failures

매 `run`의 `results.json`(`known_failures`, `exclusions`)과 `summary.md`의 두 절에 항상 나온다.

- 찬송가 조표 무시 89/89(C장조가 아닌 찬송가 전부), 6,119음
- octave-shift 30파일, 2,229음
- 끝나지 않는 tie 16파일, 121개
- 마디 내 임시표 미지속 10곡, 18음
- bar integrity 24파일, 88마디
- 템포 표기 불일치 4파일
- 꾸밈음 17파일, 244음(KNOWN_LIMITATION)
- 제외 39 = L8 24 + P1 15(격리 목록은 이름까지)
- key·spelling skip 78곡 = core 148/553케이스, 그리고 그 production 영향

제외와 skip은 usable과 진단점수를 올리는 쪽으로 작용한다. 그러나 숨겨지지는 않는다. 수가 늘면 `check`가 FAIL한다. merge 시뮬레이션에서 실제로 FAIL했다(§19.18).

### 19.8 Reference provenance

- 후보 파일 351개: trusted 336, unverified 15. 등록 참조 312개가 모두 trusted이고, 라이선스 문구는 provenance에서 나온다(불일치 0).
- **격리 15개는 `excluded.json`의 P1 15개와 정확히 같다**: burgmuller25 001·002·004·007·018, czerny299 001–010. 어떤 suite에도 없다(core·smoke·full·robust·mutation, golden 원천, replay fixture 6개의 참조, omr).
- 신뢰 근거:
  - PPP 전사 130개: 파일 `<rights>`에 "Transcribed for PPP"
  - 파일의 PD 문구 53개: Mutopia 3, PianoXML 30, hanon 20
  - 저장소 메타데이터 127개: 찬송가 100(index.json·sources.js), catalog 3(index.json), czerny849 24(books.json이 파일에 적힌 조판자 Neru Hayashi를 이름으로 가리킨다)
  - 생성 25개, PPP 자작 1개
  - "file-statement인데 PD 문구가 없는 파일": 0
- **추측한 라이선스는 없다.** 책 단위의 "PDMX (CC0)" 주장만 있는 파일은 모두 격리되었다. replay fixture의 렌더러 샘플(Salamander, CC BY 3.0)은 fixture 메타데이터에 적혀 있다.

문제 없음.

### 19.9 Pickup·musical oracle

- adversarial oracle 3종을 재현했다(OK×3).
- 그러나 fixer의 oracle은 SQI 구성 metric만 확인하고, **usable과 critical gate는 확인하지 않는다.**
  - `final_oracle.py`로 확인하면 정답 파일 그대로를 예측으로 넣었을 때 37곡이 `critical.accidentals` 실패로 unusable이다.
  - 37곡은 모두 찬송가다. 36곡은 key_signature_playback, 1곡(my-hope-is-built)은 bar_accidental_not_carried 결함이다. 페이지 자체가 필요한 임시표를 빠뜨렸다.
  - benchmark는 옳다. 그 파일은 이상적인 출력이 아니다. 검사가 이 사실을 명시하지 않았을 뿐이다 → m3.
- 같은 음악을 다르게 조판한 정답:
  - **pickup을 앞에 쉼표가 있는 꽉 찬 첫 마디로**(PPP 방식), 20곡: 위치·박자·마디·downbeat 만점. 5곡에서 identity 0.98, 1곡에서 위치 0.993이 나왔다. 원인은 PredTime이다. 박을 외삽하는 PredTime으로 다시 채점하면 모두 만점이다(m1).
  - **mode 반전**(`<mode>` major↔minor), 104곡: 모든 gate와 진단점수가 그대로다. 조표만 채점하고 mode는 MIREX 점수에만 쓴다.
  - **템포를 인쇄 metronome 표시로만**(겹박자는 점4분 단위, `<sound>` 없음), 141곡: 그대로다.
  - **tie, 꾸밈음, 임시표**: 정답 파일 자체에 이것들이 있는 곡이 포함되어 있고 만점이다(찬송가 결함 제외). correctness C01·C02·C07·C13이 규칙을 고정한다.

oracle 자체의 결함은 없다. 단 m1과 m3이 있다.

### 19.10 Golden

- 17개다. byte(`.musicxml`), semantic(`.semantic.json`), stats, timing이 분리되어 있고 라벨은 셋이다. 깨진 XML과 예외에서도 크래시하지 않는다(§19.2 M7).
- A(형식만 바뀜) / B(음악 의미 바뀜) / C(직렬화 불안정)의 구분은 **틀리는 경우가 있다.**
  - `semantic.projection`(`semantic.py:4-7`)은 note type을 형식으로 보고 버린다. 점, clef, 쉼표, 마디 번호는 아예 담지 않는다.
  - 앱은 이것들을 쓴다: `<type>`→`VF_TYPE[head.type]`(App 4203, 11413), `<dot>`(App 4204, 11444), clef(App 3987–3998), 마디 번호(App 3958–3960, 4261, `byNumber` 3534).
  - 그래서 B가 A로 표시된다: FINAL-DOTS-DROPPED 9, FINAL-BASS-STAFF-TREBLE-CLEF 17, FINAL-BAR-NUMBERS-RESTART 15, FINAL-TRAILING-RESTS-SHORT 7케이스 → F3.
- voice 번호를 형식으로 보는 것은 맞다. 앱은 stem 방향 말고는 voice를 쓰지 않는다.

### 19.11 Parser correctness

parity(258/258)와 correctness(13/13)는 모든 층에서 분리되어 있다.

- 문서: README "Parser parity is not correctness"
- CLI 출력: "Parity is not correctness — see `run.py correctness`"
- machine-readable: `conformance/report.json`의 kind가 "parser parity (not correctness)"이고, `correctness/report.json`은 별도 파일이다.

correctness fixture의 규약은 명세에서 쓰였고, C13은 fixer가 추가했다고 표시되어 있다. 작성자가 독립적이었는지는 검증할 수 없다. 문제 없음. 마디 번호 규칙은 둘 다 다루지 않는다(F2).

### 19.12 M11: 실제 사람 연주 holdout

판단: **BLOCKED_ACCEPTABLE**

- **G0 merge의 선행 조건은 아니다.**
  - G0의 핵심 측정 대상은 `toMusicXml`의 표기 단계다. 입력(음·박)이 같으면 출력도 같다. 따라서 표기·조판·writer를 바꾸는 Goal을 판정하는 데 실제 녹음이 꼭 필요하지는 않다.
  - benchmark는 이 한계를 숨기지 않는다: README의 "How far from synthetic" 표, summary의 hold-out 문구, 비어 있는 replay `input:recorded`.
  - 가짜 데이터는 없다. replay 6개는 모두 `input:rendered`이고, 렌더 프로파일과 렌더러가 fixture에 적혀 있다.
- **robust suite는 독립 생성기가 아니다.**
  - `human-alt`는 같은 `perform()`의 매개변수 변형이다: 강세·보이싱·롤을 끄고, 지터를 삼각분포로, 릴리스를 30–120 ms로 바꿨다.
  - 공유하는 것: TimeMap(메트로놈 템포, drift 0), 박 격자, 음 집합(악보 그대로), 릴리스 모델, 시작 시각 규칙. rubato도 없다.
  - 강세 단서에 대한 과적합(§17 M11의 증거)은 잡는다. 그러나 박·박자·템포 추론 휴리스틱이 "악보대로 정확한 연주"에 과적합되는 것은 잡지 못한다.
  - README의 "a second generator family with none of the main family's cues"는 과장이다 → m5.
- **결론**: 실제 녹음은 onset 경로의 박·템포·박자 추론을 바꾸는 첫 Goal을 **시작하기 전**에 필요하다(§19.20 ④). G0 merge나 writer 쪽 Goal의 선행 조건은 아니다.

### 19.13 결정론

| 조건 | 결과 |
| --- | --- |
| 같은 명령 반복(core 2회) | byte 동일 `b03fe8fb…` |
| 다른 cwd(`tests/bench/unit`에서 `../run.py`) | 동일 |
| listdir·glob·git 파일 목록·suite 참조 순서를 모두 역순으로 | smoke `850fce21…`, core `b03fe8fb…`로 동일 |
| Linux Docker offline, LF clone, 다른 절대 경로(`/w`), Python 3.11.2, Node 24.21.0 | smoke `850fce21…`, core `b03fe8fb…`, robust `5bd772e9…`, replay-public `62a85956…`, full `d7ffdf9d…`. 5개 모두 Windows와 동일하고 §18.6의 값과도 같다 |
| references.json 자체의 순서를 바꾸면 | `exclusions.skipped_metrics.ids`의 순서만 바뀐다. 환경이 아니라 커밋된 입력이다(o1) |

시간과 환경은 `run.json`에만 있고 `results.json`에는 없다.

### 19.14 CI

fresh runner 관점의 정적 검토에 위의 Linux 실행을 더했다.

- **통과한 것**:
  - 848파일 스냅숏의 LF clone에서 gate job의 모든 step과 nightly의 3 step이 통과했다(adversarial 25 OK, 211 s).
  - 업로드 대상 artifact 경로 10개가 모두 생성된다. 실행 뒤 `git status`는 깨끗했다.
  - local-only fixture가 없다. 모든 입력이 커밋 대상이고, `.cache`와 `out`만 생성된다.
  - Windows 경로 하드코딩이 없다. venv·로컬 서버에 의존하지 않는다(T1·T2는 CI 밖).
  - exit code: `run`은 0, `check`는 0/1/2, `run --suite replay-public`은 판정으로 끝난다. smoke check가 실패하면 그 step이 실패해 job이 빨개진다. nightly의 full check와 adversarial(GAP이 하나라도 있으면 exit 1)도 전파된다.
  - 시간: gate 약 1분, nightly 약 8분(Docker). 제한은 20분과 45분이다.
- **주의할 것**:
  - 트리거는 `push: branches: [main]`과 `pull_request`뿐이다. **브랜치만 push하면 아무것도 돌지 않는다**(PR을 열어야 gate가 돈다). `schedule`은 기본 브랜치에서만 돈다. CURRENT_STATE의 "not active until the branch is pushed"는 부정확하다 → m7.
  - CI는 Linux + Python 3.13이다. 이 세션은 Windows + 3.13과 Linux + 3.11만 확인했다.
  - **GitHub Actions 실제 실행은 검증하지 못했다**(push 금지).
  - fixer의 변경이 미커밋이다. 새 모듈(`correctness.py`, `known_defects.py`, `metrics/critical.py`, `metrics/pedal.py`, `semantic.py`), `corpus/correctness/`, `provenance.json`, golden의 `.semantic`·`.timing` 34개와 G15–G17, `robust` suite·baseline 가운데 하나라도 커밋에서 빠지면 CI가 깨진다 → m6.

### 19.15 범위

`git diff 663d463`(커밋 + 워크트리)과 미추적 파일을 확인했다.

- 프로덕션 파일 변경 0: `audio-score.js`, `server.js`, 앱 HTML, `omr-service.js`, `transcribe.py`, `beat_track.py`, `arrange_score.py`, `pm2s_quant.py`, `catalog/`, `i18n/`, lockfile, Dockerfile, render.yaml.
- `tests/bench`·`docs` 밖의 변경: workflow, `.gitignore`, `package.json` scripts, README 3개(문서), `tests/beat_track_test.py`(sys.path 2줄)뿐이다.

G0은 benchmark 인프라 범위를 넘지 않았다.

### 19.16 테스트 매트릭스 (이 세션이 실행)

| 항목 | 결과 | 시간 |
| --- | --- | --- |
| unit | 153 OK (Windows), 153 OK (Linux 3.11) | 13.5 s / 7 s |
| golden | 17/17 identical (두 OS) | 0.3 s |
| correctness | 13/13. 앱의 편차는 C10·C11(문서화됨) | 0.1 s |
| lint-corpus | 참조 312, error 0, warning 70, 제외 39 | 1.9 s |
| `make_provenance.py --check` | 일치 | 0.2 s |
| smoke run + check | PASS, usable 47.7 %, 진단 86.74 | 0.9 s |
| core run + check | PASS ×2(다른 cwd 포함), 25.9 % / 76.77 | 13.2 s |
| robust run + check | PASS, 28.4 % / 76.48 | 7.2 s |
| full run + check | PASS, 4,976케이스, 25.0 %(hold-out 27.3 %) / 78.51 | 109 s (Linux 146 s) |
| replay-public | PASS, 16.7 % / 85.55 | 0.3 s |
| mutation-check | PASS: 17종 모두 REGRESSION, no-op byte 동일 | 77 s (Linux 84 s) |
| adversarial | 25 OK, 0 GAP | 179 s (Linux 211 s) |
| `ab --suite core --a git:HEAD --b worktree` | PASS | 29 s |
| parser parity (T1) | 258/258 | 9.9 s |
| omr-live (T1) | PASS, 4케이스, 평균 진단 53.32 | 60 s |
| transcription-core | 16 OK (8+2+3+3) | 1.7 s |
| arranger | 3 OK | 0.5 s |
| `npm test` | 26/26 suite 통과, 확인 1,025개, 실패 0. 워크트리 helper에 Audiveris와 transcriber가 없어 "OMR pipeline"과 "recording → score through the UI" 절은 스스로 SKIPPED | 수 분 |
| `py_compile` | 62/62 (bench `.py` + `beat_track_test.py`) | |
| `node --check` | 3/3 (`node/*.js`) | |
| record-replay (T2) | **실행하지 않음**: 실제 녹음, GPU, transcribe venv가 필요하고 새로 녹음할 데이터가 없다 | |

### 19.17 문서 일관성

README, CURRENT_STATE, §18, `results.json`을 대조했다.

- **일치하는 것**:
  - usable과 진단점수(6개 suite), gate 통과율, 그룹 수치(겹박자 103·단순 2박자 114케이스 usable 0, 4/4 46.5 %, 책별 수치)
  - →6/8 146/234, 2/4→6/8 77. 겹박자 출력 189, `mark_consistent` 0.00, `ok_effective` 0.03, `ok_written` 0.81
  - known failure 7종, 제외 39(L8 24, P1 15), 참조 312(full 311), 케이스 수
  - 버전: reader/2, metrics/3, sqi/2, perform/2. gate/2는 suite 파일에 있다
  - 실행 시간(대략)
- **불일치 (m8)**:
  - README 41행 "16 planted regressions"와 140행·CURRENT_STATE·mutation-check의 17.
  - `tests/README.md`: smoke가 "32 cases"(실제 44)이고, `test:bench` 설명에 correctness가 없다.
  - `suites/golden.json` description: "14 fixed inputs"(실제 17).
  - G00 목차에 §18이 없었다(이 세션이 §18·§19를 추가했다).
  - §18.3의 m11 "지금 수치에는 영향이 없다" → m1이 반박한다.
  - CURRENT_STATE의 CI 문구 → m7.

### 19.18 Findings

#### BLOCKER

없다(G0 브랜치의 benchmark 결함 기준).

#### BLOCKER-M: merge 선행 조건 (G0 브랜치 밖) — **BLOCKED_NOT_ACCEPTABLE** (merge 전 사용자 결정, 이 세션 범위 밖, [§20.2](#202-19-findings-처리-상태))

**로컬 `main`의 `d82bb71`**(2026-09-22 14:54, "fix: harden G0 quality benchmark after independent review")은 이름과 달리 benchmark 변경을 하나도 담고 있지 않다. `D:/PPP`에서 `git add -A`로 휩쓸려 들어간 190파일이다.

- `tmp/` 약 50파일. G00 §1.5와 CURRENT_STATE가 "저작권 자료, 절대 커밋 금지"라고 한 폴더다: gurenka·looping-rooms 오디오(m4a, wav), 공식 악보 PDF의 페이지 렌더(lulu-official, looping-rooms, piano-poem), Audiveris 산출물.
- `__pycache__/*.pyc` 10개, `_oh-sheet-compare` gitlink(`.gitmodules` 없음).
- 다른 세션 작업인 `catalog/method` 신규 124파일과 `index.json` 수정.

push되지는 않았다: `origin/main`은 `e0d8b23`이고 로컬 `main`이 14커밋 앞서 있다.

merge 시뮬레이션: scratch clone에 G0 스냅숏을 커밋하고 `origin/main`(= `d82bb71`)을 merge했다. 텍스트 충돌은 없었지만 **G0 gate가 빨개졌다**.

- `make_provenance.py --check`가 stale(exit 1)이다. unit 1개도 같은 이유로 FAIL한다.
- smoke·core check가 REGRESSION이다. known failure가 늘었다: bar_integrity 24→25, 꾸밈음 17→19파일, key_signature_playback 92→93.

benchmark는 옳게 동작했다. 새 카탈로그 파일에 실제로 결함이 있다. 결론:
- 지금 main에 merge하면 첫 CI가 실패한다.
- main을 push하면 저작권 자료가 공개된다.

이 커밋을 어떻게 처리할지(되돌리기, 분리)는 사용자가 정한다. G0의 `.gitignore`(`tmp/`, `__pycache__/`)가 main에 먼저 있었다면 막을 수 있었던 사고다.

#### MAJOR

**F1. 템포·박자표·조표를 값 하나로만 채점한다. 곡 중간의 표시는 앱이 재생하고 그리는데도 gate 밖이다.** — **RESOLVED** ([§20.3](#203-f1-곡-전체의-템포박자표조표))

- **코드**:
  - `critical.playback_tempo`는 첫 템포 표시만 본다(`musicxml.py` `first_tempo`, 445–453행).
  - `critical.meter`는 마디 길이로 가중한 최빈 박자다(`canonical.primary_time`).
  - `critical.key`는 첫 마디의 조표다(`metrics/structure.py:125`).
  - reader는 모든 표시를 읽는다(`canon.marks`, 마디별 time·fifths). 그러나 어떤 metric도 쓰지 않는다.
- **앱**: `tempoMap`(App 2761–2792)과 `msAt`(App 2868–2882)이 모든 `<sound tempo>`와 metronome 표시를 재생 시간에 적분한다. 마디별 time과 key는 `measureInfo`로 그린다.
- **증거**: FINAL-TEMPO-HALVED-MIDWAY, FINAL-METRE-TAIL, FINAL-KEY-TAIL이 core·smoke·robust·replay를 모두 통과했다. 진단점수와 usable의 Δ는 0이다.
- **영향**:
  - G1(writer 재구성)이나 템포 변화·전조를 검출하는 Goal에서, 곡 뒷부분의 틀린 템포·박자표·조표가 통과한다.
  - 반대로 SUT가 정답의 템포 변화를 옳게 쓰게 되어도(정답의 템포 변화는 `reference_marks`로 연주된다) 개선이 보이지 않는다.
- **수정**:
  1. `critical.playback_tempo`: 앱의 템포 맵으로 계산한 재생 시각이 연주와 ±4 % 안에 드는 정답 음(또는 박)의 비율로 판정한다.
  2. meter·key: 마디별로 판정한다. 정답 마디에 대응하는 예측 마디의 time·fifths가 모두 맞아야 한다.
  3. `stats_consistent`에 마디별 검사를 넣는다.
  4. METRICS_VERSION을 올리고 재기준화한다.

**F2. 앱이 쓰는 표기 필드 가운데 음표 모양(`<type>`/`<dot>`)과 마디 번호를 어떤 metric도 읽지 않는다.** — **RESOLVED** ([§20.4](#204-f2-음표-모양마디-번호쉼표clef))

- **앱**: 음표 모양은 `<type>`과 `<dot>`로 그리고(App 4203–4204, 11413, 11444), 재생은 `<duration>`으로 한다. 마디는 번호로 찾는다(App 3958–3960 `number`, 4261 `measureInfo[number]`, 3534 `byNumber`).
- **benchmark**: 음가는 `<duration>`만 본다(`notation.duration.*`). 마디는 문서 순서의 index로 센다(`musicxml.py:207, 344`). reader는 `duplicate_measure_numbers`를 계산하지만(215–216행) 예측에는 쓰지 않는다. 참조의 lint L6에만 쓴다.
- **증거**: FINAL-DOTS-DROPPED와 FINAL-BAR-NUMBERS-RESTART에서 core `results.json`이 원본과 byte-identical이었다. 앱 parser로 마디가 무너지는 것을 확인했다(§19.3).
- **수정**:
  1. `notation.glyph_consistent`를 만든다: `<type>`+`<dot>`(+`<time-modification>`)이 `<duration>`과 맞는 음·쉼표의 비율.
  2. 마디 번호가 유일하지 않거나 증가하지 않으면 실패로 한다.
  3. 1과 2를 `critical.structure`에 넣는다(허용치 0).
  4. parity(`node/conformance.js`, `tiers.compare_projection`)에서 type, dots, 마디 번호를 비교한다.

**F3. golden의 "형식만 바뀜" 판정이 앱이 그리는 필드에 대해 틀렸다.** — **RESOLVED** ([§20.5](#205-f3-golden-분류))

- `semantic.projection`이 note type과 점을 형식으로 보고 버리고, clef·쉼표·마디 번호를 담지 않는다.
- 그래서 점 누락 9, 왼손 높은음자리표 17, 마디 번호 15, 쉼표 7케이스가 "SERIALIZATION-ONLY — same music, different bytes"로 표시된다. README는 이 라벨을 "never as a musical change"라고 설명한다. §17 m13이 바란 것과 반대다.
- G1은 writer를 다시 쓰므로 byte golden은 전부 바뀐다. 라벨이 "형식만"이라고 말하면 곧바로 bless 절차로 간다.
- **수정**:
  1. projection에 type·dots, 쉼표(마디·위치·길이·보표), 마디별 clef, 마디 번호를 넣는다.
  2. golden을 다시 bless한다(사유 기록).
  3. 새 mutation 4종이 SEMANTIC CHANGE가 되는지 unit test로 고정한다.

#### MINOR

처리 상태는 [§20.2](#202-19-findings-처리-상태)에 있다.

| # | 내용 | 수정 |
| --- | --- | --- |
| m1 | **PredTime의 균등 박 가정(§18.3 m11)은 지금 수치를 바꾼다.** 예측의 첫 마디나 끝 마디에서 `stats.beats`가 모자라면(pickup을 꽉 찬 마디로 쓰거나 onset 경로일 때) 음 시각을 늦게 보간한다. golden G05(3/4 pickup, oracle 박)에서 185 ms 늦고, 4/4의 한 박 pickup이 느린 템포면 매칭 창 300 ms를 넘는다. 박 목록을 SUT의 `tickToSec`처럼 첫 박·끝 박 간격으로 늘려 core를 다시 계산하면 553케이스 중 43개가 바뀐다: identity F1 +0.0019(gate 허용치 0.002 수준), `critical.pitch_integrity` 2케이스 추가 통과. usable은 그대로다. SUT를 바꾸지 않고 benchmark에서 고칠 수 있으므로 BLOCKED가 아니다 | PredTime이 barStarts 범위까지 박을 외삽한다. METRICS_VERSION 상향 |
| m2 | usable이 음가를 보지 않는다. usable 143건 중 43건의 음가 정확도가 0.80 미만이다(czerny599/049 human/onset 0.19) | 음가 gate(예: `duration.accuracy` ≥ 0.80)를 넣거나, 헤드라인 정의에 "음가는 판정하지 않는다"를 명시 |
| m3 | fixer의 oracle 검사가 usable과 critical gate를 확인하지 않는다. 확인하면 찬송가 37곡(카탈로그 결함)이 자기 자신에 대해 unusable이다 | oracle 검사에 usable과 critical.*를 넣고, 결함 파일은 known failure를 근거로 명시적으로 제외 |
| m4 | 불필요한 임시표 남발이 gate 밖이다(FINAL-ACCIDENTAL-ON-EVERY-NOTE core PASS). `read.accidentals_per_note.delta`는 계산만 한다 | 100음당 courtesy 임시표에 aggregate·subgroup 허용치(G4 전까지는 느슨하게) |
| m5 | robust는 독립 생성기가 아니라 같은 `perform()`의 매개변수 변형이다(§19.12) | README·CURRENT_STATE 문구 정정. 진짜 두 번째 계열(악구 rubato, 손 사이의 비동기, 종지 ritardando, 아티큘레이션 다양성)은 M11 후속과 함께 |
| m6 | fixer의 변경 전체가 미커밋이다(수정 59, 신규 68). baseline의 `recorded.git_sha`는 `b1d817b`(dirty)다 | `tests/bench`, `docs`, `.github`, `package.json`을 `git add -A`로 한 커밋에 넣는다. 부분 커밋은 CI를 깬다 |
| m7 | CI 트리거: 브랜치 push만으로는 돌지 않는다(PR이나 main에서만). nightly는 기본 브랜치에서만 돈다. GitHub에서 실행해 보지 못했다 | CURRENT_STATE 정정. PR에서 gate를 확인하고, merge 후 `workflow_dispatch`로 nightly를 한 번 돌린다 |
| m8 | 문서 불일치(§19.17) | 정정 |
| m9 | `CLAUDE.md`가 없다(요청된 읽기 대상) | 사용자 결정(§17 O1) |

#### OPTIONAL

처리 상태는 [§20.2](#202-19-findings-처리-상태)에 있다.

- o1. `exclusions.skipped_metrics.ids`를 정렬한다. references.json의 순서가 바뀌어도 byte가 같아진다.
- o2. golden이 일반 예외를 "toMusicXml threw None"으로 출력한다.
- o3. F1–F3을 고친 뒤 `final_review.py`의 mutation을 `mutation-check`에 넣어 회귀 테스트로 고정한다.
- o4. `struct.tempo.ok_written`은 `<sound tempo>`만 있고 인쇄 표시가 없는 올바른 출력에 0을 준다. 의도된 가독성 채점이지만 문서화를 권한다.

#### §18.8 요청에 대한 답

1. **fixer가 쓴 adversarial 판정 기준**: `sqi`와 `data`는 리뷰의 의도보다 약하지 않다. `sqi`는 이 세션의 독립 재계산과 일치했고, `data`는 정확히 일치를 요구한다. `oracle`의 이상적 출력 구성은 타당하다. 단 usable과 critical gate를 확인하지 않는다(m3).
2. **critical gate 임계와 "하나라도 실패하면 unusable" 규칙**: 타당하다(§19.5). 빠진 것은 음가다(m2).
3. **metrics/3의 replay 페달 정답 규칙**: 동의한다. renderer는 음만 받으므로 rendered fixture의 연주에는 페달이 없다. AMT의 추측을 정답으로 쓰면 틀린다.
4. **gate/2 허용치**: 측정하는 차원에서는 회귀를 놓치지 않았다. 새 mutation 3종이 잡혔고, usable −1.3 pt도 잡혔다. 한 gate에서 2케이스까지의 flip은 설계상 허용이다. 개선을 회귀로 부른 예는 이번에 보지 못했다(개선 방향 실험은 m1의 PredTime 외삽뿐이고, 그것은 IMPROVED 쪽이다).
5. **M11과 m11**: §19.12, m1.

### 19.19 최종 판정

**`NEEDS_FIX`**

READY_TO_MERGE 조건과 대조한 결과:

| 조건 | 결과 |
| --- | --- |
| 새 BLOCKER 없음 | 충족(benchmark 기준). merge 선행 조건 BLOCKER-M은 별도 |
| 해결되지 않은 MAJOR 없음 | **불충족**: F1–F3, M4 부분 해결 |
| M11이 BLOCKED_ACCEPTABLE | 충족 |
| 실제 품질 회귀를 의미 있게 탐지 | 부분 충족. 재는 차원(음높이, 위치, 첫 박자표·템포·조표, 손, 페달, 필요한 임시표, 마디 수)은 강하게 탐지한다(기존 17종 + 새 3종). 앱이 쓰는 MusicXML 필드 일부는 전혀 보지 않는다(새 7종 통과) |
| 기존 production 동작을 숨기지 않음 | 충족. known failure, 제외, skip이 매 실행 보인다 |
| 테스트와 재현성 | 충족. Windows·Linux byte 동일, 매트릭스 통과 |

고칠 범위는 작다. F1–F3은 reader가 이미 읽고 있는 값(`marks`, 마디별 time·key, type·dots, 마디 번호)을 metric과 semantic projection에 연결하는 일이다.

순서:
1. F2 → F3 → F1 → m1
2. m6(커밋), m8(문서)
3. 버전을 올리고 relock·재기준화·golden bless(사유 기록)
4. `final_review.py`로 확인: 놓친 7종과 우연히 잡힌 쉼표 mutation이 각자의 목표 metric으로 core REGRESSION이 되고, 적어도 golden SEMANTIC CHANGE가 되어야 한다
5. 이 절을 짧게 다시 검토

### 19.20 네 가지 질문에 대한 답

1. **main merge 가능 여부: 지금은 불가.**
   - (a) G0 브랜치에 MAJOR F1–F3이 남아 있다.
   - (b) 로컬 `main`에 `d82bb71`이 있다(저작권 `tmp/`, pyc, gitlink, 다른 세션의 카탈로그 124파일). merge하면 G0 gate가 첫 실행부터 실패하고, main을 push하면 저작권 자료가 공개된다.
   - 순서: 사용자가 `d82bb71`을 처리한다 → fixer 변경을 커밋한다(m6) → F1–F3을 고친다 → 짧게 재리뷰한다(`final_review.py`, adversarial, 매트릭스) → merge.
2. **push 후 GitHub Actions에서 반드시 확인할 것** (PR을 열어야 gate가 돈다):
   - gate job의 모든 step이 초록인지, 총 시간(로컬 합계 약 1분, 제한 20분).
   - smoke·core·robust·replay의 `results.json` sha256이 로컬과 같은지. Linux + Python 3.13 조합은 아직 확인되지 않았다. artifact의 core `results.json`으로 확인한다.
   - artifact `bench-core`에 파일 6개가 모두 있는지.
   - `npm run test:transcription-core`와 `test:arranger`가 러너의 plain Python에서 통과하는지.
   - 실패가 전파되는지: 회귀를 일부러 넣은 임시 PR 하나(예: mutant를 `audio-score.js`에 적용)로 gate가 빨개지는지 한 번 확인하고 닫는다.
   - merge 후 `workflow_dispatch`로 nightly를 한 번 돌린다: mutation-check PASS, full check PASS, adversarial GAP 0, artifact `bench-full`.
3. **G1을 시작하기 전에 할 일**: 1번의 순서 전부.
   - 특히 G1이 writer나 ScoreGraph를 바꾸는 Goal이라면 F1–F3과 m1을 **G1 전에** 고쳐야 한다. G1이 바꾸는 바로 그 필드를 benchmark가 보지 못하고, golden은 그 변경을 "형식만"이라고 부른다.
   - G1의 첫 커밋 전에 고친 benchmark로 `npm run bench`가 PASS해야 하고, baseline이 새 버전으로 기록되어 있어야 한다.
4. **M11 실제 사람 녹음의 기한**: onset 경로의 박·템포·박자 추론을 바꾸는 **첫 Goal을 시작하기 전**.
   - 해당하는 것: CURRENT_STATE 이슈 2(6/8 쏠림) 수정, 빠른 템포 ×2/×3 판정, 겹박자 판정, beat confidence 임계, onset tracker 조정. transcription이나 beat tracking을 다루는 audio Goal도 같다.
   - 그 Goal의 착수 조건:
     - `replay-public`의 `input:recorded`에 라이선스가 확인된 실제 연주가 **3곡 이상** 있다(단순 2박자, 3박자, 겹박자 각 1곡 이상).
     - 마디 시작 시각을 귀로 확인했다.
     - `update-baseline --suite replay-public`으로 기록했다.
     - 그 Goal의 보고에 이 tier의 Δ가 들어간다.
   - writer와 조판만 바꾸는 Goal은 이 조건 없이 시작할 수 있다.
   - 녹음이 들어오기 전에는 `beats:none`·`profile:human` 태그의 개선을 "실제 연주에서의 개선"으로 보고하지 않는다.

## 20. Final Fixer 기록 (2026-09-22)

§19(최종 독립 리뷰)의 F1, F2, F3, PredTime(m1), usable-음가(m2)를 처리한 최종 fixer 세션의 기록이다.

- **대상**: `D:/PPP-g0`, 브랜치 `g0-quality-foundation` @ `b1d817b` + 미커밋 변경. 시작할 때 pwd와 브랜치를 확인했다.
- **바꾼 것**: benchmark evaluator·metric·gate·golden 분류기·reader, 단위 테스트, 리뷰 스크립트, 문서, CI workflow(nightly 두 단계), baseline·lock·golden 재기록(사유 기록).
- **바꾸지 않은 것**: `audio-score.js`, `server.js`, 앱 HTML, `omr-service.js`, `catalog/`, transcription·arrangement·OMR 코드. `D:/PPP`는 읽기만 했다(`node_modules`, Audiveris 실행 파일, transcribe venv 경로). `d82bb71`은 건드리지 않았다. 커밋·merge·push·G1 없음.
- **기대값을 낮추거나 허용치를 넓힌 곳은 없다.** `adversarial.py`의 기대값은 그대로다. 허용치는 새 metric에 대해서만 새로 정했고 대부분 0이다.

### 20.0 판정

**`READY_FOR_SHORT_REVIEW`**

- F1, F2, F3, m1, m2가 해결되었고 각각 unit test와 mutation으로 고정되었다. §19의 MINOR·OPTIONAL도 m6·m9를 빼고 처리했다(§20.2).
- 새 mutation 13종을 포함한 harmful mutation 30종이 모두 자기 metric을 이름으로 대며 REGRESSION이다. §19의 mutation 10종은 10/10, 다르게 조판한 정답 검사는 4/4 OK다.
- merge 선행 조건 두 가지는 이 세션의 범위 밖이라 남아 있다. 로컬 `main`의 `d82bb71`(사용자 결정)과 미커밋 상태(커밋 금지 지시, m6)다.
- 짧은 재리뷰를 권하는 이유: 새 metric과 gate가 usable 헤드라인을 25.9 %에서 18.1 %로 바꿨다. 그 정의(특히 음가 gate와 그 합성 연주 의존성, §20.7)를 사람이 한 번 확인해야 한다.

### 20.1 방법과 환경

| 항목 | 내용 |
| --- | --- |
| 시작 점검 | `pwd` = `/d/PPP-g0`, 브랜치 `g0-quality-foundation`, `git status`: 수정 59, 미추적 70(§19의 스크립트 2개 포함). `CLAUDE.md`는 없다 |
| 앱 확인 | 워크트리 서버(8799)에서 puppeteer(`D:/PPP/node_modules`, 읽기만)로 `PPP.parseMusicXML`과 `PPP.PianoScore.of(...).tempoMap`/`msAt`을 직접 호출해 템포 모델을 확인했다(§20.3). 렌더러가 `<type>`/`<dot>`/clef를 쓰는 곳, `parseMusicXML`의 마디 번호 규칙은 코드로 확인했다 |
| 데이터 확인 | 커밋된 354개 악보의 마디 번호, 모양 불일치, 보표 채움, 곡 중간 박자·조·템포 변화, registry override를 새 metric을 넣기 전에 스캔했다(§20.4, §20.7) |
| Windows | Windows 11(cp949), Python 3.13.5, Node 24.17.0 |
| Linux | Docker `node:24-bookworm`(Python 3.11.2, Node 24.21.0), `--network none`. 최종 워크트리 스냅숏을 LF로 clone해 CI gate job 전체와 nightly(mutation-check, full, adversarial, final_review, final_oracle)를 실행했다 |
| T1 | 워크트리 서버 8777 + 워크트리 helper에 `PPP_AUDIVERIS`로 `D:/PPP`의 Audiveris 실행 파일을 지정했다(읽기만, OMR 작업 파일은 OS temp). parser parity, omr-live, `npm test`(`NODE_PATH=D:/PPP/node_modules`). 끝나고 모두 종료했다 |

### 20.2 §19 findings 처리 상태

| finding | 상태 | 근거 |
| --- | --- | --- |
| BLOCKER-M (로컬 `main` `d82bb71`) | **BLOCKED_NOT_ACCEPTABLE** (merge 전) | 이 세션의 범위 밖이다("d82bb71 정리는 이번 세션 범위가 아니다"). G0 브랜치 자체의 결함은 아니지만, 그대로 merge하면 첫 CI가 실패하고 main을 push하면 저작권 자료가 공개된다(§19.18). 사용자가 처리한 뒤 merge한다 |
| F1 템포·박자표·조표를 첫 값으로만 채점 | **RESOLVED** | §20.3 |
| F2 음표 모양·마디 번호를 읽지 않음 | **RESOLVED** | §20.4 |
| F3 golden이 앱이 그리는 필드를 "형식"으로 분류 | **RESOLVED** | §20.5 |
| §17 M4 (§19에서 PARTIALLY_RESOLVED) | **RESOLVED** (범위 명시) | §19가 나열한 차원(음표 모양, 마디 번호, 두 번째 이후 템포·박자표·조표, clef, 쉼표 길이, 불필요한 임시표)이 모두 metric과 gate로 들어갔다. voice·beam·stem은 metric이 없다. golden은 voice 구조 변화를 STRUCTURAL_CHANGE로 잡는다. G4 범위로 문서화했다 |
| m1 PredTime 균등 박 가정 | **RESOLVED** | §20.6 |
| m2 usable이 음가를 보지 않음 | **RESOLVED** | §20.7 |
| m3 oracle이 usable·critical을 확인하지 않음 | **RESOLVED** | `final_oracle.py`가 critical gate, usable, 새 metric 전부를 확인한다. 참조 파일 자체에 결함이 있으면, 그 결함이 설명하는 metric에서만 만점 미달을 허용한다(`EXPLAINS`). 4 OK. `adversarial.py`의 oracle은 바꾸지 않았다 |
| m4 불필요한 임시표 | **RESOLVED** | `notation.accidentals.courtesy_per_100`(↓, aggregate 허용치 0.5). FIN-ACCIDENTAL-ON-EVERY-NOTE는 REGRESSION이다 |
| m5 robust는 독립 생성기가 아님 | **RESOLVED** (문서) | README·CURRENT_STATE에서 "같은 연주기의 매개변수 변형"으로 정정했다. 독립 계열은 M11 후속 |
| m6 fixer 변경 미커밋 | **BLOCKED_ACCEPTABLE** | 이 세션은 커밋이 금지되어 있다. 사용자의 다음 단계: `git add -A tests/bench docs .github package.json` 한 번. 부분 커밋은 CI를 깬다(새 모듈, golden `.semantic/.timing`, correctness fixture, robust suite가 미추적이다) |
| m7 CI 트리거 문구, GitHub 미실행 | **RESOLVED** (문서) / 실행은 BLOCKED_ACCEPTABLE | CURRENT_STATE·README 정정(PR 또는 main push에서 gate, schedule은 기본 브랜치). GitHub 실행은 push 금지로 미검증(§20.14) |
| m8 문서 불일치 | **RESOLVED** | "16 planted" → 30, `tests/README.md`의 smoke 44·test:bench 설명, `suites/golden.json` 설명, G00 목차, §18.3 m11 주장(§20.6) |
| m9 `CLAUDE.md` 없음 | **REJECTED** | 저장소 세션 지침은 사용자가 정한다(§17 O1과 같음) |
| o1 `skipped_metrics.ids` 순서 | **RESOLVED** | 정렬한다(`runner.exclusions_summary`) |
| o2 golden "threw None" | **RESOLVED** | "threw an exception"으로 표시 |
| o3 final_review mutation을 mutation-check에 | **RESOLVED** | FIN-* 13종(§20.8) |
| o4 `ok_written`의 의미 | **RESOLVED** (문서) | README metric 표에 적었다 |
| M11 실제 사람 연주 | **BLOCKED_ACCEPTABLE** | §20.13. 가짜 녹음은 만들지 않았다 |

### 20.3 F1: 곡 전체의 템포·박자표·조표

- **앱을 먼저 확인했다.** 워크트리 서버에서 `PPP.PianoScore.of(score).tempoMap`을 직접 읽었다.
  - 재생은 `tempoMap`/`msAt`이 모든 템포 표시를 따른다. 가운데부터 절반 속도로 바꾼 mutant는 둘째 절반을 1.25 s/4분음표(48 qpm)로 재생했다.
  - 같은 위치에서는 나중에 읽힌 표시가 이긴다. direction 안에서 metronome이 `<sound>` 뒤다.
  - 그래서 SUT의 6/8 출력(`<sound tempo="60">` + 점4분 = 60)은 **재생 90 qpm(맞음)**, `Score.tempo` 60(연습 템포·메트로놈·템포 %, 2/3)이다. CURRENT_STATE 이슈 1의 "2/3 속도로 재생"은 `Score.tempo`에만 맞는 말이었다. 정정했다.
- **metric** (`metrics/structure.py`, 예측 MusicXML에서만 읽고 stats는 쓰지 않는다). 짝지어진 음마다 판정한다:
  - `struct.tempo.timeline_accuracy`: 앱 재생기의 템포 맵(`app_tempo_timeline`: 모든 표시, 같은 위치는 나중 것, 첫 표시 전은 `Score.tempo`)이 그 음에서 연주 템포(연주기의 템포 맵, rubato drift 제외)의 ±4 % 안인 비율.
  - `struct.time_sig.timeline_accuracy`: 그 음이 있는 예측 마디의 박자표가 정답 마디의 것과 같은 비율.
  - `struct.key.timeline_accuracy`: 조표에 대해 같은 것. registry가 조를 믿지 않는 곡(`skip_metrics`)에서는 함께 빠진다(`evaluate.SKIP_WITH`).
  - registry override(`expect.time`/`key`)는 정답에 박자·조가 하나뿐일 때만 모든 마디에 적용한다.
- **gate**:
  - `critical.meter` = 첫 박자표 정확 **그리고** sequence ≥ 0.95.
  - `critical.playback_tempo` = `Score.tempo` ±4 % **그리고** 재생 sequence ≥ 0.95.
  - `critical.key` = 첫 조표 **그리고** sequence ≥ 0.95.
  - 0.95 = "음 20개 중 1개까지": 변화 표시가 한 마디 안팎 어긋난 정도(`critical.SEQUENCE_MIN`, 이유는 코드와 README에 있다).
  - aggregate 허용치 −0.005, subgroup 평균, micro guard.
- **증거**:
  - FIN-TEMPO-HALVED-MIDWAY → `struct.tempo.timeline_accuracy`, `critical.playback_tempo` REGRESSION.
  - FIN-METRE-TAIL → `struct.time_sig.timeline_accuracy`, `critical.meter`.
  - FIN-KEY-TAIL(임시표로 음높이는 맞춘 판) → `struct.key.timeline_accuracy`, `critical.key`.
  - unit `WholeScoreSequences` 7개.
- **baseline에서 바뀐 판정은 모두 실제다.**
  - 이전에는 템포가 맞다고 채점되던 6케이스가 틀렸다(sonatina/002 ×3, hanon/007, 찬송가 2곡): SUT가 박자를 겹박자로 잘못 읽어 `<sound tempo>`가 우연히 맞지만, 재생기는 점4분 표시를 따라 1.5배로 재생한다(모두 이미 meter 실패라 usable은 그대로).
  - burgmuller25/015(C → E♭ 전조)는 SUT가 조표 하나만 써서 음의 27 %가 틀린 조표 아래 읽힌다.
  - micro M22(120 → 80)는 SUT가 평균 템포 하나를 써서 모든 음이 틀린 템포다.

### 20.4 F2: 음표 모양·마디 번호·쉼표·clef

앱이 읽는 방식 그대로 읽는다. reader/3이 clef, 앱이 쓰는 마디 번호(`parseInt` 또는 순번), 쉼표의 type·dots·tuplet을 읽는다.

| metric | 무엇 | gate |
| --- | --- | --- |
| `notation.note_shape.consistency` | 음표·쉼표의 인쇄 모양(type — 없으면 앱의 `typeFromQ` —, dots, tuplet)이 길이와 맞는 비율. 마디 전체 온쉼표는 예외 | aggregate 허용치 0, micro guard |
| `notation.duration.page_accuracy` | 페이지가 보여 주는 음가(묶인 조각들의 모양 합)가 음악의 음가와 같은 음의 비율 | `critical.note_values`(§20.7) |
| `struct.measure_numbers.valid` | 마디 번호가 0 또는 1부터 1씩 증가(반복·건너뜀·순서 바뀜 = 0). 커밋된 354개 악보가 모두 그렇다 | `critical.structure` |
| `struct.measure_numbers.app_onset_accuracy` | 앱이 번호로 마디를 찾아 음을 놓는 위치(`CanonicalScore.app_bar_starts`: 같은 번호는 한 자리)가 MusicXML의 위치와 같은 음의 비율 | `critical.structure` |
| `read.bar_completeness` | 모든 보표가 마디를 채우는가(첫·끝 마디, implicit, 반복에서 나뉜 두 반 마디는 예외) | `critical.structure` |
| `read.ledger_lines.heavy_rate` ↓ | clef에서 덧줄 4개 이상이 필요한 음의 비율(앱 규칙: F=bass, C=alto, 그 밖=treble, 기본 1보표 treble·2보표 bass) | aggregate 허용치 0.005 |

- **증거**:
  - FIN-DOTS-DROPPED, FIN-NOTE-TYPE-SHORTER, FIN-REST-TYPE-LONGER → `note_shape.consistency`.
  - FIN-BAR-NUMBERS-RESTART → `app_onset_accuracy`.
  - FIN-BAR-NUMBERS-SKIP/-SWAP → `measure_numbers.valid`.
  - FIN-TRAILING-RESTS-SHORT → `bar_completeness`.
  - FIN-BASS-STAFF-TREBLE-CLEF → `ledger_lines.heavy_rate`.
  - unit `NoteShapesBarsAndNumbers` 7개.
- **parser parity** (`node/conformance.js`, `tiers.compare_projection`)가 마디 번호, 음표·쉼표 모양(type, dots, 쉼표 tuplet)까지 비교한다. 258/258이다.
  - 점을 무시하는 reader는 89/258, 마디를 순번으로 매기는 reader는 254/258로 잡힌다(pickup이 0번인 4곡).
- **known failure 3종 추가**(`known-defects/2`):
  - `note_shape_mismatch` 4파일·8개: Für Elise 2마디(4분음표가 점8분으로 그려짐), 찬송가 2곡의 6박 온음표(점 없음), burgmuller25/019.
  - `incomplete_bars` 10파일·38마디.
  - `bar_numbering` 0.
- **SUT에서 새로 드러난 결함**(이슈 19): 셋잇단 안의 쉼표를 `<time-modification>` 없이 4분쉼표로, 1틱 쉼표를 64분쉼표로 쓴다. core 107케이스에 하나 이상 있다(consistency 0.991).

### 20.5 F3: golden 분류

- **projection** (`semantic.py`, schema `ppp.bench-semantic/2`)을 둘로 나눴다:
  - **structure**: 마디(앱 번호, 길이, implicit), 보표 수, clef, 각 음표·쉼표의 보표와 voice 자리(voice 번호는 마디·보표마다 등장 순서로 다시 매겨 형식으로 둔다).
  - **music**: 마디별 박자·조, 템포 표시, 음표(위치, 길이, 음높이, 철자, type, dots, tie, tuplet, 임시표), 쉼표(위치, 길이, type, dots, tuplet), 페달.
- **라벨**: `STRUCTURAL_CHANGE` > `SEMANTIC_CHANGE` > `SERIALIZATION_ONLY`(구조·음악·stats·마디 시각이 모두 같을 때만). 음높이만 바뀐 경우는 구조 변화로 올라가지 않는다(같은 음이 다른 보표·voice로 옮긴 경우만 구조).
- 저장된 snapshot의 schema가 다르면 `FAIL`로 알리고, bless 로그는 "MusicXML bytes unchanged"를 케이스마다 적는다. 17개 모두 bytes unchanged로 재bless했다.
- **증거**(unit `GoldenClassification`, G15 입력):
  - 서식·voice 번호 → SERIALIZATION_ONLY.
  - 점 제거, type 변경, 쉼표 type 변경 → SEMANTIC_CHANGE.
  - clef 교체, 마디 번호 중복, 왼손 음 하나를 오른손 보표로 → STRUCTURAL_CHANGE.
  - final_review mutation 10종 중 어느 것도 SERIALIZATION_ONLY가 아니다.

### 20.6 PredTime (§19 m1)

- **원인**: 예측 쪽 시간 모델이 SUT와 달랐다.
  - SUT는 박을 악보에서 등간격으로 두고, 박 사이를 시간에 대해 선형으로, 첫·끝 박 바깥은 그 간격으로 외삽한다(`tickToSec`).
  - reader/2의 PredTime은 추적된 박 중 마디 안에 든 것만 마디에 고르게 폈다. 그래서 첫 박보다 앞서 시작하는 마디(꽉 찬 첫 마디로 쓴 pickup)나 끝 박 뒤로 이어지는 마디에서는 박이 모자라 음이 최대 한 박 늦게 놓였다.
  - 정답 쪽(연주기의 TimeMap)에는 이런 비대칭이 없다.
- **수정** (`timemap.PredTime`, `extend_beats`): 박 격자를 SUT처럼 barStarts 범위까지 외삽한다. 마디 시작·끝을 박 좌표로 옮기고, 위치를 박 좌표에서 보간해 시간으로 되돌린다. 마디선이 박 사이에 있어도(위상) 정확하다.
- **효과**: identity F1 0.9812 → 0.9832, `critical.pitch_integrity` 2케이스 추가 통과. 리뷰가 측정한 43케이스의 변화와 같은 방향·크기다.
- **고정**:
  - unit `PredTimeFollowsTheSutBeatModel` 4개: 첫 박 전의 꽉 찬 첫 마디, 박 사이의 마디선, `extend_beats`, golden G05의 pickup 음이 자기 박(1.75 s)에 놓임.
  - `final_oracle.py`의 pickup-bar 변형이 만점이다(리뷰 때는 5곡 identity 0.98).
- §18.3의 "BLOCKED, 지금 수치에 영향 없음"은 사실이 아니었다. SUT 변경 없이 benchmark 안에서 고쳤다.

### 20.7 Usable: 음가

- **gate** `critical.note_values`: 짝지어진 음의 80 % 이상이 음악의 음가를 가져야 한다. **재생되는 대로**(`notation.duration.accuracy`, `<duration>`)와 **보이는 대로**(`notation.duration.page_accuracy`, 인쇄 모양) 둘 다다.
- **근거**:
  - 위치(0.90)보다 느슨하다. 음가가 틀려도 음은 연주되는 자리에 있기 때문이다.
  - 5개 중 1개를 넘으면 대부분의 마디가 음악과 다른 리듬을 보여 주거나 재생한다. 이것이 "심각하게 틀린" 상태다.
  - hands gate와 같은 1/5 수준이다.
  - 다른 임계로 baseline을 비교하지 않았다. 원칙에서 정하고 그 효과를 보고한다.
- **처음 설계와 바꾼 점**: "모든 모양이 길이와 맞아야 한다(1.0)"는 usable 판정에서 뺐다. SUT가 셋잇단 쉼표 하나를 잘못 써도 곡 전체가 unusable이 되어 다른 gate보다 훨씬 엄격했기 때문이다. 대신 독자가 실제로 읽는 음가(모양)를 같은 80 % 규칙에 넣었다. 모양 불일치 자체는 허용치 0의 회귀 metric으로 남았다.
- **효과**:
  - core usable 25.9 % → 18.1 %. 음가 gate 통과 49.4 %.
  - czerny599/049 human/onset(리뷰의 표본, 음가 0.19)은 이제 unusable이다. unit `UsableNeedsTheRightNoteValues`.
- **중요한 관찰**: 음가 gate의 통과율은 합성 연주기의 릴리스 모델에 크게 좌우된다.
  - deadpan(40 ms 일찍 뗌) 72 %, human(20–80 ms) 51 %, human-alt(30–120 ms) 18 %, AMT(릴리스 ±15 % 잡음) 5 %.
  - robust usable은 6.0 %다(음가 gate 없이는 28.4 %).
  - SUT가 키를 뗀 시각을 음가로 적기 때문이다(이슈 18). 사용자에게는 실제로 틀린 악보다.
  - 그러나 이 릴리스 모델들은 실제 연주로 검증되지 않았다. 그래서 M11의 trigger에 "음가(릴리스) 추론을 바꾸는 Goal"을 넣었다(§20.13).

### 20.8 새 adversarial mutation (`mutation-check`에 편입, 총 30 + no-op)

| id | 범주 | 잡는 metric |
| --- | --- | --- |
| FIN-TEMPO-HALVED-MIDWAY | 곡 중간 템포 | `struct.tempo.timeline_accuracy`, `critical.playback_tempo` |
| FIN-METRE-TAIL | 후반 박자표 | `struct.time_sig.timeline_accuracy`, `critical.meter` |
| FIN-KEY-TAIL | 후반 조표(임시표는 맞춤) | `struct.key.timeline_accuracy`, `critical.key` |
| FIN-DOTS-DROPPED | 점 제거 | `notation.note_shape.consistency`, `notation.duration.page_accuracy` |
| FIN-NOTE-TYPE-SHORTER | type 변경 | 같은 둘 |
| FIN-LONG-NOTES-HALVED | 음가(길이) 변형 | `notation.duration.accuracy`, `critical.note_values` |
| FIN-BAR-NUMBERS-RESTART | 마디 번호 반복 | `struct.measure_numbers.app_onset_accuracy`, `critical.structure` |
| FIN-BAR-NUMBERS-SKIP | 마디 번호 건너뜀 | `struct.measure_numbers.valid` |
| FIN-BAR-NUMBERS-SWAP | 마디 번호 순서 바뀜 | `struct.measure_numbers.valid` |
| FIN-BASS-STAFF-TREBLE-CLEF | clef·보표 | `read.ledger_lines.heavy_rate` |
| FIN-TRAILING-RESTS-SHORT | 쉼표 길이 | `read.bar_completeness`, `critical.structure` |
| FIN-REST-TYPE-LONGER | 쉼표 모양 | `notation.note_shape.consistency` |
| FIN-ACCIDENTAL-ON-EVERY-NOTE | 표기 가독성 | `notation.accidentals.courtesy_per_100` |

`mutation-check`: **31/31** — harmful 30종이 모두 REGRESSION이고 각자 기대한 metric을 이름으로 대며, no-op은 `results.json`이 byte 동일하다. Windows 194 s(다른 작업과 동시), Linux 186 s.

`final_review.py`(리뷰가 쓴 10종, 이제 목표 metric을 요구하고 exit 1): **10/10** — 모두 core REGRESSION이고 각자 목표 metric을 이름으로 댄다.

| mutation | core | smoke | robust | replay | golden |
| --- | --- | --- | --- | --- | --- |
| FINAL-DOTS-DROPPED | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 9 SEMANTIC_CHANGE, 8 ok |
| FINAL-TEMPO-HALVED-MIDWAY | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 17 SEMANTIC_CHANGE |
| FINAL-METRE-TAIL | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 17 SEMANTIC_CHANGE |
| FINAL-KEY-TAIL | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 17 SEMANTIC_CHANGE |
| FINAL-BASS-STAFF-TREBLE-CLEF | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 17 STRUCTURAL_CHANGE |
| FINAL-BAR-NUMBERS-RESTART | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 15 STRUCTURAL_CHANGE, 2 ok (4마디 이하) |
| FINAL-ACCIDENTAL-ON-EVERY-NOTE | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 17 SEMANTIC_CHANGE |
| FINAL-TRAILING-RESTS-SHORT | REGRESSION | REGRESSION | REGRESSION | REGRESSION | 7 SEMANTIC_CHANGE, 10 ok |
| FINAL-PEDAL-HELD-TO-BARLINE | REGRESSION | PASS | PASS | PASS | 1 SEMANTIC_CHANGE, 16 ok |
| FINAL-TOP-REGISTER-OCTAVE-DOWN | REGRESSION | PASS | REGRESSION | PASS | 17 ok |

- 리뷰 때 SERIALIZATION-ONLY였던 점·clef·마디 번호·쉼표 mutant는 이제 SEMANTIC_CHANGE 또는 STRUCTURAL_CHANGE다.
- 마지막 두 행의 PASS:
  - 페달: robust와 replay에는 페달 연주가 없다. smoke에는 페달 케이스 4개가 있지만, 합성 페달 연주기가 원래 마디선 20 ms 앞에서 페달을 떼므로 해제를 마디 끝으로 옮겨도 거의 변하지 않는다. 그 변화는 smoke의 ×4 허용치 안이다. core는 micro guard와 거짓 페달률로 잡는다.
  - A6 이상: smoke와 replay에는 그 음역이 없다.
  - golden `ok`도 같은 이유다(그 입력에서 출력이 바뀌지 않는다).

### 20.9 이번 세션이 찾은 추가 결함 (모두 수정)

1. **내가 만든 쉼표 모양 metric이 셋잇단 쉼표를 오판했다.** 캐논 `Rest`가 `<time-modification>`을 담지 않아 burgmuller25/007 같은 파일의 셋잇단 8분쉼표(1/3박)를 "길이와 다른 모양"으로 셌다(처음 감사 10파일·77개). `Rest.tuplet`을 추가했고 4파일·8개가 되었다. 이는 첫 raw-XML 스캔의 결과와 같다. baseline 기록 전에 고쳤다.
2. **replay-public·omr-live가 반올림 안 된 결과를 6자리 baseline과 비교했다.** synthetic runner는 JSON을 한 번 거쳐 비교하지만 `private.run_private`와 `tiers.omr_live`는 그러지 않았다. 허용치 0인 metric에서 1e-7의 반올림 잔차가 회귀가 될 수 있었다(실제로는 "+0.000000 improvement"로 드러났다). 두 경로 모두 고쳤다. unit `FixtureSuitesCompareWhatTheyWrite`.
3. **앱 템포 모델**(§20.3): 이슈 1의 서술을 정정했다.
4. **내 oracle 스크립트의 구성 오류 두 개**: 타입 없는 쉼표와 모든 템포 표시 제거. 벤치마크가 옳게 잡은 것을 확인하고 구성을 고쳤다.

### 20.10 수치 (baseline: metrics/4, reader/3, gate/3, sqi/2; audio-score.js `559a1f40…`)

| suite | 케이스 | usable | 진단점수 | 비고 |
| --- | --- | --- | --- | --- |
| smoke | 44 | 38.6 % | 86.91 | |
| core | 553 | **18.1 %** | 76.86 | 진단점수 평균 이상인데 unusable 199 |
| robust | 282 | 6.0 % | 76.55 | 음가 gate 17.7 % (§20.7) |
| full | 4,144 + hold-out 832 | 18.0 % (hold-out 23.2 %) | 78.60 (hold-out 76.55) | |
| replay-public | 6 | 16.7 % | 85.55 | |
| omr-live | 4 | 0 % | 53.32 | |

core critical gate:

| gate | 통과율 | 적용 | 실패 |
| --- | --- | --- | --- |
| meter | 57.7 % | 553 | 234 |
| playback_tempo | 52.8 % | 553 | 261 |
| beat_placement | 45.2 % | 553 | 303 |
| note_values (신규) | 49.4 % | 553 | 280 |
| pitch_integrity | 92.8 % | 553 | 40 |
| key | 88.6 % | 405 | 46 |
| hands | 81.6 % | 553 | 102 |
| structure | 100 % | 553 | 0 |
| accidentals | 100 % | 553 | 0 |
| pedal | 96.7 % | 30 | 1 |

새 metric(core 평균):
- sequence: 박자 0.577, 조 0.892, 재생 템포 0.807(`Score.tempo` 0.539)
- 음가: 0.739, 페이지 음가 0.739
- 모양 일치 0.991
- 마디 완결 1.000, 마디 번호 1.000 / 1.000
- 덧줄 4개 이상 0.008, courtesy 임시표 0.0/100음
- identity F1 0.983

known failure(`known-defects/2`, 329파일):
- key_signature_playback 92파일·6,119음, tie_without_stop 16·121, bar_accidental_not_carried 10·18, octave_shift_playback 30·2,229, bar_integrity 24·88마디, tempo_marks_disagree 4, grace_notes_dropped 17·244(KNOWN_LIMITATION)
- 신규: note_shape_mismatch 4·8, incomplete_bars 10·38마디, bar_numbering 0
- 제외는 39(L8 24, P1 15). 격리 15는 그대로다.

§18.5와의 차이는 버전(metrics/3 → /4, reader/2 → /3)과 정의 때문이다. baseline history에 전환이 기록되어 있다. 입력(lock의 case별 sha)은 바뀌지 않았다. relock은 reader 버전 필드뿐이다.

### 20.11 결정론과 성능

| 조건 | smoke | core | robust | replay-public | full |
| --- | --- | --- | --- | --- | --- |
| Windows | `a837acbe…` | `289c51d2…` | `a1d9364f…` | `cf590f1f…` | `aae27ccf…` |
| Windows, 다른 cwd(`tests/bench/unit`) | | `289c51d2…` | | | |
| Windows, listdir·glob·git 목록·suite 참조 역순 | `a837acbe…` | `289c51d2…` | | | |
| Linux Docker offline, LF clone, `/w` | `a837acbe…` | `289c51d2…` | `a1d9364f…` | `cf590f1f…` | `aae27ccf…` |

- 시간과 환경은 `run.json`에만 있다.
- 코드·데이터에 로컬 절대 경로가 없다. grep 결과는 문서의 예시 경로뿐이다.
- 실행 시간(Windows): smoke 0.9 s, core 16 s(다른 cwd, 부하 중 20 s), robust 8.7 s, full 131–175 s(부하에 따라), mutation-check 194 s(30+1 변형), final_review 286 s, adversarial 268 s, final_oracle 약 5 s, unit 12 s.

### 20.12 완료 검증

| # | 항목 | Windows | Linux (Docker) |
| --- | --- | --- | --- |
| 1 | final_review | 10/10 OK | 10/10 (285 s) |
| 2 | final_oracle | 4 OK, 0 GAP | 4 OK (9 s) |
| 3 | adversarial | 25 OK, 0 GAP (268 s). `--only lock --conformance` 4 OK | 25 OK, 0 GAP (255 s) |
| 4 | mutation-check | 31/31 | 31/31 (186 s) |
| 5 | smoke / core / robust | run + check PASS | run + check PASS (20 s / 11 s) |
| 6 | full | run + check PASS (4,976) | run + check PASS (181 s) |
| 7 | golden | 17/17 identical | 17/17 |
| 8 | correctness | 13/13 | 13/13 |
| 9 | parser parity (T1) | 258/258. 점을 무시하는 reader 89/258, 마디를 순번으로 매기는 reader 254/258 | – (서버·네트워크 필요) |
| 10 | omr-live (T1) | PASS, 4케이스, 47.7 s | – (Audiveris 필요) |
| 11 | unit | 179 OK | 179 OK |
| 12 | transcription-core | 16 OK | 16 OK (plain Python) |
| 13 | arranger | 3 OK | 3 OK |
| 14 | `npm test` | 26/26 suite, 확인 1,041개, 실패 0. "recording → score through the UI"만 transcriber가 없어 스스로 SKIPPED | – |
| 15 | `py_compile` | 63/63 (bench `.py` + `beat_track_test.py`) | |
| 16 | `node --check` | 3/3 (`node/*.js`) | |
| 17 | lint / provenance | 0 error / 일치 | 0 error / 일치; 업로드 artifact 11개 경로 모두 생성, 실행 뒤 추적 파일 변경 0, 로컬 절대 경로 grep 0 |
| 18 | 범위 | `git diff 663d463`에서 프로덕션 파일 변경 0. `tests/bench`·`docs` 밖은 workflow(nightly 2단계 추가), `package.json` scripts, `.gitignore`, README 3개, `beat_track_test.py`뿐 | |
| 19 | 로컬 절대 경로 의존 | 없음(코드·suite·baseline·fixture) | clone 경로 `/w`에서 동일 결과 |
| 20 | record-replay (T2) | 실행 안 함: 실제 녹음, GPU, 새 데이터가 필요하다 | |

### 20.13 M11: 실제 사람 연주

**BLOCKED_ACCEPTABLE.** 가짜 "실제 녹음"은 만들지 않았다. `replay-public`의 `input:recorded`는 비어 있다.

**trigger 조건**(README, CURRENT_STATE에도 같은 문구가 있다): onset·beat·tempo·meter 추론 production logic을 바꾸는 첫 Goal을 시작하기 전에, 라이선스가 확인된 실제 사람 연주 **최소 3곡**(단순 2박, 3박, 겹박자)을 귀로 확인한 마디 시작과 함께 녹음해 baseline에 넣어야 한다.

이번 세션의 증거(§20.7)에 따라 **키 릴리스를 음가로 바꾸는 규칙을 바꾸는 Goal에도** 같은 조건을 건다. writer·ScoreGraph·engraving만 바꾸는 Goal에는 M11이 G0 merge를 막지 않는다.

### 20.14 남은 것

- 로컬 `main`의 `d82bb71` 처리(사용자). 미커밋 변경의 커밋(사용자, 한 커밋).
- GitHub Actions에서의 첫 실행은 미검증이다(push 금지). 확인할 것은 §19.20 ②에 더해 다음이다:
  - nightly의 `final_review.py`와 `final_oracle.py`가 exit 0이다.
  - Linux + Python 3.13에서 results sha가 이 절의 값과 같다.
- voice·beam·stem은 metric이 없다(G4). 음가 판정은 합성 릴리스 모델에 의존한다(M11).
- `adversarial.py`의 oracle은 SQI 구성 metric만 본다(원래대로 두었다). 더 강한 검사는 `final_oracle.py`에 있다.

### 20.15 결론

**`READY_FOR_SHORT_REVIEW`**

- §19가 요구한 F1·F2·F3·PredTime·usable-음가를 benchmark 안에서 고쳤다. 새 mutation 13종과 unit test 26개로 고정했다.
- 앱이 그리거나 재생하는 MusicXML 필드 가운데 리뷰가 찾은 것은 이제 모두 metric이 읽는다: 음표·쉼표 모양, 마디 번호, 곡 전체의 템포·박자표·조표, clef, 쉼표 길이, 불필요한 임시표. golden은 이런 변화를 형식으로 부르지 않는다.
- 헤드라인은 더 정직해졌다(core usable 25.9 % → 18.1 %). 음가 gate가 합성 연주의 릴리스 모델에 민감하다는 사실은 문서와 M11 trigger에 반영했다.
- 남은 merge 선행 조건은 이 세션의 권한 밖이다: 로컬 `main`의 `d82bb71`, 한 번의 커밋.
- 짧은 재리뷰에서 볼 것:
  1. 음가 gate의 임계(0.80)와 그 합성 연주 의존성(§20.7)
  2. sequence 임계(0.95)
  3. golden 구조/음악 분류 규칙(§20.5)
  4. 새 known failure 두 종의 규칙(split bar 예외)

---

## 21. Short Final Review (2026-09-22)

§17–§20에 참여하지 않은 짧은 최종 리뷰 세션이 썼다. 질문은 하나다: **"G0 benchmark를 G1 이후의 품질 심판으로 써도 되는가?"** 전체를 다시 설계하지 않고, 최종 fixer가 고친 것(F1, F2, F3, PredTime, usable 음가)과 새로운 merge-blocking 구멍만 확인했다. §20의 "RESOLVED"는 출발점으로만 썼다. 아래 판정은 모두 이 세션이 직접 실행하거나 코드·데이터·앱으로 확인한 것이다.

- **대상**: `D:/PPP-g0`, 브랜치 `g0-quality-foundation` @ `6eae767`(이 세션이 최종 fixer의 미커밋 작업을 고정한 커밋, §21.1).
- **이 세션이 바꾼 것**: 이 절, 문서 머리의 상태 줄과 목차, 새 review 전용 스크립트 `tests/bench/review/short_review.py`.
- **바꾸지 않은 것**: 프로덕션 코드, benchmark 기준·허용치·임계(0.95, 0.80)·baseline·golden, 기존 review 스크립트의 기대값. `D:/PPP`는 읽기만 했다(`node_modules`의 puppeteer). `d82bb71`, main, G1은 건드리지 않았다.

### 21.0 판정

**`NEEDS_FIX`** — BLOCKER 0, **MAJOR 2**, MINOR 2, OPTIONAL 5.

- F1·PredTime·usable 음가는 확인되었다. mutation-check 31/31, final_review 10/10, adversarial 25/0, final_oracle 4 OK, 결정론(core `289c51d2…`), production diff 0도 재현했다.
- 그러나 새 공격 두 개가 "사용자에게는 명백히 망가진 악보인데 benchmark는 PASS"를 만들었다(§21.8).
  - **S-M1** 앱이 재생 순서를 바꾸는 반복 기호를 benchmark가 전혀 읽지 않는다. core·smoke·robust의 `results.json`이 byte 단위로 같고, golden은 **SERIALIZATION_ONLY**로 분류한다.
  - **S-M2** 예측이 `implicit="yes"`를 달면 스스로 불완전 마디 검사를 끈다. §17 B1과 같은 종류(예측이 검사 적용 여부를 정함)다.
- 둘 다 G1(writer 재구성)이 새로 쓸 수 있는 필드다. 고칠 범위는 작다(§21.14).

### 21.1 방법, 환경, Git

| 항목 | 내용 |
| --- | --- |
| 시작 점검 | `pwd` = `/d/PPP-g0`, toplevel `D:/PPP-g0`, 브랜치 `g0-quality-foundation`. 미커밋 수정 64, 미추적 신규(펼쳐서) 68 |
| Fixer 커밋 | 허용 경로(`tests/bench/`, `docs/`, `.github/`, `package.json`)만 stage했다. staged 132파일을 경로 규칙과 금지 패턴(pycache, catalog, tmp, 프로덕션 파일)으로 검사해 0건을 확인하고 `6eae767 fix: finalize G0 benchmark semantic quality gates`로 커밋했다. 가장 큰 파일은 baseline JSON과 golden semantic snapshot이다 |
| 남긴 것 | `tests/README.md`(문서 2줄: smoke 44, test:bench 설명). 허용 경로 밖이라 stage하지 않았다. 미커밋으로 남아 있다(사용자 결정) |
| `CLAUDE.md` | 두 worktree 어디에도 없다(§17 O1, §19 m9와 같음) |
| 환경 | Windows 11(cp949), Python 3.13.5, Node 24. T1은 워크트리 서버를 8799에 잠시 띄우고 끝나고 종료했다. puppeteer는 `D:/PPP/node_modules`(읽기만) |
| 앱 확인 | `Piano Coach App.dc.html`의 `parseMusicXML`(마디·implicit·barline·tie·tuplet·clef·손), `Score.form`, `PianoScore.build`, 렌더러의 tuplet·반복 barline 처리를 코드로 읽었다. S-M1과 S-m1은 워크트리 서버의 앱에서 `PPP.parseMusicXML`/`PPP.PianoScore.of`로 직접 재현했다 |

### 21.2 F1 — 곡 전체 템포·박자표·조표: **VERIFIED**

- **전체 timeline을 읽는다.** reader는 모든 `<sound tempo>`(direction 안과 마디 직속)와 metronome을 위치와 함께 읽고(`musicxml.py` 276–305), 마디별 time·fifths를 part 0에서 기록한다. `struct.*.timeline_accuracy`는 짝지어진 음마다 예측 마디의 time·fifths와 앱 템포 맵(`app_tempo_timeline`, 같은 위치는 나중 것)을 정답과 비교한다. stats는 쓰지 않는다.
- **mutation**(이 세션 실행): FIN-TEMPO-HALVED-MIDWAY(`critical.playback_tempo` 0.497 → 0), FIN-METRE-TAIL(`critical.meter` 0.515 → 0), FIN-KEY-TAIL(`critical.key` 0.898 → 0) 모두 REGRESSION이다. 새 SR-KEY-LAST-TWO-BARS(마지막 두 마디만)도 core REGRESSION, usable −7.2 pt다.
- **임계 0.95**: 적절하다.
  - 너무 관대하지 않다: 마지막 두 마디의 손상도 잡힌다(짧은 곡에서는 5 %를 넘고, aggregate 허용치 −0.005가 나머지를 잡는다).
  - 너무 엄격하지 않다: 이상적 출력 4가지 조판(final_oracle)에서 만점이다. 16마디 곡에서는 변화 표시가 한 마디만 어긋나도 실패하지만, 그것은 한 마디가 틀린 조·박자·템포로 읽힌다는 뜻이다(O2).
- **인쇄 템포 sequence**: 곡 중간의 인쇄 메트로놈은 판정하지 않는다. 앱이 그것을 그리지 않고(`score.tempos`는 `tempoMap`에만 쓰인다) 재생은 판정되므로 구멍이 아니다. SR-PRINTED-TEMPO-MIDWAY(대조군)는 PASS이고 golden SEMANTIC_CHANGE다(O3).

### 21.3 F2 — 음가·구조: **PARTIALLY VERIFIED** (S-M1, S-M2)

요청된 항목은 모두 읽고 있고, 요청된 harmful mutation은 모두 잡힌다.

| 항목 | 근거 |
| --- | --- |
| `<type>`, `<dot>`, tuplet, 인쇄 음가 | `note_shape.consistency`(허용치 0), `duration.page_accuracy`. FIN-DOTS-DROPPED, FIN-NOTE-TYPE-SHORTER REGRESSION. 앱은 tuplet을 `<time-modification>`으로 그리고(App 11505–11516) reader도 그것을 읽는다. `<tuplet>` 괄호만 빼는 것은 앱에서 무해하다 |
| 소리 음가 | `duration.accuracy`. FIN-LONG-NOTES-HALVED REGRESSION |
| 마디 번호 | `measure_numbers.valid`, `app_onset_accuracy`. FIN-BAR-NUMBERS-RESTART/-SKIP/-SWAP(중복, 순서 바뀜) REGRESSION |
| 마디 완결 | `read.bar_completeness`. FIN-TRAILING-RESTS-SHORT, 새 SR-RH-RESTS-SHORT(대조군) REGRESSION. **단 implicit 예외로 끌 수 있다(S-M2)** |
| 쉼표 길이 | FIN-TRAILING-RESTS-SHORT, FIN-REST-TYPE-LONGER REGRESSION |
| clef | FIN-BASS-STAFF-TREBLE-CLEF, 새 SR-RH-ALTO-CLEF REGRESSION. 둘 다 aggregate `read.ledger_lines.heavy_rate` 하나로만 잡히고 usable은 그대로다(O4) |
| 보표 배정 | MUT-HANDS, FIX-HIGH-NOTES-LEFT-HAND REGRESSION. `<staves>` 누락(앱이 왼손을 cue 보표로 바꿈)도 core REGRESSION이다(identity, usable −18.1 pt) |
| **마디 순서(연주 순서)** | **읽지 않는다.** 앱의 재생 순서는 마디 번호가 아니라 반복 기호·volta로 정해진다(`Score.form`). benchmark reader는 `<barline>`을 읽지 않는다 → S-M1 |

### 21.4 F3 — golden 분류: **PARTIALLY VERIFIED** (S-M1, S-m1)

- 이 세션이 G15로 직접 확인했다.
  - 공백·줄바꿈, 속성 순서·따옴표, `<x/>` ↔ `<x></x>`, voice 번호(5 → 2): SERIALIZATION_ONLY(같은 음악).
  - 점 하나 제거, type 하나 변경, 쉼표 type 변경: SEMANTIC_CHANGE.
  - clef 변경, 왼손 음 하나를 1보표로, 마디 번호 변경: STRUCTURAL_CHANGE.
  - 페달 direction의 `<staff>`만 바꾸면 SERIALIZATION_ONLY다. 앱과 reader 모두 그 값을 쓰지 않으므로 옳다.
- **틀린 곳 1 (S-M1)**: 반복 기호는 projection에 없다. SR-SPURIOUS-REPEAT는 16 SERIALIZATION_ONLY다(앱은 재생을 1.5배로 늘린다).
- **틀린 곳 2 (S-m1)**: 어느 보표가 손인지(`<staves>`, piano part)는 projection에 없다. `<staves>`를 빼면 앱이 왼손 112음을 hand x(표시만 하고 연주·연습하지 않음)로 바꾸는데 golden은 17 SERIALIZATION_ONLY다. metric gate가 잡으므로 MINOR다.

### 21.5 PredTime: **VERIFIED**

- `extend_beats`가 첫·끝 박 간격으로 박 격자를 barStarts 범위까지 늘린다. 마디 시작·끝을 박 좌표로 옮기고 그 안에서 보간한다. SUT의 `tickToSec`(등간격 박, 박 사이 선형, 바깥 외삽)과 같은 모델이다.
- 이 세션의 수치 검사(scratch, 오차 0.0):
  - 첫 박보다 1.5박 앞서 시작해 끝 박 뒤 3.5박까지 가는 4/4 두 마디, 마디선이 박 사이(반 박 위상)
  - 격자 안에서 두 배 빨라지는 둘째 마디
  - 첫 추적 박 이전의 1박 pickup
- 정답 쪽(`RefTime`)은 연주기의 TimeMap을 그대로 쓴다. 이상적 입력에서 부당한 timing 벌점이 없다: final_oracle as-is 141, pickup-bar 20, mode-flip 104, tempo-mark 141 모두 만점(카탈로그 결함으로 설명되는 곳 제외), adversarial oracle 141곡 만점.

### 21.6 Usable / 음가 0.80: **VERIFIED_ACCEPTABLE**

- **계산**: 두 조건(`duration.accuracy`, `duration.page_accuracy` ≥ 0.80)이 `critical.note_values`로 AND된다. core 553 중 usable 100(18.1 %), 음가 gate만 실패한 unusable은 43이다.
- **표본**(예측 MusicXML을 정답과 같은 위치·음높이로 직접 대조):

| 케이스 | 판정 | 음가 | 실제 상태 |
| --- | --- | --- | --- |
| hymns/come-holy-spirit, deadpan | usable | 0.804 | 418음 중 82음이 짧다(2분 → 4분 37, 4분 → 8분 20). 위치는 모두 맞다. 마디당 쉼표 0.27(정답 0.27) |
| 같은 곡, human | unusable | 0.785 | 같은 오류 + 8분 → 16분 8. 마디당 쉼표 0.49. 경계 사례다(임계라면 어디에나 있다) |
| czerny599/030, amt | unusable | 0.379 | 8분이 16분 + 쉼표로 91음. 마디당 쉼표 5.67(정답 0.71). 명백히 쓸 수 없다 |
| czerny599/049, human/onset | unusable | 0.192 | §19의 표본. 옳게 unusable이다 |
| czerny599/027, human | usable | 0.817 | 16분 → 32분 21음. 마디당 쉼표 4.0(정답 0). 관대한 편이다(O1) |
| micro/M23, human | unusable | 0.786 | 16분 → 32분 24음, 마디당 쉼표 6.0 |

- **baseline을 예쁘게 만들려고 정한 임계가 아니다.**
  - usable을 25.9 %에서 18.1 %로 낮췄다.
  - 0.80 부근에 분포의 틈이 없다: min(음가, 페이지 음가)가 [0.70, 0.75) 38건, [0.75, 0.80) 43건, [0.80, 0.85) 37건, [0.85, 0.90) 50건이다.
  - 임계는 hands와 같은 1/5 원칙에서 왔다.
- 명백히 잘못된 usable 판정은 찾지 못했다. 합성 릴리스 모델 의존성(§20.7)은 M11 trigger에 들어 있다.

### 21.7 반복 / 불완전 마디 규칙: **NOT ACCEPTABLE** (S-M2, S-m2)

`bar_completeness_detail`(`metrics/readability.py` 132–164)은 세 가지를 예외로 둔다.

1. 첫 마디와 끝 마디.
2. **어느 위치든** `implicit="yes"`인 마디.
3. 이웃한 짧은 두 마디의 내용 합이 박자표 길이인 경우("반복에서 나뉜 두 반 마디").

- **정상 반복의 false positive는 없다.** known failure `incomplete_bars` 10파일·38마디를 원문과 대조했다. 모두 실제 결함이었다.
  - 예: for-all-the-saints 17–20마디는 1보표가 4박, 2보표가 12박이다.
  - 예: now-thank-we-all 6·11마디는 반복 기호 없는 반 마디다.
  - 이상적 출력(final_oracle)에도 거짓 실패가 없다.
- **그러나 실제 불완전 마디를 숨긴다.**
  - (2) 예외는 예측이 붙인 속성 하나로 켜진다. 앱은 implicit 마디의 길이를 내용으로 잡을 뿐 채우지 않으므로 짧은 보표를 그대로 그린다. SR-IMPLICIT-MASKS-SHORT-BARS가 core·smoke·robust를 통과한다(S-M2). 같은 결함에서 implicit만 뺀 대조군은 REGRESSION이다(usable −2.0 pt).
  - (3) 예외는 실제 반복 기호를 확인하지 않는다. reader가 `<barline>`을 읽지 않기 때문이다. 4/4 참조 4곡에서 끝에서 두 번째 마디 한가운데에 마디선을 넣어(반복 기호 없음, 박자표 그대로) 두 반 마디로 만들어도, `bar_completeness`·`bar_integrity`·`critical.structure`·usable은 모두 1이다. aggregate `struct.measures.count_exact`(1 → 0)와 `onset_pos`(1 → 0.91–0.94)만 떨어진다(S-m2).

### 21.8 새 공격 테스트

`python tests/bench/review/short_review.py` (약 4분). 각 mutation은 `audio-score.js`의 사본에만 적용하고 core·smoke·robust를 커밋된 baseline과 비교했다. golden도 돌렸다. 앱에서의 효과는 코드와 앱 실행으로 확인했다.

| mutation | 영역 | 사용자가 받는 것 | core | smoke / robust | golden | 결론 |
| --- | --- | --- | --- | --- | --- | --- |
| SR-SPURIOUS-REPEAT | 구조·연주 순서 | 가운데 마디 끝에 도돌이표. **앱 확인**(G01): visits 16 → 24, 재생 길이 48 → 72 quarters, 타건 160 → 240. 앞 절반이 두 번 연주되고 도돌이표가 그려진다 | **PASS, results.json byte 동일** | PASS (동일) / PASS (동일) | **16 SERIALIZATION_ONLY**, 1 ok | **MAJOR S-M1** |
| SR-IMPLICIT-MASKS-SHORT-BARS | 마디 완결 | 긴 쉼표로 끝나는 오른손 마디가 한 박 짧다. 안쪽 마디에 implicit | **PASS** (Δ 0) | PASS / PASS | 16 STRUCTURAL_CHANGE | **MAJOR S-M2** |
| SR-RH-RESTS-SHORT | 마디 완결(대조군) | 같은 결함, implicit 없음 | REGRESSION (`bar_completeness`, `critical.structure`, usable −2.0 pt) | REGRESSION / REGRESSION | 5 SEMANTIC | 잡힘 |
| SR-RH-ALTO-CLEF | clef | 오른손 보표가 알토 clef | REGRESSION (`heavy_rate`만) | REGRESSION / REGRESSION | 17 STRUCTURAL | 잡힘(O4) |
| SR-KEY-LAST-TWO-BARS | 조표 sequence | 마지막 두 마디만 5도 옆 조표, 음높이는 임시표로 맞춤 | REGRESSION (`critical.key`, usable −7.2 pt) | REGRESSION / REGRESSION | 16 SEMANTIC | 잡힘 |
| SR-PRINTED-TEMPO-MIDWAY | 인쇄 템포(대조군) | 가운데에 틀린 인쇄 메트로놈 + 같은 위치의 `<sound>`로 재생 유지. 앱은 템포 표시를 그리지 않으므로 앱에서 보이거나 들리는 변화가 없다 | PASS | PASS / PASS | 17 SEMANTIC | 무해(O3) |
| SR-NO-STAVES | 보표 구조(대조군) | `<staves>` 없음. **앱 확인**: 왼손 112음이 hand x(cue: 표시만, 연주·연습 안 함) | REGRESSION (identity, usable −18.1 pt) | REGRESSION / REGRESSION | **17 SERIALIZATION_ONLY** | gate는 잡음, golden 틀림(S-m1) |

- 이 세션은 SR-PRINTED-TEMPO-MIDWAY를 처음에 REGRESSION으로 기대했다. 앱이 곡 중간 템포 표시를 그리지 않는다는 것(렌더링 코드 없음, `score.tempos`는 `tempoMap`에만 쓰임)을 확인한 뒤 대조군(PASS 기대)으로 고쳤다. benchmark 기준은 바꾸지 않았다.
- 앱에서 무해해서 공격에서 뺀 후보:
  - `<tied>`만 제거: 앱은 `<tie>`로 타이를 읽는다(App 4191).
  - `<tuplet>` 괄호만 제거: 앱은 `<time-modification>`으로 셋잇단을 그린다.
- `short_review.py`는 S-M1·S-M2·S-m1이 남아 있는 동안 exit 1이다. CI에는 넣지 않았다. fixer가 고친 뒤 `mutation-check`에 편입하기를 권한다(§21.14).

### 21.9 테스트 (이 세션이 실행, Windows)

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | final_review | 10/10 OK (335 s) |
| 2 | final_oracle | 4 OK, 0 GAP |
| 3 | adversarial | 25 OK, 0 GAP (285 s) |
| 4 | mutation-check | 31/31: harmful 30 모두 REGRESSION, no-op `results.json` byte 동일 (210 s) |
| 5 | smoke / core / robust | run + check PASS. sha `a837acbe…` / `289c51d2…` / `a1d9364f…` = §20.11 |
| 6 | full | run + check PASS (4,976 케이스). sha `aae27ccf…` = §20.11 |
| 7 | golden | 17/17 identical |
| 8 | correctness | 13/13 (앱 해석이 다른 2개는 문서화된 octave-shift) |
| 9 | parser parity (T1) | 258/258 (워크트리 서버 8799, 15 s) |
| 10 | unit | 179 OK |
| 11 | short_review (새) | 7종 중 4종 OK(대조군 RH-RESTS-SHORT·KEY-LAST-TWO-BARS·PRINTED-TEMPO-MIDWAY, ALTO-CLEF), GAP 3종(SPURIOUS-REPEAT, IMPLICIT-MASKS-SHORT-BARS, NO-STAVES의 golden 라벨) |
| 12 | 결정론 | core `results.json` sha가 §20.11과 같다. mutation-check no-op이 byte 동일하다 |

`npm test`, omr-live, transcription-core, arranger, Linux Docker는 다시 돌리지 않았다. 이 세션은 프로덕션 코드를 바꾸지 않았고, §20.12의 결과가 같은 커밋 내용에 대한 것이다.

### 21.10 범위 감사: production diff **0**

- `git diff 663d463..6eae767`(merge-base, 브랜치 전체)에서 다음 경로의 변경은 0건이다: `audio-score.js`, `server.js`, `Piano Coach App.dc.html`, `index.html`, `omr-service.js`, `catalog/`, `transcribe.py`, `arrange_score.py`, `beat_track.py`, `midi_notes.py`, `pm2s_quant.py`, `evaluate_transcription.py`, 그 밖의 앱 JS.
- `tests/bench`·`docs` 밖의 변경은 `.github/workflows/bench.yml`, `.gitignore`, `README.md`, `package.json`(scripts), `tests/README.md`, `tests/beat_track_test.py`(import 수정), `tests/golden/README.md`뿐이다.
- `audio-score.js` sha256(EOL 정규화)은 `559a1f40…`로 문서와 같다. 작업 트리에도 프로덕션 변경이 없다.

### 21.11 M11: **BLOCKED_ACCEPTABLE**

`tests/bench/README.md`("When real recordings are required")와 `docs/CURRENT_STATE.md`에 trigger가 명시되어 있다.

- **다음을 바꾸는 첫 Goal을 시작하기 전에**: onset, beat, tempo, metre 추론, 그리고 키 릴리스를 음가로 바꾸는 규칙(duration/release).
- **필요한 것**: 라이선스가 확인된 실제 사람 연주 최소 3곡(단순 2박, 단순 3박, 겹박자). 마디 시작을 귀로 확인하고, `replay-public` `input:recorded`에 넣어 baseline에 기록한다.
- **예외**: writer, ScoreGraph, engraving만 바꾸는 Goal은 이 조건이 필요 없다. 이번 리뷰의 merge blocker도 아니다.

### 21.12 Findings

#### BLOCKER

없다(G0 브랜치 기준). 로컬 `main`의 `d82bb71`은 §19.18 BLOCKER-M 그대로 merge 전 사용자 결정이다. 이 세션은 건드리지 않았다.

#### MAJOR

**S-M1. 반복 기호·volta를 읽지 않는다. 앱은 그것으로 재생 순서와 페이지를 바꾸는데, metric·gate·golden 모두 보지 못한다.**

- **앱**: `parseMusicXML`이 part 0의 `<barline>`에서 `<repeat>`와 `<ending>`을 읽는다(App 4131–4157, `measureInfo.bar`). `PianoScore.build`는 `Score.form`(App 3677–3721)의 visits로 타건, 템포 맵, 페달을 만든다(App 2584–2598). 렌더러는 반복 barline과 volta 괄호를 그린다(App 10520, 10787–10836).
- **benchmark**: `musicxml.read_score`는 `<barline>`을 건너뛴다. canonical, metric, `semantic.projection` 어디에도 없다. 연주기도 참조를 반복 없이 연주한다. 그래서 불완전 마디 규칙은 반복을 내용 합으로 추측한다(S-m2).
- **증거**: SR-SPURIOUS-REPEAT. 앱에서 재생이 1.5배가 되는데 core·smoke·robust `results.json`이 원본과 byte 단위로 같고, golden은 16 SERIALIZATION_ONLY다. §19 F2·F3와 같은 종류(앱이 쓰는 필드를 benchmark가 읽지 않음)다.
- **G1에 미치는 영향**: writer나 ScoreGraph가 반복을 쓰기 시작하거나 잘못 쓰면 gate가 보지 못한다. golden은 "형식만 바뀜"이라고 인증한다.
- **수정 방향** (fixer가 정한다. 이 세션은 기준을 정하지 않는다):
  1. reader(reader/4)가 앱처럼 part 0의 repeat(forward/backward, times)와 ending을 마디에 읽는다. `conformance`가 그것을 비교한다.
  2. `semantic.projection`의 structure에 마디별 반복·volta를 넣는다.
  3. 예측의 연주 순서(앱 규칙의 visits)가 정답의 연주 순서와 같은지 판정하는 metric을 만들고 `critical.structure`에 넣는다(허용치 0). 정답 쪽의 연주 순서를 어떻게 정할지(참조의 반복을 펼칠지, 연주기가 반복 없이 연주하는 현재 방식을 유지하고 "반복 기호 없음"을 정답으로 볼지)는 문서에 결정과 이유를 적는다.
  4. SR-SPURIOUS-REPEAT를 `mutation-check`에 넣는다.

**S-M2. `implicit="yes"`가 어느 위치에서든 불완전 마디 검사를 끈다. 예측이 스스로 검사 적용 여부를 정한다.**

- **코드**: `readability.bar_completeness_detail`의 `if i in (0, last) or m.implicit: continue`. `bar_integrity`는 implicit 예외를 첫·끝 마디로만 제한한다(`m.implicit and m.index in (0, last)`). completeness만 모든 위치에 적용한다.
- **앱**: implicit 마디의 길이를 내용으로 둘 뿐이다(App 4263). 보표를 채우지 않으므로 짧은 보표가 그대로 그려진다.
- **증거**: SR-IMPLICIT-MASKS-SHORT-BARS core·smoke·robust PASS. 대조군 SR-RH-RESTS-SHORT는 REGRESSION(usable −2.0 pt)이다.
- **수정 방향**: 예측 쪽에서 implicit 예외를 첫 마디(pickup)와 끝 마디(보완 마디)로 제한한다. 안쪽 마디의 implicit 자체도 구조 결함으로 센다(참조 쪽 예외가 필요하면 참조에만 적용). SR-IMPLICIT-MASKS-SHORT-BARS를 `mutation-check`에 넣는다.

#### MINOR

| # | 내용 | 수정 |
| --- | --- | --- |
| S-m1 | golden projection에 어느 보표가 손인지(`<staves>`, piano part, hand)가 없다. `<staves>`를 빼면 앱이 왼손 전체를 cue(hand x)로 바꾸는데 17 SERIALIZATION_ONLY다. metric gate는 잡는다(core REGRESSION, usable −18.1 pt) | projection structure에 음마다 hand(또는 part별 staves 수와 piano part)를 넣는다 |
| S-m2 | 반 마디 예외가 실제 반복 기호를 확인하지 않는다. 늦은 위치에서 한 마디를 둘로 쪼갠 예측이 usable로 남는다(4/4 참조 4곡). aggregate `count_exact`·`onset_pos`가 체계적 회귀는 잡는다 | S-M1의 reader 확장 뒤, 예측 쪽 반 마디 예외를 반복 기호가 있는 곳으로 제한한다 |

#### OPTIONAL

- O1. usable이 쉼표 남발을 보지 않는다. czerny599/027 human은 음가 0.817로 usable이지만 마디당 쉼표가 4.0이다(정답 0). `read.rests_per_measure`의 delta를 진단에 보여 줄 수 있다.
- O2. sequence 임계 0.95는 16마디 곡에서 변화 표시가 한 마디만 어긋나도 실패다. 의도된 엄격함이지만 README에 예시를 적으면 좋다.
- O3. 곡 중간의 인쇄 템포만 틀린 출력은 앱에서 보이지 않으므로 gate 밖이 맞다. 다른 MusicXML 프로그램으로 내보내면 보인다. golden은 SEMANTIC_CHANGE로 알린다.
- O4. clef는 aggregate `read.ledger_lines.heavy_rate` 하나로만 판정되고 usable에 들어가지 않는다. 정답과 다른 clef(보표별)를 직접 세는 metric을 G4 전에 고려할 수 있다.
- O5. `CLAUDE.md`가 없다(사용자 결정). `tests/README.md` 문서 변경 2줄이 미커밋이다(허용 경로 밖이라 이 세션은 stage하지 않았다).

### 21.13 최종 판정: **`NEEDS_FIX`**

| READY_TO_MERGE 조건 | 결과 |
| --- | --- |
| BLOCKER 0 | 충족 |
| MAJOR 0 | **불충족** (S-M1, S-M2) |
| F1 VERIFIED | 충족 |
| F2 VERIFIED | **부분**: 요청된 mutation 7종은 모두 잡힌다. 연주 순서(S-M1)와 마디 완결의 implicit 예외(S-M2)가 남았다 |
| F3 VERIFIED | **부분**: 요청된 예는 모두 옳다. 반복 기호(S-M1)와 손 보표(S-m1)가 SERIALIZATION_ONLY로 분류된다 |
| PredTime VERIFIED | 충족 |
| usable rule ACCEPTABLE | 충족 (VERIFIED_ACCEPTABLE) |
| repeat rule ACCEPTABLE | **불충족** (S-M2, S-m2) |
| 새 공격에서 major hole 없음 | **불충족** (2건) |
| production diff 0 | 충족 |
| M11 BLOCKED_ACCEPTABLE | 충족 |

### 21.14 다음 fixer의 완료 조건

1. S-M2(작다) → S-M1(reader/4, projection, 연주 순서 metric) → S-m2 → S-m1 순서로 고친다.
2. METRICS/READER 버전을 올리고 relock, 재기준화, golden bless를 한다. 사유를 기록한다.
3. `short_review.py`가 exit 0이어야 한다. 기대값은 바꾸지 않는다. SR-SPURIOUS-REPEAT와 SR-IMPLICIT-MASKS-SHORT-BARS를 `mutation-check`에 넣는다.
4. 이 절의 매트릭스(§21.9)를 다시 통과해야 한다. final_oracle에서 반복 기호가 있는 참조가 이상적 출력으로 만점인지도 확인한다.
5. 이 절을 짧게 다시 검토한다. 다른 영역은 다시 열 필요가 없다. F1, PredTime, usable, M11, 범위, 결정론은 이 리뷰에서 확인되었다.

### 21.15 Last Fixer 기록 (2026-09-22)

§21의 MAJOR 2개(S-M1, S-M2)와 MINOR 2개(S-m1, S-m2)만 고친 세션이 썼다. §21의 다른 판정(F1, PredTime, usable 음가, M11, 범위, 결정론)은 다시 열지 않았다. 기준·허용치·임계(0.95, 0.80, tol 0)는 낮추지 않았고, 기존 review 스크립트의 기대값도 바꾸지 않았다.

- **대상**: `D:/PPP-g0`, 브랜치 `g0-quality-foundation`, 시작 커밋 `6dedc51`. `D:/PPP`(main)는 읽기만 했다(`node_modules`의 puppeteer, `tools/`의 Audiveris·transcribe venv 경로). merge, main push, G1은 하지 않았다.
- **프로덕션 변경 0**: `audio-score.js`, `Piano Coach App.dc.html`, `server.js`, `omr-service.js`, `catalog/`, Python 모델 파일 모두 그대로다. 바뀐 것은 `tests/bench/**`와 `docs/`뿐이다.

#### 21.15.1 판정: **`READY_FOR_FINAL_REVIEW`**

- BLOCKER 0, MAJOR 0 (S-M1, S-M2 해결), MINOR 0 (S-m1, S-m2 해결). §21의 OPTIONAL O1–O5는 그대로 남는다(범위 밖).
- 로컬 `main`의 `d82bb71`은 §19.18 그대로 merge 전 사용자 결정이다(이 세션은 건드리지 않았다).

#### 21.15.2 결정: 연주 순서의 정답 (S-M1)

앱은 part 0의 `<barline>`에서 `<repeat>`(forward, backward, `times`)와 `<ending>`을 읽고(`measureInfo.bar`), `Score.form`으로 펼친 마디 순서(visits)로 타건·템포 맵·페달을 만든다. benchmark도 이제 같은 규칙으로 읽고 같은 순서를 계산한다(`CanonicalScore.app_play_order`, `Score.form`의 port. 앱의 스택 동작까지 같다).

정답 쪽 연주 순서는 §21.14가 요구한 대로 결정과 이유를 적는다.

| 입력 | 정답으로 인정하는 연주 순서 | 이유 |
| --- | --- | --- |
| 연주(T: 합성 연주, replay) | ① 반복 기호 없음(모든 마디를 한 번씩, 순서대로) 또는 ② 참조와 **같은 마디 수에서 같은 연주 순서**(참조의 반복 기호 그대로) | 합성 연주기는 반복을 따르지 않고 쓰인 마디를 한 번씩 연주한다(녹음 참조는 "연주한 대로의 악보", README). 그래서 ①이 들은 것과 같다. SUT는 연주되지 않은 반복을 들을 수 없으므로 반복을 모두 빼는 것은 벌하지 않는다. ②는 인쇄된 곡 그대로이고 fixer의 이상적 출력(`_ideal_prediction`)이다. 연주 시점 계산(barStarts는 쓰인 마디당 하나)도 두 경우 모두 맞다 |
| 악보(S: OMR, prediction file) | 참조의 연주 순서만. 양쪽 모두 반복이 없으면 마디 수와 무관하게 "한 번씩" | 악보를 읽은 결과는 인쇄된 반복을 그대로 옮겨야 한다 |

그 밖의 모든 것은 틀리다: 참조에 없는 반복, 다른 마디로 옮긴 반복, 다른 `times`, 참조의 반복 중 일부만 남긴 것, 바뀐 volta. metric `struct.form.order_exact`(0/1)를 `critical.structure`에 넣었다(허용치 0). 진단용 `struct.form.plays_per_bar`(쓴 마디당 연주 마디 수)도 기록한다. 앱의 재생에 차이가 없는 변경(예: 1번 volta 안의 반복에 `times="3"`: 앱은 그 마디에 두 번째로 오지 않는다)은 gate가 아니라 golden이 잡는다.

- **G1에 주는 조건**: SUT가 반복 구간을 반복 기호로 접어 쓰기 시작하면 stats 계약(쓰인 마디당 barStart 하나)과 이 metric을 함께 바꿔야 한다(방문마다 barStart). 지금 SUT는 반복 기호를 쓰지 않는다.

#### 21.15.3 결정: 짧은 마디의 예외 (S-M2, S-m2)

`read.bar_completeness`가 짧은 마디를 봐주는 곳은 이제 셋뿐이다: 첫 마디(pickup), 끝 마디(보완 마디), 한 마디를 둘로 나눈 두 반 마디.

| | 참조·카탈로그 (`truth` 없음) | 예측 (`truth` = 참조) |
| --- | --- | --- |
| `implicit="yes"` 안쪽 마디 | 예외 아님 | **예외 아님** (S-M2: 앱은 implicit 마디의 길이를 내용으로 잡을 뿐 채우지 않는다. 예측이 자기 메타데이터로 검사를 끌 수 없다) |
| 반 마디 두 개 | 사이에 반복 기호나 ending 경계, 또는 첫 반의 끝에 겹세로줄·끝세로줄("Fine")이 있을 때만 | 예측이 그 사이에 쓴 반복 기호·ending(연주 순서 gate가 판정한다: 참조에 없으면 그쪽에서 실패), 또는 **참조가 같은 마디를 같은 길이로 나누고 참조 자신의 분할이 인정될 때**만. 예측이 쓴 겹세로줄은 아무것도 봐주지 않는다(아무것도 그 위치를 판정하지 않으므로) |

- 이전 규칙(합이 한 마디면 반복 기호 없이도 인정)은 예측 쪽에서 S-m2를, 참조 쪽에서 두 찬송가의 실제 결함을 숨겼다. 새 규칙에서 카탈로그 known failure `incomplete_bars`가 10파일·38마디에서 **12파일·42마디**가 되었다: All Glory, Laud and Honor 9–10마디(3박 + 1박), I Need Thee Every Hour 9–10마디(2박 + 1박). 둘 다 세로줄 표시 없이 한 마디를 둘로 나눴다(§21.7이 now-thank-we-all에 내린 판정과 같은 종류). Sonatina 12·15·17의 "Fine" 분할은 끝세로줄·겹세로줄이 있어 결함이 아니다.
- 커밋된 악보 중 안쪽 마디에 `implicit="yes"`를 쓴 파일은 없다(전수 확인). 그래서 참조 쪽 결과는 위 두 찬송가 외에 바뀌지 않았다.

#### 21.15.4 바꾼 것

| 영역 | 파일 | 내용 |
| --- | --- | --- |
| reader/4 | `pppbench/musicxml.py`, `canonical.py` | part 0의 `<barline>`을 앱처럼 읽는다(`read_barline`, `parse_ending_numbers`): `repeatStart`, `repeatEnd`(times, 기본 2), `style`(오른쪽 세로줄만), `endingNos`·`endingType`·`ending`·`endingEnd`. `Measure.bar`에 앱과 같은 키로 둔다. `CanonicalScore.app_play_order()` = `Score.form` |
| metric (metrics/5) | `metrics/structure.py`, `metrics/critical.py`, `suite.py`, `suites/*.json` | `struct.form.order_exact`(§21.15.2) → `critical.structure`. 모든 suite gate에 tol 0으로 추가(suite 해시는 그대로) |
| 완결 규칙 | `metrics/readability.py`, `known_defects.py` (known-defects/3) | §21.15.3. `readability(pred, truth=ref)` |
| golden (semantic/3) | `semantic.py`, `golden.py` | structure에 마디별 `barline`, `play_order`, `hands`(보표 → 손, x는 표시만), `piano_part`. diff에 "play order: 16 bars played -> 24", "hands by staff" 줄 |
| parity | `node/conformance.js`, `tiers.py`, `node/omr-live.js`, `projection.py` | 앱의 `measureInfo.bar`와 `Score.form(s)` visits를 받아 reader와 비교. OMR projection도 반복 기호를 옮긴다 |
| mutation-check | `pppbench/mutation.py` | 34종: SR-SPURIOUS-REPEAT, SR-IMPLICIT-MASKS-SHORT-BARS, SR-FAKE-SPLIT-BAR(새: 끝에서 둘째 마디를 음표가 걸치지 않는 곳에서 둘로 나눔, 반복 기호 없음, stats.bars·barStarts는 파일에 맞춤), SR-NO-STAVES |
| review | `review/short_review.py`, `review/final_oracle.py`, `review/README.md` | short_review에 SR-FAKE-SPLIT-BAR와 "reference repeats"(아래) 추가, 기존 7종과 기대값은 그대로. final_oracle에 5번째 변형 `no-repeats`와 `struct.form.order_exact` 추가 |
| unit | `unit/test_short_review_fixes.py`(17), `test_final_review_fixes.py`, `test_metrics_structure.py` | 새 테스트 17개. 기존 테스트 하나는 옛 규칙(반복 기호 없는 반 마디 인정)을 고정하고 있어 반복 기호를 넣고, 반복 기호가 없으면 실패함을 함께 검사하도록 고쳤다(더 엄격해짐). 구조 metric 테스트의 가짜 예측에 `app_play_order`를 더했다 |
| 기준 갱신 | `baselines/*`, `suites/*.lock.json`, `golden/*` | relock(reader 버전 줄만 바뀜: 입력은 그대로), smoke·core·robust·full·replay-public·omr-live 재기준화, golden 17개 bless(MusicXML byte는 그대로) |
| 문서 | `tests/bench/README.md`, `docs/CURRENT_STATE.md`, 이 절 | |

#### 21.15.5 새 공격 테스트

| 공격 | 어디서 | 결과 |
| --- | --- | --- |
| 가짜 가운데 반복 (SUT) | mutation-check SR-SPURIOUS-REPEAT, short_review | mutation-check REGRESSION(`struct.form.order_exact` 1 → 0.012, `critical.structure` 1 → 0.012). short_review: core REGRESSION, usable −18.1 pt(usable이던 케이스 전부), smoke·robust REGRESSION, golden **16 STRUCTURAL_CHANGE**(1 ok: 2마디뿐인 G04. 이 mutation은 4마디 미만에는 반복을 넣지 않는다). §21에서는 results.json byte 동일, 16 SERIALIZATION_ONLY였다 |
| 가짜 가운데 반복 (참조 139곡) | short_review REF-FAKE-MIDDLE-REPEAT, unit | 139/139: T·S gate 실패(usable 0), golden STRUCTURAL_CHANGE |
| 실제 반복 제거 (참조 62곡) | short_review REF-REMOVE-REPEAT, unit | 62/62 기대대로. 34곡은 T·S 모두 실패. 28곡은 유일한 반복을 빼서 모든 마디를 한 번씩 연주하게 되며, 이는 연주와 같으므로 T는 통과(설계, §21.15.2), S와 golden은 실패 |
| 반복 경계 이동 (참조 49곡) | short_review REF-MOVE-REPEAT, unit | 49/49: T·S 실패, golden STRUCTURAL_CHANGE |
| `times` 변경 (참조 62곡) | short_review REF-REPEAT-TIMES, unit | 62/62 기대대로. 59곡 T·S 실패. 3곡(1번 volta 안의 반복)은 앱의 연주 순서가 그대로라 gate 통과, golden STRUCTURAL_CHANGE |
| 안쪽 `implicit="yes"` + 짧은 마디 | mutation-check SR-IMPLICIT-MASKS-SHORT-BARS, short_review, unit | mutation-check REGRESSION(`read.bar_completeness` 1 → 0.985, `critical.structure` 1 → 0.854). short_review: core REGRESSION, usable −2.0 pt(implicit 없는 대조군 SR-RH-RESTS-SHORT와 같다), golden 16 STRUCTURAL_CHANGE. §21에서는 core·smoke·robust PASS였다 |
| 가짜 반 마디 분할 | mutation-check SR-FAKE-SPLIT-BAR, short_review, unit | mutation-check REGRESSION(`read.bar_completeness` 1 → 0.864, `critical.structure` 1 → 0.152). short_review: core REGRESSION, usable −16.6 pt, golden 14 STRUCTURAL_CHANGE(3 ok: 2마디뿐인 G04, 두 보표 모두 음표가 걸치지 않는 분할점이 없는 G06·G10. 셋 다 출력이 그대로다). 옛 규칙이었다면 `bar_completeness`가 1로 남는다(unit: 반복 기호 없는 반 마디 → bar short) |
| `<staves>` 제거 | mutation-check SR-NO-STAVES, short_review, unit | mutation-check REGRESSION(`notes.identity.f1` 0.979 → 0.713). short_review: core REGRESSION, usable −18.1 pt, golden **17 STRUCTURAL_CHANGE**(§21: 17 SERIALIZATION_ONLY). projection의 `hands`가 `[2, "l"]` → `[2, "x"]` |

- 반복 변형 312개 모두를 워크트리 앱(8799)의 `parseMusicXML`과 `Score.form`에 넣어 reader와 비교했다: 마디 표시와 연주 순서가 312/312 같다(scratch, 커밋하지 않음). parser parity 258/258도 이제 반복 기호와 연주 순서를 비교한다.

#### 21.15.6 테스트 (이 세션이 실행, Windows 11, Python 3.13.5, Node 24)

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | short_review | **exit 0**: 8/8 mutation(리뷰의 7종 + SR-FAKE-SPLIT-BAR) 기대대로, reference repeats 4그룹 기대대로 (232 s). §21: GAP 3 |
| 2 | final_review | 10/10 OK (269 s) |
| 3 | final_oracle | **5 OK, 0 GAP**: as-is 141, pickup-bar 20, mode-flip 104, tempo-mark 141, **no-repeats 62**(새). 반복 기호가 있는 참조 62곡이 반복 그대로(as-is)와 반복을 뺀 것(no-repeats) 모두 만점이다. 만점 미달은 모두 기존 카탈로그 known failure로 설명된다 |
| 4 | adversarial | 25 OK, 0 GAP (235 s) |
| 5 | mutation-check | **35/35**: harmful 34 모두 자기 metric으로 REGRESSION, no-op `results.json` byte 동일 (183 s) |
| 6 | smoke / core / robust | run + check PASS. `results.json` sha `b3f7b149…` / `63a45c29…` / `a74aad0c…`. 기존의 모든 case metric 값이 §20 baseline과 같다(1,879 케이스, 43,950 값 비교). 새 키 `struct.form.*`만 더해졌다 |
| 7 | full | run + check PASS (4,976 케이스, 146 s). sha `bf30e12e…`. 모든 그룹(hold-out 포함)의 기존 aggregate가 같다 |
| 8 | replay-public / omr-live | 재기준화 뒤 PASS / PASS. 두 suite 모두 기존 metric 값은 그대로(omr-live: 워크트리 helper + D:/PPP의 Audiveris, 44 s) |
| 9 | golden | semantic/3 bless 뒤 17/17 identical. bless 때 MusicXML byte 17/17 그대로 |
| 10 | correctness | 13/13 (앱 해석이 다른 2개는 문서화된 octave-shift) |
| 11 | parser parity (T1) | 258/258 (워크트리 서버, 14 s). 이제 마디별 반복 기호·ending·세로줄 모양과 앱의 연주 순서(`Score.form`)까지 비교한다. 추가로 반복 변형 312개도 앱과 312/312 같다 |
| 12 | unit | 196 OK (179 + 새 17) |
| 13 | transcription-core / arranger | 16 OK / 3 OK |
| 14 | `npm test` | 26/26 suite 통과, 확인 1,041개, 실패 0 (471 s). 워크트리 서버 8777 + 워크트리 helper(Audiveris는 `D:/PPP`의 실행 파일, 읽기만), `NODE_PATH=D:/PPP/node_modules`. "recording → score through the UI"만 transcriber가 없어 스스로 SKIPPED(§20과 같다). 끝나고 서버와 helper를 종료했다 |
| 15 | lint-corpus / provenance | 0 errors(경고 70) / 증거와 일치 |
| 16 | py_compile / node --check | `tests/bench`의 Python 64개, `tests/bench/node/*.js`, `audio-score.js`, `server.js`, `omr-service.js` 모두 통과 |
| 17 | 결정론 | smoke·core·robust를 다시 돌려 `results.json`이 byte 단위로 같다. mutation-check no-op도 byte 동일 |

#### 21.15.7 범위 감사

- `git diff 6dedc51 --stat`: 바뀐 파일은 모두 `tests/bench/**`와 `docs/`다. production 파일, `catalog/`, `tmp/`, `__pycache__`, `tests/bench/out/`, `.cache/`는 0건이다(stage 목록을 경로 규칙으로 검사).
- `tests/README.md`(이전 세션의 문서 2줄)는 허용 경로 밖이라 이번에도 stage하지 않았다.
- `audio-score.js` sha256(EOL 정규화) `559a1f40…` 그대로.

#### 21.15.8 다음 짧은 리뷰가 볼 것

1. §21.15.2의 T 규칙(반복 없음 또는 참조와 같은 연주 순서)이 받아들일 만한지.
2. §21.15.3의 예측 쪽 분할 예외(참조의 같은 분할)가 새 구멍을 만들지 않는지.
3. 카탈로그 known failure +2파일(두 찬송가)이 실제 결함인지.

---

## 22. Final Pass Review (2026-09-22)

**목적**: §21.15의 MAJOR 2건(S-M1, S-M2)이 실제로 해결됐는지 독립적으로 확인하고, G0를 PR/CI 단계로 넘겨도 되는지 판정한다. 전체 G0의 재감사가 아니다. F1, PredTime, usable 음가, M11, 범위, 결정론은 다시 열지 않았다(§21.15가 이미 확인).

- **대상**: `D:/PPP-g0`, 브랜치 `g0-quality-foundation`, 시작 및 종료 커밋 `e36b14c`(이 리뷰는 코드를 바꾸지 않았다). `D:/PPP`(main)는 건드리지 않았다. merge, main push, G1 없음.
- **읽는 사람**: 다음 fixer 세션과, PR을 검토하는 사용자.

### 22.1 판정: **`NEEDS_FIX`**

§21.15의 last fixer 판정(READY_FOR_FINAL_REVIEW)과 다르다. S-M1·S-M2·S-m1·S-m2 자체는 리뷰가 요청한 mutation·reference 변형 전부에서 VERIFIED_RESOLVED다(아래 22.2–22.4). 문제는 §5가 요구한 "이번 수정을 우회하는 새 공격 2개"에서 나왔다: 둘 다 새 **MAJOR** 구멍이다(22.6). 그래서 BLOCKER 0 · MAJOR 0 조건을 충족하지 못한다.

| READY_TO_MERGE 조건 | 결과 |
| --- | --- |
| BLOCKER 0 | 충족 |
| MAJOR 0 | **불충족** — 새 공격 2건 모두 MAJOR (PF-M1, PF-M2, §22.6) |
| S-M1 VERIFIED_RESOLVED | 충족 (§22.2) |
| S-M2 VERIFIED_RESOLVED | 충족 (§22.3) |
| MINOR 2건(S-m1, S-m2) 해결 | 충족 (§22.4) |
| 새 공격에서 MAJOR hole 없음 | **불충족** (§22.6) |
| 기존 regression suite 통과 | 충족 (§22.5, 11개 전부) |
| production 변경 0 | 충족 (§22.7) |

### 22.2 S-M1(반복 기호) 재확인: **VERIFIED_RESOLVED**

코드를 직접 읽어 앱과 대조했다(재실행이 아니라 라인 단위 비교):

- `read_barline`(`tests/bench/pppbench/musicxml.py:117-146`)이 앱의 `barMarks` 파싱(`Piano Coach App.dc.html:4139-4157`)과 분기·기본값(`times` 기본 2, `style`은 오른쪽만, ending 라벨 정규식)까지 동일하다.
- `CanonicalScore.app_play_order`(`tests/bench/pppbench/canonical.py:199-249`)가 앱의 `Score.form`(`Piano Coach App.dc.html:3685-3721`)과 스택·`taken`·`passAt` 갱신 순서, guard 8000 조건까지 줄 단위로 같다.
- `semantic.structure_diff`(`tests/bench/pppbench/semantic.py:112-142`)가 `bars`(barline 포함)·`play_order`·`hands`를 비교해 STRUCTURAL_CHANGE로 분류한다(SERIALIZATION_ONLY 아님).

독립 재실행(§22.5)에서 SR-SPURIOUS-REPEAT, REF-FAKE-MIDDLE-REPEAT(139/139), REF-REMOVE-REPEAT(62/62), REF-MOVE-REPEAT(49/49), REF-REPEAT-TIMES(62/62) 전부 §21.15가 보고한 그대로 재현됐다.

### 22.3 S-M2(implicit 예외) 재확인: **VERIFIED_RESOLVED**

`readability.bar_completeness_detail`(`tests/bench/pppbench/metrics/readability.py:159-208`)의 `excused()`에 `implicit`가 전혀 없다(전체 `pppbench/` grep: `implicit`는 pickup·downbeat 관련 다른 파일에만 남아 있고, 이 함수와 `bar_integrity_detail`의 inner-bar 로직에는 없다). 안쪽 마디의 `implicit="yes"`는 이제 아무것도 봐주지 않는다. `bar_integrity_detail`(§S-M2 이전부터 있던 별개의, 더 느슨한 metric)은 여전히 `m.index in (0, last)`만 면제하며 이는 정상 pickup 규칙이지 예측이 조작할 수 있는 구멍이 아니다(22.6.2가 이 경계를 다른 방향에서 공격해 실제로 뚫는다).

독립 재실행에서 SR-IMPLICIT-MASKS-SHORT-BARS, SR-RH-RESTS-SHORT(대조군) 모두 §21.15가 보고한 수치 그대로 REGRESSION이었다.

### 22.4 MINOR 2건 재확인: **VERIFIED_RESOLVED**

- **S-m1 (`<staves>`)**: `semantic.projection`의 `hands`가 `canon.notes`의 `(staff, hand)` 집합에서 나온다(`semantic.py:64`). `<staves>` 제거로 `hand`가 `l`→`x`로 바뀌면 `structure_diff`가 잡는다(`semantic.py:128-130`). 독립 재실행에서 SR-NO-STAVES의 golden이 **17 STRUCTURAL_CHANGE**였다(§21의 SERIALIZATION_ONLY가 아니다).
- **S-m2 (가짜 반 마디)**: `excused()`의 truth 분기(`readability.py:187-192`)가 `same_bars`(마디 수 일치) AND 두 반의 길이가 truth와 일치 AND truth 쪽에 실제 repeat/section 경계가 있을 때만 truth의 분할을 빌려준다. 예측이 스스로 쓴 겹세로줄은 아무것도 보지 않는다. 독립 재실행에서 SR-FAKE-SPLIT-BAR가 REGRESSION(`read.bar_completeness` 1→0.864)이었다.
  - **단, `excused()`의 다른 분기(예측 자신의 `repeat_boundary`)는 `same_bars`를 요구하지 않는다** — 이것이 22.6.1의 공격이 파고든 자리다.

### 22.5 회귀 스위트: 11개 전부 재실행, 전부 PASS

§5가 요구한 항목을 전부 독립적으로(이 리뷰의 새 셸에서) 재실행했다. full·robust는 재실행하지 않았다(관련 코드 불변, §21.15가 이미 통과).

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | unit | `python -m unittest discover -s tests/bench/unit -t tests/bench`: **196 OK** |
| 2 | golden | `run.py golden`: **17/17 identical** |
| 3 | correctness | `run.py correctness`: **13/13**(octave-shift 2건은 문서화된 KNOWN_DEVIATION) |
| 4 | smoke | run+check: **44 cases, 0 errors, PASS** |
| 5 | core | run+check: **553 cases, 0 errors, PASS**, usable **18.1 %**(`0.1808`) |
| 6 | mutation-check | **35/35**: harmful 34종 전부 자기 metric으로 REGRESSION(SR-SPURIOUS-REPEAT, SR-IMPLICIT-MASKS-SHORT-BARS, SR-FAKE-SPLIT-BAR, SR-NO-STAVES 포함), MUT-NOOP는 `results.json` byte 동일 |
| 7 | short_review | **8/8** mutation + reference repeats 4그룹(139/139, 62/62, 49/49, 62/62) 기대대로, gaps: none |
| 8 | final_review | **10/10** 자기 metric으로 REGRESSION, golden SEMANTIC/STRUCTURAL_CHANGE(SERIALIZATION_ONLY 없음) |
| 9 | final_oracle | **5/5 OK, 0 GAP**: as-is 141, pickup-bar 20, mode-flip 104, tempo-mark 141, no-repeats 62 |
| 10 | adversarial | offline **25 OK, 0 GAP** + `--only lock --conformance`(워크트리 서버 8777) **4 OK, 0 GAP** |
| 11 | parity(conformance) | 워크트리 서버 8777, `PPP_BENCH_NODE_MODULES=D:/PPP/node_modules`: **258/258 identical** |

모든 수치가 §21.15.6이 보고한 값과 정확히 일치한다(재현됨, 새 회귀 없음).

### 22.6 새 공격 2건: 둘 다 **MAJOR**

§4가 요구한 대로, 기존 mutation을 복사하지 않고 이번 수정(S-M1의 `read_barline`/`app_play_order`, S-M2의 `excused()`)을 정면으로 겨눈 새 공격을 반복 계열 1개, incomplete/implicit 계열 1개 설계했다. 둘 다 `tests/bench/pppbench`를 직접 호출하는 독립 스크립트로(코드 수정 없이, `audio-score.js`도 건드리지 않고) 재현했고, 실제 gate 경로(`evaluate.evaluate_symbolic` → 내부 `_finish` → `critical.gates`)로 확인했다(수동으로 gate를 다시 계산하지 않음 — 처음에 그렇게 해서 `notes.symbolic.f1`→`notes.identity.f1`별칭이 빠진 오탐을 한 번 냈고, `evaluate.py:40-49`의 `_finish`를 그대로 거치는 값으로 정정했다).

#### 22.6.1 PF-M1(반복 계열) — 매달린 forward repeat가 가짜 분할을 완전히 숨긴다

**가설**: `excused()`의 예측 쪽 분기(`readability.py:187-189`, `if repeat_boundary(canon, j): return True`)는 `canon`(예측)에 repeat/ending 표시가 있는지만 보고, 그 표시가 **실제로 재생에 영향을 주는지는 전혀 확인하지 않는다**. `app_play_order`(`canonical.py:199-249`)를 보면 forward repeat(`repeatStart`)는 스택에 인덱스를 넣기만 할 뿐, 그 뒤에 그것을 소비하는 backward repeat(`repeatEnd`)가 한 번도 나오지 않으면 재생 순서에 **아무 영향도 주지 않는다**(스택에 남아 있다가 버려짐). 즉 backward repeat가 하나도 없는 악보에 forward repeat 표시만 하나 덧붙이면, `struct.form.order_exact`는 절대 이를 보지 못한다. §21.15.2의 설계 문서(§21.15.2, "연주 순서 gate가 판정한다: 참조에 없으면 그쪽에서 실패")는 backward repeat/ending에는 맞지만 — lone forward repeat에는 **틀렸다**.

**재현**(`tests/bench` 루트에서 실행, 4/4박 40마디 합성 악보, 반복 없음):

```python
from pppbench import evaluate, musicxml
from unit.helpers import measure, note, score_xml
FORWARD = '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>'
# 끝에서 셋째 마디를 반으로 쪼개고, 뒷반에 forward repeat만 하나 붙인다(뒤에 그걸 닫는 backward repeat는 전혀 없다)
```

40마디 중 끝에서 셋째 마디(index 37)를 반으로 쪼개 41마디로 만들고, 뒷반에 `FORWARD`만 붙였다:

| metric | 결과 |
| --- | --- |
| `pred.app_play_order()` | `[0, 1, …, 40]` (자기 마디를 순서대로 한 번씩 — forward repeat는 완전히 무효) |
| `read.bar_completeness` | **1.0**(가짜 분할이 완전히 면제됨) |
| `struct.form.order_exact` | **1.0**(재생 순서에 아무 영향이 없으므로) |
| `notation.onset_pos.accuracy` | 0.949(40마디 중 1마디 근처의 밀림 — 10 % 문턱 밑) |
| `critical.structure` | **1.0** |
| **`usable`** | **1.0** |

정상적으로(같은 결함을 반복 표시 없이 넣으면) `read.bar_completeness`가 즉시 `bad: [{"kind": "bar short"}]`를 내고 `usable`은 0이 된다(§21.15.6 SR-FAKE-SPLIT-BAR가 이를 보여준다). 매달린 forward repeat 하나가 이 게이트 전체를 무효화한다.

#### 22.6.2 PF-M2(incomplete/implicit 계열) — 꼬리를 자르면 짧은 마디가 "마지막 마디"가 된다

**가설**: `bar_completeness_detail`의 완결성 검사는 `if i in (0, last): continue`(`readability.py:196-197`)로 파일의 **첫·마지막 마디를 무조건** 건너뛴다. 이는 진짜 pickup/보완 마디를 위한 규칙이지만, "마지막"은 순전히 예측 자신이 낸 마디 목록의 인덱스일 뿐 참조와 대조하지 않는다. 예측이 실제 결함이 있는 안쪽 마디 뒤를 통째로 잘라내면, 그 마디가 예측 파일의 새 "마지막 마디"가 되어 검사가 면제된다. 게다가 `critical.structure`의 gate 목록(`critical.py:51-60`)에는 `struct.measures.count_exact`(예측·참조 마디 수 일치)가 **없다**(git 이력 전체에서 `critical.py`에 이 metric이 들어간 적이 없다 — §19 M4/§20 기록의 "gate에 넣었다"는 서술은 `extra_empty_edge`에는 해당하지만 `count_exact`에는 해당하지 않는, 이번 리뷰가 새로 발견한 **문서-코드 불일치**다). symbolic 평가에서 pitch 무결성은 `notes.symbolic.f1`로 대체되는데(`evaluate.py:46-47`), 이는 전체 대비 비율이라 파일 끝에서 두 마디를 잘라내는 정도는 40마디 기준 0.95 문턱을 넘지 못한다.

**재현**: 40마디 합성 악보, 끝에서 셋째 마디(index 37)의 오른손에 진짜 결함(박자 하나가 짧은 trailing rest, SR-RH-RESTS-SHORT와 같은 모양)을 주고, 대조군·공격을 비교했다.

| 케이스 | 예측 마디 수 | 결함 마디가 예측의 "마지막"인가 | `read.bar_completeness` | `critical.structure` | `usable` |
| --- | --- | --- | --- | --- | --- |
| A. 결함만(자르지 않음) | 40 | 아니오 | 0.974 | 0.0 | **0.0**(정상 탐지, 대조군) |
| B. 자르기만(결함 없음) | 38 | – | 1.0 | 1.0 | **1.0**(마디 수 불일치 자체가 gate 밖) |
| **공격. 결함 + 자르기** | 38 | **예** | **1.0** | **1.0** | **1.0** |

같은 결함이 A에서는 100 % 잡히고(허용치 0인 gate라 마디 위치·곡 길이와 무관하게 항상 잡힌다), 꼬리를 2마디 자르는 것만으로 완전히 사라진다. B는 이 문제가 S-M2가 새로 만든 것이 아니라 `struct.measures.count_exact`가 애초에 한 번도 gate에 들어간 적이 없다는, 더 근본적인 사전 존재 결함임을 보여준다 — 하지만 "예측이 실제 결함을 정당화 없이 usable로 남긴다"는 S-M2가 막으려던 바로 그 결과이므로 이번 리뷰의 범위 안이다.

### 22.7 범위 감사

- `git diff 6dedc51 e36b14c --stat`: 60 파일, 전부 `tests/bench/**` 또는 `docs/`(§21.15.7과 동일하게 재확인). `audio-score.js`, `Piano Coach App.dc.html`, `server.js`, `omr-service.js`, `catalog/` 0건.
- 이 리뷰는 코드를 전혀 바꾸지 않았다(공격 재현은 `tests/bench` 루트에서 임시 스크립트로, 저장소 밖 scratchpad에만 저장). `git status`에는 이 리뷰가 만든 변경이 없다.
- `tests/README.md`의 미커밋 2줄(§21의 O5, §21.15.7)은 이번에도 그대로 남아 있다 — 이전 세션들과 같은 이유로(허용 경로 밖) 이 세션도 건드리지 않았다.

### 22.8 다음 fixer의 완료 조건

1. **PF-M1**: `readability.excused()`의 예측 쪽 `repeat_boundary(canon, j)` 분기가 "표시가 있다"가 아니라 "그 표시가 `app_play_order`에 실제 영향을 준다"(또는 최소한 대응하는 backward repeat/ending-close가 파일 안에 존재한다)를 요구하도록 좁힌다. truth 쪽 분기(같은 `same_bars` + `t_content` 대조)를 예측 쪽에도 일관되게 적용하는 방법도 검토한다.
2. **PF-M2**: `critical.structure`(또는 별개의 gate)에 예측·참조의 마디 수가 (반복 기호로 설명되지 않는 한) 일치해야 한다는 조건을 추가한다. §21.15.2가 `struct.form.order_exact`를 "반복이 없으면 마디 수 무관"으로 설계로 정한 것과 충돌하지 않도록, order_exact 자체를 건드리지 말고 **별도의** 마디-수 일치 gate로 넣는다(과거 §19 M4/§20이 이미 이렇게 하려 했다고 기록했으나 실제로는 반영되지 않았다 — git 이력에 `struct.measures.count_exact`가 `critical.py`에 들어간 적이 없다).
3. 두 수정 모두 `bar_completeness`/`critical.structure` 관련 golden·suite·baseline을 relock·재기준화해야 한다(S-M1/S-M2 때와 같은 순서: METRICS/READER 버전 올리고, 사유 기록).
4. PF-M1·PF-M2를 `mutation-check`와 `short_review.py`(또는 새 스크립트)에 회귀로 추가한다. 이 절의 재현 스크립트(22.6.1, 22.6.2)를 출발점으로 쓸 수 있다(그 자체는 커밋되지 않았다).
5. 고치고 나서 이 절(§22)을 다시 짧게 검토한다. §21.15와 22.2–22.5는 다시 열 필요가 없다(이미 VERIFIED_RESOLVED).

### 22.9 마지막 fixer (2026-09-22): PF-M1 = **RESOLVED**, PF-M2 = **RESOLVED**

**대상**: `D:/PPP-g0`, 브랜치 `g0-quality-foundation`. `D:/PPP`(main)는 건드리지 않았다. merge, main push, G1 없음. §22.8이 요구한 PF-M1·PF-M2 두 건만 고쳤다 — MINOR/OPTIONAL 사냥, benchmark 기능 확장, production 코드 변경 없음.

#### 22.9.1 PF-M1 수정: `readability.py`

`bar_completeness_detail`의 예측 쪽 `excused()`가 `repeat_boundary(canon, j)` 대신 새 `_excusing_repeat_boundary(canon, j)`를 본다(`repeat_boundary` 자체는 건드리지 않았다 — truth 쪽의 두 호출(§21 설계, S-m2)은 그대로 존재-여부만 본다). `_excusing_repeat_boundary`는 backward repeat(`repeatEnd`)·ending-close(`endingEnd`)·ending-start(`endingType=="start"`)는 §22.8.1이 정한 "최소" 기준대로 그대로 두고, forward repeat(`repeatStart`)만 새 `_forward_repeat_effective(canon, i)`로 좁힌다: 그 바로 다음 마디부터 파일 끝까지 어딘가에 `repeatEnd`가 있어야 한다(파일 앞쪽의 무관한 repeat pair를 빌려 쓰는 우회를 막기 위해 "그 이후" 범위로 제한했다 — 앞쪽에 있는 backward repeat는 이 forward repeat를 절대 소비할 수 없다). backward repeat는 앱의 `app_play_order`가 forward repeat 없이도 항상 처음(또는 스택 top)으로 되돌아가므로(§21 S-M1 설계 그대로) 무조건 실효로 남긴다.

#### 22.9.2 PF-M2 수정: `readability.py` + `critical.py`

**A (측 gate)**: `critical.py`의 `critical.structure`에 `("struct.measures.count_exact", ">=", 1.0)`를 추가했다. 이 메트릭은 `structure.py:255`에 이미 `len(pred.measures) == exp["measures"]`로 존재했으나(§22.6.2가 지적한 대로) 한 번도 gate에 들어간 적이 없었다. `order_exact`는 건드리지 않았다.

**B (edge 면제)**: `bar_completeness_detail`이 첫/마지막 마디를 "무조건" 건너뛰던 것을, `truth`가 주어졌을 때만 `edge_excused(i)`로 좁혔다: truth의 같은 자리(첫 마디는 truth의 첫 마디, 마지막 마디는 truth의 마지막 마디) content 길이와 `SHAPE_TOL` 이내로 일치할 때만 면제한다(길이가 같으면 꽉 찬 마디끼리도, 진짜 pickup/complement끼리도 그대로 면제되어 기존 결과가 보존된다). `truth`가 없는 경로(참조·카탈로그 자기 검증)는 손대지 않아 무조건 면제 그대로다. `same_bars`가 아니면(마디 수가 다르면) edge 면제 자체가 없다 — 그 경우는 A의 `count_exact`가 이미 잡는다.

버전: `METRICS_VERSION` `metrics/5` → **`metrics/6`**(`pppbench/__init__.py`에 사유 기록). `READER_VERSION`은 안 바꿨다(리더 파싱 자체는 그대로).

#### 22.9.3 검증: 새 공격 재현 (합성 스코어, `evaluate.evaluate_symbolic` 실제 gate 경로)

| 케이스 | `read.bar_completeness`(또는 `bad`) | `critical.structure` | `usable` |
| --- | --- | --- | --- |
| PF-M1: 매달린 forward repeat만(backward 없음), 가짜 split | bad 2건 | 0.0 | 0.0 |
| 대조: 정상 forward+backward 쌍, 같은 split | bad 0건 | — | — (split 정상 면제) |
| 대조: `truth=None`(참조 자기 검증)은 그대로 무조건 면제 | bad 0건 | — | — |
| PF-M2 공격: 결함 마디 + 꼬리 자르기(결함이 새 "마지막 마디") | bad 1건(더 이상 면제 안 됨) | 0.0 | 0.0 |
| PF-M2 대조 B: 결함 없이 마디 수만 -2 | `struct.measures.count_exact` 0.0 | 0.0 | 0.0 |
| PF-M2 변형: 마디 수는 그대로, 마지막 마디만 짧게(edge 전용) | bad 1건, `count_exact`는 1.0(정상) | 0.0(bar_completeness로) | 0.0 |
| 대조: 정상 pickup + 정상 complementary ending(참조와 동일) | bad 0건 | 1.0 | 1.0 |
| 대조: 참조와 완전히 동일한 구조 | bad 0건 | 1.0 | 1.0 |

#### 22.9.4 회귀 테스트 추가

`mutation.py`에 3건 추가(37 harmful, 기존 34 + 3):

- `PF-FORWARD-REPEAT-ONLY-EXCUSE`: SR-FAKE-SPLIT-BAR와 같은 가짜 split, 뒷반에 매달린 forward repeat 하나만(파일 전체에 backward repeat 없음). `read.bar_completeness`, `critical.structure` 기대.
- `PF-TRUNCATED-LAST-MEASURE`: 마지막 마디만 trailing rest 한 박 짧게(다른 마디는 전부 정상, 마디 수는 참조와 동일). `read.bar_completeness`, `critical.structure` 기대.
- `PF-DROPPED-LAST-MEASURE`: 파일의 마지막 마디를 통째로 뺐다(참조보다 한 마디 적음; stats·barStarts도 같이 줄어 서로 모순되지 않는다 — `struct.stats_consistent`가 아니라 `struct.measures.count_exact`가 잡도록 의도적으로 일관되게 만들었다). `struct.measures.count_exact`, `critical.structure` 기대.

세 건 모두 `mutation-check`에서 REGRESSION으로 기대한 메트릭이 실제로 움직이는 것을 확인했다(MUT-NOOP은 여전히 byte-identical). `short_review.py`의 `MUTATIONS`에도 같은 3건을 추가했다(11/11 캐치, reference repeats 4그룹도 그대로 139/139, 62/62, 49/49, 62/62).

#### 22.9.5 테스트 결과 (전부 이 세션에서 독립 재실행)

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | unit | `python -m unittest discover -s tests/bench/unit -t tests/bench`: **196 OK**(변화 없음) |
| 2 | mutation-check | **37/37**: harmful 37종(신규 3종 포함) 전부 자기 metric으로 REGRESSION, MUT-NOOP byte-identical |
| 3 | short_review | **11/11** 캐치(신규 3종 포함), reference repeats 4그룹 기대대로, gaps: none |
| 4 | final_review | **10/10** 자기 metric으로 REGRESSION |
| 5 | final_oracle | **5/5 OK, 0 GAP**: as-is 141, pickup-bar 20, mode-flip 104, tempo-mark 141, no-repeats 62 — §21.15와 수치 동일 |
| 6 | adversarial | offline **25 OK, 0 GAP** + `--only lock --conformance`(워크트리 서버 8777) **4 OK, 0 GAP** |
| 7 | smoke/core/robust | `ab --a git:HEAD --b worktree`: **PASS**(수치 이동 0), `run`+`update-baseline`+`check`: **PASS**(usable smoke 38.6 %, core 18.08 %, robust 6.03 % — §21.15와 동일) |
| 8 | golden | **17/17 identical** |
| 9 | correctness | **13/13**(octave-shift 2건은 문서화된 KNOWN_DEVIATION) |
| 10 | parity(conformance, T1) | 워크트리 서버 8777, `PPP_BENCH_NODE_MODULES=D:/PPP/node_modules`: **258/258 identical** |
| 11 | known-defects | `incomplete_bars` **12/329 files, 42 bars**(§21.15와 동일 — `truth=None` 경로 불변 확인) |
| 12 | full | `ab --a git:HEAD --b worktree`: **PASS**(4,976 케이스, 수치 이동 0), `run`+`update-baseline`+`check`: **PASS**(usable 17.9 %, 진단 78.60 — §21.15와 동일) |
| 13 | lint-corpus / py_compile | 0 errors(경고 70) / `tests/bench`의 Python 전부 통과 |

모든 suite에서 실제 corpus 수치(usable, diagnostic, 게이트별 통과율)가 §21.15가 보고한 값과 정확히 같다 — PF-M1/PF-M2는 둘 다 인위적 공격에서만 발현되고, 현재 SUT가 실제로 내는 출력(반복 기호 없음, split 없음, 마디 수 항상 일치)에는 영향이 없다.

#### 22.9.6 범위 감사

- `git diff <이 절 시작 커밋> --stat`: `tests/bench/**`와 `docs/`만. production(`Piano Coach App.dc.html`, `audio-score.js`, `server.js`, `omr-service.js`), `catalog/`, `tmp/`, `__pycache__` 0건.
- `tests/README.md`의 미커밋 2줄은 이번에도 허용 경로 밖이라 건드리지 않았다.

#### 22.9.7 최종 판정: **READY_FOR_MERGE_CHECK**

BLOCKER 0, MAJOR 0(PF-M1·PF-M2 둘 다 RESOLVED, 새 구멍 없음), 기존 regression suite 전부 통과, production diff 0. 다음 단계는 PR/merge 판단(사용자 결정) — G1은 시작하지 않는다.
