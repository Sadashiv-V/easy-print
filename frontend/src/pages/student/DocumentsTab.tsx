import React, { useState, useEffect, useRef } from 'react';
import * as api from '../../lib/api';
import { Doc, Pricing } from '../../lib/types';
import { formatPaise, formatBytes, formatDate, daysLeftUntil, parsePageRange } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import {
  IconDocument,
  IconUpload,
  IconSettings,
  IconTrash,
  IconEye,
  IconCheck,
  IconAlertTriangle,
  IconRefresh,
  IconX,
} from '../../components/icons';

interface UploadRow {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  errorMessage?: string;
}

export default function DocumentsTab() {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload rows state
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Default print settings state
  const [defaultColor, setDefaultColor] = useState<'bw' | 'color'>('bw');
  const [defaultDuplex, setDefaultDuplex] = useState(false);
  const [defaultCopies, setDefaultCopies] = useState(1);

  // Settings Modal state
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null);
  const [modalColor, setModalColor] = useState<'bw' | 'color'>('bw');
  const [modalDuplex, setModalDuplex] = useState(false);
  const [modalCopies, setModalCopies] = useState(1);
  const [modalPageRanges, setModalPageRanges] = useState('all');
  const [modalRangeError, setModalRangeError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // View Preview Modal state
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!previewDoc) return;
    let url: string | null = null;
    let cancelled = false;
    setPreviewUrl(null);
    setPreviewError(null);
    api
      .previewDocument(previewDoc.id)
      .then((r) => {
        url = r.url;
        if (cancelled) URL.revokeObjectURL(r.url);
        else setPreviewUrl(r.url);
      })
      .catch((e: any) => !cancelled && setPreviewError(e?.message || 'Could not load the document.'));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewDoc]);

  // Delete Confirm Modal state
  const [deletingDoc, setDeletingDoc] = useState<Doc | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedDocs, fetchedPricing] = await Promise.all([
        api.listDocuments(),
        api.getPricing(),
      ]);
      setDocs(fetchedDocs);
      setPricing(fetchedPricing);
    } catch (err: any) {
      setError(err.message || 'Unable to load documents. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const newUploads: UploadRow[] = files.map((f) => ({
      id: Math.random().toString(36).substring(2, 9),
      name: f.name,
      size: f.size,
      progress: 10,
      status: 'uploading',
    }));

    setUploadRows((prev) => [...prev, ...newUploads]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const uploadId = newUploads[i].id;

      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        setUploadRows((prev) =>
          prev.map((row) =>
            row.id === uploadId
              ? { ...row, status: 'error', errorMessage: 'Only PDF documents allowed' }
              : row
          )
        );
        continue;
      }

      // Simulate progress ticks
      setUploadRows((prev) =>
        prev.map((r) => (r.id === uploadId ? { ...r, progress: 60 } : r))
      );

      try {
        const createdDoc = await api.uploadDocument(file, {
          color_mode: defaultColor,
          duplex: defaultDuplex,
          copies: defaultCopies,
        });

        setUploadRows((prev) =>
          prev.map((r) => (r.id === uploadId ? { ...r, progress: 100, status: 'completed' } : r))
        );
        setDocs((prev) => [createdDoc, ...prev]);
        showToast(`Uploaded "${file.name}" successfully`, 'success');
      } catch (err: any) {
        setUploadRows((prev) =>
          prev.map((r) =>
            r.id === uploadId
              ? { ...r, status: 'error', errorMessage: err.message || 'Upload failed' }
              : r
          )
        );
      }
    }
  };

  const removeUploadRow = (id: string) => {
    setUploadRows((prev) => prev.filter((r) => r.id !== id));
  };

  const openSettings = (doc: Doc) => {
    setEditingDoc(doc);
    setModalColor(doc.color_mode);
    setModalDuplex(doc.duplex);
    setModalCopies(doc.copies);
    setModalPageRanges(doc.page_ranges);
    setModalRangeError(null);
  };

  const handleSaveSettings = async () => {
    if (!editingDoc) return;
    const rangeCheck = parsePageRange(modalPageRanges, editingDoc.page_count);
    if (!rangeCheck.valid) {
      setModalRangeError(rangeCheck.error || 'Invalid range format.');
      return;
    }

    setSavingSettings(true);
    try {
      const updated = await api.updateDocumentSettings(editingDoc.id, {
        color_mode: modalColor,
        duplex: modalDuplex,
        copies: modalCopies,
        page_ranges: modalPageRanges,
      });
      setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      showToast('Document print settings saved', 'success');
      setEditingDoc(null);
    } catch (err: any) {
      setModalRangeError(err.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteDoc = async () => {
    if (!deletingDoc) return;
    setIsDeleting(true);
    try {
      await api.deleteDocument(deletingDoc.id);
      setDocs((prev) => prev.filter((d) => d.id !== deletingDoc.id));
      showToast(`Deleted "${deletingDoc.original_name}"`, 'info');
      setDeletingDoc(null);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete document', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="content-wrapper">
      {/* Top Header */}
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
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>My Documents</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Upload PDFs from your device and customize print options before heading to any kiosk
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={loadData} className="btn btn-secondary" title="Refresh document list">
            <IconRefresh size={16} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-primary"
          >
            <IconUpload size={16} />
            <span>Upload PDF</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Default Print Settings Panel */}
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconSettings size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              Default Print Settings for New Uploads
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Rates: B&W {pricing ? formatPaise(pricing.bw_paise_per_page) : '₹1.00'}/page · Color{' '}
              {pricing ? formatPaise(pricing.color_paise_per_page) : '₹5.00'}/page
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Color Mode Radio */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Ink:</span>
            <button
              onClick={() => setDefaultColor('bw')}
              className={`btn ${defaultColor === 'bw' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
            >
              B&W
            </button>
            <button
              onClick={() => setDefaultColor('color')}
              className={`btn ${defaultColor === 'color' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
            >
              Color
            </button>
          </div>

          {/* Duplex Toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={defaultDuplex}
              onChange={(e) => setDefaultDuplex(e.target.checked)}
              style={{ accentColor: 'var(--primary)' }}
            />
            <span>2-Sided (Duplex)</span>
          </label>

          {/* Copies Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Copies:</span>
            <input
              type="number"
              min={1}
              max={100}
              value={defaultCopies}
              onChange={(e) => setDefaultCopies(Math.max(1, parseInt(e.target.value) || 1))}
              className="input-control"
              style={{ width: '64px', padding: '4px 8px', fontSize: '0.8rem' }}
            />
          </div>
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? 'var(--primary)' : 'var(--border-strong)'}`,
          backgroundColor: isDragging ? 'var(--primary-subtle)' : 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '24px',
          transition: 'all 0.15s ease',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'var(--surface-elevated)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px',
            color: 'var(--primary)',
          }}
        >
          <IconUpload size={24} />
        </div>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>
          Drop PDF files here, or click to browse
        </div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          PDF files only, up to 20 MB and 200 pages each. Kept for 14 days.
        </div>
      </div>

      {/* Live Upload Progress Rows */}
      {uploadRows.length > 0 && (
        <div style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-subtle)' }}>
            Recent Uploads
          </div>
          {uploadRows.map((row) => (
            <div
              key={row.id}
              className="glass-card"
              style={{
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                <IconDocument size={18} style={{ color: 'var(--primary)' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                    {formatBytes(row.size)}
                  </div>
                </div>
              </div>

              {row.status === 'uploading' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '120px',
                      height: '6px',
                      background: 'var(--surface-hover)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${row.progress}%`,
                        height: '100%',
                        background: 'var(--primary)',
                        transition: 'width 0.2s',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {row.progress}%
                  </span>
                </div>
              )}

              {row.status === 'completed' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="status-badge status-badge-success">Ready</span>
                  <button
                    onClick={() => removeUploadRow(row.id)}
                    className="btn btn-ghost"
                    style={{ padding: '4px' }}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              )}

              {row.status === 'error' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="status-badge status-badge-danger">
                    {row.errorMessage || 'Failed'}
                  </span>
                  <button
                    onClick={() => removeUploadRow(row.id)}
                    className="btn btn-ghost"
                    style={{ padding: '4px' }}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="glass-card"
              style={{ padding: '20px', display: 'flex', gap: '16px', alignItems: 'center' }}
            >
              <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '8px' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="skeleton" style={{ width: '60%', height: '16px' }} />
                <div className="skeleton" style={{ width: '30%', height: '12px' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State with Retry */}
      {!loading && error && (
        <div
          className="glass-panel"
          style={{
            padding: '32px',
            textAlign: 'center',
            borderColor: 'var(--danger-border)',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
            }}
          >
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '6px' }}>
            Unable to load documents
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
            {error}
          </div>
          <button onClick={loadData} className="btn btn-secondary">
            <IconRefresh size={16} />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && docs.length === 0 && (
        <div
          className="glass-panel"
          style={{
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
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
            <IconDocument size={28} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0' }}>
            No print documents queued
          </h2>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '0.875rem',
              maxWidth: '420px',
              margin: '0 auto 20px',
            }}
          >
            Upload your assignments, lab reports, or resumes above. You can print them at any kiosk
            on campus using your Student ID and PIN.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-primary"
          >
            <IconUpload size={16} />
            <span>Upload Your First PDF</span>
          </button>
        </div>
      )}

      {/* Documents List */}
      {!loading && !error && docs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {docs.map((doc) => {
            const daysLeft = daysLeftUntil(doc.expires_at);
            return (
              <div
                key={doc.id}
                className="glass-panel"
                style={{
                  padding: '18px 22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  flexWrap: 'wrap',
                }}
              >
                {/* File info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: '240px', flex: 1 }}>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: 'var(--radius-md)',
                      background: doc.color_mode === 'color' ? 'rgba(236,72,153,0.12)' : 'var(--surface-elevated)',
                      border: `1px solid ${doc.color_mode === 'color' ? 'rgba(236,72,153,0.3)' : 'var(--border)'}`,
                      color: doc.color_mode === 'color' ? '#ec4899' : 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <IconDocument size={22} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={doc.original_name}
                    >
                      {doc.original_name}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.775rem',
                        color: 'var(--text-muted)',
                        marginTop: '3px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>{formatBytes(doc.size_bytes)}</span>
                      <span>·</span>
                      <span>{doc.page_count} total pages</span>
                      <span>·</span>
                      <span>Uploaded {formatDate(doc.created_at)}</span>
                      <span>·</span>
                      <span style={{ color: daysLeft <= 2 ? 'var(--warning)' : 'var(--text-subtle)' }}>
                        {daysLeft} days left
                      </span>
                    </div>
                  </div>
                </div>

                {/* Print Specs & Indicators */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      className={`status-badge ${doc.color_mode === 'color' ? 'status-badge-primary' : 'status-badge-neutral'
                        }`}
                    >
                      {doc.color_mode === 'color' ? 'Color' : 'B&W'}
                    </span>
                    <span className="status-badge status-badge-neutral">
                      {doc.duplex ? '2-Sided' : '1-Sided'}
                    </span>
                    <span className="status-badge status-badge-neutral">
                      {doc.copies} {doc.copies === 1 ? 'copy' : 'copies'}
                    </span>
                    <span className="status-badge status-badge-neutral">
                      {doc.selected_pages} {doc.selected_pages === 1 ? 'page' : 'pages'}
                    </span>
                  </div>

                  <div style={{ textAlign: 'right', minWidth: '85px' }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary)' }}>
                      {formatPaise(doc.estimated_price_paise)}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>
                      {formatPaise(doc.rate_paise_per_page)}/page
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setPreviewDoc(doc)}
                      className="btn btn-secondary"
                      style={{ padding: '8px' }}
                      title="Preview Document"
                      aria-label="View preview"
                    >
                      <IconEye size={16} />
                    </button>
                    <button
                      onClick={() => openSettings(doc)}
                      className="btn btn-secondary"
                      style={{ padding: '8px' }}
                      title="Edit Print Settings"
                      aria-label="Edit settings"
                    >
                      <IconSettings size={16} />
                    </button>
                    <button
                      onClick={() => setDeletingDoc(doc)}
                      className="btn btn-danger"
                      style={{ padding: '8px' }}
                      title="Delete Document"
                      aria-label="Delete document"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Print Settings Modal */}
      {editingDoc && (
        <Modal
          isOpen={true}
          onClose={() => setEditingDoc(null)}
          title="Print Settings"
          maxWidth="520px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setEditingDoc(null)}
                className="btn btn-secondary"
                disabled={savingSettings}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="btn btn-primary"
                disabled={savingSettings}
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>
              {editingDoc.original_name}
            </div>

            {modalRangeError && (
              <div className="status-badge-danger" style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)' }}>
                {modalRangeError}
              </div>
            )}

            {/* Ink Mode */}
            <div>
              <label className="form-label">Color Mode</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setModalColor('bw')}
                  className={`btn ${modalColor === 'bw' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '12px', justifyContent: 'center' }}
                >
                  Black & White ({pricing ? formatPaise(pricing.bw_paise_per_page) : '₹1.00'})
                </button>
                <button
                  type="button"
                  onClick={() => setModalColor('color')}
                  className={`btn ${modalColor === 'color' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '12px', justifyContent: 'center' }}
                >
                  Full Color ({pricing ? formatPaise(pricing.color_paise_per_page) : '₹5.00'})
                </button>
              </div>
            </div>

            {/* Duplex and Copies */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label className="form-label">Copies (1 - 100)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input-control"
                  value={modalCopies}
                  onChange={(e) => setModalCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                />
              </div>

              <div>
                <label className="form-label">Paper Sides</label>
                <select
                  className="input-control"
                  value={modalDuplex ? 'duplex' : 'simplex'}
                  onChange={(e) => setModalDuplex(e.target.value === 'duplex')}
                >
                  <option value="duplex">Both Sides (Duplex)</option>
                  <option value="simplex">Single Side Only</option>
                </select>
              </div>
            </div>

            {/* Page Ranges */}
            <div>
              <label className="form-label">Page Ranges</label>
              <input
                type="text"
                className="input-control"
                placeholder='e.g. "all", or "1-3, 5"'
                value={modalPageRanges}
                onChange={(e) => {
                  setModalPageRanges(e.target.value);
                  setModalRangeError(null);
                }}
              />
              <div className="form-help">
                Total doc pages: {editingDoc.page_count}. Enter "all" or specific pages like "1-3, 5".
              </div>
            </div>

            {/* Price Preview */}
            <div
              style={{
                backgroundColor: 'var(--surface-elevated)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '4px',
              }}
            >
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Estimated Cost:</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)' }}>
                {pricing
                  ? formatPaise(
                    (parsePageRange(modalPageRanges, editingDoc.page_count).selectedCount ||
                      editingDoc.selected_pages) *
                    modalCopies *
                    (modalColor === 'color' ? pricing.color_paise_per_page : pricing.bw_paise_per_page)
                  )
                  : '—'}
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* View Preview Modal */}
      {previewDoc && (
        <Modal
          isOpen={true}
          onClose={() => setPreviewDoc(null)}
          title={`Preview: ${previewDoc.original_name}`}
          maxWidth="900px"
          footer={
            <button onClick={() => setPreviewDoc(null)} className="btn btn-secondary">
              Close Preview
            </button>
          }
        >
          <div>
            {previewError ? (
              <div className="alert alert-danger">{previewError}</div>
            ) : !previewUrl ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Loading your document...</div>
            ) : (
              <>
                <iframe
                  src={previewUrl}
                  title={`Preview of ${previewDoc.original_name}`}
                  style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: '#fff' }}
                />
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '10px' }}>
                  {previewDoc.page_count} pages. Prints as {previewDoc.color_mode === 'color' ? 'colour' : 'black and white'},{' '}
                  {previewDoc.duplex ? 'both sides' : 'one side'}.{' '}
                  <a href={previewUrl} target="_blank" rel="noreferrer">Open in a new tab</a>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deletingDoc && (
        <Modal
          isOpen={true}
          onClose={() => setDeletingDoc(null)}
          title="Delete Document"
          maxWidth="440px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setDeletingDoc(null)}
                className="btn btn-secondary"
                disabled={isDeleting}
              >
                Keep Document
              </button>
              <button
                type="button"
                onClick={handleDeleteDoc}
                className="btn btn-danger"
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.5 }}>
            Are you sure you want to delete <strong>"{deletingDoc.original_name}"</strong>? This will remove it from your kiosk print queue.
          </div>
        </Modal>
      )}
    </div>
  );
}