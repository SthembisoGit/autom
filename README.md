# autoM

`autoM` is a development-ready monorepo for a review-gated faceless video pipeline.
It includes a typed Fastify server, a React ops console, shared contracts, and a
minimal documentation set aligned to the planning baseline.

## Stack

- Node.js 24 Active LTS target
- TypeScript with strict mode
- Fastify server
- React + Vite ops UI
- SQLite-backed persistence for v1
- FFmpeg CLI rendering
- `@google/genai`, Deepgram, and Pexels provider boundaries

## Workspace

```text
apps/server   Fastify API, workflow orchestration, repositories, provider adapters
apps/ops      Internal control panel for review and history
packages/contracts  Shared schemas and domain types
packages/config     Shared environment parsing and runtime path helpers
docs/         System design, research, implementation planning, and progress tracking
infra/oracle  Legacy VPS deployment assets kept for reference
```

## Getting Started

1. Use Node.js 24 or newer.
2. Copy `.env.example` to `.env` and fill in the values you have today.
3. Run `npm install`.
4. Run `npm run dev:server`.
5. In a second terminal, run `npm run dev:ops`.
6. Use `npm run reset:dev` if you want a clean local dataset with the default profile restored.

The server seeds a default profile and creates runtime folders under `var/`
automatically on startup.

## Commands

- `npm run check` runs type checks, linting, and tests across the workspace.
- `npm run build` builds every package and app.
- `npm run dev:server` starts the Fastify API in watch mode.
- `npm run dev:ops` starts the Vite dev server for the ops UI.
- `npm run scheduler:tick:dev` runs one scheduler tick against the local environment.
- `npm run seed:dev` ensures the local default profile exists.
- `npm run reset:dev` clears local runtime data and reseeds the default profile.
  Stop running server processes first if the SQLite files are locked.

## Scheduler

- The server starts the in-process scheduler automatically when `SCHEDULER_ENABLED=true`.
- Scheduler state is visible from the dashboard and the `/scheduler` API.
- `POST /scheduler/run` forces a one-shot scheduler tick for validation or recovery.
- On a personal host, keep the machine awake while you expect automation to run.

## Personal Deployment

- The current no-card deployment path uses a Windows host you control plus Tailscale Funnel.
- The ops UI stays local on the host, and the Funnel URL is used for the YouTube OAuth callback.
- The step-by-step setup lives in [docs/deployment/production-setup/README.md](docs/deployment/production-setup/README.md).
- The archived Oracle notes live in [docs/deployment/oracle-free.md](docs/deployment/oracle-free.md).
- The legacy Oracle service and nginx templates remain in `infra/oracle/` for reference.
