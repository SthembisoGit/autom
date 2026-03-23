import { Link, Outlet, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/reviews', label: 'Review Queue' },
  { to: '/connections', label: 'Connections' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/history', label: 'History' },
];

export function Layout() {
  const location = useLocation();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-frame">
          <div>
            <p className="eyebrow">autoM Media</p>
            <h1 className="sidebar-title">Publishing Studio</h1>
            <p className="muted">
              Generate, review, and publish product-led videos from one workspace.
            </p>
          </div>

          <nav className="nav">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                className={`nav-link ${location.pathname === item.to ? 'nav-link-active' : ''}`}
                to={item.to}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-summary card">
          <p className="eyebrow">Launch path</p>
          <h3>Local Archive + YouTube</h3>
          <p className="muted">
            Keep the local archive on for verification, then publish to YouTube once the account is
            ready.
          </p>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Production console</p>
            <h2>autoM Media</h2>
            <p className="muted">
              Clean review, scheduling, and publishing controls in one workspace.
            </p>
          </div>

          <div className="workspace-header-actions">
            <span className="header-chip">Local + YouTube</span>

            <details className="header-menu">
              <summary className="button button-secondary">Settings</summary>
              <div className="header-menu-panel">
                <Link className="header-menu-link" to="/profiles">
                  Profiles
                </Link>
                <Link className="header-menu-link" to="/connections">
                  Connections
                </Link>
                <Link className="header-menu-link" to="/history">
                  History
                </Link>
              </div>
            </details>
          </div>
        </header>

        <main className="content">
          <div className="content-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
