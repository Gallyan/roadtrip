import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

import {
  loadConfig,
  paths,
  buildSegments,
  buildLots,
  writeJson,
} from './lib/project.js';
import { loadRawPoints, resample } from './lib/route.js';

const force = process.argv.includes('--force');

const { config, apiKey, configDir } = loadConfig();
const p = paths(config, configDir);

if (existsSync(p.state) && !force) {
  console.error(
    `✋ ${p.state} existe déjà.\n` +
      `   Replanifier écraserait l'avancement des lots.\n` +
      `   Relance avec --force pour repartir de zéro.`,
  );
  process.exit(1);
}

console.log(`▶ Source : ${config.route.source}`);
const raw = await loadRawPoints(config, apiKey);
console.log(`  ${raw.length} points bruts`);

const points = resample(raw, config.step_m);
const km = ((points.length * config.step_m) / 1000).toFixed(1);
console.log(
  `  ${points.length} points échantillonnés tous les ${config.step_m} m (~${km} km)`,
);

const segments = buildSegments(points.length, config.segment_size, config.route_name);
const lots = buildLots(points.length, config.chunk_size);

mkdirSync(p.buildDir, { recursive: true });

writeFileSync(
  p.locations,
  `${points.map((pt) => `${pt.lat},${pt.lng},${pt.heading}`).join('\n')}\n`,
);

writeJson(p.plan, {
  routeName: config.route_name,
  stepM: config.step_m,
  count: points.length,
  segments,
  lots,
});

writeJson(p.state, {
  routeName: config.route_name,
  lots: Object.fromEntries(
    lots.map((l) => [l.id, { status: 'pending', fetched: 0, noImagery: 0, failed: 0, lastRun: null }]),
  ),
  noImageryFrames: [],
});

// Fichier prêt à copier dans Site/data/
writeJson(
  p.siteSegments,
  segments.map((s) => ({ folder_name: s.folder_name, count: s.count })),
);

console.log(`\n✅ Plan créé dans ${p.buildDir}`);
console.log(`   ${segments.length} segment(s), ${lots.length} lot(s) de ${config.chunk_size} images max.`);
console.log(`   → lance « npm run fetch » une fois par mois pour traiter le lot suivant.`);
