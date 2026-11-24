package com.backspace.core.model

/**
 * Resolve a política de áudio Opus em 4 níveis de servidor + preferências do usuário:
 * Instância -> Espaço -> Categoria -> Canal -> Usuário.
 */
object AudioPolicyResolver {
    const val MIN_BITRATE_KBPS = 8
    const val MAX_BITRATE_KBPS = 512

    fun clampBitrate(value: Int): Int = value.coerceIn(MIN_BITRATE_KBPS, MAX_BITRATE_KBPS)

    fun resolvePolicy(
        instance: InstanceStreamingLimits = InstanceStreamingLimits(),
        space: Space? = null,
        category: ChannelCategory? = null,
        channel: Channel? = null,
    ): ResolvedAudioPolicy {
        var maxBitrate = clampBitrate(instance.maxAudioBitrateKbps)
        space?.maxAudioBitrateKbps?.let { maxBitrate = minOf(maxBitrate, clampBitrate(it)) }
        category?.maxAudioBitrateKbps?.let { maxBitrate = minOf(maxBitrate, clampBitrate(it)) }
        channel?.maxAudioBitrateKbps?.let { maxBitrate = minOf(maxBitrate, clampBitrate(it)) }

        val rawDefault = channel?.audioBitrateKbps
            ?: category?.audioBitrateKbps
            ?: space?.audioBitrateKbps
            ?: instance.defaultAudioBitrateKbps
        val defaultBitrate = clampBitrate(rawDefault).coerceAtMost(maxBitrate)

        val allowMusic = instance.allowMusicMode &&
            (space?.allowMusicMode ?: true) &&
            (category?.allowMusicMode ?: true) &&
            (channel?.allowMusicMode ?: true)

        val allowStereo = instance.allowStereoAudio &&
            (space?.allowStereoAudio ?: true) &&
            (category?.allowStereoAudio ?: true) &&
            (channel?.allowStereoAudio ?: true)

        return ResolvedAudioPolicy(
            defaultBitrateKbps = defaultBitrate,
            maxBitrateKbps = maxBitrate,
            allowMusicMode = allowMusic,
            allowStereoAudio = allowStereo,
        )
    }

    fun resolveEffectiveConfig(
        policy: ResolvedAudioPolicy,
        userPrefs: UserAudioPreferences,
    ): EffectiveAudioConfig {
        val effectiveMode = if (userPrefs.mode == AudioMode.MUSIC && policy.allowMusicMode) {
            AudioMode.MUSIC
        } else {
            AudioMode.VOICE
        }

        val effectiveStereo = userPrefs.stereo && policy.allowStereoAudio

        val effectiveBitrate = when {
            userPrefs.dataSaverMode -> minOf(24, policy.maxBitrateKbps).coerceAtLeast(MIN_BITRATE_KBPS)
            userPrefs.bitrateAuto -> policy.defaultBitrateKbps
            else -> clampBitrate(userPrefs.manualBitrateKbps).coerceAtMost(policy.maxBitrateKbps)
        }

        val dtx = effectiveMode == AudioMode.VOICE
        val red = effectiveMode == AudioMode.VOICE && !effectiveStereo

        return EffectiveAudioConfig(
            bitrateKbps = effectiveBitrate,
            mode = effectiveMode,
            stereo = effectiveStereo,
            dtx = dtx,
            red = red,
            policy = policy,
        )
    }
}
