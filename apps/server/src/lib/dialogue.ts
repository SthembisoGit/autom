import type { ContentProfile, ScriptPackage } from '@autom/contracts';

export const DIALOGUE_HOST_A_ID = 'host_a';
export const DIALOGUE_HOST_B_ID = 'host_b';

export function isDialogueMode(profile: ContentProfile): boolean {
  return profile.contentMode === 'dialogue';
}

export function isManualVeoVisualMode(): boolean {
  return false;
}

export function applySceneVisualModes(
  profile: ContentProfile,
  scriptPackage: ScriptPackage
): ScriptPackage {
  return {
    ...scriptPackage,
    scenes: scriptPackage.scenes.map((scene) => ({
      ...scene,
      visualMode: scene.visualMode ?? 'auto',
    })),
  };
}

export function buildDialogueSpeakers(profile: ContentProfile) {
  return [
    {
      id: DIALOGUE_HOST_A_ID,
      name: profile.dialogueHostAName,
      role: 'lead',
    },
    {
      id: DIALOGUE_HOST_B_ID,
      name: profile.dialogueHostBName,
      role: 'reactor',
    },
  ];
}

export function buildLocalDialoguePackage(
  profile: ContentProfile,
  scriptPackage: Pick<ScriptPackage, 'scenes'>
) {
  const speakers = buildDialogueSpeakers(profile);
  const turns = scriptPackage.scenes.flatMap((scene) => [
    {
      order: scene.order * 2 - 1,
      speakerId: DIALOGUE_HOST_A_ID,
      sceneOrder: scene.order,
      text: `Mm, here is the key point in scene ${scene.order}.`,
      shotType: 'speaker_focus' as const,
      shotNote: 'Open on host A.',
      visualQuery: null,
    },
    {
      order: scene.order * 2,
      speakerId: DIALOGUE_HOST_B_ID,
      sceneOrder: scene.order,
      text: 'Right, so the simple takeaway is what changes for the viewer.',
      shotType: 'duo' as const,
      shotNote: 'Bring both hosts into frame.',
      visualQuery: null,
    },
  ]);

  return {
    speakers,
    turns,
  };
}
