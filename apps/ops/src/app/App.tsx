import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { Layout } from '../components/Layout';
import { ToastProvider, ToastViewport } from '../components/Toast';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { HistoryPage } from '../pages/HistoryPage';
import { ProfilesPage } from '../pages/ProfilesPage';
import { ReviewsPage } from '../pages/ReviewsPage';
import { RunDetailPage } from '../pages/RunDetailPage';

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route element={<DashboardPage />} index />
            <Route element={<ConnectionsPage />} path="connections" />
            <Route element={<ReviewsPage />} path="reviews" />
            <Route element={<ProfilesPage />} path="profiles" />
            <Route element={<HistoryPage />} path="history" />
            <Route element={<RunDetailPage />} path="runs/:jobId" />
          </Route>
        </Routes>
      </BrowserRouter>
      <ToastViewport />
    </ToastProvider>
  );
}
