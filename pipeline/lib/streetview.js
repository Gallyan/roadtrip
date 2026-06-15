const BASE = 'https://maps.googleapis.com/maps/api/streetview';

export async function checkMetadata(point, apiKey) {
  const params = new URLSearchParams({
    location: `${point.lat},${point.lng}`,
    key: apiKey,
  });

  const res = await fetch(`${BASE}/metadata?${params}`);
  const json = await res.json();

  return json.status; // "OK" | "ZERO_RESULTS" | "NOT_FOUND" | ...
}

export async function fetchImage(point, image, apiKey) {
  const params = new URLSearchParams({
    size: image.size || '640x640',
    location: `${point.lat},${point.lng}`,
    heading: String(point.heading),
    pitch: String(image.pitch ?? -0.76),
    fov: String(image.fov ?? 90),
    key: apiKey,
  });

  if (image.scale && image.scale !== 1) {
    params.set('scale', String(image.scale));
  }

  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
