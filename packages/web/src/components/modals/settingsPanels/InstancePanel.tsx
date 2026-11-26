import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useSettingsSections } from '../../../hooks/useSettingsSections';
import { useInstanceUpdateBadge } from '../../../hooks/useInstanceUpdateBadge';
import type { SettingsSection } from '../SettingsSectionsContext';
import { HiButton } from '../../telemetry/answers/HiButton';
import { GeneralPanel } from '../instanceSettingsPanels/GeneralPanel';
import { RegistrationPanel } from '../instanceSettingsPanels/RegistrationPanel';
import { FederationPanel } from '../instanceSettingsPanels/FederationPanel';
import { StreamingPanel } from '../instanceSettingsPanels/StreamingPanel';
import { StoragePanel } from '../instanceSettingsPanels/StoragePanel';
import { UsersPanel } from '../instanceSettingsPanels/UsersPanel';
import { UpdatesPanel } from '../instanceSettingsPanels/UpdatesPanel';
import { TelemetryPanel } from '../instanceSettingsPanels/TelemetryPanel';
import { AudioPanel } from '../instanceSettingsPanels/AudioPanel';
import { OidcPanel } from '../instanceSettingsPanels/OidcPanel';
import { IpBansPanel } from '../instanceSettingsPanels/IpBansPanel';

type SubTab = 'general' | 'registration' | 'oidc' | 'ipBans' | 'federation' | 'streaming' | 'audio' | 'storage' | 'users' | 'updates' | 'telemetry';

export function InstancePanel() {
  const { t } = useTranslation(['settings']);
  const fetchInstanceSettings = useSettingsStore((s) => s.fetchInstanceSettings);
  const fetchTelemetry = useSettingsStore((s) => s.fetchTelemetry);
  // Read here rather than in the telemetry panel alone: the invitation has to
  // be decided before that tab is ever opened, because it is what invites the
  // admin to open it.
  const telemetry = useSettingsStore((s) => s.telemetry);

  const [subTab, setSubTab] = useState<SubTab>('general');
  const [approvalCount, setApprovalCount] = useState(0);
  const updateBadge = useInstanceUpdateBadge();

  const sections = useMemo<SettingsSection[]>(() => [
    { id: 'general', label: t('settings:instance.tabs.general') },
    { id: 'registration', label: t('settings:instance.tabs.registration') },
    { id: 'oidc', label: t('settings:instance.tabs.oidc') },
    { id: 'ipBans', label: t('settings:instance.tabs.ipBans') },
    { id: 'federation', label: t('settings:instance.tabs.federation'), badgeCount: approvalCount },
    { id: 'streaming', label: t('settings:instance.tabs.streaming') },
    { id: 'audio', label: t('settings:instance.tabs.audio') },
    { id: 'storage', label: t('settings:instance.tabs.storage') },
    { id: 'users', label: t('settings:instance.tabs.users') },
    { id: 'updates', label: t('settings:instance.tabs.updates'), badgeDot: updateBadge },
    {
      id: 'telemetry',
      label: t('settings:instance.tabs.telemetry'),
      // Whenever the hello is not being sent, whether that is because nobody
      // has answered yet or because someone said no. `telemetry` is null while
      // the status is still loading, and an unknown state invites nothing.
      invite: telemetry !== null && telemetry.enabled !== true,
    },
  ], [approvalCount, updateBadge, telemetry, t]);

  const handleNavigate = useCallback((id: string) => {
    setSubTab(id as SubTab);
  }, []);

  // Register sections for sidebar sub-links (tab mode — no scroll-spy)
  useSettingsSections(sections, { onNavigate: handleNavigate, activeTab: subTab });

  useEffect(() => {
    fetchInstanceSettings();
    // The streaming limits are not fetched here: `StreamingPanel` is the only
    // reader of that document in this tree and loads it itself, which is also
    // how it can say when the load failed.
    // Failure leaves `telemetry` null, which shows the plain entry.
    void fetchTelemetry().catch(() => undefined);
  }, [fetchInstanceSettings, fetchTelemetry]);

  return (
    <div className="flex flex-col desktop:flex-row gap-5 desktop:gap-8 items-start">
      {/* Mobile selector: single-tap jump across all 11 instance sections */}
      <div className="w-full desktop:hidden">
        <select
          value={subTab}
          onChange={(e) => setSubTab(e.target.value as SubTab)}
          aria-label={t('settings:instance.tabs.general')}
          className="w-full px-3.5 py-2.5 rounded-lg bg-surface-elevated border border-border-soft text-sm font-medium text-txt-primary focus:outline-none focus:border-accent-primary"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}{s.badgeCount && s.badgeCount > 0 ? ` (${s.badgeCount})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop vertical navigation column — replaces overcrowded top tabs */}
      <nav className="hidden desktop:flex flex-col gap-1 w-48 shrink-0 sticky top-0 pr-5 border-r border-white/[0.06]">
        {sections.map((s) =>
          s.invite === true ? (
            <div key={s.id} className="pt-2">
              <HiButton onClick={() => setSubTab(s.id as SubTab)}>{s.label}</HiButton>
            </div>
          ) : (
            <button
              key={s.id}
              type="button"
              onClick={() => setSubTab(s.id as SubTab)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[13px] text-left transition-colors ${
                subTab === s.id
                  ? 'bg-accent-primary/15 text-txt-primary font-semibold'
                  : 'text-txt-tertiary hover:text-txt-secondary hover:bg-white/[0.04]'
              }`}
            >
              <span className="truncate">{s.label}</span>
              {s.badgeCount !== undefined && s.badgeCount > 0 && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-amber/15 text-accent-amber shrink-0">
                  {s.badgeCount}
                </span>
              )}
              {s.badgeDot === true && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-amber shrink-0" />
              )}
            </button>
          ),
        )}
      </nav>

      {/* Active section content */}
      <div className="flex-1 min-w-0 w-full space-y-6 pb-4">
        {subTab === 'general' && <GeneralPanel />}
        {subTab === 'registration' && <RegistrationPanel />}
        {subTab === 'oidc' && <OidcPanel />}
        {subTab === 'ipBans' && <IpBansPanel />}
        {subTab === 'federation' && <FederationPanel onApprovalCountChange={setApprovalCount} />}
        {subTab === 'streaming' && <StreamingPanel />}
        {subTab === 'audio' && <AudioPanel />}
        {subTab === 'storage' && <StoragePanel />}
        {subTab === 'users' && <UsersPanel />}
        {subTab === 'updates' && <UpdatesPanel />}
        {subTab === 'telemetry' && <TelemetryPanel />}
      </div>
    </div>
  );
}
