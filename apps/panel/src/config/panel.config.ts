import type { LucideIcon } from "lucide-react";
import { Activity, Boxes, Brain, CircleDollarSign, ClipboardCheck, Database, GitBranch, HeartPulse, KeyRound, LayoutDashboard, ListTree, MessagesSquare, Radar, ScrollText, Search, Settings, Terminal, Waypoints, Webhook } from "lucide-react";

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
  { name: "Models", href: "/models", icon: ListTree, section: "Router" },
  { name: "Routing", href: "/routing", icon: GitBranch, section: "Router" },
  { name: "Quota", href: "/quota", icon: Radar, section: "Router" },
  { name: "Endpoints", href: "/endpoints", icon: Waypoints, section: "Router" },
  { name: "Clients", href: "/clients", icon: Terminal, section: "Router" },
  { name: "Playground", href: "/playground", icon: MessagesSquare, section: "Work" },
  { name: "Media", href: "/media", icon: MessagesSquare, section: "Work" },
  { name: "Search", href: "/search", icon: Search, section: "Work" },
  { name: "Evals", href: "/evals", icon: ClipboardCheck, section: "Work" },
  { name: "Agents", href: "/agents", icon: Waypoints, section: "Work" },
  { name: "Skills", href: "/skills", icon: ScrollText, section: "Work" },
  { name: "API keys", href: "/keys", icon: KeyRound, section: "Access" },
  { name: "Limits", href: "/limits", icon: Radar, section: "Access" },
  { name: "Webhooks", href: "/webhooks", icon: Webhook, section: "Access" },
  { name: "Batches", href: "/batches", icon: Database, section: "Access" },
  { name: "Activity", href: "/activity", icon: Activity, section: "Observe" },
  { name: "Usage", href: "/usage", icon: CircleDollarSign, section: "Observe" },
  { name: "Costs", href: "/costs", icon: CircleDollarSign, section: "Observe" },
  { name: "Health", href: "/status", icon: HeartPulse, section: "Observe" },
  { name: "Audit", href: "/audit", icon: ClipboardCheck, section: "Observe" },
  { name: "Memory", href: "/memory", icon: Brain, section: "System" },
  { name: "Cache", href: "/cache", icon: Database, section: "System" },
  { name: "Compression", href: "/compression", icon: ScrollText, section: "System" },
  { name: "Services", href: "/services", icon: Waypoints, section: "System" },
  { name: "Changelog", href: "/changelog", icon: ScrollText, section: "System" },
  { name: "Settings", href: "/settings", icon: Settings, section: "System" },
];

const hiddenKey = "wowrouter-hidden-nav";

export function hiddenNavHrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(hiddenKey) || "[]") as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

export function saveHiddenNav(hrefs: string[]) {
  localStorage.setItem(hiddenKey, JSON.stringify(hrefs));
  window.dispatchEvent(new Event("wowrouter-nav"));
}

export function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
