#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="garmin-viewer"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
NODE_MAJOR="${NODE_MAJOR:-22}"
INSTALL_SERVICE=0
SKIP_BUILD=0

usage() {
  cat <<USAGE
Usage: ./scripts/setup-linux.sh [options]

Installs the Linux server environment needed to run ${APP_NAME}.

Options:
  --app-dir PATH        Project directory. Default: ${APP_DIR}
  --port PORT           Port for the app and optional service. Default: ${PORT}
  --host HOST           Host for the app and optional service. Default: ${HOST}
  --node-major VERSION  Node.js major version to install if missing/old. Default: ${NODE_MAJOR}
  --install-service     Create and start a systemd service.
  --skip-build          Install dependencies but do not run the production build.
  -h, --help            Show this help.

Environment variables:
  GARMIN_USERNAME, GARMIN_PASSWORD, GARMIN_DOMAIN, PORT, HOST, NODE_MAJOR
USAGE
}

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

env_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "${value}"
}

need_sudo() {
  if [[ "${EUID}" -eq 0 ]]; then
    SUDO=()
  elif have sudo; then
    SUDO=(sudo)
  else
    die "This step needs root privileges. Re-run as root or install sudo."
  fi
}

version_major() {
  "$1" --version 2>/dev/null | sed -E 's/^v?([0-9]+).*/\1/'
}

install_system_packages() {
  log "Installing system packages"
  need_sudo

  if have apt-get; then
    "${SUDO[@]}" apt-get update
    "${SUDO[@]}" apt-get install -y ca-certificates curl unzip git bash xz-utils build-essential
  elif have dnf; then
    "${SUDO[@]}" dnf install -y ca-certificates curl unzip git bash xz gcc gcc-c++ make
  elif have yum; then
    "${SUDO[@]}" yum install -y ca-certificates curl unzip git bash xz gcc gcc-c++ make
  elif have apk; then
    "${SUDO[@]}" apk add --no-cache ca-certificates curl unzip git bash xz build-base libc6-compat
  elif have pacman; then
    "${SUDO[@]}" pacman -Sy --needed --noconfirm ca-certificates curl unzip git bash xz base-devel
  else
    die "Unsupported package manager. Install curl, unzip, git, bash, xz, and build tools manually."
  fi
}

install_node_if_needed() {
  local current_major=""
  if have node; then
    current_major="$(version_major node)"
  fi

  if [[ -n "${current_major}" && "${current_major}" -ge 20 ]]; then
    log "Node.js $(node --version) is available"
    return
  fi

  log "Installing Node.js ${NODE_MAJOR}.x with nvm"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi

  # shellcheck disable=SC1091
  source "${NVM_DIR}/nvm.sh"
  nvm install "${NODE_MAJOR}"
  nvm alias default "${NODE_MAJOR}"
  nvm use default
}

install_bun_if_needed() {
  if have bun; then
    log "Bun $(bun --version) is available"
    return
  fi

  log "Installing Bun"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="${BUN_INSTALL}/bin:${PATH}"

  have bun || die "Bun install finished, but bun is not on PATH. Open a new shell or add ~/.bun/bin to PATH."
}

write_env_file() {
  cd "${APP_DIR}"

  if [[ -f .env ]]; then
    log "Keeping existing .env"
    return
  fi

  log "Creating .env"
  local username="${GARMIN_USERNAME:-}"
  local password="${GARMIN_PASSWORD:-}"
  local domain="${GARMIN_DOMAIN:-garmin.com}"

  if [[ -z "${username}" ]]; then
    [[ -t 0 ]] || die "GARMIN_USERNAME is required when running without an interactive terminal."
    read -r -p "GARMIN_USERNAME: " username
  fi
  if [[ -z "${password}" ]]; then
    [[ -t 0 ]] || die "GARMIN_PASSWORD is required when running without an interactive terminal."
    read -r -s -p "GARMIN_PASSWORD: " password
    printf '\n'
  fi
  if [[ "${domain}" != "garmin.com" && "${domain}" != "garmin.cn" ]]; then
    die 'GARMIN_DOMAIN must be either "garmin.com" or "garmin.cn".'
  fi

  umask 077
  {
    printf 'GARMIN_USERNAME=%s\n' "$(env_quote "${username}")"
    printf 'GARMIN_PASSWORD=%s\n' "$(env_quote "${password}")"
    printf 'GARMIN_DOMAIN=%s\n' "$(env_quote "${domain}")"
  } > .env
}

install_project_dependencies() {
  log "Installing project dependencies"
  cd "${APP_DIR}"
  bun install --frozen-lockfile
}

build_project() {
  if [[ "${SKIP_BUILD}" -eq 1 ]]; then
    log "Skipping build"
    return
  fi

  log "Building production app"
  cd "${APP_DIR}"
  bun run build
}

install_systemd_service() {
  [[ "${INSTALL_SERVICE}" -eq 1 ]] || return

  have systemctl || die "systemctl is not available on this server."
  need_sudo

  log "Installing systemd service"
  local bun_path
  bun_path="$(command -v bun)"

  local env_path="${APP_DIR}/.env"
  [[ -f "${env_path}" ]] || die "Cannot create service without ${env_path}."

  local service_file="/etc/systemd/system/${APP_NAME}.service"
  local run_user="${SUDO_USER:-$USER}"

  "${SUDO[@]}" tee "${service_file}" >/dev/null <<SERVICE
[Unit]
Description=Garmin Viewer Next.js app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${run_user}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${env_path}
Environment=NODE_ENV=production
Environment=HOST=${HOST}
Environment=PORT=${PORT}
ExecStart=${bun_path} run start -- --hostname ${HOST} --port ${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

  "${SUDO[@]}" systemctl daemon-reload
  "${SUDO[@]}" systemctl enable --now "${APP_NAME}"
  "${SUDO[@]}" systemctl status "${APP_NAME}" --no-pager
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-dir)
        APP_DIR="$2"
        shift 2
        ;;
      --port)
        PORT="$2"
        shift 2
        ;;
      --host)
        HOST="$2"
        shift 2
        ;;
      --node-major)
        NODE_MAJOR="$2"
        shift 2
        ;;
      --install-service)
        INSTALL_SERVICE=1
        shift
        ;;
      --skip-build)
        SKIP_BUILD=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done

  [[ -f "${APP_DIR}/package.json" ]] || die "package.json not found in ${APP_DIR}"
  [[ -f "${APP_DIR}/bun.lock" ]] || die "bun.lock not found in ${APP_DIR}; this script expects Bun."

  install_system_packages
  install_node_if_needed
  install_bun_if_needed
  write_env_file
  install_project_dependencies
  build_project
  install_systemd_service

  log "Done"
  printf 'Run manually with:\n'
  printf '  cd %q && HOST=%q PORT=%q bun run start -- --hostname %q --port %q\n' "${APP_DIR}" "${HOST}" "${PORT}" "${HOST}" "${PORT}"
}

main "$@"
