package com.backspace.core.model

/**
 * Parser anti-RFC 7587 para telemetria Opus.
 *
 * O codec Opus sempre anuncia `opus/48000/2` no rtpmap (channels=2), mesmo em mono.
 * Só consideramos Estéreo quando `sdpFmtpLine` contém explicitamente `sprop-stereo=1`.
 */
object OpusFmtpParser {
    private val stereoRegex = Regex("""(?:^|;)\s*sprop-stereo=1\b""", RegexOption.IGNORE_CASE)

    fun detectChannelsMode(sdpFmtpLine: String?): AudioChannelsMode {
        if (sdpFmtpLine.isNullOrBlank()) return AudioChannelsMode.UNKNOWN
        return if (stereoRegex.containsMatchIn(sdpFmtpLine)) {
            AudioChannelsMode.STEREO
        } else {
            AudioChannelsMode.MONO
        }
    }
}
