import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import * as api from '../lib/api';
import { passwordProblem, pinProblem } from '../lib/utils';
import { IconPrinter, IconCheck, IconLock, IconKey, IconUser } from '../components/icons';

export default function Register() {
  const { reloadUser } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [collegeId, setCollegeId] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [stationPin, setStationPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collegeId.trim()) {
      setError('Please provide your College ID.');
      return;
    }
    if (!activationCode.trim()) {
      setError('Please enter your student activation code.');
      return;
    }
    const pwProblem = passwordProblem(password, collegeId);
    if (pwProblem) {
      setError(pwProblem);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-check.');
      return;
    }
    const pinIssue = pinProblem(stationPin.trim());
    if (pinIssue) {
      setError(pinIssue);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.register({
        college_id: collegeId.trim(),
        activation_code: activationCode.trim(),
        password,
        station_pin: stationPin.trim(),
      });
      await reloadUser();
      showToast('Account activated. You can sign in now.', 'success');
      navigate('/app');
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        className="glass-panel"
        style={{
          maxWidth: '500px',
          width: '100%',
          padding: '36px 32px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(135deg, var(--primary) 0%, #431278 100%)',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(121,40,202,0.4)',
              marginBottom: '14px',
            }}
          >
            <IconPrinter size={28} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>
            Activate Student Print Account
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '6px' }}>
            Link your college credentials and set your quick kiosk PIN
          </p>
        </div>

        {error && (
          <div
            className="status-badge-danger"
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              marginBottom: '18px',
              fontSize: '0.85rem',
              display: 'block',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="form-label" htmlFor="reg-college-id">
                College ID
              </label>
              <input
                id="reg-college-id"
                type="text"
                className="input-control"
                placeholder="e.g. 25881A0501"
                value={collegeId}
                onChange={(e) => setCollegeId(e.target.value)}
                autoCapitalize="characters"
                required
              />
            </div>
            <div>
              <label className="form-label" htmlFor="reg-activation-code">
                Activation Code
              </label>
              <input
                id="reg-activation-code"
                type="text"
                className="input-control"
                placeholder="Code from the college office"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="form-label" htmlFor="reg-password">
                Password
              </label>
              <input
                id="reg-password"
                type="password"
                className="input-control"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label" htmlFor="reg-confirm-password">
                Confirm Password
              </label>
              <input
                id="reg-confirm-password"
                type="password"
                className="input-control"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="reg-station-pin">
              Station Kiosk PIN (4 to 6 Digits)
            </label>
            <input
              id="reg-station-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              className="input-control"
              placeholder="4 to 6 digits"
              value={stationPin}
              onChange={(e) => setStationPin(e.target.value.replace(/\D/g, ''))}
              required
            />
            <div className="form-help">
              This PIN is used on touchscreen kiosk keypads to authenticate and print.
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={submitting}
            style={{ width: '100%', marginTop: '8px' }}
          >
            {submitting ? 'Activating Account...' : 'Activate account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Already activated? </span>
          <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 600 }}>
            Sign in here
          </Link>
        </div>
      </div>
    </div>
  );
}