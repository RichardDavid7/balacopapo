import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsSectionsContext } from './SettingsSectionsContext';
import { HiButton } from '../telemetry/answers/HiButton';

/**
 * Reusable single-row tab bar for settings panels in tab mode.
 * Reads sections and activeSection from SettingsSectionsContext.
 * Supports horizontal mouse-wheel scrolling, left/right chevron controls when
 * overflowing, and auto-scrolls the active tab into view.
 */
export function SettingsTabBar() {
  const ctx = useSettingsSectionsContext();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollState, ctx?.sections.length]);

  useEffect(() => {
    activeBtnRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    const id = window.setTimeout(updateScrollState, 220);
    return () => window.clearTimeout(id);
  }, [ctx?.activeSection, updateScrollState]);

  if (!ctx || ctx.sections.length === 0) return null;

  const scrollByAmount = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className="relative border-b border-white/[0.06] -mt-2 mb-4 pb-2">
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-2 z-10 flex items-center pr-3 bg-gradient-to-r from-surface-base via-surface-base/90 to-transparent pointer-events-none">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => scrollByAmount(-200)}
            className="pointer-events-auto w-6 h-6 rounded-md bg-surface-elevated border border-border-soft text-txt-secondary hover:text-txt-primary hover:bg-surface-overlay flex items-center justify-center shadow-sm transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={updateScrollState}
        onWheel={(e) => {
          const el = scrollerRef.current;
          if (!el || el.scrollWidth <= el.clientWidth) return;
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            el.scrollLeft += e.deltaY;
          }
        }}
        className="flex flex-nowrap items-center gap-1 overflow-x-auto no-scrollbar"
      >
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
              ref={ctx.activeSection === s.id ? activeBtnRef : undefined}
              onClick={() => ctx.scrollToSection(s.id)}
              onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })}
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

      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-2 z-10 flex items-center pl-3 bg-gradient-to-l from-surface-base via-surface-base/90 to-transparent pointer-events-none">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => scrollByAmount(200)}
            className="pointer-events-auto w-6 h-6 rounded-md bg-surface-elevated border border-border-soft text-txt-secondary hover:text-txt-primary hover:bg-surface-overlay flex items-center justify-center shadow-sm transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
