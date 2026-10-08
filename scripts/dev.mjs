import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import weather from '../netlify/functions/weather.mjs';

const root = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const port = Number(process.env.PORT || 8888);
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/api/weather') {
      const result = await weather(new Request(url, {method:req.method}));
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const content = await readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'}); res.end(content);
  } catch { res.writeHead(404); res.end('Ikke fundet'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Regntøj eller ej? → http://localhost:${port}`));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
