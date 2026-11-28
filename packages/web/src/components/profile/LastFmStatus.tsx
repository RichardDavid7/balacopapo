import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LastFmNowPlayingResponse } from '@backspace/shared';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';

interface LastFmStatusProps {
  userId: string;
  username?: string | null;
  showNowPlaying?: boolean;
  origin?: string;
}

const REFRESH_INTERVAL_MS = 30_000;

export function LastFmStatus({ userId, username, showNowPlaying = true, origin = '' }: LastFmStatusProps) {
  const { t } = useTranslation(['social']);
  const [data, setData] = useState<LastFmNowPlayingResponse | null>(null);

  useEffect(() => {
    if (!username || !showNowPlaying) {
      setData(null);
      return;
    }
    let cancelled = false;
    const client = getApiForOrigin(origin);

    const load = async () => {
      try {
        const res = await client.lastfm.getNowPlaying(userId);
        if (!cancelled) setData(res);
      } catch {
        // Older instance or network hiccup — keep profile link visible gracefully
      }
    };

    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId, username, showNowPlaying, origin]);

  if (!username) return null;

  const profileUrl = data?.profileUrl || `https://www.last.fm/user/${encodeURIComponent(username)}`;
  const track = data?.isPlaying ? data.track : null;

  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-txt-secondary hover:text-txt-primary transition-colors min-w-0"
        >
          <span className="w-4 h-4 rounded bg-accent-rose/20 text-accent-rose flex items-center justify-center shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </span>
          <span className="truncate">{t('social:lastfm.profileLabel', { username })}</span>
        </a>

        {track && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-mint shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
            {t('social:lastfm.nowPlaying')}
          </span>
        )}
      </div>

      {track && (
        <div className="flex items-center gap-2.5 min-w-0">
          {track.coverUrl ? (
            <img
              src={track.coverUrl}
              alt={track.album || track.name}
              className="w-10 h-10 rounded object-cover shrink-0 border border-white/[0.08]"
              loading="lazy"
            />
          ) : (
            <div className="w-10 h-10 rounded bg-white/[0.06] border border-white/[0.06] flex items-center justify-center text-txt-tertiary shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}

          <div className="min-w-0 flex-1">
            {track.trackUrl ? (
              <a
                href={track.trackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs font-semibold text-txt-primary hover:underline truncate"
              >
                {track.name}
              </a>
            ) : (
              <div className="text-xs font-semibold text-txt-primary truncate">{track.name}</div>
            )}
            <div className="text-[11px] text-txt-secondary truncate">{track.artist}</div>
            {track.album && (
              <div className="text-[10px] text-txt-tertiary truncate">{track.album}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
