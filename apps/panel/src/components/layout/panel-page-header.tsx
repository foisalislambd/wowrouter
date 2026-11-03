import type { ReactNode } from "react";

export function PanelPageHeader({
  title,
  actions,
  leading,
}: {
  title: string;
  actions?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl dark:text-white">
          {title}
        </h1>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
