import { useMemo } from 'react';
import { useSpaceStore } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { parseFederatedUsername } from '../utils/identity';
import { getCanonicalUserView } from '../utils/userViewLookup';
import { voiceSessionOrigin } from '../utils/dmCall';
import type { ParticipantInfo } from './useLiveKit';
import type { User } from '@backspace/shared';

/**
 * Resolves display metadata (displayName, avatar, user) for a voice participant
 * by looking up member data from the space/DM stores, and `origin`, the
 * instance that issued `user`.
 *
 * Reactive — re-renders when member data changes (e.g. user updates avatar mid-call).
 */
export function useVoiceParticipantMeta(participant: ParticipantInfo) {
  const members = useSpaceStore((s) => s.members);
  const spaces = useSpaceStore((s) => s.spaces);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const channelOriginMap = useSpaceStore((s) => s.channelOriginMap);
  const channelToSpaceMap = useSpaceStore((s) => s.channelToSpaceMap);
  const activeChannelId = useVoiceStore((s) => s.activeChannelId);
  const sessionOrigin = useVoiceStore(voiceSessionOrigin);

  return useMemo(() => {
    const voiceSpaceId = activeChannelId ? channelToSpaceMap.get(activeChannelId) : undefined;

    // 1. Try space members (primary — covers space voice channels).
    // When in a space voice channel, prefer the member row for that space and honor space nickname.
    const member = voiceSpaceId
      ? (members.find(m => m.userId === participant.userId && m.spaceId === voiceSpaceId)
        ?? members.find(m => m.userId === participant.userId))
      : members.find(m => m.userId === participant.userId);
    if (member?.user) {
      const origin = spaces.find(sp => sp.id === member.spaceId)?._instanceOrigin ?? '';
      const canonical = getCanonicalUserView(member.user as User, origin);
      const { baseName } = parseFederatedUsername(canonical.username);
      const spaceNickname = voiceSpaceId && member.spaceId === voiceSpaceId ? member.nickname : null;
      return {
        displayName: spaceNickname || canonical.displayName || baseName,
        avatar: canonical.avatar ?? null,
        user: canonical,
        origin,
      };
    }

    // 2. Fallback to DM channel members (covers DM calls)
    for (const dm of dmChannels) {
      const dmMember = dm.members?.find(m => m.id === participant.userId);
      if (dmMember) {
        const origin = channelOriginMap.get(dm.id) ?? '';
        const canonical = getCanonicalUserView(dmMember as User, origin);
        const { baseName } = parseFederatedUsername(canonical.username);
        return {
          displayName: canonical.displayName ?? baseName,
          avatar: canonical.avatar ?? null,
          user: canonical,
          origin,
        };
      }
    }

    // 3. Fallback to cached user from ParticipantInfo (federation carry-forward).
    // Route through the userViews cache: a User captured from federation handoff
    // can be a stale stub view, and the cache may hold a fresher home view.
    // The row was issued by the instance hosting the call.
    if (participant.cachedUser) {
      const callOrigin = sessionOrigin;
      const canonical = getCanonicalUserView(participant.cachedUser, callOrigin);
      const { baseName } = parseFederatedUsername(canonical.username);
      return {
        displayName: canonical.displayName ?? baseName,
        avatar: canonical.avatar ?? null,
        user: canonical,
        origin: callOrigin,
      };
    }

    // 4. Final fallback — parse username from LiveKit identity
    const { baseName } = parseFederatedUsername(participant.username);
    return { displayName: baseName, avatar: null, user: null as User | null, origin: '' };
  }, [members, spaces, dmChannels, channelOriginMap, channelToSpaceMap, activeChannelId, sessionOrigin, participant.userId, participant.username, participant.cachedUser]);
}
