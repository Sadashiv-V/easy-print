import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { IconPrinter, IconLock, IconUser, IconSun, IconMoon } from '../components/icons';
import * as api from '../lib/api';

type ForgotStep = 'idle' | 'enter-id' | 'enter-otp' | 'enter-new-password';

export default function Login() {
  const { loginUser, theme, setThemeMode } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // ── Normal login ────────────────────────────────────────────────────────────
  const [collegeId, setCollegeId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Forgot password flow ────────────────────────────────────────────────────
  const [forgotStep, setForgotStep] = useState<ForgotStep>('idle');
  const [forgotId, setForgotId] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');
  const [forgotConfirmPass, setForgotConfirmPass] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // ── Login submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collegeId.trim()) { setError('Please enter your College ID.'); return; }
    if (!password) { setError('Please enter your account password.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const u = await loginUser(collegeId, password);
      showToast(`Welcome back, ${u.full_name}!`, 'success');
      navigate(u.role === 'admin' ? '/admin' : '/app');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Forgot: Step 1 — send OTP ─────────────────────────────────────────────
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotId.trim()) { setForgotError('Please enter your College ID.'); return; }
    setForgotLoading(true);
    setForgotError(null);
    try {
      await api.forgotPassword(forgotId.trim());
      setForgotStep('enter-otp');
      showToast('OTP sent to your registered email.', 'success');
    } catch (err: any) {
      setForgotError(err.message || 'Failed to send OTP. Try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  // ── Forgot: Step 2 — verify OTP ───────────────────────────────────────────
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotOtp.trim()) { setForgotError('Enter the OTP from your email.'); return; }
    setForgotLoading(true);
    setForgotError(null);
    try {
      await api.verifyOtp(forgotId.trim(), forgotOtp.trim());
      setForgotStep('enter-new-password');
    } catch (err: any) {
      setForgotError('Invalid or expired OTP. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  // ── Forgot: Step 3 — set new password ─────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotNewPass !== forgotConfirmPass) {
      setForgotError('Passwords do not match.');
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    try {
      await api.resetPassword(forgotId.trim(), forgotOtp.trim(), forgotNewPass);
      showToast('Password reset! Please log in.', 'success');
      // Reset everything and go back to login
      setForgotStep('idle');
      setForgotId(''); setForgotOtp(''); setForgotNewPass(''); setForgotConfirmPass('');
    } catch (err: any) {
      setForgotError(err.message || 'Reset failed. The OTP may have expired.');
    } finally {
      setForgotLoading(false);
    }
  };

  const cycleTheme = () => {
    if (theme === 'system') setThemeMode('dark');
    else if (theme === 'dark') setThemeMode('light');
    else setThemeMode('system');
  };

  // ── Render: forgot-password modal overlay ─────────────────────────────────
  const renderForgotModal = () => {
    if (forgotStep === 'idle') return null;

    const titles: Record<ForgotStep, string> = {
      idle: '',
      'enter-id': 'Forgot Password',
      'enter-otp': 'Enter OTP',
      'enter-new-password': 'Set New Password',
    };

    return (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', padding: '24px 16px',
        }}
      >
        <div
          className="glass-panel"
          style={{ maxWidth: '400px', width: '100%', padding: '32px 28px' }}
        >
          <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 700 }}>
            {titles[forgotStep]}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px' }}>
            {forgotStep === 'enter-id' && 'Enter your College ID and we will send a 6-digit OTP to your registered email.'}
            {forgotStep === 'enter-otp' && `Check your email for a 6-digit OTP. It expires in 10 minutes.`}
            {forgotStep === 'enter-new-password' && 'Choose a strong new password (minimum 8 characters).'}
          </p>

          {forgotError && (
            <div className="status-badge-danger" style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.85rem', display: 'block' }}>
              {forgotError}
            </div>
          )}

          {/* Step 1 */}
          {forgotStep === 'enter-id' && (
            <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="form-label">College ID</label>
                <input
                  type="text" className="input-control" placeholder="e.g. 25881A0501"
                  value={forgotId} onChange={(e) => setForgotId(e.target.value)}
                  autoCapitalize="characters" required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={forgotLoading} style={{ width: '100%' }}>
                {forgotLoading ? 'Sending OTP…' : 'Send OTP to Email'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setForgotStep('idle'); setForgotError(null); }} style={{ width: '100%' }}>
                Cancel
              </button>
            </form>
          )}

          {/* Step 2 */}
          {forgotStep === 'enter-otp' && (
            <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="form-label">6-digit OTP</label>
                <input
                  type="text" className="input-control" placeholder="Enter OTP from email"
                  value={forgotOtp} onChange={(e) => setForgotOtp(e.target.value)}
                  maxLength={6} required
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={forgotLoading}>
                {forgotLoading ? 'Verifying...' : 'Continue'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setForgotStep('enter-id'); setForgotError(null); }} style={{ width: '100%' }}>
                ← Back
              </button>
            </form>
          )}

          {/* Step 3 */}
          {forgotStep === 'enter-new-password' && (
            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="form-label">New Password</label>
                <input
                  type="password" className="input-control" placeholder="Min 8 characters"
                  value={forgotNewPass} onChange={(e) => setForgotNewPass(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password" className="input-control" placeholder="Repeat new password"
                  value={forgotConfirmPass} onChange={(e) => setForgotConfirmPass(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={forgotLoading} style={{ width: '100%' }}>
                {forgotLoading ? 'Resetting…' : 'Reset Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  };

  // ── Main login render ─────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '24px 16px', position: 'relative' }}>
      {renderForgotModal()}

      <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={cycleTheme} className="btn btn-secondary" style={{ padding: '8px 12px' }} aria-label="Toggle theme">
          {theme === 'light' ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>
      </div>

      <div className="glass-panel" style={{ maxWidth: '440px', width: '100%', padding: '36px 30px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, var(--primary) 0%, #431278 100%)', color: '#ffffff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(121,40,202,0.4)', marginBottom: '16px' }}>
            <IconPrinter size={30} />
          </div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>Easy-Print</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '6px' }}>College self-service cloud printing system</p>
        </div>

        {error && (
          <div className="status-badge-danger" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', marginBottom: '20px', fontSize: '0.85rem', display: 'block', lineHeight: 1.4 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label className="form-label" htmlFor="college-id-input">College ID</label>
            <div style={{ position: 'relative' }}>
              <input id="college-id-input" type="text" className="input-control" placeholder="e.g. 25881A0501" value={collegeId} onChange={(e) => setCollegeId(e.target.value)} autoCapitalize="characters" required style={{ paddingLeft: '38px' }} />
              <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }}><IconUser size={18} /></div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label className="form-label" htmlFor="password-input" style={{ margin: 0 }}>Account Password</label>
              <button type="button" onClick={() => { setForgotStep('enter-id'); setForgotId(collegeId); setForgotError(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600, padding: 0 }}>
                Forgot password?
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input id="password-input" type="password" className="input-control" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ paddingLeft: '38px' }} />
              <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }}><IconLock size={18} /></div>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} style={{ width: '100%', marginTop: '6px' }}>
            {submitting ? 'Authenticating...' : 'Sign In to Print Portal'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>First time using Easy-Print? </span>
          <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'underline' }}>Activate account</Link>
        </div>
      </div>
    </div>
  );
}