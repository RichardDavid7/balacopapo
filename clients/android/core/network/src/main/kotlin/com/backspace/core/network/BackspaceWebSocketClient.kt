package com.backspace.core.network

import com.backspace.core.model.Channel
import com.backspace.core.model.ChannelCategory
import com.backspace.core.model.ChosenUserStatus
import com.backspace.core.model.DmChannel
import com.backspace.core.model.DmMessage
import com.backspace.core.model.IncomingCallEvent
import com.backspace.core.model.InstanceStreamingLimits
import com.backspace.core.model.Message
import com.backspace.core.model.MessageReaction
import com.backspace.core.model.PendingAttachmentPayload
import com.backspace.core.model.QueuedOutgoingMessage
import com.backspace.core.model.Space
import com.backspace.core.model.SpaceVoiceState
import com.backspace.core.model.StatusRevertDuration
import com.backspace.core.model.User
import com.backspace.core.model.VoiceUserState
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

enum class WsConnectionState {
    DISCONNECTED,
    CONNECTING,
    AUTHENTICATED,
    RECONNECTING,
}

data class RealtimeSnapshot(
    val connectionState: WsConnectionState = WsConnectionState.DISCONNECTED,
    val currentUser: User? = null,
    val spaces: List<Space> = emptyList(),
    val dmChannels: List<DmChannel> = emptyList(),
    val streamingLimits: InstanceStreamingLimits = InstanceStreamingLimits(),
    val voiceStates: Map<String, List<String>> = emptyMap(),
    val voiceUserStates: Map<String, VoiceUserState> = emptyMap(),
    val spaceVoiceStates: Map<String, SpaceVoiceState> = emptyMap(),
    val messagesByChannel: Map<String, List<Message>> = emptyMap(),
    val typingByChannel: Map<String, Set<String>> = emptyMap(),
    val unreadDmCounts: Map<String, Int> = emptyMap(),
    val channelMentionCounts: Map<String, Int> = emptyMap(),
    val queuedMessages: List<QueuedOutgoingMessage> = emptyList(),
    val incomingCall: IncomingCallEvent? = null,
    val lastError: String? = null,
) {
    val totalUnreadDms: Int get() = unreadDmCounts.values.sum()
    val totalSpaceMentions: Int get() = channelMentionCounts.values.sum()

    fun mentionsForSpace(space: Space): Int =
        space.channels.sumOf { ch -> channelMentionCounts[ch.id] ?: 0 }
}

class BackspaceWebSocketClient(
    private val restClient: BackspaceRestClient,
    private val okHttpClient: OkHttpClient = restClient.okHttpClient,
    private val json: Json = restClient.json,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _snapshot = MutableStateFlow(RealtimeSnapshot())
    val snapshot: StateFlow<RealtimeSnapshot> = _snapshot.asStateFlow()

    @Volatile private var webSocket: WebSocket? = null
    @Volatile private var activeInstanceUrl: String? = null
    @Volatile private var activeToken: String? = null
    @Volatile private var activeOpenChannelId: String? = null
    @Volatile private var shouldReconnect: Boolean = false
    private var heartbeatJob: Job? = null
    private var reconnectJob: Job? = null
    private var statusRevertJob: Job? = null
    private var reconnectAttempt = 0

    fun connect(instanceUrl: String, token: String) {
        val normalized = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        activeInstanceUrl = normalized
        activeToken = token
        shouldReconnect = true
        reconnectAttempt = 0
        openSocket(normalized, token)

        // Carrega limites Opus/Soundboard da instância em paralelo
        scope.launch {
            runCatching { restClient.getStreamingLimits(normalized, token) }
                .onSuccess { limits ->
                    _snapshot.update { it.copy(streamingLimits = limits) }
                }
        }
    }

    fun disconnect() {
        shouldReconnect = false
        heartbeatJob?.cancel()
        reconnectJob?.cancel()
        webSocket?.close(1000, "client_disconnect")
        webSocket = null
        _snapshot.value = RealtimeSnapshot(connectionState = WsConnectionState.DISCONNECTED)
    }

    fun sendVoiceJoin(channelId: String) {
        sendJson(
            buildJsonObject {
                put("type", "voice_join")
                put("channelId", channelId)
            },
        )
    }

    fun sendVoiceLeave() {
        sendJson(buildJsonObject { put("type", "voice_leave") })
    }

    fun sendVoiceStatus(
        isMuted: Boolean,
        isDeafened: Boolean,
        isCameraOn: Boolean = false,
        isScreenSharing: Boolean = false,
    ) {
        sendJson(
            buildJsonObject {
                put("type", "voice_status")
                put("isMuted", isMuted)
                put("isDeafened", isDeafened)
                put("isCameraOn", isCameraOn)
                put("isScreenSharing", isScreenSharing)
            },
        )
    }

    fun sendPresenceUpdate(status: String) {
        sendJson(
            buildJsonObject {
                put("type", "presence_update")
                put("status", status)
            },
        )
    }

    fun sendVoiceSpaceMute(spaceId: String, targetUserId: String, muted: Boolean) {
        sendJson(
            buildJsonObject {
                put("type", "voice_space_mute")
                put("spaceId", spaceId)
                put("targetUserId", targetUserId)
                put("muted", muted)
            },
        )
    }

    fun sendVoiceSpaceDeafen(spaceId: String, targetUserId: String, deafened: Boolean) {
        sendJson(
            buildJsonObject {
                put("type", "voice_space_deafen")
                put("spaceId", spaceId)
                put("targetUserId", targetUserId)
                put("deafened", deafened)
            },
        )
    }

    fun sendVoiceDisconnect(spaceId: String, targetUserId: String) {
        sendJson(
            buildJsonObject {
                put("type", "voice_disconnect")
                put("spaceId", spaceId)
                put("targetUserId", targetUserId)
            },
        )
    }

    /**
     * Atualiza status e opcionalmente agenda reversão automática para o status anterior.
     */
    fun setStatusWithOptionalRevert(
        status: ChosenUserStatus,
        customStatus: String?,
        revertDuration: StatusRevertDuration,
    ) {
        val url = activeInstanceUrl ?: return
        val token = activeToken ?: return
        val previousStatus = _snapshot.value.currentUser?.status ?: ChosenUserStatus.ONLINE.wireValue

        statusRevertJob?.cancel()
        sendPresenceUpdate(status.wireValue)

        scope.launch {
            runCatching {
                restClient.updateMyStatus(
                    instanceUrl = url,
                    token = token,
                    status = status.wireValue,
                    customStatus = customStatus,
                )
            }.onSuccess { updatedUser ->
                _snapshot.update { it.copy(currentUser = updatedUser) }
            }
        }

        val minutes = revertDuration.minutes
        if (minutes != null && minutes > 0) {
            statusRevertJob = scope.launch {
                delay(minutes * 60_000L)
                sendPresenceUpdate(previousStatus)
                runCatching {
                    restClient.updateMyStatus(
                        instanceUrl = url,
                        token = token,
                        status = previousStatus,
                    )
                }.onSuccess { reverted ->
                    _snapshot.update { it.copy(currentUser = reverted) }
                }
            }
        }
    }

    fun mergeChannelHistory(channelId: String, history: List<Message>) {
        _snapshot.update { current ->
            val existing = current.messagesByChannel[channelId].orEmpty()
            val merged = (history + existing)
                .distinctBy { it.id }
                .sortedBy { it.createdAt }
            current.copy(messagesByChannel = current.messagesByChannel + (channelId to merged))
        }
    }

    fun appendLocalMessage(channelId: String, message: Message) {
        _snapshot.update { current ->
            val existing = current.messagesByChannel[channelId].orEmpty()
            if (existing.any { it.id == message.id }) return@update current
            current.copy(messagesByChannel = current.messagesByChannel + (channelId to (existing + message)))
        }
    }

    fun setActiveOpenChannel(channelId: String?) {
        activeOpenChannelId = channelId
        if (channelId != null) {
            _snapshot.update { cur ->
                cur.copy(
                    unreadDmCounts = cur.unreadDmCounts - channelId,
                    channelMentionCounts = cur.channelMentionCounts - channelId,
                )
            }
        }
    }

    fun sendChannelAck(channelId: String) {
        sendJson(
            buildJsonObject {
                put("type", "channel_ack")
                put("channelId", channelId)
            },
        )
    }

    fun sendTypingStart(channelId: String) {
        sendJson(
            buildJsonObject {
                put("type", "typing_start")
                put("channelId", channelId)
            },
        )
    }

    fun updateLocalMessage(channelId: String, updated: Message) {
        _snapshot.update { current ->
            val list = current.messagesByChannel[channelId] ?: return@update current
            current.copy(
                messagesByChannel = current.messagesByChannel + (
                    channelId to list.map { if (it.id == updated.id) updated else it }
                ),
            )
        }
    }

    fun sendReactionAdd(messageId: String, emoji: String) {
        sendJson(
            buildJsonObject {
                put("type", "reaction_add")
                put("messageId", messageId)
                put("emoji", emoji)
            },
        )
    }

    fun sendReactionRemove(messageId: String, emoji: String) {
        sendJson(
            buildJsonObject {
                put("type", "reaction_remove")
                put("messageId", messageId)
                put("emoji", emoji)
            },
        )
    }

    fun removeLocalMessage(channelId: String, messageId: String) {
        _snapshot.update { current ->
            val list = current.messagesByChannel[channelId] ?: return@update current
            current.copy(
                messagesByChannel = current.messagesByChannel + (
                    channelId to list.filterNot { it.id == messageId }
                ),
            )
        }
    }

    /**
     * Envia mensagem (com eventuais anexos) imediatamente se online, ou coloca na fila offline
     * e envia automaticamente assim que reconectar.
     */
    fun updateCurrentUserLocal(user: User) {
        _snapshot.update { it.copy(currentUser = user) }
    }

    fun enqueueOrSendMessage(
        channelId: String,
        content: String?,
        replyToId: String? = null,
        attachments: List<PendingAttachmentPayload> = emptyList(),
        isDm: Boolean = false,
    ) {
        val queued = QueuedOutgoingMessage(
            localId = UUID.randomUUID().toString(),
            channelId = channelId,
            isDm = isDm,
            content = content?.trim()?.ifBlank { null },
            replyToId = replyToId,
            attachments = attachments,
        )
        if (queued.content == null && queued.attachments.isEmpty()) return

        _snapshot.update { it.copy(queuedMessages = it.queuedMessages + queued) }
        if (_snapshot.value.connectionState == WsConnectionState.AUTHENTICATED) {
            flushMessageQueue()
        }
    }

    fun flushMessageQueue() {
        val url = activeInstanceUrl ?: return
        val token = activeToken ?: return
        scope.launch {
            while (true) {
                val next = _snapshot.value.queuedMessages.firstOrNull() ?: break
                val result = runCatching {
                    val uploadedIds = next.attachments.map { att ->
                        restClient.uploadFileTus(
                            instanceUrl = url,
                            token = token,
                            originalName = att.fileName,
                            mimeType = att.mimeType,
                            bytes = att.bytes,
                        ).id
                    }
                    if (next.isDm) {
                        restClient.sendDmMessage(
                            instanceUrl = url,
                            token = token,
                            dmChannelId = next.channelId,
                            content = next.content,
                            attachmentIds = uploadedIds,
                            replyToId = next.replyToId,
                        ).toChannelMessage()
                    } else {
                        restClient.sendMessage(
                            instanceUrl = url,
                            token = token,
                            channelId = next.channelId,
                            content = next.content,
                            attachmentIds = uploadedIds,
                            replyToId = next.replyToId,
                        )
                    }
                }
                val sent = result.getOrNull()
                if (sent != null) {
                    appendLocalMessage(next.channelId, sent)
                    _snapshot.update { cur ->
                        cur.copy(queuedMessages = cur.queuedMessages.filterNot { it.localId == next.localId })
                    }
                } else {
                    val err = result.exceptionOrNull()
                    // Erro HTTP 4xx (ex.: permissão) remove da fila; erro de rede mantém na fila para retry
                    if (err is BackspaceApiException && err.statusCode in 400..499) {
                        _snapshot.update { cur ->
                            cur.copy(
                                queuedMessages = cur.queuedMessages.filterNot { it.localId == next.localId },
                                lastError = err.message,
                            )
                        }
                    } else {
                        _snapshot.update { it.copy(lastError = err?.message) }
                        break
                    }
                }
            }
        }
    }

    private fun openSocket(instanceUrl: String, token: String) {
        webSocket?.cancel()
        heartbeatJob?.cancel()

        val wsUrl = instanceUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://") + "/ws"

        _snapshot.update {
            it.copy(
                connectionState = if (reconnectAttempt == 0) {
                    WsConnectionState.CONNECTING
                } else {
                    WsConnectionState.RECONNECTING
                },
                lastError = null,
            )
        }

        val request = Request.Builder().url(wsUrl).build()
        webSocket = okHttpClient.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    // Handshake obrigatório em até 10s
                    val authFrame = buildJsonObject {
                        put("type", "auth")
                        put("token", token)
                        put("client", "mobile")
                    }
                    ws.send(authFrame.toString())
                    startHeartbeat()
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    handleIncomingMessage(text)
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    heartbeatJob?.cancel()
                    _snapshot.update {
                        it.copy(
                            connectionState = WsConnectionState.RECONNECTING,
                            lastError = t.message,
                        )
                    }
                    scheduleReconnect()
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    heartbeatJob?.cancel()
                    if (shouldReconnect && code != 1000) {
                        scheduleReconnect()
                    } else {
                        _snapshot.update { it.copy(connectionState = WsConnectionState.DISCONNECTED) }
                    }
                }
            },
        )
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(15_000L)
                sendJson(buildJsonObject { put("type", "ping") })
            }
        }
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        val url = activeInstanceUrl ?: return
        val token = activeToken ?: return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val backoffMs = (1_000L shl reconnectAttempt.coerceAtMost(4)).coerceAtMost(15_000L)
            reconnectAttempt++
            delay(backoffMs)
            if (shouldReconnect) {
                openSocket(url, token)
            }
        }
    }

    private fun sendJson(payload: JsonObject) {
        webSocket?.send(payload.toString())
    }

    private fun handleIncomingMessage(raw: String) {
        val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        val type = obj["type"]?.jsonPrimitive?.contentOrNull ?: return

        when (type) {
            "ready" -> handleReady(obj)
            "pong" -> Unit
            "error" -> {
                val message = obj["message"]?.jsonPrimitive?.contentOrNull ?: "WebSocket error"
                _snapshot.update { it.copy(lastError = message) }
            }
            "voice_state_update" -> handleVoiceStateUpdate(obj)
            "voice_status_update" -> handleVoiceStatusUpdate(obj)
            "space_voice_state" -> handleSpaceVoiceState(obj)
            "space_updated" -> handleSpaceUpdated(obj)
            "category_updated" -> handleCategoryUpdated(obj)
            "channel_updated" -> handleChannelUpdated(obj)
            "presence_update" -> handlePresenceUpdate(obj)
            "message_create", "message_created" -> handleMessageCreate(obj)
            "message_edit", "message_updated" -> handleMessageEdit(obj)
            "message_delete", "message_deleted" -> handleMessageDelete(obj)
            "dm_message_created" -> handleDmMessageCreated(obj)
            "dm_message_deleted" -> handleDmMessageDeleted(obj)
            "typing_start" -> handleTypingStart(obj)
            "reaction_added" -> handleReactionAdded(obj)
            "reaction_removed" -> handleReactionRemoved(obj)
            "user_updated" -> handleUserUpdated(obj)
            "dm_call_incoming" -> handleDmCallIncoming(obj)
            "dm_call_accepted", "dm_call_rejected", "dm_call_ended" -> {
                _snapshot.update { it.copy(incomingCall = null) }
            }
        }
    }

    fun sendDmCallAccept(dmChannelId: String?, federatedCallId: String? = null) {
        sendJson(
            buildJsonObject {
                put("type", "dm_call_accept")
                if (dmChannelId != null) put("dmChannelId", dmChannelId)
                if (federatedCallId != null) put("federatedCallId", federatedCallId)
            },
        )
        _snapshot.update { it.copy(incomingCall = null) }
    }

    fun sendDmCallReject(dmChannelId: String?, federatedCallId: String? = null) {
        sendJson(
            buildJsonObject {
                put("type", "dm_call_reject")
                if (dmChannelId != null) put("dmChannelId", dmChannelId)
                if (federatedCallId != null) put("federatedCallId", federatedCallId)
            },
        )
        _snapshot.update { it.copy(incomingCall = null) }
    }

    fun clearIncomingCall() {
        _snapshot.update { it.copy(incomingCall = null) }
    }

    private fun handleDmCallIncoming(obj: JsonObject) {
        val callerId = obj["callerId"]?.jsonPrimitive?.contentOrNull ?: return
        val callerName = obj["callerName"]?.jsonPrimitive?.contentOrNull ?: "Chamada"
        val dmChannelId = obj["dmChannelId"]?.jsonPrimitive?.contentOrNull
        val federatedCallId = obj["federatedCallId"]?.jsonPrimitive?.contentOrNull
        _snapshot.update {
            it.copy(
                incomingCall = IncomingCallEvent(
                    dmChannelId = dmChannelId,
                    federatedCallId = federatedCallId,
                    callerId = callerId,
                    callerName = callerName,
                ),
            )
        }
    }

    private fun handleReady(obj: JsonObject) {
        reconnectAttempt = 0
        val user = obj["user"]?.let { runCatching { json.decodeFromJsonElement<User>(it) }.getOrNull() }
        val spaces = obj["spaces"]?.let { runCatching { json.decodeFromJsonElement<List<Space>>(it) }.getOrNull() }
            ?: emptyList()
        val dmChannels = obj["dmChannels"]?.let {
            runCatching { json.decodeFromJsonElement<List<DmChannel>>(it) }.getOrNull()
        } ?: emptyList()
        val voiceStates = obj["voiceStates"]?.let {
            runCatching { json.decodeFromJsonElement<Map<String, List<String>>>(it) }.getOrNull()
        } ?: emptyMap()
        val voiceUserStates = obj["voiceUserStates"]?.let {
            runCatching { json.decodeFromJsonElement<Map<String, VoiceUserState>>(it) }.getOrNull()
        } ?: emptyMap()
        val spaceVoiceStates = obj["spaceVoiceStates"]?.let {
            runCatching { json.decodeFromJsonElement<Map<String, SpaceVoiceState>>(it) }.getOrNull()
        } ?: emptyMap()
        val rawUnread = obj["unreadCounts"]?.let {
            runCatching { json.decodeFromJsonElement<Map<String, Int>>(it) }.getOrNull()
        } ?: emptyMap()
        val dmIdSet = dmChannels.map { it.id }.toSet()
        val initialDmUnread = rawUnread.filterKeys { it in dmIdSet }.filterValues { it > 0 }

        _snapshot.update {
            it.copy(
                connectionState = WsConnectionState.AUTHENTICATED,
                currentUser = user,
                spaces = spaces,
                dmChannels = dmChannels,
                voiceStates = voiceStates,
                voiceUserStates = voiceUserStates,
                spaceVoiceStates = spaceVoiceStates,
                unreadDmCounts = initialDmUnread,
                lastError = null,
            )
        }
        if (_snapshot.value.queuedMessages.isNotEmpty()) {
            flushMessageQueue()
        }
    }

    private fun handleVoiceStateUpdate(obj: JsonObject) {
        val channelId = obj["channelId"]?.jsonPrimitive?.contentOrNull ?: return
        val userId = obj["userId"]?.jsonPrimitive?.contentOrNull ?: return
        val action = obj["action"]?.jsonPrimitive?.contentOrNull ?: return

        _snapshot.update { current ->
            val updated = current.voiceStates.toMutableMap()
            val list = updated[channelId].orEmpty().toMutableList()
            when (action) {
                "join" -> if (!list.contains(userId)) list.add(userId)
                "leave" -> list.remove(userId)
            }
            if (list.isEmpty()) updated.remove(channelId) else updated[channelId] = list
            current.copy(voiceStates = updated)
        }
    }

    private fun handleVoiceStatusUpdate(obj: JsonObject) {
        val userId = obj["userId"]?.jsonPrimitive?.contentOrNull ?: return
        val state = VoiceUserState(
            isMuted = obj["isMuted"]?.jsonPrimitive?.booleanOrNull ?: false,
            isDeafened = obj["isDeafened"]?.jsonPrimitive?.booleanOrNull ?: false,
            isCameraOn = obj["isCameraOn"]?.jsonPrimitive?.booleanOrNull ?: false,
            isScreenSharing = obj["isScreenSharing"]?.jsonPrimitive?.booleanOrNull ?: false,
        )
        _snapshot.update { current ->
            current.copy(voiceUserStates = current.voiceUserStates + (userId to state))
        }
    }

    private fun handleSpaceVoiceState(obj: JsonObject) {
        val voiceStates = obj["voiceStates"]?.let {
            runCatching { json.decodeFromJsonElement<Map<String, List<String>>>(it) }.getOrNull()
        } ?: emptyMap()
        val voiceUserStates = obj["voiceUserStates"]?.let {
            runCatching { json.decodeFromJsonElement<Map<String, VoiceUserState>>(it) }.getOrNull()
        } ?: emptyMap()
        val spaceVoiceStates = obj["spaceVoiceStates"]?.let {
            runCatching { json.decodeFromJsonElement<Map<String, SpaceVoiceState>>(it) }.getOrNull()
        } ?: emptyMap()

        _snapshot.update { current ->
            current.copy(
                voiceStates = current.voiceStates + voiceStates,
                voiceUserStates = current.voiceUserStates + voiceUserStates,
                spaceVoiceStates = current.spaceVoiceStates + spaceVoiceStates,
            )
        }
    }

    private fun handleSpaceUpdated(obj: JsonObject) {
        val spaceElem = obj["space"] ?: return
        val updatedSpace = runCatching { json.decodeFromJsonElement<Space>(spaceElem) }.getOrNull() ?: return
        _snapshot.update { current ->
            current.copy(
                spaces = current.spaces.map { existing ->
                    if (existing.id == updatedSpace.id) {
                        existing.copy(
                            name = updatedSpace.name,
                            icon = updatedSpace.icon,
                            description = updatedSpace.description,
                            audioBitrateKbps = updatedSpace.audioBitrateKbps,
                            maxAudioBitrateKbps = updatedSpace.maxAudioBitrateKbps,
                            allowMusicMode = updatedSpace.allowMusicMode,
                            allowStereoAudio = updatedSpace.allowStereoAudio,
                        )
                    } else {
                        existing
                    }
                },
            )
        }
    }

    private fun handleCategoryUpdated(obj: JsonObject) {
        val catElem = obj["category"] ?: return
        val updatedCat = runCatching { json.decodeFromJsonElement<ChannelCategory>(catElem) }.getOrNull() ?: return
        _snapshot.update { current ->
            current.copy(
                spaces = current.spaces.map { space ->
                    if (space.categories.any { it.id == updatedCat.id }) {
                        space.copy(
                            categories = space.categories.map { if (it.id == updatedCat.id) updatedCat else it },
                        )
                    } else {
                        space
                    }
                },
            )
        }
    }

    private fun handleChannelUpdated(obj: JsonObject) {
        val chElem = obj["channel"] ?: return
        val updatedCh = runCatching { json.decodeFromJsonElement<Channel>(chElem) }.getOrNull() ?: return
        _snapshot.update { current ->
            current.copy(
                spaces = current.spaces.map { space ->
                    if (space.channels.any { it.id == updatedCh.id }) {
                        space.copy(
                            channels = space.channels.map { if (it.id == updatedCh.id) updatedCh else it },
                        )
                    } else {
                        space
                    }
                },
            )
        }
    }

    private fun handlePresenceUpdate(obj: JsonObject) {
        val userId = obj["userId"]?.jsonPrimitive?.contentOrNull ?: return
        val status = obj["status"]?.jsonPrimitive?.contentOrNull ?: return
        _snapshot.update { current ->
            val updatedMe = current.currentUser?.let { me ->
                if (me.id == userId) me.copy(status = status) else me
            }
            val updatedSpaces = current.spaces.map { space ->
                space.copy(
                    members = space.members.map { member ->
                        val memberUser = member.user
                        if (member.userId == userId && memberUser != null) {
                            member.copy(user = memberUser.copy(status = status))
                        } else {
                            member
                        }
                    },
                )
            }
            current.copy(currentUser = updatedMe, spaces = updatedSpaces)
        }
    }

    private fun handleMessageCreate(obj: JsonObject) {
        val msgElem = obj["message"] ?: return
        val msg = runCatching { json.decodeFromJsonElement<Message>(msgElem) }.getOrNull() ?: return
        appendLocalMessage(msg.channelId, msg)

        val me = _snapshot.value.currentUser
        if (me != null && msg.userId != me.id && activeOpenChannelId != msg.channelId) {
            val content = msg.safeContent
            val isMentioned = msg.mentionEveryone ||
                content.contains("@${me.username}", ignoreCase = true) ||
                content.contains("@everyone", ignoreCase = true) ||
                content.contains("@here", ignoreCase = true)
            if (isMentioned) {
                _snapshot.update { cur ->
                    val prev = cur.channelMentionCounts[msg.channelId] ?: 0
                    cur.copy(channelMentionCounts = cur.channelMentionCounts + (msg.channelId to (prev + 1)))
                }
            }
        }
    }

    private fun handleMessageEdit(obj: JsonObject) {
        val msgElem = obj["message"] ?: return
        val updated = runCatching { json.decodeFromJsonElement<Message>(msgElem) }.getOrNull() ?: return
        _snapshot.update { current ->
            val list = current.messagesByChannel[updated.channelId] ?: return@update current
            current.copy(
                messagesByChannel = current.messagesByChannel + (
                    updated.channelId to list.map { if (it.id == updated.id) updated else it }
                ),
            )
        }
    }

    private fun handleMessageDelete(obj: JsonObject) {
        val channelId = obj["channelId"]?.jsonPrimitive?.contentOrNull ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.contentOrNull ?: return
        removeLocalMessage(channelId, messageId)
    }

    private fun handleReactionAdded(obj: JsonObject) {
        val channelId = obj["channelId"]?.jsonPrimitive?.contentOrNull ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.contentOrNull ?: return
        val reactionElem = obj["reaction"]
        val reaction = if (reactionElem != null) {
            runCatching { json.decodeFromJsonElement<MessageReaction>(reactionElem) }.getOrNull()
        } else {
            val userId = obj["userId"]?.jsonPrimitive?.contentOrNull ?: return
            val emoji = obj["emoji"]?.jsonPrimitive?.contentOrNull ?: return
            MessageReaction(id = "$messageId:$userId:$emoji", messageId = messageId, userId = userId, emoji = emoji)
        } ?: return

        _snapshot.update { current ->
            val list = current.messagesByChannel[channelId] ?: return@update current
            current.copy(
                messagesByChannel = current.messagesByChannel + (
                    channelId to list.map { msg ->
                        if (msg.id == messageId && msg.reactions.none { it.userId == reaction.userId && it.emoji == reaction.emoji }) {
                            msg.copy(reactions = msg.reactions + reaction)
                        } else {
                            msg
                        }
                    }
                ),
            )
        }
    }

    private fun handleReactionRemoved(obj: JsonObject) {
        val channelId = obj["channelId"]?.jsonPrimitive?.contentOrNull ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.contentOrNull ?: return
        val userId = obj["userId"]?.jsonPrimitive?.contentOrNull ?: return
        val emoji = obj["emoji"]?.jsonPrimitive?.contentOrNull ?: return

        _snapshot.update { current ->
            val list = current.messagesByChannel[channelId] ?: return@update current
            current.copy(
                messagesByChannel = current.messagesByChannel + (
                    channelId to list.map { msg ->
                        if (msg.id == messageId) {
                            msg.copy(reactions = msg.reactions.filterNot { it.userId == userId && it.emoji == emoji })
                        } else {
                            msg
                        }
                    }
                ),
            )
        }
    }

    fun addOrUpdateDmChannel(dm: DmChannel) {
        _snapshot.update { cur ->
            val exists = cur.dmChannels.any { it.id == dm.id }
            val updated = if (exists) {
                cur.dmChannels.map { if (it.id == dm.id) dm else it }
            } else {
                listOf(dm) + cur.dmChannels
            }
            cur.copy(dmChannels = updated)
        }
    }

    fun updateStreamingLimitsLocal(limits: InstanceStreamingLimits) {
        _snapshot.update { it.copy(streamingLimits = limits) }
    }

    fun refreshSpaceDetail(spaceId: String) {
        val url = activeInstanceUrl ?: return
        val token = activeToken ?: return
        scope.launch {
            runCatching { restClient.getSpaceDetail(url, token, spaceId) }
                .onSuccess { detailed ->
                    _snapshot.update { cur ->
                        val exists = cur.spaces.any { it.id == detailed.id }
                        val updated = if (exists) {
                            cur.spaces.map { if (it.id == detailed.id) detailed else it }
                        } else {
                            cur.spaces + detailed
                        }
                        cur.copy(spaces = updated)
                    }
                }
        }
    }

    private fun handleDmMessageCreated(obj: JsonObject) {
        val msgElem = obj["message"] ?: return
        val dmMsg = runCatching { json.decodeFromJsonElement<DmMessage>(msgElem) }.getOrNull() ?: return
        appendLocalMessage(dmMsg.dmChannelId, dmMsg.toChannelMessage())

        val myId = _snapshot.value.currentUser?.id
        if (myId != null && dmMsg.userId != myId && activeOpenChannelId != dmMsg.dmChannelId) {
            _snapshot.update { cur ->
                val prev = cur.unreadDmCounts[dmMsg.dmChannelId] ?: 0
                cur.copy(unreadDmCounts = cur.unreadDmCounts + (dmMsg.dmChannelId to (prev + 1)))
            }
        }
    }

    private fun handleDmMessageDeleted(obj: JsonObject) {
        val dmId = obj["dmChannelId"]?.jsonPrimitive?.contentOrNull ?: return
        val msgId = obj["messageId"]?.jsonPrimitive?.contentOrNull ?: return
        removeLocalMessage(dmId, msgId)
    }

    private fun handleTypingStart(obj: JsonObject) {
        val channelId = obj["channelId"]?.jsonPrimitive?.contentOrNull ?: return
        val username = obj["username"]?.jsonPrimitive?.contentOrNull
            ?: obj["userId"]?.jsonPrimitive?.contentOrNull
            ?: return
        val myId = _snapshot.value.currentUser?.id
        val myName = _snapshot.value.currentUser?.username
        if (username == myId || username == myName) return

        _snapshot.update { cur ->
            val currentSet = cur.typingByChannel[channelId].orEmpty()
            cur.copy(typingByChannel = cur.typingByChannel + (channelId to (currentSet + username)))
        }
        scope.launch {
            delay(5_000L)
            _snapshot.update { cur ->
                val currentSet = cur.typingByChannel[channelId].orEmpty() - username
                cur.copy(typingByChannel = cur.typingByChannel + (channelId to currentSet))
            }
        }
    }

    private fun handleUserUpdated(obj: JsonObject) {
        val userElem = obj["user"] ?: return
        val updatedUser = runCatching { json.decodeFromJsonElement<User>(userElem) }.getOrNull() ?: return
        _snapshot.update { current ->
            val updatedMe = if (current.currentUser?.id == updatedUser.id) updatedUser else current.currentUser
            current.copy(currentUser = updatedMe)
        }
    }
}
