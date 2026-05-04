# Content Pipeline Refactor Plan

## Goal
Restructure `autoM` into a staged content system that can improve quality, reliability, and growth without stacking more logic into the same files.

The app should stop behaving like a single-step generator and instead behave like a pipeline:

1. Strategy
2. Research
3. Editorial
4. Visuals
5. Production
6. Publishing
7. Learning

## Principles
- The system should choose better opportunities before it tries to generate more videos.
- Factual content should fail early if evidence or visuals are weak.
- Rendering should assemble a plan, not compensate for a weak plan.
- Each stage should produce structured output and clear audit data.
- Quality gates should stop bad runs before narration and render.

## Target Server Structure
Move toward this structure inside `apps/server/src`:

```text
src/
  domains/
    strategy/
      category-engine.ts
      monetization-planner.ts
      country-priority.ts
      topic-candidate-ranker.ts

    research/
      topic-discovery.ts
      evidence-service.ts
      search/
        tavily-search.ts
        google-news-context.ts
      rerank/
        cohere-rerank.ts
      verification/
        evidence-quality.ts
        freshness-check.ts

    editorial/
      story-angle-planner.ts
      editorial-brief-builder.ts
      script-quality.ts
      packaging/
        title-generator.ts
        caption-generator.ts
        hashtag-generator.ts
        cta-generator.ts
      providers/
        gemini-script-writer.ts
        groq-script-fallback.ts
        mistral-script-fallback.ts

    visuals/
      visual-source-planner.ts
      visual-selection-service.ts
      visual-ranking.ts
      visual-coverage.ts
      providers/
        wikimedia-provider.ts
        pixabay-provider.ts
        pexels-provider.ts
        news-context-provider.ts

    production/
      narration-service.ts
      subtitle-service.ts
      audio-bed-service.ts
      render/
        ffmpeg-renderer.ts
        scene-composer.ts

    publishing/
      publish-service.ts
      platforms/
        youtube-publisher.ts
        facebook-publisher.ts

    learning/
      performance-ingest.ts
      category-performance.ts
      packaging-feedback.ts
      insight-service.ts
```

## Canonical Pipeline Types
These should become first-class types instead of loose metadata blobs:

- `ContentCategory`
- `TopicCandidate`
- `EvidenceItem`
- `EvidenceBundle`
- `StoryAngle`
- `EditorialBrief`
- `ScenePlan`
- `VisualPlan`
- `VisualSelectionOutcome`
- `RenderPlan`
- `PublishPlan`
- `PerformanceSnapshot`

These can start server-local and move into shared contracts once stable.

## Stage Contract Pattern
Each stage should return a structured result:

```ts
type StageResult<T> = {
  ok: boolean;
  data: T | null;
  warnings: string[];
  errors: string[];
  audit: string[];
  degraded: boolean;
};
```

This keeps retries, failures, and degraded behavior explicit.

## End-to-End Pipeline
The target flow should be:

1. Choose a category
2. Generate topic candidates
3. Score candidates
4. Verify evidence
5. Choose a story angle
6. Build an editorial brief
7. Generate a script
8. Validate script quality
9. Build a visual plan
10. Validate visual coverage
11. Narrate and render
12. Publish
13. Record performance
14. Feed performance back into strategy

## Phase Plan

### Phase 1: Domain Split
Goal: separate responsibilities without large behavior changes.

Actions:
- Create `apps/server/src/domains/`
- Move existing logic into the closest domain
- Keep current workflow running with adapters where needed
- Avoid rewriting business logic in this phase

Initial mapping:
- category/topic scoring -> `strategy`
- Tavily/Cohere/news context -> `research`
- script prompt building/validation -> `editorial`
- visual planning/provider routing -> `visuals`
- narration/subtitles/render -> `production`
- platform publishing -> `publishing`

### Phase 2: Canonical Types
Goal: replace implicit stage data with explicit typed objects.

Actions:
- Add `TopicCandidate`
- Add `EvidenceBundle`
- Add `StoryAngle`
- Add `EditorialBrief`
- Add `VisualPlan`
- Thread them through the pipeline without changing render or publish behavior yet

### Phase 3: Thin Orchestrator
Goal: one coordinator, not one god file.

Actions:
- Create `ContentPipelineOrchestrator`
- Make it call stages in order
- Keep provider-specific logic inside domain services
- Remove planning logic from provider classes over time

### Phase 4: Strategy Layer
Goal: make topic choice deliberate and revenue-aware.

Actions:
- Implement `category-engine.ts`
- Implement `monetization-planner.ts`
- Implement `topic-candidate-ranker.ts`
- Implement `country-priority.ts`

Outputs:
- selected category
- ranked topic candidates
- monetization score
- target country bias

### Phase 5: Research Layer
Goal: make factual input trustworthy and current.

Actions:
- Implement `topic-discovery.ts`
- Implement `evidence-service.ts`
- Implement Tavily search
- Implement Google News context support
- Implement Cohere rerank
- Implement evidence and freshness checks

Rule:
- weak factual evidence should fail early

### Phase 6: Editorial Layer
Goal: stronger hooks, clearer scripts, less AI-sounding content.

Actions:
- Implement `story-angle-planner.ts`
- Implement `editorial-brief-builder.ts`
- Implement `script-quality.ts`
- Split packaging generation from script generation
- Keep script provider adapters inside `editorial/providers/`

Editorial brief should include:
- category
- story angle
- hook
- curiosity gap
- stakes
- real-world implication
- likely visual moments
- tone rules
- runtime target

### Phase 7: Visuals Layer
Goal: exact visuals first, relevant fallback second, random stock last.

Actions:
- Implement `visual-source-planner.ts`
- Implement `visual-selection-service.ts`
- Implement `visual-ranking.ts`
- Implement `visual-coverage.ts`
- Split providers into dedicated files

Per-scene visual plan should record:
- scene intent
- query variants
- provider family order
- selected asset
- match quality
- reuse status
- fallback reason

### Phase 8: Production Layer
Goal: production assembles a plan rather than improvising.

Actions:
- Introduce `narration-service.ts`
- Introduce `subtitle-service.ts`
- Introduce `audio-bed-service.ts`
- Move render-specific logic under `production/render/`

Rule:
- production should not decide editorial strategy
- production should not invent visual direction

### Phase 9: Publishing Layer
Goal: isolate delivery logic and make publish retries clearer.

Actions:
- Add `publish-service.ts`
- Move platform-specific logic under `publishing/platforms/`
- Keep current routes stable while extracting logic

### Phase 10: Quality Gates
Goal: kill weak runs before expensive stages.

Required gates before render:
- evidence quality pass
- editorial brief pass
- script quality pass
- visual coverage pass
- pacing/runtime pass

If a gate fails:
- retry that stage
- or fail the run early

### Phase 11: Persistence Cleanup
Goal: make pipeline decisions inspectable.

Persist at least as structured job metadata:
- selected category
- ranked candidates
- evidence bundle
- story angle
- editorial brief
- visual plan
- render outcomes
- publish outcomes
- performance snapshot

These can later move to dedicated tables if needed.

### Phase 12: Ops UI Restructure
Goal: operate the pipeline, not just monitor runs.

Add or expand pages for:
- Overview
- Opportunities
- Editorial
- Runs
- Publishing
- Performance
- Profiles
- Connections

Highest-value additions:
- `Opportunities`
- `Editorial`
- `Performance`

### Phase 13: Learning Layer
Goal: make content improve from real results.

Actions:
- Implement `performance-ingest.ts`
- Implement `category-performance.ts`
- Implement `packaging-feedback.ts`
- Implement `insight-service.ts`

Track performance by:
- category
- platform
- runtime bucket
- hook style
- title style
- opening pattern
- visual exactness
- country cluster

## Migration Order
Implement in this order:

1. Domain split
2. Canonical pipeline types
3. Thin orchestrator
4. Strategy layer
5. Research layer
6. Editorial layer
7. Visuals layer
8. Quality gates
9. Persistence cleanup
10. UI pages
11. Learning layer

## Current Starting Point
The safest first implementation step is:

1. create the `domains/` structure
2. move existing code into those folders with minimal behavior change
3. add canonical types
4. introduce the thin orchestrator skeleton

That keeps risk low while giving the rest of the refactor a stable base.

## First Execution Slice
The first real implementation slice after this plan should be:

- extract current category/topic scoring into `domains/strategy/`
- extract current research orchestration into `domains/research/`
- extract script brief + validator logic into `domains/editorial/`
- leave current routes and workflow in place, but make them call the new modules through adapters

This is the best starting point because it improves structure without forcing a full rewrite.
