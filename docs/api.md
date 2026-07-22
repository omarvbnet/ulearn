# U Learn – API Documentation

Base URL: `https://<your-domain>` (local: `http://localhost:3000`)

Auth: HTTP-only cookie `ulearn_session` (JWT). Mobile may send the same token via `Cookie` or `Authorization: Bearer`.

All errors: `{ "error": string, "code"?: string }`

---

## Authentication

### `POST /api/auth/otp/send`
Send WhatsApp OTP.

```json
{ "phone": "+9647XXXXXXXX" }
```

**Rate limit:** 5 / minute / phone+IP

### `POST /api/auth/otp/verify`
```json
{ "phone": "+9647XXXXXXXX", "code": "123456", "deviceId": "optional" }
```

Responses:
- New user: `{ "success": true, "isNewUser": true, "phone": "..." }`
- Pending: `{ "success": true, "isPending": true, "user": {...}, "token": "..." }`
- Approved: `{ "success": true, "user": {...}, "token": "..." }`

### `POST /api/auth/register`
Discriminated by `type`: `"STUDENT"` | `"CERTIFICATE"`

Student requires `parentPhone`. Both require `fullLegalName`, `gender`, `countryId`, `provinceId`, `nationalId`.

### `GET /api/auth/me`
Current user profile.

### `POST /api/auth/logout`
Destroy session.

---

## Geography

### `GET /api/countries`
Public list of countries with provinces.

---

## Courses (authenticated, approved)

### `GET /api/courses?stageId=`
Returns `{ stages, subjects }` for the user's country.

### `GET /api/lessons/:id`
Returns `{ lesson, progress, hasAccess, introOutro }`.

### `POST /api/video/progress`
```json
{
  "lessonId": "...",
  "positionSec": 120,
  "durationSec": 600,
  "watchedDeltaSec": 10
}
```

---

## Subscriptions

### `GET /api/subscriptions`
Packages + user subscriptions.

### `POST /api/subscriptions`
```json
{ "packageId": "..." }
```
Creates activation request.

### `POST /api/subscriptions/activate`
```json
{ "code": "XXXX-XXXX-XXXX" }
```

### `GET /api/admin/subscriptions/requests` (admin)
### `POST /api/admin/subscriptions/requests` (admin)
```json
{ "requestId": "...", "sendAutomatically": true }
```

---

## Admin

### `GET /api/admin/users?status=&role=&q=&page=&limit=`
### `POST /api/admin/users/:id/approve`
### `POST /api/admin/users/:id/suspend`
### `GET /api/admin/users/export` → Excel download
### `GET /api/admin/analytics?countryId=`

---

## Rankings

### `GET /api/rankings`
Top students, certificate users, scores, most active.

---

## Certificate Verification (public)

### Web: `GET /verify/:code`
Public certificate verification page.

---

## Service Methods (Server-side)

Additional capabilities are exposed via services and can be wired to routes as needed:

- `QuizService.getQuizForUser` / `submitAttempt`
- `CertificateService.generate` / `verify`
- `NotificationService.broadcast`
- `SubscriptionService.setGlobalExpiry` / `extendSubscription`
- `AuthService.markInactiveUsers`
- `CourseService.createStage|Subject|Chapter|Lesson|addContent`
- `LoggingService.getRecentLogs`
