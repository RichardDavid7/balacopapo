package com.backspace.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VpnKey
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.InstanceAdminSettings
import com.backspace.core.model.InstanceStreamingLimits
import com.backspace.core.network.BackspaceRestClient

enum class InstanceAdminSection(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
) {
    GENERAL(
        title = "Geral",
        subtitle = "Nome, descoberta, GIFs e cartão de apoio",
        icon = Icons.Filled.Tune,
    ),
    REGISTRATION(
        title = "Registro e Convites",
        subtitle = "Abertura de registro e links de convite",
        icon = Icons.Filled.PersonAdd,
    ),
    FEDERATION(
        title = "Federação",
        subtitle = "Relay, aprovações pendentes, resets e peers",
        icon = Icons.Filled.Hub,
    ),
    STREAMING(
        title = "Transmissão",
        subtitle = "Resoluções, FPS e limites de bitrate de vídeo",
        icon = Icons.Filled.Videocam,
    ),
    AUDIO_OPUS(
        title = "Áudio (Opus)",
        subtitle = "Bitrate padrão/máximo, modo música e estéreo",
        icon = Icons.Filled.GraphicEq,
    ),
    SOUNDBOARD(
        title = "Soundboard",
        subtitle = "Limites globais e sons da instância",
        icon = Icons.Filled.MusicNote,
    ),
    STORAGE(
        title = "Armazenamento",
        subtitle = "Estatísticas de arquivos, limite de upload e limpeza",
        icon = Icons.Filled.Storage,
    ),
    USERS(
        title = "Usuários",
        subtitle = "Buscar, promover admin, redefinir senha e excluir",
        icon = Icons.Filled.Group,
    ),
    UPDATES(
        title = "Atualizações",
        subtitle = "Versão da instância e disponibilidade de update",
        icon = Icons.Filled.SystemUpdate,
    ),
    TELEMETRY(
        title = "Telemetria",
        subtitle = "Ping diário opt-in e prévia do payload",
        icon = Icons.Filled.Analytics,
    ),
    OIDC(
        title = "OIDC (SSO)",
        subtitle = "Login integrado e vínculo de usuários",
        icon = Icons.Filled.VpnKey,
    ),
    IP_BANS(
        title = "Ban por IP",
        subtitle = "IPs banidos, expiração e feeds OPNsense/Nginx",
        icon = Icons.Filled.Block,
    ),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InstanceAdminHostScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    onBack: () -> Unit,
) {
    val colors = LocalAetherColors.current

    var selectedSection by remember { mutableStateOf<InstanceAdminSection?>(null) }
    var adminSettings by remember { mutableStateOf<InstanceAdminSettings?>(null) }
    var streamingLimits by remember { mutableStateOf<InstanceStreamingLimits?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }

    BackHandler(enabled = true) {
        if (selectedSection != null) {
            selectedSection = null
        } else {
            onBack()
        }
    }

    LaunchedEffect(instanceUrl, token, reloadKey) {
        isLoading = true
        loadError = null
        val errors = mutableListOf<String>()

        runCatching { restClient.getInstanceAdminSettings(instanceUrl, token) }
            .onSuccess { adminSettings = it }
            .onFailure { errors.add("Configurações da instância: ${it.message ?: "erro desconhecido"}") }

        runCatching { restClient.getStreamingLimits(instanceUrl, token) }
            .onSuccess { streamingLimits = it }
            .onFailure { errors.add("Limites de transmissão: ${it.message ?: "erro desconhecido"}") }

        if (errors.isNotEmpty()) {
            loadError = errors.joinToString("\n")
        }
        isLoading = false
    }

    Scaffold(
        containerColor = colors.bgBase,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                windowInsets = WindowInsets(0, 0, 0, 0),
                title = {
                    Text(
                        text = selectedSection?.title ?: "Configurações da Instância",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.textPrimary,
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = {
                            if (selectedSection != null) {
                                selectedSection = null
                            } else {
                                onBack()
                            }
                        },
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Voltar",
                            tint = colors.textPrimary,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = colors.bgChannel,
                    titleContentColor = colors.textPrimary,
                    navigationIconContentColor = colors.textPrimary,
                ),
            )
        },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.bgBase)
                .padding(innerPadding),
        ) {
            val currentSection = selectedSection
            if (currentSection == null) {
                InstanceAdminMenuList(
                    instanceName = adminSettings?.instanceName,
                    isLoading = isLoading,
                    loadError = loadError,
                    onRetry = { reloadKey++ },
                    onSelectSection = { selectedSection = it },
                )
            } else {
                when (currentSection) {
                    InstanceAdminSection.GENERAL -> InstanceGeneralSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                        settings = adminSettings,
                        isLoadingInitial = isLoading,
                        onSettingsUpdated = { adminSettings = it },
                        onRetryLoad = { reloadKey++ },
                    )

                    InstanceAdminSection.REGISTRATION -> InstanceRegistrationSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                        settings = adminSettings,
                        isLoadingInitial = isLoading,
                        onSettingsUpdated = { adminSettings = it },
                        onRetryLoad = { reloadKey++ },
                    )

                    InstanceAdminSection.FEDERATION -> InstanceFederationSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                        settings = adminSettings,
                        isLoadingInitial = isLoading,
                        onSettingsUpdated = { adminSettings = it },
                        onRetryLoad = { reloadKey++ },
                    )

                    InstanceAdminSection.STREAMING -> InstanceStreamingSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                        limits = streamingLimits,
                        isLoadingInitial = isLoading,
                        onLimitsUpdated = { streamingLimits = it },
                        onRetryLoad = { reloadKey++ },
                    )

                    InstanceAdminSection.AUDIO_OPUS -> InstanceAudioOpusSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                        limits = streamingLimits,
                        isLoadingInitial = isLoading,
                        onLimitsUpdated = { streamingLimits = it },
                        onRetryLoad = { reloadKey++ },
                    )

                    InstanceAdminSection.SOUNDBOARD -> InstanceSoundboardSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                        limits = streamingLimits,
                        isLoadingInitial = isLoading,
                        onLimitsUpdated = { streamingLimits = it },
                        onRetryLoad = { reloadKey++ },
                    )

                    InstanceAdminSection.STORAGE -> InstanceStorageSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                        settings = adminSettings,
                        isLoadingInitial = isLoading,
                        onSettingsUpdated = { adminSettings = it },
                        onRetryLoad = { reloadKey++ },
                    )

                    InstanceAdminSection.USERS -> InstanceUsersSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                    )

                    InstanceAdminSection.UPDATES -> InstanceUpdatesSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                    )

                    InstanceAdminSection.TELEMETRY -> InstanceTelemetrySubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                    )

                    InstanceAdminSection.OIDC -> InstanceOidcSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                    )

                    InstanceAdminSection.IP_BANS -> InstanceIpBansSubScreen(
                        instanceUrl = instanceUrl,
                        token = token,
                        restClient = restClient,
                    )
                }
            }
        }
    }
}

@Composable
private fun InstanceAdminMenuList(
    instanceName: String?,
    isLoading: Boolean,
    loadError: String?,
    onRetry: () -> Unit,
    onSelectSection: (InstanceAdminSection) -> Unit,
) {
    val colors = LocalAetherColors.current

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (isLoading) {
            item(key = "loading") {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp)),
                    color = colors.accentPrimary,
                    trackColor = colors.interactiveMuted,
                )
            }
        }

        if (!instanceName.isNullOrBlank()) {
            item(key = "header") {
                Text(
                    text = "Instância: $instanceName",
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.textSecondary,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                )
            }
        }

        if (!loadError.isNullOrBlank()) {
            item(key = "error") {
                AetherSurfaceCard {
                    Text(
                        text = "Aviso ao carregar configurações",
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.accentPeach,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = loadError,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(onClick = onRetry) {
                        Text("Tentar novamente", color = colors.textPrimary)
                    }
                }
            }
        }

        items(
            items = InstanceAdminSection.entries,
            key = { it.name },
        ) { section ->
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .clickable { onSelectSection(section) },
                shape = RoundedCornerShape(14.dp),
                color = colors.bgChannel,
                border = BorderStroke(1.dp, colors.glassBorder),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(colors.accentPrimary.copy(alpha = 0.16f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = section.icon,
                            contentDescription = section.title,
                            tint = colors.accentPrimary,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = section.title,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Medium,
                            color = colors.textPrimary,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = section.subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = colors.textTertiary,
                    )
                }
            }
        }

        item(key = "bottom_spacer") {
            Spacer(Modifier.height(16.dp))
        }
    }
}
