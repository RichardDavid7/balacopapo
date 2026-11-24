package com.backspace.core.voice

import android.media.AudioAttributes
import android.media.MediaPlayer
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Player nativo leve para clipes do Soundboard usando AudioAttributes de comunicação/mídia
 * com limite de sons simultâneos e controle de volume.
 */
class SoundboardAudioPlayer {
    private val activePlayers = CopyOnWriteArrayList<MediaPlayer>()

    fun play(
        fullUrl: String,
        volume: Float,
        maxConcurrent: Int,
    ) {
        val clampedMax = maxConcurrent.coerceIn(1, 8)
        while (activePlayers.size >= clampedMax) {
            val oldest = activePlayers.firstOrNull() ?: break
            releasePlayer(oldest)
        }

        val clampedVol = volume.coerceIn(0f, 1f)
        val player = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            setVolume(clampedVol, clampedVol)
            setOnPreparedListener { it.start() }
            setOnCompletionListener { releasePlayer(it) }
            setOnErrorListener { mp, _, _ ->
                releasePlayer(mp)
                true
            }
        }

        runCatching {
            activePlayers.add(player)
            player.setDataSource(fullUrl)
            player.prepareAsync()
        }.onFailure {
            releasePlayer(player)
        }
    }

    fun stopAll() {
        activePlayers.toList().forEach { releasePlayer(it) }
    }

    private fun releasePlayer(player: MediaPlayer) {
        activePlayers.remove(player)
        runCatching {
            if (player.isPlaying) player.stop()
        }
        runCatching { player.release() }
    }
}
