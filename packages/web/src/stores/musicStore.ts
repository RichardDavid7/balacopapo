import { create } from 'zustand';
import type { MusicPlayerState } from '@backspace/shared';

interface MusicStoreState {
  byChannel: Record<string, MusicPlayerState>;
  setChannelState: (state: MusicPlayerState) => void;
  clearChannel: (channelId: string) => void;
  reset: () => void;
}

export const useMusicStore = create<MusicStoreState>((set) => ({
  byChannel: {},
  setChannelState: (state) =>
    set((s) => ({
      byChannel: { ...s.byChannel, [state.channelId]: state },
    })),
  clearChannel: (channelId) =>
    set((s) => {
      const next = { ...s.byChannel };
      delete next[channelId];
      return { byChannel: next };
    }),
  reset: () => set({ byChannel: {} }),
}));
