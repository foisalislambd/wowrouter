import { ThemeProvider } from "@/components/theme/theme-provider";
import { ToastProvider } from "@/components/ui/feedback";
import { PanelShell } from "@/components/layout/panel-shell";
import { SidebarProvider } from "@/context/sidebar-context";
import { getSession } from "@/lib/api";
import ActivityPage from "@/pages/ActivityPage";
import ActivityDetailPage from "@/pages/ActivityDetailPage";
import ClientsPage from "@/pages/ClientsPage";
import FallbackPage from "@/pages/FallbackPage";
import KeysPage from "@/pages/KeysPage";
import LoginPage from "@/pages/LoginPage";
import MemoryPage from "@/pages/MemoryPage";
import OverviewPage from "@/pages/OverviewPage";
import {
  AgentsPage,
  AuditPage,
  BatchesPage,
  CachePage,
  ChangelogPage,
  ChaosPage,
  CompressionPage,
  ConsolePage,
  CostsPage,
  EndpointsPage,
  EvalsPage,
  FreePage,
  HealthPage,
  LimitsPage,
  MediaPage,
  ModelsPage,
  PricingPage,
  ProxyPage,
  QuotaPage,
  ServicesPage,
  SkillsPage,
  TeamsPage,
  TranslatorPage,
  WebhooksPage,
} from "@/pages/ParityPages";
import PlaygroundPage from "@/pages/PlaygroundPage";
import ProviderPage from "@/pages/ProviderPage";
import ProvidersPage from "@/pages/ProvidersPage";
import SettingsPage from "@/pages/SettingsPage";
import UsagePage from "@/pages/UsagePage";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
      <BrowserRouter>
        <AuthGate>
          <SidebarProvider>
            <Routes>
              <Route element={<PanelShell />}>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/providers" element={<ProvidersPage />} />
                <Route path="/providers/:slug" element={<ProviderPage />} />
                <Route path="/keys" element={<KeysPage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/activity/:id" element={<ActivityDetailPage />} />
                <Route path="/usage" element={<UsagePage />} />
                <Route path="/fallback" element={<Navigate to="/routing" replace />} />
                <Route path="/routing" element={<FallbackPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/memory" element={<MemoryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/quota" element={<QuotaPage />} />
                <Route path="/endpoints" element={<EndpointsPage />} />
                <Route path="/translator" element={<TranslatorPage />} />
                <Route path="/onboarding" element={<Navigate to="/" replace />} />
                <Route path="/status" element={<HealthPage />} />
                <Route path="/status/chaos" element={<ChaosPage />} />
                <Route path="/status/proxy" element={<ProxyPage />} />
                <Route path="/console" element={<ConsolePage />} />
                <Route path="/costs" element={<CostsPage />} />
                <Route path="/costs/pricing" element={<PricingPage />} />
                <Route path="/costs/free" element={<FreePage />} />
                <Route path="/costs/teams" element={<TeamsPage />} />
                <Route path="/limits" element={<LimitsPage />} />
                <Route path="/webhooks" element={<WebhooksPage />} />
                <Route path="/batches" element={<BatchesPage />} />
                <Route path="/cache" element={<CachePage />} />
                <Route path="/compression" element={<CompressionPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/search" element={<Navigate to="/models?kind=search" replace />} />
                <Route path="/media" element={<MediaPage />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/evals" element={<EvalsPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/changelog" element={<ChangelogPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SidebarProvider>
        </AuthGate>
      </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancel = false;
    getSession()
      .then((session) => {
        if (!cancel) setLocked(session.authRequired && !session.authenticated);
      })
      .catch(() => {
        if (!cancel) setLocked(false);
      })
      .finally(() => {
        if (!cancel) setReady(true);
      });
    const onLock = () => setLocked(true);
    window.addEventListener("wowrouter-auth", onLock);
    return () => {
      cancel = true;
      window.removeEventListener("wowrouter-auth", onLock);
    };
  }, []);

  if (!ready) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }
  if (locked) {
    return <LoginPage onSuccess={() => setLocked(false)} />;
  }
  return children;
}
