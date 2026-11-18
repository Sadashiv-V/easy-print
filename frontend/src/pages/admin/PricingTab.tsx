import React, { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { Pricing, PricingHistory } from '../../lib/types';
import { formatPaise, formatDate } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import {
  IconDocument,
  IconRefresh,
  IconAlertTriangle,
  IconCheck,
} from '../../components/icons';

export default function PricingTab() {
  const { showToast } = useToast();

  const [currentPricing, setCurrentPricing] = useState<Pricing | null>(null);
  const [history, setHistory] = useState<PricingHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form edit states
  const [bwRupees, setBwRupees] = useState('1.00');
  const [colorRupees, setColorRupees] = useState('5.00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadPricingData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, h] = await Promise.all([api.getPricing(), api.pricingHistory()]);
      setCurrentPricing(p);
      setHistory(h);
      setBwRupees((p.bw_paise_per_page / 100).toFixed(2));
      setColorRupees((p.color_paise_per_page / 100).toFixed(2));
    } catch (err: any) {
      setError(err.message || 'Unable to load pricing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPricingData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const bwVal = parseFloat(bwRupees);
    const colorVal = parseFloat(colorRupees);

    if (isNaN(bwVal) || bwVal < 0.1 || isNaN(colorVal) || colorVal < 0.1) {
      setFormError('Rates must be at least ₹0.10 (10 paise) per page.');
      return;
    }

    if (!reason.trim()) {
      setFormError('A reason is mandatory for any pricing modification.');
      return;
    }

    setSaving(true);
    try {
      const bwPaise = Math.round(bwVal * 100);
      const colorPaise = Math.round(colorVal * 100);
      const updated = await api.setPricing({
        bw: bwPaise,
        color: colorPaise,
        reason: reason.trim(),
      });
      setCurrentPricing(updated);
      showToast('Campus print rates successfully updated', 'success');
      setReason('');
      const updatedHistory = await api.pricingHistory();
      setHistory(updatedHistory);
    } catch (err: any) {
      setFormError(err.message || 'Failed to update pricing');
    } finally {
      setSaving(false);
    }
  };

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
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Print Rates & Pricing</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Configure per-page charges for black & white and full color printing across all campus kiosks
          </p>
        </div>
        <button onClick={loadPricingData} className="btn btn-secondary">
          <IconRefresh size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          <div className="glass-card skeleton" style={{ height: '140px' }} />
          <div className="glass-card skeleton" style={{ height: '140px' }} />
        </div>
      )}

      {!loading && error && (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load pricing</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
            {error}
          </div>
          <button onClick={loadPricingData} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && currentPricing && (
        <>
          {/* Active Pricing Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
              marginBottom: '28px',
            }}
          >
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                Active Black & White Rate
              </div>
              <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--text)', marginTop: '4px' }}>
                {formatPaise(currentPricing.bw_paise_per_page)}
                <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)' }}> / page</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                Charged for each printed page, black and white
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                Active Full Color Rate
              </div>
              <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--primary)', marginTop: '4px' }}>
                {formatPaise(currentPricing.color_paise_per_page)}
                <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)' }}> / page</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                Charged for each printed page, colour
              </div>
            </div>
          </div>

          {/* Update Pricing Rates Form */}
          <div className="glass-panel" style={{ padding: '28px', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 4px 0' }}>
              Modify Campus Print Rates
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px' }}>
              All rate updates are recorded in the immutable audit trail with administrative justification.
            </p>

            {formError && (
              <div className="status-badge-danger" style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' }}>
                {formError}
              </div>
            )}

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div>
                  <label className="form-label">Black & White Rate (₹ per page)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100.00"
                    className="input-control"
                    value={bwRupees}
                    onChange={(e) => setBwRupees(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="form-label">Color Rate (₹ per page)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100.00"
                    className="input-control"
                    value={colorRupees}
                    onChange={(e) => setColorRupees(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Administrative Reason (Required for Audit)</label>
                <input
                  type="text"
                  className="input-control"
                  placeholder="e.g. Annual toner subsidy approval by Dean of Student Welfare"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
                style={{ alignSelf: 'flex-start', padding: '10px 20px' }}
              >
                {saving ? 'Recording changes...' : 'Save & Publish Rates'}
              </button>
            </form>
          </div>

          {/* Pricing History Table */}
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '14px' }}>
              Pricing Revision History
            </h2>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Effective Date</th>
                    <th>B&W Rate</th>
                    <th>Color Rate</th>
                    <th>Updated By</th>
                    <th>Authorized Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item, index) => (
                    <tr key={item.id || index}>
                      <td>{formatDate(item.created_at)}</td>
                      <td style={{ fontWeight: 700 }}>{formatPaise(item.bw_paise_per_page)}</td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {formatPaise(item.color_paise_per_page)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.created_by ? `Admin #${item.created_by}` : 'System'}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {item.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}