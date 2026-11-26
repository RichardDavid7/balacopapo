import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMusicStore } from '../../stores/musicStore';
import { useAuthStore } from '../../stores/authStore';
import { getApiForOrigin, getChannelOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';

const VOTE_SKIP_PCT_OPTIONS = [25, 50, 60, 75, 100] as const;

export function MusicMiniPlayer({ channelId }: { channelId: string }) {
  const { t } = useTranslation(['voice', 'common']);
  const state = useMusicStore((s) => s.byChannel[channelId] ?? null);
  const setChannelState = useMusicStore((s) => s.setChannelState);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const addToast = useUIStore((s) => s.addToast);
  const channelPerms = useSpaceStore((s) => s.channelPermissions.get(channelId));
  const canManage = hasPermissionBit(channelPerms, PermissionBits.MANAGE_CHANNELS);

  const [expanded, setExpanded] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [busy, setBusy] = useState(false);

  const origin = getChannelOrigin(channelId);
  const client = getApiForOrigin(origin);

  useEffect(() => {
    let cancelled = false;
    client.music.getState(channelId)
      .then((s) => { if (!cancelled) setChannelState(s); })
      .catch(() => { /* Older server without music API */ });
    return () => { cancelled = true; };
  }, [channelId, client, setChannelState]);

  const currentTrack = state?.currentTrack ?? null;
  const listenerCount = Math.max(1, state?.listenerCount ?? 1);
  const thresholdPct = state?.voteSkipThresholdPct ?? 50;
  const requiredVotes = Math.max(1, Math.ceil((listenerCount * thresholdPct) / 100));
  const skipVotes = state?.skipVotes ?? [];
  const hasVotedSkip = Boolean(myUserId && skipVotes.includes(myUserId));

  const handleEnqueue = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const updated = await client.music.enqueue(channelId, { url: trimmed });
      setChannelState(updated);
      setUrlInput('');
    } catch {
      addToast(t('voice:music.actionFailed'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const handleVoteSkip = async () => {
    setBusy(true);
    try {
      const res = await client.music.voteSkip(channelId);
      setChannelState(res.state);
    } catch {
      addToast(t('voice:music.actionFailed'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const handleControl = async (
    action: 'pause' | 'resume' | 'skip' | 'stop' | 'volume' | 'loop' | 'queue_remove' | 'queue_clear',
    value?: number | string,
  ) => {
    setBusy(true);
    try {
      const updated = await client.music.control(channelId, { action, value });
      setChannelState(updated);
    } catch {
      addToast(t('voice:music.actionFailed'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const handleThresholdChange = async (pct: number) => {
    setBusy(true);
    try {
      const updated = await client.music.updateSettings(channelId, { voteSkipThresholdPct: pct });
      setChannelState(updated);
    } catch {
      addToast(t('voice:music.actionFailed'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-2.5 pt-2 pb-1.5 border-b border-white/[0.06]">
      {/* Compact Now Playing / Music header bar */}
      <div className="flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
          aria-expanded={expanded}
        >
          <span
            className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
              currentTrack && state?.status === 'playing'
                ? 'bg-accent-mint/15 text-accent-mint'
                : 'bg-white/[0.06] text-txt-tertiary group-hover:text-txt-primary'
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-txt-primary truncate">
              {currentTrack ? currentTrack.title : t('voice:music.title')}
            </div>
            <div className="text-[10px] text-txt-tertiary truncate">
              {currentTrack
                ? (currentTrack.artist || currentTrack.requestedByName)
                : (state?.botConnected ? t('voice:music.idleReady') : t('voice:music.botOfflineShort'))}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {currentTrack && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleControl(state?.status === 'playing' ? 'pause' : 'resume')}
                title={state?.status === 'playing' ? t('voice:music.pause') : t('voice:music.play')}
                aria-label={state?.status === 'playing' ? t('voice:music.pause') : t('voice:music.play')}
                className="w-6 h-6 rounded bg-white/[0.06] hover:bg-white/[0.12] text-txt-primary flex items-center justify-center transition-colors disabled:opacity-40"
              >
                {state?.status === 'playing' ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleVoteSkip()}
                title={t('voice:music.voteSkipTitle', { votes: skipVotes.length, required: requiredVotes, pct: thresholdPct })}
                className={`h-6 px-1.5 rounded text-[10px] font-semibold tabular-nums flex items-center gap-1 transition-colors disabled:opacity-40 ${
                  hasVotedSkip
                    ? 'bg-accent-amber/20 text-accent-amber'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-txt-secondary hover:text-txt-primary'
                }`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
                <span>{skipVotes.length}/{requiredVotes}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={t('voice:music.togglePanel')}
            className="w-6 h-6 rounded hover:bg-white/[0.08] text-txt-tertiary hover:text-txt-primary flex items-center justify-center transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expandable Queue + Vote-Skip % + Add URL drawer */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-2.5 text-xs">
          {!state?.botConnected && (
            <div className="text-[10px] text-txt-tertiary bg-white/[0.03] rounded px-2 py-1.5">
              {t('voice:music.botOfflineHint')}
            </div>
          )}

          {/* Add track URL */}
          <form onSubmit={(e) => { void handleEnqueue(e); }} className="flex items-center gap-1.5">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t('voice:music.addPlaceholder')}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-surface-base border border-border-soft text-[11px] text-txt-primary placeholder:text-txt-tertiary focus:outline-none focus:border-accent-primary"
            />
            <button
              type="submit"
              disabled={busy || !urlInput.trim()}
              className="px-2 py-1 rounded bg-accent-primary hover:bg-accent-primary-hover text-white text-[11px] font-semibold transition-colors disabled:opacity-40 shrink-0"
            >
              {t('voice:music.add')}
            </button>
          </form>

          {/* Vote-skip % configuration (managers) or read-only badge */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-txt-tertiary">
              <span>{t('voice:music.voteSkipThreshold')}</span>
              <span className="tabular-nums font-medium text-txt-secondary">
                {thresholdPct}% ({requiredVotes}/{listenerCount})
              </span>
            </div>
            {canManage && (
              <div className="grid grid-cols-5 gap-1">
                {VOTE_SKIP_PCT_OPTIONS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    disabled={busy}
                    onClick={() => void handleThresholdChange(pct)}
                    className={`py-0.5 rounded text-[10px] font-semibold tabular-nums transition-colors ${
                      thresholdPct === pct
                        ? 'bg-accent-primary text-white'
                        : 'bg-surface-base text-txt-secondary hover:text-txt-primary'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Volume + Stop */}
          {currentTrack && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-txt-tertiary shrink-0">{t('voice:music.volume')}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={state?.volume ?? 80}
                onChange={(e) => void handleControl('volume', Number(e.target.value))}
                className="flex-1 h-1 accent-accent-primary"
              />
              {canManage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleControl('stop')}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-accent-rose/15 text-accent-rose hover:bg-accent-rose/25 font-semibold shrink-0"
                >
                  {t('voice:music.stop')}
                </button>
              )}
            </div>
          )}

          {/* Upcoming Queue */}
          {state && state.queue.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-txt-tertiary uppercase font-semibold">
                <span>{t('voice:music.queueHeading', { total: state.queue.length })}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void handleControl('queue_clear')}
                    className="text-accent-rose hover:underline normal-case font-medium"
                  >
                    {t('voice:music.clearQueue')}
                  </button>
                )}
              </div>
              <div className="max-h-28 overflow-y-auto scrollbar-thin space-y-1">
                {state.queue.slice(0, 8).map((track, idx) => (
                  <div
                    key={track.id}
                    className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-white/[0.03] text-[11px]"
                  >
                    <span className="truncate text-txt-secondary">
                      {idx + 1}. {track.title}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => void handleControl('queue_remove', track.id)}
                        aria-label={t('common:actions.delete')}
                        className="text-txt-tertiary hover:text-accent-rose px-1 shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
