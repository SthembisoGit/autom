import { z } from 'zod';

export const PlatformSchema = z.enum(['local', 'youtube', 'tiktok', 'facebook']);
export type Platform = z.infer<typeof PlatformSchema>;

const normalizedStringSchema = z.string().trim().min(1);
const uniqueStringListSchema = z
  .array(normalizedStringSchema)
  .default([])
  .transform((items) => Array.from(new Set(items)));

export const JobStatusSchema = z.enum([
  'drafting',
  'review_pending',
  'approved',
  'publish_pending',
  'published',
  'failed',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const PublicationStatusSchema = z.enum([
  'published',
  'failed',
  'pending_configuration',
  'pending_processing',
]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const PlatformConnectionStatusSchema = z.enum([
  'not_configured',
  'disconnected',
  'connected',
  'expired',
]);
export type PlatformConnectionStatus = z.infer<typeof PlatformConnectionStatusSchema>;

export const SceneSpecSchema = z.object({
  order: z.number().int().positive(),
  text: z.string().min(1),
  visualQuery: z.string().min(1),
  durationSeconds: z.number().positive(),
});
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export const ScriptPackageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  scenes: z.array(SceneSpecSchema).min(1),
  totalDurationSeconds: z.number().positive(),
});
export type ScriptPackage = z.infer<typeof ScriptPackageSchema>;

export const AssetReferenceSchema = z.object({
  kind: z.enum(['video', 'audio', 'subtitle', 'metadata']),
  path: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum(['local', 'deepgram', 'pexels', 'system']),
  sourceUrl: z.string().url().nullable(),
  mimeType: z.string().nullable(),
  externalId: z.string().nullable(),
  sceneOrder: z.number().int().positive().nullable(),
  query: z.string().nullable(),
});
export type AssetReference = z.infer<typeof AssetReferenceSchema>;

export const AssetBundleSchema = z.object({
  selectedVisualQueries: z.array(z.string().min(1)),
  assetReferences: z.array(AssetReferenceSchema).default([]),
});
export type AssetBundle = z.infer<typeof AssetBundleSchema>;

export const RenderBundleSchema = z.object({
  outputVideoPath: z.string().min(1),
  subtitlesPath: z.string().min(1),
  thumbnailPath: z.string().nullable(),
  durationSeconds: z.number().positive(),
  renderedDurationSeconds: z.number().nonnegative().default(0),
  narrationDurationSeconds: z.number().positive().nullable().default(null),
  subtitleCueCount: z.number().int().nonnegative().default(0),
  subtitleTimingSource: z.enum(['scene_duration', 'voice_timeline']).default('scene_duration'),
});
export type RenderBundle = z.infer<typeof RenderBundleSchema>;

export const ReviewPackageSchema = z.object({
  summary: z.string().min(1),
  warnings: z.array(z.string()).default([]),
  renderBundle: RenderBundleSchema,
  assetBundle: AssetBundleSchema,
  generatedAt: z.string().min(1),
});
export type ReviewPackage = z.infer<typeof ReviewPackageSchema>;

export const PublicationResultSchema = z.object({
  platform: PlatformSchema,
  status: PublicationStatusSchema,
  externalId: z.string().nullable(),
  publishedAt: z.string().nullable(),
  message: z.string().nullable(),
  connectorMode: z.enum(['stub', 'live']),
});
export type PublicationResult = z.infer<typeof PublicationResultSchema>;

export const PlatformConnectionSchema = z.object({
  platform: PlatformSchema,
  status: PlatformConnectionStatusSchema,
  configured: z.boolean(),
  connected: z.boolean(),
  accountLabel: z.string().nullable(),
  connectedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  connectorMode: z.enum(['stub', 'live']),
  message: z.string().nullable(),
});
export type PlatformConnection = z.infer<typeof PlatformConnectionSchema>;

export const SchedulerRunStatusSchema = z.enum([
  'queued',
  'running',
  'retry_scheduled',
  'completed',
  'failed',
  'skipped',
]);
export type SchedulerRunStatus = z.infer<typeof SchedulerRunStatusSchema>;

export const SchedulerRunSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  topic: z.string().min(1),
  scheduledFor: z.string().min(1),
  status: SchedulerRunStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  createdJobId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type SchedulerRun = z.infer<typeof SchedulerRunSchema>;

export const SchedulerOverviewSchema = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  pollIntervalSeconds: z.number().int().positive(),
  lastTickStartedAt: z.string().nullable(),
  lastTickCompletedAt: z.string().nullable(),
  lastTickMessage: z.string().nullable(),
  queuedRuns: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  completedRuns24h: z.number().int().nonnegative(),
  failedRuns24h: z.number().int().nonnegative(),
  recentRuns: z.array(SchedulerRunSchema).default([]),
});
export type SchedulerOverview = z.infer<typeof SchedulerOverviewSchema>;

export const CallToActionStyleSchema = z.enum(['community', 'educational', 'affiliate']);
export type CallToActionStyle = z.infer<typeof CallToActionStyleSchema>;

export const ScriptGenerationMetadataSchema = z.object({
  provider: z.enum(['local', 'gemini']),
  model: z.string().nullable(),
  promptVersion: z.string().min(1),
  mode: z.enum(['stub', 'live']),
  attemptCount: z.number().int().positive(),
  repaired: z.boolean(),
});
export type ScriptGenerationMetadata = z.infer<typeof ScriptGenerationMetadataSchema>;

export const ContentProfileSchema = z
  .object({
    id: z.string().min(1),
    name: normalizedStringSchema,
    niche: normalizedStringSchema,
    tone: normalizedStringSchema,
    visualStyle: normalizedStringSchema,
    promptDirectives: normalizedStringSchema,
    preferredTopics: uniqueStringListSchema,
    bannedTopics: uniqueStringListSchema,
    bannedTerms: uniqueStringListSchema,
    sceneCount: z.number().int().min(3).max(8),
    maxDurationSeconds: z.number().int().min(15).max(180),
    defaultHashtags: uniqueStringListSchema,
    callToActionStyle: CallToActionStyleSchema,
    callToActionTemplate: normalizedStringSchema,
    callToActionGuardrails: normalizedStringSchema,
    affiliateLinkTemplate: z.string().trim().default(''),
    requireAffiliateDisclosure: z.boolean().default(false),
    affiliateDisclosureTemplate: z.string().trim().default(''),
    enabled: z.boolean(),
    scheduleCron: normalizedStringSchema,
    targetPlatforms: z.array(PlatformSchema).min(1),
    defaultVoice: normalizedStringSchema,
    createdAt: normalizedStringSchema,
    updatedAt: normalizedStringSchema,
  })
  .superRefine((profile, context) => {
    if (profile.maxDurationSeconds < profile.sceneCount * 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Max duration must allow at least 3 seconds per scene.',
        path: ['maxDurationSeconds'],
      });
    }

    if (profile.callToActionStyle === 'affiliate' && profile.affiliateLinkTemplate.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Affiliate CTA profiles require an affiliate link template.',
        path: ['affiliateLinkTemplate'],
      });
    }

    if (
      profile.callToActionStyle === 'affiliate' &&
      profile.requireAffiliateDisclosure &&
      profile.affiliateDisclosureTemplate.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Affiliate disclosure text is required when disclosure is enabled.',
        path: ['affiliateDisclosureTemplate'],
      });
    }
  });
export type ContentProfile = z.infer<typeof ContentProfileSchema>;

export const GenerationJobSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  topic: z.string().min(1),
  status: JobStatusSchema,
  scriptPackage: ScriptPackageSchema.nullable(),
  scriptMetadata: ScriptGenerationMetadataSchema.nullable(),
  reviewPackage: ReviewPackageSchema.nullable(),
  publicationResults: z.array(PublicationResultSchema).default([]),
  errorMessage: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type GenerationJob = z.infer<typeof GenerationJobSchema>;

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().nullable(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string().min(1),
  createdAt: z.string().min(1),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const JobProgressStageSchema = z.enum([
  'starting',
  'generating_script',
  'generating_narration',
  'selecting_visuals',
  'rendering_review',
  'ready_for_review',
  'approved',
  'publishing',
  'published',
  'failed',
]);
export type JobProgressStage = z.infer<typeof JobProgressStageSchema>;

export const JobProgressToneSchema = z.enum(['info', 'warning', 'success', 'danger']);
export type JobProgressTone = z.infer<typeof JobProgressToneSchema>;

export const JobProgressSchema = z.object({
  stage: JobProgressStageSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  tone: JobProgressToneSchema,
  isTerminal: z.boolean(),
  retryable: z.boolean().default(false),
  updatedAt: z.string().nullable(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobDetailResponseSchema = z.object({
  job: GenerationJobSchema,
  audit: z.array(AuditEventSchema),
  progress: JobProgressSchema,
});
export type JobDetailResponse = z.infer<typeof JobDetailResponseSchema>;

export const JobMonitorEntrySchema = z.object({
  job: GenerationJobSchema,
  progress: JobProgressSchema,
  latestAudit: AuditEventSchema.nullable(),
});
export type JobMonitorEntry = z.infer<typeof JobMonitorEntrySchema>;

export const JobMonitorResponseSchema = z.object({
  active: z.array(JobMonitorEntrySchema),
  failed: z.array(JobMonitorEntrySchema),
});
export type JobMonitorResponse = z.infer<typeof JobMonitorResponseSchema>;

export const CreateJobRequestSchema = z.object({
  profileId: normalizedStringSchema,
  topic: normalizedStringSchema,
});
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const ReviewDecisionRequestSchema = z.object({
  note: z.string().trim().optional(),
});
export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequestSchema>;

export const PublishJobRequestSchema = z.object({
  targets: z.array(PlatformSchema).optional(),
});
export type PublishJobRequest = z.infer<typeof PublishJobRequestSchema>;

export const UpsertProfileRequestSchema = z
  .object({
    name: normalizedStringSchema,
    niche: normalizedStringSchema,
    tone: normalizedStringSchema,
    visualStyle: normalizedStringSchema,
    promptDirectives: normalizedStringSchema,
    preferredTopics: uniqueStringListSchema,
    bannedTopics: uniqueStringListSchema,
    bannedTerms: uniqueStringListSchema,
    sceneCount: z.number().int().min(3).max(8).default(6),
    maxDurationSeconds: z.number().int().min(15).max(180).default(90),
    defaultHashtags: uniqueStringListSchema,
    callToActionStyle: CallToActionStyleSchema.default('community'),
    callToActionTemplate: normalizedStringSchema,
    callToActionGuardrails: normalizedStringSchema,
    affiliateLinkTemplate: z.string().trim().default(''),
    requireAffiliateDisclosure: z.boolean().default(false),
    affiliateDisclosureTemplate: z.string().trim().default(''),
    enabled: z.boolean().default(true),
    scheduleCron: normalizedStringSchema,
    targetPlatforms: z.array(PlatformSchema).min(1),
    defaultVoice: normalizedStringSchema,
  })
  .superRefine((profile, context) => {
    if (profile.maxDurationSeconds < profile.sceneCount * 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Max duration must allow at least 3 seconds per scene.',
        path: ['maxDurationSeconds'],
      });
    }

    if (profile.callToActionStyle === 'affiliate' && profile.affiliateLinkTemplate.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Affiliate CTA profiles require an affiliate link template.',
        path: ['affiliateLinkTemplate'],
      });
    }

    if (
      profile.callToActionStyle === 'affiliate' &&
      profile.requireAffiliateDisclosure &&
      profile.affiliateDisclosureTemplate.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Affiliate disclosure text is required when disclosure is enabled.',
        path: ['affiliateDisclosureTemplate'],
      });
    }
  });
export type UpsertProfileRequest = z.infer<typeof UpsertProfileRequestSchema>;

export const DashboardSummarySchema = z.object({
  totalProfiles: z.number().int().nonnegative(),
  enabledProfiles: z.number().int().nonnegative(),
  draftJobs: z.number().int().nonnegative(),
  reviewPendingJobs: z.number().int().nonnegative(),
  publishedJobs: z.number().int().nonnegative(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
