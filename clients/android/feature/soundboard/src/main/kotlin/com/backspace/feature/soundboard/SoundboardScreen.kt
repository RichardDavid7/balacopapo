package com.backspace.feature.soundboard

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backspace.core.designsystem.AetherPurpleSlider
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.AetherTheme
import com.backspace.core.model.SoundboardListResponse
import com.backspace.core.model.SoundboardSound
import com.backspace.core.network.BackspaceRestClient
import com.backspace.core.voice.BackspaceVoiceEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SoundboardScreen(
    instanceUrl: String,
    jwtToken: String,
    spaceId: String,
    restClient: BackspaceRestClient,
    voiceEngine: BackspaceVoiceEngine,
    title: String,
    searchPlaceholder: String,
    volumeLabel: String,
    emptyText: String,
    onBack: () -> Unit,
) {
    val colors = AetherTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val voiceState by voiceEngine.state.collectAsStateWithLifecycle()

    var data by remember { mutableStateOf<SoundboardListResponse?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var editingSound by remember { mutableStateOf<SoundboardSound?>(null) }
    var soundPendingDelete by remember { mutableStateOf<SoundboardSound?>(null) }
    var pendingUploadUri by remember { mutableStateOf<Uri?>(null) }
    var uploadName by remember { mutableStateOf("") }
    var uploadEmoji by remember { mutableStateOf("🔊") }
    var uploadFolder by remember { mutableStateOf("") }

    fun reload() {
        scope.launch {
            isLoading = true
            errorText = null
            runCatching {
                restClient.getSoundboard(instanceUrl, jwtToken, spaceId)
            }.onSuccess { resp ->
                data = resp
            }.onFailure { err ->
                errorText = err.message
            }
            isLoading = false
        }
    }

    val audioPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri != null) {
            pendingUploadUri = uri
            var guessedName = "Som"
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) guessedName = (c.getString(idx) ?: guessedName).substringBeforeLast('.')
                }
            }
            uploadName = guessedName.take(40)
            uploadEmoji = "🔊"
            uploadFolder = ""
        }
    }

    LaunchedEffect(spaceId) {
        reload()
    }

    val canManage = (data?.canManageScope == true) || (data?.canManageInstance == true)

    // Dialog de Upload de novo som
    pendingUploadUri?.let { uri ->
        AlertDialog(
            onDismissRequest = { pendingUploadUri = null },
            containerColor = colors.bgChannel,
            title = { Text("Adicionar som ao Soundboard", color = colors.textPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = uploadName,
                        onValueChange = { uploadName = it.take(40) },
                        label = { Text("Nome") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = uploadEmoji,
                        onValueChange = { uploadEmoji = it.take(8) },
                        label = { Text("Emoji") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = uploadFolder,
                        onValueChange = { uploadFolder = it.take(32) },
                        label = { Text("Pasta (opcional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val targetUri = uri
                        val cleanName = uploadName.trim().ifBlank { "Som" }
                        val cleanEmoji = uploadEmoji.trim().ifBlank { "🔊" }
                        val cleanFolder = uploadFolder.trim().ifBlank { null }
                        pendingUploadUri = null
                        scope.launch {
                            errorText = null
                            runCatching {
                                val (fileName, mimeType, bytes) = withContext(Dispatchers.IO) {
                                    val resolver = context.contentResolver
                                    var fname = "sound.mp3"
                                    resolver.query(targetUri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                                        if (c.moveToFirst()) {
                                            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                                            if (idx >= 0) fname = c.getString(idx) ?: fname
                                        }
                                    }
                                    val mime = resolver.getType(targetUri) ?: "audio/mpeg"
                                    val dataBytes = resolver.openInputStream(targetUri)?.use { it.readBytes() }
                                        ?: throw IllegalStateException("Não foi possível ler o áudio")
                                    Triple(fname, mime, dataBytes)
                                }
                                restClient.uploadSoundboardSound(
                                    instanceUrl = instanceUrl,
                                    token = jwtToken,
                                    spaceId = spaceId,
                                    name = cleanName,
                                    emoji = cleanEmoji,
                                    folder = cleanFolder,
                                    fileName = fileName,
                                    mimeType = mimeType,
                                    bytes = bytes,
                                )
                            }.onSuccess { reload() }
                                .onFailure { errorText = it.message }
                        }
                    },
                ) {
                    Text("Enviar", color = colors.accentMint)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingUploadUri = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }

    // Dialog de Editar / Excluir som (toque longo)
    editingSound?.let { target ->
        var editName by remember(target.id) { mutableStateOf(target.name) }
        var editEmoji by remember(target.id) { mutableStateOf(target.emoji) }
        var editFolder by remember(target.id) { mutableStateOf(target.folder.orEmpty()) }
        AlertDialog(
            onDismissRequest = { editingSound = null },
            containerColor = colors.bgChannel,
            title = { Text("Gerenciar som", color = colors.textPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = editName,
                        onValueChange = { editName = it.take(40) },
                        label = { Text("Nome") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = editEmoji,
                        onValueChange = { editEmoji = it.take(8) },
                        label = { Text("Emoji") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = editFolder,
                        onValueChange = { editFolder = it.take(32) },
                        label = { Text("Pasta (opcional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TextButton(
                        onClick = {
                            editingSound = null
                            soundPendingDelete = target
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Excluir som", color = colors.accentPeach)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val id = target.id
                        val n = editName.trim().ifBlank { target.name }
                        val e = editEmoji.trim().ifBlank { "🔊" }
                        val f = editFolder.trim().ifBlank { null }
                        editingSound = null
                        scope.launch {
                            runCatching {
                                restClient.updateSoundboardSound(instanceUrl, jwtToken, id, n, e, f)
                            }.onSuccess { reload() }
                                .onFailure { errorText = it.message }
                        }
                    },
                ) {
                    Text("Salvar", color = colors.accentPrimary)
                }
            },
            dismissButton = {
                TextButton(onClick = { editingSound = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }

    soundPendingDelete?.let { targetSound ->
        AlertDialog(
            onDismissRequest = { soundPendingDelete = null },
            containerColor = colors.bgChannel,
            title = { Text("Excluir som?", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Tem certeza que deseja excluir \"${targetSound.name}\" do Soundboard? Esta ação não pode ser desfeita.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val id = targetSound.id
                        soundPendingDelete = null
                        scope.launch {
                            runCatching {
                                restClient.deleteSoundboardSound(instanceUrl, jwtToken, id)
                            }.onSuccess { reload() }
                                .onFailure { errorText = it.message }
                        }
                    },
                ) {
                    Text("Excluir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { soundPendingDelete = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }

    val allSounds = remember(data, query) {
        val combined = buildList {
            data?.scopedSounds?.filterNot { it.hidden }?.let(::addAll)
            if (data?.spaceSettings?.allowInstanceSounds != false) {
                data?.instanceSounds?.filterNot { it.hidden }?.let(::addAll)
            }
        }
        if (query.isBlank()) {
            combined
        } else {
            val q = query.trim().lowercase()
            combined.filter {
                it.name.lowercase().contains(q) || (it.folder?.lowercase()?.contains(q) == true)
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .systemBarsPadding()
            .padding(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = colors.textPrimary,
                    )
                }
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.textPrimary,
                )
            }
            if (canManage) {
                IconButton(onClick = { audioPicker.launch("audio/*") }) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "Adicionar som",
                        tint = colors.accentPrimary,
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        AetherSurfaceCard {
            Text(
                text = "$volumeLabel: ${(voiceState.soundboardVolume * 100).toInt()}%",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            AetherPurpleSlider(
                value = voiceState.soundboardVolume,
                onValueChange = { voiceEngine.setSoundboardVolume(it) },
                valueRange = 0f..1f,
            )
            if (!voiceState.lastSoundboardEvent.isNullOrBlank()) {
                Text(
                    text = voiceState.lastSoundboardEvent!!,
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.accentMint,
                )
            }
        }

        Spacer(Modifier.height(10.dp))

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text(searchPlaceholder) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(12.dp))

        when {
            isLoading -> {
                CircularProgressIndicator(
                    color = colors.accentPrimary,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                )
            }
            !errorText.isNullOrBlank() -> {
                Text(text = errorText!!, color = colors.accentPeach)
            }
            allSounds.isEmpty() -> {
                AetherSurfaceCard {
                    Text(text = emptyText, color = colors.textSecondary)
                }
            }
            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(allSounds, key = { it.id }) { sound ->
                        AetherSurfaceCard(
                            modifier = Modifier.combinedClickable(
                                onClick = { voiceEngine.playSoundboardSound(sound) },
                                onLongClick = {
                                    if (canManage) editingSound = sound
                                },
                            ),
                        ) {
                            Text(
                                text = sound.emoji.ifBlank { "🔊" },
                                style = MaterialTheme.typography.headlineSmall,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = sound.name,
                                style = MaterialTheme.typography.titleSmall,
                                color = colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (!sound.folder.isNullOrBlank()) {
                                Text(
                                    text = sound.folder!!,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = colors.textTertiary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
