# Research Register

This file captures the key implementation choices that came from the planning
research phase and are reflected in the repository scaffold.

## Decisions

- Use `@google/genai` rather than the legacy Gemini JavaScript SDK.
- Target stable Gemini model names instead of deprecated aliases.
- Use direct FFmpeg CLI execution instead of `fluent-ffmpeg`.
- Prefer an Oracle VPS scheduler/runtime model over GitHub Actions as the primary
  production scheduler for FFmpeg-heavy workloads.
- Keep the repo Docker-free by default because local development on this machine
  does not currently depend on Docker.

## Provider Boundaries

- Gemini script generation lives behind a provider interface.
- Deepgram narration lives behind a provider interface.
- Pexels stock lookups live behind a provider interface.
- YouTube, TikTok, and Facebook publishing live behind publisher adapters.

## Expected Follow-up

- Replace local fallback provider outputs with live provider calls as credentials
  are added.
- Complete live OAuth flows for the three publisher adapters.
- Expand FFmpeg composition from captioned previews to full footage + audio mixes.
