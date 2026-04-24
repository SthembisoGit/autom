import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

export const PUBLISHER_PLATFORMS = ['local', 'youtube', 'tiktok', 'facebook'] as const;
export type PublisherPlatform = (typeof PUBLISHER_PLATFORMS)[number];
export const DEFAULT_ENABLED_PUBLISHER_PLATFORMS = ['local', 'youtube'] as const;

const booleanFromEnvSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}, z.boolean());

export const AppEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:4010'),
  OPS_URL: z.string().url().optional(),
  APP_PORT: z.coerce.number().int().positive().default(4010),
  SESSION_SECRET: z.string().min(8).default('replace-me-in-development'),
  DATABASE_URL: z.string().min(1).default('var/db/autom.sqlite'),
  MEDIA_ROOT: z.string().min(1).default('var'),
  MANUAL_CLIP_WAIT_SECONDS: z.coerce.number().int().min(60).default(900),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  FFMPEG_COMMAND_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(600),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_SCRIPT_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_SCRIPT_MODEL: z.string().min(1).default('llama-3.3-70b-versatile'),
  GROQ_SCRIPT_TIMEOUT_SECONDS: z.coerce.number().int().min(15).default(45),
  GROQ_TRANSCRIPTION_MODEL: z.string().min(1).default('whisper-large-v3-turbo'),
  GROQ_TRANSCRIPTION_TIMEOUT_SECONDS: z.coerce.number().int().min(15).default(120),
  TAVILY_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_SCRIPT_MODEL: z.string().min(1).default('mistral-small-latest'),
  MISTRAL_SCRIPT_TIMEOUT_SECONDS: z.coerce.number().int().min(15).default(45),
  DEEPGRAM_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  SCHEDULER_ENABLED: booleanFromEnvSchema.default(true),
  SCHEDULER_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  SCHEDULER_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  SCHEDULER_RETRY_BASE_SECONDS: z.coerce.number().int().min(15).default(300),
  ENABLED_PUBLISHER_PLATFORMS: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().optional(),
  META_PAGE_ID: z.string().optional(),
});

export type AppEnv = z.infer<typeof AppEnvSchema>;

export type RuntimePaths = {
  mediaRoot: string;
  dbDirectory: string;
  tempDirectory: string;
  outputDirectory: string;
  publishedDirectory: string;
  logDirectory: string;
  manualClipDirectory: string;
};

export const RUNTIME_DIRECTORIES = [
  'var/db',
  'var/temp',
  'var/output',
  'var/published',
  'var/log',
  'var/manual-clips',
] as const;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const shouldLoadEnvFile = source === process.env;
  const envFilePath = shouldLoadEnvFile ? findEnvFilePath(process.cwd()) : null;
  if (envFilePath && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envFilePath);
  }

  const parsed = AppEnvSchema.parse(source);
  validateProductionEnv(parsed);
  if (!envFilePath) {
    return parsed;
  }

  const envDirectory = dirname(envFilePath);
  return {
    ...parsed,
    DATABASE_URL: resolveEnvPath(parsed.DATABASE_URL, envDirectory),
    MEDIA_ROOT: resolveEnvPath(parsed.MEDIA_ROOT, envDirectory),
  };
}

export function resolveRuntimePaths(mediaRoot: string): RuntimePaths {
  return {
    mediaRoot,
    dbDirectory: join(mediaRoot, 'db'),
    tempDirectory: join(mediaRoot, 'temp'),
    outputDirectory: join(mediaRoot, 'output'),
    publishedDirectory: join(mediaRoot, 'published'),
    logDirectory: join(mediaRoot, 'log'),
    manualClipDirectory: join(mediaRoot, 'manual-clips'),
  };
}

export function hasLiveGemini(env: AppEnv): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

export function hasLiveGroq(env: AppEnv): boolean {
  return Boolean(env.GROQ_API_KEY);
}

export function hasLiveTavily(env: AppEnv): boolean {
  return Boolean(env.TAVILY_API_KEY);
}

export function hasLiveCohere(env: AppEnv): boolean {
  return Boolean(env.COHERE_API_KEY);
}

export function hasLiveMistral(env: AppEnv): boolean {
  return Boolean(env.MISTRAL_API_KEY);
}

export function hasLiveDeepgram(env: AppEnv): boolean {
  return Boolean(env.DEEPGRAM_API_KEY);
}

export function hasLivePexels(env: AppEnv): boolean {
  return Boolean(env.PEXELS_API_KEY);
}

export function hasLivePixabay(env: AppEnv): boolean {
  return Boolean(env.PIXABAY_API_KEY);
}

export function getEnabledPublisherPlatforms(env: AppEnv): PublisherPlatform[] {
  const configuredPlatforms = normalizePublisherPlatforms(env.ENABLED_PUBLISHER_PLATFORMS);
  return configuredPlatforms.length > 0
    ? configuredPlatforms
    : [...DEFAULT_ENABLED_PUBLISHER_PLATFORMS];
}

export function isPublisherEnabled(env: AppEnv, platform: PublisherPlatform): boolean {
  return getEnabledPublisherPlatforms(env).includes(platform);
}

export function isPublisherConfigured(env: AppEnv, platform: PublisherPlatform): boolean {
  if (platform === 'local') {
    return true;
  }

  if (platform === 'youtube') {
    return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET);
  }

  if (platform === 'tiktok') {
    return Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
  }

  return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_PAGE_ID);
}

function findEnvFilePath(startDirectory: string): string | null {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const candidate = join(currentDirectory, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function resolveEnvPath(value: string, baseDirectory: string): string {
  return isAbsolute(value) ? value : resolve(baseDirectory, value);
}

function normalizePublisherPlatforms(value: string | undefined): PublisherPlatform[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(',')
        .map((platform) => platform.trim().toLowerCase())
        .filter((platform): platform is PublisherPlatform =>
          PUBLISHER_PLATFORMS.includes(platform as PublisherPlatform)
        )
    )
  );
}

function validateProductionEnv(env: AppEnv): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const issues: string[] = [];

  if (!env.OPS_URL) {
    issues.push('OPS_URL is required in production.');
  } else if (!isPublicHttpsUrl(env.OPS_URL)) {
    issues.push('OPS_URL must be a public https URL in production.');
  }

  if (!isPublicHttpsUrl(env.APP_URL)) {
    issues.push('APP_URL must be a public https URL in production.');
  }

  if (isPlaceholderSecret(env.SESSION_SECRET)) {
    issues.push('SESSION_SECRET must be replaced with a strong secret in production.');
  }

  for (const platform of getEnabledPublisherPlatforms(env)) {
    if (platform === 'youtube') {
      if (!env.YOUTUBE_CLIENT_ID) {
        issues.push('YOUTUBE_CLIENT_ID is required in production when YouTube is enabled.');
      }

      if (!env.YOUTUBE_CLIENT_SECRET) {
        issues.push('YOUTUBE_CLIENT_SECRET is required in production when YouTube is enabled.');
      }

      if (!env.YOUTUBE_REDIRECT_URI) {
        issues.push('YOUTUBE_REDIRECT_URI is required in production when YouTube is enabled.');
      } else if (!isPublicHttpsUrl(env.YOUTUBE_REDIRECT_URI)) {
        issues.push('YOUTUBE_REDIRECT_URI must be a public https URL in production.');
      }
    }

    if (platform === 'tiktok') {
      if (!env.TIKTOK_CLIENT_KEY) {
        issues.push('TIKTOK_CLIENT_KEY is required in production when TikTok is enabled.');
      }

      if (!env.TIKTOK_CLIENT_SECRET) {
        issues.push('TIKTOK_CLIENT_SECRET is required in production when TikTok is enabled.');
      }

      if (!env.TIKTOK_REDIRECT_URI) {
        issues.push('TIKTOK_REDIRECT_URI is required in production when TikTok is enabled.');
      } else if (!isPublicHttpsUrl(env.TIKTOK_REDIRECT_URI)) {
        issues.push('TIKTOK_REDIRECT_URI must be a public https URL in production.');
      }
    }

    if (platform === 'facebook') {
      if (!env.META_APP_ID) {
        issues.push('META_APP_ID is required in production when Facebook is enabled.');
      }

      if (!env.META_APP_SECRET) {
        issues.push('META_APP_SECRET is required in production when Facebook is enabled.');
      }

      if (!env.META_PAGE_ID) {
        issues.push('META_PAGE_ID is required in production when Facebook is enabled.');
      }

      if (!env.META_REDIRECT_URI) {
        issues.push('META_REDIRECT_URI is required in production when Facebook is enabled.');
      } else if (!isPublicHttpsUrl(env.META_REDIRECT_URI)) {
        issues.push('META_REDIRECT_URI must be a public https URL in production.');
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(`Invalid production environment:\n- ${issues.join('\n- ')}`);
  }
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return false;
    }

    return !isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost')
  );
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim();
  return normalized.length < 32 || normalized === 'replace-me-in-development';
}
