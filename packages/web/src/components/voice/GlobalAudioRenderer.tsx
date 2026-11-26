import React from 'react';
import { useVoiceStore } from '../../stores/voiceStore';
import { useP2PStore } from '../../stores/p2pStore';
import { useSpaceStore, getChannelOrigin, getMyUserIdForOrigin } from '../../stores/spaceStore';
import { useAudioTrackPlayer } from '../../hooks/useAudioTrackPlayer';
import type { ParticipantInfo } from '../../hooks/useLiveKit';

/**
 * Manages a Web Audio pipeline for a single audio track.
 * Renders a muted <audio> element as a Chrome keep-alive for the WebRTC track.
 * All actual audio output goes through Web Audio (GainNode -> ctx.destination).
 */
function AudioTrackElement({
  track,
  globalVolume,
  perSourceVolume,
  isDeafened,
  isMuted,
  attenuate,
  someoneIsSpeaking,
  attenuationEnabled,
  attenuationStrength,
}: {
  track: MediaStreamTrack | null;
  globalVolume: number;
  perSourceVolume: number;
  isDeafened: boolean;
  isMuted: boolean;
  attenuate: boolean;
  someoneIsSpeaking: boolean;
  attenuationEnabled: boolean;
  attenuationStrength: number;
}) {
  const globalScale = globalVolume / 100;
  const sourceScale = perSourceVolume / 100;
  let finalVolume = globalScale * sourceScale;

  // Stream attenuation: duck when someone is speaking
  if (attenuate && attenuationEnabled && someoneIsSpeaking) {
    finalVolume *= 1 - attenuationStrength / 100;
  }

  const shouldMute = isDeafened || isMuted;

  const audioRef = useAudioTrackPlayer({
    track,
    volume: finalVolume,
    muted: shouldMute,
  });

  // The <audio> element is always muted — it serves only as a Chrome
  // keep-alive so Chrome continues processing the WebRTC track.
  // Real audio output goes through the Web Audio pipeline.
  return <audio ref={audioRef} muted autoPlay playsInline data-backspace="keepalive" />;
}

/**
 * Always-mounted component that manages Web Audio pipelines
 * for every remote participant's mic and screen audio tracks.
 *
 * Rendered in AppLayout alongside PictureInPicture and SoundController.
 * Never unmounts during navigation, so audio persists even when
 * VoiceGrid / VoiceUser / StreamTile are not rendered.
 *
 * All audio is routed through the Web Audio API (GainNodes connected
 * to a shared AudioContext.destination). Muted <audio> elements serve
 * as Chrome keep-alives for WebRTC tracks but produce no sound.
 */
export function GlobalAudioRenderer() {
  const participants = useVoiceStore((s) => s.participants);
  const isDeafenedIntent = useVoiceStore((s) => s.isDeafened);
  const spaceDeafenedUserIds = useVoiceStore((s) => s.spaceDeafenedUserIds);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const outputVolume = useVoiceStore((s) => s.outputVolume);
  const participantVolumes = useVoiceStore((s) => s.participantVolumes);
  const streamVolumes = useVoiceStore((s) => s.streamVolumes);
  const participantMutes = useVoiceStore((s) => s.participantMutes);
  const streamMutes = useVoiceStore((s) => s.streamMutes);
  const watchingStreams = useVoiceStore((s) => s.watchingStreams);
  const streamAttenuationEnabled = useVoiceStore((s) => s.streamAttenuationEnabled);
  const streamAttenuationStrength = useVoiceStore((s) => s.streamAttenuationStrength);
  const speakingParticipantIds = useVoiceStore((s) => s.speakingParticipantIds);
  const p2pPeers = useP2PStore((s) => s.peers);
  const p2pRemoteAudioTracks = useP2PStore((s) => s.remoteAudioTracks);
  const p2pSurvivalMode = useP2PStore((s) => s.survivalMode);

  // Compute effective deafened: user intent || server enforcement
  const spaceId = useSpaceStore((s) => currentVoiceChannelId ? s.channelToSpaceMap.get(currentVoiceChannelId) : null);
  const myOriginId = currentVoiceChannelId ? getMyUserIdForOrigin(getChannelOrigin(currentVoiceChannelId)) : undefined;
  const spaceKey = (spaceId && myOriginId) ? `${spaceId}:${myOriginId}` : '';
  const isDeafened = isDeafenedIntent || spaceDeafenedUserIds.has(spaceKey);

  // Determine if someone is currently speaking (for stream attenuation)
  const someoneIsSpeaking = participants.some((p) => !p.isLocal && speakingParticipantIds.has(p.identity));

  // Only render audio for remote participants
  const remoteParticipants = participants.filter((p) => !p.isLocal);
  const livekitUserIds = new Set(remoteParticipants.map((p) => p.userId));

  // Double failover (Survival Mode): if the server/LiveKit dropped and cleared
  // `participants`, keep playing audio from any surviving direct P2P peers.
  const survivalOnlyPeerIds = p2pSurvivalMode
    ? Object.keys(p2pRemoteAudioTracks).filter(
        (uid) => !livekitUserIds.has(uid) && p2pPeers[uid]?.audioRoute === 'p2p',
      )
    : [];

  return (
    <>
      {remoteParticipants.map((p: ParticipantInfo) => {
        const micVolume = participantVolumes.get(p.userId) ?? 100;
        const isMicMuted = participantMutes.get(p.userId) ?? false;
        const streamVol = streamVolumes.get(p.userId) ?? 100;
        const isStreamMuted = streamMutes.get(p.userId) ?? false;

        // Hybrid P2P routing: when direct P2P beats combined server RTT (or server is offline),
        // play the direct P2P track instead of the LiveKit track (zero double-playback/echo).
        // Guard against muted/ended P2P tracks so we instantaneously fail over to LiveKit
        // rather than outputting silence when LiveKit audio is healthy.
        const p2pTrack = p2pRemoteAudioTracks[p.userId] ?? null;
        const p2pTrackHealthy = Boolean(
          p2pTrack && p2pTrack.readyState === 'live' && !p2pTrack.muted,
        );
        const useDirectP2P = p2pPeers[p.userId]?.audioRoute === 'p2p' && p2pTrackHealthy;
        const activeMicTrack = useDirectP2P ? p2pTrack : p.audioTrack;

        return (
          <React.Fragment key={p.identity}>
            {/* Mic audio (hybrid P2P direct or LiveKit failover) */}
            {activeMicTrack && (
              <AudioTrackElement
                track={activeMicTrack}
                globalVolume={outputVolume}
                perSourceVolume={micVolume}
                isDeafened={isDeafened}
                isMuted={isMicMuted}
                attenuate={false}
                someoneIsSpeaking={false}
                attenuationEnabled={false}
                attenuationStrength={0}
              />
            )}

            {/* Screen share audio — only when user opted in to watch */}
            {p.screenAudioTrack && watchingStreams.has(p.userId) && (
              <AudioTrackElement
                track={p.screenAudioTrack}
                globalVolume={outputVolume}
                perSourceVolume={streamVol}
                isDeafened={isDeafened}
                isMuted={isStreamMuted}
                attenuate={true}
                someoneIsSpeaking={someoneIsSpeaking}
                attenuationEnabled={streamAttenuationEnabled}
                attenuationStrength={streamAttenuationStrength}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Server-outage P2P Survival Mode: keep direct P2P audio alive even if LiveKit emptied */}
      {survivalOnlyPeerIds.map((userId) => {
        const track = p2pRemoteAudioTracks[userId] ?? null;
        if (!track) return null;
        const micVolume = participantVolumes.get(userId) ?? 100;
        const isMicMuted = participantMutes.get(userId) ?? false;
        return (
          <AudioTrackElement
            key={`p2p-survival:${userId}`}
            track={track}
            globalVolume={outputVolume}
            perSourceVolume={micVolume}
            isDeafened={isDeafened}
            isMuted={isMicMuted}
            attenuate={false}
            someoneIsSpeaking={false}
            attenuationEnabled={false}
            attenuationStrength={0}
          />
        );
      })}
    </>
  );
}
