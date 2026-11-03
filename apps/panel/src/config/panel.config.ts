import type { LucideIcon } from "lucide-react";
import { Activity, Boxes, CircleDollarSign, GitBranch, KeyRound, LayoutDashboard, MessagesSquare, Settings } from "lucide-react";

export const panelConfig = {
  brand: {
    name: "WowRouter",
    letter: "W",
  },
};

export type PanelNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  section: string;
};

export const panelNavItems: PanelNavItem[] = [
  { name: "Overview", href: "/", icon: LayoutDashboard, section: "Router" },
  { name: "Providers", href: "/providers", icon: Boxes, section: "Router" },
  { name: "Fallback", href: "/fallback", icon: GitBranch, section: "Router" },
  { name: "API keys", href: "/keys", icon: KeyRound, section: "Access" },
  { name: "Playground", href: "/playground", icon: MessagesSquare, section: "Access" },
  { name: "Activity", href: "/activity", icon: Activity, section: "Access" },
  { name: "Usage", href: "/usage", icon: CircleDollarSign, section: "Access" },
  { name: "Settings", href: "/settings", icon: Settings, section: "System" },
];

export function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
