import { readFileSync } from 'node:fs';

import { haversine, bearing, interpolate, decodePolyline, round6 } from './geo.js';

export async function loadRawPoints(config, apiKey) {
  const source = config.route.source;

  if (source === 'gpx') {
    return loadGpx(config.route.gpx_file, config);
  }

  if (source === 'directions') {
    return loadDirections(config.route.directions, apiKey);
  }

  throw new Error(`Source de parcours inconnue : « ${source} » (directions | gpx)`);
}

function loadGpx(file, config) {
  if (!file) {
    throw new Error('route.gpx_file manquant dans la config.');
  }

  const xml = readFileSync(resolveFromConfig(file, config), 'utf8');
  const points = [];

  const tagRe = /<(?:trkpt|rtept|wpt)\b[^>]*>/g;
  let match;
  while ((match = tagRe.exec(xml))) {
    const tag = match[0];
    const lat = /\blat="([-\d.]+)"/.exec(tag);
    const lon = /\blon="([-\d.]+)"/.exec(tag);
    if (lat && lon) {
      points.push({ lat: Number(lat[1]), lng: Number(lon[1]) });
    }
  }

  if (points.length < 2) {
    throw new Error(`GPX : moins de 2 points trouvés dans ${file}.`);
  }

  return points;
}

async function loadDirections(d, apiKey) {
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY manquante (requise pour la source « directions »).');
  }

  const params = new URLSearchParams({
    origin: d.origin,
    destination: d.destination,
    mode: d.mode || 'driving',
    key: apiKey,
  });

  if (d.waypoints && d.waypoints.length) {
    params.set('waypoints', d.waypoints.join('|'));
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.status !== 'OK') {
    throw new Error(`Directions API : ${json.status} ${json.error_message || ''}`);
  }

  const points = [];
  for (const leg of json.routes[0].legs) {
    for (const step of leg.steps) {
      for (const p of decodePolyline(step.polyline.points)) {
        points.push(p);
      }
    }
  }

  return points;
}

export function resample(raw, stepM) {
  const clean = dedupe(raw);
  if (clean.length < 2) {
    return clean.map((p) => ({ lat: round6(p.lat), lng: round6(p.lng), heading: 0 }));
  }

  const cumulative = [0];
  for (let i = 1; i < clean.length; i++) {
    cumulative.push(cumulative[i - 1] + haversine(clean[i - 1], clean[i]));
  }
  const total = cumulative[cumulative.length - 1];

  const sampled = [];
  let seg = 1;
  for (let target = 0; target <= total; target += stepM) {
    while (seg < clean.length && cumulative[seg] < target) {
      seg++;
    }
    if (seg >= clean.length) {
      sampled.push(clean[clean.length - 1]);
      break;
    }
    const start = cumulative[seg - 1];
    const end = cumulative[seg];
    const t = end === start ? 0 : (target - start) / (end - start);
    sampled.push(interpolate(clean[seg - 1], clean[seg], t));
  }

  return sampled.map((p, i) => {
    let heading = 0;
    if (i < sampled.length - 1) {
      heading = bearing(p, sampled[i + 1]);
    } else if (i > 0) {
      heading = bearing(sampled[i - 1], p);
    }
    return {
      lat: round6(p.lat),
      lng: round6(p.lng),
      heading: Math.round(heading * 100) / 100,
    };
  });
}

export function loadLocations(file) {
  const text = readFileSync(file, 'utf8').trim();
  if (!text) {
    return [];
  }
  return text.split('\n').map((line) => {
    const [lat, lng, heading] = line.split(',');
    return { lat: Number(lat), lng: Number(lng), heading: Number(heading) };
  });
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.lat !== p.lat || last.lng !== p.lng) {
      out.push(p);
    }
  }
  return out;
}

function resolveFromConfig(file, config) {
  if (file.startsWith('/')) {
    return file;
  }
  return new URL(file, `file://${config.__dir}/`).pathname;
}
