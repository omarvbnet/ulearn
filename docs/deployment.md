# U Learn – Production Deployment Guide

## Prerequisites

- PostgreSQL 15+ (Neon, Supabase, RDS, or managed Postgres)
- Cloudflare R2 bucket + API tokens
- WhatsApp OTP provider credentials
- Resend API key + verified domain
- Firebase project (FCM)
- Vercel account
- Apple Developer + Google Play accounts (mobile)

## 1. Database

```bash
# Create database, then:
cd apps/web
cp .env.example .env
# Set DATABASE_URL and JWT_SECRET

npx prisma migrate dev --name init
# or for production:
npx prisma migrate deploy
npm run db:seed
```

## 2. Environment Variables (Vercel)

Set all keys from `.env.example` in the Vercel project:

| Variable | Required |
|----------|----------|
| `DATABASE_URL` | Yes |
| `JWT_SECRET` | Yes |
| `NEXT_PUBLIC_APP_URL` | Yes |
| `R2_*` | Yes (media) |
| `WHATSAPP_*` | Yes (auth) |
| `RESEND_API_KEY` | Recommended |
| `FCM_SERVER_KEY` | Recommended |
| `DEV_OTP` | **No** (dev only) |

## 3. Deploy Web / API to Vercel

```bash
cd apps/web
npx vercel --prod
```

Or connect the GitHub repo in Vercel UI:

- Root directory: `apps/web`
- Build command: `prisma generate && next build`
- Install command: `npm install`
- Output: Next.js default

Add a cron job (Vercel Cron) for daily tasks:

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/expire-subscriptions", "schedule": "0 1 * * *" },
    { "path": "/api/cron/mark-inactive", "schedule": "0 2 * * *" }
  ]
}
```

Wire cron routes to `SubscriptionService.expireDueSubscriptions()` and `AuthService.markInactiveUsers(days)`.

## 4. Cloudflare R2

1. Create bucket `ulearn`
2. Enable public access or signed URLs
3. Create API token with Object Read/Write
4. Set CORS for upload origins (web + mobile)

## 5. Flutter Mobile

```bash
cd apps/mobile
flutter pub get

# Android
flutter build appbundle \
  --dart-define=API_BASE_URL=https://your-domain.vercel.app

# iOS
flutter build ipa \
  --dart-define=API_BASE_URL=https://your-domain.vercel.app
```

### Android security

Ensure `FLAG_SECURE` is applied during video playback (implemented via `screen_protector` + optional MethodChannel `ulearn/security`).

### iOS

Enable screenshot protection APIs used by `screen_protector`. Configure background modes for FCM if needed.

### Firebase

1. Add `google-services.json` (Android) and `GoogleService-Info.plist` (iOS)
2. Register FCM tokens via user profile update API

## 6. Post-Deploy Checklist

- [ ] Super admin can log in via OTP
- [ ] Approve a test student
- [ ] Free lesson plays with progress save
- [ ] Activation request → code → active subscription
- [ ] Certificate verification page works
- [ ] Excel export downloads
- [ ] RTL locales (ar, ku) render correctly
- [ ] R2 uploads succeed
- [ ] Emails send via Resend
- [ ] Push notifications deliver

## 7. Security Hardening

- Rotate `JWT_SECRET` regularly
- Never commit `.env`
- Enable Vercel WAF / rate limits at edge
- Restrict admin routes by role (already enforced)
- Use signed R2 URLs for private videos
- Monitor `AuditLog` for sensitive actions

## 8. Scaling Path

1. Add Redis for course tree cache and rate limits
2. Move long jobs (certificate PDF, bulk notifications) to a queue worker
3. Read replicas for analytics queries
4. CDN in front of R2 public assets
