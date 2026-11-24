package com.backspace.core.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool

enum class VoiceUiSound {
    MUTE,
    UNMUTE,
    DEAFEN,
    UNDEAFEN,
    USER_JOIN,
    USER_LEAVE,
    DISCONNECT,
    MESSAGE,
}

/**
 * Reprodutor de baixa latência (SoundPool) para os sons nativos do Backspace.
 */
class VoiceUiSoundPlayer(context: Context) {
    private val soundPool = SoundPool.Builder()
        .setMaxStreams(4)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        .build()

    private val soundIds: Map<VoiceUiSound, Int> = mapOf(
        VoiceUiSound.MUTE to soundPool.load(context, R.raw.mute, 1),
        VoiceUiSound.UNMUTE to soundPool.load(context, R.raw.unmute, 1),
        VoiceUiSound.DEAFEN to soundPool.load(context, R.raw.deafen, 1),
        VoiceUiSound.UNDEAFEN to soundPool.load(context, R.raw.undeafen, 1),
        VoiceUiSound.USER_JOIN to soundPool.load(context, R.raw.user_join, 1),
        VoiceUiSound.USER_LEAVE to soundPool.load(context, R.raw.user_leave, 1),
        VoiceUiSound.DISCONNECT to soundPool.load(context, R.raw.disconnect, 1),
        VoiceUiSound.MESSAGE to soundPool.load(context, R.raw.message, 1),
    )

    fun play(sound: VoiceUiSound, enabled: Boolean, volume: Float = 0.7f) {
        if (!enabled) return
        val id = soundIds[sound] ?: return
        val v = volume.coerceIn(0f, 1f)
        runCatching { soundPool.play(id, v, v, 1, 0, 1f) }
    }
}
