import React, { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import { StationWithKey } from '../../lib/types';
import { formatDate, printerNote } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import {
  IconMonitor,
  IconRefresh,
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconKey,
  IconPlus,
} from '../../components/icons';

export default function StationsTab() {
  const { showToast } = useToast();

  const [stations, setStations] = useState<StationWithKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add Station Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStationName, setNewStationName] = useState('');
  const [newStationLocation, setNewStationLocation] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newlyCreatedStation, setNewlyCreatedStation] = useState<StationWithKey | null>(null);

  // Toggle active modal
  const [togglingStation, setTogglingStation] = useState<StationWithKey | null>(null);
  const [toggleReason, setToggleReason] = useState('');
  const [isToggling, setIsToggling] = useState(false);

  // Rotate Key modal
  const [rotatingKeyStation, setRotatingKeyStation] = useState<{
    station: StationWithKey;
    keyType: 'station' | 'agent';
  } | null>(null);
  const [rotateReason, setRotateReason] = useState('');
  const [isRotating, setIsRotating] = useState(false);

  const loadStations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listStations();
      setStations(res);
    } catch (err: any) {
      setError(err.message || 'Unable to load stations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStations();
  }, []);

  const handleCreateStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStationName.trim()) {
      showToast('Station name is required', 'error');
      return;
    }

    setIsCreating(true);
    try {
      const created = await api.createStation({
        name: newStationName.trim(),
        location: newStationLocation.trim() || null,
      });
      setStations((prev) => [created, ...prev]);
      setNewlyCreatedStation(created);
      setShowAddModal(false);
      setNewStationName('');
      setNewStationLocation('');
      showToast(`Station "${created.name}" created!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to create station', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async () => {
    if (!togglingStation) return;
    setIsToggling(true);
    const nextState = togglingStation.status !== 'active';
    try {
      const updated = await api.setStationActive(
        togglingStation.id,
        nextState,
        toggleReason.trim() || undefined
      );
      setStations((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      showToast(`Station ${updated.name} set to ${updated.status}`, 'info');
      setTogglingStation(null);
      setToggleReason('');
    } catch (err: any) {
      showToast(err.message || 'Failed to update station state', 'error');
    } finally {
      setIsToggling(false);
    }
  };

  const handleRotateKey = async () => {
    if (!rotatingKeyStation) return;
    setIsRotating(true);
    try {
      let updated: StationWithKey;
      if (rotatingKeyStation.keyType === 'station') {
        updated = await api.rotateStationKey(
          rotatingKeyStation.station.id,
          rotateReason.trim() || 'Admin rotated station enrollment key'
        );
      } else {
        updated = await api.rotateAgentKey(
          rotatingKeyStation.station.id,
          rotateReason.trim() || 'Admin rotated agent hardware key'
        );
      }
      setStations((prev) => prev.map((s) => (s.id === updated.id ? { ...s, station_key: '', agent_key: null } : s)));
      setNewlyCreatedStation(updated);
      showToast(`Key replaced for ${updated.name}. Copy it now.`, 'success');
      setRotatingKeyStation(null);
      setRotateReason('');
    } catch (err: any) {
      showToast(err.message || 'Key rotation failed', 'error');
    } finally {
      setIsRotating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard!`, 'info');
  };

  const getPrinterBadge = (st: StationWithKey['printer_status']) => {
    switch (st) {
      case 'online':
        return <span className="status-badge status-badge-success">Online & Ready</span>;
      case 'no_paper':
        return <span className="status-badge status-badge-warning">No Paper in Tray</span>;
      case 'offline':
        return <span className="status-badge status-badge-danger">Hardware Offline</span>;
      case 'error':
        return <span className="status-badge status-badge-danger">Printer Error</span>;
      case 'unknown':
        return <span className="status-badge status-badge-warning">No report yet</span>;
      default:
        return <span className="status-badge status-badge-neutral">{st}</span>;
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
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Print Stations</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
            Manage touchscreen kiosks, monitor local printer hardware agents, and rotate credentials
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={loadStations} className="btn btn-secondary">
            <IconRefresh size={16} />
            <span>Refresh</span>
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <IconPlus size={16} />
            <span>Add Station</span>
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card skeleton" style={{ height: '220px' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>
            <IconAlertTriangle size={24} />
          </div>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Failed to load station fleet</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
            {error}
          </div>
          <button onClick={loadStations} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
          {stations.map((stn) => (
            <div
              key={stn.id}
              className="glass-panel"
              style={{
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                {/* Station Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-elevated)',
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <IconMonitor size={20} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{stn.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>ID: {stn.id}</div>
                    </div>
                  </div>
                  <span className={`status-badge ${stn.status === 'active' ? 'status-badge-success' : 'status-badge-neutral'}`}>
                    {stn.status}
                  </span>
                </div>

                <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
                  Location: <strong>{stn.location || 'Not specified'}</strong>
                </div>

                {/* Printer Health Box */}
                <div
                  style={{
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
                      Printer
                    </span>
                    {getPrinterBadge(stn.printer_status)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {printerNote(stn)}
                  </div>
                </div>

                {/* Keys & Security */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.775rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Station Kiosk Key:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.75rem' }}>Hidden for security</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.775rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Printer Agent Key:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.75rem' }}>{stn.agent_configured ? 'Key issued. Hidden for security' : 'No key yet'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Station Actions */}
              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  onClick={() => {
                    setTogglingStation(stn);
                    setToggleReason('');
                  }}
                  className={`btn ${stn.status === 'active' ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ fontSize: '0.75rem', padding: '6px 10px' }}
                >
                  {stn.status === 'active' ? 'Set Inactive' : 'Activate Station'}
                </button>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => {
                      setRotatingKeyStation({ station: stn, keyType: 'station' });
                      setRotateReason('');
                    }}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '6px 8px' }}
                    title="Rotate Kiosk Enrollment Key"
                  >
                    <IconKey size={13} />
                    <span>Rotate Key</span>
                  </button>
                  <button
                    onClick={() => {
                      setRotatingKeyStation({ station: stn, keyType: 'agent' });
                      setRotateReason('');
                    }}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '6px 8px' }}
                    title="Rotate Printer Agent Key"
                  >
                    <IconRefresh size={13} />
                    <span>Agent Key</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Station Modal */}
      {showAddModal && (
        <Modal
          isOpen={true}
          onClose={() => setShowAddModal(false)}
          title="Add Campus Print Station"
          maxWidth="480px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="btn btn-secondary"
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="add-station-form"
                className="btn btn-primary"
                disabled={isCreating}
              >
                {isCreating ? 'Provisioning...' : 'Provision Station'}
              </button>
            </>
          }
        >
          <form id="add-station-form" onSubmit={handleCreateStation} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label className="form-label">Station Name</label>
              <input
                type="text"
                className="input-control"
                placeholder="e.g. Science Block 1st Floor Kiosk"
                value={newStationName}
                onChange={(e) => setNewStationName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label">Physical Location</label>
              <input
                type="text"
                className="input-control"
                placeholder="e.g. Physics Department Foyer Wing B"
                value={newStationLocation}
                onChange={(e) => setNewStationLocation(e.target.value)}
              />
            </div>
          </form>
        </Modal>
      )}

      {/* One-Time Key Reveal Modal */}
      {newlyCreatedStation && (
        <Modal
          isOpen={true}
          onClose={() => setNewlyCreatedStation(null)}
          title={`Keys for ${newlyCreatedStation.name}`}
          maxWidth="520px"
          footer={
            <button onClick={() => setNewlyCreatedStation(null)} className="btn btn-primary">
              I Have Saved These Keys
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="status-badge-warning" style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', display: 'block' }}>
              <strong>Shown only once:</strong> copy these now. On the station computer open <strong>{window.location.origin}/station</strong> and paste the kiosk key there. The agent key goes into the print agent.
            </div>

            {newlyCreatedStation.station_key && <div>
              <label className="form-label">Station Enrollment Key</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  className="input-control"
                  value={newlyCreatedStation.station_key}
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(newlyCreatedStation.station_key, 'Station Key')}
                  className="btn btn-secondary"
                >
                  <IconCopy size={16} />
                </button>
              </div>
            </div>}

            {newlyCreatedStation.agent_key && <div>
              <label className="form-label">Local Agent Key</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  className="input-control"
                  value={newlyCreatedStation.agent_key || '—'}
                />
                {newlyCreatedStation.agent_key && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(newlyCreatedStation.agent_key!, 'Agent Key')}
                    className="btn btn-secondary"
                  >
                    <IconCopy size={16} />
                  </button>
                )}
              </div>
            </div>}
          </div>
        </Modal>
      )}

      {/* Toggle Active Confirmation Modal */}
      {togglingStation && (
        <Modal
          isOpen={true}
          onClose={() => setTogglingStation(null)}
          title={`Set Station ${togglingStation.status === 'active' ? 'Inactive' : 'Active'}`}
          maxWidth="440px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setTogglingStation(null)}
                className="btn btn-secondary"
                disabled={isToggling}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleActive}
                className="btn btn-primary"
                disabled={isToggling}
              >
                {isToggling ? 'Updating...' : 'Confirm Status Change'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '0.875rem' }}>
              Are you sure you want to {togglingStation.status === 'active' ? 'disable' : 'activate'}{' '}
              <strong>"{togglingStation.name}"</strong>?
            </div>
            <div>
              <label className="form-label">Audit Reason</label>
              <input
                type="text"
                className="input-control"
                placeholder="e.g. Scheduled paper replenish or maintenance"
                value={toggleReason}
                onChange={(e) => setToggleReason(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Rotate Key Confirmation Modal */}
      {rotatingKeyStation && (
        <Modal
          isOpen={true}
          onClose={() => setRotatingKeyStation(null)}
          title={`Rotate ${rotatingKeyStation.keyType === 'station' ? 'Station' : 'Agent'} Key`}
          maxWidth="460px"
          footer={
            <>
              <button
                type="button"
                onClick={() => setRotatingKeyStation(null)}
                className="btn btn-secondary"
                disabled={isRotating}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRotateKey}
                className="btn btn-danger"
                disabled={isRotating}
              >
                {isRotating ? 'Rotating...' : 'Rotate Key Now'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '0.875rem', lineHeight: 1.45 }}>
              Rotating this key will disconnect the kiosk until the new key is re-entered at the physical station terminal.
            </div>
            <div>
              <label className="form-label">Reason for Key Rotation</label>
              <input
                type="text"
                className="input-control"
                placeholder="e.g. Periodic quarterly security rotation"
                value={rotateReason}
                onChange={(e) => setRotateReason(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}