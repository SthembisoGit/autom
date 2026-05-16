import type { ContentProfile, ScriptPackage } from '@autom/contracts';

import {
  estimateNarrationDurationSeconds,
  getNarrationOvershootAllowanceSeconds,
} from '../../lib/content-quality.js';
import type { ContentBrief } from '../pipeline/types.js';

export const MIN_SCENE_DURATION_SECONDS = 3;

export type ScenePlan = {
  minSceneCount: number;
  targetSceneCount: number;
  maxSceneCount: number;
};

export const CONCRETE_SCENE_RULES = [
  // Structure
  "Structure every script as three beats: (1) disruption — a fact or question that breaks the viewer's existing mental model; (2) evidence stack — 3-5 escalating details that raise the stakes scene by scene; (3) reframe — a perspective shift that makes the viewer feel they now see something others don't.",
  'Every scene must mention one concrete artifact: a named tool, workflow step, metric, comparison, real place, or documented event.',
  'Do not write general background paragraphs that could fit any topic.',
  'Middle scenes must add a distinct example, contrast, or consequence — never rephrase the same idea from the prior scene.',
  'The final scene must deliver the reframe payoff and then close with the CTA.',
  'Avoid abstract filler words like opportunity, landscape, transformation, leverage, ecosystem, or game changer unless paired with a named example.',
  'If the topic is broad, narrow it to a specific use case, tool, platform, decision, or documented moment.',

  // Scene 1 hook — REQUIRED
  'Scene 1 MUST open with one of these four hook formulas — choose the one that fits the topic best:',
  '  Hook A — The Contradiction: "[X] is [positive metric]. But [unexpected outcome]. Here is why."',
  '  Hook B — The Number: "[Specific number]. That is how many [thing] [happened]. And it changes how you think about [topic]."',
  '  Hook C — The Reversal: "Everyone believes [common assumption]. The data says the opposite."',
  '  Hook D — The Stakes: "By [timeframe], [thing] will [dramatic change]. Most people will not see it coming."',
  "Scene 1 must not start with 'In today's video', 'Today we are going to', 'Welcome back', or any generic preamble.",
  'Scene 1 must feel like something the viewer did not know 10 seconds ago — stop-the-scroll energy.',

  // Visual queries — REQUIRED FORMAT
  'Every visualQuery must describe a specific filmable thing as a documentary crew would see it — name objects, actions, settings, and time of day if relevant.',
  'Good visualQuery examples: "cargo containers unloaded at harbour at dawn", "trader watching stock screens in dark office", "solar panels on township rooftop", "1970s archival footage factory workers on assembly line".',
  'Bad visualQuery examples: "economic activity", "technology background", "business concept", "people and money", "success".',
  'Never use abstract nouns alone in a visualQuery. Always anchor it to a visible physical scene.',

  // Escalation
  'Each scene must raise the stakes, introduce a new complication, or deliver a new piece of evidence. A video that flatlines in the middle loses viewers.',
  'If a scene could be deleted without losing meaning, delete it and redistribute its words to adjacent scenes.',
];

const GENERIC_FILLER_PATTERNS = [
  /\bin today's world\b/i,
  /\bit's important to\b/i,
  /\bthis shows that\b/i,
  /\bthe key takeaway\b/i,
  /\bgame changer\b/i,
  /\bleverage\b/i,
];
const DIRECT_CONCRETE_DEMO_PATTERN =
  /(for example|example|compare|comparison|instead of|before|after|workflow|step-by-step|demo|walkthrough|case study|scenario)/i;
const CONCRETE_ARTIFACT_PATTERN =
  /\b(tool|software|platform|dashboard|spreadsheet|calculator|template|checklist|playbook|crm|pipeline|keyword|campaign|ad set|report|account|pricing|trial|screen|tab|filter|metric|score|benchmark|ira|401k|portfolio|expense ratio|contribution|match|deal|rent|cash flow|cap rate|valuation|workflow|automation)\b/i;
const ACTIONABLE_VERB_PATTERN =
  /\b(use|open|check|track|map|export|filter|route|audit|review|test|compare|price|budget|rebalance|contribute|forecast|segment|score|calculate|screen|move|plug|sync|automate|trim|cluster)\b/i;
const QUANTIFIED_DETAIL_PATTERN = /\b(?:\$?\d[\d,.]*%?|\d{4})\b/;
const NEWS_CONCRETE_PATTERN =
  /\b(according to|reported|announced|said|filed|launched|released|approved|blocked|acquired|raised|cut|tariff|market|shares|company|government|agency|minister|president|court|earnings|forecast|deal|merger|outage|update)\b/i;
const INTERNAL_FALLBACK_PATTERN =
  /\b(local fallback context|fallback context|entity disambiguation|manual workflow|records than|practical applications)\b/i;
const FACTUAL_PLACEHOLDER_VISUAL_PATTERN =
  /\b(bar chart|flowchart|dashboard|tool screenshot|manual workflow|comparison chart|split screen)\b/i;
const BORING_SCENE_OPENING_PATTERN =
  /^(today we|in this video|let's talk about|this is|here we|most people|when it comes to)\b/i;
const GENERIC_ANY_TOPIC_PATTERN =
  /\b(everything is changing|the world is moving fast|this matters more than ever|businesses are under pressure|people are paying attention)\b/i;
const JARGON_HEAVY_PATTERN =
  /\b(landscape|leverage|ecosystem|transformation|unlock|optimize|synergy|seamless|paradigm|frictionless|stakeholders|utilize)\b/i;
const ROBOTIC_TRANSITION_PATTERN =
  /\b(moreover|furthermore|additionally|in today's world|it is important to note|delve into|moving forward)\b/i;
const AI_CLICHE_PATTERN =
  /\b(the interesting part of|the real problem is|the payoff is|what most people miss|the simple version is|that means fewer|clearer output|process that is easier to repeat)\b/i;

export function allocateDurations(weights: number[], targetTotal: number): number[] {
  if (weights.length === 0) {
    return [];
  }

  const minimumTotal = weights.length * MIN_SCENE_DURATION_SECONDS;
  if (targetTotal < minimumTotal) {
    throw new Error(
      `Target total duration must allow at least ${MIN_SCENE_DURATION_SECONDS} seconds per scene.`
    );
  }

  const normalizedWeights = weights.map((weight) => Math.max(1, Math.floor(weight)));
  const remainingDuration = targetTotal - minimumTotal;

  if (remainingDuration === 0) {
    return Array.from({ length: weights.length }, () => MIN_SCENE_DURATION_SECONDS);
  }

  const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const allocations = normalizedWeights.map((weight, index) => {
    const exact = (remainingDuration * weight) / weightTotal;
    const value = Math.floor(exact);
    return {
      index,
      value,
      fraction: exact - value,
    };
  });

  let leftover = remainingDuration - allocations.reduce((sum, item) => sum + item.value, 0);
  const prioritized = [...allocations].sort((left, right) => {
    if (right.fraction !== left.fraction) {
      return right.fraction - left.fraction;
    }

    return left.index - right.index;
  });

  let cursor = 0;
  while (leftover > 0) {
    prioritized[cursor % prioritized.length].value += 1;
    leftover -= 1;
    cursor += 1;
  }

  return allocations.map((item) => MIN_SCENE_DURATION_SECONDS + item.value);
}

export function resolveTargetDurationSeconds(
  sceneTexts: string[],
  maxDurationSeconds: number,
  requestedTotalDurationSeconds: number | null = null
): number {
  const minimumDurationSeconds = Math.max(1, sceneTexts.length) * MIN_SCENE_DURATION_SECONDS;
  const estimatedNarrationSeconds = estimateNarrationDurationSeconds(sceneTexts);
  const naturalDurationSeconds = Math.max(
    minimumDurationSeconds,
    Math.ceil(estimatedNarrationSeconds + 2)
  );
  const requestedDurationSeconds =
    typeof requestedTotalDurationSeconds === 'number' &&
    Number.isFinite(requestedTotalDurationSeconds)
      ? Math.max(minimumDurationSeconds, Math.round(requestedTotalDurationSeconds))
      : null;

  return Math.min(
    maxDurationSeconds,
    requestedDurationSeconds
      ? Math.min(requestedDurationSeconds, naturalDurationSeconds)
      : naturalDurationSeconds
  );
}

export function validateScriptTiming(scriptPackage: ScriptPackage, profile: ContentProfile): void {
  const estimatedNarrationSeconds = estimateNarrationDurationSeconds(
    scriptPackage.scenes.map((scene) => scene.text)
  );
  const budgetAllowanceSeconds = getNarrationOvershootAllowanceSeconds(profile.maxDurationSeconds);
  const minimumNarrationSeconds = Math.max(
    scriptPackage.scenes.length * 2.5,
    Math.round(scriptPackage.totalDurationSeconds * 0.65)
  );

  if (estimatedNarrationSeconds > profile.maxDurationSeconds + budgetAllowanceSeconds) {
    throw new Error(
      `Gemini response exceeds the duration budget by ${Math.ceil(
        estimatedNarrationSeconds - profile.maxDurationSeconds
      )} seconds. Regenerate the script.`
    );
  }

  if (estimatedNarrationSeconds < minimumNarrationSeconds) {
    throw new Error(
      `Script underfills the runtime budget by ${Math.ceil(
        minimumNarrationSeconds - estimatedNarrationSeconds
      )} seconds. Regenerate the script with fuller but still concrete narration.`
    );
  }
}

export function validateScriptDirectionQuality(
  scriptPackage: ScriptPackage,
  contentBrief: ContentBrief | null
): void {
  const lowerSceneTexts = scriptPackage.scenes.map((scene) => scene.text.toLowerCase());
  if (new Set(lowerSceneTexts).size <= Math.max(2, Math.floor(scriptPackage.scenes.length * 0.6))) {
    throw new Error('Script repeats too much and lacks scene-to-scene progression.');
  }

  for (const scene of scriptPackage.scenes) {
    if (GENERIC_FILLER_PATTERNS.some((pattern) => pattern.test(scene.text))) {
      throw new Error('Script contains generic filler language and must be more concrete.');
    }
    if (JARGON_HEAVY_PATTERN.test(scene.text)) {
      throw new Error(
        'Script uses jargon-heavy language and must be rewritten in simpler English.'
      );
    }
    if (ROBOTIC_TRANSITION_PATTERN.test(scene.text)) {
      throw new Error('Script sounds robotic and must use more natural spoken phrasing.');
    }
    if (AI_CLICHE_PATTERN.test(scene.text)) {
      throw new Error('Script uses generic AI-style phrasing and needs a more human rewrite.');
    }
    if (
      INTERNAL_FALLBACK_PATTERN.test(scene.text) ||
      INTERNAL_FALLBACK_PATTERN.test(scene.visualQuery)
    ) {
      throw new Error(
        'Script contains internal fallback placeholder language and must be regenerated.'
      );
    }
    if (GENERIC_ANY_TOPIC_PATTERN.test(scene.text)) {
      throw new Error('Script sounds interchangeable and must be rewritten with sharper detail.');
    }
  }

  const openingScene = scriptPackage.scenes[0];
  if (openingScene && BORING_SCENE_OPENING_PATTERN.test(openingScene.text)) {
    throw new Error('Opening scene is too generic and needs a stronger hook.');
  }

  const nonFinalScenes = scriptPackage.scenes.slice(
    1,
    Math.max(2, scriptPackage.scenes.length - 1)
  );
  const hasConcreteDemo = nonFinalScenes.some((scene) => hasConcreteSceneSignal(scene.text));
  if (!hasConcreteDemo) {
    throw new Error('Script must include at least one practical comparison or concrete example.');
  }

  if (contentBrief?.storyAngle) {
    const fullText = scriptPackage.scenes.map((scene) => scene.text).join(' ');
    const hookTokens = contentBrief.storyAngle.coreHook
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 4);
    const matchedHookTokens = hookTokens.filter((token) => fullText.toLowerCase().includes(token));
    if (matchedHookTokens.length === 0) {
      throw new Error('Script ignored the planned story angle and needs a sharper editorial pass.');
    }
  }

  if (contentBrief?.exactEvidenceRequired) {
    const hasAnchoredScene = scriptPackage.scenes.some(
      (scene) =>
        contentBrief.keyEntities.some((entity) =>
          scene.text.toLowerCase().includes(entity.toLowerCase())
        ) ||
        contentBrief.evidence.items.some((item) =>
          item.title
            .toLowerCase()
            .split(/\s+/)
            .filter((token) => token.length > 4)
            .some((token) => scene.text.toLowerCase().includes(token))
        )
    );

    if (!hasAnchoredScene) {
      throw new Error('Factual script is not anchored strongly enough to real evidence.');
    }

    for (const scene of scriptPackage.scenes) {
      if (FACTUAL_PLACEHOLDER_VISUAL_PATTERN.test(scene.visualQuery)) {
        throw new Error(
          'Factual script requested a fake or generic visual instead of an exact visual target.'
        );
      }
    }
  }
}

export function deriveScenePlan(maxDurationSeconds: number): ScenePlan {
  if (maxDurationSeconds <= 45) {
    return { minSceneCount: 3, targetSceneCount: 3, maxSceneCount: 4 };
  }

  if (maxDurationSeconds <= 75) {
    return { minSceneCount: 3, targetSceneCount: 4, maxSceneCount: 5 };
  }

  if (maxDurationSeconds <= 105) {
    return { minSceneCount: 4, targetSceneCount: 5, maxSceneCount: 6 };
  }

  if (maxDurationSeconds <= 135) {
    return { minSceneCount: 5, targetSceneCount: 6, maxSceneCount: 7 };
  }

  if (maxDurationSeconds <= 165) {
    return { minSceneCount: 6, targetSceneCount: 7, maxSceneCount: 8 };
  }

  return { minSceneCount: 6, targetSceneCount: 8, maxSceneCount: 8 };
}

function hasConcreteSceneSignal(text: string): boolean {
  return (
    DIRECT_CONCRETE_DEMO_PATTERN.test(text) ||
    CONCRETE_ARTIFACT_PATTERN.test(text) ||
    NEWS_CONCRETE_PATTERN.test(text) ||
    (ACTIONABLE_VERB_PATTERN.test(text) && QUANTIFIED_DETAIL_PATTERN.test(text)) ||
    (ACTIONABLE_VERB_PATTERN.test(text) &&
      /\b(screen|tab|dashboard|calculator|template|report)\b/i.test(text))
  );
}
