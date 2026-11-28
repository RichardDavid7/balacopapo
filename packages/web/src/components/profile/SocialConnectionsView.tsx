import { useTranslation } from 'react-i18next';
import type { SocialConnectionPlatform, UserSocialConnection } from '@backspace/shared';

export function PlatformIcon({ platform, size = 16 }: { platform: SocialConnectionPlatform; size?: number }) {
  switch (platform) {
    case 'steam':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-9.95 9.04l5.35 2.21a2.84 2.84 0 0 1 1.61-.49l2.44-3.54v-.05a3.79 3.79 0 1 1 3.79 3.79h-.09l-3.48 2.49a2.84 2.84 0 0 1-5.64.55l-3.82-1.58A10 10 0 1 0 12 2zm3.24 5.91a2.53 2.53 0 1 0 0 5.06 2.53 2.53 0 0 0 0-5.06zm0 1.26a1.27 1.27 0 1 1 0 2.54 1.27 1.27 0 0 1 0-2.54zM9 14.35a1.9 1.9 0 1 0 1.9 1.9A1.9 1.9 0 0 0 9 14.35z" />
        </svg>
      );
    case 'epic':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 3h16a1 1 0 0 1 1 1v12.6a1 1 0 0 1-.52.88l-8 4.4a1 1 0 0 1-.96 0l-8-4.4A1 1 0 0 1 3 16.6V4a1 1 0 0 1 1-1zm3 4v10h10v-2H9v-2h6v-2H9V9h8V7H7z" />
        </svg>
      );
    case 'discord':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.27 5.33A17.27 17.27 0 0 0 15 4a11.9 11.9 0 0 0-.55 1.13 16 16 0 0 0-4.9 0A11.9 11.9 0 0 0 9 4a17.2 17.2 0 0 0-4.27 1.33C2.03 9.35 1.3 13.27 1.66 17.13a17.5 17.5 0 0 0 5.23 2.65 13 13 0 0 0 1.12-1.82 11.4 11.4 0 0 1-1.76-.84l.43-.34a12.3 12.3 0 0 0 10.64 0l.43.34a11.4 11.4 0 0 1-1.76.84c.32.64.7 1.25 1.12 1.82a17.4 17.4 0 0 0 5.23-2.65c.43-4.47-.73-8.35-3.07-11.8zM8.68 14.81c-1.02 0-1.86-.94-1.86-2.1s.82-2.1 1.86-2.1 1.88.94 1.86 2.1c0 1.16-.82 2.1-1.86 2.1zm6.64 0c-1.02 0-1.86-.94-1.86-2.1s.82-2.1 1.86-2.1 1.88.94 1.86 2.1c0 1.16-.82 2.1-1.86 2.1z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />
        </svg>
      );
    case 'spotify':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.58 14.42a.62.62 0 0 1-.86.21c-2.35-1.44-5.31-1.76-8.8-.96a.62.62 0 1 1-.28-1.21c3.82-.87 7.1-.5 9.73 1.1.3.18.39.56.21.86zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.16a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.36.22.48.7.26 1.06zm.11-2.83C14.69 8.95 9.37 8.78 6.29 9.71a.94.94 0 1 1-.54-1.8c3.53-1.07 9.4-.86 13.11 1.34a.94.94 0 0 1-.95 1.62z" />
        </svg>
      );
    case 'tidal':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 7l3 3-3 3-3-3 3-3zm6 0l3 3-3 3-3-3 3-3zm6 0l3 3-3 3-3-3 3-3zm-6 6l3 3-3 3-3-3 3-3z" />
        </svg>
      );
    case 'qobuz':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 6.32 17.74l1.97 1.97 1.42-1.42-1.97-1.97A10 10 0 0 0 12 2zm0 16a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'facebook':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
        </svg>
      );
    case 'website':
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
  }
}

export function SocialConnectionsView({
  connections,
  compact = false,
}: {
  connections?: UserSocialConnection[];
  compact?: boolean;
}) {
  const { t } = useTranslation(['social']);
  if (!connections || connections.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {connections.map((conn) => {
          const title = `${t(`social:connections.platforms.${conn.platform}`)}: ${conn.displayLabel}`;
          const cls = 'inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-txt-secondary hover:text-txt-primary transition-colors max-w-full';
          return conn.url ? (
            <a
              key={conn.id}
              href={conn.url}
              target="_blank"
              rel="noopener noreferrer"
              title={title}
              className={cls}
            >
              <PlatformIcon platform={conn.platform} size={13} />
              <span className="truncate max-w-[140px]">{conn.displayLabel}</span>
            </a>
          ) : (
            <span key={conn.id} title={title} className={cls}>
              <PlatformIcon platform={conn.platform} size={13} />
              <span className="truncate max-w-[140px]">{conn.displayLabel}</span>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {connections.map((conn) => {
        const card = (
          <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-colors min-w-0">
            <span className="w-8 h-8 rounded-lg bg-white/[0.06] text-txt-primary flex items-center justify-center shrink-0">
              <PlatformIcon platform={conn.platform} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-txt-primary truncate">{conn.displayLabel}</div>
              <div className="text-[10px] text-txt-tertiary truncate">
                {t(`social:connections.platforms.${conn.platform}`)}
              </div>
            </div>
            {conn.url && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-tertiary shrink-0" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            )}
          </div>
        );

        return conn.url ? (
          <a key={conn.id} href={conn.url} target="_blank" rel="noopener noreferrer" className="block min-w-0">
            {card}
          </a>
        ) : (
          <div key={conn.id} className="min-w-0">{card}</div>
        );
      })}
    </div>
  );
}
