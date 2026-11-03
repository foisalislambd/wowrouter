import { PanelBackdrop } from "@/components/layout/panel-backdrop";
import { PanelHeader } from "@/components/layout/panel-header";
import { PanelSidebar } from "@/components/layout/panel-sidebar";
import { SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED, useSidebar } from "@/context/sidebar-context";
import { Outlet, useLocation } from "react-router-dom";

export function PanelShell() {
  const { isExpanded, isDesktop } = useSidebar();
  const sidebarWidth = isDesktop ? (isExpanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED) : 0;
  const chat = useLocation().pathname === "/playground";

  return (
    <div className="panel-shell panel-main flex h-dvh w-full overflow-hidden">
      <div className="hidden shrink-0 transition-[width] duration-300 ease-in-out lg:block" style={{ width: sidebarWidth }} />
      <PanelSidebar />
      <PanelBackdrop />
      <div className="contain-paint flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PanelHeader />
        <main className={chat ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "panel-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden"}>
          {chat ? (
            <Outlet />
          ) : (
            <div className="w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
