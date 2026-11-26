import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SoundboardSound } from '@backspace/shared';
import {
  useKeybindStore,
  BINDABLE_ACTIONS,
  Keybind,
  soundboardActionId,
  parseSoundboardActionId,
} from '../../../stores/keybindStore';
import { isElectron, isElectronMac } from '../../../platform/platform';
import { useKeybindPortalStatus } from '../../../hooks/useKeybindPortalStatus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const MOUSE_BUTTON_MAP: Record<number, number> = { 1: 3, 3: 4, 4: 5 };

type SettingsT = TFunction<['settings', 'common']>;

/**
 * The name a mouse button is shown under. The label is composed while the
 * user records the combo and stored with the keybind, so it is in the
 * language that was active at recording time.
 */
function mouseButtonName(t: SettingsT, button: number): string {
  switch (button) {
    case 3: return t('keybinds.key.middleClick');
    case 4: return t('keybinds.key.mouse4');
    case 5: return t('keybinds.key.mouse5');
    default: return t('keybinds.key.mouseGeneric', { button });
  }
}

function keyDisplayName(t: SettingsT, code: string, key: string): string {
  if (code.startsWith('Shift')) return t('keybinds.key.shift');
  if (code.startsWith('Control')) return t('keybinds.key.ctrl');
  if (code.startsWith('Alt')) return isElectronMac() ? t('keybinds.key.option') : t('keybinds.key.alt');
  if (code.startsWith('Meta')) return isElectronMac() ? t('keybinds.key.cmd') : t('keybinds.key.win');
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (key === ' ') return t('keybinds.key.space');
  return key.length === 1 ? key.toUpperCase() : key;
}

function codeToNumeric(code: string): number {
  // djb2 hash — produces unique numeric IDs for all KeyboardEvent.code values
  let hash = 5381;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) + hash + code.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // ensure unsigned
}

// ---------------------------------------------------------------------------
// Keybind Row
// ---------------------------------------------------------------------------

interface KeybindRowProps {
  actionId: string;
  label: string;
  keybind: Keybind | undefined;
  isRecording: boolean;
  recordingDisplay: string;
  onStartRecording: () => void;
  onDelete: () => void;
  rowRef: React.RefObject<HTMLDivElement>;
}

function KeybindRow({ actionId, label, keybind, isRecording, recordingDisplay, onStartRecording, onDelete, rowRef }: KeybindRowProps) {
  const { t } = useTranslation(['settings', 'common']);
  return (
    <div
      ref={rowRef}
      className={`flex items-center justify-between px-4 py-3 rounded-lg transition-all ${
        isRecording
          ? 'ring-2 ring-accent-mint bg-surface-elevated'
          : 'bg-white/[0.03] hover:bg-surface-elevated'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm text-txt-primary">{label}</div>
        <div className="text-xs text-txt-tertiary mt-0.5">
          {isRecording ? (
            <span className="text-accent-mint animate-pulse">
              {recordingDisplay || t('keybinds.row.recordingPrompt')}
            </span>
          ) : keybind ? (
            keybind.displayLabel
          ) : (
            t('keybinds.row.notBound')
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 ml-3">
        {!isRecording && (
          <>
            <button
              onClick={onStartRecording}
              className="text-xs px-2.5 py-1 rounded text-txt-tertiary hover:text-txt-primary hover:bg-white/[0.06] transition-colors"
            >
              {keybind ? t('common:actions.edit') : t('keybinds.row.record')}
            </button>
            {keybind && (
              <button
                onClick={onDelete}
                className="text-xs px-2.5 py-1 rounded text-txt-tertiary hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
              >
                {t('common:actions.delete')}
              </button>
            )}
          </>
        )}
        {isRecording && (
          <span className="text-[10px] text-txt-tertiary">{t('keybinds.row.escToCancel')}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict Dialog (inline)
// ---------------------------------------------------------------------------

interface ConflictInfo {
  newActionId: string;
  existingKeybind: Keybind;
  pendingKeybind: Keybind;
}

// ---------------------------------------------------------------------------
// KeybindsPanel
// ---------------------------------------------------------------------------

export function KeybindsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const { keybinds, setKeybind, removeKeybind, findConflict } = useKeybindStore();
  const portal = useKeybindPortalStatus();
  useEffect(() => {
    // Only opening this panel initiates first-time registration. A cancelled
    // request becomes unavailable and requires an explicit retry, not a loop.
    if (portal?.state === 'idle') window.backspace?.retryKeybindPortal?.();
  }, [portal?.state]);

  const [recordingActionId, setRecordingActionId] = useState<string | null>(null);
  const [recordingDisplay, setRecordingDisplay] = useState('');
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [hookError, setHookError] = useState<string | null>(null);
  const [soundboardSounds, setSoundboardSounds] = useState<SoundboardSound[]>([]);
  const [loadingSounds, setLoadingSounds] = useState(false);
  const [stagedSoundActionIds, setStagedSoundActionIds] = useState<string[]>([]);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [soundSearch, setSoundSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingSounds(true);
    void import('../../../stores/spaceStore')
      .then(({ useSpaceStore, getApiForOrigin }) => {
        const { currentSpaceId, spaces } = useSpaceStore.getState();
        const origin = currentSpaceId ? (spaces.find((x) => x.id === currentSpaceId)?._instanceOrigin ?? '') : '';
        return getApiForOrigin(origin).soundboard.list({ spaceId: currentSpaceId ?? undefined });
      })
      .then((data) => {
        if (cancelled) return;
        const combined = [...data.instanceSounds, ...data.scopedSounds];
        const deduped = Array.from(new Map(combined.map((s) => [s.id, s])).values());
        setSoundboardSounds(deduped);
      })
      .catch(() => {
        if (!cancelled) setSoundboardSounds([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSounds(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Discord-style: only show Soundboard shortcuts the user explicitly added or bound
  const soundboardRows = useMemo(() => {
    const byId = new Map(soundboardSounds.map((s) => [s.id, s]));
    const visibleActionIds = new Set<string>(stagedSoundActionIds);
    for (const kb of keybinds) {
      if (parseSoundboardActionId(kb.actionId)) {
        visibleActionIds.add(kb.actionId);
      }
    }
    const rows: Array<{ actionId: string; label: string }> = [];
    for (const actionId of visibleActionIds) {
      const soundId = parseSoundboardActionId(actionId);
      if (!soundId) continue;
      const sound = byId.get(soundId);
      rows.push({
        actionId,
        label: sound
          ? (sound.emoji ? `${sound.emoji} ${sound.name}` : sound.name)
          : t('keybinds.soundboard.unknownSound', { id: soundId.slice(0, 8) }),
      });
    }
    return rows;
  }, [soundboardSounds, keybinds, stagedSoundActionIds, t]);

  const availableSoundsToAdd = useMemo(() => {
    const visibleSet = new Set(soundboardRows.map((r) => r.actionId));
    const q = soundSearch.trim().toLowerCase();
    return soundboardSounds.filter((s) => {
      if (visibleSet.has(soundboardActionId(s.id))) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.folder?.toLowerCase().includes(q) ?? false);
    });
  }, [soundboardSounds, soundboardRows, soundSearch]);

  const pressedCodesRef = useRef(new Map<string, { numeric: number; display: string }>());
  const mouseButtonRef = useRef<number | null>(null);
  const mouseDisplayRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefs = useRef<Record<string, React.RefObject<HTMLDivElement>>>({});

  for (const action of BINDABLE_ACTIONS) {
    if (!rowRefs.current[action.id]) {
      rowRefs.current[action.id] = React.createRef();
    }
  }
  for (const row of soundboardRows) {
    if (!rowRefs.current[row.actionId]) {
      rowRefs.current[row.actionId] = React.createRef();
    }
  }

  // --- Platform checks on mount ---
  useEffect(() => {
    if (isElectronMac() && window.backspace?.checkAccessibility) {
      window.backspace.checkAccessibility().then(setAccessibilityTrusted);
    }
    if (isElectron() && window.backspace?.onAccessibilityStatus) {
      const cleanup = window.backspace.onAccessibilityStatus((status) => {
        setAccessibilityTrusted(status.trusted);
      });
      return cleanup;
    }
  }, []);

  useEffect(() => {
    if (isElectron() && window.backspace?.onKeybindHookError) {
      const cleanup = window.backspace.onKeybindHookError((error) => {
        setHookError(error.message);
      });
      return cleanup;
    }
  }, []);

  // --- Recording logic ---
  const cancelRecording = useCallback(() => {
    setRecordingActionId(null);
    setRecordingDisplay('');
    pressedCodesRef.current.clear();
    mouseButtonRef.current = null;
    mouseDisplayRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const finalizeRecording = useCallback((actionId: string) => {
    const codes = pressedCodesRef.current;
    const mouseBtn = mouseButtonRef.current;

    const keys = Array.from(codes.values()).map((c) => c.numeric).sort((a, b) => a - b);
    const displayParts = Array.from(codes.values()).map((c) => c.display);
    if (mouseBtn) {
      displayParts.push(mouseButtonName(t, mouseBtn));
    }
    const displayLabel = displayParts.join(' + ');

    const hasNonModifier = Array.from(codes.keys()).some((code) => !MODIFIER_CODES.has(code));
    if (!hasNonModifier && !mouseBtn) {
      return;
    }

    const newKeybind: Keybind = { actionId, keys, mouseButton: mouseBtn ?? undefined, displayLabel };

    const existing = findConflict(keys, mouseBtn ?? undefined, actionId);
    if (existing) {
      setConflict({ newActionId: actionId, existingKeybind: existing, pendingKeybind: newKeybind });
      cancelRecording();
      return;
    }

    setKeybind(newKeybind);
    cancelRecording();
  }, [findConflict, setKeybind, cancelRecording, t]);

  // --- Recording event listeners ---
  useEffect(() => {
    if (portal || !recordingActionId) return;

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        cancelRecording();
        return;
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      const display = keyDisplayName(t, e.code, e.key);
      const numeric = codeToNumeric(e.code);
      pressedCodesRef.current.set(e.code, { numeric, display });

      const parts = Array.from(pressedCodesRef.current.values()).map((c) => c.display);
      if (mouseDisplayRef.current) parts.push(mouseDisplayRef.current);
      setRecordingDisplay(parts.join(' + '));
    }

    function onKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (recordingActionId) finalizeRecording(recordingActionId);
      }, 300);
    }

    function onMouseDown(e: MouseEvent) {
      const rowRef = rowRefs.current[recordingActionId!];
      if (rowRef?.current && !rowRef.current.contains(e.target as Node)) {
        cancelRecording();
        return;
      }

      const uiButton = MOUSE_BUTTON_MAP[e.button];
      if (!uiButton) return;

      e.preventDefault();
      e.stopPropagation();

      mouseButtonRef.current = uiButton;
      mouseDisplayRef.current = mouseButtonName(t, uiButton);

      const parts = Array.from(pressedCodesRef.current.values()).map((c) => c.display);
      parts.push(mouseDisplayRef.current);
      setRecordingDisplay(parts.join(' + '));

      finalizeRecording(recordingActionId!);
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mousedown', onMouseDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [recordingActionId, cancelRecording, finalizeRecording, t, portal]);

  // --- Conflict resolution ---
  const confirmConflict = () => {
    if (!conflict) return;
    removeKeybind(conflict.existingKeybind.actionId);
    setKeybind(conflict.pendingKeybind);
    setConflict(null);
  };

  const cancelConflict = () => setConflict(null);

  const getKeybind = (actionId: string) => keybinds.find((kb) => kb.actionId === actionId);

  const conflictAction = conflict
    ? BINDABLE_ACTIONS.find((a) => a.id === conflict.existingKeybind.actionId)
    : undefined;
  const conflictSoundRow = conflict
    ? soundboardRows.find((r) => r.actionId === conflict.existingKeybind.actionId)
    : undefined;
  const conflictActionLabel = conflictAction
    ? t(`keybinds.action.${conflictAction.id}`)
    : (conflictSoundRow?.label ?? '');

  if (portal) {
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-semibold text-txt-primary mb-6">{t('keybinds.title')}</h2>
        <div className="rounded-lg bg-surface-elevated p-3.5 text-sm text-txt-secondary" role="status">
          <p>{t('keybinds.portal.description')}</p>
          <p className="mt-2">{t(`keybinds.portal.${portal.state}`)}</p>
          {portal.state === 'unavailable' && (
            <button type="button" onClick={() => window.backspace?.retryKeybindPortal?.()}
              className="mt-3 rounded px-3 py-1.5 bg-white/[0.06] text-txt-primary hover:bg-white/[0.1]">
              {t('keybinds.portal.retry')}
            </button>
          )}
        </div>
        <dl className="space-y-1.5">
          {BINDABLE_ACTIONS.map((action) => (
            <div key={action.id} className="rounded-lg bg-white/[0.03] px-4 py-3">
              <dt className="text-sm text-txt-primary">{t(`keybinds.action.${action.id}`)}</dt>
              <dd className="text-xs text-txt-tertiary mt-1">
                {portal.shortcuts[action.id]
                  ? t('keybinds.portal.assigned', { shortcut: portal.shortcuts[action.id] })
                  : t('keybinds.portal.notAssigned')}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-txt-primary mb-6">{t('keybinds.title')}</h2>
      {/* macOS Accessibility Warning */}
      {isElectronMac() && accessibilityTrusted === false && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3.5">
          <div className="text-sm text-amber-200 font-medium">{t('keybinds.accessibility.title')}</div>
          <div className="text-xs text-amber-200/70 mt-1">
            {t('keybinds.accessibility.description')}
          </div>
          <button
            onClick={() => {
              window.backspace?.checkAccessibility().then(setAccessibilityTrusted);
            }}
            className="mt-2 text-xs px-3 py-1.5 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-colors"
          >
            {t('keybinds.accessibility.grant')}
          </button>
        </div>
      )}

      {/* Linux hook error warning */}
      {isElectron() && hookError && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3.5">
          <div className="text-sm text-amber-200 font-medium">{t('keybinds.hookError.title')}</div>
          <div className="text-xs text-amber-200/70 mt-1">
            <Trans
              t={t}
              i18nKey="keybinds.hookError.description"
              components={{ code: <code className="bg-black/20 px-1 rounded" /> }}
            />
          </div>
        </div>
      )}

      {/* Web limitation note */}
      {!isElectron() && (
        <div className="text-xs text-txt-tertiary px-1">
          {t('keybinds.note.webOnly')}
        </div>
      )}

      {/* Keybind rows */}
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('keybinds.section.voice')}
        </div>
        <div className="space-y-1.5">
          {BINDABLE_ACTIONS.map((action) => (
            <KeybindRow
              key={action.id}
              actionId={action.id}
              label={t(`keybinds.action.${action.id}`)}
              keybind={getKeybind(action.id)}
              isRecording={recordingActionId === action.id}
              recordingDisplay={recordingDisplay}
              onStartRecording={() => {
                cancelRecording();
                setRecordingActionId(action.id);
              }}
              onDelete={() => removeKeybind(action.id)}
              rowRef={rowRefs.current[action.id]!}
            />
          ))}
        </div>
      </div>

      {/* Soundboard quick-trigger keybinds (Discord-style add-on-demand) */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
            {t('keybinds.section.soundboard')}
          </div>
          <button
            type="button"
            onClick={() => setSoundPickerOpen((open) => !open)}
            disabled={loadingSounds || soundboardSounds.length === 0}
            className="text-xs px-2.5 py-1 rounded-md bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 font-medium transition-colors disabled:opacity-40"
          >
            {soundPickerOpen ? t('common:actions.close') : t('keybinds.soundboard.addShortcut')}
          </button>
        </div>
        <p className="text-xs text-txt-tertiary mb-2.5">
          {t('keybinds.soundboard.description')}
        </p>

        {soundPickerOpen && (
          <div className="mb-3 rounded-lg bg-surface-elevated border border-border-soft p-2.5 space-y-2">
            <input
              type="text"
              value={soundSearch}
              onChange={(e) => setSoundSearch(e.target.value)}
              placeholder={t('keybinds.soundboard.searchPlaceholder')}
              className="w-full px-2.5 py-1.5 rounded bg-surface-base border border-border-soft text-xs text-txt-primary placeholder:text-txt-tertiary focus:outline-none focus:border-accent-primary"
              autoFocus
            />
            {availableSoundsToAdd.length === 0 ? (
              <div className="text-xs text-txt-tertiary px-1 py-1.5">
                {t('keybinds.soundboard.noMatches')}
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto scrollbar-thin divide-y divide-white/[0.04]">
                {availableSoundsToAdd.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    onClick={() => {
                      const actionId = soundboardActionId(sound.id);
                      setStagedSoundActionIds((prev) => (prev.includes(actionId) ? prev : [...prev, actionId]));
                      setSoundPickerOpen(false);
                      setSoundSearch('');
                      cancelRecording();
                      setRecordingActionId(actionId);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-txt-primary hover:bg-white/[0.05] rounded transition-colors"
                  >
                    <span className="truncate">
                      {sound.emoji ? `${sound.emoji} ` : ''}{sound.name}
                    </span>
                    {sound.folder && (
                      <span className="text-[10px] text-txt-tertiary shrink-0">{sound.folder}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {loadingSounds && soundboardRows.length === 0 ? (
          <div className="text-xs text-txt-tertiary px-1">{t('common:states.loading')}</div>
        ) : soundboardRows.length === 0 ? (
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] px-4 py-3 text-xs text-txt-tertiary">
            {soundboardSounds.length === 0
              ? t('keybinds.soundboard.empty')
              : t('keybinds.soundboard.emptyAdded')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {soundboardRows.map((row) => (
              <KeybindRow
                key={row.actionId}
                actionId={row.actionId}
                label={row.label}
                keybind={getKeybind(row.actionId)}
                isRecording={recordingActionId === row.actionId}
                recordingDisplay={recordingDisplay}
                onStartRecording={() => {
                  cancelRecording();
                  setRecordingActionId(row.actionId);
                }}
                onDelete={() => {
                  removeKeybind(row.actionId);
                  setStagedSoundActionIds((prev) => prev.filter((id) => id !== row.actionId));
                }}
                rowRef={rowRefs.current[row.actionId]!}
              />
            ))}
          </div>
        )}
      </div>

      {/* Conflict dialog */}
      {conflict && (
        <div className="rounded-lg bg-surface-elevated border border-white/[0.06] p-3.5">
          <div className="text-sm text-txt-primary">
            <Trans
              t={t}
              i18nKey="keybinds.conflict.message"
              values={{
                combo: conflict.pendingKeybind.displayLabel,
                action: conflictActionLabel,
              }}
              components={{ strong: <span className="font-medium" /> }}
            />
          </div>
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={confirmConflict}
              className="text-xs px-3 py-1.5 rounded bg-accent-mint/20 text-accent-mint hover:bg-accent-mint/30 transition-colors"
            >
              {t('keybinds.conflict.overwrite')}
            </button>
            <button
              onClick={cancelConflict}
              className="text-xs px-3 py-1.5 rounded bg-white/[0.06] text-txt-secondary hover:bg-white/[0.1] transition-colors"
            >
              {t('common:actions.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
