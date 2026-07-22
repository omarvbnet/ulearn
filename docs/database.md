# U Learn – Database Design

PostgreSQL schema managed by Prisma (`apps/web/prisma/schema.prisma`).

## Design Principles

- Normalized relationships with clear ownership
- Multi-country via `Country` / `Province`
- Soft deletes (`deletedAt`) on content and users
- Full audit log (`AuditLog`)
- Indexes on status, foreign keys, and activity fields for scale

## Core Domains

### Geography
`Country` → `Province`

### Identity
`User` (roles, status, locale, location)  
`StudentProfile` | `CertificateProfile` | `TeacherProfile`  
`OtpCode`, `Session`, `Device`

### Curriculum (country-specific)
```
Country
  └── EducationalStage
        └── Subject
              └── Chapter
                    └── Lesson
                          └── LessonContent (VIDEO | PDF | ATTACHMENT)
```

### Commerce
`SubscriptionPackage` (SINGLE_SUBJECT | FULL_STAGE | CERTIFICATE_PROGRAM)  
`ActivationRequest` → `ActivationCode` → `Subscription`

### Learning
`VideoProgress`, `DailyActivity`  
`Quiz` → `QuizQuestion` → `QuizAttempt`  
`LessonQuestion` → `LessonAnswer`

### Credentials
`Certificate` (number, verification code, QR payload)

### Comms & Ops
`Notification` → `UserNotification`  
`IntroOutro` (per locale)  
`SystemSetting`  
`AuditLog`  
`TeacherRating`, `Complaint`

## Key Enums

- **UserRole:** SUPER_ADMIN, COUNTRY_ADMIN, TEACHER, STUDENT, CERTIFICATE_USER
- **UserStatus:** PENDING, APPROVED, SUSPENDED, REJECTED, INACTIVE
- **SubscriptionStatus:** PENDING, ACTIVE, EXPIRED, CANCELLED
- **Locale:** AR, KU, TR, EN

## Soft Delete Pattern

Queries filter `deletedAt: null`. Hard deletes are avoided for users and curriculum.

## Seed Data

```bash
cd apps/web
cp .env.example .env   # set DATABASE_URL
npx prisma db push
npm run db:seed
```

Super Admin phone: `+9647000000001`
