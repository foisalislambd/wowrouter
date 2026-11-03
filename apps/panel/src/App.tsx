import { ThemeProvider } from "@/components/theme/theme-provider";
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
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SidebarProvider>
        </AuthGate>
      </BrowserRouter>
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
