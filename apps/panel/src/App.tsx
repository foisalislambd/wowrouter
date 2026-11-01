import { ThemeProvider } from "@/components/theme/theme-provider";
import { PanelShell } from "@/components/layout/panel-shell";
import { SidebarProvider } from "@/context/sidebar-context";
import { sessionOK } from "@/lib/api";
import ActivityPage from "@/pages/ActivityPage";
import ActivityDetailPage from "@/pages/ActivityDetailPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import BoardPage from "@/pages/BoardPage";
import BudgetsPage from "@/pages/BudgetsPage";
import CachePage from "@/pages/CachePage";
import FallbackPage from "@/pages/FallbackPage";
import KeysPage from "@/pages/KeysPage";
import LoginPage from "@/pages/LoginPage";
import OverviewPage from "@/pages/OverviewPage";
import PlaygroundPage from "@/pages/PlaygroundPage";
import ProviderPage from "@/pages/ProviderPage";
import ProvidersPage from "@/pages/ProvidersPage";
import SafetyPage from "@/pages/SafetyPage";
import SettingsPage from "@/pages/SettingsPage";
import TeamsPage from "@/pages/TeamsPage";
import UsagePage from "@/pages/UsagePage";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

export default function App() {
  const [ready, setReady] = useState<"load" | "in" | "out">("load");

  useEffect(() => {
    sessionOK().then((ok) => setReady(ok ? "in" : "out"));
  }, []);

  return (
    <ThemeProvider>
      <BrowserRouter>
        {ready === "load" ? null : ready === "out" ? (
          <LoginPage onReady={() => setReady("in")} />
        ) : (
          <SidebarProvider>
            <Routes>
              <Route element={<PanelShell />}>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/providers" element={<ProvidersPage />} />
                <Route path="/providers/:slug" element={<ProviderPage />} />
                <Route path="/models" element={<BoardPage kind="models" title="Models" blurb="A virtual model is the name clients send. Point it at deployments with a mode and a list of steps." placeholder='{"mode":"order","steps":["openai-gpt-4o-mini"]}' />} />
                <Route path="/routing" element={<BoardPage kind="routes" title="Routing" blurb="A route is a shared plan. Models can name it. Modes: order, cheapest, fastest, busy, split, block." placeholder='{"mode":"cheapest","steps":["openai-gpt-4o-mini","anthropic-haiku"]}' />} />
                <Route path="/keys" element={<KeysPage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/activity/:id" element={<ActivityDetailPage />} />
                <Route path="/usage" element={<UsagePage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/alerts" element={<div className="space-y-10"><BoardPage kind="alerts" title="Alerts" blurb="Rules stored for spend and error warnings." placeholder='{"severity":"warning","summary":"Budget crossed 80%"}' /><BoardPage kind="channels" title="Channels" blurb="Where an alert notice is delivered." placeholder='{"type":"log"}' /></div>} />
                <Route path="/budgets" element={<BudgetsPage />} />
                <Route path="/safety" element={<SafetyPage />} />
                <Route path="/teams" element={<TeamsPage />} />
                <Route path="/changes" element={<BoardPage kind="changes" title="Changes" blurb="A change request records a proposed edit and its state: open, approved, or applied." placeholder='{"state":"open"}' />} />
                <Route path="/cache" element={<CachePage />} />
                <Route path="/fallback" element={<FallbackPage />} />
                <Route path="/mcp" element={<BoardPage kind="mcp" title="MCP" blurb="Named tool servers. Leave the URL empty to keep the server local to this router." placeholder='{"url":"http://127.0.0.1:3000/mcp"}' />} />
                <Route path="/agents" element={<BoardPage kind="agents" title="Agents" blurb="Agent-to-agent endpoints this router will forward when a client calls them." placeholder='{"url":"http://127.0.0.1:8080"}' />} />
                <Route path="/plugins" element={<BoardPage kind="plugins" title="Plugins" blurb="Plugin records are stored with the gateway. This build does not execute plugin code." placeholder='{"entry":""}' />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SidebarProvider>
        )}
      </BrowserRouter>
    </ThemeProvider>
  );
}
