import React from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Navigation } from '../../components/Navigation';

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            className="skeleton"
            style={{ width: '48px', height: '48px', borderRadius: '50%', margin: '0 auto 12px' }}
          />
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Verifying admin credentials...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="app-container">
      <Navigation />
      <main className="app-main-content">
        <Outlet />
      </main>
    </div>
  );
}
