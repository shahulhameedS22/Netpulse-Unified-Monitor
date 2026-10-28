#!/usr/bin/env bash
# Regional Ping Push Agent - installer for one regional VM (Ubuntu/Debian with systemd)
#
# Usage:   sudo bash install-agent.sh <REGION> [DASHBOARD_URL]
#          REGION = IN-DC01 | IN-DC02 | LK-DC01 | SG-DC01
# Needs:   push-agent.cjs in the SAME folder as this script, and Node.js 18 or newer.
# Effect:  installs the agent to /opt/ping-agent, creates the service user "pingagent",
#          creates /etc/ping-agent.env with a NEW secret key (shown once), and starts the
#          "ping-agent" service. Re-running updates the agent and keeps the existing key.
set -euo pipefail

REGION="${1:-}"
URL="${2:-https://ping-monitoring-demo-app.vercel.app}"
ROOT="${PINGAGENT_TEST_ROOT:-}"          # for testing the script only; empty on a real VM
ETC="$ROOT/etc"; OPT="$ROOT/opt/ping-agent"; UNIT_DIR="$ROOT/etc/systemd/system"
ENV_FILE="$ETC/ping-agent.env"; UNIT="$UNIT_DIR/ping-agent.service"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

case "$REGION" in IN-DC01|IN-DC02|LK-DC01|SG-DC01) ;; *) die "Usage: sudo bash install-agent.sh <IN-DC01|IN-DC02|LK-DC01|SG-DC01> [DASHBOARD_URL]" ;; esac
case "$URL" in https://*) ;; *) die "DASHBOARD_URL must start with https://" ;; esac
[ -n "$ROOT" ] || [ "$(id -u)" -eq 0 ] || die "Run this script with sudo."
[ -f "$HERE/push-agent.cjs" ] || die "push-agent.cjs must be in the same folder as this script ($HERE)."

command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node.js 20 first (see the guide), then run this script again."
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18 or newer is required (found $(node -v))."
NODE_BIN="$(command -v node)"

if [ -z "$ROOT" ] && ! command -v ping >/dev/null 2>&1; then
  info "ping is missing; installing iputils-ping"
  command -v apt-get >/dev/null 2>&1 || die "Please install the 'ping' command (iputils-ping) and run again."
  apt-get install -y iputils-ping >/dev/null
fi

info "Installing the agent to $OPT"
[ -n "$ROOT" ] || id pingagent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin pingagent
mkdir -p "$OPT" "$ETC" "$UNIT_DIR"
install -m 644 "$HERE/push-agent.cjs" "$OPT/push-agent.cjs"

NEW_KEY=""
if [ -f "$ENV_FILE" ]; then
  info "Existing $ENV_FILE found: keeping the current key (delete that file to create a new key)"
else
  if command -v openssl >/dev/null 2>&1; then NEW_KEY="$(openssl rand -hex 32)"
  else NEW_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi
  [ "${#NEW_KEY}" -eq 64 ] || die "Could not generate a key."
  ( umask 077; printf 'AGENT_URL=%s\nAGENT_KEY=%s\n' "$URL" "$NEW_KEY" > "$ENV_FILE" )
  [ -n "$ROOT" ] || chown root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

info "Writing the service file"
cat > "$UNIT" << UNITEOF
[Unit]
Description=Regional Ping Push Agent ($REGION)
After=network-online.target
Wants=network-online.target

[Service]
User=pingagent
EnvironmentFile=/etc/ping-agent.env
ExecStart=$NODE_BIN /opt/ping-agent/push-agent.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF

if [ -z "$ROOT" ]; then
  info "Checking that ping works for the service user"
  if runuser -u pingagent -- ping -c 2 -W 3 8.8.8.8 >/dev/null 2>&1; then echo "    ping to 8.8.8.8 works"
  else echo "    WARNING: ping to 8.8.8.8 failed. Ask the network team to allow outbound ICMP to 8.8.8.8 from this VM."; fi

  info "Starting the service"
  systemctl daemon-reload
  systemctl enable ping-agent >/dev/null 2>&1
  systemctl restart ping-agent
  sleep 5
  echo "    service state: $(systemctl is-active ping-agent || true)"
  journalctl -u ping-agent -n 8 --no-pager 2>/dev/null | sed 's/^/    /' || true
fi

VAR="AGENT_KEY_${REGION//-/_}"
echo
echo "================================================================"
echo " Agent installed for region: $REGION"
if [ -n "$NEW_KEY" ]; then
  echo
  echo " NEXT STEP - add this in Vercel (Settings > Environment Variables):"
  echo "     Name : $VAR"
  echo "     Value: $NEW_KEY"
  echo
  echo " This key is shown only now. Copy it, then redeploy the project in Vercel."
  echo " (It is also stored in $ENV_FILE, readable by root only.)"
else
  echo " The existing key in $ENV_FILE was kept. Its Vercel variable is $VAR."
fi
echo "================================================================"
