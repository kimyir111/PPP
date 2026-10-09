# PPP 홈 PC 워커 (고품질 변환) / PPP home-PC worker

**한국어 먼저, 영어는 아래에 짧게.** (English summary below.)

## 이게 뭔가요

PPP 사이트(무료 서버)는 강력한 피아노 모델(TransKun + Kong)을 직접 돌릴 수 없어요. 대신 **내 PC가 대신 돌립니다.** 계정도 로그인도 필요 없어요.

1. PPP의 "설정 → 내 PC 연결"에서 **내 PC 링크 만들기**를 누르면 비밀 값 두 개가 한 번만 나와요. **PC 토큰**(`ppw_…`, 내 PC가 쓰는 열쇠)과 **PC 코드**(이 브라우저가 보관하는 열쇠. 다른 기기에서도 쓰려면 입력).
2. "악보 추가" 화면에서 유튜브 링크를 넣고 **고품질 변환 (내 PC)** 을 누르면, 사이트가 "이 링크를 변환해 줘"라는 요청을 대기열에 적어 둡니다.
3. 내 PC에서 이 워커(`worker.js`)가 사이트에 "할 일 있나요?" 하고 **먼저 물어봅니다**(내 PC로 들어오는 연결은 없어요).
4. 할 일이 있으면 오디오를 받아 PC의 GPU로 변환하고, 들은 음표(그리고 PC에 `beat-this`가 설치되어 있으면 박자 위치)를 사이트에 돌려줍니다. PPP 화면에서 **열기**를 누르면, 브라우저가 그 음표로 악보를 만들어 보여 줍니다(브라우저 모델의 음표로 만들 때와 같은 방식).

> 한계: PC가 켜져 있고 워커가 돌고 있어야 합니다. 요청한 뒤 PC가 확인하러 올 때까지(기본 약 한 시간) 기다릴 수 있어요. 바로 시작하려면 아래 바로가기(`run-once.cmd`)를 열거나, **PC 한 번 등록**(아래 "이 PC에서 바로 시작")을 해 두세요: 그러면 이 PC의 브라우저에서 「고품질 변환 (내 PC)」을 누르는 순간 바로 시작해요. 유튜브 링크만 됩니다(파일 업로드는 아직 아님). 도우미의 페달 정보는 쓰지 않아요. 박자 정보(Beat This)는 마디의 첫 박이 어디인지 정하는 참고 자료로만 씁니다(마디 길이는 음표로 정해요). 끄려면 설정 파일에 `"beats": false`.

## 내 기기 연결하기 — 제일 쉬운 길 (G10b-3)

**이미 이 PC에 워커가 있다면, 1단계: `tools\home-worker\pair.cmd` 를 더블클릭하세요.**

1. `pair.cmd` 를 더블클릭합니다. 휴대폰용 연결 링크가 **클립보드에 복사**되고, 이 PC의 브라우저가 이 PC용 링크(`&local=1` 이 붙은 링크)로 열려요. 화면에는 "브라우저에서 링크를 열었고, 휴대폰용 링크를 복사했어요. 브라우저에 보이는 PC 링크 이름이 …xxxxxx 인지 확인하세요" 라고 나와요. **이 단계는 아직 연결 완료가 아니에요**: 이 PC의 브라우저에 다른 PC 링크가 이미 있으면 PPP가 먼저 "연결할까요?" 하고 물어요(아래).
2. 복사된 링크를 **나에게 보내는 메시지**(카카오톡 "나와의 채팅" 등)에 붙여 넣고, 휴대폰에서 그 링크를 누르세요. 휴대폰에 다른 PC 링크가 없으면 바로 연결되고 「이 기기가 PC 링크 …xxxxxx를 쓰게 됐어요. 내가 만든 링크가 아니면 「연결 끊기」를 누르세요.」 알림이 떠요. **이미 다른 PC 링크를 쓰고 있는 기기**와 **페이지가 열려 있는 동안 도착한 링크**(다른 창이 주소를 바꾼 경우 포함)는 아무것도 바꾸지 않고 먼저 묻습니다: 「이 기기를 PC 링크 …AAAAAA에 연결할까요? 지금 이 기기가 쓰는 PC 링크 …BBBBBB를 대신하게 돼요. 열어 본 링크를 내가 직접 만든 경우에만 연결하세요.」 — 내가 만든 링크일 때만 **연결**을 누르고, 아니면 **유지**를 누르세요. (링크는 몇 번이고 다시 쓸 수 있어요.)

- **처음 한 번만** PC가 PC 코드를 알아야 해요. PPP → 설정 → 내 PC 연결 → **다른 기기 연결: 링크 복사**로 링크를 복사한 뒤, 설정 파일 **옆에** `pc-code.txt` 파일을 만들어 그대로 붙여 넣으세요. (설정 파일이 `%USERPROFILE%\.ppp-home-worker\worker.config.json` 이면 `%USERPROFILE%\.ppp-home-worker\pc-code.txt`.) 링크 대신 코드만 넣어도 되고, 설정 파일에 `"clientCode": "<링크 또는 코드>"` 로 적어도 돼요(없어도 워커는 그대로 일해요: `clientCode`는 `--pair` 에만 쓰여요). `pc-code.txt` 는 git에 올라가지 않아요.
- **링크는 비밀번호와 같아요.** 링크(또는 코드)를 가진 사람은 누구나 내 PC로 변환을 보내고 결과를 볼 수 있어요. **나에게만** 보내세요. 새어 나갔다면 설정 → 내 PC 연결 → 더 보기 → **링크 지우기**로 지우고 새 링크를 만드세요(이전 링크는 바로 멈춰요).
- `pair.cmd` 화면에는 링크가 나오지 않아요(로그에도 남지 않아요). 직접 보려면 `node tools/home-worker/worker.js --pair --show`.
- 링크가 안 열리는 기기(앱 안의 브라우저 등)는 설정 → 내 PC 연결 → 더 보기 → **다른 기기의 PC 링크 쓰기**에 링크를 붙여 넣으세요.
- **새 PC** 라면 아래 4단계 설정을 먼저 하세요(바뀐 것 없음).

## 4단계 설정 (로그인 필요 없음)

1. **변환 환경 준비** (한 번만). 저장소 루트 `README.md`의 "Making a score from a recording" > Setup을 따라 `tools/transcribe-venv`, Kong 체크포인트(`tools/piano-transcription/*.pth`), `pip install transkun`, ffmpeg를 준비하세요. NVIDIA GPU용 PyTorch(CUDA)가 있으면 훨씬 빨라요(곡 1분에 약 10초). 이 PC에서 이미 `npm run omr`로 변환이 되면 준비 끝입니다.
2. **PC 링크 만들기.** PPP → **설정 → 내 PC 연결 → 내 PC 링크 만들기**. (로그인하지 않아도 돼요.) 화면에 순서대로 나옵니다: **① 연결 링크**(복사해서 다른 기기에서 여세요) 그리고 **② PC에 워커가 아직 없을 때만**: **PC 토큰**(한 번만 보여요)과 PC에 넣을 줄(`"siteUrl"`, `"token"`)과 명령. 토큰을 잃어버렸다면 **더 보기 → 새 PC 토큰**을 만드세요(이전 토큰은 바로 멈춥니다).
3. **설정 파일.** `tools/home-worker/worker.config.example.json`을 같은 폴더의 `worker.config.json`으로 복사하고 `siteUrl`(사이트 주소)과 `token`(PC 토큰)을 채우세요. 파일 경로가 다르면 `pythonPath`, `transcribePy`, `kongCheckpoint`도 고치세요. (`worker.config.json`은 git에 올라가지 않아요.)
4. **점검, 그리고 실행.** `node tools/home-worker/worker.js --check` — 사이트, 토큰, ffmpeg, Python(torch/transkun), 체크포인트를 확인하고 고칠 것을 알려 줘요. 문제가 없으면 `node tools/home-worker/worker.js --once`(아래 표). 워커가 한 번이라도 사이트에 접속하면 PPP의 악보 추가 화면에 **고품질 변환 (내 PC)** 버튼이 나타나요.

**다른 기기에서도 쓰려면:** 위의 "제일 쉬운 길"처럼 연결 링크를 그 기기에서 열기만 하면 돼요(링크는 설정 → 내 PC 연결 → **다른 기기 연결: 링크 복사**, 폰에서는 **공유**). 두 기기가 같은 변환 목록을 봅니다. 링크(코드)를 가진 사람은 누구나 내 PC로 변환을 요청하고 그 결과를 볼 수 있으니 **비밀로 간직하세요.** 새어 나갔다면 **더 보기 → 링크 지우기**로 지우고 새로 만드세요. (코드만 보고 싶다면 더 보기 → 내 PC 코드 보기.)

## 실행하는 방법

| 방법 | 명령 | 언제 |
| --- | --- | --- |
| **한 번만** (권장) | `node tools/home-worker/worker.js --once` 또는 `run-once.cmd` 더블클릭 | 변환을 요청한 뒤. 대기 중인 걸 모두 처리하고 끝나요. |
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

## 일반 곡 모드 (G10d, 선택)

PPP의 「어떤 음원인가요?」에서 **일반 곡 (노래·밴드)** 을 고르면, PC가 먼저 음원을 나눕니다(Demucs `htdemucs_6s`, MIT). 드럼은 빼고, 노래는 멜로디로, 베이스는 베이스 라인으로(음높이 추적 pYIN), 기타·피아노·나머지 악기는 기존 피아노 모델 두 개로 듣습니다. 음마다 어느 층(멜로디 1 / 베이스 2 / 반주 3)인지 붙여서 보내고, 악보의 쉬운 단계(리드시트)는 노래 멜로디를 선율로 씁니다. 피아노 모델은 사람 목소리를 거의 못 듣기 때문에(TransKun은 보컬만 넣으면 2:37 동안 2음) 노래가 있는 곡은 이 모드가 필요합니다.

설치(한 번만, 변환 환경과 같은 Python으로). 패키지를 Python 자체에 넣지 않고 따로 둡니다:

```
tools/transcribe-venv/Scripts/python.exe -m pip install --target tools/song-lib --no-deps demucs==4.0.1 julius einops dora-search openunmix lameenc omegaconf antlr4-python3-runtime==4.9.3 treetable retrying submitit cloudpickle pyyaml
```

`tools/song-lib`은 워커가 알아서 찾습니다(`transcribe.py` 옆의 `tools/song-lib`, 또는 저장소의 `tools/song-lib`). 다른 곳에 두었다면 설정 파일에 `"songLib": "D:/.../song-lib"`. 처음 한 번은 분리 모델(약 50 MB)을 받습니다. `--check`가 "song mode: the source separation (demucs) is there"라고 하면 준비 끝입니다. 설치하지 않아도 피아노 변환은 그대로 되고, 일반 곡 변환만 무엇을 설치할지 알려 주며 실패합니다. 2분 37초 곡이 RTX 5070 Ti에서 약 70초 걸렸습니다.

### 더 좋은 모델: YourMT3 (선택)

`tools\home-worker\setup-yourmt3.cmd` 를 더블클릭하면 YourMT3(여러 악기를 한 번에 받아 적는 모델)를 `tools\yourmt3`(코드와 모델, 몇 GB)와 `tools\yourmt3-venv`(전용 Python)에 설치하고, 모델이 불러와지는지 시험해요. 피아노 모델의 Python은 건드리지 않아요. 설치되어 있으면 워커가 알아서 찾아서, 일반 곡을 먼저 YourMT3로 받아 적어요(멜로디는 4초마다 가장 멜로디다운 악기, 베이스는 베이스 악기, 나머지는 반주). YourMT3가 실패하면 예전처럼 음원 분리로 받아 적어요. 결과 화면의 "멜로디 출처"에 `· YourMT3` 가 붙으면 YourMT3가 쓰인 거예요. 지우려면 두 폴더를 지우면 돼요. Git LFS가 필요해요(https://git-lfs.com).

## 문제 해결

| 증상 | 원인/해결 |
| --- | --- |
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

The free PPP server cannot run the strong piano models (TransKun + Kong). This worker runs them **on your own PC** (GPU). **No account and no sign-in are needed**: in **Settings > Connect my PC** the page makes a *PC link* for anybody - a **PC token** (`ppw_...`, for the PC) and a **PC code** (kept by the browser, typed on another device to share the same list). Both are shown once when the link is made; the site keeps only their hashes. The page queues a YouTube link (**High-quality (my PC)** on the Add screen), this script polls the site with the token, downloads the audio from the site's `/api/youtube-audio`, runs `transcribe.py` (the same call as `omr-service.js`), and posts the accepted notes back (no pedal), with the beats and downbeats of `beat_track.py` (Beat This) when the PC has `beat-this` installed (G10a-1d: the page's recording conversion reads them as evidence of where beat 1 is, never as bar lines; `"beats": false` in the settings turns it off; without `beat-this` the notes go alone). The page writes the score from those notes in the browser; **Open** appears in "My conversions".

Setup in 4 steps: (1) the transcription environment from the root README (`tools/transcribe-venv`, Kong checkpoint, `transkun`, ffmpeg); (2) Settings > Connect my PC > **Create my PC link**, copy the PC token (the page shows the exact lines to put on the PC; keep the settings file in your own user folder, e.g. `%USERPROFILE%\.ppp-home-worker\worker.config.json`, not in a synced or shared project folder - or give the token only through the `PPP_WORKER_TOKEN` environment variable); (3) copy `worker.config.example.json` to `worker.config.json` and fill in `siteUrl` and `token`; (4) `node tools/home-worker/worker.js --check`, then `node tools/home-worker/worker.js --once` (or leave `node tools/home-worker/worker.js` running).

- **Keep the code and the token secret.** Anyone with the PC code can queue conversions for your PC and read the results; anyone with the token can take your PC's work. If either leaks: **New PC token** (the old one stops at once) or **Remove link** (the link and its conversions are deleted), then make a new link. A link nobody uses for 60 days, or whose PC never connects and that nobody has used for 14 days, is purged by the site. Tokens from the earlier version of this feature (which needed an account) no longer work: make a new link.
- **Connecting your devices is one tap (G10b-3).** A *pairing link* is `https://<site>/#pc=<the 64-hex PC code>`; opening it on any device pairs that device (the part after `#` is a URL fragment: browsers never send it to a server, and the page removes it from the address bar before doing anything else). **On a PC that already has the worker: double-click `pair.cmd`** (`node tools/home-worker/worker.js --pair`): it copies the link to the clipboard (the `clip` tool, the link on its standard input) and opens it in the PC's browser (`rundll32 url.dll,FileProtocolHandler <link>`, one argument, no shell), then says (Korean first) that it opened the link in the browser and copied the phone link, with the link's name to compare; paste the copied link in a message to yourself and open it on the phone (G10b-4: the browser's link ends in `&local=1`, the phone link does not; the page asks before it replaces a link the device already uses). It needs the PC code once: put the link (or just the code) in `pc-code.txt` next to the settings file, or give `"clientCode"` in the settings (optional; only `--pair` reads it; never logged, never sent to the site). The link is printed only with `--show`. **The link is a master secret like the code**: send it only to yourself; if it leaks, Settings > Connect my PC > More > **Remove link**, then make a new one. In the page: Settings > Connect my PC > **Connect another device: copy link** (and **Share** on a phone); the old buttons are under **More**.
- **Start at once from this PC (G10b-4).** One time only: double-click `register-protocol.cmd` (`node tools/home-worker/worker.js --register-protocol`). It writes three values under `HKEY_CURRENT_USER\Software\Classes\pppworker` (this Windows user only, no administrator rights; `reg.exe` with an argument vector, no shell) so that the link `pppworker://run` runs `wscript.exe //B //Nologo "<this folder>\run-hidden.vbs"`, which starts `run-once-hidden.cmd` (`worker.js --once --log-file`, hidden, no window; the log is `worker.log` next to the settings). Anything after `pppworker://` is thrown away: the registered command has no `%1` and `run-hidden.vbs` never reads an argument, so no web page can pass this PC anything - a page that fires the link only makes the browser ask "Open PPP worker?" and, if you agree, starts one bounded `--once` run that asks the PPP site for the jobs of YOUR link (CPU/GPU time and nothing else). In PPP, Settings > Connect my PC > **Start at once from this PC** (on by itself when this PC was connected with the link `pair.cmd` opens: it ends in `&local=1`; the phone link never does) makes the **High-quality (my PC)** button ask the PC to start right after the job is queued, and says only "Asked this PC to start. If nothing happens, run the desktop shortcut." (a page cannot know whether the link was handled); **Start now** asks again while a job waits. Check: `--protocol-status`. Undo: `unregister-protocol.cmd` (`--unregister-protocol`; it removes only the key this tool made). The scheduled task, the desktop shortcut and this launch can never overlap: `--once` takes a lock (`worker.lock` next to the settings; a second run stops with one line; a dead owner or a lock of 45 minutes or more is taken over).
- **Pairing is confirmed (G10b-4).** `pair.cmd` copies the PHONE link (no `&local=1`) and opens THIS PC's link (with it) in the browser, and prints the link's NAME (`…xxxxxx`, the last 6 hex of the link id, not secret; the same 6 characters are in the page's banner, in its Settings status line and under the Add button). It no longer says "connected": a device that already uses another PC link, and any link that arrives while the page is open, are asked first ("Connect this device to PC link …AAAAAA? It would replace the PC link …BBBBBB ... only if you made the link yourself": Connect / Keep) and nothing is stored before the tap; a device with no link is connected at once with "Disconnect" in the banner.
- `--once`: one check, process everything waiting, exit (exit codes: 0 ok, 1 a failure or the site unreachable, 2 token rejected). Use `run-once.cmd` or the desktop shortcut made by `create-desktop-shortcut.ps1` (run it yourself; nothing is installed for you).
- Waiting is the **site's** call (`nextPollSeconds`: 15 s while something is queued, claimed or just finished, otherwise **an hour** by default, and the site will not go below 15 minutes); `idlePollSeconds` in the settings can only lengthen it. The shorter the idle interval, the longer the free server stays awake (15 minutes or less: all month; 20 minutes: about 77%; an hour: about 26%). Free-tier arithmetic: `docs/GOALS/G10B_HOME_WORKER.md`.
- Limits: the PC must be on with the worker running; latency up to the check interval; only your own link's jobs; YouTube links only; the helper's pedal is not used, and its beats only as evidence of the bar phase; at most 15 minutes of audio; results are kept 3 days.
- Optional `ytdlpPath` downloads the audio with yt-dlp on this PC (the site is the fallback); `audioBase` names another place for `/api/youtube-audio`.

Song mode (G10d, optional): choose **Song (vocals, band)** on the Add screen. The PC separates the song (Demucs htdemucs_6s), leaves the drums out, tracks the sung melody and the bass line (pYIN) and runs the piano ensemble on the rest; every note carries its layer (1 melody, 2 bass, 3 accompaniment) and the lead sheet takes its tune from the melody. Install once: `tools/transcribe-venv/Scripts/python.exe -m pip install --target tools/song-lib --no-deps demucs==4.0.1 julius einops dora-search openunmix lameenc omegaconf antlr4-python3-runtime==4.9.3 treetable retrying submitit cloudpickle pyyaml` (or set `songLib` in the settings). Without it piano conversions work and song conversions fail with a message saying what to install.
