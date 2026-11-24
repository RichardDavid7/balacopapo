package com.backspace.core.designsystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Paleta oficial Aether Drift espelhando `packages/web/src/styles/globals.css`.
 */
@Immutable
data class AetherColors(
    val bgBase: Color = Color(11, 11, 16),
    val bgChannel: Color = Color(26, 26, 35),
    val bgChat: Color = Color(19, 19, 26),
    val bgElevated: Color = Color(37, 37, 48),
    val bgInput: Color = Color(17, 17, 24),
    val borderHard: Color = Color(34, 34, 44),
    val borderSoft: Color = Color(42, 42, 54),
    val glassBg: Color = Color(20, 20, 26, 140),
    val glassBorder: Color = Color(255, 255, 255, 18),
    val accentPrimary: Color = Color(124, 108, 246),
    val accentPrimaryHover: Color = Color(107, 92, 224),
    val accentMint: Color = Color(134, 239, 172),
    val accentPeach: Color = Color(252, 165, 165),
    val accentAmber: Color = Color(252, 211, 77),
    val accentSky: Color = Color(125, 211, 252),
    val textPrimary: Color = Color(239, 239, 239),
    val textSecondary: Color = Color(160, 160, 170),
    val textTertiary: Color = Color(92, 92, 104),
    val interactiveMuted: Color = Color(58, 58, 68),
    val statusOnline: Color = Color(134, 239, 172),
    val statusIdle: Color = Color(252, 211, 77),
    val statusDnd: Color = Color(252, 165, 165),
    val statusOffline: Color = Color(58, 58, 68),
)

val LocalAetherColors = staticCompositionLocalOf { AetherColors() }

object AetherTheme {
    val colors: AetherColors
        @Composable get() = LocalAetherColors.current
}

@Composable
fun BackspaceAetherTheme(
    content: @Composable () -> Unit,
) {
    val aetherColors = AetherColors()
    val materialScheme = darkColorScheme(
        primary = aetherColors.accentPrimary,
        onPrimary = aetherColors.textPrimary,
        background = aetherColors.bgBase,
        onBackground = aetherColors.textPrimary,
        surface = aetherColors.bgChannel,
        onSurface = aetherColors.textPrimary,
        surfaceVariant = aetherColors.bgElevated,
        onSurfaceVariant = aetherColors.textSecondary,
        error = aetherColors.accentPeach,
        outline = aetherColors.borderSoft,
    )

    CompositionLocalProvider(LocalAetherColors provides aetherColors) {
        MaterialTheme(
            colorScheme = materialScheme,
            content = content,
        )
    }
}
