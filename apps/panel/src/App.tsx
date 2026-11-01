import { Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell, Splash } from '@/components/layout/app-shell';
import { DevMocks } from '@/components/layout/dev-mocks';
import { AgentsScreen } from '@/features/agents/components/agents-screen';
import { AlertsScreen } from '@/features/alerts/components/alerts-screen';
import { AnalyticsScreen } from '@/features/analytics/components/analytics-screen';
import { ConfirmEmailScreen } from '@/features/auth/components/confirm-email-screen';
import { DeviceScreen } from '@/features/auth/components/device-screen';
import { LoginScreen } from '@/features/auth/components/login-screen';
import { NotFoundScreen } from '@/features/auth/components/not-found-screen';
import { BudgetsScreen } from '@/features/budgets/components/budgets-screen';
import { CacheScreen } from '@/features/cache/components/cache-screen';
import { ChangeRequestsScreen } from '@/features/change-requests/components/change-requests-screen';
import { KeysScreen } from '@/features/keys/components/keys-screen';
import { McpScreen } from '@/features/mcp/components/mcp-screen';
import { ModelsScreen } from '@/features/models/components/models-screen';
import { OverviewScreen } from '@/features/overview/components/overview-screen';
import { PlaygroundScreen } from '@/features/playground/components/playground-screen';
import { PluginsScreen } from '@/features/plugins/components/plugins-screen';
import { ProvidersScreen } from '@/features/providers/components/providers-screen';
import { RequestLogScreen } from '@/features/request-log/components/request-log-screen';
import { RoutingScreen } from '@/features/routing/components/routing-screen';
import { SafetyScreen } from '@/features/safety/components/safety-screen';
import { SettingsRedirect } from '@/features/settings/components/settings-redirect';
import { TeamsUsersScreen } from '@/features/teams-users/components/teams-users-screen';

function TrimSlash() {
  const loc = useLocation();
  if (loc.pathname.length > 1 && loc.pathname.endsWith('/')) {
    return <Navigate to={loc.pathname.replace(/\/+$/, '') + loc.search + loc.hash} replace />;
  }
  return <Outlet />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Splash />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

export function App() {
  return (
    <DevMocks>
      <Routes>
        <Route element={<TrimSlash />}>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/accept-invitation" element={<LoginScreen entry="invitation" />} />
        <Route path="/reset-password" element={<LoginScreen entry="reset" />} />
        <Route path="/confirm-email" element={<ConfirmEmailScreen />} />
        <Route path="/device" element={<DeviceScreen />} />
        <Route path="/" element={<Shell><OverviewScreen /></Shell>} />
        <Route path="/request-log" element={<Shell><RequestLogScreen /></Shell>} />
        <Route path="/analytics" element={<Shell><AnalyticsScreen /></Shell>} />
        <Route path="/alerts" element={<Shell><AlertsScreen /></Shell>} />
        <Route path="/budgets" element={<Shell><BudgetsScreen /></Shell>} />
        <Route path="/safety" element={<Shell><SafetyScreen /></Shell>} />
        <Route path="/keys" element={<Shell><KeysScreen /></Shell>} />
        <Route path="/teams" element={<Shell><TeamsUsersScreen /></Shell>} />
        <Route path="/change-requests" element={<Shell><ChangeRequestsScreen /></Shell>} />
        <Route path="/models" element={<Shell><ModelsScreen /></Shell>} />
        <Route path="/providers" element={<Shell><ProvidersScreen /></Shell>} />
        <Route path="/cache" element={<Shell><CacheScreen /></Shell>} />
        <Route path="/routing" element={<Shell><RoutingScreen /></Shell>} />
        <Route path="/playground" element={<Shell><PlaygroundScreen /></Shell>} />
        <Route path="/mcp" element={<Shell><McpScreen /></Shell>} />
        <Route path="/agents" element={<Shell><AgentsScreen /></Shell>} />
        <Route path="/plugins" element={<Shell><PluginsScreen /></Shell>} />
        <Route path="/settings" element={<Shell><SettingsRedirect /></Shell>} />
        <Route path="*" element={<NotFoundScreen />} />
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DevMocks>
  );
}
