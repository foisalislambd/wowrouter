import { Link, useLocation } from "react-router-dom";

export type PageTab = { href: string; label: string };

export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const { pathname } = useLocation();
  return (
    <div role="tablist" aria-label="Sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
      {tabs.map((tab) => {
        const selected = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            to={tab.href}
            role="tab"
            aria-selected={selected}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              selected
                ? "border-brand-500 text-brand-600 dark:text-brand-300"
                : "border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export const costTabs: PageTab[] = [
  { href: "/costs", label: "Spend" },
  { href: "/costs/pricing", label: "Pricing" },
  { href: "/costs/free", label: "Free tiers" },
  { href: "/costs/teams", label: "Teams" },
];

export const healthTabs: PageTab[] = [
  { href: "/status", label: "Status" },
  { href: "/status/chaos", label: "Chaos" },
  { href: "/status/proxy", label: "Proxy" },
  { href: "/console", label: "Console" },
];

export const keyTabs: PageTab[] = [
  { href: "/keys", label: "Keys" },
  { href: "/limits", label: "Rate limit" },
];

export const activityTabs: PageTab[] = [
  { href: "/activity", label: "Requests" },
  { href: "/audit", label: "Audit" },
];

export const routeTabs: PageTab[] = [
  { href: "/routing", label: "Combos" },
  { href: "/quota", label: "Quota" },
];

export const endpointTabs: PageTab[] = [
  { href: "/endpoints", label: "Routes" },
  { href: "/translator", label: "Translator" },
];

export const agentTabs: PageTab[] = [
  { href: "/agents", label: "Notes" },
  { href: "/skills", label: "Skills" },
];

export const localTabs: PageTab[] = [
  { href: "/memory", label: "Memory" },
  { href: "/cache", label: "Cache" },
  { href: "/compression", label: "Compression" },
];
