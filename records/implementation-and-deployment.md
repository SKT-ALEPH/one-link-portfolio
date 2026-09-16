## Portfolio Passkey · 구현부터 NAS 배포까지
기준일: 2026-09-14. 공개 포트폴리오와 패스키로 여는 비공개 공간을 함께 구현한 프로젝트다. 현재 운영은 NAS에서 이루어지며, 아래의 구현 설명은 코드, 검사 결과는 저장된 실행 기록과 NAS 이전 기록을 근거로 구분했다.

[운영 사이트](https://portfolio-passkey.duckdns.org/) · [비공개 공간](https://portfolio-passkey.duckdns.org/private) · [검증 안내서](https://portfolio-passkey.duckdns.org/verification.html) · [인증 구현 설명서](https://portfolio-passkey.duckdns.org/submission.html)
[소스 저장소](https://github.com/SKT-ALEPH/one-link-portfolio) — 로컬 Git remote로 확인한 주소다. 저장소의 현재 공개 여부·비로그인 접근은 이번 문서 작업에서 검사하지 않았다.

## 1. 무엇을 만들었나
함께 일할 사람에게 ‘어떻게 배우고 문제를 해결하는지’를 보여주는 한 링크 포트폴리오다. 경험 세 가지를 상황 → 행동 → 결과 → 근거로 설명하고 실행력·분석력·판단력에 연결한다. 공개 콘텐츠에는 KiCad 학습용 PCB, 원리 중심 학습, Flutter 팀 프로젝트에서의 우선순위 판단을 담았다. 이 내용은 페이지의 자기소개 자료이며 이번 작업에서 경력·성과를 별도로 인증한 것은 아니다.

공개 소개에 패스키 전용 비공개 공간을 추가했다. 비공개 메모는 계정별로 구분한 과제용 가상 자료이며, 현재 구현 범위는 메모 조회와 패스키 등록·로그인·추가·삭제·로그아웃이다. 메모 작성·수정 기능이 있는 일반 노트 서비스로 설명하지 않는다.

## 2. 화면과 기술 구성
- 공개 화면: React 19·Vite 8. 소개, 경험 선택, 제작 근거의 세 영역으로 구성한다.
- 움직임: GSAP 3·ScrollTrigger와 CSS Scroll Snap. 경험을 선택하면 같은 자리의 상세 내용이 바뀐다.
- 접근성: 기본 버튼과 키보드 탐색을 사용하고, 움직임 줄이기 설정에서는 큰 애니메이션과 스크롤 스냅을 제거한다.
- 서버: Node.js 24·Express 5. 빌드된 정적 화면과 같은 출처의 API를 함께 제공한다.
- 인증: SimpleWebAuthn 14의 브라우저·서버 라이브러리로 WebAuthn 등록과 서명 검증을 처리한다.
- 저장: Node 내장 SQLite. Docker 볼륨에 DB를 유지한다.
- 운영: Docker Compose·Caddy HTTPS·DuckDNS. 관리 접속에는 Tailscale을 사용한다.

주요 화면은 `/`, `/private`, `/verification.html`, `/submission.html`이다. 초기 정적 소개용 GitHub Pages 구성과 이후 서버 인증이 필요한 NAS 운영을 구분한다. 현재 비공개 API는 GitHub Pages가 아니라 NAS의 Express 서버가 처리한다.

## 3. 패스키 인증은 어떻게 동작하나
### 첫 등록
운영자가 계정을 준비하면 24시간 유효한 일회용 등록 링크를 발급한다. 사용자는 기기 인증 창에서 등록을 완료하고, 서버는 challenge·Origin·RP ID·사용자 확인 결과를 검증한다. 검증 후 credential ID·공개키·서명 카운터·기기 관련 메타데이터를 저장한다. 서버에 패스키 개인키나 지문·얼굴 데이터를 저장하는 구조가 아니다.

첫 등록 링크는 한 번 사용하면 폐기한다. 화면은 URL fragment에서 등록 값을 읽은 뒤 주소창에서 제거하며, 문서에는 실제 등록 링크를 복사하지 않는다.

### 로그인
서버가 2분 유효한 challenge를 발급하고 기기에서 만든 서명을 공개키로 검증한다. 검증한 계정에 1시간 세션을 발급한다. challenge는 브라우저 쿠키와 용도에 묶고 원자적으로 소비해 만료·재사용·다른 브라우저 도용을 거부한다.

### 비공개 자료와 패스키 관리
자료의 소유자는 요청 본문이나 URL의 주장 대신 서버 세션에서 결정한다. 로그인하지 않으면 401, 다른 계정의 자료를 지정하면 403을 반환한다. 추가 등록·삭제에는 10분 이내 로그인 상태를 요구하며, 계정당 최대 10개까지 등록한다. 마지막 패스키 삭제는 막고, 삭제한 패스키에 연결된 세션도 DB 외래키로 제거한다. 별도의 비밀번호 로그인·이메일 복구 경로는 현재 코드에 없다.

## 4. 데이터와 보호 장치
SQLite에는 다음 여섯 표가 있다.
- `users`: 계정.
- `notes`: 계정별 가상 메모.
- `credentials`: 패스키 공개키·카운터·이름·기기 정보.
- `sessions`: 토큰 해시와 계정·패스키 연결, 생성·만료 시각.
- `invitations`: 일회용 등록 토큰 해시와 만료 시각.
- `challenges`: 인증 질문과 브라우저·용도·등록 세션 연결.

외래키, WAL, busy timeout, 트랜잭션을 사용한다. HTTPS 쿠키에는 Secure·HttpOnly·SameSite=Strict와 `__Host-` 접두어를 적용하고, API는 no-store로 제공한다. 변경 요청은 허용 Origin을 검사하며 인증 API에는 요청 횟수 제한을 둔다. Helmet의 보안 헤더와 CSP, JSON 크기 제한도 적용한다.

이는 코드에서 확인한 보호 장치다. 전체 보안 감사나 모든 공격에 대한 안전성 인증을 완료했다는 의미는 아니다.

## 5. 배포 구조
요청 흐름은 다음과 같다.

`방문자 → DuckDNS → 집 공인 IP → 공유기 TCP 80·443 → NAS VM의 공통 Caddy → 127.0.0.1:3000 → Express → SQLite 볼륨`

- 운영 도메인: `portfolio-passkey.duckdns.org`
- VM: Proxmox VM 100, 표시 이름 `web-services`, Ubuntu 호스트 이름 `web-server`
- 할당: 4 vCPU·메모리 4GiB·디스크 64GB
- VM 내부 주소: `192.168.0.22`
- 관리 접속: 기존 Tailscale `nogravybeef@100.75.23.19`
- 배포 폴더: `/home/nogravybeef/portfolio-passkey`
- Compose 프로젝트: `portfolio-passkey`
- 전환 시 공인 IP: `211.194.175.156`
- 데이터: `portfolio_data` 볼륨의 `/data/portfolio.sqlite`
- 인증서: Caddy의 지속 볼륨

앱의 3000번 포트는 루프백에만 바인딩한다. 앱은 node 사용자·읽기 전용 파일시스템·임시 /tmp·cap_drop ALL·no-new-privileges로 실행한다. Caddy가 HTTPS를 받고 앱으로 전달한다.

현재 이 Caddy는 IntraVault와 PlanDoSee의 도메인도 함께 처리한다. 포트폴리오 프록시를 중지하거나 설정을 덮어쓰면 다른 두 서비스에도 영향을 줄 수 있다. 앱 업데이트와 공통 프록시 변경을 구분해야 한다.

## 6. Vultr에서 NAS로 옮긴 과정
2026-09-14 이전 기록을 기준으로 정리했다.

1. 원본 Vultr의 운영 소스, SQLite DB, Caddy 인증서 데이터를 백업했다.
2. NAS의 VM·Tailscale 관리 경로·Docker 환경과 공유기 웹 포트 전달을 준비했다.
3. 파일 전송 전후 SHA-256을 대조하고 NAS에서 앱과 DB를 복원했다.
4. SQLite integrity_check·foreign_key_check를 확인했다. 소유자 계정 1·등록 패스키 0·가상 메모 3개가 복원됐다.
5. 세션·challenge·미사용 초대 링크는 초기화했다. 기존 등록 링크는 폐기됐으며 새 첫 등록 링크가 필요하다.
6. NAS 공인 IP로 도메인 인증서 검증을 유지한 HTTPS 접속을 확인한 뒤 DuckDNS A를 전환했다.
7. 일반 도메인의 health 정상·미인증 비공개 API 401과 공개 화면을 확인했다.
8. 이전 Vultr `158.247.218.254`의 앱과 Caddy를 중지했다. 인스턴스 삭제는 하지 않았다.

복원 중 root 사용자로 볼륨을 풀던 초기 안내가 앱의 cap_drop ALL 구성과 충돌했다. 실제 복원은 UID/GID 1000:1000과 `tar --no-same-owner`를 사용했고, 앱의 기존 보호 설정을 완화하지 않았다.

원본 백업은 Vultr의 `/home/linuxuser/nas-migration-20260914`, NAS 사본은 `/home/nogravybeef/portfolio-data.tar.gz`와 `caddy-data.tar.gz`에 보관했다. NAS 백업 파일 권한은 이전 기록상 600이다. 이 사본 보관을 외부 정기 백업 체계 완성으로 보지는 않는다.

## 7. 무엇을 검증했나
### 공개 화면 · 저장된 검사 기록
1366×768·1920×1080에서 문서와 주요 영역의 가로 넘침 0건을 기록했다. 실제 콘텐츠 반영 후 모바일 검사도 수행했다는 기록이 있다. 경험 버튼의 마우스·Tab·Enter·Space 동작과 움직임 줄이기를 확인했다.

결함 기록에는 장식 배경의 넘침, Vite 경로 설정 경고, pnpm 잠금 파일과 배포 명령의 불일치, 상호작용 증거 화면의 촬영 위치 오류 등 네 가지가 남아 있다. 배포 명령 불일치는 실패 가능성을 수정한 것이며 실제 운영 장애가 발생했다고 확대하지 않는다.

### 패스키 · 2026-09-10 기록
로컬 검사는 메모리에서 생성한 P-256 서명을 사용했다. 등록·로그인 성공뿐 아니라 타인 자료 403, 초대 없는 등록 거부, 잘못된 서명·Origin 거부, challenge 만료·재사용·동시 재사용 거부, 로그아웃 세션 재사용 거부, 삭제한 키 거부, 마지막 키 삭제 차단을 기록했다.

운영 HTTPS에서도 Chromium의 가상 CTAP2 인증기로 두 계정 등록, 한 계정의 패스키 두 개, 상호 접근 차단, 로그아웃·남은 키 로그인·삭제한 키 거부 등을 검사한 passed 기록이 있다. 이는 물리 기기나 Google Password Manager 실사용 검증과 다르다.

### NAS 이전 · 2026-09-14 기록
파일 해시·DB 무결성·복원 수량·HTTPS·health·비인증 접근 차단·공개 화면을 확인했다. 오늘 같은 작업 흐름의 최종 외부 점검에서도 공개 주소 200을 확인했다. 등록 패스키가 0개였으므로 NAS에서 실제 사용자 패스키 로그인 성공을 확인한 것은 아니다.

## 8. 운영 방법과 남은 일
상태를 볼 때:
```bash
cd /home/nogravybeef/portfolio-passkey
sudo docker compose ps
```

화면·서버 코드를 업데이트할 때는 먼저 DB와 설정을 백업하고, 공통 Caddy 변경이 없다면 앱을 대상으로 빌드·재기동한다.
```bash
sudo docker compose up -d --build app
```
이는 후속 운영 명령 안내이며 이번 문서 작업에서 다시 배포하지 않았다. 데이터 볼륨을 삭제하는 `docker compose down -v`를 업데이트 절차로 사용하지 않는다. NAS에서 새 데이터가 생긴 뒤에는 예전 Vultr DB를 그대로 재가동하지 않는다.

남은 항목:
- 소유자용 새 일회용 등록 링크 발급과 실제 기기 패스키 등록·로그인.
- 실제 기기에서 추가 키 등록·분실 대비·삭제 흐름 확인.
- 집 공인 IP 변경에 대비한 DuckDNS 자동 갱신.
- VM 재부팅 후 서비스 자동 복구 검사.
- 외부 정기 백업과 복원 훈련.
- 보존 자료를 확인한 뒤 Vultr 인스턴스 정리. 현재 인스턴스 삭제·과금 종료는 미실행.

## 9. 직접 판단과 AI 지원
기존 `records/ai-use.md`에 남긴 구분을 따른다.
- 사용자 판단: 대상과 공개 범위, 강점과 근거, React·Vite·GSAP 및 풀페이지 표현, 초기 GitHub Pages 방식 선택.
- AI 지원: 구조와 문장 초안, 화면·서버 구현, 검사와 배포·이전·문서 정리.
- 채택하지 않은 초기 제안: 정적 HTML과 단순 CSS만 사용하는 안 대신 React·GSAP 구성을 선택했다는 기록.

구현·자동 검증·본인의 실제 기기 조작을 구분한다. 수행하지 않은 사용자 행동이나 이해 수준을 이 문서에서 만들어 쓰지 않는다.

## 10. 근거 파일
로컬 프로젝트: `D:/workspace/one-link-portfolio`
- 공개 화면: `src/App.jsx`, `src/data/content.js`, `src/styles.css`
- 비공개 화면: `src/PrivatePage.jsx`
- API·인증: `server/app.mjs`
- DB·가상 자료·초기 계정: `server/store.mjs`, `server/admin.mjs`
- 배포: `Dockerfile`, `compose.yaml`, `deploy/Caddyfile`
- 공개 화면 검사: `records/viewport-test.md`, `interaction-test.md`, `defects.md`
- 인증 증거: `records/passkey-evidence.json`, `records/live-passkey-evidence.json`
- 이전 결과: `deploy/NAS-STATUS-2026-09-14.md`
- AI 사용 구분: `records/ai-use.md`

코드·기존 실행 기록을 바탕으로 작성했고, 문서 작성만을 위해 운영 데이터 변경·패스키 생성·새 배포를 수행하지 않았다.
