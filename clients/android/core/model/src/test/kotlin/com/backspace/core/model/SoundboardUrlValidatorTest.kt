package com.backspace.core.model

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoundboardUrlValidatorTest {

    @Test
    fun `accepts valid soundboard file paths`() {
        assertTrue(SoundboardUrlValidator.isSafeFileUrl("/api/soundboard/files/abc123-def.wav"))
        assertTrue(SoundboardUrlValidator.isSafeFileUrl("/api/soundboard/files/sound_01.ogg"))
    }

    @Test
    fun `rejects traversal or external urls`() {
        assertFalse(SoundboardUrlValidator.isSafeFileUrl("https://evil.example/a.mp3"))
        assertFalse(SoundboardUrlValidator.isSafeFileUrl("/api/soundboard/files/../secret.wav"))
        assertFalse(SoundboardUrlValidator.isSafeFileUrl("/api/uploads/foo.png"))
        assertFalse(SoundboardUrlValidator.isSafeFileUrl(""))
    }
}
