#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/fire-game"
TARGET_RELEASE="${1:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This rollback must run as root." >&2
  exit 1
fi
if [[ ! "${TARGET_RELEASE}" =~ ^[0-9]{14}$ ]] ||
   [[ ! -d "${APP_ROOT}/releases/${TARGET_RELEASE}" ]]; then
  echo "Usage: $0 YYYYMMDDHHMMSS" >&2
  echo "Available releases:" >&2
  find "${APP_ROOT}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r >&2
  exit 1
fi

PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current")"
ln -sfnT "${APP_ROOT}/releases/${TARGET_RELEASE}" "${APP_ROOT}/current"
if systemctl restart fire-game.service &&
   bash "${APP_ROOT}/current/deploy/server-health.sh"; then
  echo "ROLLBACK_OK release=${TARGET_RELEASE}"
  exit 0
fi

ln -sfnT "${PREVIOUS_RELEASE}" "${APP_ROOT}/current"
systemctl restart fire-game.service
echo "Rollback target failed health checks; restored $(basename "${PREVIOUS_RELEASE}")." >&2
exit 1
