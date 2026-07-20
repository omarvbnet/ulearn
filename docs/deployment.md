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
# Set DATABASE_URL, DIRECT_DATABASE_URL, and JWT_SECRET
#
# Important (Prisma Postgres):
# - DATABASE_URL may be pooled (`…@pooled.db.prisma.io`) OR Accelerate (`prisma://` / `prisma+postgres://`)
# - DIRECT_DATABASE_URL must be the *direct* host (`…@db.prisma.io`), not the pooled host
# - Query caching only works with an Accelerate URL; with pooled Postgres the app skips cacheStrategy automatically

npx prisma migrate deploy
npm run db:seed
```

### Prisma Accelerate vs pooled Postgres

| `DATABASE_URL` | Client | Caching | Generate |
|---|---|---|---|
| `postgres://…@pooled.db.prisma.io` | Query engine | Off (safe) | `prisma generate` (engine included) |
| `prisma://` / `prisma+postgres://` | Accelerate | `cacheStrategy` on hot reads | `prisma generate` (engine still included) |

We always ship the query engine so Admin → **Database Providers** can open temporary clients against Supabase / VPS `postgresql://` URLs. Generating with `--no-engine` makes Prisma reject those URLs (`must start with protocol prisma://`).

If you see `UnknownJsonError` on simple reads (e.g. `country.findMany`), either Accelerate cannot reach the DB (check console / plan / direct connectivity) or the app was sending `cacheStrategy` without a real Accelerate URL — the client now only enables Accelerate when the URL protocol is `prisma://` / `prisma+postgres://`.

## Database Providers (Admin)

Admin → **Database Providers** lets you register Prisma Postgres / Accelerate, Supabase, VPS, or custom Postgres hosts, then switch safely:

1. **Export backup** — full JSON dump of all tables from the live DB (keep this file safe)  
2. **Test connection** — verify the saved target URL responds  
3. **Transfer test** — seeds temporary tester data (user + device + setting + inactive ad) on the live DB, copies it to the target, verifies integrity, then cleans up. **Required before migrate** (pass valid 24h)  
4. **Migrate data here** — full copy into the target (optional wipe); re-runs transfer test after import  
5. **Compare counts** — spot-check key tables  
6. **Set env + redeploy** — the app cannot hot-swap `DATABASE_URL` in-process  
7. **Confirm activated** — mark the new provider as active in admin metadata  

Connection secrets are encrypted at rest (`DB_PROVIDER_SECRET` or `JWT_SECRET`). A mirror copy is written to `apps/web/.data/db-providers.json` (gitignored).

Always export a backup **before** switching. Target databases must already have the Prisma schema applied (`npx prisma migrate deploy` with `DIRECT_DATABASE_URL`). Do not change env until Transfer test + Migrate both succeed.


## 2. Environment Variables (Vercel)

Set all keys from `.env.example` in the Vercel project:

| Variable | Required |
|----------|----------|
| `DATABASE_URL` | Yes (Accelerate / Prisma Postgres URL in production) |
| `DIRECT_DATABASE_URL` | Yes when `DATABASE_URL` is `prisma://` (direct Postgres for migrations) |
| `PRISMA_ACCELERATE_URL` | Optional (only if `DATABASE_URL` stays as direct Postgres) |
| `JWT_SECRET` | Yes |
| `NEXT_PUBLIC_APP_URL` | Yes |
| `R2_*` | Yes (media) |
| `WHATSAPP_*` | Yes (auth) |
| `RESEND_API_KEY` | Recommended |
| `FIREBASE_PROJECT_ID` | Recommended (default `u-learn-5eb31`) |
| `FIREBASE_CLIENT_EMAIL` | Recommended (service account email) |
| `FIREBASE_PRIVATE_KEY` | Recommended (service account private key; escape newlines as `\n`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Optional alternative (full JSON of the service account key) |
| `DEV_OTP` | **No** (dev only) |

> Firebase no longer exposes a Cloud Messaging **server key**. Use a service account with the **Firebase Cloud Messaging API** and FCM HTTP v1 (see below).

### Firebase push (FCM HTTP v1)

1. Firebase Console → Project settings → **Service accounts** → Generate new private key  
2. Set either:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = entire JSON file contents, **or**
   - `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`  
3. Enable **Firebase Cloud Messaging API** in Google Cloud for that project  
4. For iOS: upload an **APNs Authentication Key** under Cloud Messaging  
5. Remove any old `FCM_SERVER_KEY` env var (unused)
6. **Critical for iOS:** Apple Developer → Keys → create a key with **Apple Push Notifications service (APNs)** → download `.p8` once → Firebase Console → Project settings → Cloud Messaging → Apple app (`com.ulearn.mobile`) → upload **APNs Authentication Key** (not a production-only .p12 certificate) + Key ID + Team ID (`28YT228VJ4`)

The Auth Key works for **both sandbox and production**. Local installs (`flutter run` / `flutter run --release`) register **sandbox** tokens. If Firebase only has a Production APNs certificate, sends fail with `BadEnvironmentKeyInToken`.

Without the APNs key, FCM can accept Android tokens but iOS sends fail with `THIRD_PARTY_AUTH_ERROR` even when a device token is stored.

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

# Android (production API https://ulearn.usmart-iot.com is the default)
flutter build appbundle

# iOS
flutter build ipa
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
