import type { ContentProfile, SceneSpec } from '@autom/contracts';

import type {
  ContentBrief,
  VisualProviderFamily,
  VisualSceneKind,
  VisualScenePlan,
} from '../pipeline/types.js';

export type VisualPlannerResult = {
  plan: VisualScenePlan;
  warnings: string[];
};

const VISUAL_QUERY_STOPWORDS = new Set([
  // Original function words
  'about', 'after', 'before', 'because', 'could', 'every', 'from', 'have',
  'into', 'just', 'like', 'most', 'only', 'over', 'some', 'that', 'their',
  'there', 'these', 'they', 'this', 'what', 'when', 'where', 'which', 'with', 'would',
  // Narrative / abstract verbs that produce bad stock queries
  'affect', 'affects', 'affected', 'affecting',
  'impact', 'impacts', 'impacted', 'impacting',
  'cause', 'causes', 'caused', 'causing',
  'change', 'changes', 'changed', 'changing',
  'result', 'results', 'resulted', 'resulting',
  'effect', 'effects',
  'reality', 'truth', 'story', 'explain', 'explains', 'understand',
  'mean', 'means', 'meant', 'meaning',
  'show', 'shows', 'showing', 'shown',
  'look', 'looks', 'looking',
  'think', 'thinks', 'thought',
  'know', 'knows', 'known',
  'make', 'makes', 'made', 'making',
  'need', 'needs', 'needed',
  'want', 'wants', 'wanted',
  'happen', 'happens', 'happened', 'happening',
  // Narrative phrase starters
  'here', 'also', 'however', 'actually', 'really', 'very', 'quite', 'rather',
  'already', 'still', 'even', 'much', 'many', 'more', 'less', 'than',
  'will', 'been', 'being', 'were', 'while', 'since', 'until', 'through',
]);

/**
 * Strips abstract narrative language from a planner query, leaving only
 * concrete nouns, proper nouns, and specific adjectives.
 * This is the core fix for generic stock footage selection.
 */
function stripNarrativeLanguage(value: string): string {
  return value
    .replace(/\b(the impact of|the effect of|the reality of|the truth about|the story of|how .+? affects?|why .+? matters?|what .+? means?|the rise of|the fall of|the cost of|the price of|the role of|the power of|the future of|the problem with|the challenge of)\b/gi, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildVisualScenePlan(
  scene: SceneSpec,
  profile: ContentProfile,
  contentBrief: ContentBrief | null
): VisualPlannerResult {
  const sceneKind = classifySceneKind(scene, contentBrief);
  const querySet = buildPlannerQueries(scene, profile, contentBrief, sceneKind);
  const keyEntities = extractVisualEntities(scene, contentBrief);
  const exactMatchRequired = isExactVisualMatchRequired(sceneKind);
  const allowStockFallback =
    sceneKind === 'generic_business_or_lifestyle' ||
    sceneKind === 'product_or_tool_demo' ||
    sceneKind === 'place_or_institution';

  return {
    plan: {
      sceneOrder: scene.order,
      sceneKind,
      queries: querySet,
      keyEntities,
      preferredProviders: resolveProviderFamilies(sceneKind),
      exactMatchRequired,
      allowStockFallback,
    },
    warnings:
      exactMatchRequired && keyEntities.length === 0
        ? [`Scene ${scene.order} looks factual but no strong entity hints were resolved.`]
        : [],
  };
}

export function classifySceneKind(
  scene: SceneSpec,
  contentBrief: ContentBrief | null
): VisualSceneKind {
  if (contentBrief?.contentType) {
    return contentBrief.contentType;
  }

  const text = `${scene.text} ${scene.visualQuery}`.toLowerCase();
  if (/\b(news|reported|announced|today|latest|update|headline)\b/.test(text)) {
    return 'recent_news';
  }
  if (/\b(history|historical|legacy|mandela|president|war|empire)\b/.test(text)) {
    return 'historical_topic';
  }
  if (/\b(tool|software|dashboard|app|platform|workflow|seo|crm|automation)\b/.test(text)) {
    return 'product_or_tool_demo';
  }
  if (extractCapitalizedEntities(`${scene.text} ${scene.visualQuery}`).length > 0) {
    return 'named_person_or_event';
  }

  return 'generic_business_or_lifestyle';
}

export function isExactVisualMatchRequired(sceneKind: VisualSceneKind): boolean {
  return (
    sceneKind === 'recent_news' ||
    sceneKind === 'named_person_or_event' ||
    sceneKind === 'historical_topic'
  );
}

export function extractCapitalizedEntities(value: string): string[] {
  return Array.from(
    new Set(
      value.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)?.map((match) => match.trim()) ?? []
    )
  );
}

function buildPlannerQueries(
  scene: SceneSpec,
  profile: ContentProfile,
  contentBrief: ContentBrief | null,
  sceneKind: VisualSceneKind
): string[] {
  const evidenceQueries =
    contentBrief?.evidence.items
      .slice(0, 3)
      .map((item) => item.title.trim())
      .filter((value) => value.length > 0) ?? [];
  const desiredVisualQueries = contentBrief?.desiredVisuals.slice(0, 2) ?? [];
  const factualScene = [
    'recent_news',
    'named_person_or_event',
    'historical_topic',
    'place_or_institution',
  ].includes(sceneKind);

  return Array.from(
    new Set(
      [
        ...extractEntityFocusedQueries(scene, contentBrief),
        ...extractSceneSpecificQueries(scene),
        ...evidenceQueries,
        ...desiredVisualQueries,
        scene.visualQuery,
        normalizePlannerQuery(scene.text),
        // NOTE: visualStyle and niche are intentionally NOT concatenated into queries.
        // Doing so creates 200+ character strings that cause Pixabay 400 errors.
        // The visualQuery field from the script already encodes the intent clearly.
      ].filter((value) => value && value.trim().length > 0)
    )
  ).map((q) => {
    // Hard cap at 100 chars — prevents API 400 errors from long queries.
    // Also strip trailing standalone numbers (scene order leaking from text).
    return q.replace(/\s+\d{1,3}\s*$/, '').trim().slice(0, 100);
  }).filter((q) => q.length >= 4)
  .slice(0, 5);
}

function extractSceneSpecificQueries(scene: SceneSpec): string[] {
  const tokens = tokenize(scene.text).filter((token) => !VISUAL_QUERY_STOPWORDS.has(token));
  const compactActionQuery = tokens.slice(0, 6).join(' ').trim();
  const verbAnchoredQuery = tokens.slice(0, 3).concat(tokens.slice(-2)).join(' ').trim();

  return [compactActionQuery, verbAnchoredQuery]
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length >= 8);
}

function extractEntityFocusedQueries(
  scene: SceneSpec,
  contentBrief: ContentBrief | null
): string[] {
  const entities = extractVisualEntities(scene, contentBrief);
  if (entities.length === 0) {
    return [];
  }

  return [
    entities.join(' '),
    `${entities[0]} ${scene.visualQuery}`,
    `${entities[0]} ${scene.text}`.replace(/[^\w\s]/g, ' '),
  ].map((value) => value.trim());
}

function extractVisualEntities(scene: SceneSpec, contentBrief: ContentBrief | null): string[] {
  const entities = new Set<string>(contentBrief?.keyEntities ?? []);
  for (const entity of extractCapitalizedEntities(`${scene.text} ${scene.visualQuery}`)) {
    entities.add(entity);
  }

  return Array.from(entities).slice(0, 4);
}

function resolveProviderFamilies(sceneKind: VisualSceneKind): VisualProviderFamily[] {
  switch (sceneKind) {
    case 'recent_news':
      // News context first, then Internet Archive for historical context footage
      return ['news_context', 'internet_archive', 'wikimedia', 'pixabay', 'pexels'];
    case 'historical_topic':
      // Internet Archive has the best historical footage — Prelinger, NARA, newsreels
      return ['internet_archive', 'nasa', 'wikimedia', 'pixabay', 'pexels'];
    case 'named_person_or_event':
      // Wikimedia for well-documented public figures; Archive as depth fallback
      return ['wikimedia', 'internet_archive', 'pixabay', 'pexels'];
    case 'generic_business_or_lifestyle':
      return ['pexels', 'pixabay', 'wikimedia'];
    case 'product_or_tool_demo':
      return ['pixabay', 'pexels', 'wikimedia'];
    case 'place_or_institution':
      return ['wikimedia', 'internet_archive', 'pixabay', 'pexels'];
    default:
      return ['pexels', 'pixabay', 'wikimedia'];
  }
}

function normalizePlannerQuery(value: string): string {
  const stripped = stripNarrativeLanguage(value);
  // Filter out stopwords and short tokens, keep meaningful noun phrases
  const tokens = stripped
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !VISUAL_QUERY_STOPWORDS.has(token.toLowerCase()));
  return tokens.join(' ').trim();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}
