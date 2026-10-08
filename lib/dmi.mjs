import { midnightAfter } from '../public/weather-model.mjs';

const BASE = 'https://opendataapi.dmi.dk';
const cache = new Map();
const inFlight = new Map();
const validNumber = value => typeof value === 'number' && Number.isFinite(value);

export class DmiError extends Error {
  constructor(status, message = 'DMI kunne ikke kontaktes') { super(message); this.status = status; }
}

export function validateCoordinates(params) {
  const a = params.get('lat'); const o = params.get('lon');
  if (a === null || o === null || !a.trim() || !o.trim()) throw new DmiError(400, 'Vælg en lokation først.');
  const lat = Number(a), lon = Number(o);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new DmiError(400, 'Lokationen er ugyldig.');
  if (lat < 54.4 || lat > 58 || lon < 7.5 || lon > 15.5) throw new DmiError(422, 'Appen understøtter i øjeblikket Danmark. Vælg en dansk by.');
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

async function getJson(path, params, ttl = 120000) {
  const url = new URL(path, BASE); url.search = new URLSearchParams(params);
  const key = url.href;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = (async () => {
    // One bounded retry for a transient overload. Never cache a failed request.
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try { response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); }
      catch { throw new DmiError(503); }
      if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 800));
        continue;
      }
      if (!response.ok) throw new DmiError(response.status === 429 ? 429 : 503);
      let value;
      try { value = await response.json(); } catch { throw new DmiError(503); }
      if (!Array.isArray(value.features)) throw new DmiError(503, 'DMI svarede med et ukendt dataformat.');
      for (const [k, v] of cache) if (v.expires < Date.now()) cache.delete(k);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: Date.now() + ttl });
      return value;
    }
  })();
  inFlight.set(key, promise);
  try { return await promise; } finally { inFlight.delete(key); }
}

export function distanceKm(lat, lon, otherLat, otherLon) {
  const r = value => value * Math.PI / 180;
  const a = Math.sin(r(otherLat - lat) / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(otherLat)) * Math.sin(r(otherLon - lon) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseForecast(collection, now = new Date()) {
  const points = collection.features.map(f => ({ time: f.properties?.step, p: f.properties ?? {}, coordinate: f.geometry?.coordinates }))
    .filter(f => Number.isFinite(Date.parse(f.time))).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const intervals = [];
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1], current = points[i];
    const duration = Date.parse(current.time) - Date.parse(before.time);
    const previousMm = before.p['total-precipitation'], currentMm = current.p['total-precipitation'];
    const delta = validNumber(previousMm) && validNumber(currentMm) ? currentMm - previousMm : null;
    const mm = duration > 0 && duration <= 3600000 + 1000 && delta !== null && delta >= -0.01 ? Math.max(0, delta) : null;
    intervals.push({ start: before.time, end: current.time,
      precipitationMm: mm === null ? null : Math.round(mm * 1000) / 1000,
      temperatureC: validNumber(current.p['temperature-2m']) ? current.p['temperature-2m'] - 273.15 : null,
      windMs: validNumber(current.p['wind-speed-10m']) ? current.p['wind-speed-10m'] : null,
      cloudCover: validNumber(current.p['fraction-of-cloud-cover']) ? current.p['fraction-of-cloud-cover'] : null,
    });
  }
  // This is the first step in the returned run, not necessarily the model's initialization time.
  const latestTime = points.at(-1)?.time ?? null;
  const firstTime = points[0]?.time ?? null;
  const runAge = now.getTime() - Date.parse(firstTime);
  const end = midnightAfter(now).getTime();
  return { model: 'DMI HARMONIE DINI', gridPoint: points[0]?.coordinate ?? null,
    firstStep: firstTime,
    fresh: Boolean(latestTime && Date.parse(latestTime) >= now.getTime() && runAge >= -3600000 && runAge <= 12 * 3600000),
    intervals: intervals.filter(h => Date.parse(h.end) > now.getTime() && Date.parse(h.start) < end) };
}

export function selectMeasurement(collection, stations, lat, lon, parameterId, now = new Date()) {
  const latest = new Map();
  for (const f of collection.features) {
    const p = f.properties ?? {}, c = f.geometry?.coordinates;
    const age = now.getTime() - Date.parse(p.observed);
    const plausible = parameterId === 'temp_dry' ? p.value >= -70 && p.value <= 60
      : parameterId === 'cloud_cover' ? (p.value >= 0 && p.value <= 100) || p.value === 112 : p.value >= 0;
    if (p.parameterId !== parameterId || !validNumber(p.value) || !plausible || !Number.isFinite(age) || age < -60000 || age > 30 * 60000 || !c || !c.every(validNumber)) continue;
    const distance = distanceKm(lat, lon, c[1], c[0]);
    if (distance > 25) continue;
    const previous = latest.get(p.stationId);
    if (!previous || Date.parse(p.observed) > Date.parse(previous.observedAt)) {
      latest.set(p.stationId, { stationId: p.stationId, observedAt: p.observed,
        value: p.value, distanceKm: Math.round(distance * 10) / 10 });
    }
  }
  const result = [...latest.values()].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (!result) return null;
  const names = stations?.features ?? [];
  const station = names.find(f => f.properties?.stationId === result.stationId &&
    (!f.properties.validFrom || Date.parse(f.properties.validFrom) <= now.getTime()) &&
    (!f.properties.validTo || Date.parse(f.properties.validTo) > now.getTime()));
  return { ...result, stationName: station?.properties.name ?? `Station ${result.stationId}` };
}

export function selectObservation(collection, stations, lat, lon, now = new Date()) {
  const measurement = selectMeasurement(collection, stations, lat, lon, 'precip_past10min', now);
  if (!measurement) return null;
  const { value, ...station } = measurement;
  return { ...station, precipitationMm: value, periodMinutes: 10 };
}

export async function loadWeather(lat, lon, now = new Date()) {
  const bbox = [lon - 0.45, lat - 0.25, lon + 0.45, lat + 0.25].map(x => x.toFixed(3)).join(',');
  const obsParams = { bbox, parameterId: 'precip_past10min', period: 'latest-hour', limit: '1000' };
  const [forecastResult, observationResult, stationsResult, temperatureResult, cloudResult] = await Promise.allSettled([
    getJson('/v1/forecastedr/collections/harmonie_dini_sf/position', {
      coords: `POINT(${lon} ${lat})`, crs: 'crs84', f: 'GeoJSON',
      'parameter-name': 'total-precipitation,temperature-2m,wind-speed-10m,fraction-of-cloud-cover',
    }),
    getJson('/v2/metObs/collections/observation/items', obsParams),
    getJson('/v2/metObs/collections/station/items', { bbox, status: 'Active', limit: '1000' }, 3600000),
    getJson('/v2/metObs/collections/observation/items', { ...obsParams, parameterId: 'temp_dry' }),
    getJson('/v2/metObs/collections/observation/items', { ...obsParams, parameterId: 'cloud_cover' }),
  ]);
  const forecast = forecastResult.status === 'fulfilled' ? parseForecast(forecastResult.value, now) : null;
  const observation = observationResult.status === 'fulfilled'
    ? selectObservation(observationResult.value, stationsResult.status === 'fulfilled' ? stationsResult.value : null, lat, lon, now) : null;
  const stations = stationsResult.status === 'fulfilled' ? stationsResult.value : null;
  const measurement = (result, parameterId) => result.status === 'fulfilled'
    ? selectMeasurement(result.value, stations, lat, lon, parameterId, now) : null;
  const temperature = measurement(temperatureResult, 'temp_dry');
  const cloudCover = measurement(cloudResult, 'cloud_cover');
  const warnings = [];
  if (!forecast) warnings.push(forecastResult.reason?.status === 429
    ? 'DMI’s prognosetjeneste er optaget. Prøv igen om et øjeblik.' : 'Prognosen kunne ikke hentes fra DMI.');
  if (!observation) warnings.push('Ingen frisk nedbørsmåling inden for 25 km. Målingerne kan derfor ikke indgå i vurderingen.');
  return { fetchedAt: now.toISOString(), location: { lat, lon }, forecast, observation,
    current: { temperature, cloudCover }, warnings };
}
