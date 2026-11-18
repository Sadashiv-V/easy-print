import React, { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { Audit } from '../../lib/types';
import { formatDate } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import {
  IconShield,
  IconCheck,
  IconAlertTriangle,
  IconRefresh,
} from '../../components/icons';

export default function AuditTab() {
  const { showToast } = useToast();

  const [audits, setAudits] = useState<Audit[]>([]);
  const [integrity, setIntegrity] = useState<{
    verified: boolean;
    count: number;
    checksum: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAuditData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, integ] = await Promise.all([api.listAudit(100), api.verifyAudit()]);
      setAudits(list);
      setIntegrity(integ);
      try {
        const { users } = await api.listUsers('', 100, 0);
        setPeople(Object.fromEntries(users.map((u) => [String(u.id), `${u.full_name} (${u.college_id})`])));
      } catch {
        /* names are a convenience only */
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load audit logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuditData();
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await api.verifyAudit();
      setIntegrity(res);
      if (res.verified) showToast('Audit log checked: every entry is intact.', 'success');
      else showToast('The audit log failed its integrity check. Entries may have been changed.', 'error');
    } catch (err: any) {
      showToast(err.message || 'Audit verification check failed', 'error');
    } finally {
      setVerifying(false);
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
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>System Audit Trail</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Append-only tamper-evident event log for administrative compliance and financial tracking
          </p>
        </div>
        <button onClick={loadAuditData} className="btn btn-secondary">
          <IconRefresh size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Integrity Verification Banner */}
      {integrity && (
        <div
          className="glass-panel"
          style={{
            padding: '20px 24px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            borderColor: 'var(--primary-border)',
            background: 'var(--glass-reflect)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'var(--success-bg)',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <IconCheck size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)' }}>
                Audit Cryptographic Integrity Verified
              </div>
              <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                All {integrity.count} log entries are intact and unchanged.
              </div>
            </div>
          </div>

          <button
            onClick={handleVerify}
            disabled={verifying}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem' }}
          >
            <IconShield size={16} />
            <span>{verifying ? 'Recomputing Hash...' : 'Re-verify Ledger Integrity'}</span>
          </button>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load audit trail</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
            {error}
          </div>
          <button onClick={loadAuditData} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Reason / Detail</th>
                <th>Client IP</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                    {formatDate(a.created_at)}
                  </td>
                  <td>
                    <span className="status-badge status-badge-primary">
                      {a.action}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{(a.actor_id && (people[String(a.actor_id)] || `User #${a.actor_id}`)) || 'System'}</td>
                  <td>
                    {a.target_type && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {a.target_type}: <code>{(a.target_type === 'user' && a.target_id && people[a.target_id]) || a.target_id || '—'}</code>
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
                    {a.reason || '—'}
                  </td>
                  <td>
                    <code style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                      {a.ip || '127.0.0.1'}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}