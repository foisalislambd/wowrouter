import { useSidebar } from "@/context/sidebar-context";
import { useEffect } from "react";

export function PanelBackdrop() {
  const { isMobileOpen, isDesktop, closeMobileSidebar } = useSidebar();

  useEffect(() => {
    if (!isMobileOpen || isDesktop) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMobileSidebar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileOpen, isDesktop, closeMobileSidebar]);

  if (!isMobileOpen || isDesktop) return null;

  return (
    <button
      type="button"
      className="fixed inset-0 z-40 bg-gray-900/60 backdrop-blur-[2px] lg:hidden"
      onClick={closeMobileSidebar}
      aria-label="Close navigation"
    />
  );
}
