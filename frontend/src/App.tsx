/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';

// Route-level code splitting with React.lazy
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Kiosk = lazy(() => import('./pages/Kiosk'));

const StudentLayout = lazy(() => import('./pages/student/StudentLayout'));
const DocumentsTab = lazy(() => import('./pages/student/DocumentsTab'));
const WalletTab = lazy(() => import('./pages/student/WalletTab'));
const PrintsTab = lazy(() => import('./pages/student/PrintsTab'));
const AccountTab = lazy(() => import('./pages/student/AccountTab'));

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const OverviewTab = lazy(() => import('./pages/admin/OverviewTab'));
const RechargesTab = lazy(() => import('./pages/admin/RechargesTab'));
const UsersTab = lazy(() => import('./pages/admin/UsersTab'));
const StationsTab = lazy(() => import('./pages/admin/StationsTab'));
const PricingTab = lazy(() => import('./pages/admin/PricingTab'));
const AuditTab = lazy(() => import('./pages/admin/AuditTab'));
const AdminAccountTab = lazy(() => import('./pages/admin/AccountTab'));

function LoadingFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          className="skeleton"
          style={{ width: '48px', height: '48px', borderRadius: '50%', margin: '0 auto 12px' }}
        />
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
          Loading Easy-Print...
        </div>
      </div>
    </div>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingFallback />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/app" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              {/* Root */}
              <Route path="/" element={<RootRedirect />} />

              {/* Public auth. The print station has its own address and is never linked from the portal */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/station" element={<Kiosk />} />
              <Route path="/kiosk" element={<Navigate to="/station" replace />} />

              {/* Student Portal */}
              <Route path="/app" element={<StudentLayout />}>
                <Route index element={<DocumentsTab />} />
                <Route path="wallet" element={<WalletTab />} />
                <Route path="prints" element={<PrintsTab />} />
                <Route path="account" element={<AccountTab />} />
              </Route>

              {/* Admin Portal */}
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<OverviewTab />} />
                <Route path="recharges" element={<RechargesTab />} />
                <Route path="users" element={<UsersTab />} />
                <Route path="stations" element={<StationsTab />} />
                <Route path="pricing" element={<PricingTab />} />
                <Route path="audit" element={<AuditTab />} />
                <Route path="account" element={<AdminAccountTab />} />
              </Route>

              {/* Catch all fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}