package com.backspace.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backspace.core.designsystem.AetherPurpleSlider
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.AudioMode
import com.backspace.core.model.InstanceStreamingLimits
import com.backspace.core.model.PttHardwareKey
import com.backspace.core.model.TransmissionMode
import com.backspace.core.voice.BackspaceVoiceEngine

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun VoiceVideoSettingsSubScreen(
    voiceEngine: BackspaceVoiceEngine,
    instanceLimits: InstanceStreamingLimits,
) {
    val colors = LocalAetherColors.current
    val voiceState by voiceEngine.state.collectAsStateWithLifecycle()
    val prefs = voiceState.userPrefs
    var showResetDialog by remember { mutableStateOf(false) }

    val maxAudioBitrateKbps = instanceLimits.maxAudioBitrateKbps.coerceIn(16, 512)
    val maxRes = instanceLimits.maxResolution
    val maxFps = instanceLimits.maxFramerate

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // ── Card 1: Microfone & Transmissão ──
        AetherSurfaceCard {
            Text(
                text = "Microfone & Transmissão",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Escolha como sua voz é enviada nas chamadas.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = prefs.transmissionMode == TransmissionMode.VOICE_ACTIVITY,
                    onClick = {
                        voiceEngine.updateUserAudioPreferences {
                            it.copy(transmissionMode = TransmissionMode.VOICE_ACTIVITY)
                        }
                    },
                    label = { Text("Automático (VAD)") },
                )
                FilterChip(
                    selected = prefs.transmissionMode == TransmissionMode.PUSH_TO_TALK,
                    onClick = {
                        voiceEngine.updateUserAudioPreferences {
                            it.copy(transmissionMode = TransmissionMode.PUSH_TO_TALK)
                        }
                    },
                    label = { Text("Apertar p/ Falar (PTT)") },
                )
            }

            if (prefs.transmissionMode == TransmissionMode.PUSH_TO_TALK) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Segure o botão na chamada ou a tecla física escolhida abaixo para transmitir sua voz.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                Spacer(Modifier.height(8.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(
                        PttHardwareKey.NONE to "Só na tela",
                        PttHardwareKey.VOLUME_UP to "Botão Vol +",
                        PttHardwareKey.VOLUME_DOWN to "Botão Vol -",
                    ).forEach { (key, label) ->
                        FilterChip(
                            selected = prefs.pttHardwareKey == key,
                            onClick = {
                                voiceEngine.updateUserAudioPreferences { it.copy(pttHardwareKey = key) }
                            },
                            label = { Text(label) },
                        )
                    }
                }
            } else {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Sensibilidade VAD: ${(prefs.vadThreshold * 100).toInt()}% — diminua se sua voz estiver cortando; aumente para ignorar ruído de fundo.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                AetherPurpleSlider(
                    value = prefs.vadThreshold.coerceIn(0.02f, 0.8f),
                    onValueChange = { v ->
                        voiceEngine.updateUserAudioPreferences { it.copy(vadThreshold = v) }
                    },
                    valueRange = 0.02f..0.8f,
                )
                Text(
                    text = "Nível do microfone ao vivo",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
                Spacer(Modifier.height(4.dp))
                LinearProgressIndicator(
                    progress = { voiceState.micInputLevel.coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp)),
                    color = colors.accentMint,
                    trackColor = colors.bgBase,
                )
            }
        }

        // ── Card 2: Áudio & Volume ──
        AetherSurfaceCard {
            Text(
                text = "Áudio & Volume",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))

            Text(
                text = "Volume geral da chamada: ${(prefs.masterOutputVolume * 100).toInt()}%",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            AetherPurpleSlider(
                value = prefs.masterOutputVolume.coerceIn(0f, 2f),
                onValueChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(masterOutputVolume = v) }
                },
                valueRange = 0f..2f,
            )

            Spacer(Modifier.height(6.dp))
            Text(
                text = "Volume do Soundboard: ${(voiceState.soundboardVolume * 100).toInt()}%",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            AetherPurpleSlider(
                value = voiceState.soundboardVolume.coerceIn(0f, 1f),
                onValueChange = { voiceEngine.setSoundboardVolume(it) },
                valueRange = 0f..1f,
            )

            Spacer(Modifier.height(6.dp))
            VoiceToggleRow(
                label = "Sons do app (mutar / entrar / sair)",
                checked = prefs.uiSoundsEnabled,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(uiSoundsEnabled = v) }
                },
            )
            VoiceToggleRow(
                label = "Abaixar volume da sala quando eu falar (Ducking)",
                checked = prefs.audioDuckingEnabled,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(audioDuckingEnabled = v) }
                },
            )
            VoiceToggleRow(
                label = "Cancelamento de Eco (AEC)",
                checked = prefs.echoCancellation,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(echoCancellation = v) }
                },
            )
            VoiceToggleRow(
                label = "Supressão de Ruído (NS)",
                checked = prefs.noiseSuppression,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(noiseSuppression = v) }
                },
            )
            VoiceToggleRow(
                label = "Ganho Automático (AGC)",
                checked = prefs.autoGainControl,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(autoGainControl = v) }
                },
            )
            VoiceToggleRow(
                label = "Suspender áudio quando ocioso (Idle Suspend)",
                checked = prefs.idleSuspendEnabled,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(idleSuspendEnabled = v) }
                },
            )
        }

        // ── Card 3: Qualidade Opus ──
        AetherSurfaceCard {
            Text(
                text = "Qualidade Opus",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Limite da instância: até ${maxAudioBitrateKbps} kbps.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = prefs.mode == AudioMode.VOICE,
                    onClick = {
                        voiceEngine.updateUserAudioPreferences { it.copy(mode = AudioMode.VOICE) }
                    },
                    label = { Text("Voz") },
                )
                FilterChip(
                    selected = prefs.mode == AudioMode.MUSIC,
                    enabled = instanceLimits.allowMusicMode,
                    onClick = {
                        voiceEngine.updateUserAudioPreferences { it.copy(mode = AudioMode.MUSIC) }
                    },
                    label = { Text("Música") },
                )
            }
            if (!instanceLimits.allowMusicMode) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Modo Música desabilitado pela política da instância.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
            }

            Spacer(Modifier.height(6.dp))
            VoiceToggleRow(
                label = "Áudio Estéreo",
                checked = prefs.stereo && instanceLimits.allowStereoAudio,
                enabled = instanceLimits.allowStereoAudio,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(stereo = v) }
                },
            )
            VoiceToggleRow(
                label = "Bitrate automático",
                checked = prefs.bitrateAuto,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(bitrateAuto = v) }
                },
            )

            if (!prefs.bitrateAuto) {
                val effectiveManual = prefs.manualBitrateKbps.coerceIn(8, maxAudioBitrateKbps)
                Text(
                    text = "Bitrate manual: $effectiveManual kbps (máx. $maxAudioBitrateKbps kbps)",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                AetherPurpleSlider(
                    value = effectiveManual.toFloat(),
                    onValueChange = { v ->
                        voiceEngine.updateUserAudioPreferences {
                            it.copy(manualBitrateKbps = v.toInt().coerceIn(8, maxAudioBitrateKbps))
                        }
                    },
                    valueRange = 8f..maxAudioBitrateKbps.toFloat(),
                )
            }

            VoiceToggleRow(
                label = "Economia de dados móveis (24 kbps)",
                checked = prefs.dataSaverMode,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(dataSaverMode = v) }
                },
            )

            Spacer(Modifier.height(8.dp))
            Text(
                text = "Tamanho do pacote Opus (menor = menos atraso):",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(6.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(10, 20, 40).forEach { ms ->
                    FilterChip(
                        selected = prefs.opusFrameSizeMs == ms,
                        onClick = {
                            voiceEngine.updateUserAudioPreferences { it.copy(opusFrameSizeMs = ms) }
                        },
                        label = { Text("${ms}ms") },
                    )
                }
            }
        }

        // ── Card 4: Vídeo & Transmissão ──
        AetherSurfaceCard {
            Text(
                text = "Vídeo & Transmissão",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            VoiceToggleRow(
                label = "Ocultar participantes sem vídeo",
                checked = prefs.hideNonVideoParticipants,
                onCheckedChange = { v ->
                    voiceEngine.updateUserAudioPreferences { it.copy(hideNonVideoParticipants = v) }
                },
            )

            Spacer(Modifier.height(8.dp))
            Text(
                text = "Qualidade do compartilhamento de tela (limite da instância: ${maxRes}p @ ${maxFps} FPS):",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Resolução",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
            Spacer(Modifier.height(4.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(720, 1080).forEach { res ->
                    FilterChip(
                        selected = prefs.screenShareResolution == res,
                        enabled = res <= maxRes,
                        onClick = {
                            voiceEngine.updateUserAudioPreferences { it.copy(screenShareResolution = res) }
                        },
                        label = { Text("${res}p") },
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                text = "Taxa de quadros (FPS)",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
            Spacer(Modifier.height(4.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(15, 30, 60).forEach { fps ->
                    FilterChip(
                        selected = prefs.screenShareFps == fps,
                        enabled = fps <= maxFps,
                        onClick = {
                            voiceEngine.updateUserAudioPreferences { it.copy(screenShareFps = fps) }
                        },
                        label = { Text("$fps FPS") },
                    )
                }
            }
        }

        // ── Restaurar padrões de áudio ──
        OutlinedButton(
            onClick = { showResetDialog = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Restaurar padrões de áudio", color = colors.accentAmber)
        }

        Spacer(Modifier.height(16.dp))
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            containerColor = colors.bgChannel,
            title = {
                Text(
                    text = "Restaurar padrões de áudio?",
                    color = colors.textPrimary,
                )
            },
            text = {
                Text(
                    text = "Todas as preferências de microfone, volume, Opus e transmissão de tela voltarão aos valores recomendados.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                Button(
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.accentPrimary,
                        contentColor = colors.textPrimary,
                    ),
                    onClick = {
                        voiceEngine.resetAudioPreferencesToDefault()
                        showResetDialog = false
                    },
                ) {
                    Text("Restaurar")
                }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

@Composable
private fun VoiceToggleRow(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onCheckedChange: (Boolean) -> Unit,
) {
    val colors = LocalAetherColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            color = if (enabled) colors.textPrimary else colors.textTertiary,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
        )
        Switch(
            checked = checked,
            enabled = enabled,
            onCheckedChange = onCheckedChange,
        )
    }
}
