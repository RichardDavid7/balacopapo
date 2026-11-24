package com.backspace.core.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

object VoiceServiceActions {
    const val ACTION_START = "com.backspace.voice.ACTION_START"
    const val ACTION_UPDATE = "com.backspace.voice.ACTION_UPDATE"
    const val ACTION_TOGGLE_MUTE = "com.backspace.voice.ACTION_TOGGLE_MUTE"
    const val ACTION_TOGGLE_DEAFEN = "com.backspace.voice.ACTION_TOGGLE_DEAFEN"
    const val ACTION_DISCONNECT = "com.backspace.voice.ACTION_DISCONNECT"

    const val EXTRA_CHANNEL_NAME = "extra_channel_name"
    const val EXTRA_SPACE_NAME = "extra_space_name"
    const val EXTRA_IS_MUTED = "extra_is_muted"
    const val EXTRA_IS_DEAFENED = "extra_is_deafened"
    const val EXTRA_IS_SCREEN_SHARING = "extra_is_screen_sharing"
    const val EXTRA_BITRATE_KBPS = "extra_bitrate_kbps"
}

/**
 * Callback bridge para permitir que os botões da notificação controlem o BackspaceVoiceEngine
 * sem criar acoplamento circular com `:app`.
 */
object VoiceServiceControllerBridge {
    @Volatile var onToggleMute: (() -> Unit)? = null
    @Volatile var onToggleDeafen: (() -> Unit)? = null
    @Volatile var onDisconnect: (() -> Unit)? = null
}

/**
 * ForegroundService estilo Mumble/Mumla: mantém o áudio LiveKit ativo em background
 * (tela apagada ou jogos) com ações rápidas na notificação.
 */
class VoiceForegroundService : Service() {

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            VoiceServiceActions.ACTION_TOGGLE_MUTE -> {
                VoiceServiceControllerBridge.onToggleMute?.invoke()
                return START_STICKY
            }
            VoiceServiceActions.ACTION_TOGGLE_DEAFEN -> {
                VoiceServiceControllerBridge.onToggleDeafen?.invoke()
                return START_STICKY
            }
            VoiceServiceActions.ACTION_DISCONNECT -> {
                VoiceServiceControllerBridge.onDisconnect?.invoke()
                stopSelf()
                return START_NOT_STICKY
            }
        }

        val channelName = intent?.getStringExtra(VoiceServiceActions.EXTRA_CHANNEL_NAME) ?: "Voice"
        val spaceName = intent?.getStringExtra(VoiceServiceActions.EXTRA_SPACE_NAME) ?: "Backspace"
        val isMuted = intent?.getBooleanExtra(VoiceServiceActions.EXTRA_IS_MUTED, false) ?: false
        val isDeafened = intent?.getBooleanExtra(VoiceServiceActions.EXTRA_IS_DEAFENED, false) ?: false
        val isScreenSharing = intent?.getBooleanExtra(VoiceServiceActions.EXTRA_IS_SCREEN_SHARING, false) ?: false
        val bitrateKbps = intent?.getIntExtra(VoiceServiceActions.EXTRA_BITRATE_KBPS, 64) ?: 64

        val notification = buildNotification(
            spaceName = spaceName,
            channelName = channelName,
            isMuted = isMuted,
            isDeafened = isDeafened,
            bitrateKbps = bitrateKbps,
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            var serviceTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            if (isScreenSharing && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                serviceTypes = serviceTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            }
            startForeground(NOTIFICATION_ID, notification, serviceTypes)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // Se o usuário deslizar o app para fechar, encerra a call limpa e notifica o servidor
        VoiceServiceControllerBridge.onDisconnect?.invoke()
        stopSelf()
    }

    private fun ensureNotificationChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID)
        if (existing == null) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Backspace Voice",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Active voice channel connection"
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(
        spaceName: String,
        channelName: String,
        isMuted: Boolean,
        isDeafened: Boolean,
        bitrateKbps: Int,
    ): Notification {
        val muteIntent = servicePendingIntent(VoiceServiceActions.ACTION_TOGGLE_MUTE, 101)
        val deafenIntent = servicePendingIntent(VoiceServiceActions.ACTION_TOGGLE_DEAFEN, 102)
        val leaveIntent = servicePendingIntent(VoiceServiceActions.ACTION_DISCONNECT, 103)

        val statusSummary = buildString {
            append("$spaceName · Opus ${bitrateKbps} kbps")
            if (isDeafened) append(" · Deafened")
            else if (isMuted) append(" · Muted")
        }

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(channelName)
            .setContentText(statusSummary)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .addAction(
                0,
                if (isMuted) "Unmute" else "Mute",
                muteIntent,
            )
            .addAction(
                0,
                if (isDeafened) "Undeafen" else "Deafen",
                deafenIntent,
            )
            .addAction(
                0,
                "Leave",
                leaveIntent,
            )
            .build()
    }

    private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, VoiceForegroundService::class.java).apply {
            this.action = action
        }
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "backspace_voice_active"
        const val NOTIFICATION_ID = 4201

        fun startOrUpdate(
            context: Context,
            spaceName: String,
            channelName: String,
            isMuted: Boolean,
            isDeafened: Boolean,
            bitrateKbps: Int,
            isScreenSharing: Boolean = false,
        ) {
            val intent = Intent(context, VoiceForegroundService::class.java).apply {
                action = VoiceServiceActions.ACTION_UPDATE
                putExtra(VoiceServiceActions.EXTRA_SPACE_NAME, spaceName)
                putExtra(VoiceServiceActions.EXTRA_CHANNEL_NAME, channelName)
                putExtra(VoiceServiceActions.EXTRA_IS_MUTED, isMuted)
                putExtra(VoiceServiceActions.EXTRA_IS_DEAFENED, isDeafened)
                putExtra(VoiceServiceActions.EXTRA_IS_SCREEN_SHARING, isScreenSharing)
                putExtra(VoiceServiceActions.EXTRA_BITRATE_KBPS, bitrateKbps)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, VoiceForegroundService::class.java))
        }
    }
}
