import { useState, useEffect, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Toggle } from '../../ui/Toggle';
import { useUpdateStore } from '../../../stores/updateStore';
import { useFormatters, type Formatters } from '../../../i18n/formatters';
import {
  desktopBridge,
  isBalacopapoDesktop,
  type OverlayConfig,
  type OverlayCorner,
} from '../../../utils/desktopBridge';

function AutoLaunchSettings() {
  const { t } = useTranslation('settings');
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [startMinimized, setStartMinimized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.backspace?.getAutoLaunchSettings().then((settings) => {
      setOpenAtLogin(settings.openAtLogin);
      setStartMinimized(settings.startMinimized);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleOpenAtLoginChange = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.backspace!.setAutoLaunchSettings({ openAtLogin: enabled });
      setOpenAtLogin(result.openAtLogin);
      setStartMinimized(result.startMinimized);
    } catch (err) {
      console.error('[autoLaunch] setAutoLaunchSettings(openAtLogin) failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleStartMinimizedChange = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.backspace!.setAutoLaunchSettings({ startMinimized: enabled });
      setOpenAtLogin(result.openAtLogin);
      setStartMinimized(result.startMinimized);
    } catch (err) {
      console.error('[autoLaunch] setAutoLaunchSettings(startMinimized) failed:', err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <>
      <div className="flex items-center justify-between py-1">
        <div className="flex-1 mr-4">
          <div className="text-sm text-txt-primary">{t('desktop.autoLaunch.openAtLogin.label')}</div>
          <div className="text-xs text-txt-tertiary mt-0.5">
            {t('desktop.autoLaunch.openAtLogin.description')}
          </div>
        </div>
        <Toggle enabled={openAtLogin} onChange={handleOpenAtLoginChange} disabled={busy} />
      </div>
      <div className="flex items-center justify-between py-1">
        <div className="flex-1 mr-4">
          <div className={`text-sm ${openAtLogin ? 'text-txt-primary' : 'text-txt-tertiary'}`}>{t('desktop.autoLaunch.startMinimized.label')}</div>
          <div className="text-xs text-txt-tertiary mt-0.5">
            {t('desktop.autoLaunch.startMinimized.description')}
          </div>
        </div>
        <Toggle enabled={startMinimized} onChange={handleStartMinimizedChange} disabled={busy || !openAtLogin} />
      </div>
    </>
  );
}

/**
 * Formats a byte-per-second rate for the download line. Deliberately coarse:
 * this is reassurance that something is happening, not a benchmark.
 */
function formatRate(t: TFunction<'settings'>, formatters: Formatters, bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '';
  const mb = bytesPerSecond / 1_048_576;
  if (mb >= 1) return t('desktop.updates.rateMegabytes', { value: formatters.formatNumber(Math.round(mb * 10) / 10) });
  return t('desktop.updates.rateKilobytes', { value: formatters.formatNumber(Math.round(bytesPerSecond / 1024)) });
}

/**
 * Desktop version and update state.
 *
 * This panel deliberately ignores whether the user dismissed the update. It is
 * the place a dismissed update stays reachable, which is the thing that makes
 * "Later" safe to offer in the toast at all.
 *
 * Every state here comes from a real updater event. The previous version faked
 * a "Checking..." state with a five second timer and a comment claiming
 * electron-updater has no no-update callback. It emits `update-not-available`
 * and `download-progress`; both are now wired.
 */
function UpdateSettings() {
  const { t } = useTranslation('settings');
  const formatters = useFormatters();
  const initialize = useUpdateStore((s) => s.initialize);
  const snapshot = useUpdateStore((s) => s.snapshot);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const install = useUpdateStore((s) => s.install);
  const openDownloadPage = useUpdateStore((s) => s.openDownloadPage);

  useEffect(() => initialize(), [initialize]);

  const status = snapshot?.status ?? { phase: 'idle' as const };
  const capability = snapshot?.capability ?? 'auto';
  const busy = status.phase === 'checking' || status.phase === 'downloading';

  let detail: string;
  let tone = 'text-txt-tertiary';
  let action: { label: string; onClick: () => void } | null = null;

  switch (status.phase) {
    case 'checking':
      detail = t('desktop.updates.checking');
      break;
    case 'downloading': {
      const percent = formatters.formatNumber(status.percent);
      detail = status.bytesPerSecond > 0
        ? t('desktop.updates.downloadingWithRate', {
            version: status.version,
            percent,
            rate: formatRate(t, formatters, status.bytesPerSecond),
          })
        : t('desktop.updates.downloading', { version: status.version, percent });
      break;
    }
    case 'up-to-date':
      detail = t('desktop.updates.upToDate');
      tone = 'text-accent-mint';
      break;
    case 'available':
      detail = t('desktop.updates.available', { version: status.version });
      action = { label: t('desktop.updates.download'), onClick: openDownloadPage };
      break;
    case 'ready':
      if (capability === 'auto') {
        detail = t('desktop.updates.readyToInstall', { version: status.version });
        action = { label: t('desktop.updates.restart'), onClick: install };
      } else {
        detail = t('desktop.updates.available', { version: status.version });
        action = { label: t('desktop.updates.download'), onClick: openDownloadPage };
      }
      break;
    case 'failed':
      if (status.version) {
        detail = t('desktop.updates.installFailed', { version: status.version });
        tone = 'text-accent-rose';
        action = { label: t('desktop.updates.download'), onClick: openDownloadPage };
      } else {
        detail = t('desktop.updates.checkFailed');
        tone = 'text-accent-rose';
      }
      break;
    default:
      detail = t('desktop.updates.idle');
  }

  if (capability === 'external') {
    detail = t('desktop.updates.external');
    tone = 'text-txt-tertiary';
    action = null;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between py-1">
        <div className="flex-1 mr-4 min-w-0">
          <div className="text-sm text-txt-primary">
            {currentVersion ? t('desktop.updates.versionLabel', { version: currentVersion }) : t('desktop.updates.appName')}
          </div>
          <div className={`text-xs mt-0.5 ${tone}`}>{detail}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {action && (
            <button
              onClick={action.onClick}
              className="px-3 py-1.5 text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/80 rounded-lg transition-colors"
            >
              {action.label}
            </button>
          )}
          {capability !== 'external' && (
            <button
              onClick={checkNow}
              disabled={busy}
              className="px-3 py-1.5 text-sm text-txt-secondary hover:text-txt-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
            >
              {status.phase === 'checking' ? t('desktop.updates.checkingShort') : t('desktop.updates.checkNow')}
            </button>
          )}
        </div>
      </div>

      {status.phase === 'downloading' && (
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="h-full bg-accent-primary transition-[width] duration-300"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      )}

      {capability === 'manual' && (
        <p className="text-xs text-txt-tertiary leading-relaxed">
          {t('desktop.updates.manualNote')}
        </p>
      )}
      {capability === 'external' && (
        <p className="text-xs text-txt-tertiary leading-relaxed">
          <Trans t={t} i18nKey="desktop.updates.externalNote" components={{ code: <code /> }} />
        </p>
      )}
    </div>
  );
}

export function DesktopPanel() {
  const { t } = useTranslation('settings');
  const nativeDesktop = isBalacopapoDesktop();
  const initialize = useUpdateStore((s) => s.initialize);
  const [sandboxed, setSandboxed] = useState<boolean | null>(null);
  const [nativeAutostart, setNativeAutostart] = useState(false);
  const [nativeVersion, setNativeVersion] = useState<string | null>(null);
  const [nativeUpdateState, setNativeUpdateState] = useState<'idle' | 'checking' | 'ready' | 'upToDate'>('idle');
  const [overlayCfg, setOverlayCfg] = useState<OverlayConfig>({
    enabled: false,
    showPointers: true,
    showSpeakers: true,
    showToasts: true,
    corner: 'top-left',
    opacity: 0.92,
    monitorIndex: null,
  });
  const [gamePresenceEnabled, setGamePresenceEnabled] = useState(true);
  const [ignoredGamesText, setIgnoredGamesText] = useState('');
  const [detectedGameName, setDetectedGameName] = useState<string | null>(null);
  const speakersTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (nativeDesktop) {
      desktopBridge.getDesktopInfo().then((info) => {
        if (!info) return;
        setNativeAutostart(Boolean(info.autostartEnabled));
        setNativeVersion(info.buildSha ? `${info.version} (${info.buildSha})` : info.version);
      }).catch(() => {});
      desktopBridge.getOverlayConfig().then((cfg) => {
        if (cfg) setOverlayCfg(cfg);
      }).catch(() => {});
      desktopBridge.getGamePresenceConfig().then((gp) => {
        if (!gp) return;
        setGamePresenceEnabled(Boolean(gp.enabled));
        setIgnoredGamesText((gp.ignoredGames ?? []).join(', '));
      }).catch(() => {});
      desktopBridge.getCurrentGamePresence().then((g) => {
        setDetectedGameName(g?.displayName ?? null);
      }).catch(() => {});
      return () => {
        if (speakersTimerRef.current !== null) window.clearTimeout(speakersTimerRef.current);
      };
    }
    return initialize();
  }, [initialize, nativeDesktop]);

  useEffect(() => {
    if (nativeDesktop) {
      setSandboxed(false);
      return;
    }
    const probe = window.backspace?.isSandboxed;
    if (!probe) {
      // Older desktop builds predate sandbox support and are ordinary native
      // packages, so preserving the existing controls is the compatible path.
      setSandboxed(false);
      return;
    }
    probe().then(setSandboxed).catch(() => setSandboxed(false));
  }, [nativeDesktop]);

  if (nativeDesktop) {
    const handleNativeAutostart = async (enabled: boolean) => {
      const next = await desktopBridge.setAutostart(enabled);
      if (typeof next === 'boolean') setNativeAutostart(next);
    };

    const handleNativeCheckUpdates = async () => {
      setNativeUpdateState('checking');
      const res = await desktopBridge.checkUpdatesNow();
      if (res?.kind === 'readyToRestart') setNativeUpdateState('ready');
      else setNativeUpdateState('upToDate');
    };

    const handleChangeInstance = async () => {
      await desktopBridge.clearInstanceUrl();
      window.location.replace(
        navigator.userAgent.includes('Windows') ? 'http://tauri.localhost/?switch=1' : 'tauri://localhost/?switch=1',
      );
    };

    const patchOverlay = async (patch: Partial<OverlayConfig>) => {
      const next: OverlayConfig = { ...overlayCfg, ...patch };
      setOverlayCfg(next);
      const saved = await desktopBridge.updateOverlayConfig(next);
      if (saved) setOverlayCfg(saved);
    };

    const handleTestPointer = async () => {
      const wasEnabled = overlayCfg.enabled;
      if (!wasEnabled) {
        await patchOverlay({ enabled: true });
        await new Promise((r) => window.setTimeout(r, 400));
      }
      await desktopBridge.pushOverlayPointer({
        senderName: t('desktop.overlay.pointers'),
        x: 0.35 + Math.random() * 0.3,
        y: 0.35 + Math.random() * 0.3,
        color: '#5865f2',
        mode: 'ping',
      });
    };

    const handleTestSpeakers = async () => {
      const wasEnabled = overlayCfg.enabled;
      if (!wasEnabled) {
        await patchOverlay({ enabled: true });
        await new Promise((r) => window.setTimeout(r, 400));
      }
      await desktopBridge.setOverlaySpeakers([
        { identity: 'preview-1', name: t('desktop.updates.appName'), speaking: true, muted: false, avatarColor: '#3ba55d' },
      ]);
      if (speakersTimerRef.current !== null) window.clearTimeout(speakersTimerRef.current);
      speakersTimerRef.current = window.setTimeout(() => {
        void desktopBridge.setOverlaySpeakers([]);
      }, 4000);
    };

    const saveGamePresence = async (nextEnabled: boolean, nextIgnoredText: string) => {
      setGamePresenceEnabled(nextEnabled);
      setIgnoredGamesText(nextIgnoredText);
      const ignoredGames = nextIgnoredText.split(',').map((s) => s.trim()).filter(Boolean);
      await desktopBridge.setGamePresenceConfig({
        enabled: nextEnabled,
        ignoredGames,
        manualOverride: null,
      });
    };

    const opacityPercent = Math.round((overlayCfg.opacity ?? 0.92) * 100);

    return (
      <div className="space-y-5">
        <h2 className="text-lg font-semibold text-txt-primary mb-6">{t('desktop.title')}</h2>

        {/* Sistema, atualizações e instância */}
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-3">
          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('desktop.autoLaunch.openAtLogin.label')}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">
                {t('desktop.autoLaunch.openAtLogin.description')}
              </div>
            </div>
            <Toggle enabled={nativeAutostart} onChange={(v) => void handleNativeAutostart(v)} />
          </div>

          <div className="border-t border-white/[0.04]" />

          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4 min-w-0">
              <div className="text-sm text-txt-primary">
                {nativeVersion ? t('desktop.updates.versionLabel', { version: nativeVersion }) : t('desktop.updates.appName')}
              </div>
              <div className="text-xs text-txt-tertiary mt-0.5">
                {nativeUpdateState === 'checking'
                  ? t('desktop.updates.checking')
                  : nativeUpdateState === 'ready'
                    ? t('desktop.updates.restart')
                    : nativeUpdateState === 'upToDate'
                      ? t('desktop.updates.upToDate')
                      : t('desktop.updates.idle')}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {nativeUpdateState === 'ready' && (
                <button
                  onClick={() => void desktopBridge.applyUpdateAndRestart()}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/80 rounded-lg transition-colors"
                >
                  {t('desktop.updates.restart')}
                </button>
              )}
              <button
                onClick={() => void handleNativeCheckUpdates()}
                disabled={nativeUpdateState === 'checking'}
                className="px-3 py-1.5 text-sm text-txt-secondary hover:text-txt-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
              >
                {nativeUpdateState === 'checking' ? t('desktop.updates.checkingShort') : t('desktop.updates.checkNow')}
              </button>
            </div>
          </div>

          <div className="border-t border-white/[0.04]" />

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-txt-primary font-medium">{window.location.origin}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.instance.current')}</div>
            </div>
            <button
              onClick={() => void handleChangeInstance()}
              className="px-3 py-1.5 text-sm text-txt-secondary hover:text-txt-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors"
            >
              {t('desktop.instance.change')}
            </button>
          </div>
        </div>

        {/* Sobreposição em Jogo (Overlay) — embutida direto nas configurações do app */}
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-3">
          <div>
            <div className="text-sm font-semibold text-txt-primary">{t('desktop.overlay.title')}</div>
            <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.overlay.description')}</div>
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('desktop.overlay.enabled')}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.overlay.enabledDesc')}</div>
            </div>
            <Toggle enabled={overlayCfg.enabled} onChange={(v) => void patchOverlay({ enabled: v })} />
          </div>

          <div className="border-t border-white/[0.04]" />

          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('desktop.overlay.pointers')}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.overlay.pointersDesc')}</div>
            </div>
            <Toggle enabled={overlayCfg.showPointers} onChange={(v) => void patchOverlay({ showPointers: v })} />
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('desktop.overlay.speakers')}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.overlay.speakersDesc')}</div>
            </div>
            <Toggle enabled={overlayCfg.showSpeakers} onChange={(v) => void patchOverlay({ showSpeakers: v })} />
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('desktop.overlay.toasts')}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.overlay.toastsDesc')}</div>
            </div>
            <Toggle enabled={overlayCfg.showToasts} onChange={(v) => void patchOverlay({ showToasts: v })} />
          </div>

          <div className="border-t border-white/[0.04]" />

          <div className="flex items-center justify-between py-1 gap-4">
            <div className="text-sm text-txt-primary">{t('desktop.overlay.corner')}</div>
            <select
              value={overlayCfg.corner}
              onChange={(e) => void patchOverlay({ corner: e.target.value as OverlayCorner })}
              className="rounded-lg bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-txt-primary outline-none"
            >
              <option value="top-left">{t('desktop.overlay.corners.top-left')}</option>
              <option value="top-right">{t('desktop.overlay.corners.top-right')}</option>
              <option value="bottom-left">{t('desktop.overlay.corners.bottom-left')}</option>
              <option value="bottom-right">{t('desktop.overlay.corners.bottom-right')}</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-1 gap-4">
            <div className="text-sm text-txt-primary">{t('desktop.overlay.opacity', { value: opacityPercent })}</div>
            <input
              type="range"
              min={30}
              max={100}
              value={opacityPercent}
              onChange={(e) => void patchOverlay({ opacity: Number(e.target.value) / 100 })}
              className="w-40 accent-accent-primary"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => void handleTestPointer()}
              className="px-3 py-1.5 text-xs font-medium text-txt-secondary hover:text-txt-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors"
            >
              {t('desktop.overlay.testPointer')}
            </button>
            <button
              onClick={() => void handleTestSpeakers()}
              className="px-3 py-1.5 text-xs font-medium text-txt-secondary hover:text-txt-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors"
            >
              {t('desktop.overlay.testSpeakers')}
            </button>
          </div>
        </div>

        {/* Presença de Jogos & Controle Remoto Seguro */}
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-3">
          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm font-semibold text-txt-primary">{t('desktop.gamePresence.title')}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">
                {detectedGameName
                  ? t('desktop.gamePresence.detected', { name: detectedGameName })
                  : t('desktop.gamePresence.none')}
              </div>
            </div>
            <Toggle
              enabled={gamePresenceEnabled}
              onChange={(v) => void saveGamePresence(v, ignoredGamesText)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <div className="text-xs text-txt-secondary">{t('desktop.gamePresence.ignoredLabel')}</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ignoredGamesText}
                onChange={(e) => setIgnoredGamesText(e.target.value)}
                placeholder={t('desktop.gamePresence.ignoredPlaceholder')}
                className="w-44 rounded-lg bg-black/40 border border-white/10 px-2.5 py-1 text-xs text-txt-primary outline-none"
              />
              <button
                onClick={() => void saveGamePresence(gamePresenceEnabled, ignoredGamesText)}
                className="px-2.5 py-1 text-xs font-medium text-txt-secondary hover:text-txt-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors"
              >
                {t('desktop.gamePresence.save')}
              </button>
            </div>
          </div>

          <div className="border-t border-white/[0.04]" />

          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm font-semibold text-txt-primary">{t('desktop.remoteControl.title')}</div>
              <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.remoteControl.description')}</div>
            </div>
            <button
              onClick={() => void desktopBridge.revokeRemoteControl()}
              className="px-3 py-1.5 text-xs font-medium text-white bg-accent-rose/80 hover:bg-accent-rose rounded-lg transition-colors"
            >
              {t('desktop.remoteControl.revoke')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-txt-primary mb-6">{t('desktop.title')}</h2>

      <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-3">
        {sandboxed === false && <AutoLaunchSettings />}
        <UpdateSettings />

        <div className="border-t border-white/[0.04]" />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-txt-primary font-medium">{window.location.origin}</div>
            <div className="text-xs text-txt-tertiary mt-0.5">{t('desktop.instance.current')}</div>
          </div>
          <button
            onClick={() => window.backspace?.clearInstanceUrl()}
            className="px-3 py-1.5 text-sm text-txt-secondary hover:text-txt-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors"
          >
            {t('desktop.instance.change')}
          </button>
        </div>
      </div>
    </div>
  );
}
