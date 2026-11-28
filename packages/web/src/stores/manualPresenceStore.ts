import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Activity } from '@backspace/shared';

export type ManualPresenceKind = 'playing' | 'looking_to_play' | 'watching' | 'listening';

export interface ManualPresenceConfig {
  type: ManualPresenceKind;
  name: string;
  details?: string;
}

interface ManualPresenceState {
  manual: ManualPresenceConfig | null;
  lastfmActivity: Activity | null;
  setManual: (manual: ManualPresenceConfig | null) => void;
  setLastfmActivity: (activity: Activity | null) => void;
}

export const useManualPresenceStore = create<ManualPresenceState>()(
  persist(
    (set) => ({
      manual: null,
      lastfmActivity: null,
      setManual: (manual) => set({ manual }),
      setLastfmActivity: (lastfmActivity) => set({ lastfmActivity }),
    }),
    {
      name: 'balacopapo-manual-presence',
      partialize: (state) => ({ manual: state.manual }),
    },
  ),
);
