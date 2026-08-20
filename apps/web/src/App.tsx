import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { NavBar } from './components/NavBar';
import { RequireAuth } from './components/RequireAuth';
import { CollectionWorklist } from './pages/CollectionWorklist';
import { Login } from './pages/Login';
import { MastersTests } from './pages/MastersTests';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
import { RegisterWizard } from './pages/RegisterWizard';
import { Report } from './pages/Report';
import { ResultEntry } from './pages/ResultEntry';
import { SampleDetail } from './pages/SampleDetail';
import { VerifyQueue } from './pages/VerifyQueue';
import { VerifyReport } from './pages/VerifyReport';
import { PatientLogin } from './pages/portal/PatientLogin';
import { PatientOrders } from './pages/portal/PatientOrders';
import { PatientReport } from './pages/portal/PatientReport';
import { ReferrerLogin } from './pages/portal/ReferrerLogin';
import { ReferrerOrders } from './pages/portal/ReferrerOrders';
import { ReferrerReport } from './pages/portal/ReferrerReport';
import { PortalAuthProvider } from './auth/PortalAuthProvider';
import { RequirePortalAuth } from './components/RequirePortalAuth';

/**
 * Public (no auth, no staff NavBar) surfaces:
 *   /verify-report  — the patient-facing report-authenticity page behind the
 *                     printed QR code (deliberately calm, no staff chrome)
 *   /login          — the Stage 7 sign-in page itself
 *   /portal/*       — Stage 8 patient/referrer portals (own auth system)
 *
 * Every other route is behind RequireAuth: unauthenticated visitors are sent
 * to /login?returnTo=<intended path> and returned there after signing in.
 */
const PUBLIC_PATHS = ['/verify-report', '/login'];
const PORTAL_PATHS = ['/portal'];

function isPortalPath(pathname: string): boolean {
  return PORTAL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function App() {
  const { pathname } = useLocation();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}?`));
  const isPortal = isPortalPath(pathname);

  // Portal routes get their own provider tree — no staff NavBar, no staff auth.
  if (isPortal) {
    return (
      <PortalAuthProvider>
        <Routes>
          <Route path="/portal" element={<Navigate to="/portal/patient/login" replace />} />
          <Route path="/portal/patient/login" element={<PatientLogin />} />
          <Route
            path="/portal/patient"
            element={
              <RequirePortalAuth redirectTo="/portal/patient/login">
                <PatientOrders />
              </RequirePortalAuth>
            }
          />
          <Route
            path="/portal/patient/orders/:id/report"
            element={
              <RequirePortalAuth redirectTo="/portal/patient/login">
                <PatientReport />
              </RequirePortalAuth>
            }
          />
          <Route path="/portal/referrer/login" element={<ReferrerLogin />} />
          <Route
            path="/portal/referrer"
            element={
              <RequirePortalAuth redirectTo="/portal/referrer/login">
                <ReferrerOrders />
              </RequirePortalAuth>
            }
          />
          <Route
            path="/portal/referrer/orders/:id/report"
            element={
              <RequirePortalAuth redirectTo="/portal/referrer/login">
                <ReferrerReport />
              </RequirePortalAuth>
            }
          />
          <Route path="*" element={<Navigate to="/portal/patient/login" replace />} />
        </Routes>
      </PortalAuthProvider>
    );
  }

  return (
    <div className="min-h-screen">
      {!isPublic && <NavBar />}
      <main className={`mx-auto max-w-screen-2xl px-4 py-5 sm:px-6 ${isPublic ? '!max-w-none !p-0' : ''}`}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Navigate to="/register" replace />
              </RequireAuth>
            }
          />
          <Route
            path="/register"
            element={
              <RequireAuth>
                <RegisterWizard />
              </RequireAuth>
            }
          />
          <Route
            path="/collection"
            element={
              <RequireAuth>
                <CollectionWorklist />
              </RequireAuth>
            }
          />
          <Route
            path="/orders"
            element={
              <RequireAuth>
                <Orders />
              </RequireAuth>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <RequireAuth>
                <OrderDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/orders/:id/results"
            element={
              <RequireAuth>
                <ResultEntry />
              </RequireAuth>
            }
          />
          <Route
            path="/orders/:id/report"
            element={
              <RequireAuth>
                <Report />
              </RequireAuth>
            }
          />
          <Route
            path="/verify"
            element={
              <RequireAuth>
                <VerifyQueue />
              </RequireAuth>
            }
          />
          <Route
            path="/approvals"
            element={
              <RequireAuth>
                <ApprovalQueue />
              </RequireAuth>
            }
          />
          <Route path="/verify-report" element={<VerifyReport />} />
          <Route
            path="/samples/:id"
            element={
              <RequireAuth>
                <SampleDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/masters/tests"
            element={
              <RequireAuth>
                <MastersTests />
              </RequireAuth>
            }
          />
          <Route
            path="*"
            element={
              <RequireAuth>
                <Navigate to="/register" replace />
              </RequireAuth>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
