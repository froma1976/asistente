#!/usr/bin/env bash
set -euo pipefail
cd /opt/clara
test "$(id -u)" = 0
for f in compose.yaml compose.override.yaml privado/.env privado/datos/config.json; do test -s "$f"; done
command -v git >/dev/null
docker compose version >/dev/null
install -d -m 700 /opt/clara/releases
# Install the updater from the same pinned revision as this installer.
[[ ${1:-} =~ ^[0-9a-f]{40}$ ]]
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL "https://raw.githubusercontent.com/froma1976/asistente/$1/deploy/actualizar.sh" -o "$tmp"
bash -n "$tmp"
install -m 700 "$tmp" /opt/clara/releases/actualizar
cat >/etc/systemd/system/clara-publicar.service <<'EOF'
[Unit]
Description=Aplicar la version publicada de Clara
After=network-online.target docker.service
[Service]
Type=oneshot
ExecStart=/opt/clara/releases/actualizar
TimeoutStartSec=20min
EOF
cat >/etc/systemd/system/clara-publicar.timer <<'EOF'
[Unit]
Description=Buscar versiones aprobadas de Clara
[Timer]
OnBootSec=2min
OnUnitInactiveSec=2min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now clara-publicar.timer
systemctl start clara-publicar.service
echo "Actualizaciones activadas."
