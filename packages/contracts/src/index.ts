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
  'cancelling',
  'cancelled',
  'waiting_for_manual_clip',
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
  visualMode: z.enum(['auto', 'manual_veo_required', 'manual_veo_optional']).default('auto'),
});
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export const SceneVisualModeSchema = z.enum([
  'auto',
  'manual_veo_required',
  'manual_veo_optional',
]);
export type SceneVisualMode = z.infer<typeof SceneVisualModeSchema>;

export const ContentModeSchema = z.enum(['narration', 'dialogue']);
export type ContentMode = z.infer<typeof ContentModeSchema>;

export const TopicSourceSchema = z.enum(['category_pool', 'daily_news', 'preferred_topics']);
export type TopicSource = z.infer<typeof TopicSourceSchema>;

export const CategoryGoalSchema = z.enum(['revenue', 'reach', 'authority', 'hybrid']);
export type CategoryGoal = z.infer<typeof CategoryGoalSchema>;

export const CategoryPlatformFitSchema = z.enum(['meta', 'youtube', 'both']);
export type CategoryPlatformFit = z.infer<typeof CategoryPlatformFitSchema>;

export const CategoryContentTypeBiasSchema = z.enum([
  'recent_news',
  'named_person_or_event',
  'historical_topic',
  'place_or_institution',
  'generic_business_or_lifestyle',
  'product_or_tool_demo',
  'mixed',
]);
export type CategoryContentTypeBias = z.infer<typeof CategoryContentTypeBiasSchema>;

export const CountryValueTierSchema = z.enum(['primary', 'secondary']);
export type CountryValueTier = z.infer<typeof CountryValueTierSchema>;

export const CategoryLengthStrategySchema = z.object({
  minSeconds: z.number().int().positive(),
  maxSeconds: z.number().int().positive(),
  longformEligible: z.boolean().default(false),
});
export type CategoryLengthStrategy = z.infer<typeof CategoryLengthStrategySchema>;

export const ContentCategorySchema = z.object({
  id: normalizedStringSchema,
  label: normalizedStringSchema,
  enabled: z.boolean().default(true),
  goal: CategoryGoalSchema.default('hybrid'),
  platformFit: CategoryPlatformFitSchema.default('both'),
  countryTargets: uniqueStringListSchema,
  contentTypeBias: CategoryContentTypeBiasSchema.default('mixed'),
  topicGenerationRules: normalizedStringSchema,
  evidencePolicy: normalizedStringSchema,
  visualPolicy: normalizedStringSchema,
  lengthStrategy: CategoryLengthStrategySchema,
  hashtagStrategy: normalizedStringSchema,
  searchLenses: uniqueStringListSchema,
  exampleTopics: uniqueStringListSchema,
});
export type ContentCategory = z.infer<typeof ContentCategorySchema>;

export const DialogueSpeakerSchema = z.object({
  id: normalizedStringSchema,
  name: normalizedStringSchema,
  role: z.string().trim().default('host'),
});
export type DialogueSpeaker = z.infer<typeof DialogueSpeakerSchema>;

export const DialogueShotTypeSchema = z.enum([
  'duo',
  'speaker_focus',
  'insert_demo',
  'insert_broll',
  'data_card',
]);
export type DialogueShotType = z.infer<typeof DialogueShotTypeSchema>;

export const DialogueTurnSchema = z.object({
  order: z.number().int().positive(),
  speakerId: normalizedStringSchema,
  sceneOrder: z.number().int().positive(),
  text: normalizedStringSchema,
  shotType: DialogueShotTypeSchema.default('duo'),
  shotNote: z.string().trim().default(''),
  visualQuery: z.string().trim().nullable().default(null),
});
export type DialogueTurn = z.infer<typeof DialogueTurnSchema>;

export const DialoguePackageSchema = z
  .object({
    speakers: z.array(DialogueSpeakerSchema).length(2),
    turns: z.array(DialogueTurnSchema).min(1),
  })
  .superRefine((dialogue, context) => {
    const speakerIds = dialogue.speakers.map((speaker) => speaker.id);

    if (new Set(speakerIds).size !== speakerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dialogue speakers must use unique ids.',
        path: ['speakers'],
      });
    }

    for (const turn of dialogue.turns) {
      if (!speakerIds.includes(turn.speakerId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Dialogue turn ${turn.order} references an unknown speaker id.`,
          path: ['turns'],
        });
      }
    }
  });
export type DialoguePackage = z.infer<typeof DialoguePackageSchema>;

export const ScriptPackageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  scenes: z.array(SceneSpecSchema).min(1),
  totalDurationSeconds: z.number().positive(),
  dialogue: DialoguePackageSchema.nullable().default(null),
});
export type ScriptPackage = z.infer<typeof ScriptPackageSchema>;

export const AssetReferenceSchema = z.object({
  kind: z.enum(['video', 'audio', 'subtitle', 'metadata']),
  path: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum([
    'local',
    'deepgram',
    'groq',
    'gemini',
    'mistral',
    'tavily',
    'cohere',
    'pexels',
    'pixabay',
    'unsplash',
    'wikimedia',
    'veo',
    'system',
  ]),
  sourceUrl: z.string().url().nullable(),
  mimeType: z.string().nullable(),
  externalId: z.string().nullable(),
  sceneOrder: z.number().int().positive().nullable(),
  query: z.string().nullable(),
  retrievalOrigin: z.enum(['news', 'entity', 'archive', 'stock', 'demo', 'research']).nullable().default(null),
  licenseLabel: z.string().nullable().default(null),
  rightsSummary: z.string().nullable().default(null),
  attributionRequired: z.boolean().default(false),
  entityLabel: z.string().nullable().default(null),
  matchQuality: z.enum(['exact', 'relevant', 'fallback']).nullable().default(null),
  reuseStatus: z.enum(['unique', 'forced_reuse']).nullable().default(null),
});
export type AssetReference = z.infer<typeof AssetReferenceSchema>;

export const ManualClipStatusSchema = z.enum(['pending', 'uploaded', 'expired']);
export type ManualClipStatus = z.infer<typeof ManualClipStatusSchema>;

export const ManualClipRequestSchema = z.object({
  sceneOrder: z.number().int().positive(),
  sceneText: z.string().min(1),
  visualQuery: z.string().min(1),
  visualMode: SceneVisualModeSchema,
  sceneDurationSeconds: z.number().positive(),
  targetClipDurationSeconds: z.number().positive(),
  prompt: z.string().min(1),
  audioDirective: z.string().min(1),
  status: ManualClipStatusSchema,
  requestedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  uploadedAt: z.string().nullable(),
  validatedAt: z.string().nullable(),
  measuredDurationSeconds: z.number().positive().nullable(),
  assetPath: z.string().nullable(),
  contentType: z.string().nullable(),
  originalFileName: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type ManualClipRequest = z.infer<typeof ManualClipRequestSchema>;

export const ManualClipBundleSchema = z.object({
  waitTimeoutSeconds: z.number().int().positive(),
  requests: z.array(ManualClipRequestSchema).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ManualClipBundle = z.infer<typeof ManualClipBundleSchema>;

export const AssetBundleSchema = z.object({
  selectedVisualQueries: z.array(z.string().min(1)),
  assetReferences: z.array(AssetReferenceSchema).default([]),
});
export type AssetBundle = z.infer<typeof AssetBundleSchema>;

export const RenderSceneVisualProviderSchema = z.enum([
  'dialogue',
  'local',
  'deepgram',
  'groq',
  'pexels',
  'pixabay',
  'unsplash',
  'wikimedia',
  'veo',
  'system',
]);
export type RenderSceneVisualProvider = z.infer<typeof RenderSceneVisualProviderSchema>;

export const RenderSceneVisualOutcomeSchema = z.object({
  sceneOrder: z.number().int().positive(),
  requestedVisualMode: SceneVisualModeSchema,
  providerUsed: RenderSceneVisualProviderSchema,
  usedFallback: z.boolean().default(false),
});
export type RenderSceneVisualOutcome = z.infer<typeof RenderSceneVisualOutcomeSchema>;

export const RenderBundleSchema = z.object({
  outputVideoPath: z.string().min(1),
  subtitlesPath: z.string().min(1),
  thumbnailPath: z.string().nullable(),
  durationSeconds: z.number().positive(),
  renderedDurationSeconds: z.number().nonnegative().default(0),
  narrationDurationSeconds: z.number().positive().nullable().default(null),
  subtitleCueCount: z.number().int().nonnegative().default(0),
  subtitleTimingSource: z
    .enum(['scene_duration', 'voice_timeline', 'groq_word_timestamps'])
    .default('scene_duration'),
  contentMode: ContentModeSchema.default('narration'),
  dialogueSpeakerNames: z.array(z.string().min(1)).default([]),
  dialogueTurnCount: z.number().int().nonnegative().default(0),
  sceneVisualOutcomes: z.array(RenderSceneVisualOutcomeSchema).default([]),
  backgroundAudioPresent: z.boolean().default(false),
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
  'cancelled',
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
  provider: z.enum(['local', 'gemini', 'groq', 'mistral']),
  model: z.string().nullable(),
  promptVersion: z.string().min(1),
  mode: z.enum(['stub', 'live']),
  attemptCount: z.number().int().positive(),
  repaired: z.boolean(),
  searchProvider: z.enum(['none', 'news', 'tavily']).default('none'),
  rerankProvider: z.enum(['none', 'heuristic', 'cohere']).default('none'),
  verificationStatus: z.enum(['unverified', 'verified', 'degraded']).default('unverified'),
  evidenceSourceCount: z.number().int().nonnegative().default(0),
  fallbackProvider: z.enum(['local', 'gemini', 'groq', 'mistral']).nullable().default(null),
  providerChain: z.array(z.string().min(1)).default([]),
  categoryId: z.string().nullable().default(null),
  categoryLabel: z.string().nullable().default(null),
  platformFit: CategoryPlatformFitSchema.nullable().default(null),
  countryTargets: uniqueStringListSchema,
  monetizationScore: z.number().nonnegative().nullable().default(null),
  storyAngle: z.string().nullable().default(null),
  hookStyle: z.string().nullable().default(null),
  warnings: z.array(z.string()).default([]),
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
    contentCategories: z.array(ContentCategorySchema).default([]),
    sceneCount: z.number().int().min(0).max(8).default(0),
    maxDurationSeconds: z.number().int().min(15).max(180),
    defaultHashtags: uniqueStringListSchema,
    callToActionStyle: CallToActionStyleSchema,
    callToActionTemplate: normalizedStringSchema,
    callToActionGuardrails: normalizedStringSchema,
    affiliateLinkTemplate: z.string().trim().default(''),
    requireAffiliateDisclosure: z.boolean().default(false),
    affiliateDisclosureTemplate: z.string().trim().default(''),
    contentMode: ContentModeSchema.default('narration'),
    topicSource: TopicSourceSchema.default('category_pool'),
    dialogueCharacterPresetId: normalizedStringSchema.default('studio_duo_v2'),
    dialogueHostAName: normalizedStringSchema.default('Maya'),
    dialogueHostBName: normalizedStringSchema.default('Theo'),
    dialogueVoiceA: normalizedStringSchema.default('aura-2-thalia-en'),
    dialogueVoiceB: normalizedStringSchema.default('aura-2-orion-en'),
    enabled: z.boolean(),
    scheduleCron: normalizedStringSchema,
    targetPlatforms: z.array(PlatformSchema).min(1),
    defaultVoice: normalizedStringSchema,
    createdAt: normalizedStringSchema,
    updatedAt: normalizedStringSchema,
  })
  .superRefine((profile, context) => {
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

    if (
      profile.contentMode === 'dialogue' &&
      profile.dialogueHostAName.toLowerCase() === profile.dialogueHostBName.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dialogue mode requires two distinct host names.',
        path: ['dialogueHostBName'],
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
  manualClipBundle: ManualClipBundleSchema.nullable(),
  reviewPackage: ReviewPackageSchema.nullable(),
  publicationResults: z.array(PublicationResultSchema).default([]),
  errorMessage: z.string().nullable(),
  archivedAt: z.string().nullable().default(null),
  archivedReason: z.string().nullable().default(null),
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
  'cancelling',
  'cancelled',
  'generating_script',
  'waiting_for_manual_clip',
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
    contentCategories: z.array(ContentCategorySchema).default([]),
    sceneCount: z.number().int().min(0).max(8).default(0),
    maxDurationSeconds: z.number().int().min(15).max(180).default(90),
    defaultHashtags: uniqueStringListSchema,
    callToActionStyle: CallToActionStyleSchema.default('community'),
    callToActionTemplate: normalizedStringSchema,
    callToActionGuardrails: normalizedStringSchema,
    affiliateLinkTemplate: z.string().trim().default(''),
    requireAffiliateDisclosure: z.boolean().default(false),
    affiliateDisclosureTemplate: z.string().trim().default(''),
    contentMode: ContentModeSchema.default('narration'),
    topicSource: TopicSourceSchema.default('category_pool'),
    dialogueCharacterPresetId: normalizedStringSchema.default('studio_duo_v2'),
    dialogueHostAName: normalizedStringSchema.default('Maya'),
    dialogueHostBName: normalizedStringSchema.default('Theo'),
    dialogueVoiceA: normalizedStringSchema.default('aura-2-thalia-en'),
    dialogueVoiceB: normalizedStringSchema.default('aura-2-orion-en'),
    enabled: z.boolean().default(true),
    scheduleCron: normalizedStringSchema,
    targetPlatforms: z.array(PlatformSchema).min(1),
    defaultVoice: normalizedStringSchema,
  })
  .superRefine((profile, context) => {
    if (profile.contentCategories.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one content category is required.',
        path: ['contentCategories'],
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

    if (
      profile.contentMode === 'dialogue' &&
      profile.dialogueHostAName.toLowerCase() === profile.dialogueHostBName.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dialogue mode requires two distinct host names.',
        path: ['dialogueHostBName'],
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
