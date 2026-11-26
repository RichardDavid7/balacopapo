import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBotStateReport,
  applyMusicControl,
  drainBotCommands,
  enqueueMusicTrack,
  getMusicState,
  requiredSkipVotes,
  resetMusicSessionsForTests,
  toggleVoteSkip,
  updateMusicSettings,
} from './musicState.js';

describe('musicState vote-skip % and bot API', () => {
  beforeEach(() => {
    resetMusicSessionsForTests();
  });

  it('computes required skip votes from listener count and configurable percentage', () => {
    expect(requiredSkipVotes(4, 50)).toBe(2);
    expect(requiredSkipVotes(4, 60)).toBe(3);
    expect(requiredSkipVotes(4, 75)).toBe(3);
    expect(requiredSkipVotes(4, 100)).toBe(4);
    expect(requiredSkipVotes(1, 100)).toBe(1);
    expect(requiredSkipVotes(5, 50)).toBe(3);
  });

  it('skips automatically when vote-skip percentage threshold is reached and drains bot commands', () => {
    enqueueMusicTrack('ch-1', {
      url: 'https://youtu.be/first',
      title: 'Track 1',
      requestedByUserId: 'u1',
      requestedByName: 'Alice',
    }, 4);
    enqueueMusicTrack('ch-1', {
      url: 'https://youtu.be/second',
      title: 'Track 2',
      requestedByUserId: 'u2',
      requestedByName: 'Bob',
    }, 4);

    // 4 listeners, 50% threshold => 2 votes needed
    const v1 = toggleVoteSkip('ch-1', 'u1', 4);
    expect(v1.skipped).toBe(false);
    expect(v1.requiredVotes).toBe(2);
    expect(v1.state.skipVotes).toEqual(['u1']);
    expect(v1.state.currentTrack?.title).toBe('Track 1');

    // Second vote reaches 50% => auto-skip to Track 2
    const v2 = toggleVoteSkip('ch-1', 'u2', 4);
    expect(v2.skipped).toBe(true);
    expect(v2.state.currentTrack?.title).toBe('Track 2');
    expect(v2.state.skipVotes).toEqual([]);

    const cmds = drainBotCommands('ch-1');
    expect(cmds.map((c) => c.type)).toEqual(['play', 'play', 'skip']);
    expect(drainBotCommands('ch-1')).toEqual([]);
  });

  it('triggers skip immediately when vote-skip threshold is lowered below existing votes', () => {
    enqueueMusicTrack('ch-2', {
      url: 'https://youtu.be/a',
      title: 'Song A',
      requestedByUserId: 'u1',
      requestedByName: 'Alice',
    }, 4);
    updateMusicSettings('ch-2', 75, 'admin', 4); // needs 3 of 4
    toggleVoteSkip('ch-2', 'u1', 4);
    toggleVoteSkip('ch-2', 'u2', 4);
    expect(getMusicState('ch-2', 4).currentTrack?.title).toBe('Song A');

    // Lowering to 50% (needs 2 of 4) skips immediately
    const res = updateMusicSettings('ch-2', 50, 'admin', 4);
    expect(res.skipped).toBe(true);
    expect(res.state.currentTrack).toBeNull();
  });

  it('accepts companion bot state reports and resets votes on track change', () => {
    enqueueMusicTrack('ch-3', {
      url: 'https://youtu.be/x',
      title: 'Old',
      requestedByUserId: 'u1',
      requestedByName: 'Alice',
    }, 3);
    toggleVoteSkip('ch-3', 'u1', 3);
    const updated = applyBotStateReport('ch-3', {
      botConnected: true,
      botName: 'Balacopapo Utilidades',
      status: 'playing',
      positionSec: 42,
      currentTrack: {
        id: 't-new',
        title: 'New Track',
        source: 'navidrome',
        url: 'https://navidrome.local/rest/stream?id=1',
        requestedByUserId: 'u2',
        requestedByName: 'Bob',
        addedAt: Date.now(),
      },
    }, 3);
    expect(updated.botConnected).toBe(true);
    expect(updated.positionSec).toBe(42);
    expect(updated.skipVotes).toEqual([]);

    const paused = applyMusicControl('ch-3', 'u1', 'pause', undefined, 3);
    expect(paused.status).toBe('paused');
  });
});
