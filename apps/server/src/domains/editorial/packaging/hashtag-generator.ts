import type { ContentProfile } from '@autom/contracts';

const MAX_VIDEO_TAGS = 8;
const MAX_VIDEO_TAG_LENGTH = 40;
const MAX_VIDEO_TAG_WORDS = 4;
const VIDEO_TAG_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'that',
  'to',
  'with',
  'without',
]);

export function normalizeTags(input: unknown, profile: ContentProfile, topic: string): string[] {
  const source = Array.isArray(input) ? input : [];
  return buildVideoKeywords([
    profile.niche,
    topic,
    ...profile.defaultHashtags,
    ...source.flatMap((tag) => (typeof tag === 'string' ? splitTagSource(tag) : [])),
  ]);
}

export function buildVideoKeywords(values: string[]): string[] {
  const keywords = new Set<string>();

  for (const value of values) {
    for (const candidate of splitTagSource(value)) {
      const keyword = sanitizeVideoKeyword(candidate);
      if (!keyword) {
        continue;
      }

      keywords.add(keyword);
      if (keywords.size >= MAX_VIDEO_TAGS) {
        return Array.from(keywords);
      }
    }
  }

  return Array.from(keywords);
}

function splitTagSource(value: string): string[] {
  return value
    .split(/[,;\n|/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function sanitizeVideoKeyword(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/^#/, '')
    .replace(/["'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return null;
  }

  if (/^(https?|www)\b/i.test(normalized) || normalized.includes('://')) {
    return null;
  }

  const words = normalized.split(' ').filter(Boolean);
  const compressedWords = compressVideoKeywordWords(words);
  if (compressedWords.length === 0) {
    return null;
  }

  const keyword = compressedWords.join(' ').trim();
  if (keyword.length === 0 || keyword.length > MAX_VIDEO_TAG_LENGTH) {
    return null;
  }

  return keyword;
}

function compressVideoKeywordWords(words: string[]): string[] {
  const contentWords = words.filter((word) => !VIDEO_TAG_STOPWORDS.has(word));
  if (contentWords.length > 0) {
    return contentWords.slice(0, MAX_VIDEO_TAG_WORDS);
  }

  if (words.length <= MAX_VIDEO_TAG_WORDS) {
    return words;
  }

  return words.slice(0, MAX_VIDEO_TAG_WORDS);
}
