#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/fire-game"
APP_USER="firegame"
ARCHIVE_PATH="${1:-}"
RELEASE_ID="${2:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This installer must run as root." >&2
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
  tsconfig.json \
  postcss.config.mjs \
  eslint.config.mjs \
  next-env.d.ts \
  deploy/fire-game.service \
  deploy/nginx-fire-game.conf \
  deploy/server-health.sh \
  deploy/server-rollback.sh \
  public/art/hanabi-table-desktop.webp \
  public/art/hanabi-table-mobile.webp \
  src/components/hanabi-app.tsx \
  src/components/particle-effects.tsx; do
  if ! grep -Fxq "${REQUIRED_ENTRY}" <<<"${ARCHIVE_ENTRIES}"; then
    echo "Archive is missing ${REQUIRED_ENTRY}." >&2
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx

NODE_SUPPORTED="false"
if command -v node >/dev/null 2>&1; then
  NODE_SUPPORTED="$(node -e 'const major=Number(process.versions.node.split(".")[0]); process.stdout.write(major===22?"true":"false")')"
fi

if [[ "${NODE_SUPPORTED}" != "true" ]]; then
  NODE_SETUP="/tmp/nodesource-node22-setup.sh"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "${NODE_SETUP}"
  bash "${NODE_SETUP}"
  apt-get install -y nodejs
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_ROOT}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_ROOT}" "${APP_ROOT}/releases" "${APP_ROOT}/.npm"
install -d -o "${APP_USER}" -g "${APP_USER}" "${RELEASE_DIR}"
tar --no-same-owner --no-same-permissions -xzf "${ARCHIVE_PATH}" -C "${RELEASE_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"

run_as_app() {
  runuser -u "${APP_USER}" -- env \
    HOME="${APP_ROOT}" \
    NEXT_TELEMETRY_DISABLED=1 \
    "$@"
}

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

SERVICE_FILE="/etc/systemd/system/fire-game.service"
NGINX_CONFIG="/etc/nginx/sites-available/fire-game"
NGINX_ENABLED="/etc/nginx/sites-enabled/fire-game"
DEFAULT_ENABLED="/etc/nginx/sites-enabled/default"
SERVICE_BACKUP="${SERVICE_FILE}.backup-${RELEASE_ID}"
NGINX_CONFIG_BACKUP="${NGINX_CONFIG}.backup-${RELEASE_ID}"
NGINX_ENABLED_BACKUP="/etc/nginx/sites-available/fire-game.enabled-backup-${RELEASE_ID}"
DEFAULT_ENABLED_BACKUP="/etc/nginx/sites-available/default.enabled-backup-${RELEASE_ID}"
HAD_SERVICE="false"
HAD_NGINX_CONFIG="false"
HAD_NGINX_ENABLED="false"
HAD_DEFAULT_ENABLED="false"

if [[ -e "${SERVICE_FILE}" ]]; then
  cp -a "${SERVICE_FILE}" "${SERVICE_BACKUP}"
  HAD_SERVICE="true"
fi
if [[ -e "${NGINX_CONFIG}" ]]; then
  cp -a "${NGINX_CONFIG}" "${NGINX_CONFIG_BACKUP}"
  HAD_NGINX_CONFIG="true"
fi
if [[ -e "${NGINX_ENABLED}" || -L "${NGINX_ENABLED}" ]]; then
  mv "${NGINX_ENABLED}" "${NGINX_ENABLED_BACKUP}"
  HAD_NGINX_ENABLED="true"
fi
if [[ -e "${DEFAULT_ENABLED}" || -L "${DEFAULT_ENABLED}" ]]; then
  mv "${DEFAULT_ENABLED}" "${DEFAULT_ENABLED_BACKUP}"
  HAD_DEFAULT_ENABLED="true"
fi

restore_service_and_nginx_files() {
  rm -f "${NGINX_ENABLED}"
  if [[ "${HAD_NGINX_ENABLED}" == "true" ]]; then
    mv "${NGINX_ENABLED_BACKUP}" "${NGINX_ENABLED}"
  fi
  if [[ "${HAD_DEFAULT_ENABLED}" == "true" ]]; then
    mv "${DEFAULT_ENABLED_BACKUP}" "${DEFAULT_ENABLED}"
  fi
  if [[ "${HAD_NGINX_CONFIG}" == "true" ]]; then
    mv "${NGINX_CONFIG_BACKUP}" "${NGINX_CONFIG}"
  else
    rm -f "${NGINX_CONFIG}"
  fi
  if [[ "${HAD_SERVICE}" == "true" ]]; then
    mv "${SERVICE_BACKUP}" "${SERVICE_FILE}"
  else
    rm -f "${SERVICE_FILE}"
  fi
}

if ! {
  install -m 0644 "${RELEASE_DIR}/deploy/fire-game.service" "${SERVICE_FILE}"
  install -m 0644 "${RELEASE_DIR}/deploy/nginx-fire-game.conf" "${NGINX_CONFIG}"
  ln -s "${NGINX_CONFIG}" "${NGINX_ENABLED}"
  nginx -t
}; then
  restore_service_and_nginx_files
  echo "Nginx validation failed; previous configuration was restored." >&2
  exit 1
fi

CURRENT_LINK="${APP_ROOT}/current"
if [[ -e "${CURRENT_LINK}" && ! -L "${CURRENT_LINK}" ]]; then
  restore_service_and_nginx_files
  echo "${CURRENT_LINK} exists and is not a symbolic link." >&2
  exit 1
fi
PREVIOUS_RELEASE=""
if [[ -L "${CURRENT_LINK}" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "${CURRENT_LINK}")"
fi

APP_SWITCHED="false"
rollback_release() {
  local STATUS="$1"
  trap - ERR
  set +e
  restore_service_and_nginx_files
  systemctl daemon-reload
  if [[ "${APP_SWITCHED}" == "true" ]]; then
    if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
      ln -sfnT "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
      systemctl restart fire-game.service
    else
      rm -f "${CURRENT_LINK}"
      systemctl stop fire-game.service
    fi
  fi
  nginx -t
  systemctl reload nginx
  exit "${STATUS}"
}

trap 'rollback_release $?' ERR
ln -sfnT "${RELEASE_DIR}" "${CURRENT_LINK}"
APP_SWITCHED="true"

systemctl daemon-reload
systemctl enable fire-game.service
systemctl restart fire-game.service

for _ in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS --max-time 10 http://127.0.0.1:3000/ >/dev/null

systemctl enable nginx
systemctl restart nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "^Status: active"; then
  ufw allow 22/tcp
  ufw allow 47742/tcp
  ufw allow 80/tcp
fi

curl -fsS --max-time 10 http://127.0.0.1/ >/dev/null
APP_SWITCHED="false"
trap - ERR
rm -f -- \
  "${SERVICE_BACKUP}" \
  "${NGINX_CONFIG_BACKUP}" \
  "${NGINX_ENABLED_BACKUP}" \
  "${DEFAULT_ENABLED_BACKUP}"
systemctl --no-pager --full status fire-game.service | sed -n '1,18p'
echo "DEPLOYMENT_OK release=${RELEASE_ID}"
