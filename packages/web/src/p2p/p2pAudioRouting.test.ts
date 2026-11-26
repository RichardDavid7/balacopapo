import { describe, it, expect } from 'vitest';
import { evaluateP2PAudioRoute } from './p2pAudioRouting';

describe('evaluateP2PAudioRoute', () => {
  it('switches to P2P when two nearby peers beat combined server round-trip (Rio <-> Rio vs Bahia)', () => {
    // Carioca A -> Bahia = 45ms, Carioca B -> Bahia = 50ms => serverPath = 95ms; direct P2P = 12ms
    const res = evaluateP2PAudioRoute({
      p2pRttMs: 12,
      myInstanceRttMs: 45,
      peerInstanceRttMs: 50,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: false,
    });
    expect(res.route).toBe('p2p');
    expect(res.serverPathRttMs).toBe(95);
    expect(res.savedMs).toBe(83);
  });

  it('stays on LiveKit when P2P does not beat the server path by at least 10ms', () => {
    const res = evaluateP2PAudioRoute({
      p2pRttMs: 48,
      myInstanceRttMs: 25,
      peerInstanceRttMs: 25,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: false,
    });
    expect(res.route).toBe('livekit');
    expect(res.serverPathRttMs).toBe(50);
  });

  it('applies hysteresis to prevent flapping when already on P2P', () => {
    const stay = evaluateP2PAudioRoute({
      p2pRttMs: 60,
      myInstanceRttMs: 25,
      peerInstanceRttMs: 25,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
    });
    expect(stay.route).toBe('p2p');

    const fallback = evaluateP2PAudioRoute({
      p2pRttMs: 70,
      myInstanceRttMs: 25,
      peerInstanceRttMs: 25,
      peerState: 'connected',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
    });
    expect(fallback.route).toBe('livekit');
  });

  it('falls back to LiveKit if P2P degrades while server is online', () => {
    const res = evaluateP2PAudioRoute({
      p2pRttMs: 15,
      myInstanceRttMs: 50,
      peerInstanceRttMs: 50,
      peerState: 'degraded',
      hasRemoteAudioTrack: true,
      serverOnline: true,
      currentlyUsingP2P: true,
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
    });
    expect(res.route).toBe('p2p');
  });

  it('never routes to P2P when no remote audio track is attached', () => {
    const res = evaluateP2PAudioRoute({
      p2pRttMs: 5,
      myInstanceRttMs: 50,
      peerInstanceRttMs: 50,
      peerState: 'connected',
      hasRemoteAudioTrack: false,
      serverOnline: false,
      currentlyUsingP2P: true,
    });
    expect(res.route).toBe('livekit');
  });
});
