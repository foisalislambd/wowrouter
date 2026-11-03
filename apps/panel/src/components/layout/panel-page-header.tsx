import type { ReactNode } from "react";

export function PanelPageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl dark:text-white">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
