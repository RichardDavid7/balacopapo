import { useEffect, useRef } from 'react';
import { selectMyChosenStatus, useAuthStore } from '../stores/authStore';
import { useVoiceStore } from '../stores/voiceStore';
import { wsSendAll } from './useWebSocket';

const AUTO_IDLE_TIMEOUT_MS = 5 * 60_000; // 5 minutes, Discord-style
const ACTIVITY_THROTTLE_MS = 10_000;

/**
 * Discord-style automatic idle: when the user's chosen status is `online` and
 * they have no pointer/keyboard interaction for 5 minutes (and aren't actively
 * speaking in a voice call), temporarily broadcasts `idle` without overwriting
 * their saved chosen status. Restores `online` immediately on the next input.
 */
export function useAutoIdle(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const chosenStatus = useAuthStore(selectMyChosenStatus);
  const autoIdledRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!userId || chosenStatus !== 'online') {
      autoIdledRef.current = false;
      return;
    }

    lastActivityRef.current = Date.now();
    let lastSignalAt = 0;

    const markActive = () => {
      const now = Date.now();
      if (now - lastSignalAt < ACTIVITY_THROTTLE_MS && !autoIdledRef.current) return;
      lastSignalAt = now;
      lastActivityRef.current = now;
      if (autoIdledRef.current) {
        autoIdledRef.current = false;
        if (selectMyChosenStatus(useAuthStore.getState()) === 'online') {
          wsSendAll({ type: 'presence_update', status: 'online' });
        }
      }
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    for (const ev of events) {
      window.addEventListener(ev, markActive, { passive: true });
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') markActive();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const interval = setInterval(() => {
      if (autoIdledRef.current) return;
      if (selectMyChosenStatus(useAuthStore.getState()) !== 'online') return;
      // Don't mark idle while actively in a voice call with unmuted mic
      const voice = useVoiceStore.getState();
      if ((voice.currentVoiceChannelId || voice.activeDmCall) && !voice.isMuted) {
        lastActivityRef.current = Date.now();
        return;
      }
      if (Date.now() - lastActivityRef.current >= AUTO_IDLE_TIMEOUT_MS) {
        autoIdledRef.current = true;
        wsSendAll({ type: 'presence_update', status: 'idle' });
      }
    }, 15_000);

    return () => {
      clearInterval(interval);
      for (const ev of events) {
        window.removeEventListener(ev, markActive);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, chosenStatus]);
}
