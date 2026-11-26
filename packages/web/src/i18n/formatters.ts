import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './index';
import {
  DEFAULT_REGIONAL_PREFS,
  useRegionalStore,
  type RegionalPreferences,
} from '../stores/regionalStore';

/**
 * Every date, time, number and byte size the UI shows goes through here, so
 * that the locale is the language the user selected in settings rather than
 * whatever the browser happens to report. The consistency check fails any
 * direct `toLocale*` or `Intl.*` use elsewhere in the web package.
 *
 * Formatters are cached per locale and option set: constructing an `Intl`
 * formatter is expensive enough to matter in a message list.
 */
export interface Formatters {
  /** `2:05 PM` / `14:05` */
  formatTime: (timestamp: number) => string;
  /** `Mar 15` this year, `Dec 14, 2025` otherwise. */
  formatShortDate: (timestamp: number, now?: Date) => string;
  /** `March 15, 2026` */
  formatLongDate: (timestamp: number) => string;
  /** `Mar 15, 2026`: always carries the year, for "member since" and audit dates. */
  formatMediumDate: (timestamp: number) => string;
  /** `3/15/2026`: all numeric, for dense lists. */
  formatNumericDate: (timestamp: number) => string;
  /** `Sunday, March 15, 2026`: with the weekday, for day dividers. */
  formatFullDate: (timestamp: number) => string;
  /** `Mar 15, 2026, 2:05 PM` */
  formatDateTime: (timestamp: number) => string;
  /** `5 minutes ago`, `20 hours ago`, `in 3 days`: elapsed time in the largest whole unit that fits. */
  formatRelativeTime: (timestamp: number, now?: Date) => string;
  /** `today`, `yesterday`, `3 days ago`: the calendar day, so 11 pm and 1 am are a day apart. */
  formatRelativeDay: (timestamp: number, now?: Date) => string;
  formatNumber: (value: number) => string;
  /** `150%` / `150 %` from a whole-number percent such as a volume slider value. */
  formatPercent: (percent: number) => string;
  /** `1.5 kB`, `3 MB`; binary steps of 1024 with the conventional SI labels. */
  formatBytes: (bytes: number) => string;
  /** `05:08` / `2:05:08`: elapsed whole seconds with locale-native digits. */
  formatDuration: (elapsedSeconds: number) => string;
  /** `You, Mira, and 3 others` / `Du, Mira und 3 weitere`: an "and" list with the language's separators. */
  formatList: (items: readonly string[]) => string;
}

type DateTimeOptions = Intl.DateTimeFormatOptions;

const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatCustomNumericDate(timestamp: number, mode: 'dmy' | 'mdy' | 'ymd'): string {
  const d = new Date(timestamp);
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = String(d.getFullYear());
  if (mode === 'dmy') return `${dd}/${mm}/${yyyy}`;
  if (mode === 'mdy') return `${mm}/${dd}/${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}

export function createFormatters(
  getLocale: () => string,
  getPrefs: () => RegionalPreferences = () => DEFAULT_REGIONAL_PREFS,
): Formatters {
  const dateCache = new Map<string, Intl.DateTimeFormat>();
  const numberCache = new Map<string, Intl.NumberFormat>();
  const relativeCache = new Map<string, Intl.RelativeTimeFormat>();
  const listCache = new Map<string, Intl.ListFormat>();

  function dateFormat(options: DateTimeOptions): Intl.DateTimeFormat {
    const locale = getLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let formatter = dateCache.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, options);
      dateCache.set(key, formatter);
    }
    return formatter;
  }

  function resolveNumberLocale(): string {
    const pref = getPrefs().numberFormat;
    if (pref === 'comma-decimal') return 'pt-BR';
    if (pref === 'dot-decimal') return 'en-US';
    return getLocale();
  }

  function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const locale = resolveNumberLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let formatter = numberCache.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, options);
      numberCache.set(key, formatter);
    }
    return formatter;
  }

  function timeCycleOption(): Pick<DateTimeOptions, 'hourCycle'> | Record<string, never> {
    const tf = getPrefs().timeFormat;
    if (tf === '24h') return { hourCycle: 'h23' };
    if (tf === '12h') return { hourCycle: 'h12' };
    return {};
  }

  function relativeFormat(): Intl.RelativeTimeFormat {
    const locale = getLocale();
    let formatter = relativeCache.get(locale);
    if (!formatter) {
      formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      relativeCache.set(locale, formatter);
    }
    return formatter;
  }

  function listFormat(): Intl.ListFormat {
    const locale = getLocale();
    let formatter = listCache.get(locale);
    if (!formatter) {
      formatter = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
      listCache.set(locale, formatter);
    }
    return formatter;
  }

  const formatTimeFn = (timestamp: number): string => {
    const tf = getPrefs().timeFormat;
    if (tf === '24h') {
      return dateFormat({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp);
    }
    if (tf === '12h') {
      return dateFormat({ hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(timestamp);
    }
    return dateFormat({ hour: 'numeric', minute: '2-digit' }).format(timestamp);
  };

  return {
    formatTime: formatTimeFn,

    formatShortDate: (timestamp, now = new Date()) => {
      const sameYear = new Date(timestamp).getFullYear() === now.getFullYear();
      return dateFormat(
        sameYear
          ? { month: 'short', day: 'numeric' }
          : { month: 'short', day: 'numeric', year: 'numeric' },
      ).format(timestamp);
    },

    formatLongDate: (timestamp) => dateFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(timestamp),

    formatMediumDate: (timestamp) => {
      const df = getPrefs().dateFormat;
      if (df !== 'auto') return formatCustomNumericDate(timestamp, df);
      return dateFormat({ dateStyle: 'medium' }).format(timestamp);
    },

    formatNumericDate: (timestamp) => {
      const df = getPrefs().dateFormat;
      if (df !== 'auto') return formatCustomNumericDate(timestamp, df);
      return dateFormat({ year: 'numeric', month: 'numeric', day: 'numeric' }).format(timestamp);
    },

    formatFullDate: (timestamp) => dateFormat({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp),

    formatDateTime: (timestamp) => {
      const { dateFormat: df, timeFormat: tf } = getPrefs();
      if (df !== 'auto') {
        return `${formatCustomNumericDate(timestamp, df)}, ${formatTimeFn(timestamp)}`;
      }
      if (tf !== 'auto') {
        return dateFormat({ dateStyle: 'medium', timeStyle: 'short', ...timeCycleOption() }).format(timestamp);
      }
      return dateFormat({ dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
    },

    formatRelativeTime: (timestamp, now = new Date()) => {
      const delta = timestamp - now.getTime();
      const magnitude = Math.abs(delta);
      for (const { unit, ms } of RELATIVE_UNITS) {
        if (magnitude >= ms) {
          return relativeFormat().format(Math.round(delta / ms), unit);
        }
      }
      return relativeFormat().format(0, 'second');
    },

    formatRelativeDay: (timestamp, now = new Date()) => {
      const dayOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const days = Math.round((dayOf(new Date(timestamp)) - dayOf(now)) / (24 * 60 * 60 * 1000));
      return relativeFormat().format(days, 'day');
    },

    formatNumber: (value) => numberFormat({}).format(value),

    formatPercent: (percent) => numberFormat({ style: 'percent', maximumFractionDigits: 0 }).format(percent / 100),

    formatBytes: (bytes) => {
      let value = Math.max(0, bytes);
      let index = 0;
      while (value >= 1024 && index < BYTE_UNITS.length - 1) {
        value /= 1024;
        index += 1;
      }
      return numberFormat({
        style: 'unit',
        unit: BYTE_UNITS[index],
        unitDisplay: 'short',
        maximumFractionDigits: index === 0 ? 0 : 1,
      }).format(value);
    },

    formatDuration: (elapsedSeconds) => {
      const total = Math.max(0, Math.floor(elapsedSeconds));
      const hours = Math.floor(total / 3_600);
      const minutes = Math.floor((total % 3_600) / 60);
      const seconds = total % 60;
      const segment = (value: number) => numberFormat({
        minimumIntegerDigits: 2,
        maximumFractionDigits: 0,
        useGrouping: false,
      }).format(value);
      const tail = `${segment(minutes)}:${segment(seconds)}`;
      return hours > 0
        ? `${numberFormat({ maximumFractionDigits: 0, useGrouping: false }).format(hours)}:${tail}`
        : tail;
    },

    formatList: (items) => listFormat().format(items),
  };
}

/** The app-wide formatters, bound to the selected language and regional overrides. */
export const formatters: Formatters = createFormatters(
  () => i18n.resolvedLanguage ?? i18n.language ?? 'en',
  () => {
    const { timeFormat, dateFormat, numberFormat } = useRegionalStore.getState();
    return { timeFormat, dateFormat, numberFormat };
  },
);

/**
 * The same formatters for components. Subscribes to language and regional
 * preference changes so components re-render immediately when either changes.
 */
export function useFormatters(): Formatters {
  const { i18n: instance } = useTranslation();
  const language = instance.resolvedLanguage ?? instance.language;
  const timeFormat = useRegionalStore((s) => s.timeFormat);
  const dateFormat = useRegionalStore((s) => s.dateFormat);
  const numberFormat = useRegionalStore((s) => s.numberFormat);
  return useMemo(() => ({ ...formatters }), [language, timeFormat, dateFormat, numberFormat]);
}
