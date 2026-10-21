import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname.slice(1) || 'index.html';
    const target = resolve(root, relative);
    const extension = extname(target).toLowerCase();
    const publicPath = !relative.includes('/') || relative.startsWith('images/');
    if (!target.startsWith(root + sep) || !publicPath || !contentTypes[extension] || relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type': contentTypes[extension], 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop the other preview server and run npm start again.`
    : `Could not start the local preview (${error.code || 'unknown error'}).`);
  process.exitCode = 1;
});

// Local frontend preview only; this does not implement the backend or SchoolSoft.
server.listen(port, '127.0.0.1', () => console.log(`ShopIT: http://127.0.0.1:${port}/login.html`));
