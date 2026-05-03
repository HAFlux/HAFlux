import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import DefaultLayout from '@/layouts/default';
import { useAuth } from '@/lib/auth';
import AccessGroupsPage from '@/pages/access-groups';
import BackupPage from '@/pages/backup';
import CertificatesPage from '@/pages/certificates';
import ClustersPage from '@/pages/clusters';
import DashboardPage from '@/pages/dashboard';
import ErrorPagesPage from '@/pages/error-pages';
import HelpPage from '@/pages/help';
import LoginPage from '@/pages/login';
import ProfilePage from '@/pages/profile';
import ProxyHostsPage from '@/pages/proxy-hosts';

function ProtectedShell() {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate replace to={`/login?next=${next}`} />;
  }
  return <DefaultLayout />;
}

function App() {
  return (
    <Routes>
      <Route element={<LoginPage />} path="/login" />
      <Route element={<ProtectedShell />}>
        <Route element={<Navigate replace to="/dashboard" />} index />
        <Route element={<DashboardPage />} path="/dashboard" />
        <Route element={<ProxyHostsPage />} path="/proxy-hosts" />
        <Route element={<ClustersPage />} path="/clusters" />
        <Route element={<CertificatesPage />} path="/certificates" />
        <Route element={<ErrorPagesPage />} path="/error-pages" />
        <Route element={<AccessGroupsPage />} path="/access-groups" />
        <Route element={<HelpPage />} path="/help" />
        <Route element={<BackupPage />} path="/backup" />
        <Route element={<ProfilePage />} path="/profile" />
      </Route>
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}

export default App;
