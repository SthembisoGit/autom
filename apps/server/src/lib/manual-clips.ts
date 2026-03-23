import type { AppEnv, RuntimePaths } from '@autom/config';
import type {
  AssetReference,
  ContentProfile,
  GenerationJob,
  ManualClipBundle,
  ManualClipRequest,
  SceneSpec,
  ScriptPackage,
} from '@autom/contracts';

import type { CommandRunner } from '../media/ffmpeg-renderer.js';
import { nowIso } from './time.js';

const MANUAL_CLIP_DURATION_TOLERANCE_SECONDS = 2;
const MANUAL_CLIP_TIMEOUT_MS = 30_000;
const MANUAL_CLIP_SUBJECT_PATTERNS = [
  /\b(app|application|software|crm|dashboard|interface|platform|website|browser|product|demo|walkthrough|tutorial|settings|analytics|laptop|phone|screen)\b/i,
];
const MANUAL_CLIP_ACTION_PATTERNS = [
  /\b(click|clicks|clicking|scroll|scrolls|scrolling|tap|taps|tapping|type|types|typing|navigate|navigates|navigating|launch|launches|launching|install|installs|installing|configure|configures|configuring|swipe|swipes|swiping|open|opens|opening|use|uses|using|demonstrate|demonstrates|demonstrating|walkthrough)\b/i,
];

export function buildManualClipBundle(
  profile: ContentProfile,
  scriptPackage: ScriptPackage,
  waitTimeoutSeconds: number
): ManualClipBundle | null {
  const selectedScenes = chooseManualClipScenes(profile, scriptPackage);
  if (selectedScenes.length === 0) {
    return null;
  }

  const requestedAt = nowIso();
  const expiresAt = new Date(
    new Date(requestedAt).getTime() + waitTimeoutSeconds * 1000
  ).toISOString();

  return {
    waitTimeoutSeconds,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    requests: selectedScenes.map((scene) => {
      const targetClipDurationSeconds = resolveManualClipTargetDuration(scene.durationSeconds);
      const { prompt, audioDirective } = buildManualClipPrompt({
        profile,
        scene,
        targetClipDurationSeconds,
        totalScenes: scriptPackage.scenes.length,
        totalDurationSeconds: scriptPackage.totalDurationSeconds,
      });

      return {
        sceneOrder: scene.order,
        sceneText: scene.text,
        visualQuery: scene.visualQuery,
        sceneDurationSeconds: scene.durationSeconds,
        targetClipDurationSeconds,
        prompt,
        audioDirective,
        status: 'pending' as const,
        requestedAt,
        expiresAt,
        uploadedAt: null,
        validatedAt: null,
        measuredDurationSeconds: null,
        assetPath: null,
        contentType: null,
        originalFileName: null,
        errorMessage: null,
      } satisfies ManualClipRequest;
    }),
  };
}

export function chooseManualClipScenes(
  profile: ContentProfile,
  scriptPackage: ScriptPackage
): SceneSpec[] {
  const candidateScenes = scriptPackage.scenes.filter((scene) =>
    isManualClipCandidate(profile, scene)
  );

  if (candidateScenes.length === 0) {
    return [];
  }

  const targetCount =
    scriptPackage.totalDurationSeconds >= 150
      ? 3
      : scriptPackage.totalDurationSeconds >= 90
        ? 2
        : 1;

  const preferredOrders = [1, Math.ceil(scriptPackage.scenes.length / 2), scriptPackage.scenes.length];
  const selectedOrders = Array.from(
    new Set(
      preferredOrders
        .map((order) => candidateScenes.find((scene) => scene.order === order))
        .filter((scene): scene is SceneSpec => Boolean(scene))
    )
  );

  if (selectedOrders.length === 0) {
    selectedOrders.push(candidateScenes[0] as SceneSpec);
  }

  const remainingCandidates = candidateScenes.filter(
    (scene) => !selectedOrders.some((selected) => selected.order === scene.order)
  );

  while (selectedOrders.length < targetCount && remainingCandidates.length > 0) {
    const nextScene = remainingCandidates.shift();
    if (nextScene) {
      selectedOrders.push(nextScene);
    }
  }

  return selectedOrders.sort((left, right) => left.order - right.order);
}

export function buildManualClipPrompt(input: {
  profile: ContentProfile;
  scene: SceneSpec;
  targetClipDurationSeconds: number;
  totalScenes: number;
  totalDurationSeconds: number;
}): { prompt: string; audioDirective: string } {
  const sceneGoal = input.scene.text.replace(/\s+/g, ' ').trim();
  const clipDurationLabel = `${input.targetClipDurationSeconds} seconds`;
  const audioDirective =
    'No spoken dialogue. Keep the clip effectively silent for final use. If the generator adds ambience, keep it subtle, clean, and non-distracting. Do not add music, narration, or dramatic sound design. The app will mute the clip by default.';

  const prompt = [
    'Manual Veo clip brief',
    `Channel lane: ${input.profile.niche}`,
    `Job pacing: ${input.totalScenes} scene${input.totalScenes === 1 ? '' : 's'}, ${input.totalDurationSeconds}s total`,
    `Scene order: ${input.scene.order}`,
    `Target length: ${clipDurationLabel}`,
    `Scene goal: visually reinforce "${sceneGoal}"`,
    `Subject: ${input.scene.visualQuery}`,
    `Action: Show the subject actively demonstrating or using the idea from the scene in a realistic, premium, single-shot sequence.`,
    'Props / brand constraints: use generic, unbranded objects and interfaces. If a device or screen is visible, it should look like a clean modern SaaS product, not a famous brand. No logos, no on-screen text, no watermarks.',
    `Camera: vertical 9:16 framing, safe headroom, centered subject, slow push-in, natural movement, shallow depth of field, continuous shot.`,
    `Lighting: cinematic and polished, aligned with "${input.profile.visualStyle}".`,
    'Motion: purposeful but restrained. Keep interactions believable, hands accurate, and movement stable.',
    'Quality constraints: no extra fingers, no warped UI, no flicker, no jump cuts, no random scene changes.',
    `Audio directive: ${audioDirective}`,
  ].join('\n');

  return {
    prompt,
    audioDirective,
  };
}

export function buildManualClipAssetReferences(job: GenerationJob): AssetReference[] {
  const bundle = job.manualClipBundle;
  if (!bundle) {
    return [];
  }

  return bundle.requests
    .filter((request) => request.status === 'uploaded' && Boolean(request.assetPath))
    .map(
      (request): AssetReference => ({
        kind: 'video',
        path: request.assetPath ?? '',
        label: `Manual Veo clip for scene ${request.sceneOrder}`,
        provider: 'veo',
        sourceUrl: null,
        mimeType: request.contentType ?? 'video/mp4',
        externalId: `${job.id}:scene-${request.sceneOrder}`,
        sceneOrder: request.sceneOrder,
        query: request.visualQuery,
      })
    );
}

export function resolveManualClipTargetDuration(sceneDurationSeconds: number): number {
  if (sceneDurationSeconds <= 4.5) {
    return 4;
  }

  if (sceneDurationSeconds <= 6.5) {
    return 6;
  }

  return 8;
}

export async function probeVideoMetadata(
  runCommand: CommandRunner,
  ffprobePath: string,
  mediaPath: string,
  cwd: string
): Promise<{
  durationSeconds: number;
  width: number;
  height: number;
  codecName: string | null;
}> {
  const probe = await runCommand(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,codec_name',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      mediaPath,
    ],
    cwd,
    MANUAL_CLIP_TIMEOUT_MS
  );

  const payload = JSON.parse(probe.stdout) as {
    streams?: Array<{ width?: number; height?: number; codec_name?: string }>;
    format?: { duration?: string };
  };
  const stream = payload.streams?.[0] ?? null;
  const durationSeconds = Number.parseFloat(payload.format?.duration ?? '');
  const width = stream?.width ?? 0;
  const height = stream?.height ?? 0;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Manual clip validation failed. FFprobe returned no usable duration.');
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Manual clip validation failed. FFprobe returned no usable frame size.');
  }

  return {
    durationSeconds,
    width,
    height,
    codecName: stream?.codec_name ?? null,
  };
}

export function validateManualClipMetadata(input: {
  durationSeconds: number;
  width: number;
  height: number;
  request: ManualClipRequest;
}): void {
  const { request, durationSeconds, width, height } = input;
  const minimumDuration = Math.max(2, request.targetClipDurationSeconds - MANUAL_CLIP_DURATION_TOLERANCE_SECONDS);
  const maximumDuration = request.targetClipDurationSeconds + MANUAL_CLIP_DURATION_TOLERANCE_SECONDS;

  if (height < width) {
    throw new Error('Manual clip validation failed. The clip must be vertical or square.');
  }

  if (durationSeconds < minimumDuration || durationSeconds > maximumDuration) {
    throw new Error(
      `Manual clip validation failed. Expected a clip near ${request.targetClipDurationSeconds}s but received ${durationSeconds.toFixed(
        2
      )}s.`
    );
  }
}

function isManualClipCandidate(profile: ContentProfile, scene: SceneSpec): boolean {
  const sceneText = scene.text.toLowerCase();
  const mentionsVisualSubject = MANUAL_CLIP_SUBJECT_PATTERNS.some((pattern) => pattern.test(sceneText));
  const mentionsInteraction = MANUAL_CLIP_ACTION_PATTERNS.some((pattern) => pattern.test(sceneText));

  if (profile.callToActionStyle === 'affiliate') {
    return mentionsVisualSubject;
  }

  return mentionsVisualSubject && mentionsInteraction;
}
