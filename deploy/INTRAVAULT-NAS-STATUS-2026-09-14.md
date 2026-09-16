# IntraVault NAS 전환 결과

2026-09-14 실행 완료. URL: https://intravault.duckdns.org/

## 실행 구성

- NAS: Proxmox VM 100, web-server, Tailscale 100.75.23.19
- 프로젝트: `/home/nogravybeef/intravault`
- 명령: `docker compose -f compose.production.yaml -f compose.nas.yaml`
- Compose 프로젝트: intravault-prod
- 독립 app, db, gateway 및 database/files/runtime/logs 볼륨
- gateway: 호스트 loopback 18081. 외부 인증 htpasswd 유지.
- 공용 Caddy: portfolio-passkey 스택. 이 저장소의 deploy/Caddyfile에 두 도메인 등록.
- 외부 IP 및 두 도메인의 DNS A: 211.194.175.156
- IntraVault 네트워크: 172.30.91.0/28, 172.30.92.0/28
- NAS override의 TRUSTED_PROXIES: 172.30.91.3,172.30.92.1

## 데이터와 검증

운영 서버에서 백업한 소스로 NAS에서 이미지를 빌드했다. 로컬 개발 버전으로 업데이트하지 않았다.
최종 백업: migration-20260914T015559Z. 묶음 SHA-256:
`4022244f7351f80012e1c0ab227e2e5372fd495f3f5c21fe7a312fa67dfa7f1e`

최종 백업의 모든 SHA256SUMS 검증을 통과했다. 사전 복원 이후 소스·환경·외부 인증·업로드 파일 묶음이 동일함을 cmp로 확인하고 DB를 최종본으로 동기화했다.
계정 13개, 문서 25개, Lab enabled switches 0. APP_KEY와 계정 암호 및 외부 인증을 보존했다.
외부 인증 없는 로그인 페이지는 HTTPS 401, 기존 외부 인증으로 200이다.
DNS 전환 뒤 기존 관리자 로그인 302, 관리자 화면 200, 문서 목록 200을 확인했다.
포트폴리오 /api/health도 정상 응답했다.
실제 문서 다운로드·새 업로드·VM 재부팅 검사는 이번 전환에서 수행하지 않았다.

## 기존 서버 및 백업

158.247.254.98의 IntraVault app/db/gateway/caddy 모두 Exited(0)를 확인했다.
기존 서버·볼륨을 삭제하지 않았다. 과금 종료는 별도다.
원본 백업: `/opt/intravault/backups/migration-20260914T015559Z`
NAS 백업: `/home/nogravybeef/intravault-backup/migration-20260914T015559Z`
백업에는 비밀값이 있으므로 공개 저장소에 넣지 않는다.

NAS에서 사용을 시작한 이후 예전 Vultr DB를 그대로 재가동하지 않는다. 되돌릴 때 최신 NAS 데이터를 먼저 보존하고 동기화한다.
집 IP 변경에 대비한 DuckDNS 자동 갱신은 아직 설정하지 않았다.
