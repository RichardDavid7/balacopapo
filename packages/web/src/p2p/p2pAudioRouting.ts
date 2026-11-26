import type { P2PPeerState } from '../stores/p2pStore';

export type P2PAudioRoute = 'p2p' | 'livekit';

export interface P2PAudioRouteInput {
  p2pRttMs: number | null;
  myInstanceRttMs: number | null;
  peerInstanceRttMs: number | null;
  peerState: P2PPeerState;
  hasRemoteAudioTrack: boolean;
  serverOnline: boolean;
  currentlyUsingP2P: boolean;
}

export interface P2PAudioRouteDecision {
  route: P2PAudioRoute;
  /** Combined server round-trip estimate: my RTT to server + peer RTT to server. */
  serverPathRttMs: number | null;
  /** Positive when P2P is faster than going through the server. */
  savedMs: number | null;
}

/** Minimum latency gain (ms) required to switch from LiveKit -> direct P2P. */
export const P2P_SWITCH_GAIN_MS = 10;
/** Extra margin (ms) before switching back from P2P -> LiveKit (hysteresis). */
export const P2P_FALLBACK_MARGIN_MS = 15;

/**
 * Computes whether a specific peer's voice audio should travel over the direct
 * P2P WebRTC tunnel or via the LiveKit server, using full round-trip math
 * (local -> server + server -> peer) with hysteresis and server-outage survival.
 */
export function evaluateP2PAudioRoute(input: P2PAudioRouteInput): P2PAudioRouteDecision {
  const {
    p2pRttMs,
    myInstanceRttMs,
    peerInstanceRttMs,
    peerState,
    hasRemoteAudioTrack,
    serverOnline,
    currentlyUsingP2P,
  } = input;

  const serverPathRttMs =
    myInstanceRttMs !== null && peerInstanceRttMs !== null
      ? myInstanceRttMs + peerInstanceRttMs
      : myInstanceRttMs !== null
        ? myInstanceRttMs * 2
        : peerInstanceRttMs !== null
          ? peerInstanceRttMs * 2
          : null;

  const savedMs =
    p2pRttMs !== null && serverPathRttMs !== null
      ? Math.round(serverPathRttMs - p2pRttMs)
      : null;

  // Cannot route audio over P2P without an active remote track and live peer session.
  if (!hasRemoteAudioTrack || peerState === 'failed' || peerState === 'closed') {
    return { route: 'livekit', serverPathRttMs, savedMs };
  }

  // Double failover (Survival Mode): if the server/LiveKit is down, keep using the
  // already-established direct P2P tunnel even if RTT is elevated.
  if (!serverOnline && (peerState === 'connected' || peerState === 'degraded')) {
    return { route: 'p2p', serverPathRttMs, savedMs };
  }

  // Server is online: only use P2P when the direct connection is healthy.
  if (peerState !== 'connected' || p2pRttMs === null) {
    return { route: 'livekit', serverPathRttMs, savedMs };
  }

  // If server RTT hasn't been probed yet, prefer P2P only when direct RTT is clearly low.
  if (serverPathRttMs === null) {
    return { route: currentlyUsingP2P || p2pRttMs <= 40 ? 'p2p' : 'livekit', serverPathRttMs, savedMs };
  }

  if (currentlyUsingP2P) {
    // Stay on P2P until it becomes noticeably slower than the combined server path.
    const keepP2P = p2pRttMs <= serverPathRttMs + P2P_FALLBACK_MARGIN_MS;
    return { route: keepP2P ? 'p2p' : 'livekit', serverPathRttMs, savedMs };
  }

  // Switch to P2P only when it genuinely beats the combined server round-trip.
  const switchToP2P = p2pRttMs <= serverPathRttMs - P2P_SWITCH_GAIN_MS;
  return { route: switchToP2P ? 'p2p' : 'livekit', serverPathRttMs, savedMs };
}
