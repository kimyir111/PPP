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
| G3-I9 | **flip 보류**: G3 gate의 `tm_missing == 0`·`mergeable == 0`이 R17·H7과 충돌 | G03 §27.4 — 사용자 결정 |
