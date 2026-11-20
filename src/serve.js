// Serves the national map from out/map/, or a map built with `npm run map -- --out <folder>` from out/<folder>/:
// npm run serve [-- [<folder>] [<port>]]
// The page reads exposure.pmtiles a piece at a time over HTTP range requests, which a page opened from disk cannot do.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { pipeline } from 'node:stream';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.pmtiles': 'application/vnd.pmtiles',
};
const args = process.argv.slice(2);
const folder = args.find(a => !/^\d+$/.test(a)) ?? 'map';
const port = Number(args.find(a => /^\d+$/.test(a)) ?? 8080);
if (!/^[\w-]+$/.test(folder)) {
  console.error('Usage: npm run serve -- [<folder>] [<port>]');
  process.exit(1);
}
const root = fileURLToPath(new URL(`../out/${folder}/`, import.meta.url));

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
  let size;
  try {
    const stat = statSync(file);
    if (!file.startsWith(root) || !stat.isFile()) throw new Error('not a file');
    size = stat.size;
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const send = (status, extra, range) => {
    res.writeHead(status, { ...headers, ...extra });
    if (req.method === 'HEAD') res.end();
    // pipeline closes the file when the browser drops a request, so a map rebuild can replace it while it is served.
    else pipeline(createReadStream(file, range), res, () => {});
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!range || (!range[1] && !range[2])) {
    send(200, { 'Content-Length': size });
    return;
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  send(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }, { start, end });
}).listen(port, '127.0.0.1', () => console.log(`Serving out/${folder}/ at http://localhost:${port}/ (Ctrl+C to stop).`));
