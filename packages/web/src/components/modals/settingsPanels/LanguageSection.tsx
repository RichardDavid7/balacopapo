import { useTranslation } from 'react-i18next';
import { availableLanguages, getLanguage, setLanguage, supportedLanguages, type SupportedLanguage } from '../../../i18n';
import { useFormatters } from '../../../i18n/formatters';
import {
  useRegionalStore,
  type DateFormatPreference,
  type NumberFormatPreference,
  type TimeFormatPreference,
} from '../../../stores/regionalStore';

const PREVIEW_TIMESTAMP = new Date(2026, 2, 15, 14, 5).getTime();

const TIME_OPTIONS: readonly TimeFormatPreference[] = ['auto', '24h', '12h'];
const DATE_OPTIONS: readonly DateFormatPreference[] = ['auto', 'dmy', 'mdy', 'ymd'];
const NUMBER_OPTIONS: readonly NumberFormatPreference[] = ['auto', 'comma-decimal', 'dot-decimal'];

/**
 * The language picker + independent regional format preferences
 * (12h/24h clock, date order, and number separators decoupled from UI language).
 */
export function LanguageSection() {
  const { t } = useTranslation(['common']);
  const current = getLanguage();
  const formatters = useFormatters();

  const timeFormat = useRegionalStore((s) => s.timeFormat);
  const dateFormat = useRegionalStore((s) => s.dateFormat);
  const numberFormat = useRegionalStore((s) => s.numberFormat);
  const setTimeFormat = useRegionalStore((s) => s.setTimeFormat);
  const setDateFormat = useRegionalStore((s) => s.setDateFormat);
  const setNumberFormat = useRegionalStore((s) => s.setNumberFormat);

  // A previewed unreleased language (dev `?lang=`) is shown as the current
  // option so the select does not silently display the wrong value.
  const options = availableLanguages.some((l) => l.code === current)
    ? availableLanguages
    : [...availableLanguages, ...supportedLanguages.filter((l) => l.code === current)];

  const pillClass = (active: boolean) =>
    `px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
      active
        ? 'bg-accent-primary text-white border-accent-primary'
        : 'bg-surface-base text-txt-secondary border-border-soft hover:text-txt-primary hover:bg-interactive-hover'
    }`;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('common:language.label')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
          <label htmlFor="language-select" className="block text-xs text-txt-tertiary mb-2">
            {t('common:language.description')}
          </label>
          <select
            id="language-select"
            value={current}
            onChange={(e) => { void setLanguage(e.target.value as SupportedLanguage); }}
            className="input-standard w-full appearance-none"
          >
            {options.map((language) => (
              <option key={language.code} value={language.code} lang={language.code}>
                {language.nativeName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Independent regional formatting preferences */}
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('common:regional.label')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-4">
          <p className="text-xs text-txt-tertiary">
            {t('common:regional.description')}
          </p>

          {/* Time format (Auto / 24h / 12h) */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-txt-secondary">
              {t('common:regional.timeFormat.label')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TIME_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTimeFormat(opt)}
                  className={pillClass(timeFormat === opt)}
                >
                  {t(`common:regional.timeFormat.${opt}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Date format (Auto / DD/MM/YYYY / MM/DD/YYYY / YYYY-MM-DD) */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-txt-secondary">
              {t('common:regional.dateFormat.label')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DATE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setDateFormat(opt)}
                  className={pillClass(dateFormat === opt)}
                >
                  {t(`common:regional.dateFormat.${opt}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Number separators (Auto / 1.234,56 / 1,234.56) */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-txt-secondary">
              {t('common:regional.numberFormat.label')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {NUMBER_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setNumberFormat(opt)}
                  className={pillClass(numberFormat === opt)}
                >
                  {t(`common:regional.numberFormat.${opt}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-md bg-surface-base border border-border-soft px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-txt-tertiary">{t('common:regional.preview')}</span>
            <span className="font-mono text-txt-primary tabular-nums">
              {formatters.formatDateTime(PREVIEW_TIMESTAMP)} · {formatters.formatNumber(1234567)} · {formatters.formatBytes(1536)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
