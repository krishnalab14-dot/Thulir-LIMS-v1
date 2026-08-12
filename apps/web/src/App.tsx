import { Navigate, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { MastersTests } from './pages/MastersTests';
import { Orders } from './pages/Orders';
import { RegisterWizard } from './pages/RegisterWizard';

export function App() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <Routes>
          <Route path="/" element={<Navigate to="/register" replace />} />
          <Route path="/register" element={<RegisterWizard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/masters/tests" element={<MastersTests />} />
          <Route path="*" element={<Navigate to="/register" replace />} />
        </Routes>
      </main>
    </div>
  );
}
