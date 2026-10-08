import test from 'node:test';
import assert from 'node:assert/strict';
import { midnightAfter, evaluateWeather, currentWeather } from '../public/weather-model.mjs';
import { parseForecast, selectObservation, selectMeasurement, validateCoordinates } from '../lib/dmi.mjs';
import handler from '../netlify/functions/weather.mjs';

const now = new Date('2026-10-08T07:30:00Z');
const point = (time,mm,temp=283.15) => ({geometry:{coordinates:[12.57,55.68]},properties:{step:time,'total-precipitation':mm,'temperature-2m':temp,'wind-speed-10m':5,'fraction-of-cloud-cover':0.4}});
function day(mm=0) {
  const points = [];
  for (let i=7;i<=22;i++) points.push(point(`2026-10-08T${String(i).padStart(2,'0')}:00:00Z`, 4+(i-7)*mm));
  return {fetchedAt:now.toISOString(),warnings:[],observation:null,forecast:parseForecast({features:points},now)};
}

test('Danish midnight follows summer time, winter time and both DST changes', () => {
  for (const [input, expected] of [
    ['2026-10-08T07:30:00Z','2026-10-08T22:00:00.000Z'],
    ['2026-12-08T07:30:00Z','2026-12-08T23:00:00.000Z'],
    ['2026-03-29T00:30:00Z','2026-03-29T22:00:00.000Z'],
    ['2026-10-25T00:30:00Z','2026-10-25T23:00:00.000Z'],
    ['2026-12-31T23:30:00Z','2027-01-01T23:00:00.000Z'],
  ]) assert.equal(midnightAfter(new Date(input)).toISOString(),expected);
});

test('Accumulated precipitation is differenced; rain that already fell is excluded', () => {
  const data=day();
  assert.equal(data.forecast.intervals[0].precipitationMm,0);
  assert.ok(Math.abs(data.forecast.intervals[0].temperatureC-10)<1e-9);
  assert.equal(evaluateWeather(data,null,now).verdict,'dry');
  assert.equal(evaluateWeather(data,null,now).totalMm,0);
});

test('Forecast rain is recommended even when the nearest station is dry', () => {
  const data=day(0.25);
  data.observation={observedAt:'2026-10-08T07:20:00Z',precipitationMm:0};
  assert.equal(evaluateWeather(data,null,now).verdict,'rain');
});

test('Several small showers can reach the total threshold', () => {
  const result=evaluateWeather(day(0.05),null,now);
  assert.equal(result.maxMm,0.05);
  assert.equal(result.verdict,'rain');
});

test('A fresh wet observation recommends rain gear even without a forecast', () => {
  assert.equal(evaluateWeather({observation:{observedAt:'2026-10-08T07:20:00Z',precipitationMm:0.1}},null,now).verdict,'rain');
});

test('Missing forecasts, gaps, null values and stale observations never imply dry weather', () => {
  assert.equal(evaluateWeather({},null,now).verdict,'unknown');
  assert.equal(evaluateWeather({observation:{observedAt:'2026-10-08T06:50:00Z',precipitationMm:1}},null,now).verdict,'unknown');
  for(const damage of [
    d=>d.forecast.intervals.pop(), d=>d.forecast.intervals.splice(2,1),
    d=>d.forecast.intervals[2].precipitationMm=null, d=>d.forecast.fresh=false,
  ]) {const d=day();damage(d);assert.equal(evaluateWeather(d,null,now).verdict,'unknown');}
});

test('An old wet forecast is not treated as a current rain forecast', () => {
  const data=day(0.4);data.forecast.fresh=false;
  assert.equal(evaluateWeather(data,null,now).verdict,'unknown');
});

test('A short period can be dry even though rain is expected later today', () => {
  const data=day(); data.forecast.intervals.at(-1).precipitationMm=2;
  assert.equal(evaluateWeather(data,2,now).verdict,'dry');
  assert.equal(evaluateWeather(data,null,now).verdict,'rain');
});

test('Nulls, resets and non-hourly forecast steps are unknown instead of zero', () => {
  for(const points of [
    [point('2026-10-08T07:00:00Z',1),point('2026-10-08T08:00:00Z',null)],
    [point('2026-10-08T07:00:00Z',1),point('2026-10-08T08:00:00Z',0)],
    [point('2026-10-08T07:00:00Z',1),point('2026-10-08T09:00:00Z',2)],
  ]) assert.equal(parseForecast({features:points},now).intervals[0].precipitationMm,null);
});

test('Station selection uses nearest fresh station and its latest observation', () => {
  const obs=(id,lon,observed,value)=>({geometry:{coordinates:[lon,55.68]},properties:{stationId:id,parameterId:'precip_past10min',observed,value}});
  const features=[obs('close',12.57,'2026-10-08T07:10:00Z',1),obs('close',12.57,'2026-10-08T07:20:00Z',0),obs('far',12.7,'2026-10-08T07:20:00Z',2),obs('old',12.568,'2026-10-08T06:40:00Z',2)];
  const result=selectObservation({features},null,55.68,12.568,now);
  assert.equal(result.stationId,'close'); assert.equal(result.precipitationMm,0);
  assert.equal(selectObservation({features:[obs('too-far',13.57,'2026-10-08T07:20:00Z',1)]},null,55.68,12.568,now),null);
});

test('Current temperature accepts zero and sub-zero Celsius measurements', () => {
  for (const value of [0,-4.5,13.3]) {
    const data=day();data.current={temperature:{value,observedAt:'2026-10-08T07:20:00Z'}};
    assert.equal(currentWeather(data,now).temperature.value,value);
    assert.equal(currentWeather(data,now).temperature.source,'observation');
    const collection={features:[{geometry:{coordinates:[12.57,55.68]},properties:{stationId:'temp',parameterId:'temp_dry',observed:'2026-10-08T07:20:00Z',value}}]};
    assert.equal(selectMeasurement(collection,null,55.68,12.57,'temp_dry',now).value,value);
  }
});

test('Current weather prioritizes observed rain and handles measured cloud cover', () => {
  const reading=value=>({value,observedAt:'2026-10-08T07:20:00Z'});
  const data={current:{cloudCover:reading(0)}};
  assert.equal(currentWeather(data,now).label,'Sol');
  data.current.cloudCover=reading(100);
  assert.equal(currentWeather(data,now).label,'Overskyet');
  data.current.cloudCover=reading(50);
  assert.equal(currentWeather(data,now).label,'Let skyet');
  data.current.cloudCover=reading(112);
  assert.equal(currentWeather(data,now).label,'Vejr ukendt');
  data.observation={observedAt:'2026-10-08T07:20:00Z',precipitationMm:0.05};
  assert.equal(currentWeather(data,now).label,'Regnvejr');
});

test('Rain later today does not become current rain on the stamp', () => {
  const data=day();data.forecast.intervals.at(-1).precipitationMm=2;
  data.current={cloudCover:{value:0,observedAt:'2026-10-08T07:20:00Z'}};
  assert.equal(evaluateWeather(data,null,now).verdict,'rain');
  assert.equal(currentWeather(data,now).kind,'sun');
});

test('Stale current readings are ignored; forecast fallback is explicitly identified', () => {
  const data=day();data.current={temperature:{value:25,observedAt:'2026-10-08T06:50:00Z'},cloudCover:{value:0,observedAt:'2026-10-08T06:50:00Z'}};
  const result=currentWeather(data,now);
  assert.ok(Math.abs(result.temperature.value-10)<1e-9);
  assert.equal(result.temperature.source,'forecast');assert.equal(result.source,'forecast');
  data.forecast=null;
  assert.equal(currentWeather(data,now).temperature,null);
  assert.equal(currentWeather(data,now).kind,'unknown');
});

test('Current readings remain usable when forecast and rain observations are unavailable', async () => {
  const original=globalThis.fetch;
  const observedAt=new Date(Date.now()-5*60000).toISOString();
  globalThis.fetch=async url=>{
    if(url.pathname.includes('forecastedr'))return Response.json({}, {status:429});
    if(url.pathname.includes('/observation/')){
      const parameterId=url.searchParams.get('parameterId');
      return Response.json({features:parameterId==='temp_dry'?[{geometry:{coordinates:[10.20,56.16]},properties:{stationId:'aarhus',parameterId,observed:observedAt,value:12.4}}]:[]});
    }
    return Response.json({features:[]});
  };
  try {
    const response=await handler(new Request('http://localhost/api/weather?lat=56.16&lon=10.20'));
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(currentWeather(data).temperature.value,12.4);
    assert.equal(evaluateWeather(data).verdict,'unknown');
  } finally {globalThis.fetch=original;}
});

test('Coordinates are required, checked and rounded', () => {
  for(const query of ['', 'lat=&lon=', 'lat=wat&lon=12','lat=1&lon=2']) assert.throws(()=>validateCoordinates(new URLSearchParams(query)));
  assert.deepEqual(validateCoordinates(new URLSearchParams('lat=55.6761&lon=12.5683')),{lat:55.68,lon:12.57});
});

test('API rejects invalid requests before contacting DMI', async () => {
  assert.equal((await handler(new Request('http://localhost/api/weather'))).status,400);
  assert.equal((await handler(new Request('http://localhost/api/weather?lat=1&lon=2'))).status,422);
  assert.equal((await handler(new Request('http://localhost/api/weather',{method:'POST'}))).status,405);
});

test('API integrates forecast and station responses and survives forecast overload', async () => {
  const original=globalThis.fetch;
  const liveNow=new Date();
  const first=new Date(Math.floor(liveNow.getTime()/3600000)*3600000);
  const features=Array.from({length:30},(_,i)=>point(new Date(first.getTime()+i*3600000).toISOString(),i*0.25));
  const observation={features:[{geometry:{coordinates:[12.57,55.68]},properties:{stationId:'test-station',parameterId:'precip_past10min',observed:new Date(liveNow.getTime()-5*60000).toISOString(),value:0}}]};
  let overloaded=false;let retries=0;
  globalThis.fetch=async url=>{
    if(url.pathname.includes('forecastedr')) {
      if(overloaded) {retries++;return Response.json({error:'Busy'},{status:429});}
      return Response.json({features});
    }
    if(url.pathname.includes('/observation/')) return Response.json(observation);
    return Response.json({features:[{properties:{stationId:'test-station',name:'Test station',validFrom:'2020-01-01T00:00:00Z',validTo:null}}]});
  };
  try {
    const result=await handler(new Request('http://localhost/api/weather?lat=55.68&lon=12.57'));
    assert.equal(result.status,200);
    const data=await result.json();
    assert.equal(data.observation.stationName,'Test station');
    assert.equal(evaluateWeather(data,null,liveNow).verdict,'rain');
    assert.match(result.headers.get('Netlify-CDN-Cache-Control'),/s-maxage=/);
    overloaded=true;
    const partial=await handler(new Request('http://localhost/api/weather?lat=55.69&lon=12.58'));
    assert.equal(partial.status,200);
    const missing=await partial.json();
    assert.equal(missing.forecast,null);assert.ok(missing.observation);
    assert.equal(evaluateWeather(missing,null,liveNow).verdict,'unknown');
    assert.equal(retries,2);assert.match(missing.warnings[0],/optaget/);
  } finally {globalThis.fetch=original;}
});
