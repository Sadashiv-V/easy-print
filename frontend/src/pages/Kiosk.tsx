import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { Doc, StationUser, Quote, PrinterState, Job } from '../lib/types';
import { formatPaise, formatBytes, generateId, parseServerDate } from '../lib/utils';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import {
  IconPrinter,
  IconCheck,
  IconAlertTriangle,
  IconDocument,
  IconPlus,
  IconMinus,
  IconLogout,
  IconRefresh,
  IconX,
  IconMonitor,
} from '../components/icons';

export default function Kiosk() {
  const { showToast } = useToast();
  const navigate = useNavigate();

  // The kiosk is always dark, whatever the device theme is
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    return () => {
      if (prev) root.setAttribute('data-theme', prev);
      else root.removeAttribute('data-theme');
    };
  }, []);

  // Station Key Setup (First run)
  const [stationKeyConfigured, setStationKeyConfigured] = useState<boolean>(() => !!api.getStationKey());
  const [enteredStationKey, setEnteredStationKey] = useState<string>('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);

  // Hardware Printer Status
  const [printerState, setPrinterState] = useState<PrinterState>({
    printer_available: true,
    printer_status: 'online',
    message: 'LaserJet Enterprise M608 - Ready',
  });

  // Session state
  const [sessionUser, setSessionUser] = useState<StationUser | null>(null);
  const [collegeIdInput, setCollegeIdInput] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [activeInput, setActiveInput] = useState<'college_id' | 'pin'>('college_id');
  const [authenticating, setAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Documents in session
  const [docs, setDocs] = useState<Doc[]>([]);
  // Selected documents and copies: Map document_id -> copies
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

  // Idle timeout timer
  const [secondsRemaining, setSecondsRemaining] = useState<number>(90);
  const [showIdlePrompt, setShowIdlePrompt] = useState<boolean>(false);
  const idleTimerRef = useRef<any>(null);

  // Active print job in kiosk
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [isPrintingComplete, setIsPrintingComplete] = useState(false);

  // Load printer hardware status
  const refreshPrinter = useCallback(async () => {
    try {
      const state = await api.stationStatus();
      setPrinterState(state);
    } catch (e: any) {
      if (e?.status === 401 || e?.status === 403) {
        api.clearStationKey();
        setSetupError('This station key is no longer valid. Enter a new one from the admin console.');
        setStationKeyConfigured(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!stationKeyConfigured) return;
    refreshPrinter();
    const interval = setInterval(refreshPrinter, 10000);
    return () => clearInterval(interval);
  }, [refreshPrinter, stationKeyConfigured]);

  // Server ended the session (idle or maximum time)
  useEffect(() => {
    const onExpired = () => {
      setSessionUser(null);
      setSelectedItems({});
      setQuote(null);
      setActiveJob(null);
      setIsPrintingComplete(false);
      showToast('Your session ended. Please sign in again.', 'info');
    };
    window.addEventListener('easyprint:kiosk-expired', onExpired);
    return () => window.removeEventListener('easyprint:kiosk-expired', onExpired);
  }, []);

  // Check existing kiosk session on mount
  useEffect(() => {
    async function checkSession() {
      const user = await api.stationMe();
      if (user) {
        setSessionUser(user);
        loadSessionDocs();
      }
    }
    checkSession();
  }, []);

  // Idle Timer logic
  const resetIdleTimer = useCallback(() => {
    setSecondsRemaining(90);
    setShowIdlePrompt(false);
  }, []);

  useEffect(() => {
    if (!sessionUser) return;

    // Detect user interactions to reset timer
    const handleActivity = () => {
      if (!showIdlePrompt) {
        setSecondsRemaining(90);
        api.stationPing();
      }
    };

    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('keydown', handleActivity);

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSignOut('Your session timed out due to inactivity.');
          return 0;
        }
        if (prev === 25) {
          setShowIdlePrompt(true);
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, [sessionUser, showIdlePrompt]);

  // Hard session limit from the server. Touching the screen does not extend it.
  const [sessionLeft, setSessionLeft] = useState<number | null>(null);
  const sessionWarned = useRef(false);
  useEffect(() => {
    if (!sessionUser?.session_expires_at) {
      setSessionLeft(null);
      sessionWarned.current = false;
      return;
    }
    const end = parseServerDate(sessionUser.session_expires_at).getTime();
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setSessionLeft(left);
      if (left <= 60 && !sessionWarned.current) {
        sessionWarned.current = true;
        showToast('Your session ends in 1 minute. Finish and print now, then sign in again if you need more time.', 'info');
      }
      if (left <= 0) handleSignOut('Your session time ended. Please sign in again to continue.');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionUser?.session_expires_at]);

  const loadSessionDocs = async () => {
    try {
      const fetchedDocs = await api.stationDocuments();
      setDocs(fetchedDocs);
      setSelectedItems({});
    } catch (err: any) {
      showToast(err.message || 'Failed to load kiosk documents', 'error');
    }
  };

  // Recalculate quote whenever selectedItems change
  useEffect(() => {
    if (!sessionUser) return;
    const items = Object.entries(selectedItems)
      .filter(([_, copies]) => copies > 0)
      .map(([id, copies]) => ({ document_id: id, copies }));

    if (items.length === 0) {
      setQuote(null);
      return;
    }

    let isCurrent = true;
    setQuoting(true);

    api
      .stationQuote(items)
      .then((res) => {
        if (isCurrent) setQuote(res);
      })
      .catch((err) => {
        console.error('Quote error:', err);
      })
      .finally(() => {
        if (isCurrent) setQuoting(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedItems, sessionUser]);

  // Poll active print job
  useEffect(() => {
    if (!activeJob || ['completed', 'failed', 'cancelled', 'partial'].includes(activeJob.status)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const jobs = await api.stationJobs();
        const current = jobs.find((j) => j.id === activeJob.id);
        if (current) {
          setActiveJob(current);
          if (['completed', 'failed', 'cancelled', 'partial'].includes(current.status)) {
            if (current.status === 'completed' || current.status === 'partial') setIsPrintingComplete(true);
            const me = await api.stationMe();
            if (me) setSessionUser(me);
            if (current.status === 'completed') showToast('Printing completed! Please collect your pages from the printer.', 'success');
            else if (current.status === 'partial') showToast('Some files could not be printed. You were charged only for what printed.', 'info');
            else if (current.status === 'failed') showToast('Printing failed. You were not charged.', 'error');
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeJob]);

  // Station Key Setup submission
  const handleStationSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredStationKey.trim()) {
      setSetupError('Please paste the station key from the admin console.');
      return;
    }
    setSettingUp(true);
    setSetupError(null);
    api.setStationKey(enteredStationKey);
    try {
      const state = await api.stationStatus();
      setPrinterState(state);
      setStationKeyConfigured(true);
      showToast('This station is ready to use', 'success');
    } catch (err: any) {
      api.clearStationKey();
      setSetupError(err.message || 'That key was not accepted.');
    } finally {
      setSettingUp(false);
    }
  };

  // Sign in to Kiosk
  const handleKioskLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!collegeIdInput.trim()) {
      setLoginError('Please enter your College ID.');
      setActiveInput('college_id');
      return;
    }
    if (!pinInput.trim()) {
      setLoginError('Please enter your 4-6 digit Station PIN.');
      setActiveInput('pin');
      return;
    }

    setAuthenticating(true);
    setLoginError(null);

    try {
      const user = await api.stationLogin(collegeIdInput, pinInput);
      setSessionUser(user);
      setCollegeIdInput('');
      setPinInput('');
      setSecondsRemaining(90);
      showToast(`Welcome ${user.full_name}! Touchscreen session started.`, 'success');
      loadSessionDocs();
    } catch (err: any) {
      setLoginError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleSignOut = async (msg = 'Signed out from kiosk session.') => {
    await api.stationLogout();
    setSessionUser(null);
    setSelectedItems({});
    setQuote(null);
    setActiveJob(null);
    setIsPrintingComplete(false);
    setShowIdlePrompt(false);
    showToast(msg, 'info');
  };

  // On-screen keypad touch inputs
  const handleKeypadPress = (val: string) => {
    if (activeInput === 'college_id') {
      if (val === 'BACKSPACE') {
        setCollegeIdInput((prev) => prev.slice(0, -1));
      } else if (val === 'CLEAR') {
        setCollegeIdInput('');
      } else {
        setCollegeIdInput((prev) => prev + val);
      }
    } else {
      // PIN input
      if (val === 'BACKSPACE') {
        setPinInput((prev) => prev.slice(0, -1));
      } else if (val === 'CLEAR') {
        setPinInput('');
      } else if (/^\d$/.test(val) && pinInput.length < 6) {
        setPinInput((prev) => prev + val);
      }
    }
  };

  // Toggle selection & copies
  const toggleSelectDoc = (docId: string) => {
    setSelectedItems((prev) => {
      const current = prev[docId];
      if (current && current > 0) {
        const next = { ...prev };
        delete next[docId];
        return next;
      } else {
        const doc = docs.find((d) => d.id === docId);
        return { ...prev, [docId]: doc?.copies || 1 };
      }
    });
  };

  const changeDocCopies = (docId: string, delta: number) => {
    setSelectedItems((prev) => {
      const current = prev[docId] || 1;
      const nextVal = Math.min(100, Math.max(1, current + delta));
      return { ...prev, [docId]: nextVal };
    });
  };

  // Trigger Print Job
  const handlePrint = async () => {
    if (!quote || !quote.sufficient || !printerState.printer_available) return;

    const items = Object.entries(selectedItems)
      .filter(([_, copies]) => copies > 0)
      .map(([id, copies]) => ({ document_id: id, copies }));

    if (items.length === 0) return;

    const idempotencyKey = `kiosk_${Date.now()}_${Math.random()}`;
    try {
      const job = await api.stationPrint(items, idempotencyKey);
      setActiveJob(job);
      setIsPrintingComplete(false);
      showToast('Printing started! Hardware spooling documents...', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to start printing', 'error');
    }
  };

  // Cancel Job while queued
  const handleCancelQueuedJob = async () => {
    if (!activeJob) return;
    setCancellingJob(true);
    try {
      const updated = await api.stationCancelJob(activeJob.id);
      setActiveJob(updated);
      showToast('Print job cancelled at terminal.', 'info');
    } catch (err: any) {
      showToast(err.message || 'Cannot cancel printing in progress.', 'error');
    } finally {
      setCancellingJob(false);
    }
  };

  // -----------------------------------------------------------
  // RENDER: FIRST RUN SETUP SCREEN
  // -----------------------------------------------------------
  if (!stationKeyConfigured) {
    return (
      <div className="kiosk-screen" style={{ justifyContent: 'center', alignItems: 'center', padding: '24px' }}>
        <div
          className="glass-panel"
          style={{
            maxWidth: '540px',
            width: '100%',
            padding: '36px',
            backgroundColor: '#12101b',
            border: '1px solid rgba(157, 92, 252, 0.3)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: 'var(--radius-lg)',
                background: 'linear-gradient(135deg, #7928ca 0%, #431278 100%)',
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                boxShadow: '0 8px 24px rgba(121,40,202,0.5)',
              }}
            >
              <IconMonitor size={36} />
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, color: '#ffffff' }}>
              Touchscreen Kiosk Setup
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '6px' }}>
              Paste the station key shown once in the admin console (Stations).
            </p>
          </div>

          {setupError && (
            <div className="status-badge-danger" style={{ padding: '12px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' }}>
              {setupError}
            </div>
          )}

          <form onSubmit={handleStationSetup} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label className="form-label" style={{ color: '#ffffff' }}>Station Authorization Key</label>
              <input
                type="text"
                className="input-control"
                placeholder="Paste the station key"
                value={enteredStationKey}
                onChange={(e) => setEnteredStationKey(e.target.value)}
                style={{ height: '48px', fontSize: '1rem' }}
                required
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                type="submit"
                disabled={settingUp}
                className="btn btn-primary"
                style={{ flex: 1, height: '52px', fontWeight: 700 }}
              >
                {settingUp ? 'Checking...' : 'Save and start'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------
  // RENDER: SIGN IN SCREEN WITH TOUCH KEYPAD
  // -----------------------------------------------------------
  if (!sessionUser) {
    return (
      <div className="kiosk-screen" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {/* Kiosk Top Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, #9d5cfc 0%, #431278 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconPrinter size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#ffffff' }}>
                Easy-Print Touch Station
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Self-service printing
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Live Printer Hardware Status Badge */}
            <div
              className={`status-badge ${printerState.printer_available ? 'status-badge-success' : 'status-badge-danger'
                }`}
              style={{ padding: '8px 14px', fontSize: '0.85rem', fontWeight: 700 }}
            >
              <span className="status-dot" />
              <span>{printerState.printer_available ? 'Printer Ready' : printerState.message || 'Printer Offline'}</span>
            </div>
          </div>
        </div>

        {/* Central Sign-In Container */}
        <div style={{ maxWidth: '800px', width: '100%', margin: 'auto', padding: '20px 0' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>
              Touch to Sign In
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
              Enter your College ID and 4-6 digit Station PIN
            </p>
          </div>

          {loginError && (
            <div
              className="status-badge-danger"
              style={{
                maxWidth: '460px',
                margin: '0 auto 20px',
                padding: '12px 16px',
                fontSize: '0.9rem',
                borderRadius: 'var(--radius-md)',
                display: 'block',
                textAlign: 'center',
              }}
            >
              {loginError}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '28px',
              alignItems: 'start',
            }}
          >
            {/* Input Displays */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* College ID Field */}
              <div
                onClick={() => setActiveInput('college_id')}
                style={{
                  padding: '16px 20px',
                  borderRadius: 'var(--radius-lg)',
                  background: activeInput === 'college_id' ? 'rgba(157, 92, 252, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  border: `2px solid ${activeInput === 'college_id' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.12)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  College ID
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', minHeight: '34px', display: 'flex', alignItems: 'center' }}>
                  {collegeIdInput || (
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>e.g. 25881A0501</span>
                  )}
                  {activeInput === 'college_id' && (
                    <span style={{ animation: 'skeleton-shimmer 0.8s infinite', marginLeft: '4px', color: 'var(--primary)' }}>
                      |
                    </span>
                  )}
                </div>
              </div>

              {/* Station PIN Field */}
              <div
                onClick={() => setActiveInput('pin')}
                style={{
                  padding: '16px 20px',
                  borderRadius: 'var(--radius-lg)',
                  background: activeInput === 'pin' ? 'rgba(157, 92, 252, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  border: `2px solid ${activeInput === 'pin' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.12)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Touchscreen Station PIN
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ffffff', minHeight: '34px', letterSpacing: '0.2em', display: 'flex', alignItems: 'center' }}>
                  {pinInput ? '•'.repeat(pinInput.length) : (
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400, letterSpacing: 'normal', fontSize: '1.1rem' }}>
                      Enter 4-6 digits
                    </span>
                  )}
                  {activeInput === 'pin' && (
                    <span style={{ animation: 'skeleton-shimmer 0.8s infinite', marginLeft: '4px', color: 'var(--primary)' }}>
                      |
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleKioskLogin()}
                className="btn btn-primary btn-kiosk-touch"
                disabled={authenticating}
                style={{ minHeight: '62px' }}
              >
                {authenticating ? 'Authenticating...' : 'Sign In & Access Files'}
              </button>
            </div>

            {/* On-Screen Touch Keypad */}
            <div>
              <div className="pin-keypad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'BACKSPACE'].map((keyVal) => {
                  return (
                    <button
                      key={keyVal}
                      type="button"
                      onClick={() => handleKeypadPress(keyVal)}
                      className="pin-key"
                      style={{
                        fontSize: keyVal === 'CLEAR' || keyVal === 'BACKSPACE' ? '0.9rem' : '1.6rem',
                        fontWeight: 700,
                        color: keyVal === 'CLEAR' ? 'var(--danger)' : '#ffffff',
                      }}
                    >
                      {keyVal === 'BACKSPACE' ? '⌫' : keyVal}
                    </button>
                  );
                })}
              </div>

              {/* Letters for College IDs such as 25881A0501 */}
              {activeInput === 'college_id' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '6px', margin: '12px auto 0' }}>
                  {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setCollegeIdInput((prev) => (prev.length < 20 ? prev + ch : prev))}
                      style={{
                        height: '40px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.14)',
                        background: 'rgba(255,255,255,0.07)', color: '#ffffff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
                      }}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-subtle)', padding: '12px 0' }}>
          Terminal auto-clears sensitive data after each print release. Contact campus desk if printer requires service.
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------
  // RENDER: ACTIVE SESSION (DOCUMENT TRAY + ORDER SUMMARY + LIVE PRINT)
  // -----------------------------------------------------------
  const totalSelectedCount = Object.values(selectedItems).reduce((sum, n) => sum + (n > 0 ? 1 : 0), 0);

  return (
    <div className="kiosk-screen" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
      {/* Session Top Bar */}
      <div
        className="glass-panel"
        style={{
          padding: '16px 24px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
          backgroundColor: '#12101b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, var(--primary) 0%, #3e1273 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.2rem',
            }}
          >
            {sessionUser.full_name.charAt(0)}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#ffffff' }}>
              {sessionUser.full_name}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ID: {sessionUser.college_id}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {/* Wallet Balance Display */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Wallet Balance
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)' }}>
              {formatPaise(sessionUser.balance_paise)}
            </div>
          </div>

          {/* Idle Timeout Countdown */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              background: secondsRemaining < 30 ? 'var(--danger-bg)' : 'rgba(255,255,255,0.06)',
              color: secondsRemaining < 30 ? 'var(--danger)' : 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 700,
            }}
            title="Signs out after this long without touching the screen"
          >
            <span>Idle: {secondsRemaining}s</span>
          </div>

          {sessionLeft !== null && (
            <div
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                background: sessionLeft <= 60 ? 'var(--danger-bg)' : 'rgba(255,255,255,0.06)',
                color: sessionLeft <= 60 ? 'var(--danger)' : 'var(--text-muted)',
                fontSize: '0.85rem',
                fontWeight: 700,
              }}
              title="Total time allowed for this sign-in. Touching the screen does not extend it."
            >
              Session: {Math.floor(sessionLeft / 60)}:{String(sessionLeft % 60).padStart(2, '0')}
            </div>
          )}

          <button
            onClick={() => handleSignOut()}
            className="btn btn-secondary btn-kiosk-touch"
            style={{ minHeight: '52px', padding: '10px 18px', color: '#ffffff' }}
          >
            <IconLogout size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Printer Warning if offline or no paper */}
      {!printerState.printer_available && (
        <div
          className="status-badge-danger"
          style={{
            padding: '16px 20px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <IconAlertTriangle size={24} />
          <div>
            <strong>Printing Disabled: </strong> {printerState.message || 'Printer is currently offline.'} Please contact campus IT or use another station.
          </div>
        </div>
      )}

      {/* Main Kiosk Area: Document Tray (Left) + Receipt Order Summary (Right) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: '24px',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left: Document Tray */}
        <div
          className="glass-panel"
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#12101b',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#ffffff' }}>
                Your Document Tray
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', marginTop: '2px' }}>
                Tap cards to select documents and adjust number of copies
              </p>
            </div>
            <span className="status-badge status-badge-primary">
              {totalSelectedCount} of {docs.length} selected
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {docs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                No documents found in your upload queue. Upload PDF files via your phone or laptop first.
              </div>
            ) : (
              docs.map((doc) => {
                const isSelected = !!selectedItems[doc.id];
                const copies = selectedItems[doc.id] || doc.copies || 1;

                return (
                  <div
                    key={doc.id}
                    onClick={() => toggleSelectDoc(doc.id)}
                    style={{
                      padding: '16px 20px',
                      borderRadius: 'var(--radius-lg)',
                      background: isSelected ? 'rgba(157, 92, 252, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                      border: `2px solid ${isSelected ? 'var(--primary)' : 'rgba(255, 255, 255, 0.10)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '14px',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: 1 }}>
                      {/* Checkbox indicator */}
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          border: `2px solid ${isSelected ? 'var(--primary)' : 'rgba(255, 255, 255, 0.3)'}`,
                          background: isSelected ? 'var(--primary)' : 'transparent',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isSelected && <IconCheck size={18} />}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '1rem',
                            color: '#ffffff',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {doc.original_name}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            fontSize: '0.775rem',
                            color: 'var(--text-muted)',
                            marginTop: '4px',
                          }}
                        >
                          <span>{doc.selected_pages} pages</span>
                          <span>·</span>
                          <span style={{ textTransform: 'uppercase' }}>{doc.color_mode}</span>
                          <span>·</span>
                          <span>{doc.duplex ? '2-Sided' : '1-Sided'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Copies incrementer */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: 'rgba(0,0,0,0.3)',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => changeDocCopies(doc.id, -1)}
                        className="btn btn-secondary btn-kiosk-touch"
                        style={{ minHeight: '44px', minWidth: '44px', padding: '0', color: '#ffffff' }}
                        disabled={!isSelected}
                        aria-label="Decrease copies"
                      >
                        <IconMinus size={18} />
                      </button>

                      <span style={{ minWidth: '32px', textAlign: 'center', fontWeight: 800, fontSize: '1.1rem', color: '#ffffff' }}>
                        {copies}
                      </span>

                      <button
                        type="button"
                        onClick={() => changeDocCopies(doc.id, 1)}
                        className="btn btn-secondary btn-kiosk-touch"
                        style={{ minHeight: '44px', minWidth: '44px', padding: '0', color: '#ffffff' }}
                        disabled={!isSelected}
                        aria-label="Increase copies"
                      >
                        <IconPlus size={18} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Receipt-Style Order Summary & Big Print Action */}
        <div
          className="glass-panel"
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            backgroundColor: '#12101b',
          }}
        >
          <div>
            <div
              style={{
                borderBottom: '2px dashed rgba(255, 255, 255, 0.15)',
                paddingBottom: '16px',
                marginBottom: '16px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#ffffff', letterSpacing: '0.05em' }}>
                PRINT RECEIPT
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Self-service printing
              </div>
            </div>

            {/* Line items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
              {!quote || quote.lines.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '24px 0' }}>
                  No documents selected for print
                </div>
              ) : (
                quote.lines.map((line, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <div style={{ maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{ color: '#ffffff' }}>{line.copies}x</strong> {line.original_name}
                    </div>
                    <div style={{ fontWeight: 700, color: '#ffffff' }}>
                      {formatPaise(line.price_paise)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Calculation Totals */}
            {quote && quote.lines.length > 0 && (
              <div
                style={{
                  borderTop: '2px dashed rgba(255, 255, 255, 0.15)',
                  marginTop: '16px',
                  paddingTop: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  <span>Total Pages Spooled:</span>
                  <span style={{ fontWeight: 700, color: '#ffffff' }}>{quote.total_pages} pages</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  <span>Wallet Balance:</span>
                  <span style={{ fontWeight: 700, color: '#ffffff' }}>{formatPaise(quote.balance_paise)}</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff' }}>Total Cost:</span>
                  <span style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--primary)' }}>
                    {formatPaise(quote.total_paise)}
                  </span>
                </div>

                {/* Shortfall warning */}
                {!quote.sufficient && (
                  <div
                    className="status-badge-danger"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      marginTop: '10px',
                      fontSize: '0.85rem',
                      lineHeight: 1.4,
                    }}
                  >
                    <strong>Insufficient Balance:</strong> Need{' '}
                    <strong>{formatPaise(quote.shortfall_paise)}</strong> more. Please recharge your wallet
                    via your phone or remove documents.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Big Tactile Print Button */}
          <div style={{ marginTop: '20px' }}>
            <button
              onClick={handlePrint}
              disabled={
                !quote ||
                !quote.sufficient ||
                quote.lines.length === 0 ||
                !printerState.printer_available ||
                quoting
              }
              className="btn btn-primary btn-kiosk-touch"
              style={{
                width: '100%',
                minHeight: '68px',
                fontSize: '1.25rem',
                letterSpacing: '0.02em',
                boxShadow: '0 8px 24px rgba(121,40,202,0.5)',
              }}
            >
              <IconPrinter size={26} />
              <span>
                {quoting
                  ? 'Calculating...'
                  : !printerState.printer_available
                    ? 'Printer Unavailable'
                    : !quote || quote.lines.length === 0
                      ? 'Select Documents to Print'
                      : !quote.sufficient
                        ? 'Balance Insufficient'
                        : `Release Print (${formatPaise(quote.total_paise)})`}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Printing Job Overlay / Status Panel */}
      {activeJob && (
        <div
          className="modal-overlay"
          style={{ backgroundColor: 'rgba(5, 4, 8, 0.92)' }}
        >
          <div
            className="glass-panel"
            style={{
              maxWidth: '560px',
              width: '100%',
              padding: '36px',
              textAlign: 'center',
              backgroundColor: '#12101b',
            }}
          >
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background:
                  activeJob.status === 'completed'
                    ? 'var(--success-bg)'
                    : activeJob.status === 'partial'
                      ? 'var(--warning-bg)'
                      : activeJob.status === 'failed' || activeJob.status === 'cancelled'
                        ? 'var(--danger-bg)'
                        : 'var(--primary-subtle)',
                color:
                  activeJob.status === 'completed'
                    ? 'var(--success)'
                    : activeJob.status === 'partial'
                      ? 'var(--warning)'
                      : activeJob.status === 'failed' || activeJob.status === 'cancelled'
                        ? 'var(--danger)'
                        : 'var(--primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '18px',
              }}
            >
              {activeJob.status === 'completed' ? (
                <IconCheck size={40} />
              ) : activeJob.status === 'failed' || activeJob.status === 'cancelled' || activeJob.status === 'partial' ? (
                <IconAlertTriangle size={40} />
              ) : (
                <IconPrinter size={40} />
              )}
            </div>

            <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ffffff', margin: '0 0 8px 0' }}>
              {activeJob.status === 'queued' && 'Document Queued on Hardware...'}
              {activeJob.status === 'printing' && 'Printing in Progress...'}
              {activeJob.status === 'completed' && 'Printing Completed!'}
              {activeJob.status === 'partial' && 'Some files did not print'}
              {activeJob.status === 'cancelled' && 'Job Cancelled'}
              {activeJob.status === 'failed' && 'Printing Error'}
            </h2>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '24px' }}>
              {activeJob.status === 'printing' && 'Please stay near the printer and collect your pages when it finishes.'}
              {activeJob.status === 'completed' &&
                'Your pages are ready in the output tray. Please collect all sheets.'}
              {activeJob.status === 'partial' &&
                (activeJob.failure_reason || 'You were charged only for the files that printed.')}
              {activeJob.status === 'cancelled' && 'You were not charged.'}
              {activeJob.status === 'failed' &&
                `${activeJob.failure_reason || 'The printer could not finish this order.'} You were not charged.`}
            </p>

            {(activeJob.status === 'partial' || activeJob.status === 'failed') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '22px', textAlign: 'left' }}>
                {activeJob.items.map((it, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#ffffff',
                      fontSize: '0.9rem',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.document_name}</span>
                    <span style={{ fontWeight: 700, color: it.status === 'done' ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                      {it.status === 'done' ? 'Printed' : 'Not printed, not charged'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Simulated Animated Progress Bar while printing */}
            {(activeJob.status === 'printing' || activeJob.status === 'queued') && (
              <div
                style={{
                  width: '100%',
                  height: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '5px',
                  overflow: 'hidden',
                  marginBottom: '24px',
                }}
              >
                <div
                  style={{
                    width: '75%',
                    height: '100%',
                    background: 'var(--primary)',
                    animation: 'skeleton-shimmer 1.5s infinite',
                  }}
                />
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '14px', justifyContent: 'center' }}>
              {activeJob.status === 'queued' && (
                <button
                  onClick={handleCancelQueuedJob}
                  disabled={cancellingJob}
                  className="btn btn-danger btn-kiosk-touch"
                  style={{ minWidth: '160px' }}
                >
                  {cancellingJob ? 'Cancelling...' : 'Cancel Job'}
                </button>
              )}

              {(activeJob.status === 'completed' || activeJob.status === 'partial') && (
                <>
                  <button
                    onClick={() => {
                      setActiveJob(null);
                      setSelectedItems({});
                      setQuote(null);
                      resetIdleTimer();
                    }}
                    className="btn btn-secondary btn-kiosk-touch"
                    style={{ minWidth: '160px', color: '#ffffff' }}
                  >
                    Print More
                  </button>
                  <button
                    onClick={() => handleSignOut('Thank you for using Easy-Print!')}
                    className="btn btn-primary btn-kiosk-touch"
                    style={{ minWidth: '160px' }}
                  >
                    Collect & Sign Out
                  </button>
                </>
              )}

              {(activeJob.status === 'cancelled' || activeJob.status === 'failed') && (
                <button
                  onClick={() => setActiveJob(null)}
                  className="btn btn-secondary btn-kiosk-touch"
                  style={{ minWidth: '160px', color: '#ffffff' }}
                >
                  Back to Tray
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* "Still There?" Idle Prompt Modal */}
      {showIdlePrompt && (
        <Modal
          isOpen={true}
          onClose={resetIdleTimer}
          title="Still there?"
          maxWidth="460px"
          footer={
            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <button
                onClick={() => handleSignOut()}
                className="btn btn-secondary btn-kiosk-touch"
                style={{ flex: 1, color: '#ffffff' }}
              >
                Sign Out
              </button>
              <button
                onClick={resetIdleTimer}
                className="btn btn-primary btn-kiosk-touch"
                style={{ flex: 1 }}
              >
                Yes, Continue ({secondsRemaining}s)
              </button>
            </div>
          }
        >
          <div style={{ fontSize: '1rem', color: '#ffffff', lineHeight: 1.5, textAlign: 'center' }}>
            To keep your student balance secure, this kiosk will auto-sign out in{' '}
            <strong style={{ color: 'var(--danger)', fontSize: '1.2rem' }}>{secondsRemaining} seconds</strong>.
          </div>
        </Modal>
      )}
    </div>
  );
}