import { renderStamp } from './stamp.mjs';

const cases = [
  {kind:'sun',place:'Aalborg',temperature:18,cloud:0,rain:0},
  {kind:'cloud',place:'København',temperature:14,cloud:100,rain:0},
  {kind:'rain',place:'Aarhus',temperature:12,cloud:100,rain:0.4},
];
const now = new Date();
for (const example of cases) {
  const clone = document.getElementById('stamp-example').content.cloneNode(true);
  const root = clone.querySelector('.weather-stamp');
  const reading = value => ({value,observedAt:now.toISOString(),stationName:'Eksempeldata'});
  renderStamp(root, {
    current:{temperature:reading(example.temperature),cloudCover:reading(example.cloud)},
    observation:{precipitationMm:example.rain,observedAt:now.toISOString(),stationName:'Eksempeldata'},
  }, {name:example.place},now);
  root.querySelector('.stamp-answer').textContent=example.kind==='rain'?'Regntøj næste 6 t: Ja':'Regntøj næste 6 t: Nej';
  root.setAttribute('aria-label',`Frimærke med eksempeldata: ${example.place}`);
  root.querySelector('[data-stamp="temperature-source"]').textContent='Eksempeldata · ikke en aktuel måling';
  root.querySelector('[data-stamp="weather-source"]').textContent='Motiv og tekst følger vejret i den rigtige app.';
  document.getElementById('stamp-examples').append(clone);
}
