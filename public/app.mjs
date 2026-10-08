import {evaluateWeather} from './weather-model.mjs';
import {renderStamp,resetStamp} from './stamp.mjs';

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
const root = $('weather-stamp');
const state = {data:null,location:null,controller:null,loading:false,geoRequest:0};

for (const [name,lat,lon] of cities.sort((a,b)=>a[0].localeCompare(b[0],'da'))) {
  const option = new Option(name,name); option.dataset.lat=lat; option.dataset.lon=lon; $('city').add(option);
}

function notice(message='') { $('notice').textContent=message; $('notice').hidden=!message; }

function setLoading(loading) {
  state.loading=loading;
  document.body.dataset.loading=String(loading);
  root.setAttribute('aria-busy',String(loading));
  $('locate').disabled=loading;
  $('locate').querySelector('span').textContent=loading?'Henter vejr…':'Brug min lokation';
  $('refresh').disabled=loading || !state.location;
}

function render() {
  if (!state.data) return;
  const now=new Date();
  const result=evaluateWeather(state.data,null,now);
  renderStamp(root,state.data,state.location,now);
  document.body.dataset.verdict=result.verdict;
  const answers={rain:'Ja',dry:'Nej',unknown:'Ved ikke'};
  $('stamp-answer').textContent=`Regntøj i dag: ${answers[result.verdict]}`;
  $('stamp-answer').setAttribute('role','status');
  $('forecast-detail').textContent=result.verdict==='rain'
    ? result.observedWet?'Der er frisk målt nedbør i nærheden. Tag regntøj med.'
      :'DMI forventer nedbør fra nu til midnat. Tag regntøj med.'
    : result.verdict==='dry'?'Prognosen viser ingen væsentlig nedbør fra nu til midnat.'
      :'Prognosen dækker ikke dagen godt nok til at afgøre, om regntøjet skal med.';
  const warnings=[...state.data.warnings];
  if(state.data.forecast && !result.complete)warnings.push('Prognosen dækker ikke hele resten af dagen.');
  $('data-warnings').replaceChildren(...warnings.map(message=>{const p=document.createElement('p');p.textContent=message;return p;}));
  $('info-toggle').classList.toggle('has-warning',warnings.length>0);
  $('info-toggle').title=warnings.length?'Der mangler nogle vejrdata — læs mere':'Om vejrdata og privatliv';
}

async function load(location) {
  state.geoRequest++;
  state.controller?.abort();
  const controller=new AbortController(); state.controller=controller;
  state.location=location; state.data=null;
  resetStamp(root,location,true); setLoading(true); notice();
  document.body.dataset.verdict='unknown';
  $('stamp-answer').textContent='Regntøj i dag: …';
  $('data-warnings').replaceChildren();
  $('forecast-detail').textContent='Henter prognosen for resten af dagen…';
  $('info-toggle').classList.remove('has-warning');
  const timeout=setTimeout(()=>controller.abort('timeout'),30000);
  try {
    const params=new URLSearchParams({lat:location.lat.toFixed(2),lon:location.lon.toFixed(2)});
    const response=await fetch(`/api/weather?${params}`,{signal:controller.signal});
    const data=await response.json();
    if(state.controller!==controller)return;
    if(!response.ok && !data.fetchedAt)throw new Error(data.error || 'Vejrdata kunne ikke hentes. Prøv igen om lidt.');
    if(!data.fetchedAt || !Array.isArray(data.warnings))throw new Error('Vejrdata kunne ikke læses.');
    state.data=data; render();
  } catch(error) {
    if(state.controller!==controller)return;
    resetStamp(root,location);
    root.querySelector('[data-stamp="weather"]').textContent='Vejr ukendt';
    root.querySelector('[data-stamp="temperature-source"]').textContent='Der mangler aktuelle vejrdata.';
    root.querySelector('[data-stamp="weather-source"]').textContent='Prøv at opdatere om lidt.';
    $('stamp-answer').textContent='Regntøj i dag: Ved ikke';
    $('forecast-detail').textContent='Vi kunne ikke hente en prognose for resten af dagen.';
    $('info-toggle').classList.add('has-warning');
    notice(controller.signal.aborted?'Det tog for lang tid at hente vejret. Prøv igen om lidt.':error.message);
  } finally {
    clearTimeout(timeout);
    if(state.controller===controller)setLoading(false);
  }
}

$('city').addEventListener('change',()=>{
  const option=$('city').selectedOptions[0]; if(!option.value)return;
  state.geoRequest++;
  try {localStorage.setItem('regntoej-city',option.value);}catch{}
  load({name:option.value,lat:Number(option.dataset.lat),lon:Number(option.dataset.lon)});
});
$('locate').addEventListener('click',()=>{
  if(!navigator.geolocation){notice('Din browser understøtter ikke lokation. Vælg en by i stedet.');return;}
  $('locate').disabled=true; $('locate').querySelector('span').textContent='Finder lokation…';notice();
  const request=++state.geoRequest;
  navigator.geolocation.getCurrentPosition(position=>{
    if(request!==state.geoRequest)return;
    $('city').value='';
    try {localStorage.removeItem('regntoej-city');}catch{}
    load({name:'Din lokation',lat:Math.round(position.coords.latitude*100)/100,lon:Math.round(position.coords.longitude*100)/100});
  },error=>{
    if(request!==state.geoRequest)return;
    $('locate').disabled=state.loading;
    $('locate').querySelector('span').textContent=state.loading?'Henter vejr…':'Brug min lokation';
    notice(error.code===1?'Adgang til din lokation blev ikke givet. Vælg din by, eller tillad lokation i browseren.':'Din lokation kunne ikke findes. Vælg din by i stedet.');
  },{enableHighAccuracy:false,timeout:12000,maximumAge:300000});
});
$('info-toggle').addEventListener('click',()=>{
  const expanded=$('info-toggle').getAttribute('aria-expanded')==='true';
  $('info-toggle').setAttribute('aria-expanded',String(!expanded));
  $('weather-info').hidden=expanded;
});
$('refresh').addEventListener('click',()=>state.location && load(state.location));
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',render);
setInterval(()=>{if(state.location && !state.loading && document.visibilityState==='visible')load(state.location);},5*60000);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && state.location && !state.loading && (!state.data || Date.now()-Date.parse(state.data.fetchedAt)>5*60000))load(state.location);
});
resetStamp(root);
try {
  const remembered=localStorage.getItem('regntoej-city');
  const city=cities.find(c=>c[0]===remembered);
  if(city){$('city').value=city[0];load({name:city[0],lat:city[1],lon:city[2]});}
}catch{}
