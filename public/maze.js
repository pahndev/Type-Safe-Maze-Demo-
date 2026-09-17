export const SIZE = 5;
export const GOAL = SIZE * SIZE - 1;

export function adjacent(cell) {
  const row = Math.floor(cell / SIZE), col = cell % SIZE;
  return [row > 0 ? cell - SIZE : -1, col < SIZE - 1 ? cell + 1 : -1,
    row < SIZE - 1 ? cell + SIZE : -1, col > 0 ? cell - 1 : -1].filter(n => n >= 0);
}

export function generateMaze(random = Math.random) {
  const maze = Array.from({ length: SIZE * SIZE }, () => []);
  const seen = new Set([0]), stack = [0];
  const connect = (a, b) => { maze[a].push(b); maze[b].push(a); };
  // Randomized DFS carves a spanning tree: every cell is reachable.
  while (stack.length) {
    const current = stack.at(-1);
    const options = adjacent(current).filter(n => !seen.has(n));
    if (!options.length) { stack.pop(); continue; }
    const next = options[Math.floor(random() * options.length)];
    connect(current, next);
    seen.add(next);
    stack.push(next);
  }
  // A few extra passages create alternate routes for the search to explore.
  for (let cell = 0; cell <= GOAL; cell++) {
    for (const next of adjacent(cell)) {
      if (next > cell && !maze[cell].includes(next) && random() < 0.12) connect(cell, next);
    }
  }
  return maze;
}

export function validateMaze(maze) {
  if (!Array.isArray(maze) || maze.length !== 25) throw new Error('Expected a 5×5 maze.');
  for (let cell = 0; cell < 25; cell++) {
    const exits = maze[cell];
    if (!Array.isArray(exits) || exits.length > 4 || new Set(exits).size !== exits.length ||
        exits.some(n => !Number.isInteger(n) || !adjacent(cell).includes(n))) {
      throw new Error('Invalid maze passages.');
    }
  }
  for (let cell = 0; cell < 25; cell++) {
    if (maze[cell].some(n => !maze[n].includes(cell))) throw new Error('Passages must be two-way.');
  }
  if (!solveMaze(maze).path.length) throw new Error('The goal must be reachable.');
}

export function solveMaze(maze) {
  const queue = [0], parent = new Map([[0, null]]), visited = [];
  // FIFO BFS is only for the optional comparison and input validation.
  // The TypeSafe exploration loop never receives its route.
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    visited.push(current);
    if (current === GOAL) {
      const path = [];
      for (let n = GOAL; n !== null; n = parent.get(n)) path.push(n);
      return { path: path.reverse(), visited };
    }
    const neighbors = [...maze[current]].sort((a, b) => a - b);
    for (const next of neighbors) {
      if (!parent.has(next)) { parent.set(next, current); queue.push(next); }
    }
  }
  return { path: [], visited };
}
