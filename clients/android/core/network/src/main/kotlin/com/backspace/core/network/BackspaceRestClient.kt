package com.backspace.core.network

import android.util.Base64
import com.backspace.core.model.AdminInviteItem
import com.backspace.core.model.AdminInviteRedemption
import com.backspace.core.model.AdminInviteRedemptionsResponse
import com.backspace.core.model.AdminInviteWrapperResponse
import com.backspace.core.model.AdminInvitesListResponse
import com.backspace.core.model.AdminTelemetryStatus
import com.backspace.core.model.AdminUserItem
import com.backspace.core.model.AdminUsersPageResponse
import com.backspace.core.model.CategoryLayoutItem
import com.backspace.core.model.ChangePasswordResponse
import com.backspace.core.model.Channel
import com.backspace.core.model.ChannelCategory
import com.backspace.core.model.ChannelLayoutItem
import com.backspace.core.model.DmChannel
import com.backspace.core.model.DmMessage
import com.backspace.core.model.ExploreSpaceItem
import com.backspace.core.model.ExploreSpacesResponse
import com.backspace.core.model.FederationApprovalActionResponse
import com.backspace.core.model.FederationApprovalItem
import com.backspace.core.model.FederationApprovalsResponse
import com.backspace.core.model.FederationPeerItem
import com.backspace.core.model.FederationPeerRecheckResponse
import com.backspace.core.model.FederationPeerRotateResponse
import com.backspace.core.model.FederationPeersResponse
import com.backspace.core.model.FederationResetEventItem
import com.backspace.core.model.FederationResetEventsResponse
import com.backspace.core.model.FriendItem
import com.backspace.core.model.FriendRequestItem
import com.backspace.core.model.GifItem
import com.backspace.core.model.GifSearchResponse
import com.backspace.core.model.InstanceAdminSettings
import com.backspace.core.model.InstanceInfo
import com.backspace.core.model.InstanceStreamingLimits
import com.backspace.core.model.InstanceUpdateStatusResponse
import com.backspace.core.model.InviteCodeExtractor
import com.backspace.core.model.LiveKitTokenResponse
import com.backspace.core.model.MemberWithUser
import com.backspace.core.model.Message
import com.backspace.core.model.MessageAttachment
import com.backspace.core.model.OverridesResponse
import com.backspace.core.model.PermissionOverrideItem
import com.backspace.core.model.PutOverrideResponse
import com.backspace.core.model.ReattachAccountResponse
import com.backspace.core.model.ResetPasswordResponse
import com.backspace.core.model.Role
import com.backspace.core.model.SoundboardListResponse
import com.backspace.core.model.SoundboardSound
import com.backspace.core.model.SoundboardSpaceSettings
import com.backspace.core.model.SoundboardSpaceSettingsResponse
import com.backspace.core.model.Space
import com.backspace.core.model.SpaceBanItem
import com.backspace.core.model.SpaceInviteResponse
import com.backspace.core.model.SpaceJoinRequestItem
import com.backspace.core.model.SpaceJoinRequestsResponse
import com.backspace.core.model.StickerItem
import com.backspace.core.model.StorageCleanupResult
import com.backspace.core.model.StorageStatsResponse
import com.backspace.core.model.User
import com.backspace.core.model.UserMutualsResponse
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class RegisterRequest(
    val username: String,
    val password: String,
    val displayName: String? = null,
    val inviteToken: String? = null,
)

@Serializable
data class EditMessageRequest(val content: String)

@Serializable
data class CreateGroupDmUser(val userId: String)

@Serializable
data class CreateGroupDmRequest(val users: List<CreateGroupDmUser>)

@Serializable
data class CreateRoleRequest(val name: String, val color: String = "#7C6CF6")

@Serializable
data class BanMemberRequest(val userId: String, val reason: String? = null)

@Serializable
data class UpdateChannelNameRequest(val name: String)

@Serializable
data class LoginResponse(val token: String, val user: User)

@Serializable
data class LiveKitTokenRequest(
    val channelId: String? = null,
    val dmChannelId: String? = null,
)

@Serializable
data class CreateDmRequest(val userId: String)

@Serializable
data class CreateSpaceRequest(val name: String, val description: String? = null)

@Serializable
data class JoinSpaceRequest(val inviteCode: String)

@Serializable
data class CreateChannelRequest(val name: String, val type: String = "text")

@Serializable
data class CreateCategoryRequest(val name: String)

@Serializable
data class SendFriendRequestBody(val username: String)

@Serializable
data class RespondFriendRequestBody(val action: String)

@Serializable
data class UpdateSpaceAdminRequest(
    val name: String? = null,
    val description: String? = null,
    val audioBitrateKbps: Int? = null,
    val maxAudioBitrateKbps: Int? = null,
    val allowMusicMode: Boolean? = null,
    val allowStereoAudio: Boolean? = null,
)

@Serializable
data class SendMessageRequest(
    val content: String? = null,
    val attachments: List<String>? = null,
    val replyToId: String? = null,
)

@Serializable
data class UpdateMeRequest(
    val displayName: String? = null,
    val bio: String? = null,
    val avatar: String? = null,
    val status: String? = null,
    val customStatus: String? = null,
)

@Serializable
data class UploadStickerRequest(
    val name: String,
    val image: String,
)

@Serializable
data class ApiErrorResponse(
    val error: String = "Unknown error",
    val code: String? = null,
    val statusCode: Int = 0,
)

class BackspaceApiException(
    val statusCode: Int,
    val code: String?,
    override val message: String,
) : IOException(message)

class BackspaceRestClient(
    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build(),
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        isLenient = true
    },
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun getInstanceInfo(instanceUrl: String): InstanceInfo {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/instance/info", token = null)
    }

    suspend fun login(instanceUrl: String, username: String, password: String): LoginResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/auth/login",
            body = json.encodeToString(LoginRequest.serializer(), LoginRequest(username, password)),
            token = null,
        )
    }

    suspend fun register(
        instanceUrl: String,
        username: String,
        password: String,
        displayName: String? = null,
        inviteToken: String? = null,
    ): LoginResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/auth/register",
            body = json.encodeToString(
                RegisterRequest.serializer(),
                RegisterRequest(
                    username = username,
                    password = password,
                    displayName = displayName?.ifBlank { null },
                    inviteToken = inviteToken?.ifBlank { null },
                ),
            ),
            token = null,
        )
    }

    suspend fun getStreamingLimits(instanceUrl: String, token: String): InstanceStreamingLimits {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/settings/streaming", token = token)
    }

    suspend fun requestLiveKitToken(
        instanceUrl: String,
        token: String,
        channelId: String,
    ): LiveKitTokenResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/livekit/token",
            body = json.encodeToString(LiveKitTokenRequest.serializer(), LiveKitTokenRequest(channelId = channelId)),
            token = token,
        )
    }

    suspend fun requestLiveKitDmToken(
        instanceUrl: String,
        token: String,
        dmChannelId: String,
    ): LiveKitTokenResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/livekit/token",
            body = json.encodeToString(LiveKitTokenRequest.serializer(), LiveKitTokenRequest(dmChannelId = dmChannelId)),
            token = token,
        )
    }

    suspend fun getDmChannels(instanceUrl: String, token: String): List<DmChannel> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/dm", token = token)
    }

    suspend fun createOrOpenDm(instanceUrl: String, token: String, targetUserId: String): DmChannel {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/dm",
            body = json.encodeToString(CreateDmRequest.serializer(), CreateDmRequest(targetUserId)),
            token = token,
        )
    }

    suspend fun getDmMessages(
        instanceUrl: String,
        token: String,
        dmChannelId: String,
        limit: Int = 50,
    ): List<DmMessage> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/dm/$dmChannelId/messages?limit=$limit", token = token)
    }

    suspend fun sendDmMessage(
        instanceUrl: String,
        token: String,
        dmChannelId: String,
        content: String?,
        attachmentIds: List<String>? = null,
        replyToId: String? = null,
    ): DmMessage {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/dm/$dmChannelId/messages",
            body = json.encodeToString(
                SendMessageRequest.serializer(),
                SendMessageRequest(
                    content = content?.takeIf { it.isNotBlank() },
                    attachments = attachmentIds?.takeIf { it.isNotEmpty() },
                    replyToId = replyToId,
                ),
            ),
            token = token,
        )
    }

    suspend fun deleteDmMessage(
        instanceUrl: String,
        token: String,
        messageId: String,
    ) = withContext(Dispatchers.IO) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val req = Request.Builder()
            .url("$base/api/dm/messages/$messageId")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()
        okHttpClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw BackspaceApiException(resp.code, null, "Delete DM failed (HTTP ${resp.code})")
            }
        }
    }

    suspend fun updateSpaceSettings(
        instanceUrl: String,
        token: String,
        spaceId: String,
        request: UpdateSpaceAdminRequest,
    ): Space {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePatch(
            url = "$base/api/spaces/$spaceId",
            body = json.encodeToString(UpdateSpaceAdminRequest.serializer(), request),
            token = token,
        )
    }

    suspend fun getInstanceAdminSettings(
        instanceUrl: String,
        token: String,
    ): InstanceAdminSettings {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/settings/instance", token = token)
    }

    suspend fun updateInstanceAdminSettings(
        instanceUrl: String,
        token: String,
        settings: InstanceAdminSettings,
    ): InstanceAdminSettings {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("instanceName", JsonPrimitive(settings.instanceName))
            put("registrationOpen", JsonPrimitive(settings.registrationOpen))
            put("federatedRegistrationOpen", JsonPrimitive(settings.federatedRegistrationOpen))
            put("discoveryEnabled", JsonPrimitive(settings.discoveryEnabled))
            put("maxUploadSizeMb", JsonPrimitive(settings.maxUploadSizeMb))
            put("federationRelayEnabled", JsonPrimitive(settings.federationRelayEnabled))
            put("federationRelayTtlDays", JsonPrimitive(settings.federationRelayTtlDays))
            put("defaultAutoRotateIntervalDays", JsonPrimitive(settings.defaultAutoRotateIntervalDays))
            put("autoAcceptPeering", JsonPrimitive(settings.autoAcceptPeering))
            put("directoryEnabled", JsonPrimitive(settings.directoryEnabled))
            put("directoryBrowseEnabled", JsonPrimitive(settings.directoryBrowseEnabled))
            put("supportCardEnabled", JsonPrimitive(settings.supportCardEnabled))
            if (settings.gifApiKey != null) {
                put("gifApiKey", JsonPrimitive(settings.gifApiKey))
            }
        }.toString()
        return executePatch(
            url = "$base/api/settings/instance",
            body = payload,
            token = token,
        )
    }

    suspend fun updateStreamingLimits(
        instanceUrl: String,
        token: String,
        limits: InstanceStreamingLimits,
    ): InstanceStreamingLimits {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("maxBitrateKbps", JsonPrimitive(limits.maxBitrateKbps))
            put("minBitrateKbps", JsonPrimitive(limits.minBitrateKbps))
            put("bitrateStepKbps", JsonPrimitive(limits.bitrateStepKbps))
            put("maxResolution", JsonPrimitive(limits.maxResolution))
            put("maxFramerate", JsonPrimitive(limits.maxFramerate))
            put("allowCustomBitrate", JsonPrimitive(limits.allowCustomBitrate))
            put("soundboardEnabled", JsonPrimitive(limits.soundboardEnabled))
            put("maxSoundboardSoundsPerScope", JsonPrimitive(limits.maxSoundboardSoundsPerScope))
            put("maxConcurrentSoundboardSounds", JsonPrimitive(limits.maxConcurrentSoundboardSounds))
            if (limits.allowedResolutions.isNotEmpty()) {
                put(
                    "allowedResolutions",
                    buildJsonArray {
                        limits.allowedResolutions.forEach { res ->
                            val trimmed = res.trim()
                            if (trimmed.equals("native", ignoreCase = true)) {
                                add(JsonPrimitive("native"))
                            } else {
                                trimmed.toIntOrNull()?.let { add(JsonPrimitive(it)) }
                            }
                        }
                    },
                )
            }
            if (limits.allowedFramerates.isNotEmpty()) {
                put(
                    "allowedFramerates",
                    buildJsonArray {
                        limits.allowedFramerates.forEach { add(JsonPrimitive(it)) }
                    },
                )
            }
        }.toString()
        return executePatch(
            url = "$base/api/settings/streaming",
            body = payload,
            token = token,
        )
    }

    // ── GIFs & Stickers ──
    suspend fun getTrendingGifs(instanceUrl: String, token: String, limit: Int = 24): List<GifItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet<GifSearchResponse>("$base/api/gif/trending?limit=$limit", token = token).results
    }

    suspend fun searchGifs(instanceUrl: String, token: String, query: String, limit: Int = 24): List<GifItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val q = URLEncoder.encode(query.trim(), "UTF-8")
        return executeGet<GifSearchResponse>("$base/api/gif/search?q=$q&limit=$limit", token = token).results
    }

    suspend fun getStickers(instanceUrl: String, token: String): List<StickerItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/stickers", token = token)
    }

    suspend fun uploadSticker(
        instanceUrl: String,
        token: String,
        name: String,
        mimeType: String,
        bytes: ByteArray,
    ): StickerItem {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val dataUri = "data:$mimeType;base64,$b64"
        return executePost(
            url = "$base/api/stickers",
            body = json.encodeToString(UploadStickerRequest.serializer(), UploadStickerRequest(name, dataUri)),
            token = token,
        )
    }

    suspend fun deleteSticker(instanceUrl: String, token: String, stickerId: String) =
        withContext(Dispatchers.IO) {
            val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
            val req = Request.Builder()
                .url("$base/api/stickers/$stickerId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }

    // ── Espaços: Criar, Entrar por Convite, Descobrir, Gerar Convite, Canais/Categorias ──
    suspend fun createSpace(instanceUrl: String, token: String, name: String, description: String?): Space {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/spaces",
            body = json.encodeToString(
                CreateSpaceRequest.serializer(),
                CreateSpaceRequest(name = name, description = description?.ifBlank { null }),
            ),
            token = token,
        )
    }

    suspend fun joinSpaceByInvite(instanceUrl: String, token: String, rawInvite: String): Space {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val code = InviteCodeExtractor.extract(rawInvite)
        return executePost(
            url = "$base/api/spaces/join",
            body = json.encodeToString(JoinSpaceRequest.serializer(), JoinSpaceRequest(inviteCode = code)),
            token = token,
        )
    }

    suspend fun generateSpaceInvite(instanceUrl: String, token: String, spaceId: String): String {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost<SpaceInviteResponse>(
            url = "$base/api/spaces/$spaceId/invite",
            body = "{}",
            token = token,
        ).inviteCode
    }

    suspend fun exploreSpaces(instanceUrl: String, token: String, query: String = ""): List<ExploreSpaceItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val q = URLEncoder.encode(query.trim(), "UTF-8")
        return executeGet<ExploreSpacesResponse>("$base/api/spaces/explore?q=$q&limit=30", token = token).spaces
    }

    suspend fun publicJoinSpace(instanceUrl: String, token: String, spaceId: String) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$base/api/spaces/$spaceId/public-join")
                .header("Authorization", "Bearer $token")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    throw BackspaceApiException(resp.code, null, "Join failed (HTTP ${resp.code})")
                }
            }
        }
    }

    suspend fun createChannel(
        instanceUrl: String,
        token: String,
        spaceId: String,
        name: String,
        type: String,
    ): Channel {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/spaces/$spaceId/channels",
            body = json.encodeToString(CreateChannelRequest.serializer(), CreateChannelRequest(name, type)),
            token = token,
        )
    }

    suspend fun createCategory(
        instanceUrl: String,
        token: String,
        spaceId: String,
        name: String,
    ): ChannelCategory {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/spaces/$spaceId/categories",
            body = json.encodeToString(CreateCategoryRequest.serializer(), CreateCategoryRequest(name)),
            token = token,
        )
    }

    suspend fun getSpaces(instanceUrl: String, token: String): List<Space> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/spaces", token = token)
    }

    suspend fun getSpaceDetail(instanceUrl: String, token: String, spaceId: String): Space {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/spaces/$spaceId", token = token)
    }

    // ── Amigos (Social) ──
    suspend fun getFriends(instanceUrl: String, token: String): List<FriendItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/social/friends", token = token)
    }

    suspend fun getFriendRequests(instanceUrl: String, token: String): List<FriendRequestItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/social/requests", token = token)
    }

    suspend fun sendFriendRequest(instanceUrl: String, token: String, username: String) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$base/api/social/requests")
                .header("Authorization", "Bearer $token")
                .post(
                    json.encodeToString(
                        SendFriendRequestBody.serializer(),
                        SendFriendRequestBody(username.trim()),
                    ).toRequestBody(jsonMediaType),
                )
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val raw = resp.body?.string().orEmpty()
                    val parsed = runCatching { json.decodeFromString<ApiErrorResponse>(raw) }.getOrNull()
                    throw BackspaceApiException(resp.code, parsed?.code, parsed?.error ?: "HTTP ${resp.code}")
                }
            }
        }
    }

    suspend fun respondFriendRequest(instanceUrl: String, token: String, requestId: String, accept: Boolean) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$base/api/social/requests/$requestId")
                .header("Authorization", "Bearer $token")
                .patch(
                    json.encodeToString(
                        RespondFriendRequestBody.serializer(),
                        RespondFriendRequestBody(if (accept) "accept" else "decline"),
                    ).toRequestBody(jsonMediaType),
                )
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
                }
            }
        }
    }

    suspend fun getChannelMessages(
        instanceUrl: String,
        token: String,
        channelId: String,
        before: String? = null,
        limit: Int = 50,
    ): List<Message> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val query = buildString {
            append("limit=$limit")
            if (!before.isNullOrBlank()) append("&before=$before")
        }
        return executeGet("$base/api/channels/$channelId/messages?$query", token = token)
    }

    suspend fun sendMessage(
        instanceUrl: String,
        token: String,
        channelId: String,
        content: String?,
        attachmentIds: List<String>? = null,
        replyToId: String? = null,
    ): Message {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/channels/$channelId/messages",
            body = json.encodeToString(
                SendMessageRequest.serializer(),
                SendMessageRequest(
                    content = content?.takeIf { it.isNotBlank() },
                    attachments = attachmentIds?.takeIf { it.isNotEmpty() },
                    replyToId = replyToId,
                ),
            ),
            token = token,
        )
    }

    suspend fun deleteMessage(
        instanceUrl: String,
        token: String,
        messageId: String,
    ) = withContext(Dispatchers.IO) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val req = Request.Builder()
            .url("$base/api/messages/$messageId")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()
        okHttpClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw BackspaceApiException(resp.code, null, "Delete failed (HTTP ${resp.code})")
            }
        }
    }

    suspend fun editMessage(
        instanceUrl: String,
        token: String,
        messageId: String,
        content: String,
    ): Message {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePatch(
            url = "$base/api/messages/$messageId",
            body = json.encodeToString(EditMessageRequest.serializer(), EditMessageRequest(content)),
            token = token,
        )
    }

    suspend fun editDmMessage(
        instanceUrl: String,
        token: String,
        messageId: String,
        content: String,
    ): DmMessage {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePatch(
            url = "$base/api/dm/messages/$messageId",
            body = json.encodeToString(EditMessageRequest.serializer(), EditMessageRequest(content)),
            token = token,
        )
    }

    suspend fun createGroupDm(
        instanceUrl: String,
        token: String,
        userIds: List<String>,
    ): DmChannel {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/dm/group",
            body = json.encodeToString(
                CreateGroupDmRequest.serializer(),
                CreateGroupDmRequest(users = userIds.map { CreateGroupDmUser(it) }),
            ),
            token = token,
        )
    }

    suspend fun removeFriend(instanceUrl: String, token: String, friendUserId: String) =
        withContext(Dispatchers.IO) {
            val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
            val req = Request.Builder()
                .url("$base/api/social/friends/$friendUserId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }

    suspend fun renameChannel(instanceUrl: String, token: String, channelId: String, newName: String): Channel {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePatch(
            url = "$base/api/channels/$channelId",
            body = json.encodeToString(UpdateChannelNameRequest.serializer(), UpdateChannelNameRequest(newName)),
            token = token,
        )
    }

    suspend fun deleteChannel(instanceUrl: String, token: String, channelId: String) =
        withContext(Dispatchers.IO) {
            val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
            val req = Request.Builder()
                .url("$base/api/channels/$channelId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }

    suspend fun createRole(instanceUrl: String, token: String, spaceId: String, name: String, color: String): Role {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/spaces/$spaceId/roles",
            body = json.encodeToString(CreateRoleRequest.serializer(), CreateRoleRequest(name, color)),
            token = token,
        )
    }

    suspend fun deleteRole(instanceUrl: String, token: String, spaceId: String, roleId: String) =
        withContext(Dispatchers.IO) {
            val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
            val req = Request.Builder()
                .url("$base/api/spaces/$spaceId/roles/$roleId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }

    suspend fun kickMember(instanceUrl: String, token: String, spaceId: String, userId: String) =
        withContext(Dispatchers.IO) {
            val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
            val req = Request.Builder()
                .url("$base/api/spaces/$spaceId/members/$userId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }

    suspend fun getBans(instanceUrl: String, token: String, spaceId: String): List<SpaceBanItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/spaces/$spaceId/bans", token = token)
    }

    suspend fun banMember(instanceUrl: String, token: String, spaceId: String, userId: String, reason: String? = null) =
        withContext(Dispatchers.IO) {
            val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
            val req = Request.Builder()
                .url("$base/api/spaces/$spaceId/bans")
                .header("Authorization", "Bearer $token")
                .post(
                    json.encodeToString(
                        BanMemberRequest.serializer(),
                        BanMemberRequest(userId = userId, reason = reason?.ifBlank { null }),
                    ).toRequestBody(jsonMediaType),
                )
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }

    suspend fun unbanMember(instanceUrl: String, token: String, spaceId: String, userId: String) =
        withContext(Dispatchers.IO) {
            val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
            val req = Request.Builder()
                .url("$base/api/spaces/$spaceId/bans/$userId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
            okHttpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }

    /**
     * Faz upload de anexo via protocolo tus (`/api/files`) usado pelo servidor Backspace.
     */
    suspend fun uploadFileTus(
        instanceUrl: String,
        token: String,
        originalName: String,
        mimeType: String,
        bytes: ByteArray,
    ): MessageAttachment = withContext(Dispatchers.IO) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val b64Name = Base64.encodeToString(originalName.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val b64Type = Base64.encodeToString(mimeType.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)

        // 1. Criar sessão tus
        val createReq = Request.Builder()
            .url("$base/api/files")
            .header("Authorization", "Bearer $token")
            .header("Tus-Resumable", "1.0.0")
            .header("Upload-Length", bytes.size.toString())
            .header("Upload-Metadata", "filename $b64Name,filetype $b64Type")
            .post(ByteArray(0).toRequestBody(null))
            .build()

        val uploadLocation = okHttpClient.newCall(createReq).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw BackspaceApiException(resp.code, null, "Upload init failed (HTTP ${resp.code})")
            }
            resp.header("Location")
                ?: throw BackspaceApiException(500, null, "Missing tus Location header")
        }

        val patchUrl = if (uploadLocation.startsWith("http://") || uploadLocation.startsWith("https://")) {
            uploadLocation
        } else {
            "$base/${uploadLocation.trimStart('/')}"
        }

        // 2. Enviar bytes via PATCH
        val offsetMediaType = "application/offset+octet-stream".toMediaType()
        val patchReq = Request.Builder()
            .url(patchUrl)
            .header("Authorization", "Bearer $token")
            .header("Tus-Resumable", "1.0.0")
            .header("Upload-Offset", "0")
            .patch(bytes.toRequestBody(offsetMediaType))
            .build()

        okHttpClient.newCall(patchReq).execute().use { resp ->
            val raw = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                throw BackspaceApiException(resp.code, null, "Upload failed (HTTP ${resp.code})")
            }
            json.decodeFromString(MessageAttachment.serializer(), raw)
        }
    }

    suspend fun updateInstanceStreamingLimits(
        instanceUrl: String,
        token: String,
        limits: InstanceStreamingLimits,
    ): InstanceStreamingLimits = updateStreamingLimits(instanceUrl, token, limits)

    suspend fun updateMyStatus(
        instanceUrl: String,
        token: String,
        displayName: String? = null,
        bio: String? = null,
        avatar: String? = null,
        status: String? = null,
        customStatus: String? = null,
        avatarColor: String? = null,
        banner: String? = null,
        accentColor: String? = null,
        bannerColor: String? = null,
        discoverable: Boolean? = null,
        showActivity: Boolean? = null,
    ): User {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val effectiveAccent = accentColor ?: bannerColor
        val payload = buildJsonObject {
            if (displayName != null) put("displayName", JsonPrimitive(displayName))
            if (bio != null) put("bio", JsonPrimitive(bio))
            if (avatar != null) put("avatar", JsonPrimitive(avatar))
            if (status != null) put("status", JsonPrimitive(status))
            if (customStatus != null) put("customStatus", JsonPrimitive(customStatus))
            if (avatarColor != null) put("avatarColor", JsonPrimitive(avatarColor))
            if (banner != null) put("banner", JsonPrimitive(banner))
            if (effectiveAccent != null) put("accentColor", JsonPrimitive(effectiveAccent))
            if (discoverable != null) put("discoverable", JsonPrimitive(discoverable))
            if (showActivity != null) put("showActivity", JsonPrimitive(showActivity))
        }.toString()
        return executePatch(
            url = "$base/api/users/@me",
            body = payload,
            token = token,
        )
    }

    suspend fun updateProfile(
        instanceUrl: String,
        token: String,
        displayName: String? = null,
        bio: String? = null,
        avatar: String? = null,
        status: String? = null,
        customStatus: String? = null,
        avatarColor: String? = null,
        banner: String? = null,
        accentColor: String? = null,
        bannerColor: String? = null,
        discoverable: Boolean? = null,
        showActivity: Boolean? = null,
    ): User = updateMyStatus(
        instanceUrl = instanceUrl,
        token = token,
        displayName = displayName,
        bio = bio,
        avatar = avatar,
        status = status,
        customStatus = customStatus,
        avatarColor = avatarColor,
        banner = banner,
        accentColor = accentColor,
        bannerColor = bannerColor,
        discoverable = discoverable,
        showActivity = showActivity,
    )

    // ── Conta (@me) ──

    suspend fun changePassword(
        instanceUrl: String,
        token: String,
        currentPassword: String,
        newPassword: String,
    ): ChangePasswordResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("currentPassword", JsonPrimitive(currentPassword))
            put("newPassword", JsonPrimitive(newPassword))
        }.toString()
        return executePost(
            url = "$base/api/users/@me/change-password",
            body = payload,
            token = token,
        )
    }

    suspend fun deleteAccount(
        instanceUrl: String,
        token: String,
        password: String,
        username: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("password", JsonPrimitive(password))
            put("username", JsonPrimitive(username))
        }.toString()
        executeDeleteVoid(
            url = "$base/api/users/@me",
            token = token,
            body = payload,
        )
    }

    suspend fun reattachAccount(
        instanceUrl: String,
        token: String,
        attachToken: String,
    ): ReattachAccountResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("token", JsonPrimitive(attachToken.trim()))
        }.toString()
        return executePost(
            url = "$base/api/users/@me/reattach",
            body = payload,
            token = token,
        )
    }

    // ── Convites da Instância (Admin) ──

    suspend fun getAdminInvites(
        instanceUrl: String,
        token: String,
        status: String? = null,
    ): List<AdminInviteItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val query = if (!status.isNullOrBlank()) "?status=${URLEncoder.encode(status, "UTF-8")}" else ""
        return executeGet<AdminInvitesListResponse>("$base/api/admin/invites$query", token = token).invites
    }

    suspend fun createAdminInvite(
        instanceUrl: String,
        token: String,
        name: String,
        maxUses: Int? = null,
        expiresInHours: Int? = null,
    ): AdminInviteItem {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val expiresAt = expiresInHours?.takeIf { it > 0 }?.let {
            System.currentTimeMillis() + it.toLong() * 3_600_000L
        }
        val payload = buildJsonObject {
            put("name", JsonPrimitive(name.trim()))
            if (maxUses != null && maxUses > 0) {
                put("maxUses", JsonPrimitive(maxUses))
            } else {
                put("maxUses", JsonNull)
            }
            if (expiresAt != null) {
                put("expiresAt", JsonPrimitive(expiresAt))
            } else {
                put("expiresAt", JsonNull)
            }
        }.toString()
        return executePost(
            url = "$base/api/admin/invites",
            body = payload,
            token = token,
        )
    }

    suspend fun revokeAdminInvite(
        instanceUrl: String,
        token: String,
        id: String,
    ): AdminInviteItem {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val resp = executePost<AdminInviteWrapperResponse>(
            url = "$base/api/admin/invites/$id/revoke",
            body = "{}",
            token = token,
        )
        return resp.invite ?: AdminInviteItem(id = id, status = "revoked")
    }

    suspend fun reinstateAdminInvite(
        instanceUrl: String,
        token: String,
        id: String,
        maxUses: Int? = null,
        expiresInHours: Int? = null,
    ): AdminInviteItem {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            if (maxUses != null && maxUses > 0) {
                put("maxUses", JsonPrimitive(maxUses))
            }
            if (expiresInHours != null && expiresInHours > 0) {
                put("expiresAt", JsonPrimitive(System.currentTimeMillis() + expiresInHours.toLong() * 3_600_000L))
            }
        }.toString()
        val resp = executePost<AdminInviteWrapperResponse>(
            url = "$base/api/admin/invites/$id/reinstate",
            body = payload,
            token = token,
        )
        return resp.invite ?: AdminInviteItem(id = id, status = "active")
    }

    suspend fun deleteAdminInvite(
        instanceUrl: String,
        token: String,
        id: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid("$base/api/admin/invites/$id", token = token)
    }

    suspend fun getAdminInviteRedemptions(
        instanceUrl: String,
        token: String,
        id: String,
    ): List<AdminInviteRedemption> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet<AdminInviteRedemptionsResponse>(
            "$base/api/admin/invites/$id/redemptions",
            token = token,
        ).redemptions
    }

    // ── Federação (Admin) ──

    suspend fun getFederationPeers(
        instanceUrl: String,
        token: String,
    ): List<FederationPeerItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet<FederationPeersResponse>("$base/api/federation/peers", token = token).peers
    }

    suspend fun recheckFederationPeer(
        instanceUrl: String,
        token: String,
        id: String,
    ): FederationPeerRecheckResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/federation/peers/$id/recheck",
            body = "{}",
            token = token,
        )
    }

    suspend fun rotateFederationPeer(
        instanceUrl: String,
        token: String,
        id: String,
    ): FederationPeerRotateResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/federation/peers/$id/rotate",
            body = "{}",
            token = token,
        )
    }

    suspend fun revokeFederationPeer(
        instanceUrl: String,
        token: String,
        id: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid("$base/api/federation/peers/$id", token = token)
    }

    suspend fun resetFederationPeer(
        instanceUrl: String,
        token: String,
        id: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executePostVoid("$base/api/federation/peers/$id/reset", body = "{}", token = token)
    }

    suspend fun deleteFederationPeerPermanent(
        instanceUrl: String,
        token: String,
        id: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid("$base/api/federation/peers/$id/permanent", token = token)
    }

    suspend fun getFederationApprovals(
        instanceUrl: String,
        token: String,
    ): List<FederationApprovalItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet<FederationApprovalsResponse>(
            "$base/api/federation/approval-requests",
            token = token,
        ).requests
    }

    suspend fun approveFederationRequest(
        instanceUrl: String,
        token: String,
        id: String,
    ): FederationApprovalActionResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/federation/approval-requests/$id/approve",
            body = "{}",
            token = token,
        )
    }

    suspend fun denyFederationRequest(
        instanceUrl: String,
        token: String,
        id: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executePostVoid(
            url = "$base/api/federation/approval-requests/$id/deny",
            body = "{}",
            token = token,
        )
    }

    suspend fun getFederationResetEvents(
        instanceUrl: String,
        token: String,
    ): List<FederationResetEventItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet<FederationResetEventsResponse>(
            "$base/api/federation/reset-events",
            token = token,
        ).events
    }

    suspend fun acknowledgeFederationReset(
        instanceUrl: String,
        token: String,
        origin: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("origin", JsonPrimitive(origin))
        }.toString()
        executePostVoid(
            url = "$base/api/federation/reset-events/acknowledge",
            body = payload,
            token = token,
        )
    }

    // ── Armazenamento (Admin) ──

    suspend fun getAdminStorageStats(
        instanceUrl: String,
        token: String,
    ): StorageStatsResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/admin/storage/stats", token = token)
    }

    suspend fun cleanupAdminStorage(
        instanceUrl: String,
        token: String,
        dryRun: Boolean = false,
    ): StorageCleanupResult {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("dryRun", JsonPrimitive(dryRun))
        }.toString()
        return executePost(
            url = "$base/api/admin/storage/cleanup",
            body = payload,
            token = token,
        )
    }

    suspend fun cleanupAdminMedia(
        instanceUrl: String,
        token: String,
        olderThanDays: Int,
        dryRun: Boolean = false,
    ): StorageCleanupResult {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("maxAgeDays", JsonPrimitive(olderThanDays))
            put("dryRun", JsonPrimitive(dryRun))
        }.toString()
        return executePost(
            url = "$base/api/admin/storage/cleanup-media",
            body = payload,
            token = token,
        )
    }

    suspend fun cleanupAdminTus(
        instanceUrl: String,
        token: String,
        olderThanHours: Int,
        dryRun: Boolean = false,
    ): StorageCleanupResult {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("maxAgeHours", JsonPrimitive(olderThanHours))
            put("dryRun", JsonPrimitive(dryRun))
        }.toString()
        return executePost(
            url = "$base/api/admin/storage/cleanup-tus",
            body = payload,
            token = token,
        )
    }

    // ── Usuários (Admin) ──

    suspend fun getAdminUsers(
        instanceUrl: String,
        token: String,
        q: String? = null,
        role: String? = null,
        showDeleted: Boolean = false,
        page: Int = 1,
    ): AdminUsersPageResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val params = mutableListOf<String>()
        params.add("page=${page.coerceAtLeast(1)}")
        params.add("showDeleted=$showDeleted")
        if (!q.isNullOrBlank()) {
            params.add("q=${URLEncoder.encode(q.trim(), "UTF-8")}")
        }
        if (!role.isNullOrBlank() && role != "all") {
            params.add("role=${URLEncoder.encode(role, "UTF-8")}")
        }
        return executeGet("$base/api/admin/users?${params.joinToString("&")}", token = token)
    }

    suspend fun updateAdminUserRole(
        instanceUrl: String,
        token: String,
        userId: String,
        isAdmin: Boolean,
    ): AdminUserItem {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("isAdmin", JsonPrimitive(isAdmin))
        }.toString()
        return executePatch(
            url = "$base/api/admin/users/$userId/role",
            body = payload,
            token = token,
        )
    }

    suspend fun resetAdminUserPassword(
        instanceUrl: String,
        token: String,
        userId: String,
    ): ResetPasswordResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executePost(
            url = "$base/api/admin/users/$userId/reset-password",
            body = "{}",
            token = token,
        )
    }

    suspend fun deleteAdminUser(
        instanceUrl: String,
        token: String,
        userId: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid("$base/api/admin/users/$userId", token = token)
    }

    // ── Atualizações & Telemetria (Admin) ──

    suspend fun getAdminUpdateStatus(
        instanceUrl: String,
        token: String,
        refresh: Boolean = false,
    ): InstanceUpdateStatusResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val query = if (refresh) "?refresh=true" else ""
        return executeGet("$base/api/admin/instance/update-status$query", token = token)
    }

    suspend fun getAdminTelemetry(
        instanceUrl: String,
        token: String,
    ): AdminTelemetryStatus {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/admin/telemetry", token = token)
    }

    suspend fun updateAdminTelemetry(
        instanceUrl: String,
        token: String,
        enabled: Boolean,
    ): AdminTelemetryStatus {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("enabled", JsonPrimitive(enabled))
        }.toString()
        return executePut(
            url = "$base/api/admin/telemetry",
            body = payload,
            token = token,
        )
    }

    suspend fun getAdminTelemetryPreview(
        instanceUrl: String,
        token: String,
    ): String {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGetRaw("$base/api/admin/telemetry/preview", token = token)
    }

    suspend fun getSoundboard(
        instanceUrl: String,
        token: String,
        spaceId: String,
    ): SoundboardListResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/soundboard?spaceId=$spaceId", token = token)
    }

    suspend fun uploadSoundboardSound(
        instanceUrl: String,
        token: String,
        spaceId: String,
        name: String,
        emoji: String,
        folder: String?,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): SoundboardSound = withContext(Dispatchers.IO) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val body = okhttp3.MultipartBody.Builder()
            .setType(okhttp3.MultipartBody.FORM)
            .addFormDataPart("name", name)
            .addFormDataPart("emoji", emoji.ifBlank { "🔊" })
            .addFormDataPart("scopeType", "space")
            .addFormDataPart("scopeId", spaceId)
            .apply {
                if (!folder.isNullOrBlank()) addFormDataPart("folder", folder.trim())
            }
            .addFormDataPart(
                "file",
                fileName,
                bytes.toRequestBody(mimeType.toMediaType()),
            )
            .build()
        val req = Request.Builder()
            .url("$base/api/soundboard")
            .header("Authorization", "Bearer $token")
            .post(body)
            .build()
        executeAndDecode(req)
    }

    suspend fun updateSoundboardSound(
        instanceUrl: String,
        token: String,
        soundId: String,
        name: String,
        emoji: String,
        folder: String?,
    ): SoundboardSound {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = kotlinx.serialization.json.buildJsonObject {
            put("name", kotlinx.serialization.json.JsonPrimitive(name))
            put("emoji", kotlinx.serialization.json.JsonPrimitive(emoji.ifBlank { "🔊" }))
            if (folder.isNullOrBlank()) {
                put("folder", kotlinx.serialization.json.JsonNull)
            } else {
                put("folder", kotlinx.serialization.json.JsonPrimitive(folder.trim()))
            }
        }.toString()
        return executePatch("$base/api/soundboard/$soundId", payload, token = token)
    }

    suspend fun deleteSoundboardSound(
        instanceUrl: String,
        token: String,
        soundId: String,
    ) = withContext(Dispatchers.IO) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val req = Request.Builder()
            .url("$base/api/soundboard/$soundId")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()
        okHttpClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw BackspaceApiException(resp.code, null, "HTTP ${resp.code}")
            }
        }
    }

    // ── Administração de Espaço (Fase 2) ──

    suspend fun updateSpaceFull(
        instanceUrl: String,
        token: String,
        spaceId: String,
        name: String? = null,
        description: String? = null,
        icon: String? = null,
        banner: String? = null,
        visibility: String? = null,
        directoryListed: Boolean? = null,
        defaultAudioBitrateKbps: Int? = null,
        maxAudioBitrateKbps: Int? = null,
        allowMusicMode: Boolean? = null,
        allowStereoAudio: Boolean? = null,
    ): Space {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            if (name != null) put("name", JsonPrimitive(name))
            if (description != null) put("description", JsonPrimitive(description))
            if (icon != null) put("icon", JsonPrimitive(icon))
            if (banner != null) put("banner", JsonPrimitive(banner))
            if (visibility != null) put("visibility", JsonPrimitive(visibility))
            if (directoryListed != null) put("directoryListed", JsonPrimitive(directoryListed))
            if (defaultAudioBitrateKbps != null) put("audioBitrateKbps", JsonPrimitive(defaultAudioBitrateKbps))
            if (maxAudioBitrateKbps != null) put("maxAudioBitrateKbps", JsonPrimitive(maxAudioBitrateKbps))
            if (allowMusicMode != null) put("allowMusicMode", JsonPrimitive(allowMusicMode))
            if (allowStereoAudio != null) put("allowStereoAudio", JsonPrimitive(allowStereoAudio))
        }.toString()
        return executePatch(
            url = "$base/api/spaces/$spaceId",
            body = payload,
            token = token,
        )
    }

    suspend fun deleteSpace(
        instanceUrl: String,
        token: String,
        spaceId: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid("$base/api/spaces/$spaceId", token = token)
    }

    suspend fun leaveSpace(
        instanceUrl: String,
        token: String,
        spaceId: String,
        myUserId: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid("$base/api/spaces/$spaceId/members/$myUserId", token = token)
    }

    suspend fun transferSpaceOwnership(
        instanceUrl: String,
        token: String,
        spaceId: String,
        newOwnerId: String,
    ): Space {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("newOwnerId", JsonPrimitive(newOwnerId))
        }.toString()
        return executePatch(
            url = "$base/api/spaces/$spaceId/transfer-ownership",
            body = payload,
            token = token,
        )
    }

    suspend fun getSpaceJoinRequests(
        instanceUrl: String,
        token: String,
        spaceId: String,
    ): List<SpaceJoinRequestItem> {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet<SpaceJoinRequestsResponse>(
            "$base/api/spaces/$spaceId/join-requests",
            token = token,
        ).requests
    }

    suspend fun handleSpaceJoinRequest(
        instanceUrl: String,
        token: String,
        spaceId: String,
        requestId: String,
        action: String,
    ): SpaceJoinRequestItem {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("action", JsonPrimitive(action))
        }.toString()
        return executePatch(
            url = "$base/api/spaces/$spaceId/join-requests/$requestId",
            body = payload,
            token = token,
        )
    }

    // ── Membros & Cargos (Fase 2) ──

    suspend fun updateMemberNickname(
        instanceUrl: String,
        token: String,
        spaceId: String,
        userId: String,
        nickname: String?,
    ): MemberWithUser {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            val trimmed = nickname?.trim()
            if (trimmed.isNullOrEmpty()) {
                put("nickname", JsonNull)
            } else {
                put("nickname", JsonPrimitive(trimmed))
            }
        }.toString()
        return executePatch(
            url = "$base/api/spaces/$spaceId/members/$userId",
            body = payload,
            token = token,
        )
    }

    suspend fun assignMemberRole(
        instanceUrl: String,
        token: String,
        spaceId: String,
        userId: String,
        roleId: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("roleId", JsonPrimitive(roleId))
        }.toString()
        executePostVoid(
            url = "$base/api/spaces/$spaceId/members/$userId/roles",
            body = payload,
            token = token,
        )
    }

    suspend fun removeMemberRole(
        instanceUrl: String,
        token: String,
        spaceId: String,
        userId: String,
        roleId: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid(
            url = "$base/api/spaces/$spaceId/members/$userId/roles/$roleId",
            token = token,
        )
    }

    suspend fun updateRole(
        instanceUrl: String,
        token: String,
        spaceId: String,
        roleId: String,
        name: String? = null,
        color: String? = null,
        permissions: String? = null,
        position: Int? = null,
        permissionsVersion: String? = null,
    ): Role {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            if (name != null) put("name", JsonPrimitive(name))
            if (color != null) put("color", JsonPrimitive(color))
            if (permissions != null) put("permissions", JsonPrimitive(permissions))
            if (position != null) put("position", JsonPrimitive(position))
            if (permissionsVersion != null) put("permissionsVersion", JsonPrimitive(permissionsVersion))
        }.toString()
        return executePatch(
            url = "$base/api/spaces/$spaceId/roles/$roleId",
            body = payload,
            token = token,
        )
    }

    // ── Canais, Categorias, Overrides & Layout (Fase 2) ──

    suspend fun createChannelInCategory(
        instanceUrl: String,
        token: String,
        spaceId: String,
        name: String,
        type: String,
        topic: String? = null,
        categoryId: String? = null,
    ): Channel {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("name", JsonPrimitive(name))
            put("type", JsonPrimitive(type))
            if (!topic.isNullOrBlank()) put("topic", JsonPrimitive(topic.trim()))
            if (!categoryId.isNullOrBlank()) put("categoryId", JsonPrimitive(categoryId))
        }.toString()
        return executePost(
            url = "$base/api/spaces/$spaceId/channels",
            body = payload,
            token = token,
        )
    }

    suspend fun updateChannelFull(
        instanceUrl: String,
        token: String,
        channelId: String,
        name: String? = null,
        topic: String? = null,
        categoryId: String? = null,
        defaultAudioBitrateKbps: Int? = null,
        maxAudioBitrateKbps: Int? = null,
        allowMusicMode: Boolean? = null,
        allowStereoAudio: Boolean? = null,
    ): Channel {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            if (name != null) put("name", JsonPrimitive(name))
            if (topic != null) put("topic", JsonPrimitive(topic))
            if (categoryId != null) {
                if (categoryId.isBlank()) {
                    put("categoryId", JsonNull)
                } else {
                    put("categoryId", JsonPrimitive(categoryId))
                }
            }
            if (defaultAudioBitrateKbps != null) put("audioBitrateKbps", JsonPrimitive(defaultAudioBitrateKbps))
            if (maxAudioBitrateKbps != null) put("maxAudioBitrateKbps", JsonPrimitive(maxAudioBitrateKbps))
            if (allowMusicMode != null) put("allowMusicMode", JsonPrimitive(allowMusicMode))
            if (allowStereoAudio != null) put("allowStereoAudio", JsonPrimitive(allowStereoAudio))
        }.toString()
        return executePatch(
            url = "$base/api/channels/$channelId",
            body = payload,
            token = token,
        )
    }

    suspend fun getChannelOverrides(
        instanceUrl: String,
        token: String,
        channelId: String,
    ): OverridesResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val raw = executeGetRaw("$base/api/channels/$channelId/overrides", token = token)
        return decodeOverridesResponse(raw)
    }

    suspend fun putChannelOverride(
        instanceUrl: String,
        token: String,
        channelId: String,
        targetType: String,
        targetId: String,
        allow: String,
        deny: String,
        overrideVersion: String? = null,
    ): OverridesResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("targetType", JsonPrimitive(targetType))
            put("targetId", JsonPrimitive(targetId))
            put("allow", JsonPrimitive(allow))
            put("deny", JsonPrimitive(deny))
            if (!overrideVersion.isNullOrBlank()) put("version", JsonPrimitive(overrideVersion))
        }.toString()
        val resp = executePut<PutOverrideResponse>(
            url = "$base/api/channels/$channelId/overrides",
            body = payload,
            token = token,
        )
        return OverridesResponse(
            overrides = listOf(
                PermissionOverrideItem(
                    targetType = targetType,
                    targetId = targetId,
                    allow = allow,
                    deny = deny,
                    version = resp.version,
                ),
            ),
            overrideVersion = resp.version,
        )
    }

    suspend fun deleteChannelOverride(
        instanceUrl: String,
        token: String,
        channelId: String,
        targetType: String,
        targetId: String,
        overrideVersion: String? = null,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val query = if (!overrideVersion.isNullOrBlank()) {
            "?version=${URLEncoder.encode(overrideVersion, "UTF-8")}"
        } else {
            ""
        }
        executeDeleteVoid(
            url = "$base/api/channels/$channelId/overrides/$targetType/$targetId$query",
            token = token,
        )
    }

    suspend fun updateCategory(
        instanceUrl: String,
        token: String,
        categoryId: String,
        name: String? = null,
        defaultAudioBitrateKbps: Int? = null,
        maxAudioBitrateKbps: Int? = null,
        allowMusicMode: Boolean? = null,
        allowStereoAudio: Boolean? = null,
    ): ChannelCategory {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            if (name != null) put("name", JsonPrimitive(name))
            if (defaultAudioBitrateKbps != null) put("audioBitrateKbps", JsonPrimitive(defaultAudioBitrateKbps))
            if (maxAudioBitrateKbps != null) put("maxAudioBitrateKbps", JsonPrimitive(maxAudioBitrateKbps))
            if (allowMusicMode != null) put("allowMusicMode", JsonPrimitive(allowMusicMode))
            if (allowStereoAudio != null) put("allowStereoAudio", JsonPrimitive(allowStereoAudio))
        }.toString()
        return executePatch(
            url = "$base/api/categories/$categoryId",
            body = payload,
            token = token,
        )
    }

    suspend fun deleteCategory(
        instanceUrl: String,
        token: String,
        categoryId: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        executeDeleteVoid("$base/api/categories/$categoryId", token = token)
    }

    suspend fun getCategoryOverrides(
        instanceUrl: String,
        token: String,
        categoryId: String,
    ): OverridesResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val raw = executeGetRaw("$base/api/categories/$categoryId/overrides", token = token)
        return decodeOverridesResponse(raw)
    }

    suspend fun putCategoryOverride(
        instanceUrl: String,
        token: String,
        categoryId: String,
        targetType: String,
        targetId: String,
        allow: String,
        deny: String,
        overrideVersion: String? = null,
    ): OverridesResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("targetType", JsonPrimitive(targetType))
            put("targetId", JsonPrimitive(targetId))
            put("allow", JsonPrimitive(allow))
            put("deny", JsonPrimitive(deny))
            if (!overrideVersion.isNullOrBlank()) put("version", JsonPrimitive(overrideVersion))
        }.toString()
        val resp = executePut<PutOverrideResponse>(
            url = "$base/api/categories/$categoryId/overrides",
            body = payload,
            token = token,
        )
        return OverridesResponse(
            overrides = listOf(
                PermissionOverrideItem(
                    targetType = targetType,
                    targetId = targetId,
                    allow = allow,
                    deny = deny,
                    version = resp.version,
                ),
            ),
            overrideVersion = resp.version,
        )
    }

    suspend fun deleteCategoryOverride(
        instanceUrl: String,
        token: String,
        categoryId: String,
        targetType: String,
        targetId: String,
        overrideVersion: String? = null,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val query = if (!overrideVersion.isNullOrBlank()) {
            "?version=${URLEncoder.encode(overrideVersion, "UTF-8")}"
        } else {
            ""
        }
        executeDeleteVoid(
            url = "$base/api/categories/$categoryId/overrides/$targetType/$targetId$query",
            token = token,
        )
    }

    suspend fun updateChannelLayout(
        instanceUrl: String,
        token: String,
        spaceId: String,
        channels: List<ChannelLayoutItem>,
        categories: List<CategoryLayoutItem>,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put(
                "channels",
                buildJsonArray {
                    channels.forEach { ch ->
                        add(
                            buildJsonObject {
                                put("id", JsonPrimitive(ch.id))
                                put("position", JsonPrimitive(ch.position))
                                if (ch.categoryId == null) {
                                    put("categoryId", JsonNull)
                                } else {
                                    put("categoryId", JsonPrimitive(ch.categoryId))
                                }
                            },
                        )
                    }
                },
            )
            put(
                "categories",
                buildJsonArray {
                    categories.forEach { cat ->
                        add(
                            buildJsonObject {
                                put("id", JsonPrimitive(cat.id))
                                put("position", JsonPrimitive(cat.position))
                                if (cat.parentId != null) {
                                    put("parentId", JsonPrimitive(cat.parentId))
                                }
                            },
                        )
                    }
                },
            )
        }.toString()
        executePatchVoid(
            url = "$base/api/spaces/$spaceId/channel-layout",
            body = payload,
            token = token,
        )
    }

    // ── Convite por DM, Soundboard do Espaço e Perfil de Usuário (Fase 2) ──

    suspend fun sendSpaceInviteDm(
        instanceUrl: String,
        token: String,
        targetUserId: String,
        spaceId: String,
        inviteCode: String,
    ) {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("spaceId", JsonPrimitive(spaceId))
            put("inviteCode", JsonPrimitive(inviteCode))
            put(
                "target",
                buildJsonObject {
                    put("userId", JsonPrimitive(targetUserId))
                },
            )
        }.toString()
        executePostVoid(
            url = "$base/api/dm/space-invite",
            body = payload,
            token = token,
        )
    }

    suspend fun updateSoundboardSpaceSettings(
        instanceUrl: String,
        token: String,
        spaceId: String,
        enabled: Boolean,
        allowInstanceSounds: Boolean,
        maxConcurrent: Int? = null,
    ): SoundboardSpaceSettings {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        val payload = buildJsonObject {
            put("spaceId", JsonPrimitive(spaceId))
            put("soundboardEnabled", JsonPrimitive(enabled))
            put("allowInstanceSounds", JsonPrimitive(allowInstanceSounds))
            if (maxConcurrent != null) {
                put("maxConcurrentSounds", JsonPrimitive(maxConcurrent))
            } else {
                put("maxConcurrentSounds", JsonNull)
            }
        }.toString()
        return executePut<SoundboardSpaceSettingsResponse>(
            url = "$base/api/soundboard/space-settings",
            body = payload,
            token = token,
        ).spaceSettings
    }

    suspend fun getUserProfile(
        instanceUrl: String,
        token: String,
        userId: String,
    ): User {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/users/$userId", token = token)
    }

    suspend fun getUserMutuals(
        instanceUrl: String,
        token: String,
        userId: String,
    ): UserMutualsResponse {
        val base = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
        return executeGet("$base/api/users/$userId/mutuals", token = token)
    }

    private fun decodeOverridesResponse(raw: String): OverridesResponse {
        val trimmed = raw.trimStart()
        return if (trimmed.startsWith("[")) {
            val list = json.decodeFromString<List<PermissionOverrideItem>>(trimmed)
            OverridesResponse(
                overrides = list,
                overrideVersion = list.firstOrNull()?.version,
            )
        } else {
            json.decodeFromString<OverridesResponse>(trimmed)
        }
    }

    private suspend fun executePatchVoid(url: String, body: String, token: String?) =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder()
                .url(url)
                .patch(body.toRequestBody(jsonMediaType))
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            executeVoid(reqBuilder.build())
        }

    private suspend inline fun <reified T> executePatch(url: String, body: String, token: String?): T =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder()
                .url(url)
                .patch(body.toRequestBody(jsonMediaType))
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            executeAndDecode(reqBuilder.build())
        }

    private suspend inline fun <reified T> executeGet(url: String, token: String?): T =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder().url(url).get()
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            executeAndDecode(reqBuilder.build())
        }

    private suspend inline fun <reified T> executePost(url: String, body: String, token: String?): T =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder()
                .url(url)
                .post(body.toRequestBody(jsonMediaType))
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            executeAndDecode(reqBuilder.build())
        }

    private suspend inline fun <reified T> executePut(url: String, body: String, token: String?): T =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder()
                .url(url)
                .put(body.toRequestBody(jsonMediaType))
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            executeAndDecode(reqBuilder.build())
        }

    private suspend fun executePostVoid(url: String, body: String, token: String?) =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder()
                .url(url)
                .post(body.toRequestBody(jsonMediaType))
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            executeVoid(reqBuilder.build())
        }

    private suspend fun executeDeleteVoid(url: String, token: String?, body: String? = null) =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder().url(url)
            if (body != null) {
                reqBuilder.delete(body.toRequestBody(jsonMediaType))
            } else {
                reqBuilder.delete()
            }
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            executeVoid(reqBuilder.build())
        }

    private suspend fun executeGetRaw(url: String, token: String?): String =
        withContext(Dispatchers.IO) {
            val reqBuilder = Request.Builder().url(url).get()
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            okHttpClient.newCall(reqBuilder.build()).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val parsed = runCatching { json.decodeFromString<ApiErrorResponse>(raw) }.getOrNull()
                    throw BackspaceApiException(
                        statusCode = response.code,
                        code = parsed?.code,
                        message = parsed?.error ?: "HTTP ${response.code}",
                    )
                }
                raw
            }
        }

    private fun executeVoid(request: Request) {
        okHttpClient.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val parsed = runCatching { json.decodeFromString<ApiErrorResponse>(raw) }.getOrNull()
                throw BackspaceApiException(
                    statusCode = response.code,
                    code = parsed?.code,
                    message = parsed?.error ?: "HTTP ${response.code}",
                )
            }
        }
    }

    private inline fun <reified T> executeAndDecode(request: Request): T {
        okHttpClient.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val parsed = runCatching { json.decodeFromString<ApiErrorResponse>(raw) }.getOrNull()
                throw BackspaceApiException(
                    statusCode = response.code,
                    code = parsed?.code,
                    message = parsed?.error ?: "HTTP ${response.code}",
                )
            }
            return json.decodeFromString(raw)
        }
    }
}
