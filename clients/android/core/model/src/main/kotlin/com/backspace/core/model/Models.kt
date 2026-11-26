package com.backspace.core.model

import kotlinx.serialization.Serializable

@Serializable
data class InstanceOidcInfo(
    val enabled: Boolean = false,
    val displayName: String = "SSO",
    val passwordLoginDisabled: Boolean = false,
)

@Serializable
data class InstanceInfo(
    val name: String = "Backspace",
    val version: String = "",
    val registrationOpen: Boolean = false,
    val instanceId: String = "",
    val commit: String? = null,
    val oidc: InstanceOidcInfo? = null,
)

object UploadUrlResolver {
    fun resolve(instanceUrl: String, raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val base = instanceUrl.trimEnd('/')
        return when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            trimmed.startsWith("/") -> "$base$trimmed"
            else -> "$base/api/uploads/$trimmed"
        }
    }
}

@Serializable
data class InstanceAdminSettings(
    val instanceName: String = "Backspace",
    val registrationOpen: Boolean = true,
    val federatedRegistrationOpen: Boolean = true,
    val discoveryEnabled: Boolean = true,
    val gifEnabled: Boolean = false,
    val maxUploadSizeMb: Int = 50,
    val federationRelayEnabled: Boolean = true,
    val federationRelayTtlDays: Int = 7,
    val defaultAutoRotateIntervalDays: Int = 30,
    val autoAcceptPeering: Boolean = false,
    val directoryEnabled: Boolean = false,
    val directoryBrowseEnabled: Boolean = false,
    val gifApiKey: String? = null,
    val supportCardEnabled: Boolean = true,
    val directoryLastPingAt: Long? = null,
    val directoryLastError: String? = null,
    val directoryListedSpaceCount: Int = 0,
)

@Serializable
data class InstanceStreamingLimits(
    val maxBitrateKbps: Int = 8000,
    val minBitrateKbps: Int = 500,
    val maxResolution: Int = 1080,
    val maxFramerate: Int = 60,
    val allowCustomBitrate: Boolean = true,
    val defaultAudioBitrateKbps: Int = 64,
    val maxAudioBitrateKbps: Int = 512,
    val allowMusicMode: Boolean = true,
    val allowStereoAudio: Boolean = true,
    val soundboardEnabled: Boolean = true,
    val maxSoundboardSoundsPerScope: Int = 50,
    val maxConcurrentSoundboardSounds: Int = 3,
    val bitrateStepKbps: Int = 500,
    val allowedResolutions: List<String> = emptyList(),
    val allowedFramerates: List<Int> = emptyList(),
    val discoveryEnabled: Boolean = true,
    val directoryEnabled: Boolean = false,
    val directoryConfigured: Boolean = false,
    val streamBandwidthBudgetKbps: Int? = null,
)

@Serializable
data class User(
    val id: String,
    val username: String,
    val displayName: String? = null,
    val avatar: String? = null,
    val banner: String? = null,
    val accentColor: String? = null,
    val avatarColor: String? = null,
    val bio: String? = null,
    val status: String = "online",
    val customStatus: String? = null,
    val isAdmin: Boolean = false,
    val discoverable: Boolean = true,
    val showActivity: Boolean = true,
    val homeInstance: String? = null,
    val federationHomeOrphaned: Boolean = false,
    val detachedHomeInstance: String? = null,
) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: username
    fun avatarUrl(instanceUrl: String): String? = UploadUrlResolver.resolve(instanceUrl, avatar)
    fun bannerUrl(instanceUrl: String): String? = UploadUrlResolver.resolve(instanceUrl, banner)
}

@Serializable
data class Space(
    val id: String,
    val name: String,
    val icon: String? = null,
    val banner: String? = null,
    val accentColor: String? = null,
    val avatarColor: String? = null,
    val description: String? = null,
    val visibility: String = "private",
    val directoryListed: Boolean = false,
    val ownerId: String = "",
    val ownerTitle: String? = null,
    val inviteCode: String? = null,
    val channels: List<Channel> = emptyList(),
    val categories: List<ChannelCategory> = emptyList(),
    val members: List<MemberWithUser> = emptyList(),
    val roles: List<Role> = emptyList(),
    val myPermissions: String? = null,
    // Optional Opus overrides
    val audioBitrateKbps: Int? = null,
    val maxAudioBitrateKbps: Int? = null,
    val allowMusicMode: Boolean? = null,
    val allowStereoAudio: Boolean? = null,
    val allowFileRetention: Boolean = false,
    val fileRetentionEnabled: Boolean = false,
) {
    fun iconUrl(instanceUrl: String): String? = UploadUrlResolver.resolve(instanceUrl, icon)
    fun bannerUrl(instanceUrl: String): String? = UploadUrlResolver.resolve(instanceUrl, banner)
}

@Serializable
data class ChannelCategory(
    val id: String,
    val spaceId: String = "",
    val parentId: String? = null,
    val name: String,
    val position: Int = 0,
    val isPrivate: Boolean = false,
    val overrideVersion: String? = null,
    // Optional Opus overrides
    val audioBitrateKbps: Int? = null,
    val maxAudioBitrateKbps: Int? = null,
    val allowMusicMode: Boolean? = null,
    val allowStereoAudio: Boolean? = null,
)

@Serializable
data class Channel(
    val id: String,
    val spaceId: String = "",
    val categoryId: String? = null,
    val name: String,
    val type: String = "text", // "text" | "voice"
    val position: Int = 0,
    val topic: String? = null,
    val isPrivate: Boolean = false,
    val overrideVersion: String? = null,
    val myPermissions: String? = null,
    // Optional Opus overrides
    val audioBitrateKbps: Int? = null,
    val maxAudioBitrateKbps: Int? = null,
    val allowMusicMode: Boolean? = null,
    val allowStereoAudio: Boolean? = null,
    val retainFiles: Boolean = false,
) {
    val isVoice: Boolean get() = type == "voice"
}

@Serializable
data class Role(
    val id: String,
    val spaceId: String = "",
    val name: String = "",
    val color: String = "",
    val position: Int = 0,
    val permissions: String = "0",
    val permissionsVersion: String? = null,
    val isEveryone: Boolean = false,
    val isDefault: Boolean = false,
)

@Serializable
data class MemberWithUser(
    val userId: String,
    val nickname: String? = null,
    val joinedAt: Long? = null,
    val user: User? = null,
    val roles: List<Role> = emptyList(),
) {
    val label: String get() = nickname?.takeIf { it.isNotBlank() } ?: user?.label ?: userId

    /**
     * Cor hex do cargo mais alto com cor definida (ignorando @everyone / vazio).
     */
    val highestRoleColorHex: String?
        get() = roles
            .filter { !it.isEveryone && it.color.isNotBlank() && it.color != "#000000" && it.color != "transparent" }
            .maxByOrNull { it.position }
            ?.color
}

@Serializable
data class VoiceUserState(
    val isMuted: Boolean = false,
    val isDeafened: Boolean = false,
    val isCameraOn: Boolean = false,
    val isScreenSharing: Boolean = false,
)

@Serializable
data class SpaceVoiceState(
    val spaceMuted: Boolean = false,
    val spaceDeafened: Boolean = false,
    val permissionMuted: Boolean = false,
)

@Serializable
data class LiveKitTokenResponse(
    val token: String,
    val url: String,
)

enum class AudioMode {
    VOICE,
    MUSIC,
}

enum class AudioChannelsMode {
    MONO,
    STEREO,
    UNKNOWN,
}

enum class AudioOutputRoute {
    BLUETOOTH,
    WIRED_HEADSET,
    SPEAKER,
    EARPIECE,
}

enum class TransmissionMode {
    VOICE_ACTIVITY,
    PUSH_TO_TALK,
}

enum class PttHardwareKey {
    NONE,
    VOLUME_UP,
    VOLUME_DOWN,
}

data class UserAudioPreferences(
    val mode: AudioMode = AudioMode.VOICE,
    val stereo: Boolean = false,
    val bitrateAuto: Boolean = true,
    val manualBitrateKbps: Int = 64,
    val opusFrameSizeMs: Int = 20, // 10, 20, 40
    val dataSaverMode: Boolean = false,
    val transmissionMode: TransmissionMode = TransmissionMode.VOICE_ACTIVITY,
    val pttHardwareKey: PttHardwareKey = PttHardwareKey.NONE,
    val vadThreshold: Float = 0.15f,
    val masterOutputVolume: Float = 1.0f, // 0.0..2.0
    val audioDuckingEnabled: Boolean = false,
    val uiSoundsEnabled: Boolean = true,
    val echoCancellation: Boolean = true,
    val noiseSuppression: Boolean = true,
    val autoGainControl: Boolean = true,
    val idleSuspendEnabled: Boolean = true,
    val idleSuspendTimeoutSeconds: Int = 60,
    val hideNonVideoParticipants: Boolean = false,
    val screenShareResolution: Int = 720, // 720 ou 1080
    val screenShareFps: Int = 30, // 15, 30 ou 60
    val jitterBufferMs: Int = 0, // 0 = Auto, 40, 80, 120
)

data class IncomingCallEvent(
    val dmChannelId: String?,
    val federatedCallId: String? = null,
    val callerId: String,
    val callerName: String,
)

data class ResolvedAudioPolicy(
    val defaultBitrateKbps: Int,
    val maxBitrateKbps: Int,
    val allowMusicMode: Boolean,
    val allowStereoAudio: Boolean,
)

data class EffectiveAudioConfig(
    val bitrateKbps: Int,
    val mode: AudioMode,
    val stereo: Boolean,
    val dtx: Boolean,
    val red: Boolean,
    val policy: ResolvedAudioPolicy,
) {
    val maxBitrateBps: Int get() = bitrateKbps * 1000
}

data class VoiceTelemetry(
    val pingMs: Int? = null,
    val jitterMs: Double? = null,
    val packetLossPercent: Double? = null,
    val sendBitrateKbps: Int? = null,
    val recvBitrateKbps: Int? = null,
    val codec: String? = null,
    val channelsMode: AudioChannelsMode = AudioChannelsMode.UNKNOWN,
    val opusMode: AudioMode? = null,
)
