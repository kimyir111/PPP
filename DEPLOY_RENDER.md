# PPP Render 배포

DuckScope와 같이 결제수단 없이 Singapore 리전에 올립니다.

- `ppp-web`: 무료 Node 웹 서비스 (앱 + 로그인 API)

공개 주소: https://ppp-web-2o99.onrender.com

무료 Postgres는 워크스페이스에 하나뿐이라, `ppp-web`의 `DATABASE_URL`은 DuckScope와 같은 `duckscope-db`를 가리킵니다. PPP 테이블(`ppp_users`, `ppp_progress`, `ppp_shares`)은 모두 `ppp_`로 시작해서 DuckScope 테이블과 겹치지 않습니다. 계정, 진행 상황, 공유 악보가 여기에 남습니다.

**무료 DB는 만든 지 30일 뒤 만료됩니다.** `duckscope-db`의 만료일은 2026-09-26입니다. 그 전에 유료 플랜으로 올리거나 다른 Postgres로 옮기지 않으면 DuckScope와 PPP 데이터가 함께 사라집니다.

로컬 서버(`npm start`)는 `data/*.json`에 따로 저장하므로, 로컬에서 만든 계정과 공유 악보는 Render에 나타나지 않습니다. DB는 외부 접속을 막아 두었습니다(IP 허용 목록 비어 있음).

OMR(Audiveris)은 로컬 전용입니다. 온라인에서는 MusicXML 가져오기와 연습·암보·로그인이 동작합니다.

## 1. GitHub에 올리기

저장소 루트는 `D:\PPP`입니다. `.env`와 `data/*.json`은 커밋하지 마세요.

## 2. Blueprint 배포

1. Render Dashboard에서 GitHub 계정을 연결합니다.
2. **New > Blueprint**를 선택합니다.
3. PPP 저장소와 브랜치를 선택합니다.
4. Blueprint 경로는 `render.yaml`입니다.
5. 리소스가 `Free`인지 확인한 뒤 **Deploy Blueprint**를 실행합니다.

`SESSION_SECRET`은 Render가 생성합니다. 무료 웹 서비스는 15분 동안 요청이 없으면 잠들 수 있습니다.

## 3. 첫 로그인

`ppp-web` URL을 열고 **Create account**로 가입하거나 **Continue as guest**로 바로 연습합니다. 로그인하면 진행 상황이 계정에 저장됩니다.

언어는 헤더의 국기 버튼으로 고릅니다. 지원: 한국어, 日本語, English, 简体中文.
