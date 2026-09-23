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

## G2 — Score Import (Proposed, 2026-09-23, 설계만)

전문은 `docs/GOALS/G02_SCORE_IMPORT.md`에 있다. **구현 전이므로 전부 Proposed다.**

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
