import { Navigate, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { CollectionWorklist } from './pages/CollectionWorklist';
import { MastersTests } from './pages/MastersTests';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
import { RegisterWizard } from './pages/RegisterWizard';
import { ResultEntry } from './pages/ResultEntry';
import { SampleDetail } from './pages/SampleDetail';

export function App() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <Routes>
          <Route path="/" element={<Navigate to="/register" replace />} />
          <Route path="/register" element={<RegisterWizard />} />
          <Route path="/collection" element={<CollectionWorklist />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/orders/:id/results" element={<ResultEntry />} />
          <Route path="/samples/:id" element={<SampleDetail />} />
          <Route path="/masters/tests" element={<MastersTests />} />
          <Route path="*" element={<Navigate to="/register" replace />} />
        </Routes>
      </main>
    </div>
  );
}
