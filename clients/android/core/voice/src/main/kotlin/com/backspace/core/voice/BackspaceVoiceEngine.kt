package com.backspace.core.voice

import android.content.Context
import android.content.Intent
import com.backspace.core.model.AudioChannelsMode
import com.backspace.core.model.AudioMode
import com.backspace.core.model.AudioOutputRoute
import com.backspace.core.model.AudioPolicyResolver
import com.backspace.core.model.Channel
import com.backspace.core.model.ChannelCategory
import com.backspace.core.model.EffectiveAudioConfig
import com.backspace.core.model.SoundboardPlayPayload
import com.backspace.core.model.SoundboardSound
import com.backspace.core.model.SoundboardUrlValidator
import com.backspace.core.model.Space
import com.backspace.core.model.TransmissionMode
import com.backspace.core.model.UserAudioPreferences
import com.backspace.core.model.VoiceTelemetry
import com.backspace.core.network.BackspaceRestClient
import com.backspace.core.network.BackspaceWebSocketClient
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.AudioTrackPublishDefaults
import io.livekit.android.room.participant.VideoTrackPublishDefaults
import io.livekit.android.room.track.DataPublishReliability
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.RemoteAudioTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.VideoEncoding
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
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
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

enum class VoiceConnectionStatus {
    IDLE,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    ERROR,
}

data class VoiceVideoTile(
    val id: String,
    val participantName: String,
    val isScreenShare: Boolean,
    val isLocal: Boolean,
    val videoTrack: VideoTrack,
)

data class VoiceParticipantUi(
    val userId: String,
    val username: String,
    val isSpeaking: Boolean = false,
    val isMuted: Boolean = false,
    val hasVideo: Boolean = false,
    val isLocal: Boolean = false,
)

data class VoiceSessionState(
    val status: VoiceConnectionStatus = VoiceConnectionStatus.IDLE,
    val spaceId: String? = null,
    val spaceName: String = "",
    val channelId: String? = null,
    val channelName: String = "",
    val isMuted: Boolean = false,
    val isDeafened: Boolean = false,
    val isPttPressed: Boolean = false,
    val isCameraOn: Boolean = false,
    val isScreenSharing: Boolean = false,
    val isIdleSuspended: Boolean = false,
    val micInputLevel: Float = 0f,
    val connectionQuality: String = "GOOD",
    val outputRoute: AudioOutputRoute = AudioOutputRoute.SPEAKER,
    val userPrefs: UserAudioPreferences = UserAudioPreferences(),
    val effectiveAudio: EffectiveAudioConfig = AudioPolicyResolver.resolveEffectiveConfig(
        policy = AudioPolicyResolver.resolvePolicy(),
        userPrefs = UserAudioPreferences(),
    ),
    val participants: List<VoiceParticipantUi> = emptyList(),
    val videoTiles: List<VoiceVideoTile> = emptyList(),
    val participantVolumes: Map<String, Float> = emptyMap(),
    val localMutedUsers: Set<String> = emptySet(),
    val telemetry: VoiceTelemetry = VoiceTelemetry(),
    val soundboardVolume: Float = 0.8f,
    val lastSoundboardEvent: String? = null,
    val errorMessage: String? = null,
)

/**
 * Motor de voz nativo estilo Mumble para o Backspace.
 * Integra LiveKit C++ WebRTC + Opus hierárquico + ForegroundService + Idle Suspend.
 */
class BackspaceVoiceEngine(
    private val appContext: Context,
    private val restClient: BackspaceRestClient,
    private val wsClient: BackspaceWebSocketClient,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val audioRouter = VoiceAudioRouter(appContext)
    private val prefsStorage = AudioPreferencesStorage(appContext)
    private val uiSounds = VoiceUiSoundPlayer(appContext)
    private val soundboardPlayer = SoundboardAudioPlayer()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val _state = MutableStateFlow(
        run {
            val savedPrefs = prefsStorage.load()
            VoiceSessionState(
                userPrefs = savedPrefs,
                effectiveAudio = AudioPolicyResolver.resolveEffectiveConfig(
                    policy = AudioPolicyResolver.resolvePolicy(),
                    userPrefs = savedPrefs,
                ),
                soundboardVolume = prefsStorage.loadSoundboardVolume(),
            )
        },
    )
    val state: StateFlow<VoiceSessionState> = _state.asStateFlow()

    private var room: Room? = null
    private var roomEventsJob: Job? = null
    private var policyObserverJob: Job? = null
    private var idleSuspendJob: Job? = null
    private var telemetryJob: Job? = null
    private var pttReleaseJob: Job? = null

    private var currentInstanceUrl: String? = null
    private var currentJwt: String? = null

    init {
        VoiceServiceControllerBridge.onToggleMute = { toggleMute() }
        VoiceServiceControllerBridge.onToggleDeafen = { toggleDeafen() }
        VoiceServiceControllerBridge.onDisconnect = { leaveChannel() }
    }

    fun joinChannel(
        instanceUrl: String,
        jwtToken: String,
        space: Space,
        category: ChannelCategory?,
        channel: Channel,
    ) {
        scope.launch {
            if (_state.value.channelId == channel.id && _state.value.status == VoiceConnectionStatus.CONNECTED) {
                return@launch
            }
            cleanupRoomOnly()

            currentInstanceUrl = instanceUrl
            currentJwt = jwtToken

            val snapshot = wsClient.snapshot.value
            val policy = AudioPolicyResolver.resolvePolicy(
                instance = snapshot.streamingLimits,
                space = space,
                category = category,
                channel = channel,
            )
            val effective = AudioPolicyResolver.resolveEffectiveConfig(policy, _state.value.userPrefs)
            val preferredRoute = audioRouter.detectPreferredRoute()

            _state.update {
                it.copy(
                    status = VoiceConnectionStatus.CONNECTING,
                    spaceId = space.id,
                    spaceName = space.name,
                    channelId = channel.id,
                    channelName = channel.name,
                    effectiveAudio = effective,
                    outputRoute = preferredRoute,
                    isIdleSuspended = false,
                    errorMessage = null,
                )
            }

            runCatching {
                wsClient.sendVoiceJoin(channel.id)
                val tokenResp = restClient.requestLiveKitToken(instanceUrl, jwtToken, channel.id)

                audioRouter.enterVoiceMode()
                audioRouter.setOutputRoute(preferredRoute)

                val lkRoom = createConfiguredRoom(effective)
                room = lkRoom
                observeRoomEvents(lkRoom)

                lkRoom.connect(url = tokenResp.url, token = tokenResp.token)
                // Mantém hardware do microfone aquecido para PTT sem corte no início da fala
                lkRoom.localParticipant.setMicrophoneEnabled(true)
                applyInstantMicGate(lkRoom, computeDesiredMicEnabled(_state.value))
                uiSounds.play(VoiceUiSound.USER_JOIN, _state.value.userPrefs.uiSoundsEnabled)

                wsClient.sendVoiceStatus(
                    isMuted = _state.value.isMuted,
                    isDeafened = _state.value.isDeafened,
                    isCameraOn = false,
                    isScreenSharing = false,
                )

                VoiceForegroundService.startOrUpdate(
                    context = appContext,
                    spaceName = space.name,
                    channelName = channel.name,
                    isMuted = _state.value.isMuted,
                    isDeafened = _state.value.isDeafened,
                    bitrateKbps = effective.bitrateKbps,
                )

                _state.update { it.copy(status = VoiceConnectionStatus.CONNECTED) }
                refreshParticipants(lkRoom)
                startPolicyObserver()
                startTelemetryLoop()
                scheduleIdleSuspendCheck()
            }.onFailure { err ->
                cleanupRoomOnly()
                wsClient.sendVoiceLeave()
                _state.update {
                    it.copy(
                        status = VoiceConnectionStatus.ERROR,
                        errorMessage = err.message ?: "Voice connection failed",
                    )
                }
            }
        }
    }

    fun joinDmCall(
        instanceUrl: String,
        jwtToken: String,
        dmChannelId: String,
        dmTitle: String,
    ) {
        scope.launch {
            if (_state.value.channelId == dmChannelId && _state.value.status == VoiceConnectionStatus.CONNECTED) {
                return@launch
            }
            cleanupRoomOnly()

            currentInstanceUrl = instanceUrl
            currentJwt = jwtToken

            val snapshot = wsClient.snapshot.value
            val policy = AudioPolicyResolver.resolvePolicy(instance = snapshot.streamingLimits)
            val effective = AudioPolicyResolver.resolveEffectiveConfig(policy, _state.value.userPrefs)
            val preferredRoute = audioRouter.detectPreferredRoute()

            _state.update {
                it.copy(
                    status = VoiceConnectionStatus.CONNECTING,
                    spaceId = null,
                    spaceName = "DM",
                    channelId = dmChannelId,
                    channelName = dmTitle,
                    effectiveAudio = effective,
                    outputRoute = preferredRoute,
                    isIdleSuspended = false,
                    errorMessage = null,
                )
            }

            runCatching {
                val tokenResp = restClient.requestLiveKitDmToken(instanceUrl, jwtToken, dmChannelId)
                audioRouter.enterVoiceMode()
                audioRouter.setOutputRoute(preferredRoute)

                val lkRoom = createConfiguredRoom(effective)
                room = lkRoom
                observeRoomEvents(lkRoom)

                lkRoom.connect(url = tokenResp.url, token = tokenResp.token)
                // Mantém hardware do microfone aquecido para PTT sem corte no início da fala
                lkRoom.localParticipant.setMicrophoneEnabled(true)
                applyInstantMicGate(lkRoom, computeDesiredMicEnabled(_state.value))
                uiSounds.play(VoiceUiSound.USER_JOIN, _state.value.userPrefs.uiSoundsEnabled)

                VoiceForegroundService.startOrUpdate(
                    context = appContext,
                    spaceName = "DM",
                    channelName = dmTitle,
                    isMuted = _state.value.isMuted,
                    isDeafened = _state.value.isDeafened,
                    bitrateKbps = effective.bitrateKbps,
                )

                _state.update { it.copy(status = VoiceConnectionStatus.CONNECTED) }
                refreshParticipants(lkRoom)
                startTelemetryLoop()
                scheduleIdleSuspendCheck()
            }.onFailure { err ->
                cleanupRoomOnly()
                _state.update {
                    it.copy(
                        status = VoiceConnectionStatus.ERROR,
                        errorMessage = err.message ?: "DM call failed",
                    )
                }
            }
        }
    }

    fun leaveChannel() {
        val wasConnected = _state.value.status == VoiceConnectionStatus.CONNECTED
        val uiSoundsOn = _state.value.userPrefs.uiSoundsEnabled
        val lkRoomToRelease = detachRoomImmediately()

        // Atualiza o estado da UI para IDLE imediatamente (0ms, sem travar a Main thread)
        _state.update {
            it.copy(
                status = VoiceConnectionStatus.IDLE,
                spaceId = null,
                spaceName = "",
                channelId = null,
                channelName = "",
                isIdleSuspended = false,
                isPttPressed = false,
                micInputLevel = 0f,
                isCameraOn = false,
                isScreenSharing = false,
                participants = emptyList(),
                videoTiles = emptyList(),
                telemetry = VoiceTelemetry(),
                errorMessage = null,
            )
        }

        if (wasConnected) {
            uiSounds.play(VoiceUiSound.DISCONNECT, uiSoundsOn)
        }
        runCatching { wsClient.sendVoiceLeave() }
        runCatching { VoiceForegroundService.stop(appContext) }
        runCatching { audioRouter.exitVoiceMode() }

        // Desconecta e libera o Room WebRTC fora da Main thread com timeout de segurança
        if (lkRoomToRelease != null) {
            scope.launch(Dispatchers.IO) {
                withTimeoutOrNull(2500L) {
                    runCatching { lkRoomToRelease.disconnect() }
                    runCatching { lkRoomToRelease.release() }
                }
            }
        }
    }

    fun setPttPressed(pressed: Boolean) {
        if (_state.value.userPrefs.transmissionMode != TransmissionMode.PUSH_TO_TALK) return
        pttReleaseJob?.cancel()
        if (pressed) {
            if (_state.value.isPttPressed) return
            _state.update { it.copy(isPttPressed = true) }
            val lkRoom = room ?: return
            // Abre o gate da track instantaneamente (0ms de latência, sem recriar captura Android)
            applyInstantMicGate(lkRoom, enabled = !_state.value.isMuted && !_state.value.isDeafened)
            if (_state.value.userPrefs.audioDuckingEnabled) {
                applyRemoteAudioVolume(lkRoom, muted = _state.value.isDeafened)
            }
        } else {
            // Tail release de 250ms estilo Mumble para nunca cortar a última sílaba
            pttReleaseJob = scope.launch {
                delay(250L)
                _state.update { it.copy(isPttPressed = false) }
                val lkRoom = room ?: return@launch
                applyInstantMicGate(lkRoom, enabled = false)
                if (_state.value.userPrefs.audioDuckingEnabled) {
                    applyRemoteAudioVolume(lkRoom, muted = _state.value.isDeafened)
                }
            }
        }
    }

    private fun applyInstantMicGate(lkRoom: Room, enabled: Boolean) {
        val localAudio = lkRoom.localParticipant.audioTrackPublications
            .firstOrNull { (pub, _) -> pub.source == Track.Source.MICROPHONE }
            ?.second as? LocalAudioTrack
        if (localAudio != null) {
            localAudio.enabled = enabled
        } else {
            scope.launch {
                lkRoom.localParticipant.setMicrophoneEnabled(enabled)
            }
        }
    }

    fun resetAudioPreferencesToDefault() {
        updateUserAudioPreferences { UserAudioPreferences() }
        setSoundboardVolume(0.8f)
    }

    private fun computeDesiredMicEnabled(s: VoiceSessionState): Boolean {
        if (s.isMuted || s.isDeafened) return false
        return when (s.userPrefs.transmissionMode) {
            TransmissionMode.VOICE_ACTIVITY -> true
            TransmissionMode.PUSH_TO_TALK -> s.isPttPressed
        }
    }

    fun toggleMute() {
        scope.launch {
            val nextMuted = !_state.value.isMuted
            val nextDeafened = if (!nextMuted) false else _state.value.isDeafened
            uiSounds.play(
                if (nextMuted) VoiceUiSound.MUTE else VoiceUiSound.UNMUTE,
                _state.value.userPrefs.uiSoundsEnabled,
            )
            applyMuteDeafenState(isMuted = nextMuted, isDeafened = nextDeafened)
        }
    }

    fun toggleDeafen() {
        scope.launch {
            val nextDeafened = !_state.value.isDeafened
            val nextMuted = if (nextDeafened) true else _state.value.isMuted
            uiSounds.play(
                if (nextDeafened) VoiceUiSound.DEAFEN else VoiceUiSound.UNDEAFEN,
                _state.value.userPrefs.uiSoundsEnabled,
            )
            applyMuteDeafenState(isMuted = nextMuted, isDeafened = nextDeafened)
        }
    }

    fun initVideoRenderer(renderer: TextureViewRenderer) {
        room?.initVideoRenderer(renderer)
    }

    fun toggleCamera() {
        scope.launch {
            val lkRoom = room ?: return@launch
            val nextCamera = !_state.value.isCameraOn
            runCatching {
                lkRoom.localParticipant.setCameraEnabled(nextCamera)
            }.onSuccess {
                _state.update { it.copy(isCameraOn = nextCamera) }
                wsClient.sendVoiceStatus(
                    isMuted = _state.value.isMuted,
                    isDeafened = _state.value.isDeafened,
                    isCameraOn = nextCamera,
                    isScreenSharing = _state.value.isScreenSharing,
                )
                refreshParticipants(lkRoom)
            }.onFailure { err ->
                _state.update { it.copy(errorMessage = err.message) }
            }
        }
    }

    fun switchCamera() {
        scope.launch {
            val lkRoom = room ?: return@launch
            val camTrack = lkRoom.localParticipant.videoTrackPublications
                .firstOrNull { (pub, _) -> pub.source == Track.Source.CAMERA }
                ?.second as? LocalVideoTrack
            runCatching { camTrack?.switchCamera() }
        }
    }

    fun startScreenShare(mediaProjectionPermissionResultData: Intent) {
        scope.launch {
            val lkRoom = room ?: return@launch
            // Android 14+ exige mediaProjection no ForegroundService ANTES de iniciar captura
            VoiceForegroundService.startOrUpdate(
                context = appContext,
                spaceName = _state.value.spaceName,
                channelName = _state.value.channelName,
                isMuted = _state.value.isMuted,
                isDeafened = _state.value.isDeafened,
                bitrateKbps = _state.value.effectiveAudio.bitrateKbps,
                isScreenSharing = true,
            )
            delay(200L)
            runCatching {
                lkRoom.localParticipant.setScreenShareEnabled(
                    enabled = true,
                    screenCaptureParams = ScreenCaptureParams(
                        mediaProjectionPermissionResultData = mediaProjectionPermissionResultData,
                    ),
                )
            }.onSuccess {
                _state.update { it.copy(isScreenSharing = true) }
                wsClient.sendVoiceStatus(
                    isMuted = _state.value.isMuted,
                    isDeafened = _state.value.isDeafened,
                    isCameraOn = _state.value.isCameraOn,
                    isScreenSharing = true,
                )
                refreshParticipants(lkRoom)
            }.onFailure { err ->
                _state.update { it.copy(errorMessage = err.message) }
            }
        }
    }

    fun stopScreenShare() {
        scope.launch {
            val lkRoom = room ?: return@launch
            runCatching {
                lkRoom.localParticipant.setScreenShareEnabled(false)
            }
            _state.update { it.copy(isScreenSharing = false) }
            wsClient.sendVoiceStatus(
                isMuted = _state.value.isMuted,
                isDeafened = _state.value.isDeafened,
                isCameraOn = _state.value.isCameraOn,
                isScreenSharing = false,
            )
            VoiceForegroundService.startOrUpdate(
                context = appContext,
                spaceName = _state.value.spaceName,
                channelName = _state.value.channelName,
                isMuted = _state.value.isMuted,
                isDeafened = _state.value.isDeafened,
                bitrateKbps = _state.value.effectiveAudio.bitrateKbps,
                isScreenSharing = false,
            )
            refreshParticipants(lkRoom)
        }
    }

    fun setOutputRoute(route: AudioOutputRoute) {
        audioRouter.setOutputRoute(route)
        _state.update { it.copy(outputRoute = route) }
    }

    fun setSoundboardVolume(volume: Float) {
        val clamped = volume.coerceIn(0f, 1f)
        prefsStorage.saveSoundboardVolume(clamped)
        _state.update { it.copy(soundboardVolume = clamped) }
    }

    fun setParticipantVolume(userId: String, volume: Float) {
        val clamped = volume.coerceIn(0f, 2f)
        _state.update { cur ->
            cur.copy(participantVolumes = cur.participantVolumes + (userId to clamped))
        }
        room?.let { applyRemoteAudioVolume(it, muted = _state.value.isDeafened) }
    }

    fun toggleLocalMuteParticipant(userId: String) {
        _state.update { cur ->
            val next = if (cur.localMutedUsers.contains(userId)) {
                cur.localMutedUsers - userId
            } else {
                cur.localMutedUsers + userId
            }
            cur.copy(localMutedUsers = next)
        }
        room?.let { applyRemoteAudioVolume(it, muted = _state.value.isDeafened) }
    }

    fun moderateSpaceMute(targetUserId: String, muted: Boolean) {
        val spaceId = _state.value.spaceId ?: return
        wsClient.sendVoiceSpaceMute(spaceId, targetUserId, muted)
    }

    fun moderateSpaceDeafen(targetUserId: String, deafened: Boolean) {
        val spaceId = _state.value.spaceId ?: return
        wsClient.sendVoiceSpaceDeafen(spaceId, targetUserId, deafened)
    }

    fun moderateDisconnect(targetUserId: String) {
        val spaceId = _state.value.spaceId ?: return
        wsClient.sendVoiceDisconnect(spaceId, targetUserId)
    }

    fun playSoundboardSound(sound: SoundboardSound) {
        scope.launch {
            val lkRoom = room ?: return@launch
            val baseUrl = currentInstanceUrl ?: return@launch
            val fileUrl = sound.resolvedFileUrl
            if (!SoundboardUrlValidator.isSafeFileUrl(fileUrl)) return@launch

            val myUserId = wsClient.snapshot.value.currentUser?.id ?: "me"
            val payload = SoundboardPlayPayload(
                soundId = sound.id,
                fileUrl = fileUrl,
                name = sound.name,
                emoji = sound.emoji,
                senderUserId = myUserId,
                durationMs = sound.durationMs,
                volumeScale = sound.volume,
            )

            // Envia via LiveKit DataChannel para todos na sala
            runCatching {
                val bytes = json.encodeToString(SoundboardPlayPayload.serializer(), payload)
                    .toByteArray(Charsets.UTF_8)
                lkRoom.localParticipant.publishData(
                    data = bytes,
                    reliability = DataPublishReliability.RELIABLE,
                )
            }

            // Toca localmente se não estiver ensurdecido
            if (!_state.value.isDeafened) {
                val maxConcurrent = wsClient.snapshot.value.streamingLimits.maxConcurrentSoundboardSounds
                val effectiveVol = (_state.value.soundboardVolume * sound.volume.toFloat()).coerceIn(0f, 1f)
                soundboardPlayer.play("$baseUrl$fileUrl", effectiveVol, maxConcurrent)
                _state.update { it.copy(lastSoundboardEvent = "${sound.emoji} ${sound.name}") }
            }
        }
    }

    fun updateUserAudioPreferences(transform: (UserAudioPreferences) -> UserAudioPreferences) {
        scope.launch {
            val updatedPrefs = transform(_state.value.userPrefs)
            prefsStorage.save(updatedPrefs)
            val currentPolicy = _state.value.effectiveAudio.policy
            val newEffective = AudioPolicyResolver.resolveEffectiveConfig(currentPolicy, updatedPrefs)
            val needsReconfigure = newEffective != _state.value.effectiveAudio

            _state.update {
                it.copy(
                    userPrefs = updatedPrefs,
                    effectiveAudio = newEffective,
                )
            }

            val lkRoom = room
            if (lkRoom != null && _state.value.status == VoiceConnectionStatus.CONNECTED) {
                lkRoom.localParticipant.setMicrophoneEnabled(computeDesiredMicEnabled(_state.value))
                applyRemoteAudioVolume(lkRoom, muted = _state.value.isDeafened)
                if (needsReconfigure) {
                    reapplyLiveKitAudioSettings(newEffective)
                }
            }
            scheduleIdleSuspendCheck()
        }
    }

    private suspend fun applyMuteDeafenState(isMuted: Boolean, isDeafened: Boolean) {
        _state.update {
            it.copy(
                isMuted = isMuted,
                isDeafened = isDeafened,
                isIdleSuspended = false,
            )
        }

        val lkRoom = room ?: return
        applyInstantMicGate(lkRoom, computeDesiredMicEnabled(_state.value))
        applyRemoteAudioVolume(lkRoom, muted = isDeafened)
        publishDeafenDataChannel(lkRoom, isDeafened)
        wsClient.sendVoiceStatus(
            isMuted = isMuted,
            isDeafened = isDeafened,
            isCameraOn = _state.value.isCameraOn,
            isScreenSharing = _state.value.isScreenSharing,
        )

        VoiceForegroundService.startOrUpdate(
            context = appContext,
            spaceName = _state.value.spaceName,
            channelName = _state.value.channelName,
            isMuted = isMuted,
            isDeafened = isDeafened,
            bitrateKbps = _state.value.effectiveAudio.bitrateKbps,
            isScreenSharing = _state.value.isScreenSharing,
        )
        scheduleIdleSuspendCheck()
    }

    private fun createConfiguredRoom(effective: EffectiveAudioConfig): Room {
        val isMusic = effective.mode == AudioMode.MUSIC
        val prefs = _state.value.userPrefs
        val limits = wsClient.snapshot.value.streamingLimits
        val maxHeight = minOf(prefs.screenShareResolution, limits.maxResolution).coerceAtLeast(480)
        val width = if (maxHeight >= 1080) 1920 else 1280
        val maxFps = minOf(prefs.screenShareFps, limits.maxFramerate).coerceIn(15, 60)
        val maxVideoBitrate = limits.maxBitrateKbps.coerceIn(500, 10000) * 1000

        val options = RoomOptions(
            adaptiveStream = true,
            dynacast = true,
            audioTrackCaptureDefaults = LocalAudioTrackOptions(
                noiseSuppression = !isMusic && prefs.noiseSuppression,
                echoCancellation = !isMusic && prefs.echoCancellation,
                autoGainControl = !isMusic && prefs.autoGainControl,
            ),
            audioTrackPublishDefaults = AudioTrackPublishDefaults(
                audioBitrate = effective.maxBitrateBps,
                dtx = effective.dtx,
                red = effective.red,
            ),
            screenShareTrackCaptureDefaults = LocalVideoTrackOptions(
                captureParams = VideoCaptureParameter(
                    width = width,
                    height = maxHeight,
                    maxFps = maxFps,
                ),
            ),
            screenShareTrackPublishDefaults = VideoTrackPublishDefaults(
                videoEncoding = VideoEncoding(
                    maxBitrate = maxVideoBitrate,
                    maxFps = maxFps,
                ),
            ),
        )
        return LiveKit.create(appContext = appContext, options = options)
    }

    private suspend fun reapplyLiveKitAudioSettings(effective: EffectiveAudioConfig) {
        val lkRoom = room ?: return
        // Re-habilita microfone aplicando novos parâmetros Opus quando conectado
        val shouldEnableMic = !_state.value.isMuted && !_state.value.isDeafened
        if (shouldEnableMic) {
            lkRoom.localParticipant.setMicrophoneEnabled(false)
            lkRoom.localParticipant.setMicrophoneEnabled(true)
        }
        VoiceForegroundService.startOrUpdate(
            context = appContext,
            spaceName = _state.value.spaceName,
            channelName = _state.value.channelName,
            isMuted = _state.value.isMuted,
            isDeafened = _state.value.isDeafened,
            bitrateKbps = effective.bitrateKbps,
        )
    }

    private fun observeRoomEvents(lkRoom: Room) {
        roomEventsJob?.cancel()
        roomEventsJob = scope.launch {
            lkRoom.events.collect { event ->
                when (event) {
                    is RoomEvent.ParticipantConnected -> {
                        uiSounds.play(VoiceUiSound.USER_JOIN, _state.value.userPrefs.uiSoundsEnabled)
                        refreshParticipants(lkRoom)
                        if (_state.value.isDeafened) {
                            publishDeafenDataChannel(lkRoom, true)
                        }
                        scheduleIdleSuspendCheck()
                    }
                    is RoomEvent.ParticipantDisconnected -> {
                        uiSounds.play(VoiceUiSound.USER_LEAVE, _state.value.userPrefs.uiSoundsEnabled)
                        refreshParticipants(lkRoom)
                        scheduleIdleSuspendCheck()
                    }
                    is RoomEvent.TrackSubscribed -> {
                        if (event.track is RemoteAudioTrack) {
                            val remoteUserId = (event.participant.identity?.value ?: "").split(":").firstOrNull().orEmpty()
                            val effectiveVol = computeRemoteVolume(remoteUserId, deafened = _state.value.isDeafened)
                            (event.track as RemoteAudioTrack).setVolume(effectiveVol)
                        }
                        refreshParticipants(lkRoom)
                    }
                    is RoomEvent.TrackUnsubscribed,
                    is RoomEvent.TrackPublished,
                    is RoomEvent.TrackUnpublished,
                    is RoomEvent.TrackMuted,
                    is RoomEvent.TrackUnmuted -> refreshParticipants(lkRoom)
                    is RoomEvent.ActiveSpeakersChanged -> refreshParticipants(lkRoom)
                    is RoomEvent.DataReceived -> handleDataReceived(event)
                    is RoomEvent.Reconnecting -> {
                        _state.update { it.copy(status = VoiceConnectionStatus.RECONNECTING) }
                    }
                    is RoomEvent.Reconnected -> {
                        _state.update { it.copy(status = VoiceConnectionStatus.CONNECTED) }
                    }
                    is RoomEvent.Disconnected -> {
                        if (_state.value.status != VoiceConnectionStatus.IDLE) {
                            leaveChannel()
                        }
                    }
                    else -> Unit
                }
            }
        }
    }

    private fun startPolicyObserver() {
        policyObserverJob?.cancel()
        policyObserverJob = scope.launch {
            wsClient.snapshot.collect { snap ->
                val spaceId = _state.value.spaceId ?: return@collect
                val channelId = _state.value.channelId ?: return@collect
                val space = snap.spaces.firstOrNull { it.id == spaceId } ?: return@collect
                val channel = space.channels.firstOrNull { it.id == channelId } ?: return@collect
                val category = space.categories.firstOrNull { it.id == channel.categoryId }

                val newPolicy = AudioPolicyResolver.resolvePolicy(
                    instance = snap.streamingLimits,
                    space = space,
                    category = category,
                    channel = channel,
                )
                val newEffective = AudioPolicyResolver.resolveEffectiveConfig(newPolicy, _state.value.userPrefs)
                if (newEffective != _state.value.effectiveAudio) {
                    _state.update { it.copy(effectiveAudio = newEffective) }
                    reapplyLiveKitAudioSettings(newEffective)
                }
            }
        }
    }

    private fun startTelemetryLoop() {
        telemetryJob?.cancel()
        telemetryJob = scope.launch {
            while (isActive) {
                delay(350L)
                val lkRoom = room ?: continue
                // Se o LiveKit desconectou enquanto a tela estava apagada (ex: entrou pelo PC), limpa imediatamente
                if (lkRoom.state == Room.State.DISCONNECTED && _state.value.status == VoiceConnectionStatus.CONNECTED) {
                    leaveChannel()
                    break
                }
                val effective = _state.value.effectiveAudio
                val channelsMode = if (effective.stereo) AudioChannelsMode.STEREO else AudioChannelsMode.MONO
                val localLevel = if (computeDesiredMicEnabled(_state.value)) {
                    lkRoom.localParticipant.audioLevel.coerceIn(0f, 1f)
                } else {
                    0f
                }
                val quality = lkRoom.localParticipant.connectionQuality.name
                _state.update {
                    it.copy(
                        micInputLevel = localLevel,
                        connectionQuality = quality,
                        telemetry = it.telemetry.copy(
                            sendBitrateKbps = if (it.isMuted || it.isIdleSuspended) 0 else effective.bitrateKbps,
                            codec = "opus",
                            channelsMode = channelsMode,
                            opusMode = effective.mode,
                        ),
                    )
                }
                if (_state.value.userPrefs.audioDuckingEnabled) {
                    applyRemoteAudioVolume(lkRoom, muted = _state.value.isDeafened)
                }
            }
        }
    }

    /**
     * Suspensão de áudio em inatividade (paridade PR #494):
     * Se o usuário ficar sozinho no canal ou mutado por `idleSuspendTimeoutSeconds`,
     * libera a captura ativa de microfone para economizar bateria/CPU.
     */
    private fun scheduleIdleSuspendCheck() {
        idleSuspendJob?.cancel()
        val stateNow = _state.value
        if (!stateNow.userPrefs.idleSuspendEnabled || stateNow.status != VoiceConnectionStatus.CONNECTED) {
            return
        }
        val aloneInChannel = (room?.remoteParticipants?.isEmpty() == true)
        if (!aloneInChannel && !stateNow.isMuted) {
            if (stateNow.isIdleSuspended) {
                _state.update { it.copy(isIdleSuspended = false) }
            }
            return
        }
        idleSuspendJob = scope.launch {
            delay(stateNow.userPrefs.idleSuspendTimeoutSeconds * 1000L)
            val lkRoom = room ?: return@launch
            if (lkRoom.remoteParticipants.isEmpty() || _state.value.isMuted) {
                lkRoom.localParticipant.setMicrophoneEnabled(false)
                _state.update { it.copy(isIdleSuspended = true) }
            }
        }
    }

    private fun refreshParticipants(lkRoom: Room) {
        val local = lkRoom.localParticipant
        val localIdParts = (local.identity?.value ?: "").split(":")
        val localName = localIdParts.getOrElse(1) { wsClient.snapshot.value.currentUser?.label ?: "You" }
        val tiles = mutableListOf<VoiceVideoTile>()

        var actualLocalCamera = false
        var actualLocalScreenShare = false

        local.videoTrackPublications.forEach { (pub, track) ->
            val vTrack = track as? VideoTrack ?: return@forEach
            if (!pub.muted) {
                if (pub.source == Track.Source.CAMERA) actualLocalCamera = true
                if (pub.source == Track.Source.SCREEN_SHARE) actualLocalScreenShare = true
                tiles.add(
                    VoiceVideoTile(
                        id = "local:${pub.sid}",
                        participantName = localName,
                        isScreenShare = pub.source == Track.Source.SCREEN_SHARE,
                        isLocal = true,
                        videoTrack = vTrack,
                    ),
                )
            }
        }

        // Sincroniza estado real se o Android encerrou a captura de tela ou câmera externamente
        val prev = _state.value
        val mediaStateChanged = (prev.isCameraOn != actualLocalCamera) || (prev.isScreenSharing != actualLocalScreenShare)
        if (mediaStateChanged && prev.status == VoiceConnectionStatus.CONNECTED) {
            wsClient.sendVoiceStatus(
                isMuted = prev.isMuted,
                isDeafened = prev.isDeafened,
                isCameraOn = actualLocalCamera,
                isScreenSharing = actualLocalScreenShare,
            )
            VoiceForegroundService.startOrUpdate(
                context = appContext,
                spaceName = prev.spaceName,
                channelName = prev.channelName,
                isMuted = prev.isMuted,
                isDeafened = prev.isDeafened,
                bitrateKbps = prev.effectiveAudio.bitrateKbps,
                isScreenSharing = actualLocalScreenShare,
            )
        }

        val list = mutableListOf(
            VoiceParticipantUi(
                userId = localIdParts.getOrElse(0) { "me" },
                username = localName,
                isSpeaking = local.isSpeaking,
                isMuted = _state.value.isMuted || _state.value.isIdleSuspended,
                hasVideo = tiles.any { it.isLocal },
                isLocal = true,
            ),
        )
        lkRoom.remoteParticipants.values.forEach { remote ->
            val parts = (remote.identity?.value ?: "").split(":")
            val remoteName = parts.getOrElse(1) { remote.name ?: "User" }
            var remoteHasVideo = false

            remote.videoTrackPublications.forEach { (pub, track) ->
                val vTrack = track as? VideoTrack ?: return@forEach
                if (!pub.muted) {
                    remoteHasVideo = true
                    tiles.add(
                        VoiceVideoTile(
                            id = "${remote.sid.value}:${pub.sid}",
                            participantName = remoteName,
                            isScreenShare = pub.source == Track.Source.SCREEN_SHARE,
                            isLocal = false,
                            videoTrack = vTrack,
                        ),
                    )
                }
            }

            list.add(
                VoiceParticipantUi(
                    userId = parts.getOrElse(0) { remote.sid.value },
                    username = remoteName,
                    isSpeaking = remote.isSpeaking,
                    isMuted = !remote.isMicrophoneEnabled(),
                    hasVideo = remoteHasVideo,
                    isLocal = false,
                ),
            )
        }
        _state.update {
            it.copy(
                isCameraOn = actualLocalCamera,
                isScreenSharing = actualLocalScreenShare,
                participants = list,
                videoTiles = tiles,
            )
        }
    }

    private fun computeRemoteVolume(userId: String, deafened: Boolean): Double {
        if (deafened) return 0.0
        if (_state.value.localMutedUsers.contains(userId)) return 0.0
        val userVol = (_state.value.participantVolumes[userId] ?: 1.0f).toDouble()
        val masterVol = _state.value.userPrefs.masterOutputVolume.toDouble()
        val isTalking = _state.value.isPttPressed || (room?.localParticipant?.isSpeaking == true)
        val duckFactor = if (_state.value.userPrefs.audioDuckingEnabled && isTalking) 0.35 else 1.0
        return (userVol * masterVol * duckFactor).coerceIn(0.0, 2.5)
    }

    private fun applyRemoteAudioVolume(lkRoom: Room, muted: Boolean) {
        lkRoom.remoteParticipants.values.forEach { remote ->
            val uid = (remote.identity?.value ?: "").split(":").firstOrNull().orEmpty()
            val vol = computeRemoteVolume(uid, deafened = muted)
            remote.audioTrackPublications.forEach { (_, track) ->
                (track as? RemoteAudioTrack)?.setVolume(vol)
            }
        }
    }

    private suspend fun publishDeafenDataChannel(lkRoom: Room, deafened: Boolean) {
        val payload = buildJsonObject {
            put("type", "deafen")
            put("deafened", deafened)
        }.toString().toByteArray(Charsets.UTF_8)
        runCatching {
            lkRoom.localParticipant.publishData(
                data = payload,
                reliability = DataPublishReliability.RELIABLE,
            )
        }
    }

    private fun handleDataReceived(event: RoomEvent.DataReceived) {
        val raw = runCatching { event.data.toString(Charsets.UTF_8) }.getOrNull() ?: return
        if (!raw.contains("\"soundboard_play\"")) return
        if (_state.value.isDeafened) return
        if (event.participant?.attributes?.get("sb") == "0") return

        val payload = runCatching {
            json.decodeFromString(SoundboardPlayPayload.serializer(), raw)
        }.getOrNull() ?: return

        val baseUrl = currentInstanceUrl ?: return
        if (!SoundboardUrlValidator.isSafeFileUrl(payload.fileUrl)) return

        val maxConcurrent = wsClient.snapshot.value.streamingLimits.maxConcurrentSoundboardSounds
        val effectiveVol = (_state.value.soundboardVolume * payload.volumeScale.toFloat()).coerceIn(0f, 1f)
        soundboardPlayer.play("$baseUrl${payload.fileUrl}", effectiveVol, maxConcurrent)
        _state.update { it.copy(lastSoundboardEvent = "${payload.emoji} ${payload.name}") }
    }

    private fun detachRoomImmediately(): Room? {
        soundboardPlayer.stopAll()
        pttReleaseJob?.cancel()
        roomEventsJob?.cancel()
        policyObserverJob?.cancel()
        idleSuspendJob?.cancel()
        telemetryJob?.cancel()
        val old = room
        room = null
        return old
    }

    private fun cleanupRoomOnly() {
        val old = detachRoomImmediately() ?: return
        scope.launch(Dispatchers.IO) {
            withTimeoutOrNull(2500L) {
                runCatching { old.disconnect() }
                runCatching { old.release() }
            }
        }
    }
}
