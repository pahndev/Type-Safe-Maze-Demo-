# Small Maze — TypeSafe AI

A dependency-free Node.js + HTML/CSS/JavaScript app. TypeSafe's Jev model chooses each move in a randomly generated, solvable 5×5 maze. No TypeScript or build tool is required.

## Run

Requires Node.js 22.9 or newer.

```sh
cd typesafe-maze
cp .env.example .env
# Edit .env and set TYPESAFE_API_KEY to your real key.
npm start
```

Open http://localhost:3000. Get a key at https://console.typesafe.ai.
You can omit .env to use the separately labeled BFS comparison without API access.

```sh
npm test
```

## How it works

- Randomized depth-first carving connects all 25 cells, then opens a few extra passages for alternate routes.
- **Solve with TypeSafe** starts at S. On every move the local server sends the current cell, full move history, visit counts, and exits of visited cells to `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`.
- One `Choice` question offers only legal neighboring cells. Jev picks the next move, including backtracking. The response's choice is checked, animated, and added to history before the next request. Even a cell with one exit is sent to the model.
- The viewer sees the full maze; the model sees only discoveries. No BFS route, distance hints, or unexplored passages are sent to Jev.
- **Inside the decisions** shows each move and its returned confidence. This confidence is not a guarantee of correctness.
- Each run stops at the goal, an error, the Stop button, or 80 moves (up to 80 paid API calls). AI may loop or fail; its route is not guaranteed shortest. Stop prevents subsequent calls; an already submitted call may still finish and incur usage.
- **Try BFS only** is an independent, deterministic shortest-path comparison. BFS is also used to validate that submitted mazes are solvable; its result never guides AI moves.
- New maze cancels the current animation/request and ignores stale results. A solve starts a fresh history on the displayed maze.

The API key stays on the local server. It is never sent to the browser. The server binds to localhost, serves only explicitly listed assets, rejects cross-origin solve requests, and limits body size and concurrent API requests. This is a local demo, not a multi-user hosted service.

## Files

- `public/maze.js`: maze generation, validation, independent BFS comparison.
- `public/app.js`: step-by-step AI loop, controls, cancellation, animation.
- `typesafe.js`: partial-observation state, Choice request, response validation.
- `server.js`: static server and private API proxy.
- `test/maze.test.js`: 500 seeded maze checks and simulated API/HTTP tests.

Tests use simulated responses, not paid live calls. A real TypeSafe key is required to verify live model behavior.

API reference: https://docs.typesafe.ai/api
Choice primitive: https://docs.typesafe.ai/primitives/choice
