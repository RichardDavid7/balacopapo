package com.backspace.core.model

import java.math.BigInteger

data class PermissionDescriptor(
    val bit: Int,
    val name: String,
    val description: String,
    val group: String,
) {
    val mask: BigInteger get() = BigInteger.ONE.shiftLeft(bit)
}

object PermissionBits {
    // Geral
    val ADMINISTRATOR: BigInteger = BigInteger.ONE.shiftLeft(0)
    val VIEW_CHANNEL: BigInteger = BigInteger.ONE.shiftLeft(1)
    val MANAGE_CHANNELS: BigInteger = BigInteger.ONE.shiftLeft(2)
    val MANAGE_ROLES: BigInteger = BigInteger.ONE.shiftLeft(3)
    val MANAGE_SPACE: BigInteger = BigInteger.ONE.shiftLeft(4)
    val CREATE_INVITE: BigInteger = BigInteger.ONE.shiftLeft(5)
    val KICK_MEMBERS: BigInteger = BigInteger.ONE.shiftLeft(6)
    val BAN_MEMBERS: BigInteger = BigInteger.ONE.shiftLeft(7)

    // Texto
    val SEND_MESSAGES: BigInteger = BigInteger.ONE.shiftLeft(10)
    val MANAGE_MESSAGES: BigInteger = BigInteger.ONE.shiftLeft(11)
    val ATTACH_FILES: BigInteger = BigInteger.ONE.shiftLeft(12)
    val READ_MESSAGE_HISTORY: BigInteger = BigInteger.ONE.shiftLeft(13)
    val ADD_REACTIONS: BigInteger = BigInteger.ONE.shiftLeft(14)
    val MENTION_EVERYONE: BigInteger = BigInteger.ONE.shiftLeft(15)

    // Voz
    val CONNECT: BigInteger = BigInteger.ONE.shiftLeft(20)
    val SPEAK: BigInteger = BigInteger.ONE.shiftLeft(21)
    val MUTE_MEMBERS: BigInteger = BigInteger.ONE.shiftLeft(22)
    val DEAFEN_MEMBERS: BigInteger = BigInteger.ONE.shiftLeft(23)
    val MOVE_MEMBERS: BigInteger = BigInteger.ONE.shiftLeft(24)
    val STREAM: BigInteger = BigInteger.ONE.shiftLeft(25)
    val DISCONNECT_MEMBERS: BigInteger = BigInteger.ONE.shiftLeft(26)
    val USE_SOUNDBOARD: BigInteger = BigInteger.ONE.shiftLeft(27)
    val MANAGE_SOUNDBOARD: BigInteger = BigInteger.ONE.shiftLeft(28)

    val allPermissions: List<PermissionDescriptor> = listOf(
        // Geral
        PermissionDescriptor(
            bit = 0,
            name = "Administrador",
            description = "Concede todas as permissões do Espaço e ignora restrições de canal.",
            group = "Geral",
        ),
        PermissionDescriptor(
            bit = 1,
            name = "Ver canais",
            description = "Permite visualizar canais de texto e de voz no Espaço.",
            group = "Geral",
        ),
        PermissionDescriptor(
            bit = 2,
            name = "Gerenciar canais",
            description = "Permite criar, editar, reordenar e excluir canais e categorias.",
            group = "Geral",
        ),
        PermissionDescriptor(
            bit = 3,
            name = "Gerenciar cargos",
            description = "Permite criar, editar e atribuir cargos abaixo do seu cargo mais alto.",
            group = "Geral",
        ),
        PermissionDescriptor(
            bit = 4,
            name = "Gerenciar Espaço",
            description = "Permite alterar nome, descrição, aparência, visibilidade e solicitações do Espaço.",
            group = "Geral",
        ),
        PermissionDescriptor(
            bit = 5,
            name = "Criar convites",
            description = "Permite gerar e compartilhar links de convite para o Espaço.",
            group = "Geral",
        ),
        PermissionDescriptor(
            bit = 6,
            name = "Expulsar membros",
            description = "Permite remover membros do Espaço.",
            group = "Geral",
        ),
        PermissionDescriptor(
            bit = 7,
            name = "Banir membros",
            description = "Permite banir e desbanir membros do Espaço.",
            group = "Geral",
        ),

        // Texto
        PermissionDescriptor(
            bit = 10,
            name = "Enviar mensagens",
            description = "Permite enviar mensagens nos canais de texto.",
            group = "Texto",
        ),
        PermissionDescriptor(
            bit = 11,
            name = "Gerenciar mensagens",
            description = "Permite excluir mensagens enviadas por outros membros.",
            group = "Texto",
        ),
        PermissionDescriptor(
            bit = 12,
            name = "Anexar arquivos",
            description = "Permite enviar imagens, vídeos e documentos no chat.",
            group = "Texto",
        ),
        PermissionDescriptor(
            bit = 13,
            name = "Ler histórico de mensagens",
            description = "Permite visualizar mensagens anteriores enviadas no canal.",
            group = "Texto",
        ),
        PermissionDescriptor(
            bit = 14,
            name = "Adicionar reações",
            description = "Permite reagir com emojis às mensagens.",
            group = "Texto",
        ),
        PermissionDescriptor(
            bit = 15,
            name = "Mencionar @everyone e cargos",
            description = "Permite usar @everyone, @here e menções a cargos.",
            group = "Texto",
        ),

        // Voz
        PermissionDescriptor(
            bit = 20,
            name = "Conectar",
            description = "Permite entrar em canais de voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 21,
            name = "Falar",
            description = "Permite transmitir áudio nos canais de voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 22,
            name = "Silenciar membros",
            description = "Permite silenciar o microfone de outros membros na voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 23,
            name = "Ensurdecer membros",
            description = "Permite desativar o áudio recebido por outros membros na voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 24,
            name = "Mover membros",
            description = "Permite mover membros entre canais de voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 25,
            name = "Transmitir vídeo e tela",
            description = "Permite compartilhar câmera ou tela nos canais de voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 26,
            name = "Desconectar membros",
            description = "Permite desconectar membros de canais de voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 27,
            name = "Usar Soundboard",
            description = "Permite reproduzir sons do soundboard nos canais de voz.",
            group = "Voz",
        ),
        PermissionDescriptor(
            bit = 28,
            name = "Gerenciar Soundboard",
            description = "Permite enviar, editar, organizar e remover sons do Espaço.",
            group = "Voz",
        ),
    )

    private val textBits = setOf(1, 2, 5, 10, 11, 12, 13, 14, 15)
    private val voiceBits = setOf(1, 2, 5, 20, 21, 22, 23, 24, 25, 26, 27, 28)
    private val categoryBits = textBits + voiceBits

    val textChannelPermissions: List<PermissionDescriptor> =
        allPermissions.filter { it.bit in textBits }

    val voiceChannelPermissions: List<PermissionDescriptor> =
        allPermissions.filter { it.bit in voiceBits }

    val categoryPermissions: List<PermissionDescriptor> =
        allPermissions.filter { it.bit in categoryBits }

    val ALL_PERMISSIONS: BigInteger =
        allPermissions.fold(BigInteger.ZERO) { acc, descriptor -> acc.or(descriptor.mask) }

    val DEFAULT_EVERYONE_PERMISSIONS: BigInteger =
        VIEW_CHANNEL
            .or(SEND_MESSAGES)
            .or(CREATE_INVITE)
            .or(CONNECT)
            .or(SPEAK)
            .or(ATTACH_FILES)
            .or(READ_MESSAGE_HISTORY)
            .or(ADD_REACTIONS)
            .or(STREAM)
            .or(USE_SOUNDBOARD)

    fun hasPermission(decimalBitmask: String?, bit: BigInteger): Boolean {
        if (decimalBitmask.isNullOrBlank()) return true // fallback permissivo quando omitido
        val mask = decimalBitmask.trim().toBigIntegerOrNull() ?: return false
        if (mask.and(ADMINISTRATOR) != BigInteger.ZERO) return true
        return mask.and(bit) != BigInteger.ZERO
    }

    fun hasBitStrict(rawMask: String?, bit: Int): Boolean {
        val mask = rawMask?.trim()?.toBigIntegerOrNull() ?: return false
        return mask.testBit(bit)
    }

    fun setBit(rawMask: String?, bit: Int, enabled: Boolean): String {
        val current = rawMask?.trim()?.toBigIntegerOrNull() ?: BigInteger.ZERO
        val updated = if (enabled) current.setBit(bit) else current.clearBit(bit)
        return updated.toString()
    }

    fun computeEffectivePermissions(
        isOwner: Boolean,
        roles: List<Role>,
        memberRoleIds: List<String>,
        categoryOverrides: List<PermissionOverrideItem> = emptyList(),
        channelOverrides: List<PermissionOverrideItem> = emptyList(),
        userId: String = "",
    ): BigInteger {
        if (isOwner) return ALL_PERMISSIONS

        val everyoneRole = roles.firstOrNull { it.isEveryone || it.isDefault }
        var base = everyoneRole?.permissions?.trim()?.toBigIntegerOrNull() ?: BigInteger.ZERO

        val assignedSet = memberRoleIds.toSet()
        for (role in roles) {
            if (role.id in assignedSet) {
                val roleMask = role.permissions.trim().toBigIntegerOrNull() ?: BigInteger.ZERO
                base = base.or(roleMask)
            }
        }

        if (base.and(ADMINISTRATOR) != BigInteger.ZERO) return ALL_PERMISSIONS

        if (categoryOverrides.isEmpty() && channelOverrides.isEmpty()) return base

        fun applyOverride(current: BigInteger, override: PermissionOverrideItem?): BigInteger {
            if (override == null) return current
            val deny = override.deny.trim().toBigIntegerOrNull() ?: BigInteger.ZERO
            val allow = override.allow.trim().toBigIntegerOrNull() ?: BigInteger.ZERO
            return current.and(deny.not()).or(allow)
        }

        // Tier 1: @everyone override
        val everyoneId = everyoneRole?.id
        if (!everyoneId.isNullOrBlank()) {
            base = applyOverride(
                base,
                categoryOverrides.firstOrNull { it.targetType == "role" && it.targetId == everyoneId },
            )
            base = applyOverride(
                base,
                channelOverrides.firstOrNull { it.targetType == "role" && it.targetId == everyoneId },
            )
        }

        // Tier 2: Role overrides (combined per tier)
        if (assignedSet.isNotEmpty()) {
            var catAllow = BigInteger.ZERO
            var catDeny = BigInteger.ZERO
            for (override in categoryOverrides) {
                if (override.targetType == "role" && override.targetId in assignedSet) {
                    catAllow = catAllow.or(override.allow.trim().toBigIntegerOrNull() ?: BigInteger.ZERO)
                    catDeny = catDeny.or(override.deny.trim().toBigIntegerOrNull() ?: BigInteger.ZERO)
                }
            }
            base = base.and(catDeny.not()).or(catAllow)

            var chanAllow = BigInteger.ZERO
            var chanDeny = BigInteger.ZERO
            for (override in channelOverrides) {
                if (override.targetType == "role" && override.targetId in assignedSet) {
                    chanAllow = chanAllow.or(override.allow.trim().toBigIntegerOrNull() ?: BigInteger.ZERO)
                    chanDeny = chanDeny.or(override.deny.trim().toBigIntegerOrNull() ?: BigInteger.ZERO)
                }
            }
            base = base.and(chanDeny.not()).or(chanAllow)
        }

        // Tier 3: Member-specific override
        if (userId.isNotBlank()) {
            base = applyOverride(
                base,
                categoryOverrides.firstOrNull { it.targetType == "member" && it.targetId == userId },
            )
            base = applyOverride(
                base,
                channelOverrides.firstOrNull { it.targetType == "member" && it.targetId == userId },
            )
        }

        return base
    }
}
