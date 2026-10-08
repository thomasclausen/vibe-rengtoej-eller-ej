import { evaluateWeather, TIME_ZONE } from './weather-model.mjs';

const cities = [
  ['København',55.6761,12.5683],['Aarhus',56.1629,10.2039],['Odense',55.4038,10.4024],['Aalborg',57.0488,9.9217],
  ['Esbjerg',55.467,8.452],['Randers',56.4607,10.0364],['Kolding',55.4904,9.4722],['Horsens',55.8607,9.8503],
  ['Vejle',55.7113,9.5364],['Roskilde',55.6419,12.0878],['Herning',56.1393,8.973],['Silkeborg',56.1697,9.5451],
  ['Næstved',55.2299,11.7609],['Fredericia',55.5657,9.7526],['Viborg',56.452,9.402],['Køge',55.458,12.182],
  ['Holstebro',56.3601,8.6161],['Slagelse',55.4028,11.3545],['Hillerød',55.9279,12.3008],['Helsingør',56.0361,12.6136],
  ['Sønderborg',54.9138,9.7922],['Svendborg',55.0598,10.6068],['Hjørring',57.4642,9.9823],['Holbæk',55.7155,11.7128],
  ['Frederikshavn',57.4407,10.5366],['Haderslev',55.2494,9.4877],['Ringsted',55.4426,11.7901],['Skive',56.567,9.027],
  ['Aabenraa',55.0443,9.4174],['Rønne',55.1009,14.7066],['Nykøbing Falster',54.7654,11.8752],['Kalundborg',55.679,11.089],
  ['Nyborg',55.3127,10.7896],['Skanderborg',56.0345,9.9318],['Grenaa',56.4158,10.8793],['Thisted',56.956,8.694],
  ['Ribe',55.3284,8.7626],['Tønder',54.933,8.867],['Skagen',57.7209,10.5839],['Nakskov',54.830,11.136],
  ['Lemvig',56.548,8.310],['Ringkøbing',56.090,8.245],['Ebeltoft',56.195,10.678],['Faaborg',55.095,10.242],
];
const $ = id => document.getElementById(id);
const state = { data: null, location: null, hours: null, controller: null, loading: false, geoRequest: 0 };
const number = (n, digits = 1) => Number.isFinite(n) ? new Intl.NumberFormat('da-DK', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n) : '—';
const time = date => new Intl.DateTimeFormat('da-DK', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));
const hour = date => new Intl.DateTimeFormat('da-DK', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(date));
const set = (id, value) => { $(id).textContent = value; };
const icons = {
  rain: '<path d="M7 20a6 6 0 0 1 0-12 8 8 0 0 1 15 3 5 5 0 0 1 0 10H7Zm2 5-2 4m10-4-2 4m10-4-2 4"/>',
  cloud: '<path d="M7 24a7 7 0 0 1 0-14 9 9 0 0 1 17 4 5 5 0 0 1 0 10H7Z"/>',
  sun: '<circle cx="16" cy="16" r="7"/><path d="M16 2v4m0 20v4M2 16h4m20 0h4M6 6l3 3m14 14 3 3M6 26l3-3M23 9l3-3"/>',
  snow: '<path d="M16 4v24M5.6 10l20.8 12M5.6 22l20.8-12M12 6l4 4 4-4m-8 20 4-4 4 4M5 14l6-2-1-6m17 12-6 2 1 6M10 26l1-6-6-2m17-12-1 6 6 2"/>',
};

for (const [name,lat,lon] of cities.sort((a,b) => a[0].localeCompare(b[0], 'da'))) {
  const option = new Option(name, name); option.dataset.lat = lat; option.dataset.lon = lon; $('city').add(option);
}

function notice(messages = []) {
  $('notice').replaceChildren(...messages.map(message => { const p = document.createElement('p'); p.textContent = message; return p; }));
  $('notice').hidden = messages.length === 0;
}

function heading(first, second) {
  $('verdict-title').replaceChildren(document.createTextNode(first), document.createElement('br'), document.createTextNode(second));
}

function stat(id, value, unit) {
  const small = document.createElement('small'); small.textContent = unit;
  $(id).replaceChildren(document.createTextNode(value + ' '), small);
}

function setLoading(loading) {
  state.loading = loading;
  document.body.dataset.loading = String(loading);
  $('forecast-card').setAttribute('aria-busy', String(loading));
  $('refresh').disabled = loading || !state.location;
  $('locate').disabled = loading;
  $('locate').querySelector('span').textContent = loading ? 'Henter vejr…' : 'Brug min lokation';
}

function resetResults() {
  state.data = null;
  document.body.dataset.verdict = 'unknown';
  $('hourly').hidden = true; $('forecast-empty').hidden = false;
  $('forecast-empty').querySelector('p').textContent = 'Vi henter dit lokale vejr…';
  $('forecast-empty').querySelector('span').textContent = 'Målinger og prognoser fra DMI.';
  $('interval-note').hidden = true;
  $('rain-gif').hidden = true; $('raincoat-art').hidden = false;
  $('gif-image').removeAttribute('src');
  set('visual-caption', 'Klar til lidt af hvert.');
  stat('rain-value', '—', 'mm'); stat('temperature-value', '—', '°C'); stat('observation-value', '—', 'mm');
  set('rain-detail', 'I de viste tidsrum'); set('observation-detail', 'Nedbør i seneste 10-minutters måling');
  set('updated', 'Henter nye data fra DMI…');
}

function render() {
  if (!state.data) return;
  const now = new Date();
  const result = evaluateWeather(state.data, state.hours, now);
  const place = state.location.name;
  const period = state.hours ? `de næste ${state.hours} timer (senest til midnat)` : 'resten af dagen';
  document.body.dataset.verdict = result.verdict;
  const warnings = [...state.data.warnings];
  if (state.data.forecast && !result.complete) warnings.push('Prognosen dækker ikke hele den valgte periode. Anbefalingen er derfor usikker.');
  if (!result.observationFresh && state.data.observation) warnings.push('Den viste måling er blevet for gammel og bruges ikke i vurderingen.');
  notice(warnings);

  if (result.verdict === 'rain') {
    heading('Ja, tag', 'regntøjet med.');
    set('status-text', result.observedWet ? 'Frisk måling viser nedbør i nærheden' : 'Nedbør i prognosen');
    set('verdict-description', result.observedWet
      ? `Der er målt nedbør ved ${state.data.observation.stationName}, ${number(state.data.observation.distanceKm)} km fra din valgte lokation. Regntøjet er en god idé.`
      : `DMI forventer nedbør ${period}. ${result.firstWet ? `Det første våde tidsrum er kl. ${hour(result.firstWet.start)}–${hour(result.firstWet.end)}.` : 'Også flere små byger kan gøre turen våd.'}`);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('rain-gif').hidden = reducedMotion; $('raincoat-art').hidden = !reducedMotion;
    if (!reducedMotion) {
      $('gif-image').src = 'https://media.giphy.com/media/39fj7g99qyD72/giphy.gif';
      $('gif-image').alt = 'Cute dancing GIF fra GIPHY';
    }
    set('visual-caption', 'Ud i det. Med regntøj.');
  } else {
    $('rain-gif').hidden = true; $('raincoat-art').hidden = false; $('gif-image').removeAttribute('src');
    if (result.verdict === 'dry') {
      heading('Lad regntøjet', 'blive hjemme.');
      set('status-text', 'Det ser tørt ud i din periode');
      set('verdict-description', `DMI’s prognose viser ingen væsentlig nedbør ${period}. ${result.observationFresh ? 'Den nærmeste friske måling viser også tørt vejr.' : 'Der er ingen frisk måling tæt på dig, så vurderingen bygger på prognosen.'} God tur ud!`);
      set('visual-caption', 'Frisk luft? Ja tak.');
    } else {
      heading('Vi mangler', 'lidt af vejret.');
      set('status-text', 'Der er ikke data nok til et sikkert svar');
      set('verdict-description', `Vi kan ikke afgøre, om regntøjet skal med ${period}. Prøv at opdatere om lidt — eller tag det med for en sikkerheds skyld.`);
      set('visual-caption', 'Klar til lidt af hvert.');
    }
  }

  set('place-value', place);
  set('place-detail', `${new Intl.DateTimeFormat('da-DK', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'short' }).format(now)} · til kl. ${time(result.end)}`);
  set('forecast-location', `Prognose · ${place}`);
  stat('rain-value', number(result.totalMm), 'mm');
  set('rain-detail', result.complete ? 'I de viste tidsrum' : 'Kun for tilgængelige tidsrum');
  stat('temperature-value', number(result.intervals.find(h => Number.isFinite(h.temperatureC))?.temperatureC, 0), '°C');
  const observation = state.data.observation;
  stat('observation-value', number(observation?.precipitationMm), 'mm');
  set('observation-detail', observation
    ? `${observation.stationName} · ${number(observation.distanceKm)} km · kl. ${time(observation.observedAt)}${result.observationFresh ? '' : ' · for gammel'}`
    : 'Ingen frisk måling inden for 25 km');

  $('hourly').replaceChildren();
  for (const interval of result.intervals) {
    const wet = Number.isFinite(interval.precipitationMm) && interval.precipitationMm >= 0.2;
    const item = document.createElement('div'); item.className = 'hour' + (wet ? ' wet' : '');
    item.title = `${new Date(interval.start).toLocaleString('da-DK', {timeZone: TIME_ZONE, timeZoneName: 'short'})} – ${time(interval.end)}: ${number(interval.precipitationMm)} mm`;
    const label = document.createElement('div'); label.className = 'hour-time'; label.textContent = `${hour(interval.start)}–${hour(interval.end)}`;
    const icon = document.createElement('div'); icon.className = 'hour-icon'; icon.setAttribute('aria-hidden','true');
    const iconName = wet ? (interval.temperatureC !== null && interval.temperatureC <= 0 ? 'snow' : 'rain') : interval.cloudCover === null || interval.cloudCover >= 0.6 ? 'cloud' : 'sun';
    icon.innerHTML = `<svg viewBox="0 0 32 32">${icons[iconName]}</svg>`;
    const temp = document.createElement('div'); temp.className = 'hour-temperature'; temp.textContent = `${number(interval.temperatureC, 0)}°`;
    const rain = document.createElement('div'); rain.className = 'hour-rain'; rain.textContent = `${number(interval.precipitationMm)} mm`;
    const bar = document.createElement('div'); bar.className = 'rain-bar'; bar.style.width = `${Math.min(45, Math.max(3, (interval.precipitationMm ?? 0) * 18))}px`;
    item.append(label, icon, temp, rain, bar); $('hourly').append(item);
  }
  const hasIntervals = result.intervals.length > 0;
  $('hourly').hidden = !hasIntervals; $('forecast-empty').hidden = hasIntervals;
  $('interval-note').hidden = !hasIntervals;
  $('forecast-empty').querySelector('p').textContent = 'Prognosen holder en lille pause.';
  $('forecast-empty').querySelector('span').textContent = 'Prøv at opdatere om lidt. Vi viser de målinger, der er tilgængelige.';
  set('updated', `Hentet kl. ${time(state.data.fetchedAt)} · DMI HARMONIE + stationsmålinger`);
}

async function load(location) {
  state.geoRequest++;
  state.controller?.abort();
  const controller = new AbortController(); state.controller = controller;
  state.location = location; resetResults(); setLoading(true); notice();
  set('place-value', location.name); set('place-detail', 'Henter vejret for din lokation');
  heading('Et øjeblik.', 'Vi tjekker vejret.'); set('status-text', 'Henter målinger og prognose');
  set('verdict-description', 'Vi samler de seneste målinger og dagens prognose fra DMI.');
  set('forecast-location', `Prognose · ${location.name}`);
  set('location-caption', `${location.name} · ${number(location.lat,2)}° N, ${number(location.lon,2)}° Ø`);
  const timeout = setTimeout(() => controller.abort('timeout'), 30000);
  try {
    const params = new URLSearchParams({ lat: location.lat.toFixed(2), lon: location.lon.toFixed(2) });
    const response = await fetch(`/api/weather?${params}`, { signal: controller.signal });
    const data = await response.json();
    if (state.controller !== controller) return;
    if (!response.ok && !data.fetchedAt) throw new Error(data.error ?? 'Vejrdata kunne ikke hentes. Prøv igen om lidt.');
    if (!data.fetchedAt || !Array.isArray(data.warnings)) throw new Error('Vejrdata kunne ikke læses. Prøv igen om lidt.');
    state.data = data; render();
  } catch (error) {
    if (state.controller !== controller) return;
    heading('Vejret lader', 'vente på sig.'); set('status-text', 'Vi kunne ikke hente dit vejr');
    set('verdict-description', 'Prøv igen om lidt, eller vælg en anden dansk by. Vi har endnu ikke data nok til at anbefale regntøj eller tørvejr.');
    set('place-detail', 'Ingen tilgængelige vejrdata'); set('updated', 'Ingen opdaterede data');
    $('forecast-empty').querySelector('p').textContent = 'Vi kunne ikke hente vejrdata.';
    $('forecast-empty').querySelector('span').textContent = 'Tryk Opdater for at prøve igen.';
    notice([controller.signal.aborted ? 'Det tog for lang tid at hente vejret. Prøv igen om lidt.' : error.message]);
  } finally {
    clearTimeout(timeout);
    if (state.controller === controller) setLoading(false);
  }
}

$('city').addEventListener('change', () => {
  const option = $('city').selectedOptions[0]; if (!option.value) return;
  state.geoRequest++;
  try { localStorage.setItem('regntoej-city', option.value); } catch { /* Private browsing can disable storage. */ }
  load({name:option.value,lat:Number(option.dataset.lat),lon:Number(option.dataset.lon)});
});
$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) { notice(['Din browser understøtter ikke lokation. Vælg en by i stedet.']); return; }
  $('locate').disabled = true; $('locate').querySelector('span').textContent = 'Finder din lokation…';
  notice();
  const geoRequest = ++state.geoRequest;
  navigator.geolocation.getCurrentPosition(position => {
    if (geoRequest !== state.geoRequest) return;
    $('city').value = '';
    try { localStorage.removeItem('regntoej-city'); } catch { /* No location is stored. */ }
    load({name:'Din lokation', lat:Math.round(position.coords.latitude*100)/100, lon:Math.round(position.coords.longitude*100)/100});
  }, error => {
    if (geoRequest !== state.geoRequest) return;
    $('locate').disabled = state.loading; $('locate').querySelector('span').textContent = state.loading ? 'Henter vejr…' : 'Brug min lokation';
    notice([error.code === 1 ? 'Adgang til din lokation blev ikke givet. Vælg din by, eller tillad lokation i browseren.' : 'Din lokation kunne ikke findes. Vælg din by i stedet.']);
  }, {enableHighAccuracy:false, timeout:12000, maximumAge:300000});
});
$('refresh').addEventListener('click', () => state.location && load(state.location));
document.querySelectorAll('[data-hours]').forEach(button => button.addEventListener('click', () => {
  state.hours = button.dataset.hours ? Number(button.dataset.hours) : null;
  document.querySelectorAll('[data-hours]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  render();
}));
$('gif-image').addEventListener('error', () => { $('rain-gif').hidden = true; $('raincoat-art').hidden = false; });
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => render());
setInterval(() => { if (state.location && !state.loading && document.visibilityState === 'visible') load(state.location); }, 5*60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.location && !state.loading &&
      (!state.data || Date.now() - Date.parse(state.data.fetchedAt) > 5*60000)) load(state.location);
});

try {
  const remembered = localStorage.getItem('regntoej-city');
  const city = cities.find(c => c[0] === remembered);
  if (city) { $('city').value = city[0]; load({name:city[0],lat:city[1],lon:city[2]}); }
} catch { /* App also works without localStorage. */ }
