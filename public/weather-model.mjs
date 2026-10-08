export const TIME_ZONE = 'Europe/Copenhagen';
export const THRESHOLDS = Object.freeze({ observedMm: 0.1, hourlyMm: 0.2, totalMm: 0.5 });

export function midnightAfter(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const target = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1);
  let guess = target;
  // Convert a local midnight to UTC using the offset at that midnight, also across DST.
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
    const localAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += target - localAsUtc;
  }
  return new Date(guess);
}

export function evaluateWeather(data, hours = null, now = new Date()) {
  const dayEnd = midnightAfter(now).getTime();
  const end = hours ? Math.min(dayEnd, now.getTime() + hours * 3600000) : dayEnd;
  const intervals = (data.forecast?.intervals ?? []).filter(h =>
    Date.parse(h.end) > now.getTime() && Date.parse(h.start) < end);
  const known = intervals.filter(h => Number.isFinite(h.precipitationMm));
  const totalMm = known.reduce((sum, h) => sum + h.precipitationMm, 0);
  const maxMm = known.length ? Math.max(...known.map(h => h.precipitationMm)) : null;
  const wetHours = known.filter(h => h.precipitationMm >= THRESHOLDS.hourlyMm);
  let coveredTo = now.getTime();
  let complete = intervals.length > 0 && data.forecast?.fresh !== false;
  for (const h of intervals) {
    if (!Number.isFinite(h.precipitationMm) || Date.parse(h.start) > coveredTo + 1000) complete = false;
    coveredTo = Math.max(coveredTo, Date.parse(h.end));
  }
  complete &&= coveredTo >= end;
  const observation = data.observation;
  const age = observation ? now.getTime() - Date.parse(observation.observedAt) : Infinity;
  const observationFresh = Boolean(observation && age >= -60000 && age <= 30 * 60000);
  const observedWet = observationFresh && observation.precipitationMm >= THRESHOLDS.observedMm;
  const forecastWet = data.forecast?.fresh !== false && (wetHours.length > 0 || totalMm >= THRESHOLDS.totalMm);
  const verdict = observedWet || forecastWet ? 'rain' : complete ? 'dry' : 'unknown';
  return { verdict, observedWet, forecastWet, observationFresh, complete,
    intervals, totalMm: known.length ? totalMm : null, maxMm,
    firstWet: wetHours[0] ?? null, end: new Date(end).toISOString() };
}
