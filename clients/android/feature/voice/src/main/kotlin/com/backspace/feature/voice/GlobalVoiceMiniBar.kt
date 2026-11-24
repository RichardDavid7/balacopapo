package com.backspace.feature.voice

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.voice.VoiceConnectionStatus
import com.backspace.core.voice.VoiceSessionState

@Composable
fun GlobalVoiceMiniBar(
    voiceState: VoiceSessionState,
    onOpenVoiceRoom: () -> Unit,
    onToggleMute: () -> Unit,
    onToggleDeafen: () -> Unit,
    onLeaveCall: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (voiceState.status == VoiceConnectionStatus.IDLE) return

    val colors = LocalAetherColors.current
    val statusColor = when (voiceState.status) {
        VoiceConnectionStatus.CONNECTED -> colors.accentMint
        VoiceConnectionStatus.CONNECTING, VoiceConnectionStatus.RECONNECTING -> colors.accentAmber
        VoiceConnectionStatus.ERROR -> colors.accentPeach
        VoiceConnectionStatus.IDLE -> colors.statusOffline
    }

    val subtitle = when (voiceState.status) {
        VoiceConnectionStatus.CONNECTING -> "Conectando..."
        VoiceConnectionStatus.RECONNECTING -> "Reconectando..."
        VoiceConnectionStatus.ERROR -> voiceState.errorMessage?.takeIf { it.isNotBlank() } ?: "Erro na conexão"
        VoiceConnectionStatus.CONNECTED -> {
            val opusInfo = "Opus ${voiceState.effectiveAudio.bitrateKbps} kbps"
            if (voiceState.spaceName.isNotBlank()) {
                "${voiceState.spaceName} · $opusInfo"
            } else {
                opusInfo
            }
        }
        VoiceConnectionStatus.IDLE -> ""
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .clickable(onClick = onOpenVoiceRoom),
        shape = RoundedCornerShape(14.dp),
        color = colors.bgChannel,
        border = BorderStroke(1.dp, colors.borderSoft),
        tonalElevation = 4.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f),
            ) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(statusColor),
                )
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = voiceState.channelName.ifBlank { "Voz" },
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = statusColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Spacer(Modifier.width(8.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MiniBarActionButton(
                    icon = if (voiceState.isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                    contentDescription = if (voiceState.isMuted) "Ativar microfone" else "Silenciar microfone",
                    tint = if (voiceState.isMuted) colors.accentPeach else colors.accentMint,
                    background = if (voiceState.isMuted) colors.accentPeach.copy(alpha = 0.16f) else colors.bgElevated,
                    onClick = onToggleMute,
                )
                MiniBarActionButton(
                    icon = if (voiceState.isDeafened) Icons.Default.HeadsetOff else Icons.Default.Headset,
                    contentDescription = if (voiceState.isDeafened) "Ativar áudio" else "Ensurdecer áudio",
                    tint = if (voiceState.isDeafened) colors.accentPeach else colors.textPrimary,
                    background = if (voiceState.isDeafened) colors.accentPeach.copy(alpha = 0.16f) else colors.bgElevated,
                    onClick = onToggleDeafen,
                )
                MiniBarActionButton(
                    icon = Icons.Default.CallEnd,
                    contentDescription = "Desligar chamada",
                    tint = Color.White,
                    background = Color(0xFFD94A5A),
                    onClick = onLeaveCall,
                )
            }
        }
    }
}

@Composable
private fun MiniBarActionButton(
    icon: ImageVector,
    contentDescription: String,
    tint: Color,
    background: Color,
    onClick: () -> Unit,
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(background),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(18.dp),
        )
    }
}
