export const TIME_ZONE = 'Europe/Copenhagen';
export const THRESHOLDS = Object.freeze({ observedMm: 0, hourlyMm: 0 });

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
  const end = hours ? now.getTime() + hours * 3600000 : dayEnd;
  const intervals = (data.forecast?.intervals ?? []).filter(h =>
    Date.parse(h.end) > now.getTime() && Date.parse(h.start) < end);
  const known = intervals.filter(h => Number.isFinite(h.precipitationMm));
  const totalMm = known.reduce((sum, h) => sum + h.precipitationMm, 0);
  const maxMm = known.length ? Math.max(...known.map(h => h.precipitationMm)) : null;
  const wetHours = known.filter(h => h.precipitationMm > THRESHOLDS.hourlyMm);
  let coveredTo = now.getTime();
  let complete = intervals.length > 0 && data.forecast?.fresh !== false && data.forecast?.coverageComplete !== false;
  for (const h of intervals) {
    if (!Number.isFinite(h.precipitationMm) || Date.parse(h.start) > coveredTo + 1000) complete = false;
    coveredTo = Math.max(coveredTo, Date.parse(h.end));
  }
  complete &&= coveredTo >= end;
  const observation = data.observation;
  const age = observation ? now.getTime() - Date.parse(observation.observedAt) : Infinity;
  const observationFresh = Boolean(observation && age >= -60000 && age <= 30 * 60000);
  const observedWet = observationFresh && observation.precipitationMm > THRESHOLDS.observedMm;
  const forecastWet = data.forecast?.fresh !== false && wetHours.length > 0;
  const rainWindows = [];
  if (data.forecast?.fresh !== false) for (const h of [...wetHours].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))) {
    const previous = rainWindows.at(-1);
    if (previous && Date.parse(h.start) <= Date.parse(previous.end)) {
      if (Date.parse(h.end) > Date.parse(previous.end)) previous.end = h.end;
    } else rainWindows.push({start:h.start,end:h.end});
  }
  const verdict = observedWet || forecastWet ? 'rain' : complete ? 'dry' : 'unknown';
  return { verdict, observedWet, forecastWet, observationFresh, complete,
    intervals, totalMm: known.length ? totalMm : null, maxMm,
    firstWet: wetHours[0] ?? null, rainWindows, end: new Date(end).toISOString() };
}

export function formatRainWindows(windows) {
  const time = date => new Intl.DateTimeFormat('da-DK', {timeZone:TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date));
  return windows.map(window => `${time(window.start)}–${time(window.end)==='00.00'||time(window.end)==='00:00'?'24:00':time(window.end)}`.replaceAll('.',':')).join(', ');
}

// Today's recommendation and the current weather on the stamp are separate.
// Rain later today must not become a claim that it is raining right now.
export function currentWeather(data, now = new Date()) {
  const fresh = reading => {
    const age = now.getTime() - Date.parse(reading?.observedAt);
    return reading && Number.isFinite(reading.value) && age >= -60000 && age <= 30 * 60000;
  };
  const firstInterval = data.forecast?.fresh !== false
    ? data.forecast?.intervals?.find(h => Date.parse(h.start) <= now.getTime() && Date.parse(h.end) > now.getTime()) : null;
  const measuredTemperature = data.current?.temperature;
  const temperature = fresh(measuredTemperature)
    ? { ...measuredTemperature, source: 'observation' }
    : Number.isFinite(firstInterval?.temperatureC)
      ? { value: firstInterval.temperatureC, range:firstInterval.temperatureRange, observedAt: firstInterval.end, source: 'forecast' } : null;
  const overview = data.scope === 'denmark' ? data.current?.summary : null;
  const overviewAge = now.getTime() - Date.parse(overview?.observedAt);
  if (overview && overviewAge >= -60000 && overviewAge <= 30*60000) {
    return {temperature,kind:overview.kind,label:overview.label,source:'observation',observedAt:overview.observedAt,stationName:overview.stationName};
  }
  if (data.scope === 'denmark' && firstInterval?.weatherKind) {
    return {temperature,kind:firstInterval.weatherKind,label:firstInterval.weatherLabel,source:'forecast',observedAt:firstInterval.end};
  }
  const precipitation = data.observation;
  const rainAge = now.getTime() - Date.parse(precipitation?.observedAt);
  if (precipitation && Number.isFinite(precipitation.precipitationMm) && precipitation.precipitationMm > 0 && rainAge >= -60000 && rainAge <= 30 * 60000) {
    return { temperature, kind: 'rain', label: 'Regnvejr', source: 'observation',
      observedAt: precipitation.observedAt, stationName: precipitation.stationName };
  }
  const cloud = data.current?.cloudCover;
  if (fresh(cloud)) {
    const kind = cloud.value <= 25 ? 'sun' : cloud.value >= 75 && cloud.value <= 100 ? 'cloud' : cloud.value === 112 ? 'unknown' : 'partly-cloudy';
    return { temperature, kind, label: {sun:'Sol',cloud:'Overskyet','partly-cloudy':'Let skyet',unknown:'Vejr ukendt'}[kind],
      source: 'observation', observedAt: cloud.observedAt, stationName: cloud.stationName, distanceKm: cloud.distanceKm, regional: cloud.regional };
  }
  if (precipitation && precipitation.precipitationMm === 0 && rainAge >= -60000 && rainAge <= 30 * 60000) {
    return {temperature,kind:'dry',label:'Ingen målt regn',source:'observation',
      observedAt:precipitation.observedAt,stationName:precipitation.stationName,distanceKm:precipitation.distanceKm,
      note:'Der mangler en frisk skydækkemåling i nærheden. Dette betyder ikke nødvendigvis sol eller skyfrit vejr.'};
  }
  if (firstInterval && Number.isFinite(firstInterval.cloudCover)) {
    const kind = firstInterval.precipitationMm > 0 ? 'rain'
      : firstInterval.cloudCover <= 0.25 ? 'sun' : firstInterval.cloudCover >= 0.75 ? 'cloud' : 'partly-cloudy';
    return { temperature, kind, label: {rain:'Regnvejr',sun:'Sol',cloud:'Overskyet','partly-cloudy':'Let skyet'}[kind],
      source: 'forecast', observedAt: firstInterval.end };
  }
  return { temperature, kind: 'unknown', label: 'Vejr ukendt', source: null, observedAt: null };
}
