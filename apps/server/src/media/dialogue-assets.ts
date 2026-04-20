import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const DIALOGUE_MOUTH_STATES = ['rest', 'mid', 'open', 'wide', 'fv'] as const;
type DialogueMouthState = (typeof DIALOGUE_MOUTH_STATES)[number];

type Point = { x: number; y: number };

type HostRig = {
  scale: number;
  bodyOrigin: Point;
  bodyNeckAnchor: Point;
  headNeckAnchor: Point;
  hairAnchor: Point;
  hairTargetOnHead: Point;
  eyesAnchor: Point;
  eyesTargetOnHead: Point;
  mouthAnchor: Point;
  mouthTargetOnHead: Point;
  layout: Point;
};

type DialoguePresetManifest = {
  canvas: { width: number; height: number };
  subtitleSafeZone: { top: number; height: number };
  hosts: {
    hostA: HostRig;
    hostB: HostRig;
  };
};

type DialogueHostRasterPack = {
  base: string;
  blink: string;
  mouth: Record<DialogueMouthState, string>;
  layout: Point;
  scale: number;
};

export type DialogueCharacterRasterPack = {
  presetId: string;
  canvas: DialoguePresetManifest['canvas'];
  subtitleSafeZone: DialoguePresetManifest['subtitleSafeZone'];
  hostA: DialogueHostRasterPack;
  hostB: DialogueHostRasterPack;
};

type LoadedLayer = {
  buffer: Buffer;
};

export async function ensureDialogueCharacterRasters(
  presetId: string,
  outputDirectory: string
): Promise<DialogueCharacterRasterPack> {
  const assetRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'dialogue');
  const sourcePresetDirectory = join(assetRoot, presetId);
  const rasterPresetDirectory = join(outputDirectory, 'dialogue-assets', presetId);
  await mkdir(rasterPresetDirectory, { recursive: true });

  const manifest = await loadPresetManifest(sourcePresetDirectory);
  const hostA = await ensureHostRasterPack(
    sourcePresetDirectory,
    rasterPresetDirectory,
    'host-a',
    manifest.canvas,
    manifest.hosts.hostA
  );
  const hostB = await ensureHostRasterPack(
    sourcePresetDirectory,
    rasterPresetDirectory,
    'host-b',
    manifest.canvas,
    manifest.hosts.hostB
  );

  return {
    presetId,
    canvas: manifest.canvas,
    subtitleSafeZone: manifest.subtitleSafeZone,
    hostA,
    hostB,
  };
}

async function loadPresetManifest(sourcePresetDirectory: string): Promise<DialoguePresetManifest> {
  const manifestPath = join(sourcePresetDirectory, 'preset.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  return JSON.parse(manifestText) as DialoguePresetManifest;
}

async function ensureHostRasterPack(
  sourcePresetDirectory: string,
  rasterPresetDirectory: string,
  hostDirectoryName: 'host-a' | 'host-b',
  canvas: DialoguePresetManifest['canvas'],
  rig: HostRig
): Promise<DialogueHostRasterPack> {
  const sourceHostDirectory = join(sourcePresetDirectory, hostDirectoryName);
  const hostOutputDirectory = join(rasterPresetDirectory, hostDirectoryName);
  await mkdir(hostOutputDirectory, { recursive: true });

  const bodyLayer = await loadScaledLayer(join(sourceHostDirectory, 'body.svg'), rig.scale);
  const headLayer = await loadScaledLayer(join(sourceHostDirectory, 'head.svg'), rig.scale);
  const hairLayer = await loadScaledLayer(join(sourceHostDirectory, 'hair.svg'), rig.scale);
  const eyesOpenLayer = await loadScaledLayer(join(sourceHostDirectory, 'eyes_open.svg'), rig.scale);
  const eyesBlinkLayer = await loadScaledLayer(join(sourceHostDirectory, 'eyes_blink.svg'), rig.scale);
  const mouthLayers = Object.fromEntries(
    await Promise.all(
      DIALOGUE_MOUTH_STATES.map(async (state) => [
        state,
        await loadScaledLayer(join(sourceHostDirectory, `mouth_${state}.svg`), rig.scale),
      ])
    )
  ) as Record<DialogueMouthState, LoadedLayer>;

  const positions = computeRigPositions(rig);
  const basePath = join(hostOutputDirectory, 'base.png');
  const blinkPath = join(hostOutputDirectory, 'blink.png');

  await renderLayerComposite(canvas, basePath, [
    { input: bodyLayer.buffer, ...positions.body },
    { input: headLayer.buffer, ...positions.head },
    { input: hairLayer.buffer, ...positions.hair },
    { input: eyesOpenLayer.buffer, ...positions.eyes },
    { input: mouthLayers.rest.buffer, ...positions.mouth },
  ]);

  await renderLayerComposite(canvas, blinkPath, [{ input: eyesBlinkLayer.buffer, ...positions.eyes }]);

  const mouthEntries = await Promise.all(
    DIALOGUE_MOUTH_STATES.map(async (state) => {
      const outputPath = join(hostOutputDirectory, `mouth-${state}.png`);
      await renderLayerComposite(canvas, outputPath, [{ input: mouthLayers[state].buffer, ...positions.mouth }]);
      return [state, outputPath] as const;
    })
  );

  return {
    base: basePath,
    blink: blinkPath,
    mouth: Object.fromEntries(mouthEntries) as Record<DialogueMouthState, string>,
    layout: rig.layout,
    scale: rig.scale,
  };
}

async function loadScaledLayer(inputPath: string, scale: number): Promise<LoadedLayer> {
  const source = sharp(inputPath);
  const metadata = await source.metadata();
  const width = Math.max(1, Math.round((metadata.width ?? 1) * scale));
  const height = Math.max(1, Math.round((metadata.height ?? 1) * scale));
  return {
    buffer: await source.resize(width, height).png().toBuffer(),
  };
}

function computeRigPositions(rig: HostRig): Record<'body' | 'head' | 'hair' | 'eyes' | 'mouth', Point> {
  const scaled = (point: Point): Point => ({ x: point.x * rig.scale, y: point.y * rig.scale });
  const round = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) });

  const bodyOrigin = rig.bodyOrigin;
  const neckTarget = {
    x: bodyOrigin.x + scaled(rig.bodyNeckAnchor).x,
    y: bodyOrigin.y + scaled(rig.bodyNeckAnchor).y,
  };
  const headOrigin = {
    x: neckTarget.x - scaled(rig.headNeckAnchor).x,
    y: neckTarget.y - scaled(rig.headNeckAnchor).y,
  };

  const headLocalToCanvas = (point: Point): Point => ({
    x: headOrigin.x + scaled(point).x,
    y: headOrigin.y + scaled(point).y,
  });

  const anchored = (targetOnHead: Point, anchor: Point): Point => {
    const target = headLocalToCanvas(targetOnHead);
    const scaledAnchor = scaled(anchor);
    return round({
      x: target.x - scaledAnchor.x,
      y: target.y - scaledAnchor.y,
    });
  };

  return {
    body: round(bodyOrigin),
    head: round(headOrigin),
    hair: anchored(rig.hairTargetOnHead, rig.hairAnchor),
    eyes: anchored(rig.eyesTargetOnHead, rig.eyesAnchor),
    mouth: anchored(rig.mouthTargetOnHead, rig.mouthAnchor),
  };
}

async function renderLayerComposite(
  canvas: DialoguePresetManifest['canvas'],
  outputPath: string,
  layers: Array<{ input: Buffer; x: number; y: number }>
): Promise<void> {
  await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      layers.map((layer) => ({
        input: layer.input,
        left: layer.x,
        top: layer.y,
      }))
    )
    .png()
    .toFile(outputPath);
}
