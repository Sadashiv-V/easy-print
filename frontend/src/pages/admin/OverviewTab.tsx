import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import { StationWithKey, Reconcile, RechargeAdmin } from '../../lib/types';
import { formatPaise, formatDate, PRINTER_LABEL, printerNote } from '../../lib/utils';
import {
  IconShield,
  IconWallet,
  IconMonitor,
  IconCheck,
  IconAlertTriangle,
  IconRefresh,
  IconPrinter,
} from '../../components/icons';

export default function OverviewTab() {
  const [stations, setStations] = useState<StationWithKey[]>([]);
  const [reconcileData, setReconcileData] = useState<Reconcile | null>(null);
  const [pendingRecharges, setPendingRecharges] = useState<RechargeAdmin[]>([]);
  const [auditVerified, setAuditVerified] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const [stns, rec, rch, aud] = await Promise.all([
        api.listStations(),
        api.reconcile(),
        api.listRecharges('pending', 5, 0),
        api.verifyAudit(),
      ]);
      setStations(stns);
      setReconcileData(rec);
      setPendingRecharges(rch.recharges);
      setAuditVerified(aud.verified);
    } catch (err: any) {
      setError(err.message || 'Unable to load administration overview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const readyStationsCount = stations.filter((s) => s.status === 'active' && s.printer_status === 'online').length;

  return (
    <div className="content-wrapper">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>System Overview</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Campus print fleet health, pending cash inflows, and ledger audit invariants
          </p>
        </div>
        <button onClick={loadOverview} className="btn btn-secondary">
          <IconRefresh size={16} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card skeleton" style={{ height: '110px' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', borderColor: 'var(--danger-border)' }}>
          <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load admin overview</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>{error}</div>
          <button onClick={loadOverview} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && reconcileData && (
        <>
          {/* Key Metrics Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '28px',
            }}
          >
            {/* Pending Recharges Metric */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Pending Recharges
                </span>
                <span className="status-badge status-badge-warning">Action</span>
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text)' }}>
                {pendingRecharges.length}
              </div>
              <Link to="/admin/recharges" style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                Review approvals →
              </Link>
            </div>

            {/* Stations Ready Metric */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Stations Ready
                </span>
                <span className="status-badge status-badge-success">Fleet</span>
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text)' }}>
                {readyStationsCount} / {stations.length}
              </div>
              <Link to="/admin/stations" style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                Manage fleet hardware →
              </Link>
            </div>

            {/* Total Student Balances */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Total Student Funds
                </span>
                <span className="status-badge status-badge-neutral">Wallet</span>
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text)' }}>
                {formatPaise(reconcileData.total_balance_paise)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                across {reconcileData.wallets_checked} {reconcileData.wallets_checked === 1 ? 'wallet' : 'wallets'}
              </div>
            </div>

            {/* Ledger Integrity Status */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Ledger Invariants
                </span>
                <span
                  className={`status-badge ${reconcileData.mismatch_count === 0 ? 'status-badge-success' : 'status-badge-danger'
                    }`}
                >
                  {reconcileData.mismatch_count === 0 ? 'Consistent' : 'Mismatch'}
                </span>
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: reconcileData.mismatch_count === 0 ? 'var(--success)' : 'var(--danger)' }}>
                {reconcileData.mismatch_count === 0 ? '100% Valid' : `${reconcileData.mismatch_count} Anomalies`}
              </div>
              <Link to="/admin/audit" style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                View immutable audit →
              </Link>
            </div>
          </div>

          {/* Pending Approvals Quick List */}
          <div style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                Pending Wallet Approvals ({pendingRecharges.length})
              </h2>
              <Link to="/admin/recharges" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                Open All Recharges
              </Link>
            </div>

            {pendingRecharges.length === 0 ? (
              <div className="glass-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                All student payment requests have been reviewed. No pending approvals.
              </div>
            ) : (
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Student</th>
                      <th>College ID</th>
                      <th>Amount</th>
                      <th>Reference (UTR)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRecharges.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r.created_at)}</td>
                        <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                        <td><code>{r.college_id}</code></td>
                        <td style={{ fontWeight: 800, color: 'var(--primary)' }}>
                          {formatPaise(r.amount_paise)}
                        </td>
                        <td><code>{r.reference}</code></td>
                        <td><span className="status-badge status-badge-warning">Pending</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Station Fleet Summary */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                Print Station Fleet Overview
              </h2>
              <Link to="/admin/stations" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                Manage Fleet Keys & Printers
              </Link>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {stations.map((stn) => (
                <div key={stn.id} className="glass-panel" style={{ padding: '18px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{stn.name}</div>
                    <span
                      className={`status-badge ${stn.printer_status === 'online'
                          ? 'status-badge-success'
                          : stn.printer_status === 'no_paper' || stn.printer_status === 'unknown'
                            ? 'status-badge-warning'
                            : 'status-badge-danger'
                        }`}
                    >
                      {PRINTER_LABEL[stn.printer_status] || stn.printer_status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    {stn.location || 'Location unassigned'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-elevated)',
                      color: 'var(--text-subtle)',
                      lineHeight: 1.4,
                    }}
                  >
                    {printerNote(stn)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}