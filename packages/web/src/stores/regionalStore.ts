import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TimeFormatPreference = 'auto' | '12h' | '24h';
export type DateFormatPreference = 'auto' | 'dmy' | 'mdy' | 'ymd';
export type NumberFormatPreference = 'auto' | 'comma-decimal' | 'dot-decimal';

export interface RegionalPreferences {
  timeFormat: TimeFormatPreference;
  dateFormat: DateFormatPreference;
  numberFormat: NumberFormatPreference;
}

interface RegionalState extends RegionalPreferences {
  setTimeFormat: (timeFormat: TimeFormatPreference) => void;
  setDateFormat: (dateFormat: DateFormatPreference) => void;
  setNumberFormat: (numberFormat: NumberFormatPreference) => void;
  resetRegional: () => void;
}

export const DEFAULT_REGIONAL_PREFS: RegionalPreferences = {
  timeFormat: 'auto',
  dateFormat: 'auto',
  numberFormat: 'auto',
};

export const useRegionalStore = create<RegionalState>()(
  persist(
    (set) => ({
      ...DEFAULT_REGIONAL_PREFS,
      setTimeFormat: (timeFormat) => set({ timeFormat }),
      setDateFormat: (dateFormat) => set({ dateFormat }),
      setNumberFormat: (numberFormat) => set({ numberFormat }),
      resetRegional: () => set({ ...DEFAULT_REGIONAL_PREFS }),
    }),
    {
      name: 'balacopapo-regional-prefs',
      partialize: (state) => ({
        timeFormat: state.timeFormat,
        dateFormat: state.dateFormat,
        numberFormat: state.numberFormat,
      }),
    },
  ),
);
