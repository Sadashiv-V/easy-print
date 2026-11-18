// ─────────────────────────────────────────────────────────────────────────────
// SAVE THIS AS A NEW FILE: frontend/src/pages/admin/AccountTab.tsx
// This lets a logged-in admin change their own password from the admin panel.
// Uses the same /auth/change-password route students already use — no new
// backend route needed for this part.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import * as api from '../../lib/api';
import { formatDate, passwordProblem } from '../../lib/utils';
import { IconLock, IconUser, IconShield } from '../../components/icons';

export default function AccountTab() {
    const { user } = useAuth();
    const { showToast } = useToast();

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPass, setChangingPass] = useState(false);
    const [passError, setPassError] = useState<string | null>(null);

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPassError(null);

        const pwProblem = passwordProblem(newPassword, user?.college_id || '');
        if (pwProblem) {
            setPassError(pwProblem);
            return;
        }

        if (newPassword !== confirmPassword) {
            setPassError('New passwords do not match. Please re-enter.');
            return;
        }

        setChangingPass(true);
        try {
            await api.changePassword(currentPassword, newPassword);
            showToast('Admin password updated successfully', 'success');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            setPassError(err.message || 'Failed to update password');
        } finally {
            setChangingPass(false);
        }
    };

    return (
        <div className="content-wrapper">
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Admin Account</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
                    Manage your own administrator login credentials
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                {/* Admin Profile Card */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
                        <div
                            style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, var(--primary) 0%, #3e1273 100%)',
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 4px 12px rgba(121,40,202,0.3)',
                            }}
                        >
                            <IconUser size={24} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{user?.full_name}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Admin ID: <strong style={{ color: 'var(--text)' }}>{user?.college_id}</strong>
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            backgroundColor: 'var(--surface-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-md)',
                            padding: '16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            fontSize: '0.825rem',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Role</span>
                            <span className="status-badge status-badge-primary">Campus Administrator</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Account Status</span>
                            <span className="status-badge status-badge-success">Active</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Member Since</span>
                            <span style={{ fontWeight: 600 }}>{formatDate(user?.created_at)}</span>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop: '18px',
                            padding: '14px',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--primary-subtle)',
                            border: '1px solid var(--primary-border)',
                            fontSize: '0.8rem',
                            color: 'var(--royal-purple)',
                            lineHeight: 1.45,
                            display: 'flex',
                            gap: '10px',
                        }}
                    >
                        <IconShield size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>
                            <strong>Locked out?</strong> There's no email-based recovery for admin accounts by
                            design. If you ever forget this password, it can only be reset from the server
                            itself with: <code>python cli.py reset-password {user?.college_id}</code>
                        </span>
                    </div>
                </div>

                {/* Change Password */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                        <IconLock size={20} style={{ color: 'var(--primary)' }} />
                        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Change Password</h2>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '16px' }}>
                        Update the password used to sign in to this admin panel.
                    </p>

                    {passError && (
                        <div
                            className="status-badge-danger"
                            style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '14px', display: 'block' }}
                        >
                            {passError}
                        </div>
                    )}

                    <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                            <label className="form-label">Current Password</label>
                            <input
                                type="password"
                                className="input-control"
                                placeholder="Current password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                required
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div>
                                <label className="form-label">New Password</label>
                                <input
                                    type="password"
                                    className="input-control"
                                    placeholder="At least 8 characters"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <label className="form-label">Confirm New Password</label>
                                <input
                                    type="password"
                                    className="input-control"
                                    placeholder="Re-enter new password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={changingPass}
                            style={{ marginTop: '6px' }}
                        >
                            {changingPass ? 'Updating...' : 'Save New Password'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}