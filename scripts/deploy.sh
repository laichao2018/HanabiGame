#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="hanabi-online"
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.production"
PUBLIC_ORIGIN=""
PORT=""
PORT_EXPLICIT=0
AUTO_INSTALL=1
DRY_RUN=0
SKIP_FIREWALL=0
ACTION="deploy"
COMPOSE=()
DOCKER=()

log() { printf '\033[1;34m[花火部署]\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m[完成]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[提示]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[失败]\033[0m %s\n' "$*" >&2; exit 1; }
run() { if (( DRY_RUN )); then printf '[检查模式]'; printf ' %q' "$@"; printf '\n'; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'EOF'
用法：./scripts/deploy.sh [选项]

选项：
  --port PORT           指定服务端口；不传则从 8080 开始自动选择
  --stop                停止并移除现有容器，但保留用户数据
  --no-install          缺少 Docker 时只报错，不自动安装
  --skip-firewall       不尝试开放防火墙端口
  --dry-run             只检查环境并打印将执行的操作
  -h, --help            显示帮助

示例：
  ./scripts/deploy.sh
  ./scripts/deploy.sh --port 9527
  ./scripts/deploy.sh --stop
EOF
}

while (($#)); do
  case "$1" in
    --port) [[ $# -ge 2 ]] || die "--port 缺少参数"; PORT="$2"; PORT_EXPLICIT=1; shift 2 ;;
    --stop) ACTION="stop"; shift ;;
    --no-install) AUTO_INSTALL=0; shift ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（使用 --help 查看用法）" ;;
  esac
done

if (( PORT_EXPLICIT )); then
  [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "端口必须是 1–65535"
fi
[[ -f "${PROJECT_DIR}/docker-compose.yml" && -f "${PROJECT_DIR}/Dockerfile" ]] || die "请在完整的项目目录中运行此脚本"

detect_os() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux)
      [[ -r /etc/os-release ]] || die "无法识别 Linux 发行版"
      # shellcheck disable=SC1091
      . /etc/os-release
      DISTRO="${ID:-linux}"
      ;;
    Darwin)
      (( EUID != 0 )) || die "macOS 请使用普通用户运行，不要加 sudo"
      DISTRO="macos"
      ;;
    *) die "暂不支持 $OS；请使用 Linux 服务器或 macOS" ;;
  esac
  log "系统：${DISTRO} ${ARCH}"
}

sudo_cmd() {
  if (( EUID == 0 )); then "$@"; elif have sudo; then sudo "$@"; else die "安装系统软件需要 root 或 sudo 权限"; fi
}

install_docker_linux() {
  (( AUTO_INSTALL )) || die "未检测到 Docker；移除 --no-install 后可自动安装"
  log "正在安装 Docker 与 Compose"
  case "$DISTRO" in
    ubuntu|debian|raspbian)
      run sudo_cmd apt-get update
      if ! run sudo_cmd apt-get install -y ca-certificates curl docker.io docker-compose-v2; then
        run sudo_cmd apt-get install -y ca-certificates curl docker.io docker-compose-plugin
      fi
      ;;
    fedora)
      run sudo_cmd dnf install -y docker docker-compose-plugin
      ;;
    rhel|centos|rocky|almalinux)
      local package_manager="dnf"
      have dnf || package_manager="yum"
      run sudo_cmd "$package_manager" install -y "${package_manager}-utils" ca-certificates curl
      if [[ "$package_manager" == dnf ]]; then
        run sudo_cmd dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      else
        run sudo_cmd yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      fi
      run sudo_cmd "$package_manager" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    amzn)
      run sudo_cmd yum install -y docker
      warn "Amazon Linux 若未提供 Compose 插件，请先安装 docker-compose-plugin 后重跑"
      ;;
    *) die "无法为 ${DISTRO} 自动安装 Docker；请手动安装 Docker Engine 与 Compose 插件后重跑" ;;
  esac
  run sudo_cmd systemctl enable --now docker
}

install_docker_macos() {
  (( AUTO_INSTALL )) || die "未检测到 Docker；移除 --no-install 后可自动安装"
  have brew || die "macOS 自动安装需要 Homebrew：https://brew.sh"
  run brew install --cask docker
  (( DRY_RUN )) && return
  start_docker_macos
}

wait_for_docker() {
  local attempts="${1:-90}"
  local count
  for count in $(seq 1 "$attempts"); do
    # Docker Desktop 首次初始化时偶尔会终止正在探测的 CLI 进程。
    # 放进重定向的子 shell，避免瞬时 SIGKILL 在终端显示为脚本错误。
    if (docker info >/dev/null 2>&1) 2>/dev/null; then return 0; fi
    (( count % 10 == 0 )) && log "仍在等待 Docker 启动（$((count * 2)) 秒）…"
    sleep 2
  done
  return 1
}

start_docker_macos() {
  log "正在启动 Docker Desktop"
  if docker desktop --help >/dev/null 2>&1; then
    docker desktop start >/dev/null 2>&1 || open -gja Docker
  else
    open -gja Docker
  fi
  wait_for_docker 90 && return
  die "Docker Desktop 未能在 180 秒内启动。请打开 Docker.app，完成许可确认或首次初始化后重新运行脚本"
}

ensure_tools() {
  have curl && return
  (( AUTO_INSTALL )) || die "缺少 curl；移除 --no-install 后可自动安装"
  [[ "$OS" == Linux ]] || die "请先安装 curl"
  case "$DISTRO" in
    ubuntu|debian|raspbian) run sudo_cmd apt-get update; run sudo_cmd apt-get install -y curl ;;
    fedora|rhel|centos|rocky|almalinux) run sudo_cmd dnf install -y curl ;;
    amzn) run sudo_cmd yum install -y curl ;;
    *) die "请先安装 curl" ;;
  esac
}

choose_docker() {
  if ! have docker; then
    [[ "$OS" == Linux ]] && install_docker_linux || install_docker_macos
  fi
  if ! (docker info >/dev/null 2>&1) 2>/dev/null && (( ! DRY_RUN )); then
    if [[ "$OS" == Darwin ]]; then
      start_docker_macos
    else
      log "Docker 已安装但未运行，正在启动服务"
      run sudo_cmd systemctl enable --now docker
      wait_for_docker 30 || die "Docker 服务启动失败，请检查：systemctl status docker"
    fi
  fi
  if docker info >/dev/null 2>&1; then DOCKER=(docker)
  elif (( EUID != 0 )) && have sudo && sudo docker info >/dev/null 2>&1; then DOCKER=(sudo docker)
  elif (( DRY_RUN )); then DOCKER=(docker)
  else die "Docker 服务不可用。请启动 Docker 后重试"; fi

  if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
    COMPOSE=("${DOCKER[@]}" compose)
  elif have docker-compose; then
    COMPOSE=(docker-compose)
  elif (( DRY_RUN )); then
    COMPOSE=(docker compose)
  else
    die "未检测到 Docker Compose v2"
  fi
  log "Docker：$("${DOCKER[@]}" --version 2>/dev/null || printf '待安装')"
}

port_is_free() {
  local candidate="$1"
  if have lsof; then ! lsof -nP -iTCP:"$candidate" -sTCP:LISTEN >/dev/null 2>&1
  elif have ss; then ! ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${candidate}$"
  elif have netstat; then ! netstat -an 2>/dev/null | grep -E "[.:]${candidate}[[:space:]].*LISTEN" >/dev/null
  else return 0
  fi
}

local_ip() {
  local detected=""
  if [[ "$OS" == Darwin ]]; then
    local iface
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    [[ -n "$iface" ]] && detected="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [[ -n "$detected" ]] || detected="$(ipconfig getifaddr en0 2>/dev/null || true)"
    [[ -n "$detected" ]] || detected="$(ipconfig getifaddr en1 2>/dev/null || true)"
  else
    if have ip; then detected="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"; fi
    [[ -n "$detected" ]] || detected="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "${detected:-127.0.0.1}"
}

choose_port() {
  if (( ! PORT_EXPLICIT )) && [[ -f "$ENV_FILE" ]]; then
    PORT="$(sed -n 's/^HANABI_HTTP_PORT=//p' "$ENV_FILE" | head -n1)"
    [[ "$PORT" =~ ^[0-9]+$ ]] || PORT=""
    if [[ -n "$PORT" ]] && ! port_is_free "$PORT"; then
      if [[ -n "$("${COMPOSE[@]}" --env-file "$ENV_FILE" ps -q nginx 2>/dev/null || true)" ]]; then
        log "复用现有部署端口：${PORT}"
      else
        warn "原端口 ${PORT} 已被其他程序占用，将重新选择"
        PORT=""
      fi
    elif [[ -n "$PORT" ]]; then
      log "复用现有部署端口：${PORT}"
    fi
  fi
  if [[ -z "$PORT" ]]; then
    local candidate
    for candidate in $(seq 8080 8180); do
      if port_is_free "$candidate"; then PORT="$candidate"; break; fi
    done
    [[ -n "$PORT" ]] || die "8080–8180 范围内没有可用端口，请使用 --port 指定其他端口"
    log "自动选择可用端口：${PORT}"
  elif (( PORT_EXPLICIT )) && ! port_is_free "$PORT"; then
    if [[ -z "$("${COMPOSE[@]}" --env-file "$ENV_FILE" ps -q nginx 2>/dev/null || true)" ]]; then
      die "指定端口 ${PORT} 已被占用"
    fi
  fi
  PUBLIC_ORIGIN="http://$(local_ip):${PORT}"
}

preflight() {
  local free_kb
  free_kb="$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print $4}')"
  (( free_kb >= 1048576 )) || die "可用磁盘空间不足 1 GiB"
  choose_port
  log "局域网访问地址：${PUBLIC_ORIGIN}"
}

random_secret() {
  if have openssl; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; fi
}

write_environment() {
  local secret=""
  if [[ -f "$ENV_FILE" ]]; then
    secret="$(sed -n 's/^JWT_SECRET=//p' "$ENV_FILE" | head -n1)"
  fi
  [[ ${#secret} -ge 32 ]] || secret="$(random_secret)"
  if (( DRY_RUN )); then log "将写入 ${ENV_FILE}（密钥不会打印）"; return; fi
  umask 077
  {
    printf 'JWT_SECRET=%s\n' "$secret"
    printf 'PUBLIC_ORIGIN=%s\n' "$PUBLIC_ORIGIN"
    printf 'HANABI_HTTP_PORT=%s\n' "$PORT"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

configure_firewall() {
  (( SKIP_FIREWALL || DRY_RUN )) && return
  if have ufw && sudo_cmd ufw status 2>/dev/null | grep -q '^Status: active'; then
    run sudo_cmd ufw allow "${PORT}/tcp"
  elif have firewall-cmd && sudo_cmd firewall-cmd --state >/dev/null 2>&1; then
    run sudo_cmd firewall-cmd --permanent --add-port="${PORT}/tcp"
    run sudo_cmd firewall-cmd --reload
  fi
}

deploy() {
  log "校验 Compose 配置"
  run "${COMPOSE[@]}" --env-file "$ENV_FILE" config --quiet
  log "清理旧容器（保留用户数据卷）"
  run "${COMPOSE[@]}" --env-file "$ENV_FILE" down --remove-orphans
  log "构建并启动 ${APP_NAME}"
  run "${COMPOSE[@]}" --env-file "$ENV_FILE" up -d --build --remove-orphans
  (( DRY_RUN )) && return
  log "等待服务通过健康检查"
  local health_url="http://127.0.0.1:${PORT}/api/health/ready"
  for _ in $(seq 1 40); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      ok "服务已启动：${PUBLIC_ORIGIN}"
      "${COMPOSE[@]}" --env-file "$ENV_FILE" ps
      printf '\nSERVICE_PORT=%s\nSERVICE_URL=%s\n' "$PORT" "$PUBLIC_ORIGIN"
      return
    fi
    sleep 2
  done
  "${COMPOSE[@]}" --env-file "$ENV_FILE" logs --tail=100 >&2 || true
  die "服务未能在 80 秒内通过健康检查"
}

stop_environment() {
  log "停止 ${APP_NAME}（保留用户、房间和历史数据）"
  if [[ -f "$ENV_FILE" ]]; then
    run "${COMPOSE[@]}" --env-file "$ENV_FILE" down --remove-orphans
  else
    run "${COMPOSE[@]}" down --remove-orphans
  fi
  ok "服务已停止；数据卷 hanabi_data 已保留"
}

detect_os
ensure_tools
choose_docker
if [[ "$ACTION" == "stop" ]]; then
  stop_environment
  exit 0
fi
preflight
write_environment
configure_firewall
deploy
