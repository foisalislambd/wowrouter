import { ThemeProvider } from "@/components/theme/theme-provider";
import { PanelShell } from "@/components/layout/panel-shell";
import { SidebarProvider } from "@/context/sidebar-context";
import ActivityPage from "@/pages/ActivityPage";
import ActivityDetailPage from "@/pages/ActivityDetailPage";
import FallbackPage from "@/pages/FallbackPage";
import KeysPage from "@/pages/KeysPage";
import OverviewPage from "@/pages/OverviewPage";
import PlaygroundPage from "@/pages/PlaygroundPage";
import ProviderPage from "@/pages/ProviderPage";
import ProvidersPage from "@/pages/ProvidersPage";
import SettingsPage from "@/pages/SettingsPage";
import UsagePage from "@/pages/UsagePage";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
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
              <Route path="/fallback" element={<FallbackPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SidebarProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
