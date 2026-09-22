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

## G1 — ScoreGraph (Proposed, 2026-09-22)

전문은 `docs/GOALS/G01_SCOREGRAPH.md` §21에 있다.

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
