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
  /** Automatic game/app detected by the Desktop process scanner (activityDetector.ts). */
  detectedActivity: Activity | null;
  /** Optional manual activity set from the Status Picker (Looking to play / Watching / etc.). */
  manual: ManualPresenceConfig | null;
  /** Automatic Last.fm "Now Playing" activity. */
  lastfmActivity: Activity | null;
  setDetectedActivity: (activity: Activity | null) => void;
  setManual: (manual: ManualPresenceConfig | null) => void;
  setLastfmActivity: (activity: Activity | null) => void;
}

export const useManualPresenceStore = create<ManualPresenceState>()(
  persist(
    (set) => ({
      detectedActivity: null,
      manual: null,
      lastfmActivity: null,
      setDetectedActivity: (detectedActivity) => set({ detectedActivity }),
      setManual: (manual) => set({ manual }),
      setLastfmActivity: (lastfmActivity) => set({ lastfmActivity }),
    }),
    {
      name: 'balacopapo-manual-presence',
      partialize: (state) => ({ manual: state.manual }),
    },
  ),
);
