package com.backspace.android

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Intent
import android.graphics.Color
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.KeyEvent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.backspace.core.designsystem.AetherTheme
import com.backspace.core.designsystem.BackspaceAetherTheme
import com.backspace.core.model.PermissionBits
import com.backspace.core.model.PttHardwareKey
import com.backspace.core.model.TransmissionMode
import com.backspace.core.network.StoredSession
import com.backspace.core.voice.VoiceConnectionStatus
import com.backspace.feature.auth.AuthScreen
import com.backspace.feature.chat.ChatChannelScreen
import com.backspace.feature.dm.DmListScreen
import com.backspace.feature.settings.SettingsScreen
import com.backspace.feature.soundboard.SoundboardScreen
import com.backspace.feature.spaces.SpacesScreen
import com.backspace.feature.voice.GlobalVoiceMiniBar
import com.backspace.feature.voice.VoiceRoomScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val deepLinkUriState = mutableStateOf<Uri?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        deepLinkUriState.value = intent?.data
        val container = (application as BackspaceApplication).container

        setContent {
            BackspaceAetherTheme {
                BackspaceRootApp(
                    container = container,
                    deepLinkUri = deepLinkUriState.value,
                    onConsumeDeepLink = { deepLinkUriState.value = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLinkUriState.value = intent.data
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val voiceState = (application as BackspaceApplication).container.voiceEngine.state.value
            if (voiceState.status == VoiceConnectionStatus.CONNECTED && voiceState.videoTiles.isNotEmpty()) {
                runCatching {
                    val params = PictureInPictureParams.Builder()
                        .setAspectRatio(Rational(16, 9))
                        .build()
                    enterPictureInPictureMode(params)
                }
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (handleHardwarePttKey(keyCode, pressed = true)) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (handleHardwarePttKey(keyCode, pressed = false)) return true
        return super.onKeyUp(keyCode, event)
    }

    private fun handleHardwarePttKey(keyCode: Int, pressed: Boolean): Boolean {
        val voice = (application as BackspaceApplication).container.voiceEngine
        val prefs = voice.state.value.userPrefs
        if (prefs.transmissionMode != TransmissionMode.PUSH_TO_TALK) return false
        val matches = when (prefs.pttHardwareKey) {
            PttHardwareKey.VOLUME_UP -> keyCode == KeyEvent.KEYCODE_VOLUME_UP
            PttHardwareKey.VOLUME_DOWN -> keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
            PttHardwareKey.NONE -> false
        }
        if (!matches) return false
        voice.setPttPressed(pressed)
        return true
    }
}

@Composable
private fun BackspaceRootApp(
    container: AppContainer,
    deepLinkUri: Uri? = null,
    onConsumeDeepLink: () -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val navController = rememberNavController()
    var session by remember { mutableStateOf(container.sessionStorage.load()) }
    var homeTab by rememberSaveable { mutableIntStateOf(0) } // 0 = Mensagens (home), 1 = Grupos, 2 = Configurações
    var pendingOidcTicket by remember { mutableStateOf<String?>(null) }

    val permissionsLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { }

    LaunchedEffect(Unit) {
        val perms = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        permissionsLauncher.launch(perms.toTypedArray())
    }

    LaunchedEffect(session) {
        val active = session
        if (active != null) {
            container.wsClient.connect(active.instanceUrl, active.token)
        }
    }

    LaunchedEffect(deepLinkUri, session) {
        val uri = deepLinkUri ?: return@LaunchedEffect
        if (uri.scheme != "balacopapo") {
            onConsumeDeepLink()
            return@LaunchedEffect
        }
        when (uri.host) {
            "join" -> {
                val code = uri.pathSegments.firstOrNull()?.trim().orEmpty()
                val active = session
                onConsumeDeepLink()
                if (code.isBlank()) return@LaunchedEffect
                if (active != null) {
                    runCatching {
                        container.restClient.joinSpaceByInvite(active.instanceUrl, active.token, code)
                    }.onSuccess { joinedSpace ->
                        homeTab = 1
                        Toast.makeText(
                            context,
                            "Você entrou no grupo ${joinedSpace.name}",
                            Toast.LENGTH_SHORT,
                        ).show()
                    }.onFailure { err ->
                        Toast.makeText(
                            context,
                            err.message ?: "Não foi possível entrar no grupo",
                            Toast.LENGTH_LONG,
                        ).show()
                    }
                } else {
                    Toast.makeText(
                        context,
                        "Faça login para aceitar o convite do grupo.",
                        Toast.LENGTH_LONG,
                    ).show()
                }
            }
            "auth" -> {
                val ticket = uri.getQueryParameter("oidc_ticket")?.trim()
                if (!ticket.isNullOrBlank()) {
                    pendingOidcTicket = ticket
                }
                onConsumeDeepLink()
            }
            else -> {
                onConsumeDeepLink()
            }
        }
    }

    val startDestination = if (session != null) "home" else "auth"
    val updateUpToDateText = stringResource(R.string.updater_up_to_date)
    val rootSnapshot by container.wsClient.snapshot.collectAsStateWithLifecycle()
    val incomingCall = rootSnapshot.incomingCall

    // Tela de Chamada Recebida (Incoming Call) com toque do sistema
    if (incomingCall != null && session != null) {
        val activeSession = session!!
        DisposableEffect(incomingCall.callerId, incomingCall.dmChannelId) {
            val ringtone = runCatching {
                val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                RingtoneManager.getRingtone(context, uri)?.also { it.play() }
            }.getOrNull()
            onDispose {
                runCatching { ringtone?.stop() }
            }
        }
        AlertDialog(
            onDismissRequest = {
                container.wsClient.sendDmCallReject(incomingCall.dmChannelId, incomingCall.federatedCallId)
            },
            containerColor = AetherTheme.colors.bgChannel,
            title = { Text("📞 Chamada recebida", color = AetherTheme.colors.textPrimary) },
            text = {
                Text(
                    text = "${incomingCall.callerName} está te ligando...",
                    color = AetherTheme.colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        container.wsClient.sendDmCallAccept(incomingCall.dmChannelId, incomingCall.federatedCallId)
                        val dmId = incomingCall.dmChannelId
                        if (!dmId.isNullOrBlank()) {
                            container.voiceEngine.joinDmCall(
                                instanceUrl = activeSession.instanceUrl,
                                jwtToken = activeSession.token,
                                dmChannelId = dmId,
                                dmTitle = incomingCall.callerName,
                            )
                            navController.navigate("voice")
                        }
                    },
                ) {
                    Text("Atender", color = AetherTheme.colors.accentMint)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        container.wsClient.sendDmCallReject(incomingCall.dmChannelId, incomingCall.federatedCallId)
                    },
                ) {
                    Text("Recusar", color = AetherTheme.colors.accentPeach)
                }
            },
        )
    }

    NavHost(navController = navController, startDestination = startDestination) {
        composable("auth") {
            AuthScreen(
                restClient = container.restClient,
                sessionStorage = container.sessionStorage,
                title = stringResource(R.string.app_name),
                subtitle = stringResource(R.string.auth_subtitle),
                instanceUrlLabel = stringResource(R.string.auth_instance_url),
                usernameLabel = stringResource(R.string.auth_username),
                passwordLabel = stringResource(R.string.auth_password),
                connectButtonText = stringResource(R.string.auth_connect),
                pendingOidcTicket = pendingOidcTicket,
                onOidcTicketConsumed = { pendingOidcTicket = null },
                onAuthenticated = { url, token ->
                    session = StoredSession(url, token)
                    homeTab = 0
                    navController.navigate("home") {
                        popUpTo("auth") { inclusive = true }
                    }
                },
            )
        }

        composable("home") {
            val active = session ?: return@composable
            val colors = AetherTheme.colors
            val snap by container.wsClient.snapshot.collectAsStateWithLifecycle()
            val voiceState by container.voiceEngine.state.collectAsStateWithLifecycle()
            val myId = snap.currentUser?.id

            Scaffold(
                containerColor = colors.bgBase,
                bottomBar = {
                    Column {
                        GlobalVoiceMiniBar(
                            voiceState = voiceState,
                            onOpenVoiceRoom = { navController.navigate("voice") },
                            onToggleMute = { container.voiceEngine.toggleMute() },
                            onToggleDeafen = { container.voiceEngine.toggleDeafen() },
                            onLeaveCall = { container.voiceEngine.leaveChannel() },
                        )
                        NavigationBar(containerColor = colors.bgChannel) {
                        NavigationBarItem(
                            selected = homeTab == 0,
                            onClick = { homeTab = 0 },
                            icon = {
                                BadgedBox(
                                    badge = {
                                        if (snap.totalUnreadDms > 0) {
                                            Badge(containerColor = colors.accentPeach) {
                                                Text("${snap.totalUnreadDms}")
                                            }
                                        }
                                    },
                                ) {
                                    Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                                }
                            },
                            label = { Text(stringResource(R.string.dm_tab_label)) },
                        )
                        NavigationBarItem(
                            selected = homeTab == 1,
                            onClick = { homeTab = 1 },
                            icon = {
                                BadgedBox(
                                    badge = {
                                        if (snap.totalSpaceMentions > 0) {
                                            Badge(containerColor = colors.accentPeach) {
                                                Text("${snap.totalSpaceMentions}")
                                            }
                                        }
                                    },
                                ) {
                                    Icon(Icons.Default.Hub, contentDescription = null)
                                }
                            },
                            label = { Text(stringResource(R.string.spaces_title)) },
                        )
                        NavigationBarItem(
                            selected = homeTab == 2,
                            onClick = { homeTab = 2 },
                            icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                            label = { Text(stringResource(R.string.settings_title)) },
                        )
                    }
                    }
                },
            ) { innerPadding ->
                val tabModifier = Modifier.padding(innerPadding)

                when (homeTab) {
                    0 -> DmListScreen(
                        instanceUrl = active.instanceUrl,
                        jwtToken = active.token,
                        restClient = container.restClient,
                        wsClient = container.wsClient,
                        title = stringResource(R.string.dm_title),
                        conversationsTabLabel = stringResource(R.string.dm_tab_conversations),
                        friendsTabLabel = stringResource(R.string.dm_tab_friends),
                        addFriendPlaceholder = stringResource(R.string.friends_add_placeholder),
                        pendingRequestsHeader = stringResource(R.string.friends_pending_requests),
                        emptyText = stringResource(R.string.dm_empty),
                        groupBadge = stringResource(R.string.dm_group_badge),
                        onOpenDm = { dm ->
                            val encoded = Uri.encode(dm.displayTitle(myId))
                            navController.navigate("dm/${dm.id}/$encoded")
                        },
                        modifier = tabModifier,
                    )

                    1 -> SpacesScreen(
                        instanceUrl = active.instanceUrl,
                        jwtToken = active.token,
                        restClient = container.restClient,
                        wsClient = container.wsClient,
                        voiceEngine = container.voiceEngine,
                        spacesTitle = stringResource(R.string.spaces_title),
                        noSpacesText = stringResource(R.string.spaces_empty),
                        activeVoiceBannerPrefix = stringResource(R.string.voice_connected_banner),
                        statusPickerTitle = stringResource(R.string.status_picker_title),
                        statusOnlineLabel = stringResource(R.string.status_online),
                        statusIdleLabel = stringResource(R.string.status_idle),
                        statusDndLabel = stringResource(R.string.status_dnd),
                        customStatusPlaceholder = stringResource(R.string.status_custom_placeholder),
                        revertTimerLabel = stringResource(R.string.status_revert_timer),
                        membersTitle = stringResource(R.string.spaces_members_title),
                        sendDmLabel = stringResource(R.string.dm_send_message),
                        spaceAdminTitle = stringResource(R.string.space_admin_title),
                        saveLabel = stringResource(R.string.common_save),
                        cancelLabel = stringResource(R.string.common_cancel),
                        onOpenDirectDm = { dmId, dmTitle ->
                            val encoded = Uri.encode(dmTitle)
                            navController.navigate("dm/$dmId/$encoded")
                        },
                        onOpenTextChannel = { channel ->
                            val encodedName = Uri.encode(channel.name)
                            navController.navigate("chat/${channel.id}/$encodedName")
                        },
                        onJoinVoiceChannel = { space, category, channel ->
                            container.voiceEngine.joinChannel(
                                instanceUrl = active.instanceUrl,
                                jwtToken = active.token,
                                space = space,
                                category = category,
                                channel = channel,
                            )
                            navController.navigate("voice")
                        },
                        onOpenActiveVoice = { navController.navigate("voice") },
                        showVoiceBanner = false,
                        modifier = tabModifier,
                    )

                    else -> SettingsScreen(
                        instanceUrl = active.instanceUrl,
                        jwtToken = active.token,
                        appVersion = BuildConfig.VERSION_NAME,
                        repoSlug = stringResource(R.string.updater_repo_slug),
                        restClient = container.restClient,
                        wsClient = container.wsClient,
                        voiceEngine = container.voiceEngine,
                        updater = container.releaseUpdater,
                        title = stringResource(R.string.settings_title),
                        logoutLabel = stringResource(R.string.settings_logout),
                        onTokenUpdated = { newToken ->
                            container.sessionStorage.save(active.instanceUrl, newToken)
                            session = StoredSession(active.instanceUrl, newToken)
                        },
                        onLogout = {
                            container.voiceEngine.leaveChannel()
                            container.wsClient.disconnect()
                            container.sessionStorage.clear()
                            session = null
                            navController.navigate("auth") {
                                popUpTo("home") { inclusive = true }
                            }
                        },
                        modifier = tabModifier,
                    )
                }
            }
        }

        composable(
            route = "dm/{dmId}/{dmTitle}",
            arguments = listOf(
                navArgument("dmId") { type = NavType.StringType },
                navArgument("dmTitle") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val active = session ?: return@composable
            val dmId = backStackEntry.arguments?.getString("dmId").orEmpty()
            val dmTitle = Uri.decode(backStackEntry.arguments?.getString("dmTitle").orEmpty())
            ChatChannelScreen(
                instanceUrl = active.instanceUrl,
                jwtToken = active.token,
                channelId = dmId,
                channelName = dmTitle,
                restClient = container.restClient,
                wsClient = container.wsClient,
                messagePlaceholder = stringResource(R.string.chat_message_placeholder),
                emptyChatText = stringResource(R.string.chat_empty),
                queuedLabel = stringResource(R.string.chat_queued_offline),
                replyingToPrefix = stringResource(R.string.chat_replying_to),
                replyActionLabel = stringResource(R.string.chat_action_reply),
                deleteActionLabel = stringResource(R.string.chat_action_delete),
                isDm = true,
                callConfirmTitle = stringResource(R.string.dm_call_confirm_title),
                callConfirmAction = stringResource(R.string.dm_call_confirm_action),
                cancelLabel = stringResource(R.string.common_cancel),
                onStartCall = {
                    container.voiceEngine.joinDmCall(
                        instanceUrl = active.instanceUrl,
                        jwtToken = active.token,
                        dmChannelId = dmId,
                        dmTitle = dmTitle,
                    )
                    navController.navigate("voice")
                },
                onOpenDm = { targetDmId, targetDmTitle ->
                    val encoded = Uri.encode(targetDmTitle)
                    navController.navigate("dm/$targetDmId/$encoded")
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = "chat/{channelId}/{channelName}",
            arguments = listOf(
                navArgument("channelId") { type = NavType.StringType },
                navArgument("channelName") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val active = session ?: return@composable
            val channelId = backStackEntry.arguments?.getString("channelId").orEmpty()
            val channelName = Uri.decode(backStackEntry.arguments?.getString("channelName").orEmpty())
            ChatChannelScreen(
                instanceUrl = active.instanceUrl,
                jwtToken = active.token,
                channelId = channelId,
                channelName = channelName,
                restClient = container.restClient,
                wsClient = container.wsClient,
                messagePlaceholder = stringResource(R.string.chat_message_placeholder),
                emptyChatText = stringResource(R.string.chat_empty),
                queuedLabel = stringResource(R.string.chat_queued_offline),
                replyingToPrefix = stringResource(R.string.chat_replying_to),
                replyActionLabel = stringResource(R.string.chat_action_reply),
                deleteActionLabel = stringResource(R.string.chat_action_delete),
                onOpenDm = { targetDmId, targetDmTitle ->
                    val encoded = Uri.encode(targetDmTitle)
                    navController.navigate("dm/$targetDmId/$encoded")
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable("voice") {
            val activeSession = session
            val voiceStateNow = container.voiceEngine.state.value
            val activeSpaceId = voiceStateNow.spaceId
            val activeChannelId = voiceStateNow.channelId
            val activeChannelName = voiceStateNow.channelName
            val activeSpace = container.wsClient.snapshot.value.spaces.firstOrNull { it.id == activeSpaceId }
            val canMod = activeSpace != null && (
                PermissionBits.hasPermission(activeSpace.myPermissions, PermissionBits.MUTE_MEMBERS) ||
                    PermissionBits.hasPermission(activeSpace.myPermissions, PermissionBits.DEAFEN_MEMBERS) ||
                    PermissionBits.hasPermission(activeSpace.myPermissions, PermissionBits.DISCONNECT_MEMBERS)
                )
            val msgPlaceholder = stringResource(R.string.chat_message_placeholder)
            val emptyChat = stringResource(R.string.chat_empty)
            val queuedLbl = stringResource(R.string.chat_queued_offline)
            val replyPrefix = stringResource(R.string.chat_replying_to)
            val replyAct = stringResource(R.string.chat_action_reply)
            val deleteAct = stringResource(R.string.chat_action_delete)
            VoiceRoomScreen(
                voiceEngine = container.voiceEngine,
                opusTitle = stringResource(R.string.voice_opus_title),
                telemetryTitle = stringResource(R.string.voice_telemetry_title),
                voiceModeLabel = stringResource(R.string.voice_mode_voice),
                musicModeLabel = stringResource(R.string.voice_mode_music),
                stereoLabel = stringResource(R.string.voice_stereo),
                autoBitrateLabel = stringResource(R.string.voice_bitrate_auto),
                idleSuspendLabel = stringResource(R.string.voice_idle_suspend),
                hideNonVideoLabel = stringResource(R.string.voice_hide_non_video),
                screenShareBadge = stringResource(R.string.voice_screen_share_badge),
                userVolumeLabel = stringResource(R.string.voice_user_volume),
                localMuteLabel = stringResource(R.string.voice_local_mute),
                spaceMuteLabel = stringResource(R.string.voice_space_mute),
                spaceDeafenLabel = stringResource(R.string.voice_space_deafen),
                disconnectUserLabel = stringResource(R.string.voice_disconnect_user),
                canModerateVoice = canMod,
                onOpenSoundboard = activeSpaceId?.let { spaceId ->
                    { navController.navigate("soundboard/$spaceId") }
                },
                chatSheetContent = if (activeSession != null && !activeChannelId.isNullOrBlank()) {
                    { onClose ->
                        ChatChannelScreen(
                            instanceUrl = activeSession.instanceUrl,
                            jwtToken = activeSession.token,
                            channelId = activeChannelId,
                            channelName = activeChannelName.ifBlank { "Chat" },
                            restClient = container.restClient,
                            wsClient = container.wsClient,
                            messagePlaceholder = msgPlaceholder,
                            emptyChatText = emptyChat,
                            queuedLabel = queuedLbl,
                            replyingToPrefix = replyPrefix,
                            replyActionLabel = replyAct,
                            deleteActionLabel = deleteAct,
                            isDm = activeSpaceId == null,
                            onBack = onClose,
                        )
                    }
                } else {
                    null
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = "soundboard/{spaceId}",
            arguments = listOf(navArgument("spaceId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val active = session ?: return@composable
            val spaceId = backStackEntry.arguments?.getString("spaceId").orEmpty()
            SoundboardScreen(
                instanceUrl = active.instanceUrl,
                jwtToken = active.token,
                spaceId = spaceId,
                restClient = container.restClient,
                voiceEngine = container.voiceEngine,
                title = stringResource(R.string.soundboard_title),
                searchPlaceholder = stringResource(R.string.soundboard_search),
                volumeLabel = stringResource(R.string.soundboard_volume),
                emptyText = stringResource(R.string.soundboard_empty),
                onBack = { navController.popBackStack() },
            )
        }
    }
}
