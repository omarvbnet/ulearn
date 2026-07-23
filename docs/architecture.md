# U Learn – System Architecture

## Overview

U Learn is an enterprise-grade multi-country LMS SaaS platform for school/university students and professionals seeking experience certificates. Content is pre-recorded only (no live streaming).

## Stack

| Layer | Technology |
|-------|------------|
| Web (Admin, Teacher, Student portals) | Next.js 16 (App Router) + TypeScript |
| Mobile (Android & iOS) | Flutter |
| API | Next.js Route Handlers + Server Actions |
| ORM | Prisma 6 |
| Database | PostgreSQL |
| File storage | Cloudflare R2 (S3-compatible) |
| Hosting | Vercel (web/API) |
| Push notifications | Firebase Cloud Messaging |
| Email | Resend |
| Auth | WhatsApp OTP + JWT sessions |

## High-Level Architecture

```
┌─────────────┐   ┌─────────────┐
│ Flutter App │   │  Next.js Web│
│ Android/iOS │   │ Admin/Teacher│
└──────┬──────┘   │   Student   │
       │          └──────┬──────┘
       │   HTTPS/JSON    │
       └────────┬────────┘
                ▼
        ┌───────────────┐
        │ Next.js API   │
        │ Route Handlers│
        └───────┬───────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌──────────┐
│Prisma  │ │   R2   │ │ Resend / │
│Postgres│ │ Files  │ │ FCM / WA │
└────────┘ └────────┘ └──────────┘
```

## Service Layer (Clean Architecture)

All business logic lives under `apps/web/src/services/`:

| Service | Responsibility |
|---------|----------------|
| `AuthService` | OTP, registration, approval, suspension, inactivity |
| `CourseService` | Stages → subjects → chapters → lessons → content |
| `VideoService` | Progress, resume, intro/outro injection |
| `QuizService` | Lesson/chapter/final quizzes, attempts, scoring |
| `SubscriptionService` | Packages, activation requests/codes, expiry (15 Jul) |
| `CertificateService` | Eligibility, generation, QR verification |
| `NotificationService` | Push, email, in-app; targeted broadcasts |
| `AnalyticsService` | Dashboards, rankings, student insights |
| `LoggingService` | Audit trail (actor, entity, before/after, IP) |

API routes are thin adapters: validate input (Zod) → call service → return JSON.

## Multi-Country & Multi-Language

- Every educational entity is scoped by `countryId`.
- Locales: `AR` (RTL), `KU` (RTL), `TR` (LTR), `EN` (LTR).
- Content fields use `nameEn`, `nameAr`, `nameKu`, `nameTr` (and equivalents).
- Web routes are prefixed with `/{locale}/`.

## RBAC

| Role | Access |
|------|--------|
| `SUPER_ADMIN` | Full platform |
| `COUNTRY_ADMIN` | Single country |
| `TEACHER` | Assigned subjects, Q&A, analytics |
| `STUDENT` | Free + subscribed content |
| `CERTIFICATE_USER` | Certificate programs |

Middleware and `requireAuth(roles)` enforce permissions on APIs.

## Auth Flow

1. User enters phone → OTP sent via WhatsApp.
2. OTP verified.
3. Existing approved user → home.
4. Existing pending user → pending screen.
5. New user → registration form → status `PENDING`.
6. Admin approves → free lessons only until subscription.

## Subscription Flow

1. Student selects package → activation request.
2. Admin reviews → generates activation code (manual or auto-notify).
3. Student enters code → subscription `ACTIVE`.
4. Default expiry: **15 July** each year (configurable; certificate users can be excluded).

## Video Protection (Mobile)

- Android: `FLAG_SECURE` / `ScreenProtector`
- iOS: screenshot detection → black overlay
- Casting (TV / AirPlay / HDMI / mirroring): dynamic moving watermark with name, national ID, phone, datetime

## Whiteboard Lessons (Store courses)

Isolated modality alongside VIDEO on `CourseLesson` (`lessonType`). Teachers record mic + vector board events into a `.ubrd` package uploaded to R2 (`whiteboards/…`). Students play via Whiteboard Player (Flutter + Web). Spec: [`docs/whiteboard/UBRD_SPEC.md`](whiteboard/UBRD_SPEC.md). Video pipeline is unchanged. Admins can enable/disable creation via System Setting `whiteboard_lessons_enabled` on the Admin Settings page (existing lessons remain playable when off).

## Scalability Notes

- Soft deletes (`deletedAt`) on core entities
- Indexed foreign keys and status fields
- Stateless JWT sessions (cookie-based for web)
- R2 for media (no binary in Postgres)
- Rate limiting on OTP endpoints
- Ready for Redis caching layer on read-heavy course trees
