import { useSettingsSectionsContext } from './SettingsSectionsContext';
import { HiButton } from '../telemetry/answers/HiButton';

/**
 * Reusable tab bar for settings panels in tab mode.
 * Reads sections and activeSection from SettingsSectionsContext.
 * Drop this into any panel that uses useSettingsSections with onNavigate.
 */
export function SettingsTabBar() {
  const ctx = useSettingsSectionsContext();
  if (!ctx || ctx.sections.length === 0) return null;

  return (
    <div className="flex flex-nowrap items-center gap-1 overflow-x-auto no-scrollbar border-b border-white/[0.06] -mt-2 mb-4 pb-2">
      {ctx.sections.map((s) => (
        s.invite === true ? (
          // The invitation wears the answer button's material so it reads as
          // an offer rather than as one more tab, but it only navigates here.
          <div key={s.id} className="flex items-center self-center shrink-0 pl-1">
            <HiButton onClick={() => ctx.scrollToSection(s.id)}>{s.label}</HiButton>
          </div>
        ) : (
        <button
          key={s.id}
          onClick={() => ctx.scrollToSection(s.id)}
          className={`px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap shrink-0 transition-colors relative ${
            ctx.activeSection === s.id
              ? 'bg-accent-primary/15 text-txt-primary font-semibold'
              : 'text-txt-tertiary hover:text-txt-secondary hover:bg-white/[0.04]'
          }`}
        >
          {s.label}
          {s.badgeCount !== undefined && s.badgeCount > 0 && (
            <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-amber/15 text-accent-amber">
              {s.badgeCount}
            </span>
          )}
          {s.badgeDot === true && (
            <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent-amber align-middle" />
          )}
        </button>
        )
      ))}
    </div>
  );
}
