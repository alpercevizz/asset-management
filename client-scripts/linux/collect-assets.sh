#!/usr/bin/env bash
# ============================================================
#  AI Asset Management - Linux/macOS Hardware Collector
# ============================================================

set -euo pipefail

WEBHOOK_URL="${ASSET_WEBHOOK_URL:-http://localhost:3000/api/webhook}"
LOG_FILE="${TMPDIR:-/tmp}/asset-collector.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$1] $2" | tee -a "$LOG_FILE"; }
info() { log "INFO" "$1"; }
error() { log "ERROR" "$1"; }

safe() { echo "${1:-}" | head -c 200 | tr -d '\n\r' | sed 's/["\]//g'; }

info "Veri toplama basliyor..."

# ── OS Tespiti ───────────────────────────────────────────────────────────────
OS_TYPE="$(uname -s)"

# ── Hostname ─────────────────────────────────────────────────────────────────
HOSTNAME_VAL="$(hostname -s 2>/dev/null || hostname)"

# ── CPU ──────────────────────────────────────────────────────────────────────
if [ "$OS_TYPE" = "Darwin" ]; then
    CPU_MODEL="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo '')"
    CPU_CORES="$(sysctl -n hw.physicalcpu 2>/dev/null || echo '')"
    CPU_THREADS="$(sysctl -n hw.logicalcpu 2>/dev/null || echo '')"
else
    CPU_MODEL="$(grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo '')"
    CPU_CORES="$(grep -c ^processor /proc/cpuinfo 2>/dev/null || echo '')"
    CPU_THREADS="$CPU_CORES"
fi

# ── RAM ──────────────────────────────────────────────────────────────────────
if [ "$OS_TYPE" = "Darwin" ]; then
    RAM_BYTES="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
    RAM_GB=$(( RAM_BYTES / 1073741824 ))
else
    RAM_KB="$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)"
    RAM_GB=$(( RAM_KB / 1048576 ))
fi

# ── Disk ─────────────────────────────────────────────────────────────────────
if [ "$OS_TYPE" = "Darwin" ]; then
    DISK_GB="$(df -g / 2>/dev/null | awk 'NR==2 {print $2}' || echo 0)"
else
    DISK_GB="$(df -BG / 2>/dev/null | awk 'NR==2 {gsub(/G/,""); print $2}' || echo 0)"
fi

# ── OS ───────────────────────────────────────────────────────────────────────
if [ "$OS_TYPE" = "Darwin" ]; then
    OS_NAME="macOS $(sw_vers -productVersion 2>/dev/null || echo '')"
else
    OS_NAME="$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -r)"
fi

# ── Seri No ──────────────────────────────────────────────────────────────────
if [ "$OS_TYPE" = "Darwin" ]; then
    SERIAL="$(system_profiler SPHardwareDataType 2>/dev/null | awk '/Serial Number/ {print $NF}' || echo '')"
else
    SERIAL="$(cat /sys/class/dmi/id/product_serial 2>/dev/null || dmidecode -s system-serial-number 2>/dev/null || echo '')"
fi
[ -z "$SERIAL" ] && SERIAL="$HOSTNAME_VAL"

# ── Marka & Model ────────────────────────────────────────────────────────────
if [ "$OS_TYPE" = "Darwin" ]; then
    BRAND="Apple"
    MODEL="$(system_profiler SPHardwareDataType 2>/dev/null | awk '/Model Name/ {$1=$2=""; print $0}' | xargs || echo 'Mac')"
else
    BRAND="$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || dmidecode -s system-manufacturer 2>/dev/null || echo '')"
    MODEL="$(cat /sys/class/dmi/id/product_name 2>/dev/null || dmidecode -s system-product-name 2>/dev/null || echo '')"
fi

# ── IP & MAC ─────────────────────────────────────────────────────────────────
if command -v ip &>/dev/null; then
    IP_ADDR="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1 || echo '')"
    IFACE="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1 || echo '')"
    MAC_ADDR="$(cat /sys/class/net/${IFACE}/address 2>/dev/null || echo '')"
elif command -v ifconfig &>/dev/null; then
    IP_ADDR="$(ifconfig | awk '/inet / && !/127.0.0.1/ {print $2}' | head -1 | tr -d 'addr:' || echo '')"
    MAC_ADDR="$(ifconfig | awk '/ether / {print $2}' | head -1 || echo '')"
fi

# ── Username ─────────────────────────────────────────────────────────────────
USERNAME="$(whoami 2>/dev/null || echo '')"

# ── Uptime ───────────────────────────────────────────────────────────────────
UPTIME_DAYS="$(awk '{printf "%.1f", $1/86400}' /proc/uptime 2>/dev/null || echo '')"

# ── Payload ──────────────────────────────────────────────────────────────────
LAST_SEEN="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

JSON=$(cat <<EOF
{
  "hostname": "$(safe "$HOSTNAME_VAL")",
  "serial_number": "$(safe "$SERIAL")",
  "brand": "$(safe "$BRAND")",
  "model": "$(safe "$MODEL")",
  "cpu": "$(safe "$CPU_MODEL")",
  "cpu_cores": ${CPU_CORES:-0},
  "cpu_threads": ${CPU_THREADS:-0},
  "ram_gb": ${RAM_GB:-0},
  "storage_gb": ${DISK_GB:-0},
  "os": "$(safe "$OS_NAME")",
  "ip_address": "$(safe "${IP_ADDR:-}")",
  "mac_address": "$(safe "${MAC_ADDR:-}")",
  "username": "$(safe "$USERNAME")",
  "uptime_days": ${UPTIME_DAYS:-0},
  "last_seen": "$LAST_SEEN",
  "status": "online",
  "collector_ver": "1.0.0"
}
EOF
)

info "Toplanan: hostname=$HOSTNAME_VAL, serial=$SERIAL, RAM=${RAM_GB}GB, Disk=${DISK_GB}GB"
info "Webhook'a gonderiliyor: $WEBHOOK_URL"

RESPONSE=$(curl -sf -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "User-Agent: AssetCollector/1.0 ($(uname -s))" \
    --data-raw "$JSON" \
    --max-time 30) || { error "curl basarisiz oldu. Webhook URL kontrol edin."; exit 1; }

info "Basarili: $RESPONSE"
info "Tamamlandi."
