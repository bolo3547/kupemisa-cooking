# Fleet Oil Level Monitoring System - Architecture

## Overview

A robust IoT system for monitoring and controlling 20+ oil tanks, with real-time telemetry, alerts, and remote pump control. Runs locally and deploys to Imbra cloud.

## System Diagram

```
+-----------------+     +---------------------+     +-------------------+
|   ESP32 Node    | --> | Next.js Cloud API   | --> |   Dashboard UI    |
|   (per tank)    |     | (App Router, TS)    |     |   (OWNER/VIEWER)  |
+-----------------+     +---------------------+     +-------------------+
                           |
                           v
                      +-----------+
                      |  MySQL DB |
                      +-----------+
```

- ESP32 Node: Measures oil level (ultrasonic), flow (sensor), controls pump, and communicates with the cloud.
- Next.js Cloud: Handles device ingest, owner APIs, authentication, alerting, and command queue.
- Dashboard UI: Notion-style, real-time tank status, charts, events, and controls.
- MySQL DB: Stores users, devices, telemetry, events, commands, and alert rules.

## Data Flow

1. Device -> Cloud: ESP32 posts telemetry/events via secure API key.
2. Cloud -> DB: Data is validated, stored, and triggers alert evaluation.
3. Dashboard: Owner logs in, views all tanks, charts, and events.
4. Remote Commands: Owner issues command; device pulls and acknowledges.

## Security

- Device API key (bcrypt hash, never stored in plain text)
- Operator PINs stored as hashes (bcrypt for dashboard, SHA-256 for device sync)
- NextAuth credentials + RBAC (OWNER/VIEWER)
- All device commands are PULL (NAT-safe)
- Alerts via SMTP/email, SMS hook placeholder

## Key Features

- Real-time tank grid (20+)
- Notion-style UI (neutral, soft, whitespace)
- Charts (Recharts)
- Alerts (email, SMS placeholder)
- Device provisioning (QR, JSON)
- Remote pump control (safe)
- Health check and smoke test

## Deployment

- Local: Runs on localhost:3000
- Imbra: Set env vars, run migrate+seed, build+start
- GitHub -> Imbra CI/CD

---

See [docs/imbra-deploy.md](imbra-deploy.md) for deployment steps.
