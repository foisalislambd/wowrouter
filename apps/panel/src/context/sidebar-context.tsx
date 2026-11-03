import { useIsDesktop } from "@/hooks/use-is-desktop";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const SIDEBAR_WIDTH_EXPANDED = 260;
export const SIDEBAR_WIDTH_COLLAPSED = 80;

type SidebarContextValue = {
  isExpanded: boolean;
  isMobileOpen: boolean;
  isDesktop: boolean;
  toggleSidebar: () => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const effectiveExpanded = isDesktop ? isExpanded : true;
  const effectiveMobileOpen = isDesktop ? false : isMobileOpen;

  useEffect(() => {
    document.body.style.overflow = effectiveMobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [effectiveMobileOpen]);

  const toggleSidebar = useCallback(() => setIsExpanded((value) => !value), []);
  const toggleMobileSidebar = useCallback(() => setIsMobileOpen((value) => !value), []);
  const closeMobileSidebar = useCallback(() => setIsMobileOpen(false), []);

  const value = useMemo(
    () => ({
      isExpanded: effectiveExpanded,
      isMobileOpen: effectiveMobileOpen,
      isDesktop,
      toggleSidebar,
      toggleMobileSidebar,
      closeMobileSidebar,
    }),
    [
      effectiveExpanded,
      effectiveMobileOpen,
      isDesktop,
      toggleSidebar,
      toggleMobileSidebar,
      closeMobileSidebar,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("useSidebar must be used within SidebarProvider");
  return value;
}
