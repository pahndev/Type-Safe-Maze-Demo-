export const SIZE = 5;
export const GOAL = SIZE * SIZE - 1;
export const MIN_SIZE = 3;
export const MAX_SIZE = 10;

export function mazeSize(maze) {
  const size = Array.isArray(maze) ? Math.sqrt(maze.length) : NaN;
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`Expected a square maze from ${MIN_SIZE}×${MIN_SIZE} to ${MAX_SIZE}×${MAX_SIZE}.`);
  }
  return size;
}

export function adjacent(cell, size = SIZE) {
  const row = Math.floor(cell / size), col = cell % size;
  return [row > 0 ? cell - size : -1, col < size - 1 ? cell + 1 : -1,
    row < size - 1 ? cell + size : -1, col > 0 ? cell - 1 : -1].filter(n => n >= 0);
}

export function generateMaze(random = Math.random, size = SIZE) {
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) throw new Error('Invalid maze size.');
  const maze = Array.from({ length: size * size }, () => []);
  const seen = new Set([0]), stack = [0];
  const connect = (a, b) => { maze[a].push(b); maze[b].push(a); };
  // Randomized DFS carves a spanning tree: every cell is reachable.
  while (stack.length) {
    const current = stack.at(-1);
    const options = adjacent(current, size).filter(n => !seen.has(n));
    if (!options.length) { stack.pop(); continue; }
    const next = options[Math.floor(random() * options.length)];
    connect(current, next);
    seen.add(next);
    stack.push(next);
  }
  // A few extra passages create alternate routes for the search to explore.
  for (let cell = 0; cell < maze.length; cell++) {
    for (const next of adjacent(cell, size)) {
      if (next > cell && !maze[cell].includes(next) && random() < 0.12) connect(cell, next);
    }
  }
  return maze;
}

export function validateMaze(maze) {
  const size = mazeSize(maze);
  for (let cell = 0; cell < maze.length; cell++) {
    const exits = maze[cell];
    if (!Array.isArray(exits) || exits.length > 4 || new Set(exits).size !== exits.length ||
        exits.some(n => !Number.isInteger(n) || !adjacent(cell, size).includes(n))) {
      throw new Error('Invalid maze passages.');
    }
  }
  for (let cell = 0; cell < maze.length; cell++) {
    if (maze[cell].some(n => !maze[n].includes(cell))) throw new Error('Passages must be two-way.');
  }
  if (!solveMaze(maze).path.length) throw new Error('The goal must be reachable.');
}

export function solveMaze(maze) {
  const goal = maze.length - 1;
  const queue = [0], parent = new Map([[0, null]]), visited = [];
  // FIFO BFS is only for the optional comparison and input validation.
  // The TypeSafe exploration loop never receives its route.
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    visited.push(current);
    if (current === goal) {
      const path = [];
      for (let n = goal; n !== null; n = parent.get(n)) path.push(n);
      return { path: path.reverse(), visited };
    }
    const neighbors = [...maze[current]].sort((a, b) => a - b);
    for (const next of neighbors) {
      if (!parent.has(next)) { parent.set(next, current); queue.push(next); }
    }
  }
  return { path: [], visited };
}
