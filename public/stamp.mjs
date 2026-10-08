import { currentWeather, TIME_ZONE } from './weather-model.mjs';

const field = (root, name) => root.querySelector(`[data-stamp="${name}"]`);
const clock = date => new Intl.DateTimeFormat('da-DK', { timeZone: TIME_ZONE, hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(date));
const degree = value => new Intl.NumberFormat('da-DK', {maximumFractionDigits:0}).format(Math.abs(value)<0.5 ? 0 : value);
const artworks = {sun:'weather-sun.svg', cloud:'weather-cloud.svg', 'partly-cloudy':'weather-partly-cloudy.svg', rain:'weather-rain.svg', unknown:'weather-unknown.svg'};

function locationText(location) {
  if (!location) return 'Din lokation';
  if (location.name !== 'Din lokation') return location.name;
  return `${location.lat.toLocaleString('da-DK',{minimumFractionDigits:2,maximumFractionDigits:2})}° N · ${location.lon.toLocaleString('da-DK',{minimumFractionDigits:2,maximumFractionDigits:2})}° Ø`;
}

function setArtwork(root, kind, reducedMotion) {
  const gif = field(root,'gif'); const image = field(root,'gif-image'); const art = field(root,'art');
  if (kind !== 'rain') delete image.dataset.failed;
  const showGif = kind === 'rain' && !reducedMotion && image.dataset.failed !== 'true';
  image.dataset.wanted=String(showGif);
  const ready=showGif&&image.dataset.loaded==='true';
  art.src = '/assets/' + artworks[kind];
  art.hidden = ready; gif.hidden = !ready; field(root,'gif-credit').hidden = !ready;
  if (showGif) {
    if (!image.getAttribute('src')) image.src = 'https://media.giphy.com/media/39fj7g99qyD72/giphy.gif';
  } else {image.removeAttribute('src');delete image.dataset.loaded;}
  if (!image.dataset.fallbackBound) {
    image.dataset.fallbackBound = 'true';
    image.addEventListener('load',()=>{image.dataset.loaded='true';if(image.dataset.wanted==='true'&&image.dataset.failed!=='true'){gif.hidden=false;art.hidden=true;field(root,'gif-credit').hidden=false;}});
    image.addEventListener('error', () => {image.dataset.failed='true';gif.hidden=true;art.hidden=false;field(root,'gif-credit').hidden=true;});
  }
}

function setTemperature(root, value) {
  const element = field(root,'temperature');
  const suffix = element.ownerDocument.createElement('sup'); suffix.textContent = '°';
  element.replaceChildren(element.ownerDocument.createTextNode(value), suffix);
}

export function resetStamp(root, location = null, loading = false) {
  root.dataset.weather = 'unknown';
  root.setAttribute('aria-busy', String(loading));
  setTemperature(root,'—');
  field(root,'weather').textContent = loading ? 'Et øjeblik' : 'Dit vejr';
  field(root,'location').textContent = locationText(location);
  field(root,'temperature-source').textContent = loading ? 'Henter friske målinger fra DMI…' : 'Graderne kommer fra en frisk DMI-måling.';
  field(root,'weather-source').textContent = loading ? 'Vi tjekker vejret for din lokation.' : 'Vælg lokation for at se dit lokale vejr.';
  setArtwork(root,'unknown',true);
}

export function renderStamp(root, data, location, now = new Date(), reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const current = currentWeather(data, now);
  root.dataset.scope = data.scope || 'local';
  root.dataset.weather = current.kind;
  root.setAttribute('aria-busy','false');
  const range=current.temperature?.range;
  const value=range&&Number.isFinite(range.min)&&Number.isFinite(range.max)
    ? degree(range.min)===degree(range.max)?degree(range.min):`${degree(range.min)}–${degree(range.max)}`
    : current.temperature?degree(current.temperature.value):'—';
  setTemperature(root,value);
  field(root,'weather').textContent = current.label;
  field(root,'location').textContent = locationText(location);
  const temperature = current.temperature;
  const distance=reading=>Number.isFinite(reading?.distanceKm)?` · ${new Intl.NumberFormat('da-DK',{maximumFractionDigits:1}).format(reading.distanceKm)} km væk${reading.regional?' · regional måling':''}`:'';
  field(root,'temperature-source').textContent = temperature
    ? temperature.source === 'observation'
      ? `Temperatur: målt ved ${temperature.stationName || 'nærmeste station'} kl. ${clock(temperature.observedAt)}${distance(temperature)}`
      : `Temperatur: prognose for kl. ${clock(temperature.observedAt)}`
    : 'Temperatur: ingen frisk måling eller prognose.';
  field(root,'weather-source').textContent = current.source === 'observation'
    ? `Vejrtype: vurderet ud fra måling ved ${current.stationName || 'nærmeste station'}${distance(current)}`
    : current.source === 'forecast' ? 'Vejrtype: vurderet ud fra den nærmeste timeprognose.' : 'Vejrtype: der mangler aktuelle data.';
  setArtwork(root,current.kind,reducedMotion);
  return current;
}
