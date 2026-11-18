import React, { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { Job } from '../../lib/types';
import { formatPaise, formatDate, formatRelativeTime } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import {
  IconPrinter,
  IconRefresh,
  IconCheck,
  IconAlertTriangle,
  IconX,
  IconDocument,
} from '../../components/icons';

export default function PrintsTab() {
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const list = await api.listMyJobs(30);
      setJobs(list);
    } catch (err: any) {
      if (!silent) {
        setError(err.message || 'Unable to load print jobs');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  // Auto-refresh while active jobs exist (queued or printing)
  useEffect(() => {
    const hasActiveJob = jobs.some((j) => j.status === 'queued' || j.status === 'printing');
    if (!hasActiveJob) return;

    const interval = setInterval(() => {
      fetchJobs(true);
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs]);

  const getJobStatusBadge = (status: Job['status']) => {
    switch (status) {
      case 'queued':
        return <span className="status-badge status-badge-warning">Queued</span>;
      case 'printing':
        return (
          <span className="status-badge status-badge-primary">
            <span className="status-dot" style={{ animation: 'skeleton-shimmer 1s infinite' }} />
            Printing Now
          </span>
        );
      case 'completed':
        return <span className="status-badge status-badge-success">Completed</span>;
      case 'partial':
        return <span className="status-badge status-badge-warning">Partly printed</span>;
      case 'failed':
        return <span className="status-badge status-badge-danger">Failed</span>;
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
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Print Activity</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Live status of your documents released at campus touch kiosks
          </p>
        </div>
        <button onClick={() => fetchJobs()} className="btn btn-secondary">
          <IconRefresh size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card skeleton" style={{ height: '110px' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load print records</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
            {error}
          </div>
          <button onClick={() => fetchJobs()} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="glass-panel" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
            }}
          >
            <IconPrinter size={28} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0' }}>
            No print jobs executed yet
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: '420px', margin: '0 auto' }}>
            When you visit any campus print kiosk and print your documents, live tracking and receipts
            will appear here.
          </p>
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {jobs.map((job) => (
            <div key={job.id} className="glass-panel" style={{ padding: '20px 24px' }}>
              {/* Job Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: '12px',
                  marginBottom: '14px',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-elevated)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--primary)',
                    }}
                  >
                    <IconPrinter size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      {`Order #${job.id}`}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                      Started {formatDate(job.created_at)} · {formatRelativeTime(job.created_at)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {(() => {
                    const charged = job.items.filter((i) => i.status === 'done').reduce((sum, i) => sum + i.price_paise, 0);
                    if (job.status === 'queued' || job.status === 'printing') {
                      return (
                        <span style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>{formatPaise(job.total_paise)}</span>
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-subtle)' }}>held until printed</span>
                        </span>
                      );
                    }
                    if (charged === 0) {
                      return <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-muted)' }}>Not charged</span>;
                    }
                    return (
                      <span style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>{formatPaise(charged)}</span>
                        <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-subtle)' }}>charged</span>
                      </span>
                    );
                  })()}
                  {getJobStatusBadge(job.status)}
                </div>
              </div>

              {/* Items List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {job.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: 'var(--surface-elevated)',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.85rem',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconDocument size={16} style={{ color: 'var(--text-muted)' }} />
                      <span style={{ fontWeight: 600 }}>{item.document_name}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {item.copies} {item.copies === 1 ? 'copy' : 'copies'} · {item.selected_pages} pp ·{' '}
                        {item.color_mode.toUpperCase()} · {item.duplex ? 'Duplex' : '1-Sided'}
                      </span>
                      {item.status === 'done' ? (
                        <span style={{ fontWeight: 700 }}>{formatPaise(item.price_paise)}</span>
                      ) : item.status === 'failed' || item.status === 'cancelled' ? (
                        <span style={{ fontWeight: 600, color: item.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {item.status === 'failed' ? 'Not printed. Not charged' : 'Not charged'}
                        </span>
                      ) : (
                        <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{formatPaise(item.price_paise)} held</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {job.failure_reason && (
                <div
                  className="status-badge-danger"
                  style={{ marginTop: '12px', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}
                >
                  Failure notice: {job.failure_reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}