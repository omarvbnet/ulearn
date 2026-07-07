# U Learn

Enterprise educational platform for school/university students and professionals seeking experience certificates.

**Stack:** Next.js · Flutter · Prisma · PostgreSQL · Cloudflare R2 · Vercel · FCM · Resend · WhatsApp OTP

![U Learn](./logo.png)

## Repository Structure

```
ulearn/
├── apps/
│   ├── web/          # Next.js – API, Admin, Teacher, Student portals
│   └── mobile/       # Flutter – Android & iOS
├── docs/             # Architecture, DB, ER, API, Deployment
└── logo.png
```

## Features

- WhatsApp OTP authentication & registration approval flow
- Multi-country curriculum (Stages → Subjects → Chapters → Lessons)
- Free lessons for approved users; paid packages (1 / 3 / custom devices)
- Activation codes with global expiry (15 July, configurable)
- Video progress, quizzes, rankings, Q&A
- Experience certificates with QR verification
- Admin & Teacher dashboards with analytics
- Arabic / Kurdish (RTL) · Turkish / English (LTR)
- Audit logging, soft deletes, RBAC
- Mobile video protection (FLAG_SECURE, screenshot block, casting watermark)

## Quick Start (Web)

```bash
cd apps/web
cp .env.example .env
# Set DATABASE_URL and JWT_SECRET

npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (redirects to `/ar`).

**Seed Super Admin phone:** `+9647000000001`  
**Dev OTP:** set `DEV_OTP=123456` in `.env` (also logged to console).

### Portals

| Portal | Path |
|--------|------|
| Landing | `/{locale}` |
| Login | `/{locale}/login` |
| Admin | `/{locale}/admin` |
| Teacher | `/{locale}/teacher` |
| Student | `/{locale}/student` |
| Verify certificate | `/verify/{code}` |

## Quick Start (Mobile)

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

Use your machine LAN IP for physical devices.

## Documentation

1. [System Architecture](./docs/architecture.md)
2. [Database Design](./docs/database.md)
3. [ER Diagram](./docs/er-diagram.md)
4. [API Documentation](./docs/api.md)
5. [Production Deployment](./docs/deployment.md)

## Services

| Service | Path |
|---------|------|
| Auth | `apps/web/src/services/auth.service.ts` |
| Course | `apps/web/src/services/course.service.ts` |
| Video | `apps/web/src/services/video.service.ts` |
| Quiz | `apps/web/src/services/quiz.service.ts` |
| Subscription | `apps/web/src/services/subscription.service.ts` |
| Certificate | `apps/web/src/services/certificate.service.ts` |
| Notification | `apps/web/src/services/notification.service.ts` |
| Analytics | `apps/web/src/services/analytics.service.ts` |
| Logging | `apps/web/src/services/logging.service.ts` |

## License

Proprietary – All rights reserved.
