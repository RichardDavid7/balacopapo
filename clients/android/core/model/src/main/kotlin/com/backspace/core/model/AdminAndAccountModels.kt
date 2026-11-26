package com.backspace.core.model

import kotlinx.serialization.Serializable

// ── Conta ──

@Serializable
data class ChangePasswordResponse(
    val token: String = "",
)

@Serializable
data class ReattachAccountResponse(
    val success: Boolean = true,
    val user: User? = null,
)

// ── Convites da Instância (Admin) ──

@Serializable
data class AdminInviteItem(
    val id: String = "",
    val token: String = "",
    val name: String = "",
    val status: String = "active", // "active" | "expired" | "exhausted" | "revoked"
    val maxUses: Int? = null,
    val usedCount: Int = 0,
    val expiresAt: Long? = null,
    val revokedAt: Long? = null,
    val createdBy: String = "",
    val createdByUsername: String? = null,
    val createdAt: Long = 0L,
    val lastRedeemedAt: Long? = null,
    val url: String = "",
)

@Serializable
data class AdminInvitesListResponse(
    val invites: List<AdminInviteItem> = emptyList(),
)

@Serializable
data class AdminInviteWrapperResponse(
    val invite: AdminInviteItem? = null,
    val tokenRotated: Boolean = false,
)

@Serializable
data class AdminInviteRedemption(
    val id: String = "",
    val userId: String? = null,
    val registrantUsername: String = "",
    val currentUsername: String? = null,
    val isDeleted: Boolean = false,
    val redeemedAt: Long = 0L,
)

@Serializable
data class AdminInviteRedemptionsResponse(
    val redemptions: List<AdminInviteRedemption> = emptyList(),
)

// ── Federação (Admin) ──

@Serializable
data class FederationPeerItem(
    val id: String = "",
    val origin: String = "",
    val instanceName: String? = null,
    val status: String = "pending",
    val lastSeenAt: Long? = null,
    val lastFailureAt: Long? = null,
    val consecutiveFailures: Int = 0,
    val lastSyncedAt: Long? = null,
    val createdAt: Long = 0L,
    val rotationInProgress: Boolean = false,
    val secretRotatedAt: Long? = null,
    val autoRotateIntervalDays: Int = 30,
    val statusReason: String? = null,
)

@Serializable
data class FederationPeersResponse(
    val peers: List<FederationPeerItem> = emptyList(),
)

@Serializable
data class FederationPeerRecheckResponse(
    val recovered: Boolean = false,
    val status: String = "",
)

@Serializable
data class FederationPeerRotateResponse(
    val success: Boolean = true,
    val gracePeriodMs: Long = 0L,
)

@Serializable
data class FederationApprovalSubscriber(
    val userId: String = "",
    val username: String = "",
    val triggerReason: String = "",
    val triggerTarget: String? = null,
)

@Serializable
data class FederationApprovalItem(
    val id: String = "",
    val direction: String = "inbound", // "inbound" | "outbound"
    val origin: String = "",
    val instanceName: String? = null,
    val requestedAt: Long = 0L,
    val expiresAt: Long = 0L,
    val subscribers: List<FederationApprovalSubscriber> = emptyList(),
)

@Serializable
data class FederationApprovalsResponse(
    val requests: List<FederationApprovalItem> = emptyList(),
)

@Serializable
data class FederationApprovalActionResponse(
    val success: Boolean = true,
    val awaitingRemoteApproval: Boolean = false,
    val message: String? = null,
    val peer: FederationPeerItem? = null,
)

@Serializable
data class FederationOrphanedSpaceRef(
    val id: String = "",
    val name: String = "",
)

@Serializable
data class FederationOrphanedAccount(
    val id: String = "",
    val username: String = "",
    val displayName: String? = null,
    val avatarColor: String? = null,
    val ownedSpaces: List<FederationOrphanedSpaceRef> = emptyList(),
    val spaceMemberCount: Int = 0,
    val messageCount: Int = 0,
)

@Serializable
data class FederationResetEventItem(
    val origin: String = "",
    val deadEpoch: String = "",
    val newEpoch: String = "",
    val detectedAt: Long = 0L,
    val resolvedAt: Long? = null,
    val stubCount: Int = 0,
    val orphanedAccountCount: Int = 0,
    val acknowledgedAt: Long? = null,
    val orphanedAccounts: List<FederationOrphanedAccount> = emptyList(),
)

@Serializable
data class FederationResetEventsResponse(
    val events: List<FederationResetEventItem> = emptyList(),
)

// ── Armazenamento (Admin) ──

@Serializable
data class StorageBreakdownItem(
    val type: String = "", // "image" | "video" | "audio" | "document" | "other"
    val count: Int = 0,
    val size: Long = 0L,
)

@Serializable
data class StorageStatsResponse(
    val totalFiles: Int = 0,
    val totalSize: Long = 0L,
    val referencedFiles: Int = 0,
    val referencedSize: Long = 0L,
    val orphanedFiles: Int = 0,
    val orphanedSize: Long = 0L,
    val unlinkedAttachments: Int = 0,
    val unlinkedSize: Long = 0L,
    val danglingAttachments: Int = 0,
    val danglingSize: Long = 0L,
    val staleTusSessions: Int = 0,
    val staleTusSize: Long = 0L,
    val breakdown: List<StorageBreakdownItem> = emptyList(),
)

@Serializable
data class StorageCleanupResult(
    val dryRun: Boolean = false,
    val deletedFiles: Int = 0,
    val freedBytes: Long = 0L,
    val deletedAttachmentRecords: Int = 0,
    val errors: List<String> = emptyList(),
)

// ── Usuários (Admin) ──

@Serializable
data class AdminUserItem(
    val id: String = "",
    val username: String = "",
    val displayName: String? = null,
    val avatar: String? = null,
    val avatarColor: String? = null,
    val status: String = "offline",
    val isAdmin: Boolean = false,
    val isDeleted: Boolean = false,
    val homeInstance: String? = null,
    val createdAt: Long = 0L,
) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: username
    fun avatarUrl(instanceUrl: String): String? = UploadUrlResolver.resolve(instanceUrl, avatar)
}

@Serializable
data class AdminUsersPageResponse(
    val users: List<AdminUserItem> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val pageSize: Int = 50,
)

@Serializable
data class ResetPasswordResponse(
    val temporaryPassword: String = "",
)

// ── Atualizações da Instância (Admin) ──

@Serializable
data class InstanceVersionCurrent(
    val version: String = "",
    val commit: String? = null,
)

@Serializable
data class InstanceVersionLatest(
    val version: String = "",
    val url: String = "",
    val publishedAt: String = "",
)

@Serializable
data class InstanceUpdateStatusResponse(
    val current: InstanceVersionCurrent = InstanceVersionCurrent(),
    val latest: InstanceVersionLatest? = null,
    val state: String = "unknown", // "up-to-date" | "update-available" | "unknown"
    val checkedAt: Long? = null,
    val checkEnabled: Boolean = true,
    val reason: String? = null, // "disabled" | "unreachable" | "rate-limited" | "unparseable" | null
    val channel: String = "unknown", // "prebuilt" | "source" | "unknown"
)

// ── Telemetria (Admin) ──

@Serializable
data class AdminTelemetryError(
    val day: String = "",
    val status: Int = 0,
)

@Serializable
data class AdminTelemetryStatus(
    val enabled: Boolean? = null,
    val lastDay: String? = null,
    val lastError: AdminTelemetryError? = null,
    val id: String? = null,
    val askDue: Boolean = false,
)

// ── OIDC Auth ──

@Serializable
data class OidcHandoffStartResponse(
    val handoffId: String = "",
    val pollToken: String = "",
    val expiresInMs: Long = 300_000L,
)

@Serializable
data class OidcHandoffPollResponse(
    val status: String = "",
    val ticket: String? = null,
    val redirect: String? = null,
    val error: String? = null,
)

// ── Admin OIDC ──

@Serializable
data class AdminOidcConfigResponse(
    val enabled: Boolean = false,
    val configured: Boolean = false,
    val issuerUrl: String = "",
    val clientId: String = "",
    val hasClientSecret: Boolean = false,
    val displayName: String = "SSO",
    val scopes: String = "",
    val autoRegister: Boolean = false,
    val syncAvatar: Boolean = false,
    val groupsClaim: String = "",
    val adminGroups: List<String> = emptyList(),
    val passwordLoginDisabled: Boolean = false,
    val callbackUrl: String = "",
)

@Serializable
data class AdminOidcLinkInfo(
    val issuer: String = "",
    val subject: String = "",
    val email: String? = null,
    val preferredUsername: String? = null,
    val linkedAt: Long = 0L,
    val lastLoginAt: Long? = null,
)

@Serializable
data class AdminOidcUserItem(
    val id: String = "",
    val username: String = "",
    val displayName: String? = null,
    val avatar: String? = null,
    val avatarColor: String? = null,
    val isAdmin: Boolean = false,
    val createdAt: Long = 0L,
    val oidcLink: AdminOidcLinkInfo? = null,
) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: username
    fun avatarUrl(instanceUrl: String): String? = UploadUrlResolver.resolve(instanceUrl, avatar)
}

@Serializable
data class AdminOidcUsersResponse(
    val users: List<AdminOidcUserItem> = emptyList(),
)

@Serializable
data class AdminOidcLinkTokenResponse(
    val linkUrl: String = "",
    val expiresAt: Long = 0L,
)

// ── Admin Ban IP ──

@Serializable
data class ActiveIpBan(
    val id: String = "",
    val ip: String = "",
    val reason: String? = null,
    val bannedBy: String? = null,
    val sourceUserId: String? = null,
    val durationDays: Int? = null,
    val expiresAt: Long? = null,
    val createdAt: Long = 0L,
)

@Serializable
data class AdminIpBansResponse(
    val bans: List<ActiveIpBan> = emptyList(),
)

@Serializable
data class AdminIpBanWrapperResponse(
    val ban: ActiveIpBan? = null,
)

@Serializable
data class IpBanFeedInfoResponse(
    val configured: Boolean = false,
    val opnsensePath: String = "",
    val nginxPath: String = "",
)

// ── Admin Retenção de Arquivos ──

@Serializable
data class AdminSpaceRetentionItem(
    val id: String = "",
    val name: String = "",
    val allowFileRetention: Boolean = false,
    val fileRetentionEnabled: Boolean = false,
    val memberCount: Int = 0,
    val ownerUsername: String? = null,
    val createdAt: Long = 0L,
)

@Serializable
data class AdminSpaceRetentionListResponse(
    val spaces: List<AdminSpaceRetentionItem> = emptyList(),
)

// ── Stream Pointer (LiveKit DataChannel) ──

@Serializable
data class StreamPointerEvent(
    val streamIdentity: String,
    val senderIdentity: String,
    val senderName: String,
    val x: Double,
    val y: Double,
    val mode: String,
    val color: String,
    val expiresAtMs: Long,
)
