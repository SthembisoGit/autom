# Implementation Plan

This folder is the execution layer for `autoM`. It turns the approved system
design into a step-by-step delivery path from the current scaffold to a live,
operator-ready v1 release.

## Planning Rules

- Keep work aligned to the modular monolith already in the repo.
- Finish one phase to a useful, testable state before widening scope.
- Prefer vertical slices that touch contracts, server, UI, tests, and docs
  together when a feature is user-visible.
- Do not introduce new tools, services, or deployment surfaces without updating
  `docs/research-register.md` and `docs/system-design.md`.

## Current Baseline

The following are already in place and should be treated as the starting point:

- Monorepo workspace with `apps/server`, `apps/ops`, `packages/contracts`, and
  `packages/config`
- Shared schema layer for jobs, profiles, review packages, and publication
  results
- Fastify API routes for dashboard, profiles, jobs, reviews, publications, and
  history
- SQLite-backed repository and runtime folder creation
- Stub or fallback provider boundaries for Gemini, Deepgram, Pexels, and the
  three publisher adapters
- FFmpeg preview renderer for a vertical captioned review package
- Ops UI pages for dashboard, reviews, run detail, profiles, and history
- CI, Node 24 runtime target, and legacy Oracle deployment scaffolding

## Current Workplan

Use [current-workplan.md](current-workplan.md) for the short-term execution
order after the active launch path. It captures the next four priorities in the
order they should be tackled:

1. Duration flexibility
2. Content improvement
3. YouTube publish verification
4. Launch backlog cleanup

## Delivery Phases

### Phase 1: Foundation Hardening

Objective: make the scaffold safe to build on every day.

Work packages:

- Confirm environment loading, runtime path creation, and local startup flow
- Clean up package entry points so shared packages support both dev and build use
- Add test coverage for env parsing, repository bootstrapping, and route errors
- Add a small seed/reset workflow for local development data
- Standardize error payloads and logging format across the API

Exit criteria:

- Fresh setup works with documented commands
- Shared package imports are stable in both watch mode and build output
- Core bootstrap and route tests cover the failure paths, not only happy paths

### Phase 2: Content Profile System

Objective: turn profiles into the real control surface for content generation.

Work packages:

- Expand profile fields for niche rules, banned topics, CTA policy, and prompt
  controls
- Add server-side validation for profile edits and profile-level defaults
- Improve the ops profile page with clearer form sections and save feedback
- Add tests for invalid profile updates and profile-based generation defaults

Exit criteria:

- A profile can fully describe how a content stream should behave in v1
- The ops UI can edit and persist profile settings without manual DB changes

### Phase 3: Script Generation With Live Gemini

Objective: replace fallback script generation with a production-grade AI flow.

Work packages:

- Finalize the prompt contract and expected structured JSON output
- Add schema validation and retry handling for malformed Gemini responses
- Persist prompt version metadata on jobs for traceability
- Add topic normalization and duplicate-job protection before generation
- Add tests for fallback behavior, malformed output, and provider timeouts

Exit criteria:

- Script generation is live when `GEMINI_API_KEY` is configured
- Failed AI output degrades safely and leaves a debuggable audit trail

### Phase 4: Voice and Asset Ingestion

Objective: move narration and stock selection from placeholders to live inputs.

Work packages:

- Implement live Deepgram narration with voice selection from profile defaults
- Implement live Pexels search with portrait-first filtering and fallback queries
- Store downloaded asset metadata and local file references in the review package
- Add cleanup rules for temporary assets after success and failure
- Add tests for missing results, network failure, and invalid asset responses

Exit criteria:

- Jobs can produce real narration and real stock selections when keys are present
- Asset and audio failure modes are visible in review warnings and audit logs

### Phase 5: Render Pipeline Expansion

Objective: upgrade the renderer from preview-only output toward the real v1 media
contract.

Work packages:

- Compose narration, timed captions, and selected footage into the master render
- Add thumbnail generation and render metadata collection
- Improve FFmpeg command construction and error capture
- Add render validation for duration, output dimensions, and file existence
- Add tests for cleanup, failure recovery, and bad media inputs

Exit criteria:

- Each successful job produces a reliable vertical master render plus subtitles
- Render failures do not leave temp files or incomplete job states behind

### Phase 6: Review Workflow and Ops UX

Objective: make the internal control panel fast and safe for daily operation.

Work packages:

- Improve dashboard summaries and review queue filtering
- Add richer run detail views for script, assets, render outputs, and audit events
- Add better review actions, confirmation states, and rejection notes
- Add empty, loading, and error states across all ops pages
- Add UI tests for approval, rejection, and history visibility

Exit criteria:

- A single operator can inspect, approve, reject, and understand each run without
  database access or log digging

### Phase 7: Publishing Integrations

Objective: move from stored stub results to real publication workflows.

Current launch note: TikTok is implemented behind a feature gate but is deferred
from the current release until its app-review, policy-page, and audit overhead is
worth absorbing.

Work packages:

- Implement YouTube OAuth and upload flow
- Implement TikTok posting flow and media transfer handling
- Implement Facebook Pages video publishing flow
- Persist external IDs, publish timestamps, and failure payload summaries
- Add publish gating rules so only approved jobs can be sent
- Add integration tests or provider-mocked tests for each platform adapter

Exit criteria:

- Approved jobs can be published to the configured target platforms
- Platform failures remain isolated and auditable per publication result

### Phase 8: Scheduling and Automation

Objective: make job creation repeatable without manual triggering.

Work packages:

- Implement a scheduler entry point that runs enabled profiles on cron
- Add duplicate-run protection by profile and time window
- Add retry and backoff policies for provider calls and publication attempts
- Add operator-visible status for scheduled runs and skipped runs
- Add tests around scheduling rules and duplicate protection

Exit criteria:

- Enabled profiles can generate jobs automatically while the host machine is running
- Scheduler behavior is predictable, traceable, and safe to restart

### Phase 9: Production Readiness

Objective: harden the app for single-host production use.

Work packages:

- Finalize the Funnel-based host setup, local startup flow, and automation guidance around the implemented runtime
- Add secret handling guidance and environment validation for production startup
- Add backup and restore guidance for SQLite and output media
- Add health-check, audit retention, and log rotation decisions
- Review auth/session needs for the ops UI if remote access is introduced

Exit criteria:

- The app can be deployed to the Funnel-based personal host with repeatable operational steps
- Production risks and maintenance tasks are documented and testable

### Phase 10: Launch Readiness

Objective: close the gap between a working system and a usable v1 release.

Work packages:

- Run end-to-end dry runs with at least one real profile and one real platform
- Review content quality, render quality, and reviewer workflow timing
- Finalize acceptance criteria for v1 and explicitly cut non-v1 ideas
- Prepare a post-launch backlog for v1.1 improvements

Exit criteria:

- The system can generate, review, and publish a real job end to end
- Remaining work is clearly classified as launch blocker or post-launch backlog

## Recommended Execution Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 10

## Working Rhythm

- Before starting a phase, copy the relevant items into
  `progress-tracker.md` as the active sprint focus.
- For near-term work that spans multiple phases, keep the execution order in
  `current-workplan.md` and reference it from the progress tracker.
- When a task changes system behavior, update tests in the same pass.
- When a phase is complete, record the decision, proof, and next dependency in
  `progress-tracker.md`.
