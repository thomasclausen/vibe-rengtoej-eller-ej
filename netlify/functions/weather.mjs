import { loadWeather, validateCoordinates } from '../../lib/dmi.mjs';
import { midnightAfter } from '../../public/weather-model.mjs';

export default async function weather(request) {
  if (request.method !== 'GET') return Response.json({ error: 'Brug GET.' }, { status: 405, headers: { Allow: 'GET' } });
  try {
    const { lat, lon } = validateCoordinates(new URL(request.url).searchParams);
    const now = new Date();
    const data = await loadWeather(lat, lon, now);
    const ttl = Math.max(0, Math.min(120, Math.floor((midnightAfter(now) - now) / 1000) - 1));
    const usable = data.forecast?.intervals.length || data.observation || data.current?.temperature || data.current?.cloudCover;
    return Response.json(data, { status: usable ? 200 : 503, headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': usable ? `public, s-maxage=${ttl}` : 'no-store',
    } });
  } catch (error) {
    const status = [400, 422].includes(error.status) ? error.status : 503;
    return Response.json({ error: status < 500 ? error.message : 'Vejrdata kunne ikke hentes. Prøv igen om lidt.' },
      { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const config = { path: '/api/weather' };
