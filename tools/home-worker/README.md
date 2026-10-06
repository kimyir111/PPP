# PPP 홈 PC 워커 (고품질 변환) / PPP home-PC worker

**한국어 먼저, 영어는 아래에 짧게.** (English summary below.)

## 이게 뭔가요

PPP 사이트(무료 서버)는 강력한 피아노 모델(TransKun + Kong)을 직접 돌릴 수 없어요. 대신 **내 PC가 대신 돌립니다.**

1. PPP의 "악보 추가" 화면에서 유튜브 링크를 넣고 **고품질 변환 (내 PC)** 을 누르면, 사이트가 "이 링크를 변환해 줘"라는 요청을 대기열에 적어 둡니다.
2. 내 PC에서 이 워커(`worker.js`)가 사이트에 "할 일 있나요?" 하고 **먼저 물어봅니다**(내 PC로 들어오는 연결은 없어요).
3. 할 일이 있으면 오디오를 받아 PC의 GPU로 변환하고, 들은 음표만 사이트에 돌려줍니다.
4. PPP 화면에서 **열기**를 누르면, 브라우저가 그 음표로 악보를 만들어 보여 줍니다(브라우저 모델의 음표로 만들 때와 같은 방식).

> 한계: PC가 켜져 있고 워커가 돌고 있어야 합니다. 요청한 뒤 PC가 확인하러 올 때까지(기본 약 20분) 기다릴 수 있어요. 바로 시작하려면 아래 바로가기(`run-once.cmd`)를 여세요. 유튜브 링크만 됩니다(파일 업로드는 아직 아님). 도우미의 박자/페달 정보는 쓰지 않아요.

## 5단계 설정

1. **변환 환경 준비** (한 번만). 저장소 루트 `README.md`의 "Making a score from a recording" > Setup을 따라 `tools/transcribe-venv`, Kong 체크포인트(`tools/piano-transcription/*.pth`), `pip install transkun`, ffmpeg를 준비하세요. NVIDIA GPU용 PyTorch(CUDA)가 있으면 훨씬 빨라요(곡 1분에 약 10초). 이 PC에서 이미 `npm run omr`로 변환이 되면 준비 끝입니다.
2. **토큰 만들기.** PPP에 로그인 → **설정 → 내 PC 연결 → 토큰 만들기**. 토큰(`ppw_…`)은 **한 번만** 보여 줍니다. 복사하세요. 잃어버리면 지우고 새로 만드세요.
3. **설정 파일.** `tools/home-worker/worker.config.example.json`을 같은 폴더의 `worker.config.json`으로 복사하고 `siteUrl`(사이트 주소)과 `token`을 채우세요. 파일 경로가 다르면 `pythonPath`, `transcribePy`, `kongCheckpoint`도 고치세요. (`worker.config.json`은 git에 올라가지 않아요.)
4. **점검.** `node tools/home-worker/worker.js --check` — 사이트, 토큰, ffmpeg, Python(torch/transkun), 체크포인트를 확인하고 고칠 것을 알려 줘요. 이 점검이 끝나면 PPP의 악보 추가 화면에 **고품질 변환 (내 PC)** 버튼이 나타나요(워커가 한 번이라도 사이트에 접속한 뒤).
5. **실행.** 아래 둘 중 하나.

## 실행하는 방법

| 방법 | 명령 | 언제 |
| --- | --- | --- |
| **한 번만** (권장) | `node tools/home-worker/worker.js --once` 또는 `run-once.cmd` 더블클릭 | 변환을 요청한 뒤. 대기 중인 걸 모두 처리하고 끝나요. |
| 계속 켜 두기 | `node tools/home-worker/worker.js` 또는 `run-forever.cmd` | PC를 늘 켜 두는 경우. 한가하면 약 20분마다, 일이 있으면 15초마다 확인해요. |

사이트가 알려 주는 대기 시간(`nextPollSeconds`)을 따르며, 설정의 `idlePollSeconds`는 **더 길게만** 바꿀 수 있어요. 멈추려면 Ctrl-C (한 번: 하던 변환을 마치고 끝냄, 두 번: 바로 끝냄).

### 바탕화면 바로가기 / 예약 작업 (직접 실행하세요 — 이 스크립트는 자동으로 설치되지 않습니다)

- 바탕화면 바로가기 만들기: PowerShell에서 `powershell -ExecutionPolicy Bypass -File tools\home-worker\create-desktop-shortcut.ps1` — 바탕화면에 "PPP 고품질 변환 (내 PC)" 바로가기(= `run-once.cmd`)를 만듭니다. 바로가기를 열면 지금 바로 확인하고 처리해요.
- Windows 예약 작업(선택): `tools\home-worker\schedule-task-example.ps1`을 열어 읽고, 원하는 간격을 정한 뒤 직접 실행하세요. 로그인할 때 한 번 + N시간마다 `--once`를 돌리는 작업을 만듭니다. 지우려면 `Unregister-ScheduledTask -TaskName "PPP home worker" -Confirm:$false`.

## 사이트 운영비 0원을 지키는 방법 (왜 20분인가)

무료 Render 서비스는 요청이 오면 15분간 깨어 있고, 월 750시간을 다른 서비스와 나눠 써요. 워커가 1분마다 물어보면 사이트가 24시간 깨어 있게 되어 한도를 다 써 버려요. 그래서 **한가할 땐 길게(기본 20분), 일이 있을 땐 짧게(15초)** 확인합니다. 한가한 확인은 데이터베이스를 건드리지 않고 사이트의 메모리에서 답해요. 숫자와 근거는 `docs/GOALS/G10B_HOME_WORKER.md`에 있어요. **PC를 늘 켜 두고 20분 간격으로 돌리면 한 달 Render 시간의 약 75%를 쓰므로**, 평소엔 `--once` 바로가기를 쓰거나 `idlePollSeconds`를 3600 이상으로 두는 걸 권해요.

## 문제 해결

| 증상 | 원인/해결 |
| --- | --- |
| 버튼이 안 보여요 | 워커가 아직 한 번도 접속하지 않았어요. `--once`를 한 번 실행하세요. |
| `The site does not accept this token` | 토큰을 지웠거나 잘못 붙여넣었어요. 설정에서 새로 만드세요. (워커는 멈춥니다.) |
| `ffmpeg does not run` | ffmpeg를 설치하거나 `ffmpegPath`에 전체 경로를 쓰세요. |
| `Python cannot import torch...` | `pythonPath`가 변환용 venv의 python인지 확인하세요. |
| `The audio could not be downloaded` | 사이트가 유튜브 오디오를 받지 못했어요(차단/일시 오류). 사이트가 몇 분 뒤 최대 3번 다시 시도합니다. 설정에 `ytdlpPath`(yt-dlp.exe)를 쓰면 이 PC에서 직접 받아요. |
| 변환은 됐는데 열기가 안 돼요 | 결과는 3일 뒤 지워집니다. 다시 요청하세요. |

보안: 토큰은 이 PC의 파일(`worker.config.json`) 또는 환경변수 `PPP_WORKER_TOKEN`에만 있고, 로그에는 나오지 않아요. 사이트에는 토큰의 해시만 저장돼요. 이 토큰으로는 **내 계정의 변환 작업만** 가져오고 결과를 올릴 수 있어요. 설정 화면에서 언제든 지울 수 있어요.

---

## English summary

The free PPP server cannot run the strong piano models (TransKun + Kong). This worker runs them **on your own PC** (GPU): the page queues a YouTube link (**High-quality (my PC)** on the Add screen), this script polls the site with a token you made in **Settings > Connect my PC**, downloads the audio from the site's `/api/youtube-audio`, runs `transcribe.py` (the same call as `omr-service.js`), and posts the accepted notes back (no pedal, no beats). The page writes the score from those notes in the browser; **Open** appears in "My conversions".

Setup in 5 steps: (1) the transcription environment from the root README (`tools/transcribe-venv`, Kong checkpoint, `transkun`, ffmpeg); (2) make a token in Settings (shown once); (3) copy `worker.config.example.json` to `worker.config.json` and fill in `siteUrl` and `token`; (4) `node tools/home-worker/worker.js --check`; (5) `node tools/home-worker/worker.js --once` (or leave `node tools/home-worker/worker.js` running).

- `--once`: one check, process everything waiting, exit (exit codes: 0 ok, 1 a failure or the site unreachable, 2 token rejected). Use `run-once.cmd` or the desktop shortcut made by `create-desktop-shortcut.ps1` (run it yourself; nothing is installed for you).
- Waiting is the **site's** call (`nextPollSeconds`: 15 s while something is queued, claimed or just finished, otherwise 20 minutes by default); `idlePollSeconds` in the settings can only lengthen it. Free-tier arithmetic: `docs/GOALS/G10B_HOME_WORKER.md`.
- Limits: the PC must be on with the worker running; latency up to the check interval; only your own PC and your own jobs; YouTube links only; the helper's beats and pedal are not used; at most 15 minutes of audio; results are kept 3 days.
- Optional `ytdlpPath` downloads the audio with yt-dlp on this PC (the site is the fallback); `audioBase` names another place for `/api/youtube-audio`.
