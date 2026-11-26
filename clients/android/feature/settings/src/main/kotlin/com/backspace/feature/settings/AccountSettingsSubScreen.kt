package com.backspace.feature.settings

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherPrimaryButton
import com.backspace.core.designsystem.AetherStatusDot
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.User
import com.backspace.core.network.BackspaceRestClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val AvatarColorPalette = listOf(
    "mint" to Color(0xFF86EFAC),
    "sky" to Color(0xFF7DD3FC),
    "lavender" to Color(0xFF7C6CF6),
    "coral" to Color(0xFFFCA5A5),
    "rose" to Color(0xFFF9A8D4),
    "teal" to Color(0xFF5EEAD4),
    "amber" to Color(0xFFFCD34D),
)

private val AccentColorPresets = listOf(
    "#7C6CF6",
    "#7DD3FC",
    "#86EFAC",
    "#FCD34D",
    "#FCA5A5",
    "#F472B6",
    "#2DD4BF",
    "#38BDF8",
)

private val UsernameRegex = Regex("^[a-z0-9_]{3,32}$")

private fun parseHexColorOrNull(hex: String?): Color? {
    val cleaned = hex?.trim().orEmpty()
    if (cleaned.isEmpty()) return null
    val normalized = if (cleaned.startsWith("#")) cleaned else "#$cleaned"
    if (normalized.length != 7 && normalized.length != 9) return null
    return runCatching { Color(android.graphics.Color.parseColor(normalized)) }.getOrNull()
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AccountSettingsSubScreen(
    instanceUrl: String,
    token: String,
    currentUser: User?,
    restClient: BackspaceRestClient,
    onTokenUpdated: (String) -> Unit,
    onProfileSaved: (User) -> Unit,
    onLogout: () -> Unit,
) {
    val colors = LocalAetherColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val username = currentUser?.username.orEmpty()
    val isFederatedManaged = currentUser?.homeInstance != null && currentUser.federationHomeOrphaned == false
    var usernameInput by remember(currentUser?.username) { mutableStateOf(currentUser?.username.orEmpty()) }
    var displayName by remember(currentUser?.displayName) { mutableStateOf(currentUser?.displayName.orEmpty()) }
    var customStatus by remember(currentUser?.customStatus) { mutableStateOf(currentUser?.customStatus.orEmpty()) }
    var bio by remember(currentUser?.bio) { mutableStateOf(currentUser?.bio.orEmpty().take(190)) }
    var presenceStatus by remember(currentUser?.status) { mutableStateOf(currentUser?.status ?: "online") }
    var selectedAvatarColor by remember(currentUser?.avatarColor) { mutableStateOf(currentUser?.avatarColor.orEmpty()) }
    var accentColorHex by remember(currentUser?.accentColor) { mutableStateOf(currentUser?.accentColor.orEmpty()) }
    var avatarUrlOverride by remember(currentUser?.avatar) { mutableStateOf(currentUser?.avatarUrl(instanceUrl)) }
    var bannerUrlOverride by remember(currentUser?.banner) { mutableStateOf(currentUser?.bannerUrl(instanceUrl)) }

    var isSavingProfile by remember { mutableStateOf(false) }
    var isUploadingMedia by remember { mutableStateOf(false) }
    var profileFeedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    // Alterar senha
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var showCurrentPwd by remember { mutableStateOf(false) }
    var showNewPwd by remember { mutableStateOf(false) }
    var showConfirmPwd by remember { mutableStateOf(false) }
    var isChangingPwd by remember { mutableStateOf(false) }
    var pwdFeedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    // Reconexão federada
    var reattachToken by remember { mutableStateOf("") }
    var isReattaching by remember { mutableStateOf(false) }
    var reattachFeedback by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    // Excluir conta
    var showDeleteDialog by remember { mutableStateOf(false) }
    var deleteUsernameInput by remember { mutableStateOf("") }
    var deletePasswordInput by remember { mutableStateOf("") }
    var showDeletePwd by remember { mutableStateOf(false) }
    var isDeletingAccount by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }

    suspend fun readUriBytes(uri: Uri, fallbackName: String): Triple<String, String, ByteArray> =
        withContext(Dispatchers.IO) {
            val resolver = context.contentResolver
            var name = fallbackName
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) name = c.getString(idx) ?: name
                }
            }
            val type = resolver.getType(uri) ?: "image/png"
            val data = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("Não foi possível ler a imagem selecionada.")
            Triple(name, type, data)
        }

    val avatarPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            isUploadingMedia = true
            profileFeedback = null
            runCatching {
                val (fileName, mimeType, bytes) = readUriBytes(uri, "avatar.png")
                val uploaded = restClient.uploadFileTus(instanceUrl, token, fileName, mimeType, bytes)
                restClient.updateProfile(
                    instanceUrl = instanceUrl,
                    token = token,
                    avatar = uploaded.filename,
                )
            }.onSuccess { updated ->
                avatarUrlOverride = updated.avatarUrl(instanceUrl)
                onProfileSaved(updated)
                profileFeedback = "Foto de perfil atualizada!" to true
            }.onFailure { err ->
                profileFeedback = (err.message ?: "Erro ao atualizar foto") to false
            }
            isUploadingMedia = false
        }
    }

    val bannerPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            isUploadingMedia = true
            profileFeedback = null
            runCatching {
                val (fileName, mimeType, bytes) = readUriBytes(uri, "banner.png")
                val uploaded = restClient.uploadFileTus(instanceUrl, token, fileName, mimeType, bytes)
                restClient.updateProfile(
                    instanceUrl = instanceUrl,
                    token = token,
                    banner = uploaded.filename,
                )
            }.onSuccess { updated ->
                bannerUrlOverride = updated.bannerUrl(instanceUrl)
                onProfileSaved(updated)
                profileFeedback = "Banner atualizado!" to true
            }.onFailure { err ->
                profileFeedback = (err.message ?: "Erro ao atualizar banner") to false
            }
            isUploadingMedia = false
        }
    }

    val previewAccentColor = parseHexColorOrNull(accentColorHex) ?: colors.accentPrimary
    val previewAvatarRingColor = AvatarColorPalette
        .firstOrNull { it.first.equals(selectedAvatarColor, ignoreCase = true) }
        ?.second ?: colors.accentPrimary

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // ── Cartão de Pré-visualização ao Vivo do Perfil ──
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            color = colors.bgChannel,
            border = BorderStroke(1.dp, colors.glassBorder),
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(104.dp),
                ) {
                    if (!bannerUrlOverride.isNullOrBlank()) {
                        AsyncImage(
                            model = bannerUrlOverride,
                            contentDescription = "Banner do perfil",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(previewAccentColor.copy(alpha = 0.45f)),
                        )
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .border(2.dp, previewAvatarRingColor, CircleShape)
                                .padding(2.dp),
                        ) {
                            AetherAvatar(
                                imageUrl = avatarUrlOverride,
                                fallbackLabel = displayName.ifBlank { username.ifBlank { "?" } },
                                size = 60.dp,
                                status = presenceStatus,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = displayName.ifBlank { username.ifBlank { "Usuário" } },
                                style = MaterialTheme.typography.titleMedium,
                                color = colors.textPrimary,
                            )
                            if (username.isNotBlank()) {
                                Text(
                                    text = "@$username",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                            }
                            if (customStatus.isNotBlank()) {
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = customStatus,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = previewAccentColor,
                                )
                            }
                        }
                    }

                    if (bio.isNotBlank()) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = bio,
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                }
            }
        }

        // ── Avatar & Cor do Avatar ──
        AetherSurfaceCard {
            Text(
                text = "Avatar",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { avatarPicker.launch("image/*") },
                    enabled = !isUploadingMedia,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Alterar foto", color = colors.accentSky)
                }
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            isUploadingMedia = true
                            profileFeedback = null
                            runCatching {
                                restClient.updateProfile(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    avatar = "",
                                )
                            }.onSuccess { updated ->
                                avatarUrlOverride = null
                                onProfileSaved(updated)
                                profileFeedback = "Foto removida." to true
                            }.onFailure { err ->
                                profileFeedback = (err.message ?: "Erro ao remover foto") to false
                            }
                            isUploadingMedia = false
                        }
                    },
                    enabled = !isUploadingMedia && !avatarUrlOverride.isNullOrBlank(),
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Remover foto", color = colors.accentPeach)
                }
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = "Cor do avatar",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AvatarColorPalette.forEach { (key, swatch) ->
                    val isSelected = selectedAvatarColor.equals(key, ignoreCase = true)
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(swatch)
                            .border(
                                width = if (isSelected) 3.dp else 1.dp,
                                color = if (isSelected) colors.textPrimary else colors.glassBorder,
                                shape = CircleShape,
                            )
                            .clickable { selectedAvatarColor = key },
                    )
                }
            }
        }

        // ── Banner & Cor de Destaque ──
        AetherSurfaceCard {
            Text(
                text = "Banner e Cor de Destaque",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { bannerPicker.launch("image/*") },
                    enabled = !isUploadingMedia,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Alterar banner", color = colors.accentSky)
                }
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            isUploadingMedia = true
                            profileFeedback = null
                            runCatching {
                                restClient.updateProfile(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    banner = "",
                                )
                            }.onSuccess { updated ->
                                bannerUrlOverride = null
                                onProfileSaved(updated)
                                profileFeedback = "Banner removido." to true
                            }.onFailure { err ->
                                profileFeedback = (err.message ?: "Erro ao remover banner") to false
                            }
                            isUploadingMedia = false
                        }
                    },
                    enabled = !isUploadingMedia && !bannerUrlOverride.isNullOrBlank(),
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Remover banner", color = colors.accentPeach)
                }
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = "Cor de destaque (accentColor)",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AccentColorPresets.forEach { hex ->
                    val swatch = parseHexColorOrNull(hex) ?: colors.accentPrimary
                    val isSelected = accentColorHex.equals(hex, ignoreCase = true)
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(CircleShape)
                            .background(swatch)
                            .border(
                                width = if (isSelected) 3.dp else 1.dp,
                                color = if (isSelected) colors.textPrimary else colors.glassBorder,
                                shape = CircleShape,
                            )
                            .clickable { accentColorHex = hex },
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = accentColorHex,
                    onValueChange = { if (it.length <= 9) accentColorHex = it },
                    label = { Text("Cor hex (ex: #7C6CF6)") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = { accentColorHex = "" },
                    enabled = accentColorHex.isNotBlank(),
                ) {
                    Text("Limpar", color = colors.accentPeach)
                }
            }
        }

        // ── Dados do Perfil & Status de Presença ──
        AetherSurfaceCard {
            Text(
                text = "Informações do Perfil",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                label = { Text("Nome de exibição") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            val normalizedUsername = usernameInput.trim().lowercase()
            val usernameError = if (isFederatedManaged || normalizedUsername == username) {
                null
            } else if (normalizedUsername.length !in 3..32) {
                "O nome de usuário deve ter entre 3 e 32 caracteres."
            } else if (!UsernameRegex.matches(normalizedUsername)) {
                "Use apenas letras minúsculas (a-z), números (0-9) e sublinhado (_)."
            } else {
                null
            }
            OutlinedTextField(
                value = usernameInput,
                onValueChange = { if (it.length <= 32) usernameInput = it },
                label = { Text("Nome de usuário (@username)") },
                prefix = { Text("@") },
                enabled = !isFederatedManaged && !isSavingProfile,
                isError = usernameError != null,
                singleLine = true,
                supportingText = {
                    when {
                        isFederatedManaged -> Text(
                            text = "Gerenciado pela instância de origem",
                            color = colors.textSecondary,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        usernameError != null -> Text(
                            text = usernameError,
                            color = colors.accentPeach,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        else -> Text(
                            text = "3 a 32 caracteres: a-z, 0-9 e _",
                            color = colors.textSecondary,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = customStatus,
                onValueChange = { customStatus = it },
                label = { Text("Status personalizado") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = bio,
                onValueChange = { if (it.length <= 190) bio = it },
                label = { Text("Biografia") },
                modifier = Modifier.fillMaxWidth(),
                maxLines = 4,
                supportingText = {
                    Text(
                        text = "${bio.length}/190",
                        color = colors.textSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                },
            )

            Spacer(Modifier.height(10.dp))
            Text(
                text = "Status de presença",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(6.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(
                    "online" to "Online",
                    "idle" to "Ausente",
                    "dnd" to "Ocupado",
                ).forEach { (statusValue, label) ->
                    FilterChip(
                        selected = presenceStatus == statusValue,
                        onClick = { presenceStatus = statusValue },
                        leadingIcon = {
                            AetherStatusDot(status = statusValue, size = 8.dp)
                        },
                        label = { Text(label) },
                    )
                }
            }

            if (profileFeedback != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = profileFeedback!!.first,
                    color = if (profileFeedback!!.second) colors.accentMint else colors.accentPeach,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Spacer(Modifier.height(12.dp))
            AetherPrimaryButton(
                text = if (isSavingProfile) "Salvando..." else "Salvar Perfil",
                enabled = !isSavingProfile && !isUploadingMedia,
                onClick = {
                    scope.launch {
                        isSavingProfile = true
                        profileFeedback = null
                        val trimmedAccent = accentColorHex.trim()
                        if (trimmedAccent.isNotEmpty() && parseHexColorOrNull(trimmedAccent) == null) {
                            profileFeedback = "Cor hex inválida. Use o formato #RRGGBB." to false
                            isSavingProfile = false
                            return@launch
                        }
                        val normalizedUsernameToSave = usernameInput.trim().lowercase()
                        val usernameChanged = !isFederatedManaged && normalizedUsernameToSave != username
                        if (usernameChanged) {
                            if (normalizedUsernameToSave.length !in 3..32 || !UsernameRegex.matches(normalizedUsernameToSave)) {
                                profileFeedback = "Nome de usuário inválido. Use 3 a 32 caracteres (a-z, 0-9 e _)." to false
                                isSavingProfile = false
                                return@launch
                            }
                        }
                        runCatching {
                            restClient.updateProfile(
                                instanceUrl = instanceUrl,
                                token = token,
                                displayName = displayName.trim(),
                                bio = bio.trim(),
                                status = presenceStatus,
                                customStatus = customStatus.trim(),
                                avatarColor = selectedAvatarColor.ifBlank { null },
                                accentColor = trimmedAccent,
                                username = if (usernameChanged) normalizedUsernameToSave else null,
                            )
                        }.onSuccess { updated ->
                            usernameInput = updated.username
                            onProfileSaved(updated)
                            profileFeedback = "Perfil salvo com sucesso!" to true
                        }.onFailure { err ->
                            profileFeedback = (err.message ?: "Erro ao salvar perfil") to false
                        }
                        isSavingProfile = false
                    }
                },
            )
        }

        // ── Alterar Senha ──
        AetherSurfaceCard {
            Text(
                text = "Alterar Senha",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = currentPassword,
                onValueChange = { currentPassword = it },
                label = { Text("Senha atual") },
                singleLine = true,
                visualTransformation = if (showCurrentPwd) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { showCurrentPwd = !showCurrentPwd }) {
                        Icon(
                            imageVector = if (showCurrentPwd) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = if (showCurrentPwd) "Ocultar senha" else "Mostrar senha",
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = newPassword,
                onValueChange = { newPassword = it },
                label = { Text("Nova senha (mín. 8 caracteres)") },
                singleLine = true,
                visualTransformation = if (showNewPwd) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { showNewPwd = !showNewPwd }) {
                        Icon(
                            imageVector = if (showNewPwd) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = if (showNewPwd) "Ocultar senha" else "Mostrar senha",
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = { Text("Confirmar nova senha") },
                singleLine = true,
                visualTransformation = if (showConfirmPwd) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { showConfirmPwd = !showConfirmPwd }) {
                        Icon(
                            imageVector = if (showConfirmPwd) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = if (showConfirmPwd) "Ocultar senha" else "Mostrar senha",
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )

            if (pwdFeedback != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = pwdFeedback!!.first,
                    color = if (pwdFeedback!!.second) colors.accentMint else colors.accentPeach,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Spacer(Modifier.height(12.dp))
            AetherPrimaryButton(
                text = if (isChangingPwd) "Alterando..." else "Alterar Senha",
                enabled = !isChangingPwd,
                onClick = {
                    when {
                        currentPassword.isBlank() -> {
                            pwdFeedback = "Informe sua senha atual." to false
                        }
                        newPassword.length < 8 -> {
                            pwdFeedback = "A nova senha deve ter pelo menos 8 caracteres." to false
                        }
                        newPassword != confirmPassword -> {
                            pwdFeedback = "A confirmação da nova senha não confere." to false
                        }
                        else -> {
                            scope.launch {
                                isChangingPwd = true
                                pwdFeedback = null
                                runCatching {
                                    restClient.changePassword(
                                        instanceUrl = instanceUrl,
                                        token = token,
                                        currentPassword = currentPassword,
                                        newPassword = newPassword,
                                    )
                                }.onSuccess { resp ->
                                    if (resp.token.isNotBlank()) {
                                        onTokenUpdated(resp.token)
                                    }
                                    currentPassword = ""
                                    newPassword = ""
                                    confirmPassword = ""
                                    pwdFeedback = "Senha alterada com sucesso!" to true
                                }.onFailure { err ->
                                    pwdFeedback = (err.message ?: "Erro ao alterar senha") to false
                                }
                                isChangingPwd = false
                            }
                        }
                    }
                },
            )
        }

        // ── Reconexão de Conta Federada Órfã ──
        if (currentUser?.federationHomeOrphaned == true) {
            AetherSurfaceCard {
                Text(
                    text = "Conta Federada Desconectada",
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.accentAmber,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Sua instância de origem (${currentUser.detachedHomeInstance ?: "desconhecida"}) foi redefinida ou desconectada. Informe o token de reconexão para vincular sua conta novamente.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = reattachToken,
                    onValueChange = { reattachToken = it },
                    label = { Text("Token de reconexão") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (reattachFeedback != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = reattachFeedback!!.first,
                        color = if (reattachFeedback!!.second) colors.accentMint else colors.accentPeach,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Spacer(Modifier.height(10.dp))
                AetherPrimaryButton(
                    text = if (isReattaching) "Reconectando..." else "Reconectar Conta",
                    enabled = !isReattaching && reattachToken.isNotBlank(),
                    onClick = {
                        scope.launch {
                            isReattaching = true
                            reattachFeedback = null
                            runCatching {
                                restClient.reattachAccount(
                                    instanceUrl = instanceUrl,
                                    token = token,
                                    attachToken = reattachToken.trim(),
                                )
                            }.onSuccess { resp ->
                                resp.user?.let(onProfileSaved)
                                reattachToken = ""
                                reattachFeedback = "Conta reconectada com sucesso!" to true
                            }.onFailure { err ->
                                reattachFeedback = (err.message ?: "Erro ao reconectar conta") to false
                            }
                            isReattaching = false
                        }
                    },
                )
            }
        }

        // ── Zona de Perigo: Excluir Conta ──
        AetherSurfaceCard {
            Text(
                text = "Zona de Perigo",
                style = MaterialTheme.typography.titleMedium,
                color = colors.accentPeach,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Excluir sua conta é uma ação permanente e não pode ser desfeita.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    deleteUsernameInput = ""
                    deletePasswordInput = ""
                    deleteError = null
                    showDeleteDialog = true
                },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.accentPeach,
                    contentColor = colors.bgBase,
                ),
            ) {
                Text("Excluir Conta")
            }
        }

        Spacer(Modifier.height(16.dp))
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { if (!isDeletingAccount) showDeleteDialog = false },
            containerColor = colors.bgChannel,
            title = {
                Text(
                    text = "Excluir Conta Permanentemente",
                    color = colors.accentPeach,
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Digite seu nome de usuário (@$username) e sua senha atual para confirmar a exclusão.",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                    OutlinedTextField(
                        value = deleteUsernameInput,
                        onValueChange = { deleteUsernameInput = it },
                        label = { Text("Confirme @$username") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = deletePasswordInput,
                        onValueChange = { deletePasswordInput = it },
                        label = { Text("Senha atual") },
                        singleLine = true,
                        visualTransformation = if (showDeletePwd) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { showDeletePwd = !showDeletePwd }) {
                                Icon(
                                    imageVector = if (showDeletePwd) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                    contentDescription = if (showDeletePwd) "Ocultar senha" else "Mostrar senha",
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (!deleteError.isNullOrBlank()) {
                        Text(
                            text = deleteError!!,
                            color = colors.accentPeach,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    enabled = !isDeletingAccount,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.accentPeach,
                        contentColor = colors.bgBase,
                    ),
                    onClick = {
                        val cleanedInput = deleteUsernameInput.trim().removePrefix("@")
                        when {
                            username.isBlank() || cleanedInput != username -> {
                                deleteError = "O nome de usuário digitado não confere com @$username."
                            }
                            deletePasswordInput.isBlank() -> {
                                deleteError = "Informe sua senha atual."
                            }
                            else -> {
                                scope.launch {
                                    isDeletingAccount = true
                                    deleteError = null
                                    runCatching {
                                        restClient.deleteAccount(
                                            instanceUrl = instanceUrl,
                                            token = token,
                                            password = deletePasswordInput,
                                            username = username,
                                        )
                                    }.onSuccess {
                                        showDeleteDialog = false
                                        onLogout()
                                    }.onFailure { err ->
                                        deleteError = err.message ?: "Erro ao excluir conta."
                                    }
                                    isDeletingAccount = false
                                }
                            }
                        }
                    },
                ) {
                    Text(if (isDeletingAccount) "Excluindo..." else "Confirmar Exclusão")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDeleteDialog = false },
                    enabled = !isDeletingAccount,
                ) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}
