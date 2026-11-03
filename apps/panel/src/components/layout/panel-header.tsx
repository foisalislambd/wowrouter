import { panelConfig } from "@/config/panel.config";
import { useSidebar } from "@/context/sidebar-context";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Menu, X } from "lucide-react";
import { Link } from "react-router-dom";

export function PanelHeader() {
  const { isMobileOpen, isDesktop, toggleMobileSidebar } = useSidebar();

  return (
    <header className="panel-topbar sticky top-0 z-30 w-full bg-white dark:bg-gray-900">
      <div className="flex h-full items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={toggleMobileSidebar}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/5 ${isDesktop ? "lg:hidden" : ""}`}
          aria-label={isMobileOpen ? "Close menu" : "Open menu"}
        >
          {!isDesktop && isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link to="/" className="flex items-center gap-2 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            {panelConfig.brand.letter}
          </span>
          <span className="text-base font-semibold text-gray-900 dark:text-white">{panelConfig.brand.name}</span>
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
