import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { NavBar } from './components/NavBar';
import { CollectionWorklist } from './pages/CollectionWorklist';
import { MastersTests } from './pages/MastersTests';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
import { RegisterWizard } from './pages/RegisterWizard';
import { Report } from './pages/Report';
import { ResultEntry } from './pages/ResultEntry';
import { SampleDetail } from './pages/SampleDetail';
import { VerifyQueue } from './pages/VerifyQueue';
import { VerifyReport } from './pages/VerifyReport';

/**
 * The public report-verification page is deliberately rendered WITHOUT the
 * staff NavBar — it is seen by patients/employers/insurers, not lab staff,
 * and should look like a calm public surface, not the internal tool.
 */
const PUBLIC_PATHS = ['/verify-report'];

export function App() {
  const { pathname } = useLocation();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}?`));

  return (
    <div className="min-h-screen">
      {!isPublic && <NavBar />}
      <main className={`mx-auto max-w-7xl px-4 py-5 sm:px-6 ${isPublic ? '!max-w-none !p-0' : ''}`}>
        <Routes>
          <Route path="/" element={<Navigate to="/register" replace />} />
          <Route path="/register" element={<RegisterWizard />} />
          <Route path="/collection" element={<CollectionWorklist />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/orders/:id/results" element={<ResultEntry />} />
          <Route path="/orders/:id/report" element={<Report />} />
          <Route path="/verify" element={<VerifyQueue />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/verify-report" element={<VerifyReport />} />
          <Route path="/samples/:id" element={<SampleDetail />} />
          <Route path="/masters/tests" element={<MastersTests />} />
          <Route path="*" element={<Navigate to="/register" replace />} />
        </Routes>
      </main>
    </div>
  );
}
