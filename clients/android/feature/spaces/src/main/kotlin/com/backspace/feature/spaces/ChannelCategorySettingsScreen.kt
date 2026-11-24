package com.backspace.feature.spaces

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherPrimaryButton
import com.backspace.core.designsystem.AetherPurpleSlider
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.CategoryLayoutItem
import com.backspace.core.model.Channel
import com.backspace.core.model.ChannelCategory
import com.backspace.core.model.ChannelLayoutItem
import com.backspace.core.model.PermissionBits
import com.backspace.core.model.PermissionDescriptor
import com.backspace.core.model.PermissionOverrideItem
import com.backspace.core.model.Role
import com.backspace.core.model.Space
import com.backspace.core.network.BackspaceRestClient
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private const val VIEW_CHANNEL_BIT = 1

private enum class TriState {
    DENY,
    INHERIT,
    ALLOW,
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun ChannelSettingsHostScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    channel: Channel,
    restClient: BackspaceRestClient,
    onChanged: () -> Unit,
    onDeleted: () -> Unit,
    onBack: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    BackHandler(enabled = true) { onBack() }

    var selectedTab by remember { mutableIntStateOf(0) }
    var name by remember(channel.id, channel.name) { mutableStateOf(channel.name) }
    var topic by remember(channel.id, channel.topic) { mutableStateOf(channel.topic.orEmpty()) }
    var selectedCategoryId by remember(channel.id, channel.categoryId) {
        mutableStateOf(channel.categoryId)
    }

    // Configurações Opus para canais de voz
    var customizeOpus by remember(channel.id) {
        mutableStateOf(
            channel.audioBitrateKbps != null ||
                channel.maxAudioBitrateKbps != null ||
                channel.allowMusicMode != null ||
                channel.allowStereoAudio != null,
        )
    }
    var defaultBitrateKbps by remember(channel.id) {
        mutableIntStateOf((channel.audioBitrateKbps ?: 64).coerceIn(16, 512))
    }
    var maxBitrateKbps by remember(channel.id) {
        mutableIntStateOf((channel.maxAudioBitrateKbps ?: 128).coerceIn(16, 512))
    }
    var allowMusicMode by remember(channel.id) {
        mutableStateOf(channel.allowMusicMode ?: true)
    }
    var allowStereoAudio by remember(channel.id) {
        mutableStateOf(channel.allowStereoAudio ?: true)
    }

    var overrides by remember(channel.id) { mutableStateOf<List<PermissionOverrideItem>>(emptyList()) }
    var overrideVersion by remember(channel.id) { mutableStateOf(channel.overrideVersion) }
    var loadingOverrides by remember(channel.id) { mutableStateOf(true) }
    var isSaving by remember { mutableStateOf(false) }
    var isTogglingPrivate by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    val everyoneRole = remember(space.roles) {
        space.roles.firstOrNull { it.isEveryone || it.isDefault }
    }

    val everyoneOverride = remember(overrides, everyoneRole) {
        everyoneRole?.let { role ->
            overrides.firstOrNull { it.targetType == "role" && it.targetId == role.id }
        }
    }

    val isPrivateChannel = remember(everyoneOverride, loadingOverrides, channel.isPrivate) {
        if (loadingOverrides) {
            channel.isPrivate
        } else {
            PermissionBits.hasBitStrict(everyoneOverride?.deny, VIEW_CHANNEL_BIT)
        }
    }

    suspend fun reloadOverrides() {
        loadingOverrides = true
        runCatching {
            restClient.getChannelOverrides(instanceUrl, token, channel.id)
        }.onSuccess { resp ->
            overrides = resp.overrides
            overrideVersion = resp.overrideVersion ?: overrideVersion
        }.onFailure { err ->
            errorMessage = err.message ?: "Erro ao carregar permissões do canal."
        }
        loadingOverrides = false
    }

    LaunchedEffect(channel.id) {
        reloadOverrides()
    }

    val titlePrefix = if (channel.type == "voice") "🔊 " else "#"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase),
    ) {
        TopAppBar(
            title = {
                Text(
                    text = "Configurar $titlePrefix${channel.name}",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = colors.textPrimary,
                )
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
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
            ),
            windowInsets = WindowInsets(0, 0, 0, 0),
        )

        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = colors.bgChannel,
            contentColor = colors.accentPrimary,
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text("Visão Geral") },
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = { Text("Permissões") },
            )
        }

        if (errorMessage != null) {
            Text(
                text = errorMessage.orEmpty(),
                color = colors.accentPeach,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        if (statusMessage != null) {
            Text(
                text = statusMessage.orEmpty(),
                color = colors.accentMint,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }

        if (selectedTab == 0) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                AetherSurfaceCard {
                    Text(
                        text = "Informações do Canal",
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Nome do canal") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (channel.type == "text") {
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = topic,
                            onValueChange = { topic = it },
                            label = { Text("Tópico") },
                            placeholder = { Text("Descreva o assunto deste canal") },
                            minLines = 2,
                            maxLines = 4,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = "Categoria pai",
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.textSecondary,
                    )
                    Spacer(Modifier.height(6.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        FilterChip(
                            selected = selectedCategoryId == null,
                            onClick = { selectedCategoryId = null },
                            label = { Text("Sem categoria") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = colors.accentPrimary.copy(alpha = 0.22f),
                                selectedLabelColor = colors.textPrimary,
                            ),
                        )
                        space.categories.sortedBy { it.position }.forEach { cat ->
                            FilterChip(
                                selected = selectedCategoryId == cat.id,
                                onClick = { selectedCategoryId = cat.id },
                                label = { Text(cat.name) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = colors.accentPrimary.copy(alpha = 0.22f),
                                    selectedLabelColor = colors.textPrimary,
                                ),
                            )
                        }
                    }
                }

                // Canal Privado
                AetherSurfaceCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = null,
                                tint = if (isPrivateChannel) colors.accentAmber else colors.textSecondary,
                            )
                            Column {
                                Text(
                                    text = "Canal Privado",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = colors.textPrimary,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    text = "Nega \"Ver canais\" para @everyone. Apenas cargos ou membros autorizados poderão ver este canal.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        Switch(
                            checked = isPrivateChannel,
                            enabled = everyoneRole != null && !loadingOverrides && !isTogglingPrivate,
                            onCheckedChange = { makePrivate ->
                                val role = everyoneRole ?: return@Switch
                                scope.launch {
                                    isTogglingPrivate = true
                                    errorMessage = null
                                    statusMessage = null
                                    runCatching {
                                        val curAllow = everyoneOverride?.allow ?: "0"
                                        val curDeny = everyoneOverride?.deny ?: "0"
                                        if (makePrivate) {
                                            val newAllow = PermissionBits.setBit(curAllow, VIEW_CHANNEL_BIT, false)
                                            val newDeny = PermissionBits.setBit(curDeny, VIEW_CHANNEL_BIT, true)
                                            restClient.putChannelOverride(
                                                instanceUrl = instanceUrl,
                                                token = token,
                                                channelId = channel.id,
                                                targetType = "role",
                                                targetId = role.id,
                                                allow = newAllow,
                                                deny = newDeny,
                                                overrideVersion = overrideVersion,
                                            )
                                        } else {
                                            val newDeny = PermissionBits.setBit(curDeny, VIEW_CHANNEL_BIT, false)
                                            if (curAllow == "0" && newDeny == "0") {
                                                restClient.deleteChannelOverride(
                                                    instanceUrl = instanceUrl,
                                                    token = token,
                                                    channelId = channel.id,
                                                    targetType = "role",
                                                    targetId = role.id,
                                                    overrideVersion = overrideVersion,
                                                )
                                            } else {
                                                restClient.putChannelOverride(
                                                    instanceUrl = instanceUrl,
                                                    token = token,
                                                    channelId = channel.id,
                                                    targetType = "role",
                                                    targetId = role.id,
                                                    allow = curAllow,
                                                    deny = newDeny,
                                                    overrideVersion = overrideVersion,
                                                )
                                            }
                                        }
                                    }.onSuccess {
                                        reloadOverrides()
                                        statusMessage = if (makePrivate) {
                                            "Canal definido como privado."
                                        } else {
                                            "Canal aberto para @everyone."
                                        }
                                        onChanged()
                                    }.onFailure { err ->
                                        errorMessage = err.message ?: "Erro ao alterar privacidade do canal."
                                    }
                                    isTogglingPrivate = false
                                }
                            },
                        )
                    }
                }

                // Configurações Opus do canal de voz
                if (channel.type == "voice") {
                    OpusOverrideCard(
                        title = "Áudio Opus do Canal",
                        customizeOpus = customizeOpus,
                        onCustomizeChange = { customizeOpus = it },
                        defaultBitrateKbps = defaultBitrateKbps,
                        onDefaultBitrateChange = { next ->
                            defaultBitrateKbps = next
                            if (maxBitrateKbps < next) maxBitrateKbps = next
                        },
                        maxBitrateKbps = maxBitrateKbps,
                        onMaxBitrateChange = { next ->
                            maxBitrateKbps = next
                            if (defaultBitrateKbps > next) defaultBitrateKbps = next
                        },
                        allowMusicMode = allowMusicMode,
                        onAllowMusicModeChange = { allowMusicMode = it },
                        allowStereoAudio = allowStereoAudio,
                        onAllowStereoAudioChange = { allowStereoAudio = it },
                    )
                }

                AetherPrimaryButton(
                    text = if (isSaving) "Salvando..." else "Salvar alterações",
                    enabled = !isSaving && name.trim().isNotEmpty(),
                    onClick = {
                        scope.launch {
                            isSaving = true
                            errorMessage = null
                            statusMessage = null
                            runCatching {
                                restClient.updateChannelFull(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    channelId = channel.id,
                                    name = name.trim(),
                                    topic = if (channel.type == "text") topic.trim() else null,
                                    categoryId = selectedCategoryId ?: "",
                                    defaultAudioBitrateKbps = if (channel.type == "voice" && customizeOpus) defaultBitrateKbps else null,
                                    maxAudioBitrateKbps = if (channel.type == "voice" && customizeOpus) maxBitrateKbps else null,
                                    allowMusicMode = if (channel.type == "voice" && customizeOpus) allowMusicMode else null,
                                    allowStereoAudio = if (channel.type == "voice" && customizeOpus) allowStereoAudio else null,
                                )
                            }.onSuccess {
                                statusMessage = "Canal atualizado com sucesso."
                                onChanged()
                            }.onFailure { err ->
                                errorMessage = err.message ?: "Falha ao atualizar canal."
                            }
                            isSaving = false
                        }
                    },
                )

                HorizontalDivider(color = colors.borderSoft)

                OutlinedButton(
                    onClick = { showDeleteConfirm = true },
                    enabled = !isSaving,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.6f)),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                ) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Excluir Canal")
                }
            }
        } else {
            PermissionOverridesEditor(
                instanceUrl = instanceUrl,
                space = space,
                permissions = if (channel.type == "voice") {
                    PermissionBits.voiceChannelPermissions
                } else {
                    PermissionBits.textChannelPermissions
                },
                overrides = overrides,
                isLoading = loadingOverrides,
                onSaveOverride = { targetType, targetId, allow, deny ->
                    scope.launch {
                        errorMessage = null
                        statusMessage = null
                        runCatching {
                            if (allow == "0" && deny == "0") {
                                restClient.deleteChannelOverride(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    channelId = channel.id,
                                    targetType = targetType,
                                    targetId = targetId,
                                    overrideVersion = overrideVersion,
                                )
                            } else {
                                restClient.putChannelOverride(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    channelId = channel.id,
                                    targetType = targetType,
                                    targetId = targetId,
                                    allow = allow,
                                    deny = deny,
                                    overrideVersion = overrideVersion,
                                )
                            }
                        }.onSuccess {
                            reloadOverrides()
                            statusMessage = "Permissões salvas."
                            onChanged()
                        }.onFailure { err ->
                            errorMessage = err.message ?: "Erro ao salvar permissões."
                        }
                    }
                },
                onDeleteOverride = { targetType, targetId ->
                    scope.launch {
                        errorMessage = null
                        statusMessage = null
                        runCatching {
                            restClient.deleteChannelOverride(
                                instanceUrl = instanceUrl,
                                token = token,
                                channelId = channel.id,
                                targetType = targetType,
                                targetId = targetId,
                                overrideVersion = overrideVersion,
                            )
                        }.onSuccess {
                            reloadOverrides()
                            statusMessage = "Override removido."
                            onChanged()
                        }.onFailure { err ->
                            errorMessage = err.message ?: "Erro ao remover override."
                        }
                    }
                },
                modifier = Modifier.weight(1f),
            )
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            containerColor = colors.bgElevated,
            title = { Text("Excluir canal?", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Tem certeza que deseja excluir o canal \"$titlePrefix${channel.name}\"? Esta ação não pode ser desfeita.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        scope.launch {
                            isSaving = true
                            errorMessage = null
                            runCatching {
                                restClient.deleteChannel(instanceUrl, token, channel.id)
                            }.onSuccess {
                                onDeleted()
                            }.onFailure { err ->
                                errorMessage = err.message ?: "Falha ao excluir canal."
                                isSaving = false
                            }
                        }
                    },
                ) {
                    Text("Excluir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun CategorySettingsHostScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    category: ChannelCategory,
    restClient: BackspaceRestClient,
    onChanged: () -> Unit,
    onDeleted: () -> Unit,
    onBack: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    BackHandler(enabled = true) { onBack() }

    var selectedTab by remember { mutableIntStateOf(0) }
    var name by remember(category.id, category.name) { mutableStateOf(category.name) }

    var customizeOpus by remember(category.id) {
        mutableStateOf(
            category.audioBitrateKbps != null ||
                category.maxAudioBitrateKbps != null ||
                category.allowMusicMode != null ||
                category.allowStereoAudio != null,
        )
    }
    var defaultBitrateKbps by remember(category.id) {
        mutableIntStateOf((category.audioBitrateKbps ?: 64).coerceIn(16, 512))
    }
    var maxBitrateKbps by remember(category.id) {
        mutableIntStateOf((category.maxAudioBitrateKbps ?: 128).coerceIn(16, 512))
    }
    var allowMusicMode by remember(category.id) {
        mutableStateOf(category.allowMusicMode ?: true)
    }
    var allowStereoAudio by remember(category.id) {
        mutableStateOf(category.allowStereoAudio ?: true)
    }

    var overrides by remember(category.id) { mutableStateOf<List<PermissionOverrideItem>>(emptyList()) }
    var overrideVersion by remember(category.id) { mutableStateOf(category.overrideVersion) }
    var loadingOverrides by remember(category.id) { mutableStateOf(true) }
    var isSaving by remember { mutableStateOf(false) }
    var isTogglingPrivate by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    val everyoneRole = remember(space.roles) {
        space.roles.firstOrNull { it.isEveryone || it.isDefault }
    }

    val everyoneOverride = remember(overrides, everyoneRole) {
        everyoneRole?.let { role ->
            overrides.firstOrNull { it.targetType == "role" && it.targetId == role.id }
        }
    }

    val isPrivateCategory = remember(everyoneOverride, loadingOverrides, category.isPrivate) {
        if (loadingOverrides) {
            category.isPrivate
        } else {
            PermissionBits.hasBitStrict(everyoneOverride?.deny, VIEW_CHANNEL_BIT)
        }
    }

    suspend fun reloadOverrides() {
        loadingOverrides = true
        runCatching {
            restClient.getCategoryOverrides(instanceUrl, token, category.id)
        }.onSuccess { resp ->
            overrides = resp.overrides
            overrideVersion = resp.overrideVersion ?: overrideVersion
        }.onFailure { err ->
            errorMessage = err.message ?: "Erro ao carregar permissões da categoria."
        }
        loadingOverrides = false
    }

    LaunchedEffect(category.id) {
        reloadOverrides()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase),
    ) {
        TopAppBar(
            title = {
                Text(
                    text = "Configurar ${category.name}",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = colors.textPrimary,
                )
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
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
            ),
            windowInsets = WindowInsets(0, 0, 0, 0),
        )

        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = colors.bgChannel,
            contentColor = colors.accentPrimary,
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text("Visão Geral") },
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = { Text("Permissões") },
            )
        }

        if (errorMessage != null) {
            Text(
                text = errorMessage.orEmpty(),
                color = colors.accentPeach,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        if (statusMessage != null) {
            Text(
                text = statusMessage.orEmpty(),
                color = colors.accentMint,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }

        if (selectedTab == 0) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                AetherSurfaceCard {
                    Text(
                        text = "Informações da Categoria",
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Nome da categoria") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // Categoria Privada
                AetherSurfaceCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = null,
                                tint = if (isPrivateCategory) colors.accentAmber else colors.textSecondary,
                            )
                            Column {
                                Text(
                                    text = "Categoria Privada",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = colors.textPrimary,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    text = "Nega \"Ver canais\" para @everyone nesta categoria e nos canais que herdarem dela.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        Switch(
                            checked = isPrivateCategory,
                            enabled = everyoneRole != null && !loadingOverrides && !isTogglingPrivate,
                            onCheckedChange = { makePrivate ->
                                val role = everyoneRole ?: return@Switch
                                scope.launch {
                                    isTogglingPrivate = true
                                    errorMessage = null
                                    statusMessage = null
                                    runCatching {
                                        val curAllow = everyoneOverride?.allow ?: "0"
                                        val curDeny = everyoneOverride?.deny ?: "0"
                                        if (makePrivate) {
                                            val newAllow = PermissionBits.setBit(curAllow, VIEW_CHANNEL_BIT, false)
                                            val newDeny = PermissionBits.setBit(curDeny, VIEW_CHANNEL_BIT, true)
                                            restClient.putCategoryOverride(
                                                instanceUrl = instanceUrl,
                                                token = token,
                                                categoryId = category.id,
                                                targetType = "role",
                                                targetId = role.id,
                                                allow = newAllow,
                                                deny = newDeny,
                                                overrideVersion = overrideVersion,
                                            )
                                        } else {
                                            val newDeny = PermissionBits.setBit(curDeny, VIEW_CHANNEL_BIT, false)
                                            if (curAllow == "0" && newDeny == "0") {
                                                restClient.deleteCategoryOverride(
                                                    instanceUrl = instanceUrl,
                                                    token = token,
                                                    categoryId = category.id,
                                                    targetType = "role",
                                                    targetId = role.id,
                                                    overrideVersion = overrideVersion,
                                                )
                                            } else {
                                                restClient.putCategoryOverride(
                                                    instanceUrl = instanceUrl,
                                                    token = token,
                                                    categoryId = category.id,
                                                    targetType = "role",
                                                    targetId = role.id,
                                                    allow = curAllow,
                                                    deny = newDeny,
                                                    overrideVersion = overrideVersion,
                                                )
                                            }
                                        }
                                    }.onSuccess {
                                        reloadOverrides()
                                        statusMessage = if (makePrivate) {
                                            "Categoria definida como privada."
                                        } else {
                                            "Categoria aberta para @everyone."
                                        }
                                        onChanged()
                                    }.onFailure { err ->
                                        errorMessage = err.message ?: "Erro ao alterar privacidade da categoria."
                                    }
                                    isTogglingPrivate = false
                                }
                            },
                        )
                    }
                }

                // Configurações Opus da categoria
                OpusOverrideCard(
                    title = "Áudio Opus da Categoria",
                    customizeOpus = customizeOpus,
                    onCustomizeChange = { customizeOpus = it },
                    defaultBitrateKbps = defaultBitrateKbps,
                    onDefaultBitrateChange = { next ->
                        defaultBitrateKbps = next
                        if (maxBitrateKbps < next) maxBitrateKbps = next
                    },
                    maxBitrateKbps = maxBitrateKbps,
                    onMaxBitrateChange = { next ->
                        maxBitrateKbps = next
                        if (defaultBitrateKbps > next) defaultBitrateKbps = next
                    },
                    allowMusicMode = allowMusicMode,
                    onAllowMusicModeChange = { allowMusicMode = it },
                    allowStereoAudio = allowStereoAudio,
                    onAllowStereoAudioChange = { allowStereoAudio = it },
                )

                AetherPrimaryButton(
                    text = if (isSaving) "Salvando..." else "Salvar alterações",
                    enabled = !isSaving && name.trim().isNotEmpty(),
                    onClick = {
                        scope.launch {
                            isSaving = true
                            errorMessage = null
                            statusMessage = null
                            runCatching {
                                restClient.updateCategory(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    categoryId = category.id,
                                    name = name.trim(),
                                    defaultAudioBitrateKbps = if (customizeOpus) defaultBitrateKbps else null,
                                    maxAudioBitrateKbps = if (customizeOpus) maxBitrateKbps else null,
                                    allowMusicMode = if (customizeOpus) allowMusicMode else null,
                                    allowStereoAudio = if (customizeOpus) allowStereoAudio else null,
                                )
                            }.onSuccess {
                                statusMessage = "Categoria atualizada com sucesso."
                                onChanged()
                            }.onFailure { err ->
                                errorMessage = err.message ?: "Falha ao atualizar categoria."
                            }
                            isSaving = false
                        }
                    },
                )

                HorizontalDivider(color = colors.borderSoft)

                OutlinedButton(
                    onClick = { showDeleteConfirm = true },
                    enabled = !isSaving,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.6f)),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                ) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Excluir Categoria")
                }
            }
        } else {
            PermissionOverridesEditor(
                instanceUrl = instanceUrl,
                space = space,
                permissions = PermissionBits.categoryPermissions,
                overrides = overrides,
                isLoading = loadingOverrides,
                onSaveOverride = { targetType, targetId, allow, deny ->
                    scope.launch {
                        errorMessage = null
                        statusMessage = null
                        runCatching {
                            if (allow == "0" && deny == "0") {
                                restClient.deleteCategoryOverride(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    categoryId = category.id,
                                    targetType = targetType,
                                    targetId = targetId,
                                    overrideVersion = overrideVersion,
                                )
                            } else {
                                restClient.putCategoryOverride(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    categoryId = category.id,
                                    targetType = targetType,
                                    targetId = targetId,
                                    allow = allow,
                                    deny = deny,
                                    overrideVersion = overrideVersion,
                                )
                            }
                        }.onSuccess {
                            reloadOverrides()
                            statusMessage = "Permissões salvas."
                            onChanged()
                        }.onFailure { err ->
                            errorMessage = err.message ?: "Erro ao salvar permissões."
                        }
                    }
                },
                onDeleteOverride = { targetType, targetId ->
                    scope.launch {
                        errorMessage = null
                        statusMessage = null
                        runCatching {
                            restClient.deleteCategoryOverride(
                                instanceUrl = instanceUrl,
                                token = token,
                                categoryId = category.id,
                                targetType = targetType,
                                targetId = targetId,
                                overrideVersion = overrideVersion,
                            )
                        }.onSuccess {
                            reloadOverrides()
                            statusMessage = "Override removido."
                            onChanged()
                        }.onFailure { err ->
                            errorMessage = err.message ?: "Erro ao remover override."
                        }
                    }
                },
                modifier = Modifier.weight(1f),
            )
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            containerColor = colors.bgElevated,
            title = { Text("Excluir categoria?", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Tem certeza que deseja excluir a categoria \"${category.name}\"? Os canais dentro dela ficarão sem categoria.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        scope.launch {
                            isSaving = true
                            errorMessage = null
                            runCatching {
                                restClient.deleteCategory(instanceUrl, token, category.id)
                            }.onSuccess {
                                onDeleted()
                            }.onFailure { err ->
                                errorMessage = err.message ?: "Falha ao excluir categoria."
                                isSaving = false
                            }
                        }
                    },
                ) {
                    Text("Excluir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CreateChannelOrCategoryDialog(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
    onCreated: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var createCategoryMode by remember { mutableStateOf(false) }
    var channelType by remember { mutableStateOf("text") }
    var name by remember { mutableStateOf("") }
    var topic by remember { mutableStateOf("") }
    var selectedCategoryId by remember { mutableStateOf<String?>(null) }
    var isSaving by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = { if (!isSaving) onDismiss() },
        containerColor = colors.bgElevated,
        title = {
            Text(
                text = if (createCategoryMode) "Nova Categoria" else "Novo Canal",
                color = colors.textPrimary,
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = !createCategoryMode,
                        onClick = { createCategoryMode = false },
                        label = { Text("Novo Canal") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                            selectedLabelColor = colors.textPrimary,
                        ),
                    )
                    FilterChip(
                        selected = createCategoryMode,
                        onClick = { createCategoryMode = true },
                        label = { Text("Nova Categoria") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                            selectedLabelColor = colors.textPrimary,
                        ),
                    )
                }

                if (!createCategoryMode) {
                    Text(
                        text = "Tipo do canal",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textSecondary,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = channelType == "text",
                            onClick = { channelType = "text" },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.Tag,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                )
                            },
                            label = { Text("Texto") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                                selectedLabelColor = colors.textPrimary,
                            ),
                        )
                        FilterChip(
                            selected = channelType == "voice",
                            onClick = { channelType = "voice" },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.VolumeUp,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                )
                            },
                            label = { Text("Voz") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                                selectedLabelColor = colors.textPrimary,
                            ),
                        )
                    }
                }

                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = {
                        Text(if (createCategoryMode) "Nome da categoria" else "Nome do canal")
                    },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                if (!createCategoryMode && channelType == "text") {
                    OutlinedTextField(
                        value = topic,
                        onValueChange = { topic = it },
                        label = { Text("Tópico (opcional)") },
                        maxLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                if (!createCategoryMode) {
                    Text(
                        text = "Categoria pai",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textSecondary,
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        FilterChip(
                            selected = selectedCategoryId == null,
                            onClick = { selectedCategoryId = null },
                            label = { Text("Sem categoria") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                                selectedLabelColor = colors.textPrimary,
                            ),
                        )
                        space.categories.sortedBy { it.position }.forEach { cat ->
                            FilterChip(
                                selected = selectedCategoryId == cat.id,
                                onClick = { selectedCategoryId = cat.id },
                                label = { Text(cat.name) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                                    selectedLabelColor = colors.textPrimary,
                                ),
                            )
                        }
                    }
                }

                if (errorMessage != null) {
                    Text(
                        text = errorMessage.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.accentPeach,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !isSaving && name.trim().isNotEmpty(),
                onClick = {
                    scope.launch {
                        isSaving = true
                        errorMessage = null
                        runCatching {
                            if (createCategoryMode) {
                                restClient.createCategory(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    spaceId = space.id,
                                    name = name.trim(),
                                )
                            } else {
                                restClient.createChannelInCategory(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    spaceId = space.id,
                                    name = name.trim(),
                                    type = channelType,
                                    topic = if (channelType == "text") topic.trim().ifBlank { null } else null,
                                    categoryId = selectedCategoryId,
                                )
                            }
                        }.onSuccess {
                            onCreated()
                            onDismiss()
                        }.onFailure { err ->
                            errorMessage = err.message ?: "Falha ao criar item."
                            isSaving = false
                        }
                    }
                },
            ) {
                Text(
                    text = if (isSaving) "Criando..." else "Criar",
                    color = colors.accentPrimary,
                )
            }
        },
        dismissButton = {
            TextButton(
                enabled = !isSaving,
                onClick = onDismiss,
            ) {
                Text("Cancelar", color = colors.textSecondary)
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReorderSpaceStructureDialog(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
    onSaved: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var orderedCategories by remember(space.id, space.categories) {
        mutableStateOf(space.categories.sortedBy { it.position })
    }
    var orderedChannels by remember(space.id, space.channels) {
        mutableStateOf(space.channels.sortedBy { it.position })
    }
    var isSaving by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun moveCategory(index: Int, delta: Int) {
        val target = index + delta
        if (target !in orderedCategories.indices) return
        val mutable = orderedCategories.toMutableList()
        val item = mutable.removeAt(index)
        mutable.add(target, item)
        orderedCategories = mutable
    }

    fun moveChannelInGroup(categoryId: String?, channelId: String, delta: Int) {
        val group = orderedChannels.filter { it.categoryId == categoryId }
        val index = group.indexOfFirst { it.id == channelId }
        val target = index + delta
        if (index < 0 || target !in group.indices) return
        val swappedGroup = group.toMutableList()
        val item = swappedGroup.removeAt(index)
        swappedGroup.add(target, item)
        val others = orderedChannels.filter { it.categoryId != categoryId }
        orderedChannels = others + swappedGroup
    }

    AlertDialog(
        onDismissRequest = { if (!isSaving) onDismiss() },
        containerColor = colors.bgElevated,
        title = {
            Text(
                text = "Reordenar Espaço",
                color = colors.textPrimary,
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 440.dp),
            ) {
                if (errorMessage != null) {
                    Text(
                        text = errorMessage.orEmpty(),
                        color = colors.accentPeach,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }

                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (orderedCategories.isNotEmpty()) {
                        item(key = "header_categories") {
                            Text(
                                text = "Categorias",
                                style = MaterialTheme.typography.labelLarge,
                                color = colors.textSecondary,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        items(
                            items = orderedCategories,
                            key = { "cat_${it.id}" },
                        ) { cat ->
                            val idx = orderedCategories.indexOfFirst { it.id == cat.id }
                            ReorderRow(
                                icon = {
                                    Icon(
                                        imageVector = Icons.Default.Folder,
                                        contentDescription = null,
                                        tint = colors.accentSky,
                                        modifier = Modifier.size(18.dp),
                                    )
                                },
                                label = cat.name,
                                canMoveUp = idx > 0,
                                canMoveDown = idx in 0 until orderedCategories.lastIndex,
                                onMoveUp = { moveCategory(idx, -1) },
                                onMoveDown = { moveCategory(idx, 1) },
                            )
                        }
                    }

                    val uncategorized = orderedChannels.filter { it.categoryId == null }
                    if (uncategorized.isNotEmpty()) {
                        item(key = "header_uncategorized") {
                            Spacer(Modifier.height(6.dp))
                            Text(
                                text = "Canais sem categoria",
                                style = MaterialTheme.typography.labelLarge,
                                color = colors.textSecondary,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        items(
                            items = uncategorized,
                            key = { "ch_null_${it.id}" },
                        ) { ch ->
                            val idx = uncategorized.indexOfFirst { it.id == ch.id }
                            ReorderRow(
                                icon = {
                                    Icon(
                                        imageVector = if (ch.isVoice) {
                                            Icons.AutoMirrored.Filled.VolumeUp
                                        } else {
                                            Icons.Default.Tag
                                        },
                                        contentDescription = null,
                                        tint = colors.textSecondary,
                                        modifier = Modifier.size(18.dp),
                                    )
                                },
                                label = ch.name,
                                canMoveUp = idx > 0,
                                canMoveDown = idx in 0 until uncategorized.lastIndex,
                                onMoveUp = { moveChannelInGroup(null, ch.id, -1) },
                                onMoveDown = { moveChannelInGroup(null, ch.id, 1) },
                            )
                        }
                    }

                    orderedCategories.forEach { cat ->
                        val catChannels = orderedChannels.filter { it.categoryId == cat.id }
                        if (catChannels.isNotEmpty()) {
                            item(key = "header_cat_ch_${cat.id}") {
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    text = "Canais em ${cat.name}",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = colors.textSecondary,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                            items(
                                items = catChannels,
                                key = { "ch_${cat.id}_${it.id}" },
                            ) { ch ->
                                val idx = catChannels.indexOfFirst { it.id == ch.id }
                                ReorderRow(
                                    icon = {
                                        Icon(
                                            imageVector = if (ch.isVoice) {
                                                Icons.AutoMirrored.Filled.VolumeUp
                                            } else {
                                                Icons.Default.Tag
                                            },
                                            contentDescription = null,
                                            tint = colors.textSecondary,
                                            modifier = Modifier.size(18.dp),
                                        )
                                    },
                                    label = ch.name,
                                    canMoveUp = idx > 0,
                                    canMoveDown = idx in 0 until catChannels.lastIndex,
                                    onMoveUp = { moveChannelInGroup(cat.id, ch.id, -1) },
                                    onMoveDown = { moveChannelInGroup(cat.id, ch.id, 1) },
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !isSaving,
                onClick = {
                    scope.launch {
                        isSaving = true
                        errorMessage = null
                        val categoryItems = orderedCategories.mapIndexed { idx, cat ->
                            CategoryLayoutItem(
                                id = cat.id,
                                position = idx,
                                parentId = cat.parentId,
                            )
                        }
                        val channelItems = buildList {
                            orderedChannels
                                .filter { it.categoryId == null }
                                .forEachIndexed { idx, ch ->
                                    add(ChannelLayoutItem(id = ch.id, position = idx, categoryId = null))
                                }
                            orderedCategories.forEach { cat ->
                                orderedChannels
                                    .filter { it.categoryId == cat.id }
                                    .forEachIndexed { idx, ch ->
                                        add(ChannelLayoutItem(id = ch.id, position = idx, categoryId = cat.id))
                                    }
                            }
                            // Garante que canais com categoryId órfão não sejam perdidos
                            val knownCatIds = orderedCategories.map { it.id }.toSet()
                            orderedChannels
                                .filter { it.categoryId != null && it.categoryId !in knownCatIds }
                                .forEachIndexed { idx, ch ->
                                    add(ChannelLayoutItem(id = ch.id, position = idx, categoryId = ch.categoryId))
                                }
                        }
                        runCatching {
                            restClient.updateChannelLayout(
                                instanceUrl = instanceUrl,
                                token = token,
                                spaceId = space.id,
                                channels = channelItems,
                                categories = categoryItems,
                            )
                        }.onSuccess {
                            onSaved()
                            onDismiss()
                        }.onFailure { err ->
                            errorMessage = err.message ?: "Falha ao salvar ordem do Espaço."
                            isSaving = false
                        }
                    }
                },
            ) {
                Text(
                    text = if (isSaving) "Salvando..." else "Salvar",
                    color = colors.accentPrimary,
                )
            }
        },
        dismissButton = {
            TextButton(
                enabled = !isSaving,
                onClick = onDismiss,
            ) {
                Text("Cancelar", color = colors.textSecondary)
            }
        },
    )
}

@Composable
private fun ReorderRow(
    icon: @Composable () -> Unit,
    label: String,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
) {
    val colors = LocalAetherColors.current
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = colors.bgChannel,
        border = BorderStroke(1.dp, colors.borderSoft),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon()
            Spacer(Modifier.width(8.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = onMoveUp,
                enabled = canMoveUp,
                modifier = Modifier.size(34.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.KeyboardArrowUp,
                    contentDescription = "Mover para cima",
                    tint = if (canMoveUp) colors.textPrimary else colors.textTertiary,
                )
            }
            IconButton(
                onClick = onMoveDown,
                enabled = canMoveDown,
                modifier = Modifier.size(34.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.KeyboardArrowDown,
                    contentDescription = "Mover para baixo",
                    tint = if (canMoveDown) colors.textPrimary else colors.textTertiary,
                )
            }
        }
    }
}

@Composable
private fun OpusOverrideCard(
    title: String,
    customizeOpus: Boolean,
    onCustomizeChange: (Boolean) -> Unit,
    defaultBitrateKbps: Int,
    onDefaultBitrateChange: (Int) -> Unit,
    maxBitrateKbps: Int,
    onMaxBitrateChange: (Int) -> Unit,
    allowMusicMode: Boolean,
    onAllowMusicModeChange: (Boolean) -> Unit,
    allowStereoAudio: Boolean,
    onAllowStereoAudioChange: (Boolean) -> Unit,
) {
    val colors = LocalAetherColors.current
    AetherSurfaceCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    color = colors.textPrimary,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = if (customizeOpus) {
                        "Valores personalizados sobrescrevem o padrão do Espaço."
                    } else {
                        "Herdando política de áudio do Espaço."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            Switch(
                checked = customizeOpus,
                onCheckedChange = onCustomizeChange,
            )
        }

        if (customizeOpus) {
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Bitrate padrão: $defaultBitrateKbps kbps",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = defaultBitrateKbps.toFloat(),
                onValueChange = { onDefaultBitrateChange((it / 8f).roundToInt() * 8) },
                valueRange = 16f..512f,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(6.dp))
            Text(
                text = "Bitrate máximo: $maxBitrateKbps kbps",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = maxBitrateKbps.toFloat(),
                onValueChange = { onMaxBitrateChange((it / 8f).roundToInt() * 8) },
                valueRange = 16f..512f,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "Permitir Modo Música",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
                Switch(
                    checked = allowMusicMode,
                    onCheckedChange = onAllowMusicModeChange,
                )
            }

            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "Permitir Áudio Estéreo",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
                Switch(
                    checked = allowStereoAudio,
                    onCheckedChange = onAllowStereoAudioChange,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun PermissionOverridesEditor(
    instanceUrl: String,
    space: Space,
    permissions: List<PermissionDescriptor>,
    overrides: List<PermissionOverrideItem>,
    isLoading: Boolean,
    onSaveOverride: (targetType: String, targetId: String, allow: String, deny: String) -> Unit,
    onDeleteOverride: (targetType: String, targetId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalAetherColors.current

    var targetFilter by remember { mutableStateOf("role") } // "role" | "member"
    val sortedRoles = remember(space.roles) {
        space.roles.sortedWith(
            compareByDescending<Role> { it.isEveryone || it.isDefault }
                .thenByDescending { it.position },
        )
    }
    val sortedMembers = remember(space.members) {
        space.members.sortedBy { it.label.lowercase() }
    }

    var selectedTargetType by remember(space.id) { mutableStateOf("role") }
    var selectedTargetId by remember(space.id, sortedRoles) {
        mutableStateOf(sortedRoles.firstOrNull()?.id.orEmpty())
    }

    val currentSavedOverride = remember(overrides, selectedTargetType, selectedTargetId) {
        overrides.firstOrNull {
            it.targetType == selectedTargetType && it.targetId == selectedTargetId
        }
    }

    var draftAllow by remember(selectedTargetType, selectedTargetId, currentSavedOverride) {
        mutableStateOf(currentSavedOverride?.allow ?: "0")
    }
    var draftDeny by remember(selectedTargetType, selectedTargetId, currentSavedOverride) {
        mutableStateOf(currentSavedOverride?.deny ?: "0")
    }

    if (isLoading) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = colors.accentPrimary)
        }
        return
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "target_selector") {
            AetherSurfaceCard {
                Text(
                    text = "Alvo da Permissão",
                    style = MaterialTheme.typography.titleSmall,
                    color = colors.textPrimary,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = targetFilter == "role",
                        onClick = {
                            targetFilter = "role"
                            selectedTargetType = "role"
                            if (sortedRoles.none { it.id == selectedTargetId }) {
                                selectedTargetId = sortedRoles.firstOrNull()?.id.orEmpty()
                            }
                        },
                        label = { Text("Cargos (${sortedRoles.size})") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                            selectedLabelColor = colors.textPrimary,
                        ),
                    )
                    FilterChip(
                        selected = targetFilter == "member",
                        onClick = {
                            targetFilter = "member"
                            selectedTargetType = "member"
                            if (sortedMembers.none { it.userId == selectedTargetId }) {
                                selectedTargetId = sortedMembers.firstOrNull()?.userId.orEmpty()
                            }
                        },
                        label = { Text("Membros (${sortedMembers.size})") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = colors.accentPrimary.copy(alpha = 0.25f),
                            selectedLabelColor = colors.textPrimary,
                        ),
                    )
                }

                Spacer(Modifier.height(10.dp))

                if (targetFilter == "role") {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        sortedRoles.forEach { role ->
                            val hasOverride = overrides.any { it.targetType == "role" && it.targetId == role.id }
                            val displayName = if (role.isEveryone || role.isDefault) "@everyone" else role.name
                            FilterChip(
                                selected = selectedTargetType == "role" && selectedTargetId == role.id,
                                onClick = {
                                    selectedTargetType = "role"
                                    selectedTargetId = role.id
                                },
                                label = {
                                    Text(if (hasOverride) "$displayName •" else displayName)
                                },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = colors.accentPrimary.copy(alpha = 0.28f),
                                    selectedLabelColor = colors.textPrimary,
                                ),
                            )
                        }
                    }
                } else {
                    if (sortedMembers.isEmpty()) {
                        Text(
                            text = "Nenhum membro disponível.",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    } else {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            sortedMembers.forEach { member ->
                                val hasOverride = overrides.any {
                                    it.targetType == "member" && it.targetId == member.userId
                                }
                                FilterChip(
                                    selected = selectedTargetType == "member" && selectedTargetId == member.userId,
                                    onClick = {
                                        selectedTargetType = "member"
                                        selectedTargetId = member.userId
                                    },
                                    leadingIcon = {
                                        AetherAvatar(
                                            imageUrl = member.user?.avatarUrl(instanceUrl),
                                            fallbackLabel = member.label,
                                            size = 20.dp,
                                        )
                                    },
                                    label = {
                                        Text(
                                            text = if (hasOverride) "${member.label} •" else member.label,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = colors.accentPrimary.copy(alpha = 0.28f),
                                        selectedLabelColor = colors.textPrimary,
                                    ),
                                )
                            }
                        }
                    }
                }

                if (currentSavedOverride != null && selectedTargetId.isNotBlank()) {
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = { onDeleteOverride(selectedTargetType, selectedTargetId) },
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.6f)),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Delete,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text("Remover override deste alvo")
                    }
                }
            }
        }

        if (selectedTargetId.isNotBlank()) {
            items(
                items = permissions,
                key = { "perm_${it.bit}" },
            ) { perm ->
                val state = when {
                    PermissionBits.hasBitStrict(draftDeny, perm.bit) -> TriState.DENY
                    PermissionBits.hasBitStrict(draftAllow, perm.bit) -> TriState.ALLOW
                    else -> TriState.INHERIT
                }

                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = colors.bgChannel,
                    border = BorderStroke(1.dp, colors.borderSoft),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = perm.name,
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.textPrimary,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                text = perm.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                            )
                        }

                        TriStateToggle(
                            state = state,
                            onStateChange = { next ->
                                when (next) {
                                    TriState.DENY -> {
                                        draftAllow = PermissionBits.setBit(draftAllow, perm.bit, false)
                                        draftDeny = PermissionBits.setBit(draftDeny, perm.bit, true)
                                    }
                                    TriState.INHERIT -> {
                                        draftAllow = PermissionBits.setBit(draftAllow, perm.bit, false)
                                        draftDeny = PermissionBits.setBit(draftDeny, perm.bit, false)
                                    }
                                    TriState.ALLOW -> {
                                        draftAllow = PermissionBits.setBit(draftAllow, perm.bit, true)
                                        draftDeny = PermissionBits.setBit(draftDeny, perm.bit, false)
                                    }
                                }
                            },
                        )
                    }
                }
            }

            item(key = "save_override_btn") {
                Spacer(Modifier.height(4.dp))
                AetherPrimaryButton(
                    text = "Salvar permissões",
                    onClick = {
                        onSaveOverride(selectedTargetType, selectedTargetId, draftAllow, draftDeny)
                    },
                )
            }
        }
    }
}

@Composable
private fun TriStateToggle(
    state: TriState,
    onStateChange: (TriState) -> Unit,
) {
    val colors = LocalAetherColors.current
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = colors.bgInput,
        border = BorderStroke(1.dp, colors.borderSoft),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Negar ✕
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(topStart = 9.dp, bottomStart = 9.dp))
                    .background(
                        if (state == TriState.DENY) colors.accentPeach.copy(alpha = 0.25f) else Color.Transparent,
                    )
                    .clickable { onStateChange(TriState.DENY) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Negar",
                    tint = if (state == TriState.DENY) colors.accentPeach else colors.textTertiary,
                    modifier = Modifier.size(16.dp),
                )
            }

            // Herdar /
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .background(
                        if (state == TriState.INHERIT) colors.bgElevated else Color.Transparent,
                    )
                    .clickable { onStateChange(TriState.INHERIT) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "/",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = if (state == TriState.INHERIT) colors.textPrimary else colors.textTertiary,
                )
            }

            // Permitir ✓
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(topEnd = 9.dp, bottomEnd = 9.dp))
                    .background(
                        if (state == TriState.ALLOW) colors.accentMint.copy(alpha = 0.25f) else Color.Transparent,
                    )
                    .clickable { onStateChange(TriState.ALLOW) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = "Permitir",
                    tint = if (state == TriState.ALLOW) colors.accentMint else colors.textTertiary,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}
