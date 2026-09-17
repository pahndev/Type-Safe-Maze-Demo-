import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, validateMaze, solveMaze } from '../public/maze.js';
import { buildRequest, getDecision } from '../typesafe.js';
import { makeServer } from '../server.js';

const mock = async (url, options) => {
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(options.body);
  const choices = Object.keys(body.questions.move.criteria);
  return Response.json({ model: 'jev-latest', answers: { move: { type: 'choice', choice: choices[0], confidence: 0.8,
    probabilities: Object.fromEntries(choices.map((key, i) => [key, i === 0 ? 1 : 0])) } } });
};

test('500 seeded mazes are connected and BFS returns legal shortest routes', () => {
  let seed = 42;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  for (let trial = 0; trial < 500; trial++) {
    const maze = generateMaze(random); validateMaze(maze);
    const dist = Array(25).fill(Infinity); dist[0] = 0;
    // Independent repeated relaxation checks BFS distance, including cyclic mazes.
    for (let pass = 0; pass < 25; pass++) for (let a = 0; a < 25; a++) for (const b of maze[a]) dist[b] = Math.min(dist[b], dist[a] + 1);
    assert.ok(dist.every(Number.isFinite));
    const { path } = solveMaze(maze);
    assert.equal(path.length - 1, dist[24]);
    assert.equal(path[0], 0); assert.equal(path.at(-1), 24);
    path.slice(1).forEach((cell, i) => assert.ok(maze[path[i]].includes(cell)));
  }
});
test('AI receives only discovered cells and actual history; no BFS route', () => {
  const maze = generateMaze(), history = [0, maze[0][0], 0];
  const body = buildRequest(maze, history);
  assert.deepEqual(body.state.history, history);
  assert.equal(body.state.current, 0);
  assert.deepEqual(body.state.discovered.map(x => x.cell), [...new Set(history)]);
  assert.equal(body.state.discovered[0].visits, 2);
  assert.deepEqual(Object.keys(body.questions.move.criteria), maze[0].map(n => `to_${n}`));
  assert.equal(body.state.passages, undefined);
});
test('API adapter accepts valid choices and rejects illegal moves and API failures', async () => {
  const maze = generateMaze();
  const decision = await getDecision(maze, [0], 'test-key', mock);
  assert.ok(maze[0].includes(decision.next));
  await assert.rejects(getDecision(maze, [0], 'x', async () => Response.json({ answers: { move: { type: 'choice', choice: 'to_24' } } })), /illegal move/);
  await assert.rejects(getDecision(maze, [0], 'x', async () => new Response('', { status: 401 })), /API key/);
  await assert.rejects(getDecision(maze, [0], 'x', async () => new Response('', { status: 429 })), /rate limit/);
});
test('local HTTP flow, no-key state, validation, and secret isolation', async () => {
  for (const apiKey of ['', 'test-key']) {
    const server = makeServer({ apiKey, fetcher: mock });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.configured, Boolean(apiKey));
      assert.ok(!(await (await fetch(base)).text()).includes('test-key'));
      const post = body => fetch(`${base}/api/step`, { method: 'POST', body: JSON.stringify(body) });
      const maze = generateMaze();
      const result = await post({ maze, history: [0] });
      assert.equal(result.status, apiKey ? 200 : 503);
      if (apiKey) {
        assert.ok(maze[0].includes((await result.json()).next));
        assert.equal((await post({ maze, history: [0, 24] })).status, 400);
        assert.equal((await post({ maze: [], history: [0] })).status, 400);
      }
      assert.equal((await fetch(`${base}/.env`)).status, 404);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
