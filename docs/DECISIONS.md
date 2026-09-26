# PPP — Decision log

아키텍처 결정의 목록이다. 한 줄 요약과 근거 위치만 적고, 비교와 이유 전문은 각 Goal 문서에 있다.

- **상태 값**
  - Proposed: 설계됨, 구현 전
  - Accepted: 구현되어 acceptance를 통과함
  - Superseded: 다른 결정으로 대체됨
- 2026-09-22 G1 Architect 세션이 처음 만들었다.

## G0 — Quality Foundation (Accepted, G0 브랜치에서 구현)

전문은 `docs/GOALS/G00_QUALITY_FOUNDATION.md` §3.4에 있다.

| ID | 결정 |
| --- | --- |
| G0-D1 | 평가 코어는 Python stdlib로 만들고, Node는 SUT를 실행하는 adapter로만 쓴다 |
| G0-D2 | reader는 앱 parity 규칙을 따르고, T1-C로 일치를 검증한다 |
| G0-D3 | 코어 입력은 reference에서 결정론적으로 만든 합성 연주다 |
| G0-D4 | 매칭은 초 단위, 채점은 악보 단위로 한다 |
| G0-D5 | 코드는 `tests/bench/`에 둔다 (공개 서빙 차단) |
| G0-D6 | SUT를 수정하지 않고, 변이는 사본으로 만든다 |
| G0-D7 | 생성 입력은 sha256 lock으로 관리하고, golden 입력만 커밋한다 |
| G0-D8 | 난수는 LCG와 FNV-1a를 쓰고, libm 초월함수를 쓰지 않는다 |
| G0-D9 | gate는 여러 metric, tag, 케이스로 판정한다. SQI는 대시보드용이다 |
| G0-D10 | 논란 있는 정답(octave-shift)은 제외한다 |

## G1 — ScoreGraph (Accepted, 2026-09-23, 브랜치 `g1-scoregraph`에서 구현)

전문은 `docs/GOALS/G01_SCOREGRAPH.md` §21에 있다. 2026-09-22 Proposed, 2026-09-23 구현되어 acceptance를 통과했다 (G01 §24). 아래 결정은 모두 설계대로 구현했다. 구현 중에 설계가 열어 둔 점을 정한 것은 표 아래 G1-D13–D18이다.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G1-D1 | 얇은 소유 계층 + ID 참조로 된 **혼합 그래프** | 계층 트리, 완전 정규화 | §21 D1 |
| G1-D2 | 기보 시간은 **W(온음표 = 1) 단위 유리수 문자열**, 연주 시간은 **정수 µs**, 템포는 유리수 qpm | quarter float, 고정 tick, quarter 유리수 | §21 D2, §6 |
| G1-D3 | **Event(`note`/`perc`/`rest`)와 Head(pitched/perc)의 tagged union** | 클래스 상속 | §21 D3, §7 |
| G1-D4 | **불변 plain data + 순수 함수** (`ops.*`) | 가변 클래스 | §21 D4 |
| G1-D5 | **JS + JSDoc**, 빌드와 의존성 없음 | TypeScript 빌드, `tsc --checkJs` | §21 D5 |
| G1-D6 | **손으로 쓴 validator** (shape table + 이름 붙은 규칙, ERROR/WARNING/INFO) | JSON Schema + ajv, zod | §21 D6, §13 |
| G1-D7 | **그래프 단위 단조 카운터 + 종류 prefix** ID | UUID, 내용 해시, 경로 ID | §21 D7, §12 |
| G1-D8 | **엄격 schema + `ext.<namespace>` + 버전 올림** | 모르는 필드 무시, 플러그인 레지스트리 | §21 D8 |
| G1-D9 | **canonical JSON** (schema 순서 키, 엔티티 한 줄, 기보 쪽 float 없음), `scoregraph_version` + migration chain | MessagePack/CBOR, MusicXML 저장, MEI | §21 D9, §14 |
| G1-D10a | 음높이는 **concert 철자**로 저장한다. written, 표시 옥타브, MIDI는 파생한다 | written 저장 | §7.2 |
| G1-D10b | 연주는 **별도 Performance 층 + head 링크**로 둔다 | head 안의 연주 필드 | §5.11, §6.9 |
| G1-D10c | 첫 production 경계는 **`audio-score.js` `toMusicXml`의 writer**다 | 앱 `parseMusicXML`, 저장 형식 | §15.3 |
| G1-D10d | parity는 **의미 동일성**으로 판정한다 (G0 semantic projection, 전 케이스 metric) | 바이트 동일성 | §15.3 |
| G1-D10e | 반복 전개는 **앱 규칙**(`Score.form` = G0 `app_play_order`)을 따른다 | 교과서 규칙 | §6.7 |
| G1-D10f | 결함 입력을 **충실히 담고 WARNING**을 낸다. 고치는 것은 이후 Goal의 명시적 연산이다 | import 시 자동 수정 | §4 DP6, §13.3 |
| G1-D11 | ScoreGraph는 SongGraph를 **모른다**. SongGraph가 ID와 `ScoreSpan`으로 참조하고, `fingerprint`로 신선도를 확인한다 | 한 문서에 섞기 | §10 |
| G1-D12 | 피아노의 손은 part가 아니라 **limb**(RH/LH/RF/LF)이며, head → voice → staff 순으로 상속한다 | 손별 part | §8 |

**구현 중 결정 (2026-09-23)**

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G1-D13 | ScoreGraph 경로의 오류는 **throw**한다. `toMusicXml`은 legacy writer로 몰래 되돌아가지 않는다. 되돌리기는 `opts.legacyWriter`(명시)와 git revert다 | 예외 시 자동 fallback | §24.3 |
| G1-D14 | `buildGraph`는 `buildXml`의 결정을 **결함까지 그대로** 옮긴다: 이슈 1(W-TEMPO-MARK-MISMATCH), 이슈 19(W-DISPLAY-DURATION), 셋잇단 조각마다 따로 그린 괄호(W-TUPLET-INCOMPLETE) | flip 중에 고치기 | §15.3, §24.3 |
| G1-D15 | 녹음 시작보다 앞선 마디선에는 `bar` anchor를 두지 않는다 (µs ≥ 0, §6.10). 순증가하지 않는 시각도 두지 않는다 | 0으로 자르기, 음수 µs 허용 | §24.3 (A41 d) |
| G1-D16 | G0 mutation은 flip과 함께 **`buildGraph`로 다시 고정**한다 (같은 결함). `<staves>` 누락은 exporter에 둔다. 리뷰 스크립트도 같은 edit를 쓴다 | 새 mutation 집합 | §24.3 |
| G1-D17 | Tie는 `<tie>`(소리 나는 tie)다. `<tied>`만 있는 음은 보고하고 담지 않는다. Chord symbol의 종류 필드는 `chordKind`다. 빈 객체(`fermata: {}`)는 canonical 형식에 남긴다 | §5.8 `kind` | `scoregraph/README.md` |
| G1-D18 | `ab`는 fixture suite(replay-public 등)를 각 suite의 runner로 돌린다. `ab_identical.py`가 케이스별 동일성을 따로 확인한다 | replay-public A/B 생략 | §24.3 (A36) |

## G2 — Score Import (Accepted, 2026-09-23, 브랜치 `g2-import`에서 구현)

전문은 `docs/GOALS/G02_SCORE_IMPORT.md`, 구현 기록은 그 §24에 있다. 설계(D1–D10)는 그대로 구현했고, D11–D14는 구현 중에 정한 것이다.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G2-D1 | MusicXML importer를 **다시 만들지 않고 넓힌다**. G2의 본체는 "우리 코퍼스"에서 "남의 파일"로 가는 일이다 | 새 importer | §3 A–E inventory |
| G2-D2 | container·encoding·format 판별을 **라이브러리 안 단일 진입점**(`scoregraph/import.js`)으로 모은다 | 호출자마다 각자 (지금 bench·앱·라이브러리 3곳) | §5, §6.4 |
| G2-D3 | **import 경계는 throw하지 않는다.** 실패는 `{ok:false, code, report}` 값이다. 우리가 만든 그래프의 ERROR는 G1-D13대로 throw를 유지한다 | 한 정책으로 통일 | §13.2 |
| G2-D4 | MIDI는 **RawMidi(무손실) → Performance 층 → 추론된 최소 skeleton** 세 층이다 | 바로 그래프로 | §7.2 |
| G2-D5 | MIDI 기보화에 **새 알고리즘을 만들지 않는다.** 이미 G0로 측정되는 `audio-score.js` 양자화기에 배선만 한다 | G2에서 양자화기 신설 | §7.6 (G3 침범 방지) |
| G2-D6 | provenance locator("마디 14 성부 2")는 **그래프가 아니라 ImportReport에** 둔다. 그래프에는 `Source.input{name, sha256}`만 | 음마다 locator | §12.2 (head당 212 B) |
| G2-D7 | **`scoregraph_version` 1 → 2.** optional 필드 추가 5건 + `MIGRATIONS[1]` 항등. 저장된 사용자 그래프가 아직 없을 때 올린다 | ext로 우회, 버전 유지 | §18 (ext host 제약, 부록 A-4·A-5) |
| G2-D8 | 앱 import 전환은 **shadow → A/B → flip** 3단계다 (G1 `opts.legacyWriter`와 같은 모양) | 한 번에 교체 | §14.2 |
| G2-D9 | fidelity는 byte 동일성이 아니라 **semantic projection**(MusicXML)과 **canonical event projection**(MIDI)으로 잰다 | byte 비교, parse 성공률 | §9 |
| G2-D10 | percussion은 **표현과 왕복까지만** 연다. 드럼 편곡·렌더링·재생은 열지 않는다 | G2에서 드럼 전체 | §17 |
| G2-D11 | **`.mid`는 연주만으로 끝내지 않는다**: 무손실 performance + 기존 audio-score quantizer가 만든 **inferred** 기보를 함께 낸다. 새 quantizer/성부/손 배정 코드는 0줄 | performance만 (악보가 안 보인다), 새 양자화기 | §24.8 (사용자 결정 D3) |
| G2-D12 | 추론된 기보임을 **세 곳**에서 말한다: 그래프 `provenance.default.op`, Score `sgFrom.inferred`, 사람이 보는 import report | 한 곳에만 | §24.8 |
| G2-D13 | 앱 import 경계를 **flip**한다. `parseMusicXML`은 `PPP.legacyImport`로 한 릴리스 남긴다 (G1 `opts.legacyWriter`와 같은 모양). 되돌리기는 스위치이지 예외 시 자동 fallback이 아니다 | 자동 fallback, 영구 병행 | §24.12 |
| G2-D14 | **그래프를 곡 기록에 저장하지 않는다.** `importSource`가 localStorage에 통째로 들어가고 그래프는 수백 KB다. 크기 전략을 정한 뒤의 일 | 설계 §14.4대로 바로 저장 | §24.10 |
| G2-D15 | **적히는 음과 울리는 음을 나눈다** (리뷰가 올린 D7). canonical 그래프는 concert 음을 담고, notation/UI는 written pitch·written key로 표시하며, 소리를 내는 소비자는 concert를 쓴다. written은 파생값이다 | 그래프를 written으로 바꾸기, 화면까지 concert로 두기 | §26 (§25 R1) |
| G2-D16 | 미분음은 **exact value를 ext에 남기고** 기보 pitch만 반올림하며, 그 근사를 경고·`normalized`·음의 `approx` 세 곳에서 말한다. 조용한 반올림은 금지 | schema에 분수 alter 추가(v3), 그냥 반올림 | §26.5 |

## G3 — Professional Score Intelligence (Accepted, 2026-09-24, 설계 승인; 구현 2026-09-24, G03 §27)

전문은 `docs/GOALS/G03_SCORE_INTELLIGENCE.md`. 2026-09-23 설계, 2026-09-24 사용자가 설계와 결정 D1–D8을 승인했다 (G03 §22.1). 여기서 Accepted는 **설계 승인**이다 — acceptance criteria(A1–A40)는 구현 뒤에 판정한다.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G3-D1 | G3는 `buildGraph`와 exporter 사이의 **graph → graph pass pipeline** (`professionalize`)이다. pass마다 독립 테스트·idempotent | `audio-score.js` writer를 고쳐 쓰기, giant pass 하나 | §5 |
| G3-D2 | Rhythm은 **R-repr**(onset·tie-merged 길이 정확 보존, 표현만)과 **R-reg**(release→음가 정규화)로 나눈다. R-reg는 M11 대상이라 **G3b**, 기본 off | 한 층으로, 가장 가까운 격자 snap | §6, §3.3 |
| G3-D3 | G1 F1: **논리 tuplet 하나 = Tuplet spanner 하나**. tie 조각·쉼표도 멤버, start/stop은 파생, continue는 멤버십, 중첩은 `parent`. schema 변경 없음 | 조각 괄호 합치기, UI에서 숨기기 | §7 |
| G3-D4 | `provOf(...).op`가 pass의 권한이다: inferred는 다시 쓰고, imported는 보존(선택 `fill`), edited는 절대 안 건드린다 | 모든 입력에 같은 정리 | §14 |
| G3-D5 | Preservation fingerprint(I1–I11) + critic, 위반 시 마디 단위 rollback과 report (테스트는 strict throw) | 규칙을 믿고 검사 없음, 위반 시 전체 throw | §15 |
| G3-D6 | **schema v2 유지**: ops 추가, `ext['ppp.g3']`, WARNING 2개(`W-BEAM-SHAPE`, `W-TUPLET-DISPLAY`)만 | v3 bump | §18 |
| G3-D7 | G0는 **확장만**: reader/5(tuplet·beam 읽기), `nq.*` metric, G3 flip gate. 새 critical gate 없음 | usable 정의 변경 | §20 |
| G3-D8 | dynamics·slur 추론, 운지 생성, ottava 기본값, 앱 렌더러 전환은 G3에서 하지 않는다 | G3에 포함 | §12, §13, D2, D4, D6 |

**사용자 결정 (2026-09-24, G03 §22.1)**

| ID | 결정 |
| --- | --- |
| G3-U1 (D1) | G3a 지금 구현. G3b는 구현하되 default OFF. R-reg와 real second-voice recovery는 duple·triple·compound 실제 human recording 3곡 baseline 뒤에만 production enable |
| G3-U2 (D2) | 자동 8va pass는 구현하되 default OFF. ottava 재생 문제(이슈 3) 해결 전 production 생성 금지 |
| G3-U3 (D3) | 소유권: G3 = note shape·리듬 표기, 임시표·철자, staff·hand 배정 / G4 = engraving·layout·geometry / G5 = fingering과 깊은 physical playability. G01 §5.7·§13.3·§14.3·§8.2의 해당 배정을 대체한다 |
| G3-U4 (D4–D8) | Architect 권고 기본값을 수용한다. 구현 증거가 반대를 보이면 기록하고 사용자에게 올린다 |

### G3 구현 중 결정 (증거와 함께, G03 §27.5) — Implementer, 2026-09-24

G3-U4대로 기록하고 올린다. 설계 결정 D1–D8은 바꾸지 않았다.

| ID | 결정 | 증거 |
| --- | --- | --- |
| G3-I1 | R-repr는 작가가 고른 한 음가를 규칙 위반만으로는 더 많은 tie 조각으로 쪼개지 않는다 | 규칙대로면 core `ties.extra_per_100` 4.24 → 5.19 (gate +0.5 초과); 이 규칙으로 2.66 |
| G3-I2 | compound 박 안의 셋잇단은 8분 단위 16분 셋잇단과 같은 박 두 8분 위의 3:2로 쓴다; P5는 점4분 박을 넘지 않는다 | §7.3의 구간 격자; core tm_missing 657 → 415, 셋잇단 tie 356 → 75 |
| G3-I3 | 한 5도 떨어진 조 구간은 조표를 바꾸지 않는다 (임시표로) | 딸림조 조표가 full key gate 3 케이스 퇴행 (A24) |
| G3-I4 | clef 전환: 한 음이 ≥ 4 덧줄이고 다른 clef가 모든 음을 < 4로 받으면; 양쪽에서 읽히는 마디는 구간을 잇는다 | §9.3 규칙만으로는 robust `heavy_rate` gate 초과 (Beyer 033 왼손 B4 G4 D5) |
| G3-I5 | 손 DP 선율 항: 앞 묶음 왼손에 가까운 lone bass, 오른손이 아직 누르는 음 아래의 화음에는 적용하지 않는다 (DP 상태만 읽음) | M16 micro 퇴행, full catalog subgroup 퇴행 |
| G3-I6 | 철자 line speller는 기본 off | 켜면 core 철자 퇴행 케이스 |
| G3-I7 | golden G3 허용 범주에 "release와 1박 안 press를 change 하나로" (P8) | G15 |
| G3-I8 | A39 2 s 판정은 단독 실행 (`test:scoregraph:perf`); 병렬 suite 안에서는 기록만 | 병렬 실행은 wall·CPU 시간 모두 약 2배 |
| G3-I9 | **flip 보류**: G3 gate의 `tm_missing == 0`·`mergeable == 0`이 R17·H7과 충돌 | G03 §27.4 — 사용자 결정 (G3-U5로 해소) |

**사용자 결정 (2026-09-24, 독립 리뷰 G03 §28.9 뒤; 영구)**

| ID | 결정 |
| --- | --- |
| G3-U5 (U-1) | mergeable tie는 **한 기호로 합치는 것이 H6·H7 아래 합법이고 G3a 가독성 정책이 허용할 때만** 결함(`MERGEABLE_DEFECT`)이다. 나머지는 이유별로 따로 센다: `REQUIRED_H6`, `REQUIRED_H7`, `REQUIRED_BEAT_SPLIT`, `PARTIAL_CHORD_REQUIRED`, `R17_DEFER_G3B`, 그 밖의 명시적 이유. 파일 allowlist·전역 threshold 완화·이유 이름으로 결함 숨기기 금지. **R17은 케이스별 baseline을 고정**하고, R17 residual을 baseline보다 늘리는 변경은 FAIL |
| G3-U6 (U-2) | 부분 화음 tie(화음의 일부 머리만 다음 음으로 이어짐)는 mergeable 결함에서 빼되 `PARTIAL_CHORD_REQUIRED`로 **따로 세어 보고**한다. G3a는 울리는 것을 바꿔서 이것을 풀지 않는다 |
| G3-U7 (U-3) | P8 페달 합치기(release + 1박 안 press → `change`)는 **기본 OFF** — professionalize 기본값과 shadow 포함. 명시적 실험 옵션(`opts.pedalJoin`)으로만. 앱의 `change` 재생 수정은 G3 범위 밖. G3 off/on(기본)에서 앱이 재생하는 페달 이벤트가 같아야 한다 (B1 회귀 fixture). G3-I7을 대체한다 |

### G3 Fixer 결정 (증거와 함께, G03 §29) — Fixer, 2026-09-24

| ID | 결정 | 증거 |
| --- | --- | --- |
| G3-F1 | gate의 residual 분류는 G3 내부가 아니라 **출력 MusicXML**(reader/5 층)에서 한다 (`pppbench/notation_reasons.py`): 성부-마디 창이 이진·셋잇단 격자 중 하나로 설명되지 않고, 한 격자를 고를 때 어긋난 점이 전부 1 tick 안의 release면 R17. 괄호 없는 time-modification 음(인쇄되지 않은 1-음 tuplet)도 1-음 tuplet으로 센다 | core: `tm_missing` 291 = R17 291, 1-음 150 = R17 150, mergeable 93 = H7 58 + H6 30 + R17 5, 결함 0 (§29) |
| G3-F2 | 손 DP의 옥타브 항은 **겹친 선**(나머지가 울리지 않는 맨 옥타브가 3번 이상 연속)에만; 손 위치는 "마지막 자리"와 "머물러 온 자리"(느린 평균, 작가가 그 손에 둔 음 뒤에만) 중 가까운 쪽; 한 음씩 번갈아 치는 음형은 선율 항 면제; 작가의 손이 DP보다 비싸지 않은 구간은 작가 것을 둔다; 결과는 자기 모델의 **고정점**(작가 손으로 다시 읽어도 같은 선택) | 리뷰의 M04·M15×2 회복, Czerny 849/027 human Eb4 43 → 3; P(P(g)) core 553·full 동일 (§29.4) |
| G3-F3 | micro no-drop은 기호 수가 분모인 비율(`note_shape.consistency`)을 **불일치 수**로 판정한다 (`MICRO_BY_COUNT`) | M20: 불일치 8 → 8, 분모 109 → 108 |
| G3-F4 | 구간 조 추론은 살아 있는 코드지만 녹음 corpus에서는 발동하지 않는다 — 억지로 조 변경을 만들지 않는다. mutation은 살아 있는 임시표 경로(`G3-ACC-BAR-STATE`)로 | core 441 중 2, full 4,165 중 14 케이스만 조 변경 제안, 전부 한 5도(G3-I3로 임시표); S06 fixture가 실제 전조를 증명 |
| G3-F5 | 사람 평가 세트는 블라인드: 불투명 라벨(E01-X…), 판본 순서 무작위(seed), 머리·표지·마크 정규화, 열쇠는 `tests/bench/human/g3-key/` 분리 | §29.8 |

### G3 A36 (사람 평가, 2026-09-24, G03 §30)

| ID | 결정 | 증거 |
| --- | --- | --- |
| G3-U8 | A36 1차 평가는 사용자 지시로 **앱 렌더러**(ScoreView·VexFlow, dev 페이지 `?devReview=g3`)에서 했다 — D7(a) MuseScore 4의 예외, 이 평가에만. 앱은 파일의 beam·tuplet 괄호를 스스로 다시 정하므로 G3a의 beam(3,305 대 G3 off 0)은 판정되지 않았다. 쉼표·음가·셋잇단 값·staff·성부는 파일 그대로 그린다. dev 도구는 로컬 브랜치 `g3-dev-review-tool`에만 두고 main에 넣지 않는다. 재평가의 렌더러는 다시 사용자 결정 | §30.2: 진 6 발췌에서 앱이 그린 쉼표 수 = 파일 `<rest>` 수; 결과 A36 FAIL (§30.1) |
| G3-U9 | **G3를 PARTIAL / DEFERRED로 닫는다** (COMPLETE 아님). M11 실제 연주 녹음은 지금 하지 않는다. G3a는 A36 FAIL로 OFF, G3b·자동 8va·`pedalJoin` OFF. G3 off에서 출력이 main과 같은 feature-gated 인프라는 main에 넣어도 된다. 다음 Goal로 간다 | 사용자 2026-09-24; G03 §31 |
| G3-U10 | 다음 A36 재평가는 **PPP 앱 렌더러**로 한다 — 실제 PPP 사용자가 보는 결과가 합격 대상 (D7(a)와 G3-U8의 "재평가 렌더러는 다시 결정"을 대체). 앱이 못 그리는 beam 모양·보임과 일부 tuplet 판각은 G4 범위이고, G3 구조 metric·테스트로 따로 검증한다. MuseScore 설치를 요구하지 않는다. 재평가 전에 발췌를 `CLEAN_INPUT` / `UPSTREAM_ERROR`(녹음 경로의 박자·조가 참조와 다름)로 미리 나눠 따로도 보고하되, 결과를 본 뒤 빼지 않고 전체 판정에서도 빼지 않는다. **구현 안 함** (재평가 때) | 사용자 2026-09-24; G03 §31.5 |

## G4 — Professional Engraving (Proposed, 2026-09-24 설계; G4a 병합 2026-09-25 PR #9 `df8a571`, 최종 리뷰 PASS; G4b 구현 2026-09-25, 리뷰 대기)

전문은 `docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md`. Architect 세션이 저장소 증거로 정한 것이다. 사용자 결정 G4-U1–U4는 수용되었다 (아래). G4a가 구현한 결정(D2, D3의 plan 부분, D4의 plan 부분, D5의 plan 부분, D6의 plan 부분, D7의 NotationPlan, D10)은 G04 §32에 구현 기록이 있고, 독립 리뷰 뒤 Accepted로 바꾼다.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-D1 | **VexFlow 4.2.3 유지(vendoring) + PPP 판각 층.** VexFlow는 glyph·음표 단위 formatter·drawer. 간격·줄바꿈·충돌·곡선·페이지는 PPP. 엔진 독립 경계는 NotationPlan (Verovio 재평가 조건 §7.3) | VexFlow 5 재작성, 화면 VexFlow + 인쇄 외부 판각기, Verovio 단일 엔진, OSMD | §7 |
| G4-D2 | **렌더러 입력은 ScoreGraph.** RenderSource: live → refetch → store(U1) → `legacy.fromScore`. `agree`(G2 `legacy.compare`)와 link(sgHead / join key)로 Score와의 일치를 확인, 실패하면 fromScore | Score를 계속 입력으로, Score에 판각 곁표 | §8.2 |
| G4-D3 | beam은 성부-마디에 그래프 beam이 있으면 그것만, 없을 때만 `pro-beam.js` `groups`(순수 함수)로 파생하고 ledger에 `derived` | 문자 그대로 충실(깃발만), 렌더러 자체 규칙 유지 | §11 |
| G4-D4 | tuplet은 그래프의 `show`·`printed`·`parent`대로. 시간을 다시 해석하지 않는다. 1-음 tuplet은 U2 | 렌더러 휴리스틱 유지 | §12 |
| G4-D5 | 모든 그래프 tie(부분 화음·세로줄·system 넘김)와 그래프 짝대로의 slur. 추론 악보 마디 안 tie는 U2 | 줄 넘김 곡선 버림, start/stop 다시 짝짓기 | §13 |
| G4-D6 | 다성부 stem은 `display.stem`, 없으면 그래프 성부 순서. 렌더러는 손·staff·성부를 정하지 않는다 | 평균 음높이 | §14 |
| G4-D7 | 명시적 중간 표현 둘: **NotationPlan**(좌표 없음 + fidelity ledger)과 **EngravedScore**(staff-space 기하, 그래프 ID). schema 변경 없음 | IR 없이 바로 그리기, render tree 추가, schema v3 | §8 |
| G4-D8 | 음악 기호는 전부 SMuFL glyph(Bravura via VexFlow), 글자 폭은 커밋한 metric 표. DOM 측정·Unicode 음악 글자 없음 | 시스템 글꼴, DOM 측정 | §18 |
| G4-D9 | `PPP.renderer`('legacy' 기본 \| 'engrave') 스위치, production은 곡 단위 fallback을 세고, 테스트는 strict | 한 번에 교체, 조용한 fallback | §25 |
| G4-D10 | G4는 G3를 요구하지 않는다: G3 flag를 읽지 않고 `professionalize`를 부르지 않는다. G3a·G3b 그래프는 그대로 그린다 | G3a flip을 G4의 전제로 | §26 |
| G4-D11 | 가로 간격은 spring(`u·Δ^0.65`)–rod 모델, system마다 정확히 폭 맞춤. 화면은 줄당 N마디, 인쇄는 밀도 DP | 시간 비례, VexFlow Formatter에 맡김 | §9, §15 |
| G4-D12 | 벤치마크 4층: L1 ledger, L2 기하, L3 기하 snapshot (Node, CI), L4 milestone 사람 평가 2회 | 매 변경 사람 평가, 픽셀 snapshot을 CI에 | §21 |

**사용자 결정 (2026-09-24, G04 §31) — 전부 수용, U2·U4는 조건·수정과 함께**

| ID | 결정 |
| --- | --- |
| G4-U1 | **수용.** 그래프를 IndexedDB에 (압축해) 캐시한다. ScoreGraph가 진실이고, 들여온 곡을 다시 불러와도 그래프 의미를 조용히 잃지 않는다. legacy Score는 호환·복구 표현이다. 그래프가 없으면 `legacy.fromScore`가 만들고, 그 결과는 설계된 `legacy.compare` 경로로 확인한다 |
| G4-U2 | **수용 (조건 있음).** A: 추론 tie는 **그린다** — 재생·연습이 한 음으로 다루는 것은 악보에도 tie로 보인다. B: 한 음 tuplet의 표시 병합은 **모든 구조 조건**(같은 성부·staff·비율, 시간상 이어짐, 충돌하는 의미 경계 없음, 결정론적)이 한 시각 묶음임을 증명할 때만; ledger에 merged-for-display로 적는다. 그래프의 시간·의미는 바꾸지 않고, 병리적인 한 음 tuplet을 일괄로 숨기지 않으며, 애매하면 그래프 그대로 그린다 |
| G4-U3 | **수용.** 인쇄는 브라우저 인쇄 layout → 인쇄 대화상자의 벡터 PDF. 외부 판각 엔진·서버 PDF 없음. MusicXML 내보내기는 따로 남는다 |
| G4-U4 | **수용 (수정).** 데스크톱 4마디, 휴대폰 2마디는 **선호 목표이지 고정 규칙이 아니다** — 밀도·폭이 이긴다 (빽빽하면 줄이고 성기면 늘린다), 외톨이 마지막 마디는 가능한 한 피한다. 인쇄는 밀도 기반 |
| G4-U5 | **deferred 계약** (2026-09-25, G4a 최종 리뷰 뒤): `title-block` 허용 — 인쇄 제목 영역 중 title·composer 밖의 필드, G4e (화면은 설계대로 suppressed `print-only`); `ornament-glyph` 허용 — schema가 아는 장식음 중 고정 글꼴에 glyph가 없는 것만, G4d; `unknown-spanner`처럼 모르는 의미는 **deferred 금지** → `unsupported`(진단, audit 실패); `projected-loss`는 G04 계약대로 유지. §21.1 목록과 이 둘 밖의 deferred code는 audit 실패 |

### G4a 구현 중 결정 (증거와 함께, G04 §32.3) — Implementer, 2026-09-25

| ID | 결정 | 증거 |
| --- | --- | --- |
| G4-I1 | 파생 beam의 단위는 성부-마디가 아니라 **part**: part에 그래프 beam이 하나라도 있으면 그 part에서는 파생하지 않는다 (G4-D3을 좁힘) | 성부-마디 규칙은 beam을 쓰는 카탈로그 15 파일에서 파일이 깃발로 둔 259 묶음을 beam으로 바꿨을 것 (예: Czerny 599/26 둘째 성부) |
| G4-I2 | RenderSource의 refetch(카탈로그 다시 읽기)는 만들지 않는다: live → store → projected | U1로 course·카탈로그 곡도 열 때 저장된다. 페이지 검사에서 course 곡이 다시 불러온 뒤 `store`로 돌아옴 |
| G4-I3 | 그래프 캐시의 키는 **곡 id**: `writeSlot`이 slot을 쓴 뒤 idle에 저장, `removeSong`이 지움 (MediaStore와 같은 모양). 쓸 때마다 scoreId·music hash를 확인해 낡은 것은 버린다 | 페이지 검사: 저장·다시 불러오기·손상·삭제 |
| G4-I4 | `agree`는 두 쪽을 한 음 순서로 정렬해 compare()에 넘기고, 제목·작곡가·점수 tempo는 비교하지 않고 보고만 한다 | compare()는 첫 `.order`에서 멈춰 값을 더 읽지 않는다; course 곡은 읽은 뒤 이름을 바꾼다 |
| G4-I5 | music hash는 compare()처럼 읽는다: null·없음·false는 같고 수는 6자리 | `packScore`가 null 필드를 버려, 다시 불러온 곡의 그래프가 전부 "낡음"으로 판정됐다 (페이지 검사가 찾음). 회귀 테스트 추가 |
| G4-I6 | 한 음 tuplet 병합을 beam보다 먼저 정하고, 파생 beam 규칙에 병합 묶음을 tuplet 하나로 넘긴다 | 그러지 않으면 병합된 셋잇단에 beam이 생기지 않는다 (파생 beam 3,490 → 3,505) |
| G4-I7 | `fromScore`는 Score의 손에서 part 구성을 되살린다 (손 규칙이 모든 staff의 손을 그대로 주는 첫 구성) | 그래야 toScore가 같은 손·첫 part(clef, 코드명)·피아노 part(페달, 8va)를 돌려준다; 코퍼스 398/399 동일 (나머지 1은 타악기, `percussion-or-unpitched`로 보고) |
| G4-I8 | 라이브러리 버전 1.2.0 → 1.3.0 (legacy-score API 추가). `toScore` 출력은 그대로이고 `{ids:true}`는 요청할 때만 | `test:scoregraph` 205/205, 렌더 SVG 바이트 동일 |
| G4-I9 | VexFlow 4.2.3은 `vendor/`에 고정(`* -text`, sha256·SRI)하되 G4a의 앱은 불러오지 않는다 — legacy 렌더러는 G4b까지 CDN 그대로 | 사용자에게 보이는 변화 0 (렌더 16개 바이트 동일) |
| G4-I10 | ~~ledger status는 G04의 다섯 (drawn, derived, merged, suppressed, deferred)과 code. projection이 잃은 것은 ledger가 아니라 `RenderSource.unsupported`가 말한다~~ **G4-F2가 대체** (G04 A1의 여섯 status로 되돌림). 사용자가 부른 이름과의 대응은 그대로: merged-for-display = merged + code, suppressed-by-explicit-semantic = suppressed + code, unsupported = deferred + code | ledger는 그래프가 말하는 것만 센다 |
| G4-I11 | `fromScore`는 조용히 버리지 않는다: 그래프 validator가 ERROR로 거절한 객체는 하나씩 빼고 다시 봉인하며 `refused-by-graph:<code>`로 이름을 댄다. staff 없는 Score 8va(파일이 staff를 말하지 않음)는 피아노 part 첫 staff에 두고 `ext['musicxml.ottava'].staff = 'assumed'`로 표시한다 — importer와 같은 방식, `toScore`는 다시 staff 없음으로 읽는다 | schema는 ottava에 staff를 요구한다. 그러지 않으면 `samples/marks-sample`의 8va가 봉인에서 조용히 빠졌다 (G4a 구현 중 찾음. 회귀: `samples/`를 코퍼스에 넣어 A48 엄격 비교가 8va 목록을 본다) |

### G4a Fixer 결정 (병렬 리뷰의 지적을 고침, G04 §32.12) — Fixer, 2026-09-25

독립 read-only 리뷰의 지적을 입력으로 G4a를 고쳤다. 설계(G04 §0–§30)를 바꾼 것은 없고, 구현이 설계와 달랐던 곳을 설계대로 되돌리거나(F2, F6), 설계가 말하지 않은 곳을 정했다. 전부 G04 §32.12에 증거와 함께 있다.

| ID | 결정 | 증거 |
| --- | --- | --- |
| G4-F1 | **ledger audit은 plan의 출력을 읽는다.** 세 읽기를 대조한다: 그래프가 말하는 것(`expected`, 참조와 내용 signature), plan **출력 배열**이 실제로 싣는 것(`consumed`, 그래프·ledger를 읽지 않음), plan의 ledger. drawn·merged·derived인데 출력에 없으면 `missing`, 출력에 있는데 그래프와 다르면 `altered`, 그래프의 것도 ledger의 파생도 아닌 출력은 `orphan`. 그래프를 돌며 채운 index를 소비의 증거로 쓰지 않는다 | 고치기 전: `ties.push`를 지워도 audit `ok` (G16 golden, tie 3개 → plan 0개, missing 0). 고친 뒤: 소스 mutation 9개가 모두 이름 붙은 범주로 실패, no-op 대조군은 바이트 동일 (`ledger-mutation.test.js`) |
| G4-F2 | **(title-block·ornament-glyph·unknown-spanner 처리는 G4-U5·G4-F21이 대체)** **status와 code는 G04 A1대로, 허용 목록으로.** status는 여섯(`projected-loss` 되살림: `config.projection`이 오면 `p:` 참조로 fromScore의 `unsupported` code마다 한 항목). status마다 허용 code 목록(`ledger.CODES`); **deferred는 A1의 목록 그대로** (cross-staff-chord, cross-staff-beam, tab, nested-3, grace-after, stem-double) — 그 밖의 code는 audit `unapproved`. 구현이 설계와 달랐던 것: `title-block` → 인쇄에서 drawn, 화면에서 suppressed `print-only` (§15.5 제목 영역); `ornament-glyph` → drawn + `substitute-glyph` + 진단 `MISSING_GLYPH` (§18.2); `unknown-spanner`는 유효한 그래프에서 닿지 않고, 닿으면 unapproved로 실패; `grace-after`는 구현 (같은 성부·마디·시각에 주 음이 없는 꾸밈음) | 코퍼스의 grace-after 22개는 전부 마디 끝의 뒤꾸밈음(sonatina 002·006·007·013·017) |
| G4-F3 | **RenderSource의 identity는 내용으로.** 생산자의 그래프는 그 Score 객체로, 없으면 최근 8 생산자 중 music hash가 같은 Score의 것으로 찾는다 (`agree`가 여전히 판정). resolve의 memo와 persist의 "이미 저장함"은 (곡, music hash)로. persist 실패는 세고 다음 저장이 다시 시도한다 (거절된 pending이 남지 않음) | `source.test.js` P3·P9; 페이지 검사 `u1-paths.js` 9 경로 |
| G4-F4 | **저장된 그래프를 믿기 전에.** record에 `agreeLib`(agree가 성립한 라이브러리)·`hashV`(music hash 규칙) — 둘 다 지금 것이고 schema 이전이 없으면 hash·link로 빠른 길, 아니면 `agree`를 다시 하고 통과하면 `revalidated`로 다시 저장, 실패하면 `STORE_INCOMPATIBLE`로 지운다. 바이트 무결성(fingerprint)은 **parse 전 저장된 바이트 자체**로 확인 (이전된 schema도) | `source.test.js` P4, `store.test.js` |
| G4-F5 | **IndexedDB v2.** `meta` store(key, 크기, 저장 시각)를 두어 축출은 크기만 읽는다 (그래프를 읽지 않음). v1 DB는 올릴 때 meta를 채운다. `onversionchange`·`onclose`면 연결을 닫고 다음에 다시 연다. origin 저장 공간의 80 %를 넘기 전에 쓰기를 멈춘다(`quota-guard`, `navigator.storage.estimate`) — 곡 영상(`ppp-media`)이 먼저다 | 200 record(6.3 MB)에서 축출이 쓰는 heap 39 KB (getAll 6,378 KB); v1→v2 올림 페이지 검사 |
| G4-F6 | **`fromScore`는 아는 것과 추론한 것을 나눈다.** 기본 provenance op는 Score의 기보가 PPP가 만든 것이면 `inferred` (호출자의 `opts.inferred` — 페이지는 앱의 `inferredAudioNotation` — 없으면 `sgFrom.inferred`, 없으면 source를 App 3479와 같이 읽음, `scoreNotationInferred`, 동작 대등 테스트), 아니면 `imported`. 규칙으로 짝지은·묶은 것은 객체 자신에 `inferred`: slur(옛 렌더러의 FIFO 짝), 인쇄 안 된 tuplet run, part 구성(손에서), 후보가 둘 이상이었던 tie | `fromscore.test.js` P5 |
| G4-F7 | **staff를 말하지 않는 8va는 그 part의 모든 staff를 옮긴다 (plan).** importer가 `assumed`로 표시한 8va를 `toScore`·`Score.finalize`·legacy 렌더러·재생·연습이 모든 staff에 적용하므로 plan도 그렇게 읽는다 (`covers`, 진단 `OTTAVA_STAFF_ASSUMED`). 그래프·importer·`toScore`는 바꾸지 않았다 | E18 fixture: plan이 적힌 자리를 옮기는 음 = 앱이 옮기는 음, fromScore 뒤에도 같음 |
| G4-F8 | **`agree`·`link`는 화음에 속한 것을 화음에서 읽는다.** tuplet·slur 시작/끝, accent, marcato, 음에 붙은 셈여림, 화음인지 여부. MusicXML은 이것을 화음의 `<note>` 하나에 쓰고, 앱의 reader는 그 음에, `toScore`는 tuplet을 모든 head에 둔다 — 어느 음이 먼저 적혔는지는 순서이지 음악이 아니다. 화음이 그것을 가졌는지는 그대로 비교한다 (tuplet을 잃은 화음, 음이 빠진 화음, 다른 화음으로 간 slur는 불일치) | G0 core 553 녹음: `built.graph` 대 `parseMusicXML(built.xml)` 453 → 553 일치 (실패 100개 전부 이것); `agree.test.js` |
| G4-F9 | **persist는 main thread를 오래 잡지 않는다.** music hash, Score 쪽 비교 읽기, 그래프 쪽 비교 읽기(`agreeFrom`), canonical 글, gzip이 각각 idle 뒤에 돈다 | 가장 긴 곡 3개, CPU 1×·4×에서 long task 0 (고치기 전 4×에서 59 ms 하나) |
| G4-F10 | **(beam 규칙은 G4-F15가 강화)** **한 음 tuplet 병합의 의미 경계**: 멤버가 그래프 beam 하나에 모두 있거나 모두 없어야 하고, slur가 묶음 안쪽에서 시작·끝나지 않고, clef·key가 안에서 바뀌지 않아야 한다. 인쇄 여부와 상관없이 여러 음 tuplet이 있는 성부-마디에서는 하지 않는다 (G4-U2 B "충돌하는 의미 경계 없음") | 코퍼스·전사에서 병합 수 불변 (G3 off 전사에는 beam·slur 없음) |
| G4-F11 | **G4a의 G04 §27 산출물**: E01–E40 fixture (`make-e-fixtures.js`, `--check`), R 코퍼스 manifest `tests/engrave/corpus.json` (seed `g4-r-2026-09-25`, 층별 규칙, 격리 15·hold-out 52 제외, 61 파일), plan 수준 L1 `tools/bench.js` (suite r·e·x, baseline, CI gate). **hold-out 참조는 모든 G4 테스트·세트에서 뺀다** (`helpers.corpusFiles`) | `corpus.test.js`, `e-fixtures.test.js` |
| G4-F12 | plan은 그래프의 하위 객체를 복사해 든다(참조 없음). Part 이름·약칭(여러 part의 인쇄에서 drawn), 조표 scope, tempo `display`, jump `target`·`display`, head `lead`·`tech`(tab 데이터 → deferred `tab`)를 plan과 inventory에 넣는다. 소리만 있는 첫 tempo는 화면에서 drawn `playback-tempo` (legacy 머리글의 ♩ = N, App 10918), 인쇄에서는 suppressed | `ledger.test.js`, E35 |
| G4-F13 | `vendor/`에 Petaluma·Leland OFL 고지 (빌드가 두 글꼴의 윤곽을 싣는다); 글자 metric 표(Arial, serif, PetalumaScript)는 윤곽 없음을 테스트가 확인 | `vendor.test.js` |
| G4-F14 | 알려진 한계로 기록 (고치지 않음): 그래프는 명시된 `bracket="yes"`를 기본값과 구별하지 못한다 (schema 기본 true, importer는 `no`만 적음) — beam과 멤버가 같은 tuplet은 §12.1 규칙대로 괄호 없이 그려진다. G4는 schema를 바꾸지 않는다 | 코퍼스 318 파일: 규칙으로 괄호 없는 tuplet 77, 평문 XML의 `bracket="yes"` 시작 21 (2 파일, 영향 상한 18) |

### G4a 최종 (owner finalize, 최종 리뷰의 BLOCKER 1·MAJOR 5, G04 §32.13) — 2026-09-25

Fixer(`0f3d275`) 위에서 G4a를 마무리한 세션의 결정. 설계(G04 §0–§30)는 바꾸지 않았다.

| ID | 결정 | 증거 |
| --- | --- | --- |
| G4-F15 | **한 음 tuplet 병합과 graph beam (G4-U2 B, 최종 리뷰 BLOCKER).** 그래프 beam이 있는 part에서는 **그래프 beam 하나의 음이 묶음의 음과 정확히 같을 때만** 병합한다. 모서리를 넘는 beam, 묶음 일부만 덮는 beam, 두 묶음을 덮는 beam(애매), 파일이 깃발로 둔 음(beam 없는 멤버)은 모두 경계 → 병합 없음. 멤버의 head가 다른 staff에 있어도 병합 없음. beam이 없는 part는 G4-F10 그대로 | 리뷰의 반례 beams [0,1][2,3][4,5]와 [0..3]이 이전 코드에서 [0,1,2] 병합을 만들었다 → 지금 병합 0, 그래프 beam·tuplet 그대로 그림. 코퍼스·전사의 병합 수 불변 (L1 x 30, e 3, r 0) |
| G4-F16 | **review 화면의 곡 변경은 바로 저장한다 (최종 리뷰 MAJOR).** `rewriteRhythm`, `rewriteFromHeard`, `applyRichReviewArrangement`, `acceptRecognition`은 setState 콜백에서 `saveNow()` — slot과 그래프가 곡이 바뀔 때 쓰인다. pagehide의 idle 쓰기에 기대지 않는다 | 고치기 전: 다시 쓰기 → 다시 불러오기에서 projected (`STORE_OTHER_SCORE`), 연주층·마디 anchor·inferred provenance 잃음. 고친 뒤 실제 UI 흐름 §32.13 |
| G4-F17 | **resolve는 다른 Score의 기록을 지우지 않는다.** 저장된 기록이 다른 Score의 것, 음악이 바뀐 것, 다시 agree되지 않는 것이면 쓰지 않고 진단만 — 지우지 않는다 (묻는 Score가 저장되지 않은 review 편곡일 수 있다). 읽을 수 없는 기록(store.get)과 음이 link되지 않는 기록만 버린다 | 두 리뷰어 공통 MINOR: review 편곡을 resolve하자 곡의 유효한 그래프가 지워짐. `source.test.js` |
| G4-F18 | **`fromScore`의 slur 짝은 앱이 그리는 규칙.** (staff, voice) 사슬에서 start는 다음 stop까지 (legacy 렌더러, App 11138; 화음의 끝은 어느 음이든, App 11605). 두 start가 한 stop을 나눌 수 있고, 어느 start도 닿지 않는 stop은 열린 끝으로 이름. 모두 op `inferred` | 리뷰 #4 (FIFO는 앱의 짝이 아님). Score의 끝 flag는 그대로 돌아온다 (A48) |
| G4-F19 | **`fromScore`는 화음을 음 순서와 상관없이 자리로 묶는다.** `Score.finalize`는 음을 위치·staff로 정렬하므로 staff를 넘는 화음의 첫 음(chord:false)이 뒤에 올 수 있다 | A48을 앱의 finalize로 돌리자 cross-staff 두 파일이 `notes.chord`로 달랐다 → 고친 뒤 정확 |
| G4-F20 | **A48 gate.** (A) Node 테스트: 커밋된 import 파일 전부(544 = 504 + E fixture 40)를 앱이 가진 모양 `finalize(toScore(g))`(앱의 `Score.finalize`를 파일에서 꺼내 씀)로, `writtenP`·`writtenMidi`·`approx`·`soundingMidi`·`ottavaShift`까지 엄격 비교; 알려진 손실은 파일·code·바뀔 수 있는 필드로만 허용. (B) 페이지 gate `a48-coverage.js`: core 553 (live·projected·slot 왕복·이전된 녹음), 코퍼스 318 (앱의 옛 reader, 이름 있는 손실 7), OMR 2 — 같은 비교기(`tests/engrave/a48-compare.js`, 화음에 속한 flag는 화음에서, G4-F8), 실패하면 exit 1 | §32.13 |
| G4-F21 | **장식음 glyph 표는 처분만 정한다 (G4-U5).** `glyphs.js`는 schema 장식음 → SMuFL 이름과, 고정 글꼴에 없는 glyph 목록(글꼴 파일과 양쪽으로 대조). 없으면 deferred `ornament-glyph`, schema가 모르면 `unsupported`. 무엇으로 대신 그릴지는 G4d | `glyphs.test.js` |

### G4b 구현 중 결정 (배치 핵심, G04 §33) — Implementer, 2026-09-25

브랜치 `g4b-layout-core` (`a0bc2ea`에서). 병합 안 함. G4a MINOR 여섯의 처리는 G04 §33.2.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-B1 | **layout core(`metrics`·`space`·`breaks`·`skyline`·`canon`·`layout`·`practice`)는 앱이 불러오지 않는다** — G4f의 스위치 때까지. `index.js`는 Node에서 늘, 브라우저에서는 페이지가 불러왔을 때만 내보낸다(없으면 `PPPEngrave.layout` null). 바뀐 G4a 파일이 사용자에게 닿도록 engrave script 태그만 `?v=3` | 앱에 미리 싣기(보이지 않아도 production 바이트가 늚), 별도 index | 지시: 렌더러 비가시·production 변경 없음. `app.test.js`가 둘 다 확인 |
| G4-B2 | **EngravedScore `engr/1`**: staff space, y 아래, 0.01 반올림; 객체 ID는 그래프 ID(+접미사) 또는 `d:` 장식; glyph는 `origin`·`scale`, 기둥 요소는 `anchor`; VexFlow가 path로 그리는 모양은 `drawn`; `coverage.pending`이 뒤 단계의 것을 센다; system의 `space`(작은 보표). G04 §8.4의 모양 + 이것들 | 좌표 없는 plan에 바로 그리기, 백엔드 요소 ID | G04 §33.4 |
| G4-B3 | **간격 상수**: rod 간격 0.3, 세로줄 뒤 1.2·앞 1.0, 첫머리 뒤 1.5, tie 시작 기둥 ≥ 2.0, 뒤따르는 clef 앞뒤 0.5; u는 system마다 조각별 선형을 정확히 풀어서; 마지막 system은 앞 u의 중앙값으로 폭의 80 % 이하면 ragged. system 하나 = segment 목록 하나 — 줄바꿈·폭 풀이·배치가 같은 목록을 읽는다 | 이분법, 줄바꿈과 배치의 따로 계산 | 서로 어긋날 수 없게; 결정론 |
| G4-B4 | **layout hash는 canonical JSON의 FNV-1a 64** (G04 §8.4의 sha256 대신) — ScoreGraph fingerprint와 같은 함수 | sha256 (브라우저는 비동기 `crypto.subtle`뿐) | Node = Chrome 808/808 (§33.11) |
| G4-B5 | **폭에 안 들어가는 system은 작은 보표로**: rod만으로도 넓으면 `space = max(0.5, W / 최소 폭)`로 x·y·glyph·보표선을 같이 줄인다 (`SYSTEM_SCALED`); 0.5로도 넘치면 `SYSTEM_OVERFLOW`. 잘림·겹침은 없다 | 넘치게 두기(가로 scroll), rod 아래로 압축(겹침), 마디 쪼개기 | 휴대폰의 16분음표 마디(코퍼스 15곡 72 system). 넘침은 원본 결함 1곡뿐 |
| G4-B6 | **G4-U4 줄바꿈 비용**: `12·(k−N)²`(마지막은 k > N만) + `400·(1−s)²`(s < 1) + `60·(s−1.5)²`(s > 1.5, 마지막 제외) + 1마디 50(마지막 60); 가능 조건 최소 폭 × 1.05 ≤ W; 최대 12마디; 1e-9 비교, 긴 system 먼저 | 고정 N(지금 앱), 인쇄용 Knuth–Plass 그대로 | 보통 4/2, 빽빽 < N, 성김 > N, 외톨이 마지막 마디 없음; 피할 수 있었던 1마디 system 0 |
| G4-B7 | **보표는 skyline clearance로 맞물리게, system은 띠로 (맞물리지 않게)**. H6: 서로 다른 보표의 요소끼리 상자 겹침(세로줄이 part 안 다음 보표에 닿는 것은 설계), system 상자끼리 | 보표도 띠(너무 벌어짐), system도 skyline(hit·scroll 상자가 겹침) | §15.3; 연습 map의 system hit-test |
| G4-B8 | **glyph metric은 vendored Bravura에서 생성** (`make-metrics.js`, `--check`를 CI에). slash 머리는 VexFlow가 그리는 모양(1.5 × 2 sp)으로 `DRAWN`, 글꼴에 없는 cross 머리는 x 머리로 대체하고 `GLYPH_FALLBACK` | 손으로 옮긴 표, DOM 측정 | A29; `eg.glyph.fallback` 0 (코퍼스·E) |
| G4-B9 | **가까이 보기 창은 config `window: [첫, 끝]`** — 그 마디만 system으로 (§15.2 "창 경계를 system 경계로"). 창의 마지막 system은 곡이 거기서 끝날 때만 마지막(ragged) | 전곡 layout에서 잘라 쓰기 | B2 (창 p95 0.39 ms), 캐시 키에 포함 |
| G4-B10 | **연습 map은 EngravedScore에서 한 번, highlighter는 두 포인터**: 시간은 앱처럼 4분음표, onset 키는 legacy `data-onset`, `legacyMap()`은 `_map` 모양. 앞으로는 바뀐 event만, 뒤로 seek는 가장 긴 음 길이 안의 event만 다시 본다. layout을 부르지 않는다 | 프레임마다 전부 훑기(지금 앱), DOM에서 bbox | B6, A31 (만진 수 = 바뀐 수) |
| G4-B11 | **(G4c의 G4-C3이 대체: stem 아래 성부를 오른쪽으로 — §14.2, VexFlow, Gould)** ~~**성부 사이 2도·unison(머리를 나누지 못할 때)은 stem 위 성부를 오른쪽으로** — stem 아래 성부가 제자리, 두 stem이 바깥 (`layout.js` `staffColumn` 303–315). **G04 §14.2와 다르다**: §14.2는 아래(`down`) 성부를 오른쪽으로 적었다. G4b는 이 규칙으로 커밋된 layout hash를 고정했고 Fixer 범위는 `layout.js`를 바꾸지 않으므로 G4b에서는 그대로 둔다. **최종 규칙은 G4c**(§14.2의 성부·unison 공유가 G4c 범위)가 E12·E13·찬송가 그림으로 정한다: 지키면 §14.2를 고치고, §14.2를 따르면 코드와 hash를 바꾼다 (GEOMETRY_ONLY) (Fixer, G04 §33.16.5)~~ | §14.2대로 아래 성부를 오른쪽 (두 stem이 가운데서 한 줄) — G4b에서 바꾸면 커밋된 hash와 Fixer 범위를 넘는다 | 코드: E12에서 2도(v5 위 5.5, v6 아래 6.0)와 unison 둘 모두 stem 위 v5가 오른쪽 (머리 x0 10.66 대 9.48). 테스트: `layout.test.js` intrinsic widths(같은 음 두 성부는 나란히), `eg.overlap.head_head` 0 (코퍼스·E, 두 config), 커밋된 hash (E12, R 찬송가). Gould(*Behind Bars*)는 Implementer가 "stem이 바깥"의 근거로 코드에 적었다 — Fixer는 해당 쪽을 확인하지 못했다. **반대 증거**: vendored VexFlow 4.2.3의 `StaveNote.format`은 두 stem이 반대면 stem 아래 음에 `setXShift` (§14.2와 같음) |

### G4c 구현 중 결정 (beam, stem, tuplet, 성부, 쉼표, 꾸밈음, SVG — G04 §34) — Implementer, 2026-09-25

브랜치 `g4c-notation-core` (`1c92fc4`에서). 병합 안 함, PR 없음. G4b backlog의 처리는 G04 §34.9.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-C1 | **폭과 무관한 것은 `prepare`, 폭에 달린 것은 system마다 `layout`**: stem 방향·최종 stem·flag, 성부 비킴, unison 공유, 쉼표 기본 높이·병합, 꾸밈음(stem·flag·사선·점·beam)은 `prepare`; beam(기울기가 가로 거리에 달림), 성부 쉼표 옮기기(beam을 비켜야 함), tuplet은 x가 정해진 뒤 `notateSystem`에서, 작은 보표 축소와 세로 쌓기 전에. 기하 도우미는 새 `engrave/notation.js`(순수). 새 객체 필드는 `dir`, `beam`, `events`, `level`, `hook`, `line`, `t`, `side`, `hooks`, `gap`, `hookLen`, `merged`, `center` — 축소·세로 이동이 `line`·`gap`도 옮긴다 | beam을 `prepare`에서 (폭마다 기울기가 틀림), VexFlow `Beam`으로 (DOM 없는 결정론은 되지만 PPP의 간격·충돌 체계 밖) | G04 §10.2 순서 1–4; 결정론 (Node = Chrome 808/808) |
| G4-C2 | **beam 기하**: 방향은 그래프 → 역할 → `autoDir`(가장 먼 머리의 반대, 같으면 다수, 그래도 같으면 아래); 기울기는 첫·끝 머리 높이 차의 절반(최대 1 sp)을 가로 거리로, 0.25로 자름, 같은 높이·오목이면 수평; 가장 짧은 stem이 `max(3.5, 2.5 + 0.75(n−1))`; **가운데 줄 규칙은 한 성부 staff-마디에서만** (beam 없는 stem도); 음이 단 임시표·점·머리·덧줄에서 0.25 sp 떨어질 때까지 바깥으로; secondary는 break 레벨에서 끊고 hook은 §11.2의 방향, 길이 min(1.18, 이웃까지 0.6); system·staff마다 조각, 한 stem 조각은 flag | VexFlow 기울기 탐색 그대로(비용 함수가 PPP 규칙과 다름), 두 성부에서도 가운데 줄 규칙 (for-all-the-saints에서 beam이 다른 성부 머리로 들어감) | A21 (기울기 최대 0.25, 짧은 stem 0, 머리 가로지름 0), A26 |
| G4-C3 | **G4-B11을 대체: 성부 사이 2도·모양이 다른 unison·교차에서 stem 아래 성부가 오른쪽으로, 머리 폭 + 0.2 sp** (G04 §14.2 그대로). 충돌은 머리끼리, stem(beam에 든 것은 8 sp로 봄)이 다른 성부 머리를 지남, flag가 머리에 닿음; 옮기는 성부는 앞 성부 전체(머리·stem·flag)의 오른쪽 끝을 지나서; 세 번째 성부는 둘을 다 지나 | G4b 규칙(stem 위 성부를 오른쪽, "stem이 바깥") | VexFlow 4.2.3 `StaveNote.format`: 반대 stem이면 아래 음에 `setXShift(h + 2)`; Gould *Behind Bars* p. 53 "Offset the lower part to the right" (MuseScore 포럼에 인용된 문장, 책은 확인 못 함); legacy 렌더러가 VexFlow로 그리므로 사용자가 보던 모양. 결과: `eg.voice.stem_over_head` 216 → 0 |
| G4-C4 | **unison 공유와 쉼표 병합은 EngravedScore의 `merged`로**: 그래프 head(쉼표)마다 객체가 남고 같은 상자에서 서로를 이름 댄다 (공유 임시표도); plan ledger는 `drawn`. 공유 조건: stem 반대, 같은 적힌 음·alter, 같은 머리 glyph, 같은 점, 둘 다 제자리 머리, 임시표 같거나 하나, 나머지 충돌 없음. 병합: 한 기둥·staff에 음 없이 같은 길이·모양·점으로 쉬는 성부들 | §14.2·§14.3 문구대로 plan ledger `merged` (plan은 glyph 모양·기둥을 모름; 둘 다 그려지는데 한 객체만 남기면 연습 map이 한 성부를 잃음) | 코퍼스 공유 머리 1,778, 병합 쉼표 242; `skyline.collisions`와 `l2.js`는 서로 이름 댄 같은 상자를 충돌로 안 봄 |
| G4-C5 | **한 음 tuplet은 숫자만** — `plan-tuplets.js`의 괄호 기본값이 멤버 하나면 거짓 (명시된 `show.bracket`은 이김). `bench.js`의 plan 수준 `eg.tuplet.show_ok` 기대값도 같게 | plan은 §12.1대로 괄호, layout에서만 뺌 (plan과 그림이 다름) | G04 §12.3 "멤버마다 숫자 3 (괄호 없이)"; 코퍼스 5개(E07 3, 전사 2) |
| G4-C6 | **tuplet 배치**: 쪽은 명시 → 성부 역할 → 멤버 stem 다수(beam 쪽) → 위; 언제나 보표 밖, 덮는 것에서 0.5 sp; 괄호는 수평, 끝 갈고리 0.75 sp, 숫자가 괄호를 끊음; 숫자는 `timeSig` 숫자 glyph × 0.6 (VexFlow의 tuplet point = 글꼴 3/5; 고정 글꼴에 `tuplet0–9` 없음), `both`의 콜론은 점 둘; 안쪽 tuplet 먼저 놓아 바깥이 그 위로; system을 넘으면 조각마다, 숫자는 첫 조각에 | 보표 안의 숫자, 멤버 높이를 따르는 기울어진 괄호 | A4; 겹침 0; M-H1에서 조정 가능 |
| G4-C7 | **쉼표**: 기본 높이(명시 `pos`, 아니면 온쉼표 넷째 줄, 2분쉼표 가운데 줄 위, 나머지 가운데), G4b의 ±2 sp 없앰; 성부가 둘 이상인 staff-마디(**쉬기만 하는 성부도 셈** — up/down은 그래프 성부 순서로) 또는 beam 밑이면 beam 뒤에 한 staff space씩 바깥으로, 다른 성부의 것과 어느 beam에서든 0.5 sp까지; **마디 쉼표** = `measureRest` 또는 그 성부의 마디 안 유일한 event로 마디 전체를 쉬는 쉼표 → 온(겹온)쉼표, 점 없음, 가운데 (R6) | 역할마다 고정 ±2 sp (G4b: 189 충돌), plan 역할만 보기 (쉬기만 하는 성부의 쉼표를 안 옮김) | A26 `eg.rest.overlap` 189 → 0; A11 |
| G4-C8 | **꾸밈음**: stem은 그래프·역할, 없으면 위; 0.66; flag(beam 없을 때), 사선(첫 stem, 끝 근처), 점, beam은 그래프 beam만(꾸밈음만의 beam, 0.66 두께·간격, 가운데 줄 규칙 없음); 묶음 폭에 flag·사선 포함 | "둘 이상이면 beam"을 파생으로 (plan에 없는 beam — 그래프 beam 없는 part의 꾸밈음은 코퍼스 0) | A7; `eg.grace.*` 0 |
| G4-C9 | **`svg.js`**: staff space viewBox, px 크기, 0.01, `currentColor`; glyph는 `<symbol overflow="visible">`(윤곽은 생성된 `engrave/outlines.js`, 글꼴 단위 정수, `scale(1/360, −1/360)`) + `<use href>`; stem·덧줄·세로줄은 rect, beam은 path; §16.4 계약 — 마디·staff마다 `g.ppp-stave`(legacy 값), event·staff마다 `g.ppp-note.vf-stavenote[data-onset][data-ev]`, 쉼표 `data-rest`, 꾸밈음은 `g.ppp-grace`, `g.ppp-tuplet`, `vf-*` class; 뿌리 `data-plan`, layout hash는 요청 시만 | 런타임에 VexFlow에서 윤곽 읽기 (engrave/가 VexFlow를 부름, A29), 글꼴 단위 → sp 소수 path, glyph마다 path 반복 (legacy 방식, B9의 원인) | B9 0.19–0.28; R7 (Chrome의 `<use>` 상자 오차 ≤ 0.01 sp); hash 45–125 ms > SVG 9 ms (sonatina/020) |
| G4-C10 | **layout 수준 metric은 영목표 개수, 그래프에 대어**: `l2(…, {graph})`가 beam·tuplet을 그래프에서 읽는다 (plan 결함도 잡게); §21.1의 render 판 비율을 개수로 (`eg.beam.graph_missing`, `eg.tuplet.missing`·`show_errors`·`suppressed_rendered` …) — 두 config 합이 비율이면 안 되므로; G4b ratchet 둘을 ZERO로 옮기고 `RATCHET`을 없앰; `eg.beam.slope_max`만 최댓값(한계 0.25); 겹침은 1/100 sp 정수, beam은 띠로; 정책 검사는 머리 자리를 반 칸으로 읽음; baseline에 없는 영목표 metric은 실패 | plan 수준 비율만 (layout이 버려도 안 보임), 비율 합산 | A42의 정신: 모든 새 검사를 mutation이 잡음 (M1–M5, M16, M24) |
| G4-C11 | **마디 안 조 변경**: 시간 없는 기둥(같은 시각의 clef 다음), 모든 staff에, 바로 앞 조의 제자리표와 함께; system 머리(`keyAt`)·courtesy·마디 경계 변경의 취소(`keyAtEnd`)가 마디 안 변경까지 읽음 | `pending`으로 둠 (G4b) | §15.4; `eg.layout.signature_diff` 0 |
| G4-C12 | **작은 것**: 마지막 ragged system의 u는 전체 크기 system의 u만으로 (R11); canonical은 유한하지 않은 수에서 예외 (O1); `normalizeConfig`가 폭을 0.01로 — 캐시 키 = 배치한 config (O2); 커밋된 layout hash는 `tools/layout-diff.js`로 분류한 뒤 다시 bless (§21.3: LEDGER_CHANGE 146, GEOMETRY_ONLY 20, SERIALIZATION_ONLY 68, SAME 2) | — | G04 §34.9, §34.15 |
| G4-C13 | **성부 사이 비킴의 양과 flag (Fixer, 리뷰 R1)**: 공유 unison의 두 머리는 stem 검사와 **flag 검사** 모두에서 건너뛴다 — 제 flag가 공유 머리에 닿는 것은 충돌이 아니다; 옮기는 성부는 부딪힌 성부의 머리·stem 오른쪽 끝 + 0.2 sp로 가고, 그 성부의 flag는 **flag의 세로 범위가 옮기는 머리와 겹칠 때만** 넘는다 (stem 위 8분 아래의 2도는 머리 폭 + 0.2 sp); 공유 머리를 건너뛰는 것은 두 성부가 한 자리일 때만, 옮김 양은 되풀이 중 줄지 않음; 셋째 성부 때문에 옮겨진 unison은 공유를 푼다 (`merged` 없음) | flag 오른쪽 끝을 언제나 넘기 (`f5517fe`: 2도·flag unison이 2.31 sp — 1.1 sp 간격이라 잇단 두 음처럼 읽힘); flag를 전혀 보지 않기 (flag가 옆 머리 높이까지 내려오는 공유 못 하는 unison·교차에서 잉크가 겹침) | §14.2 (unison 공유 MUST), G4-C3 (머리 폭 + 0.2 sp — VexFlow `h + 2`는 flag를 보지 않음); 같은 모양 한 음 unison 909/909 공유; `eg.voice.unison_unshared` 70 → 0, `eg.voice.offset_err` 10 → 0 (E + 코퍼스 × 2); G04 §34.18.2 |
| G4-C14 | **합법 병합 (Fixer, 리뷰 R2)**: `l2.js`는 layout의 `merged`를 믿지 않는다 — 서로 이름 대고 한 자리이며 **머리**(다른 성부, 같은 적힌 음·glyph·크기·점, stem 반대 또는 둘 다 없음), **쉼표**(다른 성부, 같은 마디·시각·glyph·길이·점, 그래프가 말한 자리 없음), **임시표**(같은 glyph, 그 머리들이 합법 짝)일 때만 합법; 합법 짝만 겹침 수와 `stem_over_head`의 제 머리 예외에서 빠지고, 나머지는 `eg.voice.merge_illegal` (영목표) | layout의 `merged`를 그대로 믿기 (`f5517fe`: 리뷰 mutation RF·RK가 layout hash로만 잡힘) | RF·RK·F3이 이름으로 잡힘; `f5517fe`의 for-all-the-saints 결함(떨어진 두 머리가 서로를 이름 댐) 4 → 0; G04 §34.18.3 |
| G4-C15 | **G4c 규칙의 이름 붙은 metric (Fixer, 리뷰 R1·R2)** — 모두 영목표 (`bench.js` ZERO, `layout.test.js` ZERO_L2; baseline r·e·x는 키만 더함): `eg.voice.unison_unshared` (한 음 두 성부 unison — 같은 적힌 음·임시표·glyph·크기·점, stem 반대 — 이 합법 공유가 아님), `eg.voice.offset_err` (한 기둥의 두 성부가 나란하면 옮긴 쪽 머리 왼쪽 = 남은 쪽 머리·stem 오른쪽 + 0.2 sp, flag는 옮긴 머리와 세로로 겹칠 때만; 0.02 안), `eg.stem.middle_line` (한 성부만 소리 나는 staff-마디의 stem이 가운데 줄까지; beam은 그 조각의 stem이 모두 그럴 때; 꾸밈음 제외), `eg.rest.position_err` (쉼표 원점이 출발 자리 — 그래프가 말한 자리, 아니면 온·겹온쉼표는 가운데 위 줄, 나머지는 가운데 줄 — 에서 staff space 정수배), `eg.beam.hook_side_err` (§11.2의 hook 쪽 — 조각의 첫 음 오른쪽, 끝 음 왼쪽, 점음표 뒤 왼쪽, 앞 음과 같은 박 왼쪽, 아니면 오른쪽 — 과 `hook` 값·그린 쪽), `eg.tuplet.hook_dir_err` (갈고리가 음 쪽으로, `hookLen` > 0) | layout hash(A27)로만 잡기; 단위 테스트 하나(A2의 점음표 뒤 hook)에만 기대기 | A42의 정신 — 새 규칙마다 source mutation이 이름으로 잡음 (RI 8, RY 20, RB 108, RB2 56, RX 4, F1 2, F2 2, probe × 두 config); 모두 `l2.js`의 제 코드 (O4); G04 §34.18.3–§34.18.4 |
| G4-C16 | **E12·E13에 §22.1의 두 경우와 다시 bless 8 (Fixer, 리뷰 R2)**: E12에 2마디 — 점 다른 unison, flag 8분 unison과 2도(R1); E13에 2마디 — 동시에 쉬는 4분·2분 쉼표(병합 안 함); 커밋된 layout hash는 8/236만 — E12·E13 × 2 (fixture 내용; E12는 R1도), what-child-is-this·czerny849/007 × 2 (R1, GEOMETRY_ONLY); `layout-diff.js`(`f5517fe` 대비, 지금의 fixture) SAME 230, GEOMETRY_ONLY 6 | 새 fixture 없이 코퍼스 곡만 probe로 | §21.3, §22.1의 목록; L1 그대로, L2 전부 0; G04 §34.18.5 |

### Lead 결정 (G4 단계 경계, `docs/PPP_MASTER_ROADMAP.md` §5.1) — 2026-09-25

| ID | 결정 | 근거 |
| --- | --- | --- |
| G4-L1 | **G4b는 geometry-only로 닫는다.** 옮긴 곳:<br>- `svg.js`(+B9) → G4c;<br>- 앱 통합 + A32·A33 → G4d-2 (M-H1 전, 기본값 `'legacy'`). 앱 통합은 개발용 renderer 스위치, 새 `sync`, 캐시 가능한 전송, `agree.ok` 요구다;<br>- A30 전체와 페이지 수준 A35–A37 → G4f.<br>G04 §27의 단계 표를 이렇게 읽는다 | - G4b 구현(§33.1)이 이미 이 경계다.<br>- Node만으로 판정 가능한 한 단위다.<br>- 19k줄 앱 파일을 세 단계 연속 건드리지 않는다.<br>- 사람 평가는 실제 PPP 렌더러에서 한다 (G3-U8·G3-U10의 교훈). |
| G4-L2 | **G4-C4를 승인한다**: 성부 사이 unison의 음표머리 공유는 EngravedScore에 `merged`(두 머리가 서로를 가리킴)로 적고, plan의 fidelity ledger는 `drawn`으로 둔다. §14.2·§14.3의 "ledger `merged`"는 이 뜻으로 읽는다. **조건**: L2의 합법 병합 검사 `eg.voice.merge_illegal`(다른 성부, 같은 적힌 음·glyph·크기·점, 반대 stem)이 zero-target gate로 있을 때만 | G4c 리뷰 M5; 공유는 plan이 아니라 배치의 결과다 (세 번째 성부가 한 성부를 밀면 공유가 풀린다 — §34.18의 for-all-the-saints m.10) |
| G4-L3 | **G4d-1을 두 병합 지점으로 나눈다.** G4d-1a: §13 곡선(tie·slur·glissando), `place()`, 음에 붙는 기호(§10.2 순서 3–7), §18.3 글자 metric 표, G4c 리뷰의 음 수준 이월. G4d-1b: system에 붙는 기호(순서 8–11: 셈여림·hairpin·pedal·ottava·volta·코드명·tempo·rehearsal·jump·words·가사), §15.3 세로 배치, §15.4 courtesy, B9 다시 재기. 각각 독립 리뷰 한 번 | G4c 한 단계가 3,900줄이었다. G4d-1 전체는 그보다 크고, 리뷰 하나로 보기에는 넓다. 음 쪽 기호가 끝나야 system 쪽 기호와 세로 배치의 skyline이 정해진다 |
| G4-L4 | **화음 tie의 방향은 그 화음 안의 자리로 정한다** (§13.1을 고침). 한 성부 화음: 맨 위 머리의 tie는 위, 맨 아래는 아래, 위 절반은 위, 아래 절반은 아래, 홀수 화음의 정가운데 머리는 stem 반대. 음 하나는 stem 반대, 두 성부는 위 성부 위·아래 성부 아래 (그대로). **tie 끝은 그 화음의 어떤 다른 머리보다 자기 머리에 가깝다** (stem 너머로 비킨 2도 포함). A22의 "화음 앞" 허용을 이 검사로 바꾼다 | G4d-1a 리뷰 R1: 가운데 줄 기준이면 화음 tie 42개 중 35개가 한쪽으로만 휘고, 비킨 2도 7곳에서 tie가 어느 음 것인지 모호하다. 판각 관례 (바깥 tie는 화음 밖으로) |
| G4-L5 | **운지를 slur보다 먼저 놓는다** (§10.2 순서: tie → tuplet → articulation·꾸밈·fermata·tremolo → **운지** → slur·glissando). slur는 운지를 비킨다. staccato·tenuto는 운지 안쪽에 남는다. §10.5 `FAR_PLACEMENT`를 구현한다: staff에서 8 sp 넘게 놓인 항목은 진단하고 `eg.layout.far_placements`(기록)로 센다. `eg.fingering.far`(zero-target)를 둔다 | G4d-1a 리뷰 R2: slur 다음에 놓으면 운지가 phrase slur 위로 밀려 음에서 4–14 sp 떨어진다 (코퍼스 198개가 8 sp 넘음). 피아노 판본은 운지를 음 옆, slur 안쪽에 둔다. 연습 앱에서 운지가 음에서 멀면 읽을 수 없다 |

### G4d-1a 구현 중 결정 (곡선, 음에 붙는 기호, 배치 함수, 글자 metric — G04 §35) — Implementer, 2026-09-25

브랜치 `g4d1a-curves-marks` (`d4b5b86`에서). 병합 안 함, PR 없음. G4c 리뷰의 이월 처리는 G04 §35.7.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-D1a-1 | **출력이 바뀌면 버전을 올린다.** `plan()`의 출력이 바뀌면 `PLAN_VERSION`, `layout()`의 출력이 바뀌면 `engr/N`을 병합 지점마다 한 번 올린다. 이번: `plan/1` → `plan/2` (G4c의 한 음 tuplet 괄호 기본값 + 타악기 head의 `kit`), `engr/1` → `engr/2` (G4c의 기보 + G4d-1a의 곡선·기호). planKey와 `svg` `data-plan`이 plan 버전을 싣는다 — G4d-2의 캐시는 (그래프 fingerprint, plan 버전, config, `engr` 버전)을 키로 쓴다. 지킴이: `layout-hashes.js --write`는 merge base(origin/main)의 hash와 다른데 `VERSION`이 그때와 같으면 쓰지 않는다 (음성 대조: `engr/1`로 되돌리면 exit 1); `layout-diff.js`는 버전 이름만 다른 쌍을 `SERIALIZATION_ONLY (version)`으로 가른다 | 캐시 키를 출력 hash로 (hash가 비쌈 — sonatina/020 45–125 ms, G4c), 버전을 G4d-2에서 한꺼번에 | G4c 리뷰 M4, G4-L3; G04 §35.7 |
| G4-D1a-2 | **글자 폭 표 (§18.3)**: 앱이 Google Fonts에서 받는 family의 정적 TTF 다섯(Instrument Serif 보통·기울임, Figtree 400·700, JetBrains Mono 400)을 버전 박힌 gstatic URL + sha256으로 고정; advance width를 1/1000 em 정수로, 문자 집합은 Latin-1·대시·따옴표·말줄임·♭♮♯; kerning 없음; 없는 글자 0.6 em + `TEXT_GLYPH_MISSING`; 글꼴 파일은 커밋하지 않음 (gitignore 캐시). `--check`: 형식과 digest는 늘, 글꼴이 있으면 바이트 재생성 — CI는 `--check --fetch`. **운지는 sans(Figtree) 1.4 sp** — §18.3은 운지의 역할을 적지 않았다 | VexFlow에 든 Arial·serif 표 (페이지가 쓰는 글꼴이 아님), DOM 측정 (A29), 글꼴 파일 커밋 | G04 §35.6 |
| G4-D1a-3 | **배치 함수 하나** `Skyline.put({x0, x1, h, side, pad, limit, floor, snap})` — skyline(음 요소, 앞서 놓은 것; 보표선 제외) 바깥 pad에, `limit`(보표 가장자리, 또는 null이면 보표 안도) 안쪽으로 들어가지 않고, 아무것도 없으면 `floor`(제 음)에서; `snap`은 바깥으로만 옮김. 옛 `place()`는 이것을 부른다 (volta). tie는 규칙으로 놓고 skyline에 더한다; tuplet은 `put()`으로 — 괄호는 보표 밖, **괄호 없는 숫자는 beam 옆, 보표 안이라도 빈 곳** (G4-C6의 "언제나 보표 밖"을 숫자에 대해 대체, G4c 리뷰 M2) | 기호마다 따로 된 자리 계산 (M8이 끌 한 곳이 없음) | §10.1; M8 |
| G4-D1a-4 | **음에 붙는 기호의 쪽과 순서**: 한 성부면 stem 반대, 여러 성부면 성부 쪽; stem 쪽이면 stem 가운데에 맞춰 stem 끝(beam) 너머; 꾸밈 기호는 위(아래 성부 아래), fermata는 위(뒤집힘·아래 성부 아래); 안→밖 staccato·staccatissimo·spiccato·detached-legato < tenuto < accent·stress·unstress < marcato < 꾸밈 기호 < fermata; staccato·tenuto류만 보표 안(칸 가운데로), 나머지는 보표 밖; detached-legato는 staccato 위 tenuto; 고정 글꼴에 없는 spiccato·stress·unstress는 대체 glyph + `GLYPH_FALLBACK`; 숨표·caesura는 음 뒤(가로 간격); 세로줄 fermata는 맨 위 staff 위(뒤집힘은 맨 아래 staff 아래); tremolo는 stem 위 0.8 sp 간격 획 | 모두 머리 쪽 (두 성부에서 stem을 가로지름 — sonatina/017에서 처음 그린 모양), accent를 보표 안에 | §10.2 순서 5; E15, sonatina/017 PNG |
| G4-D1a-5 | **Tie**: 모든 plan tie를 head가 그려진 대로 — 한 system `whole`, 넘으면 `start`(system 끝까지)·`end`(첫 기둥 1 sp 앞부터), 한쪽만이면 그 반쪽(열린 tie 2 sp); 추론 tie도 (U2 A); 방향은 §13.1 그대로(화음은 가운데 줄 기준); 가장 바깥 머리·stem 반대·(시작은) 점 없음이면 머리 가운데 ± 0.2 sp에서 가장자리 0.15 sp 바깥, 아니면 그 높이에 event가 그린 것 너머 0.15 sp; 높이 clamp(0.15·길이 + 0.2, 0.5, 1.2). **A22 끝점 오차**는 머리까지 — 단 2도로 stem 너머에 비킨 머리, 또는 화음의 임시표가 tie 높이를 덮는 머리는 그 앞면(비킨 두 머리와 사이의 stem, 그 임시표)까지: tie는 stem·다른 머리·임시표를 넘을 수 없다 (코퍼스 7쌍; 기준 0.5 sp는 그대로) | 추론한 마디 안 tie 숨김 (O4, M12), 비킨 머리까지 stem을 넘어 그리기 | §13.1; sonatina/020·024·028 |
| G4-D1a-6 | **Slur**: 그래프 짝; 방향 placement → 성부 → stem; 머리 쪽 끝은 머리 가운데에서 머리 위에 선 것(가장자리 0.2 sp 제외)의 바깥 0.25 sp, stem 쪽 끝은 stem ± 0.2 sp의 stem 끝·flag·beam 바깥(§13.2의 "stem 길이의 2/3"이 아님 — flag·beam과 부딪힘), 그리고 그 음의 기호는 어디서든 바깥; **두 제어점을 따로** 올림(칸마다 A·k1 + B·k2 ≥ 필요량, k1 + k2 최소 중 가장 고름, 0.35배 이상), 안 되면 끝을 0.5 sp씩 6번, 그래도 안 되면 `SLUR_COLLIDES`; 짧은 것 먼저; 반쪽의 자유 끝은 끝 앞 4 sp의 음 바깥, 가운데 system은 평평한 `mid` | 같이 올리는 대칭 포물선(SLUR_COLLIDES 72), skyline 칸으로 끝점(이웃의 꾸밈음 beam을 넘어 2.6 sp 뜸) | §13.2; czerny849/017 등 |
| G4-D1a-7 | **운지**: 그래프 placement → part의 첫 staff 위·둘째 아래; 화음은 머리 순서로 쌓아 위 숫자가 위 음, 안쪽부터; 여러 줄 텍스트는 줄마다; 보표 밖, 음과 0.3 sp·줄 사이 0.15 sp; 머리보다 넓으면 기둥의 rod를 넓힘 (§9); §10.2 순서대로 slur 뒤 — 긴 phrase slur 바깥에 서는 것은 M-H1에서 본다 | 운지를 slur보다 먼저 (§10.2 순서와 다름) | §10.2 순서 7; E23 |
| G4-D1a-8 | **arpeggio·notehead·임시표**: arpeggio는 화음·임시표 왼쪽의 물결선(화살표는 `dir`의 끝, staff마다 한 조각, 화살표는 가리키는 끝 조각에만), `non`은 괄호 — 백엔드가 그리는 모양; 머리 `paren`은 좌우 괄호 glyph; 임시표 `bracket`은 `[ ]`(고정 글꼴에 없는 `accidentalBracketLeft/Right`를 `DRAWN`으로), `paren`은 `( )`, `cautionary`만이면 그대로 (G4c는 cautionary + bracket을 괄호로) | 회전한 `wiggleArpeggiatoUp` glyph, 괄호를 괄호 glyph로 대체 | §6; E31, E32, E40 |
| G4-D1a-9 | **타악기 (A12)**: plan head에 `kit: {notehead, stem}` (그 악기 kit 항목의 것, 아니면 null); layout은 그래프 notehead → kit notehead, stem은 그래프·성부 → kit → 타악기 staff면 위 | plan에 kit을 싣지 않고 layout이 그래프를 읽음 (plan만 읽는 원칙) | §14.6; E27 |
| G4-D1a-10 | **보표 밖 쉼표의 덧줄**: 쉼표를 옮긴 뒤(`notateSystem`), 줄이 보표 밖인 온쉼표(매달린 줄)·2분쉼표(앉은 줄)·겹온쉼표(두 줄)에 그 줄 하나, 쉼표 폭 + 양쪽 0.2 sp; 병합 쉼표는 한 번; 기둥에 anchor하지 않음 (rod 그대로) | SMuFL `restWholeLegerLine` glyph (덧줄이 쉼표와 한 객체라 metric이 볼 수 없음), 보표까지 덧줄 전부 | G4c 리뷰 M1; E13 |
| G4-D1a-11 | **metric과 비율**: 새 l2 metric은 영목표 개수(§35.8); `eg.curve.endpoint_err_max` ≤ 0.5와 `eg.curve.hit_ratio` ≤ 0.01은 MAXIMA — hit 비율은 **suite 합**으로 판정(곡마다는 기록), `eg.curve.hits`는 LOWER; bench의 `eg.tie.drawn_ratio`·`eg.slur.pair_exact`·`eg.mark.drawn_ratio.<1a 종류>`는 plan과 두 layout이 모두 그려야 1 (baseline 값 불변, 키만 더함) | layout 판 비율을 새 이름으로 (baseline 키가 둘로 갈림), 곡마다 1 % (slur가 적은 곡에서 하나로 넘음) | §21.1–§21.2, A22 |
| G4-D1a-12 | **fixture와 re-bless**: E09(tie가 두 폭에서 system을 넘도록 5마디), E12(증1도 unison), E13(보표 밖 2분쉼표), E15(꾸밈 기호·tremolo·detached-legato·숨표·세로줄 fermata)를 늘림; layout hash 236/236 다시 bless — `layout-diff.js`(곡선·버전을 보게 고침) `d4b5b86` 대비 SERIALIZATION_ONLY 136(버전 이름만), GEOMETRY_ONLY 8, LEDGER_CHANGE 92 | 새 fixture 파일 (§22.1은 40개로 정함) | §21.3; G04 §35.14 |
| G4-D1a-13 | **M23의 이름**: layout이 ledger는 drawn인 articulation을 건너뛰는 결함은 §21.1의 `eg.ledger.drawn_missing`과 `eg.mark.missing.articulation`이 잡는다; §23이 적은 `eg.ledger.silent`는 plan이 ledger 없이 빠뜨리는 결함이고 `ledger-mutation.test.js` L-ART-LEDGER가 그대로 잡는다 | layout에서 `eg.ledger.silent`라는 이름을 다른 뜻으로 | §23; G04 §35.9 |

### G4d-1a Fixer 결정 (독립 리뷰 NEEDS_FIX — MAJOR 3, G4-L4, G4-L5 — G04 §35.18) — Fixer, 2026-09-25–26

브랜치 `g4d1a-curves-marks` (`7c83bc9`에서). 병합 안 함, PR 없음. G4-L4·G4-L5 자체는 Lead가 마감 때 적는다; 아래는 그것을 구현하며 정한 것이다.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-D1a-14 | **G4-L4의 구현**: tie의 쪽은 plan에서 — 그 event의 그 staff 머리를 적힌 음의 자리 순서로 세어 위 절반 위, 아래 절반 아래, 홀수 화음 가운데는 stem 반대(두 성부면 역할, 음 하나면 stem 반대); **떠나는 머리**가 두 반쪽을 정한다(그 마디가 배치되지 않았으면 닿는 머리). 끝은 `7c83bc9`의 자리에서 시작해, 제 머리(시작은 그 줄의 점·flag까지)에서 `REACH` 0.45 sp 안이고 화음의 다른 머리보다 `LEAD` 0.05 sp 넘게 가깝지 않으면 머리 가운데에서 `STEP` 0.05 sp씩 바깥으로(가장자리 + 0.15 sp까지) 옮기며 x를 그 높이에서 다시 정한다. `l2.js`: `eg.tie.dir_err`는 그려진 화음의 세로 순서로 따로 셈; A22 끝점은 제 머리까지 ≤ 0.5 sp **이고** 다른 머리보다 가까움 — G4-D1a-5의 화음 앞면 허용을 버림; 새 영목표 `eg.tie.crossings`(tie가 제 두 음의 머리·stem·flag·점·임시표를 지남) | 가운데 줄 기준 (화음 45 중 38이 한쪽으로), 반쪽마다 그 system의 머리로 (두 반쪽이 어긋날 수 있음), 화음 앞면까지 재기 (비킨 2도의 끝이 이웃 머리에 더 가까움 — 7화음), 비킨 머리까지 stem을 넘어 그리기 | G04 §13.1(as amended), §35.18.2; `eg.tie.dir_err` 116 → 0, `eg.tie.endpoint_err` 18 → 0, `eg.tie.crossings` 1 → 0; mutation TH, TD |
| G4-D1a-15 | **flag 뒤에서 시작하는 tie**: G4-L4가 stem 쪽으로 돌린 tie가 flag 달린 음을 떠나면 flag를 지나 시작하고, A22는 시작을 머리·점·**그 높이에 닿는 제 flag**까지 잰다 (§13.1의 "점 뒤"와 같은 뜻). 코퍼스 한 곳: sonatina/019 6마디 (두 config) — flag 없이는 1.08 sp | flag를 가로지르는 tie, 그 tie만 G4-L4와 반대로 | G04 §35.18.2; Lead가 볼 결정 (§35.18.11) |
| G4-D1a-16 | **G4-L5의 구현**: 순서 tie → tuplet → articulation·꾸밈 기호·fermata·tremolo → **운지** → slur·glissando. slur 끝은 제 음의 운지(어디든)와 끝 x ± 0.1 sp(`FINGER_X`)의 다른 음 운지 바깥; 끝 0.5 sp 안의 운지는 **hard 칸** — 두께 반 + `TOUCH` 0.05 sp만 비키면 되고 끝까지 봄; 두 끝을 함께 6번(`TRIES`) 옮겨도 안 되면 한 끝은 6번 안, 다른 끝은 `SPREAD` 20번(10 sp)까지 — 옮긴 합이 적은 것부터 (12 slur, 최대 7 sp). 6번 안에 풀리는 slur는 `7c83bc9`와 같은 모양 | 운지를 slur 바깥 (`7c83bc9`: 코퍼스 운지 198이 보표에서 8 sp 넘게), 부딪히는 운지만 slur 뒤에 다시 (그 운지가 멀어짐), 두 끝을 함께 더 멀리 (짧은 slur가 뜸), 끝 칸을 모두 hard로 (모든 slur 끝이 0.5 sp 뜸) | G04 §10.2(as amended), §35.18.3; `SLUR_COLLIDES` 15 → 1, `eg.curve.hits` 9 → 1, `eg.overlap.text` 0 (hard 칸 전 10); mutation FS |
| G4-D1a-17 | **§10.5 `FAR_PLACEMENT`**: `Skyline(x0, x1, {edges, far, diag})` — marks pass의 staff skyline만 받음; `put()`이 놓인 항목의 staff 쪽 가장자리가 그 쪽 바깥 줄에서 `SK.FAR` = 8 sp를 넘으면 `{code: 'FAR_PLACEMENT', refs: [it.ref]}` (모든 `put()`이 항목 id를 넘김, tuplet은 tuplet id). `eg.layout.far_placements`는 기록이고 `bench.js` LOWER ratchet; `eg.layout.far_undiagnosed`(8 sp 너머인데 이름 없는 배치 항목)는 영목표 | 먼 쪽 가장자리로 재기, 운지만 보기, `layout.js`가 나중에 훑기 (`put()`이 모름) | G04 §10.5(as amended), §21.2; 지금 37 (모두 높은 음 곁), `far_undiagnosed` 371 → 0; mutation FP |
| G4-D1a-18 | **`eg.fingering.far` (영목표)**: 운지의 x(양쪽 0.25 sp 더)에서 제 staff의 음 요소·tie·tuplet·기호, 같은 기둥(같은 마디·시각)의 운지, 보표 자체 가운데 가장 바깥 것에서 운지까지가 0.3 sp + 0.02를 넘으면 하나; slur·glissando와 다른 기둥의 운지는 이유가 아님 | 머리에서 고정 거리 (쌓인 화음 운지·덧줄 음에서 틀림), `FAR_PLACEMENT`만 (slur 위로 1–7 sp 뜬 운지를 못 봄) | G04 §35.18.3; `7c83bc9` 8,065 → 0; mutation FS, RV9 |
| G4-D1a-19 | **R3의 이름 붙은 metric**: `eg.slur.missing` (한 system `whole`, 넘으면 `start` + 사이 system마다 `mid` + `end`, 한쪽만이면 그 반쪽), `eg.slur.side_err` (§13.2 규칙을 l2가 다시 셈), `eg.gliss.errors`에 끝 높이(각 머리 가운데 ± 0.25 sp; staff를 넘으면 떠나는 staff), `eg.mark.glyph_err` (articulation의 쪽별 SMuFL glyph — 고정 글꼴 대체만 허용, detached-legato 두 조각, plan의 꾸밈 기호 glyph, fermata 모양); fixture E08·E10·E11·E15·E23을 늘림 (40개 그대로); mutation RV8b, RV9, RV19, RV20, RV20c, RV23, RV25, RV26 | layout hash로만 잡기 (리뷰가 본 것), 새 fixture 파일 (§22.1은 40개) | G04 §35.18.4 |
| G4-D1a-20 | **`bench.js`의 `eg.curve.hit_ratio`는 작을수록 좋음**: LOWER에 넣고 LOWER는 클수록-좋음 비교에서 뺌 (`compare()`가 `ratio`가 든 이름을 모두 클수록-좋음으로 읽어 오름은 통과, 내림은 퇴행이었다). baseline은 키를 더하고 hits 3 → 0, hit ratio 0.0016 → 0을 내림; `eg.curve.slurs`(기록) e 10 → 20은 새 fixture, `eg.curve.endpoint_err_max`(≤ 0.5) 0.15 → 0.27은 G4-D1a-14의 더 엄격한 잼 | baseline을 올려 맞추기 | G04 §35.18.7 |
| G4-D1a-21 | **글자 metric CI (R4)**: PR gate는 `make-text-metrics.js --check` — network 없음(형식·digest, 캐시가 있으면 다시 만들기); 받기는 글꼴마다 `AbortSignal.timeout(30 s)`, 실패는 "rebuild skipped (network)"라고 말함; `--strict`는 다시 만들기가 돌지 않으면 FAIL — nightly job | `--check --fetch`를 PR마다 (network에 묶임), sha 키의 `actions/cache` (캐시가 비면 같은 문제) | G04 §35.18.5 |
| G4-D1a-22 | **`layout-hashes.js --write`는 fail closed, plan도 (R8)**: 파일에 `planVersion`과 곡마다 plan hash; 기준은 origin/main merge base의 파일, 그 파일에 plan hash가 없으면 그 commit의 `engrave/`·`scoregraph/`로 셈(파일마다 `git show`); merge base가 없거나 파일보다 오래되면 커밋된 파일을 기준으로 — 같은 버전 아래 layout 또는 plan hash가 다르면, 또는 기준의 plan을 알 수 없으면 거절(exit 1, 아무것도 안 씀) | "could not check" 하고 쓰기 (`7c83bc9`), layout hash의 planKey로 plan을 대신 (plan 버전만 싣고 출력은 못 봄) | G04 §35.18.6; 음성 대조 A, D, B1–B5, E, F, F3 (Windows), B2·F (Linux) |
| G4-D1a-23 | **`engr/3`, `plan/2` 유지**: layout 출력이 검토된 `7c83bc9`(engr/2)에서 바뀌었으므로 Lead 지시의 G4-D1a-1 읽기대로 올림; plan 출력은 404곡 모두 `7c83bc9`와 같음. re-bless 236/236: `7c83bc9` 대비 SERIALIZATION_ONLY (version) 194, GEOMETRY_ONLY 42 (tie 8 — G4-L4; 운지·slur(·틀) 24 — G4-L5; 둘 다 10), LEDGER_CHANGE 0; R3 fixture 5곡 × 2는 내용도 바뀜 | 병합 지점마다 한 번이므로 engr/2 그대로 (Lead 지시가 올리라고 읽음) | G04 §35.18.8 |

### G4d-1b 구현 중 결정 (system에 붙는 기호, 세로 배치, courtesy, 괄호 임시표 — G04 §36) — Implementer, 2026-09-26

브랜치 `g4d1b-system-marks` (`747e45e`에서). 병합 안 함, PR 없음.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-D1b-1 | **`plan/3`, `engr/4`** (G4-D1a-1): plan은 direction과 line마다 `part`(staff를 말하지 않는 코드명·pedal·words의 part), 셈여림에 `more`(한 `<dynamics>`가 함께 적은 표시, 그래프 `ext`); layout은 system에 붙는 기호·세로 배치·R5. 45/118곡의 plan이 바뀜 (같은 입력, 버전 이름 빼고; guard가 보는 제 fixture로는 49 — Fixer 정정, G04 §36.18.5), layout hash 236 전부 | plan을 두고 layout이 그래프를 읽음 (plan만 읽는 원칙), part를 staff에서 추측 (staff 없는 direction이 흔함: 코드명 전부) | G04 §36.1–§36.2; 음성 대조: engr/3·plan/2로 되돌리면 `--write` REFUSED |
| G4-D1b-2 | **두 번째 배치 pass `engrave/sysmarks.js`**: marks.js가 남긴 skyline(`S.sky`) 위에서 §10.2 순서 7 가사 → 8 셈여림·hairpin → 9 pedal → 10 ottava → 코드명 → volta → tempo·rehearsal → 위쪽 jump·words → 11 아래쪽 words·jump. 한 줄은 기준선 하나 (S2): 항목마다 `put({probe})`, 가장 바깥이 기준선, 모두 `put({at})` — 여전히 하나의 배치 함수 (M8·M13이 그것을 끔) | 항목마다 따로 `put()` (기준선이 흩어짐), 줄 전체의 합친 상자로 한 번 (사이의 먼 음까지 비킴) | §10.1, §10.4 S2; mutation DB, M13 |
| G4-D1b-3 | **크기·글꼴** (§18.3이 적지 않은 것): 셈여림 SMuFL 글자 2.5 sp em (glyph 척도 0.625), 글자 원점은 앞 글자 오른쪽 끝 (고정 글꼴의 advance는 단위가 섞임); words serif-italic 1.4; 코드명 sans 1.4 + ♯♭ glyph (페이지 글꼴에 없음); 가사 serif 1.3; tempo serif 1.6 + 메트로놈 음 머리 0.6배; rehearsal sans-bold 1.5 틀 0.3; jump serif-italic 1.4, segno·coda glyph 2.4 em; ottava·volta 번호 serif(-italic) 1.3 **글자** (고정 Bravura에 ottava glyph가 없음 — §18.2와 다름); pedal glyph 2.5 em | ottava를 대체 glyph + `MISSING_GLYPH` (코퍼스 0이어야 함), 코드명의 #·b 글자 (앱 legacy 모양), 셈여림을 표준 크기(4 sp em) | G04 §36.3, §36.6, §36.12 1–2 |
| G4-D1b-4 | **셈여림 자리**: 그래프 staff·placement, 없으면 여러 staff part는 첫 두 보표 사이, 한 staff는 아래, 노래하는 part(악기 voice 또는 가사 있는 part)는 위; part의 아래 보표 위 = 두 보표 사이의 같은 줄. 한 줄에서 만나는 셈여림은 한 줄 바깥 (§10.5); 셈여림 곁 words는 그 뒤로 최대 4 sp, 넘으면 한 줄 바깥; 같은 곳의 같은 셈여림·hairpin 둘은 하나로 두 ID; hairpin은 기준선 위 0.35 sp 축, 넓은 끝 1.1, 계속 0.5, 양끝 셈여림(시각이 조금 달라도)과 0.5 sp; 겹친 두 hairpin은 앞의 것을 끊음 (`HAIRPIN_OVERLAP`) | 셈여림을 오른손 아래에 붙임 (가운데 아님), words를 언제나 한 줄 바깥, 중복을 겹쳐 그림 (`mark_mark`) | §10.2 순서 8, S2, S5; E16; sonatina/026·027 |
| G4-D1b-5 | **두 보표 사이 줄의 가운데 맞춤** (§15.3에 더함): 쌓은 뒤, 사이 줄 전체를 위 보표가 내려온 곳과 아래 보표가 올라온 곳의 가운데로 — 아래로만, 아래 보표 내용과 1.0 sp를 지킴; 간격 공식은 그대로 | 위 보표에 붙여 둠 (5 sp 간격에서 위 0.5·아래 3 sp로 치우침), 항목마다 따로 가운데 (S2가 깨짐) | §15.3; E16 PNG |
| G4-D1b-6 | **pedal**: part의 가장 낮은 staff 아래 system당 한 줄; sign(기본)은 누르는 음에서 Ped., 떼는 곳 0.6 sp 앞 *; line(`line: true` 또는 sign 없음)은 갈고리 1.0 sp(Ped. 뒤에는 시작 갈고리 없음); **change는 sign이면 * 뒤 Ped., line이면 notch** — 뗌만으로 그리지 않음 (MX1-D4의 뗐다 다시 밟기); `(m, 0)`의 뗌은 앞 마디 세로줄에서 | change를 * 하나로 (legacy, MX-1 carry-over (c)의 결함), 뗌을 다음 음 앞에서 (system 넘김에서 다음 system으로 넘어감) | A9, §23 M19; E17, E37 |
| G4-D1b-7 | **ottava**: 덮는 staff마다 (파일이 staff를 말하지 않으면 plan `covers`대로 part의 모든 staff — 앱이 옮기는 음과 같음), 시작 시각이 [from, to)인 event의 머리를 정확히 덮음 (±0.2 sp), 이어지면 system 끝까지 갈고리 없이, 앞 system에 덮은 음이 있으면 "(8)"/"(15)"; 8va·15ma 위·8vb·15mb 아래; 머리는 plan의 written 그대로 (D-1) | 높은음자리표에만 (MX-1 carry-over (c)), graph `to`까지의 시간으로 (마지막 음 뒤 빈 곳까지 덮음) | A10, §23 M20; E18, E37 |
| G4-D1b-8 | **코드명**: 앱 `CHORD_KIND`(App 3849)의 철자, ♯♭ glyph, sans 1.4, 음 왼쪽; **폭은 그 기둥·staff의 rod에** (+0.5 sp) — 밀기(§10.5, 0.4 sp, (x, 그래프 순서))는 기둥이 없는 시각의 것에, system 끝을 넘으면 안으로 당김 | 밀기만 (휴대폰 E25가 페이지 밖으로, H4) | §10.5; E25; mutation CP |
| G4-D1b-9 | **tempo·rehearsal·jump·words**: plan이 `heading`으로 그리라는 첫 tempo는 "♩ = N"; tempo는 말 + 메트로놈(괄호); rehearsal은 세로줄 x에 틀; jump는 segno·coda glyph, 말은 그래프 text 또는 D.C./D.S./Fine/To Coda; 마디 끝에 선 jump·words는 세로줄에 오른쪽 맞춤; 위쪽 줄 순서 ottava → 코드명 → volta → tempo·rehearsal → jump·words (표가 적지 않은 jump·words는 바깥), 아래쪽 줄은 가장 낮은 staff 아래 | heading tempo를 안 그림 (ledger는 drawn), words를 셈여림과 따로 한 줄 | §10.2 순서 10–11; E22 |
| G4-D1b-10 | **가사**: voice의 staff 아래, 절마다 system당 한 기준선, 음 가운데; 음절 폭(+ 이어지는 음절이면 hyphen 자리)을 기둥 rod에; hyphen 0.6 sp는 자리가 있을 때; melisma 연장선은 그리지 않음 | 이벤트의 staff 아래 (cross-staff voice에서 다름), 폭을 밀기로만 | A12, E24, E35; mutation LW, LP |
| G4-D1b-11 | **R5 괄호 임시표**: `[ ]`의 높이를 둘러싼 임시표 상자 ± 0.15 sp로, 끝이 보표선 0.2 sp 안이면 선에서 0.25 sp 밖으로; 임시표 열의 세로 범위도 괄호 끝까지 | 괄호 높이를 고정값만 키움 (선 위 끝은 그대로) | G4d-1a 리뷰 R5; E32; mutation BR |
| G4-D1b-12 | **metric** (§36.10): 이름 붙은 영목표 21개와 `eg.mark.missing.<12 종류>` (그 종류의 객체가 ref를 이름 대야 — volta 번호만은 volta가 아님; pedal change는 change의 모양); `eg.event.written_diff`는 그래프에서 따로 셈; A20은 1a·1b의 모든 글자·선 (한 기호의 조각은 `group`으로 제외); 허용: 글자 폭은 size 반올림만큼(em당 0.005), 곡선 표본 0.1 sp, 0.25 sp 칸은 반올림 0.01만큼 넓혀; FAR은 1b의 줄을 한 항목으로, 두 보표 사이면 가까운 보표에서; 새 기록 키 `eg.layout.far_placements_system` (LOWER, r 23 e 0 x 0) — 1a의 `far_placements`(r 16, 코퍼스 35; E fixture 포함 37 — Fixer 정정)는 그대로 | 1b의 먼 줄을 `far_placements`에 더함 (baseline을 올려야 함), 곡선을 layout과 같은 표본으로 (l2가 layout 코드를 따라 씀) | §21.1–§21.2, A20, A25; baseline은 키만 더함 |
| G4-D1b-13 | **mutation 22개**: §23 M13 (셈여림을 음 높이로), M19 (change를 뗌만으로), M20 (8va 아래 머리를 울리는 높이로) + 규칙마다 하나: DB, HT, HL, HS, DS, SG, YS, VC, CK, VE, CP, OS, OL, PE, LW, LP, RO, TC, BR — 모두 이름으로 잡힘; 새 probe E16–E18, E20, E22, E24, E25, E35, E37, 합성 `upper` | hash로만 잡기 | §23; G04 §36.11 |
| G4-D1b-14 | **fixture**: E16, E19–E22, E24, E25, E35, E37을 늘림 (40개 그대로); **E17·E18은 그대로** — MX-1의 재생 테스트(`app-playback.test.js`, 브라우저 suite `engraving`·`follow`·`playback-scheduler`)가 음·pedal 하나하나를 고정한다; system 넘김의 sign change pedal·line pedal·8va "(8)"은 E37에 | E17·E18을 늘리고 MX-1 테스트를 고침 (앱 쪽 증거를 흔듦), 새 fixture 파일 (§22.1은 40개) | §22.1; G04 §36.17 |
| G4-D1b-15 | **re-bless 236/236**: `747e45e` 대비 SERIALIZATION_ONLY (version) 64, GEOMETRY_ONLY 2 (E32 괄호, R5), LEDGER_CHANGE 170 (새로 그린 system 기호 — 파일이 인쇄한 tempo 표시 152쌍 = 76곡 × 2 등; heading "♩ = N"은 이 118곡에 없다 — Fixer 정정, G04 §36.18.5); 그 가운데 이미 있던 객체가 x로 움직인 것 6 (가사·코드명 폭), 세로로만 158 (새 줄) | — | §21.3; G04 §36.16 |
| G4-D1b-16 | **DOM 계약** (G4d-2가 CSS·테마로 쓸 것): system에 붙는 기호마다 `g.ppp-<종류>[data-ref]` (종류: dynamic, hairpin, words, pedal, ottava, chord, volta, tempo, rehearsal, jump, lyric), 안의 요소에 종류별 class; volta는 번호와 한 g (`g.ppp-volta` 그대로) | 모두 system g에 흩어 둠 | §16.4; `svg.js` |

### G4d-1b Fixer 결정 (독립 리뷰 NEEDS_FIX — MAJOR 3 — G04 §36.18) — Fixer, 2026-09-26

브랜치 `g4d1b-system-marks` (`ee87449`에서). 병합 안 함, PR 없음.

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-D1b-17 | **메트로놈 둘레의 말은 tempo 줄에** (리뷰 R1): 메트로놈 표시가 있는 tempo의 part·(m, at)에 선, placement가 below가 아닌 words 가운데 **괄호가 맞지 않는 것** — 여는 괄호가 남는 것은 메트로놈 앞 (그 괄호 앞까지 tempo 글꼴 serif 1.6, 괄호부터 메트로놈 글꼴 serif 1.4, 괄호로 끝나면 음표에 붙임), 닫는 괄호가 남는 것은 뒤 (메트로놈 글꼴, ")"로 시작하면 숫자에 붙임), 각각 그래프 순서로. `words` 객체(refs는 그 말, `group`은 tempo)라 `eg.mark.missing.words` 그대로; `sysmarks.js`에서, `engr/5`; 영목표 `eg.tempo.split_err` (tempo 줄 밖의 그 말, 빈 "( )") | importer에서 접기 (`scoregraph/`는 이 goal 밖, 그래프가 바뀜), plan에서 tempo text로 접기 (`plan/4`, ledger의 words 상태가 바뀜), "("로 끝남·")"로 시작 글자 규칙 (hanon의 "(M.M. "·" to 108.)"을 못 잡음), 말 전체를 tempo 글꼴로 (두 괄호 크기가 어긋남) | G04 §36.18.2; `eg.tempo.split_err` 118 → 0 (R suite 46 → 0); mutation TW; E22 |
| G4-D1b-18 | **따로 된 direction의 tempo 말은 합치지 않음** (리뷰 M2): 괄호가 맞는 말은 제 자리에 — czerny599/054의 "Moderato"는 "♩ = 100" 위에 쌓인 채; M-H1 watch list | 같은 자리의 말을 모두 tempo 줄로 (czerny599/038 "dolce"도 tempo가 됨), tempo 용어 목록 (원본에 없는 판단) | G04 §36.18.2; 코퍼스 54곳 |
| G4-D1b-19 | **`eg.mark.anchor_err`** (리뷰 R2, A8): 셈여림 글자는 그 시각 음(그래프의 event, 제 staff, part의 다른 staff, 시각의 x)의 가운데 (말로 된 것은 거기서 시작); words·jump 말은 그 시각 음 왼쪽 — 마디 끝이면 세로줄에 오른쪽 맞춤, jump는 마디 시작이면 세로줄 뒤 0.3 sp; segno·coda는 세로줄(마디 시작)·시각의 x에 가운데; tempo 줄은 top staff의 그 시각 음; rehearsal은 세로줄(마디 시작)·시각의 x. 옮김은 줄의 규칙만: 오른쪽은 같은 줄 앞 항목 뒤 0.4 sp (셈여림 곁 words 0.35), 왼쪽은 system 끝 또는 다음 항목 0.4 sp 앞; 0.02 sp | 음에서 몇 sp 안이면 통과 (빽빽한 곳의 한 박 밀림을 놓침), "당겨짐"을 민 항목에도 허용 (R-RX가 E22 데스크톱의 system 끝에서 빠져나감) | G04 §36.18.3; mutation R-DX, R-WX, R-TX, R-RX, R-JX |
| G4-D1b-20 | **`eg.hairpin.extent_err`** (리뷰 R2, A8·S5): 걸친 system마다 조각 하나, 그 밖에는 없음; 시작은 첫 시각 셈여림 뒤 0.5 sp / 첫 음 왼쪽 / 이어지면 첫 음 기둥 1.0 sp 앞, 끝은 마지막 시각 셈여림 0.5 sp 앞 / 멈추는 음(세로줄) 0.5 sp 앞 / 이어지면 마지막 세로줄 1.0 sp 앞; S5로만 옮김, `HAIRPIN_OVERLAP`·`HAIRPIN_SHORT`가 이름 댄 끝은 따로; 0.05 sp | `eg.mark.missing.wedge`만 (첫 조각이 모든 system을 채움) | G04 §36.18.3; mutation R-HE, R-HS0, R-HB |
| G4-D1b-21 | **G4-D1b-4를 코드도 지킴** (리뷰 R3): 셈여림 곁 words가 첫 줄에 남는 것은 제 자리이거나 4 sp 안으로 밀린 것만 — 전에는 밀기를 계속할지만 밀기 전 거리로 봐서 마지막 밀기가 4 sp를 넘겨도 남았다; 808 layout 출력 변화 0. 영목표 `eg.words.push_err`: 첫 줄에서 아무것도 만나지 않는 가장 가까운 곳(제 자리, 또는 첫 줄 항목 뒤 0.35 sp)이 4 sp 안이고 system 안이면 거기, 아니면 한 줄 바깥 제 자리 | 규칙을 코드대로 고쳐 적기 (마지막 밀기는 몇 sp든 — 긴 hairpin 뒤로 10 sp 밀린 말) | G04 §36.18.4; mutation R-WP |
| G4-D1b-22 | **`eg.row.centre_err`** (리뷰 R3, G4-D1b-5): 사이 줄의 위 틈 gu와 아래 틈 gd(0.25 sp 칸, 곡선은 x 0.5 sp마다 두 끝의 높이)에서 gd ≥ 1.0 sp이고 — gu = gd, 또는 gu < gd = 1.0 sp, 또는 gu > gd이면 놓인 자리(한 항목 곁 0.25 sp 안의 위 보표 내용에서 0.5 sp); 0.15 sp; 칸은 그대로 또는 반올림(0.01)만큼 넓혀 읽어 어느 한쪽 | 가운데만 (1.0 sp에 묶인 879줄과 놓인 자리 1줄이 틀림), 셋째 경우를 아무 gu > gd에나 (지나치게 내린 줄을 못 봄) | G04 §36.18.4; 808 layout의 사이 줄 1,618 — 가운데 738, 1.0에 묶임 879, 놓인 자리 1 (czerny849/002 데스크톱: tuplet 숫자의 배치 여유); mutation R-CB, R-CB2 |
| G4-D1b-23 | **`engr/5`, `plan/3` 유지**; re-bless 236/236 — `ee87449` 대비 SERIALIZATION_ONLY (version) 218, LEDGER_CHANGE 16 (czerny849/002·005·007·018·020·022·023 × 2 — R1, 말이 tempo 줄에서 두 조각; E22 × 2 — fixture), GEOMETRY_ONLY 2 (hanon/001 × 2 — R1); baseline r·e·x는 키 다섯, r `eg.layout.far_placements_system` 23 → 8 (내림). `layout-hashes.js --write`의 기준은 merge base(`747e45e`, engr/3)라 engr/4로 두어도 썼다 — 버전은 손으로 올림 | engr/4 그대로 (검토된 출력과 다름) | G04 §36.18.6; G4-D1a-1, G4-D1a-23 |
| G4-D1b-24 | **fixture와 mutation**: E22에 "Più mosso (" ♩ = 132 ")"와 "(M.M. " ♩ = 60 " to 72.)" (한 direction씩, 40개 그대로); mutation 12 — TW, 리뷰의 R-DX·R-WX·R-TX·R-RX·R-JX·R-HE·R-HS0·R-HB·R-CB·R-WP, Fixer의 R-CB2 — 모두 이름으로 잡힘 (97 + N1·N2); `sysmarks.test.js` 음성 대조 +9 | 새 fixture 파일 (§22.1은 40개), hash로만 잡기 | G04 §36.18.2–4 |

### G4d-2 구현 중 결정 (페이지 통합, 개발용 스위치, M-H1 도구 — G04 §37) — Implementer, 2026-09-26

브랜치 `g4d2-page-integration` (`0ef0950`에서). 병합 안 함, PR 없음. **기본값은 `'legacy'` 그대로**: 기본 경로의 앱은 G4d-2 전과 같은 파일을 불러오고, 같은 SVG를 그리며(legacy parity 16/16), 같은 Score·재생·판정을 만든다(A16).

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| G4-D2-1 | **스위치** (§16.1, §25.1): ScoreView prop `renderer`(`'legacy'`\|`'engrave'`), 없으면 `PPP.renderer`. `PPP.renderer`는 `'legacy'`이고, 페이지를 `?renderer=engrave`로 열었거나 localStorage `ppp.renderer`가 `'engrave'`일 때만 `'engrave'`. `PPP.strictEngrave`(`?strict=1`, localStorage `ppp.strictEngrave`)면 fallback 대신 throw. 사람이 누르는 어떤 버튼도 이것을 바꾸지 않는다 (app.test.js가 쓰는 곳을 센다) | 설정 화면의 토글 (사용자에게 보이는 변화), URL만 (새로 고침·share 링크의 `replaceState`에서 사라짐 — 브라우저 suite의 하네스가 localStorage를 씀) | G04 §25.1; 로드맵 §5.1 G4-L1 |
| G4-D2-2 | **판각 파일은 필요할 때만 불러온다**: 레이아웃 14 파일과 `engrave/page.js`는 `'engrave'` 뷰가 처음 그릴 때 `loadEngrave()`가 순서대로(`async=false`) 넣는다 (App `ENGRAVE_FILES`). 기본 페이지가 불러오는 파일은 G4d-2 전과 같다 (G4a의 8개, `store.js`·`index.js`만 `?v=4`) | 모두 script 태그 (모든 사용자의 첫 로드에 압축 전 ≈ 420 KB) | "사용자에게 보이는 변화 없음" (로드 시간 포함); A45 |
| G4-D2-3 | **ScoreView는 표시된 두 삽입만 바뀐다**: `paint()` 첫 문장(`engraveWanted(this.props) && this.paintEngrave()`)과 `paint()`·`draw()` 사이의 `paintEngrave()`, 각각 `/* G4d-2 >>>` … `/* <<< G4d-2 */` 줄 사이. `draw()`·`buildVoice()`·`sync()`·`drawKey()`는 그대로. **A45 고정을 넓힘**: 지금의 클래스 hash + 두 블록을 잘라 낸 클래스 = MX-1이 남긴 클래스(`8ceb975a…`) + 거기서 MX-1 블록을 자른 것 = 55d1bd5의 같은 자름(`80149fb7…`) + 블록 위치(draw 앞) | 클래스 hash만 새로 (무엇이 바뀌었는지 말하지 못함), 옛 ScoreView를 두고 새 컴포넌트 (호출처 9곳 수정) | brief "extend the pin rather than loosen it"; app.test.js A45 |
| G4-D2-4 | **페이지 어댑터 `engrave/page.js`**: DOM을 만지는 유일한 engrave/ 파일 — 원천·캐시·SVG 넣기·연습 층의 표시와 글자·새 `sync`·포인터·fallback 카운터. A29에 새 층 `PAGE`(DOM·포인터·시간 허용)로 이름을 대고, 어떤 engrave/ 파일도 그것을 읽지 않음을 검사 — 그래프에서 EngravedScore·SVG까지의 길은 DOM에 닿지 않는다 | 앱 파일 안에 (19k 줄 파일에 수백 줄, Node 테스트 불가), `svg.js`의 BACKEND 층에 (BACKEND는 측정도 안 함이 검사됨) | §8.5, §20; `layout.test.js` A29 |
| G4-D2-5 | **캐시 가능한 전송**: 앱은 `./engrave/<name>.js?h=<hash>`로 묻고 (hash = CRLF를 LF로 읽은 파일의 sha256 앞 12자, `tests/engrave/tools/page-files.js --write`가 씀), 서버는 **`h`가 그 파일의 hash일 때만** `public, max-age=31536000, immutable` + gzip, 아니면 전과 같이 `no-store`. `vendor/*.js`도 같은 규칙 (G4d-2는 부르지 않음). 목록이 낡으면 캐시를 잃을 뿐 틀린 파일을 쓰지 않는다; `app.test.js`가 목록·순서·hash를 CI에서 확인 | engrave/·vendor/의 `.js` 전부 immutable (`?v=`를 올리지 않은 배포에서 낡은 코드), 내용 hash 파일 이름 (파일 이름이 커밋마다 바뀜), 서버가 HTML에 목록을 넣음 (기본 HTML 바이트가 바뀜) | G4-L1 ("served cacheably"); curl로 확인: 맞는 h → immutable·gzip, 틀린 h·`?v=` → no-store |
| G4-D2-6 | **`svg.js`의 페이지용 선택 두 가지** (기본 출력은 `data-volta` 말고 바이트 그대로 — 808 SVG 비교): `unit`(사용자 단위/sp; 페이지는 10 = legacy의 px) — `svg.__ppp`, `getBBox`, 연습 overlay, 브라우저 suite의 모든 px 허용치가 두 렌더러에서 같은 뜻; `inline`(glyph를 `<use>` 대신 제자리의 절대 path로) — sonatina/020 전곡에서 한 번 다시 칠하기가 `<use>` 5.3–6.7 ms + layerize 2–6 ms, path 1.3–1.5 ms + 0.2 ms (Chrome trace; 재생 프레임마다 다시 칠함), 그리고 크기 바꾼 glyph의 `getBBox`가 제자리 | viewBox를 sp로 두고 테스트 허용치를 고침 (`bar.y + 40` 같은 px 상수가 여럿), `<g transform="scale(10)">` (getBBox가 자기 좌표계 — 틀림), `<use>` 그대로 (전곡 프레임 p95가 legacy보다 느림: 14.6 대 9.8 ms; 고친 뒤 6.8 대 8.8, page-check a31) | `page.test.js` (unit·inline 동치), `browser-parity.js` (페이지 SVG Node = Chrome, E14 glyph path의 getBBox = 상자 × 10) |
| G4-D2-7 | **연습 층의 글자는 페이지의 것**: 마디 번호, 전곡의 제목·작곡가, 안내 글자(음 이름)는 `text.ppp-ann`로 EngravedScore의 상자에서 놓는다 — 마디 번호는 윗줄 9 px 위(그 자리에 판각 요소가 있으면 그 위로), 안내 글자는 그 음 아래(판각 요소가 있으면 그 아래로, 아래 보표를 넘으면 제자리). 판각기의 skyline에는 들어가지 않는다. 판각기의 `<text>`(음 그룹 밖)에도 `ppp-ann`을 달아 테마 잉크를 따른다 (A33) | 판각 규칙으로 (엔진 변경 — G4d-2 범위 밖, §16.6의 "안내 글자는 layout 객체"는 인쇄·flip 단계로), 안 그림 (A33의 마디 번호 단언이 실패, 연습 화면에 마디 번호 없음) | §16.4 `.ppp-ann`; engraving.test.js 어두운 테마; M-H1 watch list에 추가 |
| G4-D2-8 | **`data-volta`는 인쇄된 이름** ("BEGIN_END:1."): `svg.js`가 EngravedScore의 volta 객체의 label을 싣는다 — legacy와 같은 계약(§16.4). 기본 출력에서 바뀐 것은 이 값뿐 (volta 있는 28 SVG) | 페이지가 Score에서 고쳐 씀 (엔진의 계약과 페이지가 어긋남) | engraving.test.js "the first ending is drawn over bar 6, closed" |
| G4-D2-9 | **원천과 fallback** (§7.4, §16.7): `PPPEngrave.app.resolve(score, {key: 곡 id})`, **`agree.ok`와 `link.ok`가 둘 다 참일 때만** 그림 — 아니면 그 곡은 legacy (`SOURCE_NONE`, `SOURCE_DISAGREES`, `LINK_FAILED`, `SOURCE_THREW`, `PLAN_THREW`, `LAYOUT_THREW`, `SYNC_THREW`, `LOAD_FAILED`), `PPP.engraveStats`에 code별·곡별로 세고 `console.warn('[ppp] engrave fallback', code, 이유)`. 그 Score 객체가 바뀔 때까지 legacy. strict면 throw. 판각기가 그리지 않는 축소 뷰(`clefs:false`, 여러 보표 곡의 `grand:false` — 루프 썸네일, 빈 보표)는 fallback이 아니라 **routed**로 legacy (`PPPEngravePage.stats.routed`) | `PROJECTION_DISAGREES`여도 그림 (Score와 다른 음을 그릴 수 있음), 곡을 다시 시도 (매 프레임 예외), 축소 뷰도 판각기로 (판각기에 clef 없는 모드가 없음) | 로드맵 G4-L1 "`agree.ok` required (not `PROJECTION_DISAGREES`)" |
| G4-D2-10 | **resolve는 비동기**: 다시 불러온 곡은 store(IndexedDB)에서 그래프를 읽으므로, 원천이 정해질 때까지 뷰는 "Engraving…"을 보인다 (보통 몇 ms; 다시 불러온 sonatina/020 121 ms, CPU 4× 527 ms). projection으로 먼저 그렸다가 store가 답하면 다시 그리지 않는다 (beam이 생기며 모양이 바뀜) | resolveSync (다시 불러온 곡이 G4-U1의 그래프를 잃음), projection 먼저 | G4-U1, §26.2 |
| G4-D2-11 | **캐시와 키** (§16.2, §16.3, G4-D1a-1): 그래프 — live·store는 그래프 객체로(WeakMap), projection은 Score의 음악 hash로(LRU 4) → plan — `PLAN_VERSION` + semanticConfig(LRU 4) → engraver(`createEngraver`: prepare 한 번, layout LRU 8) → SVG 글과 PracticeMap — `engr/N` + 정규화한 config(LRU 8). **drawKey** = 그래프 키(fingerprint 또는 `p:`+Score hash) + plan 버전 + semantic + engr 버전 + layout config + 단위 + 페이지 표시(마디 번호·제목·안내 글자·약한 마디·크기). 재생선·켜진 음·손·기억·틀린 음(sync), 테마·종이(CSS), breakpoint 안 창 크기(config 같음)는 키에 없다 | `score.id` (지금의 legacy 한계, §4.4), 출력 hash (sonatina/020 45–125 ms) | `page.test.js` drawKey; page-check A32 |
| G4-D2-12 | **새 sync = legacy의 규칙, Score의 값**: 그룹은 event × staff(`g.ppp-note`), 시작 = 그 staff의 첫 Score 음의 `abs`, 끝 = App `scoreNoteEnd(abs, dur)`, 음높이·손·onset 키도 그 음들 — legacy와 같이 쉼표도 켬, 꾸밈음은 켜지 않음. G4b highlighter(두 정렬 목록·포인터)로 바뀐 것만 찾고, 상태가 바뀐 요소에만 class를 쓴다; 손·기억 계획·숨김 단계가 바뀐 프레임만 전체, 틀린 음 목록만 바뀌면 울리는 것만. 테마 변수·overlay 속성도 값이 바뀔 때만 쓴다 (custom property를 같은 값으로 써도 악보 전체를 다시 스타일: 14.5 ms, 측정) | 매 프레임 전부 (legacy, 1,563 요소), 그래프 event의 시간 (Score의 8va·tie 판정과 어긋날 수 있음) | A31: 페이지 측정 touched ≤ changed 1000 프레임, p95 0.1 ms (4× 0.5 ms); `page.test.js` 4,501 프레임 legacy 규칙과 같음 |
| G4-D2-13 | **layout config**: 전곡은 screen breakpoint config(데스크톱 100 sp·4마디, 휴대폰 40 sp·2마디, 720 px), 가까이 보기는 창 `[i0, i1]`, 줄당 마디 = `perRow` 또는 창의 마디 수, 폭 = 마디당 25 sp(휴대폰 20) × 줄당 마디 ÷ zoom — zoom은 음을 크게 (SVG px 폭 = page × 10 × zoom) | legacy의 `mW`(px)를 sp로 (zoom이 간격만 넓힘) | §16.5 "확대는 `mW`를 바꾸는 config 변경 → layout (캐시)"; page-check A32 |
| G4-D2-14 | **테마는 CSS**: `svg.ppp-engraved { color: var(--score-ink) }`, 보표선 `--score-staff`(legacy처럼 `--staff`/`--paper-staff`), `.ppp-on`·`.ppp-bad`은 `color`(glyph가 currentColor) — 앱 `<style>`에 네 줄, `.ppp-engraved` 없는 legacy SVG에는 닿지 않음. 테마·종이를 바꿔도 다시 그리지 않는다 | legacy처럼 그릴 때 색을 구워 넣음 (테마 바꿀 때 다시 판각) | A33 (page-check, engraving.test.js) |
| G4-D2-15 | **`with-port.js`의 빈틈**: 모든 browser context의 page도 포트를 바꿈 (auth-ui 손님, share의 둘째 사람 — `PPP_URL` 불필요), 앱 스스로의 `127.0.0.1:8788/health` 거부를 suite의 console·requestfailed 듣는 곳에서 뺌 (`PPP_KEEP_8788=1`로 끔), `PPP_RENDERER`·`PPP_STRICT`를 문서마다 localStorage로, 끝에 판각기의 draw·fallback·routed 한 줄 | suite를 고침 (26 파일), 임시 preload (G4b §33.14 — 커밋 안 됨) | G4-L1 "the `with-port.js` gaps" |
| G4-D2-16 | **R12**: store의 timeout이 `estimate()`와 `decode`도 덮는다 — estimate가 답하지 않으면 `estimate-timeout`으로 세고 추정 실패처럼(쓰기 진행, backend의 quota 오류가 막음); decode가 답하지 않으면 code `timeout`, record는 지우지 않음 | estimate timeout이면 쓰지 않음 (추정이 실패하면 써 왔던 규칙과 어긋남) | G4b 리뷰 R12 (§33.16.8, §33.17); `store.test.js` |
| G4-D2-17 | **브라우저 suite의 단언**: 선택자만 — `.vf-notehead path` → 그 path 또는 요소 자신 (engraving 2곳, pdf-layer 1곳), `.vf-stavetie path` → `path.vf-stavetie`도, 보표선 `path.vf-stave`의 `M x yH` (legacy 일치는 그대로); renderer에 따라 — 줄당 4마디 이하(legacy) / 모든 마디 한 번·순서대로·줄당 6 이하(G4-U4), 추론 tie 숨김(legacy O4) / 그림(G4-U2 A), 이어지는 8va "(8va)"(legacy MX1-D9) / "(8)"(G4-D1b-7) | 판각기 쪽을 legacy 모양으로 맞춤 (사용자 결정과 반대) | §16.4 "바꾼 단언은 이유와 함께"; G04 §37.7 |
| G4-D2-18 | **M-H1 도구** `review-build.js`: 새 seed `g4-mh1-2026-09-26`, R 코퍼스(hold-out 없음)에서 층별(§22.4) — 층마다 sha256(seed:층:path) 순서의 앞, 8마디 이상·특징 있는 파일; 특징이 가장 빽빽한 8마디; 순서와 X/Y도 seed에서. **한 페이지의 두 ScoreView**(renderer prop)가 같은 Score(import door)를 같은 폭으로 그림; 계산된 색을 적고 class·id·data-*를 지워 렌더러를 드러내지 않음; 어느 판본이든 제 렌더러가 그리지 않았으면(fallback) 멈춤. 열쇠는 다른 디렉터리 | MuseScore 그림 (§22.4 선택 C, 사용자가 원할 때만), 두 페이지 (같은 Score 객체가 아님) | G04 §22.4; 로드맵 §10 |
| G4-D2-19 | **M-H1 packet을 진짜 blind로** (리뷰 R1): `manifest.json`에서 `seed`와 X/Y 배정 규칙("`parseInt(sha256(seed:xy:path)…)` 짝수면 legacy")을 빼고, 그 둘은 절대 배포되지 않는 열쇠 파일에만 둔다 — 파일·마디 선택 규칙(무엇을 어떻게 골랐는지)은 그대로 적어도 된다, 그것만으론 X/Y를 못 정하므로. `review-build.js`의 computed-style 복사가 `<svg>` 루트 자신을 빼먹어(정규식이 `path`류만 잡음) 판각기 루트가 리터럴 `fill="currentColor"`를 그대로 지니고 VexFlow 루트의 구운 기본값과 비대칭이던 것이 진짜 지문이었다 — 정규식에 `svg`를 더하고 루트의 `fill`·`stroke`·`stroke-width`·`stroke-dasharray`·`font-*`를 늘 지운다(모든 도형이 이미 제 색을 가짐). 보표선의 `stroke="none" stroke-width="1.3px"`는 `host`가 앱의 `[data-app]` 테마 루트 밖(`document.body`에 직접) 이라 `--staff`가 안 보여 `stroke: var(--score-staff, var(--staff))`가 초기값 `none`으로 떨어진 것 — `host.setAttribute('data-app', 'light')`로 실제 앱과 같은 조건을 줌. **새 M-H1 packet**: seed `g4-mh1-2026-09-26-fix`, `tests/engrave/out/review/m-h1`(+`m-h1-key`), 옛 packet과 열쇠(seed `g4-mh1-2026-09-26`)는 삭제 | manifest에 seed·규칙을 그대로 두고 "믿고 보지 말라"고만 적기, `<use>`/`<symbol>` id로 렌더러 구분하는 채널을 따로 막기(이미 `inline: true`라 없었다 — R3로 지금은 `<use>`를 쓰므로 그 id 접두사 `ppp-g-`도 복사 단계에서 지워지는 class/id 제거 규칙에 그대로 걸림, 확인함) | 독립 리뷰 R1 (증거: 리뷰 scratchpad `g4d2-review/mh1-own/`, 16/16 복원); `tests/engrave/tools/review-build.js` |
| G4-D2-20 | **마디 번호·안내 글자를 엔진의 skyline으로** (리뷰 R2, H5): `engrave/page.js`가 `engrave/skyline.js`를 더 받아(`require`), system마다 판각기가 그 system에 그린 모든 객체(보표선·마디선·brace 제외)와 곡선으로 `Skyline`을 채우고, 마디 번호·안내 글자 모두 독립 bounding-box 대신 `Skyline.put()`으로 배치 — 근사 오차 여유로 pad 2.5 px, 안내 글자는 아래 보표까지 2 px를 hard limit으로(넘으면 미는 대신 원래 자리, §16.6 G4-D2-7과 같은 정신). 60파일 코퍼스 표본(H5 규칙대로 notehead/stem/beam/accidental만, `coll3.js`): 마디 번호 115→3/1,698, 안내 글자 234→171/2,301. **남은 171은 명명된 지표 `eg.page.annotation_overlap`(목표 0)로 추적** — 그랜드 스태프 찬송가처럼 보표 사이 간격 자체가 좁은 마디는 layout의 보표 간격을 넓히는 변경 없이는 완전히 없앨 수 없어, 이 Fixer pass 범위 밖으로 Lead에 알림 | 마디 번호·안내 글자를 그래도 페이지의 것으로 두고 collision을 완전히 무시(리뷰가 MAJOR로 판정), skyline 대신 반경을 더 넓힌 고정 걸음 수만 늘리기(근본 원인을 그대로 둠) | 독립 리뷰 R2 (증거: `g4d2-review/coll.js`·`coll2.js`·`coll3.js`); G04 §37.18.3 |
| G4-D2-21 | **B9 회복: 페이지의 SVG_OPTS를 `inline: false`로** (리뷰 R3): `engrave/page.js:74`의 `SVG_OPTS`가 `inline: true`(글리프마다 리터럴 path)에서 svg.js의 기본인 `inline: false`(글리프마다 `<defs>`의 `<symbol>` 하나 + `<use>`)로 — 새 코드를 더 쓰지 않고 이미 있던 svg.js의 두 모드 중 하나를 그대로 씀. 리뷰가 실측한 5개 파일(비-hold-out 실제 곡) 모두 B9(legacy의 0.5배 이하) 안쪽으로 회복: burgmuller25/021 0.575→0.238, czerny849/001 0.514→0.291, sonatina/013 0.567→0.257, sonatina/016 0.778→0.341, sonatina/020 0.787→0.356 — waiver 불필요 | B9을 그대로 어긴 채 waiver(§19.1 예외)로 남기기 — B9이 완전히 회복되고(전부 0.4 이하) 실측 프레임 시간에 유의미한 퇴행이 없어(G4-D2-22) 이 대안을 쓸 필요가 없었음 | 독립 리뷰 R3 (증거: `g4d2-review/b9.js`); G04 §37.18.4 |
| G4-D2-22 | **repaint 배수의 기록 정정** (리뷰 R3, M2): §16.3·이전 DECISIONS가 적은 "Chrome이 `<use>`를 path보다 4–5배(때로 8–10배) 느리게 repaint"는 이 Fixer의 재측정(`repaint2.js`, sonatina/020 전곡 150프레임, Chrome trace)으로 다음과 같이 교정한다 — **paint류 trace 성분의 합은 실제로 약 4.6배**(`<use>` 10.03 ms/프레임 대 inline 2.18 ms/프레임, 독립 리뷰의 "약 2배"보다 큼)이지만, **체감 프레임 시간(중앙값)은 사실상 같다**(14.0 ms 대 13.9 ms) — paint류 작업이 16 ms 프레임 예산의 일부에 지나지 않아, 이론적 배수만큼 실제 재생이 느려지지 않는다. 기록은 "trace 성분 기준 4–5배가 맞고, 실제 재생 프레임 시간에는 (이 곡에서는) 측정 가능한 차이가 없다"로 남긴다 | 리뷰의 "약 2배"를 그대로 옮겨 적기(내 재측정과 다름 — 방법 차이일 수 있으나, 내가 직접 잰 숫자를 적음) | 이 Fixer의 재측정; G04 §37.18.4 |


## MX-1 — 재생 정확성 (유지보수 묶음, 2026-09-25 구현; 리뷰 NEEDS_FIX → 같은 날 수정, 재확인 대기; `docs/GOALS/MX1_PLAYBACK_CORRECTNESS.md`)

브랜치 `mx1-playback-correctness` (`1c92fc4`에서). 사용자 결정 D-1: ScoreGraph의 음높이와 MusicXML `<pitch>`는 **울리는 음**이고, 8va·8vb·15ma·15mb는 표시만 옮긴다 (written = sounding − shift).

| ID | 결정 | 버린 대안 | 근거 |
| --- | --- | --- | --- |
| MX1-D1 | **앱의 ottava `dir`·`semitones`는 어디서나 "울리는 음 − 적힌 음"이다.** MusicXML `<octave-shift type="down">`은 8va(+12), `"up"`은 8vb(−12) — `parseMusicXML`, `legacy.toScore`(그래프 shift +1 → `dir` +1), `legacy.fromScore`가 같은 부호. PdfLayer는 이미 이 부호였다 | 앱의 부호(`up` = +12)를 두고 finalize만 바꾸기 — 그러면 8va 구간을 울리는 음보다 한 옥타브 **위**에 "8vb"로 그린다 | MusicXML 명세 원문 ("…an octave-shift down from the pitch data"); PDMX(MuseScore)의 8va 77개가 모두 `type="down"` (G00 M9) |
| MX1-D2 | **`Score.finalize`는 울리는 음을 옮기지 않는다.** 파일·그래프에서 온 음: `soundingMidi = midi`, `writtenMidi = (writtenMidi ?? midi) − shift`, `writtenP = shiftPitchOctave(writtenP ‖ p, −shift)` — 이조 악기의 미리 채운 written(G2-D15)도 같은 방식. `soundingMidi`가 이미 있는 음(PdfLayer, 저장된 곡)은 그대로. 필드 순서도 그대로(`writtenP`, `writtenMidi`, `ottavaShift`, `soundingMidi`) | `p`를 written으로 바꾸기 (renderer·practice가 모두 `p`/`midi`를 울리는 음으로 읽는다) | `app-playback.test.js` (34파일 2,255음), `ottava-check.js` (페이지, 두 입구, 그린 머리 위치) |
| MX1-D3 | **저장된 곡은 옮기지 않는다.** MX-1 전에 저장된 Score(곡 슬롯, 공유 악보)는 저장된 대로 읽힌다: 그린 것 = 울리는 것은 여전히 맞고, 파일보다 한 옥타브 다르다. `legacy.agree`는 이제 그 Score를 파일의 그래프로 보지 않는다 → G4 renderer는 그 Score 자신의 projection을 그린다. 파일을 다시 가져오면 새로 읽힌다. 이미 선반에 있는 코스 곡은 슬롯에서 다시 열리므로(`openCoursePiece` → `openSong`) 곡을 지우고 다시 넣어야 한다 — 불러올 때 옮기려면 Score가 어느 규칙으로 finalize됐는지 표시가 있어야 한다 (후속 과제) | 불러올 때 고치기 — 저장된 Score는 어느 규칙으로 읽었는지 적혀 있지 않아서, 진짜 8vb를 옮길 수 있다 | `tests/scoregraph/fixtures/saved/stored-pre-mx1-ottava.score.json` (페이지에서 잡은 MX-1 전 Score): 그대로 읽히고, A48 정확, 파일과 `agree` false |
| MX1-D4 | **인쇄된 pedal `change` = damper를 떼었다가 바로 다시 밟기.** MIDI out: 같은 시각에 CC64 0, 그다음 127 (Web MIDI는 같은 timestamp를 보낸 순서로 낸다). sampler: damper 구간을 change에서 끊고 새로 연다 — pedal만 잡던 음은 거기서 놓고, 아직 눌린 건반은 다음 구간이 이어 잡는다. 숫자로 준 깊이(`<sound damper-pedal="64">`, 값이 있는 `change`)는 반 pedal 그대로. G3 `pedalJoin`은 OFF 그대로 | 다시 밟기를 몇 ms 늦추기(정해진 값이 없다), 반 pedal(64) 유지 | E17: D5 2박 (전 8박), CC64 `127 0 127`; `midi.test.js`의 가짜 출력 |
| MX1-D5 | **R4: 네 음 미만 `.mid`의 문구.** 코드 `no-notes`(바닥 아래)는 "PPP needs at least four notes to write a score, and this MIDI file has fewer." (ko·ja·zh 번역, en은 key), `MIDI-NO-NOTES`(음이 하나도 없음)는 "has no notes to read" 그대로. 코드는 안 바꾼다(녹음 입구가 같은 코드를 자기 문구로 쓴다). 바닥(4)은 G10a까지 그대로 | 새 오류 코드 — 녹음 경로와 테스트가 `no-notes`를 읽는다 | i18n 파일은 `json.dumps(indent=2, ensure_ascii=False) + "\n"`로 정확히 왕복한다. 그래서 ja·ko·zh의 중복 key `"Wrong note"` 중 앞의 것이 빠진다 (`JSON.parse`도 뒤의 것만 썼다 — 보이는 값은 같다) |
| MX1-D6 | **scoregraph 1.3.0 → 1.3.1**, `legacy-score.js`·`index.js`·`audio-score.js`의 script 태그 `?v=9`. adapter의 동작(부호, `unfinalize`)이 바뀌었으므로; engrave store의 그래프는 `agreeLib`가 달라 다시 확인된다 | 버전 그대로 (캐시된 옛 adapter가 새 finalize를 만나면 8va를 두 옥타브 틀리게 그린다) | `scoregraph/index.js` 규칙 ("any change to these files' behaviour") |
| MX1-D7 | **MX-1은 G0 bench를 바꾸지 않는다.** `pppbench/musicxml.py`의 `ottava="app"`, known failure `octave_shift_playback`(30파일 2,229음), correctness C10·C11의 "앱은 다르게 읽는다", unit r20은 MX-1 전의 앱을 본뜬 것으로 남는다. core·smoke 지표에는 들어가지 않는다(예측에 octave line이 없다) — `ab` identical. 고치면 `known_failures`가 바뀌므로 MX-2의 G0 rebaseline과 함께 | 여기서 bench도 고치기 — baseline 이유가 두 PR에 갈라진다 | 로드맵 §5.2 (MX-2: "rebaseline the G0 suites") |
| MX1-D8 | **감사(task 4): 커밋된 octave line 34파일 모두 울리는 음으로 적혀 있다** (카탈로그·samples 30, fixture 4; G0 hold-out 2는 이름 없이 둘 다 sounding). 증거 두 가지가 모두 같은 쪽이어야 판정: 그 음들이 적힌 보표 위치(오선 밖 거리), 선 경계의 선율 간격. MX-2로 넘길 파일 없음 | 판본 증거만으로 판정 | `tests/scoregraph/tools/ottava-audit.js`; 표는 MX1 기록 §3 |
| MX1-D9 | **R1: 마디 일부만 보이는 화면은 그 화면에 있는 만큼의 octave line을 그린다.** 시작이나 끝 마디가 화면 밖이면 건너뛰던 것을(`if (!a \|\| !z …) return`) 보이는 마디로 잘라 그린다: 앞에서 이어지면 "(8va)" (다음 줄로 넘어간 line과 같은 표기), 뒤로 이어지면 그 마디 끝까지 끝 갈고리 없이. 두 끝이 다 보이는 line은 전과 같다. label과 점선에 `data-ppp-row` — 태블릿이 다음 줄로 스크롤할 때 "(8va)"도 화면에 남는다. A45는 ScoreView를 지금 모양으로 고정하고, octave line 블록 밖은 55d1bd5와 바이트 단위로 같다는 hash를 하나 더 둔다 | 음을 소리 높이로 그리기 (보이는 곳마다 표기가 달라진다), 화면 밖 line은 무시 (지금의 결함) | Czerny 849/20 16–19마디: C5를 그리고 C6를 연주했다. `ottava-views.js` (아래 MX1-D12) |
| MX1-D10 | **R2: 카드(`openingBars`)는 음을 소리 높이로 그린다.** 카드에는 line이 없으므로 `writtenP`·`writtenMidi`에 shift를 되돌리고 `ottavaShift`를 0으로. 모든 Score는 MX-1 전에도 후에도 written = sounding − shift이므로, 이미 서버에 저장된 미리보기(MX-1 전, `8981750`)도 `sharedThumb`가 `openingBars`를 다시 거치며 같이 고쳐진다 | line을 카드 마디로 잘라 남기기 — 저장된 미리보기에는 남길 line이 없어 어차피 이 단계가 필요하다 | My Songs·Shared Scores·link 카드, 옛 곡의 카드, MX-1 전과 `8981750`이 저장한 미리보기 — `app-playback.test.js` R2, `ottava-views.js` |
| MX1-D11 | **M1: `score.ottavaRule = 'D-1'`.** `Score.finalize`가 한 번에 모든 음의 음높이 층을 만든 Score(가져오기, 녹음, demo, 재구성)에 붙인다. 이미 붙어 있으면 둔다. 층을 가지고 들어온 음이 있는데 표시가 없는 Score(이 커밋 전 저장)에는 붙이지 않는다. 곡 슬롯·공유(server JSONB)·카드에 남고, 그리지 않으므로 render는 그대로. A48(`a48-compare.js`)이 이 필드도 비교한다: `toScore(fromScore(S))`가 재현한다 (A 544파일, C 13개 — 표시만 더해 다시 캡처). MX-1 전 저장은 표시가 없고 그 재구성은 표시가 붙는다 (그 차이만 허용, 테스트로 고정). 마이그레이션은 하지 않는다 — MX-2가 무엇을 기준으로 할지는 MX1 기록 §7 | 버전 숫자, 그래프에 넣기 (scoregraph 변경), A48에서 빼기 | MX-1 전 Score와 MX-1 후 Score는 line 모양이 같아서, 표시가 없으면 나중에 구별할 수 없다 |
| MX1-D12 | **불변식 검사: 점수를 그리는 모든 화면에서 모든 음은 소리 높이에 그려지거나, 같은 system의 보이는 octave line 아래에서 그 label만큼 떨어져 그려진다.** `ottava-views.js`가 앱의 ScoreView로 (앱이 넘기는 props 그대로) 전곡(4·2마디 줄), This part(데스크톱·태블릿·폰), review, 대시보드 1마디, import preview, Progress, 카드 3종, 저장된 미리보기 2종, MX-1 전 곡을 그려 34파일 모두 확인한다. 줄(row)은 label의 `data-ppp-row`, 없으면(수정 전 renderer) 방향으로 정한다 | 전곡 화면만 재기 (리뷰가 찾은 구멍) | 이 브랜치 PASS; `8981750` FAIL (MX1 기록 §7) |
