# 06 - Auto Start

This step makes the Windows host start `autoM`, the local ops UI, and Tailscale
Funnel automatically after logon.

## What It Does

- Builds the shared packages once at startup.
- Starts the server on `http://127.0.0.1:4010`.
- Starts the ops UI on `http://localhost:4173`.
- Re-enables Tailscale Funnel for port `4010`.
- Writes logs under `var/logs/startup`.
- Places a visible `autoM Start` shortcut on the desktop.
- Places a visible `autoM UI` shortcut on the desktop.

## Install The Task

1. Open PowerShell on the Windows host.
2. From `C:\autoM`, run:
   ```powershell
   npm run windows:install-startup-task
   ```
3. The installer tries a logon task first. If Windows blocks that, it creates a
   hidden Startup-folder shortcut instead.
   It also places desktop shortcuts for manual launching and opening the UI.
4. Sign out and sign back in, or run the launcher manually if you want to test
   it immediately.
5. Confirm the server comes back on its own and the health endpoint responds:
   ```text
   http://localhost:4010/health
   ```

## What To Expect After Logon

- The app should be running without opening a terminal by hand.
- The ops UI should still be available at `http://localhost:4173`.
- The public YouTube callback should continue to use the Funnel URL.
- If the machine sleeps or loses power, the task will need to run again when
  the host is back.

## Stop Or Remove The Task

1. To remove the startup task later, run:
   ```powershell
   npm run windows:remove-startup-task
   ```
2. To inspect logs, open:
   - `var/logs/startup/boot.log`
   - `var/logs/startup/server.out.log`
   - `var/logs/startup/server.err.log`
   - `var/logs/startup/ops.out.log`
   - `var/logs/startup/ops.err.log`
   - `var/logs/startup/funnel.out.log`
   - `var/logs/startup/funnel.err.log`

## Operational Note

This is the host auto-start layer only. Scheduler timing and schedule editing
will move into the UI next.
