import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ChosenUserStatus, User } from '@backspace/shared';
import { selectMyChosenStatus, useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useFormatters } from '../../i18n/formatters';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { layoutPixels, layoutRect } from '../../platform/interfaceScale';

const REVERT_STORAGE_KEY = 'backspace_status_revert';

interface StatusRevertRecord {
  userId: string;
  previousStatus: ChosenUserStatus;
  revertAt: number;
}

let _revertTimer: ReturnType<typeof setTimeout> | null = null;

function readRevertRecord(expectedUserId?: string | null): StatusRevertRecord | null {
  try {
    const raw = localStorage.getItem(REVERT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StatusRevertRecord>;
    if (
      typeof parsed.userId === 'string'
      && parsed.userId.length > 0
      && (!expectedUserId || parsed.userId === expectedUserId)
      && (parsed.previousStatus === 'online'
        || parsed.previousStatus === 'idle'
        || parsed.previousStatus === 'dnd')
      && typeof parsed.revertAt === 'number'
      && Number.isFinite(parsed.revertAt)
    ) {
      return { userId: parsed.userId, previousStatus: parsed.previousStatus, revertAt: parsed.revertAt };
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function clearRevertTimer(): void {
  if (_revertTimer) {
    clearTimeout(_revertTimer);
    _revertTimer = null;
  }
  try {
    localStorage.removeItem(REVERT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function scheduleStatusRevert(record: StatusRevertRecord): void {
  if (_revertTimer) {
    clearTimeout(_revertTimer);
    _revertTimer = null;
  }
  const activeUserId = useAuthStore.getState().user?.id;
  if (!activeUserId || activeUserId !== record.userId) {
    return;
  }
  const delay = record.revertAt - Date.now();
  if (delay <= 0) {
    clearRevertTimer();
    void useAuthStore.getState().updateProfile({ status: record.previousStatus }).catch(() => {});
    return;
  }
  try {
    localStorage.setItem(REVERT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore
  }
  _revertTimer = setTimeout(() => {
    _revertTimer = null;
    const currentUserId = useAuthStore.getState().user?.id;
    if (!currentUserId || currentUserId !== record.userId) return;
    clearRevertTimer();
    void useAuthStore.getState().updateProfile({ status: record.previousStatus }).catch(() => {});
  }, delay);
}

/** Resume any pending status-revert timer on app mount and when returning from sleep/background. */
export function useStatusRevertBootstrap(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (!userId) {
      if (_revertTimer) {
        clearTimeout(_revertTimer);
        _revertTimer = null;
      }
      return;
    }
    const checkPending = () => {
      const rec = readRevertRecord(userId);
      if (rec) scheduleStatusRevert(rec);
    };
    checkPending();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkPending();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);
}

const STATUS_OPTIONS: readonly {
  value: ChosenUserStatus;
  dotClass: string;
  labelKey: 'states.online' | 'states.idle' | 'states.doNotDisturb';
}[] = [
  { value: 'online', dotClass: 'bg-status-online', labelKey: 'states.online' },
  { value: 'idle', dotClass: 'bg-status-idle', labelKey: 'states.idle' },
  { value: 'dnd', dotClass: 'bg-status-dnd', labelKey: 'states.doNotDisturb' },
];

function statusLabelKey(status: ChosenUserStatus): 'states.online' | 'states.idle' | 'states.doNotDisturb' {
  switch (status) {
    case 'online': return 'states.online';
    case 'idle': return 'states.idle';
    case 'dnd': return 'states.doNotDisturb';
  }
}

type DurationOption = 'none' | '15m' | '30m' | '1h' | '4h' | 'tomorrow';
type DurationLabelKey =
  | 'statusPicker.durations.none'
  | 'statusPicker.durations.15m'
  | 'statusPicker.durations.30m'
  | 'statusPicker.durations.1h'
  | 'statusPicker.durations.4h'
  | 'statusPicker.durations.tomorrow';

const DURATION_OPTIONS: readonly { id: DurationOption; labelKey: DurationLabelKey }[] = [
  { id: 'none', labelKey: 'statusPicker.durations.none' },
  { id: '15m', labelKey: 'statusPicker.durations.15m' },
  { id: '30m', labelKey: 'statusPicker.durations.30m' },
  { id: '1h', labelKey: 'statusPicker.durations.1h' },
  { id: '4h', labelKey: 'statusPicker.durations.4h' },
  { id: 'tomorrow', labelKey: 'statusPicker.durations.tomorrow' },
];

function computeRevertAt(duration: DurationOption): number | null {
  const now = Date.now();
  switch (duration) {
    case '15m': return now + 15 * 60_000;
    case '30m': return now + 30 * 60_000;
    case '1h': return now + 60 * 60_000;
    case '4h': return now + 4 * 60 * 60_000;
    case 'tomorrow': {
      const next = new Date();
      next.setHours(24, 0, 0, 0);
      return next.getTime();
    }
    default: return null;
  }
}

interface StatusPickerPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  user: User;
  /** 'above' anchors above the trigger (desktop sidebar); 'below' anchors below it (mobile You screen). */
  placement?: 'above' | 'below';
  /** Show the "View Profile" footer button (hidden when already on a profile screen). */
  showProfileButton?: boolean;
}

export function StatusPickerPopover({
  open,
  onClose,
  anchorRef,
  user,
  placement = 'above',
  showProfileButton = true,
}: StatusPickerPopoverProps) {
  const { t } = useTranslation(['common']);
  const { formatTime } = useFormatters();
  const portalContainer = usePortalContainer();
  const currentStatus: ChosenUserStatus = useAuthStore(selectMyChosenStatus) ?? 'online';
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const openUserProfile = useUIStore((s) => s.openUserProfile);

  const [duration, setDuration] = useState<DurationOption>('none');
  const [saving, setSaving] = useState(false);
  const [revertRecord, setRevertRecord] = useState<StatusRevertRecord | null>(() => readRevertRecord(user.id));
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Reset chosen duration and refresh active revert record only when opening
  // (or switching users), never when the parent re-renders with a new inline onClose.
  useEffect(() => {
    if (!open) return;
    setDuration('none');
    setRevertRecord(readRevertRecord(user.id));
  }, [open, user.id]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const updatePos = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = layoutRect(el.getBoundingClientRect());
      const vw = layoutPixels(window.innerWidth);
      const vh = layoutPixels(window.innerHeight);
      const width = Math.min(256, vw - 16);
      const left = Math.max(8, Math.min(rect.left, vw - width - 8));
      if (placement === 'below') {
        setPos({ left, top: rect.bottom + 8 });
      } else {
        setPos({ left, bottom: vh - rect.top + 8 });
      }
    };
    updatePos();

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('resize', updatePos);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchorRef, placement]);

  if (!open || !pos) return null;

  const handleSelectStatus = async (nextStatus: ChosenUserStatus) => {
    setSaving(true);
    try {
      const revertAt = computeRevertAt(duration);
      const existing = readRevertRecord(user.id);
      const previousStatus: ChosenUserStatus = nextStatus !== currentStatus
        ? (existing && existing.revertAt > Date.now() && existing.previousStatus !== nextStatus
          ? existing.previousStatus
          : currentStatus)
        : (existing && existing.revertAt > Date.now() && existing.previousStatus !== nextStatus
          ? existing.previousStatus
          : 'online');

      if (nextStatus !== currentStatus) {
        await updateProfile({ status: nextStatus });
      }
      if (revertAt && previousStatus !== nextStatus) {
        const record: StatusRevertRecord = { userId: user.id, previousStatus, revertAt };
        scheduleStatusRevert(record);
        setRevertRecord(record);
      } else {
        clearRevertTimer();
        setRevertRecord(null);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleCancelTimer = () => {
    clearRevertTimer();
    setRevertRecord(null);
  };

  const handleOpenProfile = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    onClose();
    if (rect) {
      openUserProfile(user, '', rect, 'right');
    }
  };

  const activeRevertTime = revertRecord && revertRecord.revertAt > Date.now()
    ? formatTime(revertRecord.revertAt)
    : null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[200] w-64 max-w-[calc(var(--vw)*100-1rem)] glass-bubble rounded-xl border border-border-soft shadow-2xl p-2.5 space-y-2.5 text-txt-primary"
      style={{
        left: pos.left,
        ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Status list */}
      <div className="space-y-0.5">
        {STATUS_OPTIONS.map((opt) => {
          const isCurrent = currentStatus === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              onClick={() => void handleSelectStatus(opt.value)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-interactive-selected text-txt-primary font-medium'
                  : 'text-txt-secondary hover:text-txt-primary hover:bg-interactive-hover'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${opt.dotClass}`} />
              <span className="flex-1 text-left">{t(opt.labelKey)}</span>
              {isCurrent && (
                <svg className="w-3.5 h-3.5 text-accent-primary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Auto-revert timer selector */}
      <div className="border-t border-white/[0.06] pt-2 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-txt-tertiary px-1">
          {t('statusPicker.revertLabel')}
        </div>
        <div className="flex flex-wrap gap-1 px-0.5">
          {DURATION_OPTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDuration(d.id)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                duration === d.id
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-elevated text-txt-secondary hover:bg-interactive-hover'
              }`}
            >
              {t(d.labelKey)}
            </button>
          ))}
        </div>
        {activeRevertTime && revertRecord && (
          <div className="flex items-center justify-between gap-2 px-1.5 py-1 rounded bg-white/[0.03] text-[11px] text-txt-tertiary">
            <span className="truncate">
              {t('statusPicker.revertsAt', {
                status: t(statusLabelKey(revertRecord.previousStatus)),
                time: activeRevertTime,
              })}
            </span>
            <button
              type="button"
              onClick={handleCancelTimer}
              className="text-accent-primary hover:underline shrink-0 cursor-pointer"
            >
              {t('actions.cancel')}
            </button>
          </div>
        )}
      </div>

      {/* View profile button */}
      {showProfileButton && (
        <div className="border-t border-white/[0.06] pt-2">
          <button
            type="button"
            onClick={handleOpenProfile}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-txt-secondary hover:text-txt-primary hover:bg-interactive-hover transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 text-txt-tertiary" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
            <span>{t('statusPicker.viewProfile')}</span>
          </button>
        </div>
      )}
    </div>,
    portalContainer,
  );
}
