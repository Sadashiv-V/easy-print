import React, { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { UserAdmin, AdminWallet, Entry } from '../../lib/types';
import { formatPaise, formatDate } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import {
  IconUser,
  IconShield,
  IconWallet,
  IconRefresh,
  IconAlertTriangle,
  IconCheck,
  IconX,
} from '../../components/icons';

export default function UsersTab() {
  const { showToast } = useToast();

  const [users, setUsers] = useState<UserAdmin[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const limit = 15;

  // Block Modal state
  const [blockingUser, setBlockingUser] = useState<UserAdmin | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [isBlocking, setIsBlocking] = useState(false);

  // Unblock Modal state
  const [unblockingUser, setUnblockingUser] = useState<UserAdmin | null>(null);
  const [unblockReason, setUnblockReason] = useState('');
  const [isUnblocking, setIsUnblocking] = useState(false);

  // ── NEW: Reset Password Modal state ────────────────────────────────────────
  const [resettingUser, setResettingUser] = useState<UserAdmin | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');

  const [isResetting, setIsResetting] = useState(false);

  // Wallet Modal state
  const [selectedWalletUser, setSelectedWalletUser] = useState<UserAdmin | null>(null);
  const [adminWallet, setAdminWallet] = useState<AdminWallet | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(false);

  // Adjust Wallet state (inside modal)
  const [showAdjustForm, setShowAdjustForm] = useState(false);
  const [adjustAmountRupees, setAdjustAmountRupees] = useState('10');
  const [adjustKind, setAdjustKind] = useState<'recharge' | 'adjustment' | 'refund'>('adjustment');
  const [adjustSign, setAdjustSign] = useState<'+' | '-'>('+');
  const [adjustReason, setAdjustReason] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);

  // Refund Hold state (inside modal)
  const [refundingHoldId, setRefundingHoldId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [isRefunding, setIsRefunding] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listUsers(search, limit, page * limit);
      setUsers(res.users);
      setTotalUsers(res.total);
    } catch (err: any) {
      setError(err.message || 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [search, page]);

  const handleBlock = async () => {
    if (!blockingUser) return;
    if (!blockReason.trim()) {
      showToast('Please specify a reason for blocking.', 'error');
      return;
    }
    setIsBlocking(true);
    try {
      const updated = await api.blockUser(blockingUser.id, blockReason.trim());
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast(`Account ${updated.college_id} blocked.`, 'info');
      setBlockingUser(null);
      setBlockReason('');
    } catch (err: any) {
      showToast(err.message || 'Failed to block user', 'error');
    } finally {
      setIsBlocking(false);
    }
  };

  const handleUnblock = async () => {
    if (!unblockingUser) return;
    setIsUnblocking(true);
    try {
      const updated = await api.unblockUser(unblockingUser.id, unblockReason.trim() || 'Admin unblock');
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast(`Account ${updated.college_id} unblocked.`, 'success');
      setUnblockingUser(null);
      setUnblockReason('');
    } catch (err: any) {
      showToast(err.message || 'Failed to unblock user', 'error');
    } finally {
      setIsUnblocking(false);
    }
  };

  // ── NEW: Reset password handler ─────────────────────────────────────────────
  const handleResetPassword = async () => {
    if (!resettingUser) return;
    if (!resetNewPassword.trim()) {
      showToast('Please enter a new password.', 'error');
      return;
    }
    setIsResetting(true);
    try {
      await api.adminResetPassword(resettingUser.id, resetNewPassword);
      showToast(`Password reset for ${resettingUser.college_id}. They will need to log in again.`, 'success');
      setResettingUser(null);
      setResetNewPassword('');
    } catch (err: any) {
      showToast(err.message || 'Failed to reset password', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  const openWalletModal = async (u: UserAdmin) => {
    setSelectedWalletUser(u);
    setLoadingWallet(true);
    setShowAdjustForm(false);
    try {
      const w = await api.getAdminWallet(u.id);
      setAdminWallet(w);
    } catch (err: any) {
      showToast(err.message || 'Unable to load user wallet details', 'error');
    } finally {
      setLoadingWallet(false);
    }
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWalletUser || !adminWallet) return;

    const r = parseFloat(adjustAmountRupees);
    if (isNaN(r) || r <= 0) {
      showToast('Enter a valid amount in Rupees.', 'error');
      return;
    }
    if (!adjustReason.trim()) {
      showToast('Adjustment reason is required.', 'error');
      return;
    }

    const multiplier = adjustSign === '+' ? 1 : -1;
    const amountPaise = Math.round(r * 100) * multiplier;

    setIsAdjusting(true);
    try {
      const updated = await api.adjustWallet(selectedWalletUser.id, {
        amount_paise: amountPaise,
        kind: adjustKind,
        reason: adjustReason.trim(),
      });
      setAdminWallet(updated);
      setShowAdjustForm(false);
      setAdjustReason('');
      showToast('Wallet balance adjusted successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Adjustment failed', 'error');
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleRefundHold = async (holdId: string) => {
    if (!refundReason.trim()) {
      showToast('Please provide a reason to release the held funds.', 'error');
      return;
    }
    setIsRefunding(true);
    try {
      await api.refundHold(holdId, refundReason.trim());
      showToast('Held funds refunded back to balance', 'success');
      setRefundingHoldId(null);
      setRefundReason('');
      if (selectedWalletUser) {
        const w = await api.getAdminWallet(selectedWalletUser.id);
        setAdminWallet(w);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to refund hold', 'error');
    } finally {
      setIsRefunding(false);
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
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>User Management</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Lookup student accounts, inspect ledger balances, block abusers, and make manual credit adjustments
          </p>
        </div>
        <button onClick={loadUsers} className="btn btn-secondary">
          <IconRefresh size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Search Input */}
      <div style={{ marginBottom: '20px', maxWidth: '420px' }}>
        <input
          type="text"
          className="input-control"
          placeholder="Search by College ID or Student Name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="glass-card skeleton" style={{ height: '56px' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load users</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>{error}</div>
          <button onClick={loadUsers} className="btn btn-secondary">Retry</button>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No accounts matched "{search}".
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>College ID</th>
                  <th>Full Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Seen</th>
                  <th>Registered</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <code style={{ fontWeight: 700 }}>{u.college_id}</code>
                    </td>
                    <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                    <td>
                      <span className={`status-badge ${u.role === 'admin' ? 'status-badge-primary' : 'status-badge-neutral'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      {u.status === 'active' ? (
                        <span className="status-badge status-badge-success">Active</span>
                      ) : (
                        <span className="status-badge status-badge-danger" title={u.blocked_reason || ''}>
                          Blocked
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {formatDate(u.last_login_at)}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {formatDate(u.created_at)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          onClick={() => openWalletModal(u)}
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        >
                          <IconWallet size={14} />
                          <span>Wallet</span>
                        </button>

                        {u.role !== 'admin' && (
                          <>
                            {/* ── NEW: Reset Password button ── */}
                            <button
                              onClick={() => {
                                setResettingUser(u);
                                setResetNewPassword('');
                              }}
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                              title="Reset this user's password"
                            >
                              Reset pwd
                            </button>

                            {u.status === 'active' ? (
                              <button
                                onClick={() => { setBlockingUser(u); setBlockReason(''); }}
                                className="btn btn-danger"
                                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                              >
                                Block
                              </button>
                            ) : (
                              <button
                                onClick={() => { setUnblockingUser(u); setUnblockReason(''); }}
                                className="btn btn-secondary"
                                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                              >
                                Unblock
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalUsers > limit && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Page {page + 1}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * limit >= totalUsers}
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Block User Modal */}
      {blockingUser && (
        <Modal
          isOpen={true}
          onClose={() => setBlockingUser(null)}
          title={`Block User: ${blockingUser.full_name}`}
          maxWidth="460px"
          footer={
            <>
              <button type="button" onClick={() => setBlockingUser(null)} className="btn btn-secondary" disabled={isBlocking}>
                Cancel
              </button>
              <button type="button" onClick={handleBlock} className="btn btn-danger" disabled={isBlocking}>
                {isBlocking ? 'Blocking...' : 'Confirm Block'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '0.875rem' }}>
              Blocking <strong>{blockingUser.college_id}</strong> will immediately revoke access to both the student web portal and touch print kiosks.
            </div>
            <div>
              <label className="form-label">Justification / Reason (Required)</label>
              <textarea
                className="input-control"
                rows={3}
                placeholder="e.g. Repeated policy violation, unpaid dues, or suspicious activity"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                required
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Unblock User Modal */}
      {unblockingUser && (
        <Modal
          isOpen={true}
          onClose={() => setUnblockingUser(null)}
          title={`Unblock User: ${unblockingUser.full_name}`}
          maxWidth="460px"
          footer={
            <>
              <button type="button" onClick={() => setUnblockingUser(null)} className="btn btn-secondary" disabled={isUnblocking}>
                Cancel
              </button>
              <button type="button" onClick={handleUnblock} className="btn btn-primary" disabled={isUnblocking}>
                {isUnblocking ? 'Restoring...' : 'Restore Account'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '0.875rem' }}>
              Restore printing access for <strong>{unblockingUser.full_name} ({unblockingUser.college_id})</strong>.
            </div>
            <div>
              <label className="form-label">Admin Reason / Note</label>
              <input
                type="text"
                className="input-control"
                placeholder="e.g. Student rectified issue with department head"
                value={unblockReason}
                onChange={(e) => setUnblockReason(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* ── NEW: Reset Password Modal ─────────────────────────────────────────── */}
      {resettingUser && (
        <Modal
          isOpen={true}
          onClose={() => { setResettingUser(null); setResetNewPassword(''); }}
          title={`Reset Password: ${resettingUser.full_name}`}
          maxWidth="460px"
          footer={
            <>
              <button
                type="button"
                onClick={() => { setResettingUser(null); setResetNewPassword(''); }}
                className="btn btn-secondary"
                disabled={isResetting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPassword}
                className="btn btn-primary"
                disabled={isResetting}
              >
                {isResetting ? 'Resetting...' : 'Reset Password'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '0.875rem' }}>
              Set a new password for <strong>{resettingUser.college_id}</strong>.
              They will be signed out of any active session and must log in with the new password.
            </div>
            <div>
              <label className="form-label">New Password (min 8 characters)</label>
              <input
                type="password"
                className="input-control"
                placeholder="Enter new password"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* User Wallet Details & Ledger Modal */}
      {selectedWalletUser && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedWalletUser(null)}
          title={`Wallet: ${selectedWalletUser.full_name} (${selectedWalletUser.college_id})`}
          maxWidth="720px"
          footer={
            <button onClick={() => setSelectedWalletUser(null)} className="btn btn-secondary">
              Close
            </button>
          }
        >
          {loadingWallet || !adminWallet ? (
            <div className="skeleton" style={{ height: '160px' }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Wallet Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ backgroundColor: 'var(--surface-elevated)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Current Available Balance</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary)' }}>
                    {formatPaise(adminWallet.balance_paise)}
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--surface-elevated)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Held in Escrow</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                    {formatPaise(adminWallet.held_paise)}
                  </div>
                </div>
              </div>

              {/* Adjust Balance Action */}
              <div>
                {!showAdjustForm ? (
                  <button onClick={() => setShowAdjustForm(true)} className="btn btn-primary" style={{ fontSize: '0.825rem' }}>
                    Adjust Wallet Balance
                  </button>
                ) : (
                  <form
                    onSubmit={handleAdjustBalance}
                    style={{
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      padding: '16px',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Manual Balance Adjustment</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '10px' }}>
                      <div>
                        <label className="form-label">Sign</label>
                        <select className="input-control" value={adjustSign} onChange={(e) => setAdjustSign(e.target.value as any)}>
                          <option value="+">+ Credit</option>
                          <option value="-">- Debit</option>
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Amount (₹)</label>
                        <input
                          type="number" min={0.01} max={5000} step={0.01}
                          className="input-control"
                          value={adjustAmountRupees}
                          onChange={(e) => setAdjustAmountRupees(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label className="form-label">Ledger Kind</label>
                        <select className="input-control" value={adjustKind} onChange={(e) => setAdjustKind(e.target.value as any)}>
                          <option value="adjustment">Administrative Adjustment</option>
                          <option value="recharge">Manual Cash Recharge</option>
                          <option value="refund">Refund</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Audit Reason (Required)</label>
                      <input
                        type="text" className="input-control"
                        placeholder="e.g. Cash collected in library desk, or lab paper voucher"
                        value={adjustReason}
                        onChange={(e) => setAdjustReason(e.target.value)}
                        required
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <button type="button" onClick={() => setShowAdjustForm(false)} className="btn btn-secondary" disabled={isAdjusting}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={isAdjusting}>
                        {isAdjusting ? 'Posting...' : 'Apply Adjustment'}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Ledger Entries Table */}
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '8px' }}>
                  Transaction Ledger ({adminWallet.entries.length})
                </div>
                {adminWallet.entries.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No ledger transactions recorded.</div>
                ) : (
                  <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Kind</th>
                          <th>Amount</th>
                          <th>Balance</th>
                          <th>Note / Reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminWallet.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td>{formatDate(entry.created_at)}</td>
                            <td><span className="status-badge status-badge-neutral">{entry.kind}</span></td>
                            <td style={{ fontWeight: 700 }}>{formatPaise(entry.amount_paise)}</td>
                            <td>{formatPaise(entry.balance_after_paise)}</td>
                            <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              {entry.note || entry.reference || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}