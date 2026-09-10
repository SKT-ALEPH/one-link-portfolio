#!/bin/sh
set -eu
# Run as root only after verifying deployment key access in a separate SSH connection.
test "$(id -u)" = 0
test -s /home/linuxuser/.ssh/authorized_keys
python3 - <<'PY'
import os, secrets, subprocess
password = secrets.token_urlsafe(36)
fd = os.open('/root/portfolio-linuxuser-password', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(password + '\n')
subprocess.run(['chpasswd'], input='linuxuser:' + password + '\n', text=True, check=True)
PY
printf '%s\n' 'PubkeyAuthentication yes' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin prohibit-password' > /etc/ssh/sshd_config.d/00-portfolio-key-only.conf
/usr/sbin/sshd -t
systemctl reload ssh
sed -i '/ portfolio-deployment$/d' /home/linuxuser/.ssh/authorized_keys
printf '%s\n' 'SSH key access enabled; old shared password replaced; recovery value stored root-only.'
