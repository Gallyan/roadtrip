import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

export function loadConfig() {
  const arg = process.argv.slice(2).find((a) => a.endsWith('.json'));
  const configPath = resolve(arg || 'config.json');

  if (!existsSync(configPath)) {
    throw new Error(
      `Config introuvable : ${configPath}\n   Copie config.example.json → config.json et édite-le.`,
    );
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const configDir = dirname(configPath);
  config.__dir = configDir;

  return { config, apiKey: process.env.GOOGLE_MAPS_API_KEY || '', configDir };
}

export function paths(config, configDir) {
  const buildDir = join(configDir, 'build', config.route_name);
  return {
    buildDir,
    locations: join(buildDir, 'locations.txt'),
    plan: join(buildDir, 'plan.json'),
    state: join(buildDir, 'state.json'),
    siteSegments: join(buildDir, 'segments.json'),
    imagesRoot: resolve(configDir, config.output_dir, config.route_name),
  };
}

export function buildSegments(count, segmentSize, routeName) {
  const size = !segmentSize || segmentSize >= count ? count : segmentSize;
  const segments = [];
  let start = 0;
  let index = 1;

  while (start < count) {
    const c = Math.min(size, count - start);
    segments.push({
      folder_name: `${routeName}-${String(index).padStart(2, '0')}`,
      count: c,
      startFrame: start,
    });
    start += c;
    index++;
  }

  return segments;
}

export function buildLots(count, chunkSize) {
  const lots = [];
  let start = 0;
  let index = 1;

  while (start < count) {
    const end = Math.min(start + chunkSize, count);
    lots.push({
      id: `lot-${String(index).padStart(3, '0')}`,
      startFrame: start,
      endFrame: end,
      count: end - start,
    });
    start = end;
    index++;
  }

  return lots;
}

export function frameToSegment(frame, segments) {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (frame >= segments[i].startFrame) {
      return { folder: segments[i].folder_name, local: frame - segments[i].startFrame };
    }
  }
  return { folder: segments[0].folder_name, local: frame };
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
