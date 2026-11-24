package com.backspace.core.model

import kotlinx.serialization.Serializable

@Serializable
data class MessageAttachment(
    val id: String = "",
    val messageId: String = "",
    val filename: String = "",
    val originalName: String = "",
    val mimetype: String = "",
    val size: Long = 0L,
    val thumbnailFilename: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val duration: Double? = null,
    val createdAt: Long = 0L,
) {
    val displayName: String get() = originalName.ifBlank { filename }
    val isImage: Boolean
        get() = mimetype.startsWith("image/", ignoreCase = true) ||
            displayName.lowercase().let { n ->
                n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") ||
                    n.endsWith(".webp") || n.endsWith(".gif") || n.endsWith(".avif")
            }

    fun resolvedFileUrl(instanceUrl: String): String =
        UploadUrlResolver.resolve(instanceUrl, filename).orEmpty()

    fun resolvedThumbnailUrl(instanceUrl: String): String =
        UploadUrlResolver.resolve(instanceUrl, thumbnailFilename) ?: resolvedFileUrl(instanceUrl)

    fun downloadPath(): String = "/api/uploads/$filename"
}

@Serializable
data class MessageReaction(
    val id: String = "",
    val messageId: String = "",
    val userId: String = "",
    val emoji: String = "",
    val createdAt: Long = 0L,
    val user: User? = null,
)

@Serializable
data class MessageEmbed(
    val id: String = "",
    val type: String = "generic",
    val url: String = "",
    val title: String? = null,
    val description: String? = null,
    val siteName: String? = null,
    val imageUrl: String? = null,
    val thumbnailUrl: String? = null,
    val color: String? = null,
)

@Serializable
data class Message(
    val id: String,
    val channelId: String,
    val userId: String = "",
    val content: String? = null,
    val type: String = "user",
    val createdAt: Long = 0L,
    val editedAt: Long? = null,
    val replyToId: String? = null,
    val replyTo: Message? = null,
    val user: User? = null,
    val attachments: List<MessageAttachment> = emptyList(),
    val embeds: List<MessageEmbed> = emptyList(),
    val reactions: List<MessageReaction> = emptyList(),
    val mentionEveryone: Boolean = false,
    val mentionRoleIds: List<String> = emptyList(),
) {
    val authorLabel: String get() = user?.label ?: userId
    val safeContent: String get() = content.orEmpty()
}

data class PendingAttachmentPayload(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
) {
    val isImage: Boolean get() = mimeType.startsWith("image/", ignoreCase = true)
}

data class QueuedOutgoingMessage(
    val localId: String,
    val channelId: String,
    val isDm: Boolean = false,
    val content: String?,
    val replyToId: String? = null,
    val attachments: List<PendingAttachmentPayload> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
)

@Serializable
data class DmChannel(
    val id: String,
    val name: String? = null,
    val icon: String? = null,
    val ownerId: String? = null,
    val createdAt: Long = 0L,
    val members: List<User> = emptyList(),
) {
    val isGroup: Boolean get() = members.size > 2 || !name.isNullOrBlank()

    fun displayTitle(myUserId: String?): String {
        if (!name.isNullOrBlank()) return name
        val others = members.filter { it.id != myUserId }
        return if (others.isEmpty()) {
            members.firstOrNull()?.label ?: "DM"
        } else {
            others.joinToString(", ") { it.label }
        }
    }

    fun avatarUrl(instanceUrl: String, myUserId: String?): String? {
        if (!icon.isNullOrBlank()) return "$instanceUrl/api/uploads/$icon"
        val other = members.firstOrNull { it.id != myUserId } ?: members.firstOrNull()
        return other?.avatarUrl(instanceUrl)
    }
}

@Serializable
data class DmMessage(
    val id: String,
    val dmChannelId: String = "",
    val userId: String = "",
    val content: String? = null,
    val type: String = "user",
    val createdAt: Long = 0L,
    val editedAt: Long? = null,
    val replyToId: String? = null,
    val replyTo: DmMessage? = null,
    val user: User? = null,
    val attachments: List<MessageAttachment> = emptyList(),
    val reactions: List<MessageReaction> = emptyList(),
    val mentionEveryone: Boolean = false,
    val mentionRoleIds: List<String> = emptyList(),
) {
    val authorLabel: String get() = user?.label ?: userId
    val safeContent: String get() = content.orEmpty()

    fun toChannelMessage(): Message = Message(
        id = id,
        channelId = dmChannelId,
        userId = userId,
        content = content,
        type = type,
        createdAt = createdAt,
        editedAt = editedAt,
        replyToId = replyToId,
        replyTo = replyTo?.toChannelMessage(),
        user = user,
        attachments = attachments,
        reactions = reactions,
    )
}

@Serializable
data class SoundboardSound(
    val id: String,
    val name: String,
    val emoji: String = "🔊",
    val folder: String? = null,
    val scopeType: String = "space", // "instance" | "space"
    val scopeId: String = "",
    val fileName: String = "",
    val fileUrl: String = "",
    val durationMs: Int = 0,
    val volume: Double = 1.0,
    val hidden: Boolean = false,
) {
    val resolvedFileUrl: String
        get() = fileUrl.ifBlank {
            if (fileName.isNotBlank()) "/api/soundboard/files/$fileName" else ""
        }
}

@Serializable
data class SoundboardSpaceSettings(
    val soundboardEnabled: Boolean = true,
    val allowInstanceSounds: Boolean = true,
    val maxConcurrentSounds: Int? = null,
)

@Serializable
data class SoundboardListResponse(
    val instanceSounds: List<SoundboardSound> = emptyList(),
    val scopedSounds: List<SoundboardSound> = emptyList(),
    val canManageInstance: Boolean = false,
    val canManageScope: Boolean = false,
    val soundboardEnabled: Boolean = true,
    val maxSoundsPerScope: Int = 50,
    val maxConcurrentSounds: Int = 3,
    val instanceMaxConcurrentSounds: Int = 3,
    val spaceSettings: SoundboardSpaceSettings? = null,
)

@Serializable
data class SoundboardPlayPayload(
    val type: String = "soundboard_play",
    val soundId: String,
    val fileUrl: String,
    val name: String,
    val emoji: String = "🔊",
    val senderUserId: String,
    val durationMs: Int = 0,
    val volumeScale: Double = 1.0,
)

enum class ChosenUserStatus(val wireValue: String) {
    ONLINE("online"),
    IDLE("idle"),
    DND("dnd"),
}

enum class StatusRevertDuration(val minutes: Int?) {
    NONE(null),
    FIFTEEN_MIN(15),
    ONE_HOUR(60),
    FOUR_HOURS(240),
}

object SoundboardUrlValidator {
    private val safePathRegex = Regex("""^/api/soundboard/files/[a-zA-Z0-9._-]+$""")

    fun isSafeFileUrl(fileUrl: String): Boolean = safePathRegex.matches(fileUrl)
}
