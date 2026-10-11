#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/fire-game"
APP_USER="firegame"
ARCHIVE_PATH="${1:-}"
RELEASE_ID="${2:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This updater must run as root." >&2
  exit 1
fi

if [[ ! "${ARCHIVE_PATH}" =~ ^/tmp/fire-game-release-[A-Za-z0-9._-]+\.tar\.gz$ ]] ||
   [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Expected an existing /tmp/fire-game-release-*.tar.gz archive." >&2
  exit 1
fi

if [[ ! "${RELEASE_ID}" =~ ^[0-9]{14}$ ]]; then
  echo "Release id must use YYYYMMDDHHMMSS." >&2
  exit 1
fi

if ! id "${APP_USER}" >/dev/null 2>&1 ||
   [[ ! -f /etc/systemd/system/fire-game.service ]] ||
   [[ ! -L "${APP_ROOT}/current" ]]; then
  echo "The existing fire-game installation is incomplete; use server-install.sh first." >&2
  exit 1
fi

RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
if [[ -e "${RELEASE_DIR}" ]]; then
  echo "Release directory already exists: ${RELEASE_DIR}" >&2
  exit 1
fi

ARCHIVE_ENTRIES="$(tar -tzf "${ARCHIVE_PATH}")"
if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"${ARCHIVE_ENTRIES}"; then
  echo "Archive contains an unsafe path." >&2
  exit 1
fi
for REQUIRED_ENTRY in \
  package.json \
  package-lock.json \
  next.config.ts \
  src \
  deploy/fire-game.service \
  deploy/nginx-fire-game.conf \
  deploy/server-health.sh; do
  if ! grep -Eq "^${REQUIRED_ENTRY}(/|$)" <<<"${ARCHIVE_ENTRIES}"; then
    echo "Archive is missing ${REQUIRED_ENTRY}." >&2
    exit 1
  fi
done

install -d -o "${APP_USER}" -g "${APP_USER}" "${RELEASE_DIR}"
tar --no-same-owner --no-same-permissions -xzf "${ARCHIVE_PATH}" -C "${RELEASE_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"

run_as_app() {
  runuser -u "${APP_USER}" -- env \
    HOME="${APP_ROOT}" \
    NEXT_TELEMETRY_DISABLED=1 \
    "$@"
}

cleanup_failed_release() {
  local STATUS="$1"
  trap - ERR
  set +e
  if [[ "${CONFIGS_CHANGED:-false}" == "true" ]]; then
    cp -a "${SERVICE_BACKUP}" "${SERVICE_FILE}"
    cp -a "${NGINX_BACKUP}" "${NGINX_CONFIG}"
    systemctl daemon-reload
    nginx -t
    systemctl reload nginx
  fi
  if [[ "${APP_SWITCHED:-false}" == "true" ]]; then
    ln -sfnT "${PREVIOUS_RELEASE}" "${APP_ROOT}/current"
    systemctl restart fire-game.service
  fi
  if [[ "${RELEASE_DIR}" == "${APP_ROOT}/releases/${RELEASE_ID}" ]]; then
    rm -rf -- "${RELEASE_DIR}"
  fi
  exit "${STATUS}"
}

APP_SWITCHED="false"
CONFIGS_CHANGED="false"
PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current")"
SERVICE_FILE="/etc/systemd/system/fire-game.service"
NGINX_CONFIG="/etc/nginx/sites-available/fire-game"
SERVICE_BACKUP="/tmp/fire-game-service-${RELEASE_ID}.backup"
NGINX_BACKUP="/tmp/fire-game-nginx-${RELEASE_ID}.backup"
trap 'cleanup_failed_release $?' ERR

pushd "${RELEASE_DIR}" >/dev/null
run_as_app npm ci \
  --registry=https://registry.npmjs.org \
  --replace-registry-host=always \
  --no-audit \
  --no-fund
run_as_app npm run lint
run_as_app npm test
run_as_app npm run build
run_as_app npm prune --omit=dev \
  --registry=https://registry.npmjs.org \
  --replace-registry-host=always \
  --no-audit \
  --no-fund
popd >/dev/null

cp -a "${SERVICE_FILE}" "${SERVICE_BACKUP}"
cp -a "${NGINX_CONFIG}" "${NGINX_BACKUP}"
CONFIGS_CHANGED="true"
install -m 0644 "${RELEASE_DIR}/deploy/fire-game.service" "${SERVICE_FILE}"
install -m 0644 "${RELEASE_DIR}/deploy/nginx-fire-game.conf" "${NGINX_CONFIG}"
nginx -t
systemctl daemon-reload
systemctl reload nginx

ln -sfnT "${RELEASE_DIR}" "${APP_ROOT}/current"
APP_SWITCHED="true"
systemctl restart fire-game.service

for _ in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS --max-time 10 http://127.0.0.1:3000/ >/dev/null
curl -fsS --max-time 10 http://127.0.0.1/ >/dev/null

APP_SWITCHED="false"
CONFIGS_CHANGED="false"
trap - ERR
rm -f -- "${SERVICE_BACKUP}" "${NGINX_BACKUP}"
systemctl --no-pager --full status fire-game.service | sed -n '1,18p'
echo "DEPLOYMENT_OK release=${RELEASE_ID}"
