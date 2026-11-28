import type { Activity } from '@backspace/shared';
import { useManualPresenceStore } from '../stores/manualPresenceStore';

let unsubscribe: (() => void) | null = null;

export function initActivityBridge(): void {
  if (unsubscribe) return; // already initialized
  if (!window.backspace?.onActivityDetected) return; // not Electron

  // Subscribe to future activity changes from main process
  unsubscribe = window.backspace.onActivityDetected((activity) => {
    useManualPresenceStore.getState().setDetectedActivity((activity as Activity) || null);
  });

  // Request current state (handles instance-switch: game was already running)
  window.backspace.getCurrentActivity?.().then((activity: unknown) => {
    useManualPresenceStore.getState().setDetectedActivity((activity as Activity) || null);
  }).catch(() => {});
}

export function teardownActivityBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}
