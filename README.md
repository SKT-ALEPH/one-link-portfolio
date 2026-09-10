# One Link Portfolio

경험 1·2·3과 강점 1·2·3을 상황·행동·결과·공개 근거로 연결하는 React 포트폴리오입니다.

기존 공개 소개에 과제 8의 패스키 전용 비공개 공간을 추가했습니다. 비공개 메모는 모두 과제용 가상 내용입니다.

## 소유자 패스키 등록

[첫 패스키 등록하기](https://portfolio-passkey.duckdns.org/private#enroll=0rcz00Pxj2OxJ68OQd7rN9cb6vCpg1sRYs79cr_5EE8)

이 링크는 비공개 저장소의 소유자용 일회용 링크이며, 발급 후 24시간 동안 유효합니다. 링크를 열고 패스키 이름을 입력한 뒤 등록 버튼을 눌러 기기의 지문·얼굴·PIN 인증을 완료하세요.

첫 등록이 끝나면 이 링크는 다시 사용할 수 없습니다. 이후에는 [비공개 공간](https://portfolio-passkey.duckdns.org/private)에서 로그인하고 두 번째 패스키를 추가하세요. 저장소를 공개하기 전에는 이 등록 링크를 삭제하세요.

## 기술

- React + Vite
- GSAP ScrollTrigger
- CSS Scroll Snap
- GitHub Pages
- Node.js 24 + Express + SimpleWebAuthn 14 + SQLite
- Vultr / NAS: Docker Compose + Caddy HTTPS

## 페이지

- `index.html`: 포트폴리오
- `verification.html`: 검증 안내서와 제출 기록
- `/private`: 패스키 등록·로그인·메모·패스키 관리
- `/submission.html`: 인증 구현 설명서 여섯 항목과 제출 체크리스트

## 실행

Node.js 24에서 `pnpm install --frozen-lockfile` 후, 서버는 `pnpm start`, 개발 화면은 별도 터미널에서 `pnpm dev`로 실행합니다. 개발 브라우저 주소는 `http://localhost:5173`입니다. 기본 `APP_ORIGIN`과 일치해야 합니다.

`pnpm build` 후 `pnpm test:auth`로 실제 서명을 사용하는 서버 인증 검사를 실행합니다. `pnpm test`는 공개 화면 및 패스키 취소 안내의 브라우저 검사입니다. 필요한 경우 `ONE_LINK_BROWSER_PATH`로 Chromium 실행 파일을 지정합니다.

최초 계정은 `pnpm admin provision '소유자' owner`로 준비합니다. 반환된 링크는 공개하지 않습니다. 로그인한 뒤에만 다른 패스키를 추가할 수 있습니다.

## 배포

결과물: https://portfolio-passkey.duckdns.org/

`docker compose up -d --build`로 Caddy와 앱을 시작합니다. 앱은 호스트의 127.0.0.1:3000에만 노출되고 외부 요청은 HTTPS 프록시를 거칩니다. 데이터는 `portfolio_data` 볼륨에 보관됩니다. `docker compose down -v`는 데이터를 삭제하므로 이전이나 업데이트에 사용하지 않습니다.

인증 코드는 `server/app.mjs`, DB와 초기 가상 자료는 `server/store.mjs`, 관리 명령은 `server/admin.mjs`, 화면은 `src/PrivatePage.jsx`에 있습니다. 요청·응답 증거는 `records/passkey-evidence.json`에 있습니다. 실제 기기 실기 확인은 자동 검사와 구분해 제출문에 기록했습니다.

NAS 이전 절차: [deploy/NAS-MIGRATION.md](deploy/NAS-MIGRATION.md)

