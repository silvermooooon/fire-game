#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE_PATH="${1:-}"
RELEASE_ID="${2:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This bootstrapper must run as root." >&2
  exit 1
fi
if [[ ! "${ARCHIVE_PATH}" =~ ^/tmp/fire-game-release-[A-Za-z0-9._-]+\.tar\.gz$ ]] ||
   [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Expected an existing /tmp/fire-game-release-*.tar.gz archive." >&2
  exit 1
fi
if [[ -z "${RELEASE_ID}" ]]; then
  RELEASE_ID="$(basename "${ARCHIVE_PATH}" | sed -nE 's/^fire-game-release-([0-9]{14})\.tar\.gz$/\1/p')"
fi
if [[ ! "${RELEASE_ID}" =~ ^[0-9]{14}$ ]]; then
  echo "Unable to determine a YYYYMMDDHHMMSS release id." >&2
  exit 1
fi

INSTALLER="/tmp/fire-game-server-install-${RELEASE_ID}.sh"
cleanup() {
  rm -f -- "${INSTALLER}"
}
trap cleanup EXIT

tar -xOf "${ARCHIVE_PATH}" deploy/server-install.sh > "${INSTALLER}"
chmod 0700 "${INSTALLER}"
bash "${INSTALLER}" "${ARCHIVE_PATH}" "${RELEASE_ID}"
