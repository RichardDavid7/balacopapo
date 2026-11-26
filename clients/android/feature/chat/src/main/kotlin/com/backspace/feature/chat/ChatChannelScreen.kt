package com.backspace.feature.chat

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.ReceiveContentListener
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.AetherTheme
import com.backspace.core.model.GifItem
import com.backspace.core.model.Message
import com.backspace.core.model.PendingAttachmentPayload
import com.backspace.core.model.PermissionBits
import com.backspace.core.model.Role
import com.backspace.core.model.StickerItem
import com.backspace.core.model.StickerTokenParser
import com.backspace.core.model.User
import com.backspace.core.network.BackspaceRestClient
import com.backspace.core.network.BackspaceWebSocketClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

private val QUICK_EMOJIS = listOf("👍", "❤️", "😂", "😮", "😢", "🔥")
private val PICKER_EMOJIS = listOf(
    "😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "🤩",
    "🤔", "😮", "😢", "😭", "😡", "🤯", "🥳", "😴",
    "👍", "👎", "👏", "🙌", "🤝", "🙏", "💪", "✌️",
    "❤️", "🔥", "⭐", "⚡", "🎉", "💯", "🎮", "🎧",
    "🚀", "👀", "💀", "🤡", "🫡", "🫶", "✅", "❌",
)

private data class ChatProfileTarget(
    val user: User,
    val roles: List<Role> = emptyList(),
    val nickname: String? = null,
)

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun ChatChannelScreen(
    instanceUrl: String,
    jwtToken: String,
    channelId: String,
    channelName: String,
    restClient: BackspaceRestClient,
    wsClient: BackspaceWebSocketClient,
    messagePlaceholder: String,
    emptyChatText: String,
    queuedLabel: String,
    replyingToPrefix: String,
    replyActionLabel: String,
    deleteActionLabel: String,
    isDm: Boolean = false,
    callConfirmTitle: String = "",
    callConfirmAction: String = "Call",
    cancelLabel: String = "Cancel",
    onStartCall: (() -> Unit)? = null,
    onOpenDm: ((dmId: String, dmTitle: String) -> Unit)? = null,
    onBack: () -> Unit,
) {
    val colors = AetherTheme.colors
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val snapshot by wsClient.snapshot.collectAsStateWithLifecycle()
    val allMessages = snapshot.messagesByChannel[channelId].orEmpty()
    val typingUsers = snapshot.typingByChannel[channelId].orEmpty()
    val queuedForChannel = remember(snapshot.queuedMessages, channelId) {
        snapshot.queuedMessages.filter { it.channelId == channelId }
    }
    val myUserId = snapshot.currentUser?.id

    // Mapeia cores dos cargos e membros do Grupo deste canal (para cores + autocomplete @)
    val currentSpace = remember(snapshot.spaces, channelId) {
        snapshot.spaces.firstOrNull { s -> s.channels.any { it.id == channelId } }
    }
    val isSpaceAdmin = currentSpace != null && (
        PermissionBits.hasPermission(currentSpace.myPermissions, PermissionBits.ADMINISTRATOR) ||
            currentSpace.ownerId == myUserId
        )
    val canToggleMessageRetention = !isDm &&
        currentSpace != null &&
        currentSpace.allowFileRetention &&
        (
            isSpaceAdmin ||
                PermissionBits.hasPermission(currentSpace.myPermissions, PermissionBits.MANAGE_MESSAGES)
            )
    val roleColorByUserId = remember(currentSpace) {
        currentSpace?.members.orEmpty().mapNotNull { member ->
            val hex = member.highestRoleColorHex ?: return@mapNotNull null
            val parsed = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull()
                ?: return@mapNotNull null
            member.userId to parsed
        }.toMap()
    }

    val listState = rememberLazyListState()
    val timeFormatter = remember { SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()) }

    var draft by remember { mutableStateOf("") }
    var replyingTo by remember { mutableStateOf<Message?>(null) }
    var editingMessage by remember { mutableStateOf<Message?>(null) }
    var selectedMessageForActions by remember { mutableStateOf<Message?>(null) }
    var messagePendingDelete by remember { mutableStateOf<Message?>(null) }
    var selectedProfileTarget by remember { mutableStateOf<ChatProfileTarget?>(null) }
    var openingProfileDm by remember { mutableStateOf(false) }
    var fullscreenImageUrl by remember { mutableStateOf<String?>(null) }
    var showCallConfirmDialog by remember { mutableStateOf(false) }
    var showMediaPicker by remember { mutableStateOf(false) }
    var showSearchBar by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var lastTypingSentMs by remember { mutableStateOf(0L) }
    var errorText by remember { mutableStateOf<String?>(null) }
    val pendingAttachments = remember { mutableStateListOf<PendingAttachmentPayload>() }

    val messages = remember(allMessages, searchQuery, showSearchBar) {
        if (!showSearchBar || searchQuery.isBlank()) {
            allMessages
        } else {
            val q = searchQuery.trim().lowercase()
            allMessages.filter {
                it.safeContent.lowercase().contains(q) || it.authorLabel.lowercase().contains(q)
            }
        }
    }

    fun attachUris(uris: List<Uri>) {
        if (uris.isEmpty()) return
        scope.launch {
            uris.forEach { uri ->
                runCatching { readUriPayload(context, uri) }
                    .onSuccess { (fileName, mimeType, bytes) ->
                        pendingAttachments.add(
                            PendingAttachmentPayload(
                                id = UUID.randomUUID().toString(),
                                fileName = fileName,
                                mimeType = mimeType,
                                bytes = bytes,
                            ),
                        )
                    }
                    .onFailure { err -> errorText = err.message }
            }
        }
    }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents(),
    ) { uris -> attachUris(uris) }

    // Permite colar imagens/prints direto do teclado Android (Gboard, Samsung Keyboard, etc.)
    val receiveContentListener = remember {
        ReceiveContentListener { transferableContent ->
            if (!transferableContent.hasMediaType(MediaType.Image)) {
                return@ReceiveContentListener transferableContent
            }
            val uris = mutableListOf<Uri>()
            val remaining = transferableContent.consume { item ->
                val uri = item.uri
                if (uri != null) {
                    uris.add(uri)
                    true
                } else {
                    false
                }
            }
            attachUris(uris)
            remaining
        }
    }

    DisposableEffect(channelId) {
        wsClient.setActiveOpenChannel(channelId)
        onDispose { wsClient.setActiveOpenChannel(null) }
    }

    LaunchedEffect(channelId, isDm) {
        runCatching {
            if (isDm) {
                val history = restClient.getDmMessages(instanceUrl, jwtToken, channelId)
                wsClient.mergeChannelHistory(channelId, history.map { it.toChannelMessage() })
            } else {
                val history = restClient.getChannelMessages(instanceUrl, jwtToken, channelId)
                wsClient.mergeChannelHistory(channelId, history)
                wsClient.sendChannelAck(channelId)
            }
        }.onFailure { err ->
            errorText = err.message
        }
    }

    val lastMessageId = messages.lastOrNull()?.id
    val lastQueuedId = queuedForChannel.lastOrNull()?.localId
    var previousLastKey by remember(channelId) { mutableStateOf<String?>(null) }

    LaunchedEffect(channelId, lastMessageId, lastQueuedId) {
        val currentLastKey = lastQueuedId ?: lastMessageId
        val total = messages.size + queuedForChannel.size
        if (total > 0 && currentLastKey != null && currentLastKey != previousLastKey) {
            previousLastKey = currentLastKey
            val hasLoadOlder = !isDm && allMessages.size >= 50 && !showSearchBar
            val targetIndex = (total - 1) + if (hasLoadOlder) 1 else 0
            listState.animateScrollToItem(targetIndex)
        }
    }

    // Visualizador de imagem em tela cheia
    if (fullscreenImageUrl != null) {
        val imgUrl = fullscreenImageUrl!!
        var zoomScale by remember(imgUrl) { mutableStateOf(1f) }
        var zoomOffset by remember(imgUrl) { mutableStateOf(Offset.Zero) }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .statusBarsPadding()
                .navigationBarsPadding()
                .pointerInput(imgUrl) {
                    detectTapGestures(
                        onDoubleTap = {
                            if (zoomScale > 1.1f) {
                                zoomScale = 1f
                                zoomOffset = Offset.Zero
                            } else {
                                zoomScale = 2.5f
                            }
                        },
                    )
                }
                .pointerInput(imgUrl) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        val nextScale = (zoomScale * zoom).coerceIn(1f, 5f)
                        zoomScale = nextScale
                        zoomOffset = if (nextScale > 1f) {
                            Offset(
                                x = (zoomOffset.x + pan.x).coerceIn(-1200f, 1200f),
                                y = (zoomOffset.y + pan.y).coerceIn(-1200f, 1200f),
                            )
                        } else {
                            Offset.Zero
                        }
                    }
                },
        ) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(imgUrl)
                    .addHeader("Authorization", "Bearer $jwtToken")
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer(
                        scaleX = zoomScale,
                        scaleY = zoomScale,
                        translationX = zoomOffset.x,
                        translationY = zoomOffset.y,
                    ),
            )
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                IconButton(
                    onClick = {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(imgUrl))) }
                    },
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.65f)),
                ) {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = "Open", tint = Color.White)
                }
                IconButton(
                    onClick = { fullscreenImageUrl = null },
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.65f)),
                ) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                }
            }
        }
        return
    }

    if (showMediaPicker) {
        MediaPickerDialog(
            instanceUrl = instanceUrl,
            jwtToken = jwtToken,
            restClient = restClient,
            onInsertEmoji = { emoji ->
                draft += emoji
                showMediaPicker = false
            },
            onSendUrl = { mediaUrl ->
                showMediaPicker = false
                wsClient.enqueueOrSendMessage(
                    channelId = channelId,
                    content = mediaUrl,
                    replyToId = replyingTo?.id,
                    isDm = isDm,
                )
                replyingTo = null
            },
            onDismiss = { showMediaPicker = false },
        )
    }

    if (showCallConfirmDialog && onStartCall != null) {
        AlertDialog(
            onDismissRequest = { showCallConfirmDialog = false },
            containerColor = colors.bgChannel,
            title = { Text(callConfirmTitle.ifBlank { channelName }, color = colors.textPrimary) },
            text = { Text(channelName, color = colors.textSecondary) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showCallConfirmDialog = false
                        onStartCall()
                    },
                ) {
                    Text(callConfirmAction, color = colors.accentMint)
                }
            },
            dismissButton = {
                TextButton(onClick = { showCallConfirmDialog = false }) {
                    Text(cancelLabel, color = colors.textSecondary)
                }
            },
        )
    }

    val currentDm = remember(snapshot.dmChannels, channelId, isDm) {
        if (isDm) snapshot.dmChannels.firstOrNull { it.id == channelId } else null
    }

    fun resolveProfileTarget(msg: Message): ChatProfileTarget? {
        val uid = msg.user?.id?.takeIf { it.isNotBlank() }
            ?: msg.userId.takeIf { it.isNotBlank() }
            ?: return null
        val spaceMember = currentSpace?.members?.firstOrNull { it.userId == uid || it.user?.id == uid }
            ?: snapshot.spaces.asSequence()
                .flatMap { it.members.asSequence() }
                .firstOrNull { it.userId == uid || it.user?.id == uid }
        val dmMember = currentDm?.members?.firstOrNull { it.id == uid }
            ?: snapshot.dmChannels.asSequence()
                .flatMap { it.members.asSequence() }
                .firstOrNull { it.id == uid }
        val resolvedUser = spaceMember?.user
            ?: dmMember
            ?: (if (uid == myUserId) snapshot.currentUser else null)
            ?: msg.user
            ?: User(
                id = uid,
                username = msg.authorLabel,
                displayName = msg.authorLabel,
            )
        val memberRoles = if (currentSpace != null && spaceMember != null && currentSpace.members.any { it.userId == spaceMember.userId }) {
            spaceMember.roles.filter { !it.isEveryone }.sortedByDescending { it.position }
        } else {
            emptyList()
        }
        return ChatProfileTarget(
            user = resolvedUser,
            roles = memberRoles,
            nickname = if (currentSpace != null) spaceMember?.nickname else null,
        )
    }

    // Diálogo de Perfil do Usuário (ao tocar no avatar ou nome do autor)
    selectedProfileTarget?.let { target ->
        val profileUser = target.user
        val displayTitle = target.nickname?.takeIf { it.isNotBlank() } ?: profileUser.label
        val bannerUrl = profileUser.bannerUrl(instanceUrl)
        val bannerAccentColor = remember(profileUser.accentColor, colors.accentPrimary) {
            profileUser.accentColor
                ?.takeIf { it.isNotBlank() }
                ?.let { hex -> runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull() }
                ?: colors.accentPrimary.copy(alpha = 0.35f)
        }
        val isCurrentOneToOneDm = isDm &&
            currentDm != null &&
            !currentDm.isGroup &&
            currentDm.members.any { it.id == profileUser.id }
        val canSendDm = onOpenDm != null &&
            profileUser.id.isNotBlank() &&
            profileUser.id != myUserId &&
            !isCurrentOneToOneDm

        AlertDialog(
            onDismissRequest = {
                if (!openingProfileDm) selectedProfileTarget = null
            },
            containerColor = colors.bgChannel,
            title = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(64.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(bannerAccentColor),
                    ) {
                        if (!bannerUrl.isNullOrBlank()) {
                            AsyncImage(
                                model = ImageRequest.Builder(context)
                                    .data(bannerUrl)
                                    .addHeader("Authorization", "Bearer $jwtToken")
                                    .crossfade(true)
                                    .build(),
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        AetherAvatar(
                            imageUrl = profileUser.avatarUrl(instanceUrl),
                            fallbackLabel = displayTitle,
                            size = 56.dp,
                            status = profileUser.status,
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = displayTitle,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = "@${profileUser.username}",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (!profileUser.customStatus.isNullOrBlank()) {
                        Surface(
                            color = colors.bgElevated,
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = profileUser.customStatus!!,
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textPrimary,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            )
                        }
                    }
                    if (!profileUser.bio.isNullOrBlank()) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                text = "SOBRE",
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textTertiary,
                            )
                            Text(
                                text = profileUser.bio!!,
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textSecondary,
                            )
                        }
                    }
                    if (target.roles.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = "CARGOS",
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textTertiary,
                            )
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                target.roles.forEach { role ->
                                    val roleColor = role.color
                                        .takeIf { it.isNotBlank() && it != "#000000" && it != "transparent" }
                                        ?.let { hex -> runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull() }
                                        ?: colors.accentPrimary
                                    Surface(
                                        color = roleColor.copy(alpha = 0.16f),
                                        shape = RoundedCornerShape(999.dp),
                                        border = BorderStroke(1.dp, roleColor.copy(alpha = 0.45f)),
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(5.dp),
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
                    if (profileUser.customStatus.isNullOrBlank() && profileUser.bio.isNullOrBlank() && target.roles.isEmpty()) {
                        Text(
                            text = "Status: ${profileUser.status}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                    }
                }
            },
            confirmButton = {
                if (canSendDm) {
                    TextButton(
                        enabled = !openingProfileDm,
                        onClick = {
                            openingProfileDm = true
                            scope.launch {
                                runCatching {
                                    val dm = restClient.createOrOpenDm(instanceUrl, jwtToken, profileUser.id)
                                    wsClient.addOrUpdateDmChannel(dm)
                                    dm
                                }.onSuccess { dm ->
                                    openingProfileDm = false
                                    selectedProfileTarget = null
                                    onOpenDm?.invoke(dm.id, dm.displayTitle(myUserId))
                                }.onFailure { err ->
                                    openingProfileDm = false
                                    errorText = err.message
                                }
                            }
                        },
                    ) {
                        Text(
                            text = if (openingProfileDm) "Abrindo..." else "Enviar mensagem (DM)",
                            color = colors.accentPrimary,
                        )
                    }
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !openingProfileDm,
                    onClick = { selectedProfileTarget = null },
                ) {
                    Text("Fechar", color = colors.textSecondary)
                }
            },
        )
    }

    // Menu de interações da mensagem (Reagir, Responder, Apagar)
    selectedMessageForActions?.let { targetMsg ->
        AlertDialog(
            onDismissRequest = { selectedMessageForActions = null },
            containerColor = colors.bgChannel,
            title = {
                Text(
                    text = targetMsg.authorLabel,
                    color = colors.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        QUICK_EMOJIS.forEach { emoji ->
                            Text(
                                text = emoji,
                                style = MaterialTheme.typography.headlineSmall,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .clickable {
                                        val alreadyReacted = targetMsg.reactions.any {
                                            it.userId == myUserId && it.emoji == emoji
                                        }
                                        if (alreadyReacted) {
                                            wsClient.sendReactionRemove(targetMsg.id, emoji)
                                        } else {
                                            wsClient.sendReactionAdd(targetMsg.id, emoji)
                                        }
                                        selectedMessageForActions = null
                                    }
                                    .padding(6.dp),
                            )
                        }
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                replyingTo = targetMsg
                                editingMessage = null
                                selectedMessageForActions = null
                            }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null, tint = colors.accentSky)
                        Spacer(Modifier.width(10.dp))
                        Text(replyActionLabel, color = colors.textPrimary)
                    }

                    if (targetMsg.safeContent.isNotBlank()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    clipboard.setText(AnnotatedString(targetMsg.safeContent))
                                    selectedMessageForActions = null
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = null, tint = colors.textSecondary)
                            Spacer(Modifier.width(10.dp))
                            Text("Copiar texto", color = colors.textPrimary)
                        }
                    }

                    if (canToggleMessageRetention) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    val targetId = targetMsg.id
                                    val nextRetain = !targetMsg.retainFiles
                                    selectedMessageForActions = null
                                    scope.launch {
                                        runCatching {
                                            val updated = restClient.setMessageRetainFiles(
                                                instanceUrl = instanceUrl,
                                                token = jwtToken,
                                                messageId = targetId,
                                                retainFiles = nextRetain,
                                            )
                                            wsClient.updateLocalMessage(channelId, updated)
                                        }.onFailure { err -> errorText = err.message }
                                    }
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Lock, contentDescription = null, tint = colors.accentMint)
                            Spacer(Modifier.width(10.dp))
                            Text(
                                text = if (targetMsg.retainFiles) {
                                    "Remover proteção de arquivos"
                                } else {
                                    "Proteger arquivos (Retenção)"
                                },
                                color = colors.textPrimary,
                            )
                        }
                    }

                    if (targetMsg.userId == myUserId) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    editingMessage = targetMsg
                                    replyingTo = null
                                    draft = targetMsg.safeContent
                                    selectedMessageForActions = null
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Edit, contentDescription = null, tint = colors.accentAmber)
                            Spacer(Modifier.width(10.dp))
                            Text("Editar", color = colors.textPrimary)
                        }

                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedMessageForActions = null
                                    messagePendingDelete = targetMsg
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = null, tint = colors.accentPeach)
                            Spacer(Modifier.width(10.dp))
                            Text(deleteActionLabel, color = colors.accentPeach)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { selectedMessageForActions = null }) {
                    Text("OK", color = colors.textSecondary)
                }
            },
        )
    }

    messagePendingDelete?.let { msgToDelete ->
        AlertDialog(
            onDismissRequest = { messagePendingDelete = null },
            containerColor = colors.bgChannel,
            title = { Text("Apagar mensagem?", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Tem certeza que deseja apagar esta mensagem? Esta ação não pode ser desfeita.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val msgId = msgToDelete.id
                        messagePendingDelete = null
                        scope.launch {
                            runCatching {
                                if (isDm) {
                                    restClient.deleteDmMessage(instanceUrl, jwtToken, msgId)
                                } else {
                                    restClient.deleteMessage(instanceUrl, jwtToken, msgId)
                                }
                                wsClient.removeLocalMessage(channelId, msgId)
                            }.onFailure { err -> errorText = err.message }
                        }
                    },
                ) {
                    Text(deleteActionLabel, color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { messagePendingDelete = null }) {
                    Text(cancelLabel, color = colors.textSecondary)
                }
            },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .systemBarsPadding()
            .imePadding()
            .padding(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = colors.textPrimary,
                    )
                }
                Text(
                    text = if (isDm) channelName else "# $channelName",
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row {
                IconButton(
                    onClick = {
                        showSearchBar = !showSearchBar
                        if (!showSearchBar) searchQuery = ""
                    },
                ) {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = "Search",
                        tint = if (showSearchBar) colors.accentPrimary else colors.textSecondary,
                    )
                }
                if (isDm && onStartCall != null) {
                    IconButton(onClick = { showCallConfirmDialog = true }) {
                        Icon(
                            imageVector = Icons.Default.Call,
                            contentDescription = "Call",
                            tint = colors.accentMint,
                        )
                    }
                }
            }
        }

        if (showSearchBar) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = { Text("Buscar mensagens...") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp),
            )
        }

        if (!errorText.isNullOrBlank()) {
            Text(
                text = errorText!!,
                color = colors.accentPeach,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }

        if (messages.isEmpty() && queuedForChannel.isEmpty()) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(text = emptyChatText, color = colors.textTertiary)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!isDm && allMessages.size >= 50 && !showSearchBar) {
                    item(key = "load_older") {
                        TextButton(
                            onClick = {
                                val firstId = allMessages.firstOrNull()?.id ?: return@TextButton
                                scope.launch {
                                    runCatching {
                                        val older = restClient.getChannelMessages(instanceUrl, jwtToken, channelId, before = firstId)
                                        wsClient.mergeChannelHistory(channelId, older)
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Carregar mensagens anteriores", color = colors.accentSky)
                        }
                    }
                }
                items(messages, key = { it.id }) { msg ->
                    val isMine = msg.userId == myUserId
                    val authorColor = roleColorByUserId[msg.userId]
                        ?: if (isMine) colors.accentMint else colors.accentSky
                    val formattedTime = if (msg.createdAt > 0L) {
                        timeFormatter.format(Date(msg.createdAt))
                    } else {
                        ""
                    }

                    AetherSurfaceCard(
                        modifier = Modifier.combinedClickable(
                            onClick = {},
                            onLongClick = { selectedMessageForActions = msg },
                        ),
                    ) {
                        // Preview da mensagem respondida
                        msg.replyTo?.let { reply ->
                            Surface(
                                color = colors.bgBase.copy(alpha = 0.6f),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 6.dp),
                            ) {
                                Text(
                                    text = "↩ ${reply.authorLabel}: ${reply.safeContent.ifBlank { "[anexo]" }}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                )
                            }
                        }

                        // Cabeçalho: avatar pequeno + nome sempre à esquerda, hora à direita
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { selectedProfileTarget = resolveProfileTarget(msg) }
                                    .padding(end = 6.dp, top = 2.dp, bottom = 2.dp),
                            ) {
                                AetherAvatar(
                                    imageUrl = msg.user?.avatarUrl(instanceUrl),
                                    fallbackLabel = msg.authorLabel,
                                    size = 24.dp,
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = msg.authorLabel,
                                    style = MaterialTheme.typography.labelLarge,
                                    color = authorColor,
                                )
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                if (msg.retainFiles) {
                                    Text(
                                        text = "🔒 Retido",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = colors.accentMint,
                                    )
                                }
                                Text(
                                    text = formattedTime,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = colors.textTertiary,
                                )
                            }
                        }

                        val stickerImgUrl = StickerTokenParser.extractImageUrl(msg.safeContent)
                        if (stickerImgUrl != null) {
                            Spacer(Modifier.height(6.dp))
                            AsyncImage(
                                model = ImageRequest.Builder(context)
                                    .data(stickerImgUrl)
                                    .addHeader("Authorization", "Bearer $jwtToken")
                                    .crossfade(true)
                                    .build(),
                                contentDescription = "Sticker",
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .size(140.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .clickable { fullscreenImageUrl = stickerImgUrl },
                            )
                        } else if (msg.safeContent.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            MarkdownMessageText(
                                text = msg.safeContent,
                                edited = msg.editedAt != null,
                            )

                            // Cartão de Convite de Grupo clicável quando a mensagem contém /invite/<código>
                            val inviteMatch = Regex("""https?://[^\s]+/invite/([a-zA-Z0-9_-]+)""").find(msg.safeContent)
                            if (inviteMatch != null) {
                                val inviteCode = inviteMatch.groupValues[1]
                                Spacer(Modifier.height(6.dp))
                                Surface(
                                    color = colors.bgElevated,
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Row(
                                        modifier = Modifier.padding(10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text("Convite de Grupo", style = MaterialTheme.typography.labelLarge, color = colors.accentPrimary)
                                            Text(inviteCode, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                                        }
                                        TextButton(
                                            onClick = {
                                                scope.launch {
                                                    runCatching {
                                                        val joined = restClient.joinSpaceByInvite(instanceUrl, jwtToken, inviteCode)
                                                        wsClient.refreshSpaceDetail(joined.id)
                                                    }.onFailure { err -> errorText = err.message }
                                                }
                                            },
                                        ) {
                                            Text("Entrar", color = colors.accentMint)
                                        }
                                    }
                                }
                            }
                        }

                        // Embeds ricos recebidos
                        if (msg.embeds.isNotEmpty()) {
                            Spacer(Modifier.height(6.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                msg.embeds.forEach { embed ->
                                    Surface(
                                        color = colors.bgElevated,
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable(enabled = embed.url.isNotBlank()) {
                                                runCatching {
                                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(embed.url)))
                                                }
                                            },
                                    ) {
                                        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            if (!embed.siteName.isNullOrBlank()) {
                                                Text(embed.siteName!!, style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                                            }
                                            if (!embed.title.isNullOrBlank()) {
                                                Text(embed.title!!, style = MaterialTheme.typography.titleSmall, color = colors.accentSky)
                                            }
                                            if (!embed.description.isNullOrBlank()) {
                                                Text(
                                                    embed.description!!,
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = colors.textSecondary,
                                                    maxLines = 3,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                            }
                                            val img = embed.imageUrl?.takeIf { it.isNotBlank() }
                                                ?: embed.thumbnailUrl?.takeIf { it.isNotBlank() }
                                            if (img != null) {
                                                AsyncImage(
                                                    model = ImageRequest.Builder(context).data(img).crossfade(true).build(),
                                                    contentDescription = embed.title,
                                                    contentScale = ContentScale.Crop,
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .height(140.dp)
                                                        .clip(RoundedCornerShape(8.dp)),
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Anexos recebidos: prévia compacta para imagens + card para outros arquivos
                        if (msg.attachments.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                msg.attachments.forEach { att ->
                                    val fullUrl = att.resolvedFileUrl(instanceUrl)
                                    if (att.isImage && fullUrl.isNotBlank()) {
                                        var activeUrl by remember(att.id) {
                                            mutableStateOf(att.resolvedThumbnailUrl(instanceUrl))
                                        }
                                        val req = remember(activeUrl) {
                                            ImageRequest.Builder(context)
                                                .data(activeUrl)
                                                .addHeader("Authorization", "Bearer $jwtToken")
                                                .crossfade(true)
                                                .build()
                                        }
                                        AsyncImage(
                                            model = req,
                                            contentDescription = att.displayName,
                                            contentScale = ContentScale.Crop,
                                            onError = {
                                                if (activeUrl != fullUrl) {
                                                    activeUrl = fullUrl
                                                }
                                            },
                                            modifier = Modifier
                                                .fillMaxWidth(0.75f)
                                                .height(170.dp)
                                                .clip(RoundedCornerShape(10.dp))
                                                .background(colors.bgBase)
                                                .clickable { fullscreenImageUrl = fullUrl },
                                        )
                                    } else {
                                        Surface(
                                            color = colors.bgElevated,
                                            shape = RoundedCornerShape(10.dp),
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .clickable {
                                                    runCatching {
                                                        context.startActivity(
                                                            Intent(Intent.ACTION_VIEW, Uri.parse(fullUrl)),
                                                        )
                                                    }
                                                },
                                        ) {
                                            Row(
                                                modifier = Modifier.padding(10.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.Description,
                                                    contentDescription = null,
                                                    tint = colors.accentPrimary,
                                                )
                                                Spacer(Modifier.width(8.dp))
                                                Column(modifier = Modifier.weight(1f)) {
                                                    Text(
                                                        text = att.displayName,
                                                        style = MaterialTheme.typography.bodySmall,
                                                        color = colors.textPrimary,
                                                        maxLines = 1,
                                                        overflow = TextOverflow.Ellipsis,
                                                    )
                                                    if (att.size > 0) {
                                                        Text(
                                                            text = formatFileSize(att.size),
                                                            style = MaterialTheme.typography.labelSmall,
                                                            color = colors.textTertiary,
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Reações agrupadas
                        if (msg.reactions.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            val grouped = msg.reactions.groupBy { it.emoji }
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                grouped.forEach { (emoji, list) ->
                                    val iReacted = list.any { it.userId == myUserId }
                                    Surface(
                                        color = if (iReacted) colors.accentPrimary.copy(alpha = 0.28f) else colors.bgElevated,
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.clickable {
                                            if (iReacted) {
                                                wsClient.sendReactionRemove(msg.id, emoji)
                                            } else {
                                                wsClient.sendReactionAdd(msg.id, emoji)
                                            }
                                        },
                                    ) {
                                        Text(
                                            text = "$emoji ${list.size}",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = colors.textPrimary,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // Mensagens na fila offline
                items(queuedForChannel, key = { it.localId }) { q ->
                    AetherSurfaceCard {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Schedule,
                                contentDescription = null,
                                tint = colors.accentAmber,
                                modifier = Modifier.size(16.dp),
                            )
                            Text(
                                text = queuedLabel,
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.accentAmber,
                            )
                        }
                        if (!q.content.isNullOrBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(text = q.content!!, color = colors.textSecondary)
                        }
                        if (q.attachments.isNotEmpty()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = q.attachments.joinToString(", ") { "📎 ${it.fileName}" },
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textTertiary,
                            )
                        }
                    }
                }
            }
        }

        // Indicador de quem está digitando em tempo real
        if (typingUsers.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = "${typingUsers.joinToString(", ")} digitando...",
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentSky,
            )
        }

        // Barra "Editando mensagem..."
        editingMessage?.let { editing ->
            Spacer(Modifier.height(6.dp))
            Surface(
                color = colors.bgChannel,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = "Editando mensagem",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.accentAmber,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            editingMessage = null
                            draft = ""
                        },
                        modifier = Modifier.size(24.dp),
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "Cancel edit", tint = colors.textSecondary)
                    }
                }
            }
        }

        // Barra "Respondendo a..."
        replyingTo?.let { reply ->
            Spacer(Modifier.height(6.dp))
            Surface(
                color = colors.bgChannel,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = "$replyingToPrefix ${reply.authorLabel}",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.accentSky,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = { replyingTo = null },
                        modifier = Modifier.size(24.dp),
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "Cancel reply", tint = colors.textSecondary)
                    }
                }
            }
        }

        // Autocomplete de @menções quando o usuário digita @ no Grupo
        val mentionToken = remember(draft, isDm) {
            if (isDm) null else Regex("""(?:^|\s)@([a-zA-Z0-9_.-]*)$""").find(draft)?.groupValues?.get(1)
        }
        if (mentionToken != null && currentSpace != null) {
            val suggestions = remember(mentionToken, currentSpace) {
                val q = mentionToken.lowercase()
                val base = buildList {
                    if ("everyone".startsWith(q)) add("everyone" to "Todos no canal")
                    if ("here".startsWith(q)) add("here" to "Online agora")
                    currentSpace.members.forEach { m ->
                        val uname = m.user?.username ?: return@forEach
                        if (uname.lowercase().contains(q) || m.label.lowercase().contains(q)) {
                            add(uname to m.label)
                        }
                    }
                }
                base.take(5)
            }
            if (suggestions.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(suggestions, key = { it.first }) { (uname, label) ->
                        FilterChip(
                            selected = false,
                            onClick = {
                                draft = draft.replace(Regex("""@([a-zA-Z0-9_.-]*)$"""), "@$uname ")
                            },
                            label = { Text("@$uname ($label)") },
                        )
                    }
                }
            }
        }

        // Bandeja de prévia de anexos pendentes (com miniatura de imagem ou ícone + nome + remover)
        if (pendingAttachments.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                items(pendingAttachments, key = { it.id }) { att ->
                    PendingAttachmentChip(
                        attachment = att,
                        onRemove = { pendingAttachments.remove(att) },
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                Icon(
                    imageVector = Icons.Default.AttachFile,
                    contentDescription = "Attach file",
                    tint = colors.textSecondary,
                )
            }
            IconButton(onClick = { showMediaPicker = true }) {
                Icon(
                    imageVector = Icons.Default.EmojiEmotions,
                    contentDescription = "Emoji, GIF, Stickers",
                    tint = colors.textSecondary,
                )
            }
            OutlinedTextField(
                value = draft,
                onValueChange = { nextText ->
                    draft = nextText
                    val now = System.currentTimeMillis()
                    if (nextText.isNotBlank() && now - lastTypingSentMs > 3_000L) {
                        lastTypingSentMs = now
                        wsClient.sendTypingStart(channelId)
                    }
                },
                placeholder = { Text(messagePlaceholder) },
                modifier = Modifier
                    .weight(1f)
                    .contentReceiver(receiveContentListener),
                maxLines = 4,
            )
            Spacer(Modifier.width(6.dp))
            val canSend = draft.isNotBlank() || pendingAttachments.isNotEmpty()
            IconButton(
                enabled = canSend,
                onClick = {
                    val editing = editingMessage
                    if (editing != null) {
                        val updatedText = draft.trim()
                        if (updatedText.isBlank()) return@IconButton
                        editingMessage = null
                        draft = ""
                        scope.launch {
                            runCatching {
                                val updatedMsg = if (isDm) {
                                    restClient.editDmMessage(instanceUrl, jwtToken, editing.id, updatedText).toChannelMessage()
                                } else {
                                    restClient.editMessage(instanceUrl, jwtToken, editing.id, updatedText)
                                }
                                wsClient.updateLocalMessage(channelId, updatedMsg)
                            }.onFailure { err -> errorText = err.message }
                        }
                        return@IconButton
                    }
                    val contentToSend = draft.trim().ifBlank { null }
                    val attsToSend = pendingAttachments.toList()
                    val replyId = replyingTo?.id
                    draft = ""
                    pendingAttachments.clear()
                    replyingTo = null
                    errorText = null
                    wsClient.enqueueOrSendMessage(
                        channelId = channelId,
                        content = contentToSend,
                        replyToId = replyId,
                        attachments = attsToSend,
                        isDm = isDm,
                    )
                },
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = if (canSend) colors.accentPrimary else colors.textTertiary,
                )
            }
        }
    }
}

@Composable
private fun PendingAttachmentChip(
    attachment: PendingAttachmentPayload,
    onRemove: () -> Unit,
) {
    val colors = AetherTheme.colors
    val previewBitmap = remember(attachment.id) {
        if (attachment.isImage) {
            runCatching {
                BitmapFactory.decodeByteArray(attachment.bytes, 0, attachment.bytes.size)?.asImageBitmap()
            }.getOrNull()
        } else {
            null
        }
    }

    Surface(
        color = colors.bgChannel,
        shape = RoundedCornerShape(12.dp),
    ) {
        Box(modifier = Modifier.padding(8.dp)) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.width(84.dp),
            ) {
                if (previewBitmap != null) {
                    Image(
                        bitmap = previewBitmap,
                        contentDescription = attachment.fileName,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(56.dp)
                            .clip(RoundedCornerShape(8.dp)),
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(colors.bgElevated),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Default.Description,
                            contentDescription = null,
                            tint = colors.accentPrimary,
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = attachment.fileName,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(
                onClick = onRemove,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.7f)),
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Remove",
                    tint = Color.White,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}

private fun formatFileSize(bytes: Long): String = when {
    bytes >= 1_048_576L -> String.format(Locale.getDefault(), "%.1f MB", bytes / 1_048_576.0)
    bytes >= 1_024L -> String.format(Locale.getDefault(), "%.1f KB", bytes / 1_024.0)
    else -> "$bytes B"
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun MediaPickerDialog(
    instanceUrl: String,
    jwtToken: String,
    restClient: BackspaceRestClient,
    onInsertEmoji: (String) -> Unit,
    onSendUrl: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = AetherTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(0) } // 0 = Emoji, 1 = GIF, 2 = Stickers
    var gifQuery by remember { mutableStateOf("") }
    var gifs by remember { mutableStateOf<List<GifItem>>(emptyList()) }
    var stickers by remember { mutableStateOf<List<StickerItem>>(emptyList()) }
    var stickerPendingDelete by remember { mutableStateOf<StickerItem?>(null) }
    var statusText by remember { mutableStateOf<String?>(null) }

    val stickerUploadLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            statusText = null
            runCatching {
                val (fileName, mimeType, bytes) = readUriPayload(context, uri)
                val cleanName = fileName.substringBeforeLast('.').take(40).ifBlank { "sticker" }
                val uploaded = restClient.uploadSticker(instanceUrl, jwtToken, cleanName, mimeType, bytes)
                stickers = listOf(uploaded) + stickers
            }.onFailure { statusText = it.message }
        }
    }

    LaunchedEffect(tab, gifQuery) {
        statusText = null
        if (tab == 1) {
            runCatching {
                if (gifQuery.isBlank()) {
                    restClient.getTrendingGifs(instanceUrl, jwtToken)
                } else {
                    restClient.searchGifs(instanceUrl, jwtToken, gifQuery)
                }
            }.onSuccess { gifs = it }.onFailure { statusText = it.message }
        } else if (tab == 2 && stickers.isEmpty()) {
            runCatching { restClient.getStickers(instanceUrl, jwtToken) }
                .onSuccess { stickers = it }
                .onFailure { statusText = it.message }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.bgChannel,
        title = {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(selected = tab == 0, onClick = { tab = 0 }, label = { Text("Emoji") })
                FilterChip(selected = tab == 1, onClick = { tab = 1 }, label = { Text("GIF") })
                FilterChip(selected = tab == 2, onClick = { tab = 2 }, label = { Text("Stickers") })
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 340.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!statusText.isNullOrBlank()) {
                    Text(statusText!!, color = colors.accentPeach, style = MaterialTheme.typography.bodySmall)
                }
                when (tab) {
                    0 -> {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            PICKER_EMOJIS.forEach { emoji ->
                                Text(
                                    text = emoji,
                                    style = MaterialTheme.typography.headlineSmall,
                                    modifier = Modifier
                                        .clickable { onInsertEmoji(emoji) }
                                        .padding(4.dp),
                                )
                            }
                        }
                    }

                    1 -> {
                        OutlinedTextField(
                            value = gifQuery,
                            onValueChange = { gifQuery = it },
                            placeholder = { Text("GIF...") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        LazyColumn(
                            modifier = Modifier.heightIn(max = 240.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            items(gifs.chunked(2)) { pair ->
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    pair.forEach { gif ->
                                        AsyncImage(
                                            model = ImageRequest.Builder(context)
                                                .data(gif.bestPreview)
                                                .crossfade(true)
                                                .build(),
                                            contentDescription = gif.title,
                                            contentScale = ContentScale.Crop,
                                            modifier = Modifier
                                                .weight(1f)
                                                .height(92.dp)
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(colors.bgBase)
                                                .clickable { if (gif.url.isNotBlank()) onSendUrl(gif.url) },
                                        )
                                    }
                                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                                }
                            }
                        }
                    }

                    else -> {
                        TextButton(
                            onClick = { stickerUploadLauncher.launch("image/*") },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("+ Enviar nova figurinha", color = colors.accentPrimary)
                        }
                        if (stickers.isEmpty()) {
                            Text("Nenhuma figurinha ainda.", color = colors.textSecondary)
                        } else {
                            LazyColumn(
                                modifier = Modifier.heightIn(max = 230.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                items(stickers.chunked(3)) { row ->
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        row.forEach { st ->
                                            val stUrl = st.assetUrl(instanceUrl)
                                            val stToken = st.sendToken(instanceUrl)
                                            AsyncImage(
                                                model = ImageRequest.Builder(context)
                                                    .data(stUrl)
                                                    .addHeader("Authorization", "Bearer $jwtToken")
                                                    .crossfade(true)
                                                    .build(),
                                                contentDescription = st.name,
                                                contentScale = ContentScale.Fit,
                                                modifier = Modifier
                                                    .weight(1f)
                                                    .height(76.dp)
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .background(colors.bgBase)
                                                    .combinedClickable(
                                                        onClick = { onSendUrl(stToken) },
                                                        onLongClick = { stickerPendingDelete = st },
                                                    ),
                                            )
                                        }
                                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("OK", color = colors.textSecondary)
            }
        },
    )

    stickerPendingDelete?.let { stToDelete ->
        AlertDialog(
            onDismissRequest = { stickerPendingDelete = null },
            containerColor = colors.bgChannel,
            title = { Text("Excluir figurinha?", color = colors.textPrimary) },
            text = {
                val stickerLabel = stToDelete.name.ifBlank { "esta figurinha" }
                Text(
                    text = "Deseja excluir \"$stickerLabel\"? Esta ação não pode ser desfeita.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val targetId = stToDelete.id
                        stickerPendingDelete = null
                        scope.launch {
                            runCatching {
                                restClient.deleteSticker(instanceUrl, jwtToken, targetId)
                                stickers = stickers.filterNot { it.id == targetId }
                            }.onFailure { statusText = it.message }
                        }
                    },
                ) {
                    Text("Excluir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { stickerPendingDelete = null }) {
                    Text("Cancelar", color = colors.textSecondary)
                }
            },
        )
    }
}

private suspend fun readUriPayload(
    context: Context,
    uri: Uri,
): Triple<String, String, ByteArray> = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    var fileName = "attachment"
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0) fileName = cursor.getString(idx) ?: fileName
        }
    }
    val mimeType = resolver.getType(uri) ?: "application/octet-stream"
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
        ?: throw IllegalStateException("Cannot read selected file")
    Triple(fileName, mimeType, bytes)
}
