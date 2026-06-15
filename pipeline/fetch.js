import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, paths, frameToSegment, readJson, writeJson } from './lib/project.js';
import { loadLocations } from './lib/route.js';
import { checkMetadata, fetchImage } from './lib/streetview.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const lotArg = (() => {
  const i = args.indexOf('--lot');
  return i >= 0 ? args[i + 1] : null;
})();

const { config, apiKey, configDir } = loadConfig();
const p = paths(config, configDir);

if (!apiKey && !dry) {
  console.error("✋ GOOGLE_MAPS_API_KEY manquante (variable d'environnement).");
  process.exit(1);
}

if (!existsSync(p.plan)) {
  console.error('✋ Aucun plan trouvé. Lance d’abord « npm run plan ».');
  process.exit(1);
}

const plan = readJson(p.plan);
const state = readJson(p.state);
const points = loadLocations(p.locations);

const lot = lotArg
  ? plan.lots.find((l) => l.id === lotArg)
  : plan.lots.find((l) => state.lots[l.id].status !== 'done');

if (!lot) {
  console.log(lotArg ? `Lot « ${lotArg} » introuvable.` : '🎉 Tous les lots sont déjà traités.');
  process.exit(0);
}

console.log(
  `▶ Lot ${lot.id} : frames ${lot.startFrame}–${lot.endFrame - 1} (${lot.count} images)${dry ? '  [dry-run]' : ''}`,
);

const noImagery = new Set(state.noImageryFrames);
const frames = [];
for (let f = lot.startFrame; f < lot.endFrame; f++) {
  frames.push(f);
}

let downloaded = 0;
let skippedExisting = 0;
let skippedNoImg = 0;
let failed = 0;
const newNoImg = [];

await pool(frames, config.concurrency || 4, async (frame) => {
  const point = points[frame];
  const { folder, local } = frameToSegment(frame, plan.segments);
  const dir = join(p.imagesRoot, folder);
  const file = join(dir, `${local}.jpg`);

  if (existsSync(file)) {
    skippedExisting++;
    return;
  }

  if (noImagery.has(frame)) {
    skippedNoImg++;
    return;
  }

  if (dry) {
    return;
  }

  try {
    if (config.precheck_metadata) {
      const status = await retry(() => checkMetadata(point, apiKey), 2);
      if (status !== 'OK') {
        skippedNoImg++;
        newNoImg.push(frame);
        return;
      }
    }

    const buffer = await retry(() => fetchImage(point, config.image, apiKey), 2);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, buffer);
    downloaded++;
  } catch (e) {
    failed++;
    process.stderr.write(`  ⚠ frame ${frame} : ${e.message}\n`);
  }

  if ((downloaded + skippedNoImg) % 250 === 0) {
    process.stdout.write(`  … ${downloaded} téléchargées, ${skippedNoImg} sans imagerie\r`);
  }
});

if (!dry) {
  state.noImageryFrames = [...new Set([...state.noImageryFrames, ...newNoImg])].sort(
    (a, b) => a - b,
  );

  const complete = failed === 0;
  state.lots[lot.id] = {
    status: complete ? 'done' : 'partial',
    fetched: (state.lots[lot.id].fetched || 0) + downloaded,
    noImagery: skippedNoImg,
    failed,
    lastRun: new Date().toISOString(),
  };

  writeJson(p.state, state);
}

const tag = failed === 0 ? 'terminé' : 'partiel (relance pour reprendre)';
console.log(
  `\n✅ Lot ${lot.id} ${dry ? 'simulé' : tag} : ` +
    `${downloaded} téléchargées, ${skippedExisting} déjà présentes, ` +
    `${skippedNoImg} sans imagerie, ${failed} échecs.`,
);

const remaining = plan.lots.filter((l) => state.lots[l.id].status !== 'done').length;
console.log(`   Lots restants : ${remaining}  →  ~${remaining} mois au rythme d'un lot/mois.`);

async function pool(items, size, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

async function retry(fn, attempts) {
  let lastError;
  for (let k = 0; k <= attempts; k++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 300 * (k + 1)));
    }
  }
  throw lastError;
}
