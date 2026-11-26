package com.backspace.core.voice

import android.content.Context
import com.backspace.core.model.AudioMode
import com.backspace.core.model.PttHardwareKey
import com.backspace.core.model.TransmissionMode
import com.backspace.core.model.UserAudioPreferences

/**
 * Persiste todas as preferências de áudio, Mumble/PTT e vídeo em SharedPreferences.
 */
class AudioPreferencesStorage(context: Context) {
    private val prefs = context.getSharedPreferences("backspace_audio_prefs", Context.MODE_PRIVATE)

    fun load(): UserAudioPreferences = UserAudioPreferences(
        mode = runCatching { AudioMode.valueOf(prefs.getString("mode", AudioMode.VOICE.name)!!) }
            .getOrDefault(AudioMode.VOICE),
        stereo = prefs.getBoolean("stereo", false),
        bitrateAuto = prefs.getBoolean("bitrate_auto", true),
        manualBitrateKbps = prefs.getInt("manual_bitrate", 64),
        opusFrameSizeMs = prefs.getInt("opus_frame_ms", 20),
        dataSaverMode = prefs.getBoolean("data_saver", false),
        transmissionMode = runCatching {
            TransmissionMode.valueOf(prefs.getString("tx_mode", TransmissionMode.VOICE_ACTIVITY.name)!!)
        }.getOrDefault(TransmissionMode.VOICE_ACTIVITY),
        pttHardwareKey = runCatching {
            PttHardwareKey.valueOf(prefs.getString("ptt_hw_key", PttHardwareKey.NONE.name)!!)
        }.getOrDefault(PttHardwareKey.NONE),
        vadThreshold = prefs.getFloat("vad_threshold", 0.15f),
        masterOutputVolume = prefs.getFloat("master_vol", 1.0f),
        audioDuckingEnabled = prefs.getBoolean("ducking", false),
        uiSoundsEnabled = prefs.getBoolean("ui_sounds", true),
        echoCancellation = prefs.getBoolean("aec", true),
        noiseSuppression = prefs.getBoolean("ns", true),
        autoGainControl = prefs.getBoolean("agc", true),
        idleSuspendEnabled = prefs.getBoolean("idle_suspend", true),
        idleSuspendTimeoutSeconds = prefs.getInt("idle_timeout", 60),
        hideNonVideoParticipants = prefs.getBoolean("hide_non_video", false),
        screenShareResolution = prefs.getInt("screen_share_res", 720),
        screenShareFps = prefs.getInt("screen_share_fps", 30),
        jitterBufferMs = prefs.getInt("jitter_buffer_ms", 0),
    )

    fun save(p: UserAudioPreferences) {
        prefs.edit()
            .putString("mode", p.mode.name)
            .putBoolean("stereo", p.stereo)
            .putBoolean("bitrate_auto", p.bitrateAuto)
            .putInt("manual_bitrate", p.manualBitrateKbps)
            .putInt("opus_frame_ms", p.opusFrameSizeMs)
            .putBoolean("data_saver", p.dataSaverMode)
            .putString("tx_mode", p.transmissionMode.name)
            .putString("ptt_hw_key", p.pttHardwareKey.name)
            .putFloat("vad_threshold", p.vadThreshold)
            .putFloat("master_vol", p.masterOutputVolume)
            .putBoolean("ducking", p.audioDuckingEnabled)
            .putBoolean("ui_sounds", p.uiSoundsEnabled)
            .putBoolean("aec", p.echoCancellation)
            .putBoolean("ns", p.noiseSuppression)
            .putBoolean("agc", p.autoGainControl)
            .putBoolean("idle_suspend", p.idleSuspendEnabled)
            .putInt("idle_timeout", p.idleSuspendTimeoutSeconds)
            .putBoolean("hide_non_video", p.hideNonVideoParticipants)
            .putInt("screen_share_res", p.screenShareResolution)
            .putInt("screen_share_fps", p.screenShareFps)
            .putInt("jitter_buffer_ms", p.jitterBufferMs)
            .apply()
    }

    fun loadSoundboardVolume(): Float = prefs.getFloat("soundboard_vol", 0.8f)

    fun saveSoundboardVolume(volume: Float) {
        prefs.edit().putFloat("soundboard_vol", volume.coerceIn(0f, 1f)).apply()
    }
}
