import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', shortLabel: 'O' },
  { to: '/runs', label: 'Runs', shortLabel: 'R' },
  { to: '/reviews', label: 'Review', shortLabel: 'Rv' },
  { to: '/connections', label: 'Connections', shortLabel: 'C' },
  { to: '/profiles', label: 'Profiles', shortLabel: 'P' },
  { to: '/history', label: 'History', shortLabel: 'H' },
];

const SIDEBAR_STATE_KEY = 'autom-ops-sidebar-collapsed';

export function Layout() {
  return <LayoutShell />;
}

export function LayoutShell({ initialCollapsed }: { initialCollapsed?: boolean }) {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof initialCollapsed === 'boolean') {
      return initialCollapsed;
    }

    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(SIDEBAR_STATE_KEY) === 'true';
  });

  function isActivePath(path: string) {
    return path === '/'
      ? location.pathname === '/'
      : location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SIDEBAR_STATE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  return (
    <div className={`shell ${isCollapsed ? 'shell-collapsed' : ''}`}>
      <aside className={`sidebar ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-frame">
          <div className="sidebar-brand">
            <div className="sidebar-brand-copy">
              <p className="eyebrow">autoM Media</p>
              <h1 className="sidebar-title">Operations Console</h1>
              <p className="muted">
                Keep generation, review, publishing, and recovery in one focused workspace.
              </p>
            </div>
            <button
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="sidebar-toggle"
              onClick={() => setIsCollapsed((current) => !current)}
              type="button"
            >
              {isCollapsed ? '»' : '«'}
            </button>
          </div>

          <nav className="nav">
            {NAV_ITEMS.map((item) => (
              <Link
                aria-label={item.label}
                key={item.to}
                className={`nav-link ${isActivePath(item.to) ? 'nav-link-active' : ''}`}
                title={isCollapsed ? item.label : undefined}
                to={item.to}
              >
                <span className="nav-link-mark" aria-hidden="true">
                  {item.shortLabel}
                </span>
                <span className="nav-link-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-summary card">
            <p className="eyebrow">Mode</p>
            <h3>Local-first</h3>
            <p className="muted">
              Review the local render first, then push outward when the run is ready.
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
