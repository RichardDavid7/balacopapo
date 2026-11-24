package com.backspace.core.model

import kotlinx.serialization.Serializable

@Serializable
data class SpaceJoinRequestItem(
    val id: String,
    val spaceId: String = "",
    val userId: String = "",
    val message: String? = null,
    val status: String = "pending",
    val decidedBy: String? = null,
    val createdAt: Long = 0L,
    val decidedAt: Long? = null,
    val user: User? = null,
) {
    val label: String get() = user?.label ?: userId
}

@Serializable
data class SpaceJoinRequestsResponse(
    val requests: List<SpaceJoinRequestItem> = emptyList(),
)

@Serializable
data class PermissionOverrideItem(
    val targetType: String = "role",
    val targetId: String = "",
    val allow: String = "0",
    val deny: String = "0",
    val version: String? = null,
)

@Serializable
data class OverridesResponse(
    val overrides: List<PermissionOverrideItem> = emptyList(),
    val overrideVersion: String? = null,
)

@Serializable
data class PutOverrideResponse(
    val success: Boolean = true,
    val version: String? = null,
)

@Serializable
data class ChannelLayoutItem(
    val id: String,
    val position: Int,
    val categoryId: String? = null,
)

@Serializable
data class CategoryLayoutItem(
    val id: String,
    val position: Int,
    val parentId: String? = null,
)

@Serializable
data class UserMutualsResponse(
    val mutualFriends: List<User> = emptyList(),
    val mutualSpaces: List<Space> = emptyList(),
)

@Serializable
data class SoundboardSpaceSettingsResponse(
    val spaceSettings: SoundboardSpaceSettings = SoundboardSpaceSettings(),
)
