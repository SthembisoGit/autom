# 01 - Host Machine

Prepare the Windows host first. Do not touch Google Cloud until this step is
ready.

## Goal

You need a single Windows machine that can run:

- the Fastify API
- the ops UI
- SQLite
- FFmpeg
- the scheduler

## Recommended Host

Use a Windows 11 or Windows 10 machine you can keep powered on while
automation is expected to run.

Reason:

- Tailscale Funnel exposes a local service on the host, it does not replace the
  host
- the app writes render outputs and connection data to the local filesystem
- keeping the host awake avoids losing a running job mid-render or mid-upload

## What To Install

Install these on the host:

- Node.js 24 or newer
- npm
- Git
- FFmpeg
- Tailscale

## Install Commands

Run these from an elevated PowerShell prompt on the Windows host:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Gyan.FFmpeg -e
winget install --id Tailscale.Tailscale -e
```

If `winget` is not available, install each tool from its official website.
Use Node 24 or newer, and restart PowerShell after the Node install so `node`
and `npm` resolve correctly on `PATH`.

## Quick Checks

Confirm the host has the tools before moving on:

```powershell
git --version
node --version
npm --version
ffmpeg --version
tailscale version
```

## Filesystem Layout

Use a stable local path such as `C:\autoM` as the deployment root.

```text
C:\autoM
C:\autoM\.env
C:\autoM\var\db\autom.sqlite
C:\autoM\var\output
C:\autoM\var\published
C:\autoM\var\log
```

## Repo Setup

1. Clone the repo into `C:\autoM`, or copy the current checkout there if you
   are already working from this machine.
2. Open a PowerShell prompt in that folder.
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Confirm the versions:
   ```powershell
   node --version
   npm --version
   ffmpeg --version
   ```
5. Confirm the app can build:
   ```powershell
   npm run build:packages
   npm --workspace @autom/server run build
   npm --workspace @autom/ops run build
   ```
6. Start the server and ops UI locally:
   ```powershell
   npm run dev:server
   npm run dev:ops
   ```
7. Confirm the local UI opens at `http://localhost:4173` and the API answers on
   `http://localhost:4010/health`.

## Power Management

Keep the host awake while automation is expected.

Recommended settings:

- set sleep to `Never` while the machine is in use
- disable hibernation if it interrupts long renders
- leave the machine plugged in when possible

## Outcome

At the end of this step:

- the host is prepared
- Node 24 and FFmpeg are installed
- the repo is cloned
- the server starts locally on the host
- the ops UI starts locally on the host
- the deployment root is `C:\autoM`
