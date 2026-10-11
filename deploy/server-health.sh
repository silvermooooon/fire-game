#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/fire-game"

systemctl is-active --quiet fire-game.service
systemctl is-active --quiet nginx
nginx -t >/dev/null
[[ -L "${APP_ROOT}/current" ]]

for _ in {1..15}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/ >/dev/null &&
     curl -fsS --max-time 3 http://127.0.0.1/ >/dev/null; then
    RELEASE="$(basename "$(readlink -f "${APP_ROOT}/current")")"
    echo "HEALTH_OK release=${RELEASE} app=active nginx=active"
    exit 0
  fi
  sleep 1
done

echo "Health check failed." >&2
systemctl --no-pager --full status fire-game.service >&2 || true
exit 1
