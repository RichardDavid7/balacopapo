package com.backspace.feature.spaces

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherPrimaryButton
import com.backspace.core.designsystem.AetherPurpleSlider
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.FriendItem
import com.backspace.core.model.MemberWithUser
import com.backspace.core.model.PermissionBits
import com.backspace.core.model.Role
import com.backspace.core.model.Space
import com.backspace.core.model.SpaceBanItem
import com.backspace.core.model.SpaceJoinRequestItem
import com.backspace.core.network.BackspaceRestClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

private val SpaceRoleColorPresets = listOf(
    "#7C6CF6",
    "#7DD3FC",
    "#86EFAC",
    "#FCD34D",
    "#FCA5A5",
    "#F472B6",
    "#2DD4BF",
    "#FB923C",
)

private fun parseSpaceHexColorOrNull(hex: String?): Color? {
    val cleaned = hex?.trim().orEmpty()
    if (cleaned.isEmpty()) return null
    val normalized = if (cleaned.startsWith("#")) cleaned else "#$cleaned"
    if (normalized.length != 7 && normalized.length != 9) return null
    return runCatching { Color(android.graphics.Color.parseColor(normalized)) }.getOrNull()
}

@Composable
private fun SpaceFeedbackBanner(feedback: Pair<String, Boolean>?) {
    if (feedback == null) return
    val colors = LocalAetherColors.current
    val (message, isSuccess) = feedback
    val accent = if (isSuccess) colors.accentMint else colors.accentPeach
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = accent.copy(alpha = 0.14f),
        border = BorderStroke(1.dp, accent.copy(alpha = 0.45f)),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = accent,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

// ============================================================================
// 1. VISÃO GERAL
// ============================================================================

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun SpaceOverviewSubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    currentUserId: String,
    restClient: BackspaceRestClient,
    onSpaceUpdated: () -> Unit,
    onSpaceDeleted: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val isOwner = space.ownerId == currentUserId

    var name by remember(space.id, space.name) { mutableStateOf(space.name) }
    var iconPreviewUrl by remember(space.id, space.icon) { mutableStateOf(space.iconUrl(instanceUrl)) }
    var bannerPreviewUrl by remember(space.id, space.banner) { mutableStateOf(space.bannerUrl(instanceUrl)) }
    var isSaving by remember { mutableStateOf(false) }
    var isUploading by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    // Transferir posse
    var showTransferDialog by remember { mutableStateOf(false) }
    var transferSearch by remember { mutableStateOf("") }
    var pendingTransferTarget by remember { mutableStateOf<MemberWithUser?>(null) }
    var isTransferring by remember { mutableStateOf(false) }

    // Excluir Espaço (2 passos)
    var deleteStep by remember { mutableIntStateOf(0) } // 0 = fechado, 1 = aviso, 2 = digitar nome
    var deleteConfirmInput by remember { mutableStateOf("") }
    var isDeleting by remember { mutableStateOf(false) }

    suspend fun readUriBytes(uri: Uri, fallbackName: String): Triple<String, String, ByteArray> =
        withContext(Dispatchers.IO) {
            val resolver = context.contentResolver
            var fileName = fallbackName
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) fileName = cursor.getString(idx) ?: fileName
                }
            }
            val mime = resolver.getType(uri) ?: "image/png"
            val data = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("Não foi possível ler a imagem selecionada.")
            Triple(fileName, mime, data)
        }

    val iconPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            isUploading = true
            feedback = null
            runCatching {
                val (fileName, mime, bytes) = readUriBytes(uri, "space_icon.png")
                val uploaded = restClient.uploadFileTus(instanceUrl, token, fileName, mime, bytes)
                restClient.updateSpaceFull(
                    instanceUrl = instanceUrl,
                    token = token,
                    spaceId = space.id,
                    icon = uploaded.filename,
                )
            }.onSuccess { updated ->
                iconPreviewUrl = updated.iconUrl(instanceUrl)
                onSpaceUpdated()
                feedback = "Ícone do Espaço atualizado!" to true
            }.onFailure { err ->
                feedback = (err.message ?: "Erro ao enviar ícone.") to false
            }
            isUploading = false
        }
    }

    val bannerPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            isUploading = true
            feedback = null
            runCatching {
                val (fileName, mime, bytes) = readUriBytes(uri, "space_banner.png")
                val uploaded = restClient.uploadFileTus(instanceUrl, token, fileName, mime, bytes)
                restClient.updateSpaceFull(
                    instanceUrl = instanceUrl,
                    token = token,
                    spaceId = space.id,
                    banner = uploaded.filename,
                )
            }.onSuccess { updated ->
                bannerPreviewUrl = updated.bannerUrl(instanceUrl)
                onSpaceUpdated()
                feedback = "Banner do Espaço atualizado!" to true
            }.onFailure { err ->
                feedback = (err.message ?: "Erro ao enviar banner.") to false
            }
            isUploading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        AetherSurfaceCard {
            Text(
                text = "Identidade Visual",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(12.dp))

            // Banner
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.bgElevated)
                    .border(1.dp, colors.borderSoft, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (!bannerPreviewUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = bannerPreviewUrl,
                        contentDescription = "Banner do Espaço",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Text(
                        text = "Sem banner configurado",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                    )
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { bannerPicker.launch("image/*") },
                    enabled = !isUploading && !isSaving,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(if (isUploading) "Enviando..." else "Enviar Banner")
                }
                if (!bannerPreviewUrl.isNullOrBlank()) {
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                isUploading = true
                                feedback = null
                                runCatching {
                                    restClient.updateSpaceFull(
                                        instanceUrl = instanceUrl,
                                        token = token,
                                        spaceId = space.id,
                                        banner = "",
                                    )
                                }.onSuccess {
                                    bannerPreviewUrl = null
                                    onSpaceUpdated()
                                    feedback = "Banner removido." to true
                                }.onFailure { err ->
                                    feedback = (err.message ?: "Erro ao remover banner.") to false
                                }
                                isUploading = false
                            }
                        },
                        enabled = !isUploading && !isSaving,
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                    ) {
                        Text("Remover")
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider(color = colors.borderSoft)
            Spacer(modifier = Modifier.height(16.dp))

            // Ícone
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AetherAvatar(
                    imageUrl = iconPreviewUrl,
                    fallbackLabel = name.ifBlank { space.name },
                    size = 64.dp,
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    OutlinedButton(
                        onClick = { iconPicker.launch("image/*") },
                        enabled = !isUploading && !isSaving,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Text(if (isUploading) "Enviando..." else "Alterar Ícone")
                    }
                    if (!iconPreviewUrl.isNullOrBlank()) {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    isUploading = true
                                    feedback = null
                                    runCatching {
                                        restClient.updateSpaceFull(
                                            instanceUrl = instanceUrl,
                                            token = token,
                                            spaceId = space.id,
                                            icon = "",
                                        )
                                    }.onSuccess {
                                        iconPreviewUrl = null
                                        onSpaceUpdated()
                                        feedback = "Ícone removido." to true
                                    }.onFailure { err ->
                                        feedback = (err.message ?: "Erro ao remover ícone.") to false
                                    }
                                    isUploading = false
                                }
                            },
                            enabled = !isUploading && !isSaving,
                        ) {
                            Text("Remover ícone", color = colors.accentPeach)
                        }
                    }
                }
            }
        }

        AetherSurfaceCard {
            Text(
                text = "Nome do Espaço",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(10.dp))
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Nome") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(12.dp))
            AetherPrimaryButton(
                text = if (isSaving) "Salvando..." else "Salvar alterações",
                enabled = !isSaving && !isUploading && name.isNotBlank(),
                onClick = {
                    scope.launch {
                        isSaving = true
                        feedback = null
                        runCatching {
                            restClient.updateSpaceFull(
                                instanceUrl = instanceUrl,
                                token = token,
                                spaceId = space.id,
                                name = name.trim(),
                            )
                        }.onSuccess {
                            onSpaceUpdated()
                            feedback = "Nome do Espaço atualizado!" to true
                        }.onFailure { err ->
                            feedback = (err.message ?: "Erro ao salvar alterações.") to false
                        }
                        isSaving = false
                    }
                },
            )
        }

        if (isOwner) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = colors.bgChannel,
                border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.45f)),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        text = "Zona de Perigo (Proprietário)",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.accentPeach,
                    )
                    Text(
                        text = "Ações irreversíveis de propriedade e exclusão deste Espaço.",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                    OutlinedButton(
                        onClick = {
                            transferSearch = ""
                            showTransferDialog = true
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, colors.accentAmber.copy(alpha = 0.6f)),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentAmber),
                    ) {
                        Text("Transferir Posse")
                    }
                    OutlinedButton(
                        onClick = {
                            deleteConfirmInput = ""
                            deleteStep = 1
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.7f)),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                    ) {
                        Text("Excluir Espaço")
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }

    // Diálogo: Selecionar novo proprietário
    if (showTransferDialog) {
        val candidates = remember(space.members, transferSearch, currentUserId) {
            val q = transferSearch.trim().lowercase()
            space.members
                .filter { it.userId != currentUserId }
                .filter { member ->
                    q.isEmpty() ||
                        member.label.lowercase().contains(q) ||
                        member.user?.username?.lowercase()?.contains(q) == true
                }
        }
        AlertDialog(
            onDismissRequest = { showTransferDialog = false },
            containerColor = colors.bgElevated,
            titleContentColor = colors.textPrimary,
            textContentColor = colors.textSecondary,
            title = { Text("Transferir Posse") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Escolha o membro que se tornará o novo proprietário de \"${space.name}\".",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                    OutlinedTextField(
                        value = transferSearch,
                        onValueChange = { transferSearch = it },
                        placeholder = { Text("Buscar membro...") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 240.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (candidates.isEmpty()) {
                            Text(
                                text = "Nenhum membro elegível encontrado.",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textTertiary,
                            )
                        } else {
                            candidates.forEach { member ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(colors.bgChannel)
                                        .clickable {
                                            pendingTransferTarget = member
                                            showTransferDialog = false
                                        }
                                        .padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    AetherAvatar(
                                        imageUrl = member.user?.avatarUrl(instanceUrl),
                                        fallbackLabel = member.label,
                                        size = 34.dp,
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = member.label,
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = colors.textPrimary,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        member.user?.username?.let { uname ->
                                            Text(
                                                text = "@$uname",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = colors.textSecondary,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showTransferDialog = false }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }

    // Diálogo: Confirmação da transferência de posse
    pendingTransferTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { if (!isTransferring) pendingTransferTarget = null },
            containerColor = colors.bgElevated,
            titleContentColor = colors.textPrimary,
            textContentColor = colors.textSecondary,
            title = { Text("Confirmar transferência") },
            text = {
                Text(
                    "Deseja transferir a posse de \"${space.name}\" para ${target.label}? Você deixará de ser o proprietário.",
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !isTransferring,
                    onClick = {
                        scope.launch {
                            isTransferring = true
                            feedback = null
                            runCatching {
                                restClient.transferSpaceOwnership(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    spaceId = space.id,
                                    newOwnerId = target.userId,
                                )
                            }.onSuccess {
                                pendingTransferTarget = null
                                onSpaceUpdated()
                                feedback = "Posse transferida para ${target.label}." to true
                            }.onFailure { err ->
                                pendingTransferTarget = null
                                feedback = (err.message ?: "Erro ao transferir posse.") to false
                            }
                            isTransferring = false
                        }
                    },
                ) {
                    Text(
                        text = if (isTransferring) "Transferindo..." else "Confirmar",
                        color = colors.accentAmber,
                    )
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isTransferring,
                    onClick = { pendingTransferTarget = null },
                ) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }

    // Diálogo: Excluir Espaço (Passo 1)
    if (deleteStep == 1) {
        AlertDialog(
            onDismissRequest = { deleteStep = 0 },
            containerColor = colors.bgElevated,
            titleContentColor = colors.accentPeach,
            textContentColor = colors.textSecondary,
            title = { Text("Excluir Espaço?") },
            text = {
                Text(
                    "Esta ação excluirá permanentemente todos os canais, mensagens, cargos e configurações de \"${space.name}\". Deseja continuar?",
                )
            },
            confirmButton = {
                TextButton(onClick = { deleteStep = 2 }) {
                    Text("Continuar", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteStep = 0 }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }

    // Diálogo: Excluir Espaço (Passo 2)
    if (deleteStep == 2) {
        val matchesName = deleteConfirmInput.trim() == space.name.trim()
        AlertDialog(
            onDismissRequest = { if (!isDeleting) deleteStep = 0 },
            containerColor = colors.bgElevated,
            titleContentColor = colors.accentPeach,
            textContentColor = colors.textSecondary,
            title = { Text("Confirmação final") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Digite \"${space.name}\" para confirmar a exclusão definitiva:")
                    OutlinedTextField(
                        value = deleteConfirmInput,
                        onValueChange = { deleteConfirmInput = it },
                        singleLine = true,
                        placeholder = { Text(space.name) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = matchesName && !isDeleting,
                    onClick = {
                        scope.launch {
                            isDeleting = true
                            feedback = null
                            runCatching {
                                restClient.deleteSpace(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    spaceId = space.id,
                                )
                            }.onSuccess {
                                deleteStep = 0
                                onSpaceDeleted()
                            }.onFailure { err ->
                                deleteStep = 0
                                feedback = (err.message ?: "Erro ao excluir Espaço.") to false
                            }
                            isDeleting = false
                        }
                    },
                ) {
                    Text(
                        text = if (isDeleting) "Excluindo..." else "Excluir definitivamente",
                        color = if (matchesName) colors.accentPeach else colors.textTertiary,
                    )
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isDeleting,
                    onClick = { deleteStep = 0 },
                ) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ============================================================================
// 2. DESCOBERTA
// ============================================================================

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun SpaceDiscoverySubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
    onSpaceUpdated: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var visibility by remember(space.id, space.visibility) { mutableStateOf(space.visibility.ifBlank { "private" }) }
    var directoryListed by remember(space.id, space.directoryListed) { mutableStateOf(space.directoryListed) }
    var description by remember(space.id, space.description) { mutableStateOf(space.description.orEmpty().take(200)) }
    var isSaving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    var requests by remember(space.id) { mutableStateOf<List<SpaceJoinRequestItem>>(emptyList()) }
    var isLoadingRequests by remember { mutableStateOf(true) }
    var handlingRequestId by remember { mutableStateOf<String?>(null) }

    fun loadRequests() {
        scope.launch {
            isLoadingRequests = true
            runCatching {
                restClient.getSpaceJoinRequests(instanceUrl, token, space.id)
            }.onSuccess { list ->
                requests = list
            }.onFailure { err ->
                feedback = (err.message ?: "Erro ao carregar solicitações.") to false
            }
            isLoadingRequests = false
        }
    }

    LaunchedEffect(space.id) {
        loadRequests()
    }

    val visibilityOptions = listOf(
        Triple("private", "Privado", "Somente por convite"),
        Triple("request", "Sob Solicitação", "Usuários solicitam aprovação"),
        Triple("public", "Público", "Qualquer pessoa pode entrar"),
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        AetherSurfaceCard {
            Text(
                text = "Visibilidade do Espaço",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(10.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                visibilityOptions.forEach { (wire, label, _) ->
                    FilterChip(
                        selected = visibility == wire,
                        onClick = { visibility = wire },
                        label = { Text(label) },
                    )
                }
            }
            visibilityOptions.firstOrNull { it.first == visibility }?.let { (_, _, hint) ->
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = hint,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }

            Spacer(modifier = Modifier.height(14.dp))
            HorizontalDivider(color = colors.borderSoft)
            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Diretório Global",
                        style = MaterialTheme.typography.bodyLarge,
                        color = colors.textPrimary,
                    )
                    Text(
                        text = "Exibir este Espaço na listagem pública do diretório.",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                }
                Switch(
                    checked = directoryListed,
                    onCheckedChange = { directoryListed = it },
                )
            }

            Spacer(modifier = Modifier.height(14.dp))
            OutlinedTextField(
                value = description,
                onValueChange = { if (it.length <= 200) description = it },
                label = { Text("Descrição (${description.length}/200)") },
                minLines = 3,
                maxLines = 5,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(12.dp))
            AetherPrimaryButton(
                text = if (isSaving) "Salvando..." else "Salvar descoberta",
                enabled = !isSaving,
                onClick = {
                    scope.launch {
                        isSaving = true
                        feedback = null
                        runCatching {
                            restClient.updateSpaceFull(
                                instanceUrl = instanceUrl,
                                token = token,
                                spaceId = space.id,
                                visibility = visibility,
                                directoryListed = directoryListed,
                                description = description.trim(),
                            )
                        }.onSuccess {
                            onSpaceUpdated()
                            feedback = "Configurações de descoberta salvas!" to true
                        }.onFailure { err ->
                            feedback = (err.message ?: "Erro ao salvar descoberta.") to false
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
                    text = "Solicitações de Entrada",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = { loadRequests() },
                    enabled = !isLoadingRequests,
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Atualizar",
                        tint = colors.textSecondary,
                    )
                }
            }
            Spacer(modifier = Modifier.height(8.dp))

            val pendingRequests = requests.filter { it.status == "pending" }
            if (isLoadingRequests) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        color = colors.accentPrimary,
                        modifier = Modifier.size(24.dp),
                    )
                }
            } else if (pendingRequests.isEmpty()) {
                Text(
                    text = "Nenhuma solicitação pendente no momento.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    pendingRequests.forEach { req ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = colors.bgElevated,
                            border = BorderStroke(1.dp, colors.borderSoft),
                        ) {
                            Column(
                                modifier = Modifier.padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    AetherAvatar(
                                        imageUrl = req.user?.avatarUrl(instanceUrl),
                                        fallbackLabel = req.label,
                                        size = 38.dp,
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = req.label,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold,
                                            color = colors.textPrimary,
                                        )
                                        req.user?.username?.let { uname ->
                                            Text(
                                                text = "@$uname",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = colors.textSecondary,
                                            )
                                        }
                                    }
                                }
                                val reqMessage = req.message
                                if (!reqMessage.isNullOrBlank()) {
                                    Text(
                                        text = reqMessage,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.textSecondary,
                                    )
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    val busy = handlingRequestId == req.id
                                    OutlinedButton(
                                        enabled = !busy,
                                        onClick = {
                                            scope.launch {
                                                handlingRequestId = req.id
                                                feedback = null
                                                runCatching {
                                                    restClient.handleSpaceJoinRequest(
                                                        instanceUrl = instanceUrl,
                                                        token = token,
                                                        spaceId = space.id,
                                                        requestId = req.id,
                                                        action = "accept",
                                                    )
                                                }.onSuccess {
                                                    requests = requests.filterNot { it.id == req.id }
                                                    onSpaceUpdated()
                                                    feedback = "Solicitação de ${req.label} aceita." to true
                                                }.onFailure { err ->
                                                    feedback = (err.message ?: "Erro ao aceitar solicitação.") to false
                                                }
                                                handlingRequestId = null
                                            }
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, colors.accentMint.copy(alpha = 0.6f)),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentMint),
                                    ) {
                                        Text("Aceitar")
                                    }
                                    OutlinedButton(
                                        enabled = !busy,
                                        onClick = {
                                            scope.launch {
                                                handlingRequestId = req.id
                                                feedback = null
                                                runCatching {
                                                    restClient.handleSpaceJoinRequest(
                                                        instanceUrl = instanceUrl,
                                                        token = token,
                                                        spaceId = space.id,
                                                        requestId = req.id,
                                                        action = "decline",
                                                    )
                                                }.onSuccess {
                                                    requests = requests.filterNot { it.id == req.id }
                                                    feedback = "Solicitação de ${req.label} recusada." to true
                                                }.onFailure { err ->
                                                    feedback = (err.message ?: "Erro ao recusar solicitação.") to false
                                                }
                                                handlingRequestId = null
                                            }
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.6f)),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                                    ) {
                                        Text("Recusar")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

// ============================================================================
// 3. MEMBROS
// ============================================================================

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun SpaceMembersSubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    currentUserId: String,
    restClient: BackspaceRestClient,
    onSpaceUpdated: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var searchQuery by remember { mutableStateOf("") }
    var selectedMember by remember { mutableStateOf<MemberWithUser?>(null) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    // Estados do painel de gerenciamento do membro selecionado
    var nicknameInput by remember { mutableStateOf("") }
    var assignedRoleIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var isMutating by remember { mutableStateOf(false) }

    // Confirmações de expulsar / banir
    var showKickConfirm by remember { mutableStateOf(false) }
    var showBanDialog by remember { mutableStateOf(false) }
    var banReason by remember { mutableStateOf("") }

    val assignableRoles = remember(space.roles) {
        space.roles
            .filter { !it.isEveryone && !it.isDefault }
            .sortedByDescending { it.position }
    }

    val filteredMembers = remember(space.members, searchQuery) {
        val q = searchQuery.trim().lowercase()
        space.members.filter { member ->
            q.isEmpty() ||
                member.label.lowercase().contains(q) ||
                member.user?.username?.lowercase()?.contains(q) == true ||
                member.nickname?.lowercase()?.contains(q) == true
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text("Buscar membro por nome ou apelido...") },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = null,
                    tint = colors.textTertiary,
                )
            },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Text(
            text = "${filteredMembers.size} de ${space.members.size} membros",
            style = MaterialTheme.typography.labelMedium,
            color = colors.textSecondary,
        )

        AetherSurfaceCard {
            if (filteredMembers.isEmpty()) {
                Text(
                    text = "Nenhum membro encontrado.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                filteredMembers.forEachIndexed { index, member ->
                    if (index > 0) {
                        HorizontalDivider(
                            color = colors.borderSoft,
                            modifier = Modifier.padding(vertical = 6.dp),
                        )
                    }
                    val isSpaceOwner = member.userId == space.ownerId
                    val memberRoles = member.roles.filter { !it.isEveryone && !it.isDefault }
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable {
                                selectedMember = member
                                nicknameInput = member.nickname.orEmpty()
                                assignedRoleIds = memberRoles.map { it.id }.toSet()
                            }
                            .padding(vertical = 6.dp, horizontal = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AetherAvatar(
                                imageUrl = member.user?.avatarUrl(instanceUrl),
                                fallbackLabel = member.label,
                                size = 40.dp,
                                status = member.user?.status,
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text(
                                        text = member.label,
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = FontWeight.Medium,
                                        color = parseSpaceHexColorOrNull(member.highestRoleColorHex)
                                            ?: colors.textPrimary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    if (isSpaceOwner) {
                                        Surface(
                                            shape = RoundedCornerShape(6.dp),
                                            color = colors.accentAmber.copy(alpha = 0.2f),
                                        ) {
                                            Text(
                                                text = "Dono",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = colors.accentAmber,
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                            )
                                        }
                                    }
                                }
                                val username = member.user?.username
                                if (!username.isNullOrBlank()) {
                                    Text(
                                        text = "@$username",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = colors.textSecondary,
                                    )
                                }
                            }
                        }

                        if (memberRoles.isNotEmpty()) {
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                memberRoles.forEach { role ->
                                    val roleColor = parseSpaceHexColorOrNull(role.color) ?: colors.accentPrimary
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = roleColor.copy(alpha = 0.16f),
                                        border = BorderStroke(1.dp, roleColor.copy(alpha = 0.45f)),
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .size(7.dp)
                                                    .clip(CircleShape)
                                                    .background(roleColor),
                                            )
                                            Text(
                                                text = role.name,
                                                style = MaterialTheme.typography.labelSmall,
                                                color = colors.textPrimary,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }

    // Painel/Diálogo de gerenciamento do membro
    selectedMember?.let { member ->
        val canModerate = member.userId != currentUserId && member.userId != space.ownerId
        AlertDialog(
            onDismissRequest = { if (!isMutating) selectedMember = null },
            containerColor = colors.bgElevated,
            titleContentColor = colors.textPrimary,
            textContentColor = colors.textSecondary,
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AetherAvatar(
                        imageUrl = member.user?.avatarUrl(instanceUrl),
                        fallbackLabel = member.label,
                        size = 36.dp,
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = member.label,
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        member.user?.username?.let { uname ->
                            Text(
                                text = "@$uname",
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textSecondary,
                            )
                        }
                    }
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    // Apelido
                    Text(
                        text = "Apelido no Espaço",
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.textPrimary,
                    )
                    OutlinedTextField(
                        value = nicknameInput,
                        onValueChange = { nicknameInput = it },
                        placeholder = { Text("Deixe vazio para remover apelido") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedButton(
                        enabled = !isMutating,
                        onClick = {
                            scope.launch {
                                isMutating = true
                                feedback = null
                                runCatching {
                                    restClient.updateMemberNickname(
                                        instanceUrl = instanceUrl,
                                        token = token,
                                        spaceId = space.id,
                                        userId = member.userId,
                                        nickname = nicknameInput.trim().ifEmpty { null },
                                    )
                                }.onSuccess {
                                    onSpaceUpdated()
                                    feedback = "Apelido de ${member.label} atualizado." to true
                                }.onFailure { err ->
                                    feedback = (err.message ?: "Erro ao alterar apelido.") to false
                                }
                                isMutating = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Text("Salvar apelido")
                    }

                    HorizontalDivider(color = colors.borderSoft)

                    // Cargos
                    Text(
                        text = "Cargos",
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.textPrimary,
                    )
                    if (assignableRoles.isEmpty()) {
                        Text(
                            text = "Nenhum cargo personalizado criado.",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                    } else {
                        assignableRoles.forEach { role ->
                            val hasRole = role.id in assignedRoleIds
                            val roleColor = parseSpaceHexColorOrNull(role.color) ?: colors.accentPrimary
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable(enabled = !isMutating) {
                                        scope.launch {
                                            isMutating = true
                                            feedback = null
                                            val result = runCatching {
                                                if (hasRole) {
                                                    restClient.removeMemberRole(
                                                        instanceUrl = instanceUrl,
                                                        token = token,
                                                        spaceId = space.id,
                                                        userId = member.userId,
                                                        roleId = role.id,
                                                    )
                                                } else {
                                                    restClient.assignMemberRole(
                                                        instanceUrl = instanceUrl,
                                                        token = token,
                                                        spaceId = space.id,
                                                        userId = member.userId,
                                                        roleId = role.id,
                                                    )
                                                }
                                            }
                                            result.onSuccess {
                                                assignedRoleIds = if (hasRole) {
                                                    assignedRoleIds - role.id
                                                } else {
                                                    assignedRoleIds + role.id
                                                }
                                                onSpaceUpdated()
                                            }.onFailure { err ->
                                                feedback = (err.message ?: "Erro ao atualizar cargo.") to false
                                            }
                                            isMutating = false
                                        }
                                    }
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(
                                    checked = hasRole,
                                    enabled = !isMutating,
                                    onCheckedChange = null,
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Box(
                                    modifier = Modifier
                                        .size(10.dp)
                                        .clip(CircleShape)
                                        .background(roleColor),
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = role.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = colors.textPrimary,
                                )
                            }
                        }
                    }

                    if (canModerate) {
                        HorizontalDivider(color = colors.borderSoft)
                        Text(
                            text = "Moderação",
                            style = MaterialTheme.typography.labelLarge,
                            color = colors.accentPeach,
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedButton(
                                enabled = !isMutating,
                                onClick = { showKickConfirm = true },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, colors.accentAmber.copy(alpha = 0.6f)),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentAmber),
                            ) {
                                Text("Expulsar")
                            }
                            OutlinedButton(
                                enabled = !isMutating,
                                onClick = {
                                    banReason = ""
                                    showBanDialog = true
                                },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.6f)),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                            ) {
                                Text("Banir")
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !isMutating,
                    onClick = { selectedMember = null },
                ) {
                    Text("Fechar", color = colors.accentPrimary)
                }
            },
        )

        if (showKickConfirm) {
            AlertDialog(
                onDismissRequest = { if (!isMutating) showKickConfirm = false },
                containerColor = colors.bgElevated,
                titleContentColor = colors.textPrimary,
                textContentColor = colors.textSecondary,
                title = { Text("Expulsar ${member.label}?") },
                text = { Text("O membro será removido do Espaço e precisará de um novo convite para retornar.") },
                confirmButton = {
                    TextButton(
                        enabled = !isMutating,
                        onClick = {
                            scope.launch {
                                isMutating = true
                                feedback = null
                                runCatching {
                                    restClient.kickMember(instanceUrl, token, space.id, member.userId)
                                }.onSuccess {
                                    showKickConfirm = false
                                    selectedMember = null
                                    onSpaceUpdated()
                                    feedback = "${member.label} foi expulso do Espaço." to true
                                }.onFailure { err ->
                                    showKickConfirm = false
                                    feedback = (err.message ?: "Erro ao expulsar membro.") to false
                                }
                                isMutating = false
                            }
                        },
                    ) {
                        Text("Expulsar", color = colors.accentAmber)
                    }
                },
                dismissButton = {
                    TextButton(
                        enabled = !isMutating,
                        onClick = { showKickConfirm = false },
                    ) {
                        Text("Cancelar", color = colors.textSecondary)
                    }
                },
            )
        }

        if (showBanDialog) {
            AlertDialog(
                onDismissRequest = { if (!isMutating) showBanDialog = false },
                containerColor = colors.bgElevated,
                titleContentColor = colors.accentPeach,
                textContentColor = colors.textSecondary,
                title = { Text("Banir ${member.label}?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("O membro será removido e impedido de entrar novamente neste Espaço.")
                        OutlinedTextField(
                            value = banReason,
                            onValueChange = { banReason = it },
                            label = { Text("Motivo (opcional)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        enabled = !isMutating,
                        onClick = {
                            scope.launch {
                                isMutating = true
                                feedback = null
                                runCatching {
                                    restClient.banMember(
                                        instanceUrl = instanceUrl,
                                        token = token,
                                        spaceId = space.id,
                                        userId = member.userId,
                                        reason = banReason.trim().ifBlank { null },
                                    )
                                }.onSuccess {
                                    showBanDialog = false
                                    selectedMember = null
                                    onSpaceUpdated()
                                    feedback = "${member.label} foi banido do Espaço." to true
                                }.onFailure { err ->
                                    showBanDialog = false
                                    feedback = (err.message ?: "Erro ao banir membro.") to false
                                }
                                isMutating = false
                            }
                        },
                    ) {
                        Text("Banir", color = colors.accentPeach)
                    }
                },
                dismissButton = {
                    TextButton(
                        enabled = !isMutating,
                        onClick = { showBanDialog = false },
                    ) {
                        Text("Cancelar", color = colors.textSecondary)
                    }
                },
            )
        }
    }
}

// ============================================================================
// 4. CARGOS E PERMISSÕES
// ============================================================================

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun SpaceRolesSubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
    onSpaceUpdated: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var editingRole by remember { mutableStateOf<Role?>(null) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var isMutating by remember { mutableStateOf(false) }

    // Criar novo cargo
    var showCreateDialog by remember { mutableStateOf(false) }
    var newRoleName by remember { mutableStateOf("") }
    var newRoleColor by remember { mutableStateOf(SpaceRoleColorPresets.first()) }

    val sortedRoles = remember(space.roles) {
        space.roles.sortedWith(
            compareBy<Role> { it.isEveryone || it.isDefault }
                .thenByDescending { it.position },
        )
    }

    val activeRole = editingRole
    if (activeRole != null) {
        var roleName by remember(activeRole.id) { mutableStateOf(activeRole.name) }
        var roleColor by remember(activeRole.id) { mutableStateOf(activeRole.color.ifBlank { "#7C6CF6" }) }
        var permissionsMask by remember(activeRole.id) { mutableStateOf(activeRole.permissions.ifBlank { "0" }) }
        var showDeleteRoleConfirm by remember(activeRole.id) { mutableStateOf(false) }

        val isEveryoneRole = activeRole.isEveryone || activeRole.isDefault
        val adminEnabled = PermissionBits.hasBitStrict(permissionsMask, 0)
        val permissionGroups = remember {
            listOf("Geral", "Texto", "Voz").map { group ->
                group to PermissionBits.allPermissions.filter { it.group == group }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.bgBase)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { editingRole = null }
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Voltar para lista de cargos",
                    tint = colors.accentPrimary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "Voltar para lista de cargos",
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.accentPrimary,
                )
            }

            SpaceFeedbackBanner(feedback)

            AetherSurfaceCard {
                Text(
                    text = if (isEveryoneRole) "Editar @everyone" else "Editar Cargo",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                )
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedTextField(
                    value = roleName,
                    onValueChange = { if (!isEveryoneRole) roleName = it },
                    label = { Text("Nome do cargo") },
                    enabled = !isEveryoneRole,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Cor do cargo",
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.textSecondary,
                )
                Spacer(modifier = Modifier.height(8.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    SpaceRoleColorPresets.forEach { preset ->
                        val presetColor = parseSpaceHexColorOrNull(preset) ?: colors.accentPrimary
                        val selected = roleColor.equals(preset, ignoreCase = true)
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(presetColor)
                                .border(
                                    width = if (selected) 3.dp else 1.dp,
                                    color = if (selected) colors.textPrimary else colors.borderSoft,
                                    shape = CircleShape,
                                )
                                .clickable { roleColor = preset },
                        )
                    }
                }
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedTextField(
                    value = roleColor,
                    onValueChange = { roleColor = it },
                    label = { Text("Cor Hex (#RRGGBB)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // Matriz Completa de Permissões
            permissionGroups.forEach { (groupName, descriptors) ->
                AetherSurfaceCard {
                    Text(
                        text = "Permissões — $groupName",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.accentPrimary,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    descriptors.forEachIndexed { idx, descriptor ->
                        if (idx > 0) {
                            HorizontalDivider(
                                color = colors.borderSoft,
                                modifier = Modifier.padding(vertical = 6.dp),
                            )
                        }
                        val isAdminBit = descriptor.bit == 0
                        val inheritedFromAdmin = !isAdminBit && adminEnabled
                        val checked = if (isAdminBit) {
                            adminEnabled
                        } else {
                            inheritedFromAdmin || PermissionBits.hasBitStrict(permissionsMask, descriptor.bit)
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = descriptor.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                    color = if (inheritedFromAdmin) colors.textSecondary else colors.textPrimary,
                                )
                                Text(
                                    text = if (inheritedFromAdmin) {
                                        "Herdado automaticamente de Administrador"
                                    } else {
                                        descriptor.description
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (inheritedFromAdmin) colors.accentAmber else colors.textSecondary,
                                )
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            Switch(
                                checked = checked,
                                enabled = isAdminBit || !adminEnabled,
                                onCheckedChange = { enabled ->
                                    permissionsMask = PermissionBits.setBit(permissionsMask, descriptor.bit, enabled)
                                },
                            )
                        }
                    }
                }
            }

            AetherPrimaryButton(
                text = if (isMutating) "Salvando..." else "Salvar cargo",
                enabled = !isMutating && (isEveryoneRole || roleName.isNotBlank()),
                onClick = {
                    scope.launch {
                        isMutating = true
                        feedback = null
                        runCatching {
                            restClient.updateRole(
                                instanceUrl = instanceUrl,
                                token = token,
                                spaceId = space.id,
                                roleId = activeRole.id,
                                name = if (isEveryoneRole) null else roleName.trim(),
                                color = roleColor.trim(),
                                permissions = permissionsMask,
                                permissionsVersion = activeRole.permissionsVersion,
                            )
                        }.onSuccess { updated ->
                            editingRole = updated
                            onSpaceUpdated()
                            feedback = "Cargo \"${updated.name}\" salvo com sucesso!" to true
                        }.onFailure { err ->
                            feedback = (err.message ?: "Erro ao salvar cargo.") to false
                        }
                        isMutating = false
                    }
                },
            )

            if (!isEveryoneRole) {
                OutlinedButton(
                    enabled = !isMutating,
                    onClick = { showDeleteRoleConfirm = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, colors.accentPeach.copy(alpha = 0.65f)),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentPeach),
                ) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Excluir cargo")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }

        if (showDeleteRoleConfirm) {
            AlertDialog(
                onDismissRequest = { if (!isMutating) showDeleteRoleConfirm = false },
                containerColor = colors.bgElevated,
                titleContentColor = colors.accentPeach,
                textContentColor = colors.textSecondary,
                title = { Text("Excluir cargo \"${activeRole.name}\"?") },
                text = { Text("Todos os membros com este cargo perderão as permissões associadas a ele.") },
                confirmButton = {
                    TextButton(
                        enabled = !isMutating,
                        onClick = {
                            scope.launch {
                                isMutating = true
                                feedback = null
                                runCatching {
                                    restClient.deleteRole(instanceUrl, token, space.id, activeRole.id)
                                }.onSuccess {
                                    showDeleteRoleConfirm = false
                                    editingRole = null
                                    onSpaceUpdated()
                                    feedback = "Cargo excluído." to true
                                }.onFailure { err ->
                                    showDeleteRoleConfirm = false
                                    feedback = (err.message ?: "Erro ao excluir cargo.") to false
                                }
                                isMutating = false
                            }
                        },
                    ) {
                        Text("Excluir", color = colors.accentPeach)
                    }
                },
                dismissButton = {
                    TextButton(
                        enabled = !isMutating,
                        onClick = { showDeleteRoleConfirm = false },
                    ) {
                        Text("Cancelar", color = colors.textSecondary)
                    }
                },
            )
        }
        return
    }

    // Lista de cargos + reordenação
    val customRoles = sortedRoles.filter { !it.isEveryone && !it.isDefault }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        AetherPrimaryButton(
            text = "+ Novo Cargo",
            enabled = !isMutating,
            onClick = {
                newRoleName = ""
                newRoleColor = SpaceRoleColorPresets.first()
                showCreateDialog = true
            },
        )

        AetherSurfaceCard {
            Text(
                text = "Hierarquia de Cargos (${sortedRoles.size})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Text(
                text = "Toque em um cargo para editar nome, cor e matriz de permissões.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(modifier = Modifier.height(10.dp))

            sortedRoles.forEachIndexed { index, role ->
                if (index > 0) {
                    HorizontalDivider(
                        color = colors.borderSoft,
                        modifier = Modifier.padding(vertical = 4.dp),
                    )
                }
                val isEveryone = role.isEveryone || role.isDefault
                val roleColor = parseSpaceHexColorOrNull(role.color) ?: colors.accentPrimary
                val customIdx = customRoles.indexOfFirst { it.id == role.id }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            feedback = null
                            editingRole = role
                        }
                        .padding(vertical = 8.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .clip(CircleShape)
                            .background(roleColor),
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = role.name.ifBlank { if (isEveryone) "@everyone" else "Cargo" },
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                            color = colors.textPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = if (isEveryone) "Cargo padrão de todos os membros" else "Posição #${role.position}",
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.textSecondary,
                        )
                    }
                    if (!isEveryone && customIdx >= 0) {
                        IconButton(
                            enabled = !isMutating && customIdx > 0,
                            onClick = {
                                val above = customRoles[customIdx - 1]
                                scope.launch {
                                    isMutating = true
                                    feedback = null
                                    runCatching {
                                        val targetPos = if (above.position == role.position) {
                                            above.position + 1
                                        } else {
                                            above.position
                                        }
                                        restClient.updateRole(
                                            instanceUrl = instanceUrl,
                                            token = token,
                                            spaceId = space.id,
                                            roleId = role.id,
                                            position = targetPos,
                                        )
                                        restClient.updateRole(
                                            instanceUrl = instanceUrl,
                                            token = token,
                                            spaceId = space.id,
                                            roleId = above.id,
                                            position = role.position,
                                        )
                                    }.onSuccess {
                                        onSpaceUpdated()
                                    }.onFailure { err ->
                                        feedback = (err.message ?: "Erro ao reordenar cargo.") to false
                                    }
                                    isMutating = false
                                }
                            },
                        ) {
                            Icon(
                                imageVector = Icons.Default.ArrowUpward,
                                contentDescription = "Subir cargo",
                                tint = if (customIdx > 0) colors.textPrimary else colors.textTertiary,
                            )
                        }
                        IconButton(
                            enabled = !isMutating && customIdx < customRoles.lastIndex,
                            onClick = {
                                val below = customRoles[customIdx + 1]
                                scope.launch {
                                    isMutating = true
                                    feedback = null
                                    runCatching {
                                        val targetPos = if (below.position == role.position) {
                                            (below.position - 1).coerceAtLeast(1)
                                        } else {
                                            below.position
                                        }
                                        restClient.updateRole(
                                            instanceUrl = instanceUrl,
                                            token = token,
                                            spaceId = space.id,
                                            roleId = role.id,
                                            position = targetPos,
                                        )
                                        restClient.updateRole(
                                            instanceUrl = instanceUrl,
                                            token = token,
                                            spaceId = space.id,
                                            roleId = below.id,
                                            position = role.position,
                                        )
                                    }.onSuccess {
                                        onSpaceUpdated()
                                    }.onFailure { err ->
                                        feedback = (err.message ?: "Erro ao reordenar cargo.") to false
                                    }
                                    isMutating = false
                                }
                            },
                        ) {
                            Icon(
                                imageVector = Icons.Default.ArrowDownward,
                                contentDescription = "Descer cargo",
                                tint = if (customIdx < customRoles.lastIndex) colors.textPrimary else colors.textTertiary,
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }

    if (showCreateDialog) {
        AlertDialog(
            onDismissRequest = { if (!isMutating) showCreateDialog = false },
            containerColor = colors.bgElevated,
            titleContentColor = colors.textPrimary,
            textContentColor = colors.textSecondary,
            title = { Text("Novo Cargo") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = newRoleName,
                        onValueChange = { newRoleName = it },
                        label = { Text("Nome do cargo") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SpaceRoleColorPresets.forEach { preset ->
                            val c = parseSpaceHexColorOrNull(preset) ?: colors.accentPrimary
                            val selected = newRoleColor.equals(preset, ignoreCase = true)
                            Box(
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(CircleShape)
                                    .background(c)
                                    .border(
                                        width = if (selected) 3.dp else 1.dp,
                                        color = if (selected) colors.textPrimary else colors.borderSoft,
                                        shape = CircleShape,
                                    )
                                    .clickable { newRoleColor = preset },
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !isMutating && newRoleName.isNotBlank(),
                    onClick = {
                        scope.launch {
                            isMutating = true
                            feedback = null
                            runCatching {
                                restClient.createRole(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    spaceId = space.id,
                                    name = newRoleName.trim(),
                                    color = newRoleColor,
                                )
                            }.onSuccess { created ->
                                showCreateDialog = false
                                onSpaceUpdated()
                                editingRole = created
                                feedback = "Cargo \"${created.name}\" criado!" to true
                            }.onFailure { err ->
                                feedback = (err.message ?: "Erro ao criar cargo.") to false
                            }
                            isMutating = false
                        }
                    },
                ) {
                    Text("Criar", color = colors.accentPrimary)
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isMutating,
                    onClick = { showCreateDialog = false },
                ) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ============================================================================
// 5. ÁUDIO (OPUS)
// ============================================================================

@Composable
internal fun SpaceAudioOpusSubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
    onSpaceUpdated: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var defaultBitrate by remember(space.id, space.audioBitrateKbps) {
        mutableFloatStateOf((space.audioBitrateKbps ?: 64).coerceIn(16, 512).toFloat())
    }
    var maxBitrate by remember(space.id, space.maxAudioBitrateKbps) {
        mutableFloatStateOf((space.maxAudioBitrateKbps ?: 256).coerceIn(32, 512).toFloat())
    }
    var allowMusicMode by remember(space.id, space.allowMusicMode) {
        mutableStateOf(space.allowMusicMode ?: true)
    }
    var allowStereoAudio by remember(space.id, space.allowStereoAudio) {
        mutableStateOf(space.allowStereoAudio ?: true)
    }
    var isSaving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        AetherSurfaceCard {
            Text(
                text = "Política de Áudio Opus do Espaço",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Text(
                text = "Define os padrões e limites aplicados aos canais de voz deste Espaço.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(modifier = Modifier.height(14.dp))

            Text(
                text = "Bitrate padrão: ${defaultBitrate.roundToInt()} kbps",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = defaultBitrate,
                onValueChange = { value ->
                    val stepped = (value / 8f).roundToInt() * 8f
                    defaultBitrate = stepped.coerceIn(16f, 512f)
                    if (defaultBitrate > maxBitrate) {
                        maxBitrate = defaultBitrate.coerceAtLeast(32f)
                    }
                },
                valueRange = 16f..512f,
            )

            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text = "Bitrate máximo permitido: ${maxBitrate.roundToInt()} kbps",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textPrimary,
            )
            AetherPurpleSlider(
                value = maxBitrate,
                onValueChange = { value ->
                    val stepped = (value / 8f).roundToInt() * 8f
                    maxBitrate = stepped.coerceIn(32f, 512f)
                    if (defaultBitrate > maxBitrate) {
                        defaultBitrate = maxBitrate
                    }
                },
                valueRange = 32f..512f,
            )

            Spacer(modifier = Modifier.height(10.dp))
            HorizontalDivider(color = colors.borderSoft)
            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Permitir Modo Música",
                        style = MaterialTheme.typography.bodyLarge,
                        color = colors.textPrimary,
                    )
                    Text(
                        text = "Permite que membros ativem perfil de áudio musical de alta fidelidade.",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                }
                Switch(
                    checked = allowMusicMode,
                    onCheckedChange = { allowMusicMode = it },
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Permitir Áudio Estéreo",
                        style = MaterialTheme.typography.bodyLarge,
                        color = colors.textPrimary,
                    )
                    Text(
                        text = "Habilita transmissão em 2 canais (estéreo) nos canais de voz.",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                }
                Switch(
                    checked = allowStereoAudio,
                    onCheckedChange = { allowStereoAudio = it },
                )
            }

            Spacer(modifier = Modifier.height(14.dp))
            AetherPrimaryButton(
                text = if (isSaving) "Salvando..." else "Salvar áudio Opus",
                enabled = !isSaving,
                onClick = {
                    scope.launch {
                        isSaving = true
                        feedback = null
                        runCatching {
                            restClient.updateSpaceFull(
                                instanceUrl = instanceUrl,
                                token = token,
                                spaceId = space.id,
                                defaultAudioBitrateKbps = defaultBitrate.roundToInt(),
                                maxAudioBitrateKbps = maxBitrate.roundToInt(),
                                allowMusicMode = allowMusicMode,
                                allowStereoAudio = allowStereoAudio,
                            )
                        }.onSuccess {
                            onSpaceUpdated()
                            feedback = "Configurações de áudio Opus salvas!" to true
                        }.onFailure { err ->
                            feedback = (err.message ?: "Erro ao salvar configurações de áudio.") to false
                        }
                        isSaving = false
                    }
                },
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

// ============================================================================
// 6. SOUNDBOARD
// ============================================================================

@Composable
internal fun SpaceSoundboardSubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var enabled by remember { mutableStateOf(true) }
    var allowInstanceSounds by remember { mutableStateOf(true) }
    var maxConcurrent by remember { mutableFloatStateOf(3f) }
    var isLoading by remember { mutableStateOf(true) }
    var isSaving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    LaunchedEffect(space.id) {
        isLoading = true
        runCatching {
            restClient.getSoundboard(instanceUrl, token, space.id)
        }.onSuccess { resp ->
            val settings = resp.spaceSettings
            if (settings != null) {
                enabled = settings.soundboardEnabled
                allowInstanceSounds = settings.allowInstanceSounds
                maxConcurrent = (settings.maxConcurrentSounds ?: resp.maxConcurrentSounds)
                    .coerceIn(1, 10)
                    .toFloat()
            } else {
                enabled = resp.soundboardEnabled
                maxConcurrent = resp.maxConcurrentSounds.coerceIn(1, 10).toFloat()
            }
        }.onFailure { err ->
            feedback = (err.message ?: "Erro ao carregar configurações do Soundboard.") to false
        }
        isLoading = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        AetherSurfaceCard {
            Text(
                text = "Soundboard do Espaço",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(12.dp))

            if (isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 20.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        color = colors.accentPrimary,
                        modifier = Modifier.size(24.dp),
                    )
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Habilitar Soundboard",
                            style = MaterialTheme.typography.bodyLarge,
                            color = colors.textPrimary,
                        )
                        Text(
                            text = "Permite reproduzir sons nos canais de voz deste Espaço.",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                    Switch(
                        checked = enabled,
                        onCheckedChange = { enabled = it },
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))
                HorizontalDivider(color = colors.borderSoft)
                Spacer(modifier = Modifier.height(10.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Permitir sons da instância",
                            style = MaterialTheme.typography.bodyLarge,
                            color = colors.textPrimary,
                        )
                        Text(
                            text = "Disponibiliza a biblioteca global de sons além dos sons do Espaço.",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                    Switch(
                        checked = allowInstanceSounds,
                        enabled = enabled,
                        onCheckedChange = { allowInstanceSounds = it },
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Sons simultâneos máximos: ${maxConcurrent.roundToInt()}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
                AetherPurpleSlider(
                    value = maxConcurrent,
                    onValueChange = { maxConcurrent = it.roundToInt().coerceIn(1, 10).toFloat() },
                    valueRange = 1f..10f,
                    enabled = enabled,
                )

                Spacer(modifier = Modifier.height(14.dp))
                AetherPrimaryButton(
                    text = if (isSaving) "Salvando..." else "Salvar Soundboard",
                    enabled = !isSaving,
                    onClick = {
                        scope.launch {
                            isSaving = true
                            feedback = null
                            runCatching {
                                restClient.updateSoundboardSpaceSettings(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    spaceId = space.id,
                                    enabled = enabled,
                                    allowInstanceSounds = allowInstanceSounds,
                                    maxConcurrent = maxConcurrent.roundToInt(),
                                )
                            }.onSuccess { updated ->
                                enabled = updated.soundboardEnabled
                                allowInstanceSounds = updated.allowInstanceSounds
                                updated.maxConcurrentSounds?.let {
                                    maxConcurrent = it.coerceIn(1, 10).toFloat()
                                }
                                feedback = "Configurações do Soundboard salvas!" to true
                            }.onFailure { err ->
                                feedback = (err.message ?: "Erro ao salvar Soundboard.") to false
                            }
                            isSaving = false
                        }
                    },
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

// ============================================================================
// 7. BANIMENTOS
// ============================================================================

@Composable
internal fun SpaceBansSubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
) {
    val colors = LocalAetherColors.current
    val scope = rememberCoroutineScope()

    var bans by remember(space.id) { mutableStateOf<List<SpaceBanItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var pendingUnban by remember { mutableStateOf<SpaceBanItem?>(null) }
    var isUnbanning by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    fun loadBans() {
        scope.launch {
            isLoading = true
            runCatching {
                restClient.getBans(instanceUrl, token, space.id)
            }.onSuccess { list ->
                bans = list
            }.onFailure { err ->
                feedback = (err.message ?: "Erro ao carregar banimentos.") to false
            }
            isLoading = false
        }
    }

    LaunchedEffect(space.id) {
        loadBans()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        AetherSurfaceCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Membros Banidos (${bans.size})",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = { loadBans() },
                    enabled = !isLoading,
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Atualizar",
                        tint = colors.textSecondary,
                    )
                }
            }
            Spacer(modifier = Modifier.height(8.dp))

            if (isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 20.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        color = colors.accentPrimary,
                        modifier = Modifier.size(24.dp),
                    )
                }
            } else if (bans.isEmpty()) {
                Text(
                    text = "Nenhum membro banido neste Espaço.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                bans.forEachIndexed { index, ban ->
                    if (index > 0) {
                        HorizontalDivider(
                            color = colors.borderSoft,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AetherAvatar(
                            imageUrl = ban.user?.avatarUrl(instanceUrl),
                            fallbackLabel = ban.label,
                            size = 40.dp,
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = ban.label,
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                                color = colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = ban.reason?.takeIf { it.isNotBlank() } ?: "Sem motivo informado",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        OutlinedButton(
                            onClick = { pendingUnban = ban },
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, colors.accentMint.copy(alpha = 0.6f)),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentMint),
                        ) {
                            Text("Desbanir")
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }

    pendingUnban?.let { ban ->
        AlertDialog(
            onDismissRequest = { if (!isUnbanning) pendingUnban = null },
            containerColor = colors.bgElevated,
            titleContentColor = colors.textPrimary,
            textContentColor = colors.textSecondary,
            title = { Text("Desbanir ${ban.label}?") },
            text = { Text("O usuário poderá entrar novamente no Espaço mediante convite ou descoberta.") },
            confirmButton = {
                TextButton(
                    enabled = !isUnbanning,
                    onClick = {
                        scope.launch {
                            isUnbanning = true
                            feedback = null
                            runCatching {
                                restClient.unbanMember(instanceUrl, token, space.id, ban.userId)
                            }.onSuccess {
                                bans = bans.filterNot { it.userId == ban.userId }
                                pendingUnban = null
                                feedback = "${ban.label} foi desbanido." to true
                            }.onFailure { err ->
                                pendingUnban = null
                                feedback = (err.message ?: "Erro ao desbanir membro.") to false
                            }
                            isUnbanning = false
                        }
                    },
                ) {
                    Text(
                        text = if (isUnbanning) "Desbanindo..." else "Desbanir",
                        color = colors.accentMint,
                    )
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isUnbanning,
                    onClick = { pendingUnban = null },
                ) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

// ============================================================================
// 8. CONVITES
// ============================================================================

@Composable
internal fun SpaceInvitesSubScreen(
    instanceUrl: String,
    token: String,
    space: Space,
    restClient: BackspaceRestClient,
) {
    val colors = LocalAetherColors.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()

    var inviteCode by remember(space.id, space.inviteCode) { mutableStateOf(space.inviteCode.orEmpty()) }
    var isGenerating by remember { mutableStateOf(false) }

    var friends by remember { mutableStateOf<List<FriendItem>>(emptyList()) }
    var isLoadingFriends by remember { mutableStateOf(true) }
    var friendSearch by remember { mutableStateOf("") }
    var sendingToUserId by remember { mutableStateOf<String?>(null) }
    var sentUserIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var feedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    LaunchedEffect(space.id) {
        isLoadingFriends = true
        runCatching {
            restClient.getFriends(instanceUrl, token)
        }.onSuccess { list ->
            friends = list
        }.onFailure { err ->
            feedback = (err.message ?: "Erro ao carregar lista de amigos.") to false
        }
        isLoadingFriends = false
    }

    val filteredFriends = remember(friends, friendSearch) {
        val q = friendSearch.trim().lowercase()
        friends.filter { friend ->
            q.isEmpty() ||
                friend.label.lowercase().contains(q) ||
                friend.user?.username?.lowercase()?.contains(q) == true
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SpaceFeedbackBanner(feedback)

        AetherSurfaceCard {
            Text(
                text = "Código de Convite",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp),
                color = colors.bgInput,
                border = BorderStroke(1.dp, colors.borderSoft),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = inviteCode.ifBlank { "Nenhum código gerado ainda" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (inviteCode.isNotBlank()) colors.accentSky else colors.textTertiary,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (inviteCode.isNotBlank()) {
                        IconButton(
                            onClick = {
                                val fullLink = "${instanceUrl.trimEnd('/')}/invite/$inviteCode"
                                clipboard.setText(AnnotatedString(fullLink))
                                feedback = "Link de convite copiado!" to true
                            },
                        ) {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = "Copiar convite",
                                tint = colors.accentPrimary,
                            )
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            AetherPrimaryButton(
                text = if (isGenerating) "Gerando..." else if (inviteCode.isBlank()) "Gerar código de convite" else "Gerar novo código",
                enabled = !isGenerating,
                onClick = {
                    scope.launch {
                        isGenerating = true
                        feedback = null
                        runCatching {
                            restClient.generateSpaceInvite(instanceUrl, token, space.id)
                        }.onSuccess { code ->
                            inviteCode = code
                            val fullLink = "${instanceUrl.trimEnd('/')}/invite/$code"
                            clipboard.setText(AnnotatedString(fullLink))
                            feedback = "Código gerado e copiado para a área de transferência!" to true
                        }.onFailure { err ->
                            feedback = (err.message ?: "Erro ao gerar convite.") to false
                        }
                        isGenerating = false
                    }
                },
            )
        }

        AetherSurfaceCard {
            Text(
                text = "Enviar convite direto para amigos",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = friendSearch,
                onValueChange = { friendSearch = it },
                placeholder = { Text("Buscar amigo...") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = null,
                        tint = colors.textTertiary,
                    )
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(10.dp))

            if (isLoadingFriends) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 20.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        color = colors.accentPrimary,
                        modifier = Modifier.size(24.dp),
                    )
                }
            } else if (filteredFriends.isEmpty()) {
                Text(
                    text = "Nenhum amigo encontrado.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            } else {
                filteredFriends.forEachIndexed { index, friend ->
                    if (index > 0) {
                        HorizontalDivider(
                            color = colors.borderSoft,
                            modifier = Modifier.padding(vertical = 6.dp),
                        )
                    }
                    val targetId = friend.targetUserId
                    val alreadySent = targetId in sentUserIds
                    val isSendingThis = sendingToUserId == targetId

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AetherAvatar(
                            imageUrl = friend.user?.avatarUrl(instanceUrl),
                            fallbackLabel = friend.label,
                            size = 38.dp,
                            status = friend.user?.status,
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = friend.label,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                color = colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            friend.user?.username?.let { uname ->
                                Text(
                                    text = "@$uname",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = colors.textSecondary,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        OutlinedButton(
                            enabled = !alreadySent && !isSendingThis && sendingToUserId == null,
                            onClick = {
                                scope.launch {
                                    sendingToUserId = targetId
                                    feedback = null
                                    runCatching {
                                        val activeCode = inviteCode.ifBlank {
                                            val generated = restClient.generateSpaceInvite(
                                                instanceUrl = instanceUrl,
                                                token = token,
                                                spaceId = space.id,
                                            )
                                            inviteCode = generated
                                            generated
                                        }
                                        restClient.sendSpaceInviteDm(
                                            instanceUrl = instanceUrl,
                                            token = token,
                                            targetUserId = targetId,
                                            spaceId = space.id,
                                            inviteCode = activeCode,
                                        )
                                    }.onSuccess {
                                        sentUserIds = sentUserIds + targetId
                                        feedback = "Convite enviado para ${friend.label}!" to true
                                    }.onFailure { err ->
                                        feedback = (err.message ?: "Erro ao enviar convite.") to false
                                    }
                                    sendingToUserId = null
                                }
                            },
                            shape = RoundedCornerShape(10.dp),
                        ) {
                            Text(
                                text = when {
                                    isSendingThis -> "Enviando..."
                                    alreadySent -> "Enviado"
                                    else -> "Enviar convite"
                                },
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}
