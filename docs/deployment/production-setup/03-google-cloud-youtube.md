# 03 - Google Cloud YouTube

Create a separate Google Cloud project for YouTube publishing.

## Goal

Get an OAuth client that can connect the host machine to the target YouTube
channel.

## Create The Project

1. Open Google Cloud Console.
2. Create a new project for `autoM`.
3. Enable `YouTube Data API v3`.

## Configure OAuth Consent

1. Open the OAuth consent screen configuration.
2. Choose the external app path unless this is Workspace-only.
3. Add your app name and icon.
4. Add a support email.
5. Add a privacy policy URL.
6. Add a terms of service URL.
7. Add a data deletion URL.
8. Add the authorized domain if you have one for your policy pages.

## Scopes

Request only the scopes the app uses:

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`

## Create The OAuth Client

1. Create a **Web application** OAuth client.
2. Add the exact Funnel callback URL from the previous step:
   ```text
   https://<funnel-url>/publications/connections/youtube/callback
   ```
3. Save the `Client ID` and `Client secret`.

## Testing Note

For a personal deployment, add your Google account as a test user if the app
stays in testing.

If you later want months-long unattended access without reauth, you will need a
Google production OAuth setup on a host or domain you control. Funnel is the
clean no-card path, not the final long-term Google production identity.

## What To Verify

1. The OAuth client exists.
2. The callback URI matches the Funnel URL exactly.
3. Your Google account can complete the consent flow.
