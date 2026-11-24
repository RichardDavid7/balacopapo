package com.backspace.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.HeadsetMic
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.AetherTheme
import com.backspace.core.model.InstanceStreamingLimits
import com.backspace.core.network.BackspaceRestClient
import com.backspace.core.network.BackspaceWebSocketClient
import com.backspace.core.updater.GitHubReleaseUpdater
import com.backspace.core.voice.BackspaceVoiceEngine

private enum class SettingsCategory(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
) {
    ACCOUNT("Conta", "Perfil, avatar, banner, bio, senha e exclusão", Icons.Default.Person),
    APPEARANCE("Aparência", "Idioma e escala da interface", Icons.Default.Palette),
    VOICE_VIDEO("Voz e Vídeo", "Microfone, PTT, áudio Opus e transmissão", Icons.Default.HeadsetMic),
    PRIVACY("Privacidade", "Descoberta de perfil e status de atividade", Icons.Default.Shield),
    CONNECTIONS("Conexões", "Instância atual e conexões federadas", Icons.Default.Link),
    NOTIFICATIONS("Notificações", "Alertas de DMs, menções e chamadas", Icons.Default.Notifications),
    APP_ABOUT("Aplicativo e Atualizações", "Versão, atualizações e código-fonte", Icons.Default.Info),
    INSTANCE("Instância", "Administração completa da instância (10 painéis)", Icons.Default.AdminPanelSettings),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    instanceUrl: String,
    jwtToken: String,
    appVersion: String,
    repoSlug: String,
    restClient: BackspaceRestClient,
    wsClient: BackspaceWebSocketClient,
    voiceEngine: BackspaceVoiceEngine,
    updater: GitHubReleaseUpdater,
    title: String,
    logoutLabel: String,
    onTokenUpdated: (String) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AetherTheme.colors
    val snapshot by wsClient.snapshot.collectAsStateWithLifecycle()
    val currentUser = snapshot.currentUser
    val isInstanceAdmin = currentUser?.isAdmin == true

    var selectedCategory by remember { mutableStateOf<SettingsCategory?>(null) }
    var instanceLimits by remember { mutableStateOf(InstanceStreamingLimits()) }
    var showLogoutConfirm by remember { mutableStateOf(false) }

    LaunchedEffect(instanceUrl, jwtToken) {
        runCatching { restClient.getStreamingLimits(instanceUrl, jwtToken) }
            .onSuccess { instanceLimits = it }
    }

    // Se abrir o menu de Instância, ele gerencia seu próprio TopAppBar e BackHandler
    if (selectedCategory == SettingsCategory.INSTANCE && isInstanceAdmin) {
        Box(modifier = modifier.fillMaxSize()) {
            InstanceAdminHostScreen(
                instanceUrl = instanceUrl,
                token = jwtToken,
                restClient = restClient,
                onBack = { selectedCategory = null },
            )
        }
        return
    }

    BackHandler(enabled = selectedCategory != null) {
        selectedCategory = null
    }

    if (selectedCategory != null) {
        val activeCategory = selectedCategory!!
        Column(
            modifier = modifier
                .fillMaxSize()
                .background(colors.bgBase),
        ) {
            TopAppBar(
                windowInsets = WindowInsets(0, 0, 0, 0),
                title = {
                    Text(
                        text = activeCategory.title,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { selectedCategory = null }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Voltar",
                            tint = colors.textPrimary,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = colors.bgChannel,
                ),
            )

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                when (activeCategory) {
                    SettingsCategory.ACCOUNT -> AccountSettingsSubScreen(
                        instanceUrl = instanceUrl,
                        token = jwtToken,
                        currentUser = currentUser,
                        restClient = restClient,
                        onTokenUpdated = onTokenUpdated,
                        onProfileSaved = { updated -> wsClient.updateCurrentUserLocal(updated) },
                        onLogout = onLogout,
                    )

                    SettingsCategory.APPEARANCE -> AppearanceSettingsSubScreen()

                    SettingsCategory.VOICE_VIDEO -> VoiceVideoSettingsSubScreen(
                        voiceEngine = voiceEngine,
                        instanceLimits = instanceLimits,
                    )

                    SettingsCategory.PRIVACY -> PrivacySettingsSubScreen(
                        instanceUrl = instanceUrl,
                        token = jwtToken,
                        currentUser = currentUser,
                        restClient = restClient,
                        onProfileSaved = { updated -> wsClient.updateCurrentUserLocal(updated) },
                    )

                    SettingsCategory.CONNECTIONS -> ConnectionsSettingsSubScreen(
                        instanceUrl = instanceUrl,
                        currentUser = currentUser,
                    )

                    SettingsCategory.NOTIFICATIONS -> NotificationsSettingsSubScreen()

                    SettingsCategory.APP_ABOUT -> AppAboutSettingsSubScreen(
                        instanceUrl = instanceUrl,
                        appVersion = appVersion,
                        updater = updater,
                        onLogout = onLogout,
                        repoSlug = repoSlug,
                    )

                    SettingsCategory.INSTANCE -> Unit
                }
            }
        }
        return
    }

    // Menu principal vertical agrupado (paridade com a estrutura da versão web)
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            color = colors.textPrimary,
            fontWeight = FontWeight.SemiBold,
        )

        // Cartão resumo do usuário (atalho direto para Conta)
        AetherSurfaceCard(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { selectedCategory = SettingsCategory.ACCOUNT },
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AetherAvatar(
                    imageUrl = currentUser?.avatarUrl(instanceUrl),
                    fallbackLabel = currentUser?.label ?: "?",
                    status = currentUser?.status,
                    size = 48.dp,
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = currentUser?.label ?: "-",
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = buildString {
                            if (currentUser != null) append("@${currentUser.username}")
                            if (!currentUser?.customStatus.isNullOrBlank()) {
                                if (isNotEmpty()) append(" · ")
                                append(currentUser?.customStatus)
                            }
                        }.ifBlank { instanceUrl },
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = colors.textTertiary,
                )
            }
        }

        // Grupo 1 — Configurações de Usuário
        SettingsMenuGroup(
            header = "CONFIGURAÇÕES DE USUÁRIO",
            items = listOf(
                SettingsCategory.ACCOUNT,
                SettingsCategory.APPEARANCE,
                SettingsCategory.VOICE_VIDEO,
                SettingsCategory.PRIVACY,
            ),
            onSelect = { selectedCategory = it },
        )

        // Grupo 2 — Aplicativo
        SettingsMenuGroup(
            header = "APLICATIVO",
            items = listOf(
                SettingsCategory.CONNECTIONS,
                SettingsCategory.NOTIFICATIONS,
                SettingsCategory.APP_ABOUT,
            ),
            onSelect = { selectedCategory = it },
        )

        // Grupo 3 — Administração (apenas admins da instância)
        if (isInstanceAdmin) {
            SettingsMenuGroup(
                header = "ADMINISTRAÇÃO",
                items = listOf(SettingsCategory.INSTANCE),
                accentIconTint = colors.accentAmber,
                onSelect = { selectedCategory = it },
            )
        }

        // Rodapé — Sair da conta + versão
        Spacer(modifier = Modifier.height(4.dp))
        OutlinedButton(
            onClick = { showLogoutConfirm = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Logout,
                contentDescription = null,
                tint = colors.accentPeach,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(logoutLabel, color = colors.accentPeach)
        }

        Text(
            text = "Backspace Android v$appVersion · $instanceUrl",
            style = MaterialTheme.typography.bodySmall,
            color = colors.textTertiary,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )
    }

    if (showLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showLogoutConfirm = false },
            containerColor = colors.bgChannel,
            title = { Text("Sair da conta?", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Você será desconectado desta instância e precisará entrar novamente.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLogoutConfirm = false
                        onLogout()
                    },
                ) {
                    Text(logoutLabel, color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutConfirm = false }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

@Composable
private fun SettingsMenuGroup(
    header: String,
    items: List<SettingsCategory>,
    onSelect: (SettingsCategory) -> Unit,
    accentIconTint: Color? = null,
) {
    val colors = AetherTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = header,
            style = MaterialTheme.typography.labelSmall,
            color = colors.textTertiary,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        AetherSurfaceCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.fillMaxWidth()) {
                items.forEachIndexed { index, category ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onSelect(category) }
                            .padding(vertical = 10.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background((accentIconTint ?: colors.accentPrimary).copy(alpha = 0.14f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = category.icon,
                                contentDescription = null,
                                tint = accentIconTint ?: colors.accentPrimary,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = category.title,
                                style = MaterialTheme.typography.bodyLarge,
                                color = colors.textPrimary,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                text = category.subtitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = colors.textTertiary,
                        )
                    }
                    if (index < items.lastIndex) {
                        HorizontalDivider(
                            color = colors.borderSoft,
                            modifier = Modifier.padding(vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}
