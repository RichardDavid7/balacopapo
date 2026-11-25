import { create } from 'zustand';
import type { StreamPointerMode } from '../utils/streamPointerProtocol';
import { pointerColorForIdentity } from '../utils/streamPointerProtocol';

export interface ActiveStreamPointer {
  id: string;
  streamIdentity: string;
  senderIdentity: string;
  senderName: string;
  x: number;
  y: number;
  mode: StreamPointerMode;
  color: string;
  expiresAt: number;
  pulseKey: number;
}

interface StreamPointerState {
  pointers: Record<string, ActiveStreamPointer>;
  upsertPointer: (input: {
    streamIdentity: string;
    senderIdentity: string;
    senderName: string;
    x: number;
    y: number;
    mode: StreamPointerMode;
    color?: string;
  }) => void;
  pruneExpired: () => void;
  reset: () => void;
}

const PING_TTL_MS = 2600;
const DRAG_TTL_MS = 1400;
const CLEAR_TTL_MS = 350;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweepRunning(): void {
  if (sweepTimer !== null) return;
  sweepTimer = setInterval(() => {
    const state = useStreamPointerStore.getState();
    state.pruneExpired();
    if (Object.keys(useStreamPointerStore.getState().pointers).length === 0 && sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, 250);
}

export const useStreamPointerStore = create<StreamPointerState>((set) => ({
  pointers: {},

  upsertPointer: ({ streamIdentity, senderIdentity, senderName, x, y, mode, color }) => {
    const id = `${streamIdentity}:${senderIdentity}`;
    const now = Date.now();
    const ttl = mode === 'ping' ? PING_TTL_MS : mode === 'drag' ? DRAG_TTL_MS : CLEAR_TTL_MS;

    set((state) => {
      const prev = state.pointers[id];
      const next: ActiveStreamPointer = {
        id,
        streamIdentity,
        senderIdentity,
        senderName,
        x,
        y,
        mode,
        color: color ?? prev?.color ?? pointerColorForIdentity(senderIdentity),
        expiresAt: now + ttl,
        pulseKey: mode === 'ping' ? (prev?.pulseKey ?? 0) + 1 : (prev?.pulseKey ?? 0),
      };
      return {
        pointers: {
          ...state.pointers,
          [id]: next,
        },
      };
    });

    ensureSweepRunning();
  },

  pruneExpired: () => {
    const now = Date.now();
    set((state) => {
      let changed = false;
      const next: Record<string, ActiveStreamPointer> = {};
      for (const [k, p] of Object.entries(state.pointers)) {
        if (p.expiresAt > now) {
          next[k] = p;
        } else {
          changed = true;
        }
      }
      return changed ? { pointers: next } : state;
    });
  },

  reset: () => {
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    set({ pointers: {} });
  },
}));
