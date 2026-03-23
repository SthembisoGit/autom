# 02 - Tailscale Funnel

This step makes the backend reachable over HTTPS without buying a domain.

## Goal

Expose the API on a public HTTPS URL that Google OAuth can redirect back to.

## Funnel

Use the host machine's Tailscale client and enable Funnel for the server port.

Recommended command:

```powershell
tailscale funnel --bg 4010
```

If this is the first time you enable Funnel, Tailscale may ask you to confirm
the change in the admin console or terminal prompt.

## What To Verify

1. The command prints or exposes a public `https://<machine>.<tailnet>.ts.net`
   URL.
2. `https://<funnel-url>/health` returns the server health JSON.
3. The URL stays live while the host machine and Tailscale are running.

## Ops UI

For this personal deployment path, keep the ops UI local on the host at
`http://localhost:4173`.

Only the API needs Funnel for the OAuth callback flow.

## Why This Step Matters

Google OAuth for YouTube should point to the exact HTTPS callback URL you get
from Funnel:

```text
https://<funnel-url>/publications/connections/youtube/callback
```

Do not move to the Google Cloud step until the Funnel URL is stable.
