import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateMaze } from './public/maze.js';
import { getDecision } from './typesafe.js';

const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
  '/maze.js': ['maze.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };

export function makeServer({ apiKey = process.env.TYPESAFE_API_KEY, fetcher = fetch } = {}) {
  let busy = false;
  return createServer(async (req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/status') return json(200, { configured: Boolean(apiKey) });
    if (req.method === 'POST' && url.pathname === '/api/step') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin requests are not allowed.' });
      if (!apiKey) return json(503, { error: 'Add TYPESAFE_API_KEY to .env, then restart the server. You can still use the BFS preview.' });
      if (busy) return json(429, { error: 'A solve is already running. Please wait.' });
      busy = true;
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 12000) { json(413, { error: 'Maze request is too large.' }); return; }
        }
        let maze, history;
        try {
          ({ maze, history } = JSON.parse(body)); validateMaze(maze);
          if (!Array.isArray(history) || history.length < 1 || history.length > 80 || history[0] !== 0 ||
              history.some((cell, i) => !Number.isInteger(cell) || cell < 0 || cell > 24 ||
                (i > 0 && !maze[history[i - 1]].includes(cell))) || history.includes(24)) throw new Error('Invalid history');
        }
        catch { return json(400, { error: 'Send a valid, solvable 5×5 maze.' }); }
        return json(200, await getDecision(maze, history, apiKey, fetcher));
      } catch (error) {
        return json(502, { error: error.name === 'TimeoutError' ? 'TypeSafe timed out. Please try again.'
          : error.message.startsWith('TypeSafe') ? error.message : 'Could not reach TypeSafe. Check your connection and try again.' });
      } finally { busy = false; }
    }
    const asset = assets[url.pathname];
    if (req.method !== 'GET' || !asset) return json(404, { error: 'Not found.' });
    try {
      const content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
      res.end(content);
    } catch { json(500, { error: 'Could not load app.' }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  makeServer().listen(port, '127.0.0.1', () => console.log(`Maze app: http://localhost:${port}`));
}
