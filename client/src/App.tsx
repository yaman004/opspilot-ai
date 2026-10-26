import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@opspilot/shared';
import { useAuth } from './lib/auth';
import { AppLayout } from './layouts/AppLayout';
import { Skeleton } from './components/ui';
import { Landing } from './pages/Landing';
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages';
import { OnboardingPage } from './pages/Onboarding';
import { NotFoundPage, ForbiddenPage } from './pages/NotFound';
import { IncidentList } from './pages/IncidentList';
import { IncidentDetail } from './pages/IncidentDetail';
import { IncidentFormPage } from './pages/IncidentForm';

// Heavier / less-visited pages are split out of the main bundle.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.AnalyticsPage })));
const AiTriage = lazy(() => import('./pages/AiTriage').then((m) => ({ default: m.AiTriagePage })));
const Team = lazy(() => import('./pages/Team').then((m) => ({ default: m.TeamPage })));
const Sla = lazy(() => import('./pages/Sla').then((m) => ({ default: m.SlaPage })));
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.NotificationsPage })));
const Audit = lazy(() => import('./pages/Audit').then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-40" />
    </div>
  );
}

/** Sends signed-out visitors to /login and remembers where they were headed. */
function RequireAuth() {
  const { status, memberships } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!memberships.length) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <ForbiddenPage />;
}

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />

        <Route path="/app" element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="incidents" element={<IncidentList />} />
            <Route path="incidents/new" element={<RequirePermission perm="incident:create"><IncidentFormPage /></RequirePermission>} />
            <Route path="incidents/:incidentId" element={<IncidentDetail />} />
            <Route path="incidents/:incidentId/edit" element={<RequirePermission perm="incident:update"><IncidentFormPage /></RequirePermission>} />
            <Route path="triage" element={<RequirePermission perm="ai:triage"><AiTriage /></RequirePermission>} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="team" element={<Team />} />
            <Route path="sla" element={<Sla />} />
            <Route path="audit" element={<RequirePermission perm="audit:read"><Audit /></RequirePermission>} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage inApp />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
