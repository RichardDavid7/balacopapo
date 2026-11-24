package com.backspace.core.designsystem

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
fun AetherSurfaceCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = AetherTheme.colors
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = colors.bgChannel,
        border = BorderStroke(1.dp, colors.glassBorder),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            content = content,
        )
    }
}

@Composable
fun AetherStatusDot(
    status: String,
    size: Dp = 10.dp,
    modifier: Modifier = Modifier,
) {
    val colors = AetherTheme.colors
    val dotColor = when (status) {
        "online" -> colors.statusOnline
        "idle" -> colors.statusIdle
        "dnd" -> colors.statusDnd
        else -> colors.statusOffline
    }
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(dotColor),
    )
}

@Composable
fun AetherPurpleSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    onValueChangeFinished: (() -> Unit)? = null,
    valueRange: ClosedFloatingPointRange<Float>,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val colors = AetherTheme.colors
    Slider(
        value = value,
        onValueChange = onValueChange,
        onValueChangeFinished = onValueChangeFinished,
        valueRange = valueRange,
        enabled = enabled,
        modifier = modifier,
        colors = SliderDefaults.colors(
            thumbColor = colors.accentPrimary,
            activeTrackColor = colors.accentPrimary,
            inactiveTrackColor = colors.interactiveMuted,
        ),
    )
}

@Composable
fun AetherAvatar(
    imageUrl: String?,
    fallbackLabel: String,
    size: Dp = 32.dp,
    status: String? = null,
    modifier: Modifier = Modifier,
) {
    val colors = AetherTheme.colors
    val initial = fallbackLabel.trim().firstOrNull()?.uppercase() ?: "?"

    Box(modifier = modifier.size(size)) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(CircleShape)
                .background(colors.bgElevated),
            contentAlignment = Alignment.Center,
        ) {
            if (!imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = fallbackLabel,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Text(
                    text = initial,
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.accentPrimary,
                )
            }
        }
        if (status != null) {
            AetherStatusDot(
                status = status,
                size = (size.value * 0.32f).coerceIn(8f, 14f).dp,
                modifier = Modifier.align(Alignment.BottomEnd),
            )
        }
    }
}

@Composable
fun AetherPrimaryButton(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val colors = AetherTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.accentPrimary,
            contentColor = colors.textPrimary,
            disabledContainerColor = colors.interactiveMuted,
            disabledContentColor = colors.textTertiary,
        ),
    ) {
        Text(text = text)
    }
}
