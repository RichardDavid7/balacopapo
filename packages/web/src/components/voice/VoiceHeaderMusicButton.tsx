import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useMusicStore } from '../../stores/musicStore';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { MusicMiniPlayer } from './MusicMiniPlayer';

export function VoiceHeaderMusicButton({ channelId }: { channelId: string }) {
  const { t } = useTranslation(['voice']);
  const state = useMusicStore((s) => s.byChannel[channelId] ?? null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const portalContainer = usePortalContainer();

  const { style } = useFloatingPosition(btnRef, popoverRef, {
    placement: 'bottom',
    offset: 8,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isPlaying = Boolean(state?.currentTrack && state.status === 'playing');

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={t('voice:music.title')}
        aria-label={t('voice:music.title')}
        aria-expanded={open}
        className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors ${
          open || isPlaying
            ? 'bg-accent-mint/15 text-accent-mint hover:bg-accent-mint/25'
            : 'text-txt-tertiary hover:text-txt-primary hover:bg-white/[0.06]'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
        {state?.currentTrack ? (
          <span className="max-w-[130px] truncate hidden sm:inline">{state.currentTrack.title}</span>
        ) : (
          <span className="hidden sm:inline">{t('voice:music.title')}</span>
        )}
        {isPlaying && <span className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse shrink-0" />}
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          style={style}
          className="fixed z-[9990] w-[310px] glass-modal rounded-xl border border-white/[0.08] shadow-2xl overflow-hidden"
        >
          <MusicMiniPlayer channelId={channelId} />
        </div>,
        portalContainer ?? document.body,
      )}
    </>
  );
}
