import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  IconDocument,
  IconWallet,
  IconPrinter,
  IconUser,
  IconShield,
  IconLogout,
  IconSun,
  IconMoon,
  IconMonitor,
} from './icons';

export function Navigation() {
  const { user, logoutUser, theme, setThemeMode, pendingRechargeCount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  const cycleTheme = () => {
    if (theme === 'system') setThemeMode('dark');
    else if (theme === 'dark') setThemeMode('light');
    else setThemeMode('system');
  };

  const isAdminPath = location.pathname.startsWith('/admin');

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="desktop-sidebar">
        {/* Brand Header */}
        <div
          style={{
            padding: '24px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--primary) 0%, #431278 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(121,40,202,0.3)',
              }}
            >
              <IconPrinter size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.02em' }}>
                Easy-Print
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-subtle)', fontWeight: 500 }}>
                Campus Print Cloud
              </div>
            </div>
          </div>
          <button
            onClick={cycleTheme}
            className="btn btn-ghost"
            style={{ padding: '6px', borderRadius: 'var(--radius-sm)' }}
            title={`Current theme: ${theme}. Click to switch.`}
            aria-label="Toggle visual theme"
          >
            {theme === 'light' ? (
              <IconSun size={17} />
            ) : (
              <IconMoon size={17} />
            )}
          </button>
        </div>

        {/* Navigation Links */}
        <nav style={{ padding: '16px 12px', flex: 1, overflowY: 'auto' }}>
          {isAdminPath ? (
            // Admin Navigation
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-subtle)',
                  padding: '4px 12px 8px',
                  letterSpacing: '0.05em',
                }}
              >
                Administration
              </div>
              <NavLink
                to="/admin"
                end
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconShield size={18} />
                <span>Overview</span>
              </NavLink>
              <NavLink
                to="/admin/recharges"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconWallet size={18} />
                  <span>Recharges</span>
                </div>
                {pendingRechargeCount > 0 && (
                  <span
                    style={{
                      background: 'var(--warning)',
                      color: '#ffffff',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '10px',
                    }}
                  >
                    {pendingRechargeCount}
                  </span>
                )}
              </NavLink>
              <NavLink
                to="/admin/users"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconUser size={18} />
                <span>Users</span>
              </NavLink>
              <NavLink
                to="/admin/stations"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconMonitor size={18} />
                <span>Stations</span>
              </NavLink>
              <NavLink
                to="/admin/pricing"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconDocument size={18} />
                <span>Pricing Rates</span>
              </NavLink>
              <NavLink
                to="/admin/audit"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconShield size={18} />
                <span>Audit Log</span>
              </NavLink>
              <NavLink
                to="/admin/account"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconUser size={18} />
                <span>My Account</span>
              </NavLink>
            </div>
          ) : (
            // Student Navigation
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-subtle)',
                  padding: '4px 12px 8px',
                  letterSpacing: '0.05em',
                }}
              >
                Student Portal
              </div>
              <NavLink
                to="/app"
                end
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconDocument size={18} />
                <span>Documents</span>
              </NavLink>
              <NavLink
                to="/app/wallet"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconWallet size={18} />
                <span>Wallet</span>
              </NavLink>
              <NavLink
                to="/app/prints"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconPrinter size={18} />
                <span>Print History</span>
              </NavLink>
              <NavLink
                to="/app/account"
                className={({ isActive }) =>
                  `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
                }
                style={{ justifyContent: 'flex-start', width: '100%', padding: '10px 14px' }}
              >
                <IconUser size={18} />
                <span>Account & PIN</span>
              </NavLink>
            </div>
          )}
        </nav>

        {/* User Card & Logout */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border)',
            backgroundColor: 'var(--surface-elevated)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <div style={{ overflow: 'hidden' }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                }}
              >
                {user?.full_name || 'Campus User'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                ID: {user?.college_id || '—'}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="btn btn-ghost"
              style={{ padding: '6px', color: 'var(--danger)' }}
              title="Sign out"
              aria-label="Sign out"
            >
              <IconLogout size={18} />
            </button>
          </div>
          {user?.role === 'admin' && !isAdminPath && (
            <button
              onClick={() => navigate('/admin')}
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '0.75rem', padding: '6px 10px' }}
            >
              Switch to Admin Panel
            </button>
          )}
          {user?.role === 'admin' && isAdminPath && (
            <button
              onClick={() => navigate('/app')}
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '0.75rem', padding: '6px 10px' }}
            >
              Switch to Student View
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <div className="mobile-tab-bar">
        {isAdminPath ? (
          <>
            <NavLink
              to="/admin"
              end
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px' }}
            >
              <IconShield size={18} />
              <span>Overview</span>
            </NavLink>
            <NavLink
              to="/admin/recharges"
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px', position: 'relative' }}
            >
              <IconWallet size={18} />
              <span>Recharges</span>
              {pendingRechargeCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '12px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: 'var(--warning)',
                  }}
                />
              )}
            </NavLink>
            <NavLink
              to="/admin/stations"
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px' }}
            >
              <IconMonitor size={18} />
              <span>Stations</span>
            </NavLink>
            <NavLink
              to="/admin/account"
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px' }}
            >
              <IconUser size={18} />
              <span>Account</span>
            </NavLink>
          </>
        ) : (
          <>
            <NavLink
              to="/app"
              end
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px' }}
            >
              <IconDocument size={18} />
              <span>Docs</span>
            </NavLink>
            <NavLink
              to="/app/wallet"
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px' }}
            >
              <IconWallet size={18} />
              <span>Wallet</span>
            </NavLink>
            <NavLink
              to="/app/prints"
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px' }}
            >
              <IconPrinter size={18} />
              <span>Prints</span>
            </NavLink>
            <NavLink
              to="/app/account"
              className={({ isActive }) =>
                `btn ${isActive ? 'btn-primary' : 'btn-ghost'}`
              }
              style={{ padding: '8px 12px', fontSize: '0.75rem', flexDirection: 'column', gap: '2px' }}
            >
              <IconUser size={18} />
              <span>Account</span>
            </NavLink>
          </>
        )}
      </div>
    </>
  );
}