import { existsSync } from 'node:fs';

import { loadConfig, paths, readJson } from './lib/project.js';

const { config, configDir } = loadConfig();
const p = paths(config, configDir);

if (!existsSync(p.plan)) {
  console.log('Aucun plan. Lance « npm run plan ».');
  process.exit(0);
}

const plan = readJson(p.plan);
const state = readJson(p.state);

const km = ((plan.count * plan.stepM) / 1000).toFixed(1);
console.log(`Parcours « ${plan.routeName} » — ${plan.count} images (~${km} km)`);
console.log(`Lots de ${plan.lots[0]?.count ?? '?'} images max :\n`);

let done = 0;
for (const lot of plan.lots) {
  const s = state.lots[lot.id];
  if (s.status === 'done') {
    done++;
  }
  const icon = s.status === 'done' ? '✅' : s.status === 'partial' ? '🟧' : '⬜';
  const extra = s.failed ? `, ${s.failed} échecs` : '';
  console.log(
    `  ${icon} ${lot.id}  frames ${lot.startFrame}-${lot.endFrame - 1}  ` +
      `[${s.status}]  ${s.fetched || 0} img${extra}`,
  );
}

const remaining = plan.lots.length - done;
console.log(`\n${done}/${plan.lots.length} lots faits. ${remaining} restant(s) → ~${remaining} mois.`);
console.log(`Frames sans imagerie (gaps connus) : ${state.noImageryFrames.length}.`);
