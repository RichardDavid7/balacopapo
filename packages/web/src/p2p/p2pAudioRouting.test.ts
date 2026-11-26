import { describe, it, expect } from 'vitest';
import {
  computeSmoothedRttMs,
  evaluateP2PAudioRoute,
  P2P_FALLBACK_HOLD_MS,
  P2P_UPGRADE_HOLD_MS,
} from './p2pAudioRouting';

describe('computeSmoothedRttMs', () => {
  it('trims the single worst outlier spike when >= 5 samples exist', () => {
    // 4 normal samples around 14ms + 1 brief 250ms upload spike -> trimmed mean = 14ms
    expect(computeSmoothedRttMs([12, 15, 250, 14, 15])).toBe(14);
  });

  it('averages normally when fewer than 5 samples exist', () => {
    expect(computeSmoothedRttMs([10, 20, 30])).toBe(20);
    expect(computeSmoothedRttMs([])).toBeNull();
  });
});

describe('evaluateP2PAudioRoute', () => {
  it('upgrades to P2P after sustained >= 9s of beating combined server round-trip (Rio <-> Rio vs Bahia)', () => {
    // Carioca A -> Bahia = 45ms, Carioca B -> Bahia = 50ms => serverPath = 95ms; direct P2P = 12ms
    const t0 = 100_000;
    const first = evaluateP2PAudioRoute({
      p2pRttMs: 12,
      myInstanceRttMs: 45,
      peerInstanceRttMs: 50,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: false,
      nowMs: t0,
    });
    expect(first.route).toBe('livekit');
    expect(first.nextBetterSinceMs).toBe(t0);
    expect(first.serverPathRttMs).toBe(95);
    expect(first.savedMs).toBe(83);

    const afterHold = evaluateP2PAudioRoute({
      p2pRttMs: 12,
      myInstanceRttMs: 45,
      peerInstanceRttMs: 50,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: false,
      nowMs: t0 + P2P_UPGRADE_HOLD_MS,
      betterSinceMs: first.nextBetterSinceMs,
    });
    expect(afterHold.route).toBe('p2p');
  });

  it('does NOT flap back to LiveKit during a 30s file-upload spike, but falls back after 45s sustained >= 15ms worse', () => {
    const t0 = 200_000;
    // Server path = 50ms; P2P spikes to 70ms (+20ms worse)
    const startWorse = evaluateP2PAudioRoute({
      p2pRttMs: 70,
      myInstanceRttMs: 25,
      peerInstanceRttMs: 25,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
      nowMs: t0,
    });
    expect(startWorse.route).toBe('p2p');
    expect(startWorse.nextWorseSinceMs).toBe(t0);

    // 30s later: still inside 45s hold window -> stays on P2P (no flapping!)
    const at30s = evaluateP2PAudioRoute({
      p2pRttMs: 70,
      myInstanceRttMs: 25,
      peerInstanceRttMs: 25,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
      nowMs: t0 + 30_000,
      worseSinceMs: startWorse.nextWorseSinceMs,
    });
    expect(at30s.route).toBe('p2p');
    expect(at30s.nextWorseSinceMs).toBe(t0);

    // 45s sustained: now cleanly falls back to LiveKit
    const at45s = evaluateP2PAudioRoute({
      p2pRttMs: 70,
      myInstanceRttMs: 25,
      peerInstanceRttMs: 25,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
      nowMs: t0 + P2P_FALLBACK_HOLD_MS,
      worseSinceMs: at30s.nextWorseSinceMs,
    });
    expect(at45s.route).toBe('livekit');
    expect(at45s.nextWorseSinceMs).toBeNull();
  });

  it('resets the 45s fallback timer if the spike clears before 45s', () => {
    const t0 = 300_000;
    const recovered = evaluateP2PAudioRoute({
      p2pRttMs: 20,
      myInstanceRttMs: 25,
      peerInstanceRttMs: 25,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
      nowMs: t0 + 25_000,
      worseSinceMs: t0,
    });
    expect(recovered.route).toBe('p2p');
    expect(recovered.nextWorseSinceMs).toBeNull();
  });

  it('fails over immediately on hard P2P failure/close', () => {
    const res = evaluateP2PAudioRoute({
      p2pRttMs: 12,
      myInstanceRttMs: 50,
      peerInstanceRttMs: 50,
      peerState: 'failed',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
      nowMs: 400_000,
    });
    expect(res.route).toBe('livekit');
  });

  it('keeps direct P2P alive during a server outage (double failover / survival mode)', () => {
    const res = evaluateP2PAudioRoute({
      p2pRttMs: 120,
      myInstanceRttMs: 50,
      peerInstanceRttMs: 50,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: false,
      currentlyUsingP2P: false,
      nowMs: 500_000,
    });
    expect(res.route).toBe('p2p');
  });
});
