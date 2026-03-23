# 04 - Run The App

This step runs the app locally on the Windows host while Funnel exposes the API
callback publicly.

## Goal

Run the backend, ops UI, and scheduler against the local host services while
YouTube uses the Funnel callback URL.

## Runtime Environment

Use this baseline in `.env`:

```env
NODE_ENV=development
APP_URL=http://localhost:4010
APP_PORT=4010
SESSION_SECRET=replace-with-a-strong-secret
DATABASE_URL=var/db/autom.sqlite
MEDIA_ROOT=var
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
FFMPEG_COMMAND_TIMEOUT_SECONDS=600
ENABLED_PUBLISHER_PLATFORMS=local,youtube
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=https://<funnel-url>/publications/connections/youtube/callback
```

## Start The Apps

1. Start the server:
   ```powershell
   npm run dev:server
   ```
2. In a second terminal, start the ops UI:
   ```powershell
   npm run dev:ops
   ```
3. Confirm the local UI opens at `http://localhost:4173`.
4. Confirm the API answers on `http://localhost:4010/health`.

## Connect YouTube

1. Open the local ops UI.
2. Open the Connections page.
3. Connect YouTube from the YouTube card.
4. When Google shows the callback URL, make sure it is the Funnel URL from the
   previous step.
5. Keep `Local Archive` enabled in the profile while you test YouTube.

## Profile Setup

Set the launch profile to:

- `Local Archive`
- `YouTube`

Keep Facebook paused for now.

## Automation Note

Once manual startup is working, install the Windows startup task in
[06 - Auto Start](06-auto-start.md). That step makes the host relaunch the
server, ops UI, and Funnel automatically after logon.
