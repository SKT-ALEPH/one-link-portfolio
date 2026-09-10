# Vultr → NAS 이전

대상은 Docker Compose와 Linux 컨테이너를 지원하고 외부 HTTPS 접속이 가능한 NAS입니다. NAS 모델·CPU·포트 사용 현황은 아직 확인되지 않았습니다. CPU가 ARM이면 이미지를 NAS에서 다시 빌드합니다. 현재 Caddy는 Linux 호스트 네트워크의 80/443을 사용하므로 NAS 관리 화면이나 기존 프록시와 충돌하면 그 프록시에 도메인을 연결하도록 변경해야 합니다.

1. `portfolio-passkey.duckdns.org`와 `APP_ORIGIN`/RP ID를 유지합니다. 다른 도메인에서 등록한 패스키는 그대로 이전되지 않습니다.
2. 쓰기 중인 SQLite 파일 하나만 복사하지 않습니다. Vultr에서 `docker compose stop app`으로 앱을 정지하고 `portfolio_data` 볼륨 전체를 백업합니다. 이때 기존 컨테이너/볼륨은 삭제하지 않습니다.
3. 같은 소스와 Compose 설정을 NAS로 복사하고 백업한 데이터를 새 `portfolio_data` 볼륨에 복원합니다. 데이터 소유자는 컨테이너의 `node` 사용자(UID 1000)가 읽고 쓸 수 있어야 합니다. DB는 NAS의 로컬 디스크 볼륨에 두고 SMB/NFS 공유를 SQLite 작업 디렉터리로 사용하지 않습니다.
4. `sessions`, `challenges`를 비워 이전 세션·진행 중 인증을 종료합니다. `users`, `credentials`, `notes`는 보존합니다.
5. NAS의 외부 80/443 연결과 Caddy 인증서 발급 조건을 확인한 뒤 DuckDNS A 레코드를 NAS 외부 IP로 바꿉니다. 이동통신/통신사 NAT 등으로 인바운드 연결이 불가능한 경우 이 단계 전에 별도 연결 방식을 결정해야 합니다.
6. 기존 패스키 로그인, 미인증 401, 다른 계정 403, 로그아웃 후 같은 세션 거절을 확인합니다. DNS 전파 중 두 서버에 동시에 쓰지 않도록 Vultr 앱은 정지 상태로 둡니다.
7. 확인이 끝나기 전에는 Vultr의 마지막 백업을 삭제하지 않습니다. 실패 시 DNS를 Vultr로 복구하고 기존 앱을 다시 실행합니다.

## 관리 명령

프로젝트 디렉터리에서 `sudo docker compose exec -T app node server/admin.mjs list`로 계정별 등록 수를 확인합니다.

처음 등록할 계정은 `sudo docker compose exec -T app node server/admin.mjs provision '소유자' owner`로 준비합니다. 출력은 24시간 동안 유효한 일회용 등록 링크이므로 공개 저장소나 제출물에 붙이지 않습니다. 등록 링크가 만료됐지만 패스키가 아직 없다면 `invite USER_ID`로 재발급합니다. 패스키가 있는 계정은 기존 패스키로 로그인하여 추가해야 합니다.

등록되지 않은 공개 방문자에게 첫 계정을 허용하는 기능은 없습니다. 웹의 비밀번호·이메일 복구 기능도 없습니다.
