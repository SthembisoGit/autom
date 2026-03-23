import { useCallback, useEffect, useState } from 'react';

import type { Platform, PlatformConnection } from '@autom/contracts';

import { apiClient } from '../api/client';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { PLATFORM_ORDER, formatPlatformLabel } from '../lib/platforms';

export function ConnectionsPage() {
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null);
  const pushToast = useToast();

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        if (!options?.background) {
          setIsLoading(true);
        }

        const loadedConnections = await apiClient.listConnections();
        setConnections(sortConnections(loadedConnections));
        setLoadFailed(false);
      } catch (value) {
        setLoadFailed(true);
        pushToast({
          tone: 'danger',
          title: 'Connections refresh failed',
          message:
            value instanceof Error ? value.message : 'Unable to load publishing connections.',
        });
      } finally {
        if (!options?.background) {
          setIsLoading(false);
        }
      }
    },
    [pushToast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const payload = event.data as
        | {
            source?: string;
            ok?: boolean;
            platform?: string;
            message?: string;
          }
        | undefined;

      if (payload?.source !== 'autom-publication-connection') {
        return;
      }

      pushToast({
        tone: payload.ok ? 'success' : 'danger',
        title: payload.ok ? 'Connection updated' : 'Connection failed',
        message: payload.message ?? 'Platform connection state changed.',
      });
      void load({ background: true });
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [load, pushToast]);

  function handleConnect(platform: Platform) {
    const popup = window.open(
      apiClient.getConnectionStartUrl(platform),
      `${platform}-connect`,
      'popup=yes,width=720,height=840'
    );

    if (!popup) {
      window.location.assign(apiClient.getConnectionStartUrl(platform));
    }
  }

  async function handleDisconnect(platform: Platform) {
    try {
      setBusyPlatform(platform);
      const connection = await apiClient.disconnectConnection(platform);
      await load({ background: true });
      pushToast({
        tone: 'warning',
        title: 'Connection removed',
        message: `${formatPlatformLabel(connection.platform)} was disconnected.`,
      });
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Disconnect failed',
        message: value instanceof Error ? value.message : 'Unable to disconnect the platform.',
      });
    } finally {
      setBusyPlatform(null);
    }
  }

  if (isLoading && connections.length === 0) {
    return (
      <section>
        <header className="page-header">
          <div>
            <p className="eyebrow">Connections</p>
            <h2>Publishing Connections</h2>
            <p className="section-subtitle muted">
              Connect external platforms when their accounts are ready.
            </p>
          </div>
        </header>

        <StatePanel
          description="Loading platform readiness, saved account state, and reconnect requirements."
          title="Loading connections"
        />
      </section>
    );
  }

  if (loadFailed && connections.length === 0) {
    return (
      <section>
        <header className="page-header">
          <div>
            <p className="eyebrow">Connections</p>
            <h2>Publishing Connections</h2>
            <p className="section-subtitle muted">
              Connect external platforms when their accounts are ready.
            </p>
          </div>
        </header>

        <StatePanel
          actionLabel="Retry"
          description="Refresh the page after the connection recovers."
          onAction={() => void load()}
          title="Connections are temporarily unavailable"
          tone="danger"
        />
      </section>
    );
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Connections</p>
          <h2>Publishing Connections</h2>
          <p className="section-subtitle muted">
            Keep the local archive target active, then connect YouTube and Facebook when ready.
          </p>
        </div>
      </header>

      <div className="grid grid-two">
        {connections.map((connection) => {
          const isBusy = busyPlatform === connection.platform;
          const isLocalArchive = connection.platform === 'local';

          return (
            <article className="card" key={connection.platform}>
              <div className="row-between">
                <div>
                  <h3>{formatPlatformLabel(connection.platform)}</h3>
                  <p className="muted">{connection.accountLabel ?? 'No account connected'}</p>
                </div>
                <StatusBadge status={connection.status} />
              </div>

              <dl className="detail-list detail-list-compact">
                <div>
                  <dt>Configured</dt>
                  <dd>{connection.configured ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt>Connected</dt>
                  <dd>{connection.connected ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt>Connected at</dt>
                  <dd>{connection.connectedAt ? formatDateTime(connection.connectedAt) : 'n/a'}</dd>
                </div>
                <div>
                  <dt>Access token expiry</dt>
                  <dd>{connection.expiresAt ? formatDateTime(connection.expiresAt) : 'n/a'}</dd>
                </div>
              </dl>

              {isLocalArchive ? (
                <p className="muted">No connection step is required for Local Archive.</p>
              ) : connection.connected ? (
                <p className="muted">This connection stays enabled until you disconnect it.</p>
              ) : (
                <div className="action-bar">
                  <button
                    className="button button-primary"
                    disabled={!connection.configured || isBusy}
                    onClick={() => handleConnect(connection.platform)}
                    type="button"
                  >
                    {connection.connected ? 'Reconnect' : 'Connect'}
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={!connection.connected || isBusy}
                    onClick={() => void handleDisconnect(connection.platform)}
                    type="button"
                  >
                    {isBusy ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function sortConnections(connections: PlatformConnection[]): PlatformConnection[] {
  return [...connections].sort(
    (left, right) =>
      PLATFORM_ORDER.indexOf(left.platform as Platform) -
      PLATFORM_ORDER.indexOf(right.platform as Platform)
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}
