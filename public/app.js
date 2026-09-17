import { generateMaze, solveMaze, GOAL } from './maze.js';

const $ = id => document.getElementById(id);
let maze, mazeNumber = 0, run = 0, controller;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const delay = ms => new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : ms));
let cells = [];
let line;

function render() {
  $('maze').replaceChildren();
  cells = maze.map((exits, cell) => {
    const element = document.createElement('div');
    element.className = 'cell';
    if (!exits.includes(cell - 5)) element.style.borderTopWidth = '1px';
    if (!exits.includes(cell + 1) || cell % 5 === 4) element.style.borderRightWidth = '1px';
    if (!exits.includes(cell + 5)) element.style.borderBottomWidth = '1px';
    if (!exits.includes(cell - 1) || cell % 5 === 0) element.style.borderLeftWidth = '1px';
    if (cell === 0 || cell === GOAL) {
      element.classList.add(cell === 0 ? 'start' : 'goal');
      const marker = document.createElement('b'); marker.textContent = cell === 0 ? 'S' : 'G'; element.append(marker);
    }
    $('maze').append(element);
    return element;
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('path-lines'); svg.setAttribute('viewBox', '0 0 500 500'); svg.setAttribute('aria-hidden', 'true');
  line = document.createElementNS(svg.namespaceURI, 'polyline');
  for (const [key, value] of Object.entries({ fill: 'none', stroke: '#6a923f', 'stroke-width': '5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })) line.setAttribute(key, value);
  svg.append(line); $('maze').append(svg);
}

function busy(value) {
  $('solve').disabled = value; $('preview').disabled = value; $('stop').hidden = !value;
}
function stop() {
  run++; controller?.abort(); busy(false);
  $('status').textContent = 'Exploration stopped. No further moves will be requested.';
}
function reset() {
  run++; controller?.abort(); busy(false);
  maze = generateMaze(); mazeNumber++; render();
  $('maze-number').textContent = `MAZE ${String(mazeNumber).padStart(3, '0')}`;
  $('status').textContent = 'A fresh maze is ready to explore.';
  $('steps').textContent = $('visited').textContent = '—';
  $('decision-list').replaceChildren();
  $('decision-note').textContent = 'The model sees visited cells and their exits, not the full maze shown here.';
}
function paint(history) {
  cells.forEach(el => el.classList.remove('current'));
  for (const cell of history) cells[cell].classList.add('explored', 'route');
  cells[history.at(-1)].classList.add('current');
  line.setAttribute('points', history.map(cell => `${(cell % 5) * 100 + 50},${Math.floor(cell / 5) * 100 + 50}`).join(' '));
  $('steps').textContent = history.length - 1;
  $('visited').textContent = new Set(history).size;
}
async function solve(useAI) {
  const token = ++run; busy(true); render();
  $('decision-list').replaceChildren();
  const history = [0]; paint(history);
  $('decision-note').textContent = useAI
    ? 'One live API request per move. The model receives its position, discovered exits, and full move history. Confidence is a preference, not proof of correctness.'
    : 'BFS comparison: deterministic shortest path. No API calls.';
  try {
    if (useAI) {
      while (history.at(-1) !== GOAL && history.length <= 80) {
        if (token !== run) return;
        $('status').textContent = `TypeSafe is choosing move ${history.length} of 80…`;
        controller = new AbortController();
        const response = await fetch('/api/step', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maze, history }), signal: controller.signal });
        const decision = await response.json();
        if (!response.ok) throw new Error(decision.error || 'Move failed. Please try again.');
        if (token !== run) return;
        const current = history.at(-1);
        if (!maze[current].includes(decision.next)) throw new Error('Illegal move rejected.');
        history.push(decision.next); paint(history);
        const coord = n => `(${Math.floor(n / 5) + 1}, ${n % 5 + 1})`;
        const item = document.createElement('li');
        item.textContent = `${coord(current)} → ${coord(decision.next)} · ${Math.round(decision.confidence * 100)}% confidence`;
        $('decision-list').append(item);
        await delay(220);
      }
      if (token !== run) return;
      $('status').textContent = history.at(-1) === GOAL
        ? `Goal reached! TypeSafe took ${history.length - 1} moves. This route is not necessarily shortest.`
        : 'Stopped at 80 moves. TypeSafe has not reached the goal. Try again or compare with BFS.';
    } else {
      const result = solveMaze(maze);
      $('status').textContent = 'BFS comparison: exploring the full maze…';
      for (const [index, cell] of result.visited.entries()) {
        if (token !== run) return;
        cells[cell].classList.add('explored'); $('visited').textContent = index + 1;
        await delay(65);
      }
      for (let i = 1; i <= result.path.length; i++) {
        if (token !== run) return;
        paint(result.path.slice(0, i)); $('visited').textContent = result.visited.length;
        await delay(120);
      }
      if (token !== run) return;
      $('status').textContent = `BFS comparison complete. Shortest path: ${result.path.length - 1} moves. No AI used.`;
    }
  } catch (error) {
    if (token === run) $('status').textContent = error.message;
  } finally { if (token === run) busy(false); }
}
$('new').addEventListener('click', reset);
$('stop').addEventListener('click', stop);
$('solve').addEventListener('click', () => solve(true));
$('preview').addEventListener('click', () => solve(false));
reset();
fetch('/api/status').then(r => r.json()).then(({ configured }) => {
  $('connection').textContent = configured ? '● API key configured · ready to connect' : '○ API key needed · BFS preview available';
}).catch(() => { $('connection').textContent = '○ Local server unavailable'; });
