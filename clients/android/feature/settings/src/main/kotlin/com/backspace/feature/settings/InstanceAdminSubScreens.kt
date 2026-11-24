package com.backspace.feature.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherPrimaryButton
import com.backspace.core.designsystem.AetherPurpleSlider
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.AdminInviteItem
import com.backspace.core.model.AdminInviteRedemption
import com.backspace.core.model.AdminTelemetryStatus
import com.backspace.core.model.AdminUserItem
import com.backspace.core.model.AdminUsersPageResponse
import com.backspace.core.model.FederationApprovalItem
import com.backspace.core.model.FederationPeerItem
import com.backspace.core.model.FederationResetEventItem
import com.backspace.core.model.InstanceAdminSettings
import com.backspace.core.model.InstanceStreamingLimits
import com.backspace.core.model.InstanceUpdateStatusResponse
import com.backspace.core.model.SoundboardSound
import com.backspace.core.model.StorageCleanupResult
import com.backspace.core.model.StorageStatsResponse
import com.backspace.core.network.BackspaceRestClient
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// ─────────────────────────────────────────────────────────────────────────────
// Helpers compartilhados
// ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun AdminStatusBanner(
    message: String?,
    isError: Boolean = false,
) {
    if (message.isNullOrBlank()) return
    val colors = LocalAetherColors.current
    val tint = if (isError) colors.accentPeach else colors.accentMint
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = tint.copy(alpha = 0.14f),
        border = BorderStroke(1.dp, tint.copy(alpha = 0.35f)),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = tint,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun AdminToggleRow(
    title: String,
    subtitle: String? = null,
    checked: Boolean,
    enabled: Boolean = true,
    onCheckedChange: (Boolean) -> Unit,
) {
    val colors = LocalAetherColors.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = colors.textPrimary,
            )
            if (!subtitle.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
        )
    }
}

@Composable
private fun AdminBadge(
    text: String,
    color: Color,
) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = color.copy(alpha = 0.16f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.35f)),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun MissingInitialDataCard(
    isLoading: Boolean,
    label: String,
    onRetry: () -> Unit,
) {
    val colors = LocalAetherColors.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (isLoading) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = colors.accentPrimary,
                trackColor = colors.interactiveMuted,
            )
            Text(
                text = "Carregando $label...",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
        } else {
            AetherSurfaceCard {
                Text(
                    text = "Não foi possível carregar $label.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.accentPeach,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = onRetry) {
                    Text("Tentar novamente", color = colors.textPrimary)
                }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes < 1024L) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024.0) return String.format(Locale.getDefault(), "%.1f KB", kb)
    val mb = kb / 1024.0
    if (mb < 1024.0) return String.format(Locale.getDefault(), "%.2f MB", mb)
    val gb = mb / 1024.0
    return String.format(Locale.getDefault(), "%.2f GB", gb)
}

private fun formatTimestamp(epochMs: Long?): String {
    if (epochMs == null || epochMs <= 0L) return "—"
    return runCatching {
        val sdf = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault())
        sdf.format(Date(epochMs))
    }.getOrDefault("—")
}

private fun prettyPrintJson(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return "{}"
    return runCatching {
        when {
            trimmed.startsWith("{") -> JSONObject(trimmed).toString(2)
            trimmed.startsWith("[") -> JSONArray(trimmed).toString(2)
            else -> trimmed
        }
    }.getOrDefault(trimmed)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Geral
// ─────────────────────────────────────────────────────────────────────────────

@Composable
fun InstanceGeneralSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    settings: InstanceAdminSettings?,
    isLoadingInitial: Boolean,
    onSettingsUpdated: (InstanceAdminSettings) -> Unit,
    onRetryLoad: () -> Unit,
) {
    if (settings == null) {
        MissingInitialDataCard(
            isLoading = isLoadingInitial,
            label = "configurações gerais",
            onRetry = onRetryLoad,
        )
        return
    }

    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var instanceName by remember(settings) { mutableStateOf(settings.instanceName.take(32)) }
    var discoveryLevel by remember(settings) {
        mutableIntStateOf(
            when {
                settings.discoveryEnabled && settings.directoryEnabled -> 2
                settings.discoveryEnabled -> 1
                else -> 0
            },
        )
    }
    var directoryBrowseEnabled by remember(settings) { mutableStateOf(settings.directoryBrowseEnabled) }
    var gifApiKeyInput by remember(settings) { mutableStateOf("") }
    var supportCardEnabled by remember(settings) { mutableStateOf(settings.supportCardEnabled) }
    var isSaving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        AetherSurfaceCard {
            Text(
                text = "Identidade da Instância",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = instanceName,
                onValueChange = { if (it.length <= 32) instanceName = it },
                label = { Text("Nome da instância") },
                supportingText = { Text("${instanceName.length}/32 caracteres") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        AetherSurfaceCard {
            Text(
                text = "Escada de Descoberta",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Controla como Espaços públicos desta instância podem ser encontrados.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))

            val levels = listOf(
                Triple(0, "Apenas convite", "Descoberta desativada. Usuários só entram por link de convite."),
                Triple(1, "Descoberta local", "Espaços públicos aparecem na busca local desta instância."),
                Triple(2, "Diretório global", "Espaços públicos também são publicados no diretório global."),
            )
            levels.forEach { (level, title, desc) ->
                val selected = discoveryLevel == level
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable { discoveryLevel = level },
                    shape = RoundedCornerShape(12.dp),
                    color = if (selected) colors.accentPrimary.copy(alpha = 0.14f) else colors.bgElevated,
                    border = BorderStroke(
                        1.dp,
                        if (selected) colors.accentPrimary else colors.borderSoft,
                    ),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = selected,
                            onClick = { discoveryLevel = level },
                            colors = RadioButtonDefaults.colors(selectedColor = colors.accentPrimary),
                        )
                        Spacer(Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = title,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                color = colors.textPrimary,
                            )
                            Text(
                                text = desc,
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = colors.borderSoft)
            Spacer(Modifier.height(10.dp))

            Text(
                text = "Status do Diretório",
                style = MaterialTheme.typography.labelLarge,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Espaços listados: ${settings.directoryListedSpaceCount}",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            if (settings.directoryLastPingAt != null) {
                Text(
                    text = "Último ping: ${formatTimestamp(settings.directoryLastPingAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            if (!settings.directoryLastError.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Último erro: ${settings.directoryLastError}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.accentPeach,
                )
            }

            Spacer(Modifier.height(12.dp))
            AdminToggleRow(
                title = "Navegar no diretório global",
                subtitle = "Permite que usuários desta instância explorem Espaços do diretório global.",
                checked = directoryBrowseEnabled,
                onCheckedChange = { directoryBrowseEnabled = it },
            )
        }

        AetherSurfaceCard {
            Text(
                text = "GIFs e Cartão de Apoio",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = "Chave API de GIFs:",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                AdminBadge(
                    text = if (settings.gifApiKey != null) "Configurada" else "Não configurada",
                    color = if (settings.gifApiKey != null) colors.accentMint else colors.textSecondary,
                )
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = gifApiKeyInput,
                onValueChange = { gifApiKeyInput = it },
                label = { Text("Nova chave API GIFs (opcional)") },
                placeholder = { Text("Deixe em branco para manter a chave atual") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(14.dp))
            AdminToggleRow(
                title = "Exibir cartão de apoio",
                subtitle = "Mostra o cartão informativo de apoio ao projeto na interface.",
                checked = supportCardEnabled,
                onCheckedChange = { supportCardEnabled = it },
            )
        }

        AetherPrimaryButton(
            text = if (isSaving) "Salvando..." else "Salvar configurações gerais",
            enabled = !isSaving && instanceName.isNotBlank(),
            onClick = {
                scope.launch {
                    isSaving = true
                    feedback = null
                    val updatedPayload = settings.copy(
                        instanceName = instanceName.trim().take(32),
                        discoveryEnabled = discoveryLevel >= 1,
                        directoryEnabled = discoveryLevel == 2,
                        directoryBrowseEnabled = directoryBrowseEnabled,
                        gifApiKey = gifApiKeyInput.trim().takeIf { it.isNotEmpty() },
                        supportCardEnabled = supportCardEnabled,
                    )
                    runCatching {
                        restClient.updateInstanceAdminSettings(instanceUrl, token, updatedPayload)
                    }.onSuccess { saved ->
                        onSettingsUpdated(saved)
                        gifApiKeyInput = ""
                        feedback = "Configurações gerais salvas com sucesso." to false
                    }.onFailure { err ->
                        feedback = "Erro ao salvar: ${err.message ?: "desconhecido"}" to true
                    }
                    isSaving = false
                }
            },
        )
        Spacer(Modifier.height(16.dp))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Registro e Convites
// ─────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InstanceRegistrationSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    settings: InstanceAdminSettings?,
    isLoadingInitial: Boolean,
    onSettingsUpdated: (InstanceAdminSettings) -> Unit,
    onRetryLoad: () -> Unit,
) {
    if (settings == null) {
        MissingInitialDataCard(
            isLoading = isLoadingInitial,
            label = "configurações de registro",
            onRetry = onRetryLoad,
        )
        return
    }

    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var registrationOpen by remember(settings) { mutableStateOf(settings.registrationOpen) }
    var federatedRegistrationOpen by remember(settings) { mutableStateOf(settings.federatedRegistrationOpen) }
    var isSavingSettings by remember { mutableStateOf(false) }

    var inviteTab by remember { mutableIntStateOf(0) } // 0 = Ativos, 1 = Arquivados
    var invites by remember { mutableStateOf<List<AdminInviteItem>>(emptyList()) }
    var isLoadingInvites by remember { mutableStateOf(true) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    var showCreateDialog by remember { mutableStateOf(false) }
    var newInviteName by remember { mutableStateOf("") }
    var newInviteMaxUses by remember { mutableStateOf("") }
    var newInviteExpiresHours by remember { mutableStateOf("") }

    var redemptionsTarget by remember { mutableStateOf<AdminInviteItem?>(null) }
    var redemptionsList by remember { mutableStateOf<List<AdminInviteRedemption>>(emptyList()) }
    var isLoadingRedemptions by remember { mutableStateOf(false) }

    var deleteConfirmInvite by remember { mutableStateOf<AdminInviteItem?>(null) }

    fun reloadInvites() {
        scope.launch {
            isLoadingInvites = true
            runCatching { restClient.getAdminInvites(instanceUrl, token, status = null) }
                .onSuccess { invites = it }
                .onFailure { feedback = "Erro ao carregar convites: ${it.message ?: "desconhecido"}" to true }
            isLoadingInvites = false
        }
    }

    LaunchedEffect(instanceUrl, token) {
        reloadInvites()
    }

    val displayedInvites = remember(invites, inviteTab) {
        if (inviteTab == 0) {
            invites.filter { it.status == "active" }
        } else {
            invites.filter { it.status != "active" }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        AetherSurfaceCard {
            Text(
                text = "Política de Registro",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            AdminToggleRow(
                title = "Registro aberto",
                subtitle = "Permite criar contas diretamente sem exigir link de convite.",
                checked = registrationOpen,
                onCheckedChange = { registrationOpen = it },
            )
            Spacer(Modifier.height(12.dp))
            AdminToggleRow(
                title = "Registro federado aberto",
                subtitle = "Permite que usuários de instâncias federadas ingressem automaticamente.",
                checked = federatedRegistrationOpen,
                onCheckedChange = { federatedRegistrationOpen = it },
            )
            Spacer(Modifier.height(14.dp))
            AetherPrimaryButton(
                text = if (isSavingSettings) "Salvando..." else "Salvar política de registro",
                enabled = !isSavingSettings,
                onClick = {
                    scope.launch {
                        isSavingSettings = true
                        feedback = null
                        val updated = settings.copy(
                            registrationOpen = registrationOpen,
                            federatedRegistrationOpen = federatedRegistrationOpen,
                            gifApiKey = null,
                        )
                        runCatching {
                            restClient.updateInstanceAdminSettings(instanceUrl, token, updated)
                        }.onSuccess { saved ->
                            onSettingsUpdated(saved)
                            feedback = "Política de registro salva." to false
                        }.onFailure { err ->
                            feedback = "Erro ao salvar: ${err.message ?: "desconhecido"}" to true
                        }
                        isSavingSettings = false
                    }
                },
            )
        }

        AetherSurfaceCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Convites da Instância",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { reloadInvites() }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "Atualizar", tint = colors.textSecondary)
                }
            }
            Spacer(Modifier.height(8.dp))
            AetherPrimaryButton(
                text = "+ Novo Convite",
                onClick = {
                    newInviteName = ""
                    newInviteMaxUses = ""
                    newInviteExpiresHours = ""
                    showCreateDialog = true
                },
            )
            Spacer(Modifier.height(12.dp))

            TabRow(
                selectedTabIndex = inviteTab,
                containerColor = colors.bgElevated,
                contentColor = colors.accentPrimary,
            ) {
                Tab(
                    selected = inviteTab == 0,
                    onClick = { inviteTab = 0 },
                    text = { Text("Ativos (${invites.count { it.status == "active" }})") },
                )
                Tab(
                    selected = inviteTab == 1,
                    onClick = { inviteTab = 1 },
                    text = { Text("Arquivados (${invites.count { it.status != "active" }})") },
                )
            }

            Spacer(Modifier.height(10.dp))
            if (isLoadingInvites) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = colors.accentPrimary,
                    trackColor = colors.interactiveMuted,
                )
            } else if (displayedInvites.isEmpty()) {
                Text(
                    text = if (inviteTab == 0) "Nenhum convite ativo." else "Nenhum convite arquivado.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    displayedInvites.forEach { invite ->
                        val statusColor = when (invite.status) {
                            "active" -> colors.accentMint
                            "revoked" -> colors.accentPeach
                            else -> colors.accentAmber
                        }
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = colors.bgElevated,
                            border = BorderStroke(1.dp, colors.borderSoft),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = invite.name.ifBlank { "Convite sem nome" },
                                        style = MaterialTheme.typography.titleSmall,
                                        color = colors.textPrimary,
                                        modifier = Modifier.weight(1f),
                                    )
                                    AdminBadge(text = invite.status, color = statusColor)
                                }
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = "Usos: ${invite.usedCount} / ${invite.maxUses?.toString() ?: "∞"} • Criado em ${formatTimestamp(invite.createdAt)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                                if (invite.expiresAt != null) {
                                    Text(
                                        text = "Expira em: ${formatTimestamp(invite.expiresAt)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.textSecondary,
                                    )
                                }
                                Spacer(Modifier.height(8.dp))
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    OutlinedButton(
                                        onClick = {
                                            val link = invite.url.ifBlank { invite.token }
                                            clipboard.setText(AnnotatedString(link))
                                            feedback = "URL do convite copiada." to false
                                        },
                                    ) {
                                        Icon(Icons.Filled.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("Copiar URL")
                                    }

                                    OutlinedButton(
                                        onClick = {
                                            redemptionsTarget = invite
                                            redemptionsList = emptyList()
                                            isLoadingRedemptions = true
                                            scope.launch {
                                                runCatching {
                                                    restClient.getAdminInviteRedemptions(instanceUrl, token, invite.id)
                                                }.onSuccess { redemptionsList = it }
                                                    .onFailure {
                                                        feedback = "Erro ao buscar resgates: ${it.message ?: "desconhecido"}" to true
                                                    }
                                                isLoadingRedemptions = false
                                            }
                                        },
                                    ) {
                                        Text("Ver Resgates")
                                    }

                                    if (invite.status == "active") {
                                        OutlinedButton(
                                            onClick = {
                                                scope.launch {
                                                    runCatching {
                                                        restClient.revokeAdminInvite(instanceUrl, token, invite.id)
                                                    }.onSuccess {
                                                        feedback = "Convite revogado." to false
                                                        reloadInvites()
                                                    }.onFailure {
                                                        feedback = "Erro ao revogar: ${it.message ?: "desconhecido"}" to true
                                                    }
                                                }
                                            },
                                        ) {
                                            Text("Revogar", color = colors.accentAmber)
                                        }
                                    } else {
                                        OutlinedButton(
                                            onClick = {
                                                scope.launch {
                                                    runCatching {
                                                        restClient.reinstateAdminInvite(instanceUrl, token, invite.id)
                                                    }.onSuccess {
                                                        feedback = "Convite reativado." to false
                                                        reloadInvites()
                                                    }.onFailure {
                                                        feedback = "Erro ao reativar: ${it.message ?: "desconhecido"}" to true
                                                    }
                                                }
                                            },
                                        ) {
                                            Text("Reativar", color = colors.accentMint)
                                        }
                                    }

                                    OutlinedButton(
                                        onClick = { deleteConfirmInvite = invite },
                                    ) {
                                        Text("Excluir", color = colors.accentPeach)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    if (showCreateDialog) {
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            containerColor = colors.bgChannel,
            title = { Text("Novo Convite", color = colors.textPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = newInviteName,
                        onValueChange = { newInviteName = it },
                        label = { Text("Nome do convite") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = newInviteMaxUses,
                        onValueChange = { newInviteMaxUses = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Usos máximos (opcional)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = newInviteExpiresHours,
                        onValueChange = { newInviteExpiresHours = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Expiração em horas (opcional)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = newInviteName.isNotBlank(),
                    onClick = {
                        val name = newInviteName.trim()
                        val maxUses = newInviteMaxUses.toIntOrNull()?.takeIf { it > 0 }
                        val expHours = newInviteExpiresHours.toIntOrNull()?.takeIf { it > 0 }
                        showCreateDialog = false
                        scope.launch {
                            runCatching {
                                restClient.createAdminInvite(instanceUrl, token, name, maxUses, expHours)
                            }.onSuccess {
                                feedback = "Convite criado com sucesso." to false
                                reloadInvites()
                            }.onFailure {
                                feedback = "Erro ao criar convite: ${it.message ?: "desconhecido"}" to true
                            }
                        }
                    },
                ) {
                    Text("Criar", color = colors.accentPrimary)
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }

    val targetRedemptions = redemptionsTarget
    if (targetRedemptions != null) {
        AlertDialog(
            onDismissRequest = { redemptionsTarget = null },
            containerColor = colors.bgChannel,
            title = { Text("Resgates — ${targetRedemptions.name}", color = colors.textPrimary) },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (isLoadingRedemptions) {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            color = colors.accentPrimary,
                        )
                    } else if (redemptionsList.isEmpty()) {
                        Text(
                            text = "Nenhum resgate registrado para este convite.",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    } else {
                        redemptionsList.forEach { item ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp),
                                color = colors.bgElevated,
                            ) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    Text(
                                        text = "@${item.currentUsername ?: item.registrantUsername}" +
                                            if (item.isDeleted) " (excluído)" else "",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = if (item.isDeleted) colors.accentPeach else colors.textPrimary,
                                    )
                                    Text(
                                        text = "Registrado como @${item.registrantUsername} • ${formatTimestamp(item.redeemedAt)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.textSecondary,
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { redemptionsTarget = null }) {
                    Text("Fechar", color = colors.accentPrimary)
                }
            },
        )
    }

    val inviteToDelete = deleteConfirmInvite
    if (inviteToDelete != null) {
        AlertDialog(
            onDismissRequest = { deleteConfirmInvite = null },
            containerColor = colors.bgChannel,
            title = { Text("Excluir convite", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Deseja excluir permanentemente o convite \"${inviteToDelete.name}\"?",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteConfirmInvite = null
                        scope.launch {
                            runCatching {
                                restClient.deleteAdminInvite(instanceUrl, token, inviteToDelete.id)
                            }.onSuccess {
                                feedback = "Convite excluído." to false
                                reloadInvites()
                            }.onFailure {
                                feedback = "Erro ao excluir convite: ${it.message ?: "desconhecido"}" to true
                            }
                        }
                    },
                ) {
                    Text("Excluir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteConfirmInvite = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Federação
// ─────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InstanceFederationSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    settings: InstanceAdminSettings?,
    isLoadingInitial: Boolean,
    onSettingsUpdated: (InstanceAdminSettings) -> Unit,
    onRetryLoad: () -> Unit,
) {
    if (settings == null) {
        MissingInitialDataCard(
            isLoading = isLoadingInitial,
            label = "configurações de federação",
            onRetry = onRetryLoad,
        )
        return
    }

    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var relayEnabled by remember(settings) { mutableStateOf(settings.federationRelayEnabled) }
    var autoAcceptPeering by remember(settings) { mutableStateOf(settings.autoAcceptPeering) }
    var relayTtlDaysText by remember(settings) { mutableStateOf(settings.federationRelayTtlDays.toString()) }
    var autoRotateDaysText by remember(settings) { mutableStateOf(settings.defaultAutoRotateIntervalDays.toString()) }
    var isSavingSettings by remember { mutableStateOf(false) }

    var resetEvents by remember { mutableStateOf<List<FederationResetEventItem>>(emptyList()) }
    var approvals by remember { mutableStateOf<List<FederationApprovalItem>>(emptyList()) }
    var peers by remember { mutableStateOf<List<FederationPeerItem>>(emptyList()) }
    var isLoadingLists by remember { mutableStateOf(true) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    var peerToDelete by remember { mutableStateOf<FederationPeerItem?>(null) }

    fun reloadFederationData() {
        scope.launch {
            isLoadingLists = true
            runCatching { restClient.getFederationResetEvents(instanceUrl, token) }
                .onSuccess { resetEvents = it }
            runCatching { restClient.getFederationApprovals(instanceUrl, token) }
                .onSuccess { approvals = it }
            runCatching { restClient.getFederationPeers(instanceUrl, token) }
                .onSuccess { peers = it }
                .onFailure { feedback = "Erro ao carregar peers: ${it.message ?: "desconhecido"}" to true }
            isLoadingLists = false
        }
    }

    LaunchedEffect(instanceUrl, token) {
        reloadFederationData()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        // Relay Settings
        AetherSurfaceCard {
            Text(
                text = "Configurações de Relay",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            AdminToggleRow(
                title = "Relay de federação habilitado",
                subtitle = "Mantém fila de eventos para instâncias temporariamente offline.",
                checked = relayEnabled,
                onCheckedChange = { relayEnabled = it },
            )
            Spacer(Modifier.height(10.dp))
            AdminToggleRow(
                title = "Aceitar pareamento automaticamente",
                subtitle = "Aprova solicitações de pareamento sem revisão manual.",
                checked = autoAcceptPeering,
                onCheckedChange = { autoAcceptPeering = it },
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = relayTtlDaysText,
                onValueChange = { relayTtlDaysText = it.filter { ch -> ch.isDigit() } },
                label = { Text("TTL do Relay (dias)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = autoRotateDaysText,
                onValueChange = { autoRotateDaysText = it.filter { ch -> ch.isDigit() } },
                label = { Text("Intervalo padrão de rotação automática (dias)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            AetherPrimaryButton(
                text = if (isSavingSettings) "Salvando..." else "Salvar configurações de Relay",
                enabled = !isSavingSettings,
                onClick = {
                    scope.launch {
                        isSavingSettings = true
                        feedback = null
                        val ttl = relayTtlDaysText.toIntOrNull()?.coerceAtLeast(1) ?: settings.federationRelayTtlDays
                        val rotate = autoRotateDaysText.toIntOrNull()?.coerceAtLeast(1) ?: settings.defaultAutoRotateIntervalDays
                        val updated = settings.copy(
                            federationRelayEnabled = relayEnabled,
                            autoAcceptPeering = autoAcceptPeering,
                            federationRelayTtlDays = ttl,
                            defaultAutoRotateIntervalDays = rotate,
                            gifApiKey = null,
                        )
                        runCatching {
                            restClient.updateInstanceAdminSettings(instanceUrl, token, updated)
                        }.onSuccess { saved ->
                            onSettingsUpdated(saved)
                            feedback = "Configurações de federação salvas." to false
                        }.onFailure {
                            feedback = "Erro ao salvar: ${it.message ?: "desconhecido"}" to true
                        }
                        isSavingSettings = false
                    }
                },
            )
        }

        if (isLoadingLists) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = colors.accentPrimary,
                trackColor = colors.interactiveMuted,
            )
        }

        // Limpeza de Resets
        AetherSurfaceCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Limpeza de Resets (${resetEvents.size})",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { reloadFederationData() }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "Atualizar", tint = colors.textSecondary)
                }
            }
            if (resetEvents.isEmpty()) {
                Text(
                    text = "Nenhum evento de reset pendente.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                Spacer(Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    resetEvents.forEach { ev ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = colors.bgElevated,
                            border = BorderStroke(1.dp, colors.borderSoft),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(
                                    text = ev.origin,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                    color = colors.textPrimary,
                                )
                                Text(
                                    text = "Stubs: ${ev.stubCount} • Contas órfãs: ${ev.orphanedAccountCount} • Detectado: ${formatTimestamp(ev.detectedAt)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                                if (ev.orphanedAccounts.isNotEmpty()) {
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        text = "Contas afetadas: " + ev.orphanedAccounts.joinToString(", ") { "@${it.username}" },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.accentAmber,
                                    )
                                }
                                if (ev.acknowledgedAt == null) {
                                    Spacer(Modifier.height(8.dp))
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    restClient.acknowledgeFederationReset(instanceUrl, token, ev.origin)
                                                }.onSuccess {
                                                    feedback = "Evento de reset dispensado." to false
                                                    reloadFederationData()
                                                }.onFailure {
                                                    feedback = "Erro ao dispensar: ${it.message ?: "desconhecido"}" to true
                                                }
                                            }
                                        },
                                    ) {
                                        Text("Dispensar")
                                    }
                                } else {
                                    Spacer(Modifier.height(4.dp))
                                    AdminBadge(text = "Dispensado", color = colors.textSecondary)
                                }
                            }
                        }
                    }
                }
            }
        }

        // Aprovações Pendentes
        AetherSurfaceCard {
            Text(
                text = "Aprovações Pendentes (${approvals.size})",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(8.dp))
            if (approvals.isEmpty()) {
                Text(
                    text = "Nenhuma solicitação de pareamento pendente.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    approvals.forEach { req ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = colors.bgElevated,
                            border = BorderStroke(1.dp, colors.borderSoft),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = req.instanceName?.ifBlank { req.origin } ?: req.origin,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium,
                                            color = colors.textPrimary,
                                        )
                                        Text(
                                            text = req.origin,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = colors.textSecondary,
                                        )
                                    }
                                    AdminBadge(
                                        text = if (req.direction == "inbound") "Entrada" else "Saída",
                                        color = colors.accentSky,
                                    )
                                }
                                if (req.subscribers.isNotEmpty()) {
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        text = "Solicitantes: " + req.subscribers.joinToString(", ") { "@${it.username}" },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.textSecondary,
                                    )
                                }
                                Spacer(Modifier.height(8.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    restClient.approveFederationRequest(instanceUrl, token, req.id)
                                                }.onSuccess { resp ->
                                                    feedback = (resp.message ?: "Solicitação aprovada.") to false
                                                    reloadFederationData()
                                                }.onFailure {
                                                    feedback = "Erro ao aprovar: ${it.message ?: "desconhecido"}" to true
                                                }
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = colors.accentPrimary),
                                    ) {
                                        Text("Aprovar", color = colors.textPrimary)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    restClient.denyFederationRequest(instanceUrl, token, req.id)
                                                }.onSuccess {
                                                    feedback = "Solicitação negada." to false
                                                    reloadFederationData()
                                                }.onFailure {
                                                    feedback = "Erro ao negar: ${it.message ?: "desconhecido"}" to true
                                                }
                                            }
                                        },
                                    ) {
                                        Text("Negar", color = colors.accentPeach)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Instâncias Pareadas
        AetherSurfaceCard {
            Text(
                text = "Instâncias Pareadas (${peers.size})",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(8.dp))
            if (peers.isEmpty()) {
                Text(
                    text = "Nenhuma instância pareada no momento.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    peers.forEach { peer ->
                        val statusColor = when (peer.status.lowercase()) {
                            "active", "connected", "paired" -> colors.accentMint
                            "degraded", "pending", "rotating" -> colors.accentAmber
                            else -> colors.accentPeach
                        }
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = colors.bgElevated,
                            border = BorderStroke(1.dp, colors.borderSoft),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = peer.instanceName?.ifBlank { peer.origin } ?: peer.origin,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium,
                                            color = colors.textPrimary,
                                        )
                                        Text(
                                            text = peer.origin,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = colors.textSecondary,
                                        )
                                    }
                                    AdminBadge(text = peer.status, color = statusColor)
                                }
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = "Falhas consecutivas: ${peer.consecutiveFailures} • Rotação auto: ${peer.autoRotateIntervalDays}d",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (peer.consecutiveFailures > 0) colors.accentAmber else colors.textSecondary,
                                )
                                if (!peer.statusReason.isNullOrBlank()) {
                                    Text(
                                        text = "Motivo: ${peer.statusReason}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.accentPeach,
                                    )
                                }
                                Spacer(Modifier.height(8.dp))
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    restClient.recheckFederationPeer(instanceUrl, token, peer.id)
                                                }.onSuccess { r ->
                                                    feedback = "Verificação concluída: ${r.status}" to false
                                                    reloadFederationData()
                                                }.onFailure {
                                                    feedback = "Erro ao verificar: ${it.message ?: "desconhecido"}" to true
                                                }
                                            }
                                        },
                                    ) {
                                        Text("Verificar")
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    restClient.rotateFederationPeer(instanceUrl, token, peer.id)
                                                }.onSuccess {
                                                    feedback = "Rotação de segredo iniciada." to false
                                                    reloadFederationData()
                                                }.onFailure {
                                                    feedback = "Erro ao rotacionar: ${it.message ?: "desconhecido"}" to true
                                                }
                                            }
                                        },
                                    ) {
                                        Text("Rotacionar")
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    restClient.revokeFederationPeer(instanceUrl, token, peer.id)
                                                }.onSuccess {
                                                    feedback = "Peer revogado." to false
                                                    reloadFederationData()
                                                }.onFailure {
                                                    feedback = "Erro ao revogar: ${it.message ?: "desconhecido"}" to true
                                                }
                                            }
                                        },
                                    ) {
                                        Text("Revogar", color = colors.accentAmber)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    restClient.resetFederationPeer(instanceUrl, token, peer.id)
                                                }.onSuccess {
                                                    feedback = "Peer resetado." to false
                                                    reloadFederationData()
                                                }.onFailure {
                                                    feedback = "Erro ao resetar: ${it.message ?: "desconhecido"}" to true
                                                }
                                            }
                                        },
                                    ) {
                                        Text("Resetar", color = colors.accentAmber)
                                    }
                                    OutlinedButton(
                                        onClick = { peerToDelete = peer },
                                    ) {
                                        Text("Excluir", color = colors.accentPeach)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    val confirmPeer = peerToDelete
    if (confirmPeer != null) {
        AlertDialog(
            onDismissRequest = { peerToDelete = null },
            containerColor = colors.bgChannel,
            title = { Text("Excluir instância pareada", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Deseja excluir permanentemente o peer \"${confirmPeer.instanceName ?: confirmPeer.origin}\"? Essa ação não pode ser desfeita.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        peerToDelete = null
                        scope.launch {
                            runCatching {
                                restClient.deleteFederationPeerPermanent(instanceUrl, token, confirmPeer.id)
                            }.onSuccess {
                                feedback = "Peer excluído permanentemente." to false
                                reloadFederationData()
                            }.onFailure {
                                feedback = "Erro ao excluir peer: ${it.message ?: "desconhecido"}" to true
                            }
                        }
                    },
                ) {
                    Text("Excluir permanentemente", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { peerToDelete = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Transmissão (Vídeo)
// ─────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun InstanceStreamingSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    limits: InstanceStreamingLimits?,
    isLoadingInitial: Boolean,
    onLimitsUpdated: (InstanceStreamingLimits) -> Unit,
    onRetryLoad: () -> Unit,
) {
    if (limits == null) {
        MissingInitialDataCard(
            isLoading = isLoadingInitial,
            label = "limites de transmissão",
            onRetry = onRetryLoad,
        )
        return
    }

    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    val resolutionOptions = listOf("480", "720", "1080", "1440", "2160", "native")
    val framerateOptions = listOf(15, 30, 60, 90, 120)

    var allowCustomBitrate by remember(limits) { mutableStateOf(limits.allowCustomBitrate) }
    var minBitrate by remember(limits) { mutableFloatStateOf(limits.minBitrateKbps.toFloat().coerceIn(250f, 20000f)) }
    var maxBitrate by remember(limits) { mutableFloatStateOf(limits.maxBitrateKbps.toFloat().coerceIn(500f, 50000f)) }
    var bitrateStepText by remember(limits) { mutableStateOf(limits.bitrateStepKbps.toString()) }
    var selectedResolutions by remember(limits) {
        mutableStateOf(
            limits.allowedResolutions.map { it.trim().lowercase() }.toSet().ifEmpty {
                setOf("720", "1080")
            },
        )
    }
    var selectedFramerates by remember(limits) {
        mutableStateOf(
            limits.allowedFramerates.toSet().ifEmpty { setOf(30, 60) },
        )
    }
    var isSaving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        AetherSurfaceCard {
            Text(
                text = "Limites de Bitrate de Vídeo",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            AdminToggleRow(
                title = "Permitir bitrate personalizado",
                subtitle = "Deixa usuários ajustarem o bitrate dentro dos limites definidos.",
                checked = allowCustomBitrate,
                onCheckedChange = { allowCustomBitrate = it },
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Bitrate mínimo: ${minBitrate.roundToInt()} kbps",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = minBitrate,
                onValueChange = {
                    minBitrate = it
                    if (maxBitrate < it) maxBitrate = it
                },
                valueRange = 250f..20000f,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Bitrate máximo: ${maxBitrate.roundToInt()} kbps",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = maxBitrate,
                onValueChange = {
                    maxBitrate = it
                    if (minBitrate > it) minBitrate = it
                },
                valueRange = 500f..50000f,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = bitrateStepText,
                onValueChange = { bitrateStepText = it.filter { ch -> ch.isDigit() } },
                label = { Text("Incremento de bitrate (kbps)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        AetherSurfaceCard {
            Text(
                text = "Resoluções Permitidas",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                resolutionOptions.forEach { res ->
                    val selected = selectedResolutions.contains(res)
                    val label = if (res == "native") "Nativa" else "${res}p"
                    FilterChip(
                        selected = selected,
                        onClick = {
                            selectedResolutions = if (selected && selectedResolutions.size > 1) {
                                selectedResolutions - res
                            } else {
                                selectedResolutions + res
                            }
                        },
                        label = { Text(label) },
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            Text(
                text = "Taxas de Quadros (FPS) Permitidas",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                framerateOptions.forEach { fps ->
                    val selected = selectedFramerates.contains(fps)
                    FilterChip(
                        selected = selected,
                        onClick = {
                            selectedFramerates = if (selected && selectedFramerates.size > 1) {
                                selectedFramerates - fps
                            } else {
                                selectedFramerates + fps
                            }
                        },
                        label = { Text("$fps FPS") },
                    )
                }
            }
        }

        AetherPrimaryButton(
            text = if (isSaving) "Salvando..." else "Salvar limites de transmissão",
            enabled = !isSaving,
            onClick = {
                scope.launch {
                    isSaving = true
                    feedback = null
                    val minVal = minBitrate.roundToInt()
                    val maxVal = maxBitrate.roundToInt().coerceAtLeast(minVal)
                    val stepVal = bitrateStepText.toIntOrNull()?.coerceAtLeast(50) ?: limits.bitrateStepKbps
                    val orderedRes = resolutionOptions.filter { selectedResolutions.contains(it) }
                    val orderedFps = framerateOptions.filter { selectedFramerates.contains(it) }
                    val computedMaxRes = orderedRes.mapNotNull { it.toIntOrNull() }.maxOrNull() ?: limits.maxResolution
                    val computedMaxFps = orderedFps.maxOrNull() ?: limits.maxFramerate

                    val updated = limits.copy(
                        allowCustomBitrate = allowCustomBitrate,
                        minBitrateKbps = minVal,
                        maxBitrateKbps = maxVal,
                        bitrateStepKbps = stepVal,
                        allowedResolutions = orderedRes,
                        allowedFramerates = orderedFps,
                        maxResolution = computedMaxRes,
                        maxFramerate = computedMaxFps,
                    )
                    runCatching {
                        restClient.updateStreamingLimits(instanceUrl, token, updated)
                    }.onSuccess { saved ->
                        onLimitsUpdated(saved)
                        feedback = "Limites de transmissão salvos." to false
                    }.onFailure {
                        feedback = "Erro ao salvar: ${it.message ?: "desconhecido"}" to true
                    }
                    isSaving = false
                }
            },
        )
        Spacer(Modifier.height(16.dp))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Áudio (Opus)
// ─────────────────────────────────────────────────────────────────────────────

@Composable
fun InstanceAudioOpusSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    limits: InstanceStreamingLimits?,
    isLoadingInitial: Boolean,
    onLimitsUpdated: (InstanceStreamingLimits) -> Unit,
    onRetryLoad: () -> Unit,
) {
    if (limits == null) {
        MissingInitialDataCard(
            isLoading = isLoadingInitial,
            label = "limites de áudio Opus",
            onRetry = onRetryLoad,
        )
        return
    }

    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var defaultAudioBitrate by remember(limits) {
        mutableFloatStateOf(limits.defaultAudioBitrateKbps.toFloat().coerceIn(16f, 512f))
    }
    var maxAudioBitrate by remember(limits) {
        mutableFloatStateOf(limits.maxAudioBitrateKbps.toFloat().coerceIn(32f, 512f))
    }
    var allowMusicMode by remember(limits) { mutableStateOf(limits.allowMusicMode) }
    var allowStereoAudio by remember(limits) { mutableStateOf(limits.allowStereoAudio) }
    var isSaving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        AetherSurfaceCard {
            Text(
                text = "Política de Áudio Opus",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Bitrate padrão de áudio: ${defaultAudioBitrate.roundToInt()} kbps",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = defaultAudioBitrate,
                onValueChange = {
                    defaultAudioBitrate = it
                    if (maxAudioBitrate < it) maxAudioBitrate = it
                },
                valueRange = 16f..512f,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = "Bitrate máximo de áudio: ${maxAudioBitrate.roundToInt()} kbps",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = maxAudioBitrate,
                onValueChange = {
                    maxAudioBitrate = it
                    if (defaultAudioBitrate > it) defaultAudioBitrate = it
                },
                valueRange = 32f..512f,
            )
            Spacer(Modifier.height(12.dp))
            AdminToggleRow(
                title = "Permitir modo música",
                subtitle = "Habilita perfil Opus de alta fidelidade para música em canais de voz.",
                checked = allowMusicMode,
                onCheckedChange = { allowMusicMode = it },
            )
            Spacer(Modifier.height(12.dp))
            AdminToggleRow(
                title = "Permitir áudio estéreo",
                subtitle = "Permite transmissão em 2 canais (estéreo) nos Espaços desta instância.",
                checked = allowStereoAudio,
                onCheckedChange = { allowStereoAudio = it },
            )
        }

        AetherPrimaryButton(
            text = if (isSaving) "Salvando..." else "Salvar configurações de áudio",
            enabled = !isSaving,
            onClick = {
                scope.launch {
                    isSaving = true
                    feedback = null
                    val defVal = defaultAudioBitrate.roundToInt()
                    val maxVal = maxAudioBitrate.roundToInt().coerceAtLeast(defVal)
                    val updated = limits.copy(
                        defaultAudioBitrateKbps = defVal,
                        maxAudioBitrateKbps = maxVal,
                        allowMusicMode = allowMusicMode,
                        allowStereoAudio = allowStereoAudio,
                    )
                    runCatching {
                        restClient.updateStreamingLimits(instanceUrl, token, updated)
                    }.onSuccess { saved ->
                        onLimitsUpdated(saved)
                        feedback = "Configurações de áudio Opus salvas." to false
                    }.onFailure {
                        feedback = "Erro ao salvar: ${it.message ?: "desconhecido"}" to true
                    }
                    isSaving = false
                }
            },
        )
        Spacer(Modifier.height(16.dp))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Soundboard
// ─────────────────────────────────────────────────────────────────────────────

@Composable
fun InstanceSoundboardSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    limits: InstanceStreamingLimits?,
    isLoadingInitial: Boolean,
    onLimitsUpdated: (InstanceStreamingLimits) -> Unit,
    onRetryLoad: () -> Unit,
) {
    if (limits == null) {
        MissingInitialDataCard(
            isLoading = isLoadingInitial,
            label = "configurações do soundboard",
            onRetry = onRetryLoad,
        )
        return
    }

    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var soundboardEnabled by remember(limits) { mutableStateOf(limits.soundboardEnabled) }
    var maxSoundsPerScope by remember(limits) {
        mutableFloatStateOf(limits.maxSoundboardSoundsPerScope.toFloat().coerceIn(0f, 200f))
    }
    var maxConcurrentSounds by remember(limits) {
        mutableFloatStateOf(limits.maxConcurrentSoundboardSounds.toFloat().coerceIn(1f, 10f))
    }
    var isSaving by remember { mutableStateOf(false) }

    var instanceSounds by remember { mutableStateOf<List<SoundboardSound>>(emptyList()) }
    var isLoadingSounds by remember { mutableStateOf(true) }
    var soundToDelete by remember { mutableStateOf<SoundboardSound?>(null) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    fun reloadSounds() {
        scope.launch {
            isLoadingSounds = true
            runCatching { restClient.getSoundboard(instanceUrl, token, spaceId = "") }
                .onSuccess { instanceSounds = it.instanceSounds }
                .onFailure {
                    feedback = "Erro ao carregar sons globais: ${it.message ?: "desconhecido"}" to true
                }
            isLoadingSounds = false
        }
    }

    LaunchedEffect(instanceUrl, token) {
        reloadSounds()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        AetherSurfaceCard {
            Text(
                text = "Limites Globais do Soundboard",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            AdminToggleRow(
                title = "Soundboard habilitado",
                subtitle = "Ativa ou desativa o soundboard em todos os Espaços da instância.",
                checked = soundboardEnabled,
                onCheckedChange = { soundboardEnabled = it },
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Máximo de sons por escopo: ${maxSoundsPerScope.roundToInt()}",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = maxSoundsPerScope,
                onValueChange = { maxSoundsPerScope = it },
                valueRange = 0f..200f,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = "Máximo de sons simultâneos: ${maxConcurrentSounds.roundToInt()}",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = maxConcurrentSounds,
                onValueChange = { maxConcurrentSounds = it },
                valueRange = 1f..10f,
            )
            Spacer(Modifier.height(12.dp))
            AetherPrimaryButton(
                text = if (isSaving) "Salvando..." else "Salvar limites do Soundboard",
                enabled = !isSaving,
                onClick = {
                    scope.launch {
                        isSaving = true
                        feedback = null
                        val updated = limits.copy(
                            soundboardEnabled = soundboardEnabled,
                            maxSoundboardSoundsPerScope = maxSoundsPerScope.roundToInt().coerceIn(0, 200),
                            maxConcurrentSoundboardSounds = maxConcurrentSounds.roundToInt().coerceIn(1, 10),
                        )
                        runCatching {
                            restClient.updateStreamingLimits(instanceUrl, token, updated)
                        }.onSuccess { saved ->
                            onLimitsUpdated(saved)
                            feedback = "Limites do soundboard salvos." to false
                        }.onFailure {
                            feedback = "Erro ao salvar: ${it.message ?: "desconhecido"}" to true
                        }
                        isSaving = false
                    }
                },
            )
        }

        AetherSurfaceCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Sons Globais da Instância (${instanceSounds.size})",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { reloadSounds() }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "Atualizar", tint = colors.textSecondary)
                }
            }
            if (isLoadingSounds) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = colors.accentPrimary,
                    trackColor = colors.interactiveMuted,
                )
            } else if (instanceSounds.isEmpty()) {
                Text(
                    text = "Nenhum som global cadastrado na instância.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                Spacer(Modifier.height(6.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    instanceSounds.forEach { sound ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = colors.bgElevated,
                            border = BorderStroke(1.dp, colors.borderSoft),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = sound.emoji.ifBlank { "🔊" },
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Spacer(Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = sound.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium,
                                        color = colors.textPrimary,
                                    )
                                    val durationSec = String.format(Locale.getDefault(), "%.1fs", sound.durationMs / 1000.0)
                                    val folderInfo = sound.folder?.takeIf { it.isNotBlank() }?.let { " • Pasta: $it" }.orEmpty()
                                    Text(
                                        text = "$durationSec$folderInfo",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.textSecondary,
                                    )
                                }
                                IconButton(onClick = { soundToDelete = sound }) {
                                    Icon(
                                        imageVector = Icons.Filled.Delete,
                                        contentDescription = "Excluir som",
                                        tint = colors.accentPeach,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    val confirmSound = soundToDelete
    if (confirmSound != null) {
        AlertDialog(
            onDismissRequest = { soundToDelete = null },
            containerColor = colors.bgChannel,
            title = { Text("Excluir som global", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Deseja excluir o som \"${confirmSound.name}\" da instância?",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        soundToDelete = null
                        scope.launch {
                            runCatching {
                                restClient.deleteSoundboardSound(instanceUrl, token, confirmSound.id)
                            }.onSuccess {
                                feedback = "Som excluído." to false
                                reloadSounds()
                            }.onFailure {
                                feedback = "Erro ao excluir som: ${it.message ?: "desconhecido"}" to true
                            }
                        }
                    },
                ) {
                    Text("Excluir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { soundToDelete = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Armazenamento
// ─────────────────────────────────────────────────────────────────────────────

private enum class StorageCleanupAction {
    ORPHANS,
    TUS,
    MEDIA,
}

@Composable
fun InstanceStorageSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
    settings: InstanceAdminSettings?,
    isLoadingInitial: Boolean,
    onSettingsUpdated: (InstanceAdminSettings) -> Unit,
    onRetryLoad: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var stats by remember { mutableStateOf<StorageStatsResponse?>(null) }
    var isLoadingStats by remember { mutableStateOf(true) }
    var maxUploadMbText by remember(settings) { mutableStateOf((settings?.maxUploadSizeMb ?: 50).toString()) }
    var isSavingLimit by remember { mutableStateOf(false) }

    var tusHoursText by remember { mutableStateOf("24") }
    var mediaDaysText by remember { mutableStateOf("90") }
    var isRunningCleanup by remember { mutableStateOf(false) }
    var lastCleanupResult by remember { mutableStateOf<Pair<String, StorageCleanupResult>?>(null) }
    var pendingConfirmAction by remember { mutableStateOf<StorageCleanupAction?>(null) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    fun reloadStats() {
        scope.launch {
            isLoadingStats = true
            runCatching { restClient.getAdminStorageStats(instanceUrl, token) }
                .onSuccess { stats = it }
                .onFailure { feedback = "Erro ao carregar estatísticas: ${it.message ?: "desconhecido"}" to true }
            isLoadingStats = false
        }
    }

    LaunchedEffect(instanceUrl, token) {
        reloadStats()
    }

    fun executeCleanup(action: StorageCleanupAction, dryRun: Boolean) {
        scope.launch {
            isRunningCleanup = true
            feedback = null
            val label = when (action) {
                StorageCleanupAction.ORPHANS -> "Órfãos"
                StorageCleanupAction.TUS -> "Sessões tus"
                StorageCleanupAction.MEDIA -> "Retenção de mídia"
            }
            runCatching {
                when (action) {
                    StorageCleanupAction.ORPHANS -> restClient.cleanupAdminStorage(instanceUrl, token, dryRun = dryRun)
                    StorageCleanupAction.TUS -> {
                        val hours = tusHoursText.toIntOrNull()?.coerceAtLeast(1) ?: 24
                        restClient.cleanupAdminTus(instanceUrl, token, olderThanHours = hours, dryRun = dryRun)
                    }
                    StorageCleanupAction.MEDIA -> {
                        val days = mediaDaysText.toIntOrNull()?.coerceAtLeast(1) ?: 90
                        restClient.cleanupAdminMedia(instanceUrl, token, olderThanDays = days, dryRun = dryRun)
                    }
                }
            }.onSuccess { result ->
                lastCleanupResult = label to result
                if (!dryRun) {
                    reloadStats()
                }
            }.onFailure {
                feedback = "Erro na limpeza ($label): ${it.message ?: "desconhecido"}" to true
            }
            isRunningCleanup = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        AetherSurfaceCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Métricas de Armazenamento",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { reloadStats() }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "Atualizar", tint = colors.textSecondary)
                }
            }

            if (isLoadingStats) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = colors.accentPrimary,
                    trackColor = colors.interactiveMuted,
                )
            } else {
                val s = stats
                if (s != null) {
                    Spacer(Modifier.height(8.dp))
                    val metrics = listOf(
                        Triple("Total", "${s.totalFiles} arq.", formatBytes(s.totalSize)),
                        Triple("Referenciados", "${s.referencedFiles} arq.", formatBytes(s.referencedSize)),
                        Triple("Órfãos", "${s.orphanedFiles} arq.", formatBytes(s.orphanedSize)),
                        Triple("Desvinculados", "${s.unlinkedAttachments} arq.", formatBytes(s.unlinkedSize)),
                        Triple("Pendentes", "${s.danglingAttachments} arq.", formatBytes(s.danglingSize)),
                        Triple("tus Expirados", "${s.staleTusSessions} sess.", formatBytes(s.staleTusSize)),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        metrics.chunked(2).forEach { pair ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                pair.forEach { (title, countStr, sizeStr) ->
                                    Surface(
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(12.dp),
                                        color = colors.bgElevated,
                                        border = BorderStroke(1.dp, colors.borderSoft),
                                    ) {
                                        Column(modifier = Modifier.padding(10.dp)) {
                                            Text(
                                                text = title,
                                                style = MaterialTheme.typography.labelSmall,
                                                color = colors.textSecondary,
                                            )
                                            Spacer(Modifier.height(4.dp))
                                            Text(
                                                text = sizeStr,
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.SemiBold,
                                                color = colors.textPrimary,
                                            )
                                            Text(
                                                text = countStr,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = colors.textTertiary,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (s.breakdown.isNotEmpty()) {
                        Spacer(Modifier.height(14.dp))
                        HorizontalDivider(color = colors.borderSoft)
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = "Detalhamento por Tipo",
                            style = MaterialTheme.typography.labelLarge,
                            color = colors.textPrimary,
                        )
                        Spacer(Modifier.height(6.dp))
                        s.breakdown.forEach { item ->
                            val typeLabel = when (item.type.lowercase()) {
                                "image" -> "Imagens"
                                "video" -> "Vídeos"
                                "audio" -> "Áudio"
                                "document" -> "Documentos"
                                else -> "Outros"
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 3.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = typeLabel,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textPrimary,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    text = "${item.count} arq. • ${formatBytes(item.size)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                            }
                        }
                    }
                }
            }
        }

        // Limite de upload
        AetherSurfaceCard {
            Text(
                text = "Limite de Upload",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(8.dp))
            if (settings == null && !isLoadingInitial) {
                OutlinedButton(onClick = onRetryLoad) {
                    Text("Recarregar configurações")
                }
            } else {
                OutlinedTextField(
                    value = maxUploadMbText,
                    onValueChange = { maxUploadMbText = it.filter { ch -> ch.isDigit() } },
                    label = { Text("Tamanho máximo de upload (MB)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                AetherPrimaryButton(
                    text = if (isSavingLimit) "Salvando..." else "Salvar limite de upload",
                    enabled = !isSavingLimit && settings != null,
                    onClick = {
                        val current = settings ?: return@AetherPrimaryButton
                        scope.launch {
                            isSavingLimit = true
                            feedback = null
                            val mb = maxUploadMbText.toIntOrNull()?.coerceAtLeast(1) ?: current.maxUploadSizeMb
                            runCatching {
                                restClient.updateInstanceAdminSettings(
                                    instanceUrl,
                                    token,
                                    current.copy(maxUploadSizeMb = mb, gifApiKey = null),
                                )
                            }.onSuccess { saved ->
                                onSettingsUpdated(saved)
                                feedback = "Limite de upload atualizado para ${saved.maxUploadSizeMb} MB." to false
                            }.onFailure {
                                feedback = "Erro ao salvar limite: ${it.message ?: "desconhecido"}" to true
                            }
                            isSavingLimit = false
                        }
                    },
                )
            }
        }

        // Ferramentas de limpeza
        AetherSurfaceCard {
            Text(
                text = "Ferramentas de Limpeza",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            if (isRunningCleanup) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = colors.accentPrimary,
                    trackColor = colors.interactiveMuted,
                )
            }

            // 1. Órfãos
            Spacer(Modifier.height(10.dp))
            Text(
                text = "1. Arquivos órfãos",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = colors.textPrimary,
            )
            Text(
                text = "Remove arquivos em disco não referenciados por nenhuma mensagem.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    enabled = !isRunningCleanup,
                    onClick = { executeCleanup(StorageCleanupAction.ORPHANS, dryRun = true) },
                ) {
                    Text("Simular")
                }
                Button(
                    enabled = !isRunningCleanup,
                    onClick = { pendingConfirmAction = StorageCleanupAction.ORPHANS },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.accentPeach),
                ) {
                    Text("Executar", color = colors.bgBase)
                }
            }

            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = colors.borderSoft)
            Spacer(Modifier.height(12.dp))

            // 2. Sessões tus
            Text(
                text = "2. Sessões tus expiradas",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = tusHoursText,
                onValueChange = { tusHoursText = it.filter { ch -> ch.isDigit() } },
                label = { Text("Mais antigas que (horas)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    enabled = !isRunningCleanup,
                    onClick = { executeCleanup(StorageCleanupAction.TUS, dryRun = true) },
                ) {
                    Text("Simular")
                }
                Button(
                    enabled = !isRunningCleanup,
                    onClick = { pendingConfirmAction = StorageCleanupAction.TUS },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.accentPeach),
                ) {
                    Text("Executar", color = colors.bgBase)
                }
            }

            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = colors.borderSoft)
            Spacer(Modifier.height(12.dp))

            // 3. Retenção de mídia
            Text(
                text = "3. Retenção de mídia",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = mediaDaysText,
                onValueChange = { mediaDaysText = it.filter { ch -> ch.isDigit() } },
                label = { Text("Mais antigos que (dias)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    enabled = !isRunningCleanup,
                    onClick = { executeCleanup(StorageCleanupAction.MEDIA, dryRun = true) },
                ) {
                    Text("Simular")
                }
                Button(
                    enabled = !isRunningCleanup,
                    onClick = { pendingConfirmAction = StorageCleanupAction.MEDIA },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.accentPeach),
                ) {
                    Text("Executar", color = colors.bgBase)
                }
            }

            val resultPair = lastCleanupResult
            if (resultPair != null) {
                val (label, res) = resultPair
                Spacer(Modifier.height(14.dp))
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = colors.bgElevated,
                    border = BorderStroke(1.dp, colors.accentSky.copy(alpha = 0.4f)),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "${if (res.dryRun) "Simulação" else "Limpeza executada"} — $label",
                            style = MaterialTheme.typography.labelLarge,
                            color = colors.accentSky,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = "Arquivos removidos: ${res.deletedFiles} • Espaço liberado: ${formatBytes(res.freedBytes)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textPrimary,
                        )
                        if (res.deletedAttachmentRecords > 0) {
                            Text(
                                text = "Registros de anexos limpos: ${res.deletedAttachmentRecords}",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                            )
                        }
                        if (res.errors.isNotEmpty()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = "Avisos: ${res.errors.joinToString("; ")}",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.accentPeach,
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    val confirmAction = pendingConfirmAction
    if (confirmAction != null) {
        val actionDesc = when (confirmAction) {
            StorageCleanupAction.ORPHANS -> "excluir permanentemente todos os arquivos órfãos"
            StorageCleanupAction.TUS -> "limpar sessões tus mais antigas que ${tusHoursText.ifBlank { "24" }} horas"
            StorageCleanupAction.MEDIA -> "excluir mídias mais antigas que ${mediaDaysText.ifBlank { "90" }} dias"
        }
        AlertDialog(
            onDismissRequest = { pendingConfirmAction = null },
            containerColor = colors.bgChannel,
            title = { Text("Confirmar limpeza", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Tem certeza que deseja $actionDesc? Essa ação não pode ser desfeita.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingConfirmAction = null
                        executeCleanup(confirmAction, dryRun = false)
                    },
                ) {
                    Text("Executar", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingConfirmAction = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Usuários
// ─────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun InstanceUsersSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var searchQuery by remember { mutableStateOf("") }
    var appliedQuery by remember { mutableStateOf("") }
    var roleFilter by remember { mutableStateOf<String?>(null) } // null = Todos, "admin" = Admins
    var showDeleted by remember { mutableStateOf(false) }
    var currentPage by remember { mutableIntStateOf(1) }

    var pageData by remember { mutableStateOf(AdminUsersPageResponse()) }
    var isLoading by remember { mutableStateOf(true) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    var tempPasswordDialog by remember { mutableStateOf<Pair<String, String>?>(null) }
    var userToDelete by remember { mutableStateOf<AdminUserItem?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(instanceUrl, token, appliedQuery, roleFilter, showDeleted, currentPage, reloadKey) {
        isLoading = true
        runCatching {
            restClient.getAdminUsers(
                instanceUrl = instanceUrl,
                token = token,
                q = appliedQuery.takeIf { it.isNotBlank() },
                role = roleFilter,
                showDeleted = showDeleted,
                page = currentPage,
            )
        }.onSuccess { pageData = it }
            .onFailure { feedback = "Erro ao carregar usuários: ${it.message ?: "desconhecido"}" to true }
        isLoading = false
    }

    val totalPages = remember(pageData) {
        val size = pageData.pageSize.coerceAtLeast(1)
        ceil(pageData.total.toDouble() / size.toDouble()).toInt().coerceAtLeast(1)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        AetherSurfaceCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    label = { Text("Buscar usuário") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        currentPage = 1
                        appliedQuery = searchQuery.trim()
                    },
                ) {
                    Icon(Icons.Filled.Search, contentDescription = "Buscar", tint = colors.accentPrimary)
                }
            }
            Spacer(Modifier.height(10.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                FilterChip(
                    selected = roleFilter == null,
                    onClick = {
                        roleFilter = null
                        currentPage = 1
                    },
                    label = { Text("Todos") },
                )
                FilterChip(
                    selected = roleFilter == "admin",
                    onClick = {
                        roleFilter = "admin"
                        currentPage = 1
                    },
                    label = { Text("Admins") },
                )
                FilterChip(
                    selected = showDeleted,
                    onClick = {
                        showDeleted = !showDeleted
                        currentPage = 1
                    },
                    label = { Text("Mostrar excluídos") },
                )
            }
        }

        if (isLoading) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = colors.accentPrimary,
                trackColor = colors.interactiveMuted,
            )
        }

        AetherSurfaceCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Usuários (${pageData.total})",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "Pág. $currentPage/$totalPages",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            Spacer(Modifier.height(10.dp))

            if (pageData.users.isEmpty() && !isLoading) {
                Text(
                    text = "Nenhum usuário encontrado.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    pageData.users.forEach { user ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = colors.bgElevated,
                            border = BorderStroke(1.dp, colors.borderSoft),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    AetherAvatar(
                                        imageUrl = user.avatarUrl(instanceUrl),
                                        fallbackLabel = user.label,
                                        size = 40.dp,
                                        status = user.status,
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = user.label,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium,
                                            color = colors.textPrimary,
                                        )
                                        Text(
                                            text = "@${user.username}" +
                                                (user.homeInstance?.let { " • $it" }.orEmpty()),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = colors.textSecondary,
                                        )
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        if (user.isAdmin) {
                                            AdminBadge(text = "Admin", color = colors.accentPrimary)
                                        }
                                        if (user.isDeleted) {
                                            AdminBadge(text = "Excluído", color = colors.accentPeach)
                                        }
                                    }
                                }

                                if (!user.isDeleted) {
                                    Spacer(Modifier.height(8.dp))
                                    FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        verticalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        OutlinedButton(
                                            onClick = {
                                                scope.launch {
                                                    runCatching {
                                                        restClient.updateAdminUserRole(
                                                            instanceUrl,
                                                            token,
                                                            user.id,
                                                            !user.isAdmin,
                                                        )
                                                    }.onSuccess {
                                                        feedback = if (!user.isAdmin) {
                                                            "@${user.username} promovido a admin." to false
                                                        } else {
                                                            "@${user.username} rebaixado de admin." to false
                                                        }
                                                        reloadKey++
                                                    }.onFailure {
                                                        feedback = "Erro ao alterar cargo: ${it.message ?: "desconhecido"}" to true
                                                    }
                                                }
                                            },
                                        ) {
                                            Text(if (user.isAdmin) "Rebaixar Admin" else "Promover Admin")
                                        }

                                        OutlinedButton(
                                            onClick = {
                                                scope.launch {
                                                    runCatching {
                                                        restClient.resetAdminUserPassword(instanceUrl, token, user.id)
                                                    }.onSuccess { resp ->
                                                        tempPasswordDialog = user.username to resp.temporaryPassword
                                                    }.onFailure {
                                                        feedback = "Erro ao redefinir senha: ${it.message ?: "desconhecido"}" to true
                                                    }
                                                }
                                            },
                                        ) {
                                            Text("Redefinir Senha")
                                        }

                                        OutlinedButton(
                                            onClick = { userToDelete = user },
                                        ) {
                                            Text("Excluir", color = colors.accentPeach)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                OutlinedButton(
                    enabled = currentPage > 1 && !isLoading,
                    onClick = { currentPage = (currentPage - 1).coerceAtLeast(1) },
                ) {
                    Text("Anterior")
                }
                OutlinedButton(
                    enabled = currentPage < totalPages && !isLoading,
                    onClick = { currentPage = (currentPage + 1).coerceAtMost(totalPages) },
                ) {
                    Text("Próxima")
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    val pwInfo = tempPasswordDialog
    if (pwInfo != null) {
        val (username, tempPw) = pwInfo
        AlertDialog(
            onDismissRequest = { tempPasswordDialog = null },
            containerColor = colors.bgChannel,
            title = { Text("Senha temporária — @$username", color = colors.textPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Compartilhe esta senha temporária com o usuário:",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        color = colors.bgInput,
                        border = BorderStroke(1.dp, colors.borderSoft),
                    ) {
                        Text(
                            text = tempPw,
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.titleMedium,
                            color = colors.accentMint,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(tempPw))
                        feedback = "Senha temporária copiada." to false
                        tempPasswordDialog = null
                    },
                ) {
                    Text("Copiar", color = colors.accentPrimary)
                }
            },
            dismissButton = {
                TextButton(onClick = { tempPasswordDialog = null }) {
                    Text("Fechar", color = colors.textSecondary)
                }
            },
        )
    }

    val confirmDeleteUser = userToDelete
    if (confirmDeleteUser != null) {
        AlertDialog(
            onDismissRequest = { userToDelete = null },
            containerColor = colors.bgChannel,
            title = { Text("Excluir usuário", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Deseja excluir a conta @${confirmDeleteUser.username}? Essa ação não pode ser desfeita.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        userToDelete = null
                        scope.launch {
                            runCatching {
                                restClient.deleteAdminUser(instanceUrl, token, confirmDeleteUser.id)
                            }.onSuccess {
                                feedback = "Usuário @${confirmDeleteUser.username} excluído." to false
                                reloadKey++
                            }.onFailure {
                                feedback = "Erro ao excluir usuário: ${it.message ?: "desconhecido"}" to true
                            }
                        }
                    },
                ) {
                    Text("Excluir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { userToDelete = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Atualizações
// ─────────────────────────────────────────────────────────────────────────────

@Composable
fun InstanceUpdatesSubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var status by remember { mutableStateOf<InstanceUpdateStatusResponse?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    fun loadStatus(refresh: Boolean) {
        scope.launch {
            isLoading = true
            feedback = null
            runCatching { restClient.getAdminUpdateStatus(instanceUrl, token, refresh = refresh) }
                .onSuccess { status = it }
                .onFailure {
                    feedback = "Erro ao verificar atualizações: ${it.message ?: "desconhecido"}" to true
                }
            isLoading = false
        }
    }

    LaunchedEffect(instanceUrl, token) {
        loadStatus(refresh = false)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        if (isLoading) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = colors.accentPrimary,
                trackColor = colors.interactiveMuted,
            )
        }

        val info = status
        if (info != null) {
            val (stateLabel, stateColor) = when (info.state) {
                "up-to-date" -> "Atualizado" to colors.accentMint
                "update-available" -> "Atualização disponível" to colors.accentAmber
                else -> "Desconhecido" to colors.textSecondary
            }

            AetherSurfaceCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Estado da Instância",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.textPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    AdminBadge(text = stateLabel, color = stateColor)
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "Versão atual: ${info.current.version.ifBlank { "—" }}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
                if (!info.current.commit.isNullOrBlank()) {
                    Text(
                        text = "Commit: ${info.current.commit}",
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = colors.textSecondary,
                    )
                }
                Text(
                    text = "Canal: ${info.channel}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                if (info.checkedAt != null) {
                    Text(
                        text = "Última verificação: ${formatTimestamp(info.checkedAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                }
                if (!info.reason.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "Detalhes: ${info.reason}",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.accentAmber,
                    )
                }
            }

            val latest = info.latest
            if (latest != null) {
                AetherSurfaceCard {
                    Text(
                        text = "Versão mais recente",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.textPrimary,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = latest.version,
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.accentMint,
                    )
                    if (latest.publishedAt.isNotBlank()) {
                        Text(
                            text = "Publicado em: ${latest.publishedAt}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                    if (latest.url.isNotBlank()) {
                        Spacer(Modifier.height(10.dp))
                        OutlinedButton(
                            onClick = {
                                runCatching {
                                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(latest.url))
                                    context.startActivity(intent)
                                }.onFailure {
                                    feedback = "Não foi possível abrir o link." to true
                                }
                            },
                        ) {
                            Icon(Icons.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Abrir notas da versão")
                        }
                    }
                }
            }
        }

        AetherPrimaryButton(
            text = if (isLoading) "Verificando..." else "Verificar novamente",
            enabled = !isLoading,
            onClick = { loadStatus(refresh = true) },
        )
        Spacer(Modifier.height(16.dp))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Telemetria
// ─────────────────────────────────────────────────────────────────────────────

@Composable
fun InstanceTelemetrySubScreen(
    instanceUrl: String,
    token: String,
    restClient: BackspaceRestClient,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var telemetry by remember { mutableStateOf<AdminTelemetryStatus?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var isUpdating by remember { mutableStateOf(false) }
    var previewJson by remember { mutableStateOf<String?>(null) }
    var isLoadingPreview by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    LaunchedEffect(instanceUrl, token) {
        isLoading = true
        runCatching { restClient.getAdminTelemetry(instanceUrl, token) }
            .onSuccess { telemetry = it }
            .onFailure { feedback = "Erro ao carregar telemetria: ${it.message ?: "desconhecido"}" to true }
        isLoading = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminStatusBanner(
            message = feedback?.first,
            isError = feedback?.second == true,
        )

        if (isLoading) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = colors.accentPrimary,
                trackColor = colors.interactiveMuted,
            )
        }

        val info = telemetry
        if (info != null) {
            AetherSurfaceCard {
                AdminToggleRow(
                    title = "Telemetria diária (opt-in)",
                    subtitle = "Envia um ping anônimo diário com versão e métricas agregadas.",
                    checked = info.enabled == true,
                    enabled = !isUpdating,
                    onCheckedChange = { newVal ->
                        scope.launch {
                            isUpdating = true
                            feedback = null
                            runCatching {
                                restClient.updateAdminTelemetry(instanceUrl, token, newVal)
                            }.onSuccess { updated ->
                                telemetry = updated
                                feedback = if (newVal) "Telemetria ativada." to false else "Telemetria desativada." to false
                            }.onFailure {
                                feedback = "Erro ao atualizar telemetria: ${it.message ?: "desconhecido"}" to true
                            }
                            isUpdating = false
                        }
                    },
                )
                Spacer(Modifier.height(12.dp))
                HorizontalDivider(color = colors.borderSoft)
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "Último dia enviado: ${info.lastDay ?: "Nenhum"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textPrimary,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "ID mascarado: ${info.id ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = colors.textSecondary,
                )
                val err = info.lastError
                if (err != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "Último erro: ${err.day} (HTTP ${err.status})",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.accentPeach,
                    )
                }
            }
        }

        AetherSurfaceCard {
            Text(
                text = "Prévia do Payload",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Visualize exatamente o JSON que seria enviado no ping diário.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))
            AetherPrimaryButton(
                text = if (isLoadingPreview) "Carregando prévia..." else "Carregar Prévia do Payload",
                enabled = !isLoadingPreview,
                onClick = {
                    scope.launch {
                        isLoadingPreview = true
                        feedback = null
                        runCatching { restClient.getAdminTelemetryPreview(instanceUrl, token) }
                            .onSuccess { raw -> previewJson = prettyPrintJson(raw) }
                            .onFailure {
                                feedback = "Erro ao carregar prévia: ${it.message ?: "desconhecido"}" to true
                            }
                        isLoadingPreview = false
                    }
                },
            )
            val jsonText = previewJson
            if (jsonText != null) {
                Spacer(Modifier.height(10.dp))
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = colors.bgInput,
                    border = BorderStroke(1.dp, colors.borderSoft),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(12.dp),
                    ) {
                        Text(
                            text = jsonText,
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.accentSky,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
