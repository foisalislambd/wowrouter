import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Bot,
  Boxes,
  CircleDollarSign,
  Database,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Puzzle,
  Shield,
  Settings,
  Sparkles,
  Users,
  Waypoints,
  Workflow,
} from "lucide-react";

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
  { name: "Overview", href: "/", icon: LayoutDashboard, section: "Observe" },
  { name: "Activity", href: "/activity", icon: Activity, section: "Observe" },
  { name: "Analytics", href: "/analytics", icon: CircleDollarSign, section: "Observe" },
  { name: "Alerts", href: "/alerts", icon: Bell, section: "Observe" },
  { name: "Budgets", href: "/budgets", icon: CircleDollarSign, section: "Govern" },
  { name: "Safety", href: "/safety", icon: Shield, section: "Govern" },
  { name: "API keys", href: "/keys", icon: KeyRound, section: "Govern" },
  { name: "Teams", href: "/teams", icon: Users, section: "Govern" },
  { name: "Changes", href: "/changes", icon: Workflow, section: "Govern" },
  { name: "Models", href: "/models", icon: Sparkles, section: "Configure" },
  { name: "Providers", href: "/providers", icon: Boxes, section: "Configure" },
  { name: "Routing", href: "/routing", icon: Waypoints, section: "Configure" },
  { name: "Fallback", href: "/fallback", icon: GitBranch, section: "Configure" },
  { name: "Cache", href: "/cache", icon: Database, section: "Configure" },
  { name: "Playground", href: "/playground", icon: MessagesSquare, section: "Configure" },
  { name: "MCP", href: "/mcp", icon: Puzzle, section: "Extend" },
  { name: "Agents", href: "/agents", icon: Bot, section: "Extend" },
  { name: "Plugins", href: "/plugins", icon: Puzzle, section: "Extend" },
  { name: "Settings", href: "/settings", icon: Settings, section: "System" },
];

export function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
