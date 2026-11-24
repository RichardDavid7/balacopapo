package com.backspace.feature.spaces

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.Space
import com.backspace.core.network.BackspaceRestClient
import kotlinx.coroutines.launch

enum class SpaceSettingsSection(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
) {
    OVERVIEW(
        title = "Visão Geral",
        subtitle = "Ícone, banner, nome, posse e exclusão",
        icon = Icons.Default.Tune,
    ),
    DISCOVERY(
        title = "Descoberta",
        subtitle = "Visibilidade, diretório global e solicitações",
        icon = Icons.Default.Explore,
    ),
    MEMBERS(
        title = "Membros",
        subtitle = "Cargos, apelidos, expulsar e banir",
        icon = Icons.Default.Group,
    ),
    ROLES(
        title = "Cargos e Permissões",
        subtitle = "Hierarquia, cores e matriz de permissões",
        icon = Icons.Default.Shield,
    ),
    AUDIO_OPUS(
        title = "Áudio (Opus)",
        subtitle = "Bitrate padrão/máximo, modo música e estéreo",
        icon = Icons.Default.GraphicEq,
    ),
    SOUNDBOARD(
        title = "Soundboard",
        subtitle = "Habilitar, sons da instância e simultâneos",
        icon = Icons.Default.MusicNote,
    ),
    BANS(
        title = "Banimentos",
        subtitle = "Lista de banidos e desbanir",
        icon = Icons.Default.Block,
    ),
    INVITES(
        title = "Convites",
        subtitle = "Gerar link e enviar convite direto para amigos",
        icon = Icons.Default.PersonAdd,
    ),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpaceSettingsHostScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    currentUserId: String,
    restClient: BackspaceRestClient,
    onSpaceUpdated: () -> Unit,
    onSpaceLeftOrDeleted: () -> Unit,
    onBack: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var activeSpace by remember(space) { mutableStateOf(space) }
    var selectedSection by remember { mutableStateOf<SpaceSettingsSection?>(null) }
    var showLeaveConfirm by remember { mutableStateOf(false) }
    var isLeaving by remember { mutableStateOf(false) }
    var leaveError by remember { mutableStateOf<String?>(null) }

    val isOwner = activeSpace.ownerId == currentUserId

    fun refreshSpaceAndNotify() {
        onSpaceUpdated()
        scope.launch {
            runCatching {
                restClient.getSpaceDetail(instanceUrl, token, activeSpace.id)
            }.onSuccess { refreshed ->
                activeSpace = refreshed
            }
        }
    }

    BackHandler(enabled = true) {
        if (selectedSection != null) {
            selectedSection = null
        } else {
            onBack()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase),
    ) {
        TopAppBar(
            windowInsets = WindowInsets(0, 0, 0, 0),
            title = {
                Column {
                    Text(
                        text = selectedSection?.title ?: "Configurações do Espaço",
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = activeSpace.name,
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
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
        HorizontalDivider(color = colors.borderSoft)

        if (selectedSection == null) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AetherSurfaceCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AetherAvatar(
                            imageUrl = activeSpace.iconUrl(instanceUrl),
                            fallbackLabel = activeSpace.name,
                            size = 52.dp,
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = activeSpace.name,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = "${activeSpace.members.size} membros • ${activeSpace.roles.size} cargos",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                            )
                            if (isOwner) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = colors.accentPrimary.copy(alpha = 0.18f),
                                ) {
                                    Text(
                                        text = "Proprietário do Espaço",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = colors.accentPrimary,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                    )
                                }
                            }
                        }
                    }
                }

                AetherSurfaceCard {
                    SpaceSettingsSection.entries.forEachIndexed { index, section ->
                        if (index > 0) {
                            HorizontalDivider(
                                color = colors.borderSoft,
                                modifier = Modifier.padding(vertical = 4.dp),
                            )
                        }
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { selectedSection = section }
                                .padding(vertical = 10.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(colors.bgElevated),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    imageVector = section.icon,
                                    contentDescription = null,
                                    tint = colors.accentPrimary,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = section.title,
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = FontWeight.Medium,
                                    color = colors.textPrimary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = section.subtitle,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                contentDescription = null,
                                tint = colors.textTertiary,
                            )
                        }
                    }
                }

                if (!isOwner) {
                    Spacer(modifier = Modifier.height(4.dp))
                    if (leaveError != null) {
                        Text(
                            text = leaveError.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.accentPeach,
                        )
                    }
                    OutlinedButton(
                        onClick = { showLeaveConfirm = true },
                        enabled = !isLeaving,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.6f)),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = colors.accentPeach,
                        ),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ExitToApp,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = if (isLeaving) "Saindo..." else "Sair do Espaço")
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
            }
        } else {
            when (selectedSection!!) {
                SpaceSettingsSection.OVERVIEW -> SpaceOverviewSubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    currentUserId = currentUserId,
                    restClient = restClient,
                    onSpaceUpdated = { refreshSpaceAndNotify() },
                    onSpaceDeleted = onSpaceLeftOrDeleted,
                )

                SpaceSettingsSection.DISCOVERY -> SpaceDiscoverySubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    restClient = restClient,
                    onSpaceUpdated = { refreshSpaceAndNotify() },
                )

                SpaceSettingsSection.MEMBERS -> SpaceMembersSubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    currentUserId = currentUserId,
                    restClient = restClient,
                    onSpaceUpdated = { refreshSpaceAndNotify() },
                )

                SpaceSettingsSection.ROLES -> SpaceRolesSubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    restClient = restClient,
                    onSpaceUpdated = { refreshSpaceAndNotify() },
                )

                SpaceSettingsSection.AUDIO_OPUS -> SpaceAudioOpusSubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    restClient = restClient,
                    onSpaceUpdated = { refreshSpaceAndNotify() },
                )

                SpaceSettingsSection.SOUNDBOARD -> SpaceSoundboardSubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    restClient = restClient,
                )

                SpaceSettingsSection.BANS -> SpaceBansSubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    restClient = restClient,
                )

                SpaceSettingsSection.INVITES -> SpaceInvitesSubScreen(
                    instanceUrl = instanceUrl,
                    token = token,
                    space = activeSpace,
                    restClient = restClient,
                )
            }
        }
    }

    if (showLeaveConfirm) {
        AlertDialog(
            onDismissRequest = { if (!isLeaving) showLeaveConfirm = false },
            containerColor = colors.bgElevated,
            titleContentColor = colors.textPrimary,
            textContentColor = colors.textSecondary,
            title = { Text("Sair do Espaço?") },
            text = {
                Text(
                    "Você perderá acesso aos canais de \"${activeSpace.name}\" até receber um novo convite ou entrar novamente.",
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !isLeaving,
                    onClick = {
                        scope.launch {
                            isLeaving = true
                            leaveError = null
                            runCatching {
                                restClient.leaveSpace(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    spaceId = activeSpace.id,
                                    myUserId = currentUserId,
                                )
                            }.onSuccess {
                                showLeaveConfirm = false
                                onSpaceLeftOrDeleted()
                            }.onFailure { err ->
                                leaveError = err.message ?: "Não foi possível sair do Espaço."
                                showLeaveConfirm = false
                            }
                            isLeaving = false
                        }
                    },
                ) {
                    Text(
                        text = if (isLeaving) "Saindo..." else "Sair",
                        color = colors.accentPeach,
                    )
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isLeaving,
                    onClick = { showLeaveConfirm = false },
                ) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}
