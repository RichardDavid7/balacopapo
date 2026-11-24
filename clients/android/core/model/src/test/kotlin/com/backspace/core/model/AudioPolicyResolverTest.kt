package com.backspace.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioPolicyResolverTest {

    @Test
    fun `policy enforces strict intersection and clamps default bitrate`() {
        val instance = InstanceStreamingLimits(
            defaultAudioBitrateKbps = 96,
            maxAudioBitrateKbps = 256,
            allowMusicMode = true,
            allowStereoAudio = true,
        )
        val space = Space(
            id = "s1",
            name = "Espaço",
            maxAudioBitrateKbps = 128,
            allowStereoAudio = false,
        )
        val category = ChannelCategory(
            id = "cat1",
            name = "Voz",
            audioBitrateKbps = 160, // acima do teto do espaço -> deve ser clampado a 128
            allowStereoAudio = true, // filho não pode reabilitar o que o pai bloqueou
        )
        val channel = Channel(
            id = "ch1",
            name = "Lobby",
            type = "voice",
            maxAudioBitrateKbps = 96,
        )

        val policy = AudioPolicyResolver.resolvePolicy(instance, space, category, channel)
        assertEquals(96, policy.maxBitrateKbps)
        assertEquals(96, policy.defaultBitrateKbps)
        assertTrue(policy.allowMusicMode)
        assertFalse(policy.allowStereoAudio)
    }

    @Test
    fun `effective config applies dtx and red rules correctly`() {
        val policy = ResolvedAudioPolicy(
            defaultBitrateKbps = 64,
            maxBitrateKbps = 192,
            allowMusicMode = true,
            allowStereoAudio = true,
        )

        val voiceMono = AudioPolicyResolver.resolveEffectiveConfig(
            policy,
            UserAudioPreferences(mode = AudioMode.VOICE, stereo = false, bitrateAuto = true),
        )
        assertEquals(64, voiceMono.bitrateKbps)
        assertTrue(voiceMono.dtx)
        assertTrue(voiceMono.red)
        assertFalse(voiceMono.stereo)

        val musicStereo = AudioPolicyResolver.resolveEffectiveConfig(
            policy,
            UserAudioPreferences(
                mode = AudioMode.MUSIC,
                stereo = true,
                bitrateAuto = false,
                manualBitrateKbps = 256, // clamped to 192
            ),
        )
        assertEquals(192, musicStereo.bitrateKbps)
        assertFalse(musicStereo.dtx)
        assertFalse(musicStereo.red)
        assertTrue(musicStereo.stereo)
    }

    @Test
    fun `opus fmtp parser avoids RFC 7587 false positive`() {
        assertEquals(
            AudioChannelsMode.MONO,
            OpusFmtpParser.detectChannelsMode("minptime=10;useinbandfec=1"),
        )
        assertEquals(
            AudioChannelsMode.STEREO,
            OpusFmtpParser.detectChannelsMode("minptime=10;sprop-stereo=1;useinbandfec=1"),
        )
        assertEquals(
            AudioChannelsMode.UNKNOWN,
            OpusFmtpParser.detectChannelsMode(null),
        )
    }
}
