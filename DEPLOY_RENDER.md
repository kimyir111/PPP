# PPP Render 배포

DuckScope와 같이 결제수단 없이 Singapore 리전에 올립니다.

- `ppp-web`: 무료 Node 웹 서비스 (앱 + 로그인 API)

공개 주소: https://ppp-web-2o99.onrender.com

이 워크스페이스에는 이미 무료 Postgres(`duckscope-db`)가 있어서 PPP는 파일 저장소를 씁니다. 인스턴스가 잠들거나 재시작되면 계정 데이터는 초기화됩니다. 장기 계정은 `DATABASE_URL`에 Postgres를 연결하세요.

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
