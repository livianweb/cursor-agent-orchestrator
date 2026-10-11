#!/usr/bin/env bash
# Imprime URLs del panel (localhost + IPv4 del host por interfaz).
# Uso: panel-print-urls.sh [PUERTO]   (default CONFIGURE_PORT o 8765)
set -euo pipefail

PORT="${1:-${CONFIGURE_PORT:-8765}}"

panel_iface_skip() {
  local iface="$1"
  case "$iface" in
    lo|docker0) return 0 ;;
  esac
  case "$iface" in
    br-*|veth*|virbr*) return 0 ;;
  esac
  return 1
}

panel_add_ip() {
  local addr="$1"
  local -n _seen="$2"
  local -n _order="$3"
  if [[ "$addr" == 127.* ]] || [[ -z "$addr" ]]; then
    return 0
  fi
  if [[ -n "${_seen[$addr]:-}" ]]; then
    return 0
  fi
  _seen[$addr]=1
  _order+=("$addr")
}

declare -A PANEL_SEEN=()
PANEL_ORDER=()

if command -v ip >/dev/null 2>&1; then
  while read -r iface cidr _rest; do
    [[ -z "${iface:-}" || -z "${cidr:-}" ]] && continue
    if panel_iface_skip "$iface"; then
      continue
    fi
    addr="${cidr%%/*}"
    panel_add_ip "$addr" PANEL_SEEN PANEL_ORDER
  done < <(ip -4 -o addr show 2>/dev/null | awk '{print $2, $4}')
fi

if command -v hostname >/dev/null 2>&1; then
  for addr in $(hostname -I 2>/dev/null); do
    # hostname -I suele incluir IPs de bridges Docker; omitir gateways típicos 172.x.0.1 en /16
    if [[ "$addr" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\.0\.1$ ]]; then
      continue
    fi
    panel_add_ip "$addr" PANEL_SEEN PANEL_ORDER
  done
fi

echo "Acceso al panel (puerto ${PORT}):"
echo "http://127.0.0.1:${PORT}/"
if ((${#PANEL_ORDER[@]} > 0)); then
  echo "Red / VPN / túneles:"
  for addr in "${PANEL_ORDER[@]}"; do
    echo "http://${addr}:${PORT}/"
  done
else
  echo "(no se detectaron IPv4 globales además de localhost; comprueba interfaces con: ip -4 addr)"
fi
