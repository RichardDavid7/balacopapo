import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Activity, ActivityType, User } from '@backspace/shared';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { activitiesFor, useActivityStore } from '../../stores/activityStore';
import { useManualPresenceStore } from '../../stores/manualPresenceStore';

const LASTFM_POLL_MS = 30_000;

/**
 * Keeps the user's Rich Presence activities synchronized by merging all 3 sources:
 * 1. Automatic Desktop game/app detection (`detectedActivity` from `activityBridge.ts`)
 * 2. Optional manual activity chosen in the Status Picker (Looking to play / Watching / etc.)
 * 3. Automatic Last.fm "Now Playing" scrobble pushed as a `listening` activity
 */
export function useRichPresenceSync(): void {
  const user = useAuthStore((s) => s.user);
  const detectedActivity = useManualPresenceStore((s) => s.detectedActivity);
  const manual = useManualPresenceStore((s) => s.manual);
  const lastfmActivity = useManualPresenceStore((s) => s.lastfmActivity);
  const setLastfmActivity = useManualPresenceStore((s) => s.setLastfmActivity);
  const pushActivities = useActivityStore((s) => s.pushActivities);
  const showActivity = useActivityStore((s) => s.showActivity);

  // Poll Last.fm now-playing for the signed-in user when linked
  useEffect(() => {
    if (!user?.id || !user.lastfmUsername || user.lastfmShowNowPlaying === false) {
      setLastfmActivity(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.lastfm.getNowPlaying(user.id);
        if (cancelled) return;
        if (res.isPlaying && res.track) {
          setLastfmActivity({
            type: 'listening',
            name: res.track.name,
            details: res.track.artist,
            state: res.track.album ?? undefined,
            url: res.track.trackUrl ?? res.profileUrl ?? undefined,
            assets: res.track.coverUrl
              ? { largeImage: res.track.coverUrl, largeText: res.track.album ?? res.track.name }
              : undefined,
          });
        } else {
          setLastfmActivity(null);
        }
      } catch {
        /* ignore transient poll error */
      }
    };

    void poll();
    const timer = setInterval(() => { void poll(); }, LASTFM_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.id, user?.lastfmUsername, user?.lastfmShowNowPlaying, setLastfmActivity]);

  // Merge automatic desktop game + manual status + Last.fm and push via WebSocket
  useEffect(() => {
    if (!user?.id) return;
    if (!showActivity) {
      pushActivities([]);
      return;
    }
    const list: Activity[] = [];
    if (detectedActivity) {
      list.push(detectedActivity);
    }
    if (manual && manual.name.trim()) {
      list.push({
        type: manual.type,
        name: manual.name.trim(),
        details: manual.details?.trim() || undefined,
      });
    }
    if (lastfmActivity) {
      list.push(lastfmActivity);
    }
    pushActivities(list);
  }, [user?.id, showActivity, detectedActivity, manual, lastfmActivity, pushActivities]);
}

function ActivityTypeIcon({ type }: { type: ActivityType }) {
  switch (type) {
    case 'playing':
    case 'looking_to_play':
      return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
        </svg>
      );
    case 'watching':
      return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12zm-5-6l-6 3.5v-7L16 11z" />
        </svg>
      );
    case 'listening':
      return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      );
    default:
      return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="6" />
        </svg>
      );
  }
}

function accentBadgeClasses(type: ActivityType): { iconBg: string; liveDot: string; liveText: string } {
  if (type === 'listening') {
    return {
      iconBg: 'bg-accent-rose/20 text-accent-rose',
      liveDot: 'bg-accent-mint',
      liveText: 'text-accent-mint',
    };
  }
  if (type === 'looking_to_play') {
    return {
      iconBg: 'bg-accent-amber/20 text-accent-amber',
      liveDot: 'bg-accent-amber',
      liveText: 'text-accent-amber',
    };
  }
  return {
    iconBg: 'bg-accent-primary/20 text-accent-primary',
    liveDot: 'bg-accent-mint',
    liveText: 'text-accent-mint',
  };
}

export function RichPresenceCard({ user, origin = '' }: { user: User; origin?: string }) {
  const { t } = useTranslation(['social']);
  const userActivities = useActivityStore((s) => s.userActivities);
  const activities = activitiesFor(userActivities, user, origin);

  if (activities.length === 0) return null;

  return (
    <div className="space-y-2">
      {activities.map((act, idx) => {
        const colors = accentBadgeClasses(act.type);
        const isLastFmListening = act.type === 'listening' && Boolean(user.lastfmUsername);
        const headerLabel = isLastFmListening
          ? t('social:lastfm.profileLabel', { username: user.lastfmUsername })
          : t(`social:presence.activityTypes.${act.type}`);
        const liveLabel = act.type === 'listening'
          ? t('social:lastfm.nowPlaying')
          : t(`social:presence.activityTypes.${act.type}`);
        const headerHref = isLastFmListening && user.lastfmUsername
          ? `https://www.last.fm/user/${encodeURIComponent(user.lastfmUsername)}`
          : null;

        return (
          <div
            key={`${act.type}-${act.name}-${idx}`}
            className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 space-y-2"
          >
            {/* Header row (styled like the Last.fm card) */}
            <div className="flex items-center justify-between gap-2">
              {headerHref ? (
                <a
                  href={headerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-txt-secondary hover:text-txt-primary transition-colors min-w-0"
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${colors.iconBg}`}>
                    <ActivityTypeIcon type={act.type} />
                  </span>
                  <span className="truncate">{headerLabel}</span>
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-txt-secondary min-w-0">
                  <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${colors.iconBg}`}>
                    <ActivityTypeIcon type={act.type} />
                  </span>
                  <span className="truncate">{headerLabel}</span>
                </span>
              )}

              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${colors.liveText}`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${colors.liveDot}`} />
                {liveLabel}
              </span>
            </div>

            {/* Body row: cover/icon + title/details/state */}
            <div className="flex items-center gap-2.5 min-w-0">
              {act.assets?.largeImage ? (
                <img
                  src={act.assets.largeImage}
                  alt={act.assets.largeText || act.name}
                  className="w-10 h-10 rounded object-cover shrink-0 border border-white/[0.08]"
                  loading="lazy"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-white/[0.06] border border-white/[0.06] flex items-center justify-center text-txt-tertiary shrink-0">
                  <ActivityTypeIcon type={act.type} />
                </div>
              )}

              <div className="min-w-0 flex-1">
                {act.url ? (
                  <a
                    href={act.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs font-semibold text-txt-primary hover:underline truncate"
                  >
                    {act.name}
                  </a>
                ) : (
                  <div className="text-xs font-semibold text-txt-primary truncate">{act.name}</div>
                )}
                {act.details && (
                  <div className="text-[11px] text-txt-secondary truncate">{act.details}</div>
                )}
                {act.state && (
                  <div className="text-[10px] text-txt-tertiary truncate">{act.state}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
