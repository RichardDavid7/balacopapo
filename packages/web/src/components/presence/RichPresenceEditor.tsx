import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useManualPresenceStore, type ManualPresenceKind } from '../../stores/manualPresenceStore';

const KINDS: readonly ManualPresenceKind[] = ['playing', 'looking_to_play', 'watching', 'listening'];

export function RichPresenceEditor() {
  const { t } = useTranslation(['settings', 'social', 'common']);
  const manual = useManualPresenceStore((s) => s.manual);
  const setManual = useManualPresenceStore((s) => s.setManual);

  const [type, setType] = useState<ManualPresenceKind>(manual?.type ?? 'playing');
  const [name, setName] = useState(manual?.name ?? '');
  const [details, setDetails] = useState(manual?.details ?? '');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setManual(null);
      return;
    }
    setManual({
      type,
      name: trimmed,
      details: details.trim() || undefined,
    });
  };

  const handleClear = () => {
    setManual(null);
    setName('');
    setDetails('');
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
        {t('settings:connections.presence.heading')}
      </div>

      <form onSubmit={handleSave} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4 space-y-3">
        <p className="text-xs text-txt-tertiary">{t('settings:connections.presence.description')}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setType(k)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                type === k
                  ? 'bg-accent-primary text-white border-accent-primary'
                  : 'bg-surface-base text-txt-secondary border-border-soft hover:text-txt-primary'
              }`}
            >
              {t(`social:presence.activityTypes.${k}`)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            maxLength={128}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings:connections.presence.namePlaceholder')}
            className="input-standard"
          />
          <input
            type="text"
            maxLength={128}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={t('settings:connections.presence.detailsPlaceholder')}
            className="input-standard"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          {manual && (
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-1.5 rounded-md bg-accent-rose/15 hover:bg-accent-rose/25 text-accent-rose text-xs font-semibold transition-colors"
            >
              {t('settings:connections.presence.clear')}
            </button>
          )}
          <button
            type="submit"
            disabled={!name.trim()}
            className="px-4 py-1.5 rounded-md bg-accent-primary hover:bg-accent-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-40"
          >
            {t('settings:connections.presence.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
