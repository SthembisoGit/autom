# System Design

## Intent

`autoM` is intentionally structured as a modular monolith for v1. The backend owns
the workflow, the data model, and the review gate. The ops UI is a focused control
panel for an internal operator, not a public-facing product shell.

## Core Flow

1. A scheduler or manual command triggers a job for a content profile.
2. The server builds a `ScriptPackage` from the active profile and topic.
3. Asset and voice providers enrich the job with optional media context.
4. FFmpeg produces a vertical preview MP4 and a sidecar SRT file.
5. The review queue blocks publication until a human approves the package.
6. Publisher adapters store per-platform publish results once invoked.

## Script Generation

- The script provider uses Gemini with structured JSON output when `GEMINI_API_KEY`
  is configured, and falls back to a local deterministic generator when it is not.
- Gemini responses are validated against the shared script contract, retried on
  malformed output, and repaired through a second-pass prompt when the response
  shape is close but invalid.
- Jobs persist script-generation trace metadata, including provider, mode,
  prompt version, model, attempt count, and whether repair handling was needed.
- Active duplicate jobs for the same profile and topic are blocked before
  generation starts so the queue cannot fill with the same draft repeatedly.

## Storage

- SQLite stores profiles, jobs, audit events, and platform connection records in v1.
- Output media is written under `var/output/<job-id>/`.
- Temporary assets are written under `var/temp/<job-id>/` and cleaned up after use.

## Voice And Asset Ingestion

- Deepgram narration is written into `var/temp/<job-id>/voice/` and persisted into
  the review package as an audio asset reference with provider and MIME metadata.
- Pexels clip search runs per scene with portrait-oriented fallback queries, then
  downloads selected source clips into `var/temp/<job-id>/visuals/`.
- Asset references now persist local path, provider, source URL, MIME type,
  external IDs, scene order, and the matched search query so every selected input
  can be traced back during review.
- If a downstream render step fails, partial temp and output artifacts for that job
  are cleaned up before the failed state is stored.

## Render Pipeline

- FFmpeg prepares one normalized vertical clip per scene, using downloaded video
  footage when available and a deterministic solid-color fallback when it is not.
- Prepared scene clips are concatenated into a single preview timeline, then
  combined with narration audio and hard-burned captions to produce the review
  MP4 output.
- A thumbnail image is generated alongside the preview render and stored in the
  render bundle for later review and publishing workflows.
- FFprobe validates that the rendered preview has a usable duration before the
  review package is accepted.

## Publishing

- Each platform adapter owns its own OAuth connection lifecycle, including
  authorization start URLs, callback handling, stored token state, and publish
  execution.
- The server exposes connection-management routes for list, start, callback, and
  disconnect operations so the ops UI can manage the publishers enabled for the
  current deployment from one screen.
- YouTube publishing uses the official `googleapis` client for OAuth and video
  upload, with optional thumbnail upload after the main video insert succeeds.
- TikTok publishing uses the Content Posting API direct-upload flow: token
  exchange, creator-info lookup, upload initialization, media transfer, and
  status fetch, but it is feature-gated off by default for the current launch
  scope and deferred to the next version because of review, legal-page, and
  audit overhead.
- Facebook publishing uses Meta OAuth, long-lived user token exchange, Page token
  resolution, and Page video upload through the Graph API, but it is paused from
  the v1 launch path until the Meta setup is resolved.
- Publication results persist per-target outcomes and now distinguish between a
  completed publish and a platform that has accepted the upload but is still
  processing it.
- Production deployment is a single Oracle VM with split public origins:
  `api.<host>` serves the Fastify server and OAuth callbacks, while
  `app.<host>` serves the built ops UI through nginx. CORS is restricted to the
  ops origin in production.

## Scheduling

- The server includes an in-process scheduler loop that polls enabled profiles at
  a configurable interval and can also be triggered manually through a one-shot
  route or CLI command.
- Cron expressions are validated on profile update and normalized at runtime so
  the existing five-field profile UX stays compatible with strict scheduling
  evaluation.
- Each due slot is persisted as a scheduler-run record with a unique
  `profileId + scheduledFor` key so duplicate ticks or Oracle fallback triggers
  cannot enqueue the same scheduled run twice.
- Scheduler runs track attempt count, retry timing, terminal failure state, and
  created job ID so the ops UI can expose recent automation activity.
- Retry handling uses bounded backoff for transient failures while non-retryable
  validation and duplicate-active-job failures are marked as skipped or failed
  without cycling indefinitely.

## Design Principles

- One backend service, clear module boundaries, no premature microservices.
- Shared contracts are the single source of truth between server and ops UI.
- Runtime folders are not committed to git.
- Documentation stays intentionally small and stays close to the implementation.

## Profile Controls

- V1 profiles define niche, tone, visual style, prompt directives, and generation
  defaults such as scene count and max duration.
- Topic guardrails are profile-driven through preferred topics, banned topics, and
  banned terms.
- CTA policy is explicit in the profile model, including CTA style, guardrails,
  affiliate link handling, and disclosure requirements.
- Required v1 profile fields are exposed from the API so the ops UI can present a
  stable editing surface without hard-coding business rules in multiple places.
