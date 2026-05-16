import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/',            label: 'Overview',     icon: '◈' },
  { to: '/runs',        label: 'Runs',         icon: '▶' },
  { to: '/reviews',     label: 'Review',       icon: '✓' },
  { to: '/profiles',    label: 'Profiles',     icon: '◎' },
  { to: '/connections', label: 'Connections',  icon: '⊕' },
  { to: '/history',     label: 'History',      icon: '◷' },
];

const SIDEBAR_STATE_KEY = 'autom-ops-sidebar-collapsed';

export function Layout() {
  return <LayoutShell />;
}

export function LayoutShell({ initialCollapsed }: { initialCollapsed?: boolean }) {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof initialCollapsed === 'boolean') return initialCollapsed;
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_STATE_KEY) === 'true';
  });

  function isActivePath(path: string) {
    return path === '/'
      ? location.pathname === '/'
      : location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_STATE_KEY, String(isCollapsed));
    }
  }, [isCollapsed]);

  return (
    <div className={`shell ${isCollapsed ? 'shell-collapsed' : ''}`}>
      <aside className={`sidebar ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-frame">
          <div className="sidebar-brand">
            <div className="sidebar-brand-copy">
              <p className="eyebrow">autoM</p>
              <h1 className="sidebar-title" style={{ fontSize: '1rem', margin: 0 }}>
                Ops Console
              </h1>
            </div>
            <button
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="sidebar-toggle"
              onClick={() => setIsCollapsed((c) => !c)}
              type="button"
            >
              {isCollapsed ? '›' : '‹'}
            </button>
          </div>

          <nav className="nav" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <Link
                aria-label={item.label}
                key={item.to}
                className={`nav-link ${isActivePath(item.to) ? 'nav-link-active' : ''}`}
                title={isCollapsed ? item.label : undefined}
                to={item.to}
              >
                <span className="nav-link-mark" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="nav-link-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-summary card">
            <p className="eyebrow" style={{ marginBottom: 4 }}>Mode</p>
            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
              Local-first — review render, then publish.
            </p>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <main className="content">
          <div className="content-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
