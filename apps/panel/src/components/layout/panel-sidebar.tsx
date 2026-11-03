import { panelConfig, panelNavItems, isNavActive } from "@/config/panel.config";
import { providersListPath } from "@/lib/provider-list-view";
import {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  useSidebar,
} from "@/context/sidebar-context";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

export function PanelSidebar() {
  const { pathname } = useLocation();
  const { isExpanded, isMobileOpen, isDesktop, toggleSidebar, closeMobileSidebar } = useSidebar();

  useEffect(() => {
    closeMobileSidebar();
  }, [pathname, closeMobileSidebar]);

  const showLabels = !isDesktop || isExpanded || isMobileOpen;
  const desktopWidth = isExpanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED;
  const mobileClosed = !isDesktop && !isMobileOpen;
  const sections = groupNav(panelNavItems);

  return (
    <aside
      style={isDesktop ? { width: desktopWidth } : { width: Math.min(320, SIDEBAR_WIDTH_EXPANDED) }}
      className={`fixed top-0 left-0 z-50 flex h-dvh flex-col border-r border-gray-200 bg-white transition-[width,transform] duration-300 ease-in-out dark:border-gray-800 dark:bg-gray-900 ${
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      } lg:translate-x-0`}
      aria-label="WowRouter navigation"
      aria-hidden={mobileClosed || undefined}
      inert={mobileClosed || undefined}
    >
      <div className="panel-topbar flex items-center gap-2 px-3">
        <Link to="/" className={`flex min-w-0 flex-1 items-center gap-2 ${showLabels ? "" : "justify-center"}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            {panelConfig.brand.letter}
          </span>
          {showLabels && (
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{panelConfig.brand.name}</p>
          )}
        </Link>
        {!isDesktop && (
          <button
            type="button"
            onClick={closeMobileSidebar}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto px-2.5 py-3">
        {sections.map((group, index) => (
          <div key={group.section} className="flex flex-col gap-1">
            {showLabels ? (
              <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
                {group.section}
              </p>
            ) : (
              index > 0 && <div className="mx-2 my-1 h-px bg-gray-200 dark:bg-gray-800" />
            )}
            {group.items.map((item) => {
              const active = isNavActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  to={item.href === "/providers" ? providersListPath() : item.href}
                  title={showLabels ? undefined : item.name}
                  aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                    active
                      ? "bg-brand-500 text-white shadow-sm shadow-brand-500/20"
                      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/8"
                  } ${showLabels ? "" : "justify-center px-0"}`}
                >
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-gray-500 dark:text-gray-400"}`} />
                  {showLabels && <span className="truncate">{item.name}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {isDesktop && (
        <div className="shrink-0 border-t border-gray-200 p-2.5 dark:border-gray-800">
          <button
            type="button"
            onClick={toggleSidebar}
            className={`flex w-full items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/5 ${showLabels ? "" : "justify-center"}`}
            aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isExpanded ? (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span>Collapse</span>
              </>
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
          </button>
        </div>
      )}
    </aside>
  );
}

function groupNav(items: typeof panelNavItems) {
  const groups: { section: string; items: typeof panelNavItems }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last?.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}
