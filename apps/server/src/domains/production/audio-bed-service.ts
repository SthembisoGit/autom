import type { AssetReference } from '@autom/contracts';

import type { CommandRunner } from './render/index.js';

export async function findBackgroundAudioSource(
  runCommand: CommandRunner,
  ffprobePath: string,
  assetReferences: AssetReference[],
  cwd: string,
  timeoutMs: number
): Promise<string | null> {
  for (const reference of assetReferences) {
    if (reference.kind !== 'video') {
      continue;
    }

    const hasAudio = await probeHasAudioStream(
      runCommand,
      ffprobePath,
      reference.path,
      cwd,
      timeoutMs
    ).catch(() => false);

    if (hasAudio) {
      return reference.path;
    }
  }

  return null;
}

async function probeHasAudioStream(
  runCommand: CommandRunner,
  ffprobePath: string,
  mediaPath: string,
  cwd: string,
  timeoutMs: number
): Promise<boolean> {
  const probe = await runCommand(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      mediaPath,
    ],
    cwd,
    timeoutMs
  );

  return probe.stdout.trim().length > 0;
}
