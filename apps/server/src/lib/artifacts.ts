import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { RuntimePaths } from '@autom/config';

export async function ensureJobArtifactDirectory(
  runtimePaths: RuntimePaths,
  jobId: string,
  ...segments: string[]
): Promise<string> {
  const directory = join(runtimePaths.tempDirectory, jobId, ...segments);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function writeArtifactFile(targetPath: string, content: Uint8Array | string) {
  const temporaryPath = `${targetPath}.part`;
  await mkdir(dirname(targetPath), { recursive: true });

  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function cleanupJobArtifacts(runtimePaths: RuntimePaths, jobId: string) {
  await Promise.all([
    rm(join(runtimePaths.tempDirectory, jobId), { recursive: true, force: true }),
    rm(join(runtimePaths.outputDirectory, jobId), { recursive: true, force: true }),
    rm(join(runtimePaths.manualClipDirectory, jobId), { recursive: true, force: true }),
  ]);
}
