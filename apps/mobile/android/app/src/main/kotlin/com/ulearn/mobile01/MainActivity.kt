package com.ulearn.mobile01

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val securityChannel = "ulearn/security"
    private val castChannel = "ulearn/cast"
    private val castEvents = "ulearn/cast_events"

    private var castManager: CastManager? = null
    private val castEventSink = CastEventSink()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, securityChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "enableSecureFlag" -> {
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        result.success(true)
                    }
                    "disableSecureFlag" -> {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }

        castManager = CastManager(this) { casting ->
            castEventSink.emitCasting(casting)
        }.also { it.initialize() }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, castEvents)
            .setStreamHandler(castEventSink)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, castChannel)
            .setMethodCallHandler { call, result ->
                val manager = castManager
                when (call.method) {
                    "isAvailable" -> result.success(manager?.isAvailable() == true)
                    "isCasting" -> result.success(manager?.isCasting() == true)
                    "castVideo" -> {
                        val url = call.argument<String>("url")
                        if (url.isNullOrBlank()) {
                            result.success(false)
                            return@setMethodCallHandler
                        }
                        val title = call.argument<String>("title") ?: "U Learn"
                        val watermark = call.argument<String>("watermark") ?: ""
                        val watermarkVttUrl = call.argument<String>("watermarkVttUrl")
                        val positionMs = call.argument<Int>("positionMs") ?: 0
                        val ok = manager?.castVideo(
                            url,
                            title,
                            watermark,
                            positionMs,
                            watermarkVttUrl,
                        ) == true
                        result.success(ok)
                    }
                    "showDevicePicker" -> {
                        manager?.showDevicePicker()
                        result.success(true)
                    }
                    "stopCast" -> {
                        manager?.stopCast()
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onDestroy() {
        castManager?.dispose()
        castManager = null
        super.onDestroy()
    }
}
