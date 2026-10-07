# PPP 홈 PC 워커 (고품질 변환) / PPP home-PC worker

**한국어 먼저, 영어는 아래에 짧게.** (English summary below.)

## 이게 뭔가요

PPP 사이트(무료 서버)는 강력한 피아노 모델(TransKun + Kong)을 직접 돌릴 수 없어요. 대신 **내 PC가 대신 돌립니다.** 계정도 로그인도 필요 없어요.

1. PPP의 "설정 → 내 PC 연결"에서 **내 PC 링크 만들기**를 누르면 비밀 값 두 개가 한 번만 나와요. **PC 토큰**(`ppw_…`, 내 PC가 쓰는 열쇠)과 **PC 코드**(이 브라우저가 보관하는 열쇠. 다른 기기에서도 쓰려면 입력).
2. "악보 추가" 화면에서 유튜브 링크를 넣고 **고품질 변환 (내 PC)** 을 누르면, 사이트가 "이 링크를 변환해 줘"라는 요청을 대기열에 적어 둡니다.
3. 내 PC에서 이 워커(`worker.js`)가 사이트에 "할 일 있나요?" 하고 **먼저 물어봅니다**(내 PC로 들어오는 연결은 없어요).
4. 할 일이 있으면 오디오를 받아 PC의 GPU로 변환하고, 들은 음표만 사이트에 돌려줍니다. PPP 화면에서 **열기**를 누르면, 브라우저가 그 음표로 악보를 만들어 보여 줍니다(브라우저 모델의 음표로 만들 때와 같은 방식).

> 한계: PC가 켜져 있고 워커가 돌고 있어야 합니다. 요청한 뒤 PC가 확인하러 올 때까지(기본 약 한 시간) 기다릴 수 있어요. 바로 시작하려면 아래 바로가기(`run-once.cmd`)를 열거나, **PC 한 번 등록**(아래 "이 PC에서 바로 시작")을 해 두세요: 그러면 이 PC의 브라우저에서 「고품질 변환 (내 PC)」을 누르는 순간 바로 시작해요. 유튜브 링크만 됩니다(파일 업로드는 아직 아님). 도우미의 박자/페달 정보는 쓰지 않아요.

## 제일 쉬운 길: 한 번 설치하고, 사이트에서 버튼 한 번 (G10b-6)

1. **변환 환경 준비** (한 번만). 저장소 루트 `README.md`의 "Making a score from a recording" > Setup을 따라 `tools/transcribe-venv`, Kong 체크포인트(`tools/piano-transcription/*.pth`), `pip install transkun`, ffmpeg를 준비하세요. NVIDIA GPU용 PyTorch(CUDA)가 있으면 훨씬 빨라요(곡 1분에 약 10초). 이 PC에서 이미 `npm run omr`로 변환이 되면 준비 끝입니다.
2. **설정 파일** (한 번만). `tools/home-worker/worker.config.example.json`을 `%USERPROFILE%\.ppp-home-worker\worker.config.json`으로 복사하고 `siteUrl`(사이트 주소)과 경로(`pythonPath`, `transcribePy`, `kongCheckpoint`)만 고치세요. **`token`과 `clientCode`는 비워 두세요**: 사이트의 버튼이 알아서 채워 줘요. (`worker.config.json`은 git에 올라가지 않아요.)
3. **`tools\home-worker\install-startup.cmd` 더블클릭** (한 번만). 내 시작프로그램 폴더에 바로가기 하나를 만들고, PPP 프로그램(`worker.js --serve`)을 지금 바로 창 없이 시작해요. 관리자 권한도, 레지스트리도, 예약 작업도 필요 없어요. 이제 이 PC에 로그인할 때마다 저절로 켜져요.
4. **PPP 사이트에서: 설정 → 내 PC 연결 → 「이 PC 연결」 한 번 누르기.** 처음 한 번 브라우저가 「이 기기의 다른 앱 및 서비스에 접근할까요?」 하고 물으면 **허용**을 누르세요. 끝이에요: 링크 만들기도, 토큰 복사도, 설정 파일 편집도 없어요. 한 번 누르면 이 PC의 프로그램이 사이트에서 **자기만의 토큰**을 받아 설정 파일에 저장하고(토큰은 사이트 화면을 거치지 않아요), 바로 일을 시작해요.

**그 뒤에는 사이트가 바로 보여 줘요.** 설정 화면과 악보 추가 화면에서 (탭이 보이는 동안 5초마다):

| 보이는 말 | 뜻 |
| --- | --- |
| `내 PC 연결됨 ✓ · 대기 중` | 프로그램이 켜져 있고 이 기기의 PC 링크와 이어져 있어요 |
| `변환 중 45% · 곡 제목` | 지금 변환하는 중이에요 |
| `PC 프로그램이 꺼져 있어요` | 프로그램이 안 켜져 있어요 → `install-startup.cmd`를 한 번 실행했는지 확인하세요 |
| `아직 연결되지 않았어요` | 아직 「이 PC 연결」을 누르지 않았어요 |

**「고품질 변환 (내 PC)」** 를 누르면 프로그램이 곧바로 시작해요(창도, 「PPP worker를 열까요?」 질문도 없어요). 프로그램이 꺼져 있을 때만 예전의 `pppworker://` 방법을 대신 써요.

**휴대폰·태블릿**: 같은 카드의 **「휴대폰·태블릿 연결」** 을 누르면 QR 코드가 나와요. 휴대폰 카메라로 스캔하면 돼요(링크 복사도 있어요). 휴대폰은 연결하기 전에 먼저 물어봐요. **이 링크는 비밀번호와 같아요**: 나에게만 보여 주세요.

- **되돌리기**: `tools\home-worker\uninstall-startup.cmd` 더블클릭 — 바로가기를 지우고 켜져 있는 프로그램도 꺼요(이 도구가 만든 바로가기만 지워요).
- **안전**: 프로그램은 **이 PC 안(127.0.0.1)에서만** 듣고, 설정에 적힌 PPP 사이트의 페이지만 상대해요(다른 사이트, 다른 이름으로 들어온 요청, 주소 없는 요청은 모두 거절). 비밀(토큰, PC 코드)은 어떤 답에도, 로그에도 나오지 않아요. 자세한 위협과 대책은 `docs/GOALS/G10B_HOME_WORKER.md` 17장.
- **잔여 위험(솔직하게)**: 같은 PC에 **다른 Windows 사용자**나 악성 프로그램이 있으면 그쪽에서도 이 프로그램의 포트에 닿을 수 있어요. 그 경우 두 번째 브라우저를 위한 `GET /v1/link`가 PC 코드를 줄 수 있어요. 혼자 쓰는 PC라면 신경 쓰지 않아도 돼요. 마음에 걸리면 설정 파일에 `"bridgeLink": false`를 적으세요(두 번째 브라우저는 `pair.cmd`나 QR로 연결).
- **포트**: 기본 `47613`. 다른 프로그램이 쓰고 있으면 설정 파일에 `"bridgePort": 48000`처럼 적으세요(그러면 사이트의 버튼도 그 포트를 찾지 못하니 기본 포트를 비우는 쪽을 권해요).
- **한 번에 하나**: 프로그램을 두 번 켜면 두 번째는 「이미 실행 중이에요」 하고 바로 끝나요. 예약 작업·바탕화면 바로가기(`--once`)와도 실행 잠금(`worker.lock`)으로 겹치지 않아요.
- **사이트 운영비**: 프로그램은 한가할 때 사이트가 알려 준 대로(기본 한 시간) 물어볼 뿐이에요. 사이트 화면의 5초 갱신은 **이 PC 안의 프로그램**에게만 묻고 서버에는 가지 않아요.

## 예전 방법 1: 다른 기기를 링크로 연결하기 (G10b-3, `pair.cmd`)

> 위의 「이 PC 연결」과 QR 코드가 더 쉬워요. 아래는 그대로 쓸 수 있는 예전 방법이에요.

**이미 이 PC에 워커가 있다면: `tools\home-worker\pair.cmd` 를 더블클릭하세요.**

1. `pair.cmd` 를 더블클릭합니다. 휴대폰용 연결 링크가 **클립보드에 복사**되고, 이 PC의 브라우저가 이 PC용 링크(`&local=1` 이 붙은 링크)로 열려요. 화면에는 "브라우저에서 링크를 열었고, 휴대폰용 링크를 복사했어요. 브라우저에 보이는 PC 링크 이름이 …xxxxxx 인지 확인하세요" 라고 나와요. **이 단계는 아직 연결 완료가 아니에요**: 이 PC의 브라우저에 다른 PC 링크가 이미 있으면 PPP가 먼저 "연결할까요?" 하고 물어요(아래).
2. 복사된 링크를 **나에게 보내는 메시지**(카카오톡 "나와의 채팅" 등)에 붙여 넣고, 휴대폰에서 그 링크를 누르세요. 휴대폰에 다른 PC 링크가 없으면 바로 연결되고 「이 기기가 PC 링크 …xxxxxx를 쓰게 됐어요. 내가 만든 링크가 아니면 「연결 끊기」를 누르세요.」 알림이 떠요. **이미 다른 PC 링크를 쓰고 있는 기기**와 **페이지가 열려 있는 동안 도착한 링크**(다른 창이 주소를 바꾼 경우 포함)는 아무것도 바꾸지 않고 먼저 묻습니다: 「이 기기를 PC 링크 …AAAAAA에 연결할까요? 지금 이 기기가 쓰는 PC 링크 …BBBBBB를 대신하게 돼요. 열어 본 링크를 내가 직접 만든 경우에만 연결하세요.」 — 내가 만든 링크일 때만 **연결**을 누르고, 아니면 **유지**를 누르세요. (링크는 몇 번이고 다시 쓸 수 있어요.)

- **처음 한 번만** PC가 PC 코드를 알아야 해요. PPP → 설정 → 내 PC 연결 → **다른 기기 연결: 링크 복사**로 링크를 복사한 뒤, 설정 파일 **옆에** `pc-code.txt` 파일을 만들어 그대로 붙여 넣으세요. (설정 파일이 `%USERPROFILE%\.ppp-home-worker\worker.config.json` 이면 `%USERPROFILE%\.ppp-home-worker\pc-code.txt`.) 링크 대신 코드만 넣어도 되고, 설정 파일에 `"clientCode": "<링크 또는 코드>"` 로 적어도 돼요(없어도 워커는 그대로 일해요: `clientCode`는 `--pair` 에만 쓰여요). `pc-code.txt` 는 git에 올라가지 않아요.
- **링크는 비밀번호와 같아요.** 링크(또는 코드)를 가진 사람은 누구나 내 PC로 변환을 보내고 결과를 볼 수 있어요. **나에게만** 보내세요. 새어 나갔다면 설정 → 내 PC 연결 → 더 보기 → **링크 지우기**로 지우고 새 링크를 만드세요(이전 링크는 바로 멈춰요).
- `pair.cmd` 화면에는 링크가 나오지 않아요(로그에도 남지 않아요). 직접 보려면 `node tools/home-worker/worker.js --pair --show`.
- 링크가 안 열리는 기기(앱 안의 브라우저 등)는 설정 → 내 PC 연결 → 더 보기 → **다른 기기의 PC 링크 쓰기**에 링크를 붙여 넣으세요.
- **새 PC** 라면 아래 4단계 설정을 먼저 하세요(바뀐 것 없음).

## 예전 방법 2: 토큰을 직접 복사하는 4단계 설정 (로그인 필요 없음)

> 위의 「이 PC 연결」을 쓰면 2~4단계는 필요 없어요. 버튼을 쓰지 않고 손으로 하고 싶을 때만 따르세요.

1. **변환 환경 준비** (한 번만). 저장소 루트 `README.md`의 "Making a score from a recording" > Setup을 따라 `tools/transcribe-venv`, Kong 체크포인트(`tools/piano-transcription/*.pth`), `pip install transkun`, ffmpeg를 준비하세요. NVIDIA GPU용 PyTorch(CUDA)가 있으면 훨씬 빨라요(곡 1분에 약 10초). 이 PC에서 이미 `npm run omr`로 변환이 되면 준비 끝입니다.
2. **PC 링크 만들기.** PPP → **설정 → 내 PC 연결 → 내 PC 링크 만들기**. (로그인하지 않아도 돼요.) 화면에 순서대로 나옵니다: **① 연결 링크**(복사해서 다른 기기에서 여세요) 그리고 **② PC에 워커가 아직 없을 때만**: **PC 토큰**(한 번만 보여요)과 PC에 넣을 줄(`"siteUrl"`, `"token"`)과 명령. 토큰을 잃어버렸다면 **더 보기 → 새 PC 토큰**을 만드세요(이전 토큰은 바로 멈춥니다).
3. **설정 파일.** `tools/home-worker/worker.config.example.json`을 같은 폴더의 `worker.config.json`으로 복사하고 `siteUrl`(사이트 주소)과 `token`(PC 토큰)을 채우세요. 파일 경로가 다르면 `pythonPath`, `transcribePy`, `kongCheckpoint`도 고치세요. (`worker.config.json`은 git에 올라가지 않아요.)
4. **점검, 그리고 실행.** `node tools/home-worker/worker.js --check` — 사이트, 토큰, ffmpeg, Python(torch/transkun), 체크포인트를 확인하고 고칠 것을 알려 줘요. 문제가 없으면 `node tools/home-worker/worker.js --once`(아래 표). 워커가 한 번이라도 사이트에 접속하면 PPP의 악보 추가 화면에 **고품질 변환 (내 PC)** 버튼이 나타나요.

**다른 기기에서도 쓰려면:** 위의 "제일 쉬운 길"처럼 연결 링크를 그 기기에서 열기만 하면 돼요(링크는 설정 → 내 PC 연결 → **다른 기기 연결: 링크 복사**, 폰에서는 **공유**). 두 기기가 같은 변환 목록을 봅니다. 링크(코드)를 가진 사람은 누구나 내 PC로 변환을 요청하고 그 결과를 볼 수 있으니 **비밀로 간직하세요.** 새어 나갔다면 **더 보기 → 링크 지우기**로 지우고 새로 만드세요. (코드만 보고 싶다면 더 보기 → 내 PC 코드 보기.)

## 실행하는 방법

| 방법 | 명령 | 언제 |
| --- | --- | --- |
| **계속 켜 두기 + 사이트 버튼** (G10b-6, 권장) | `install-startup.cmd` (한 번) 또는 `node tools/home-worker/worker.js --serve` | 사이트의 「이 PC 연결」 버튼·상태·바로 시작을 쓸 때. 한가하면 약 한 시간마다 확인하고, 사이트 화면에는 이 PC 안에서만 답해요. |
| **한 번만** | `node tools/home-worker/worker.js --once` 또는 `run-once.cmd` 더블클릭 | 변환을 요청한 뒤. 대기 중인 걸 모두 처리하고 끝나요. |
| 계속 켜 두기 | `node tools/home-worker/worker.js` 또는 `run-forever.cmd` | PC를 늘 켜 두는 경우. 한가하면 약 한 시간마다, 일이 있으면 15초마다 확인해요. |

사이트가 알려 주는 대기 시간(`nextPollSeconds`: 한가할 때 기본 3600초, 사이트 설정으로도 900초 밑으로는 못 내려요)을 따르며, 설정의 `idlePollSeconds`는 **더 길게만** 바꿀 수 있어요. 멈추려면 Ctrl-C (한 번: 하던 변환을 마치고 끝냄, 두 번: 바로 끝냄).

### 바탕화면 바로가기 / 예약 작업 (직접 실행하세요 — 이 스크립트는 자동으로 설치되지 않습니다)

- 바탕화면 바로가기 만들기: PowerShell에서 `powershell -ExecutionPolicy Bypass -File tools\home-worker\create-desktop-shortcut.ps1` — 바탕화면에 "PPP 고품질 변환 (내 PC)" 바로가기(= `run-once.cmd`)를 만듭니다. 바로가기를 열면 지금 바로 확인하고 처리해요.
- Windows 예약 작업(선택): `tools\home-worker\schedule-task-example.ps1`을 열어 읽고, 원하는 간격을 정한 뒤 직접 실행하세요. 로그인할 때 한 번 + N시간마다 `--once`를 돌리는 작업을 만듭니다. 지우려면 `Unregister-ScheduledTask -TaskName "PPP home worker" -Confirm:$false`.

## 사이트 운영비 0원을 지키는 방법 (왜 한 시간인가)

무료 Render 서비스는 요청이 오면 15분간 깨어 있고, 월 750시간을 다른 서비스와 나눠 써요. 워커가 1분마다 물어보면 사이트가 24시간 깨어 있게 되어 한도를 다 써 버려요. 그래서 **한가할 땐 길게(기본 한 시간), 일이 있을 땐 짧게(15초)** 확인합니다. 한가한 확인은 데이터베이스를 건드리지 않고 사이트의 메모리에서 답해요. 숫자와 근거는 `docs/GOALS/G10B_HOME_WORKER.md`에 있어요. **한가할 때의 간격이 짧을수록 사이트가 더 오래 깨어 있어요**(15분 이하면 한 달 내내, 20분이면 약 77%, 1시간이면 약 26%, 3시간이면 약 9%). 그래서 기본값은 한 시간이고, 평소엔 `--once` 바로가기를 쓰는 걸 권해요.

### 이 PC에서 바로 시작 (G10b-4)

**PC 한 번 등록: `register-protocol.cmd` 더블클릭 → 이 PC 브라우저에서 「고품질 변환 (내 PC)」을 누르면 바로 시작해요.**

- `tools\home-worker\register-protocol.cmd` 를 **한 번** 더블클릭하세요(또는 `node tools/home-worker/worker.js --register-protocol`). Windows 레지스트리의 **현재 사용자 부분(HKEY_CURRENT_USER)** 에만 값 3개를 써요(관리자 권한 필요 없음, 다른 계정·시스템 전체에는 영향 없음). `pppworker://` 라는 주소를 "이 PC의 `run-hidden.vbs` 를 실행"으로 연결하는 거예요.
- 그다음 PPP → 설정 → 내 PC 연결에서 **「이 PC에서 바로 시작」** 을 켜세요(`pair.cmd` 가 연 이 PC용 링크로 연결했다면 이미 켜져 있어요). 이 PC의 브라우저에서 **고품질 변환 (내 PC)** 을 누르면, 변환이 대기열에 들어간 **뒤에** 페이지가 `pppworker://run` 을 열어요. 브라우저가 처음 한 번 「PPP worker를 열까요?」 하고 묻는데, 허용하면 창 없이 `--once` 가 돌아요(기록은 설정 파일 옆 `worker.log`). 휴대폰은 이 기능이 없어요: 휴대폰에서 누른 요청은 PC가 다음에 확인할 때 처리돼요.
- 페이지는 시작됐는지 알 수 없어서 **"이 PC에 시작하라고 요청했어요. 아무 일도 일어나지 않으면 바탕화면 바로가기를 실행하세요."** 라고만 말해요. 변환 목록의 줄이 「내 PC에서 변환하는 중」으로 바뀌면 시작된 거예요. 안 바뀌면 **지금 시작** 버튼(한 번 더 요청)을 누르거나 바탕화면 바로가기를 쓰세요.
- **안전**: `pppworker://` 뒤에 무엇이 붙어도 **버려져요**(등록된 명령에 `%1` 이 없고 `run-hidden.vbs` 는 인자를 읽지 않아요). 아무 웹사이트나 이 주소를 열 수 있지만, 그러면 브라우저가 먼저 허락을 묻고, 허락해도 **워커가 한 번 돌아 PPP 사이트에서 내 링크의 할 일만 가져올 뿐**(CPU/GPU 시간 정도)이에요. 동시에 두 번 돌지 않아요(실행 잠금: 같은 폴더의 `worker.lock`, 45분 넘으면 무시).
- 확인: `node tools/home-worker/worker.js --protocol-status`. **지우기: `unregister-protocol.cmd` 더블클릭**(또는 `--unregister-protocol`) — 이 도구가 만든 항목만 지워요.

## 문제 해결

| 증상 | 원인/해결 |
| --- | --- |
| 「이 PC 연결」을 눌렀더니 「PC 프로그램이 꺼져 있어요」 | `install-startup.cmd`를 실행했는지, 다른 브라우저 창에서 「접근 허용」을 거부하지 않았는지 보세요(주소창의 자물쇠 → 사이트 설정 → 「이 기기의 다른 앱 및 서비스」). `tools\home-worker\startup-shortcut.ps1 status`(PowerShell)로 바로가기와 실행 상태를 볼 수 있고, 로그는 설정 파일 옆 `worker.log`예요. 포트를 다른 프로그램이 쓰면 로그에 그렇게 적혀요(`bridgePort`). |
| 사이트 주소가 설정의 `siteUrl`과 달라요 | 프로그램은 `siteUrl`의 사이트만 상대해요. 다른 주소(다른 도메인)로 사이트를 열었다면 그 주소를 `siteUrl`에 적고 프로그램을 다시 켜세요. |
| 버튼이 안 보여요 | 워커가 아직 한 번도 접속하지 않았어요. `--once`를 한 번 실행하세요. 또 이 기기에 PC 링크가 없으면(설정에서 만들거나 코드를 입력) 버튼이 없어요. |
| `The site does not accept this token` | PC 링크를 지웠거나(PC가 한 번도 접속하지 않은 링크는 마지막으로 쓴 지 14일, 그 밖의 링크는 60일 동안 안 쓰면 사이트가 지워요), 새 PC 토큰이 이 토큰을 대신했거나, 잘못 붙여넣었어요. 설정에서 새 PC 토큰(또는 새 링크)을 만드세요. (워커는 멈춥니다.) |
| 설정 화면이 "PC 링크가 더 이상 유효하지 않아요"라고 해요 | 다른 기기에서 지웠거나 오래 안 써서 사이트가 지웠어요. 새로 만드세요. |
| 「이 PC에서 바로 시작」을 켰는데 아무 일도 안 일어나요 | `node tools/home-worker/worker.js --protocol-status` 로 등록을 확인하세요(없으면 `register-protocol.cmd`). 브라우저의 「PPP worker를 열까요?」에서 허용했는지, 이미 돌고 있는 실행이 있는지(`worker.log`: "이미 다른 실행이 진행 중이에요")도 보세요. 안 되면 바탕화면 바로가기를 쓰세요. |
| 설정에 "내 PC 연결"이 안 보여요 | 브라우저가 저장 공간을 막고 있어요(시크릿/비공개 창). 일반 창에서 여세요. |
| `ffmpeg does not run` | ffmpeg를 설치하거나 `ffmpegPath`에 전체 경로를 쓰세요. |
| `Python cannot import torch...` | `pythonPath`가 변환용 venv의 python인지 확인하세요. |
| `The audio could not be downloaded` | 사이트가 유튜브 오디오를 받지 못했어요(차단/일시 오류). 사이트가 몇 분 뒤 최대 3번 다시 시도합니다. 설정에 `ytdlpPath`(yt-dlp.exe)를 쓰면 이 PC에서 직접 받아요. |
| 변환은 됐는데 열기가 안 돼요 | 결과는 3일 뒤 지워집니다. 다시 요청하세요. |

보안: 토큰은 이 PC의 파일(`worker.config.json`) 또는 환경변수 `PPP_WORKER_TOKEN`에만 있고(**설정 파일은 프로젝트 폴더가 아니라 내 사용자 폴더 안, 예: `%USERPROFILE%\.ppp-home-worker\worker.config.json` 에 두세요** — 프로젝트 폴더가 클라우드 동기화·공유 폴더·백업에 들어 있으면 토큰이 함께 퍼져요. 워커는 `worker.js` 옆의 파일이 없으면 그 폴더의 파일을 찾아요. 토큰만 환경변수 `PPP_WORKER_TOKEN`으로 주고 파일에는 쓰지 않아도 돼요), 로그에는 나오지 않아요. 사이트에는 토큰과 코드의 해시만 저장돼요(사이트가 털려도 두 값은 나오지 않아요). 이 토큰으로는 **내 링크의 변환 작업만** 가져오고 결과를 올릴 수 있어요. 설정 화면에서 언제든 **새 PC 토큰**(이전 토큰이 바로 멈춰요)이나 **링크 지우기**(링크와 변환 결과가 모두 지워져요)를 할 수 있어요. 이전 버전(계정이 필요했던 때)의 토큰은 더 이상 쓸 수 없어요 — 새 링크를 만드세요.

---

## English summary

The free PPP server cannot run the strong piano models (TransKun + Kong). This worker runs them **on your own PC** (GPU). **No account and no sign-in are needed**: in **Settings > Connect my PC** the page makes a *PC link* for anybody - a **PC token** (`ppw_...`, for the PC) and a **PC code** (kept by the browser, typed on another device to share the same list). Both are shown once when the link is made; the site keeps only their hashes. The page queues a YouTube link (**High-quality (my PC)** on the Add screen), this script polls the site with the token, downloads the audio from the site's `/api/youtube-audio`, runs `transcribe.py` (the same call as `omr-service.js`), and posts the accepted notes back (no pedal, no beats). The page writes the score from those notes in the browser; **Open** appears in "My conversions".

Setup in 4 steps: (1) the transcription environment from the root README (`tools/transcribe-venv`, Kong checkpoint, `transkun`, ffmpeg); (2) Settings > Connect my PC > **Create my PC link**, copy the PC token (the page shows the exact lines to put on the PC; keep the settings file in your own user folder, e.g. `%USERPROFILE%\.ppp-home-worker\worker.config.json`, not in a synced or shared project folder - or give the token only through the `PPP_WORKER_TOKEN` environment variable); (3) copy `worker.config.example.json` to `worker.config.json` and fill in `siteUrl` and `token`; (4) `node tools/home-worker/worker.js --check`, then `node tools/home-worker/worker.js --once` (or leave `node tools/home-worker/worker.js` running).

- **Keep the code and the token secret.** Anyone with the PC code can queue conversions for your PC and read the results; anyone with the token can take your PC's work. If either leaks: **New PC token** (the old one stops at once) or **Remove link** (the link and its conversions are deleted), then make a new link. A link nobody uses for 60 days, or whose PC never connects and that nobody has used for 14 days, is purged by the site. Tokens from the earlier version of this feature (which needed an account) no longer work: make a new link.
- **Connecting your devices is one tap (G10b-3).** A *pairing link* is `https://<site>/#pc=<the 64-hex PC code>`; opening it on any device pairs that device (the part after `#` is a URL fragment: browsers never send it to a server, and the page removes it from the address bar before doing anything else). **On a PC that already has the worker: double-click `pair.cmd`** (`node tools/home-worker/worker.js --pair`): it copies the link to the clipboard (the `clip` tool, the link on its standard input) and opens it in the PC's browser (`rundll32 url.dll,FileProtocolHandler <link>`, one argument, no shell), then says (Korean first) that it opened the link in the browser and copied the phone link, with the link's name to compare; paste the copied link in a message to yourself and open it on the phone (G10b-4: the browser's link ends in `&local=1`, the phone link does not; the page asks before it replaces a link the device already uses). It needs the PC code once: put the link (or just the code) in `pc-code.txt` next to the settings file, or give `"clientCode"` in the settings (optional; only `--pair` reads it; never logged, never sent to the site). The link is printed only with `--show`. **The link is a master secret like the code**: send it only to yourself; if it leaks, Settings > Connect my PC > More > **Remove link**, then make a new one. In the page: Settings > Connect my PC > **Connect another device: copy link** (and **Share** on a phone); the old buttons are under **More**.
- **Start at once from this PC (G10b-4).** One time only: double-click `register-protocol.cmd` (`node tools/home-worker/worker.js --register-protocol`). It writes three values under `HKEY_CURRENT_USER\Software\Classes\pppworker` (this Windows user only, no administrator rights; `reg.exe` with an argument vector, no shell) so that the link `pppworker://run` runs `wscript.exe //B //Nologo "<this folder>\run-hidden.vbs"`, which starts `run-once-hidden.cmd` (`worker.js --once --log-file`, hidden, no window; the log is `worker.log` next to the settings). Anything after `pppworker://` is thrown away: the registered command has no `%1` and `run-hidden.vbs` never reads an argument, so no web page can pass this PC anything - a page that fires the link only makes the browser ask "Open PPP worker?" and, if you agree, starts one bounded `--once` run that asks the PPP site for the jobs of YOUR link (CPU/GPU time and nothing else). In PPP, Settings > Connect my PC > **Start at once from this PC** (on by itself when this PC was connected with the link `pair.cmd` opens: it ends in `&local=1`; the phone link never does) makes the **High-quality (my PC)** button ask the PC to start right after the job is queued, and says only "Asked this PC to start. If nothing happens, run the desktop shortcut." (a page cannot know whether the link was handled); **Start now** asks again while a job waits. Check: `--protocol-status`. Undo: `unregister-protocol.cmd` (`--unregister-protocol`; it removes only the key this tool made). The scheduled task, the desktop shortcut and this launch can never overlap: `--once` takes a lock (`worker.lock` next to the settings; a second run stops with one line; a dead owner or a lock of 45 minutes or more is taken over).
- **Pairing is confirmed (G10b-4).** `pair.cmd` copies the PHONE link (no `&local=1`) and opens THIS PC's link (with it) in the browser, and prints the link's NAME (`…xxxxxx`, the last 6 hex of the link id, not secret; the same 6 characters are in the page's banner, in its Settings status line and under the Add button). It no longer says "connected": a device that already uses another PC link, and any link that arrives while the page is open, are asked first ("Connect this device to PC link …AAAAAA? It would replace the PC link …BBBBBB ... only if you made the link yourself": Connect / Keep) and nothing is stored before the tap; a device with no link is connected at once with "Disconnect" in the banner.
- **One press (G10b-6).** Run `install-startup.cmd` once: it puts one shortcut in YOUR Startup folder (no administrator rights, no registry, no scheduled task) so that `worker.js --serve` starts hidden at every sign-in (and starts it now); `uninstall-startup.cmd` removes it and stops the program. `--serve` keeps today's polling loop (the site's `nextPollSeconds`, an hour when idle - never faster) and also listens on `127.0.0.1:47613` ONLY, for the PPP page of this PC: **Settings > Connect my PC > "Connect this PC"** is the whole setup (the page makes a PC link if neither side has one, or takes/gives the one that exists - asking once before it replaces a different live link - and the program gets its OWN worker token from the site and saves token and code to its settings file; no worker token ever passes through the page). Afterwards the page shows, every ~5 s while Settings or the Add screen is open and the tab is visible, "My PC is connected / Converting 45% - title / The PC program is not running", **High-quality (my PC)** starts the run at once (`POST /v1/run`; `pppworker://` is only the fallback), and **Connect a phone or tablet** shows a QR code of the pairing link. The bridge answers only the site named in `siteUrl` (strict Host and Origin checks, preflight with Private Network Access, 2 KB JSON bodies, rate limits), shows no secret in any answer or log, and starts no program from anything a request says; a second `--serve` finds the port taken and stops. Residual risk, said plainly: another Windows user or program on the same PC can reach the port and forge an Origin, so `GET /v1/link` can give them the PC code (`"bridgeLink": false` in the settings turns that route off; a per-install secret would not help because the page could not know it without typing). Design and threats: `docs/GOALS/G10B_HOME_WORKER.md` section 17.
- `--once`: one check, process everything waiting, exit (exit codes: 0 ok, 1 a failure or the site unreachable, 2 token rejected). Use `run-once.cmd` or the desktop shortcut made by `create-desktop-shortcut.ps1` (run it yourself; nothing is installed for you).
- Waiting is the **site's** call (`nextPollSeconds`: 15 s while something is queued, claimed or just finished, otherwise **an hour** by default, and the site will not go below 15 minutes); `idlePollSeconds` in the settings can only lengthen it. The shorter the idle interval, the longer the free server stays awake (15 minutes or less: all month; 20 minutes: about 77%; an hour: about 26%). Free-tier arithmetic: `docs/GOALS/G10B_HOME_WORKER.md`.
- Limits: the PC must be on with the worker running; latency up to the check interval; only your own link's jobs; YouTube links only; the helper's beats and pedal are not used; at most 15 minutes of audio; results are kept 3 days.
- Optional `ytdlpPath` downloads the audio with yt-dlp on this PC (the site is the fallback); `audioBase` names another place for `/api/youtube-audio`.
