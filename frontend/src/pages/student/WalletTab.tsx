import React, { useState, useEffect, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import * as api from '../../lib/api';
import { Wallet, Entry, Recharge } from '../../lib/types';
import { formatPaise, formatDate, formatRelativeTime } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import {
  IconWallet,
  IconPlus,
  IconRefresh,
  IconCheck,
  IconAlertTriangle,
  IconX,
  IconCopy,
} from '../../components/icons';

const UPI_ID = ((import.meta.env.VITE_UPI_ID as string | undefined) || '').trim();
const UPI_NAME = ((import.meta.env.VITE_UPI_NAME as string | undefined) || '').trim();

function upiLink(amountRupees: string): string {
  const amount = Number(amountRupees);
  return (
    `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME || 'Easy-Print')}&cu=INR` +
    `${amount > 0 ? `&am=${amount.toFixed(2)}` : ''}&tn=${encodeURIComponent('Easy-Print wallet')}`
  );
}

function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export default function WalletTab() {
  const { showToast } = useToast();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [recharges, setRecharges] = useState<Recharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add Money Form State
  const [amountRupees, setAmountRupees] = useState<string>('100');
  const upiUrl = useMemo(() => (UPI_ID ? upiLink(amountRupees) : ''), [amountRupees]);
  const qrMarkup = useMemo(() => (upiUrl ? qrSvg(upiUrl) : ''), [upiUrl]);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submittingRecharge, setSubmittingRecharge] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Pagination for statement entries
  const [offset, setOffset] = useState(0);
  const limit = 10;
  const [loadingMore, setLoadingMore] = useState(false);

  // Cancel recharge modal state
  const [cancellingRecharge, setCancellingRecharge] = useState<Recharge | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, r, e] = await Promise.all([
        api.getWallet(),
        api.listMyRecharges(),
        api.listEntries(limit, 0),
      ]);
      setWallet(w);
      setRecharges(r);
      setEntries(e.entries);
      setTotalEntries(e.total);
      setOffset(0);
    } catch (err: any) {
      setError(err.message || 'Unable to load wallet data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleShowOlder = async () => {
    const nextOffset = offset + limit;
    setLoadingMore(true);
    try {
      const res = await api.listEntries(limit, nextOffset);
      setEntries((prev) => [...prev, ...res.entries]);
      setOffset(nextOffset);
    } catch (err: any) {
      showToast(err.message || 'Failed to load older entries', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCreateRecharge = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const rupees = parseFloat(amountRupees);
    if (isNaN(rupees) || rupees < 10 || rupees > 5000) {
      setFormError('Amount must be between ₹10.00 and ₹5,000.00.');
      return;
    }

    if (!reference.trim() || reference.trim().length < 6) {
      setFormError('Please enter a valid UPI reference or transaction ID (minimum 6 digits/letters).');
      return;
    }

    setSubmittingRecharge(true);
    try {
      const amountPaise = Math.round(rupees * 100);
      const newRec = await api.createRecharge({
        amount_paise: amountPaise,
        reference: reference.trim(),
        note: note.trim() || null,
      });

      setRecharges((prev) => [newRec, ...prev]);
      setReference('');
      setNote('');
      showToast('Recharge request submitted for approval', 'success');
    } catch (err: any) {
      setFormError(err.message || 'Failed to submit recharge request.');
    } finally {
      setSubmittingRecharge(false);
    }
  };

  const handleCancelRecharge = async () => {
    if (!cancellingRecharge) return;
    setIsCancelling(true);
    try {
      const updated = await api.cancelRecharge(cancellingRecharge.id);
      setRecharges((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      showToast('Recharge request cancelled', 'info');
      setCancellingRecharge(null);
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel request', 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  const getEntryBadge = (kind: Entry['kind']) => {
    switch (kind) {
      case 'recharge':
        return <span className="status-badge status-badge-success">Recharge</span>;
      case 'capture':
        return <span className="status-badge status-badge-neutral">Print paid</span>;
      case 'refund':
        return <span className="status-badge status-badge-primary">Refund</span>;
      case 'adjustment':
        return <span className="status-badge status-badge-primary">Adjustment</span>;
      case 'hold':
        return <span className="status-badge status-badge-warning">Held</span>;
      case 'release':
        return <span className="status-badge status-badge-neutral">Returned</span>;
      default:
        return <span className="status-badge status-badge-neutral">{kind}</span>;
    }
  };

  const describeEntry = (e: Entry): string => {
    const m = /^job:(\d+)$/.exec(e.reference || '');
    const order = m ? `print order #${m[1]}` : null;
    switch (e.kind) {
      case 'hold':
        return order ? `Held for ${order}` : 'Held for a print order';
      case 'release':
        return order ? `Returned: ${order} was cancelled or not printed` : 'Held amount returned';
      case 'capture':
        return order ? `Paid for ${order}` : 'Paid for a print order';
      default:
        return e.note || e.reference || '—';
    }
  };

  const getRechargeStatusBadge = (status: Recharge['status']) => {
    switch (status) {
      case 'pending':
        return <span className="status-badge status-badge-warning">Pending Approval</span>;
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
      {/* Header */}
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
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Print Wallet</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Add balance using UPI and track statement of print deductions
          </p>
        </div>
        <button onClick={loadData} className="btn btn-secondary" title="Refresh balances">
          <IconRefresh size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          <div className="glass-card skeleton" style={{ height: '120px' }} />
          <div className="glass-card skeleton" style={{ height: '120px' }} />
        </div>
      )}

      {error && (
        <div
          className="glass-panel"
          style={{ padding: '32px', textAlign: 'center', borderColor: 'var(--danger-border)' }}
        >
          <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load wallet data</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
            {error}
          </div>
          <button onClick={loadData} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && wallet && (
        <>
          {/* Balance Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
              marginBottom: '28px',
            }}
          >
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                }}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Available Balance
                </span>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--primary-subtle)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconWallet size={18} />
                </div>
              </div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                {formatPaise(wallet.balance_paise)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                Ready to spend at any campus kiosk
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '24px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                }}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Held Funds (Active Jobs)
                </span>
                <span className="status-badge status-badge-neutral">Escrow</span>
              </div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '-0.02em' }}>
                {formatPaise(wallet.held_paise)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                Temporary holds during active printing
              </div>
            </div>
          </div>

          {/* Add Money Request Form */}
          <div className="glass-panel" style={{ padding: '28px', marginBottom: '32px' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
                Request Wallet Recharge
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                Pay via college UPI, enter the transaction reference, and the campus administrator will approve your credit.
              </p>
            </div>

            {/* Payment details come from the college's own settings (VITE_UPI_ID). Nothing is shown if unset. */}
            {UPI_ID ? (
              <div
                style={{
                  backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  marginBottom: '20px',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  Pay to UPI ID: <code style={{ color: 'var(--primary)', fontWeight: 800 }}>{UPI_ID}</code>
                  {UPI_NAME && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> ({UPI_NAME})</span>}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 12px' }}>
                  Pay with any UPI app, then enter the transaction reference (UTR) below so the admin can find your payment.
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
                  <div
                    role="img"
                    aria-label={`UPI QR code for ${UPI_ID}${Number(amountRupees) > 0 ? `, amount ${Number(amountRupees).toFixed(2)} rupees` : ''}`}
                    style={{ width: '168px', height: '168px', background: '#ffffff', borderRadius: '12px', padding: '6px', flex: 'none' }}
                    dangerouslySetInnerHTML={{ __html: qrMarkup }}
                  />
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flex: 1, minWidth: '180px' }}>
                    Scan with GPay, PhonePe, Paytm or BHIM. The amount you typed below is filled in for you. Check the amount and the name
                    {UPI_NAME ? ` (${UPI_NAME})` : ''} in your app before paying.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <a className="btn btn-primary" style={{ textDecoration: 'none' }} href={upiUrl}>
                    Open UPI app
                  </a>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => navigator.clipboard.writeText(UPI_ID).then(() => showToast('UPI ID copied', 'success'), () => showToast('Select the ID and copy it manually', 'error'))}
                  >
                    Copy UPI ID
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                Ask the print counter how to pay. After paying, enter the payment reference below.
              </div>
            )}

            {formError && (
              <div
                className="status-badge-danger"
                style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', display: 'block' }}
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateRecharge} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Amount & presets */}
              <div>
                <label className="form-label" htmlFor="amount-input">
                  Amount to Recharge (₹10 – ₹5,000)
                </label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        fontWeight: 700,
                      }}
                    >
                      ₹
                    </span>
                    <input
                      id="amount-input"
                      type="number"
                      min={10}
                      max={5000}
                      step={1}
                      className="input-control"
                      value={amountRupees}
                      onChange={(e) => setAmountRupees(e.target.value)}
                      required
                      style={{ paddingLeft: '28px', fontSize: '1rem', fontWeight: 700 }}
                    />
                  </div>
                  {/* Preset quick buttons */}
                  {[50, 100, 200, 500].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmountRupees(preset.toString())}
                      className="btn btn-secondary"
                      style={{ padding: '8px 12px', fontSize: '0.8rem' }}
                    >
                      +₹{preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reference */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                <div>
                  <label className="form-label" htmlFor="ref-input">
                    UPI Reference / UTR Number
                  </label>
                  <input
                    id="ref-input"
                    type="text"
                    className="input-control"
                    placeholder="e.g. UPI/409817264819"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    required
                  />
                  <div className="form-help">Found in your payment app under transaction details.</div>
                </div>

                <div>
                  <label className="form-label" htmlFor="note-input">
                    Optional Note
                  </label>
                  <input
                    id="note-input"
                    type="text"
                    className="input-control"
                    placeholder="e.g. Lab report print quota"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={submittingRecharge}
                style={{ alignSelf: 'flex-start', marginTop: '6px' }}
              >
                <IconPlus size={18} />
                <span>{submittingRecharge ? 'Submitting...' : 'Submit Recharge Request'}</span>
              </button>
            </form>
          </div>

          {/* Recharge Requests Section */}
          <div style={{ marginBottom: '36px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '14px' }}>
              My Recharge Requests
            </h2>

            {recharges.length === 0 ? (
              <div className="glass-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No recharge requests submitted yet.
              </div>
            ) : (
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Reference</th>
                      <th>Status</th>
                      <th>Admin Note</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recharges.map((rec) => (
                      <tr key={rec.id}>
                        <td>{formatDate(rec.created_at)}</td>
                        <td style={{ fontWeight: 700 }}>{formatPaise(rec.amount_paise)}</td>
                        <td>
                          <code style={{ fontSize: '0.8rem' }}>{rec.reference}</code>
                        </td>
                        <td>{getRechargeStatusBadge(rec.status)}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          {rec.decision_note || '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {rec.status === 'pending' && (
                            <button
                              onClick={() => setCancellingRecharge(rec)}
                              className="btn btn-danger"
                              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Statement / Ledger Section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                Wallet Statement
              </h2>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                Showing {entries.length} entries
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="glass-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No wallet transactions recorded yet.
              </div>
            ) : (
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Balance After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const amt = entry.amount_paise;
                      return (
                        <tr key={entry.id}>
                          <td>{formatDate(entry.created_at)}</td>
                          <td>{getEntryBadge(entry.kind)}</td>
                          <td style={{ maxWidth: '280px' }}>
                            <div style={{ fontSize: '0.85rem' }}>{describeEntry(entry)}</div>
                            {entry.reference && entry.reference !== entry.note && !/^job:/.test(entry.reference) && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                                Ref: {entry.reference}
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              fontWeight: 700,
                              color: amt > 0 ? 'var(--success)' : amt < 0 ? 'var(--danger)' : 'var(--text-subtle)',
                            }}
                          >
                            {amt === 0 ? '—' : `${amt > 0 ? '+' : '−'}${formatPaise(Math.abs(amt))}`}
                          </td>
                          <td style={{ fontWeight: 600 }}>{formatPaise(entry.balance_after_paise)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Show Older Button */}
            {entries.length < totalEntries && (
              <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <button
                  onClick={handleShowOlder}
                  disabled={loadingMore}
                  className="btn btn-secondary"
                  style={{ minWidth: '160px' }}
                >
                  {loadingMore ? 'Loading statement...' : 'Show Older Transactions'}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Cancel Recharge Confirmation Modal */}
      {cancellingRecharge && (
        <Modal
          isOpen={true}
          onClose={() => setCancellingRecharge(null)}
          title="Cancel Recharge Request"
          maxWidth="440px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setCancellingRecharge(null)}
                className="btn btn-secondary"
                disabled={isCancelling}
              >
                Keep Request
              </button>
              <button
                type="button"
                onClick={handleCancelRecharge}
                className="btn btn-danger"
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.5 }}>
            Are you sure you want to cancel the pending recharge request of{' '}
            <strong>{formatPaise(cancellingRecharge.amount_paise)}</strong> (Ref: {cancellingRecharge.reference})?
          </div>
        </Modal>
      )}
    </div>
  );
}