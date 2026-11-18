import React, { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { RechargeAdmin } from '../../lib/types';
import { formatPaise, formatDate } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import {
  IconWallet,
  IconCheck,
  IconX,
  IconRefresh,
  IconAlertTriangle,
} from '../../components/icons';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled';

export default function RechargesTab() {
  const { showToast } = useToast();
  const { refreshPendingCount } = useAuth();

  const [activeTab, setActiveTab] = useState<StatusFilter>('pending');
  const [recharges, setRecharges] = useState<RechargeAdmin[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Approve Modal state
  const [approvingItem, setApprovingItem] = useState<RechargeAdmin | null>(null);
  const [approveNote, setApproveNote] = useState('');
  const [isApproving, setIsApproving] = useState(false);

  // Reject Modal state
  const [rejectingItem, setRejectingItem] = useState<RechargeAdmin | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);

  const loadData = async (tab = activeTab) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listRecharges(tab, 50, 0);
      setRecharges(res.recharges);
      setTotalCount(res.total);
      refreshPendingCount();
    } catch (err: any) {
      setError(err.message || 'Unable to load recharge requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(activeTab);
  }, [activeTab]);

  const handleApprove = async () => {
    if (!approvingItem) return;
    setIsApproving(true);
    try {
      const updated = await api.approveRecharge(approvingItem.id, approveNote.trim() || undefined);
      showToast(`Approved ${formatPaise(updated.amount_paise)} for ${approvingItem.full_name}`, 'success');
      setApprovingItem(null);
      setApproveNote('');
      loadData(activeTab);
    } catch (err: any) {
      showToast(err.message || 'Approval failed', 'error');
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectingItem) return;
    if (!rejectReason.trim()) {
      setRejectError('Please specify the reason for rejecting this recharge payment.');
      return;
    }

    setIsRejecting(true);
    setRejectError(null);
    try {
      const updated = await api.rejectRecharge(rejectingItem.id, rejectReason.trim());
      showToast(`Rejected request for ${rejectingItem.full_name}`, 'info');
      setRejectingItem(null);
      setRejectReason('');
      loadData(activeTab);
    } catch (err: any) {
      setRejectError(err.message || 'Rejection failed');
    } finally {
      setIsRejecting(false);
    }
  };

  const getStatusBadge = (status: RechargeAdmin['status']) => {
    switch (status) {
      case 'pending':
        return <span className="status-badge status-badge-warning">Pending</span>;
      case 'approved':
        return <span className="status-badge status-badge-success">Approved</span>;
      case 'rejected':
        return <span className="status-badge status-badge-danger">Rejected</span>;
      case 'cancelled':
        return <span className="status-badge status-badge-neutral">Cancelled</span>;
      default:
        return <span className="status-badge status-badge-neutral">{status}</span>;
    }
  };

  return (
    <div className="content-wrapper">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Recharge Approvals</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Verify bank UPI reference numbers and credit student print wallets
          </p>
        </div>
        <button onClick={() => loadData(activeTab)} className="btn btn-secondary">
          <IconRefresh size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--border)',
          marginBottom: '24px',
          overflowX: 'auto',
          paddingBottom: '2px',
        }}
      >
        {(['all', 'pending', 'approved', 'rejected', 'cancelled'] as StatusFilter[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-ghost'}`}
            style={{
              padding: '8px 16px',
              fontSize: '0.85rem',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card skeleton" style={{ height: '60px' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load recharges</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
            {error}
          </div>
          <button onClick={() => loadData(activeTab)} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && recharges.length === 0 && (
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No recharge requests found under "{activeTab}" filter.
        </div>
      )}

      {!loading && !error && recharges.length > 0 && (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Submitted Date</th>
                <th>Student</th>
                <th>College ID</th>
                <th>Amount</th>
                <th>Payment Reference (UTR)</th>
                <th>Student Note</th>
                <th>Status</th>
                <th>Admin Decision</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recharges.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.created_at)}</td>
                  <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                  <td><code>{r.college_id}</code></td>
                  <td style={{ fontWeight: 800, color: 'var(--primary)' }}>
                    {formatPaise(r.amount_paise)}
                  </td>
                  <td><code>{r.reference}</code></td>
                  <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.note || '—'}
                  </td>
                  <td>{getStatusBadge(r.status)}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '180px' }}>
                    {r.decision_note ? (
                      <>
                        <div>{r.decision_note}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>
                          {formatDate(r.decided_at)}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.status === 'pending' ? (
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          onClick={() => {
                            setApprovingItem(r);
                            setApproveNote('');
                          }}
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            setRejectingItem(r);
                            setRejectReason('');
                            setRejectError(null);
                          }}
                          className="btn btn-danger"
                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Finalized</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve Modal */}
      {approvingItem && (
        <Modal
          isOpen={true}
          onClose={() => setApprovingItem(null)}
          title="Approve Wallet Credit"
          maxWidth="460px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setApprovingItem(null)}
                className="btn btn-secondary"
                disabled={isApproving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                className="btn btn-primary"
                disabled={isApproving}
              >
                {isApproving ? 'Crediting Wallet...' : 'Confirm Approval & Credit'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              style={{
                backgroundColor: 'var(--surface-elevated)',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div><strong>Student:</strong> {approvingItem.full_name} ({approvingItem.college_id})</div>
              <div><strong>Amount to Credit:</strong> <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{formatPaise(approvingItem.amount_paise)}</span></div>
              <div><strong>Reference / UTR:</strong> <code>{approvingItem.reference}</code></div>
            </div>

            <div>
              <label className="form-label">Optional Approval Note</label>
              <input
                type="text"
                className="input-control"
                placeholder="e.g. Bank credit matched"
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectingItem && (
        <Modal
          isOpen={true}
          onClose={() => setRejectingItem(null)}
          title="Reject Recharge Request"
          maxWidth="460px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setRejectingItem(null)}
                className="btn btn-secondary"
                disabled={isRejecting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="btn btn-danger"
                disabled={isRejecting}
              >
                {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '0.875rem' }}>
              Rejecting payment of <strong>{formatPaise(rejectingItem.amount_paise)}</strong> submitted by{' '}
              <strong>{rejectingItem.full_name}</strong> (Ref: {rejectingItem.reference}).
            </div>

            {rejectError && (
              <div className="status-badge-danger" style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
                {rejectError}
              </div>
            )}

            <div>
              <label className="form-label">Reason for Rejection (Required)</label>
              <textarea
                className="input-control"
                rows={3}
                placeholder="e.g. UTR reference not found on bank statement, or payment reversed"
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  setRejectError(null);
                }}
                required
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
