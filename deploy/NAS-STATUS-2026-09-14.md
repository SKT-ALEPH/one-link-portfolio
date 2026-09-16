# NAS 이전 실행 결과 — 2026-09-14

- 공개 주소: https://portfolio-passkey.duckdns.org/
- 실행 서버: Proxmox VM 100 `web-services`, Ubuntu 호스트 `web-server`
- VM: 4 vCPU, RAM 4 GiB, 디스크 64 GB, nvme-2tb
- 관리 접속: `nogravybeef@100.75.23.19` (Tailscale)
- 내부 IP: 192.168.0.22, MAC BC:24:11:72:D5:FF
- 앱 경로: `/home/nogravybeef/portfolio-passkey`
- Compose 프로젝트: `portfolio-passkey`
- 집 공인 IP / 전환한 DNS A: 211.194.175.156
- 공유기: TCP 80 → VM:80, TCP 443 → VM:443

## 검증한 결과

운영 소스와 DB·인증서 압축 파일의 SHA-256이 전송 전후 일치했다.
DB integrity_check 및 foreign_key_check를 통과했다.
소유자 계정 1개, 등록 패스키 0개, 메모 3개가 복원됐다.
NAS의 sessions, challenges, invitations를 비웠다. 기존 미사용 등록 링크는 폐기됐다.
외부 Vultr에서 NAS 공인 IP로 원래 도메인의 TLS 검증을 포함한 요청이 성공했다.
DNS 전환 후 일반 도메인 /api/health는 정상이며, 미인증 /api/private는 401이다.
브라우저에서 공개 소개 페이지가 열렸다.

Vultr 158.247.218.254의 앱과 Caddy는 정지 상태를 확인했다. 서버는 삭제하지 않았다.
Vultr 원본과 `/home/linuxuser/nas-migration-20260914` 백업은 보존했다.
NAS 백업은 `/home/nogravybeef/portfolio-data.tar.gz`, `caddy-data.tar.gz`에 보관되며 권한은 600이다.

## 남은 운영 사항

- 집 공인 IP 변경에 대비한 DuckDNS 자동 갱신은 아직 구성하지 않았다.
- VM 재부팅 후 서비스 복구 검사는 아직 하지 않았다.
- 등록 패스키가 원래 0개였으므로 실제 패스키 로그인은 검증하지 못했다. 기존 소유자 계정용 새 등록 링크가 필요하다.
- Vultr 삭제 및 과금 종료는 실행하지 않았다.
- DNS 전환 뒤 NAS에서 데이터가 변경되었다면 예전 Vultr DB를 그대로 재가동하지 않는다.

## 복원 절차 수정 사항

기존 안내서의 root 계정 앱 볼륨 복원은 앱의 cap_drop ALL 설정과 충돌했다.
실제 복원에서는 앱 사용자 UID/GID 1000:1000으로 `tar --no-same-owner`를 실행했다.
기존 앱 보안 설정을 완화하지 않았다.
