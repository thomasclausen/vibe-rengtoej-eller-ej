import { loadWeather, validateCoordinates, DmiError, APP_VERSION } from '../../lib/dmi.mjs';
import { midnightAfter } from '../../public/weather-model.mjs';

export default async function weather(request) {
  if (request.method !== 'GET') return Response.json({ error: 'Brug GET.' }, { status: 405, headers: { Allow: 'GET' } });
  try {
    const params = new URL(request.url).searchParams;
    const scope = params.get('scope') || 'local';
    const part = params.get('part') || 'all';
    const period = params.get('hours');
    const hours = period === null ? 6 : Number(period);
    if (hours !== 6) throw new DmiError(400,'Regntøjsvurderingen gælder altid de næste 6 timer.');
    if (!['local','denmark'].includes(scope) || !['all','current','forecast'].includes(part)) throw new DmiError(400,'Ukendt område eller datatype.');
    const { lat, lon } = scope === 'local' ? validateCoordinates(params) : {};
    const now = new Date();
    const data = await loadWeather(lat, lon, now, {scope,part,hours});
    const ttl = Math.max(0, Math.min(120, Math.floor((midnightAfter(now) - now) / 1000) - 1));
    const usable = data.forecast?.intervals.length || data.observation || data.current?.temperature || data.current?.cloudCover || data.current?.summary;
    return Response.json(data, { status: usable ? 200 : 503, headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': usable ? `public, s-maxage=${ttl}` : 'no-store',
      'Server-Timing': `weather;dur=${data.timings.totalMs}`,
      'X-App-Version': APP_VERSION,
    } });
  } catch (error) {
    const status = [400, 422].includes(error.status) ? error.status : 503;
    return Response.json({ error: status < 500 ? error.message : 'Vejrdata kunne ikke hentes. Prøv igen om lidt.' },
      { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const config = { path: '/api/weather' };
