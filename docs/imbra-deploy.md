# Imbra Deployment Guide — Fleet Oil Level Monitoring System

## Prerequisites
- Imbra account and project
- MySQL database (Imbra managed or external)
- Node.js 18+ runtime
- GitHub repo (push your code)

## 1. Set Environment Variables

Create `.env.production` in `/cloud/web`:

```
DATABASE_URL="mysql://USER:PASS@HOST:3306/DB"
NEXTAUTH_URL="https://your-imbra-app.imbra.app"
NEXTAUTH_SECRET="<secure-random>"
APP_BASE_URL="https://your-imbra-app.imbra.app"
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_USER="alerts@example.com"
SMTP_PASS="your-smtp-password"
SMTP_TO="owner@example.com"
DEVICE_RATE_LIMIT_MS="2000"
```

## 2. Install Dependencies

```bash
cd cloud/web
npm install
```

## 3. Run Prisma Migrations & Seed

```bash
npx prisma migrate deploy
npx prisma db seed
```

## 4. Build & Start

```bash
npm run build
npm start
```

## 5. SSL & Testing
- Imbra provides SSL by default.
- Test `/api/health` endpoint for readiness.
- Run smoke test:

```bash
npx ts-node scripts/smoke-test.ts
```

## 6. Device Connectivity
- Ensure your Imbra app is reachable from ESP32 devices (public URL, SSL required).
- Update device provisioning JSON with the correct `apiBaseUrl`.

## 7. CI/CD (Optional)
- Connect GitHub repo to Imbra for auto-deploys.

---

For issues, see Imbra docs or contact support.
