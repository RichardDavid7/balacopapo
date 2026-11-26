package com.backspace.feature.spaces

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backspace.core.designsystem.AetherAvatar
import com.backspace.core.designsystem.AetherPrimaryButton
import com.backspace.core.designsystem.AetherPurpleSlider
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.AetherTheme
import com.backspace.core.model.Channel
import com.backspace.core.model.ChannelCategory
import com.backspace.core.model.ChannelTreeBuilder
import com.backspace.core.model.ChosenUserStatus
import com.backspace.core.model.ExploreSpaceItem
import com.backspace.core.model.MemberWithUser
import com.backspace.core.model.PermissionBits
import com.backspace.core.model.Space
import com.backspace.core.model.SpaceBanItem
import com.backspace.core.model.SpaceTreeItem
import com.backspace.core.model.StatusRevertDuration
import com.backspace.core.network.BackspaceRestClient
import com.backspace.core.network.BackspaceWebSocketClient
import com.backspace.core.network.UpdateSpaceAdminRequest
import com.backspace.core.voice.BackspaceVoiceEngine
import com.backspace.core.voice.VoiceConnectionStatus
import kotlinx.coroutines.launch

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SpacesScreen(
    instanceUrl: String,
    jwtToken: String,
    restClient: BackspaceRestClient,
    wsClient: BackspaceWebSocketClient,
    voiceEngine: BackspaceVoiceEngine,
    spacesTitle: String,
    noSpacesText: String,
    activeVoiceBannerPrefix: String,
    statusPickerTitle: String,
    statusOnlineLabel: String,
    statusIdleLabel: String,
    statusDndLabel: String,
    customStatusPlaceholder: String,
    revertTimerLabel: String,
    membersTitle: String,
    sendDmLabel: String,
    spaceAdminTitle: String,
    saveLabel: String,
    cancelLabel: String,
    onOpenDirectDm: (dmChannelId: String, dmTitle: String) -> Unit,
    onOpenTextChannel: (Channel) -> Unit,
    onJoinVoiceChannel: (Space, ChannelCategory?, Channel) -> Unit,
    onOpenActiveVoice: () -> Unit,
    showVoiceBanner: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val colors = AetherTheme.colors
    val scope = rememberCoroutineScope()
    val snapshot by wsClient.snapshot.collectAsStateWithLifecycle()
    val voiceState by voiceEngine.state.collectAsStateWithLifecycle()

    var selectedSpaceId by remember(snapshot.spaces) {
        mutableStateOf(snapshot.spaces.firstOrNull()?.id)
    }
    var showStatusDialog by remember { mutableStateOf(false) }
    var showMembersDialog by remember { mutableStateOf(false) }
    var selectedProfileMember by remember { mutableStateOf<MemberWithUser?>(null) }
    var showSpaceAdminDialog by remember { mutableStateOf(false) }
    var showAddOrExploreDialog by remember { mutableStateOf(false) }
    var editingChannel by remember { mutableStateOf<Channel?>(null) }
    var editingCategory by remember { mutableStateOf<ChannelCategory?>(null) }
    var showCreateChannelOrCategory by remember { mutableStateOf(false) }
    var showReorderStructure by remember { mutableStateOf(false) }
    var memberPendingKick by remember { mutableStateOf<MemberWithUser?>(null) }
    var memberPendingBan by remember { mutableStateOf<MemberWithUser?>(null) }
    val collapsedCategories = remember { mutableStateMapOf<String, Boolean>() }

    val selectedSpace = snapshot.spaces.firstOrNull { it.id == selectedSpaceId }
        ?: snapshot.spaces.firstOrNull()
    val isSpaceAdmin = selectedSpace != null && (
        PermissionBits.hasPermission(selectedSpace.myPermissions, PermissionBits.ADMINISTRATOR) ||
            selectedSpace.ownerId == snapshot.currentUser?.id
        )

    // Telas dedicadas em tela cheia (Fase 2) — substituindo diálogos apertados
    if (showSpaceAdminDialog && selectedSpace != null) {
        Box(modifier = modifier.fillMaxSize()) {
            SpaceSettingsHostScreen(
                instanceUrl = instanceUrl,
                token = jwtToken,
                space = selectedSpace,
                currentUserId = snapshot.currentUser?.id.orEmpty(),
                restClient = restClient,
                onSpaceUpdated = {
                    scope.launch { runCatching { wsClient.refreshSpaceDetail(selectedSpace.id) } }
                },
                onSpaceLeftOrDeleted = {
                    showSpaceAdminDialog = false
                    selectedSpaceId = snapshot.spaces.firstOrNull { it.id != selectedSpace.id }?.id
                },
                onBack = { showSpaceAdminDialog = false },
            )
        }
        return
    }

    if (editingChannel != null && selectedSpace != null) {
        val targetChannel = editingChannel!!
        Box(modifier = modifier.fillMaxSize()) {
            ChannelSettingsHostScreen(
                instanceUrl = instanceUrl,
                token = jwtToken,
                space = selectedSpace,
                channel = targetChannel,
                restClient = restClient,
                onChanged = {
                    scope.launch { runCatching { wsClient.refreshSpaceDetail(selectedSpace.id) } }
                },
                onDeleted = {
                    editingChannel = null
                    scope.launch { runCatching { wsClient.refreshSpaceDetail(selectedSpace.id) } }
                },
                onBack = { editingChannel = null },
            )
        }
        return
    }

    if (editingCategory != null && selectedSpace != null) {
        val targetCategory = editingCategory!!
        Box(modifier = modifier.fillMaxSize()) {
            CategorySettingsHostScreen(
                instanceUrl = instanceUrl,
                token = jwtToken,
                space = selectedSpace,
                category = targetCategory,
                restClient = restClient,
                onChanged = {
                    scope.launch { runCatching { wsClient.refreshSpaceDetail(selectedSpace.id) } }
                },
                onDeleted = {
                    editingCategory = null
                    scope.launch { runCatching { wsClient.refreshSpaceDetail(selectedSpace.id) } }
                },
                onBack = { editingCategory = null },
            )
        }
        return
    }

    if (showStatusDialog) {
        StatusPickerDialog(
            currentStatus = snapshot.currentUser?.status ?: "online",
            currentCustomStatus = snapshot.currentUser?.customStatus.orEmpty(),
            title = statusPickerTitle,
            onlineLabel = statusOnlineLabel,
            idleLabel = statusIdleLabel,
            dndLabel = statusDndLabel,
            customStatusPlaceholder = customStatusPlaceholder,
            revertTimerLabel = revertTimerLabel,
            saveLabel = saveLabel,
            cancelLabel = cancelLabel,
            onDismiss = { showStatusDialog = false },
            onSave = { status, custom, revert ->
                wsClient.setStatusWithOptionalRevert(status, custom.ifBlank { null }, revert)
                showStatusDialog = false
            },
        )
    }

    if (showMembersDialog && selectedSpace != null) {
        MembersListDialog(
            instanceUrl = instanceUrl,
            title = "$membersTitle (${selectedSpace.members.size})",
            members = selectedSpace.members,
            onSelectMember = { member ->
                showMembersDialog = false
                selectedProfileMember = member
            },
            onDismiss = { showMembersDialog = false },
        )
    }

    selectedProfileMember?.let { member ->
        UserProfileDialog(
            instanceUrl = instanceUrl,
            member = member,
            isMe = member.userId == snapshot.currentUser?.id,
            canModerate = isSpaceAdmin && member.userId != snapshot.currentUser?.id,
            sendDmLabel = sendDmLabel,
            onSendDm = {
                selectedProfileMember = null
                scope.launch {
                    runCatching {
                        val dm = restClient.createOrOpenDm(instanceUrl, jwtToken, member.userId)
                        wsClient.addOrUpdateDmChannel(dm)
                        dm
                    }.onSuccess { dm ->
                        onOpenDirectDm(dm.id, dm.displayTitle(snapshot.currentUser?.id))
                    }
                }
            },
            onKick = {
                selectedProfileMember = null
                memberPendingKick = member
            },
            onBan = {
                selectedProfileMember = null
                memberPendingBan = member
            },
            onDismiss = { selectedProfileMember = null },
        )
    }

    memberPendingKick?.let { member ->
        AlertDialog(
            onDismissRequest = { memberPendingKick = null },
            containerColor = colors.bgChannel,
            title = { Text("Expulsar membro?", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Tem certeza que deseja expulsar ${member.label} deste Grupo?",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val sid = selectedSpace?.id
                        memberPendingKick = null
                        if (sid != null) {
                            scope.launch {
                                runCatching {
                                    restClient.kickMember(instanceUrl, jwtToken, sid, member.userId)
                                    wsClient.refreshSpaceDetail(sid)
                                }
                            }
                        }
                    },
                ) {
                    Text("Expulsar", color = colors.accentAmber)
                }
            },
            dismissButton = {
                TextButton(onClick = { memberPendingKick = null }) {
                    Text(cancelLabel, color = colors.textSecondary)
                }
            },
        )
    }

    memberPendingBan?.let { member ->
        AlertDialog(
            onDismissRequest = { memberPendingBan = null },
            containerColor = colors.bgChannel,
            title = { Text("Banir membro?", color = colors.textPrimary) },
            text = {
                Text(
                    text = "Tem certeza que deseja banir ${member.label} deste Grupo? O usuário não poderá entrar novamente até ser desbanido.",
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val sid = selectedSpace?.id
                        memberPendingBan = null
                        if (sid != null) {
                            scope.launch {
                                runCatching {
                                    restClient.banMember(instanceUrl, jwtToken, sid, member.userId)
                                    wsClient.refreshSpaceDetail(sid)
                                }
                            }
                        }
                    },
                ) {
                    Text("Banir", color = colors.accentPeach)
                }
            },
            dismissButton = {
                TextButton(onClick = { memberPendingBan = null }) {
                    Text(cancelLabel, color = colors.textSecondary)
                }
            },
        )
    }

    if (showCreateChannelOrCategory && selectedSpace != null) {
        CreateChannelOrCategoryDialog(
            instanceUrl = instanceUrl,
            token = jwtToken,
            space = selectedSpace,
            restClient = restClient,
            onCreated = {
                showCreateChannelOrCategory = false
                scope.launch { runCatching { wsClient.refreshSpaceDetail(selectedSpace.id) } }
            },
            onDismiss = { showCreateChannelOrCategory = false },
        )
    }

    if (showReorderStructure && selectedSpace != null) {
        ReorderSpaceStructureDialog(
            instanceUrl = instanceUrl,
            token = jwtToken,
            space = selectedSpace,
            restClient = restClient,
            onSaved = {
                showReorderStructure = false
                scope.launch { runCatching { wsClient.refreshSpaceDetail(selectedSpace.id) } }
            },
            onDismiss = { showReorderStructure = false },
        )
    }

    if (showAddOrExploreDialog) {
        AddOrExploreSpaceDialog(
            instanceUrl = instanceUrl,
            jwtToken = jwtToken,
            restClient = restClient,
            wsClient = wsClient,
            onSpaceJoined = { spaceId ->
                selectedSpaceId = spaceId
                showAddOrExploreDialog = false
            },
            onDismiss = { showAddOrExploreDialog = false },
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .weight(1f)
                    .clickable { showStatusDialog = true },
            ) {
                AetherAvatar(
                    imageUrl = snapshot.currentUser?.avatarUrl(instanceUrl),
                    fallbackLabel = snapshot.currentUser?.label ?: "?",
                    size = 38.dp,
                    status = snapshot.currentUser?.status ?: "offline",
                )
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        text = snapshot.currentUser?.label ?: spacesTitle,
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.textPrimary,
                    )
                    val subtitle = snapshot.currentUser?.customStatus?.takeIf { it.isNotBlank() }
                        ?: selectedSpace?.name
                        ?: snapshot.connectionState.name
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                }
            }
            Row {
                IconButton(onClick = { showAddOrExploreDialog = true }) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "Create / Join / Explore Space",
                        tint = colors.accentPrimary,
                    )
                }
                if (selectedSpace != null) {
                    IconButton(onClick = { showMembersDialog = true }) {
                        Icon(
                            imageVector = Icons.Default.Group,
                            contentDescription = "Members",
                            tint = colors.textSecondary,
                        )
                    }
                }
                if (isSpaceAdmin) {
                    IconButton(onClick = { showSpaceAdminDialog = true }) {
                        Icon(
                            imageVector = Icons.Default.AdminPanelSettings,
                            contentDescription = "Space Admin",
                            tint = colors.accentAmber,
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))

        if (showVoiceBanner && (voiceState.status == VoiceConnectionStatus.CONNECTED || voiceState.status == VoiceConnectionStatus.CONNECTING)) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onOpenActiveVoice),
                shape = RoundedCornerShape(14.dp),
                color = colors.accentPrimary.copy(alpha = 0.2f),
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text(
                            text = "$activeVoiceBannerPrefix · ${voiceState.channelName}",
                            style = MaterialTheme.typography.titleSmall,
                            color = colors.accentMint,
                        )
                        Text(
                            text = "${voiceState.spaceName} · Opus ${voiceState.effectiveAudio.bitrateKbps} kbps",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.VolumeUp,
                        contentDescription = null,
                        tint = colors.accentMint,
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
        }

        if (snapshot.spaces.isEmpty()) {
            AetherSurfaceCard {
                Text(text = noSpacesText, color = colors.textSecondary)
            }
            return
        }

        // Lista horizontal de Grupos com ícone oficial + bolinha de menções
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(snapshot.spaces, key = { it.id }) { space ->
                val spaceMentions = snapshot.mentionsForSpace(space)
                FilterChip(
                    selected = space.id == selectedSpace?.id,
                    onClick = { selectedSpaceId = space.id },
                    leadingIcon = {
                        AetherAvatar(
                            imageUrl = space.iconUrl(instanceUrl),
                            fallbackLabel = space.name,
                            size = 22.dp,
                        )
                    },
                    trailingIcon = if (spaceMentions > 0) {
                        {
                            Badge(containerColor = colors.accentPeach) {
                                Text("$spaceMentions")
                            }
                        }
                    } else {
                        null
                    },
                    label = { Text(space.name) },
                )
            }
        }

        Spacer(Modifier.height(10.dp))

        if (selectedSpace != null && isSpaceAdmin) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { showCreateChannelOrCategory = true },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("+ Canal / Categoria", maxLines = 1)
                }
                OutlinedButton(
                    onClick = { showReorderStructure = true },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Reordenar", maxLines = 1)
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        if (selectedSpace != null) {
            val canConnect = PermissionBits.hasPermission(selectedSpace.myPermissions, PermissionBits.CONNECT)
            val treeItems = remember(selectedSpace) { ChannelTreeBuilder.build(selectedSpace) }
            val categoryById = remember(selectedSpace.categories) { selectedSpace.categories.associateBy { it.id } }
            val memberById = remember(selectedSpace.members) { selectedSpace.members.associateBy { it.userId } }

            fun isAnyAncestorCollapsed(startCategoryId: String?): Boolean {
                var currentId = startCategoryId
                val visited = mutableSetOf<String>()
                while (currentId != null && visited.add(currentId)) {
                    if (collapsedCategories[currentId] == true) return true
                    currentId = categoryById[currentId]?.parentId
                }
                return false
            }

            val visibleTreeItems = treeItems.filter { item ->
                when (item) {
                    is SpaceTreeItem.CategoryHeader -> !isAnyAncestorCollapsed(item.category.parentId)
                    is SpaceTreeItem.ChannelRow -> !isAnyAncestorCollapsed(item.category?.id)
                }
            }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(visibleTreeItems, key = { it.stableKey }) { item ->
                    when (item) {
                        is SpaceTreeItem.CategoryHeader -> {
                            val collapsed = collapsedCategories[item.category.id] == true
                            val indent = (item.depth * 14).dp
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .combinedClickable(
                                        onClick = { collapsedCategories[item.category.id] = !collapsed },
                                        onLongClick = { if (isSpaceAdmin) editingCategory = item.category },
                                    )
                                    .padding(start = indent, top = 8.dp, bottom = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    imageVector = if (collapsed) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                                    contentDescription = null,
                                    tint = colors.textTertiary,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    text = item.category.name.uppercase(),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = colors.textSecondary,
                                )
                            }
                        }

                        is SpaceTreeItem.ChannelRow -> {
                            val indent = (item.depth * 10).dp
                            val ch = item.channel
                            if (ch.isVoice) {
                                val userIds = snapshot.voiceStates[ch.id].orEmpty()
                                val isCurrent = voiceState.channelId == ch.id
                                AetherSurfaceCard(
                                    modifier = Modifier
                                        .padding(start = indent)
                                        .combinedClickable(
                                            enabled = canConnect,
                                            onClick = { onJoinVoiceChannel(selectedSpace, item.category, ch) },
                                            onLongClick = { if (isSpaceAdmin) editingChannel = ch },
                                        ),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(
                                                imageVector = Icons.AutoMirrored.Filled.VolumeUp,
                                                contentDescription = null,
                                                tint = if (isCurrent) colors.accentMint else colors.accentPrimary,
                                            )
                                            Spacer(Modifier.width(10.dp))
                                            Text(
                                                text = ch.name,
                                                style = MaterialTheme.typography.titleMedium,
                                                color = colors.textPrimary,
                                            )
                                        }
                                        if (userIds.isNotEmpty()) {
                                            Text(
                                                text = "${userIds.size}",
                                                style = MaterialTheme.typography.labelLarge,
                                                color = colors.accentMint,
                                            )
                                        }
                                    }
                                    if (userIds.isNotEmpty()) {
                                        Spacer(Modifier.height(6.dp))
                                        val names = userIds.map { uid -> memberById[uid]?.label ?: uid }
                                        Text(
                                            text = names.joinToString(", "),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = colors.textSecondary,
                                        )
                                    }
                                }
                            } else {
                                val channelMentions = snapshot.channelMentionCounts[ch.id] ?: 0
                                AetherSurfaceCard(
                                    modifier = Modifier
                                        .padding(start = indent)
                                        .combinedClickable(
                                            onClick = { onOpenTextChannel(ch) },
                                            onLongClick = { if (isSpaceAdmin) editingChannel = ch },
                                        ),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(
                                                imageVector = Icons.Default.Tag,
                                                contentDescription = null,
                                                tint = colors.textSecondary,
                                            )
                                            Spacer(Modifier.width(10.dp))
                                            Text(
                                                text = ch.name,
                                                style = MaterialTheme.typography.titleMedium,
                                                color = colors.textPrimary,
                                            )
                                        }
                                        if (channelMentions > 0) {
                                            Badge(containerColor = colors.accentPeach) {
                                                Text("$channelMentions")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MembersListDialog(
    instanceUrl: String,
    title: String,
    members: List<MemberWithUser>,
    onSelectMember: (MemberWithUser) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = AetherTheme.colors
    val sorted = remember(members) {
        members.sortedWith(
            compareBy<MemberWithUser> { if ((it.user?.status ?: "offline") == "offline") 1 else 0 }
                .thenBy { it.label.lowercase() },
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.bgChannel,
        title = { Text(title, color = colors.textPrimary) },
        text = {
            LazyColumn(
                modifier = Modifier.heightIn(max = 420.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(sorted, key = { it.userId }) { member ->
                    val roleColor = member.highestRoleColorHex?.let {
                        runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull()
                    } ?: colors.textPrimary

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelectMember(member) }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AetherAvatar(
                            imageUrl = member.user?.avatarUrl(instanceUrl),
                            fallbackLabel = member.label,
                            size = 34.dp,
                            status = member.user?.status ?: "offline",
                        )
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(text = member.label, color = roleColor, style = MaterialTheme.typography.bodyMedium)
                            val custom = member.user?.customStatus
                            if (!custom.isNullOrBlank()) {
                                Text(text = custom, color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("OK", color = colors.accentPrimary)
            }
        },
    )
}

@Composable
private fun UserProfileDialog(
    instanceUrl: String,
    member: MemberWithUser,
    isMe: Boolean,
    canModerate: Boolean,
    sendDmLabel: String,
    onSendDm: () -> Unit,
    onKick: () -> Unit,
    onBan: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = AetherTheme.colors
    val user = member.user
    val roleColor = member.highestRoleColorHex?.let {
        runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull()
    } ?: colors.textPrimary

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.bgChannel,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AetherAvatar(
                    imageUrl = user?.avatarUrl(instanceUrl),
                    fallbackLabel = member.label,
                    size = 48.dp,
                    status = user?.status ?: "offline",
                )
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(text = member.label, color = roleColor, style = MaterialTheme.typography.titleMedium)
                    Text(text = "@${user?.username ?: member.userId}", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!user?.customStatus.isNullOrBlank()) {
                    Text(text = user?.customStatus!!, color = colors.accentMint, style = MaterialTheme.typography.bodySmall)
                }
                if (!user?.bio.isNullOrBlank()) {
                    Text(text = user?.bio!!, color = colors.textPrimary, style = MaterialTheme.typography.bodyMedium)
                }
                val visibleRoles = member.roles.filter { !it.isEveryone && it.name.isNotBlank() }
                if (visibleRoles.isNotEmpty()) {
                    Text(
                        text = visibleRoles.joinToString(" · ") { it.name },
                        color = colors.accentSky,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                if (!isMe) {
                    Spacer(Modifier.height(4.dp))
                    AetherPrimaryButton(text = sendDmLabel, onClick = onSendDm)
                }
                if (canModerate) {
                    OutlinedButton(onClick = onKick, modifier = Modifier.fillMaxWidth()) {
                        Text("Expulsar do Grupo", color = colors.accentAmber)
                    }
                    OutlinedButton(onClick = onBan, modifier = Modifier.fillMaxWidth()) {
                        Text("Banir do Grupo", color = colors.accentPeach)
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
}

@Composable
private fun AddOrExploreSpaceDialog(
    instanceUrl: String,
    jwtToken: String,
    restClient: BackspaceRestClient,
    wsClient: BackspaceWebSocketClient,
    onSpaceJoined: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = AetherTheme.colors
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) } // 0 = Criar, 1 = Convite, 2 = Descobrir
    var newSpaceName by remember { mutableStateOf("") }
    var newSpaceDesc by remember { mutableStateOf("") }
    var inviteInput by remember { mutableStateOf("") }
    var exploreQuery by remember { mutableStateOf("") }
    var exploreList by remember { mutableStateOf<List<ExploreSpaceItem>>(emptyList()) }
    var statusMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(tab, exploreQuery) {
        if (tab == 2) {
            runCatching { restClient.exploreSpaces(instanceUrl, jwtToken, exploreQuery) }
                .onSuccess { exploreList = it }
                .onFailure { statusMsg = it.message }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.bgChannel,
        title = {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(selected = tab == 0, onClick = { tab = 0 }, label = { Text("Criar") })
                FilterChip(selected = tab == 1, onClick = { tab = 1 }, label = { Text("Convite") })
                FilterChip(selected = tab == 2, onClick = { tab = 2 }, label = { Text("Descobrir") })
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!statusMsg.isNullOrBlank()) {
                    Text(statusMsg!!, color = colors.accentPeach, style = MaterialTheme.typography.bodySmall)
                }
                when (tab) {
                    0 -> {
                        OutlinedTextField(
                            value = newSpaceName,
                            onValueChange = { newSpaceName = it },
                            label = { Text("Nome do Grupo") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = newSpaceDesc,
                            onValueChange = { newSpaceDesc = it },
                            label = { Text("Descrição") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        AetherPrimaryButton(
                            text = "Criar Grupo",
                            enabled = newSpaceName.isNotBlank(),
                            onClick = {
                                scope.launch {
                                    statusMsg = null
                                    runCatching {
                                        val created = restClient.createSpace(instanceUrl, jwtToken, newSpaceName.trim(), newSpaceDesc)
                                        wsClient.refreshSpaceDetail(created.id)
                                        created.id
                                    }.onSuccess(onSpaceJoined)
                                        .onFailure { statusMsg = it.message }
                                }
                            },
                        )
                    }

                    1 -> {
                        OutlinedTextField(
                            value = inviteInput,
                            onValueChange = { inviteInput = it },
                            label = { Text("Link ou código de convite") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        AetherPrimaryButton(
                            text = "Entrar no Grupo",
                            enabled = inviteInput.isNotBlank(),
                            onClick = {
                                scope.launch {
                                    statusMsg = null
                                    runCatching {
                                        val joined = restClient.joinSpaceByInvite(instanceUrl, jwtToken, inviteInput)
                                        wsClient.refreshSpaceDetail(joined.id)
                                        joined.id
                                    }.onSuccess(onSpaceJoined)
                                        .onFailure { statusMsg = it.message }
                                }
                            },
                        )
                    }

                    else -> {
                        OutlinedTextField(
                            value = exploreQuery,
                            onValueChange = { exploreQuery = it },
                            placeholder = { Text("Buscar Grupos...") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        LazyColumn(
                            modifier = Modifier.heightIn(max = 260.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            items(exploreList, key = { it.id }) { item ->
                                AetherSurfaceCard {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.weight(1f),
                                        ) {
                                            AetherAvatar(
                                                imageUrl = item.iconUrl(instanceUrl),
                                                fallbackLabel = item.name,
                                                size = 32.dp,
                                            )
                                            Spacer(Modifier.width(8.dp))
                                            Column {
                                                Text(item.name, color = colors.textPrimary, style = MaterialTheme.typography.titleSmall)
                                                Text("${item.memberCount} membros", color = colors.textSecondary, style = MaterialTheme.typography.labelSmall)
                                            }
                                        }
                                        if (!item.isMember) {
                                            TextButton(
                                                onClick = {
                                                    scope.launch {
                                                        runCatching {
                                                            restClient.publicJoinSpace(instanceUrl, jwtToken, item.id)
                                                            wsClient.refreshSpaceDetail(item.id)
                                                        }.onSuccess { onSpaceJoined(item.id) }
                                                            .onFailure { statusMsg = it.message }
                                                    }
                                                },
                                            ) {
                                                Text("Entrar", color = colors.accentMint)
                                            }
                                        }
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
}

@Composable
private fun SpaceAdminDialog(
    instanceUrl: String,
    jwtToken: String,
    restClient: BackspaceRestClient,
    wsClient: BackspaceWebSocketClient,
    space: Space,
    title: String,
    saveLabel: String,
    cancelLabel: String,
    onDismiss: () -> Unit,
    onSave: (UpdateSpaceAdminRequest) -> Unit,
) {
    val colors = AetherTheme.colors
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var tab by remember { mutableIntStateOf(0) } // 0 = Geral, 1 = Canais, 2 = Cargos/Bans, 3 = Opus
    var name by remember { mutableStateOf(space.name) }
    var description by remember { mutableStateOf(space.description.orEmpty()) }
    var newChannelName by remember { mutableStateOf("") }
    var newChannelType by remember { mutableStateOf("text") }
    var newCategoryName by remember { mutableStateOf("") }
    var newRoleName by remember { mutableStateOf("") }
    var newRoleColor by remember { mutableStateOf("#7C6CF6") }
    var bans by remember { mutableStateOf<List<SpaceBanItem>>(emptyList()) }
    var generatedInvite by remember { mutableStateOf<String?>(null) }
    var actionFeedback by remember { mutableStateOf<String?>(null) }
    var bitrate by remember { mutableStateOf((space.audioBitrateKbps ?: 64).toFloat()) }
    var maxBitrate by remember { mutableStateOf((space.maxAudioBitrateKbps ?: 256).toFloat()) }
    var allowMusic by remember { mutableStateOf(space.allowMusicMode ?: true) }
    var allowStereo by remember { mutableStateOf(space.allowStereoAudio ?: true) }

    LaunchedEffect(tab) {
        if (tab == 2) {
            runCatching { restClient.getBans(instanceUrl, jwtToken, space.id) }
                .onSuccess { bans = it }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.bgChannel,
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("$title · ${space.name}", color = colors.textPrimary, style = MaterialTheme.typography.titleMedium)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    item { FilterChip(selected = tab == 0, onClick = { tab = 0 }, label = { Text("Geral") }) }
                    item { FilterChip(selected = tab == 1, onClick = { tab = 1 }, label = { Text("Canais") }) }
                    item { FilterChip(selected = tab == 2, onClick = { tab = 2 }, label = { Text("Cargos/Bans") }) }
                    item { FilterChip(selected = tab == 3, onClick = { tab = 3 }, label = { Text("Opus") }) }
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!actionFeedback.isNullOrBlank()) {
                    Text(actionFeedback!!, color = colors.accentMint, style = MaterialTheme.typography.bodySmall)
                }
                when (tab) {
                    0 -> {
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it },
                            label = { Text("Nome") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = description,
                            onValueChange = { description = it },
                            label = { Text("Descrição") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    runCatching { restClient.generateSpaceInvite(instanceUrl, jwtToken, space.id) }
                                        .onSuccess { code ->
                                            val link = "${instanceUrl.trimEnd('/')}/invite/$code"
                                            generatedInvite = link
                                            clipboard.setText(AnnotatedString(link))
                                            actionFeedback = "Link copiado: $link"
                                        }
                                        .onFailure { actionFeedback = it.message }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Gerar e copiar link de convite", color = colors.accentSky)
                        }
                        if (!generatedInvite.isNullOrBlank()) {
                            Text(generatedInvite!!, color = colors.textSecondary, style = MaterialTheme.typography.labelSmall)
                        }
                    }

                    1 -> {
                        OutlinedTextField(
                            value = newChannelName,
                            onValueChange = { newChannelName = it },
                            label = { Text("Novo canal") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilterChip(
                                selected = newChannelType == "text",
                                onClick = { newChannelType = "text" },
                                label = { Text("# Texto") },
                            )
                            FilterChip(
                                selected = newChannelType == "voice",
                                onClick = { newChannelType = "voice" },
                                label = { Text("🔊 Voz") },
                            )
                        }
                        AetherPrimaryButton(
                            text = "Criar canal",
                            enabled = newChannelName.isNotBlank(),
                            onClick = {
                                scope.launch {
                                    runCatching {
                                        restClient.createChannel(instanceUrl, jwtToken, space.id, newChannelName.trim(), newChannelType)
                                        wsClient.refreshSpaceDetail(space.id)
                                    }.onSuccess {
                                        newChannelName = ""
                                        actionFeedback = "Canal criado!"
                                    }.onFailure { actionFeedback = it.message }
                                }
                            },
                        )
                        Spacer(Modifier.height(4.dp))
                        OutlinedTextField(
                            value = newCategoryName,
                            onValueChange = { newCategoryName = it },
                            label = { Text("Nova categoria") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedButton(
                            enabled = newCategoryName.isNotBlank(),
                            onClick = {
                                scope.launch {
                                    runCatching {
                                        restClient.createCategory(instanceUrl, jwtToken, space.id, newCategoryName.trim())
                                        wsClient.refreshSpaceDetail(space.id)
                                    }.onSuccess {
                                        newCategoryName = ""
                                        actionFeedback = "Categoria criada!"
                                    }.onFailure { actionFeedback = it.message }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Criar categoria", color = colors.accentPrimary)
                        }
                    }

                    2 -> {
                        OutlinedTextField(
                            value = newRoleName,
                            onValueChange = { newRoleName = it },
                            label = { Text("Novo cargo") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = newRoleColor,
                            onValueChange = { newRoleColor = it },
                            label = { Text("Cor (#RRGGBB)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        AetherPrimaryButton(
                            text = "Criar cargo",
                            enabled = newRoleName.isNotBlank(),
                            onClick = {
                                scope.launch {
                                    runCatching {
                                        restClient.createRole(instanceUrl, jwtToken, space.id, newRoleName.trim(), newRoleColor.trim())
                                        wsClient.refreshSpaceDetail(space.id)
                                    }.onSuccess {
                                        newRoleName = ""
                                        actionFeedback = "Cargo criado!"
                                    }.onFailure { actionFeedback = it.message }
                                }
                            },
                        )
                        Spacer(Modifier.height(6.dp))
                        Text("Banidos (${bans.size})", color = colors.accentPeach, style = MaterialTheme.typography.labelLarge)
                        bans.forEach { ban ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(ban.label, color = colors.textPrimary, style = MaterialTheme.typography.bodySmall)
                                TextButton(
                                    onClick = {
                                        scope.launch {
                                            runCatching {
                                                restClient.unbanMember(instanceUrl, jwtToken, space.id, ban.userId)
                                                bans = bans.filterNot { it.userId == ban.userId }
                                            }
                                        }
                                    },
                                ) {
                                    Text("Desbanir", color = colors.accentMint)
                                }
                            }
                        }
                    }

                    else -> {
                        Text("Opus default: ${bitrate.toInt()} kbps", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
                        AetherPurpleSlider(value = bitrate, onValueChange = { bitrate = it }, valueRange = 8f..512f)
                        Text("Opus max: ${maxBitrate.toInt()} kbps", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
                        AetherPurpleSlider(value = maxBitrate, onValueChange = { maxBitrate = it }, valueRange = 8f..512f)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text("Music mode", color = colors.textPrimary)
                            Switch(checked = allowMusic, onCheckedChange = { allowMusic = it })
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text("Stereo audio", color = colors.textPrimary)
                            Switch(checked = allowStereo, onCheckedChange = { allowStereo = it })
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onSave(
                        UpdateSpaceAdminRequest(
                            name = name.trim().ifBlank { space.name },
                            description = description.trim(),
                            audioBitrateKbps = bitrate.toInt(),
                            maxAudioBitrateKbps = maxBitrate.toInt().coerceAtLeast(bitrate.toInt()),
                            allowMusicMode = allowMusic,
                            allowStereoAudio = allowStereo,
                        ),
                    )
                },
            ) {
                Text(saveLabel, color = colors.accentPrimary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(cancelLabel, color = colors.textSecondary)
            }
        },
    )
}

@Composable
private fun StatusPickerDialog(
    currentStatus: String,
    currentCustomStatus: String,
    title: String,
    onlineLabel: String,
    idleLabel: String,
    dndLabel: String,
    customStatusPlaceholder: String,
    revertTimerLabel: String,
    saveLabel: String,
    cancelLabel: String,
    onDismiss: () -> Unit,
    onSave: (ChosenUserStatus, String, StatusRevertDuration) -> Unit,
) {
    val colors = AetherTheme.colors
    var chosen by remember {
        mutableStateOf(
            when (currentStatus) {
                "idle" -> ChosenUserStatus.IDLE
                "dnd" -> ChosenUserStatus.DND
                else -> ChosenUserStatus.ONLINE
            },
        )
    }
    var customText by remember { mutableStateOf(currentCustomStatus) }
    var revert by remember { mutableStateOf(StatusRevertDuration.NONE) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.bgChannel,
        title = { Text(title, color = colors.textPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(
                        ChosenUserStatus.ONLINE to onlineLabel,
                        ChosenUserStatus.IDLE to idleLabel,
                        ChosenUserStatus.DND to dndLabel,
                    ).forEach { (status, label) ->
                        FilterChip(
                            selected = chosen == status,
                            onClick = { chosen = status },
                            label = { Text(label) },
                        )
                    }
                }

                OutlinedTextField(
                    value = customText,
                    onValueChange = { customText = it },
                    placeholder = { Text(customStatusPlaceholder) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Text(
                    text = revertTimerLabel,
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.textSecondary,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(
                        StatusRevertDuration.NONE to "Off",
                        StatusRevertDuration.FIFTEEN_MIN to "15m",
                        StatusRevertDuration.ONE_HOUR to "1h",
                        StatusRevertDuration.FOUR_HOURS to "4h",
                    ).forEach { (dur, label) ->
                        FilterChip(
                            selected = revert == dur,
                            onClick = { revert = dur },
                            label = { Text(label) },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(chosen, customText, revert) }) {
                Text(saveLabel, color = colors.accentPrimary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(cancelLabel, color = colors.textSecondary)
            }
        },
    )
}
