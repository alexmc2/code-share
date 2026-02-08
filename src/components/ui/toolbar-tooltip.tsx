import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ToolbarTooltipProps {
  label: string;
  children: ReactNode;
  align?: 'center' | 'start' | 'end';
  side?: 'top' | 'bottom';
  showOnMobile?: boolean;
}

export function ToolbarTooltip({
  label,
  children,
  align = 'center',
  side = 'bottom',
  showOnMobile = false,
}: ToolbarTooltipProps) {
  const alignClass =
    align === 'start'
      ? 'left-0'
      : align === 'end'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';
  const sideClass =
    side === 'top'
      ? 'bottom-[calc(100%+10px)] -translate-y-1 group-hover/toolbar-tooltip:translate-y-0'
      : 'top-[calc(100%+10px)] translate-y-1 group-hover/toolbar-tooltip:translate-y-0';
  const arrowClass =
    side === 'top'
      ? 'absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900'
      : 'absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900';

  return (
    <div className="group/toolbar-tooltip relative flex items-center">
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className={cn(
          `pointer-events-none absolute z-70 w-max max-w-64 whitespace-normal rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm font-medium leading-snug text-slate-700 opacity-0 shadow-[0_4px_16px_rgba(15,23,42,0.08)] transition-all duration-150 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-100 dark:shadow-[0_12px_22px_rgba(2,6,23,0.45)] group-hover/toolbar-tooltip:opacity-100 ${alignClass} ${sideClass}`,
          showOnMobile ? 'block' : 'hidden md:block',
        )}
      >
        {label}
        <span className={arrowClass} />
      </span>
    </div>
  );
}
