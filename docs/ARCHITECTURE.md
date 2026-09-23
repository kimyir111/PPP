# PPP — Architecture

2026-09-22 G1 Architect 세션이 처음 만든 문서다. **현재 구조**(`aff7080` 기준, 코드로 확인함)와 **목표 구조**(G1 설계)를 나눠 적는다.
2026-09-23 G1 구현으로 목표 구조의 S0–S2가 들어왔다 (§2 끝의 "G1 구현 후", G01 §24).

- 자세한 근거는 `docs/GOALS/G01_SCOREGRAPH.md` §2와 §15에 있다.
- 결정의 이유는 `docs/DECISIONS.md`에 있다.

## 1. 현재 구조

| 구성 요소 | 파일 | 역할 |
| --- | --- | --- |
| 앱 | `Piano Coach App.dc.html` (~19k줄, 단일 파일) | 음악 모델(`Score`), `parseMusicXML`, Import(OMR·녹음), VexFlow 렌더러, 재생(`PianoScore`), 연습·follow·코치·운지, 편곡기. React와 Babel을 unpkg에서 런타임에 로드한다. |
| 녹음 → 악보 | `audio-score.js` (UMD, 의존성 없음) | `toMusicXml(heard, opts)` → `{xml, stats}`. 모든 녹음 경로가 이곳으로 모인다. (G1 이후: `{xml, stats, graph, graphIssues}`, 아래 §2 끝) |
| 서버 | `server.js` (8777) | 정적 서빙(`tests`, `tools`, `data` 등은 차단), 로그인, 진도, 공유 API |
| 로컬 helper | `omr-service.js` (127.0.0.1:8788) | OMR(Audiveris), 전사(`transcribe.py`, `beat_track.py`), 코치, 편곡(`arrange_score.py`) |
| 품질 측정 | `tests/bench/` (G0) | 앱-parity MusicXML reader, 합성 연주, metric, gate, golden, mutation |

### 데이터 흐름

```
heard notes (초) ─► audio-score.js toMusicXml ─► MusicXML 문자열 ─┐
PDF/사진 ─► Audiveris ─► MusicXML ────────────────────────────────┤
MusicXML 업로드 / 카탈로그 / 교재 ────────────────────────────────┤
                                                                 ▼
                                  parseMusicXML → Score.finalize → legacy Score JSON
                                                                 │  (저장·공유되는 진실. 버전과 note ID가 없다)
              ┌──────────────┬──────────────┬────────────────┬───┴──────────┐
          PianoScore      VexFlow 렌더러   연습·follow·     ScoreArranger ─► /arrange-score
       (반복·템포·페달)                    운지·코치        (wire score JSON)
```

**현재 구조의 한계** (G01 §3): 정본 표현이 없다. 연주와 기보가 섞이거나 버려진다. 시간이 float다. 음에 ID가 없다. 저장 형식에 버전이 없다.

## 2. 목표 구조 (G1 설계)

```
            producers                          canonical                    projections
 ┌─────────────────────────────┐                                   ┌───────────────────────────────┐
 │ MusicXML import  (G1 Node,  │                                   │ MusicXML export (G1)          │──► G0 bench, 파일
 │   G2 앱)                    │                                   │ legacy Score adapter (G2)     │──► 기존 소비자
 │ audio-score buildGraph (G1) │ ──►  ScoreGraph (scoregraph/)  ──►│ 재생 계획 / 렌더 모델 (G4–G5) │
 │ OMR, 편곡, repair, 사용자   │      · timeline (공유 마디 격자)  │ wire score → arrange (G5–G7)  │
 │   편집 (이후)               │      · parts → events → heads     └───────────────────────────────┘
 └─────────────────────────────┘      · spanners, directions
                                      · performances (µs 연주 층)
                                      · provenance, structure
                                             ▲
                                             │ ID 참조만 (역방향 없음)
                                      SongGraph (G7+: 섹션 기능, 화성 분석, 모티프, 에너지, 역할)
```

**원칙**

- ScoreGraph가 진실이고, 나머지는 projection이다.
- 기보 시간은 W 단위 유리수, 연주 시간은 µs 정수이며, 재생 시간은 파생한다.
- 그래프는 불변 plain JSON이고, 순수 함수 라이브러리가 다룬다.
- 경계에서 검증한다.
- Strangler 방식으로 경계를 하나씩 옮긴다.

### 모듈 배치 (G1에서 구현됨)

```
scoregraph/            UMD, 의존성 없음, 브라우저와 Node 공용 (server.js가 서빙함)
  index.js             조립, version
  rational.js  schema.js  build.js  validate.js  serialize.js
  time.js  prov.js  ops.js
  xml.js  musicxml-import.js  musicxml-export.js
tests/scoregraph/      node --test, fixtures, SG golden
tests/bench/           + sg-roundtrip 명령, 다중 파일 SUT(audio-score.js + scoregraph/)
```

### 전환 단계 (G01 §15.2)

| 단계 | Goal | 경계 |
| --- | --- | --- |
| S0–S1 | G1 | 라이브러리와 코퍼스 round-trip (production 영향 없음) |
| **S2** | **G1** | **`toMusicXml` writer가 ScoreGraph를 거친다** (G0으로 음악적 차이 0을 증명) |
| S3 | G2 | 앱 import가 ScoreGraph를 거치고, legacy adapter가 Score를 만든다. 곡 기록에 그래프를 저장한다 |
| S4 | G2–G3 | 리뷰 재작성이 그래프를 직접 채택한다 |
| S5 | G4–G5 | 렌더러와 재생이 ScoreGraph를 읽는다 |
| S6 | G5–G7 | 편곡 입출력 |
| S7 | G7+ | SongGraph, planner, 드럼 |
| S8 | – | `parseMusicXML`, `buildXml`, `packScore` 제거 |

### G1 구현 후 (2026-09-23, 브랜치 `g1-scoregraph`)

- **S0–S1 완료.** `scoregraph/` 라이브러리(13개 파일), validator, canonical JSON, MusicXML import/export. 코퍼스 369개 파일이 `sg-roundtrip`의 L1, L1+, L2와 재생 순서를 통과한다 (allowlist 2개).
- **S2 완료.** `toMusicXml`은 `buildGraph`로 ScoreGraph를 만들고, ScoreGraph exporter가 쓴 MusicXML을 돌려준다. 반환값은 `{xml, stats, graph, graphIssues}`다. 들은 음, 페달, 마디 시각은 `source` performance 층에 있다. `opts.legacyWriter`는 G0 writer(`buildXml`)를 한 릴리스 동안 남긴 되돌리기 경로다.
- 앱은 `scoregraph/*.js`를 `audio-score.js` **앞에** 로드한다 (`?v=8`). `audio-score.js`는 버전이 다른 라이브러리를 거절한다.
- 그 밖의 소비자(앱 import, 저장, 렌더러, 재생, 편곡)는 아직 MusicXML 문자열과 legacy `Score`를 쓴다. S3부터는 G2 이후다.

```
heard notes (초) ─► toMusicXml ─► buildGraph ─► ScoreGraph ─► musicxml.export ─► MusicXML ─► (이하 §1과 같음)
                                                  │ graph, graphIssues도 반환 (앱은 아직 쓰지 않음)
                                     opts.legacyWriter ─► buildXml ─► MusicXML (되돌리기 경로)
```

## 3. 품질 측정의 자리

- G0 benchmark는 `toMusicXml`이 쓴 MusicXML을 앱 parity 규칙으로 읽어 평가한다.
- G1 이후에도 평가 대상은 **MusicXML artifact**다. 그래서 G0의 baseline, gate, golden이 그대로 유효하다.
- SUT는 `audio-score.js` 한 파일에서 `audio-score.js`와 `scoregraph/`로 넓어졌다 (G01 §15.4, G1 Step 7의 첫 커밋).
- G0 golden의 MusicXML 바이트는 G1 flip에서 `SERIALIZATION_ONLY`로 bless했다 (MusicXML 4.0, 최소 divisions, XSD 순서). 의미·stats·마디 시각은 17개 모두 같다.
- ScoreGraph 자체는 `tests/scoregraph/`(node --test, SG golden)와 `sg-roundtrip`이 잰다.
