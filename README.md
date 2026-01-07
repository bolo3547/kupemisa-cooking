# Fleet Oil Level Monitoring System

A production-ready IoT system for monitoring 20+ oil tanks with ESP32 devices, featuring a Notion-style dashboard, real-time telemetry, alerts, and remote pump control.

## File Tree

```
/fleet-oil-system
|-- /cloud/web                      # Next.js App Router + TypeScript
|   |-- /app
|   |   |-- /api
|   |   |   |-- /auth/[...nextauth] # NextAuth endpoints
|   |   |   |-- /devices            # Device listing & details APIs
|   |   |   |-- /device/commands    # Device command pull & ack
|   |   |   |-- /health             # Health check endpoint
|   |   |   |-- /ingest             # Telemetry & event ingestion
|   |   |   `-- /owner              # Owner-only APIs (provisioning, commands)
|   |   |-- /dashboard
|   |   |   |-- /devices/[deviceId] # Device detail page with charts
|   |   |   |-- /provision          # Add tank provisioning page
|   |   |   |-- layout.tsx
|   |   |   `-- page.tsx            # Dashboard overview
|   |   |-- /login
|   |   |   `-- page.tsx            # Login page
|   |   |-- globals.css
|   |   |-- layout.tsx
|   |   |-- page.tsx                # Landing page
|   |   `-- providers.tsx
|   |-- /components/ui              # shadcn/ui components
|   |   |-- alert-dialog.tsx
|   |   |-- badge.tsx
|   |   |-- button.tsx
|   |   |-- card.tsx
|   |   |-- input.tsx
|   |   |-- label.tsx
|   |   |-- select.tsx
|   |   |-- textarea.tsx
|   |   |-- toast.tsx
|   |   |-- toaster.tsx
|   |   `-- use-toast.ts
|   |-- /lib
|   |   |-- alerts.ts               # Email/SMS alerting
|   |   |-- auth.ts                 # Auth helpers
|   |   |-- device-auth.ts          # Device API key verification
|   |   |-- prisma.ts               # Prisma client singleton
|   |   |-- rate-limit.ts           # In-memory rate limiter
|   |   |-- utils.ts                # Utility functions
|   |   `-- validations.ts          # Zod schemas
|   |-- /prisma
|   |   |-- schema.prisma           # Database schema
|   |   `-- seed.ts                 # Seed script
|   |-- /scripts
|   |   `-- smoke-test.ts           # Smoke test script
|   |-- /types
|   |   `-- next-auth.d.ts          # NextAuth type augmentation
|   |-- .env.example
|   |-- components.json             # shadcn/ui config
|   |-- middleware.ts               # Route protection
|   |-- next.config.js
|   |-- package.json
|   |-- postcss.config.js
|   |-- tailwind.config.ts
|   `-- tsconfig.json
|-- /firmware/esp32_oil_node
|   `-- esp32_oil_node.ino          # Complete ESP32 firmware
|-- /docs
|   |-- architecture.md             # System architecture
|   `-- imbra-deploy.md             # Deployment guide
|-- .gitignore
`-- README.md
```


## Tech Stack

- **Cloud**: Next.js 14 (App Router) + TypeScript
- **Database**: MySQL + Prisma ORM
- **Auth**: NextAuth.js with Credentials + RBAC (OWNER/VIEWER)
- **UI**: Tailwind CSS + shadcn/ui (Notion-style)
- **Charts**: Recharts
- **Alerts**: Nodemailer SMTP + SMS hook placeholder
- **Firmware**: ESP32-WROOM-32 (Arduino)

## Local Development Setup

### Prerequisites

- Node.js 18+
- MySQL 8.0+ running locally
- Git

### 1. Install Dependencies

```bash
cd fleet-oil-system/cloud/web
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your MySQL credentials:
```env
DATABASE_URL="mysql://root:yourpassword@localhost:3306/oil_fleet"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="dev-secret-change"
APP_BASE_URL="http://localhost:3000"
```

### 3. Setup Database

```bash
# Create the database first in MySQL
mysql -u root -p -e "CREATE DATABASE oil_fleet;"

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed the database
npx prisma db seed
```

### 4. Run Development Server

```bash
npm run dev
```

Visit http://localhost:3000

### 5. Login Credentials

- **OWNER**: admin@denuel.local / Admin123!
- **VIEWER**: viewer@denuel.local / Viewer123!

## API Endpoints

### Device APIs (API Key Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ingest/telemetry` | Submit telemetry data |
| POST | `/api/ingest/event` | Submit events |
| GET | `/api/device/commands/pull` | Pull pending commands |
| POST | `/api/device/commands/ack` | Acknowledge command |

### Owner APIs (Session Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List all devices |
| GET | `/api/devices/[deviceId]` | Get device details |
| GET | `/api/devices/[deviceId]/telemetry` | Get telemetry history |
| POST | `/api/owner/devices` | Provision new device |
| POST | `/api/owner/devices/[deviceId]/commands` | Send command |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | System health check |

## Smoke Test

```bash
cd cloud/web
npm run smoke-test
```

## ESP32 Setup

1. Open `/firmware/esp32_oil_node/esp32_oil_node.ino` in Arduino IDE
2. Install required libraries:
   - ArduinoJson (v6+)
   - WiFi (built-in)
   - WebServer (built-in)
   - Preferences (built-in)
   - WiFiClientSecure (built-in)
3. Flash to ESP32-WROOM-32
4. Connect to WiFi AP: `oil-system` / `12345678`
5. Open http://192.168.4.1 and enter provisioning data
6. Or paste the JSON from the dashboard provision page

## Deployment to Imbra

See [docs/imbra-deploy.md](docs/imbra-deploy.md) for detailed instructions.

## License

MIT License - Denuel Inambao
