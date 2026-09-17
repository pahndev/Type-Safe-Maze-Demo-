import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, validateMaze, solveMaze, MIN_SIZE, MAX_SIZE } from '../public/maze.js';
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
    const size = MIN_SIZE + trial % (MAX_SIZE - MIN_SIZE + 1);
    const maze = generateMaze(random, size); validateMaze(maze);
    assert.equal(maze.length, size * size);
    const dist = Array(maze.length).fill(Infinity); dist[0] = 0;
    // Independent repeated relaxation checks BFS distance, including cyclic mazes.
    for (let pass = 0; pass < maze.length; pass++) for (let a = 0; a < maze.length; a++) for (const b of maze[a]) dist[b] = Math.min(dist[b], dist[a] + 1);
    assert.ok(dist.every(Number.isFinite));
    const { path } = solveMaze(maze);
    assert.equal(path.length - 1, dist.at(-1));
    assert.equal(path[0], 0); assert.equal(path.at(-1), maze.length - 1);
    path.slice(1).forEach((cell, i) => assert.ok(maze[path[i]].includes(cell)));
  }
});
test('size boundaries and row-wrapping passages are rejected', () => {
  for (const size of [0, 2, 11, 3.5, NaN]) assert.throws(() => generateMaze(Math.random, size));
  for (const count of [0, 4, 10, 121]) assert.throws(() => validateMaze(Array.from({ length: count }, () => [])));
  const maze = generateMaze(Math.random, 10);
  maze[9] = [10]; maze[10] = [9];
  assert.throws(() => validateMaze(maze), /Invalid maze passages/);
});
test('model state and coordinates follow the selected maze size', () => {
  for (const size of [3, 7, 10]) {
    const maze = generateMaze(Math.random, size);
    const history = solveMaze(maze).path.slice(0, -1);
    const body = buildRequest(maze, history);
    assert.equal(body.state.goal, size * size - 1);
    assert.ok(body.state.description.startsWith(`${size}×${size}`));
    assert.ok(body.questions.move.instructions.includes(`goal ${size * size - 1}.`));
    for (const cell of body.state.discovered) {
      assert.equal(cell.row, Math.floor(cell.cell / size) + 1);
      assert.equal(cell.column, cell.cell % size + 1);
    }
    assert.deepEqual(body.state.discovered.map(c => c.cell), [...new Set(history)]);
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
test('diagnostics preserve the actual model input, answer, and optional usage without credentials', async () => {
  const maze = generateMaze(), history = [0, maze[0][0], 0];
  let sent;
  const decision = await getDecision(maze, history, 'private-diagnostic-test-key', async (url, options) => {
    sent = JSON.parse(options.body);
    const response = await mock(url, { ...options, headers: { Authorization: 'Bearer test-key' } });
    const data = await response.json();
    data.usage = { input_tokens: 325, output_tokens: 24 };
    return Response.json(data);
  });
  assert.deepEqual(decision.diagnostics.request, sent);
  assert.deepEqual(decision.diagnostics.request.state.history, history);
  assert.deepEqual(decision.diagnostics.usage, { input_tokens: 325, output_tokens: 24 });
  assert.equal(decision.diagnostics.response.answers.move.choice, `to_${decision.next}`);
  assert.ok(Number.isFinite(decision.diagnostics.latencyMs) && decision.diagnostics.latencyMs >= 0);
  assert.ok(!JSON.stringify(decision).includes('private-diagnostic-test-key'));
  const noUsage = await getDecision(maze, [0], 'test-key', mock);
  assert.equal(noUsage.diagnostics.usage, null);
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
        for (const size of [3, 10]) {
          const resized = generateMaze(Math.random, size);
          const path = solveMaze(resized).path;
          const history = path.slice(0, Math.min(path.length - 1, 80));
          const response = await post({ maze: resized, history });
          assert.equal(response.status, 200);
          const data = await response.json();
          assert.equal(data.diagnostics.request.state.goal, size * size - 1);
          assert.ok(resized[history.at(-1)].includes(data.next));
          assert.equal((await post({ maze: resized, history: path })).status, 400);
        }
      }
      assert.equal((await fetch(`${base}/.env`)).status, 404);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
