# Current Workplan

This document is the short-term execution order for the production checkout at
`C:\autoM`.

Follow this order unless I explicitly tell you to pause or reprioritize:

1. Improve the content creation pass using the now-stable runtime, monitor,
   persistence, and retry flow.
2. Revisit topic-research inputs only if they still help the content pass.
3. Verify the YouTube publish path again after the content pass.

Current status:

- The runtime, persistence, and retry foundations are complete.
- Item 1 is queued as the next active product-improvement pass.
- Item 2 is deferred into item 1 if it still adds value.
- Item 3 remains the launch-verification step after the content pass.

## 1. Content Improvement

Objective:
- Improve the actual video quality now that the runtime, persistence, and retry
  flow are stable.

Target outcome:
- Stronger hooks, better pacing, better titles, better visual direction, and
  less repetitive output.

Exit criteria:
- The generated videos are materially better than the current baseline.
- Any topic-research inputs that still help topic quality are folded into this
  pass.
- The profile settings, schedule controls, and retry flow remain clean while
  content quality is being tuned.

## 2. YouTube Publish Verification

Objective:
- Confirm the production OAuth path and publish flow still work after the
  content changes.

Target outcome:
- One real publish succeeds on the target channel.

Exit criteria:
- The app can still connect and publish after the duration/content changes.
- Remaining work after that is categorized as post-launch backlog.

## Working Rule

- Do not start the next item until the current item is documented, verified, or
  explicitly paused.
- Update `docs/implementation-plan/progress-tracker.md` at the end of each
  meaningful session so the live status stays aligned with this order.
