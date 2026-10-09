import {midnightAfter} from '../public/weather-model.mjs';

const BASE='https://opendataapi.dmi.dk';
const DENMARK_BBOX='7.5,54.4,15.5,58';
const cache=new Map();
const inFlight=new Map();
let forecastBlockedUntil=0;
const validNumber=value=>typeof value==='number' && Number.isFinite(value);
export const APP_VERSION='1.4.3';
export const REGIONS=[
  {name:'Skagen',lat:57.72,lon:10.58},{name:'Aalborg',lat:57.05,lon:9.92},
  {name:'Thisted',lat:56.96,lon:8.69},{name:'Aarhus',lat:56.16,lon:10.20},
  {name:'Herning',lat:56.14,lon:8.97},{name:'Esbjerg',lat:55.47,lon:8.45},
  {name:'Aabenraa',lat:55.04,lon:9.42},{name:'Odense',lat:55.40,lon:10.40},
  {name:'Roskilde',lat:55.64,lon:12.09},{name:'København',lat:55.68,lon:12.57},
  {name:'Nykøbing Falster',lat:54.77,lon:11.88},{name:'Rønne',lat:55.10,lon:14.71},
];
export class DmiError extends Error {
  constructor(status,message='DMI kunne ikke kontaktes'){super(message);this.status=status;}
}
export function clearDataCache(){cache.clear();inFlight.clear();forecastBlockedUntil=0;}
export function validateCoordinates(params){
  const a=params.get('lat'),o=params.get('lon');
  if(a===null||o===null||!a.trim()||!o.trim())throw new DmiError(400,'Vælg en lokation først.');
  const lat=Number(a),lon=Number(o);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new DmiError(400,'Lokationen er ugyldig.');
  if(lat<54.4||lat>58||lon<7.5||lon>15.5)throw new DmiError(422,'Appen understøtter Danmark. Vælg en dansk by.');
  return{lat:Math.round(lat*100)/100,lon:Math.round(lon*100)/100};
}

async function getJson(path,params,{ttl=120000,timeout=4500,context,name=path,shape}={}){
  const url=new URL(path,BASE);url.search=new URLSearchParams(params);
  const key=url.href,start=performance.now();
  let status=200,cacheState='miss';
  try{
    const hit=cache.get(key);
    if(hit&&hit.expires>Date.now()){
      cacheState='hit';if(hit.error)throw hit.error;return hit.value;
    }
    if(inFlight.has(key)){cacheState='shared';return await inFlight.get(key);}
    const task=(async()=>{
      try{
        const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.floor(timeout)))});
        if(!response.ok)throw new DmiError(response.status===429?429:503);
        const value=await response.json();
        if(!value || (shape&&!shape(value)))throw new DmiError(503,'DMI svarede med et ukendt dataformat.');
        for(const [k,v] of cache)if(v.expires<=Date.now())cache.delete(k);
        if(cache.size>=128)cache.delete(cache.keys().next().value);
        cache.set(key,{value,expires:Date.now()+ttl});return value;
      }catch(error){
        const failure=error instanceof DmiError?error:new DmiError(503);
        // No immediate retry of a busy service; share a short failure cache.
        for(const [k,v] of cache)if(v.expires<=Date.now())cache.delete(k);
        if(cache.size>=128)cache.delete(cache.keys().next().value);
        cache.set(key,{error:failure,expires:Date.now()+(failure.status===429?30000:5000)});
        throw failure;
      }
    })();
    inFlight.set(key,task);
    try{return await task;}finally{inFlight.delete(key);}
  }catch(error){status=error.status||503;throw error;}
  finally{context?.sources.push({name,status,cache:cacheState,ms:Math.round(performance.now()-start)});}
}

export function distanceKm(lat, lon, otherLat, otherLon) {
  const r = value => value * Math.PI / 180;
  const a = Math.sin(r(otherLat - lat) / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(otherLat)) * Math.sin(r(otherLon - lon) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseForecast(collection, now = new Date(), options = {}) {
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
      precipitationMm: mm === null ? null : Number(mm.toPrecision(12)),
      temperatureC: validNumber(current.p['temperature-2m']) ? current.p['temperature-2m'] - 273.15 : null,
      windMs: validNumber(current.p['wind-speed-10m']) ? current.p['wind-speed-10m'] : null,
      cloudCover: validNumber(current.p['fraction-of-cloud-cover']) ? current.p['fraction-of-cloud-cover'] : null,
    });
  }
  // This is the first step in the returned run, not necessarily the model's initialization time.
  const latestTime = points.at(-1)?.time ?? null;
  const firstTime = points[0]?.time ?? null;
  const runAge = now.getTime() - Date.parse(options.modelRunStartedAt || firstTime);
  const end = (options.endsAt ? Date.parse(options.endsAt) : midnightAfter(now).getTime());
  return { model: 'DMI HARMONIE DINI', gridPoint: points[0]?.coordinate ?? null,
    firstStep: firstTime, modelRunStartedAt: options.modelRunStartedAt || firstTime,
    fresh: Boolean(latestTime && Date.parse(latestTime) >= now.getTime() && runAge >= -3600000 && runAge <= 12 * 3600000),
    intervals: intervals.filter(h => Date.parse(h.end) > now.getTime() && Date.parse(h.start) < end) };
}

export function selectMeasurement(collection, stations, lat, lon, parameterId, now = new Date(), maxDistanceKm = 25) {
  const latest = new Map();
  for (const f of collection.features) {
    const p = f.properties ?? {}, c = f.geometry?.coordinates;
    const age = now.getTime() - Date.parse(p.observed);
    const plausible = parameterId === 'temp_dry' ? p.value >= -70 && p.value <= 60
      : parameterId === 'cloud_cover' ? (p.value >= 0 && p.value <= 100) || p.value === 112 : p.value >= 0;
    if (p.parameterId !== parameterId || !validNumber(p.value) || !plausible || !Number.isFinite(age) || age < -60000 || age > 30 * 60000 || !c || !c.every(validNumber)) continue;
    const distance = distanceKm(lat, lon, c[1], c[0]);
    if (distance > maxDistanceKm) continue;
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
  return { ...result, stationName: station?.properties.name ?? `Station ${result.stationId}`, regional: result.distanceKm > 25 };
}

export function selectObservation(collection, stations, lat, lon, now = new Date()) {
  const measurement = selectMeasurement(collection, stations, lat, lon, 'precip_past10min', now);
  if (!measurement) return null;
  const { value, ...station } = measurement;
  return { ...station, precipitationMm: value, periodMinutes: 10 };
}


const collection=value=>Array.isArray(value.features);
const newest=rows=>rows.reduce((latest,row)=>!latest||Date.parse(row.observedAt)>Date.parse(latest.observedAt)?row:latest,null);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const n=sorted.length;return n?n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2:null;};

export function latestMeasurements(collection,stations,parameterId,now=new Date()){
  const names=new Map((stations?.features||[]).filter(f=>(!f.properties?.validTo||Date.parse(f.properties.validTo)>now.getTime())&&(!f.properties?.validFrom||Date.parse(f.properties.validFrom)<=now.getTime())).map(f=>[f.properties.stationId,f.properties]));
  const latest=new Map();
  for(const f of collection.features||[]){
    const p=f?.properties,c=f?.geometry?.coordinates;if(!p||!c||c.length<2)continue;
    const station=names.get(p.stationId);
    if(station?.country&&station.country!=='DNK')continue;
    const age=now.getTime()-Date.parse(p.observed);
    const plausible=parameterId==='temp_dry'?p.value>=-70&&p.value<=60:parameterId==='cloud_cover'?(p.value>=0&&p.value<=100)||p.value===112:p.value>=0;
    if(p.parameterId!==parameterId||!validNumber(p.value)||!plausible||!Number.isFinite(age)||age< -60000||age>30*60000||!c.every(validNumber))continue;
    const row={value:p.value,observedAt:p.observed,stationId:p.stationId,stationName:station?.name||`Station ${p.stationId}`,coordinates:c};
    if(!latest.has(p.stationId)||Date.parse(row.observedAt)>Date.parse(latest.get(p.stationId).observedAt))latest.set(p.stationId,row);
  }
  return [...latest.values()];
}

async function observationBundle(now,context){
  const path='/v2/metObs/collections/observation/items';
  const common={bbox:DENMARK_BBOX,period:'latest-hour',limit:'5000'};
  const day=now.toISOString().slice(0,10)+'T00:00:00Z/..';
  const results=await Promise.allSettled([
    getJson(path,{...common,parameterId:'temp_dry'},{context,name:'temperature',shape:collection}),
    getJson(path,{...common,parameterId:'cloud_cover'},{context,name:'cloud',shape:collection}),
    getJson(path,{...common,parameterId:'precip_past10min'},{context,name:'rain',shape:collection}),
    getJson('/v2/metObs/collections/station/items',{bbox:DENMARK_BBOX,status:'Active',datetime:day,limit:'5000'},{ttl:3600000,context,name:'stations',shape:collection}),
  ]);
  const value=i=>results[i].status==='fulfilled'?results[i].value:null;
  return{temperature:value(0),cloud:value(1),rain:value(2),stations:value(3)};
}

export function nationalCurrent(bundle,now=new Date()){
  const readings=(key,param)=>latestMeasurements(bundle[key]||{features:[]},bundle.stations,param,now);
  const temperatures=readings('temperature','temp_dry'),clouds=readings('cloud','cloud_cover'),rain=readings('rain','precip_past10min');
  const wet=rain.filter(r=>r.value>0);
  const values=temperatures.map(r=>r.value);
  const recentTemp=newest(temperatures);
  const temperature=recentTemp?{value:median(values),range:{min:Math.min(...values),max:Math.max(...values)},observedAt:recentTemp.observedAt,stationName:`${temperatures.length} danske DMI-stationer`,stationCount:temperatures.length}:null;
  let kind='unknown',label='Vejr ukendt';
  if(wet.length){kind='rain';label='Regn nogle steder';}
  else if(clouds.length&&clouds.every(r=>r.value<=25)){kind='sun';label='Sol flere steder';}
  else if(clouds.length&&clouds.every(r=>r.value>=75&&r.value<=100)){kind='cloud';label='Overskyet';}
  else if(clouds.length){kind='partly-cloudy';label='Skiftende vejr';}
  const recentWeather=newest(wet.length?wet:[...clouds,...rain]);
  const summary=recentWeather?{kind,label,observedAt:recentWeather.observedAt,stationName:`${clouds.length} skydækkemålinger og ${rain.length} nedbørsmålinger`,rainStationCount:wet.length}:null;
  const measured=newest(wet.length?wet:rain);
  const observation=measured?{...measured,precipitationMm:measured.value,periodMinutes:10}:null;
  return{current:{temperature,cloudCover:null,summary},observation};
}

export async function loadCurrent(lat,lon,{scope='local',now=new Date(),context}={}){
  const bundle=await observationBundle(now,context);
  let readings;
  if(scope==='denmark')readings=nationalCurrent(bundle,now);
  else{
    const select=(data,param)=>data?selectMeasurement(data,bundle.stations,lat,lon,param,now,param==='temp_dry'?50:75):null;
    readings={current:{temperature:select(bundle.temperature,'temp_dry'),cloudCover:select(bundle.cloud,'cloud_cover')},observation:bundle.rain?selectObservation(bundle.rain,bundle.stations,lat,lon,now):null};
  }
  const warnings=[];
  if(!readings.current.temperature)warnings.push('Ingen frisk temperaturmåling tilgængelig.');
  if(!readings.observation)warnings.push(scope==='local'?'Ingen frisk nedbørsmåling inden for 25 km.':'Ingen frisk nedbørsmåling tilgængelig i Danmarksoverblikket.');
  if(scope==='local'&&!readings.current.cloudCover)warnings.push('Ingen frisk skydækkemåling inden for 75 km. Nedbørsmålingen kan stadig bruges.');
  if(!bundle.stations)warnings.push('Stationsnavne kunne ikke hentes.');
  if([bundle.temperature,bundle.cloud,bundle.rain].some(c=>c?.features.length>=5000))warnings.push('Måledatasættet kan være afkortet.');
  return{...readings,warnings};
}

const runTime=id=>{const match=id.match(/^(\d{4}-\d{2}-\d{2}T)(\d{2})(\d{2})(\d{2})Z$/);return match?`${match[1]}${match[2]}:${match[3]}:${match[4]}Z`:null;};
async function latestModel(now,context){
  const metadata=await getJson('/v1/forecastedr/collections/harmonie_dini_sf/instances',{}, {ttl:600000,timeout:3500,context,name:'model',shape:j=>Array.isArray(j.instances)});
  const runs=metadata.instances.map(run=>({...run,startedAt:runTime(run.id)})).filter(run=>run.startedAt&&Date.parse(run.startedAt)<=now.getTime());
  runs.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
  if(!runs.length)throw new DmiError(503,'Ingen aktuel modelkørsel tilgængelig.');
  return runs[0];
}

export function coverageToGeoJSON(value,lon,lat){
  if(Array.isArray(value.features))return value;
  const coverage=value.type==='CoverageCollection'?value.coverages?.[0]:value;
  const times=coverage?.domain?.axes?.t?.values,ranges=coverage?.ranges;
  if(!Array.isArray(times)||!ranges||!ranges['total-precipitation'])throw new DmiError(503,'Ukendt prognoseformat.');
  for(const range of Object.values(ranges)){
    if(!Array.isArray(range.values)||range.values.length!==times.length)throw new DmiError(503,'Prognosen indeholder ikke ét modelpunkt.');
  }
  const x=coverage.domain.axes.x?.values?.[0],y=coverage.domain.axes.y?.values?.[0];
  return{features:times.map((step,index)=>({geometry:{coordinates:[validNumber(x)?x:lon,validNumber(y)?y:lat]},properties:{step,...Object.fromEntries(Object.entries(ranges).map(([name,range])=>[name,range.values[index]]))}}))};
}

async function pointForecast(lat,lon,model,now,context,deadline,hours){
  if(Date.now()<forecastBlockedUntil)throw new DmiError(429);
  const remaining=deadline-Date.now();if(remaining<=0)throw new DmiError(503,'Prognosens tidsgrænse er nået.');
  const baseline=new Date(Math.floor(now.getTime()/3600000)*3600000);
  const endsAt=hours?new Date(now.getTime()+hours*3600000):midnightAfter(now);
  const queryEnd=new Date(Math.ceil(endsAt.getTime()/3600000)*3600000);
  // Keep short-window cache responses usable until their five-minute cache expires.
  if(hours && queryEnd.getTime()-endsAt.getTime()<300000)queryEnd.setTime(queryEnd.getTime()+3600000);
  try{
    const value=await getJson(`/v1/forecastedr/collections/harmonie_dini_sf/instances/${model.id}/position`,{
      coords:`POINT(${lon} ${lat})`,crs:'crs84',f:'CoverageJSON',
      'parameter-name':'total-precipitation,temperature-2m,fraction-of-cloud-cover',
      datetime:`${baseline.toISOString()}/${queryEnd.toISOString()}`,
    },{ttl:300000,timeout:Math.min(6500,remaining),context,name:`forecast:${lat},${lon}`});
    return parseForecast(coverageToGeoJSON(value,lon,lat),now,{modelRunStartedAt:model.startedAt,endsAt:queryEnd.toISOString()});
  }catch(error){
    if([429,503].includes(error.status))forecastBlockedUntil=Date.now()+30000;
    throw error;
  }
}

export function combineRegionalForecasts(results,requestedCount=REGIONS.length){
  const successful=results.filter(r=>r.forecast);
  if(!successful.length)return null;
  const byTime=new Map();
  for(const region of successful)for(const h of region.forecast.intervals){const key=h.start+'|'+h.end;if(!byTime.has(key))byTime.set(key,[]);byTime.get(key).push(h);}
  const intervals=[...byTime.values()].map(rows=>{
    const mm=rows.map(h=>h.precipitationMm).filter(validNumber);
    const temperatures=rows.map(h=>h.temperatureC).filter(validNumber);
    const clouds=rows.map(h=>h.cloudCover).filter(validNumber);
    const wet=mm.some(value=>value>0);
    const weatherKind=wet?'rain':!clouds.length?'unknown':clouds.every(c=>c<=0.25)?'sun':clouds.every(c=>c>=0.75)?'cloud':'partly-cloudy';
    return{start:rows[0].start,end:rows[0].end,precipitationMm:wet?Math.max(...mm):mm.length===requestedCount?0:null,
      temperatureC:median(temperatures),temperatureRange:temperatures.length?{min:Math.min(...temperatures),max:Math.max(...temperatures)}:null,
      cloudCover:clouds.length?clouds.reduce((a,b)=>a+b,0)/clouds.length:null,weatherKind,
      weatherLabel:{rain:'Regn nogle steder',sun:'Sol flere steder',cloud:'Overskyet','partly-cloudy':'Skiftende vejr',unknown:'Vejr ukendt'}[weatherKind]};
  }).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  return{model:'DMI HARMONIE DINI · regionalt Danmarksoverblik',fresh:successful.some(r=>r.forecast.fresh),
    coverageComplete:successful.length===requestedCount&&successful.every(r=>r.forecast.fresh),
    intervals,regions:successful.map(r=>r.name),requestedRegionCount:requestedCount};
}

export async function loadForecast(lat,lon,{scope='local',now=new Date(),context,hours=6}={}){
  const warnings=[];let forecast=null;
  try{
    if(Date.now()<forecastBlockedUntil)throw new DmiError(429);
    const deadline=Date.now()+14000;
    const model=await latestModel(now,context);
    if(scope==='local')forecast=await pointForecast(lat,lon,model,now,context,deadline,hours);
    else{
      const results=new Array(REGIONS.length);let index=0;
      async function worker(){
        while(index<REGIONS.length){const i=index++;const region=REGIONS[i];
          try{results[i]={name:region.name,forecast:await pointForecast(region.lat,region.lon,model,now,context,deadline,hours)};}
          catch(error){results[i]={name:region.name,error};}
        }
      }
      await Promise.all([worker(),worker()]);
      forecast=combineRegionalForecasts(results);
      if(!forecast&&results.some(r=>r.error?.status===429))throw new DmiError(429);
      if(forecast&&!forecast.coverageComplete)warnings.push(`Prognoser for ${forecast.regions.length} af ${REGIONS.length} regionpunkter er tilgængelige.`);
      warnings.push('Danmarksoverblikket bruger 12 repræsentative modelpunkter. Lokale byger mellem punkterne kan forekomme.');
    }
    if(!forecast)throw new DmiError(503);
    if(!forecast.fresh)warnings.push('Den tilgængelige modelkørsel er for gammel til en sikker anbefaling.');
  }catch(error){warnings.push(error.status===429?'DMI’s prognosetjeneste er optaget. De aktuelle målinger vises stadig.':'Prognosen kunne ikke hentes inden for tidsgrænsen. De aktuelle målinger vises stadig.');}
  return{forecast,warnings};
}

export async function loadWeather(lat,lon,now=new Date(),{scope='local',part='all',hours=6}={}){
  const started=performance.now(),context={sources:[]};
  let current={},predicted={};
  if(part==='current')current=await loadCurrent(lat,lon,{scope,now,context});
  else if(part==='forecast')predicted=await loadForecast(lat,lon,{scope,now,context,hours});
  else[current,predicted]=await Promise.all([loadCurrent(lat,lon,{scope,now,context}),loadForecast(lat,lon,{scope,now,context,hours})]);
  return{version:APP_VERSION,scope,part,fetchedAt:now.toISOString(),location:scope==='denmark'?{name:'Danmark (overblik)'}:{lat,lon},
    ...current,...predicted,period:{hours,startsAt:now.toISOString(),endsAt:(hours?new Date(now.getTime()+hours*3600000):midnightAfter(now)).toISOString()},warnings:[...(current.warnings||[]),...(predicted.warnings||[])],
    timings:{totalMs:Math.round(performance.now()-started),sources:context.sources}};
}
