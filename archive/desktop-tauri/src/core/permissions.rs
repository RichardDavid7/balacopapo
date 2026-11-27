//! Espelho 1-para-1 de `packages/shared/src/permissions.ts` (23 bits oficiais).
//! Validado automaticamente pelo script `scripts/check-desktop-parity.mjs`.
#![allow(dead_code)]

pub const ADMINISTRATOR: u64 = 1 << 0;
pub const VIEW_CHANNEL: u64 = 1 << 1;
pub const MANAGE_CHANNELS: u64 = 1 << 2;
pub const MANAGE_ROLES: u64 = 1 << 3;
pub const MANAGE_SPACE: u64 = 1 << 4;
pub const CREATE_INVITE: u64 = 1 << 5;
pub const KICK_MEMBERS: u64 = 1 << 6;
pub const BAN_MEMBERS: u64 = 1 << 7;
pub const SEND_MESSAGES: u64 = 1 << 10;
pub const MANAGE_MESSAGES: u64 = 1 << 11;
pub const ATTACH_FILES: u64 = 1 << 12;
pub const READ_MESSAGE_HISTORY: u64 = 1 << 13;
pub const ADD_REACTIONS: u64 = 1 << 14;
pub const MENTION_EVERYONE: u64 = 1 << 15;
pub const CONNECT: u64 = 1 << 20;
pub const SPEAK: u64 = 1 << 21;
pub const MUTE_MEMBERS: u64 = 1 << 22;
pub const DEAFEN_MEMBERS: u64 = 1 << 23;
pub const MOVE_MEMBERS: u64 = 1 << 24;
pub const STREAM: u64 = 1 << 25;
pub const DISCONNECT_MEMBERS: u64 = 1 << 26;
pub const USE_SOUNDBOARD: u64 = 1 << 27;
pub const MANAGE_SOUNDBOARD: u64 = 1 << 28;

pub const DEFAULT_EVERYONE_PERMISSIONS: u64 = VIEW_CHANNEL
    | SEND_MESSAGES
    | CREATE_INVITE
    | CONNECT
    | SPEAK
    | ATTACH_FILES
    | READ_MESSAGE_HISTORY
    | ADD_REACTIONS
    | STREAM
    | USE_SOUNDBOARD;

pub fn parse_permissions(raw: Option<&str>) -> u64 {
    raw.and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0)
}

pub fn has_permission(perms: u64, bit: u64) -> bool {
    if (perms & ADMINISTRATOR) != 0 {
        return true;
    }
    (perms & bit) == bit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn administrator_grants_everything() {
        assert!(has_permission(ADMINISTRATOR, MANAGE_SOUNDBOARD));
        assert!(has_permission(ADMINISTRATOR, BAN_MEMBERS));
    }

    #[test]
    fn default_everyone_includes_soundboard_use_not_manage() {
        assert!(has_permission(DEFAULT_EVERYONE_PERMISSIONS, USE_SOUNDBOARD));
        assert!(!has_permission(
            DEFAULT_EVERYONE_PERMISSIONS,
            MANAGE_SOUNDBOARD
        ));
        assert_eq!(parse_permissions(Some("134217728")), USE_SOUNDBOARD);
    }
}
