# 패스키 소개 페이지: Vultr → NAS 이전 안내

작성 기준: 2026-09-10 배포 구성. 이 문서는 **나중에 실행할 절차**이며, 문서 작성 중 서비스 중지·DNS 변경·NAS 이전을 실행하지 않았습니다. NAS 모델과 네트워크 환경은 아직 미확인입니다.

## 1. 이전의 핵심

**도메인과 계정·공개키 DB는 유지하고 실행 장소만 바꿉니다.**

| 항목 | 현재 값 / 이전 원칙 |
| --- | --- |
| 공개 주소 | `https://portfolio-passkey.duckdns.org/` |
| 비공개 공간 | `https://portfolio-passkey.duckdns.org/private` |
| RP ID | `portfolio-passkey.duckdns.org` — 유지 |
| APP_ORIGIN | `https://portfolio-passkey.duckdns.org` — 유지 |
| Vultr IPv4 | `158.247.218.254` — 실패 시 복귀 주소 |
| Vultr 작업 폴더 | `/opt/portfolio-passkey` |
| Compose 프로젝트 | `portfolio-passkey` — 명령에서 `-p`로 고정 |
| 앱 데이터 볼륨 | `portfolio-passkey_portfolio_data` |
| DB 파일 | 컨테이너 안 `/data/portfolio.sqlite` |
| HTTPS 인증서 볼륨 | `portfolio-passkey_caddy_data` |
| 소스 | <https://github.com/SKT-ALEPH/one-link-portfolio> |

DB의 `users`, `credentials`, `notes`를 보존합니다. 패스키 개인키는 사용자 기기나 비밀번호 관리자에 있으므로 서버에서 복사하지 않습니다. 같은 RP ID와 계정·공개키를 유지하면 IP 변경만으로 패스키를 다시 등록할 필요는 없습니다. [RP ID와 Origin 검증](https://simplewebauthn.dev/docs/packages/server)

NAS에서는 `sessions`, `challenges`, `invitations`를 비워 기존 로그인·진행 중 인증·미사용 등록 링크를 폐기합니다. 이미 등록된 패스키는 보존됩니다.

`caddy_data`에는 **HTTPS 인증서의 개인키**가 있습니다. 사용자 패스키 개인키와는 별개입니다. DB·인증서·환경 설정 백업은 공개 GitHub나 사이트의 `public/`에 넣지 않습니다. `caddy_config`는 소스의 `deploy/Caddyfile`로 재구성할 수 있어 필수 이전 대상이 아닙니다.

## 2. NAS가 정해지면 먼저 확인

| 항목 | 필요한 조건 |
| --- | --- |
| 모델·운영체제 | Linux 컨테이너와 Docker Compose 지원 |
| CPU | x86_64 또는 사용할 이미지가 지원하는 ARM64. 다른 CPU는 별도 검토 |
| 저장 위치 | NAS 로컬 디스크의 Docker 볼륨. 실행 DB를 SMB/NFS 원격 공유 위에 두지 않음 |
| NAS 내부 IP | 공유기에서 DHCP 예약 또는 고정 할당 |
| 외부 연결 | 공인 IPv4와 공유기의 TCP 80/443 포트 전달 가능 여부 |
| 포트 충돌 | 기존 NAS 관리 화면·프록시가 80/443을 사용 중인지 |

CPU가 다르면 Vultr의 실행 이미지를 그대로 옮기지 않고 **NAS에서 같은 소스를 빌드**합니다. CGNAT·이중 NAT 등으로 외부 접속이 안 되는 환경이면 포트 전달 전에 연결 방식을 먼저 결정해야 합니다.

### HTTPS 구성 선택

- **A — 80/443을 사이트에 배정 가능:** 아래 기본 명령을 사용합니다. 현재 Caddy는 Linux 호스트 네트워크를 사용합니다.
- **B — 기존 NAS 프록시가 80/443 사용:** 기존 서비스를 종료하지 않습니다. 앱만 `docker compose -p portfolio-passkey up -d app`으로 실행하고 기존 프록시에서 같은 도메인을 연결하도록 구성합니다. NAS 호스트의 프록시라면 대상은 `http://127.0.0.1:3000`입니다. 다른 컨테이너의 프록시라면 그 컨테이너의 `127.0.0.1`은 NAS 호스트가 아니므로 네트워크를 별도로 설정해야 합니다.

아래 Caddy 복원·기동 명령은 **A 구성 기준**입니다. B는 NAS가 정해지면 TLS 인증서와 전달 헤더를 함께 확정합니다. 앱의 `trust proxy`는 현재 한 단계이므로 여러 프록시를 연결할 때 함께 검토합니다. [Docker 호스트 네트워크](https://docs.docker.com/engine/network/drivers/host/), [Caddy HTTPS 조건](https://caddyserver.com/docs/automatic-https)

## 3. Vultr 백업

### 3-1. 접속과 원본 확인

현재 Windows 컴퓨터의 PowerShell에서:

```powershell
ssh -i D:/workspace/one-link-portfolio/.deploy-runtime/vultr_admin linuxuser@158.247.218.254
```

배포 키는 이 컴퓨터의 비공개 파일입니다. 다른 컴퓨터에서 작업하면 별도로 SSH 접근 권한을 준비합니다. 과거 초기 비밀번호는 교체했고 SSH 비밀번호 로그인은 해제했습니다.

접속 후 **Vultr Linux 셸**에서 실행합니다. 3장은 같은 셸에서 이어 실행합니다.

```bash
cd /opt/portfolio-passkey
sudo docker compose -p portfolio-passkey ps
sudo docker volume inspect portfolio-passkey_portfolio_data
sudo docker volume inspect portfolio-passkey_caddy_data

umask 077
migration_backup="$HOME/portfolio-migration-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$migration_backup"
sudo docker compose -p portfolio-passkey exec -T app node server/admin.mjs list > "$migration_backup/accounts-before.json"
sudo docker compose -p portfolio-passkey images > "$migration_backup/images-before.txt"
```

앱이 `healthy`이고 두 볼륨이 실제로 있어야 합니다. 계정별 패스키 수는 `accounts-before.json`에 기록됩니다. 볼륨이 없으면 이름부터 확인합니다. 새 빈 볼륨을 원본으로 착각하면 안 됩니다.

### 3-2. 소스 저장

```bash
tar -czf "$migration_backup/source.tar.gz" \
  Dockerfile compose.yaml .dockerignore .gitattributes \
  package.json pnpm-lock.yaml index.html verification.html vite.config.js \
  README.md src server public deploy scripts tests records
if test -f .env; then
  cp .env "$migration_backup/runtime.env"
fi
```

운영 중이던 소스와 잠금 파일을 사용하며 이전과 버전 업그레이드를 동시에 하지 않습니다. 중단 시간을 줄이려면 이 소스를 먼저 NAS로 복사하여 5-1의 빌드를 마친 뒤 DB 백업으로 넘어갑니다. 그때까지 Vultr는 계속 실행 중이어도 됩니다.

### 3-3. 정지 후 DB·인증서 백업

**여기부터 서비스가 잠시 중단됩니다.** 실제 이전할 때 중단 시간을 정합니다. 각 명령이 성공한 뒤 다음으로 진행합니다.

```bash
sudo docker compose -p portfolio-passkey stop app caddy

sudo docker compose -p portfolio-passkey run --rm --no-deps -T \
  --entrypoint tar app -C /data -czf - . \
  > "$migration_backup/portfolio-data.tar.gz"

sudo docker compose -p portfolio-passkey run --rm --no-deps -T \
  --entrypoint tar caddy -C /data -czf - . \
  > "$migration_backup/caddy-data.tar.gz"

tar -tzf "$migration_backup/portfolio-data.tar.gz"
tar -tzf "$migration_backup/caddy-data.tar.gz"
cd "$migration_backup"
sha256sum source.tar.gz portfolio-data.tar.gz caddy-data.tar.gz > SHA256SUMS
printf '백업 위치: %s\n' "$migration_backup"
```

DB 묶음에 `portfolio.sqlite`가 있어야 합니다. `-wal`, `-shm` 파일이 있다면 함께 보관합니다. 쓰기 중인 DB 파일 하나만 복사하지 않습니다. 임시 컨테이너는 앱 대신 `tar`만 실행하며 `--rm`은 임시 컨테이너를 제거할 뿐 이름 있는 원본 볼륨을 삭제하지 않습니다. [Docker 볼륨 백업·복원](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes)

백업 후 **Vultr 앱은 중지 상태로 둡니다.** 두 서버에 동시에 쓰는 상황을 피하기 위해서입니다. 이전·업데이트에는 `docker compose down -v`나 볼륨 삭제·정리 명령을 사용하지 않습니다.

## 4. NAS로 파일 전달

Windows PowerShell에서 실제 백업 폴더 이름으로 바꿉니다. `YYYYMMDDTHHMMSSZ`, `NAS_USER`, `NAS_LAN_IP`, `/NAS_PRIVATE_BACKUP_DIR/`는 자리표시자입니다.

```powershell
scp -i D:/workspace/one-link-portfolio/.deploy-runtime/vultr_admin -r linuxuser@158.247.218.254:/home/linuxuser/portfolio-migration-YYYYMMDDTHHMMSSZ .
scp -r .\portfolio-migration-YYYYMMDDTHHMMSSZ NAS_USER@NAS_LAN_IP:/NAS_PRIVATE_BACKUP_DIR/
```

SFTP나 NAS 파일 관리자로 비공개 폴더에 옮겨도 됩니다. 백업 파일 전송에는 네트워크 공유를 사용할 수 있지만 **실행할 DB는 NAS의 로컬 Docker 볼륨에 복원**합니다.

NAS Linux 셸에서 복사한 폴더로 이동합니다.

```bash
cd /실제/NAS/비공개/백업/폴더
sha256sum -c SHA256SUMS
```

세 파일이 모두 `OK`여야 합니다. 다르면 DNS를 바꾸기 전에 전송을 확인합니다.

## 5. NAS 복원

### 5-1. 소스와 이미지

아래 경로를 실제 값으로 바꿉니다. 앱 폴더는 **아직 존재하지 않는 새 폴더**이며 상위 디렉터리는 미리 준비합니다. 5장은 같은 NAS 셸에서 진행합니다.

```bash
migration_source='/실제/NAS/앱/경로/portfolio-passkey'
migration_backup='/실제/NAS/비공개/백업/폴더'
umask 077
mkdir "$migration_source"
tar -xzf "$migration_backup/source.tar.gz" -C "$migration_source"
cd "$migration_source"
if test -f "$migration_backup/runtime.env"; then
  cp "$migration_backup/runtime.env" .env
fi
sudo docker compose -p portfolio-passkey config --quiet
sudo docker compose -p portfolio-passkey build app
sudo docker compose -p portfolio-passkey pull caddy
```

이미 소스를 풀고 빌드했다면 그 폴더를 사용하고 중복 실행하지 않습니다. `mkdir`에서 기존 폴더가 있다고 나오면 내용을 확인하고 멈춥니다. `DOMAIN`을 설정했다면 원래 도메인인지 확인합니다. 아직 `up`으로 앱을 시작하지 않습니다. 복원 전에 기동하면 빈 DB가 먼저 생성됩니다.

### 5-2. 빈 볼륨에만 복원

```bash
sudo docker compose -p portfolio-passkey run --rm --no-deps -T \
  --user 0 --entrypoint sh app -c \
  'test -z "$(ls -A /data)" || { echo "STOP: app data volume is not empty" >&2; exit 1; }; tar -xzf - -C /data && chown -R 1000:1000 /data' \
  < "$migration_backup/portfolio-data.tar.gz"

sudo docker compose -p portfolio-passkey run --rm --no-deps -T \
  --user 0 --entrypoint sh caddy -c \
  'test -z "$(find /data -mindepth 1 ! -type d -print -quit)" || { echo "STOP: Caddy data volume contains files" >&2; exit 1; }; tar -xzf - -C /data' \
  < "$migration_backup/caddy-data.tar.gz"
```

`STOP`이 나오면 중단합니다. 기존 자료를 지워 우회하지 않습니다. 같은 프로젝트 이름의 다른 볼륨이나 이전 복원 결과인지 확인해야 합니다. Caddy 이미지가 만드는 빈 기본 디렉터리는 허용하지만 기존 파일은 덮어쓰지 않습니다. UID/GID 1000은 현재 Dockerfile의 `node` 사용자입니다.

### 5-3. 무결성 확인과 이전 세션 폐기

```bash
sudo docker compose -p portfolio-passkey run --rm --no-deps -T \
  --entrypoint node app --input-type=module - <<'NODE'
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
if (!existsSync('/data/portfolio.sqlite')) throw new Error('Missing restored database');
const db = new DatabaseSync('/data/portfolio.sqlite');
const integrity = db.prepare('PRAGMA integrity_check').all();
if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Database integrity check failed');
if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key check failed');
db.exec('BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM challenges; DELETE FROM invitations; COMMIT;');
console.log(JSON.stringify(db.prepare('SELECT u.id,u.name,COUNT(c.id) AS passkeys FROM users u LEFT JOIN credentials c ON c.user_id=u.id GROUP BY u.id').all()));
db.close();
NODE
```

출력 계정과 패스키 수가 `accounts-before.json`과 일치해야 합니다. 오류가 나면 기동하지 않습니다. 미사용 등록 링크도 폐기되므로 패스키가 아직 없는 기존 계정은 9장에서 재발급합니다. 기존 계정을 `provision`으로 다시 만들지 않습니다.

### 5-4. DNS 변경 전 기동 확인

```bash
sudo docker compose -p portfolio-passkey up -d
sudo docker compose -p portfolio-passkey ps
curl --fail http://127.0.0.1:3000/api/health
curl --fail --resolve portfolio-passkey.duckdns.org:443:127.0.0.1 \
  https://portfolio-passkey.duckdns.org/api/health
```

앱이 `healthy`이고 두 요청에서 `{"status":"ok"}`가 나와야 합니다. 두 번째 요청은 DNS를 바꾸지 않고 NAS의 Caddy와 원래 도메인의 TLS 인증서를 검사합니다. 인증서 만료 등으로 실패하면 인증서 상태부터 확인합니다. `-k`로 검증을 끄지 않습니다.

브라우저에서 NAS IP 주소로 패스키를 등록하거나 로그인하지 않습니다. 실제 패스키 확인은 원래 도메인으로 해야 합니다.

## 6. 공유기와 DuckDNS 전환

1. 공유기에서 **외부 TCP 80 → NAS 내부 IP:80**, **외부 TCP 443 → NAS 내부 IP:443**을 연결합니다. NAS 방화벽도 허용해야 합니다. NAS 관리 포트·SSH·3000번 포트는 이 목적의 외부 개방 대상이 아닙니다.
2. [DuckDNS](https://www.duckdns.org/)의 `portfolio-passkey`에서 `current ip`를 **집 인터넷의 공인 IPv4**로 바꾸고 `update ip`를 누릅니다. NAS의 `192.168.x.x` 같은 내부 IP를 넣지 않습니다. IPv6를 구성하지 않았다면 AAAA 레코드는 비워 둡니다.
3. Windows에서 확인합니다.

```powershell
Resolve-DnsName portfolio-passkey.duckdns.org -Type A -Server 1.1.1.1
```

새 공인 IP가 나와야 합니다. 캐시로 일부 접속이 잠시 Vultr를 가리킬 수 있지만 그동안 Vultr 앱을 다시 켜지 않습니다.

휴대전화의 **와이파이를 끄고 모바일 데이터**로 공개 주소를 확인합니다. 내부 와이파이만 사용하면 외부 접속이나 공유기 NAT loopback 문제를 구분하기 어렵습니다.

## 7. 이전 후 통과 기준

| 검사 | 통과 기준 |
| --- | --- |
| 시크릿 창에서 소개 | 로그인 없이 열림 |
| 로그인 전 비공개 공간 | 잠김 화면, 메모 본문 없음 |
| 로그인 없이 `/api/private` | HTTP 401 |
| 기존 패스키 로그인 | 재등록 없이 메모가 열림 |
| 패스키 목록 | 이전 전 이름·등록일·개수 유지 |
| 로그아웃 뒤 재조회 | 잠김 상태, 이전 세션 거절 |
| 두 번째 패스키 | 같은 계정에 로그인 가능 |
| 검증용 별도 계정이 있다면 | 상대 계정 자료는 HTTP 403 |
| NAS 앱 재시작 후 | 공개키·메모 보존, 재로그인 가능 |

미인증 HTTP 상태만 확인하려면:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://portfolio-passkey.duckdns.org/api/private
```

세션을 포함한 검사 기록을 남길 때 쿠키와 토큰은 가립니다. 외부 HTTPS와 기존 패스키 로그인까지 확인하기 전에는 Vultr를 삭제하지 않습니다.

## 8. 집 공인 IP 자동 갱신

NAS나 공유기가 지원하는 DuckDNS 업데이트 기능에 도메인과 토큰을 비공개로 설정합니다. **새 서비스를 운영하는 한 곳**에서 갱신하게 하고, 다른 장치의 기존 갱신 작업이 있다면 중지합니다. 현재 구축 과정에서는 Vultr에 자동 갱신 작업을 설치하지 않았습니다.

IP가 바뀌었을 때 DuckDNS가 새 공인 IP를 가리키는지 확인합니다. API의 IPv4 자동 감지는 요청이 나가는 인터넷 연결 기준이므로 VPN 경유 시 집 주소와 다를 수 있습니다. 토큰은 공개 소스에 넣지 않습니다. [DuckDNS 갱신 API](https://www.duckdns.org/spec.jsp)

## 9. 패스키 등록 전이거나 등록 링크가 만료됐다면

NAS 작업 폴더에서:

```bash
sudo docker compose -p portfolio-passkey exec -T app node server/admin.mjs list
```

패스키 수가 0인 **기존 소유자 계정 ID**를 확인하고 `USER_ID` 대신 넣습니다.

```bash
sudo docker compose -p portfolio-passkey exec -T app node server/admin.mjs invite USER_ID
```

출력 링크는 24시간 유효하고 첫 등록 시 소모됩니다. 공개하지 않습니다. 기존 패스키가 있는 계정은 이 명령으로 우회할 수 없고 기존 키로 로그인하여 추가합니다. 모든 사용 가능한 키를 잃은 경우 별도의 소유자 확인과 복구 설계가 필요합니다.

## 10. 실패 시 Vultr로 복귀

**NAS에서 패스키를 추가·삭제하거나 계정을 변경했다면** 원래 Vultr DB를 그대로 켜면 그 변경이 사라집니다. 특히 NAS에서 삭제한 키가 예전 DB에서는 다시 유효해질 수 있습니다. 이 경우 NAS 최신 DB를 정지 상태로 백업해 Vultr로 역이전하는 절차를 먼저 결정합니다.

계정·패스키 변경 없이 연결 확인 단계에서 실패했다면:

1. NAS에서 `sudo docker compose -p portfolio-passkey stop app caddy`로 중지합니다.
2. NAS/공유기 자동 갱신을 잠시 중지하고 DuckDNS A 레코드를 `158.247.218.254`로 되돌립니다.
3. Vultr `/opt/portfolio-passkey`에서 이전 세션을 비우고 시작합니다.

```bash
sudo docker compose -p portfolio-passkey run --rm --no-deps -T \
  --entrypoint node app --input-type=module - <<'NODE'
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
if (!existsSync('/data/portfolio.sqlite')) throw new Error('Missing original database');
const db = new DatabaseSync('/data/portfolio.sqlite');
db.exec('BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM challenges; DELETE FROM invitations; COMMIT;');
db.close();
NODE
sudo docker compose -p portfolio-passkey up -d
```

공개 페이지와 기존 패스키 로그인을 다시 확인합니다. 어느 방향이든 한 서버만 활성화합니다. 실패한 NAS 데이터와 Vultr 백업은 복구가 끝날 때까지 보존합니다.

## 11. Vultr 종료 조건

- 외부 DNS와 HTTPS가 NAS로 정상 연결됩니다.
- 기존 패스키 두 개와 메모 보존을 확인했습니다.
- NAS 재시작 뒤에도 서비스와 자료가 유지됩니다.
- 집 IP 변경에 대한 DuckDNS 갱신 방법을 준비했습니다.
- Vultr와 별개 위치에 복원 가능한 DB·소스 백업을 보관했습니다.

위 조건을 확인한 뒤 해지를 결정합니다. 한 달 이용권의 만료와 실제 과금 종료 조건은 Vultr 계정에서 따로 확인합니다. 정기 외부 백업과 복구 훈련은 수동 이전과 별도로 구성할 운영 작업입니다.

## 검증 범위

현재 Compose·Dockerfile·Caddyfile·DB 스키마·관리 명령과 앞서 확인한 Vultr 상태를 기준으로 작성했습니다. **실제 NAS에서의 실행은 아직 검증하지 않았습니다.** NAS가 정해지면 2장의 미확인 조건을 확정하고 이전 당시 소스·데이터 경로가 문서와 일치하는지 먼저 확인합니다.
