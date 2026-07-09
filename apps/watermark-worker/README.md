# U Learn Watermark Worker

Burns viewer name + national ID into course videos with **ffmpeg**.  
Use this because **Vercel cannot run ffmpeg** (no binary, short timeouts, small `/tmp`).

Deploy on [Railway](https://railway.app), [Fly.io](https://fly.io), or any Docker host.

## Deploy on Railway

1. Create a new Railway project from this folder (`apps/watermark-worker`).
2. Set environment variables (same R2 creds as the web app):

   | Variable | Description |
   |----------|-------------|
   | `R2_ENDPOINT` | Cloudflare R2 S3 endpoint |
   | `R2_ACCESS_KEY_ID` | R2 access key |
   | `R2_SECRET_ACCESS_KEY` | R2 secret |
   | `R2_BUCKET` | Bucket name (e.g. `ulearn`) |
   | `WATERMARK_SERVICE_SECRET` | Random secret shared with Vercel |

3. Deploy. Copy the public URL (e.g. `https://ulearn-watermark.up.railway.app`).

## Configure Vercel

In your Vercel project → Settings → Environment Variables:

```
WATERMARK_SERVICE_URL=https://your-worker.up.railway.app
WATERMARK_SERVICE_SECRET=same-secret-as-worker
```

Redeploy the web app. The API routes `/api/store/lessons/[id]/watermarked-url` will call the worker.

## Chromecast (no worker required)

Your Vercel app already hosts a custom Cast receiver:

```
https://YOUR-VERCEL-DOMAIN/cast-receiver/index.html
```

1. Register it at [Google Cast SDK Console](https://cast.google.com/publish).
2. Copy the **Application ID**.
3. Set in `apps/mobile/android/gradle.properties`:

   ```
   CAST_RECEIVER_APP_ID=YOUR_APP_ID
   ```

4. Rebuild the Android app.

This shows the viewer watermark on the TV for Chromecast **without ffmpeg**.

## Health check

`GET /health` → `{ "ok": true }`
