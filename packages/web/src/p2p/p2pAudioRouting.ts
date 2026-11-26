import type { P2PPeerState } from '../stores/p2pStore';

export type P2PAudioRoute = 'p2p' | 'livekit';

export interface P2PAudioRouteInput {
  /** Rolling average (or latest) direct P2P RTT in ms. */
  p2pRttMs: number | null;
  myInstanceRttMs: number | null;
  peerInstanceRttMs: number | null;
  peerState: P2PPeerState;
  hasRemoteAudioTrack: boolean;
  serverOnline: boolean;
  currentlyUsingP2P: boolean;
  /** Current monotonic/epoch timestamp in ms. */
  nowMs?: number;
  /** Timestamp when P2P first became >= 15ms worse than server path (null if not worse). */
  worseSinceMs?: number | null;
  /** Timestamp when P2P first became >= 10ms better than server path (null if not better). */
  betterSinceMs?: number | null;
}

export interface P2PAudioRouteDecision {
  route: P2PAudioRoute;
  /** Combined server round-trip estimate: my RTT to server + peer RTT to server. */
  serverPathRttMs: number | null;
  /** Positive when P2P is faster than going through the server. */
  savedMs: number | null;
  nextWorseSinceMs: number | null;
  nextBetterSinceMs: number | null;
}

/** Minimum latency gain (ms) required to switch from LiveKit -> direct P2P. */
export const P2P_SWITCH_GAIN_MS = 10;
/** Extra margin (ms) before switching back from P2P -> LiveKit (hysteresis). */
export const P2P_FALLBACK_MARGIN_MS = 15;
/** How long P2P must remain >= 15ms worse than server before falling back (avoids file-upload spikes). */
export const P2P_FALLBACK_HOLD_MS = 45_000;
/** How long P2P must remain >= 10ms better than server before upgrading (avoids single-ping flapping). */
export const P2P_UPGRADE_HOLD_MS = 9_000;
/** Rolling window size (~30s at 3s ping interval). */
export const P2P_RTT_WINDOW_SIZE = 10;

/**
 * Computes a trimmed/rolling mean RTT in ms over recent samples, dropping the
 * single highest spike when >= 5 samples exist so transient bursts don't skew it.
 */
export function computeSmoothedRttMs(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  if (samples.length < 5) {
    const sum = samples.reduce((a, b) => a + b, 0);
    return Math.round(sum / samples.length);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  // Trim the single worst outlier spike (e.g. a 1-second upload burst)
  const trimmed = sorted.slice(0, sorted.length - 1);
  const sum = trimmed.reduce((a, b) => a + b, 0);
  return Math.round(sum / trimmed.length);
}

/**
 * Computes whether a specific peer's voice audio should travel over the direct
 * P2P WebRTC tunnel or via the LiveKit server, using:
 *  - Full round-trip math: local -> server + server -> peer
 *  - Hysteresis (-10 ms to enter P2P, +15 ms to leave P2P)
 *  - Sustained time windows (9s to upgrade, 45s to fall back on latency)
 *  - Immediate failover on hard P2P disconnect/failure
 *  - Double failover (Survival Mode) if the server/LiveKit goes offline
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
    nowMs = Date.now(),
    worseSinceMs = null,
    betterSinceMs = null,
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

  // Hard failure / no remote audio track -> immediate LiveKit failover.
  if (!hasRemoteAudioTrack || peerState === 'failed' || peerState === 'closed') {
    return {
      route: 'livekit',
      serverPathRttMs,
      savedMs,
      nextWorseSinceMs: null,
      nextBetterSinceMs: null,
    };
  }

  // Double failover (Survival Mode): if the server/LiveKit is down, keep using the
  // already-established direct P2P tunnel even if RTT is elevated.
  if (!serverOnline && (peerState === 'connected' || peerState === 'degraded')) {
    return {
      route: 'p2p',
      serverPathRttMs,
      savedMs,
      nextWorseSinceMs: null,
      nextBetterSinceMs: null,
    };
  }

  // Server is online: if peer is still connecting or has no RTT yet, stay on LiveKit.
  if (peerState === 'connecting' || p2pRttMs === null) {
    return {
      route: 'livekit',
      serverPathRttMs,
      savedMs,
      nextWorseSinceMs: null,
      nextBetterSinceMs: null,
    };
  }

  // If peerState is degraded while server is online, count it toward the 45s fallback timer
  // (or immediately fall back if not currently using P2P).
  if (peerState === 'degraded') {
    if (!currentlyUsingP2P) {
      return {
        route: 'livekit',
        serverPathRttMs,
        savedMs,
        nextWorseSinceMs: null,
        nextBetterSinceMs: null,
      };
    }
    const started = worseSinceMs ?? nowMs;
    if (nowMs - started >= P2P_FALLBACK_HOLD_MS) {
      return {
        route: 'livekit',
        serverPathRttMs,
        savedMs,
        nextWorseSinceMs: null,
        nextBetterSinceMs: null,
      };
    }
    return {
      route: 'p2p',
      serverPathRttMs,
      savedMs,
      nextWorseSinceMs: started,
      nextBetterSinceMs: null,
    };
  }

  // If server RTT hasn't been probed yet, keep current route or upgrade after sustained low RTT.
  if (serverPathRttMs === null) {
    if (currentlyUsingP2P) {
      return {
        route: 'p2p',
        serverPathRttMs,
        savedMs,
        nextWorseSinceMs: null,
        nextBetterSinceMs: null,
      };
    }
    if (p2pRttMs <= 40) {
      const started = betterSinceMs ?? nowMs;
      if (nowMs - started >= P2P_UPGRADE_HOLD_MS) {
        return { route: 'p2p', serverPathRttMs, savedMs, nextWorseSinceMs: null, nextBetterSinceMs: null };
      }
      return { route: 'livekit', serverPathRttMs, savedMs, nextWorseSinceMs: null, nextBetterSinceMs: started };
    }
    return { route: 'livekit', serverPathRttMs, savedMs, nextWorseSinceMs: null, nextBetterSinceMs: null };
  }

  if (currentlyUsingP2P) {
    const isWorse = p2pRttMs > serverPathRttMs + P2P_FALLBACK_MARGIN_MS;
    if (!isWorse) {
      return {
        route: 'p2p',
        serverPathRttMs,
        savedMs,
        nextWorseSinceMs: null,
        nextBetterSinceMs: null,
      };
    }
    const started = worseSinceMs ?? nowMs;
    if (nowMs - started >= P2P_FALLBACK_HOLD_MS) {
      return {
        route: 'livekit',
        serverPathRttMs,
        savedMs,
        nextWorseSinceMs: null,
        nextBetterSinceMs: null,
      };
    }
    return {
      route: 'p2p',
      serverPathRttMs,
      savedMs,
      nextWorseSinceMs: started,
      nextBetterSinceMs: null,
    };
  }

  // Currently on LiveKit: require P2P to beat combined server path by >= 10ms for >= 9s.
  const isBetter = p2pRttMs <= serverPathRttMs - P2P_SWITCH_GAIN_MS;
  if (!isBetter) {
    return {
      route: 'livekit',
      serverPathRttMs,
      savedMs,
      nextWorseSinceMs: null,
      nextBetterSinceMs: null,
    };
  }
  const started = betterSinceMs ?? nowMs;
  if (nowMs - started >= P2P_UPGRADE_HOLD_MS) {
    return {
      route: 'p2p',
      serverPathRttMs,
      savedMs,
      nextWorseSinceMs: null,
      nextBetterSinceMs: null,
    };
  }
  return {
    route: 'livekit',
    serverPathRttMs,
    savedMs,
    nextWorseSinceMs: null,
    nextBetterSinceMs: started,
  };
}
