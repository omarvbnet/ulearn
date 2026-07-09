package com.ulearn.mobile

import android.app.Activity
import android.util.Log
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManager
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import androidx.mediarouter.app.MediaRouteChooserDialog
import io.flutter.plugin.common.EventChannel

class CastManager(
    private val activity: Activity,
    private val onCastingChanged: (Boolean) -> Unit,
) {
    private val tag = "ULearnCast"
    private var castContext: CastContext? = null
    private var pendingUrl: String? = null
    private var pendingTitle: String? = null
    private var pendingWatermark: String? = null
    private var pendingPositionMs: Int = 0

    private val sessionListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) = Unit
        override fun onSessionStarted(session: CastSession, sessionId: String) {
            loadPendingMedia(session)
            onCastingChanged(true)
        }

        override fun onSessionStartFailed(session: CastSession, error: Int) {
            onCastingChanged(false)
        }

        override fun onSessionEnding(session: CastSession) = Unit
        override fun onSessionEnded(session: CastSession, error: Int) {
            onCastingChanged(false)
        }

        override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
            loadPendingMedia(session)
            onCastingChanged(true)
        }

        override fun onSessionSuspended(session: CastSession, reason: Int) {
            onCastingChanged(false)
        }

        override fun onSessionResumed(session: CastSession, sessionId: String) = Unit
    }

    fun initialize() {
        try {
            castContext = CastContext.getSharedInstance(activity)
            sessionManager()?.addSessionManagerListener(sessionListener, CastSession::class.java)
        } catch (e: Exception) {
            Log.w(tag, "Cast init failed", e)
        }
    }

    fun dispose() {
        try {
            sessionManager()?.removeSessionManagerListener(sessionListener, CastSession::class.java)
        } catch (_: Exception) {
        }
    }

    fun isAvailable(): Boolean = castContext != null

    fun isCasting(): Boolean = sessionManager()?.currentCastSession?.isConnected == true

    fun showDevicePicker() {
        try {
            val selector = castContext?.mergedSelector ?: return
            MediaRouteChooserDialog(activity).apply {
                routeSelector = selector
                show()
            }
        } catch (e: Exception) {
            Log.w(tag, "showDevicePicker failed", e)
        }
    }

    fun castVideo(url: String, title: String, watermark: String, positionMs: Int): Boolean {
        pendingUrl = url
        pendingTitle = title
        pendingWatermark = watermark
        pendingPositionMs = positionMs

        val session = sessionManager()?.currentCastSession
        return if (session != null && session.isConnected) {
            loadPendingMedia(session)
            true
        } else {
            showDevicePicker()
            false
        }
    }

    fun stopCast() {
        try {
            sessionManager()?.endCurrentSession(true)
        } catch (_: Exception) {
        }
        onCastingChanged(false)
    }

    private fun sessionManager(): SessionManager? = castContext?.sessionManager

    private fun loadPendingMedia(session: CastSession) {
        val url = pendingUrl ?: return
        val title = pendingTitle ?: "U Learn"
        val watermark = pendingWatermark ?: ""

        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
            putString(MediaMetadata.KEY_TITLE, title)
            putString(MediaMetadata.KEY_SUBTITLE, watermark)
            putString(MediaMetadata.KEY_ARTIST, watermark)
            if (watermark.isNotBlank()) {
                putString(MediaMetadata.KEY_SERIES_TITLE, watermark)
            }
        }

        val contentType = when {
            url.contains(".m3u8", ignoreCase = true) -> "application/x-mpegURL"
            url.contains(".mpd", ignoreCase = true) -> "application/dash+xml"
            else -> "video/mp4"
        }

        val mediaInfo = MediaInfo.Builder(url)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(contentType)
            .setMetadata(metadata)
            .build()

        val client: RemoteMediaClient = session.remoteMediaClient ?: return
        client.load(
            com.google.android.gms.cast.MediaLoadRequestData.Builder()
                .setMediaInfo(mediaInfo)
                .setAutoplay(true)
                .setCurrentTime(pendingPositionMs.toLong())
                .build(),
        )
        onCastingChanged(true)
    }
}

class CastEventSink : EventChannel.StreamHandler {
    var sink: EventChannel.EventSink? = null

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        sink = events
    }

    override fun onCancel(arguments: Any?) {
        sink = null
    }

    fun emitCasting(casting: Boolean) {
        sink?.success(casting)
    }
}
