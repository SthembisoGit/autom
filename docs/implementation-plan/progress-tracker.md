# Progress Tracker

Use this file as the live record of delivery status. Update it at the end of
every meaningful work session.

## Project Status

| Area | Status | Notes |
| --- | --- | --- |
| Monorepo scaffold | Complete | Server, ops UI, shared packages, CI, and legacy Oracle infra files exist |
| Local Node runtime | Complete | Node 24 is installed and verified locally |
| Environment bootstrapping | Complete | `.env` exists and is loaded by the shared config package |
| API surface | In Progress | Core routes exist, but validation and error handling need hardening |
| Content profiles | Complete | Rich prompt rules, CTA policy controls, validation, and grouped profile UX are in place |
| Script generation | Complete | Live Gemini flow, structured-output repair handling, prompt trace metadata, and duplicate-job protection are in place |
| Voice generation | Complete | Deepgram writes narration assets into the runtime temp path with persisted audio metadata |
| Asset ingestion | Complete | Pexels search/download flow, portrait fallback queries, and per-scene asset metadata are in place |
| Render pipeline | Complete | Scene clip composition, narration mixing, thumbnail generation, and renderer validation are in place |
| Duration flexibility | Complete | Runtime ceiling raised to 180s, narration chunking added, and FFmpeg timeouts scale with configured duration |
| Platform persistence and retry handling | Complete | Enabled platforms now persist across refresh/restart, failed jobs mark retryable conditions, and retry actions are available from the UI |
| Review workflow UX | Complete | Loading, empty, and error states are consistent; review actions are confirmed; run detail and UI tests are expanded |
| Publishing | In Progress | Local Archive publish is verified for live-provider dry runs; YouTube is connected on the Funnel host path; connection state persists across refresh/restart; Facebook is paused for the next version; TikTok is feature-gated off and deferred to the next version |
| Scheduling | Complete | In-process scheduler, persisted scheduler runs, retry/backoff handling, manual tick endpoint, and dashboard visibility are in place |
| Production hardening | In Progress | Funnel-based personal deployment scaffolding, runtime validation, backup/restore guidance, log retention guidance, and local-host access controls are in place |
| Launch readiness | In Progress | Live providers and Local Archive are proven end to end; the next blocker is content improvement and then one more real YouTube publish validation |

## Phase Checklist

### Phase 1: Foundation Hardening

- [x] Node 24 runtime target set and verified
- [x] Local `.env` file added
- [x] `npm run check` passes
- [x] `npm run build` passes
- [x] Shared package entry points finalized for long-term build/runtime use
- [x] Bootstrap and route failure-path tests expanded
- [x] Local seed/reset workflow added
- [x] API error response format standardized

### Phase 2: Content Profile System

- [x] Basic profile schema and profile page created
- [x] Profile rules expanded for prompt controls and policy constraints
- [x] Profile form UX improved for daily operator use
- [x] Profile validation and tests expanded

### Phase 3: Script Generation With Live Gemini

- [x] Gemini provider boundary created
- [x] Live Gemini generation enabled and verified
- [x] Structured output retries and malformed-response handling added
- [x] Prompt versioning persisted on jobs
- [x] Duplicate-job protection added before generation

### Phase 4: Voice and Asset Ingestion

- [x] Deepgram provider boundary created
- [x] Pexels provider boundary created
- [x] Live narration generation implemented
- [x] Live stock search and download flow implemented
- [x] Asset metadata persistence expanded
- [x] Cleanup and failure-path coverage added

### Phase 5: Render Pipeline Expansion

- [x] FFmpeg renderer created
- [x] Vertical captioned preview output created
- [x] Real footage composition added
- [x] Narration mixing added
- [x] Thumbnail generation added
- [x] Render validation and cleanup coverage expanded

### Phase 6: Review Workflow and Ops UX

- [x] Dashboard page created
- [x] Reviews page created
- [x] Run detail page created
- [x] Profiles page created
- [x] History page created
- [x] Loading, empty, and error states improved
- [x] Review actions polished with confirmations and better feedback
- [x] UI test coverage expanded

### Phase 7: Publishing Integrations

- [x] YouTube adapter boundary created
- [x] TikTok adapter boundary created
- [x] Facebook adapter boundary created
- [x] YouTube OAuth and upload flow completed
- [x] TikTok is feature-gated off by default and explicitly deferred to the next version
- [x] Facebook Pages publishing flow completed
- [x] Local Archive publish path completed for non-social validation
- [x] Publication test coverage added

### Phase 8: Scheduling and Automation

- [x] Oracle cron scaffolding added
- [x] Scheduler runtime implemented
- [x] Duplicate-run protection added
- [x] Retry and backoff strategy added
- [x] Scheduled-run visibility added to ops UI

### Phase 9: Production Readiness

- [x] Funnel-based personal deployment scaffolding added
- [x] Runtime progress and failure visibility added for live generation and rendering
- [x] FFmpeg command timeout is configurable and enforced
- [x] Production env validation finalized
- [x] Backup and restore procedure documented
- [x] Log rotation and retention approach documented
- [x] Remote access and auth posture reviewed for the personal host path

### Phase 10: Launch Readiness

- [x] End-to-end dry run completed with live providers and Local Archive publish
- [ ] End-to-end dry run completed with at least one real platform publish
- [ ] YouTube connection verified with the production OAuth app
- [ ] V1 acceptance checklist signed off
- [ ] Post-launch backlog captured

## Active Focus

Current recommended next phase: `Content improvement`

Current recommended next tasks:

1. Use the supplied content brief to improve the generated videos now that the runtime and retry flow are stable.
2. Fold any topic-research inputs into the content pass only if they still improve the output.
3. Verify the YouTube publish path again after the content pass.

## Next Workplan

After the content pass is stable, follow this order from
[current-workplan.md](current-workplan.md):

1. Content improvement.
2. YouTube publish verification.
3. Launch backlog cleanup.

## Social Connection Checklist

- [x] Live Gemini, Deepgram, and Pexels generation verified in the app
- [x] Review package playback, subtitles, thumbnail, and audit visibility verified in the UI
- [x] Local Archive publish verified in the UI and on disk
- [x] Funnel-based personal deployment and OAuth callback guidance are documented
- [x] YouTube OAuth credentials added and Funnel callback verified
- [ ] First YouTube publish verified on the target channel
- [ ] Facebook Pages integration deferred to the next version
- [ ] V1 acceptance checklist signed off after the YouTube publish succeeds

## Risks and Blockers

- Facebook Pages OAuth app setup still needs exact redirect-uri, app-domain, and permission validation before it can re-enter the launch path.
- TikTok product review, policy pages, and Content Posting audit are deferred to
  the next version and are not part of the current launch path.
- Production auth strategy for the ops UI is intentionally deferred and needs a
  decision before remote exposure.
- First real social publish still depends on verified YouTube channel ownership,
  a working Google OAuth client, and the Funnel host staying online while the
  job is running.

## Session Log

### 2026-03-18

- Monorepo scaffold implemented across server, ops UI, shared packages, and docs.
- Node upgraded locally to `v24.14.0`.
- Native SQLite dependency rebuilt against Node 24.
- Local `.env` added and shared config updated to load it automatically.
- `npm run check` and `npm run build` verified successfully.
- Error-path stabilization completed for job generation, review actions, and publishing actions.
- API error responses now return consistent status codes and readable messages.
- Ops review and profile pages now catch failed actions instead of dropping unhandled promise rejections.
- Shared packages now export built `dist` artifacts while root workflows build them before dev, test, and server usage.
- Local `seed:dev` and `reset:dev` workflows were added and verified against the root runtime path.
- Production server startup now targets built output through `node dist/index.js`.
- Phase 2 content profile expansion is complete across contracts, server validation, generator inputs, profile UX, and route tests.
- Profile configuration now supports visual style rules, topic constraints, CTA policy controls, affiliate disclosure handling, and schema guidance for required versus optional v1 fields.
- Full verification passed again with `npm run check` and `npm run build`.
- Phase 3 script generation is complete with live Gemini wiring through the official web SDK export, structured JSON response handling, retry-and-repair behavior, prompt version metadata, and duplicate-job protection.
- Run detail now exposes script-generation trace metadata so provider mode, prompt version, and retry count are visible during review.
- Full verification passed again after the Gemini integration work with `npm run check` and `npm run build`.
- Live keys for Gemini, Deepgram, and Pexels were verified with a temporary end-to-end smoke generation run that reached `review_pending` using live providers and a stub renderer.
- Phase 4 voice and asset ingestion is implemented with narration asset references, Pexels clip downloads, richer per-asset provenance fields, and cleanup of partial job artifacts on downstream failures.
- Provider-level coverage now verifies Deepgram temp-file output, Pexels fallback search behavior, and no leftover partial files after failed clip downloads.
- Full verification passed again after the Phase 4 implementation with `npm run check` and `npm run build`.
- Phase 5 render expansion is complete with real clip preparation, scene concatenation, narration-aware preview assembly, thumbnail generation, and FFprobe-based output validation.
- Renderer coverage now verifies footage composition planning, narration-aware final assembly, thumbnail output, and rejection of invalid preview validation results.
- Full verification passed again after the Phase 5 implementation with `npm run check` and `npm run build`.
- Phase 6 review workflow UX is complete with reusable notice/state panels, safer confirmation-based review actions, richer run detail surfacing, and improved dashboard, history, and profile state handling.
- Ops UI coverage now includes review queue empty/busy states, review action copy, and run detail render/asset output rendering.
- Full verification passed again after the Phase 6 implementation with `npm run check` and `npm run build`.
- Phase 7 publishing integration is implemented with persisted platform connection records, OAuth start/callback/disconnect routes, real YouTube upload wiring through `googleapis`, TikTok direct-post upload handoff, Meta Page video publishing, and a new ops connections page.
- Publication status now supports asynchronous platform processing, and server route coverage now exercises the connection-management API surface.
- Full verification passed again after the Phase 7 implementation with `npm run check`.
- Phase 8 scheduling automation is implemented with persisted scheduler runs and state, cron validation, an in-process poll loop, duplicate-run protection, retry/backoff handling, a manual scheduler tick route and CLI, and dashboard visibility for scheduler health and recent runs.
- Oracle fallback scaffolding now includes a dedicated scheduler tick shell script, and environment defaults cover poll interval and retry behavior.
- Full verification passed again after the Phase 8 implementation with `npm run check`.

### 2026-03-19

- TikTok publishing was explicitly moved out of the current launch scope and into
  the next version because of TikTok app-review, privacy-policy, terms-page, and
  audit overhead.
- Platform availability is now deployment-configurable, with TikTok disabled by
  default so seeded profiles, publish flows, and ops UI target selectors adapt to
  the current v1 scope automatically.
- Docs now record TikTok as deferred instead of implying it is part of the
  immediate launch path.

### 2026-03-20

- Live-provider generation, review, render, and Local Archive publish were
  verified end to end from the ops UI.
- The server now surfaces clearer workflow stage progress, failure states, and
  render timeout protection so long-running live jobs fail visibly instead of
  hanging without operator feedback.
- The ops UI now shows clearer operator next steps around Local Archive
  validation and upcoming platform connection work, and the sidebar layout is
  pinned while the main content area scrolls independently.
- Launch readiness is now the active focus, with YouTube connection validation
  as the next milestone while Facebook is paused for the next version.
- A dedicated YouTube channel strategy was documented for `autoM Media`,
  narrowing the public content direction to `Tech, Tools & Curiosity` with
  AI tools, smart gadgets, and future-tech curiosity as the launch pillars.
- The seeded default content profile now matches `autoM Media`, and bootstrap
  safely upgrades untouched legacy default profiles from the old stoicism
  strategy to the new tech, tools, and curiosity direction.

### 2026-03-21

- Facebook Pages was paused for the next version after the Meta app setup hit
  app-domain and permission blockers.

### 2026-03-22

- Windows auto-start is now installed for the `C:\autoM` production host, with
  a desktop launch shortcut and a startup-folder launcher for logon recovery.
- The ops UI now includes a preset-first schedule editor on the Profiles page,
  with cron generation, next-run preview, and pause/resume controls.
- Scheduler restart recovery now clears stale draft jobs and stale running
  scheduler rows so the dashboard reflects real work instead of orphaned state.
- Duration flexibility is complete at the runtime level, including longer
  narration chunking and duration-aware FFmpeg timeouts.
- Enabled platform selections now persist across refresh/restart, failed jobs
  can be retried when the failure is transient, and the job monitor shows live
  animated progress cards while work is active.
- The next development phase is content improvement. Any topic-research inputs
  are deferred into the content-improvement pass if they still add value.
- The active launch path is now Local Archive plus YouTube, with the default
  enabled publisher platforms reduced to `local,youtube`.
- Launch readiness focus is now YouTube-only for v1; Facebook work remains in
  the next-version backlog.
- The active deployment path now uses a Windows host plus Tailscale Funnel for
  the API callback, with the ops UI staying local on the host.
- The personal deployment docs now live under `docs/deployment/production-setup/`
  and step through host prep, Funnel, Google OAuth, app runtime, and verification.

### 2026-03-22

- The Oracle path was retired from the active rollout docs.
- The Funnel-based personal deployment is now the clean no-card path for the
  current rollout.
- The ops UI stays local on the host, and only the API callback is exposed
  publicly through Tailscale Funnel.
- Windows startup-task scripts were added so the host can relaunch the server,
  ops UI, and Funnel after logon without manual terminal work.
- The Windows launcher fallback was installed in the current user Startup folder
  after Task Scheduler registration was blocked by permissions.
- A desktop shortcut copy was also installed for manual launch and inspection.
- A desktop UI shortcut was also installed so the ops console opens with one
  click after the host is running.
- Connection state now persists across refresh/restart so enabled publishers
  stay enabled until explicitly disconnected.
- Failed jobs now surface retryable states, and the dashboard and run detail
  pages expose retry actions for transient failures.
- The job monitor now uses a circle-based stepper loader with percentage
  milestones and ticked completed steps so active work is easier to read at a
  glance.
- The headline percentage on the loader now eases between stage targets instead
  of snapping abruptly on refresh.
- The next active product phase is content improvement, not more platform
  plumbing.
- FFmpeg scene and preview encoding now use a faster x264 preset with a larger
  default timeout so long renders are less likely to stall on weak hardware.

## Update Template

Copy this block when recording progress:

```md
### YYYY-MM-DD

- What changed:
- Proof:
- Risks:
- Next step:
```
