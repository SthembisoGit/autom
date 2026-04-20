import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import { ensureDialogueCharacterRasters } from '../src/media/dialogue-assets.js';

test('ensureDialogueCharacterRasters builds the layered studio_duo_v2 host pack', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-dialogue-assets-'));

  try {
    const rasterPack = await ensureDialogueCharacterRasters('studio_duo_v2', workspaceRoot);

    assert.equal(rasterPack.presetId, 'studio_duo_v2');
    assert.equal(rasterPack.hostA.scale > 0, true);
    assert.equal(rasterPack.hostB.scale > 0, true);

    await access(rasterPack.hostA.base);
    await access(rasterPack.hostA.blink);
    await access(rasterPack.hostA.mouth.rest);
    await access(rasterPack.hostB.base);
    await access(rasterPack.hostB.mouth.open);

    const baseMetadata = await sharp(rasterPack.hostA.base).metadata();
    assert.equal(baseMetadata.width, rasterPack.canvas.width);
    assert.equal(baseMetadata.height, rasterPack.canvas.height);

    const basePixels = await sharp(rasterPack.hostA.base).ensureAlpha().raw().toBuffer();
    const alphaValues = Array.from(basePixels).filter((_, index) => index % 4 === 3);
    assert.equal(alphaValues.some((value) => value > 0), true);

    const blinkPixels = await readFile(rasterPack.hostA.blink);
    const mouthPixels = await readFile(rasterPack.hostA.mouth.wide);
    assert.equal(blinkPixels.length > 0, true);
    assert.equal(mouthPixels.length > 0, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
