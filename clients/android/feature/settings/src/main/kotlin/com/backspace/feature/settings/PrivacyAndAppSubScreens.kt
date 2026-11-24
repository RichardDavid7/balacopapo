package com.backspace.feature.settings

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.backspace.core.designsystem.AetherPrimaryButton
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.User
import com.backspace.core.network.BackspaceRestClient
import com.backspace.core.updater.GitHubReleaseUpdater
import com.backspace.core.updater.UpdateCheckResult
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrivacySettingsSubScreen(
    instanceUrl: String,
    token: String,
    currentUser: User?,
    restClient: BackspaceRestClient,
    onProfileSaved: (User) -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var discoverable by remember(currentUser?.discoverable) {
        mutableStateOf(currentUser?.discoverable ?: true)
    }
    var showActivity by remember(currentUser?.showActivity) {
        mutableStateOf(currentUser?.showActivity ?: true)
    }
    var isSaving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    fun savePrivacy(newDiscoverable: Boolean? = null, newShowActivity: Boolean? = null) {
        scope.launch {
            isSaving = true
            feedback = null
            runCatching {
                restClient.updateProfile(
                    instanceUrl = instanceUrl,
                    token = token,
                    discoverable = newDiscoverable,
                    showActivity = newShowActivity,
                )
            }.onSuccess { updated ->
                discoverable = updated.discoverable
                showActivity = updated.showActivity
                onProfileSaved(updated)
                feedback = "Preferência de privacidade salva." to true
            }.onFailure { err ->
                // Reverte em caso de erro
                discoverable = currentUser?.discoverable ?: discoverable
                showActivity = currentUser?.showActivity ?: showActivity
                feedback = (err.message ?: "Erro ao salvar privacidade") to false
            }
            isSaving = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AetherSurfaceCard {
            Text(
                text = "Privacidade",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Controle como outros usuários podem encontrar e ver sua atividade.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(12.dp))

            PrivacyToggleRow(
                title = "Descobrível",
                description = "Permite que outras pessoas encontrem sua conta por busca ou solicitações de amizade.",
                checked = discoverable,
                enabled = !isSaving,
                onCheckedChange = { checked ->
                    discoverable = checked
                    savePrivacy(newDiscoverable = checked)
                },
            )

            Spacer(Modifier.height(8.dp))

            PrivacyToggleRow(
                title = "Mostrar Status de Atividade",
                description = "Exibe seu status atual e atividade para membros dos Espaços em comum.",
                checked = showActivity,
                enabled = !isSaving,
                onCheckedChange = { checked ->
                    showActivity = checked
                    savePrivacy(newShowActivity = checked)
                },
            )

            if (feedback != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = feedback!!.first,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (feedback!!.second) colors.accentMint else colors.accentPeach,
                )
            }
        }
    }
}

@Composable
fun NotificationsSettingsSubScreen() {
    val colors = LocalAetherColors.current
    val context = LocalContext.current
    var openError by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AetherSurfaceCard {
            Text(
                text = "Notificações do Android",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Os alertas do Backspace são gerenciados pelos canais de notificação nativos do sistema:",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))

            NotificationChannelInfoRow(
                title = "Mensagens Diretas (DMs)",
                description = "Novas mensagens privadas e conversas em grupo.",
            )
            Spacer(Modifier.height(8.dp))
            NotificationChannelInfoRow(
                title = "Menções em Espaços",
                description = "Respostas diretas e menções ao seu usuário em canais de texto.",
            )
            Spacer(Modifier.height(8.dp))
            NotificationChannelInfoRow(
                title = "Chamadas de Voz e Vídeo",
                description = "Chamadas recebidas e status da chamada ativa em segundo plano.",
            )

            if (!openError.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = openError!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.accentPeach,
                )
            }

            Spacer(Modifier.height(14.dp))
            AetherPrimaryButton(
                text = "Abrir Configurações de Notificação",
                onClick = {
                    openError = null
                    runCatching {
                        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        context.startActivity(intent)
                    }.onFailure { err ->
                        openError = err.message ?: "Não foi possível abrir as configurações do sistema."
                    }
                },
            )
        }
    }
}

@Composable
fun ConnectionsSettingsSubScreen(
    instanceUrl: String,
    currentUser: User?,
) {
    val colors = LocalAetherColors.current
    val homeInstance = currentUser?.homeInstance?.takeIf { it.isNotBlank() } ?: instanceUrl

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AetherSurfaceCard {
            Text(
                text = "Instância Home Atual",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = homeInstance,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.accentSky,
            )
            if (currentUser?.username?.isNotBlank() == true) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Conta: @${currentUser.username}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            if (currentUser?.federationHomeOrphaned == true) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Atenção: sua instância de origem (${currentUser.detachedHomeInstance ?: "desconhecida"}) está desconectada. Use a seção Conta para reconectar com um token.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.accentAmber,
                )
            }
        }

        AetherSurfaceCard {
            Text(
                text = "Conexões Federadas",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "O Backspace conecta Espaços e usuários entre instâncias federadas confiáveis mantendo sua identidade principal na instância home.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "O gerenciamento avançado de identidades e conexões federadas adicionais estará disponível em breve.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
        }
    }
}

@Composable
fun AppAboutSettingsSubScreen(
    instanceUrl: String,
    appVersion: String,
    updater: GitHubReleaseUpdater,
    onLogout: () -> Unit,
    repoSlug: String = "",
    sourceCodeUrl: String = "https://github.com/TheZwiss/backspace",
) {
    val colors = LocalAetherColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var isCheckingUpdate by remember { mutableStateOf(false) }
    var updateResult by remember { mutableStateOf<UpdateCheckResult?>(null) }
    var updateStatusMessage by remember { mutableStateOf<String?>(null) }
    var showLogoutDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // ── Sobre o Aplicativo ──
        AetherSurfaceCard {
            Text(
                text = "Sobre o Backspace",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Instância conectada",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
            Text(
                text = instanceUrl,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.accentSky,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Versão do aplicativo",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
            Text(
                text = "v$appVersion",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textPrimary,
            )

            Spacer(Modifier.height(12.dp))
            AetherPrimaryButton(
                text = if (isCheckingUpdate) "Verificando..." else "Verificar Atualizações",
                enabled = !isCheckingUpdate,
                onClick = {
                    scope.launch {
                        isCheckingUpdate = true
                        updateStatusMessage = null
                        updateResult = null
                        if (repoSlug.isBlank()) {
                            updateStatusMessage = "Repositório de atualizações não configurado neste build."
                        } else {
                            val result = updater.checkLatestRelease(
                                repoSlug = repoSlug,
                                currentVersion = appVersion,
                            )
                            if (result == null) {
                                updateStatusMessage = "Não foi possível consultar atualizações agora."
                            } else if (result.updateAvailable) {
                                updateResult = result
                                updateStatusMessage = "Nova versão disponível: ${result.latestTag}"
                            } else {
                                updateStatusMessage = "Você já está na versão mais recente (v$appVersion)."
                            }
                        }
                        isCheckingUpdate = false
                    }
                },
            )

            if (!updateStatusMessage.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = updateStatusMessage!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (updateResult?.updateAvailable == true) colors.accentAmber else colors.accentMint,
                )
            }

            val downloadUrl = updateResult?.takeIf { it.updateAvailable }?.downloadUrl
            if (!downloadUrl.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        runCatching {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)).apply {
                                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                },
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Baixar / Abrir Release", color = colors.accentMint)
                }
            }
        }

        // ── Código-fonte & Licença (AGPL-3.0 §13) ──
        AetherSurfaceCard {
            Text(
                text = "Código-fonte & Licença",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "O Backspace é software livre distribuído sob a licença GNU AGPL-3.0 (Seção 13). Você pode inspecionar, modificar e compilar o código-fonte completo.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedButton(
                onClick = {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(sourceCodeUrl)).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            },
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Abrir Código-fonte", color = colors.accentSky)
            }
        }

        // ── Sessão / Sair da Conta ──
        AetherSurfaceCard {
            Text(
                text = "Sessão",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Encerra sua sessão neste dispositivo e desconecta chamadas ativas.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedButton(
                onClick = { showLogoutDialog = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Sair da Conta", color = colors.accentPeach)
            }
        }

        Spacer(Modifier.height(16.dp))
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            containerColor = colors.bgChannel,
            title = {
                Text(
                    text = "Sair da conta?",
                    color = colors.textPrimary,
                )
            },
            text = {
                Text(
                    text = "Você precisará informar suas credenciais novamente para entrar nesta instância.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                Button(
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.accentPeach,
                        contentColor = colors.bgBase,
                    ),
                    onClick = {
                        showLogoutDialog = false
                        onLogout()
                    },
                ) {
                    Text("Sair")
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

@Composable
private fun PrivacyToggleRow(
    title: String,
    description: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val colors = LocalAetherColors.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
        }
        Switch(
            checked = checked,
            enabled = enabled,
            onCheckedChange = onCheckedChange,
        )
    }
}

@Composable
private fun NotificationChannelInfoRow(
    title: String,
    description: String,
) {
    val colors = LocalAetherColors.current
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textPrimary,
        )
        Text(
            text = description,
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
    }
}
