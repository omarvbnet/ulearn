# U Learn Video Architecture

Direct-upload video pipeline for Vercel + Cloudflare R2. **No Railway, no external workers, no Docker transcoders, no HLS.**

## Stack

| Layer | Technology |
|-------|------------|
| API | Next.js App Router (Vercel) |
| Database | PostgreSQL + Prisma (metadata only) |
| Storage | Private Cloudflare R2 bucket |
| Delivery | Cloudflare CDN + signed URLs |
| Mobile upload/process | Flutter + FFmpeg (on-device) |
| Web upload/process | Browser WebCodecs (mediabunny) |

## Principles

1. **Video bytes never pass through Next.js** — only signed URLs and JSON metadata.
2. **One delivery file** — `delivery.mp4` (H.264/AAC, up to 1080p, faststart).
3. **Watermark is burned in at upload time** on the client (not a player overlay).
4. **Casting** may show an additional animated viewer overlay; the stored file already contains the platform watermark.

## Upload Flow

```
Teacher (Flutter / Web)
    → POST /api/videos/upload-url   (auth + validation)
    → PUT  signed URL → R2          (direct)
    → POST /api/videos/complete     (head object + metadata)
    → POST lesson API               (link videoAssetId + fileKey)
```

### API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/videos/upload-url` | Create `VideoAsset` + signed PUT URL |
| POST | `/api/videos/complete` | Verify R2 object + mark `READY` |
| GET | `/api/videos/{id}` | Signed playback URL |
| POST | `/api/videos/{id}/refresh` | Refresh expiring playback URL |
| GET/PATCH | `/api/videos/watermark-config` | Watermark settings for client burn-in |
| GET/PATCH | `/api/admin/video-watermark` | Admin dashboard watermark settings |

## Playback Flow

```
Student app / Web
    → GET /api/videos/{id} or lesson playback helper
    → Signed URL (short-lived)
    → Cloudflare CDN → R2
```

Supports HTTP range requests, resume, speed control, PiP, and subtitles via standard `<video>` / `video_player`.

## Database (`VideoAsset`)

Stores metadata only:

- `objectKey` — e.g. `videos/{courseId}/{videoId}/delivery.mp4`
- `fileSize`, `durationSec`, `width`, `height`
- `videoCodec`, `audioCodec`
- `watermarkApplied`, `processingStatus`
- Relations: `courseId`, `courseLessonId`, `uploadedById`

## Security

- Private R2 bucket
- Signed upload/download URLs with short TTL
- Role-based auth on all video APIs
- Course ownership / purchase checks before playback
- File type + size validation at presign
- Rate limiting on upload-url
- Opaque object keys (UUID paths)

## Environment (Vercel)

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=          # CDN origin (not public bucket listing)
VIDEO_PLAYBACK_EXPIRES_SEC=600
```

## Removed (do not reintroduce)

- Railway / Fly.io / Render video workers
- `apps/watermark-worker`, `apps/video-worker`
- HLS / DASH / multi-bitrate transcoding
- Server-side FFmpeg on Vercel
- Queue workers for video processing

## Mobile Processing

`VideoProcessService` (FFmpeg on device):

- Scale to max 1080p
- Burn semi-transparent watermark (config from API)
- H.264 + AAC, `-movflags +faststart`

`VideoUploadService` orchestrates presign → PUT → complete.

## Web Processing

`video-compress.ts` (mediabunny) re-encodes large files to 1080p H.264/AAC before upload. Admin watermark opacity/size from `/api/admin/video-watermark`.
