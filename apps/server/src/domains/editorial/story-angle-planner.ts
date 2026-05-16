import type { ContentCategory, TopicHookFormula } from '@autom/contracts';

import type { ContentBrief, NewsTopicContext, StoryAngle } from '../pipeline/types.js';

/**
 * Hook formula selector — picks the formula that best matches the content type
 * and category goal, then constructs a specific, high-stakes angle for the topic.
 *
 * Formulas:
 *   contradiction — "[X is good metric]. But [unexpected bad outcome]. Here is why."
 *   number        — "[Specific stat]. That changes how you think about [topic]."
 *   reversal      — "Everyone believes [assumption]. The data says the opposite."
 *   stakes        — "By [timeframe], [change]. Most people will not see it coming."
 */
export function buildStoryAngle(
  topic: string,
  category: ContentCategory | null,
  contentType: ContentBrief['contentType'],
  evidenceTitles: string[],
  newsContext: NewsTopicContext | null
): StoryAngle {
  const anchor = evidenceTitles[0] ?? newsContext?.title ?? topic;
  const topicLower = topic.toLowerCase();

  // ── Choose hook formula — category override wins if set ─────────────────
  const hookFormula: HookFormula =
    category?.topicHookFormula && category.topicHookFormula !== 'auto'
      ? (category.topicHookFormula as HookFormula)
      : resolveHookFormula(contentType, category, topicLower);
  const hookStyle = resolveHookStyle(contentType, hookFormula);

  // ── Build coreHook as a concrete, specific opening line ─────────────────
  const coreHook = buildCoreHook(hookFormula, topic, anchor, newsContext);

  // ── Curiosity gap — what the viewer does not know yet ───────────────────
  const curiosityGap = buildCuriosityGap(contentType, category, hookFormula);

  // ── High-stakes angle — what actually changes for people ────────────────
  const highStakesAngle = buildHighStakesAngle(contentType, category, topic);

  // ── Concrete implication — one specific real-world effect ───────────────
  const concreteImplication = buildConcreteImplication(contentType, category, topic);

  // ── Twist or payoff — the perspective shift at the end ──────────────────
  const twistOrPayoff = buildTwistOrPayoff(contentType, hookFormula, anchor, topic);

  // ── Visual moments — specific, filmable scenes to anchor the search ─────
  const visualMoments = buildVisualMoments(topic, anchor, category, contentType);

  return {
    coreHook,
    curiosityGap,
    highStakesAngle,
    concreteImplication,
    twistOrPayoff,
    visualMoments,
    hookStyle,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type HookFormula = 'contradiction' | 'number' | 'reversal' | 'stakes';

function resolveHookFormula(
  contentType: ContentBrief['contentType'],
  category: ContentCategory | null,
  topicLower: string
): HookFormula {
  if (contentType === 'recent_news') {
    // News: contradiction works best — "X just changed, but the part that matters is Y"
    return 'contradiction';
  }

  if (contentType === 'historical_topic') {
    // History: reversal is most compelling — reframe what people thought they knew
    return 'reversal';
  }

  if (contentType === 'product_or_tool_demo') {
    // Tools: stakes formula drives action — "by the time you finish this, you'll know whether X is worth it"
    return 'stakes';
  }

  if (category?.goal === 'revenue') {
    // Finance, business: number hooks drive highest engagement and DM shares
    return 'number';
  }

  // Default for explainers and education
  if (/\b(africa|south africa|economy|market|billion|million|percent|rate|price|cost)\b/.test(topicLower)) {
    return 'number';
  }

  return 'contradiction';
}

function resolveHookStyle(contentType: ContentBrief['contentType'], formula: HookFormula): string {
  if (contentType === 'recent_news') return 'fast-breaking explainer';
  if (contentType === 'historical_topic') return 'surprising reveal';
  if (contentType === 'product_or_tool_demo') return 'practical payoff';
  if (formula === 'number') return 'data-led reveal';
  if (formula === 'reversal') return 'myth-busting';
  if (formula === 'stakes') return 'urgency-driven';
  return 'contradiction-hook';
}

function buildCoreHook(
  formula: HookFormula,
  topic: string,
  anchor: string,
  newsContext: NewsTopicContext | null
): string {
  switch (formula) {
    case 'contradiction':
      return newsContext
        ? `${anchor} just changed — and the part most people miss is what happens next.`
        : `${topic} looks straightforward until you see the one detail that changes the whole picture.`;

    case 'number':
      return `There is a specific number attached to ${topic} that most people never hear — and once you know it, the whole story reads differently.`;

    case 'reversal':
      return `Most people think they understand ${topic}. The actual record says something different.`;

    case 'stakes':
      return `${topic} is shifting right now in a way that will matter to most people — and the window to understand it is closing.`;
  }
}

function buildCuriosityGap(
  contentType: ContentBrief['contentType'],
  category: ContentCategory | null,
  formula: HookFormula
): string {
  if (contentType === 'recent_news') {
    return 'Lead with what changed. Withhold the implication for one more beat so the viewer has to stay to get it.';
  }

  if (formula === 'number') {
    return 'State the number early but save what it implies until the middle of the script.';
  }

  if (formula === 'reversal') {
    return 'State the common assumption plainly. Let it sit for one beat before dismantling it.';
  }

  if (category?.goal === 'revenue') {
    return 'Show the money, market, or work consequence early — the viewer needs a financial reason to stay.';
  }

  return 'Reveal the hidden consequence in scene 2, not scene 1 — give the viewer a reason to keep watching.';
}

function buildHighStakesAngle(
  contentType: ContentBrief['contentType'],
  category: ContentCategory | null,
  topic: string
): string {
  const localRequired = category?.localContextRequired ?? false;
  if (contentType === 'recent_news') {
    return `Frame exactly what changes next for regular people, businesses, or markets because of ${topic}.`;
  }

  if (contentType === 'historical_topic') {
    return `Show how the historical pattern in ${topic} repeats in a way the viewer can see in their own life or work.`;
  }

  if (contentType === 'product_or_tool_demo') {
    return `Show the one workflow step ${topic} changes — not the feature list, but the before-and-after for a real task.`;
  }

  if (category?.goal === 'revenue') {
    const localNote = localRequired ? ' Use a local or regional example where possible.' : '';
    return `Name the specific financial decision, risk, or opportunity that ${topic} creates for someone watching this today.${localNote}`;
  }

  const localNote = localRequired ? ' Ground it in a local or regional context the target audience recognises.' : '';
  return `Frame the one decision, tradeoff, or reveal from ${topic} that changes what the viewer should think or do.${localNote}`;
}

function buildConcreteImplication(
  contentType: ContentBrief['contentType'],
  category: ContentCategory | null,
  topic: string
): string {
  if (contentType === 'product_or_tool_demo') {
    return `Show the exact screen, metric, or step where ${topic} saves or costs time in a real workflow.`;
  }

  if (category?.goal === 'revenue') {
    return `Translate ${topic} into one specific price, rate, percentage, or market movement the viewer can verify.`;
  }

  if (contentType === 'historical_topic') {
    return `Connect the historical event in ${topic} to a current pattern, policy, or price the viewer encounters today.`;
  }

  return `Reduce ${topic} to one specific real-world effect — a named place, number, person, or decision that proves the point.`;
}

function buildTwistOrPayoff(
  contentType: ContentBrief['contentType'],
  formula: HookFormula,
  anchor: string,
  topic: string
): string {
  if (contentType === 'historical_topic') {
    return `End on the historical turn that changes how the whole story of ${topic} feels — not a summary, a reframe.`;
  }

  if (formula === 'reversal') {
    return `The payoff is the moment the viewer realises the common assumption about ${topic} was exactly backwards.`;
  }

  if (formula === 'number') {
    return `The twist is what the number actually implies — most people read the headline but miss what the number means for them.`;
  }

  if (formula === 'contradiction') {
    return `Resolve the contradiction from scene 1: explain why ${anchor} produces the outcome that seemed impossible at the start.`;
  }

  return `End with the one insight from ${topic} that changes what the viewer should do, think, or watch next.`;
}

function buildVisualMoments(
  topic: string,
  anchor: string,
  category: ContentCategory | null,
  contentType: ContentBrief['contentType']
): string[] {
  const base = [topic, anchor].filter(Boolean);
  const lenses = category?.searchLenses.slice(0, 2) ?? [];

  // Add documentary-style visual cues based on content type
  const extra: string[] = [];
  if (contentType === 'historical_topic') {
    extra.push('archival footage', 'historical documents or photographs');
  } else if (contentType === 'recent_news') {
    extra.push('news context establishing shot', 'affected location or people');
  } else if (contentType === 'product_or_tool_demo') {
    extra.push('screen recording or dashboard close-up', 'before and after workflow');
  }

  return [...base, ...lenses, ...extra].filter(Boolean);
}
