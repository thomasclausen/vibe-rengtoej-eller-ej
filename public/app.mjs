import {evaluateWeather,formatRainWindows} from './weather-model.mjs';
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

const HORIZON_HOURS=6;
const $=id=>document.getElementById(id);
const root=$('weather-stamp');
const slot=()=>({data:null,currentPending:false,forecastPending:false,currentWarnings:[],forecastWarnings:[],currentGeneration:0,forecastGeneration:0,controllers:{}});
const state={country:slot(),local:null,target:null,geoRequest:0,countryReady:null};
for(const [name,lat,lon] of cities.sort((a,b)=>a[0].localeCompare(b[0],'da'))){const option=new Option(name,name);option.dataset.lat=lat;option.dataset.lon=lon;$('city').add(option);}
const fresh=reading=>{const age=Date.now()-Date.parse(reading?.observedAt);return reading&&age>=-60000&&age<=30*60000;};
const useful=data=>Boolean(data&&(fresh(data.current?.temperature)||fresh(data.current?.cloudCover)||fresh(data.current?.summary)||fresh(data.observation)||data.forecast?.fresh!==false&&data.forecast?.intervals?.some(h=>Date.parse(h.end)>Date.now())));
const active=()=>useful(state.local?.data)?state.local:state.country;
const periodLabel=()=> 'de næste 6 timer';
function notice(message=''){$('notice').textContent=message;$('notice').hidden=!message;}
function merge(target,data,part){
  target.data={...(target.data||{}),...data};
  if(part==='current')target.currentWarnings=data.warnings||[];else target.forecastWarnings=data.warnings||[];
  target.data.warnings=[...new Set([...target.currentWarnings,...target.forecastWarnings])];
}
function display(){
  const current=active(),data=current.data;
  const now=new Date();
  if(useful(data)){
    const location=data.scope==='denmark'?{name:'Danmark (overblik)'}:state.target;
    renderStamp(root,data,location,now);
    const result=evaluateWeather(data,HORIZON_HOURS,now);
    document.body.dataset.verdict=result.verdict;
    const prefix='Regntøj næste 6 t';
    const answer=result.verdict==='rain'?'Ja':current.forecastPending?'…':result.verdict==='dry'?'Nej':'Ved ikke';
    $('stamp-answer').textContent=`${prefix}: ${answer}`;
    $('rain-times').textContent=result.rainWindows.length?formatRainWindows(result.rainWindows):'';
    $('rain-times').hidden=!result.rainWindows.length;
    root.dataset.rainTimes=String(result.rainWindows.length>0);
    $('forecast-detail').textContent=current.forecastPending?`Henter prognosen for ${periodLabel()}. De aktuelle målinger er allerede vist.`
      :result.verdict==='rain'?result.rainWindows.length?`Forventet nedbør ${periodLabel()}: ${formatRainWindows(result.rainWindows)}.`:'Der er frisk målt nedbør. Prognosens regntider er ikke tilgængelige.'
        :result.verdict==='dry'?`Ingen forventet nedbør ${periodLabel()}.`:'Prognosen er ikke tilgængelig eller dækker ikke hele perioden. Vi svarer derfor ikke nej.';
    const warnings=[...data.warnings];
    if(data.forecast&&!result.complete)warnings.push('Prognosen dækker ikke hele den valgte periode.');
    $('data-warnings').replaceChildren(...warnings.map(message=>{const p=document.createElement('p');p.textContent=message;return p;}));
    $('info-toggle').classList.toggle('has-warning',warnings.length>0);
    $('info-toggle').title=warnings.length?'Der mangler nogle vejrdata — læs mere':'Om vejrdata og privatliv';
  }else{
    resetStamp(root,{name:'Danmark (overblik)'},state.country.currentPending);
    $('stamp-answer').textContent=state.country.currentPending?'Regntøj næste 6 t: …':'Regntøj næste 6 t: Ved ikke';
    $('rain-times').hidden=true;root.dataset.rainTimes='false';
    $('forecast-detail').textContent='Vejrdata er endnu ikke tilgængelige.';
  }
  $('refresh').disabled=state.country.currentPending||Boolean(state.local?.currentPending);
  root.setAttribute('aria-busy',String(!useful(data)&&state.country.currentPending));
}
async function request(scope,part,location,controller){
  const params=new URLSearchParams({scope,part});
  if(scope==='local'){params.set('lat',location.lat.toFixed(2));params.set('lon',location.lon.toFixed(2));}
  if(part==='forecast')params.set('hours',String(HORIZON_HOURS));
  const timeout=setTimeout(()=>controller.abort('timeout'),part==='current'?8000:18000);
  try{
    const response=await fetch(`/api/weather?${params}`,{signal:controller.signal});
    const data=await response.json();
    if(!data.fetchedAt)throw new Error(data.error||'Vejrdata kunne ikke hentes.');
    return{...data,scope,part,warnings:Array.isArray(data.warnings)?data.warnings:[]};
  }finally{clearTimeout(timeout);}
}
async function currentRequest(scope,target,location){
  const generation=++target.currentGeneration;target.controllers.current?.abort();
  const controller=new AbortController();target.controllers.current=controller;target.currentPending=true;display();
  try{
    const data=await request(scope,'current',location,controller);
    if(target.currentGeneration!==generation||scope==='local'&&state.local!==target)return;
    merge(target,data,'current');
    if(scope==='local'&&!useful(data))notice('Lokale målinger kunne ikke hentes. Danmarksoverblikket vises stadig.');
    else notice();
  }catch(error){
    if(target.currentGeneration!==generation||scope==='local'&&state.local!==target)return;
    target.currentWarnings=[controller.signal.aborted?'Målingerne kunne ikke hentes inden for tidsgrænsen.':error.message];
    if(scope==='local')notice('Lokale målinger kunne ikke hentes. Danmarksoverblikket vises stadig.');
    else if(!useful(target.data))notice('Danmarksoverblikket kunne ikke hentes lige nu. Vælg en by, eller prøv at opdatere.');
  }finally{
    if(target.currentGeneration===generation){target.currentPending=false;display();}
  }
}
async function forecastRequest(scope,target,location){
  const generation=++target.forecastGeneration;target.controllers.forecast?.abort();
  const controller=new AbortController();target.controllers.forecast=controller;target.forecastPending=true;
  if(target.data)target.data.forecast=null;
  display();
  try{
    const data=await request(scope,'forecast',location,controller);
    if(target.forecastGeneration!==generation||scope==='local'&&state.local!==target)return;
    merge(target,data,'forecast');
  }catch(error){
    if(target.forecastGeneration!==generation||scope==='local'&&state.local!==target)return;
    target.forecastWarnings=['Prognosen kunne ikke hentes. De aktuelle målinger vises stadig.'];
    if(target.data){target.data.forecast=null;target.data.warnings=[...target.currentWarnings,...target.forecastWarnings];}
  }finally{
    if(target.forecastGeneration===generation){target.forecastPending=false;display();}
  }
}
async function countryStart(){await currentRequest('denmark',state.country);void forecastRequest('denmark',state.country);}
async function chooseLocal(location){
  state.geoRequest++;state.local?.controllers.current?.abort();state.local?.controllers.forecast?.abort();
  state.target=location;const target=slot();state.local=target;
  notice(`Henter lokalt vejr for ${location.name}…`);
  await state.countryReady;
  if(state.local!==target)return;
  await currentRequest('local',target,location);
  if(state.local!==target)return;
  void forecastRequest('local',target,location);
}
let selectedLocation='denmark';
function chooseCountry(){
  state.geoRequest++;state.local?.controllers.current?.abort();state.local?.controllers.forecast?.abort();
  state.local=null;state.target=null;selectedLocation='denmark';notice();display();
}
function locate(){
  const previous=selectedLocation;
  if(!navigator.geolocation){$('city').value=previous;notice('Din browser understøtter ikke lokation. Vælg en by i stedet.');return;}
  const generation=++state.geoRequest;notice('Finder din lokation…');
  navigator.geolocation.getCurrentPosition(position=>{
    if(generation!==state.geoRequest)return;
    selectedLocation='geolocation';
    void chooseLocal({name:'Din lokation',lat:Math.round(position.coords.latitude*100)/100,lon:Math.round(position.coords.longitude*100)/100});
  },error=>{
    if(generation!==state.geoRequest)return;
    $('city').value=previous;
    notice(error.code===1?'Adgang til din lokation blev ikke givet. Vælg din by, eller tillad lokation i browseren.':'Din lokation kunne ikke findes. Vælg din by i stedet.');
  },{enableHighAccuracy:false,timeout:12000,maximumAge:300000});
}
$('city').addEventListener('change',()=>{
  const option=$('city').selectedOptions[0];
  if(option.value==='denmark'){chooseCountry();return;}
  if(option.value==='geolocation'){locate();return;}
  selectedLocation=option.value;
  void chooseLocal({name:option.value,lat:Number(option.dataset.lat),lon:Number(option.dataset.lon)});
});
$('info-toggle').addEventListener('click',()=>{const expanded=$('info-toggle').getAttribute('aria-expanded')==='true';$('info-toggle').setAttribute('aria-expanded',String(!expanded));$('weather-info').hidden=expanded;});
async function refresh(){
  if(state.target&&state.local){const target=state.local;await currentRequest('local',target,state.target);if(state.local===target)void forecastRequest('local',target,state.target);}
  else await countryStart();
}
$('refresh').addEventListener('click',()=>void refresh());
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',display);
setInterval(()=>{if(document.visibilityState==='visible'&&!active().currentPending)void refresh();},5*60000);
document.addEventListener('visibilitychange',()=>{const data=active().data;if(document.visibilityState==='visible'&&!active().currentPending&&(!data||Date.now()-Date.parse(data.fetchedAt)>5*60000))void refresh();});
resetStamp(root,{name:'Danmark (overblik)'},true);
state.countryReady=countryStart();
