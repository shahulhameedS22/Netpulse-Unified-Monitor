# Authorized Regional Ping Daemon Deployment Guide

This directory provides the production-ready server daemon for the **Regional Ping Monitor**.

## Architectural Overview

To measure genuine latency and packet loss from each region, an authorized lightweight daemon must run inside each regional data center network:

- **IN-DC01**: Mumbai, Maharashtra (India) — Port 8080 (or 8001)
- **IN-DC02**: Chennai, Tamil Nadu (India) — Port 8080 (or 8002)
- **LK-DC01**: Colombo, Western Province (Sri Lanka) — Port 8080 (or 8003)
- **SG-DC01**: Jurong West (Singapore) — Port 8080 (or 8004)

### Security Features
- **No Shell Execution**: Uses `child_process.execFile('ping', args)` directly with argument arrays. No shell interpolation (`sh -c` or `cmd.exe`) is used.
- **Fixed Target**: Strictly locked to `8.8.8.8` (or validated IPv4).
- **Fixed Count**: Maximum 30 packets (`-c 30` on Linux, `-n 30` on Windows).
- **CORS Configured**: Allows dashboard browsers to dispatch POST `/ping` directly or via reverse proxy.

---

## 1. Quick Start (Standalone Node.js)

Run directly on any machine with Node.js 16+ or Bun installed (zero `npm install` needed):

```bash
# On IN-DC01 (Mumbai):
REGION_ID=IN-DC01 PORT=8080 node server/regional-ping-daemon.js

# On IN-DC02 (Chennai):
REGION_ID=IN-DC02 PORT=8080 node server/regional-ping-daemon.js

# On LK-DC01 (Colombo):
REGION_ID=LK-DC01 PORT=8080 node server/regional-ping-daemon.js

# On SG-DC01 (Singapore):
REGION_ID=SG-DC01 PORT=8080 node server/regional-ping-daemon.js
```

---

## 2. Production Deployment via systemd (Linux)

Create `/etc/systemd/system/regional-ping-daemon.service`:

```ini
[Unit]
Description=Regional Ping Daemon for Network Monitoring
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/regional-ping
Environment=NODE_ENV=production
Environment=PORT=8443
Environment=REGION_ID=IN-DC01
ExecStart=/usr/bin/node /opt/regional-ping/regional-ping-daemon.js
Restart=always
RestartSec=5
# Allow ICMP ping without root
AmbientCapabilities=CAP_NET_RAW

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable regional-ping-daemon
sudo systemctl start regional-ping-daemon
```

---

## 3. Production Deployment via Docker

```bash
docker run -d \
  --name ping-daemon-in-dc01 \
  --restart always \
  --cap-add=NET_RAW \
  -p 8080:8080 \
  -e REGION_ID=IN-DC01 \
  -e PORT=8080 \
  -v $(pwd)/server/regional-ping-daemon.js:/app/daemon.js \
  node:20-alpine node /app/daemon.js
```

---

## 4. API Endpoints

### `GET /health`
Validates daemon readiness and returns region info:
```json
{
  "status": "ok",
  "regionId": "IN-DC01",
  "platform": "linux",
  "uptimeSec": 420,
  "timestamp": "2026-10-21T21:30:00.000Z",
  "fixedTarget": "8.8.8.8",
  "fixedCount": 30
}
```

### `POST /ping`
Executes fixed ICMP ping (30 packets) to target `8.8.8.8`:
```json
{
  "targetIp": "8.8.8.8",
  "count": 30
}
```

Response:
```json
{
  "success": true,
  "regionId": "IN-DC01",
  "targetIp": "8.8.8.8",
  "requestsSent": 30,
  "successfulReplies": 30,
  "failedRequests": 0,
  "packetLossPercent": 0,
  "minLatencyMs": 11.4,
  "avgLatencyMs": 13.8,
  "maxLatencyMs": 18.2,
  "jitterMs": 1.2,
  "packets": [
    { "sequence": 1, "latencyMs": 12.1, "ttl": 118, "success": true }
  ],
  "executionDurationMs": 29420,
  "timestamp": "2026-10-21T21:30:30.000Z",
  "serverVersion": "1.2.0"
}
```
